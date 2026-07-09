import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import normalize


class NavCashTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "nav-cash.db"
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY,
                include_in_owner INTEGER NOT NULL DEFAULT 0,
                cash_value REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE all_account_info (
                ticker TEXT,
                profile_id INTEGER,
                quantity REAL,
                current_price REAL,
                current_value REAL
            );
            CREATE TABLE portfolio_nav (
                profile_id INTEGER,
                nav_date TEXT,
                total_value REAL,
                source TEXT,
                UNIQUE(profile_id, nav_date)
            );
            INSERT INTO profiles (id, include_in_owner, cash_value)
            VALUES (1, 1, 0), (6, 1, 100), (7, 1, 50);
            INSERT INTO all_account_info
                (ticker, profile_id, quantity, current_price, current_value)
            VALUES
                ('AAA', 6, 9, 100, 900),
                ('AAA', 1, 9, 100, 900),
                ('BBB', 1, 9, 100, 900);
            """
        )
        conn.commit()
        conn.close()
        self.original_get_connection = normalize.get_connection
        normalize.get_connection = lambda: sqlite3.connect(self.db_path)

    def tearDown(self):
        normalize.get_connection = self.original_get_connection
        self.temp_dir.cleanup()

    def test_profile_snapshot_includes_its_cash(self):
        value = normalize.snapshot_nav(6, nav_date="2026-06-29")
        self.assertEqual(value, 1000.0)

    def test_owner_snapshot_includes_cash_from_owner_sources(self):
        value = normalize.snapshot_nav(1, nav_date="2026-06-29")
        self.assertEqual(value, 1950.0)


if __name__ == "__main__":
    unittest.main()
