import unittest
from backend.nav_assessment import (
    CapitalObservation, assess, daily_exposure_reference, reinvested_return,
    same_cash_reference,
)


class MethodCounterexamples(unittest.TestCase):
    def test_market_fall_and_same_payout_does_not_prove_structural_erosion(self):
        # Both start at 100, lose 20%, then distribute 10: both retain 70.
        ref = same_cash_reference(100, [-0.2], [10])
        result = assess(CapitalObservation(100, 70, 10), ref, reference_quality="exposure")
        self.assertEqual(result["reference_status"], "within_precision")
        self.assertEqual(result["structural_erosion"], "unconfirmed")
        self.assertIn("investment losses", result["review"])

    def test_underperforming_in_a_rally_does_not_mean_capital_eroded(self):
        ref = same_cash_reference(100, [0.25], [10])
        result = assess(CapitalObservation(100, 105, 10), ref)
        self.assertEqual(result["capital_status"], "preserved")
        self.assertEqual(result["reference_status"], "below")
        self.assertFalse(result["payouts_not_replenished"])

    def test_outperformance_does_not_hide_unreplenished_payouts(self):
        # Fund earns 20 and pays 30. Benchmark earns 10 and pays the same 30.
        ref = same_cash_reference(100, [0.10], [30])
        result = assess(CapitalObservation(100, 90, 30), ref)
        self.assertEqual(result["investment_result"], 20)
        self.assertEqual(result["reference_status"], "above")
        self.assertTrue(result["payouts_not_replenished"])

    def test_fund_can_lose_more_than_a_falling_market(self):
        ref = same_cash_reference(100, [-0.05], [10])
        result = assess(CapitalObservation(100, 70, 10), ref)
        self.assertEqual(result["reference_status"], "below")
        self.assertAlmostEqual(result["ending_capital_gap"], -15)

    def test_share_price_discount_widening_cannot_establish_nav_erosion(self):
        result = assess(CapitalObservation(100, 80, 5, basis="market_price"))
        self.assertEqual(result["capital_status"], "unconfirmed")
        self.assertIsNone(result["payouts_not_replenished"])

    def test_missing_reference_does_not_become_a_zero_or_green_grade(self):
        result = assess(CapitalObservation(100, 90, 15))
        self.assertEqual(result["reference_status"], "unavailable")
        self.assertEqual(result["structural_erosion"], "unconfirmed")

    def test_unresolved_split_or_incomplete_distributions_prevents_nav_verdict(self):
        for flags in [dict(corporate_actions_resolved=False), dict(data_complete=False)]:
            self.assertEqual(assess(CapitalObservation(100, 10, 5, **flags))["capital_status"], "unconfirmed")

    def test_reinvestment_is_not_added_twice(self):
        # Two 10% distributions with flat ex-distribution NAV: 20% cash vs 21% DRIP.
        self.assertAlmostEqual(CapitalObservation(100, 100, 20).measure()["cash_total_return"], .2)
        self.assertAlmostEqual(reinvested_return([100, 100, 100], [10, 10]), .21)

    def test_reference_cash_timing_changes_remaining_capital(self):
        early = same_cash_reference(100, [.1, .1], [10, 0])
        late = same_cash_reference(100, [.1, .1], [0, 10])
        self.assertAlmostEqual(early["ending_value"], 110)
        self.assertAlmostEqual(late["ending_value"], 111)

    def test_exhaustion_is_reported_instead_of_negative_reference_assets(self):
        self.assertEqual(same_cash_reference(100, [-.9], [20])["status"], "exhausted")

    def test_daily_leverage_does_not_multiply_the_full_period_return(self):
        ref = daily_exposure_reference([[.1, -.1]], [1.3], [.001, .001])
        final = same_cash_reference(100, ref, [0, 0])["ending_value"]
        self.assertNotAlmostEqual(final, 100 * (1 + 1.3 * (1.1 * .9 - 1)))

    def test_stacked_legs_have_two_hundred_percent_exposure_not_fifty_fifty(self):
        self.assertAlmostEqual(daily_exposure_reference([[.1], [.05]], [1, 1], [.002])[0], .148)

    def test_no_distribution_ratio_when_there_are_no_distributions(self):
        result = assess(CapitalObservation(100, 95, 0))
        self.assertIsNone(result["result_to_payout_ratio"])
        self.assertIsNone(result["payouts_not_replenished"])
        self.assertIn("no distributions", result["review"])

    def test_final_liquidation_payment_is_not_a_recurring_payout_warning(self):
        result = assess(CapitalObservation(100, 0, 103, liquidated=True))
        self.assertEqual(result["capital_status"], "liquidated")
        self.assertEqual(result["investment_result"], 3)
        self.assertIsNone(result["payouts_not_replenished"])

    def test_source_rounding_does_not_create_a_material_decline_claim(self):
        result = assess(CapitalObservation(50, 49.995, 5), tolerance=.01)
        self.assertEqual(result["capital_status"], "within_precision")
        self.assertFalse(result["payouts_not_replenished"])

    def test_bad_dates_and_nonfinite_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            same_cash_reference(100, [.1, .1], [5])
        with self.assertRaises(ValueError):
            CapitalObservation(100, float("nan"), 5).measure()

    def test_published_fund_accounting_fixtures(self):
        # Official rounded financial highlights. Periods differ; not a ranking.
        fixtures = [
            ("QQQI", 53.84, 56.89, 3.80, "preserved"),
            ("SPYI", 52.49, 53.16, 3.15, "preserved"),
            ("TDAQ", 26.04, 28.29, 2.21529, "preserved"),
            ("CHPY", 50.00, 53.28, 6.34, "preserved"),
            ("GPTY", 50.00, 46.40, 7.61, "declined"),
        ]
        for ticker, start, end, paid, expected in fixtures:
            with self.subTest(ticker=ticker):
                result = assess(CapitalObservation(start, end, paid))
                self.assertEqual(result["capital_status"], expected)
                self.assertAlmostEqual(result["investment_result"], end-start+paid)
                # No matched daily benchmark was provided for these fixtures.
                self.assertEqual(result["structural_erosion"], "unconfirmed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
