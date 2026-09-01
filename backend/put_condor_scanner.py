"""Risk-budgeted put-condor scanner for Mini-SPX and SPY.

The structure uses four puts in one expiration::

    BUY  upper long put
    SELL upper short put       1-point debit spread
    SELL lower short put
    BUY  lower long put        variable-width credit spread

The upper debit spread is placed at or slightly below the market.  The user
targets the lower credit spread's short put from 10 to 20 delta; the protective
long is then selected so the complete package opens for a small credit and the
lower-tail maximum loss is as close as possible to, but never above, the user's
dollar risk ceiling.

Endpoints:
  GET  /api/options/put-condor-scan/defaults
  POST /api/options/put-condor-scan
"""

from __future__ import annotations

from datetime import date, datetime

import yfinance as yf

import yahoo_gateway
from flask import jsonify, request

from put_scanner import (
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    _fetch_fundamentals_bulk,
    _load_history,
    _load_put_chain,
    _num,
    _prepare_put_quote,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)
from unbalanced_put_condor_scanner import (
    CONTRACT_MULTIPLIER,
    EARLY_CLOSE_FRACTIONS,
    MAX_EXPIRATION_ATTEMPTS,
    MIN_QUOTED_LEGS_BELOW_SPOT,
    _build_put_condor,
    _chain_quality,
    _early_close_estimate,
    _quotable,
    _round_candidate,
    _stale_chain_reason,
    _tradable_leg,
)


ALLOWED_UNDERLYINGS = {
    "^XSP": "Mini-SPX",
    "SPY": "SPDR S&P 500 ETF",
}
DEBIT_WIDTH = 1.0
WIDTH_EPSILON = 0.051
PLACEMENT_TOLERANCE_PCT = 1.0
CREDIT_SHORT_DELTA_MIN = 0.10
CREDIT_SHORT_DELTA_MAX = 0.20
CREDIT_SHORT_DELTA_TOLERANCE = 0.02
DEBIT_PAIR_ATTEMPTS = 6
DEFAULTS = {
    "option_side": "put",
    "underlying": "^XSP",
    "placement_mode": "slightly_otm",
    "debit_otm_pct": 0.5,
    "target_dte": 42,
    "min_dte": 30,
    "max_dte": 60,
    "max_risk_dollars": 200.0,
    "credit_short_delta": 0.15,
    "target_upper_credit_dollars": 10.0,
    "max_upper_credit_dollars": 25.0,
    "min_open_interest": 0,
    "max_results": 4,
}


