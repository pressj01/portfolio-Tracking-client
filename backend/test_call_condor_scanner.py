"""Pure construction tests for the call side and combined condor package."""

import unittest
from unittest.mock import patch

import call_condor_scanner as call_scanner
import put_condor_scanner as condor_scanner


def leg(strike, mid, delta, iv=0.20):
    return {
        "strike": float(strike),
        "mid": float(mid),
        "bid": max(0.01, float(mid) - 0.05),
        "ask": float(mid) + 0.05,
        "delta": float(delta),
        "iv": float(iv),
        "open_interest": 500,
        "volume": 100,
        "quote_source": "live_bid_ask",
    }


class CallCondorConstruction(unittest.TestCase):
    def build(self, credit_long_strike=805, credit_long_mid=3.41, max_risk=200):
        return call_scanner._build_call_condor(
            leg(777, 20.00, 0.51),
            leg(778, 19.50, 0.49),
            leg(802, 4.00, 0.15),
            leg(credit_long_strike, credit_long_mid, 0.11),
            spot=775.76,
            expiration="2026-09-18",
            dte=41,
            placement_mode="slightly_otm",
            target_otm_pct=0.5,
            max_risk_dollars=max_risk,
            target_upper_credit_dollars=10,
            max_upper_credit_dollars=25,
            target_credit_short_delta=0.15,
        )

    def test_mirrors_the_put_condor_payoff_on_the_upside(self):
        candidate = self.build()

        self.assertIsNotNone(candidate)
        self.assertEqual(candidate["option_side"], "call")
        self.assertAlmostEqual(candidate["debit_width"], 1.0)
        self.assertAlmostEqual(candidate["credit_width"], 3.0)
        self.assertAlmostEqual(candidate["entry_credit_dollars"], 9.0)
        self.assertAlmostEqual(candidate["lower_flat_dollars"], 9.0)
        self.assertAlmostEqual(candidate["max_profit_dollars"], 109.0)
        self.assertAlmostEqual(candidate["upper_flat_dollars"], -191.0)
        self.assertAlmostEqual(candidate["max_loss_dollars"], 191.0)
        self.assertAlmostEqual(candidate["actual_credit_short_delta"], 0.15)

    def test_rejects_a_credit_wing_over_the_risk_limit(self):
        self.assertIsNone(self.build(
            credit_long_strike=806,
            credit_long_mid=3.41,
            max_risk=200,
        ))

    def test_upper_touch_probability_exceeds_finish_probability(self):
        touch = call_scanner._prob_touch_upper(775.76, 802, 41 / 365, 0.20)
        finish = call_scanner._prob_finish_above(775.76, 802, 41 / 365, 0.20)
        self.assertGreaterEqual(touch, finish)
        self.assertGreaterEqual(finish, 0.0)
        self.assertLessEqual(touch, 1.0)

    def test_exit_payoff_matches_all_three_expiration_regions(self):
        candidate = self.build()
        self.assertAlmostEqual(call_scanner._position_pl_at_exit(candidate, 770, 0), 0.09)
        self.assertAlmostEqual(call_scanner._position_pl_at_exit(candidate, 790, 0), 1.09)
        self.assertAlmostEqual(call_scanner._position_pl_at_exit(candidate, 810, 0), -1.91)


class CombinedPackage(unittest.TestCase):
    @staticmethod
    def result(side, near, far, maximum, loss):
        return {
            "rows": [{
                "ticker": "^XSP", "option_side": side,
                "expiration": "2026-09-18", "dte": 41,
                "near_flat_dollars": near,
                "far_flat_dollars": far,
                "max_profit_dollars": maximum,
                "max_loss_dollars": loss,
                "max_risk_limit_dollars": 200,
                "status": "actionable",
            }],
            "unavailable": [],
            "stats": {"expirations_checked": 1, "actionable": 1, "near_matches": 0},
            "params": {},
        }

    def test_both_mode_reports_true_eight_leg_expiration_risk(self):
        put_result = self.result("put", 9.5, -190, 109.5, 190)
        call_result = self.result("call", 8, -192, 108, 192)
        with (
            patch.object(condor_scanner, "run_put_condor_scan", return_value=put_result),
            patch.object(call_scanner, "run_call_condor_scan", return_value=call_result),
        ):
            result = condor_scanner.run_condor_scan({"option_side": "both"})

        combined = result["combined_packages"][0]
        self.assertAlmostEqual(combined["entry_credit_dollars"], 17.5)
        self.assertAlmostEqual(combined["downside_tail_dollars"], -182)
        self.assertAlmostEqual(combined["upside_tail_dollars"], -182.5)
        self.assertAlmostEqual(combined["max_profit_dollars"], 117.5)
        self.assertAlmostEqual(combined["max_loss_dollars"], 182.5)
        self.assertAlmostEqual(combined["gross_individual_max_loss_dollars"], 382)
        self.assertEqual(len(combined["legs"]), 8)
        self.assertEqual(
            [leg["option_type"] for leg in combined["legs"]],
            ["put"] * 4 + ["call"] * 4,
        )
        self.assertEqual(
            [leg["qty"] for leg in combined["legs"]],
            [1, -1, -1, 1, 1, -1, -1, 1],
        )


if __name__ == "__main__":
    unittest.main()
