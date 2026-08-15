"""Call-side mirror of the risk-budgeted put-condor scanner.

The structure uses four calls in one expiration::

    BUY  lower long call
    SELL lower short call       1-point debit spread near spot
    SELL upper short call       user-selected 10-20 delta
    BUY  upper long call        automatically sized risk wing

Below every strike the calls expire worthless and the opening credit remains.
Above every strike, the wider upper credit spread defines maximum risk.
"""

from __future__ import annotations

from datetime import datetime
import math

import yfinance as yf

from call_scanner import _load_call_chain
from options_pricing import black_scholes
from put_condor_scanner import (
    ALLOWED_UNDERLYINGS,
    CREDIT_SHORT_DELTA_MAX,
    CREDIT_SHORT_DELTA_MIN,
    CREDIT_SHORT_DELTA_TOLERANCE,
    DEBIT_PAIR_ATTEMPTS,
    DEBIT_WIDTH,
    DEFAULTS,
    PLACEMENT_TOLERANCE_PCT,
    WIDTH_EPSILON,
    _candidate_quality,
    _ranked_expirations,
)
from put_scanner import (
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    RISK_FREE,
    _fetch_fundamentals_bulk,
    _load_history,
    _num,
    _prepare_option_quote,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)
from unbalanced_put_condor_scanner import (
    CONTRACT_MULTIPLIER,
    EARLY_CLOSE_FRACTIONS,
    MAX_EXPIRATION_ATTEMPTS,
    MIN_QUOTED_LEGS_BELOW_SPOT,
    _elapsed_days_for_fraction,
    _has_credible_iv,
    _leg_view,
    _norm_cdf,
    _quotable,
    _round_candidate,
)


def _tradable_call_leg(leg: dict, spot: float) -> bool:
    strike = _num(leg.get("strike"))
    return bool(
        (_quotable(leg) or leg.get("quote_source") == "last_trade_estimate")
        and _has_credible_iv(leg)
        and leg.get("delta") is not None
        and strike is not None
        and strike > spot
    )


def _call_chain_quality(calls: list[dict], spot: float) -> dict:
    above_spot = [
        leg for leg in calls
        if (_num(leg.get("strike")) or 0) > spot
    ]
    return {
        "strikes": len(calls),
        "strikes_above_spot": len(above_spot),
        "quoted_above_spot": sum(
            1 for leg in above_spot if _quotable(leg) and _has_credible_iv(leg)
        ),
        "usable_above_spot": sum(
            1 for leg in above_spot if _tradable_call_leg(leg, spot)
        ),
    }


def _stale_call_chain_reason(expirations_tried: list[tuple[str, dict]]) -> str:
    expiration, quality = max(
        expirations_tried,
        key=lambda item: item[1]["usable_above_spot"],
    )
    return (
        f"No usable call quotes: the best of {len(expirations_tried)} expirations "
        f"tried ({expiration}) had defensible prices on only "
        f"{quality['usable_above_spot']} of {quality['strikes_above_spot']} call "
        f"strikes above spot, short of the {MIN_QUOTED_LEGS_BELOW_SPOT} needed "
        f"to choose a four-leg structure."
    )


def _prob_finish_above(
    spot: float,
    barrier: float,
    years: float,
    volatility: float,
    rate: float = RISK_FREE,
    dividend_yield: float = 0.0,
) -> float | None:
    if spot <= 0 or barrier <= 0 or years < 0 or volatility < 0:
        return None
    if years == 0 or volatility == 0:
        terminal = spot * math.exp((rate - dividend_yield) * years)
        return 1.0 if terminal >= barrier else 0.0
    sigma_root_t = volatility * math.sqrt(years)
    log_drift = (rate - dividend_yield - 0.5 * volatility * volatility) * years
    threshold = (math.log(barrier / spot) - log_drift) / sigma_root_t
    return min(1.0, max(0.0, 1.0 - _norm_cdf(threshold)))


