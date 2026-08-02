"""Pure-math tests for the iron condor scanner. No network access.

The arithmetic identities matter here more than on the other screens, because
one of them is the thing practitioners most often get wrong and it silently
mis-ranks every candidate against every other: a condor's max loss is the
*wider wing* minus the credit, not the sum of the two wings, because price can
only ever finish on one side.

The rest of the interesting tests are inversions. This screen shares nearly all
its machinery with five others, and every way it deliberately disagrees with
them is a reason it exists:

  * every other screen wants a *direction*; this one penalises drift in either
    direction, so its gates read magnitudes where theirs read signs;
  * "flat" is not the same as "range-bound", and the efficiency ratio is the
    term that knows the difference — a round trip has zero net drift and is a
    terrible condor;
  * strikes are matched by delta, not by distance, because put skew makes those
    two things different and only one of them is neutral.

Each has a test that fails if the screen ever collapses into being one of its
siblings, or into the naive version of itself.
"""

import math
import os
import sys
import unittest
from datetime import date, timedelta
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import iron_condor_scanner as ic
import bull_put_spread_scanner as bull
import bear_call_spread_scanner as bcs


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def leg(strike, bid, ask, delta=None, iv=0.25, oi=500, volume=100):
    mid = (bid + ask) / 2.0
    return {
        "strike": float(strike), "bid": float(bid), "ask": float(ask),
        "mid": mid, "iv": iv, "delta": delta,
        "open_interest": oi, "volume": volume, "dte": 40,
    }


def standard_condor(**overrides):
    """A clean, balanced 10-wide condor on a $100 stock for $2.00 net credit."""
    kwargs = {
        "put_short": leg(90, 1.45, 1.55, delta=-0.16),
        "put_long": leg(80, 0.45, 0.55, delta=-0.07),
        "call_short": leg(110, 1.45, 1.55, delta=0.16),
        "call_long": leg(120, 0.45, 0.55, delta=0.07),
        "spot": 100.0, "dte": 40, "forecast_vol": 0.24, "div_yield": 0.0,
    }
    kwargs.update(overrides)
    return ic._build_condor(**kwargs)


def synthetic_frame(kind="range", days=300, seed=11):
    """Deterministic OHLCV shaped as a range, a trend, or a round trip.

    The round trip is the important one: it ends where it started, so every
    net-drift measurement calls it flat, and it is a disastrous condor.

    The range is an Ornstein-Uhlenbeck (AR(1) in log price) process rather than
    the smooth oscillation one reaches for first, and the difference is not
    cosmetic. A sine wave with a 60-day period carries a +0.88 lag-one return
    autocorrelation — it travels in one direction for a fortnight at a time — so
    at any horizon a condor cares about it is *locally trending*, and the
    variance ratio correctly reports it above 1. Mean reversion is a statement
    about returns offsetting each other, and OU is the process that actually has
    that property.
    """
    rng = np.random.default_rng(seed)
    noise = rng.normal(0.0, 0.008, days)
    if kind == "range":
        # Pulled back toward a fixed level, so returns anti-correlate.
        shocks = rng.normal(0.0, 0.02, days)
        log_p = np.zeros(days)
        for i in range(1, days):
            log_p[i] = 0.85 * log_p[i - 1] + shocks[i]
        close = 100.0 * np.exp(log_p)
    elif kind == "trend":
        close = 100.0 * np.exp(np.cumsum(noise + 0.004))
    elif kind == "round_trip":
        # Straight up for half the window, straight back down for the other.
        half = days // 2
        legs = np.concatenate([np.full(half, 0.006), np.full(days - half, -0.006)])
        close = 100.0 * np.exp(np.cumsum(legs + noise * 0.2))
    else:
        raise ValueError(kind)
    # Pandas 3 may produce one fewer observation when an invalid weekend end is
    # combined with `periods`. Normalize to the latest weekday so this pure-math
    # fixture is stable regardless of which day the suite runs.
    end = pd.Timestamp(date.today())
    while end.weekday() >= 5:
        end -= pd.Timedelta(days=1)
    index = pd.bdate_range(end=end, periods=days)
    return pd.DataFrame({
        "Open": close * 0.999, "High": close * 1.006,
        "Low": close * 0.994, "Close": close,
        "Volume": np.full(days, 4_000_000.0),
    }, index=index)


