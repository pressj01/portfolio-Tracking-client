"""Opt-in extended-hours pricing: what it may change, and what it must not.

Schwab's "Extended Hours Values" price a fund from its last pre- or post-market
trade; the app's refresh read Yahoo's 4 PM close. The Settings choice swaps
one for the other. The cases that matter most are the ones where an
after-hours print must NOT be used: a stale quote, a throttled feed, the
official end-of-day NAV capture, and any holding the refresh could not price
from the regular session in the first place.
"""

import datetime
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database as database_module
from refresh_sessions import (
    EXTENDED_QUOTE_FIELDS,
    _parse_extended_quote,
    apply_extended_prices,
    closes_by_session,
    fetch_extended_quotes,
    with_session_price,
)

UTC = timezone.utc


def _epoch(*args):
    return int(datetime.datetime(*args, tzinfo=UTC).timestamp())


# Oct 13 2026 (EDT, UTC-4): 4:00 PM close, then a 5:58 PM after-hours trade.
OCT13_CLOSE = _epoch(2026, 10, 13, 20, 0)
OCT13_POST = _epoch(2026, 10, 13, 21, 58)
# Oct 12's after-hours trade, still sitting on Yahoo's row the next day.
OCT12_POST = _epoch(2026, 10, 12, 21, 30)
# 8:00 AM on Oct 14, before the open.
OCT14_PRE = _epoch(2026, 10, 14, 12, 0)

PRIOR, LATEST = date(2026, 10, 12), date(2026, 10, 13)


def _series(bars):
    return pd.Series(list(bars.values()), index=pd.to_datetime(list(bars)), dtype=float)


def _row(symbol="TDAX", regular_time=OCT13_CLOSE, **fields):
    row = {"symbol": symbol, "regularMarketPrice": 24.0, "regularMarketTime": regular_time}
    row.update(fields)
    return row


class FakeFeed:
    def __init__(self, rows, fail=False):
        self.rows = rows
        self.fail = fail
        self.requests = []

    def __call__(self, params):
        symbols = params["symbols"].split(",")
        self.requests.append(params)
        if self.fail:
            raise RuntimeError("429 Too Many Requests")
        return {"quoteResponse": {"result": [r for r in self.rows if r["symbol"] in symbols]}}


class ParseExtendedQuoteTest(unittest.TestCase):
    def test_post_market_trade_after_the_close_is_used(self):
        quote = _parse_extended_quote(_row(postMarketPrice=24.27, postMarketTime=OCT13_POST))
        self.assertEqual(quote["price"], 24.27)
        self.assertEqual(quote["kind"], "post")
        self.assertEqual(quote["session"], "2026-10-13")

    def test_yesterdays_after_hours_price_is_not_todays(self):
        # Yahoo keeps postMarketPrice on the row through the next session.
        quote = _parse_extended_quote(_row(postMarketPrice=23.9, postMarketTime=OCT12_POST))
        self.assertIsNone(quote["price"])

    def test_the_later_of_pre_and_post_wins(self):
        quote = _parse_extended_quote(_row(
            postMarketPrice=24.27, postMarketTime=OCT13_POST,
            preMarketPrice=24.40, preMarketTime=OCT14_PRE,
        ))
        self.assertEqual((quote["price"], quote["kind"], quote["session"]),
                         (24.40, "pre", "2026-10-14"))

    def test_unusable_prices_are_ignored(self):
        for bad in (0, -1, None, "", "n/a", float("nan"), float("inf")):
            quote = _parse_extended_quote(_row(postMarketPrice=bad, postMarketTime=OCT13_POST))
            self.assertIsNone(quote["price"], bad)

    def test_a_trade_without_a_timestamp_is_ignored(self):
        self.assertIsNone(_parse_extended_quote(_row(postMarketPrice=24.27))["price"])

    def test_without_a_regular_session_print_there_is_nothing_to_order_against(self):
        quote = _parse_extended_quote({
            "symbol": "TDAX", "postMarketPrice": 24.27, "postMarketTime": OCT13_POST,
        })
        self.assertIsNone(quote["price"])

    def test_a_row_without_a_symbol_is_dropped(self):
        self.assertIsNone(_parse_extended_quote({"postMarketPrice": 1}))


