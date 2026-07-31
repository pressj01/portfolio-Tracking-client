"""Pure-math tests for the bear call spread scanner. No network access.

The interesting tests here are not the arithmetic identities — they are the
*inversions*. This screen shares almost all of its machinery with four others,
and the ways it deliberately disagrees with them are the only reason it exists:

  * rich implied vol is good here and bad on the bear put screen;
  * a steep upside wing is a warning here and a steep put wing is a gift there;
  * relative performance is gated as a maximum here and a minimum everywhere else;
  * a big move scores *worse* than a middling one, as on the bear put screen but
    for the opposite direction of travel.

Each of those has a test that fails if the screen ever collapses back into being
one of its siblings.
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

import bear_call_spread_scanner as bcs
import bear_put_spread_scanner as bps
import bull_put_spread_scanner as bull
import call_scanner as cs
import put_scanner as ps
from options_pricing import black_scholes


def synthetic_frame(daily_sigma=0.012, drift=0.0, days=300, move_pct=None,
                    move_days=21, seed=7):
    """Deterministic OHLCV, optionally with an even move over the tail window."""
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, daily_sigma, days)
    if move_pct is not None:
        per_day = math.log(1.0 + move_pct / 100.0) / move_days
        rets[-move_days:] = per_day
    close = 100.0 * np.exp(np.cumsum(rets))
    index = pd.bdate_range(end=date.today(), periods=days)
    return pd.DataFrame({
        "Open": close * 0.999,
        "High": close * 1.008,
        "Low": close * 0.992,
        "Close": close,
        "Volume": np.full(days, 3_000_000.0),
    }, index=index)


def a_leg(strike, bid, ask, iv=0.30, delta=0.25, oi=800, vol=200):
    return {
        "strike": strike, "bid": bid, "ask": ask, "mid": (bid + ask) / 2.0,
        "iv": iv, "delta": delta, "open_interest": oi, "volume": vol, "dte": 35,
    }


# The two legs of the reference spread. Kept as constants because every derived
# figure in `a_spread` is computed from them — a fixture whose stated credit does
# not match its own quotes would make half these tests meaningless.
SHORT_LEG = (105.0, 3.20, 3.30)      # mid 3.25
LONG_LEG = (115.0, 0.65, 0.75)       # mid 0.70


def a_spread(**over):
    """A well-structured 105/115 call credit spread on a $100 stock, 35 DTE.

    Internally consistent with SHORT_LEG and LONG_LEG: credit 2.55 on a 10-wide
    spread, so 25.5% of the width, 7.45 at risk, breakeven 107.55.
    """
    base = {
        "expiration": (date.today() + timedelta(days=35)).isoformat(),
        "dte": 35,
        "short_strike": 105.0, "long_strike": 115.0, "width": 10.0,
        "credit": 2.55, "natural_credit": 2.45, "credit_pct_of_width": 25.5,
        "max_profit": 2.55, "max_loss": 7.45, "reward_risk": 0.34,
        "return_on_risk_pct": 34.2, "annualized_return_on_risk_pct": 356.9,
        "breakeven": 107.55, "short_otm_pct": 5.0, "breakeven_cushion_pct": 7.55,
        "cushion_sigma": 0.58, "breakeven_sigma": 0.86,
        "expected_move_pct_life": 8.7,
        "prob_otm": 74.0, "prob_profit": 78.0, "prob_max_profit": 71.0,
        "fair_credit": 2.05, "premium_edge": 0.50, "premium_edge_pct": 24.4,
        "call_skew_ratio": 1.07, "upside_tail_ratio": 0.97, "atm_iv": 0.36,
        "exec_cost": 0.20, "exec_cost_pct": 7.8,
        "open_interest_min": 800, "volume_min": 180,
        "credit_dollars": 255.0, "max_profit_dollars": 255.0, "max_loss_dollars": 745.0,
        "naked_credit": 3.25, "tail_hedge_cost": 0.70, "tail_hedge_pct_of_credit": 21.5,
        "clears_resistance": True, "resistance_gap_pct": 1.0,
        "resistance": 104.0, "resistance_label": "50-day average",
        "resistance_floor_binding": True,
        "constraints_relaxed": False, "pairs_considered": 14,
        "ex_dividend_date": None, "ex_dividend_estimated": False,
        "ex_dividend_inside": False, "dividend_amount": None,
        "early_assignment": {"level": "none", "dividend_vs_premium_pct": None, "extrinsic": 2.55},
        "short_leg": a_leg(*SHORT_LEG, iv=0.34, delta=0.26),
        "long_leg": a_leg(*LONG_LEG, iv=0.318, delta=0.09),
    }
    base.update(over)
    return base


def a_tech(**over):
    """A rejected rally: the shape the screen is looking for."""
    base = {
        "ticker": "TEST", "price": 100.0,
        "window_pct": 6.0, "rally_sigma": 1.3, "expected_move_pct": 7.0,
        "drawdown_pct": -12.0, "above_52w_low_pct": 25.0, "pct_of_52w_range": 55.0,
        "rel_strength_pct": -3.0, "excess_move_pct": -3.0, "beta": 1.1,
        "rsi_14": 52.0, "rsi_prior": 64.0, "rsi_roll_pp": -12.0,
        "sma_20": 101.0, "sma_50": 104.0, "sma_200": 110.0,
        "sma20_slope_pct": -0.4, "sma50_slope_pct": -1.2,
        "above_sma20": False, "above_sma50": False,
        "below_sma20": True, "below_sma50": True,
        "sma50_below_sma200": True, "above_sma50_pct": -3.8,
        "swing_high_20": 104.5, "swing_high_60": 118.0, "week52_high": 122.0,
        "rolled_over": True, "lower_high": True, "pullback_from_high_pct": 4.3,
        "days_since_swing_high": 8, "accel_pp": -3.0, "fresh_high": False,
        "run_off_low_pct": 4.0, "rv_30": 0.28, "rv_252": 0.26, "atr_14": 2.2,
        "avg_dollar_volume": 400e6,
    }
    base.update(over)
    return base


LARGE_STOCK = {"market_cap": 120e9, "quote_type": "EQUITY"}


def rate(tech=None, spread=None, fund=None):
    return bcs.score_candidate(tech or a_tech(), fund or LARGE_STOCK, spread)


# ---------------------------------------------------------------------------

class SharedHelperTests(unittest.TestCase):
    """The primitives are shared with the other screens, not re-derived."""

    def test_trapezoid_is_the_bear_put_screens_band(self):
        self.assertIs(bcs._band, bps._band)

    def test_terminal_probability_is_the_bear_put_screens(self):
        self.assertIs(bcs.prob_below, bps.prob_below)

    def test_call_chain_loader_is_shared_so_the_cache_is_shared(self):
        """Running the Covered Call Scanner then this one must re-use chains."""
        self.assertIs(bcs._load_call_chain, cs._load_call_chain)

    def test_stretch_primitive_is_the_shared_one(self):
        self.assertIs(bcs.window_stretch, ps.window_stretch)

    def test_assignment_helpers_come_from_the_covered_call_screen(self):
        self.assertIs(bcs.assess_early_assignment, cs.assess_early_assignment)
        self.assertIs(bcs.next_ex_dividend, cs.next_ex_dividend)
        self.assertIs(bcs.expected_dividend_amount, cs.expected_dividend_amount)

    def test_small_cap_universe_comes_from_the_call_screen(self):
        self.assertIs(bcs.SMALL_CAP_SET, cs.SMALL_CAP_SET)

    def test_partial_budget_matches_what_a_chainless_row_can_earn(self):
        """The denominator must equal the points actually reachable without a chain."""
        self.assertEqual(bcs.PARTIAL_MAX, 100.0 - bcs.CREDIT_MAX - bcs.SAFETY_CHAIN_MAX)
        # Rejection and Ceiling need no chain; Safety keeps size + liquidity.
        self.assertEqual(bcs.PARTIAL_MAX, 30 + 20 + (bcs.SAFETY_MAX - bcs.SAFETY_CHAIN_MAX))


class FairValueTests(unittest.TestCase):
    """The call-side twin of the bear put screen's vertical_fair_value."""

    def test_bounded_by_zero_and_the_width(self):
        fv = bcs.call_vertical_fair_value(100.0, 105.0, 115.0, 35 / 365, 0.30)
        self.assertGreater(fv, 0.0)
        self.assertLess(fv, 10.0)

    def test_further_out_of_the_money_is_worth_less(self):
        near = bcs.call_vertical_fair_value(100.0, 105.0, 115.0, 35 / 365, 0.30)
        far = bcs.call_vertical_fair_value(100.0, 115.0, 125.0, 35 / 365, 0.30)
        self.assertLess(far, near)

    def test_more_volatility_is_worth_more_to_the_seller(self):
        quiet = bcs.call_vertical_fair_value(100.0, 105.0, 115.0, 35 / 365, 0.20)
        wild = bcs.call_vertical_fair_value(100.0, 105.0, 115.0, 35 / 365, 0.45)
        self.assertLess(quiet, wild)

    def test_it_is_the_call_side_not_the_put_side(self):
        """A put spread and a call spread on the same strikes are not the same."""
        call_fv = bcs.call_vertical_fair_value(100.0, 105.0, 115.0, 35 / 365, 0.30)
        put_fv = bps.vertical_fair_value(100.0, 115.0, 105.0, 35 / 365, 0.30)
        self.assertNotAlmostEqual(call_fv, put_fv, places=2)

    def test_no_volatility_or_no_time_returns_nothing(self):
        self.assertIsNone(bcs.call_vertical_fair_value(100.0, 105.0, 115.0, 35 / 365, 0.0))
        self.assertIsNone(bcs.call_vertical_fair_value(100.0, 105.0, 115.0, 0.0, 0.30))


