"""Pure-math tests for the unbalanced put-condor scanner."""

import os
import sys
import unittest
from datetime import date, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unbalanced_put_condor_scanner as scanner


def leg(strike, mid, delta, spread=0.20, oi=500, volume=100):
    return {
        "strike": float(strike),
        "bid": float(mid - spread / 2),
        "ask": float(mid + spread / 2),
        "mid": float(mid),
        "iv": 0.20,
        "delta": float(delta),
        "open_interest": oi,
        "volume": volume,
        "dte": 170,
    }


class PayoffArithmetic(unittest.TestCase):
    def test_screenshot_10_by_20_credit_structure(self):
        result = scanner._build_put_condor(
            upper_long=leg(710, 17.94, -0.30),
            upper_short=leg(700, 16.08, -0.26),
            lower_short=leg(665, 11.24, -0.17),
            lower_long=leg(645, 9.24, -0.14),
            spot=740.13,
            expiration="2027-01-15",
            dte=170,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )

        self.assertIsNotNone(result)
        self.assertAlmostEqual(result["bought_width"], 10.0)
        self.assertAlmostEqual(result["sold_width"], 20.0)
        self.assertAlmostEqual(result["bought_debit"], 1.86)
        self.assertAlmostEqual(result["sold_credit"], 2.00)
        self.assertAlmostEqual(result["entry_credit"], 0.14)
        self.assertAlmostEqual(result["entry_credit_dollars"], 14.0)
        self.assertAlmostEqual(result["upper_flat_dollars"], 14.0)
        self.assertAlmostEqual(result["center_max_profit"], 10.14)
        self.assertAlmostEqual(result["max_profit_dollars"], 1014.0)
        self.assertAlmostEqual(result["lower_flat_dollars"], -986.0)
        self.assertAlmostEqual(result["max_loss_dollars"], 986.0)
        self.assertAlmostEqual(result["lower_breakeven"], 654.86)
        self.assertIsNone(result["upper_breakeven"])
        self.assertGreater(result["prob_touch_lower_short_pct"], 0.0)
        self.assertGreaterEqual(
            result["prob_touch_lower_short_pct"],
            result["prob_touch_lower_long_pct"],
        )
        self.assertGreaterEqual(
            result["prob_touch_lower_long_pct"],
            result["prob_finish_below_lower_long_pct"],
        )
        self.assertGreaterEqual(
            result["prob_touch_lower_short_pct"],
            result["prob_finish_below_lower_short_pct"],
        )
        self.assertGreaterEqual(
            result["prob_finish_below_lower_short_pct"],
            result["prob_finish_below_lower_long_pct"],
        )

    def test_equal_width_debit_has_two_equal_flat_losses(self):
        result = scanner._build_put_condor(
            upper_long=leg(105, 5.0, -0.30),
            upper_short=leg(100, 3.0, -0.25),
            lower_short=leg(90, 1.5, -0.15),
            lower_long=leg(85, 0.5, -0.10),
            spot=110,
            expiration="2027-01-15",
            dte=170,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )

        self.assertAlmostEqual(result["entry_credit"], -1.0)
        self.assertAlmostEqual(result["upper_flat_outcome"], -1.0)
        self.assertAlmostEqual(result["center_max_profit"], 4.0)
        self.assertAlmostEqual(result["lower_flat_outcome"], -1.0)
        self.assertAlmostEqual(result["max_profit_dollars"], 400.0)
        self.assertAlmostEqual(result["max_loss_dollars"], 100.0)
        self.assertAlmostEqual(result["lower_breakeven"], 86.0)
        self.assertAlmostEqual(result["upper_breakeven"], 104.0)

    def test_position_delta_is_reported_in_contract_share_equivalents(self):
        result = scanner._build_put_condor(
            upper_long=leg(105, 5.0, -0.30),
            upper_short=leg(100, 3.0, -0.25),
            lower_short=leg(90, 1.5, -0.15),
            lower_long=leg(85, 0.5, -0.09),
            spot=110,
            expiration="2027-01-15",
            dte=170,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )

        # -30 + 25 + 15 - 9 = +1 share equivalent.
        self.assertAlmostEqual(result["position_delta_per_share"], 0.01)
        self.assertAlmostEqual(result["position_delta"], 1.0)

    def test_five_debit_ten_credit_quantity_ratio_can_be_delta_balanced(self):
        result = scanner._build_put_condor(
            upper_long=leg(105, 5.0, -0.30),
            upper_short=leg(100, 3.0, -0.25),
            lower_short=leg(90, 1.5, -0.10),
            lower_long=leg(80, 0.5, -0.075),
            spot=110,
            expiration="2027-01-15",
            dte=170,
            preset="20/10",
            target_upper_delta=0.20,
            target_lower_delta=0.10,
            bought_quantity=5,
            sold_quantity=10,
        )

        # Five debit spreads contribute -25 share deltas; ten credit spreads
        # contribute +25.  Quantities, not just strikes, balance the package.
        self.assertAlmostEqual(result["position_delta"], 0.0)
        self.assertEqual(result["bought_quantity"], 5)
        self.assertEqual(result["sold_quantity"], 10)
        self.assertAlmostEqual(result["bought_debit"], 10.0)
        self.assertAlmostEqual(result["sold_credit"], 10.0)
        self.assertAlmostEqual(result["upper_flat_outcome"], 0.0)
        self.assertAlmostEqual(result["center_max_profit"], 25.0)
        self.assertAlmostEqual(result["lower_flat_outcome"], -75.0)

    def test_out_of_order_strikes_are_rejected(self):
        self.assertIsNone(scanner._build_put_condor(
            upper_long=leg(105, 5.0, -0.30),
            upper_short=leg(100, 3.0, -0.25),
            lower_short=leg(90, 1.5, -0.15),
            lower_long=leg(95, 0.5, -0.10),
            spot=110,
            expiration="2027-01-15",
            dte=170,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        ))


