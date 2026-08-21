import sqlite3
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import normalize
import market_calendar as mc

UTC = timezone.utc


class MarketCloseTimingTest(unittest.TestCase):
    def test_eastern_now_uses_edt_in_summer(self):
        # 20:00 UTC on July 1 -> 16:00 EDT (UTC-4)
        et = mc.eastern_now(datetime(2026, 7, 1, 20, 0, tzinfo=UTC))
        self.assertEqual(et.hour, 16)
        self.assertEqual(et.utcoffset(), timedelta(hours=-4))

    def test_eastern_now_uses_est_in_winter(self):
        # 21:00 UTC on Jan 15 -> 16:00 EST (UTC-5)
        et = mc.eastern_now(datetime(2026, 1, 15, 21, 0, tzinfo=UTC))
        self.assertEqual(et.hour, 16)
        self.assertEqual(et.utcoffset(), timedelta(hours=-5))

    def test_dst_boundaries_2026(self):
        # DST 2026: starts Sun Mar 8, ends Sun Nov 1.
        self.assertFalse(mc._us_eastern_is_dst(date(2026, 3, 7)))
        self.assertTrue(mc._us_eastern_is_dst(date(2026, 3, 8)))
        self.assertTrue(mc._us_eastern_is_dst(date(2026, 10, 31)))
        self.assertFalse(mc._us_eastern_is_dst(date(2026, 11, 1)))

    def test_market_has_closed_gate(self):
        et = timezone(timedelta(hours=-4))
        before = datetime(2026, 7, 1, 16, 14, tzinfo=et)
        at_cutoff = datetime(2026, 7, 1, 16, 15, tzinfo=et)
        after = datetime(2026, 7, 1, 16, 30, tzinfo=et)
        self.assertFalse(mc.market_has_closed(before))
        self.assertTrue(mc.market_has_closed(at_cutoff))
        self.assertTrue(mc.market_has_closed(after))


class SnapshotSourceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "nav-source.db"
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY,
                include_in_owner INTEGER NOT NULL DEFAULT 0,
                cash_value REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE all_account_info (
                ticker TEXT,
                profile_id INTEGER,
                quantity REAL,
                current_price REAL,
                current_value REAL
            );
            CREATE TABLE portfolio_nav (
                profile_id INTEGER,
                nav_date TEXT,
                total_value REAL,
                source TEXT,
                UNIQUE(profile_id, nav_date)
            );
            INSERT INTO profiles (id, include_in_owner, cash_value) VALUES (6, 0, 0);
            INSERT INTO all_account_info
                (ticker, profile_id, quantity, current_price, current_value)
            VALUES ('AAA', 6, 10, 100, 1000);
            """
        )
        conn.commit()
        conn.close()
        self.original_get_connection = normalize.get_connection
        normalize.get_connection = lambda: sqlite3.connect(self.db_path)

    def tearDown(self):
        normalize.get_connection = self.original_get_connection
        self.temp_dir.cleanup()

    def _row(self, nav_date="2026-06-29"):
        conn = sqlite3.connect(self.db_path)
        try:
            return conn.execute(
                "SELECT total_value, source FROM portfolio_nav "
                "WHERE profile_id = 6 AND nav_date = ?",
                (nav_date,),
            ).fetchone()
        finally:
            conn.close()

    def test_default_source_is_snapshot(self):
        normalize.snapshot_nav(6, nav_date="2026-06-29")
        self.assertEqual(self._row(), (1000.0, "snapshot"))

    def test_close_source_is_tagged(self):
        normalize.snapshot_nav(6, nav_date="2026-06-29", source="close")
        self.assertEqual(self._row(), (1000.0, "close"))

    def test_close_capture_overwrites_intraday_snapshot(self):
        # An intraday 'snapshot' is recorded first, then the end-of-day price
        # moves and 'close' captures it -- the same day's row is upgraded.
        normalize.snapshot_nav(6, nav_date="2026-06-29")
        conn = sqlite3.connect(self.db_path)
        conn.execute("UPDATE all_account_info SET current_value = 1050 WHERE profile_id = 6")
        conn.commit()
        conn.close()
        value = normalize.snapshot_nav(6, nav_date="2026-06-29", source="close")
        self.assertEqual(value, 1050.0)
        self.assertEqual(self._row(), (1050.0, "close"))


class PartialRefreshCloseGateTest(unittest.TestCase):
    def test_payload_with_failures_is_not_complete(self):
        self.assertFalse(app_module._refresh_payload_complete_for_close({
            "price_failures": ["DRMY"],
            "price_complete": False,
        }))
        self.assertTrue(app_module._refresh_payload_complete_for_close({
            "price_failures": [],
            "price_complete": True,
        }))
        self.assertFalse(app_module._refresh_payload_complete_for_close({
            "price_failures": [],
        }))
        self.assertFalse(app_module._refresh_payload_complete_for_close(None))

    def _run_auto_capture(self, refresh_payload, snapshot=None):
        et = timezone(timedelta(hours=-4))
        now = datetime(2026, 7, 1, 16, 30, tzinfo=et)
        response = MagicMock()
        response.status_code = 200
        response.get_json.return_value = refresh_payload
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = None
        orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.app._db_initialized = True
        try:
            with patch.object(app_module, "eastern_now", return_value=now), \
                 patch.object(app_module, "is_nyse_trading_day", return_value=True), \
                 patch.object(app_module, "market_has_closed", return_value=True), \
                 patch.object(app_module, "refresh_market_data", return_value=response), \
                 patch.object(app_module, "snapshot_nav", snapshot or MagicMock(return_value=1000.0)) as snap, \
                 patch.object(app_module, "_nav_snapshot_profile_ids", return_value=[6]), \
                 patch.object(app_module, "get_connection", return_value=conn):
                with app_module.app.test_request_context("/api/nav/auto-capture?profile_id=6", method="POST"):
                    payload = app_module.api_nav_auto_capture().get_json()
        finally:
            app_module.app._db_initialized = orig_initialized
        return payload, snap

    def test_auto_capture_skips_close_when_refresh_is_partial(self):
        snapshot = MagicMock()
        payload, snap = self._run_auto_capture(
            {"price_failures": ["AAA", "BBB"], "price_complete": False},
            snapshot=snapshot,
        )
        self.assertFalse(payload["captured"])
        self.assertTrue(payload["skipped"])
        self.assertIn("incomplete", payload["reason"])
        self.assertEqual(payload["price_failures"], ["AAA", "BBB"])
        snap.assert_not_called()

    def test_auto_capture_stamps_close_when_refresh_is_complete(self):
        payload, snap = self._run_auto_capture(
            {"price_failures": [], "price_complete": True},
        )
        self.assertTrue(payload["captured"])
        snap.assert_called_with(6, nav_date="2026-07-01", source="close")


if __name__ == "__main__":
    unittest.main()
