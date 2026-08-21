import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import database
import normalize


class CanonicalHoldingsTest(unittest.TestCase):
    def test_zero_quantity_mirror_rows_are_purged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "live.db")

            def connection():
                conn = sqlite3.connect(path)
                conn.row_factory = sqlite3.Row
                return conn

            conn = connection()
            database.ensure_tables_exist(conn)
            conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
            conn.execute(
                """INSERT INTO all_account_info (ticker, profile_id, quantity, current_value)
                   VALUES ('LIVE', 1, 10, 1000)"""
            )
            conn.execute(
                """INSERT INTO all_account_info (ticker, profile_id, quantity, current_value)
                   VALUES ('DEAD', 1, 0, 0)"""
            )
            conn.execute(
                """INSERT INTO holdings (ticker, profile_id, quantity, current_value)
                   VALUES ('DEAD', 1, 5, 500)"""
            )
            conn.execute(
                """INSERT INTO dividends (ticker, profile_id, estim_payment_per_year)
                   VALUES ('DEAD', 1, 12)"""
            )
            conn.commit()
            conn.close()

            with patch.object(normalize, "get_connection", side_effect=connection):
                normalize.populate_holdings(1)
                normalize.populate_dividends(1)

            conn = connection()
            holdings = [
                row["ticker"]
                for row in conn.execute("SELECT ticker FROM holdings").fetchall()
            ]
            dividends = [
                row["ticker"]
                for row in conn.execute("SELECT ticker FROM dividends").fetchall()
            ]
            conn.close()
            self.assertEqual(holdings, ["LIVE"])
            self.assertEqual(dividends, ["LIVE"])

    def test_schema_migration_does_not_drop_holdings_or_dividends(self):
        conn = sqlite3.connect(":memory:")
        conn.executescript(
            """
            CREATE TABLE holdings (
                ticker TEXT NOT NULL PRIMARY KEY,
                quantity REAL,
                current_value REAL
            );
            CREATE TABLE dividends (
                ticker TEXT NOT NULL PRIMARY KEY,
                estim_payment_per_year REAL
            );
            INSERT INTO holdings (ticker, quantity, current_value) VALUES ('KEEP', 8, 80);
            INSERT INTO dividends (ticker, estim_payment_per_year) VALUES ('KEEP', 9);
            """
        )
        database.ensure_tables_exist(conn)
        kept_h = conn.execute("SELECT ticker, profile_id, quantity FROM holdings").fetchone()
        kept_d = conn.execute("SELECT ticker, profile_id FROM dividends").fetchone()
        conn.execute(
            "INSERT INTO holdings (ticker, profile_id, quantity) VALUES ('KEEP', 2, 3)"
        )
        conn.execute(
            "INSERT INTO dividends (ticker, profile_id, estim_payment_per_year) "
            "VALUES ('KEEP', 2, 4)"
        )
        holding_profiles = conn.execute(
            "SELECT profile_id FROM holdings WHERE ticker = 'KEEP' ORDER BY profile_id"
        ).fetchall()
        dividend_profiles = conn.execute(
            "SELECT profile_id FROM dividends WHERE ticker = 'KEEP' ORDER BY profile_id"
        ).fetchall()
        conn.close()
        self.assertEqual(tuple(kept_h), ("KEEP", 1, 8))
        self.assertEqual(tuple(kept_d), ("KEEP", 1))
        self.assertEqual([row[0] for row in holding_profiles], [1, 2])
        self.assertEqual([row[0] for row in dividend_profiles], [1, 2])


if __name__ == "__main__":
    unittest.main()
