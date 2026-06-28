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

try:
    from market_symbols import yahoo_symbol_for_ticker
except ImportError:
    from .market_symbols import yahoo_symbol_for_ticker


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

    yahoo_by_ticker = {t: yahoo_symbol_for_ticker(t) for t in tickers}
    yahoo_tickers = list(dict.fromkeys(yahoo_by_ticker.values()))
    raw = yf.download(
        " ".join(yahoo_tickers),
        start=start,
        end=end,
        auto_adjust=False,
        actions=True,
        progress=False,
        group_by="ticker" if len(yahoo_tickers) > 1 else "column",
    )
    if raw is None or raw.empty:
        raise ValueError("yfinance returned no data for the requested range.")

    close = pd.DataFrame()
    divs = pd.DataFrame()
    if len(yahoo_tickers) == 1:
        yf_t = yahoo_tickers[0]
        requested = [t for t, mapped in yahoo_by_ticker.items() if mapped == yf_t]
        div_values = raw["Dividends"] if "Dividends" in raw.columns else 0.0
        for t in requested:
            close[t] = raw["Close"]
            divs[t] = div_values
    else:
        for t in tickers:
            yf_t = yahoo_by_ticker.get(t, t)
            if yf_t not in raw.columns.get_level_values(0):
                continue
            sub = raw[yf_t]
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


def _apply_cash_flow(shares: dict, cols, prices: dict, target: dict, amount: float):
    """Buy (amount>0) or sell (amount<0) ``amount`` dollars of holdings,
    pro-rata to current market value (falling back to target weights when the
    book is empty). Mutates ``shares`` in place. A sell is assumed not to exceed
    current market value, so pro-rata keeps every position non-negative.
    """
    pv = sum(shares.get(t, 0.0) * prices[t] for t in cols if prices[t] > 0)
    for t in cols:
        p = prices[t]
        if p <= 0:
            continue
        frac = (shares.get(t, 0.0) * p / pv) if pv > 0 else target.get(t, 0.0)
        shares[t] = shares.get(t, 0.0) + (amount * frac) / p


