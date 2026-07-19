import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from app import _nav_erosion_numerator, _nav_monthly_frame


class NavErosionBacktesterTest(unittest.TestCase):
    def test_monthly_frame_aligns_new_york_fund_with_utc_crypto(self):
        fund_index = pd.DatetimeIndex(
            ["2026-01-30", "2026-02-27"], tz="America/New_York"
        )
        crypto_index = pd.DatetimeIndex(
            ["2026-01-30", "2026-02-27"], tz="UTC"
        )
        close = pd.Series([100.0, 90.0], index=fund_index)
        divs = pd.Series([1.0, 2.0], index=fund_index)
        benchmark = pd.Series([1000.0, 1100.0], index=crypto_index)

        frame = _nav_monthly_frame(close, divs, benchmark)

        self.assertEqual(len(frame), 2)
        self.assertEqual(frame["benchmark_price"].tolist(), [1000.0, 1100.0])
        self.assertEqual(frame["div"].tolist(), [1.0, 2.0])

    def test_confirmed_erosion_requires_fund_down_and_benchmark_flat_or_up(self):
        self.assertAlmostEqual(_nav_erosion_numerator(-0.10, 0.00), 0.10)
        self.assertAlmostEqual(_nav_erosion_numerator(-0.10, 0.20), 0.10)
        self.assertEqual(_nav_erosion_numerator(-0.10, -0.001), 0.0)
        self.assertEqual(_nav_erosion_numerator(0.10, 0.20), 0.0)

    def test_route_uses_real_benchmark_and_separates_cash_from_share_value(self):
        fund_index = pd.DatetimeIndex(
            ["2026-01-02", "2026-01-30", "2026-02-27", "2026-03-31"],
            tz="America/New_York",
        )
        crypto_index = pd.DatetimeIndex(
            ["2026-01-02", "2026-01-30", "2026-02-27", "2026-03-31"],
            tz="UTC",
        )
        fund_history = pd.DataFrame(
            {
                "Close": [100.0, 100.0, 90.0, 80.0],
                "Dividends": [0.0, 1.0, 2.0, 2.0],
            },
            index=fund_index,
        )
        benchmark_history = pd.DataFrame(
            {"Close": [1000.0, 1000.0, 1100.0, 1000.0]},
            index=crypto_index,
        )

        class FakeTicker:
            def __init__(self, symbol):
                self.symbol = symbol

            def history(self, **_kwargs):
                if self.symbol == "FUND":
                    return fund_history.copy()
                if self.symbol == "BTC-USD":
                    return benchmark_history.copy()
                return pd.DataFrame()

        with patch("yfinance.Ticker", FakeTicker):
            with app_module.app.test_client() as client:
                response = client.get(
                    "/api/nav-erosion/data",
                    query_string={
                        "ticker": "FUND",
                        "benchmark": "BTC-USD",
                        "amount": 10000,
                        "start": "2026-01-02",
                        "end": "2026-03-31",
                        "reinvest": 0,
                    },
                )

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIsNone(data["error"])
        summary = data["summary"]
        self.assertEqual(summary["benchmark"], "BTC-USD")
        self.assertTrue(summary["benchmark_valid"])
        self.assertEqual(summary["confirmed_erosion_months"], 1)
        self.assertTrue(summary["has_erosion"])
        self.assertTrue(summary["has_price_deficit"])
        self.assertAlmostEqual(summary["total_coverage"], 2.0, places=4)
        self.assertAlmostEqual(summary["final_value"], 8000.0, places=2)
        self.assertAlmostEqual(summary["cash_taken"], 500.0, places=2)
        self.assertAlmostEqual(summary["ending_wealth"], 8500.0, places=2)
        self.assertAlmostEqual(summary["total_return_pct"], -15.0, places=2)
        self.assertGreater(len({row["benchmark_price"] for row in data["rows"]}), 1)
        february = next(row for row in data["rows"] if row["date"] == "Feb 2026")
        self.assertAlmostEqual(february["coverage_ratio"], 5.0, places=4)
        march = next(row for row in data["rows"] if row["date"] == "Mar 2026")
        self.assertEqual(march["coverage_ratio"], 0.0)

    def test_portfolio_route_uses_mapped_benchmark_and_strict_erosion(self):
        index = pd.DatetimeIndex(
            ["2026-01-02", "2026-01-30", "2026-02-27", "2026-03-31"],
            tz="UTC",
        )
        columns = pd.MultiIndex.from_product(
            [["BTCI", "BTC-USD"], ["Close", "Dividends"]]
        )
        raw = pd.DataFrame(
            [
                [100.0, 0.0, 1000.0, 0.0],
                [100.0, 1.0, 1000.0, 0.0],
                [90.0, 2.0, 1100.0, 0.0],
                [80.0, 2.0, 1000.0, 0.0],
            ],
            index=index,
            columns=columns,
        )

        with patch.object(app_module, "_chunked_yf_download", return_value=raw):
            with app_module.app.test_client() as client:
                response = client.post(
                    "/api/nav-erosion-portfolio/data",
                    json={
                        "start": "2026-01-02",
                        "end": "2026-03-31",
                        "rows": [
                            {"ticker": "BTCI", "amount": 10000, "reinvest_pct": 0}
                        ],
                    },
                )

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertNotIn("error", data)
        row = data["results"][0]
        self.assertEqual(row["benchmark"], "BTC-USD")
        self.assertTrue(row["has_erosion"])
        self.assertEqual(row["confirmed_erosion_months"], 1)
        self.assertAlmostEqual(row["coverage_ratio"], 2.0, places=4)
        self.assertAlmostEqual(row["final_value"], 8000.0, places=2)
        self.assertAlmostEqual(row["cash_taken"], 500.0, places=2)
        self.assertAlmostEqual(row["ending_wealth"], 8500.0, places=2)
        self.assertAlmostEqual(row["total_return_pct"], -15.0, places=2)

        # A non-distributing penny-stock-style holding has no cash leg, so its
        # investor total return must equal its price return exactly.
        zero_dist = raw.copy()
        zero_dist.loc[:, ("BTCI", "Dividends")] = 0.0
        with patch.object(app_module, "_chunked_yf_download", return_value=zero_dist):
            with app_module.app.test_client() as client:
                response = client.post(
                    "/api/nav-erosion-portfolio/data",
                    json={
                        "start": "2026-01-02",
                        "end": "2026-03-31",
                        "rows": [
                            {"ticker": "BTCI", "amount": 10000, "reinvest_pct": 0}
                        ],
                    },
                )
        no_div_row = response.get_json()["results"][0]
        self.assertAlmostEqual(
            no_div_row["total_return_pct"], no_div_row["price_delta_pct"], places=2
        )


if __name__ == "__main__":
    unittest.main()
