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
from statistics import NormalDist
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
from options_pricing import black_scholes
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
    dividend_yield_for_pricing,
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
CONTRACT_MULTIPLIER = 100.0
GENERAL_RISK_FREE_RATE = 0.0375
_NORMAL = NormalDist()

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

# Size, earnings, and open-interest gates the dedicated scanners already
# understand. Open Filters leave them at these zeros; a quality preset
# overwrites them from the General scanner payload.
_QUALITY_RUNNER_KEYS = (
    "min_market_cap",
    "small_cap_min_market_cap",
    "fund_min_aum",
    "min_avg_dollar_volume",
    "exclude_earnings_before_expiry",
    "min_open_interest",
)


def _scan_scope(payload: dict) -> dict:
    """Profile or aggregate the holdings universe should read."""
    scope = {}
    for key in ("profile_id", "aggregate_id"):
        raw = payload.get(key)
        if raw in (None, ""):
            continue
        try:
            scope[key] = int(raw)
        except (TypeError, ValueError):
            pass
    if scope:
        return scope
    try:
        from flask import has_request_context
        if has_request_context():
            if request.args.get("profile_id"):
                scope["profile_id"] = int(request.args["profile_id"])
            if request.args.get("aggregate_id"):
                scope["aggregate_id"] = int(request.args["aggregate_id"])
    except (TypeError, ValueError, RuntimeError):
        pass
    return scope


def _quality_from_payload(payload: dict) -> dict:
    """Copy the General scanner's quality gates onto a dedicated runner."""
    result = {}
    for key in _QUALITY_RUNNER_KEYS:
        if key not in payload or payload.get(key) is None:
            continue
        if key == "exclude_earnings_before_expiry":
            result[key] = bool(payload.get(key))
            continue
        number = _num(payload.get(key))
        if number is None:
            continue
        result[key] = max(0, int(number)) if key == "min_open_interest" else max(0.0, number)
    return result


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
    return result[:200]


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


def _first_num(*values):
    for value in values:
        number = _num(value)
        if number is not None:
            return number
    return None


def _runner_payload(strategy: str, payload: dict) -> dict:
    spec = STRATEGIES[strategy]
    symbols = _symbols(payload.get("symbols"))
    scope = _scan_scope(payload)
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
        if strategy == "covered-call":
            if payload.get("require_shares_held") is not None:
                result["require_shares_held"] = bool(payload.get("require_shares_held"))
            if payload.get("respect_cost_basis") is not None:
                result["respect_cost_basis"] = bool(payload.get("respect_cost_basis"))
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
            **scope,
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
                **scope,
            })
        result["tickers"] = ",".join(selected)
    result.update(_quality_from_payload(payload))
    result.update(scope)
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
        values = [
            _num(leg.get("strike")) for leg in legs
            if isinstance(leg, dict)
            and str(leg.get("option_type") or leg.get("type") or "").lower() != "stock"
        ]
        values = [value for value in values if value is not None and value > 0]
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


def _position_leg(
    source: dict | None,
    *,
    option_type: str,
    quantity,
    expiration=None,
    strike=None,
) -> dict | None:
    """Normalize one scanner leg for position-wide table calculations."""
    source = source if isinstance(source, dict) else {}
    kind = str(option_type or source.get("option_type") or source.get("type") or "").lower()
    if kind not in {"call", "put", "stock"}:
        return None
    qty = _num(quantity)
    if qty in (None, 0):
        return None
    if kind == "stock":
        entry_price = _first_num(
            source.get("entry_price"), source.get("basis"), source.get("mid")
        )
        return {
            "option_type": "stock",
            "quantity": qty,
            "entry_price": entry_price,
            "delta": _first_num(source.get("delta"), 1.0),
            "volume": None,
        }
    normalized_strike = _first_num(strike, source.get("strike"))
    normalized_expiration = expiration or source.get("expiration")
    if normalized_strike is None or normalized_strike <= 0 or not normalized_expiration:
        return None
    return {
        "option_type": kind,
        "quantity": qty,
        "strike": normalized_strike,
        "expiration": str(normalized_expiration),
        "entry_price": _first_num(
            source.get("entry_price"), source.get("mid"), source.get("last"),
            source.get("ask"), source.get("bid"),
        ),
        "bid": _num(source.get("bid")),
        "ask": _num(source.get("ask")),
        "iv": _first_num(source.get("iv"), source.get("implied_volatility")),
        "delta": _num(source.get("delta")),
        "volume": _num(source.get("volume")),
        "open_interest": _first_num(
            source.get("open_interest"), source.get("openInterest")
        ),
    }