class StrikeFromDeltaTests(unittest.TestCase):
    """The fallback used only when the chain has no usable implied vols."""

    def test_it_actually_inverts_the_black_scholes_call_delta(self):
        for target in (0.10, 0.25, 0.40):
            strike = bcs.strike_for_call_delta(100.0, target, 0.30, 35 / 365)
            actual = black_scholes(100.0, strike, 35 / 365, 0.0, 0.0, 0.30, "call")["delta"]
            self.assertAlmostEqual(actual, target, places=3)

    def test_lower_delta_means_a_higher_strike(self):
        """The call-side direction, opposite the put screen's."""
        self.assertGreater(
            bcs.strike_for_call_delta(100.0, 0.10, 0.30, 35 / 365),
            bcs.strike_for_call_delta(100.0, 0.35, 0.30, 35 / 365),
        )

    def test_degenerate_inputs_fall_back_to_spot(self):
        self.assertEqual(bcs.strike_for_call_delta(100.0, 0.25, 0.0, 35 / 365), 100.0)
        self.assertEqual(bcs.strike_for_call_delta(100.0, 0.25, 0.30, 0.0), 100.0)


class ResistanceTests(unittest.TestCase):
    """Overhead supply — the screen's answer to "where should the strike go?"."""

    def test_levels_are_sorted_nearest_first(self):
        levels = bcs.resistance_levels(a_tech())
        prices = [lv for lv, _ in levels]
        self.assertEqual(prices, sorted(prices))
        self.assertTrue(all(lv > 100.0 for lv in prices))

    def test_levels_below_spot_are_not_resistance(self):
        levels = bcs.resistance_levels(a_tech(sma_20=95.0, sma20_slope_pct=-1.0))
        self.assertNotIn(95.0, [lv for lv, _ in levels])

    def test_a_rising_average_is_support_not_resistance(self):
        """The distinction that keeps this out of the bull put screen's setup."""
        falling = bcs.resistance_levels(a_tech(sma_50=104.0, sma50_slope_pct=-1.2))
        rising = bcs.resistance_levels(a_tech(sma_50=104.0, sma50_slope_pct=4.0))
        self.assertIn("50-day average", [label for _, label in falling])
        self.assertNotIn("50-day average", [label for _, label in rising])

    def test_a_swing_high_is_resistance_regardless_of_slope(self):
        levels = bcs.resistance_levels(a_tech(sma20_slope_pct=9.0, sma50_slope_pct=9.0))
        self.assertIn("20-day high", [label for _, label in levels])

    def test_nearest_reports_price_label_and_gap_together(self):
        level, label, gap = bcs.nearest_resistance(a_tech())
        self.assertEqual(level, 101.0)
        self.assertEqual(label, "20-day average")
        self.assertAlmostEqual(gap, 1.0, places=6)

    def test_nothing_overhead_returns_all_none(self):
        naked = a_tech(sma_20=95.0, sma_50=96.0, sma_200=97.0,
                       swing_high_20=98.0, swing_high_60=99.0, week52_high=99.5)
        self.assertEqual(bcs.nearest_resistance(naked), (None, None, None))


class UpsideWingTests(unittest.TestCase):
    """The squeeze warning, and the guards that stop it being noise."""

    def wing_leg(self, strike, iv, delta, oi=200, bid=0.20):
        return {"strike": strike, "iv": iv, "delta": delta,
                "open_interest": oi, "bid": bid, "ask": bid + 0.05,
                "mid": bid + 0.025, "volume": 10}

    def band(self, ivs, delta=0.10, **kw):
        return [self.wing_leg(120.0 + i, iv, delta, **kw) for i, iv in enumerate(ivs)]

    def test_it_reports_the_median_against_at_the_money(self):
        ratio, n = bcs._upside_wing(self.band([0.30, 0.32, 0.34, 0.36, 0.38]), 0.34)
        self.assertEqual(n, 5)
        self.assertAlmostEqual(ratio, 1.0, places=6)

    def test_a_fat_wing_reads_above_one(self):
        ratio, _ = bcs._upside_wing(self.band([0.40, 0.42, 0.44, 0.46, 0.48]), 0.34)
        self.assertGreater(ratio, 1.2)

    def test_an_index_style_downward_wing_reads_well_below_one(self):
        ratio, _ = bcs._upside_wing(self.band([0.12, 0.13, 0.14, 0.15, 0.16]), 0.20)
        self.assertLess(ratio, 0.8)

    def test_too_few_strikes_returns_nothing_rather_than_a_guess(self):
        """The guard that suppresses stale far-strike marks on thin chains."""
        for count in range(bcs.TAIL_MIN_STRIKES):
            with self.subTest(count=count):
                ratio, n = bcs._upside_wing(self.band([0.90] * count), 0.30)
                self.assertIsNone(ratio)
                self.assertEqual(n, count)

    def test_the_median_resists_a_single_stale_mark(self):
        """A max-based reading gave 2.4x at-the-money on a boring large cap."""
        clean = self.band([0.30, 0.31, 0.32, 0.33, 0.34])
        polluted = self.band([0.30, 0.31, 0.32, 0.33, 2.50])
        a, _ = bcs._upside_wing(clean, 0.32)
        b, _ = bcs._upside_wing(polluted, 0.32)
        self.assertAlmostEqual(a, b, places=6)

    def test_strikes_with_no_bid_and_no_open_interest_are_excluded(self):
        """A strike nobody holds or bids for has a mark, not a price."""
        dead = self.band([0.90] * 6, oi=0, bid=0.0)
        ratio, n = bcs._upside_wing(dead, 0.30)
        self.assertIsNone(ratio)
        self.assertEqual(n, 0)

    def test_only_the_far_band_counts(self):
        near = [self.wing_leg(105.0 + i, 0.90, 0.40) for i in range(8)]
        ratio, n = bcs._upside_wing(near, 0.30)
        self.assertIsNone(ratio)
        self.assertEqual(n, 0)

    def test_a_missing_or_zero_atm_vol_returns_nothing(self):
        legs = self.band([0.30] * 6)
        self.assertEqual(bcs._upside_wing(legs, 0.0), (None, 0))
        self.assertEqual(bcs._upside_wing(legs, None), (None, 0))

    def test_legs_with_no_delta_or_no_vol_are_skipped(self):
        legs = self.band([0.30] * 6)
        for leg in legs[:3]:
            leg["delta"] = None
        ratio, n = bcs._upside_wing(legs, 0.30)
        self.assertIsNone(ratio)
        self.assertEqual(n, 3)