# ---------------------------------------------------------------------------
# The risk identity - the thing most often got wrong
# ---------------------------------------------------------------------------

class RiskArithmetic(unittest.TestCase):

    def test_max_loss_is_the_wider_wing_minus_credit_not_the_sum(self):
        """Price finishes on one side, so only one wing can ever be breached."""
        condor = standard_condor()
        self.assertIsNotNone(condor)
        # Net credit: (1.50 - 0.50) put side + (1.50 - 0.50) call side = 2.00
        self.assertAlmostEqual(condor["credit"], 2.00, places=6)
        self.assertAlmostEqual(condor["put_width"], 10.0, places=6)
        self.assertAlmostEqual(condor["call_width"], 10.0, places=6)
        # The correct answer, and the one brokers margin.
        self.assertAlmostEqual(condor["max_loss"], 8.00, places=6)
        # The wrong answer that summing the wings would give.
        self.assertNotAlmostEqual(condor["max_loss"], 18.00, places=6)
        self.assertAlmostEqual(condor["max_loss_dollars"], 800.0, places=6)

    def test_unequal_wings_risk_the_wider_side_only(self):
        condor = standard_condor(call_long=leg(125, 0.35, 0.45, delta=0.05))
        self.assertAlmostEqual(condor["put_width"], 10.0, places=6)
        self.assertAlmostEqual(condor["call_width"], 15.0, places=6)
        self.assertAlmostEqual(condor["max_wing"], 15.0, places=6)
        self.assertAlmostEqual(condor["credit"], 2.10, places=6)
        self.assertAlmostEqual(condor["max_loss"], 12.90, places=6)
        self.assertGreater(condor["wing_skew_pct"], 25.0)

    def test_return_on_risk_follows_the_corrected_denominator(self):
        condor = standard_condor()
        self.assertAlmostEqual(condor["return_on_risk_pct"], 2.00 / 8.00 * 100.0, places=6)
        self.assertAlmostEqual(
            condor["annualized_return_on_risk_pct"],
            condor["return_on_risk_pct"] * 365.0 / 40.0, places=6,
        )

    def test_breakevens_bracket_spot_and_use_the_whole_credit(self):
        condor = standard_condor()
        self.assertAlmostEqual(condor["lower_breakeven"], 88.00, places=6)
        self.assertAlmostEqual(condor["upper_breakeven"], 112.00, places=6)
        self.assertLess(condor["lower_breakeven"], 100.0)
        self.assertGreater(condor["upper_breakeven"], 100.0)

    def test_execution_cost_counts_all_four_markets(self):
        condor = standard_condor()
        # Four legs at $0.10 wide each.
        self.assertAlmostEqual(condor["exec_cost"], 0.40, places=6)
        self.assertAlmostEqual(condor["exec_cost_pct"], 0.40 / 2.00 * 100.0, places=6)

    def test_natural_credit_crosses_all_four_markets(self):
        condor = standard_condor()
        # (1.45 - 0.55) + (1.45 - 0.55) = 1.80
        self.assertAlmostEqual(condor["natural_credit"], 1.80, places=6)
        self.assertLess(condor["natural_credit"], condor["credit"])

    def test_recent_trade_estimates_do_not_invent_execution_prices(self):
        put_short = {**leg(90, 1.45, 1.55, delta=-0.16), "bid": 0.0}
        put_long = {**leg(80, 0.45, 0.55, delta=-0.07), "bid": 0.0}
        call_short = {**leg(110, 1.45, 1.55, delta=0.16), "bid": 0.0}
        call_long = {**leg(120, 0.45, 0.55, delta=0.07), "bid": 0.0}

        condor = standard_condor(
            put_short=put_short,
            put_long=put_long,
            call_short=call_short,
            call_long=call_long,
        )

        self.assertIsNotNone(condor)
        self.assertTrue(condor["uses_last_trade_prices"])
        self.assertEqual(condor["quote_source"], "last_trade_estimate")
        self.assertIsNone(condor["natural_credit"])
        self.assertIsNone(condor["exec_cost_pct"])

    def test_recent_trades_keep_the_complete_after_hours_scan_available(self):
        expiration = (date.today() + timedelta(days=40)).isoformat()
        puts = [
            leg(80, 0.0, 1.0, volume=100),
            leg(90, 0.0, 3.0, volume=100),
        ]
        calls = [
            leg(110, 0.0, 3.0, volume=100),
            leg(120, 0.0, 1.0, volume=100),
        ]
        fake_ticker = type("FakeTicker", (), {"options": [expiration]})()
        with (
            patch.object(ic.yf, "Ticker", return_value=fake_ticker),
            patch.object(ic, "_load_put_chain", return_value=puts),
            patch.object(ic, "_load_call_chain", return_value=calls),
        ):
            condor = ic._suggest_iron_condor(
                "TEST", 100.0, 0.0, 0.20, 40, 1, 1095,
                min_width_pct=1.0,
                max_width_pct=20.0,
                min_credit_pct_of_width=1.0,
                min_cushion_sigma=0.0,
                min_otm_pct=0.0,
                min_open_interest=0,
                max_exec_cost_pct=100.0,
            )

        self.assertIsNotNone(condor)
        self.assertTrue(condor["uses_last_trade_prices"])
        self.assertEqual(condor["quote_source"], "last_trade_estimate")
        self.assertTrue(condor["constraints_relaxed"])
        self.assertIsNone(condor["natural_cashflow"])

    def test_row_probability_matches_the_expiration_probability_card(self):
        distribution_iv = 0.18
        condor = standard_condor(distribution_iv=distribution_iv)
        expiration = (date.today() + timedelta(days=40)).isoformat()
        schedule = ic.profit_probability_schedule(
            spot=100.0,
            dte=40,
            expiration=expiration,
            distribution_iv=distribution_iv,
            entry_cashflow=condor["entry_cashflow"],
            risk_free_rate=ic.RISK_FREE,
            legs=[
                {"option_type": "put", "strike": condor["put_long_strike"],
                 "iv": condor["put_leg_long"]["iv"], "quantity": 1},
                {"option_type": "put", "strike": condor["put_short_strike"],
                 "iv": condor["put_leg_short"]["iv"], "quantity": -1},
                {"option_type": "call", "strike": condor["call_short_strike"],
                 "iv": condor["call_leg_short"]["iv"], "quantity": -1},
                {"option_type": "call", "strike": condor["call_long_strike"],
                 "iv": condor["call_leg_long"]["iv"], "quantity": 1},
            ],
        )

        expiration_point = next(point for point in schedule if point["kind"] == "expiration")
        self.assertAlmostEqual(
            condor["prob_profit"],
            expiration_point["probability_success_pct"],
            delta=0.11,
        )

    def test_credit_at_or_above_the_wing_is_rejected(self):
        """A credit exceeding the wing implies risk-free money, i.e. bad data."""
        self.assertIsNone(standard_condor(
            put_short=leg(90, 6.0, 6.1, delta=-0.16),
            call_short=leg(110, 6.0, 6.1, delta=0.16),
        ))

    def test_a_side_priced_as_a_debit_is_rejected(self):
        """Neither wing may subsidise the other into a guaranteed loss."""
        self.assertIsNone(standard_condor(
            put_short=leg(90, 0.20, 0.30, delta=-0.16),
            put_long=leg(80, 0.90, 1.00, delta=-0.07),
        ))

    def test_out_of_order_strikes_are_rejected(self):
        # Short call below the short put: not a condor.
        self.assertIsNone(standard_condor(
            call_short=leg(85, 1.45, 1.55, delta=0.16),
            call_long=leg(95, 0.45, 0.55, delta=0.07),
        ))


