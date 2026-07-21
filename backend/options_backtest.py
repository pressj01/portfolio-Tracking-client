"""Modeled historical same-expiration option-strategy backtests.

Historical underlying prices, dividends, volatility indexes, and Treasury-bill
yields come from Yahoo Finance. Historical option quotes and chains are not
available, so option entry fills, strikes, expirations, and daily marks are
explicitly modeled.
"""

from __future__ import annotations

import calendar
import math
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from market_symbols import yahoo_symbol_for_ticker
from options_pricing import black_scholes, price_option


MIN_BACKTEST_DAYS = 180
MAX_BACKTEST_YEARS = 20
CONTRACT_MULTIPLIER = 100

SCENARIOS = {
    "conservative": {
        "label": "Lower-IV",
        "iv_multiplier": 0.90,
        "slippage_multiplier": 1.50,
        "description": "Lower modeled entry volatility and wider fills.",
    },
    "base": {
        "label": "Base",
        "iv_multiplier": 1.00,
        "slippage_multiplier": 1.00,
        "description": "Historical volatility-regime estimate and configured fills.",
    },
    "favorable": {
        "label": "Higher-IV",
        "iv_multiplier": 1.10,
        "slippage_multiplier": 0.75,
        "description": "Higher modeled entry volatility and tighter fills.",
    },
}


STRATEGIES = {
    "covered_call": {
        "label": "Covered call",
        "description": "Long 100 shares and short one call.",
        "stock_units": 1,
        "capital_model": "stock",
        "capitalization": "fully covered by 100 shares per short call",
        "uses_target_delta": True,
        "uses_wing_delta": False,
        "legs": [
            {"name": "Short call", "side": -1, "option_type": "call", "delta_rule": "target"},
        ],
    },
    "cash_secured_put": {
        "label": "Cash-secured put",
        "description": "Short one put with cash reserved for assignment.",
        "stock_units": 0,
        "capital_model": "cash_secured_put",
        "capitalization": "cash secured at the short-put strike",
        "uses_target_delta": True,
        "uses_wing_delta": False,
        "legs": [
            {"name": "Short put", "side": -1, "option_type": "put", "delta_rule": "target"},
        ],
    },
    "protective_put": {
        "label": "Protective put",
        "description": "Long 100 shares and long one downside put.",
        "stock_units": 1,
        "capital_model": "stock",
        "capitalization": "100 shares plus the protective-put debit",
        "uses_target_delta": True,
        "uses_wing_delta": False,
        "legs": [
            {"name": "Long put", "side": 1, "option_type": "put", "delta_rule": "target"},
        ],
    },
    "collar": {
        "label": "Collar",
        "description": "Long shares, long a downside put, and short an upside call.",
        "stock_units": 1,
        "capital_model": "stock",
        "capitalization": "100 shares plus any net option debit",
        "uses_target_delta": True,
        "uses_wing_delta": True,
        "legs": [
            {"name": "Long put", "side": 1, "option_type": "put", "delta_rule": "wing"},
            {"name": "Short call", "side": -1, "option_type": "call", "delta_rule": "target"},
        ],
    },
    "bull_call_spread": {
        "label": "Bull call spread",
        "description": "Long an in-the-money call and short an out-of-the-money call.",
        "stock_units": 0,
        "capital_model": "defined_risk",
        "capitalization": "fully funded to the modeled maximum loss",
        "uses_target_delta": True,
        "uses_wing_delta": False,
        "legs": [
            {"name": "Long call", "side": 1, "option_type": "call", "delta_rule": "inverse_target"},
            {"name": "Short call", "side": -1, "option_type": "call", "delta_rule": "target"},
        ],
    },
    "bear_put_spread": {
        "label": "Bear put spread",
        "description": "Long an in-the-money put and short an out-of-the-money put.",
        "stock_units": 0,
        "capital_model": "defined_risk",
        "capitalization": "fully funded to the modeled maximum loss",
        "uses_target_delta": True,
        "uses_wing_delta": False,
        "legs": [
            {"name": "Long put", "side": 1, "option_type": "put", "delta_rule": "inverse_target"},
            {"name": "Short put", "side": -1, "option_type": "put", "delta_rule": "target"},
        ],
    },
    "bull_put_spread": {
        "label": "Bull put spread",
        "description": "Short a put and buy a lower-delta put for defined risk.",
        "stock_units": 0,
        "capital_model": "defined_risk",
        "capitalization": "fully funded to the modeled maximum loss",
        "uses_target_delta": True,
        "uses_wing_delta": True,
        "legs": [
            {"name": "Short put", "side": -1, "option_type": "put", "delta_rule": "target"},
            {"name": "Long put", "side": 1, "option_type": "put", "delta_rule": "wing"},
        ],
    },
    "bear_call_spread": {
        "label": "Bear call spread",
        "description": "Short a call and buy a lower-delta call for defined risk.",
        "stock_units": 0,
        "capital_model": "defined_risk",
        "capitalization": "fully funded to the modeled maximum loss",
        "uses_target_delta": True,
        "uses_wing_delta": True,
        "legs": [
            {"name": "Short call", "side": -1, "option_type": "call", "delta_rule": "target"},
            {"name": "Long call", "side": 1, "option_type": "call", "delta_rule": "wing"},
        ],
    },
    "long_straddle": {
        "label": "Long straddle",
        "description": "Long an at-the-money call and put at the same strike and expiry.",
        "stock_units": 0,
        "capital_model": "defined_risk",
        "capitalization": "fully funded to the total option debit",
        "uses_target_delta": False,
        "uses_wing_delta": False,
        "legs": [
            {"name": "Long call", "side": 1, "option_type": "call", "delta_rule": "atm"},
            {"name": "Long put", "side": 1, "option_type": "put", "delta_rule": "same_as_first"},
        ],
    },
    "long_strangle": {
        "label": "Long strangle",
        "description": "Long an out-of-the-money call and put with the same expiry.",
        "stock_units": 0,
        "capital_model": "defined_risk",
        "capitalization": "fully funded to the total option debit",
        "uses_target_delta": True,
        "uses_wing_delta": False,
        "legs": [
            {"name": "Long call", "side": 1, "option_type": "call", "delta_rule": "target"},
            {"name": "Long put", "side": 1, "option_type": "put", "delta_rule": "target"},
        ],
    },
    "iron_condor": {
        "label": "Iron condor",
        "description": "Short an out-of-the-money call and put with farther protective wings.",
        "stock_units": 0,
        "capital_model": "defined_risk",
        "capitalization": "fully funded to the wider wing's modeled maximum loss",
        "uses_target_delta": True,
        "uses_wing_delta": True,
        "legs": [
            {"name": "Long put", "side": 1, "option_type": "put", "delta_rule": "wing"},
            {"name": "Short put", "side": -1, "option_type": "put", "delta_rule": "target"},
            {"name": "Short call", "side": -1, "option_type": "call", "delta_rule": "target"},
            {"name": "Long call", "side": 1, "option_type": "call", "delta_rule": "wing"},
        ],
    },
}


