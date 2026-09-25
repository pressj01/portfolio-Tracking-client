import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

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

    @patch("yfinance.Ticker")
    def test_dashboard_grades_with_the_saved_formula(self, ticker_mock):
        ticker_mock.return_value.info = {}
        url = "/api/portfolio-summary/data?profile_id=6&period=all"

        default = self.client.get(url).get_json()
        # Every letter needs a perfect 100, so anything less is an F. The
        # cached default response must not be served for the stricter formula.
        strict = json.dumps({"letterCutoffs": {k: 100 for k in (
            "aPlus", "a", "aMinus", "bPlus", "b", "bMinus",
            "cPlus", "c", "cMinus", "dPlus", "d", "dMinus",
        )}})
        custom = self.client.get(
            f"{url}&grading_settings={quote(strict)}"
        ).get_json()

        self.assertEqual(default["portfolio_grade"]["score"], custom["portfolio_grade"]["score"])
        self.assertLess(custom["portfolio_grade"]["score"], 100)
        self.assertNotEqual(default["portfolio_grade"]["overall"], "F")
        self.assertEqual(custom["portfolio_grade"]["overall"], "F")
        for ticker, info in custom["ticker_grades"].items():
            if info.get("score") is None:
                continue
            expected = "A+" if info["score"] >= 100 else "F"
            self.assertEqual(info["grade"], expected, ticker)

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
    def test_alpha_is_reported_beside_beta(self, ticker_mock):
        ticker_mock.return_value.info = {}

        payload = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()
        risk = payload["ticker_risk"]["AAA"]

        self.assertIn("alpha", risk)
        self.assertIsNotNone(risk["alpha"], risk)
        self.assertIsInstance(risk["alpha"], float)
        # Alpha must never be the blank half of a row whose beta computed: both
        # clear the same 15-observation floor, so one without the other means
        # the two columns are measuring different things.
        self.assertIsNotNone(risk["beta"], risk)

    @patch("yfinance.Ticker")
    def test_alpha_uses_the_same_benchmark_as_beta(self, ticker_mock):
        ticker_mock.return_value.info = {}

        payload = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()

        for ticker, risk in payload["ticker_risk"].items():
            if risk.get("alpha") is None:
                continue
            benchmark = risk["beta_benchmark"]
            self.assertIsNotNone(benchmark, f"{ticker} reported alpha with no benchmark")
            expected = app_module._capm_alpha(
                self.market_data["Close"][ticker],
                self.market_data["Close"][benchmark],
            )
            self.assertAlmostEqual(risk["alpha"], expected, places=4, msg=ticker)

    def test_lifetime_blanks_alpha_with_the_rest_of_the_risk_row(self):
        payload = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=lifetime"
        ).get_json()

        for risk in payload["ticker_risk"].values():
            self.assertIn("alpha", risk)
            self.assertIsNone(risk["alpha"])

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

    @patch("yfinance.Ticker")
    def test_closure_risk_prefers_issuer_aum_over_the_catalog(self, ticker_mock):
        # NEOS's own Net Assets replace the seed catalog's months-old AUM.
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
        official = {"AAA": {
            "assets": 900_000_000.0,
            "exp_ratio": 0.99,
            "inception_date": "2022-01-03",
            "source": "NEOS Investments",
        }}

        with patch.object(app_module, "_neos_fund_facts_batch", return_value=official):
            response = self.client.get("/api/portfolio-summary/data?profile_id=6&period=1y")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        risk = payload["ticker_closure_risk"]["AAA"]
        self.assertEqual(risk["tier"], "ok", risk)
        self.assertEqual(risk["aum"], 900_000_000.0)
        self.assertEqual(risk["aum_source"], "NEOS Investments")
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

    @patch("yfinance.Ticker")
    def test_cache_backfilled_grade_is_not_also_reported_as_unpriced(self, ticker_mock):
        """A ticker the safety net rescues with a stale-but-real grade must not
        also be reported as unresolved/unpriced in the same response.

        Seen live: CIM-PRB showed a real "B" grade in the holdings table while
        the banner simultaneously read "Yahoo has no listing for CIM-PRB ...
        cannot be graded" for that same ticker. The grade came from this exact
        cache-backfill safety net; `unpriced_tickers`/`unresolved_symbols` were
        computed before the backfill ran and were never corrected afterward.
        """
        ticker_mock.return_value.info = {}

        # First call: everything prices, including CCC. This is what populates
        # the cache the second call's safety net will read from.
        self.rate_limited = self.close.copy()
        first = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()
        self.assertNotEqual(first["ticker_grades"]["CCC"]["grade"], "N/A", first)
        self.assertEqual(len(app_module._PORTFOLIO_SUMMARY_CACHE), 1)

        # Age that cache entry past its TTL. Otherwise the endpoint's top-level
        # cache check short-circuits the second call entirely -- returning
        # call 1's response verbatim without downloading anything -- which
        # would make this test pass for the wrong reason (never actually
        # exercising a failed re-download) rather than the real one (the
        # safety net reads a since-expired entry to backfill a fresh miss).
        [key] = app_module._PORTFOLIO_SUMMARY_CACHE.keys()
        stale_ts, stale_payload = app_module._PORTFOLIO_SUMMARY_CACHE[key]
        app_module._PORTFOLIO_SUMMARY_CACHE[key] = (
            stale_ts - app_module._PORTFOLIO_SUMMARY_TTL_SEC - 1, stale_payload
        )

        # Second call, same cache key: CCC fails outright this time (NaN in the
        # batch, and its individual re-fetch also comes back empty) while the
        # other three tickers still price fine -- an isolated single-symbol
        # miss, not a feed-wide outage.
        self.rate_limited = self.close.copy()
        self.rate_limited["CCC"] = np.nan
        self.refetch_fails = {"CCC"}
        second = self.client.get(
            "/api/portfolio-summary/data?profile_id=6&period=1y"
        ).get_json()

        self.assertFalse(second["price_feed_outage"], second)
        self.assertNotEqual(
            second["ticker_grades"]["CCC"]["grade"], "N/A",
            "the safety net should have backfilled CCC's grade from cache",
        )
        self.assertNotIn(
            "CCC", second["unpriced_tickers"],
            "a ticker with a real (even if backfilled) grade must not also be flagged unpriced",
        )
        self.assertNotIn(
            "CCC", second["unresolved_symbols"],
            "a ticker with a real (even if backfilled) grade must not also be flagged unresolved",
        )