class DownsideProbabilities(unittest.TestCase):
    def test_touch_probability_is_at_least_terminal_probability(self):
        finish = scanner._prob_finish_below(
            spot=110,
            barrier=90,
            years=180 / 365,
            volatility=0.20,
        )
        touch = scanner._prob_touch_lower(
            spot=110,
            barrier=90,
            years=180 / 365,
            volatility=0.20,
        )

        self.assertGreaterEqual(touch, finish)
        self.assertGreaterEqual(finish, 0.0)
        self.assertLessEqual(touch, 1.0)

    def test_already_at_back_short_counts_as_a_touch(self):
        self.assertEqual(
            scanner._prob_touch_lower(
                spot=90,
                barrier=90,
                years=180 / 365,
                volatility=0.20,
            ),
            1.0,
        )

    def test_front_long_is_easier_to_reach_than_the_back_short(self):
        result = scanner._build_put_condor(
            upper_long=leg(710, 17.94, -0.30),
            upper_short=leg(700, 16.08, -0.26),
            lower_short=leg(665, 11.24, -0.17),
            lower_long=leg(645, 9.24, -0.14),
            spot=740.13,
            expiration="2027-01-15",
            dte=170,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )

        self.assertGreater(
            result["prob_touch_upper_long_pct"],
            result["prob_touch_lower_short_pct"],
        )
        self.assertGreaterEqual(
            result["prob_touch_upper_long_pct"],
            result["prob_finish_below_upper_long_pct"],
        )
        self.assertAlmostEqual(result["upper_long_distance_pct"], 4.07, places=2)

    def test_touch_schedule_shares_the_early_close_dates_and_rises_over_time(self):
        candidate = scanner._build_put_condor(
            upper_long=leg(710, 17.94, -0.30),
            upper_short=leg(700, 16.08, -0.26),
            lower_short=leg(665, 11.24, -0.17),
            lower_long=leg(645, 9.24, -0.14),
            spot=740.13,
            expiration="2027-01-15",
            dte=169,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )
        schedule = candidate["upper_long_touch_schedule"]

        # The card labels these dates, so they must match the early-close card.
        self.assertEqual(
            [step["elapsed_days"] for step in schedule],
            [
                scanner._early_close_estimate(candidate, 740.13, 169, fraction)["elapsed_days"]
                for fraction in scanner.EARLY_CLOSE_FRACTIONS
            ],
        )
        self.assertEqual([step["remaining_dte"] for step in schedule], [85, 56])
        # A longer window can only add first-passage paths, never remove them.
        self.assertLess(
            schedule[0]["prob_touch_pct"],
            schedule[1]["prob_touch_pct"],
        )
        self.assertLess(
            schedule[1]["prob_touch_pct"],
            candidate["prob_touch_upper_long_pct"],
        )

    def test_touch_schedule_is_empty_when_the_expiration_is_too_close(self):
        candidate = scanner._build_put_condor(
            upper_long=leg(105, 5.0, -0.30),
            upper_short=leg(100, 3.0, -0.25),
            lower_short=leg(90, 1.5, -0.15),
            lower_long=leg(85, 0.5, -0.10),
            spot=110,
            expiration="2026-08-01",
            dte=1,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )

        self.assertEqual(candidate["upper_long_touch_schedule"], [])
        self.assertIsNotNone(candidate["prob_touch_upper_long_pct"])

    def test_front_long_probability_uses_its_own_iv_not_the_back_short_skew(self):
        upper_long = leg(710, 17.94, -0.30)
        upper_long["iv"] = 0.18
        skewed_back_short = leg(665, 11.24, -0.17)
        skewed_back_short["iv"] = 0.35
        result = scanner._build_put_condor(
            upper_long=upper_long,
            upper_short=leg(700, 16.08, -0.26),
            lower_short=skewed_back_short,
            lower_long=leg(645, 9.24, -0.14),
            spot=740.13,
            expiration="2027-01-15",
            dte=170,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )
        expected = scanner._prob_touch_lower(
            spot=740.13,
            barrier=710,
            years=170 / 365,
            volatility=0.18,
        )

        self.assertAlmostEqual(result["upper_long_probability_iv"], 0.18)
        self.assertAlmostEqual(
            result["prob_touch_upper_long_pct"],
            expected * 100.0,
        )

    def test_missing_front_long_iv_falls_back_to_the_shared_distribution(self):
        upper_long = leg(105, 5.0, -0.30)
        upper_long["iv"] = None
        result = scanner._build_put_condor(
            upper_long=upper_long,
            upper_short=leg(100, 3.0, -0.25),
            lower_short=leg(90, 1.5, -0.15),
            lower_long=leg(85, 0.5, -0.10),
            spot=110,
            expiration="2027-01-15",
            dte=170,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )

        self.assertAlmostEqual(result["upper_long_probability_iv"], 0.20)
        self.assertGreater(result["prob_touch_upper_long_pct"], 0.0)

    def test_missing_iv_does_not_publish_a_false_zero_probability(self):
        lower_short = leg(90, 1.5, -0.15)
        lower_short["iv"] = None
        result = scanner._build_put_condor(
            upper_long=leg(105, 5.0, -0.30),
            upper_short=leg(100, 3.0, -0.25),
            lower_short=lower_short,
            lower_long=leg(85, 0.5, -0.10),
            spot=110,
            expiration="2027-01-15",
            dte=170,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )

        self.assertIsNone(result["prob_touch_lower_short_pct"])
        self.assertIsNone(result["prob_touch_lower_long_pct"])
        self.assertIsNone(result["prob_finish_below_lower_short_pct"])
        self.assertIsNone(result["prob_finish_below_lower_long_pct"])


