"""Shared accumulation comparison engine.

The simulator keeps total return, price movement, and cash distributions
consistent.  A monthly total-return draw is split into a synthetic ex-
distribution price move plus a cash distribution, which is immediately
reinvested.  Monthly contributions are invested after that month's return.

This module is Flask-free so the recurrence and scenario behavior can be unit
tested without a database or network connection.
"""

from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd

from cash_flow import HOLDING_SCENARIO_PROFILES


SCENARIOS = ("bullish", "neutral", "bearish")

RETURN_PRIORS = {
    "option_income": 0.075,
    "high_distribution_option": 0.065,
    "fixed_income": 0.05,
    "cash": 0.035,
    "preferred_credit": 0.06,
    "bdc": 0.08,
    "cef": 0.065,
    "reit": 0.075,
    "dividend_growth": 0.08,
    "equity_income": 0.075,
    "commodities": 0.06,
    "non_income_equity": 0.09,
    "other": 0.075,
}

VOLATILITY_PRIORS = {
    "option_income": 0.16,
    "high_distribution_option": 0.24,
    "fixed_income": 0.07,
    "cash": 0.01,
    "preferred_credit": 0.13,
    "bdc": 0.25,
    "cef": 0.20,
    "reit": 0.22,
    "dividend_growth": 0.16,
    "equity_income": 0.17,
    "commodities": 0.22,
    "non_income_equity": 0.20,
    "other": 0.18,
}

BETA_PRIORS = {
    "option_income": 0.75,
    "high_distribution_option": 0.95,
    "fixed_income": 0.15,
    "cash": 0.0,
    "preferred_credit": 0.45,
    "bdc": 1.05,
    "cef": 0.75,
    "reit": 0.85,
    "dividend_growth": 0.80,
    "equity_income": 0.80,
    "commodities": 0.55,
    "non_income_equity": 1.05,
    "other": 0.80,
}

SUSTAINABLE_YIELD_CAPS = {
    "option_income": 0.25,
    "high_distribution_option": 0.45,
    "fixed_income": 0.15,
    "cash": 0.12,
    "preferred_credit": 0.18,
    "bdc": 0.22,
    "cef": 0.20,
    "reit": 0.15,
    "dividend_growth": 0.12,
    "equity_income": 0.15,
    "commodities": 0.18,
    "non_income_equity": 0.08,
    "other": 0.18,
}

MAX_TICKERS_PER_STRATEGY = 250
MAX_RETURN_PATH_CELLS = 20_000_000

_ASSUMPTION_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_ASSUMPTION_TTL_SECONDS = 60 * 60


