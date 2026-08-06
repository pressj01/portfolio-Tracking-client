"""Iron butterfly option scanner.

An iron butterfly is a same-expiration, four-leg short straddle with defined
risk:

    BUY  1 put below the body
    SELL 1 put at the body strike
    SELL 1 call at the same body strike
    BUY  1 call above the body

This screen keeps the shared body near the requested offset and selects listed
long-wing strikes near a fixed absolute delta, so the strike distance expands
with DTE while the target delta remains unchanged. Exact strike overrides are
also supported for a user-specified skewed or off-centre structure.

Endpoints:
  GET  /api/options/iron-butterfly-scan/defaults
  POST /api/options/iron-butterfly-scan
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import math
import re

from flask import jsonify, request
import yfinance as yf

from call_scanner import _load_call_chain
from option_probability import profit_probability_schedule
from options_pricing import black_scholes
from put_scanner import (
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    RISK_FREE,
    _clean_tickers,
    _fetch_fundamentals_bulk,
    _load_history,
    _load_put_chain,
    _num,
    _prepare_option_quote,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)


CONTRACT_MULTIPLIER = 100.0
DEFAULT_TICKERS = ["SPY", "QQQ", "IWM"]
# A broad option chain can have hundreds of strikes. These limits make the
# no-override discovery search responsive while preserving all exact strikes
# supplied by the user.
BODY_SEARCH_LIMIT = 12
WING_SEARCH_LIMIT = 10
DEFAULTS = {
    "tickers": ",".join(DEFAULT_TICKERS),
    "target_dte": 45,
    "min_dte": MIN_TARGET_DTE,
    "max_dte": MAX_TARGET_DTE,
    "expiration_count": 5,
    "quantity": 1,
    # Empty values mean that the scanner searches all available body/wing
    # strikes.  The UI exposes them as optional exact strike overrides.
    "body_strike": None,
    "put_wing_strike": None,
    "call_wing_strike": None,
    "min_wing_width_pct": 1.0,
    "max_wing_width_pct": 50.0,
    "target_wing_delta": 0.16,
    "min_credit_pct_of_wing": 5.0,
    "max_wing_skew_pct": 100.0,
    "target_body_offset_pct": 0.0,
    "max_abs_net_delta": 10.0,
    "min_open_interest": 0,
    "max_bid_ask_pct": 35.0,
    "exit_dte": 21,
    "max_results": 20,
}


def _clamp(value, default, low, high):
    parsed = _num(value)
    if parsed is None:
        parsed = default
    return min(high, max(low, parsed))


def _ticker_list(raw) -> list[str]:
    if isinstance(raw, str):
        raw = re.split(r"[\s,;]+", raw)
    return _clean_tickers(raw)[:20]


def _optional_strike(value) -> float | None:
    if value is None or value == "":
        return None
    parsed = _num(value)
    return parsed if parsed is not None and parsed > 0 else None


def _fallback_spot_price(ticker: str) -> float | None:
    """Recover a spot quote when Yahoo's bulk history omits one symbol."""
    try:
        instrument = yf.Ticker(ticker)
    except Exception:
        return None

    try:
        fast_info = instrument.fast_info
    except Exception:
        fast_info = None
    for key in ("last_price", "lastPrice", "previous_close", "previousClose"):
        try:
            value = getattr(fast_info, key, None)
            if value is None and hasattr(fast_info, "get"):
                value = fast_info.get(key)
        except Exception:
            value = None
        parsed = _num(value)
        if parsed is not None and parsed > 0:
            return parsed

    try:
        history = instrument.history(period="5d", auto_adjust=False)
        close = history["Close"].dropna() if history is not None else None
        if close is not None and not close.empty:
            parsed = _num(close.iloc[-1])
            if parsed is not None and parsed > 0:
                return parsed
    except Exception:
        pass
    return None


