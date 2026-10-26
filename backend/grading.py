"""Portfolio and ticker risk grading — ported from the original Flask app."""

import math
import numpy as np
import pandas as pd


# Daily observations a ratio needs before it means anything. This is the right
# guard for a 1Y grade, but it is more history than a short window can ever
# contain, so every helper below takes it as an argument: callers grading a
# user-picked window pass a floor scaled to that window (see
# min_observations_for_window) instead of blanking every card.
MIN_RATIO_OBSERVATIONS = 30

# Below this many observations the annualization factor (x sqrt(252), or
# ^(252/n)) amplifies a handful of days into a number nobody should act on, so
# the ratios stay unreported no matter how short a window the caller asked for.
ABSOLUTE_MIN_RATIO_OBSERVATIONS = 15


# These defaults are mirrored by src/utils/gradingPreferences.js. The browser
# sends the user's saved copy with grade requests; keeping a complete default
# here preserves the API for older clients and command-line/test callers.
DEFAULT_GRADING_SETTINGS = {
    "letterCutoffs": {
        "aPlus": 97, "a": 93, "aMinus": 90,
        "bPlus": 87, "b": 83, "bMinus": 80,
        "cPlus": 77, "c": 73, "cMinus": 70,
        "dPlus": 67, "d": 63, "dMinus": 60,
    },
    "holdingWeights": {
        "ulcerIndex": 25, "calmar": 20, "omega": 15, "sortino": 15,
        "sharpe": 10, "maxDrawdown": 10, "downCapture": 5,
    },
    "portfolioWeights": {
        "ulcerIndex": 20, "calmar": 20, "omega": 15, "sortino": 12,
        "sharpe": 8, "maxDrawdown": 10, "downCapture": 5, "captureRatio": 10,
        "diversification": 10, "diversificationRatio": 10, "navHealth": 10,
    },
    "higherBands": {
        "calmar": {"excellent": 1.5, "good": 1.0, "fair": 0.5, "poor": 0.2},
        "omega": {"excellent": 2.0, "good": 1.5, "fair": 1.2, "poor": 1.0},
        "sortino": {"excellent": 2.0, "good": 1.5, "fair": 1.0, "poor": 0.5},
        "sharpe": {"excellent": 1.5, "good": 1.0, "fair": 0.5, "poor": 0.0},
        "diversification": {"excellent": 20, "good": 12, "fair": 6, "poor": 3},
        # 1.0 is no benefit at all. With many holdings the ratio approaches
        # 1/sqrt(average pairwise correlation): 1.8 ~ 0.3, 1.25 ~ 0.65.
        "diversificationRatio": {"excellent": 1.8, "good": 1.5, "fair": 1.25, "poor": 1.1},
        # 1.0 is what any fund that just tracks the benchmark at some beta gets.
        "captureRatio": {"excellent": 1.2, "good": 1.05, "fair": 0.95, "poor": 0.85},
    },
    "lowerBands": {
        "ulcerIndex": {"excellent": 3, "good": 7, "fair": 12, "poor": 20},
        "maxDrawdown": {"excellent": 10, "good": 20, "fair": 30, "poor": 40},
        "downCapture": {"excellent": 80, "good": 90, "fair": 100, "poor": 120},
    },
    "navHealth": {"fullScore": 100, "penaltyPerDeclinePct": 2},
}


def _finite_setting(value, fallback, minimum=-1000.0, maximum=1000.0):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    if not math.isfinite(parsed):
        return float(fallback)
    return max(minimum, min(maximum, parsed))


