"""Historical DRIP-vs-cash analyzer.

Replays actual prices and actual distributions for a set of tickers over one
common user-defined window and answers, per fund: reinvest, take the cash, or
stay out.

Spec: docs/drip-score-spec.md

Design notes
------------
* Every ticker runs on the SAME window. Per-fund inception windows make rows
  incomparable, which is the central flaw in the spreadsheet this replaces.
* Fund-quality metrics (NAV, yield, coverage) are computed with ``cash_rate=0``
  so a cash assumption never contaminates a statement about the fund itself.
  The cash rate only enters the DRIP-vs-cash comparison, where it belongs.
* Price data comes from ``portfolio_tester.fetch_prices`` (``auto_adjust=False``).
  Yahoo's ``Close`` is already split-adjusted; do NOT apply a second adjustment.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

try:
    from portfolio_tester import fetch_prices, validate_coverage, MIN_DAYS
except ImportError:  # package-relative import when loaded as part of a package
    from .portfolio_tester import fetch_prices, validate_coverage, MIN_DAYS


# ── Scoring constants ─────────────────────────────────────────────────────────
NAV_SCORE_FLOOR = -0.10     # annualised NAV change scoring 0
NAV_SCORE_CEIL = 0.10       # annualised NAV change scoring 100
YIELD_SCORE_CAP = 0.15      # covered yield at which the yield score saturates
NAV_WEIGHT = 0.60
YIELD_WEIGHT = 0.40

HIGH_YIELD_CUTOFF = 0.08    # boundary between the two verdict-matrix rows
MIN_INCOME_YIELD = 0.01     # below this, coverage is meaningless
WIN_RATE_STABLE = 0.65      # distance from 0.5 at which the sweep reads as decisive
DRIP_EDGE_DEADBAND = 0.02   # |RE - 1| below this is noise, not a DRIP verdict
DEFAULT_CASH_RATE = 0.04
DEFAULT_INITIAL = 50_000.0

MIN_HOLD_DAYS = 182         # shortest holding period included in the exit sweep
MIN_HOLD_FRACTION = 0.25    # ...or this fraction of the window, whichever is longer

MAX_TICKERS = 75


# ── Helpers ───────────────────────────────────────────────────────────────────

def _years(a: pd.Timestamp, b: pd.Timestamp) -> float:
    """Calendar years between two timestamps, floored to avoid divide-by-zero."""
    return max(1e-9, (b - a).days / 365.25)


def _annualise(total_ratio: float, years: float) -> Optional[float]:
    """Convert a cumulative growth ratio (1.0 == flat) to an annual rate."""
    if total_ratio <= 0 or years <= 0:
        return None
    return total_ratio ** (1.0 / years) - 1.0


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def frequency_for_gap(gap_days: float) -> str:
    """Cadence implied by a single gap between payments."""
    if gap_days is None or gap_days <= 0:
        return "unknown"
    if gap_days <= 10:
        return "weekly"
    if gap_days <= 20:
        return "biweekly"
    if gap_days <= 45:
        return "monthly"
    if gap_days <= 120:
        return "quarterly"
    if gap_days <= 250:
        return "semiannual"
    return "annual"


def infer_frequency(dates: List[pd.Timestamp]) -> str:
    """Overall cadence from the median gap between payments.

    Median rather than mean so a single special distribution doesn't shift it.
    Only a summary label — per-row yields use the LOCAL gap, because funds do
    change cadence mid-window (MSTY went monthly -> weekly in early 2025) and a
    single global factor misannualises every payment on the other side of the
    switch.
    """
    if len(dates) < 2:
        return "unknown"
    gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
    return frequency_for_gap(float(np.median(gaps)))


def _periods_per_year(frequency: str) -> Optional[int]:
    return {"weekly": 52, "biweekly": 26, "monthly": 12,
            "quarterly": 4, "semiannual": 2, "annual": 1}.get(frequency)


def _align_timestamp(ts, index: pd.DatetimeIndex) -> pd.Timestamp:
    """Coerce ``ts`` to the tz-awareness of ``index`` so comparisons don't raise."""
    stamp = pd.Timestamp(ts)
    tz = getattr(index, "tz", None)
    if tz is not None:
        stamp = stamp.tz_localize(tz) if stamp.tzinfo is None else stamp.tz_convert(tz)
    elif stamp.tzinfo is not None:
        stamp = stamp.tz_localize(None)
    return stamp


