"""Shared option-position profit probabilities for scanner exit cards.

The scanners already describe when a trade should be reassessed or closed.
This module prices the complete suggested position at those dates, then
integrates its positive-P/L price ranges under an option-implied lognormal
distribution.  It is deterministic (no Monte Carlo noise) so displayed
probabilities remain stable between renders.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from statistics import NormalDist

from options_pricing import black_scholes


_NORM = NormalDist()


def _number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _position_profit(
    exit_spot: float,
    remaining_years: float,
    *,
    entry_spot: float,
    entry_cashflow: float,
    legs: list[dict],
    risk_free_rate: float,
    dividend_yield: float,
    underlying_quantity: float,
) -> float | None:
    profit = entry_cashflow + underlying_quantity * (exit_spot - entry_spot)
    for leg in legs:
        strike = _number(leg.get("strike"))
        volatility = _number(leg.get("iv"))
        quantity = _number(leg.get("quantity"))
        option_type = str(leg.get("option_type") or "").lower()
        if (
            strike is None
            or strike <= 0
            or volatility is None
            or volatility <= 0
            or quantity is None
            or option_type not in {"call", "put"}
        ):
            return None
        option_value = black_scholes(
            exit_spot,
            strike,
            remaining_years,
            risk_free_rate,
            dividend_yield,
            volatility,
            option_type,
        )["price"]
        profit += quantity * option_value
    return profit


def _probability_at_exit(
    *,
    spot: float,
    dte: int,
    remaining_dte: int,
    distribution_iv: float,
    entry_cashflow: float,
    legs: list[dict],
    risk_free_rate: float,
    dividend_yield: float,
    underlying_quantity: float,
    always_success_above: float | None,
    include_breakeven: bool,
) -> dict | None:
    elapsed_days = dte - remaining_dte
    if elapsed_days <= 0:
        return None

    elapsed_years = elapsed_days / 365.0
    remaining_years = remaining_dte / 365.0
    sigma_root_t = distribution_iv * math.sqrt(elapsed_years)
    if sigma_root_t <= 0:
        return None
    log_drift = (
        risk_free_rate
        - dividend_yield
        - 0.5 * distribution_iv * distribution_iv
    ) * elapsed_years

    def spot_at_z(z_score: float) -> float:
        return spot * math.exp(log_drift + sigma_root_t * z_score)

    def profit_at_z(z_score: float) -> float | None:
        return _position_profit(
            spot_at_z(z_score),
            remaining_years,
            entry_spot=spot,
            entry_cashflow=entry_cashflow,
            legs=legs,
            risk_free_rate=risk_free_rate,
            dividend_yield=dividend_yield,
            underlying_quantity=underlying_quantity,
        )

    # Option positions have only a handful of sign changes. A dense z-grid
    # finds their brackets; bisection makes the displayed probability stable.
    z_grid = [-8.0 + index * 0.10 for index in range(161)]
    profit_grid = [profit_at_z(z_score) for z_score in z_grid]
    if any(value is None for value in profit_grid):
        return None

    roots = []
    for index in range(1, len(z_grid)):
        low_z, high_z = z_grid[index - 1], z_grid[index]
        low_profit, high_profit = profit_grid[index - 1], profit_grid[index]
        if low_profit == 0:
            root = low_z
        elif high_profit == 0:
            root = high_z
        elif low_profit * high_profit > 0:
            continue
        else:
            for _ in range(45):
                mid_z = 0.5 * (low_z + high_z)
                mid_profit = profit_at_z(mid_z)
                if mid_profit is None:
                    return None
                if low_profit * mid_profit <= 0:
                    high_z, high_profit = mid_z, mid_profit
                else:
                    low_z, low_profit = mid_z, mid_profit
            root = 0.5 * (low_z + high_z)
        if not roots or abs(root - roots[-1]) > 1e-7:
            roots.append(root)

    # Some structures, such as the STT broken-wing butterfly, explicitly
    # consider the untested region above the front long a successful outcome.
    # Add that price as a distribution boundary so the upper region can be
    # integrated even when its expiration P/L is exactly flat at $0.
    if always_success_above is not None:
        safe_above_z = (
            math.log(always_success_above / spot) - log_drift
        ) / sigma_root_t
        roots.append(safe_above_z)
        roots.sort()
        deduplicated_roots = []
        for root in roots:
            if (
                not deduplicated_roots
                or abs(root - deduplicated_roots[-1]) > 1e-7
            ):
                deduplicated_roots.append(root)
        roots = deduplicated_roots

    boundaries = [-math.inf, *roots, math.inf]
    profitable_ranges = []
    success_probability = 0.0
    unadjusted_success_probability = 0.0
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
        probe_spot = spot_at_z(probe_z)
        profit_is_success = (
            probe_profit >= -1e-9
            if include_breakeven
            else probe_profit > 0
        )
        upper_region_is_success = (
            always_success_above is not None
            and probe_spot >= always_success_above
        )
        low_probability = 0.0 if math.isinf(low_z) else _NORM.cdf(low_z)
        high_probability = 1.0 if math.isinf(high_z) else _NORM.cdf(high_z)
        interval_probability = high_probability - low_probability
        if profit_is_success:
            unadjusted_success_probability += interval_probability
        if not profit_is_success and not upper_region_is_success:
            continue

        success_probability += interval_probability
        successful_range = {
            "lower": None if math.isinf(low_z) else round(spot_at_z(low_z), 2),
            "upper": None if math.isinf(high_z) else round(spot_at_z(high_z), 2),
        }
        # A safe-above boundary or a zero-P/L root can split one continuous
        # successful region into adjacent integration intervals. Present that
        # union as one price range instead of several artificial fragments.
        previous_range = profitable_ranges[-1] if profitable_ranges else None
        ranges_touch = (
            previous_range is not None
            and previous_range["upper"] is not None
            and successful_range["lower"] is not None
            and abs(
                previous_range["upper"] - successful_range["lower"]
            ) <= 0.02
        )
        if ranges_touch:
            previous_range["upper"] = successful_range["upper"]
        else:
            profitable_ranges.append(successful_range)

    success_pct = min(100.0, max(0.0, success_probability * 100.0))
    unadjusted_success_pct = min(
        100.0,
        max(0.0, unadjusted_success_probability * 100.0),
    )
    rounded_success = round(success_pct, 1)
    rounded_unadjusted_success = round(unadjusted_success_pct, 1)
    return {
        "elapsed_days": elapsed_days,
        "remaining_dte": remaining_dte,
        "probability_success_pct": rounded_success,
        "probability_failure_pct": round(100.0 - rounded_success, 1),
        # A managed strategy may designate an otherwise losing region as a
        # successful outcome (for example, the Road Trip trade uses a reverse
        # Harvey above its upper long). Keep the raw, unattended P/L odds next
        # to the managed odds so callers can explain that distinction instead
        # of silently presenting the adjustment as intrinsic profitability.
        "probability_unadjusted_success_pct": rounded_unadjusted_success,
        "probability_unadjusted_failure_pct": round(
            100.0 - rounded_unadjusted_success,
            1,
        ),
        "probability_managed_upside_pct": round(
            max(0.0, success_pct - unadjusted_success_pct),
            1,
        ),
        "profitable_ranges": profitable_ranges,
    }


def profit_probability_schedule(
    *,
    spot,
    dte,
    expiration,
    distribution_iv,
    entry_cashflow,
    legs,
    exit_points=None,
    risk_free_rate=0.0,
    dividend_yield=0.0,
    underlying_quantity=0.0,
    always_success_above=None,
    include_breakeven=False,
) -> list[dict]:
    """Return positive/negative P/L odds at planned exits and expiration.

    ``exit_points`` contains dictionaries with ``remaining_dte`` plus optional
    ``kind`` and ``label`` fields. Expiration is always appended, and duplicate
    DTE points are collapsed. Results are ordered chronologically.

    ``always_success_above`` adds an upper safe region to the modeled P/L tent.
    ``include_breakeven`` counts flat $0 P/L as success. Both are opt-in so the
    other option scanners retain their existing strict positive-P/L definition.
    """
    spot_number = _number(spot)
    volatility = _number(distribution_iv)
    cashflow = _number(entry_cashflow)
    dte_number = _number(dte)
    rate = _number(risk_free_rate)
    yield_number = _number(dividend_yield)
    shares = _number(underlying_quantity)
    safe_above = (
        None
        if always_success_above is None
        else _number(always_success_above)
    )
    if (
        spot_number is None
        or spot_number <= 0
        or volatility is None
        or volatility <= 0
        or cashflow is None
        or dte_number is None
        or dte_number < 1
        or rate is None
        or yield_number is None
        or shares is None
        or (
            always_success_above is not None
            and (safe_above is None or safe_above <= 0)
        )
        or not legs
    ):
        return []

    try:
        expiration_date = datetime.strptime(str(expiration), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return []

    total_dte = max(1, int(round(dte_number)))
    requested_points = list(exit_points or [])
    requested_points.append({
        "kind": "expiration",
        "label": "Expiration",
        "remaining_dte": 0,
    })

    points_by_dte = {}
    for point in requested_points:
        remaining_number = _number(point.get("remaining_dte"))
        if remaining_number is None and point.get("exit_date"):
            try:
                requested_date = datetime.strptime(
                    str(point.get("exit_date")),
                    "%Y-%m-%d",
                ).date()
                remaining_number = (expiration_date - requested_date).days
            except (TypeError, ValueError):
                remaining_number = None
        if remaining_number is None:
            continue
        remaining = max(0, min(total_dte - 1, int(round(remaining_number))))
        points_by_dte.setdefault(remaining, {
            "kind": point.get("kind") or "planned_exit",
            "label": point.get("label") or "Planned exit",
            "remaining_dte": remaining,
        })

    schedule = []
    for remaining_dte in sorted(points_by_dte, reverse=True):
        point = points_by_dte[remaining_dte]
        estimate = _probability_at_exit(
            spot=spot_number,
            dte=total_dte,
            remaining_dte=remaining_dte,
            distribution_iv=volatility,
            entry_cashflow=cashflow,
            legs=legs,
            risk_free_rate=rate,
            dividend_yield=yield_number,
            underlying_quantity=shares,
            always_success_above=safe_above,
            include_breakeven=bool(include_breakeven),
        )
        if estimate is None:
            continue
        schedule.append({
            **point,
            **estimate,
            "exit_date": (
                expiration_date - timedelta(days=remaining_dte)
            ).isoformat(),
        })
    return schedule
