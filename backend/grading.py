"""Portfolio and ticker risk grading — ported from the original Flask app."""

import math
import numpy as np
import pandas as pd


# ── Metric functions ──────────────────────────────────────────────────────────

def _sharpe(close, risk_free_annual=0.05):
    try:
        if len(close) < 30:
            return None
        daily_ret = close.pct_change().dropna()
        if len(daily_ret) < 30:
            return None
        std = float(daily_ret.std())
        if std == 0 or np.isnan(std):
            return None
        daily_rf = risk_free_annual / 252
        excess = float(daily_ret.mean()) - daily_rf
        return round(excess / std * np.sqrt(252), 2)
    except Exception:
        return None


def _sortino(close, risk_free_annual=0.05):
    try:
        if len(close) < 30:
            return None
        daily_ret = close.pct_change().dropna()
        if len(daily_ret) < 30:
            return None
        daily_rf = risk_free_annual / 252
        neg_ret = daily_ret[daily_ret < 0]
        if len(neg_ret) == 0:
            return None
        down_std = float(neg_ret.std())
        if down_std == 0 or np.isnan(down_std):
            return None
        excess = float(daily_ret.mean()) - daily_rf
        return round(excess / down_std * np.sqrt(252), 2)
    except Exception:
        return None


def _calmar(close):
    try:
        if len(close) < 30:
            return None
        ann_ret = (close.iloc[-1] / close.iloc[0]) ** (252 / len(close)) - 1
        running_max = close.cummax()
        drawdowns = (close - running_max) / running_max
        mdd = float(drawdowns.min())
        if mdd == 0 or np.isnan(mdd):
            return None
        return round(float(ann_ret) / abs(mdd), 2)
    except Exception:
        return None


def _omega(daily_returns, threshold=0.0):
    try:
        if len(daily_returns) < 30:
            return None
        excess = daily_returns - threshold / 252
        gains = float(excess[excess > 0].sum())
        losses = abs(float(excess[excess <= 0].sum()))
        if losses == 0 or np.isnan(losses):
            return None
        return round(gains / losses, 2)
    except Exception:
        return None


def _max_drawdown(close):
    try:
        running_max = close.cummax()
        drawdowns = (close - running_max) / running_max
        return float(drawdowns.min())
    except Exception:
        return None


def _capture_ratios(ticker_returns, bench_returns):
    try:
        if len(ticker_returns) < 30:
            return None, None
        up_days = bench_returns > 0
        down_days = bench_returns < 0
        if up_days.sum() == 0 or down_days.sum() == 0:
            return None, None
        bench_up_mean = float(bench_returns[up_days].mean())
        bench_down_mean = float(bench_returns[down_days].mean())
        if bench_up_mean == 0 or bench_down_mean == 0:
            return None, None
        up_cap = round(float(ticker_returns[up_days].mean()) / bench_up_mean * 100, 1)
        down_cap = round(float(ticker_returns[down_days].mean()) / bench_down_mean * 100, 1)
        return up_cap, down_cap
    except Exception:
        return None, None


# ── Scoring helpers ───────────────────────────────────────────────────────────