class FetchExtendedQuotesTest(unittest.TestCase):
    def test_asks_for_the_extended_fields_in_one_request(self):
        feed = FakeFeed([_row("AAA", postMarketPrice=1.5, postMarketTime=OCT13_POST), _row("BBB")])
        quotes = fetch_extended_quotes(["bbb", "AAA", "AAA"], feed)
        self.assertEqual(len(feed.requests), 1)
        self.assertEqual(feed.requests[0]["symbols"], "AAA,BBB")
        self.assertEqual(feed.requests[0]["fields"], EXTENDED_QUOTE_FIELDS)
        self.assertEqual(quotes["AAA"]["price"], 1.5)
        self.assertIsNone(quotes["BBB"]["price"])

    def test_batches_of_fifty(self):
        symbols = [f"S{i:03d}" for i in range(120)]
        feed = FakeFeed([_row(s) for s in symbols])
        fetch_extended_quotes(symbols, feed)
        self.assertEqual([len(r["symbols"].split(",")) for r in feed.requests], [50, 50, 20])

    def test_a_failed_request_keeps_earlier_quotes_and_never_raises(self):
        symbols = [f"S{i:03d}" for i in range(60)]
        calls = {"n": 0}

        def request(params):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("429")
            return {"quoteResponse": {"result": [_row(s) for s in params["symbols"].split(",")]}}

        quotes = fetch_extended_quotes(symbols, request)
        self.assertEqual(len(quotes), 50)

    def test_a_cached_quote_is_not_requested_again(self):
        feed = FakeFeed([_row("BBB")])
        cached = {"symbol": "AAA", "price": 9.0, "time": OCT13_POST, "kind": "post",
                  "session": "2026-10-13"}
        remembered = {}
        quotes = fetch_extended_quotes(
            ["AAA", "BBB"], feed,
            recall=lambda s: cached if s == "AAA" else None,
            remember=lambda s, q: remembered.__setitem__(s, q),
        )
        self.assertEqual(feed.requests[0]["symbols"], "BBB")
        self.assertEqual(quotes["AAA"]["price"], 9.0)
        self.assertEqual(list(remembered), ["BBB"])


class WithSessionPriceTest(unittest.TestCase):
    def test_replaces_the_bar_for_that_session_only(self):
        series = _series({"2026-10-09": 23.0, "2026-10-12": 24.11, "2026-10-13": 24.008})
        out = with_session_price(series, LATEST, 24.27)
        self.assertEqual(closes_by_session(out), {
            date(2026, 10, 9): 23.0, date(2026, 10, 12): 24.11, date(2026, 10, 13): 24.27,
        })
        # The caller's series is not edited.
        self.assertEqual(closes_by_session(series)[LATEST], 24.008)

    def test_adds_the_bar_when_the_session_has_none(self):
        series = _series({"2026-10-09": 23.0, "2026-10-12": 24.11})
        self.assertEqual(closes_by_session(with_session_price(series, LATEST, 24.27))[LATEST], 24.27)

    def test_a_timezone_aware_index_keeps_its_timezone(self):
        tz = timezone(timedelta(hours=-4))
        idx = pd.date_range("2026-10-12", periods=2, freq="D", tz=tz)
        series = pd.Series([24.11, 24.008], index=idx, name="TDAX")
        out = with_session_price(series, LATEST, 24.27)
        self.assertEqual(out.name, "TDAX")
        self.assertIsNotNone(out.index.tz)
        self.assertEqual(closes_by_session(out)[LATEST], 24.27)

    def test_a_single_bar_series(self):
        out = with_session_price(_series({"2026-10-13": 24.008}), LATEST, 24.27)
        self.assertEqual(closes_by_session(out), {LATEST: 24.27})