def _position_legs(strategy: str, row: dict) -> list[dict]:
    """Return the exact signed position represented by any supported scanner.

    This mirrors the scanner-to-Strategy-Lab handoff.  Keeping the signs and
    quantities here lets the common table calculate the same payoff regardless
    of which legacy scanner produced the row.
    """
    spread = row.get("spread") if isinstance(row.get("spread"), dict) else {}
    expiration = _nested(
        row, "spread.expiration", "call.expiration", "put.expiration", "expiration"
    )

    explicit = spread.get("legs") or row.get("legs")
    if isinstance(explicit, list) and explicit:
        result = []
        for leg in explicit:
            if not isinstance(leg, dict):
                continue
            kind = str(leg.get("option_type") or leg.get("type") or "").lower()
            quantity = _first_num(leg.get("qty"), leg.get("quantity"))
            normalized = _position_leg(
                leg,
                option_type=kind,
                quantity=quantity,
                expiration=leg.get("expiration") or expiration,
                strike=leg.get("strike"),
            )
            if normalized:
                result.append(normalized)
        if result:
            return result

    result: list[dict] = []

    def add(source, kind, quantity, strike=None):
        normalized = _position_leg(
            source,
            option_type=kind,
            quantity=quantity,
            expiration=expiration,
            strike=strike,
        )
        if normalized:
            result.append(normalized)

    if strategy == "cash-secured-put":
        add(row.get("put"), "put", -1, _nested(row, "put.strike"))
    elif strategy == "covered-call":
        basis = _first_num(row.get("cost_basis"), row.get("price"))
        add({"entry_price": basis, "delta": 1}, "stock", 100)
        add(row.get("call"), "call", -1, _nested(row, "call.strike"))
    elif strategy == "bull-put-spread":
        add(spread.get("short_leg"), "put", -1, spread.get("short_strike"))
        add(spread.get("long_leg"), "put", 1, spread.get("long_strike"))
    elif strategy == "bear-put-spread":
        add(spread.get("long_leg"), "put", 1, spread.get("long_strike"))
        add(spread.get("short_leg"), "put", -1, spread.get("short_strike"))
    elif strategy == "bear-call-spread":
        add(spread.get("short_leg"), "call", -1, spread.get("short_strike"))
        add(spread.get("long_leg"), "call", 1, spread.get("long_strike"))
    elif strategy == "iron-condor":
        quantity = abs(_first_num(spread.get("quantity"), 1) or 1)
        add(spread.get("put_leg_long"), "put", quantity, spread.get("put_long_strike"))
        add(spread.get("put_leg_short"), "put", -quantity, spread.get("put_short_strike"))
        add(spread.get("call_leg_short"), "call", -quantity, spread.get("call_short_strike"))
        add(spread.get("call_leg_long"), "call", quantity, spread.get("call_long_strike"))
    elif strategy == "iron-butterfly":
        quantity = abs(_first_num(row.get("quantity"), 1) or 1)
        add(row.get("put_long_leg"), "put", quantity, row.get("put_long_strike"))
        add(row.get("put_short_leg"), "put", -quantity, row.get("body_strike"))
        add(row.get("call_short_leg"), "call", -quantity, row.get("body_strike"))
        add(row.get("call_long_leg"), "call", quantity, row.get("call_long_strike"))
    elif strategy in {"put-condor", "unbalanced-put-condor"}:
        bought = abs(_first_num(row.get("bought_quantity"), 1) or 1)
        sold = abs(_first_num(row.get("sold_quantity"), 1) or 1)
        add(row.get("upper_long_leg"), "put", bought, row.get("upper_long_strike"))
        add(row.get("upper_short_leg"), "put", -bought, row.get("upper_short_strike"))
        add(row.get("lower_short_leg"), "put", -sold, row.get("lower_short_strike"))
        add(row.get("lower_long_leg"), "put", sold, row.get("lower_long_strike"))
    elif strategy == "call-condor":
        add(row.get("debit_long_leg"), "call", 1, row.get("debit_long_strike"))
        add(row.get("debit_short_leg"), "call", -1, row.get("debit_short_strike"))
        add(row.get("credit_short_leg"), "call", -1, row.get("credit_short_strike"))
        add(row.get("credit_long_leg"), "call", 1, row.get("credit_long_strike"))
    elif strategy in {
        "unbalanced-butterfly", "double-hedge-put-butterfly",
        "road-trip-butterfly", "sixty-forty-twenty-fly",
    }:
        upper_qty = abs(_first_num(row.get("upper_long_quantity"), 1) or 1)
        body_qty = abs(_first_num(row.get("body_short_quantity"), 2) or 2)
        lower_qty = abs(_first_num(row.get("lower_long_quantity"), 1) or 1)
        add(row.get("upper_long_leg"), "put", upper_qty, row.get("upper_long_strike"))
        add(row.get("body_short_leg"), "put", -body_qty, row.get("body_short_strike"))
        add(row.get("lower_long_leg"), "put", lower_qty, row.get("lower_long_strike"))
    return result