def _safe(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _score_higher(val, thr):
    """Score a metric where higher is better."""
    if val is None:
        return None
    exc, good, fair, poor = thr
    if val >= exc:
        return 100.0
    if val >= good:
        return 80 + 20 * (val - good) / (exc - good)
    if val >= fair:
        return 60 + 20 * (val - fair) / (good - fair)
    if val >= poor:
        return 40 + 20 * (val - poor) / (fair - poor)
    return max(0.0, 40 * val / poor) if poor != 0 else 0.0


def _score_lower(val, thr):
    """Score a metric where lower is better."""
    if val is None:
        return None
    exc, good, fair, poor = thr
    if val <= exc:
        return 100.0
    if val <= good:
        return 80 + 20 * (good - val) / (good - exc)
    if val <= fair:
        return 60 + 20 * (fair - val) / (fair - good)
    if val <= poor:
        return 40 + 20 * (poor - val) / (poor - fair)
    return max(0.0, 40 * (1 - (val - poor) / poor)) if poor != 0 else 0.0


def letter_grade(score):
    if score >= 97: return "A+"
    if score >= 93: return "A"
    if score >= 90: return "A-"
    if score >= 87: return "B+"
    if score >= 83: return "B"
    if score >= 80: return "B-"
    if score >= 77: return "C+"
    if score >= 73: return "C"
    if score >= 70: return "C-"
    if score >= 67: return "D+"
    if score >= 63: return "D"
    if score >= 60: return "D-"
    return "F"


# ── Per-ticker grading ────────────────────────────────────────────────────────

def ticker_score(close, daily_ret, bench_ret=None):
    """Compute individual ticker risk score (0-100).
    Returns (score, sharpe, sortino, calmar, omega, mdd, down_capture)."""
    sharpe_v = _safe(_sharpe(close))
    sortino_v = _safe(_sortino(close))
    calmar_v = _safe(_calmar(close))
    omega_v = _safe(_omega(daily_ret))
    mdd_v = _safe(_max_drawdown(close))
    _, dc = _capture_ratios(daily_ret, bench_ret) if bench_ret is not None else (None, None)
    dc = _safe(dc)

    mdd_pct = mdd_v * 100 if mdd_v is not None else None
    sub = {
        "sharpe":       _score_higher(sharpe_v,  (1.5, 1.0, 0.5, 0.0)),
        "sortino":      _score_higher(sortino_v, (2.0, 1.5, 1.0, 0.5)),
        "calmar":       _score_higher(calmar_v,  (1.5, 1.0, 0.5, 0.2)),
        "omega":        _score_higher(omega_v,   (2.0, 1.5, 1.2, 1.0)),
        "max_drawdown": _score_lower(abs(mdd_pct) if mdd_pct is not None else None, (10, 20, 30, 40)),
        "down_capture": _score_lower(dc, (80, 90, 100, 120)),
    }
    gw = {"sharpe": 30, "sortino": 20, "calmar": 15,
          "omega": 15, "max_drawdown": 15, "down_capture": 5}
    tw = ts = 0.0
    for k, w in gw.items():
        sc = sub.get(k)
        if sc is not None:
            tw += w
            ts += sc * w
    score = round(ts / tw, 1) if tw > 0 else 0.0
    return score, sharpe_v, sortino_v, calmar_v, omega_v, mdd_v, dc


# ── Portfolio-level grading ───────────────────────────────────────────────────

def grade_portfolio(returns_df, weights_arr, bench_ret=None):
    """Compute composite portfolio grade.

    Args:
        returns_df: DataFrame of daily returns (columns = tickers)
        weights_arr: numpy array of weights (will be normalized)
        bench_ret: optional Series of benchmark daily returns

    Returns:
        dict with sharpe, sortino, calmar, omega, max_drawdown,
        effective_n, top_weight, up/down_capture, and grade sub-dict.
    """
    w = np.array(weights_arr, dtype=float)
    w_sum = w.sum()
    if w_sum > 0:
        w = w / w_sum

    port_daily = returns_df.dot(w)
    port_cum = (1 + port_daily).cumprod()

    port_mdd = _safe(_max_drawdown(port_cum))
    metrics = {
        "sharpe": _safe(_sharpe(port_cum)),
        "sortino": _safe(_sortino(port_cum)),
        "calmar": _safe(_calmar(port_cum)),
        "omega": _safe(_omega(port_daily)),
        "max_drawdown": port_mdd,
    }

    if bench_ret is not None:
        aligned = pd.concat([port_daily, bench_ret], axis=1).dropna()
        if len(aligned) > 30:
            aligned.columns = ["port", "bench"]
            uc, dc = _capture_ratios(aligned["port"], aligned["bench"])
            metrics["up_capture"] = _safe(uc)
            metrics["down_capture"] = _safe(dc)

    wt_sorted = sorted(w, reverse=True)
    metrics["top_weight"] = round(float(wt_sorted[0]) * 100, 2) if len(wt_sorted) else 0
    hhi = float(sum(wi ** 2 for wi in w))
    metrics["effective_n"] = round(1.0 / hhi, 1) if hhi > 0 else 0

    mdd_pct = port_mdd * 100 if port_mdd is not None else None
    sub = {
        "sharpe":        _score_higher(metrics.get("sharpe"),        (1.5, 1.0, 0.5, 0.0)),
        "sortino":       _score_higher(metrics.get("sortino"),       (2.0, 1.5, 1.0, 0.5)),
        "calmar":        _score_higher(metrics.get("calmar"),        (1.5, 1.0, 0.5, 0.2)),
        "omega":         _score_higher(metrics.get("omega"),         (2.0, 1.5, 1.2, 1.0)),
        "max_drawdown":  _score_lower(abs(mdd_pct) if mdd_pct is not None else None, (10, 20, 30, 40)),
        "down_capture":  _score_lower(metrics.get("down_capture"),  (80, 90, 100, 120)),
        "diversification": _score_higher(metrics.get("effective_n"), (20, 12, 6, 3)),
    }

    gw = {"sharpe": 25, "sortino": 15, "calmar": 10, "omega": 10,
          "max_drawdown": 20, "down_capture": 10, "diversification": 10}
    label_map = {
        "sharpe": "Sharpe Ratio", "sortino": "Sortino Ratio",
        "calmar": "Calmar Ratio", "omega": "Omega Ratio",
        "max_drawdown": "Max Drawdown", "down_capture": "Downside Capture",
        "diversification": "Diversification",
    }

    total_w = total_s = 0.0
    breakdown = []
    for key, wt in gw.items():
        sc = sub.get(key)
        if sc is not None:
            total_w += wt
            total_s += sc * wt
            breakdown.append({
                "category": label_map[key],
                "score": round(sc, 1),
                "weight": wt,
                "grade": letter_grade(sc),
            })

    overall = round(total_s / total_w, 1) if total_w > 0 else 0.0
    metrics["grade"] = {
        "overall": letter_grade(overall),
        "score": overall,
        "breakdown": breakdown,
    }
    return metrics