class ApplyExtendedPricesTest(unittest.TestCase):
    def setUp(self):
        self.close_history = {
            "AAA": _series({"2026-10-12": 24.11, "2026-10-13": 24.008}),
            "BBB": _series({"2026-10-12": 30.30, "2026-10-13": 30.31}),
        }
        self.price_map = {"AAA": 24.008, "BBB": 30.31}

    def _apply(self, rows, **kwargs):
        feed = FakeFeed(rows)
        report = apply_extended_prices(
            self.price_map, self.close_history, kwargs.pop("symbols", {}), feed,
            latest=LATEST, **kwargs
        )
        return report, feed

    def test_after_hours_trade_reprices_and_feeds_the_day_change(self):
        before = {t: s.copy() for t, s in self.close_history.items()}
        report, _ = self._apply([_row("AAA", postMarketPrice=24.27, postMarketTime=OCT13_POST),
                                 _row("BBB")])
        self.assertEqual(self.price_map, {"AAA": 24.27, "BBB": 30.31})
        self.assertEqual(list(report["applied"]), ["AAA"])
        self.assertEqual(closes_by_session(report["change_history"]["AAA"])[LATEST], 24.27)
        self.assertNotIn("BBB", report["change_history"])
        # Dividend and DRIP maths read close_history: it must be byte-for-byte unchanged.
        for ticker, series in before.items():
            pd.testing.assert_series_equal(self.close_history[ticker], series)

    def test_a_stale_trade_from_an_earlier_session_is_ignored(self):
        self._apply([_row("AAA", regular_time=OCT13_CLOSE,
                          postMarketPrice=23.9, postMarketTime=OCT12_POST)])
        self.assertEqual(self.price_map["AAA"], 24.008)

    def test_a_trade_dated_before_the_latest_session_is_ignored(self):
        # Fund last printed regularly on Oct 12 (thin), and its only extended
        # trade was that evening: older than the latest session (Oct 13).
        report, _ = self._apply([_row("AAA", regular_time=_epoch(2026, 10, 12, 20, 0),
                                      postMarketPrice=23.9, postMarketTime=OCT12_POST)])
        self.assertEqual(self.price_map["AAA"], 24.008)
        self.assertEqual(report["applied"], {})

    def test_next_session_premarket_moves_the_price_but_not_the_day_change(self):
        report, _ = self._apply([_row("AAA", preMarketPrice=24.40, preMarketTime=OCT14_PRE)])
        self.assertEqual(self.price_map["AAA"], 24.40)
        self.assertEqual(report["applied"]["AAA"]["session"], "2026-10-14")
        self.assertEqual(report["change_history"], {})

    def test_never_prices_a_holding_the_regular_session_did_not(self):
        report, feed = self._apply([_row("ZZZ", postMarketPrice=5.0, postMarketTime=OCT13_POST)])
        self.assertNotIn("ZZZ", self.price_map)
        self.assertNotIn("ZZZ", feed.requests[0]["symbols"])

    def test_holdings_known_to_be_stale_are_skipped_and_not_requested(self):
        report, feed = self._apply(
            [_row("AAA", postMarketPrice=24.27, postMarketTime=OCT13_POST),
             _row("BBB", postMarketPrice=31.0, postMarketTime=OCT13_POST)],
            skip={"AAA": "2026-10-12"},
        )
        self.assertEqual(feed.requests[0]["symbols"], "BBB")
        self.assertEqual(self.price_map, {"AAA": 24.008, "BBB": 31.0})

    def test_other_calendars_are_never_requested(self):
        self.price_map.update({"BTC": 100.0, "PGDC": 1.1})
        self.close_history["BTC"] = _series({"2026-10-13": 100.0})
        self.close_history["PGDC"] = _series({"2026-10-13": 1.1})
        _, feed = self._apply(
            [_row("AAA"), _row("BBB")], symbols={"BTC": "BTC-USD", "PGDC": "PGDC.V"}
        )
        self.assertEqual(feed.requests[0]["symbols"], "AAA,BBB")

    def test_a_throttled_feed_leaves_every_price_alone(self):
        feed = FakeFeed([], fail=True)
        report = apply_extended_prices(
            self.price_map, self.close_history, {}, feed, latest=LATEST
        )
        self.assertEqual(self.price_map, {"AAA": 24.008, "BBB": 30.31})
        self.assertEqual(report["applied"], {})

    def test_no_prices_means_no_request(self):
        feed = FakeFeed([])
        apply_extended_prices({}, {}, {}, feed, latest=LATEST)
        self.assertEqual(feed.requests, [])

    def test_prices_are_written_only_once_every_ticker_has_been_handled(self):
        with patch("refresh_sessions.with_session_price", side_effect=ValueError("boom")):
            report, _ = self._apply([_row("AAA", postMarketPrice=24.27, postMarketTime=OCT13_POST)])
        # The price still applies; only its day-change series falls back.
        self.assertEqual(self.price_map["AAA"], 24.27)
        self.assertEqual(report["change_history"], {})