def _expirations_in_window(
    expirations: list[str],
    target_dte: int,
    min_dte: int,
    max_dte: int,
    limit: int,
) -> list[tuple[str, int]]:
    """Return the nearest listed expirations, including arbitrary DTEs."""
    today = date.today()
    choices = []
    for expiration in expirations:
        try:
            expiration_date = datetime.strptime(expiration, "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        dte = (expiration_date - today).days
        if min_dte <= dte <= max_dte:
            choices.append((expiration, dte))
    choices.sort(key=lambda item: (abs(item[1] - target_dte), item[1], item[0]))
    return choices[:max(1, limit)]


def _management_points(dte: int, exit_dte: int) -> list[dict]:
    """Create DTE-relative review points without assuming a fixed horizon."""
    requested = [
        ("Halfway review", max(1, int(round(dte * 0.50))), "review"),
        ("21-DTE review", int(exit_dte), "planned_exit"),
    ]
    points = []
    seen = set()
    for label, remaining_dte, kind in requested:
        remaining_dte = min(max(0, remaining_dte), max(0, dte - 1))
        if remaining_dte <= 0 or remaining_dte in seen:
            continue
        seen.add(remaining_dte)
        points.append({
            "kind": kind,
            "label": label if label != "21-DTE review" else f"{remaining_dte}-DTE review",
            "remaining_dte": remaining_dte,
        })
    return points


def _leg_spread_pct(leg: dict) -> float | None:
    bid = _num(leg.get("bid"))
    ask = _num(leg.get("ask"))
    mid = _num(leg.get("mid"))
    if (
        bid is None
        or ask is None
        or mid is None
        or bid <= 0
        or ask < bid
        or mid <= 0
    ):
        return None
    return (ask - bid) / mid * 100.0


def _prepare_chain(
    chain: list[dict],
    *,
    option_type: str,
    spot: float,
    dte: int,
    dividend_yield: float,
) -> list[dict]:
    prepared = []
    for leg in chain or []:
        quote = _prepare_option_quote(
            leg,
            option_type=option_type,
            spot=spot,
            dte=dte,
            dividend_yield=dividend_yield,
        )
        strike = _num(quote.get("strike")) if quote else None
        mid = _num(quote.get("mid")) if quote else None
        if quote is not None and strike and strike > 0 and mid and mid > 0:
            prepared.append(quote)
    return prepared


def _evenly_limited(items: list[dict], limit: int) -> list[dict]:
    """Bound chain combinatorics while retaining the full strike range."""
    if len(items) <= limit:
        return items
    if limit <= 1:
        return [items[len(items) // 2]]
    ordered = sorted(items, key=lambda item: item["strike"])
    indexes = [round(i * (len(ordered) - 1) / (limit - 1)) for i in range(limit)]
    return [ordered[index] for index in dict.fromkeys(indexes)]


def _strike_match(items: list[dict], requested: float | None) -> list[dict]:
    if requested is None:
        return items
    matches = [item for item in items if abs(item["strike"] - requested) <= 0.011]
    return matches[:1]


def _leg_view(leg: dict, option_type: str, quantity: int) -> dict:
    return {
        "strike": _round(leg.get("strike")),
        "bid": _round(leg.get("bid")),
        "ask": _round(leg.get("ask")),
        "mid": _round(leg.get("mid")),
        "iv": _round(leg.get("iv"), 4),
        "delta": _round(leg.get("delta"), 4),
        "volume": int(_num(leg.get("volume"), 0) or 0),
        "open_interest": int(_num(leg.get("open_interest"), 0) or 0),
        "quote_source": leg.get("quote_source"),
        "option_type": option_type,
        "qty": quantity,
    }


def _modeled_pl(
    *,
    exit_spot: float,
    remaining_dte: int,
    entry_credit: float,
    legs: list[tuple[dict, str, int]],
    dividend_yield: float,
) -> float | None:
    total = entry_credit
    years = max(remaining_dte, 0) / 365.0
    for leg, option_type, quantity in legs:
        strike = _num(leg.get("strike"))
        volatility = _num(leg.get("iv"))
        if not strike or not volatility or volatility <= 0:
            return None
        total += quantity * black_scholes(
            exit_spot,
            strike,
            years,
            RISK_FREE,
            dividend_yield,
            volatility,
            option_type,
        )["price"]
    return total


def _build_iron_butterfly(
    put_long: dict,
    put_short: dict,
    call_short: dict,
    call_long: dict,
    *,
    spot: float,
    expiration: str,
    dte: int,
    quantity: int,
    dividend_yield: float,
    exit_dte: int,
    target_wing_delta: float = 0.16,
    include_analysis: bool = True,
) -> dict | None:
    put_long_strike = _num(put_long.get("strike"))
    body_strike = _num(put_short.get("strike"))
    call_short_strike = _num(call_short.get("strike"))
    call_long_strike = _num(call_long.get("strike"))
    if not all(value and value > 0 for value in (
        put_long_strike,
        body_strike,
        call_short_strike,
        call_long_strike,
    )):
        return None
    if abs(body_strike - call_short_strike) > 0.011:
        return None
    if not put_long_strike < body_strike < call_long_strike:
        return None

    put_width = body_strike - put_long_strike
    call_width = call_long_strike - body_strike
    quantity = max(1, int(quantity))
    put_long_mid = _num(put_long.get("mid"), 0.0) or 0.0
    put_short_mid = _num(put_short.get("mid"), 0.0) or 0.0
    call_short_mid = _num(call_short.get("mid"), 0.0) or 0.0
    call_long_mid = _num(call_long.get("mid"), 0.0) or 0.0
    credit_per_unit = put_short_mid + call_short_mid - put_long_mid - call_long_mid
    entry_credit = quantity * credit_per_unit
    lower_flat = entry_credit - quantity * put_width
    upper_flat = entry_credit - quantity * call_width
    max_loss = max(0.0, -min(lower_flat, upper_flat))
    max_profit = max(0.0, entry_credit)
    # A zero-risk result is almost always a stale or crossed quote. Do not put
    # it in the candidate list and make it look like free money.
    if max_profit <= 0 or max_loss <= 0:
        return None

    legs = [
        (put_long, "put", quantity),
        (put_short, "put", -quantity),
        (call_short, "call", -quantity),
        (call_long, "call", quantity),
    ]
    all_legs_live = all(
        leg.get("quote_source") == "live_bid_ask"
        for leg, _, _ in legs
    )
    natural_credit = None
    execution_cost = None
    if all_legs_live:
        natural_credit = quantity * (
            (_num(put_short.get("bid"), 0.0) or 0.0)
            + (_num(call_short.get("bid"), 0.0) or 0.0)
            - (_num(put_long.get("ask"), 0.0) or 0.0)
            - (_num(call_long.get("ask"), 0.0) or 0.0)
        )
        execution_cost = quantity * sum(
            (_num(leg.get("ask"), 0.0) or 0.0)
            - (_num(leg.get("bid"), 0.0) or 0.0)
            for leg, _, _ in legs
        )

    signed_delta = sum(
        quantity_sign * (_num(leg.get("delta"), 0.0) or 0.0)
        for leg, _, quantity_sign in legs
    )
    position_delta = signed_delta * CONTRACT_MULTIPLIER
    theta_dollars = None
    if include_analysis:
        years = max(int(dte), 1) / 365.0
        theta = 0.0
        greeks_available = True
        for leg, option_type, quantity_sign in legs:
            strike = _num(leg.get("strike"))
            volatility = _num(leg.get("iv"))
            if strike is None or volatility is None or volatility <= 0:
                greeks_available = False
                break
            theta += quantity_sign * black_scholes(
                spot,
                strike,
                years,
                RISK_FREE,
                dividend_yield,
                volatility,
                option_type,
            )["theta"]
        theta_dollars = theta * CONTRACT_MULTIPLIER if greeks_available else None

    body_iv_values = [
        _num(put_short.get("iv")),
        _num(call_short.get("iv")),
    ]
    body_iv_values = [value for value in body_iv_values if value and value > 0]
    distribution_iv = (
        sum(body_iv_values) / len(body_iv_values)
        if body_iv_values else None
    )
    put_width_pct = put_width / spot * 100.0 if spot else None
    call_width_pct = call_width / spot * 100.0 if spot else None
    put_delta_value = _num(put_long.get("delta"))
    call_delta_value = _num(call_long.get("delta"))
    put_wing_delta = abs(put_delta_value) if put_delta_value is not None else None
    call_wing_delta = abs(call_delta_value) if call_delta_value is not None else None
    wing_delta_error = (
        (
            abs(put_wing_delta - target_wing_delta)
            + abs(call_wing_delta - target_wing_delta)
        ) / 2.0
        if put_wing_delta is not None and call_wing_delta is not None
        else None
    )
    probability_schedule = []
    if include_analysis and distribution_iv:
        probability_schedule = profit_probability_schedule(
            spot=spot,
            dte=dte,
            expiration=expiration,
            distribution_iv=distribution_iv,
            entry_cashflow=entry_credit,
            legs=[
                {
                    "option_type": option_type,
                    "strike": leg["strike"],
                    "iv": leg.get("iv"),
                    "quantity": quantity_sign,
                }
                for leg, option_type, quantity_sign in legs
            ],
            exit_points=_management_points(dte, exit_dte),
            risk_free_rate=RISK_FREE,
            dividend_yield=dividend_yield,
            include_breakeven=True,
        )

    expiration_point = next(
        (point for point in probability_schedule if point.get("kind") == "expiration"),
        None,
    )
    leg_spreads = [_leg_spread_pct(leg) for leg, _, _ in legs]
    valid_spreads = [spread for spread in leg_spreads if spread is not None]
    min_open_interest = min(
        int(_num(leg.get("open_interest"), 0) or 0)
        for leg, _, _ in legs
    )
    min_volume = min(
        int(_num(leg.get("volume"), 0) or 0)
        for leg, _, _ in legs
    )
    return {
        "expiration": expiration,
        "dte": int(dte),
        "structure_kind": "iron-butterfly",
        "body_strike": body_strike,
        "put_long_strike": put_long_strike,
        "call_long_strike": call_long_strike,
        "put_width": put_width,
        "call_width": call_width,
        "put_width_pct": put_width_pct,
        "call_width_pct": call_width_pct,
        "max_wing": max(put_width, call_width),
        "wing_skew_pct": abs(put_width - call_width) / min(put_width, call_width) * 100.0,
        "put_wing_delta": put_wing_delta,
        "call_wing_delta": call_wing_delta,
        "target_wing_delta": target_wing_delta,
        "wing_delta_error": wing_delta_error,
        "body_offset_pct": (body_strike - spot) / spot * 100.0 if spot else None,
        "quantity": quantity,
        "entry_credit": entry_credit,
        "entry_credit_per_unit": credit_per_unit,
        "entry_credit_dollars": entry_credit * CONTRACT_MULTIPLIER,
        "entry_price_dollars": abs(entry_credit) * CONTRACT_MULTIPLIER,
        "entry_side": "credit" if entry_credit > 0 else "debit",
        "natural_credit": natural_credit,
        "natural_credit_dollars": (
            natural_credit * CONTRACT_MULTIPLIER
            if natural_credit is not None else None
        ),
        "execution_cost": execution_cost,
        "execution_cost_dollars": (
            execution_cost * CONTRACT_MULTIPLIER
            if execution_cost is not None else None
        ),
        "uses_last_trade_prices": not all_legs_live,
        "quote_source": "live_bid_ask" if all_legs_live else "last_trade_estimate",
        "max_profit": max_profit,
        "max_loss": max_loss,
        "max_profit_dollars": max_profit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": max_loss * CONTRACT_MULTIPLIER,
        "return_on_risk_pct": max_profit / max_loss * 100.0,
        "annualized_return_on_risk_pct": max_profit / max_loss * 100.0 * 365.0 / max(int(dte), 1),
        "lower_flat_dollars": lower_flat * CONTRACT_MULTIPLIER,
        "upper_flat_dollars": upper_flat * CONTRACT_MULTIPLIER,
        "lower_breakeven": body_strike - credit_per_unit,
        "upper_breakeven": body_strike + credit_per_unit,
        "profit_zone_width_pct": 2.0 * credit_per_unit / spot * 100.0 if spot else None,
        "credit_pct_of_min_wing": credit_per_unit / min(put_width, call_width) * 100.0,
        "position_delta": position_delta,
        "position_delta_per_share": signed_delta,
        "theta_dollars_per_day": theta_dollars,
        "delta_theta_ratio_pct": (
            abs(position_delta) / abs(theta_dollars) * 100.0
            if theta_dollars is not None and abs(theta_dollars) >= 0.01 else None
        ),
        "max_leg_bid_ask_pct": max(valid_spreads) if len(valid_spreads) == 4 else None,
        "open_interest_min": min_open_interest,
        "volume_min": min_volume,
        "distribution_iv": distribution_iv,
        "probability_schedule": probability_schedule,
        "prob_profit": (
            expiration_point.get("probability_success_pct")
            if expiration_point else None
        ),
        "legs": [
            _leg_view(put_long, "put", quantity),
            _leg_view(put_short, "put", -quantity),
            _leg_view(call_short, "call", -quantity),
            _leg_view(call_long, "call", quantity),
        ],
        "put_long_leg": _leg_view(put_long, "put", quantity),
        "put_short_leg": _leg_view(put_short, "put", -quantity),
        "call_short_leg": _leg_view(call_short, "call", -quantity),
        "call_long_leg": _leg_view(call_long, "call", quantity),
        "management": {
            "reassess_dte": min(max(1, int(exit_dte)), max(1, int(dte) - 1)),
            "profit_capture_pct": 50.0,
            "target_debit": entry_credit * 0.50,
        },
    }


def _candidate_combinations(
    puts: list[dict],
    calls: list[dict],
    *,
    spot: float,
    expiration: str,
    dte: int,
    quantity: int,
    dividend_yield: float,
    exit_dte: int,
    body_strike: float | None,
    put_wing_strike: float | None,
    call_wing_strike: float | None,
    min_wing_width_pct: float,
    max_wing_width_pct: float,
    target_wing_delta: float = 0.16,
    include_analysis: bool = True,
) -> list[dict]:
    puts_by_strike = {round(leg["strike"], 4): leg for leg in puts}
    calls_by_strike = {round(leg["strike"], 4): leg for leg in calls}
    body_keys = sorted(set(puts_by_strike).intersection(calls_by_strike))
    if body_strike is not None:
        body_keys = [
            key for key in body_keys
            if abs(key - body_strike) <= 0.011
        ]
    # The no-override discovery search uses nearby bodies and evenly-spaced
    # wings. A full chain can otherwise create hundreds of thousands of
    # combinations per expiration. Any explicit strike remains unbounded: its
    # exact listed value is always retained.
    if body_strike is None and put_wing_strike is None and call_wing_strike is None:
        body_keys = sorted(body_keys, key=lambda key: abs(key - spot))[:BODY_SEARCH_LIMIT]

    candidates = []
    for body_key in body_keys:
        body_put = puts_by_strike[body_key]
        body_call = calls_by_strike[body_key]
        lower = []
        upper = []
        for leg in puts:
            width_pct = (body_key - leg["strike"]) / spot * 100.0
            if leg["strike"] < body_key and min_wing_width_pct <= width_pct <= max_wing_width_pct:
                lower.append(leg)
        for leg in calls:
            width_pct = (leg["strike"] - body_key) / spot * 100.0
            if leg["strike"] > body_key and min_wing_width_pct <= width_pct <= max_wing_width_pct:
                upper.append(leg)
        lower = _strike_match(lower, put_wing_strike)
        upper = _strike_match(upper, call_wing_strike)
        if not lower or not upper:
            continue
        if put_wing_strike is None:
            lower = (
                sorted(
                    lower,
                    key=lambda leg: abs(
                        abs(_num(leg.get("delta")) or 0.0) - target_wing_delta
                    ),
                )[:WING_SEARCH_LIMIT]
                if any(_num(leg.get("delta")) is not None for leg in lower)
                else _evenly_limited(lower, WING_SEARCH_LIMIT)
            )
        if call_wing_strike is None:
            upper = (
                sorted(
                    upper,
                    key=lambda leg: abs(
                        abs(_num(leg.get("delta")) or 0.0) - target_wing_delta
                    ),
                )[:WING_SEARCH_LIMIT]
                if any(_num(leg.get("delta")) is not None for leg in upper)
                else _evenly_limited(upper, WING_SEARCH_LIMIT)
            )
        for put_long in lower:
            for call_long in upper:
                candidate = _build_iron_butterfly(
                    put_long,
                    body_put,
                    body_call,
                    call_long,
                    spot=spot,
                    expiration=expiration,
                    dte=dte,
                    quantity=quantity,
                    dividend_yield=dividend_yield,
                    exit_dte=exit_dte,
                    target_wing_delta=target_wing_delta,
                    include_analysis=include_analysis,
                )
                if candidate is not None:
                    candidates.append(candidate)

    # Do not return hundreds of nearly identical strikes for a single ticker.
    candidates.sort(key=lambda item: (
        abs(item.get("body_offset_pct") or 0.0),
        item.get("wing_delta_error") if item.get("wing_delta_error") is not None else math.inf,
        abs(item.get("position_delta") or 0.0),
        -(item.get("credit_pct_of_min_wing") or 0.0),
        item.get("max_leg_bid_ask_pct") if item.get("max_leg_bid_ask_pct") is not None else math.inf,
        -(item.get("open_interest_min") or 0),
    ))
    return candidates[:80]


def _apply_status(
    candidate: dict,
    *,
    max_abs_net_delta: float,
    min_credit_pct_of_wing: float,
    max_wing_skew_pct: float,
    min_open_interest: int,
    max_bid_ask_pct: float,
) -> dict:
    blocking = []
    advisory = []
    position_delta = candidate.get("position_delta")
    if position_delta is None or abs(position_delta) > max_abs_net_delta:
        blocking.append("Complete butterfly exceeds the net-delta limit")
    if (candidate.get("credit_pct_of_min_wing") or 0.0) < min_credit_pct_of_wing:
        blocking.append("Credit is below the minimum percentage of the narrower wing")
    wing_skew = candidate.get("wing_skew_pct")
    if wing_skew is not None and wing_skew > max_wing_skew_pct:
        blocking.append("Put and call wings are too asymmetric")
    if candidate.get("open_interest_min", 0) < min_open_interest:
        blocking.append("One or more legs are below minimum open interest")
    if candidate.get("uses_last_trade_prices"):
        blocking.append("Live bid/ask is unavailable on one or more legs")
    spread = candidate.get("max_leg_bid_ask_pct")
    if spread is None or spread > max_bid_ask_pct:
        blocking.append("One or more legs exceed the bid/ask-width limit")
    natural_credit = candidate.get("natural_credit")
    if natural_credit is not None and natural_credit <= 0:
        blocking.append("Natural market is not a net credit")
    elif natural_credit is not None and natural_credit < candidate.get("entry_credit", 0):
        advisory.append("Natural fill is below the mid-price credit")

    candidate.update({
        "status": "actionable" if not blocking else "near_match",
        "flags": [*blocking, *advisory],
        "blocking_flags": blocking,
        "max_abs_net_delta": max_abs_net_delta,
        "min_credit_pct_of_wing": min_credit_pct_of_wing,
        "max_wing_skew_pct": max_wing_skew_pct,
        "min_open_interest": min_open_interest,
        "max_bid_ask_pct": max_bid_ask_pct,
    })
    candidate["fit_score"] = max(
        0.0,
        min(
            100.0,
            100.0
            - min(35.0, abs(candidate.get("position_delta") or 0.0) * 1.5)
            - min(20.0, abs(candidate.get("body_offset_pct") or 0.0) * 1.5)
            - min(20.0, (candidate.get("wing_delta_error") or 0.0) * 100.0)
            + min(20.0, max(0.0, (candidate.get("credit_pct_of_min_wing") or 0.0) - 10.0) * 0.4)
            - min(15.0, (candidate.get("max_leg_bid_ask_pct") or 0.0) * 0.25),
        ),
    )
    return candidate


def _quality(candidate: dict, target_dte: int, target_body_offset_pct: float) -> tuple:
    return (
        abs(candidate.get("dte", target_dte) - target_dte),
        abs((candidate.get("body_offset_pct") or 0.0) - target_body_offset_pct),
        candidate.get("wing_delta_error") if candidate.get("wing_delta_error") is not None else math.inf,
        candidate.get("status") != "actionable",
        len(candidate.get("blocking_flags", [])),
        abs(candidate.get("position_delta") or 0.0),
        -(candidate.get("fit_score") or 0.0),
        -(candidate.get("open_interest_min") or 0),
    )


def _round_candidate(candidate: dict) -> dict:
    out = dict(candidate)
    for key in (
        "body_strike", "put_long_strike", "call_long_strike", "put_width",
        "call_width", "put_width_pct", "call_width_pct", "max_wing",
        "wing_skew_pct", "body_offset_pct", "put_wing_delta",
        "call_wing_delta", "target_wing_delta", "wing_delta_error",
        "entry_credit", "entry_credit_per_unit", "entry_credit_dollars",
        "entry_price_dollars", "natural_credit", "natural_credit_dollars",
        "execution_cost", "execution_cost_dollars", "max_profit", "max_loss",
        "max_profit_dollars", "max_loss_dollars", "return_on_risk_pct",
        "annualized_return_on_risk_pct", "lower_flat_dollars", "upper_flat_dollars",
        "lower_breakeven", "upper_breakeven", "profit_zone_width_pct",
        "credit_pct_of_min_wing", "position_delta", "position_delta_per_share",
        "theta_dollars_per_day", "delta_theta_ratio_pct", "max_leg_bid_ask_pct",
        "distribution_iv", "prob_profit", "fit_score",
    ):
        out[key] = _round(out.get(key), 4 if key in {"distribution_iv", "position_delta_per_share"} else 2)
    return out


def run_iron_butterfly_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{
        key: value
        for key, value in (payload or {}).items()
        if value is not None
    }}
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    target_dte = int(_clamp(p.get("target_dte"), DEFAULTS["target_dte"], MIN_TARGET_DTE, MAX_TARGET_DTE))
    min_dte = int(_clamp(p.get("min_dte"), MIN_TARGET_DTE, MIN_TARGET_DTE, MAX_TARGET_DTE))
    max_dte = int(_clamp(p.get("max_dte"), MAX_TARGET_DTE, min_dte, MAX_TARGET_DTE))
    expiration_count = int(_clamp(p.get("expiration_count"), 5, 1, 12))
    quantity = int(_clamp(p.get("quantity"), 1, 1, 100))
    min_wing_width_pct = _clamp(p.get("min_wing_width_pct"), 1.0, 0.01, 100.0)
    max_wing_width_pct = _clamp(p.get("max_wing_width_pct"), 50.0, min_wing_width_pct, 100.0)
    target_wing_delta = _clamp(
        p.get("target_wing_delta"), 0.16, 0.01, 0.49,
    )
    min_credit_pct_of_wing = _clamp(p.get("min_credit_pct_of_wing"), 5.0, 0.0, 100.0)
    max_wing_skew_pct = _clamp(p.get("max_wing_skew_pct"), 100.0, 0.0, 1000.0)
    target_body_offset_pct = _clamp(p.get("target_body_offset_pct"), 0.0, -100.0, 100.0)
    max_abs_net_delta = _clamp(p.get("max_abs_net_delta"), 10.0, 0.1, 100.0)
    min_open_interest = int(_clamp(p.get("min_open_interest"), 0, 0, 1000000))
    max_bid_ask_pct = _clamp(p.get("max_bid_ask_pct"), 35.0, 1.0, 500.0)
    exit_dte = int(_clamp(p.get("exit_dte"), 21, 1, max(1, target_dte - 1)))
    max_results = int(_clamp(p.get("max_results"), 20, 1, 100))
    body_strike = _optional_strike(p.get("body_strike"))
    put_wing_strike = _optional_strike(p.get("put_wing_strike"))
    call_wing_strike = _optional_strike(p.get("call_wing_strike"))

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
    for ticker in tickers:
        if spots.get(ticker) is None or spots[ticker] <= 0:
            fallback_spot = _fallback_spot_price(ticker)
            if fallback_spot is not None:
                spots[ticker] = fallback_spot

    def scan_ticker(ticker: str) -> dict:
        spot = spots.get(ticker)
        if spot is None or spot <= 0:
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
        eligible = _expirations_in_window(
            expirations,
            target_dte,
            min_dte,
            max_dte,
            expiration_count,
        )
        if not eligible:
            return {
                "ticker": ticker,
                "price": _round(spot),
                "status": "unavailable",
                "reason": f"No listed expiration is between {min_dte} and {max_dte} DTE.",
                "candidates": [],
            }

        fund = fundamentals.get(ticker, {})
        dividend_yield = dividend_yield_for_pricing(fund, spot)
        candidates = []
        expirations_priced = 0
        for expiration, dte in eligible:
            puts = _prepare_chain(
                _load_put_chain(ticker, expiration, spot, dividend_yield),
                option_type="put",
                spot=spot,
                dte=dte,
                dividend_yield=dividend_yield,
            )
            calls = _prepare_chain(
                _load_call_chain(ticker, expiration, spot, dividend_yield),
                option_type="call",
                spot=spot,
                dte=dte,
                dividend_yield=dividend_yield,
            )
            expirations_priced += 1
            for candidate in _candidate_combinations(
                puts,
                calls,
                spot=spot,
                expiration=expiration,
                dte=dte,
                quantity=quantity,
                dividend_yield=dividend_yield,
                exit_dte=min(exit_dte, max(1, dte - 1)),
                body_strike=body_strike,
                put_wing_strike=put_wing_strike,
                call_wing_strike=call_wing_strike,
                min_wing_width_pct=min_wing_width_pct,
                max_wing_width_pct=max_wing_width_pct,
                target_wing_delta=target_wing_delta,
                include_analysis=False,
            ):
                candidate.update({
                    "ticker": ticker,
                    "name": fund.get("name"),
                    "price": spot,
                    "target_body_offset_pct": target_body_offset_pct,
                    "scanner_variant": "iron-butterfly",
                })
                candidates.append(_apply_status(
                    candidate,
                    max_abs_net_delta=max_abs_net_delta,
                    min_credit_pct_of_wing=min_credit_pct_of_wing,
                    max_wing_skew_pct=max_wing_skew_pct,
                    min_open_interest=min_open_interest,
                    max_bid_ask_pct=max_bid_ask_pct,
                ))

        if not candidates:
            return {
                "ticker": ticker,
                "name": fund.get("name"),
                "price": _round(spot),
                "status": "unavailable",
                "reason": "No complete four-leg iron butterfly matched the listed strikes and widths.",
                "expirations_priced": expirations_priced,
                "candidates": [],
            }
        best = min(
            candidates,
            key=lambda item: _quality(item, target_dte, target_body_offset_pct),
        )
        # The probability grid and theta calculation are intentionally run
        # only for the displayed winner, not for every exploratory combination.
        analyzed = _build_iron_butterfly(
            best["put_long_leg"],
            best["put_short_leg"],
            best["call_short_leg"],
            best["call_long_leg"],
            spot=spot,
            expiration=best["expiration"],
            dte=best["dte"],
            quantity=quantity,
            dividend_yield=dividend_yield,
            exit_dte=min(exit_dte, max(1, best["dte"] - 1)),
            target_wing_delta=target_wing_delta,
        )
        if analyzed is not None:
            for key in (
                "theta_dollars_per_day", "delta_theta_ratio_pct",
                "distribution_iv", "probability_schedule", "prob_profit",
                "management",
            ):
                best[key] = analyzed[key]
        return {
            "ticker": ticker,
            "name": fund.get("name"),
            "price": _round(spot),
            "status": "found",
            "expirations_priced": expirations_priced,
            "candidates": [_round_candidate(best)],
        }

    results = []
    with ThreadPoolExecutor(max_workers=min(8, len(tickers))) as pool:
        results.extend(pool.map(scan_ticker, tickers))

    rows = [
        candidate
        for result in results
        for candidate in result.get("candidates", [])
    ]
    rows.sort(key=lambda item: _quality(item, target_dte, target_body_offset_pct))
    rows = rows[:max_results]
    unavailable = [
        {
            "ticker": result["ticker"],
            "name": result.get("name"),
            "price": result.get("price"),
            "reason": result.get("reason"),
        }
        for result in results
        if not result.get("candidates")
    ]
    return {
        "rows": rows,
        "unavailable": unavailable,
        "stats": {
            "tickers": len(tickers),
            "expirations_priced": sum(result.get("expirations_priced", 0) for result in results),
            "structures_found": len(rows),
            "actionable": sum(1 for row in rows if row["status"] == "actionable"),
            "near_matches": sum(1 for row in rows if row["status"] == "near_match"),
        },
        "params": {
            "tickers": tickers,
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "expiration_count": expiration_count,
            "quantity": quantity,
            "body_strike": body_strike,
            "put_wing_strike": put_wing_strike,
            "call_wing_strike": call_wing_strike,
            "min_wing_width_pct": min_wing_width_pct,
            "max_wing_width_pct": max_wing_width_pct,
            "target_wing_delta": target_wing_delta,
            "min_credit_pct_of_wing": min_credit_pct_of_wing,
            "max_wing_skew_pct": max_wing_skew_pct,
            "target_body_offset_pct": target_body_offset_pct,
            "max_abs_net_delta": max_abs_net_delta,
            "min_open_interest": min_open_interest,
            "max_bid_ask_pct": max_bid_ask_pct,
            "exit_dte": exit_dte,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def register_routes(app):
    @app.route("/api/options/iron-butterfly-scan/defaults", methods=["GET"])
    def iron_butterfly_scan_defaults():
        return jsonify(defaults=DEFAULTS)

    @app.route("/api/options/iron-butterfly-scan", methods=["POST"])
    def iron_butterfly_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            return jsonify(run_iron_butterfly_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