def simulate_portfolio(holdings: List[dict], close: pd.DataFrame,
                       divs: pd.DataFrame, initial: float,
                       reinvest_div: bool, include_div: bool,
                       rebalance: str,
                       tax_rate: float = 0.0,
                       spend_income: bool = False,
                       withdraw_rate: float = 0.0,
                       withdraw_inflation: float = 0.0
                       ) -> Dict[str, pd.Series]:
    """Run the portfolio simulation and return daily value/drawdown/income.

    Distribution handling, set by the caller:
      * reinvest_div=True                         -> DRIP: net distributions buy
                                                     more shares.
      * reinvest_div=False, spend_income=True,
        withdraw_rate=0                            -> spend ALL distributions as
                                                     cash; ``value`` tracks the
                                                     surviving principal only.
      * reinvest_div=False, spend_income=True,
        withdraw_rate>0                            -> TARGET-INCOME spend: deliver
                                                     a fixed withdrawal (``withdraw_rate``
                                                     of the initial per year, grown by
                                                     ``withdraw_inflation``). Distributions
                                                     fund it first; any SURPLUS above the
                                                     target is reinvested into more shares,
                                                     and any SHORTFALL is covered by selling
                                                     shares. ``value`` tracks principal.
      * reinvest_div=False, spend_income=False    -> legacy behaviour:
                                                     distributions accrue as idle
                                                     cash inside the account.

    ``tax_rate`` (0..1) is a single blended haircut applied to every
    distribution before it is reinvested, spent, or accrued. Defaults preserve
    the original pre-tax, reinvest/accumulate behaviour.
    """
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
    tax_rate = min(max(float(tax_rate or 0.0), 0.0), 1.0)
    withdraw_rate = max(float(withdraw_rate or 0.0), 0.0)
    withdraw_inflation = max(float(withdraw_inflation or 0.0), 0.0)
    spend_target = bool(spend_income and withdraw_rate > 0)

    # Initial allocation
    day0 = px.index[0]
    shares = {t: (initial * target[t]) / float(px.at[day0, t])
              for t in cols if px.at[day0, t] > 0}
    cash = 0.0           # idle-cash bucket (legacy accumulate-as-cash mode)
    pending = 0.0        # distribution cash awaiting monthly target settlement
    gross_accum = 0.0    # total distributions received, pre-tax
    tax_accum = 0.0      # total distribution tax withheld
    net_accum = 0.0      # total distributions after tax
    withdrawn = 0.0      # cumulative cash spent out of the account (spend mode)
    reinvested_surplus = 0.0  # distributions reinvested above the spend target
    depleted_date = None # first date principal could not cover the target

    values = []             # end-of-day account value
    income_by_date = []     # per-day NET distribution received
    withdrawn_by_date = []  # running cumulative net cash withdrawn (spend mode)
    withdrawn_daily = []    # per-day cash actually withdrawn/spent
    target_by_date = []     # per-day INTENDED withdrawal (the user-set target,
                            # uncapped by depletion) — used to drive the benchmark
    date_index = px.index
    month_period = date_index.to_period("M")
    n_days = len(date_index)

    for i, dt in enumerate(date_index):
        prices = {t: float(px.at[dt, t]) for t in cols}

        # 1) Distributions paid today (ex-date Dividends column), net of tax.
        #    DRIP buys immediately; otherwise the net flows into a cash pool.
        day_net = 0.0
        day_cash = 0.0
        if include_div:
            for t in cols:
                d = float(dv.at[dt, t]) if t in dv.columns else 0.0
                if d > 0 and t in shares:
                    gross = shares[t] * d
                    tax = gross * tax_rate
                    net = gross - tax
                    gross_accum += gross
                    tax_accum += tax
                    net_accum += net
                    day_net += net
                    if reinvest_div:
                        if prices[t] > 0:
                            shares[t] += net / prices[t]
                    else:
                        day_cash += net

        # 2) Spending settlement.
        withdrawn_today = 0.0
        target_today = 0.0   # intended withdrawal (the benchmark must match this)
        if include_div and not reinvest_div:
            if spend_target:
                # Accumulate distributions; settle the spend target monthly so a
                # monthly payer reinvests the genuine surplus (distribution above
                # the target) and only sells shares for a genuine shortfall —
                # rather than churning daily.
                pending += day_cash
                is_month_end = (i == n_days - 1) or (month_period[i + 1] != month_period[i])
                if is_month_end:
                    elapsed_years = max((dt - day0).days, 0) / 365.25
                    need_month = (withdraw_rate * initial / 12.0) * ((1.0 + withdraw_inflation) ** elapsed_years)
                    target_today = need_month  # intended target, before depletion capping
                    # Deliver the target from distribution cash first.
                    pay = min(pending, need_month)
                    withdrawn_today += pay; withdrawn += pay; pending -= pay
                    shortfall = need_month - pay
                    # Reinvest any distribution surplus above the target.
                    if pending > 1e-9:
                        _apply_cash_flow(shares, cols, prices, target, pending)
                        reinvested_surplus += pending; pending = 0.0
                    # Cover any shortfall by selling shares.
                    if shortfall > 1e-9:
                        pv = sum(shares[t] * prices[t] for t in cols)
                        sell = min(shortfall, pv)
                        if sell > 1e-12:
                            _apply_cash_flow(shares, cols, prices, target, -sell)
                            withdrawn_today += sell; withdrawn += sell
                        if depleted_date is None and (shortfall - sell) > 1e-6:
                            depleted_date = dt  # principal exhausted; target unmet
            elif spend_income:
                # Spend ALL distributions as cash (principal-only value). Here the
                # "target" simply is whatever was distributed.
                withdrawn_today += day_cash; withdrawn += day_cash
                target_today = day_cash; day_cash = 0.0
            else:
                cash += day_cash  # legacy idle-cash accumulation

        # 3) Rebalance (after distributions, before EOD value)
        date_key = str(dt.date())
        if date_key in rebal_dates and dt != day0:
            total = cash + sum(shares[t] * prices[t] for t in cols)
            for t in cols:
                if prices[t] > 0:
                    shares[t] = (total * target[t]) / prices[t]
            cash = 0.0  # rebalance folds cash back into positions

        # 4) End-of-day account value. In spend mode the distribution cash has
        # left the account, so this is surviving principal (shares) only.
        eod = cash + sum(shares[t] * prices[t] for t in cols)
        values.append(eod)
        income_by_date.append(day_net)
        withdrawn_by_date.append(withdrawn)
        withdrawn_daily.append(withdrawn_today)
        target_by_date.append(target_today)

    value_series = pd.Series(values, index=date_index, name="value")
    income_series = pd.Series(income_by_date, index=date_index, name="income")
    withdrawn_series = pd.Series(withdrawn_by_date, index=date_index, name="withdrawn")
    withdrawn_daily_series = pd.Series(withdrawn_daily, index=date_index, name="withdrawn_daily")
    target_daily_series = pd.Series(target_by_date, index=date_index, name="target_daily")

    running_max = value_series.cummax()
    drawdown = (value_series - running_max) / running_max

    # Wealth = surviving principal + cash already taken out, so spend and
    # reinvest modes can be compared on a like-for-like total-value basis.
    wealth_series = value_series + withdrawn_series

    return {
        "value": value_series,
        "drawdown": drawdown,
        "income": income_series,
        "withdrawn": withdrawn_series,
        "withdrawn_daily": withdrawn_daily_series,
        "target_daily": target_daily_series,
        "wealth": wealth_series,
        "total_income": float(net_accum),          # net distributions (== gross when tax=0)
        "total_income_gross": float(gross_accum),
        "total_tax": float(tax_accum),
        "total_withdrawn": float(withdrawn),       # cash actually spent
        "reinvested_surplus": float(reinvested_surplus),
        "final_value": float(value_series.iloc[-1]),
        "final_cash": float(cash),
        "depleted": depleted_date.strftime("%Y-%m-%d") if depleted_date is not None else None,
    }