# ── Core replay ───────────────────────────────────────────────────────────────

def simulate_drip(close: pd.Series, divs: pd.Series, *,
                  initial: float = DEFAULT_INITIAL,
                  reinvest: float = 1.0,
                  cash_rate: float = 0.0) -> Dict:
    """Replay one ticker at a fixed reinvestment fraction.

    ``reinvest`` is the fraction of each distribution that buys more shares;
    the remainder accrues as cash growing at ``cash_rate``. Cash is held
    separately from share value and added back at the end, matching how a real
    brokerage account behaves.

    Returns terminal state plus the per-distribution schedule (the detail view).
    """
    close = close.dropna()
    if close.empty:
        raise ValueError("no price history in window")

    p0 = float(close.iloc[0])
    p_end = float(close.iloc[-1])
    if p0 <= 0:
        raise ValueError("non-positive start price")

    reinvest = _clamp01(float(reinvest))
    shares0 = initial / p0
    shares = shares0
    cash = 0.0

    divs = divs.reindex(close.index).fillna(0.0)
    prev_date = close.index[0]
    schedule: List[dict] = []
    dist_dates: List[pd.Timestamp] = []
    gross_total = 0.0

    for date, amount in divs.items():
        amount = float(amount)
        if amount <= 0:
            continue
        price = float(close.loc[date])
        if price <= 0:
            continue

        # Grow existing cash up to this payment date before adding to it.
        cash *= (1.0 + cash_rate) ** ((date - prev_date).days / 365.25)
        prev_date = date

        gross = shares * amount
        reinvested = gross * reinvest
        shares += reinvested / price
        cash += gross - reinvested
        gross_total += gross
        dist_dates.append(date)

        schedule.append({
            "date": date.strftime("%Y-%m-%d"),
            "price": price,
            "dividend": amount,
            "gross": gross,
            "reinvested": reinvested,
            "cash_taken": gross - reinvested,
            "shares": shares,
            "share_value": shares * price,
            "cash_balance": cash,
        })

    # Grow trailing cash from the last payment to the end of the window.
    cash *= (1.0 + cash_rate) ** ((close.index[-1] - prev_date).days / 365.25)

    share_value = shares * p_end
    terminal = share_value + cash
    frequency = infer_frequency(dist_dates)
    global_periods = _periods_per_year(frequency)

    # Annualise each payment by the time it actually covers. Snapping the gap
    # to a canonical cadence looks tidier but has a 3x cliff at the monthly /
    # quarterly boundary: MSTY's 48-day gap reads 59% against neighbours near
    # 110%. Elapsed time is continuous, and on a clean weekly schedule it costs
    # only 365.25/7 = 52.18 vs 52 — 0.35%.
    for i, row in enumerate(schedule):
        if i > 0:
            gap = (dist_dates[i] - dist_dates[i - 1]).days
        elif len(dist_dates) > 1:
            gap = (dist_dates[1] - dist_dates[0]).days
        else:
            gap = None
        if gap and gap > 0:
            periods = 365.25 / gap
            row["period_frequency"] = frequency_for_gap(gap)
        else:
            periods = global_periods
            row["period_frequency"] = frequency
        row["current_yield"] = (
            row["dividend"] * periods / row["price"] if periods else None
        )

    return {
        "start_price": p0,
        "end_price": p_end,
        "start_date": close.index[0].strftime("%Y-%m-%d"),
        "end_date": close.index[-1].strftime("%Y-%m-%d"),
        "shares_start": shares0,
        "shares_end": shares,
        "share_value_end": share_value,
        "cash_end": cash,
        "terminal_value": terminal,
        "total_return": terminal / initial - 1.0,
        "gross_distributions": gross_total,
        "distribution_count": len(schedule),
        "frequency": frequency,
        "years": _years(close.index[0], close.index[-1]),
        "schedule": schedule,
    }


