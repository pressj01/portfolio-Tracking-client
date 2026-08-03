"""Market-regime dashboard for choosing among the app's option scanners.

The endpoint intentionally ranks *scanner types*, not individual contracts.  A
scanner remains responsible for liquidity, strikes, expirations, probability,
and price.  This module answers the upstream question: given the trend in SPY,
QQQ, or IWM and the current market-implied economic backdrop, which scanner is
the best place to look first?

Endpoint:
  GET /api/options/dashboard
"""

from __future__ import annotations

import math
import threading
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf
from flask import jsonify, request


MARKETS = ("SPY", "QQQ", "IWM")
MACRO_SYMBOLS = ("^TNX", "^IRX", "HYG", "LQD", "XLY", "XLP", "XLI", "TIP", "IEF", "^VIX")
ALL_SYMBOLS = MARKETS + MACRO_SYMBOLS

TIMEFRAMES = {
    "daily": {"label": "Daily", "rule": None, "annualization": 252, "return_bars": 20, "return_label": "20-day return"},
    "weekly": {"label": "Weekly", "rule": "W-FRI", "annualization": 52, "return_bars": 13, "return_label": "13-week return"},
    "monthly": {"label": "Monthly", "rule": "ME", "annualization": 12, "return_bars": 6, "return_label": "6-month return"},
}

STRATEGIES = (
    {
        "key": "cash_secured_put", "name": "Cash-Secured Put", "scanner": "Put Selling Scanner",
        "route": "/put-selling-scanner", "stance": "Bullish pullback", "risk": "Undefined downside",
        "trend_range": (15, 65), "macro_range": (-5, 100), "volatility": "high",
        "thesis": "Look for controlled pullbacks inside an intact market uptrend, with rich put premium.",
    },
    {
        "key": "bull_put_spread", "name": "Bull Put Credit Spread", "scanner": "Bull Put Spread Scanner",
        "route": "/bull-put-spread-scanner", "stance": "Neutral to bullish", "risk": "Defined risk",
        "trend_range": (10, 70), "macro_range": (-15, 100), "volatility": "high",
        "thesis": "Sell downside premium when the broader trend is constructive and risk can be capped.",
    },
    {
        "key": "covered_call", "name": "Covered Call", "scanner": "Covered Call Scanner",
        "route": "/covered-call-scanner", "stance": "Stalling bullish / sideways", "risk": "Stock downside",
        "trend_range": (0, 45), "macro_range": (-25, 75), "volatility": "high",
        "thesis": "Best when an advance is intact but cooling and call premium is rich enough to sell.",
    },
    {
        "key": "bear_put_spread", "name": "Bear Put Debit Spread", "scanner": "Bear Put Spread Scanner",
        "route": "/bear-put-spread-scanner", "stance": "Bearish breakdown", "risk": "Defined debit",
        "trend_range": (-75, -15), "macro_range": (-100, 15), "volatility": "low",
        "thesis": "Buy defined-risk downside before a breakdown becomes deeply oversold or volatility becomes extreme.",
    },
    {
        "key": "bear_call_spread", "name": "Bear Call Credit Spread", "scanner": "Bear Call Spread Scanner",
        "route": "/bear-call-spread-scanner", "stance": "Bearish / rejected rally", "risk": "Defined risk",
        "trend_range": (-65, -5), "macro_range": (-100, 25), "volatility": "high",
        "thesis": "Sell upside premium after a failed rally when the market is below overhead resistance.",
    },
    {
        "key": "iron_condor", "name": "Iron Condor", "scanner": "Iron Condor Scanner",
        "route": "/iron-condor-scanner", "stance": "Range-bound", "risk": "Defined two-sided risk",
        "trend_range": (-15, 15), "macro_range": (-30, 30), "volatility": "high",
        "thesis": "Sell both tails only when trend strength is low and implied volatility pays for the range risk.",
    },
    {
        "key": "iron_butterfly", "name": "Iron Butterfly", "scanner": "Iron Butterfly Scanner",
        "route": "/iron-butterfly-scanner", "stance": "Pinned / very neutral", "risk": "Defined two-sided risk",
        "trend_range": (-10, 10), "macro_range": (-25, 25), "volatility": "high",
        "thesis": "A narrow neutral thesis that needs price to stay near the body and premium to be elevated.",
    },
    {
        "key": "unbalanced_put_condor", "name": "Unbalanced Put Condor", "scanner": "Unbalanced Put Condor Scanner",
        "route": "/unbalanced-put-condor-scanner", "stance": "Neutral with downside shaping", "risk": "Defined multi-leg risk",
        "trend_range": (-15, 30), "macro_range": (-45, 35), "volatility": "medium",
        "thesis": "A long-dated, adjustable structure for a mostly neutral market with deliberate downside geometry.",
    },
    {
        "key": "unbalanced_butterfly", "name": "STT Unbalanced Butterfly", "scanner": "Unbalanced Butterfly Scanner",
        "route": "/unbalanced-butterfly-scanner", "stance": "Neutral / selectable bias", "risk": "Defined multi-leg risk",
        "trend_range": (-25, 25), "macro_range": (-50, 35), "volatility": "medium",
        "thesis": "Use the scanner's bias control when the market is not strongly directional and the structure fits the T+0 rules.",
    },
    {
        "key": "double_hedge_butterfly", "name": "Double-Hedge Put Butterfly", "scanner": "Double-Hedge Put Butterfly Scanner",
        "route": "/double-hedge-put-butterfly-scanner", "stance": "Neutral / downside-aware", "risk": "Defined multi-leg risk",
        "trend_range": (-35, 15), "macro_range": (-100, 15), "volatility": "medium",
        "thesis": "A downside-aware advanced structure; its separate warning monitors still must confirm the entry.",
    },
    {
        "key": "road_trip_butterfly", "name": "Road Trip Butterfly", "scanner": "Road Trip Butterfly Scanner",
        "route": "/road-trip-butterfly-scanner", "stance": "Neutral to modestly bullish", "risk": "Defined debit",
        "trend_range": (-5, 35), "macro_range": (-35, 50), "volatility": "low",
        "thesis": "A low-debit broken-wing structure for a quiet to modestly constructive long-dated outlook.",
    },
    {
        "key": "sixty_forty_twenty", "name": "60/40/20 Put Butterfly", "scanner": "60/40/20 Fly Scanner",
        "route": "/sixty-forty-twenty-fly-scanner", "stance": "Delta-neutral", "risk": "Defined debit",
        "trend_range": (-15, 15), "macro_range": (-35, 35), "volatility": "medium",
        "thesis": "A delta-selected neutral fly whose delta/theta management rules matter more than a weak directional opinion.",
    },
)

