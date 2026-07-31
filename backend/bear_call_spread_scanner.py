"""Bear call spread (credit vertical) candidate scanner.

The fifth screen in the options family. Sell a lower-strike call, buy a
higher-strike call in the same expiration: the credit is the entire reward, the
width minus the credit is the entire risk, and the trade pays as long as the
underlying stays *below* the short strike. Down, sideways, or up a little all
win; only a rally loses.

Structurally this is the Bull Put Spread Scanner's twin — same credit vertical,
same defined risk, same close-early management. Directionally it looks like the
Covered Call Scanner. But it is not either one, and the reason is the whole
design problem, because both obvious screens are wrong and each is wrong by
being another scanner's screen:

  * "Sell calls on whatever is most overbought, the premium is fattest there" is
    the Covered Call Scanner's setup. That screen already warns overbought alone
    is a trap — but here the failure is categorically worse. A covered call
    writer who gets run over delivers shares they already own: a capped gain, an
    opportunity cost, an annoyance. This trade owns nothing. A rally through the
    short strike is a realized cash loss up to the full width. The identical
    setup that merely disappoints a call writer genuinely loses money here, so
    accelerating momentum and fresh highs are *excluded*, not merely flagged.
  * "Sell calls on whatever just crashed, the implied vol is huge" fails twice
    over. The sharpest rallies in the market happen inside downtrends, and a
    short squeeze runs to the full width while the credit caps the upside. And
    after a capitulation the *call* skew flattens or inverts — puts are bid,
    calls are cheap — so you are paid least exactly where the realized upside
    risk is highest. That is the Bear Put Spread Scanner's territory: when a
    name is genuinely breaking down, buy the put spread and be paid for the
    move, rather than selling calls and capping yourself at a nickel.

What a bear call spread wants is a *failed rally into overhead supply, in a name
that is not a leader*. Four things at once:

  1. Rejection    - a bounce that has been refused rather than a trend that is
                    running. Price rolled over off its own recent high, momentum
                    is decelerating, RSI is falling *from* an elevated level
                    rather than sitting at one, and the name is not leading the
                    market. Rally size is scored as a band, not a ramp: roughly
                    0.75-2σ is a rejected bounce, and above 2.5σ it is a
                    momentum thrust nobody should stand in front of.
  2. Ceiling      - overhead supply for the short strike to hide behind. A
                    declining 50-day, a prior swing high, the 200-day from
                    below: price has to break something structural before the
                    trade starts losing. Mid-range in the 52-week range is
                    ideal — at the highs there is no wall left, at the lows
                    there is squeeze fuel.
  3. Credit       - what the premium actually pays for the defined risk: credit
                    against width, annualized return on risk, implied vol rich
                    against realized, and the credit against a realized-vol
                    fair value. Note that IV/RV reads the *normal* way here.
                    On the bear put screen rich implied vol is a cost because
                    that screen buys; this one sells, so rich is good.
  4. Safety       - the two-leg execution maths, plus the two risks only a short
                    *call* faces. An ex-dividend date inside the trade invites
                    early exercise, and in a spread that is worse than in a
                    covered call: assignment leaves you short 100 shares you do
                    not own, holding a long call, owing the dividend. An
                    earnings report can gap the stock straight through the short
                    strike. Both are dodged where possible, not just flagged.

Two things here exist on no other screen:

  * Resistance-aware strike selection, the analogue of the covered call screen's
    cost-basis strike floor. Given the choice, the short strike is placed *above*
    the nearest overhead level rather than merely at a target delta.
  * The upside wing read as a warning rather than a gift. When the far-OTM calls
    carry more implied vol than at-the-money, the market is paying for a jump —
    the exact move that costs this trade the width. That is the precise opposite
    of how put skew reads on the bear put screen, where a steep wing is a gift
    because you sell it. See `_upside_wing` for why it is measured against
    at-the-money, off the whole chain, as a median, and only when the band is
    thick enough to mean anything.

Stage structure and the caches are shared with put_scanner, and the call chain
cache comes from call_scanner, so running the Covered Call Scanner and then this
one re-uses the same downloaded chains.

Endpoints:
  GET  /api/options/bear-call-spread-scan/universes
  POST /api/options/bear-call-spread-scan
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from statistics import NormalDist, median

import numpy as np
import pandas as pd
import yfinance as yf
from flask import jsonify, request

from option_probability import profit_probability_schedule
from options_pricing import black_scholes
from call_scanner import (
    SMALL_CAP_SET,
    SMALL_CAP_UNIVERSE,
    _load_call_chain,
    assess_early_assignment,
    expected_dividend_amount,
    held_positions,
    next_ex_dividend,
)
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
# The trapezoid and the terminal-distribution probability are the bear put
# screen's, imported rather than re-derived so the two spread screens cannot
# drift apart on the primitives they both depend on.
from bear_put_spread_scanner import _band, prob_below

_NORM = NormalDist()

CONTRACT_MULTIPLIER = 100.0


# ---------------------------------------------------------------------------
# Universes
# ---------------------------------------------------------------------------
# The shared lists plus small caps. Small caps are offered for parity with the
# covered call and bear put screens, but this is the screen where they are most
# dangerous and the default floor is correspondingly higher. The reason is not
# liquidity — it is that the single worst outcome for a short call is an
# overnight gap through the strike, and the most common cause of one is a
# takeover bid. Those land on small caps, and no technical screen can see one
# coming.
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
CREDIT_MAX = 25.0
SAFETY_MAX = 25.0
SAFETY_CHAIN_MAX = 19.0     # the part of Safety that needs both legs quoted
PARTIAL_MAX = 100.0 - CREDIT_MAX - SAFETY_CHAIN_MAX


# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------

def call_vertical_fair_value(spot: float, short_strike: float, long_strike: float,
                             T: float, sigma: float) -> float | None:
    """Expected payoff of the call spread at expiry under a driftless lognormal.

    The call-side twin of the bear put screen's `vertical_fair_value`, and used
    the same way: priced at zero rate and zero carry with the stock's own
    *realized* volatility, so it is an undiscounted expectation rather than a
    market quote. It answers "what is this vertical worth given how far this name
    actually travels?", which is the number the collected credit has to beat.
    Using implied vol would make the comparison circular, since the credit is
    derived from implied vol and would always come out fair by construction.

    One asymmetry worth knowing, because it does not exist on the put side: a
    zero-rate forward equals spot, which makes a *call* spread cheaper than its
    real-world value and therefore flatters the seller's edge. The scoring ramp
    for that edge starts at zero rather than below it to absorb the bias.
    """
    sd = _num(sigma)
    if not sd or sd <= 0 or T <= 0:
        return None
    try:
        short_leg = black_scholes(spot, short_strike, T, 0.0, 0.0, sd, "call")["price"]
        long_leg = black_scholes(spot, long_strike, T, 0.0, 0.0, sd, "call")["price"]
    except Exception:
        return None
    return max(0.0, short_leg - long_leg)


def strike_for_call_delta(spot: float, target_delta: float, sigma: float, T: float) -> float:
    """Strike whose call delta is about `target_delta`, from vol and time alone.

    Only used when the chain comes back with no usable implied vols, so no delta
    can be computed per strike. Inverting the Black-Scholes delta beats a flat
    "some percent above spot" guess because it scales with the name's own
    volatility the way a real chain does.
    """
    d = min(0.95, max(0.01, _num(target_delta, 0.5) or 0.5))
    sd = _num(sigma) or 0.0
    if sd <= 0 or T <= 0:
        return spot
    # N(d1) = delta  =>  d1 = inv_cdf(delta),  K = S * exp(sigma^2 T / 2 - d1 sigma sqrt(T))
    return spot * math.exp(0.5 * sd * sd * T - _NORM.inv_cdf(d) * sd * math.sqrt(T))


# ---------------------------------------------------------------------------
# Stage 1 - rejected-rally technicals
# ---------------------------------------------------------------------------

def _compute_technicals(sub: pd.DataFrame, bench_ret, lookback_days: int) -> dict | None:
    """Per-ticker metrics for a *rejected rally*. None when history is thin.

    Deliberately its own function rather than the covered call screen's. That
    screen measures overextension — how far a name has travelled — because a
    call writer's worst case is capped and an extended name simply has less
    upside left to give away. This screen has to measure something harder: not
    that the move is large, but that it has *stopped*. A large move still running
    is the single thing that loses the whole width here.
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
    # window_stretch signs its output for a decline, so a rally is the negation —
    # the same flip the covered call screen makes.
    rally_sigma = -ws["stretch_sigma"]

    week52_high = _num(close.max())
    week52_low = _num(close.min())
    drawdown_pct = ((price - week52_high) / week52_high * 100.0) if week52_high else None
    above_52w_low_pct = ((price - week52_low) / week52_low * 100.0) if week52_low else None

    pct_of_52w_range = None
    if week52_high and week52_low and week52_high > week52_low:
        pct_of_52w_range = (price - week52_low) / (week52_high - week52_low) * 100.0

    # Beta, then the part of the advance the market does not explain. Here the
    # sign matters the other way from every other screen: a name that outran the
    # market is a *leader*, and selling calls on the market's leader is the
    # fastest way to lose the width.
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
    # Positive means it outperformed the beta-adjusted market, which on this
    # screen is the direction to avoid.
    rel_strength_pct = excess_move_pct

    sma_20_s = close.rolling(20).mean()
    sma_50_s = close.rolling(50).mean()
    sma_20 = _num(sma_20_s.iloc[-1]) if len(close) >= 20 else None
    sma_50 = _num(sma_50_s.iloc[-1]) if len(close) >= 50 else None
    sma_200 = _num(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None

    # Slope matters more than level for a call seller. A *declining* 50-day
    # overhead is resistance; a rising one that price has just dipped under is
    # support about to be reclaimed, and selling calls under it is selling into
    # a pullback in an uptrend — which is the bull put screen's setup, not this
    # one.
    def _slope_pct(series, lookback=10):
        if series is None or len(series.dropna()) < lookback + 1:
            return None
        s = series.dropna()
        now, then = _num(s.iloc[-1]), _num(s.iloc[-1 - lookback])
        if not now or not then or then == 0:
            return None
        return (now - then) / then * 100.0

    sma20_slope_pct = _slope_pct(sma_20_s)
    sma50_slope_pct = _slope_pct(sma_50_s)

    above_sma20 = bool(sma_20 and price > sma_20)
    above_sma50 = bool(sma_50 and price > sma_50)
    below_sma20 = bool(sma_20 and price < sma_20)
    below_sma50 = bool(sma_50 and price < sma_50)
    sma50_below_sma200 = bool(sma_50 and sma_200 and sma_50 < sma_200)
    above_sma50_pct = ((price - sma_50) / sma_50 * 100.0) if sma_50 else None

    high_s = sub["High"] if "High" in sub.columns else close
    low_s = sub["Low"] if "Low" in sub.columns else close
    atr14 = _atr(high_s.dropna(), low_s.dropna(), close)

    rv_30 = _num(log_ret.iloc[-30:].std() * math.sqrt(TRADING_DAYS)) if len(log_ret) >= 30 else None
    rv_252 = _num(log_ret.std() * math.sqrt(TRADING_DAYS))

    # ── The rejection itself ────────────────────────────────────────────────
    # Momentum turning over: RSI now against RSI two weeks ago. The pair matters
    # more than either number. A high flat RSI is a trend; a *falling* RSI from a
    # high level is a rally being refused, and that distinction is the difference
    # between this screen and "find the overbought names".
    rsi_14 = _wilder_rsi(close)
    rsi_prior = _wilder_rsi(close.iloc[:-14]) if len(close) > 30 else None
    rsi_roll_pp = (rsi_14 - rsi_prior) if (rsi_14 is not None and rsi_prior is not None) else None

    high_5 = _num(close.iloc[-5:].max())
    high_20 = _num(close.iloc[-20:].max())
    high_60 = _num(close.iloc[-60:].max()) if len(close) >= 60 else None
    # Rolled over: the last week failed to take out the fortnight's high.
    rolled_over = bool(high_5 and high_20 and high_5 < high_20 * 0.99)
    # Lower high: this rally topped out below the previous one — the structural
    # signature of a downtrend, and the highest-quality version of this setup.
    lower_high = bool(high_20 and high_60 and high_20 < high_60 * 0.98)

    pullback_from_high_pct = ((high_20 - price) / high_20 * 100.0) if high_20 else None
    days_since_swing_high = None
    if len(close) >= 20:
        tail = close.iloc[-20:]
        days_since_swing_high = max(0, len(tail) - 1 - int(tail.values.argmax()))

    accel_pp = None
    if len(log_ret) >= 10:
        last5 = (math.exp(float(log_ret.iloc[-5:].sum())) - 1.0) * 100.0
        prior5 = (math.exp(float(log_ret.iloc[-10:-5].sum())) - 1.0) * 100.0
        accel_pp = last5 - prior5      # negative = cooling, which is what we want

    # Squeeze fuel. A hard run off a recent low is the shape of a short squeeze,
    # and the credit collected caps the gain while the squeeze runs to the width.
    recent_high = _num(close.iloc[-3:].max())
    fresh_high = bool(week52_high and recent_high and recent_high >= week52_high * 0.995)
    low_20 = _num(close.iloc[-20:].min())
    run_off_low_pct = ((price - low_20) / low_20 * 100.0) if low_20 else None

    vol_s = sub["Volume"].dropna() if "Volume" in sub.columns else None
    avg_volume = _num(vol_s.iloc[-30:].mean()) if vol_s is not None and len(vol_s) else None
    avg_dollar_volume = (avg_volume * price) if avg_volume else None

    return {
        "price": price,
        "window_pct": window_pct,
        "expected_move_pct": ws["expected_move_pct"],
        "sigma_daily": sigma_d,
        "rally_sigma": rally_sigma,
        "drawdown_pct": drawdown_pct,
        "week52_high": week52_high,
        "week52_low": week52_low,
        "above_52w_low_pct": above_52w_low_pct,
        "pct_of_52w_range": pct_of_52w_range,
        "beta": beta,
        "excess_move_pct": excess_move_pct,
        "rel_strength_pct": rel_strength_pct,
        "rsi_14": rsi_14,
        "rsi_prior": rsi_prior,
        "rsi_roll_pp": rsi_roll_pp,
        "sma_20": sma_20,
        "sma_50": sma_50,
        "sma_200": sma_200,
        "sma20_slope_pct": sma20_slope_pct,
        "sma50_slope_pct": sma50_slope_pct,
        "above_sma20": above_sma20,
        "above_sma50": above_sma50,
        "below_sma20": below_sma20,
        "below_sma50": below_sma50,
        "sma50_below_sma200": sma50_below_sma200,
        "above_sma50_pct": above_sma50_pct,
        "atr_14": atr14,
        "rv_30": rv_30,
        "rv_252": rv_252,
        "swing_high_20": high_20,
        "swing_high_60": high_60,
        "rolled_over": rolled_over,
        "lower_high": lower_high,
        "pullback_from_high_pct": pullback_from_high_pct,
        "days_since_swing_high": days_since_swing_high,
        "accel_pp": accel_pp,
        "fresh_high": fresh_high,
        "run_off_low_pct": run_off_low_pct,
        "avg_volume": avg_volume,
        "avg_dollar_volume": avg_dollar_volume,
    }


# ---------------------------------------------------------------------------
# Overhead supply
# ---------------------------------------------------------------------------

def resistance_levels(tech: dict) -> list[tuple[float, str]]:
    """Every identifiable overhead level above spot, nearest first.

    A short call wants a wall in front of it, so this is the screen's equivalent
    of the covered call screen's cost-basis floor — a structural reason to place
    the strike where it is, rather than taking whatever the target delta lands on.

    A moving average only counts as resistance when it is flat or falling. A
    rising average that price has just slipped under is support about to be
    reclaimed, and treating it as a ceiling would put the short strike directly
    in the path of the next leg up.
    """
    price = _num(tech.get("price"))
    if not price or price <= 0:
        return []

    out: list[tuple[float, str]] = []

    def _add(level, label, slope=None, slope_ceiling=0.5):
        lv = _num(level)
        if not lv or lv <= price:
            return
        if slope is not None and slope > slope_ceiling:
            return          # rising average — support, not resistance
        out.append((lv, label))

    _add(tech.get("sma_20"), "20-day average", tech.get("sma20_slope_pct"))
    _add(tech.get("sma_50"), "50-day average", tech.get("sma50_slope_pct"))
    _add(tech.get("sma_200"), "200-day average")
    _add(tech.get("swing_high_20"), "20-day high")
    _add(tech.get("swing_high_60"), "3-month high")
    _add(tech.get("week52_high"), "52-week high")

    out.sort(key=lambda item: item[0])
    return out


def nearest_resistance(tech: dict) -> tuple[float | None, str | None, float | None]:
    """The closest overhead level as (price, label, distance above spot in %)."""
    levels = resistance_levels(tech)
    if not levels:
        return None, None, None
    level, label = levels[0]
    price = _num(tech.get("price")) or 0.0
    gap = ((level - price) / price * 100.0) if price else None
    return level, label, gap


# ---------------------------------------------------------------------------
# Stage 3 - the spread itself
# ---------------------------------------------------------------------------

def _quotable(leg: dict) -> bool:
    """Both sides of the market are live and uncrossed.

    Stricter than the two single-leg screens need. They sell one contract, so a
    live bid is enough. A vertical has to sell the short leg at the bid *and* buy
    the long leg at the ask, so a one-sided or crossed quote on either leg makes
    the whole credit fictional.
    """
    bid, ask, mid = _num(leg.get("bid")), _num(leg.get("ask")), _num(leg.get("mid"))
    return bool(bid and ask and mid and bid > 0 and ask >= bid and mid > 0)


TAIL_BAND = (0.03, 0.15)      # the far-OTM delta band that forms the upside wing
TAIL_MIN_STRIKES = 5          # below this the reading is not trustworthy


def _upside_wing(calls: list[dict], atm_iv: float | None) -> tuple[float | None, int]:
    """Median implied vol of the far-OTM call wing against at-the-money.

    The screen's squeeze/takeover warning: when the upside wing carries more
    implied vol than at-the-money, the market is paying for a jump — the exact
    move that costs this trade the width. Three deliberate choices, all of them
    forced by what the data actually looks like rather than by theory:

    1. Against *at-the-money*, not leg-against-leg. Sampled across live chains at
       the 25- and 10-delta calls, the leg-to-leg ratio straddles 1.0 with a
       median near 0.97 for single names: the equity call wing turns back up at
       far strikes instead of sloping down, so only broad index funds show the
       clean downward call skew textbooks describe (SPY around 1.12). A "the
       nearer leg should carry more vol" test would fire on most of the market.

    2. Off the *chain*, not off the chosen long leg. The width window keeps the
       long strike fairly close to the money, so reading the tail there measures
       the strike being bought rather than the wing — and a narrow spread could
       never trip the warning no matter how fat the real tail was.

    3. The *median* of the band, and only when the band has at least
       TAIL_MIN_STRIKES usable quotes. The maximum is unusable: far strikes on
       thin chains carry stale marks that produce readings like 2.4x
       at-the-money on a boring large cap. And plenty of real chains have only
       one or two quotable strikes out there, where any statistic is noise. When
       the band is too thin this returns None and the score charges nothing,
       because a guess here would be worse than silence.

    Returns (ratio, strikes_used).
    """
    iv_atm = _num(atm_iv)
    if not iv_atm or iv_atm <= 0:
        return None, 0

    lo, hi = TAIL_BAND
    band = [
        c for c in calls
        if (_num(c.get("iv")) or 0) > 0
        and c.get("delta") is not None
        and lo <= abs(c["delta"]) <= hi
        # A strike nobody holds or bids for has a mark, not a price.
        and ((_num(c.get("open_interest")) or 0) > 0 or (_num(c.get("bid")) or 0) > 0)
    ]
    if len(band) < TAIL_MIN_STRIKES:
        return None, len(band)
    return median(c["iv"] for c in band) / iv_atm, len(band)


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
    want = strike_for_call_delta(spot, target, sigma, T)
    ordered = sorted(legs, key=lambda l: abs(l["strike"] - want))
    return ordered[:3]


def _build_credit_pair(short_leg: dict, long_leg: dict, spot: float, dte: int,
                       forecast_vol: float | None, div_yield: float,
                       resistance: float | None = None) -> dict | None:
    """All the numbers for one (short, long) call strike pair, or None if unusable."""
    short_strike = _num(short_leg.get("strike"))
    long_strike = _num(long_leg.get("strike"))
    if not short_strike or not long_strike or long_strike <= short_strike:
        return None

    width = long_strike - short_strike
    short_mid = _num(short_leg.get("mid"), 0.0) or 0.0
    long_mid = _num(long_leg.get("mid"), 0.0) or 0.0
    credit = short_mid - long_mid
    # A non-positive credit or one at or above the width is bad chain data, not
    # free money: the lower strike of a call spread is always worth more.
    if credit <= 0 or credit >= width:
        return None

    max_loss = width - credit
    # The mirror of the bull put's breakeven, and the number that matters most on
    # this screen because it sits *above* today's price: everything below it wins.
    breakeven = short_strike + credit
    dte_eff = max(int(dte or 1), 1)
    T = dte_eff / 365.0

    # A simultaneous limit near the mid is the displayed entry. The natural credit
    # shows whether crossing both markets still leaves a credit at all.
    natural_credit = (_num(short_leg.get("bid"), 0.0) or 0.0) - (_num(long_leg.get("ask"), 0.0) or 0.0)
    exec_cost = (
        (_num(short_leg.get("ask"), 0.0) or 0.0) - (_num(short_leg.get("bid"), 0.0) or 0.0)
        + (_num(long_leg.get("ask"), 0.0) or 0.0) - (_num(long_leg.get("bid"), 0.0) or 0.0)
    )
    exec_cost_pct = (exec_cost / credit * 100.0) if credit > 0 else None

    credit_pct_of_width = credit / width * 100.0
    return_on_risk = (credit / max_loss * 100.0) if max_loss > 0 else None
    annualized_ror = (return_on_risk * 365.0 / dte_eff) if return_on_risk is not None else None

    short_otm_pct = (short_strike - spot) / spot * 100.0 if spot else None
    breakeven_cushion_pct = (breakeven - spot) / spot * 100.0 if spot else None

    # How far the stock has to rally before the trade is in trouble, expressed in
    # its own expected move over the life of the trade. A raw percentage is not
    # enough: 6% is a quiet fortnight for a semiconductor and a long way for a
    # utility.
    sigma_T = (forecast_vol * math.sqrt(T)) if (forecast_vol and forecast_vol > 0 and T > 0) else None
    cushion_sigma = breakeven_sigma = None
    if sigma_T and sigma_T > 0:
        if short_strike > 0:
            cushion_sigma = math.log(short_strike / spot) / sigma_T
        if breakeven > 0:
            breakeven_sigma = math.log(breakeven / spot) / sigma_T

    short_delta = _num(short_leg.get("delta"))
    prob_otm = (1.0 - abs(short_delta)) * 100.0 if short_delta is not None else None

    # Probabilities from the chain's own implied vol: what the market thinks. Both
    # of these come straight off where price lands, so they use N(-d2) rather than
    # delta. The two readings are deliberately both surfaced and they will not
    # agree: a call's delta is N(d1), and since d1 always exceeds d2, one minus
    # delta sits *below* the true N(-d2) at every strike. So `prob_otm` is the
    # conservative number the selling screens use as a convention, and
    # `prob_max_profit` is the exact one.
    pricing_iv = short_leg["iv"] if short_leg["iv"] > 0 else (long_leg["iv"] or 0.0)
    pop = prob_below(spot, breakeven, T, pricing_iv, RISK_FREE, div_yield)
    prob_max = prob_below(spot, short_strike, T, pricing_iv, RISK_FREE, div_yield)

    # Fair credit from the stock's own realized vol: what the tape says. The gap
    # between what the market pays and that value is the edge being hunted.
    fair_credit = call_vertical_fair_value(spot, short_strike, long_strike, T, forecast_vol)
    premium_edge = (credit - fair_credit) if fair_credit is not None else None
    premium_edge_pct = (
        premium_edge / fair_credit * 100.0
        if premium_edge is not None and fair_credit and fair_credit > 0 else None
    )

    # The leg-to-leg vol relationship. Reported because it is what the trader
    # sees on the two tickets, but deliberately *not* scored — measured across
    # real chains it sits either side of 1.0 with a median just under it
    # (see upside_tail_ratio in _suggest_bear_call_spread for the term that is
    # scored, and why this one is not).
    call_skew_ratio = None
    if short_leg["iv"] > 0 and long_leg["iv"] > 0:
        call_skew_ratio = short_leg["iv"] / long_leg["iv"]

    oi_min = min(
        int(_num(short_leg.get("open_interest"), 0) or 0),
        int(_num(long_leg.get("open_interest"), 0) or 0),
    )
    volume_min = min(
        int(_num(short_leg.get("volume"), 0) or 0),
        int(_num(long_leg.get("volume"), 0) or 0),
    )

    # Does the short strike actually sit above the nearest wall?
    clears_resistance = None
    resistance_gap_pct = None
    res = _num(resistance)
    if res and res > 0:
        clears_resistance = short_strike >= res
        resistance_gap_pct = (short_strike - res) / res * 100.0

    return {
        "short_strike": short_strike,
        "long_strike": long_strike,
        "width": width,
        "credit": credit,
        "natural_credit": natural_credit,
        "credit_pct_of_width": credit_pct_of_width,
        "max_profit": credit,
        "max_loss": max_loss,
        "reward_risk": (credit / max_loss) if max_loss > 0 else None,
        "return_on_risk_pct": return_on_risk,
        "annualized_return_on_risk_pct": annualized_ror,
        "breakeven": breakeven,
        "short_otm_pct": short_otm_pct,
        "breakeven_cushion_pct": breakeven_cushion_pct,
        "cushion_sigma": cushion_sigma,
        "breakeven_sigma": breakeven_sigma,
        "expected_move_pct_life": (sigma_T * 100.0) if sigma_T else None,
        "prob_otm": prob_otm,
        "prob_profit": (pop * 100.0) if pop is not None else None,
        "prob_max_profit": (prob_max * 100.0) if prob_max is not None else None,
        "fair_credit": fair_credit,
        "premium_edge": premium_edge,
        "premium_edge_pct": premium_edge_pct,
        "call_skew_ratio": call_skew_ratio,
        "exec_cost": exec_cost,
        "exec_cost_pct": exec_cost_pct,
        "open_interest_min": oi_min,
        "volume_min": volume_min,
        # Per-contract dollars, which is how the trade is actually sized.
        "credit_dollars": credit * CONTRACT_MULTIPLIER,
        "max_profit_dollars": credit * CONTRACT_MULTIPLIER,
        "max_loss_dollars": max_loss * CONTRACT_MULTIPLIER,
        # What the naked short call would have collected, and what the long leg
        # costs to cap the tail. Unlike the bear put screen's "cost saving", this
        # is the price of turning an unbounded risk into a defined one.
        "naked_credit": short_mid,
        "tail_hedge_cost": long_mid,
        "tail_hedge_pct_of_credit": (long_mid / short_mid * 100.0) if short_mid > 0 else None,
        "clears_resistance": clears_resistance,
        "resistance_gap_pct": resistance_gap_pct,
        "short_leg": {
            "strike": short_strike, "bid": short_leg["bid"], "ask": short_leg["ask"],
            "mid": short_mid, "iv": short_leg["iv"], "delta": short_leg["delta"],
            "open_interest": short_leg["open_interest"], "volume": short_leg["volume"],
        },
        "long_leg": {
            "strike": long_strike, "bid": long_leg["bid"], "ask": long_leg["ask"],
            "mid": long_mid, "iv": long_leg["iv"], "delta": long_leg["delta"],
            "open_interest": long_leg["open_interest"], "volume": long_leg["volume"],
        },
    }


def _pair_quality(pair: dict) -> float:
    """Rank candidate strike pairs on one underlying.

    Deliberately simpler than `score_candidate`: every pair here shares the same
    technicals, so this only arbitrates the structural trade-off between a wide
    spread that collects more against more risk and a narrow one that collects
    less against less. Probability and return on risk pull against each other by
    construction, which is what puts the winner in the middle.
    """
    q = _ramp(pair.get("prob_otm"), 65, 88, 24)
    q += _ramp(pair.get("annualized_return_on_risk_pct"), 15, 60, 22)
    q += _ramp(pair.get("premium_edge_pct"), 0, 35, 18)
    q += _ramp(pair.get("breakeven_cushion_pct"), 3, 12, 12)
    exec_cost = _num(pair.get("exec_cost_pct"))
    q += _ramp(-(exec_cost if exec_cost is not None else 100.0), -35, -8, 10)
    q += _ramp(pair.get("open_interest_min"), 50, 500, 8)
    # The screen's own tie-breaker: given two otherwise similar pairs, take the
    # one whose short strike hides behind the wall.
    if pair.get("clears_resistance"):
        q += 6
    return q


def _suggest_bear_call_spread(
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
    min_cushion_pct: float = 3.0,
    min_open_interest: int = 50,
    max_exec_cost_pct: float = 30.0,
    min_otm_pct: float = 1.0,
    resistance: float | None = None,
    resistance_label: str | None = None,
    respect_resistance: bool = True,
    earnings_date: str | None = None,
    earnings_buffer_days: int = 5,
    fund: dict | None = None,
) -> dict | None:
    """Best bear call spread on one underlying, from the live chain.

    Enumerates plausible (short, long) strike pairs rather than mechanically
    taking "the 25-delta and the 10-delta". A vertical has two free parameters
    that trade against each other — collect more for a nearer short strike, or
    less for a safer one — and which end of that trade-off is right depends on
    the chain's skew and liquidity, not a rule of thumb.

    The one non-delta constraint is the resistance floor: where the chain offers
    strikes above the nearest overhead level, those are preferred, so price has
    to break something structural before the trade starts losing. Exactly the
    covered call screen's cost-basis floor, applied to a technical level instead
    of a purchase price, and relaxed the same way when nothing clears it.
    """
    try:
        expirations = list(yf.Ticker(ticker).options or [])
    except Exception:
        return None

    earnings_d = _parse_date(earnings_date)
    cutoff = (
        earnings_d - timedelta(days=max(0, earnings_buffer_days))
        if earnings_d else None
    )
    expiration, dte, cleared = _pick_expiration(
        expirations, target_dte, min_dte, max_dte, expire_before=cutoff,
    )
    if not expiration:
        return None

    calls = _load_call_chain(ticker, expiration, spot, div_yield)
    if not calls:
        return None

    dte_eff = max(dte or 1, 1)
    T = dte_eff / 365.0

    # Start with every genuinely OTM call that has two live sides. The user's
    # extra OTM floor is a spread constraint, not a chain-availability test: if a
    # chain only offers (say) a 0.7%-OTM short against the requested 1% floor, we
    # should return that pair as a relaxed watchlist candidate instead of falsely
    # reporting that no two-leg market exists.
    legs = sorted(
        (c for c in calls if _quotable(c) and c["strike"] > spot),
        key=lambda c: c["strike"],
    )
    if len(legs) < 2:
        return None

    # The resistance floor applies to the *short* leg only — the long leg exists
    # to cap the tail and belongs wherever the width wants it.
    res = _num(resistance)
    short_universe = legs
    if respect_resistance and res and res > spot:
        above_wall = [c for c in legs if c["strike"] >= res]
        if above_wall:
            short_universe = above_wall

    short_pool = _delta_pool(
        short_universe, short_delta, delta_tolerance, spot, forecast_vol or 0.0, T,
    )
    long_pool = _delta_pool(
        legs, long_delta, delta_tolerance, spot, forecast_vol or 0.0, T,
    )
    preferred_pairs = {
        (short_leg["strike"], long_leg["strike"])
        for short_leg in short_pool
        for long_leg in long_pool
        if long_leg["strike"] > short_leg["strike"]
    }

    lo_width = spot * max(0.0, min_width_pct) / 100.0
    hi_width = spot * max(min_width_pct, max_width_pct) / 100.0

    all_pairs: list[dict] = []
    passing: list[dict] = []

    # Delta pools express a preference, not whether a spread exists. On sparse
    # chains it is common for the target short and long pools to contain only the
    # same highest strike, even though the adjacent lower/higher strikes form a
    # perfectly valid vertical. Enumerate every ordered pair, then prefer the
    # target-delta pairs when choosing among otherwise eligible structures.
    #
    # Respecting resistance can create the same edge case when the only strike
    # above the wall is also the highest quoted strike. In that case there is no
    # way to buy a higher hedge while keeping the short above resistance, so fall
    # back to the whole OTM chain and report the chosen pair as constraint-relaxed.
    pair_short_universe = short_universe
    if not any(
        long_leg["strike"] > short_leg["strike"]
        for short_leg in pair_short_universe
        for long_leg in legs
    ):
        pair_short_universe = legs

    for short_leg in pair_short_universe:
        for long_leg in legs:
            pair = _build_credit_pair(
                short_leg, long_leg, spot, dte_eff, forecast_vol, div_yield, resistance=res,
            )
            if pair is None:
                continue
            all_pairs.append(pair)
            if pair["width"] < lo_width or pair["width"] > hi_width:
                continue
            if (
                pair["short_otm_pct"] is not None
                and pair["short_otm_pct"] < min_otm_pct
            ):
                continue
            if (
                respect_resistance
                and res
                and res > spot
                and not pair.get("clears_resistance")
            ):
                continue
            if pair["natural_credit"] <= 0:
                continue
            if pair["credit_pct_of_width"] < min_credit_pct_of_width:
                continue
            if (
                pair["breakeven_cushion_pct"] is not None
                and pair["breakeven_cushion_pct"] < min_cushion_pct
            ):
                continue
            if pair["open_interest_min"] < min_open_interest:
                continue
            if pair["exec_cost_pct"] is None or pair["exec_cost_pct"] > max_exec_cost_pct:
                continue
            passing.append(pair)

    # Falling back rather than returning nothing mirrors how the covered call
    # screen handles an unreachable cost-basis floor: show the trade and say the
    # constraint could not be met, instead of hiding the candidate.
    pool = passing or all_pairs
    if not pool:
        return None
    preferred_pool = [
        pair for pair in pool
        if (pair["short_strike"], pair["long_strike"]) in preferred_pairs
    ]
    best = max(preferred_pool or pool, key=_pair_quality)
    resistance_floor_binding = bool(
        respect_resistance
        and res
        and res > spot
        and best.get("clears_resistance")
        and any(leg["strike"] < res for leg in legs)
    )

    # At-the-money IV for the IV/RV comparison, off the whole chain rather than
    # the chosen strikes, so skew does not contaminate the vol-level reading.
    atm = min(calls, key=lambda c: abs(c["strike"] - spot))
    atm_iv = atm["iv"] if atm["iv"] > 0 else best["short_leg"]["iv"]

    upside_tail_ratio, tail_strikes = _upside_wing(calls, atm_iv)

    expiry_d = datetime.strptime(expiration, "%Y-%m-%d").date()

    # The short-call-specific event risk, and the reason this screen imports from
    # call_scanner at all. In a covered call, early exercise for a dividend means
    # delivering shares already owned. Here it leaves a short stock position that
    # was never intended, plus a long call, plus the dividend owed.
    ex_div_iso, ex_div_estimated = next_ex_dividend(fund or {})
    ex_div_d = _parse_date(ex_div_iso)
    ex_div_inside = bool(ex_div_d and ex_div_d <= expiry_d)
    dividend = expected_dividend_amount(fund or {}, spot)
    early = assess_early_assignment(
        best["short_leg"]["mid"], spot, best["short_strike"], dividend, ex_div_inside,
    )

    return {
        **best,
        "expiration": expiration,
        "dte": dte,
        "atm_iv": atm_iv,
        "upside_tail_ratio": upside_tail_ratio,
        "upside_tail_strikes": tail_strikes,
        "constraints_relaxed": not passing,
        "pairs_considered": len(all_pairs),
        # The level and its name travel together so the management plan cannot
        # quote one level's price against another level's label.
        "resistance": _round(res),
        "resistance_label": resistance_label,
        "resistance_floor_binding": resistance_floor_binding,
        "earnings_date": earnings_d.isoformat() if earnings_d else None,
        "avoids_earnings": cleared if earnings_d else None,
        "days_earnings_after_expiry": ((earnings_d - expiry_d).days if earnings_d else None),
        "ex_dividend_date": ex_div_iso,
        "ex_dividend_estimated": ex_div_estimated,
        "ex_dividend_inside": ex_div_inside,
        "dividend_amount": _round(dividend),
        "early_assignment": early,
    }


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_candidate(tech: dict, fund: dict, spread: dict | None,
                    earnings_buffer_days: int = 5) -> dict:
    """Rate a name as a bear call spread candidate on four independent axes.

    Rejection (30) - has the rally actually been refused, or is it still running?
    Ceiling   (20) - is there overhead supply for the short strike to hide behind?
    Credit    (25) - does the premium pay enough for the defined risk?
    Safety    (25) - can two legs be filled, and what can take the shares early?
    """
    flags: list[str] = []

    # ── Rejection ─────────────────────────────────────────────────────────
    rejection = 0.0

    # Rally size as a band (8). The single most important scoring decision on the
    # screen, and the same shape the bear put screen uses for the same reason: a
    # ramp would rank a runaway momentum thrust at the top, which is precisely
    # the trade that loses the whole width. Full credit for a 0.75-2σ bounce;
    # nothing above 3σ.
    rejection += _band(tech.get("rally_sigma"), 0.0, 0.75, 2.0, 3.0, 8)

    # Rolled over (7). Structure, not indicators.
    if tech.get("rolled_over"):
        rejection += 4       # the last week failed to take out the fortnight's high
    if tech.get("lower_high"):
        rejection += 3       # and this rally topped below the previous one

    # Momentum turning over (7). Falling RSI *from* an elevated level, not a high
    # flat RSI — a high flat reading is a trend, and this screen is short that.
    roll = _num(tech.get("rsi_roll_pp"))
    rejection += _ramp(-(roll if roll is not None else 0.0), 2, 18, 4)
    rejection += _band(tech.get("rsi_prior"), 45, 55, 72, 88, 3)

    # Cooling off (4). Positive acceleration is the enemy.
    accel = _num(tech.get("accel_pp"))
    rejection += _ramp(-(accel if accel is not None else 0.0), 0, 8, 4)

    # Not a leader (4). Full credit when it is lagging the beta-adjusted market;
    # nothing once it is beating it. Selling calls on the market's leader is the
    # fastest way to find out what the width costs.
    strength = _num(tech.get("rel_strength_pct"))
    rejection += _ramp(-(strength if strength is not None else 0.0), -6, 4, 4)

    # Penalties, subtracted from the axis whose thesis they falsify. These are
    # deliberately heavy — heavier than a flag-only treatment — because each one
    # is direct evidence that the rally has *not* been refused, which is the only
    # thing this axis claims. The default gates already exclude every condition
    # below, so a name only reaches here when the user has loosened a gate, and
    # that is precisely when the score has to argue back instead of nodding
    # along. A single disqualifier should cost a letter grade; two should make it
    # unrateable.
    if tech.get("fresh_high"):
        rejection -= 10
        flags.append("Making fresh 52-week highs")
    if accel is not None and accel > 3:
        rejection -= _ramp(accel, 3, 10, 6)
        flags.append("Momentum still accelerating")
    if strength is not None and strength > 4:
        rejection -= _ramp(strength, 4, 12, 6)
        flags.append("Leading the market — do not sell its calls")
    rsi = _num(tech.get("rsi_14"))
    if rsi is not None and rsi >= 70 and (roll is None or roll >= 0):
        rejection -= 5
        flags.append("Overbought and still rising")
    # Squeeze fuel. Flagging this without charging for it would be the same
    # mistake as the covered call screen treating "overbought" as a signal: a
    # squeeze runs to the full width while the credit caps the gain at a nickel.
    run_off_low = _num(tech.get("run_off_low_pct"))
    if run_off_low is not None and run_off_low >= 12:
        rejection -= _ramp(run_off_low, 12, 30, 8)
        flags.append("Sharp run off the recent low — squeeze risk")

    rejection = max(0.0, rejection)

    # ── Ceiling ───────────────────────────────────────────────────────────
    ceiling = 0.0
    _, res_label, res_gap = nearest_resistance(tech)

    # Distance to the wall as a band (8). Close overhead resistance is the point:
    # the wall is what stops the advance. Too far away and it is not in play for
    # this expiration; no level above at all scores nothing, because then there is
    # nothing between spot and the short strike but hope.
    ceiling += _band(res_gap, -1.0, 0.5, 6.0, 15.0, 8)

    # A downtrend is the highest-probability home for this trade (4): selling
    # rips into a falling market is the setup, and the covered call screen cannot
    # take it because a call writer there already owns the falling shares.
    if tech.get("sma50_below_sma200"):
        ceiling += 4

    # Under a flat-or-falling 50-day (4). Slope is what separates resistance from
    # support that is about to be reclaimed.
    slope50 = _num(tech.get("sma50_slope_pct"))
    if tech.get("below_sma50") and (slope50 is None or slope50 <= 0.5):
        ceiling += 4
    elif tech.get("above_sma50") and slope50 is not None and slope50 > 1.5:
        flags.append("Above a rising 50-day average")

    # Mid-range in the 52-week range (4). At the highs there is no wall left; at
    # the lows there is squeeze fuel and a flat call skew that pays nothing.
    ceiling += _band(tech.get("pct_of_52w_range"), 10, 30, 78, 96, 4)

    if res_gap is None:
        flags.append("No overhead resistance identified")

    # ── Credit ────────────────────────────────────────────────────────────
    credit_score = 0.0
    iv_rv = None
    if spread:
        atm_iv = _num(spread.get("atm_iv"))
        rv = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        if atm_iv and rv and rv > 0:
            iv_rv = atm_iv / rv
        # Rich implied vol against realized (8). This term reads the *normal*
        # direction here: the bear put screen punishes a high ratio because it
        # buys, this one rewards it because it sells.
        credit_score += _ramp(iv_rv, 0.95, 1.45, 8)
        # Credit against realized-vol fair value (7). The ramp starts at zero
        # rather than below it because the driftless call fair value already
        # flatters the seller — see call_vertical_fair_value.
        credit_score += _ramp(spread.get("premium_edge_pct"), 0, 35, 7)
        credit_score += _ramp(spread.get("annualized_return_on_risk_pct"), 15, 55, 6)
        credit_score += _ramp(spread.get("credit_pct_of_width"), 15, 35, 4)

        if (spread.get("credit_pct_of_width") or 0) < 20:
            flags.append("Credit too small for the defined risk")
        if (spread.get("premium_edge_pct") or 0) < 0:
            flags.append("Credit below realized-vol fair value")
        if iv_rv is not None and iv_rv < 0.9:
            flags.append("Implied vol cheap — poor time to sell premium")

    # ── Safety ────────────────────────────────────────────────────────────
    safety = 0.0
    ticker = tech.get("ticker") or ""
    is_fund = _is_fund(fund, ticker)
    fund_kind = _fund_kind(ticker, fund) if is_fund else None
    size = _fund_size(fund) or 0.0

    # Size (3). Judged for gap risk rather than business quality: the short leg
    # is never assigned into a business here, but a takeover bid on a small
    # underlying gaps straight through any call strike.
    if size >= 50e9:
        safety += 3
    elif size >= 10e9:
        safety += 2.5
    elif size >= 2e9:
        safety += 1.8
    elif size >= 500e6:
        safety += 1.0
    else:
        safety += 0.3
        flags.append("Small underlying — takeover gap risk")

    if is_fund and fund_kind == "leveraged":
        flags.append("Leveraged or inverse fund")

    # Share liquidity (3) — the proxy for how tight the chain will be.
    adv = _num(tech.get("avg_dollar_volume")) or 0.0
    if adv >= 200e6:
        safety += 3
    elif adv >= 50e6:
        safety += 2.4
    elif adv >= 20e6:
        safety += 1.8
    elif adv >= 5e6:
        safety += 0.9
    else:
        flags.append("Thin share liquidity")

    early_level = None
    if spread:
        # Probability the short strike is never reached (5).
        safety += _ramp(spread.get("prob_otm"), 65, 88, 5)
        # Cushion above spot (4) — the room the stock has to rally before this
        # stops working.
        safety += _ramp(spread.get("breakeven_cushion_pct"), 3, 12, 4)
        # Combined leg slippage (3). Two markets to cross, both out of the credit.
        cost_pct = _num(spread.get("exec_cost_pct"))
        safety += _ramp(-(cost_pct if cost_pct is not None else 100.0), -35, -8, 3)
        # Open interest on the weaker leg (2). A vertical is only as liquid as its
        # thinner side, since closing it needs both.
        safety += _ramp(spread.get("open_interest_min"), 50, 500, 2)
        # A credit that survives crossing both markets (2).
        if (_num(spread.get("natural_credit"), 0.0) or 0.0) > 0:
            safety += 2
        # The short strike hides behind the wall (3) — this screen's own term.
        if spread.get("clears_resistance"):
            safety += 3

        if cost_pct is None or cost_pct > 30:
            flags.append("Two-leg slippage is high")
        if (spread.get("open_interest_min") or 0) < 50:
            flags.append("Thin open interest on one leg")
        if (spread.get("prob_otm") or 100) < 65:
            flags.append("Short strike is too close")
        if (_num(spread.get("natural_credit"), 0.0) or 0.0) <= 0:
            flags.append("No credit after crossing both markets")
        if spread.get("clears_resistance") is False:
            flags.append("Short strike sits below resistance")
        if spread.get("constraints_relaxed"):
            flags.append("No pair met every spread filter")

        # A fat upside wing: the market is paying for a jump, which is the exact
        # move that costs this trade the width. The reverse of how the bear put
        # screen reads put skew, where a steep wing is a gift because you sell it.
        #
        # Threshold at 1.05, not 1.0, because the measured baseline sits *below*
        # parity — a median near 0.95 on single names and 0.75 on index funds. And
        # worth 4 points rather than the 5 the other Safety deductions carry,
        # because this is the noisiest input on the screen: it is a median of a
        # handful of thin far-OTM quotes, and `_upside_wing` returns None rather
        # than a guess whenever the band is too thin to trust.
        tail = _num(spread.get("upside_tail_ratio"))
        if tail is not None and tail > 1.05:
            safety = max(0.0, safety - _ramp(tail, 1.05, 1.25, 4))
            flags.append("Upside calls bid — someone is paying for the rally")

        # Early assignment for the dividend. Weighted harder than on the covered
        # call screen because the consequence is worse: a short stock position
        # nobody intended rather than shares delivered from inventory.
        early = spread.get("early_assignment") or {}
        early_level = early.get("level")
        if early_level == "high":
            safety = max(0.0, safety - 6)
            flags.append("Dividend invites early assignment")
        elif early_level == "elevated":
            safety = max(0.0, safety - 3)
            flags.append("Dividend is a large share of the credit")

    # ── Event risk ────────────────────────────────────────────────────────
    # An earnings report inside a short call is the one gap that cannot be
    # managed: the pre-announcement implied vol is what made the credit look
    # generous, and a gap up runs straight to the width overnight.
    earnings_before_expiry = None
    earnings_date = _parse_date(fund.get("next_earnings"))
    expiry_date = _parse_date(spread["expiration"]) if spread else None
    if earnings_date and expiry_date:
        earnings_before_expiry = earnings_date <= expiry_date
        gap = (earnings_date - expiry_date).days
        if earnings_before_expiry:
            flags.append("Earnings before expiration")
            safety = max(0.0, safety - 8)
        elif gap <= earnings_buffer_days:
            flags.append(f"Earnings {gap}d after expiry")

    total = rejection + ceiling + credit_score + safety
    # Without a chain the Credit axis and most of Safety cannot score, so rate on
    # what was scorable. That inflates the normalized number rather than
    # deflating it, which is why run_bear_call_spread_scan ranks unpriced rows
    # below every priced one instead of letting the smaller denominator float
    # them up.
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
        "score": round(max(0.0, min(100.0, normalized)), 1),
        "grade": grade,
        "components": {
            "rejection": round(rejection, 1),
            "ceiling": round(ceiling, 1),
            "credit": round(credit_score, 1),
            "safety": round(safety, 1),
        },
        "component_max": {
            "rejection": 30, "ceiling": 20, "credit": 25, "safety": 25,
        },
        "iv_rv_ratio": _round(iv_rv, 2),
        "resistance_label": res_label,
        "resistance_gap_pct": _round(res_gap, 1),
        "early_assignment_level": early_level,
        "earnings_before_expiry": earnings_before_expiry,
        "days_to_earnings": (earnings_date - date.today()).days if earnings_date else None,
        "is_fund": is_fund,
        "fund_kind": fund_kind,
        "flags": list(dict.fromkeys(flags)),
        "scored_on_partial": spread is None,
    }


