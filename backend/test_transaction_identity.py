import sqlite3
import tempfile
import unittest
from pathlib import Path

from transaction_identity import (
    backfill_equity_dedupe_hashes,
    equity_dedupe_hash,
    equity_identity,
    insert_equity_transaction,
)


class TransactionIdentityTest(unittest.TestCase):
    def test_same_fill_hashes_match_across_price_rounding(self):
        left = equity_identity(1, "abc", "buy", "2026-01-15", 10.0, 20.5425, 0)
        right = equity_identity(1, "ABC", "BUY", "2026-01-15", 10.00001, 20.54, 0.0)
        self.assertEqual(left, right)
        self.assertEqual(
            equity_dedupe_hash(1, "ABC", "BUY", "2026-01-15", 10, 20.54, 0, occurrence=1),
            equity_dedupe_hash(1, "abc", "buy", "2026-01-15", 10, 20.5425, 0, occurrence=1),
        )

    def test_occurrence_keeps_identical_multi_fills_distinct(self):
        first = equity_dedupe_hash(1, "ABC", "BUY", "2026-01-15", 10, 20, 0, occurrence=1)
        second = equity_dedupe_hash(1, "ABC", "BUY", "2026-01-15", 10, 20, 0, occurrence=2)
        self.assertNotEqual(first, second)

    def test_insert_and_reimport_collide_on_stored_hash(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        path = tmp.name
        try:
            conn = sqlite3.connect(path)
            conn.row_factory = sqlite3.Row
            conn.execute(
                """CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT,
                    profile_id INTEGER,
                    transaction_type TEXT,
                    transaction_date TEXT,
                    shares REAL,
                    price_per_share REAL,
                    fees REAL,
                    notes TEXT,
                    realized_gain REAL,
                    acquired_date TEXT,
                    dedupe_hash TEXT
                )"""
            )
            conn.execute(
                "CREATE UNIQUE INDEX idx_transactions_dedupe ON transactions (dedupe_hash) "
                "WHERE dedupe_hash IS NOT NULL"
            )
            first = insert_equity_transaction(
                conn, "ABC", 1, "BUY", "2026-01-15", 10, 20, 0, notes="import", occurrence=1
            )
            second = insert_equity_transaction(
                conn, "ABC", 1, "BUY", "2026-01-15", 10, 20, 0, notes="import again", occurrence=1
            )
            twin = insert_equity_transaction(
                conn, "ABC", 1, "BUY", "2026-01-15", 10, 20, 0, notes="same-day fill", occurrence=2
            )
            conn.commit()
            count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
            conn.close()
            self.assertIsNotNone(first)
            self.assertIsNone(second)
            self.assertIsNotNone(twin)
            self.assertEqual(count, 2)
        finally:
            Path(path).unlink(missing_ok=True)

    def test_deleted_occurrence_hash_is_reused_without_collision(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        path = tmp.name
        try:
            conn = sqlite3.connect(path)
            conn.row_factory = sqlite3.Row
            conn.execute(
                """CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    profile_id INTEGER NOT NULL,
                    transaction_type TEXT NOT NULL,
                    transaction_date TEXT,
                    shares REAL NOT NULL,
                    price_per_share REAL,
                    fees REAL,
                    dedupe_hash TEXT
                )"""
            )
            conn.execute(
                "CREATE UNIQUE INDEX idx_transactions_dedupe ON transactions (dedupe_hash) "
                "WHERE dedupe_hash IS NOT NULL"
            )
            first = insert_equity_transaction(
                conn, "ABC", 1, "BUY", "2026-01-15", 10, 20, occurrence=1
            )
            second = insert_equity_transaction(
                conn, "ABC", 1, "BUY", "2026-01-15", 10, 20, occurrence=2
            )
            conn.execute("DELETE FROM transactions WHERE id = ?", (first,))

            replacement = insert_equity_transaction(
                conn, "ABC", 1, "BUY", "2026-01-15", 10, 20
            )
            hashes = [
                row[0]
                for row in conn.execute(
                    "SELECT dedupe_hash FROM transactions ORDER BY id"
                )
            ]
            conn.close()

            self.assertIsNotNone(second)
            self.assertIsNotNone(replacement)
            self.assertEqual(len(hashes), 2)
            self.assertEqual(len(set(hashes)), 2)
        finally:
            Path(path).unlink(missing_ok=True)

    def test_insert_reraises_non_dedupe_integrity_errors(self):
        conn = sqlite3.connect(":memory:")
        conn.execute(
            """CREATE TABLE transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                profile_id INTEGER NOT NULL,
                transaction_type TEXT NOT NULL,
                transaction_date TEXT,
                shares REAL NOT NULL,
                price_per_share REAL,
                fees REAL,
                dedupe_hash TEXT UNIQUE
            )"""
        )
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                insert_equity_transaction(
                    conn, "ABC", 1, "BUY", "2026-01-15", None, 20
                )
        finally:
            conn.close()

    def test_backfill_assigns_unique_hashes(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        path = tmp.name
        try:
            conn = sqlite3.connect(path)
            conn.execute(
                """CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT,
                    profile_id INTEGER,
                    transaction_type TEXT,
                    transaction_date TEXT,
                    shares REAL,
                    price_per_share REAL,
                    fees REAL,
                    dedupe_hash TEXT
                )"""
            )
            conn.execute(
                "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
                "VALUES ('ABC', 1, 'BUY', '2026-01-15', 10, 20, 0)"
            )
            conn.execute(
                "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
                "VALUES ('ABC', 1, 'BUY', '2026-01-15', 10, 20, 0)"
            )
            filled = backfill_equity_dedupe_hashes(conn)
            hashes = [row[0] for row in conn.execute("SELECT dedupe_hash FROM transactions ORDER BY id")]
            conn.close()
            self.assertEqual(filled, 2)
            self.assertEqual(len(hashes), 2)
            self.assertTrue(all(hashes))
            self.assertNotEqual(hashes[0], hashes[1])
        finally:
            Path(path).unlink(missing_ok=True)

    def test_ensure_tables_exist_adds_unique_dedupe_index(self):
        import database

        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        path = tmp.name
        try:
            conn = sqlite3.connect(path)
            conn.execute(
                """CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    profile_id INTEGER NOT NULL DEFAULT 1,
                    transaction_type TEXT NOT NULL DEFAULT 'BUY',
                    transaction_date TEXT,
                    shares REAL NOT NULL,
                    price_per_share REAL,
                    fees REAL DEFAULT 0
                )"""
            )
            conn.execute(
                "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share) "
                "VALUES ('ABC', 1, 'BUY', '2026-01-15', 10, 20)"
            )
            conn.commit()
            database.ensure_tables_exist(conn)
            cols = {row[1] for row in conn.execute("PRAGMA table_info(transactions)")}
            indexes = [row[1] for row in conn.execute("PRAGMA index_list(transactions)")]
            hashed = conn.execute("SELECT dedupe_hash FROM transactions").fetchone()[0]
            conn.close()
            self.assertIn("dedupe_hash", cols)
            self.assertIn("idx_transactions_dedupe", indexes)
            self.assertTrue(hashed)
        finally:
            Path(path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
