import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class PortfolioGrowth2ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT, quantity REAL, price_paid REAL, purchase_value REAL,
                current_value REAL, purchase_date TEXT, profile_id INTEGER
            );
            CREATE TABLE categories (id INTEGER, name TEXT, profile_id INTEGER, sort_order INTEGER);
            CREATE TABLE ticker_categories (ticker TEXT, category_id INTEGER, profile_id INTEGER);
            CREATE TABLE transactions (
                ticker TEXT, transaction_type TEXT, transaction_date TEXT, shares REAL,
                price_per_share REAL, fees REAL, realized_gain REAL, profile_id INTEGER
            );
            CREATE TABLE dividend_payments (ticker TEXT, payment_date TEXT, amount REAL, profile_id INTEGER);
            INSERT INTO all_account_info VALUES ('AAA', 1, 8, 8, 12, '2024-01-02', 6);
            """
        )
        conn.commit()
        conn.close()

        dates = pd.to_datetime(["1980-01-02", "2024-01-02", "2024-12-31"])
        columns = pd.MultiIndex.from_tuples([
            ("Close", "AAA"),
            ("Dividends", "AAA"),
        ])
        self.raw = pd.DataFrame(
            [[1_000_000_000.0, 0.0], [10.0, 0.0], [12.0, 0.5]],
            index=dates,
            columns=columns,
        )
        self.download_kwargs = None

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
        self.download_kwargs = kwargs
        return self.raw.copy()

    def test_all_period_does_not_backfill_value_before_ownership(self):
        response = self.client.get("/api/growth-2/data?profile_id=6&period=all")
        data = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["dates"], ["2024-01-02", "2024-12-31"])
        self.assertEqual(data["portfolio_value"], [10.0, 12.0])
        self.assertEqual(data["invested"], [8.0, 8.0])

    def test_custom_range_is_inclusive_and_sent_to_yahoo(self):
        response = self.client.get(
            "/api/growth-2/data?profile_id=6&period=custom"
            "&start_date=2024-01-02&end_date=2024-12-31"
        )
        data = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["dates"], ["2024-01-02", "2024-12-31"])
        self.assertEqual(self.download_kwargs["start"], "2024-01-02")
        self.assertEqual(self.download_kwargs["end"], "2025-01-01")

    def test_custom_range_requires_two_ordered_dates(self):
        missing = self.client.get(
            "/api/growth-2/data?profile_id=6&period=custom&start_date=2024-01-02"
        )
        reversed_range = self.client.get(
            "/api/growth-2/data?profile_id=6&period=custom"
            "&start_date=2024-12-31&end_date=2024-01-02"
        )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(reversed_range.status_code, 400)


if __name__ == "__main__":
    unittest.main()
