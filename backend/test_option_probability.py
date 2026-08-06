"""Tests for the shared option-scanner probability schedules."""

from __future__ import annotations

import math
import os
import sys
import unittest
from statistics import NormalDist

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from option_probability import profit_probability_schedule


class ProfitProbabilityScheduleTests(unittest.TestCase):
    def test_short_put_has_planned_exit_and_complementary_expiration_odds(self):
        schedule = profit_probability_schedule(
            spot=100,
            dte=30,
            expiration="2026-08-29",
            distribution_iv=0.20,
            entry_cashflow=2.0,
            legs=[{
                "option_type": "put",
                "strike": 95,
                "iv": 0.20,
                "quantity": -1,
            }],
            exit_points=[{
                "kind": "reassess",
                "label": "Reassess / exit",
                "remaining_dte": 15,
            }],
        )

        self.assertEqual([point["kind"] for point in schedule], ["reassess", "expiration"])
        self.assertEqual(schedule[0]["exit_date"], "2026-08-14")
        self.assertEqual(schedule[1]["exit_date"], "2026-08-29")
        for point in schedule:
            self.assertAlmostEqual(
                point["probability_success_pct"] + point["probability_failure_pct"],
                100.0,
                places=7,
            )

        # At expiration a short 95 put sold for 2 is profitable above 93.
        years = 30 / 365.0
        d2 = (
            math.log(100 / 93)
            - 0.5 * 0.20 * 0.20 * years
        ) / (0.20 * math.sqrt(years))
        expected_success = NormalDist().cdf(d2) * 100.0
        self.assertAlmostEqual(
            schedule[-1]["probability_success_pct"],
            expected_success,
            delta=0.15,
        )

    def test_credit_spread_schedule_includes_reassess_close_by_and_expiration(self):
        schedule = profit_probability_schedule(
            spot=100,
            dte=45,
            expiration="2026-09-13",
            distribution_iv=0.24,
            entry_cashflow=1.20,
            legs=[
                {"option_type": "put", "strike": 95, "iv": 0.25, "quantity": -1},
                {"option_type": "put", "strike": 90, "iv": 0.27, "quantity": 1},
            ],
            exit_points=[
                {"kind": "reassess", "label": "Reassess", "remaining_dte": 21},
                {
                    "kind": "ex_dividend",
                    "label": "Exit before ex-dividend",
                    "exit_date": "2026-09-01",
                },
                {"kind": "close_by", "label": "Close by", "remaining_dte": 3},
            ],
        )

        self.assertEqual(
            [point["remaining_dte"] for point in schedule],
            [21, 12, 3, 0],
        )
        self.assertEqual(schedule[1]["exit_date"], "2026-09-01")
        self.assertTrue(all(
            0 <= point["probability_success_pct"] <= 100
            for point in schedule
        ))
        self.assertTrue(all(
            point["probability_failure_pct"]
            == round(100.0 - point["probability_success_pct"], 1)
            for point in schedule
        ))

    def test_covered_call_probability_includes_the_share_position(self):
        schedule = profit_probability_schedule(
            spot=100,
            dte=30,
            expiration="2026-08-29",
            distribution_iv=0.20,
            entry_cashflow=2.0,
            legs=[{
                "option_type": "call",
                "strike": 105,
                "iv": 0.20,
                "quantity": -1,
            }],
            underlying_quantity=1,
        )

        terminal = schedule[-1]
        profitable_range = terminal["profitable_ranges"][0]
        self.assertAlmostEqual(profitable_range["lower"], 98.0, places=2)
        self.assertIsNone(profitable_range["upper"])
        self.assertAlmostEqual(
            terminal["probability_success_pct"]
            + terminal["probability_failure_pct"],
            100.0,
            places=7,
        )

    def test_managed_upper_region_keeps_unadjusted_probability_visible(self):
        schedule = profit_probability_schedule(
            spot=100,
            dte=60,
            expiration="2026-09-28",
            distribution_iv=0.20,
            entry_cashflow=-0.25,
            legs=[
                {"option_type": "put", "strike": 98, "iv": 0.18, "quantity": 1},
                {"option_type": "put", "strike": 94, "iv": 0.20, "quantity": -2},
                {"option_type": "put", "strike": 89, "iv": 0.23, "quantity": 1},
            ],
            exit_points=[{
                "kind": "planned_exit",
                "label": "Two-thirds close",
                "remaining_dte": 20,
            }],
            always_success_above=98,
            include_breakeven=True,
        )

        for point in schedule:
            self.assertGreaterEqual(
                point["probability_success_pct"],
                point["probability_unadjusted_success_pct"],
            )
            self.assertAlmostEqual(
                point["probability_success_pct"],
                point["probability_unadjusted_success_pct"]
                + point["probability_managed_upside_pct"],
                delta=0.2,
            )

    def test_missing_iv_suppresses_schedule(self):
        self.assertEqual(
            profit_probability_schedule(
                spot=100,
                dte=30,
                expiration="2026-08-29",
                distribution_iv=None,
                entry_cashflow=2,
                legs=[{
                    "option_type": "put",
                    "strike": 95,
                    "iv": 0.20,
                    "quantity": -1,
                }],
            ),
            [],
        )


if __name__ == "__main__":
    unittest.main()
