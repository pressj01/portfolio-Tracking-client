"""Iron condor candidate scanner.

The sixth screen in the options family, and structurally the sum of two of the
others: a bull put spread below the market and a bear call spread above it, same
underlying, same expiration, one net credit. Price finishes between the short
strikes and the whole credit is kept.

That construction makes the screen sound like it should be the other two screens
run together. It is not, and the reason is the entire design problem:

  * The Bull Put Spread Scanner wants a *bullish* underlying — a controlled
    pullback inside an intact uptrend.
  * The Bear Call Spread Scanner wants a *bearish* one — a rally that has been
    refused under overhead supply.

Intersecting those two screens returns the empty set, because nothing is both.
Unioning them returns a directional bet wearing four legs. An iron condor wants
neither: it wants a name that is going *nowhere*, and "nowhere" is not the
average of "up" and "down". It is its own property, it needs its own
measurements, and no other screen in this family measures it.

So the thesis this screen selects for is a two-part statement, and both parts
have to hold:

  1. The underlying is range-bound and likely to stay that way. Trend is the one
     thing that kills a condor — not a crash, not a spike, a *trend*, because a
     trend walks price through one short strike and keeps going.
  2. Implied volatility is expensive relative to what the stock actually
     delivers. This is the entire edge. A directional spread can be right about
     direction and profit on cheap premium; a condor has no direction to be right
     about, so if the premium is not rich there is nothing else paying you.

The four scoring axes follow directly:

  1. Range     - is it actually going nowhere? Measured with a Kaufman
                 efficiency ratio and a Lo-MacKinlay variance ratio rather than
                 with trend indicators read backwards. See `_efficiency_ratio`
                 and `_variance_ratio` for why "not trending up and not trending
                 down" is not the same test as "chopping", and why the second is
                 the one that matters.
  2. Vol       - is the premium rich? IV against realized, and — closer to the
                 practitioner's "only sell condors at high IV rank" rule —
                 today's implied vol against the *distribution* of this name's
                 own realized vol over the past year. See `_iv_percentile_vs_rv`.
  3. Structure - do both breakevens clear the expected move, is the structure
                 actually balanced, and does the credit pay for the risk? The
                 classic condor guideline of collecting roughly a third of the
                 wing width lives here.
  4. Safety    - four legs, four markets to cross, and the events that break a
                 position that is short both tails at once.

Three things here exist on no other screen in the family:

  * **Max loss is `max(put wing, call wing) - credit`, not the sum.** Price can
    only finish on one side, so only one wing can ever be breached. Adding the
    two wings — the intuitive reading of "risk on both sides" — overstates the
    risk by roughly a factor of two and understates return on risk by the same,
    which would rank every candidate wrongly against every other. Brokers margin
    it the correct way; so does `_build_condor`.
  * **Strikes are matched by delta, not by distance.** Equity put skew means the
    put 5% below spot is a materially higher delta than the call 5% above it. A
    distance-symmetric condor is therefore a short-delta position — a bullish
    bet — dressed as a neutral one. See `_delta_balance`.
  * **Execution cost is weighted about twice as heavily as on the two-leg
    screens**, because there are four markets to cross on the way in and four on
    the way out, against a credit that is not twice a vertical's.

Chain caches are shared with put_scanner (puts) and call_scanner (calls), so
running any of the other option screens first warms what this one needs.

Endpoints:
  GET  /api/options/iron-condor-scan/universes
  POST /api/options/iron-condor-scan
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from flask import jsonify, request

from option_probability import profit_probability_schedule
from option_iv_history import record_iv_snapshot
from stock_scores import stock_selection_scores
from call_scanner import (
    _load_call_chain,
    assess_early_assignment,
    expected_dividend_amount,
    next_ex_dividend,
)
from put_scanner import (
    COMMODITY_ETF_SET,
    COMMODITY_ETF_UNIVERSE,
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
    _clean_tickers,
    _earnings_within_target_window,
    _fetch_fundamentals_bulk,
    _fund_kind,
    _fund_size,
    _is_fund,
    _load_history,
    _load_put_chain,
    _num,
    _parse_date,
    _pick_expiration,
    _prepare_option_quote,
    _prepare_put_quote,
    _ramp,
    _round,
    _ticker_frame,
    _wilder_rsi,
    dividend_yield_for_pricing,
    resolve_universe,
    window_stretch,
)
# The trapezoid and the terminal-distribution probability are the bear put
# screen's, and the call-side fair value is the bear call screen's. Imported
# rather than re-derived so the spread screens cannot drift apart on the
# primitives they all depend on.
from bear_put_spread_scanner import _band, prob_below, vertical_fair_value
from bear_call_spread_scanner import call_vertical_fair_value
# The directional, ratio'd and hedged structures. Kept in their own module
# because their payoff maths is quantity-aware and cannot reuse the closed-form
# `max(wing) - credit` shortcut that only holds for the 1x symmetric condor.
from iron_condor_variants import (
    ASYMMETRIC_VARIANTS,
    VARIANTS,
    analyze_structure,
    build_structure,
    early_close_exits,
    resolve_variants,
    variant_choices,
)

CONTRACT_MULTIPLIER = 100.0

# How much further a name may drift when it drifts *with* a directional scan's
# lean. Wide enough that a bullish tilt can find names actually going up, tight
# enough that it is still a condor screen and not a momentum screen.
DIRECTIONAL_DRIFT_ALLOWANCE = 1.8


# ---------------------------------------------------------------------------
# Point budgets
# ---------------------------------------------------------------------------
# Named so the partial-score denominator cannot drift away from what a live
# chain actually contributes. Structure is entirely chain-dependent; Vol and
# Safety are mostly so.
RANGE_MAX = 30.0
VOL_MAX = 25.0
STRUCTURE_MAX = 20.0
SAFETY_MAX = 25.0
VOL_CHAIN_MAX = 22.0        # all of Vol except the realized-vol contraction term
SAFETY_CHAIN_MAX = 19.0     # the part of Safety that needs four quoted legs
PARTIAL_MAX = 100.0 - STRUCTURE_MAX - VOL_CHAIN_MAX - SAFETY_CHAIN_MAX


# ---------------------------------------------------------------------------
# Universes
# ---------------------------------------------------------------------------
# The shared lists, unchanged and deliberately without the small-cap universes
# the covered call, bear put, and bear call screens offer. A condor is short both
# tails simultaneously, so it is exposed to a takeover gap *and* a fraud/guidance
# collapse, and small caps supply both. There is also no premium case for them
# here: a condor needs four liquid strikes, and thin chains turn a theoretical
# credit into an unfillable one.
#
# Broad index funds are the classic iron condor underlying and the reason
# include_index_etfs defaults on: they mean-revert more than single names,
# cannot be taken over, do not report earnings, and carry the deepest chains in
# the market.


def resolve_scan_universe(p: dict) -> list[str]:
    """Union of the enabled groups, same independent-group model as the others."""
    tickers: list[str] = []
    if p.get("include_stocks", True):
        tickers += resolve_universe(
            p.get("universe") or "large_cap", p.get("custom_tickers"),
            profile_id=p.get("profile_id"), aggregate_id=p.get("aggregate_id"),
        )
    if p.get("include_index_etfs"):
        selected_indexes = p.get("index_tickers")
        if isinstance(selected_indexes, str):
            selected_indexes = selected_indexes.replace(";", ",").split(",")
        tickers += _clean_tickers(selected_indexes or INDEX_ETF_UNIVERSE)
    if p.get("include_sector_etfs"):
        tickers += SECTOR_ETF_UNIVERSE
    if p.get("include_commodity_etfs"):
        tickers += COMMODITY_ETF_UNIVERSE
    return _clean_tickers(tickers)


# ---------------------------------------------------------------------------
# Stage 1 - range-bound technicals
# ---------------------------------------------------------------------------

def _efficiency_ratio(close: pd.Series, lookback: int) -> float | None:
    """Kaufman efficiency ratio: net distance travelled over path length.

    The single most important measurement on this screen, and the reason it is
    not enough to check that a name is "not up much and not down much".

    A stock that rises 20% and falls 20% back to where it started has a net move
    of zero. Every net-drift test — window return, stretch sigma, distance from a
    moving average — calls that flat, and every one of them is wrong: a condor
    sold anywhere in that round trip was breached twice. What actually matters is
    not where price ended relative to where it began, but *how much ground it
    covered getting there*.

    That is exactly the ratio: |close[-1] - close[0]| divided by the sum of the
    absolute daily changes. Near 0 means price covered a great deal of distance
    and arrived nowhere — chop, which is what a condor is paid for. Near 1 means
    every day's move pointed the same way — a clean trend, which is the one
    market condition that walks price through a short strike and keeps going.

    Read the number as a fraction, not a percentage: a value around 0.15 is a
    genuinely range-bound name, and anything above about 0.5 is trending hard
    enough that neutrality is the wrong bet regardless of what the net move says.
    """
    seg = close.dropna().iloc[-(lookback + 1):]
    if len(seg) < 6:
        return None
    net = abs(float(seg.iloc[-1]) - float(seg.iloc[0]))
    path = float(seg.diff().abs().sum())
    if path <= 0:
        return None
    return net / path


def _variance_ratio(log_ret: pd.Series, k: int = 5) -> float | None:
    """Lo-MacKinlay variance ratio: does this name mean-revert or extend?

    Variance of overlapping k-day returns against k times the variance of one-day
    returns. Under a random walk the two are equal and the ratio is 1. Below 1
    means multi-day moves are *smaller* than the daily volatility implies — days
    are offsetting each other, which is mean reversion, which is what refills a
    condor's premium. Above 1 means moves compound in the same direction, which
    is momentum, which is how a short strike gets breached.

    This complements the efficiency ratio rather than repeating it. The
    efficiency ratio is a description of the window just observed; the variance
    ratio is a statement about the name's *behaviour* across the whole year, so
    it survives a window that happened to be quiet. A name that scores well on
    both is range-bound and has a habit of being range-bound. Requiring roughly a
    year of history and 20 usable k-day observations keeps it from firing on a
    sample too small to mean anything.
    """
    r = log_ret.dropna()
    if len(r) < max(60, k * 12):
        return None
    var1 = float(r.var(ddof=1))
    if not np.isfinite(var1) or var1 <= 0:
        return None
    rk = r.rolling(k).sum().dropna()
    if len(rk) < 20:
        return None
    vark = float(rk.var(ddof=1))
    if not np.isfinite(vark):
        return None
    return vark / (k * var1)


def _rolling_rv_series(log_ret: pd.Series, window: int = 30) -> pd.Series | None:
    """Annualized rolling realized volatility, used for the IV percentile."""
    r = log_ret.dropna()
    if len(r) < window + 20:
        return None
    rv = r.rolling(window).std() * math.sqrt(TRADING_DAYS)
    rv = rv.dropna()
    return rv if len(rv) >= 20 else None


def _compute_technicals(sub: pd.DataFrame, bench_ret, lookback_days: int) -> dict | None:
    """Per-ticker metrics for a *range-bound* name. None when history is thin.

    Its own function rather than any of the five existing ones, because every one
    of those measures a directional condition — how far a name fell, how far it
    ran, whether a bounce was refused. This screen has to measure the absence of
    all of them, which is a different question and not answerable by reading a
    directional metric near zero (see `_efficiency_ratio` for why).
    """
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
    window_pct = ws["window_pct"]
    # window_stretch signs for a decline. A condor does not care which way the
    # drift points, only how big it is, so this screen takes the magnitude and is
    # the only one in the family that does.
    drift_sigma = abs(ws["stretch_sigma"])
    drift_direction = "down" if ws["stretch_sigma"] > 0 else "up"

    week52_high = _num(close.max())
    week52_low = _num(close.min())
    drawdown_pct = ((price - week52_high) / week52_high * 100.0) if week52_high else None
    above_52w_low_pct = ((price - week52_low) / week52_low * 100.0) if week52_low else None

    pct_of_52w_range = None
    if week52_high and week52_low and week52_high > week52_low:
        pct_of_52w_range = (price - week52_low) / (week52_high - week52_low) * 100.0

    # ── The range itself ────────────────────────────────────────────────────
    efficiency_ratio = _efficiency_ratio(close, max(n, 20))
    variance_ratio = _variance_ratio(log_ret, 5)

    seg = close.iloc[-max(n, 20):]
    range_high = _num(seg.max())
    range_low = _num(seg.min())
    range_mid = ((range_high + range_low) / 2.0) if (range_high and range_low) else None
    range_width_pct = (
        (range_high - range_low) / range_mid * 100.0
        if range_high and range_low and range_mid else None
    )
    # 50 is dead centre of the observed range, which is where a condor wants to
    # be sold: both wings then have the same room before they are tested.
    range_position_pct = (
        (price - range_low) / (range_high - range_low) * 100.0
        if range_high and range_low and range_high > range_low else None
    )

    sma_20_s = close.rolling(20).mean()
    sma_50_s = close.rolling(50).mean()
    sma_20 = _num(sma_20_s.iloc[-1]) if len(close) >= 20 else None
    sma_50 = _num(sma_50_s.iloc[-1]) if len(close) >= 50 else None
    sma_200 = _num(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None

    def _slope_pct(series, span=10):
        if series is None or len(series.dropna()) < span + 1:
            return None
        s = series.dropna()
        now, then = _num(s.iloc[-1]), _num(s.iloc[-1 - span])
        if not now or not then or then == 0:
            return None
        return (now - then) / then * 100.0

    # Both signs matter equally and neither is wanted, so the scored quantity is
    # the magnitude — the flattest averages win. On the bear call screen the same
    # slope is read directionally, because there a falling average is resistance;
    # here a falling average is simply a downtrend, which breaks the put wing.
    sma20_slope_pct = _slope_pct(sma_20_s)
    sma50_slope_pct = _slope_pct(sma_50_s)
    ma_slope_abs = max(
        abs(sma20_slope_pct) if sma20_slope_pct is not None else 0.0,
        abs(sma50_slope_pct) if sma50_slope_pct is not None else 0.0,
    ) if (sma20_slope_pct is not None or sma50_slope_pct is not None) else None

    # Compression: the 20- and 50-day sitting on top of each other is a
    # consolidation, and price near both of them means neither wing starts closer
    # to trouble than the other.
    ma_spread_pct = (
        abs(sma_20 - sma_50) / price * 100.0 if sma_20 and sma_50 and price else None
    )
    dist_from_sma50_pct = ((price - sma_50) / sma_50 * 100.0) if sma_50 else None

    rsi_14 = _wilder_rsi(close)

    high_s = sub["High"] if "High" in sub.columns else close
    low_s = sub["Low"] if "Low" in sub.columns else close
    atr14 = _atr(high_s.dropna(), low_s.dropna(), close)

    rv_10 = _num(log_ret.iloc[-10:].std() * math.sqrt(TRADING_DAYS)) if len(log_ret) >= 10 else None
    rv_30 = _num(log_ret.iloc[-30:].std() * math.sqrt(TRADING_DAYS)) if len(log_ret) >= 30 else None
    rv_60 = _num(log_ret.iloc[-60:].std() * math.sqrt(TRADING_DAYS)) if len(log_ret) >= 60 else None
    rv_252 = _num(log_ret.std() * math.sqrt(TRADING_DAYS))
    # Below 1 means the stock has quietened down recently. Paired with implied
    # vol that has not come down with it, that gap is the condor's edge.
    rv_contraction = (rv_10 / rv_60) if (rv_10 and rv_60 and rv_60 > 0) else None

    rv_history = _rolling_rv_series(log_ret, 30)

    # Both tails are short, so a name pinned at either 52-week extreme is wrong
    # for opposite reasons and both are disqualifying.
    recent_high = _num(close.iloc[-3:].max())
    recent_low = _num(close.iloc[-3:].min())
    fresh_high = bool(week52_high and recent_high and recent_high >= week52_high * 0.995)
    fresh_low = bool(week52_low and recent_low and recent_low <= week52_low * 1.005)

    # Leadership in *either* direction is a trend by another name, so this screen
    # scores the magnitude where the directional screens score the sign.
    beta = None
    rel_strength_pct = None
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
                rel_strength_pct = window_pct - beta * bench_window

    vol_s = sub["Volume"].dropna() if "Volume" in sub.columns else None
    avg_volume = _num(vol_s.iloc[-30:].mean()) if vol_s is not None and len(vol_s) else None
    avg_dollar_volume = (avg_volume * price) if avg_volume else None

    return {
        "price": price,
        "window_pct": window_pct,
        "expected_move_pct": ws["expected_move_pct"],
        "sigma_daily": sigma_d,
        "drift_sigma": drift_sigma,
        "drift_direction": drift_direction,
        "efficiency_ratio": efficiency_ratio,
        "variance_ratio": variance_ratio,
        "range_high": range_high,
        "range_low": range_low,
        "range_width_pct": range_width_pct,
        "range_position_pct": range_position_pct,
        "drawdown_pct": drawdown_pct,
        "week52_high": week52_high,
        "week52_low": week52_low,
        "above_52w_low_pct": above_52w_low_pct,
        "pct_of_52w_range": pct_of_52w_range,
        "beta": beta,
        "rel_strength_pct": rel_strength_pct,
        "rsi_14": rsi_14,
        "sma_20": sma_20,
        "sma_50": sma_50,
        "sma_200": sma_200,
        "sma20_slope_pct": sma20_slope_pct,
        "sma50_slope_pct": sma50_slope_pct,
        "ma_slope_abs": ma_slope_abs,
        "ma_spread_pct": ma_spread_pct,
        "dist_from_sma50_pct": dist_from_sma50_pct,
        "atr_14": atr14,
        "rv_10": rv_10,
        "rv_30": rv_30,
        "rv_60": rv_60,
        "rv_252": rv_252,
        "rv_contraction": rv_contraction,
        "rv_history": rv_history,
        "fresh_high": fresh_high,
        "fresh_low": fresh_low,
        "avg_volume": avg_volume,
        "avg_dollar_volume": avg_dollar_volume,
    }


def _iv_percentile_vs_rv(atm_iv: float | None, rv_history: pd.Series | None) -> float | None:
    """Where today's implied vol sits inside this name's own past-year realized vol.

    The practitioner's rule for condors is "only sell them when IV rank is high",
    and IV rank needs a year of stored implied vol history that this application
    does not keep. Rather than quietly substitute a bare IV/RV snapshot and call
    it rank, this measures something adjacent and honestly computable: the share
    of the past year's rolling 30-day realized vol readings that sit *below*
    today's at-the-money implied vol.

    It answers the question the rule is actually asking — "is the option market
    charging more than this stock has typically delivered?" — and it is strictly
    more informative than the IV/RV point estimate scored alongside it, because
    it accounts for the whole distribution rather than one day's realized
    reading. A name whose realized vol swings between 15% and 60% and is
    currently at 20% produces an IV/RV near 1.3 at an implied 26%, which looks
    rich; against the distribution it is unremarkable, and this term says so.

    Returns 0-100, or None when there is not enough history to be worth quoting.
    """
    iv = _num(atm_iv)
    if not iv or iv <= 0 or rv_history is None or len(rv_history) < 20:
        return None
    values = rv_history.dropna().values
    if len(values) < 20:
        return None
    return float((values < iv).mean() * 100.0)


# ---------------------------------------------------------------------------
# Stage 3 - the condor itself
# ---------------------------------------------------------------------------

def _quotable(leg: dict) -> bool:
    """A live, uncrossed two-sided market — required on all four legs.

    The single-leg screens can accept a live bid alone. A condor has to sell two
    legs at the bid and buy two at the ask, so one bad quote anywhere makes the
    whole net credit fictional.
    """
    bid, ask, mid = _num(leg.get("bid")), _num(leg.get("ask")), _num(leg.get("mid"))
    return bool(bid and ask and mid and bid > 0 and ask >= bid and mid > 0)


def _delta_pool(legs: list[dict], target: float, tolerance: float) -> list[dict]:
    """Legs whose |delta| is within `tolerance` of `target`, widening if empty."""
    with_delta = [leg for leg in legs if leg.get("delta") is not None]
    if not with_delta:
        return []
    for tol in (tolerance, tolerance * 1.6, tolerance * 2.5):
        pool = [leg for leg in with_delta if abs(abs(leg["delta"]) - target) <= tol]
        if pool:
            return pool
    return [min(with_delta, key=lambda leg: abs(abs(leg["delta"]) - target))]


def _delta_gap(put_short: dict, call_short: dict) -> float | None:
    """How evenly the two short strikes split the risk: the gap in absolute delta.

    The measurement that stops a condor from being a directional bet in disguise,
    and the reason this screen matches strikes by delta rather than by distance
    from spot.

    Equity options carry put skew: the put 5% below spot trades at a higher
    implied vol, and therefore a materially higher delta, than the call 5% above
    it. Placing the two short strikes equidistant from the money — the intuitive
    reading of "symmetric" — therefore sells a high-delta put against a low-delta
    call, which is a net short-delta position. That is a bullish bet, sized by
    accident, inside a structure the trader believes is neutral. It also
    concentrates the credit on the put side, so the position collects most of its
    premium from the wing carrying most of its risk.

    Near zero is a genuinely balanced condor. The companion number is
    `_structure_delta`, which says which way the whole position leans.
    """
    ps, cs = _num(put_short.get("delta")), _num(call_short.get("delta"))
    if ps is None or cs is None:
        return None
    return abs(abs(ps) - abs(cs))


def _structure_delta(put_short: dict, put_long: dict,
                     call_short: dict, call_long: dict) -> float | None:
    """Net delta of the four-leg position: short put +, long put -, short call -, long call +.

    Zero is perfectly neutral. A materially non-zero reading means the structure
    leans, and the sign says which way: positive is bullish, negative bearish.
    """
    legs = (put_short, put_long, call_short, call_long)
    if any(_num(leg.get("delta")) is None for leg in legs):
        return None
    return (
        -_num(put_short["delta"])
        + _num(put_long["delta"])
        - _num(call_short["delta"])
        + _num(call_long["delta"])
    )


def _leg_view(leg: dict) -> dict:
    return {
        "strike": leg["strike"], "bid": leg["bid"], "ask": leg["ask"],
        "mid": leg["mid"], "iv": leg["iv"], "delta": leg["delta"],
        "open_interest": leg["open_interest"], "volume": leg["volume"],
        "quote_source": leg.get("quote_source", "live_bid_ask"),
    }


def _build_condor(put_short: dict, put_long: dict, call_short: dict, call_long: dict,
                  spot: float, dte: int, forecast_vol: float | None,
                  div_yield: float,
                  distribution_iv: float | None = None) -> dict | None:
    """All the numbers for one four-strike condor, or None if the strikes are unusable."""
    ps = _num(put_short.get("strike"))
    pl = _num(put_long.get("strike"))
    cs = _num(call_short.get("strike"))
    cl = _num(call_long.get("strike"))
    if not (ps and pl and cs and cl):
        return None
    # Strikes must ascend: long put < short put < spot < short call < long call.
    if not (pl < ps < cs < cl):
        return None

    put_width = ps - pl
    call_width = cl - cs
    put_credit = (_num(put_short.get("mid"), 0.0) or 0.0) - (_num(put_long.get("mid"), 0.0) or 0.0)
    call_credit = (_num(call_short.get("mid"), 0.0) or 0.0) - (_num(call_long.get("mid"), 0.0) or 0.0)
    net_credit = put_credit + call_credit
    # Each vertical must stand on its own. A side priced at or below zero is bad
    # chain data, not a free wing, and letting one side subsidise the other would
    # produce a condor whose put spread is a guaranteed loss.
    if put_credit <= 0 or call_credit <= 0:
        return None
    if net_credit <= 0:
        return None

    # Only one wing can ever be breached, because price finishes on exactly one
    # side of the range. The risked capital is therefore the *wider* wing minus
    # the whole credit, not the sum of the two wings. This is how the position is
    # margined and it is the single easiest thing to get wrong here: summing the
    # wings would roughly double the stated risk and halve the stated return on
    # it, mis-ranking every candidate against every other.
    max_wing = max(put_width, call_width)
    if net_credit >= max_wing:
        return None
    max_loss = max_wing - net_credit

    lower_breakeven = ps - net_credit
    upper_breakeven = cs + net_credit
    if lower_breakeven <= 0:
        return None

    dte_eff = max(int(dte or 1), 1)
    T = dte_eff / 365.0

    # A single four-leg limit near the mid is the displayed entry. The natural
    # credit is what is left after crossing all four markets, and on a condor
    # that gap is wide enough to decide whether the trade is worth doing.
    legs = (put_short, put_long, call_short, call_long)
    all_live = all(
        leg.get("quote_source", "live_bid_ask") == "live_bid_ask"
        and _quotable(leg)
        for leg in legs
    )
    natural_credit = (
        (_num(put_short.get("bid"), 0.0) or 0.0)
        - (_num(put_long.get("ask"), 0.0) or 0.0)
        + (_num(call_short.get("bid"), 0.0) or 0.0)
        - (_num(call_long.get("ask"), 0.0) or 0.0)
        if all_live else None
    )
    exec_cost = (
        sum(
            (_num(leg.get("ask"), 0.0) or 0.0)
            - (_num(leg.get("bid"), 0.0) or 0.0)
            for leg in legs
        )
        if all_live else None
    )
    exec_cost_pct = (
        exec_cost / net_credit * 100.0
        if exec_cost is not None and net_credit > 0 else None
    )

    credit_pct_of_width = net_credit / max_wing * 100.0
    return_on_risk = (net_credit / max_loss * 100.0) if max_loss > 0 else None
    annualized_ror = (return_on_risk * 365.0 / dte_eff) if return_on_risk is not None else None

    put_otm_pct = (spot - ps) / spot * 100.0 if spot else None
    call_otm_pct = (cs - spot) / spot * 100.0 if spot else None
    lower_cushion_pct = (spot - lower_breakeven) / spot * 100.0 if spot else None
    upper_cushion_pct = (upper_breakeven - spot) / spot * 100.0 if spot else None

    # Both cushions in the name's own expected move over the life of the trade.
    # The *smaller* of the two is what the position actually has, because a
    # condor is only as safe as its nearer breakeven — a raw percentage on each
    # side hides that a generous call wing does nothing for a tight put wing.
    sigma_T = (
        forecast_vol * math.sqrt(T)
        if (forecast_vol and forecast_vol > 0 and T > 0) else None
    )
    lower_sigma = upper_sigma = min_cushion_sigma = None
    if sigma_T and sigma_T > 0 and spot > 0:
        if lower_breakeven > 0:
            lower_sigma = abs(math.log(lower_breakeven / spot) / sigma_T)
        if upper_breakeven > 0:
            upper_sigma = abs(math.log(upper_breakeven / spot) / sigma_T)
        if lower_sigma is not None and upper_sigma is not None:
            min_cushion_sigma = min(lower_sigma, upper_sigma)

    # Probabilities from the chain's own implied vol. A condor's two outcomes
    # need two different numbers, and both come off where price lands, so both
    # use N(-d2) rather than a delta proxy.
    # Use the same at-the-money volatility that drives the full-position
    # probability schedule.  Previously this row used the larger short-leg IV
    # while the expiration card used ATM IV, so the two "probability of profit"
    # figures disagreed for the exact same trade (especially under put skew).
    pricing_iv = _num(distribution_iv, 0.0) or 0.0
    if pricing_iv <= 0:
        for leg in (put_short, call_short):
            iv = _num(leg.get("iv"), 0.0) or 0.0
            if iv > 0:
                pricing_iv = max(pricing_iv, iv)
    below_call_short = prob_below(spot, cs, T, pricing_iv, RISK_FREE, div_yield)
    below_put_short = prob_below(spot, ps, T, pricing_iv, RISK_FREE, div_yield)
    below_upper_be = prob_below(spot, upper_breakeven, T, pricing_iv, RISK_FREE, div_yield)
    below_lower_be = prob_below(spot, lower_breakeven, T, pricing_iv, RISK_FREE, div_yield)
    below_put_long = prob_below(spot, pl, T, pricing_iv, RISK_FREE, div_yield)
    below_call_long = prob_below(spot, cl, T, pricing_iv, RISK_FREE, div_yield)
    # Max profit needs price between the short strikes; any profit at all needs
    # it between the breakevens, which is the wider and more useful window.
    prob_max_profit = (
        (below_call_short - below_put_short) * 100.0
        if below_call_short is not None and below_put_short is not None else None
    )
    prob_profit = (
        (below_upper_be - below_lower_be) * 100.0
        if below_upper_be is not None and below_lower_be is not None else None
    )
    prob_max_loss = (
        (below_put_long + (1.0 - below_call_long)) * 100.0
        if below_put_long is not None and below_call_long is not None else None
    )
    prob_touch_put = (below_put_short * 100.0) if below_put_short is not None else None
    prob_touch_call = (
        (1.0 - below_call_short) * 100.0 if below_call_short is not None else None
    )

    # Fair credit from the stock's own realized vol: the two verticals priced
    # driftless at zero carry, which makes the total an undiscounted expectation
    # rather than a market quote. Using implied vol would be circular, since the
    # collected credit is derived from implied vol and would always come out fair.
    put_fair = vertical_fair_value(spot, ps, pl, T, forecast_vol)
    call_fair = call_vertical_fair_value(spot, cs, cl, T, forecast_vol)
    fair_credit = (
        put_fair + call_fair if put_fair is not None and call_fair is not None else None
    )
    premium_edge = (net_credit - fair_credit) if fair_credit is not None else None
    premium_edge_pct = (
        premium_edge / fair_credit * 100.0
        if premium_edge is not None and fair_credit and fair_credit > 0 else None
    )

    delta_gap = _delta_gap(put_short, call_short)
    structure_delta = _structure_delta(put_short, put_long, call_short, call_long)

    # A condor is only as liquid as its worst leg, since all four have to be
    # filled to open and all four to close.
    oi_min = min(int(_num(leg.get("open_interest"), 0) or 0)
                 for leg in (put_short, put_long, call_short, call_long))
    volume_min = min(int(_num(leg.get("volume"), 0) or 0)
                     for leg in (put_short, put_long, call_short, call_long))

    # Unequal wings mean the risk depends on which side is breached, which is a
    # different position than the one most traders think they are opening.
    wing_skew_pct = (
        abs(put_width - call_width) / max_wing * 100.0 if max_wing > 0 else None
    )
    # How lopsided the premium is. Put skew normally puts this above 50%; far
    # above it means the call wing is being sold for almost nothing and the
    # structure is really a bull put spread with a decorative top.
    put_share_of_credit_pct = (
        put_credit / net_credit * 100.0 if net_credit > 0 else None
    )

    return {
        "put_long_strike": pl,
        "put_short_strike": ps,
        "call_short_strike": cs,
        "call_long_strike": cl,
        "put_width": put_width,
        "call_width": call_width,
        "max_wing": max_wing,
        "wing_skew_pct": wing_skew_pct,
        "put_credit": put_credit,
        "call_credit": call_credit,
        "put_share_of_credit_pct": put_share_of_credit_pct,
        "credit": net_credit,
        "entry_cashflow": net_credit,
        "entry_credit": net_credit,
        "entry_debit": 0.0,
        "is_net_debit": False,
        "natural_credit": natural_credit,
        "natural_cashflow": natural_credit,
        "quote_source": "live_bid_ask" if all_live else "last_trade_estimate",
        "uses_last_trade_prices": not all_live,
        "credit_pct_of_width": credit_pct_of_width,
        "max_profit_pct_of_range": credit_pct_of_width,
        "max_profit": net_credit,
        "max_loss": max_loss,
        "reward_risk": (net_credit / max_loss) if max_loss > 0 else None,
        "return_on_risk_pct": return_on_risk,
        "annualized_return_on_risk_pct": annualized_ror,
        "lower_breakeven": lower_breakeven,
        "upper_breakeven": upper_breakeven,
        "profit_zone_width_pct": (
            (upper_breakeven - lower_breakeven) / spot * 100.0 if spot else None
        ),
        "put_otm_pct": put_otm_pct,
        "call_otm_pct": call_otm_pct,
        "lower_cushion_pct": lower_cushion_pct,
        "upper_cushion_pct": upper_cushion_pct,
        "lower_cushion_sigma": lower_sigma,
        "upper_cushion_sigma": upper_sigma,
        "min_cushion_sigma": min_cushion_sigma,
        "expected_move_pct_life": (sigma_T * 100.0) if sigma_T else None,
        "prob_max_profit": prob_max_profit,
        "prob_profit": prob_profit,
        "prob_max_loss": prob_max_loss,
        "prob_touch_put": prob_touch_put,
        "prob_touch_call": prob_touch_call,
        "fair_credit": fair_credit,
        "premium_edge": premium_edge,
        "premium_edge_pct": premium_edge_pct,
        "expected_value_dollars": (
            premium_edge * CONTRACT_MULTIPLIER if premium_edge is not None else None
        ),
        "delta_gap": delta_gap,
        "structure_delta": structure_delta,
        "exec_cost": exec_cost,
        "exec_cost_pct": exec_cost_pct,
        "open_interest_min": oi_min,
        "volume_min": volume_min,
        # Per-contract dollars, which is how the trade is actually sized.
        "credit_dollars": net_credit * CONTRACT_MULTIPLIER,
        "entry_cashflow_dollars": net_credit * CONTRACT_MULTIPLIER,
        "entry_credit_dollars": net_credit * CONTRACT_MULTIPLIER,
        "entry_debit_dollars": 0.0,
        "max_profit_dollars": net_credit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": max_loss * CONTRACT_MULTIPLIER,
        "put_leg_short": _leg_view(put_short),
        "put_leg_long": _leg_view(put_long),
        "call_leg_short": _leg_view(call_short),
        "call_leg_long": _leg_view(call_long),
    }


def _wing_quality(pair: dict) -> float:
    """Cheap ranking for one side's verticals, used only to shortlist before pairing.

    Four legs is a large cross product, so each side is reduced to a handful of
    plausible verticals before they are combined. This is deliberately crude —
    the real arbitration happens in `_condor_quality`, which can see both wings
    at once and therefore the things that only exist for the whole structure.
    """
    q = _ramp(pair.get("credit_pct_of_width"), 8, 35, 10)
    q += _ramp(pair.get("open_interest_min"), 50, 500, 6)
    cost = _num(pair.get("exec_cost_pct"))
    q += _ramp(-(cost if cost is not None else 100.0), -60, -10, 6)
    return q


def _condor_quality(condor: dict) -> float:
    """Rank complete condors on one underlying.

    Simpler than `score_candidate`: every structure here shares the same
    technicals, so this only arbitrates the trade-off between a wide profit zone
    that collects little and a narrow one that collects more. Balance is worth
    real points rather than a tiebreak, because an unbalanced condor is a
    directional trade and this screen has no directional opinion to express.
    """
    q = _ramp(condor.get("prob_max_profit"), 40, 75, 20)
    q += _ramp(condor.get("annualized_return_on_risk_pct"), 15, 70, 18)
    q += _ramp(condor.get("min_cushion_sigma"), 0.8, 1.8, 16)
    q += _ramp(condor.get("premium_edge_pct"), 0, 35, 14)
    cost = _num(condor.get("exec_cost_pct"))
    q += _ramp(-(cost if cost is not None else 100.0), -50, -12, 12)
    q += _ramp(condor.get("open_interest_min"), 50, 500, 8)
    gap = _num(condor.get("delta_gap"))
    q += _ramp(-(gap if gap is not None else 1.0), -0.12, -0.02, 8)
    skew = _num(condor.get("wing_skew_pct"))
    q += _ramp(-(skew if skew is not None else 100.0), -40, 0, 4)
    target_error = _num(condor.get("target_delta_error"))
    q += _ramp(-(target_error if target_error is not None else 1.0), -0.24, 0, 12)
    return q


def _side_pairs(legs: list[dict], short_pool: list[dict], long_pool: list[dict],
                is_put_side: bool, lo_width: float, hi_width: float,
                min_open_interest: int, keep: int,
                short_target: float | None = None,
                long_target: float | None = None) -> tuple[list[dict], bool]:
    """Shortlist verticals for one wing. Returns (pairs, met_every_constraint).

    Delta pools express a preference rather than availability: on sparse chains
    the target short and long pools often collapse onto the same strike even
    though the adjacent strikes form a perfectly good vertical. So every ordered
    pair is enumerated, the width window and liquidity floor are applied, and the
    target-delta pairs are preferred only when choosing among survivors.
    """
    preferred = {
        (s["strike"], l["strike"])
        for s in short_pool for l in long_pool
        if (l["strike"] < s["strike"] if is_put_side else l["strike"] > s["strike"])
    }

    passing: list[dict] = []
    fallback: list[dict] = []
    for short_leg in legs:
        for long_leg in legs:
            if is_put_side:
                if long_leg["strike"] >= short_leg["strike"]:
                    continue
                width = short_leg["strike"] - long_leg["strike"]
            else:
                if long_leg["strike"] <= short_leg["strike"]:
                    continue
                width = long_leg["strike"] - short_leg["strike"]
            credit = (_num(short_leg.get("mid"), 0.0) or 0.0) - (_num(long_leg.get("mid"), 0.0) or 0.0)
            if credit <= 0 or credit >= width:
                continue
            oi = min(
                int(_num(short_leg.get("open_interest"), 0) or 0),
                int(_num(long_leg.get("open_interest"), 0) or 0),
            )
            all_live = _quotable(short_leg) and _quotable(long_leg)
            cost = (
                sum(
                    (_num(leg.get("ask"), 0.0) or 0.0)
                    - (_num(leg.get("bid"), 0.0) or 0.0)
                    for leg in (short_leg, long_leg)
                )
                if all_live else None
            )
            entry = {
                "short": short_leg, "long": long_leg, "width": width,
                "credit": credit, "credit_pct_of_width": credit / width * 100.0,
                "open_interest_min": oi,
                "exec_cost_pct": (
                    cost / credit * 100.0
                    if cost is not None and credit > 0 else None
                ),
                "preferred": (short_leg["strike"], long_leg["strike"]) in preferred,
                "delta_error": (
                    abs(abs(_num(short_leg.get("delta"), 0.0) or 0.0) - short_target)
                    + abs(abs(_num(long_leg.get("delta"), 0.0) or 0.0) - long_target)
                    if short_target is not None and long_target is not None
                    else math.inf
                ),
            }
            if lo_width <= width <= hi_width and oi >= min_open_interest:
                passing.append(entry)
            else:
                fallback.append(entry)

    pool, met = (passing, True) if passing else (fallback, False)
    if not pool:
        return [], False
    # Prefer target-delta structures, then quality, and keep only a handful so
    # the cross product with the other wing stays small.
    pool.sort(key=lambda e: (
        not e["preferred"],
        e["delta_error"],
        -_wing_quality(e),
    ))
    return pool[:keep], met


def _suggest_iron_condors(
    ticker: str,
    spot: float,
    div_yield: float,
    forecast_vol: float | None,
    target_dte: int,
    min_dte: int,
    max_dte: int,
    short_delta: float = 0.16,
    long_delta: float = 0.07,
    delta_tolerance: float = 0.10,
    min_width_pct: float = 1.0,
    max_width_pct: float = 12.0,
    min_credit_pct_of_width: float = 15.0,
    min_cushion_sigma: float = 1.0,
    min_otm_pct: float = 2.0,
    max_wing_skew_pct: float = 25.0,
    max_delta_gap: float = 0.08,
    min_open_interest: int = 50,
    max_exec_cost_pct: float = 45.0,
    earnings_date: str | None = None,
    earnings_buffer_days: int = 5,
    fund: dict | None = None,
    max_structures: int = 5,
) -> list[dict]:
    """Ranked iron-condor choices on one underlying from the live chains.

    Both chains are needed for the same expiration, which is why this is the only
    screen in the family that pulls two. Rather than mechanically taking "the
    16-delta short and the 7-delta long on each side", each wing is shortlisted
    independently and then the shortlists are combined, because the structural
    trade-offs that matter — balance, whether both breakevens clear the expected
    move, whether the two wings are the same width — only become visible once
    both sides exist.

    The default 16-delta short strike is roughly the one-standard-deviation
    strike, which is where the classic condor is sold: far enough out that the
    expected move does not reach it, near enough that the credit is worth
    collecting.
    """
    try:
        expirations = list(yf.Ticker(ticker).options or [])
    except Exception:
        return []

    earnings_d = _parse_date(earnings_date)
    cutoff = (
        earnings_d - timedelta(days=max(0, earnings_buffer_days))
        if earnings_d else None
    )
    expiration, dte, cleared = _pick_expiration(
        expirations, target_dte, min_dte, max_dte, expire_before=cutoff,
    )
    if not expiration:
        return []

    puts = _load_put_chain(ticker, expiration, spot, div_yield)
    calls = _load_call_chain(ticker, expiration, spot, div_yield)
    if not puts or not calls:
        return []

    total_option_volume = sum(
        max(0, int(_num(leg.get("volume"), 0) or 0))
        for leg in [*puts, *calls]
    )

    dte_eff = max(dte or 1, 1)

    # The user's OTM floor is a structure constraint, not a chain-availability
    # test, so it is applied when filtering pairs rather than here — a chain that
    # only offers a 1.5%-OTM short against a 2% floor should surface as a relaxed
    # watchlist candidate, not as "no condor exists".
    prepared_puts = [
        quote for quote in (
            _prepare_put_quote(
                leg,
                spot=spot,
                dte=dte_eff,
                dividend_yield=div_yield,
            )
            for leg in puts
            if leg["strike"] < spot
        )
        if quote is not None
    ]
    prepared_calls = [
        quote for quote in (
            _prepare_option_quote(
                leg,
                option_type="call",
                spot=spot,
                dte=dte_eff,
                dividend_yield=div_yield,
            )
            for leg in calls
            if leg["strike"] > spot
        )
        if quote is not None
    ]
    live_puts = [leg for leg in prepared_puts if _quotable(leg)]
    live_calls = [leg for leg in prepared_calls if _quotable(leg)]
    put_legs = sorted(
        live_puts if len(live_puts) >= 2 else prepared_puts,
        key=lambda leg: leg["strike"],
    )
    call_legs = sorted(
        live_calls if len(live_calls) >= 2 else prepared_calls,
        key=lambda leg: leg["strike"],
    )
    if len(put_legs) < 2 or len(call_legs) < 2:
        return []

    # Establish the distribution volatility before structures are built so the
    # row-level probability and the expiration probability card are calculated
    # from the same distribution.  Leg IVs are still retained for marking each
    # option at early-close dates.
    atm_put = min(prepared_puts, key=lambda leg: abs(leg["strike"] - spot))
    atm_call = min(prepared_calls, key=lambda leg: abs(leg["strike"] - spot))
    atm_ivs = [leg["iv"] for leg in (atm_put, atm_call) if leg["iv"] and leg["iv"] > 0]
    atm_iv = (sum(atm_ivs) / len(atm_ivs)) if atm_ivs else 0.0

    lo_width = spot * max(0.0, min_width_pct) / 100.0
    hi_width = spot * max(min_width_pct, max_width_pct) / 100.0

    put_pairs, put_ok = _side_pairs(
        put_legs,
        _delta_pool(put_legs, short_delta, delta_tolerance),
        _delta_pool(put_legs, long_delta, delta_tolerance),
        True, lo_width, hi_width, min_open_interest, keep=6,
        short_target=short_delta, long_target=long_delta,
    )
    call_pairs, call_ok = _side_pairs(
        call_legs,
        _delta_pool(call_legs, short_delta, delta_tolerance),
        _delta_pool(call_legs, long_delta, delta_tolerance),
        False, lo_width, hi_width, min_open_interest, keep=6,
        short_target=short_delta, long_target=long_delta,
    )
    if not put_pairs or not call_pairs:
        return []

    all_condors: list[dict] = []
    passing: list[dict] = []
    for put_pair in put_pairs:
        for call_pair in call_pairs:
            condor = _build_condor(
                put_pair["short"], put_pair["long"],
                call_pair["short"], call_pair["long"],
                spot, dte_eff, forecast_vol, div_yield,
                distribution_iv=atm_iv,
            )
            if condor is None:
                continue
            condor["target_delta_error"] = (
                put_pair["delta_error"] + call_pair["delta_error"]
            )
            all_condors.append(condor)
            estimated = condor["uses_last_trade_prices"]
            if estimated:
                continue

            if not (put_ok and call_ok):
                continue
            if condor["credit_pct_of_width"] < min_credit_pct_of_width:
                continue
            if not estimated and condor["natural_credit"] <= 0:
                continue
            if (
                condor["put_otm_pct"] is not None
                and condor["put_otm_pct"] < min_otm_pct
            ):
                continue
            if (
                condor["call_otm_pct"] is not None
                and condor["call_otm_pct"] < min_otm_pct
            ):
                continue
            # The nearer breakeven is the one that matters, so this gate reads
            # the minimum of the two rather than an average that a generous wing
            # could carry.
            if (
                condor["min_cushion_sigma"] is not None
                and condor["min_cushion_sigma"] < min_cushion_sigma
            ):
                continue
            if (
                condor["wing_skew_pct"] is not None
                and condor["wing_skew_pct"] > max_wing_skew_pct
            ):
                continue
            if (
                condor["delta_gap"] is not None
                and condor["delta_gap"] > max_delta_gap
            ):
                continue
            if condor["open_interest_min"] < min_open_interest:
                continue
            if not estimated and (
                condor["exec_cost_pct"] is None
                or condor["exec_cost_pct"] > max_exec_cost_pct
            ):
                continue
            passing.append(condor)

    # Falling back rather than returning nothing mirrors the other spread
    # screens: show the structure and say which constraint could not be met,
    # instead of hiding the candidate entirely.
    pool = passing or all_condors
    if not pool:
        return []
    ranked = sorted(pool, key=_condor_quality, reverse=True)

    # At-the-money IV off the whole chain rather than the chosen strikes, so skew
    # does not contaminate the vol-level reading. Averaged across the put and
    # call sides because a condor sells both, and put skew alone would overstate
    # what the structure is really being paid.
    expiry_d = datetime.strptime(expiration, "%Y-%m-%d").date()

    # The short call's dividend risk, the same term the bear call screen carries.
    # Early exercise leaves a short stock position nobody intended, and in a
    # condor it arrives alongside three other open legs.
    ex_div_iso, ex_div_estimated = next_ex_dividend(fund or {})
    ex_div_d = _parse_date(ex_div_iso)
    ex_div_inside = bool(ex_div_d and ex_div_d <= expiry_d)
    dividend = expected_dividend_amount(fund or {}, spot)
    out: list[dict] = []
    passing_ids = {id(structure) for structure in passing}
    for structure in ranked[:max(1, min(12, int(max_structures or 5)))]:
        early = assess_early_assignment(
            structure["call_leg_short"]["mid"], spot,
            structure["call_short_strike"], dividend, ex_div_inside,
        )
        out.append({
            **structure,
            "expiration": expiration,
            "dte": dte,
            "atm_iv": atm_iv,
            "total_option_volume": total_option_volume,
            "constraints_relaxed": id(structure) not in passing_ids,
            "structures_considered": len(all_condors),
            "earnings_date": earnings_d.isoformat() if earnings_d else None,
            "avoids_earnings": cleared if earnings_d else None,
            "days_earnings_after_expiry": ((earnings_d - expiry_d).days if earnings_d else None),
            "ex_dividend_date": ex_div_iso,
            "ex_dividend_estimated": ex_div_estimated,
            "ex_dividend_inside": ex_div_inside,
            "dividend_amount": _round(dividend),
            "early_assignment": early,
        })
    return out


def _suggest_iron_condor(*args, **kwargs) -> dict | None:
    """Backward-compatible single-best wrapper used by tests and callers."""
    choices = _suggest_iron_condors(*args, **kwargs, max_structures=1)
    return choices[0] if choices else None


# ---------------------------------------------------------------------------
# Variant structures
# ---------------------------------------------------------------------------

def _profitable_probability(legs: list[dict], cashflow: float, breakevens: list[float],
                            spot: float, T: float, iv: float, div_yield: float) -> float | None:
    """Odds of finishing in profit, summed over every profitable price interval.

    The balanced condor has exactly one profit zone, so its odds are a single
    subtraction. These structures do not: a hedged Weirdor's butterfly moat puts
    a profit spike outside the main tent — the "Batman ears" shape — and a Jeep
    has a raised shelf that is a different height from its base. Reading such a
    payoff as "between the two outer breakevens" would count the losing gap in
    the middle as profit.

    So the intervals are walked one at a time, the sign of the payoff is read
    inside each, and only the profitable ones contribute.
    """
    if not breakevens or not spot or spot <= 0 or T <= 0 or not iv or iv <= 0:
        return None
    from iron_condor_variants import payoff_at

    bounds = [0.0] + sorted(breakevens) + [float("inf")]
    total = 0.0
    for lo, hi in zip(bounds, bounds[1:]):
        probe = (lo + hi) / 2.0 if hi != float("inf") else lo + max(1.0, spot * 0.25)
        if payoff_at(legs, cashflow, probe) <= 0:
            continue
        below_hi = 1.0 if hi == float("inf") else prob_below(spot, hi, T, iv, RISK_FREE, div_yield)
        below_lo = 0.0 if lo <= 0 else prob_below(spot, lo, T, iv, RISK_FREE, div_yield)
        if below_hi is None or below_lo is None:
            continue
        total += max(0.0, below_hi - below_lo)
    return min(100.0, total * 100.0)


def _structure_metrics(built: dict, analysis: dict, spot: float, dte: int,
                       div_yield: float, forecast_vol: float | None,
                       expiration: str, atm_iv: float,
                       total_option_volume: int = 0) -> dict:
    """Turn a built variant plus its payoff analysis into a scoreable structure."""
    legs = built["legs"]
    entry_cashflow = analysis["entry_cashflow"]
    max_profit = analysis["max_profit"]
    max_loss = analysis["max_loss"]
    dte_eff = max(int(dte or 1), 1)
    T = dte_eff / 365.0

    # Quote provenance is part of the live test. A recent-trade estimate may
    # still carry stale bid/ask fields from the chain payload, but it must not
    # produce a natural fill or an execution-cost claim.
    all_live = all(
        leg.get("quote_source", "live_bid_ask") == "live_bid_ask"
        and _quotable(leg)
        for leg in legs
    )
    exec_cost = (
        sum(
            abs(int(leg["qty"]))
            * ((_num(leg.get("ask"), 0.0) or 0.0) - (_num(leg.get("bid"), 0.0) or 0.0))
            for leg in legs
        )
        if all_live else None
    )
    natural = None
    if all_live:
        natural = 0.0
        for leg in legs:
            qty = int(leg["qty"])
            # Cross the market the wrong way on every leg: buy the ask, sell the bid.
            price = _num(leg.get("ask"), 0.0) if qty > 0 else _num(leg.get("bid"), 0.0)
            natural -= qty * (price or 0.0)

    # Match the underlying-price distribution used by the probability card.
    # Individual leg IVs still mark the options at early-close dates.
    pricing_iv = _num(atm_iv, 0.0) or 0.0
    if pricing_iv <= 0:
        pricing_iv = max([_num(leg.get("iv"), 0.0) or 0.0 for leg in legs] + [0.0])
    prob_profit = _profitable_probability(
        legs, entry_cashflow, analysis["breakevens"], spot, T, pricing_iv, div_yield,
    )

    return_on_risk = (max_profit / max_loss * 100.0) if max_loss > 0 else None
    lower_be = analysis["lower_breakeven"]
    upper_be = analysis["upper_breakeven"]

    # Entry credit and payoff efficiency are separate for variants. A Jeep or a
    # hedged structure may intentionally pay a debit, so only a positive entry
    # cashflow gets a credit ratio; max-profit share is reported separately.
    span = max_profit + max_loss
    credit_pct_of_width = (
        entry_cashflow / span * 100.0
        if span > 0 and entry_cashflow > 0 else None
    )
    max_profit_pct_of_range = (max_profit / span * 100.0) if span > 0 else None

    # Where the payoff actually sits at its maximum. On a flat-topped structure
    # this is a real zone; on the hedged Weirdor's butterfly peak it collapses to
    # a point, which is why the scorer leans on prob_profit instead.
    plateau = [x for x, value in analysis["curve"] if abs(value - max_profit) < 1e-9]
    prob_max_profit = None
    if len(plateau) >= 2 and spot > 0 and T > 0:
        below_hi = prob_below(spot, max(plateau), T, pricing_iv, RISK_FREE, div_yield)
        below_lo = prob_below(spot, min(plateau), T, pricing_iv, RISK_FREE, div_yield)
        if below_hi is not None and below_lo is not None:
            prob_max_profit = max(0.0, (below_hi - below_lo) * 100.0)

    sigma_T = (
        forecast_vol * math.sqrt(T)
        if (forecast_vol and forecast_vol > 0 and T > 0) else None
    )
    lower_sigma = upper_sigma = min_sigma = None
    if sigma_T and sigma_T > 0 and spot > 0:
        if lower_be and lower_be > 0:
            lower_sigma = abs(math.log(lower_be / spot) / sigma_T)
        if upper_be and upper_be > 0:
            upper_sigma = abs(math.log(upper_be / spot) / sigma_T)
        if lower_sigma is not None and upper_sigma is not None:
            min_sigma = min(lower_sigma, upper_sigma)

    structure_delta = None
    deltas = [_num(leg.get("delta")) for leg in legs]
    if all(d is not None for d in deltas):
        structure_delta = sum(int(leg["qty"]) * _num(leg["delta"]) for leg in legs)

    oi_min = min(int(_num(leg.get("open_interest"), 0) or 0) for leg in legs)
    volume_min = min(int(_num(leg.get("volume"), 0) or 0) for leg in legs)
    total_contracts = sum(abs(int(leg["qty"])) for leg in legs)

    put_width = built["put_short_strike"] - built["put_long_strike"]
    call_width = built["call_long_strike"] - built["call_short_strike"]
    max_wing = max(put_width, call_width)
    put_cashflow = -sum(
        int(leg["qty"]) * (_num(leg.get("mid"), 0.0) or 0.0)
        for leg in legs if leg["option_type"] == "put"
    )
    call_cashflow = -sum(
        int(leg["qty"]) * (_num(leg.get("mid"), 0.0) or 0.0)
        for leg in legs if leg["option_type"] == "call"
    )
    lower_cushion_pct = (
        (spot - lower_be) / spot * 100.0 if lower_be and spot else None
    )
    upper_cushion_pct = (
        (upper_be - spot) / spot * 100.0 if upper_be and spot else None
    )
    serialized_legs = [
        {
            "role": leg["role"], "option_type": leg["option_type"],
            "strike": _round(leg["strike"]), "qty": int(leg["qty"]),
            "bid": _round(leg.get("bid")), "ask": _round(leg.get("ask")),
            "mid": _round(leg.get("mid")), "iv": _round(leg.get("iv"), 4),
            "delta": _round(leg.get("delta"), 3),
            "open_interest": leg.get("open_interest"),
            "volume": leg.get("volume"),
            "quote_source": leg.get("quote_source"),
        }
        for leg in legs
    ]
    primary_by_role = {leg["role"]: leg for leg in serialized_legs}

    spec = VARIANTS.get(built["variant"], {})
    return {
        "variant": built["variant"],
        "direction": built["direction"],
        "variant_label": spec.get("label", built["variant"]),
        "variant_blurb": spec.get("blurb"),
        "is_asymmetric": built["variant"] in ASYMMETRIC_VARIANTS,
        "notes": built.get("notes") or [],
        "risk_reasons": built.get("risk_reasons") or [],
        "expiration": expiration,
        "dte": dte,
        "atm_iv": atm_iv,
        "total_option_volume": total_option_volume,
        "put_long_strike": built["put_long_strike"],
        "put_short_strike": built["put_short_strike"],
        "call_short_strike": built["call_short_strike"],
        "call_long_strike": built["call_long_strike"],
        "put_width": put_width,
        "call_width": call_width,
        # Geometry only. Variant max loss always comes from the complete,
        # quantity-aware payoff curve rather than this single-wing width.
        "max_wing": max_wing,
        "put_quantity": built["put_quantity"],
        "call_quantity": built["call_quantity"],
        "front_debit": built.get("front_debit"),
        "hedge_leg_count": built.get("hedge_legs", 0),
        "leg_count": len(legs),
        "total_contracts": total_contracts,
        "legs": serialized_legs,
        "put_leg_long": primary_by_role.get("put_long"),
        "put_leg_short": primary_by_role.get("put_short"),
        "call_leg_short": primary_by_role.get("call_short"),
        "call_leg_long": primary_by_role.get("call_long"),
        # Compatibility aliases remain signed. Consumers should prefer the
        # explicit entry fields so a debit structure is never called a credit.
        "credit": entry_cashflow,
        "entry_cashflow": entry_cashflow,
        "entry_credit": max(0.0, entry_cashflow),
        "entry_debit": max(0.0, -entry_cashflow),
        "is_net_debit": entry_cashflow < 0,
        "natural_credit": natural,
        "natural_cashflow": natural,
        "quote_source": "live_bid_ask" if all_live else "last_trade_estimate",
        "uses_last_trade_prices": not all_live,
        "constraints_relaxed": not all_live,
        "put_credit": put_cashflow,
        "call_credit": call_cashflow,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "reward_risk": (max_profit / max_loss) if max_loss > 0 else None,
        "return_on_risk_pct": return_on_risk,
        "annualized_return_on_risk_pct": (
            return_on_risk * 365.0 / dte_eff if return_on_risk is not None else None
        ),
        "credit_pct_of_width": credit_pct_of_width,
        "max_profit_pct_of_range": max_profit_pct_of_range,
        "entry_debit_pct_of_max_loss": (
            -entry_cashflow / max_loss * 100.0
            if entry_cashflow < 0 and max_loss > 0 else None
        ),
        "credit_dollars": entry_cashflow * CONTRACT_MULTIPLIER,
        "entry_cashflow_dollars": entry_cashflow * CONTRACT_MULTIPLIER,
        "entry_credit_dollars": max(0.0, entry_cashflow) * CONTRACT_MULTIPLIER,
        "entry_debit_dollars": max(0.0, -entry_cashflow) * CONTRACT_MULTIPLIER,
        "max_profit_dollars": max_profit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": max_loss * CONTRACT_MULTIPLIER,
        "prob_max_profit": prob_max_profit,
        "breakevens": analysis["breakevens"],
        "lower_breakeven": lower_be,
        "upper_breakeven": upper_be,
        "profit_zone_width_pct": (
            (upper_be - lower_be) / spot * 100.0
            if lower_be and upper_be and spot else None
        ),
        "put_otm_pct": (
            (spot - built["put_short_strike"]) / spot * 100.0 if spot else None
        ),
        "call_otm_pct": (
            (built["call_short_strike"] - spot) / spot * 100.0 if spot else None
        ),
        "lower_cushion_pct": lower_cushion_pct,
        "upper_cushion_pct": upper_cushion_pct,
        "lower_cushion_sigma": lower_sigma,
        "upper_cushion_sigma": upper_sigma,
        "min_cushion_sigma": min_sigma,
        "expected_move_pct_life": (sigma_T * 100.0) if sigma_T else None,
        "prob_profit": prob_profit,
        "structure_delta": structure_delta,
        "exec_cost": exec_cost,
        "exec_cost_pct": (
            exec_cost / abs(entry_cashflow) * 100.0
            if exec_cost is not None and abs(entry_cashflow) > 1e-9 else None
        ),
        "open_interest_min": oi_min,
        "volume_min": volume_min,
    }


def _suggest_variant_structures(
    ticker: str, spot: float, div_yield: float, forecast_vol: float | None,
    target_dte: int, min_dte: int, max_dte: int,
    wanted: list[tuple[str, str]], tech: dict,
    short_delta: float = 0.16, long_delta: float = 0.07,
    width_pct: float = 5.0, tilt_strength: float = 0.25, ratio: int = 2,
    min_credit_pct_of_width: float = 15.0, min_cushion_sigma: float = 1.0,
    min_otm_pct: float = 2.0, min_open_interest: int = 50,
    max_exec_cost_pct: float = 45.0, earnings_date: str | None = None,
    earnings_buffer_days: int = 5, fund: dict | None = None,
) -> list[dict]:
    """Every requested variant on one underlying, priced off one shared chain."""
    try:
        expirations = list(yf.Ticker(ticker).options or [])
    except Exception:
        return []

    earnings_d = _parse_date(earnings_date)
    cutoff = (
        earnings_d - timedelta(days=max(0, earnings_buffer_days))
        if earnings_d else None
    )
    expiration, dte, cleared = _pick_expiration(
        expirations, target_dte, min_dte, max_dte, expire_before=cutoff,
    )
    if not expiration:
        return []

    puts = _load_put_chain(ticker, expiration, spot, div_yield)
    calls = _load_call_chain(ticker, expiration, spot, div_yield)
    if not puts or not calls:
        return []

    total_option_volume = sum(
        max(0, int(_num(leg.get("volume"), 0) or 0))
        for leg in [*puts, *calls]
    )

    dte_eff = max(dte or 1, 1)
    # The put pool deliberately runs a little *above* spot. The Jeep's front
    # debit spread sits nearest the money, and clipping the pool at spot — which
    # is right for a plain condor — squeezes that spread down to whatever single
    # strike is left underneath, which is not the structure.
    prepared_puts = [
        q for q in (
            _prepare_put_quote(leg, spot=spot, dte=dte_eff, dividend_yield=div_yield)
            for leg in puts if leg["strike"] < spot * 1.03
        ) if q is not None
    ]
    prepared_calls = [
        q for q in (
            _prepare_option_quote(leg, option_type="call", spot=spot, dte=dte_eff,
                                  dividend_yield=div_yield)
            for leg in calls if leg["strike"] > spot * 0.97
        ) if q is not None
    ]
    live_puts = [leg for leg in prepared_puts if _quotable(leg)]
    live_calls = [leg for leg in prepared_calls if _quotable(leg)]

    def _pool(live: list[dict], prepared: list[dict], need: int) -> list[dict]:
        """Legs to build from: liquid ones when there are enough, else all live ones.

        The open-interest floor cannot be applied as a hard pre-filter here. A
        40-DTE expiration is usually a *weekly*, and on a real SPY weekly only a
        handful of strikes carry OI above the default 50 — measured at eight puts
        and one call. Filtering the pool down to those does not produce a
        stricter structure, it produces no structure at all, and the variant
        silently disappears from a scan the user asked for.

        The balanced path already handles this the right way: it prefers the
        liquid pairs and falls back when none qualify. This mirrors it, and the
        thin legs still surface honestly through `open_interest_min` and the
        "Thin open interest on one leg" flag rather than being hidden.
        """
        base = live if len(live) >= need else prepared
        liquid = [
            leg for leg in base
            if int(_num(leg.get("open_interest"), 0) or 0) >= min_open_interest
        ]
        # `need` is deliberately generous rather than the bare minimum to build.
        # Eight liquid strikes scattered across a wide chain is not a pool to
        # select from, it is whichever strikes happened to survive — the delta
        # targets land nowhere near them and the structure fails to build at all.
        # Preferring liquidity is only meaningful when enough of the chain
        # survives to still choose within; below that, take the whole live chain
        # and let `open_interest_min` report what was actually available.
        return sorted(liquid if len(liquid) >= need else base, key=lambda leg: leg["strike"])

    # The Jeep sites three verticals in the put chain, so the put side needs the
    # deepest pool of the family; the call side only ever supplies one.
    put_legs = _pool(live_puts, prepared_puts, 24)
    call_legs = _pool(live_calls, prepared_calls, 12)
    if len(put_legs) < 3 or len(call_legs) < 2:
        return []

    atm_put = min(prepared_puts, key=lambda leg: abs(leg["strike"] - spot))
    atm_call = min(prepared_calls, key=lambda leg: abs(leg["strike"] - spot))
    atm_ivs = [leg["iv"] for leg in (atm_put, atm_call) if leg["iv"] and leg["iv"] > 0]
    atm_iv = (sum(atm_ivs) / len(atm_ivs)) if atm_ivs else 0.0
    expiry_d = datetime.strptime(expiration, "%Y-%m-%d").date()

    ex_div_iso, ex_div_estimated = next_ex_dividend(fund or {})
    ex_div_d = _parse_date(ex_div_iso)
    ex_div_inside = bool(ex_div_d and ex_div_d <= expiry_d)
    dividend = expected_dividend_amount(fund or {}, spot)

    out: list[dict] = []
    for variant, direction in wanted:
        built = build_structure(
            variant, direction, put_legs, call_legs, spot, tech,
            base_short_delta=short_delta, base_long_delta=long_delta,
            tilt_strength=tilt_strength, ratio=ratio, width_pct=width_pct,
        )
        if not built:
            continue
        analysis = analyze_structure(built["legs"])
        # None means the tails are not flat — the structure is net short options
        # somewhere and its loss is unbounded. Never surfaced, never scored.
        if not analysis:
            continue
        # Most of these are credit structures and a debit means something is
        # wrong with the quotes. The two that buy something are exceptions: the
        # hedged Weirdor pays for its butterfly moat, and the Jeep pays for its
        # front debit spread — in the reference position that spread is expensive
        # enough to turn the whole package into a small net debit, which is the
        # cost of the raised shelf, not a pricing error.
        if analysis["entry_cashflow"] <= 0 and variant not in {"weirdor_hedged", "jeep"}:
            continue
        if analysis["max_loss"] <= 0:
            # Riskless and paid to hold is not a trade, it is stale quotes.
            continue

        metrics = _structure_metrics(
            built, analysis, spot, dte_eff, div_yield, forecast_vol, expiration, atm_iv,
            total_option_volume,
        )
        entry_is_credit = metrics["entry_cashflow"] > 0
        constraints_relaxed = bool(metrics["uses_last_trade_prices"])
        if entry_is_credit and (
            metrics.get("credit_pct_of_width") is None
            or metrics["credit_pct_of_width"] < min_credit_pct_of_width
        ):
            constraints_relaxed = True
        if (
            metrics.get("min_cushion_sigma") is not None
            and metrics["min_cushion_sigma"] < min_cushion_sigma
        ):
            constraints_relaxed = True
        if (
            metrics.get("put_otm_pct") is not None
            and metrics["put_otm_pct"] < min_otm_pct
        ) or (
            metrics.get("call_otm_pct") is not None
            and metrics["call_otm_pct"] < min_otm_pct
        ):
            constraints_relaxed = True
        if metrics["open_interest_min"] < min_open_interest:
            constraints_relaxed = True
        if not metrics["uses_last_trade_prices"] and (
            metrics.get("exec_cost_pct") is None
            or metrics["exec_cost_pct"] > max_exec_cost_pct
        ):
            constraints_relaxed = True
        if (
            entry_is_credit
            and not metrics["uses_last_trade_prices"]
            and (_num(metrics.get("natural_cashflow"), 0.0) or 0.0) <= 0
        ):
            constraints_relaxed = True
        early = assess_early_assignment(
            next((leg["mid"] for leg in metrics["legs"]
                  if leg["role"] == "call_short"), None),
            spot, metrics["call_short_strike"], dividend, ex_div_inside,
        )
        metrics.update({
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
            "constraints_relaxed": constraints_relaxed,
        })
        out.append(metrics)
    return out


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_candidate(tech: dict, fund: dict, condor: dict | None,
                    earnings_buffer_days: int = 5) -> dict:
    """Rate a name as an iron condor candidate on four independent axes.

    Range     (30) - is it genuinely going nowhere, and does it habitually?
    Vol       (25) - is the premium rich against what this name actually delivers?
    Structure (20) - do both breakevens clear the expected move, and is it balanced?
    Safety    (25) - four legs, four markets, and both tails short.
    """
    flags: list[str] = []
    # Which structure is being rated, and which way it leans if it leans. Read
    # up front because the Range axis needs it too: a directional variant does
    # not want the same underlying a neutral condor wants.
    variant = (condor or {}).get("variant")
    lean = (condor or {}).get("direction") or "neutral"
    is_tilted = bool(variant) and variant != "balanced"

    # ── Range ─────────────────────────────────────────────────────────────
    range_score = 0.0

    # Efficiency ratio (9). The heaviest single term on the screen, because it
    # is the one measurement that separates a genuine range from a round trip
    # that every net-drift metric calls flat. Full credit below 0.15, nothing
    # above 0.55.
    er = _num(tech.get("efficiency_ratio"))
    range_score += _ramp(-(er if er is not None else 1.0), -0.55, -0.15, 9)

    # Net drift as a magnitude (7). Direction is irrelevant here — the screen has
    # no opinion on which way it should not have gone.
    drift = _num(tech.get("drift_sigma"))
    range_score += _ramp(-(drift if drift is not None else 5.0), -2.25, -0.75, 7)

    # Variance ratio (5). Below 1 the name mean-reverts, which is the behaviour
    # that refills the premium between now and expiration.
    vr = _num(tech.get("variance_ratio"))
    if vr is not None:
        range_score += _ramp(-vr, -1.25, -0.85, 5)

    # Flat moving averages (4). A sloping average is a trend by another name.
    slope = _num(tech.get("ma_slope_abs"))
    range_score += _ramp(-(slope if slope is not None else 10.0), -3.0, -0.5, 4)

    # RSI near the middle (5). Both extremes are wrong here, and for opposite
    # reasons, which is exactly what a band expresses and a ramp cannot.
    range_score += _band(tech.get("rsi_14"), 30, 42, 58, 70, 5)

    # Penalties, charged against the axis whose thesis they falsify. The default
    # gates already exclude each condition, so a name only reaches here when the
    # user has loosened one — which is precisely when the score has to argue back
    # instead of nodding along.
    if tech.get("fresh_high"):
        range_score -= 9
        flags.append("Making fresh 52-week highs")
    if tech.get("fresh_low"):
        range_score -= 9
        flags.append("Making fresh 52-week lows")
    # Leadership against the market is disqualifying for a neutral condor. For a
    # tilted one it is only disqualifying when it runs the *wrong* way: a bullish
    # tilt is built precisely for a name pulling ahead of the market, and
    # charging it the neutral screen's penalty would rank the setups the variant
    # exists to find below the ones it does not want.
    strength = _num(tech.get("rel_strength_pct"))
    if strength is not None and abs(strength) > 5:
        with_the_lean = (
            is_tilted
            and ((lean == "bullish" and strength > 0) or (lean == "bearish" and strength < 0))
        )
        if not with_the_lean:
            range_score -= _ramp(abs(strength), 5, 15, 6)
            flags.append("Trending against the market — not neutral")
    if er is not None and er > 0.5:
        flags.append("Trending, not ranging")
    if vr is not None and vr > 1.2:
        flags.append("Moves extend rather than revert")
    position = _num(tech.get("range_position_pct"))
    if position is not None and (position < 15 or position > 85):
        flags.append("Sitting at the edge of its range")

    range_score = max(0.0, range_score)

    # ── Vol ───────────────────────────────────────────────────────────────
    vol_score = 0.0
    iv_rv = None
    iv_percentile = None

    # Realized vol contracting (3). The only Vol term that does not need a chain,
    # which is why it is excluded from VOL_CHAIN_MAX.
    contraction = _num(tech.get("rv_contraction"))
    vol_score += _ramp(-(contraction if contraction is not None else 2.0), -1.15, -0.85, 3)

    if condor:
        atm_iv = _num(condor.get("atm_iv"))
        rv = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        if atm_iv and rv and rv > 0:
            iv_rv = atm_iv / rv
        # Implied over realized (10). The core of the edge, and the reason the
        # ramp starts at 1.0 rather than the 0.95 the directional sellers use: a
        # condor has no direction to be right about, so premium that merely
        # matches realized vol pays for nothing.
        vol_score += _ramp(iv_rv, 1.0, 1.6, 10)

        iv_percentile = _iv_percentile_vs_rv(atm_iv, tech.get("rv_history"))
        vol_score += _ramp(iv_percentile, 40, 85, 6)

        # Credit against the four-leg realized-vol fair value (6).
        vol_score += _ramp(condor.get("premium_edge_pct"), 0, 35, 6)

        if iv_rv is not None and iv_rv < 1.0:
            flags.append("Implied vol at or below realized — nothing to sell")
        if iv_percentile is not None and iv_percentile < 35:
            flags.append("Premium cheap against this name's own history")
        if (condor.get("premium_edge_pct") or 0) < 0:
            flags.append("Credit below realized-vol fair value")

    # ── Structure ─────────────────────────────────────────────────────────
    structure = 0.0
    if condor:
        # Both breakevens outside the expected move (8). Scored on the *nearer*
        # side, because that is the one the position actually has. This is the
        # classic condor failure — short strikes sold inside the expected move,
        # where the credit looks generous precisely because the market expects to
        # reach them.
        structure += _ramp(condor.get("min_cushion_sigma"), 0.8, 1.8, 8)

        # Delta balance (4). Near-equal short deltas is what makes it neutral;
        # equal *distances* do not, because of put skew.
        #
        # A tilted or ratio'd structure is *supposed* to be unbalanced — that is
        # the entire point of picking a direction — so measuring it against
        # neutrality would penalise it for succeeding. Those variants are scored
        # on how flat the finished position's net delta is instead, which is the
        # question that still has a right answer: a lean is intended, an
        # accidental lean of unknown size is not.
        variant = condor.get("variant")
        gap = _num(condor.get("delta_gap"))
        if variant and variant != "balanced":
            net = abs(_num(condor.get("structure_delta")) or 1.0)
            structure += _ramp(-net, -0.60, -0.05, 4)
        else:
            structure += _ramp(-(gap if gap is not None else 1.0), -0.12, -0.02, 4)

        # A classic condor is scored on credit/wing. Quantity-aware variants can
        # be intentional debits, so they use maximum profit as a share of the
        # complete payoff range instead of pretending the debit is a credit.
        entry_efficiency = (
            condor.get("max_profit_pct_of_range")
            if variant and variant != "balanced"
            else condor.get("credit_pct_of_width")
        )
        structure += _ramp(entry_efficiency, 12, 33, 5)

        # Odds of finishing between the short strikes (3). A hedged structure's
        # maximum sits on a butterfly peak rather than a plateau, so its exact
        # max-profit probability is near zero by construction and says nothing
        # about the trade. Those score on the odds of any profit at all.
        if condor.get("prob_max_profit") is not None:
            structure += _ramp(condor.get("prob_max_profit"), 45, 75, 3)
        else:
            structure += _ramp(condor.get("prob_profit"), 55, 85, 3)

        if (condor.get("min_cushion_sigma") or 0) < 1.0:
            flags.append("A breakeven sits inside the expected move")
        if (
            (_num(condor.get("entry_cashflow"), condor.get("credit")) or 0.0) > 0
            and (condor.get("credit_pct_of_width") or 0) < 15
        ):
            flags.append("Credit too small for the defined risk")
        # Only a structure that was meant to be neutral can be accused of
        # leaning. On a tilted or Weirdor-family variant the lean is the thesis.
        if not variant or variant == "balanced":
            if gap is not None and gap > 0.08:
                flags.append("Lopsided — this is a directional trade")
        share = _num(condor.get("put_share_of_credit_pct"))
        if share is not None and (share > 75 or share < 25):
            flags.append("One wing supplies almost all the credit")
        if (condor.get("wing_skew_pct") or 0) > 25:
            flags.append("Wings are different widths")

    # ── Safety ────────────────────────────────────────────────────────────
    safety = 0.0
    ticker = tech.get("ticker") or ""
    is_fund = _is_fund(fund, ticker)
    fund_kind = _fund_kind(ticker, fund) if is_fund else None
    size = _fund_size(fund) or 0.0

    # Size (3). Judged for gap risk in *both* directions, which is this screen's
    # version of a term the directional screens only need one side of: a takeover
    # bid breaks the call wing, an accounting collapse breaks the put wing, and a
    # condor is short both.
    if size >= 50e9:
        safety += 3
    elif size >= 10e9:
        safety += 2.5
    elif size >= 2e9:
        safety += 1.6
    elif size >= 500e6:
        safety += 0.8
    else:
        safety += 0.2
        flags.append("Small underlying — gap risk on both wings")

    if is_fund and fund_kind == "leveraged":
        flags.append("Leveraged or inverse fund")

    # Share liquidity (3) — the proxy for how tight four strikes will quote.
    adv = _num(tech.get("avg_dollar_volume")) or 0.0
    if adv >= 200e6:
        safety += 3
    elif adv >= 50e6:
        safety += 2.4
    elif adv >= 20e6:
        safety += 1.6
    elif adv >= 5e6:
        safety += 0.8
    else:
        flags.append("Thin share liquidity")

    early_level = None
    if condor:
        estimated = bool(condor.get("uses_last_trade_prices"))
        if estimated:
            flags.append("Recent trade estimates — no live bid/ask")
        # Four-leg slippage (6). Roughly double the weight the two-leg screens
        # give it, and the term most likely to decide whether a condor that looks
        # good on paper is worth opening: four markets to cross on the way in and
        # four on the way out, against a credit that is not twice a vertical's.
        cost_pct = _num(condor.get("exec_cost_pct"))
        safety += _ramp(-(cost_pct if cost_pct is not None else 200.0), -60, -15, 6)

        # Odds of finishing between the breakevens (4) — any profit at all,
        # which is the wider and more honest window than max profit.
        safety += _ramp(condor.get("prob_profit"), 55, 82, 4)

        # Open interest on the worst of four legs (4).
        safety += _ramp(condor.get("open_interest_min"), 50, 500, 4)

        # A credit that survives crossing all four markets (3).
        if (_num(condor.get("natural_credit"), 0.0) or 0.0) > 0:
            safety += 3

        # Equal wings (2): the risk does not then depend on which side breaks.
        # A ratio'd structure has deliberately unequal wings, so the two points
        # go instead to how fillable it is — a 5:2 across six legs is a harder
        # order to work than a 1:1 across four, and that cost is real.
        if is_tilted:
            contracts = int(_num(condor.get("total_contracts"), 99) or 99)
            if contracts <= 4:
                safety += 2
            elif contracts <= 8:
                safety += 1
        elif (condor.get("wing_skew_pct") or 100) <= 10:
            safety += 2

        if not estimated and (cost_pct is None or cost_pct > 45):
            flags.append("Four-leg slippage is high")
        if (condor.get("open_interest_min") or 0) < 50:
            flags.append("Thin open interest on one leg")
        entry_cashflow = _num(condor.get("entry_cashflow"), condor.get("credit")) or 0.0
        if (
            entry_cashflow > 0
            and not estimated
            and (_num(condor.get("natural_cashflow"), condor.get("natural_credit")) or 0.0) <= 0
        ):
            flags.append("No credit after crossing all four markets")
        if condor.get("constraints_relaxed") and not estimated:
            flags.append("No structure met every filter")

        early = condor.get("early_assignment") or {}
        early_level = early.get("level")
        if early_level == "high":
            safety = max(0.0, safety - 5)
            flags.append("Dividend invites early assignment")
        elif early_level == "elevated":
            safety = max(0.0, safety - 2.5)
            flags.append("Dividend is a large share of the credit")

    # ── Event risk ────────────────────────────────────────────────────────
    # Worse here than on any single vertical. An earnings gap does not merely
    # threaten one side: the implied vol that made the credit look generous is
    # the earnings premium itself, it collapses the morning after regardless of
    # direction, and the gap breaks whichever wing it points at.
    earnings_before_expiry = None
    earnings_date = _parse_date(fund.get("next_earnings"))
    expiry_date = _parse_date(condor["expiration"]) if condor else None
    if earnings_date and expiry_date:
        earnings_before_expiry = earnings_date <= expiry_date
        gap_days = (earnings_date - expiry_date).days
        if earnings_before_expiry:
            flags.append("Earnings before expiration")
            safety = max(0.0, safety - 9)
        elif gap_days <= earnings_buffer_days:
            flags.append(f"Earnings {gap_days}d after expiry")

    total = range_score + vol_score + structure + safety
    # Without a chain, Structure and most of Vol and Safety cannot score, so rate
    # on what was scorable. That inflates the normalized number rather than
    # deflating it, which is why the scan ranks unpriced rows below every priced
    # one instead of letting the smaller denominator float them up.
    scored_max = 100.0 if condor else PARTIAL_MAX
    normalized = total / scored_max * 100.0
    if condor is None:
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
            "range": round(range_score, 1),
            "vol": round(vol_score, 1),
            "structure": round(structure, 1),
            "safety": round(safety, 1),
        },
        "component_max": {
            "range": 30, "vol": 25, "structure": 20, "safety": 25,
        },
        "iv_rv_ratio": _round(iv_rv, 2),
        "iv_percentile_vs_rv": _round(iv_percentile, 0),
        "early_assignment_level": early_level,
        "earnings_before_expiry": earnings_before_expiry,
        "days_to_earnings": (earnings_date - date.today()).days if earnings_date else None,
        "is_fund": is_fund,
        "fund_kind": fund_kind,
        "flags": list(dict.fromkeys(flags)),
        "scored_on_partial": condor is None,
    }


# ---------------------------------------------------------------------------
# Trade management
# ---------------------------------------------------------------------------

def recommend_management(condor: dict | None, rating: dict | None,
                         tech: dict | None = None) -> dict | None:
    """Close-early and defence plan for a four-leg short premium position.

    Three of these rules are specific to condors rather than inherited from the
    vertical screens:

      * **A 50% profit target, not the 60-65% a clean vertical can hold for.**
        A condor's payoff is a high win rate against a fat tail, so the last
        stretch of the credit is the part bought most expensively in risk: it is
        earned only by holding a position that is short gamma on both sides
        through the period where gamma is largest. Half the credit taken early,
        repeatedly, is the trade.
      * **A hard reassessment at 21 DTE.** Inside three weeks a short condor's
        gamma rises sharply, so a strike that was comfortably far away becomes a
        strike that a single session can reach. The plan is to be making a
        decision on that date rather than discovering it later.
      * **Defend by rolling the untested side, not by widening the tested one.**
        Bringing the untested wing closer collects new credit against risk that
        has just become *less* likely to matter, which is the only adjustment
        that improves the position without adding to the side already in
        trouble.
    """
    if not condor:
        return None
    credit = _num(condor.get("credit"))
    max_wing = _num(condor.get("max_wing"))
    if not credit or credit <= 0 or not max_wing or max_wing <= credit:
        return None

    rating = rating or {}
    grade = str(rating.get("grade") or "")
    score = _num(rating.get("score"), 0.0) or 0.0
    flags = set(rating.get("flags") or [])
    material = {
        "Earnings before expiration",
        "Four-leg slippage is high",
        "Thin open interest on one leg",
        "Making fresh 52-week highs",
        "Making fresh 52-week lows",
        "Trending, not ranging",
        "Trending against the market — not neutral",
        "A breakeven sits inside the expected move",
        "Lopsided — this is a directional trade",
        "Dividend invites early assignment",
        "No structure met every filter",
    }
    has_material_risk = bool(flags & material)

    if grade == "A" and score >= 80 and not has_material_risk:
        capture_pct = 55.0
        profile = "Strong setup"
        rationale = (
            "A high range score and a clean four-leg market support holding for "
            "55% of the credit, slightly past the standard half."
        )
    elif grade in {"A", "B"} and not has_material_risk:
        capture_pct = 50.0
        profile = "Balanced setup"
        rationale = (
            "The conventional 50% target: it banks most of the realistic profit "
            "without holding a short-gamma position into its worst stretch."
        )
    else:
        capture_pct = 40.0
        profile = "Defensive setup"
        rationale = (
            "The range or the four-leg market carries added risk, so this takes "
            "less and leaves sooner."
        )

    target_debit = max(0.01, round(credit * (1.0 - capture_pct / 100.0), 2))
    # Doubling the credit is the conventional risk trigger on short premium,
    # capped just inside the wing because beyond it the structure cannot trade.
    stop_debit = min(max_wing - 0.01, max(credit + 0.01, round(credit * 2.0, 2)))
    dte = max(1, int(_num(condor.get("dte"), 1) or 1))
    # 21 days is where short gamma starts to dominate theta. Shorter trades get a
    # proportional date rather than one that has already passed.
    reassess_dte = 21 if dte >= 30 else max(7, int(round(dte * 0.5)))

    # The two prices that say the thesis is failing, one per wing. These are
    # reached long before the defined loss is, which is the point of watching
    # them rather than the debit alone.
    tested_put = _num(condor.get("put_short_strike"))
    tested_call = _num(condor.get("call_short_strike"))

    close_before = None
    close_before_note = None
    ex_div = _parse_date(condor.get("ex_dividend_date"))
    early_level = (condor.get("early_assignment") or {}).get("level")
    if ex_div and condor.get("ex_dividend_inside") and early_level in {"elevated", "high"}:
        close_before = ex_div.isoformat()
        estimated = " (estimated)" if condor.get("ex_dividend_estimated") else ""
        close_before_note = (
            f"Close the call wing before the {ex_div.isoformat()} ex-dividend date"
            f"{estimated}. A call holder exercises the day before an ex-date once the "
            f"remaining extrinsic value is worth less than the dividend, which would "
            f"leave you short 100 shares alongside three other open legs."
        )

    defence_note = (
        f"If price reaches ${tested_put:.2f} or ${tested_call:.2f}, one side is tested. "
        f"Roll the untested wing closer to collect new credit rather than widening "
        f"the tested one — the untested side is the risk that has just become less "
        f"likely to matter, so it is the only adjustment that pays you without adding "
        f"to the side already in trouble. If both breakevens come into play, the range "
        f"thesis is gone and the position should be closed rather than adjusted."
        if tested_put and tested_call else
        "Manage on the debit alone; the short strikes could not be resolved."
    )

    return {
        "target_debit": target_debit,
        "profit_capture_pct": round((credit - target_debit) / credit * 100.0, 1),
        "target_profit_dollars": round((credit - target_debit) * CONTRACT_MULTIPLIER, 0),
        "stop_debit": stop_debit,
        "stop_loss_dollars": round(max(0.0, stop_debit - credit) * CONTRACT_MULTIPLIER, 0),
        "entry_credit_basis": round(credit, 2),
        "reassess_dte": reassess_dte,
        "close_by_dte": 7,
        "close_before": close_before,
        "close_before_note": close_before_note,
        "tested_put_price": _round(tested_put),
        "tested_call_price": _round(tested_call),
        "defence_note": defence_note,
        "profile": profile,
        "rationale": (
            f"{rationale} Open and close all four legs as one condor order. "
            f"The target removes assignment and pin risk once most of the realistic "
            f"credit is earned; the stop is a risk trigger, not a guaranteed fill."
        ),
    }


def build_verdict(row: dict) -> str:
    """One line explaining why this name is (or is not) worth an iron condor."""
    c = row.get("spread") or {}
    grade = row.get("grade")

    subject = {
        "index": "Broad index fund",
        "sector": "Sector fund",
        "leveraged": "Leveraged fund",
        "narrow": "Narrow fund",
    }.get(row.get("fund_kind") or "", "Range-bound name")

    structure_words = []
    er = _num(row.get("efficiency_ratio"))
    if er is not None:
        structure_words.append(f"{er:.2f} efficiency ratio")
    drift = _num(row.get("drift_sigma"))
    if drift is not None:
        structure_words.append(f"{drift:.1f}σ net drift")
    vr = _num(row.get("variance_ratio"))
    if vr is not None and vr < 1:
        structure_words.append(f"mean-reverting at {vr:.2f}")
    structure = ", ".join(structure_words) or "no clear trend"

    quality = {
        "A": "Clean range", "B": "Solid range", "C": "Workable range",
    }.get(grade or "", "Marginal range")
    lead = (
        f"{subject}, {quality.lower()} — {structure}"
        if row.get("is_fund") else f"{quality} — {structure}"
    )

    if row.get("iv_rv_ratio") is not None:
        lead += f", implied vol {row['iv_rv_ratio']:.2f}× realized"
        if row.get("iv_percentile_vs_rv") is not None:
            lead += f" ({row['iv_percentile_vs_rv']:.0f}th percentile of its own year)"

    entry_cashflow = _num(c.get("entry_cashflow"), c.get("credit"))
    if c.get("put_short_strike") and entry_cashflow is not None:
        entry_words = (
            f"collect ${entry_cashflow:.2f} credit"
            if entry_cashflow >= 0
            else f"pay ${abs(entry_cashflow):.2f} debit"
        )
        lead += (
            f". Build the {c['expiration']} ${c['put_long_strike']:g}/${c['put_short_strike']:g}"
            f" – ${c['call_short_strike']:g}/${c['call_long_strike']:g} structure: "
            f"{entry_words} — maximum profit ${c['max_profit_dollars']:.0f} against "
            f"${c['max_loss_dollars']:.0f} of risk"
        )
        if c.get("prob_profit") is not None:
            lead += f", with about {c['prob_profit']:.0f}% modeled odds of finishing in profit"
        if c.get("lower_breakeven") and c.get("upper_breakeven"):
            lead += (
                f" anywhere between ${c['lower_breakeven']:.2f} and "
                f"${c['upper_breakeven']:.2f}"
            )
            if c.get("min_cushion_sigma") is not None:
                lead += f" ({c['min_cushion_sigma']:.1f}σ on the nearer side over {c['dte']}d)"
        plan = c.get("management") or {}
        if plan.get("target_debit") is not None:
            lead += (
                f". Buy it back near ${plan['target_debit']:.2f} for about "
                f"{plan['profit_capture_pct']:.0f}% of the credit, and reassess at "
                f"{plan['reassess_dte']} DTE"
            )

    flags = row.get("flags") or []
    if "Earnings before expiration" in flags:
        lead += ". Earnings land inside the trade — the gap breaks whichever wing it points at"
    elif "Trending, not ranging" in flags:
        lead += ". It is trending rather than ranging, which is the one condition that walks price through a short strike"
    elif "A breakeven sits inside the expected move" in flags:
        lead += ". A breakeven sits inside the expected move, so the market already expects to reach it"
    elif "Lopsided — this is a directional trade" in flags:
        lead += ". The two short deltas are far apart, so this is a directional bet wearing four legs"
    elif "Four-leg slippage is high" in flags:
        lead += ". Crossing four markets costs a large share of the credit, which is how condors quietly lose"
    elif "Implied vol at or below realized — nothing to sell" in flags:
        lead += ". Implied vol is not rich against realized, and premium is the only edge a neutral trade has"
    elif c.get("avoids_earnings") and c.get("days_earnings_after_expiry") is not None:
        lead += (
            f". This expiration closes {c['days_earnings_after_expiry']}d before "
            f"earnings on {c['earnings_date']}"
        )
    return lead + "."


# ---------------------------------------------------------------------------
# The scan
# ---------------------------------------------------------------------------

DEFAULTS = {
    "universe": "large_cap",
    "include_stocks": True,
    # On by default and deliberately: broad index funds are the classic condor
    # underlying — they mean-revert, cannot be taken over, never report earnings,
    # and carry the deepest option chains in the market.
    "include_index_etfs": True,
    "include_sector_etfs": False,
    "include_commodity_etfs": False,
    "lookback_days": 21,
    "min_market_cap": 0.0,
    "fund_min_aum": 0.0,
    "exclude_leveraged_funds": True,
    # Higher than the directional screens. Four legs have to be filled twice.
    "min_avg_dollar_volume": 10e6,
    # ── Neutrality gates ─────────────────────────────────────────────────
    "max_efficiency_ratio": 1.0,
    "max_drift_sigma": 99.0,
    "max_variance_ratio": 99.0,
    "max_ma_slope_pct": 99.0,
    "min_rsi": 0.0,
    "max_rsi": 100.0,
    "max_rel_strength_pct": 99.0,
    "min_range_position_pct": 0.0,
    "max_range_position_pct": 100.0,
    "exclude_fresh_extremes": False,
    "exclude_earnings_before_expiry": True,
    "earnings_buffer_days": 5,
    # ── Structure ────────────────────────────────────────────────────────
    # 40 days sits in the 30-45 window where a condor's theta is worth its gamma,
    # and leaves room to close at the 21-day reassessment with most of the credit
    # already earned.
    "target_dte": 40,
    "min_dte": 7,
    "max_dte": 60,
    # 16 delta is approximately the one-standard-deviation strike, which is where
    # the classic condor is sold.
    "short_delta": 0.16,
    "long_delta": 0.07,
    "delta_tolerance": 0.10,
    "min_width_pct": 0.5,
    "max_width_pct": 20.0,
    "min_credit_pct_of_width": 5.0,
    "min_cushion_sigma": 0.0,
    "min_otm_pct": 0.0,
    "max_wing_skew_pct": 25.0,
    "max_delta_gap": 0.15,
    "min_open_interest": 0,
    # Looser than the two-leg screens' 30% because there are twice as many
    # markets to cross, and the credit is not twice as large.
    "max_exec_cost_pct": 100.0,
    "chain_limit": 60,
    "max_results": 100,
    "max_structures_per_ticker": 5,
    # ── Samurai-style result filters ───────────────────────────────────────
    # These run after a real four-leg structure is priced.  The old range,
    # liquidity, and construction controls above remain available as advanced
    # filters; they no longer have to do all the work before a chain is seen.
    "min_total_option_volume": 5000,
    "min_iv_rank": 25.0,
    "use_iv_proxy_until_ready": True,
    "min_prob_max_profit": 60.0,
    "max_prob_max_loss": 90.0,
    "require_positive_expected_value": True,
    "max_abs_position_delta": 10.0,
    "require_balanced_shape": True,
    "min_max_profit_dollars": 100.0,
    "max_max_loss_dollars": 5000.0,
    "min_profit_ratio_pct": 0.0,
    # Shared stock-only selection scores.  The 1-10 full range means "Any".
    "stock_score_fundamental_min": 1.0,
    "stock_score_fundamental_max": 10.0,
    "stock_score_growth_min": 1.0,
    "stock_score_growth_max": 10.0,
    "stock_score_technical_min": 1.0,
    "stock_score_technical_max": 10.0,
    # ── Structure variants ───────────────────────────────────────────────
    # Neutral + balanced reproduces the screen exactly as it was, which is why
    # both are the defaults: nobody who has not asked for a directional condor
    # gets one.
    "market_bias": "neutral",
    "construction": "balanced",
    # Severson biases a .30-delta condor to roughly .375/.225. Held as a
    # fraction of the user's own short delta so the tilt scales with whatever
    # probability they are trading rather than jumping to his.
    "tilt_strength": 0.25,
    # 2:1 is the ratio in the guide's worked bias examples.
    "ratio_contracts": 2,
    # The wing width variants build to, as a share of spot. The balanced path
    # searches a min/max window instead; a variant has too many other moving
    # parts to also enumerate widths.
    "variant_width_pct": 5.0,
    # These structures are index trades. The reference Weirdor is on RUT, the
    # family was developed on SPX/RUT, and six legs at a workable ratio need the
    # deepest chains in the market — a 5:1 ratio across three verticals is
    # simply not fillable on a single name. Restricting the variant scan to the
    # three big index ETFs is therefore a correctness constraint, not a
    # shortcut. Override `variant_tickers` to widen it.
    #
    # The core set intentionally uses only the three most liquid index ETF
    # chains: SPY, QQQ, and IWM.
    "variant_tickers": "SPY,QQQ,IWM",
    "restrict_variants_to_core": True,
}


def _samurai_filter_reasons(row: dict, p: dict) -> list[str]:
    """Explain every compact result filter a priced structure misses."""
    spread = row.get("spread") or {}
    if not spread:
        return []

    reasons: list[str] = []

    def below(key: str, value, label: str, suffix: str = ""):
        floor = _num(p.get(key))
        actual = _num(value)
        if floor is not None and actual is not None and actual < floor:
            reasons.append(f"{label} {actual:.1f}{suffix} is below {floor:.1f}{suffix}")

    def above(key: str, value, label: str, suffix: str = ""):
        ceiling = _num(p.get(key))
        actual = _num(value)
        if ceiling is not None and actual is not None and actual > ceiling:
            reasons.append(f"{label} {actual:.1f}{suffix} is above {ceiling:.1f}{suffix}")

    below("min_total_option_volume", spread.get("total_option_volume"), "Option volume")
    below("min_iv_rank", row.get("iv_rank_effective"), "IV rank")
    below("min_prob_max_profit", spread.get("prob_max_profit"), "Max-profit probability", "%")
    above("max_prob_max_loss", spread.get("prob_max_loss"), "Max-loss probability", "%")
    below("min_max_profit_dollars", spread.get("max_profit_dollars"), "Maximum profit", "$")
    above("max_max_loss_dollars", spread.get("max_loss_dollars"), "Maximum loss", "$")
    below("min_profit_ratio_pct", spread.get("return_on_risk_pct"), "Profit ratio", "%")

    position_delta = _num(spread.get("structure_delta"))
    max_abs_delta = _num(p.get("max_abs_position_delta"))
    if position_delta is not None and max_abs_delta is not None:
        position_delta *= 100.0
        if abs(position_delta) > max_abs_delta:
            reasons.append(
                f"Position delta {position_delta:+.1f} is outside ±{max_abs_delta:.1f}"
            )

    expected_value = _num(spread.get("expected_value_dollars"))
    if p.get("require_positive_expected_value") and (
        expected_value is None or expected_value <= 0
    ):
        reasons.append("Expected value is not positive")

    if p.get("require_balanced_shape"):
        if spread.get("variant") not in (None, "balanced"):
            reasons.append("Structure is not the standard balanced iron condor")
        else:
            wing_skew = _num(spread.get("wing_skew_pct"))
            if wing_skew is None or wing_skew > 15.0:
                reasons.append("Wing widths are not balanced")

    if not row.get("is_fund"):
        scores = row.get("stock_scores") or {}
        for name, label in (
            ("fundamental", "Fundamental score"),
            ("growth", "Growth score"),
            ("technical", "Technical score"),
        ):
            score = _num(scores.get(name))
            floor = _num(p.get(f"stock_score_{name}_min"), 1.0)
            ceiling = _num(p.get(f"stock_score_{name}_max"), 10.0)
            restricted = (floor is not None and floor > 1.0) or (
                ceiling is not None and ceiling < 10.0
            )
            if restricted and score is None:
                reasons.append(f"{label} is unavailable")
            elif score is not None and (
                (floor is not None and score < floor)
                or (ceiling is not None and score > ceiling)
            ):
                reasons.append(
                    f"{label} {score:.1f} is outside {floor:.1f}-{ceiling:.1f}"
                )

    return reasons


def _partition_candidate_rows(rows: list[dict], max_results: int) -> tuple[list[dict], list[dict]]:
    """Separate executable ideas from names that still need more work."""
    actionable = [row for row in rows if row.get("chain_status") == "actionable"]
    watchlist = [row for row in rows if row.get("chain_status") != "actionable"]

    actionable.sort(key=lambda row: -(row.get("score") or 0))
    order = {
        "earnings": 0, "filters_missed": 1, "constraints_relaxed": 2,
        "unavailable": 3, "not_priced": 4,
    }
    watchlist.sort(key=lambda row: (
        order.get(row.get("chain_status"), 4),
        -(row.get("score") or 0),
    ))
    return actionable[:max_results], watchlist[:max_results]


def run_iron_condor_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}

    lookback = max(5, min(126, int(_num(p["lookback_days"], 21))))
    min_cap = max(0.0, _num(p["min_market_cap"], 0.0) or 0.0)
    fund_min_aum = max(0.0, _num(p["fund_min_aum"], 0.0) or 0.0)
    min_adv = max(0.0, _num(p["min_avg_dollar_volume"], 0.0) or 0.0)
    max_er = _num(p["max_efficiency_ratio"], 1.0)
    max_er = 1.0 if max_er is None else max_er
    max_drift = _num(p["max_drift_sigma"], 99.0)
    max_drift = 99.0 if max_drift is None else max_drift
    max_vr = _num(p["max_variance_ratio"], 99.0)
    max_vr = 99.0 if max_vr is None else max_vr
    max_slope = _num(p["max_ma_slope_pct"], 99.0)
    max_slope = 99.0 if max_slope is None else max_slope
    min_rsi = _num(p["min_rsi"], 0.0) or 0.0
    max_rsi = max(min_rsi, _num(p["max_rsi"], 100.0) or 100.0)
    max_strength = _num(p["max_rel_strength_pct"], 99.0)
    max_strength = 99.0 if max_strength is None else max_strength
    min_pos = _num(p["min_range_position_pct"], 0.0) or 0.0
    max_pos = max(min_pos, _num(p["max_range_position_pct"], 100.0) or 100.0)
    target_dte = max(MIN_TARGET_DTE, min(MAX_TARGET_DTE, int(_num(p["target_dte"], 40))))
    min_dte = max(MIN_TARGET_DTE, int(_num(p["min_dte"], MIN_TARGET_DTE)))
    max_dte = max(min_dte, int(_num(p["max_dte"], MAX_TARGET_DTE)))
    short_delta = min(0.45, max(0.05, _num(p["short_delta"], 0.16) or 0.16))
    long_delta = min(short_delta - 0.01, max(0.01, _num(p["long_delta"], 0.07) or 0.07))
    delta_tol = min(0.35, max(0.02, _num(p["delta_tolerance"], 0.10) or 0.10))
    min_width = max(0.1, _num(p["min_width_pct"], 1.0) or 1.0)
    max_width = max(min_width, _num(p["max_width_pct"], 12.0) or 12.0)
    min_credit = min(90.0, max(1.0, _num(p["min_credit_pct_of_width"], 15.0) or 15.0))
    min_cushion_sig = max(0.0, _num(p["min_cushion_sigma"], 1.0) or 0.0)
    min_otm = max(0.0, _num(p["min_otm_pct"], 2.0) or 0.0)
    max_skew = min(100.0, max(0.0, _num(p["max_wing_skew_pct"], 25.0) or 0.0))
    max_gap = min(0.50, max(0.005, _num(p["max_delta_gap"], 0.08) or 0.08))
    min_oi = max(0, int(_num(p["min_open_interest"], 50) or 0))
    max_exec = min(300.0, max(1.0, _num(p["max_exec_cost_pct"], 45.0) or 45.0))
    earnings_buffer = max(0, min(30, int(_num(p["earnings_buffer_days"], 5) or 0)))
    chain_limit = max(0, min(60, int(_num(p["chain_limit"], 20) or 0)))
    max_results = max(1, min(200, int(_num(p["max_results"], 40) or 40)))
    max_structures_per_ticker = max(
        1, min(12, int(_num(p.get("max_structures_per_ticker"), 5) or 5))
    )
    market_bias = str(p.get("market_bias") or "neutral").strip().lower()
    construction = str(p.get("construction") or "balanced").strip().lower()
    wanted_variants = resolve_variants(construction, market_bias)
    # A scan is directional only when a lean was picked *and* at least one
    # structure being built actually expresses it. Asking for the Jeep while
    # nominally "bullish" does not loosen the neutrality gates, because the Jeep
    # does not use the lean.
    lean_direction = "up" if market_bias == "bullish" else "down" if market_bias == "bearish" else None
    directional_scan = bool(
        lean_direction
        and any(VARIANTS.get(v, {}).get("directional") for v, _ in wanted_variants)
    )

    def _strength_ok(value) -> bool:
        """Relative-strength gate, read with the lean when there is one.

        Same reasoning as the drift gate: outperformance *in the direction the
        structure leans* is the setup, not a disqualification.
        """
        if value is None:
            return True
        if abs(value) <= max_strength:
            return True
        if not directional_scan:
            return False
        with_lean = (lean_direction == "up" and value > 0) or (
            lean_direction == "down" and value < 0
        )
        return with_lean and abs(value) <= max_strength * DIRECTIONAL_DRIFT_ALLOWANCE
    tilt_strength = min(0.75, max(0.0, _num(p["tilt_strength"], 0.25) or 0.25))
    ratio_contracts = max(2, min(5, int(_num(p["ratio_contracts"], 2) or 2)))
    variant_width = max(0.5, min(25.0, _num(p["variant_width_pct"], 5.0) or 5.0))

    # A variant scan runs on the core index ETFs unless told otherwise. See the
    # note on `variant_tickers`: the ratio'd and six-leg structures need chains
    # only a handful of funds actually have.
    core_only = bool(p.get("restrict_variants_to_core", True)) and any(
        variant != "balanced" for variant, _ in wanted_variants
    )
    if core_only:
        tickers = _clean_tickers(
            str(p.get("variant_tickers") or "").replace(";", ",").split(",")
        )
        if not tickers:
            tickers = resolve_scan_universe(p)
    else:
        tickers = resolve_scan_universe(p)
    empty_stats = {
        "universe": len(tickers), "priced": 0, "passed_price": 0,
        "passed_fundamentals": 0, "chains_fetched": 0,
        "actionable": 0, "watchlist": 0, "final": 0,
    }
    if not tickers:
        return {
            "rows": [], "watchlist_rows": [], "stats": empty_stats, "params": p,
            "error": "Nothing selected to scan. Enable stocks, index ETFs, or sector ETFs.",
        }

    hist = _load_history(tickers)
    if hist is None or hist.empty:
        return {
            "rows": [], "watchlist_rows": [], "stats": empty_stats, "params": p,
            "error": "Price history unavailable. Yahoo may be rate-limiting; try again shortly.",
        }

    etf_hint = INDEX_ETF_SET | SECTOR_ETF_SET | COMMODITY_ETF_SET
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

        er = tech.get("efficiency_ratio")
        if er is not None and er > max_er:
            continue
        # The neutrality gates are magnitude tests, which is right for a condor
        # with no opinion and wrong for one with a lean. A bullish tilt is built
        # for a name that is drifting *up*; rejecting it for drifting at all
        # leaves the directional scans returning only the flat names the
        # balanced screen already finds, which is the whole feature failing
        # quietly. So drift with the lean is allowed to run further, drift
        # against it is still judged at the original limit.
        drift = tech.get("drift_sigma")
        if drift is not None:
            with_lean = directional_scan and tech.get("drift_direction") == lean_direction
            if drift > (max_drift * DIRECTIONAL_DRIFT_ALLOWANCE if with_lean else max_drift):
                continue
        vr = tech.get("variance_ratio")
        if vr is not None and vr > max_vr:
            continue
        slope = tech.get("ma_slope_abs")
        if slope is not None and slope > max_slope:
            continue
        rsi = tech.get("rsi_14")
        if rsi is not None and (rsi < min_rsi or rsi > max_rsi):
            continue
        position = tech.get("range_position_pct")
        if position is not None and (position < min_pos or position > max_pos):
            continue
        if (tech.get("avg_dollar_volume") or 0.0) < min_adv:
            continue
        if p["exclude_fresh_extremes"] and (tech.get("fresh_high") or tech.get("fresh_low")):
            continue
        # Leadership in either direction is a trend, so the gate reads the
        # magnitude. A curated ticker is known up front; anything from holdings,
        # a watchlist, or a custom list is unknown until stage 2 and is
        # re-checked there.
        strength = tech.get("rel_strength_pct")
        if (
            (ticker in etf_hint or ticker in CURATED_STOCK_SET)
            and not _strength_ok(strength)
        ):
            continue

        tech["ticker"] = ticker
        price_pass.append(tech)

    # Rank the price stage so the expensive stages only touch the flattest names.
    price_pass.sort(key=lambda t: (
        t.get("efficiency_ratio") if t.get("efficiency_ratio") is not None else 1.0,
        t.get("drift_sigma") if t.get("drift_sigma") is not None else 9.0,
    ))
    fundamentals = _fetch_fundamentals_bulk([t["ticker"] for t in price_pass])

    survivors: list[tuple[dict, dict]] = []
    for tech in price_pass:
        ticker = tech["ticker"]
        fund = fundamentals.get(ticker, {})
        is_fund = _is_fund(fund, ticker)
        if not _strength_ok(tech.get("rel_strength_pct")):
            continue

        if is_fund:
            if fund_min_aum and (_num(fund.get("total_assets")) or 0.0) < fund_min_aum:
                continue
            if p["exclude_leveraged_funds"] and _fund_kind(ticker, fund) == "leveraged":
                continue
        else:
            if min_cap and (_num(fund.get("market_cap")) or 0.0) < min_cap:
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
    chain_target_tickers = {pair[0]["ticker"] for pair in chain_targets}

    def _chain_for(pair):
        """Every requested structure for one underlying, as a list.

        The balanced condor keeps its original code path untouched — it is the
        default and it was already correct — and only the variants go through
        the quantity-aware builder.
        """
        tech, fund = pair
        div_y = dividend_yield_for_pricing(fund, tech.get("price"))
        forecast_vol = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        earnings = (
            fund.get("next_earnings")
            if p["exclude_earnings_before_expiry"] else None
        )
        found: list[dict] = []

        if ("balanced", "neutral") in wanted_variants:
            try:
                bases = _suggest_iron_condors(
                    tech["ticker"], tech["price"], div_y, forecast_vol,
                    target_dte, min_dte, max_dte,
                    short_delta=short_delta, long_delta=long_delta,
                    delta_tolerance=delta_tol,
                    min_width_pct=min_width, max_width_pct=max_width,
                    min_credit_pct_of_width=min_credit,
                    min_cushion_sigma=min_cushion_sig,
                    min_otm_pct=min_otm,
                    max_wing_skew_pct=max_skew,
                    max_delta_gap=max_gap,
                    min_open_interest=min_oi,
                    max_exec_cost_pct=max_exec,
                    earnings_date=earnings,
                    earnings_buffer_days=earnings_buffer,
                    fund=fund,
                    max_structures=max_structures_per_ticker,
                )
            except Exception:
                bases = []
            if bases:
                spec = VARIANTS["balanced"]
                found.extend({
                    **base,
                    "variant": "balanced", "direction": "neutral",
                    "variant_label": spec["label"], "variant_blurb": spec["blurb"],
                    "is_asymmetric": False, "notes": [], "risk_reasons": [],
                    "put_quantity": 1, "call_quantity": 1, "total_contracts": 4,
                    "leg_count": 4, "hedge_leg_count": 0, "front_debit": None,
                } for base in bases)

        others = [pair_ for pair_ in wanted_variants if pair_ != ("balanced", "neutral")]
        if others:
            try:
                found.extend(_suggest_variant_structures(
                    tech["ticker"], tech["price"], div_y, forecast_vol,
                    target_dte, min_dte, max_dte, others, tech,
                    short_delta=short_delta, long_delta=long_delta,
                    width_pct=variant_width, tilt_strength=tilt_strength,
                    ratio=ratio_contracts,
                    min_credit_pct_of_width=min_credit,
                    min_cushion_sigma=min_cushion_sig,
                    min_otm_pct=min_otm,
                    min_open_interest=min_oi,
                    max_exec_cost_pct=max_exec,
                    earnings_date=earnings, earnings_buffer_days=earnings_buffer,
                    fund=fund,
                ))
            except Exception:
                pass
        return found

    condors: dict[str, list[dict]] = {}
    if chain_targets:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for pair, built in zip(chain_targets, pool.map(_chain_for, chain_targets)):
                condors[pair[0]["ticker"]] = built or []

    # Yahoo supplies only the current chain.  Save one ATM observation per day
    # so the shared IV-rank filter becomes a true trailing rank as history
    # accumulates.  Until then the row explicitly identifies the RV-percentile
    # proxy used for continuity.
    iv_history: dict[str, dict] = {}
    for ticker, structures in condors.items():
        snapshot = next(
            (
                structure for structure in structures
                if (_num(structure.get("atm_iv"), 0.0) or 0.0) > 0
            ),
            None,
        )
        if snapshot:
            try:
                iv_history[ticker] = record_iv_snapshot(
                    ticker,
                    snapshot["atm_iv"],
                    snapshot.get("expiration"),
                )
            except Exception:
                iv_history[ticker] = {
                    "rank": None, "observations": 0, "ready": False,
                }

    # One row per (ticker, structure). Asking for several constructions means
    # asking to compare them, so each gets scored, ranked and handed off on its
    # own rather than hiding behind whichever one happened to score best. A name
    # whose chain produced nothing still contributes a single watchlist row.
    expanded: list[tuple[dict, dict, dict | None]] = []
    for tech, fund in survivors:
        built = condors.get(tech["ticker"]) or []
        if built:
            expanded.extend((tech, fund, structure) for structure in built)
        else:
            expanded.append((tech, fund, None))

    def _probability_legs(structure: dict) -> list[dict]:
        """Legs in the shape `profit_probability_schedule` expects.

        Variants carry a signed-quantity leg list; the balanced condor carries
        four named legs at 1x. Both collapse to the same thing here.
        """
        if structure.get("legs"):
            return [
                {
                    "option_type": leg["option_type"], "strike": leg["strike"],
                    "iv": leg["iv"], "quantity": int(leg["qty"]),
                }
                for leg in structure["legs"]
            ]
        return [
            {"option_type": "put",
             "strike": (structure.get("put_leg_long") or {}).get("strike"),
             "iv": (structure.get("put_leg_long") or {}).get("iv"), "quantity": 1},
            {"option_type": "put",
             "strike": (structure.get("put_leg_short") or {}).get("strike"),
             "iv": (structure.get("put_leg_short") or {}).get("iv"), "quantity": -1},
            {"option_type": "call",
             "strike": (structure.get("call_leg_short") or {}).get("strike"),
             "iv": (structure.get("call_leg_short") or {}).get("iv"), "quantity": -1},
            {"option_type": "call",
             "strike": (structure.get("call_leg_long") or {}).get("strike"),
             "iv": (structure.get("call_leg_long") or {}).get("iv"), "quantity": 1},
        ]

    rows: list[dict] = []
    for tech, fund, condor in expanded:
        ticker = tech["ticker"]
        rating = score_candidate(tech, fund, condor, earnings_buffer_days=earnings_buffer)
        is_fund = _is_fund(fund, ticker)
        stock_scores = stock_selection_scores(fund, tech, is_fund=is_fund)
        history = iv_history.get(ticker) or {}
        true_iv_rank = _num(history.get("rank"))
        iv_proxy = _num(rating.get("iv_percentile_vs_rv"))
        use_proxy = bool(p.get("use_iv_proxy_until_ready", True))
        effective_iv_rank = true_iv_rank if true_iv_rank is not None else (
            iv_proxy if use_proxy else None
        )
        excluded_for_earnings = bool(
            p["exclude_earnings_before_expiry"] and rating.get("earnings_before_expiry")
        )
        if excluded_for_earnings:
            dropped_for_earnings += 1
            continue
        if condor:
            management = recommend_management(condor, rating, tech)
            div_yield = dividend_yield_for_pricing(fund, tech.get("price"))
            probability_schedule, profit_capture = profit_probability_schedule(
                spot=tech.get("price"),
                dte=condor.get("dte"),
                expiration=condor.get("expiration"),
                distribution_iv=condor.get("atm_iv") or max(
                    _num((condor.get("put_leg_short") or {}).get("iv"), 0.0) or 0.0,
                    _num((condor.get("call_leg_short") or {}).get("iv"), 0.0) or 0.0,
                ),
                entry_cashflow=condor.get("credit"),
                legs=_probability_legs(condor),
                # These structures are managed, not held. Severson takes profit
                # well before expiration and the plan below reassesses at 21 DTE,
                # so the odds that actually describe the trade are the odds at
                # the close it specifies — roughly half to two-thirds of the way
                # through the cycle. Expiration is still appended by the
                # scheduler, so both readings are available and the UI can label
                # which is which instead of implying the trade runs to the end.
                exit_points=early_close_exits(condor.get("dte")) + [
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
                    {
                        "kind": "ex_dividend",
                        "label": "Exit before ex-dividend",
                        "exit_date": (
                            _parse_date((management or {}).get("close_before"))
                            - timedelta(days=1)
                        ).isoformat()
                        if _parse_date((management or {}).get("close_before"))
                        else None,
                    },
                ],
                risk_free_rate=RISK_FREE,
                dividend_yield=div_yield,
                return_capture=True,
            )
            condor = {
                **condor,
                "management": management,
                "probability_schedule": probability_schedule,
                "profit_capture": profit_capture,
            }

        if condor and not condor.get("constraints_relaxed"):
            chain_status = "actionable"
            watchlist_reason = None
        elif condor:
            chain_status = "constraints_relaxed"
            if condor.get("uses_last_trade_prices"):
                watchlist_reason = (
                    "Recent trades keep the structure available for after-hours "
                    "analysis, but live bid/ask must be verified before trading."
                )
            else:
                watchlist_reason = (
                    "A live structure was found, but it missed at least one selected "
                    "credit, cushion, balance, liquidity, or execution limit."
                )
        elif ticker in chain_target_tickers:
            chain_status = "unavailable"
            watchlist_reason = (
                "Both chains were checked, but no fully quotable four-leg condor "
                "was available."
            )
        else:
            chain_status = "not_priced"
            watchlist_reason = (
                "This range candidate ranked outside the live-chain pricing "
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
            "expected_move_pct": _round(tech.get("expected_move_pct")),
            "drift_sigma": _round(tech.get("drift_sigma"), 2),
            "drift_direction": tech.get("drift_direction"),
            "efficiency_ratio": _round(tech.get("efficiency_ratio"), 3),
            "variance_ratio": _round(tech.get("variance_ratio"), 3),
            "range_high": _round(tech.get("range_high")),
            "range_low": _round(tech.get("range_low")),
            "range_width_pct": _round(tech.get("range_width_pct"), 1),
            "range_position_pct": _round(tech.get("range_position_pct"), 1),
            "drawdown_pct": _round(tech.get("drawdown_pct")),
            "rel_strength_pct": _round(tech.get("rel_strength_pct")),
            "beta": _round(tech.get("beta")),
            "rsi_14": _round(tech.get("rsi_14"), 1),
            "pct_of_52w_range": _round(tech.get("pct_of_52w_range"), 1),
            "above_52w_low_pct": _round(tech.get("above_52w_low_pct"), 1),
            "week52_high": _round(tech.get("week52_high")),
            "week52_low": _round(tech.get("week52_low")),
            "sma_20": _round(tech.get("sma_20")),
            "sma_50": _round(tech.get("sma_50")),
            "sma_200": _round(tech.get("sma_200")),
            "sma20_slope_pct": _round(tech.get("sma20_slope_pct"), 2),
            "sma50_slope_pct": _round(tech.get("sma50_slope_pct"), 2),
            "ma_slope_abs": _round(tech.get("ma_slope_abs"), 2),
            "ma_spread_pct": _round(tech.get("ma_spread_pct"), 2),
            "dist_from_sma50_pct": _round(tech.get("dist_from_sma50_pct"), 1),
            "fresh_high": tech.get("fresh_high"),
            "fresh_low": tech.get("fresh_low"),
            "rv_10": _round(tech.get("rv_10"), 3),
            "rv_30": _round(tech.get("rv_30"), 3),
            "rv_60": _round(tech.get("rv_60"), 3),
            "rv_252": _round(tech.get("rv_252"), 3),
            "rv_contraction": _round(tech.get("rv_contraction"), 2),
            "avg_dollar_volume": _num(tech.get("avg_dollar_volume")),
            "next_earnings": fund.get("next_earnings"),
            "spread": _round_condor(condor),
            "chain_status": chain_status,
            "watchlist_reason": watchlist_reason,
            "stock_scores": stock_scores,
            "iv_rank": _round(true_iv_rank, 1),
            "iv_rank_effective": _round(effective_iv_rank, 1),
            "iv_rank_source": (
                "history" if true_iv_rank is not None
                else "rv_percentile_proxy" if effective_iv_rank is not None
                else "warming_up"
            ),
            "iv_rank_observations": int(history.get("observations") or 0),
            **rating,
        }
        # The compact Samurai-style filters belong to the separate General
        # Option Scanner. The original Iron Condor screen keeps its existing
        # filter contract; only its candidate construction is broadened.
        filter_reasons = (
            _samurai_filter_reasons(row, p)
            if condor and bool(p.get("general_scanner_mode", False))
            else []
        )
        row["filter_reasons"] = filter_reasons
        if filter_reasons:
            if row["chain_status"] == "actionable":
                row["chain_status"] = "filters_missed"
                row["watchlist_reason"] = "; ".join(filter_reasons)
            elif row.get("watchlist_reason"):
                row["watchlist_reason"] += " Compact filters: " + "; ".join(filter_reasons)
            row["flags"] = list(dict.fromkeys([
                *(row.get("flags") or []), "Compact filters missed",
            ]))
        row["verdict"] = build_verdict(row)
        rows.append(row)

    actionable_rows, watchlist_rows = _partition_candidate_rows(rows, max_results)

    return {
        "rows": actionable_rows,
        "watchlist_rows": watchlist_rows,
        "stats": {
            "universe": len(tickers),
            "priced": priced,
            "passed_price": len(price_pass),
            "passed_fundamentals": passed_fundamentals,
            "chains_fetched": sum(1 for v in condors.values() if v),
            "dropped_for_earnings": dropped_for_earnings,
            "final": len(actionable_rows),
            "actionable": len(actionable_rows),
            "watchlist": len(watchlist_rows),
            "watchlist_relaxed": sum(
                1 for r in watchlist_rows if r.get("chain_status") == "constraints_relaxed"
            ),
            "samurai_filtered": sum(
                1 for r in watchlist_rows if r.get("chain_status") == "filters_missed"
            ),
            "watchlist_earnings": sum(
                1 for r in watchlist_rows if r.get("chain_status") == "earnings"
            ),
            "watchlist_unavailable": sum(
                1 for r in watchlist_rows if r.get("chain_status") == "unavailable"
            ),
            "watchlist_unpriced": sum(
                1 for r in watchlist_rows if r.get("chain_status") == "not_priced"
            ),
        },
        "params": {
            "universe": p["universe"], "lookback_days": lookback,
            "include_stocks": bool(p["include_stocks"]),
            "include_index_etfs": bool(p["include_index_etfs"]),
            "include_sector_etfs": bool(p["include_sector_etfs"]),
            "include_commodity_etfs": bool(p["include_commodity_etfs"]),
            "min_market_cap": min_cap, "fund_min_aum": fund_min_aum,
            "min_avg_dollar_volume": min_adv,
            "max_efficiency_ratio": max_er, "max_drift_sigma": max_drift,
            "max_variance_ratio": max_vr, "max_ma_slope_pct": max_slope,
            "min_rsi": min_rsi, "max_rsi": max_rsi,
            "max_rel_strength_pct": max_strength,
            "min_range_position_pct": min_pos, "max_range_position_pct": max_pos,
            "exclude_leveraged_funds": bool(p["exclude_leveraged_funds"]),
            "exclude_fresh_extremes": bool(p["exclude_fresh_extremes"]),
            "exclude_earnings_before_expiry": bool(p["exclude_earnings_before_expiry"]),
            "earnings_buffer_days": earnings_buffer,
            "target_dte": target_dte, "min_dte": min_dte, "max_dte": max_dte,
            "short_delta": short_delta, "long_delta": long_delta,
            "delta_tolerance": delta_tol,
            "min_width_pct": min_width, "max_width_pct": max_width,
            "min_credit_pct_of_width": min_credit,
            "min_cushion_sigma": min_cushion_sig, "min_otm_pct": min_otm,
            "max_wing_skew_pct": max_skew, "max_delta_gap": max_gap,
            "min_open_interest": min_oi, "max_exec_cost_pct": max_exec,
            "chain_limit": chain_limit,
            "max_structures_per_ticker": max_structures_per_ticker,
            "min_total_option_volume": _num(p.get("min_total_option_volume")),
            "min_iv_rank": _num(p.get("min_iv_rank")),
            "min_prob_max_profit": _num(p.get("min_prob_max_profit")),
            "max_prob_max_loss": _num(p.get("max_prob_max_loss")),
            "require_positive_expected_value": bool(p.get("require_positive_expected_value")),
            "max_abs_position_delta": _num(p.get("max_abs_position_delta")),
            "require_balanced_shape": bool(p.get("require_balanced_shape")),
            "min_max_profit_dollars": _num(p.get("min_max_profit_dollars")),
            "max_max_loss_dollars": _num(p.get("max_max_loss_dollars")),
            "min_profit_ratio_pct": _num(p.get("min_profit_ratio_pct")),
            "stock_score_fundamental_min": _num(p.get("stock_score_fundamental_min")),
            "stock_score_fundamental_max": _num(p.get("stock_score_fundamental_max")),
            "stock_score_growth_min": _num(p.get("stock_score_growth_min")),
            "stock_score_growth_max": _num(p.get("stock_score_growth_max")),
            "stock_score_technical_min": _num(p.get("stock_score_technical_min")),
            "stock_score_technical_max": _num(p.get("stock_score_technical_max")),
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def _round_condor(condor: dict | None) -> dict | None:
    if not condor:
        return None
    out = dict(condor)
    for key, decimals in (
        ("put_long_strike", 2), ("put_short_strike", 2),
        ("call_short_strike", 2), ("call_long_strike", 2),
        ("put_width", 2), ("call_width", 2), ("max_wing", 2), ("wing_skew_pct", 1),
        ("put_credit", 2), ("call_credit", 2), ("put_share_of_credit_pct", 0),
        ("credit", 2), ("entry_cashflow", 2), ("entry_credit", 2),
        ("entry_debit", 2), ("natural_credit", 2), ("natural_cashflow", 2),
        ("credit_pct_of_width", 1), ("max_profit_pct_of_range", 1),
        ("entry_debit_pct_of_max_loss", 1),
        ("max_profit", 2), ("max_loss", 2), ("reward_risk", 2),
        ("return_on_risk_pct", 1), ("annualized_return_on_risk_pct", 1),
        ("lower_breakeven", 2), ("upper_breakeven", 2),
        ("profit_zone_width_pct", 1), ("put_otm_pct", 1), ("call_otm_pct", 1),
        ("lower_cushion_pct", 1), ("upper_cushion_pct", 1),
        ("lower_cushion_sigma", 2), ("upper_cushion_sigma", 2),
        ("min_cushion_sigma", 2), ("expected_move_pct_life", 1),
        ("prob_max_profit", 1), ("prob_profit", 1), ("prob_max_loss", 1),
        ("prob_touch_put", 1), ("prob_touch_call", 1),
        ("fair_credit", 2), ("premium_edge", 2), ("premium_edge_pct", 1),
        ("expected_value_dollars", 0),
        ("delta_gap", 3), ("structure_delta", 3),
        ("target_delta_error", 3),
        ("exec_cost", 2), ("exec_cost_pct", 1), ("atm_iv", 4),
        ("total_option_volume", 0),
        ("credit_dollars", 0), ("entry_cashflow_dollars", 0),
        ("entry_credit_dollars", 0), ("entry_debit_dollars", 0),
        ("max_profit_dollars", 0), ("max_loss_dollars", 0),
    ):
        if key in out:
            out[key] = _round(out[key], decimals)
    for leg_name in ("put_leg_short", "put_leg_long", "call_leg_short", "call_leg_long"):
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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def register_routes(app):

    @app.route("/api/options/iron-condor-scan/universes", methods=["GET"])
    def iron_condor_scan_universes():
        return jsonify(
            universes=[
                {
                    "id": key,
                    "label": val["label"],
                    "count": len(val["tickers"]) if val["tickers"] else None,
                }
                for key, val in UNIVERSE_CHOICES.items()
            ],
            defaults=DEFAULTS,
            variants=variant_choices(),
            constructions=[
                {
                    "id": key,
                    "label": spec["label"],
                    "blurb": spec["blurb"],
                    "directional": spec["directional"],
                }
                for key, spec in VARIANTS.items()
            ],
            directions=[
                {"id": "neutral", "label": "Neutral",
                 "blurb": "No opinion — the classic balanced condor."},
                {"id": "bullish", "label": "Bullish",
                 "blurb": "Expecting price up. Sells the call side further out "
                          "and the put side closer in."},
                {"id": "bearish", "label": "Bearish",
                 "blurb": "Expecting price down. Sells the put side further out "
                          "and the call side closer in."},
            ],
        )

    @app.route("/api/options/iron-condor-scan", methods=["POST"])
    def iron_condor_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            payload.setdefault("profile_id", request.args.get("profile_id", type=int))
            payload.setdefault("aggregate_id", request.args.get("aggregate_id", type=int))
            return jsonify(run_iron_condor_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
