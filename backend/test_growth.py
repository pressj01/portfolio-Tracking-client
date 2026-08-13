import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class GrowthApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT, profile_id INTEGER, quantity REAL, current_value REAL,
                purchase_value REAL, purchase_date TEXT, import_date TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY, ticker TEXT, profile_id INTEGER,
                transaction_type TEXT, transaction_date TEXT, shares REAL,
                price_per_share REAL, fees REAL
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
            INSERT INTO all_account_info
                VALUES ('AAA', 6, 2, 28, 20, '2024-01-02', NULL);
            INSERT INTO transactions
                VALUES (1, 'AAA', 6, 'BUY', '2024-01-02', 2, 10, 0);
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
        }, axis=1)
        self.download_tickers = None
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
        self.download_tickers = tickers
        self.download_kwargs = kwargs
        return self.market_data.copy()

    def test_all_begins_at_first_trade_and_syncs_every_chart(self):
        response = self.client.get(
            "/api/growth/data?profile_id=6&period=all&benchmark=SPY"
        )
        data = response.get_json()

        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(self.download_kwargs["start"], "2024-01-02")
        self.assertEqual(data["actual_start_date"], "2024-01-02")
        self.assertEqual(data["portfolio_metrics"]["price_return_pct"], 20.0)
        self.assertEqual(data["portfolio_metrics"]["total_return_pct"], 40.0)
        self.assertEqual(data["ticker_returns"], [{
            "ticker": "AAA",
            "return_pct": 40.0,
        }])
        self.assertEqual(data["heatmap"]["windows"], ["From First Trade"])
        self.assertEqual(data["heatmap"]["values"], [[40.0]])
        self.assertEqual(data["treemap"], [{
            "ticker": "AAA",
            "return_pct": 40.0,
            "market_value": 28.0,
            "allocation_pct": 100.0,
            "quantity": 2.0,
        }])

    def test_ticker_bars_use_the_portfolio_cards_trimmed_index(self):
        calls = []
        build = app_module._build_transaction_aware_portfolio_series

        def record_index(close, *args, **kwargs):
            calls.append([timestamp.strftime("%Y-%m-%d") for timestamp in close.index])
            return build(close, *args, **kwargs)

        app_module._build_transaction_aware_portfolio_series = record_index
        try:
            response = self.client.get(
                "/api/growth/data?profile_id=6&period=all&benchmark=SPY"
            )
        finally:
            app_module._build_transaction_aware_portfolio_series = build

        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(calls[-1], ["2024-01-02", "2024-12-31"])

    def test_custom_range_requires_both_dates(self):
        response = self.client.get(
            "/api/growth/data?profile_id=6&period=custom&start_date=2024-01-02"
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("both", response.get_json()["error"].lower())

    def test_tracker_return_includes_fully_sold_historical_ticker(self):
        conn = sqlite3.connect(self.db_path)
        conn.executemany(
            """INSERT INTO transactions
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (2, "SOLD", 6, "BUY", "2023-01-02", 1, 100, 0),
                (3, "SOLD", 6, "SELL", "2023-01-03", 1, 50, 0),
            ],
        )
        conn.commit()
        conn.close()

        dates = pd.to_datetime([
            "2023-01-02", "2023-01-03", "2024-01-02", "2024-12-31",
        ])
        close = pd.DataFrame(
            {
                "AAA": [None, None, 10.0, 12.0],
                "SOLD": [100.0, 50.0, 50.0, 50.0],
                "SPY": [90.0, 91.0, 100.0, 110.0],
            },
            index=dates,
        )
        adjusted = close.copy()
        adjusted.loc[pd.Timestamp("2024-12-31"), "AAA"] = 14.0
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        self.market_data = pd.concat({
            "Close": close,
            "Adj Close": adjusted,
            "Dividends": zeros,
        }, axis=1)

        response = self.client.get(
            "/api/growth/data?profile_id=6&period=all&benchmark=SPY"
        )
        data = response.get_json()

        self.assertEqual(response.status_code, 200, data)
        self.assertIn("SOLD", self.download_tickers)
        self.assertEqual(data["actual_start_date"], "2023-01-02")
        self.assertEqual(data["portfolio_metrics"]["total_return_pct"], -30.0)
        self.assertEqual(
            [row["ticker"] for row in data["ticker_returns"]],
            ["AAA"],
        )


if __name__ == "__main__":
    unittest.main()
