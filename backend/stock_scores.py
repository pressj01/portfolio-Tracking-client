"""Transparent 1-10 stock-selection scores for option scanners.

These are intentionally not presented as Option Samurai's proprietary scores.
They are small, auditable composites built from Yahoo fundamentals plus the
scanner's existing price technicals.  ETFs receive a Technical score, while
company-only Fundamental and Growth scores remain ``None``.
"""

from __future__ import annotations

import math


def _num(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _clamp(value: float, low: float = 1.0, high: float = 10.0) -> float:
    return max(low, min(high, value))


def _ramp(value, low: float, high: float, start: float = 1.0, end: float = 10.0):
    number = _num(value)
    if number is None:
        return None
    if high == low:
        return end if number >= high else start
    fraction = max(0.0, min(1.0, (number - low) / (high - low)))
    return start + fraction * (end - start)


def _average(values):
    clean = [float(value) for value in values if value is not None]
    return round(_clamp(sum(clean) / len(clean)), 1) if clean else None


def _valuation_score(pe):
    value = _num(pe)
    if value is None:
        return None
    if value <= 0:
        return 1.5
    if value <= 12:
        return 9.5
    if value <= 20:
        return 8.0
    if value <= 30:
        return 6.5
    if value <= 45:
        return 4.5
    return 2.0


def stock_selection_scores(fund: dict, tech: dict, *, is_fund: bool = False) -> dict:
    """Return Fundamental, Growth, and Technical scores on a 1-10 scale."""
    margin = _num(fund.get("profit_margin"))
    if margin is not None and abs(margin) <= 2:
        margin *= 100.0
    roe = _num(fund.get("return_on_equity"))
    if roe is not None and abs(roe) <= 2:
        roe *= 100.0
    debt = _num(fund.get("debt_to_equity"))
    current_ratio = _num(fund.get("current_ratio"))
    forward_pe = _num(fund.get("forward_pe")) or _num(fund.get("trailing_pe"))

    fundamental = None if is_fund else _average([
        _valuation_score(forward_pe),
        _ramp(margin, 0, 25),
        _ramp(roe, 0, 25),
        _ramp(current_ratio, 0.7, 2.2),
        _ramp(-(debt if debt is not None else 100), -250, -20),
    ])

    revenue_growth = _num(fund.get("revenue_growth"))
    earnings_growth = _num(fund.get("earnings_growth"))
    for key, value in (("revenue", revenue_growth), ("earnings", earnings_growth)):
        if value is not None and abs(value) <= 2:
            if key == "revenue":
                revenue_growth = value * 100.0
            else:
                earnings_growth = value * 100.0
    eps = _num(fund.get("trailing_eps"))
    growth = None if is_fund else _average([
        _ramp(revenue_growth, -10, 25),
        _ramp(earnings_growth, -15, 30),
        None if eps is None else (7.5 if eps > 0 else 2.0),
    ])

    price = _num(tech.get("price"))
    sma20 = _num(tech.get("sma_20"))
    sma50 = _num(tech.get("sma_50"))
    sma200 = _num(tech.get("sma_200"))
    rsi = _num(tech.get("rsi_14"))
    relative_strength = _num(tech.get("rel_strength_pct"))

    trend_parts = []
    for average, weight in ((sma20, 0.5), (sma50, 0.8), (sma200, 1.2)):
        if price is not None and average and average > 0:
            distance = (price / average - 1.0) * 100.0
            trend_parts.append(_ramp(distance, -10 * weight, 10 * weight))
    rsi_score = None
    if rsi is not None:
        if rsi < 30:
            rsi_score = _ramp(rsi, 10, 30, 3, 6)
        elif rsi <= 65:
            rsi_score = _ramp(rsi, 30, 65, 6, 9)
        else:
            rsi_score = _ramp(-rsi, -85, -65, 3, 9)
    technical = _average([
        *trend_parts,
        rsi_score,
        _ramp(relative_strength, -10, 10),
    ])

    return {
        "fundamental": fundamental,
        "growth": growth,
        "technical": technical,
    }