@dataclass(frozen=True)
class SimulationSettings:
    years: int
    starting_capital: float
    monthly_contribution: float
    inflation_rate: float
    freedom_monthly_target: float
    spending_rate: float
    paths: int
    seed: int


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _clip(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _percentiles(values: np.ndarray) -> dict[str, float]:
    if values.size == 0:
        return {"p10": 0.0, "p50": 0.0, "p90": 0.0}
    p10, p50, p90 = np.percentile(values, [10, 50, 90])
    return {
        "p10": round(float(p10), 2),
        "p50": round(float(p50), 2),
        "p90": round(float(p90), 2),
    }


def _stable_seed(base_seed: int, *parts: str) -> int:
    material = "|".join([str(base_seed), *parts]).encode("utf-8")
    return int.from_bytes(hashlib.sha256(material).digest()[:8], "big") % (2**32)


def normalize_strategy(strategy: dict[str, Any]) -> dict[str, Any]:
    """Validate one strategy and normalize positive holding weights to 100%."""
    name = str(strategy.get("name") or "Strategy").strip()[:80] or "Strategy"
    style = str(strategy.get("style") or "custom").strip().lower()
    if style not in {"income", "growth", "custom", "blend"}:
        style = "custom"

    combined: dict[str, dict[str, Any]] = {}
    for raw in strategy.get("holdings") or []:
        ticker = str(raw.get("ticker") or "").strip().upper()
        weight = _finite(raw.get("weight"), 0.0)
        if not ticker or weight <= 0:
            continue
        if ticker not in combined:
            combined[ticker] = {
                "ticker": ticker,
                "weight": 0.0,
                "description": str(raw.get("description") or ticker)[:200],
                "scenario_type": str(raw.get("scenario_type") or "other"),
                "current_yield_pct": max(0.0, _finite(raw.get("current_yield_pct"), 0.0)),
                "current_price": max(0.0, _finite(raw.get("current_price"), 0.0)),
            }
        combined[ticker]["weight"] += weight

    if not combined:
        raise ValueError(f"{name}: add at least one ticker with a positive weight.")
    if len(combined) > MAX_TICKERS_PER_STRATEGY:
        raise ValueError(
            f"{name}: a maximum of {MAX_TICKERS_PER_STRATEGY} tickers is supported."
        )

    total = sum(row["weight"] for row in combined.values())
    holdings = []
    for row in combined.values():
        row["weight"] = row["weight"] / total
        if row["scenario_type"] not in HOLDING_SCENARIO_PROFILES:
            row["scenario_type"] = "other"
        holdings.append(row)
    holdings.sort(key=lambda row: (-row["weight"], row["ticker"]))
    return {"name": name, "style": style, "holdings": holdings}


def validate_settings(payload: dict[str, Any]) -> SimulationSettings:
    years = int(_finite(payload.get("years"), 10))
    if years < 1 or years > 25:
        raise ValueError("Timeframe must be between 1 and 25 years.")
    starting_capital = _finite(payload.get("starting_capital"), 100000)
    if starting_capital <= 0:
        raise ValueError("Starting capital must be greater than zero.")
    monthly_contribution = _finite(payload.get("monthly_contribution"), 0)
    if monthly_contribution < 0:
        raise ValueError("Monthly contribution cannot be negative.")
    inflation_rate = _finite(payload.get("inflation_rate"), 2.5)
    if inflation_rate < 0 or inflation_rate > 20:
        raise ValueError("Inflation must be between 0% and 20%.")
    freedom_target = _finite(payload.get("freedom_monthly_target"), 0)
    if freedom_target < 0:
        raise ValueError("Freedom target cannot be negative.")
    spending_rate = _finite(payload.get("spending_rate"), 4.0)
    if spending_rate <= 0 or spending_rate > 20:
        raise ValueError("Spending rate must be greater than 0% and no more than 20%.")
    paths = int(_finite(payload.get("paths"), 500))
    if paths < 100 or paths > 2000:
        raise ValueError("Monte Carlo paths must be between 100 and 2,000.")
    seed = int(_finite(payload.get("seed"), 73129))
    return SimulationSettings(
        years=years,
        starting_capital=starting_capital,
        monthly_contribution=monthly_contribution,
        inflation_rate=inflation_rate / 100.0,
        freedom_monthly_target=freedom_target,
        spending_rate=spending_rate / 100.0,
        paths=paths,
        seed=seed,
    )


def _extract_ticker_frame(raw: pd.DataFrame, ticker: str) -> pd.DataFrame | None:
    if raw is None or raw.empty:
        return None
    if not isinstance(raw.columns, pd.MultiIndex):
        return raw.copy()
    level0 = set(str(value) for value in raw.columns.get_level_values(0))
    level1 = set(str(value) for value in raw.columns.get_level_values(1))
    if ticker in level0:
        return raw[ticker].copy()
    if ticker in level1:
        return raw.xs(ticker, axis=1, level=1).copy()
    return None


def download_histories(tickers: list[str]) -> dict[str, pd.DataFrame]:
    """Download up to ten years of price and distribution history in one batch."""
    import yfinance as yf

    symbols = list(dict.fromkeys([*tickers, "SPY"]))
    raw = yf.download(
        symbols if len(symbols) > 1 else symbols[0],
        period="10y",
        interval="1d",
        auto_adjust=False,
        actions=True,
        group_by="ticker",
        progress=False,
        threads=True,
    )
    return {
        ticker: frame
        for ticker in symbols
        if (frame := _extract_ticker_frame(raw, ticker)) is not None
    }


def _monthly_total_returns(frame: pd.DataFrame) -> tuple[pd.Series, pd.Series, pd.Series]:
    close = pd.to_numeric(frame.get("Close"), errors="coerce").dropna()
    if close.empty:
        return pd.Series(dtype=float), pd.Series(dtype=float), pd.Series(dtype=float)
    dividends = frame.get("Dividends")
    if dividends is None:
        dividends = pd.Series(0.0, index=frame.index)
    dividends = pd.to_numeric(dividends, errors="coerce").fillna(0.0)
    monthly_close = close.resample("ME").last().dropna()
    monthly_dividends = dividends.resample("ME").sum().reindex(monthly_close.index, fill_value=0.0)
    prior_close = monthly_close.shift(1)
    total_returns = ((monthly_close + monthly_dividends) / prior_close - 1.0).replace(
        [np.inf, -np.inf], np.nan
    ).dropna()
    return monthly_close, monthly_dividends, total_returns


def _annual_distribution_growth(monthly_dividends: pd.Series) -> float | None:
    if monthly_dividends.empty:
        return None
    annual = monthly_dividends.groupby(monthly_dividends.index.year).sum()
    current_year = pd.Timestamp.now().year
    annual = annual[annual.index < current_year]
    annual = annual[annual > 0]
    if len(annual) < 3:
        return None
    growth = annual.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
    if growth.empty:
        return None
    return _clip(float(growth.median()), -0.50, 0.25)


def build_market_assumptions(
    holdings: list[dict[str, Any]],
    *,
    history_loader: Callable[[list[str]], dict[str, pd.DataFrame]] | None = None,
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Calibrate ticker assumptions while falling back visibly to class priors."""
    by_ticker = {row["ticker"]: row for row in holdings}
    tickers = sorted(by_ticker)
    loader = history_loader or download_histories
    warnings: list[str] = []
    try:
        histories = loader(tickers)
    except Exception as exc:
        histories = {}
        warnings.append(f"Market history download failed; class assumptions were used ({exc}).")

    spy_frame = histories.get("SPY")
    _, _, spy_returns = _monthly_total_returns(spy_frame) if spy_frame is not None else (
        pd.Series(dtype=float),
        pd.Series(dtype=float),
        pd.Series(dtype=float),
    )
    market_var = float(spy_returns.var()) if len(spy_returns) >= 24 else 0.0

    assumptions: dict[str, dict[str, Any]] = {}
    now = time.time()
    for ticker in tickers:
        raw_holding = by_ticker[ticker]
        scenario_type = raw_holding.get("scenario_type", "other")
        if scenario_type not in HOLDING_SCENARIO_PROFILES:
            scenario_type = "other"
        cache_key = f"{ticker}|{scenario_type}"
        cached = _ASSUMPTION_CACHE.get(cache_key)
        if history_loader is None and cached and now - cached[0] < _ASSUMPTION_TTL_SECONDS:
            row = dict(cached[1])
            row["scenario_type"] = scenario_type
            assumptions[ticker] = row
            continue

        prior_return = RETURN_PRIORS[scenario_type]
        prior_vol = VOLATILITY_PRIORS[scenario_type]
        prior_beta = BETA_PRIORS[scenario_type]
        profile = HOLDING_SCENARIO_PROFILES[scenario_type]
        neutral_div_growth = _finite(profile["neutral"].get("income_growth"), 0.0)
        supplied_yield = max(0.0, _finite(raw_holding.get("current_yield_pct"), 0.0) / 100.0)
        supplied_price = max(0.01, _finite(raw_holding.get("current_price"), 100.0))
        frame = histories.get(ticker)

        source = "class assumption"
        history_years = 0.0
        expected_return = prior_return
        volatility = prior_vol
        beta = prior_beta
        current_price = supplied_price
        current_yield = supplied_yield
        div_growth = neutral_div_growth

        if frame is not None:
            monthly_close, monthly_dividends, returns = _monthly_total_returns(frame)
            if len(returns) >= 12:
                source = "market history + class assumption"
                history_years = len(returns) / 12.0
                log_returns = np.log1p(returns.clip(lower=-0.95))
                historical_return = float(np.expm1(log_returns.mean() * 12.0))
                history_weight = min(0.35, history_years / 10.0 * 0.35)
                expected_return = (
                    prior_return * (1.0 - history_weight)
                    + _clip(historical_return, -0.05, 0.18) * history_weight
                )
                historical_vol = float(returns.std() * math.sqrt(12.0))
                volatility = _clip(
                    prior_vol * (1.0 - history_weight) + historical_vol * history_weight,
                    0.01,
                    0.65,
                )
                aligned = pd.concat([returns.rename("ticker"), spy_returns.rename("market")], axis=1).dropna()
                if market_var > 0 and len(aligned) >= 24:
                    estimated_beta = float(aligned.cov().loc["ticker", "market"] / market_var)
                    beta = _clip(estimated_beta, -0.25, 2.0)
                if not monthly_close.empty:
                    current_price = max(0.01, float(monthly_close.iloc[-1]))
                    cutoff = monthly_close.index[-1] - pd.Timedelta(days=365)
                    ttm_dividends = float(monthly_dividends[monthly_dividends.index >= cutoff].sum())
                    if ttm_dividends > 0:
                        current_yield = ttm_dividends / current_price
                    historical_div_growth = _annual_distribution_growth(monthly_dividends)
                    if historical_div_growth is not None:
                        div_growth = neutral_div_growth * 0.70 + historical_div_growth * 0.30

        if history_years < 2:
            warnings.append(
                f"{ticker}: limited price history; long-term class assumptions carry most of the forecast."
            )
        if current_yield > 0.20:
            warnings.append(
                f"{ticker}: current distribution rate is above 20%; payout stress assumptions materially affect results."
            )

        row = {
            "ticker": ticker,
            "description": raw_holding.get("description") or ticker,
            "scenario_type": scenario_type,
            "scenario_label": profile["label"],
            "current_price": round(current_price, 6),
            "current_yield": round(_clip(current_yield, 0.0, 0.80), 8),
            "expected_total_return": round(_clip(expected_return, -0.10, 0.20), 8),
            "annual_volatility": round(volatility, 8),
            "beta": round(beta, 6),
            "neutral_distribution_growth": round(_clip(div_growth, -0.25, 0.15), 8),
            "sustainable_yield_cap": SUSTAINABLE_YIELD_CAPS[scenario_type],
            "history_years": round(history_years, 1),
            "source": source,
        }
        assumptions[ticker] = row
        if history_loader is None:
            _ASSUMPTION_CACHE[cache_key] = (now, dict(row))
    return assumptions, list(dict.fromkeys(warnings))


def _scenario_month_parameters(
    assumption: dict[str, Any],
    scenario: str,
    month_index: int,
) -> tuple[float, float, float]:
    """Return annual total return, volatility multiplier, and DPS growth."""
    scenario_type = assumption["scenario_type"]
    profile = HOLDING_SCENARIO_PROFILES[scenario_type]
    neutral_return = _finite(assumption["expected_total_return"], RETURN_PRIORS[scenario_type])
    neutral_income_growth = _finite(
        assumption["neutral_distribution_growth"],
        profile["neutral"].get("income_growth", 0.0),
    )

    if scenario == "bullish":
        if month_index < 36:
            uplift = (
                _finite(profile["bullish"].get("total_return"), neutral_return)
                - _finite(profile["neutral"].get("total_return"), neutral_return)
            )
            annual_return = neutral_return + uplift
            income_growth = _finite(profile["bullish"].get("income_growth"), neutral_income_growth)
            return annual_return, 0.90, income_growth
        if month_index < 48:
            fade = 1.0 - (month_index - 36) / 12.0
            uplift = (
                _finite(profile["bullish"].get("total_return"), neutral_return)
                - _finite(profile["neutral"].get("total_return"), neutral_return)
            )
            bull_income = _finite(profile["bullish"].get("income_growth"), neutral_income_growth)
            return (
                neutral_return + uplift * fade,
                0.90 + 0.10 * (1.0 - fade),
                neutral_income_growth + (bull_income - neutral_income_growth) * fade,
            )
    elif scenario == "bearish":
        bear = profile["bearish"]
        if month_index < 12:
            annual_return = _finite(bear.get("total_return"), -0.20)
            annual_income_factor = max(0.05, 1.0 + _finite(bear.get("income_shock"), -0.10))
            return annual_return, 1.50, annual_income_factor - 1.0
        if month_index < 36:
            return (
                _finite(bear.get("recovery_total_return"), neutral_return),
                1.15,
                _finite(bear.get("recovery_income_growth"), neutral_income_growth),
            )
        if month_index < 48:
            fade = 1.0 - (month_index - 36) / 12.0
            recovery_return = _finite(bear.get("recovery_total_return"), neutral_return)
            recovery_income = _finite(bear.get("recovery_income_growth"), neutral_income_growth)
            return (
                neutral_return + (recovery_return - neutral_return) * fade,
                1.0 + 0.15 * fade,
                neutral_income_growth + (recovery_income - neutral_income_growth) * fade,
            )

    return neutral_return, 1.0, neutral_income_growth


def generate_return_paths(
    assumptions: dict[str, dict[str, Any]],
    scenario: str,
    settings: SimulationSettings,
) -> dict[str, dict[str, np.ndarray]]:
    """Generate shared, correlated monthly return and DPS-growth paths."""
    if scenario not in SCENARIOS:
        raise ValueError(f"Unknown market scenario: {scenario}")
    months = settings.years * 12
    common_rng = np.random.default_rng(_stable_seed(settings.seed, scenario, "market"))
    common_z = common_rng.normal(0.0, 1.0, (settings.paths, months))
    market_sigma = 0.16
    output: dict[str, dict[str, np.ndarray]] = {}

    for ticker, assumption in sorted(assumptions.items()):
        ticker_rng = np.random.default_rng(_stable_seed(settings.seed, scenario, ticker))
        idiosyncratic_z = ticker_rng.normal(0.0, 1.0, (settings.paths, months))
        beta = _finite(assumption["beta"], 0.8)
        annual_vol = max(0.0, _finite(assumption["annual_volatility"], 0.18))
        systematic_vol = min(annual_vol * 0.95, abs(beta) * market_sigma)
        residual_vol = math.sqrt(max(annual_vol**2 - systematic_vol**2, (annual_vol * 0.20) ** 2))

        log_returns = np.empty((settings.paths, months), dtype=np.float64)
        dps_growth = np.empty(months, dtype=np.float64)
        for month in range(months):
            annual_return, vol_multiplier, annual_income_growth = _scenario_month_parameters(
                assumption, scenario, month
            )
            annual_return = max(-0.95, annual_return)
            median_log_return = math.log1p(annual_return) / 12.0
            monthly_systematic = systematic_vol * vol_multiplier / math.sqrt(12.0)
            monthly_residual = residual_vol * vol_multiplier / math.sqrt(12.0)
            log_returns[:, month] = (
                median_log_return
                + monthly_systematic * common_z[:, month] * (1.0 if beta >= 0 else -1.0)
                + monthly_residual * idiosyncratic_z[:, month]
            )
            dps_growth[month] = max(0.01, 1.0 + annual_income_growth) ** (1.0 / 12.0)
        output[ticker] = {"log_returns": log_returns, "dps_growth": dps_growth}
    return output


def _simulate_strategy(
    strategy: dict[str, Any],
    assumptions: dict[str, dict[str, Any]],
    paths_by_ticker: dict[str, dict[str, np.ndarray]],
    settings: SimulationSettings,
) -> dict[str, Any]:
    months = settings.years * 12
    portfolio_values = np.zeros((settings.paths, months + 1), dtype=np.float64)
    flow_adjusted_index = np.full((settings.paths, months + 1), 100.0, dtype=np.float64)
    annual_income = np.zeros((settings.paths, months + 1), dtype=np.float64)
    cumulative_distributions = np.zeros(settings.paths, dtype=np.float64)
    portfolio_values[:, 0] = settings.starting_capital

    weights = {row["ticker"]: row["weight"] for row in strategy["holdings"]}
    weighted_yield = 0.0
    ticker_states: dict[str, dict[str, np.ndarray]] = {}
    for holding in strategy["holdings"]:
        ticker = holding["ticker"]
        assumption = assumptions[ticker]
        price = np.full(settings.paths, assumption["current_price"], dtype=np.float64)
        initial_value = settings.starting_capital * holding["weight"]
        shares = np.full(settings.paths, initial_value / assumption["current_price"], dtype=np.float64)
        dps = np.full(
            settings.paths,
            assumption["current_price"] * assumption["current_yield"],
            dtype=np.float64,
        )
        ticker_states[ticker] = {
            "price": price,
            "shares": shares,
            "dps": dps,
            "yield_cap": _finite(
                assumption.get("sustainable_yield_cap"),
                SUSTAINABLE_YIELD_CAPS[assumption["scenario_type"]],
            ),
        }
        annual_income[:, 0] += shares * dps
        weighted_yield += holding["weight"] * assumption["current_yield"]

    for month in range(months):
        month_total = np.zeros(settings.paths, dtype=np.float64)
        month_pre_contribution = np.zeros(settings.paths, dtype=np.float64)
        month_income = np.zeros(settings.paths, dtype=np.float64)
        for ticker, state in ticker_states.items():
            path = paths_by_ticker[ticker]
            # A distribution cannot stay disconnected from the asset value
            # forever. This ceiling prevents a falling-price/high-payout loop
            # from manufacturing infinite shares while still allowing a much
            # higher sustainable rate for option-income strategies.
            payout_per_share = np.minimum(
                state["dps"] / 12.0,
                state["price"] * state["yield_cap"] / 12.0,
            )
            distribution = state["shares"] * payout_per_share
            total_return = np.expm1(path["log_returns"][:, month])
            price_end = state["price"] * (1.0 + total_return) - payout_per_share
            price_end = np.maximum(price_end, state["price"] * 0.01)

            # All distributions are reinvested into the paying security.
            state["shares"] += distribution / price_end
            month_pre_contribution += state["shares"] * price_end
            contribution = settings.monthly_contribution * weights[ticker]
            if contribution > 0:
                state["shares"] += contribution / price_end
            state["price"] = price_end
            state["dps"] = np.minimum(
                state["dps"] * path["dps_growth"][month],
                state["price"] * state["yield_cap"],
            )

            cumulative_distributions += distribution
            month_total += state["shares"] * state["price"]
            month_income += state["shares"] * state["dps"]

        portfolio_values[:, month + 1] = month_total
        monthly_portfolio_factor = np.divide(
            month_pre_contribution,
            portfolio_values[:, month],
            out=np.ones(settings.paths, dtype=np.float64),
            where=portfolio_values[:, month] > 0,
        )
        flow_adjusted_index[:, month + 1] = (
            flow_adjusted_index[:, month] * monthly_portfolio_factor
        )
        annual_income[:, month + 1] = month_income

    inflation_factors = np.power(
        1.0 + settings.inflation_rate,
        np.arange(months + 1, dtype=np.float64) / 12.0,
    )
    real_values = portfolio_values / inflation_factors[np.newaxis, :]
    real_income = annual_income / inflation_factors[np.newaxis, :]

    yearly_series = []
    freedom_year_income = None
    freedom_year_spending = None
    annual_target = settings.freedom_monthly_target * 12.0
    for year in range(settings.years + 1):
        idx = year * 12
        value_pct = _percentiles(portfolio_values[:, idx])
        real_pct = _percentiles(real_values[:, idx])
        income_pct = _percentiles(annual_income[:, idx])
        real_income_pct = _percentiles(real_income[:, idx])
        spending_values = real_values[:, idx] * settings.spending_rate
        spending_pct = _percentiles(spending_values)
        if annual_target > 0:
            income_probability = float(np.mean(real_income[:, idx] >= annual_target) * 100.0)
            spending_probability = float(np.mean(spending_values >= annual_target) * 100.0)
            if year > 0 and freedom_year_income is None and income_probability >= 50:
                freedom_year_income = year
            if year > 0 and freedom_year_spending is None and spending_probability >= 50:
                freedom_year_spending = year
        else:
            income_probability = None
            spending_probability = None
        yearly_series.append({
            "year": year,
            "value": value_pct,
            "real_value": real_pct,
            "annual_income": income_pct,
            "real_annual_income": real_income_pct,
            "spending_capacity": spending_pct,
            "income_target_probability": (
                round(income_probability, 1) if income_probability is not None else None
            ),
            "spending_target_probability": (
                round(spending_probability, 1) if spending_probability is not None else None
            ),
        })

    # Contributions are external cash flows, not investment performance. Risk
    # is therefore measured on a flow-adjusted index so large deposits cannot
    # conceal a bear-market drawdown.
    running_peak = np.maximum.accumulate(flow_adjusted_index, axis=1)
    drawdowns = np.divide(
        flow_adjusted_index,
        running_peak,
        out=np.ones_like(flow_adjusted_index),
        where=running_peak > 0,
    ) - 1.0
    max_drawdown = np.min(drawdowns, axis=1) * 100.0
    final_inflation = inflation_factors[-1]
    final_real_income = annual_income[:, -1] / final_inflation
    final_spending = real_values[:, -1] * settings.spending_rate
    target_income_probability = (
        round(float(np.mean(final_real_income >= annual_target) * 100.0), 1)
        if annual_target > 0 else None
    )
    target_spending_probability = (
        round(float(np.mean(final_spending >= annual_target) * 100.0), 1)
        if annual_target > 0 else None
    )
    target_freedom_probability = (
        round(
            float(
                np.mean(
                    (final_real_income >= annual_target)
                    | (final_spending >= annual_target)
                )
                * 100.0
            ),
            1,
        )
        if annual_target > 0 else None
    )

    summary = {
        "starting_capital": round(settings.starting_capital, 2),
        "monthly_contribution": round(settings.monthly_contribution, 2),
        "total_contributions": round(settings.monthly_contribution * months, 2),
        "total_invested": round(
            settings.starting_capital + settings.monthly_contribution * months, 2
        ),
        "starting_yield_pct": round(weighted_yield * 100.0, 2),
        "final_value": _percentiles(portfolio_values[:, -1]),
        "final_real_value": _percentiles(real_values[:, -1]),
        "final_annual_income": _percentiles(annual_income[:, -1]),
        "final_real_annual_income": _percentiles(final_real_income),
        "final_monthly_income": _percentiles(annual_income[:, -1] / 12.0),
        "final_real_monthly_income": _percentiles(final_real_income / 12.0),
        "spending_capacity": _percentiles(final_spending),
        "cumulative_distributions_reinvested": _percentiles(cumulative_distributions),
        "max_drawdown_pct": _percentiles(max_drawdown),
        "income_target_probability": target_income_probability,
        "spending_target_probability": target_spending_probability,
        "freedom_target_probability": target_freedom_probability,
        "freedom_year_income": freedom_year_income,
        "freedom_year_spending": freedom_year_spending,
    }
    return {
        "name": strategy["name"],
        "style": strategy["style"],
        "holdings": strategy["holdings"],
        "summary": summary,
        "yearly_series": yearly_series,
    }


def run_accumulation_comparison(
    payload: dict[str, Any],
    *,
    history_loader: Callable[[list[str]], dict[str, pd.DataFrame]] | None = None,
    assumptions_override: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Validate, calibrate, and simulate every strategy across all scenarios."""
    settings = validate_settings(payload)
    strategies = [normalize_strategy(row) for row in (payload.get("strategies") or [])]
    if len(strategies) < 2 or len(strategies) > 3:
        raise ValueError("Provide two strategies and, optionally, one blended strategy.")

    holdings_by_ticker: dict[str, dict[str, Any]] = {}
    for strategy in strategies:
        for holding in strategy["holdings"]:
            existing = holdings_by_ticker.get(holding["ticker"])
            if existing is None:
                holdings_by_ticker[holding["ticker"]] = dict(holding)
            else:
                if existing.get("scenario_type") == "other" and holding.get("scenario_type") != "other":
                    existing["scenario_type"] = holding["scenario_type"]
                existing["current_yield_pct"] = max(
                    existing.get("current_yield_pct", 0.0),
                    holding.get("current_yield_pct", 0.0),
                )
                existing["current_price"] = max(
                    existing.get("current_price", 0.0),
                    holding.get("current_price", 0.0),
                )

    return_path_cells = (
        len(holdings_by_ticker)
        * settings.paths
        * settings.years
        * 12
    )
    if return_path_cells > MAX_RETURN_PATH_CELLS:
        max_cells = f"{MAX_RETURN_PATH_CELLS:,}"
        raise ValueError(
            "This ticker, timeframe, and Monte Carlo path combination is too large "
            f"for one run (limit {max_cells} ticker-path-months). Reduce the "
            "simulation length, reduce Monte Carlo paths, or select fewer tickers."
        )

    if assumptions_override is None:
        assumptions, warnings = build_market_assumptions(
            list(holdings_by_ticker.values()),
            history_loader=history_loader,
        )
    else:
        assumptions = assumptions_override
        warnings = []
    missing = sorted(set(holdings_by_ticker) - set(assumptions))
    if missing:
        raise ValueError(f"Missing market assumptions for: {', '.join(missing)}")

    scenario_results: dict[str, Any] = {}
    for scenario in SCENARIOS:
        return_paths = generate_return_paths(assumptions, scenario, settings)
        scenario_results[scenario] = {
            "strategies": [
                _simulate_strategy(strategy, assumptions, return_paths, settings)
                for strategy in strategies
            ]
        }

    return {
        "method": "forward_monte_carlo",
        "scenario_order": list(SCENARIOS),
        "settings": {
            "years": settings.years,
            "starting_capital": settings.starting_capital,
            "monthly_contribution": settings.monthly_contribution,
            "inflation_rate_pct": round(settings.inflation_rate * 100.0, 2),
            "freedom_monthly_target": settings.freedom_monthly_target,
            "spending_rate_pct": round(settings.spending_rate * 100.0, 2),
            "paths": settings.paths,
            "seed": settings.seed,
            "reinvest_distributions_pct": 100,
            "withdrawals": 0,
        },
        "strategies": strategies,
        "assumptions": [assumptions[ticker] for ticker in sorted(assumptions)],
        "data_quality_warnings": warnings,
        "scenarios": scenario_results,
    }