_CACHE = {"data": None, "timestamp": 0.0, "ttl": 900}
_CACHE_LOCK = threading.Lock()


def _finite(value, digits=4):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(number, digits)


def _last(series):
    clean = pd.to_numeric(series, errors="coerce").dropna()
    return float(clean.iloc[-1]) if len(clean) else None


def _pct_change(series, bars):
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if len(clean) <= bars or float(clean.iloc[-bars - 1]) == 0:
        return None
    return float((clean.iloc[-1] / clean.iloc[-bars - 1] - 1) * 100)


def _symbol_frame(raw, symbol):
    """Return one symbol's OHLCV frame from either yfinance column layout."""
    if raw is None or raw.empty:
        return pd.DataFrame()
    if not isinstance(raw.columns, pd.MultiIndex):
        if symbol != MARKETS[0] and len(ALL_SYMBOLS) > 1:
            return pd.DataFrame()
        return raw.copy()

    level0 = set(raw.columns.get_level_values(0))
    level1 = set(raw.columns.get_level_values(1))
    try:
        frame = raw.xs(symbol, axis=1, level=1 if symbol in level1 else 0, drop_level=True)
    except (KeyError, ValueError):
        return pd.DataFrame()
    if isinstance(frame, pd.Series):
        frame = frame.to_frame("Close")
    return frame.copy()