class CreditPairTests(unittest.TestCase):
    """Arithmetic identities for one (short, long) call pair."""

    def build(self, short=SHORT_LEG, long_=LONG_LEG, **kw):
        return bcs._build_credit_pair(
            a_leg(*short, iv=0.34, delta=0.26), a_leg(*long_, iv=0.318, delta=0.09),
            kw.pop("spot", 100.0), kw.pop("dte", 35), kw.pop("vol", 0.28),
            kw.pop("div", 0.0), **kw,
        )

    def test_the_defined_risk_identities_hold(self):
        p = self.build()
        self.assertAlmostEqual(p["width"], 10.0)
        self.assertAlmostEqual(p["credit"], 2.55)
        self.assertAlmostEqual(p["max_loss"], p["width"] - p["credit"])
        self.assertAlmostEqual(p["max_profit"], p["credit"])
        # The breakeven of a call credit spread sits ABOVE spot — the mirror of
        # the bull put's, and the number the whole trade is built around.
        self.assertAlmostEqual(p["breakeven"], p["short_strike"] + p["credit"])
        self.assertGreater(p["breakeven"], 100.0)
        self.assertAlmostEqual(p["credit_pct_of_width"], 25.5)
        self.assertAlmostEqual(p["return_on_risk_pct"], 2.55 / 7.45 * 100.0)

    def test_annualized_return_scales_with_the_holding_period(self):
        short_dated = self.build(dte=30)
        long_dated = self.build(dte=90)
        self.assertGreater(
            short_dated["annualized_return_on_risk_pct"],
            long_dated["annualized_return_on_risk_pct"],
        )

    def test_natural_credit_is_worse_than_the_mid_credit(self):
        p = self.build()
        self.assertLess(p["natural_credit"], p["credit"])
        self.assertAlmostEqual(p["natural_credit"], SHORT_LEG[1] - LONG_LEG[2])

    def test_execution_cost_adds_both_quote_widths(self):
        p = self.build()
        self.assertAlmostEqual(
            p["exec_cost"],
            (SHORT_LEG[2] - SHORT_LEG[1]) + (LONG_LEG[2] - LONG_LEG[1]),
        )
        self.assertAlmostEqual(p["exec_cost_pct"], p["exec_cost"] / p["credit"] * 100.0)

    def test_cushion_is_expressed_in_the_names_own_expected_move(self):
        p = self.build()
        self.assertGreater(p["breakeven_sigma"], p["cushion_sigma"])
        self.assertGreater(p["cushion_sigma"], 0.0)

    def test_the_tail_hedge_cost_is_reported_against_the_naked_credit(self):
        """A credit spread is a naked call plus insurance; the price is shown."""
        p = self.build()
        self.assertAlmostEqual(p["naked_credit"], 3.25)
        self.assertAlmostEqual(p["tail_hedge_cost"], 0.70)
        self.assertAlmostEqual(p["tail_hedge_pct_of_credit"], 0.70 / 3.25 * 100.0)

    def test_reversed_strikes_are_rejected(self):
        self.assertIsNone(self.build(short=LONG_LEG, long_=SHORT_LEG))

    def test_identical_strikes_are_rejected(self):
        self.assertIsNone(self.build(short=SHORT_LEG, long_=SHORT_LEG))

    def test_a_credit_at_or_above_the_width_is_bad_data_not_free_money(self):
        self.assertIsNone(self.build(short=(105.0, 12.0, 12.2), long_=(107.0, 0.10, 0.20)))

    def test_a_non_positive_credit_is_rejected(self):
        self.assertIsNone(self.build(short=(105.0, 0.10, 0.20), long_=LONG_LEG))

    def test_clears_resistance_when_the_short_strike_is_above_the_wall(self):
        above = self.build(resistance=104.0)
        below = self.build(resistance=108.0)
        self.assertTrue(above["clears_resistance"])
        self.assertGreater(above["resistance_gap_pct"], 0)
        self.assertFalse(below["clears_resistance"])
        self.assertLess(below["resistance_gap_pct"], 0)

    def test_without_a_known_level_the_resistance_fields_stay_unknown(self):
        p = self.build(resistance=None)
        self.assertIsNone(p["clears_resistance"])
        self.assertIsNone(p["resistance_gap_pct"])

    def test_delta_based_probability_is_the_conservative_one(self):
        """Both are surfaced and they must not be confused for each other.

        A call's delta is N(d1) and d1 always exceeds d2, so one minus delta sits
        below the exact N(-d2). The screen shows the conservative number as
        `prob_otm` and the exact one as `prob_max_profit`.
        """
        T, iv, spot = 35 / 365, 0.30, 100.0
        for strike in (105.0, 110.0, 115.0):
            delta = black_scholes(spot, strike, T, bcs.RISK_FREE, 0.0, iv, "call")["delta"]
            exact = bcs.prob_below(spot, strike, T, iv, bcs.RISK_FREE, 0.0)
            self.assertLess(1.0 - delta, exact)


class PairSelectionTests(unittest.TestCase):
    """How the winner is picked among pairs on one underlying."""

    def base_pair(self, **over):
        p = {
            "prob_otm": 74.0, "annualized_return_on_risk_pct": 300.0,
            "premium_edge_pct": 20.0, "breakeven_cushion_pct": 7.0,
            "exec_cost_pct": 9.0, "open_interest_min": 800,
            "clears_resistance": False,
        }
        p.update(over)
        return p

    def test_clearing_resistance_breaks_a_tie(self):
        plain = bcs._pair_quality(self.base_pair())
        walled = bcs._pair_quality(self.base_pair(clears_resistance=True))
        self.assertGreater(walled, plain)

    def test_probability_and_return_pull_against_each_other(self):
        safe = bcs._pair_quality(self.base_pair(prob_otm=88.0, annualized_return_on_risk_pct=60.0))
        greedy = bcs._pair_quality(self.base_pair(prob_otm=62.0, annualized_return_on_risk_pct=600.0))
        # Neither extreme should dominate outright; the middle is the point.
        middle = bcs._pair_quality(self.base_pair(prob_otm=76.0, annualized_return_on_risk_pct=320.0))
        self.assertGreater(middle, min(safe, greedy) - 1e-9)

    def test_a_missing_execution_cost_is_treated_as_the_worst_case(self):
        known = bcs._pair_quality(self.base_pair(exec_cost_pct=9.0))
        unknown = bcs._pair_quality(self.base_pair(exec_cost_pct=None))
        self.assertLess(unknown, known)

    def test_quotable_requires_two_live_uncrossed_sides(self):
        self.assertTrue(bcs._quotable(a_leg(105.0, 2.50, 2.60)))
        self.assertFalse(bcs._quotable(a_leg(105.0, 0.0, 2.60)))       # no bid
        self.assertFalse(bcs._quotable({"strike": 105.0, "bid": 2.5, "ask": 0.0, "mid": 0.0}))
        self.assertFalse(bcs._quotable({"strike": 105.0, "bid": 2.6, "ask": 2.5, "mid": 2.55}))  # crossed

    def suggest_from(self, calls, **overrides):
        expiration = (date.today() + timedelta(days=35)).isoformat()
        params = {
            "ticker": "TEST",
            "spot": 100.0,
            "div_yield": 0.0,
            "forecast_vol": 0.28,
            "target_dte": 35,
            "min_dte": 1,
            "max_dte": 90,
            "short_delta": 0.25,
            "long_delta": 0.10,
            "delta_tolerance": 0.12,
            "min_width_pct": 1.0,
            "max_width_pct": 15.0,
            "min_credit_pct_of_width": 20.0,
            "min_cushion_pct": 3.0,
            "min_open_interest": 50,
            "max_exec_cost_pct": 30.0,
            "min_otm_pct": 1.0,
            "resistance": None,
            "respect_resistance": False,
            "fund": {},
        }
        params.update(overrides)
        with (
            patch.object(bcs.yf, "Ticker") as ticker,
            patch.object(bcs, "_load_call_chain", return_value=calls),
        ):
            ticker.return_value.options = [expiration]
            return bcs._suggest_bear_call_spread(**params)

    def test_sparse_chain_finds_an_ordered_pair_when_delta_pools_choose_the_same_strike(self):
        calls = [
            a_leg(105.0, 3.00, 3.40, iv=0.32, delta=0.41),
            a_leg(110.0, 1.00, 1.20, iv=0.29, delta=0.24),
        ]

        spread = self.suggest_from(calls)

        self.assertIsNotNone(spread)
        self.assertEqual((spread["short_strike"], spread["long_strike"]), (105.0, 110.0))
        self.assertFalse(spread["constraints_relaxed"])

    def test_otm_floor_miss_is_a_relaxed_candidate_not_an_unavailable_chain(self):
        calls = [
            a_leg(100.5, 3.00, 3.20, iv=0.31, delta=0.25),
            a_leg(105.0, 1.00, 1.10, iv=0.28, delta=0.10),
        ]

        spread = self.suggest_from(calls, min_otm_pct=1.0)

        self.assertIsNotNone(spread)
        self.assertAlmostEqual(spread["short_otm_pct"], 0.5)
        self.assertTrue(spread["constraints_relaxed"])

    def test_unhedgeable_resistance_strike_relaxes_the_wall_instead_of_hiding_the_chain(self):
        calls = [
            a_leg(105.0, 3.00, 3.40, iv=0.32, delta=0.41),
            a_leg(110.0, 1.00, 1.20, iv=0.29, delta=0.24),
        ]

        spread = self.suggest_from(
            calls,
            resistance=109.0,
            resistance_label="20-day high",
            respect_resistance=True,
        )

        self.assertIsNotNone(spread)
        self.assertFalse(spread["clears_resistance"])
        self.assertFalse(spread["resistance_floor_binding"])
        self.assertTrue(spread["constraints_relaxed"])

    def test_recent_trades_keep_after_hours_analysis_available(self):
        calls = [
            {**a_leg(105.0, 3.00, 3.40, iv=0.32, delta=0.41), "bid": 0.0},
            {**a_leg(110.0, 1.00, 1.20, iv=0.29, delta=0.24), "bid": 0.0},
        ]

        spread = self.suggest_from(calls)

        self.assertIsNotNone(spread)
        self.assertTrue(spread["uses_last_trade_prices"])
        self.assertEqual(spread["quote_source"], "last_trade_estimate")
        self.assertTrue(spread["constraints_relaxed"])
        self.assertIsNone(spread["natural_credit"])
        self.assertIsNone(spread["exec_cost_pct"])