def _prob_touch_upper(
    spot: float,
    barrier: float,
    years: float,
    volatility: float,
    rate: float = RISK_FREE,
    dividend_yield: float = 0.0,
) -> float | None:
    """GBM first-passage probability of touching an upper barrier."""
    if spot <= 0 or barrier <= 0 or years < 0 or volatility < 0:
        return None
    if barrier <= spot:
        return 1.0
    if years == 0 or volatility == 0:
        return 0.0
    distance = math.log(barrier / spot)
    drift = rate - dividend_yield - 0.5 * volatility * volatility
    sigma_root_t = volatility * math.sqrt(years)
    first = _norm_cdf((drift * years - distance) / sigma_root_t)
    reflection = math.exp(
        max(-700.0, min(700.0, 2.0 * drift * distance / (volatility * volatility)))
    ) * _norm_cdf((-drift * years - distance) / sigma_root_t)
    return min(1.0, max(0.0, first + reflection))


def _placement_target(spot: float, mode: str, otm_pct: float) -> tuple[float, float]:
    effective_otm = 0.0 if mode == "atm" else max(0.0, otm_pct)
    return spot * (1.0 + effective_otm / 100.0), effective_otm


def _debit_pairs(
    calls: list[dict],
    spot: float,
    mode: str,
    otm_pct: float,
) -> list[tuple[dict, dict, float]]:
    legs = sorted(
        (leg for leg in calls if _tradable_call_leg(leg, spot)),
        key=lambda leg: leg["strike"],
    )
    target, _ = _placement_target(spot, mode, otm_pct)
    by_strike = {round(float(leg["strike"]), 4): leg for leg in legs}
    pairs = []
    for debit_long in legs:
        long_strike = float(debit_long["strike"])
        debit_short = by_strike.get(round(long_strike + DEBIT_WIDTH, 4))
        if debit_short is None:
            debit_short = next(
                (
                    leg for leg in legs
                    if abs((float(leg["strike"]) - long_strike) - DEBIT_WIDTH)
                    <= WIDTH_EPSILON
                ),
                None,
            )
        if debit_short is None:
            continue
        pairs.append((debit_long, debit_short, abs(long_strike - target)))
    pairs.sort(key=lambda item: (item[2], item[0]["strike"]))
    return pairs[:DEBIT_PAIR_ATTEMPTS]


def _deltas_are_ordered(*legs: dict) -> bool:
    deltas = []
    for leg in legs:
        delta = _num(leg.get("delta"))
        if delta is None:
            return False
        deltas.append(abs(delta))
    return all(lower <= higher + 0.005 for higher, lower in zip(deltas, deltas[1:]))


def _position_delta(*legs_and_sides) -> float | None:
    total = 0.0
    for leg, side in legs_and_sides:
        delta = _num(leg.get("delta"))
        if delta is None:
            return None
        total += side * delta
    return total


