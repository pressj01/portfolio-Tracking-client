"""Per-portfolio reset, and the guard that keeps single-profile writes off aggregates."""

import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class _ProfileFixture:
    """Three portfolios and an aggregate over two of them, each seeded with data."""

    def setUp(self):
        temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        temp_file.close()
        self.db_path = temp_file.name
        conn = self._get_connection()
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute("INSERT INTO profiles (id, name) VALUES (2, 'Brokerage')")
        conn.execute("INSERT INTO profiles (id, name) VALUES (3, 'Roth IRA')")
        conn.execute("INSERT INTO aggregates (id, name) VALUES (1, 'Combined')")
        conn.execute(
            "INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (1, 2), (1, 3)"
        )
        for pid in (1, 2, 3):
            self._seed_profile(conn, pid)
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_backup = app_module._create_import_backup
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        # The real backup copies DB_PATH, which the patched connection bypasses.
        self.backups = []
        app_module._create_import_backup = self._fake_backup
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        app_module._create_import_backup = self._orig_backup
        Path(self.db_path).unlink(missing_ok=True)

    def _fake_backup(self, profile_id=None):
        self.backups.append(profile_id)
        return f"/backups/portfolio_p{profile_id}_test.db"

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _seed_profile(self, conn, pid):
        """One of everything a reset should remove, plus things it must keep."""
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, current_value) VALUES (?, ?, ?, ?)",
            (f"AAA{pid}", pid, 10, 1000),
        )
        conn.execute(
            "INSERT INTO holdings (ticker, profile_id, quantity) VALUES (?, ?, ?)",
            (f"AAA{pid}", pid, 10),
        )
        conn.execute(
            """INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share)
               VALUES (?, ?, 'BUY', '2026-01-05', 10, 100)""",
            (f"AAA{pid}", pid),
        )
        conn.execute(
            """INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount)
               VALUES (?, ?, '2026-02-01', 25)""",
            (f"AAA{pid}", pid),
        )
        conn.execute(
            """INSERT INTO option_trades (profile_id, underlying, strategy_type, purpose, status, source, limited_history)
               VALUES (?, ?, 'vertical', 'income', 'open', 'manual', 0)""",
            (pid, f"AAA{pid}"),
        )
        # Kept by a reset — no import rebuilds these.
        conn.execute(
            "INSERT INTO portfolio_nav (profile_id, nav_date, total_value) VALUES (?, '2026-01-31', 1000)",
            (pid,),
        )
        conn.execute(
            "INSERT INTO categories (name, profile_id, sort_order) VALUES (?, ?, 0)",
            (f"Income {pid}", pid),
        )

    def _count(self, table, pid):
        conn = self._get_connection()
        try:
            return conn.execute(
                f"SELECT COUNT(*) AS c FROM {table} WHERE profile_id = ?", (pid,)
            ).fetchone()["c"]
        finally:
            conn.close()

    def _positions_managed(self, pid):
        conn = self._get_connection()
        try:
            return conn.execute(
                "SELECT positions_managed FROM profiles WHERE id = ?", (pid,)
            ).fetchone()["positions_managed"]
        finally:
            conn.close()

    def _import_buy(self, pid, ticker="ZZZ"):
        content = (
            "Date,Type,Ticker,Shares,Price Per Share,Fees,Dividend Amount,Notes\n"
            f"2026-01-15,BUY,{ticker},10,20.00,0,,Fresh purchase after reset\n"
        )
        return self.client.post(
            f"/api/import/transactions?profile_id={pid}",
            data={
                "format": "generic_transactions",
                "file": (io.BytesIO(content.encode()), "txns.csv"),
            },
            content_type="multipart/form-data",
        )