def _parse_date(value: Any, name: str) -> date:
    try:
        return datetime.strptime(str(value or ""), "%Y-%m-%d").date()
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must use YYYY-MM-DD format") from exc


def _number(value: Any, default: float) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def _extract_series(raw: pd.DataFrame, symbol: str, field: str) -> pd.Series:
    if raw is None or raw.empty:
        return pd.Series(dtype=float)
    if isinstance(raw.columns, pd.MultiIndex):
        level_zero = set(raw.columns.get_level_values(0))
        level_one = set(raw.columns.get_level_values(1))
        if symbol in level_zero:
            sub = raw[symbol]
            if field in sub.columns:
                return pd.to_numeric(sub[field], errors="coerce")
        if field in level_zero and symbol in level_one:
            return pd.to_numeric(raw[field][symbol], errors="coerce")
        return pd.Series(index=raw.index, dtype=float)
    if field in raw.columns:
        return pd.to_numeric(raw[field], errors="coerce")
    return pd.Series(index=raw.index, dtype=float)


def fetch_backtest_history(ticker: str, start: date, end: date) -> pd.DataFrame:
    """Fetch underlying and volatility-regime inputs with a warm-up window."""
    yahoo_ticker = yahoo_symbol_for_ticker(ticker)
    warmup_start = start - timedelta(days=420)
    download_end = end + timedelta(days=1)
    symbols = list(dict.fromkeys([yahoo_ticker, "SPY", "QQQ", "^VIX", "^VXN", "^IRX"]))
    raw = yf.download(
        " ".join(symbols),
        start=warmup_start.isoformat(),
        end=download_end.isoformat(),
        auto_adjust=False,
        actions=True,
        progress=False,
        threads=False,
        group_by="ticker",
    )
    if raw is None or raw.empty:
        raise ValueError("Yahoo Finance returned no historical data for this symbol.")

    frame = pd.DataFrame(index=pd.to_datetime(raw.index).tz_localize(None))
    frame["open"] = _extract_series(raw, yahoo_ticker, "Open").to_numpy()
    frame["close"] = _extract_series(raw, yahoo_ticker, "Close").to_numpy()
    dividends = _extract_series(raw, yahoo_ticker, "Dividends")
    frame["dividend"] = dividends.to_numpy() if len(dividends) == len(frame) else 0.0
    frame["spy_close"] = _extract_series(raw, "SPY", "Close").reindex(raw.index).to_numpy()
    frame["qqq_close"] = _extract_series(raw, "QQQ", "Close").reindex(raw.index).to_numpy()
    frame["vix"] = _extract_series(raw, "^VIX", "Close").reindex(raw.index).to_numpy()
    frame["vxn"] = _extract_series(raw, "^VXN", "Close").reindex(raw.index).to_numpy()
    frame["irx"] = _extract_series(raw, "^IRX", "Close").reindex(raw.index).to_numpy()
    return frame.sort_index()


def _as_decimal_index(series: pd.Series) -> pd.Series:
    values = pd.to_numeric(series, errors="coerce")
    median = values.dropna().median()
    if pd.notna(median) and abs(float(median)) > 2.0:
        values = values / 100.0
    return values


def prepare_history(
    history: pd.DataFrame,
    start: date,
    end: date,
    volatility_index: str = "auto",
    ticker: str = "",
) -> tuple[pd.DataFrame, str]:
    """Build trailing-only volatility, rate, and dividend-yield inputs."""
    if history is None or history.empty:
        raise ValueError("No historical data is available for the requested range.")
    frame = history.copy()
    frame.index = pd.to_datetime(frame.index).tz_localize(None).normalize()
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    for column in ("open", "close", "dividend", "spy_close", "qqq_close", "vix", "vxn", "irx"):
        if column not in frame:
            frame[column] = np.nan if column != "dividend" else 0.0
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["close"] = frame["close"].replace(0, np.nan)
    frame["open"] = frame["open"].replace(0, np.nan).fillna(frame["close"])
    frame["dividend"] = frame["dividend"].fillna(0.0).clip(lower=0.0)
    frame = frame.dropna(subset=["close"])
    if frame.empty:
        raise ValueError("The underlying has no closing-price history in this range.")

    ticker_upper = ticker.upper()
    if volatility_index == "auto":
        use_vxn = ticker_upper in {"QQQ", "NDX", "NDXW", "TQQQ", "SQQQ"}
        volatility_index = "vxn" if use_vxn else "vix"
    volatility_index = str(volatility_index).lower()
    if volatility_index not in {"vix", "vxn"}:
        raise ValueError("volatility_index must be auto, vix, or vxn")

    asset_returns = np.log(frame["close"] / frame["close"].shift(1))
    rv20 = asset_returns.rolling(20, min_periods=15).std() * math.sqrt(252)
    rv60 = asset_returns.rolling(60, min_periods=35).std() * math.sqrt(252)

    benchmark_column = "qqq_close" if volatility_index == "vxn" else "spy_close"
    benchmark_close = frame[benchmark_column].replace(0, np.nan).ffill()
    if benchmark_close.isna().all():
        benchmark_close = frame["close"]
    benchmark_returns = np.log(benchmark_close / benchmark_close.shift(1))
    benchmark_rv20 = benchmark_returns.rolling(20, min_periods=15).std() * math.sqrt(252)

    vol_index = _as_decimal_index(frame[volatility_index]).ffill()
    regime_ratio = (vol_index / benchmark_rv20.replace(0, np.nan)).clip(0.85, 1.75)
    blended_rv = (rv20 * 0.65 + rv60 * 0.35).fillna(rv20).fillna(rv60)
    sigma = (blended_rv * regime_ratio).replace([np.inf, -np.inf], np.nan)
    sigma = sigma.fillna(blended_rv * 1.15).fillna(0.25).clip(0.08, 1.50)
    frame["sigma_base"] = sigma

    rates = _as_decimal_index(frame["irx"]).ffill().fillna(0.0375)
    frame["rate"] = rates.clip(-0.02, 0.20)
    trailing_dividends = frame["dividend"].rolling(252, min_periods=1).sum()
    frame["div_yield"] = (trailing_dividends / frame["close"]).fillna(0.0).clip(0.0, 0.25)

    test_frame = frame.loc[
        (frame.index.date >= start) & (frame.index.date <= end),
        ["open", "close", "dividend", "sigma_base", "rate", "div_yield"],
    ].copy()
    if len(test_frame) < 20:
        raise ValueError("Not enough trading-day history exists in the requested range.")
    return test_frame, volatility_index.upper()


