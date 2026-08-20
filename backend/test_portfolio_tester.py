"""Unit tests for portfolio price-download reliability."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import portfolio_tester


class FetchPricesRecoveryTest(unittest.TestCase):
    def setUp(self):
        portfolio_tester._PRICE_CACHE.clear()

    def tearDown(self):
        portfolio_tester._PRICE_CACHE.clear()

    def test_retries_symbol_omitted_from_batch_before_caching(self):
        dates = pd.date_range("2024-10-01", periods=3, freq="D")
        batch = pd.DataFrame(
            [
                [20.0, 0.0],
                [20.5, 0.2],
                [21.0, 0.0],
            ],
            index=dates,
            columns=pd.MultiIndex.from_product(
                [["GOOP"], ["Close", "Dividends"]]
            ),
        )
        hybi_retry = pd.DataFrame(
            [
                [49.5, 0.0],
                [49.75, 0.15],
                [50.0, 0.0],
            ],
            index=dates,
            columns=pd.MultiIndex.from_product(
                [["Close", "Dividends"], ["HYBI"]]
            ),
        )

        with patch.object(
                portfolio_tester.yf, "download",
                side_effect=[batch, hybi_retry]) as download:
            close, divs = portfolio_tester.fetch_prices(
                ["HYBI", "GOOP"], "2024-07-26", "2026-07-26"
            )

        self.assertEqual(download.call_count, 2)
        self.assertEqual(download.call_args_list[0].args[0], "HYBI GOOP")
        self.assertEqual(download.call_args_list[1].args[0], "HYBI")
        self.assertEqual(download.call_args_list[0].kwargs["end"], "2026-07-27")
        self.assertEqual(download.call_args_list[1].kwargs["end"], "2026-07-27")
        self.assertEqual(close.columns.tolist(), ["HYBI", "GOOP"])
        self.assertEqual(close["HYBI"].tolist(), [49.5, 49.75, 50.0])
        self.assertEqual(divs["HYBI"].tolist(), [0.0, 0.15, 0.0])

        with patch.object(portfolio_tester.yf, "download") as cached_download:
            cached_close, cached_divs = portfolio_tester.fetch_prices(
                ["HYBI", "GOOP"], "2024-07-26", "2026-07-26"
            )

        cached_download.assert_not_called()
        pd.testing.assert_frame_equal(cached_close, close)
        pd.testing.assert_frame_equal(cached_divs, divs)


class ActualTransactionHistoryTest(unittest.TestCase):
    @staticmethod
    def _history():
        dates = pd.bdate_range("2024-01-02", "2024-12-31")
        values = [100.0 + (25.0 * i / (len(dates) - 1)) for i in range(len(dates))]
        return {
            "dates": [date.strftime("%Y-%m-%d") for date in dates],
            "values": values,
            "actual_start_date": "2024-01-02",
            "actual_end_date": "2024-12-31",
            "metrics": {"total_return_pct": 25.0},
        }

    def test_actual_tracker_index_scales_to_the_common_initial_investment(self):
        sim = portfolio_tester.simulate_actual_history(self._history(), 20000)

        self.assertAlmostEqual(float(sim["value"].iloc[0]), 20000.0)
        self.assertAlmostEqual(float(sim["value"].iloc[-1]), 25000.0)
        self.assertEqual(float(sim["income"].sum()), 0.0)
        self.assertEqual(float(sim["withdrawn"].sum()), 0.0)

    def test_actual_history_runs_without_a_hypothetical_price_download(self):
        portfolio = {
            "name": "My Actual Account",
            "source": "actual",
            "history": self._history(),
        }
        with patch.object(portfolio_tester, "fetch_prices") as fetch_prices:
            result = portfolio_tester.run_backtest(
                portfolios=[portfolio],
                benchmark=None,
                start="2024-01-01",
                end="2025-01-01",
                initial=20000,
                include_div=True,
                reinvest_div=True,
                rebalance="none",
            )

        fetch_prices.assert_not_called()
        self.assertTrue(result["valid"])
        self.assertEqual(result["portfolios"][0]["source"], "actual")
        self.assertAlmostEqual(result["portfolios"][0]["metrics"]["total_return"], 0.25)
        self.assertAlmostEqual(result["portfolios"][0]["metrics"]["final_value"], 25000.0)
        self.assertEqual(result["portfolios"][0]["actual_start_date"], "2024-01-02")

    def test_actual_history_rejects_income_or_price_only_modes(self):
        portfolio = {
            "name": "My Actual Account",
            "source": "actual",
            "history": self._history(),
        }
        with self.assertRaisesRegex(ValueError, "available in Growth mode"):
            portfolio_tester.run_backtest(
                portfolios=[portfolio],
                benchmark=None,
                start="2024-01-01",
                end="2025-01-01",
                initial=10000,
                include_div=False,
                reinvest_div=False,
                rebalance="none",
            )


if __name__ == "__main__":
    unittest.main()