def _resample_ohlc(frame, rule):
    columns = {str(column).title(): column for column in frame.columns}
    close_col = columns.get("Close")
    if close_col is None:
        return pd.DataFrame()
    normalized = pd.DataFrame(index=pd.to_datetime(frame.index))
    normalized["Close"] = pd.to_numeric(frame[close_col], errors="coerce")
    normalized["Open"] = pd.to_numeric(frame[columns.get("Open", close_col)], errors="coerce")
    normalized["High"] = pd.to_numeric(frame[columns.get("High", close_col)], errors="coerce")
    normalized["Low"] = pd.to_numeric(frame[columns.get("Low", close_col)], errors="coerce")
    normalized = normalized[~normalized.index.duplicated(keep="last")].sort_index().dropna(subset=["Close"])
    if not rule:
        return normalized
    try:
        return normalized.resample(rule).agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna(subset=["Close"])
    except ValueError:
        # Pandas < 2.2 uses M where newer versions prefer ME.
        fallback = "M" if rule == "ME" else rule
        return normalized.resample(fallback).agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna(subset=["Close"])


def _rsi(close, length=14):
    change = close.diff()
    gain = change.clip(lower=0).ewm(alpha=1 / length, adjust=False, min_periods=length).mean()
    loss = (-change.clip(upper=0)).ewm(alpha=1 / length, adjust=False, min_periods=length).mean()
    rs = gain / loss.replace(0, np.nan)
    value = 100 - (100 / (1 + rs))
    return value.where(loss != 0, 100)


