import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class TrackerReturnAlignmentTest(unittest.TestCase):
    """Growth, Growth 2, and Total Return must report the same tracker TR%."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY, name TEXT, cash_value REAL DEFAULT 0
            );
            CREATE TABLE all_account_info (
                ticker TEXT, profile_id INTEGER, description TEXT,
                classification_type TEXT, quantity REAL, current_value REAL,
                purchase_value REAL, price_paid REAL, purchase_date TEXT,
                import_date TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY, ticker TEXT, profile_id INTEGER,
                transaction_type TEXT, transaction_date TEXT, shares REAL,
                price_per_share REAL, fees REAL, realized_gain REAL, notes TEXT
            );
            CREATE TABLE dividend_payments (
                ticker TEXT, profile_id INTEGER, payment_date TEXT,
                amount REAL, source TEXT
            );
            CREATE TABLE categories (
                id INTEGER, name TEXT, profile_id INTEGER, sort_order INTEGER
            );
            CREATE TABLE subcategories (
                id INTEGER, category_id INTEGER, name TEXT, profile_id INTEGER,
                sort_order INTEGER
            );
            CREATE TABLE ticker_categories (
                ticker TEXT, profile_id INTEGER, category_id INTEGER,
                subcategory_id INTEGER
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO profiles (id, name, cash_value) VALUES (6, 'Test', 0);
            INSERT INTO all_account_info VALUES (
                'AAA', 6, 'Example', 'Stock', 2, 24, 20, 10, '2024-01-02', NULL
            );
            INSERT INTO transactions
                VALUES (1, 'AAA', 6, 'BUY', '2024-01-02', 2, 10, 0, 0, '');
            """
        )
        conn.commit()
        conn.close()

        dates = pd.to_datetime(["1972-01-03", "2024-01-02", "2024-12-31"])
        close = pd.DataFrame(
            {"AAA": [1.0, 10.0, 12.0], "SPY": [2.0, 100.0, 110.0]},
            index=dates,
        )
        adjusted = pd.DataFrame(
            {"AAA": [1.0, 10.0, 14.0], "SPY": [2.0, 100.0, 115.0]},
            index=dates,
        )
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        self.market_data = pd.concat({
            "Close": close,
            "Adj Close": adjusted,
            "Dividends": zeros,
            "Capital Gains": zeros,
            "Stock Splits": zeros,
        }, axis=1)

        self.orig_connection = app_module.get_connection
        self.orig_download = app_module._chunked_yf_download
        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module._chunked_yf_download = self._download
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._chunked_yf_download = self.orig_download
        app_module.app.testing = self.orig_testing
        app_module.app._db_initialized = self.orig_initialized
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _download(self, tickers, **kwargs):
        return self.market_data.copy()

    def test_tracker_total_return_pct_matches_across_growth_total_return_and_growth_2(self):
        params = "profile_id=6&period=all"
        growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY")
        growth_2 = self.client.get(f"/api/growth-2/data?{params}")
        total_return = self.client.get(f"/api/total-return/charts?{params}")

        self.assertEqual(growth.status_code, 200, growth.get_json())
        self.assertEqual(growth_2.status_code, 200, growth_2.get_json())
        self.assertEqual(total_return.status_code, 200, total_return.get_json())

        growth_pct = growth.get_json()["portfolio_metrics"]["total_return_pct"]
        growth_2_pct = growth_2.get_json()["summary"]["total_return_pct"]
        total_return_pct = total_return.get_json()["portfolio_metrics"]["total_return_pct"]
        growth_price = growth.get_json()["portfolio_metrics"]["price_return_pct"]
        total_return_price = total_return.get_json()["portfolio_metrics"]["price_return_pct"]

        self.assertEqual(growth_pct, 40.0)
        self.assertEqual(growth_pct, growth_2_pct)
        self.assertEqual(growth_pct, total_return_pct)
        self.assertEqual(growth_price, 20.0)
        self.assertEqual(growth_price, total_return_price)

        growth_dollar = growth.get_json()["portfolio_metrics"]["price_return_dollar"]
        total_return_dollar = total_return.get_json()["portfolio_metrics"]["price_return_dollar"]
        growth_2_dollar = growth_2.get_json()["summary"]["price_return_amount"]
        self.assertEqual(growth_dollar, total_return_dollar)
        self.assertEqual(growth_dollar, growth_2_dollar)


if __name__ == "__main__":
    unittest.main()
