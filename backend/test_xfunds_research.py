import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class XFundsResearchTest(unittest.TestCase):
    def setUp(self):
        self.page_html = """
            <html><body class="page-id-3000">
              <h2>XFunds™ Memory Income ETF</h2>
              <h2>Fund Summary</h2>
              <div><p>DRMY seeks capital appreciation and current income.</p></div>
              <h2>Fund Objective</h2>
              <div><p>The Fund invests in memory companies.</p></div>
            </body></html>
        """
        self.fund_info_html = """
            <table><tbody>
              <tr><td>Fund Inception</td><td>07/16/2026</td></tr>
              <tr><td>Ticker</td><td>DRMY</td></tr>
              <tr><td>Primary Exchange</td><td>NYSE</td></tr>
              <tr><td>CUSIP</td><td>88634T261</td></tr>
              <tr><td>Expense Ratio*</td><td>1.01%</td></tr>
              <tr><td>30 Day SEC Yield*<br/>As of</td><td>-</td></tr>
            </tbody></table>
        """
        self.nav_html = """
            <table><tbody>
              <tr><td>Net Assets</td><td>$1.15m</td></tr>
              <tr><td>NAV</td><td>$45.83</td></tr>
              <tr><td>Closing Price</td><td>$45.19</td></tr>
            </tbody></table>
        """
        self.holdings_csv = """Date,Account,StockTicker,CUSIP,SecurityName,Shares,Price,MarketValue,Weightings,NetAssets,SharesOutstanding,CreationUnits
07/17/2026,DRMY,Cash&Other,Cash&Other,Cash & Other,436146,1.0,436145.86,38.07%,1145747.5,25000,1.0
07/17/2026,DRMY,MU,595112103,Micron Technology Inc,206,853.2,175759.2,15.34%,1145747.5,25000,1.0
"""

    def _profile(self):
        return app_module._parse_xfunds_etf_profile(
            "DRMY",
            self.page_html,
            self.fund_info_html,
            self.nav_html,
            self.holdings_csv,
            "https://nicholasx.com/DRMY/",
        )

    def test_drmy_is_recognized_as_xfunds(self):
        self.assertTrue(app_module._is_xfunds_fund("DRMY"))

    def test_official_profile_parses_live_fund_values_and_holdings(self):
        profile = self._profile()

        self.assertEqual(profile["name"], "XFunds™ Memory Income ETF")
        self.assertEqual(profile["description"], "DRMY seeks capital appreciation and current income.")
        self.assertEqual(profile["expense_ratio_pct"], 1.01)
        self.assertEqual(profile["total_assets"], 1_145_747.5)
        self.assertEqual(profile["nav_price"], 45.83)
        self.assertEqual(profile["price"], 45.19)
        self.assertEqual(profile["inception_date"], "2026-07-16")
        self.assertEqual(profile["top_holdings"][1]["symbol"], "MU")
        self.assertEqual(profile["data_source"], "X Funds")
        self.assertEqual(profile["fallback_data_source"], "Yahoo Finance")

    def test_security_research_keeps_xfunds_primary_and_yahoo_for_gaps(self):
        official = self._profile()
        yahoo_info = {
            "symbol": "DRMY",
            "quoteType": "ETF",
            "longName": "Yahoo DRMY Name",
            "longBusinessSummary": "Yahoo summary",
            "category": "Technology",
            "netExpenseRatio": 0.02,
            "totalAssets": 0,
            "regularMarketPrice": 45.25,
            "navPrice": 45.25,
            "fundInceptionDate": int(pd.Timestamp("2026-07-15").timestamp()),
        }
        yahoo_ticker = SimpleNamespace(funds_data=None, balance_sheet=pd.DataFrame())

        with (
            patch.object(app_module, "_fetch_xfunds_etf_profile", return_value=official) as official_fetch,
            patch.object(app_module, "_cached_yf_info", return_value=yahoo_info),
            patch.object(app_module, "_cached_yf_dividends", return_value=pd.Series(dtype=float)),
            patch.object(app_module, "_fetch_official_distribution_snapshot", return_value=None),
            patch.object(app_module, "_assess_etf_closure_risk_with_fallback", return_value={}),
            patch("yfinance.Ticker", return_value=yahoo_ticker),
        ):
            response = app_module.app.test_client().get("/api/security-research/etf/DRMY")

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        official_fetch.assert_called_once_with("DRMY")
        self.assertEqual(data["data_source"], "X Funds")
        self.assertEqual(data["fallback_data_source"], "Yahoo Finance")
        self.assertEqual(data["name"], "XFunds™ Memory Income ETF")
        self.assertEqual(data["expense_ratio_pct"], 1.01)
        self.assertEqual(data["total_assets"], 1_145_747.5)
        self.assertEqual(data["nav_price"], 45.83)
        self.assertEqual(data["price"], 45.19)
        self.assertEqual(data["inception_date"], "2026-07-16")
        self.assertEqual(data["category"], "Technology")


if __name__ == "__main__":
    unittest.main()
