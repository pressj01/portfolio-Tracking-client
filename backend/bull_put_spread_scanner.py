"""Bull put credit spread candidate scanner.

The underlying screen deliberately resembles the cash-secured Put Selling
Scanner, but the trade is not identical.  A bull put spread is an income trade
on a neutral-to-bullish underlying: sell a higher-strike OTM put, buy a
lower-strike put in the same expiration, and keep the net credit if the
underlying remains above the short strike.

The scan runs in three cached stages:

1. Price: find liquid uptrends in controlled pullbacks, not fresh breakdowns.
2. Fundamentals: retain profitable, adequately sized stocks and diversified
   funds that can support a bullish/neutral thesis.
3. Options: enumerate same-expiration two-leg put spreads, require two-sided
   quotes, compute defined risk, and keep only pairs that satisfy the user's
   credit, cushion, liquidity, and execution constraints. The option session
   is primed once per ticker so Yahoo is not asked twice for the expiration
   catalog, and the catalog itself is cached with the put chain.

Endpoints:
  GET  /api/options/bull-put-spread-scan/universes
  POST /api/options/bull-put-spread-scan
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import yfinance as yf

import yahoo_gateway
from flask import jsonify, request

from option_probability import profit_probability_schedule
from option_strike_targets import strike_for_delta
from put_scanner import (
    COMMODITY_ETF_SET,
    CURATED_STOCK_SET,
    INDEX_ETF_SET,
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    RISK_FREE,
    SECTOR_ETF_SET,
    UNIVERSE_CHOICES,
    LOW_CONFIDENCE_SELECTED_FUND_FLAG,
    _CHAIN_TTL,
    _benchmark_returns,
    _cache_get,
    _clean_tickers,
    _compute_technicals,
    _earnings_within_target_window,
    _expirations_cache,
    _fetch_fundamentals_bulk,
    _fund_kind,
    _fund_size,
    _is_fund,
    _load_expirations,
    _load_history,
    _load_put_chain,
    _num,
    _option_bundle_expiration,
    _parse_date,
    _pick_expiration,
    _prepare_put_quote,
    _ramp,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
    resolve_scan_universe,
    score_candidate as score_put_candidate,
)
from bear_put_spread_scanner import vertical_fair_value


CONTRACT_MULTIPLIER = 100.0


def _band(value, low: float, full_low: float, full_high: float,
          high: float, points: float) -> float:
    """Score a value highest through the useful middle of a range."""
    value = _num(value)
    if value is None or value <= low or value >= high:
        return 0.0
    if full_low <= value <= full_high:
        return points
    if value < full_low:
        return points * (value - low) / max(full_low - low, 1e-9)
    return points * (high - value) / max(high - full_high, 1e-9)


def _quotable(leg: dict) -> bool:
    """A credit spread needs a live, uncrossed market on both legs."""
    bid = _num(leg.get("bid"))
    ask = _num(leg.get("ask"))
    mid = _num(leg.get("mid"))
    return bool(bid and ask and mid and bid > 0 and ask >= bid and mid > 0)


def _delta_pool(legs: list[dict], target: float, tolerance: float) -> list[dict]:
    """Return strikes near the requested absolute put delta."""
    with_delta = [leg for leg in legs if leg.get("delta") is not None]
    if with_delta:
        for tol in (tolerance, tolerance * 1.6, tolerance * 2.5):
            pool = [
                leg for leg in with_delta
                if abs(abs(leg["delta"]) - target) <= tol
            ]
            if pool:
                return pool
        return [min(with_delta, key=lambda leg: abs(abs(leg["delta"]) - target))]
    return []


def _build_credit_pair(short_leg: dict, long_leg: dict, spot: float, dte: int,
                       forecast_vol: float | None) -> dict | None:
    """Calculate one short-higher/long-lower put spread."""
    short_strike = _num(short_leg.get("strike"))
    long_strike = _num(long_leg.get("strike"))
    if not short_strike or not long_strike or short_strike <= long_strike:
        return None

    width = short_strike - long_strike
    credit = (_num(short_leg.get("mid"), 0.0) or 0.0) - (
        _num(long_leg.get("mid"), 0.0) or 0.0
    )
    if credit <= 0 or credit >= width:
        return None

    max_loss = width - credit
    breakeven = short_strike - credit
    dte_eff = max(int(dte or 1), 1)
    T = dte_eff / 365.0

    # A simultaneous limit near the mid is the displayed entry.  The natural
    # credit shows whether crossing both markets still produces a credit.
    all_live = _quotable(short_leg) and _quotable(long_leg)
    natural_credit = (
        (_num(short_leg.get("bid"), 0.0) or 0.0)
        - (_num(long_leg.get("ask"), 0.0) or 0.0)
        if all_live else None
    )
    exec_cost = (
        (_num(short_leg.get("ask"), 0.0) or 0.0)
        - (_num(short_leg.get("bid"), 0.0) or 0.0)
        + (_num(long_leg.get("ask"), 0.0) or 0.0)
        - (_num(long_leg.get("bid"), 0.0) or 0.0)
        if all_live else None
    )
    exec_cost_pct = (
        exec_cost / credit * 100.0
        if exec_cost is not None and credit > 0 else None
    )

    credit_pct_width = credit / width * 100.0
    return_on_risk = credit / max_loss * 100.0 if max_loss > 0 else None
    annualized_ror = (
        return_on_risk * 365.0 / dte_eff if return_on_risk is not None else None
    )
    short_otm_pct = (spot - short_strike) / spot * 100.0 if spot else None
    breakeven_cushion_pct = (spot - breakeven) / spot * 100.0 if spot else None

    short_delta = _num(short_leg.get("delta"))
    prob_otm = (1.0 - abs(short_delta)) * 100.0 if short_delta is not None else None

    fair_credit = vertical_fair_value(
        spot, short_strike, long_strike, T, forecast_vol
    )
    premium_edge = credit - fair_credit if fair_credit is not None else None
    premium_edge_pct = (
        premium_edge / fair_credit * 100.0
        if premium_edge is not None and fair_credit and fair_credit > 0 else None
    )

    oi_min = min(
        int(_num(short_leg.get("open_interest"), 0) or 0),
        int(_num(long_leg.get("open_interest"), 0) or 0),
    )
    volume_min = min(
        int(_num(short_leg.get("volume"), 0) or 0),
        int(_num(long_leg.get("volume"), 0) or 0),
    )

    return {
        "short_strike": short_strike,
        "long_strike": long_strike,
        "width": width,
        "credit": credit,
        "natural_credit": natural_credit,
        "quote_source": "live_bid_ask" if all_live else "last_trade_estimate",
        "uses_last_trade_prices": not all_live,
        "credit_pct_of_width": credit_pct_width,
        "max_profit": credit,
        "max_loss": max_loss,
        "return_on_risk_pct": return_on_risk,
        "annualized_return_on_risk_pct": annualized_ror,
        "breakeven": breakeven,
        "short_otm_pct": short_otm_pct,
        "breakeven_cushion_pct": breakeven_cushion_pct,
        "prob_otm": prob_otm,
        "fair_credit": fair_credit,
        "premium_edge": premium_edge,
        "premium_edge_pct": premium_edge_pct,
        "exec_cost": exec_cost,
        "exec_cost_pct": exec_cost_pct,
        "open_interest_min": oi_min,
        "volume_min": volume_min,
        "credit_dollars": credit * CONTRACT_MULTIPLIER,
        "max_profit_dollars": credit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": max_loss * CONTRACT_MULTIPLIER,
        "short_leg": {
            "strike": short_strike,
            "bid": short_leg["bid"],
            "ask": short_leg["ask"],
            "mid": short_leg["mid"],
            "iv": short_leg["iv"],
            "delta": short_leg["delta"],
            "open_interest": short_leg["open_interest"],
            "volume": short_leg["volume"],
            "quote_source": short_leg.get("quote_source", "live_bid_ask"),
        },
        "long_leg": {
            "strike": long_strike,
            "bid": long_leg["bid"],
            "ask": long_leg["ask"],
            "mid": long_leg["mid"],
            "iv": long_leg["iv"],
            "delta": long_leg["delta"],
            "open_interest": long_leg["open_interest"],
            "volume": long_leg["volume"],
            "quote_source": long_leg.get("quote_source", "live_bid_ask"),
        },
    }


def _spread_distribution_iv(spread: dict) -> float | None:
    """Spot-distribution vol for the probability cards.

    ATM IV understates left-tail risk on a put credit spread because skew
    makes the short put richer than the at-the-money option. Averaging the
    two put IVs matches the live risk graph and keeps expiration loss odds
    in line with the short-put delta instead of collapsing toward 1%.
    """
    ivs = []
    for value in (
        (spread.get("short_leg") or {}).get("iv"),
        (spread.get("long_leg") or {}).get("iv"),
    ):
        number = _num(value)
        if number and number > 0:
            ivs.append(number)
    if ivs:
        return sum(ivs) / len(ivs)
    return _num(spread.get("atm_iv"))


def _pair_quality(pair: dict) -> float:
    """Rank qualifying pairs without letting one seductive metric dominate."""
    score = _ramp(pair.get("prob_otm"), 65, 85, 25)
    score += _ramp(pair.get("annualized_return_on_risk_pct"), 15, 60, 25)
    score += _ramp(pair.get("premium_edge_pct"), -10, 35, 20)
    score += _ramp(pair.get("breakeven_cushion_pct"), 3, 12, 12)
    exec_cost = _num(pair.get("exec_cost_pct"))
    score += _ramp(-(exec_cost if exec_cost is not None else 100.0), -35, -8, 10)
    score += _ramp(pair.get("open_interest_min"), 50, 500, 8)
    return score


def _prime_option_ticker(ticker: str):
    """Open one yfinance session and keep the default chain Yahoo already sent.

    ``Ticker.options`` and a later ``Ticker.option_chain(date)`` on a *new*
    object each download the expiration catalog. Reusing the primed object
    avoids that second catalog fetch; if the catalog-only response is already
    the month we want, the default chain is reused as well.
    """
    try:
        tk = yf.Ticker(ticker)
    except Exception:
        return None, [], None

    default_chain = None
    if _cache_get(_expirations_cache, ticker, _CHAIN_TTL) is None:
        fetch = getattr(tk, "option_chain", None)
        if callable(fetch):
            try:
                default_chain = yahoo_gateway.call(fetch)
            except Exception:
                default_chain = None
    expirations = _load_expirations(ticker, tk)
    return tk, expirations, default_chain


def _suggest_bull_put_spread(
    ticker: str,
    spot: float,
    div_yield: float,
    forecast_vol: float | None,
    target_dte: int,
    min_dte: int,
    max_dte: int,
    short_delta: float = 0.25,
    long_delta: float = 0.10,
    delta_tolerance: float = 0.12,
    min_width_pct: float = 1.0,
    max_width_pct: float = 15.0,
    min_credit_pct_of_width: float = 20.0,
    min_credit_dollars: float = 0.0,
    min_cushion_pct: float = 3.0,
    min_open_interest: int = 50,
    max_exec_cost_pct: float = 30.0,
    earnings_date: str | None = None,
    earnings_buffer_days: int = 5,
) -> dict | None:
    """Select the best live, same-expiration bull put credit spread."""
    tk, expirations, default_chain = _prime_option_ticker(ticker)
    if tk is None or not expirations:
        return None

    earnings_d = _parse_date(earnings_date)
    cutoff = (
        earnings_d - timedelta(days=max(0, earnings_buffer_days))
        if earnings_d else None
    )
    expiration, dte, cleared = _pick_expiration(
        expirations, target_dte, min_dte, max_dte, expire_before=cutoff
    )
    if not expiration:
        return None

    reuse_chain = (
        default_chain
        if default_chain is not None
        and _option_bundle_expiration(default_chain) == expiration
        else None
    )
    puts = _load_put_chain(
        ticker,
        expiration,
        spot,
        div_yield,
        session_ticker=tk,
        chain=reuse_chain,
    )
    if not puts:
        return None

    prepared = [
        quote for quote in (
            _prepare_put_quote(
                leg,
                spot=spot,
                dte=dte or 0,
                dividend_yield=div_yield,
            )
            for leg in puts
            if (_num(leg.get("strike")) or spot) < spot
        )
        if quote is not None
    ]
    live = [leg for leg in prepared if _quotable(leg)]
    legs = live if len(live) >= 2 else prepared
    if len(legs) < 2:
        return None

    short_pool = _delta_pool(legs, short_delta, delta_tolerance)
    long_pool = _delta_pool(legs, long_delta, delta_tolerance)
    if not short_pool:
        want = strike_for_delta(spot, short_delta, forecast_vol, dte, "put") or spot
        short_pool = sorted(legs, key=lambda leg: abs(leg["strike"] - want))[:4]
    if not long_pool:
        want = strike_for_delta(spot, long_delta, forecast_vol, dte, "put") or spot
        long_pool = sorted(legs, key=lambda leg: abs(leg["strike"] - want))[:5]

    lo_width = spot * max(0.0, min_width_pct) / 100.0
    hi_width = spot * max(min_width_pct, max_width_pct) / 100.0

    all_pairs: list[dict] = []
    passing: list[dict] = []
    for short_leg in short_pool:
        short_strike = _num(short_leg.get("strike"))
        if not short_strike:
            continue
        for long_leg in long_pool:
            long_strike = _num(long_leg.get("strike"))
            if not long_strike or short_strike <= long_strike:
                continue
            width = short_strike - long_strike
            if width < lo_width or width > hi_width:
                continue
            pair = _build_credit_pair(
                short_leg, long_leg, spot, dte or 1, forecast_vol
            )
            if pair is None:
                continue
            all_pairs.append(pair)
            estimated = pair["uses_last_trade_prices"]
            if estimated:
                continue
            if not estimated and pair["natural_credit"] <= 0:
                continue
            if pair["credit_pct_of_width"] < min_credit_pct_of_width:
                continue
            if pair["credit_dollars"] < min_credit_dollars:
                continue
            if (
                pair["breakeven_cushion_pct"] is not None
                and pair["breakeven_cushion_pct"] < min_cushion_pct
            ):
                continue
            if pair["open_interest_min"] < min_open_interest:
                continue
            if not estimated and (
                pair["exec_cost_pct"] is None
                or pair["exec_cost_pct"] > max_exec_cost_pct
            ):
                continue
            passing.append(pair)

    pool = passing or all_pairs
    if not pool:
        return None
    best = max(pool, key=_pair_quality)

    atm = min(prepared, key=lambda leg: abs(leg["strike"] - spot))
    atm_iv = atm["iv"] if atm["iv"] > 0 else best["short_leg"]["iv"]
    expiry_d = datetime.strptime(expiration, "%Y-%m-%d").date()
    return {
        **best,
        "expiration": expiration,
        "dte": dte,
        "atm_iv": atm_iv,
        "total_option_volume": sum(
            int(_num(leg.get("volume"), 0) or 0) for leg in puts
        ),
        "constraints_relaxed": not passing,
        "pairs_considered": len(all_pairs),
        "earnings_date": earnings_d.isoformat() if earnings_d else None,
        "avoids_earnings": cleared if earnings_d else None,
        "days_earnings_after_expiry": (
            (earnings_d - expiry_d).days if earnings_d else None
        ),
    }


STRUCTURE_MAX = 50.0


def score_candidate(tech: dict, fund: dict, spread: dict | None,
                    earnings_buffer_days: int = 5) -> dict:
    """Rate a bull put candidate on setup, quality, premium, and safety."""
    flags: list[str] = []

    # Setup (30): a controlled pullback inside an intact bullish structure.
    setup = 0.0
    stretch = _num(tech.get("stretch_sigma"))
    drop = -(_num(tech.get("drawdown_pct"), 0.0) or 0.0)
    rsi = _num(tech.get("rsi_14"))
    setup += _band(stretch, 0.0, 0.5, 1.6, 3.2, 8)
    setup += _band(drop, 1.0, 4.0, 18.0, 35.0, 7)
    setup += _band(rsi, 25.0, 35.0, 52.0, 68.0, 5)

    price = _num(tech.get("price"))
    sma50 = _num(tech.get("sma_50"))
    sma200 = _num(tech.get("sma_200"))
    if price and sma200 and price >= sma200:
        setup += 6
    else:
        flags.append("Price below the 200-day average")
    if sma50 and sma200 and sma50 >= sma200:
        setup += 4
    else:
        flags.append("50-day below the 200-day average")
    if tech.get("fresh_low"):
        flags.append("Making fresh 52-week lows")

    # Quality (20): use the Put Selling Scanner's tested company/fund quality
    # model so the two income screens cannot disagree about the same underlying.
    put_rating = score_put_candidate(tech, fund, None)
    quality = min(20.0, (put_rating["components"]["quality"] or 0.0) * 0.8)
    for flag in put_rating.get("flags", []):
        if flag in {
            "Not profitable on trailing earnings",
            "Heavy debt load",
            "Small fund",
            "Leveraged or inverse fund",
            "Thin share liquidity",
        }:
            flags.append(flag)

    premium = 0.0
    safety = 0.0
    iv_rv = None
    earnings_before_expiry = None
    if spread:
        estimated = bool(spread.get("uses_last_trade_prices"))
        if estimated:
            flags.append("Recent trade estimates — no live bid/ask")
        atm_iv = _num(spread.get("atm_iv"))
        rv = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        if atm_iv and rv and rv > 0:
            iv_rv = atm_iv / rv
            premium += _ramp(iv_rv, 0.95, 1.50, 10)
        premium += _ramp(spread.get("premium_edge_pct"), -10, 35, 8)
        premium += _ramp(
            spread.get("annualized_return_on_risk_pct"), 15, 55, 7
        )

        safety += _ramp(spread.get("prob_otm"), 65, 85, 8)
        safety += _ramp(spread.get("breakeven_cushion_pct"), 3, 12, 5)
        exec_cost = _num(spread.get("exec_cost_pct"))
        safety += _ramp(
            -(exec_cost if exec_cost is not None else 100.0), -35, -8, 5
        )
        safety += _ramp(spread.get("open_interest_min"), 50, 500, 4)
        if (_num(spread.get("natural_credit"), 0.0) or 0.0) > 0:
            safety += 3

        if (spread.get("credit_pct_of_width") or 0) < 20:
            flags.append("Credit too small for the defined risk")
        if not estimated and (exec_cost is None or exec_cost > 30):
            flags.append("Two-leg slippage is high")
        if (spread.get("open_interest_min") or 0) < 50:
            flags.append("Thin open interest on one leg")
        if (spread.get("prob_otm") or 100) < 65:
            flags.append("Short strike is too close")
        if spread.get("constraints_relaxed"):
            flags.append("No pair met every spread filter")

        earnings_d = _parse_date(fund.get("next_earnings"))
        expiry_d = _parse_date(spread.get("expiration"))
        if earnings_d and expiry_d:
            earnings_before_expiry = earnings_d <= expiry_d
            gap = (earnings_d - expiry_d).days
            if earnings_before_expiry:
                flags.append("Earnings before expiration")
                safety = max(0.0, safety - 8)
            elif gap <= earnings_buffer_days:
                flags.append(f"Earnings {gap}d after expiry")

    total = setup + quality + premium + safety
    scored_max = 100.0 if spread else STRUCTURE_MAX
    normalized = total / scored_max * 100.0
    if spread is None:
        flags.append("Option chain unavailable")

    if normalized >= 80:
        grade = "A"
    elif normalized >= 70:
        grade = "B"
    elif normalized >= 60:
        grade = "C"
    elif normalized >= 50:
        grade = "D"
    else:
        grade = "F"

    return {
        "score": round(max(0.0, min(100.0, normalized)), 1),
        "grade": grade,
        "components": {
            "setup": round(setup, 1),
            "quality": round(quality, 1),
            "premium": round(premium, 1),
            "safety": round(safety, 1),
        },
        "component_max": {
            "setup": 30,
            "quality": 20,
            "premium": 25,
            "safety": 25,
        },
        "iv_rv_ratio": _round(iv_rv, 2),
        "earnings_before_expiry": earnings_before_expiry,
        "days_to_earnings": (
            (_parse_date(fund.get("next_earnings")) - date.today()).days
            if _parse_date(fund.get("next_earnings")) else None
        ),
        "is_fund": _is_fund(fund, tech.get("ticker") or ""),
        "fund_kind": _fund_kind(tech.get("ticker") or "", fund)
        if _is_fund(fund, tech.get("ticker") or "") else None,
        "flags": list(dict.fromkeys(flags)),
        "scored_on_partial": spread is None,
    }


def recommend_management(spread: dict | None, rating: dict | None) -> dict | None:
    """Transparent close-early plan for a newly opened credit spread."""
    if not spread:
        return None
    credit = _num(spread.get("credit"))
    width = _num(spread.get("width"))
    if not credit or credit <= 0 or not width or width <= credit:
        return None

    rating = rating or {}
    grade = str(rating.get("grade") or "")
    score = _num(rating.get("score"), 0.0) or 0.0
    flags = set(rating.get("flags") or [])
    material = {
        "Earnings before expiration",
        "Two-leg slippage is high",
        "Thin open interest on one leg",
        "Making fresh 52-week lows",
        "No pair met every spread filter",
        LOW_CONFIDENCE_SELECTED_FUND_FLAG,
    }
    if grade == "A" and score >= 80 and not (flags & material):
        capture_pct = 65.0
        profile = "Strong setup"
    elif grade in {"A", "B"} and not (flags & material):
        capture_pct = 60.0
        profile = "Balanced setup"
    else:
        capture_pct = 50.0
        profile = "Defensive setup"

    target_debit = max(0.01, round(credit * (1.0 - capture_pct / 100.0), 2))
    stop_debit = min(width - 0.01, max(credit + 0.01, round(credit * 2.0, 2)))
    dte = max(1, int(_num(spread.get("dte"), 1) or 1))
    reassess_dte = 21 if dte >= 45 else max(10, int(round(dte * 0.4)))

    return {
        "target_debit": target_debit,
        "profit_capture_pct": round((credit - target_debit) / credit * 100.0, 1),
        "target_profit_dollars": round(
            (credit - target_debit) * CONTRACT_MULTIPLIER, 0
        ),
        "stop_debit": stop_debit,
        "stop_loss_dollars": round(
            max(0.0, stop_debit - credit) * CONTRACT_MULTIPLIER, 0
        ),
        "reassess_dte": reassess_dte,
        "close_by_dte": 3,
        "profile": profile,
        "rationale": (
            "Close both legs together with a limit order. The target removes "
            "assignment and expiration risk after most of the planned credit is "
            "earned; the stop is a risk trigger, not a guaranteed fill."
        ),
    }


def build_verdict(row: dict) -> str:
    spread = row.get("spread") or {}
    lead = (
        f"{row.get('grade', '—')} setup in an intact or recovering trend"
        if row.get("grade") in {"A", "B"} else
        "Bullish income candidate with material trade-offs"
    )
    if spread:
        lead += (
            f". Sell the ${spread['short_strike']:g} put and buy the "
            f"${spread['long_strike']:g} put for about ${spread['credit']:.2f} "
            f"credit; risk ${spread['max_loss_dollars']:.0f} to make "
            f"${spread['max_profit_dollars']:.0f}"
        )
        if spread.get("prob_otm") is not None:
            lead += f", with about {spread['prob_otm']:.0f}% modeled OTM probability"
        if spread.get("breakeven_cushion_pct") is not None:
            lead += f" and {spread['breakeven_cushion_pct']:.0f}% breakeven cushion"
    flags = row.get("flags") or []
    if "Earnings before expiration" in flags:
        lead += ". Earnings fall inside the trade, so it is watchlist-only"
    elif "No pair met every spread filter" in flags:
        lead += ". The indicative pair does not satisfy every selected structure limit"
    elif "Two-leg slippage is high" in flags:
        lead += ". Two-leg execution cost is a material share of the credit"
    return lead + "."


DEFAULTS = {
    "universe": "large_cap",
    "include_stocks": True,
    "include_index_etfs": True,
    "include_sector_etfs": False,
    "include_commodity_etfs": False,
    "include_selected_funds": False,
    "selected_fund_tickers": [],
    "include_lower_confidence_selected_funds": True,
    "lookback_days": 21,
    "min_market_cap": 5e9,
    "min_drop_pct": 3.0,
    "max_drop_pct": 25.0,
    "min_stretch_sigma": 0.3,
    "max_stretch_sigma": 2.5,
    "fund_min_drop_pct": 1.5,
    "fund_max_drop_pct": 18.0,
    "fund_min_aum": 500e6,
    "exclude_leveraged_funds": True,
    "min_rsi": 35.0,
    "max_rsi": 58.0,
    "min_avg_dollar_volume": 25e6,
    "require_above_sma200": True,
    "require_confirmed_uptrend": False,
    "require_profitable": True,
    "exclude_fresh_lows": True,
    "exclude_earnings_before_expiry": True,
    "earnings_buffer_days": 5,
    "target_dte": 35,
    "min_dte": MIN_TARGET_DTE,
    "max_dte": MAX_TARGET_DTE,
    "short_delta": 0.25,
    "long_delta": 0.10,
    "delta_tolerance": 0.12,
    "min_width_pct": 1.0,
    "max_width_pct": 15.0,
    "min_credit_pct_of_width": 20.0,
    "min_credit_dollars": 0.0,
    "min_cushion_pct": 3.0,
    "min_open_interest": 50,
    "max_exec_cost_pct": 30.0,
    "chain_limit": 20,
    "max_results": 40,
}


def _partition_candidate_rows(rows: list[dict], max_results: int):
    actionable = [row for row in rows if row.get("chain_status") == "actionable"]
    watchlist = [row for row in rows if row.get("chain_status") != "actionable"]
    actionable.sort(key=lambda row: -(row.get("score") or 0))
    order = {
        "underlying_filters_missed": -1,
        "earnings": 0,
        "constraints_relaxed": 1,
        "unavailable": 2,
        "not_priced": 3,
    }
    watchlist.sort(key=lambda row: (
        order.get(row.get("chain_status"), 4),
        -(row.get("score") or 0),
    ))
    return actionable[:max_results], watchlist[:max_results]


def run_bull_put_spread_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{
        key: value for key, value in (payload or {}).items() if value is not None
    }}

    lookback = max(5, min(126, int(_num(p["lookback_days"], 21))))
    min_cap = max(0.0, _num(p["min_market_cap"], 0.0) or 0.0)
    min_drop = max(0.0, _num(p["min_drop_pct"], 0.0) or 0.0)
    max_drop = max(min_drop, _num(p["max_drop_pct"], 100.0) or 100.0)
    min_stretch = _num(p["min_stretch_sigma"], 0.0) or 0.0
    max_stretch = max(
        min_stretch, _num(p["max_stretch_sigma"], 99.0) or 99.0
    )
    fund_min_drop = max(0.0, _num(p["fund_min_drop_pct"], 0.0) or 0.0)
    fund_max_drop = max(
        fund_min_drop, _num(p["fund_max_drop_pct"], 100.0) or 100.0
    )
    fund_min_aum = max(0.0, _num(p["fund_min_aum"], 0.0) or 0.0)
    min_rsi = _num(p["min_rsi"], 0.0) or 0.0
    max_rsi = max(min_rsi, _num(p["max_rsi"], 100.0) or 100.0)
    min_adv = max(0.0, _num(p["min_avg_dollar_volume"], 0.0) or 0.0)
    target_dte = max(
        MIN_TARGET_DTE,
        min(MAX_TARGET_DTE, int(_num(p["target_dte"], 35))),
    )
    min_dte = max(MIN_TARGET_DTE, int(_num(p["min_dte"], MIN_TARGET_DTE)))
    max_dte = max(min_dte, int(_num(p["max_dte"], MAX_TARGET_DTE)))
    short_delta = min(0.60, max(0.05, _num(p["short_delta"], 0.25) or 0.25))
    long_delta = min(
        short_delta - 0.01,
        max(0.01, _num(p["long_delta"], 0.10) or 0.10),
    )
    delta_tolerance = min(
        0.35, max(0.02, _num(p["delta_tolerance"], 0.12) or 0.12)
    )
    min_width = max(0.1, _num(p["min_width_pct"], 1.0) or 1.0)
    max_width = max(
        min_width, _num(p["max_width_pct"], 15.0) or 15.0
    )
    min_credit = min(
        90.0, max(1.0, _num(p["min_credit_pct_of_width"], 20.0) or 20.0)
    )
    min_credit_dollars = max(
        0.0, _num(p.get("min_credit_dollars"), 0.0) or 0.0
    )
    min_cushion = max(
        0.0, _num(p["min_cushion_pct"], 3.0) or 0.0
    )
    min_oi = max(0, int(_num(p["min_open_interest"], 50) or 0))
    max_exec = min(
        200.0, max(1.0, _num(p["max_exec_cost_pct"], 30.0) or 30.0)
    )
    earnings_buffer = max(
        0, min(30, int(_num(p["earnings_buffer_days"], 5) or 0))
    )
    chain_limit = max(0, min(60, int(_num(p["chain_limit"], 20) or 0)))
    max_results = max(1, min(200, int(_num(p["max_results"], 40) or 40)))

    tickers = resolve_scan_universe(p)
    selected_fund_tickers = set(_clean_tickers(p.get("selected_fund_tickers"))) \
        if p.get("include_selected_funds") else set()
    allow_lower_confidence_selected_funds = bool(
        selected_fund_tickers
        and p.get("include_lower_confidence_selected_funds", True)
    )
    empty_stats = {
        "universe": len(tickers),
        "priced": 0,
        "passed_price": 0,
        "passed_fundamentals": 0,
        "chains_fetched": 0,
        "actionable": 0,
        "watchlist": 0,
        "final": 0,
    }
    if not tickers:
        return {
            "rows": [],
            "watchlist_rows": [],
            "stats": empty_stats,
            "params": p,
            "error": "Nothing selected to scan.",
        }

    hist = _load_history(tickers)
    if hist is None or hist.empty:
        return {
            "rows": [],
            "watchlist_rows": [],
            "stats": empty_stats,
            "params": p,
            "error": "Price history unavailable. Yahoo may be rate-limiting.",
        }

    etf_hint = INDEX_ETF_SET | SECTOR_ETF_SET | COMMODITY_ETF_SET
    bench_ret = _benchmark_returns(hist)
    priced = 0
    price_pass: list[dict] = []
    lower_confidence_price: list[dict] = []
    for ticker in tickers:
        sub = _ticker_frame(hist, ticker)
        if sub is None:
            continue
        tech = _compute_technicals(sub, bench_ret, lookback)
        if tech is None:
            continue
        priced += 1

        drop = -(tech.get("drawdown_pct") or 0.0)
        stretch = tech.get("stretch_sigma")
        if ticker in etf_hint:
            drop_floor, drop_ceiling = fund_min_drop, fund_max_drop
        elif ticker in CURATED_STOCK_SET:
            drop_floor, drop_ceiling = min_drop, max_drop
        else:
            drop_floor = min(min_drop, fund_min_drop)
            drop_ceiling = max(max_drop, fund_max_drop)
        passes_price_screen = drop_floor <= drop <= drop_ceiling
        passes_price_screen = passes_price_screen and (
            stretch is not None and min_stretch <= stretch <= max_stretch
        )
        rsi = tech.get("rsi_14")
        passes_price_screen = passes_price_screen and (
            rsi is None or min_rsi <= rsi <= max_rsi
        )
        passes_price_screen = passes_price_screen and (
            (tech.get("avg_dollar_volume") or 0.0) >= min_adv
        )
        passes_price_screen = passes_price_screen and not (
            p["exclude_fresh_lows"] and tech.get("fresh_low")
        )
        price = _num(tech.get("price"))
        sma50 = _num(tech.get("sma_50"))
        sma200 = _num(tech.get("sma_200"))
        passes_price_screen = passes_price_screen and not (
            p["require_above_sma200"] and (
            not price or not sma200 or price < sma200
            )
        )
        passes_price_screen = passes_price_screen and not (
            p["require_confirmed_uptrend"] and (
            not sma50 or not sma200 or sma50 < sma200
            )
        )
        tech["ticker"] = ticker
        if passes_price_screen:
            price_pass.append(tech)
        elif (
            allow_lower_confidence_selected_funds
            and ticker in selected_fund_tickers
        ):
            lower_confidence_price.append(tech)

    price_pass.sort(
        key=lambda tech: (
            abs((tech.get("rsi_14") or 45.0) - 45.0),
            abs((tech.get("stretch_sigma") or 1.0) - 1.0),
        )
    )
    lower_confidence_price.sort(
        key=lambda tech: (
            abs((tech.get("rsi_14") or 45.0) - 45.0),
            abs((tech.get("stretch_sigma") or 1.0) - 1.0),
        )
    )
    fundamentals = _fetch_fundamentals_bulk([
        tech["ticker"] for tech in price_pass + lower_confidence_price
    ])

    survivors: list[tuple[dict, dict, bool]] = []
    lower_confidence_price_tickers = {
        tech["ticker"] for tech in lower_confidence_price
    }
    for tech in price_pass + lower_confidence_price:
        ticker = tech["ticker"]
        fund = fundamentals.get(ticker, {})
        is_fund = _is_fund(fund, ticker)
        lower_confidence = ticker in lower_confidence_price_tickers
        drop = -(tech.get("drawdown_pct") or 0.0)
        selected_fund_fallback = (
            allow_lower_confidence_selected_funds
            and ticker in selected_fund_tickers
            and is_fund
            and _fund_kind(ticker, fund) != "leveraged"
        )
        if is_fund:
            misses_fund_filters = (
                drop < fund_min_drop
                or drop > fund_max_drop
                or (
                    fund_min_aum
                    and (_num(fund.get("total_assets")) or 0.0) < fund_min_aum
                )
            )
            if (
                p["exclude_leveraged_funds"]
                and _fund_kind(ticker, fund) == "leveraged"
            ):
                continue
            if misses_fund_filters:
                if not selected_fund_fallback:
                    continue
                lower_confidence = True
        else:
            if drop < min_drop or drop > max_drop:
                continue
            if min_cap and (_num(fund.get("market_cap")) or 0.0) < min_cap:
                continue
            if p["require_profitable"]:
                eps = _num(fund.get("trailing_eps"))
                margin = _num(fund.get("profit_margin"))
                if not (
                    (eps is not None and eps > 0)
                    or (margin is not None and margin > 0)
                ):
                    continue
        survivors.append((tech, fund, lower_confidence))

    # Selected-fund fallbacks are not falsely reported as having passed the
    # strict screen; they are retained only as lower-confidence comparisons.
    passed_fundamentals = sum(1 for _, _, lower in survivors if not lower)
    dropped_for_earnings = 0
    if p["exclude_earnings_before_expiry"]:
        kept = []
        for tech, fund, lower_confidence in survivors:
            if (
                not _is_fund(fund, tech["ticker"])
                and _earnings_within_target_window(
                    fund.get("next_earnings"), target_dte, earnings_buffer
                )
            ):
                dropped_for_earnings += 1
                continue
            kept.append((tech, fund, lower_confidence))
        survivors = kept

    survivors.sort(
        key=lambda pair: (
            0 if pair[0]["ticker"] in selected_fund_tickers else 1,
            pair[2],
            -score_candidate(pair[0], pair[1], None)["score"],
        )
    )
    chain_targets = survivors[:chain_limit]
    chain_target_tickers = {pair[0]["ticker"] for pair in chain_targets}

    def _chain_for(pair):
        tech, fund, _ = pair
        div_yield = dividend_yield_for_pricing(fund, tech.get("price"))
        forecast_vol = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        try:
            return _suggest_bull_put_spread(
                tech["ticker"],
                tech["price"],
                div_yield,
                forecast_vol,
                target_dte,
                min_dte,
                max_dte,
                short_delta=short_delta,
                long_delta=long_delta,
                delta_tolerance=delta_tolerance,
                min_width_pct=min_width,
                max_width_pct=max_width,
                min_credit_pct_of_width=min_credit,
                min_credit_dollars=min_credit_dollars,
                min_cushion_pct=min_cushion,
                min_open_interest=min_oi,
                max_exec_cost_pct=max_exec,
                earnings_date=fund.get("next_earnings"),
                earnings_buffer_days=earnings_buffer,
            )
        except Exception:
            return None

    spreads: dict[str, dict | None] = {}
    if chain_targets:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for pair, spread in zip(
                chain_targets, pool.map(_chain_for, chain_targets)
            ):
                spreads[pair[0]["ticker"]] = spread

    rows: list[dict] = []
    for tech, fund, lower_confidence in survivors:
        ticker = tech["ticker"]
        spread = spreads.get(ticker)
        rating = score_candidate(
            tech, fund, spread, earnings_buffer_days=earnings_buffer
        )
        if lower_confidence:
            rating = {
                **rating,
                "flags": list(dict.fromkeys([
                    *rating.get("flags", []),
                    LOW_CONFIDENCE_SELECTED_FUND_FLAG,
                ])),
            }
        excluded_for_earnings = bool(
            p["exclude_earnings_before_expiry"]
            and rating.get("earnings_before_expiry")
        )
        if excluded_for_earnings:
            dropped_for_earnings += 1
            continue
        if spread:
            management = recommend_management(spread, rating)
            div_yield = dividend_yield_for_pricing(fund, tech.get("price"))
            probability_schedule, profit_capture = profit_probability_schedule(
                spot=tech.get("price"),
                dte=spread.get("dte"),
                expiration=spread.get("expiration"),
                distribution_iv=_spread_distribution_iv(spread),
                entry_cashflow=spread.get("credit"),
                legs=[
                    {
                        "option_type": "put",
                        "strike": (spread.get("short_leg") or {}).get("strike"),
                        "iv": (spread.get("short_leg") or {}).get("iv"),
                        "quantity": -1,
                    },
                    {
                        "option_type": "put",
                        "strike": (spread.get("long_leg") or {}).get("strike"),
                        "iv": (spread.get("long_leg") or {}).get("iv"),
                        "quantity": 1,
                    },
                ],
                exit_points=[
                    {
                        "kind": "reassess",
                        "label": "Reassess",
                        "remaining_dte": (management or {}).get("reassess_dte"),
                    },
                    {
                        "kind": "close_by",
                        "label": "Close by",
                        "remaining_dte": (management or {}).get("close_by_dte"),
                    },
                ],
                risk_free_rate=RISK_FREE,
                dividend_yield=div_yield,
                return_capture=True,
            )
            spread = {
                **spread,
                "management": management,
                "probability_schedule": probability_schedule,
                "profit_capture": profit_capture,
            }

        if lower_confidence:
            chain_status = "underlying_filters_missed"
            watchlist_reason = (
                "This selected index or commodity fund missed one or more "
                "underlying setup filters. The suggested spread is shown for "
                "comparison only; review its lower score and modeled probability."
            )
        elif spread and not spread.get("constraints_relaxed"):
            chain_status = "actionable"
            watchlist_reason = None
        elif spread:
            chain_status = "constraints_relaxed"
            watchlist_reason = (
                "A live pair was found, but it missed at least one selected "
                "credit, cushion, liquidity, or execution limit."
            )
        elif ticker in chain_target_tickers:
            chain_status = "unavailable"
            watchlist_reason = (
                "The option chain was checked, but no fully quotable two-leg "
                "credit spread was available."
            )
        else:
            chain_status = "not_priced"
            watchlist_reason = (
                "This underlying ranked outside the current live-chain pricing "
                f"limit of {chain_limit}."
            )
            rating = {
                **rating,
                "flags": [
                    "Not priced — outside chain limit"
                    if flag == "Option chain unavailable" else flag
                    for flag in rating.get("flags", [])
                ],
            }

        row = {
            "ticker": ticker,
            "name": fund.get("name"),
            "sector": fund.get("sector"),
            "industry": fund.get("industry"),
            "market_cap": _num(fund.get("market_cap")),
            "total_assets": _num(fund.get("total_assets")),
            "size": _fund_size(fund),
            "category": fund.get("category"),
            "price": _round(tech.get("price")),
            "window_pct": _round(tech.get("window_pct")),
            "stretch_sigma": _round(tech.get("stretch_sigma")),
            "drawdown_pct": _round(tech.get("drawdown_pct")),
            "rsi_14": _round(tech.get("rsi_14"), 1),
            "week52_high": _round(tech.get("week52_high")),
            "week52_low": _round(tech.get("week52_low")),
            "above_52w_low_pct": _round(tech.get("above_52w_low_pct"), 1),
            "sma_20": _round(tech.get("sma_20")),
            "sma_50": _round(tech.get("sma_50")),
            "sma_200": _round(tech.get("sma_200")),
            "rv_30": _round(tech.get("rv_30"), 3),
            "rv_252": _round(tech.get("rv_252"), 3),
            "avg_dollar_volume": _num(tech.get("avg_dollar_volume")),
            "trailing_eps": _round(fund.get("trailing_eps")),
            "profit_margin": _round(fund.get("profit_margin"), 4),
            "debt_to_equity": _round(fund.get("debt_to_equity"), 1),
            "target_mean_price": _round(fund.get("target_mean_price")),
            "next_earnings": fund.get("next_earnings"),
            "spread": _round_spread(spread),
            "candidate_status": (
                "lower_confidence" if lower_confidence else "qualified"
            ),
            "chain_status": chain_status,
            "watchlist_reason": watchlist_reason,
            **rating,
        }
        row["verdict"] = build_verdict(row)
        rows.append(row)

    actionable_rows, watchlist_rows = _partition_candidate_rows(
        rows, max_results
    )
    return {
        "rows": actionable_rows,
        "watchlist_rows": watchlist_rows,
        "stats": {
            "universe": len(tickers),
            "priced": priced,
            "passed_price": len(price_pass),
            "passed_fundamentals": passed_fundamentals,
            "chains_fetched": sum(1 for spread in spreads.values() if spread),
            "actionable": len(actionable_rows),
            "watchlist": len(watchlist_rows),
            "dropped_for_earnings": dropped_for_earnings,
            "lower_confidence": sum(
                1 for row in watchlist_rows
                if row.get("candidate_status") == "lower_confidence"
            ),
            "watchlist_earnings": 0,
            "watchlist_relaxed": sum(
                1 for row in watchlist_rows
                if row.get("chain_status") == "constraints_relaxed"
            ),
            "watchlist_unavailable": sum(
                1 for row in watchlist_rows
                if row.get("chain_status") == "unavailable"
            ),
            "watchlist_unpriced": sum(
                1 for row in watchlist_rows
                if row.get("chain_status") == "not_priced"
            ),
            "final": len(actionable_rows),
        },
        "params": {
            "universe": p["universe"],
            "include_stocks": bool(p["include_stocks"]),
            "include_index_etfs": bool(p["include_index_etfs"]),
            "include_sector_etfs": bool(p["include_sector_etfs"]),
            "include_commodity_etfs": bool(p["include_commodity_etfs"]),
            "include_selected_funds": bool(p["include_selected_funds"]),
            "selected_fund_tickers": sorted(selected_fund_tickers),
            "include_lower_confidence_selected_funds": bool(
                p.get("include_lower_confidence_selected_funds", True)
            ),
            "lookback_days": lookback,
            "min_market_cap": min_cap,
            "min_drop_pct": min_drop,
            "max_drop_pct": max_drop,
            "min_stretch_sigma": min_stretch,
            "max_stretch_sigma": max_stretch,
            "fund_min_drop_pct": fund_min_drop,
            "fund_max_drop_pct": fund_max_drop,
            "fund_min_aum": fund_min_aum,
            "min_rsi": min_rsi,
            "max_rsi": max_rsi,
            "min_avg_dollar_volume": min_adv,
            "require_above_sma200": bool(p["require_above_sma200"]),
            "require_confirmed_uptrend": bool(p["require_confirmed_uptrend"]),
            "require_profitable": bool(p["require_profitable"]),
            "exclude_fresh_lows": bool(p["exclude_fresh_lows"]),
            "exclude_earnings_before_expiry": bool(
                p["exclude_earnings_before_expiry"]
            ),
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "short_delta": short_delta,
            "long_delta": long_delta,
            "min_width_pct": min_width,
            "max_width_pct": max_width,
            "min_credit_pct_of_width": min_credit,
            "min_credit_dollars": min_credit_dollars,
            "min_cushion_pct": min_cushion,
            "min_open_interest": min_oi,
            "max_exec_cost_pct": max_exec,
            "chain_limit": chain_limit,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def _round_spread(spread: dict | None) -> dict | None:
    if not spread:
        return None
    out = dict(spread)
    for key, decimals in (
        ("short_strike", 2),
        ("long_strike", 2),
        ("width", 2),
        ("credit", 2),
        ("natural_credit", 2),
        ("credit_pct_of_width", 1),
        ("max_profit", 2),
        ("max_loss", 2),
        ("return_on_risk_pct", 1),
        ("annualized_return_on_risk_pct", 1),
        ("breakeven", 2),
        ("short_otm_pct", 1),
        ("breakeven_cushion_pct", 1),
        ("prob_otm", 1),
        ("fair_credit", 2),
        ("premium_edge", 2),
        ("premium_edge_pct", 1),
        ("exec_cost", 2),
        ("exec_cost_pct", 1),
        ("atm_iv", 4),
        ("credit_dollars", 0),
        ("max_profit_dollars", 0),
        ("max_loss_dollars", 0),
    ):
        if key in out:
            out[key] = _round(out[key], decimals)
    for leg_name in ("short_leg", "long_leg"):
        if isinstance(out.get(leg_name), dict):
            leg = out[leg_name]
            out[leg_name] = {
                **leg,
                "strike": _round(leg.get("strike")),
                "bid": _round(leg.get("bid")),
                "ask": _round(leg.get("ask")),
                "mid": _round(leg.get("mid")),
                "iv": _round(leg.get("iv"), 4),
                "delta": _round(leg.get("delta"), 3),
            }
    return out


def register_routes(app):
    @app.route("/api/options/bull-put-spread-scan/universes", methods=["GET"])
    def bull_put_spread_scan_universes():
        return jsonify(
            universes=[
                {
                    "id": key,
                    "label": value["label"],
                    "count": len(value["tickers"]) if value["tickers"] else None,
                }
                for key, value in UNIVERSE_CHOICES.items()
            ],
            defaults=DEFAULTS,
        )

    @app.route("/api/options/bull-put-spread-scan", methods=["POST"])
    def bull_put_spread_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            payload.setdefault(
                "profile_id", request.args.get("profile_id", type=int)
            )
            payload.setdefault(
                "aggregate_id", request.args.get("aggregate_id", type=int)
            )
            return jsonify(run_bull_put_spread_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
