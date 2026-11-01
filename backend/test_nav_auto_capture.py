import sqlite3
import sys
import tempfile
import threading
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


class MissedCloseCatchUpTest(unittest.TestCase):
    """Runs the real NYSE calendar; only the clock and the refresh are faked."""

    COMPLETE = {"price_failures": [], "price_complete": True}
    INCOMPLETE = {"price_failures": ["AAA"], "price_complete": False}
    EDT = timezone(timedelta(hours=-4))
    EST = timezone(timedelta(hours=-5))

    def setUp(self):
        patcher = patch.dict(app_module._close_catch_up_tried, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _capture(self, now, payload=None, already_captured=False, monotonic=1000.0, profile_id=6):
        response = MagicMock()
        response.status_code = 200
        response.get_json.return_value = payload or self.COMPLETE
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = (1,) if already_captured else None
        refresh = MagicMock(return_value=response)
        snapshot = MagicMock(return_value=1000.0)
        orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.app._db_initialized = True
        try:
            with patch.object(app_module, "eastern_now", return_value=now), \
                 patch.object(app_module.time, "monotonic", return_value=monotonic), \
                 patch.object(app_module, "refresh_market_data", refresh), \
                 patch.object(app_module, "snapshot_nav", snapshot), \
                 patch.object(app_module, "_nav_snapshot_profile_ids", return_value=[6]), \
                 patch.object(app_module, "_restore_extended_prices_after_capture"), \
                 patch.object(app_module, "get_connection", return_value=conn):
                with app_module.app.test_request_context(f"/api/nav/auto-capture?profile_id={profile_id}", method="POST"):
                    payload = app_module.api_nav_auto_capture().get_json()
        finally:
            app_module.app._db_initialized = orig_initialized
        return payload, refresh, snapshot

    def _assert_captured(self, now, nav_date):
        payload, refresh, snapshot = self._capture(now)
        self.assertTrue(payload["captured"], payload)
        self.assertEqual(payload["nav_date"], nav_date)
        refresh.assert_called_once()
        snapshot.assert_called_once_with(6, nav_date=nav_date, source="close")

    def _assert_session_running(self, now):
        payload, refresh, snapshot = self._capture(now)
        self.assertFalse(payload["captured"])
        self.assertIn("not closed", payload["reason"])
        refresh.assert_not_called()
        snapshot.assert_not_called()

    def test_saturday_records_fridays_close(self):
        self._assert_captured(datetime(2026, 10, 31, 12, 0, tzinfo=self.EDT), "2026-10-30")

    def test_sunday_records_fridays_close(self):
        self._assert_captured(datetime(2026, 11, 1, 17, 30, tzinfo=self.EST), "2026-10-30")

    def test_monday_before_the_open_records_fridays_close(self):
        self._assert_captured(datetime(2026, 11, 2, 9, 29, tzinfo=self.EST), "2026-10-30")

    def test_a_weeknight_past_midnight_records_the_previous_close(self):
        self._assert_captured(datetime(2026, 10, 29, 0, 30, tzinfo=self.EDT), "2026-10-28")

    def test_a_market_holiday_records_the_session_before_it(self):
        # Thanksgiving 2026 is Thursday, Nov 26.
        self._assert_captured(datetime(2026, 11, 26, 12, 0, tzinfo=self.EST), "2026-11-25")

    def test_once_monday_opens_fridays_close_is_gone(self):
        self._assert_session_running(datetime(2026, 11, 2, 9, 30, tzinfo=self.EST))

    def test_the_settle_buffer_still_holds_back_todays_close(self):
        self._assert_session_running(datetime(2026, 11, 2, 16, 14, tzinfo=self.EST))

    def test_after_mondays_close_it_records_monday(self):
        self._assert_captured(datetime(2026, 11, 2, 16, 15, tzinfo=self.EST), "2026-11-02")

    def test_a_captured_close_does_not_refresh_again_all_weekend(self):
        payload, refresh, snapshot = self._capture(
            datetime(2026, 10, 31, 12, 0, tzinfo=self.EDT), already_captured=True,
        )
        self.assertFalse(payload["captured"])
        self.assertIn("2026-10-30", payload["reason"])
        refresh.assert_not_called()
        snapshot.assert_not_called()

    def test_an_incomplete_catch_up_waits_an_hour_before_refreshing_again(self):
        saturday = datetime(2026, 10, 31, 12, 0, tzinfo=self.EDT)
        first, refresh, snapshot = self._capture(saturday, self.INCOMPLETE, monotonic=1000.0)
        self.assertFalse(first["captured"])
        self.assertIn("2026-10-30", first["reason"])
        refresh.assert_called_once()
        snapshot.assert_not_called()

        _, refresh, _ = self._capture(saturday, self.INCOMPLETE, monotonic=1000.0 + 3599)
        refresh.assert_not_called()

        again, refresh, snapshot = self._capture(saturday, monotonic=1000.0 + 3600)
        refresh.assert_called_once()
        self.assertTrue(again["captured"])
        snapshot.assert_called_once_with(6, nav_date="2026-10-30", source="close")

    def test_the_wait_is_per_profile(self):
        saturday = datetime(2026, 10, 31, 12, 0, tzinfo=self.EDT)
        self._capture(saturday, self.INCOMPLETE, monotonic=1000.0, profile_id=7)
        _, refresh, _ = self._capture(saturday, monotonic=1001.0, profile_id=6)
        refresh.assert_called_once()

    def test_the_evening_of_the_close_keeps_its_ten_minute_retries(self):
        evening = datetime(2026, 10, 30, 16, 30, tzinfo=self.EDT)
        self._capture(evening, self.INCOMPLETE, monotonic=1000.0)
        _, refresh, _ = self._capture(evening, self.INCOMPLETE, monotonic=1000.0 + 600)
        refresh.assert_called_once()


class LiveNavDateTest(unittest.TestCase):
    """The chart's last point carries the Portfolio Value card, so it needs a date
    whenever the app is open, not only during a market day."""

    EDT = timezone(timedelta(hours=-4))
    EST = timezone(timedelta(hours=-5))

    def _live_date_at(self, now):
        with patch.object(app_module, "eastern_now", return_value=now):
            return app_module._live_nav_date()

    def test_a_weekend_stays_on_fridays_point(self):
        self.assertEqual(self._live_date_at(datetime(2026, 10, 31, 12, 0, tzinfo=self.EDT)), "2026-10-30")
        self.assertEqual(self._live_date_at(datetime(2026, 11, 1, 17, 0, tzinfo=self.EST)), "2026-10-30")

    def test_before_the_open_stays_on_the_last_session(self):
        self.assertEqual(self._live_date_at(datetime(2026, 11, 2, 9, 29, tzinfo=self.EST)), "2026-10-30")

    def test_the_open_moves_it_to_today(self):
        self.assertEqual(self._live_date_at(datetime(2026, 11, 2, 9, 30, tzinfo=self.EST)), "2026-11-02")

    def test_after_the_close_it_stays_on_today(self):
        self.assertEqual(self._live_date_at(datetime(2026, 11, 2, 20, 0, tzinfo=self.EST)), "2026-11-02")

    def test_a_holiday_stays_on_the_session_before_it(self):
        self.assertEqual(self._live_date_at(datetime(2026, 11, 26, 12, 0, tzinfo=self.EST)), "2026-11-25")


class CloseCaptureRefreshRaceTest(unittest.TestCase):
    """The page-load refresh starts alongside the launch poll. With extended-hours
    prices on, landing between the capture's refresh and its snapshot stamps an
    after-hours value as the official close (seen live: $521,396.90 vs $520,336.35).
    """

    FRIDAY_EVENING = datetime(2026, 10, 30, 16, 30, tzinfo=timezone(timedelta(hours=-4)))

    def setUp(self):
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = None
        conn.execute.return_value.fetchall.return_value = []
        target = {"scope": "single", "source_profile_ids": [6], "selected_profile_id": 6}
        for patcher in (
            patch.dict(app_module._close_catch_up_tried, clear=True),
            patch.object(app_module.app, "_db_initialized", True, create=True),
            patch.object(app_module, "get_connection", return_value=conn),
            patch.object(app_module, "_ensure_basis_columns"),
            patch.object(app_module, "_get_refresh_target_info", return_value=target),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        # The route's own function: the capture test swaps the module's name for a fake.
        self.page_load_view = app_module.app.view_functions["refresh_market_data"]

    def _start_page_load_refresh(self):
        finished = threading.Event()

        def run():
            with app_module.app.test_request_context("/api/refresh?profile_id=6", method="POST"):
                self.page_load_view()
            finished.set()

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 5)
        return finished

    def test_a_refresh_waits_while_another_one_holds_the_lock(self):
        with app_module._market_refresh_lock:
            finished = self._start_page_load_refresh()
            self.assertFalse(finished.wait(0.2))
        self.assertTrue(finished.wait(5))

    def test_a_page_load_refresh_cannot_land_between_the_close_prices_and_the_snapshot(self):
        response = MagicMock()
        response.status_code = 200
        response.get_json.return_value = {"price_failures": [], "price_complete": True}
        seen = {}

        def capture_refresh():
            seen["page_load"] = self._start_page_load_refresh()
            return response

        def snapshot(*_args, **_kwargs):
            seen["landed_first"] = seen["page_load"].wait(0.2)
            return 1000.0

        with patch.object(app_module, "eastern_now", return_value=self.FRIDAY_EVENING),              patch.object(app_module, "refresh_market_data", side_effect=capture_refresh),              patch.object(app_module, "snapshot_nav", side_effect=snapshot),              patch.object(app_module, "_nav_snapshot_profile_ids", return_value=[6]),              patch.object(app_module, "_restore_extended_prices_after_capture"):
            with app_module.app.test_request_context("/api/nav/auto-capture?profile_id=6", method="POST"):
                payload = app_module.api_nav_auto_capture().get_json()

        self.assertTrue(payload["captured"])
        self.assertFalse(seen["landed_first"])
        self.assertTrue(seen["page_load"].wait(5))


if __name__ == "__main__":
    unittest.main()
