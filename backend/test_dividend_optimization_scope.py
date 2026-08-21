import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database as database_module


class DividendOptimizationScopeTest(unittest.TestCase):
    def setUp(self):
        temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        temp_file.close()
        self.db_path = temp_file.name
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        database_module.ensure_tables_exist(self.conn)
        self.conn.executemany(
            "INSERT OR REPLACE INTO profiles (id, name) VALUES (?, ?)",
            [(1, "Owner"), (2, "Selected"), (3, "Unrelated")],
        )
        self.conn.executemany(
            """INSERT INTO dividend_payments
               (ticker, profile_id, payment_date, amount, source)
               VALUES (?, ?, ?, ?, ?)""",
            [
                ("AAA", 2, "2026-08-05", 125.0, "broker_transactions"),
                ("AAA", 2, "2026-08-12", 999.0, "refresh_estimate"),
                ("BAD", 3, "2026-08-08", 500.0, "broker_transactions"),
            ],
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        Path(self.db_path).unlink(missing_ok=True)

    def test_current_month_uses_selected_account_actual_plus_remaining_schedule(self):
        holding = {
            "ticker": "AAA",
            "quantity": 10,
            "amount": 5,
            "payment_income": 50,
            "annual_income": 600,
            "freq": "M",
            "pay_date": "2026-08-25",
            "payment_history": ["2026-08-05"],
        }
        event = {
            **holding,
            "date": "2026-08-20",
            "pay_date": "2026-08-25",
            "pay_estimated": False,
        }

        result = app_module._dividend_optimization_current_month(
            self.conn,
            [holding],
            [event],
            False,
            [2],
            today=datetime.date(2026, 8, 20),
        )

        self.assertEqual(result["month"], "2026-08")
        self.assertEqual(result["recorded_income"], 125.0)
        self.assertEqual(result["remaining_scheduled_income"], 50.0)
        self.assertEqual(result["total_income"], 175.0)
        self.assertEqual(result["recorded_source"], "dividend_payments")

    def test_monthly_payout_fallback_is_scoped_to_selected_account(self):
        self.conn.execute(
            "INSERT INTO monthly_payouts (year, month, amount, profile_id) VALUES (2026, 8, 300, 2)"
        )
        self.conn.execute(
            "DELETE FROM dividend_payments WHERE profile_id = 2"
        )
        self.conn.commit()

        result = app_module._dividend_optimization_current_month(
            self.conn,
            [],
            [],
            False,
            [2],
            today=datetime.date(2026, 8, 20),
        )

        self.assertEqual(result["recorded_income"], 300.0)
        self.assertEqual(result["total_income"], 300.0)
        self.assertEqual(result["recorded_source"], "monthly_payouts")

    def test_holding_actuals_prevent_current_month_from_falling_below_paid_income(self):
        self.conn.execute("DELETE FROM dividend_payments WHERE profile_id = 2")
        self.conn.executemany(
            """INSERT INTO all_account_info
               (ticker, profile_id, quantity, current_month_income)
               VALUES (?, 2, 10, ?)""",
            [("AAA", 80.0), ("BBB", 45.0)],
        )
        self.conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, quantity, current_month_income)
               VALUES ('BAD', 3, 10, 500)"""
        )
        self.conn.commit()

        result = app_module._dividend_optimization_current_month(
            self.conn,
            [],
            [],
            False,
            [2],
            today=datetime.date(2026, 8, 20),
        )

        self.assertEqual(result["recorded_income"], 125.0)
        self.assertEqual(result["total_income"], 125.0)
        self.assertEqual(result["recorded_source"], "holding_actuals")


if __name__ == "__main__":
    unittest.main()
