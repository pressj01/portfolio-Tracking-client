import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class DistributionCompareAttributionTest(unittest.TestCase):
    def _run_basket(
            self, legs, price_data, *, name="Portfolio", cache=None,
            monthly_withdrawal=0, cash_wedge=0, is_growth=False, drip=True,
            duration_months=2):
        def fake_price_path(symbol, months, market):
            prices, ttm_yield = price_data[symbol]
            self.assertEqual(len(prices), months + 1)
            return prices, prices[0], ttm_yield, None

        with patch.object(
                app_module, "_dc_simulate_price_path", side_effect=fake_price_path):
            return app_module._dc_simulate_basket(
                legs,
                duration_months=duration_months,
                market_type="neutral",
                monthly_withdrawal=monthly_withdrawal,
                withdrawal_strategy="fixed",
                withdrawal_pct=4,
                inflation_rate=None,
                dynamic_reduce_pct=25,
                dynamic_threshold_pct=80,
                cash_wedge_initial=cash_wedge,
                is_growth=is_growth,
                drip=drip,
                name=name,
                price_path_cache=cache,
            )

    def test_ticker_attribution_reconciles_to_basket_total(self):
        result = self._run_basket(
            [{"ticker": "UP", "amount": 1000}, {"ticker": "DOWN", "amount": 1000}],
            {
                "UP": ([100, 110, 120], 0),
                "DOWN": ([100, 90, 80], 0),
            },
        )

        rows = {row["ticker"]: row for row in result["ticker_attribution"]}
        self.assertEqual(rows["UP"]["pnl"], 200)
        self.assertEqual(rows["UP"]["return_pct"], 20)
        self.assertEqual(rows["DOWN"]["pnl"], -200)
        self.assertEqual(rows["DOWN"]["return_pct"], -20)
        self.assertEqual(result["final_total"], 2000)
        self.assertAlmostEqual(
            result["attribution_reconciliation"]["difference"], 0, places=2)

    def test_distributions_withdrawals_and_cash_remain_flow_aware(self):
        result = self._run_basket(
            [{"ticker": "HIGH", "amount": 1000}, {"ticker": "LOW", "amount": 1000}],
            {
                "HIGH": ([100, 100, 100], 0.12),
                "LOW": ([100, 100, 100], 0.06),
            },
            monthly_withdrawal=10,
            drip=False,
        )

        rows = {row["ticker"]: row for row in result["ticker_attribution"]}
        self.assertGreater(rows["HIGH"]["distributions_generated"], rows["LOW"]["distributions_generated"])
        self.assertGreater(rows["HIGH"]["withdrawals_funded"], rows["LOW"]["withdrawals_funded"])
        self.assertGreater(rows["HIGH"]["cash_remaining"], rows["LOW"]["cash_remaining"])
        self.assertAlmostEqual(
            result["attribution_reconciliation"]["difference"], 0, places=2)

    def test_cash_wedge_is_separate_from_ticker_performance(self):
        result = self._run_basket(
            [{"ticker": "AAA", "amount": 1000}, {"ticker": "BBB", "amount": 1000}],
            {
                "AAA": ([100, 100, 100], 0),
                "BBB": ([100, 100, 100], 0),
            },
            monthly_withdrawal=50,
            cash_wedge=100,
            is_growth=True,
        )

        recon = result["attribution_reconciliation"]
        self.assertEqual(recon["cash_wedge_contribution"], 100)
        self.assertEqual(recon["cash_wedge_drawn"], 100)
        self.assertEqual(sum(row["pnl"] for row in result["ticker_attribution"]), 0)
        self.assertAlmostEqual(recon["difference"], 0, places=2)

    def test_shared_cache_reuses_overlapping_ticker_path(self):
        cache = {}
        calls = []

        def fake_price_path(symbol, months, market):
            calls.append(symbol)
            return [100, 105], 100, 0, None

        common = dict(
            duration_months=1,
            market_type="neutral",
            monthly_withdrawal=0,
            withdrawal_strategy="fixed",
            withdrawal_pct=4,
            inflation_rate=None,
            dynamic_reduce_pct=25,
            dynamic_threshold_pct=80,
            cash_wedge_initial=0,
            is_growth=False,
            drip=True,
            price_path_cache=cache,
        )
        with patch.object(
                app_module, "_dc_simulate_price_path", side_effect=fake_price_path):
            app_module._dc_simulate_basket(
                [{"ticker": "SAME", "amount": 1000}, {"ticker": "LEFT", "amount": 1000}],
                name="Left",
                **common,
            )
            app_module._dc_simulate_basket(
                [{"ticker": "SAME", "amount": 1000}, {"ticker": "RIGHT", "amount": 1000}],
                name="Right",
                **common,
            )

        self.assertEqual(calls.count("SAME"), 1)
        self.assertEqual(sorted(calls), ["LEFT", "RIGHT", "SAME"])

    def test_comparison_ranks_drivers_and_worst_performers(self):
        winner = self._run_basket(
            [{"ticker": "BEST", "amount": 1000}, {"ticker": "LAG", "amount": 1000}],
            {
                "BEST": ([100, 120, 130], 0),
                "LAG": ([100, 95, 90], 0),
            },
            name="Winner",
        )
        runner_up = self._run_basket(
            [{"ticker": "MID", "amount": 1000}, {"ticker": "WORST", "amount": 1000}],
            {
                "MID": ([100, 105, 110], 0),
                "WORST": ([100, 90, 80], 0),
            },
            name="Runner-up",
        )
        attribution = app_module._dc_build_comparison_attribution({
            "fund_a": winner,
            "fund_b": runner_up,
        })

        self.assertTrue(attribution["eligible"])
        self.assertEqual(attribution["winner_name"], "Winner")
        self.assertEqual(attribution["driver_rows"][0]["ticker"], "BEST")
        self.assertEqual(
            attribution["best_by_fund"]["fund_a"]["rows"][0]["ticker"], "BEST")
        self.assertEqual(
            attribution["best_by_fund"]["fund_b"]["rows"][0]["ticker"], "MID")
        self.assertEqual(
            attribution["worst_by_fund"]["fund_a"]["rows"][0]["ticker"], "LAG")
        self.assertEqual(
            attribution["worst_by_fund"]["fund_b"]["rows"][0]["ticker"], "WORST")
        explained = (
            attribution["ticker_effect_total"]
            + attribution["starting_capital_effect"]
            + attribution["other_effect"]
        )
        self.assertAlmostEqual(explained, attribution["lead_total"], places=2)

    def test_single_ticker_comparisons_are_not_eligible(self):
        one = self._run_basket(
            [{"ticker": "ONE", "amount": 1000}],
            {"ONE": ([100, 100, 100], 0)},
            name="One",
        )
        two = self._run_basket(
            [{"ticker": "TWO", "amount": 1000}],
            {"TWO": ([100, 100, 100], 0)},
            name="Two",
        )
        attribution = app_module._dc_build_comparison_attribution({
            "fund_a": one,
            "fund_b": two,
        })
        self.assertEqual(attribution, {"eligible": False})


if __name__ == "__main__":
    unittest.main()
