import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database

TODAY = datetime.date(2026, 11, 2)


class TtmIncomeByHeldTickerTest(unittest.TestCase):
    """Income column on the Dashboard Portfolio overview."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._connect()
        database.ensure_tables_exist(conn)
        conn.executemany(
            "INSERT OR REPLACE INTO profiles (id, name, include_in_owner) VALUES (?, ?, ?)",
            [(1, "Owner", 0), (6, "Broker A", 1), (7, "Broker B", 1), (12, "Other", 0)],
        )
        conn.execute("UPDATE profiles SET owner_active = 1 WHERE id = 1")
        # $365 a year makes the prorated estimate $1 per uncovered day.
        self._holding(conn, 6, "AAA", 365, "2020-01-01")
        self._holding(conn, 6, "BBB", 365, "2020-01-01")
        self._holding(conn, 7, "AAA", 365, "2020-01-01")
        self._holding(conn, 7, "CCC", 365, "2026-08-01")
        self._holding(conn, 12, "DDD", 120, "2020-01-01")
        conn.executemany(
            """INSERT OR REPLACE INTO dividend_payments
               (ticker, profile_id, payment_date, amount, source,
                coverage_start_date, coverage_end_date)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                # Account 6 is imported through today.
                ("AAA", 6, "2024-01-15", 99.0, "schwab", None, None),
                ("AAA", 6, "2025-11-02", 99.0, "schwab", None, None),   # start excluded
                ("AAA", 6, "2025-11-03", 10.0, "schwab", None, None),
                ("AAA", 6, "2026-11-02", 20.0, "schwab", None, None),
                ("AAA", 6, "2026-11-03", 99.0, "schwab", None, None),   # future
                ("AAA", 6, "2026-10-15", 99.0, "refresh_estimate", None, None),
                ("ZZZ", 6, "2026-06-01", 99.0, "schwab", None, None),   # sold
                # Account 7's imports stop on 2026-05-01.
                ("AAA", 7, "2026-05-01", 50.0, "fidelity", "2025-01-01", "2026-05-01"),
            ],
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        Path(self.db_path).unlink(missing_ok=True)

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _holding(conn, profile_id, ticker, annual, purchase_date):
        conn.execute(
            """INSERT OR REPLACE INTO all_account_info
               (ticker, profile_id, description, quantity, current_price,
                current_value, estim_payment_per_year, purchase_date)
               VALUES (?, ?, ?, 10, 10, 100, ?, ?)""",
            (ticker, profile_id, ticker, annual, purchase_date),
        )

    def _ttm(self, is_aggregate, profile_ids):
        conn = self._connect()
        try:
            return app_module._ttm_dividend_income_by_held_ticker(
                conn, is_aggregate, profile_ids, today=TODAY
            )
        finally:
            conn.close()

    def test_window_is_365_days_with_start_excluded(self):
        result = self._ttm(False, [6])
        self.assertEqual(result["start_date"], "2025-11-03")
        self.assertEqual(result["end_date"], "2026-11-02")
        # 10 + 20: the start-day, future, estimate and sold-ticker rows are out.
        self.assertEqual(result["by_ticker"], {"AAA": 30.0, "BBB": 0.0})
        self.assertEqual(result["estimated_by_ticker"], {})
        self.assertEqual(result["total"], 30.0)

    def test_days_past_an_accounts_imports_use_the_prorated_estimate(self):
        result = self._ttm(False, [7])
        # Covered 2025-11-03..2026-05-01 is 180 days, leaving 185 estimated.
        # CCC was bought 2026-08-01, after the imports stop: 94 held days.
        self.assertEqual(result["by_ticker"], {"AAA": 50.0 + 185.0, "CCC": 94.0})
        self.assertEqual(result["estimated_by_ticker"], {"AAA": 185.0, "CCC": 94.0})
        self.assertEqual(result["estimated_total"], 279.0)

    def test_account_without_a_ledger_is_its_full_estimate(self):
        result = self._ttm(False, [12])
        self.assertEqual(result["by_ticker"], {"DDD": 120.0})
        self.assertEqual(result["estimated_total"], 120.0)

    def test_owner_sums_its_linked_accounts_only(self):
        result = self._ttm(False, [1])
        self.assertEqual(
            result["by_ticker"],
            {"AAA": 30.0 + 235.0, "BBB": 0.0, "CCC": 94.0},
        )
        self.assertEqual(result["total"], 359.0)
        self.assertNotIn("DDD", result["by_ticker"])
        self.assertNotIn("ZZZ", result["by_ticker"])

    def test_route_returns_the_view_scope(self):
        # Account 12 has no ledger, so its figure does not depend on today.
        with patch.object(app_module, "get_connection", self._connect):
            response = app_module.app.test_client().get(
                "/api/holdings/ttm-income?profile_id=12"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["by_ticker"], {"DDD": 120.0})


if __name__ == "__main__":
    unittest.main()