class ProfileResetTest(_ProfileFixture, unittest.TestCase):
    # ── Preview ──────────────────────────────────────────────────────────────

    def test_preview_itemizes_what_would_be_deleted_without_deleting_it(self):
        res = self.client.get("/api/profiles/2/data-preview?scope=reset")
        self.assertEqual(res.status_code, 200)
        body = res.get_json()

        self.assertEqual(body["profile_name"], "Brokerage")
        self.assertEqual(body["summary"]["positions"], 1)
        self.assertEqual(body["summary"]["transactions"], 1)
        self.assertEqual(body["summary"]["option_trades"], 1)
        self.assertEqual(body["summary"]["dividend_payments"], 1)
        self.assertTrue(body["total"] >= 5)
        self.assertTrue(body["preserved"])

        # A preview must never write.
        self.assertEqual(self._count("transactions", 2), 1)
        self.assertEqual(self.backups, [])

    def test_preview_404s_for_a_portfolio_that_does_not_exist(self):
        res = self.client.get("/api/profiles/99/data-preview?scope=reset")
        self.assertEqual(res.status_code, 404)

    # ── Reset ────────────────────────────────────────────────────────────────

    def test_reset_removes_positions_and_transactions_for_one_portfolio_only(self):
        res = self.client.post("/api/profiles/2/reset", json={"confirm_name": "Brokerage"})
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertEqual(body["summary"]["positions"], 1)
        self.assertEqual(body["summary"]["transactions"], 1)

        for table in ("all_account_info", "holdings", "transactions", "dividend_payments", "option_trades"):
            self.assertEqual(self._count(table, 2), 0, f"{table} should be empty after reset")
            self.assertEqual(self._count(table, 1), 1, f"{table} for Owner must be untouched")
            self.assertEqual(self._count(table, 3), 1, f"{table} for Roth IRA must be untouched")

    def test_reset_keeps_nav_history_and_category_definitions(self):
        self.client.post("/api/profiles/2/reset", json={"confirm_name": "Brokerage"})
        self.assertEqual(self._count("portfolio_nav", 2), 1)
        self.assertEqual(self._count("categories", 2), 1)

    def test_reset_backs_up_before_deleting(self):
        self.client.post("/api/profiles/2/reset", json={"confirm_name": "Brokerage"})
        self.assertEqual(self.backups, [2])

    def test_reset_refuses_without_the_exact_portfolio_name(self):
        for payload in ({}, {"confirm_name": ""}, {"confirm_name": "brokerage"}, {"confirm_name": "Roth IRA"}):
            res = self.client.post("/api/profiles/2/reset", json=payload)
            self.assertEqual(res.status_code, 400, f"payload {payload} should be refused")
            self.assertIn("Brokerage", res.get_json()["error"])

        self.assertEqual(self._count("transactions", 2), 1)
        self.assertEqual(self._count("all_account_info", 2), 1)
        self.assertEqual(self.backups, [], "a refused reset must not even take a backup")

    def test_reset_404s_for_a_portfolio_that_does_not_exist(self):
        res = self.client.post("/api/profiles/99/reset", json={"confirm_name": "Whatever"})
        self.assertEqual(res.status_code, 404)

    def test_reset_zeroes_the_cash_balance(self):
        conn = self._get_connection()
        conn.execute("UPDATE profiles SET cash_value = 5000 WHERE id = 2")
        conn.commit()
        conn.close()

        self.client.post("/api/profiles/2/reset", json={"confirm_name": "Brokerage"})

        conn = self._get_connection()
        try:
            cash = conn.execute("SELECT cash_value FROM profiles WHERE id = 2").fetchone()["cash_value"]
        finally:
            conn.close()
        self.assertEqual(cash, 0)

    def test_reset_clears_the_stale_positions_managed_flag(self):
        conn = self._get_connection()
        conn.execute("UPDATE profiles SET positions_managed = 1 WHERE id = 2")
        conn.commit()
        conn.close()

        self.client.post("/api/profiles/2/reset", json={"confirm_name": "Brokerage"})
        self.assertEqual(self._positions_managed(2), 0)

    def test_reimporting_after_reset_actually_rebuilds_holdings(self):
        """Reset -> transactions-only import must produce a visible holding."""
        conn = self._get_connection()
        conn.execute("UPDATE profiles SET positions_managed = 1 WHERE id = 2")
        conn.commit()
        conn.close()

        self.client.post("/api/profiles/2/reset", json={"confirm_name": "Brokerage"})

        res = self._import_buy(2)
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        self.assertEqual(res.get_json()["inserted_buys"], 1)

        conn = self._get_connection()
        try:
            holding = conn.execute(
                "SELECT quantity FROM all_account_info WHERE ticker = 'ZZZ' AND profile_id = 2"
            ).fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(holding, "the BUY must produce a visible holding, not just a ledger row")
        self.assertAlmostEqual(holding["quantity"], 10.0, places=4)