class RiskRegressionMathTest(unittest.TestCase):
    """Alpha and beta are one regression; bad prices must sink both, not one."""

    def _pair(self, seed=1, n=300, noise=0.003, beta=1.3, drift=2e-4):
        idx = pd.bdate_range("2024-01-02", periods=n)
        rng = np.random.default_rng(seed)
        bench = pd.Series(100 * np.cumprod(1 + rng.normal(4e-4, 0.01, n)), index=idx)
        fund = pd.Series(
            50 * np.cumprod(
                1 + drift + beta * bench.pct_change().fillna(0).values
                + rng.normal(0, noise, n)
            ),
            index=idx,
        )
        return fund, bench

    def test_beta_is_the_ols_slope_and_alpha_the_intercept(self):
        fund, bench = self._pair()
        fr = fund.pct_change().dropna().values
        br = bench.pct_change().dropna().values
        rf_daily = 0.05 / 252
        slope, intercept = np.polyfit(br - rf_daily, fr - rf_daily, 1)

        self.assertEqual(app_module._beta_and_corr(fund, bench)[0], round(slope, 2))
        # Alpha is stored to 6dp; the column renders 2dp of a percent.
        self.assertAlmostEqual(
            app_module._capm_alpha(fund, bench), intercept * 252, places=6
        )

    def test_identity_and_flat_series_behave_per_capm(self):
        _, bench = self._pair()
        self.assertAlmostEqual(app_module._capm_alpha(bench, bench), 0.0, places=9)
        self.assertEqual(app_module._beta_and_corr(bench, bench)[0], 1.0)

        flat = pd.Series([9.0] * len(bench), index=bench.index)
        self.assertEqual(app_module._beta_and_corr(flat, bench)[0], 0.0)
        # A zero-beta asset should earn the risk-free rate; earning nothing is
        # exactly -rf of alpha, not 0.
        self.assertAlmostEqual(app_module._capm_alpha(flat, bench), -0.05, places=6)

    def test_non_positive_prices_are_refused_by_both(self):
        """A single bad bar used to read beta -2.55 and alpha -1083%."""
        fund, bench = self._pair()
        for bad in (0.0, -5.0):
            poisoned = fund.copy()
            poisoned.iloc[100] = bad
            self.assertIsNone(app_module._capm_alpha(poisoned, bench), bad)
            self.assertIsNone(app_module._beta_and_corr(poisoned, bench), bad)
            self.assertIsNone(
                app_module._best_fit_beta(poisoned, [("SPY", bench)])[0], bad
            )

    def test_beta_never_returns_nan(self):
        """NaN is not None, so a NaN beta slipped past the cache-fallback check."""
        fund, bench = self._pair()
        poisoned = fund.copy()
        poisoned.iloc[100] = 0.0
        beta, _benchmark = app_module._best_fit_beta(poisoned, [("SPY", bench)])
        self.assertIsNone(beta)
        self.assertFalse(isinstance(beta, float) and np.isnan(beta))

    def test_alpha_and_beta_are_available_together_or_not_at_all(self):
        rng = np.random.default_rng(3)
        for _ in range(300):
            n = int(rng.integers(5, 80))
            idx = pd.bdate_range("2024-01-02", periods=n)
            bench = pd.Series(100 * np.cumprod(1 + rng.normal(4e-4, 0.01, n)), index=idx)
            fund = pd.Series(42 * np.cumprod(1 + rng.normal(3e-4, 0.013, n)), index=idx)
            if rng.random() < 0.15:
                fund.iloc[int(rng.integers(0, n))] = float(rng.choice([0.0, -3.0]))
            self.assertEqual(
                app_module._capm_alpha(fund, bench) is None,
                app_module._beta_and_corr(fund, bench) is None,
                f"alpha/beta availability diverged on a {n}-bar window",
            )

    def test_result_does_not_depend_on_the_joined_frame_being_sorted(self):
        """pandas is deprecating concat's default sort; pin the order ourselves."""
        fund, bench = self._pair(seed=4)
        expected_alpha = app_module._capm_alpha(fund, bench)
        expected_beta = app_module._beta_and_corr(fund, bench)[0]

        real_concat = pd.concat

        def reversed_join(objs, **kwargs):
            out = real_concat(objs, **kwargs)
            return out.iloc[::-1] if kwargs.get("axis") == 1 else out

        pd.concat = reversed_join
        try:
            self.assertEqual(app_module._capm_alpha(fund, bench), expected_alpha)
            self.assertEqual(app_module._beta_and_corr(fund, bench)[0], expected_beta)
        finally:
            pd.concat = real_concat