def normalize_grading_settings(saved=None):
    """Return a bounded, complete risk-grading formula configuration."""
    saved = saved if isinstance(saved, dict) else {}
    out = {}
    for group in ("letterCutoffs", "holdingWeights", "portfolioWeights", "navHealth"):
        defaults = DEFAULT_GRADING_SETTINGS[group]
        incoming = saved.get(group) if isinstance(saved.get(group), dict) else {}
        maximum = 100.0 if group != "navHealth" else 1000.0
        out[group] = {
            key: _finite_setting(incoming.get(key), fallback, 0.0, maximum)
            for key, fallback in defaults.items()
        }

    for group in ("higherBands", "lowerBands"):
        incoming_group = saved.get(group) if isinstance(saved.get(group), dict) else {}
        out[group] = {}
        for metric, defaults in DEFAULT_GRADING_SETTINGS[group].items():
            incoming = incoming_group.get(metric) if isinstance(incoming_group.get(metric), dict) else {}
            out[group][metric] = {
                key: _finite_setting(incoming.get(key), fallback)
                for key, fallback in defaults.items()
            }

    # Invalid ordering falls back metric-by-metric instead of silently changing
    # the meaning of a band. The Settings page also prevents these saves.
    letter_order = ["aPlus", "a", "aMinus", "bPlus", "b", "bMinus",
                    "cPlus", "c", "cMinus", "dPlus", "d", "dMinus"]
    if any(out["letterCutoffs"][letter_order[i]] > out["letterCutoffs"][letter_order[i - 1]]
           for i in range(1, len(letter_order))):
        out["letterCutoffs"] = dict(DEFAULT_GRADING_SETTINGS["letterCutoffs"])
    for metric, bands in out["higherBands"].items():
        vals = [bands[k] for k in ("excellent", "good", "fair", "poor")]
        if any(vals[i] > vals[i - 1] for i in range(1, len(vals))):
            out["higherBands"][metric] = dict(DEFAULT_GRADING_SETTINGS["higherBands"][metric])
    for metric, bands in out["lowerBands"].items():
        vals = [bands[k] for k in ("excellent", "good", "fair", "poor")]
        if any(vals[i] < vals[i - 1] for i in range(1, len(vals))):
            out["lowerBands"][metric] = dict(DEFAULT_GRADING_SETTINGS["lowerBands"][metric])
    return out


def _band_tuple(settings, direction, metric):
    bands = settings[direction][metric]
    return tuple(bands[key] for key in ("excellent", "good", "fair", "poor"))


def min_observations_for_window(available_observations,
                                default=MIN_RATIO_OBSERVATIONS,
                                floor=ABSOLUTE_MIN_RATIO_OBSERVATIONS,
                                coverage=0.8):
    """Observation floor to use when grading a window of a known length.

    A 1-month window holds ~21 trading days, so the default 30-observation floor
    rejects it outright and the caller gets a blank grade instead of a one-month
    grade. Scale the floor down to what the window can actually supply, keeping
    `coverage` of it so a holding that missed a day or two still grades, and
    never going below `floor` — past that point the annualization turns a
    handful of days into noise, and reporting nothing is more honest.

    Returns None when even the floor is out of reach, which the caller should
    surface as "this window is too short to grade" rather than as an empty card.
    """
    if available_observations is None:
        return default
    try:
        available = int(available_observations)
    except (TypeError, ValueError):
        return default
    if available >= default:
        return default
    if available < floor:
        return None
    return max(floor, int(available * coverage))


# ── Metric functions ──────────────────────────────────────────────────────────

def _sharpe(close, risk_free_annual=0.05, min_obs=MIN_RATIO_OBSERVATIONS):
    try:
        if len(close) < min_obs:
            return None
        daily_ret = close.pct_change().dropna()
        if len(daily_ret) < min_obs:
            return None
        std = float(daily_ret.std())
        if std == 0 or np.isnan(std):
            return None
        daily_rf = risk_free_annual / 252
        excess = float(daily_ret.mean()) - daily_rf
        return round(excess / std * np.sqrt(252), 2)
    except Exception:
        return None


def _sortino(close, risk_free_annual=0.05, min_obs=MIN_RATIO_OBSERVATIONS):
    try:
        if len(close) < min_obs:
            return None
        daily_ret = close.pct_change().dropna()
        if len(daily_ret) < min_obs:
            return None
        daily_rf = risk_free_annual / 252
        # Target downside deviation: sqrt(mean of squared shortfalls below MAR),
        # averaged over ALL observations (not just the negative-return subset).
        # Using .std() on neg_ret is wrong — it divides by n_neg-1 and centers on
        # mean(neg_ret) instead of the MAR, roughly halving the denominator.
        shortfall = (daily_ret - daily_rf).clip(upper=0.0)
        down_dev = float(np.sqrt((shortfall ** 2).mean()))
        if down_dev == 0 or np.isnan(down_dev):
            return None
        excess = float(daily_ret.mean()) - daily_rf
        return round(excess / down_dev * np.sqrt(252), 2)
    except Exception:
        return None


def _calmar(close, min_obs=MIN_RATIO_OBSERVATIONS):
    try:
        if len(close) < min_obs:
            return None
        start = float(close.iloc[0])
        end = float(close.iloc[-1])
        if start <= 0 or end <= 0:
            return None
        # n observations → n-1 return periods. Previous code used len(close)
        # which understated the annualization by one period.
        n_periods = max(len(close) - 1, 1)
        ann_ret = (end / start) ** (252 / n_periods) - 1
        running_max = close.cummax()
        drawdowns = (close - running_max) / running_max
        mdd = float(drawdowns.min())
        if mdd == 0 or np.isnan(mdd):
            return None
        return round(float(ann_ret) / abs(mdd), 2)
    except Exception:
        return None


