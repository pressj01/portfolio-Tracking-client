"""Dave Andresen CC4 double-hedge put butterfly candidate scanner.

The March 2021 trade plan defines one same-expiration tranche as:

    BUY   4 upper long puts   near 25 delta
    SELL  8 body puts        near 15 delta
    BUY   8 lower long puts  near 2.5 delta, shifted for bias

The scanner intentionally separates what can be calculated from an option
chain from the proprietary/historical monitors described in the presentation.
Strike selection, Greeks, T+0 stress marks, expiration geometry, skew and
cross-strike concavity are calculated. The structure-price, concavity and skew
blue/green monitor states plus the five-indicator warning count are explicit
user confirmations; a current chain snapshot cannot truthfully reproduce the
presentation's historical standard-deviation monitors.

Endpoints:
  GET  /api/options/double-hedge-put-butterfly-scan/defaults
  POST /api/options/double-hedge-put-butterfly-scan
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import math
import re

import yfinance as yf

import yahoo_gateway
from flask import jsonify, request

from put_scanner import (
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    _clean_tickers,
    _fetch_fundamentals_bulk,
    _index_only_tickers,
    _load_history,
    _load_put_chain,
    _num,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)
from unbalanced_butterfly_scanner import (
    _build_butterfly,
    with_full_analytics,
    _distance_to_range,
    _modeled_butterfly_pl,
    _monthly_expirations_in_window,
    _prepare_scan_leg,
    _round_candidate,
)
from unbalanced_put_condor_scanner import CONTRACT_MULTIPLIER


UPPER_LONG_TARGET = 0.25
BODY_SHORT_TARGET = 0.15
LOWER_LONG_TARGET = 0.025
LOWER_LONG_QUANTITY_MULTIPLIER = 2
BASE_UPPER_LONG_QUANTITY = 4
DEFAULT_TICKERS = ["SPY", "QQQ", "IWM", "VOO"]

BIAS_RANGES = {
    "bearish": (-3.0, -1.0),
    "neutral": (-1.0, 1.0),
    "bullish": (1.0, 3.0),
}
ENTRY_SIGNALS = {"unconfirmed", "favorable", "unfavorable"}

DOCUMENT_PROFIT_TARGET_DOLLARS = 1000.0
DOCUMENT_EXPECTED_PROFIT_DOLLARS = 800.0
DOCUMENT_MAX_LOSS_DOLLARS = 2500.0
DOCUMENT_PLANNED_CAPITAL_DOLLARS = 12500.0
DOCUMENT_LEARNING_CAPITAL_DOLLARS = 20000.0
DOCUMENT_EXPECTED_HOLD_DAYS = 12 * 7

DEFAULTS = {
    "tickers": ",".join(DEFAULT_TICKERS),
    "market_bias": "neutral",
    "target_dte": 200,
    "min_dte": 160,
    "max_dte": 230,
    "tranche_quantity": 4,
    "delta_tolerance": 0.02,
    "min_theta_dollars": 10.0,
    "min_t0_minus_20_dollars": -10000.0,
    "uel_tolerance_dollars": 250.0,
    "min_lower_wing_ratio": 1.05,
    "min_open_interest": 0,
    "price_signal": "unconfirmed",
    "concavity_signal": "unconfirmed",
    "skew_signal": "unconfirmed",
    "warning_signal_count": 0,
    "awaiting_all_clear": False,
    "campaign_planned_capital_dollars": 150000.0,
    "planned_capital_per_tranche_dollars": 12500.0,
    "open_tranches": 0,
    "max_results": 100,
}


def _ticker_list(raw) -> list[str]:
    return _index_only_tickers(raw, DEFAULT_TICKERS, limit=20)


def _bias_name(value) -> str:
    normalized = str(value or "neutral").strip().lower()
    if normalized not in BIAS_RANGES:
        raise ValueError("market_bias must be bearish, neutral, or bullish")
    return normalized


def _entry_signal(value, field: str) -> str:
    normalized = str(value or "unconfirmed").strip().lower()
    if normalized not in ENTRY_SIGNALS:
        raise ValueError(
            f"{field} must be unconfirmed, favorable, or unfavorable"
        )
    return normalized


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _candidate_quality(
    candidate: dict,
    *,
    bias_low: float,
    bias_high: float,
    min_theta_dollars: float,
    min_t0_minus_20_dollars: float,
) -> tuple:
    theta = candidate.get("theta_dollars_per_day")
    t0 = candidate.get("t0_minus_20_dollars")
    return (
        _distance_to_range(
            candidate.get("position_delta"),
            bias_low,
            bias_high,
        ),
        max(0.0, min_theta_dollars - theta) if theta is not None else math.inf,
        (
            max(0.0, min_t0_minus_20_dollars - t0)
            if t0 is not None else math.inf
        ),
        abs(candidate.get("upper_flat_dollars") or 0.0),
        candidate["upper_long_delta_error"]
        + candidate["body_short_delta_error"]
        + candidate["lower_long_delta_error"],
        candidate.get("execution_cost_dollars") or math.inf,
        -(candidate.get("open_interest_min") or 0),
    )


def _cross_strike_metrics(
    upper_long: dict,
    body_short: dict,
    lower_long: dict,
    *,
    spot: float,
) -> dict:
    """Current-chain proxies, not the presentation's historical monitors."""
    upper_strike = float(upper_long["strike"])
    body_strike = float(body_short["strike"])
    lower_strike = float(lower_long["strike"])
    upper_mid = _num(upper_long.get("mid"))
    body_mid = _num(body_short.get("mid"))
    lower_mid = _num(lower_long.get("mid"))

    body_richness = None
    if None not in (upper_mid, body_mid, lower_mid):
        span = upper_strike - lower_strike
        if span > 0:
            weight = (body_strike - lower_strike) / span
            interpolated = lower_mid + weight * (upper_mid - lower_mid)
            body_richness = body_mid - interpolated

    upper_iv = _num(upper_long.get("iv"))
    lower_iv = _num(lower_long.get("iv"))
    skew_iv_points = None
    skew_iv_points_per_10pct = None
    if (
        upper_iv is not None
        and lower_iv is not None
        and spot > 0
        and upper_strike > lower_strike
    ):
        skew_iv_points = (lower_iv - upper_iv) * 100.0
        moneyness_span = (upper_strike - lower_strike) / spot
        if moneyness_span > 0:
            skew_iv_points_per_10pct = skew_iv_points / (moneyness_span * 10)

    return {
        "body_richness_points": body_richness,
        "body_richness_dollars_per_contract": (
            body_richness * CONTRACT_MULTIPLIER
            if body_richness is not None else None
        ),
        "put_skew_iv_points": skew_iv_points,
        "put_skew_iv_points_per_10pct": skew_iv_points_per_10pct,
    }