# ---------------------------------------------------------------------------
# Trade management
# ---------------------------------------------------------------------------

def recommend_management(spread: dict | None, rating: dict | None,
                         tech: dict | None = None) -> dict | None:
    """Close-early plan for a short call vertical.

    The bull put screen manages one number — how much of the credit to keep.
    This one has to manage three more, all of them specific to being short a
    *call*:

      * A hard close-by date when an ex-dividend falls inside the trade. Early
        exercise for a dividend happens the day before the ex-date, so the plan
        is to be out before it rather than to react afterwards. This is the one
        risk on the screen with an exact calendar answer.
      * An invalidation *price* rather than only a debit. The thesis is that a
        rally was rejected at a level, so it dies when price reclaims that level,
        which usually happens well before the defined loss is reached.
      * A profit target set below the theoretical maximum. Holding a short
        vertical to expiry trades the last few percent of the credit for pin risk
        on the short strike, which is a poor exchange.
    """
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
        "Making fresh 52-week highs",
        "Momentum still accelerating",
        "Leading the market — do not sell its calls",
        "Sharp run off the recent low — squeeze risk",
        "Upside calls bid — someone is paying for the rally",
        "Dividend invites early assignment",
        "Short strike sits below resistance",
        "No pair met every spread filter",
    }
    has_material_risk = bool(flags & material)

    if grade == "A" and score >= 80 and not has_material_risk:
        capture_pct = 65.0
        profile = "Strong setup"
        rationale = (
            "A high setup score and a clean two-leg market support holding for "
            "65% of the credit before buying it back."
        )
    elif grade in {"A", "B"} and not has_material_risk:
        capture_pct = 60.0
        profile = "Balanced setup"
        rationale = (
            "A 60% target banks most of the credit without holding through the "
            "last and most gamma-sensitive stretch of the trade."
        )
    else:
        capture_pct = 50.0
        profile = "Defensive setup"
        rationale = (
            "The setup or the two-leg market carries added risk, so this takes "
            "half the credit and closes sooner."
        )

    target_debit = max(0.01, round(credit * (1.0 - capture_pct / 100.0), 2))
    # Doubling the credit is the conventional risk trigger on a short vertical,
    # capped just inside the width because beyond it the spread cannot trade.
    stop_debit = min(width - 0.01, max(credit + 0.01, round(credit * 2.0, 2)))
    dte = max(1, int(_num(spread.get("dte"), 1) or 1))
    reassess_dte = 21 if dte >= 45 else max(10, int(round(dte * 0.4)))

    # The dividend deadline, which only a short call has.
    close_before = None
    close_before_note = None
    ex_div = _parse_date(spread.get("ex_dividend_date"))
    early_level = (spread.get("early_assignment") or {}).get("level")
    if ex_div and spread.get("ex_dividend_inside") and early_level in {"elevated", "high"}:
        close_before = ex_div.isoformat()
        estimated = " (estimated)" if spread.get("ex_dividend_estimated") else ""
        close_before_note = (
            f"Be out before the {ex_div.isoformat()} ex-dividend date{estimated}. A call "
            f"holder exercises the day before an ex-date once the remaining extrinsic "
            f"value is worth less than the dividend, and in a spread that leaves you "
            f"short 100 shares you never owned, holding a long call, and owing the "
            f"dividend."
        )

    # The thesis is a rejected rally, so the level that kills it is a price: the
    # first overhead level the short strike was placed behind.
    invalidate_price = None
    invalidate_label = None
    res = _num(spread.get("resistance"))
    if res:
        invalidate_price = res
        invalidate_label = spread.get("resistance_label") or "level"
    else:
        level, label, _ = nearest_resistance(tech or {})
        if level:
            invalidate_price, invalidate_label = level, label

    if invalidate_price:
        invalidate_note = (
            f"The thesis is a rally refused at the {invalidate_label} near "
            f"${invalidate_price:.2f}, so it dies on a close back above it. That level "
            f"is reached long before the defined loss is, which is the point of "
            f"watching it."
        )
    else:
        invalidate_note = (
            "No clear overhead level was identified, so there is no price that "
            "cleanly invalidates the thesis — manage this one on the debit alone."
        )

    return {
        "target_debit": target_debit,
        "profit_capture_pct": round((credit - target_debit) / credit * 100.0, 1),
        "target_profit_dollars": round((credit - target_debit) * CONTRACT_MULTIPLIER, 0),
        "stop_debit": stop_debit,
        "stop_loss_dollars": round(max(0.0, stop_debit - credit) * CONTRACT_MULTIPLIER, 0),
        "entry_credit_basis": round(credit, 2),
        "reassess_dte": reassess_dte,
        "close_by_dte": 3,
        "close_before": close_before,
        "close_before_note": close_before_note,
        "invalidate_price": _round(invalidate_price),
        "invalidate_note": invalidate_note,
        "profile": profile,
        "rationale": (
            f"{rationale} Close both legs together with a single vertical limit order. "
            f"The target removes assignment and pin risk once most of the planned "
            f"credit is earned; the stop is a risk trigger, not a guaranteed fill."
        ),
    }