def _omega(daily_returns, threshold=0.0, min_obs=MIN_RATIO_OBSERVATIONS):
    try:
        if len(daily_returns) < min_obs:
            return None
        excess = daily_returns - threshold / 252
        gains = float(excess[excess > 0].sum())
        losses = abs(float(excess[excess <= 0].sum()))
        if losses == 0 or np.isnan(losses):
            return None
        return round(gains / losses, 2)
    except Exception:
        return None


def _ulcer_index(close, min_obs=MIN_RATIO_OBSERVATIONS):
    """Ulcer Index — measures depth and duration of drawdowns.
    Lower values indicate less downside risk."""
    try:
        if len(close) < min_obs:
            return None
        running_max = close.cummax()
        pct_drawdown = ((close - running_max) / running_max) * 100
        squared_avg = (pct_drawdown ** 2).mean()
        ui = float(np.sqrt(squared_avg))
        # Flat/dead price series produces UI==0, which would score 100 ("no
        # downside risk"). Treat as un-measurable instead of rewarding it.
        if ui == 0:
            try:
                daily_ret = close.pct_change().dropna()
                if len(daily_ret) == 0 or float(daily_ret.std()) == 0:
                    return None
            except Exception:
                return None
        return round(ui, 2)
    except Exception:
        return None


def _max_drawdown(close):
    try:
        running_max = close.cummax()
        drawdowns = (close - running_max) / running_max
        mdd = float(drawdowns.min())
        # Flat/dead series (no drawdowns observed in the window) should be
        # un-measurable, not a perfect 0% drawdown that scores 100.
        if mdd == 0:
            try:
                daily_ret = close.pct_change().dropna()
                if len(daily_ret) == 0 or float(daily_ret.std()) == 0:
                    return None
            except Exception:
                return None
        return mdd
    except Exception:
        return None


def _capture_ratios(ticker_returns, bench_returns, min_obs=MIN_RATIO_OBSERVATIONS):
    try:
        # Measure both sides over the same days. Unaligned, a holding younger
        # than the window was compared with the benchmark's mean over days it
        # did not trade, and a bar the benchmark lacks (a weekend crypto print)
        # made the boolean mask unalignable, which silently blanked the ratio.
        aligned = pd.concat([ticker_returns, bench_returns], axis=1, join="inner").dropna()
        if len(aligned) < min_obs:
            return None, None
        ticker_returns = aligned.iloc[:, 0]
        bench_returns = aligned.iloc[:, 1]
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


def _capture_ratio(up_capture, down_capture):
    """Upside capture divided by downside capture.

    Above 1 the portfolio kept more of the benchmark's gains than of its
    losses. Downside capture alone rewards a fund for simply capping its
    upside, as covered-call funds do; this asks whether the protection was
    worth what it gave up. Undefined when downside capture is zero or
    negative (the portfolio rose on the benchmark's down days).
    """
    if up_capture is None or down_capture is None or down_capture <= 0:
        return None
    return round(up_capture / down_capture, 2)


def _diversification_ratio(returns_df, weights, port_daily, min_obs=MIN_RATIO_OBSERVATIONS):
    """Weighted average holding volatility divided by portfolio volatility.

    1.0 means the holdings move together, so spreading money across them
    removed no risk; higher means they offset one another. Effective holdings
    counts positions and is blind to this: ten funds writing calls on the same
    index count as ten holdings but diversify like one. A zero-volatility
    position such as cash adds nothing to either side, so it earns no credit.
    """
    try:
        if len(returns_df) < min_obs:
            return None
        port_vol = float(port_daily.std())
        if not math.isfinite(port_vol) or port_vol <= 0:
            return None
        weighted_vol = float(np.nansum(np.asarray(weights, dtype=float) * returns_df.std().to_numpy(dtype=float)))
        if not math.isfinite(weighted_vol) or weighted_vol <= 0:
            return None
        return round(weighted_vol / port_vol, 2)
    except Exception:
        return None


# ── Scoring helpers ───────────────────────────────────────────────────────────