def _build_call_condor(
    debit_long: dict,
    debit_short: dict,
    credit_short: dict,
    credit_long: dict,
    *,
    spot: float,
    expiration: str,
    dte: int,
    placement_mode: str,
    target_otm_pct: float,
    max_risk_dollars: float,
    target_upper_credit_dollars: float,
    max_upper_credit_dollars: float,
    target_credit_short_delta: float,
    dividend_yield: float = 0.0,
) -> dict | None:
    k1, k2, k3, k4 = (
        _num(debit_long.get("strike")),
        _num(debit_short.get("strike")),
        _num(credit_short.get("strike")),
        _num(credit_long.get("strike")),
    )
    if not all(value is not None and value > 0 for value in (k1, k2, k3, k4)):
        return None
    if not (spot < k1 < k2 < k3 < k4):
        return None
    if not _deltas_are_ordered(debit_long, debit_short, credit_short, credit_long):
        return None

    debit_width = k2 - k1
    credit_width = k4 - k3
    if abs(debit_width - DEBIT_WIDTH) > WIDTH_EPSILON:
        return None
    if credit_width <= DEBIT_WIDTH + WIDTH_EPSILON:
        return None
    bought_debit = (_num(debit_long.get("mid"), 0.0) or 0.0) - (_num(debit_short.get("mid"), 0.0) or 0.0)
    sold_credit = (_num(credit_short.get("mid"), 0.0) or 0.0) - (_num(credit_long.get("mid"), 0.0) or 0.0)
    if bought_debit <= 0 or sold_credit <= 0:
        return None
    entry_credit = sold_credit - bought_debit
    lower_flat = entry_credit
    center_profit = entry_credit + debit_width
    upper_flat = center_profit - credit_width
    max_profit = max(lower_flat, center_profit, upper_flat)
    max_loss = max(0.0, -min(lower_flat, center_profit, upper_flat))
    upper_credit_dollars = entry_credit * CONTRACT_MULTIPLIER
    if upper_credit_dollars <= 0 or upper_credit_dollars > max_upper_credit_dollars:
        return None
    if max_loss <= 0 or max_loss * CONTRACT_MULTIPLIER > max_risk_dollars + 0.01:
        return None

    target_strike, effective_otm_pct = _placement_target(spot, placement_mode, target_otm_pct)
    actual_otm_pct = (k1 - spot) / spot * 100.0
    if abs(actual_otm_pct - effective_otm_pct) > PLACEMENT_TOLERANCE_PCT:
        return None

    structure_legs = (debit_long, debit_short, credit_short, credit_long)
    all_live = all(_quotable(leg) for leg in structure_legs)
    natural_credit = (
        (_num(debit_short.get("bid"), 0.0) or 0.0)
        - (_num(debit_long.get("ask"), 0.0) or 0.0)
        + (_num(credit_short.get("bid"), 0.0) or 0.0)
        - (_num(credit_long.get("ask"), 0.0) or 0.0)
        if all_live else None
    )
    execution_cost = (
        sum(
            (_num(leg.get("ask"), 0.0) or 0.0)
            - (_num(leg.get("bid"), 0.0) or 0.0)
            for leg in structure_legs
        ) if all_live else None
    )
    actual_credit_delta = abs(_num(credit_short.get("delta"), 0.0) or 0.0)
    raw_delta = _position_delta(
        (debit_long, 1), (debit_short, -1),
        (credit_short, -1), (credit_long, 1),
    )
    oi_min = min(int(_num(leg.get("open_interest"), 0) or 0) for leg in structure_legs)
    volume_min = min(int(_num(leg.get("volume"), 0) or 0) for leg in structure_legs)
    upper_breakeven = k3 + center_profit if upper_flat < 0 < center_profit else None

    years = max(dte, 0) / 365.0
    front_iv = _num(debit_long.get("iv"))
    probability_iv = _num(credit_short.get("iv"))
    touch_debit = _prob_touch_upper(spot, k1, years, front_iv, RISK_FREE, dividend_yield) if front_iv else None
    finish_debit = _prob_finish_above(spot, k1, years, front_iv, RISK_FREE, dividend_yield) if front_iv else None
    touch_credit = _prob_touch_upper(spot, k3, years, probability_iv, RISK_FREE, dividend_yield) if probability_iv else None
    finish_credit = _prob_finish_above(spot, k3, years, probability_iv, RISK_FREE, dividend_yield) if probability_iv else None
    touch_long = _prob_touch_upper(spot, k4, years, probability_iv, RISK_FREE, dividend_yield) if probability_iv else None
    finish_long = _prob_finish_above(spot, k4, years, probability_iv, RISK_FREE, dividend_yield) if probability_iv else None
    debit_distance_sigma = (
        math.log(k1 / spot) / (front_iv * math.sqrt(years))
        if front_iv and years > 0 else None
    )
    credit_distance_sigma = (
        math.log(k3 / spot) / (probability_iv * math.sqrt(years))
        if probability_iv and years > 0 else None
    )
    schedule = []
    if front_iv:
        for fraction in EARLY_CLOSE_FRACTIONS:
            elapsed_days = _elapsed_days_for_fraction(dte, fraction)
            if elapsed_days is None:
                continue
            probability = _prob_touch_upper(
                spot, k1, elapsed_days / 365.0, front_iv, RISK_FREE, dividend_yield,
            )
            if probability is not None:
                schedule.append({
                    "elapsed_fraction": elapsed_days / dte,
                    "elapsed_days": elapsed_days,
                    "remaining_dte": dte - elapsed_days,
                    "prob_touch_pct": probability * 100.0,
                })

    return {
        "option_side": "call",
        "option_type": "call",
        "expiration": expiration,
        "dte": dte,
        "construction": "At the money" if placement_mode == "atm" else f"{effective_otm_pct:g}% OTM",
        "placement_mode": placement_mode,
        "target_debit_otm_pct": effective_otm_pct,
        "actual_debit_otm_pct": actual_otm_pct,
        "debit_target_strike": target_strike,
        "debit_placement_error_points": abs(k1 - target_strike),
        "debit_long_strike": k1,
        "debit_short_strike": k2,
        "credit_short_strike": k3,
        "credit_long_strike": k4,
        "debit_long_leg": _leg_view(debit_long),
        "debit_short_leg": _leg_view(debit_short),
        "credit_short_leg": _leg_view(credit_short),
        "credit_long_leg": _leg_view(credit_long),
        "debit_width": debit_width,
        "credit_width": credit_width,
        "bought_width": debit_width,
        "sold_width": credit_width,
        "spread_gap": k3 - k2,
        "bought_quantity": 1,
        "sold_quantity": 1,
        "bought_debit_per_spread": bought_debit,
        "sold_credit_per_spread": sold_credit,
        "bought_debit": bought_debit,
        "sold_credit": sold_credit,
        "entry_credit": entry_credit,
        "entry_debit": 0.0,
        "natural_credit": natural_credit,
        "execution_cost": execution_cost,
        "bought_debit_dollars": bought_debit * CONTRACT_MULTIPLIER,
        "sold_credit_dollars": sold_credit * CONTRACT_MULTIPLIER,
        "entry_credit_dollars": upper_credit_dollars,
        "entry_debit_dollars": 0.0,
        "natural_credit_dollars": natural_credit * CONTRACT_MULTIPLIER if natural_credit is not None else None,
        "execution_cost_dollars": execution_cost * CONTRACT_MULTIPLIER if execution_cost is not None else None,
        "quote_source": "live_bid_ask" if all_live else "last_trade_estimate",
        "uses_last_trade_prices": not all_live,
        "lower_flat_outcome": lower_flat,
        "center_max_profit": center_profit,
        "upper_flat_outcome": upper_flat,
        "near_flat_outcome": lower_flat,
        "near_flat_dollars": lower_flat * CONTRACT_MULTIPLIER,
        "far_flat_outcome": upper_flat,
        "far_flat_dollars": upper_flat * CONTRACT_MULTIPLIER,
        "near_flat_label": "Lower flat",
        "far_flat_label": "Upper flat",
        "max_profit": max_profit,
        "max_loss": max_loss,
        "max_profit_dollars": max_profit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": max_loss * CONTRACT_MULTIPLIER,
        "lower_flat_dollars": lower_flat * CONTRACT_MULTIPLIER,
        "upper_flat_dollars": upper_flat * CONTRACT_MULTIPLIER,
        "return_on_risk_pct": max_profit / max_loss * 100.0 if max_loss > 0 else None,
        "annualized_return_on_risk_pct": max_profit / max_loss * 100.0 * 365.0 / dte if max_loss > 0 and dte else None,
        "lower_breakeven": None,
        "upper_breakeven": upper_breakeven,
        "risk_breakeven": upper_breakeven,
        "risk_breakeven_cushion_pct": (upper_breakeven - spot) / spot * 100.0 if upper_breakeven else None,
        "risk_direction": "upside",
        "position_delta": raw_delta * CONTRACT_MULTIPLIER if raw_delta is not None else None,
        "position_delta_per_share": raw_delta,
        "actual_upper_short_delta": abs(_num(debit_short.get("delta"), 0.0) or 0.0),
        "actual_lower_short_delta": actual_credit_delta,
        "target_credit_short_delta": target_credit_short_delta,
        "actual_credit_short_delta": actual_credit_delta,
        "credit_short_delta_error": abs(actual_credit_delta - target_credit_short_delta),
        "max_risk_limit_dollars": max_risk_dollars,
        "risk_remaining_dollars": max_risk_dollars - max_loss * CONTRACT_MULTIPLIER,
        "risk_utilization_pct": max_loss * CONTRACT_MULTIPLIER / max_risk_dollars * 100.0,
        "target_upper_credit_dollars": target_upper_credit_dollars,
        "upper_credit_error_dollars": abs(upper_credit_dollars - target_upper_credit_dollars),
        "prob_touch_debit_long_pct": touch_debit * 100.0 if touch_debit is not None else None,
        "prob_finish_beyond_debit_long_pct": finish_debit * 100.0 if finish_debit is not None else None,
        "prob_touch_credit_short_pct": touch_credit * 100.0 if touch_credit is not None else None,
        "prob_finish_beyond_credit_short_pct": finish_credit * 100.0 if finish_credit is not None else None,
        "prob_touch_credit_long_pct": touch_long * 100.0 if touch_long is not None else None,
        "prob_finish_beyond_credit_long_pct": finish_long * 100.0 if finish_long is not None else None,
        "debit_long_distance_sigma": debit_distance_sigma,
        "credit_short_distance_sigma": credit_distance_sigma,
        "debit_long_touch_schedule": schedule,
        "probability_iv": probability_iv,
        "debit_long_probability_iv": front_iv,
        "open_interest_min": oi_min,
        "volume_min": volume_min,
    }


