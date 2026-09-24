import sys
import unittest
from datetime import date, datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refresh_sessions import (
    _with_bars,
    align_to_sessions,
    closes_by_session,
    current_sessions,
    fetch_quotes,
    on_nyse_calendar,
)

# Epochs of real Yahoo quotes from 2026-09-23.
SEP23_CLOSE = 1790193586   # 15:59:46 ET on Sep 23
SEP22_CLOSE = 1790107200   # 16:00:00 ET on Sep 22
EVENING_SEP23 = datetime(2026, 9, 23, 18, 35)


def _series(bars):
    return pd.Series(list(bars.values()), index=pd.to_datetime(list(bars)), dtype=float)


class FakeQuoteFeed:
    def __init__(self, rows, fail=False):
        self.rows = rows
        self.fail = fail
        self.requests = []

    def __call__(self, params):
        symbols = params["symbols"].split(",")
        self.requests.append(symbols)
        if self.fail:
            raise RuntimeError("429 Too Many Requests")
        return {"quoteResponse": {"result": [r for r in self.rows if r["symbol"] in symbols]}}


class CurrentSessionsTest(unittest.TestCase):
    def test_latest_is_today_once_the_bell_has_rung(self):
        self.assertEqual(current_sessions(EVENING_SEP23), (date(2026, 9, 22), date(2026, 9, 23)))
        self.assertEqual(
            current_sessions(datetime(2026, 9, 23, 9, 30)),
            (date(2026, 9, 22), date(2026, 9, 23)),
        )

    def test_before_the_open_latest_is_the_previous_session(self):
        self.assertEqual(
            current_sessions(datetime(2026, 9, 23, 8, 0)),
            (date(2026, 9, 21), date(2026, 9, 22)),
        )

    def test_monday_pairs_with_friday_and_weekends_with_thursday_friday(self):
        self.assertEqual(
            current_sessions(datetime(2026, 9, 21, 10, 0)),
            (date(2026, 9, 18), date(2026, 9, 21)),
        )
        self.assertEqual(
            current_sessions(datetime(2026, 9, 26, 12, 0)),
            (date(2026, 9, 24), date(2026, 9, 25)),
        )

    def test_market_holidays_are_skipped(self):
        # Thanksgiving 2026 is Nov 26.
        self.assertEqual(
            current_sessions(datetime(2026, 11, 27, 10, 0)),
            (date(2026, 11, 25), date(2026, 11, 27)),
        )
        self.assertEqual(
            current_sessions(datetime(2026, 11, 26, 12, 0)),
            (date(2026, 11, 24), date(2026, 11, 25)),
        )


class OnNyseCalendarTest(unittest.TestCase):
    def test_us_listings_including_share_classes_and_preferreds(self):
        for symbol in ("SPYI", "BRK-B", "CIM-PB", "ltnc"):
            self.assertTrue(on_nyse_calendar(symbol), symbol)

    def test_other_calendars(self):
        for symbol in ("PGDC.V", "SHOP.TO", "BTC-USD", "ETH-USDT", "CAD=X", "^GSPC", ""):
            self.assertFalse(on_nyse_calendar(symbol), symbol)