def _beta(asset_returns, bench_returns, min_obs=MIN_RATIO_OBSERVATIONS):
    try:
        aligned = pd.concat([asset_returns, bench_returns], axis=1).dropna()
        if len(aligned) < min_obs:
            return None
        aligned.columns = ["asset", "bench"]
        bench_var = float(aligned["bench"].var())
        if bench_var == 0 or np.isnan(bench_var):
            return None
        beta = float(aligned["asset"].cov(aligned["bench"]) / bench_var)
        if np.isnan(beta) or np.isinf(beta):
            return None
        return round(beta, 2)
    except Exception:
        return None


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
    # Past "poor" the score falls from 40 to 0 over a span of |poor|. Dividing
    # by poor itself flipped the sign when a user set a negative floor (Sharpe
    # poor = -0.5), so worse values scored higher, past 100 at Sharpe -2.
    return max(0.0, 40 * (1 - (poor - val) / abs(poor))) if poor != 0 else 0.0


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
    return max(0.0, 40 * (1 - (val - poor) / abs(poor))) if poor != 0 else 0.0


def letter_grade(score, grading_settings=None):
    return _letter_for_cutoffs(score, normalize_grading_settings(grading_settings)["letterCutoffs"])


def _letter_for_cutoffs(score, cuts):
    # Split out so grade_portfolio, which already holds normalized settings, can
    # skip re-normalizing them for every breakdown row (the target search grades
    # thousands of mixes).
    if score >= cuts["aPlus"]: return "A+"
    if score >= cuts["a"]: return "A"
    if score >= cuts["aMinus"]: return "A-"
    if score >= cuts["bPlus"]: return "B+"
    if score >= cuts["b"]: return "B"
    if score >= cuts["bMinus"]: return "B-"
    if score >= cuts["cPlus"]: return "C+"
    if score >= cuts["c"]: return "C"
    if score >= cuts["cMinus"]: return "C-"
    if score >= cuts["dPlus"]: return "D+"
    if score >= cuts["d"]: return "D"
    if score >= cuts["dMinus"]: return "D-"
    return "F"


# ── Per-ticker grading ────────────────────────────────────────────────────────

def _is_stale_or_dead(close, daily_ret, min_obs=MIN_RATIO_OBSERVATIONS):
    """Detect delisted / flat-lined / penny-stock series that would otherwise
    be rewarded for having zero volatility. Returns True if the series should
    be treated as un-gradeable junk."""
    try:
        if close is None or len(close) < 2:
            return True
        last_price = float(close.iloc[-1])
        # Penny / likely-delisted
        if last_price < 1.0:
            return True
        # Price collapsed >90% from peak and never recovered
        peak = float(close.max())
        if peak > 0 and last_price / peak < 0.1:
            return True
        if daily_ret is None or len(daily_ret) < min_obs:
            return True
        std = float(daily_ret.std())
        # No variance at all (flat-lined)
        if std == 0 or np.isnan(std):
            return True
        # Mostly-zero returns (stale quote feed)
        zero_frac = float((daily_ret == 0).sum()) / len(daily_ret)
        if zero_frac > 0.75:
            return True
        return False
    except Exception:
        return True


def ticker_score(close, daily_ret, bench_ret=None, min_obs=MIN_RATIO_OBSERVATIONS,
                 grading_settings=None):
    """Compute individual ticker risk score (0-100).
    Returns (score, sharpe, sortino, calmar, omega, mdd, down_capture, ulcer)."""
    # Guard: delisted / flat-lined / stale series must not score well just
    # because they have no measurable volatility.
    if _is_stale_or_dead(close, daily_ret, min_obs=min_obs):
        return 0.0, None, None, None, None, None, None, None

    sharpe_v = _safe(_sharpe(close, min_obs=min_obs))
    sortino_v = _safe(_sortino(close, min_obs=min_obs))
    calmar_v = _safe(_calmar(close, min_obs=min_obs))
    omega_v = _safe(_omega(daily_ret, min_obs=min_obs))
    mdd_v = _safe(_max_drawdown(close))
    ulcer_v = _safe(_ulcer_index(close, min_obs=min_obs))
    _, dc = _capture_ratios(daily_ret, bench_ret, min_obs=min_obs) if bench_ret is not None else (None, None)
    dc = _safe(dc)

    mdd_pct = mdd_v * 100 if mdd_v is not None else None
    settings = normalize_grading_settings(grading_settings)
    sub = {
        "ulcer_index":  _score_lower(ulcer_v, _band_tuple(settings, "lowerBands", "ulcerIndex")),
        "calmar":       _score_higher(calmar_v, _band_tuple(settings, "higherBands", "calmar")),
        "omega":        _score_higher(omega_v, _band_tuple(settings, "higherBands", "omega")),
        "sortino":      _score_higher(sortino_v, _band_tuple(settings, "higherBands", "sortino")),
        "sharpe":       _score_higher(sharpe_v, _band_tuple(settings, "higherBands", "sharpe")),
        "max_drawdown": _score_lower(abs(mdd_pct) if mdd_pct is not None else None, _band_tuple(settings, "lowerBands", "maxDrawdown")),
        "down_capture": _score_lower(dc, _band_tuple(settings, "lowerBands", "downCapture")),
    }
    weight_keys = {
        "ulcer_index": "ulcerIndex", "calmar": "calmar", "omega": "omega",
        "sortino": "sortino", "sharpe": "sharpe",
        "max_drawdown": "maxDrawdown", "down_capture": "downCapture",
    }
    gw = {key: settings["holdingWeights"][saved_key] for key, saved_key in weight_keys.items()}
    tw = ts = 0.0
    for k, w in gw.items():
        sc = sub.get(k)
        if sc is not None:
            tw += w
            ts += sc * w
    score = round(ts / tw, 1) if tw > 0 else 0.0
    return score, sharpe_v, sortino_v, calmar_v, omega_v, mdd_v, dc, ulcer_v


