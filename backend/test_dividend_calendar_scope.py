import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database


class DividendCalendarScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._connect()
        database.ensure_tables_exist(conn)
        conn.executemany(
            "INSERT OR REPLACE INTO profiles (id, name, include_in_owner) VALUES (?, ?, ?)",
            [
                (1, "Owner", 0),
                (6, "Broker A", 1),
                (7, "Broker B", 1),
                (12, "Other user", 0),
            ],
        )
        self._holding(conn, 1, "AAA", 999)  # duplicated Owner snapshot
        self._holding(conn, 6, "AAA", 10)
        self._holding(conn, 6, "BBB", 20)
        self._holding(conn, 7, "AAA", 5)
        self._holding(conn, 7, "CCC", 30)
        self._holding(conn, 12, "DDD", 40)

        today = datetime.date.today()
        actual_date = (today - datetime.timedelta(days=30)).isoformat()
        estimated_date = (today - datetime.timedelta(days=20)).isoformat()
        future_date = (today + datetime.timedelta(days=1)).isoformat()
        conn.executemany(
            """INSERT OR REPLACE INTO dividend_payments
               (ticker, profile_id, payment_date, amount, source)
               VALUES (?, ?, ?, ?, ?)""",
            [
                ("AAA", 6, actual_date, 1.0, "schwab_transactions"),
                ("AAA", 6, estimated_date, 1.0, "refresh_estimate"),
                ("AAA", 6, future_date, 1.0, "schwab_transactions"),
                ("CCC", 7, actual_date, 1.0, "fidelity"),
                ("DDD", 12, actual_date, 1.0, "etrade_transactions"),
            ],
        )
        conn.commit()
        conn.close()
        self.actual_date = actual_date

    def tearDown(self):
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except OSError:
            pass

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _holding(conn, profile_id, ticker, quantity):
        conn.execute(
            """INSERT OR REPLACE INTO all_account_info
               (ticker, profile_id, description, quantity, current_price,
                current_value, div, div_frequency, estim_payment_per_year)
               VALUES (?, ?, ?, ?, 10, ?, 1, 'M', ?)""",
            (ticker, profile_id, f"{ticker} fund", quantity, quantity * 10, quantity * 12),
        )

    def _rows(self, is_aggregate, profile_ids):
        conn = self._connect()
        try:
            return app_module._dividend_calendar_holdings_for_view(
                conn, is_aggregate, profile_ids
            )
        finally:
            conn.close()

    def test_owner_uses_linked_accounts_without_duplicate_snapshot(self):
        rows = {row["ticker"]: row for row in self._rows(False, [1])}
        self.assertEqual(set(rows), {"AAA", "BBB", "CCC"})
        self.assertEqual(rows["AAA"]["quantity"], 15)
        self.assertEqual(rows["AAA"]["profile_count"], 2)
        self.assertEqual(rows["AAA"]["payment_history"], [self.actual_date])

    def test_individual_account_keeps_its_own_tickers_and_dates(self):
        rows = {row["ticker"]: row for row in self._rows(False, [6])}
        self.assertEqual(set(rows), {"AAA", "BBB"})
        self.assertEqual(rows["AAA"]["quantity"], 10)
        self.assertEqual(rows["AAA"]["payment_history"], [self.actual_date])

    def test_aggregate_unions_only_configured_members(self):
        rows = {row["ticker"]: row for row in self._rows(True, [6, 12])}
        self.assertEqual(set(rows), {"AAA", "BBB", "DDD"})
        self.assertNotIn("CCC", rows)
        self.assertEqual(rows["DDD"]["payment_history"], [self.actual_date])


if __name__ == "__main__":
    unittest.main()