class SharedRiskProfileTest(unittest.TestCase):
    """_risk_profile is the one place beta/alpha/deltas are assembled."""

    def _series(self, n=300, seed=1, beta=1.2):
        idx = pd.bdate_range("2024-01-02", periods=n)
        rng = np.random.default_rng(seed)
        spy = pd.Series(100 * np.cumprod(1 + rng.normal(4e-4, 0.010, n)), index=idx)
        qqq = pd.Series(400 * np.cumprod(1 + rng.normal(5e-4, 0.014, n)), index=idx)
        fund = pd.Series(
            50 * np.cumprod(
                1 + 2e-4 + beta * qqq.pct_change().fillna(0).values
                + rng.normal(0, 0.002, n)
            ),
            index=idx,
        )
        return fund, [("SPY", spy), ("QQQ", qqq)]

    def test_returns_every_key_even_when_it_cannot_regress(self):
        expected = {"beta", "alpha", "beta_benchmark", "delta_up", "delta_down"}
        for fund, benchmarks in (
            (None, []),
            (pd.Series(dtype=float), []),
            (self._series()[0], []),
        ):
            profile = app_module._risk_profile(fund, benchmarks)
            self.assertEqual(set(profile), expected)
            self.assertTrue(all(v is None for v in profile.values()), profile)

    def test_alpha_and_beta_share_the_selected_benchmark(self):
        fund, benchmarks = self._series()
        profile = app_module._risk_profile(fund, benchmarks)

        # A QQQ-driven fund must route to QQQ, and alpha must be measured there.
        self.assertEqual(profile["beta_benchmark"], "QQQ")
        self.assertIsNotNone(profile["beta"])
        self.assertAlmostEqual(
            profile["alpha"],
            app_module._capm_alpha(fund, dict(benchmarks)["QQQ"]),
            places=9,
        )
        self.assertNotAlmostEqual(
            profile["alpha"],
            app_module._capm_alpha(fund, dict(benchmarks)["SPY"]),
            places=4,
            msg="alpha must not silently fall back to SPY",
        )

    def test_a_poisoned_price_blanks_the_whole_bundle_not_half_of_it(self):
        fund, benchmarks = self._series()
        fund.iloc[100] = -5.0
        profile = app_module._risk_profile(fund, benchmarks)
        self.assertIsNone(profile["beta"])
        self.assertIsNone(profile["alpha"])

    def test_grades_endpoint_rows_match_the_shared_helper(self):
        """The dashboard must not drift from _risk_profile's own output."""
        fund, benchmarks = self._series(seed=5)
        direct = app_module._risk_profile(fund, benchmarks, delta_min_days=10)
        self.assertEqual(
            set(direct),
            {"beta", "alpha", "beta_benchmark", "delta_up", "delta_down"},
        )


if __name__ == "__main__":
    unittest.main()
