"""Pure construction tests for the risk-budgeted put-condor scanner."""

import unittest

import put_condor_scanner as scanner


def leg(strike, mid, delta, iv=0.20, open_interest=500):
    return {
        "strike": float(strike),
        "mid": float(mid),
        "bid": max(0.01, float(mid) - 0.05),
        "ask": float(mid) + 0.05,
        "delta": float(delta),
        "iv": float(iv),
        "open_interest": open_interest,
        "volume": 100,
        "quote_source": "live_bid_ask",
    }


class RiskBudgetedConstruction(unittest.TestCase):
    def build(self, lower_long_strike=745, lower_long_mid=2.41, max_risk=200):
        return scanner._build_risk_candidate(
            leg(773, 20.00, -0.50),
            leg(772, 18.50, -0.48),
            leg(748, 4.00, -0.15),
            leg(lower_long_strike, lower_long_mid, -0.11),
            spot=775.76,
            expiration="2026-09-18",
            dte=41,
            placement_mode="slightly_otm",
            target_otm_pct=0.5,
            max_risk_dollars=max_risk,
            target_upper_credit_dollars=10,
            max_upper_credit_dollars=25,
        )

    def test_matches_the_requested_one_point_debit_and_risk_geometry(self):
        candidate = self.build()

        self.assertIsNotNone(candidate)
        self.assertAlmostEqual(candidate["debit_width"], 1.0)
        self.assertAlmostEqual(candidate["credit_width"], 3.0)
        self.assertAlmostEqual(candidate["entry_credit_dollars"], 9.0)
        self.assertAlmostEqual(candidate["upper_flat_dollars"], 9.0)
        self.assertAlmostEqual(candidate["max_profit_dollars"], 109.0)
        self.assertAlmostEqual(candidate["max_loss_dollars"], 191.0)
        self.assertLessEqual(candidate["max_loss_dollars"], 200.0)
        self.assertAlmostEqual(candidate["risk_utilization_pct"], 95.5)
        self.assertAlmostEqual(candidate["target_credit_short_delta"], 0.15)
        self.assertAlmostEqual(candidate["actual_credit_short_delta"], 0.15)
        self.assertAlmostEqual(candidate["credit_short_delta_error"], 0.0)

    def test_rejects_a_credit_wing_that_exceeds_the_risk_ceiling(self):
        # Four points wide with only a small net credit creates roughly $291 of
        # lower-tail risk and cannot be shown for a $200 user limit.
        self.assertIsNone(self.build(
            lower_long_strike=744,
            lower_long_mid=2.41,
            max_risk=200,
        ))

    def test_rejects_an_upper_expiration_debit(self):
        candidate = scanner._build_risk_candidate(
            leg(773, 20.00, -0.50),
            leg(772, 18.50, -0.48),
            leg(748, 3.00, -0.15),
            leg(745, 1.60, -0.11),
            spot=775.76,
            expiration="2026-09-18",
            dte=41,
            placement_mode="atm",
            target_otm_pct=0,
            max_risk_dollars=500,
            target_upper_credit_dollars=10,
            max_upper_credit_dollars=25,
        )

        self.assertIsNone(candidate)

    def test_rejects_a_debit_vertical_that_is_not_one_point_wide(self):
        candidate = scanner._build_risk_candidate(
            leg(773, 20.00, -0.50),
            leg(771, 17.50, -0.46),
            leg(748, 4.00, -0.15),
            leg(745, 1.40, -0.11),
            spot=775.76,
            expiration="2026-09-18",
            dte=41,
            placement_mode="atm",
            target_otm_pct=0,
            max_risk_dollars=500,
            target_upper_credit_dollars=10,
            max_upper_credit_dollars=25,
        )

        self.assertIsNone(candidate)

    def test_quality_prefers_using_the_risk_budget(self):
        near_limit = self.build()
        underused = dict(near_limit)
        underused["max_loss_dollars"] = 100.0

        self.assertLess(
            scanner._candidate_quality(near_limit),
            scanner._candidate_quality(underused),
        )

    def test_quality_places_the_credit_short_at_the_selected_delta_first(self):
        on_target = self.build()
        off_target = dict(on_target)
        off_target["credit_short_delta_error"] = 0.03
        # Even an otherwise identical payoff must lose to the candidate whose
        # short put honors the user's delta placement.
        self.assertLess(
            scanner._candidate_quality(on_target),
            scanner._candidate_quality(off_target),
        )


class Placement(unittest.TestCase):
    def test_atm_ignores_the_custom_otm_distance(self):
        target, effective = scanner._placement_target(500, "atm", 2.0)
        self.assertEqual(target, 500)
        self.assertEqual(effective, 0)

    def test_slightly_otm_uses_the_selected_distance(self):
        target, effective = scanner._placement_target(500, "slightly_otm", 0.5)
        self.assertEqual(target, 497.5)
        self.assertEqual(effective, 0.5)

    def test_rejects_a_debit_pair_that_is_not_close_to_the_target(self):
        candidate = scanner._build_risk_candidate(
            leg(470, 8.00, -0.25),
            leg(469, 7.20, -0.24),
            leg(450, 3.00, -0.15),
            leg(447, 2.10, -0.12),
            spot=500,
            expiration="2026-09-18",
            dte=41,
            placement_mode="slightly_otm",
            target_otm_pct=0.5,
            max_risk_dollars=500,
            target_upper_credit_dollars=10,
            max_upper_credit_dollars=25,
        )

        self.assertIsNone(candidate)


if __name__ == "__main__":
    unittest.main()
