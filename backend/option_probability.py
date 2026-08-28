"""Shared option-position profit probabilities for scanner exit cards.

The scanners already describe when a trade should be reassessed or closed.
This module prices the complete suggested position at those dates, then
integrates its positive-P/L price ranges under an option-implied lognormal
distribution.  It is deterministic (no Monte Carlo noise) so displayed
probabilities remain stable between renders.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
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


def _capture_scan_spots(spot, distribution_iv, total_years, extra_spots=()):
    """Spot grid the capture maths is measured on.

    Log-spaced around spot, plus the strikes themselves: a butterfly's peak is a
    kink sitting exactly on a strike, and a log grid lands beside it rather than
    on it.
    """
    scan_span = 6.0 * distribution_iv * math.sqrt(total_years)
    spots = [
        spot * math.exp(-scan_span + 2.0 * scan_span * index / (_CAPTURE_SCAN_POINTS - 1))
        for index in range(_CAPTURE_SCAN_POINTS)
    ]
    low, high = spots[0], spots[-1]
    spots.extend(
        value for value in extra_spots
        if value is not None and low < value < high
    )
    return sorted(set(spots))


def _best_profit(profit_at_spot, remaining_years, scan_spots, refine_steps=96):
    """Highest P/L the position can reach on that date, at any price.

    Separates "unlikely" from "arithmetically impossible". A long butterfly only
    converges on its maximum at expiration, so months out the whole tent is worth
    a fraction of it even with price sitting on the peak -- a partial-profit
    target above this ceiling cannot fill, and a 0% next to it is a fact about
    the structure rather than an estimate about the market.
    """
    best = None
    best_index = 0
    for index, spot in enumerate(scan_spots):
        value = profit_at_spot(spot, remaining_years)
        if value is None:
            return None
        if best is None or value > best:
            best, best_index = value, index
    # The scan brackets the peak; walk the bracket so a curved top is not
    # read off its shoulder.
    low = scan_spots[max(0, best_index - 1)]
    high = scan_spots[min(len(scan_spots) - 1, best_index + 1)]
    if refine_steps > 0 and high > low:
        for index in range(refine_steps + 1):
            value = profit_at_spot(low + (high - low) * index / refine_steps, remaining_years)
            if value is None:
                return None
            if value > best:
                best = value
    return best


def _latest_reachable_dte(profit_at_spot, threshold, total_dte, scan_spots, cache):
    """Most DTE that can still leave the target attainable, or None.

    The best attainable P/L only shrinks as time to expiry grows -- a longer
    horizon averages the same payoff over more paths -- so the attainable dates
    are an unbroken run ending at expiration and a bisection finds where it
    starts.
    """
    def attainable(remaining):
        if remaining not in cache:
            cache[remaining] = _best_profit(
                profit_at_spot, remaining / 365.0, scan_spots
            )
        best = cache[remaining]
        return None if best is None else best >= threshold

    if attainable(0) is not True:
        return None
    if attainable(total_dte) is True:
        return total_dte
    low, high = 0, total_dte  # attainable at low, not at high
    while high - low > 1:
        mid = (low + high) // 2
        verdict = attainable(mid)
        if verdict is None:
            return None
        if verdict:
            low = mid
        else:
            high = mid
    return low


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
    extra_spots=(),
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
    scan_spots = _capture_scan_spots(
        spot, distribution_iv, total_years, extra_spots
    )

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


def _derive_max_profit(
    profit_at_spot, spot, distribution_iv, total_years, extra_spots=()
):
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
    # An expiration payoff bends only at strikes, so including them makes the
    # peak exact instead of whatever the log grid happened to step onto -- a
    # butterfly body missed by a few dollars understates max profit, and every
    # capture target is a fraction of it.
    low, high = inner[0], inner[-1]
    inner.extend(
        value for value in extra_spots
        if value is not None and low < value < high
    )
    inner.sort()
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

    strike_spots = sorted({
        strike
        for strike in (_number(leg.get("strike")) for leg in legs)
        if strike is not None and strike > 0
    })

    if peak is None:
        peak = _derive_max_profit(
            profit_at_spot,
            spot_number,
            volatility,
            total_years,
            extra_spots=strike_spots,
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
        extra_spots=strike_spots,
    )

    # How much of the maximum is even on the table at each checkpoint. A target
    # above that ceiling is out of reach rather than long odds, and the panel
    # says so instead of printing a 0% that reads like a market call.
    scan_spots = _capture_scan_spots(
        spot_number, volatility, total_years, strike_spots
    )
    best_profit = {
        remaining: _best_profit(profit_at_spot, remaining / 365.0, scan_spots)
        for remaining in horizons
    }

    targets = []
    for fraction, threshold in zip(fractions, thresholds):
        cells = []
        latest_reachable = _latest_reachable_dte(
            profit_at_spot, threshold, total_dte, scan_spots, best_profit
        )
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
            ceiling = best_profit.get(remaining)
            cells.append({
                "kind": "expiration" if remaining == 0 else "time_fraction",
                "reachable": None if ceiling is None else ceiling >= threshold,
                "best_profit": None if ceiling is None else round(ceiling, 2),
                "best_profit_dollars": (
                    None if ceiling is None else round(ceiling * 100.0, 0)
                ),
                "best_profit_fraction_pct": (
                    None if ceiling is None else round(ceiling / peak * 100.0, 1)
                ),
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
            "reachable_from_dte": latest_reachable,
            "reachable_from_date": (
                None
                if latest_reachable is None
                else (
                    expiration_date - timedelta(days=latest_reachable)
                ).isoformat()
            ),
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


# --- Price scenarios -------------------------------------------------------
#
# The capture panel answers "what are the odds of banking X". This answers the
# question a butterfly actually raises: the structure is worth almost nothing
# until it converges, so *when* does holding it pay, and how much does the
# answer move if price drifts a little either way. Three prices the trade might
# see, priced at every month it is alive.

_SCENARIO_ZONE_POINTS = 240


def _touch_probability(
    spot, barrier, years, volatility, risk_free_rate, dividend_yield
):
    """First-passage odds of price trading at ``barrier`` within ``years``.

    Closed form, unlike the profit-target barrier in the capture panel: a price
    level does not move as the trade ages, so no propagation is needed.
    """
    if spot <= 0 or barrier <= 0 or volatility <= 0:
        return None
    if years <= 0:
        return 1.0 if abs(barrier - spot) < 1e-9 else 0.0
    distance = math.log(barrier / spot)
    if abs(distance) < 1e-12:
        return 1.0
    drift = risk_free_rate - dividend_yield - 0.5 * volatility * volatility
    sigma_root_t = volatility * math.sqrt(years)
    exponent = max(-700.0, min(700.0, 2.0 * drift * distance / (volatility ** 2)))
    reflection = math.exp(exponent)
    if distance < 0:
        probability = (
            _NORM.cdf((distance - drift * years) / sigma_root_t)
            + reflection * _NORM.cdf((distance + drift * years) / sigma_root_t)
        )
    else:
        probability = (
            _NORM.cdf((-distance + drift * years) / sigma_root_t)
            + reflection * _NORM.cdf((-distance - drift * years) / sigma_root_t)
        )
    return min(1.0, max(0.0, probability))


def _beyond_probability(
    spot, barrier, years, volatility, risk_free_rate, dividend_yield, below
):
    """Odds price sits at or past ``barrier`` on that date, not before it."""
    if spot <= 0 or barrier <= 0 or volatility <= 0:
        return None
    if years <= 0:
        return 1.0 if (spot <= barrier if below else spot >= barrier) else 0.0
    drift = risk_free_rate - dividend_yield - 0.5 * volatility * volatility
    z = (math.log(barrier / spot) - drift * years) / (volatility * math.sqrt(years))
    probability = _NORM.cdf(z) if below else 1.0 - _NORM.cdf(z)
    return min(1.0, max(0.0, probability))


def _add_calendar_month(value):
    month = value.month + 1
    year = value.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = value.day
    while day > 1:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1
    return date(year, month, 1)


def _monthly_columns(expiration_date, total_dte, minimum_gap=4):
    """One checkpoint a month from today to expiration, expiration included.

    Calendar months rather than 30-day steps, because the question being asked
    is "which month does this pay best in" and the answer wants a month's name.
    """
    entry_date = expiration_date - timedelta(days=total_dte)
    columns = []
    cursor = _add_calendar_month(entry_date)
    while cursor < expiration_date:
        remaining = (expiration_date - cursor).days
        if remaining >= minimum_gap:
            columns.append(remaining)
        cursor = _add_calendar_month(cursor)
    columns.append(0)
    return sorted(set(columns), reverse=True)


_MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def price_scenario_schedule(
    *,
    spot,
    dte,
    expiration,
    distribution_iv,
    entry_cashflow,
    legs,
    tent_edge=None,
    step_pct=0.05,
    zone_above_pct=0.10,
    zone_inside_pct=0.01,
    risk_free_rate=0.0,
    dividend_yield=0.0,
    underlying_quantity=0.0,
) -> dict | None:
    """Modeled P/L at three prices, every month the trade is alive.

    Rows are today's price and a ``step_pct`` move each way -- toward the tent
    and away from it, direction taken from where ``tent_edge`` sits rather than
    assumed, so a call structure reads the same way a put one does.

    ``best_month`` answers the separate question of when the trade pays best if
    price behaves. It scans only the range a holder would actually sit through:
    up to ``zone_above_pct`` above today, down to ``zone_inside_pct`` inside the
    tent's near edge. Deeper than that and the position is running at its own
    wing, which is a trade most people close rather than hold.
    """
    spot_number = _number(spot)
    volatility = _number(distribution_iv)
    cashflow = _number(entry_cashflow)
    dte_number = _number(dte)
    rate = _number(risk_free_rate)
    yield_number = _number(dividend_yield)
    shares = _number(underlying_quantity)
    step = _number(step_pct)
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
        or step is None
        or not 0 < step < 1
        or not legs
    ):
        return None

    try:
        expiration_date = datetime.strptime(str(expiration), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None

    total_dte = max(2, int(round(dte_number)))

    def profit_at(exit_spot, remaining_dte):
        return _position_profit(
            exit_spot,
            remaining_dte / 365.0,
            entry_spot=spot_number,
            entry_cashflow=cashflow,
            legs=legs,
            risk_free_rate=rate,
            dividend_yield=yield_number,
            underlying_quantity=shares,
        )

    strikes = sorted({
        value
        for value in (_number(leg.get("strike")) for leg in legs)
        if value is not None and value > 0
    })
    if not strikes:
        return None

    # The tent's near edge: the strike price has to reach before the structure
    # starts paying. The caller may name it; otherwise take the strike nearest
    # spot, which is that edge for every tent-shaped position.
    edge = _number(tent_edge)
    if edge is None or edge <= 0:
        edge = min(strikes, key=lambda value: abs(value - spot_number))
    downside = edge <= spot_number

    columns = _monthly_columns(expiration_date, total_dte)
    column_meta = []
    for remaining in columns:
        exit_date = expiration_date - timedelta(days=remaining)
        column_meta.append({
            "remaining_dte": remaining,
            "exit_date": exit_date.isoformat(),
            "month_label": "%s %d" % (_MONTH_NAMES[exit_date.month - 1], exit_date.year),
            "kind": "expiration" if remaining == 0 else "month",
        })

    toward = spot_number * (1.0 - step if downside else 1.0 + step)
    away = spot_number * (1.0 + step if downside else 1.0 - step)
    percent = round(step * 100)
    row_specs = [
        ("current", "Current price", spot_number, 0.0),
        ("toward", "%d%% toward the tent" % percent, toward, -step if downside else step),
        ("away", "%d%% away from the tent" % percent, away, step if downside else -step),
    ]

    rows = []
    for key, label, price, offset in row_specs:
        cells = []
        for meta in column_meta:
            remaining = meta["remaining_dte"]
            elapsed_years = (total_dte - remaining) / 365.0
            profit = profit_at(price, remaining)
            if profit is None:
                return None
            at_spot = abs(price - spot_number) < 1e-9
            touch = (
                1.0
                if at_spot
                else _touch_probability(
                    spot_number, price, elapsed_years, volatility, rate, yield_number
                )
            )
            beyond = _beyond_probability(
                spot_number,
                price,
                elapsed_years,
                volatility,
                rate,
                yield_number,
                below=price <= spot_number,
            )
            cells.append({
                "remaining_dte": remaining,
                "exit_date": meta["exit_date"],
                "profit": round(profit, 2),
                "profit_dollars": round(profit * 100.0, 0),
                "touch_pct": None if touch is None else round(touch * 100.0, 1),
                "beyond_pct": None if beyond is None else round(beyond * 100.0, 1),
            })
        peak = max(cells, key=lambda cell: cell["profit"])
        for cell in cells:
            cell["is_row_best"] = cell["remaining_dte"] == peak["remaining_dte"]
        peak_meta = next(
            meta for meta in column_meta
            if meta["remaining_dte"] == peak["remaining_dte"]
        )
        rows.append({
            "key": key,
            "label": label,
            "price": round(price, 2),
            "offset_pct": round(offset * 100.0, 1),
            "is_spot": key == "current",
            "cells": cells,
            "best_month": {
                "month_label": peak_meta["month_label"],
                "exit_date": peak["exit_date"],
                "remaining_dte": peak["remaining_dte"],
                "profit_dollars": peak["profit_dollars"],
                "positive": peak["profit"] > 0,
            },
        })

    # Where the trade pays best, month by month, inside the range a holder
    # would actually sit through.
    above = spot_number * (1.0 + (_number(zone_above_pct) or 0.0))
    inside_step = _number(zone_inside_pct) or 0.0
    inside = edge * (1.0 - inside_step) if downside else edge * (1.0 + inside_step)
    zone_low, zone_high = min(inside, above), max(inside, above)
    if not zone_high > zone_low > 0:
        return None

    zone_points = [
        zone_low + (zone_high - zone_low) * index / _SCENARIO_ZONE_POINTS
        for index in range(_SCENARIO_ZONE_POINTS + 1)
    ]
    best_overall = None
    for meta in column_meta:
        remaining = meta["remaining_dte"]
        best_profit, best_price = None, None
        for price in zone_points:
            profit = profit_at(price, remaining)
            if profit is None:
                return None
            if best_profit is None or profit > best_profit:
                best_profit, best_price = profit, price
        meta["zone_best_profit"] = round(best_profit, 2)
        meta["zone_best_profit_dollars"] = round(best_profit * 100.0, 0)
        meta["zone_best_price"] = round(best_price, 2)
        meta["zone_best_at_edge"] = (
            abs(best_price - zone_low) < (zone_high - zone_low) / _SCENARIO_ZONE_POINTS
        )
        if best_overall is None or best_profit > best_overall["profit"]:
            best_overall = {
                "profit": best_profit,
                "remaining_dte": remaining,
                "exit_date": meta["exit_date"],
                "month_label": meta["month_label"],
                "price": best_price,
            }

    return {
        "spot": round(spot_number, 2),
        "step_pct": round(step * 100.0, 1),
        "tent_edge": round(edge, 2),
        "downside": downside,
        "columns": column_meta,
        "rows": rows,
        "zone": {
            "low": round(zone_low, 2),
            "high": round(zone_high, 2),
            "above_pct": round((_number(zone_above_pct) or 0.0) * 100.0, 1),
            "inside_pct": round(inside_step * 100.0, 1),
        },
        "zone_best_pinned_to_edge": all(
            meta.get("zone_best_at_edge") for meta in column_meta
        ),
        "best_month": None if best_overall is None else {
            "month_label": best_overall["month_label"],
            "exit_date": best_overall["exit_date"],
            "remaining_dte": best_overall["remaining_dte"],
            "price": round(best_overall["price"], 2),
            "profit": round(best_overall["profit"], 2),
            "profit_dollars": round(best_overall["profit"] * 100.0, 0),
        },
    }


# ---------------------------------------------------------------------------
# Expiration payoff profile
# ---------------------------------------------------------------------------

CONTRACT_MULTIPLIER = 100.0
DEFAULT_RISK_FREE_RATE = 0.0375


def _first_number(*values):
    for value in values:
        number = _number(value)
        if number is not None:
            return number
    return None


def _expiration_payoff(legs: list[dict], terminal_price: float) -> float | None:
    total = 0.0
    for leg in legs:
        quantity = _number(leg.get("quantity"))
        entry = _number(leg.get("entry_price"))
        kind = str(leg.get("option_type") or "").lower()
        if quantity is None or entry is None:
            return None
        if kind == "stock":
            total += quantity * (terminal_price - entry)
            continue
        strike = _number(leg.get("strike"))
        if strike is None:
            return None
        intrinsic = (
            max(terminal_price - strike, 0.0)
            if kind == "call" else max(strike - terminal_price, 0.0)
        )
        total += quantity * (intrinsic - entry) * CONTRACT_MULTIPLIER
    return total


def _terminal_price_cdf(price: float | None, *, spot: float, years: float, volatility: float,
                  risk_free_rate: float, dividend_yield: float) -> float:
    if price is None:
        return 1.0
    if price <= 0:
        return 0.0
    sigma_root_t = volatility * math.sqrt(years)
    z_score = (
        math.log(price / spot)
        - (risk_free_rate - dividend_yield - 0.5 * volatility * volatility) * years
    ) / sigma_root_t
    return _NORM.cdf(z_score)


def expiration_payoff_profile(legs: list[dict], spot, dte, distribution_iv,
                      risk_free_rate=DEFAULT_RISK_FREE_RATE, dividend_yield=0.0) -> dict:
    """Exact expiration risk and probabilities for a same-expiry position.

    An expiration payoff is piecewise linear with kinks only at the strikes,
    so the extrema and the flat stretches that produce them are found exactly
    rather than sampled. That matters: counting a Monte Carlo or a fixed
    quantile grid quantises the answer, and two different strikes on two
    different expirations then report the identical probability of maximum
    loss because they land in the same bucket.

    Legs carry ``quantity`` (contracts, signed), ``entry_price`` per share,
    ``option_type`` and ``strike``; a ``stock`` leg carries shares in
    ``quantity``. Results are in dollars for one unit of the position.
    """
    empty = {
        "max_profit": None, "max_loss": None,
        "max_profit_unbounded": False, "max_loss_unbounded": False,
        "prob_max_profit": None, "prob_max_loss": None,
        "expected_value": None,
    }
    spot = _number(spot)
    dte = _number(dte)
    volatility = _number(distribution_iv)
    rate = _first_number(risk_free_rate, DEFAULT_RISK_FREE_RATE)
    yield_number = _first_number(dividend_yield, 0.0)
    option_legs = [leg for leg in legs if leg.get("option_type") != "stock"]
    expirations = {str(leg.get("expiration") or "") for leg in option_legs}
    if (
        not legs or not option_legs or len(expirations) != 1
        or spot is None or spot <= 0 or dte is None or dte <= 0
        or volatility is None or volatility <= 0
    ):
        return empty
    if volatility > 3:
        volatility /= 100.0
    if yield_number > 1:
        yield_number /= 100.0
    if rate is None or rate < -1 or rate > 1 or yield_number < -1 or yield_number > 1:
        return empty
    if any(_number(leg.get("entry_price")) is None for leg in legs):
        return empty

    strikes = sorted({
        float(leg["strike"]) for leg in option_legs
        if _number(leg.get("strike")) is not None
    })
    if not strikes:
        return empty
    breakpoints = [0.0, *strikes]
    payoffs = [_expiration_payoff(legs, price) for price in breakpoints]
    if any(value is None for value in payoffs):
        return empty
    high_slope = sum(
        (_number(leg.get("quantity")) or 0.0) * CONTRACT_MULTIPLIER
        for leg in option_legs if leg.get("option_type") == "call"
    ) + sum(
        _number(leg.get("quantity")) or 0.0
        for leg in legs if leg.get("option_type") == "stock"
    )
    max_profit_unbounded = high_slope > 1e-9
    max_loss_unbounded = high_slope < -1e-9
    max_profit = None if max_profit_unbounded else max(payoffs)
    max_loss = None if max_loss_unbounded else max(0.0, -min(payoffs))

    years = max(dte, 1.0) / 365.0
    expected_terminal = spot * math.exp((rate - yield_number) * years)
    expected_value = 0.0
    for leg in legs:
        quantity = float(leg["quantity"])
        entry = float(leg["entry_price"])
        kind = leg["option_type"]
        if kind == "stock":
            expected_value += quantity * (expected_terminal - entry)
            continue
        modeled = black_scholes(
            spot, float(leg["strike"]), years, rate, yield_number, volatility, kind
        )
        expected_intrinsic = float(modeled["price"]) * math.exp(rate * years)
        expected_value += quantity * (expected_intrinsic - entry) * CONTRACT_MULTIPLIER

    intervals = []
    for index, low in enumerate(breakpoints):
        high = breakpoints[index + 1] if index + 1 < len(breakpoints) else None
        probe = low + 1.0 if high is None else (low + high) / 2.0
        slope = sum(
            (_number(leg.get("quantity")) or 0.0)
            * (1.0 if leg.get("option_type") == "stock" else CONTRACT_MULTIPLIER)
            for leg in legs
            if leg.get("option_type") == "stock"
            or (leg.get("option_type") == "call" and probe > float(leg["strike"]))
        ) - sum(
            (_number(leg.get("quantity")) or 0.0) * CONTRACT_MULTIPLIER
            for leg in option_legs
            if leg.get("option_type") == "put" and probe < float(leg["strike"])
        )
        payoff = _expiration_payoff(legs, probe)
        probability = _terminal_price_cdf(
            high, spot=spot, years=years, volatility=volatility,
            risk_free_rate=rate, dividend_yield=yield_number,
        ) - _terminal_price_cdf(
            low, spot=spot, years=years, volatility=volatility,
            risk_free_rate=rate, dividend_yield=yield_number,
        )
        intervals.append((slope, payoff, max(0.0, probability)))

    tolerance = 1e-6
    prob_max_profit = None if max_profit is None else 100.0 * sum(
        probability for slope, payoff, probability in intervals
        if abs(slope) <= tolerance and abs((payoff or 0.0) - max_profit) <= tolerance
    )
    prob_max_loss = None if max_loss is None else 100.0 * sum(
        probability for slope, payoff, probability in intervals
        if abs(slope) <= tolerance and abs((payoff or 0.0) + max_loss) <= tolerance
    )
    return {
        "max_profit": round(max_profit, 2) if max_profit is not None else None,
        "max_loss": round(max_loss, 2) if max_loss is not None else None,
        "max_profit_unbounded": max_profit_unbounded,
        "max_loss_unbounded": max_loss_unbounded,
        "prob_max_profit": round(prob_max_profit, 2) if prob_max_profit is not None else None,
        "prob_max_loss": round(prob_max_loss, 2) if prob_max_loss is not None else None,
        "expected_value": round(expected_value, 2),
    }