def _third_friday(year: int, month: int) -> date:
    month_calendar = calendar.monthcalendar(year, month)
    fridays = [week[calendar.FRIDAY] for week in month_calendar if week[calendar.FRIDAY]]
    return date(year, month, fridays[2])


def monthly_expirations(index: pd.DatetimeIndex) -> list[pd.Timestamp]:
    """Return standard monthly expirations, adjusted to the prior trading day."""
    expirations: list[pd.Timestamp] = []
    periods = sorted(set(index.to_period("M")))
    for period in periods:
        friday = pd.Timestamp(_third_friday(period.year, period.month))
        same_month = index[(index.year == period.year) & (index.month == period.month)]
        # Do not mistake an incomplete current month for an exchange holiday.
        # A genuine Friday holiday still has later trading dates in the month.
        if not len(same_month) or same_month[-1] < friday:
            continue
        candidates = same_month[same_month <= friday]
        if len(candidates):
            expirations.append(pd.Timestamp(candidates[-1]))
    return expirations


def _strike_increment(spot: float) -> float:
    if spot < 25:
        return 0.5
    if spot < 200:
        return 1.0
    return 5.0


def select_call_strike(
    spot: float,
    time_years: float,
    rate: float,
    dividend_yield: float,
    sigma: float,
    target_delta: float,
) -> tuple[float, float]:
    """Select the listed-style strike whose modeled call delta is nearest target."""
    increment = _strike_increment(spot)
    low = max(increment, math.floor(spot / increment) * increment)
    high = math.ceil((spot * 1.35) / increment) * increment
    strikes = np.arange(low, high + increment * 0.5, increment)
    candidates = []
    for strike in strikes:
        delta = black_scholes(
            spot, float(strike), time_years, rate, dividend_yield, sigma, "call",
        )["delta"]
        candidates.append((abs(delta - target_delta), float(strike), float(delta)))
    if not candidates:
        raise ValueError("Unable to construct a strike grid for this underlying.")
    _, strike, delta = min(candidates, key=lambda item: item[0])
    return strike, delta


def select_option_strike(
    spot: float,
    time_years: float,
    rate: float,
    dividend_yield: float,
    sigma: float,
    target_delta: float,
    option_type: str,
) -> tuple[float, float]:
    """Select a listed-style strike nearest the requested absolute delta."""
    increment = _strike_increment(spot)
    low = max(increment, math.floor((spot * 0.20) / increment) * increment)
    high = math.ceil((spot * 2.50) / increment) * increment
    strikes = np.arange(low, high + increment * 0.5, increment)
    candidates = []
    for strike in strikes:
        delta = float(black_scholes(
            spot,
            float(strike),
            time_years,
            rate,
            dividend_yield,
            sigma,
            option_type,
        )["delta"])
        candidates.append((abs(abs(delta) - target_delta), float(strike), delta))
    if not candidates:
        raise ValueError("Unable to construct a strike grid for this underlying.")
    _, strike, delta = min(candidates, key=lambda item: item[0])
    return strike, delta


def _grid_strike(spot: float, requested_strike: float) -> float:
    increment = _strike_increment(spot)
    return max(increment, round(requested_strike / increment) * increment)


def _rule_delta(rule: str, target_delta: float, wing_delta: float) -> float:
    if rule == "target":
        return target_delta
    if rule == "wing":
        return wing_delta
    if rule == "inverse_target":
        return 1.0 - target_delta
    return 0.50