# ── Portfolio-level grading ───────────────────────────────────────────────────

def portfolio_returns_frame(close_df):
    """Daily returns for grade_portfolio from closes (one column per holding).

    Interior gaps are carried forward first. pandas 3 no longer pads inside
    pct_change, so a single missing bar made both the gap day and the day after
    NaN, and the fillna(0) then erased the whole move across the gap. Leading
    NaN (a holding that began trading inside the window) still becomes a zero
    return, the convention Dashboard, Growth and Dividend Analysis share. The
    first row is dropped: no close precedes it, so its zero is not a return.
    """
    return close_df.ffill().pct_change().iloc[1:].fillna(0)


def grade_portfolio(returns_df, weights_arr, bench_ret=None, min_obs=MIN_RATIO_OBSERVATIONS,
                    grading_settings=None, nav_erosion=None):
    """Compute composite portfolio grade.

    Args:
        returns_df: DataFrame of daily returns (columns = tickers)
        weights_arr: numpy array of weights (will be normalized)
        bench_ret: optional Series of benchmark daily returns
        min_obs: daily observations each ratio needs; lower it to grade a
            window shorter than the default (see min_observations_for_window)

    Returns:
        dict with sharpe, sortino, calmar, omega, max_drawdown,
        effective_n, top_weight, up/down_capture, and grade sub-dict.
    """
    settings = normalize_grading_settings(grading_settings)
    w = np.array(weights_arr, dtype=float)
    w_sum = w.sum()
    if w_sum > 0:
        w = w / w_sum

    port_daily = returns_df.dot(w)
    # Prepend 1.0 so that _sharpe/_sortino/_calmar can recover every daily
    # return via pct_change. Without this, cumprod starts at (1 + r_0) and
    # the first day's return is silently dropped by the pct_change() inside
    # those helpers.
    _cum_vals = (1.0 + port_daily).cumprod().values
    port_cum = pd.Series(np.concatenate([[1.0], _cum_vals]))

    port_mdd = _safe(_max_drawdown(port_cum))
    metrics = {
        "sharpe": _safe(_sharpe(port_cum, min_obs=min_obs)),
        "sortino": _safe(_sortino(port_cum, min_obs=min_obs)),
        "calmar": _safe(_calmar(port_cum, min_obs=min_obs)),
        "omega": _safe(_omega(port_daily, min_obs=min_obs)),
        "max_drawdown": port_mdd,
        "ulcer_index": _safe(_ulcer_index(port_cum, min_obs=min_obs)),
    }

    if bench_ret is not None:
        aligned = pd.concat([port_daily, bench_ret], axis=1).dropna()
        if len(aligned) > min_obs:
            aligned.columns = ["port", "bench"]
            uc, dc = _capture_ratios(aligned["port"], aligned["bench"], min_obs=min_obs)
            metrics["up_capture"] = _safe(uc)
            metrics["down_capture"] = _safe(dc)
            metrics["capture_ratio"] = _safe(_capture_ratio(metrics["up_capture"], metrics["down_capture"]))
            metrics["beta"] = _safe(_beta(aligned["port"], aligned["bench"], min_obs=min_obs))

    wt_sorted = sorted(w, reverse=True)
    metrics["top_weight"] = round(float(wt_sorted[0]) * 100, 2) if len(wt_sorted) else 0
    hhi = float(sum(wi ** 2 for wi in w))
    metrics["effective_n"] = round(1.0 / hhi, 1) if hhi > 0 else 0
    metrics["diversification_ratio"] = _safe(_diversification_ratio(returns_df, w, port_daily, min_obs=min_obs))

    mdd_pct = port_mdd * 100 if port_mdd is not None else None
    sub = {
        "ulcer_index":   _score_lower(metrics.get("ulcer_index"), _band_tuple(settings, "lowerBands", "ulcerIndex")),
        "calmar":        _score_higher(metrics.get("calmar"), _band_tuple(settings, "higherBands", "calmar")),
        "omega":         _score_higher(metrics.get("omega"), _band_tuple(settings, "higherBands", "omega")),
        "sortino":       _score_higher(metrics.get("sortino"), _band_tuple(settings, "higherBands", "sortino")),
        "sharpe":        _score_higher(metrics.get("sharpe"), _band_tuple(settings, "higherBands", "sharpe")),
        "max_drawdown":  _score_lower(abs(mdd_pct) if mdd_pct is not None else None, _band_tuple(settings, "lowerBands", "maxDrawdown")),
        "down_capture":  _score_lower(metrics.get("down_capture"), _band_tuple(settings, "lowerBands", "downCapture")),
        "capture_ratio": _score_higher(metrics.get("capture_ratio"), _band_tuple(settings, "higherBands", "captureRatio")),
        "diversification": _score_higher(metrics.get("effective_n"), _band_tuple(settings, "higherBands", "diversification")),
        "diversification_ratio": _score_higher(metrics.get("diversification_ratio"), _band_tuple(settings, "higherBands", "diversificationRatio")),
    }

    if nav_erosion is not None:
        decline_pct = max(0.0, -float(nav_erosion) * 100.0)
        nav_formula = settings["navHealth"]
        sub["nav_health"] = max(
            0.0,
            nav_formula["fullScore"] - decline_pct * nav_formula["penaltyPerDeclinePct"],
        )
        metrics["nav_erosion_avg_pct"] = round(float(nav_erosion) * 100, 2)

    weight_keys = {
        "ulcer_index": "ulcerIndex", "calmar": "calmar", "omega": "omega",
        "sortino": "sortino", "sharpe": "sharpe", "max_drawdown": "maxDrawdown",
        "down_capture": "downCapture", "capture_ratio": "captureRatio",
        "diversification": "diversification", "diversification_ratio": "diversificationRatio",
        "nav_health": "navHealth",
    }
    gw = {
        key: settings["portfolioWeights"][saved_key]
        for key, saved_key in weight_keys.items()
        if key in sub
    }
    label_map = {
        "ulcer_index": "Ulcer Index", "calmar": "Calmar Ratio",
        "omega": "Omega Ratio", "sortino": "Sortino Ratio",
        "sharpe": "Sharpe Ratio",
        "max_drawdown": "Max Drawdown", "down_capture": "Downside Capture",
        "capture_ratio": "Capture Ratio", "diversification": "Diversification",
        "diversification_ratio": "Diversification Ratio", "nav_health": "NAV Health",
    }

    total_w = total_s = 0.0
    breakdown = []
    for key, wt in gw.items():
        sc = sub.get(key)
        # A zero weight excludes the metric entirely, so it is not listed.
        if sc is not None and wt > 0:
            total_w += wt
            total_s += sc * wt
            breakdown.append({
                "category": label_map[key],
                "score": round(sc, 1),
                "weight": wt,
                "grade": _letter_for_cutoffs(sc, settings["letterCutoffs"]),
            })
    # Weights are relative, so report each one's share of the active total too.
    for item in breakdown:
        item["weight_pct"] = round(item["weight"] / total_w * 100, 1) if total_w > 0 else 0.0

    overall = round(total_s / total_w, 1) if total_w > 0 else 0.0
    # Unrounded, for searches that need to see changes smaller than 0.1.
    metrics["score_raw"] = total_s / total_w if total_w > 0 else 0.0
    metrics["grade"] = {
        "overall": _letter_for_cutoffs(overall, settings["letterCutoffs"]),
        "score": overall,
        "breakdown": breakdown,
        "settings": settings,
    }
    return metrics