def _position_pl_at_exit(
    candidate: dict,
    exit_spot: float,
    remaining_years: float,
    dividend_yield: float = 0.0,
) -> float | None:
    legs = (
        (candidate.get("debit_long_leg") or {}, 1),
        (candidate.get("debit_short_leg") or {}, -1),
        (candidate.get("credit_short_leg") or {}, -1),
        (candidate.get("credit_long_leg") or {}, 1),
    )
    mark = 0.0
    for leg, signed_quantity in legs:
        strike, volatility = _num(leg.get("strike")), _num(leg.get("iv"))
        if not strike or not volatility:
            return None
        mark += signed_quantity * black_scholes(
            exit_spot, strike, remaining_years, RISK_FREE,
            dividend_yield, volatility, "call",
        )["price"]
    return (_num(candidate.get("entry_credit"), 0.0) or 0.0) + mark


def _early_close_estimate(
    candidate: dict,
    spot: float,
    dte: int,
    elapsed_fraction: float,
    dividend_yield: float = 0.0,
) -> dict | None:
    volatility = _num(candidate.get("probability_iv"))
    elapsed_days = _elapsed_days_for_fraction(dte, elapsed_fraction)
    if not volatility or elapsed_days is None:
        return None
    remaining_dte = dte - elapsed_days
    elapsed_years = elapsed_days / 365.0
    remaining_years = remaining_dte / 365.0
    sigma_root_t = volatility * math.sqrt(elapsed_years)
    log_drift = (RISK_FREE - dividend_yield - 0.5 * volatility * volatility) * elapsed_years

    def spot_at_z(z_score):
        return spot * math.exp(log_drift + sigma_root_t * z_score)

    def profit_at_z(z_score):
        return _position_pl_at_exit(candidate, spot_at_z(z_score), remaining_years, dividend_yield)

    z_grid = [-8.0 + index * 0.10 for index in range(161)]
    p_grid = [profit_at_z(z) for z in z_grid]
    if any(value is None for value in p_grid):
        return None
    roots = []
    for index in range(1, len(z_grid)):
        low_z, high_z = z_grid[index - 1], z_grid[index]
        low_p, high_p = p_grid[index - 1], p_grid[index]
        if low_p * high_p > 0:
            continue
        if low_p == 0:
            root = low_z
        elif high_p == 0:
            root = high_z
        else:
            for _ in range(45):
                mid_z = (low_z + high_z) / 2.0
                mid_p = profit_at_z(mid_z)
                if mid_p is None:
                    return None
                if low_p * mid_p <= 0:
                    high_z, high_p = mid_z, mid_p
                else:
                    low_z, low_p = mid_z, mid_p
            root = (low_z + high_z) / 2.0
        if not roots or abs(root - roots[-1]) > 1e-7:
            roots.append(root)
    boundaries = [-math.inf, *roots, math.inf]
    probability = 0.0
    ranges = []
    for index in range(1, len(boundaries)):
        low_z, high_z = boundaries[index - 1], boundaries[index]
        probe = high_z - 1 if math.isinf(low_z) else low_z + 1 if math.isinf(high_z) else (low_z + high_z) / 2
        if (profit_at_z(probe) or 0.0) <= 0:
            continue
        low_prob = 0.0 if math.isinf(low_z) else _norm_cdf(low_z)
        high_prob = 1.0 if math.isinf(high_z) else _norm_cdf(high_z)
        probability += high_prob - low_prob
        ranges.append({
            "lower": None if math.isinf(low_z) else spot_at_z(low_z),
            "upper": None if math.isinf(high_z) else spot_at_z(high_z),
        })
    return {
        "elapsed_fraction": elapsed_days / dte,
        "elapsed_days": elapsed_days,
        "remaining_dte": remaining_dte,
        "probability_profit_pct": probability * 100.0,
        "profitable_ranges": ranges,
    }


