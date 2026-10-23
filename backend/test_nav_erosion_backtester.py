import datetime as dt
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from app import (
    _nav_benchmark_for_ticker,
    _nav_erosion_numerator,
    _nav_monthly_frame,
    _nav_split_adjust_close_and_divs,
)


class NavErosionBacktesterTest(unittest.TestCase):
    def test_goldman_premium_income_auto_benchmarks_match_underlying_indexes(self):
        with patch.object(app_module, "_nav_benchmark_overrides", return_value={}):
            self.assertEqual(_nav_benchmark_for_ticker("GPIQ"), "QQQ")
            self.assertEqual(_nav_benchmark_for_ticker("GPIX"), "SPY")

    def test_monthly_frame_aligns_new_york_fund_with_utc_crypto(self):
        fund_index = pd.DatetimeIndex(
            ["2026-01-30", "2026-02-27"], tz="America/New_York"
        )
        crypto_index = pd.DatetimeIndex(
            ["2026-01-30", "2026-02-27"], tz="UTC"
        )
        close = pd.Series([100.0, 90.0], index=fund_index)
        divs = pd.Series([1.0, 2.0], index=fund_index)
        benchmark = pd.Series([1000.0, 1100.0], index=crypto_index)

        frame = _nav_monthly_frame(close, divs, benchmark)

        self.assertEqual(len(frame), 2)
        self.assertEqual(frame["benchmark_price"].tolist(), [1000.0, 1100.0])
        self.assertEqual(frame["div"].tolist(), [1.0, 2.0])

    def test_confirmed_erosion_requires_fund_down_and_benchmark_flat_or_up(self):
        self.assertAlmostEqual(_nav_erosion_numerator(-0.10, 0.00), 0.10)
        self.assertAlmostEqual(_nav_erosion_numerator(-0.10, 0.20), 0.10)
        self.assertEqual(_nav_erosion_numerator(-0.10, -0.001), 0.0)
        self.assertEqual(_nav_erosion_numerator(0.10, 0.20), 0.0)

    def test_split_adjust_restates_unadjusted_pre_reverse_split_history(self):
        index = pd.DatetimeIndex(["2024-01-02", "2024-01-03", "2024-12-20", "2024-12-23"])
        close = pd.Series([4.0, 4.0, 40.0, 40.0], index=index)
        divs = pd.Series([0.1, 0.1, 1.0, 1.0], index=index)
        splits = pd.Series([0.0, 0.0, 0.1, 0.0], index=index)

        adj, adj_divs = _nav_split_adjust_close_and_divs(close, divs, splits)

        self.assertEqual(adj.tolist(), [40.0, 40.0, 40.0, 40.0])
        self.assertEqual(adj_divs.tolist(), [1.0, 1.0, 1.0, 1.0])

    def test_split_adjust_does_not_double_adjust_yahoo_restatement(self):
        index = pd.DatetimeIndex(["2025-11-28", "2025-12-01", "2025-12-02"])
        close = pd.Series([40.0, 39.56, 39.80], index=index)
        divs = pd.Series([0.59, 0.0, 0.0], index=index)
        splits = pd.Series([0.0, 0.1, 0.0], index=index)

        adj, adj_divs = _nav_split_adjust_close_and_divs(close, divs, splits)

        self.assertEqual(adj.tolist(), close.tolist())
        self.assertEqual(adj_divs.tolist(), divs.tolist())


START, END = dt.date(2025, 12, 31), dt.date(2026, 9, 30)
DAYS = [START + dt.timedelta(days=i) for i in range((END - START).days + 1)]
DAYS = [day for day in DAYS if day.weekday() < 5]
PAYOUTS = sum(day.day == 15 for day in DAYS)


