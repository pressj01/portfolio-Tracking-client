import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database
from cash_flow import expand_plan, simulate_sustainability


class CashFlowApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, quantity, current_price, current_value,
                estim_payment_per_year, approx_monthly_income)
               VALUES ('INCOME', 1, 100, 100, 10000, 12000, 1000)"""
        )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

        plans = self.client.get("/api/cash-flow/plans?profile_id=1").get_json()["plans"]
        self.plan_id = plans[0]["id"]
        self.client.put(
            "/api/cash-flow/settings?profile_id=1",
            json={
                "plan_id": self.plan_id,
                "horizon_years": 20,
                "expense_inflation_pct": 0,
                "portfolio_tax_pct": 15,
                "starting_cash": 0,
                "surplus_mode": "cash",
            },
        )

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _add(self, **overrides):
        payload = {
            "plan_id": self.plan_id,
            "kind": "expense",
            "name": "Housing",
            "amount": 1000,
            "category": "Housing",
            "frequency": "monthly",
            "start_date": "2026-01-01",
            "end_date": "",
            "essential": True,
            "annual_change_pct": "",
            "notes": "",
        }
        payload.update(overrides)
        return self.client.post(
            "/api/cash-flow/items?profile_id=1", json=payload
        )

    def test_default_plan_is_profile_scoped_and_versioned(self):
        first = self.client.get("/api/cash-flow/plans?profile_id=1").get_json()
        other = self.client.get("/api/cash-flow/plans?profile_id=2").get_json()
        self.assertNotEqual(first["plans"][0]["id"], other["plans"][0]["id"])
        version = first["plans"][0]["version"]
        self.assertEqual(self._add().status_code, 201)
        changed = self.client.get("/api/cash-flow/plans?profile_id=1").get_json()
        self.assertEqual(changed["plans"][0]["version"], version + 1)

    def test_crud_and_month_override(self):
        created = self._add().get_json()["item"]
        created["name"] = "Mortgage"
        created["amount"] = 1250
        updated = self.client.put(
            f"/api/cash-flow/items/{created['id']}?profile_id=1", json=created
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["item"]["name"], "Mortgage")

        override = self.client.put(
            f"/api/cash-flow/items/{created['id']}/months/2026-02?profile_id=1",
            json={"amount": 900},
        )
        self.assertEqual(override.status_code, 200)
        conn = self._get_connection()
        try:
            series = expand_plan(conn, self.plan_id, "2026-01", 2)
        finally:
            conn.close()
        self.assertEqual(series[0]["expenses"], 1250)
        self.assertEqual(series[1]["expenses"], 900)

        deleted = self.client.delete(
            f"/api/cash-flow/items/{created['id']}?profile_id=1"
        )
        self.assertEqual(deleted.status_code, 200)
        items = self.client.get(
            f"/api/cash-flow/items?profile_id=1&plan_id={self.plan_id}"
        ).get_json()["items"]
        self.assertEqual(items, [])

    def test_summary_combines_portfolio_and_after_tax_outside_income(self):
        self._add()
        self._add(
            kind="income",
            name="Pension",
            amount=500,
            category="Pension",
            tax_rate_pct=10,
            essential=False,
        )
        summary = self.client.get(
            f"/api/cash-flow/summary?profile_id=1&plan_id={self.plan_id}&month=2026-01"
        ).get_json()["summary"]
        self.assertEqual(summary["expenses"], 1000)
        self.assertEqual(summary["additional_income_net"], 450)
        self.assertEqual(summary["portfolio_monthly_income_net"], 850)
        self.assertEqual(summary["surplus_shortfall"], 300)
        self.assertTrue(summary["covered"])

    def test_owner_summary_reads_the_four_linked_source_accounts(self):
        conn = self._get_connection()
        try:
            conn.execute(
                "INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Linked A', 1)"
            )
            conn.execute(
                "INSERT INTO profiles (id, name, include_in_owner) VALUES (3, 'Linked B', 1)"
            )
            conn.execute(
                """INSERT INTO all_account_info
                   (ticker, profile_id, quantity, current_price, current_value,
                    estim_payment_per_year, approx_monthly_income)
                   VALUES ('A', 2, 10, 100, 1000, 12000, 1000)"""
            )
            conn.execute(
                """INSERT INTO all_account_info
                   (ticker, profile_id, quantity, current_price, current_value,
                    estim_payment_per_year, approx_monthly_income)
                   VALUES ('B', 3, 10, 100, 1000, 24000, 2000)"""
            )
            conn.commit()
        finally:
            conn.close()

        summary = self.client.get(
            f"/api/cash-flow/summary?profile_id=1&plan_id={self.plan_id}&month=2026-01"
        ).get_json()["summary"]
        self.assertEqual(summary["portfolio_profile_count"], 2)
        self.assertEqual(summary["portfolio_monthly_income_gross"], 3000)
        self.assertEqual(summary["portfolio_monthly_income_net"], 2550)

    def test_recurrence_expands_annual_and_weekly_items(self):
        self._add(
            name="Property tax",
            amount=1200,
            frequency="annual",
            start_date="2026-01-15",
        )
        self._add(
            name="Weekly groceries",
            amount=100,
            frequency="weekly",
            start_date="2026-01-01",
        )
        conn = self._get_connection()
        try:
            series = expand_plan(conn, self.plan_id, "2026-01", 2)
        finally:
            conn.close()
        self.assertEqual(series[0]["expenses"], 1700)  # annual + five Thursdays
        self.assertEqual(series[1]["expenses"], 400)

    def test_simulate_endpoint_returns_six_comparisons(self):
        self._add()
        response = self.client.post(
            "/api/cash-flow/simulate?profile_id=1",
            json={
                "plan_id": self.plan_id,
                "start_month": "2026-01",
                "horizon_years": 1,
            },
        )
        self.assertEqual(response.status_code, 200)
        results = response.get_json()["results"]
        self.assertEqual(len(results), 6)
        self.assertEqual(
            {row["scenario"] for row in results},
            {"bullish", "neutral", "bearish"},
        )

    def test_distribution_compare_schedule_reuses_saved_plan(self):
        self._add()
        self._add(
            kind="income",
            name="Pension",
            amount=250,
            tax_rate_pct=0,
            essential=False,
        )
        with app_module.app.test_request_context(
            "/api/distribution-compare/run?profile_id=1"
        ):
            schedule, meta, error = app_module._dc_cash_flow_withdrawal_schedule(
                {
                    "cash_flow_plan_id": self.plan_id,
                    "cash_flow_funding_mode": "net_after_income",
                    "cash_flow_start_month": "2026-01",
                },
                3,
            )
        self.assertIsNone(error)
        self.assertEqual(schedule, [750, 750, 750])
        self.assertEqual(meta["plan_id"], self.plan_id)


class SustainabilityMathTest(unittest.TestCase):
    def test_external_income_toggle_changes_principal_use(self):
        series = [
            {
                "month": f"2026-{month:02d}",
                "expenses": 1000,
                "additional_income_net": 1000,
            }
            for month in range(1, 13)
        ]
        with_income = simulate_sustainability(
            series,
            portfolio_value=100000,
            annual_portfolio_income=0,
            portfolio_tax_pct=0,
            scenario="neutral",
            include_additional_income=True,
        )
        without_income = simulate_sustainability(
            series,
            portfolio_value=100000,
            annual_portfolio_income=0,
            portfolio_tax_pct=0,
            scenario="neutral",
            include_additional_income=False,
        )
        self.assertEqual(with_income["status"], "income_covered")
        self.assertEqual(with_income["principal_drawn"], 0)
        self.assertEqual(without_income["status"], "funded_from_principal")
        self.assertGreater(without_income["principal_drawn"], 11000)


if __name__ == "__main__":
    unittest.main()
