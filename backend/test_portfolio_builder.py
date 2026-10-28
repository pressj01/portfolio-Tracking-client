"""Portfolio Builder grades a model the way Dashboard grades a real account."""

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
from grading import grade_portfolio, portfolio_returns_frame
from test_analytics_data import _as_download, _volatile_market_frame


def _no_yield(_ticker, _price):
    return 0.0, None


class PortfolioBuilderTest(unittest.TestCase):
    HELD = {"AAA": 1200.0, "BBB": 1800.0, "CCC": 500.0}

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
                purchase_date TEXT, import_date TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY, ticker TEXT, profile_id INTEGER,
                transaction_type TEXT, transaction_date TEXT, shares REAL,
                price_per_share REAL, fees REAL
            );
            CREATE TABLE builder_portfolios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id INTEGER NOT NULL DEFAULT 1,
                name TEXT NOT NULL, notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (profile_id, name)
            );
            CREATE TABLE builder_holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                portfolio_id INTEGER NOT NULL, ticker TEXT NOT NULL,
                dollar_amount REAL NOT NULL DEFAULT 0,
                added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (portfolio_id, ticker)
            );
            """
        )
        for ticker, value in self.HELD.items():
            conn.execute(
                "INSERT INTO all_account_info VALUES (?, 1, 10, ?, ?, '2020-01-02', NULL)",
                (ticker, value / 10, value),
            )
            conn.execute(
                "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, "
                "shares, price_per_share, fees) VALUES (?, 1, 'BUY', '2020-01-02', 10, ?, 0)",
                (ticker, value / 10),
            )
        conn.commit()
        conn.close()

        # Ends today, so Dashboard's calendar windows (1M = one month back from
        # today) land inside the data the way they do against Yahoo.
        start = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=260)[0]
        self.market_data = _volatile_market_frame(periods=260, start=start)
        self.download_kwargs = []
        self.orig_connection = app_module.get_connection
        self.orig_download = app_module._chunked_yf_download
        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module._chunked_yf_download = self._download
        app_module.app.testing = True
        app_module.app._db_initialized = True
        app_module._PORTFOLIO_SUMMARY_CACHE.clear()
        self.yield_patch = patch.object(app_module, "_builder_distribution_yield", side_effect=_no_yield)
        self.yield_patch.start()
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.yield_patch.stop()
        app_module.get_connection = self.orig_connection
        app_module._chunked_yf_download = self.orig_download
        app_module.app.testing = self.orig_testing
        app_module.app._db_initialized = self.orig_initialized
        app_module._PORTFOLIO_SUMMARY_CACHE.clear()
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _download(self, tickers, **kwargs):
        self.download_kwargs.append(dict(kwargs))
        # The real downloader trims to the close on or before the window start.
        return app_module._anchor_from_prior_close(
            self.market_data.copy(), kwargs.get("anchor_on_or_before"))

    def _portfolio(self, holdings, name="Model", profile_id=1):
        conn = sqlite3.connect(self.db_path)
        cur = conn.execute(
            "INSERT INTO builder_portfolios (profile_id, name) VALUES (?, ?)", (profile_id, name))
        pid = cur.lastrowid
        conn.executemany(
            "INSERT INTO builder_holdings (portfolio_id, ticker, dollar_amount) VALUES (?, ?, ?)",
            [(pid, t, a) for t, a in holdings.items()],
        )
        conn.commit()
        conn.close()
        return pid

    def _analyze(self, pid, period="1y", benchmark="SPY", profile_id=1):
        response = self.client.post(
            f"/api/builder/portfolios/{pid}/analyze?profile_id={profile_id}",
            json={"benchmark": benchmark, "period": period},
        )
        return response, response.get_json()

    # ── Same grade as Dashboard ──────────────────────────────────────────────

    def _assert_matches_dashboard(self, period):
        pid = self._portfolio(self.HELD)
        response, builder = self._analyze(pid, period=period)
        dash_response = self.client.get(f"/api/portfolio-summary/data?profile_id=1&period={period}")
        dashboard = dash_response.get_json()

        self.assertEqual(response.status_code, 200, builder)
        self.assertEqual(dash_response.status_code, 200, dashboard)
        bm = builder["portfolio_metrics"]
        dg = dashboard["portfolio_grade"]
        self.assertEqual(bm["grade"]["overall"], dg["overall"], (bm, dg))
        self.assertEqual(bm["grade"]["score"], dg["score"])
        for key in ("sharpe", "sortino", "calmar", "omega", "ulcer_index",
                    "max_drawdown", "capture_ratio", "diversification_ratio", "effective_n"):
            self.assertEqual(bm[key], dg[key], key)
        self.assertEqual(
            [(b["category"], b["score"]) for b in bm["grade"]["breakdown"]],
            [(b["category"], b["score"]) for b in dg["breakdown"]],
        )
        rows = {r["ticker"]: r for r in builder["holdings"]}
        for ticker, grade in dashboard["ticker_grades"].items():
            self.assertEqual(rows[ticker]["grade"], grade["grade"], ticker)
            self.assertEqual(rows[ticker]["score"], grade["score"], ticker)
        self.assertEqual(builder["window"]["actual_start_date"], dg["actual_start_date"])
        self.assertEqual(builder["window"]["window_observations"], dg["window_observations"])

    def test_one_year_grade_matches_dashboard(self):
        self._assert_matches_dashboard("1y")

    def test_one_month_grade_matches_dashboard(self):
        # The Builder used yfinance's own 1mo window and a fixed 30-return floor,
        # so every holding in a 1M view scored 0 and printed F.
        self._assert_matches_dashboard("1m")
        pid = self._portfolio(self.HELD, name="Again")
        _response, builder = self._analyze(pid, period="1m")
        self.assertTrue(all(r["graded"] and r["score"] > 0 for r in builder["holdings"]))
        self.assertLess(builder["window"]["window_observations"], 30)
        self.assertLess(builder["window"]["min_observations"], 30)
        self.assertIn("start", self.download_kwargs[-1])

    def test_nav_health_is_not_part_of_the_grade(self):
        pid = self._portfolio(self.HELD)
        _response, builder = self._analyze(pid)
        categories = [b["category"] for b in builder["portfolio_metrics"]["grade"]["breakdown"]]
        self.assertNotIn("NAV Health", categories)

    # ── Young, missing, and short histories ──────────────────────────────────

    def test_a_fund_too_young_to_grade_is_na_and_left_out_of_the_grade(self):
        close = self.market_data["Close"].copy()
        close["NEWF"] = np.nan
        close.iloc[-10:, close.columns.get_loc("NEWF")] = np.linspace(20, 21, 10)
        self.market_data = _as_download(close)
        pid = self._portfolio({**self.HELD, "NEWF": 1000.0})

        _response, builder = self._analyze(pid)

        rows = {r["ticker"]: r for r in builder["holdings"]}
        self.assertEqual(rows["NEWF"]["grade"], "N/A")
        self.assertIsNone(rows["NEWF"]["score"])
        self.assertFalse(rows["NEWF"]["graded"])
        self.assertEqual(builder["portfolio_metrics"]["n_graded"], 3)
        self.assertEqual([s["ticker"] for s in builder["notices"]["short_history"]], ["NEWF"])
        self.assertEqual([s["ticker"] for s in builder["notices"]["late_starters"]], ["NEWF"])
        # Same grade as the three graded holdings on their own.
        solo = self._portfolio(self.HELD, name="Without NEWF")
        _r, alone = self._analyze(solo)
        self.assertEqual(builder["portfolio_metrics"]["grade"]["score"],
                         alone["portfolio_metrics"]["grade"]["score"])

    def test_late_starter_counts_as_cash_before_its_first_quote(self):
        close = self.market_data["Close"].copy()
        start = len(close) - 120
        close["LATE"] = np.nan
        close.iloc[start:, close.columns.get_loc("LATE")] = 30 * np.cumprod(
            1 + np.random.default_rng(3).normal(0.0005, 0.02, 120))
        self.market_data = _as_download(close)
        pid = self._portfolio({"AAA": 1000.0, "LATE": 1000.0})

        _response, builder = self._analyze(pid)

        self.assertEqual(builder["notices"]["late_starters"][0]["ticker"], "LATE")
        returns = portfolio_returns_frame(close[["AAA", "LATE"]])
        self.assertTrue((returns["LATE"].iloc[: start - 1] == 0).all())
        expected = grade_portfolio(returns, np.array([1000.0, 1000.0]),
                                              close["SPY"].pct_change().dropna())
        self.assertEqual(builder["portfolio_metrics"]["grade"]["score"], expected["grade"]["score"])

    def test_max_uses_the_common_history(self):
        close = self.market_data["Close"].copy()
        close["LATE"] = np.nan
        close.iloc[100:, close.columns.get_loc("LATE")] = np.linspace(10, 12, len(close) - 100)
        self.market_data = _as_download(close)
        pid = self._portfolio({"AAA": 1000.0, "LATE": 1000.0})

        _response, builder = self._analyze(pid, period="max")

        window = builder["window"]
        self.assertEqual(window["limited_by"], "LATE")
        self.assertEqual(window["actual_start_date"], close.index[100].strftime("%Y-%m-%d"))
        self.assertEqual(builder["notices"]["late_starters"], [])
        self.assertEqual(self.download_kwargs[-1].get("period"), "max")

    def test_unknown_symbol_is_reported_not_graded_f(self):
        pid = self._portfolio({**self.HELD, "ZZZZ": 400.0})
        _response, builder = self._analyze(pid)
        rows = {r["ticker"]: r for r in builder["holdings"]}
        self.assertEqual(builder["notices"]["unpriced"], ["ZZZZ"])
        self.assertEqual(rows["ZZZZ"]["grade"], "N/A")
        self.assertIsNone(rows["ZZZZ"]["current_price"])

    def test_price_change_is_the_unadjusted_move(self):
        close = self.market_data["Close"].copy()
        price = close.copy()
        price["AAA"] = close["AAA"] * np.linspace(1.05, 1.0, len(close))
        self.market_data = pd.concat(
            {"Close": price, "Adj Close": close, "Dividends": close * 0}, axis=1)
        pid = self._portfolio({"AAA": 1000.0, "BBB": 1000.0})

        _response, builder = self._analyze(pid)

        aaa = next(r for r in builder["holdings"] if r["ticker"] == "AAA")
        self.assertAlmostEqual(
            aaa["total_return_pct"], (close["AAA"].iloc[-1] / close["AAA"].iloc[0] - 1) * 100, delta=0.01)
        self.assertAlmostEqual(
            aaa["price_change_pct"], (price["AAA"].iloc[-1] / price["AAA"].iloc[0] - 1) * 100, delta=0.01)

    # ── Income ───────────────────────────────────────────────────────────────

    def test_income_uses_the_distribution_history_before_yahoos_quote(self):
        self.yield_patch.stop()
        dividends = pd.Series(
            [0.6] * 12, index=pd.date_range(end=pd.Timestamp.now().normalize(), periods=12, freq="30D"))
        with patch.object(app_module, "_cached_yf_dividends", return_value=dividends), \
                patch.object(app_module, "_cached_yf_info",
                             return_value={"trailingAnnualDividendYield": 0.0009}), \
                patch.object(app_module, "_yf_ticker"):
            value, source = app_module._builder_distribution_yield("QQQI", 54.0)
        self.yield_patch.start()
        self.assertEqual(source, "Distribution history")
        self.assertAlmostEqual(value, 0.6 * 12 / 54 * 100, delta=0.05)

    def test_compare_income_and_grade_match_analyze(self):
        yields = {"AAA": (12.0, "x"), "BBB": (3.0, "x"), "CCC": (0.0, None)}
        self.yield_patch.stop()
        with patch.object(app_module, "_builder_distribution_yield",
                          side_effect=lambda t, _p: yields.get(t, (0.0, None))):
            first = self._portfolio(self.HELD, name="First")
            second = self._portfolio({"AAA": 500.0, "BBB": 500.0}, name="Second")
            empty = self._portfolio({}, name="Empty")
            _r, analyzed = self._analyze(first)
            response = self.client.post(
                "/api/builder/compare?profile_id=1",
                json={"portfolio_ids": [first, second, empty], "period": "1y", "benchmark": "SPY"},
            )
        self.yield_patch.start()
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        by_id = {r["id"]: r for r in payload["results"]}
        self.assertEqual(set(by_id), {first, second})
        self.assertEqual([s["id"] for s in payload["skipped"]], [empty])
        pm = analyzed["portfolio_metrics"]
        self.assertEqual(by_id[first]["score"], pm["grade"]["score"])
        self.assertEqual(by_id[first]["monthly_income"], pm["est_monthly_income"])
        self.assertAlmostEqual(pm["est_annual_income"], 1200 * 0.12 + 1800 * 0.03, delta=0.01)

    # ── Writes and ownership ─────────────────────────────────────────────────

    def test_another_profiles_portfolio_is_not_reachable(self):
        pid = self._portfolio(self.HELD, profile_id=2)
        self.assertEqual(self._analyze(pid, profile_id=1)[0].status_code, 404)
        self.assertEqual(
            self.client.get(f"/api/builder/portfolios/{pid}/holdings?profile_id=1").status_code, 404)
        self.assertEqual(
            self.client.delete(f"/api/builder/portfolios/{pid}?profile_id=1").status_code, 404)
        conn = self._get_connection()
        remaining = conn.execute(
            "SELECT COUNT(*) FROM builder_holdings WHERE portfolio_id = ?", (pid,)).fetchone()[0]
        conn.close()
        self.assertEqual(remaining, 3)

    def test_holding_amounts_must_be_positive(self):
        pid = self._portfolio({})
        for bad in (0, -5, "abc", None):
            response = self.client.post(
                f"/api/builder/portfolios/{pid}/holdings?profile_id=1",
                json={"ticker": "AAA", "dollar_amount": bad})
            self.assertEqual(response.status_code, 400, bad)
        ok = self.client.post(
            f"/api/builder/portfolios/{pid}/holdings?profile_id=1",
            json={"ticker": " aaa ", "dollar_amount": "250.5"})
        self.assertEqual(ok.get_json(), {"ticker": "AAA", "dollar_amount": 250.5})

    def test_editing_an_amount_keeps_the_holding_in_place(self):
        pid = self._portfolio({"AAA": 100.0, "BBB": 200.0, "CCC": 300.0})
        self.client.post(f"/api/builder/portfolios/{pid}/holdings?profile_id=1",
                         json={"ticker": "AAA", "dollar_amount": 150})
        holdings = self.client.get(f"/api/builder/portfolios/{pid}/holdings?profile_id=1").get_json()
        self.assertEqual([(h["ticker"], h["dollar_amount"]) for h in holdings["holdings"]],
                         [("AAA", 150.0), ("BBB", 200.0), ("CCC", 300.0)])

    def test_put_replaces_or_merges_in_one_step(self):
        pid = self._portfolio({"AAA": 100.0, "BBB": 200.0})
        merged = self.client.put(
            f"/api/builder/portfolios/{pid}/holdings?profile_id=1",
            json={"holdings": [{"ticker": "BBB", "dollar_amount": 50}, {"ticker": "CCC", "dollar_amount": 75}],
                  "replace": False}).get_json()["holdings"]
        self.assertEqual({h["ticker"]: h["dollar_amount"] for h in merged},
                         {"AAA": 100.0, "BBB": 50.0, "CCC": 75.0})
        replaced = self.client.put(
            f"/api/builder/portfolios/{pid}/holdings?profile_id=1",
            json={"holdings": [{"ticker": "SPY", "dollar_amount": 10}]}).get_json()["holdings"]
        self.assertEqual(replaced, [{"ticker": "SPY", "dollar_amount": 10.0}])
        cleared = self.client.put(
            f"/api/builder/portfolios/{pid}/holdings?profile_id=1", json={"holdings": []})
        self.assertEqual(cleared.get_json()["holdings"], [])

    def test_create_from_live_holdings_copies_market_values(self):
        response = self.client.post(
            "/api/builder/portfolios?profile_id=1", json={"name": "Mine", "from_holdings": True})
        self.assertEqual(response.status_code, 201, response.get_json())
        pid = response.get_json()["id"]
        holdings = self.client.get(f"/api/builder/portfolios/{pid}/holdings?profile_id=1").get_json()
        self.assertEqual({h["ticker"]: h["dollar_amount"] for h in holdings["holdings"]}, self.HELD)
        duplicate = self.client.post(
            "/api/builder/portfolios?profile_id=1", json={"name": "Mine"})
        self.assertEqual(duplicate.status_code, 409)

    def test_rebalance_apply_scales_each_class_to_its_target(self):
        # SPYI and QQQI are both "US Stocks" in the income All Weather template.
        pid = self._portfolio({"SPYI": 3000.0, "QQQI": 1000.0, "TLT": 4000.0, "XYZ": 2000.0})
        payload = self.client.post(
            f"/api/builder/portfolios/{pid}/rebalance?profile_id=1",
            json={"mode": "income", "strategy": "all_weather"}).get_json()

        plan = {h["ticker"]: h["dollar_amount"] for h in payload["apply_holdings"]}
        self.assertAlmostEqual(sum(plan.values()), payload["total_value"], delta=0.05)
        # 30% of $10,000, split 3:1 as held.
        self.assertAlmostEqual(plan["SPYI"], 2250.0, delta=0.01)
        self.assertAlmostEqual(plan["QQQI"], 750.0, delta=0.01)
        self.assertNotIn("XYZ", plan)


if __name__ == "__main__":
    unittest.main()
