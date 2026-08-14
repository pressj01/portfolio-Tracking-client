"""The Optimization tab's candidate universe.

Everything held in the selected account already reaches that tab as a calendar
event. The point of this endpoint is the rest of what the app knows about -- the
watchlist, positions held in another account, and tickers held previously --
because without those the panel can only ever recommend funds already owned.
"""

import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database as database_module


class DividendCalendarCandidatesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._get_connection()
        try:
            database_module.ensure_tables_exist(conn)
            conn.executemany(
                "INSERT OR REPLACE INTO profiles (id, name, include_in_owner) VALUES (?, ?, ?)",
                [(1, "Owner", 0), (2, "Taxable", 1), (3, "IRA", 1), (4, "Spouse", 0)],
            )
            # HELD is in the viewed account; ELSEWHERE only in another one.
            self._holding(conn, 2, "HELD", 100, "M", "07/02/26", "07/06/26", 0.50)
            self._holding(conn, 3, "ELSEWHERE", 40, "Q", "06/15/26", "06/18/26", 0.75)
            conn.execute(
                "INSERT INTO watchlist_watching (ticker, notes, added_date, sort_order)"
                " VALUES ('WATCHED', '', '2026-08-01', 0)"
            )
            conn.execute(
                """INSERT INTO dividend_schedule_history
                   (ticker, profile_id, ex_div_date, pay_date, frequency, source)
                   VALUES ('SOLD', 4, '01/08/26', '01/10/26', 'M', 'refresh')"""
            )
            conn.execute(
                "INSERT INTO general_scanner_cache (ticker, name, price) "
                "VALUES ('WATCHED', 'Watched Income ETF', 21.5)"
            )
            conn.commit()
        finally:
            conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _holding(conn, profile_id, ticker, quantity, freq, ex_div, pay_date, div):
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, description, quantity, current_price, current_value,
                div, div_frequency, ex_div_date, div_pay_date)
               VALUES (?, ?, ?, ?, 20, ?, ?, ?, ?, ?)""",
            (
                ticker, profile_id, f"{ticker} Fund", quantity, quantity * 20,
                div, freq, ex_div, pay_date,
            ),
        )

    def _candidates(self, query=""):
        res = self.client.get(f"/api/div-calendar/candidates{query}")
        self.assertEqual(res.status_code, 200, res.get_json())
        return {row["ticker"]: row for row in res.get_json()["candidates"]}

    def test_ticker_held_in_the_viewed_account_is_not_a_candidate(self):
        rows = self._candidates("?profile_id=2")

        self.assertNotIn("HELD", rows)
        self.assertIn("ELSEWHERE", rows)

    def test_same_ticker_becomes_a_candidate_from_an_account_without_it(self):
        rows = self._candidates("?profile_id=4")

        self.assertIn("HELD", rows)
        self.assertTrue(rows["HELD"]["owned"])
        self.assertEqual(rows["HELD"]["owned_quantity"], 100)

    def test_owner_view_excludes_everything_its_source_accounts_hold(self):
        rows = self._candidates("?profile_id=1")

        self.assertNotIn("HELD", rows)
        self.assertNotIn("ELSEWHERE", rows)

    def test_watchlist_ticker_is_offered_with_its_quoted_price(self):
        rows = self._candidates("?profile_id=2")

        self.assertIn("WATCHED", rows)
        self.assertTrue(rows["WATCHED"]["watchlist"])
        self.assertFalse(rows["WATCHED"]["owned"])
        self.assertEqual(rows["WATCHED"]["current_price"], 21.5)
        self.assertEqual(rows["WATCHED"]["description"], "Watched Income ETF")
        # Nothing knows its schedule, so it is tracked rather than ranked.
        self.assertFalse(rows["WATCHED"]["has_schedule"])

    def test_previously_held_ticker_keeps_its_recorded_schedule(self):
        rows = self._candidates("?profile_id=2")

        self.assertIn("SOLD", rows)
        self.assertEqual(rows["SOLD"]["freq"], "M")
        self.assertTrue(rows["SOLD"]["has_schedule"])

    def test_stale_pay_date_is_rolled_up_to_the_next_occurrence(self):
        # The tab walks this date forward itself but gives up after 80 cycles,
        # which a ticker last held two years ago would exhaust.
        rows = self._candidates("?profile_id=2")

        pay_date = datetime.date.fromisoformat(rows["SOLD"]["pay_date"])
        self.assertGreaterEqual(pay_date, datetime.date.today())
        self.assertEqual(pay_date.day, 10)

    def test_schedule_comes_from_the_largest_position_in_any_account(self):
        conn = self._get_connection()
        try:
            self._holding(conn, 4, "ELSEWHERE", 500, "M", "07/09/26", "07/11/26", 0.20)
            conn.commit()
        finally:
            conn.close()

        rows = self._candidates("?profile_id=2")

        self.assertEqual(rows["ELSEWHERE"]["freq"], "M")
        self.assertEqual(rows["ELSEWHERE"]["amount"], 0.20)

    def test_each_ticker_appears_once(self):
        conn = self._get_connection()
        try:
            self._holding(conn, 4, "ELSEWHERE", 5, "Q", "06/15/26", "06/18/26", 0.75)
            conn.commit()
        finally:
            conn.close()

        res = self.client.get("/api/div-calendar/candidates?profile_id=2")
        tickers = [row["ticker"] for row in res.get_json()["candidates"]]

        self.assertEqual(len(tickers), len(set(tickers)))


if __name__ == "__main__":
    unittest.main()
