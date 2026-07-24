import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))

import app as app_module
from database import ensure_tables_exist


class _InfoFailureTicker:
    @property
    def info(self):
        raise RuntimeError("quote-summary temporarily unavailable")

    @property
    def fast_info(self):
        return {"last_price": 54.96}

    @property
    def dividends(self):
        dates = pd.date_range(
            end=pd.Timestamp.now(tz="America/New_York").normalize(),
            periods=12,
            freq="MS",
        )
        return pd.Series([0.394] * len(dates), index=dates)

    @property
    def calendar(self):
        return {}

    def history(self, **_kwargs):
        return pd.DataFrame()


class _SimulationTicker:
    def history(self, **_kwargs):
        dates = pd.date_range("2025-01-31", periods=12, freq="ME")
        return pd.DataFrame(
            {
                "Close": [100.0] * len(dates),
                "Dividends": [1.0] * len(dates),
            },
            index=dates,
        )


class _BenchmarkAwareSimulationTicker:
    def __init__(self, symbol):
        self.symbol = symbol

    def history(self, **_kwargs):
        dates = pd.date_range("2025-01-31", periods=12, freq="ME")
        if self.symbol == "QQQI":
            closes = [100.0 * (0.97 ** index) for index in range(len(dates))]
            dividends = [1.0] * len(dates)
        else:
            closes = [100.0] * len(dates)
            dividends = [0.0] * len(dates)
        return pd.DataFrame(
            {"Close": closes, "Dividends": dividends},
            index=dates,
        )


class _DistributionSupportedDeclineTicker:
    def history(self, **_kwargs):
        dates = pd.date_range("2025-01-31", periods=12, freq="ME")
        return pd.DataFrame(
            {
                "Close": [100.0 * (0.99 ** index) for index in range(len(dates))],
                "Dividends": [2.0] * len(dates),
            },
            index=dates,
        )


class _DistributionRateSimulationTicker:
    def __init__(self, symbol):
        self.symbol = symbol

    def history(self, **_kwargs):
        now = pd.Timestamp.now(tz="America/New_York").normalize()
        if self.symbol == "TDAX":
            dates = pd.date_range(end=now, periods=20, freq="W-WED")
            closes = [20.0] * len(dates)
            dividends = [0.1] * len(dates)
        elif self.symbol == "QQQI":
            dates = pd.date_range(end=now, periods=12, freq="30D")
            closes = [50.0] * len(dates)
            dividends = [0.6] * len(dates)
        else:
            dates = pd.date_range(end=now, periods=12, freq="ME")
            closes = [100.0] * len(dates)
            dividends = [0.0] * len(dates)
        return pd.DataFrame(
            {"Close": closes, "Dividends": dividends},
            index=dates,
        )


