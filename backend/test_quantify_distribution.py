import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import (
    _fetch_official_distribution_snapshot,
    _fetch_quantify_distribution_snapshot,
    _fetch_quantify_etf_profile,
    _is_quantify_fund,
    _match_fund_family,
)


class _FakeResponse:
    def __init__(self, text="", payload=None, status_code=200):
        self.text = text
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code != 200:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        if self._payload is not None:
            return self._payload
        return json.loads(self.text or "{}")


ISSB_PAGE = """
<html>
  <body>
    <h1>IncomeSTKd 1x US Stocks &amp; 1x Bitcoin Premium ETF</h1>
    <div>Distribution Frequency Weekly Gross Expense Ratio 1.29%</div>
    <div data-twm-type="distribution-table" data-post-id="904"></div>
    <div data-twm-type="fund-info-table" data-post-id="904"></div>
    <div data-twm-type="daily-nav-table" data-post-id="904"></div>
  </body>
</html>
"""

IQQI_PAGE = """
<html>
  <body>
    <h1>IncomeQ Nasdaq-100 Premium Income ETF</h1>
    <div>Distribution Frequency Weekly Gross Expense Ratio 1.13%</div>
    <div data-twm-type="distribution-table" data-post-id="1962"></div>
    <div data-twm-type="fund-info-table" data-post-id="1962"></div>
    <div data-twm-type="daily-nav-table" data-post-id="1962"></div>
  </body>
</html>
"""

ISSB_DISTRIBUTION_HTML = """
<table>
  <tr><th>EX Date</th><th>Record Date</th><th>Payable Date</th><th>Fund Total</th></tr>
  <tr><td>11/16/2026</td><td>11/16/2026</td><td>11/17/2026</td><td>0.07</td></tr>
  <tr><td>11/09/2026</td><td>11/09/2026</td><td>11/10/2026</td><td>0.07</td></tr>
  <tr><td>11/02/2026</td><td>11/02/2026</td><td>11/03/2026</td><td>0.07</td></tr>
</table>
"""

IQQI_DISTRIBUTION_HTML = """
<table>
  <tr><th>EX Date</th><th>Record Date</th><th>Payable Date</th><th>Fund Total</th></tr>
  <tr><td>-</td><td>-</td><td>-</td><td>-</td></tr>
</table>
"""

ISSB_FUND_INFO_HTML = """
<table>
  <tr><td>Fund Name IncomeSTKd 1x US Stocks & 1x Bitcoin Premium ETF</td></tr>
  <tr><td>Fund Inception</td><td>01/20/2026</td></tr>
  <tr><td>Ticker</td><td>ISSB</td></tr>
  <tr><td>Gross Expense Ratio</td><td>1.29%</td></tr>
  <tr><td>Net Expense Ratio</td><td>1.14%</td></tr>
</table>
"""

ISSB_DAILY_NAV_HTML = """
<table>
  <tr><td>Net Assets</td><td>$1.91m</td></tr>
  <tr><td>NAV</td><td>$15.90</td></tr>
  <tr><td>Closing Price</td><td>$15.80</td></tr>
</table>
"""

IQQI_FUND_INFO_HTML = """
<table>
  <tr><td>Fund Inception</td><td>11/17/2026</td></tr>
  <tr><td>Ticker</td><td>IQQI</td></tr>
  <tr><td>Gross Expense Ratio</td><td>1.13%</td></tr>
  <tr><td>Net Expense Ratio**</td><td>0.99%</td></tr>
</table>
"""

IQQI_DAILY_NAV_HTML = """
<table>
  <tr><td>Net Assets</td><td>$0.00m</td></tr>
  <tr><td>NAV</td><td>$25.00</td></tr>
  <tr><td>Closing Price</td><td>$25.00</td></tr>
</table>
"""


def _session_side_effect(page_html, tables_by_type):
    session = MagicMock()

    def get(url, params=None, timeout=10, headers=None):
        params = params or {}
        if "wp-json/twm/v1/data" in url:
            table_type = params.get("type")
            return _FakeResponse(payload={"html": tables_by_type.get(table_type, "")})
        return _FakeResponse(text=page_html)

    session.get.side_effect = get
    return session


