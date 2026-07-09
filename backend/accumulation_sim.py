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
import os
import tempfile
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

OPTION_STRATEGIES = {
    "auto",
    "none",
    "covered_call",
    "short_put",
    "put_spread",
    "short_put_spread",
    "protective_put_spread",
    "collar_buffer",
    "mixed_options",
}

CORRELATION_GROUPS = {
    "auto",
    "us_equity",
    "sp500",
    "nasdaq",
    "small_cap",
    "technology",
    "semiconductors",
    "international",
    "option_income",
    "fixed_income",
    "cash",
    "preferred_credit",
    "real_estate",
    "commodities",
    "precious_metals",
    "crypto",
    "single_stock",
    "other",
}

# These are deliberately modest planning adjustments, not claims about any
# particular fund.  They only apply when the user or fund metadata identifies
# the option structure; "put_spread" remains neutral because the direction of
# an unspecified put spread cannot be inferred safely.
OPTION_STRATEGY_PHASE_ADJUSTMENTS = {
    "covered_call": {
        "neutral": (-0.003, 0.90),
        "bull": (-0.015, 0.90),
        "bear_shock": (0.030, 0.90),
        "recovery": (-0.005, 0.90),
    },
    "short_put": {
        "neutral": (0.000, 1.05),
        "bull": (0.000, 1.05),
        "bear_shock": (-0.040, 1.10),
        "recovery": (0.000, 1.05),
    },
    "short_put_spread": {
        "neutral": (-0.002, 0.95),
        "bull": (-0.003, 0.95),
        "bear_shock": (-0.015, 1.00),
        "recovery": (-0.002, 0.95),
    },
    "protective_put_spread": {
        "neutral": (-0.005, 0.80),
        "bull": (-0.010, 0.80),
        "bear_shock": (0.080, 0.70),
        "recovery": (-0.005, 0.80),
    },
    "collar_buffer": {
        "neutral": (-0.006, 0.75),
        "bull": (-0.018, 0.75),
        "bear_shock": (0.100, 0.65),
        "recovery": (-0.006, 0.75),
    },
}

MAX_TICKERS_PER_STRATEGY = 250
# Larger path cubes transparently spill to a temporary float32 memory map.
# This threshold is a performance choice, not a user-facing workload limit.
IN_MEMORY_RETURN_PATH_CELLS = 20_000_000

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
    fi_confidence: float = 0.85
    money_lasts_years: int = 25


@dataclass(frozen=True)
class SustainabilityOptions:
    """Optional tests gating whether projected 'freedom' income is realistic.

    Every field defaults to off/neutral so a request with no ``sustainability``
    block reproduces today's ``freedom_target_probability`` exactly.
    """

    apply_tax: bool
    tax_rate: float  # fraction, 0..1
    cap_payout_to_total_return: bool
    check_drip_stop_stability: bool
    run_withdrawal_phase: bool
    withdrawal_years: int


_DEFAULT_SUSTAINABILITY = SustainabilityOptions(
    apply_tax=False,
    tax_rate=0.0,
    cap_payout_to_total_return=False,
    check_drip_stop_stability=False,
    run_withdrawal_phase=False,
    withdrawal_years=20,
)


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


def _choice(value: Any, allowed: set[str], default: str) -> str:
    normalized = str(value or default).strip().lower().replace("-", "_").replace(" ", "_")
    return normalized if normalized in allowed else default


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
                "classification_type": str(raw.get("classification_type") or "")[:80],
                "etf_category": str(raw.get("etf_category") or "")[:120],
                "etf_strategy": str(raw.get("etf_strategy") or "")[:120],
                "fund_kind": str(raw.get("fund_kind") or "")[:80],
                "income_bucket": str(raw.get("income_bucket") or "")[:120],
                "scenario_type_override": str(
                    raw.get("scenario_type_override") or ""
                ).strip().lower(),
                "option_strategy": _choice(
                    raw.get("option_strategy"), OPTION_STRATEGIES, "auto"
                ),
                "correlation_group": _choice(
                    raw.get("correlation_group"), CORRELATION_GROUPS, "auto"
                ),
            }
        else:
            existing = combined[ticker]
            for field in (
                "classification_type",
                "etf_category",
                "etf_strategy",
                "fund_kind",
                "income_bucket",
            ):
                if not existing.get(field) and raw.get(field):
                    existing[field] = str(raw.get(field))[:120]
            raw_option = _choice(raw.get("option_strategy"), OPTION_STRATEGIES, "auto")
            raw_group = _choice(raw.get("correlation_group"), CORRELATION_GROUPS, "auto")
            if existing.get("option_strategy") == "auto" and raw_option != "auto":
                existing["option_strategy"] = raw_option
            if existing.get("correlation_group") == "auto" and raw_group != "auto":
                existing["correlation_group"] = raw_group
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
    fi_confidence_pct = _clip(_finite(payload.get("fi_confidence_pct"), 85.0), 50.0, 99.0)
    # "Money must last (years)" is a shared assumption; fall back to the legacy
    # sustainability.withdrawal_years when the newer field is not supplied.
    sustainability_block = payload.get("sustainability") or {}
    money_default = 25.0
    if payload.get("money_lasts_years") is None and sustainability_block.get("withdrawal_years") is not None:
        money_default = _finite(sustainability_block.get("withdrawal_years"), 25.0)
    money_lasts_years = int(round(_clip(_finite(payload.get("money_lasts_years"), money_default), 1.0, 40.0)))
    return SimulationSettings(
        years=years,
        starting_capital=starting_capital,
        monthly_contribution=monthly_contribution,
        inflation_rate=inflation_rate / 100.0,
        freedom_monthly_target=freedom_target,
        spending_rate=spending_rate / 100.0,
        paths=paths,
        seed=seed,
        fi_confidence=fi_confidence_pct / 100.0,
        money_lasts_years=money_lasts_years,
    )


