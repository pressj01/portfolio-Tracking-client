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
from grading import min_observations_for_window


def _blank_coverage(*_args, **_kwargs):
    return {
        "results": [],
        "aggregate_coverage": None,
        "aggregate_severity": None,
    }


def _market_frame(periods, start="2026-07-27"):
    dates = pd.bdate_range(start, periods=periods)
    step = np.arange(len(dates), dtype=float)
    close = pd.DataFrame(
        {
            "AAA": 100 + step * 0.8 + np.sin(step / 2),
            "BBB": 80 + step * 0.4 + np.cos(step / 3),
            "CCC": 50 + step * 0.25 + np.sin(step / 5),
            "BTCI": 60 + step * 0.15 + np.sin(step / 6),
            "SPY": 475 + step * 0.9 + np.sin(step / 4),
            "QQQ": 405 + step * 1.1 + np.cos(step / 5),
            "BTC-USD": 65000 + step * 8 + np.cos(step / 4),
        },
        index=dates,
    )
    zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
    return pd.concat(
        {
            "Close": close,
            "Adj Close": close,
            "Dividends": zeros,
        },
        axis=1,
    )


class MinObservationsForWindowTest(unittest.TestCase):
    def test_one_month_scales_below_the_thirty_day_floor(self):
        # 21 return observations is a typical 1M window. 80% coverage, min 15.
        self.assertEqual(min_observations_for_window(20), 16)

    def test_year_keeps_the_default_floor(self):
        self.assertEqual(min_observations_for_window(251), 30)

    def test_week_is_too_short_to_grade(self):
        self.assertIsNone(min_observations_for_window(5))


class AnalyticsDataPeriodTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT, profile_id INTEGER, quantity REAL,
                current_price REAL, current_value REAL,
                purchase_date TEXT, import_date TEXT,
                description TEXT, classification_type TEXT,
                estim_payment_per_year REAL,
                nav_erosion_scope TEXT, nav_benchmark_override TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY, ticker TEXT, profile_id INTEGER,
                transaction_type TEXT, transaction_date TEXT, shares REAL,
                price_per_share REAL, fees REAL
            );
            INSERT INTO all_account_info VALUES
                ('AAA', 1, 10, 100, 1200, '2024-01-02', NULL, '', '', 0, 'auto', NULL);
            INSERT INTO all_account_info VALUES
                ('BBB', 1, 20, 80, 1800, '2024-01-02', NULL, '', '', 0, 'auto', NULL);
            INSERT INTO all_account_info VALUES
                ('CCC', 1, 8, 50, 500, '2024-01-02', NULL, '', '', 0, 'auto', NULL);
            INSERT INTO transactions
                VALUES (1, 'AAA', 1, 'BUY', '2024-01-02', 10, 100, 0);
            INSERT INTO transactions
                VALUES (2, 'BBB', 1, 'BUY', '2024-01-02', 20, 80, 0);
            INSERT INTO transactions
                VALUES (3, 'CCC', 1, 'BUY', '2024-01-02', 8, 50, 0);
            """
        )
        conn.commit()
        conn.close()

        self.market_data = _market_frame(22)
        self.download_kwargs = []
        self.download_tickers = []

        self.orig_connection = app_module.get_connection
        self.orig_download = app_module._chunked_yf_download
        self.orig_coverage = app_module._build_nav_coverage_payload
        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module._chunked_yf_download = self._download
        app_module._build_nav_coverage_payload = _blank_coverage
        app_module.app.testing = True
        app_module.app._db_initialized = True
        app_module._PORTFOLIO_SUMMARY_CACHE.clear()
        app_module._ticker_info_cache.clear()
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._chunked_yf_download = self.orig_download
        app_module._build_nav_coverage_payload = self.orig_coverage
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
        self.download_tickers.append(tickers)
        self.download_kwargs.append(dict(kwargs))
        frame = self.market_data.copy()
        names = tickers.split() if isinstance(tickers, str) else [str(t) for t in tickers]
        # Simulate Yahoo: crypto prints on Saturday only when BTC-USD was requested.
        if "BTC-USD" in names:
            sat = pd.Timestamp(frame.index[-1]) + pd.Timedelta(days=1)
            while sat.weekday() != 5:
                sat += pd.Timedelta(days=1)
            extra = pd.DataFrame(
                0.0,
                index=[sat],
                columns=frame["Close"].columns,
            )
            extra["BTC-USD"] = 66000.0
            extra = pd.concat({"Close": extra, "Adj Close": extra, "Dividends": extra * 0}, axis=1)
            frame = pd.concat([frame, extra])
        return frame

    def _post_analytics(self, period="1mo"):
        return self.client.post(
            "/api/analytics/data?profile_id=1",
            json={
                "tickers": ["AAA", "BBB", "CCC"],
                "benchmark": "SPY",
                "period": period,
                "mode": "metrics",
            },
        )

    @patch("yfinance.Ticker")
    def test_one_month_returns_metrics_instead_of_a_blank_page(self, ticker_mock):
        ticker_mock.return_value.info = {}
        response = self._post_analytics("1mo")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        self.assertFalse(payload.get("error"), payload)
        self.assertGreaterEqual(len(payload.get("metrics") or []), 3, payload)
        self.assertTrue(payload.get("portfolio_metrics", {}).get("grade", {}).get("overall"), payload)
        self.assertIsNotNone(payload["portfolio_metrics"].get("sharpe"), payload)
        self.assertIsNotNone(payload["portfolio_metrics"].get("ulcer_index"), payload)
        self.assertEqual(payload["portfolio_metrics"].get("n_holdings_graded"), 3, payload)
        self.assertEqual(payload["portfolio_metrics"].get("grade_excluded") or [], [])
        self.assertFalse(payload.get("window_too_short"), payload)
        self.assertLess(payload.get("data_window", {}).get("trading_days"), 40)
        # Calendar-month window, not yfinance period="1mo".
        self.assertTrue(self.download_kwargs)
        self.assertIn("start", self.download_kwargs[0])
        self.assertNotEqual(self.download_kwargs[0].get("period"), "1mo")

    @patch("yfinance.Ticker")
    def test_one_month_grade_matches_dashboard(self, ticker_mock):
        ticker_mock.return_value.info = {}
        analytics_response = self._post_analytics("1mo")
        dashboard_response = self.client.get(
            "/api/portfolio-summary/data?profile_id=1&period=1m"
        )
        analytics = analytics_response.get_json()
        dashboard = dashboard_response.get_json()

        self.assertEqual(analytics_response.status_code, 200, analytics)
        self.assertEqual(dashboard_response.status_code, 200, dashboard)
        self.assertEqual(
            analytics["portfolio_metrics"]["grade"]["overall"],
            dashboard["portfolio_grade"]["overall"],
            (analytics["portfolio_metrics"], dashboard["portfolio_grade"]),
        )
        self.assertEqual(
            analytics["portfolio_metrics"]["grade"]["score"],
            dashboard["portfolio_grade"]["score"],
        )
        self.assertEqual(
            analytics["portfolio_metrics"]["sharpe"],
            dashboard["portfolio_grade"]["sharpe"],
        )
        self.assertEqual(
            analytics["portfolio_metrics"]["sortino"],
            dashboard["portfolio_grade"]["sortino"],
        )
        self.assertEqual(
            analytics["portfolio_metrics"]["ulcer_index"],
            dashboard["portfolio_grade"]["ulcer_index"],
        )
        analytics_by_ticker = {row["ticker"]: row for row in analytics["metrics"]}
        for ticker, grade in dashboard["ticker_grades"].items():
            if grade.get("score") is None:
                continue
            self.assertIn(ticker, analytics_by_ticker)
            self.assertEqual(analytics_by_ticker[ticker]["grade"], grade["grade"], ticker)
            self.assertEqual(analytics_by_ticker[ticker]["score"], grade["score"], ticker)

    @patch("yfinance.Ticker")
    def test_one_year_still_returns_metrics(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.market_data = _market_frame(80, start="2025-08-27")
        response = self._post_analytics("1y")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        self.assertGreaterEqual(len(payload.get("metrics") or []), 3, payload)
        self.assertTrue(payload.get("portfolio_metrics", {}).get("grade", {}).get("overall"), payload)
        self.assertFalse(payload.get("window_too_short"), payload)

    @patch("yfinance.Ticker")
    def test_window_shorter_than_fifteen_days_is_flagged(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.market_data = _market_frame(8)
        response = self._post_analytics("1mo")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        self.assertTrue(payload.get("window_too_short"), payload)
        self.assertEqual(payload.get("metrics") or [], [])
        self.assertFalse((payload.get("portfolio_metrics") or {}).get("grade", {}).get("overall"))

    @patch("yfinance.Ticker")
    def test_crypto_nav_benchmarks_are_not_pulled_into_the_grade(self, ticker_mock):
        ticker_mock.return_value.info = {}
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO all_account_info VALUES "
            "('BTCI', 1, 5, 50, 400, '2024-01-02', NULL, '', '', 0, 'auto', NULL)"
        )
        conn.commit()
        conn.close()

        analytics_response = self.client.post(
            "/api/analytics/data?profile_id=1",
            json={
                "tickers": ["AAA", "BBB", "CCC", "BTCI"],
                "benchmark": "SPY",
                "period": "3mo",
                "mode": "metrics",
            },
        )
        dashboard_response = self.client.get(
            "/api/portfolio-summary/data?profile_id=1&period=3m"
        )
        analytics = analytics_response.get_json()
        dashboard = dashboard_response.get_json()

        self.assertEqual(analytics_response.status_code, 200, analytics)
        self.assertEqual(dashboard_response.status_code, 200, dashboard)
        requested = " ".join(str(t) for t in self.download_tickers)
        self.assertNotIn("BTC-USD", requested)
        self.assertEqual(
            analytics["portfolio_metrics"]["grade"]["overall"],
            dashboard["portfolio_grade"]["overall"],
            (analytics["portfolio_metrics"], dashboard["portfolio_grade"]),
        )
        self.assertEqual(
            analytics["portfolio_metrics"]["grade"]["score"],
            dashboard["portfolio_grade"]["score"],
        )
        self.assertEqual(
            analytics["portfolio_metrics"]["ulcer_index"],
            dashboard["portfolio_grade"]["ulcer_index"],
        )


if __name__ == "__main__":
    unittest.main()
