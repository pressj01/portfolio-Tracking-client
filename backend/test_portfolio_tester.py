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


if __name__ == "__main__":
    unittest.main()