def compute_win_rate(close: pd.Series, divs: pd.Series, *,
                     initial: float = DEFAULT_INITIAL,
                     cash_rate: float = 0.0) -> Dict:
    """Fraction of possible exit dates at which full DRIP beat taking cash.

    A single-endpoint DRIP verdict can hinge entirely on the exit price. This
    sweeps every exit date past a minimum holding period in one O(n) forward
    pass, accumulating the DRIP share count and the no-DRIP cash balance and
    evaluating reinvestment efficiency at each step.
    """
    close = close.dropna()
    if len(close) < 2:
        return {"win_rate": None, "n_exits": 0, "stable": None}

    p0 = float(close.iloc[0])
    if p0 <= 0:
        return {"win_rate": None, "n_exits": 0, "stable": None}

    shares0 = initial / p0
    shares_full = shares0
    cash = 0.0

    divs = divs.reindex(close.index).fillna(0.0)
    start = close.index[0]
    window_days = (close.index[-1] - start).days
    min_days = max(MIN_HOLD_DAYS, int(MIN_HOLD_FRACTION * window_days))

    prev_date = start
    wins = 0
    total = 0

    for date, price in close.items():
        amount = float(divs.loc[date])
        cash *= (1.0 + cash_rate) ** ((date - prev_date).days / 365.25)
        prev_date = date
        price = float(price)
        if amount > 0 and price > 0:
            gross = shares_full * amount
            shares_full += gross / price
            cash += shares0 * amount

        if (date - start).days < min_days or cash <= 0 or price <= 0:
            continue
        growth = shares_full - shares0
        total += 1
        if (growth * price) / cash > 1.0:
            wins += 1

    if total == 0:
        return {"win_rate": None, "n_exits": 0, "stable": None}

    rate = wins / total
    # Stability is distance from a coin flip, not height. A 0% win rate is a
    # maximally RELIABLE "take the cash" signal; only rates near 0.5 are
    # genuinely ambiguous.
    stable = abs(rate - 0.5) >= (WIN_RATE_STABLE - 0.5)
    return {"win_rate": rate, "n_exits": total, "stable": stable}


# ── Scoring ───────────────────────────────────────────────────────────────────

def score_components(nav_annual: Optional[float], annual_yield: float,
                     annual_fund_tr: Optional[float]) -> Dict:
    """NAV / covered-yield subscores and the weighted DRIP Opportunity score.

    ``covered_yield`` is the fix over a raw-yield input: yield counts only to
    the extent supported by the fund's simple annual total return. The annual
    fund return and annual yield must use the same simple annualisation basis;
    mixing a geometric CAGR with a simple annual yield understates coverage.
    """
    nav = nav_annual if nav_annual is not None else NAV_SCORE_FLOOR
    span = NAV_SCORE_CEIL - NAV_SCORE_FLOOR
    nav_score = 100.0 * _clamp01((nav - NAV_SCORE_FLOOR) / span)

    earned = max(0.0, annual_fund_tr) if annual_fund_tr is not None else 0.0
    covered_yield = min(annual_yield, earned)
    yield_score = 100.0 * _clamp01(covered_yield / YIELD_SCORE_CAP)

    return {
        "nav_score": nav_score,
        "yield_score": yield_score,
        "covered_yield": covered_yield,
        "opportunity": NAV_WEIGHT * nav_score + YIELD_WEIGHT * yield_score,
    }


_BUCKETS = {
    (True, "covered"): "Compounder",
    (True, "partial"): "Harvester",
    (True, "eroding"): "Liquidator",
    (False, "covered"): "Grower",
    (False, "partial"): "Fading",
    (False, "eroding"): "Broken",
}


