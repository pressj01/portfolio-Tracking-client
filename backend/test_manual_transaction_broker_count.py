"""A manual trade moves a broker-imported share count instead of rebuilding it.

In a portfolio fed by broker positions files the file owns the count. Adding,
editing or deleting a transaction used to rebuild the count from the history,
which is wrong whenever that history is incomplete: a money-market fund's
sweep history turned 71 shares + 5 into 16,238, and a history that starts
after the first purchase turned 100 + 5 into 45. Now trades dated after the
file move the count; edits to what the file already reflects do not.
"""

import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import config
import database


SNAPSHOT_DATE = "2026-10-01"


class ManualTransactionBrokerCountTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        app_module._ensure_basis_columns(conn)
        conn.execute("DELETE FROM profiles")
        conn.execute(
            "INSERT INTO profiles (id, name, broker_source, positions_managed) VALUES "
            "(1, 'Owner', '', 0), (2, 'Fidelity IRA', 'fidelity', 1), (3, 'Manual', '', 0)"
        )
        # (profile, ticker, broker count, cost/share, price, history rows)
        for pid, ticker, qty, cost, price, history in [
            # Sweep buys recorded, the cash that left is not: history runs high.
            (2, "FZDXX", 71, 1.0, 1.0, [("2026-09-03", 8000, 1.0), ("2026-09-10", 8167, 1.0)]),
            # History starts after the first purchase: it runs short.
            (2, "SCHD", 100, 26.0, 27.0, [("2026-06-01", 40, 26.0)]),
            # Complete history: rebuilding it gives the broker's count.
            (2, "JEPI", 50, 55.0, 57.0, [("2026-01-05", 50, 55.0)]),
            # No broker import: the history owns the count.
            (3, "SCHD", 100, 26.0, 27.0, [("2026-06-01", 40, 26.0)]),
        ]:
            total = qty * cost
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, quantity, base_quantity, price_paid, purchase_value, "
                "broker_price_paid, broker_purchase_value, original_price_paid, original_purchase_value, "
                "current_price, current_value, import_date, broker_snapshot_date, broker_snapshot_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ticker, pid, qty, qty, cost, total, cost, total, cost, total,
                    price, qty * price, SNAPSHOT_DATE,
                    SNAPSHOT_DATE if pid == 2 else None,
                    f"{SNAPSHOT_DATE} 20:00:00" if pid == 2 else None,
                ),
            )
            for day, shares, px in history:
                conn.execute(
                    "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, "
                    "shares, price_per_share, fees, notes, created_at) "
                    "VALUES (?, ?, 'BUY', ?, ?, ?, 0, '', ?)",
                    (ticker, pid, day, shares, px, f"{SNAPSHOT_DATE} 19:00:00"),
                )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_db_path = config.DB_PATH
        config.DB_PATH = self.db_path
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        config.DB_PATH = self._orig_db_path
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _holding(self, ticker, profile_id=2):
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM all_account_info WHERE ticker = ? AND profile_id = ?",
                (ticker, profile_id),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _txn_id(self, ticker, day, profile_id=2):
        conn = self._get_connection()
        try:
            return conn.execute(
                "SELECT id FROM transactions WHERE ticker = ? AND profile_id = ? AND transaction_date = ? "
                "ORDER BY id DESC",
                (ticker, profile_id, day),
            ).fetchone()[0]
        finally:
            conn.close()

    def _add(self, ticker, side, shares, price, day="2026-10-15", profile_id=2):
        return self.client.post(
            f"/api/holdings/{ticker}/transactions?profile_id={profile_id}",
            json={
                "transaction_type": side,
                "transaction_date": day,
                "shares": shares,
                "price_per_share": price,
                "fees": 0,
            },
        )

    def test_a_buy_after_the_file_moves_the_broker_count(self):
        for ticker, price, expected in [("FZDXX", 1.0, 76), ("SCHD", 27.0, 105), ("JEPI", 57.0, 55)]:
            response = self._add(ticker, "BUY", 5, price)
            self.assertEqual(response.status_code, 201, response.get_json())
            self.assertAlmostEqual(self._holding(ticker)["quantity"], expected, places=6, msg=ticker)

        fzdxx = self._holding("FZDXX")
        self.assertAlmostEqual(fzdxx["purchase_value"], 76.0, places=2)
        self.assertAlmostEqual(fzdxx["current_value"], 76.0, places=2)
        self.assertEqual(fzdxx["import_date"], SNAPSHOT_DATE)

    def test_editing_and_deleting_a_later_trade_moves_the_count_back(self):
        self._add("FZDXX", "BUY", 50, 1.0)
        self.assertAlmostEqual(self._holding("FZDXX")["quantity"], 121, places=6)
        txn_id = self._txn_id("FZDXX", "2026-10-15")

        response = self.client.put(
            f"/api/holdings/FZDXX/transactions/{txn_id}?profile_id=2", json={"shares": 5},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertAlmostEqual(self._holding("FZDXX")["quantity"], 76, places=6)

        response = self.client.delete(f"/api/holdings/FZDXX/transactions/{txn_id}?profile_id=2")
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertAlmostEqual(self._holding("FZDXX")["quantity"], 71, places=6)

    def test_correcting_history_the_file_already_reflects_leaves_the_count(self):
        txn_id = self._txn_id("FZDXX", "2026-09-03")
        response = self.client.delete(f"/api/holdings/FZDXX/transactions/{txn_id}?profile_id=2")
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertAlmostEqual(self._holding("FZDXX")["quantity"], 71, places=6)

        txn_id = self._txn_id("SCHD", "2026-06-01")
        response = self.client.put(
            f"/api/holdings/SCHD/transactions/{txn_id}?profile_id=2", json={"shares": 45},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertAlmostEqual(self._holding("SCHD")["quantity"], 100, places=6)

    def test_a_sell_after_the_file_is_checked_against_the_broker_count(self):
        # The history holds only 40 SCHD, but the broker holds 100.
        response = self._add("SCHD", "SELL", 60, 28.0)
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertAlmostEqual(self._holding("SCHD")["quantity"], 40, places=6)

        response = self._add("SCHD", "SELL", 150, 28.0, day="2026-10-16")
        self.assertEqual(response.status_code, 400)
        self.assertAlmostEqual(self._holding("SCHD")["quantity"], 40, places=6)

    def test_a_same_day_trade_counts_only_when_entered_after_the_import(self):
        today = datetime.date.today().isoformat()
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET import_date = ?, broker_snapshot_date = ?, "
                "broker_snapshot_at = datetime('now', '-1 hour') WHERE ticker = 'FZDXX' AND profile_id = 2",
                (today, today),
            )
            # Imported history from earlier the same day: the file includes it.
            conn.execute(
                "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, "
                "shares, price_per_share, fees, notes, created_at) "
                "VALUES ('FZDXX', 2, 'BUY', ?, 20, 1.0, 0, '', datetime('now', '-2 hours'))",
                (today,),
            )
            conn.commit()
        finally:
            conn.close()

        txn_id = self._txn_id("FZDXX", today)
        self.client.delete(f"/api/holdings/FZDXX/transactions/{txn_id}?profile_id=2")
        self.assertAlmostEqual(self._holding("FZDXX")["quantity"], 71, places=6)

        response = self._add("FZDXX", "BUY", 5, 1.0, day=today)
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertAlmostEqual(self._holding("FZDXX")["quantity"], 76, places=6)

    def test_a_portfolio_without_a_broker_import_still_follows_its_history(self):
        response = self._add("SCHD", "BUY", 5, 27.0, profile_id=3)
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertAlmostEqual(self._holding("SCHD", profile_id=3)["quantity"], 45, places=6)

    def test_a_legacy_holding_falls_back_to_its_import_date(self):
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET broker_snapshot_date = NULL, broker_snapshot_at = NULL "
                "WHERE ticker = 'FZDXX' AND profile_id = 2"
            )
            conn.commit()
        finally:
            conn.close()

        self._add("FZDXX", "BUY", 5, 1.0)
        self.assertAlmostEqual(self._holding("FZDXX")["quantity"], 76, places=6)
        holding = self._holding("FZDXX")
        self.assertEqual(holding["broker_snapshot_date"], SNAPSHOT_DATE)

    def test_a_positions_import_records_when_it_set_the_count(self):
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET broker_snapshot_date = NULL, broker_snapshot_at = NULL, "
                "import_date = '2026-10-18' WHERE ticker = 'JEPI' AND profile_id = 2"
            )
            app_module._finalize_positions_snapshot(2, conn, ["JEPI"])
            conn.commit()
        finally:
            conn.close()

        holding = self._holding("JEPI")
        self.assertEqual(holding["broker_snapshot_date"], "2026-10-18")
        self.assertTrue(holding["broker_snapshot_at"])


if __name__ == "__main__":
    unittest.main()
