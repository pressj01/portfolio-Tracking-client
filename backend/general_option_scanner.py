"""Unified adapter for the app's option strategy scanners.

The existing scanner endpoints remain the source of truth for constructing and
pricing each strategy.  This module gives the new General Option Scanner one
stable request and result shape, applies only metrics that a strategy actually
reports, and enriches rows with transparent stock scores plus IV Rank,
IV−RV, RV Rank, and Volatility score.
"""

from __future__ import annotations

from datetime import date, datetime
import math
import re
from typing import Any, Callable

import numpy as np

from flask import jsonify, request

from bear_call_spread_scanner import run_bear_call_spread_scan
from bear_put_spread_scanner import run_spread_scan as run_bear_put_spread_scan
from bull_put_spread_scanner import run_bull_put_spread_scan
from call_scanner import run_call_scan
from four_eight_eight_scanner import run_488_scan
from iron_butterfly_scanner import run_iron_butterfly_scan
from iron_condor_scanner import run_iron_condor_scan
from option_iv_history import (
    MIN_IV_RANK_OBSERVATIONS,
    calculate_iv_rv,
    calculate_percentile_rank,
    fetch_iv_observations,
    record_iv_snapshot,
)
from put_condor_scanner import run_condor_scan
from put_scanner import (
    BENCHMARK,
    COMMODITY_ETF_SET,
    INDEX_ETF_SET,
    SECTOR_ETF_SET,
    _benchmark_returns,
    _compute_technicals,
    _fetch_fundamentals_bulk,
    _load_history,
    _ticker_frame,
    resolve_scan_universe,
    run_put_scan,
)
from road_trip_butterfly_scanner import run_road_trip_butterfly_scan
from samurai_strategy_scanner import run_samurai_strategy_scan
from sixty_forty_twenty_fly_scanner import run_sixty_forty_twenty_fly_scan
from stock_scores import stock_selection_scores
from unbalanced_butterfly_scanner import run_unbalanced_butterfly_scan
from unbalanced_put_condor_scanner import run_unbalanced_put_condor_scan


Runner = Callable[[dict], dict]

STRATEGIES: dict[str, dict[str, Any]] = {
    "covered-call": {"label": "Covered Call", "runner": run_call_scan, "family": "standard"},
    "cash-secured-put": {"label": "Cash-Secured Put", "runner": run_put_scan, "family": "standard"},
    "bull-put-spread": {"label": "Bull Put Spread", "runner": run_bull_put_spread_scan, "family": "standard"},
    "bear-call-spread": {"label": "Bear Call Spread", "runner": run_bear_call_spread_scan, "family": "standard"},
    "bear-put-spread": {"label": "Bear Put Spread", "runner": run_bear_put_spread_scan, "family": "standard"},
    "iron-condor": {"label": "Iron Condor", "runner": run_iron_condor_scan, "family": "standard"},
    "iron-butterfly": {"label": "Iron Butterfly", "runner": run_iron_butterfly_scan, "family": "ticker"},
    "put-call-condor": {"label": "Put / Call Condor", "runner": run_condor_scan, "family": "condor"},
    "unbalanced-put-condor": {"label": "Unbalanced Put Condor", "runner": run_unbalanced_put_condor_scan, "family": "ticker"},
    "unbalanced-butterfly": {"label": "Unbalanced Butterfly", "runner": run_unbalanced_butterfly_scan, "family": "ticker"},
    "double-hedge-put-butterfly": {"label": "Double-Hedge Put Butterfly", "runner": run_488_scan, "family": "ticker"},
    "road-trip-butterfly": {"label": "Road Trip Butterfly", "runner": run_road_trip_butterfly_scan, "family": "ticker"},
    "sixty-forty-twenty-fly": {"label": "60/40/20 Fly", "runner": run_sixty_forty_twenty_fly_scan, "family": "ticker"},
    "naked-call": {"label": "Naked Call", "runner": run_samurai_strategy_scan, "family": "generic"},
    "long-call": {"label": "Long Call", "runner": run_samurai_strategy_scan, "family": "generic"},
    "long-put": {"label": "Long Put", "runner": run_samurai_strategy_scan, "family": "generic"},
    "married-put": {"label": "Married Put", "runner": run_samurai_strategy_scan, "family": "generic"},
    "married-call": {"label": "Married Call", "runner": run_samurai_strategy_scan, "family": "generic"},
    "bull-call-spread": {"label": "Bull Call Spread", "runner": run_samurai_strategy_scan, "family": "generic"},
    "long-straddle": {"label": "Long Straddle", "runner": run_samurai_strategy_scan, "family": "generic"},
    "long-strangle": {"label": "Long Strangle", "runner": run_samurai_strategy_scan, "family": "generic"},
    "short-straddle": {"label": "Short Straddle", "runner": run_samurai_strategy_scan, "family": "generic"},
    "short-strangle": {"label": "Short Strangle", "runner": run_samurai_strategy_scan, "family": "generic"},
    "call-butterfly": {"label": "Call Butterfly", "runner": run_samurai_strategy_scan, "family": "generic"},
    "put-butterfly": {"label": "Put Butterfly", "runner": run_samurai_strategy_scan, "family": "generic"},
    "long-call-calendar": {"label": "Long Call Calendar", "runner": run_samurai_strategy_scan, "family": "generic"},
    "long-put-calendar": {"label": "Long Put Calendar", "runner": run_samurai_strategy_scan, "family": "generic"},
    "long-call-diagonal": {"label": "Long Call Diagonal", "runner": run_samurai_strategy_scan, "family": "generic"},
    "long-put-diagonal": {"label": "Long Put Diagonal", "runner": run_samurai_strategy_scan, "family": "generic"},
    "collar": {"label": "Collar", "runner": run_samurai_strategy_scan, "family": "generic"},
    "call-ratio-spread": {"label": "Call Ratio Spread", "runner": run_samurai_strategy_scan, "family": "generic"},
    "put-ratio-spread": {"label": "Put Ratio Spread", "runner": run_samurai_strategy_scan, "family": "generic"},
}

