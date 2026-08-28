"""Covered call candidate scanner.

The mirror image of the put screen, but the trade it rates is not symmetric, so
the entry test is not simply "oversold, flipped".

Selling a covered call gives away the upside above the strike in exchange for a
premium collected today. That trade wins when the stock goes sideways or down a
little, and loses its whole point when the stock keeps running. So the naive
screen — "find overbought names, their calls are expensive" — is the classic way
to lose money at this: the strongest momentum names carry the fattest premium
precisely because they keep going up, and the shares get called away below the
market. Overbought alone is a trap.

What this screen looks for instead is three things at once:

  1. Overextension - the move has already happened, so what remains of the
                     expected upside over the next month is smaller than usual.
  2. Rich premium   - implied vol is elevated against the stock's own realized
                     vol, so the upside being sold is overpriced, not just
                     expensive-looking.
  3. A stalling advance - momentum is cooling rather than accelerating. A name
                     printing fresh 52-week highs scores zero here and is
                     excluded by default, exactly as a name printing fresh lows
                     is excluded from the put screen.

Plus the two risks a put seller never faces, both of which take your shares:

  - An earnings report inside the trade can gap the stock straight through the
    strike, capping the one move you own it for. Dodged, not just flagged.
  - An ex-dividend date inside the trade invites early assignment: once the
    call's remaining extrinsic value is worth less than the dividend, the holder
    exercises the day before to collect it.

Stage structure and the caches are shared with put_scanner, so running one screen
after the other reuses the downloaded history and `.info` payloads. The option
session is primed once per ticker so Yahoo is not asked twice for the
expiration catalog, and the catalog is cached with the call chain (~5 min).

Endpoints:
  GET  /api/options/call-scan/universes
  POST /api/options/call-scan
"""

from __future__ import annotations

import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from flask import jsonify, request

from config import get_connection
from option_probability import profit_probability_schedule
from option_skew_history import calculate_skew_metrics, record_skew_snapshot
from option_strike_targets import strike_for_delta
from options_pricing import black_scholes
from put_scanner import (
    COMMODITY_ETF_SET,
    COMMODITY_ETF_UNIVERSE,
    BENCHMARK,
    CURATED_STOCK_SET,
    INDEX_ETF_SET,
    INDEX_ETF_UNIVERSE,
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    RISK_FREE,
    SECTOR_ETF_SET,
    SECTOR_ETF_UNIVERSE,
    TRADING_DAYS,
    UNIVERSE_CHOICES,
    _atr,
    _benchmark_returns,
    _cache_get,
    _cache_set,
    _clean_tickers,
    _fetch_fundamentals_bulk,
    _earnings_within_target_window,
    _expirations_cache,
    _fund_kind,
    _fund_size,
    _is_fund,
    _load_expirations,
    _load_history,
    _num,
    _option_bundle_expiration,
    _parse_date,
    _pick_expiration,
    _prepare_option_quote,
    _quoted_spread_pct,
    _ramp,
    _round,
    _ticker_frame,
    _wilder_rsi,
    dividend_yield_for_pricing,
    resolve_universe,
    resolve_index_etfs,
    window_stretch,
)

_CHAIN_TTL = 300          # 5 min
_call_chain_cache: dict[tuple[str, str], tuple[float, list]] = {}
_call_skew_put_cache: dict[tuple[str, str], tuple[float, list]] = {}


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
                default_chain = fetch()
            except Exception:
                default_chain = None
    expirations = _load_expirations(ticker, tk)
    return tk, expirations, default_chain


def _call_distribution_iv(call: dict) -> float | None:
    """Spot-distribution vol for a covered call.

    Complete-position success is the stock staying above the credit-adjusted
    breakeven — a near-ATM drop — while the sold strike is further OTM. A
    quieter OTM-call IV would thin that left tail. Take the richer of ATM and
    the short call so assignment-event vol is not ignored either.
    """
    ivs = []
    for value in (call.get("iv"), call.get("atm_iv")):
        number = _num(value)
        if number and number > 0:
            ivs.append(number)
    return max(ivs) if ivs else None

# ---------------------------------------------------------------------------
# Small caps
# ---------------------------------------------------------------------------
# Small caps belong on this screen in a way they do not belong on the put screen.
# Selling a put means agreeing to be assigned into the business, so a small cap
# has to clear a quality bar first; writing a call means selling upside on shares
# you already hold, where the small cap's real attraction — much richer implied
# volatility than a mega cap — is the whole point.
#
# The catch is option liquidity, not company size: plenty of small caps have a
# listed chain that cannot actually be traded. The average-dollar-volume floor
# and the chain spread/open-interest scoring are what filter those out, so this
# list only needs to be a sane optionable starting pool. Names that have since
# been acquired or delisted simply return no history and are skipped.
SMALL_CAP_UNIVERSE = [
    # Biotech and specialty pharma — the richest IV in the small-cap complex
    "SRPT", "ALKS", "HALO", "ARWR", "FOLD", "RARE", "VKTX", "AXSM", "MDGL", "INSM",
    "PTCT", "ARDX", "IRWD", "SUPN", "AMPH", "COLL", "PCRX", "HRMY", "CORT", "PBH",
    # Semis and hardware
    "AMBA", "SITM", "POWI", "DIOD", "FORM", "ACLS", "VECO", "ICHR", "UCTT", "PLAB",
    "AOSL", "SMTC", "MXL", "RMBS", "CEVA", "SYNA", "ALGM", "EXTR", "CALX", "NTGR",
    # Software, internet, and services
    "YELP", "CARG", "CARS", "TRUP", "BLKB", "ENV", "ALRM", "BOX", "ASAN", "AI",
    # Consumer, retail, and restaurants
    "ANF", "BOOT", "FIGS", "JWN", "LEVI", "OLLI", "SHAK", "SIG", "SFIX", "CAKE",
    "BLMN", "JACK", "PZZA", "LOCO", "PLAY", "DENN",
    # Industrials
    "AAON", "ALG", "ATKR", "AWI", "BCC", "CSWI", "CXW", "ESE", "GVA", "HRI",
    "KAI", "MLI", "MYRG", "POWL", "PRIM", "SPXC", "TRN", "WTS", "MWA", "NPO",
    # Energy and oilfield services
    "AMR", "ARCH", "BTU", "CEIX", "CRC", "CRK", "GPOR", "HP", "KOS", "MTDR",
    "NOG", "PARR", "PBF", "PTEN", "RES", "TALO", "WHD", "WTTR", "CLB", "HLX", "OII",
    # Banks and financials
    "ABCB", "AUB", "AX", "BANC", "CADE", "CATY", "CFR", "COLB", "EBC", "FFIN",
    "FIBK", "FULT", "GBCI", "HOMB", "INDB", "ONB", "PB", "PPBI", "SFBS", "SFNC",
    "SSB", "TCBI", "UBSI", "UMBF", "VLY", "WSFS", "WTFC",
    # Materials and metals
    "CENX", "CMC", "KALU", "MP", "MTRN", "RYAM", "SCL", "TROX", "UFPI", "WOR",
    # Healthcare services
    "ADUS", "CHE", "ENSG", "LNTH", "OPCH", "RDNT", "USPH",
    # REITs
    "AKR", "APLE", "BRX", "CTRE", "CUZ", "EPRT", "ESRT", "FCPT", "HIW", "IIPR",
    "KRC", "LXP", "NSA", "OUT", "PECO", "SBRA", "SKT", "STAG", "UMH",
]

SMALL_CAP_SET = frozenset(SMALL_CAP_UNIVERSE)

# The shared universe list plus the small-cap options, which exist only here.
CALL_UNIVERSE_CHOICES = {
    **UNIVERSE_CHOICES,
    "small_cap": {"label": "Small caps only", "tickers": SMALL_CAP_UNIVERSE},
    "large_mid_small": {
        "label": "Large + mid + small caps",
        "tickers": (UNIVERSE_CHOICES["large_mid"]["tickers"] or []) + SMALL_CAP_UNIVERSE,
    },
    "mid_small": {
        "label": "Mid + small caps",
        "tickers": (UNIVERSE_CHOICES["mid_cap"]["tickers"] or []) + SMALL_CAP_UNIVERSE,
    },
}