# ── Reaching a target grade ──────────────────────────────────────────────────

# Grades a "what would it take" search can aim for, mapped to their cutoffs.
GRADE_TARGET_CUTOFF_KEYS = {
    "A+": "aPlus", "A": "a", "A-": "aMinus", "B+": "bPlus", "B": "b", "B-": "bMinus",
    "C+": "cPlus", "C": "c",
}


def search_weights_for_grade(returns_df, weights_arr, bench_ret, target_score, *,
                             can_increase=None, can_decrease=None, yields=None, max_pairs=3,
                             max_weight=0.25, min_obs=MIN_RATIO_OBSERVATIONS,
                             grading_settings=None, max_iterations=60, time_budget=10.0):
    """Re-weight the holdings already in a portfolio until its grade reaches target_score.

    Only weights change. Nothing that is not held (weight 0) is added, a holding
    with can_increase False may shrink but not grow, one with can_decrease False
    may not shrink, and no holding grows past max_weight. With yields given,
    money only moves into a holding that yields at least as much as the one it
    leaves, so the mix's estimated income cannot fall. Each step pairs the
    holdings that raise the score fastest with those that drag it most and moves
    the same amount across each pair (up to max_pairs pairs at once, or the
    single best pair when that does better). The step that reaches the target
    uses the smallest amount that does, so the result stays close to the current
    mix. The search stops when the target is reached ("reached"), no swap helps
    ("stuck"), or the iteration/time budget runs out ("budget").

    Returns None when nothing is held, else the final weights (fractions), their
    score and letter grade, the starting score, and whether the target was met.
    """
    import time

    settings = normalize_grading_settings(grading_settings)
    w = np.array(weights_arr, dtype=float)
    total = float(w.sum())
    if total <= 0:
        return None
    w = w / total
    held = w > 0
    growable = held.copy()
    if can_increase is not None:
        growable &= np.array(can_increase, dtype=bool)
    shrinkable = held.copy()
    if can_decrease is not None:
        shrinkable &= np.array(can_decrease, dtype=bool)
    pays = None if yields is None else np.array(yields, dtype=float)

    def grade(vec):
        pm = grade_portfolio(returns_df, vec, bench_ret, min_obs=min_obs, grading_settings=settings)
        return pm["score_raw"], pm["grade"]["score"]

    raw, shown = grade(w)
    start = shown
    deadline = time.monotonic() + time_budget
    iterations = 0
    probe = 0.01
    stop = "reached" if shown >= target_score else None
    while stop is None:
        if iterations >= max_iterations or time.monotonic() > deadline:
            stop = "budget"
            break
        iterations += 1
        # How fast the score moves when 1% of the portfolio shifts into each holding.
        slopes = {}
        for i in np.flatnonzero(held):
            mixed = (1 - probe) * w
            mixed[i] += probe
            slopes[i] = (grade(mixed)[0] - raw) / probe
        buyers = sorted((i for i in slopes if growable[i] and w[i] < max_weight - 1e-9),
                        key=lambda i: -slopes[i])
        sellers = sorted((j for j in slopes if shrinkable[j] and w[j] > 1e-9), key=lambda j: slopes[j])
        # Steepest buyer with the flattest seller it may draw from, next with
        # next, never reusing one.
        pairs, used = [], set()
        for i in buyers:
            if len(pairs) == max_pairs:
                break
            if i in used:
                continue
            for j in sellers:
                if slopes[j] >= slopes[i]:
                    break
                if j != i and j not in used and (pays is None or pays[i] >= pays[j]):
                    pairs.append((i, j, min(w[j], max_weight - w[i])))
                    used.update((i, j))
                    break
        best = None      # (raw, shown, weights): the biggest gain
        reaching = None  # ((moved, -raw), raw, shown, weights): the smallest move that reaches the target
        for batch in ([pairs] + ([pairs[:1]] if len(pairs) > 1 else [])) if pairs else []:
            most = max(limit for _, _, limit in batch)
            for step in sorted({a for a in (0.005, 0.01, 0.02, 0.04, 0.08) if a < most} | {most}):
                trial = w.copy()
                moved = 0.0
                for i, j, limit in batch:
                    amount = min(step, limit)
                    trial[i] += amount
                    trial[j] -= amount
                    moved += amount
                trial_raw, trial_shown = grade(trial)
                if trial_shown >= target_score:
                    key = (moved, -trial_raw)
                    if reaching is None or key < reaching[0]:
                        reaching = (key, trial_raw, trial_shown, trial)
                    break  # a bigger step of this same batch only moves more
                if trial_raw > raw + 1e-9 and (best is None or trial_raw > best[0]):
                    best = (trial_raw, trial_shown, trial)
        if reaching is not None:
            _, raw, shown, w = reaching
            stop = "reached"
        elif best is not None:
            raw, shown, w = best
        else:
            stop = "stuck"
    return {
        "weights": w,
        "score": shown,
        "grade": letter_grade(shown, settings),
        "start_score": start,
        "reached": shown >= target_score,
        "stopped": stop,
        "iterations": iterations,
    }


