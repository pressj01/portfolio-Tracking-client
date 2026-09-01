"""60/40/20 delta-neutral put butterfly scanner.

The strategy is a same-expiration 1/-2/+1 put butterfly selected by absolute
put delta rather than fixed strike widths:

    BUY  1 put nearest 60 delta
    SELL 2 puts nearest 40 delta
    BUY  1 put nearest 20 delta

Entries use listed expirations from 60 through 80 DTE.  The management plan
monitors relative changes in the original 60- and 40-delta legs, closes at
30 DTE regardless of price, and treats a delta/theta ratio above 50% as a
caution and above 60% as an exit signal.

Endpoints:
  GET  /api/options/sixty-forty-twenty-fly-scan/defaults
  POST /api/options/sixty-forty-twenty-fly-scan
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
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
    _is_standard_monthly,
    _prepare_scan_leg,
    _round_candidate,
)


UPPER_LONG_TARGET = 0.60
BODY_SHORT_TARGET = 0.40
LOWER_LONG_TARGET = 0.20
DEFAULT_TICKERS = ["SPY", "QQQ", "IWM", "VOO"]
DEFAULTS = {
    "tickers": ",".join(DEFAULT_TICKERS),
    "target_dte": 70,
    "min_dte": 60,
    "max_dte": 80,
    "quantity": 1,
    "delta_tolerance": 0.03,
    "max_abs_net_delta": 5.0,
    "delta_theta_caution_pct": 50.0,
    "delta_theta_exit_pct": 60.0,
    "exit_dte": 30,
    "min_open_interest": 0,
    "max_bid_ask_pct": 35.0,
    "max_results": 20,
}


def _ticker_list(raw) -> list[str]:
    return _index_only_tickers(raw, DEFAULT_TICKERS, limit=20)


def _clamp(value, default, low, high):
    parsed = _num(value, default)
    if parsed is None:
        parsed = default
    return min(high, max(low, parsed))


def _expirations_in_window(
    expirations: list[str],
    target_dte: int,
    min_dte: int,
    max_dte: int,
) -> list[tuple[str, int, bool]]:
    today = date.today()
    choices = []
    for expiration in expirations:
        try:
            expiration_date = datetime.strptime(expiration, "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        dte = (expiration_date - today).days
        if min_dte <= dte <= max_dte:
            choices.append((expiration, dte, _is_standard_monthly(expiration)))
    choices.sort(key=lambda item: (
        abs(item[1] - target_dte),
        not item[2],
        item[1],
        item[0],
    ))
    return choices


def _management_points(dte: int, exit_dte: int) -> list[dict]:
    """Return the presentation reviews plus the mandatory 30-DTE close."""
    points = []
    seen_remaining = set()
    for label, elapsed_days, kind in (
        ("8-day review", 8, "review"),
        ("14-day review", 14, "review"),
        (f"{exit_dte}-DTE exit", dte - exit_dte, "planned_exit"),
    ):
        remaining_dte = dte - elapsed_days
        if elapsed_days <= 0 or remaining_dte <= 0:
            continue
        if remaining_dte in seen_remaining:
            continue
        seen_remaining.add(remaining_dte)
        points.append({
            "kind": kind,
            "label": label,
            "remaining_dte": remaining_dte,
        })
    points.sort(key=lambda point: dte - point["remaining_dte"])
    return points


def _relative_delta_bands(target: float) -> dict:
    return {
        "target": round(target, 4),
        "caution_low": round(target * 0.80, 4),
        "caution_high": round(target * 1.20, 4),
        "exit_low": round(target * 0.70, 4),
        "exit_high": round(target * 1.30, 4),
    }


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


def _build_candidate(
    upper_long: dict,
    body_short: dict,
    lower_long: dict,
    *,
    spot: float,
    expiration: str,
    dte: int,
    quantity: int,
    dividend_yield: float,
    exit_dte: int,
) -> dict | None:
    candidate = _build_butterfly(
        upper_long,
        body_short,
        lower_long,
        spot=spot,
        expiration=expiration,
        dte=dte,
        upper_long_target=UPPER_LONG_TARGET,
        tranche_quantity=quantity,
        lower_long_target=LOWER_LONG_TARGET,
        body_short_target=BODY_SHORT_TARGET,
        structure_kind="sixty-forty-twenty-fly",
        dividend_yield=dividend_yield,
        always_success_above_upper=False,
        exit_points=_management_points(dte, exit_dte),
        require_lower_wing_wider=False,
    )
    if candidate is None:
        return None

    theta = _num(candidate.get("theta_dollars_per_day"))
    net_delta = _num(candidate.get("position_delta"))
    delta_theta_ratio = None
    if theta is not None and net_delta is not None and abs(theta) >= 0.01:
        delta_theta_ratio = abs(net_delta) / abs(theta) * 100.0

    spreads = [
        spread
        for spread in (
            _leg_spread_pct(upper_long),
            _leg_spread_pct(body_short),
            _leg_spread_pct(lower_long),
        )
        if spread is not None
    ]
    max_leg_spread_pct = max(spreads) if len(spreads) == 3 else None
    entry_credit_dollars = _num(candidate.get("entry_credit_dollars"), 0.0) or 0.0

    candidate.update({
        "is_monthly_expiration": _is_standard_monthly(expiration),
        "delta_theta_ratio_pct": delta_theta_ratio,
        "max_leg_bid_ask_pct": max_leg_spread_pct,
        "entry_side": (
            "credit" if entry_credit_dollars > 0
            else "debit" if entry_credit_dollars < 0
            else "even"
        ),
        "entry_price_dollars": abs(entry_credit_dollars),
        "upper_delta_monitor": _relative_delta_bands(UPPER_LONG_TARGET),
        "body_delta_monitor": _relative_delta_bands(BODY_SHORT_TARGET),
        "mandatory_exit_dte": exit_dte,
        "monitor_note": (
            "Compare absolute put deltas with the original entry legs; "
            "do not substitute newly selected strikes."
        ),
    })
    return candidate


def _candidate_combinations(
    puts: list[dict],
    *,
    spot: float,
    expiration: str,
    dte: int,
    quantity: int,
    dividend_yield: float,
    exit_dte: int,
) -> list[dict]:
    legs = []
    for leg in puts:
        prepared = _prepare_scan_leg(
            leg,
            spot=spot,
            dte=dte,
            dividend_yield=dividend_yield,
        )
        delta = abs(_num(prepared.get("delta"), 0.0) or 0.0) if prepared else 0.0
        if prepared is not None and 0.02 <= delta <= 0.95:
            legs.append(prepared)
    if len(legs) < 3:
        return []

    def nearest(target):
        return sorted(
            legs,
            key=lambda leg: (
                abs(abs(_num(leg.get("delta"), 0.0) or 0.0) - target),
                -int(_num(leg.get("open_interest"), 0) or 0),
            ),
        )[:8]

    upper_legs = nearest(UPPER_LONG_TARGET)
    body_legs = nearest(BODY_SHORT_TARGET)
    lower_legs = nearest(LOWER_LONG_TARGET)
    raw_combinations = []
    seen = set()
    for upper in upper_legs:
        for body in body_legs:
            for lower in lower_legs:
                upper_strike = _num(upper.get("strike"))
                body_strike = _num(body.get("strike"))
                lower_strike = _num(lower.get("strike"))
                if not (
                    upper_strike is not None
                    and body_strike is not None
                    and lower_strike is not None
                    and lower_strike < body_strike < upper_strike
                ):
                    continue
                key = (upper_strike, body_strike, lower_strike)
                if key in seen:
                    continue
                seen.add(key)
                upper_delta = abs(_num(upper.get("delta"), 0.0) or 0.0)
                body_delta = abs(_num(body.get("delta"), 0.0) or 0.0)
                lower_delta = abs(_num(lower.get("delta"), 0.0) or 0.0)
                delta_error = (
                    abs(upper_delta - UPPER_LONG_TARGET)
                    + abs(body_delta - BODY_SHORT_TARGET)
                    + abs(lower_delta - LOWER_LONG_TARGET)
                )
                net_delta_error = abs(
                    -upper_delta + 2.0 * body_delta - lower_delta
                )
                raw_combinations.append((
                    delta_error,
                    net_delta_error,
                    -min(
                        int(_num(upper.get("open_interest"), 0) or 0),
                        int(_num(body.get("open_interest"), 0) or 0),
                        int(_num(lower.get("open_interest"), 0) or 0),
                    ),
                    upper,
                    body,
                    lower,
                ))

    raw_combinations.sort(key=lambda item: item[:3])
    candidates = []
    for _, _, _, upper, body, lower in raw_combinations[:12]:
        candidate = _build_candidate(
            upper,
            body,
            lower,
            spot=spot,
            expiration=expiration,
            dte=dte,
            quantity=quantity,
            dividend_yield=dividend_yield,
            exit_dte=exit_dte,
        )
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def _apply_status(
    candidate: dict,
    *,
    delta_tolerance: float,
    max_abs_net_delta: float,
    delta_theta_caution_pct: float,
    delta_theta_exit_pct: float,
    min_open_interest: int,
    max_bid_ask_pct: float,
) -> dict:
    blocking = []
    advisory = []
    for label, key in (
        ("60-delta upper long", "upper_long_delta_error"),
        ("40-delta short body", "body_short_delta_error"),
        ("20-delta lower long", "lower_long_delta_error"),
    ):
        if (_num(candidate.get(key), math.inf) or 0.0) > delta_tolerance:
            blocking.append(f"{label} is outside the delta tolerance")

    if abs(_num(candidate.get("position_delta"), math.inf) or 0.0) > max_abs_net_delta:
        blocking.append("Complete fly is outside the net-delta limit")
    theta = _num(candidate.get("theta_dollars_per_day"))
    if theta is None or theta <= 0:
        blocking.append("Complete fly does not have positive theta")
    ratio = _num(candidate.get("delta_theta_ratio_pct"))
    if ratio is None or ratio >= delta_theta_caution_pct:
        blocking.append("Entry delta/theta ratio is already in the caution zone")
    if int(_num(candidate.get("open_interest_min"), 0) or 0) < min_open_interest:
        blocking.append("One or more legs are below minimum open interest")
    if candidate.get("uses_last_trade_prices"):
        blocking.append("Live bid/ask is unavailable on one or more legs")
    spread = _num(candidate.get("max_leg_bid_ask_pct"))
    if spread is None or spread > max_bid_ask_pct:
        blocking.append("One or more legs exceed the bid/ask-width limit")
    natural_credit = _num(candidate.get("natural_credit"))
    entry_credit = _num(candidate.get("entry_credit"))
    if natural_credit is not None and entry_credit is not None:
        if natural_credit < 0 <= entry_credit:
            advisory.append("Mid is a credit but the natural market is a debit")

    candidate.update({
        "status": "actionable" if not blocking else "near_match",
        "flags": [*blocking, *advisory],
        "blocking_flags": blocking,
        "delta_tolerance": delta_tolerance,
        "max_abs_net_delta": max_abs_net_delta,
        "delta_theta_caution_pct": delta_theta_caution_pct,
        "delta_theta_exit_pct": delta_theta_exit_pct,
        "min_open_interest": min_open_interest,
        "max_bid_ask_pct": max_bid_ask_pct,
    })
    return candidate


def _quality(candidate: dict, target_dte: int) -> tuple:
    ratio = candidate.get("delta_theta_ratio_pct")
    spread = candidate.get("max_leg_bid_ask_pct")
    return (
        candidate.get("status") != "actionable",
        len(candidate.get("blocking_flags", [])),
        (
            candidate.get("upper_long_delta_error", math.inf)
            + candidate.get("body_short_delta_error", math.inf)
            + candidate.get("lower_long_delta_error", math.inf)
        ),
        abs(candidate.get("position_delta") or 0.0),
        ratio if ratio is not None else math.inf,
        abs(candidate.get("dte", target_dte) - target_dte),
        spread if spread is not None else math.inf,
        -(candidate.get("open_interest_min") or 0),
    )


def _round_fly(candidate: dict) -> dict:
    out = _round_candidate(candidate)
    for key, decimals in (
        ("delta_theta_ratio_pct", 1),
        ("max_leg_bid_ask_pct", 1),
        ("entry_price_dollars", 0),
        ("delta_tolerance", 3),
        ("max_abs_net_delta", 1),
        ("delta_theta_caution_pct", 0),
        ("delta_theta_exit_pct", 0),
        ("max_bid_ask_pct", 1),
    ):
        out[key] = _round(out.get(key), decimals)
    for key in ("upper_delta_monitor", "body_delta_monitor"):
        out[key] = {
            name: _round(value, 2)
            for name, value in out.get(key, {}).items()
        }
    return out


def run_sixty_forty_twenty_fly_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{
        key: value
        for key, value in (payload or {}).items()
        if value is not None
    }}
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    min_dte = int(_clamp(p.get("min_dte"), 60, MIN_TARGET_DTE, MAX_TARGET_DTE))
    max_dte = int(_clamp(p.get("max_dte"), 80, min_dte, MAX_TARGET_DTE))
    target_dte = int(_clamp(p.get("target_dte"), 70, min_dte, max_dte))
    quantity = int(_clamp(p.get("quantity"), 1, 1, 100))
    delta_tolerance = _clamp(p.get("delta_tolerance"), 0.03, 0.005, 0.20)
    max_abs_net_delta = _clamp(p.get("max_abs_net_delta"), 5.0, 0.1, 100.0)
    caution = _clamp(p.get("delta_theta_caution_pct"), 50.0, 1.0, 500.0)
    exit_ratio = _clamp(p.get("delta_theta_exit_pct"), 60.0, caution, 500.0)
    exit_dte = int(_clamp(
        p.get("exit_dte"),
        30,
        1,
        max(1, min_dte - 1),
    ))
    min_open_interest = int(_clamp(p.get("min_open_interest"), 0, 0, 1000000))
    max_bid_ask_pct = _clamp(p.get("max_bid_ask_pct"), 35.0, 1.0, 500.0)
    max_results = int(_clamp(p.get("max_results"), 20, 1, 100))

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
        # Through the gateway: a throttled catalog must not read as "this
        # ticker has no options", and a cooldown must not be met with one
        # more request per underlying. Falls back to the last catalog Yahoo
        # did return, which is the same list from one day to the next.
        expirations = yahoo_gateway.fetch(
            "option_expirations", ticker,
            lambda: list(yf.Ticker(ticker).options or []),
        )[0] or []
        eligible = _expirations_in_window(
            expirations,
            target_dte,
            min_dte,
            max_dte,
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
        usable_chains = 0
        for expiration, dte, _ in eligible:
            puts = _load_put_chain(ticker, expiration, spot, dividend_yield)
            expirations_priced += 1
            if not puts:
                continue
            usable_chains += 1
            for candidate in _candidate_combinations(
                puts,
                spot=spot,
                expiration=expiration,
                dte=dte,
                quantity=quantity,
                dividend_yield=dividend_yield,
                exit_dte=exit_dte,
            ):
                candidate.update({
                    "ticker": ticker,
                    "name": fund.get("name"),
                    "price": spot,
                    "scanner_variant": f"60-40-20-fly-q{quantity}",
                })
                candidates.append(_apply_status(
                    candidate,
                    delta_tolerance=delta_tolerance,
                    max_abs_net_delta=max_abs_net_delta,
                    delta_theta_caution_pct=caution,
                    delta_theta_exit_pct=exit_ratio,
                    min_open_interest=min_open_interest,
                    max_bid_ask_pct=max_bid_ask_pct,
                ))

        if not candidates:
            reason = (
                "Eligible expirations have no usable three-leg put chain."
                if usable_chains == 0
                else "No ordered 60/40/20 put-fly combination could be built."
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
            "candidates": [_round_fly(best)],
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
                result.get("expirations_priced", 0)
                for result in results
            ),
            "structures_found": len(rows),
            "actionable": sum(1 for row in rows if row["status"] == "actionable"),
            "near_matches": sum(1 for row in rows if row["status"] == "near_match"),
        },
        "params": {
            "tickers": tickers,
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "quantity": quantity,
            "delta_tolerance": delta_tolerance,
            "max_abs_net_delta": max_abs_net_delta,
            "delta_theta_caution_pct": caution,
            "delta_theta_exit_pct": exit_ratio,
            "exit_dte": exit_dte,
            "min_open_interest": min_open_interest,
            "max_bid_ask_pct": max_bid_ask_pct,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def register_routes(app):
    @app.route(
        "/api/options/sixty-forty-twenty-fly-scan/defaults",
        methods=["GET"],
    )
    def sixty_forty_twenty_fly_scan_defaults():
        return jsonify(
            defaults=DEFAULTS,
            delta_targets={
                "upper_long": UPPER_LONG_TARGET,
                "body_short": BODY_SHORT_TARGET,
                "lower_long": LOWER_LONG_TARGET,
            },
            monitors={
                "upper_long": _relative_delta_bands(UPPER_LONG_TARGET),
                "body_short": _relative_delta_bands(BODY_SHORT_TARGET),
            },
        )

    @app.route(
        "/api/options/sixty-forty-twenty-fly-scan",
        methods=["POST"],
    )
    def sixty_forty_twenty_fly_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            return jsonify(run_sixty_forty_twenty_fly_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