def market_fixture(symbol, start, end):
    """QQQI: flat $100 price paying $0.50 a month while QQQ climbs (NAV lag)."""
    days = [day for day in DAYS if day <= end]
    if symbol in ("QQQI", "JNJ", "KEO"):
        closes = [100.0] * len(days)
        payouts = [{"date": day.isoformat(), "amount": 0.5} for day in days if day.day == 15]
    elif symbol in ("QQQ", "SPY"):
        growth = .0005 if symbol == "QQQ" else .0002
        closes = [100 * (1 + growth) ** i for i in range(len(days))]
        payouts = []
    else:
        return None
    return {"basis": "split_adjusted_market_price", "provider": "fixture",
            "prices": [{"date": day.isoformat(), "close": close} for day, close in zip(days, closes)],
            "distributions": payouts, "distributions_complete": True, "corporate_actions_resolved": True,
            "splits": [], "total_returns": {day.isoformat(): close for day, close in zip(days, closes)}}


class NavErosionScreensTest(unittest.TestCase):
    """The Dashboard and both NAV Erosion screens share one assessment."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "test.db")
        conn = self.connect()
        conn.executescript("""
            CREATE TABLE profiles (id INTEGER PRIMARY KEY, cash_value REAL);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE all_account_info (profile_id INTEGER, ticker TEXT,
                current_price REAL, quantity REAL, description TEXT, classification_type TEXT,
                estim_payment_per_year REAL, current_value REAL, nav_erosion_scope TEXT,
                nav_benchmark_override TEXT);
            INSERT INTO profiles VALUES (2, 0);
            INSERT INTO all_account_info VALUES
                (2, 'QQQI', 100, 100, 'NEOS Nasdaq-100 High Income ETF', 'ETF', 600, 10000, 'auto', NULL),
                (2, 'JNJ', 100, 10, 'Johnson & Johnson', 'G', 50, 1000, 'auto', NULL);
        """)
        conn.commit()
        conn.close()
        app_module._NAV_ASSESSMENT_CACHE.clear()
        patches = [
            patch.object(app_module, "get_connection", self.connect),
            patch.object(app_module, "get_profile_filter", return_value=(False, [2])),
            patch.object(app_module, "_cash_profile_ids_for_read", side_effect=lambda conn, agg, ids: ids),
            patch.object(app_module, "_nav_assessment_source", return_value=None),
            patch.object(app_module, "_nav_screen_market_history", side_effect=market_fixture),
            patch.object(app_module.app, "_db_initialized", True, create=True),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        merge = patch.object(app_module, "_merge_nav_benchmark_overrides")
        self.merge = merge.start()
        self.addCleanup(merge.stop)
        self.addCleanup(self.temp.cleanup)
        self.client = app_module.app.test_client()

    def connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def single(self, **params):
        query = {"ticker": "QQQI", "amount": 10000, "start": START.isoformat(), "end": END.isoformat(), "reinvest": 0}
        return self.client.get("/api/nav-erosion/data", query_string={**query, **params}).get_json()

    def screener(self, rows):
        return self.client.post("/api/nav-erosion-portfolio/data", json={
            "start": START.isoformat(), "end": END.isoformat(), "rows": rows}).get_json()

    def test_all_three_screens_give_the_same_result_for_a_fund(self):
        dashboard = self.client.get("/api/nav-assessment", query_string={
            "period": "custom", "start_date": START.isoformat(), "end_date": END.isoformat()}).get_json()
        single = self.single()
        screener = self.screener([{"ticker": "QQQI", "amount": 10000, "reinvest_pct": 0}])
        on_dashboard = next(row for row in dashboard["results"] if row["ticker"] == "QQQI")["finding"]
        self.assertIsNone(single["error"])
        self.assertEqual(on_dashboard["code"], "nav_lag")
        self.assertEqual(single["assessment"]["finding"], on_dashboard)
        self.assertEqual(screener["results"][0]["finding"], on_dashboard)
        self.assertEqual(on_dashboard["label"], "NAV lag — not erosion")
        self.assertEqual(single["summary"]["benchmark"], "QQQ")
        self.assertEqual(single["summary"]["benchmark_source"], "Automatic")
        self.assertEqual(screener["results"][0]["nav_lag"]["status"], "lag")
        self.assertEqual([item["ticker"] for item in screener["verdict"]["nav_lag"]], ["QQQI"])
        self.assertEqual(screener["verdict"]["label"], "No NAV Erosion")

    def test_backtest_uses_the_assessment_dates_and_payouts(self):
        cash = self.single()["summary"]
        self.assertEqual(cash["actual_start"], START.isoformat())
        self.assertEqual(cash["actual_end"], END.isoformat())
        self.assertAlmostEqual(cash["cash_taken"], 50.0 * PAYOUTS)
        self.assertAlmostEqual(cash["final_value"], 10000.0)
        self.assertAlmostEqual(cash["total_return_pct"], 0.5 * PAYOUTS)
        self.assertAlmostEqual(cash["benchmark_return_pct"], ((1.0005) ** (len(DAYS) - 1) - 1) * 100, places=2)
        drip = self.single(reinvest=100)
        self.assertAlmostEqual(drip["summary"]["final_value"], 10000 * 1.005 ** PAYOUTS, places=2)
        self.assertAlmostEqual(drip["summary"]["cash_taken"], 0.0)
        months = drip["rows"]
        self.assertEqual(months[0]["date"], "Jan 2026")
        self.assertEqual(len(months), 9)
        self.assertIsNotNone(months[0]["same_cash_gap_rate"])
        self.assertFalse(any(month["erosion_month"] for month in months))

    def test_benchmark_box_old_defaults_count_as_blank_and_typed_tickers_apply_to_the_run(self):
        same = self.single(benchmark="QQQ")
        self.assertEqual(same["summary"]["benchmark_source"], "Automatic")
        typed = self.single(benchmark="SPY")
        self.assertEqual(typed["summary"]["benchmark"], "SPY")
        self.assertEqual(typed["summary"]["benchmark_source"], "Your benchmark for this run")
        self.assertIn("SPY", typed["assessment"]["finding"]["detail"])
        result = self.screener([{"ticker": "QQQI", "amount": 10000, "reinvest_pct": 0, "benchmark": "SPY"}])
        self.assertEqual(result["results"][0]["benchmark_source"], "Your benchmark for this run")
        self.merge.assert_called_with({"QQQI": "SPY"})
        # Saved Dashboard references are untouched by a run.
        conn = self.connect()
        self.assertIsNone(conn.execute("SELECT value FROM settings WHERE key LIKE 'nav_reference_choices%'").fetchone())
        conn.close()

    def test_stocks_are_not_assessed_but_keep_their_dollar_backtest(self):
        result = self.screener([{"ticker": "JNJ", "amount": 1000, "reinvest_pct": 0, "benchmark": "SPY"}])
        row = result["results"][0]
        self.assertEqual(row["finding"]["code"], "not_applicable")
        self.assertIsNone(row["error"])
        self.assertAlmostEqual(row["cash_taken"], 5.0 * PAYOUTS)

    def test_unheld_fund_is_assessed_with_its_own_reference(self):
        result = self.screener([{"ticker": "KEO", "amount": 1000, "reinvest_pct": 0}])
        row = result["results"][0]
        self.assertIsNone(row["error"])
        self.assertIn(row["finding"]["code"], {"nav_lag", "no_signal", "needs_strategy", "limited_evidence", "unconfirmed"})

    def test_current_portfolio_rows_leave_the_benchmark_to_the_dashboard(self):
        with patch.object(app_module, "_nav_erosion_portfolio_profile_scope", return_value=([2], "profile")), \
                patch.object(app_module, "_basis_total_expr", return_value="0"):
            conn = self.connect()
            conn.execute("ALTER TABLE all_account_info ADD COLUMN reinvest TEXT")
            conn.commit()
            rows, _scope, _count = app_module._nav_erosion_current_rows(conn)
            conn.close()
        self.assertEqual({row["benchmark"] for row in rows}, {""})


if __name__ == "__main__":
    unittest.main()