def _enrich_candidate(
    candidate: dict,
    *,
    upper_long: dict,
    body_short: dict,
    lower_long: dict,
    spot: float,
    dte: int,
    quantity: int,
    dividend_yield: float,
) -> dict:
    for move_pct in (15, 20):
        modeled = _modeled_butterfly_pl(
            exit_spot=spot * (1.0 - move_pct / 100.0),
            remaining_dte=dte,
            entry_credit=candidate["entry_credit"],
            upper_long=upper_long,
            body_short=body_short,
            lower_long=lower_long,
            quantity=quantity,
            dividend_yield=dividend_yield,
            lower_long_quantity_multiplier=LOWER_LONG_QUANTITY_MULTIPLIER,
        )
        candidate[f"t0_minus_{move_pct}_dollars"] = (
            modeled * CONTRACT_MULTIPLIER if modeled is not None else None
        )

    candidate.update(_cross_strike_metrics(
        upper_long,
        body_short,
        lower_long,
        spot=spot,
    ))

    scale = quantity / BASE_UPPER_LONG_QUANTITY
    theta = max(0.0, _num(candidate.get("theta_dollars_per_day"), 0.0) or 0.0)
    candidate.update({
        "document_quantity_scale": scale,
        "course_expected_hold_days": DOCUMENT_EXPECTED_HOLD_DAYS,
        "course_profit_target_dollars": DOCUMENT_PROFIT_TARGET_DOLLARS * scale,
        "course_average_profit_dollars": DOCUMENT_EXPECTED_PROFIT_DOLLARS * scale,
        "course_max_loss_target_dollars": DOCUMENT_MAX_LOSS_DOLLARS * scale,
        "course_planned_capital_dollars": DOCUMENT_PLANNED_CAPITAL_DOLLARS * scale,
        "course_learning_capital_dollars": DOCUMENT_LEARNING_CAPITAL_DOLLARS * scale,
        "theta_reference_profit_target_dollars": 120.0 * theta,
        "theta_reference_expected_profit_dollars": 71.0 * theta,
        "roll_down_review_price": candidate["upper_long_strike"] * 1.02,
        "roll_up_review_price": candidate["upper_long_strike"] * 1.14,
    })
    return candidate