class EarlyCloseProbabilities(unittest.TestCase):
    @staticmethod
    def candidate():
        return scanner._build_put_condor(
            upper_long=leg(105, 5.0, -0.30),
            upper_short=leg(100, 3.0, -0.25),
            lower_short=leg(90, 1.5, -0.15),
            lower_long=leg(85, 0.5, -0.10),
            spot=110,
            expiration="2027-01-15",
            dte=180,
            preset="25/15",
            target_upper_delta=0.25,
            target_lower_delta=0.15,
        )

    def test_exit_mark_matches_expiration_payoff_regions(self):
        candidate = self.candidate()

        self.assertAlmostEqual(
            scanner._position_pl_at_exit(candidate, 110, 0),
            candidate["upper_flat_outcome"],
        )
        self.assertAlmostEqual(
            scanner._position_pl_at_exit(candidate, 95, 0),
            candidate["center_max_profit"],
        )
        self.assertAlmostEqual(
            scanner._position_pl_at_exit(candidate, 80, 0),
            candidate["lower_flat_outcome"],
        )

    def test_half_and_two_thirds_exit_estimates_include_profitable_bounds(self):
        candidate = self.candidate()
        half = scanner._early_close_estimate(candidate, 110, 180, 0.50)
        two_thirds = scanner._early_close_estimate(candidate, 110, 180, 2 / 3)

        self.assertEqual(half["elapsed_days"], 90)
        self.assertEqual(half["remaining_dte"], 90)
        self.assertEqual(two_thirds["elapsed_days"], 120)
        self.assertEqual(two_thirds["remaining_dte"], 60)
        for estimate in (half, two_thirds):
            self.assertGreater(estimate["probability_profit_pct"], 0.0)
            self.assertLess(estimate["probability_profit_pct"], 100.0)
            self.assertEqual(len(estimate["profitable_ranges"]), 1)
            self.assertLess(
                estimate["profitable_ranges"][0]["lower"],
                estimate["profitable_ranges"][0]["upper"],
            )

    def test_probability_can_cover_all_prices(self):
        candidate = self.candidate()
        candidate["entry_credit"] = 1000.0
        estimate = scanner._early_close_estimate(candidate, 110, 180, 0.50)

        self.assertAlmostEqual(estimate["probability_profit_pct"], 100.0)
        self.assertEqual(
            estimate["profitable_ranges"],
            [{"lower": None, "upper": None}],
        )

    def test_missing_leg_iv_suppresses_early_close_estimate(self):
        candidate = self.candidate()
        candidate["lower_long_leg"]["iv"] = None

        self.assertIsNone(
            scanner._early_close_estimate(candidate, 110, 180, 0.50)
        )


