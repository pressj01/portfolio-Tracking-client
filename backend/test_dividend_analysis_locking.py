import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import dividend_safety


class DividendAnalysisLockingTest(unittest.TestCase):
    def test_basis_compatibility_check_stays_read_only_when_data_is_normalized(self):
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        blocker = None
        reader = None
        try:
            setup = sqlite3.connect(db_path)
            setup.executescript(
                """
                CREATE TABLE all_account_info (
                    ticker TEXT,
                    description TEXT,
                    price_paid REAL,
                    purchase_value REAL,
                    original_price_paid REAL,
                    original_purchase_value REAL,
                    broker_price_paid REAL,
                    broker_purchase_value REAL,
                    div_frequency_locked INTEGER DEFAULT 0,
                    div_manual_until TEXT,
                    div_manual_set_at TEXT,
                    div_dates_manual_until TEXT,
                    div_dates_manual_set_at TEXT
                );
                CREATE TABLE holdings (description TEXT);
                INSERT INTO all_account_info (
                    ticker, description, price_paid, purchase_value,
                    original_price_paid, original_purchase_value,
                    broker_price_paid, broker_purchase_value,
                    div_frequency_locked
                ) VALUES ('TEST', 'Test Holding', 10, 100, 10, 100, 10, 100, 0);
                INSERT INTO all_account_info (
                    ticker, description, price_paid, purchase_value,
                    original_price_paid, original_purchase_value,
                    broker_price_paid, broker_purchase_value,
                    div_frequency_locked
                ) VALUES ('NOBASIS', 'No Basis Holding', NULL, NULL, NULL, NULL, NULL, NULL, 0);
                """
            )
            setup.commit()
            setup.close()

            blocker = sqlite3.connect(db_path, timeout=0.05)
            blocker.execute("BEGIN IMMEDIATE")

            reader = sqlite3.connect(db_path, timeout=0.05)
            reader.execute("PRAGMA busy_timeout=50")

            # A normalized database needs no writes, so a concurrent writer
            # must not stop a read-only page from completing this check.
            app_module._ensure_basis_columns(reader)
            self.assertFalse(reader.in_transaction)
        finally:
            if reader is not None:
                reader.close()
            if blocker is not None:
                blocker.rollback()
                blocker.close()
            if os.path.exists(db_path):
                os.unlink(db_path)

    def test_safety_cache_does_not_hold_writer_lock_during_provider_calls(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        transaction_states = []

        def build_payload(ticker, _holding):
            transaction_states.append(conn.in_transaction)
            return {
                "ticker": ticker,
                "model_version": dividend_safety.SAFETY_MODEL_VERSION,
                "safety_score": 80,
                "risk_level": "Low",
            }

        holdings = [{"ticker": "AAA"}, {"ticker": "BBB"}]
        try:
            with patch.object(dividend_safety, "_build_payload", side_effect=build_payload):
                result = dividend_safety.get_dividend_safety_for_holdings(
                    conn, 1, holdings, refresh=True
                )

            self.assertEqual(transaction_states, [False, False])
            self.assertEqual(set(result), {"AAA", "BBB"})
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM dividend_safety_cache").fetchone()[0],
                2,
            )
            self.assertFalse(conn.in_transaction)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
