"""Pure-math tests for the unbalanced put-condor scanner."""

import os
import sys
import unittest

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