class DeltaSelection(unittest.TestCase):
    @staticmethod
    def candidate(position_delta, delta_error=0.01):
        return {
            "position_delta": position_delta,
            "upper_delta_error": delta_error,
            "lower_delta_error": delta_error,
            "width_error_pct": 0.0,
            "open_interest_min": 500,
            "entry_credit": 0.10,
            "natural_credit": 0.0,
            "center_max_profit": 5.0,
        }

    def choose(self, candidates, target):
        return scanner._choose_candidate(
            candidates,
            target_position_delta=target,
            delta_tolerance=0.04,
            width_tolerance_pct=20.0,
            min_open_interest=0,
            require_upside_credit=False,
        )

    def test_neutral_target_selects_flattest_package(self):
        candidates = [
            self.candidate(-3.0),
            self.candidate(0.25),
            self.candidate(2.0),
        ]
        self.assertEqual(self.choose(candidates, 0.0)["position_delta"], 0.25)

    def test_bullish_target_selects_positive_lean(self):
        candidates = [
            self.candidate(-1.5),
            self.candidate(0.0),
            self.candidate(1.4),
        ]
        self.assertEqual(self.choose(candidates, 1.5)["position_delta"], 1.4)

    def test_bearish_target_selects_negative_lean(self):
        candidates = [
            self.candidate(-1.6),
            self.candidate(0.0),
            self.candidate(1.5),
        ]
        self.assertEqual(self.choose(candidates, -1.5)["position_delta"], -1.6)

    def test_structural_constraints_apply_before_delta_optimization(self):
        perfect_delta_but_wrong_leg = self.candidate(0.0, delta_error=0.20)
        acceptable = self.candidate(1.0)
        chosen = self.choose([perfect_delta_but_wrong_leg, acceptable], 0.0)
        self.assertIs(chosen, acceptable)


