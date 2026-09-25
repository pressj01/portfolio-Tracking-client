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

A second plan builds the same 1/-2/+2 structure around 100 DTE on 30/12/3
delta legs. It has no source document, so none of the CC4 entry rules (theta
floor, monitors, campaign) are applied to it.

For either plan the trader picks the opening debit or credit. The sold body
stays on its delta; the lower longs shift up or down to fit, and the upper
long moves down only when the lower longs alone cannot reach it. That fit
replaces CC4's bias band and upper-line tolerance as the rule that places
the lower hedge; they apply only to a trade built without a target.
``tranche_quantity`` scales the whole ratio for either plan, and every
per-tranche dollar rule the caller leaves out scales with it.

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

# Both plans price the same 1/-2/+2 put structure with a doubled lower hedge.
# ``document_rules`` marks the presentation's own trade and its theta floor,
# entry monitors and campaign rules. At its exact deltas a 30/12/3 structure
# opens for about 0.7% of spot per 1/-2/+2 unit, so for both plans the trader
# picks the opening debit or credit and the bought longs shift to fit it.
STRUCTURE_VARIANTS = {
    "cc4": {
        "label": "CC4 25/15/2.5-delta, ~200 DTE",
        "delta_label": "25/15/2.5",
        "upper_long_delta": UPPER_LONG_TARGET,
        "body_short_delta": BODY_SHORT_TARGET,
        "lower_long_delta": LOWER_LONG_TARGET,
        "target_dte": 200,
        "min_dte": 160,
        "max_dte": 230,
        "document_rules": True,
    },
    "100dte": {
        "label": "100-DTE 30/12/3-delta",
        "delta_label": "30/12/3",
        "upper_long_delta": 0.30,
        "body_short_delta": 0.12,
        "lower_long_delta": 0.03,
        "target_dte": 100,
        # Monthlies are at most 35 days apart, so a 40-day window always
        # holds at least one standard expiration.
        "min_dte": 80,
        "max_dte": 120,
        "document_rules": False,
    },
}
DEFAULT_STRUCTURE_VARIANT = "cc4"

# Whole-position dollar rules. DEFAULTS states them per 4/-8/+8 base tranche;
# a request that leaves one out gets it scaled to the requested size.
SIZE_SCALED_RULES = (
    "min_theta_dollars",
    "min_t0_minus_20_dollars",
    "uel_tolerance_dollars",
    "planned_capital_per_tranche_dollars",
    "upper_line_amount_dollars",
)
UPPER_LINE_MODES = {"debit", "credit"}

# Course targets and management references. A plan without document rules
# reports none of them rather than borrowing another trade's numbers.
_DOCUMENT_TARGET_KEYS = (
    "course_quantity_scale",
    "course_planned_capital_low_dollars",
    "course_planned_capital_high_dollars",
    "document_quantity_scale",
    "course_expected_hold_days",
    "course_profit_target_dollars",
    "course_average_profit_dollars",
    "course_max_loss_target_dollars",
    "course_planned_capital_dollars",
    "course_learning_capital_dollars",
    "theta_reference_profit_target_dollars",
    "theta_reference_expected_profit_dollars",
    "roll_down_review_price",
    "roll_up_review_price",
)

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
    "structure_variant": DEFAULT_STRUCTURE_VARIANT,
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
    # Pay at most this debit ("debit") or collect at least this credit
    # ("credit") for the whole position; the bought longs fit it.
    "upper_line_mode": "debit",
    "upper_line_amount_dollars": 300.0,
    "max_results": 100,
}


def _ticker_list(raw) -> list[str]:
    return _index_only_tickers(raw, DEFAULT_TICKERS, limit=20)


def _bias_name(value) -> str:
    normalized = str(value or "neutral").strip().lower()
    if normalized not in BIAS_RANGES:
        raise ValueError("market_bias must be bearish, neutral, or bullish")
    return normalized


