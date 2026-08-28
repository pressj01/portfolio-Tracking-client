import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import (
    _build_nav_coverage_payload,
    _nav_accounting_rates,
    _nav_aggregate_severity,
    _nav_compose_benchmark,
    _nav_overall_erosion_metrics,
    _nav_up_market_recovery,
)


class NavCoverageAggregationTest(unittest.TestCase):
    def test_overall_score_uses_strongest_raw_and_benchmark_warning(self):
        metrics = _nav_overall_erosion_metrics(0.7339, 0.7364, 0.4494, 103.57)

        self.assertAlmostEqual(metrics["raw_payout_gap_ratio"], 0.7339 / 0.7364)
        self.assertEqual(metrics["overall_nav_erosion_score"], 100.0)
        self.assertEqual(metrics["overall_nav_erosion_severity"], "High")

        preserved = _nav_overall_erosion_metrics(-0.10, 0.20, 0.50, 30.0)
        self.assertEqual(preserved["overall_nav_erosion_score"], 0.0)
        self.assertEqual(preserved["overall_nav_erosion_severity"], "Low")

    def test_price_recovery_reduces_raw_warning_but_not_confirmed_warning(self):
        recovered = _nav_overall_erosion_metrics(
            0.35, 0.08, 0.0, 0.0, up_market_recovery_score=100.0
        )
        self.assertEqual(recovered["pre_recovery_nav_erosion_score"], 100.0)
        self.assertEqual(recovered["up_market_recovery_credit_points"], 75.0)
        self.assertEqual(recovered["overall_nav_erosion_score"], 25.0)
        self.assertEqual(recovered["overall_nav_erosion_severity"], "Low")

        confirmed = _nav_overall_erosion_metrics(
            0.35, 0.08, 0.80, 0.0, up_market_recovery_score=100.0
        )
        self.assertEqual(confirmed["overall_nav_erosion_score"], 80.0)
        self.assertEqual(confirmed["overall_nav_erosion_severity"], "High")

    def test_up_market_recovery_uses_daily_price_capture(self):
        index = pd.date_range("2026-01-01", periods=25, freq="D")
        benchmark = pd.Series([100.0 * (1.01 ** i) for i in range(25)], index=index)
        fund = pd.Series([50.0 * (1.01 ** i) for i in range(25)], index=index)

        recovery = _nav_up_market_recovery(fund, benchmark)

        self.assertEqual(recovery["up_market_observations"], 24)
        self.assertAlmostEqual(recovery["up_market_capture_pct"], 100.0, places=1)
        self.assertEqual(recovery["up_market_positive_rate_pct"], 100.0)
        self.assertEqual(recovery["up_market_recovery_score"], 100.0)

    def test_composite_benchmark_starts_at_fund_overlap(self):
        index = pd.date_range("2026-01-01", periods=3, freq="D")
        histories = {
            "BTC-USD": pd.Series([100.0, 200.0, 220.0], index=index),
            "GLD": pd.Series([100.0, 100.0, 110.0], index=index),
        }
        fund = pd.Series([50.0, 55.0], index=index[1:])

        composite, reason = _nav_compose_benchmark(
            "BTC-USD+GLD", histories.get, anchor_series=fund
        )

        self.assertIsNone(reason)
        self.assertEqual(composite.index.tolist(), index[1:].tolist())
        self.assertAlmostEqual(float(composite.iloc[0]), 1.0)
        self.assertAlmostEqual(float(composite.iloc[-1]), 1.2)

    def test_raw_accounting_identity_uses_one_starting_nav_basis(self):
        rates = _nav_accounting_rates(100.0, 90.0, 5.0)

        self.assertAlmostEqual(rates["raw_nav_erosion_rate"], 0.10)
        self.assertAlmostEqual(rates["distribution_rate_on_starting_nav"], 0.05)
        self.assertAlmostEqual(rates["accounting_total_return_rate"], -0.05)
        self.assertAlmostEqual(
            rates["raw_nav_erosion_rate"],
            rates["distribution_rate_on_starting_nav"]
            - rates["accounting_total_return_rate"],
        )

    def test_coverage_payload_keeps_raw_identity_separate_from_benchmark_gate(self):
        index = pd.DatetimeIndex(["2025-08-27", "2026-08-27"], tz="UTC")
        fund_history = pd.DataFrame(
            {"Close": [100.0, 90.0], "Dividends": [0.0, 5.0]},
            index=index,
        )
        benchmark_history = pd.DataFrame({"Close": [100.0, 80.0]}, index=index)
        distributions = pd.Series([5.0], index=index[-1:])

        class FakeTicker:
            def __init__(self, symbol):
                self.symbol = symbol

            @property
            def dividends(self):
                return distributions if self.symbol == "FUND" else pd.Series(dtype=float)

            def history(self, **_kwargs):
                return fund_history.copy() if self.symbol == "FUND" else benchmark_history.copy()

        info = {
            "FUND": {
                "current_price": 90.0,
                "quantity": 2.0,
                "description": "Test income fund",
                "classification_type": "ETF",
                "annual_income": 10.0,
                "current_value": 180.0,
                "nav_erosion_scope": "test",
                "nav_benchmark_override": "SPY",
            }
        }
        with patch("yfinance.Ticker", FakeTicker):
            payload = _build_nav_coverage_payload(info, use_cache=False)

        row = payload["results"][0]
        self.assertEqual(row["coverage_ratio"], 0.0)
        self.assertAlmostEqual(row["raw_nav_erosion_rate"], 0.10)
        self.assertAlmostEqual(row["distribution_rate_on_starting_nav"], 0.05)
        self.assertAlmostEqual(row["accounting_total_return_rate"], -0.05)
        self.assertAlmostEqual(payload["aggregate_raw_nav_erosion_rate"], 0.10)
        self.assertAlmostEqual(
            payload["aggregate_raw_nav_erosion_rate"],
            payload["aggregate_distribution_rate_on_starting_nav"]
            - payload["aggregate_accounting_total_return_rate"],
        )

    def test_aggregate_severity_uses_portfolio_ratio_not_worst_holding(self):
        results = [
            {"ticker": "SMALL", "nav_erosion_severity": "High"},
            {"ticker": "CORE", "nav_erosion_severity": "Low"},
        ]

        self.assertEqual(_nav_aggregate_severity(0.1118, results), "Low")

    def test_aggregate_severity_thresholds_follow_weighted_ratio(self):
        self.assertEqual(_nav_aggregate_severity(0.25), "Low")
        self.assertEqual(_nav_aggregate_severity(0.5), "Medium")
        self.assertEqual(_nav_aggregate_severity(0.7501), "High")


if __name__ == "__main__":
    unittest.main()