class ClearAndDeleteWarningTest(_ProfileFixture, unittest.TestCase):
    """Clear and Delete must be as guarded as Reset: no confirmation, no delete."""

    def test_clear_scope_preview_counts_the_ledger_and_keeps_option_trades(self):
        body = self.client.get("/api/profiles/2/data-preview?scope=clear").get_json()
        self.assertEqual(body["scope"], "clear")
        self.assertEqual(body["summary"]["positions"], 1)
        # The ledger is in Clear's scope, so the warning has to count it.
        self.assertEqual(body["summary"]["transactions"], 1)
        # Option trades are not, so they stay out of the count entirely.
        self.assertNotIn("option_trades", body["counts"])
        self.assertFalse(body["removes_portfolio"])
        self.assertTrue(any("Option trades" in line for line in body["preserved"]))
        self.assertFalse(any("Transaction history" in line for line in body["preserved"]))

    def test_delete_scope_preview_counts_everything_and_flags_the_portfolio(self):
        body = self.client.get("/api/profiles/2/data-preview?scope=delete").get_json()
        self.assertEqual(body["scope"], "delete")
        self.assertEqual(body["summary"]["transactions"], 1)
        # Delete removes the profile row, so NAV history and categories go too.
        self.assertEqual(body["counts"]["portfolio_nav"], 1)
        self.assertEqual(body["counts"]["categories"], 1)
        self.assertTrue(body["removes_portfolio"])
        self.assertEqual(body["preserved"], [])

    def test_unknown_scope_is_refused(self):
        res = self.client.get("/api/profiles/2/data-preview?scope=nuke")
        self.assertEqual(res.status_code, 400)

    def test_clear_refuses_without_the_typed_name(self):
        for payload in ({}, {"confirm_name": "brokerage"}):
            res = self.client.post("/api/profiles/2/clear", json=payload)
            self.assertEqual(res.status_code, 400)
        self.assertEqual(self._count("all_account_info", 2), 1)
        self.assertEqual(self.backups, [], "a refused clear must not take a backup")

    def test_clear_with_the_typed_name_empties_holdings_and_the_ledger(self):
        res = self.client.post("/api/profiles/2/clear", json={"confirm_name": "Brokerage"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._count("all_account_info", 2), 0)
        self.assertEqual(self._count("transactions", 2), 0, "Clear empties the ledger")
        self.assertEqual(self._count("dividend_payments", 2), 0)
        self.assertEqual(self._count("option_trades", 2), 1, "Clear keeps option trades")
        self.assertEqual(self._count("portfolio_nav", 2), 1)
        self.assertEqual(self.backups, [2], "Clear now snapshots first")

    def test_clear_leaves_other_portfolios_alone(self):
        conn = self._get_connection()
        conn.execute("UPDATE profiles SET positions_managed = 1 WHERE id IN (1, 2, 3)")
        conn.commit()
        conn.close()

        self.client.post("/api/profiles/2/clear", json={"confirm_name": "Brokerage"})
        for table in ("all_account_info", "holdings", "transactions", "dividend_payments", "option_trades"):
            self.assertEqual(self._count(table, 1), 1, f"{table} for Owner must be untouched")
            self.assertEqual(self._count(table, 3), 1, f"{table} for Roth IRA must be untouched")
        self.assertEqual(self._count("option_trades", 2), 1)
        self.assertEqual(self._positions_managed(2), 0)
        self.assertEqual(self._positions_managed(1), 1)
        self.assertEqual(self._positions_managed(3), 1)

    def test_clear_clears_the_stale_positions_managed_flag(self):
        conn = self._get_connection()
        conn.execute("UPDATE profiles SET positions_managed = 1 WHERE id = 2")
        conn.commit()
        conn.close()

        self.client.post("/api/profiles/2/clear", json={"confirm_name": "Brokerage"})
        self.assertEqual(self._positions_managed(2), 0)

    def test_reimporting_after_clear_actually_rebuilds_holdings(self):
        """Clear -> transactions-only import must produce a visible holding."""
        conn = self._get_connection()
        conn.execute("UPDATE profiles SET positions_managed = 1 WHERE id = 2")
        conn.commit()
        conn.close()

        self.client.post("/api/profiles/2/clear", json={"confirm_name": "Brokerage"})

        res = self._import_buy(2)
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        self.assertEqual(res.get_json()["inserted_buys"], 1)
        self.assertEqual(self._count("option_trades", 2), 1, "Clear must still spare option trades")

        conn = self._get_connection()
        try:
            holding = conn.execute(
                "SELECT quantity FROM all_account_info WHERE ticker = 'ZZZ' AND profile_id = 2"
            ).fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(holding, "the BUY must produce a visible holding, not just a ledger row")
        self.assertAlmostEqual(holding["quantity"], 10.0, places=4)

    def test_delete_refuses_without_the_typed_name(self):
        for payload in ({}, {"confirm_name": "Roth IRA"}):
            res = self.client.post("/api/profiles/2/clear", json=payload)
            self.assertEqual(res.status_code, 400)
        res = self.client.delete("/api/profiles/2", json={})
        self.assertEqual(res.status_code, 400)

        conn = self._get_connection()
        try:
            still_there = conn.execute("SELECT COUNT(*) AS c FROM profiles WHERE id = 2").fetchone()["c"]
        finally:
            conn.close()
        self.assertEqual(still_there, 1)
        self.assertEqual(self._count("transactions", 2), 1)

    def test_delete_removes_the_profile_and_leaves_no_orphan_rows(self):
        res = self.client.delete("/api/profiles/2", json={"confirm_name": "Brokerage"})
        self.assertEqual(res.status_code, 200)

        conn = self._get_connection()
        try:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) AS c FROM profiles WHERE id = 2").fetchone()["c"], 0
            )
            orphans = {}
            for table in app_module._profile_scoped_tables(conn):
                c = conn.execute(
                    f'SELECT COUNT(*) AS c FROM "{table}" WHERE profile_id = 2'
                ).fetchone()["c"]
                if c:
                    orphans[table] = c
        finally:
            conn.close()
        self.assertEqual(orphans, {}, f"deleting a portfolio left orphan rows: {orphans}")
        self.assertEqual(self.backups, [2])

    def test_delete_does_not_touch_other_portfolios(self):
        self.client.delete("/api/profiles/2", json={"confirm_name": "Brokerage"})
        for table in ("all_account_info", "transactions", "portfolio_nav", "categories"):
            self.assertEqual(self._count(table, 1), 1)
            self.assertEqual(self._count(table, 3), 1)

    def test_owner_cannot_be_deleted_even_with_the_name(self):
        res = self.client.delete("/api/profiles/1", json={"confirm_name": "Owner"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self._count("all_account_info", 1), 1)


class AggregateWriteGuardTest(_ProfileFixture, unittest.TestCase):
    """An aggregate has no single target, so single-profile writes must refuse it.

    Without the guard `get_profile_id()` falls back to profile 1 and the write
    silently lands on Owner.
    """

    def test_clear_all_refuses_an_aggregate_and_leaves_owner_intact(self):
        res = self.client.post("/api/data/clear-all?aggregate_id=1")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Aggregate", res.get_json()["error"])

        for pid in (1, 2, 3):
            self.assertEqual(self._count("all_account_info", pid), 1)

    def test_clear_all_still_works_for_a_named_profile(self):
        res = self.client.post("/api/data/clear-all?profile_id=2")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._count("all_account_info", 2), 0)
        self.assertEqual(self._count("transactions", 2), 0, "Settings Clear uses the same ledger wipe as Portfolios Clear")
        self.assertEqual(self._count("option_trades", 2), 1, "Settings Clear still keeps option trades")
        self.assertEqual(self._count("all_account_info", 1), 1)
        self.assertEqual(self._count("transactions", 1), 1)

    def test_excel_import_refuses_an_aggregate(self):
        res = self.client.post(
            "/api/import/excel?aggregate_id=1",
            data={"file": (io.BytesIO(b"not a real workbook"), "book.xlsx")},
            content_type="multipart/form-data",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Aggregate", res.get_json()["error"])

    def test_generic_import_refuses_an_aggregate(self):
        res = self.client.post(
            "/api/import/generic?aggregate_id=1",
            data={"file": (io.BytesIO(b"not a real workbook"), "book.xlsx")},
            content_type="multipart/form-data",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Aggregate", res.get_json()["error"])

    def test_the_guard_fires_before_the_file_is_read(self):
        # No file at all: the aggregate refusal must still be what comes back,
        # proving nothing was written or parsed first.
        res = self.client.post("/api/import/generic?aggregate_id=1")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Aggregate", res.get_json()["error"])
        self.assertEqual(self.backups, [])


if __name__ == "__main__":
    unittest.main()