INDEX_ONLY_STRATEGIES = frozenset({
    "unbalanced-butterfly",
    "unbalanced-put-condor",
    "double-hedge-put-butterfly",
    "road-trip-butterfly",
    "sixty-forty-twenty-fly",
})
INDEX_ONLY_DEFAULT_TICKERS = ("SPY", "QQQ", "IWM", "VOO")
RV_WINDOW = 21
TRADING_DAYS = 252

STANDARD_BROAD_OVERRIDES = {
    "min_market_cap": 0,
    "small_cap_min_market_cap": 0,
    "fund_min_aum": 0,
    "min_avg_dollar_volume": 0,
    "min_drop_pct": 0,
    "max_drop_pct": 100,
    "fund_min_drop_pct": 0,
    "fund_max_drop_pct": 100,
    "min_run_pct": 0,
    "fund_min_run_pct": 0,
    "min_stretch_sigma": -99,
    "max_stretch_sigma": 99,
    "fund_min_stretch_sigma": -99,
    "min_rally_sigma": -99,
    "max_rally_sigma": 99,
    "min_rel_weakness_pct": -99,
    "fund_min_rel_weakness_pct": -99,
    "max_rel_strength_pct": 99,
    "fund_max_rel_strength_pct": 99,
    "min_rsi": 0,
    "max_rsi": 100,
    "min_pct_of_52w_range": 0,
    "max_pct_of_52w_range": 100,
    "min_above_52w_low_pct": 0,
    "max_drawdown_pct": 100,
    "exclude_fresh_highs": False,
    "exclude_fresh_lows": False,
    "exclude_fresh_extremes": False,
    "exclude_earnings_before_expiry": False,
    "require_profitable": False,
    "require_below_sma50": False,
    "require_downtrend": False,
    "require_rolled_over": False,
    "require_resistance_overhead": False,
    "max_results": 100,
    "chain_limit": 60,
}