def _resolve_leg_strike(
    spec: dict,
    override: dict | None,
    resolved_legs: list[dict],
    spot: float,
    time_years: float,
    rate: float,
    dividend_yield: float,
    sigma: float,
    target_delta: float,
    wing_delta: float,
) -> tuple[float, float, dict]:
    option_type = spec["option_type"]
    method = str((override or {}).get("method") or "delta").lower()
    if method not in {"delta", "moneyness", "fixed"}:
        raise ValueError("Each strike method must be delta, moneyness, or fixed.")

    if method == "moneyness":
        offset_pct = _number((override or {}).get("value"), 0.0)
        if offset_pct <= -99.0 or offset_pct > 500.0:
            raise ValueError("Moneyness strike offsets must be greater than -99% and no more than 500%.")
        strike = _grid_strike(spot, spot * (1.0 + offset_pct / 100.0))
        delta = float(black_scholes(
            spot, strike, time_years, rate, dividend_yield, sigma, option_type,
        )["delta"])
        return strike, delta, {"method": method, "value": round(offset_pct, 4)}

    if method == "fixed":
        requested = _number((override or {}).get("value"), 0.0)
        if requested <= 0:
            raise ValueError("Fixed strikes must be greater than zero.")
        strike = _grid_strike(spot, requested)
        delta = float(black_scholes(
            spot, strike, time_years, rate, dividend_yield, sigma, option_type,
        )["delta"])
        return strike, delta, {"method": method, "value": round(requested, 4)}

    if spec.get("delta_rule") == "same_as_first" and resolved_legs and not override:
        strike = float(resolved_legs[0]["strike"])
        delta = float(black_scholes(
            spot, strike, time_years, rate, dividend_yield, sigma, option_type,
        )["delta"])
        return strike, delta, {"method": "same_as_first", "value": strike}

    default_delta = _rule_delta(spec.get("delta_rule", "target"), target_delta, wing_delta)
    requested_delta = _number((override or {}).get("value"), default_delta)
    if requested_delta > 1.0:
        requested_delta /= 100.0
    if requested_delta < 0.01 or requested_delta > 0.99:
        raise ValueError("Per-leg target deltas must be between 1% and 99%.")
    strike, delta = select_option_strike(
        spot,
        time_years,
        rate,
        dividend_yield,
        sigma,
        requested_delta,
        option_type,
    )
    return strike, delta, {"method": method, "value": round(requested_delta, 6)}


def _series_metrics(
    values: pd.Series,
    rates: pd.Series | None = None,
    initial_value: float | None = None,
) -> dict:
    values = pd.to_numeric(values, errors="coerce").dropna()
    if len(values) < 2:
        return {}
    returns = values.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
    years = max((values.index[-1] - values.index[0]).days / 365.25, 1 / 365.25)
    starting_value = float(initial_value) if initial_value is not None else float(values.iloc[0])
    total_return = float(values.iloc[-1] / starting_value - 1.0)
    cagr = float((values.iloc[-1] / starting_value) ** (1.0 / years) - 1.0)
    running_max = values.cummax()
    if initial_value is not None:
        running_max = running_max.clip(lower=starting_value)
    drawdown = values / running_max - 1.0
    volatility = float(returns.std() * math.sqrt(252)) if len(returns) > 1 else None

    if rates is not None:
        aligned_rates = rates.reindex(returns.index).ffill().fillna(0.0) / 252.0
        excess = returns - aligned_rates
    else:
        excess = returns
    excess_std = float(excess.std()) if len(excess) > 1 else 0.0
    sharpe = float(excess.mean() / excess_std * math.sqrt(252)) if excess_std > 0 else None
    downside = excess[excess < 0]
    downside_std = float(downside.std()) if len(downside) > 1 else 0.0
    sortino = float(excess.mean() / downside_std * math.sqrt(252)) if downside_std > 0 else None
    return {
        "initial_value": round(starting_value, 2),
        "ending_value": round(float(values.iloc[-1]), 2),
        "total_return": round(total_return, 6),
        "cagr": round(cagr, 6),
        "annual_volatility": round(volatility, 6) if volatility is not None else None,
        "max_drawdown": round(float(drawdown.min()), 6),
        "sharpe": round(sharpe, 4) if sharpe is not None else None,
        "sortino": round(sortino, 4) if sortino is not None else None,
    }


def _benchmark_curve(history: pd.DataFrame, initial_capital: float) -> pd.Series:
    shares = initial_capital / float(history["close"].iloc[0])
    values = []
    for offset, (_, row) in enumerate(history.iterrows()):
        spot = float(row["close"])
        dividend = float(row["dividend"] or 0.0)
        if offset > 0 and dividend > 0 and spot > 0:
            shares += shares * dividend / spot
        values.append(shares * spot)
    return pd.Series(values, index=history.index, dtype=float)


def _curve_payload(values: pd.Series, initial_value: float | None = None) -> dict:
    running_max = values.cummax()
    if initial_value is not None:
        running_max = running_max.clip(lower=float(initial_value))
    drawdowns = values / running_max - 1.0
    return {
        "dates": values.index.strftime("%Y-%m-%d").tolist(),
        "values": [round(float(value), 2) for value in values],
        "drawdowns": [round(float(value), 6) for value in drawdowns],
    }


def _rolling_expiration(
    index: pd.DatetimeIndex,
    entry_position: int,
    target_dte: int,
) -> tuple[pd.Timestamp, int] | None:
    """Choose the closest available trading date to the requested calendar DTE."""
    entry_date = pd.Timestamp(index[entry_position])
    target_date = entry_date + pd.Timedelta(days=target_dte)
    if pd.Timestamp(index[-1]) < target_date:
        return None
    position = int(index.searchsorted(target_date, side="left"))
    candidates = []
    for candidate_position in (position - 1, position):
        if entry_position < candidate_position < len(index):
            candidate_date = pd.Timestamp(index[candidate_position])
            candidates.append((abs((candidate_date - target_date).days), candidate_position, candidate_date))
    if not candidates:
        return None
    _, expiration_position, expiration = min(candidates, key=lambda item: (item[0], item[1]))
    return expiration, expiration_position


def _build_cycle_legs(
    strategy: dict,
    leg_rules: list[dict],
    spot: float,
    time_years: float,
    rate: float,
    dividend_yield: float,
    sigma: float,
    target_delta: float,
    wing_delta: float,
    pricing_model: str,
    slippage_pct: float,
    minimum_slippage: float,
    scenario: dict,
) -> list[dict]:
    legs: list[dict] = []
    for index, spec in enumerate(strategy["legs"]):
        override = leg_rules[index] if index < len(leg_rules) else None
        strike, modeled_delta, strike_rule = _resolve_leg_strike(
            spec,
            override,
            legs,
            spot,
            time_years,
            rate,
            dividend_yield,
            sigma,
            target_delta,
            wing_delta,
        )
        theoretical_price = float(price_option(
            spot,
            strike,
            time_years,
            rate,
            dividend_yield,
            sigma,
            spec["option_type"],
            pricing_model,
        )["price"])
        slippage = max(
            minimum_slippage,
            theoretical_price * slippage_pct * float(scenario["slippage_multiplier"]),
        )
        fill_price = theoretical_price + slippage if spec["side"] > 0 else max(0.01, theoretical_price - slippage)
        legs.append({
            **spec,
            "quantity": int(spec.get("quantity") or 1),
            "strike": float(strike),
            "modeled_delta": float(modeled_delta),
            "strike_rule": strike_rule,
            "theoretical_price": theoretical_price,
            "fill_price": float(fill_price),
            "slippage": abs(float(fill_price) - theoretical_price),
        })
    return legs


