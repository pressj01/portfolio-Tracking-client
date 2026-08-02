"""Shared expiration-aware strike-placement helpers.

Option deltas already include volatility and time.  These helpers cover the
places where a scanner must estimate the equivalent strike before a usable
chain delta is available, or scale a reference geometry across expirations.
"""

from __future__ import annotations

import math
from statistics import NormalDist


_NORM = NormalDist()


def _positive_number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def dte_distance_scale(dte, reference_dte) -> float:
    """Scale a reference strike distance while holding its vol z-score fixed."""
    days = _positive_number(dte)
    reference = _positive_number(reference_dte)
    if days is None or reference is None:
        return 1.0
    return math.sqrt(days / reference)


def dte_scaled_pct(base_pct, dte, reference_dte) -> float:
    """Scale percentage strike geometry by square-root time."""
    try:
        base = float(base_pct)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(base):
        return 0.0
    return base * dte_distance_scale(dte, reference_dte)


def strike_for_delta(
    spot,
    target_delta,
    annual_volatility,
    dte,
    option_type,
) -> float | None:
    """Black-Scholes strike estimate for a fixed absolute delta.

    Rates and dividend carry are deliberately omitted because this is a
    no-chain fallback.  The important invariant is retained: at unchanged
    volatility and target delta, a farther expiration produces a strike farther
    from spot.
    """
    underlying = _positive_number(spot)
    volatility = _positive_number(annual_volatility)
    days = _positive_number(dte)
    try:
        delta = float(target_delta)
    except (TypeError, ValueError):
        delta = 0.5
    delta = min(0.95, max(0.01, delta))
    if underlying is None or volatility is None or days is None:
        return underlying

    years = days / 365.0
    sigma_root_t = volatility * math.sqrt(years)
    if option_type == "call":
        d1 = _NORM.inv_cdf(delta)
    elif option_type == "put":
        d1 = _NORM.inv_cdf(1.0 - delta)
    else:
        raise ValueError("option_type must be call or put")
    return underlying * math.exp(
        0.5 * volatility * volatility * years - d1 * sigma_root_t
    )