_SMALL_CAP_CHOICE_IDS = frozenset(k for k in CALL_UNIVERSE_CHOICES if k not in UNIVERSE_CHOICES)


def resolve_call_universe(name: str, custom, profile_id=None, aggregate_id=None) -> list[str]:
    """Universe resolution with the small-cap lists added to the shared ones."""
    if name in _SMALL_CAP_CHOICE_IDS:
        return _clean_tickers(CALL_UNIVERSE_CHOICES[name]["tickers"])
    return resolve_universe(name, custom, profile_id=profile_id, aggregate_id=aggregate_id)

# Point budgets. Named because the partial-score denominator has to stay in step
# with what the chain actually contributes, or an unpriced row gets rated on a
# denominator that does not match the points it was able to earn.
PREMIUM_MAX = 25.0
TERMS_MAX = 25.0
TERMS_CHAIN_MAX = 17.0    # the part of Trade terms that needs a live chain


# ---------------------------------------------------------------------------
# Stage 1 - upside technicals
# ---------------------------------------------------------------------------

def _compute_technicals(sub: pd.DataFrame, bench_ret, lookback_days: int) -> dict | None:
    """Per-ticker metrics for an *upside* dislocation. None when history is thin."""
    close = sub["Close"].dropna()
    if len(close) < 60:
        return None

    price = _num(close.iloc[-1])
    if not price or price <= 0:
        return None

    log_ret = np.log(close / close.shift(1)).dropna()
    ws = window_stretch(log_ret, lookback_days)
    if ws is None:
        return None

    n = ws["n"]
    sigma_d = ws["sigma_d"]
    run_pct = ws["window_pct"]
    # window_stretch signs its output for a decline; the run is the other way.
    stretch_sigma = -ws["stretch_sigma"]

    week52_high = _num(close.max())
    week52_low = _num(close.min())

    # Where in its own yearly range the price sits. A name in the top decile has
    # already travelled; one mid-range is just bouncing.
    pct_of_52w_range = None
    if week52_high and week52_low and week52_high > week52_low:
        pct_of_52w_range = (price - week52_low) / (week52_high - week52_low) * 100.0

    from_high_pct = ((price - week52_high) / week52_high * 100.0) if week52_high else None
    below_52w_high_pct = -from_high_pct if from_high_pct is not None else None

    # How many sigma the advance off the 52-week low represents, over the number
    # of sessions it actually took.
    low_idx = int(close.values.argmin())
    days_since_low = max(1, len(close) - 1 - low_idx)
    run_stretch_sigma = None
    if week52_low and week52_low > 0:
        run_stretch_sigma = math.log(price / week52_low) / (sigma_d * math.sqrt(days_since_low))

    # Beta, then the part of the advance the market does not explain. A stock
    # that merely rose with everything else is not specially extended.
    beta = None
    excess_run_pct = None
    if bench_ret is not None:
        joined = pd.concat([log_ret, bench_ret], axis=1, join="inner").dropna()
        if len(joined) >= 60:
            stock_r = joined.iloc[:, 0]
            bench_r = joined.iloc[:, 1]
            var_b = _num(bench_r.var())
            if var_b and var_b > 0:
                beta = _num(stock_r.cov(bench_r) / var_b)
            if beta is not None and len(bench_r) >= n:
                bench_window = (math.exp(float(bench_r.iloc[-n:].sum())) - 1.0) * 100.0
                excess_run_pct = run_pct - beta * bench_window

    sma_20 = _num(close.rolling(20).mean().iloc[-1]) if len(close) >= 20 else None
    sma_50 = _num(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None
    sma_200 = _num(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None

    high_s = sub["High"] if "High" in sub.columns else close
    low_s = sub["Low"] if "Low" in sub.columns else close
    atr14 = _atr(high_s.dropna(), low_s.dropna(), close)
    # Distance above the 50-day in ATR units: the standard "stretched from the
    # mean" reading, and comparable across names of any volatility.
    atr_above_sma50 = None
    if atr14 and atr14 > 0 and sma_50:
        atr_above_sma50 = (price - sma_50) / atr14
    above_sma20_pct = ((price - sma_20) / sma_20 * 100.0) if sma_20 else None
    above_sma50_pct = ((price - sma_50) / sma_50 * 100.0) if sma_50 else None

    rv_30 = _num(log_ret.iloc[-30:].std() * math.sqrt(TRADING_DAYS)) if len(log_ret) >= 30 else None
    rv_252 = _num(log_ret.std() * math.sqrt(TRADING_DAYS))

    # Is the advance stalling, or still accelerating? Accelerating is the enemy:
    # that is the name that runs through the strike.
    recent_high = _num(close.iloc[-3:].max())
    fresh_high = bool(week52_high and recent_high and recent_high >= week52_high * 0.995)
    high_10 = _num(close.iloc[-10:].max())
    pullback_from_high_pct = ((high_10 - price) / high_10 * 100.0) if high_10 else None

    accel_pp = None
    if len(log_ret) >= 10:
        last5 = (math.exp(float(log_ret.iloc[-5:].sum())) - 1.0) * 100.0
        prior5 = (math.exp(float(log_ret.iloc[-10:-5].sum())) - 1.0) * 100.0
        accel_pp = last5 - prior5      # negative = cooling off

    vol_s = sub["Volume"].dropna() if "Volume" in sub.columns else None
    avg_volume = _num(vol_s.iloc[-30:].mean()) if vol_s is not None and len(vol_s) else None
    avg_dollar_volume = (avg_volume * price) if avg_volume else None

    return {
        "price": price,
        "run_pct": run_pct,
        "expected_move_pct": ws["expected_move_pct"],
        "stretch_sigma": stretch_sigma,
        "run_stretch_sigma": run_stretch_sigma,
        "days_since_low": days_since_low,
        "week52_high": week52_high,
        "week52_low": week52_low,
        "pct_of_52w_range": pct_of_52w_range,
        "from_high_pct": from_high_pct,
        "below_52w_high_pct": below_52w_high_pct,
        "beta": beta,
        "excess_run_pct": excess_run_pct,
        "rsi_14": _wilder_rsi(close),
        "sma_20": sma_20,
        "sma_50": sma_50,
        "sma_200": sma_200,
        "above_sma20_pct": above_sma20_pct,
        "above_sma50_pct": above_sma50_pct,
        "atr_14": atr14,
        "atr_above_sma50": atr_above_sma50,
        "rv_30": rv_30,
        "rv_252": rv_252,
        "fresh_high": fresh_high,
        "pullback_from_high_pct": pullback_from_high_pct,
        "accel_pp": accel_pp,
        "avg_volume": avg_volume,
        "avg_dollar_volume": avg_dollar_volume,
    }


# ---------------------------------------------------------------------------
# Dividends - the covered-call-specific early assignment risk
# ---------------------------------------------------------------------------

def next_ex_dividend(fund: dict) -> tuple[str | None, bool]:
    """Next ex-dividend date as (iso_date, estimated).

    Yahoo's `exDividendDate` is the *next* ex-date once a dividend is declared,
    but falls back to the most recent one when it is not — so a payer can look
    like it has no upcoming ex-date when it simply has not announced yet. When
    the reported date is in the past, the next one is projected forward using
    the payment frequency implied by annual rate / per-payment amount, and
    marked estimated so the UI can say so.
    """
    today = date.today()
    reported = _parse_date(fund.get("ex_dividend_date"))
    if reported and reported >= today:
        return reported.isoformat(), False

    last = _parse_date(fund.get("last_dividend_date")) or reported
    if not last:
        return None, False

    per_payment = _num(fund.get("last_dividend_value"))
    annual = _num(fund.get("dividend_rate")) or _num(fund.get("trailing_annual_dividend_rate"))
    period_days = 91           # quarterly, the overwhelming default for US names
    if per_payment and annual and per_payment > 0:
        per_year = annual / per_payment
        if per_year >= 40:
            period_days = 7    # weekly — the option-income fund complex
        elif per_year >= 10:
            period_days = 30   # monthly
        elif per_year >= 3:
            period_days = 91   # quarterly
        elif per_year >= 1.5:
            period_days = 182  # semi-annual
        else:
            period_days = 365

    projected = last + timedelta(days=period_days)
    # Roll forward in case the stored date is several periods stale.
    guard = 0
    while projected < today and guard < 12:
        projected += timedelta(days=period_days)
        guard += 1
    if projected < today:
        return None, False
    return projected.isoformat(), True


def expected_dividend_amount(fund: dict, price: float | None) -> float | None:
    """Per-share amount of the next dividend, in dollars."""
    per_payment = _num(fund.get("last_dividend_value"))
    if per_payment and per_payment > 0:
        return per_payment
    # Funds report no per-payment figure; assume quarterly off the annual rate.
    annual = _num(fund.get("dividend_rate")) or _num(fund.get("trailing_annual_dividend_rate"))
    if annual and annual > 0:
        return annual / 4.0
    return None


def assess_early_assignment(mid: float | None, spot: float | None, strike: float | None,
                            dividend: float | None, ex_div_inside: bool) -> dict:
    """Judge how exposed a short call is to early exercise for the dividend.

    The mechanic: a call holder exercises early only to capture a dividend, and
    only when the option's remaining extrinsic value is worth less than that
    dividend. An out-of-the-money call is never exercised — but if the stock
    rallies to the strike before the ex-date, the extrinsic left is small, and a
    dividend that is large relative to the whole premium collected is enough to
    take the shares. So the exposure is measured as the dividend against the
    credit, not against today's moneyness.
    """
    credit = _num(mid)
    div = _num(dividend)
    if not ex_div_inside or not div or div <= 0 or not credit or credit <= 0:
        return {"level": "none", "dividend_vs_premium_pct": None, "extrinsic": _round(credit)}

    intrinsic = max(0.0, (_num(spot) or 0.0) - (_num(strike) or 0.0))
    extrinsic = max(0.0, credit - intrinsic)
    ratio = div / credit * 100.0

    if ratio >= 100 or (extrinsic > 0 and div >= extrinsic):
        level = "high"
    elif ratio >= 50:
        level = "elevated"
    else:
        level = "low"
    return {
        "level": level,
        "dividend_vs_premium_pct": _round(ratio, 0),
        "extrinsic": _round(extrinsic),
    }


# ---------------------------------------------------------------------------
# Stage 3 - call chain and the suggested strike
# ---------------------------------------------------------------------------

def _load_call_chain(ticker: str, expiration: str, spot: float, div_yield: float,
                     session_ticker=None, chain=None) -> list[dict]:
    """Calls plus a cached put-side companion for 25-delta skew metrics.

    ``session_ticker`` reuses a yfinance Ticker that already loaded the
    expiration catalog. A fresh Ticker.option_chain(date) otherwise downloads
    that catalog again before the requested expiration.

    ``chain`` is a preloaded option_chain bundle for this same expiration, so
    the default Yahoo response can be used when it is already the contract
    month we want.
    """
    key = (ticker, expiration)
    cached = _cache_get(_call_chain_cache, key, _CHAIN_TTL)
    if cached is not None:
        return cached

    if chain is None:
        try:
            instrument = session_ticker if session_ticker is not None else yf.Ticker(ticker)
            chain = instrument.option_chain(expiration)
        except Exception:
            _cache_set(_call_chain_cache, key, [])
            _cache_set(_call_skew_put_cache, key, [])
            return []

    dte = max((datetime.strptime(expiration, "%Y-%m-%d").date() - date.today()).days, 0)
    T = max(dte, 0.25) / 365.0

    def rows_for(frame, option_type):
        rows = []
        if frame is None or getattr(frame, "empty", True):
            return rows
        try:
            records = frame.to_dict("records")
        except Exception:
            records = [row for _, row in frame.iterrows()]
        for r in records:
            get = r.get if hasattr(r, "get") else lambda key, default=None: default
            strike = _num(get("strike"))
            if not strike or strike <= 0:
                continue
            bid = _num(get("bid"), 0.0) or 0.0
            ask = _num(get("ask"), 0.0) or 0.0
            last = _num(get("lastPrice"), 0.0) or 0.0
            iv = _num(get("impliedVolatility"), 0.0) or 0.0
            mid = (bid + ask) / 2.0 if (bid > 0 and ask > 0) else last
            delta = None
            if iv > 0 and spot > 0:
                try:
                    delta = _num(
                        black_scholes(
                            spot, strike, T, RISK_FREE, div_yield, iv, option_type
                        ).get("delta")
                    )
                except Exception:
                    delta = None
            rows.append({
                "strike": strike,
                "bid": bid,
                "ask": ask,
                "last": last,
                "mid": mid,
                "iv": iv,
                "delta": delta,
                "volume": int(_num(get("volume"), 0) or 0),
                "open_interest": int(_num(get("openInterest"), 0) or 0),
                "dte": dte,
            })
        return rows

    calls = rows_for(getattr(chain, "calls", None), "call")
    puts = rows_for(getattr(chain, "puts", None), "put")
    _cache_set(_call_chain_cache, key, calls)
    _cache_set(_call_skew_put_cache, key, puts)
    return calls


def _load_call_skew_puts(ticker: str, expiration: str) -> list[dict]:
    """Return puts side-loaded by ``_load_call_chain`` without another request."""
    return _cache_get(_call_skew_put_cache, (ticker, expiration), _CHAIN_TTL) or []


def _suggest_call(ticker: str, spot: float, div_yield: float, target_dte: int,
                  target_delta: float, min_dte: int, max_dte: int,
                  earnings_date: str | None = None, earnings_buffer_days: int = 5,
                  cost_basis: float | None = None, respect_cost_basis: bool = True,
                  min_otm_pct: float = 0.0, fund: dict | None = None,
                  fallback_vol: float | None = None) -> dict | None:
    """Best short-call candidate: nearest the target delta, with real quotes.

    Two constraints beyond the put screen's mirror image:
      * the strike must sit at least `min_otm_pct` above spot, so a normal week
        does not immediately put the shares in play;
      * when the cost basis is known, strikes below it are avoided — being
        called away below what you paid turns a premium into a realized loss.
    """
    tk, expirations, default_chain = _prime_option_ticker(ticker)
    if tk is None or not expirations:
        return None

    cutoff = None
    earnings_d = _parse_date(earnings_date)
    if earnings_d:
        cutoff = earnings_d - timedelta(days=max(0, earnings_buffer_days))

    expiration, dte, cleared = _pick_expiration(
        expirations, target_dte, min_dte, max_dte, expire_before=cutoff,
    )
    if not expiration:
        return None

    reuse_chain = (
        default_chain
        if default_chain is not None
        and _option_bundle_expiration(default_chain) == expiration
        else None
    )
    calls = _load_call_chain(
        ticker,
        expiration,
        spot,
        div_yield,
        session_ticker=tk,
        chain=reuse_chain,
    )
    puts = _load_call_skew_puts(ticker, expiration)
    if not calls:
        return None

    # Prefer a live market. After hours Yahoo commonly zeroes bid/ask while
    # retaining the session's last trade and volume; when no live candidate
    # exists, keep analysis available from those explicitly labeled estimates.
    floor_strike = spot * (1.0 + max(0.0, min_otm_pct) / 100.0)
    prepared = [
        quote for quote in (
            _prepare_option_quote(
                call,
                option_type="call",
                spot=spot,
                dte=dte or 0,
                dividend_yield=div_yield,
            )
            for call in calls
            if call["strike"] > floor_strike
        )
        if quote is not None
    ]
    live = [
        call for call in prepared
        if call.get("quote_source") == "live_bid_ask"
    ]
    tradable = live or prepared
    if not tradable:
        return None

    basis = _num(cost_basis)
    pool = tradable
    basis_floor_binding = False
    if respect_cost_basis and basis and basis > 0:
        above_basis = [c for c in tradable if c["strike"] >= basis]
        if above_basis:
            basis_floor_binding = len(above_basis) < len(tradable)
            pool = above_basis

    with_delta = [c for c in pool if c["delta"] is not None]
    if with_delta:
        pick = min(with_delta, key=lambda c: abs(c["delta"] - target_delta))
    else:
        # Preserve the requested delta's time scaling even when the chain has
        # no usable IV/delta rather than falling back to a fixed percent OTM.
        want = strike_for_delta(spot, target_delta, fallback_vol, dte, "call") or spot
        pick = min(pool, key=lambda c: abs(c["strike"] - want))

    # At-the-money IV drives the IV/RV comparison, not the OTM strike's skew.
    atm = min(prepared, key=lambda c: abs(c["strike"] - spot))
    atm_iv = atm["iv"] if atm["iv"] > 0 else pick["iv"]
    skew_metrics = calculate_skew_metrics(puts, calls)

    strike = pick["strike"]
    mid = pick["mid"]
    dte_eff = max(dte or 1, 1)
    expiry_d = datetime.strptime(expiration, "%Y-%m-%d").date()

    # Static return is the credit against the value of the shares committed;
    # if-called adds the capital gain up to the strike. Both matter: static is
    # what you earn if nothing happens, if-called is the capped best case.
    premium_yield = mid / spot * 100.0
    annualized = premium_yield * (365.0 / dte_eff)
    if_called_pct = (mid + strike - spot) / spot * 100.0
    if_called_annualized = if_called_pct * (365.0 / dte_eff)

    spread_pct = (
        _quoted_spread_pct(pick["bid"], pick["ask"], pick["mid"])
        if pick.get("quote_source") == "live_bid_ask" else None
    )

    ex_div_iso, ex_div_estimated = next_ex_dividend(fund or {})
    ex_div_d = _parse_date(ex_div_iso)
    ex_div_inside = bool(ex_div_d and ex_div_d <= expiry_d)
    dividend = expected_dividend_amount(fund or {}, spot)
    early = assess_early_assignment(mid, spot, strike, dividend, ex_div_inside)

    called_gain_pct = None
    called_gain_dollars = None
    if basis and basis > 0:
        called_gain_dollars = (strike - basis + mid) * 100.0
        called_gain_pct = (strike - basis + mid) / basis * 100.0

    return {
        "expiration": expiration,
        "dte": dte,
        "strike": strike,
        "bid": pick["bid"],
        "ask": pick["ask"],
        "mid": mid,
        "iv": pick["iv"],
        "atm_iv": atm_iv,
        "delta": pick["delta"],
        # For a short call this is the chance of finishing below the strike, i.e.
        # of keeping the shares — the number a covered call writer actually cares
        # about.
        "prob_keep_shares": (1.0 - pick["delta"]) * 100.0 if pick["delta"] is not None else None,
        "open_interest": pick["open_interest"],
        "volume": pick["volume"],
        "total_option_volume": sum(
            int(_num(leg.get("volume"), 0) or 0) for leg in calls
        ) + sum(int(_num(leg.get("volume"), 0) or 0) for leg in puts),
        **skew_metrics,
        "quote_source": pick.get("quote_source", "live_bid_ask"),
        "spread_pct": spread_pct,
        "premium_yield_pct": premium_yield,
        "annualized_pct": annualized,
        "if_called_pct": if_called_pct,
        "if_called_annualized_pct": if_called_annualized,
        "otm_pct": (strike - spot) / spot * 100.0 if spot else None,
        "shares_value": spot * 100.0,
        "premium_dollars": mid * 100.0,
        "upside_cap": strike + mid,
        "downside_breakeven": spot - mid,
        # Cost-basis interaction — only knowable for a position you actually hold.
        "cost_basis": _round(basis),
        "below_basis": bool(basis and strike < basis),
        "basis_floor_binding": basis_floor_binding,
        "called_gain_pct": called_gain_pct,
        "called_gain_dollars": called_gain_dollars,
        # Event risk for this specific expiration.
        "earnings_date": earnings_d.isoformat() if earnings_d else None,
        "avoids_earnings": cleared if earnings_d else None,
        "days_earnings_after_expiry": (
            (earnings_d - expiry_d).days if earnings_d else None
        ),
        "ex_dividend_date": ex_div_iso,
        "ex_dividend_estimated": ex_div_estimated,
        "ex_dividend_inside": ex_div_inside,
        "dividend_amount": _round(dividend),
        "early_assignment": early,
    }


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_candidate(tech: dict, fund: dict, call: dict | None,
                    earnings_buffer_days: int = 5) -> dict:
    """Rate a name as a covered call candidate on four independent axes.

    Overextension (30) - has it already made its move?
    Premium       (25) - is the upside being sold overpriced, not just pricey?
    Stall         (20) - is the advance cooling, or still accelerating into it?
    Trade terms   (25) - is what you actually get paid worth the capped upside?
    """
    flags: list[str] = []

    # ── Overextension ─────────────────────────────────────────────────────
    overextension = 0.0
    overextension += _ramp(tech.get("stretch_sigma"), 1.0, 3.0, 12)
    overextension += _ramp(tech.get("pct_of_52w_range"), 60, 100, 6)
    overextension += _ramp(tech.get("atr_above_sma50"), 0.5, 3.0, 6)
    overextension += _ramp(tech.get("excess_run_pct"), 2, 15, 6)

    # ── Premium ───────────────────────────────────────────────────────────
    premium = 0.0
    iv_rv = None
    iv_rank = None
    if call:
        if call.get("quote_source") == "last_trade_estimate":
            flags.append("Recent trade estimate — no live bid/ask")
        atm_iv = _num(call.get("atm_iv"))
        rv30 = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        if atm_iv and rv30 and rv30 > 0:
            iv_rv = atm_iv / rv30
            premium += _ramp(iv_rv, 1.0, 1.6, 14)
        rv252 = _num(tech.get("rv_252"))
        if atm_iv and rv252 and rv252 > 0:
            # No historical IV series available, so rank current IV against the
            # name's own realized vol as a stand-in for an IV percentile.
            iv_rank = min(100.0, max(0.0, (atm_iv / rv252 - 0.7) / 0.9 * 100.0))
            premium += _ramp(iv_rank, 30, 80, 6)
        premium += _ramp(call.get("annualized_pct"), 8, 30, 5)

        if (call.get("spread_pct") or 0) > 25:
            flags.append("Wide bid/ask spread")
        if (call.get("open_interest") or 0) < 50:
            flags.append("Thin open interest")

    # ── Stall ─────────────────────────────────────────────────────────────
    # The mirror of the put screen's Stabilization axis. A name at fresh highs
    # is to a call seller what a name at fresh lows is to a put seller.
    stall = 0.0
    if tech.get("fresh_high"):
        flags.append("Making fresh 52-week highs")
    else:
        stall += 7
    stall += _ramp(tech.get("pullback_from_high_pct"), 0, 4, 5)
    # accel_pp is negative when the advance is cooling, which is what we want.
    accel = tech.get("accel_pp")
    stall += _ramp(-(accel if accel is not None else 0.0), 0, 8, 4)
    stall += _ramp(tech.get("below_52w_high_pct"), 1, 10, 4)

    if accel is not None and accel > 5:
        flags.append("Advance still accelerating")

    # ── Trade terms ───────────────────────────────────────────────────────
    # 8 points do not need a chain (the underlying itself), 17 do.
    terms = 0.0
    ticker = tech.get("ticker") or ""
    is_fund = _is_fund(fund, ticker)
    fund_kind = _fund_kind(ticker, fund) if is_fund else None
    size = _fund_size(fund) or 0.0

    # Size (4). Judged more lightly than on the put screen: you are not being
    # assigned into this name, you already hold it, so what matters is that the
    # option market on it is real rather than that the business is bulletproof.
    if size >= 50e9:
        terms += 4
    elif size >= 10e9:
        terms += 3.5
    elif size >= 2e9:
        terms += 2.5
    elif size >= 500e6:
        terms += 1.5
    else:
        terms += 0.5
        flags.append("Small underlying")

    if is_fund and fund_kind == "leveraged":
        flags.append("Leveraged or inverse fund")

    # Share liquidity (4) — a proxy for how tight the option market will be.
    adv = _num(tech.get("avg_dollar_volume")) or 0.0
    if adv >= 200e6:
        terms += 4
    elif adv >= 50e6:
        terms += 3.2
    elif adv >= 20e6:
        terms += 2.4
    elif adv >= 5e6:
        terms += 1.2
    else:
        flags.append("Thin share liquidity")

    if call:
        # If-called return (6) — the capped best case, annualized.
        terms += _ramp(call.get("if_called_annualized_pct"), 10, 40, 6)
        # Upside room (5) — how far the stock can run before the shares go.
        terms += _ramp(call.get("otm_pct"), 2, 12, 5)

        # Chain liquidity (4) — can you actually get out of it?
        spread_pct = _num(call.get("spread_pct"))
        oi = int(_num(call.get("open_interest"), 0) or 0)
        chain_liq = 0.0
        if spread_pct is None:
            chain_liq += 1.0
        elif spread_pct <= 8:
            chain_liq += 2.5
        elif spread_pct <= 15:
            chain_liq += 1.8
        elif spread_pct <= 25:
            chain_liq += 1.0
        if oi >= 1000:
            chain_liq += 1.5
        elif oi >= 200:
            chain_liq += 1.1
        elif oi >= 50:
            chain_liq += 0.6
        terms += min(4.0, chain_liq)

        # Dividend safety (2) — the early-assignment path to losing the shares.
        early = call.get("early_assignment") or {}
        level = early.get("level")
        if level in (None, "none", "low"):
            terms += 2
        elif level == "elevated":
            terms += 1
            flags.append("Dividend near premium — early assignment risk")
        else:
            flags.append("Dividend exceeds option premium — likely early assignment")

        if call.get("below_basis"):
            flags.append("Strike below your cost basis")

    # ── Event risk ────────────────────────────────────────────────────────
    # An earnings report inside the trade is worse for a call writer than the
    # symmetry suggests: a gap up hands away the exact move the shares are held
    # for, while a gap down leaves you long a falling stock for a small credit.
    earnings_before_expiry = None
    earnings_date = _parse_date(fund.get("next_earnings"))
    expiry_date = _parse_date(call["expiration"]) if call else None
    if earnings_date and expiry_date:
        earnings_before_expiry = earnings_date <= expiry_date
        gap = (earnings_date - expiry_date).days
        if earnings_before_expiry:
            flags.append("Earnings before expiration")
            premium = max(0.0, premium - 6)   # the premium is not really free
        elif gap <= earnings_buffer_days:
            flags.append(f"Earnings {gap}d after expiry")

    price = _num(tech.get("price"))
    sma200 = _num(tech.get("sma_200"))
    if price and sma200 and price > sma200 * 1.35:
        flags.append("Far above the 200-day average")

    total = overextension + premium + stall + terms
    # Without a chain the Premium axis and most of Trade terms cannot score, so
    # rate on what was actually scorable. That inflates the normalized number
    # rather than deflating it, so run_call_scan ranks unpriced rows below every
    # priced one instead of letting the smaller denominator float them up.
    scored_max = 100.0 if call else (100.0 - PREMIUM_MAX - TERMS_CHAIN_MAX)
    normalized = total / scored_max * 100.0
    if call is None:
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
        "score": round(normalized, 1),
        "grade": grade,
        "components": {
            "overextension": round(overextension, 1),
            "premium": round(premium, 1),
            "stall": round(stall, 1),
            "terms": round(terms, 1),
        },
        "component_max": {
            "overextension": 30, "premium": 25, "stall": 20, "terms": 25,
        },
        "iv_rv_ratio": _round(iv_rv, 2),
        "iv_rank": _round(iv_rank, 0),
        "earnings_before_expiry": earnings_before_expiry,
        "days_to_earnings": (earnings_date - date.today()).days if earnings_date else None,
        "is_fund": is_fund,
        "fund_kind": fund_kind,
        "flags": flags,
        "scored_on_partial": call is None,
    }


def recommend_management(call: dict | None, rating: dict | None) -> dict | None:
    """Buy-to-close target plus the level at which to defend the shares.

    A covered call has two management decisions, not one. The profit target is
    the same idea as on the put screen: keep most of the credit and hand back
    the rest to remove the remaining risk. The second is specific to calls — if
    the stock trades up to the strike the shares are genuinely in play, and the
    choice there is to roll up and out or to let them go. Both are transparent
    heuristics, not forecasts.
    """
    if not call:
        return None
    credit = _num(call.get("mid"))
    if credit is None or credit <= 0:
        return None

    rating = rating or {}
    score = _num(rating.get("score"), 0.0) or 0.0
    grade = str(rating.get("grade") or "")
    prob_keep = _num(call.get("prob_keep_shares"))
    delta_raw = _num(call.get("delta"))
    delta = abs(delta_raw) if delta_raw is not None else 1.0
    dte_raw = _num(call.get("dte"))
    dte = max(1, int(dte_raw)) if dte_raw is not None else 1
    # `or 100.0` would be wrong: a perfectly tight market quotes 0.0, and reading
    # that as a 100% spread demoted the best-quoted writes on the board.
    spread_pct = _num(call.get("spread_pct"))
    if spread_pct is None:
        spread_pct = 100.0
    open_interest = int(_num(call.get("open_interest"), 0) or 0)
    flags = set(rating.get("flags") or [])
    material_risk_flags = {
        "Making fresh 52-week highs",
        "Advance still accelerating",
        "Earnings before expiration",
        "Wide bid/ask spread",
        "Thin open interest",
        "Dividend exceeds option premium — likely early assignment",
        "Strike below your cost basis",
    }
    has_material_risk = bool(flags & material_risk_flags)

    if (
        grade == "A"
        and score >= 80
        and prob_keep is not None
        # 0.25 delta implies roughly a 75% chance of keeping the shares, so the
        # two bounds have to agree; requiring 78% here would make the delta
        # bound dead and quietly demote every conventional 0.30-delta write.
        and prob_keep >= 75
        and delta <= 0.25
        and dte >= 28
        and spread_pct <= 15
        and open_interest >= 200
        and not has_material_risk
    ):
        target_capture_pct = 70.0
        profile = "Strong setup"
        rationale = (
            "The high setup score, low delta, and liquid chain support waiting "
            "for 70% of the quoted credit before buying it back."
        )
    elif (
        grade in {"A", "B"}
        and score >= 70
        and prob_keep is not None
        and prob_keep >= 70
        and delta <= 0.35
        and not has_material_risk
    ):
        target_capture_pct = 65.0
        profile = "Balanced setup"
        rationale = (
            "A 65% profit target keeps nearly two-thirds of the credit while "
            "closing before the last of the premium carries the most risk."
        )
    else:
        target_capture_pct = 60.0
        profile = "Defensive setup"
        rationale = (
            "The setup or chain carries added risk, so the target closes sooner "
            "after retaining 60% of the quoted credit."
        )

    target_price = max(0.01, round(credit * (1.0 - target_capture_pct / 100.0), 2))
    premium_kept_per_share = max(0.0, credit - target_price)
    actual_capture_pct = premium_kept_per_share / credit * 100.0
    reassess_dte = 21 if dte > 28 else max(7, int(round(dte * 0.5)))

    strike = _num(call.get("strike"))
    ex_div_inside = bool(call.get("ex_dividend_inside"))
    early_level = ((call.get("early_assignment") or {}).get("level")) or "none"
    if ex_div_inside and early_level in ("elevated", "high"):
        defend_note = (
            "Close or roll before the ex-dividend date rather than at expiry — "
            "an in-the-money call is most likely to be exercised early the day "
            "before the stock goes ex-dividend."
        )
    else:
        defend_note = (
            "If the stock reaches the strike with time left, the shares are in "
            "play: roll up and out for a net credit to keep them, or let them go "
            "and bank the capped gain."
        )

    return {
        "target_price": round(target_price, 2),
        "profit_capture_pct": round(actual_capture_pct, 1),
        "premium_kept_dollars": round(premium_kept_per_share * 100.0, 0),
        "premium_returned_dollars": round(target_price * 100.0, 0),
        "entry_credit_basis": round(credit, 2),
        "reassess_dte": reassess_dte,
        "defend_price": _round(strike),
        "defend_note": defend_note,
        "profile": profile,
        "rationale": rationale,
    }


def build_verdict(row: dict) -> str:
    """One line explaining why this name is (or is not) worth writing calls on."""
    call = row.get("call") or {}
    stretch = _num(row.get("stretch_sigma")) or 0.0
    run = _num(row.get("run_pct")) or 0.0
    grade = row.get("grade")

    move = f"up {abs(run):.0f}% over the window"
    sigma = f"{stretch:.1f}σ beyond its normal range"

    subject = {
        "index": "Broad index fund",
        "sector": "Sector fund",
        "leveraged": "Leveraged fund",
        "narrow": "Narrow fund",
    }.get(row.get("fund_kind") or "", "Extended name")

    if grade in ("A", "B"):
        lead = f"{subject} {move}, {sigma}"
    elif grade == "C":
        lead = f"{'Workable setup' if not row.get('is_fund') else subject + ', workable setup'} {move}, {sigma}"
    else:
        lead = f"{'Marginal setup' if not row.get('is_fund') else subject + ', marginal setup'} {move}, {sigma}"

    if call.get("annualized_pct") and call.get("strike"):
        lead += (
            f". Selling the {call['expiration']} ${call['strike']:g} call pays "
            f"{call['annualized_pct']:.0f}% annualized on the shares"
        )
        if call.get("if_called_annualized_pct"):
            lead += f", {call['if_called_annualized_pct']:.0f}% if called away"
        mgmt = call.get("management") or {}
        if mgmt.get("target_price") is not None:
            lead += (
                f". Success-oriented exit: buy it back near "
                f"${mgmt['target_price']:.2f} to retain about "
                f"{mgmt['profit_capture_pct']:.0f}% of the quoted credit"
            )

    flags = row.get("flags") or []
    if "Making fresh 52-week highs" in flags:
        lead += ". Still breaking out — writing here caps the move you own it for"
    elif "Advance still accelerating" in flags:
        lead += ". Momentum is still building, so assignment risk is understated"
    elif "Strike below your cost basis" in flags:
        lead += ". No strike above your cost basis had a bid, so being called would realize a loss"
    elif "Dividend exceeds option premium — likely early assignment" in flags:
        lead += f". The {call.get('ex_dividend_date')} ex-dividend invites early assignment"
    elif "Earnings before expiration" in flags:
        lead += ". Earnings land inside the trade"
    elif call.get("avoids_earnings") and call.get("days_earnings_after_expiry") is not None:
        lead += (
            f". This expiration closes {call['days_earnings_after_expiry']}d before "
            f"earnings on {call['earnings_date']}"
        )
    return lead + "."


# ---------------------------------------------------------------------------
# Universe resolution and held positions
# ---------------------------------------------------------------------------

def _scope_profile_ids(conn, profile_id, aggregate_id) -> list[int]:
    ids = []
    if aggregate_id:
        rows = conn.execute(
            "SELECT member_profile_id FROM aggregate_config WHERE aggregate_id = ? "
            "ORDER BY member_profile_id",
            (aggregate_id,),
        ).fetchall()
        ids = [r[0] for r in rows]
    return ids or [profile_id or 1]


def held_positions(profile_id=None, aggregate_id=None, basis_mode="original") -> dict[str, dict]:
    """Shares held and average cost per share, by ticker.

    Cost basis is derived as quantity x per-share price rather than read from a
    stored total, because the stored totals are frozen at import and go stale
    when the share count changes. Rows with no per-share price are left out of
    the weighted average instead of dragging it toward zero.
    """
    if basis_mode == "broker_adjusted":
        price = "COALESCE(broker_price_paid, price_paid, original_price_paid)"
    else:
        price = "COALESCE(original_price_paid, price_paid, broker_price_paid)"

    conn = get_connection()
    try:
        ids = _scope_profile_ids(conn, profile_id, aggregate_id)
        placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"""
            SELECT ticker,
                   SUM(quantity) AS shares,
                   SUM(CASE WHEN {price} IS NOT NULL THEN quantity * {price} END) AS basis_total,
                   SUM(CASE WHEN {price} IS NOT NULL THEN quantity END) AS basis_qty
            FROM all_account_info
            WHERE profile_id IN ({placeholders}) AND COALESCE(quantity, 0) > 1e-9
            GROUP BY ticker
            """,
            ids,
        ).fetchall()
    finally:
        conn.close()

    out: dict[str, dict] = {}
    for r in rows:
        ticker = (r[0] or "").strip().upper()
        if not ticker:
            continue
        shares = _num(r[1]) or 0.0
        basis_total, basis_qty = _num(r[2]), _num(r[3])
        cost_basis = (basis_total / basis_qty) if (basis_total and basis_qty and basis_qty > 0) else None
        out[ticker] = {
            "shares": shares,
            "contracts_writable": int(shares // 100),
            "cost_basis": _round(cost_basis),
        }
    return out


def resolve_scan_universe(p: dict) -> list[str]:
    """Union of the enabled groups, same independent-group model as the puts."""
    tickers: list[str] = []
    if p.get("include_stocks", True):
        tickers += resolve_call_universe(
            p.get("universe") or "holdings", p.get("custom_tickers"),
            profile_id=p.get("profile_id"), aggregate_id=p.get("aggregate_id"),
        )
    if p.get("include_index_etfs"):
        tickers += resolve_index_etfs(p.get("index_tickers"))
    if p.get("include_sector_etfs"):
        tickers += SECTOR_ETF_UNIVERSE
    if p.get("include_commodity_etfs"):
        tickers += COMMODITY_ETF_UNIVERSE
    return _clean_tickers(tickers)


# ---------------------------------------------------------------------------
# The scan
# ---------------------------------------------------------------------------

DEFAULTS = {
    # Holdings first: the natural covered call question is "which of the shares
    # I already own should I write calls against?", and only a held position has
    # a share count and a cost basis to check the strike against.
    "universe": "holdings",
    "include_stocks": True,
    "include_index_etfs": False,
    "include_sector_etfs": False,
    "include_commodity_etfs": False,
    "lookback_days": 21,
    "min_market_cap": 2e9,
    # Small caps get their own floor for the same reason funds get theirs: the
    # large-cap gate would silently empty a small-cap scan. Their option
    # liquidity is the real risk, and min_avg_dollar_volume is what gates that.
    "small_cap_min_market_cap": 300e6,
    "min_run_pct": 8.0,
    "min_stretch_sigma": 1.25,
    "min_rsi": 60.0,
    "min_pct_of_52w_range": 65.0,
    # Funds travel less than single stocks, so they need their own floors — the
    # sigma stretch still does the real work of comparing across volatilities.
    "fund_min_run_pct": 4.0,
    "fund_min_stretch_sigma": 1.25,
    "fund_min_aum": 300e6,
    "exclude_leveraged_funds": True,
    "min_avg_dollar_volume": 10e6,
    # On by default, and the single most important default here: a name printing
    # fresh 52-week highs is the one that runs through the strike and takes the
    # shares. Overbought is not the same thing as finished going up.
    "exclude_fresh_highs": True,
    "exclude_earnings_before_expiry": True,
    "earnings_buffer_days": 5,
    "require_shares_held": False,
    "respect_cost_basis": True,
    "basis_mode": "original",
    "target_dte": 35,
    # The UI exposes Target DTE, not a second hidden expiration window. Keep the
    # defaults broad so moving that control can reach the requested expiration.
    "min_dte": MIN_TARGET_DTE,
    "max_dte": MAX_TARGET_DTE,
    # 0.30 delta is the conventional covered call target: enough premium to be
    # worth writing, roughly a 70% chance of keeping the shares.
    "target_delta": 0.30,
    "min_otm_pct": 2.0,
    "chain_limit": 20,
    "max_results": 40,
}


def run_call_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}

    lookback = max(5, min(126, int(_num(p["lookback_days"], 21))))
    min_cap = max(0.0, _num(p["min_market_cap"], 0.0) or 0.0)
    small_min_cap = max(0.0, _num(p["small_cap_min_market_cap"], 0.0) or 0.0)
    min_run = _num(p["min_run_pct"], 0.0) or 0.0
    min_stretch = _num(p["min_stretch_sigma"], 0.0) or 0.0
    min_rsi = _num(p["min_rsi"], 0.0) or 0.0
    min_range_pct = _num(p["min_pct_of_52w_range"], 0.0) or 0.0
    fund_min_run = _num(p["fund_min_run_pct"], 0.0) or 0.0
    fund_min_stretch = _num(p["fund_min_stretch_sigma"], 0.0) or 0.0
    fund_min_aum = max(0.0, _num(p["fund_min_aum"], 0.0) or 0.0)
    min_adv = _num(p["min_avg_dollar_volume"], 0.0) or 0.0
    target_dte = max(
        MIN_TARGET_DTE,
        min(MAX_TARGET_DTE, int(_num(p["target_dte"], 35))),
    )
    min_dte = max(MIN_TARGET_DTE, int(_num(p["min_dte"], MIN_TARGET_DTE)))
    max_dte = max(min_dte, int(_num(p["max_dte"], MAX_TARGET_DTE)))
    target_delta = min(0.9, max(0.01, _num(p["target_delta"], 0.30) or 0.30))
    min_otm = max(0.0, _num(p["min_otm_pct"], 0.0) or 0.0)
    earnings_buffer = max(0, min(30, int(_num(p["earnings_buffer_days"], 5))))
    chain_limit = max(0, min(60, int(_num(p["chain_limit"], 20))))
    max_results = max(1, min(200, int(_num(p["max_results"], 40))))
    basis_mode = "broker_adjusted" if str(p.get("basis_mode") or "").lower().startswith(
        ("broker", "adjust")
    ) else "original"

    tickers = resolve_scan_universe(p)
    if not tickers:
        return {
            "rows": [], "stats": {"universe": 0, "priced": 0, "passed_price": 0, "final": 0},
            "params": p,
            "error": "Nothing selected to scan. Enable stocks, index ETFs, or sector ETFs.",
        }

    # Held shares are looked up regardless of universe, so a large-cap scan still
    # reports "you own 300 of these" and can check the strike against your basis.
    try:
        positions = held_positions(p.get("profile_id"), p.get("aggregate_id"), basis_mode)
    except Exception:
        positions = {}

    if p.get("require_shares_held"):
        tickers = [t for t in tickers if (positions.get(t, {}).get("contracts_writable") or 0) >= 1]
        if not tickers:
            return {
                "rows": [], "stats": {"universe": 0, "priced": 0, "passed_price": 0, "final": 0},
                "params": p,
                "error": "No position in the selected universe holds 100 or more shares, "
                         "which is the minimum for one covered call contract.",
            }

    etf_hint = INDEX_ETF_SET | SECTOR_ETF_SET | COMMODITY_ETF_SET

    hist = _load_history(tickers)
    if hist is None or hist.empty:
        return {
            "rows": [], "stats": {"universe": len(tickers), "priced": 0, "passed_price": 0, "final": 0},
            "params": p, "error": "Price history unavailable. Yahoo may be rate-limiting; try again shortly.",
        }

    bench_ret = _benchmark_returns(hist)

    priced, price_pass = 0, []
    for ticker in tickers:
        sub = _ticker_frame(hist, ticker)
        if sub is None:
            continue
        tech = _compute_technicals(sub, bench_ret, lookback)
        if tech is None:
            continue
        priced += 1

        # A curated ticker is known to be a fund (or a company) up front. Anything
        # else — a holding, a watchlist name, a custom ticker — is unknown until
        # stage 2, and this screen defaults to *holdings*, so gating an unknown
        # ETF on the stock floors hid the whole fund side of the portfolio. Unknown
        # tickers clear the looser floor here and are re-checked in stage 2.
        run = tech.get("run_pct") or 0.0
        stretch = tech.get("stretch_sigma") or 0.0
        if ticker in etf_hint:
            run_floor, stretch_floor = fund_min_run, fund_min_stretch
        elif ticker in CURATED_STOCK_SET or ticker in SMALL_CAP_SET:
            run_floor, stretch_floor = min_run, min_stretch
        else:
            run_floor = min(min_run, fund_min_run)
            stretch_floor = min(min_stretch, fund_min_stretch)
        if run < run_floor or stretch < stretch_floor:
            continue
        rsi = tech.get("rsi_14")
        if rsi is not None and rsi < min_rsi:
            continue
        range_pct = tech.get("pct_of_52w_range")
        if range_pct is not None and range_pct < min_range_pct:
            continue
        if (tech.get("avg_dollar_volume") or 0.0) < min_adv:
            continue
        if p["exclude_fresh_highs"] and tech.get("fresh_high"):
            continue
        tech["ticker"] = ticker
        price_pass.append(tech)

    # Rank the price stage so the expensive stages only touch the best names.
    price_pass.sort(key=lambda t: -(t.get("stretch_sigma") or 0.0))
    fundamentals = _fetch_fundamentals_bulk([t["ticker"] for t in price_pass])

    survivors = []
    for tech in price_pass:
        ticker = tech["ticker"]
        fund = fundamentals.get(ticker, {})
        is_fund = _is_fund(fund, ticker)
        run = tech.get("run_pct") or 0.0
        stretch = tech.get("stretch_sigma") or 0.0

        # A fund reports AUM rather than a market cap. Unlike the put screen
        # there is no profitability gate on either path: a covered call is
        # written on shares you already hold, so the question is whether the
        # option market is real, not whether the business is one to be
        # assigned into. The run/stretch floors are re-applied because the price
        # stage can only guess which set a non-curated ticker belongs to.
        if is_fund:
            if run < fund_min_run or stretch < fund_min_stretch:
                continue
            if fund_min_aum and (_num(fund.get("total_assets")) or 0.0) < fund_min_aum:
                continue
            if p["exclude_leveraged_funds"] and _fund_kind(ticker, fund) == "leveraged":
                continue
        else:
            if run < min_run or stretch < min_stretch:
                continue
            # A curated small cap is measured against the small-cap floor; the
            # large-cap gate would drop the entire list.
            cap_floor = small_min_cap if ticker in SMALL_CAP_SET else min_cap
            if cap_floor and (_num(fund.get("market_cap")) or 0.0) < cap_floor:
                continue
        survivors.append((tech, fund))

    passed_fundamentals = len(survivors)
    dropped_for_earnings = 0
    if p["exclude_earnings_before_expiry"]:
        kept = []
        for tech, fund in survivors:
            if (
                not _is_fund(fund, tech["ticker"])
                and _earnings_within_target_window(
                    fund.get("next_earnings"), target_dte, earnings_buffer
                )
            ):
                dropped_for_earnings += 1
                continue
            kept.append((tech, fund))
        survivors = kept

    # Provisional score without the chain, to choose who gets a chain lookup.
    survivors.sort(key=lambda pair: -score_candidate(pair[0], pair[1], None)["score"])
    chain_targets = survivors[:chain_limit]

    def _chain_for(pair):
        tech, fund = pair
        ticker = tech["ticker"]
        div_y = dividend_yield_for_pricing(fund, tech.get("price"))
        pos = positions.get(ticker) or {}
        try:
            return _suggest_call(
                ticker, tech["price"], div_y,
                target_dte, target_delta, min_dte, max_dte,
                earnings_date=fund.get("next_earnings"),
                earnings_buffer_days=earnings_buffer,
                cost_basis=pos.get("cost_basis"),
                respect_cost_basis=bool(p["respect_cost_basis"]),
                min_otm_pct=min_otm,
                fund=fund,
                fallback_vol=_num(tech.get("rv_30")) or _num(tech.get("rv_252")),
            )
        except Exception:
            return None

    calls: dict[str, dict | None] = {}
    if chain_targets:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for pair, call in zip(chain_targets, pool.map(_chain_for, chain_targets)):
                calls[pair[0]["ticker"]] = call

    rows = []
    for tech, fund in survivors:
        ticker = tech["ticker"]
        call = calls.get(ticker)
        rating = score_candidate(tech, fund, call, earnings_buffer_days=earnings_buffer)
        # _suggest_call already tried to find an expiration that closes before
        # the report; reaching here means no expiration in the window could.
        if p["exclude_earnings_before_expiry"] and rating.get("earnings_before_expiry"):
            dropped_for_earnings += 1
            continue
        if call:
            skew_history = record_skew_snapshot(
                ticker,
                call,
                call.get("expiration"),
                dte=call.get("dte"),
            )
            for metric in ("put_skew", "call_skew", "skew"):
                rank_meta = skew_history.get(metric) or {}
                call[f"{metric}_rank"] = (
                    rank_meta.get("rank")
                    if rank_meta.get("rank") is not None
                    else rank_meta.get("provisional_rank")
                )
                call[f"{metric}_rank_ready"] = bool(rank_meta.get("ready"))
                call[f"{metric}_rank_observations"] = int(
                    rank_meta.get("observations") or 0
                )
            management = recommend_management(call, rating)
            div_yield = dividend_yield_for_pricing(fund, tech.get("price"))
            ex_dividend_exit = None
            early_level = (call.get("early_assignment") or {}).get("level")
            ex_dividend_date = _parse_date(call.get("ex_dividend_date"))
            if (
                ex_dividend_date
                and call.get("ex_dividend_inside")
                and early_level in {"elevated", "high"}
            ):
                ex_dividend_exit = (
                    ex_dividend_date - timedelta(days=1)
                ).isoformat()
            probability_schedule, profit_capture = profit_probability_schedule(
                spot=tech.get("price"),
                dte=call.get("dte"),
                expiration=call.get("expiration"),
                distribution_iv=_call_distribution_iv(call),
                entry_cashflow=call.get("mid"),
                legs=[{
                    "option_type": "call",
                    "strike": call.get("strike"),
                    "iv": call.get("iv"),
                    "quantity": -1,
                }],
                exit_points=[
                    {
                        "kind": "reassess",
                        "label": "Reassess / exit",
                        "remaining_dte": (management or {}).get("reassess_dte"),
                    },
                    {
                        "kind": "ex_dividend",
                        "label": "Exit before ex-dividend",
                        "exit_date": ex_dividend_exit,
                    },
                ],
                risk_free_rate=RISK_FREE,
                dividend_yield=div_yield,
                underlying_quantity=1,
                return_capture=True,
            )
            call = {
                **call,
                "management": management,
                "probability_schedule": probability_schedule,
                "profit_capture": profit_capture,
            }

        pos = positions.get(ticker) or {}
        row = {
            "ticker": ticker,
            "name": fund.get("name"),
            "sector": fund.get("sector"),
            "industry": fund.get("industry"),
            "market_cap": _num(fund.get("market_cap")),
            "total_assets": _num(fund.get("total_assets")),
            "size": _fund_size(fund),
            "category": fund.get("category"),
            "expense_ratio": _round(fund.get("expense_ratio"), 4),
            "price": _round(tech.get("price")),
            "run_pct": _round(tech.get("run_pct")),
            "expected_move_pct": _round(tech.get("expected_move_pct")),
            "stretch_sigma": _round(tech.get("stretch_sigma")),
            "run_stretch_sigma": _round(tech.get("run_stretch_sigma")),
            "excess_run_pct": _round(tech.get("excess_run_pct")),
            "pct_of_52w_range": _round(tech.get("pct_of_52w_range"), 1),
            "from_high_pct": _round(tech.get("from_high_pct")),
            "below_52w_high_pct": _round(tech.get("below_52w_high_pct"), 1),
            "beta": _round(tech.get("beta")),
            "rsi_14": _round(tech.get("rsi_14"), 1),
            "atr_above_sma50": _round(tech.get("atr_above_sma50")),
            "above_sma20_pct": _round(tech.get("above_sma20_pct"), 1),
            "above_sma50_pct": _round(tech.get("above_sma50_pct"), 1),
            "week52_high": _round(tech.get("week52_high")),
            "week52_low": _round(tech.get("week52_low")),
            "pullback_from_high_pct": _round(tech.get("pullback_from_high_pct"), 1),
            "accel_pp": _round(tech.get("accel_pp"), 1),
            "fresh_high": tech.get("fresh_high"),
            "sma_50": _round(tech.get("sma_50")),
            "sma_200": _round(tech.get("sma_200")),
            "rv_30": _round(tech.get("rv_30"), 3),
            "rv_252": _round(tech.get("rv_252"), 3),
            "avg_dollar_volume": _num(tech.get("avg_dollar_volume")),
            "forward_pe": _round(fund.get("forward_pe"), 1),
            "target_mean_price": _round(fund.get("target_mean_price")),
            "next_earnings": fund.get("next_earnings"),
            # The position behind the trade, when there is one.
            "shares_held": _round(pos.get("shares"), 4),
            "contracts_writable": pos.get("contracts_writable") or 0,
            "cost_basis": pos.get("cost_basis"),
            "call": _round_call(call),
            **rating,
        }
        row["verdict"] = build_verdict(row)
        rows.append(row)

    # Priced candidates first: a partial score is computed over a smaller
    # denominator, so it is not comparable to a fully scored one.
    rows.sort(key=lambda r: (0 if r.get("call") else 1, -(r.get("score") or 0)))
    rows = rows[:max_results]

    return {
        "rows": rows,
        "stats": {
            "universe": len(tickers),
            "priced": priced,
            "passed_price": len(price_pass),
            "passed_fundamentals": passed_fundamentals,
            "chains_fetched": sum(1 for v in calls.values() if v),
            "dropped_for_earnings": dropped_for_earnings,
            "positions_known": sum(1 for r in rows if (r.get("contracts_writable") or 0) >= 1),
            "final": len(rows),
        },
        "params": {
            "universe": p["universe"], "lookback_days": lookback,
            "min_market_cap": min_cap, "small_cap_min_market_cap": small_min_cap,
            "min_run_pct": min_run,
            "min_stretch_sigma": min_stretch, "min_rsi": min_rsi,
            "min_pct_of_52w_range": min_range_pct,
            "min_avg_dollar_volume": min_adv,
            "include_stocks": bool(p["include_stocks"]),
            "include_index_etfs": bool(p["include_index_etfs"]),
            "include_sector_etfs": bool(p["include_sector_etfs"]),
            "include_commodity_etfs": bool(p["include_commodity_etfs"]),
            "fund_min_run_pct": fund_min_run,
            "fund_min_stretch_sigma": fund_min_stretch,
            "fund_min_aum": fund_min_aum,
            "exclude_leveraged_funds": bool(p["exclude_leveraged_funds"]),
            "exclude_fresh_highs": bool(p["exclude_fresh_highs"]),
            "exclude_earnings_before_expiry": bool(p["exclude_earnings_before_expiry"]),
            "earnings_buffer_days": earnings_buffer,
            "require_shares_held": bool(p["require_shares_held"]),
            "respect_cost_basis": bool(p["respect_cost_basis"]),
            "basis_mode": basis_mode,
            "target_dte": target_dte, "min_dte": min_dte, "max_dte": max_dte,
            "target_delta": target_delta, "min_otm_pct": min_otm,
            "chain_limit": chain_limit,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def _round_call(call: dict | None) -> dict | None:
    if not call:
        return None
    out = dict(call)
    for k, dec in (
        ("strike", 2), ("bid", 2), ("ask", 2), ("mid", 2), ("iv", 4), ("atm_iv", 4),
        ("delta", 3), ("prob_keep_shares", 1), ("spread_pct", 1), ("premium_yield_pct", 2),
        ("annualized_pct", 1), ("if_called_pct", 2), ("if_called_annualized_pct", 1),
        ("otm_pct", 1), ("shares_value", 0), ("premium_dollars", 0), ("upside_cap", 2),
        ("downside_breakeven", 2), ("called_gain_pct", 1), ("called_gain_dollars", 0),
        ("put_skew", 2), ("call_skew", 2), ("skew", 2),
        ("put_skew_rank", 1), ("call_skew_rank", 1), ("skew_rank", 1),
    ):
        if k in out:
            out[k] = _round(out[k], dec)
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def register_routes(app):

    @app.route("/api/options/call-scan/universes", methods=["GET"])
    def call_scan_universes():
        return jsonify(
            universes=[
                {
                    "id": key,
                    "label": val["label"],
                    "count": len(val["tickers"]) if val["tickers"] else None,
                    "small_cap": key in _SMALL_CAP_CHOICE_IDS,
                }
                for key, val in CALL_UNIVERSE_CHOICES.items()
            ],
            defaults=DEFAULTS,
        )

    @app.route("/api/options/call-scan", methods=["POST"])
    def call_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            payload.setdefault("profile_id", request.args.get("profile_id", type=int))
            payload.setdefault("aggregate_id", request.args.get("aggregate_id", type=int))
            payload.setdefault("basis_mode", request.args.get("basis_mode"))
            return jsonify(run_call_scan(payload))
        except ValueError as e:
            return jsonify(error=str(e)), 400
        except Exception as e:
            return jsonify(error=str(e)), 500