class QuantifyDistributionTests(unittest.TestCase):
    def test_current_lineup_routes_to_quantify_parser(self):
        for ticker in ("ISSB", "ISBG", "IQQI"):
            with self.subTest(ticker=ticker):
                self.assertTrue(_is_quantify_fund(ticker))
                family = _match_fund_family(ticker)
                self.assertEqual(family["name"], "Quantify Funds")
                self.assertEqual(
                    family["page_url"],
                    "https://quantifyfunds.com/{ticker_lower}/",
                )
                self.assertEqual(
                    family["fetcher"],
                    "_fetch_quantify_distribution_snapshot",
                )

    def test_incomeq_description_identifies_quantify_family(self):
        self.assertTrue(
            _is_quantify_fund("ZZZZ", "IncomeQ Nasdaq-100 Premium Income ETF")
        )

    @patch("requests.Session")
    def test_issb_fetcher_reads_pay_ex_amount_from_quantify(self, session_cls):
        session_cls.return_value = _session_side_effect(
            ISSB_PAGE,
            {"distribution-table": ISSB_DISTRIBUTION_HTML},
        )

        snapshot = _fetch_quantify_distribution_snapshot("ISSB")

        self.assertEqual(snapshot["source"], "Quantify Funds")
        self.assertEqual(snapshot["source_url"], "https://quantifyfunds.com/issb/")
        self.assertEqual(snapshot["div"], 0.07)
        self.assertEqual(snapshot["ex_div_date"], "11/16/26")
        self.assertEqual(snapshot["div_pay_date"], "11/17/26")
        self.assertEqual(snapshot["freq"], "W")
        self.assertEqual(
            list(snapshot["history"].tail(2).items()),
            [
                (pd.Timestamp("2026-11-09"), 0.07),
                (pd.Timestamp("2026-11-16"), 0.07),
            ],
        )

    @patch("requests.Session")
    def test_new_iqqi_fund_returns_none_so_yahoo_can_fallback(self, session_cls):
        session_cls.return_value = _session_side_effect(
            IQQI_PAGE,
            {"distribution-table": IQQI_DISTRIBUTION_HTML},
        )

        self.assertIsNone(_fetch_quantify_distribution_snapshot("IQQI"))

    @patch("requests.Session")
    def test_official_snapshot_falls_back_when_quantify_has_no_distributions(
        self, session_cls
    ):
        session_cls.return_value = _session_side_effect(
            IQQI_PAGE,
            {"distribution-table": IQQI_DISTRIBUTION_HTML},
        )

        self.assertIsNone(
            _fetch_official_distribution_snapshot(
                "IQQI",
                "Quantify Funds IncomeQ Nasdaq-100 Premium Income ETF",
            )
        )

    @patch("requests.Session")
    def test_issb_profile_reads_aum_and_expense(self, session_cls):
        session_cls.return_value = _session_side_effect(
            ISSB_PAGE,
            {
                "fund-info-table": ISSB_FUND_INFO_HTML,
                "daily-nav-table": ISSB_DAILY_NAV_HTML,
            },
        )

        profile = _fetch_quantify_etf_profile("ISSB")

        self.assertEqual(profile["data_source"], "Quantify Funds")
        self.assertEqual(profile["source_url"], "https://quantifyfunds.com/issb/")
        self.assertEqual(profile["total_assets"], 1_910_000.0)
        self.assertEqual(profile["expense_ratio_pct"], 1.14)
        self.assertEqual(profile["nav_price"], 15.90)
        self.assertEqual(profile["inception_date"], "2026-01-20")
        self.assertEqual(profile["dividend_frequency"], "Weekly")

    @patch("requests.Session")
    def test_new_iqqi_zero_aum_is_left_blank_for_yahoo(self, session_cls):
        session_cls.return_value = _session_side_effect(
            IQQI_PAGE,
            {
                "fund-info-table": IQQI_FUND_INFO_HTML,
                "daily-nav-table": IQQI_DAILY_NAV_HTML,
            },
        )

        profile = _fetch_quantify_etf_profile("IQQI")

        self.assertIsNone(profile["total_assets"])
        self.assertEqual(profile["expense_ratio_pct"], 0.99)
        self.assertEqual(profile["nav_price"], 25.0)
        self.assertEqual(profile["inception_date"], "2026-11-17")
        self.assertEqual(profile["dividend_frequency"], "Weekly")

    @patch("requests.Session", side_effect=RuntimeError("site down"))
    def test_fetcher_returns_none_so_yahoo_can_remain_the_fallback(self, _session_cls):
        self.assertIsNone(_fetch_quantify_distribution_snapshot("ISSB"))
        self.assertIsNone(_fetch_quantify_etf_profile("ISSB"))


if __name__ == "__main__":
    unittest.main()
