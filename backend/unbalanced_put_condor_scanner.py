"""Long-dated unbalanced put-condor scanner.

This is deliberately separate from ``iron_condor_scanner``.  An iron condor
sells an OTM put spread and an OTM call spread.  This structure uses four puts
at one expiration:

    BUY  upper long put
    SELL upper short put       purchased (debit) spread
    SELL lower short put
    BUY  lower long put        sold (credit) spread

The two short puts are selected from the practitioner's 15/5, 20/10, and 25/15
delta pairs.  Dollar widths are independent, so 5/10, 10/20, 5/5, and other
combinations are all valid.  Debit- and credit-spread quantities are independent
too, so a 5x debit / 10x credit ratio can be optimized to a flat package delta.
Above the highest strike and below the lowest strike, expiration P/L is
horizontal.  Unequal widths or quantities make the lower flat outcome different
from the upper one.

Endpoints:
  GET  /api/options/unbalanced-put-condor-scan/defaults
  POST /api/options/unbalanced-put-condor-scan
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
import math
import re

import yfinance as yf
from flask import jsonify, request

from put_scanner import (
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    RISK_FREE,
    _clean_tickers,
    _fetch_fundamentals_bulk,
    _load_history,
    _load_put_chain,
    _num,
    _pick_expiration,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)


CONTRACT_MULTIPLIER = 100.0
DELTA_PRESETS = {
    "15/5": (0.15, 0.05),
    "20/10": (0.20, 0.10),
    "25/15": (0.25, 0.15),
}
DEFAULT_TICKERS = ["SPY", "IWM", "GLD", "QQQ"]
DEFAULTS = {
    "tickers": ",".join(DEFAULT_TICKERS),
    "delta_preset": "all",
    "target_dte": 180,
    "min_dte": 120,
    "max_dte": 240,
    "bought_width": 5.0,
    "sold_width": 10.0,
    "bought_quantity": 1,
    "sold_quantity": 1,
    "delta_tolerance": 0.04,
    "target_position_delta": 0.0,
    "position_delta_tolerance": 2.0,
    "width_tolerance_pct": 20.0,
    "min_open_interest": 0,
    "require_upside_credit": False,
    "max_results": 100,
}


def _quotable(leg: dict) -> bool:
    """True when a leg has a live, uncrossed, two-sided market."""
    bid = _num(leg.get("bid"))
    ask = _num(leg.get("ask"))
    mid = _num(leg.get("mid"))
    return bool(
        bid is not None
        and ask is not None
        and mid is not None
        and bid > 0
        and ask >= bid
        and mid > 0
    )


def _leg_view(leg: dict) -> dict:
    return {
        "strike": _round(leg.get("strike")),
        # Preserve half-cent and sub-cent mids.  A 5x/10x ratio amplifies a
        # one-cent per-leg rounding error into a material mismatch between the
        # scanner and Strategy Lab payoff.
        "bid": _round(leg.get("bid"), 4),
        "ask": _round(leg.get("ask"), 4),
        "mid": _round(leg.get("mid"), 4),
        "iv": _round(leg.get("iv"), 4),
        "delta": _round(leg.get("delta"), 4),
        "open_interest": int(_num(leg.get("open_interest"), 0) or 0),
        "volume": int(_num(leg.get("volume"), 0) or 0),
    }


def _position_delta(*legs_and_sides) -> float | None:
    total = 0.0
    for leg, side in legs_and_sides:
        delta = _num(leg.get("delta"))
        if delta is None:
            return None
        total += side * delta
    return total


def _norm_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def _prob_finish_below(
    spot: float,
    barrier: float,
    years: float,
    volatility: float,
    rate: float = RISK_FREE,
    dividend_yield: float = 0.0,
) -> float | None:
    """Risk-neutral terminal probability that price finishes below a barrier."""
    if spot <= 0 or barrier <= 0 or years < 0 or volatility < 0:
        return None
    if years == 0 or volatility == 0:
        terminal = spot * math.exp((rate - dividend_yield) * years)
        return 1.0 if terminal <= barrier else 0.0
    sigma_root_t = volatility * math.sqrt(years)
    log_distance = math.log(spot / barrier)
    log_drift = (rate - dividend_yield - 0.5 * volatility * volatility) * years
    return min(1.0, max(0.0, _norm_cdf((-log_distance - log_drift) / sigma_root_t)))


def _prob_touch_lower(
    spot: float,
    barrier: float,
    years: float,
    volatility: float,
    rate: float = RISK_FREE,
    dividend_yield: float = 0.0,
) -> float | None:
    """GBM first-passage probability of touching a lower barrier before expiry."""
    if spot <= 0 or barrier <= 0 or years < 0 or volatility < 0:
        return None
    if barrier >= spot:
        return 1.0
    if years == 0 or volatility == 0:
        return 0.0

    x = math.log(spot / barrier)
    sigma_root_t = volatility * math.sqrt(years)
    log_drift_rate = rate - dividend_yield - 0.5 * volatility * volatility
    drift_t = log_drift_rate * years
    terminal_below = _norm_cdf((-x - drift_t) / sigma_root_t)
    reflection = math.exp(
        max(-700.0, min(700.0, -2.0 * log_drift_rate * x / (volatility * volatility)))
    ) * _norm_cdf((-x + drift_t) / sigma_root_t)
    return min(1.0, max(0.0, terminal_below + reflection))


def _build_put_condor(
    upper_long: dict,
    upper_short: dict,
    lower_short: dict,
    lower_long: dict,
    spot: float,
    expiration: str,
    dte: int,
    preset: str,
    target_upper_delta: float,
    target_lower_delta: float,
    bought_quantity: int = 1,
    sold_quantity: int = 1,
    dividend_yield: float = 0.0,
) -> dict | None:
    """Calculate expiration outcomes for one four-put structure."""
    k1 = _num(upper_long.get("strike"))
    k2 = _num(upper_short.get("strike"))
    k3 = _num(lower_short.get("strike"))
    k4 = _num(lower_long.get("strike"))
    if not all(value is not None and value > 0 for value in (k1, k2, k3, k4)):
        return None
    if not (k4 < k3 < k2 < k1):
        return None

    bought_width = k1 - k2
    sold_width = k3 - k4
    bought_debit_per_spread = (
        (_num(upper_long.get("mid"), 0.0) or 0.0)
        - (_num(upper_short.get("mid"), 0.0) or 0.0)
    )
    sold_credit_per_spread = (
        (_num(lower_short.get("mid"), 0.0) or 0.0)
        - (_num(lower_long.get("mid"), 0.0) or 0.0)
    )
    if bought_debit_per_spread <= 0 or sold_credit_per_spread <= 0:
        return None
    bought_quantity = max(1, int(bought_quantity))
    sold_quantity = max(1, int(sold_quantity))
    bought_debit = bought_debit_per_spread * bought_quantity
    sold_credit = sold_credit_per_spread * sold_quantity

    # Positive is a credit received; negative is a debit paid.
    entry_credit = sold_credit - bought_debit
    upper_flat = entry_credit
    center_profit = entry_credit + bought_width * bought_quantity
    lower_flat = (
        entry_credit
        + bought_width * bought_quantity
        - sold_width * sold_quantity
    )
    max_profit = max(upper_flat, center_profit, lower_flat)
    max_loss = max(0.0, -min(upper_flat, center_profit, lower_flat))
    if max_profit <= 0:
        return None

    lower_breakeven = None
    if lower_flat < 0 < center_profit:
        lower_breakeven = k3 - center_profit / sold_quantity
    upper_breakeven = None
    if upper_flat < 0 < center_profit:
        upper_breakeven = k1 + entry_credit / bought_quantity

    natural_credit = (
        bought_quantity * (
            (_num(upper_short.get("bid"), 0.0) or 0.0)
            - (_num(upper_long.get("ask"), 0.0) or 0.0)
        )
        + sold_quantity * (
            (_num(lower_short.get("bid"), 0.0) or 0.0)
            - (_num(lower_long.get("ask"), 0.0) or 0.0)
        )
    )
    execution_cost = (
        bought_quantity * sum(
            (_num(leg.get("ask"), 0.0) or 0.0)
            - (_num(leg.get("bid"), 0.0) or 0.0)
            for leg in (upper_long, upper_short)
        )
        + sold_quantity * sum(
            (_num(leg.get("ask"), 0.0) or 0.0)
            - (_num(leg.get("bid"), 0.0) or 0.0)
            for leg in (lower_short, lower_long)
        )
    )

    actual_upper_delta = abs(_num(upper_short.get("delta"), 0.0) or 0.0)
    actual_lower_delta = abs(_num(lower_short.get("delta"), 0.0) or 0.0)
    upper_delta_error = abs(actual_upper_delta - target_upper_delta)
    lower_delta_error = abs(actual_lower_delta - target_lower_delta)
    oi_min = min(
        int(_num(leg.get("open_interest"), 0) or 0)
        for leg in (upper_long, upper_short, lower_short, lower_long)
    )
    volume_min = min(
        int(_num(leg.get("volume"), 0) or 0)
        for leg in (upper_long, upper_short, lower_short, lower_long)
    )
    raw_position_delta = _position_delta(
        (upper_long, bought_quantity),
        (upper_short, -bought_quantity),
        (lower_short, -sold_quantity),
        (lower_long, sold_quantity),
    )
    probability_iv = _num(lower_short.get("iv"))
    years = max(int(dte), 0) / 365.0
    if probability_iv is not None and probability_iv > 0:
        prob_touch_lower_short = _prob_touch_lower(
            spot,
            k3,
            years,
            probability_iv,
            RISK_FREE,
            dividend_yield,
        )
        prob_touch_lower_long = _prob_touch_lower(
            spot,
            k4,
            years,
            probability_iv,
            RISK_FREE,
            dividend_yield,
        )
        prob_finish_below_lower_short = _prob_finish_below(
            spot,
            k3,
            years,
            probability_iv,
            RISK_FREE,
            dividend_yield,
        )
        prob_finish_below_lower_long = _prob_finish_below(
            spot,
            k4,
            years,
            probability_iv,
            RISK_FREE,
            dividend_yield,
        )
    else:
        prob_touch_lower_short = None
        prob_touch_lower_long = None
        prob_finish_below_lower_short = None
        prob_finish_below_lower_long = None
    lower_short_distance_sigma = (
        math.log(spot / k3) / (probability_iv * math.sqrt(years))
        if spot > k3 and probability_iv is not None and probability_iv > 0 and years > 0 else None
    )

    return {
        "expiration": expiration,
        "dte": int(dte),
        "preset": preset,
        "target_upper_short_delta": target_upper_delta,
        "target_lower_short_delta": target_lower_delta,
        "actual_upper_short_delta": actual_upper_delta,
        "actual_lower_short_delta": actual_lower_delta,
        "upper_delta_error": upper_delta_error,
        "lower_delta_error": lower_delta_error,
        "delta_gap": actual_upper_delta - actual_lower_delta,
        # Practitioners normally quote a one-lot position delta in share
        # equivalents: +1.5 means the four-leg package behaves like 1.5 long
        # shares for a small price move.  Keep the raw option-scale value too so
        # the risk graph and tests never have to infer units.
        "position_delta": (
            raw_position_delta * CONTRACT_MULTIPLIER
            if raw_position_delta is not None else None
        ),
        "position_delta_per_share": raw_position_delta,
        "upper_long_strike": k1,
        "upper_short_strike": k2,
        "lower_short_strike": k3,
        "lower_long_strike": k4,
        "bought_width": bought_width,
        "sold_width": sold_width,
        "bought_quantity": bought_quantity,
        "sold_quantity": sold_quantity,
        "bought_debit_per_spread": bought_debit_per_spread,
        "sold_credit_per_spread": sold_credit_per_spread,
        "bought_debit": bought_debit,
        "sold_credit": sold_credit,
        "entry_credit": entry_credit,
        "entry_debit": max(0.0, -entry_credit),
        "natural_credit": natural_credit,
        "execution_cost": execution_cost,
        "bought_debit_dollars": bought_debit * CONTRACT_MULTIPLIER,
        "sold_credit_dollars": sold_credit * CONTRACT_MULTIPLIER,
        "entry_credit_dollars": entry_credit * CONTRACT_MULTIPLIER,
        "entry_debit_dollars": max(0.0, -entry_credit) * CONTRACT_MULTIPLIER,
        "natural_credit_dollars": natural_credit * CONTRACT_MULTIPLIER,
        "execution_cost_dollars": execution_cost * CONTRACT_MULTIPLIER,
        "upper_flat_outcome": upper_flat,
        "center_max_profit": center_profit,
        "lower_flat_outcome": lower_flat,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "max_profit_dollars": max_profit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": max_loss * CONTRACT_MULTIPLIER,
        "upper_flat_dollars": upper_flat * CONTRACT_MULTIPLIER,
        "lower_flat_dollars": lower_flat * CONTRACT_MULTIPLIER,
        "return_on_risk_pct": (
            max_profit / max_loss * 100.0 if max_loss > 0 else None
        ),
        "lower_breakeven": lower_breakeven,
        "upper_breakeven": upper_breakeven,
        "lower_breakeven_cushion_pct": (
            (spot - lower_breakeven) / spot * 100.0
            if lower_breakeven is not None and spot > 0 else None
        ),
        "prob_touch_lower_short_pct": (
            prob_touch_lower_short * 100.0
            if prob_touch_lower_short is not None else None
        ),
        "prob_touch_lower_long_pct": (
            prob_touch_lower_long * 100.0
            if prob_touch_lower_long is not None else None
        ),
        "prob_finish_below_lower_short_pct": (
            prob_finish_below_lower_short * 100.0
            if prob_finish_below_lower_short is not None else None
        ),
        "prob_finish_below_lower_long_pct": (
            prob_finish_below_lower_long * 100.0
            if prob_finish_below_lower_long is not None else None
        ),
        "probability_iv": probability_iv,
        "lower_short_distance_pct": (
            (spot - k3) / spot * 100.0 if spot > 0 else None
        ),
        "lower_short_distance_sigma": lower_short_distance_sigma,
        "open_interest_min": oi_min,
        "volume_min": volume_min,
        "upper_long_leg": _leg_view(upper_long),
        "upper_short_leg": _leg_view(upper_short),
        "lower_short_leg": _leg_view(lower_short),
        "lower_long_leg": _leg_view(lower_long),
    }


def _nearest_width_leg(
    legs: list[dict],
    target_strike: float,
    *,
    above: float | None = None,
    below: float | None = None,
) -> dict | None:
    pool = [
        leg for leg in legs
        if (above is None or leg["strike"] > above)
        and (below is None or leg["strike"] < below)
    ]
    if not pool:
        return None
    return min(pool, key=lambda leg: abs(leg["strike"] - target_strike))


def _preset_names(value) -> list[str]:
    if value is None or str(value).strip().lower() == "all":
        return list(DELTA_PRESETS)
    if isinstance(value, (list, tuple)):
        requested = [str(item).strip() for item in value]
    else:
        requested = [part.strip() for part in str(value).split(",")]
    names = [name for name in requested if name in DELTA_PRESETS]
    if not names:
        raise ValueError("delta_preset must be all, 15/5, 20/10, or 25/15")
    return names


def _candidate_quality(candidate: dict) -> tuple:
    """Sort exact delta/width matches first, then execution quality."""
    return (
        candidate["upper_delta_error"] + candidate["lower_delta_error"],
        candidate["width_error_pct"],
        0 if candidate["natural_credit"] >= 0 else 1,
        -candidate["open_interest_min"],
        -candidate["center_max_profit"],
    )


def _choose_candidate(
    candidates: list[dict],
    *,
    target_position_delta: float,
    delta_tolerance: float,
    width_tolerance_pct: float,
    min_open_interest: int,
    require_upside_credit: bool,
) -> dict | None:
    """Choose by whole-position delta after enforcing structural constraints."""
    if not candidates:
        return None
    structurally_passing = [
        candidate for candidate in candidates
        if candidate["upper_delta_error"] <= delta_tolerance
        and candidate["lower_delta_error"] <= delta_tolerance
        and candidate["width_error_pct"] <= width_tolerance_pct
        and candidate["open_interest_min"] >= min_open_interest
        and (
            not require_upside_credit
            or candidate["entry_credit"] >= 0
        )
    ]
    pool = structurally_passing or candidates
    return min(
        pool,
        key=lambda candidate: (
            abs(
                (candidate.get("position_delta") or 0.0)
                - target_position_delta
            ),
            *_candidate_quality(candidate),
        ),
    )


def _candidates_for_preset(
    puts: list[dict],
    spot: float,
    expiration: str,
    dte: int,
    preset: str,
    bought_width: float,
    sold_width: float,
    bought_quantity: int,
    sold_quantity: int,
    dividend_yield: float,
) -> list[dict]:
    target_upper, target_lower = DELTA_PRESETS[preset]
    legs = [
        leg for leg in puts
        if _quotable(leg)
        and leg.get("delta") is not None
        and 0 < leg["strike"] < spot
    ]
    if len(legs) < 4:
        return []

    upper_shorts = sorted(
        legs,
        key=lambda leg: abs(abs(leg["delta"]) - target_upper),
    )[:8]
    lower_shorts = sorted(
        legs,
        key=lambda leg: abs(abs(leg["delta"]) - target_lower),
    )[:8]

    candidates = []
    for upper_short in upper_shorts:
        upper_long = _nearest_width_leg(
            legs,
            upper_short["strike"] + bought_width,
            above=upper_short["strike"],
            below=spot,
        )
        if not upper_long:
            continue
        for lower_short in lower_shorts:
            if lower_short["strike"] >= upper_short["strike"]:
                continue
            lower_long = _nearest_width_leg(
                legs,
                lower_short["strike"] - sold_width,
                below=lower_short["strike"],
            )
            if not lower_long:
                continue
            candidate = _build_put_condor(
                upper_long,
                upper_short,
                lower_short,
                lower_long,
                spot,
                expiration,
                dte,
                preset,
                target_upper,
                target_lower,
                bought_quantity,
                sold_quantity,
                dividend_yield,
            )
            if not candidate:
                continue
            bought_error = abs(candidate["bought_width"] - bought_width) / bought_width
            sold_error = abs(candidate["sold_width"] - sold_width) / sold_width
            candidate["bought_width_error_pct"] = bought_error * 100.0
            candidate["sold_width_error_pct"] = sold_error * 100.0
            candidate["width_error_pct"] = max(bought_error, sold_error) * 100.0
            candidates.append(candidate)
    candidates.sort(key=_candidate_quality)
    return candidates


def _round_candidate(candidate: dict) -> dict:
    out = dict(candidate)
    for key, decimals in (
        ("target_upper_short_delta", 2),
        ("target_lower_short_delta", 2),
        ("actual_upper_short_delta", 3),
        ("actual_lower_short_delta", 3),
        ("upper_delta_error", 3),
        ("lower_delta_error", 3),
        ("delta_gap", 3),
        ("position_delta", 2),
        ("position_delta_per_share", 4),
        ("target_position_delta", 2),
        ("position_delta_error", 2),
        ("upper_long_strike", 2),
        ("upper_short_strike", 2),
        ("lower_short_strike", 2),
        ("lower_long_strike", 2),
        ("bought_width", 2),
        ("sold_width", 2),
        ("bought_width_error_pct", 1),
        ("sold_width_error_pct", 1),
        ("width_error_pct", 1),
        ("bought_debit_per_spread", 2),
        ("sold_credit_per_spread", 2),
        ("bought_debit", 2),
        ("sold_credit", 2),
        ("entry_credit", 2),
        ("entry_debit", 2),
        ("natural_credit", 2),
        ("execution_cost", 2),
        ("bought_debit_dollars", 0),
        ("sold_credit_dollars", 0),
        ("entry_credit_dollars", 0),
        ("entry_debit_dollars", 0),
        ("natural_credit_dollars", 0),
        ("execution_cost_dollars", 0),
        ("upper_flat_outcome", 2),
        ("center_max_profit", 2),
        ("lower_flat_outcome", 2),
        ("max_profit", 2),
        ("max_loss", 2),
        ("max_profit_dollars", 0),
        ("max_loss_dollars", 0),
        ("upper_flat_dollars", 0),
        ("lower_flat_dollars", 0),
        ("return_on_risk_pct", 1),
        ("lower_breakeven", 2),
        ("upper_breakeven", 2),
        ("lower_breakeven_cushion_pct", 1),
        ("prob_touch_lower_short_pct", 1),
        ("prob_touch_lower_long_pct", 1),
        ("prob_finish_below_lower_short_pct", 1),
        ("prob_finish_below_lower_long_pct", 1),
        ("probability_iv", 4),
        ("lower_short_distance_pct", 1),
        ("lower_short_distance_sigma", 2),
    ):
        out[key] = _round(out.get(key), decimals)
    return out


def _ticker_list(raw) -> list[str]:
    if isinstance(raw, str):
        raw = re.split(r"[\s,;]+", raw)
    tickers = _clean_tickers(raw)
    return tickers[:50]


def run_unbalanced_put_condor_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    presets = _preset_names(p.get("delta_preset"))
    target_dte = max(
        MIN_TARGET_DTE,
        min(MAX_TARGET_DTE, int(_num(p.get("target_dte"), 180) or 180)),
    )
    min_dte = max(
        MIN_TARGET_DTE,
        int(_num(p.get("min_dte"), 120) or 120),
    )
    max_dte = min(
        MAX_TARGET_DTE,
        max(min_dte, int(_num(p.get("max_dte"), 240) or 240)),
    )
    target_dte = min(max_dte, max(min_dte, target_dte))
    bought_width = max(0.5, _num(p.get("bought_width"), 5.0) or 5.0)
    sold_width = max(0.5, _num(p.get("sold_width"), 10.0) or 10.0)
    bought_quantity = max(
        1,
        min(100, int(_num(p.get("bought_quantity"), 1) or 1)),
    )
    sold_quantity = max(
        1,
        min(100, int(_num(p.get("sold_quantity"), 1) or 1)),
    )
    delta_tolerance = min(
        0.20,
        max(0.005, _num(p.get("delta_tolerance"), 0.04) or 0.04),
    )
    target_position_delta = min(
        100.0,
        max(-100.0, _num(p.get("target_position_delta"), 0.0) or 0.0),
    )
    position_delta_tolerance = min(
        100.0,
        max(
            0.1,
            _num(p.get("position_delta_tolerance"), 2.0) or 2.0,
        ),
    )
    width_tolerance_pct = min(
        100.0,
        max(0.0, _num(p.get("width_tolerance_pct"), 20.0) or 0.0),
    )
    min_open_interest = max(
        0,
        int(_num(p.get("min_open_interest"), 0) or 0),
    )
    require_upside_credit = bool(p.get("require_upside_credit"))
    max_results = max(
        1,
        min(300, int(_num(p.get("max_results"), 100) or 100)),
    )

    history = _load_history(tickers)
    fundamentals = _fetch_fundamentals_bulk(tickers)
    spots = {}
    for ticker in tickers:
        frame = _ticker_frame(history, ticker)
        if frame is None:
            continue
        close = frame["Close"].dropna()
        if not close.empty:
            spots[ticker] = _num(close.iloc[-1])

    def scan_ticker(ticker: str) -> dict:
        spot = spots.get(ticker)
        if not spot or spot <= 0:
            return {
                "ticker": ticker,
                "status": "unavailable",
                "reason": "Current underlying price is unavailable.",
                "candidates": [],
            }
        try:
            expirations = list(yf.Ticker(ticker).options or [])
        except Exception:
            expirations = []
        expiration, dte, _ = _pick_expiration(
            expirations, target_dte, min_dte, max_dte,
        )
        if not expiration:
            return {
                "ticker": ticker,
                "price": _round(spot),
                "status": "unavailable",
                "reason": (
                    f"No listed expiration is between {min_dte} and {max_dte} DTE."
                ),
                "candidates": [],
            }
        fund = fundamentals.get(ticker, {})
        div_yield = dividend_yield_for_pricing(fund, spot)
        puts = _load_put_chain(ticker, expiration, spot, div_yield)
        if not puts:
            return {
                "ticker": ticker,
                "price": _round(spot),
                "expiration": expiration,
                "dte": dte,
                "status": "unavailable",
                "reason": "The selected expiration has no usable put chain.",
                "candidates": [],
            }

        chosen = []
        missing = []
        for preset in presets:
            candidates = _candidates_for_preset(
                puts,
                spot,
                expiration,
                dte,
                preset,
                bought_width,
                sold_width,
                bought_quantity,
                sold_quantity,
                div_yield,
            )
            if not candidates:
                missing.append(f"{preset}: no quotable four-put combination")
                continue

            # Net position delta is the governing choice.  The named delta pair
            # locates the neighborhood; nearby listed strikes are searched for
            # the complete four-leg package whose delta best matches the user's
            # neutral, bullish, or bearish target.
            best = _choose_candidate(
                candidates,
                target_position_delta=target_position_delta,
                delta_tolerance=delta_tolerance,
                width_tolerance_pct=width_tolerance_pct,
                min_open_interest=min_open_interest,
                require_upside_credit=require_upside_credit,
            )
            best["target_position_delta"] = target_position_delta
            best["position_delta_error"] = abs(
                (best.get("position_delta") or 0.0) - target_position_delta
            )
            flags = []
            blocking_flags = []
            if best["upper_delta_error"] > delta_tolerance:
                blocking_flags.append("Upper short delta outside tolerance")
            if best["lower_delta_error"] > delta_tolerance:
                blocking_flags.append("Lower short delta outside tolerance")
            if best["width_error_pct"] > width_tolerance_pct:
                blocking_flags.append("Listed strikes miss the requested width")
            if best["open_interest_min"] < min_open_interest:
                blocking_flags.append("One or more legs are below minimum open interest")
            if require_upside_credit and best["entry_credit"] < 0:
                blocking_flags.append("Upper flat outcome is a debit")
            if best["position_delta_error"] > position_delta_tolerance:
                blocking_flags.append("Net position delta is outside tolerance")
            flags.extend(blocking_flags)
            if best["natural_credit"] < 0 <= best["entry_credit"]:
                flags.append("Mid shows a credit but the natural market is a debit")

            actionable = not blocking_flags
            best.update({
                "ticker": ticker,
                "name": fund.get("name"),
                "price": spot,
                "status": "actionable" if actionable else "near_match",
                "flags": flags,
                "scanner_variant": (
                    f"{preset.replace('/', '-')}-{bought_width:g}x{sold_width:g}"
                    f"-q{bought_quantity}x{sold_quantity}"
                ),
            })
            chosen.append(_round_candidate(best))

        return {
            "ticker": ticker,
            "name": fund.get("name"),
            "price": _round(spot),
            "expiration": expiration,
            "dte": dte,
            "status": "found" if chosen else "unavailable",
            "reason": "; ".join(missing) if not chosen else None,
            "candidates": chosen,
        }

    scan_results = []
    with ThreadPoolExecutor(max_workers=min(8, len(tickers))) as pool:
        scan_results.extend(pool.map(scan_ticker, tickers))

    rows = [
        candidate
        for result in scan_results
        for candidate in result.get("candidates", [])
    ]
    rows.sort(key=lambda row: (
        row.get("status") != "actionable",
        row.get("upper_delta_error", 9) + row.get("lower_delta_error", 9),
        row.get("width_error_pct", 999),
        -(row.get("open_interest_min") or 0),
    ))
    rows = rows[:max_results]
    unavailable = [
        {
            "ticker": result["ticker"],
            "name": result.get("name"),
            "price": result.get("price"),
            "expiration": result.get("expiration"),
            "dte": result.get("dte"),
            "reason": result.get("reason"),
        }
        for result in scan_results
        if not result.get("candidates")
    ]

    return {
        "rows": rows,
        "unavailable": unavailable,
        "stats": {
            "tickers": len(tickers),
            "expirations_priced": sum(
                1 for result in scan_results if result.get("expiration")
            ),
            "structures_found": len(rows),
            "actionable": sum(1 for row in rows if row["status"] == "actionable"),
            "near_matches": sum(1 for row in rows if row["status"] == "near_match"),
        },
        "params": {
            "tickers": tickers,
            "delta_presets": presets,
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "bought_width": bought_width,
            "sold_width": sold_width,
            "bought_quantity": bought_quantity,
            "sold_quantity": sold_quantity,
            "delta_tolerance": delta_tolerance,
            "target_position_delta": target_position_delta,
            "position_delta_tolerance": position_delta_tolerance,
            "width_tolerance_pct": width_tolerance_pct,
            "min_open_interest": min_open_interest,
            "require_upside_credit": require_upside_credit,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def register_routes(app):
    @app.route(
        "/api/options/unbalanced-put-condor-scan/defaults",
        methods=["GET"],
    )
    def unbalanced_put_condor_scan_defaults():
        return jsonify(
            defaults=DEFAULTS,
            delta_presets=[
                {
                    "id": name,
                    "upper_short_delta": values[0],
                    "lower_short_delta": values[1],
                }
                for name, values in DELTA_PRESETS.items()
            ],
        )

    @app.route("/api/options/unbalanced-put-condor-scan", methods=["POST"])
    def unbalanced_put_condor_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            return jsonify(run_unbalanced_put_condor_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