def validate_sustainability(payload: dict[str, Any]) -> SustainabilityOptions:
    apply_tax = bool(payload.get("apply_tax", False))
    tax_rate_pct = _clip(_finite(payload.get("tax_rate_pct"), 15.0), 0.0, 100.0)
    withdrawal_years = int(round(_clip(_finite(payload.get("withdrawal_years"), 20.0), 1.0, 40.0)))
    return SustainabilityOptions(
        apply_tax=apply_tax,
        tax_rate=tax_rate_pct / 100.0,
        cap_payout_to_total_return=bool(payload.get("cap_payout_to_total_return", False)),
        check_drip_stop_stability=bool(payload.get("check_drip_stop_stability", False)),
        run_withdrawal_phase=bool(payload.get("run_withdrawal_phase", False)),
        withdrawal_years=withdrawal_years,
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


def _holding_text(holding: dict[str, Any]) -> str:
    return " ".join(
        str(holding.get(field) or "")
        for field in (
            "ticker",
            "description",
            "classification_type",
            "etf_category",
            "etf_strategy",
            "fund_kind",
            "income_bucket",
        )
    ).lower().replace("-", " ").replace("_", " ")


def _infer_option_strategy(holding: dict[str, Any]) -> str:
    explicit = _choice(holding.get("option_strategy"), OPTION_STRATEGIES, "auto")
    if explicit != "auto":
        return explicit
    text = _holding_text(holding)
    if any(phrase in text for phrase in ("collar", "buffer etf", "defined outcome")):
        return "collar_buffer"
    if "put spread" in text:
        if any(phrase in text for phrase in ("protective", "hedge", "downside protection")):
            return "protective_put_spread"
        if any(phrase in text for phrase in ("credit spread", "short put spread", "put credit")):
            return "short_put_spread"
        return "put_spread"
    if any(
        phrase in text
        for phrase in ("cash secured put", "cash-secured put", "putwrite", "put write")
    ):
        return "short_put"
    if any(phrase in text for phrase in ("covered call", "buy write", "buywrite")):
        return "covered_call"
    if holding.get("scenario_type") in {"option_income", "high_distribution_option"}:
        return "mixed_options"
    return "none"


def _infer_correlation_group(holding: dict[str, Any]) -> str:
    explicit = _choice(holding.get("correlation_group"), CORRELATION_GROUPS, "auto")
    if explicit != "auto":
        return explicit
    text = _holding_text(holding)
    ticker = str(holding.get("ticker") or "").upper()
    scenario_type = str(holding.get("scenario_type") or "other")

    if scenario_type == "cash":
        return "cash"
    if scenario_type == "fixed_income":
        return "fixed_income"
    if scenario_type == "preferred_credit":
        return "preferred_credit"
    if scenario_type == "reit":
        return "real_estate"
    if any(phrase in text for phrase in ("bitcoin", "ethereum", "crypto")):
        return "crypto"
    if any(phrase in text for phrase in ("gold", "silver", "precious metal")):
        return "precious_metals"
    if scenario_type == "commodities" or any(
        phrase in text for phrase in ("commodity", "natural resources", "midstream")
    ):
        return "commodities"
    if any(phrase in text for phrase in ("semiconductor", "semiconductors")):
        return "semiconductors"
    if any(phrase in text for phrase in ("nasdaq", "qqq")):
        return "nasdaq"
    if any(phrase in text for phrase in ("s&p 500", "s & p 500", "sp 500")) or ticker in {
        "SPY", "SPYM", "VOO", "IVV", "RSP",
    }:
        return "sp500"
    if any(phrase in text for phrase in ("russell 2000", "small cap")):
        return "small_cap"
    if any(phrase in text for phrase in ("technology", "software", "innovation", "ai etf")):
        return "technology"
    if any(phrase in text for phrase in ("international", "overseas", "emerging market")):
        return "international"
    if scenario_type in {"option_income", "high_distribution_option"}:
        return "option_income"
    if scenario_type in {"dividend_growth", "equity_income", "non_income_equity", "bdc"}:
        return "us_equity"
    return "other"


def _fallback_correlation(left: dict[str, Any], right: dict[str, Any]) -> float:
    """Conservative correlation prior used when history is short or missing."""
    left_group = left.get("correlation_group") or _infer_correlation_group(left)
    right_group = right.get("correlation_group") or _infer_correlation_group(right)
    left_type = left.get("scenario_type", "other")
    right_type = right.get("scenario_type", "other")

    if left_group == right_group:
        return {
            "cash": 0.20,
            "fixed_income": 0.65,
            "preferred_credit": 0.65,
            "precious_metals": 0.65,
            "commodities": 0.55,
            "crypto": 0.72,
            "option_income": 0.72,
            "single_stock": 0.55,
            "other": 0.45,
        }.get(left_group, 0.78)

    defensive = {"cash", "fixed_income"}
    equity_like = {
        "us_equity", "sp500", "nasdaq", "small_cap", "technology",
        "semiconductors", "international", "option_income", "single_stock",
        "real_estate", "preferred_credit",
    }
    commodity_like = {"commodities", "precious_metals", "crypto"}
    if left_group in defensive and right_group in defensive:
        return 0.40
    if (left_group in defensive) != (right_group in defensive):
        return 0.10 if "cash" not in {left_group, right_group} else 0.03
    if left_group in equity_like and right_group in equity_like:
        correlation = 0.58
        if "option_income" in {left_group, right_group}:
            correlation = 0.65
        return correlation
    if left_group in commodity_like and right_group in commodity_like:
        return 0.35
    if (
        left_group in equity_like and right_group in commodity_like
    ) or (
        right_group in equity_like and left_group in commodity_like
    ):
        return 0.25
    if left_type == right_type:
        return 0.50
    return 0.30


def _correlation_floor(left: dict[str, Any], right: dict[str, Any]) -> float:
    left_group = left.get("correlation_group") or _infer_correlation_group(left)
    right_group = right.get("correlation_group") or _infer_correlation_group(right)
    if left_group != right_group:
        return -0.25
    return {
        "option_income": 0.60,
        "sp500": 0.70,
        "nasdaq": 0.70,
        "technology": 0.65,
        "semiconductors": 0.65,
        "us_equity": 0.60,
        "fixed_income": 0.45,
        "crypto": 0.55,
    }.get(left_group, 0.35)


def _attach_correlation_assumptions(
    assumptions: dict[str, dict[str, Any]],
    returns_by_ticker: dict[str, pd.Series],
) -> None:
    """Blend pairwise history with conservative similarity-based priors."""
    tickers = sorted(assumptions)
    correlations = {ticker: {ticker: 1.0} for ticker in tickers}
    correlation_months = {ticker: {ticker: 0} for ticker in tickers}
    for left_index, left_ticker in enumerate(tickers):
        left = assumptions[left_ticker]
        for right_ticker in tickers[left_index + 1:]:
            right = assumptions[right_ticker]
            fallback = _fallback_correlation(left, right)
            overlap_months = 0
            correlation = fallback
            left_returns = returns_by_ticker.get(left_ticker)
            right_returns = returns_by_ticker.get(right_ticker)
            if left_returns is not None and right_returns is not None:
                aligned = pd.concat(
                    [left_returns.rename("left"), right_returns.rename("right")],
                    axis=1,
                ).dropna()
                overlap_months = len(aligned)
                if overlap_months >= 18:
                    historical = float(aligned["left"].corr(aligned["right"]))
                    if math.isfinite(historical):
                        history_weight = min(0.85, max(0.10, (overlap_months - 12) / 60.0))
                        correlation = (
                            historical * history_weight
                            + fallback * (1.0 - history_weight)
                        )
            correlation = max(correlation, _correlation_floor(left, right))
            correlation = _clip(correlation, -0.35, 0.95)
            correlations[left_ticker][right_ticker] = round(correlation, 6)
            correlations[right_ticker][left_ticker] = round(correlation, 6)
            correlation_months[left_ticker][right_ticker] = overlap_months
            correlation_months[right_ticker][left_ticker] = overlap_months

    for ticker in tickers:
        others = [
            value for other, value in correlations[ticker].items() if other != ticker
        ]
        assumptions[ticker]["correlations"] = correlations[ticker]
        assumptions[ticker]["correlation_history_months"] = correlation_months[ticker]
        assumptions[ticker]["average_correlation"] = round(
            float(np.mean(others)) if others else 1.0,
            4,
        )


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

    history_metrics: dict[str, tuple[pd.Series, pd.Series, pd.Series]] = {}
    for ticker, frame in histories.items():
        history_metrics[ticker] = _monthly_total_returns(frame)
    empty_series = pd.Series(dtype=float)
    _, _, spy_returns = history_metrics.get(
        "SPY", (empty_series, empty_series, empty_series)
    )
    returns_by_ticker = {
        ticker: metrics[2]
        for ticker, metrics in history_metrics.items()
        if ticker in by_ticker and not metrics[2].empty
    }
    market_var = float(spy_returns.var()) if len(spy_returns) >= 24 else 0.0

    assumptions: dict[str, dict[str, Any]] = {}
    now = time.time()
    for ticker in tickers:
        raw_holding = by_ticker[ticker]
        scenario_type = raw_holding.get("scenario_type", "other")
        if scenario_type not in HOLDING_SCENARIO_PROFILES:
            scenario_type = "other"
        option_strategy = _infer_option_strategy({
            **raw_holding,
            "scenario_type": scenario_type,
        })
        correlation_group = _infer_correlation_group({
            **raw_holding,
            "scenario_type": scenario_type,
        })
        cache_key = f"{ticker}|{scenario_type}|{option_strategy}|{correlation_group}"
        cached = _ASSUMPTION_CACHE.get(cache_key)
        if history_loader is None and cached and now - cached[0] < _ASSUMPTION_TTL_SECONDS:
            row = dict(cached[1])
            row["scenario_type"] = scenario_type
            row["option_strategy"] = option_strategy
            row["correlation_group"] = correlation_group
            row.pop("correlations", None)
            row.pop("correlation_history_months", None)
            history_confidence = _clip(
                _finite(row.get("history_years"), 0.0) / 5.0, 0.0, 1.0
            )
            row["history_confidence_pct"] = round(history_confidence * 100.0, 1)
            row["forecast_annual_volatility"] = round(
                _clip(
                    _finite(row.get("annual_volatility"), VOLATILITY_PRIORS[scenario_type])
                    * (1.0 + (1.0 - history_confidence) * 0.25),
                    0.01,
                    0.80,
                ),
                8,
            )
            assumptions[ticker] = row
            if _finite(row.get("history_years"), 0.0) < 3:
                warnings.append(
                    f"{ticker}: limited price history; forecast uncertainty was widened "
                    "and conservative correlation assumptions were used."
                )
            if _finite(row.get("current_yield"), 0.0) > 0.20:
                warnings.append(
                    f"{ticker}: current distribution rate is above 20%; payout stress "
                    "assumptions materially affect results."
                )
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
            monthly_close, monthly_dividends, returns = history_metrics.get(
                ticker, (empty_series, empty_series, empty_series)
            )
            if len(returns) >= 12:
                source = "market history + class assumption"
                history_years = len(returns) / 12.0
                # The path generator treats expected total return as an
                # arithmetic expectation, so calibrate history on the same
                # basis before applying the lognormal variance correction.
                mean_monthly_return = float(returns.mean())
                historical_return = float((1.0 + mean_monthly_return) ** 12.0 - 1.0)
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

        history_confidence = _clip(history_years / 5.0, 0.0, 1.0)
        uncertainty_multiplier = 1.0 + (1.0 - history_confidence) * 0.25
        forecast_volatility = _clip(volatility * uncertainty_multiplier, 0.01, 0.80)

        if history_years < 3:
            warnings.append(
                f"{ticker}: limited price history; forecast uncertainty was widened "
                "and conservative correlation assumptions were used."
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
            "option_strategy": option_strategy,
            "correlation_group": correlation_group,
            "current_price": round(current_price, 6),
            "current_yield": round(_clip(current_yield, 0.0, 0.80), 8),
            "expected_total_return": round(_clip(expected_return, -0.10, 0.20), 8),
            "annual_volatility": round(volatility, 8),
            "forecast_annual_volatility": round(forecast_volatility, 8),
            "history_confidence_pct": round(history_confidence * 100.0, 1),
            "beta": round(beta, 6),
            "neutral_distribution_growth": round(_clip(div_growth, -0.25, 0.15), 8),
            "sustainable_yield_cap": SUSTAINABLE_YIELD_CAPS[scenario_type],
            "history_years": round(history_years, 1),
            "source": source,
        }
        assumptions[ticker] = row
        if history_loader is None:
            _ASSUMPTION_CACHE[cache_key] = (now, dict(row))
    _attach_correlation_assumptions(assumptions, returns_by_ticker)
    return assumptions, list(dict.fromkeys(warnings))


def _apply_option_adjustment(
    assumption: dict[str, Any],
    phase: str,
    annual_return: float,
    volatility_multiplier: float,
) -> tuple[float, float]:
    option_strategy = _choice(
        assumption.get("option_strategy"), OPTION_STRATEGIES, "auto"
    )
    adjustment = OPTION_STRATEGY_PHASE_ADJUSTMENTS.get(option_strategy, {}).get(phase)
    if adjustment is None:
        return annual_return, volatility_multiplier
    return annual_return + adjustment[0], volatility_multiplier * adjustment[1]


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
            annual_return, vol_multiplier = _apply_option_adjustment(
                assumption, "bull", annual_return, 0.90
            )
            return annual_return, vol_multiplier, income_growth
        if month_index < 48:
            fade = 1.0 - (month_index - 36) / 12.0
            uplift = (
                _finite(profile["bullish"].get("total_return"), neutral_return)
                - _finite(profile["neutral"].get("total_return"), neutral_return)
            )
            bull_income = _finite(profile["bullish"].get("income_growth"), neutral_income_growth)
            annual_return, vol_multiplier = _apply_option_adjustment(
                assumption,
                "bull",
                neutral_return + uplift * fade,
                0.90 + 0.10 * (1.0 - fade),
            )
            return (
                annual_return,
                vol_multiplier,
                neutral_income_growth + (bull_income - neutral_income_growth) * fade,
            )
    elif scenario == "bearish":
        bear = profile["bearish"]
        if month_index < 12:
            annual_return = _finite(bear.get("total_return"), -0.20)
            annual_income_factor = max(0.05, 1.0 + _finite(bear.get("income_shock"), -0.10))
            annual_return, vol_multiplier = _apply_option_adjustment(
                assumption, "bear_shock", annual_return, 1.50
            )
            return annual_return, vol_multiplier, annual_income_factor - 1.0
        if month_index < 36:
            annual_return, vol_multiplier = _apply_option_adjustment(
                assumption,
                "recovery",
                _finite(bear.get("recovery_total_return"), neutral_return),
                1.15,
            )
            return (
                annual_return,
                vol_multiplier,
                _finite(bear.get("recovery_income_growth"), neutral_income_growth),
            )
        if month_index < 48:
            fade = 1.0 - (month_index - 36) / 12.0
            recovery_return = _finite(bear.get("recovery_total_return"), neutral_return)
            recovery_income = _finite(bear.get("recovery_income_growth"), neutral_income_growth)
            annual_return, vol_multiplier = _apply_option_adjustment(
                assumption,
                "recovery",
                neutral_return + (recovery_return - neutral_return) * fade,
                1.0 + 0.15 * fade,
            )
            return (
                annual_return,
                vol_multiplier,
                neutral_income_growth + (recovery_income - neutral_income_growth) * fade,
            )

    annual_return, vol_multiplier = _apply_option_adjustment(
        assumption, "neutral", neutral_return, 1.0
    )
    return annual_return, vol_multiplier, neutral_income_growth


def _draw_normal_blocks(
    rng: np.random.Generator, paths: int, accumulation_months: int, withdrawal_months: int
) -> np.ndarray:
    """Draw accumulation, then withdrawal, blocks from one Generator.

    A single ``rng.normal(0, 1, (paths, months))`` call fills row-major, so
    growing ``months`` reshuffles every row after row 0 and silently changes
    the accumulation-phase draws. Drawing two sequential blocks and
    concatenating keeps the accumulation block bit-identical regardless of
    whether a withdrawal phase follows it.
    """
    accumulation_block = rng.normal(0.0, 1.0, (paths, accumulation_months))
    if withdrawal_months <= 0:
        return accumulation_block
    withdrawal_block = rng.normal(0.0, 1.0, (paths, withdrawal_months))
    return np.concatenate([accumulation_block, withdrawal_block], axis=1)


def _nearest_correlation_matrix(matrix: np.ndarray) -> np.ndarray:
    """Return a positive-semidefinite, unit-diagonal correlation matrix."""
    symmetric = (matrix + matrix.T) / 2.0
    eigenvalues, eigenvectors = np.linalg.eigh(symmetric)
    eigenvalues = np.maximum(eigenvalues, 1e-8)
    positive = (eigenvectors * eigenvalues) @ eigenvectors.T
    scale = np.sqrt(np.maximum(np.diag(positive), 1e-12))
    correlation = positive / np.outer(scale, scale)
    np.fill_diagonal(correlation, 1.0)
    return np.clip(correlation, -0.99, 0.99) + np.eye(len(matrix)) * 0.01


def _correlation_matrix(
    assumptions: dict[str, dict[str, Any]],
    tickers: list[str],
) -> np.ndarray:
    matrix = np.eye(len(tickers), dtype=np.float64)
    for left_index, left_ticker in enumerate(tickers):
        left = assumptions[left_ticker]
        for right_index in range(left_index + 1, len(tickers)):
            right_ticker = tickers[right_index]
            right = assumptions[right_ticker]
            stored = (left.get("correlations") or {}).get(right_ticker)
            correlation = (
                _finite(stored, _fallback_correlation(left, right))
                if stored is not None
                else _fallback_correlation(left, right)
            )
            matrix[left_index, right_index] = correlation
            matrix[right_index, left_index] = correlation
    return _nearest_correlation_matrix(matrix)


def _bear_stressed_correlation_matrix(
    base: np.ndarray,
    assumptions: dict[str, dict[str, Any]],
    tickers: list[str],
) -> np.ndarray:
    """Raise dependence during the bear shock, especially among risk assets."""
    stressed = base.copy()
    defensive = {"cash", "fixed_income"}
    for left_index, left_ticker in enumerate(tickers):
        left_group = assumptions[left_ticker].get("correlation_group") or _infer_correlation_group(
            assumptions[left_ticker]
        )
        for right_index in range(left_index + 1, len(tickers)):
            right_ticker = tickers[right_index]
            right_group = assumptions[right_ticker].get(
                "correlation_group"
            ) or _infer_correlation_group(assumptions[right_ticker])
            current = stressed[left_index, right_index]
            if left_group in defensive or right_group in defensive:
                stress_share = 0.08
            else:
                stress_share = 0.30
            correlation = current + (1.0 - current) * stress_share
            stressed[left_index, right_index] = correlation
            stressed[right_index, left_index] = correlation
    return _nearest_correlation_matrix(stressed)


def _cholesky_factor(correlation: np.ndarray) -> np.ndarray:
    try:
        return np.linalg.cholesky(correlation)
    except np.linalg.LinAlgError:
        jittered = correlation + np.eye(len(correlation)) * 1e-6
        return np.linalg.cholesky(_nearest_correlation_matrix(jittered))


def _correlation_model_summary(
    assumptions: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    tickers = sorted(assumptions)
    if len(tickers) < 2:
        return {
            "average_correlation": 0.0,
            "bear_average_correlation": 0.0,
            "historical_pair_count": 0,
            "fallback_pair_count": 0,
            "strongest_pairs": [],
        }
    base = _correlation_matrix(assumptions, tickers)
    bear = _bear_stressed_correlation_matrix(base, assumptions, tickers)
    pairs = []
    historical_count = 0
    for left_index, left_ticker in enumerate(tickers):
        for right_index in range(left_index + 1, len(tickers)):
            right_ticker = tickers[right_index]
            overlap = int(
                (assumptions[left_ticker].get("correlation_history_months") or {}).get(
                    right_ticker, 0
                )
            )
            if overlap >= 18:
                historical_count += 1
            pairs.append({
                "left": left_ticker,
                "right": right_ticker,
                "correlation": round(float(base[left_index, right_index]), 3),
                "bear_correlation": round(float(bear[left_index, right_index]), 3),
                "overlap_months": overlap,
                "source": "history + fallback" if overlap >= 18 else "conservative fallback",
            })
    upper = np.triu_indices(len(tickers), 1)
    pairs.sort(key=lambda row: row["correlation"], reverse=True)
    return {
        "average_correlation": round(float(np.mean(base[upper])), 3),
        "bear_average_correlation": round(float(np.mean(bear[upper])), 3),
        "historical_pair_count": historical_count,
        "fallback_pair_count": len(pairs) - historical_count,
        "strongest_pairs": pairs[:12],
    }


def _allocate_return_path_matrix(
    shape: tuple[int, int, int],
) -> tuple[np.ndarray, str | None]:
    cells = math.prod(shape)
    if cells <= IN_MEMORY_RETURN_PATH_CELLS:
        return np.empty(shape, dtype=np.float32), None

    try:
        _cleanup_stale_return_path_files()
        handle = tempfile.NamedTemporaryFile(
            prefix="portfolio-return-paths-",
            suffix=".bin",
            delete=False,
        )
        storage_path = handle.name
        handle.close()
        matrix = np.memmap(
            storage_path,
            mode="w+",
            dtype=np.float32,
            shape=shape,
        )
        return matrix, storage_path
    except OSError as exc:
        if "storage_path" in locals():
            try:
                os.remove(storage_path)
            except OSError:
                pass
        required_gb = cells * np.dtype(np.float32).itemsize / (1024**3)
        raise ValueError(
            "This large simulation needs temporary working storage "
            f"(about {required_gb:.1f} GB), but it could not be allocated: {exc}"
        ) from exc


def _cleanup_stale_return_path_files(max_age_hours: float = 24.0) -> None:
    """Remove orphaned path stores left by an interrupted backend process."""
    cutoff = time.time() - max_age_hours * 60.0 * 60.0
    try:
        entries = os.scandir(tempfile.gettempdir())
    except OSError:
        return
    with entries:
        for entry in entries:
            if (
                not entry.is_file()
                or not entry.name.startswith("portfolio-return-paths-")
                or not entry.name.endswith(".bin")
            ):
                continue
            try:
                if entry.stat().st_mtime < cutoff:
                    os.remove(entry.path)
            except OSError:
                # Another live simulation may still own the map.
                continue


def _release_return_paths(paths_by_ticker: dict[str, Any] | None) -> None:
    if not paths_by_ticker:
        return
    storage = paths_by_ticker.pop("__storage__", None)
    for ticker_path in paths_by_ticker.values():
        if isinstance(ticker_path, dict):
            ticker_path.pop("log_returns", None)
    if not isinstance(storage, dict):
        return
    matrix = storage.pop("matrix", None)
    storage_path = storage.get("path")
    if isinstance(matrix, np.memmap):
        try:
            matrix.flush()
        finally:
            mmap_handle = getattr(matrix, "_mmap", None)
            if mmap_handle is not None:
                mmap_handle.close()
    if storage_path:
        try:
            os.remove(storage_path)
        except FileNotFoundError:
            pass


def generate_return_paths(
    assumptions: dict[str, dict[str, Any]],
    scenario: str,
    settings: SimulationSettings,
    *,
    withdrawal_months: int = 0,
) -> dict[str, Any]:
    """Generate shared, correlated monthly return and DPS-growth paths.

    ``withdrawal_months`` optionally extends the path beyond the accumulation
    horizon (``settings.years * 12``) for the withdrawal-phase sustainability
    test; the accumulation-phase months are unaffected either way.
    """
    if scenario not in SCENARIOS:
        raise ValueError(f"Unknown market scenario: {scenario}")
    accumulation_months = settings.years * 12
    months = accumulation_months + max(0, withdrawal_months)
    tickers = sorted(assumptions)
    base_correlation = _correlation_matrix(assumptions, tickers)
    base_factor = _cholesky_factor(base_correlation)
    stressed_factor = (
        _cholesky_factor(
            _bear_stressed_correlation_matrix(base_correlation, assumptions, tickers)
        )
        if scenario == "bearish"
        else base_factor
    )

    # One independent source per ticker is transformed by the reviewed
    # correlation matrix. Drawing each source in accumulation/withdrawal blocks
    # preserves the existing path prefix when a withdrawal horizon is added.
    shocks, storage_path = _allocate_return_path_matrix(
        (settings.paths, months, len(tickers))
    )
    output: dict[str, Any] = {
        "__storage__": {
            "matrix": shocks,
            "path": storage_path,
            "ticker_index": {ticker: index for index, ticker in enumerate(tickers)},
            "mode": "temporary_disk" if storage_path else "memory",
        }
    }
    try:
        for ticker_index, ticker in enumerate(tickers):
            shocks[:, :, ticker_index] = _draw_normal_blocks(
                np.random.default_rng(
                    _stable_seed(settings.seed, scenario, "correlation", ticker)
                ),
                settings.paths,
                accumulation_months,
                withdrawal_months,
            )
        path_chunk = 64
        stress_months = min(48, months) if scenario == "bearish" else 0
        for start in range(0, settings.paths, path_chunk):
            stop = min(settings.paths, start + path_chunk)
            block = shocks[start:stop]
            if stress_months > 0:
                block[:, :stress_months, :] = (
                    block[:, :stress_months, :] @ stressed_factor.T
                )
                if stress_months < months:
                    block[:, stress_months:, :] = (
                        block[:, stress_months:, :] @ base_factor.T
                    )
            else:
                block[:] = block @ base_factor.T

        for ticker_index, ticker in enumerate(tickers):
            assumption = assumptions[ticker]
            annual_vol = max(
                0.0,
                _finite(
                    assumption.get("forecast_annual_volatility"),
                    assumption.get("annual_volatility", 0.18),
                ),
            )
            annual_returns = np.empty(months, dtype=np.float64)
            volatility_multipliers = np.empty(months, dtype=np.float64)
            dps_growth = np.empty(months, dtype=np.float64)
            for month in range(months):
                annual_return, vol_multiplier, annual_income_growth = _scenario_month_parameters(
                    assumption, scenario, month
                )
                annual_returns[month] = max(-0.95, annual_return)
                volatility_multipliers[month] = max(0.0, vol_multiplier)
                dps_growth[month] = max(
                    0.01, 1.0 + annual_income_growth
                ) ** (1.0 / 12.0)

            monthly_sigma = annual_vol * volatility_multipliers / math.sqrt(12.0)
            # ``expected_total_return`` is an arithmetic expectation. A
            # lognormal draw therefore needs the -½ variance term; omitting it
            # gives volatile funds a free return uplift.
            log_drift = np.log1p(annual_returns) / 12.0 - 0.5 * monthly_sigma**2
            log_returns = shocks[:, :, ticker_index]
            log_returns *= monthly_sigma[np.newaxis, :]
            log_returns += log_drift[np.newaxis, :]
            output[ticker] = {
                "log_returns": log_returns,
                "dps_growth": dps_growth,
            }
        if isinstance(shocks, np.memmap):
            shocks.flush()
        return output
    except Exception:
        _release_return_paths(output)
        raise


def _simulate_withdrawal_window(
    shares0: np.ndarray,
    price0: np.ndarray,
    dps0: np.ndarray,
    log_returns: np.ndarray,
    return_ticker_indices: np.ndarray,
    dps_growth: np.ndarray,
    yield_caps: np.ndarray,
    start_month: int,
    withdrawal_months: int,
    settings: SimulationSettings,
    tax_factor: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Retire at ``start_month`` and fund the freedom target by selling shares.

    Fully vectorized across tickers: state arrays are shaped ``(paths, tickers)``.
    ``log_returns`` keeps the shared universe layout ``(paths, months,
    universe_tickers)`` and ``return_ticker_indices`` selects this strategy's
    columns one month at a time, avoiding a large per-strategy copy.
    ``dps_growth`` is ``(tickers, months)`` and ``yield_caps`` is ``(tickers,)``.
    Distributions cover the inflation-adjusted target first; any shortfall sells
    shares pro-rata by value and any surplus buys shares.

    Returns ``(survived_mask, end_value, retire_value)`` per path, where
    ``survived_mask`` is True on paths that never fully depleted, ``end_value`` is
    the nominal portfolio value at the end of the window, and ``retire_value`` is
    the nominal value at ``start_month`` (for real-principal comparisons).
    """
    shares = shares0.copy()
    price = price0.copy()
    dps = dps0.copy()
    n_paths = shares.shape[0]
    retire_value = (shares * price).sum(axis=1)
    depleted = np.zeros(n_paths, dtype=bool)

    for offset in range(withdrawal_months):
        month = start_month + offset
        total_return = np.expm1(log_returns[:, month, return_ticker_indices])
        payout_per_share = np.minimum(dps / 12.0, price * yield_caps / 12.0)
        distribution = shares * payout_per_share
        price_end = np.maximum(price * (1.0 + total_return) - payout_per_share, price * 0.01)

        net_distribution = (distribution * tax_factor).sum(axis=1)
        target = settings.freedom_monthly_target * (
            (1.0 + settings.inflation_rate) ** ((month + 1) / 12.0)
        )
        shortfall = np.maximum(target - net_distribution, 0.0)
        surplus = np.maximum(net_distribution - target, 0.0)

        value = shares * price_end
        total_value = value.sum(axis=1)
        depleted |= total_value <= 1e-6

        safe_total = np.where(total_value > 1e-9, total_value, 1.0)
        weight_frac = value / safe_total[:, None]
        safe_price = np.where(price_end > 1e-9, price_end, 1.0)
        sell_shares = shortfall[:, None] * weight_frac / safe_price
        buy_shares = surplus[:, None] * weight_frac / safe_price

        shares = np.maximum(shares - sell_shares + buy_shares, 0.0)
        price = price_end
        dps = np.minimum(dps * dps_growth[:, month], price * yield_caps)

    end_value = (shares * price).sum(axis=1)
    return ~depleted, end_value, retire_value


def _simulate_strategy(
    strategy: dict[str, Any],
    assumptions: dict[str, dict[str, Any]],
    paths_by_ticker: dict[str, Any],
    settings: SimulationSettings,
    sustainability: SustainabilityOptions = _DEFAULT_SUSTAINABILITY,
) -> dict[str, Any]:
    months = settings.years * 12
    annual_target = settings.freedom_monthly_target * 12.0
    portfolio_values = np.zeros((settings.paths, months + 1), dtype=np.float64)
    flow_adjusted_index = np.full((settings.paths, months + 1), 100.0, dtype=np.float64)
    annual_income = np.zeros((settings.paths, months + 1), dtype=np.float64)
    cumulative_distributions = np.zeros(settings.paths, dtype=np.float64)
    portfolio_values[:, 0] = settings.starting_capital
    no_drip_cash_collected = np.zeros(settings.paths, dtype=np.float64)
    # Year-end snapshots (shares/price/dps per ticker) feed the per-year FI
    # survival scan below; only captured when a freedom target is set.
    year_snapshots: dict[int, dict[str, dict[str, Any]]] = {}

    weights = {row["ticker"]: row["weight"] for row in strategy["holdings"]}
    weighted_yield = 0.0
    blended_expected_total_return = 0.0
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
        if sustainability.check_drip_stop_stability:
            ticker_states[ticker]["shares_no_drip"] = shares.copy()
        annual_income[:, 0] += shares * dps
        weighted_yield += holding["weight"] * assumption["current_yield"]
        blended_expected_total_return += holding["weight"] * _finite(
            assumption["expected_total_return"], 0.0
        )

    # Stable ticker order shared by the year-end snapshots and the stacked
    # market inputs, so the vectorized withdrawal window lines them up correctly.
    ticker_order = list(ticker_states.keys())

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

            if sustainability.check_drip_stop_stability:
                no_drip_cash_collected += state["shares_no_drip"] * payout_per_share

            # All distributions are reinvested into the paying security.
            state["shares"] += distribution / price_end
            month_pre_contribution += state["shares"] * price_end
            contribution = settings.monthly_contribution * weights[ticker]
            if contribution > 0:
                state["shares"] += contribution / price_end
                if sustainability.check_drip_stop_stability:
                    state["shares_no_drip"] += contribution / price_end
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

        if annual_target > 0 and (month + 1) % 12 == 0:
            year_snapshots[(month + 1) // 12] = {
                "shares": np.stack([ticker_states[t]["shares"] for t in ticker_order], axis=1),
                "price": np.stack([ticker_states[t]["price"] for t in ticker_order], axis=1),
                "dps": np.stack([ticker_states[t]["dps"] for t in ticker_order], axis=1),
            }

    if sustainability.check_drip_stop_stability:
        no_drip_final_value = np.zeros(settings.paths, dtype=np.float64)
        for state in ticker_states.values():
            no_drip_final_value += state["shares_no_drip"] * state["price"]
        total_invested = settings.starting_capital + settings.monthly_contribution * months
        capital_ok = no_drip_final_value >= total_invested
        capital_stability_probability = round(float(np.mean(capital_ok) * 100.0), 1)
    else:
        capital_ok = np.ones(settings.paths, dtype=bool)
        capital_stability_probability = None

    # Reuse the shared universe matrix for withdrawal scans. Selecting only one
    # month's strategy columns avoids copying every ticker/path/month into a
    # second, strategy-specific cube.
    if annual_target > 0:
        storage = paths_by_ticker.get("__storage__") or {}
        return_path_matrix = storage.get("matrix")
        universe_ticker_index = storage.get("ticker_index") or {}
        if return_path_matrix is not None and all(
            ticker in universe_ticker_index for ticker in ticker_order
        ):
            return_ticker_indices = np.array(
                [universe_ticker_index[ticker] for ticker in ticker_order],
                dtype=np.intp,
            )
        else:
            return_path_matrix = np.stack(
                [paths_by_ticker[t]["log_returns"] for t in ticker_order],
                axis=2,
            )
            return_ticker_indices = np.arange(len(ticker_order), dtype=np.intp)
        stacked_dps_growth = np.stack(
            [paths_by_ticker[t]["dps_growth"] for t in ticker_order], axis=0
        )  # (tickers, months)
        yield_caps = np.array(
            [ticker_states[t]["yield_cap"] for t in ticker_order], dtype=np.float64
        )
        withdrawal_tax_factor = (1.0 - sustainability.tax_rate) if sustainability.apply_tax else 1.0

    depleted = np.zeros(settings.paths, dtype=bool)
    if sustainability.run_withdrawal_phase and annual_target > 0 and settings.years in year_snapshots:
        snap = year_snapshots[settings.years]
        survived, _end_value, _retire_value = _simulate_withdrawal_window(
            snap["shares"], snap["price"], snap["dps"],
            return_path_matrix, return_ticker_indices, stacked_dps_growth, yield_caps,
            months, sustainability.withdrawal_years * 12, settings, withdrawal_tax_factor,
        )
        depleted = ~survived
        withdrawal_survival_probability = round(float(np.mean(survived) * 100.0), 1)
    else:
        withdrawal_survival_probability = None

    # Realistic "reaches FI first": for each candidate retirement year, retire
    # then and fund the inflation-adjusted target by selling shares whenever
    # distributions fall short, requiring the money to last ``money_lasts_years``
    # (fi_year_lasts) and, more strictly, to also preserve real starting
    # principal (fi_year_principal). A year counts once the survival share of
    # paths clears the confidence bar. This replaces the old 4%-rule proxy.
    fi_year_lasts: int | None = None
    fi_year_principal: int | None = None
    fi_lasts_probability: float | None = None
    fi_principal_probability: float | None = None
    fi_horizon_months = settings.money_lasts_years * 12
    if annual_target > 0 and fi_horizon_months > 0:
        confidence_pct = settings.fi_confidence * 100.0
        for year in range(1, settings.years + 1):
            # Early-stop: once both FI years are known, only the final year is
            # still needed (its probabilities feed the winner ranking).
            both_found = fi_year_lasts is not None and fi_year_principal is not None
            if both_found and year != settings.years:
                continue
            snapshot = year_snapshots.get(year)
            if snapshot is None:
                continue
            survived, end_value, retire_value = _simulate_withdrawal_window(
                snapshot["shares"], snapshot["price"], snapshot["dps"],
                return_path_matrix, return_ticker_indices, stacked_dps_growth, yield_caps,
                year * 12, fi_horizon_months, settings, withdrawal_tax_factor,
            )
            lasts_prob = round(float(np.mean(survived) * 100.0), 1)
            infl_start = (1.0 + settings.inflation_rate) ** year
            infl_end = (1.0 + settings.inflation_rate) ** (
                (year * 12 + fi_horizon_months) / 12.0
            )
            preserved = survived & ((end_value / infl_end) >= (retire_value / infl_start))
            principal_prob = round(float(np.mean(preserved) * 100.0), 1)
            if fi_year_lasts is None and lasts_prob >= confidence_pct:
                fi_year_lasts = year
            if fi_year_principal is None and principal_prob >= confidence_pct:
                fi_year_principal = year
            if year == settings.years:
                fi_lasts_probability = lasts_prob
                fi_principal_probability = principal_prob

    inflation_factors = np.power(
        1.0 + settings.inflation_rate,
        np.arange(months + 1, dtype=np.float64) / 12.0,
    )
    real_values = portfolio_values / inflation_factors[np.newaxis, :]
    real_income = annual_income / inflation_factors[np.newaxis, :]

    yearly_series = []
    freedom_year_income = None
    freedom_year_spending = None
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

    # Sustainability-adjusted income: cap at the strategy's blended expected
    # total return (payout above that implies NAV erosion, i.e. return of
    # capital) and/or haircut for estimated taxes, per the enabled tests.
    # With both tests off this equals `annual_income[:, -1]` exactly, which
    # keeps `sustainable_freedom_probability` identical to
    # `freedom_target_probability` when no sustainability tests are enabled.
    sustainability_income = annual_income[:, -1].copy()
    if sustainability.cap_payout_to_total_return:
        sustainability_income = np.minimum(
            sustainability_income, portfolio_values[:, -1] * blended_expected_total_return
        )
    if sustainability.apply_tax:
        sustainability_income = sustainability_income * (1.0 - sustainability.tax_rate)
    final_real_sustainability_income = sustainability_income / final_inflation

    if annual_target > 0:
        income_ok = final_real_sustainability_income >= annual_target
        spending_ok = final_spending >= annual_target
        reaches_target = income_ok | spending_ok
        withdrawal_ok = ~depleted  # all-False `depleted` (test disabled) means all-True here
        sustainable_freedom_probability = round(
            float(np.mean(reaches_target & capital_ok & withdrawal_ok) * 100.0),
            1,
        )
    else:
        sustainable_freedom_probability = None

    payout_sustainable_ratio_pct = (
        round(weighted_yield / blended_expected_total_return * 100.0, 1)
        if blended_expected_total_return > 0 else None
    )
    sustainability_detail = {
        "apply_tax": sustainability.apply_tax,
        "tax_rate_pct": round(sustainability.tax_rate * 100.0, 1),
        "cap_payout_to_total_return": sustainability.cap_payout_to_total_return,
        "blended_expected_total_return_pct": round(blended_expected_total_return * 100.0, 2),
        "payout_sustainable_ratio_pct": payout_sustainable_ratio_pct,
        "sustainability_adjusted_monthly_income": (
            _percentiles(sustainability_income / 12.0)
            if sustainability.apply_tax or sustainability.cap_payout_to_total_return
            else None
        ),
        "check_drip_stop_stability": sustainability.check_drip_stop_stability,
        "capital_stability_probability": capital_stability_probability,
        "no_drip_cash_collected": (
            _percentiles(no_drip_cash_collected) if sustainability.check_drip_stop_stability else None
        ),
        "run_withdrawal_phase": sustainability.run_withdrawal_phase,
        "withdrawal_years": sustainability.withdrawal_years if sustainability.run_withdrawal_phase else None,
        "withdrawal_survival_probability": withdrawal_survival_probability,
    }

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
        "sustainable_freedom_probability": sustainable_freedom_probability,
        "fi_year_lasts": fi_year_lasts,
        "fi_year_principal": fi_year_principal,
        "fi_lasts_probability": fi_lasts_probability,
        "fi_principal_probability": fi_principal_probability,
        "fi_confidence_pct": round(settings.fi_confidence * 100.0, 1) if annual_target > 0 else None,
        "money_lasts_years": settings.money_lasts_years if annual_target > 0 else None,
        "sustainability_detail": sustainability_detail,
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
    sustainability = validate_sustainability(payload.get("sustainability") or {})
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
                for field in (
                    "classification_type",
                    "etf_category",
                    "etf_strategy",
                    "fund_kind",
                    "income_bucket",
                    "scenario_type_override",
                ):
                    if not existing.get(field) and holding.get(field):
                        existing[field] = holding[field]
                if (
                    existing.get("option_strategy", "auto") == "auto"
                    and holding.get("option_strategy", "auto") != "auto"
                ):
                    existing["option_strategy"] = holding["option_strategy"]
                if (
                    existing.get("correlation_group", "auto") == "auto"
                    and holding.get("correlation_group", "auto") != "auto"
                ):
                    existing["correlation_group"] = holding["correlation_group"]
                existing["current_yield_pct"] = max(
                    existing.get("current_yield_pct", 0.0),
                    holding.get("current_yield_pct", 0.0),
                )
                existing["current_price"] = max(
                    existing.get("current_price", 0.0),
                    holding.get("current_price", 0.0),
                )

    # The per-year FI survival scan needs return paths that extend past the
    # accumulation horizon by the "money must last" window, so generate that
    # extension whenever a freedom target is set (not only for the legacy
    # withdrawal-phase test). Use the larger of the two horizons.
    fi_horizon_months = settings.money_lasts_years * 12 if settings.freedom_monthly_target > 0 else 0
    legacy_withdrawal_months = (
        sustainability.withdrawal_years * 12 if sustainability.run_withdrawal_phase else 0
    )
    withdrawal_months = max(fi_horizon_months, legacy_withdrawal_months)
    return_path_cells = (
        len(holdings_by_ticker)
        * settings.paths
        * (settings.years * 12 + withdrawal_months)
    )
    return_path_storage = (
        "temporary_disk"
        if return_path_cells > IN_MEMORY_RETURN_PATH_CELLS
        else "memory"
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
        return_paths = None
        try:
            return_paths = generate_return_paths(
                assumptions, scenario, settings, withdrawal_months=withdrawal_months
            )
            scenario_results[scenario] = {
                "strategies": [
                    _simulate_strategy(
                        strategy, assumptions, return_paths, settings, sustainability
                    )
                    for strategy in strategies
                ]
            }
        finally:
            _release_return_paths(return_paths)

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
            "fi_confidence_pct": round(settings.fi_confidence * 100.0, 1),
            "money_lasts_years": settings.money_lasts_years,
            "paths": settings.paths,
            "seed": settings.seed,
            "return_path_cells": return_path_cells,
            "return_path_storage": return_path_storage,
            "reinvest_distributions_pct": 100,
            "withdrawals": 0,
            "sustainability": {
                "apply_tax": sustainability.apply_tax,
                "tax_rate_pct": round(sustainability.tax_rate * 100.0, 1),
                "cap_payout_to_total_return": sustainability.cap_payout_to_total_return,
                "check_drip_stop_stability": sustainability.check_drip_stop_stability,
                "run_withdrawal_phase": sustainability.run_withdrawal_phase,
                "withdrawal_years": sustainability.withdrawal_years,
            },
        },
        "strategies": strategies,
        "assumptions": [
            {
                key: value
                for key, value in assumptions[ticker].items()
                if key not in {"correlations", "correlation_history_months"}
            }
            for ticker in sorted(assumptions)
        ],
        "correlation_model": _correlation_model_summary(assumptions),
        "data_quality_warnings": warnings,
        "scenarios": scenario_results,
    }