def _position_payoff(legs: list[dict], terminal_price: float) -> float | None:
    total = 0.0
    for leg in legs:
        quantity = _num(leg.get("quantity"))
        entry = _num(leg.get("entry_price"))
        kind = str(leg.get("option_type") or "").lower()
        if quantity is None or entry is None:
            return None
        if kind == "stock":
            total += quantity * (terminal_price - entry)
            continue
        strike = _num(leg.get("strike"))
        if strike is None:
            return None
        intrinsic = (
            max(terminal_price - strike, 0.0)
            if kind == "call" else max(strike - terminal_price, 0.0)
        )
        total += quantity * (intrinsic - entry) * CONTRACT_MULTIPLIER
    return total


def _terminal_cdf(price: float | None, *, spot: float, years: float, volatility: float,
                  risk_free_rate: float, dividend_yield: float) -> float:
    if price is None:
        return 1.0
    if price <= 0:
        return 0.0
    sigma_root_t = volatility * math.sqrt(years)
    z_score = (
        math.log(price / spot)
        - (risk_free_rate - dividend_yield - 0.5 * volatility * volatility) * years
    ) / sigma_root_t
    return _NORMAL.cdf(z_score)


def _position_profile(legs: list[dict], spot, dte, distribution_iv,
                      risk_free_rate=GENERAL_RISK_FREE_RATE, dividend_yield=0.0) -> dict:
    """Calculate expiration risk and probabilities for a same-expiry position."""
    empty = {
        "max_profit": None, "max_loss": None,
        "max_profit_unbounded": False, "max_loss_unbounded": False,
        "prob_max_profit": None, "prob_max_loss": None,
        "expected_value": None,
    }
    spot = _num(spot)
    dte = _num(dte)
    volatility = _num(distribution_iv)
    rate = _first_num(risk_free_rate, GENERAL_RISK_FREE_RATE)
    yield_number = _first_num(dividend_yield, 0.0)
    option_legs = [leg for leg in legs if leg.get("option_type") != "stock"]
    expirations = {str(leg.get("expiration") or "") for leg in option_legs}
    if (
        not legs or not option_legs or len(expirations) != 1
        or spot is None or spot <= 0 or dte is None or dte <= 0
        or volatility is None or volatility <= 0
    ):
        return empty
    if volatility > 3:
        volatility /= 100.0
    if yield_number > 1:
        yield_number /= 100.0
    if rate is None or rate < -1 or rate > 1 or yield_number < -1 or yield_number > 1:
        return empty
    if any(_num(leg.get("entry_price")) is None for leg in legs):
        return empty

    strikes = sorted({
        float(leg["strike"]) for leg in option_legs
        if _num(leg.get("strike")) is not None
    })
    if not strikes:
        return empty
    breakpoints = [0.0, *strikes]
    payoffs = [_position_payoff(legs, price) for price in breakpoints]
    if any(value is None for value in payoffs):
        return empty
    high_slope = sum(
        (_num(leg.get("quantity")) or 0.0) * CONTRACT_MULTIPLIER
        for leg in option_legs if leg.get("option_type") == "call"
    ) + sum(
        _num(leg.get("quantity")) or 0.0
        for leg in legs if leg.get("option_type") == "stock"
    )
    max_profit_unbounded = high_slope > 1e-9
    max_loss_unbounded = high_slope < -1e-9
    max_profit = None if max_profit_unbounded else max(payoffs)
    max_loss = None if max_loss_unbounded else max(0.0, -min(payoffs))

    years = max(dte, 1.0) / 365.0
    expected_terminal = spot * math.exp((rate - yield_number) * years)
    expected_value = 0.0
    for leg in legs:
        quantity = float(leg["quantity"])
        entry = float(leg["entry_price"])
        kind = leg["option_type"]
        if kind == "stock":
            expected_value += quantity * (expected_terminal - entry)
            continue
        modeled = black_scholes(
            spot, float(leg["strike"]), years, rate, yield_number, volatility, kind
        )
        expected_intrinsic = float(modeled["price"]) * math.exp(rate * years)
        expected_value += quantity * (expected_intrinsic - entry) * CONTRACT_MULTIPLIER

    intervals = []
    for index, low in enumerate(breakpoints):
        high = breakpoints[index + 1] if index + 1 < len(breakpoints) else None
        probe = low + 1.0 if high is None else (low + high) / 2.0
        slope = sum(
            (_num(leg.get("quantity")) or 0.0)
            * (1.0 if leg.get("option_type") == "stock" else CONTRACT_MULTIPLIER)
            for leg in legs
            if leg.get("option_type") == "stock"
            or (leg.get("option_type") == "call" and probe > float(leg["strike"]))
        ) - sum(
            (_num(leg.get("quantity")) or 0.0) * CONTRACT_MULTIPLIER
            for leg in option_legs
            if leg.get("option_type") == "put" and probe < float(leg["strike"])
        )
        payoff = _position_payoff(legs, probe)
        probability = _terminal_cdf(
            high, spot=spot, years=years, volatility=volatility,
            risk_free_rate=rate, dividend_yield=yield_number,
        ) - _terminal_cdf(
            low, spot=spot, years=years, volatility=volatility,
            risk_free_rate=rate, dividend_yield=yield_number,
        )
        intervals.append((slope, payoff, max(0.0, probability)))

    tolerance = 1e-6
    prob_max_profit = None if max_profit is None else 100.0 * sum(
        probability for slope, payoff, probability in intervals
        if abs(slope) <= tolerance and abs((payoff or 0.0) - max_profit) <= tolerance
    )
    prob_max_loss = None if max_loss is None else 100.0 * sum(
        probability for slope, payoff, probability in intervals
        if abs(slope) <= tolerance and abs((payoff or 0.0) + max_loss) <= tolerance
    )
    return {
        "max_profit": round(max_profit, 2) if max_profit is not None else None,
        "max_loss": round(max_loss, 2) if max_loss is not None else None,
        "max_profit_unbounded": max_profit_unbounded,
        "max_loss_unbounded": max_loss_unbounded,
        "prob_max_profit": round(prob_max_profit, 2) if prob_max_profit is not None else None,
        "prob_max_loss": round(prob_max_loss, 2) if prob_max_loss is not None else None,
        "expected_value": round(expected_value, 2),
    }


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
    trade_kind = _trade_kind(strategy, row)
    expiration = _nested(
        row, "spread.expiration", "call.expiration", "put.expiration", "expiration"
    )
    dte = _num(_nested(row, "spread.dte", "call.dte", "put.dte", "dte"))
    if dte is None and expiration:
        expiration_day = _as_day(expiration)
        if expiration_day is not None:
            dte = float((expiration_day - date.today()).days)
    price = _num(row.get("price"))
    atm_iv = _num(_nested(
        row, "spread.atm_iv", "call.atm_iv", "put.atm_iv", "atm_iv", "iv",
        "distribution_iv", "probability_iv",
    ))
    position_legs = _position_legs(trade_kind, row)
    if atm_iv is None and price is not None:
        iv_legs = [
            leg for leg in position_legs
            if leg.get("option_type") != "stock" and _num(leg.get("iv")) is not None
        ]
        if iv_legs:
            atm_leg = min(iv_legs, key=lambda leg: abs((_num(leg.get("strike")) or price) - price))
            atm_iv = _num(atm_leg.get("iv"))
    profile = _position_profile(
        position_legs, price, dte, atm_iv,
        _nested(row, "spread.risk_free_rate", "risk_free_rate"),
        _nested(row, "spread.dividend_yield", "dividend_yield"),
    )
    max_profit = _num(_nested(
        row, "spread.max_profit_dollars", "spread.max_profit", "max_profit_dollars",
        "max_profit", "premium_dollars", "call.premium_dollars", "put.premium_dollars",
    ))
    max_loss = _num(_nested(
        row, "spread.max_loss_dollars", "spread.max_loss", "max_loss_dollars",
        "max_loss", "cash_required", "put.cash_required",
    ))
    # The one-leg income scanners historically exposed collateral and premium,
    # not the actual position-wide payoff extrema.  Use the exact expiration
    # profile so the columns mean the same thing for every strategy.
    if trade_kind in {"cash-secured-put", "covered-call"}:
        max_profit = profile["max_profit"] if profile["max_profit"] is not None else max_profit
        max_loss = profile["max_loss"] if profile["max_loss"] is not None else max_loss
    else:
        max_profit = max_profit if max_profit is not None else profile["max_profit"]
        max_loss = max_loss if max_loss is not None else profile["max_loss"]
    ratio = _num(_nested(
        row, "spread.profit_ratio_pct", "spread.reward_risk", "profit_ratio_pct",
        "reward_risk", "return_on_risk_pct",
    ))
    if trade_kind in {"cash-secured-put", "covered-call"}:
        ratio = None
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
    profit_capture = _nested(row, "spread.profit_capture", "profit_capture")
    if not isinstance(profit_capture, dict):
        profit_capture = None
    price_scenarios = _nested(row, "spread.price_scenarios", "price_scenarios")
    if not isinstance(price_scenarios, dict):
        price_scenarios = None
    expiration_probability = next((
        point for point in probability_schedule
        if isinstance(point, dict)
        and (point.get("kind") == "expiration" or point.get("remaining_dte") == 0)
    ), {})
    prob_success = _num(_nested(
        row, "spread.prob_success", "prob_success",
        "spread.prob_profit", "prob_profit", "probability_profit_pct",
        "probability_of_profit",
    ))
    if prob_success is None:
        prob_success = _num(expiration_probability.get("probability_success_pct"))
    prob_failure = _num(_nested(
        row, "spread.prob_failure", "prob_failure",
        "spread.prob_loss", "prob_loss", "probability_loss_pct",
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
    if prob_max_profit is None:
        prob_max_profit = profile["prob_max_profit"]
    prob_max_loss = _num(_nested(
        row, "spread.prob_max_loss", "prob_max_loss", "probability_max_loss_pct"
    ))
    if prob_max_loss is None:
        prob_max_loss = profile["prob_max_loss"]
    prob_touch = _num(_nested(row, "spread.prob_touch", "prob_touch"))
    if prob_touch is None and prob_itm is not None:
        prob_touch = min(100.0, 2.0 * prob_itm)
    legs = position_legs or _option_legs(row)
    open_interest_values = [
        oi
        for leg in legs
        if str(leg.get("option_type") or "").lower() != "stock"
        and (oi := _first_num(leg.get("open_interest"), leg.get("openInterest"))) is not None
    ]
    min_leg_open_interest = min(open_interest_values) if open_interest_values else None
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
    total_option_volume = _num(_nested(
        row, "spread.total_option_volume", "call.total_option_volume",
        "put.total_option_volume", "total_option_volume", "option_volume",
    ))
    total_option_volume_source = "chain" if total_option_volume is not None else None
    if total_option_volume is None:
        leg_volumes = [
            _num(leg.get("volume")) for leg in position_legs
            if leg.get("option_type") != "stock" and _num(leg.get("volume")) is not None
        ]
        if leg_volumes:
            total_option_volume = sum(leg_volumes)
            total_option_volume_source = "selected_legs"
    position_delta = _num(_nested(
        row, "spread.position_delta", "spread.net_delta", "position_delta", "net_delta", "delta"
    ))
    if position_delta is None and position_legs and all(
        _num(leg.get("delta")) is not None for leg in position_legs
    ):
        position_delta = sum(
            float(leg["quantity"]) * float(leg["delta"])
            * (1.0 if leg.get("option_type") == "stock" else CONTRACT_MULTIPLIER)
            for leg in position_legs
        )
    expected_value = _num(_nested(
        row, "spread.expected_value_dollars", "spread.expected_value",
        "expected_value_dollars", "expected_value",
    ))
    if expected_value is None:
        expected_value = profile["expected_value"]
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
        "expiration": expiration,
        "dte": dte,
        "strikes": _strike_summary(row),
        "iv_rank": _num(row.get("iv_rank")) or _num(row.get("iv_rank_effective")),
        "iv_rank_source": row.get("iv_rank_source"),
        "iv_rank_observations": int(_num(row.get("iv_rank_observations")) or 0),
        "atm_iv": atm_iv,
        "risk_free_rate": _first_num(
            _nested(row, "spread.risk_free_rate", "risk_free_rate"),
            GENERAL_RISK_FREE_RATE,
        ),
        "dividend_yield": _first_num(
            _nested(row, "spread.dividend_yield", "dividend_yield")
        ),
        "rv": None,
        "rv_rank": None,
        "iv_rv": None,
        "iv_rv_rank": None,
        "iv_rv_observations": 0,
        "volatility_score": None,
        "volatility_score_provisional": False,
        "volatility_score_observations": 0,
        "put_skew": _num(_nested(row, "put.put_skew", "call.put_skew", "put_skew")),
        "put_skew_rank": _num(_nested(
            row, "put.put_skew_rank", "call.put_skew_rank", "put_skew_rank"
        )),
        "put_skew_rank_ready": bool(_nested(
            row, "put.put_skew_rank_ready", "call.put_skew_rank_ready",
            "put_skew_rank_ready",
        )),
        "put_skew_rank_observations": int(_num(_nested(
            row, "put.put_skew_rank_observations", "call.put_skew_rank_observations",
            "put_skew_rank_observations",
        )) or 0),
        "call_skew": _num(_nested(row, "call.call_skew", "put.call_skew", "call_skew")),
        "call_skew_rank": _num(_nested(
            row, "call.call_skew_rank", "put.call_skew_rank", "call_skew_rank"
        )),
        "call_skew_rank_ready": bool(_nested(
            row, "call.call_skew_rank_ready", "put.call_skew_rank_ready",
            "call_skew_rank_ready",
        )),
        "call_skew_rank_observations": int(_num(_nested(
            row, "call.call_skew_rank_observations", "put.call_skew_rank_observations",
            "call_skew_rank_observations",
        )) or 0),
        "skew": _num(_nested(row, "call.skew", "put.skew", "skew")),
        "skew_rank": _num(_nested(row, "call.skew_rank", "put.skew_rank", "skew_rank")),
        "skew_rank_ready": bool(_nested(
            row, "call.skew_rank_ready", "put.skew_rank_ready", "skew_rank_ready"
        )),
        "skew_rank_observations": int(_num(_nested(
            row, "call.skew_rank_observations", "put.skew_rank_observations",
            "skew_rank_observations",
        )) or 0),
        "total_option_volume": total_option_volume,
        "total_option_volume_source": total_option_volume_source,
        "min_leg_open_interest": min_leg_open_interest,
        "delta": round(position_delta, 4) if position_delta is not None else None,
        "reference_delta": round(sum(reference_deltas) / len(reference_deltas), 2) if reference_deltas else None,
        "reference_deltas": [round(value, 2) for value in reference_deltas],
        "prob_max_profit": prob_max_profit,
        "prob_max_loss": prob_max_loss,
        "prob_success": prob_success,
        "prob_failure": prob_failure,
        "prob_otm": prob_otm,
        "prob_itm": prob_itm,
        "prob_touch": prob_touch,
        "prob_touch_estimated": prob_touch is not None and _num(_nested(row, "spread.prob_touch", "prob_touch")) is None,
        "prob_touch_put": _num(_nested(row, "spread.prob_touch_put", "prob_touch_put")),
        "prob_touch_call": _num(_nested(row, "spread.prob_touch_call", "prob_touch_call")),
        "probability_schedule": probability_schedule,
        "profit_capture": profit_capture,
        "price_scenarios": price_scenarios,
        "expected_value": expected_value,
        "entry_credit": entry_credit,
        "entry_credit_dollars": entry_credit_dollars,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "max_profit_unbounded": bool(
            _nested(row, "spread.max_profit_unbounded", "max_profit_unbounded")
            or profile["max_profit_unbounded"]
        ),
        "max_loss_unbounded": bool(
            _nested(row, "spread.max_loss_unbounded", "max_loss_unbounded")
            or profile["max_loss_unbounded"]
        ),
        "profit_ratio": ratio,
        "moneyness": moneyness,
        "bid_ask_spread": max(leg_spreads) if leg_spreads else None,
        "return_pct": _num(_nested(row, "call.premium_yield_pct", "put.premium_yield_pct", "premium_yield_pct", "return_pct")),
        "annualized_return_pct": _num(_nested(row, "call.annualized_pct", "put.annualized_pct", "annualized_pct", "annualized_return_pct")),
        "status": row.get("status") or row.get("chain_status") or row.get("candidate_status"),
        "trade_kind": trade_kind,
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
        fund = fundamentals.get(ticker) or {}
        if meta.get("dividend_yield") is None:
            meta["dividend_yield"] = dividend_yield_for_pricing(
                fund, meta.get("price")
            )
        meta["market_cap"] = _num(row.get("market_cap")) or _num(fund.get("market_cap"))
        meta["fund_aum"] = _num(row.get("total_assets")) or _num(fund.get("total_assets"))
        meta["avg_dollar_volume"] = (
            _num(technicals.get("avg_dollar_volume"))
            or _num(row.get("avg_dollar_volume"))
        )
        earnings_day = _as_day(row.get("next_earnings") or fund.get("next_earnings"))
        expiry_day = _as_day(meta.get("expiration"))
        meta["next_earnings"] = earnings_day.isoformat() if earnings_day else None
        if earnings_day is not None and expiry_day is not None:
            meta["earnings_before_expiry"] = earnings_day <= expiry_day
        else:
            meta["earnings_before_expiry"] = None


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
        "atr_14": _num(technicals.get("atr_14")),
        "rv_30": _num(technicals.get("rv_30")),
        "target_mean_price": _num(technicals.get("target_mean_price")),
        "week52_high": _num(technicals.get("week52_high")),
        "week52_low": _num(technicals.get("week52_low")),
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
            history_rank = history.get("rank")
            provisional_rank = history.get("provisional_rank")
            if history_rank is not None:
                meta["iv_rank"] = round(float(history_rank), 1)
                meta["iv_rank_source"] = "history"
            elif provisional_rank is not None:
                meta["iv_rank"] = round(float(provisional_rank), 1)
                meta["iv_rank_source"] = "provisional_history"
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
            observed_day = _as_day(item.get("observed_on"))
            if observed_day == date.today():
                continue
            day_rv = _rv_on_or_before(rv_by_date, item.get("observed_on"))
            spread = calculate_iv_rv(item.get("atm_iv"), day_rv)
            if spread is not None:
                spreads.append(spread)
        iv_rv_observations = len(spreads) + (1 if iv_rv is not None else 0)
        meta["iv_rv_observations"] = iv_rv_observations
        if iv_rv is not None and iv_rv_observations >= 3:
            rank = calculate_percentile_rank(spreads, iv_rv)
            meta["iv_rv_rank"] = round(rank, 1) if rank is not None else None
            meta["iv_rv_rank_ready"] = (
                iv_rv_observations >= MIN_IV_RANK_OBSERVATIONS and rank is not None
            )
        else:
            meta["iv_rv_rank"] = None
            meta["iv_rv_rank_ready"] = False
        iv_rank = _num(meta.get("iv_rank"))
        iv_rv_rank = _num(meta.get("iv_rv_rank"))
        if iv_rank is not None and iv_rv_rank is not None:
            meta["volatility_score"] = round((iv_rank + iv_rv_rank) / 2.0, 1)
            meta["volatility_score_observations"] = min(
                int(meta.get("iv_rank_observations") or 0),
                int(meta.get("iv_rv_observations") or 0),
            )
            meta["volatility_score_provisional"] = not (
                meta.get("iv_rank_source") == "history"
                and meta.get("iv_rv_rank_ready")
            )
        else:
            meta["volatility_score"] = None
            meta["volatility_score_observations"] = 0
            meta["volatility_score_provisional"] = False


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
        ("skew_rank", "min_skew_rank", "Skew Rank", "min"),
        ("skew_rank", "max_skew_rank", "Skew Rank", "max"),
        ("min_leg_open_interest", "min_open_interest", "Open interest", "min"),
        ("avg_dollar_volume", "min_avg_dollar_volume", "Share dollar volume", "min"),
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
    min_cap = _num(payload.get("min_market_cap")) or 0.0
    if min_cap > 0 and not is_fund:
        cap = _num(meta.get("market_cap"))
        if cap is not None and cap < min_cap:
            reasons.append("Market cap")
    min_aum = _num(payload.get("fund_min_aum")) or 0.0
    if min_aum > 0 and is_fund:
        aum = _num(meta.get("fund_aum"))
        if aum is not None and aum < min_aum:
            reasons.append("Fund AUM")
    if bool(payload.get("exclude_earnings_before_expiry")) and not is_fund:
        if meta.get("earnings_before_expiry") is True:
            reasons.append("Earnings before expiry")
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
