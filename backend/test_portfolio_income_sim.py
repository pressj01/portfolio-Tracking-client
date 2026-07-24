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
