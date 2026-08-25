import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import (
    _fetch_lsfunds_distribution_snapshot,
    _fetch_refresh_dividend_snapshot,
    _generic_distribution_snapshot_from_html,
    _is_lsfunds_fund,
    _match_fund_family,
)


class _FakeResponse:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code != 200:
            raise RuntimeError(f"HTTP {self.status_code}")


OVF_PAGE = """
<html>
  <head><title>OVF Overlay Shares Foreign Equity ETF</title></head>
  <body>
    <h1>OVF</h1>
    <table class="fund-facts">
      <tr><th>Distribution Rate**</th><td>10.38%</td></tr>
      <tr><th>Distribution Frequency</th><td>Monthly</td></tr>
    </table>
    <table class="new-distribution-layout">
      <tr>
        <th>Record Date</th><th>Ex-Date</th><th>Payable Date</th><th>Amount</th>
      </tr>
      <tr><td>08/27/2026</td><td>08/27/2026</td><td>08/28/2026</td><td>--</td></tr>
      <tr><td>07/29/2026</td><td>07/29/2026</td><td>07/30/2026</td><td>$0.2709</td></tr>
      <tr><td>06/26/2026</td><td>06/26/2026</td><td>06/29/2026</td><td>$0.2753</td></tr>
      <tr><td>03/28/2025</td><td>03/28/2025</td><td>03/31/2025</td><td>$0.2500</td></tr>
      <tr><td>12/27/2024</td><td>12/27/2024</td><td>12/30/2024</td><td>$0.2400</td></tr>
    </table>
  </body>
</html>
"""


class LSFundsDistributionTests(unittest.TestCase):
    def test_current_lineup_routes_to_ls_funds_parser(self):
        for ticker in ("OVL", "OVS", "OVF"):
            with self.subTest(ticker=ticker):
                self.assertTrue(_is_lsfunds_fund(ticker))
                family = _match_fund_family(ticker)
                self.assertEqual(family["fetcher"], "_fetch_lsfunds_distribution_snapshot")

    def test_semantic_parser_prefers_published_monthly_frequency(self):
        snapshot = _generic_distribution_snapshot_from_html(
            OVF_PAGE,
            "OVF",
            "LS Funds",
            "https://lsfunds.com/etfs/ovf",
            as_of="2026-08-25",
        )

        self.assertEqual(snapshot["source"], "LS Funds")
        self.assertEqual(snapshot["distribution_rate_pct"], 10.38)
        self.assertEqual(snapshot["freq"], "M")
        self.assertEqual(snapshot["div"], 0.2709)
        self.assertEqual(snapshot["ex_div_date"], "08/27/26")
        self.assertEqual(snapshot["div_pay_date"], "08/28/26")
        self.assertEqual(
            list(snapshot["history"].tail(2).items()),
            [
                (pd.Timestamp("2026-06-26"), 0.2753),
                (pd.Timestamp("2026-07-29"), 0.2709),
            ],
        )

    @patch("requests.get", return_value=_FakeResponse(OVF_PAGE))
    def test_ovf_fetcher_returns_official_frequency_and_distribution(self, request_get):
        snapshot = _fetch_lsfunds_distribution_snapshot("OVF")

        request_get.assert_called_once()
        self.assertEqual(snapshot["source"], "LS Funds")
        self.assertEqual(snapshot["source_url"], "https://lsfunds.com/etfs/ovf")
        self.assertEqual(snapshot["freq"], "M")
        self.assertEqual(snapshot["div"], 0.2709)

    @patch("requests.get", side_effect=RuntimeError("LS Funds unavailable"))
    def test_fetcher_returns_none_so_yahoo_can_remain_the_fallback(self, _request_get):
        self.assertIsNone(_fetch_lsfunds_distribution_snapshot("OVF"))

    def test_official_monthly_frequency_overrides_yahoo_quarterly_inference(self):
        class _YahooOVF:
            ticker = "OVF"
            info = {
                "longName": "Overlay Shares Foreign Equity ETF",
                "quoteType": "ETF",
            }
            dividends = pd.Series(
                [0.2, 0.21, 0.22],
                index=pd.DatetimeIndex([
                    pd.Timestamp("2025-09-30"),
                    pd.Timestamp("2025-12-30"),
                    pd.Timestamp("2026-03-30"),
                ]),
            )
            calendar = {}

        official = _generic_distribution_snapshot_from_html(
            OVF_PAGE,
            "OVF",
            "LS Funds",
            "https://lsfunds.com/etfs/ovf",
            as_of="2026-08-25",
        )
        with patch("app._fetch_official_distribution_snapshot", return_value=official):
            snapshot = _fetch_refresh_dividend_snapshot(_YahooOVF())

        self.assertEqual(snapshot["freq"], "M")
        self.assertEqual(snapshot["div"], 0.2709)
        self.assertEqual(snapshot["source"], "LS Funds")


if __name__ == "__main__":
    unittest.main()
