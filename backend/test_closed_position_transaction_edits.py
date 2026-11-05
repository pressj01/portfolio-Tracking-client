"""Editing or deleting a closed position's trades keeps the broker's zero.

Transaction History lists closed positions, and its Edit/Delete buttons reuse
the holdings endpoints. A closed position's history is often partial or being
corrected (GOOGL: a pre-split 2-share BUY imported beside the post-split 40),
so rebuilding the count from it after an edit opened a phantom holding the
broker's positions file says was sold. In a broker-fed account the zero now
stands for edits to anything the file already reflects; trades dated after the
file still move it. An account with no broker import still follows its history.
"""

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

# (date, side, shares, price): the GOOGL ledger from the report, simplified.
# The first row is the bad pre-split import; without it the ledger nets zero.
GOOGL_HISTORY = [
    ("2022-03-29", "BUY", 2, 2871.49),
    ("2022-03-29", "BUY", 40, 143.5745),
    ("2022-10-03", "BUY", 1, 99.025),
    ("2023-05-22", "BUY", 40, 125.2499),
    ("2024-10-02", "SELL", 0.195, 165.86),
    ("2025-04-08", "SELL", 80.805, 145.9559),
]


class ClosedPositionTransactionEditTest(unittest.TestCase):
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
            "(1, 'Owner', '', 0), (2, 'Trust', 'fidelity', 1), (3, 'Manual', '', 0)"
        )
        # A still-held ticker in each account carries the latest file's stamp.
        for pid in (2, 3):
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, quantity, base_quantity, price_paid, purchase_value, "
                "current_price, current_value, import_date, broker_snapshot_date, broker_snapshot_at) "
                "VALUES ('SCHD', ?, 100, 100, 26, 2600, 27, 2700, ?, ?, ?)",
                (
                    pid, SNAPSHOT_DATE,
                    SNAPSHOT_DATE if pid == 2 else None,
                    f"{SNAPSHOT_DATE} 20:00:00" if pid == 2 else None,
                ),
            )
        for pid in (2, 3):
            for day, side, shares, price in GOOGL_HISTORY:
                self._insert_txn(conn, "GOOGL", pid, side, day, shares, price, f"{SNAPSHOT_DATE} 19:00:00")
        # Bought before the file, sold after it: the sale closed the position.
        self._insert_txn(conn, "XYZ", 2, "BUY", "2026-09-01", 10, 20.0, f"{SNAPSHOT_DATE} 19:00:00")
        self._insert_txn(conn, "XYZ", 2, "SELL", "2026-10-15", 10, 25.0, "2026-10-15 15:00:00")
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

    @staticmethod
    def _insert_txn(conn, ticker, pid, side, day, shares, price, created_at):
        conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, "
            "shares, price_per_share, fees, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, '', ?)",
            (ticker, pid, side, day, shares, price, created_at),
        )

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

    def _txn(self, ticker, day, shares, profile_id=2):
        conn = self._get_connection()
        try:
            return dict(conn.execute(
                "SELECT * FROM transactions WHERE ticker = ? AND profile_id = ? "
                "AND transaction_date = ? AND ABS(shares - ?) < 1e-9",
                (ticker, profile_id, day, shares),
            ).fetchone())
        finally:
            conn.close()

    def _edit(self, ticker, txn_id, body, profile_id=2):
        return self.client.put(
            f"/api/holdings/{ticker}/transactions/{txn_id}?profile_id={profile_id}", json=body,
        )

    def _delete(self, ticker, txn_id, profile_id=2):
        return self.client.delete(f"/api/holdings/{ticker}/transactions/{txn_id}?profile_id={profile_id}")

    def test_deleting_the_bad_import_corrects_realized_gains_and_stays_closed(self):
        bad = self._txn("GOOGL", "2022-03-29", 2)
        response = self._delete("GOOGL", bad["id"])
        self.assertEqual(response.status_code, 200, response.get_json())

        self.assertIsNone(self._holding("GOOGL"))
        # FIFO now takes the first sale from the post-split 40 @ $143.57.
        first_sale = self._txn("GOOGL", "2024-10-02", 0.195)
        self.assertAlmostEqual(first_sale["realized_gain"], round(0.195 * (165.86 - 143.5745), 2), places=2)

    def test_editing_a_closed_position_does_not_open_a_phantom_holding(self):
        # The bad lot is still there, so the history nets +2 shares.
        good = self._txn("GOOGL", "2022-03-29", 40)
        response = self._edit("GOOGL", good["id"], {"notes": "post-split buy"})
        self.assertEqual(response.status_code, 200, response.get_json())

        self.assertIsNone(self._holding("GOOGL"), "the broker's file says GOOGL was sold")
        self.assertEqual(self._txn("GOOGL", "2022-03-29", 40)["notes"], "post-split buy")
        # Realized gains still follow the corrected history: FIFO hits the bad lot.
        first_sale = self._txn("GOOGL", "2024-10-02", 0.195)
        self.assertAlmostEqual(first_sale["realized_gain"], -527.60, places=2)

    def test_fixing_the_bad_lot_in_place_stays_closed(self):
        bad = self._txn("GOOGL", "2022-03-29", 2)
        response = self._edit("GOOGL", bad["id"], {"shares": 40, "price_per_share": 143.5745})
        self.assertEqual(response.status_code, 200, response.get_json())
        # Now the history runs 38 shares high, and the zero still holds.
        self.assertIsNone(self._holding("GOOGL"))

    def test_without_a_broker_import_the_history_still_owns_the_count(self):
        good = self._txn("GOOGL", "2022-03-29", 40, profile_id=3)
        response = self._edit("GOOGL", good["id"], {"notes": "post-split buy"}, profile_id=3)
        self.assertEqual(response.status_code, 200, response.get_json())

        holding = self._holding("GOOGL", profile_id=3)
        self.assertIsNotNone(holding)
        self.assertAlmostEqual(holding["quantity"], 2, places=6)

    def test_a_sale_dated_after_the_file_still_moves_the_count(self):
        sale = self._txn("XYZ", "2026-10-15", 10)
        response = self._edit("XYZ", sale["id"], {"shares": 6})
        self.assertEqual(response.status_code, 200, response.get_json())

        holding = self._holding("XYZ")
        self.assertIsNotNone(holding)
        self.assertAlmostEqual(holding["quantity"], 4, places=6)
        self.assertAlmostEqual(holding["purchase_value"], 80, places=2)

    def test_deleting_a_sale_dated_after_the_file_reopens_the_position(self):
        sale = self._txn("XYZ", "2026-10-15", 10)
        response = self._delete("XYZ", sale["id"])
        self.assertEqual(response.status_code, 200, response.get_json())

        holding = self._holding("XYZ")
        self.assertIsNotNone(holding)
        self.assertAlmostEqual(holding["quantity"], 10, places=6)

    def _add(self, ticker, body, profile_id=2):
        return self.client.post(
            f"/api/holdings/{ticker}/transactions?profile_id={profile_id}", json=body,
        )

    def test_adding_a_missing_sale_to_a_closed_position(self):
        # The history nets +2 GOOGL; the sale that sold them was never imported.
        response = self._add("GOOGL", {
            "transaction_type": "SELL", "transaction_date": "2025-05-01",
            "shares": 2, "price_per_share": 150,
        })
        self.assertEqual(response.status_code, 201, response.get_json())

        self.assertIsNone(self._holding("GOOGL"))
        # FIFO leaves 2 shares of the 2023-05-22 lot at $125.2499.
        sale = self._txn("GOOGL", "2025-05-01", 2)
        self.assertAlmostEqual(sale["realized_gain"], round(2 * (150 - 125.2499), 2), places=2)

    def test_a_backdated_buy_corrects_history_without_reopening(self):
        response = self._add("XYZ", {
            "transaction_type": "BUY", "transaction_date": "2026-08-01",
            "shares": 5, "price_per_share": 18,
        })
        self.assertEqual(response.status_code, 201, response.get_json())

        self.assertIsNone(self._holding("XYZ"), "the broker's file says XYZ was sold")
        # The sale now draws 5 shares from the new lot and 5 from the old one.
        sale = self._txn("XYZ", "2026-10-15", 10)
        self.assertAlmostEqual(sale["realized_gain"], 10 * 25 - (5 * 18 + 5 * 20), places=2)

    def test_a_buy_dated_after_the_file_reopens_a_closed_position(self):
        response = self._add("XYZ", {
            "transaction_type": "BUY", "transaction_date": "2026-10-20",
            "shares": 4, "price_per_share": 30,
        })
        self.assertEqual(response.status_code, 201, response.get_json())

        holding = self._holding("XYZ")
        self.assertIsNotNone(holding)
        self.assertAlmostEqual(holding["quantity"], 4, places=6)
        self.assertAlmostEqual(holding["purchase_value"], 120, places=2)

    def test_a_sale_the_history_cannot_cover_is_refused_and_writes_nothing(self):
        response = self._add("GOOGL", {
            "transaction_type": "SELL", "transaction_date": "2025-05-01",
            "shares": 5, "price_per_share": 150,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("only 2.000000 shares are available", response.get_json()["error"])
        self.assertIsNone(self._holding("GOOGL"), "a refused trade must not leave a placeholder row")

    def test_without_a_broker_import_added_trades_follow_the_history(self):
        response = self._add("GOOGL", {
            "transaction_type": "BUY", "transaction_date": "2025-06-01",
            "shares": 3, "price_per_share": 170,
        }, profile_id=3)
        self.assertEqual(response.status_code, 201, response.get_json())
        holding = self._holding("GOOGL", profile_id=3)
        self.assertIsNotNone(holding)
        self.assertAlmostEqual(holding["quantity"], 5, places=6)

        response = self._add("GOOGL", {
            "transaction_type": "SELL", "transaction_date": "2025-07-01",
            "shares": 5, "price_per_share": 180,
        }, profile_id=3)
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertIsNone(self._holding("GOOGL", profile_id=3))

    def test_selling_a_ticker_with_no_history_is_still_refused(self):
        response = self._add("NEWT", {
            "transaction_type": "SELL", "transaction_date": "2026-10-20",
            "shares": 1, "price_per_share": 10,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("no holding exists yet", response.get_json()["error"])

    def test_add_trade_lists_accounts_without_a_ticker(self):
        response = self.client.get("/api/transaction-accounts?profile_id=2")
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual([account["id"] for account in response.get_json()], [2])

    def test_history_rows_carry_what_the_edit_buttons_need(self):
        response = self.client.get("/api/transactions/history?profile_id=2")
        self.assertEqual(response.status_code, 200)
        googl = [event for event in response.get_json()["events"] if event["ticker"] == "GOOGL"]
        self.assertEqual(len(googl), len(GOOGL_HISTORY))
        for event in googl:
            self.assertTrue(event["closed_position"])
            self.assertEqual(event["profile_id"], 2)
            self.assertIsInstance(event["transaction_id"], int)


if __name__ == "__main__":
    unittest.main()
