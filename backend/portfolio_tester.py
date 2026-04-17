"""Head-to-head portfolio backtester.

Simulates two user-defined portfolios (1-75 tickers each) plus an optional
benchmark over an arbitrary Yahoo Finance date range. Supports optional
dividend reinvestment, periodic rebalancing, and hard-stops the backtest if
any selected ticker lacks price history for the requested start date.
"""
from __future__ import annotations

import math
import time
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf


# ── Config ────────────────────────────────────────────────────────────────────
MAX_TICKERS_PER_PORTFOLIO = 75
MIN_DAYS = 120  # ~6 months of trading days
MAX_YEARS = 25

_PRICE_CACHE: Dict[str, Tuple[float, pd.DataFrame, pd.DataFrame]] = {}
_CACHE_TTL = 600  # 10 min


# ── Data fetch ────────────────────────────────────────────────────────────────

def _cache_key(tickers: List[str], start: str, end: str) -> str:
    return "|".join(sorted(set(tickers))) + f"::{start}::{end}"


def fetch_prices(tickers: List[str], start: str, end: str
                 ) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Download daily Close + Dividend series for every ticker.

    Returns (close_df, dividends_df) — columns are tickers, indexed by date.
    Uses auto_adjust=False so dividends are separate from price returns.
    """
    key = _cache_key(tickers, start, end)
    hit = _PRICE_CACHE.get(key)
    if hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1].copy(), hit[2].copy()

    raw = yf.download(
        " ".join(tickers),
        start=start,
        end=end,
        auto_adjust=False,
        actions=True,
        progress=False,
        group_by="ticker" if len(tickers) > 1 else "column",
    )
    if raw is None or raw.empty:
        raise ValueError("yfinance returned no data for the requested range.")

    close = pd.DataFrame()
    divs = pd.DataFrame()
    if len(tickers) == 1:
        t = tickers[0]
        close[t] = raw["Close"]
        divs[t] = raw["Dividends"] if "Dividends" in raw.columns else 0.0
    else:
        for t in tickers:
            if t not in raw.columns.get_level_values(0):
                continue
            sub = raw[t]
            close[t] = sub["Close"] if "Close" in sub.columns else np.nan
            divs[t] = sub["Dividends"] if "Dividends" in sub.columns else 0.0

    close = close.dropna(how="all").sort_index()
    divs = divs.reindex(close.index).fillna(0.0)

    _PRICE_CACHE[key] = (time.time(), close.copy(), divs.copy())
    return close, divs


def validate_coverage(close: pd.DataFrame, tickers: List[str],
                      requested_start: pd.Timestamp
                      ) -> Tuple[List[dict], List[dict]]:
    """Return (ok_list, problem_list) describing each ticker's earliest date.

    A ticker is flagged as a problem if its first valid Close is > 5 trading
    days after the requested_start (small slack for holidays/weekends).
    """
    ok, bad = [], []
    slack = pd.Timedelta(days=10)
    for t in tickers:
        if t not in close.columns:
            bad.append({"ticker": t, "earliest": None, "reason": "no data returned"})
            continue
        series = close[t].dropna()
        if series.empty:
            bad.append({"ticker": t, "earliest": None, "reason": "empty price history"})
            continue
        first = series.index[0]
        if first > requested_start + slack:
            bad.append({
                "ticker": t,
                "earliest": first.strftime("%Y-%m-%d"),
                "reason": f"first available {first.strftime('%Y-%m-%d')} is after requested start",
            })
        else:
            ok.append({"ticker": t, "earliest": first.strftime("%Y-%m-%d")})
    return ok, bad


# ── Simulation ────────────────────────────────────────────────────────────────

def _rebalance_dates(idx: pd.DatetimeIndex, freq: str) -> set:
    """Return the set of dates where rebalancing occurs (besides day 0)."""
    if freq == "none" or not freq:
        return set()
    if freq == "monthly":
        marks = pd.Series(idx, index=idx).resample("MS").first().dropna()
    elif freq == "quarterly":
        marks = pd.Series(idx, index=idx).resample("QS").first().dropna()
    elif freq == "annually":
        marks = pd.Series(idx, index=idx).resample("YS").first().dropna()
    else:
        return set()
    return set(pd.to_datetime(marks.values).strftime("%Y-%m-%d").tolist())


def simulate_portfolio(holdings: List[dict], close: pd.DataFrame,
                       divs: pd.DataFrame, initial: float,
                       reinvest_div: bool, include_div: bool,
                       rebalance: str
                       ) -> Dict[str, pd.Series]:
    """Run the portfolio simulation and return daily value/drawdown/income."""
    tickers = [h["ticker"] for h in holdings]
    weights = np.array([h["weight"] for h in holdings], dtype=float)
    weights = weights / weights.sum()
    target = dict(zip(tickers, weights))

    # Align to a price frame that only covers our tickers
    cols = [t for t in tickers if t in close.columns]
    if len(cols) != len(tickers):
        missing = set(tickers) - set(cols)
        raise ValueError(f"Missing price data for: {sorted(missing)}")

    px = close[cols].copy()
    # Forward-fill inside the window so an occasional missing day doesn't
    # blow up share * price calculations
    px = px.ffill().dropna()
    if px.empty:
        raise ValueError("No overlapping price data across all tickers.")

    dv = divs[cols].reindex(px.index).fillna(0.0)

    rebal_dates = _rebalance_dates(px.index, rebalance)

    # Initial allocation
    day0 = px.index[0]
    shares = {t: (initial * target[t]) / float(px.at[day0, t])
              for t in cols if px.at[day0, t] > 0}
    cash = 0.0  # dividends-as-cash bucket when reinvest=False
    income_accum = 0.0  # total dividends received (informational)

    values = []
    income_by_date = []
    date_index = px.index

    for dt in date_index:
        # 1) Dividends paid today (using ex-date / post ex-date Dividends column)
        day_income = 0.0
        if include_div:
            for t in cols:
                d = float(dv.at[dt, t]) if t in dv.columns else 0.0
                if d > 0 and t in shares:
                    paid = shares[t] * d
                    day_income += paid
                    if reinvest_div:
                        p = float(px.at[dt, t])
                        if p > 0:
                            shares[t] += paid / p
                    else:
                        cash += paid
            income_accum += day_income

        # 2) Rebalance (after dividends, before EOD value)
        date_key = str(dt.date())
        if date_key in rebal_dates and dt != day0:
            total = cash + sum(shares[t] * float(px.at[dt, t]) for t in cols)
            for t in cols:
                p = float(px.at[dt, t])
                if p > 0:
                    shares[t] = (total * target[t]) / p
            cash = 0.0  # rebalance folds cash back into positions

        # 3) End-of-day total value
        eod = cash + sum(shares[t] * float(px.at[dt, t]) for t in cols)
        values.append(eod)
        income_by_date.append(day_income)

    value_series = pd.Series(values, index=date_index, name="value")
    income_series = pd.Series(income_by_date, index=date_index, name="income")

    running_max = value_series.cummax()
    drawdown = (value_series - running_max) / running_max

    return {
        "value": value_series,
        "drawdown": drawdown,
        "income": income_series,
        "total_income": float(income_accum),
        "final_value": float(value_series.iloc[-1]),
        "final_cash": float(cash),
    }


# ── Metrics ───────────────────────────────────────────────────────────────────

def _years_between(a: pd.Timestamp, b: pd.Timestamp) -> float:
    return max(1e-9, (b - a).days / 365.25)


def _cagr(value: pd.Series) -> Optional[float]:
    try:
        if len(value) < 2 or value.iloc[0] <= 0:
            return None
        yrs = _years_between(value.index[0], value.index[-1])
        return (float(value.iloc[-1]) / float(value.iloc[0])) ** (1 / yrs) - 1
    except Exception:
        return None


def _sharpe(daily_ret: pd.Series, rf: float = 0.05) -> Optional[float]:
    try:
        daily_ret = daily_ret.dropna()
        if len(daily_ret) < 30:
            return None
        std = float(daily_ret.std())
        if std == 0 or math.isnan(std):
            return None
        excess = float(daily_ret.mean()) - rf / 252
        return excess / std * math.sqrt(252)
    except Exception:
        return None


def _sortino(daily_ret: pd.Series, rf: float = 0.05) -> Optional[float]:
    try:
        daily_ret = daily_ret.dropna()
        if len(daily_ret) < 30:
            return None
        neg = daily_ret[daily_ret < 0]
        if neg.empty:
            return None
        ds = float(neg.std())
        if ds == 0:
            return None
        excess = float(daily_ret.mean()) - rf / 252
        return excess / ds * math.sqrt(252)
    except Exception:
        return None


def _max_dd(value: pd.Series) -> Optional[float]:
    try:
        rm = value.cummax()
        return float(((value - rm) / rm).min())
    except Exception:
        return None


def _peak_monthly_dd(value: pd.Series) -> Optional[float]:
    try:
        monthly = value.resample("ME").last().dropna()
        if len(monthly) < 2:
            return None
        rm = monthly.cummax()
        return float(((monthly - rm) / rm).min())
    except Exception:
        return None


def _recovery_months(value: pd.Series) -> Optional[int]:
    """Longest number of months from a monthly peak back to that peak."""
    try:
        monthly = value.resample("ME").last().dropna()
        if len(monthly) < 2:
            return None
        peak = monthly.iloc[0]
        peak_i = 0
        worst_recovery = 0
        for i, v in enumerate(monthly.values):
            if v >= peak:
                peak = v
                peak_i = i
            else:
                # currently underwater — measure months since last peak
                worst_recovery = max(worst_recovery, i - peak_i)
        return int(worst_recovery)
    except Exception:
        return None


def _ulcer(value: pd.Series) -> Optional[float]:
    try:
        if len(value) < 30:
            return None
        rm = value.cummax()
        pct = ((value - rm) / rm) * 100
        return float(np.sqrt((pct ** 2).mean()))
    except Exception:
        return None


def _std_dev_annual(daily_ret: pd.Series) -> Optional[float]:
    try:
        daily_ret = daily_ret.dropna()
        if len(daily_ret) < 30:
            return None
        return float(daily_ret.std()) * math.sqrt(252)
    except Exception:
        return None


def _beta_alpha(daily_ret: pd.Series, bench_ret: pd.Series, rf: float = 0.05
                ) -> Tuple[Optional[float], Optional[float]]:
    try:
        aligned = pd.concat([daily_ret, bench_ret], axis=1).dropna()
        if len(aligned) < 30:
            return None, None
        r, b = aligned.iloc[:, 0], aligned.iloc[:, 1]
        var_b = float(b.var())
        if var_b == 0:
            return None, None
        beta = float(r.cov(b)) / var_b
        # Annualized alpha via CAPM on daily means
        rf_d = rf / 252
        alpha = (float(r.mean()) - rf_d - beta * (float(b.mean()) - rf_d)) * 252
        return beta, alpha
    except Exception:
        return None, None


def _capture(daily_ret: pd.Series, bench_ret: pd.Series
             ) -> Tuple[Optional[float], Optional[float]]:
    try:
        aligned = pd.concat([daily_ret, bench_ret], axis=1).dropna()
        if len(aligned) < 30:
            return None, None
        r, b = aligned.iloc[:, 0], aligned.iloc[:, 1]
        up = b > 0
        dn = b < 0
        up_cap = float(r[up].mean()) / float(b[up].mean()) * 100 if up.any() and float(b[up].mean()) != 0 else None
        dn_cap = float(r[dn].mean()) / float(b[dn].mean()) * 100 if dn.any() and float(b[dn].mean()) != 0 else None
        return up_cap, dn_cap
    except Exception:
        return None, None


def _correlation(daily_ret: pd.Series, bench_ret: pd.Series) -> Optional[float]:
    try:
        aligned = pd.concat([daily_ret, bench_ret], axis=1).dropna()
        if len(aligned) < 30:
            return None
        return float(aligned.iloc[:, 0].corr(aligned.iloc[:, 1]))
    except Exception:
        return None


def _annual_returns(value: pd.Series) -> List[dict]:
    """Return per-year total returns, flagging calendar years that the
    backtest only partially covers so callers can exclude them."""
    try:
        if len(value) < 2:
            return []
        yearly = value.resample("YE").last().dropna()
        if yearly.empty:
            return []
        first_ts = value.index[0]
        last_ts = value.index[-1]
        slack = pd.Timedelta(days=5)  # tolerate weekends/holidays at boundaries
        rows = []
        prev = None
        prev_ts = first_ts
        for ts, v in yearly.items():
            year = int(ts.year)
            v = float(v)
            year_start = pd.Timestamp(year=year, month=1, day=1)
            year_end = pd.Timestamp(year=year, month=12, day=31)
            full_year = (prev_ts <= year_start + slack) and (last_ts >= year_end - slack)
            base = prev if prev is not None else float(value.iloc[0])
            ret = (v / base) - 1 if base else None
            rows.append({"year": year, "return": ret, "partial": (not full_year)})
            prev = v
            prev_ts = ts
        return rows
    except Exception:
        return []


def _rolling_cagr(value: pd.Series, window_years: float = 1.0) -> pd.Series:
    try:
        monthly = value.resample("ME").last().dropna()
        n = int(round(window_years * 12))
        if len(monthly) < n + 1:
            return pd.Series(dtype=float)
        ratio = monthly / monthly.shift(n)
        return (ratio ** (1 / window_years)) - 1
    except Exception:
        return pd.Series(dtype=float)


def compute_metrics(value: pd.Series, bench_value: Optional[pd.Series],
                    total_income: float) -> dict:
    daily_ret = value.pct_change().dropna()
    bench_ret = bench_value.pct_change().dropna() if bench_value is not None else None

    cagr = _cagr(value)
    std = _std_dev_annual(daily_ret)
    sharpe = _sharpe(daily_ret)
    sortino = _sortino(daily_ret)
    mdd = _max_dd(value)
    pk_mdd = _peak_monthly_dd(value)
    recov = _recovery_months(value)
    ulcer = _ulcer(value)
    mar = (cagr / abs(mdd)) if (cagr is not None and mdd and mdd != 0) else None
    calmar = mar  # same definition used by Morningstar-style reports here

    beta = alpha = up_cap = dn_cap = corr = None
    if bench_ret is not None:
        beta, alpha = _beta_alpha(daily_ret, bench_ret)
        up_cap, dn_cap = _capture(daily_ret, bench_ret)
        corr = _correlation(daily_ret, bench_ret)

    # Best/worst year — exclude partial calendar years at the range edges
    ann = _annual_returns(value)
    full_year_returns = [r["return"] for r in ann if r.get("return") is not None and not r.get("partial")]
    best_yr = max(full_year_returns) if full_year_returns else None
    worst_yr = min(full_year_returns) if full_year_returns else None

    positive_months = None
    try:
        m = value.resample("ME").last().pct_change().dropna()
        if len(m) > 0:
            positive_months = float((m > 0).sum()) / float(len(m))
    except Exception:
        pass

    total_return = (float(value.iloc[-1]) / float(value.iloc[0])) - 1 if len(value) > 1 else None

    return {
        "cagr": cagr,
        "total_return": total_return,
        "std_dev": std,
        "sharpe": sharpe,
        "sortino": sortino,
        "calmar": calmar,
        "mar": mar,
        "max_drawdown": mdd,
        "peak_monthly_dd": pk_mdd,
        "recovery_months": recov,
        "ulcer_index": ulcer,
        "beta": beta,
        "alpha": alpha,
        "up_capture": up_cap,
        "down_capture": dn_cap,
        "correlation": corr,
        "best_year": best_yr,
        "worst_year": worst_yr,
        "positive_months_pct": positive_months,
        "final_value": float(value.iloc[-1]),
        "total_income": total_income,
        "annual_returns": ann,
    }


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run_backtest(portfolios: List[dict], benchmark: Optional[str],
                 start: str, end: str, initial: float,
                 include_div: bool, reinvest_div: bool,
                 rebalance: str) -> dict:
    """Run the full head-to-head backtest.

    portfolios = [{name, holdings: [{ticker, weight}]}, ...]
    """
    # Validation
    for p in portfolios:
        if not p.get("holdings"):
            raise ValueError(f"Portfolio '{p.get('name','?')}' has no holdings.")
        if len(p["holdings"]) > MAX_TICKERS_PER_PORTFOLIO:
            raise ValueError(
                f"Portfolio '{p.get('name','?')}' has "
                f"{len(p['holdings'])} tickers (max {MAX_TICKERS_PER_PORTFOLIO})."
            )
        wsum = sum(float(h["weight"]) for h in p["holdings"])
        if wsum <= 0:
            raise ValueError(f"Portfolio '{p.get('name','?')}' has zero total weight.")

    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    yrs = (end_ts - start_ts).days / 365.25
    if yrs > MAX_YEARS + 0.1:
        raise ValueError(f"Range exceeds {MAX_YEARS} years.")
    if (end_ts - start_ts).days < 150:
        raise ValueError("Minimum backtest range is 6 months.")

    all_tickers = set()
    for p in portfolios:
        for h in p["holdings"]:
            all_tickers.add(h["ticker"].strip().upper())
    if benchmark:
        all_tickers.add(benchmark.strip().upper())

    close, divs = fetch_prices(sorted(all_tickers), start, end)
    ok, bad = validate_coverage(close, sorted(all_tickers), start_ts)

    if bad:
        return {
            "valid": False,
            "reason": "Selected tickers are missing price history for the requested start date.",
            "missing": bad,
            "ok": ok,
        }

    results = []
    for p in portfolios:
        sim = simulate_portfolio(
            holdings=[{"ticker": h["ticker"].strip().upper(), "weight": float(h["weight"])}
                      for h in p["holdings"]],
            close=close, divs=divs,
            initial=initial,
            reinvest_div=reinvest_div,
            include_div=include_div,
            rebalance=rebalance,
        )
        results.append({"name": p["name"], "sim": sim, "holdings": p["holdings"]})

    bench_value = None
    bench_sim = None
    if benchmark:
        bench_sim = simulate_portfolio(
            holdings=[{"ticker": benchmark, "weight": 1.0}],
            close=close, divs=divs,
            initial=initial,
            reinvest_div=reinvest_div,
            include_div=include_div,
            rebalance="none",
        )
        bench_value = bench_sim["value"]

    series_out = []
    for r in results:
        metrics = compute_metrics(r["sim"]["value"], bench_value, r["sim"]["total_income"])
        monthly_income = r["sim"]["income"].resample("MS").sum()
        monthly_value = r["sim"]["value"].resample("ME").last()
        monthly_dd = r["sim"]["drawdown"].resample("ME").last()
        rolling = _rolling_cagr(r["sim"]["value"], 1.0)
        series_out.append({
            "name": r["name"],
            "holdings": r["holdings"],
            "metrics": metrics,
            "value_dates": [d.strftime("%Y-%m-%d") for d in monthly_value.index],
            "value_series": [float(x) for x in monthly_value.values],
            "drawdown_series": [float(x) for x in monthly_dd.values],
            "income_dates": [d.strftime("%Y-%m-%d") for d in monthly_income.index],
            "income_series": [float(x) for x in monthly_income.values],
            "rolling_cagr_dates": [d.strftime("%Y-%m-%d") for d in rolling.index],
            "rolling_cagr_series": [float(x) for x in rolling.values],
        })

    bench_out = None
    if bench_sim is not None:
        bm = compute_metrics(bench_sim["value"], None, bench_sim["total_income"])
        mv = bench_sim["value"].resample("ME").last()
        md = bench_sim["drawdown"].resample("ME").last()
        bench_out = {
            "name": benchmark,
            "metrics": bm,
            "value_dates": [d.strftime("%Y-%m-%d") for d in mv.index],
            "value_series": [float(x) for x in mv.values],
            "drawdown_series": [float(x) for x in md.values],
        }

    return {
        "valid": True,
        "start": start,
        "end": end,
        "initial": initial,
        "include_div": include_div,
        "reinvest_div": reinvest_div,
        "rebalance": rebalance,
        "benchmark": benchmark,
        "portfolios": series_out,
        "benchmark_series": bench_out,
        "coverage": ok,
    }
