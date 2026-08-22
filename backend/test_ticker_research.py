import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class TickerResearchApiTest(unittest.TestCase):
    def setUp(self):
        temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        temp_file.close()
        self.db_path = temp_file.name

        conn = self._get_connection()
        database.ensure_tables_exist(conn)
        conn.commit()
        conn.close()

        self._original_get_connection = app_module.get_connection
        self._original_testing = app_module.app.testing
        self._original_db_init = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._original_get_connection
        app_module.app.testing = self._original_testing
        app_module.app._db_initialized = self._original_db_init
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _insert_holding(self, ticker="PDI", quantity=100, current_value=2500):
        conn = self._get_connection()
        conn.execute(
            """INSERT INTO all_account_info (
                   ticker, profile_id, description, quantity, price_paid, current_price,
                   purchase_value, current_value, purchase_date, estim_payment_per_year,
                   nav_erosion_scope
               ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'auto')""",
            (ticker, f"{ticker} Fund", quantity, 20, 25, 2000, current_value, "2022-01-15", 180),
        )
        conn.commit()
        conn.close()

    def test_unknown_ticker_returns_empty_position(self):
        with patch.object(app_module, "_cef_row_map", return_value={}):
            with patch.object(app_module, "_ticker_research_kind", return_value="stock"):
                body = self.client.get("/api/ticker-research/ZZZZ").get_json()
        self.assertEqual(body["ticker"], "ZZZZ")
        self.assertIsNone(body["holding"])
        self.assertIsNone(body["cef"])
        self.assertEqual(body["kind"], "stock")
        self.assertIn("ticker=ZZZZ", body["links"]["research"])
        self.assertIn("/stock-buying-checklist?ticker=ZZZZ", body["links"]["checklist"])

    def test_held_cef_fills_position_discount_and_checklist_link(self):
        self._insert_holding("PDI", quantity=40, current_value=800)
        cef = {
            "ticker": "PDI",
            "name": "PIMCO Dynamic Income",
            "premium_discount": -4.2,
            "distribution_rate_nav": 11.5,
            "return_on_nav_5y": 8.1,
            "nav": 18.4,
        }
        nav = {
            "ticker": "PDI",
            "coverage_ratio": 0.42,
            "nav_erosion_severity": "Medium",
            "price_change_pct": -6.1,
            "benchmark": "SPY",
            "nav_tested": True,
        }
        with patch.object(app_module, "_cef_row_map", return_value={"PDI": cef}):
            with patch.object(app_module, "_ticker_research_kind", return_value="cef"):
                with patch.object(
                    app_module,
                    "_ticker_research_cached_nav",
                    return_value=nav,
                ):
                    body = self.client.get("/api/ticker-research/pdi").get_json()
        self.assertEqual(body["kind"], "cef")
        self.assertEqual(body["holding"]["ticker"], "PDI")
        self.assertEqual(body["holding"]["quantity"], 40)
        self.assertEqual(body["holding"]["current_value"], 800)
        self.assertEqual(body["cef"]["premium_discount"], -4.2)
        self.assertEqual(body["nav"]["coverage_ratio"], 0.42)
        self.assertIn("/cef-buying-checklist-evaluator?ticker=PDI", body["links"]["checklist"])
        self.assertIn("amount=800", body["links"]["nav_erosion"])
        self.assertIn("start=2022-01-15", body["links"]["nav_erosion"])

    def test_blank_ticker_is_rejected(self):
        response = self.client.get("/api/ticker-research/%20")
        self.assertEqual(response.status_code, 400)

    def test_held_etf_kind_uses_position_without_yahoo_metadata(self):
        holding = {
            "classification_type": "ETF",
            "description": "Example Broad Market ETF",
        }
        with patch.object(app_module, "_classify_fund_kind", return_value="etf") as classify:
            with patch("yfinance.Ticker") as yahoo_ticker:
                kind = app_module._ticker_research_kind("TEST", None, holding, {})
        self.assertEqual(kind, "etf")
        classify.assert_called_once()
        yahoo_ticker.assert_not_called()

    def test_broker_description_without_space_still_classifies_as_etf(self):
        holding = {
            "classification_type": None,
            "description": "FT CONFLUENCE BDC & SPECIALTY FINANCE INCOMEETF",
        }
        with patch.object(app_module, "_classify_fund_kind", return_value="etf") as classify:
            with patch("yfinance.Ticker") as yahoo_ticker:
                kind = app_module._ticker_research_kind("FBDC", None, holding, {})
        self.assertEqual(kind, "etf")
        self.assertTrue(app_module._ticker_research_explicit_etf(holding))
        classify.assert_called_once()
        yahoo_ticker.assert_not_called()

    def test_invalid_legacy_purchase_date_uses_valid_broker_transaction(self):
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO profiles (id, name, include_in_owner) VALUES (6, 'Broker IRA', 1)"
        )
        conn.execute(
            """INSERT INTO all_account_info (
                   ticker, profile_id, description, quantity, price_paid,
                   purchase_value, current_value, purchase_date, import_date
               ) VALUES ('CHPY', 1, 'Example ETF', 45, 61.4, 2763, 3100,
                         '20226-04-10', '2026-08-21')"""
        )
        conn.execute(
            """INSERT INTO all_account_info (
                   ticker, profile_id, description, quantity, price_paid,
                   purchase_value, current_value, purchase_date, import_date
               ) VALUES ('CHPY', 6, 'Example ETF', 45, 61.4, 2763, 3100,
                         '2026-04-10', '2026-08-21')"""
        )
        conn.executemany(
            """INSERT INTO transactions (
                   ticker, profile_id, transaction_type, transaction_date,
                   shares, price_per_share
               ) VALUES ('CHPY', ?, 'BUY', ?, ?, 61.4)""",
            [(1, '20226-04-10', 21), (6, '2026-04-10', 45)],
        )
        conn.commit()
        conn.close()

        context_conn = self._get_connection()
        try:
            with app_module.app.test_request_context("/?profile_id=1"):
                with patch.object(app_module, "get_profile_filter", return_value=(False, [1])):
                    holding, _ = app_module._ticker_research_holding("CHPY")
                    row, txn = app_module._ticker_return_holding_context(context_conn, "CHPY")
        finally:
            context_conn.close()

        self.assertEqual(holding["purchase_date"], "2026-04-10")
        self.assertEqual(row["purchase_date"], "20226-04-10")
        self.assertEqual(txn["transaction_date"], "2026-04-10")

    def test_combined_export_rejects_unparseable_transaction_date(self):
        self.assertEqual(app_module._combined_export_clean_date("20226-04-10"), "")
        self.assertEqual(app_module._combined_export_clean_date("04/10/2026"), "2026-04-10")

    def test_transaction_date_validation_checks_the_whole_date(self):
        self.assertIsNone(app_module._transaction_date_error("2026-04-10"))
        self.assertIn("YYYY-MM-DD", app_module._transaction_date_error("2026-13-40"))
        self.assertIn("YYYY-MM-DD", app_module._transaction_date_error("20226-04-10"))

    def test_nav_endpoint_computes_one_ticker_when_portfolio_cache_is_empty(self):
        self._insert_holding("NIHI", quantity=20, current_value=1000)
        nav = {
            "ticker": "NIHI",
            "coverage_ratio": 0.18,
            "nav_erosion_severity": "Low",
            "nav_tested": True,
        }
        with patch.object(app_module, "_ticker_research_cached_nav", return_value=None):
            with patch.object(
                app_module,
                "_build_nav_coverage_payload",
                return_value={"results": [nav]},
            ) as build:
                body = self.client.get("/api/ticker-research/NIHI/nav").get_json()

        self.assertEqual(body["nav"], nav)
        ticker_info = build.call_args.args[0]
        self.assertEqual(ticker_info["NIHI"]["quantity"], 20)
        self.assertEqual(ticker_info["NIHI"]["current_value"], 1000)

    def test_closure_risk_accepts_official_etf_classification_and_aum(self):
        response = {
            "fund_type": "ETF",
            "total_assets": 195_339_275,
            "expense_ratio_pct": 0.75,
            "inception_date": "2025-09-16",
            "data_source": "NEOS Investments",
        }
        yahoo_info = {
            "quoteType": "ETF",
            "totalAssets": 186_600_000,
            "annualReportExpenseRatio": 0.68,
        }
        risk = app_module._assess_etf_closure_risk_with_fallback(yahoo_info, response)
        self.assertEqual(risk["tier"], "ok")
        self.assertEqual(risk["aum"], 195_339_275)
        self.assertEqual(risk["expense_ratio"], 0.0075)

    def test_tappalpha_profile_uses_official_public_fund_payload(self):
        payload = {
            "fund": {
                "ticker": "TSPY",
                "name": "TappAlpha S&P 500 Growth & Daily Income ETF",
                "investment_objective": "Official objective.",
                "net_expense_ratio": 0.71,
                "inception_date": "2024-08-14",
            },
            "latest": {
                "as_of_date": "2026-08-21",
                "nav": 25.58,
                "market_price": 25.60,
                "net_assets": 317_406_810.61,
                "distribution_frequency": "monthly",
                "distribution_rate": 13.94,
                "sec_yield_30day": 0.41,
                "trailing_12mo_yield": 14.93,
            },
            "holdings": [{
                "security_name": "Vanguard S&P 500 ETF",
                "security_ticker": "VOO",
                "weight": 99.79,
                "as_of_date": "2026-08-21",
            }],
        }
        with patch.object(app_module, "_fetch_tappalpha_public_payload", return_value=payload):
            with patch.object(app_module, "_persist_market_payload"):
                profile = app_module._fetch_tappalpha_etf_profile("TSPY", use_cache=False)

        self.assertEqual(profile["data_source"], "TappAlpha")
        self.assertEqual(profile["total_assets"], 317_406_810.61)
        self.assertEqual(profile["expense_ratio_pct"], 0.71)
        self.assertEqual(profile["estimated_yield_pct"], 13.94)
        self.assertEqual(profile["sec_30_day_yield_pct"], 0.41)
        self.assertEqual(profile["nav_price"], 25.58)
        self.assertEqual(profile["top_holdings"][0]["symbol"], "VOO")

    def test_tappalpha_distribution_snapshot_uses_official_api_rows(self):
        payload = {
            "fund": {"ticker": "TSPY"},
            "latest": {
                "distribution_frequency": "monthly",
                "distribution_rate": 13.94,
            },
            "distributions": [
                {"ex_date": "2026-09-01", "pay_date": "2026-09-02", "amount": None},
                {"ex_date": "2026-08-04", "pay_date": "2026-08-05", "amount": 0.30007},
                {"ex_date": "2026-06-30", "pay_date": "2026-07-01", "amount": 0.29518},
            ],
        }
        with patch.object(app_module, "_fetch_tappalpha_public_payload", return_value=payload):
            snapshot = app_module._fetch_tappalpha_distribution_snapshot("TSPY")

        self.assertEqual(snapshot["source"], "TappAlpha")
        self.assertEqual(snapshot["freq"], "M")
        self.assertEqual(snapshot["div"], 0.30007)
        self.assertEqual(snapshot["distribution_rate_pct"], 13.94)
        self.assertEqual(len(snapshot["history"]), 2)

    def test_tappalpha_current_fund_family_includes_tmgn(self):
        self.assertTrue(app_module._is_tappalpha_fund("TMGN"))


if __name__ == "__main__":
    unittest.main()
