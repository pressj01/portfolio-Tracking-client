"""Long-dated STT unbalanced put-butterfly scanner.

The course structure is a same-expiration 4/-8/4 put butterfly:

    BUY  4 upper long puts     near 20 or 25 delta
    SELL 8 body puts           near 15 delta
    BUY  4 lower long puts     initially near 5 delta, then adjusted

The lower wing is wider than the upper wing.  Candidates are ranked first by
the complete tranche delta for the selected market bias, then by how closely
the upper expiration line is to zero and how closely daily theta is to +$20.

Endpoints:
  GET  /api/options/unbalanced-butterfly-scan/defaults
  POST /api/options/unbalanced-butterfly-scan
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import calendar
import math
import re

import yfinance as yf

import yahoo_gateway
from flask import jsonify, request

from option_probability import price_scenario_schedule, profit_probability_schedule
from options_pricing import black_scholes, implied_vol
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
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)
from unbalanced_put_condor_scanner import (
    CONTRACT_MULTIPLIER,
    EARLY_CLOSE_FRACTIONS,
    _elapsed_days_for_fraction,
    _leg_view,
    _prob_finish_below,
    _prob_touch_lower,
    _quotable,
)


UPPER_LONG_TARGETS = {
    "20": 0.20,
    "25": 0.25,
}
BODY_SHORT_TARGET = 0.15
COURSE_EXPECTED_HOLD_DAYS = 16 * 7
COURSE_PROFIT_TARGET_DOLLARS = 1000.0
COURSE_MAX_LOSS_TARGET_DOLLARS = 2000.0
COURSE_PLANNED_CAPITAL_LOW_DOLLARS = 5000.0
COURSE_PLANNED_CAPITAL_HIGH_DOLLARS = 7000.0
COURSE_BASE_LONG_QUANTITY = 4
BIAS_RANGES = {
    "bearish": (-3.0, -1.0),
    "neutral": (-1.0, 1.0),
    "bullish": (1.0, 3.0),
}
DEFAULT_TICKERS = ["SPY", "QQQ", "IWM"]
DEFAULTS = {
    "tickers": ",".join(DEFAULT_TICKERS),
    "upper_long_delta": "both",
    "market_bias": "neutral",
    # Match the Unbalanced Put Condor scanner's long-dated timing.
    "target_dte": 160,
    "min_dte": 120,
    "max_dte": 240,
    "tranche_quantity": 4,
    "delta_tolerance": 0.035,
    "target_theta_dollars": 20.0,
    "theta_tolerance_dollars": 15.0,
    "uel_tolerance_dollars": 250.0,
    "min_lower_wing_ratio": 1.05,
    "min_open_interest": 0,
    "max_results": 100,
}


def _distance_to_range(value: float | None, low: float, high: float) -> float:
    if value is None:
        return math.inf
    if value < low:
        return low - value
    if value > high:
        return value - high
    return 0.0


def _lower_long_target(upper_long_target: float) -> float:
    """Delta that algebraically balances long - 2*short + long near zero."""
    return max(0.01, min(0.14, 2.0 * BODY_SHORT_TARGET - upper_long_target))


def _leg_theta(
    leg: dict,
    spot: float,
    years: float,
    dividend_yield: float,
) -> float | None:
    strike = _num(leg.get("strike"))
    volatility = _num(leg.get("iv"))
    if (
        strike is None
        or strike <= 0
        or volatility is None
        or volatility <= 0
        or spot <= 0
        or years <= 0
    ):
        return None
    return _num(
        black_scholes(
            spot,
            strike,
            years,
            RISK_FREE,
            dividend_yield,
            volatility,
            "put",
        ).get("theta")
    )


def _modeled_butterfly_pl(
    *,
    exit_spot: float,
    remaining_dte: int,
    entry_credit: float,
    upper_long: dict,
    body_short: dict,
    lower_long: dict,
    quantity: int,
    dividend_yield: float,
    lower_long_quantity_multiplier: int = 1,
) -> float | None:
    """Theoretical total-tranche P/L in option points at one future price."""
    if exit_spot <= 0 or remaining_dte < 0:
        return None
    remaining_years = remaining_dte / 365.0
    total = entry_credit
    for leg, signed_quantity in (
        (upper_long, quantity),
        (body_short, -2 * quantity),
        (lower_long, lower_long_quantity_multiplier * quantity),
    ):
        strike = _num(leg.get("strike"))
        volatility = _num(leg.get("iv"))
        if (
            strike is None
            or strike <= 0
            or volatility is None
            or volatility <= 0
        ):
            return None
        total += signed_quantity * black_scholes(
            exit_spot,
            strike,
            remaining_years,
            RISK_FREE,
            dividend_yield,
            volatility,
            "put",
        )["price"]
    return total


def _third_friday(year: int, month: int) -> date:
    month_calendar = calendar.monthcalendar(year, month)
    fridays = [
        week[calendar.FRIDAY]
        for week in month_calendar
        if week[calendar.FRIDAY]
    ]
    return date(year, month, fridays[2])


def _is_standard_monthly(expiration: str) -> bool:
    try:
        expiration_date = datetime.strptime(expiration, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return False
    # A market holiday can move the standard monthly expiration to Thursday.
    return abs(
        (expiration_date - _third_friday(
            expiration_date.year,
            expiration_date.month,
        )).days
    ) <= 1


def _pick_monthly_expiration(
    expirations: list[str],
    target_dte: int,
    min_dte: int,
    max_dte: int,
) -> tuple[str | None, int | None, bool]:
    monthlies = _monthly_expirations_in_window(
        expirations,
        target_dte,
        min_dte,
        max_dte,
    )
    if not monthlies:
        return None, None, False
    expiration, dte = monthlies[0]
    return expiration, dte, True


def _monthly_expirations_in_window(
    expirations: list[str],
    target_dte: int,
    min_dte: int,
    max_dte: int,
) -> list[tuple[str, int]]:
    """Standard monthlies in-range, nearest the requested DTE first."""
    today = date.today()
    choices = []
    for expiration in expirations:
        if not _is_standard_monthly(expiration):
            continue
        try:
            expiration_date = datetime.strptime(
                expiration,
                "%Y-%m-%d",
            ).date()
        except (TypeError, ValueError):
            continue
        dte = (expiration_date - today).days
        if min_dte <= dte <= max_dte:
            choices.append((expiration, dte))
    choices.sort(key=lambda choice: (
        abs(choice[1] - target_dte),
        choice[1],
        choice[0],
    ))
    return choices


def _prepare_scan_leg(
    leg: dict,
    *,
    spot: float,
    dte: int,
    dividend_yield: float,
) -> dict | None:
    """Return a leg usable for scanning during or after market hours.

    Yahoo commonly clears bid/ask and reports a placeholder IV after the
    session, even when the option traded that day. In that case, use the
    reported last trade as an explicitly non-live estimate and back out an IV
    so strike deltas remain internally consistent. These candidates are later
    marked as near matches and never represented as executable live quotes.
    """
    prepared = dict(leg)
    if _quotable(prepared):
        prepared["quote_source"] = "live_bid_ask"
        return prepared

    market_price = _num(prepared.get("mid"))
    volume = int(_num(prepared.get("volume"), 0) or 0)
    strike = _num(prepared.get("strike"))
    if (
        market_price is None
        or market_price <= 0
        or volume <= 0
        or strike is None
        or strike <= 0
        or spot <= 0
        or dte <= 0
    ):
        return None

    years = dte / 365.0
    volatility = implied_vol(
        market_price,
        spot,
        strike,
        years,
        RISK_FREE,
        dividend_yield,
        "put",
    )
    if volatility is None or not 0.005 <= volatility <= 5.0:
        return None
    modeled = black_scholes(
        spot,
        strike,
        years,
        RISK_FREE,
        dividend_yield,
        volatility,
        "put",
    )
    delta = _num(modeled.get("delta"))
    if delta is None:
        return None

    prepared.update({
        "iv": volatility,
        "delta": delta,
        "quote_source": "last_trade",
    })
    return prepared


def _management_exit_points(dte: int) -> list[dict]:
    """Use the same halfway and two-thirds checkpoints as the put condor."""
    labels = ("Halfway review", "Two-thirds review")
    points = []
    for label, fraction in zip(labels, EARLY_CLOSE_FRACTIONS):
        elapsed_days = _elapsed_days_for_fraction(dte, fraction)
        if elapsed_days is None:
            continue
        points.append({
            "kind": "planned_exit",
            "label": label,
            "remaining_dte": dte - elapsed_days,
        })
    return points


def _build_butterfly(
    upper_long: dict,
    body_short: dict,
    lower_long: dict,
    *,
    spot: float,
    expiration: str,
    dte: int,
    upper_long_target: float,
    tranche_quantity: int = 4,
    lower_long_quantity_multiplier: int = 1,
    lower_long_target: float | None = None,
    body_short_target: float | None = None,
    structure_kind: str = "unbalanced_butterfly",
    dividend_yield: float = 0.0,
    always_success_above_upper: bool = True,
    exit_points: list[dict] | None = None,
    require_lower_wing_wider: bool = True,
    with_analytics: bool = True,
) -> dict | None:
    """Calculate greeks, execution, payoff, and probabilities for one BWB.

    The default lower-long multiplier preserves this scanner's 4/-8/4
    structure. A multiplier of two prices the 4/-8/+8 structure used by the
    document-based 488 scanner, including its recovering downside tail.

    ``with_analytics`` builds the probability schedule, profit-capture panel
    and price-scenario table. Turn it off while enumerating candidates and
    back on for the one that wins: nothing in the ranking reads them, and
    they are the overwhelming majority of the cost per structure.

    ``body_short_target``, ``always_success_above_upper`` and ``exit_points``
    default to this scanner's own course values. The Road Trip screen supplies
    its near-the-money body and its own close-window labels. Although that trade
    enters for a debit, it also keeps the upper success region because its
    prescribed reverse-Harvey process manages a rally until the right side is
    flat or slightly profitable.
    """
    analytics_pending = None if with_analytics else (
        (upper_long, body_short, lower_long),
        dict(
            spot=spot,
            expiration=expiration,
            dte=dte,
            upper_long_target=upper_long_target,
            tranche_quantity=tranche_quantity,
            lower_long_quantity_multiplier=lower_long_quantity_multiplier,
            lower_long_target=lower_long_target,
            body_short_target=body_short_target,
            structure_kind=structure_kind,
            dividend_yield=dividend_yield,
            always_success_above_upper=always_success_above_upper,
            exit_points=exit_points,
            require_lower_wing_wider=require_lower_wing_wider,
        ),
    )
    upper_strike = _num(upper_long.get("strike"))
    body_strike = _num(body_short.get("strike"))
    lower_strike = _num(lower_long.get("strike"))
    if not all(
        value is not None and value > 0
        for value in (upper_strike, body_strike, lower_strike)
    ):
        return None
    if not lower_strike < body_strike < upper_strike:
        return None

    upper_width = upper_strike - body_strike
    lower_width = body_strike - lower_strike
    if (
        upper_width <= 0
        or lower_width <= 0
        or (require_lower_wing_wider and lower_width <= upper_width)
    ):
        return None

    quantity = max(1, int(tranche_quantity))
    lower_multiplier = max(1, int(lower_long_quantity_multiplier))
    lower_quantity = lower_multiplier * quantity
    upper_mid = _num(upper_long.get("mid"), 0.0) or 0.0
    body_mid = _num(body_short.get("mid"), 0.0) or 0.0
    lower_mid = _num(lower_long.get("mid"), 0.0) or 0.0
    entry_credit_per_fly = (
        2.0 * body_mid - upper_mid - lower_multiplier * lower_mid
    )
    entry_credit = quantity * entry_credit_per_fly

    upper_flat = entry_credit
    peak_profit = entry_credit + quantity * upper_width
    lower_corner = entry_credit + quantity * (upper_width - lower_width)
    zero_price_tail = entry_credit + (
        quantity * upper_strike
        - 2 * quantity * body_strike
        + lower_quantity * lower_strike
    )
    max_profit = max(upper_flat, peak_profit, lower_corner, zero_price_tail)
    max_loss = max(
        0.0,
        -min(upper_flat, peak_profit, lower_corner, zero_price_tail),
    )
    if max_profit <= 0:
        return None

    upper_breakeven = None
    if upper_flat < 0 < peak_profit:
        upper_breakeven = upper_strike + entry_credit / quantity
    lower_breakeven = None
    if lower_corner < 0 < peak_profit:
        lower_breakeven = body_strike - peak_profit / quantity
    downside_breakeven = None
    if lower_multiplier > 1 and lower_corner < 0 < zero_price_tail:
        downside_breakeven = (
            lower_strike
            + lower_corner / (quantity * (lower_multiplier - 1))
        )

    legs = (upper_long, body_short, lower_long)
    all_legs_live = all(_quotable(leg) for leg in legs)
    uses_last_trade_prices = not all_legs_live
    if all_legs_live:
        upper_bid = _num(upper_long.get("bid"), 0.0) or 0.0
        upper_ask = _num(upper_long.get("ask"), 0.0) or 0.0
        body_bid = _num(body_short.get("bid"), 0.0) or 0.0
        body_ask = _num(body_short.get("ask"), 0.0) or 0.0
        lower_bid = _num(lower_long.get("bid"), 0.0) or 0.0
        lower_ask = _num(lower_long.get("ask"), 0.0) or 0.0
        natural_credit = quantity * (
            2.0 * body_bid
            - upper_ask
            - lower_multiplier * lower_ask
        )
        execution_cost = quantity * (
            (upper_ask - upper_bid)
            + 2.0 * (body_ask - body_bid)
            + lower_multiplier * (lower_ask - lower_bid)
        )
    else:
        # Do not invent an executable natural price or quoted width from
        # last-trade marks. The mid-based payoff remains an estimate.
        natural_credit = None
        execution_cost = None

    actual_upper_delta = abs(_num(upper_long.get("delta"), 0.0) or 0.0)
    actual_body_delta = abs(_num(body_short.get("delta"), 0.0) or 0.0)
    actual_lower_delta = abs(_num(lower_long.get("delta"), 0.0) or 0.0)
    lower_target = (
        _lower_long_target(upper_long_target)
        if lower_long_target is None
        else float(lower_long_target)
    )
    body_target = (
        BODY_SHORT_TARGET
        if body_short_target is None
        else float(body_short_target)
    )
    raw_position_delta = quantity * (
        (_num(upper_long.get("delta"), 0.0) or 0.0)
        - 2.0 * (_num(body_short.get("delta"), 0.0) or 0.0)
        + lower_multiplier * (_num(lower_long.get("delta"), 0.0) or 0.0)
    )
    position_delta = raw_position_delta * CONTRACT_MULTIPLIER

    years = max(int(dte), 1) / 365.0
    upper_theta = _leg_theta(upper_long, spot, years, dividend_yield)
    body_theta = _leg_theta(body_short, spot, years, dividend_yield)
    lower_theta = _leg_theta(lower_long, spot, years, dividend_yield)
    theta_dollars = None
    if None not in (upper_theta, body_theta, lower_theta):
        theta_dollars = quantity * (
            upper_theta - 2.0 * body_theta + lower_multiplier * lower_theta
        ) * CONTRACT_MULTIPLIER

    front_iv = _num(upper_long.get("iv"))
    probability_iv = _num(body_short.get("iv"))
    if front_iv is None or front_iv <= 0:
        front_iv = probability_iv
    if probability_iv is None or probability_iv <= 0:
        probability_iv = front_iv

    if front_iv is not None and front_iv > 0:
        prob_touch_upper_long = _prob_touch_lower(
            spot,
            upper_strike,
            years,
            front_iv,
            RISK_FREE,
            dividend_yield,
        )
        prob_finish_below_upper_long = _prob_finish_below(
            spot,
            upper_strike,
            years,
            front_iv,
            RISK_FREE,
            dividend_yield,
        )
    else:
        prob_touch_upper_long = None
        prob_finish_below_upper_long = None

    if probability_iv is not None and probability_iv > 0:
        prob_touch_body = _prob_touch_lower(
            spot,
            body_strike,
            years,
            probability_iv,
            RISK_FREE,
            dividend_yield,
        )
        prob_touch_lower_long = _prob_touch_lower(
            spot,
            lower_strike,
            years,
            probability_iv,
            RISK_FREE,
            dividend_yield,
        )
        prob_finish_below_body = _prob_finish_below(
            spot,
            body_strike,
            years,
            probability_iv,
            RISK_FREE,
            dividend_yield,
        )
        prob_finish_below_lower_long = _prob_finish_below(
            spot,
            lower_strike,
            years,
            probability_iv,
            RISK_FREE,
            dividend_yield,
        )
    else:
        prob_touch_body = None
        prob_touch_lower_long = None
        prob_finish_below_body = None
        prob_finish_below_lower_long = None

    if exit_points is None:
        exit_points = _management_exit_points(int(dte))
    upper_long_touch_schedule = []
    if front_iv is not None and front_iv > 0:
        for point in exit_points:
            elapsed_days = int(dte) - int(point["remaining_dte"])
            probability = _prob_touch_lower(
                spot,
                upper_strike,
                elapsed_days / 365.0,
                front_iv,
                RISK_FREE,
                dividend_yield,
            )
            if probability is None:
                continue
            upper_long_touch_schedule.append({
                "label": point["label"],
                "elapsed_fraction": elapsed_days / int(dte),
                "elapsed_days": elapsed_days,
                "remaining_dte": int(point["remaining_dte"]),
                "prob_touch_pct": probability * 100.0,
            })

    legs_for_probability = [
        {
            "option_type": "put",
            "strike": upper_strike,
            "iv": _num(upper_long.get("iv")),
            "quantity": quantity,
        },
        {
            "option_type": "put",
            "strike": body_strike,
            "iv": _num(body_short.get("iv")),
            "quantity": -2 * quantity,
        },
        {
            "option_type": "put",
            "strike": lower_strike,
            "iv": _num(lower_long.get("iv")),
            "quantity": lower_quantity,
        },
    ]
    # Every candidate structure is priced, but only one per expiration is
    # ever chosen, and the ranking never reads these panels -- it sorts on
    # delta, credit, theta and liquidity. Building them for every candidate
    # cost ~42ms each across thousands of them, which was nearly the whole
    # scan. The chosen structure is rebuilt with them switched on.
    if with_analytics:
        probability_schedule, profit_capture = profit_probability_schedule(
            spot=spot,
            dte=dte,
            expiration=expiration,
            distribution_iv=probability_iv,
            entry_cashflow=entry_credit,
            legs=legs_for_probability,
            exit_points=exit_points,
            risk_free_rate=RISK_FREE,
            dividend_yield=dividend_yield,
            # The course treats an untested price above the upper long as a good
            # trade. Inside the structure, the time-evolved theoretical P/L tent
            # decides success. At expiration the near-$0 upper line therefore
            # counts as success rather than swallowing the whole upper tail into
            # the failure complement. Managed debit structures may also opt into
            # this region when their trading plan explicitly repairs the upper line.
            always_success_above=upper_strike if always_success_above_upper else None,
            include_breakeven=True,
            return_capture=True,
        )
        # The tent only pays as it converges, so the panel also has to answer when
        # holding is worth most rather than only how likely a target is. The upper
        # long is the tent's near edge: the strike price has to reach before any of
        # this structure starts working.
        price_scenarios = price_scenario_schedule(
            spot=spot,
            dte=dte,
            expiration=expiration,
            distribution_iv=probability_iv,
            entry_cashflow=entry_credit,
            legs=legs_for_probability,
            tent_edge=upper_strike,
            risk_free_rate=RISK_FREE,
            dividend_yield=dividend_yield,
        )
        # Show how the tent develops instead of reducing the trade to one terminal
        # payoff. The body strike is the tent peak at expiration; unchanged spot
        # shows the untested upper region. Both are repriced at the Condor's same
        # halfway and two-thirds management checkpoints.
        for point in probability_schedule:
            remaining_dte = int(point.get("remaining_dte") or 0)
            unchanged_pl = _modeled_butterfly_pl(
                exit_spot=spot,
                remaining_dte=remaining_dte,
                entry_credit=entry_credit,
                upper_long=upper_long,
                body_short=body_short,
                lower_long=lower_long,
                quantity=quantity,
                dividend_yield=dividend_yield,
                lower_long_quantity_multiplier=lower_multiplier,
            )
            upper_long_pl = _modeled_butterfly_pl(
                exit_spot=upper_strike,
                remaining_dte=remaining_dte,
                entry_credit=entry_credit,
                upper_long=upper_long,
                body_short=body_short,
                lower_long=lower_long,
                quantity=quantity,
                dividend_yield=dividend_yield,
                lower_long_quantity_multiplier=lower_multiplier,
            )
            body_pl = _modeled_butterfly_pl(
                exit_spot=body_strike,
                remaining_dte=remaining_dte,
                entry_credit=entry_credit,
                upper_long=upper_long,
                body_short=body_short,
                lower_long=lower_long,
                quantity=quantity,
                dividend_yield=dividend_yield,
                lower_long_quantity_multiplier=lower_multiplier,
            )
            point.update({
                "unchanged_spot_pl_dollars": (
                    unchanged_pl * CONTRACT_MULTIPLIER
                    if unchanged_pl is not None else None
                ),
                "upper_long_pl_dollars": (
                    upper_long_pl * CONTRACT_MULTIPLIER
                    if upper_long_pl is not None else None
                ),
                "body_peak_pl_dollars": (
                    body_pl * CONTRACT_MULTIPLIER
                    if body_pl is not None else None
                ),
            })
    else:
        probability_schedule, profit_capture, price_scenarios = [], None, None
    early_close_estimates = [
        {
            "label": point.get("label"),
            "exit_date": point.get("exit_date"),
            "elapsed_days": point.get("elapsed_days"),
            "elapsed_fraction": (
                point.get("elapsed_days") / int(dte)
                if point.get("elapsed_days") is not None and dte else None
            ),
            "remaining_dte": point.get("remaining_dte"),
            "probability_profit_pct": point.get("probability_success_pct"),
            "probability_failure_pct": point.get("probability_failure_pct"),
            "profitable_ranges": point.get("profitable_ranges", []),
        }
        for point in probability_schedule
        if point.get("kind") != "expiration"
    ]

    oi_min = min(
        int(_num(leg.get("open_interest"), 0) or 0)
        for leg in legs
    )
    volume_min = min(
        int(_num(leg.get("volume"), 0) or 0)
        for leg in legs
    )
    course_quantity_scale = quantity / COURSE_BASE_LONG_QUANTITY

    return {
        "expiration": expiration,
        "structure_kind": structure_kind,
        "dte": int(dte),
        "upper_long_delta_mode": str(int(round(upper_long_target * 100))),
        "target_upper_long_delta": upper_long_target,
        "target_body_short_delta": body_target,
        "target_lower_long_delta": lower_target,
        "actual_upper_long_delta": actual_upper_delta,
        "actual_body_short_delta": actual_body_delta,
        "actual_lower_long_delta": actual_lower_delta,
        "upper_long_delta_error": abs(actual_upper_delta - upper_long_target),
        "body_short_delta_error": abs(actual_body_delta - body_target),
        "lower_long_delta_error": abs(actual_lower_delta - lower_target),
        "position_delta": position_delta,
        "position_delta_per_share": raw_position_delta,
        "theta_dollars_per_day": theta_dollars,
        "upper_long_strike": upper_strike,
        "body_short_strike": body_strike,
        # Aliases keep the probability-card vocabulary aligned with the
        # Unbalanced Put Condor scanner.
        "lower_short_strike": body_strike,
        "lower_long_strike": lower_strike,
        "upper_width": upper_width,
        "lower_width": lower_width,
        "lower_wing_ratio": lower_width / upper_width,
        "tranche_quantity": quantity,
        "upper_long_quantity": quantity,
        "body_short_quantity": 2 * quantity,
        "lower_long_quantity": lower_quantity,
        "lower_long_quantity_multiplier": lower_multiplier,
        "entry_credit_per_fly": entry_credit_per_fly,
        "entry_credit": entry_credit,
        "entry_debit": max(0.0, -entry_credit),
        "natural_credit": natural_credit,
        "execution_cost": execution_cost,
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
        "quote_source": (
            "live_bid_ask" if all_legs_live else "last_trade_estimate"
        ),
        "uses_last_trade_prices": uses_last_trade_prices,
        "upper_flat_outcome": upper_flat,
        "center_max_profit": peak_profit,
        "lower_flat_outcome": lower_corner,
        "lower_corner_outcome": lower_corner,
        "zero_price_tail_outcome": zero_price_tail,
        "upper_flat_dollars": upper_flat * CONTRACT_MULTIPLIER,
        "center_max_profit_dollars": peak_profit * CONTRACT_MULTIPLIER,
        "lower_flat_dollars": lower_corner * CONTRACT_MULTIPLIER,
        "lower_corner_dollars": lower_corner * CONTRACT_MULTIPLIER,
        "zero_price_tail_dollars": zero_price_tail * CONTRACT_MULTIPLIER,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "max_profit_dollars": max_profit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": max_loss * CONTRACT_MULTIPLIER,
        "return_on_risk_pct": (
            max_profit / max_loss * 100.0 if max_loss > 0 else None
        ),
        "lower_breakeven": lower_breakeven,
        "downside_breakeven": downside_breakeven,
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
            (spot - upper_strike) / spot * 100.0 if spot > 0 else None
        ),
        "upper_long_distance_sigma": (
            math.log(spot / upper_strike) / (front_iv * math.sqrt(years))
            if (
                spot > upper_strike
                and front_iv is not None
                and front_iv > 0
                and years > 0
            ) else None
        ),
        "prob_touch_lower_short_pct": (
            prob_touch_body * 100.0 if prob_touch_body is not None else None
        ),
        "prob_touch_lower_long_pct": (
            prob_touch_lower_long * 100.0
            if prob_touch_lower_long is not None else None
        ),
        "prob_finish_below_lower_short_pct": (
            prob_finish_below_body * 100.0
            if prob_finish_below_body is not None else None
        ),
        "prob_finish_below_lower_long_pct": (
            prob_finish_below_lower_long * 100.0
            if prob_finish_below_lower_long is not None else None
        ),
        "probability_iv": probability_iv,
        "lower_short_distance_pct": (
            (spot - body_strike) / spot * 100.0 if spot > 0 else None
        ),
        "lower_short_distance_sigma": (
            math.log(spot / body_strike) / (probability_iv * math.sqrt(years))
            if (
                spot > body_strike
                and probability_iv is not None
                and probability_iv > 0
                and years > 0
            ) else None
        ),
        "probability_schedule": probability_schedule,
        "profit_capture": profit_capture,
        "price_scenarios": price_scenarios,
        "_analytics_pending": analytics_pending,
        "early_close_estimates": early_close_estimates,
        "course_expected_hold_days": COURSE_EXPECTED_HOLD_DAYS,
        "course_quantity_scale": course_quantity_scale,
        "course_profit_target_dollars": (
            COURSE_PROFIT_TARGET_DOLLARS * course_quantity_scale
        ),
        "course_max_loss_target_dollars": (
            COURSE_MAX_LOSS_TARGET_DOLLARS * course_quantity_scale
        ),
        "course_planned_capital_low_dollars": (
            COURSE_PLANNED_CAPITAL_LOW_DOLLARS * course_quantity_scale
        ),
        "course_planned_capital_high_dollars": (
            COURSE_PLANNED_CAPITAL_HIGH_DOLLARS * course_quantity_scale
        ),
        "open_interest_min": oi_min,
        "volume_min": volume_min,
        "upper_long_leg": _leg_view(upper_long),
        "body_short_leg": _leg_view(body_short),
        "lower_long_leg": _leg_view(lower_long),
    }


def _target_names(value) -> list[str]:
    normalized = str(value or "both").strip().lower()
    if normalized in {"both", "all"}:
        return list(UPPER_LONG_TARGETS)
    requested = [
        item.strip().replace("-delta", "")
        for item in re.split(r"[\s,;/]+", normalized)
        if item.strip()
    ]
    names = [name for name in requested if name in UPPER_LONG_TARGETS]
    if not names:
        raise ValueError("upper_long_delta must be both, 20, or 25")
    return list(dict.fromkeys(names))


def _bias_name(value) -> str:
    normalized = str(value or "neutral").strip().lower()
    if normalized not in BIAS_RANGES:
        raise ValueError("market_bias must be bearish, neutral, or bullish")
    return normalized


# Exactly what the deferred build leaves out. Copying only these back means a
# caller that overrode a base field after enumeration -- the 488 scanner
# replaces the course hold days and max-loss target with its document's own --
# keeps its value instead of having the rebuild's default reinstated.
_DEFERRED_PANELS = (
    "probability_schedule",
    "profit_capture",
    "price_scenarios",
    "early_close_estimates",
)


def with_full_analytics(candidate: dict | None) -> dict | None:
    """Finish a structure that was enumerated without its probability panels.

    Prices it again with ``with_analytics`` on and takes only the panels from
    that result, leaving every other field as the caller has it. A candidate
    that was already built in full passes straight through.
    """
    if not candidate:
        return candidate
    pending = candidate.pop("_analytics_pending", None)
    if not pending:
        return candidate
    legs, kwargs = pending
    full = _build_butterfly(*legs, **kwargs, with_analytics=True)
    if full is None:
        return candidate
    for key in _DEFERRED_PANELS:
        candidate[key] = full.get(key)
    return candidate


def _candidate_quality(
    candidate: dict,
    *,
    bias_low: float,
    bias_high: float,
    target_theta_dollars: float,
) -> tuple:
    return (
        _distance_to_range(candidate.get("position_delta"), bias_low, bias_high),
        abs(candidate.get("entry_credit_dollars") or 0.0),
        abs(
            (candidate.get("theta_dollars_per_day") or 0.0)
            - target_theta_dollars
        ),
        candidate["upper_long_delta_error"]
        + candidate["body_short_delta_error"]
        + candidate["lower_long_delta_error"],
        candidate.get("execution_cost_dollars") or math.inf,
        -(candidate.get("open_interest_min") or 0),
    )


def _candidates_for_target(
    puts: list[dict],
    *,
    spot: float,
    expiration: str,
    dte: int,
    upper_long_target: float,
    tranche_quantity: int,
    min_lower_wing_ratio: float,
    dividend_yield: float,
    bias_low: float,
    bias_high: float,
    target_theta_dollars: float,
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

    # Live chains are already sparse after quote validation. Last-trade chains
    # can contain hundreds of usable marks, so keep their search bounded before
    # running the comparatively expensive probability model on each structure.
    has_estimated_leg = any(
        leg.get("quote_source") == "last_trade"
        for leg in legs
    )
    upper_limit = 4 if has_estimated_leg else 10
    body_limit = 6 if has_estimated_leg else 14
    lower_limit = 10 if has_estimated_leg else 24

    lower_target = _lower_long_target(upper_long_target)
    upper_longs = sorted(
        legs,
        key=lambda leg: abs(abs(leg["delta"]) - upper_long_target),
    )[:upper_limit]
    candidates = []
    seen = set()
    for upper_long in upper_longs:
        body_shorts = sorted(
            [
                leg for leg in legs
                if leg["strike"] < upper_long["strike"]
            ],
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
                    abs(abs(leg["delta"]) - lower_target),
                    abs(
                        tranche_quantity * (
                            upper_long["delta"]
                            - 2.0 * body_short["delta"]
                            + leg["delta"]
                        ) * CONTRACT_MULTIPLIER
                    ),
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
                    upper_long_target=upper_long_target,
                    tranche_quantity=tranche_quantity,
                    dividend_yield=dividend_yield,
                    with_analytics=False,
                )
                if candidate:
                    candidates.append(candidate)

    candidates.sort(key=lambda candidate: _candidate_quality(
        candidate,
        bias_low=bias_low,
        bias_high=bias_high,
        target_theta_dollars=target_theta_dollars,
    ))
    return candidates


def _choose_candidate(
    candidates: list[dict],
    *,
    bias_low: float,
    bias_high: float,
    delta_tolerance: float,
    min_open_interest: int,
    target_theta_dollars: float,
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
        )
    ]
    return min(
        passing or candidates,
        key=lambda candidate: _candidate_quality(
            candidate,
            bias_low=bias_low,
            bias_high=bias_high,
            target_theta_dollars=target_theta_dollars,
        ),
    )


def _round_candidate(candidate: dict) -> dict:
    out = dict(candidate)
    # Enumeration-only bookkeeping: the arguments needed to rebuild a
    # structure with its probability panels. Never part of a payload.
    out.pop("_analytics_pending", None)
    for key, decimals in (
        ("target_upper_long_delta", 2),
        ("target_body_short_delta", 2),
        ("target_lower_long_delta", 2),
        ("actual_upper_long_delta", 3),
        ("actual_body_short_delta", 3),
        ("actual_lower_long_delta", 3),
        ("upper_long_delta_error", 3),
        ("body_short_delta_error", 3),
        ("lower_long_delta_error", 3),
        ("position_delta", 2),
        ("position_delta_per_share", 4),
        ("theta_dollars_per_day", 2),
        ("upper_long_strike", 2),
        ("body_short_strike", 2),
        ("lower_short_strike", 2),
        ("lower_long_strike", 2),
        ("upper_width", 2),
        ("lower_width", 2),
        ("lower_wing_ratio", 2),
        ("entry_credit_per_fly", 4),
        ("entry_credit", 2),
        ("entry_debit", 2),
        ("natural_credit", 2),
        ("execution_cost", 2),
        ("entry_credit_dollars", 0),
        ("entry_debit_dollars", 0),
        ("natural_credit_dollars", 0),
        ("execution_cost_dollars", 0),
        ("upper_flat_outcome", 2),
        ("center_max_profit", 2),
        ("lower_flat_outcome", 2),
        ("lower_corner_outcome", 2),
        ("zero_price_tail_outcome", 2),
        ("upper_flat_dollars", 0),
        ("center_max_profit_dollars", 0),
        ("lower_flat_dollars", 0),
        ("lower_corner_dollars", 0),
        ("zero_price_tail_dollars", 0),
        ("max_profit", 2),
        ("max_loss", 2),
        ("max_profit_dollars", 0),
        ("max_loss_dollars", 0),
        ("return_on_risk_pct", 1),
        ("lower_breakeven", 2),
        ("downside_breakeven", 2),
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
            "probability_failure_pct": _round(
                estimate.get("probability_failure_pct"),
                1,
            ),
        }
        for estimate in out.get("early_close_estimates", [])
    ]
    out["probability_schedule"] = [
        {
            **point,
            "unchanged_spot_pl_dollars": _round(
                point.get("unchanged_spot_pl_dollars"),
                0,
            ),
            "upper_long_pl_dollars": _round(
                point.get("upper_long_pl_dollars"),
                0,
            ),
            "body_peak_pl_dollars": _round(
                point.get("body_peak_pl_dollars"),
                0,
            ),
        }
        for point in out.get("probability_schedule", [])
    ]
    return out


def _ticker_list(raw) -> list[str]:
    return _index_only_tickers(raw, DEFAULT_TICKERS, limit=50)


def run_unbalanced_butterfly_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{
        key: value
        for key, value in (payload or {}).items()
        if value is not None
    }}
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    target_names = _target_names(p.get("upper_long_delta"))
    market_bias = _bias_name(p.get("market_bias"))
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
    tranche_quantity = max(
        1,
        min(100, int(_num(p.get("tranche_quantity"), 4) or 4)),
    )
    quantity_scale = tranche_quantity / COURSE_BASE_LONG_QUANTITY
    base_bias_low, base_bias_high = BIAS_RANGES[market_bias]
    bias_low = base_bias_low * quantity_scale
    bias_high = base_bias_high * quantity_scale
    delta_tolerance = min(
        0.15,
        max(0.005, _num(p.get("delta_tolerance"), 0.035) or 0.035),
    )
    target_theta_dollars = min(
        1000.0,
        max(-1000.0, _num(p.get("target_theta_dollars"), 20.0) or 20.0),
    )
    theta_tolerance_dollars = min(
        1000.0,
        max(
            0.0,
            _num(p.get("theta_tolerance_dollars"), 15.0) or 15.0,
        ),
    )
    uel_tolerance_dollars = min(
        100000.0,
        max(
            0.0,
            _num(p.get("uel_tolerance_dollars"), 250.0) or 250.0,
        ),
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
        monthly_expirations = _monthly_expirations_in_window(
            expirations,
            target_dte,
            min_dte,
            max_dte,
        )
        if not monthly_expirations:
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
        chosen_by_target = {}
        expirations_priced = 0
        usable_chains = 0
        for expiration, dte in monthly_expirations:
            puts = _load_put_chain(
                ticker,
                expiration,
                spot,
                dividend_yield,
            )
            expirations_priced += 1
            if not puts:
                continue
            usable_chains += 1

            for target_name in target_names:
                if target_name in chosen_by_target:
                    continue
                upper_long_target = UPPER_LONG_TARGETS[target_name]
                candidates = _candidates_for_target(
                    puts,
                    spot=spot,
                    expiration=expiration,
                    dte=dte,
                    upper_long_target=upper_long_target,
                    tranche_quantity=tranche_quantity,
                    min_lower_wing_ratio=min_lower_wing_ratio,
                    dividend_yield=dividend_yield,
                    bias_low=bias_low,
                    bias_high=bias_high,
                    target_theta_dollars=target_theta_dollars,
                )
                if not candidates:
                    continue
                best = with_full_analytics(_choose_candidate(
                    candidates,
                    bias_low=bias_low,
                    bias_high=bias_high,
                    delta_tolerance=delta_tolerance,
                    min_open_interest=min_open_interest,
                    target_theta_dollars=target_theta_dollars,
                ))
                best["market_bias"] = market_bias
                best["bias_delta_min"] = bias_low
                best["bias_delta_max"] = bias_high
                best["position_delta_error"] = _distance_to_range(
                    best.get("position_delta"),
                    bias_low,
                    bias_high,
                )

                blocking_flags = []
                advisory_flags = []
                if best["upper_long_delta_error"] > delta_tolerance:
                    blocking_flags.append(
                        "Upper long delta outside tolerance"
                    )
                if best["body_short_delta_error"] > delta_tolerance:
                    blocking_flags.append(
                        "Body short delta outside tolerance"
                    )
                if best["lower_long_delta_error"] > delta_tolerance:
                    blocking_flags.append(
                        "Balancing lower long delta outside tolerance"
                    )
                if best["position_delta_error"] > 0:
                    blocking_flags.append(
                        f"Position delta is outside the scaled "
                        f"{market_bias} course range"
                    )
                if best["open_interest_min"] < min_open_interest:
                    blocking_flags.append(
                        "One or more legs are below minimum open interest"
                    )
                if best.get("uses_last_trade_prices"):
                    blocking_flags.append(
                        "Live bid/ask unavailable on one or more legs; "
                        "entry values use recent trades"
                    )
                if (
                    abs(best["entry_credit_dollars"])
                    > uel_tolerance_dollars
                ):
                    advisory_flags.append(
                        "Upper expiration line is outside the preferred "
                        "zero band"
                    )
                theta_value = best.get("theta_dollars_per_day")
                if (
                    theta_value is None
                    or abs(theta_value - target_theta_dollars)
                    > theta_tolerance_dollars
                ):
                    advisory_flags.append(
                        "Theta is outside the preferred entry band"
                    )
                natural_credit = best.get("natural_credit")
                if (
                    natural_credit is not None
                    and natural_credit < 0 <= best["entry_credit"]
                ):
                    advisory_flags.append(
                        "Mid shows a credit but the natural market is a debit"
                    )

                best.update({
                    "ticker": ticker,
                    "name": fund.get("name"),
                    "price": spot,
                    "status": (
                        "actionable" if not blocking_flags else "near_match"
                    ),
                    "flags": [*blocking_flags, *advisory_flags],
                    "blocking_flags": blocking_flags,
                    "scanner_variant": (
                        f"{target_name}-delta-{market_bias}"
                        f"-q{tranche_quantity}"
                    ),
                    "target_theta_dollars": target_theta_dollars,
                    "theta_tolerance_dollars": theta_tolerance_dollars,
                    "uel_tolerance_dollars": uel_tolerance_dollars,
                })
                chosen_by_target[target_name] = _round_candidate(best)

            if len(chosen_by_target) == len(target_names):
                break

        chosen = [
            chosen_by_target[target_name]
            for target_name in target_names
            if target_name in chosen_by_target
        ]
        first_expiration, first_dte = monthly_expirations[0]
        selected_expiration = (
            chosen[0].get("expiration") if chosen else first_expiration
        )
        selected_dte = chosen[0].get("dte") if chosen else first_dte
        missing = [
            (
                f"{target_name}-delta: no live or recent-trade "
                f"broken-wing combination across "
                f"{len(monthly_expirations)} standard monthlies"
            )
            for target_name in target_names
            if target_name not in chosen_by_target
        ]
        if not chosen and usable_chains == 0:
            missing = [
                "The selected monthly-expiration window has no usable put chain."
            ]
        return {
            "ticker": ticker,
            "name": fund.get("name"),
            "price": _round(spot),
            "expiration": selected_expiration,
            "dte": selected_dte,
            "expirations_priced": expirations_priced,
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
        row.get("position_delta_error", math.inf),
        abs(row.get("entry_credit_dollars") or 0.0),
        abs(
            (row.get("theta_dollars_per_day") or 0.0)
            - target_theta_dollars
        ),
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
                result.get("expirations_priced", 0)
                for result in scan_results
            ),
            "structures_found": len(rows),
            "actionable": sum(
                1 for row in rows if row["status"] == "actionable"
            ),
            "near_matches": sum(
                1 for row in rows if row["status"] == "near_match"
            ),
        },
        "params": {
            "tickers": tickers,
            "upper_long_delta_targets": target_names,
            "market_bias": market_bias,
            "bias_delta_min": bias_low,
            "bias_delta_max": bias_high,
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "tranche_quantity": tranche_quantity,
            "delta_tolerance": delta_tolerance,
            "target_theta_dollars": target_theta_dollars,
            "theta_tolerance_dollars": theta_tolerance_dollars,
            "uel_tolerance_dollars": uel_tolerance_dollars,
            "min_lower_wing_ratio": min_lower_wing_ratio,
            "min_open_interest": min_open_interest,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def register_routes(app):
    @app.route(
        "/api/options/unbalanced-butterfly-scan/defaults",
        methods=["GET"],
    )
    def unbalanced_butterfly_scan_defaults():
        return jsonify(
            defaults=DEFAULTS,
            upper_long_delta_options=[
                {
                    "id": name,
                    "upper_long_delta": value,
                    "body_short_delta": BODY_SHORT_TARGET,
                    "balancing_lower_long_delta": _lower_long_target(value),
                }
                for name, value in UPPER_LONG_TARGETS.items()
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

    @app.route("/api/options/unbalanced-butterfly-scan", methods=["POST"])
    def unbalanced_butterfly_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            return jsonify(run_unbalanced_butterfly_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