def _candidates(
    puts: list[dict],
    *,
    spot: float,
    expiration: str,
    dte: int,
    quantity: int,
    min_lower_wing_ratio: float,
    dividend_yield: float,
    bias_low: float,
    bias_high: float,
    min_theta_dollars: float,
    min_t0_minus_20_dollars: float,
) -> list[dict]:
    legs = []
    for leg in puts:
        prepared = _prepare_scan_leg(
            leg,
            spot=spot,
            dte=dte,
            dividend_yield=dividend_yield,
        )
        if (
            prepared is not None
            and prepared.get("delta") is not None
            and 0 < prepared["strike"] < spot
            and _num(prepared.get("iv"), 0.0) > 0
        ):
            legs.append(prepared)
    if len(legs) < 3:
        return []

    has_estimated_leg = any(
        leg.get("quote_source") == "last_trade" for leg in legs
    )
    upper_limit = 4 if has_estimated_leg else 10
    body_limit = 6 if has_estimated_leg else 14
    lower_limit = 12 if has_estimated_leg else 28

    upper_longs = sorted(
        legs,
        key=lambda leg: abs(abs(leg["delta"]) - UPPER_LONG_TARGET),
    )[:upper_limit]
    candidates = []
    seen = set()
    for upper_long in upper_longs:
        body_shorts = sorted(
            [leg for leg in legs if leg["strike"] < upper_long["strike"]],
            key=lambda leg: abs(abs(leg["delta"]) - BODY_SHORT_TARGET),
        )[:body_limit]
        for body_short in body_shorts:
            upper_width = upper_long["strike"] - body_short["strike"]
            lower_longs = sorted(
                [
                    leg for leg in legs
                    if (
                        leg["strike"] < body_short["strike"]
                        and body_short["strike"] - leg["strike"]
                        >= upper_width * min_lower_wing_ratio
                    )
                ],
                key=lambda leg: (
                    _distance_to_range(
                        quantity * (
                            upper_long["delta"]
                            - 2.0 * body_short["delta"]
                            + 2.0 * leg["delta"]
                        ) * CONTRACT_MULTIPLIER,
                        bias_low,
                        bias_high,
                    ),
                    abs(abs(leg["delta"]) - LOWER_LONG_TARGET),
                ),
            )[:lower_limit]
            for lower_long in lower_longs:
                key = (
                    upper_long["strike"],
                    body_short["strike"],
                    lower_long["strike"],
                )
                if key in seen:
                    continue
                seen.add(key)
                candidate = _build_butterfly(
                    upper_long,
                    body_short,
                    lower_long,
                    spot=spot,
                    expiration=expiration,
                    dte=dte,
                    upper_long_target=UPPER_LONG_TARGET,
                    tranche_quantity=quantity,
                    lower_long_quantity_multiplier=(
                        LOWER_LONG_QUANTITY_MULTIPLIER
                    ),
                    lower_long_target=LOWER_LONG_TARGET,
                    structure_kind="double-hedge-put-butterfly",
                    dividend_yield=dividend_yield,
                    with_analytics=False,
                )
                if candidate:
                    candidates.append(_enrich_candidate(
                        candidate,
                        upper_long=upper_long,
                        body_short=body_short,
                        lower_long=lower_long,
                        spot=spot,
                        dte=dte,
                        quantity=quantity,
                        dividend_yield=dividend_yield,
                    ))

    candidates.sort(key=lambda candidate: _candidate_quality(
        candidate,
        bias_low=bias_low,
        bias_high=bias_high,
        min_theta_dollars=min_theta_dollars,
        min_t0_minus_20_dollars=min_t0_minus_20_dollars,
    ))
    return candidates