class StaleChainHandling(unittest.TestCase):
    """A snapshot with no live markets is a data outage, not a verdict.

    Outside market hours the feed zeroes bid/ask on nearly every contract and
    reports a placeholder implied vol from its failed solver.  The scanner used
    to answer that in one of two wrong ways: "no quotable four-put combination",
    which reads as though the market has no such trade, or - when a handful of
    strikes survived - a fully rendered structure built from the only strikes
    left, with probability cards priced off vols that were never quoted.
    """

    def test_placeholder_implied_vol_is_not_a_tradable_leg(self):
        # 0.062509 is one term of the feed's 0.5, 0.25, ... halving sequence.
        # The vol floor cannot be raised to catch this term without rejecting
        # genuinely low-vol underlyings, so what disqualifies the leg is the
        # missing quote that produced the placeholder in the first place.
        stale = leg(600, 5.0, -0.05)
        stale["iv"] = 0.062509
        stale["bid"], stale["ask"] = 0.0, 0.0

        self.assertFalse(scanner._tradable_leg(stale, spot=741.69))

    def test_degenerate_vol_is_rejected_even_if_a_quote_exists(self):
        # The tail of the same sequence would put absurd greeks and touch
        # probabilities on a leg that does carry a two-sided market.
        degenerate = leg(600, 5.0, -0.05)
        degenerate["iv"] = 0.000010

        self.assertFalse(scanner._has_credible_iv(degenerate))
        self.assertFalse(scanner._tradable_leg(degenerate, spot=741.69))

    def test_quoted_leg_with_a_real_vol_is_tradable(self):
        live = leg(636, 9.155, -0.1261)
        live["iv"] = 0.2404

        self.assertTrue(scanner._tradable_leg(live, spot=741.69))

    def test_zero_bid_leg_is_not_tradable_even_with_a_real_vol(self):
        no_market = leg(636, 9.155, -0.1261)
        no_market["iv"] = 0.2404
        no_market["bid"] = 0.0

        self.assertFalse(scanner._tradable_leg(no_market, spot=741.69))

    def test_chain_quality_counts_only_live_strikes_below_spot(self):
        live = leg(700, 16.0, -0.26)
        dead = leg(600, 5.0, -0.05)
        dead["bid"], dead["ask"], dead["iv"] = 0.0, 0.0, 0.062509
        above_spot = leg(800, 60.0, -0.90)

        quality = scanner._chain_quality([live, dead, above_spot], spot=741.69)

        self.assertEqual(quality["strikes"], 3)
        self.assertEqual(quality["strikes_below_spot"], 2)
        self.assertEqual(quality["quoted_below_spot"], 1)

    def test_scan_reports_the_outage_instead_of_inventing_a_structure(self):
        # The real 2026-12-31 SPY snapshot: five live strikes in a $10 band,
        # everything else quoteless.  Those five are the exact legs the scanner
        # used to publish as a "20/10" structure.
        survivors = [
            (636.0, 9.155, -0.1261, 0.2404),
            (634.0, 8.970, -0.1233, 0.2421),
            (632.0, 7.245, -0.1077, 0.2286),
            (631.0, 8.695, -0.1193, 0.2444),
            (626.0, 8.260, -0.1129, 0.2485),
        ]
        chain = []
        for strike, mid, delta, iv in survivors:
            live = leg(strike, mid, delta, spread=0.05)
            live["iv"] = iv
            chain.append(live)
        for strike in range(560, 741, 5):
            dead = leg(strike, 0.0, -0.05, volume=0)
            dead["bid"], dead["ask"], dead["mid"] = 0.0, 0.0, 7.5
            dead["iv"] = 0.062509
            chain.append(dead)

        expiration = (date.today() + timedelta(days=154)).isoformat()
        with patch.object(scanner, "_load_history"), \
                patch.object(scanner, "_fetch_fundamentals_bulk", return_value={}), \
                patch.object(scanner, "_load_put_chain", return_value=chain), \
                patch.object(scanner, "_ticker_frame"), \
                patch.object(scanner, "dividend_yield_for_pricing", return_value=0.0), \
                patch.object(scanner.yf, "Ticker") as ticker:
            ticker.return_value.options = [expiration]
            scanner._ticker_frame.return_value = {
                "Close": _CloseSeries(741.69)
            }
            result = scanner.run_unbalanced_put_condor_scan({
                "tickers": "SPY",
                "target_dte": 154,
                "min_dte": 120,
                "max_dte": 240,
            })

        self.assertEqual(result["rows"], [])
        self.assertEqual(len(result["unavailable"]), 1)
        outage = result["unavailable"][0]
        self.assertIn("No usable quotes", outage["reason"])
        self.assertIn("defensible live or recent-trade prices", outage["reason"])
        self.assertEqual(outage["chain_quality"]["quoted_below_spot"], 5)
        self.assertEqual(outage["chain_quality"]["usable_below_spot"], 5)


class _CloseSeries:
    """Minimal stand-in for the close column of a price frame."""

    def __init__(self, last):
        self._last = last

    def dropna(self):
        return self

    @property
    def empty(self):
        return False

    @property
    def iloc(self):
        return [self._last]