def _variant_name(value) -> str:
    normalized = str(value or DEFAULT_STRUCTURE_VARIANT).strip().lower()
    if normalized not in STRUCTURE_VARIANTS:
        raise ValueError(
            "structure_variant must be one of: "
            + ", ".join(STRUCTURE_VARIANTS)
        )
    return normalized


def _upper_line_mode(value) -> str:
    normalized = str(value or "debit").strip().lower()
    if normalized not in UPPER_LINE_MODES:
        raise ValueError("upper_line_mode must be debit or credit")
    return normalized


def _bounded(value, default: float, low: float, high: float) -> float:
    """``value`` clamped to [low, high], or ``default`` only when missing.

    Zero is a real setting for these rules -- no theta floor, a flat T+0
    floor, a zero upper-line band -- so it must not fall back to the default.
    """
    number = _num(value)
    if number is None:
        number = default
    return min(high, max(low, number))


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
    document_rules: bool = True,
    upper_line_target: float | None = None,
) -> tuple:
    theta = candidate.get("theta_dollars_per_day")
    t0 = candidate.get("t0_minus_20_dollars")
    t0_shortfall = (
        max(0.0, min_t0_minus_20_dollars - t0)
        if t0 is not None else math.inf
    )
    delta_error = (
        candidate["upper_long_delta_error"]
        + candidate["body_short_delta_error"]
        + candidate["lower_long_delta_error"]
    )
    execution_cost = candidate.get("execution_cost_dollars") or math.inf
    liquidity = -(candidate.get("open_interest_min") or 0)
    if upper_line_target is not None:
        # The longs were shifted to fit the requested debit or credit, so
        # the target comes first. Unused room above it means the hedge could
        # have sat higher.
        upper_line = candidate.get("upper_flat_dollars") or 0.0
        return (
            max(0.0, upper_line_target - upper_line),
            candidate["upper_long_delta_error"]
            + candidate["body_short_delta_error"],
            max(0.0, upper_line - upper_line_target),
            t0_shortfall,
            execution_cost,
            liquidity,
        )
    if not document_rules:
        # Without CC4's bias band, theta floor and upper-line target, the
        # plan is defined by its three leg deltas; T+0 stress is a floor.
        return (delta_error, t0_shortfall, execution_cost, liquidity)
    return (
        _distance_to_range(
            candidate.get("position_delta"),
            bias_low,
            bias_high,
        ),
        max(0.0, min_theta_dollars - theta) if theta is not None else math.inf,
        t0_shortfall,
        abs(candidate.get("upper_flat_dollars") or 0.0),
        delta_error,
        execution_cost,
        liquidity,
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
    document_rules: bool = True,
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

    if not document_rules:
        # These are the CC4 presentation's targets (and the course values
        # the shared builder starts from); they describe a different trade.
        for key in _DOCUMENT_TARGET_KEYS:
            candidate[key] = None
        return candidate

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


def _upper_line_dollars(
    upper_long: dict,
    body_short: dict,
    lower_long: dict,
    quantity: int,
) -> float:
    """Whole-position P/L above the upper long at expiration: the entry."""
    def mid(leg):
        return _num(leg.get("mid"), 0.0) or 0.0

    return (
        quantity
        * (2.0 * mid(body_short) - mid(upper_long) - 2.0 * mid(lower_long))
        * CONTRACT_MULTIPLIER
    )


def _fit_lower_long(
    pool: list[dict],
    *,
    upper_long: dict,
    body_short: dict,
    quantity: int,
    target_dollars: float,
) -> dict | None:
    """The lower hedge that lands the upper line on the requested cash flow.

    Moving the hedge down makes it cheaper -- less debit, more credit -- but
    deepens the valley past the body; moving it up does the reverse. The
    highest strike whose upper line still meets the target is the least
    downside risk that debit or credit allows. None when no strike meets it.
    """
    meeting = [
        leg for leg in pool
        if _upper_line_dollars(upper_long, body_short, leg, quantity)
        >= target_dollars - 1e-9
    ]
    return max(meeting, key=lambda leg: leg["strike"]) if meeting else None


def _fit_structure(
    legs: list[dict],
    *,
    quantity: int,
    min_lower_wing_ratio: float,
    variant: dict,
    target_dollars: float,
) -> tuple[dict, dict, dict, float] | None:
    """Upper, body and lower legs for a requested opening debit or credit.

    The sold body stays on its delta. The lower longs move first; only when
    no lower long reaches the target does the upper long move down to a
    cheaper strike, keeping the upper/lower pair closest to their deltas.
    Out of reach, the legs nearest the plan's deltas come back with the best
    upper line any combination reached, for the caller to flag.
    """
    upper_target = variant["upper_long_delta"]
    lower_target = variant["lower_long_delta"]
    body = min(
        legs,
        key=lambda leg: abs(abs(leg["delta"]) - variant["body_short_delta"]),
    )
    uppers = sorted(
        [leg for leg in legs if leg["strike"] > body["strike"]],
        key=lambda leg: abs(abs(leg["delta"]) - upper_target),
    )
    if not uppers:
        return None

    def lower_pool(upper):
        width = upper["strike"] - body["strike"]
        return [
            leg for leg in legs
            if (
                leg["strike"] < body["strike"]
                and body["strike"] - leg["strike"]
                >= width * min_lower_wing_ratio
            )
        ]

    nearest = uppers[0]
    lower = _fit_lower_long(
        lower_pool(nearest),
        upper_long=nearest,
        body_short=body,
        quantity=quantity,
        target_dollars=target_dollars,
    )
    if lower is not None:
        return nearest, body, lower, _upper_line_dollars(
            nearest, body, lower, quantity,
        )

    best = None
    best_line = -math.inf
    for upper in uppers:
        # A dearer upper long only adds debit.
        if upper["strike"] > nearest["strike"]:
            continue
        pool = lower_pool(upper)
        if not pool:
            continue
        best_line = max(best_line, max(
            _upper_line_dollars(upper, body, leg, quantity) for leg in pool
        ))
        lower = _fit_lower_long(
            pool,
            upper_long=upper,
            body_short=body,
            quantity=quantity,
            target_dollars=target_dollars,
        )
        if lower is None:
            continue
        miss = (
            abs(abs(upper["delta"]) - upper_target)
            + abs(abs(lower["delta"]) - lower_target)
        )
        if best is None or miss < best[0]:
            best = (miss, upper, lower)
    if best is not None:
        _, upper, lower = best
        return upper, body, lower, _upper_line_dollars(
            upper, body, lower, quantity,
        )

    pool = lower_pool(nearest)
    if not pool:
        return None
    lower = min(pool, key=lambda leg: abs(abs(leg["delta"]) - lower_target))
    return nearest, body, lower, best_line


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
    variant: dict | None = None,
    upper_line_target: float | None = None,
) -> list[dict]:
    variant = variant or STRUCTURE_VARIANTS[DEFAULT_STRUCTURE_VARIANT]
    upper_target = variant["upper_long_delta"]
    body_target = variant["body_short_delta"]
    lower_target = variant["lower_long_delta"]
    document_rules = variant["document_rules"]
    # With a requested opening debit or credit, the bought longs fit it and
    # the sold body keeps its delta. Without one, CC4 balances its lower
    # hedge to the bias band and another plan takes its exact deltas.
    fit_upper_line = upper_line_target is not None
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

    if fit_upper_line:
        fitted = _fit_structure(
            legs,
            quantity=quantity,
            min_lower_wing_ratio=min_lower_wing_ratio,
            variant=variant,
            target_dollars=upper_line_target,
        )
        if fitted is None:
            return []
        upper_long, body_short, lower_long, best_line = fitted
        candidate = _build_butterfly(
            upper_long,
            body_short,
            lower_long,
            spot=spot,
            expiration=expiration,
            dte=dte,
            upper_long_target=upper_target,
            tranche_quantity=quantity,
            lower_long_quantity_multiplier=LOWER_LONG_QUANTITY_MULTIPLIER,
            lower_long_target=lower_target,
            body_short_target=body_target,
            structure_kind="double-hedge-put-butterfly",
            dividend_yield=dividend_yield,
            with_analytics=False,
        )
        if not candidate:
            return []
        candidate["upper_line_best_dollars"] = best_line
        return [_enrich_candidate(
            candidate,
            upper_long=upper_long,
            body_short=body_short,
            lower_long=lower_long,
            spot=spot,
            dte=dte,
            quantity=quantity,
            dividend_yield=dividend_yield,
            document_rules=document_rules,
        )]

    upper_longs = sorted(
        legs,
        key=lambda leg: abs(abs(leg["delta"]) - upper_target),
    )[:upper_limit]
    candidates = []
    seen = set()
    for upper_long in upper_longs:
        body_shorts = sorted(
            [leg for leg in legs if leg["strike"] < upper_long["strike"]],
            key=lambda leg: abs(abs(leg["delta"]) - body_target),
        )[:body_limit]
        for body_short in body_shorts:
            upper_width = upper_long["strike"] - body_short["strike"]
            # CC4 shifts the lower hedge to land the tranche in its bias band
            # before matching the 2.5-delta guide. Without a cash-flow target,
            # another plan takes the strike nearest its lower delta.
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
                    ) if document_rules else 0.0,
                    abs(abs(leg["delta"]) - lower_target),
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
                    upper_long_target=upper_target,
                    tranche_quantity=quantity,
                    lower_long_quantity_multiplier=(
                        LOWER_LONG_QUANTITY_MULTIPLIER
                    ),
                    lower_long_target=lower_target,
                    body_short_target=body_target,
                    structure_kind="double-hedge-put-butterfly",
                    dividend_yield=dividend_yield,
                    # Both plans keep the builder's default and count an
                    # untested finish above the upper long as success. The
                    # 30/12/3 debit is an upper line that can be raised after
                    # entry; the risk that matters is the downside valley.
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
                        document_rules=document_rules,
                    ))

    candidates.sort(key=lambda candidate: _candidate_quality(
        candidate,
        bias_low=bias_low,
        bias_high=bias_high,
        min_theta_dollars=min_theta_dollars,
        min_t0_minus_20_dollars=min_t0_minus_20_dollars,
        document_rules=document_rules,
        upper_line_target=upper_line_target,
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
    document_rules: bool = True,
    upper_line_target: float | None = None,
) -> dict | None:
    if not candidates:
        return None
    fit_upper_line = upper_line_target is not None
    passing = [
        candidate for candidate in candidates
        if (
            candidate["body_short_delta_error"] <= delta_tolerance
            and (
                # Fitted longs answer to the cash-flow target, not to their
                # starting deltas; only the sold body is held to its delta.
                candidate["upper_flat_dollars"] >= upper_line_target - 1e-9
                if fit_upper_line
                else (
                    candidate["upper_long_delta_error"] <= delta_tolerance
                    and candidate["lower_long_delta_error"] <= delta_tolerance
                )
            )
            and candidate["open_interest_min"] >= min_open_interest
            and candidate.get("t0_minus_20_dollars") is not None
            and candidate["t0_minus_20_dollars"] >= min_t0_minus_20_dollars
            and (
                not document_rules
                or (
                    # A fitted trade's position delta is whatever the
                    # requested debit or credit produces.
                    (
                        fit_upper_line
                        or bias_low <= candidate["position_delta"] <= bias_high
                    )
                    and candidate.get("theta_dollars_per_day") is not None
                    and candidate["theta_dollars_per_day"] >= min_theta_dollars
                )
            )
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
            document_rules=document_rules,
            upper_line_target=upper_line_target,
        ),
    )


def _round_488_candidate(candidate: dict) -> dict:
    out = _round_candidate(candidate)
    # The shared rounding keeps two decimals, which would report CC4's
    # 2.5-delta hedge as 0.03 -- the 100-DTE plan's lower target.
    out["target_lower_long_delta"] = _round(
        candidate.get("target_lower_long_delta"),
        3,
    )
    for key, decimals in (
        ("upper_line_best_dollars", 0),
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
    supplied = {
        key: value
        for key, value in (payload or {}).items()
        if value is not None
    }
    variant_name = _variant_name(supplied.get("structure_variant"))
    variant = STRUCTURE_VARIANTS[variant_name]
    document_rules = variant["document_rules"]
    p = {
        **DEFAULTS,
        "target_dte": variant["target_dte"],
        "min_dte": variant["min_dte"],
        "max_dte": variant["max_dte"],
        **supplied,
    }
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    market_bias = _bias_name(p.get("market_bias"))
    target_dte = max(
        MIN_TARGET_DTE,
        min(
            MAX_TARGET_DTE,
            int(_num(p.get("target_dte"), variant["target_dte"])),
        ),
    )
    min_dte = max(
        MIN_TARGET_DTE,
        int(_num(p.get("min_dte"), variant["min_dte"])),
    )
    max_dte = min(
        MAX_TARGET_DTE,
        max(min_dte, int(_num(p.get("max_dte"), variant["max_dte"]))),
    )
    target_dte = min(max_dte, max(min_dte, target_dte))
    quantity = max(
        1,
        min(100, int(_num(p.get("tranche_quantity"), 4) or 4)),
    )
    # One unit is 1/-2/+2; the document's base tranche is four of them. The
    # bias band and every per-tranche dollar default scale with the size.
    scale = quantity / BASE_UPPER_LONG_QUANTITY
    ratio_label = f"{quantity}/-{2 * quantity}/+{2 * quantity}"
    base_bias_low, base_bias_high = BIAS_RANGES[market_bias]
    bias_low = base_bias_low * scale
    bias_high = base_bias_high * scale
    delta_tolerance = min(
        0.10,
        max(0.0025, _num(p.get("delta_tolerance"), 0.02) or 0.02),
    )
    min_theta_dollars = _bounded(
        supplied.get("min_theta_dollars"),
        DEFAULTS["min_theta_dollars"] * scale,
        -5000.0,
        5000.0,
    )
    min_t0_minus_20_dollars = _bounded(
        supplied.get("min_t0_minus_20_dollars"),
        DEFAULTS["min_t0_minus_20_dollars"] * scale,
        -1000000.0,
        0.0,
    )
    uel_tolerance_dollars = _bounded(
        supplied.get("uel_tolerance_dollars"),
        DEFAULTS["uel_tolerance_dollars"] * scale,
        0.0,
        100000.0,
    )
    upper_line_mode = _upper_line_mode(p.get("upper_line_mode"))
    upper_line_amount = _bounded(
        supplied.get("upper_line_amount_dollars"),
        DEFAULTS["upper_line_amount_dollars"] * scale,
        0.0,
        1000000.0,
    )
    # The lowest upper expiration line the trader accepts: a debit is a
    # floor below zero, a credit a floor above it. Both plans fit their
    # bought longs to it, which replaces CC4's bias band and upper-line
    # tolerance as the rule that places the lower hedge.
    upper_line_target = (
        -upper_line_amount if upper_line_mode == "debit"
        else upper_line_amount
    )
    upper_line_label = (
        f"{'debit up to' if upper_line_mode == 'debit' else 'credit of at least'}"
        f" ${upper_line_amount:,.0f}"
    )
    # CC4's bias band and upper-line tolerance only steer a trade built
    # without a requested debit or credit.
    bias_band_applies = document_rules and upper_line_target is None
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
        _num(supplied.get("planned_capital_per_tranche_dollars"))
        or DEFAULTS["planned_capital_per_tranche_dollars"] * scale,
    )
    open_tranches = max(
        0,
        int(_num(p.get("open_tranches"), 0) or 0),
    )
    max_campaign_tranches = int(campaign_capital // per_tranche_capital)
    campaign_capacity_remaining = max(0, max_campaign_tranches - open_tranches)
    after_entry_tranches = open_tranches + 1
    # At four or five warnings the document blocks the prospective entry and
    # hedges the campaign that is already open, one unit per three base
    # 4/-8/+8 tranches -- so twelve 1/-2/+2 tranches are one hedge group.
    hedge_groups = (
        math.ceil(open_tranches * scale / 3) if open_tranches else 0
    )
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
    if not document_rules:
        # The monitors, warnings and campaign plan belong to the CC4
        # presentation; they neither gate nor annotate another plan.
        monitor_flags, monitor_advisories = [], []
    # Each row reports the document rules it was held to. Another plan reports
    # them as None rather than as rules that were never applied.
    document_row_fields = {
        "min_theta_dollars": min_theta_dollars,
        "uel_tolerance_dollars": (
            uel_tolerance_dollars if bias_band_applies else None
        ),
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
    }

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
                variant=variant,
                upper_line_target=upper_line_target,
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
                document_rules=document_rules,
                upper_line_target=upper_line_target,
            ))
            if chosen:
                break

        first_expiration, first_dte = monthlies[0]
        if not chosen:
            reason = (
                "The selected monthly-expiration window has no usable put chain."
                if usable_chains == 0
                else (
                    f"No {variant['delta_label']}-delta {ratio_label} "
                    "combination could be formed."
                )
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

        if bias_band_applies:
            chosen["market_bias"] = market_bias
            chosen["bias_delta_min"] = bias_low
            chosen["bias_delta_max"] = bias_high
            chosen["position_delta_error"] = _distance_to_range(
                chosen.get("position_delta"),
                bias_low,
                bias_high,
            )
        else:
            # The net delta is whatever the legs -- fitted to the requested
            # debit or credit -- produce; there is no band for it to miss.
            chosen["market_bias"] = None
            chosen["bias_delta_min"] = None
            chosen["bias_delta_max"] = None
            chosen["position_delta_error"] = 0.0
        structure_flags = []
        advisories = list(monitor_advisories)
        # Fitted longs are the answer to the cash-flow target, not misses.
        if (
            upper_line_target is None
            and chosen["upper_long_delta_error"] > delta_tolerance
        ):
            structure_flags.append("Upper long delta is outside tolerance")
        if chosen["body_short_delta_error"] > delta_tolerance:
            structure_flags.append("Body short delta is outside tolerance")
        if upper_line_target is not None:
            if chosen["upper_flat_dollars"] < upper_line_target - 1e-9:
                best_line = chosen.get("upper_line_best_dollars")
                structure_flags.append(
                    f"No upper and lower long combination reaches a "
                    f"{upper_line_label}"
                    + (
                        f"; the closest is ${best_line:,.0f}"
                        if best_line is not None and math.isfinite(best_line)
                        else ""
                    )
                )
        elif chosen["lower_long_delta_error"] > delta_tolerance:
            structure_flags.append(
                "Lower hedge delta is outside tolerance after bias balancing"
                if document_rules
                else "Lower hedge delta is outside tolerance"
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
        if document_rules and (theta is None or theta < min_theta_dollars):
            structure_flags.append("ATM theta is below the document minimum")
        t0_minus_20 = chosen.get("t0_minus_20_dollars")
        if t0_minus_20 is None or t0_minus_20 < min_t0_minus_20_dollars:
            structure_flags.append(
                "Modeled T+0 at -20% is worse than the document limit"
                if document_rules
                else "Modeled T+0 at -20% is worse than the scan limit"
            )
        if (
            bias_band_applies
            and abs(chosen["upper_flat_dollars"]) > uel_tolerance_dollars
        ):
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
                "not_applicable" if not document_rules
                else "ready" if not monitor_flags
                else "unfavorable" if any(
                    "unfavorable" in flag for flag in monitor_flags
                )
                else "unconfirmed"
            ),
            "flags": [*blocking_flags, *advisories],
            "blocking_flags": blocking_flags,
            "structure_flags": structure_flags,
            "monitor_flags": monitor_flags,
            "structure_variant": variant_name,
            "structure_variant_label": variant["label"],
            "ratio_label": ratio_label,
            "upper_line_mode": (
                None if upper_line_target is None else upper_line_mode
            ),
            "upper_line_amount_dollars": (
                None if upper_line_target is None else upper_line_amount
            ),
            "upper_line_target_dollars": upper_line_target,
            "scanner_variant": (
                f"double-hedge-put-butterfly-{market_bias}-q{quantity}"
                if document_rules
                else f"double-hedge-put-butterfly-{variant_name}-q{quantity}"
            ),
            "min_t0_minus_20_dollars": min_t0_minus_20_dollars,
            **(document_row_fields if document_rules else {
                key: None for key in document_row_fields
            }),
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
        t0_shortfall = (
            max(0.0, min_t0_minus_20_dollars - t0_value)
            if t0_value is not None else math.inf
        )
        if not document_rules:
            held_legs = (
                ("upper_long_delta_error", "body_short_delta_error")
                if upper_line_target is not None
                else (
                    "upper_long_delta_error",
                    "body_short_delta_error",
                    "lower_long_delta_error",
                )
            )
            return (
                row.get("status") != "actionable",
                row.get("structural_status") != "matched",
                t0_shortfall,
                sum(row.get(key) or 0.0 for key in held_legs),
            )
        return (
            row.get("status") != "actionable",
            row.get("structural_status") != "matched",
            row.get("position_delta_error", math.inf),
            (
                max(0.0, min_theta_dollars - theta_value)
                if theta_value is not None else math.inf
            ),
            t0_shortfall,
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
    document_params = {
        # Reported only when they placed the lower hedge.
        "market_bias": market_bias if bias_band_applies else None,
        "bias_delta_min": bias_low if bias_band_applies else None,
        "bias_delta_max": bias_high if bias_band_applies else None,
        "min_theta_dollars": min_theta_dollars,
        "uel_tolerance_dollars": (
            uel_tolerance_dollars if bias_band_applies else None
        ),
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
    }

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
            "structure_variant": variant_name,
            "structure_variant_label": variant["label"],
            "document_rules": document_rules,
            "leg_delta_targets": {
                "upper_long": variant["upper_long_delta"],
                "body_short": variant["body_short_delta"],
                "lower_long": variant["lower_long_delta"],
            },
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "tranche_quantity": quantity,
            "ratio_label": ratio_label,
            "upper_line_mode": (
                None if upper_line_target is None else upper_line_mode
            ),
            "upper_line_amount_dollars": (
                None if upper_line_target is None else upper_line_amount
            ),
            "upper_line_target_dollars": upper_line_target,
            "delta_tolerance": delta_tolerance,
            "min_t0_minus_20_dollars": min_t0_minus_20_dollars,
            "min_lower_wing_ratio": min_lower_wing_ratio,
            "min_open_interest": min_open_interest,
            **(document_params if document_rules else {
                key: None for key in document_params
            }),
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
            structure_variants=[
                {
                    "id": name,
                    "label": variant["label"],
                    "upper_long_delta": variant["upper_long_delta"],
                    "body_short_delta": variant["body_short_delta"],
                    "lower_long_delta": variant["lower_long_delta"],
                    "target_dte": variant["target_dte"],
                    "min_dte": variant["min_dte"],
                    "max_dte": variant["max_dte"],
                    "document_rules": variant["document_rules"],
                }
                for name, variant in STRUCTURE_VARIANTS.items()
            ],
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