def _num(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _symbols(raw) -> list[str]:
    if isinstance(raw, str):
        raw = re.split(r"[\s,;]+", raw)
    seen, result = set(), []
    for value in raw or []:
        symbol = str(value or "").strip().upper()
        if symbol and symbol not in seen:
            seen.add(symbol)
            result.append(symbol)
    return result[:40]


def _nested(row: dict, *paths):
    for path in paths:
        current: Any = row
        for key in path.split("."):
            if not isinstance(current, dict):
                current = None
                break
            current = current.get(key)
        if current is not None and current != "":
            return current
    return None


def _runner_payload(strategy: str, payload: dict) -> dict:
    spec = STRATEGIES[strategy]
    symbols = _symbols(payload.get("symbols"))
    specific = dict(payload.get("strategy_filters") or {})
    reference_mode = str(payload.get("reference_delta_mode") or "none").strip().lower()
    reference_low = _num(payload.get("min_reference_delta"))
    reference_high = _num(payload.get("max_reference_delta"))
    target_reference_delta = None
    if reference_mode in {"short", "long"} and reference_low is not None and reference_high is not None:
        low, high = sorted((max(1.0, reference_low), min(99.0, reference_high)))
        target_reference_delta = (low + high) / 200.0
    common = {
        key: payload.get(key)
        for key in ("target_dte", "min_dte", "max_dte", "max_results")
        if payload.get(key) is not None
    }
    result = {**specific, **common}
    if strategy in INDEX_ONLY_STRATEGIES:
        invalid = [ticker for ticker in symbols if ticker not in INDEX_ETF_SET]
        if invalid:
            raise ValueError(
                "This long-dated structure is limited to index ETFs; remove "
                f"stock symbols: {', '.join(invalid)}"
            )
        result.update({
            "include_stocks": False,
            "include_index_etfs": True,
            "include_sector_etfs": False,
            "include_commodity_etfs": False,
            "entry_credit_mode": payload.get("entry_credit_mode") or {
                "risk_averse": "debit_or_flat",
                "moderate": "flat_or_slight_credit",
                "aggressive": "credit",
            }.get(str(payload.get("risk_profile") or "open").lower(), "any"),
            "entry_credit_max_points": _num(payload.get("entry_credit_max_points")) or 0.5,
        })

    if spec["family"] == "standard":
        result = {**STANDARD_BROAD_OVERRIDES, **result}
        if target_reference_delta is not None:
            if strategy in {"covered-call", "cash-secured-put"}:
                result["target_delta"] = target_reference_delta
            elif strategy in {"bull-put-spread", "bear-call-spread", "iron-condor"}:
                result["short_delta"] = target_reference_delta
                result["long_delta"] = max(0.01, target_reference_delta * 0.45)
            elif strategy == "bear-put-spread":
                result["long_delta"] = target_reference_delta
                result["short_delta"] = max(0.02, target_reference_delta - 0.25)
        if symbols:
            result.update({
                "universe": "custom",
                "custom_tickers": symbols,
                "include_stocks": True,
                "include_index_etfs": False,
                "include_sector_etfs": False,
                "include_commodity_etfs": False,
            })
        else:
            result.update({
                "universe": payload.get("universe") or "large_cap",
                "include_stocks": bool(payload.get("include_stocks", True)),
                "include_index_etfs": bool(payload.get("include_index_etfs", True)),
                "index_tickers": payload.get("index_tickers"),
                "include_sector_etfs": bool(payload.get("include_sector_etfs", False)),
                "include_commodity_etfs": bool(payload.get("include_commodity_etfs", False)),
            })
        if strategy == "iron-condor":
            result["general_scanner_mode"] = True
            # Shape is evaluated from the completed four-leg payoff below.  Do
            # not let the legacy boolean quietly turn Any/Riskless into a
            # balanced-only scan before those candidates reach this adapter.
            result["require_balanced_shape"] = False
            for key in (
                "min_total_option_volume", "min_iv_rank",
                "stock_score_fundamental_min", "stock_score_fundamental_max",
                "stock_score_growth_min", "stock_score_growth_max",
                "stock_score_technical_min", "stock_score_technical_max",
                "min_prob_max_profit", "max_prob_max_loss",
                "require_positive_expected_value", "max_abs_position_delta",
                "require_balanced_shape", "min_max_profit_dollars",
                "max_max_loss_dollars", "min_profit_ratio_pct",
            ):
                if payload.get(key) is not None:
                    result[key] = payload[key]
    elif spec["family"] == "condor":
        selected = symbols or ["SPY"]
        # The existing risk-budgeted condor engine prices one underlying per
        # request.  The unified screen deliberately uses the first requested
        # symbol and says so in its response params.
        result.update({
            "underlying": selected[0],
            "option_side": result.get("option_side") or "both",
        })
    elif spec["family"] == "generic":
        selected = symbols or resolve_scan_universe({
            "universe": payload.get("universe") or "large_cap",
            "include_stocks": bool(payload.get("include_stocks", True)),
            "include_index_etfs": bool(payload.get("include_index_etfs", True)),
            "index_tickers": payload.get("index_tickers"),
            "include_sector_etfs": bool(payload.get("include_sector_etfs", False)),
            "include_commodity_etfs": bool(payload.get("include_commodity_etfs", False)),
        })
        result.update({
            "generic_strategy": strategy,
            "tickers": selected,
            "bid_ask_level": payload.get("bid_ask_level") or "Mid",
            "reference_delta_mode": reference_mode,
            "target_reference_delta": target_reference_delta,
        })
    else:
        if strategy in INDEX_ONLY_STRATEGIES:
            selected = symbols or list(INDEX_ONLY_DEFAULT_TICKERS)
        else:
            selected = symbols or resolve_scan_universe({
                "universe": payload.get("universe") or "large_cap",
                "include_stocks": bool(payload.get("include_stocks", True)),
                "include_index_etfs": bool(payload.get("include_index_etfs", True)),
                "index_tickers": payload.get("index_tickers"),
                "include_sector_etfs": bool(payload.get("include_sector_etfs", False)),
                "include_commodity_etfs": bool(payload.get("include_commodity_etfs", False)),
            })
        result["tickers"] = ",".join(selected)
    return result


def _trade_kind(strategy: str, row: dict) -> str:
    if strategy == "put-call-condor":
        side = str(row.get("option_side") or "").lower()
        if side in {"put", "call"}:
            return f"{side}-condor"
    return strategy


def _strike_summary(row: dict) -> str:
    spread = row.get("spread") if isinstance(row.get("spread"), dict) else {}
    # Include nested call/put objects, not just a top-level legs list. Cash-
    # secured puts and covered calls only carry the contract under `put`/`call`,
    # so the table was showing "—" and the analysis panel treated them as empty.
    legs = _option_legs(row)
    if legs:
        values = [_num(leg.get("strike")) for leg in legs if isinstance(leg, dict)]
        values = [value for value in values if value is not None]
        if values:
            return " / ".join(f"{value:g}" for value in values)
    keys = (
        "put_long_strike", "put_short_strike", "call_short_strike", "call_long_strike",
        "upper_long_strike", "upper_short_strike", "body_short_strike",
        "lower_short_strike", "lower_long_strike", "debit_long_strike",
        "debit_short_strike", "credit_short_strike", "credit_long_strike",
        "long_strike", "short_strike", "body_strike", "strike",
    )
    values = []
    for key in keys:
        value = _num(spread.get(key)) if key in spread else _num(row.get(key))
        if value is not None and value not in values:
            values.append(value)
    return " / ".join(f"{value:g}" for value in values) if values else "—"


def _option_legs(row: dict) -> list[dict]:
    spread = row.get("spread") if isinstance(row.get("spread"), dict) else {}
    legs = spread.get("legs") or row.get("legs")
    if isinstance(legs, list) and legs:
        return [leg for leg in legs if isinstance(leg, dict)]
    result = []
    for container in (spread, row):
        for key, value in container.items():
            if (key.endswith("_leg") or key in {"call", "put"}) and isinstance(value, dict):
                if value.get("strike") is not None:
                    result.append({**value, "_role": key})
    return result


def _reference_deltas(legs: list[dict], mode: str) -> list[float]:
    if mode not in {"short", "long"}:
        return []
    matches = []
    for leg in legs:
        if str(leg.get("option_type") or leg.get("type") or "").lower() == "stock":
            continue
        delta = _num(leg.get("delta"))
        if delta is None:
            continue
        role = " ".join(str(leg.get(key) or "") for key in ("_role", "role", "side", "action")).lower()
        quantity = _num(leg.get("qty"))
        if quantity is None:
            quantity = _num(leg.get("quantity"))
        is_short = quantity is not None and quantity < 0 or any(word in role for word in ("short", "sell"))
        is_long = quantity is not None and quantity > 0 or any(word in role for word in ("long", "buy"))
        if (mode == "short" and is_short) or (mode == "long" and is_long):
            value = abs(delta)
            matches.append(value * 100.0 if value <= 1.5 else value)
    if matches:
        return matches

    # Several established one-leg scanners report a nested ``call`` or ``put``
    # without side metadata.  When there is only one option, its strategy role
    # is unambiguous, so it remains a valid reference leg.
    option_legs = [leg for leg in legs if str(leg.get("option_type") or leg.get("type") or "").lower() != "stock"]
    if len(option_legs) == 1:
        delta = _num(option_legs[0].get("delta"))
        if delta is not None:
            value = abs(delta)
            return [value * 100.0 if value <= 1.5 else value]
    return []


def _as_day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _rv_on_or_before(rv_by_date: dict, day: date | None) -> float | None:
    if not rv_by_date or day is None:
        return None
    if day in rv_by_date:
        return rv_by_date[day]
    earlier = [key for key in rv_by_date if key <= day]
    return rv_by_date[max(earlier)] if earlier else None


def _realized_vol_metrics(history_frame) -> dict:
    """One-month realized vol, its 1-year percentile, and the dated RV series."""
    empty = {"rv": None, "rv_rank": None, "_rv_by_date": {}}
    if history_frame is None:
        return empty
    try:
        close = history_frame["Close"].dropna()
    except Exception:
        return empty
    if len(close) < RV_WINDOW + 2:
        return empty
    log_ret = np.log(close / close.shift(1)).replace([np.inf, -np.inf], np.nan).dropna()
    if len(log_ret) < RV_WINDOW:
        return empty
    series = (log_ret.rolling(RV_WINDOW).std() * math.sqrt(TRADING_DAYS)).dropna()
    values = [float(value) for value in series.tolist() if value is not None and float(value) > 0]
    if not values:
        return empty
    current = values[-1]
    ready = len(values) >= MIN_IV_RANK_OBSERVATIONS
    rank = calculate_percentile_rank(values, current) if ready else None
    by_date = {}
    for index, value in series.items():
        day = _as_day(index)
        try:
            reading = float(value)
        except (TypeError, ValueError):
            continue
        if day is None or reading <= 0 or not math.isfinite(reading):
            continue
        by_date[day] = reading
    return {
        "rv": current,
        "rv_rank": round(rank, 1) if rank is not None else None,
        "_rv_by_date": by_date,
    }


def _general_metrics(strategy: str, row: dict, reference_mode: str = "none") -> dict:
    max_profit = _num(_nested(
        row, "spread.max_profit_dollars", "spread.max_profit", "max_profit_dollars",
        "max_profit", "premium_dollars", "call.premium_dollars", "put.premium_dollars",
    ))
    max_loss = _num(_nested(
        row, "spread.max_loss_dollars", "spread.max_loss", "max_loss_dollars",
        "max_loss", "cash_required", "put.cash_required",
    ))
    ratio = _num(_nested(
        row, "spread.profit_ratio_pct", "spread.reward_risk", "profit_ratio_pct",
        "reward_risk", "return_on_risk_pct",
    ))
    if ratio is None and max_profit is not None and max_loss not in (None, 0):
        ratio = abs(max_profit / max_loss) * 100.0
    elif ratio is not None and ratio <= 10 and _nested(row, "spread.reward_risk", "reward_risk") is not None:
        ratio *= 100.0
    spread = row.get("spread") if isinstance(row.get("spread"), dict) else {}
    probability_schedule = _nested(
        row, "spread.probability_schedule", "probability_schedule"
    )
    if not isinstance(probability_schedule, list):
        probability_schedule = []
    expiration_probability = next((
        point for point in probability_schedule
        if isinstance(point, dict)
        and (point.get("kind") == "expiration" or point.get("remaining_dte") == 0)
    ), {})
    prob_success = _num(_nested(
        row, "spread.prob_profit", "prob_profit", "probability_profit_pct",
        "probability_of_profit",
    ))
    if prob_success is None:
        prob_success = _num(expiration_probability.get("probability_success_pct"))
    prob_failure = _num(_nested(
        row, "spread.prob_loss", "prob_loss", "probability_loss_pct",
    ))
    if prob_failure is None:
        prob_failure = _num(expiration_probability.get("probability_failure_pct"))
    if prob_failure is None and prob_success is not None:
        prob_failure = max(0.0, min(100.0, 100.0 - prob_success))
    prob_otm = _num(_nested(row, "spread.prob_otm", "prob_otm"))
    prob_itm = 100.0 - prob_otm if prob_otm is not None else None
    prob_max_profit = _num(_nested(
        row, "spread.prob_max_profit", "prob_max_profit"
    ))
    if prob_max_profit is None and strategy in {"bull-put-spread", "bear-call-spread"}:
        prob_max_profit = prob_otm
    prob_touch = _num(_nested(row, "spread.prob_touch", "prob_touch"))
    if prob_touch is None and prob_itm is not None:
        prob_touch = min(100.0, 2.0 * prob_itm)
    legs = _option_legs(row)
    reference_deltas = _reference_deltas(legs, reference_mode)
    leg_spreads = [
        (_num(leg.get("ask")) or 0) - (_num(leg.get("bid")) or 0)
        for leg in legs
        if _num(leg.get("ask")) is not None and _num(leg.get("bid")) is not None
    ]
    reference_strike = _num(_nested(
        row, "spread.short_strike", "spread.body_strike", "call.strike",
        "put.strike", "short_strike", "body_strike", "upper_short_strike",
        "reference_strike",
    ))
    price = _num(row.get("price"))
    moneyness = (
        (reference_strike - price) / price * 100.0
        if reference_strike is not None and price not in (None, 0) else None
    )
    put_width = _num(spread.get("put_width"))
    call_width = _num(spread.get("call_width"))
    entry_credit = _num(_nested(row, "spread.entry_credit", "entry_credit"))
    entry_credit_dollars = _num(_nested(
        row, "spread.entry_credit_dollars", "entry_credit_dollars"
    ))
    condor_shapes = []
    if strategy == "iron-condor" and put_width is not None and call_width is not None:
        tolerance = max(0.051, max(put_width, call_width) * 0.01)
        if abs(put_width - call_width) <= tolerance:
            condor_shapes.append("balanced")
        if entry_credit is not None and call_width - entry_credit <= tolerance:
            condor_shapes.append("riskless_up")
        if entry_credit is not None and put_width - entry_credit <= tolerance:
            condor_shapes.append("riskless_down")
    lower_flat = _num(_nested(row, "lower_flat_dollars", "lower_tail_dollars"))
    upper_flat = _num(_nested(row, "upper_flat_dollars", "upper_tail_dollars"))
    butterfly_shapes = []
    if "butterfly" in strategy and lower_flat is not None and upper_flat is not None:
        tolerance = max(1.0, max(abs(lower_flat), abs(upper_flat)) * 0.01)
        if abs(lower_flat - upper_flat) <= tolerance:
            butterfly_shapes.append("balanced")
        if upper_flat >= -tolerance:
            butterfly_shapes.append("riskless_up")
        if lower_flat >= -tolerance:
            butterfly_shapes.append("riskless_down")
    return {
        "ticker": str(row.get("ticker") or "").upper(),
        "is_etf": bool(
            row.get("is_etf")
            or str(row.get("ticker") or "").upper() in (INDEX_ETF_SET | SECTOR_ETF_SET | COMMODITY_ETF_SET)
        ),
        "name": row.get("name") or row.get("company_name"),
        "price": price,
        "expiration": _nested(row, "spread.expiration", "call.expiration", "put.expiration", "expiration"),
        "dte": _num(_nested(row, "spread.dte", "call.dte", "put.dte", "dte")),
        "strikes": _strike_summary(row),
        "iv_rank": _num(row.get("iv_rank")) or _num(row.get("iv_rank_effective")),
        "iv_rank_source": row.get("iv_rank_source"),
        "iv_rank_observations": int(_num(row.get("iv_rank_observations")) or 0),
        "atm_iv": _num(_nested(row, "spread.atm_iv", "call.atm_iv", "put.atm_iv", "atm_iv", "iv")),
        "rv": None,
        "rv_rank": None,
        "iv_rv": None,
        "iv_rv_rank": None,
        "iv_rv_observations": 0,
        "volatility_score": None,
        "total_option_volume": _num(_nested(row, "spread.total_option_volume", "total_option_volume", "option_volume")),
        "delta": _num(_nested(row, "spread.position_delta", "spread.net_delta", "position_delta", "net_delta", "delta")),
        "reference_delta": round(sum(reference_deltas) / len(reference_deltas), 2) if reference_deltas else None,
        "reference_deltas": [round(value, 2) for value in reference_deltas],
        "prob_max_profit": prob_max_profit,
        "prob_max_loss": _num(_nested(row, "spread.prob_max_loss", "prob_max_loss", "probability_max_loss_pct")),
        "prob_success": prob_success,
        "prob_failure": prob_failure,
        "prob_otm": prob_otm,
        "prob_itm": prob_itm,
        "prob_touch": prob_touch,
        "prob_touch_estimated": prob_touch is not None and _num(_nested(row, "spread.prob_touch", "prob_touch")) is None,
        "prob_touch_put": _num(_nested(row, "spread.prob_touch_put", "prob_touch_put")),
        "prob_touch_call": _num(_nested(row, "spread.prob_touch_call", "prob_touch_call")),
        "probability_schedule": probability_schedule,
        "expected_value": _num(_nested(row, "spread.expected_value_dollars", "spread.expected_value", "expected_value_dollars", "expected_value")),
        "entry_credit": entry_credit,
        "entry_credit_dollars": entry_credit_dollars,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "max_profit_unbounded": bool(_nested(row, "spread.max_profit_unbounded", "max_profit_unbounded")),
        "max_loss_unbounded": bool(_nested(row, "spread.max_loss_unbounded", "max_loss_unbounded")),
        "profit_ratio": ratio,
        "moneyness": moneyness,
        "bid_ask_spread": max(leg_spreads) if leg_spreads else None,
        "return_pct": _num(_nested(row, "call.premium_yield_pct", "put.premium_yield_pct", "premium_yield_pct", "return_pct")),
        "annualized_return_pct": _num(_nested(row, "call.annualized_pct", "put.annualized_pct", "annualized_pct", "annualized_return_pct")),
        "status": row.get("status") or row.get("chain_status") or row.get("candidate_status"),
        "trade_kind": _trade_kind(strategy, row),
        "condor_shapes": condor_shapes,
        "butterfly_shapes": butterfly_shapes,
    }


def _score_rows(rows: list[dict]) -> None:
    tickers = sorted({str(row.get("ticker") or "").upper() for row in rows if row.get("ticker")})
    try:
        fundamentals = _fetch_fundamentals_bulk(tickers) if tickers else {}
    except Exception:
        fundamentals = {}
    try:
        history = _load_history(tickers) if tickers else None
        benchmark_returns = _benchmark_returns(history) if history is not None else None
    except Exception:
        history = None
        benchmark_returns = None
    benchmark_technicals = {}
    benchmark_frame = None
    try:
        benchmark_frame = _ticker_frame(history, BENCHMARK) if history is not None else None
        benchmark_technicals = (
            _compute_technicals(benchmark_frame, None, 21)
            if benchmark_frame is not None else None
        ) or {}
    except Exception:
        pass
    market_context = _technical_context(benchmark_technicals, benchmark_frame)
    fund_symbols = INDEX_ETF_SET | SECTOR_ETF_SET | COMMODITY_ETF_SET
    for row in rows:
        meta = row["_general"]
        scores = row.get("stock_scores")
        ticker = meta["ticker"]
        technicals = dict(row)
        ticker_history = None
        try:
            ticker_history = _ticker_frame(history, ticker) if history is not None else None
            calculated = (
                _compute_technicals(ticker_history, benchmark_returns, 21)
                if ticker_history is not None else None
            ) or {}
            # The shared technical score uses market-relative strength.  The
            # put-scanner helper calls the beta-adjusted value
            # ``excess_drop_pct``; expose it under the common name.
            if calculated.get("rel_strength_pct") is None:
                calculated["rel_strength_pct"] = calculated.get("excess_drop_pct")
            technicals = {**calculated, **{key: value for key, value in row.items() if value is not None}}
        except Exception:
            pass
        meta["technicals"] = _technical_context(technicals, ticker_history)
        meta["market_technicals"] = market_context
        realized = _realized_vol_metrics(ticker_history)
        if realized["rv"] is not None:
            meta["rv"] = round(float(realized["rv"]) * 100.0, 2)
        meta["rv_rank"] = realized["rv_rank"]
        meta["_rv_by_date"] = realized["_rv_by_date"]
        if not isinstance(scores, dict):
            scores = stock_selection_scores(
                fundamentals.get(ticker) or {},
                technicals,
                is_fund=bool(row.get("is_etf") or ticker in fund_symbols),
            )
        meta["stock_scores"] = scores


def _technical_context(technicals: dict, history_frame) -> dict:
    price = _num(technicals.get("price"))
    sma50 = _num(technicals.get("sma_50"))
    sma200 = _num(technicals.get("sma_200"))
    if price is not None and sma50 is not None and sma200 is not None:
        if price > sma50 > sma200:
            trend = "uptrend"
        elif price < sma50 < sma200:
            trend = "downtrend"
        else:
            trend = "mixed"
    else:
        trend = None
    moves = {}
    try:
        close = history_frame["Close"].dropna()
        for sessions in (5, 10, 21):
            if len(close) > sessions:
                start = _num(close.iloc[-(sessions + 1)])
                end = _num(close.iloc[-1])
                moves[str(sessions)] = (
                    round((end / start - 1.0) * 100.0, 2)
                    if start not in (None, 0) and end is not None else None
                )
    except Exception:
        pass
    return {
        "trend": trend,
        "price": price,
        "sma_50": sma50,
        "sma_200": sma200,
        "rsi_14": _num(technicals.get("rsi_14")),
        "relative_strength_pct": _num(technicals.get("rel_strength_pct")),
        "moves_pct": moves,
    }


def _iv_history(rows: list[dict]) -> None:
    for row in rows:
        meta = row["_general"]
        rv_by_date = meta.pop("_rv_by_date", None) or {}
        ticker = meta.get("ticker")
        atm_iv = _num(meta.get("atm_iv"))
        rv_decimal = _num(meta.get("rv"))
        if rv_decimal is not None and rv_decimal > 3:
            rv_decimal = rv_decimal / 100.0
        if ticker and atm_iv:
            try:
                history = record_iv_snapshot(ticker, atm_iv, meta.get("expiration"))
            except Exception:
                history = {}
            if history.get("rank") is not None:
                meta["iv_rank"] = round(float(history["rank"]), 1)
                meta["iv_rank_source"] = "history"
            elif meta.get("iv_rank") is None:
                meta["iv_rank_source"] = "warming_up"
            meta["iv_rank_observations"] = int(history.get("observations") or 0)
        iv_rv = calculate_iv_rv(atm_iv, rv_decimal) if atm_iv is not None else None
        meta["iv_rv"] = round(iv_rv, 2) if iv_rv is not None else None
        observations = []
        if ticker:
            try:
                observations = fetch_iv_observations(ticker)
            except Exception:
                observations = []
        spreads = []
        for item in observations:
            day_rv = _rv_on_or_before(rv_by_date, item.get("observed_on"))
            spread = calculate_iv_rv(item.get("atm_iv"), day_rv)
            if spread is not None:
                spreads.append(spread)
        meta["iv_rv_observations"] = len(spreads)
        if iv_rv is not None and len(spreads) >= MIN_IV_RANK_OBSERVATIONS:
            rank = calculate_percentile_rank(spreads, iv_rv)
            meta["iv_rv_rank"] = round(rank, 1) if rank is not None else None
        else:
            meta["iv_rv_rank"] = None
        iv_rank = _num(meta.get("iv_rank"))
        iv_rv_rank = _num(meta.get("iv_rv_rank"))
        if iv_rank is not None and iv_rv_rank is not None:
            meta["volatility_score"] = round((iv_rank + iv_rv_rank) / 2.0, 1)
        else:
            meta["volatility_score"] = None


def _filter_reasons(meta: dict, payload: dict) -> list[str]:
    reasons = []
    checks = (
        ("dte", "min_dte", "Minimum DTE", "min"),
        ("dte", "max_dte", "Maximum DTE", "max"),
        ("total_option_volume", "min_total_option_volume", "Option volume", "min"),
        ("iv_rank", "min_iv_rank", "IV Rank", "min"),
        ("iv_rank", "max_iv_rank", "IV Rank", "max"),
        ("iv_rv", "min_iv_rv", "IV − RV", "min"),
        ("iv_rv", "max_iv_rv", "IV − RV", "max"),
        ("iv_rv_rank", "min_iv_rv_rank", "IV − RV Rank", "min"),
        ("iv_rv_rank", "max_iv_rv_rank", "IV − RV Rank", "max"),
        ("rv_rank", "min_rv_rank", "RV Rank", "min"),
        ("rv_rank", "max_rv_rank", "RV Rank", "max"),
        ("volatility_score", "min_volatility_score", "Volatility score", "min"),
        ("volatility_score", "max_volatility_score", "Volatility score", "max"),
        ("prob_max_profit", "min_prob_max_profit", "Probability of max profit", "min"),
        ("prob_max_loss", "max_prob_max_loss", "Probability of max loss", "max"),
        ("expected_value", "min_expected_value", "Expected value", "min"),
        ("max_loss", "min_max_loss_dollars", "Minimum loss bound", "min"),
        ("max_profit", "min_max_profit_dollars", "Maximum profit", "min"),
        ("max_loss", "max_max_loss_dollars", "Maximum loss", "max"),
        ("profit_ratio", "min_profit_ratio_pct", "Profit ratio", "min"),
        ("profit_ratio", "max_profit_ratio_pct", "Profit ratio", "max"),
        ("moneyness", "min_moneyness_pct", "Moneyness", "min"),
        ("moneyness", "max_moneyness_pct", "Moneyness", "max"),
        ("bid_ask_spread", "max_bid_ask_spread", "Bid/ask spread", "max"),
        ("return_pct", "min_return_pct", "Return", "min"),
        ("annualized_return_pct", "min_annualized_return_pct", "Annualized return", "min"),
    )
    for field, filter_key, label, direction in checks:
        actual, limit = _num(meta.get(field)), _num(payload.get(filter_key))
        if actual is None or limit is None:
            continue
        if (direction == "min" and actual < limit) or (direction == "max" and actual > limit):
            reasons.append(label)
    expiration = meta.get("expiration")
    if expiration:
        try:
            if datetime.strptime(str(expiration), "%Y-%m-%d").date() < date.today():
                reasons.append("Expired contract")
        except (TypeError, ValueError):
            reasons.append("Invalid expiration")
    strategy = str(payload.get("strategy") or "").strip().lower()
    credit_mode = str(payload.get("entry_credit_mode") or "any").strip().lower()
    if strategy in INDEX_ONLY_STRATEGIES and credit_mode != "any":
        entry_credit = _num(meta.get("entry_credit"))
        if entry_credit is None:
            reasons.append("Opening credit unavailable")
        elif credit_mode == "debit_or_flat" and entry_credit > 0:
            reasons.append("Opening cash flow must be a debit or zero credit")
        elif credit_mode == "flat_or_slight_credit":
            maximum = _num(payload.get("entry_credit_max_points")) or 0.5
            if entry_credit < 0 or entry_credit > maximum:
                reasons.append("Opening cash flow is outside the moderate band")
        elif credit_mode == "credit" and entry_credit <= 0:
            reasons.append("Opening cash flow must be a credit")
    scores = meta.get("stock_scores") or {}
    ticker = str(meta.get("ticker") or "").upper()
    is_fund = bool(
        meta.get("is_etf")
        or ticker in (INDEX_ETF_SET | SECTOR_ETF_SET | COMMODITY_ETF_SET)
    )
    for key, label in (("fundamental", "Fundamental score"), ("growth", "Growth score"), ("technical", "Technical score")):
        # Fundamental and Growth scores describe a company.  They never gate an
        # ETF or index fund such as SPY, QQQ, or IWM; Technical remains useful
        # for both stocks and funds.
        if is_fund and key in {"fundamental", "growth"}:
            continue
        value = _num(scores.get(key))
        low = _num(payload.get(f"stock_score_{key}_min"))
        high = _num(payload.get(f"stock_score_{key}_max"))
        score_filter_active = (low is not None and low > 1) or (high is not None and high < 10)
        if score_filter_active and value is None:
            reasons.append(f"{label} unavailable")
        elif value is not None and ((low is not None and value < low) or (high is not None and value > high)):
            reasons.append(label)
    technicals = meta.get("technicals") or {}
    market = meta.get("market_technicals") or {}
    requested_market = str(payload.get("market_trend") or "any").strip().lower()
    if requested_market != "any" and market.get("trend") != requested_market:
        reasons.append("Market trend unavailable" if market.get("trend") is None else "Market trend")
    requested_underlying = str(payload.get("underlying_trend") or "any").strip().lower()
    if requested_underlying != "any" and technicals.get("trend") != requested_underlying:
        reasons.append("Underlying trend unavailable" if technicals.get("trend") is None else "Underlying trend")
    lookback = str(int(_num(payload.get("recent_move_lookback")) or 5))
    recent_move = _num((technicals.get("moves_pct") or {}).get(lookback))
    requested_move = str(payload.get("recent_move_direction") or "any").strip().lower()
    minimum_move = max(0.0, _num(payload.get("min_abs_recent_move_pct")) or 0.0)
    if requested_move != "any":
        if recent_move is None:
            reasons.append("Recent move unavailable")
        elif requested_move == "down" and recent_move >= -minimum_move:
            reasons.append("Recent decline")
        elif requested_move == "up" and recent_move <= minimum_move:
            reasons.append("Recent rally")
    rsi = _num(technicals.get("rsi_14"))
    min_rsi = _num(payload.get("technical_rsi_min"))
    max_rsi = _num(payload.get("technical_rsi_max"))
    rsi_filter_active = (min_rsi is not None and min_rsi > 0) or (max_rsi is not None and max_rsi < 100)
    if rsi_filter_active and rsi is None:
        reasons.append("RSI unavailable")
    elif rsi is not None and ((min_rsi is not None and rsi < min_rsi) or (max_rsi is not None and rsi > max_rsi)):
        reasons.append("RSI")
    requested_shape = str(payload.get("iron_condor_shape") or "any").strip().lower()
    if requested_shape != "any" and requested_shape not in (meta.get("condor_shapes") or []):
        reasons.append("Iron Condor shape")
    requested_butterfly_shape = str(payload.get("butterfly_shape") or "any").strip().lower()
    if requested_butterfly_shape != "any" and requested_butterfly_shape not in (meta.get("butterfly_shapes") or []):
        # Older specialized scanners may not report both tail values. Missing
        # metrics stay visible; an explicit mismatch is filtered.
        if meta.get("butterfly_shapes"):
            reasons.append("Butterfly shape")
    max_abs_delta = _num(payload.get("max_abs_position_delta"))
    actual_delta = _num(meta.get("delta"))
    if max_abs_delta is not None and actual_delta is not None and abs(actual_delta) > max_abs_delta:
        reasons.append("Position delta")
    reference_mode = str(payload.get("reference_delta_mode") or "none").strip().lower()
    reference_low = _num(payload.get("min_reference_delta"))
    reference_high = _num(payload.get("max_reference_delta"))
    if reference_mode in {"short", "long"} and reference_low is not None and reference_high is not None:
        low, high = sorted((reference_low, reference_high))
        reference_deltas = meta.get("reference_deltas") or []
        if not reference_deltas:
            reasons.append("Reference option delta unavailable")
        elif any(delta < low or delta > high for delta in reference_deltas):
            reasons.append("Reference option delta")
    if bool(payload.get("require_positive_expected_value")):
        expected = _num(meta.get("expected_value"))
        if expected is not None and expected <= 0:
            reasons.append("Expected value")
    return reasons


def _is_constructible_trade(row: dict) -> bool:
    """True when Detailed Risk Graph can open a real listed structure.

    The dedicated cash-secured-put and covered-call scanners still emit
    stock-only score rows when the chain lookup misses. Those names look like
    trades on this screen, but they have no strike or expiration, so the risk
    graph stays disabled. Do not surface them here.
    """
    if not isinstance(row, dict) or not row.get("ticker"):
        return False
    spread = row.get("spread") if isinstance(row.get("spread"), dict) else {}
    listed_legs = _option_legs(row)
    has_expiration = bool(
        spread.get("expiration")
        or row.get("expiration")
        or _nested(row, "call.expiration", "put.expiration")
        or any(leg.get("expiration") for leg in listed_legs)
    )
    has_strikes = bool(listed_legs) or any(
        character.isdigit() for character in _strike_summary(row)
    )
    return bool(has_expiration and has_strikes)


def _constructible_watchlist_rows(raw: dict) -> list[dict]:
    """Keep priced legacy near-matches, but never surface unavailable shells."""
    return [
        row for row in (raw.get("watchlist_rows") or [])
        if _is_constructible_trade(row)
    ]


def run_general_option_scan(payload: dict, *, runner: Runner | None = None) -> dict:
    supplied = payload or {}
    strategy = str(supplied.get("strategy") or "iron-condor").strip().lower()
    if strategy not in STRATEGIES:
        raise ValueError(f"Unknown option strategy: {strategy}")
    spec = STRATEGIES[strategy]
    params = _runner_payload(strategy, supplied)
    raw = (runner or spec["runner"])(params) or {}
    raw_rows = list(raw.get("rows") or [])
    raw_rows.extend(_constructible_watchlist_rows(raw))
    if strategy == "put-call-condor":
        raw_rows.extend(raw.get("combined_packages") or [])
    rows = []
    unpriced_dropped = 0
    for row in raw_rows:
        if not isinstance(row, dict) or not row.get("ticker"):
            continue
        if not _is_constructible_trade(row):
            unpriced_dropped += 1
            continue
        copy = dict(row)
        copy["_general"] = _general_metrics(
            strategy, copy, str(supplied.get("reference_delta_mode") or "none")
        )
        rows.append(copy)
    _score_rows(rows)
    _iv_history(rows)
    for row in rows:
        row["_general"].pop("_rv_by_date", None)
    candidates_evaluated = len(rows)
    rejection_counts: dict[str, int] = {}
    for row in rows:
        reasons = _filter_reasons(row["_general"], supplied)
        row["_general"]["filter_reasons"] = reasons
        for reason in set(reasons):
            rejection_counts[reason] = rejection_counts.get(reason, 0) + 1
    eligible_rows = [
        row for row in rows
        if not ({"Expired contract", "Invalid expiration"} & set(row["_general"]["filter_reasons"]))
    ]
    exact_rows = [row for row in eligible_rows if not row["_general"]["filter_reasons"]]
    exact_rows.sort(key=lambda row: (
        -(_num(row["_general"].get("expected_value")) or -1e12),
        -(_num(row.get("score")) or 0),
        row["_general"]["ticker"],
    ))
    max_results = max(1, min(200, int(_num(supplied.get("max_results")) or 100)))
    showing_near_matches = bool(
        not exact_rows and eligible_rows and supplied.get("include_near_matches")
    )
    if showing_near_matches:
        eligible_rows.sort(key=lambda row: (
            len(row["_general"]["filter_reasons"]),
            -(_num(row["_general"].get("expected_value")) or -1e12),
            -(_num(row.get("score")) or 0),
            row["_general"]["ticker"],
        ))
        returned_rows = eligible_rows[:max_results]
    else:
        returned_rows = exact_rows[:max_results]
    for row in returned_rows:
        row["_general"]["match_status"] = (
            "near_match" if row["_general"]["filter_reasons"] else "match"
        )
    return {
        "strategy": strategy,
        "strategy_label": spec["label"],
        "rows": returned_rows,
        "stats": {
            **(raw.get("stats") or {}),
            "general_results": len(exact_rows),
            "rows_returned": len(returned_rows),
            "near_matches_returned": (
                len(returned_rows) if showing_near_matches else 0
            ),
            "showing_near_matches": showing_near_matches,
            "candidates_evaluated": candidates_evaluated,
            "unpriced_dropped": unpriced_dropped,
            "filter_rejections": dict(sorted(
                rejection_counts.items(), key=lambda item: (-item[1], item[0])
            )),
        },
        "params": params,
        "as_of": raw.get("as_of") or datetime.now().isoformat(timespec="seconds"),
        "error": raw.get("error"),
        "unavailable": raw.get("unavailable") or [],
    }


def register_routes(app):
    @app.route("/api/options/general-scan/strategies", methods=["GET"])
    def general_option_scan_strategies():
        return jsonify(strategies=[
            {"key": key, "label": spec["label"]}
            for key, spec in STRATEGIES.items()
        ])

    @app.route("/api/options/general-scan", methods=["POST"])
    def general_option_scan():
        try:
            return jsonify(run_general_option_scan(request.get_json(silent=True) or {}))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=f"General option scan failed: {exc}"), 500