class StructuralSanity(unittest.TestCase):
    """Strike order alone does not make four puts an unbalanced condor."""

    def test_non_monotonic_deltas_are_rejected(self):
        # The published 636/632/631/626 structure: the 631 short carried more
        # delta than the 632 short above it, which no real vol surface allows.
        self.assertIsNone(scanner._build_put_condor(
            upper_long=leg(636, 9.155, -0.1261),
            upper_short=leg(632, 7.245, -0.1077),
            lower_short=leg(631, 8.695, -0.1193),
            lower_long=leg(626, 8.260, -0.1129),
            spot=741.69,
            expiration="2026-12-31",
            dte=154,
            preset="20/10",
            target_upper_delta=0.20,
            target_lower_delta=0.10,
        ))

    def test_inverted_shorts_are_rejected(self):
        self.assertFalse(scanner._deltas_are_ordered(
            leg(105, 5.0, -0.30),
            leg(100, 3.0, -0.15),
            leg(90, 1.5, -0.16),
            leg(85, 0.5, -0.10),
        ))

    def test_ordinary_structure_passes(self):
        self.assertTrue(scanner._deltas_are_ordered(
            leg(105, 5.0, -0.30),
            leg(100, 3.0, -0.25),
            leg(90, 1.5, -0.15),
            leg(85, 0.5, -0.10),
        ))

    def test_adjacent_strike_quote_noise_is_tolerated(self):
        # A hair of inversion between neighbouring strikes is quote noise, not
        # a broken surface, and must not throw away a real structure.
        self.assertTrue(scanner._deltas_are_ordered(
            leg(105, 5.0, -0.300),
            leg(100, 3.0, -0.302),
            leg(90, 1.5, -0.150),
            leg(85, 0.5, -0.100),
        ))

    def test_shorts_one_strike_apart_do_not_form_a_condor(self):
        chain = []
        for strike, delta in (
            (640, -0.30), (636, -0.26), (632, -0.22), (631, -0.21),
            (626, -0.17), (621, -0.13), (616, -0.10), (611, -0.08),
        ):
            # Puts get cheaper as the strike falls, so the debit and credit
            # spreads both price positive.
            live = leg(strike, (strike - 600) / 5.0, delta, spread=0.05)
            chain.append(live)

        candidates = scanner._candidates_for_preset(
            chain, 741.69, "2026-12-31", 154, "20/10",
            bought_width=5.0, sold_width=10.0,
            bought_quantity=1, sold_quantity=1, dividend_yield=0.0,
        )

        self.assertTrue(candidates)
        for candidate in candidates:
            gap = candidate["upper_short_strike"] - candidate["lower_short_strike"]
            self.assertGreaterEqual(gap, 5.0)


class ExpirationFallback(unittest.TestCase):
    def test_expirations_are_ranked_by_closeness_to_target(self):
        today = date.today()
        expirations = [
            (today + timedelta(days=offset)).isoformat()
            for offset in (100, 130, 154, 169, 250)
        ]

        ranked = scanner._ranked_expirations(
            expirations, target_dte=161, min_dte=120, max_dte=240,
        )

        # 100 and 250 are outside the window; 154 beats 169 by one day.
        self.assertEqual([dte for _, dte in ranked], [154, 169, 130])

    def test_window_with_no_listed_expiration_is_empty(self):
        today = date.today()
        self.assertEqual(
            scanner._ranked_expirations(
                [(today + timedelta(days=30)).isoformat()],
                target_dte=180, min_dte=120, max_dte=240,
            ),
            [],
        )


class Presets(unittest.TestCase):
    def test_named_pairs_are_exact(self):
        self.assertEqual(scanner.DELTA_PRESETS["15/5"], (0.15, 0.05))
        self.assertEqual(scanner.DELTA_PRESETS["20/10"], (0.20, 0.10))
        self.assertEqual(scanner.DELTA_PRESETS["25/15"], (0.25, 0.15))

    def test_all_returns_all_three_pairs(self):
        self.assertEqual(
            scanner._preset_names("all"),
            ["15/5", "20/10", "25/15"],
        )

    def test_leg_view_preserves_half_cent_pricing_for_ratio_handoff(self):
        viewed = scanner._leg_view(leg(100, 1.235, -0.20, spread=0.01))
        self.assertAlmostEqual(viewed["mid"], 1.235)


if __name__ == "__main__":
    unittest.main(verbosity=2)