def classify(annual_yield: float, coverage: Optional[float],
             re_value: Optional[float], win_rate: Optional[float],
             annual_fund_tr: Optional[float]) -> Dict:
    """Two-dimensional verdict plus the DRIP/cash call.

    The bucket describes the fund; the call describes what to do with its
    distributions. They are separate questions and a single blended score
    cannot express both.
    """
    high_yield = annual_yield >= HIGH_YIELD_CUTOFF

    if coverage is None:
        band = "covered" if (annual_fund_tr or 0.0) >= 0 else "eroding"
    elif coverage >= 1.0:
        band = "covered"
    elif coverage >= 0.0:
        band = "partial"
    else:
        band = "eroding"

    bucket = _BUCKETS[(high_yield, band)]

    if re_value is None:
        call = "N/A"
        conflicted = False
    else:
        # RE decides the direction; the win rate only qualifies confidence.
        # Gating the call on the win rate lets a 49% coin-flip override an
        # emphatic economic answer (MSTY: RE 0.407 with a 49% win rate is a
        # clear "take the cash", not a toss-up) because the win rate counts how
        # OFTEN DRIP led without weighting by how MUCH.
        edge = re_value - 1.0
        if abs(edge) < DRIP_EDGE_DEADBAND:
            call = "Toss-up"
        elif edge > 0:
            call = "DRIP"
        else:
            call = "Take cash"
        conflicted = (win_rate is not None
                      and (re_value > 1.0) != (win_rate > 0.5))

    return {"bucket": bucket, "drip_call": call, "conflicted": conflicted}


# ── Per-ticker metrics ────────────────────────────────────────────────────────

def compute_ticker_metrics(close: pd.Series, divs: pd.Series, ticker: str, *,
                           initial: float = DEFAULT_INITIAL,
                           cash_rate: float = DEFAULT_CASH_RATE) -> Dict:
    """One row of the grid: three DRIP modes plus every derived metric."""
    full = simulate_drip(close, divs, initial=initial, reinvest=1.0, cash_rate=cash_rate)
    half = simulate_drip(close, divs, initial=initial, reinvest=0.5, cash_rate=cash_rate)
    none = simulate_drip(close, divs, initial=initial, reinvest=0.0, cash_rate=cash_rate)

    # Fund-quality baseline: no cash assumption, so these describe the fund only.
    fund = simulate_drip(close, divs, initial=initial, reinvest=0.0, cash_rate=0.0)

    years = full["years"]
    p0, p_end = full["start_price"], full["end_price"]
    price_appreciation = p_end / p0 - 1.0
    # This is market-price CAGR, retained under the existing API key
    # ``nav_annual`` for compatibility. It is not an official fund NAV series.
    nav_annual = _annualise(p_end / p0, years)

    gross_income = fund["gross_distributions"]
    fund_total_return = fund["total_return"]
    income_return = gross_income / initial
    annual_yield = income_return / years

    # Coverage compares the fund's total return with its distributions. Both
    # sides must cover the same period and use the same annualisation method.
    # Dividing geometric CAGR by a simple annual yield made even a flat-price
    # income fund appear under-covered.
    annual_fund_tr = fund_total_return / years

    coverage = (annual_fund_tr / annual_yield
                if annual_yield >= MIN_INCOME_YIELD and annual_fund_tr is not None
                else None)

    # Reinvestment efficiency: what $1 of distributions became under DRIP
    # versus held as cash. Scale-free, and sign-identical to the DRIP score.
    growth = full["shares_end"] - full["shares_start"]
    cash_fv = none["cash_end"]
    re_value = (growth * p_end) / cash_fv if cash_fv > 0 else None

    drip_score = full["total_return"] - none["total_return"]
    income_factor = cash_fv / initial

    win = compute_win_rate(close, divs, initial=initial, cash_rate=cash_rate)
    scores = score_components(nav_annual, annual_yield, annual_fund_tr)
    verdict = classify(annual_yield, coverage, re_value, win["win_rate"], annual_fund_tr)

    return {
        "ticker": ticker,
        "start_price": p0,
        "end_price": p_end,
        "effective_start": full["start_date"],
        "effective_end": full["end_date"],
        "years": years,
        "price_appreciation": price_appreciation,
        "nav_annual": nav_annual,
        "tr_full": full["total_return"],
        "tr_50": half["total_return"],
        "tr_none": none["total_return"],
        "annual_yield": annual_yield,
        "coverage": coverage,
        "drip_score": drip_score,
        "re": re_value,
        "income_factor": income_factor,
        "distribution_count": full["distribution_count"],
        "frequency": full["frequency"],
        **scores,
        **win,
        **verdict,
    }