class ScanControlFlowTests(unittest.TestCase):
    def run_with_earnings_setting(self, exclude_earnings):
        earnings = (date.today() + timedelta(days=90)).isoformat()
        fund = {**LARGE_STOCK, "name": "Test Inc.", "next_earnings": earnings}
        suggested = a_spread()
        with (
            patch.object(bcs, "resolve_scan_universe", return_value=["TEST"]),
            patch.object(bcs, "held_positions", return_value={}),
            patch.object(bcs, "_load_history", return_value=pd.DataFrame({"Close": [100.0]})),
            patch.object(bcs, "_benchmark_returns", return_value=None),
            patch.object(bcs, "_ticker_frame", return_value=pd.DataFrame({"Close": [100.0]})),
            patch.object(bcs, "_compute_technicals", return_value=a_tech()),
            patch.object(bcs, "_fetch_fundamentals_bulk", return_value={"TEST": fund}),
            patch.object(bcs, "_suggest_bear_call_spread", return_value=suggested) as suggest,
        ):
            result = bcs.run_bear_call_spread_scan({
                "exclude_earnings_before_expiry": exclude_earnings,
                "chain_limit": 1,
            })
        return earnings, result, suggest

    def test_disabling_earnings_exclusion_does_not_constrain_expiration_selection(self):
        _, result, suggest = self.run_with_earnings_setting(False)

        self.assertEqual(result["stats"]["chains_fetched"], 1)
        self.assertIsNone(suggest.call_args.kwargs["earnings_date"])

    def test_enabling_earnings_exclusion_passes_the_report_date_to_expiration_selection(self):
        earnings, result, suggest = self.run_with_earnings_setting(True)

        self.assertEqual(result["stats"]["chains_fetched"], 1)
        self.assertEqual(suggest.call_args.kwargs["earnings_date"], earnings)


class RejectionAxisTests(unittest.TestCase):
    """The axis that separates a refused rally from one that is still running."""

    def rejection(self, **tech_over):
        return rate(a_tech(**tech_over), a_spread())["components"]["rejection"]

    def test_a_runaway_thrust_scores_below_a_middling_bounce(self):
        """The one behaviour a plain ramp gets backwards."""
        self.assertGreater(self.rejection(rally_sigma=1.3), self.rejection(rally_sigma=3.5))

    def test_nothing_having_happened_also_scores_below_the_middle(self):
        self.assertGreater(self.rejection(rally_sigma=1.3), self.rejection(rally_sigma=0.1))

    def test_the_band_peaks_in_the_middle_not_at_either_end(self):
        scores = {s: self.rejection(rally_sigma=s) for s in (0.1, 0.8, 1.5, 2.0, 3.2)}
        self.assertEqual(max(scores, key=scores.get) in (0.8, 1.5, 2.0), True)

    def test_rolled_over_and_a_lower_high_both_earn_points(self):
        both = self.rejection(rolled_over=True, lower_high=True)
        one = self.rejection(rolled_over=True, lower_high=False)
        neither = self.rejection(rolled_over=False, lower_high=False)
        self.assertGreater(both, one)
        self.assertGreater(one, neither)

    def test_falling_rsi_from_an_elevated_level_beats_a_high_flat_one(self):
        """A high flat RSI is a trend. A falling one is a rally being refused."""
        rolling_over = self.rejection(rsi_14=52.0, rsi_prior=64.0, rsi_roll_pp=-12.0)
        pinned_high = self.rejection(rsi_14=64.0, rsi_prior=64.0, rsi_roll_pp=0.0)
        self.assertGreater(rolling_over, pinned_high)

    def test_a_market_leader_is_penalized_not_merely_flagged(self):
        laggard = rate(a_tech(rel_strength_pct=-3.0), a_spread())
        leader = rate(a_tech(rel_strength_pct=10.0), a_spread())
        self.assertGreater(laggard["components"]["rejection"], leader["components"]["rejection"])
        self.assertIn("Leading the market — do not sell its calls", leader["flags"])
        # A full letter grade of separation, not a rounding difference.
        self.assertGreaterEqual(laggard["score"] - leader["score"], 5.0)

    def test_accelerating_momentum_is_penalized(self):
        cooling = rate(a_tech(accel_pp=-3.0), a_spread())
        heating = rate(a_tech(accel_pp=9.0), a_spread())
        self.assertGreater(cooling["score"], heating["score"])
        self.assertIn("Momentum still accelerating", heating["flags"])

    def test_fresh_highs_cost_real_points(self):
        """Fresh highs are the clearest statement that nothing was rejected."""
        normal = rate(a_tech(), a_spread())
        topping = rate(a_tech(fresh_high=True, pct_of_52w_range=99.0), a_spread())
        self.assertIn("Making fresh 52-week highs", topping["flags"])
        self.assertGreaterEqual(normal["score"] - topping["score"], 10.0)

    def test_a_squeeze_off_the_low_costs_real_points(self):
        """A squeeze runs to the full width while the credit caps the gain."""
        calm = rate(a_tech(run_off_low_pct=4.0), a_spread())
        squeezing = rate(a_tech(run_off_low_pct=32.0), a_spread())
        self.assertIn("Sharp run off the recent low — squeeze risk", squeezing["flags"])
        self.assertGreaterEqual(calm["score"] - squeezing["score"], 5.0)

    def test_overbought_and_still_rising_is_flagged_and_charged(self):
        r = rate(a_tech(rsi_14=74.0, rsi_prior=68.0, rsi_roll_pp=6.0), a_spread())
        self.assertIn("Overbought and still rising", r["flags"])

    def test_overbought_but_rolling_over_is_not_charged_as_momentum(self):
        """Overbought alone is not the trap — overbought and *rising* is."""
        r = rate(a_tech(rsi_14=71.0, rsi_prior=78.0, rsi_roll_pp=-7.0), a_spread())
        self.assertNotIn("Overbought and still rising", r["flags"])

    def test_every_disqualifier_at_once_cannot_grade_above_a_D(self):
        worst = rate(a_tech(
            fresh_high=True, pct_of_52w_range=99.0, rel_strength_pct=12.0,
            accel_pp=9.0, run_off_low_pct=35.0, rsi_14=76.0, rsi_prior=70.0,
            rsi_roll_pp=6.0, rolled_over=False, lower_high=False,
        ), a_spread())
        self.assertEqual(worst["components"]["rejection"], 0.0)
        self.assertIn(worst["grade"], {"D", "F"})

    def test_the_axis_never_goes_negative(self):
        self.assertGreaterEqual(self.rejection(
            fresh_high=True, rel_strength_pct=25.0, accel_pp=20.0,
            run_off_low_pct=60.0, rsi_14=80.0, rsi_prior=70.0, rsi_roll_pp=10.0,
            rolled_over=False, lower_high=False, rally_sigma=4.0,
        ), 0.0)