def _candidates_for_expiration(
    calls: list[dict],
    **params,
) -> list[dict]:
    spot = params["spot"]
    legs = sorted(
        (leg for leg in calls if _tradable_call_leg(leg, spot)),
        key=lambda leg: leg["strike"],
    )
    pairs = _debit_pairs(
        legs, spot, params["placement_mode"], params["target_otm_pct"],
    )
    max_width = (
        DEBIT_WIDTH
        + params["max_risk_dollars"] / CONTRACT_MULTIPLIER
        + params["max_upper_credit_dollars"] / CONTRACT_MULTIPLIER
        + WIDTH_EPSILON
    )
    candidates = []
    for debit_long, debit_short, _ in pairs:
        for credit_short in legs:
            if credit_short["strike"] <= debit_short["strike"]:
                continue
            for credit_long in legs:
                width = credit_long["strike"] - credit_short["strike"]
                if width <= DEBIT_WIDTH + WIDTH_EPSILON or width > max_width:
                    continue
                candidate = _build_call_condor(
                    debit_long, debit_short, credit_short, credit_long, **params,
                )
                if candidate:
                    candidates.append(candidate)
    candidates.sort(key=_candidate_quality)
    return candidates


def _round_call_result(candidate: dict) -> dict:
    out = _round_candidate(candidate)
    for key in (
        "entry_credit_dollars", "natural_credit_dollars", "near_flat_dollars",
        "target_upper_credit_dollars", "upper_credit_error_dollars",
    ):
        out[key] = _round(candidate.get(key), 2)
    for key, decimals in (
        ("actual_debit_otm_pct", 2), ("target_debit_otm_pct", 2),
        ("debit_target_strike", 2), ("debit_placement_error_points", 2),
        ("debit_long_strike", 2), ("debit_short_strike", 2),
        ("credit_short_strike", 2), ("credit_long_strike", 2),
        ("debit_width", 2), ("credit_width", 2), ("spread_gap", 2),
        ("near_flat_outcome", 2), ("far_flat_outcome", 2),
        ("near_flat_dollars", 2), ("far_flat_dollars", 0),
        ("risk_breakeven", 2), ("risk_breakeven_cushion_pct", 1),
        ("max_risk_limit_dollars", 0), ("risk_remaining_dollars", 0),
        ("risk_utilization_pct", 1), ("annualized_return_on_risk_pct", 1),
        ("target_credit_short_delta", 3), ("actual_credit_short_delta", 3),
        ("credit_short_delta_error", 3), ("prob_touch_debit_long_pct", 1),
        ("prob_finish_beyond_debit_long_pct", 1), ("prob_touch_credit_short_pct", 1),
        ("prob_finish_beyond_credit_short_pct", 1), ("debit_long_distance_sigma", 2),
        ("credit_short_distance_sigma", 2),
    ):
        out[key] = _round(out.get(key), decimals)
    out["debit_long_touch_schedule"] = [
        {**step, "elapsed_fraction": _round(step.get("elapsed_fraction"), 3), "prob_touch_pct": _round(step.get("prob_touch_pct"), 1)}
        for step in candidate.get("debit_long_touch_schedule", [])
    ]
    return out