def _choose_candidate(
    candidates: list[dict],
    *,
    bias_low: float,
    bias_high: float,
    delta_tolerance: float,
    min_open_interest: int,
    min_theta_dollars: float,
    min_t0_minus_20_dollars: float,
) -> dict | None:
    if not candidates:
        return None
    passing = [
        candidate for candidate in candidates
        if (
            candidate["upper_long_delta_error"] <= delta_tolerance
            and candidate["body_short_delta_error"] <= delta_tolerance
            and candidate["lower_long_delta_error"] <= delta_tolerance
            and bias_low <= candidate["position_delta"] <= bias_high
            and candidate["open_interest_min"] >= min_open_interest
            and candidate.get("theta_dollars_per_day") is not None
            and candidate["theta_dollars_per_day"] >= min_theta_dollars
            and candidate.get("t0_minus_20_dollars") is not None
            and candidate["t0_minus_20_dollars"] >= min_t0_minus_20_dollars
        )
    ]
    return min(
        passing or candidates,
        key=lambda candidate: _candidate_quality(
            candidate,
            bias_low=bias_low,
            bias_high=bias_high,
            min_theta_dollars=min_theta_dollars,
            min_t0_minus_20_dollars=min_t0_minus_20_dollars,
        ),
    )


def _round_488_candidate(candidate: dict) -> dict:
    out = _round_candidate(candidate)
    for key, decimals in (
        ("t0_minus_15_dollars", 0),
        ("t0_minus_20_dollars", 0),
        ("body_richness_points", 3),
        ("body_richness_dollars_per_contract", 0),
        ("put_skew_iv_points", 2),
        ("put_skew_iv_points_per_10pct", 2),
        ("course_average_profit_dollars", 0),
        ("course_planned_capital_dollars", 0),
        ("course_learning_capital_dollars", 0),
        ("theta_reference_profit_target_dollars", 0),
        ("theta_reference_expected_profit_dollars", 0),
        ("roll_down_review_price", 2),
        ("roll_up_review_price", 2),
    ):
        out[key] = _round(out.get(key), decimals)
    return out