# Two plans must differ by at least this share of the portfolio, and by this
# share of the larger plan's own move, to both be offered.
_OPTION_MIN_DIFFERENCE = 0.0025
_OPTION_MIN_DIFFERENCE_SHARE = 0.10


def _changed_holdings(weights, start):
    return int((np.abs(weights - start) > 1e-10).sum())


def _near_repeat(a, b, start):
    """True when two plans differ by too little to offer both."""
    differ = float(np.abs(a - b).sum()) / 2
    moved = max(float(np.abs(a - start).sum()), float(np.abs(b - start).sum())) / 2
    return differ <= max(_OPTION_MIN_DIFFERENCE, _OPTION_MIN_DIFFERENCE_SHARE * moved)


def search_grade_options(returns_df, weights_arr, bench_ret, target_score, *,
                         can_increase=None, yields=None, max_options=5, total_time_budget=20.0,
                         **search_kwargs):
    """Up to max_options different re-weightings that each reach target_score.

    The first ("main") is search_weights_for_grade's own result. When it had to
    move money to reach the target, the search reruns with one extra rule each
    time, so every alternative reaches the grade a different way:

      "income"  money moves only into holdings that yield at least as much as
                the ones funding them, so estimated income cannot fall;
      "keep"    a holding the main plan trims is left as it is (the trim giving
                up the most income first, or the most dollars when none pays);
      "avoid"   a holding the main plan increases may not grow (largest first);
      "fewer"   one buyer/seller pair per step, kept only when it changes fewer
                holdings than the main plan.

    Alternatives that miss the target or nearly repeat an earlier option are
    dropped, and no new search starts after total_time_budget seconds. Each
    option is search_weights_for_grade's result plus "kind" and, for "keep" and
    "avoid", the "ticker" (returns_df column) the rule applies to. Returns []
    when nothing is held.
    """
    import time

    deadline = time.monotonic() + total_time_budget
    main = search_weights_for_grade(returns_df, weights_arr, bench_ret, target_score,
                                    can_increase=can_increase, **search_kwargs)
    if main is None:
        return []
    options = [{**main, "kind": "main", "ticker": None}]
    if not main["reached"] or main["start_score"] >= target_score:
        return options

    start = np.array(weights_arr, dtype=float)
    start = start / start.sum()
    n = len(start)
    names = list(returns_df.columns)
    growable = np.ones(n, dtype=bool) if can_increase is None else np.array(can_increase, dtype=bool)
    pays = np.zeros(n) if yields is None else np.array(yields, dtype=float)
    change = main["weights"] - start
    trimmed = np.flatnonzero(change < -1e-10)
    # What each trim gives up: income, or dollars when none of the trims pays.
    cost = -change * pays if (pays[trimmed] > 0).any() else -change
    trims = sorted(trimmed, key=lambda j: -cost[j])
    adds = sorted(np.flatnonzero(change > 1e-10), key=lambda i: -change[i])
    everyone = np.arange(n)

    candidates = []
    if (pays > 0).any():
        candidates.append(("income", None, {"yields": pays}))
    if trims:
        candidates.append(("keep", trims[0], {"can_decrease": everyone != trims[0]}))
    if adds:
        candidates.append(("avoid", adds[0], {"can_increase": growable & (everyone != adds[0])}))
    candidates.append(("fewer", None, {"max_pairs": 1}))
    if len(adds) > 1:
        candidates.append(("avoid", adds[1], {"can_increase": growable & (everyone != adds[1])}))
    if len(trims) > 1:
        candidates.append(("keep", trims[1], {"can_decrease": everyone != trims[1]}))

    per_search = search_kwargs.pop("time_budget", 10.0)
    for kind, index, rule in candidates:
        remaining = deadline - time.monotonic()
        if len(options) >= max_options or remaining <= 0:
            break
        found = search_weights_for_grade(
            returns_df, weights_arr, bench_ret, target_score,
            **{"can_increase": can_increase, **search_kwargs, **rule,
               "time_budget": min(per_search, remaining)})
        if not found["reached"]:
            continue
        if kind == "fewer" and _changed_holdings(found["weights"], start) >= _changed_holdings(main["weights"], start):
            continue
        if any(_near_repeat(found["weights"], o["weights"], start) for o in options):
            continue
        options.append({**found, "kind": kind, "ticker": None if index is None else names[index]})
    return options
