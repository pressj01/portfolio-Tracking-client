import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from accumulation_sim import normalize_strategy, run_accumulation_comparison


def assumption(ticker, *, total_return=0.0, yield_rate=0.0, scenario_type="other"):
    return {
        "ticker": ticker,
        "description": ticker,
        "scenario_type": scenario_type,
        "scenario_label": scenario_type,
        "current_price": 100.0,
        "current_yield": yield_rate,
        "expected_total_return": total_return,
        "annual_volatility": 0.0,
        "beta": 0.0,
        "neutral_distribution_growth": 0.0,
        "sustainable_yield_cap": 0.45 if scenario_type == "high_distribution_option" else 0.18,
        "history_years": 10.0,
        "source": "test",
    }


class AccumulationSimulationTest(unittest.TestCase):
    def base_payload(self):
        return {
            "years": 1,
            "starting_capital": 12000,
            "monthly_contribution": 100,
            "inflation_rate": 0,
            "freedom_monthly_target": 0,
            "spending_rate": 4,
            "paths": 100,
            "seed": 123,
            "strategies": [
                {
                    "name": "A",
                    "style": "income",
                    "holdings": [{"ticker": "AAA", "weight": 100}],
                },
                {
                    "name": "B",
                    "style": "growth",
                    "holdings": [{"ticker": "BBB", "weight": 100}],
                },
            ],
        }

    def test_strategy_supports_more_than_eighty_tickers(self):
        strategy = normalize_strategy({
            "name": "Large aggregate",
            "style": "custom",
            "holdings": [
                {"ticker": f"T{i:03d}", "weight": 1}
                for i in range(108)
            ],
        })
        self.assertEqual(len(strategy["holdings"]), 108)
        self.assertAlmostEqual(
            sum(row["weight"] for row in strategy["holdings"]),
            1.0,
        )

    def test_strategy_rejects_more_than_two_hundred_fifty_tickers(self):
        with self.assertRaisesRegex(ValueError, "maximum of 250 tickers"):
            normalize_strategy({
                "name": "Too large",
                "style": "custom",
                "holdings": [
                    {"ticker": f"T{i:03d}", "weight": 1}
                    for i in range(251)
                ],
            })

    def test_oversized_ticker_path_workload_is_rejected_before_simulation(self):
        holdings = [
            {"ticker": f"T{i:03d}", "weight": 1}
            for i in range(250)
        ]
        payload = self.base_payload()
        payload.update({
            "years": 25,
            "paths": 1000,
            "strategies": [
                {"name": "Large A", "style": "custom", "holdings": holdings},
                {"name": "Large B", "style": "custom", "holdings": holdings},
            ],
        })
        with self.assertRaisesRegex(ValueError, "ticker-path-months"):
            run_accumulation_comparison(payload, assumptions_override={})

    def test_zero_return_reconciles_starting_capital_and_contributions(self):
        payload = self.base_payload()
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA"),
                "BBB": assumption("BBB"),
            },
        )
        neutral = result["scenarios"]["neutral"]["strategies"]
        for strategy in neutral:
            self.assertAlmostEqual(strategy["summary"]["final_value"]["p50"], 13200, delta=1)
            self.assertEqual(strategy["summary"]["total_contributions"], 1200)

    def test_identical_portfolios_receive_identical_market_paths(self):
        payload = self.base_payload()
        payload["strategies"][1]["holdings"] = [{"ticker": "AAA", "weight": 100}]
        result = run_accumulation_comparison(
            payload,
            assumptions_override={"AAA": assumption("AAA", total_return=0.08, yield_rate=0.03)},
        )
        for scenario in ("bullish", "neutral", "bearish"):
            a, b = result["scenarios"][scenario]["strategies"]
            self.assertEqual(a["summary"]["final_value"], b["summary"]["final_value"])
            self.assertEqual(a["summary"]["final_annual_income"], b["summary"]["final_annual_income"])

    def test_non_dividend_growth_holding_receives_monthly_contributions(self):
        payload = self.base_payload()
        payload["monthly_contribution"] = 500
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", yield_rate=0.05),
                "BBB": assumption("BBB", yield_rate=0.0, scenario_type="non_income_equity"),
            },
        )
        growth = result["scenarios"]["neutral"]["strategies"][1]
        self.assertAlmostEqual(growth["summary"]["final_value"]["p50"], 18000, delta=2)
        self.assertEqual(growth["summary"]["final_annual_income"]["p50"], 0)

    def test_distributions_are_reinvested_without_being_double_counted(self):
        payload = self.base_payload()
        payload["monthly_contribution"] = 0
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.06, yield_rate=0.06),
                "BBB": assumption("BBB", total_return=0.06, yield_rate=0.0),
            },
        )
        income, growth = result["scenarios"]["neutral"]["strategies"]
        # Equal total-return assumptions should finish together even though one
        # security delivers its return as distributions.
        self.assertAlmostEqual(
            income["summary"]["final_value"]["p50"],
            growth["summary"]["final_value"]["p50"],
            delta=5,
        )
        self.assertGreater(
            income["summary"]["cumulative_distributions_reinvested"]["p50"],
            0,
        )
        self.assertEqual(
            growth["summary"]["cumulative_distributions_reinvested"]["p50"],
            0,
        )

    def test_growth_strategy_reinvests_income_when_its_holding_pays(self):
        payload = self.base_payload()
        payload["monthly_contribution"] = 0
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.06, yield_rate=0.02),
                "BBB": assumption("BBB", total_return=0.08, yield_rate=0.03),
            },
        )
        growth = result["scenarios"]["neutral"]["strategies"][1]
        self.assertEqual(growth["style"], "growth")
        self.assertGreater(growth["summary"]["final_annual_income"]["p50"], 0)
        self.assertGreater(
            growth["summary"]["cumulative_distributions_reinvested"]["p50"],
            0,
        )

    def test_accepts_twenty_five_year_horizon_and_reports_target_probability(self):
        payload = self.base_payload()
        payload.update({
            "years": 25,
            "monthly_contribution": 250,
            "freedom_monthly_target": 100,
            "paths": 100,
        })
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.07, yield_rate=0.04),
                "BBB": assumption("BBB", total_return=0.08, yield_rate=0.01),
            },
        )
        neutral = result["scenarios"]["neutral"]["strategies"][0]
        self.assertEqual(len(neutral["yearly_series"]), 26)
        self.assertIsNotNone(neutral["summary"]["income_target_probability"])
        self.assertGreaterEqual(neutral["summary"]["income_target_probability"], 0)
        self.assertLessEqual(neutral["summary"]["income_target_probability"], 100)
        self.assertGreaterEqual(
            neutral["summary"]["freedom_target_probability"],
            neutral["summary"]["income_target_probability"],
        )
        self.assertGreaterEqual(
            neutral["summary"]["freedom_target_probability"],
            neutral["summary"]["spending_target_probability"],
        )
        self.assertLessEqual(neutral["summary"]["freedom_target_probability"], 100)

    def test_percentiles_are_ordered(self):
        payload = self.base_payload()
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.08),
                "BBB": assumption("BBB", total_return=0.08),
            },
        )
        final_value = result["scenarios"]["neutral"]["strategies"][0]["summary"]["final_value"]
        self.assertLessEqual(final_value["p10"], final_value["p50"])
        self.assertLessEqual(final_value["p50"], final_value["p90"])

    def test_extreme_yield_mean_reverts_without_numeric_explosion(self):
        payload = self.base_payload()
        payload["years"] = 25
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption(
                    "AAA",
                    total_return=0.065,
                    yield_rate=0.60,
                    scenario_type="high_distribution_option",
                ),
                "BBB": assumption(
                    "BBB",
                    total_return=0.065,
                    yield_rate=0.60,
                    scenario_type="high_distribution_option",
                ),
            },
        )
        for scenario in ("bullish", "neutral", "bearish"):
            summary = result["scenarios"][scenario]["strategies"][0]["summary"]
            self.assertGreater(summary["final_value"]["p50"], 0)
            self.assertLess(summary["final_value"]["p90"], 1e10)

    def test_large_contributions_do_not_hide_bear_market_drawdown(self):
        payload = self.base_payload()
        payload["starting_capital"] = 1000
        payload["monthly_contribution"] = 10000
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption(
                    "AAA",
                    total_return=0.08,
                    scenario_type="non_income_equity",
                ),
                "BBB": assumption(
                    "BBB",
                    total_return=0.08,
                    scenario_type="non_income_equity",
                ),
            },
        )
        drawdown = (
            result["scenarios"]["bearish"]["strategies"][0]["summary"]
            ["max_drawdown_pct"]["p50"]
        )
        self.assertLess(drawdown, -10)


if __name__ == "__main__":
    unittest.main()