def build_verdict(row: dict) -> str:
    """One line explaining why this name is (or is not) worth a bear call spread."""
    s = row.get("spread") or {}
    rally = _num(row.get("rally_sigma")) or 0.0
    grade = row.get("grade")

    subject = {
        "index": "Broad index fund",
        "sector": "Sector fund",
        "leveraged": "Leveraged fund",
        "narrow": "Narrow fund",
    }.get(row.get("fund_kind") or "", "Rejected rally")

    structure_words = []
    if row.get("lower_high"):
        structure_words.append("a lower high")
    if row.get("rolled_over"):
        structure_words.append("rolled over off its 20-day high")
    if row.get("sma50_below_sma200"):
        structure_words.append("50-day under the 200-day")
    strength = _num(row.get("rel_strength_pct"))
    if strength is not None and strength < -1:
        structure_words.append(f"trailing the market by {abs(strength):.0f}pp")
    structure = ", ".join(structure_words) or f"{rally:.1f}σ bounce over the window"

    quality = {
        "A": "Clean setup", "B": "Solid setup", "C": "Workable setup",
    }.get(grade or "", "Marginal setup")
    if row.get("is_fund"):
        lead = f"{subject}, {quality.lower()} — {structure}"
    else:
        lead = f"{quality} — {structure}"

    if row.get("resistance_label") and row.get("resistance_gap_pct") is not None:
        lead += f", with the {row['resistance_label']} {row['resistance_gap_pct']:.1f}% overhead"

    if s.get("short_strike") and s.get("credit"):
        lead += (
            f". Sell the {s['expiration']} ${s['short_strike']:g}/${s['long_strike']:g} call spread "
            f"for about ${s['credit']:.2f} — collect ${s['max_profit_dollars']:.0f} against "
            f"${s['max_loss_dollars']:.0f} of risk"
        )
        if s.get("prob_otm") is not None:
            lead += f", with about {s['prob_otm']:.0f}% modeled odds of staying below the strike"
        if s.get("breakeven_cushion_pct") is not None:
            lead += f" and a {s['breakeven_cushion_pct']:.1f}% cushion"
            if s.get("breakeven_sigma") is not None:
                lead += f" ({s['breakeven_sigma']:.1f}σ over {s['dte']}d)"
        plan = s.get("management") or {}
        if plan.get("target_debit") is not None:
            lead += (
                f". Buy it back near ${plan['target_debit']:.2f} for about "
                f"{plan['profit_capture_pct']:.0f}% of the credit"
            )

    flags = row.get("flags") or []
    if "Making fresh 52-week highs" in flags:
        lead += ". Already at fresh highs — no wall left above, and this is where a short call gets run over"
    elif "Momentum still accelerating" in flags:
        lead += ". Momentum is still building, so the rally has not actually been refused yet"
    elif "Leading the market — do not sell its calls" in flags:
        lead += ". It is outrunning the market, which is the one profile never to sell calls against"
    elif "Sharp run off the recent low — squeeze risk" in flags:
        lead += ". The run off the recent low has the shape of a squeeze, and a squeeze runs to the full width"
    elif "Upside calls bid — someone is paying for the rally" in flags:
        lead += ". The far call carries more implied vol than at-the-money, so the market is pricing a jump upward"
    elif "Dividend invites early assignment" in flags:
        lead += ". The dividend inside this expiration is large against the credit, so early exercise is live"
    elif "Earnings before expiration" in flags:
        lead += ". Earnings land inside the trade — the one gap a short call cannot manage"
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
    "include_index_etfs": True,
    "include_sector_etfs": False,
    "lookback_days": 21,
    "min_market_cap": 5e9,
    # Higher than the bear put screen's floor. Not for liquidity — for gap risk:
    # a takeover bid is the one event that runs a short call to the full width
    # overnight, and it lands on small companies.
    "small_cap_min_market_cap": 2e9,
    "fund_min_aum": 500e6,
    "exclude_leveraged_funds": True,
    "min_avg_dollar_volume": 25e6,
    # ── Directional gates ────────────────────────────────────────────────
    # The rally band. Sigma is already volatility-normalized, so unlike a raw
    # percentage these need no separate fund floors: a 1σ bounce means the same
    # thing for SPY and for a semiconductor. The ceiling is the gate that stops
    # this screen from becoming a momentum-fader.
    "min_rally_sigma": 0.3,
    "max_rally_sigma": 2.5,
    # Leadership is disqualifying, so this is a *maximum*, not a minimum — the
    # only screen in the family where the relative-performance gate points this
    # way.
    "max_rel_strength_pct": 4.0,
    "fund_max_rel_strength_pct": 2.0,
    "require_rolled_over": True,
    "require_below_sma50": False,
    "require_downtrend": False,
    "require_resistance_overhead": True,
    # RSI has to be *rolling over*, not pinned high. A ceiling as well as a floor,
    # because a 75 RSI that is still climbing is a trend, not a rejection.
    "min_rsi": 35.0,
    "max_rsi": 68.0,
    "max_accel_pp": 3.0,
    # Squeeze fuel, gated rather than only flagged — the same treatment fresh
    # highs and acceleration get, because all three are the same statement: the
    # rally has not been refused yet.
    "max_run_off_low_pct": 20.0,
    "max_pct_of_52w_range": 92.0,
    "exclude_fresh_highs": True,
    "exclude_earnings_before_expiry": True,
    "earnings_buffer_days": 5,
    # ── Structure ────────────────────────────────────────────────────────
    # Shorter than the bear put screen's 45 days. A credit spread is paid by
    # time, so the 30-45 day window is where theta is worth the gamma; buying
    # more time as a seller means holding a short gamma position through more
    # opportunities to be wrong.
    "target_dte": 35,
    "min_dte": MIN_TARGET_DTE,
    "max_dte": MAX_TARGET_DTE,
    "short_delta": 0.25,
    "long_delta": 0.10,
    "delta_tolerance": 0.12,
    "min_width_pct": 1.0,
    "max_width_pct": 15.0,
    "min_credit_pct_of_width": 20.0,
    "min_cushion_pct": 3.0,
    "min_otm_pct": 1.0,
    "min_open_interest": 50,
    "max_exec_cost_pct": 30.0,
    "respect_resistance": True,
    "basis_mode": "original",
    "chain_limit": 20,
    "max_results": 40,
}