def run_call_condor_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}
    underlying = str(p.get("underlying") or "").strip().upper()
    if underlying not in ALLOWED_UNDERLYINGS:
        raise ValueError("Underlying must be ^XSP or SPY")
    placement_mode = str(p.get("placement_mode") or "slightly_otm").strip().lower()
    if placement_mode not in {"atm", "slightly_otm"}:
        raise ValueError("Debit-spread placement must be at the money or slightly OTM")
    target_otm_pct = min(5.0, max(0.0, _num(p.get("debit_otm_pct"), 0.5) or 0.0))
    min_dte = max(MIN_TARGET_DTE, int(_num(p.get("min_dte"), 30)))
    max_dte = min(MAX_TARGET_DTE, max(min_dte, int(_num(p.get("max_dte"), 60))))
    target_dte = min(max_dte, max(min_dte, int(_num(p.get("target_dte"), 42))))
    max_risk = min(100000.0, max(25.0, _num(p.get("max_risk_dollars"), 200.0) or 200.0))
    target_delta = min(CREDIT_SHORT_DELTA_MAX, max(CREDIT_SHORT_DELTA_MIN, _num(p.get("credit_short_delta"), 0.15) or 0.15))
    target_credit = min(5000.0, max(1.0, _num(p.get("target_upper_credit_dollars"), 10.0) or 10.0))
    max_credit = min(5000.0, max(target_credit, _num(p.get("max_upper_credit_dollars"), 25.0) or 25.0))
    min_oi = max(0, int(_num(p.get("min_open_interest"), 0) or 0))
    max_results = max(1, min(12, int(_num(p.get("max_results"), 4) or 4)))

    history = _load_history([underlying])
    frame = _ticker_frame(history, underlying)
    close = frame["Close"].dropna() if frame is not None else []
    spot = _num(close.iloc[-1]) if len(close) else None
    if not spot:
        return {"rows": [], "unavailable": [{"ticker": underlying, "option_side": "call", "reason": "Current underlying price is unavailable."}], "stats": {"expirations_checked": 0, "structures_found": 0, "actionable": 0, "near_matches": 0}, "as_of": datetime.now().isoformat(timespec="seconds")}
    try:
        expirations = list(yf.Ticker(underlying).options or [])
    except Exception:
        expirations = []
    ranked = _ranked_expirations(expirations, target_dte, min_dte, max_dte)
    if not ranked:
        return {"rows": [], "unavailable": [{"ticker": underlying, "option_side": "call", "price": _round(spot), "reason": f"No listed expiration is between {min_dte} and {max_dte} DTE."}], "stats": {"expirations_checked": 0, "structures_found": 0, "actionable": 0, "near_matches": 0}, "as_of": datetime.now().isoformat(timespec="seconds")}

    fundamentals = _fetch_fundamentals_bulk([underlying])
    div_yield = dividend_yield_for_pricing(fundamentals.get(underlying, {}), spot)
    rows, thin, checked = [], [], 0
    for expiration, dte in ranked[: max(MAX_EXPIRATION_ATTEMPTS, max_results)]:
        raw = _load_call_chain(underlying, expiration, spot, div_yield)
        prepared = [
            quote for quote in (
                _prepare_option_quote(leg, option_type="call", spot=spot, dte=dte, dividend_yield=div_yield)
                for leg in raw if (_num(leg.get("strike")) or 0) > spot
            ) if quote is not None
        ]
        prepared_by_strike = {_num(leg.get("strike")): leg for leg in prepared}
        quality_legs = [prepared_by_strike.get(_num(leg.get("strike")), leg) for leg in raw]
        quality = _call_chain_quality(quality_legs, spot)
        if quality["usable_above_spot"] < MIN_QUOTED_LEGS_BELOW_SPOT:
            thin.append((expiration, quality))
            continue
        checked += 1
        live = [leg for leg in prepared if _quotable(leg)]
        calls = live if len(live) >= MIN_QUOTED_LEGS_BELOW_SPOT else prepared
        candidates = _candidates_for_expiration(
            calls,
            spot=spot, expiration=expiration, dte=dte,
            placement_mode=placement_mode, target_otm_pct=target_otm_pct,
            max_risk_dollars=max_risk, target_upper_credit_dollars=target_credit,
            max_upper_credit_dollars=max_credit, target_credit_short_delta=target_delta,
            dividend_yield=div_yield,
        )
        if not candidates:
            continue
        best = candidates[0]
        flags, blockers = [], []
        if best.get("uses_last_trade_prices"):
            blockers.append("Live bid/ask unavailable - analysis only")
        if best.get("open_interest_min", 0) < min_oi:
            blockers.append("One or more legs are below minimum open interest")
        if best.get("natural_credit") is None or best.get("natural_credit") <= 0:
            blockers.append("Mid is a credit but the natural market is not")
        if best.get("credit_short_delta_error", 1.0) > CREDIT_SHORT_DELTA_TOLERANCE:
            blockers.append("Credit short call is more than 2 delta points from target")
        if best.get("risk_utilization_pct", 0) < 70:
            flags.append("Listed strikes leave part of the selected risk budget unused")
        flags.extend(blockers)
        best.update({
            "ticker": underlying, "name": ALLOWED_UNDERLYINGS[underlying], "price": spot,
            "status": "actionable" if not blockers else "near_match", "flags": flags,
            "scanner_variant": f"call-risk-{max_risk:g}-{placement_mode}-d{target_delta * 100:g}",
        })
        best["early_close_estimates"] = [
            estimate for fraction in EARLY_CLOSE_FRACTIONS
            if (estimate := _early_close_estimate(best, spot, dte, fraction, div_yield)) is not None
        ]
        rows.append(_round_call_result(best))
        if len(rows) >= max_results:
            break
    rows.sort(key=lambda row: (row.get("status") != "actionable", row.get("credit_short_delta_error") or 0, abs((row.get("dte") or target_dte) - target_dte)))
    unavailable = []
    if not rows:
        reason = _stale_call_chain_reason(thin) if thin and not checked else (
            "No quoted call condor simultaneously matched the selected short-call delta, positive lower-line credit, exact 1-point debit spread, and maximum-risk limit."
        )
        unavailable.append({"ticker": underlying, "option_side": "call", "price": _round(spot), "reason": reason, "chain_quality": max(thin, key=lambda item: item[1]["usable_above_spot"])[1] if thin else None})
    return {
        "rows": rows,
        "unavailable": unavailable,
        "stats": {"expirations_checked": checked, "structures_found": len(rows), "actionable": sum(1 for row in rows if row["status"] == "actionable"), "near_matches": sum(1 for row in rows if row["status"] == "near_match")},
        "params": {"option_side": "call", "underlying": underlying, "placement_mode": placement_mode, "debit_otm_pct": target_otm_pct, "target_dte": target_dte, "min_dte": min_dte, "max_dte": max_dte, "debit_width": DEBIT_WIDTH, "max_risk_dollars": max_risk, "credit_short_delta": target_delta, "target_upper_credit_dollars": target_credit, "max_upper_credit_dollars": max_credit, "min_open_interest": min_oi},
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }
