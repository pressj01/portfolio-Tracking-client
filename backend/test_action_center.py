import sqlite3
import sys
import tempfile
import time
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class ActionCenterCompletionApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._get_connection()
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, description, quantity, current_value, div,
                estim_payment_per_year, approx_monthly_income)
               VALUES ('META', 1, 'Metadata test holding', 10, 1000, 1, 12, 1)"""
        )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_cef = app_module._cef_row_map
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        app_module._cef_row_map = lambda: {}
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        app_module._cef_row_map = self._orig_cef
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _action_center(self):
        response = self.client.get("/api/action-center?profile_id=1")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_completed_item_moves_out_of_active_list_and_can_be_restored(self):
        before = self._action_center()
        item = next(
            item for item in before["items"]
            if item["id"] == "complete-dividend-metadata"
        )
        self.assertTrue(item["can_complete"])

        complete = self.client.post(
            "/api/action-center/completions?profile_id=1",
            json={"action_id": item["id"]},
        )
        self.assertEqual(complete.status_code, 200)

        completed = self._action_center()
        self.assertNotIn(item["id"], [row["id"] for row in completed["items"]])
        restored_item = next(
            row for row in completed["completed_items"]
            if row["id"] == item["id"]
        )
        self.assertTrue(restored_item["completed"])
        self.assertEqual(completed["summary"]["completed_count"], 1)

        restore = self.client.delete(
            f"/api/action-center/completions/{item['id']}?profile_id=1"
        )
        self.assertEqual(restore.status_code, 200)

        after_restore = self._action_center()
        self.assertIn(item["id"], [row["id"] for row in after_restore["items"]])
        self.assertEqual(after_restore["summary"]["completed_count"], 0)

    def test_completion_requires_a_valid_action_id(self):
        response = self.client.post(
            "/api/action-center/completions?profile_id=1",
            json={"action_id": "not valid"},
        )
        self.assertEqual(response.status_code, 400)

    def _ids(self, payload):
        return [item["id"] for item in payload["items"]]

    def test_refresh_item_runs_a_refresh_action_not_a_holdings_link_only(self):
        payload = self._action_center()
        item = next(item for item in payload["items"] if item["id"] == "refresh-market-data")
        self.assertEqual(item["action"], "refresh")
        self.assertEqual(item["cta"], "Refresh Prices & Divs")
        self.assertFalse(item.get("can_complete"))

    def test_unallocated_holdings_cannot_be_marked_complete(self):
        conn = self._get_connection()
        conn.execute(
            "UPDATE all_account_info SET current_value = 5000 WHERE ticker = 'META' AND profile_id = 1"
        )
        conn.commit()
        conn.close()
        payload = self._action_center()
        item = next(item for item in payload["items"] if item["id"] == "assign-unallocated-holdings")
        self.assertFalse(item.get("can_complete"))
        self.assertEqual(item["route"], "/categories")

        complete = self.client.post(
            "/api/action-center/completions?profile_id=1",
            json={"action_id": item["id"]},
        )
        self.assertEqual(complete.status_code, 200)
        # Completing via the API must not hide a live allocation hole.
        after = self._action_center()
        self.assertIn("assign-unallocated-holdings", self._ids(after))

    def test_stale_broker_import_item_names_the_account(self):
        old = (date.today() - timedelta(days=45)).isoformat()
        conn = self._get_connection()
        conn.execute("UPDATE profiles SET positions_managed = 1, name = 'Schwab IRA' WHERE id = 1")
        conn.execute(
            "UPDATE all_account_info SET reinvest = 'Y', import_date = ?, quantity = 10 "
            "WHERE ticker = 'META' AND profile_id = 1",
            (old,),
        )
        conn.commit()
        conn.close()
        payload = self._action_center()
        item = next(item for item in payload["items"] if item["id"] == "stale-broker-import")
        self.assertEqual(item["priority"], "warning")
        self.assertIn("Schwab IRA", item["title"])
        self.assertEqual(item["route"], "/import")
        self.assertFalse(item.get("can_complete"))

    def test_option_expiration_and_roll_items(self):
        soon = (date.today() + timedelta(days=10)).isoformat()
        past = (date.today() - timedelta(days=3)).isoformat()
        conn = self._get_connection()
        conn.execute(
            """INSERT INTO option_trades
               (id, profile_id, underlying, strategy_type, purpose, status, opened_at)
               VALUES (11, 1, 'SPY', 'Short Put', 'Income', 'OPEN', ?)""",
            ((date.today() - timedelta(days=20)).isoformat(),),
        )
        conn.execute(
            """INSERT INTO option_trade_legs
               (trade_id, option_type, position_side, expiration, strike, contracts, status)
               VALUES (11, 'PUT', 'SHORT', ?, 500, 1, 'OPEN')""",
            (soon,),
        )
        conn.execute(
            """INSERT INTO option_trades
               (id, profile_id, underlying, strategy_type, purpose, status, opened_at)
               VALUES (12, 1, 'QQQ', 'Short Put', 'Income', 'OPEN', ?)""",
            ((date.today() - timedelta(days=40)).isoformat(),),
        )
        conn.execute(
            """INSERT INTO option_trade_legs
               (trade_id, option_type, position_side, expiration, strike, contracts, status)
               VALUES (12, 'PUT', 'SHORT', ?, 400, 1, 'OPEN')""",
            (past,),
        )
        conn.commit()
        conn.close()
        payload = self._action_center()
        ids = self._ids(payload)
        self.assertIn("option-rolls-due", ids)
        self.assertIn("option-expired-open", ids)
        rolls = next(item for item in payload["items"] if item["id"] == "option-rolls-due")
        self.assertEqual(rolls["route"], "/option-trades")
        self.assertIn("SPY", rolls["detail"])

    def test_option_roll_ignores_an_already_closed_expired_leg(self):
        soon = (date.today() + timedelta(days=10)).isoformat()
        past = (date.today() - timedelta(days=3)).isoformat()
        opened = (date.today() - timedelta(days=40)).isoformat()
        conn = self._get_connection()
        conn.execute(
            """INSERT INTO option_trades
               (id, profile_id, underlying, strategy_type, purpose, status, opened_at)
               VALUES (13, 1, 'IWM', 'Diagonal', 'Income', 'OPEN', ?)""",
            (opened,),
        )
        closed_leg = conn.execute(
            """INSERT INTO option_trade_legs
               (trade_id, option_type, position_side, expiration, strike, contracts, status)
               VALUES (13, 'CALL', 'LONG', ?, 200, 1, 'CLOSED')""",
            (past,),
        ).lastrowid
        open_leg = conn.execute(
            """INSERT INTO option_trade_legs
               (trade_id, option_type, position_side, expiration, strike, contracts, status)
               VALUES (13, 'CALL', 'SHORT', ?, 210, 1, 'OPEN')""",
            (soon,),
        ).lastrowid
        conn.executemany(
            """INSERT INTO option_executions
               (trade_id, leg_id, action, executed_at, contracts, price, fees, source)
               VALUES (13, ?, ?, ?, 1, 1, 0, 'manual')""",
            [
                (closed_leg, "BTO", opened),
                (closed_leg, "STC", past),
                (open_leg, "STO", opened),
            ],
        )
        conn.commit()
        conn.close()

        payload = self._action_center()
        ids = self._ids(payload)
        self.assertNotIn("option-expired-open", ids)
        rolls = next(item for item in payload["items"] if item["id"] == "option-rolls-due")
        self.assertIn(f"IWM {soon}", rolls["detail"])

    def test_unconfirmed_estimated_dividends_surface_after_pay_date(self):
        past = (date.today() - timedelta(days=2)).isoformat()
        conn = self._get_connection()
        conn.execute(
            """INSERT INTO dividend_payments
               (ticker, profile_id, payment_date, amount, source)
               VALUES ('META', 1, ?, 12.5, 'refresh_estimate')""",
            (past,),
        )
        conn.commit()
        conn.close()
        payload = self._action_center()
        item = next(item for item in payload["items"] if item["id"] == "estimated-dividends-unconfirmed")
        self.assertEqual(item["kind"], "dividend")
        self.assertEqual(item["route"], "/dividend-ledger")
        self.assertIn("META", item["detail"])
        self.assertFalse(item.get("can_complete"))

    def test_owner_view_includes_estimates_from_linked_refresh_accounts(self):
        past = (date.today() - timedelta(days=2)).isoformat()
        conn = self._get_connection()
        conn.execute(
            """INSERT INTO profiles (id, name, include_in_owner)
               VALUES (2, 'Linked IRA', 1)"""
        )
        conn.execute(
            """INSERT INTO dividend_payments
               (ticker, profile_id, payment_date, amount, source)
               VALUES ('SCHD', 2, ?, 25, 'refresh_estimate')""",
            (past,),
        )
        conn.commit()
        conn.close()

        payload = self._action_center()
        item = next(item for item in payload["items"] if item["id"] == "estimated-dividends-unconfirmed")
        self.assertIn("SCHD", item["detail"])

    def test_cef_discount_and_etf_closure_items(self):
        conn = self._get_connection()
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, description, quantity, current_value, classification_type)
               VALUES ('ADX', 1, 'Adams Diversified', 20, 2000, 'CEF')"""
        )
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, description, quantity, current_value, classification_type)
               VALUES ('ZZAC1', 1, 'Tiny ETF', 15, 800, 'ETF')"""
        )
        conn.execute(
            "INSERT INTO etf_providers (provider, total_assets, num_funds, avg_expense) "
            "VALUES ('ActionCenterTest', 0, 1, 0)"
        )
        provider_id = conn.execute(
            "SELECT id FROM etf_providers WHERE provider = 'ActionCenterTest'"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO etf_provider_funds (provider_id, symbol, fund_name, assets, exp_ratio) "
            "VALUES (?, 'ZZAC1', 'Tiny ETF', 8000000, 0.99)",
            (provider_id,),
        )
        conn.commit()
        conn.close()
        with patch.object(app_module, "_cef_row_map", return_value={
            "ADX": {"ticker": "ADX", "premium_discount": -14.2, "nav": 22.0},
        }):
            payload = self._action_center()
        ids = self._ids(payload)
        self.assertIn("cef-discount-review", ids)
        self.assertIn("etf-closure-risk", ids)
        cef = next(item for item in payload["items"] if item["id"] == "cef-discount-review")
        self.assertEqual(cef["route"], "/nav-erosion")
        self.assertIn("ADX", cef["detail"])
        closure = next(item for item in payload["items"] if item["id"] == "etf-closure-risk")
        self.assertIn("ZZAC1", closure["detail"])
        self.assertEqual(closure["route"], "/")

    def test_unknown_etf_aum_does_not_create_a_false_closure_alert(self):
        conn = self._get_connection()
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, description, quantity, current_value, classification_type)
               VALUES ('ZZAC2', 1, 'Unknown AUM ETF', 15, 800, 'ETF')"""
        )
        conn.execute(
            """INSERT INTO etf_providers (provider, total_assets, num_funds, avg_expense)
               VALUES ('ActionCenterNoAum', 0, 1, 0)"""
        )
        provider_id = conn.execute(
            "SELECT id FROM etf_providers WHERE provider = 'ActionCenterNoAum'"
        ).fetchone()[0]
        conn.execute(
            """INSERT INTO etf_provider_funds
               (provider_id, symbol, fund_name, assets, exp_ratio)
               VALUES (?, 'ZZAC2', 'Unknown AUM ETF', NULL, 0.99)""",
            (provider_id,),
        )
        conn.commit()
        conn.close()

        payload = self._action_center()
        self.assertNotIn("etf-closure-risk", self._ids(payload))

    def test_nav_erosion_cache_is_scoped_to_the_selected_profile(self):
        cache_key = (2, "destructive-nav-v14", (("META", "auto", ""),))
        cached = {
            "results": [{
                "ticker": "META",
                "coverage_ratio": -0.5,
                "price_change_pct": -20,
                "nav_erosion_severity": "high",
            }],
        }
        with patch.dict(
            app_module._PORTFOLIO_COVERAGE_CACHE,
            {cache_key: (time.time(), cached)},
            clear=True,
        ):
            payload = self._action_center()
        self.assertNotIn("nav-erosion-high", self._ids(payload))


if __name__ == "__main__":
    unittest.main()