# ── Per-ticker detail ─────────────────────────────────────────────────────────

def build_detail(close: pd.Series, divs: pd.Series, ticker: str, *,
                 initial: float = DEFAULT_INITIAL,
                 cash_rate: float = DEFAULT_CASH_RATE) -> Dict:
    """Distribution-by-distribution schedule across all three DRIP modes.

    The equivalent of the source spreadsheet's per-ticker tab: one row per
    payment showing what each strategy owned and what it was worth at that
    moment, so the divergence is visible rather than asserted.
    """
    summary = compute_ticker_metrics(
        close, divs, ticker, initial=initial, cash_rate=cash_rate)

    modes = {
        "full": simulate_drip(close, divs, initial=initial, reinvest=1.0,
                              cash_rate=cash_rate),
        "half": simulate_drip(close, divs, initial=initial, reinvest=0.5,
                              cash_rate=cash_rate),
        "none": simulate_drip(close, divs, initial=initial, reinvest=0.0,
                              cash_rate=cash_rate),
    }

    # All three replay the same filtered distribution dates, so they align by
    # index. Zip defensively anyway rather than trusting the invariant.
    schedule = []
    for f, h, n in zip(modes["full"]["schedule"],
                       modes["half"]["schedule"],
                       modes["none"]["schedule"]):
        if not (f["date"] == h["date"] == n["date"]):
            raise ValueError("distribution schedules diverged between DRIP modes")
        schedule.append({
            "date": f["date"],
            "price": f["price"],
            "dividend": f["dividend"],
            "current_yield": f["current_yield"],
            "period_frequency": f["period_frequency"],
            "payment_full": f["gross"],
            "payment_half": h["reinvested"],
            "payment_none": n["cash_taken"],
            "shares_full": f["shares"],
            "shares_half": h["shares"],
            "shares_none": n["shares"],
            "value_full": f["share_value"],
            "value_half": h["share_value"] + h["cash_balance"],
            "value_none": n["share_value"] + n["cash_balance"],
            "cash_half": h["cash_balance"],
            "cash_none": n["cash_balance"],
        })

    summary["terminal"] = {
        mode: {
            "shares": sim["shares_end"],
            "share_value": sim["share_value_end"],
            "cash": sim["cash_end"],
            "total": sim["terminal_value"],
            "total_return": sim["total_return"],
        }
        for mode, sim in modes.items()
    }
    summary["gross_distributions"] = modes["none"]["gross_distributions"]
    summary["initial_investment"] = initial
    summary["cash_rate"] = cash_rate
    return {"summary": summary, "schedule": schedule}