def _intrinsic(spot: float, strike: float, option_type: str) -> float:
    return max(spot - strike, 0.0) if option_type == "call" else max(strike - spot, 0.0)


def _capital_requirement(
    strategy: dict,
    legs: list[dict],
    spot: float,
    commission_per_contract: float,
) -> float:
    commission = commission_per_contract * sum(leg["quantity"] for leg in legs)
    entry_cash_flow = sum(
        -leg["side"] * leg["fill_price"] * CONTRACT_MULTIPLIER * leg["quantity"] for leg in legs
    )
    if strategy["capital_model"] == "stock":
        return (
            spot * CONTRACT_MULTIPLIER * float(strategy["stock_units"])
            + max(-entry_cash_flow, 0.0)
            + commission
        )
    if strategy["capital_model"] == "cash_secured_put":
        short_put = next(leg for leg in legs if leg["side"] < 0 and leg["option_type"] == "put")
        return short_put["strike"] * CONTRACT_MULTIPLIER * short_put["quantity"] + commission

    call_slope = sum(
        leg["side"] * leg["quantity"] for leg in legs if leg["option_type"] == "call"
    )
    if call_slope < 0:
        raise ValueError("This option structure has unlimited upside risk and cannot be fully funded.")
    strikes = sorted({float(leg["strike"]) for leg in legs})
    test_spots = [0.0, *strikes, max(spot * 4.0, (strikes[-1] if strikes else spot) * 3.0)]
    expiration_pnls = []
    for expiration_spot in test_spots:
        payoff = sum(
            leg["side"] * _intrinsic(expiration_spot, leg["strike"], leg["option_type"])
            * CONTRACT_MULTIPLIER * leg["quantity"]
            for leg in legs
        )
        expiration_pnls.append(entry_cash_flow + payoff - commission)
    max_loss = max(0.0, -min(expiration_pnls))
    return max(max_loss, commission, 1.0)


