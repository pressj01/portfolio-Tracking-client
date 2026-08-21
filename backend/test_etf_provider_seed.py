import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import database


def _seed_db(path, funds):
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE etf_providers (
            id INTEGER PRIMARY KEY,
            provider TEXT NOT NULL UNIQUE,
            total_assets REAL,
            num_funds INTEGER,
            avg_expense REAL
        );
        CREATE TABLE etf_provider_funds (
            id INTEGER PRIMARY KEY,
            provider_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            fund_name TEXT,
            assets REAL,
            div_yield REAL,
            exp_ratio REAL,
            change_1y REAL,
            annual_div REAL,
            ex_div_date TEXT,
            frequency TEXT,
            payout_ratio REAL,
            div_growth REAL,
            UNIQUE (provider_id, symbol)
        );
        """
    )
    conn.execute(
        "INSERT INTO etf_providers (id, provider, total_assets, num_funds, avg_expense) "
        "VALUES (1, 'Acme', 100, 1, 0.2)"
    )
    for symbol, assets in funds:
        conn.execute(
            "INSERT INTO etf_provider_funds (provider_id, symbol, fund_name, assets) "
            "VALUES (1, ?, ?, ?)",
            (symbol, f"{symbol} Fund", assets),
        )
    conn.commit()
    conn.close()


class EtfProviderSeedRefreshTest(unittest.TestCase):
    def test_changed_seed_updates_existing_rows_even_with_same_mtime(self):
        with tempfile.TemporaryDirectory() as directory:
            first = os.path.join(directory, "seed1.db")
            second = os.path.join(directory, "seed2.db")
            live = os.path.join(directory, "live.db")
            _seed_db(first, [("OLD", 1_000_000)])
            _seed_db(second, [("OLD", 9_000_000), ("NEW", 2_000_000)])
            first_stat = os.stat(first)
            os.utime(
                second,
                ns=(first_stat.st_atime_ns, first_stat.st_mtime_ns),
            )

            conn = sqlite3.connect(live)
            conn.execute(
                """CREATE TABLE etf_providers (
                    id INTEGER PRIMARY KEY,
                    provider TEXT NOT NULL UNIQUE,
                    total_assets REAL,
                    num_funds INTEGER,
                    avg_expense REAL
                )"""
            )
            conn.execute(
                """CREATE TABLE etf_provider_funds (
                    id INTEGER PRIMARY KEY,
                    provider_id INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    fund_name TEXT,
                    assets REAL,
                    div_yield REAL,
                    exp_ratio REAL,
                    change_1y REAL,
                    annual_div REAL,
                    ex_div_date TEXT,
                    frequency TEXT,
                    payout_ratio REAL,
                    div_growth REAL,
                    UNIQUE (provider_id, symbol)
                )"""
            )
            conn.commit()

            with patch.object(database, "_seed_db_candidates", return_value=[first]):
                database._seed_etf_provider_data(conn)
            first_assets = conn.execute(
                "SELECT assets FROM etf_provider_funds WHERE symbol = 'OLD'"
            ).fetchone()[0]
            self.assertEqual(first_assets, 1_000_000)

            with patch.object(database, "_seed_db_candidates", return_value=[second]):
                database._seed_etf_provider_data(conn)
            rows = {
                row[0]: row[1]
                for row in conn.execute(
                    "SELECT symbol, assets FROM etf_provider_funds"
                ).fetchall()
            }
            conn.close()
            self.assertEqual(rows["OLD"], 9_000_000)
            self.assertEqual(rows["NEW"], 2_000_000)

    def test_user_added_provider_is_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            seed = os.path.join(directory, "seed.db")
            live = os.path.join(directory, "live.db")
            _seed_db(seed, [("OLD", 1_000_000)])
            conn = sqlite3.connect(live)
            conn.executescript(
                """
                CREATE TABLE etf_providers (
                    id INTEGER PRIMARY KEY,
                    provider TEXT NOT NULL UNIQUE,
                    total_assets REAL,
                    num_funds INTEGER,
                    avg_expense REAL
                );
                CREATE TABLE etf_provider_funds (
                    id INTEGER PRIMARY KEY,
                    provider_id INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    fund_name TEXT,
                    assets REAL,
                    div_yield REAL,
                    exp_ratio REAL,
                    change_1y REAL,
                    annual_div REAL,
                    ex_div_date TEXT,
                    frequency TEXT,
                    payout_ratio REAL,
                    div_growth REAL,
                    UNIQUE (provider_id, symbol)
                );
                INSERT INTO etf_providers (provider) VALUES ('UserCo');
                INSERT INTO etf_provider_funds (provider_id, symbol, fund_name, assets)
                VALUES (1, 'USER', 'User Fund', 50);
                """
            )
            conn.commit()
            with patch.object(database, "_seed_db_candidates", return_value=[seed]):
                database._seed_etf_provider_data(conn)
            providers = {
                row[0] for row in conn.execute("SELECT provider FROM etf_providers").fetchall()
            }
            user_fund = conn.execute(
                "SELECT symbol FROM etf_provider_funds WHERE symbol = 'USER'"
            ).fetchone()
            conn.close()
            self.assertIn("UserCo", providers)
            self.assertIn("Acme", providers)
            self.assertIsNotNone(user_fund)

    def test_differently_cased_user_provider_does_not_receive_seed_funds(self):
        with tempfile.TemporaryDirectory() as directory:
            seed = os.path.join(directory, "seed.db")
            live = os.path.join(directory, "live.db")
            _seed_db(seed, [("SEED", 1_000_000)])
            conn = sqlite3.connect(live)
            conn.executescript(
                """
                CREATE TABLE etf_providers (
                    id INTEGER PRIMARY KEY,
                    provider TEXT NOT NULL UNIQUE,
                    total_assets REAL,
                    num_funds INTEGER,
                    avg_expense REAL
                );
                CREATE TABLE etf_provider_funds (
                    id INTEGER PRIMARY KEY,
                    provider_id INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    fund_name TEXT,
                    assets REAL,
                    div_yield REAL,
                    exp_ratio REAL,
                    change_1y REAL,
                    annual_div REAL,
                    ex_div_date TEXT,
                    frequency TEXT,
                    payout_ratio REAL,
                    div_growth REAL,
                    UNIQUE (provider_id, symbol)
                );
                INSERT INTO etf_providers (id, provider) VALUES (1, 'acme');
                INSERT INTO etf_provider_funds (provider_id, symbol, fund_name)
                VALUES (1, 'USER', 'User Fund');
                """
            )
            conn.commit()

            with patch.object(database, "_seed_db_candidates", return_value=[seed]):
                database._seed_etf_provider_data(conn)

            rows = conn.execute(
                """SELECT p.provider, f.symbol
                     FROM etf_provider_funds f
                     JOIN etf_providers p ON p.id = f.provider_id
                    ORDER BY p.provider, f.symbol"""
            ).fetchall()
            conn.close()
            self.assertEqual(rows, [("Acme", "SEED"), ("acme", "USER")])


if __name__ == "__main__":
    unittest.main()
