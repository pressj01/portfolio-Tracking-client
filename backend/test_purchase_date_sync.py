import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import _sync_preserved_position_purchase_date


class PurchaseDateSyncTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT,
                profile_id INTEGER,
                quantity REAL,
                purchase_date TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                profile_id INTEGER,
                transaction_type TEXT,
                transaction_date TEXT,
                shares REAL,
                price_per_share REAL,
                fees REAL
            );
            CREATE TABLE transaction_lot_allocations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sell_txn_id INTEGER,
                buy_txn_id INTEGER,
                shares REAL
            );
            """
        )

    def tearDown(self):
        self.conn.close()

    def test_sync_uses_earliest_open_buy_lot_without_changing_position(self):
        self.conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, purchase_date) "
            "VALUES ('ABC', 42, 15, NULL)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 42, 'BUY', '2026-01-10', 10, 20, 0)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 42, 'SELL', '2026-01-15', 10, 21, 0)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 42, 'BUY', '2026-02-01', 15, 22, 0)"
        )

        _sync_preserved_position_purchase_date("ABC", 42, self.conn)

        row = self.conn.execute(
            "SELECT quantity, purchase_date FROM all_account_info WHERE ticker = 'ABC' AND profile_id = 42"
        ).fetchone()
        self.assertEqual(row["quantity"], 15)
        self.assertEqual(row["purchase_date"], "2026-02-01")


if __name__ == "__main__":
    unittest.main()