def run_488_scan(payload: dict) -> dict:
    supplied = payload or {}
    p = {
        **DEFAULTS,
        **{key: value for key, value in supplied.items() if value is not None},
    }
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    market_bias = _bias_name(p.get("market_bias"))
    target_dte = max(
        MIN_TARGET_DTE,
        min(MAX_TARGET_DTE, int(_num(p.get("target_dte"), 200))),
    )
    min_dte = max(
        MIN_TARGET_DTE,
        int(_num(p.get("min_dte"), 160)),
    )
    max_dte = min(
        MAX_TARGET_DTE,
        max(min_dte, int(_num(p.get("max_dte"), 230))),
    )
    target_dte = min(max_dte, max(min_dte, target_dte))
    quantity = max(
        1,
        min(100, int(_num(p.get("tranche_quantity"), 4) or 4)),
    )
    scale = quantity / BASE_UPPER_LONG_QUANTITY
    base_bias_low, base_bias_high = BIAS_RANGES[market_bias]
    bias_low = base_bias_low * scale
    bias_high = base_bias_high * scale
    delta_tolerance = min(
        0.10,
        max(0.0025, _num(p.get("delta_tolerance"), 0.02) or 0.02),
    )
    min_theta_dollars = min(
        5000.0,
        max(-5000.0, _num(p.get("min_theta_dollars"), 10.0) or 10.0),
    )
    min_t0_minus_20_dollars = min(
        0.0,
        max(
            -1000000.0,
            _num(p.get("min_t0_minus_20_dollars"), -10000.0)
            or -10000.0,
        ),
    )
    uel_tolerance_dollars = min(
        100000.0,
        max(0.0, _num(p.get("uel_tolerance_dollars"), 250.0) or 250.0),
    )
    min_lower_wing_ratio = min(
        10.0,
        max(
            1.001,
            _num(p.get("min_lower_wing_ratio"), 1.05) or 1.05,
        ),
    )
    min_open_interest = max(
        0,
        int(_num(p.get("min_open_interest"), 0) or 0),
    )
    max_results = max(
        1,
        min(300, int(_num(p.get("max_results"), 100) or 100)),
    )

    price_signal = _entry_signal(p.get("price_signal"), "price_signal")
    concavity_signal = _entry_signal(
        p.get("concavity_signal"),
        "concavity_signal",
    )
    skew_signal = _entry_signal(p.get("skew_signal"), "skew_signal")
    warning_signal_count = max(
        0,
        min(5, int(_num(p.get("warning_signal_count"), 0) or 0)),
    )
    awaiting_all_clear = _as_bool(p.get("awaiting_all_clear"))
    campaign_capital = max(
        0.0,
        _num(p.get("campaign_planned_capital_dollars"), 150000.0)
        or 0.0,
    )
    per_tranche_capital = max(
        1.0,
        _num(p.get("planned_capital_per_tranche_dollars"), 12500.0)
        or 12500.0,
    )
    open_tranches = max(
        0,
        int(_num(p.get("open_tranches"), 0) or 0),
    )
    max_campaign_tranches = int(campaign_capital // per_tranche_capital)
    campaign_capacity_remaining = max(0, max_campaign_tranches - open_tranches)
    after_entry_tranches = open_tranches + 1
    # At four or five warnings the document blocks the prospective entry and
    # hedges the campaign that is already open, one unit per three tranches.
    hedge_groups = math.ceil(open_tranches / 3) if open_tranches else 0
    required_lpta_puts = (
        2 * hedge_groups if warning_signal_count >= 5
        else hedge_groups if warning_signal_count == 4
        else 0
    )

    monitor_flags = []
    monitor_advisories = []
    for label, value in (
        ("Structure price", price_signal),
        ("Concavity", concavity_signal),
        ("Skew", skew_signal),
    ):
        if value == "unfavorable":
            monitor_flags.append(f"{label} monitor is unfavorable")
        elif value != "favorable":
            monitor_flags.append(f"{label} monitor is not confirmed favorable")
    if warning_signal_count >= 4:
        monitor_flags.append(
            f"{warning_signal_count} of 5 market warnings are active; "
            "the document says do not enter a new tranche"
        )
    if awaiting_all_clear:
        monitor_flags.append(
            "Awaiting the bullish 8/34 EMA crossover on the 30-minute chart"
        )
    if campaign_capacity_remaining <= 0:
        monitor_flags.append("Campaign tranche capacity is already full")
    if warning_signal_count in {4, 5} and open_tranches > 0:
        monitor_advisories.append(
            f"Existing campaign calls for {required_lpta_puts} roughly "
            "30-DTE, 2-delta LPTA long put(s) under the document rules"
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
        # Through the gateway: a throttled catalog must not read as "this
        # ticker has no options", and a cooldown must not be met with one
        # more request per underlying. Falls back to the last catalog Yahoo
        # did return, which is the same list from one day to the next.
        expirations = yahoo_gateway.fetch(
            "option_expirations", ticker,
            lambda: list(yf.Ticker(ticker).options or []),
        )[0] or []
        monthlies = _monthly_expirations_in_window(
            expirations,
            target_dte,
            min_dte,
            max_dte,
        )
        if not monthlies:
            return {
                "ticker": ticker,
                "price": _round(spot),
                "status": "unavailable",
                "reason": (
                    "No standard monthly expiration is between "
                    f"{min_dte} and {max_dte} DTE."
                ),
                "candidates": [],
            }

        fund = fundamentals.get(ticker, {})
        dividend_yield = dividend_yield_for_pricing(fund, spot)
        chosen = None
        expirations_priced = 0
        usable_chains = 0
        for expiration, dte in monthlies:
            puts = _load_put_chain(ticker, expiration, spot, dividend_yield)
            expirations_priced += 1
            if not puts:
                continue
            usable_chains += 1
            candidates = _candidates(
                puts,
                spot=spot,
                expiration=expiration,
                dte=dte,
                quantity=quantity,
                min_lower_wing_ratio=min_lower_wing_ratio,
                dividend_yield=dividend_yield,
                bias_low=bias_low,
                bias_high=bias_high,
                min_theta_dollars=min_theta_dollars,
                min_t0_minus_20_dollars=min_t0_minus_20_dollars,
            )
            if not candidates:
                continue
            chosen = with_full_analytics(_choose_candidate(
                candidates,
                bias_low=bias_low,
                bias_high=bias_high,
                delta_tolerance=delta_tolerance,
                min_open_interest=min_open_interest,
                min_theta_dollars=min_theta_dollars,
                min_t0_minus_20_dollars=min_t0_minus_20_dollars,
            ))
            if chosen:
                break

        first_expiration, first_dte = monthlies[0]
        if not chosen:
            reason = (
                "The selected monthly-expiration window has no usable put chain."
                if usable_chains == 0
                else "No 25/15/2.5-delta 4/-8/+8 combination could be formed."
            )
            return {
                "ticker": ticker,
                "name": fund.get("name"),
                "price": _round(spot),
                "expiration": first_expiration,
                "dte": first_dte,
                "expirations_priced": expirations_priced,
                "status": "unavailable",
                "reason": reason,
                "candidates": [],
            }

        chosen["market_bias"] = market_bias
        chosen["bias_delta_min"] = bias_low
        chosen["bias_delta_max"] = bias_high
        chosen["position_delta_error"] = _distance_to_range(
            chosen.get("position_delta"),
            bias_low,
            bias_high,
        )
        structure_flags = []
        advisories = list(monitor_advisories)
        if chosen["upper_long_delta_error"] > delta_tolerance:
            structure_flags.append("Upper long delta is outside tolerance")
        if chosen["body_short_delta_error"] > delta_tolerance:
            structure_flags.append("Body short delta is outside tolerance")
        if chosen["lower_long_delta_error"] > delta_tolerance:
            structure_flags.append(
                "Lower hedge delta is outside tolerance after bias balancing"
            )
        if chosen["position_delta_error"] > 0:
            structure_flags.append(
                f"Position delta is outside the scaled {market_bias} range"
            )
        if chosen["open_interest_min"] < min_open_interest:
            structure_flags.append(
                "One or more legs are below minimum open interest"
            )
        if chosen.get("uses_last_trade_prices"):
            structure_flags.append(
                "Live bid/ask unavailable on one or more legs; values use "
                "recent trades"
            )
        theta = chosen.get("theta_dollars_per_day")
        if theta is None or theta < min_theta_dollars:
            structure_flags.append("ATM theta is below the document minimum")
        t0_minus_20 = chosen.get("t0_minus_20_dollars")
        if t0_minus_20 is None or t0_minus_20 < min_t0_minus_20_dollars:
            structure_flags.append(
                "Modeled T+0 at -20% is worse than the document limit"
            )
        if abs(chosen["upper_flat_dollars"]) > uel_tolerance_dollars:
            advisories.append(
                "Upper expiration line is outside the preferred near-zero band"
            )
        natural_credit = chosen.get("natural_credit")
        if (
            natural_credit is not None
            and natural_credit < 0 <= chosen["entry_credit"]
        ):
            advisories.append(
                "Mid shows a credit but the natural market is a debit"
            )

        blocking_flags = [*structure_flags, *monitor_flags]
        chosen.update({
            "ticker": ticker,
            "name": fund.get("name"),
            "price": spot,
            "status": "actionable" if not blocking_flags else "near_match",
            "structural_status": (
                "matched" if not structure_flags else "near_match"
            ),
            "entry_monitor_status": (
                "ready" if not monitor_flags
                else "unfavorable" if any(
                    "unfavorable" in flag for flag in monitor_flags
                )
                else "unconfirmed"
            ),
            "flags": [*blocking_flags, *advisories],
            "blocking_flags": blocking_flags,
            "structure_flags": structure_flags,
            "monitor_flags": monitor_flags,
            "scanner_variant": (
                f"double-hedge-put-butterfly-{market_bias}-q{quantity}"
            ),
            "min_theta_dollars": min_theta_dollars,
            "min_t0_minus_20_dollars": min_t0_minus_20_dollars,
            "uel_tolerance_dollars": uel_tolerance_dollars,
            "price_signal": price_signal,
            "concavity_signal": concavity_signal,
            "skew_signal": skew_signal,
            "warning_signal_count": warning_signal_count,
            "awaiting_all_clear": awaiting_all_clear,
            "max_campaign_tranches": max_campaign_tranches,
            "campaign_capacity_remaining": campaign_capacity_remaining,
            "open_tranches": open_tranches,
            "after_entry_tranches": after_entry_tranches,
            "required_lpta_puts": required_lpta_puts,
        })
        return {
            "ticker": ticker,
            "name": fund.get("name"),
            "price": _round(spot),
            "expiration": chosen["expiration"],
            "dte": chosen["dte"],
            "expirations_priced": expirations_priced,
            "status": "found",
            "reason": None,
            "candidates": [_round_488_candidate(chosen)],
        }

    scan_results = []
    with ThreadPoolExecutor(max_workers=min(8, len(tickers))) as pool:
        scan_results.extend(pool.map(scan_ticker, tickers))

    rows = [
        candidate
        for result in scan_results
        for candidate in result.get("candidates", [])
    ]
    def row_quality(row):
        theta_value = row.get("theta_dollars_per_day")
        t0_value = row.get("t0_minus_20_dollars")
        return (
            row.get("status") != "actionable",
            row.get("structural_status") != "matched",
            row.get("position_delta_error", math.inf),
            (
                max(0.0, min_theta_dollars - theta_value)
                if theta_value is not None else math.inf
            ),
            (
                max(0.0, min_t0_minus_20_dollars - t0_value)
                if t0_value is not None else math.inf
            ),
            abs(row.get("upper_flat_dollars") or 0.0),
        )

    rows.sort(key=row_quality)
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
                result.get("expirations_priced", 0)
                for result in scan_results
            ),
            "structures_found": len(rows),
            "structural_matches": sum(
                1 for row in rows if row["structural_status"] == "matched"
            ),
            "actionable": sum(
                1 for row in rows if row["status"] == "actionable"
            ),
            "near_matches": sum(
                1 for row in rows if row["status"] == "near_match"
            ),
        },
        "params": {
            "tickers": tickers,
            "market_bias": market_bias,
            "bias_delta_min": bias_low,
            "bias_delta_max": bias_high,
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "tranche_quantity": quantity,
            "delta_tolerance": delta_tolerance,
            "min_theta_dollars": min_theta_dollars,
            "min_t0_minus_20_dollars": min_t0_minus_20_dollars,
            "uel_tolerance_dollars": uel_tolerance_dollars,
            "min_lower_wing_ratio": min_lower_wing_ratio,
            "min_open_interest": min_open_interest,
            "price_signal": price_signal,
            "concavity_signal": concavity_signal,
            "skew_signal": skew_signal,
            "warning_signal_count": warning_signal_count,
            "awaiting_all_clear": awaiting_all_clear,
            "campaign_planned_capital_dollars": campaign_capital,
            "planned_capital_per_tranche_dollars": per_tranche_capital,
            "open_tranches": open_tranches,
            "max_campaign_tranches": max_campaign_tranches,
            "campaign_capacity_remaining": campaign_capacity_remaining,
            "required_lpta_puts": required_lpta_puts,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def register_routes(app):
    @app.route(
        "/api/options/double-hedge-put-butterfly-scan/defaults",
        methods=["GET"],
    )
    def four_eight_eight_scan_defaults():
        return jsonify(
            defaults=DEFAULTS,
            structure={
                "upper_long_delta": UPPER_LONG_TARGET,
                "body_short_delta": BODY_SHORT_TARGET,
                "lower_long_delta": LOWER_LONG_TARGET,
                "upper_long_quantity": BASE_UPPER_LONG_QUANTITY,
                "body_short_quantity": 2 * BASE_UPPER_LONG_QUANTITY,
                "lower_long_quantity": 2 * BASE_UPPER_LONG_QUANTITY,
            },
            market_biases=[
                {
                    "id": name,
                    "minimum_delta": limits[0],
                    "maximum_delta": limits[1],
                }
                for name, limits in BIAS_RANGES.items()
            ],
        )

    @app.route(
        "/api/options/double-hedge-put-butterfly-scan",
        methods=["POST"],
    )
    def four_eight_eight_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            return jsonify(run_488_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