def simulate_same_expiration_strategy(
    history: pd.DataFrame,
    strategy: dict,
    initial_capital: float,
    capital_allocation: float,
    target_dte: int,
    target_delta: float,
    wing_delta: float,
    leg_rules: list[dict],
    pricing_model: str,
    commission_per_contract: float,
    slippage_pct: float,
    minimum_slippage: float,
    scenario: dict,
) -> dict:
    index = history.index
    cash = float(initial_capital)
    shares = 0
    equity_points: dict[pd.Timestamp, float] = {}
    cycles = []
    total_short_premium = 0.0
    total_long_premium = 0.0
    total_net_entry_premium = 0.0
    total_theoretical_short_premium = 0.0
    total_option_pnl = 0.0
    total_costs = 0.0
    total_dividends = 0.0
    entry_position = 0
    last_valuation_date: pd.Timestamp | None = None

    while entry_position < len(index) - 1:
        entry_date = pd.Timestamp(index[entry_position])
        expiration_result = _rolling_expiration(index, entry_position, target_dte)
        if not expiration_result:
            break
        expiration, expiration_position = expiration_result
        entry_row = history.loc[entry_date]
        entry_spot = float(entry_row["close"])
        if last_valuation_date is not None and cash > 0:
            elapsed_days = max((entry_date - last_valuation_date).days, 0)
            cash *= math.exp(float(entry_row["rate"]) * elapsed_days / 365.0)
        cycle_start_equity = cash + shares * entry_spot
        dte = int((expiration - entry_date).days)
        time_years = dte / 365.0
        rate = float(entry_row["rate"])
        div_yield = float(entry_row["div_yield"])
        sigma = min(2.0, max(0.05, float(entry_row["sigma_base"]) * float(scenario["iv_multiplier"])))
        legs = _build_cycle_legs(
            strategy,
            leg_rules,
            entry_spot,
            time_years,
            rate,
            div_yield,
            sigma,
            target_delta,
            wing_delta,
            pricing_model,
            slippage_pct,
            minimum_slippage,
            scenario,
        )
        capital_per_contract = _capital_requirement(strategy, legs, entry_spot, commission_per_contract)
        allocated_equity = cycle_start_equity * capital_allocation
        contracts = int(allocated_equity // capital_per_contract)
        if contracts < 1:
            if not cycles:
                if strategy["capital_model"] == "stock":
                    raise ValueError(
                        f"{strategy['label']} requires enough capital for 100 shares and its option legs; "
                        f"approximately ${capital_per_contract:,.0f} at the first test date."
                    )
                raise ValueError(
                    f"{strategy['label']} requires approximately ${capital_per_contract:,.0f} of fully funded "
                    "capital per contract at the first test date."
                )
            break

        overnight_shares = shares
        desired_shares = contracts * CONTRACT_MULTIPLIER * float(strategy["stock_units"])
        cash += (shares - desired_shares) * entry_spot
        shares = desired_shares

        commission = commission_per_contract * contracts * sum(leg["quantity"] for leg in legs)
        entry_cash_flow = sum(
            -leg["side"] * leg["fill_price"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
            for leg in legs
        )
        cash += entry_cash_flow - commission
        short_premium = sum(
            leg["fill_price"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
            for leg in legs if leg["side"] < 0
        )
        long_premium = sum(
            leg["fill_price"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
            for leg in legs if leg["side"] > 0
        )
        theoretical_short_premium = sum(
            leg["theoretical_price"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
            for leg in legs if leg["side"] < 0
        )
        slippage_cost = sum(
            leg["slippage"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"] for leg in legs
        )
        total_short_premium += short_premium
        total_long_premium += long_premium
        total_net_entry_premium += entry_cash_flow
        total_theoretical_short_premium += theoretical_short_premium
        total_costs += slippage_cost + commission

        cycle_dividends = 0.0
        segment = history.iloc[entry_position:expiration_position + 1]
        for offset, (current_date, row) in enumerate(segment.iterrows()):
            current_date = pd.Timestamp(current_date)
            current_spot = float(row["close"])
            if offset > 0 and cash > 0:
                previous_date = pd.Timestamp(segment.index[offset - 1])
                elapsed_days = max((current_date - previous_date).days, 0)
                cash *= math.exp(float(row["rate"]) * elapsed_days / 365.0)
            dividend_shares = overnight_shares if offset == 0 else shares
            dividend_cash = dividend_shares * float(row["dividend"] or 0.0)
            if dividend_cash:
                cash += dividend_cash
                cycle_dividends += dividend_cash
                total_dividends += dividend_cash

            remaining_years = max((expiration - current_date).days, 0) / 365.0
            daily_sigma = min(
                2.0,
                max(0.05, float(row["sigma_base"]) * float(scenario["iv_multiplier"])),
            )
            option_value = 0.0
            for leg in legs:
                if remaining_years <= 0:
                    mark = _intrinsic(current_spot, leg["strike"], leg["option_type"])
                else:
                    mark = float(price_option(
                        current_spot,
                        leg["strike"],
                        remaining_years,
                        float(row["rate"]),
                        float(row["div_yield"]),
                        daily_sigma,
                        leg["option_type"],
                        pricing_model,
                    )["price"])
                option_value += (
                    leg["side"] * mark * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
                )
            equity_points[current_date] = cash + shares * current_spot + option_value

        expiration_spot = float(history.loc[expiration, "close"])
        for leg in legs:
            leg["intrinsic"] = _intrinsic(expiration_spot, leg["strike"], leg["option_type"])
        assigned_legs = [leg for leg in legs if leg["side"] < 0 and leg["intrinsic"] > 0]
        exercised_legs = [leg for leg in legs if leg["side"] > 0 and leg["intrinsic"] > 0]
        settlement_value = sum(
            leg["side"] * leg["intrinsic"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
            for leg in legs
        )
        option_pnl = entry_cash_flow + settlement_value - commission
        total_option_pnl += option_pnl
        ending_equity = float(equity_points[expiration])
        cycle_pnl = ending_equity - cycle_start_equity

        if strategy["stock_units"]:
            physical_leg = next(
                (
                    leg for leg in legs
                    if leg["intrinsic"] > 0
                    and (
                        (leg["side"] < 0 and leg["option_type"] == "call")
                        or (leg["side"] > 0 and leg["option_type"] == "put")
                    )
                ),
                None,
            )
            if physical_leg is not None:
                settled_shares = min(
                    shares, contracts * CONTRACT_MULTIPLIER * physical_leg["quantity"]
                )
                cash += settled_shares * physical_leg["strike"]
                shares -= settled_shares
                cash += sum(
                    leg["side"] * leg["intrinsic"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
                    for leg in legs if leg is not physical_leg
                )
            else:
                cash += settlement_value
        else:
            cash += settlement_value

        if assigned_legs and exercised_legs:
            outcome = "Short and long legs ITM"
        elif assigned_legs:
            outcome = "Short leg ITM" if len(assigned_legs) == 1 else f"{len(assigned_legs)} short legs ITM"
        elif exercised_legs:
            outcome = "Long leg ITM" if len(exercised_legs) == 1 else f"{len(exercised_legs)} long legs ITM"
        else:
            outcome = "All options expired OTM"

        cycle_legs = []
        for leg in legs:
            leg_pnl = (
                leg["side"] * (leg["intrinsic"] - leg["fill_price"])
                * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
            )
            cycle_legs.append({
                "name": leg["name"],
                "side": "buy" if leg["side"] > 0 else "sell",
                "option_type": leg["option_type"],
                "quantity": leg["quantity"],
                "strike": round(leg["strike"], 2),
                "strike_rule": leg["strike_rule"],
                "modeled_delta": round(leg["modeled_delta"], 4),
                "theoretical_price": round(leg["theoretical_price"], 4),
                "fill_price": round(leg["fill_price"], 4),
                "intrinsic_value": round(
                    leg["intrinsic"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"], 2,
                ),
                "pnl": round(leg_pnl, 2),
                "itm": leg["intrinsic"] > 0,
            })
        primary_leg = legs[0]
        short_intrinsic = sum(
            leg["intrinsic"] * CONTRACT_MULTIPLIER * contracts * leg["quantity"]
            for leg in legs if leg["side"] < 0
        )
        cycles.append({
            "entry_date": entry_date.strftime("%Y-%m-%d"),
            "expiration_date": expiration.strftime("%Y-%m-%d"),
            "dte": dte,
            "contracts": contracts,
            "capital_per_contract": round(capital_per_contract, 2),
            "capital_allocation": round(capital_allocation, 6),
            "entry_spot": round(entry_spot, 2),
            "strike": round(primary_leg["strike"], 2),
            "target_delta": round(target_delta, 4),
            "modeled_delta": round(primary_leg["modeled_delta"], 4),
            "modeled_iv": round(sigma, 6),
            "rate": round(rate, 6),
            "dividend_yield": round(div_yield, 6),
            "theoretical_price": round(primary_leg["theoretical_price"], 4),
            "fill_price": round(primary_leg["fill_price"], 4),
            "gross_premium": round(short_premium, 2),
            "premium_paid": round(long_premium, 2),
            "net_entry_premium": round(entry_cash_flow, 2),
            "expiration_spot": round(expiration_spot, 2),
            "intrinsic_value": round(short_intrinsic, 2),
            "dividends": round(cycle_dividends, 2),
            "commission": round(commission, 2),
            "slippage_cost": round(slippage_cost, 2),
            "assigned": bool(assigned_legs),
            "exercised": bool(exercised_legs),
            "outcome": outcome,
            "option_pnl": round(option_pnl, 2),
            "cycle_pnl": round(cycle_pnl, 2),
            "ending_equity": round(ending_equity, 2),
            "legs": cycle_legs,
        })
        last_valuation_date = expiration
        entry_position = expiration_position + 1

    if not cycles:
        raise ValueError(
            "No complete same-expiration strategy cycles fit the requested DTE, date range, and capital amount."
        )

    equity = pd.Series(equity_points, dtype=float).sort_index()
    assigned_count = sum(1 for cycle in cycles if cycle["assigned"])
    winning_count = sum(1 for cycle in cycles if cycle["cycle_pnl"] > 0)
    return {
        "label": scenario["label"],
        "description": scenario["description"],
        "metrics": _series_metrics(equity, history["rate"], initial_capital),
        "curve": _curve_payload(equity, initial_capital),
        "summary": {
            "cycle_count": len(cycles),
            "average_dte": round(sum(cycle["dte"] for cycle in cycles) / len(cycles), 2),
            "gross_premium": round(total_short_premium, 2),
            "premium_paid": round(total_long_premium, 2),
            "net_entry_premium": round(total_net_entry_premium, 2),
            "theoretical_premium": round(total_theoretical_short_premium, 2),
            "net_option_pnl": round(total_option_pnl, 2),
            "estimated_costs": round(total_costs, 2),
            "dividends_received": round(total_dividends, 2),
            "assignment_rate": round(assigned_count / len(cycles), 6),
            "winning_cycle_rate": round(winning_count / len(cycles), 6),
        },
        "cycles": cycles,
    }


def _custom_strategy_definition(payload: dict) -> dict:
    raw = payload.get("custom_strategy")
    if not isinstance(raw, dict):
        raise ValueError("custom_strategy is required for a saved same-expiration strategy")
    raw_legs = raw.get("legs") or []
    if not isinstance(raw_legs, list) or not 1 <= len(raw_legs) <= 8:
        raise ValueError("A saved same-expiration strategy must contain 1 to 8 option legs")
    legs = []
    for index, raw_leg in enumerate(raw_legs):
        if not isinstance(raw_leg, dict):
            raise ValueError("Each saved strategy leg must be an object")
        side_text = str(raw_leg.get("side") or "").strip().lower()
        if side_text not in {"buy", "sell"}:
            raise ValueError("Each saved strategy leg side must be buy or sell")
        option_type = str(raw_leg.get("option_type") or "").strip().lower()
        if option_type not in {"call", "put"}:
            raise ValueError("Each saved strategy option type must be call or put")
        quantity = int(_number(raw_leg.get("quantity"), 1))
        if quantity < 1 or quantity > 100:
            raise ValueError("Each saved strategy leg quantity must be between 1 and 100")
        legs.append({
            "name": str(raw_leg.get("name") or f"Leg {index + 1}")[:80],
            "side": 1 if side_text == "buy" else -1,
            "option_type": option_type,
            "quantity": quantity,
            "delta_rule": "target",
        })

    stock_units = _number(raw.get("stock_units"), 0.0)
    if stock_units < 0 or stock_units > 100:
        raise ValueError("Saved strategy stock units must be between 0 and 100")
    upside_slope = stock_units + sum(
        leg["side"] * leg["quantity"] for leg in legs if leg["option_type"] == "call"
    )
    if upside_slope < 0:
        raise ValueError("The saved strategy contains uncovered upside risk and cannot be fully funded.")

    only_cash_secured_put = (
        stock_units == 0
        and len(legs) == 1
        and legs[0]["side"] < 0
        and legs[0]["option_type"] == "put"
    )
    capital_model = "stock" if stock_units > 0 else "cash_secured_put" if only_cash_secured_put else "defined_risk"
    label = str(raw.get("name") or "Saved strategy").strip()[:120] or "Saved strategy"
    return {
        "label": label,
        "description": "Saved same-expiration strategy replayed with its leg ratios and rolling strike structure.",
        "stock_units": stock_units,
        "capital_model": capital_model,
        "capitalization": (
            "saved stock coverage plus any option debit"
            if stock_units > 0
            else "cash secured at the short-put strike"
            if only_cash_secured_put
            else "fully funded to the modeled maximum loss"
        ),
        "uses_target_delta": False,
        "uses_wing_delta": False,
        "legs": legs,
    }


def run_options_backtest(payload: dict, history: pd.DataFrame | None = None) -> dict:
    ticker = str(payload.get("ticker") or "").strip().upper()
    if not ticker:
        raise ValueError("ticker is required")
    start = _parse_date(payload.get("start"), "start")
    end = _parse_date(payload.get("end"), "end")
    if end <= start:
        raise ValueError("end must be after start")
    days = (end - start).days
    if days < MIN_BACKTEST_DAYS:
        raise ValueError("The modeled backtest requires at least six months.")
    if days / 365.25 > MAX_BACKTEST_YEARS + 0.1:
        raise ValueError(f"The maximum backtest range is {MAX_BACKTEST_YEARS} years.")

    strategy_id = str(payload.get("strategy") or "covered_call").lower()
    if strategy_id == "custom_same_expiration":
        strategy = _custom_strategy_definition(payload)
    elif strategy_id not in STRATEGIES:
        supported = ", ".join(STRATEGIES)
        raise ValueError(f"Unknown strategy. Supported strategies: {supported}")
    else:
        strategy = STRATEGIES[strategy_id]
    initial_capital = _number(payload.get("initial_capital"), 100000.0)
    if initial_capital <= 0:
        raise ValueError("initial_capital must be greater than zero")
    default_allocation = 0.10 if strategy["capital_model"] == "defined_risk" else 1.0
    capital_allocation = _number(payload.get("capital_allocation_pct"), default_allocation)
    if capital_allocation > 1.0:
        capital_allocation /= 100.0
    if capital_allocation < 0.01 or capital_allocation > 1.0:
        raise ValueError("capital_allocation_pct must be between 1% and 100%")
    target_dte = int(_number(payload.get("target_dte"), 30))
    if target_dte < 1:
        raise ValueError("target_dte must be at least 1")
    if target_dte >= days:
        raise ValueError("target_dte must be shorter than the requested backtest range")
    target_delta = _number(payload.get("target_delta"), 0.30)
    if target_delta > 1.0:
        target_delta /= 100.0
    if target_delta < 0.01 or target_delta > 0.99:
        raise ValueError("target_delta must be between 0.01 and 0.99")
    wing_delta = _number(payload.get("wing_delta"), 0.15)
    if wing_delta > 1.0:
        wing_delta /= 100.0
    if wing_delta < 0.01 or wing_delta > 0.99:
        raise ValueError("wing_delta must be between 0.01 and 0.99")
    leg_rules = payload.get("leg_rules") or []
    if not isinstance(leg_rules, list):
        raise ValueError("leg_rules must be a list")
    if len(leg_rules) > len(strategy["legs"]):
        raise ValueError("leg_rules contains more entries than this strategy has option legs")
    pricing_model = str(payload.get("pricing_model") or "bjerksund-stensland").lower()
    if pricing_model not in {"black-scholes", "bjerksund-stensland"}:
        raise ValueError("Unknown pricing_model")
    commission = max(0.0, _number(payload.get("commission_per_contract"), 0.65))
    slippage_pct = min(0.25, max(0.0, _number(payload.get("slippage_pct"), 0.05)))
    minimum_slippage = min(1.0, max(0.0, _number(payload.get("minimum_slippage"), 0.02)))
    volatility_index = str(payload.get("volatility_index") or "auto").lower()

    raw_history = history if history is not None else fetch_backtest_history(ticker, start, end)
    prepared, selected_volatility_index = prepare_history(
        raw_history, start, end, volatility_index=volatility_index, ticker=ticker,
    )
    lot_cost = float(prepared["close"].iloc[0]) * CONTRACT_MULTIPLIER
    if strategy["capital_model"] == "stock" and initial_capital < lot_cost:
        raise ValueError(
            f"{strategy['label']} requires enough capital for 100 shares; approximately ${lot_cost:,.0f} at the first test date."
        )

    scenario_results = {
        scenario_id: simulate_same_expiration_strategy(
            prepared,
            strategy=strategy,
            initial_capital=initial_capital,
            capital_allocation=capital_allocation,
            target_dte=target_dte,
            target_delta=target_delta,
            wing_delta=wing_delta,
            leg_rules=leg_rules,
            pricing_model=pricing_model,
            commission_per_contract=commission,
            slippage_pct=slippage_pct,
            minimum_slippage=minimum_slippage,
            scenario=scenario,
        )
        for scenario_id, scenario in SCENARIOS.items()
    }
    common_end = min(
        pd.Timestamp(result["curve"]["dates"][-1]) for result in scenario_results.values()
    )
    common_start = max(
        pd.Timestamp(result["curve"]["dates"][0]) for result in scenario_results.values()
    )
    benchmark_history = prepared.loc[common_start:common_end]
    benchmark = _benchmark_curve(benchmark_history, initial_capital)

    warnings = [
        "Historical option chains are unavailable; premiums, deltas, and daily option marks are modeled.",
        "Each requested DTE is mapped to the nearest available historical trading date; actual listed expiration availability is not verified.",
        "Delta, moneyness, and fixed strike rules use modeled listed-style strikes; historical strike availability is not verified.",
        "All legs share one expiration and are held to expiry; early exits, taxes, stock-order slippage, and broker-specific assignment fees are excluded.",
    ]
    if common_end.date() < end:
        warnings.append(
            f"Results end on {common_end.strftime('%Y-%m-%d')}, the last completed requested-DTE cycle."
        )

    base_cycles = scenario_results["base"]["cycles"]
    actual_dtes = [cycle["dte"] for cycle in base_cycles]

    return {
        "ticker": ticker,
        "strategy": strategy_id,
        "strategy_label": strategy["label"],
        "strategy_description": strategy["description"],
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "effective_start": common_start.strftime("%Y-%m-%d"),
        "effective_end": common_end.strftime("%Y-%m-%d"),
        "modeled": True,
        "assumptions": {
            "initial_capital": round(initial_capital, 2),
            "capital_allocation_pct": round(capital_allocation, 6),
            "target_dte": target_dte,
            "target_delta": round(target_delta, 4),
            "wing_delta": round(wing_delta, 4),
            "actual_dte_min": min(actual_dtes),
            "actual_dte_max": max(actual_dtes),
            "expiration_schedule": "nearest historical trading date to the requested calendar DTE",
            "same_expiration_legs": True,
            "strike_selection": "per-leg target delta, percentage from spot, or fixed modeled strike",
            "leg_rules": leg_rules,
            "pricing_model": pricing_model,
            "volatility_model": "trailing realized volatility scaled by contemporaneous volatility-index regime",
            "volatility_index": selected_volatility_index,
            "commission_per_contract": round(commission, 2),
            "slippage_pct": round(slippage_pct, 6),
            "minimum_slippage": round(minimum_slippage, 4),
            "contract_multiplier": CONTRACT_MULTIPLIER,
            "capitalization": (
                f"{strategy['capitalization']}; up to {capital_allocation:.0%} of equity is allocated and "
                "contracts resize at each entry"
            ),
        },
        "benchmark": {
            "label": f"{ticker} buy and hold with dividends reinvested",
            "metrics": _series_metrics(benchmark, benchmark_history["rate"]),
            "curve": _curve_payload(benchmark),
        },
        "scenarios": scenario_results,
        "warnings": warnings,
        "data_sources": {
            "underlying": "Yahoo Finance daily unadjusted prices and dividends",
            "volatility": selected_volatility_index,
            "risk_free_rate": "^IRX 13-week Treasury bill yield",
            "option_quotes": "Modeled; no historical option quotes used",
        },
    }
