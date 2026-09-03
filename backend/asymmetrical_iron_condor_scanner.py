"""Amy Meissner's asymmetrical iron condor (AIC / Weirdor) scanner.

Source: SMB Capital, "The 14 Day Asymmetrical Iron Condor"
(https://www.youtube.com/watch?v=4DAONEGmoX8, March 2018), plus the
construction details Amy later used for the simplified 14-day entry.

The graph is the same family as a typical iron condor, but the T+0 line is
kept flatter, the call side is smaller so upside adjustments stay cheap, and
a put debit spread is on from the start as the downside hedge. Net delta is
always slightly long.

Two campaigns share that structure:

14-Day AIC (weekly)
    Enter 30-35 DTE, a little closer to the money than the monthly. Be out in
    14 days or less — the name is the hold, not the expiration. Plan capital
    is about $16-18k per unit; profit target 2-4% of that capital; keep
    losses under 5%. Short put ~25 delta, short call ~12 delta, 1 put debit
    per 4 put credits.

Monthly AIC
    Enter 40-50 DTE and plan to be out at 14 DTE remaining (about 30 days in
    the trade). Same plan capital; profit target 7-8%. Short put ~16 delta,
    short call ~12 delta, original 1 put debit per 10 put credits with 2
    call credits.

Preferred underlyings are liquid index ETFs standing in for RUT/SPX
(IWM, SPY, QQQ, VOO).

Endpoints:
  GET  /api/options/asymmetrical-iron-condor-scan/defaults
  POST /api/options/asymmetrical-iron-condor-scan
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
import math

import yfinance as yf

import yahoo_gateway
from flask import jsonify, request

from call_scanner import _load_call_chain
from iron_condor_variants import (
    CONTRACT_MULTIPLIER,
    analyze_structure,
    long_at_width,
    nearest_delta,
    _leg as _make_leg,
)
from option_probability import profit_probability_schedule
from put_scanner import (
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    RISK_FREE,
    _fetch_fundamentals_bulk,
    _index_only_tickers,
    _load_history,
    _load_put_chain,
    _num,
    _prepare_option_quote,
    _prepare_put_quote,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)


DEFAULT_TICKERS = ["IWM", "SPY", "QQQ", "VOO"]
HEDGE_SPOT_HEADROOM = 1.03
MIN_CREDIBLE_IV = 0.02

CAMPAIGNS = {
    "fourteen_day": {
        "key": "fourteen_day",
        "label": "14-Day AIC",
        "structure_kind": "fourteen-day-aic",
        "min_dte": 28,
        "target_dte": 32,
        "max_dte": 38,
        "put_short_delta": 0.25,
        "call_short_delta": 0.12,
        "put_long_delta": 0.10,
        "call_long_delta": 0.05,
        "hedge_long_delta": 0.40,
        "put_credit_qty": 4,
        "call_credit_qty": 1,
        "hedge_qty": 1,
        "profit_target_low_pct": 2.0,
        "profit_target_high_pct": 4.0,
        "max_loss_pct": 5.0,
        "max_hold_days": 14,
        "exit_remaining_dte": None,
        "plan_capital_dollars": 18000.0,
        "max_abs_net_delta": 8.0,
    },
    "monthly": {
        "key": "monthly",
        "label": "Monthly AIC",
        "structure_kind": "monthly-aic",
        "min_dte": 40,
        "target_dte": 45,
        "max_dte": 55,
        "put_short_delta": 0.16,
        "call_short_delta": 0.12,
        "put_long_delta": 0.07,
        "call_long_delta": 0.05,
        "hedge_long_delta": 0.35,
        "put_credit_qty": 10,
        "call_credit_qty": 2,
        "hedge_qty": 1,
        "profit_target_low_pct": 7.0,
        "profit_target_high_pct": 8.0,
        "max_loss_pct": 5.0,
        "max_hold_days": None,
        "exit_remaining_dte": 14,
        "plan_capital_dollars": 18000.0,
        "max_abs_net_delta": 20.0,
    },
}

DEFAULTS = {
    "tickers": ",".join(DEFAULT_TICKERS),
    "campaign": "fourteen_day",
    **{
        key: CAMPAIGNS["fourteen_day"][key]
        for key in (
            "target_dte", "min_dte", "max_dte",
            "put_short_delta", "call_short_delta",
            "put_long_delta", "call_long_delta", "hedge_long_delta",
            "put_credit_qty", "call_credit_qty", "hedge_qty",
            "profit_target_low_pct", "profit_target_high_pct",
            "max_loss_pct", "plan_capital_dollars", "max_abs_net_delta",
        )
    },
    "tranche_quantity": 1,
    "delta_tolerance": 0.04,
    "max_hold_days": 14,
    "exit_remaining_dte": 14,
    "min_open_interest": 0,
    "max_bid_ask_pct": 35.0,
    "max_results": 40,
}


def campaign_spec(campaign: str | None) -> dict:
    key = str(campaign or "fourteen_day").strip().lower().replace("-", "_")
    if key in {"fourteen", "14", "14_day", "a14", "weekly"}:
        key = "fourteen_day"
    if key in {"month", "monthly_aic", "aic", "weirdor"}:
        key = "monthly"
    return dict(CAMPAIGNS.get(key) or CAMPAIGNS["fourteen_day"])


def _ticker_list(raw) -> list[str]:
    return _index_only_tickers(raw, DEFAULT_TICKERS, limit=20)


def _clamp(value, default, low, high):
    parsed = _num(value, default)
    if parsed is None:
        parsed = default
    return min(high, max(low, parsed))


def _quotable(leg: dict) -> bool:
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


def _leg_spread_pct(leg: dict) -> float | None:
    bid = _num(leg.get("bid"))
    ask = _num(leg.get("ask"))
    mid = _num(leg.get("mid"))
    if (
        bid is None
        or ask is None
        or bid <= 0
        or ask <= 0
        or mid is None
        or mid <= 0
        or ask < bid
    ):
        return None
    return (ask - bid) / mid * 100.0


def _abs_delta(leg: dict) -> float:
    return abs(_num(leg.get("delta"), 0.0) or 0.0)


def _expirations_in_window(
    expirations: list[str],
    target_dte: int,
    min_dte: int,
    max_dte: int,
) -> list[tuple[str, int]]:
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
    return choices


def _nearest_pool(
    legs: list[dict],
    target: float,
    *,
    predicate=None,
    count: int = 3,
) -> list[dict]:
    pool = [leg for leg in legs if predicate(leg)] if predicate else list(legs)
    pool = [
        leg for leg in pool
        if _num(leg.get("strike"))
        and _num(leg.get("mid"))
        and _num(leg.get("delta")) is not None
        and (_num(leg.get("iv"), 0.0) or 0.0) >= MIN_CREDIBLE_IV
    ]
    pool.sort(key=lambda leg: (
        abs(_abs_delta(leg) - target),
        -int(_num(leg.get("open_interest"), 0) or 0),
    ))
    return pool[:count]


def _management_points(
    dte: int,
    *,
    max_hold_days: int | None,
    exit_remaining_dte: int | None,
) -> list[dict]:
    """Planned reviews from the video, plus the campaign's mandatory exit."""
    points = []
    seen = set()

    def add(kind, label, remaining):
        remaining = int(remaining)
        if remaining <= 0 or remaining >= dte or remaining in seen:
            return
        seen.add(remaining)
        points.append({
            "kind": kind,
            "label": label,
            "remaining_dte": remaining,
        })

    if max_hold_days:
        hold = int(max_hold_days)
        add("planned_exit", f"{hold}-day hold exit", dte - hold)
        add("review", "Day-6 review", dte - 6)
    if exit_remaining_dte:
        add("planned_exit", f"{int(exit_remaining_dte)}-DTE exit", exit_remaining_dte)
        add("review", "Halfway review", dte // 2)
    points.sort(key=lambda point: dte - point["remaining_dte"])
    return points


def _probability_legs(legs: list[dict]) -> list[dict]:
    return [
        {
            "option_type": leg["option_type"],
            "strike": leg["strike"],
            "iv": leg.get("iv"),
            "quantity": int(leg["qty"]),
        }
        for leg in legs
    ]


def _prepare_side(
    raw_legs: list[dict],
    *,
    option_type: str,
    spot: float,
    dte: int,
    dividend_yield: float,
) -> list[dict]:
    prepared = []
    for leg in raw_legs:
        quote = (
            _prepare_put_quote(leg, spot=spot, dte=dte, dividend_yield=dividend_yield)
            if option_type == "put"
            else _prepare_option_quote(
                leg,
                option_type="call",
                spot=spot,
                dte=dte,
                dividend_yield=dividend_yield,
            )
        )
        if quote is None:
            continue
        if _num(quote.get("strike")) is None or _num(quote.get("delta")) is None:
            continue
        if (_num(quote.get("iv"), 0.0) or 0.0) < MIN_CREDIBLE_IV:
            continue
        prepared.append(quote)
    prepared.sort(key=lambda leg: float(leg["strike"]))
    return prepared


def _build_candidate(
    put_long: dict,
    put_short: dict,
    hedge_short: dict,
    hedge_long: dict,
    call_short: dict,
    call_long: dict,
    *,
    spot: float,
    expiration: str,
    dte: int,
    campaign: dict,
    tranche_quantity: int,
    dividend_yield: float,
    max_hold_days: int | None,
    exit_remaining_dte: int | None,
) -> dict | None:
    strikes = [
        _num(put_long.get("strike")),
        _num(put_short.get("strike")),
        _num(hedge_short.get("strike")),
        _num(hedge_long.get("strike")),
        _num(call_short.get("strike")),
        _num(call_long.get("strike")),
    ]
    if any(value is None or value <= 0 for value in strikes):
        return None
    put_long_k, put_short_k, hedge_short_k, hedge_long_k, call_short_k, call_long_k = strikes
    if not (
        put_long_k < put_short_k < hedge_short_k < hedge_long_k
        and call_short_k < call_long_k
        and hedge_long_k <= spot * HEDGE_SPOT_HEADROOM
    ):
        return None

    scale = max(1, int(tranche_quantity))
    put_qty = max(1, int(campaign["put_credit_qty"])) * scale
    call_qty = max(1, int(campaign["call_credit_qty"])) * scale
    hedge_qty = max(1, int(campaign["hedge_qty"])) * scale
    legs = [
        _make_leg(put_long, "put", +put_qty, "put_long"),
        _make_leg(put_short, "put", -put_qty, "put_short"),
        _make_leg(hedge_short, "put", -hedge_qty, "hedge_short"),
        _make_leg(hedge_long, "put", +hedge_qty, "hedge_long"),
        _make_leg(call_short, "call", -call_qty, "call_short"),
        _make_leg(call_long, "call", +call_qty, "call_long"),
    ]
    analysis = analyze_structure(legs)
    if analysis is None:
        return None

    cashflow = analysis["entry_cashflow"]
    max_profit = analysis["max_profit"]
    max_loss = analysis["max_loss"]
    if max_loss <= 0 or max_profit <= 0:
        return None

    all_live = all(
        leg.get("quote_source", "live_bid_ask") == "live_bid_ask" and _quotable(leg)
        for leg in legs
    )
    spreads = [value for value in (_leg_spread_pct(leg) for leg in legs) if value is not None]
    max_leg_spread_pct = max(spreads) if len(spreads) == 6 else None
    position_delta = None
    if all(_num(leg.get("delta")) is not None for leg in legs):
        position_delta = sum(int(leg["qty"]) * float(leg["delta"]) for leg in legs)

    put_width = put_short_k - put_long_k
    call_width = call_long_k - call_short_k
    hedge_width = hedge_long_k - hedge_short_k
    oi_min = min(int(_num(leg.get("open_interest"), 0) or 0) for leg in legs)
    volume_min = min(int(_num(leg.get("volume"), 0) or 0) for leg in legs)
    atm_ivs = [
        _num(leg.get("iv"))
        for leg in (put_short, call_short)
        if _num(leg.get("iv"))
    ]
    atm_iv = (sum(atm_ivs) / len(atm_ivs)) if atm_ivs else None
    exit_points = _management_points(
        dte,
        max_hold_days=max_hold_days,
        exit_remaining_dte=exit_remaining_dte,
    )
    probability_schedule, profit_capture = profit_probability_schedule(
        spot=spot,
        dte=dte,
        expiration=expiration,
        distribution_iv=atm_iv,
        entry_cashflow=cashflow,
        legs=_probability_legs(legs),
        exit_points=exit_points,
        risk_free_rate=RISK_FREE,
        dividend_yield=dividend_yield,
        return_capture=True,
    )
    plan_capital = float(campaign["plan_capital_dollars"])
    profit_dollars = max_profit * CONTRACT_MULTIPLIER
    loss_dollars = max_loss * CONTRACT_MULTIPLIER
    credit_dollars = cashflow * CONTRACT_MULTIPLIER
    serialized = []
    for leg in legs:
        serialized.append({
            "role": leg["role"],
            "option_type": leg["option_type"],
            "strike": _round(leg["strike"]),
            "qty": int(leg["qty"]),
            "bid": _round(leg.get("bid")),
            "ask": _round(leg.get("ask")),
            "mid": _round(leg.get("mid")),
            "iv": _round(leg.get("iv"), 4),
            "delta": _round(leg.get("delta"), 3),
            "open_interest": int(_num(leg.get("open_interest"), 0) or 0),
            "volume": int(_num(leg.get("volume"), 0) or 0),
            "quote_source": leg.get("quote_source", "live_bid_ask"),
        })
    by_role = {leg["role"]: leg for leg in serialized}
    delta_error = (
        abs(_abs_delta(put_short) - campaign["put_short_delta"])
        + abs(_abs_delta(call_short) - campaign["call_short_delta"])
        + abs(_abs_delta(put_long) - campaign["put_long_delta"])
        + abs(_abs_delta(call_long) - campaign["call_long_delta"])
        + abs(_abs_delta(hedge_long) - campaign["hedge_long_delta"])
    )
    return {
        "structure_kind": campaign["structure_kind"],
        "campaign": campaign["key"],
        "campaign_label": campaign["label"],
        "expiration": expiration,
        "dte": dte,
        "legs": serialized,
        "put_long_leg": by_role.get("put_long"),
        "put_short_leg": by_role.get("put_short"),
        "hedge_short_leg": by_role.get("hedge_short"),
        "hedge_long_leg": by_role.get("hedge_long"),
        "call_short_leg": by_role.get("call_short"),
        "call_long_leg": by_role.get("call_long"),
        "put_long_strike": _round(put_long_k),
        "put_short_strike": _round(put_short_k),
        "hedge_short_strike": _round(hedge_short_k),
        "hedge_long_strike": _round(hedge_long_k),
        "call_short_strike": _round(call_short_k),
        "call_long_strike": _round(call_long_k),
        "put_width": _round(put_width),
        "call_width": _round(call_width),
        "hedge_width": _round(hedge_width),
        "put_quantity": put_qty,
        "call_quantity": call_qty,
        "hedge_quantity": hedge_qty,
        "put_credit_qty": put_qty,
        "call_credit_qty": call_qty,
        "hedge_qty": hedge_qty,
        "put_short_delta": _round(_abs_delta(put_short), 3),
        "call_short_delta": _round(_abs_delta(call_short), 3),
        "put_long_delta": _round(_abs_delta(put_long), 3),
        "call_long_delta": _round(_abs_delta(call_long), 3),
        "hedge_long_delta": _round(_abs_delta(hedge_long), 3),
        "put_short_delta_error": abs(_abs_delta(put_short) - campaign["put_short_delta"]),
        "call_short_delta_error": abs(_abs_delta(call_short) - campaign["call_short_delta"]),
        "hedge_long_delta_error": abs(_abs_delta(hedge_long) - campaign["hedge_long_delta"]),
        "delta_error": delta_error,
        "position_delta": position_delta,
        "entry_cashflow": cashflow,
        "entry_credit": cashflow,
        "entry_credit_dollars": credit_dollars,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "max_profit_dollars": profit_dollars,
        "max_loss_dollars": loss_dollars,
        "lower_breakeven": analysis.get("lower_breakeven"),
        "upper_breakeven": analysis.get("upper_breakeven"),
        "breakevens": analysis.get("breakevens") or [],
        "plan_capital_dollars": plan_capital,
        "profit_target_low_dollars": plan_capital * campaign["profit_target_low_pct"] / 100.0,
        "profit_target_high_dollars": plan_capital * campaign["profit_target_high_pct"] / 100.0,
        "management_max_loss_dollars": plan_capital * campaign["max_loss_pct"] / 100.0,
        "profit_target_low_pct": campaign["profit_target_low_pct"],
        "profit_target_high_pct": campaign["profit_target_high_pct"],
        "max_loss_pct": campaign["max_loss_pct"],
        "max_hold_days": max_hold_days,
        "exit_remaining_dte": exit_remaining_dte,
        "open_interest_min": oi_min,
        "volume_min": volume_min,
        "max_leg_bid_ask_pct": max_leg_spread_pct,
        "uses_last_trade_prices": not all_live,
        "atm_iv": atm_iv,
        "dividend_yield": dividend_yield,
        "risk_free_rate": RISK_FREE,
        "probability_schedule": probability_schedule,
        "profit_capture": profit_capture,
        "notes": [
            (
                f"{put_qty}:{call_qty} put/call credit with a {hedge_qty}-lot "
                "put debit hedge from entry"
            ),
            "Slightly long delta, flatter T+0, and less upside risk than a balanced condor",
        ],
    }


def _candidate_combinations(
    puts: list[dict],
    calls: list[dict],
    *,
    spot: float,
    expiration: str,
    dte: int,
    campaign: dict,
    tranche_quantity: int,
    dividend_yield: float,
    max_hold_days: int | None,
    exit_remaining_dte: int | None,
) -> list[dict]:
    put_shorts = _nearest_pool(
        puts,
        campaign["put_short_delta"],
        predicate=lambda leg: float(leg["strike"]) < spot,
    )
    call_shorts = _nearest_pool(
        calls,
        campaign["call_short_delta"],
        predicate=lambda leg: float(leg["strike"]) > spot,
    )
    if not put_shorts or not call_shorts:
        return []

    seen = set()
    ranked = []
    for put_short in put_shorts:
        put_longs = _nearest_pool(
            puts,
            campaign["put_long_delta"],
            predicate=lambda leg, short=put_short: float(leg["strike"]) < float(short["strike"]),
            count=2,
        )
        if not put_longs:
            fallback = long_at_width(puts, put_short, max(0.5, spot * 0.035), is_put=True)
            put_longs = [fallback] if fallback else []
        hedge_longs = _nearest_pool(
            puts,
            campaign["hedge_long_delta"],
            predicate=lambda leg, short=put_short: (
                float(short["strike"]) < float(leg["strike"]) <= spot * HEDGE_SPOT_HEADROOM
            ),
            count=2,
        )
        for put_long in put_longs:
            for hedge_long in hedge_longs:
                between = [
                    leg for leg in puts
                    if float(put_short["strike"]) < float(leg["strike"]) < float(hedge_long["strike"])
                ]
                if not between:
                    continue
                target_strike = (
                    float(put_short["strike"]) + float(hedge_long["strike"])
                ) / 2.0
                hedge_short = min(
                    between,
                    key=lambda leg: abs(float(leg["strike"]) - target_strike),
                )
                for call_short in call_shorts:
                    call_longs = _nearest_pool(
                        calls,
                        campaign["call_long_delta"],
                        predicate=lambda leg, short=call_short: float(leg["strike"]) > float(short["strike"]),
                        count=2,
                    )
                    if not call_longs:
                        fallback = long_at_width(
                            calls, call_short, max(0.5, spot * 0.035), is_put=False,
                        )
                        call_longs = [fallback] if fallback else []
                    for call_long in call_longs:
                        key = (
                            float(put_long["strike"]),
                            float(put_short["strike"]),
                            float(hedge_short["strike"]),
                            float(hedge_long["strike"]),
                            float(call_short["strike"]),
                            float(call_long["strike"]),
                        )
                        if key in seen:
                            continue
                        seen.add(key)
                        ranked.append((
                            abs(_abs_delta(put_short) - campaign["put_short_delta"])
                            + abs(_abs_delta(call_short) - campaign["call_short_delta"])
                            + abs(_abs_delta(hedge_long) - campaign["hedge_long_delta"]),
                            put_long, put_short, hedge_short, hedge_long, call_short, call_long,
                        ))

    ranked.sort(key=lambda item: item[0])
    candidates = []
    for _, put_long, put_short, hedge_short, hedge_long, call_short, call_long in ranked[:24]:
        candidate = _build_candidate(
            put_long, put_short, hedge_short, hedge_long, call_short, call_long,
            spot=spot,
            expiration=expiration,
            dte=dte,
            campaign=campaign,
            tranche_quantity=tranche_quantity,
            dividend_yield=dividend_yield,
            max_hold_days=max_hold_days,
            exit_remaining_dte=exit_remaining_dte,
        )
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def _apply_status(
    candidate: dict,
    *,
    campaign: dict,
    delta_tolerance: float,
    max_abs_net_delta: float,
    min_open_interest: int,
    max_bid_ask_pct: float,
) -> dict:
    blocking = []
    advisory = []
    for label, key in (
        ("25/16-delta put short", "put_short_delta_error"),
        ("12-delta call short", "call_short_delta_error"),
        ("downside-hedge long", "hedge_long_delta_error"),
    ):
        if (_num(candidate.get(key), math.inf) or 0.0) > delta_tolerance:
            blocking.append(f"{label} is outside the delta tolerance")
    net_delta = _num(candidate.get("position_delta"))
    if net_delta is None:
        blocking.append("Complete AIC net delta is unavailable")
    else:
        if net_delta < 0:
            blocking.append("Net delta is short; the AIC is built slightly long")
        if abs(net_delta) > max_abs_net_delta:
            blocking.append("Complete AIC is outside the net-delta limit")
    if int(_num(candidate.get("open_interest_min"), 0) or 0) < min_open_interest:
        blocking.append("One or more legs are below minimum open interest")
    if candidate.get("uses_last_trade_prices"):
        blocking.append("Live bid/ask is unavailable on one or more legs")
    spread = _num(candidate.get("max_leg_bid_ask_pct"))
    if spread is None or spread > max_bid_ask_pct:
        blocking.append("One or more legs exceed the bid/ask-width limit")
    if (_num(candidate.get("entry_credit"), 0.0) or 0.0) <= 0:
        advisory.append("Structure opens at a debit rather than the usual AIC credit")

    candidate.update({
        "status": "actionable" if not blocking else "near_match",
        "flags": [*blocking, *advisory],
        "blocking_flags": blocking,
        "delta_tolerance": delta_tolerance,
        "max_abs_net_delta": max_abs_net_delta,
        "min_open_interest": min_open_interest,
        "max_bid_ask_pct": max_bid_ask_pct,
        "target_put_short_delta": campaign["put_short_delta"],
        "target_call_short_delta": campaign["call_short_delta"],
        "target_hedge_long_delta": campaign["hedge_long_delta"],
    })
    return candidate


def _quality(candidate: dict, target_dte: int) -> tuple:
    spread = candidate.get("max_leg_bid_ask_pct")
    net_delta = candidate.get("position_delta")
    return (
        candidate.get("status") != "actionable",
        len(candidate.get("blocking_flags", [])),
        candidate.get("delta_error", math.inf),
        0.0 if net_delta is not None and net_delta > 0 else 1.0,
        abs(net_delta) if net_delta is not None else math.inf,
        abs(candidate.get("dte", target_dte) - target_dte),
        spread if spread is not None else math.inf,
        -(candidate.get("entry_credit") or 0.0),
        -(candidate.get("open_interest_min") or 0),
    )


def _round_candidate(candidate: dict) -> dict:
    out = dict(candidate)
    for key, decimals in (
        ("put_short_delta", 3), ("call_short_delta", 3),
        ("put_long_delta", 3), ("call_long_delta", 3),
        ("hedge_long_delta", 3), ("position_delta", 3),
        ("entry_credit", 2), ("entry_credit_dollars", 0),
        ("max_profit", 2), ("max_loss", 2),
        ("max_profit_dollars", 0), ("max_loss_dollars", 0),
        ("lower_breakeven", 2), ("upper_breakeven", 2),
        ("plan_capital_dollars", 0),
        ("profit_target_low_dollars", 0), ("profit_target_high_dollars", 0),
        ("management_max_loss_dollars", 0),
        ("max_leg_bid_ask_pct", 1), ("atm_iv", 4),
        ("delta_error", 3), ("delta_tolerance", 3),
        ("max_abs_net_delta", 2), ("max_bid_ask_pct", 1),
        ("put_width", 2), ("call_width", 2), ("hedge_width", 2),
    ):
        out[key] = _round(out.get(key), decimals)
    if isinstance(out.get("breakevens"), list):
        out["breakevens"] = [_round(value, 2) for value in out["breakevens"]]
    return out


def run_asymmetrical_iron_condor_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{
        key: value
        for key, value in (payload or {}).items()
        if value is not None
    }}
    spec = campaign_spec(p.get("campaign"))
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    min_dte = int(_clamp(p.get("min_dte"), spec["min_dte"], MIN_TARGET_DTE, MAX_TARGET_DTE))
    max_dte = int(_clamp(p.get("max_dte"), spec["max_dte"], min_dte, MAX_TARGET_DTE))
    target_dte = int(_clamp(p.get("target_dte"), spec["target_dte"], min_dte, max_dte))
    tranche_quantity = int(_clamp(p.get("tranche_quantity"), 1, 1, 20))
    delta_tolerance = _clamp(p.get("delta_tolerance"), 0.04, 0.005, 0.20)
    max_abs_net_delta = _clamp(
        p.get("max_abs_net_delta"), spec["max_abs_net_delta"], 0.1, 200.0,
    )
    put_short_delta = _clamp(p.get("put_short_delta"), spec["put_short_delta"], 0.05, 0.45)
    call_short_delta = _clamp(p.get("call_short_delta"), spec["call_short_delta"], 0.04, 0.35)
    put_long_delta = _clamp(p.get("put_long_delta"), spec["put_long_delta"], 0.02, 0.30)
    call_long_delta = _clamp(p.get("call_long_delta"), spec["call_long_delta"], 0.02, 0.25)
    hedge_long_delta = _clamp(p.get("hedge_long_delta"), spec["hedge_long_delta"], 0.15, 0.60)
    put_credit_qty = int(_clamp(p.get("put_credit_qty"), spec["put_credit_qty"], 1, 40))
    call_credit_qty = int(_clamp(p.get("call_credit_qty"), spec["call_credit_qty"], 1, 20))
    hedge_qty = int(_clamp(p.get("hedge_qty"), spec["hedge_qty"], 1, 10))
    if spec["key"] == "fourteen_day":
        max_hold_days = int(_clamp(p.get("max_hold_days"), 14, 1, 21))
        exit_remaining_dte = None
    else:
        max_hold_days = None
        exit_remaining_dte = int(_clamp(
            p.get("exit_remaining_dte"),
            spec["exit_remaining_dte"] or 14,
            1,
            max(1, min_dte - 1),
        ))
    min_open_interest = int(_clamp(p.get("min_open_interest"), 0, 0, 1000000))
    max_bid_ask_pct = _clamp(p.get("max_bid_ask_pct"), 35.0, 1.0, 500.0)
    max_results = int(_clamp(p.get("max_results"), 40, 1, 100))
    spec.update({
        "put_short_delta": put_short_delta,
        "call_short_delta": call_short_delta,
        "put_long_delta": put_long_delta,
        "call_long_delta": call_long_delta,
        "hedge_long_delta": hedge_long_delta,
        "put_credit_qty": put_credit_qty,
        "call_credit_qty": call_credit_qty,
        "hedge_qty": hedge_qty,
        "profit_target_low_pct": _clamp(
            p.get("profit_target_low_pct"), spec["profit_target_low_pct"], 0.25, 50.0,
        ),
        "profit_target_high_pct": _clamp(
            p.get("profit_target_high_pct"), spec["profit_target_high_pct"], 0.25, 50.0,
        ),
        "max_loss_pct": _clamp(p.get("max_loss_pct"), spec["max_loss_pct"], 0.25, 50.0),
        "plan_capital_dollars": _clamp(
            p.get("plan_capital_dollars"), spec["plan_capital_dollars"], 1000.0, 500000.0,
        ),
    })

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
        if spot is None or spot <= 0:
            return {
                "ticker": ticker,
                "status": "unavailable",
                "reason": "Current underlying price is unavailable.",
                "candidates": [],
            }
        expirations = yahoo_gateway.fetch(
            "option_expirations", ticker,
            lambda: list(yf.Ticker(ticker).options or []),
        )[0] or []
        eligible = _expirations_in_window(expirations, target_dte, min_dte, max_dte)
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
        usable_chains = 0
        for expiration, dte in eligible:
            puts = _prepare_side(
                _load_put_chain(ticker, expiration, spot, dividend_yield),
                option_type="put",
                spot=spot,
                dte=dte,
                dividend_yield=dividend_yield,
            )
            calls = _prepare_side(
                _load_call_chain(ticker, expiration, spot, dividend_yield),
                option_type="call",
                spot=spot,
                dte=dte,
                dividend_yield=dividend_yield,
            )
            expirations_priced += 1
            if len(puts) < 4 or len(calls) < 2:
                continue
            usable_chains += 1
            for candidate in _candidate_combinations(
                puts,
                calls,
                spot=spot,
                expiration=expiration,
                dte=dte,
                campaign=spec,
                tranche_quantity=tranche_quantity,
                dividend_yield=dividend_yield,
                max_hold_days=max_hold_days,
                exit_remaining_dte=exit_remaining_dte,
            ):
                candidate.update({
                    "ticker": ticker,
                    "name": fund.get("name"),
                    "price": spot,
                    "scanner_variant": (
                        f"{spec['key']}-p{put_credit_qty}-c{call_credit_qty}"
                        f"-h{hedge_qty}-q{tranche_quantity}"
                    ),
                })
                candidates.append(_apply_status(
                    candidate,
                    campaign=spec,
                    delta_tolerance=delta_tolerance,
                    max_abs_net_delta=max_abs_net_delta,
                    min_open_interest=min_open_interest,
                    max_bid_ask_pct=max_bid_ask_pct,
                ))

        if not candidates:
            reason = (
                "Eligible expirations have no usable put/call chain for an AIC."
                if usable_chains == 0
                else "No six-leg AIC (put credit, put debit hedge, call credit) could be built."
            )
            return {
                "ticker": ticker,
                "name": fund.get("name"),
                "price": _round(spot),
                "status": "unavailable",
                "reason": reason,
                "expirations_priced": expirations_priced,
                "candidates": [],
            }

        best = min(candidates, key=lambda item: _quality(item, target_dte))
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
    rows.sort(key=lambda item: _quality(item, target_dte))
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
            "expirations_priced": sum(
                result.get("expirations_priced", 0) for result in results
            ),
            "structures_found": len(rows),
            "actionable": sum(1 for row in rows if row["status"] == "actionable"),
            "near_matches": sum(1 for row in rows if row["status"] == "near_match"),
        },
        "params": {
            "tickers": tickers,
            "campaign": spec["key"],
            "campaign_label": spec["label"],
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "tranche_quantity": tranche_quantity,
            "put_short_delta": put_short_delta,
            "call_short_delta": call_short_delta,
            "put_long_delta": put_long_delta,
            "call_long_delta": call_long_delta,
            "hedge_long_delta": hedge_long_delta,
            "put_credit_qty": put_credit_qty,
            "call_credit_qty": call_credit_qty,
            "hedge_qty": hedge_qty,
            "delta_tolerance": delta_tolerance,
            "max_abs_net_delta": max_abs_net_delta,
            "max_hold_days": max_hold_days,
            "exit_remaining_dte": exit_remaining_dte,
            "profit_target_low_pct": spec["profit_target_low_pct"],
            "profit_target_high_pct": spec["profit_target_high_pct"],
            "max_loss_pct": spec["max_loss_pct"],
            "plan_capital_dollars": spec["plan_capital_dollars"],
            "min_open_interest": min_open_interest,
            "max_bid_ask_pct": max_bid_ask_pct,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def register_routes(app):
    @app.route("/api/options/asymmetrical-iron-condor-scan/defaults", methods=["GET"])
    def asymmetrical_iron_condor_scan_defaults():
        return jsonify(defaults=DEFAULTS, campaigns=CAMPAIGNS)

    @app.route("/api/options/asymmetrical-iron-condor-scan", methods=["POST"])
    def asymmetrical_iron_condor_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            return jsonify(run_asymmetrical_iron_condor_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