class CeilingAxisTests(unittest.TestCase):
    """Overhead supply for the short strike to hide behind."""

    def ceiling(self, **tech_over):
        return rate(a_tech(**tech_over), a_spread())["components"]["ceiling"]

    def test_a_wall_just_overhead_beats_one_far_away(self):
        close = self.ceiling(sma_20=102.0)
        far = self.ceiling(sma_20=125.0, sma_50=130.0, sma_200=135.0,
                           swing_high_20=128.0, swing_high_60=140.0)
        self.assertGreater(close, far)

    def test_no_resistance_at_all_scores_worse_and_is_flagged(self):
        naked = a_tech(sma_20=95.0, sma_50=96.0, sma_200=97.0,
                       swing_high_20=98.0, swing_high_60=99.0, week52_high=99.5)
        r = rate(naked, a_spread())
        self.assertIn("No overhead resistance identified", r["flags"])
        self.assertLess(r["components"]["ceiling"], self.ceiling())

    def test_a_confirmed_downtrend_earns_the_context_points(self):
        self.assertGreater(
            self.ceiling(sma50_below_sma200=True),
            self.ceiling(sma50_below_sma200=False),
        )

    def test_being_above_a_rising_50_day_is_flagged(self):
        r = rate(a_tech(above_sma50=True, below_sma50=False, sma50_slope_pct=4.0,
                        sma_50=97.0, sma20_slope_pct=3.0, sma_20=98.0), a_spread())
        self.assertIn("Above a rising 50-day average", r["flags"])

    def test_mid_range_beats_both_extremes_of_the_52_week_range(self):
        mid = self.ceiling(pct_of_52w_range=55.0)
        at_highs = self.ceiling(pct_of_52w_range=98.0)
        at_lows = self.ceiling(pct_of_52w_range=6.0)
        self.assertGreater(mid, at_highs)
        self.assertGreater(mid, at_lows)


class CreditAxisTests(unittest.TestCase):
    """The seller's axis — and where this screen inverts the bear put screen."""

    def credit(self, **spread_over):
        return rate(a_tech(), a_spread(**spread_over))["components"]["credit"]

    def test_rich_implied_vol_is_rewarded_here(self):
        cheap = self.credit(atm_iv=0.25)
        rich = self.credit(atm_iv=0.42)
        self.assertGreater(rich, cheap)

    def test_rich_implied_vol_reads_the_opposite_way_to_the_bear_put_screen(self):
        """The same observation, scored in opposite directions by design.

        A high IV/RV ratio means options are expensive. This screen sells them,
        so expensive is good; the bear put screen buys them, so expensive is a
        cost. If both screens ever agreed on the sign, one of them would be wrong.
        """
        rich = rate(a_tech(), a_spread(atm_iv=0.45))
        cheap = rate(a_tech(), a_spread(atm_iv=0.25))
        self.assertGreater(rich["iv_rv_ratio"], cheap["iv_rv_ratio"])
        self.assertGreater(rich["components"]["credit"], cheap["components"]["credit"])

        # The bear put screen, given a richer debit, does not gain structure
        # points for it — its edge term punishes overpaying instead.
        dear = bps.score_candidate(bps_tech(), LARGE_STOCK, bps_spread(edge_pct=-20.0))
        keen = bps.score_candidate(bps_tech(), LARGE_STOCK, bps_spread(edge_pct=30.0))
        self.assertGreater(keen["components"]["structure"], dear["components"]["structure"])

    def test_a_credit_below_fair_value_is_flagged(self):
        r = rate(a_tech(), a_spread(premium_edge_pct=-12.0))
        self.assertIn("Credit below realized-vol fair value", r["flags"])

    def test_cheap_implied_vol_is_flagged_as_a_poor_time_to_sell(self):
        r = rate(a_tech(), a_spread(atm_iv=0.22))
        self.assertIn("Implied vol cheap — poor time to sell premium", r["flags"])

    def test_a_thin_credit_against_the_width_is_flagged(self):
        r = rate(a_tech(), a_spread(credit_pct_of_width=12.0))
        self.assertIn("Credit too small for the defined risk", r["flags"])

    def test_more_credit_for_the_same_width_scores_higher(self):
        self.assertGreater(self.credit(credit_pct_of_width=33.0), self.credit(credit_pct_of_width=18.0))