def run_detail(ticker: str, start: str, end: str, *,
               initial: float = DEFAULT_INITIAL,
               cash_rate: float = DEFAULT_CASH_RATE) -> Dict:
    """Fetch one ticker and build its detail view."""
    sym = str(ticker or "").strip().upper()
    if not sym:
        raise ValueError("ticker is required")

    close_df, divs_df = fetch_prices([sym], start, end)
    if sym not in close_df.columns:
        raise ValueError(f"No data returned for {sym}.")
    series = close_df[sym].dropna()
    if series.empty:
        raise ValueError(f"No price history for {sym} in this window.")

    covered_days = (series.index[-1] - series.index[0]).days
    if covered_days < MIN_DAYS:
        raise ValueError(
            f"{sym} has only {covered_days} days of history in this window "
            f"(minimum {MIN_DAYS}).")

    detail = build_detail(series, divs_df[sym], sym,
                          initial=initial, cash_rate=cash_rate)
    requested_days = (pd.Timestamp(end) - pd.Timestamp(start)).days
    detail["summary"]["coverage_pct"] = min(
        1.0, covered_days / max(1, requested_days))
    return detail


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run_drip_score(tickers: List[str], start: str, end: str, *,
                   initial: float = DEFAULT_INITIAL,
                   cash_rate: float = DEFAULT_CASH_RATE,
                   partial_data: str = "include") -> Dict:
    """Run the full screen over one common window.

    ``partial_data``:
      * ``"exclude"`` - tickers whose history starts after the requested window
        are rejected and reported in ``excluded``.
      * ``"include"`` - they run on their own effective window, are flagged with
        a ``coverage_pct``, and are returned in a SEPARATE ``partial`` list so a
        short-history fund can never outrank a full-window one.

    Either way every requested ticker is accounted for in exactly one of
    ``rows`` / ``partial`` / ``excluded``. Nothing is silently dropped.
    """
    tickers = list(dict.fromkeys(t.strip().upper() for t in tickers if t and t.strip()))
    if not tickers:
        raise ValueError("no tickers supplied")
    if len(tickers) > MAX_TICKERS:
        raise ValueError(f"too many tickers (max {MAX_TICKERS})")
    if partial_data not in ("include", "exclude"):
        raise ValueError("partial_data must be 'include' or 'exclude'")

    requested_start = pd.Timestamp(start)
    requested_end = pd.Timestamp(end)
    window_days = (requested_end - requested_start).days
    if window_days < MIN_DAYS:
        raise ValueError(f"window must be at least {MIN_DAYS} days")

    close, divs = fetch_prices(tickers, start, end)
    aligned_start = _align_timestamp(requested_start, close.index)
    ok, bad = validate_coverage(close, tickers, aligned_start)

    rows: List[dict] = []
    partial: List[dict] = []
    excluded: List[dict] = [dict(item) for item in bad]

    short_history = {item["ticker"] for item in bad}
    if partial_data == "exclude":
        candidates = [item["ticker"] for item in ok]
    else:
        # A ticker with no data at all is rejected under either policy. yfinance
        # returns an all-NaN COLUMN for an unknown symbol rather than omitting
        # it, so filter those out here or they get reported twice.
        excluded = [item for item in bad if item.get("earliest") is None]
        already_excluded = {item["ticker"] for item in excluded}
        candidates = [t for t in tickers
                      if t in close.columns and t not in already_excluded]

    for ticker in candidates:
        series = close[ticker].dropna()
        if series.empty:
            excluded.append({"ticker": ticker, "earliest": None,
                             "reason": "empty price history"})
            continue

        covered_days = (series.index[-1] - series.index[0]).days
        if covered_days < MIN_DAYS:
            excluded.append({
                "ticker": ticker,
                "earliest": series.index[0].strftime("%Y-%m-%d"),
                "reason": f"only {covered_days} days of history in window "
                          f"(minimum {MIN_DAYS})",
            })
            continue

        try:
            row = compute_ticker_metrics(
                series, divs[ticker], ticker, initial=initial, cash_rate=cash_rate)
        except ValueError as exc:
            excluded.append({"ticker": ticker, "earliest": None, "reason": str(exc)})
            continue

        row["coverage_pct"] = min(1.0, covered_days / max(1, window_days))
        row["partial"] = ticker in short_history
        (partial if row["partial"] else rows).append(row)

    rows.sort(key=lambda r: r["opportunity"], reverse=True)
    partial.sort(key=lambda r: r["opportunity"], reverse=True)

    return {
        "meta": {
            "start_date": start,
            "end_date": end,
            "years": window_days / 365.25,
            "cash_rate": cash_rate,
            "initial_investment": initial,
            "partial_data": partial_data,
            "requested": len(tickers),
        },
        "rows": rows,
        "partial": partial,
        "excluded": excluded,
    }