class _Base(unittest.TestCase):
    """A real refresh against a throwaway database and a one-fund Yahoo."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._get_connection()
        try:
            database_module.ensure_tables_exist(conn)
            conn.execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Kayden', 0)")
            conn.commit()
        finally:
            conn.close()
        self._saved = {
            name: getattr(app_module, name)
            for name in ("get_connection", "populate_holdings", "populate_dividends",
                         "populate_income_tracking")
        }
        self._orig_testing = app_module.app.testing
        app_module.get_connection = self._get_connection
        app_module.populate_holdings = lambda profile_id: None
        app_module.populate_dividends = lambda profile_id: None
        app_module.populate_income_tracking = lambda profile_id: None
        app_module.app.testing = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        for name, value in self._saved.items():
            setattr(app_module, name, value)
        app_module.app.testing = self._orig_testing
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _set_extended(self, enabled):
        res = self.client.post("/api/market-feed/extended-hours", json={"enabled": enabled})
        self.assertEqual(res.status_code, 200)


class ExtendedHoursSettingTest(_Base):
    def test_off_until_the_user_chooses_it(self):
        res = self.client.get("/api/market-feed/extended-hours")
        self.assertEqual(res.get_json(), {"ok": True, "enabled": False})
        self.assertFalse(app_module._extended_hours_setting())

    def test_the_choice_is_saved_and_can_be_taken_back(self):
        self._set_extended(True)
        self.assertTrue(self.client.get("/api/market-feed/extended-hours").get_json()["enabled"])
        self.assertTrue(app_module._extended_hours_setting())
        self._set_extended(False)
        self.assertFalse(app_module._extended_hours_setting())

    def test_a_missing_settings_table_reads_as_off(self):
        conn = self._get_connection()
        conn.execute("DROP TABLE settings")
        conn.commit()
        conn.close()
        self.assertFalse(app_module._extended_hours_setting())

    def test_a_bad_body_does_not_turn_it_on(self):
        self.client.post("/api/market-feed/extended-hours", data="not json",
                         content_type="text/plain")
        self.assertFalse(app_module._extended_hours_setting())


class RefreshWithExtendedHoursTest(_Base):
    QTY = 10

    def setUp(self):
        super().setUp()
        conn = self._get_connection()
        try:
            conn.execute(
                """INSERT INTO all_account_info
                   (ticker, profile_id, description, quantity, price_paid, current_price,
                    purchase_value, current_value, purchase_date, base_quantity, import_date,
                    div, div_frequency, reinvest)
                   VALUES ('UTF', 2, 'TEST FUND', ?, 20, 24.0, ?, ?, '2026-01-02', ?,
                           '2026-01-02', 0, 'M', 'N')""",
                (self.QTY, self.QTY * 20, self.QTY * 24.0, self.QTY),
            )
            conn.commit()
        finally:
            conn.close()

    def _quote_row(self, **fields):
        return _row("UTF", **fields)

    def _refresh(self, rows, *, forced=False, throttled=False):
        history = pd.DataFrame(
            {"Close": [24.11, 24.008], "Dividends": [0.0, 0.0]},
            index=pd.to_datetime(["2026-10-12", "2026-10-13"]),
        )
        report = {"sessions": (PRIOR, LATEST), "repriced": [], "stale": {}}

        def gateway_call(fn, **kwargs):
            if throttled:
                raise RuntimeError("429 Too Many Requests")
            return {"quoteResponse": {"result": rows}}

        patches = [
            patch.object(app_module, "_chunked_yf_download", return_value=history),
            patch.object(app_module, "_align_refresh_sessions", return_value=report),
            patch.object(app_module.yahoo_gateway, "call", side_effect=gateway_call),
            # The 120s quote cache is persisted to SQLite, which outlives a test;
            # without this a quote one test remembered answers the next one.
            patch.object(app_module.yahoo_gateway, "recall", return_value=None),
            patch.object(app_module.yahoo_gateway, "remember"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        if not forced:
            return self.client.post("/api/refresh?profile_id=2")
        with app_module.app.test_request_context("/api/refresh?profile_id=2", method="POST"):
            app_module._flask_g.regular_prices_only = True
            return app_module.refresh_market_data()

    def _price(self):
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT current_price, current_value FROM all_account_info WHERE ticker = 'UTF'"
            ).fetchone()
            return row["current_price"], row["current_value"]
        finally:
            conn.close()

    AFTER_HOURS = dict(postMarketPrice=24.27, postMarketTime=OCT13_POST)

    def test_default_behaviour_is_unchanged(self):
        res = self._refresh([self._quote_row(**self.AFTER_HOURS)])
        payload = res.get_json()
        self.assertEqual(res.status_code, 200)
        self.assertAlmostEqual(self._price()[0], 24.008, places=4)
        self.assertFalse(payload["extended_hours_enabled"])
        self.assertEqual(payload["extended_hours_applied"], [])
        # Prior close 24.11 -> close 24.008, ten shares.
        self.assertAlmostEqual(payload["daily_change"]["amount"], -1.02, places=2)
        self.assertNotIn("extended-hours", payload["message"])

    def test_opted_in_prices_from_the_after_hours_trade_and_day_change_follows(self):
        self._set_extended(True)
        res = self._refresh([self._quote_row(**self.AFTER_HOURS)])
        payload = res.get_json()
        self.assertEqual(res.status_code, 200)
        price, value = self._price()
        self.assertAlmostEqual(price, 24.27, places=4)
        self.assertAlmostEqual(value, 242.70, places=2)
        self.assertTrue(payload["extended_hours_enabled"])
        self.assertEqual(payload["extended_hours_applied"], ["UTF"])
        self.assertIn("1 holding priced from extended-hours trades", payload["message"])
        # Prior close 24.11 -> last trade 24.27, the way Schwab measures it.
        self.assertAlmostEqual(payload["daily_change"]["amount"], 1.60, places=2)
        self.assertTrue(payload["price_complete"])

    def test_opted_in_but_no_newer_trade_keeps_the_close(self):
        self._set_extended(True)
        res = self._refresh([self._quote_row(postMarketPrice=23.9, postMarketTime=OCT12_POST)])
        payload = res.get_json()
        self.assertAlmostEqual(self._price()[0], 24.008, places=4)
        self.assertEqual(payload["extended_hours_applied"], [])
        self.assertAlmostEqual(payload["daily_change"]["amount"], -1.02, places=2)

    def test_a_throttled_feed_falls_back_to_the_close_without_failing_the_refresh(self):
        self._set_extended(True)
        res = self._refresh([], throttled=True)
        self.assertEqual(res.status_code, 200)
        self.assertAlmostEqual(self._price()[0], 24.008, places=4)
        self.assertEqual(res.get_json()["extended_hours_applied"], [])

    def test_the_official_close_capture_is_never_given_after_hours_prices(self):
        self._set_extended(True)
        res = self._refresh([self._quote_row(**self.AFTER_HOURS)], forced=True)
        payload = res.get_json()
        self.assertAlmostEqual(self._price()[0], 24.008, places=4)
        self.assertFalse(payload["extended_hours_enabled"])
        self.assertEqual(payload["extended_hours_applied"], [])


class OfficialCloseProtectionTest(_Base):
    def _add_nav(self, source):
        today = datetime.date.today().isoformat()
        conn = self._get_connection()
        try:
            conn.execute(
                "INSERT INTO portfolio_nav (profile_id, nav_date, total_value, source) "
                "VALUES (2, ?, 1000, ?)", (today, source),
            )
            conn.commit()
        finally:
            conn.close()

    def _record_nav(self):
        snap = MagicMock(return_value=1234.0)
        with patch.object(app_module, "nyse_closure_reason", return_value=None), \
             patch.object(app_module, "snapshot_nav", snap):
            res = self.client.post("/api/nav/snapshot?profile_id=2")
        return res.get_json(), snap

    def test_auto_capture_forces_regular_session_prices_during_its_refresh(self):
        seen = {}

        def refresh():
            seen["forced"] = app_module._regular_prices_forced()
            response = MagicMock()
            response.status_code = 200
            response.get_json.return_value = {"price_failures": [], "price_complete": True}
            return response

        et = timezone(timedelta(hours=-4))
        now = datetime.datetime(2026, 7, 1, 16, 30, tzinfo=et)
        with patch.object(app_module, "eastern_now", return_value=now), \
             patch.object(app_module, "is_nyse_trading_day", return_value=True), \
             patch.object(app_module, "market_has_closed", return_value=True), \
             patch.object(app_module, "refresh_market_data", side_effect=refresh), \
             patch.object(app_module, "snapshot_nav", MagicMock(return_value=1000.0)):
            res = self.client.post("/api/nav/auto-capture?profile_id=2")
        self.assertTrue(res.get_json()["captured"])
        self.assertTrue(seen["forced"])

    def _auto_capture(self, *, payload=None, cooling=False, restore_raises=False):
        """Run the capture; returns (response json, ordered event log)."""
        events = []
        payload = payload or {"price_failures": [], "price_complete": True}

        def refresh():
            forced = app_module._regular_prices_forced()
            events.append("refresh:regular" if forced else "refresh:extended")
            if restore_raises and not forced:
                raise RuntimeError("yahoo fell over")
            response = MagicMock()
            response.status_code = 200
            response.get_json.return_value = payload
            return response

        def snap(pid, **kwargs):
            events.append(f"snapshot:{kwargs.get('source')}")
            return 1000.0

        et = timezone(timedelta(hours=-4))
        now = datetime.datetime(2026, 7, 1, 16, 30, tzinfo=et)
        state = {"cooling_down": cooling}
        with patch.object(app_module, "eastern_now", return_value=now), \
             patch.object(app_module, "is_nyse_trading_day", return_value=True), \
             patch.object(app_module, "market_has_closed", return_value=True), \
             patch.object(app_module, "refresh_market_data", side_effect=refresh), \
             patch.object(app_module, "_nav_snapshot_profile_ids", return_value=[2]), \
             patch.object(app_module.yahoo_gateway, "breaker_state", return_value=state), \
             patch.object(app_module, "snapshot_nav", side_effect=snap):
            res = self.client.post("/api/nav/auto-capture?profile_id=2")
        return res.get_json(), events

    def test_after_the_close_is_stamped_the_extended_prices_are_put_back(self):
        self._set_extended(True)
        payload, events = self._auto_capture()
        self.assertTrue(payload["captured"])
        # Order matters: the snapshot reads the holdings table, so the restore
        # must come after it or the "close" would be an after-hours value.
        self.assertEqual(events, ["refresh:regular", "snapshot:close", "refresh:extended"])

    def test_with_the_option_off_the_capture_refreshes_once_as_before(self):
        payload, events = self._auto_capture()
        self.assertTrue(payload["captured"])
        self.assertEqual(events, ["refresh:regular", "snapshot:close"])

    def test_an_incomplete_capture_also_puts_the_extended_prices_back(self):
        self._set_extended(True)
        payload, events = self._auto_capture(
            payload={"price_failures": ["AAA"], "price_complete": False}
        )
        self.assertFalse(payload["captured"])
        self.assertEqual(events, ["refresh:regular", "refresh:extended"])

    def test_no_second_refresh_while_yahoo_is_cooling_down(self):
        self._set_extended(True)
        payload, events = self._auto_capture(cooling=True)
        self.assertTrue(payload["captured"])
        self.assertEqual(events, ["refresh:regular", "snapshot:close"])

    def test_a_failed_restore_does_not_undo_the_capture(self):
        self._set_extended(True)
        payload, events = self._auto_capture(restore_raises=True)
        self.assertTrue(payload["captured"])
        self.assertEqual(payload["value"], 1000.0)
        self.assertEqual(events, ["refresh:regular", "snapshot:close", "refresh:extended"])

    def test_the_force_flag_is_scoped_to_one_request(self):
        with app_module.app.test_request_context("/"):
            app_module._flask_g.regular_prices_only = True
            self.assertTrue(app_module._regular_prices_forced())
        with app_module.app.test_request_context("/"):
            self.assertFalse(app_module._regular_prices_forced())
        # No app context at all (a background thread): not forced, no error.
        self.assertFalse(app_module._regular_prices_forced())

    def test_extended_active_needs_the_setting_and_no_force(self):
        with patch.object(app_module, "_extended_hours_setting", return_value=True):
            with app_module.app.test_request_context("/"):
                self.assertTrue(app_module._extended_hours_active())
                app_module._flask_g.regular_prices_only = True
                self.assertFalse(app_module._extended_hours_active())
        with patch.object(app_module, "_extended_hours_setting", return_value=False):
            with app_module.app.test_request_context("/"):
                self.assertFalse(app_module._extended_hours_active())

    def test_manual_record_nav_will_not_replace_the_close_when_extended_is_on(self):
        self._add_nav("close")
        self._set_extended(True)
        payload, snap = self._record_nav()
        self.assertTrue(payload["skipped"])
        self.assertIn("official closing NAV", payload["reason"])
        snap.assert_not_called()

    def test_manual_record_nav_is_unchanged_when_extended_is_off(self):
        self._add_nav("close")
        payload, snap = self._record_nav()
        self.assertFalse(payload.get("skipped", False))
        snap.assert_called()

    def test_manual_record_nav_is_unchanged_when_no_close_exists_yet(self):
        self._add_nav("snapshot")
        self._set_extended(True)
        payload, snap = self._record_nav()
        self.assertFalse(payload.get("skipped", False))
        snap.assert_called()


if __name__ == "__main__":
    unittest.main()
