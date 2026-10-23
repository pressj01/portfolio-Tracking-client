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
from grading import min_observations_for_window, portfolio_returns_frame


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
    return _as_download(close)


def _as_download(close):
    zeros = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    return pd.concat(
        {
            "Close": close,
            "Adj Close": close,
            "Dividends": zeros,
        },
        axis=1,
    )


def _volatile_market_frame(periods=120, start="2025-08-27", seed=7):
    """Prices with real down days, so the portfolio has a drawdown to measure."""
    dates = pd.bdate_range(start, periods=periods)
    rng = np.random.default_rng(seed)
    specs = {
        "AAA": (100, 0.0006, 0.022),
        "BBB": (80, 0.0002, 0.015),
        "CCC": (50, -0.0004, 0.030),
        "SPY": (475, 0.0004, 0.010),
        "QQQ": (405, 0.0005, 0.013),
    }
    close = pd.DataFrame(
        {
            name: base * np.cumprod(1 + rng.normal(drift, vol, len(dates)))
            for name, (base, drift, vol) in specs.items()
        },
        index=dates,
    )
    return _as_download(close)


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

    # Holdings are weighted by current value. The grade normalizes those dollars
    # itself; the drawdown chart and the Risk vs Return point once did not, so a
    # $3,500 portfolio compounded 3,500x its daily return.
    HELD_VALUES = {"AAA": 1200.0, "BBB": 1800.0, "CCC": 500.0}

    def _constituent_returns(self):
        """Daily returns per holding, on the basis the grade uses."""
        close = self.market_data["Close"][list(self.HELD_VALUES)]
        return portfolio_returns_frame(close)

    def _weight_fractions(self):
        total = sum(self.HELD_VALUES.values())
        return pd.Series({t: v / total for t, v in self.HELD_VALUES.items()})

    @patch("yfinance.Ticker")
    def test_drawdown_series_stays_within_a_total_loss(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.market_data = _volatile_market_frame()
        response = self._post_analytics("1y")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        series = payload["drawdown_series"]
        values = series["values"]
        self.assertEqual(len(values), len(self.market_data))
        self.assertEqual(len(series["dates"]), len(values))
        out_of_range = [v for v in values if not -100 <= v <= 0]
        self.assertEqual(out_of_range, [], out_of_range[:5])

        port_daily = self._constituent_returns().dot(self._weight_fractions())
        # The curve starts at 1.0 on the window's first date.
        cum = pd.concat([pd.Series([1.0]), (1 + port_daily).cumprod()], ignore_index=True)
        expected = (cum / cum.cummax() - 1) * 100
        # A flat line would pass the range check without measuring anything.
        self.assertLess(float(expected.min()), -3)
        np.testing.assert_allclose(values, expected.values, atol=0.0051)
        # The chart's trough is the max drawdown printed on the grade card.
        self.assertAlmostEqual(
            min(values),
            payload["portfolio_metrics"]["max_drawdown"] * 100,
            delta=0.0051,
        )

    @patch("yfinance.Ticker")
    def test_portfolio_point_is_the_weighted_mean_of_its_holdings(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.market_data = _volatile_market_frame()
        response = self._post_analytics("1y")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        point = payload["portfolio_metrics"]
        returns = self._constituent_returns()
        weights = self._weight_fractions()

        weighted_mean = sum(
            weights[t] * float(returns[t].mean() * 252) * 100 for t in self.HELD_VALUES
        )
        self.assertAlmostEqual(point["annual_ret"], weighted_mean, delta=0.0051)
        # A blend cannot return more than its best holding or less than its worst.
        annualized = [float(returns[t].mean() * 252) * 100 for t in self.HELD_VALUES]
        self.assertGreaterEqual(point["annual_ret"], min(annualized) - 0.0051)
        self.assertLessEqual(point["annual_ret"], max(annualized) + 0.0051)

        port_daily = returns.dot(weights)
        self.assertAlmostEqual(
            point["annual_vol"],
            float(port_daily.std() * np.sqrt(252)) * 100,
            delta=0.0051,
        )
        # Nor can it be more volatile than the weighted mean of their volatility.
        weighted_vol = sum(
            weights[t] * float(returns[t].std() * np.sqrt(252)) * 100
            for t in self.HELD_VALUES
        )
        self.assertLessEqual(point["annual_vol"], weighted_vol + 0.0051)

    @patch("yfinance.Ticker")
    def test_unheld_tickers_do_not_divide_by_a_zero_total(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.market_data = _volatile_market_frame()
        conn = sqlite3.connect(self.db_path)
        conn.execute("DELETE FROM all_account_info")
        conn.commit()
        conn.close()

        response = self._post_analytics("1y")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        # NaN here would reach the page as invalid JSON.
        self.assertNotIn("NaN", response.get_data(as_text=True))
        values = payload["drawdown_series"]["values"]
        self.assertEqual(len(values), len(self.market_data))
        self.assertTrue(all(v == 0 for v in values), values[:5])
        self.assertEqual(payload["portfolio_metrics"]["annual_ret"], 0)
        self.assertEqual(payload["portfolio_metrics"]["annual_vol"], 0)

    def test_builder_drawdown_series_stays_within_a_total_loss(self):
        # Portfolio Builder draws the same chart from its own dollar amounts.
        self.market_data = _volatile_market_frame()
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE builder_portfolios (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE builder_holdings (
                portfolio_id INTEGER, ticker TEXT, dollar_amount REAL
            );
            INSERT INTO builder_portfolios VALUES (1, 'Model');
            INSERT INTO builder_holdings VALUES (1, 'AAA', 1200);
            INSERT INTO builder_holdings VALUES (1, 'BBB', 1800);
            INSERT INTO builder_holdings VALUES (1, 'CCC', 500);
            """
        )
        conn.commit()
        conn.close()

        with patch.object(app_module, "_yf_ticker") as ticker_mock:
            ticker_mock.return_value.info = {}
            response = self.client.post(
                "/api/builder/portfolios/1/analyze",
                json={"benchmark": "SPY", "period": "1y"},
            )
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        values = payload["drawdown_series"]["values"]
        out_of_range = [v for v in values if not -100 <= v <= 0]
        self.assertEqual(out_of_range, [], out_of_range[:5])

        # Builder drops the first (return-less) row instead of zero-filling it.
        close = self.market_data["Close"][list(self.HELD_VALUES)]
        port_daily = close.pct_change().dropna().dot(self._weight_fractions())
        cum = (1 + port_daily).cumprod()
        expected = (cum / cum.cummax() - 1) * 100
        self.assertLess(float(expected.min()), -3)
        np.testing.assert_allclose(values, expected.values, atol=0.0051)


if __name__ == "__main__":
    unittest.main()
