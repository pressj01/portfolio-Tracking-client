import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pandas as pd

import app as app_module
import market_data_store as mds


class MarketDataStoreTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row

    def tearDown(self):
        self.conn.close()

    def test_round_trip_profile_and_series(self):
        history = pd.Series([0.1, 0.15], index=pd.DatetimeIndex(["2026-07-14", "2026-07-21"]))
        payload = {
            "known": True,
            "div": 0.15,
            "history": history,
            "source": "X Funds",
        }
        mds.save(self.conn, "xfunds", "DRMY", "distribution", payload)
        self.conn.commit()
        loaded = mds.load(self.conn, "xfunds", "drmy", "distribution")
        self.assertEqual(loaded["div"], 0.15)
        self.assertEqual(list(loaded["history"].values), [0.1, 0.15])

    def test_ttl_hides_stale_rows_but_stale_fallback_returns_them(self):
        mds.save(self.conn, "yahoo", "AAPL", "info", {"symbol": "AAPL"})
        self.conn.execute(
            "UPDATE market_data_cache SET fetched_at = ?",
            ((datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),),
        )
        self.conn.commit()
        self.assertIsNone(mds.load(self.conn, "yahoo", "AAPL", "info", max_age_sec=30 * 60))
        self.assertEqual(
            mds.load(self.conn, "yahoo", "AAPL", "info")["symbol"],
            "AAPL",
        )


class OfficialSnapshotStaleFallbackTest(unittest.TestCase):
    def setUp(self):
        app_module._OFFICIAL_DISTRIBUTION_CACHE.clear()
        app_module._XFUNDS_RESEARCH_CACHE.clear()

    def tearDown(self):
        app_module._OFFICIAL_DISTRIBUTION_CACHE.clear()
        app_module._XFUNDS_RESEARCH_CACHE.clear()

    def test_scrape_miss_returns_persisted_xfunds_snapshot_instead_of_yahoo(self):
        stale = {
            "known": True,
            "has_dividend": True,
            "div": 0.15,
            "freq": "W",
            "source": "X Funds",
        }
        with patch.object(app_module, "_match_fund_family", return_value={
            "fetcher": "_fetch_xfunds_distribution_snapshot",
        }), patch.object(app_module, "_fetch_xfunds_distribution_snapshot", return_value=None), \
             patch.object(app_module, "_load_persisted_market_payload", side_effect=[None, stale]):
            result = app_module._fetch_official_distribution_snapshot("DRMY")
        self.assertEqual(result["div"], 0.15)
        self.assertEqual(result["source"], "X Funds")

    def test_xfunds_profile_scrape_miss_uses_persisted_research(self):
        stale = {"name": "XFUNDS Memory Income ETF", "data_source": "XFUNDS", "price": 45.4}
        session = MagicMock()
        session.get.side_effect = RuntimeError("network down")
        with patch.object(app_module, "_xfunds_http_get", return_value=None), \
             patch.object(app_module, "_load_persisted_market_payload", return_value=stale):
            profile = app_module._fetch_xfunds_etf_profile("DRMY", session=session, use_cache=False)
        self.assertEqual(profile["name"], "XFUNDS Memory Income ETF")
        self.assertEqual(profile["data_source"], "XFUNDS")


if __name__ == "__main__":
    unittest.main()
