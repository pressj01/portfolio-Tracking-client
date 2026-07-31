"""Pure-math tests for the STT unbalanced butterfly scanner."""

from datetime import date, timedelta
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unbalanced_butterfly_scanner as scanner
import unbalanced_put_condor_scanner as condor_scanner


def leg(strike, mid, delta, *, iv=0.20, spread=0.20, oi=500, volume=100):
    return {
        "strike": float(strike),
        "bid": float(mid - spread / 2),
        "ask": float(mid + spread / 2),
        "mid": float(mid),
        "iv": float(iv),
        "delta": float(delta),
        "open_interest": oi,
        "volume": volume,
        "dte": 200,
    }


def expiration_in(days):
    return (date.today() + timedelta(days=days)).isoformat()


class TargetConstruction(unittest.TestCase):
    def test_twenty_delta_mode_balances_with_ten_delta_lower_long(self):
        self.assertAlmostEqual(scanner._lower_long_target(0.20), 0.10)
        result = scanner._build_butterfly(
            leg(100, 10, -0.20),
            leg(90, 6, -0.15),
            leg(70, 2, -0.10),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.20,
            tranche_quantity=4,
        )

        self.assertIsNotNone(result)
        self.assertAlmostEqual(result["position_delta"], 0.0)
        self.assertAlmostEqual(result["target_lower_long_delta"], 0.10)

    def test_twenty_five_delta_mode_balances_with_five_delta_lower_long(self):
        self.assertAlmostEqual(scanner._lower_long_target(0.25), 0.05)
        result = scanner._build_butterfly(
            leg(100, 10, -0.25),
            leg(90, 6, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.25,
            tranche_quantity=4,
        )

        self.assertIsNotNone(result)
        self.assertAlmostEqual(result["position_delta"], 0.0)
        self.assertAlmostEqual(result["target_lower_long_delta"], 0.05)

    def test_both_delta_modes_are_available(self):
        self.assertEqual(scanner._target_names("both"), ["20", "25"])
        self.assertEqual(scanner._target_names("20"), ["20"])
        self.assertEqual(scanner._target_names("25"), ["25"])


class PayoffArithmetic(unittest.TestCase):
    def test_course_four_eight_four_scale_and_broken_wing_payoff(self):
        result = scanner._build_butterfly(
            leg(100, 10, -0.25),
            leg(90, 6, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.25,
            tranche_quantity=4,
        )

        self.assertEqual(result["upper_long_quantity"], 4)
        self.assertEqual(result["body_short_quantity"], 8)
        self.assertEqual(result["lower_long_quantity"], 4)
        self.assertAlmostEqual(result["upper_width"], 10.0)
        self.assertAlmostEqual(result["lower_width"], 20.0)
        self.assertAlmostEqual(result["entry_credit"], 0.0)
        self.assertAlmostEqual(result["upper_flat_dollars"], 0.0)
        self.assertAlmostEqual(result["center_max_profit_dollars"], 4000.0)
        self.assertAlmostEqual(result["lower_flat_dollars"], -4000.0)
        self.assertAlmostEqual(result["max_profit_dollars"], 4000.0)
        self.assertAlmostEqual(result["max_loss_dollars"], 4000.0)
        self.assertAlmostEqual(result["lower_breakeven"], 80.0)
        self.assertIsNone(result["upper_breakeven"])

    def test_credit_shifts_both_expiration_flats_up(self):
        result = scanner._build_butterfly(
            leg(100, 9, -0.25),
            leg(90, 6, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.25,
            tranche_quantity=1,
        )

        self.assertAlmostEqual(result["entry_credit"], 1.0)
        self.assertAlmostEqual(result["upper_flat_outcome"], 1.0)
        self.assertAlmostEqual(result["center_max_profit"], 11.0)
        self.assertAlmostEqual(result["lower_flat_outcome"], -9.0)
        self.assertAlmostEqual(result["lower_breakeven"], 79.0)

    def test_equal_or_inverted_wings_are_not_broken_wing_butterflies(self):
        self.assertIsNone(scanner._build_butterfly(
            leg(100, 9, -0.25),
            leg(90, 6, -0.15),
            leg(80, 2, -0.05),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.25,
        ))


class ProbabilitiesAndDates(unittest.TestCase):
    def test_success_and_failure_are_complements_at_review_and_expiration(self):
        result = scanner._build_butterfly(
            leg(100, 10, -0.25),
            leg(90, 6, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.25,
            tranche_quantity=4,
        )
        schedule = result["probability_schedule"]

        self.assertEqual(
            [point["label"] for point in schedule],
            ["Halfway review", "Two-thirds review", "Expiration"],
        )
        self.assertEqual(
            [point["remaining_dte"] for point in schedule],
            [100, 67, 0],
        )
        for point in schedule:
            self.assertAlmostEqual(
                point["probability_success_pct"]
                + point["probability_failure_pct"],
                100.0,
            )

    def test_flat_upper_line_counts_as_success_not_failure(self):
        result = scanner._build_butterfly(
            leg(100, 10, -0.25),
            leg(90, 6, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.25,
            tranche_quantity=4,
        )
        expiration = result["probability_schedule"][-1]
        expected_failure = scanner._prob_finish_below(
            110,
            result["lower_breakeven"],
            200 / 365,
            result["probability_iv"],
            scanner.RISK_FREE,
            0.0,
        ) * 100.0

        self.assertAlmostEqual(
            expiration["probability_failure_pct"],
            expected_failure,
            places=1,
        )
        self.assertAlmostEqual(
            expiration["probability_success_pct"],
            100.0 - expiration["probability_failure_pct"],
            places=1,
        )
        self.assertGreater(
            expiration["probability_success_pct"],
            expiration["probability_failure_pct"],
        )
        self.assertEqual(len(expiration["profitable_ranges"]), 1)
        self.assertIsNone(expiration["profitable_ranges"][0]["upper"])

    def test_touch_schedule_uses_the_same_condor_review_dates(self):
        result = scanner._build_butterfly(
            leg(100, 10, -0.25),
            leg(90, 6, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.25,
            tranche_quantity=4,
        )

        self.assertEqual(
            [point["elapsed_days"] for point in result["upper_long_touch_schedule"]],
            [100, 133],
        )
        self.assertGreaterEqual(
            result["prob_touch_upper_long_pct"],
            result["upper_long_touch_schedule"][-1]["prob_touch_pct"],
        )

    def test_default_dte_window_matches_unbalanced_put_condor(self):
        for key in ("target_dte", "min_dte", "max_dte"):
            self.assertEqual(
                scanner.DEFAULTS[key],
                condor_scanner.DEFAULTS[key],
            )

    def test_time_evolution_reprices_the_tent_at_each_checkpoint(self):
        result = scanner._build_butterfly(
            leg(100, 10, -0.25),
            leg(90, 6, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_in(200),
            dte=200,
            upper_long_target=0.25,
            tranche_quantity=4,
        )
        schedule = result["probability_schedule"]

        self.assertEqual(len(schedule), 3)
        for point in schedule:
            self.assertIsNotNone(point["unchanged_spot_pl_dollars"])
            self.assertIsNotNone(point["upper_long_pl_dollars"])
            self.assertIsNotNone(point["body_peak_pl_dollars"])
        self.assertAlmostEqual(
            schedule[-1]["body_peak_pl_dollars"],
            result["center_max_profit_dollars"],
        )
        self.assertAlmostEqual(
            schedule[-1]["unchanged_spot_pl_dollars"],
            result["upper_flat_dollars"],
        )


class MonthlyExpirationSelection(unittest.TestCase):
    def test_standard_monthly_and_holiday_shift_are_recognized(self):
        third_friday = scanner._third_friday(2027, 1)
        self.assertTrue(scanner._is_standard_monthly(third_friday.isoformat()))
        self.assertTrue(scanner._is_standard_monthly(
            (third_friday - timedelta(days=1)).isoformat()
        ))
        self.assertFalse(scanner._is_standard_monthly(
            (third_friday - timedelta(days=4)).isoformat()
        ))


if __name__ == "__main__":
    unittest.main()