# ---------------------------------------------------------------------------
# Balance - delta, not distance
# ---------------------------------------------------------------------------

class Balance(unittest.TestCase):

    def test_equal_deltas_are_balanced_and_equal_distances_need_not_be(self):
        balanced = standard_condor()
        self.assertAlmostEqual(balanced["delta_gap"], 0.0, places=6)

        # Same strikes, but put skew makes the equidistant put a much higher
        # delta than the call. Distance-symmetric, delta-lopsided.
        skewed = standard_condor(
            put_short=leg(90, 1.95, 2.05, delta=-0.30),
            call_short=leg(110, 1.05, 1.15, delta=0.10),
        )
        self.assertAlmostEqual(skewed["delta_gap"], 0.20, places=6)
        self.assertGreater(skewed["delta_gap"], balanced["delta_gap"])

    def test_structure_delta_signs_the_lean(self):
        balanced = standard_condor()
        self.assertAlmostEqual(balanced["structure_delta"], 0.0, places=6)

        # A fat short put against a thin short call leans bullish (positive).
        bullish = standard_condor(
            put_short=leg(90, 1.95, 2.05, delta=-0.30),
            call_short=leg(110, 1.05, 1.15, delta=0.10),
        )
        self.assertGreater(bullish["structure_delta"], 0.0)

    def test_put_share_of_credit_detects_a_decorative_call_wing(self):
        lopsided = standard_condor(
            call_short=leg(110, 0.12, 0.18, delta=0.03),
            call_long=leg(120, 0.02, 0.06, delta=0.01),
        )
        self.assertGreater(lopsided["put_share_of_credit_pct"], 75.0)

    def test_scoring_flags_a_lopsided_structure_as_directional(self):
        tech = {"ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8, "rv_30": 0.22}
        fund = {"market_cap": 8e10}
        skewed = standard_condor(
            put_short=leg(90, 1.95, 2.05, delta=-0.30),
            call_short=leg(110, 1.05, 1.15, delta=0.10),
        )
        skewed = {**skewed, "expiration": "2099-01-01", "atm_iv": 0.28}
        rating = ic.score_candidate(tech, fund, skewed)
        self.assertIn("Lopsided — this is a directional trade", rating["flags"])


# ---------------------------------------------------------------------------
# Cushion - the nearer side is what the position has
# ---------------------------------------------------------------------------

class Cushion(unittest.TestCase):

    def test_min_cushion_sigma_takes_the_nearer_breakeven(self):
        condor = standard_condor(
            call_short=leg(104, 2.45, 2.55, delta=0.30),
            call_long=leg(114, 0.45, 0.55, delta=0.10),
        )
        self.assertLess(condor["upper_cushion_sigma"], condor["lower_cushion_sigma"])
        self.assertAlmostEqual(
            condor["min_cushion_sigma"], condor["upper_cushion_sigma"], places=9,
        )

    def test_both_cushions_are_positive_magnitudes(self):
        condor = standard_condor()
        self.assertGreater(condor["lower_cushion_sigma"], 0)
        self.assertGreater(condor["upper_cushion_sigma"], 0)

    def test_probability_of_profit_exceeds_probability_of_max_profit(self):
        """The breakevens sit outside the short strikes, so the window is wider."""
        condor = standard_condor()
        self.assertGreater(condor["prob_profit"], condor["prob_max_profit"])

    def test_a_breakeven_inside_the_expected_move_is_flagged(self):
        tech = {"ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8, "rv_30": 0.22}
        fund = {"market_cap": 8e10}
        tight = standard_condor(
            put_short=leg(97, 2.45, 2.55, delta=-0.40),
            call_short=leg(103, 2.45, 2.55, delta=0.40),
        )
        tight = {**tight, "expiration": "2099-01-01", "atm_iv": 0.28}
        self.assertLess(tight["min_cushion_sigma"], 1.0)
        rating = ic.score_candidate(tech, fund, tight)
        self.assertIn("A breakeven sits inside the expected move", rating["flags"])


# ---------------------------------------------------------------------------
# Range detection - "flat" is not "range-bound"
# ---------------------------------------------------------------------------

class RangeDetection(unittest.TestCase):

    def test_efficiency_ratio_separates_a_range_from_a_trend(self):
        ranging = ic._efficiency_ratio(synthetic_frame("range")["Close"], 60)
        trending = ic._efficiency_ratio(synthetic_frame("trend")["Close"], 60)
        self.assertLess(ranging, trending)
        self.assertLess(ranging, 0.45)
        self.assertGreater(trending, 0.45)

    def test_efficiency_ratio_rejects_a_round_trip_that_net_drift_calls_flat(self):
        """The test that justifies the whole term.

        A round trip ends where it began, so every net-drift measure — window
        return, stretch sigma, distance from a moving average — reports it as
        flat. It is a terrible condor: price crossed both wings getting there.
        """
        frame = synthetic_frame("round_trip")
        close = frame["Close"]
        net_drift_pct = abs(float(close.iloc[-1]) / float(close.iloc[0]) - 1.0) * 100.0
        self.assertLess(net_drift_pct, 12.0)          # net drift says "flat"
        # ...but the path was long in both directions, so this says otherwise.
        er_over_whole_window = ic._efficiency_ratio(close, len(close) - 1)
        self.assertLess(er_over_whole_window, 0.2)
        # And the round trip's high-to-low travel dwarfs its net move, which is
        # what the range-position and 52-week gates catch.
        travel_pct = (float(close.max()) - float(close.min())) / float(close.min()) * 100.0
        self.assertGreater(travel_pct, net_drift_pct * 3)

    def test_variance_ratio_below_one_means_mean_reverting(self):
        ranging_ret = np.log(
            synthetic_frame("range")["Close"] / synthetic_frame("range")["Close"].shift(1)
        ).dropna()
        trending_ret = np.log(
            synthetic_frame("trend")["Close"] / synthetic_frame("trend")["Close"].shift(1)
        ).dropna()
        vr_range = ic._variance_ratio(ranging_ret, 5)
        vr_trend = ic._variance_ratio(trending_ret, 5)
        self.assertIsNotNone(vr_range)
        self.assertIsNotNone(vr_trend)
        self.assertLess(vr_range, vr_trend)

    def test_variance_ratio_needs_enough_history(self):
        self.assertIsNone(ic._variance_ratio(pd.Series(np.zeros(30)), 5))

    def test_technicals_report_drift_as_a_magnitude_not_a_signed_value(self):
        """The screen has no opinion on which way it should not have gone."""
        up = ic._compute_technicals(synthetic_frame("trend"), None, 21)
        self.assertIsNotNone(up)
        self.assertGreaterEqual(up["drift_sigma"], 0.0)
        self.assertIn(up["drift_direction"], {"up", "down"})

    def test_a_ranging_name_scores_above_a_trending_one(self):
        fund = {"market_cap": 8e10}
        ranging = ic._compute_technicals(synthetic_frame("range"), None, 21)
        trending = ic._compute_technicals(synthetic_frame("trend"), None, 21)
        ranging["ticker"] = trending["ticker"] = "TEST"
        ranging["avg_dollar_volume"] = trending["avg_dollar_volume"] = 3e8
        r_score = ic.score_candidate(ranging, fund, None)["components"]["range"]
        t_score = ic.score_candidate(trending, fund, None)["components"]["range"]
        self.assertGreater(r_score, t_score)


# ---------------------------------------------------------------------------
# Inversions against the sibling screens
# ---------------------------------------------------------------------------

class Inversions(unittest.TestCase):

    def test_fresh_highs_and_fresh_lows_are_both_penalised(self):
        """Every other screen penalises one extreme; this one is short both tails."""
        fund = {"market_cap": 8e10}
        base = {
            "ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8,
            "efficiency_ratio": 0.2, "drift_sigma": 0.5, "variance_ratio": 0.9,
            "ma_slope_abs": 0.5, "rv_30": 0.22,
        }
        neutral = ic.score_candidate(base, fund, None)["components"]["range"]
        high = ic.score_candidate({**base, "fresh_high": True}, fund, None)["components"]["range"]
        low = ic.score_candidate({**base, "fresh_low": True}, fund, None)["components"]["range"]
        self.assertLess(high, neutral)
        self.assertLess(low, neutral)

    def test_relative_strength_is_penalised_in_either_direction(self):
        fund = {"market_cap": 8e10}
        base = {
            "ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8,
            "efficiency_ratio": 0.2, "drift_sigma": 0.5, "variance_ratio": 0.9,
            "ma_slope_abs": 0.5, "rv_30": 0.22,
        }
        flat = ic.score_candidate(base, fund, None)["components"]["range"]
        leader = ic.score_candidate({**base, "rel_strength_pct": 12.0}, fund, None)
        laggard = ic.score_candidate({**base, "rel_strength_pct": -12.0}, fund, None)
        self.assertLess(leader["components"]["range"], flat)
        self.assertLess(laggard["components"]["range"], flat)
        self.assertIn("Trending against the market — not neutral", leader["flags"])
        self.assertIn("Trending against the market — not neutral", laggard["flags"])

    def test_rsi_is_a_band_centred_on_fifty_not_a_ramp(self):
        """Overbought and oversold are both wrong here, unlike on every sibling."""
        fund = {"market_cap": 8e10}
        base = {
            "ticker": "TEST", "avg_dollar_volume": 3e8, "efficiency_ratio": 0.2,
            "drift_sigma": 0.5, "variance_ratio": 0.9, "ma_slope_abs": 0.5, "rv_30": 0.22,
        }
        mid = ic.score_candidate({**base, "rsi_14": 50}, fund, None)["components"]["range"]
        hot = ic.score_candidate({**base, "rsi_14": 78}, fund, None)["components"]["range"]
        cold = ic.score_candidate({**base, "rsi_14": 22}, fund, None)["components"]["range"]
        self.assertGreater(mid, hot)
        self.assertGreater(mid, cold)

    def test_iv_richness_scores_the_selling_direction(self):
        """Like the two credit screens and unlike the bear put screen, rich is good."""
        tech = {
            "ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8,
            "rv_30": 0.20, "rv_contraction": 0.9,
        }
        fund = {"market_cap": 8e10}
        cheap = {**standard_condor(), "expiration": "2099-01-01", "atm_iv": 0.18}
        rich = {**standard_condor(), "expiration": "2099-01-01", "atm_iv": 0.32}
        self.assertGreater(
            ic.score_candidate(tech, fund, rich)["components"]["vol"],
            ic.score_candidate(tech, fund, cheap)["components"]["vol"],
        )

    def test_cheap_implied_vol_is_flagged_as_nothing_to_sell(self):
        tech = {"ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8, "rv_30": 0.30}
        fund = {"market_cap": 8e10}
        condor = {**standard_condor(), "expiration": "2099-01-01", "atm_iv": 0.20}
        rating = ic.score_candidate(tech, fund, condor)
        self.assertIn("Implied vol at or below realized — nothing to sell", rating["flags"])

    def test_four_leg_slippage_is_weighted_harder_than_the_two_leg_screens(self):
        """Four markets in and four out, against a credit that is not twice a vertical's."""
        self.assertGreater(ic.DEFAULTS["max_exec_cost_pct"], bull.DEFAULTS["max_exec_cost_pct"])
        self.assertGreater(ic.DEFAULTS["max_exec_cost_pct"], bcs.DEFAULTS["max_exec_cost_pct"])

    def test_defaults_sell_further_out_than_the_directional_credit_screens(self):
        """A neutral trade has no direction to be right about, so it sits further out."""
        self.assertLess(ic.DEFAULTS["short_delta"], bull.DEFAULTS["short_delta"])
        self.assertLess(ic.DEFAULTS["short_delta"], bcs.DEFAULTS["short_delta"])


# ---------------------------------------------------------------------------
# IV percentile
# ---------------------------------------------------------------------------

class IvPercentile(unittest.TestCase):

    def test_percentile_reads_against_the_whole_distribution(self):
        history = pd.Series(np.linspace(0.10, 0.50, 200))
        self.assertAlmostEqual(ic._iv_percentile_vs_rv(0.30, history), 50.0, delta=2.0)
        self.assertGreater(ic._iv_percentile_vs_rv(0.48, history), 90.0)
        self.assertLess(ic._iv_percentile_vs_rv(0.12, history), 10.0)

    def test_percentile_disagrees_with_iv_over_rv_when_the_distribution_is_wide(self):
        """The case the term exists for.

        A name whose realized vol swings between 15% and 60% but happens to sit
        at 20% today produces a flattering IV/RV of 1.3 at an implied 26%.
        Against its own distribution that reading is unremarkable, and this is
        the term that says so.
        """
        history = pd.Series(np.linspace(0.15, 0.60, 200))
        iv, rv_today = 0.26, 0.20
        self.assertGreater(iv / rv_today, 1.25)                    # looks rich
        self.assertLess(ic._iv_percentile_vs_rv(iv, history), 30)  # is not

    def test_percentile_is_none_without_enough_history(self):
        self.assertIsNone(ic._iv_percentile_vs_rv(0.3, pd.Series([0.2, 0.25])))
        self.assertIsNone(ic._iv_percentile_vs_rv(None, pd.Series(np.linspace(0.1, 0.5, 60))))


# ---------------------------------------------------------------------------
# Management
# ---------------------------------------------------------------------------

class Management(unittest.TestCase):

    def test_profit_target_is_half_the_credit_not_the_verticals_two_thirds(self):
        condor = {**standard_condor(), "dte": 40}
        plan = ic.recommend_management(condor, {"grade": "B", "score": 75, "flags": []})
        self.assertAlmostEqual(plan["profit_capture_pct"], 50.0, delta=1.0)
        self.assertAlmostEqual(plan["target_debit"], 1.00, places=2)

    def test_reassessment_lands_at_twenty_one_dte(self):
        plan = ic.recommend_management(
            {**standard_condor(), "dte": 45}, {"grade": "A", "score": 85, "flags": []},
        )
        self.assertEqual(plan["reassess_dte"], 21)

    def test_short_dated_trades_get_a_proportional_reassessment(self):
        plan = ic.recommend_management(
            {**standard_condor(), "dte": 14}, {"grade": "B", "score": 72, "flags": []},
        )
        self.assertLess(plan["reassess_dte"], 14)
        self.assertGreaterEqual(plan["reassess_dte"], 7)

    def test_material_risk_reduces_the_target(self):
        condor = {**standard_condor(), "dte": 40}
        clean = ic.recommend_management(condor, {"grade": "A", "score": 85, "flags": []})
        risky = ic.recommend_management(
            condor, {"grade": "A", "score": 85, "flags": ["Trending, not ranging"]},
        )
        self.assertLess(risky["profit_capture_pct"], clean["profit_capture_pct"])

    def test_stop_stays_inside_the_wing(self):
        condor = {**standard_condor(), "dte": 40}
        plan = ic.recommend_management(condor, {"grade": "C", "score": 62, "flags": []})
        self.assertLess(plan["stop_debit"], condor["max_wing"])
        self.assertGreater(plan["stop_debit"], condor["credit"])

    def test_defence_names_both_tested_prices_and_rolls_the_untested_side(self):
        condor = {**standard_condor(), "dte": 40}
        plan = ic.recommend_management(condor, {"grade": "B", "score": 74, "flags": []})
        self.assertAlmostEqual(plan["tested_put_price"], 90.0, places=2)
        self.assertAlmostEqual(plan["tested_call_price"], 110.0, places=2)
        self.assertIn("untested", plan["defence_note"])

    def test_no_plan_without_a_structure(self):
        self.assertIsNone(ic.recommend_management(None, {}))


# ---------------------------------------------------------------------------
# Scoring envelope
# ---------------------------------------------------------------------------

class ScoringEnvelope(unittest.TestCase):

    def test_component_maxima_sum_to_one_hundred(self):
        rating = ic.score_candidate(
            {"ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8}, {}, None,
        )
        self.assertEqual(sum(rating["component_max"].values()), 100)

    def test_partial_denominator_matches_the_non_chain_budget(self):
        self.assertAlmostEqual(
            ic.PARTIAL_MAX,
            100.0 - ic.STRUCTURE_MAX - ic.VOL_CHAIN_MAX - ic.SAFETY_CHAIN_MAX,
        )

    def test_a_chainless_row_is_marked_partial(self):
        rating = ic.score_candidate(
            {"ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8}, {}, None,
        )
        self.assertTrue(rating["scored_on_partial"])
        self.assertIn("Option chain unavailable", rating["flags"])

    def test_score_is_bounded(self):
        fund = {"market_cap": 5e11, "total_assets": 5e11}
        tech = {
            "ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 1e9,
            "efficiency_ratio": 0.05, "drift_sigma": 0.1, "variance_ratio": 0.6,
            "ma_slope_abs": 0.1, "rv_30": 0.12, "rv_contraction": 0.7,
        }
        condor = {**standard_condor(), "expiration": "2099-01-01", "atm_iv": 0.60}
        rating = ic.score_candidate(tech, fund, condor)
        self.assertGreaterEqual(rating["score"], 0.0)
        self.assertLessEqual(rating["score"], 100.0)
        self.assertIn(rating["grade"], set("ABCDF"))

    def test_earnings_inside_the_trade_is_flagged_and_charged(self):
        tech = {"ticker": "TEST", "rsi_14": 50.0, "avg_dollar_volume": 3e8, "rv_30": 0.22}
        soon = (date.today() + timedelta(days=10)).isoformat()
        condor = {**standard_condor(), "expiration": (date.today() + timedelta(days=40)).isoformat(), "atm_iv": 0.30}
        clean = ic.score_candidate(tech, {"market_cap": 8e10}, condor)
        dirty = ic.score_candidate(tech, {"market_cap": 8e10, "next_earnings": soon}, condor)
        self.assertIn("Earnings before expiration", dirty["flags"])
        self.assertLess(dirty["components"]["safety"], clean["components"]["safety"])


# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------

class Verdict(unittest.TestCase):

    def test_verdict_quotes_all_four_strikes_and_both_breakevens(self):
        condor = ic._round_condor({**standard_condor(), "expiration": "2099-01-17", "dte": 40})
        row = {
            "grade": "A", "efficiency_ratio": 0.18, "drift_sigma": 0.4,
            "variance_ratio": 0.88, "iv_rv_ratio": 1.35, "iv_percentile_vs_rv": 72,
            "is_fund": False, "flags": [], "spread": condor,
        }
        text = ic.build_verdict(row)
        for strike in ("$80", "$90", "$110", "$120"):
            self.assertIn(strike, text)
        self.assertIn("$88.00", text)
        self.assertIn("$112.00", text)
        self.assertTrue(text.endswith("."))

    def test_verdict_survives_a_row_with_no_structure(self):
        text = ic.build_verdict({
            "grade": "C", "efficiency_ratio": 0.3, "drift_sigma": 1.0,
            "is_fund": True, "fund_kind": "index", "flags": [], "spread": None,
        })
        self.assertIn("Broad index fund", text)
        self.assertTrue(text.endswith("."))


if __name__ == "__main__":
    unittest.main(verbosity=2)
