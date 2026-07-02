import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database
from cash_flow import (
    classify_holding_scenario_type,
    expand_plan,
    next_bill_schedule,
    portfolio_scenario_assumptions,
    simulate_sustainability,
)


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

    def test_expense_due_and_pay_dates_are_saved_and_editable(self):
        created = self._add(
            start_date="2026-07-01",
            due_date="2026-07-01",
            pay_date="2026-06-29",
        ).get_json()["item"]
        self.assertEqual(created["due_date"], "2026-07-01")
        self.assertEqual(created["pay_date"], "2026-06-29")

        created["pay_date"] = "2026-06-28"
        updated = self.client.put(
            f"/api/cash-flow/items/{created['id']}?profile_id=1",
            json=created,
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["item"]["pay_date"], "2026-06-28")

        summary = self.client.get(
            f"/api/cash-flow/summary?profile_id=1&plan_id={self.plan_id}&month=2026-07"
        ).get_json()["summary"]
        detail = next(row for row in summary["items"] if row["id"] == created["id"])
        self.assertEqual(detail["due_dates"], ["2026-07-01"])
        self.assertEqual(detail["pay_dates"], ["2026-06-28"])

    def test_expense_can_be_saved_off_and_restored(self):
        created = self._add().get_json()["item"]
        created["active"] = False
        saved = self.client.put(
            f"/api/cash-flow/items/{created['id']}?profile_id=1",
            json=created,
        )
        self.assertEqual(saved.status_code, 200)
        self.assertFalse(saved.get_json()["item"]["active"])

        summary = self.client.get(
            f"/api/cash-flow/summary?profile_id=1&plan_id={self.plan_id}&month=2026-01"
        ).get_json()["summary"]
        self.assertEqual(summary["expenses"], 0)
        items = self.client.get(
            f"/api/cash-flow/items?profile_id=1&plan_id={self.plan_id}"
        ).get_json()["items"]
        self.assertEqual(len(items), 1)
        self.assertFalse(items[0]["active"])

        created["active"] = True
        restored = self.client.put(
            f"/api/cash-flow/items/{created['id']}?profile_id=1",
            json=created,
        )
        self.assertEqual(restored.status_code, 200)
        self.assertTrue(restored.get_json()["item"]["active"])

    def test_expense_can_move_to_another_account_with_payment_history(self):
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO profiles (id, name) VALUES (2, 'Second Account')")
            conn.commit()
        finally:
            conn.close()
        due_date = datetime.date.today() + datetime.timedelta(days=1)
        created = self._add(
            frequency="one_time",
            start_date=due_date.isoformat(),
            due_date=due_date.isoformat(),
            pay_date=(due_date - datetime.timedelta(days=2)).isoformat(),
        ).get_json()["item"]
        paid = self.client.put(
            f"/api/cash-flow/items/{created['id']}/payments/{due_date.isoformat()}?profile_id=1",
            json={"paid": True},
        )
        self.assertEqual(paid.status_code, 200)

        moved = self.client.post(
            f"/api/cash-flow/items/{created['id']}/move?profile_id=1",
            json={"target_profile_id": 2},
        )
        self.assertEqual(moved.status_code, 200)
        self.assertEqual(moved.get_json()["target"]["profile_name"], "Second Account")
        self.assertTrue(moved.get_json()["item"]["paid"])

        source_items = self.client.get(
            f"/api/cash-flow/items?profile_id=1&plan_id={self.plan_id}"
        ).get_json()["items"]
        self.assertEqual(source_items, [])
        target_plan_id = moved.get_json()["target"]["plan_id"]
        target_items = self.client.get(
            f"/api/cash-flow/items?profile_id=2&plan_id={target_plan_id}"
        ).get_json()["items"]
        self.assertEqual(len(target_items), 1)
        self.assertEqual(target_items[0]["id"], created["id"])
        self.assertTrue(target_items[0]["paid"])

        same_account = self.client.post(
            f"/api/cash-flow/items/{created['id']}/move?profile_id=2",
            json={"target_profile_id": 2},
        )
        self.assertEqual(same_account.status_code, 400)

    def test_additional_income_can_be_saved_off_moved_and_restored(self):
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO profiles (id, name) VALUES (2, 'Income Account')")
            conn.commit()
        finally:
            conn.close()
        created = self._add(
            kind="income",
            name="Pension",
            amount=500,
            category="Pension",
            tax_rate_pct=10,
            essential=False,
        ).get_json()["item"]
        created["active"] = False
        saved = self.client.put(
            f"/api/cash-flow/items/{created['id']}?profile_id=1",
            json=created,
        )
        self.assertEqual(saved.status_code, 200)
        self.assertFalse(saved.get_json()["item"]["active"])

        moved = self.client.post(
            f"/api/cash-flow/items/{created['id']}/move?profile_id=1",
            json={"target_profile_id": 2},
        )
        self.assertEqual(moved.status_code, 200)
        target_plan_id = moved.get_json()["target"]["plan_id"]
        self.assertEqual(moved.get_json()["target"]["profile_name"], "Income Account")
        self.assertFalse(moved.get_json()["item"]["active"])

        moved_item = moved.get_json()["item"]
        moved_item["active"] = True
        restored = self.client.put(
            f"/api/cash-flow/items/{created['id']}?profile_id=2",
            json=moved_item,
        )
        self.assertEqual(restored.status_code, 200)
        self.assertTrue(restored.get_json()["item"]["active"])
        target_summary = self.client.get(
            f"/api/cash-flow/summary?profile_id=2&plan_id={target_plan_id}&month=2026-01"
        ).get_json()["summary"]
        self.assertEqual(target_summary["additional_income_net"], 450)

    def test_cash_flow_item_can_move_to_an_aggregate_account(self):
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO aggregates (id, name) VALUES (1, 'Household')")
            conn.commit()
        finally:
            conn.close()
        created = self._add(name="Utilities").get_json()["item"]

        moved = self.client.post(
            f"/api/cash-flow/items/{created['id']}/move?profile_id=1",
            json={"target_scope_type": "aggregate", "target_scope_id": 1},
        )
        self.assertEqual(moved.status_code, 200)
        target = moved.get_json()["target"]
        self.assertEqual(target["scope_type"], "aggregate")
        self.assertEqual(target["aggregate_name"], "Household")
        target_items = self.client.get(
            f"/api/cash-flow/items?aggregate_id=1&plan_id={target['plan_id']}"
        ).get_json()["items"]
        self.assertEqual(len(target_items), 1)
        self.assertEqual(target_items[0]["name"], "Utilities")

        same_aggregate = self.client.post(
            f"/api/cash-flow/items/{created['id']}/move?aggregate_id=1",
            json={"target_scope_type": "aggregate", "target_scope_id": 1},
        )
        self.assertEqual(same_aggregate.status_code, 400)

    def test_paid_check_is_tied_to_due_occurrence_not_view_month(self):
        today = datetime.date.today()
        due_date = today + datetime.timedelta(days=1)
        pay_date = due_date - datetime.timedelta(days=2)
        created = self._add(
            frequency="one_time",
            start_date=due_date.isoformat(),
            due_date=due_date.isoformat(),
            pay_date=pay_date.isoformat(),
        ).get_json()["item"]

        checked = self.client.put(
            f"/api/cash-flow/items/{created['id']}/payments/{due_date.isoformat()}?profile_id=1",
            json={"paid": True},
        )
        self.assertEqual(checked.status_code, 200)
        self.assertTrue(checked.get_json()["item"]["paid"])

        # Loading unrelated planning months cannot clear the current checklist.
        self.client.get(
            f"/api/cash-flow/summary?profile_id=1&plan_id={self.plan_id}&month=2025-01"
        )
        items = self.client.get(
            f"/api/cash-flow/items?profile_id=1&plan_id={self.plan_id}"
        ).get_json()["items"]
        item = next(row for row in items if row["id"] == created["id"])
        self.assertTrue(item["paid"])
        self.assertEqual(item["current_due_date"], due_date.isoformat())

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
        assumptions = response.get_json()["scenario_assumptions"]
        self.assertEqual(
            assumptions["bearish"]["method"],
            "holding_level_market_plus_distributions",
        )
        self.assertGreater(
            assumptions["bearish"]["year_one_income_change_pct"], -35
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
    @staticmethod
    def _flat_series(months=12, expenses=0):
        return [
            {
                "month": f"2026-{month:02d}",
                "expenses": expenses,
                "additional_income_net": 0,
            }
            for month in range(1, months + 1)
        ]

    def test_holding_types_separate_option_income_from_bonds_and_bdcs(self):
        self.assertEqual(
            classify_holding_scenario_type(
                {
                    "ticker": "OPTION",
                    "description": "Concentrated Option Income ETF",
                    "value": 100000,
                    "annual_income": 25000,
                }
            ),
            "high_distribution_option",
        )
        self.assertEqual(
            classify_holding_scenario_type(
                {
                    "ticker": "MUNI",
                    "description": "Short-Term Municipal Bond ETF",
                    "value": 100000,
                    "annual_income": 4000,
                }
            ),
            "fixed_income",
        )
        self.assertEqual(
            classify_holding_scenario_type(
                {
                    "ticker": "MAIN",
                    "description": "Business Development Company",
                    "value": 100000,
                    "annual_income": 7000,
                }
            ),
            "bdc",
        )

    def test_bill_rolls_only_after_due_date_and_keeps_prior_month_pay_date(self):
        bill = {
            "kind": "expense",
            "frequency": "monthly",
            "start_date": "2026-01-01",
            "end_date": None,
            "due_date": "2026-01-01",
            "pay_date": "2025-12-30",
        }
        before_due = next_bill_schedule(bill, datetime.date(2026, 6, 29))
        on_due = next_bill_schedule(bill, datetime.date(2026, 7, 1))
        after_due = next_bill_schedule(bill, datetime.date(2026, 7, 2))

        self.assertEqual(
            before_due,
            {"due_date": "2026-07-01", "pay_date": "2026-06-29"},
        )
        self.assertEqual(on_due, before_due)
        self.assertEqual(
            after_due,
            {"due_date": "2026-08-01", "pay_date": "2026-07-30"},
        )

    def test_bear_income_stress_is_not_copied_from_market_return(self):
        holdings = [
            {
                "ticker": "COVERED",
                "description": "Diversified Covered Call ETF",
                "value": 100000,
                "annual_income": 12000,
            }
        ]
        assumptions = portfolio_scenario_assumptions(holdings, "bearish")
        result = simulate_sustainability(
            self._flat_series(),
            portfolio_value=100000,
            annual_portfolio_income=12000,
            portfolio_holdings=holdings,
            portfolio_tax_pct=0,
            surplus_mode="cash",
            scenario="bearish",
        )
        self.assertEqual(assumptions["year_one_income_change_pct"], -10)
        self.assertEqual(assumptions["year_one_market_return_pct"], -18)
        self.assertAlmostEqual(result["ending_portfolio"], 82000, delta=1)
        self.assertAlmostEqual(
            result["series"][-1]["portfolio_income_gross"], 900, places=2
        )

    def test_distributions_are_cash_and_do_not_reduce_market_value(self):
        holdings = [
            {
                "ticker": "HIGH",
                "description": "Concentrated Option Income ETF",
                "value": 100000,
                "annual_income": 30000,
            }
        ]
        cash_result = simulate_sustainability(
            self._flat_series(),
            portfolio_value=100000,
            annual_portfolio_income=30000,
            portfolio_holdings=holdings,
            portfolio_tax_pct=0,
            surplus_mode="cash",
            scenario="neutral",
        )
        reinvested_result = simulate_sustainability(
            self._flat_series(),
            portfolio_value=100000,
            annual_portfolio_income=30000,
            portfolio_holdings=holdings,
            portfolio_tax_pct=0,
            surplus_mode="reinvest",
            scenario="neutral",
        )
        self.assertAlmostEqual(cash_result["ending_portfolio"], 107000, delta=1)
        self.assertGreater(cash_result["ending_cash"], 25000)
        self.assertGreater(reinvested_result["ending_portfolio"], 135000)
        self.assertEqual(reinvested_result["ending_cash"], 0)

    def test_each_tested_portfolio_uses_its_own_distribution_rate(self):
        low_yield = simulate_sustainability(
            self._flat_series(),
            portfolio_value=100000,
            annual_portfolio_income=8000,
            portfolio_holdings=[
                {
                    "ticker": "LOW",
                    "value": 100000,
                    "annual_income": 8000,
                }
            ],
            portfolio_tax_pct=0,
            scenario="neutral",
        )
        high_yield = simulate_sustainability(
            self._flat_series(),
            portfolio_value=100000,
            annual_portfolio_income=20000,
            portfolio_holdings=[
                {
                    "ticker": "HIGH",
                    "value": 100000,
                    "annual_income": 20000,
                }
            ],
            portfolio_tax_pct=0,
            scenario="neutral",
        )

        self.assertEqual(low_yield["starting_distribution_yield_pct"], 8)
        self.assertEqual(high_yield["starting_distribution_yield_pct"], 20)
        self.assertAlmostEqual(
            high_yield["series"][0]["portfolio_income_gross"]
            / low_yield["series"][0]["portfolio_income_gross"],
            20000 / 8000,
            places=4,
        )

    def test_shares_are_not_sold_when_distributions_cover_expenses(self):
        holdings = [
            {
                "ticker": "INCOME",
                "description": "Concentrated Option Income ETF",
                "value": 100000,
                "annual_income": 36000,
            }
        ]
        result = simulate_sustainability(
            self._flat_series(expenses=2000),
            portfolio_value=100000,
            annual_portfolio_income=36000,
            portfolio_holdings=holdings,
            portfolio_tax_pct=0,
            scenario="neutral",
        )
        self.assertEqual(result["status"], "income_covered")
        self.assertEqual(result["principal_drawn"], 0)
        self.assertGreater(result["ending_portfolio"], 120000)
        self.assertEqual(result["ending_cash"], 0)

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
