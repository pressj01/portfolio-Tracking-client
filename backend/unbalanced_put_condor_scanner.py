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

from option_probability import price_scenario_schedule
from options_pricing import black_scholes
from put_scanner import (
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    RISK_FREE,
    _clean_tickers,
    _fetch_fundamentals_bulk,
    _index_only_tickers,
    _load_history,
    _load_put_chain,
    _num,
    _prepare_put_quote,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)


CONTRACT_MULTIPLIER = 100.0
EARLY_CLOSE_FRACTIONS = (0.50, 2.0 / 3.0)
DELTA_PRESETS = {
    "15/5": (0.15, 0.05),
    "20/10": (0.20, 0.10),
    "25/15": (0.25, 0.15),
}
# When the upstream IV solver cannot converge - which is every contract without
# a live quote, so most of the chain outside market hours - it reports a halving
# sequence (0.5, 0.25, ... 1e-5) instead of failing.  Those are not market vols,
# and a delta or touch probability derived from one is fiction dressed as data.
MIN_CREDIBLE_IV = 0.02
# Choosing a four-leg structure needs a pool to choose from.  Below this many
# live strikes under spot, the "best" candidate is just the only combination
# that happened to survive, not a selection.
MIN_QUOTED_LEGS_BELOW_SPOT = 8
# One thin expiration should not end the scan when a neighbour in the same
# window is fully quoted.
MAX_EXPIRATION_ATTEMPTS = 4
# Slack for adjacent-strike IV noise when checking that delta falls with strike.
DELTA_MONOTONICITY_SLACK = 0.005
DEFAULT_TICKERS = ["SPY", "QQQ", "IWM", "VOO"]
DEFAULTS = {
    "tickers": ",".join(DEFAULT_TICKERS),
    "delta_preset": "all",
    "target_dte": 160,
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


def _has_credible_iv(leg: dict) -> bool:
    """False for the placeholder vols the feed emits when its solver fails."""
    iv = _num(leg.get("iv"))
    return iv is not None and iv >= MIN_CREDIBLE_IV


def _tradable_leg(leg: dict, spot: float) -> bool:
    """A leg this snapshot can analyze with a live or labeled estimated price."""
    strike = _num(leg.get("strike"))
    return bool(
        (
            _quotable(leg)
            or leg.get("quote_source") == "last_trade_estimate"
        )
        and _has_credible_iv(leg)
        and leg.get("delta") is not None
        and strike is not None
        and 0 < strike < spot
    )


def _chain_quality(puts: list[dict], spot: float) -> dict:
    """How much of a chain snapshot is actually usable, for honest reporting."""
    below_spot = [
        leg for leg in puts
        if (_num(leg.get("strike")) or 0) > 0
        and (_num(leg.get("strike")) or 0) < spot
    ]
    return {
        "strikes": len(puts),
        "strikes_below_spot": len(below_spot),
        "quoted_below_spot": sum(
            1 for leg in below_spot
            if _quotable(leg) and _has_credible_iv(leg)
        ),
        "usable_below_spot": sum(
            1 for leg in below_spot if _tradable_leg(leg, spot)
        ),
    }


def _stale_chain_reason(expirations_tried: list[tuple[str, dict]]) -> str:
    """Explain an empty scan as a data outage rather than an absent trade."""
    best_expiration, best_quality = max(
        expirations_tried,
        key=lambda item: item[1]["usable_below_spot"],
    )
    return (
        f"No usable quotes: the best of {len(expirations_tried)} expirations "
        f"tried ({best_expiration}) had defensible live or recent-trade prices "
        f"on only {best_quality['usable_below_spot']} of "
        f"{best_quality['strikes_below_spot']} put strikes below spot, short of "
        f"the {MIN_QUOTED_LEGS_BELOW_SPOT} needed to choose a four-leg "
        f"structure."
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
        "quote_source": leg.get("quote_source", "live_bid_ask"),
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


def _elapsed_days_for_fraction(dte: int, fraction: float) -> int | None:
    """Whole days held at a planned close date some fraction of the way in.

    Shared by the early-close estimate and the touch schedule so both label the
    same close date with the same day count.
    """
    if dte < 2 or not 0 < fraction < 1:
        return None
    return max(1, min(dte - 1, int(round(dte * fraction))))


def _position_pl_at_exit(
    candidate: dict,
    exit_spot: float,
    remaining_years: float,
    dividend_yield: float = 0.0,
) -> float | None:
    """Theoretical P/L in option points when all four legs are closed together."""
    if exit_spot <= 0 or remaining_years < 0:
        return None
    bought_quantity = max(1, int(candidate.get("bought_quantity") or 1))
    sold_quantity = max(1, int(candidate.get("sold_quantity") or 1))
    legs = (
        (candidate.get("upper_long_leg") or {}, bought_quantity),
        (candidate.get("upper_short_leg") or {}, -bought_quantity),
        (candidate.get("lower_short_leg") or {}, -sold_quantity),
        (candidate.get("lower_long_leg") or {}, sold_quantity),
    )
    position_mark = 0.0
    for leg, signed_quantity in legs:
        strike = _num(leg.get("strike"))
        volatility = _num(leg.get("iv"))
        if strike is None or strike <= 0 or volatility is None or volatility <= 0:
            return None
        option_value = black_scholes(
            exit_spot,
            strike,
            remaining_years,
            RISK_FREE,
            dividend_yield,
            volatility,
            "put",
        )["price"]
        position_mark += signed_quantity * option_value
    return (_num(candidate.get("entry_credit"), 0.0) or 0.0) + position_mark


def _early_close_estimate(
    candidate: dict,
    spot: float,
    dte: int,
    elapsed_fraction: float,
    dividend_yield: float = 0.0,
) -> dict | None:
    """Risk-neutral chance the full position has positive modeled P/L at exit."""
    distribution_iv = _num(candidate.get("probability_iv"))
    elapsed_days = _elapsed_days_for_fraction(dte, elapsed_fraction)
    if (
        spot <= 0
        or elapsed_days is None
        or distribution_iv is None
        or distribution_iv <= 0
    ):
        return None

    remaining_dte = dte - elapsed_days
    elapsed_years = elapsed_days / 365.0
    remaining_years = remaining_dte / 365.0
    sigma_root_t = distribution_iv * math.sqrt(elapsed_years)
    log_drift = (
        RISK_FREE - dividend_yield - 0.5 * distribution_iv * distribution_iv
    ) * elapsed_years

    def spot_at_z(z_score: float) -> float:
        return spot * math.exp(log_drift + sigma_root_t * z_score)

    def profit_at_z(z_score: float) -> float | None:
        return _position_pl_at_exit(
            candidate,
            spot_at_z(z_score),
            remaining_years,
            dividend_yield,
        )

    # Locate every profitable price interval over virtually all of the normal
    # distribution. Four same-expiration puts produce only a few sign changes;
    # a dense z-grid plus bisection is deterministic and avoids Monte Carlo
    # noise in the displayed probability.
    z_grid = [-8.0 + index * 0.10 for index in range(161)]
    p_grid = [profit_at_z(z_score) for z_score in z_grid]
    if any(value is None for value in p_grid):
        return None

    roots = []
    for index in range(1, len(z_grid)):
        low_z, high_z = z_grid[index - 1], z_grid[index]
        low_p, high_p = p_grid[index - 1], p_grid[index]
        if low_p == 0:
            root = low_z
        elif high_p == 0:
            root = high_z
        elif low_p * high_p > 0:
            continue
        else:
            for _ in range(45):
                mid_z = 0.5 * (low_z + high_z)
                mid_p = profit_at_z(mid_z)
                if mid_p is None:
                    return None
                if low_p * mid_p <= 0:
                    high_z, high_p = mid_z, mid_p
                else:
                    low_z, low_p = mid_z, mid_p
            root = 0.5 * (low_z + high_z)
        if not roots or abs(root - roots[-1]) > 1e-7:
            roots.append(root)

    boundaries = [-math.inf, *roots, math.inf]
    profitable_ranges = []
    probability = 0.0
    for index in range(1, len(boundaries)):
        low_z, high_z = boundaries[index - 1], boundaries[index]
        if math.isinf(low_z) and math.isinf(high_z):
            probe_z = 0.0
        elif math.isinf(low_z):
            probe_z = high_z - 1.0
        elif math.isinf(high_z):
            probe_z = low_z + 1.0
        else:
            probe_z = 0.5 * (low_z + high_z)
        probe_profit = profit_at_z(probe_z)
        if probe_profit is None:
            return None
        if probe_profit <= 0:
            continue

        low_probability = 0.0 if math.isinf(low_z) else _norm_cdf(low_z)
        high_probability = 1.0 if math.isinf(high_z) else _norm_cdf(high_z)
        probability += high_probability - low_probability
        profitable_ranges.append({
            "lower": None if math.isinf(low_z) else spot_at_z(low_z),
            "upper": None if math.isinf(high_z) else spot_at_z(high_z),
        })

    return {
        "elapsed_fraction": elapsed_days / dte,
        "elapsed_days": elapsed_days,
        "remaining_dte": remaining_dte,
        "probability_profit_pct": min(100.0, max(0.0, probability * 100.0)),
        "profitable_ranges": profitable_ranges,
    }


def _deltas_are_ordered(
    upper_long: dict,
    upper_short: dict,
    lower_short: dict,
    lower_long: dict,
) -> bool:
    """Reject structures whose deltas contradict their strikes.

    Put delta must fall as strike falls.  When a snapshot is thin enough that
    the surviving strikes carry stale or interpolated vols, the fitted deltas go
    out of order and the search happily pairs a "20 delta" short above a short
    with more delta than it.  That is not an unbalanced condor, so it must never
    reach the results table with a preset label on it.
    """
    deltas = []
    for leg in (upper_long, upper_short, lower_short, lower_long):
        delta = _num(leg.get("delta"))
        if delta is None:
            return False
        deltas.append(abs(delta))
    for higher, lower in zip(deltas, deltas[1:]):
        if lower > higher + DELTA_MONOTONICITY_SLACK:
            return False
    # The two shorts define the structure, so their ordering is not negotiable
    # and they sit far enough apart that quote noise cannot explain a tie.
    return deltas[1] > deltas[2]


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
    if not _deltas_are_ordered(upper_long, upper_short, lower_short, lower_long):
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

    structure_legs = (upper_long, upper_short, lower_short, lower_long)
    all_live = all(_quotable(leg) for leg in structure_legs)
    natural_credit = (
        bought_quantity * (
            (_num(upper_short.get("bid"), 0.0) or 0.0)
            - (_num(upper_long.get("ask"), 0.0) or 0.0)
        )
        + sold_quantity * (
            (_num(lower_short.get("bid"), 0.0) or 0.0)
            - (_num(lower_long.get("ask"), 0.0) or 0.0)
        )
        if all_live else None
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
        if all_live else None
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
    # The highest strike is the first put the position owns below spot, so the
    # chance of reaching it is measured with that strike's own implied vol.
    # Borrowing the far-out-of-the-money lower short's IV would inherit the put
    # skew and materially overstate a touch this close to the money.
    front_iv = _num(upper_long.get("iv"))
    if front_iv is None or front_iv <= 0:
        front_iv = probability_iv
    if front_iv is not None and front_iv > 0:
        prob_touch_upper_long = _prob_touch_lower(
            spot,
            k1,
            years,
            front_iv,
            RISK_FREE,
            dividend_yield,
        )
        prob_finish_below_upper_long = _prob_finish_below(
            spot,
            k1,
            years,
            front_iv,
            RISK_FREE,
            dividend_yield,
        )
    else:
        prob_touch_upper_long = None
        prob_finish_below_upper_long = None
    upper_long_distance_sigma = (
        math.log(spot / k1) / (front_iv * math.sqrt(years))
        if spot > k1 and front_iv is not None and front_iv > 0 and years > 0 else None
    )
    # The same planned close dates the early-close card uses.  A touch by an
    # interim date is a shorter first-passage window than a touch by expiration,
    # so the two cannot be read off one number.
    upper_long_touch_schedule = []
    if front_iv is not None and front_iv > 0:
        for fraction in EARLY_CLOSE_FRACTIONS:
            elapsed_days = _elapsed_days_for_fraction(int(dte), fraction)
            if elapsed_days is None:
                continue
            probability = _prob_touch_lower(
                spot,
                k1,
                elapsed_days / 365.0,
                front_iv,
                RISK_FREE,
                dividend_yield,
            )
            if probability is None:
                continue
            upper_long_touch_schedule.append({
                "elapsed_fraction": elapsed_days / int(dte),
                "elapsed_days": elapsed_days,
                "remaining_dte": int(dte) - elapsed_days,
                "prob_touch_pct": probability * 100.0,
            })
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
    legs_for_probability = [
        {
            "option_type": "put",
            "strike": k1,
            "iv": _num(upper_long.get("iv")),
            "quantity": bought_quantity,
        },
        {
            "option_type": "put",
            "strike": k2,
            "iv": _num(upper_short.get("iv")),
            "quantity": -bought_quantity,
        },
        {
            "option_type": "put",
            "strike": k3,
            "iv": _num(lower_short.get("iv")),
            "quantity": -sold_quantity,
        },
        {
            "option_type": "put",
            "strike": k4,
            "iv": _num(lower_long.get("iv")),
            "quantity": sold_quantity,
        },
    ]
    # k1 is the tent's near edge for the same reason the touch maths above uses
    # it: it is the first put the position owns below spot, so nothing in the
    # structure pays until price reaches it.
    price_scenarios = price_scenario_schedule(
        spot=spot,
        dte=dte,
        expiration=expiration,
        distribution_iv=front_iv,
        entry_cashflow=entry_credit,
        legs=legs_for_probability,
        tent_edge=k1,
        risk_free_rate=RISK_FREE,
        dividend_yield=dividend_yield,
    )

    lower_short_distance_sigma = (
        math.log(spot / k3) / (probability_iv * math.sqrt(years))
        if spot > k3 and probability_iv is not None and probability_iv > 0 and years > 0 else None
    )

    return {
        "price_scenarios": price_scenarios,
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
        "quote_source": "live_bid_ask" if all_live else "last_trade_estimate",
        "uses_last_trade_prices": not all_live,
        "bought_debit_dollars": bought_debit * CONTRACT_MULTIPLIER,
        "sold_credit_dollars": sold_credit * CONTRACT_MULTIPLIER,
        "entry_credit_dollars": entry_credit * CONTRACT_MULTIPLIER,
        "entry_debit_dollars": max(0.0, -entry_credit) * CONTRACT_MULTIPLIER,
        "natural_credit_dollars": (
            natural_credit * CONTRACT_MULTIPLIER
            if natural_credit is not None else None
        ),
        "execution_cost_dollars": (
            execution_cost * CONTRACT_MULTIPLIER
            if execution_cost is not None else None
        ),
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
        "prob_touch_upper_long_pct": (
            prob_touch_upper_long * 100.0
            if prob_touch_upper_long is not None else None
        ),
        "prob_finish_below_upper_long_pct": (
            prob_finish_below_upper_long * 100.0
            if prob_finish_below_upper_long is not None else None
        ),
        "upper_long_touch_schedule": upper_long_touch_schedule,
        "upper_long_probability_iv": front_iv,
        "upper_long_distance_pct": (
            (spot - k1) / spot * 100.0 if spot > 0 else None
        ),
        "upper_long_distance_sigma": upper_long_distance_sigma,
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
        0 if (
            candidate.get("natural_credit") is None
            or candidate["natural_credit"] >= 0
        ) else 1,
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
    legs = [leg for leg in puts if _tradable_leg(leg, spot)]
    if len(legs) < 4:
        return []
    # A condor needs a body.  Without this the search will pair shorts one
    # strike apart whenever the delta fit is poor, collapsing the structure into
    # something that only looks like the requested trade in the strike column.
    min_short_separation = min(bought_width, sold_width)

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
            if (
                upper_short["strike"] - lower_short["strike"]
                < min_short_separation
            ):
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
        ("prob_touch_upper_long_pct", 1),
        ("prob_finish_below_upper_long_pct", 1),
        ("prob_touch_lower_short_pct", 1),
        ("prob_touch_lower_long_pct", 1),
        ("prob_finish_below_lower_short_pct", 1),
        ("prob_finish_below_lower_long_pct", 1),
        ("probability_iv", 4),
        ("upper_long_probability_iv", 4),
        ("upper_long_distance_pct", 1),
        ("upper_long_distance_sigma", 2),
        ("lower_short_distance_pct", 1),
        ("lower_short_distance_sigma", 2),
    ):
        out[key] = _round(out.get(key), decimals)
    out["upper_long_touch_schedule"] = [
        {
            **step,
            "elapsed_fraction": _round(step.get("elapsed_fraction"), 3),
            "prob_touch_pct": _round(step.get("prob_touch_pct"), 1),
        }
        for step in out.get("upper_long_touch_schedule", [])
    ]
    out["early_close_estimates"] = [
        {
            **estimate,
            "elapsed_fraction": _round(estimate.get("elapsed_fraction"), 3),
            "probability_profit_pct": _round(
                estimate.get("probability_profit_pct"),
                1,
            ),
            "profitable_ranges": [
                {
                    "lower": _round(price_range.get("lower"), 2),
                    "upper": _round(price_range.get("upper"), 2),
                }
                for price_range in estimate.get("profitable_ranges", [])
            ],
        }
        for estimate in out.get("early_close_estimates", [])
        if estimate is not None
    ]
    return out


def _ticker_list(raw) -> list[str]:
    return _index_only_tickers(raw, DEFAULT_TICKERS, limit=50)


def _ranked_expirations(
    expirations: list[str],
    target_dte: int,
    min_dte: int,
    max_dte: int,
) -> list[tuple[str, int]]:
    """In-window expirations ordered by closeness to the target DTE.

    The head of this list is the expiration the scanner has always chosen; the
    tail lets a thinly quoted chain fall through to its neighbour instead of
    ending the scan.
    """
    today = date.today()
    pool = []
    for expiration in expirations:
        try:
            expiration_date = datetime.strptime(expiration, "%Y-%m-%d").date()
        except ValueError:
            continue
        dte = (expiration_date - today).days
        if min_dte <= dte <= max_dte:
            pool.append((abs(dte - target_dte), expiration, dte))
    pool.sort()
    return [(expiration, dte) for _, expiration, dte in pool]


def run_unbalanced_put_condor_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    presets = _preset_names(p.get("delta_preset"))
    target_dte = max(
        MIN_TARGET_DTE,
        min(MAX_TARGET_DTE, int(_num(p.get("target_dte"), 160))),
    )
    min_dte = max(
        MIN_TARGET_DTE,
        int(_num(p.get("min_dte"), 120)),
    )
    max_dte = min(
        MAX_TARGET_DTE,
        max(min_dte, int(_num(p.get("max_dte"), 240))),
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
        ranked = _ranked_expirations(expirations, target_dte, min_dte, max_dte)
        if not ranked:
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

        def evaluate(expiration: str, dte: int, puts: list[dict]) -> tuple[list, list]:
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
                    missing.append(
                        f"{preset}: no four-put combination held its delta order"
                    )
                    continue

                # Net position delta is the governing choice.  The named delta
                # pair locates the neighborhood; nearby listed strikes are
                # searched for the complete four-leg package whose delta best
                # matches the user's neutral, bullish, or bearish target.
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
                    blocking_flags.append(
                        "One or more legs are below minimum open interest"
                    )
                if require_upside_credit and best["entry_credit"] < 0:
                    blocking_flags.append("Upper flat outcome is a debit")
                if best["position_delta_error"] > position_delta_tolerance:
                    blocking_flags.append("Net position delta is outside tolerance")
                if best.get("uses_last_trade_prices"):
                    blocking_flags.append(
                        "Live bid/ask unavailable — analysis only"
                    )
                flags.extend(blocking_flags)
                estimated = bool(best.get("uses_last_trade_prices"))
                if estimated:
                    flags.append("Recent trade estimates — no live bid/ask")
                if (
                    not estimated
                    and best["natural_credit"] < 0 <= best["entry_credit"]
                ):
                    flags.append(
                        "Mid shows a credit but the natural market is a debit"
                    )

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
                best["early_close_estimates"] = [
                    estimate
                    for fraction in EARLY_CLOSE_FRACTIONS
                    if (
                        estimate := _early_close_estimate(
                            best,
                            spot,
                            dte,
                            fraction,
                            div_yield,
                        )
                    ) is not None
                ]
                chosen.append(_round_candidate(best))
            return chosen, missing

        # Walk out from the target DTE.  A single thinly quoted expiration is a
        # data condition, not a verdict on the trade, so it must not end the
        # scan while a fully quoted neighbour sits inside the same window.
        too_thin = []
        last_attempt = None
        for expiration, dte in ranked[:MAX_EXPIRATION_ATTEMPTS]:
            raw_puts = _load_put_chain(ticker, expiration, spot, div_yield)
            prepared = [
                quote for quote in (
                    _prepare_put_quote(
                        leg,
                        spot=spot,
                        dte=dte,
                        dividend_yield=div_yield,
                    )
                    for leg in raw_puts
                    if 0 < (_num(leg.get("strike")) or 0) < spot
                )
                if quote is not None
            ]
            prepared_by_strike = {
                _num(leg.get("strike")): leg for leg in prepared
            }
            quality_legs = [
                prepared_by_strike.get(_num(leg.get("strike")), leg)
                for leg in raw_puts
            ]
            live = [leg for leg in prepared if _quotable(leg)]
            puts = (
                live
                if len(live) >= MIN_QUOTED_LEGS_BELOW_SPOT
                else prepared
            )
            quality = _chain_quality(quality_legs, spot)
            if quality["usable_below_spot"] < MIN_QUOTED_LEGS_BELOW_SPOT:
                too_thin.append((expiration, quality))
                continue
            chosen, missing = evaluate(expiration, dte, puts)
            last_attempt = (expiration, dte, missing)
            if chosen:
                return {
                    "ticker": ticker,
                    "name": fund.get("name"),
                    "price": _round(spot),
                    "expiration": expiration,
                    "dte": dte,
                    "chain_quality": quality,
                    "priced": True,
                    "status": "found",
                    "reason": None,
                    "candidates": chosen,
                }

        # Nothing matched.  Say which of the two it was: a chain with no live
        # markets to read, or real quotes that simply did not form the structure.
        if last_attempt is not None:
            expiration, dte, missing = last_attempt
            return {
                "ticker": ticker,
                "name": fund.get("name"),
                "price": _round(spot),
                "expiration": expiration,
                "dte": dte,
                "priced": True,
                "status": "unavailable",
                "reason": "; ".join(missing),
                "candidates": [],
            }
        expiration, quality = (
            max(too_thin, key=lambda item: item[1]["usable_below_spot"])
            if too_thin else (None, None)
        )
        return {
            "ticker": ticker,
            "name": fund.get("name"),
            "price": _round(spot),
            "expiration": expiration,
            "dte": next((d for e, d in ranked if e == expiration), None),
            "chain_quality": quality,
            "status": "unavailable",
            "reason": (
                _stale_chain_reason(too_thin) if too_thin
                else "The selected expiration has no usable put chain."
            ),
            "candidates": [],
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
            "chain_quality": result.get("chain_quality"),
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
            # Only expirations whose chain was quoted well enough to evaluate.
            # A stale snapshot names the expiration it rejected, so counting a
            # non-empty expiration field here would report work never done.
            "expirations_priced": sum(
                1 for result in scan_results if result.get("priced")
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
