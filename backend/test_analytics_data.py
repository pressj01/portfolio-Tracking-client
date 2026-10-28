import sqlite3
import sys
import tempfile
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from grading import min_observations_for_window, portfolio_returns_frame


def json_dump(value):
    return json.dumps(value, sort_keys=True)


def _blank_nav_assessment(*_args, **_kwargs):
    # The shared NAV assessment downloads NAV and reference histories; tests
    # that are not about it get an empty one.
    return {"verdict": {"label": "No NAV erosion", "holdings": {"implicated": []}, "nav_lag": []},
            "results": []}, True


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
        self.orig_nav = app_module._analytics_nav_assessment
        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module._chunked_yf_download = self._download
        app_module._analytics_nav_assessment = _blank_nav_assessment
        app_module.app.testing = True
        app_module.app._db_initialized = True
        app_module._PORTFOLIO_SUMMARY_CACHE.clear()
        app_module._ticker_info_cache.clear()
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._chunked_yf_download = self.orig_download
        app_module._analytics_nav_assessment = self.orig_nav
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
    def test_nav_findings_and_lag_come_from_the_shared_assessment(self, ticker_mock):
        # Analytics shows the Dashboard's verdict and per-fund finding, NAV lag
        # included; it no longer computes its own coverage ratio.
        ticker_mock.return_value.info = {}
        verdict = {
            "label": "Weak NAV Erosion", "strength": "weak", "probability": 33,
            "holdings": {"implicated": [{"ticker": "AAA", "label": "Estimated covered-call eroder"}]},
            "nav_lag": [{"ticker": "BBB", "detail": "+2.0% price vs +9.0% QQQ"}],
        }
        findings = {
            "AAA": {"code": "estimated_eroder", "label": "Estimated covered-call eroder", "tone": "neg"},
            "BBB": {"code": "nav_lag", "label": "NAV lag", "tone": "lag"},
            "CCC": {"code": "no_signal", "label": "No erosion signal", "tone": "ok"},
        }

        def shared(*_args, **_kwargs):
            return {"verdict": verdict, "as_of": "2026-08-27", "requested_start": "2026-07-27",
                    "results": [{"ticker": t, "finding": f, "reference": {"selected": "QQQ"}}
                                for t, f in findings.items()]}, True

        app_module._analytics_nav_assessment = shared
        response = self._post_analytics("1mo")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        self.assertNotIn("coverage", payload)
        nav = payload["nav_assessment"]
        self.assertEqual(nav["verdict"]["label"], "Weak NAV Erosion")
        self.assertEqual(nav["verdict"]["nav_lag"][0]["ticker"], "BBB")
        self.assertEqual({r["ticker"]: r["finding"]["code"] for r in nav["results"]},
                         {"AAA": "estimated_eroder", "BBB": "nav_lag", "CCC": "no_signal"})
        self.assertEqual(nav["flagged"], ["AAA"])
        self.assertTrue(nav["whole_portfolio"])

    @patch("yfinance.Ticker")
    def test_target_grade_reweights_only_existing_holdings(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.market_data = _market_frame(80, start="2025-08-27")
        response = self.client.post(
            "/api/analytics/data?profile_id=1",
            json={"tickers": ["AAA", "BBB", "CCC", "SPY"], "benchmark": "SPY", "period": "1y",
                  "mode": "target_grade", "target_grade": "A+"},
        )
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        opt = payload["optimization"]
        target = opt["target"]
        self.assertEqual(target["letter"], "A+")
        self.assertIn(target["status"], {"already", "reached", "unreachable"})
        self.assertEqual(target["start_grade"], payload["portfolio_metrics"]["grade"]["overall"])
        # SPY is on the list but not held, so it is neither bought nor shown.
        self.assertEqual(sorted(w["ticker"] for w in opt["weights"]), ["AAA", "BBB", "CCC"])
        self.assertIn("SPY", target["not_held"])
        self.assertAlmostEqual(sum(w["optimal_pct"] for w in opt["weights"]), 100, delta=0.1)
        self.assertEqual(opt["comparison"]["after"]["score"], target["score"])
        # Every move the search made is listed, so the listed adds add up to the total shifted.
        added = sum(w["dollar_change"] for w in opt["weights"] if w["action"] == "BUY")
        self.assertAlmostEqual(added, target["moved_value"], delta=max(1.0, target["moved_value"] * 0.01))

    @patch("yfinance.Ticker")
    def test_target_grade_reports_no_owned_holdings(self, ticker_mock):
        ticker_mock.return_value.info = {}
        payload = self.client.post(
            "/api/analytics/data?profile_id=1",
            json={"tickers": ["SPY", "QQQ"], "mode": "target_grade", "target_grade": "A"},
        ).get_json()
        self.assertEqual(payload["optimization"]["target"]["status"], "no_holdings")
        self.assertCountEqual(payload["optimization"]["target"]["not_held"], ["SPY", "QQQ"])

    @patch("yfinance.Ticker")
    def test_target_grade_explains_insufficient_history(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.market_data = _market_frame(8)
        payload = self.client.post(
            "/api/analytics/data?profile_id=1",
            json={"tickers": ["AAA", "BBB"], "mode": "target_grade", "period": "1mo"},
        ).get_json()
        self.assertEqual(payload["optimization"]["target"]["status"], "insufficient_history")
        self.assertCountEqual(payload["optimization"]["target"]["ungraded"], ["AAA", "BBB"])

    @patch("yfinance.Ticker")
    def test_target_grade_answers_when_only_one_ticker_has_data(self, ticker_mock):
        ticker_mock.return_value.info = {}
        payload = self.client.post(
            "/api/analytics/data?profile_id=1",
            json={"tickers": ["AAA", "MISSING"], "mode": "target_grade", "target_grade": "A+"},
        ).get_json()
        opt = payload["optimization"]
        self.assertIn(opt["target"]["status"], {"already", "unreachable"})
        self.assertEqual(len(opt["weights"]), 1)
        self.assertEqual(opt["weights"][0]["action"], "HOLD")
        self.assertEqual(opt["target"]["moved_value"], 0)

    @patch("yfinance.Ticker")
    def test_target_grade_never_increases_penny_or_stale_holdings(self, ticker_mock):
        ticker_mock.return_value.info = {}
        self.market_data = _volatile_market_frame()
        for field in ("Close", "Adj Close"):
            self.market_data[(field, "CCC")] = np.linspace(0.2, 0.5, len(self.market_data))
        response = self.client.post(
            "/api/analytics/data?profile_id=1",
            json={"tickers": ["AAA", "BBB", "CCC"], "mode": "target_grade", "target_grade": "A+"},
        )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        target = payload["optimization"]["target"]
        self.assertIn("CCC", {b["ticker"] for b in target["blocked"]})
        weight = next(w for w in payload["optimization"]["weights"] if w["ticker"] == "CCC")
        self.assertLessEqual(weight["optimal_pct"], weight["current_pct"] + 1e-9)

    @patch("yfinance.Ticker")
    def test_target_grade_preserves_small_dollar_shifts_and_grade_drivers(self, ticker_mock):
        from grading import grade_portfolio
        ticker_mock.return_value.info = {}
        self.market_data = _volatile_market_frame()
        conn = sqlite3.connect(self.db_path)
        # 10% yield on AAA, 20% on BBB, nothing on CCC.
        conn.execute("UPDATE all_account_info SET estim_payment_per_year = 120 WHERE ticker = 'AAA'")
        conn.execute("UPDATE all_account_info SET estim_payment_per_year = 360 WHERE ticker = 'BBB'")
        conn.commit()
        conn.close()

        def small_shift(returns, values, bench, target, **kwargs):
            weights = values / values.sum()
            start_score = grade_portfolio(returns, weights, bench)["grade"]["score"]
            weights[0] += 0.0002
            weights[1] -= 0.0002
            grade = grade_portfolio(returns, weights, bench)["grade"]
            return {"weights": weights, "score": grade["score"], "grade": grade["overall"],
                    "start_score": start_score, "reached": grade["score"] >= target, "stopped": "budget"}

        with patch("grading.search_weights_for_grade", side_effect=small_shift):
            payload = self.client.post(
                "/api/analytics/data?profile_id=1",
                json={"tickers": ["AAA", "BBB", "CCC"], "mode": "target_grade", "target_grade": "A+"},
            ).get_json()
        opt = payload["optimization"]
        actions = {w["ticker"]: w for w in opt["weights"]}
        self.assertEqual(actions["AAA"]["action"], "BUY")
        self.assertEqual(actions["BBB"]["action"], "SELL")
        self.assertEqual(actions["CCC"]["action"], "HOLD")
        self.assertEqual(actions["AAA"]["dollar_change"], 0.70)
        self.assertEqual(actions["BBB"]["dollar_change"], -0.70)
        self.assertEqual(opt["target"]["moved_value"], 0.70)
        # Each move carries the income it adds or gives up; together they are the plan's income change.
        self.assertEqual(actions["AAA"]["income_change"], 0.07)
        self.assertEqual(actions["BBB"]["income_change"], -0.14)
        self.assertEqual(actions["CCC"]["income_change"], 0)
        self.assertEqual(actions["BBB"]["yield_pct"], 20.0)
        before, after = opt["comparison"]["before"], opt["comparison"]["after"]
        self.assertAlmostEqual(sum(w["income_change"] for w in opt["weights"]),
                               after["annual_income"] - before["annual_income"], places=2)
        self.assertEqual(opt["rebalance_summary"]["total_buy"], opt["rebalance_summary"]["total_sell"])
        self.assertTrue(opt["comparison"]["before"]["breakdown"])
        self.assertTrue(opt["comparison"]["after"]["breakdown"])
        self.assertEqual(opt["comparison"]["after"]["score"], opt["target"]["score"])

    @patch("yfinance.Ticker")
    def test_target_grade_share_counts_use_the_holdings_own_price(self, ticker_mock):
        from grading import grade_portfolio
        ticker_mock.return_value.info = {}
        self.market_data = _volatile_market_frame()

        def sell_ccc(returns, values, bench, target, **kwargs):
            start = values / values.sum()
            weights = start.copy()
            weights[0] += weights[2]
            weights[2] = 0.0
            grade = grade_portfolio(returns, weights, bench)["grade"]
            return {"weights": weights, "score": grade["score"], "grade": grade["overall"],
                    "start_score": 0, "reached": True, "stopped": None}

        with patch("grading.search_weights_for_grade", side_effect=sell_ccc):
            payload = self.client.post(
                "/api/analytics/data?profile_id=1",
                json={"tickers": ["AAA", "BBB", "CCC"], "mode": "target_grade", "target_grade": "A+"},
            ).get_json()
        actions = {w["ticker"]: w for w in payload["optimization"]["weights"]}
        # CCC: 8 shares worth $500. Trimming it to zero sells all 8, at $62.50 a share.
        self.assertEqual(actions["CCC"]["shares_change"], -8)
        self.assertEqual(actions["CCC"]["current_price"], 62.5)
        # AAA: 10 shares worth $1,200 ($120 each) receives the $500.
        self.assertEqual(actions["AAA"]["current_price"], 120.0)
        self.assertAlmostEqual(actions["AAA"]["shares_change"], 500 / 120, places=4)
        self.assertEqual(actions["BBB"]["shares_change"], 0)

    @patch("yfinance.Ticker")
    def test_target_grade_options_each_carry_a_full_plan(self, ticker_mock):
        from grading import grade_portfolio
        ticker_mock.return_value.info = {}
        self.market_data = _volatile_market_frame()
        conn = sqlite3.connect(self.db_path)
        # 10% yield on AAA, 20% on BBB, nothing on CCC.
        conn.execute("UPDATE all_account_info SET estim_payment_per_year = 120 WHERE ticker = 'AAA'")
        conn.execute("UPDATE all_account_info SET estim_payment_per_year = 360 WHERE ticker = 'BBB'")
        conn.commit()
        conn.close()
        seen = {}

        def two_plans(returns, values, bench, target, **kwargs):
            seen.update(kwargs, columns=list(returns.columns))
            start = values / values.sum()
            plans = []
            # The main plan moves CCC into AAA; the alternative keeps CCC and moves BBB.
            for kind, ticker, source in (("main", None, 2), ("keep", "CCC", 1)):
                weights = start.copy()
                weights[0] += weights[source]
                weights[source] = 0.0
                grade = grade_portfolio(returns, weights, bench)["grade"]
                plans.append({"weights": weights, "score": grade["score"], "grade": grade["overall"],
                              "start_score": 0, "reached": True, "stopped": "reached",
                              "kind": kind, "ticker": ticker})
            return plans

        with patch("grading.search_grade_options", side_effect=two_plans):
            payload = self.client.post(
                "/api/analytics/data?profile_id=1",
                json={"tickers": ["AAA", "BBB", "CCC"], "mode": "target_grade", "target_grade": "A+"},
            ).get_json()
        opt = payload["optimization"]
        self.assertEqual([o["kind"] for o in opt["options"]], ["main", "keep"])
        self.assertEqual([o["rule_ticker"] for o in opt["options"]], [None, "CCC"])
        # The search receives each holding's yield, in its own column order.
        self.assertEqual(seen["columns"], ["AAA", "BBB", "CCC"])
        np.testing.assert_allclose(seen["yields"], [0.10, 0.20, 0.0])
        # The top level is the first option, so readers of a single plan see the main one.
        for key in ("weights", "rebalance_summary", "comparison", "target"):
            self.assertEqual(json_dump(opt[key]), json_dump(opt["options"][0][key]), key)
        # Every option carries the same plan details.
        for option in opt["options"]:
            target, before, after = option["target"], option["comparison"]["before"], option["comparison"]["after"]
            self.assertEqual(target["status"], "reached")
            self.assertEqual(target["start_grade"], payload["portfolio_metrics"]["grade"]["overall"])
            self.assertEqual(after["score"], target["score"])
            self.assertTrue(after["breakdown"])
            self.assertAlmostEqual(sum(w["income_change"] for w in option["weights"]),
                                   after["annual_income"] - before["annual_income"], places=2)
            added = sum(w["dollar_change"] for w in option["weights"] if w["action"] == "BUY")
            self.assertAlmostEqual(added, target["moved_value"], delta=0.01)
        main = {w["ticker"]: w for w in opt["options"][0]["weights"]}
        keep = {w["ticker"]: w for w in opt["options"][1]["weights"]}
        self.assertEqual(main["CCC"]["shares_change"], -8)
        self.assertEqual(keep["CCC"]["action"], "HOLD")
        self.assertEqual(keep["BBB"]["shares_change"], -20)
        self.assertEqual(keep["BBB"]["income_change"], -360)

    @patch("yfinance.Ticker")
    def test_nav_request_matches_the_dashboard_for_the_whole_portfolio(self, ticker_mock):
        # Same funds, references, dates and cash reach _run_nav_assessment from
        # the Dashboard route and from Analytics.
        ticker_mock.return_value.info = {}
        app_module._analytics_nav_assessment = self.orig_nav
        calls = []
        info = {t: {"current_value": v, "quantity": 1.0} for t, v in (("AAA", 1200.0), ("BBB", 1800.0), ("CCC", 500.0))}

        def inputs(_conn, _agg, _pids, tickers=None):
            chosen = info if tickers is None else {t: dict(info[t]) for t in tickers}
            return chosen, {"AAA": {"choice": {"mode": "manual", "symbol": "SPY"}}}, 250.0

        def run(info_arg, choices, cash, *, window, start_date, as_of):
            calls.append((json_dump(info_arg), choices, cash, window, start_date, as_of))
            return {"verdict": {"holdings": {"implicated": []}, "nav_lag": []},
                    "results": [], "summary": {}, "overall": {}}

        with patch.object(app_module, "_nav_assessment_inputs", inputs),                 patch.object(app_module, "_run_nav_assessment", run):
            app_module._NAV_ASSESSMENT_CACHE.clear()
            dashboard = self.client.get("/api/nav-assessment?profile_id=1&period=1y")
            app_module._NAV_ASSESSMENT_CACHE.clear()
            analytics = self._post_analytics("1y")

        self.assertEqual(dashboard.status_code, 200, dashboard.get_json())
        self.assertEqual(analytics.status_code, 200, analytics.get_json())
        self.assertEqual(len(calls), 2, calls)
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(calls[0][2], 250.0)

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
            CREATE TABLE builder_portfolios (
                id INTEGER PRIMARY KEY, profile_id INTEGER, name TEXT,
                updated_at TEXT
            );
            CREATE TABLE builder_holdings (
                id INTEGER PRIMARY KEY, portfolio_id INTEGER, ticker TEXT,
                dollar_amount REAL, added_at TEXT
            );
            INSERT INTO builder_portfolios (id, profile_id, name) VALUES (1, 1, 'Model');
            INSERT INTO builder_holdings (portfolio_id, ticker, dollar_amount) VALUES (1, 'AAA', 1200);
            INSERT INTO builder_holdings (portfolio_id, ticker, dollar_amount) VALUES (1, 'BBB', 1800);
            INSERT INTO builder_holdings (portfolio_id, ticker, dollar_amount) VALUES (1, 'CCC', 500);
            """
        )
        conn.commit()
        conn.close()

        with patch.object(app_module, "_builder_distribution_yield", return_value=(0.0, None)):
            response = self.client.post(
                "/api/builder/portfolios/1/analyze?profile_id=1",
                json={"benchmark": "SPY", "period": "1y"},
            )
        payload = response.get_json()

        self.assertEqual(response.status_code, 200, payload)
        values = payload["drawdown_series"]["values"]
        out_of_range = [v for v in values if not -100 <= v <= 0]
        self.assertEqual(out_of_range, [], out_of_range[:5])

        # The curve starts at 1.0 on the window's first close, as the grade's
        # does, so a loss on day one is a drawdown and the chart's trough is the
        # Max Drawdown the report card shows.
        close = self.market_data["Close"][list(self.HELD_VALUES)]
        port_daily = close.pct_change().iloc[1:].dot(self._weight_fractions())
        cum = pd.concat([pd.Series([1.0]), (1 + port_daily).cumprod().reset_index(drop=True)])
        expected = (cum / cum.cummax() - 1) * 100
        self.assertLess(float(expected.min()), -3)
        np.testing.assert_allclose(values, expected.values, atol=0.0051)
        self.assertAlmostEqual(
            min(values), payload["portfolio_metrics"]["max_drawdown"] * 100, delta=0.0051)


if __name__ == "__main__":
    unittest.main()


class OptimizerNavGateTest(unittest.TestCase):
    def test_only_funds_the_shared_assessment_flags_are_penalized(self):
        # A falling fund that is NAV lag or a market drop (not flagged) gets no
        # erosion penalty; a flagged one is penalized by its price decline.
        dates = pd.bdate_range("2025-10-01", periods=120)
        falling = np.linspace(100, 70, len(dates))
        close = pd.DataFrame({"LAGG": falling, "ERDR": falling}, index=dates)

        rates = app_module._compute_nav_erosion(close, ["LAGG", "ERDR"], eligible={"ERDR"})

        self.assertEqual(rates["LAGG"], 0.0)
        self.assertLess(rates["ERDR"], -0.3)