def simulate_equal_withdrawal_benchmark(benchmark: str, close: pd.DataFrame,
                                        divs: pd.DataFrame, initial: float,
                                        target_income: pd.Series,
                                        tax_rate: float = 0.0
                                        ) -> Dict[str, pd.Series]:
    """Fund the primary portfolio's net distributions by selling the benchmark.

    ``target_income`` is the primary portfolio's per-day NET distribution series.
    On each date the benchmark sells exactly enough shares to deliver that day's
    target cash; its own dividends are reinvested (after the same blended tax) so
    it stays a total-return holding. The output is the benchmark's *residual
    principal* after delivering identical spendable income — i.e. the
    "would I have been better off just selling the index?" comparison.

    By construction it delivers the same cash as the portfolio (until principal is
    exhausted), so the meaningful difference is the surviving principal.
    """
    if benchmark not in close.columns:
        raise ValueError(f"Missing price data for benchmark: {benchmark}")

    px = close[[benchmark]].copy().ffill().dropna()
    if px.empty:
        raise ValueError("No benchmark price data in range.")
    dv = divs[[benchmark]].reindex(px.index).fillna(0.0) if benchmark in divs.columns else None
    tax_rate = min(max(float(tax_rate or 0.0), 0.0), 1.0)
    tgt = target_income.reindex(px.index).fillna(0.0)

    day0 = px.index[0]
    p0 = float(px.at[day0, benchmark])
    shares = (initial / p0) if p0 > 0 else 0.0

    withdrawn = 0.0
    depleted_date = None
    values = []
    income_by_date = []
    withdrawn_by_date = []

    for dt in px.index:
        p = float(px.at[dt, benchmark])
        # Benchmark's own dividends -> DRIP after tax (keeps it total-return)
        if dv is not None and p > 0 and shares > 0:
            d = float(dv.at[dt, benchmark])
            if d > 0:
                shares += (shares * d * (1.0 - tax_rate)) / p

        # Deliver the portfolio's net income for this date by selling shares
        want = float(tgt.at[dt])
        delivered = 0.0
        if want > 0 and p > 0 and shares > 0:
            sell = want / p
            if sell >= shares:
                sell = shares
                if depleted_date is None:
                    depleted_date = dt
            shares -= sell
            delivered = sell * p
        withdrawn += delivered

        values.append(shares * p)
        income_by_date.append(delivered)
        withdrawn_by_date.append(withdrawn)

    value_series = pd.Series(values, index=px.index, name="value")
    income_series = pd.Series(income_by_date, index=px.index, name="income")
    withdrawn_series = pd.Series(withdrawn_by_date, index=px.index, name="withdrawn")
    running_max = value_series.cummax()
    drawdown = (value_series - running_max) / running_max
    wealth_series = value_series + withdrawn_series

    return {
        "value": value_series,
        "drawdown": drawdown,
        "income": income_series,
        "withdrawn": withdrawn_series,
        "wealth": wealth_series,
        "total_income": float(withdrawn),       # net cash actually delivered
        "total_income_gross": float(withdrawn),
        "total_tax": 0.0,
        "total_withdrawn": float(withdrawn),
        "final_value": float(value_series.iloc[-1]),
        "final_cash": 0.0,
        "depleted": depleted_date.strftime("%Y-%m-%d") if depleted_date is not None else None,
    }