class AlignToSessionsTest(unittest.TestCase):
    def setUp(self):
        self.close_history = {
            # Yahoo's 9/23 evening state: no 9/22 bar, and no 9/23 bar yet.
            "ISBG": _series({"2026-09-18": 16.20, "2026-09-21": 17.20}),
            # Complete: must not be quoted at all.
            "QQQI": _series({"2026-09-21": 55.90, "2026-09-22": 55.83, "2026-09-23": 55.55}),
            # Today's bar is in but the 9/22 hole is not.
            "FBDC": _series({"2026-09-21": 17.393, "2026-09-23": 17.16}),
            # OTC name that simply did not trade on 9/23.
            "LTNC": _series({"2026-09-21": 0.0001, "2026-09-22": 0.0001}),
            # Yahoo returns no quote for it.
            "GONE": _series({"2026-09-18": 10.0, "2026-09-21": 11.0}),
            # Another exchange's calendar: left alone.
            "PGDC": _series({"2026-09-18": 1.10}),
        }
        self.symbols = {"PGDC": "PGDC.V"}
        self.feed = FakeQuoteFeed([
            {"symbol": "ISBG", "regularMarketPrice": 16.34, "regularMarketTime": SEP23_CLOSE,
             "regularMarketPreviousClose": 17.2752},
            {"symbol": "FBDC", "regularMarketPrice": 17.16, "regularMarketTime": SEP23_CLOSE,
             "regularMarketPreviousClose": 17.348},
            {"symbol": "LTNC", "regularMarketPrice": 0.0001, "regularMarketTime": SEP22_CLOSE,
             "regularMarketPreviousClose": 0.0001},
        ])

    def _align(self, **kwargs):
        return align_to_sessions(
            self.close_history, self.symbols, self.feed, now_et=EVENING_SEP23, **kwargs
        )

    def test_quotes_only_the_gaps_in_one_request(self):
        self._align()
        self.assertEqual(self.feed.requests, [["FBDC", "GONE", "ISBG", "LTNC"]])

    def test_a_stale_chart_is_repriced_from_the_quote(self):
        report = self._align()
        closes = closes_by_session(self.close_history["ISBG"])
        self.assertEqual(closes[date(2026, 9, 23)], 16.34)
        self.assertEqual(closes[date(2026, 9, 22)], 17.2752)
        self.assertEqual(float(self.close_history["ISBG"].iloc[-1]), 16.34)
        self.assertIn("ISBG", report["repriced"])
        self.assertEqual(report["sessions"], (date(2026, 9, 22), date(2026, 9, 23)))

    def test_a_hole_on_the_prior_session_takes_the_quoted_previous_close(self):
        report = self._align()
        closes = closes_by_session(self.close_history["FBDC"])
        self.assertEqual(closes[date(2026, 9, 22)], 17.348)
        self.assertEqual(closes[date(2026, 9, 23)], 17.16)
        self.assertNotIn("FBDC", report["repriced"])

    def test_no_trade_since_the_last_print_carries_that_price(self):
        report = self._align()
        closes = closes_by_session(self.close_history["LTNC"])
        self.assertEqual(closes[date(2026, 9, 23)], 0.0001)
        self.assertNotIn("LTNC", report["stale"])

    def test_unquoted_holdings_are_reported_stale_and_left_untouched(self):
        before = self.close_history["GONE"].copy()
        report = self._align()
        self.assertEqual(report["stale"], {"GONE": "2026-09-21"})
        pd.testing.assert_series_equal(self.close_history["GONE"], before)

    def test_other_calendars_are_not_quoted_or_flagged(self):
        report = self._align()
        self.assertNotIn("PGDC", report["stale"])
        self.assertNotIn("PGDC.V", self.feed.requests[0])

    def test_nothing_is_requested_when_every_bar_is_present(self):
        feed = FakeQuoteFeed([])
        report = align_to_sessions({"QQQI": self.close_history["QQQI"]}, {}, feed, now_et=EVENING_SEP23)
        self.assertEqual(feed.requests, [])
        self.assertEqual(report["stale"], {})

    def test_a_quote_older_than_the_chart_changes_nothing(self):
        feed = FakeQuoteFeed([
            {"symbol": "FBDC", "regularMarketPrice": 99.0, "regularMarketTime": SEP22_CLOSE,
             "regularMarketPreviousClose": 98.0},
        ])
        history = {"FBDC": self.close_history["FBDC"].copy()}
        report = align_to_sessions(history, {}, feed, now_et=EVENING_SEP23)
        self.assertEqual(report["repriced"], [])
        self.assertEqual(float(history["FBDC"].iloc[-1]), 17.16)

    def test_a_failed_quote_request_leaves_the_chart_and_flags_the_gaps(self):
        feed = FakeQuoteFeed([], fail=True)
        before = self.close_history["ISBG"].copy()
        report = align_to_sessions(self.close_history, self.symbols, feed, now_et=EVENING_SEP23)
        pd.testing.assert_series_equal(self.close_history["ISBG"], before)
        self.assertEqual(set(report["stale"]), {"GONE", "ISBG", "LTNC"})


class FetchQuotesTest(unittest.TestCase):
    def test_cached_quotes_skip_the_request_and_new_ones_are_remembered(self):
        cached = {"session": "2026-09-23", "price": 1.0, "previous_close": 1.0, "symbol": "AAA"}
        remembered = {}
        feed = FakeQuoteFeed([
            {"symbol": "BBB", "regularMarketPrice": 2.0, "regularMarketTime": SEP23_CLOSE},
        ])
        quotes = fetch_quotes(
            ["aaa", "BBB"],
            feed,
            recall=lambda s: cached if s == "AAA" else None,
            remember=lambda s, q: remembered.__setitem__(s, q),
        )
        self.assertEqual(feed.requests, [["BBB"]])
        self.assertEqual(quotes["AAA"], cached)
        self.assertEqual(quotes["BBB"]["session"], "2026-09-23")
        self.assertIsNone(quotes["BBB"]["previous_close"])
        self.assertEqual(set(remembered), {"BBB"})

    def test_a_failure_stops_the_sweep(self):
        feed = FakeQuoteFeed([], fail=True)
        symbols = [f"T{i:03d}" for i in range(120)]
        self.assertEqual(fetch_quotes(symbols, feed), {})
        self.assertEqual(len(feed.requests), 1)

    def test_rows_without_a_price_or_time_are_ignored(self):
        feed = FakeQuoteFeed([
            {"symbol": "AAA", "regularMarketPrice": 0, "regularMarketTime": SEP23_CLOSE},
            {"symbol": "BBB", "regularMarketPrice": 5.0},
        ])
        self.assertEqual(fetch_quotes(["AAA", "BBB"], feed), {})


class WithBarsTest(unittest.TestCase):
    def test_keeps_a_tz_aware_index_and_never_replaces_a_bar(self):
        index = pd.DatetimeIndex(["2026-09-21", "2026-09-23"]).tz_localize("America/New_York")
        series = pd.Series([1.0, 3.0], index=index, name="X")
        out = _with_bars(series, {date(2026, 9, 22): 2.0, date(2026, 9, 23): 99.0})
        self.assertEqual(list(out), [1.0, 2.0, 3.0])
        self.assertIsNotNone(out.index.tz)
        self.assertEqual(out.name, "X")


if __name__ == "__main__":
    unittest.main()
