import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import (
    _fetch_kurv_distribution_snapshot,
    _is_kurv_fund,
    _match_fund_family,
    _merge_official_distribution_snapshot,
)


class _FakeResponse:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code != 200:
            raise RuntimeError(f"HTTP {self.status_code}")


KEO_PAGE = """
<table>
  <tr class="table_row is-head">
    <th><span><div class="u-cms-text">Declaration Date</div></span></th>
    <th><span><div class="u-cms-text">Ex-Dividend Date</div></span></th>
    <th><span><div class="u-cms-text">Record Date</div></span></th>
    <th><span><div class="u-cms-text">Payable Date</div></span></th>
    <th><span><div class="u-cms-text">$ per Share</div></span></th>
  </tr>
  <tr class="table_row">
    <th><span><div class="u-cms-text">09/01/2026</div></span></th>
    <td><span><div class="u-cms-text">09/02/2026</div></span></td>
    <td><span><div class="u-cms-text">09/02/2026</div></span></td>
    <td><span><div class="u-cms-text">09/03/2026</div></span></td>
    <td><span><div class="u-cms-text">--</div></span></td>
  </tr>
  <tr class="table_row">
    <th><span><div class="u-cms-text">08/25/2026</div></span></th>
    <td><span><div class="u-cms-text">08/26/2026</div></span></td>
    <td><span><div class="u-cms-text">08/26/2026</div></span></td>
    <td><span><div class="u-cms-text">08/27/2026</div></span></td>
    <td><span><div class="u-cms-text">$0.0830</div></span></td>
  </tr>
  <tr class="table_row">
    <th><span><div class="u-cms-text">08/18/2026</div></span></th>
    <td><span><div class="u-cms-text">08/19/2026</div></span></td>
    <td><span><div class="u-cms-text">08/19/2026</div></span></td>
    <td><span><div class="u-cms-text">08/20/2026</div></span></td>
    <td><span><div class="u-cms-text">$0.0800</div></span></td>
  </tr>
</table>
"""


class KurvDistributionTests(unittest.TestCase):
    def test_keo_routes_from_issuer_metadata_without_a_ticker_list_entry(self):
        self.assertFalse(_is_kurv_fund("KEO"))
        self.assertTrue(_is_kurv_fund("KEO", "Kurv Enduring Equity ETF"))
        family = _match_fund_family("KEO", "Kurv Enduring Equity ETF")
        self.assertIsNotNone(family)
        self.assertEqual(family["fetcher"], "_fetch_kurv_distribution_snapshot")

    @patch("requests.get", return_value=_FakeResponse(KEO_PAGE))
    def test_keo_uses_official_amount_dates_and_weekly_schedule(self, request_get):
        snapshot = _fetch_kurv_distribution_snapshot("KEO", as_of="2026-08-25")

        request_get.assert_called_once()
        self.assertTrue(snapshot["has_dividend"])
        self.assertEqual(snapshot["source"], "Kurv")
        self.assertEqual(snapshot["source_url"], "https://www.kurvinvest.com/etf/keo")
        self.assertEqual(snapshot["div"], 0.083)
        self.assertEqual(snapshot["ex_div_date"], "08/26/26")
        self.assertEqual(snapshot["div_pay_date"], "08/27/26")
        self.assertEqual(snapshot["freq"], "W")
        self.assertEqual(
            list(snapshot["history"].items()),
            [
                (pd.Timestamp("2026-08-19"), 0.08),
                (pd.Timestamp("2026-08-26"), 0.083),
            ],
        )

        merged = _merge_official_distribution_snapshot(
            {"freq": "M", "history": pd.Series(dtype=float)}, snapshot
        )
        self.assertTrue(merged["frequency_authoritative"])

    @patch("requests.get", side_effect=RuntimeError("Kurv unavailable"))
    def test_yahoo_snapshot_is_unchanged_when_kurv_data_is_unavailable(self, _request_get):
        yahoo_history = pd.Series(
            [0.075], index=pd.DatetimeIndex([pd.Timestamp("2026-08-19")])
        )
        yahoo = {
            "known": True,
            "has_dividend": True,
            "div": 0.075,
            "ex_div_date": "08/19/26",
            "div_pay_date": "08/20/26",
            "freq": "W",
            "history": yahoo_history,
            "source": "Yahoo Finance",
        }

        official = _fetch_kurv_distribution_snapshot("KEO", as_of="2026-08-25")
        merged = _merge_official_distribution_snapshot(yahoo, official)

        self.assertIsNone(official)
        self.assertEqual(merged, yahoo)
        self.assertTrue(merged["history"].equals(yahoo_history))


if __name__ == "__main__":
    unittest.main()
