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
    threshold: float = 0.0,
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
        # Measured against the target, so a threshold of $0 keeps the original
        # break-even definition while a profit target shifts the same roots.
        profit = _position_profit(
            spot_at_z(z_score),
            remaining_years,
            entry_spot=spot,
            entry_cashflow=entry_cashflow,
            legs=legs,
            risk_free_rate=risk_free_rate,
            dividend_yield=dividend_yield,
            underlying_quantity=underlying_quantity,
        )
        return None if profit is None else profit - threshold

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
    return_capture=False,
):
    """Return positive/negative P/L odds at planned exits and expiration.

    ``exit_points`` contains dictionaries with ``remaining_dte`` plus optional
    ``kind`` and ``label`` fields. Expiration is always appended, and duplicate
    DTE points are collapsed. Results are ordered chronologically.

    ``always_success_above`` adds an upper safe region to the modeled P/L tent.
    ``include_breakeven`` counts flat $0 P/L as success. Both are opt-in so the
    other option scanners retain their existing strict positive-P/L definition.

    ``return_capture`` additionally returns the profit-capture panel as
    ``(schedule, capture)``, so a caller gets both readings from one set of
    arguments instead of restating them.
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
        return ([], None) if return_capture else []

    try:
        expiration_date = datetime.strptime(str(expiration), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return ([], None) if return_capture else []

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
    if not return_capture:
        return schedule
    capture = profit_capture_schedule(
        spot=spot,
        dte=dte,
        expiration=expiration,
        distribution_iv=distribution_iv,
        entry_cashflow=entry_cashflow,
        legs=legs,
        risk_free_rate=risk_free_rate,
        dividend_yield=dividend_yield,
        underlying_quantity=underlying_quantity,
    )
    return schedule, capture


# ---------------------------------------------------------------------------
# Profit-target capture
# ---------------------------------------------------------------------------
#
# The management plans do not hold to expiration -- they buy the position back
# once it has given up half to two-thirds of its maximum profit. Two different
# questions follow from that, and they have very different answers:
#
#   * "at" -- on a given date, is the position already at the target? This is
#     the same integration the break-even cards use, with the target in place
#     of $0.
#   * "by" -- does the target ever come within reach on or before that date?
#     A target is a moving barrier in price (theta walks it away from spot as
#     the trade ages), so this is a first-passage probability, and it is always
#     the larger of the two. It is the number a resting closing order fills on.
#
# The barrier moves, so there is no closed form. Rather than a Monte Carlo --
# which would make the displayed number jitter between renders, the one thing
# this module exists to avoid -- the path odds come from propagating the price
# density forward on a log grid and absorbing the mass that reaches the target.

# The barrier is found by root-finding (expensive, but it moves smoothly, so a
# coarse time grid resolves it) and crossings are checked by propagation (cheap
# numpy, and needs a fine grid or it misses crossings between checks). Keeping
# the two resolutions separate buys accuracy without paying for it twice.
_CAPTURE_REGION_STEPS = 24
_CAPTURE_TIME_STEPS = 192
_CAPTURE_SCAN_POINTS = 96


def _target_regions(profit_at_spot, remaining_years, thresholds, scan_spots):
    """Spot intervals where P/L reaches each threshold, keyed by threshold.

    One dense profit scan serves every threshold. The scan is the expensive
    part and the targets differ only in where they cut it.
    """
    profits = [profit_at_spot(spot, remaining_years) for spot in scan_spots]
    if any(value is None for value in profits):
        return None

    regions = {}
    for threshold in thresholds:
        bounds = []
        for index in range(1, len(scan_spots)):
            low_spot, high_spot = scan_spots[index - 1], scan_spots[index]
            low_value = profits[index - 1] - threshold
            high_value = profits[index] - threshold
            if low_value == 0.0:
                bounds.append(low_spot)
                continue
            if low_value * high_value > 0:
                continue
            for _ in range(40):
                mid_spot = 0.5 * (low_spot + high_spot)
                mid_profit = profit_at_spot(mid_spot, remaining_years)
                if mid_profit is None:
                    return None
                mid_value = mid_profit - threshold
                if low_value * mid_value <= 0:
                    high_spot, high_value = mid_spot, mid_value
                else:
                    low_spot, low_value = mid_spot, mid_value
            bound = 0.5 * (low_spot + high_spot)
            if not bounds or abs(bound - bounds[-1]) > 1e-9:
                bounds.append(bound)

        intervals = []
        inside = (profits[0] - threshold) >= 0
        start = 0.0
        for bound in bounds:
            if inside:
                intervals.append((start, bound))
            start = bound
            inside = not inside
        if inside:
            intervals.append((start, math.inf))
        regions[threshold] = intervals
    return regions


def _capture_probabilities(
    *,
    spot,
    total_years,
    distribution_iv,
    thresholds,
    profit_at_spot,
    risk_free_rate,
    dividend_yield,
    horizon_years,
    steps=_CAPTURE_TIME_STEPS,
):
    """First-passage odds of reaching each threshold, by each horizon.

    Returns ``{threshold: {horizon_years: probability}}``. Deterministic: the
    density is propagated on a fixed log-price grid, so the same inputs always
    produce the same number.
    """
    import numpy as np

    if total_years <= 0 or distribution_iv <= 0:
        return None

    step_years = total_years / steps
    step_sigma = distribution_iv * math.sqrt(step_years)
    grid_spacing = step_sigma / 3.0
    if grid_spacing <= 0:
        return None

    span = 7.0 * distribution_iv * math.sqrt(total_years) + 5.0 * step_sigma
    half_width = int(math.ceil(span / grid_spacing))
    offsets = np.arange(-half_width, half_width + 1)
    grid_spots = np.exp(math.log(spot) + offsets * grid_spacing)

    drift = (
        risk_free_rate - dividend_yield - 0.5 * distribution_iv * distribution_iv
    ) * step_years
    kernel_half = int(math.ceil(5.0 * step_sigma / grid_spacing)) + 1
    kernel_offsets = np.arange(-kernel_half, kernel_half + 1)
    kernel = np.exp(
        -0.5 * ((kernel_offsets * grid_spacing - drift) / step_sigma) ** 2
    )
    kernel /= kernel.sum()

    # The scan only has to bracket the region boundaries, not the whole grid.
    scan_span = 6.0 * distribution_iv * math.sqrt(total_years)
    scan_spots = [
        spot * math.exp(-scan_span + 2.0 * scan_span * index / (_CAPTURE_SCAN_POINTS - 1))
        for index in range(_CAPTURE_SCAN_POINTS)
    ]

    # Barriers on a coarse time grid, interpolated onto the fine one below.
    region_times = [
        total_years * (1.0 - index / _CAPTURE_REGION_STEPS)
        for index in range(_CAPTURE_REGION_STEPS + 1)
    ]
    region_bounds = []
    for remaining_years in region_times:
        regions = _target_regions(
            profit_at_spot, max(0.0, remaining_years), thresholds, scan_spots
        )
        if regions is None:
            return None
        region_bounds.append(regions)

    def regions_at(remaining_years):
        position = (1.0 - remaining_years / total_years) * _CAPTURE_REGION_STEPS
        lower = max(0, min(_CAPTURE_REGION_STEPS - 1, int(position)))
        weight = min(1.0, max(0.0, position - lower))
        blended = {}
        for threshold in thresholds:
            low_intervals = region_bounds[lower][threshold]
            high_intervals = region_bounds[lower + 1][threshold]
            if len(low_intervals) != len(high_intervals):
                blended[threshold] = (
                    high_intervals if weight >= 0.5 else low_intervals
                )
                continue
            blended[threshold] = [
                (
                    low[0] + (high[0] - low[0]) * weight
                    if math.isfinite(low[0]) and math.isfinite(high[0])
                    else low[0],
                    low[1] + (high[1] - low[1]) * weight
                    if math.isfinite(low[1]) and math.isfinite(high[1])
                    else low[1],
                )
                for low, high in zip(low_intervals, high_intervals)
            ]
        return blended

    mass = {threshold: np.zeros(grid_spots.size) for threshold in thresholds}
    for threshold in thresholds:
        mass[threshold][half_width] = 1.0
    touched = {threshold: 0.0 for threshold in thresholds}
    results = {threshold: {} for threshold in thresholds}

    pending = sorted({round(value, 10) for value in horizon_years})

    for step in range(1, steps + 1):
        remaining_years = max(0.0, total_years - step * step_years)
        regions = regions_at(remaining_years)
        for threshold in thresholds:
            propagated = np.convolve(mass[threshold], kernel, mode="same")
            hit = np.zeros(grid_spots.size, dtype=bool)
            for low, high in regions[threshold]:
                hit |= (grid_spots >= low) & (grid_spots <= high)
            touched[threshold] += float(propagated[hit].sum())
            propagated[hit] = 0.0
            mass[threshold] = propagated

        while pending and remaining_years <= pending[-1] + 1e-12:
            horizon = pending.pop()
            for threshold in thresholds:
                results[threshold][horizon] = min(1.0, max(0.0, touched[threshold]))

    for horizon in pending:
        for threshold in thresholds:
            results[threshold][horizon] = min(1.0, max(0.0, touched[threshold]))
    return results


def _derive_max_profit(profit_at_spot, spot, distribution_iv, total_years):
    """Best expiration P/L the position can reach, or None if unbounded.

    Read off the position's own payoff instead of asking each scanner for it,
    because "maximum profit" is a different expression for a credit vertical, a
    debit vertical, a condor and a butterfly, and only the payoff knows which
    shape it is. A long option has no maximum, and gets no capture targets.
    """
    span = 6.0 * distribution_iv * math.sqrt(total_years)
    if span <= 0:
        return None
    inner = [
        spot * math.exp(-span + 2.0 * span * index / 240.0)
        for index in range(241)
    ]
    outer = [spot * math.exp(-3.0 * span), spot * math.exp(3.0 * span)]
    inner_profits = [profit_at_spot(value, 0.0) for value in inner]
    outer_profits = [profit_at_spot(value, 0.0) for value in outer]
    if any(value is None for value in inner_profits + outer_profits):
        return None

    peak = max(inner_profits)
    # Still climbing well outside the scan means the payoff has no ceiling.
    if max(outer_profits) > peak + 1e-6 * max(1.0, abs(peak)):
        return None
    return peak if peak > 0 else None


def profit_capture_schedule(
    *,
    spot,
    dte,
    expiration,
    distribution_iv,
    entry_cashflow,
    legs,
    max_profit=None,
    capture_fractions=(0.5, 2.0 / 3.0),
    time_fractions=(0.5, 2.0 / 3.0),
    risk_free_rate=0.0,
    dividend_yield=0.0,
    underlying_quantity=0.0,
) -> dict | None:
    """Odds of banking a fraction of maximum profit, early rather than at expiry.

    ``capture_fractions`` are shares of ``max_profit`` to target -- the halves
    and two-thirds the management plans actually close on. ``time_fractions``
    are the points in the trade's life to measure at, so the default answers
    "if I take half the profit, what are my odds by the time half the trade has
    run?" Expiration is always measured as well.

    Each cell carries both readings: ``probability_at_pct`` is the chance the
    position is at or beyond the target on that date, and ``probability_by_pct``
    is the chance the target has come within reach at any point up to it.
    """
    spot_number = _number(spot)
    volatility = _number(distribution_iv)
    cashflow = _number(entry_cashflow)
    dte_number = _number(dte)
    rate = _number(risk_free_rate)
    yield_number = _number(dividend_yield)
    shares = _number(underlying_quantity)
    peak = _number(max_profit)
    if (
        spot_number is None
        or spot_number <= 0
        or volatility is None
        or volatility <= 0
        or cashflow is None
        or dte_number is None
        or dte_number < 2
        or rate is None
        or yield_number is None
        or shares is None
        or not legs
    ):
        return None

    try:
        expiration_date = datetime.strptime(str(expiration), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None

    total_dte = max(2, int(round(dte_number)))
    total_years = total_dte / 365.0

    def profit_at_spot(exit_spot, remaining_years):
        return _position_profit(
            exit_spot,
            remaining_years,
            entry_spot=spot_number,
            entry_cashflow=cashflow,
            legs=legs,
            risk_free_rate=rate,
            dividend_yield=yield_number,
            underlying_quantity=shares,
        )

    if peak is None:
        peak = _derive_max_profit(
            profit_at_spot, spot_number, volatility, total_years
        )
    if peak is None or peak <= 0:
        return None

    fractions = []
    for fraction in capture_fractions:
        value = _number(fraction)
        if value is not None and 0 < value <= 1 and value not in fractions:
            fractions.append(value)
    if not fractions:
        return None
    thresholds = [round(peak * fraction, 10) for fraction in fractions]

    horizons = []
    for fraction in time_fractions:
        value = _number(fraction)
        if value is None or not 0 < value < 1:
            continue
        remaining = int(round(total_dte * (1.0 - value)))
        remaining = max(1, min(total_dte - 1, remaining))
        if remaining not in horizons:
            horizons.append(remaining)
    horizons.append(0)
    horizons = sorted(set(horizons), reverse=True)

    path = _capture_probabilities(
        spot=spot_number,
        total_years=total_years,
        distribution_iv=volatility,
        thresholds=thresholds,
        profit_at_spot=profit_at_spot,
        risk_free_rate=rate,
        dividend_yield=yield_number,
        horizon_years=[remaining / 365.0 for remaining in horizons],
    )

    targets = []
    for fraction, threshold in zip(fractions, thresholds):
        cells = []
        for remaining in horizons:
            point = _probability_at_exit(
                spot=spot_number,
                dte=total_dte,
                remaining_dte=remaining,
                distribution_iv=volatility,
                entry_cashflow=cashflow,
                legs=legs,
                risk_free_rate=rate,
                dividend_yield=yield_number,
                underlying_quantity=shares,
                always_success_above=None,
                include_breakeven=True,
                threshold=threshold,
            )
            if point is None:
                continue
            by_probability = (
                None
                if path is None
                else path.get(threshold, {}).get(round(remaining / 365.0, 10))
            )
            cells.append({
                "kind": "expiration" if remaining == 0 else "time_fraction",
                "label": (
                    "Expiration"
                    if remaining == 0
                    else f"{round((1 - remaining / total_dte) * 100)}% through the trade"
                ),
                "remaining_dte": remaining,
                "elapsed_days": total_dte - remaining,
                "exit_date": (
                    expiration_date - timedelta(days=remaining)
                ).isoformat(),
                "probability_at_pct": point["probability_success_pct"],
                "probability_by_pct": (
                    None
                    if by_probability is None
                    else round(min(100.0, max(0.0, by_probability * 100.0)), 1)
                ),
            })
        if not cells:
            continue
        targets.append({
            "fraction": round(fraction, 4),
            "label": f"{round(fraction * 100)}% of max profit",
            "target_profit": round(threshold, 2),
            "target_profit_dollars": round(threshold * 100.0, 0),
            "horizons": cells,
        })

    if not targets:
        return None
    return {
        "max_profit": round(peak, 2),
        "max_profit_dollars": round(peak * 100.0, 0),
        "targets": targets,
    }
