import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


def _cef_row(ticker="ADX"):
    return {
        "ticker": ticker,
        "name": "Adams Diversified Equity Fund",
        "category": "US CEF Equity",
        "strategy": "General Equity",
        "sponsor": "Adams Funds",
        "price": 22.5,
        "nav": 25.0,
        "premium_discount": -10.0,
        "distribution_rate_price": 8.0,
        "distribution_rate_nav": 7.2,
        "return_on_nav_5y": 11.5,
        "leverage_ratio": 0.0,
        "is_leveraged": False,
        "expense_ratio": 0.56,
        "avg_daily_volume": 180000,
    }


class CefFundScanTest(unittest.TestCase):
    def _scan(self, ordered, cef_rows, ticker_factory):
        with (
            app_module.app.test_request_context(json={"sources": ["portfolio", "watchlist"]}),
            patch.object(app_module, "_resolve_scan_tickers", return_value=(ordered, ["portfolio", "watchlist"])),
            patch.object(app_module, "_cef_row_map", return_value=cef_rows),
            patch.object(app_module, "_yf_ticker", side_effect=ticker_factory),
            patch.object(app_module, "_scan_history_metrics", return_value={}),
        ):
            return app_module._run_fund_scan("cef").get_json()

    def test_confirmed_cef_is_not_lost_after_combined_source_scan_limit(self):
        ordinary = [f"ZZ{i:03d}" for i in range(app_module._FUND_SCAN_LIMIT + 5)]
        ordered = ordinary + ["ADX"]

        def ticker_factory(_symbol):
            ticker = MagicMock()
            ticker.info = {"shortName": "Ordinary stock", "quoteType": "EQUITY"}
            return ticker

        payload = self._scan(ordered, {"ADX": _cef_row()}, ticker_factory)

        self.assertTrue(payload["truncated"])
        self.assertEqual(payload["returned"], 1)
        self.assertEqual([row["ticker"] for row in payload["results"]], ["ADX"])

    def test_confirmed_cef_does_not_depend_on_yahoo_metadata(self):
        def ticker_factory(_symbol):
            raise AssertionError("Yahoo metadata should not be requested for a confirmed CEF")

        payload = self._scan(["ADX"], {"ADX": _cef_row()}, ticker_factory)

        self.assertEqual(payload["errors"], [])
        self.assertEqual(payload["returned"], 1)
        row = payload["results"][0]
        self.assertEqual(row["ticker"], "ADX")
        self.assertEqual(row["name"], "Adams Diversified Equity Fund")
        self.assertEqual(row["premium_discount"], -10.0)
        self.assertEqual(row["return_on_nav_5y"], 11.5)
        self.assertEqual(row["expense_ratio"], 0.56)
        self.assertEqual(row["avg_daily_volume"], 180000)


if __name__ == "__main__":
    unittest.main()