def _adx(frame, length=14):
    high, low, close = frame["High"], frame["Low"], frame["Close"]
    up = high.diff()
    down = -low.diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=frame.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=frame.index)
    true_range = pd.concat([(high - low).abs(), (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    atr = true_range.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / length, adjust=False, min_periods=length).mean() / atr.replace(0, np.nan)
    minus_di = 100 * minus_dm.ewm(alpha=1 / length, adjust=False, min_periods=length).mean() / atr.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx = dx.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()
    return adx, plus_di, minus_di, atr


def _point(name, value, points, detail, unit="number"):
    return {"name": name, "value": _finite(value), "unit": unit, "points": points, "detail": detail}


def _trend_analysis(frame, timeframe_key):
    config = TIMEFRAMES[timeframe_key]
    last_observation = pd.to_datetime(frame.index[-1]).date().isoformat()
    bars = _resample_ohlc(frame, config["rule"])
    if len(bars) < 40:
        raise ValueError(f"Only {len(bars)} {timeframe_key} bars were available")

    close = bars["Close"]
    ema20 = close.ewm(span=20, adjust=False, min_periods=20).mean()
    ema50 = close.ewm(span=50, adjust=False, min_periods=40).mean()
    ema200 = close.ewm(span=200, adjust=False, min_periods=min(120, len(close))).mean()
    macd = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    macd_signal = macd.ewm(span=9, adjust=False).mean()
    macd_hist = macd - macd_signal
    rsi = _rsi(close)
    median = (bars["High"] + bars["Low"]) / 2
    awesome = median.rolling(5).mean() - median.rolling(34).mean()
    adx, plus_di, minus_di, atr = _adx(bars)
    returns = close.pct_change()
    rolling_vol = returns.rolling(20).std() * math.sqrt(config["annualization"]) * 100

    price = _last(close)
    values = {
        "ema_20": _last(ema20), "ema_50": _last(ema50), "ema_200": _last(ema200),
        "macd": _last(macd), "macd_signal": _last(macd_signal), "macd_histogram": _last(macd_hist),
        "rsi_14": _last(rsi), "awesome_oscillator": _last(awesome), "adx_14": _last(adx),
        "plus_di": _last(plus_di), "minus_di": _last(minus_di),
        "atr_14": _last(atr), "realized_volatility": _last(rolling_vol),
    }
    points = []

    def comparison(name, left, right, detail_up, detail_down):
        if left is None or right is None:
            points.append(_point(name, left, 0, "Not enough history for this comparison", "price"))
            return 0
        score = 1 if left > right else -1
        points.append(_point(name, left, score, detail_up if score > 0 else detail_down, "price"))
        return score

    raw_score = 0
    raw_score += comparison("Price vs EMA 20", price, values["ema_20"], "Price is above the fast trend", "Price is below the fast trend")
    raw_score += comparison("EMA 20 vs EMA 50", values["ema_20"], values["ema_50"], "Fast trend leads the intermediate trend", "Fast trend trails the intermediate trend")
    raw_score += comparison("EMA 50 vs EMA 200", values["ema_50"], values["ema_200"], "Intermediate trend leads the long trend", "Intermediate trend trails the long trend")

    hist = values["macd_histogram"]
    macd_points = 1 if hist is not None and hist > 0 else (-1 if hist is not None and hist < 0 else 0)
    raw_score += macd_points
    points.append(_point("MACD histogram", hist, macd_points, "Momentum is accelerating up" if macd_points > 0 else ("Momentum is accelerating down" if macd_points < 0 else "Momentum is flat")))

    rsi_value = values["rsi_14"]
    rsi_points = 1 if rsi_value is not None and rsi_value >= 55 else (-1 if rsi_value is not None and rsi_value <= 45 else 0)
    raw_score += rsi_points
    points.append(_point("RSI 14", rsi_value, rsi_points, "Bullish momentum zone" if rsi_points > 0 else ("Bearish momentum zone" if rsi_points < 0 else "Neutral momentum zone"), "index"))

    ao_value = values["awesome_oscillator"]
    ao_points = 1 if ao_value is not None and ao_value > 0 else (-1 if ao_value is not None and ao_value < 0 else 0)
    raw_score += ao_points
    points.append(_point("Awesome Oscillator", ao_value, ao_points, "Short momentum exceeds long momentum" if ao_points > 0 else ("Short momentum trails long momentum" if ao_points < 0 else "Momentum is balanced")))

    period_return = _pct_change(close, config["return_bars"])
    return_points = 1 if period_return is not None and period_return > 0 else (-1 if period_return is not None and period_return < 0 else 0)
    raw_score += return_points
    points.append(_point(config["return_label"], period_return, return_points, "Trailing return is positive" if return_points > 0 else ("Trailing return is negative" if return_points < 0 else "Trailing return is flat"), "percent"))

    adx_value, pdi, mdi = values["adx_14"], values["plus_di"], values["minus_di"]
    adx_points = 0
    if adx_value is not None and adx_value >= 20 and pdi is not None and mdi is not None:
        adx_points = 1 if pdi > mdi else -1
    raw_score += adx_points
    points.append(_point("ADX 14 direction", adx_value, adx_points, "Strong bullish directional trend" if adx_points > 0 else ("Strong bearish directional trend" if adx_points < 0 else "Weak or non-directional trend"), "index"))

    score = int(round(raw_score / 8 * 100))
    if score >= 50:
        label, direction = "Strong bullish", "bullish"
    elif score >= 20:
        label, direction = "Bullish", "bullish"
    elif score <= -50:
        label, direction = "Strong bearish", "bearish"
    elif score <= -20:
        label, direction = "Bearish", "bearish"
    else:
        label, direction = "Neutral / mixed", "neutral"

    vol_clean = rolling_vol.dropna()
    volatility_percentile = None
    if len(vol_clean):
        comparison_window = vol_clean.tail(min(len(vol_clean), max(60, config["annualization"] * 2)))
        volatility_percentile = float((comparison_window <= comparison_window.iloc[-1]).mean() * 100)

    return {
        # W-FRI and month-end resampling label an in-progress bar with its
        # future period end.  The value itself only contains observations
        # through the latest market date, so expose that actual date instead.
        "as_of": last_observation, "bar_count": len(bars), "price": _finite(price, 2),
        "score": score, "label": label, "direction": direction,
        "confidence": min(100, int(abs(score) + max(0, (adx_value or 0) - 15))),
        "return_value": _finite(period_return, 2), "return_label": config["return_label"],
        "volatility_percentile": _finite(volatility_percentile, 1),
        "indicators": {key: _finite(value, 4) for key, value in values.items()},
        "components": points,
    }


def _ratio_series(frames, numerator, denominator):
    left = frames.get(numerator, pd.DataFrame()).get("Close", pd.Series(dtype=float))
    right = frames.get(denominator, pd.DataFrame()).get("Close", pd.Series(dtype=float))
    return pd.to_numeric(left, errors="coerce") / pd.to_numeric(right, errors="coerce").replace(0, np.nan)


def _macro_evidence(key, label, value, unit, change, signal, weight, rationale):
    direction = 1 if signal == "positive" else (-1 if signal == "negative" else 0)
    return {
        "key": key, "label": label, "value": _finite(value), "unit": unit,
        "change_3m": _finite(change, 2), "signal": signal,
        "contribution": direction * weight, "rationale": rationale,
    }


def _economic_analysis(frames):
    evidence = []

    ten_year = _last(frames.get("^TNX", pd.DataFrame()).get("Close", pd.Series(dtype=float)))
    three_month = _last(frames.get("^IRX", pd.DataFrame()).get("Close", pd.Series(dtype=float)))
    curve = (ten_year - three_month) if ten_year is not None and three_month is not None else None
    curve_signal = "positive" if curve is not None and curve >= 0.25 else ("negative" if curve is not None and curve <= -0.25 else "neutral")
    curve_text = "A positively sloped curve supports future growth" if curve_signal == "positive" else ("An inverted curve is a slowdown warning" if curve_signal == "negative" else "The curve is near flat and gives a mixed signal")
    evidence.append(_macro_evidence("yield_curve", "10Y - 3M yield curve", curve, "percentage points", None, curve_signal, 25, curve_text))

    credit = _ratio_series(frames, "HYG", "LQD")
    credit_change = _pct_change(credit, 63)
    credit_signal = "positive" if credit_change is not None and credit_change >= 1 else ("negative" if credit_change is not None and credit_change <= -1 else "neutral")
    evidence.append(_macro_evidence("credit", "High-yield / quality credit", _last(credit), "ratio", credit_change, credit_signal, 20, "Rising risk credit shows easier financial conditions" if credit_signal == "positive" else ("Falling risk credit shows tightening financial conditions" if credit_signal == "negative" else "Credit appetite is broadly stable")))

    consumer = _ratio_series(frames, "XLY", "XLP")
    consumer_change = _pct_change(consumer, 63)
    consumer_signal = "positive" if consumer_change is not None and consumer_change >= 2 else ("negative" if consumer_change is not None and consumer_change <= -2 else "neutral")
    evidence.append(_macro_evidence("consumer", "Discretionary / staples", _last(consumer), "ratio", consumer_change, consumer_signal, 15, "Consumers are favoring cyclical spending" if consumer_signal == "positive" else ("Defensive consumer leadership signals caution" if consumer_signal == "negative" else "Consumer leadership is mixed")))

    industrials = frames.get("XLI", pd.DataFrame()).get("Close", pd.Series(dtype=float))
    industrial_change = _pct_change(industrials, 63)
    industrial_ema = _last(pd.to_numeric(industrials, errors="coerce").ewm(span=200, adjust=False).mean())
    industrial_value = _last(industrials)
    industrial_signal = "positive" if industrial_value is not None and industrial_ema is not None and industrial_value > industrial_ema and (industrial_change or 0) > 0 else ("negative" if industrial_value is not None and industrial_ema is not None and industrial_value < industrial_ema and (industrial_change or 0) < 0 else "neutral")
    evidence.append(_macro_evidence("industrials", "Industrials trend", industrial_value, "price", industrial_change, industrial_signal, 15, "Industrials confirm expansion" if industrial_signal == "positive" else ("Industrials confirm slowing activity" if industrial_signal == "negative" else "Industrials are not confirming a clear cycle")))

    inflation = _ratio_series(frames, "TIP", "IEF")
    inflation_change = _pct_change(inflation, 63)
    inflation_signal = "negative" if inflation_change is not None and inflation_change >= 2 else ("positive" if inflation_change is not None and inflation_change <= -2 else "neutral")
    evidence.append(_macro_evidence("inflation", "Inflation pressure proxy", _last(inflation), "ratio", inflation_change, inflation_signal, 10, "Cooling inflation pressure is supportive" if inflation_signal == "positive" else ("Rising inflation pressure can restrict policy" if inflation_signal == "negative" else "Inflation pressure is stable")))

    vix = frames.get("^VIX", pd.DataFrame()).get("Close", pd.Series(dtype=float))
    vix_value = _last(vix)
    vix_change = _pct_change(vix, 63)
    vix_signal = "positive" if vix_value is not None and vix_value < 18 else ("negative" if vix_value is not None and vix_value > 25 else "neutral")
    evidence.append(_macro_evidence("vix", "VIX stress gauge", vix_value, "index", vix_change, vix_signal, 15, "Low volatility supports risk appetite" if vix_signal == "positive" else ("High volatility signals financial stress" if vix_signal == "negative" else "Volatility is in a normal caution range")))

    usable = [item for item in evidence if item["value"] is not None]
    score = int(sum(item["contribution"] for item in usable))
    if score >= 40:
        outlook, recession_risk = "Expansion likely", "Low"
        prediction = "Market-based leading indicators favor continued economic expansion and a risk-on backdrop."
    elif score >= 15:
        outlook, recession_risk = "Moderate expansion / soft landing", "Low to moderate"
        prediction = "The best current read is slower but still positive growth, with no broad stress confirmation."
    elif score > -15:
        outlook, recession_risk = "Mixed / slowing", "Moderate"
        prediction = "Leading indicators disagree, so the economy is most likely slowing without a confirmed contraction signal."
    elif score > -40:
        outlook, recession_risk = "Slowdown risk", "Elevated"
        prediction = "Defensive leadership and tighter conditions point to below-trend growth and elevated slowdown risk."
    else:
        outlook, recession_risk = "Contraction risk", "High"
        prediction = "Several market-based leading indicators are simultaneously warning of contraction and financial stress."

    return {
        "score": score, "outlook": outlook, "recession_risk": recession_risk,
        "prediction": prediction, "evidence": evidence,
        "status": "current" if len(usable) == len(evidence) else "partial",
        "methodology": "Market-implied proxy model; not an official GDP forecast. Uses the 10Y-3M curve, credit appetite, consumer cyclicality, industrials, inflation pressure, and VIX.",
    }


def _interval_fit(value, bounds):
    lower, upper = bounds
    if lower <= value <= upper:
        midpoint = (lower + upper) / 2
        half_width = max(10, (upper - lower) / 2)
        return max(82, 100 - abs(value - midpoint) / half_width * 18)
    distance = lower - value if value < lower else value - upper
    return max(0, 82 - distance * 1.6)


def _volatility_fit(percentile, preference):
    value = 50 if percentile is None else float(percentile)
    if preference == "high":
        return max(0, min(100, 25 + value * 0.75))
    if preference == "low":
        return max(0, min(100, 100 - value * 0.85))
    return max(35, 100 - abs(value - 50) * 1.3)


def _category(score):
    if score >= 78:
        return "Ideal"
    if score >= 65:
        return "Favorable"
    if score >= 50:
        return "Selective"
    return "Avoid"


def _recommendations(timeframe, market, trend, economy):
    rows = []
    for strategy in STRATEGIES:
        technical_fit = _interval_fit(trend["score"], strategy["trend_range"])
        macro_fit = _interval_fit(economy["score"], strategy["macro_range"])
        volatility_fit = _volatility_fit(trend.get("volatility_percentile"), strategy["volatility"])

        # Neutral short-premium structures require an actually weak trend. ADX
        # prevents a zero-ish composite score from hiding a violent transition.
        adx = trend["indicators"].get("adx_14") or 0
        if strategy["key"] in {"iron_condor", "iron_butterfly"} and adx >= 25:
            technical_fit = max(0, technical_fit - min(35, (adx - 20) * 2))

        total = round(technical_fit * 0.55 + macro_fit * 0.25 + volatility_fit * 0.20)
        reasons = [
            f"{market} {timeframe} trend is {trend['label'].lower()} ({trend['score']:+d})",
            f"Economy: {economy['outlook']} ({economy['score']:+d})",
            f"Realized volatility is at the {trend.get('volatility_percentile') or 0:.0f}th percentile",
        ]
        cautions = []
        if strategy["risk"] in {"Undefined downside", "Stock downside"} and economy["score"] < 0:
            cautions.append("Macro risk argues for smaller size or a defined-risk alternative")
        if strategy["key"] in {"iron_condor", "iron_butterfly"} and adx >= 25:
            cautions.append(f"ADX {adx:.1f} shows trend strength that can threaten a neutral trade")
        if strategy["volatility"] == "high" and (trend.get("volatility_percentile") or 50) < 35:
            cautions.append("Premium may be too cheap for a short-volatility structure")
        if strategy["volatility"] == "low" and (trend.get("volatility_percentile") or 50) > 70:
            cautions.append("Long option premium may already be expensive")

        rows.append({
            "timeframe": timeframe, "market": market, "strategy_key": strategy["key"],
            "name": strategy["name"], "scanner": strategy["scanner"], "route": strategy["route"],
            "stance": strategy["stance"], "risk": strategy["risk"], "thesis": strategy["thesis"],
            "score": int(total), "category": _category(total),
            "technical_fit": round(technical_fit), "macro_fit": round(macro_fit),
            "volatility_fit": round(volatility_fit),
            "macro_adjustment": round((macro_fit - 50) * 0.25, 1),
            "reasons": reasons, "cautions": cautions,
        })
    rows.sort(key=lambda row: (-row["score"], row["name"]))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def build_dashboard(raw):
    frames = {symbol: _resample_ohlc(_symbol_frame(raw, symbol), None) for symbol in ALL_SYMBOLS}
    missing = [symbol for symbol in MARKETS if frames[symbol].empty]
    if missing:
        raise ValueError(f"No price history returned for {', '.join(missing)}")

    economy = _economic_analysis(frames)
    timeframes = {}
    for timeframe_key, config in TIMEFRAMES.items():
        markets = {ticker: _trend_analysis(frames[ticker], timeframe_key) for ticker in MARKETS}
        market_scores = [item["score"] for item in markets.values()]
        recommendations = []
        for ticker, trend in markets.items():
            recommendations.extend(_recommendations(timeframe_key, ticker, trend, economy))
        recommendations.sort(key=lambda row: (-row["score"], row["market"], row["name"]))
        timeframes[timeframe_key] = {
            "key": timeframe_key, "label": config["label"], "markets": markets,
            "summary": {
                "score": int(round(sum(market_scores) / len(market_scores))),
                "bullish_markets": sum(1 for score in market_scores if score >= 20),
                "bearish_markets": sum(1 for score in market_scores if score <= -20),
                "agreement": max(0, int(round(100 - np.std(market_scores)))),
            },
            "recommendations": recommendations,
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "markets": list(MARKETS), "timeframes": timeframes, "economy": economy,
        "model": {
            "technical_weight": 55, "economic_weight": 25, "volatility_weight": 20,
            "indicator_score_range": [-100, 100],
            "note": "Dashboard scores choose which scanner to research first. Scanner results still determine the actual contract, expiration, liquidity, and entry price.",
        },
        "sources": [
            {"name": "Yahoo Finance", "coverage": "Adjusted OHLC history for SPY, QQQ, IWM and market-based economic proxies"},
            {"name": "Portfolio Tracker scoring model", "coverage": "EMA, MACD, RSI, Awesome Oscillator, ADX, realized volatility, macro and scanner-fit rules"},
        ],
    }


def _download_market_data(download_history=None):
    downloader = download_history or yf.download
    return downloader(
        " ".join(ALL_SYMBOLS), period="max", auto_adjust=True, progress=False,
        group_by="column", threads=False,
    )


def register_routes(app, download_history=None):
    @app.route("/api/options/dashboard", methods=["GET"])
    def option_dashboard():
        force = str(request.args.get("refresh", "")).lower() in {"1", "true", "yes"}
        now = time.time()
        with _CACHE_LOCK:
            cached = _CACHE["data"]
            if cached and not force and now - _CACHE["timestamp"] < _CACHE["ttl"]:
                result = dict(cached)
                result["freshness"] = {"status": "cached", "cache_age_seconds": int(now - _CACHE["timestamp"])}
                return jsonify(result)

        try:
            result = build_dashboard(_download_market_data(download_history))
            with _CACHE_LOCK:
                _CACHE["data"] = result
                _CACHE["timestamp"] = time.time()
            payload = dict(result)
            payload["freshness"] = {"status": "live", "cache_age_seconds": 0}
            return jsonify(payload)
        except Exception as exc:
            with _CACHE_LOCK:
                cached = _CACHE["data"]
                age = int(now - _CACHE["timestamp"]) if cached else None
            if cached:
                payload = dict(cached)
                payload["freshness"] = {"status": "stale", "cache_age_seconds": age, "warning": str(exc)}
                return jsonify(payload)
            return jsonify(error=f"Unable to build the option dashboard: {exc}"), 502
