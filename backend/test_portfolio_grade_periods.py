import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class PortfolioGradePeriodApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT, profile_id INTEGER, quantity REAL,
                current_value REAL, purchase_date TEXT, import_date TEXT
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
                VALUES ('AAA', 6, 10, 1200, '2024-01-02', NULL);
            INSERT INTO all_account_info
                VALUES ('BBB', 6, 20, 1800, '2024-01-02', NULL);
            INSERT INTO transactions
                VALUES (1, 'AAA', 6, 'BUY', '2024-01-02', 10, 100, 0);
            INSERT INTO transactions
                VALUES (2, 'BBB', 6, 'BUY', '2024-01-02', 20, 80, 0);
            INSERT INTO transactions
                VALUES (3, 'CCC', 6, 'BUY', '2023-12-15', 5, 50, 0);
            """
        )
        conn.commit()
        conn.close()

        dates = pd.bdate_range("2024-01-02", periods=45)
        step = np.arange(len(dates), dtype=float)
        close = pd.DataFrame(
            {
                "AAA": 100 + step * 0.7 + np.sin(step / 2),
                "BBB": 80 + step * 0.35 + np.cos(step / 3),
                "SPY": 475 + step * 0.9 + np.sin(step / 4),
                "QQQ": 405 + step * 1.1 + np.cos(step / 5),
            },
            index=dates,
        )
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        self.market_data = pd.concat(
            {
                "Close": close,
                "Adj Close": close,
                "Dividends": zeros,
            },
            axis=1,
        )

        self.orig_connection = app_module.get_connection
        self.orig_download = app_module._chunked_yf_download
        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module._chunked_yf_download = self._download
        app_module.app.testing = True
        app_module.app._db_initialized = True
        app_module._PORTFOLIO_SUMMARY_CACHE.clear()
        app_module._ticker_info_cache.clear()
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._chunked_yf_download = self.orig_download
        app_module.app.testing = self.orig_testing
        app_module.app._db_initialized = self.orig_initialized
        app_module._PORTFOLIO_SUMMARY_CACHE.clear()
        app_module._ticker_info_cache.clear()
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _download(self, tickers, **kwargs):
        return self.market_data.copy()

    @patch("yfinance.Ticker")
    def test_dashboard_and_growth_use_same_all_period_grade(self, ticker_mock):
        ticker_mock.return_value.info = {}

        dashboard_response = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=all"
        )
        growth_response = self.client.get(
            "/api/growth/data?profile_id=6&period=all&benchmark=SPY"
        )
        dashboard = dashboard_response.get_json()
        growth = growth_response.get_json()

        self.assertEqual(dashboard_response.status_code, 200, dashboard)
        self.assertEqual(growth_response.status_code, 200, growth)
        self.assertEqual(dashboard["period_label"], "From First Trade")
        self.assertEqual(dashboard["requested_start_date"], "2023-12-15")
        self.assertEqual(growth["requested_start_date"], "2023-12-15")
        self.assertEqual(dashboard["actual_start_date"], "2024-01-02")
        self.assertEqual(dashboard["actual_end_date"], growth["actual_end_date"])
        self.assertEqual(
            dashboard["portfolio_grade"]["overall"],
            growth["grade"]["overall"],
        )
        self.assertEqual(
            dashboard["portfolio_grade"]["score"],
            growth["grade"]["score"],
        )
        self.assertEqual(
            dashboard["portfolio_grade"]["sharpe"],
            growth["grade"]["sharpe"],
        )
        self.assertEqual(
            dashboard["portfolio_grade"]["sortino"],
            growth["grade"]["sortino"],
        )

    def test_dashboard_custom_range_validation_is_visible(self):
        response = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=custom"
            "&start_date=2024-02-01"
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("both", response.get_json()["error"].lower())

    def test_lifetime_period_does_not_grade(self):
        response = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=lifetime"
        )
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        self.assertTrue(payload["grade_not_applicable"])
        self.assertEqual(payload["period_key"], "lifetime")
        self.assertIsNone(payload["portfolio_grade"].get("overall"))
        self.assertTrue(payload["portfolio_grade"]["grade_not_applicable"])
        self.assertEqual(payload["ticker_grades"]["AAA"]["grade"], "N/A")

    @patch("yfinance.Ticker")
    def test_grade_does_not_block_on_live_info_when_history_downloads(self, ticker_mock):
        ticker_mock.side_effect = AssertionError("live .info must not block grades")

        response = self.client.get("/api/portfolio-summary/data?profile_id=6&period=1y")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        self.assertTrue(payload["portfolio_grade"].get("overall"), payload)
        self.assertIsNotNone(payload["portfolio_grade"].get("sharpe"), payload)
        self.assertIsNotNone(payload["portfolio_grade"].get("sortino"), payload)
        ticker_mock.assert_not_called()

    @patch("yfinance.Ticker")
    def test_closure_risk_uses_provider_catalog_not_live_info(self, ticker_mock):
        ticker_mock.side_effect = AssertionError("live .info must not block grades")
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """CREATE TABLE etf_provider_funds (
                provider_id INTEGER, symbol TEXT, fund_name TEXT,
                assets REAL, exp_ratio REAL
            )"""
        )
        conn.execute(
            "INSERT INTO etf_provider_funds VALUES (1, 'AAA', 'Alpha', 8000000, 0.99)"
        )
        conn.commit()
        conn.close()

        response = self.client.get("/api/portfolio-summary/data?profile_id=6&period=1y")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        self.assertTrue(payload["portfolio_grade"].get("overall"), payload)
        self.assertEqual(payload["ticker_closure_risk"]["AAA"]["tier"], "high")
        ticker_mock.assert_not_called()

    def test_close_series_keeps_the_requested_ticker_column(self):
        dates = pd.bdate_range("2024-01-02", periods=3)
        raw = pd.concat(
            {
                "Close": pd.DataFrame(
                    {"AAA": [1.0, 2.0, 3.0], "BBB": [9.0, 8.0, 7.0]},
                    index=dates,
                )
            },
            axis=1,
        )
        series = app_module._yf_close_series(raw, "BBB")
        self.assertEqual(list(series.values), [9.0, 8.0, 7.0])


class RateLimitedTickerRecoveryTest(unittest.TestCase):
    """A symbol Yahoo rate-limits comes back as an all-NaN column, not a missing one.

    That is the shape of the outage that made most of a portfolio grade "N/A":
    the recovery pass only re-fetched symbols whose column was absent, so the
    NaN-filled ones were never retried, and the resulting N/A grades were then
    cached for the full TTL.
    """

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT, profile_id INTEGER, quantity REAL,
                current_value REAL, purchase_date TEXT, import_date TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY, ticker TEXT, profile_id INTEGER,
                transaction_type TEXT, transaction_date TEXT, shares REAL,
                price_per_share REAL, fees REAL
            );
            INSERT INTO all_account_info VALUES ('AAA', 6, 10, 1200, '2024-01-02', NULL);
            INSERT INTO all_account_info VALUES ('BBB', 6, 20, 1800, '2024-01-02', NULL);
            INSERT INTO all_account_info VALUES ('CCC', 6, 30, 2400, '2024-01-02', NULL);
            INSERT INTO all_account_info VALUES ('DDD', 6, 40, 3200, '2024-01-02', NULL);
            INSERT INTO transactions VALUES (1, 'AAA', 6, 'BUY', '2024-01-02', 10, 100, 0);
            INSERT INTO transactions VALUES (2, 'BBB', 6, 'BUY', '2024-01-02', 20, 80, 0);
            INSERT INTO transactions VALUES (3, 'CCC', 6, 'BUY', '2024-01-02', 30, 60, 0);
            INSERT INTO transactions VALUES (4, 'DDD', 6, 'BUY', '2024-01-02', 40, 40, 0);
            """
        )
        conn.commit()
        conn.close()

        dates = pd.bdate_range("2024-01-02", periods=60)
        step = np.arange(len(dates), dtype=float)
        self.close = pd.DataFrame(
            {
                "AAA": 100 + step * 0.7 + np.sin(step / 2),
                "BBB": 80 + step * 0.35 + np.cos(step / 3),
                "CCC": 60 + step * 0.5 + np.sin(step / 5),
                "DDD": 40 + step * 0.3 + np.cos(step / 7),
                "SPY": 475 + step * 0.9 + np.sin(step / 4),
                "QQQ": 405 + step * 1.1 + np.cos(step / 5),
            },
            index=dates,
        )
        # The failure signature: the batch prices everything except CCC, whose
        # column is present but NaN end to end.
        self.rate_limited = self.close.copy()
        self.rate_limited["CCC"] = np.nan

        self.batch_calls = []
        self.single_calls = []
        self.refetch_fails = set()

        self.orig_connection = app_module.get_connection
        self.orig_download = app_module._chunked_yf_download
        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module._chunked_yf_download = self._download
        app_module.app.testing = True
        app_module.app._db_initialized = True
        app_module._PORTFOLIO_SUMMARY_CACHE.clear()
        app_module._ticker_info_cache.clear()
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._chunked_yf_download = self.orig_download
        app_module.app.testing = self.orig_testing
        app_module.app._db_initialized = self.orig_initialized
        app_module._PORTFOLIO_SUMMARY_CACHE.clear()
        app_module._ticker_info_cache.clear()
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _frame(self, close):
        zeros = pd.DataFrame(0.0, index=close.index, columns=close.columns)
        return pd.concat({"Close": close, "Adj Close": close, "Dividends": zeros}, axis=1)

    def _download(self, tickers, **kwargs):
        symbols = tickers.split() if isinstance(tickers, str) else list(tickers)
        if len(symbols) > 1:
            self.batch_calls.append(symbols)
            return self._frame(self.rate_limited.copy())
        self.single_calls.append(symbols[0])
        if symbols[0] in self.refetch_fails:
            return pd.DataFrame()
        return self._frame(self.close[[symbols[0]]].copy())

    @patch("yfinance.Ticker")
    def test_nan_filled_column_is_refetched_and_graded(self, ticker_mock):
        ticker_mock.return_value.info = {}

        payload = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()

        self.assertIn("CCC", self.single_calls, "the NaN column was never re-fetched")
        self.assertFalse(payload["price_feed_outage"], payload)
        self.assertNotEqual(payload["ticker_grades"]["CCC"]["grade"], "N/A", payload)
        self.assertIsNotNone(payload["ticker_risk"]["CCC"]["beta"])
        self.assertEqual(payload["unpriced_tickers"], [])

    @patch("yfinance.Ticker")
    def test_majority_outage_is_reported_and_not_cached(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.rate_limited = self.close.copy()
        self.rate_limited[["CCC", "DDD"]] = np.nan
        self.refetch_fails = {"CCC", "DDD"}

        payload = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()

        # AAA and BBB still grade, so the portfolio grade and benchmark betas
        # compute — which is exactly the case the old cache guard let through.
        self.assertTrue(payload["portfolio_grade"].get("overall"), payload)
        self.assertTrue(payload["price_feed_outage"], payload)
        self.assertEqual(sorted(payload["unpriced_tickers"]), ["CCC", "DDD"])
        self.assertEqual(payload["unresolved_symbols"], [])
        self.assertEqual(len(app_module._PORTFOLIO_SUMMARY_CACHE), 0)

        # A second load must actually retry rather than replay the blank grades.
        self.batch_calls.clear()
        self.rate_limited = self.close.copy()
        self.refetch_fails = set()
        payload = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()

        self.assertTrue(self.batch_calls, "the outage result was served from cache")
        for tk in ("CCC", "DDD"):
            self.assertNotEqual(payload["ticker_grades"][tk]["grade"], "N/A", payload)

    @patch("yfinance.Ticker")
    def test_unlistable_symbol_does_not_suppress_the_cache(self, ticker_mock):
        """A broker symbol Yahoo never had is permanent, not a transient outage.

        Interactive Brokers exports TSX Venture names as PGDC/SCOT/SKP (Yahoo:
        PGDC.V/...) and preferreds as CIM-PRB (Yahoo: CIM-PB). Treating those as
        an outage suppressed the profile's cache on every single load.
        """
        ticker_mock.return_value.info = {}
        self.refetch_fails = {"CCC"}

        payload = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()

        # AAA, BBB and DDD priced, so the feed is plainly working.
        self.assertFalse(payload["price_feed_outage"], payload)
        self.assertEqual(payload["unpriced_tickers"], ["CCC"])
        self.assertEqual(payload["unresolved_symbols"], ["CCC"])
        self.assertEqual(
            len(app_module._PORTFOLIO_SUMMARY_CACHE), 1,
            "one unlistable symbol must not cost the whole profile its cache",
        )

    @patch("yfinance.Ticker")
    def test_feed_wide_outage_does_not_retry_symbol_by_symbol(self, ticker_mock):
        ticker_mock.return_value.info = {}
        # Yahoo throttled the whole account: every column comes back NaN.
        self.rate_limited = self.close.copy()
        self.rate_limited[:] = np.nan

        payload = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()

        self.assertEqual(
            self.single_calls, [],
            "a feed-wide outage must not fan out into one request per holding",
        )
        self.assertEqual(sorted(payload["unpriced_tickers"]), ["AAA", "BBB", "CCC", "DDD"])
        self.assertEqual(len(app_module._PORTFOLIO_SUMMARY_CACHE), 0)


if __name__ == "__main__":
    unittest.main()