class SafetyAxisTests(unittest.TestCase):
    """Two-leg execution plus the risks only a short call faces."""

    def safety(self, **spread_over):
        return rate(a_tech(), a_spread(**spread_over))["components"]["safety"]

    UPSIDE_FLAG = "Upside calls bid — someone is paying for the rally"

    def test_a_fat_upside_tail_is_a_warning_not_a_gift(self):
        """The exact inversion of how put skew reads on the bear put screen.

        When the far call carries meaningfully more implied vol than at-the-money,
        the market is pricing a jump — the exact move that costs this trade the
        width.
        """
        normal = rate(a_tech(), a_spread(upside_tail_ratio=0.97))
        fat = rate(a_tech(), a_spread(upside_tail_ratio=1.44))
        self.assertGreater(normal["components"]["safety"], fat["components"]["safety"])
        self.assertIn(self.UPSIDE_FLAG, fat["flags"])
        self.assertNotIn(self.UPSIDE_FLAG, normal["flags"])

    def test_the_upside_threshold_sits_above_parity_not_at_it(self):
        """Measured on live chains the baseline is *below* 1.0, not above it.

        The wing median against at-the-money runs about 0.92-1.04 on single names
        and 0.70-0.81 on index funds. A test at 1.0 would fire on a large share of
        ordinary names, so everything at or just under parity must stay silent.
        """
        for benign in (0.70, 0.80, 0.95, 1.00, 1.04, 1.05):
            with self.subTest(ratio=benign):
                self.assertNotIn(self.UPSIDE_FLAG,
                                 rate(a_tech(), a_spread(upside_tail_ratio=benign))["flags"])
        for genuine in (1.06, 1.10, 1.14, 1.30):
            with self.subTest(ratio=genuine):
                self.assertIn(self.UPSIDE_FLAG,
                              rate(a_tech(), a_spread(upside_tail_ratio=genuine))["flags"])

    def test_the_upside_penalty_scales_with_how_fat_the_wing_is(self):
        mild = rate(a_tech(), a_spread(upside_tail_ratio=1.08))["components"]["safety"]
        extreme = rate(a_tech(), a_spread(upside_tail_ratio=1.30))["components"]["safety"]
        self.assertGreater(mild, extreme)

    def test_an_unmeasurable_wing_is_charged_nothing(self):
        """Silence beats a guess — see _upside_wing's sample-size guard."""
        unknown = rate(a_tech(), a_spread(upside_tail_ratio=None))
        benign = rate(a_tech(), a_spread(upside_tail_ratio=0.95))
        self.assertNotIn(self.UPSIDE_FLAG, unknown["flags"])
        self.assertEqual(unknown["components"]["safety"], benign["components"]["safety"])

    def test_leg_to_leg_skew_is_reported_but_never_scored(self):
        """It straddles 1.0 in real chains, so scoring it would be noise."""
        for ratio in (0.69, 0.93, 1.01, 1.12):
            with self.subTest(ratio=ratio):
                r = rate(a_tech(), a_spread(call_skew_ratio=ratio))
                self.assertNotIn(self.UPSIDE_FLAG, r["flags"])
        self.assertEqual(
            rate(a_tech(), a_spread(call_skew_ratio=0.69))["components"]["safety"],
            rate(a_tech(), a_spread(call_skew_ratio=1.12))["components"]["safety"],
        )

    def test_put_skew_is_rewarded_on_the_bear_put_screen_confirming_the_inversion(self):
        flat = bps.score_candidate(bps_tech(), LARGE_STOCK, bps_spread(skew_ratio=1.0))
        steep = bps.score_candidate(bps_tech(), LARGE_STOCK, bps_spread(skew_ratio=1.12))
        self.assertGreater(steep["components"]["structure"], flat["components"]["structure"])

    def test_dividend_early_assignment_is_penalized_by_severity(self):
        none = self.safety(early_assignment={"level": "none"})
        elevated = self.safety(ex_dividend_inside=True, early_assignment={"level": "elevated"})
        high = self.safety(ex_dividend_inside=True, early_assignment={"level": "high"})
        self.assertGreater(none, elevated)
        self.assertGreater(elevated, high)

    def test_early_assignment_flags_name_the_spread_specific_consequence(self):
        r = rate(a_tech(), a_spread(ex_dividend_inside=True,
                                    early_assignment={"level": "high"}))
        self.assertIn("Dividend invites early assignment", r["flags"])
        self.assertEqual(r["early_assignment_level"], "high")

    def test_earnings_inside_the_trade_is_the_heaviest_single_penalty(self):
        soon = (date.today() + timedelta(days=10)).isoformat()
        clean = rate(a_tech(), a_spread(), fund=LARGE_STOCK)
        risky = rate(a_tech(), a_spread(), fund={**LARGE_STOCK, "next_earnings": soon})
        self.assertIn("Earnings before expiration", risky["flags"])
        self.assertTrue(risky["earnings_before_expiry"])
        self.assertAlmostEqual(
            clean["components"]["safety"] - risky["components"]["safety"], 8.0, places=6
        )

    def test_earnings_just_after_expiry_is_noted_but_not_penalized(self):
        after = (date.today() + timedelta(days=37)).isoformat()
        r = rate(a_tech(), a_spread(), fund={**LARGE_STOCK, "next_earnings": after})
        self.assertFalse(r["earnings_before_expiry"])
        self.assertTrue(any(f.startswith("Earnings ") and "after expiry" in f for f in r["flags"]))

    def test_a_strike_that_clears_resistance_scores_higher(self):
        self.assertGreater(self.safety(clears_resistance=True), self.safety(clears_resistance=False))

    def test_a_strike_below_resistance_is_flagged(self):
        r = rate(a_tech(), a_spread(clears_resistance=False, resistance_gap_pct=-2.5))
        self.assertIn("Short strike sits below resistance", r["flags"])

    def test_no_credit_after_crossing_both_markets_is_flagged(self):
        r = rate(a_tech(), a_spread(natural_credit=-0.05))
        self.assertIn("No credit after crossing both markets", r["flags"])

    def test_heavy_two_leg_slippage_is_flagged(self):
        self.assertIn("Two-leg slippage is high", rate(a_tech(), a_spread(exec_cost_pct=45.0))["flags"])

    def test_thin_open_interest_on_one_leg_is_flagged(self):
        self.assertIn("Thin open interest on one leg", rate(a_tech(), a_spread(open_interest_min=20))["flags"])

    def test_a_short_strike_that_is_too_close_is_flagged(self):
        self.assertIn("Short strike is too close", rate(a_tech(), a_spread(prob_otm=58.0))["flags"])

    def test_a_small_underlying_is_flagged_for_takeover_gap_risk(self):
        """The named reason matters: it is gap risk, not business quality."""
        r = rate(a_tech(), a_spread(), fund={"market_cap": 300e6, "quote_type": "EQUITY"})
        self.assertIn("Small underlying — takeover gap risk", r["flags"])

    def test_thin_share_liquidity_is_flagged(self):
        self.assertIn("Thin share liquidity", rate(a_tech(avg_dollar_volume=2e6), a_spread())["flags"])

    def test_the_axis_never_goes_negative(self):
        soon = (date.today() + timedelta(days=10)).isoformat()
        r = rate(a_tech(avg_dollar_volume=1e6),
                 a_spread(upside_tail_ratio=1.6, ex_dividend_inside=True,
                          early_assignment={"level": "high"}, exec_cost_pct=200.0,
                          open_interest_min=0, prob_otm=40.0, breakeven_cushion_pct=0.0,
                          natural_credit=-1.0, clears_resistance=False),
                 fund={"market_cap": 100e6, "quote_type": "EQUITY", "next_earnings": soon})
        self.assertGreaterEqual(r["components"]["safety"], 0.0)


class PartialScoringTests(unittest.TestCase):
    """A chainless row must be rated on the points it could actually earn."""

    def test_no_chain_scores_on_the_partial_budget(self):
        r = rate(a_tech(), None)
        self.assertTrue(r["scored_on_partial"])
        self.assertIn("Option chain unavailable", r["flags"])
        self.assertEqual(r["components"]["credit"], 0.0)

    def test_the_partial_denominator_is_the_named_budget(self):
        r = rate(a_tech(), None)
        earned = sum(r["components"].values())
        self.assertAlmostEqual(r["score"], round(earned / bcs.PARTIAL_MAX * 100.0, 1), places=1)

    def test_a_full_score_uses_the_full_denominator(self):
        """With a chain the denominator is 100, so the score *is* the points earned.

        Compared with a tolerance rather than exactly: each component is rounded
        to one decimal for display while the score comes off the unrounded total,
        so the two can legitimately differ by a tenth.
        """
        r = rate(a_tech(), a_spread())
        earned = sum(r["components"].values())
        self.assertAlmostEqual(r["score"], earned, delta=0.5)

    def test_the_score_is_clamped_to_the_hundred_point_scale(self):
        r = rate(a_tech(), None)
        self.assertGreaterEqual(r["score"], 0.0)
        self.assertLessEqual(r["score"], 100.0)

    def test_grade_bands_match_the_rest_of_the_family(self):
        """A C has to mean the same thing on all five option screens."""
        for score, grade in ((85, "A"), (75, "B"), (65, "C"), (55, "D"), (30, "F")):
            with self.subTest(score=score):
                self.assertEqual(_grade_for(score), grade)

    def test_flags_are_deduplicated(self):
        r = rate(a_tech(), a_spread())
        self.assertEqual(len(r["flags"]), len(set(r["flags"])))