# ── Metrics ───────────────────────────────────────────────────────────────────

def _years_between(a: pd.Timestamp, b: pd.Timestamp) -> float:
    return max(1e-9, (b - a).days / 365.25)


def compute_income_metrics(sim: dict, initial: float) -> dict:
    """Income-investor scorecard derived from a simulation result.

    Frames the run around cash delivered and principal survived rather than
    CAGR/Sharpe: net income taken, tax paid, residual principal, the combined
    total outcome, income yield-on-cost, and the weakest rolling-12-month income.
    """
    value = sim["value"]
    yrs = _years_between(value.index[0], value.index[-1])
    gross = float(sim.get("total_income_gross", 0.0))
    tax = float(sim.get("total_tax", 0.0))
    # "Income taken" is the cash actually spent out of the account. For spend-all
    # this equals net distributions; for target spending it is the target taken
    # (the rest reinvested); for the benchmark it is the matched withdrawal.
    income_taken = float(sim.get("total_withdrawn", 0.0))
    reinvested = float(sim.get("reinvested_surplus", 0.0))
    residual_principal = float(value.iloc[-1])
    total_outcome = residual_principal + income_taken
    avg_annual_income = (income_taken / yrs) if yrs > 0 else None
    yoc = (avg_annual_income / initial) if (avg_annual_income is not None and initial) else None

    worst_12m = None
    try:
        # Prefer the actually-spent stream; fall back to distributions received.
        src = sim.get("withdrawn_daily")
        if src is None:
            src = sim.get("income")
        monthly = src.resample("MS").sum()
        roll = monthly.rolling(12).sum().dropna()
        if not roll.empty:
            worst_12m = float(roll.min())
    except Exception:
        pass

    return {
        "net_income": income_taken,
        "gross_income": gross,
        "tax_paid": tax,
        "reinvested_surplus": reinvested,
        "withdrawn": income_taken,
        "residual_principal": residual_principal,
        "total_outcome": total_outcome,
        "avg_annual_net_income": avg_annual_income,
        "income_yield_on_cost": yoc,
        "worst_rolling_12m_income": worst_12m,
        "depleted": sim.get("depleted"),
    }


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
                 rebalance: str,
                 tax_rate: float = 0.0,
                 spend_income: bool = False,
                 equal_withdrawal: bool = False,
                 withdraw_rate: float = 0.0,
                 withdraw_inflation: float = 0.0) -> dict:
    """Run the full head-to-head backtest.

    portfolios = [{name, holdings: [{ticker, weight}]}, ...]

    Income-mode extras (all default to the original growth behaviour):
      * tax_rate (0..1)      blended haircut on every distribution.
      * spend_income         distributions leave the account as cash instead of
                             reinvesting; portfolio ``value`` tracks principal.
      * withdraw_rate (0..1) target spend as a fraction of the initial per year;
                             surplus distributions reinvest, shortfalls sell
                             shares. 0 = spend all distributions.
      * withdraw_inflation   annual growth applied to that spend target.
      * equal_withdrawal     replace the buy-and-hold benchmark with one that
                             funds the *first* portfolio's actual withdrawal
                             stream by selling benchmark shares (the "just sell
                             the index" comparison). Only meaningful in spend
                             mode, where both deliver the same cash.
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
            tax_rate=tax_rate,
            spend_income=spend_income,
            withdraw_rate=withdraw_rate,
            withdraw_inflation=withdraw_inflation,
        )
        results.append({"name": p["name"], "sim": sim, "holdings": p["holdings"]})

    bench_value = None
    bench_sim = None
    bench_mode = None
    if benchmark:
        if equal_withdrawal and results:
            # Fund the FIRST portfolio's net distribution stream by selling the
            # benchmark — the apples-to-apples "just sell the index" comparison.
            bench_sim = simulate_equal_withdrawal_benchmark(
                benchmark=benchmark, close=close, divs=divs,
                initial=initial,
                # Match the FIRST portfolio's INTENDED withdrawal target (the
                # user-set schedule), so the benchmark aims for the same spending
                # even if the portfolio's own principal was exhausted.
                target_income=results[0]["sim"]["target_daily"],
                tax_rate=tax_rate,
            )
            bench_mode = "equal_withdrawal"
        else:
            bench_sim = simulate_portfolio(
                holdings=[{"ticker": benchmark, "weight": 1.0}],
                close=close, divs=divs,
                initial=initial,
                reinvest_div=reinvest_div,
                include_div=include_div,
                rebalance="none",
                tax_rate=tax_rate,
                spend_income=spend_income,
            )
            bench_mode = "buy_and_hold"
        bench_value = bench_sim["value"]

    series_out = []
    for r in results:
        metrics = compute_metrics(r["sim"]["value"], bench_value, r["sim"]["total_income"])
        income_metrics = compute_income_metrics(r["sim"], initial)
        monthly_income = r["sim"]["income"].resample("MS").sum()
        monthly_value = r["sim"]["value"].resample("ME").last()
        monthly_dd = r["sim"]["drawdown"].resample("ME").last()
        monthly_wealth = r["sim"]["wealth"].resample("ME").last()
        monthly_withdrawn = r["sim"]["withdrawn"].resample("ME").last()
        monthly_taken = r["sim"]["withdrawn_daily"].resample("MS").sum()
        rolling = _rolling_cagr(r["sim"]["value"], 1.0)
        series_out.append({
            "name": r["name"],
            "holdings": r["holdings"],
            "metrics": metrics,
            "income_metrics": income_metrics,
            "value_dates": [d.strftime("%Y-%m-%d") for d in monthly_value.index],
            "value_series": [float(x) for x in monthly_value.values],
            "drawdown_series": [float(x) for x in monthly_dd.values],
            "wealth_series": [float(x) for x in monthly_wealth.values],
            "withdrawn_series": [float(x) for x in monthly_withdrawn.values],
            "income_dates": [d.strftime("%Y-%m-%d") for d in monthly_income.index],
            "income_series": [float(x) for x in monthly_income.values],
            "income_taken_series": [float(x) for x in monthly_taken.values],
            "rolling_cagr_dates": [d.strftime("%Y-%m-%d") for d in rolling.index],
            "rolling_cagr_series": [float(x) for x in rolling.values],
        })

    bench_out = None
    if bench_sim is not None:
        bm = compute_metrics(bench_sim["value"], None, bench_sim["total_income"])
        bm_income = compute_income_metrics(bench_sim, initial)
        mv = bench_sim["value"].resample("ME").last()
        md = bench_sim["drawdown"].resample("ME").last()
        mw = bench_sim["wealth"].resample("ME").last()
        mwd = bench_sim["withdrawn"].resample("ME").last()
        bench_out = {
            "name": benchmark,
            "mode": bench_mode,
            "metrics": bm,
            "income_metrics": bm_income,
            "value_dates": [d.strftime("%Y-%m-%d") for d in mv.index],
            "value_series": [float(x) for x in mv.values],
            "drawdown_series": [float(x) for x in md.values],
            "wealth_series": [float(x) for x in mw.values],
            "withdrawn_series": [float(x) for x in mwd.values],
            "depleted": bench_sim.get("depleted"),
        }

    return {
        "valid": True,
        "start": start,
        "end": end,
        "initial": initial,
        "include_div": include_div,
        "reinvest_div": reinvest_div,
        "rebalance": rebalance,
        "tax_rate": tax_rate,
        "spend_income": spend_income,
        "withdraw_rate": withdraw_rate,
        "withdraw_inflation": withdraw_inflation,
        "equal_withdrawal": equal_withdrawal,
        "benchmark": benchmark,
        "benchmark_mode": bench_mode,
        "portfolios": series_out,
        "benchmark_series": bench_out,
        "coverage": ok,
    }
