import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class TrackerReturnAlignmentTest(unittest.TestCase):
    """Growth, Growth 2, and Total Return must report the same tracker TR%."""

    def setUp(self):
        # The production cache keys include DB mtimes. Temporary files created
        # within the same clock tick can otherwise reuse a prior test's payload.
        app_module._TOTAL_RETURN_DASHBOARD_CACHE.clear()
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
            {
                "AAA": [1.0, 10.0, 12.0],
                "BBB": [1.0, 20.0, 18.0],
                "SPY": [2.0, 100.0, 110.0],
            },
            index=dates,
        )
        adjusted = pd.DataFrame(
            {
                "AAA": [1.0, 10.0, 14.0],
                "BBB": [1.0, 20.0, 17.0],
                "SPY": [2.0, 100.0, 115.0],
            },
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

    def test_category_scope_matches_between_dashboard_growth_and_total_return(self):
        conn = self._get_connection()
        conn.executescript(
            """
            INSERT INTO all_account_info VALUES (
                'BBB', 6, 'Other', 'Stock', 1, 18, 20, 20, '2024-01-02', NULL
            );
            INSERT INTO transactions
                VALUES (2, 'BBB', 6, 'BUY', '2024-01-02', 1, 20, 0, 0, '');
            INSERT INTO categories VALUES (10, 'Core', 6, 0);
            INSERT INTO categories VALUES (20, 'Other', 6, 1);
            INSERT INTO ticker_categories VALUES ('AAA', 6, 10, NULL);
            INSERT INTO ticker_categories VALUES ('BBB', 6, 20, NULL);
            """
        )
        conn.commit()
        conn.close()

        params = "profile_id=6&period=all&category=10"
        dashboard = self.client.get(f"/api/total-return/charts?{params}")
        growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY")

        self.assertEqual(dashboard.status_code, 200, dashboard.get_json())
        self.assertEqual(growth.status_code, 200, growth.get_json())
        dashboard_metrics = dashboard.get_json()["portfolio_metrics"]
        growth_metrics = growth.get_json()["portfolio_metrics"]
        for key in (
            "start_value",
            "end_value",
            "price_return_dollar",
            "price_return_pct",
            "distribution_dollar",
            "total_return_dollar",
            "total_return_pct",
        ):
            self.assertEqual(dashboard_metrics[key], growth_metrics[key], key)
        self.assertEqual(
            [row["ticker"] for row in dashboard.get_json()["performance_rows"]],
            ["AAA"],
        )

    def test_open_position_price_return_matches_across_tracking_pages(self):
        conn = self._get_connection()
        conn.executescript(
            """
            INSERT INTO transactions
                VALUES (2, 'BBB', 6, 'BUY', '2024-01-02', 1, 20, 0, 0, '');
            INSERT INTO transactions
                VALUES (3, 'BBB', 6, 'SELL', '2024-12-31', 1, 18, 0, -2, '');
            """
        )
        conn.commit()
        conn.close()

        params = "profile_id=6&period=all"
        growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY")
        tracker = self.client.get(f"/api/total-return/charts?{params}")

        self.assertEqual(growth.status_code, 200, growth.get_json())
        self.assertEqual(tracker.status_code, 200, tracker.get_json())
        growth_open = growth.get_json()["open_position_metrics"]
        tracker_open = tracker.get_json()["open_position_metrics"]
        for key in (
            "start_value",
            "end_value",
            "price_return_dollar",
            "price_return_pct",
            "total_return_pct",
        ):
            self.assertEqual(growth_open[key], tracker_open[key], key)
        self.assertEqual(tracker_open["price_return_dollar"], 4.0)
        self.assertEqual(tracker_open["price_return_pct"], 20.0)
        self.assertNotEqual(
            tracker.get_json()["portfolio_metrics"]["price_return_dollar"],
            tracker_open["price_return_dollar"],
        )

    def test_portfolio_tester_actual_history_reuses_tracker_total_return(self):
        history = app_module._portfolio_tester_actual_history(
            [6],
            "2024-01-02",
            "2024-12-31",
            selected_tickers=["AAA"],
        )
        tracker = self.client.get(
            "/api/total-return/charts?profile_id=6&period=custom"
            "&start_date=2024-01-02&end_date=2024-12-31"
        )

        self.assertEqual(tracker.status_code, 200, tracker.get_json())
        self.assertEqual(
            history["metrics"]["total_return_pct"],
            tracker.get_json()["portfolio_metrics"]["total_return_pct"],
        )
        self.assertEqual(history["actual_start_date"], "2024-01-02")
        self.assertEqual(history["actual_end_date"], "2024-12-31")
        self.assertAlmostEqual(history["values"][0], 100.0)
        self.assertAlmostEqual(history["values"][-1], 140.0)
        self.assertEqual(history["scope"], "selected_holdings")
        self.assertEqual(history["selected_tickers"], ["AAA"])

    def test_portfolio_tester_route_aligns_hypothetical_to_actual_coverage(self):
        history = {
            "dates": ["2024-03-01", "2024-12-31"],
            "values": [100.0, 120.0],
            "actual_start_date": "2024-03-01",
            "actual_end_date": "2024-12-31",
            "metrics": {"total_return_pct": 20.0},
        }
        run_result = {"valid": True, "portfolios": []}
        with patch.object(
            app_module,
            "_portfolio_tester_actual_history",
            return_value=history,
        ) as actual_history, patch("portfolio_tester.run_backtest", return_value=run_result) as run:
            response = self.client.post(
                "/api/portfolio-tester/run?profile_id=6",
                json={
                    "portfolios": [
                        {
                            "name": "Actual",
                            "source": "actual",
                            "holdings": [],
                            "actual_tickers": ["AAA"],
                        },
                        {
                            "name": "Alternative",
                            "source": "hypothetical",
                            "holdings": [{"ticker": "SPY", "weight": 1.0}],
                        },
                    ],
                    "start": "2024-01-01",
                    "end": "2024-12-31",
                    "initial": 10000,
                    "include_div": True,
                    "reinvest_div": True,
                    "include_benchmark": False,
                },
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        kwargs = run.call_args.kwargs
        self.assertEqual(kwargs["start"], "2024-03-01")
        self.assertEqual(kwargs["end"], "2024-12-31")
        self.assertEqual(kwargs["portfolios"][0]["history"], history)
        self.assertEqual(response.get_json()["requested_start"], "2024-01-01")
        self.assertEqual(actual_history.call_args.kwargs["selected_tickers"], ["AAA"])


if __name__ == "__main__":
    unittest.main()