class ManagementTests(unittest.TestCase):
    """Close-early plan, including the two decisions only a short call has."""

    def test_a_clean_setup_targets_more_of_the_credit(self):
        clean = bcs.recommend_management(a_spread(), rate(a_tech(), a_spread()), a_tech())
        risky_rating = rate(a_tech(fresh_high=True), a_spread())
        risky = bcs.recommend_management(a_spread(), risky_rating, a_tech(fresh_high=True))
        self.assertGreater(clean["profit_capture_pct"], risky["profit_capture_pct"])
        self.assertEqual(clean["profile"], "Strong setup")
        self.assertEqual(risky["profile"], "Defensive setup")

    def test_the_target_debit_is_below_the_credit_collected(self):
        plan = bcs.recommend_management(a_spread(), rate(a_tech(), a_spread()), a_tech())
        self.assertLess(plan["target_debit"], a_spread()["credit"])
        self.assertGreater(plan["target_profit_dollars"], 0)

    def test_the_stop_stays_inside_the_width_so_it_can_trade(self):
        narrow = a_spread(width=3.0, credit=2.0, max_loss=1.0)
        plan = bcs.recommend_management(narrow, rate(a_tech(), narrow), a_tech())
        self.assertLess(plan["stop_debit"], narrow["width"])
        self.assertGreater(plan["stop_debit"], narrow["credit"])

    def test_an_ex_dividend_inside_the_trade_sets_a_hard_close_by_date(self):
        """The one risk on the screen with an exact calendar answer."""
        ex = (date.today() + timedelta(days=20)).isoformat()
        s = a_spread(ex_dividend_inside=True, ex_dividend_date=ex,
                     early_assignment={"level": "high"})
        plan = bcs.recommend_management(s, rate(a_tech(), s), a_tech())
        self.assertEqual(plan["close_before"], ex)
        self.assertIn("short 100 shares", plan["close_before_note"])

    def test_a_harmless_ex_dividend_sets_no_deadline(self):
        ex = (date.today() + timedelta(days=20)).isoformat()
        s = a_spread(ex_dividend_inside=True, ex_dividend_date=ex,
                     early_assignment={"level": "low"})
        plan = bcs.recommend_management(s, rate(a_tech(), s), a_tech())
        self.assertIsNone(plan["close_before"])

    def test_an_estimated_ex_date_says_so(self):
        ex = (date.today() + timedelta(days=20)).isoformat()
        s = a_spread(ex_dividend_inside=True, ex_dividend_date=ex,
                     ex_dividend_estimated=True, early_assignment={"level": "high"})
        plan = bcs.recommend_management(s, rate(a_tech(), s), a_tech())
        self.assertIn("estimated", plan["close_before_note"])

    def test_the_invalidation_price_and_label_come_from_the_same_level(self):
        """They must not be quoted from two separate computations."""
        s = a_spread(resistance=104.0, resistance_label="50-day average")
        plan = bcs.recommend_management(s, rate(a_tech(), s), a_tech())
        self.assertEqual(plan["invalidate_price"], 104.0)
        self.assertIn("50-day average", plan["invalidate_note"])
        self.assertIn("104.00", plan["invalidate_note"])

    def test_without_a_level_the_plan_says_there_is_no_invalidation_price(self):
        naked = a_tech(sma_20=95.0, sma_50=96.0, sma_200=97.0,
                       swing_high_20=98.0, swing_high_60=99.0, week52_high=99.5)
        s = a_spread(resistance=None, resistance_label=None)
        plan = bcs.recommend_management(s, rate(naked, s), naked)
        self.assertIsNone(plan["invalidate_price"])
        self.assertIn("no price", plan["invalidate_note"])

    def test_a_longer_dated_trade_reassesses_at_21_dte(self):
        self.assertEqual(
            bcs.recommend_management(a_spread(dte=60), rate(a_tech(), a_spread(dte=60)), a_tech())["reassess_dte"],
            21,
        )

    def test_no_spread_means_no_plan(self):
        self.assertIsNone(bcs.recommend_management(None, rate(a_tech(), None), a_tech()))

    def test_a_degenerate_credit_produces_no_plan(self):
        self.assertIsNone(bcs.recommend_management(a_spread(credit=0.0), None, a_tech()))
        self.assertIsNone(bcs.recommend_management(a_spread(credit=12.0, width=10.0), None, a_tech()))


class VerdictTests(unittest.TestCase):
    """The one-line explanation has to name the trade and the biggest risk."""

    def row(self, tech_over=None, spread_over=None, fund=None):
        tech = a_tech(**(tech_over or {}))
        spread = a_spread(**(spread_over or {}))
        rating = rate(tech, spread, fund)
        plan = bcs.recommend_management(spread, rating, tech)
        return {**tech, **rating, "spread": {**spread, "management": plan}}

    def test_it_names_the_actual_order(self):
        v = bcs.build_verdict(self.row())
        self.assertIn("Sell the", v)
        self.assertIn("$105/$115 call spread", v)
        self.assertIn("$2.55", v)

    def test_it_states_the_risk_and_the_reward_in_dollars(self):
        v = bcs.build_verdict(self.row())
        self.assertIn("$255", v)
        self.assertIn("$745", v)

    def test_it_reports_the_cushion_in_percent_and_sigma(self):
        v = bcs.build_verdict(self.row())
        self.assertIn("7.5% cushion", v)
        self.assertIn("0.9σ over 35d", v)

    def test_it_names_the_overhead_level(self):
        self.assertIn("overhead", bcs.build_verdict(self.row()))

    def test_fresh_highs_get_the_sharpest_closing_line(self):
        v = bcs.build_verdict(self.row({"fresh_high": True, "pct_of_52w_range": 99.0}))
        self.assertIn("no wall left above", v)

    def test_a_squeeze_gets_its_own_closing_line(self):
        v = bcs.build_verdict(self.row({"run_off_low_pct": 32.0}))
        self.assertIn("squeeze", v)

    def test_leadership_gets_its_own_closing_line(self):
        v = bcs.build_verdict(self.row({"rel_strength_pct": 12.0}))
        self.assertIn("outrunning the market", v)

    def test_a_fat_upside_wing_gets_its_own_closing_line(self):
        v = bcs.build_verdict(self.row(spread_over={"upside_tail_ratio": 1.20}))
        self.assertIn("pricing a jump upward", v)

    def test_a_fund_is_described_as_a_fund(self):
        v = bcs.build_verdict(self.row(fund={"quote_type": "ETF", "total_assets": 40e9,
                                             "category": "Large Blend"}))
        self.assertTrue(v.startswith(("Broad index fund", "Sector fund", "Narrow fund")))

    def test_every_verdict_is_a_single_finished_sentence_block(self):
        self.assertTrue(bcs.build_verdict(self.row()).endswith("."))
        self.assertFalse(bcs.build_verdict(self.row()).endswith(".."))


class TechnicalTests(unittest.TestCase):
    """Stage-1 metrics off synthetic price history."""

    def test_a_rally_reads_positive_and_a_decline_reads_negative(self):
        sub = synthetic_frame(daily_sigma=0.008, move_pct=18.0, move_days=21)
        tech = bcs._compute_technicals(sub, None, 21)
        self.assertIsNotNone(tech)
        self.assertGreater(tech["rally_sigma"], 3.0)
        self.assertGreater(tech["window_pct"], 15.0)

    def test_the_rally_reading_is_the_bear_put_screens_decline_negated(self):
        """Both screens must be measuring one number, in opposite directions."""
        sub = synthetic_frame(daily_sigma=0.008, move_pct=12.0, move_days=21)
        mine = bcs._compute_technicals(sub, None, 21)
        theirs = bps._compute_technicals(sub, None, 21)
        self.assertAlmostEqual(mine["rally_sigma"], -theirs["stretch_sigma"], places=6)

    def test_it_agrees_with_the_covered_call_screen_on_the_rally_size(self):
        sub = synthetic_frame(daily_sigma=0.008, move_pct=12.0, move_days=21)
        mine = bcs._compute_technicals(sub, None, 21)
        theirs = cs._compute_technicals(sub, None, 21)
        self.assertAlmostEqual(mine["rally_sigma"], theirs["stretch_sigma"], places=6)

    def test_a_run_into_the_high_is_detected_as_a_fresh_high(self):
        sub = synthetic_frame(daily_sigma=0.006, drift=0.0015, move_pct=14.0, move_days=21)
        tech = bcs._compute_technicals(sub, None, 21)
        self.assertTrue(tech["fresh_high"])
        self.assertFalse(tech["rolled_over"])

    def test_a_rally_that_faded_is_detected_as_rolled_over(self):
        """Rise for a fortnight, then give a chunk of it back."""
        sub = synthetic_frame(daily_sigma=0.005, days=300, seed=11)
        close = sub["Close"].to_numpy(copy=True)
        close[-25:-8] = close[-26] * np.linspace(1.01, 1.13, 17)   # the rally
        close[-8:] = close[-9] * np.linspace(0.995, 0.94, 8)       # the rejection
        sub = sub.assign(Close=close, High=close * 1.008, Low=close * 0.992, Open=close * 0.999)
        tech = bcs._compute_technicals(sub, None, 21)
        self.assertTrue(tech["rolled_over"])
        self.assertFalse(tech["fresh_high"])
        self.assertGreater(tech["pullback_from_high_pct"], 0.0)
        self.assertGreater(tech["days_since_swing_high"], 0)

    def test_moving_average_slopes_carry_a_sign(self):
        rising = bcs._compute_technicals(synthetic_frame(daily_sigma=0.005, drift=0.0018), None, 21)
        falling = bcs._compute_technicals(synthetic_frame(daily_sigma=0.005, drift=-0.0018), None, 21)
        self.assertGreater(rising["sma50_slope_pct"], 0)
        self.assertLess(falling["sma50_slope_pct"], 0)

    def test_acceleration_compares_the_last_week_to_the_one_before(self):
        tech = bcs._compute_technicals(synthetic_frame(daily_sigma=0.006, move_pct=10.0, move_days=5), None, 21)
        self.assertGreater(tech["accel_pp"], 0)      # the move is in the last 5 days

    def test_thin_history_returns_nothing(self):
        self.assertIsNone(bcs._compute_technicals(synthetic_frame(days=40), None, 21))

    def test_dollar_volume_is_price_times_share_volume(self):
        tech = bcs._compute_technicals(synthetic_frame(), None, 21)
        self.assertAlmostEqual(tech["avg_dollar_volume"], tech["avg_volume"] * tech["price"], places=4)


