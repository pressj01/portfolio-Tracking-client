"""Dividend History must sum linked-account payments when viewing Owner."""

import sqlite3
import tempfile
import unittest
from pathlib import Path

import app as app_module
import database


class DividendHistoryOwnerScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute("UPDATE profiles SET owner_active = 1 WHERE id = 1")
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (2, 'Roth')")
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (3, 'Taxable')")
        conn.execute("UPDATE profiles SET include_in_owner = 1 WHERE id IN (2, 3)")
        # Stale Owner payout tables — incomplete and should be ignored once
        # linked-account dividend_payments exist.
        conn.execute(
            "INSERT INTO monthly_payouts (year, month, amount, profile_id) "
            "VALUES (2025, 6, 1000, 1), (2026, 1, 500, 1), (2026, 2, 500, 1)"
        )
        conn.execute(
            "INSERT INTO weekly_payouts (pay_date, amount, profile_id) "
            "VALUES ('2026-02-01', 200, 1)"
        )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        app_module.get_connection = self._connect
        app_module.app.testing = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        try:
            Path(self.db_path).unlink()
        except OSError:
            pass

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _pay(self, date, ticker, amount, profile_id, source="schwab_transactions"):
        conn = self._connect()
        conn.execute(
            "INSERT INTO dividend_payments "
            "(ticker, profile_id, payment_date, amount, source) VALUES (?, ?, ?, ?, ?)",
            (ticker, profile_id, date, amount, source),
        )
        conn.commit()
        conn.close()

    def _history(self, view="yearly", **params):
        query = "&".join(f"{k}={v}" for k, v in {"view": view, **params}.items())
        res = self.client.get(f"/api/dividend-history/data?profile_id=1&{query}")
        self.assertEqual(res.status_code, 200)
        return res.get_json()

    def test_owner_yearly_sums_linked_account_payments_not_stale_payouts(self):
        self._pay("2025-03-15", "SCHD", 40.00, profile_id=2)
        self._pay("2025-06-15", "JEPI", 60.00, profile_id=3)
        self._pay("2026-04-15", "SCHD", 45.00, profile_id=2)
        self._pay("2026-07-15", "JEPI", 55.00, profile_id=3)

        payload = self._history(view="yearly")
        by_label = dict(zip(payload["series"]["labels"], payload["series"]["values"]))
        self.assertEqual(by_label["2025"], 100.00)
        self.assertEqual(by_label["2026 YTD"], 100.00)
        # Stale Owner monthly_payouts (2025=$1000, 2026=$1000) must not win.
        self.assertNotIn(1000.0, payload["series"]["values"])

    def test_owner_weekly_uses_linked_account_payments(self):
        self._pay("2026-08-06", "SCHD", 40.00, profile_id=2)
        self._pay("2026-09-10", "JEPI", 60.00, profile_id=3)

        payload = self._history(view="weekly", months_back=6)
        self.assertGreater(len(payload["series"]["labels"]), 0)
        self.assertEqual(payload["summary"]["total"], 100.00)

    def test_weekly_buckets_payment_days_into_calendar_weeks(self):
        # Thursday + Friday in the same week must become one weekly total,
        # not two daily points that make MIN look like a $12 payday.
        self._pay("2026-08-06", "SCHD", 12.00, profile_id=2)
        self._pay("2026-08-07", "JEPI", 88.00, profile_id=3)
        self._pay("2026-08-13", "SCHD", 50.00, profile_id=2)

        payload = self._history(view="weekly", months_back=6)
        self.assertEqual(payload["summary"]["total"], 150.00)
        self.assertEqual(payload["summary"]["min"], 50.00)
        self.assertEqual(payload["summary"]["max"], 100.00)
        self.assertEqual(len(payload["series"]["labels"]), 2)
        self.assertTrue(all("2026-08-" not in label for label in payload["series"]["labels"]))

    def test_monthly_summary_ignores_incomplete_current_month(self):
        import datetime

        today = datetime.date.today()
        prior = (today.replace(day=1) - datetime.timedelta(days=1))
        older = (prior.replace(day=1) - datetime.timedelta(days=1))

        self._pay(f"{older.year:04d}-{older.month:02d}-10", "SCHD", 8000.00, profile_id=2)
        self._pay(f"{prior.year:04d}-{prior.month:02d}-10", "JEPI", 9000.00, profile_id=3)
        self._pay(today.isoformat(), "SCHD", 500.00, profile_id=2)

        payload = self._history(view="monthly", months_back=12)
        self.assertTrue(payload["series"]["labels"][-1].endswith("MTD"))
        self.assertTrue(payload["series"]["partial_periods"][-1])
        # TOTAL still includes MTD cash received.
        self.assertEqual(payload["summary"]["total"], 17500.00)
        # MIN/MAX/AVERAGE stay on completed months only.
        self.assertEqual(payload["summary"]["min"], 8000.00)
        self.assertEqual(payload["summary"]["max"], 9000.00)
        self.assertEqual(payload["summary"]["average"], 8500.00)
        self.assertEqual(payload["summary"]["stats_basis"], "completed periods")

    def test_weekly_summary_uses_only_full_calendar_weeks(self):
        import datetime

        from dividend_ledger import week_start_for

        today = datetime.date.today()
        current_week = week_start_for(today)
        # Two completed weeks before the current one.
        week_a = current_week - datetime.timedelta(days=14)
        week_b = current_week - datetime.timedelta(days=7)

        self._pay((week_a + datetime.timedelta(days=1)).isoformat(), "SCHD", 700.00, profile_id=2)
        self._pay((week_a + datetime.timedelta(days=3)).isoformat(), "JEPI", 100.00, profile_id=3)
        self._pay((week_b + datetime.timedelta(days=2)).isoformat(), "SCHD", 1200.00, profile_id=2)
        # Current-week WTD crumbs must not become MIN.
        self._pay(today.isoformat(), "CVS", 26.00, profile_id=2)

        payload = self._history(view="weekly", months_back=6)
        self.assertTrue(payload["series"]["labels"][-1].endswith("WTD"))
        self.assertEqual(payload["summary"]["total"], 2026.00)
        self.assertEqual(payload["summary"]["min"], 800.00)
        self.assertEqual(payload["summary"]["max"], 1200.00)
        self.assertEqual(payload["summary"]["average"], 1000.00)
        self.assertNotEqual(payload["summary"]["min"], 26.00)

    def test_owner_monthly_prefers_linked_payments_over_incomplete_payouts(self):
        self._pay("2026-06-15", "SCHD", 75.00, profile_id=2)
        self._pay("2026-08-15", "JEPI", 25.00, profile_id=3)

        payload = self._history(view="monthly", months_back=12)
        by_label = dict(zip(payload["series"]["labels"], payload["series"]["values"]))
        self.assertEqual(by_label["Jun '26"], 75.00)
        self.assertEqual(by_label["Aug '26"], 25.00)
        # Owner monthly_payouts only had Jan/Feb 2026 — those must not appear
        # once linked-account payments exist for later months.
        self.assertNotIn("Jan '26", by_label)
        self.assertNotIn("Feb '26", by_label)


if __name__ == "__main__":
    unittest.main()
