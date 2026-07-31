"""Bear put spread (debit vertical) candidate scanner.

The third screen in the options family, and the only one where you *pay* rather
than collect. Buy a higher-strike put, sell a lower-strike put in the same
expiration: the debit is the entire risk, the width minus the debit is the
entire reward, and the trade only pays if the underlying actually falls to the
short strike.

That inversion is the whole design problem, because both obvious screens are
wrong — and each one is wrong by being the *other* scanner's screen:

  * "Buy puts on whatever just crashed" is the Put Selling Scanner's setup read
    backwards. A name down three sigma, printing fresh lows, deeply oversold, is
    where put *sellers* get paid for taking the bounce. Buying downside there
    means paying peak implied vol for the last leg of a move, right where the
    reversal lives. Crash-chasing is to this screen what "overbought" is to the
    covered call screen: the trap that looks like the signal.
  * "Buy puts on whatever looks overbought" is the Covered Call Scanner's setup,
    and it fails the same way that screen fails — the strongest names keep going
    up, and a debit spread bought against momentum expires worthless in full.

What a bear put spread wants is the awkward middle: a breakdown that has already
started but has not finished. Four things at once:

  1. Breakdown      - trend structure has actually turned (price under the
                      50-day, 20 under 50, 50 rolling under the 200) and the name
                      is underperforming the market, with momentum rolling *down*
                      rather than already exhausted. The not-washed-out term is
                      scored as a band, not a ramp: credit peaks around 1-2 sigma
                      of decline and falls away above 2.5, because past that the
                      move this spread is paying for has already happened.
  2. Room to fall   - the payoff is capped at the short strike, so there has to be
                      distance left. A name sitting on its 52-week low has none.
  3. Spread structure - what you actually get for the debit: reward-to-risk, how
                      reachable the short strike is measured in the stock's own
                      expected move, whether the vertical is cheap against that
                      same expected move, and whether the put skew is paying you
                      to sell the lower strike.
  4. Executability  - a vertical crosses two bid/ask spreads, not one. Combined
                      leg slippage against the debit is what quietly turns a
                      2:1 reward-to-risk on paper into 1.3:1 in the account.

The pricing axis is deliberately drift-neutral: the fair value it compares the
debit against assumes the stock goes nowhere, using the stock's own *realized*
volatility rather than the implied vol the market is charging. So it answers
"is this vertical cheap relative to how much this name actually moves?" and
nothing else. The directional view lives in its own axis, which keeps a cheap
spread on a name with no thesis from being paid twice for the same observation.

Stage structure and the caches are shared with put_scanner — including the put
chain cache, so running the Put Selling Scanner and then this one re-uses the
same downloaded chains. The small-cap universe and the held-position lookup come
from call_scanner rather than being duplicated here.

Endpoints:
  GET  /api/options/bear-put-spread-scan/universes
  POST /api/options/bear-put-spread-scan
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from statistics import NormalDist

import numpy as np
import pandas as pd
import yfinance as yf
from flask import jsonify, request

from option_probability import profit_probability_schedule
from options_pricing import black_scholes
from call_scanner import SMALL_CAP_SET, SMALL_CAP_UNIVERSE, held_positions
from put_scanner import (
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
    _ramp,
    _round,
    _ticker_frame,
    _wilder_rsi,
    dividend_yield_for_pricing,
    resolve_universe,
    window_stretch,
)

_NORM = NormalDist()

# ---------------------------------------------------------------------------
# Universes
# ---------------------------------------------------------------------------
# The shared lists plus small caps. Small caps belong here for the same reason
# they belong on the covered call screen and not the put screen — a defined-risk
# debit spread never assigns you into the business, so company quality matters
# far less than it does when you are agreeing to buy the shares. What does matter
# more here is option liquidity, because a vertical has to fill on two legs, so
# the default dollar-volume floor is stricter than either selling screen's.
SPREAD_UNIVERSE_CHOICES = {
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

_SMALL_CAP_CHOICE_IDS = frozenset(k for k in SPREAD_UNIVERSE_CHOICES if k not in UNIVERSE_CHOICES)


def resolve_spread_universe(name: str, custom, profile_id=None, aggregate_id=None) -> list[str]:
    """Universe resolution with the small-cap lists added to the shared ones."""
    if name in _SMALL_CAP_CHOICE_IDS:
        return _clean_tickers(SPREAD_UNIVERSE_CHOICES[name]["tickers"])
    return resolve_universe(name, custom, profile_id=profile_id, aggregate_id=aggregate_id)


# Point budgets. Named so the partial-score denominator cannot drift away from
# what a live chain actually contributes.
STRUCTURE_MAX = 30.0
EXECUTION_MAX = 20.0
EXECUTION_CHAIN_MAX = 12.0    # the part of Executability that needs both legs quoted
PARTIAL_MAX = 100.0 - STRUCTURE_MAX - EXECUTION_CHAIN_MAX

CONTRACT_MULTIPLIER = 100.0


# ---------------------------------------------------------------------------
# Scoring primitives
# ---------------------------------------------------------------------------

def _band(value, rise_lo, rise_hi, fall_lo, fall_hi, points) -> float:
    """Trapezoid: 0 below `rise_lo`, full points across [rise_hi, fall_lo], 0 above `fall_hi`.

    The two selling screens only ever want "more is better", so a straight ramp
    is enough for them. This screen needs a peak in the middle. A decline of one
    to two sigma is a breakdown in progress; four sigma is a finished capitulation
    that put sellers are being paid to buy. Scoring that on a ramp would rank the
    worst entries on the board at the top, which is exactly the mistake this
    screen exists to avoid.
    """
    v = _num(value)
    if v is None:
        return 0.0
    if v <= rise_lo or v >= fall_hi:
        return 0.0
    if v < rise_hi:
        frac = (v - rise_lo) / (rise_hi - rise_lo) if rise_hi > rise_lo else 1.0
    elif v <= fall_lo:
        frac = 1.0
    else:
        frac = (fall_hi - v) / (fall_hi - fall_lo) if fall_hi > fall_lo else 1.0
    return round(max(0.0, min(1.0, frac)) * points, 2)


def prob_below(spot: float, strike: float, T: float, sigma: float,
               r: float = 0.0, q: float = 0.0) -> float | None:
    """Risk-neutral probability the underlying finishes below `strike`, i.e. N(-d2).

    Deliberately not the option's delta, which the two selling screens use as a
    probability proxy. A put's delta is N(-d1) times the carry factor, and since
    d1 always exceeds d2 it sits *below* N(-d2) at every strike — so delta
    understates how often price actually lands past the strike. That is a
    tolerable simplification when the number only labels a short put's odds, but
    here both the probability of profit and the probability of max profit come
    straight off where price lands, so the exact figure is worth the extra line.
    """
    s, k, sd = _num(spot), _num(strike), _num(sigma)
    if not s or not k or not sd or s <= 0 or k <= 0 or sd <= 0 or T <= 0:
        return None
    sqrt_t = math.sqrt(T)
    d2 = (math.log(s / k) + (r - q - 0.5 * sd * sd) * T) / (sd * sqrt_t)
    return _NORM.cdf(-d2)


def strike_for_put_delta(spot: float, target_delta: float, sigma: float, T: float) -> float:
    """Strike whose put delta is about -`target_delta`, from vol and time alone.

    Only used when the chain comes back with no usable implied vols, so no delta
    can be computed per strike. Inverting the Black-Scholes delta is a better
    fallback than a flat "some percent below spot" guess, because it scales with
    the name's own volatility the way the real chain does.
    """
    d = min(0.95, max(0.01, _num(target_delta, 0.5) or 0.5))
    sd = _num(sigma) or 0.0
    if sd <= 0 or T <= 0:
        return spot
    return spot * math.exp(0.5 * sd * sd * T + _NORM.inv_cdf(d) * sd * math.sqrt(T))


def vertical_fair_value(spot: float, long_strike: float, short_strike: float,
                        T: float, sigma: float) -> float | None:
    """Expected payoff of the put spread at expiry under a driftless lognormal.

    Priced at zero rate and zero carry with the stock's own *realized* volatility,
    which makes it an undiscounted expectation rather than a market quote: the
    number the debit has to beat if the vertical is to be cheap relative to how
    far this name actually travels. Using implied vol here instead would make the
    comparison circular — the debit is derived from implied vol, so it would
    always come out fair by construction.
    """
    sd = _num(sigma)
    if not sd or sd <= 0 or T <= 0:
        return None
    try:
        long_leg = black_scholes(spot, long_strike, T, 0.0, 0.0, sd, "put")["price"]
        short_leg = black_scholes(spot, short_strike, T, 0.0, 0.0, sd, "put")["price"]
    except Exception:
        return None
    return max(0.0, long_leg - short_leg)


# ---------------------------------------------------------------------------
# Stage 1 - breakdown technicals
# ---------------------------------------------------------------------------

def _compute_technicals(sub: pd.DataFrame, bench_ret, lookback_days: int) -> dict | None:
    """Per-ticker metrics for a *breakdown in progress*. None when history is thin."""
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
    # window_stretch signs its output for a decline already, which is what this
    # screen wants: positive means it fell that many sigma.
    stretch_sigma = ws["stretch_sigma"]
    decline_pct = -window_pct

    week52_high = _num(close.max())
    week52_low = _num(close.min())
    drawdown_pct = ((price - week52_high) / week52_high * 100.0) if week52_high else None
    above_52w_low_pct = ((price - week52_low) / week52_low * 100.0) if week52_low else None

    pct_of_52w_range = None
    if week52_high and week52_low and week52_high > week52_low:
        pct_of_52w_range = (price - week52_low) / (week52_high - week52_low) * 100.0

    high_idx = int(close.values.argmax())
    days_since_high = max(1, len(close) - 1 - high_idx)

    # Beta, then the part of the decline the market does not explain. A name that
    # only fell because everything fell is not breaking down on its own — and it
    # will bounce with everything else too.
    beta = None
    excess_move_pct = None
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
                excess_move_pct = window_pct - beta * bench_window
    # Positive means it underperformed the beta-adjusted market, which is the
    # direction this screen wants.
    rel_weakness_pct = -excess_move_pct if excess_move_pct is not None else None

    sma_20_s = close.rolling(20).mean()
    sma_50_s = close.rolling(50).mean()
    sma_20 = _num(sma_20_s.iloc[-1]) if len(close) >= 20 else None
    sma_50 = _num(sma_50_s.iloc[-1]) if len(close) >= 50 else None
    sma_200 = _num(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None

    below_sma20 = bool(sma_20 and price < sma_20)
    below_sma50 = bool(sma_50 and price < sma_50)
    sma20_below_sma50 = bool(sma_20 and sma_50 and sma_20 < sma_50)
    sma50_below_sma200 = bool(sma_50 and sma_200 and sma_50 < sma_200)
    below_sma50_pct = ((sma_50 - price) / sma_50 * 100.0) if sma_50 else None
    room_to_sma200_pct = ((price - sma_200) / sma_200 * 100.0) if sma_200 else None

    # How long ago the 50-day gave way. A break that is days old still has the
    # move ahead of it; one that is months old is a trend everybody has priced.
    days_below_sma50 = None
    valid_sma50 = sma_50_s.notna()
    if bool(valid_sma50.any()):
        above_idx = np.where((close.values >= sma_50_s.values) & valid_sma50.values)[0]
        days_below_sma50 = (
            len(close) - 1 - int(above_idx[-1]) if len(above_idx) else int(valid_sma50.sum())
        )

    high_s = sub["High"] if "High" in sub.columns else close
    low_s = sub["Low"] if "Low" in sub.columns else close
    atr14 = _atr(high_s.dropna(), low_s.dropna(), close)
    atr_below_sma50 = None
    if atr14 and atr14 > 0 and sma_50:
        atr_below_sma50 = (sma_50 - price) / atr14

    rv_30 = _num(log_ret.iloc[-30:].std() * math.sqrt(TRADING_DAYS)) if len(log_ret) >= 30 else None
    rv_252 = _num(log_ret.std() * math.sqrt(TRADING_DAYS))

    # Momentum turning over: RSI now against RSI two weeks ago. Falling RSI from a
    # neutral level is a breakdown starting; a low, flat RSI is one already spent.
    rsi_14 = _wilder_rsi(close)
    rsi_prior = _wilder_rsi(close.iloc[:-14]) if len(close) > 30 else None
    rsi_roll_pp = (rsi_14 - rsi_prior) if (rsi_14 is not None and rsi_prior is not None) else None

    # Lower highs: the 10-day high has to sit meaningfully under the 40-day high.
    high_10 = _num(close.iloc[-10:].max())
    high_40 = _num(close.iloc[-40:].max()) if len(close) >= 40 else None
    lower_high = bool(high_10 and high_40 and high_10 < high_40 * 0.98)

    # Washout guards. Both are reasons *not* to buy downside here.
    recent_low = _num(close.iloc[-3:].min())
    fresh_low = bool(week52_low and recent_low and recent_low <= week52_low * 1.005)
    low_10 = _num(close.iloc[-10:].min())
    bounce_off_low_pct = ((price - low_10) / low_10 * 100.0) if low_10 else None

    accel_pp = None
    if len(log_ret) >= 10:
        last5 = (math.exp(float(log_ret.iloc[-5:].sum())) - 1.0) * 100.0
        prior5 = (math.exp(float(log_ret.iloc[-10:-5].sum())) - 1.0) * 100.0
        accel_pp = last5 - prior5     # negative = weakness building

    vol_s = sub["Volume"].dropna() if "Volume" in sub.columns else None
    avg_volume = _num(vol_s.iloc[-30:].mean()) if vol_s is not None and len(vol_s) else None
    avg_dollar_volume = (avg_volume * price) if avg_volume else None

    return {
        "price": price,
        "window_pct": window_pct,
        "decline_pct": decline_pct,
        "expected_move_pct": ws["expected_move_pct"],
        "sigma_daily": sigma_d,
        "stretch_sigma": stretch_sigma,
        "drawdown_pct": drawdown_pct,
        "days_since_high": days_since_high,
        "week52_high": week52_high,
        "week52_low": week52_low,
        "above_52w_low_pct": above_52w_low_pct,
        "pct_of_52w_range": pct_of_52w_range,
        "beta": beta,
        "excess_move_pct": excess_move_pct,
        "rel_weakness_pct": rel_weakness_pct,
        "rsi_14": rsi_14,
        "rsi_roll_pp": rsi_roll_pp,
        "sma_20": sma_20,
        "sma_50": sma_50,
        "sma_200": sma_200,
        "below_sma20": below_sma20,
        "below_sma50": below_sma50,
        "sma20_below_sma50": sma20_below_sma50,
        "sma50_below_sma200": sma50_below_sma200,
        "below_sma50_pct": below_sma50_pct,
        "room_to_sma200_pct": room_to_sma200_pct,
        "days_below_sma50": days_below_sma50,
        "atr_14": atr14,
        "atr_below_sma50": atr_below_sma50,
        "rv_30": rv_30,
        "rv_252": rv_252,
        "lower_high": lower_high,
        "fresh_low": fresh_low,
        "bounce_off_low_pct": bounce_off_low_pct,
        "accel_pp": accel_pp,
        "avg_volume": avg_volume,
        "avg_dollar_volume": avg_dollar_volume,
    }


# ---------------------------------------------------------------------------
# Stage 3 - the spread itself
# ---------------------------------------------------------------------------

def _quotable(leg: dict) -> bool:
    """Both sides of the market are live and uncrossed.

    Stricter than the selling screens need. They only sell one contract, so a
    live bid is enough. A vertical has to buy the long leg at the ask *and* sell
    the short leg at the bid, so a one-sided or crossed quote on either leg makes
    the whole debit fictional.
    """
    bid, ask, mid = _num(leg.get("bid")), _num(leg.get("ask")), _num(leg.get("mid"))
    return bool(bid and ask and mid and bid > 0 and ask >= bid and mid > 0)


def _delta_pool(legs: list[dict], target: float, tolerance: float, spot: float,
                sigma: float, T: float) -> list[dict]:
    """Legs whose |delta| is within `tolerance` of `target`, widening if empty."""
    with_delta = [l for l in legs if l.get("delta") is not None]
    if with_delta:
        for tol in (tolerance, tolerance * 1.6, tolerance * 2.5):
            pool = [l for l in with_delta if abs(abs(l["delta"]) - target) <= tol]
            if pool:
                return pool
        # Nothing near the target at all — fall back to the closest single strike
        # so the caller still gets a spread instead of nothing.
        return [min(with_delta, key=lambda l: abs(abs(l["delta"]) - target))]

    # No usable implied vols anywhere in the chain: place the leg by moneyness
    # derived from the name's own volatility.
    want = strike_for_put_delta(spot, target, sigma, T)
    ordered = sorted(legs, key=lambda l: abs(l["strike"] - want))
    return ordered[:3]


def _pair_quality(rr: float, edge_pct: float | None, required_sigma: float | None,
                  exec_cost_pct: float | None, oi_min: int) -> float:
    """Rank candidate strike pairs on one underlying.

    Deliberately simpler than `score_candidate`: every pair here shares the same
    technicals, so this only has to arbitrate the structural trade-off between a
    wide, cheap spread that needs a big move and a narrow, expensive one that
    barely needs any. Reward-to-risk and reachability pull in opposite
    directions by construction, which is what puts the winner in the middle.
    """
    q = _ramp(rr, 1.0, 3.0, 30)
    q += _ramp(edge_pct, -15, 40, 30)
    q += _band(required_sigma, 0.15, 0.65, 1.10, 2.20, 25)
    # A cheap fill scores; the ramp is written on the negated cost so the usual
    # "more is better" direction still holds.
    q += _ramp(-(exec_cost_pct if exec_cost_pct is not None else 60.0), -40, -8, 10)
    q += _ramp(oi_min, 25, 500, 5)
    return q


def _build_pair(long_leg: dict, short_leg: dict, spot: float, dte: int, T: float,
                forecast_vol: float | None, div_yield: float) -> dict | None:
    """All the numbers for one (long, short) strike pair, or None if unusable."""
    long_strike, short_strike = long_leg["strike"], short_leg["strike"]
    width = long_strike - short_strike
    if width <= 0:
        return None

    long_mid, short_mid = long_leg["mid"], short_leg["mid"]
    debit = long_mid - short_mid
    # A non-positive debit or one above the width is bad chain data, not free
    # money: the higher strike of a put spread is always worth more.
    if debit <= 0 or debit >= width:
        return None

    max_profit = width - debit
    rr = max_profit / debit
    breakeven = long_strike - debit

    # What it costs if both legs fill at the worst side of their quotes, which is
    # the number that decides whether a paper 2:1 survives the fill.
    debit_worst = long_leg["ask"] - short_leg["bid"]
    exec_cost = (long_leg["ask"] - long_leg["bid"]) + (short_leg["ask"] - short_leg["bid"])
    exec_cost_pct = (exec_cost / debit * 100.0) if debit > 0 else None

    # How far the stock has to travel, expressed in its own expected move over the
    # life of the trade. This is the number that separates a plausible target from
    # a lottery ticket, and it is why a raw percentage is not enough: 8% is
    # nothing for a semiconductor and a long way for a utility.
    sigma_T = (forecast_vol * math.sqrt(T)) if (forecast_vol and forecast_vol > 0 and T > 0) else None
    required_move_pct = (spot - short_strike) / spot * 100.0
    breakeven_move_pct = (spot - breakeven) / spot * 100.0
    required_sigma = breakeven_sigma = None
    if sigma_T and sigma_T > 0:
        if short_strike > 0:
            required_sigma = -math.log(short_strike / spot) / sigma_T
        if breakeven > 0:
            breakeven_sigma = -math.log(breakeven / spot) / sigma_T

    # Probabilities from the chain's own implied vol: what the market thinks.
    pricing_iv = long_leg["iv"] if long_leg["iv"] > 0 else (short_leg["iv"] or 0.0)
    pop = prob_below(spot, breakeven, T, pricing_iv, RISK_FREE, div_yield)
    prob_max = prob_below(spot, short_strike, T, pricing_iv, RISK_FREE, div_yield)

    # Fair value from the stock's own realized vol: what the tape says. The gap
    # between the two is the edge the screen is actually hunting.
    fair = vertical_fair_value(spot, long_strike, short_strike, T, forecast_vol)
    edge = (fair - debit) if fair is not None else None
    edge_pct = (edge / debit * 100.0) if (edge is not None and debit > 0) else None

    skew_ratio = None
    if long_leg["iv"] > 0 and short_leg["iv"] > 0:
        skew_ratio = short_leg["iv"] / long_leg["iv"]

    oi_min = min(long_leg["open_interest"], short_leg["open_interest"])
    vol_min = min(long_leg["volume"], short_leg["volume"])

    return {
        "long_strike": long_strike,
        "short_strike": short_strike,
        "width": width,
        "debit": debit,
        "debit_worst_case": debit_worst,
        "debit_pct_of_width": debit / width * 100.0,
        "max_profit": max_profit,
        "max_loss": debit,
        "reward_risk": rr,
        "breakeven": breakeven,
        "required_move_pct": required_move_pct,
        "breakeven_move_pct": breakeven_move_pct,
        "required_move_sigma": required_sigma,
        "breakeven_move_sigma": breakeven_sigma,
        "expected_move_pct_life": (sigma_T * 100.0) if sigma_T else None,
        "prob_profit": (pop * 100.0) if pop is not None else None,
        "prob_max_profit": (prob_max * 100.0) if prob_max is not None else None,
        "fair_value": fair,
        "edge": edge,
        "edge_pct": edge_pct,
        "skew_ratio": skew_ratio,
        "exec_cost": exec_cost,
        "exec_cost_pct": exec_cost_pct,
        "open_interest_min": oi_min,
        "volume_min": vol_min,
        # Per-contract dollars, which is how the trade is actually sized.
        "debit_dollars": debit * CONTRACT_MULTIPLIER,
        "max_profit_dollars": max_profit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": debit * CONTRACT_MULTIPLIER,
        # What the outright put would have cost, and what the short leg saves.
        "outright_cost": long_mid,
        "cost_saving_pct": (1.0 - debit / long_mid) * 100.0 if long_mid > 0 else None,
        "long_leg": {
            "strike": long_strike, "bid": long_leg["bid"], "ask": long_leg["ask"],
            "mid": long_mid, "iv": long_leg["iv"], "delta": long_leg["delta"],
            "open_interest": long_leg["open_interest"], "volume": long_leg["volume"],
        },
        "short_leg": {
            "strike": short_strike, "bid": short_leg["bid"], "ask": short_leg["ask"],
            "mid": short_mid, "iv": short_leg["iv"], "delta": short_leg["delta"],
            "open_interest": short_leg["open_interest"], "volume": short_leg["volume"],
        },
    }


def _suggest_spread(ticker: str, spot: float, div_yield: float, forecast_vol: float | None,
                    target_dte: int, min_dte: int, max_dte: int,
                    long_delta: float = 0.50, short_delta: float = 0.25,
                    delta_tolerance: float = 0.15,
                    min_width_pct: float = 2.0, max_width_pct: float = 20.0,
                    max_debit_pct_of_width: float = 55.0,
                    min_reward_risk: float = 1.0, max_required_sigma: float = 2.5,
                    earnings_date: str | None = None,
                    earnings_buffer_days: int = 5) -> dict | None:
    """Best bear put spread on one underlying, from the live chain.

    Enumerates plausible (long, short) strike pairs rather than mechanically
    taking "the 50-delta and the 25-delta". A vertical has two free parameters
    that trade against each other — pay more for a nearer target, or less for a
    further one — and which end of that trade-off is right depends on the chain's
    skew and liquidity, not on a rule of thumb.
    """
    try:
        expirations = list(yf.Ticker(ticker).options or [])
    except Exception:
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

    puts = _load_put_chain(ticker, expiration, spot, div_yield)
    if not puts:
        return None

    dte_eff = max(dte or 1, 1)
    T = dte_eff / 365.0

    legs = [p for p in puts if _quotable(p)]
    if len(legs) < 2:
        return None

    long_pool = _delta_pool(legs, long_delta, delta_tolerance, spot, forecast_vol or 0.0, T)
    short_pool = _delta_pool(legs, short_delta, delta_tolerance, spot, forecast_vol or 0.0, T)

    lo_w = spot * max(0.0, min_width_pct) / 100.0
    hi_w = spot * max(min_width_pct, max_width_pct) / 100.0

    passing, all_pairs = [], []
    for long_leg in long_pool:
        for short_leg in short_pool:
            pair = _build_pair(long_leg, short_leg, spot, dte_eff, T, forecast_vol, div_yield)
            if pair is None:
                continue
            if pair["width"] < lo_w or pair["width"] > hi_w:
                continue
            all_pairs.append(pair)
            if pair["debit_pct_of_width"] > max_debit_pct_of_width:
                continue
            if pair["reward_risk"] < min_reward_risk:
                continue
            rs = pair["required_move_sigma"]
            if rs is not None and rs > max_required_sigma:
                continue
            passing.append(pair)

    # Falling back rather than returning nothing mirrors how the covered call
    # screen handles an unreachable cost-basis floor: show the trade and say the
    # constraint could not be met, instead of hiding the candidate.
    pool = passing or all_pairs
    if not pool:
        return None

    best = max(pool, key=lambda p: _pair_quality(
        p["reward_risk"], p["edge_pct"], p["required_move_sigma"],
        p["exec_cost_pct"], p["open_interest_min"],
    ))

    # At-the-money IV for the IV/RV comparison, off the whole chain rather than
    # the chosen strikes, so skew does not contaminate the vol-level reading.
    atm = min(puts, key=lambda p: abs(p["strike"] - spot))
    atm_iv = atm["iv"] if atm["iv"] > 0 else best["long_leg"]["iv"]

    expiry_d = datetime.strptime(expiration, "%Y-%m-%d").date()
    return {
        **best,
        "expiration": expiration,
        "dte": dte,
        "atm_iv": atm_iv,
        "constraints_relaxed": not passing,
        "pairs_considered": len(all_pairs),
        "earnings_date": earnings_d.isoformat() if earnings_d else None,
        "avoids_earnings": cleared if earnings_d else None,
        "days_earnings_after_expiry": (earnings_d - expiry_d).days if earnings_d else None,
    }


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_candidate(tech: dict, fund: dict, spread: dict | None,
                    earnings_buffer_days: int = 5) -> dict:
    """Rate a name as a bear put spread candidate on four independent axes.

    Breakdown     (30) - has the trend actually turned, without being spent?
    Room to fall  (20) - is there downside distance left for the payoff to reach?
    Structure     (30) - is the vertical priced well for what it has to achieve?
    Executability (20) - can two legs actually be filled at anything like the mid?
    """
    flags: list[str] = []

    # ── Breakdown ─────────────────────────────────────────────────────────
    breakdown = 0.0

    # Trend structure (12). Plain facts about where price sits, because a
    # breakdown that has not broken any structure is just a dip.
    if tech.get("below_sma50"):
        breakdown += 4
    if tech.get("sma20_below_sma50"):
        breakdown += 3
    if tech.get("sma50_below_sma200"):
        breakdown += 3
    days_below = _num(tech.get("days_below_sma50"))
    if days_below is not None and 0 < days_below <= 15:
        breakdown += 2      # the break is fresh, so the move is still ahead
    elif days_below is not None and days_below > 120:
        flags.append("Downtrend already months old")

    # Relative weakness (8) — the most durable bearish signal there is.
    breakdown += _ramp(tech.get("rel_weakness_pct"), 1, 12, 8)

    # Momentum turning over (6). Falling RSI, not low RSI: a low flat reading is
    # a move that has already been made.
    roll = _num(tech.get("rsi_roll_pp"))
    breakdown += _ramp(-(roll if roll is not None else 0.0), 3, 20, 4)
    if tech.get("lower_high"):
        breakdown += 2

    # Not washed out (4) — the band, not a ramp. See _band.
    breakdown += _band(tech.get("stretch_sigma"), 0.0, 0.9, 2.0, 3.5, 4)
    rsi = _num(tech.get("rsi_14"))
    if rsi is not None and rsi <= 30:
        flags.append("Already deeply oversold — bounce risk")
    if tech.get("fresh_low"):
        flags.append("Making fresh 52-week lows")
    bounce = _num(tech.get("bounce_off_low_pct"))
    if bounce is not None and bounce >= 8:
        flags.append("Sharp bounce off the recent low")

    # ── Room to fall ──────────────────────────────────────────────────────
    room = 0.0
    room += _ramp(tech.get("above_52w_low_pct"), 5, 40, 8)
    room += _ramp(tech.get("pct_of_52w_range"), 25, 80, 6)
    # Fallen a little, not a lot: the payoff is capped, so most of the move
    # needs to still be available.
    room += _band(-(_num(tech.get("drawdown_pct")) or 0.0), 0.0, 6.0, 25.0, 50.0, 6)

    # ── Structure ─────────────────────────────────────────────────────────
    structure = 0.0
    iv_rv = None
    if spread:
        atm_iv = _num(spread.get("atm_iv"))
        rv30 = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        if atm_iv and rv30 and rv30 > 0:
            iv_rv = atm_iv / rv30

        # Reward to risk (9). 50% of the width is 1:1; 25% of it is 3:1.
        structure += _ramp(spread.get("reward_risk"), 1.0, 3.0, 9)
        # Reachability (8). The band peaks where the short strike is roughly
        # three-quarters of one expected move away — close enough to be a real
        # target, far enough that the spread is not already priced as done.
        structure += _band(spread.get("required_move_sigma"), 0.15, 0.65, 1.10, 2.20, 8)
        # Modelled edge (8). Cheap against the name's own realized volatility.
        # This is also where a rich IV is punished, which is why there is no
        # separate IV/RV term: a debit priced off inflated implied vol simply
        # fails to beat the realized-vol fair value.
        structure += _ramp(spread.get("edge_pct"), -15, 40, 8)
        # Skew (5). A steep put skew is the one structural gift a bear put spread
        # gets: the lower strike you sell carries the fatter implied vol.
        # The ceiling is 1.12, not something rounder like 1.25, because that is
        # what the skew between a 50-delta and a 25-delta put actually measures on
        # real chains — around 1.00-1.10 for single names and a little steeper for
        # index funds. A ramp to 1.25 would leave these five points permanently
        # unreachable, which is the same as not scoring skew at all.
        structure += _ramp(spread.get("skew_ratio"), 1.0, 1.12, 5)

        if (spread.get("debit_pct_of_width") or 0) > 50:
            flags.append("Debit over half the width")
        rs = _num(spread.get("required_move_sigma"))
        if rs is not None and rs > 2.0:
            flags.append("Short strike needs an outsized move")
        if (spread.get("edge_pct") or 0) < 0:
            flags.append("Priced above realized-vol fair value")
        if iv_rv is not None and iv_rv > 1.25:
            flags.append("Implied vol rich — expensive to buy")
        if spread.get("constraints_relaxed"):
            flags.append("No pair met the debit and reward filters")

    # ── Executability ─────────────────────────────────────────────────────
    execution = 0.0
    ticker = tech.get("ticker") or ""
    is_fund = _is_fund(fund, ticker)
    fund_kind = _fund_kind(ticker, fund) if is_fund else None
    size = _fund_size(fund) or 0.0

    # Size (4). Judged lightly: a defined-risk debit spread never assigns you
    # into the underlying, so what matters is that its option market is real.
    if size >= 50e9:
        execution += 4
    elif size >= 10e9:
        execution += 3.5
    elif size >= 2e9:
        execution += 2.5
    elif size >= 500e6:
        execution += 1.5
    else:
        execution += 0.5
        flags.append("Small underlying")

    if is_fund and fund_kind == "leveraged":
        flags.append("Leveraged or inverse fund")

    # Share liquidity (4) — the proxy for how tight the chain will be.
    adv = _num(tech.get("avg_dollar_volume")) or 0.0
    if adv >= 200e6:
        execution += 4
    elif adv >= 50e6:
        execution += 3.2
    elif adv >= 20e6:
        execution += 2.4
    elif adv >= 5e6:
        execution += 1.2
    else:
        flags.append("Thin share liquidity")

    if spread:
        # Combined leg slippage (7). The single most under-appreciated cost in a
        # defined-risk vertical: two spreads to cross, both out of the debit.
        cost_pct = _num(spread.get("exec_cost_pct"))
        execution += _ramp(-(cost_pct if cost_pct is not None else 60.0), -40, -8, 7)
        if cost_pct is not None and cost_pct > 25:
            flags.append("Leg slippage eats the edge")

        # Open interest on the weaker leg (5). A vertical is only as liquid as
        # its thinner side, since closing it needs both legs.
        oi = int(_num(spread.get("open_interest_min"), 0) or 0)
        if oi >= 1000:
            execution += 5
        elif oi >= 500:
            execution += 4
        elif oi >= 200:
            execution += 3
        elif oi >= 50:
            execution += 1.5
        else:
            flags.append("Thin open interest on one leg")

    # ── Event risk ────────────────────────────────────────────────────────
    # An earnings report inside a bearish debit spread is a coin flip you have
    # already paid a premium for: the pre-announcement implied vol is what made
    # the debit expensive, and the gap is as likely to go the wrong way.
    earnings_before_expiry = None
    earnings_date = _parse_date(fund.get("next_earnings"))
    expiry_date = _parse_date(spread["expiration"]) if spread else None
    if earnings_date and expiry_date:
        earnings_before_expiry = earnings_date <= expiry_date
        gap = (earnings_date - expiry_date).days
        if earnings_before_expiry:
            flags.append("Earnings before expiration")
            structure = max(0.0, structure - 6)
        elif gap <= earnings_buffer_days:
            flags.append(f"Earnings {gap}d after expiry")

    price = _num(tech.get("price"))
    sma200 = _num(tech.get("sma_200"))
    if price and sma200 and price < sma200 * 0.75:
        flags.append("Far below the 200-day average")

    total = breakdown + room + structure + execution
    # Without a chain the Structure axis and most of Executability cannot score,
    # so rate on what was scorable. That inflates the normalized number rather
    # than deflating it, which is why run_spread_scan ranks unpriced rows below
    # every priced one instead of letting the smaller denominator float them up.
    scored_max = 100.0 if spread else PARTIAL_MAX
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
        "score": round(normalized, 1),
        "grade": grade,
        "components": {
            "breakdown": round(breakdown, 1),
            "room": round(room, 1),
            "structure": round(structure, 1),
            "execution": round(execution, 1),
        },
        "component_max": {
            "breakdown": 30, "room": 20, "structure": 30, "execution": 20,
        },
        "iv_rv_ratio": _round(iv_rv, 2),
        "earnings_before_expiry": earnings_before_expiry,
        "days_to_earnings": (earnings_date - date.today()).days if earnings_date else None,
        "is_fund": is_fund,
        "fund_kind": fund_kind,
        "flags": flags,
        "scored_on_partial": spread is None,
    }


# ---------------------------------------------------------------------------
# Trade management
# ---------------------------------------------------------------------------

def recommend_plan(spread: dict | None, rating: dict | None, tech: dict | None = None) -> dict | None:
    """Exit plan for a debit vertical: profit target, stop, time stop, invalidation.

    The two selling screens manage one number — how much of the credit to keep.
    A debit spread has four decisions, and the last one is the important one:

      * Profit target, expressed as a share of *max profit* rather than of the
        credit, since there is no credit. Held to expiry the last slice of the
        payoff requires the stock to sit still through the widest gamma of the
        trade, which is a poor use of the remaining days.
      * Stop, even though the risk is already defined. Recovering half the debit
        funds the next attempt; riding a defined-risk loser to zero does not.
      * Time stop. A directional debit spread that has not worked by the time
        theta bites is a wrong thesis, not an early one.
      * Invalidation price. The thesis here is technical, so the level that kills
        it is a price, not a date: a close back above the nearest moving average
        the breakdown just lost.
    """
    if not spread:
        return None
    debit = _num(spread.get("debit"))
    max_profit = _num(spread.get("max_profit"))
    if debit is None or debit <= 0 or max_profit is None or max_profit <= 0:
        return None

    rating = rating or {}
    score = _num(rating.get("score"), 0.0) or 0.0
    grade = str(rating.get("grade") or "")
    rr = _num(spread.get("reward_risk"), 0.0) or 0.0
    edge_pct = _num(spread.get("edge_pct"))
    dte_raw = _num(spread.get("dte"))
    dte = max(1, int(dte_raw)) if dte_raw is not None else 1
    # `or` would misread a genuinely tight 0% cost as the worst case.
    cost_pct = _num(spread.get("exec_cost_pct"))
    if cost_pct is None:
        cost_pct = 100.0
    oi = int(_num(spread.get("open_interest_min"), 0) or 0)
    flags = set(rating.get("flags") or [])
    material_risk_flags = {
        "Making fresh 52-week lows",
        "Already deeply oversold — bounce risk",
        "Sharp bounce off the recent low",
        "Earnings before expiration",
        "Leg slippage eats the edge",
        "Thin open interest on one leg",
        "Priced above realized-vol fair value",
        "No pair met the debit and reward filters",
        "Short strike needs an outsized move",
    }
    has_material_risk = bool(flags & material_risk_flags)

    if (
        grade == "A"
        and score >= 80
        and rr >= 2.0
        and edge_pct is not None
        and edge_pct >= 10
        and dte >= 35
        and cost_pct <= 12
        and oi >= 500
        and not has_material_risk
    ):
        target_capture_pct, stop_pct = 75.0, 50.0
        profile = "Strong setup"
        rationale = (
            "A high setup score, better than 2:1 reward to risk, and a tight "
            "two-leg market support holding for 75% of the maximum payoff."
        )
    elif (
        grade in {"A", "B"}
        and score >= 70
        and rr >= 1.5
        and cost_pct <= 20
        and not has_material_risk
    ):
        target_capture_pct, stop_pct = 65.0, 50.0
        profile = "Balanced setup"
        rationale = (
            "A 65% target takes most of the payoff without needing the stock to "
            "sit still through the last and most gamma-sensitive stretch."
        )
    else:
        target_capture_pct, stop_pct = 50.0, 40.0
        profile = "Defensive setup"
        rationale = (
            "The thesis or the two-leg market carries added risk, so this takes "
            "half the maximum payoff and cuts the loss sooner."
        )

    # The spread's own value: sell it back for the debit plus a share of the gain.
    target_price = round(debit + max_profit * target_capture_pct / 100.0, 2)
    stop_price = max(0.01, round(debit * (1.0 - stop_pct / 100.0), 2))
    # A debit spread needs the move to have happened before theta takes over.
    reassess_dte = 21 if dte > 35 else max(7, int(round(dte * 0.5)))

    # The nearest overhead average is what the breakdown has to fail to reclaim.
    invalidate_price = None
    invalidate_label = None
    price = _num((tech or {}).get("price"))
    for level, label in (
        (_num((tech or {}).get("sma_20")), "20-day average"),
        (_num((tech or {}).get("sma_50")), "50-day average"),
    ):
        if level and price and level > price:
            invalidate_price, invalidate_label = level, label
            break

    if invalidate_price:
        invalidate_note = (
            f"The thesis is a broken trend, so it dies on a close back above the "
            f"{invalidate_label} near ${invalidate_price:.2f}. Reaching it does not "
            f"breach the defined risk, but it removes the reason for the trade."
        )
    else:
        invalidate_note = (
            "The thesis is a broken trend: a close back above the moving averages "
            "the stock just lost removes the reason for the trade, even though the "
            "risk stays capped at the debit."
        )

    return {
        "target_price": target_price,
        "target_capture_pct": round(target_capture_pct, 0),
        "target_profit_dollars": round(max_profit * target_capture_pct / 100.0 * CONTRACT_MULTIPLIER, 0),
        "stop_price": stop_price,
        "stop_loss_pct": round(stop_pct, 0),
        "stop_loss_dollars": round((debit - stop_price) * CONTRACT_MULTIPLIER, 0),
        "entry_debit_basis": round(debit, 2),
        "reassess_dte": reassess_dte,
        "invalidate_price": _round(invalidate_price),
        "invalidate_note": invalidate_note,
        "profile": profile,
        "rationale": rationale,
    }


def build_verdict(row: dict) -> str:
    """One line explaining why this name is (or is not) worth a bear put spread."""
    s = row.get("spread") or {}
    stretch = _num(row.get("stretch_sigma")) or 0.0
    drop = _num(row.get("drawdown_pct")) or 0.0
    grade = row.get("grade")

    subject = {
        "index": "Broad index fund",
        "sector": "Sector fund",
        "leveraged": "Leveraged fund",
        "narrow": "Narrow fund",
    }.get(row.get("fund_kind") or "", "Breaking down")

    structure_words = []
    if row.get("below_sma50"):
        structure_words.append("below its 50-day")
    if row.get("sma50_below_sma200"):
        structure_words.append("50-day under the 200-day")
    if _num(row.get("rel_weakness_pct")) and _num(row.get("rel_weakness_pct")) > 1:
        structure_words.append(f"lagging the market by {row['rel_weakness_pct']:.0f}pp")
    structure = ", ".join(structure_words) or f"{stretch:.1f}σ move over the window"

    quality = {
        "A": "Clean setup", "B": "Solid setup", "C": "Workable setup",
    }.get(grade or "", "Marginal setup")
    if row.get("is_fund"):
        lead = f"{subject}, {quality.lower()} — {structure}, {abs(drop):.0f}% off its high"
    else:
        lead = f"{quality} — {structure}, {abs(drop):.0f}% off its high"

    if s.get("long_strike") and s.get("debit"):
        lead += (
            f". Buy the {s['expiration']} ${s['long_strike']:g}/${s['short_strike']:g} put spread "
            f"for about ${s['debit']:.2f} — risk ${s['max_loss_dollars']:.0f} to make "
            f"${s['max_profit_dollars']:.0f}"
        )
        if s.get("reward_risk"):
            lead += f" ({s['reward_risk']:.1f}:1)"
        if s.get("required_move_pct") is not None:
            lead += f", which needs a {s['required_move_pct']:.0f}% fall"
            if s.get("required_move_sigma") is not None:
                lead += f" ({s['required_move_sigma']:.1f}σ over {s['dte']}d)"
        plan = s.get("plan") or {}
        if plan.get("target_price") is not None:
            lead += (
                f". Success-oriented exit: sell it back near ${plan['target_price']:.2f} "
                f"for about {plan['target_capture_pct']:.0f}% of the maximum payoff"
            )

    flags = row.get("flags") or []
    if "Making fresh 52-week lows" in flags:
        lead += ". Already at fresh lows — this is where put sellers get paid, not put buyers"
    elif "Already deeply oversold — bounce risk" in flags:
        lead += ". Deeply oversold, so the next move is as likely to be the bounce"
    elif "Sharp bounce off the recent low" in flags:
        lead += ". It has already bounced hard off the low, so the breakdown is not clean"
    elif "Priced above realized-vol fair value" in flags:
        lead += ". The debit is above what this name's own volatility justifies"
    elif "Earnings before expiration" in flags:
        lead += ". Earnings land inside the trade — a coin flip you are paying up for"
    elif "Leg slippage eats the edge" in flags:
        lead += ". Crossing both bid/ask spreads costs a large share of the debit"
    elif s.get("avoids_earnings") and s.get("days_earnings_after_expiry") is not None:
        lead += (
            f". This expiration closes {s['days_earnings_after_expiry']}d before "
            f"earnings on {s['earnings_date']}"
        )
    return lead + "."


# ---------------------------------------------------------------------------
# Universe resolution
# ---------------------------------------------------------------------------

def resolve_scan_universe(p: dict) -> list[str]:
    """Union of the enabled groups, same independent-group model as the others."""
    tickers: list[str] = []
    if p.get("include_stocks", True):
        tickers += resolve_spread_universe(
            p.get("universe") or "large_cap", p.get("custom_tickers"),
            profile_id=p.get("profile_id"), aggregate_id=p.get("aggregate_id"),
        )
    if p.get("include_index_etfs"):
        tickers += INDEX_ETF_UNIVERSE
    if p.get("include_sector_etfs"):
        tickers += SECTOR_ETF_UNIVERSE
    return _clean_tickers(tickers)


# ---------------------------------------------------------------------------
# The scan
# ---------------------------------------------------------------------------

DEFAULTS = {
    "universe": "large_cap",
    "include_stocks": True,
    "include_index_etfs": False,
    "include_sector_etfs": False,
    "lookback_days": 21,
    "min_market_cap": 5e9,
    # Two legs to fill, so the small-cap floor is stricter than the covered call
    # screen's. Option liquidity, not company size, is what breaks a vertical.
    "small_cap_min_market_cap": 1e9,
    "fund_min_aum": 500e6,
    "exclude_leveraged_funds": True,
    "min_avg_dollar_volume": 25e6,
    # ── Directional gates ────────────────────────────────────────────────
    # Sigma is already volatility-normalized, so unlike the raw-percent gates on
    # the other two screens these need no separate fund floors: a 1σ decline
    # means the same thing for SPY and for a semiconductor.
    "min_stretch_sigma": 0.5,
    # The band, and the reason this screen is not the put screen inverted. Above
    # 2.5σ the decline being paid for has already happened.
    "max_stretch_sigma": 2.5,
    "require_below_sma50": True,
    "require_downtrend": False,
    "min_rel_weakness_pct": 1.0,
    # Funds track the benchmark by construction — SPY has zero weakness against
    # itself — so requiring relative weakness of them would empty the ETF list.
    "fund_min_rel_weakness_pct": 0.0,
    # RSI has to be *rolling over*, not spent: a floor as well as a ceiling. This
    # single band is the clearest difference from both selling screens.
    "min_rsi": 32.0,
    "max_rsi": 60.0,
    "max_drawdown_pct": 40.0,
    "min_above_52w_low_pct": 5.0,
    "exclude_fresh_lows": True,
    "exclude_earnings_before_expiry": True,
    "earnings_buffer_days": 5,
    # ── Structure ────────────────────────────────────────────────────────
    # Longer than the sellers' 35 days on purpose: a debit spread needs the move
    # to happen, and buying only three or four weeks of time to be right is the
    # most common way a correct directional call still loses. Buying time is also
    # the one thing a debit trade can do that a credit trade cannot, so the window
    # deliberately reaches out to LEAPS — a 400-day put spread on a broken trend
    # is a legitimate use of this screen, and the target must not be clipped.
    "target_dte": 45,
    "min_dte": MIN_TARGET_DTE,
    "max_dte": MAX_TARGET_DTE,
    "long_delta": 0.50,
    "short_delta": 0.25,
    "delta_tolerance": 0.15,
    "min_width_pct": 2.0,
    "max_width_pct": 20.0,
    "max_debit_pct_of_width": 55.0,
    "min_reward_risk": 1.0,
    "max_required_sigma": 2.5,
    "basis_mode": "original",
    "chain_limit": 20,
    "max_results": 40,
}


def _partition_candidate_rows(rows: list[dict], max_results: int) -> tuple[list[dict], list[dict]]:
    """Separate executable ideas from names that still need more work.

    The primary list is intentionally strict: it contains only a live spread
    whose strike pair cleared every user-supplied structure constraint.  A
    relaxed fallback is still useful research, but it belongs beside unpriced
    names on the watchlist rather than beside an actionable order ticket.
    """
    actionable = [
        row for row in rows
        if row.get("chain_status") == "actionable"
    ]
    watchlist = [
        row for row in rows
        if row.get("chain_status") != "actionable"
    ]

    actionable.sort(key=lambda row: -(row.get("score") or 0))
    watchlist_order = {
        "earnings": 0,
        "constraints_relaxed": 1,
        "unavailable": 2,
        "not_priced": 3,
    }
    watchlist.sort(key=lambda row: (
        watchlist_order.get(row.get("chain_status"), 4),
        -(row.get("score") or 0),
    ))
    return actionable[:max_results], watchlist[:max_results]


def run_spread_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}

    lookback = max(5, min(126, int(_num(p["lookback_days"], 21))))
    min_cap = max(0.0, _num(p["min_market_cap"], 0.0) or 0.0)
    small_min_cap = max(0.0, _num(p["small_cap_min_market_cap"], 0.0) or 0.0)
    fund_min_aum = max(0.0, _num(p["fund_min_aum"], 0.0) or 0.0)
    min_adv = _num(p["min_avg_dollar_volume"], 0.0) or 0.0
    min_stretch = _num(p["min_stretch_sigma"], 0.0) or 0.0
    max_stretch = _num(p["max_stretch_sigma"], 99.0) or 99.0
    min_weak = _num(p["min_rel_weakness_pct"], 0.0) or 0.0
    fund_min_weak = _num(p["fund_min_rel_weakness_pct"], 0.0) or 0.0
    min_rsi = _num(p["min_rsi"], 0.0) or 0.0
    max_rsi = _num(p["max_rsi"], 100.0) or 100.0
    max_dd = _num(p["max_drawdown_pct"], 100.0) or 100.0
    min_above_low = _num(p["min_above_52w_low_pct"], 0.0) or 0.0
    # Target DTE is user-controlled, so the implicit API window must not cap it.
    # Explicit callers can still provide narrower min/max bounds when needed.
    target_dte = max(
        MIN_TARGET_DTE,
        min(MAX_TARGET_DTE, int(_num(p["target_dte"], 45))),
    )
    min_dte = max(MIN_TARGET_DTE, int(_num(p["min_dte"], MIN_TARGET_DTE)))
    max_dte = max(min_dte, int(_num(p["max_dte"], MAX_TARGET_DTE)))
    long_delta = min(0.9, max(0.05, _num(p["long_delta"], 0.50) or 0.50))
    short_delta = min(long_delta - 0.01, max(0.02, _num(p["short_delta"], 0.25) or 0.25))
    delta_tol = min(0.4, max(0.02, _num(p["delta_tolerance"], 0.15) or 0.15))
    min_width = max(0.1, _num(p["min_width_pct"], 2.0) or 2.0)
    max_width = max(min_width, _num(p["max_width_pct"], 20.0) or 20.0)
    max_debit_pct = min(95.0, max(5.0, _num(p["max_debit_pct_of_width"], 55.0) or 55.0))
    min_rr = max(0.0, _num(p["min_reward_risk"], 1.0) or 0.0)
    max_req_sigma = max(0.2, _num(p["max_required_sigma"], 2.5) or 2.5)
    earnings_buffer = max(0, min(30, int(_num(p["earnings_buffer_days"], 5))))
    chain_limit = max(0, min(60, int(_num(p["chain_limit"], 20))))
    max_results = max(1, min(200, int(_num(p["max_results"], 40))))
    basis_mode = "broker_adjusted" if str(p.get("basis_mode") or "").lower().startswith(
        ("broker", "adjust")
    ) else "original"

    tickers = resolve_scan_universe(p)
    if not tickers:
        return {
            "rows": [], "watchlist_rows": [],
            "stats": {
                "universe": 0, "priced": 0, "passed_price": 0,
                "final": 0, "actionable": 0, "watchlist": 0,
            },
            "params": p,
            "error": "Nothing selected to scan. Enable stocks, index ETFs, or sector ETFs.",
        }

    # Held shares are looked up regardless of universe, so a large-cap scan can
    # still say "you own 300 of these" — a breaking-down holding is the most
    # natural use of this screen, as a defined-risk hedge rather than a bet.
    try:
        positions = held_positions(p.get("profile_id"), p.get("aggregate_id"), basis_mode)
    except Exception:
        positions = {}

    etf_hint = INDEX_ETF_SET | SECTOR_ETF_SET

    hist = _load_history(tickers)
    if hist is None or hist.empty:
        return {
            "rows": [], "watchlist_rows": [],
            "stats": {
                "universe": len(tickers), "priced": 0, "passed_price": 0,
                "final": 0, "actionable": 0, "watchlist": 0,
            },
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

        stretch = tech.get("stretch_sigma")
        if stretch is None or stretch < min_stretch or stretch > max_stretch:
            continue
        if p["require_below_sma50"] and not tech.get("below_sma50"):
            continue
        if p["require_downtrend"] and not tech.get("sma50_below_sma200"):
            continue
        rsi = tech.get("rsi_14")
        if rsi is not None and (rsi < min_rsi or rsi > max_rsi):
            continue
        dd = -(tech.get("drawdown_pct") or 0.0)
        if dd > max_dd:
            continue
        above_low = tech.get("above_52w_low_pct")
        if above_low is not None and above_low < min_above_low:
            continue
        if (tech.get("avg_dollar_volume") or 0.0) < min_adv:
            continue
        if p["exclude_fresh_lows"] and tech.get("fresh_low"):
            continue

        # Relative weakness is a raw percentage, so it does need the fund split
        # that the sigma gates do not. A curated ticker is known up front; anything
        # from holdings, a watchlist, or a custom list is unknown until stage 2, so
        # it clears the looser floor here and is re-checked with the right one.
        weak = tech.get("rel_weakness_pct")
        if ticker in etf_hint:
            weak_floor = fund_min_weak
        elif ticker in CURATED_STOCK_SET or ticker in SMALL_CAP_SET:
            weak_floor = min_weak
        else:
            weak_floor = min(min_weak, fund_min_weak)
        if weak is not None and weak < weak_floor:
            continue

        tech["ticker"] = ticker
        price_pass.append(tech)

    # Rank the price stage so the expensive stages only touch the best names. The
    # ranking key is relative weakness rather than the raw decline, because that
    # is the part of the move most likely to continue.
    price_pass.sort(key=lambda t: -(t.get("rel_weakness_pct") or 0.0))
    fundamentals = _fetch_fundamentals_bulk([t["ticker"] for t in price_pass])

    survivors = []
    for tech in price_pass:
        ticker = tech["ticker"]
        fund = fundamentals.get(ticker, {})
        is_fund = _is_fund(fund, ticker)
        weak = tech.get("rel_weakness_pct")

        if is_fund:
            if weak is not None and weak < fund_min_weak:
                continue
            if fund_min_aum and (_num(fund.get("total_assets")) or 0.0) < fund_min_aum:
                continue
            if p["exclude_leveraged_funds"] and _fund_kind(ticker, fund) == "leveraged":
                continue
        else:
            if weak is not None and weak < min_weak:
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
    chain_target_tickers = {pair[0]["ticker"] for pair in chain_targets}

    def _chain_for(pair):
        tech, fund = pair
        div_y = dividend_yield_for_pricing(fund, tech.get("price"))
        forecast_vol = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        try:
            return _suggest_spread(
                tech["ticker"], tech["price"], div_y, forecast_vol,
                target_dte, min_dte, max_dte,
                long_delta=long_delta, short_delta=short_delta,
                delta_tolerance=delta_tol,
                min_width_pct=min_width, max_width_pct=max_width,
                max_debit_pct_of_width=max_debit_pct,
                min_reward_risk=min_rr, max_required_sigma=max_req_sigma,
                earnings_date=fund.get("next_earnings"),
                earnings_buffer_days=earnings_buffer,
            )
        except Exception:
            return None

    spreads: dict[str, dict | None] = {}
    if chain_targets:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for pair, spread in zip(chain_targets, pool.map(_chain_for, chain_targets)):
                spreads[pair[0]["ticker"]] = spread

    rows = []
    for tech, fund in survivors:
        ticker = tech["ticker"]
        spread = spreads.get(ticker)
        rating = score_candidate(tech, fund, spread, earnings_buffer_days=earnings_buffer)
        # _suggest_spread already tried to find an expiration that closes before
        # the report; reaching here means no expiration in the window could.
        excluded_for_earnings = bool(
            p["exclude_earnings_before_expiry"] and rating.get("earnings_before_expiry")
        )
        if excluded_for_earnings:
            dropped_for_earnings += 1
            continue
        if spread:
            plan = recommend_plan(spread, rating, tech)
            div_yield = dividend_yield_for_pricing(fund, tech.get("price"))
            probability_schedule = profit_probability_schedule(
                spot=tech.get("price"),
                dte=spread.get("dte"),
                expiration=spread.get("expiration"),
                distribution_iv=spread.get("atm_iv") or (
                    spread.get("long_leg") or {}
                ).get("iv"),
                entry_cashflow=-(_num(spread.get("debit"), 0.0) or 0.0),
                legs=[
                    {
                        "option_type": "put",
                        "strike": (spread.get("long_leg") or {}).get("strike"),
                        "iv": (spread.get("long_leg") or {}).get("iv"),
                        "quantity": 1,
                    },
                    {
                        "option_type": "put",
                        "strike": (spread.get("short_leg") or {}).get("strike"),
                        "iv": (spread.get("short_leg") or {}).get("iv"),
                        "quantity": -1,
                    },
                ],
                exit_points=[{
                    "kind": "reassess",
                    "label": "Time-stop exit",
                    "remaining_dte": (plan or {}).get("reassess_dte"),
                }],
                risk_free_rate=RISK_FREE,
                dividend_yield=div_yield,
            )
            spread = {
                **spread,
                "plan": plan,
                "probability_schedule": probability_schedule,
            }

        if spread and not spread.get("constraints_relaxed"):
            chain_status = "actionable"
            watchlist_reason = None
        elif spread:
            chain_status = "constraints_relaxed"
            watchlist_reason = (
                "A live spread was found, but no strike pair met every selected "
                "debit, reward/risk, and required-move limit."
            )
        elif ticker in chain_target_tickers:
            chain_status = "unavailable"
            watchlist_reason = (
                "The option chain was checked, but no fully quotable two-leg "
                "spread was available."
            )
        else:
            chain_status = "not_priced"
            watchlist_reason = (
                "This directional candidate ranked outside the live-chain "
                f"pricing limit of {chain_limit}."
            )
            rating = {
                **rating,
                "flags": [
                    "Not priced — outside chain limit"
                    if flag == "Option chain unavailable" else flag
                    for flag in rating.get("flags", [])
                ],
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
            "price": _round(tech.get("price")),
            "window_pct": _round(tech.get("window_pct")),
            "decline_pct": _round(tech.get("decline_pct")),
            "expected_move_pct": _round(tech.get("expected_move_pct")),
            "stretch_sigma": _round(tech.get("stretch_sigma")),
            "drawdown_pct": _round(tech.get("drawdown_pct")),
            "excess_move_pct": _round(tech.get("excess_move_pct")),
            "rel_weakness_pct": _round(tech.get("rel_weakness_pct")),
            "beta": _round(tech.get("beta")),
            "rsi_14": _round(tech.get("rsi_14"), 1),
            "rsi_roll_pp": _round(tech.get("rsi_roll_pp"), 1),
            "pct_of_52w_range": _round(tech.get("pct_of_52w_range"), 1),
            "above_52w_low_pct": _round(tech.get("above_52w_low_pct"), 1),
            "week52_high": _round(tech.get("week52_high")),
            "week52_low": _round(tech.get("week52_low")),
            "sma_20": _round(tech.get("sma_20")),
            "sma_50": _round(tech.get("sma_50")),
            "sma_200": _round(tech.get("sma_200")),
            "below_sma20": tech.get("below_sma20"),
            "below_sma50": tech.get("below_sma50"),
            "sma20_below_sma50": tech.get("sma20_below_sma50"),
            "sma50_below_sma200": tech.get("sma50_below_sma200"),
            "below_sma50_pct": _round(tech.get("below_sma50_pct"), 1),
            "room_to_sma200_pct": _round(tech.get("room_to_sma200_pct"), 1),
            "days_below_sma50": tech.get("days_below_sma50"),
            "atr_below_sma50": _round(tech.get("atr_below_sma50")),
            "lower_high": tech.get("lower_high"),
            "fresh_low": tech.get("fresh_low"),
            "bounce_off_low_pct": _round(tech.get("bounce_off_low_pct"), 1),
            "accel_pp": _round(tech.get("accel_pp"), 1),
            "rv_30": _round(tech.get("rv_30"), 3),
            "rv_252": _round(tech.get("rv_252"), 3),
            "avg_dollar_volume": _num(tech.get("avg_dollar_volume")),
            "forward_pe": _round(fund.get("forward_pe"), 1),
            "target_mean_price": _round(fund.get("target_mean_price")),
            "next_earnings": fund.get("next_earnings"),
            # The position behind the trade, when there is one — a breaking-down
            # holding is a hedge candidate, not just a short idea.
            "shares_held": _round(pos.get("shares"), 4),
            "contracts_to_hedge": pos.get("contracts_writable") or 0,
            "cost_basis": pos.get("cost_basis"),
            "spread": _round_spread(spread),
            "chain_status": chain_status,
            "watchlist_reason": watchlist_reason,
            **rating,
        }
        row["verdict"] = build_verdict(row)
        rows.append(row)

    actionable_rows, watchlist_rows = _partition_candidate_rows(rows, max_results)
    displayed_rows = actionable_rows + watchlist_rows

    return {
        "rows": actionable_rows,
        "watchlist_rows": watchlist_rows,
        "stats": {
            "universe": len(tickers),
            "priced": priced,
            "passed_price": len(price_pass),
            "passed_fundamentals": passed_fundamentals,
            "chains_fetched": sum(1 for v in spreads.values() if v),
            "dropped_for_earnings": dropped_for_earnings,
            "positions_known": sum(
                1 for r in displayed_rows if (r.get("contracts_to_hedge") or 0) >= 1
            ),
            "final": len(actionable_rows),
            "actionable": len(actionable_rows),
            "watchlist": len(watchlist_rows),
            "watchlist_relaxed": sum(
                1 for r in watchlist_rows if r.get("chain_status") == "constraints_relaxed"
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
            "min_market_cap": min_cap, "small_cap_min_market_cap": small_min_cap,
            "fund_min_aum": fund_min_aum, "min_avg_dollar_volume": min_adv,
            "include_stocks": bool(p["include_stocks"]),
            "include_index_etfs": bool(p["include_index_etfs"]),
            "include_sector_etfs": bool(p["include_sector_etfs"]),
            "min_stretch_sigma": min_stretch, "max_stretch_sigma": max_stretch,
            "require_below_sma50": bool(p["require_below_sma50"]),
            "require_downtrend": bool(p["require_downtrend"]),
            "min_rel_weakness_pct": min_weak,
            "fund_min_rel_weakness_pct": fund_min_weak,
            "min_rsi": min_rsi, "max_rsi": max_rsi,
            "max_drawdown_pct": max_dd,
            "min_above_52w_low_pct": min_above_low,
            "exclude_leveraged_funds": bool(p["exclude_leveraged_funds"]),
            "exclude_fresh_lows": bool(p["exclude_fresh_lows"]),
            "exclude_earnings_before_expiry": bool(p["exclude_earnings_before_expiry"]),
            "earnings_buffer_days": earnings_buffer,
            "target_dte": target_dte, "min_dte": min_dte, "max_dte": max_dte,
            "long_delta": long_delta, "short_delta": short_delta,
            "delta_tolerance": delta_tol,
            "min_width_pct": min_width, "max_width_pct": max_width,
            "max_debit_pct_of_width": max_debit_pct,
            "min_reward_risk": min_rr, "max_required_sigma": max_req_sigma,
            "basis_mode": basis_mode, "chain_limit": chain_limit,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def _round_spread(spread: dict | None) -> dict | None:
    if not spread:
        return None
    out = dict(spread)
    for k, dec in (
        ("long_strike", 2), ("short_strike", 2), ("width", 2), ("debit", 2),
        ("debit_worst_case", 2), ("debit_pct_of_width", 1), ("max_profit", 2),
        ("max_loss", 2), ("reward_risk", 2), ("breakeven", 2),
        ("required_move_pct", 1), ("breakeven_move_pct", 1),
        ("required_move_sigma", 2), ("breakeven_move_sigma", 2),
        ("expected_move_pct_life", 1), ("prob_profit", 1), ("prob_max_profit", 1),
        ("fair_value", 2), ("edge", 2), ("edge_pct", 1), ("skew_ratio", 3),
        ("exec_cost", 2), ("exec_cost_pct", 1), ("atm_iv", 4),
        ("debit_dollars", 0), ("max_profit_dollars", 0), ("max_loss_dollars", 0),
        ("outright_cost", 2), ("cost_saving_pct", 0),
    ):
        if k in out:
            out[k] = _round(out[k], dec)
    for leg in ("long_leg", "short_leg"):
        if isinstance(out.get(leg), dict):
            out[leg] = {
                **out[leg],
                "strike": _round(out[leg].get("strike")),
                "bid": _round(out[leg].get("bid")),
                "ask": _round(out[leg].get("ask")),
                "mid": _round(out[leg].get("mid")),
                "iv": _round(out[leg].get("iv"), 4),
                "delta": _round(out[leg].get("delta"), 3),
            }
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def register_routes(app):

    @app.route("/api/options/bear-put-spread-scan/universes", methods=["GET"])
    def bear_put_spread_scan_universes():
        return jsonify(
            universes=[
                {
                    "id": key,
                    "label": val["label"],
                    "count": len(val["tickers"]) if val["tickers"] else None,
                    "small_cap": key in _SMALL_CAP_CHOICE_IDS,
                }
                for key, val in SPREAD_UNIVERSE_CHOICES.items()
            ],
            defaults=DEFAULTS,
        )

    @app.route("/api/options/bear-put-spread-scan", methods=["POST"])
    def bear_put_spread_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            payload.setdefault("profile_id", request.args.get("profile_id", type=int))
            payload.setdefault("aggregate_id", request.args.get("aggregate_id", type=int))
            payload.setdefault("basis_mode", request.args.get("basis_mode"))
            return jsonify(run_spread_scan(payload))
        except ValueError as e:
            return jsonify(error=str(e)), 400
        except Exception as e:
            return jsonify(error=str(e)), 500