def _ranked_expirations(
    expirations: list[str],
    target_dte: int,
    min_dte: int,
    max_dte: int,
) -> list[tuple[str, int]]:
    """Eligible expirations ordered by proximity to the requested DTE."""
    today = date.today()
    ranked = []
    for expiration in expirations:
        try:
            expiration_date = datetime.strptime(expiration, "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        dte = (expiration_date - today).days
        if min_dte <= dte <= max_dte:
            ranked.append((abs(dte - target_dte), expiration, dte))
    ranked.sort()
    return [(expiration, dte) for _, expiration, dte in ranked]


def _placement_target(spot: float, mode: str, otm_pct: float) -> tuple[float, float]:
    """Return the desired upper-long strike and effective OTM percentage."""
    effective_otm = 0.0 if mode == "atm" else max(0.0, otm_pct)
    return spot * (1.0 - effective_otm / 100.0), effective_otm


def _debit_pairs(
    puts: list[dict],
    spot: float,
    mode: str,
    otm_pct: float,
) -> list[tuple[dict, dict, float]]:
    """Find listed one-point debit spreads nearest the chosen placement."""
    legs = sorted(
        (leg for leg in puts if _tradable_leg(leg, spot)),
        key=lambda leg: leg["strike"],
        reverse=True,
    )
    target, _ = _placement_target(spot, mode, otm_pct)
    by_strike = {round(float(leg["strike"]), 4): leg for leg in legs}
    pairs = []
    for upper_long in legs:
        long_strike = float(upper_long["strike"])
        if long_strike >= spot:
            continue
        upper_short = by_strike.get(round(long_strike - DEBIT_WIDTH, 4))
        if upper_short is None:
            # Be tolerant of floating-point strike representations while still
            # enforcing the user's one-point construction.
            upper_short = next(
                (
                    leg for leg in legs
                    if abs((long_strike - float(leg["strike"])) - DEBIT_WIDTH)
                    <= WIDTH_EPSILON
                ),
                None,
            )
        if upper_short is None:
            continue
        width = long_strike - float(upper_short["strike"])
        if abs(width - DEBIT_WIDTH) > WIDTH_EPSILON:
            continue
        pairs.append((upper_long, upper_short, abs(long_strike - target)))
    pairs.sort(key=lambda item: (item[2], -item[0]["strike"]))
    return pairs[:DEBIT_PAIR_ATTEMPTS]


def _build_risk_candidate(
    upper_long: dict,
    upper_short: dict,
    lower_short: dict,
    lower_long: dict,
    *,
    spot: float,
    expiration: str,
    dte: int,
    placement_mode: str,
    target_otm_pct: float,
    max_risk_dollars: float,
    target_upper_credit_dollars: float,
    max_upper_credit_dollars: float,
    target_credit_short_delta: float = 0.15,
    dividend_yield: float = 0.0,
) -> dict | None:
    """Build a candidate and apply the non-negotiable payoff constraints."""
    actual_upper_delta = abs(_num(upper_short.get("delta"), 0.0) or 0.0)
    actual_lower_delta = abs(_num(lower_short.get("delta"), 0.0) or 0.0)
    candidate = _build_put_condor(
        upper_long,
        upper_short,
        lower_short,
        lower_long,
        spot,
        expiration,
        dte,
        placement_mode,
        actual_upper_delta,
        target_credit_short_delta,
        1,
        1,
        dividend_yield,
    )
    if candidate is None:
        return None

    # The lower vertical must be wider than the fixed debit vertical.  That is
    # what creates the defined lower-tail risk budget the user is choosing.
    if candidate["sold_width"] <= DEBIT_WIDTH + WIDTH_EPSILON:
        return None
    if abs(candidate["bought_width"] - DEBIT_WIDTH) > WIDTH_EPSILON:
        return None

    upper_credit = candidate["entry_credit_dollars"]
    max_loss = candidate["max_loss_dollars"]
    if upper_credit <= 0 or upper_credit > max_upper_credit_dollars:
        return None
    if max_loss <= 0 or max_loss > max_risk_dollars + 0.01:
        return None

    target_strike, effective_otm_pct = _placement_target(
        spot,
        placement_mode,
        target_otm_pct,
    )
    actual_otm_pct = (spot - candidate["upper_long_strike"]) / spot * 100.0
    if abs(actual_otm_pct - effective_otm_pct) > PLACEMENT_TOLERANCE_PCT:
        return None
    candidate.update({
        "option_side": "put",
        "option_type": "put",
        "construction": (
            "At the money" if placement_mode == "atm"
            else f"{effective_otm_pct:g}% OTM"
        ),
        "placement_mode": placement_mode,
        "target_debit_otm_pct": effective_otm_pct,
        "actual_debit_otm_pct": actual_otm_pct,
        "debit_target_strike": target_strike,
        "debit_placement_error_points": abs(candidate["upper_long_strike"] - target_strike),
        "debit_width": candidate["bought_width"],
        "credit_width": candidate["sold_width"],
        "spread_gap": candidate["upper_short_strike"] - candidate["lower_short_strike"],
        "debit_long_strike": candidate["upper_long_strike"],
        "debit_short_strike": candidate["upper_short_strike"],
        "credit_short_strike": candidate["lower_short_strike"],
        "credit_long_strike": candidate["lower_long_strike"],
        "debit_long_leg": candidate["upper_long_leg"],
        "debit_short_leg": candidate["upper_short_leg"],
        "credit_short_leg": candidate["lower_short_leg"],
        "credit_long_leg": candidate["lower_long_leg"],
        "near_flat_outcome": candidate["upper_flat_outcome"],
        "near_flat_dollars": candidate["upper_flat_dollars"],
        "far_flat_outcome": candidate["lower_flat_outcome"],
        "far_flat_dollars": candidate["lower_flat_dollars"],
        "risk_breakeven": candidate["lower_breakeven"],
        "risk_breakeven_cushion_pct": candidate["lower_breakeven_cushion_pct"],
        "risk_direction": "downside",
        "near_flat_label": "Upper flat",
        "far_flat_label": "Lower flat",
        "prob_touch_debit_long_pct": candidate["prob_touch_upper_long_pct"],
        "prob_finish_beyond_debit_long_pct": candidate["prob_finish_below_upper_long_pct"],
        "prob_touch_credit_short_pct": candidate["prob_touch_lower_short_pct"],
        "prob_finish_beyond_credit_short_pct": candidate["prob_finish_below_lower_short_pct"],
        "debit_long_distance_sigma": candidate["upper_long_distance_sigma"],
        "max_risk_limit_dollars": max_risk_dollars,
        "risk_remaining_dollars": max_risk_dollars - max_loss,
        "risk_utilization_pct": max_loss / max_risk_dollars * 100.0,
        "target_upper_credit_dollars": target_upper_credit_dollars,
        "upper_credit_error_dollars": abs(upper_credit - target_upper_credit_dollars),
        "target_credit_short_delta": target_credit_short_delta,
        "actual_credit_short_delta": actual_lower_delta,
        "credit_short_delta_error": abs(actual_lower_delta - target_credit_short_delta),
        "annualized_return_on_risk_pct": (
            candidate["return_on_risk_pct"] * 365.0 / dte if dte > 0 else None
        ),
    })
    return candidate


def _candidate_quality(candidate: dict) -> tuple:
    """Honor short delta first, then risk, credit, and debit placement."""
    natural = _num(candidate.get("natural_credit_dollars"))
    risk_error = abs(
        candidate["max_risk_limit_dollars"] - candidate["max_loss_dollars"]
    )
    credit_error = candidate["upper_credit_error_dollars"]
    combined_target_error = (
        risk_error / max(candidate["max_risk_limit_dollars"], 1.0)
        + credit_error / max(candidate["target_upper_credit_dollars"], 1.0)
    )
    return (
        candidate["credit_short_delta_error"],
        combined_target_error,
        credit_error,
        risk_error,
        candidate["debit_placement_error_points"],
        0 if natural is not None and natural > 0 else 1,
        candidate.get("execution_cost_dollars") or 999999,
        -(candidate.get("open_interest_min") or 0),
        -candidate.get("spread_gap", 0),
    )


def _candidates_for_expiration(
    puts: list[dict],
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
    dividend_yield: float,
) -> list[dict]:
    """Enumerate feasible lower credit wings for nearby 1-point debit pairs."""
    legs = sorted(
        (leg for leg in puts if _tradable_leg(leg, spot)),
        key=lambda leg: leg["strike"],
        reverse=True,
    )
    debit_pairs = _debit_pairs(legs, spot, placement_mode, target_otm_pct)
    if not debit_pairs:
        return []

    # A credit wing much wider than this cannot fit under the risk ceiling even
    # after allowing the full configured upper credit.  The bound keeps the
    # four-leg search fast on dense SPY chains.
    max_credit_width = (
        DEBIT_WIDTH
        + max_risk_dollars / CONTRACT_MULTIPLIER
        + max_upper_credit_dollars / CONTRACT_MULTIPLIER
        + WIDTH_EPSILON
    )
    candidates = []
    for upper_long, upper_short, _ in debit_pairs:
        upper_short_strike = float(upper_short["strike"])
        lower_shorts = [leg for leg in legs if float(leg["strike"]) < upper_short_strike]
        for lower_short in lower_shorts:
            lower_short_strike = float(lower_short["strike"])
            for lower_long in legs:
                lower_long_strike = float(lower_long["strike"])
                credit_width = lower_short_strike - lower_long_strike
                if credit_width <= DEBIT_WIDTH + WIDTH_EPSILON:
                    continue
                if credit_width > max_credit_width:
                    continue
                candidate = _build_risk_candidate(
                    upper_long,
                    upper_short,
                    lower_short,
                    lower_long,
                    spot=spot,
                    expiration=expiration,
                    dte=dte,
                    placement_mode=placement_mode,
                    target_otm_pct=target_otm_pct,
                    max_risk_dollars=max_risk_dollars,
                    target_upper_credit_dollars=target_upper_credit_dollars,
                    max_upper_credit_dollars=max_upper_credit_dollars,
                    target_credit_short_delta=target_credit_short_delta,
                    dividend_yield=dividend_yield,
                )
                if candidate is not None:
                    candidates.append(candidate)
    candidates.sort(key=_candidate_quality)
    return candidates


def _round_result(candidate: dict) -> dict:
    out = _round_candidate(candidate)
    # A deliberately slight upper credit can be below $1.  The shared
    # long-dated scanner rounds dollar outcomes to whole dollars, which would
    # display that valid positive line as "$0" and obscure the governing rule.
    for key in (
        "entry_credit_dollars",
        "natural_credit_dollars",
        "upper_flat_dollars",
        "target_upper_credit_dollars",
        "upper_credit_error_dollars",
    ):
        out[key] = _round(candidate.get(key), 2)
    for key, decimals in (
        ("target_debit_otm_pct", 2),
        ("actual_debit_otm_pct", 2),
        ("debit_target_strike", 2),
        ("debit_placement_error_points", 2),
        ("debit_width", 2),
        ("credit_width", 2),
        ("spread_gap", 2),
        ("max_risk_limit_dollars", 0),
        ("risk_remaining_dollars", 0),
        ("risk_utilization_pct", 1),
        ("annualized_return_on_risk_pct", 1),
        ("target_credit_short_delta", 3),
        ("actual_credit_short_delta", 3),
        ("credit_short_delta_error", 3),
    ):
        out[key] = _round(out.get(key), decimals)
    return out


def run_put_condor_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}
    underlying = str(p.get("underlying") or "").strip().upper()
    if underlying not in ALLOWED_UNDERLYINGS:
        raise ValueError("Underlying must be ^XSP or SPY")

    placement_mode = str(p.get("placement_mode") or "slightly_otm").strip().lower()
    if placement_mode not in {"atm", "slightly_otm"}:
        raise ValueError("Debit-spread placement must be at the money or slightly OTM")
    target_otm_pct = min(5.0, max(0.0, _num(p.get("debit_otm_pct"), 0.5) or 0.0))
    target_dte = max(MIN_TARGET_DTE, min(MAX_TARGET_DTE, int(_num(p.get("target_dte"), 42))))
    min_dte = max(MIN_TARGET_DTE, int(_num(p.get("min_dte"), 30)))
    max_dte = min(MAX_TARGET_DTE, max(min_dte, int(_num(p.get("max_dte"), 60))))
    target_dte = min(max_dte, max(min_dte, target_dte))
    max_risk_dollars = min(100000.0, max(25.0, _num(p.get("max_risk_dollars"), 200.0) or 200.0))
    target_credit_short_delta = min(
        CREDIT_SHORT_DELTA_MAX,
        max(
            CREDIT_SHORT_DELTA_MIN,
            _num(p.get("credit_short_delta"), 0.15) or 0.15,
        ),
    )
    target_upper_credit_dollars = min(
        5000.0,
        max(1.0, _num(p.get("target_upper_credit_dollars"), 10.0) or 10.0),
    )
    max_upper_credit_dollars = min(
        5000.0,
        max(
            target_upper_credit_dollars,
            _num(p.get("max_upper_credit_dollars"), 25.0) or 25.0,
        ),
    )
    min_open_interest = max(0, int(_num(p.get("min_open_interest"), 0) or 0))
    max_results = max(1, min(12, int(_num(p.get("max_results"), 4) or 4)))

    history = _load_history([underlying])
    frame = _ticker_frame(history, underlying)
    close = frame["Close"].dropna() if frame is not None else []
    spot = _num(close.iloc[-1]) if len(close) else None
    if not spot or spot <= 0:
        return {
            "rows": [],
            "unavailable": [{
                "ticker": underlying,
                "reason": "Current underlying price is unavailable.",
            }],
            "stats": {"expirations_checked": 0, "structures_found": 0, "actionable": 0, "near_matches": 0},
            "as_of": datetime.now().isoformat(timespec="seconds"),
        }

    # Through the gateway: a throttled catalog must not read as "this
    # ticker has no options", and a cooldown must not be met with one
    # more request per underlying. Falls back to the last catalog Yahoo
    # did return, which is the same list from one day to the next.
    expirations = yahoo_gateway.fetch(
        "option_expirations", underlying,
        lambda: list(yf.Ticker(underlying).options or []),
    )[0] or []
    ranked = _ranked_expirations(expirations, target_dte, min_dte, max_dte)
    if not ranked:
        return {
            "rows": [],
            "unavailable": [{
                "ticker": underlying,
                "price": _round(spot),
                "reason": f"No listed expiration is between {min_dte} and {max_dte} DTE.",
            }],
            "stats": {"expirations_checked": 0, "structures_found": 0, "actionable": 0, "near_matches": 0},
            "as_of": datetime.now().isoformat(timespec="seconds"),
        }

    fundamentals = _fetch_fundamentals_bulk([underlying])
    dividend_yield = dividend_yield_for_pricing(fundamentals.get(underlying, {}), spot)
    rows = []
    thin_chains = []
    checked = 0
    no_structure = []
    for expiration, dte in ranked[: max(MAX_EXPIRATION_ATTEMPTS, max_results)]:
        raw_puts = _load_put_chain(underlying, expiration, spot, dividend_yield)
        prepared = [
            quote for quote in (
                _prepare_put_quote(
                    leg,
                    spot=spot,
                    dte=dte,
                    dividend_yield=dividend_yield,
                )
                for leg in raw_puts
                if 0 < (_num(leg.get("strike")) or 0) < spot
            )
            if quote is not None
        ]
        prepared_by_strike = {_num(leg.get("strike")): leg for leg in prepared}
        quality_legs = [
            prepared_by_strike.get(_num(leg.get("strike")), leg)
            for leg in raw_puts
        ]
        quality = _chain_quality(quality_legs, spot)
        if quality["usable_below_spot"] < MIN_QUOTED_LEGS_BELOW_SPOT:
            thin_chains.append((expiration, quality))
            continue
        checked += 1
        live = [leg for leg in prepared if _quotable(leg)]
        puts = live if len(live) >= MIN_QUOTED_LEGS_BELOW_SPOT else prepared
        candidates = _candidates_for_expiration(
            puts,
            spot=spot,
            expiration=expiration,
            dte=dte,
            placement_mode=placement_mode,
            target_otm_pct=target_otm_pct,
            max_risk_dollars=max_risk_dollars,
            target_upper_credit_dollars=target_upper_credit_dollars,
            max_upper_credit_dollars=max_upper_credit_dollars,
            target_credit_short_delta=target_credit_short_delta,
            dividend_yield=dividend_yield,
        )
        if not candidates:
            no_structure.append(expiration)
            continue
        best = candidates[0]
        flags = []
        blocking_flags = []
        if best.get("uses_last_trade_prices"):
            blocking_flags.append("Live bid/ask unavailable - analysis only")
        if best.get("open_interest_min", 0) < min_open_interest:
            blocking_flags.append("One or more legs are below minimum open interest")
        if best.get("natural_credit") is None or best.get("natural_credit") <= 0:
            blocking_flags.append("Mid is a credit but the natural market is not")
        if best.get("credit_short_delta_error", 1.0) > CREDIT_SHORT_DELTA_TOLERANCE:
            blocking_flags.append("Credit short put is more than 2 delta points from target")
        if best.get("risk_utilization_pct", 0) < 70:
            flags.append("Listed strikes leave part of the selected risk budget unused")
        flags.extend(blocking_flags)
        best.update({
            "ticker": underlying,
            "name": ALLOWED_UNDERLYINGS[underlying],
            "price": spot,
            "status": "actionable" if not blocking_flags else "near_match",
            "flags": flags,
            "scanner_variant": (
                f"risk-{max_risk_dollars:g}-{placement_mode}"
                f"-d{target_credit_short_delta * 100:g}"
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
                    dividend_yield,
                )
            ) is not None
        ]
        rows.append(_round_result(best))
        if len(rows) >= max_results:
            break

    rows.sort(key=lambda row: (
        row.get("status") != "actionable",
        abs((row.get("max_loss_dollars") or 0) - max_risk_dollars),
        row.get("upper_credit_error_dollars") or 0,
        abs((row.get("dte") or target_dte) - target_dte),
    ))
    unavailable = []
    if not rows:
        if checked and no_structure:
            reason = (
                "No quoted four-put combination simultaneously produced a positive upper-line credit, "
                f"kept that credit at or below ${max_upper_credit_dollars:,.0f}, used an exact 1-point "
                f"debit spread, placed the credit short near {target_credit_short_delta * 100:g} delta, "
                f"and held maximum loss to ${max_risk_dollars:,.0f}."
            )
        elif thin_chains:
            reason = _stale_chain_reason(thin_chains)
        else:
            reason = "No usable put chain was available in the selected expiration window."
        best_thin = (
            max(thin_chains, key=lambda item: item[1]["usable_below_spot"])
            if thin_chains else (None, None)
        )
        unavailable.append({
            "ticker": underlying,
            "price": _round(spot),
            "expiration": best_thin[0],
            "chain_quality": best_thin[1],
            "reason": reason,
        })

    return {
        "rows": rows,
        "unavailable": unavailable,
        "stats": {
            "expirations_checked": checked,
            "structures_found": len(rows),
            "actionable": sum(1 for row in rows if row["status"] == "actionable"),
            "near_matches": sum(1 for row in rows if row["status"] == "near_match"),
        },
        "params": {
            "option_side": "put",
            "underlying": underlying,
            "placement_mode": placement_mode,
            "debit_otm_pct": target_otm_pct,
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "debit_width": DEBIT_WIDTH,
            "max_risk_dollars": max_risk_dollars,
            "credit_short_delta": target_credit_short_delta,
            "target_upper_credit_dollars": target_upper_credit_dollars,
            "max_upper_credit_dollars": max_upper_credit_dollars,
            "min_open_interest": min_open_interest,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def run_condor_scan(payload: dict) -> dict:
    """Run the selected put side, call side, or both in one request."""
    side = str((payload or {}).get("option_side") or "put").strip().lower()
    if side == "put":
        return run_put_condor_scan(payload)
    if side == "call":
        from call_condor_scanner import run_call_condor_scan
        return run_call_condor_scan(payload)
    if side != "both":
        raise ValueError("Condor side must be put, call, or both")

    from call_condor_scanner import run_call_condor_scan

    put_result = run_put_condor_scan({**(payload or {}), "option_side": "put"})
    call_result = run_call_condor_scan({**(payload or {}), "option_side": "call"})
    rows = [*(put_result.get("rows") or []), *(call_result.get("rows") or [])]
    rows.sort(key=lambda row: (
        row.get("status") != "actionable",
        row.get("option_side") != "put",
        abs((row.get("dte") or 0) - int(_num((payload or {}).get("target_dte"), 42) or 42)),
    ))
    put_stats = put_result.get("stats") or {}
    call_stats = call_result.get("stats") or {}
    puts_by_expiration = {
        row.get("expiration"): row for row in put_result.get("rows") or []
        if row.get("expiration")
    }
    calls_by_expiration = {
        row.get("expiration"): row for row in call_result.get("rows") or []
        if row.get("expiration")
    }
    combined_packages = []
    for expiration in sorted(set(puts_by_expiration) & set(calls_by_expiration)):
        put_row = puts_by_expiration[expiration]
        call_row = calls_by_expiration[expiration]
        combined_legs = []
        for row, option_type in ((put_row, "put"), (call_row, "call")):
            for leg_key, strike_key, quantity in (
                ("debit_long_leg", "debit_long_strike", 1),
                ("debit_short_leg", "debit_short_strike", -1),
                ("credit_short_leg", "credit_short_strike", -1),
                ("credit_long_leg", "credit_long_strike", 1),
            ):
                leg = dict(row.get(leg_key) or {})
                leg.update({
                    "option_type": option_type,
                    "expiration": expiration,
                    "strike": row.get(strike_key) or leg.get("strike"),
                    "qty": quantity,
                })
                combined_legs.append(leg)
        middle = (
            (_num(put_row.get("near_flat_dollars"), 0.0) or 0.0)
            + (_num(call_row.get("near_flat_dollars"), 0.0) or 0.0)
        )
        downside = (
            (_num(put_row.get("far_flat_dollars"), 0.0) or 0.0)
            + (_num(call_row.get("near_flat_dollars"), 0.0) or 0.0)
        )
        upside = (
            (_num(call_row.get("far_flat_dollars"), 0.0) or 0.0)
            + (_num(put_row.get("near_flat_dollars"), 0.0) or 0.0)
        )
        put_peak = (
            (_num(put_row.get("max_profit_dollars"), 0.0) or 0.0)
            + (_num(call_row.get("near_flat_dollars"), 0.0) or 0.0)
        )
        call_peak = (
            (_num(call_row.get("max_profit_dollars"), 0.0) or 0.0)
            + (_num(put_row.get("near_flat_dollars"), 0.0) or 0.0)
        )
        outcomes = [middle, downside, upside, put_peak, call_peak]
        maximum_profit = max(outcomes)
        maximum_loss = max(0.0, -min(outcomes))
        combined_packages.append({
            "ticker": put_row.get("ticker"),
            "name": put_row.get("name"),
            "price": put_row.get("price"),
            "expiration": expiration,
            "dte": put_row.get("dte"),
            "status": (
                "actionable"
                if put_row.get("status") == call_row.get("status") == "actionable"
                else "near_match"
            ),
            "scanner_variant": f"put-call-condor-{expiration}",
            "legs": combined_legs,
            "entry_credit_dollars": _round(middle, 2),
            "middle_flat_dollars": _round(middle, 2),
            "downside_tail_dollars": _round(downside, 2),
            "upside_tail_dollars": _round(upside, 2),
            "put_peak_dollars": _round(put_peak, 2),
            "call_peak_dollars": _round(call_peak, 2),
            "max_profit_dollars": _round(maximum_profit, 2),
            "max_loss_dollars": _round(maximum_loss, 2),
            "return_on_risk_pct": _round(
                maximum_profit / maximum_loss * 100.0 if maximum_loss else None,
                1,
            ),
            "gross_individual_max_loss_dollars": _round(
                (_num(put_row.get("max_loss_dollars"), 0.0) or 0.0)
                + (_num(call_row.get("max_loss_dollars"), 0.0) or 0.0),
                2,
            ),
            "selected_risk_budget_dollars": _round(
                (_num(put_row.get("max_risk_limit_dollars"), 0.0) or 0.0)
                + (_num(call_row.get("max_risk_limit_dollars"), 0.0) or 0.0),
                2,
            ),
            "put_status": put_row.get("status"),
            "call_status": call_row.get("status"),
        })
    return {
        "rows": rows,
        "unavailable": [
            *(put_result.get("unavailable") or []),
            *(call_result.get("unavailable") or []),
        ],
        "combined_packages": combined_packages,
        "stats": {
            "expirations_checked": (
                (put_stats.get("expirations_checked") or 0)
                + (call_stats.get("expirations_checked") or 0)
            ),
            "structures_found": len(rows),
            "put_structures": len(put_result.get("rows") or []),
            "call_structures": len(call_result.get("rows") or []),
            "combined_packages": len(combined_packages),
            "actionable": sum(1 for row in rows if row.get("status") == "actionable"),
            "near_matches": sum(1 for row in rows if row.get("status") == "near_match"),
        },
        "params": {**(put_result.get("params") or {}), "option_side": "both"},
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def register_routes(app):
    @app.route("/api/options/condor-scan/defaults", methods=["GET"])
    @app.route("/api/options/put-condor-scan/defaults", methods=["GET"])
    def put_condor_scan_defaults():
        return jsonify(
            defaults=DEFAULTS,
            underlyings=[
                {"symbol": symbol, "label": label}
                for symbol, label in ALLOWED_UNDERLYINGS.items()
            ],
            debit_width=DEBIT_WIDTH,
        )

    @app.route("/api/options/condor-scan", methods=["POST"])
    @app.route("/api/options/put-condor-scan", methods=["POST"])
    def put_condor_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            return jsonify(run_condor_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