class PortfolioIncomeSimulatorTests(unittest.TestCase):
    def test_lookup_uses_fast_quote_when_info_endpoint_fails(self):
        with patch("yfinance.Ticker", return_value=_InfoFailureTicker()):
            response = app_module.app.test_client().get("/api/lookup/GPIX")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["ticker"], "GPIX")
        self.assertEqual(payload["current_price"], 54.96)
        self.assertEqual(payload["div"], 0.394)
        self.assertEqual(payload["div_frequency"], "M")

    def test_custom_ticker_projects_without_imported_holdings(self):
        handle, db_path = tempfile.mkstemp(suffix=".db")
        os.close(handle)

        def get_test_connection():
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            return conn

        try:
            conn = get_test_connection()
            ensure_tables_exist(conn)
            conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Test')")
            conn.commit()
            conn.close()

            with patch.object(app_module, "get_connection", side_effect=get_test_connection):
                response = app_module.app.test_client().post(
                    "/api/analytics/drip-projection?profile_id=1",
                    json={
                        "years": 1,
                        "custom_tickers": [{
                            "ticker": "GPIX",
                            "description": "Goldman Sachs S&P 500 Premium Income ETF",
                            "price": 50,
                            "div_per_share": 0.4,
                            "freq_str": "M",
                        }],
                        "investment_overrides": {"GPIX": 10000},
                        "drip_settings": {"GPIX": 100},
                    },
                )

            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertEqual(len(payload["holdings"]), 1)
            self.assertEqual(payload["holdings"][0]["ticker"], "GPIX")
            self.assertEqual(payload["holdings"][0]["shares"], 200)
            self.assertGreater(payload["holdings"][0]["projected_shares"], 200)
            self.assertEqual(len(payload["yearly_totals"]), 2)
        finally:
            os.unlink(db_path)

    def test_market_simulation_reinvestment_percent_changes_results(self):
        with patch("yfinance.Ticker", return_value=_SimulationTicker()):
            response = app_module.app.test_client().post(
                "/api/pis/run",
                json={
                    "mode": "simulate",
                    "market_type": "neutral",
                    "duration_months": 12,
                    "rows": [
                        {"ticker": "TEST", "amount": 1000, "reinvest_pct": 0, "yield_override": 12},
                        {"ticker": "TEST", "amount": 1000, "reinvest_pct": 50, "yield_override": 12},
                        {"ticker": "TEST", "amount": 1000, "reinvest_pct": 100, "yield_override": 12},
                    ],
                },
            )

        self.assertEqual(response.status_code, 200)
        results = response.get_json()["results"]
        zero, half, full = results

        self.assertEqual([row["reinvest_pct"] for row in results], [0, 50, 100])
        self.assertEqual(zero["total_reinvested"], 0)
        self.assertGreater(half["total_reinvested"], 0)
        self.assertGreater(full["total_reinvested"], half["total_reinvested"])
        self.assertLess(zero["final_value"], half["final_value"])
        self.assertLess(half["final_value"], full["final_value"])
        self.assertNotEqual(zero["gain_loss_pct"], full["gain_loss_pct"])

    def test_market_simulation_uses_custom_bullish_rise(self):
        payload = {
            "mode": "simulate",
            "market_type": "bullish",
            "duration_months": 12,
            "rows": [{
                "ticker": "TEST",
                "amount": 1000,
                "reinvest_pct": 0,
                "yield_override": 12,
            }],
        }
        with patch("yfinance.Ticker", return_value=_SimulationTicker()):
            no_rise = app_module.app.test_client().post(
                "/api/pis/run",
                json={**payload, "market_bias_pct": 0},
            ).get_json()["results"][0]
            custom_rise = app_module.app.test_client().post(
                "/api/pis/run",
                json={**payload, "market_bias_pct": 2},
            ).get_json()["results"][0]

        self.assertEqual(no_rise["end_price"], 100)
        self.assertGreater(custom_rise["end_price"], no_rise["end_price"])
        self.assertEqual(custom_rise["market_type"], "bullish")
        self.assertEqual(custom_rise["market_bias_monthly_pct"], 2)
        self.assertEqual(custom_rise["market_bias_compounded_pct"], 27.12)

    def test_nav_erosion_requires_fund_decline_without_underlying_decline(self):
        payload = {
            "mode": "simulate",
            "duration_months": 12,
            "market_bias_pct": 1.5,
            "rows": [{
                "ticker": "QQQI",
                "amount": 3000,
                "reinvest_pct": 100,
            }],
        }

        ticker_factory = lambda symbol: _BenchmarkAwareSimulationTicker(symbol)
        with patch("yfinance.Ticker", side_effect=ticker_factory):
            bullish = app_module.app.test_client().post(
                "/api/pis/run",
                json={**payload, "market_type": "bullish"},
            ).get_json()["results"]
            bearish = app_module.app.test_client().post(
                "/api/pis/run",
                json={**payload, "market_type": "bearish"},
            ).get_json()["results"]
            neutral = app_module.app.test_client().post(
                "/api/pis/run",
                json={**payload, "market_type": "neutral"},
            ).get_json()["results"]

        self.assertEqual(len(bullish), 1)
        self.assertEqual(len(bearish), 1)
        self.assertEqual(len(neutral), 1)

        bullish_fund = bullish[0]
        self.assertEqual(bullish_fund["nav_benchmark"], "QQQ")
        self.assertTrue(bullish_fund["nav_erosion_tested"])
        self.assertLess(bullish_fund["price_delta_pct"], 0)
        self.assertLess(bullish_fund["distribution_adjusted_return_pct"], 0)
        self.assertGreater(bullish_fund["benchmark_price_delta_pct"], 0)
        self.assertTrue(bullish_fund["has_erosion"])

        bearish_fund = bearish[0]
        self.assertEqual(bearish_fund["nav_benchmark"], "QQQ")
        self.assertTrue(bearish_fund["nav_erosion_tested"])
        self.assertLess(bearish_fund["price_delta_pct"], 0)
        self.assertLess(bearish_fund["benchmark_price_delta_pct"], 0)
        self.assertFalse(bearish_fund["has_erosion"])
        self.assertIn(
            "underlying QQQ also declined",
            bearish_fund["nav_erosion_note"],
        )

        neutral_fund = neutral[0]
        self.assertLess(neutral_fund["price_delta_pct"], 0)
        self.assertLess(neutral_fund["distribution_adjusted_return_pct"], 0)
        self.assertEqual(neutral_fund["benchmark_price_delta_pct"], 0)
        self.assertEqual(neutral_fund["benchmark_delta_basis"], "scenario")
        self.assertTrue(neutral_fund["has_erosion"])

    def test_nav_erosion_uses_distribution_adjusted_return(self):
        with patch(
            "yfinance.Ticker",
            return_value=_DistributionSupportedDeclineTicker(),
        ):
            response = app_module.app.test_client().post(
                "/api/pis/run",
                json={
                    "mode": "simulate",
                    "market_type": "neutral",
                    "duration_months": 12,
                    "rows": [
                        {"ticker": "QQQI", "amount": 3000, "reinvest_pct": 0},
                        {"ticker": "QQQI", "amount": 3000, "reinvest_pct": 100},
                    ],
                },
            )

        self.assertEqual(response.status_code, 200)
        no_reinvest, full_reinvest = response.get_json()["results"]
        self.assertLess(no_reinvest["price_delta_pct"], 0)
        self.assertGreater(no_reinvest["distribution_adjusted_return_pct"], 0)
        self.assertEqual(
            no_reinvest["distribution_adjusted_return_pct"],
            full_reinvest["distribution_adjusted_return_pct"],
        )
        self.assertEqual(no_reinvest["benchmark_price_delta_pct"], 0)
        self.assertFalse(no_reinvest["has_erosion"])
        self.assertFalse(full_reinvest["has_erosion"])
        self.assertIn(
            "Not erosion: distribution-adjusted return",
            no_reinvest["nav_erosion_note"],
        )

    def test_new_weekly_fund_uses_annualized_recent_distribution_rate(self):
        ticker_factory = lambda symbol: _DistributionRateSimulationTicker(symbol)
        with patch("yfinance.Ticker", side_effect=ticker_factory):
            response = app_module.app.test_client().post(
                "/api/pis/run",
                json={
                    "mode": "simulate",
                    "market_type": "neutral",
                    "duration_months": 12,
                    "rows": [
                        {"ticker": "QQQI", "amount": 3000, "reinvest_pct": 0},
                        {"ticker": "TDAX", "amount": 3000, "reinvest_pct": 0},
                    ],
                },
            )

        self.assertEqual(response.status_code, 200)
        qqqi, tdax = response.get_json()["results"]
        self.assertEqual(qqqi["distribution_rate_pct"], 14.4)
        self.assertEqual(qqqi["distribution_rate_basis"], "trailing_12_month")
        self.assertLess(
            tdax["ttm_yield_pct"],
            qqqi["distribution_rate_pct"],
        )
        self.assertEqual(tdax["distribution_rate_pct"], 26.0)
        self.assertEqual(
            tdax["distribution_rate_basis"],
            "annualized_recent_distributions",
        )
        self.assertGreater(
            tdax["distribution_rate_pct"],
            qqqi["distribution_rate_pct"],
        )
        self.assertGreater(tdax["total_dist"], qqqi["total_dist"])

    def test_historical_nav_erosion_aligns_underlying_to_fund_history(self):
        dates = pd.date_range("2025-01-31", periods=6, freq="ME")
        columns = pd.MultiIndex.from_product(
            [["QQQI", "QQQ"], ["Close", "Dividends"]]
        )
        history = pd.DataFrame(index=dates, columns=columns, dtype=float)
        history[("QQQI", "Close")] = [None, None, 50, 45, 40, 35]
        history[("QQQI", "Dividends")] = [0, 0, 1, 1, 1, 1]
        history[("QQQ", "Close")] = [120, 110, 100, 105, 110, 115]
        history[("QQQ", "Dividends")] = [0, 0, 0, 0, 0, 0]

        with patch.object(
            app_module,
            "_chunked_yf_download",
            return_value=history,
        ):
            response = app_module.app.test_client().post(
                "/api/pis/run",
                json={
                    "mode": "historical",
                    "start": "2025-01-01",
                    "end": "2025-07-01",
                    "rows": [{
                        "ticker": "QQQI",
                        "amount": 3000,
                        "reinvest_pct": 100,
                    }],
                },
            )

        self.assertEqual(response.status_code, 200)
        results = response.get_json()["results"]
        self.assertEqual(len(results), 1)
        fund = results[0]
        self.assertEqual(fund["nav_benchmark"], "QQQ")
        self.assertEqual(fund["benchmark_price_delta_pct"], 15)
        self.assertLess(fund["distribution_adjusted_return_pct"], 0)
        self.assertTrue(fund["has_erosion"])

    def test_saved_simulation_preserves_custom_market_biases(self):
        handle, db_path = tempfile.mkstemp(suffix=".db")
        os.close(handle)

        def get_test_connection():
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            return conn

        try:
            conn = get_test_connection()
            ensure_tables_exist(conn)
            conn.close()

            with patch.object(app_module, "get_connection", side_effect=get_test_connection):
                create_response = app_module.app.test_client().post(
                    "/api/pis/saved",
                    json={
                        "name": "Custom market moves",
                        "mode": "simulate",
                        "market_type": "bearish",
                        "duration_months": 60,
                        "bullish_bias_pct": 2.25,
                        "bearish_bias_pct": 3.75,
                        "rows": [{
                            "ticker": "TEST",
                            "amount": 1000,
                            "reinvest_pct": 50,
                        }],
                    },
                )
                saved_id = create_response.get_json()["id"]
                update_response = app_module.app.test_client().put(
                    f"/api/pis/saved/{saved_id}",
                    json={
                        "name": "Updated market moves",
                        "mode": "simulate",
                        "market_type": "bullish",
                        "duration_months": 36,
                        "bullish_bias_pct": 4.5,
                        "bearish_bias_pct": 5.5,
                        "rows": [{
                            "ticker": "TEST",
                            "amount": 1000,
                            "reinvest_pct": 50,
                        }],
                    },
                )
                load_response = app_module.app.test_client().get(
                    f"/api/pis/saved/{saved_id}"
                )

            self.assertEqual(create_response.status_code, 200)
            self.assertEqual(update_response.status_code, 200)
            self.assertEqual(load_response.status_code, 200)
            saved = load_response.get_json()
            self.assertEqual(saved["bullish_bias_pct"], 4.5)
            self.assertEqual(saved["bearish_bias_pct"], 5.5)
        finally:
            os.unlink(db_path)

    def test_aggregate_picker_and_projection_combine_member_holdings(self):
        handle, db_path = tempfile.mkstemp(suffix=".db")
        os.close(handle)

        def get_test_connection():
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            return conn

        try:
            conn = get_test_connection()
            ensure_tables_exist(conn)
            conn.executemany(
                "INSERT OR IGNORE INTO profiles (id, name) VALUES (?, ?)",
                [(2, "Account A"), (3, "Account B")],
            )
            conn.execute("INSERT INTO aggregates (id, name) VALUES (99, 'Combined')")
            conn.executemany(
                "INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (99, ?)",
                [(2,), (3,)],
            )
            conn.executemany(
                """INSERT INTO all_account_info (
                       ticker, profile_id, description, classification_type,
                       current_price, quantity, purchase_value, div,
                       div_frequency, current_annual_yield,
                       estim_payment_per_year, reinvest
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    ("GPIX", 2, "Goldman Sachs Premium Income", "ETF", 50, 10, 500, 0.4, "M", 0.096, 48, "Y"),
                    ("GPIX", 3, "Goldman Sachs Premium Income", "ETF", 50, 20, 1000, 0.4, "M", 0.096, 96, "N"),
                ],
            )
            conn.commit()
            conn.close()

            with patch.object(app_module, "get_connection", side_effect=get_test_connection):
                picker_response = app_module.app.test_client().get(
                    "/api/pis/portfolio-tickers?aggregate_id=99"
                )
                projection_response = app_module.app.test_client().post(
                    "/api/analytics/drip-projection?aggregate_id=99",
                    json={"years": 1},
                )

            self.assertEqual(picker_response.status_code, 200)
            picker = picker_response.get_json()["tickers"]
            self.assertEqual(len(picker), 1)
            self.assertEqual(picker[0]["ticker"], "GPIX")
            self.assertEqual(picker[0]["amount"], 1500)
            self.assertEqual(picker[0]["current_yield"], 9.6)
            self.assertTrue(picker[0]["drip"])

            self.assertEqual(projection_response.status_code, 200)
            holdings = projection_response.get_json()["holdings"]
            self.assertEqual(len(holdings), 1)
            self.assertEqual(holdings[0]["ticker"], "GPIX")
            self.assertEqual(holdings[0]["shares"], 30)
            self.assertEqual(holdings[0]["current_annual_income"], 144)
        finally:
            os.unlink(db_path)


if __name__ == "__main__":
    unittest.main()
