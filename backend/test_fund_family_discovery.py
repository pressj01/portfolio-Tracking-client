import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_mod


ALTERNATE_LAYOUT_PAGE = """
<html>
  <head><title>NOVA Example Income ETF</title></head>
  <body>
    <h1>NOVA</h1>
    <table class="redesigned-distributions">
      <tr>
        <th>Amount ($)</th>
        <th>Payable Date</th>
        <th>Ex-Dividend Date</th>
      </tr>
      <tr><td>$0.1100</td><td>01/07/2099</td><td>01/06/2099</td></tr>
      <tr><td>$0.1200</td><td>01/14/2099</td><td>01/13/2099</td></tr>
    </table>
  </body>
</html>
"""


WRONG_FUND_PAGE = ALTERNATE_LAYOUT_PAGE.replace("NOVA", "OTHER")


def _entry(fetcher="_example_distribution_fetcher"):
    return {
        "name": "Example Issuer",
        "keywords": ["example issuer"],
        "fetcher": fetcher,
        "legacy": lambda _ticker, _description="": False,
        "page_url": "https://issuer.example/etf/{ticker_lower}",
    }


class FundFamilyDiscoveryTests(unittest.TestCase):
    def setUp(self):
        app_mod._OFFICIAL_DISTRIBUTION_CACHE.clear()
        app_mod._FUND_FAMILY_DISCOVERY_CACHE.clear()
        self.load_patcher = patch.object(
            app_mod, "_load_persisted_market_payload", return_value=None
        )
        self.persist_patcher = patch.object(app_mod, "_persist_market_payload")
        self.load_patcher.start()
        self.persist = self.persist_patcher.start()

    def tearDown(self):
        self.persist_patcher.stop()
        self.load_patcher.stop()
        app_mod._OFFICIAL_DISTRIBUTION_CACHE.clear()
        app_mod._FUND_FAMILY_DISCOVERY_CACHE.clear()

    def test_metadata_routes_a_new_ticker_without_a_ticker_list_entry(self):
        history = pd.Series(
            [0.2], index=pd.DatetimeIndex([pd.Timestamp("2026-08-20")])
        )
        fetcher = MagicMock(return_value={
            "known": True,
            "has_dividend": True,
            "div": 0.2,
            "ex_div_date": "08/20/26",
            "freq": "M",
            "history": history,
        })
        with patch.object(app_mod, "_FUND_FAMILY_REGISTRY", [_entry()]), \
             patch.object(app_mod, "_example_distribution_fetcher", fetcher, create=True):
            snapshot = app_mod._fetch_official_distribution_snapshot(
                "NEWF", "Example Issuer New Income ETF"
            )

        fetcher.assert_called_once_with("NEWF")
        self.assertEqual(snapshot["source"], "Example Issuer")
        self.assertEqual(snapshot["source_url"], "https://issuer.example/etf/newf")
        self.assertEqual(snapshot["div"], 0.2)

    def test_capability_probe_uses_semantic_table_when_issuer_markup_changes(self):
        fetcher = MagicMock(return_value=None)
        probe = MagicMock(return_value=(
            ALTERNATE_LAYOUT_PAGE,
            "https://issuer.example/etf/nova",
        ))
        entry = _entry()
        with patch.object(app_mod, "_FUND_FAMILY_REGISTRY", [entry]), \
             patch.object(app_mod, "_example_distribution_fetcher", fetcher, create=True), \
             patch.object(app_mod, "_fetch_fund_family_probe_page", probe):
            snapshot = app_mod._fetch_official_distribution_snapshot(
                "NOVA", "", discover=True
            )
            cached_entry = app_mod._match_fund_family("NOVA")

        fetcher.assert_called_once_with("NOVA")
        probe.assert_called_once_with(entry, "NOVA")
        self.assertIs(cached_entry, entry)
        self.assertEqual(snapshot["source"], "Example Issuer")
        self.assertEqual(snapshot["div"], 0.12)
        self.assertEqual(snapshot["ex_div_date"], "01/06/99")
        self.assertEqual(snapshot["div_pay_date"], "01/07/99")
        self.assertEqual(snapshot["freq"], "W")
        self.assertEqual(
            list(snapshot["history"].items()),
            [
                (pd.Timestamp("2099-01-06"), 0.11),
                (pd.Timestamp("2099-01-13"), 0.12),
            ],
        )
        self.assertTrue(any(
            call.args[1:3] == ("NOVA", "fund-family")
            for call in self.persist.call_args_list
        ))

    def test_wrong_ticker_page_is_rejected_and_negative_result_is_cached(self):
        fetcher = MagicMock(return_value=None)
        probe = MagicMock(return_value=(
            WRONG_FUND_PAGE,
            "https://issuer.example/etf/nova",
        ))
        yahoo_history = pd.Series(
            [0.09], index=pd.DatetimeIndex([pd.Timestamp("2026-08-20")])
        )
        yahoo = {
            "known": True,
            "has_dividend": True,
            "div": 0.09,
            "freq": "M",
            "history": yahoo_history,
            "source": "Yahoo Finance",
        }
        with patch.object(app_mod, "_FUND_FAMILY_REGISTRY", [_entry()]), \
             patch.object(app_mod, "_example_distribution_fetcher", fetcher, create=True), \
             patch.object(app_mod, "_fetch_fund_family_probe_page", probe):
            first = app_mod._fetch_official_distribution_snapshot("NOVA", "", discover=True)
            second = app_mod._fetch_official_distribution_snapshot("NOVA", "", discover=True)

        self.assertIsNone(first)
        self.assertIsNone(second)
        probe.assert_called_once()
        fetcher.assert_not_called()
        merged = app_mod._merge_official_distribution_snapshot(yahoo, first)
        self.assertEqual(merged["source"], "Yahoo Finance")
        self.assertEqual(merged["div"], 0.09)
        self.assertTrue(merged["history"].equals(yahoo_history))


if __name__ == "__main__":
    unittest.main()