class UniverseAndPartitionTests(unittest.TestCase):
    def test_small_cap_choices_are_added_to_the_shared_lists(self):
        for key in ("small_cap", "large_mid_small", "mid_small"):
            self.assertIn(key, bcs.SPREAD_UNIVERSE_CHOICES)
        for key in ps.UNIVERSE_CHOICES:
            self.assertIn(key, bcs.SPREAD_UNIVERSE_CHOICES)

    def test_the_small_cap_floor_is_stricter_than_the_bear_put_screens(self):
        """Because the risk here is a takeover gap, not a thin two-leg market."""
        self.assertGreater(
            bcs.DEFAULTS["small_cap_min_market_cap"],
            bps.DEFAULTS["small_cap_min_market_cap"],
        )

    def test_relative_performance_is_gated_as_a_maximum_not_a_minimum(self):
        """The only screen in the family where leadership disqualifies."""
        self.assertIn("max_rel_strength_pct", bcs.DEFAULTS)
        self.assertNotIn("min_rel_strength_pct", bcs.DEFAULTS)
        self.assertIn("min_rel_weakness_pct", bps.DEFAULTS)

    def test_the_target_horizon_is_shorter_than_the_debit_screens(self):
        """A seller is paid by time; a buyer has to buy enough of it."""
        self.assertLess(bcs.DEFAULTS["target_dte"], bps.DEFAULTS["target_dte"])
        self.assertEqual(bcs.DEFAULTS["target_dte"], bull.DEFAULTS["target_dte"])

    def test_every_disqualifying_condition_is_gated_by_default(self):
        """The docstring promises "excluded, not merely flagged"."""
        self.assertTrue(bcs.DEFAULTS["exclude_fresh_highs"])
        self.assertTrue(bcs.DEFAULTS["require_rolled_over"])
        self.assertTrue(bcs.DEFAULTS["require_resistance_overhead"])
        self.assertLess(bcs.DEFAULTS["max_accel_pp"], 99)
        self.assertLess(bcs.DEFAULTS["max_run_off_low_pct"], 999)
        self.assertLess(bcs.DEFAULTS["max_rally_sigma"], 99)

    def test_nothing_selected_resolves_to_nothing(self):
        self.assertEqual(
            bcs.resolve_scan_universe({"include_stocks": False,
                                       "include_index_etfs": False,
                                       "include_sector_etfs": False}),
            [],
        )

    def test_index_etfs_can_be_scanned_alone(self):
        tickers = bcs.resolve_scan_universe({"include_stocks": False, "include_index_etfs": True})
        self.assertTrue(tickers)
        self.assertIn("SPY", tickers)

    def test_only_actionable_rows_reach_the_primary_table(self):
        rows = [
            {"ticker": "A", "chain_status": "actionable", "score": 70},
            {"ticker": "B", "chain_status": "actionable", "score": 85},
            {"ticker": "C", "chain_status": "constraints_relaxed", "score": 95},
            {"ticker": "D", "chain_status": "not_priced", "score": 99},
            {"ticker": "E", "chain_status": "unavailable", "score": 60},
        ]
        actionable, watchlist = bcs._partition_candidate_rows(rows, 40)
        self.assertEqual([r["ticker"] for r in actionable], ["B", "A"])
        # A relaxed fallback never outranks its way onto the actionable table,
        # however high its score.
        self.assertEqual([r["ticker"] for r in watchlist], ["C", "E", "D"])

    def test_max_results_truncates_both_tables(self):
        rows = [{"ticker": f"T{i}", "chain_status": "actionable", "score": i} for i in range(50)]
        actionable, _ = bcs._partition_candidate_rows(rows, 10)
        self.assertEqual(len(actionable), 10)


class RoundingTests(unittest.TestCase):
    def test_none_survives_rounding(self):
        self.assertIsNone(bcs._round_spread(None))

    def test_dollar_figures_lose_their_cents(self):
        out = bcs._round_spread(a_spread(credit_dollars=254.999, max_loss_dollars=745.4))
        self.assertEqual(out["credit_dollars"], 255)
        self.assertEqual(out["max_loss_dollars"], 745)

    def test_both_legs_are_rounded(self):
        out = bcs._round_spread(a_spread(
            short_leg=a_leg(105.0, 2.50123, 2.60456, iv=0.341234, delta=0.264321),
        ))
        self.assertEqual(out["short_leg"]["bid"], 2.5)
        self.assertEqual(out["short_leg"]["iv"], 0.3412)
        self.assertEqual(out["short_leg"]["delta"], 0.264)

    def test_the_nested_dicts_are_not_mutated_in_place(self):
        original = a_spread()
        bcs._round_spread(original)
        self.assertEqual(original["short_leg"]["bid"], SHORT_LEG[1])


# ---------------------------------------------------------------------------
# Helpers for the cross-screen inversion tests
# ---------------------------------------------------------------------------

def _grade_for(score):
    """The grade the scorer would assign to a given normalized score."""
    if score >= 80:
        return "A"
    if score >= 70:
        return "B"
    if score >= 60:
        return "C"
    if score >= 50:
        return "D"
    return "F"


def bps_tech(**over):
    """A bear put screen tech dict, for the tests that compare the two screens."""
    base = {
        "ticker": "TEST", "price": 100.0,
        "window_pct": -9.0, "decline_pct": 9.0, "stretch_sigma": 1.4,
        "drawdown_pct": -14.0, "above_52w_low_pct": 22.0, "pct_of_52w_range": 55.0,
        "rel_weakness_pct": 6.0, "beta": 1.1, "rsi_14": 42.0, "rsi_roll_pp": -12.0,
        "sma_20": 103.0, "sma_50": 107.0, "sma_200": 112.0,
        "below_sma20": True, "below_sma50": True,
        "sma20_below_sma50": True, "sma50_below_sma200": True,
        "days_below_sma50": 9, "lower_high": True, "fresh_low": False,
        "bounce_off_low_pct": 1.5, "accel_pp": -3.0,
        "rv_30": 0.30, "rv_252": 0.28, "avg_dollar_volume": 400e6,
    }
    base.update(over)
    return base


def bps_spread(**over):
    """A bear put screen spread dict, for the cross-screen inversion tests."""
    base = {
        "expiration": (date.today() + timedelta(days=45)).isoformat(), "dte": 45,
        "long_strike": 100.0, "short_strike": 90.0, "width": 10.0,
        "debit": 3.40, "debit_pct_of_width": 34.0, "max_profit": 6.60,
        "max_loss": 3.40, "reward_risk": 1.94, "breakeven": 96.60,
        "required_move_sigma": 0.95, "edge_pct": 13.2, "skew_ratio": 1.06,
        "atm_iv": 0.32, "exec_cost_pct": 8.2, "open_interest_min": 800,
        "constraints_relaxed": False,
        "long_leg": {"iv": 0.32}, "short_leg": {"iv": 0.34},
    }
    base.update(over)
    return base


if __name__ == "__main__":
    unittest.main(verbosity=2)