def _partition_candidate_rows(rows: list[dict], max_results: int) -> tuple[list[dict], list[dict]]:
    """Separate executable ideas from names that still need more work.

    The primary list is intentionally strict: it contains only a live spread
    whose strike pair cleared every user-supplied structure constraint. A relaxed
    fallback is still useful research, but it belongs beside unpriced names on
    the watchlist rather than beside an actionable order ticket.
    """
    actionable = [row for row in rows if row.get("chain_status") == "actionable"]
    watchlist = [row for row in rows if row.get("chain_status") != "actionable"]

    actionable.sort(key=lambda row: -(row.get("score") or 0))
    order = {"earnings": 0, "constraints_relaxed": 1, "unavailable": 2, "not_priced": 3}
    watchlist.sort(key=lambda row: (
        order.get(row.get("chain_status"), 4),
        -(row.get("score") or 0),
    ))
    return actionable[:max_results], watchlist[:max_results]


def run_bear_call_spread_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}

    lookback = max(5, min(126, int(_num(p["lookback_days"], 21))))
    min_cap = max(0.0, _num(p["min_market_cap"], 0.0) or 0.0)
    small_min_cap = max(0.0, _num(p["small_cap_min_market_cap"], 0.0) or 0.0)
    fund_min_aum = max(0.0, _num(p["fund_min_aum"], 0.0) or 0.0)
    min_adv = max(0.0, _num(p["min_avg_dollar_volume"], 0.0) or 0.0)
    min_rally = _num(p["min_rally_sigma"], 0.0) or 0.0
    max_rally = max(min_rally, _num(p["max_rally_sigma"], 99.0) or 99.0)
    max_strength = _num(p["max_rel_strength_pct"], 99.0)
    max_strength = 99.0 if max_strength is None else max_strength
    fund_max_strength = _num(p["fund_max_rel_strength_pct"], 99.0)
    fund_max_strength = 99.0 if fund_max_strength is None else fund_max_strength
    min_rsi = _num(p["min_rsi"], 0.0) or 0.0
    max_rsi = max(min_rsi, _num(p["max_rsi"], 100.0) or 100.0)
    max_accel = _num(p["max_accel_pp"], 99.0)
    max_accel = 99.0 if max_accel is None else max_accel
    max_run_off_low = _num(p["max_run_off_low_pct"], 999.0)
    max_run_off_low = 999.0 if max_run_off_low is None else max_run_off_low
    max_range_pct = _num(p["max_pct_of_52w_range"], 100.0) or 100.0
    target_dte = max(MIN_TARGET_DTE, min(MAX_TARGET_DTE, int(_num(p["target_dte"], 35))))
    min_dte = max(MIN_TARGET_DTE, int(_num(p["min_dte"], MIN_TARGET_DTE)))
    max_dte = max(min_dte, int(_num(p["max_dte"], MAX_TARGET_DTE)))
    short_delta = min(0.60, max(0.05, _num(p["short_delta"], 0.25) or 0.25))
    long_delta = min(short_delta - 0.01, max(0.01, _num(p["long_delta"], 0.10) or 0.10))
    delta_tol = min(0.35, max(0.02, _num(p["delta_tolerance"], 0.12) or 0.12))
    min_width = max(0.1, _num(p["min_width_pct"], 1.0) or 1.0)
    max_width = max(min_width, _num(p["max_width_pct"], 15.0) or 15.0)
    min_credit = min(90.0, max(1.0, _num(p["min_credit_pct_of_width"], 20.0) or 20.0))
    min_cushion = max(0.0, _num(p["min_cushion_pct"], 3.0) or 0.0)
    min_otm = max(0.0, _num(p["min_otm_pct"], 1.0) or 0.0)
    min_oi = max(0, int(_num(p["min_open_interest"], 50) or 0))
    max_exec = min(200.0, max(1.0, _num(p["max_exec_cost_pct"], 30.0) or 30.0))
    earnings_buffer = max(0, min(30, int(_num(p["earnings_buffer_days"], 5) or 0)))
    chain_limit = max(0, min(60, int(_num(p["chain_limit"], 20) or 0)))
    max_results = max(1, min(200, int(_num(p["max_results"], 40) or 40)))
    basis_mode = "broker_adjusted" if str(p.get("basis_mode") or "").lower().startswith(
        ("broker", "adjust")
    ) else "original"

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

    # Held shares are looked up regardless of universe, because a position turns
    # this trade into something materially safer: 100 shares makes the short leg
    # covered, so assignment delivers stock you already hold instead of opening a
    # short position. The screen says so rather than leaving the user to notice.
    try:
        positions = held_positions(p.get("profile_id"), p.get("aggregate_id"), basis_mode)
    except Exception:
        positions = {}

    hist = _load_history(tickers)
    if hist is None or hist.empty:
        return {
            "rows": [], "watchlist_rows": [], "stats": empty_stats, "params": p,
            "error": "Price history unavailable. Yahoo may be rate-limiting; try again shortly.",
        }

    etf_hint = INDEX_ETF_SET | SECTOR_ETF_SET
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

        rally = tech.get("rally_sigma")
        if rally is None or rally < min_rally or rally > max_rally:
            continue
        if p["require_rolled_over"] and not tech.get("rolled_over"):
            continue
        if p["require_below_sma50"] and not tech.get("below_sma50"):
            continue
        if p["require_downtrend"] and not tech.get("sma50_below_sma200"):
            continue
        rsi = tech.get("rsi_14")
        if rsi is not None and (rsi < min_rsi or rsi > max_rsi):
            continue
        accel = tech.get("accel_pp")
        if accel is not None and accel > max_accel:
            continue
        run_off_low = tech.get("run_off_low_pct")
        if run_off_low is not None and run_off_low > max_run_off_low:
            continue
        range_pct = tech.get("pct_of_52w_range")
        if range_pct is not None and range_pct > max_range_pct:
            continue
        if (tech.get("avg_dollar_volume") or 0.0) < min_adv:
            continue
        if p["exclude_fresh_highs"] and tech.get("fresh_high"):
            continue
        if p["require_resistance_overhead"] and nearest_resistance(tech)[0] is None:
            continue

        # Relative strength is a raw percentage, so it does need the fund split
        # that the sigma gates do not. A curated ticker is known up front;
        # anything from holdings, a watchlist, or a custom list is unknown until
        # stage 2, so it clears the looser ceiling here and is re-checked with the
        # right one.
        strength = tech.get("rel_strength_pct")
        if ticker in etf_hint:
            strength_ceiling = fund_max_strength
        elif ticker in CURATED_STOCK_SET or ticker in SMALL_CAP_SET:
            strength_ceiling = max_strength
        else:
            strength_ceiling = max(max_strength, fund_max_strength)
        if strength is not None and strength > strength_ceiling:
            continue

        tech["ticker"] = ticker
        price_pass.append(tech)

    # Rank the price stage so the expensive stages only touch the best names. The
    # key is *weakness* relative to the market — the least-loved names first —
    # because that is the part of the setup least likely to reverse on you.
    price_pass.sort(key=lambda t: (t.get("rel_strength_pct") if t.get("rel_strength_pct") is not None else 0.0))
    fundamentals = _fetch_fundamentals_bulk([t["ticker"] for t in price_pass])

    survivors: list[tuple[dict, dict]] = []
    for tech in price_pass:
        ticker = tech["ticker"]
        fund = fundamentals.get(ticker, {})
        is_fund = _is_fund(fund, ticker)
        strength = tech.get("rel_strength_pct")

        if is_fund:
            if strength is not None and strength > fund_max_strength:
                continue
            if fund_min_aum and (_num(fund.get("total_assets")) or 0.0) < fund_min_aum:
                continue
            if p["exclude_leveraged_funds"] and _fund_kind(ticker, fund) == "leveraged":
                continue
        else:
            if strength is not None and strength > max_strength:
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
        level, level_label, _ = nearest_resistance(tech)
        try:
            return _suggest_bear_call_spread(
                tech["ticker"], tech["price"], div_y, forecast_vol,
                target_dte, min_dte, max_dte,
                short_delta=short_delta, long_delta=long_delta,
                delta_tolerance=delta_tol,
                min_width_pct=min_width, max_width_pct=max_width,
                min_credit_pct_of_width=min_credit,
                min_cushion_pct=min_cushion,
                min_open_interest=min_oi,
                max_exec_cost_pct=max_exec,
                min_otm_pct=min_otm,
                resistance=level,
                resistance_label=level_label,
                respect_resistance=bool(p["respect_resistance"]),
                earnings_date=(
                    fund.get("next_earnings")
                    if p["exclude_earnings_before_expiry"] else None
                ),
                earnings_buffer_days=earnings_buffer,
                fund=fund,
            )
        except Exception:
            return None

    spreads: dict[str, dict | None] = {}
    if chain_targets:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for pair, spread in zip(chain_targets, pool.map(_chain_for, chain_targets)):
                spreads[pair[0]["ticker"]] = spread

    rows: list[dict] = []
    for tech, fund in survivors:
        ticker = tech["ticker"]
        spread = spreads.get(ticker)
        rating = score_candidate(tech, fund, spread, earnings_buffer_days=earnings_buffer)
        # _suggest_bear_call_spread already tried to find an expiration that
        # closes before the report; reaching here means none in the window could.
        excluded_for_earnings = bool(
            p["exclude_earnings_before_expiry"] and rating.get("earnings_before_expiry")
        )
        if excluded_for_earnings:
            dropped_for_earnings += 1
            continue
        if spread:
            management = recommend_management(spread, rating, tech)
            div_yield = dividend_yield_for_pricing(fund, tech.get("price"))
            probability_schedule = profit_probability_schedule(
                spot=tech.get("price"),
                dte=spread.get("dte"),
                expiration=spread.get("expiration"),
                distribution_iv=spread.get("atm_iv") or (
                    spread.get("short_leg") or {}
                ).get("iv"),
                entry_cashflow=spread.get("credit"),
                legs=[
                    {
                        "option_type": "call",
                        "strike": (spread.get("short_leg") or {}).get("strike"),
                        "iv": (spread.get("short_leg") or {}).get("iv"),
                        "quantity": -1,
                    },
                    {
                        "option_type": "call",
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
            )
            spread = {
                **spread,
                "management": management,
                "probability_schedule": probability_schedule,
            }

        if spread and not spread.get("constraints_relaxed"):
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
        covered_contracts = int(pos.get("contracts_writable") or 0)
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
            "rally_sigma": _round(tech.get("rally_sigma")),
            "drawdown_pct": _round(tech.get("drawdown_pct")),
            "excess_move_pct": _round(tech.get("excess_move_pct")),
            "rel_strength_pct": _round(tech.get("rel_strength_pct")),
            "beta": _round(tech.get("beta")),
            "rsi_14": _round(tech.get("rsi_14"), 1),
            "rsi_prior": _round(tech.get("rsi_prior"), 1),
            "rsi_roll_pp": _round(tech.get("rsi_roll_pp"), 1),
            "pct_of_52w_range": _round(tech.get("pct_of_52w_range"), 1),
            "above_52w_low_pct": _round(tech.get("above_52w_low_pct"), 1),
            "week52_high": _round(tech.get("week52_high")),
            "week52_low": _round(tech.get("week52_low")),
            "sma_20": _round(tech.get("sma_20")),
            "sma_50": _round(tech.get("sma_50")),
            "sma_200": _round(tech.get("sma_200")),
            "sma20_slope_pct": _round(tech.get("sma20_slope_pct"), 2),
            "sma50_slope_pct": _round(tech.get("sma50_slope_pct"), 2),
            "above_sma20": tech.get("above_sma20"),
            "above_sma50": tech.get("above_sma50"),
            "below_sma20": tech.get("below_sma20"),
            "below_sma50": tech.get("below_sma50"),
            "sma50_below_sma200": tech.get("sma50_below_sma200"),
            "above_sma50_pct": _round(tech.get("above_sma50_pct"), 1),
            "swing_high_20": _round(tech.get("swing_high_20")),
            "swing_high_60": _round(tech.get("swing_high_60")),
            "rolled_over": tech.get("rolled_over"),
            "lower_high": tech.get("lower_high"),
            "pullback_from_high_pct": _round(tech.get("pullback_from_high_pct"), 1),
            "days_since_swing_high": tech.get("days_since_swing_high"),
            "fresh_high": tech.get("fresh_high"),
            "run_off_low_pct": _round(tech.get("run_off_low_pct"), 1),
            "accel_pp": _round(tech.get("accel_pp"), 1),
            "rv_30": _round(tech.get("rv_30"), 3),
            "rv_252": _round(tech.get("rv_252"), 3),
            "avg_dollar_volume": _num(tech.get("avg_dollar_volume")),
            "forward_pe": _round(fund.get("forward_pe"), 1),
            "target_mean_price": _round(fund.get("target_mean_price")),
            "next_earnings": fund.get("next_earnings"),
            # A position behind the trade changes what the short leg is: 100
            # shares makes it covered, so assignment delivers inventory instead
            # of opening a short.
            "shares_held": _round(pos.get("shares"), 4),
            "covered_contracts": covered_contracts,
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
                1 for r in displayed_rows if (r.get("covered_contracts") or 0) >= 1
            ),
            "resistance_bound": sum(
                1 for r in displayed_rows
                if (r.get("spread") or {}).get("resistance_floor_binding")
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
            "include_stocks": bool(p["include_stocks"]),
            "include_index_etfs": bool(p["include_index_etfs"]),
            "include_sector_etfs": bool(p["include_sector_etfs"]),
            "min_market_cap": min_cap, "small_cap_min_market_cap": small_min_cap,
            "fund_min_aum": fund_min_aum, "min_avg_dollar_volume": min_adv,
            "min_rally_sigma": min_rally, "max_rally_sigma": max_rally,
            "max_rel_strength_pct": max_strength,
            "fund_max_rel_strength_pct": fund_max_strength,
            "require_rolled_over": bool(p["require_rolled_over"]),
            "require_below_sma50": bool(p["require_below_sma50"]),
            "require_downtrend": bool(p["require_downtrend"]),
            "require_resistance_overhead": bool(p["require_resistance_overhead"]),
            "min_rsi": min_rsi, "max_rsi": max_rsi,
            "max_accel_pp": max_accel,
            "max_run_off_low_pct": max_run_off_low,
            "max_pct_of_52w_range": max_range_pct,
            "exclude_leveraged_funds": bool(p["exclude_leveraged_funds"]),
            "exclude_fresh_highs": bool(p["exclude_fresh_highs"]),
            "exclude_earnings_before_expiry": bool(p["exclude_earnings_before_expiry"]),
            "earnings_buffer_days": earnings_buffer,
            "target_dte": target_dte, "min_dte": min_dte, "max_dte": max_dte,
            "short_delta": short_delta, "long_delta": long_delta,
            "delta_tolerance": delta_tol,
            "min_width_pct": min_width, "max_width_pct": max_width,
            "min_credit_pct_of_width": min_credit, "min_cushion_pct": min_cushion,
            "min_otm_pct": min_otm, "min_open_interest": min_oi,
            "max_exec_cost_pct": max_exec,
            "respect_resistance": bool(p["respect_resistance"]),
            "basis_mode": basis_mode, "chain_limit": chain_limit,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def _round_spread(spread: dict | None) -> dict | None:
    if not spread:
        return None
    out = dict(spread)
    for key, decimals in (
        ("short_strike", 2), ("long_strike", 2), ("width", 2), ("credit", 2),
        ("natural_credit", 2), ("credit_pct_of_width", 1), ("max_profit", 2),
        ("max_loss", 2), ("reward_risk", 2), ("return_on_risk_pct", 1),
        ("annualized_return_on_risk_pct", 1), ("breakeven", 2),
        ("short_otm_pct", 1), ("breakeven_cushion_pct", 1),
        ("cushion_sigma", 2), ("breakeven_sigma", 2),
        ("expected_move_pct_life", 1), ("prob_otm", 1), ("prob_profit", 1),
        ("prob_max_profit", 1), ("fair_credit", 2), ("premium_edge", 2),
        ("premium_edge_pct", 1), ("call_skew_ratio", 3), ("upside_tail_ratio", 3),
        ("exec_cost", 2),
        ("exec_cost_pct", 1), ("atm_iv", 4), ("credit_dollars", 0),
        ("max_profit_dollars", 0), ("max_loss_dollars", 0),
        ("naked_credit", 2), ("tail_hedge_cost", 2), ("tail_hedge_pct_of_credit", 0),
        ("resistance_gap_pct", 1),
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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def register_routes(app):

    @app.route("/api/options/bear-call-spread-scan/universes", methods=["GET"])
    def bear_call_spread_scan_universes():
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

    @app.route("/api/options/bear-call-spread-scan", methods=["POST"])
    def bear_call_spread_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            payload.setdefault("profile_id", request.args.get("profile_id", type=int))
            payload.setdefault("aggregate_id", request.args.get("aggregate_id", type=int))
            payload.setdefault("basis_mode", request.args.get("basis_mode"))
            return jsonify(run_bear_call_spread_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
