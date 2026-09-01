import csv
import datetime
import io
import json
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
        conn.execute("UPDATE profiles SET owner_active = 1 WHERE id = 1")
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
            # Isolate source-account reading: drop the Owner-direct holding that
            # setUp seeds so this test only exercises the linked accounts.
            conn.execute("DELETE FROM all_account_info WHERE profile_id = 1")
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

    def test_owner_summary_folds_in_owner_direct_holdings_without_double_counting(self):
        # A user on the Owner view who adds tickers manually stores them on
        # profile 1. Those must be counted (they show on every other screen),
        # while an imported ticker present on both Owner and a source account
        # must be counted only once.
        conn = self._get_connection()
        try:
            conn.execute(
                "INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Linked A', 1)"
            )
            # Imported holding 'A' in the linked source account...
            conn.execute(
                """INSERT INTO all_account_info
                   (ticker, profile_id, quantity, current_price, current_value,
                    estim_payment_per_year, approx_monthly_income)
                   VALUES ('A', 2, 10, 100, 1000, 12000, 1000)"""
            )
            # ...and its aggregate copy on Owner (profile 1): must NOT double count.
            conn.execute(
                """INSERT INTO all_account_info
                   (ticker, profile_id, quantity, current_price, current_value,
                    estim_payment_per_year, approx_monthly_income)
                   VALUES ('A', 1, 10, 100, 1000, 12000, 1000)"""
            )
            conn.commit()
        finally:
            conn.close()

        summary = self.client.get(
            f"/api/cash-flow/summary?profile_id=1&plan_id={self.plan_id}&month=2026-01"
        ).get_json()["summary"]
        # Source 'A' (1000/mo, counted once) + Owner-only 'INCOME' from setUp
        # (1000/mo, folded in) = 2000/mo. Owner-direct 'A' is de-duplicated.
        self.assertEqual(summary["portfolio_monthly_income_gross"], 2000)
        self.assertEqual(summary["portfolio_profile_count"], 2)

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

    def test_hold_growth_normalizes_lumps_without_inflating(self):
        # Retirement Readiness inflates expenses itself, so the series it reads
        # must stay in start-month dollars while still spreading the annual bill.
        self.client.put(
            "/api/cash-flow/settings?profile_id=1",
            json={
                "plan_id": self.plan_id,
                "horizon_years": 20,
                "expense_inflation_pct": 12,
                "portfolio_tax_pct": 15,
                "starting_cash": 0,
                "surplus_mode": "cash",
            },
        )
        self._add(name="Rent", amount=1000, start_date="2026-01-01")
        self._add(
            name="Property tax",
            amount=1200,
            frequency="annual",
            start_date="2026-01-15",
        )
        conn = self._get_connection()
        try:
            escalating = expand_plan(conn, self.plan_id, "2026-06", 12)
            level = expand_plan(conn, self.plan_id, "2026-06", 12, hold_growth=True)
        finally:
            conn.close()

        # Five months past the bills' start date, the opening month still bills
        # exactly what was entered. Escalating from each bill's own start date
        # instead left the month disagreeing with its own entry table.
        self.assertEqual(escalating[0]["expenses"], 1000)
        self.assertEqual(level[0]["expenses"], 1000)

        # Held flat, every month is the untouched rent except the January the
        # annual property tax lands in -- seven months into a June window.
        self.assertEqual(level[7]["month"], "2027-01")
        self.assertEqual(level[7]["expenses"], 2200)
        self.assertEqual(
            [row["expenses"] for i, row in enumerate(level) if i != 7], [1000] * 11
        )
        # The lump still normalizes: 12,000 rent + 1,200 tax over twelve months.
        self.assertAlmostEqual(
            sum(row["expenses"] for row in level) / 12, 1100, places=2
        )
        # The escalating series climbs, which is why averaging it overstates
        # today's cost and left this screen above the Cash Flow screen.
        self.assertGreater(escalating[-1]["expenses"], escalating[1]["expenses"])
        self.assertGreater(
            sum(row["expenses"] for row in escalating) / 12,
            sum(row["expenses"] for row in level) / 12,
        )

        response = self.client.get(
            f"/api/cash-flow/series?profile_id=1&plan_id={self.plan_id}"
            "&start_month=2026-06&months=12&hold_growth=1"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row["expenses"] for row in response.get_json()["series"]],
            [row["expenses"] for row in level],
        )

    def test_normalized_summary_stays_in_this_months_dollars(self):
        # A budget of plain monthly bills must report a normalized month equal to
        # the month it is standing in, or the two screens disagree on expenses.
        self.client.put(
            "/api/cash-flow/settings?profile_id=1",
            json={
                "plan_id": self.plan_id,
                "horizon_years": 20,
                "expense_inflation_pct": 3,
                "portfolio_tax_pct": 15,
                "starting_cash": 0,
                "surplus_mode": "cash",
            },
        )
        self._add(name="Rent", amount=1000, start_date="2026-01-01")
        summary = self.client.get(
            f"/api/cash-flow/summary?profile_id=1&plan_id={self.plan_id}"
            "&month=2026-06"
        ).get_json()["summary"]
        # And both equal the rent as entered, so the screen agrees with the
        # entry table it is summing.
        self.assertEqual(summary["expenses"], 1000)
        self.assertEqual(
            summary["normalized_monthly_expenses"], summary["expenses"]
        )
        self.assertEqual(
            summary["normalized_portfolio_required"], summary["portfolio_required"]
        )

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

    # ── backup: export and import ────────────────────────────────────────────

    def _export(self, export_format="json"):
        response = self.client.get(
            f"/api/cash-flow/export?profile_id=1&plan_id={self.plan_id}"
            f"&format={export_format}"
        )
        self.assertEqual(response.status_code, 200)
        return response

    def _import(self, content, mode="add", filename="backup.json"):
        return self.client.post(
            f"/api/cash-flow/import?profile_id=1",
            data={
                "plan_id": str(self.plan_id),
                "mode": mode,
                "file": (io.BytesIO(content.encode("utf-8")), filename),
            },
            content_type="multipart/form-data",
        )

    def _plan_items(self):
        return self.client.get(
            f"/api/cash-flow/items?profile_id=1&plan_id={self.plan_id}"
        ).get_json()["items"]

    def test_json_backup_round_trips_entries_history_and_settings(self):
        expense = self._add(
            name="Mortgage",
            amount=1500,
            start_date="2026-01-01",
            due_date="2026-01-05",
            pay_date="2026-01-03",
            notes="First of the month",
        ).get_json()["item"]
        self._add(
            kind="income", name="Pension", amount=800, tax_rate_pct=12,
            essential=False,
        )
        saved_off = self._add(name="Boat storage", amount=95).get_json()["item"]
        saved_off["active"] = False
        self.client.put(
            f"/api/cash-flow/items/{saved_off['id']}?profile_id=1", json=saved_off
        )
        self.client.put(
            f"/api/cash-flow/items/{expense['id']}/months/2026-02?profile_id=1",
            json={"amount": 1400},
        )
        # Only the open occurrence can be checked off, so use the one the API
        # reports rather than a hard-coded date.
        paid_due_date = expense["current_due_date"]
        paid = self.client.put(
            f"/api/cash-flow/items/{expense['id']}/payments/{paid_due_date}?profile_id=1",
            json={"paid": True},
        )
        self.assertEqual(paid.status_code, 200)
        self.client.put(
            "/api/cash-flow/settings?profile_id=1",
            json={
                "plan_id": self.plan_id,
                "horizon_years": 12,
                "expense_inflation_pct": 2.5,
                "portfolio_tax_pct": 22,
                "starting_cash": 4200,
                "surplus_mode": "cash",
            },
        )

        document = json.loads(self._export("json").data.decode("utf-8"))
        self.assertEqual(document["format"], "portfolio-tracker-cash-flow")
        self.assertEqual(len(document["items"]), 3)
        self.assertEqual(document["settings"]["horizon_years"], 12)
        self.assertEqual(document["settings"]["starting_cash"], 4200)

        # Wipe the plan the way a lost database would, then restore the file.
        for item in self._plan_items():
            self.client.delete(f"/api/cash-flow/items/{item['id']}?profile_id=1")
        self.client.put(
            "/api/cash-flow/settings?profile_id=1",
            json={
                "plan_id": self.plan_id,
                "horizon_years": 20,
                "expense_inflation_pct": 3,
                "portfolio_tax_pct": 15,
                "starting_cash": 0,
                "surplus_mode": "reinvest",
            },
        )
        self.assertEqual(self._plan_items(), [])

        result = self._import(json.dumps(document), mode="replace")
        self.assertEqual(result.status_code, 200)
        body = result.get_json()
        self.assertEqual(body["imported"], 3)
        self.assertEqual(body["source_format"], "json")
        self.assertTrue(body["settings_restored"])
        self.assertEqual(body["payments_restored"], 1)
        self.assertEqual(body["overrides_restored"], 1)

        restored = self._plan_items()
        self.assertEqual(len(restored), 3)
        by_name = {row["name"]: row for row in restored}
        self.assertEqual(by_name["Mortgage"]["amount"], 1500)
        self.assertEqual(by_name["Mortgage"]["due_date"], "2026-01-05")
        self.assertEqual(by_name["Mortgage"]["pay_date"], "2026-01-03")
        self.assertEqual(by_name["Mortgage"]["notes"], "First of the month")
        self.assertEqual(by_name["Pension"]["kind"], "income")
        self.assertEqual(by_name["Pension"]["tax_rate_pct"], 12)
        self.assertFalse(by_name["Boat storage"]["active"])
        self.assertEqual(by_name["Mortgage"]["current_due_date"], paid_due_date)
        self.assertTrue(by_name["Mortgage"]["paid"])

        settings = self.client.get(
            f"/api/cash-flow/settings?profile_id=1&plan_id={self.plan_id}"
        ).get_json()["settings"]
        self.assertEqual(settings["horizon_years"], 12)
        self.assertEqual(settings["starting_cash"], 4200)
        self.assertEqual(settings["surplus_mode"], "cash")

        conn = self._get_connection()
        try:
            series = expand_plan(conn, self.plan_id, "2026-02", 1)
        finally:
            conn.close()
        self.assertEqual(series[0]["expenses"], 1400)  # the per-month edit came back

    def test_csv_export_round_trips_through_a_spreadsheet_edit(self):
        self._add(name="Mortgage", amount=1500)
        self._add(
            kind="income", name="Pension", amount=800, tax_rate_pct=12,
            essential=False,
        )
        stored = self._add(
            name="Boat storage", amount=95, frequency="quarterly"
        ).get_json()["item"]
        stored["active"] = False
        self.client.put(
            f"/api/cash-flow/items/{stored['id']}?profile_id=1", json=stored
        )

        text = self._export("csv").data.decode("utf-8-sig")
        rows = {row["Name"]: row for row in csv.DictReader(io.StringIO(text))}
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows["Mortgage"]["Type"], "Expense")
        self.assertEqual(rows["Mortgage"]["Amount"], "1500.00")
        self.assertEqual(rows["Mortgage"]["Frequency"], "Monthly")
        self.assertEqual(rows["Mortgage"]["Status"], "Active")
        self.assertEqual(rows["Boat storage"]["Status"], "Saved off")
        self.assertEqual(rows["Boat storage"]["Frequency"], "Quarterly")
        self.assertEqual(rows["Pension"]["Tax %"], "12")
        # Income has no bill schedule, so its Next due stays blank.
        self.assertEqual(rows["Pension"]["Next due"], "")

        edited = text.replace("1500.00", "1625.00")
        result = self._import(edited, mode="replace", filename="plan.csv")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.get_json()["source_format"], "csv")
        by_name = {row["name"]: row for row in self._plan_items()}
        self.assertEqual(by_name["Mortgage"]["amount"], 1625)
        self.assertEqual(by_name["Pension"]["tax_rate_pct"], 12)
        self.assertEqual(by_name["Boat storage"]["frequency"], "quarterly")
        self.assertFalse(by_name["Boat storage"]["active"])

    def test_csv_separates_the_recurring_anchor_from_the_next_occurrence(self):
        """The two columns answer different questions and only one imports.

        The expenses table shows the upcoming bill under the heading "Due
        date", while the file has to carry the recurrence anchor or every
        restore would walk the schedule forward.
        """
        created = self._add(
            name="Mortgage",
            amount=1500,
            start_date="2026-01-01",
            due_date="2026-01-05",
            pay_date="2026-01-03",
        ).get_json()["item"]
        next_due = created["current_due_date"]
        self.assertNotEqual(next_due, "2026-01-05")  # months have passed

        row = list(csv.DictReader(io.StringIO(
            self._export("csv").data.decode("utf-8-sig")
        )))[0]
        self.assertEqual(row["Due date (recurring)"], "2026-01-05")
        self.assertEqual(row["Pay by (recurring)"], "2026-01-03")
        self.assertEqual(row["Next due"], next_due)

        # Next due is a snapshot for reading: editing it changes nothing.
        edited = (
            "Type,Name,Amount,Frequency,Due date (recurring),Next due\r\n"
            "Expense,Mortgage,1500,Monthly,2026-01-05,2029-12-31\r\n"
        )
        self.assertEqual(
            self._import(edited, mode="replace", filename="plan.csv").status_code,
            200,
        )
        restored = self._plan_items()[0]
        self.assertEqual(restored["due_date"], "2026-01-05")
        self.assertEqual(restored["current_due_date"], next_due)

    def test_files_exported_before_the_headers_were_renamed_still_import(self):
        old_style = (
            "Type,Name,Category,Amount,Frequency,Start date,End date,"
            "Due date,Pay by,Essential,Tax %,Annual change %,Notes,Status\r\n"
            "Expense,Mortgage,Housing,1500.00,Monthly,2026-01-01,,"
            "2026-01-05,2026-01-03,Yes,,,,Active\r\n"
        )
        result = self._import(old_style, mode="replace", filename="old.csv")
        self.assertEqual(result.status_code, 200, result.get_json())
        restored = self._plan_items()[0]
        self.assertEqual(restored["due_date"], "2026-01-05")
        self.assertEqual(restored["pay_date"], "2026-01-03")

    def test_add_mode_keeps_existing_entries_and_skips_duplicates(self):
        self._add(name="Mortgage", amount=1500)
        text = self._export("csv").data.decode("utf-8-sig")
        self._add(name="Groceries", amount=600)

        result = self._import(text, mode="add", filename="plan.csv")
        self.assertEqual(result.status_code, 200)
        body = result.get_json()
        self.assertEqual(body["imported"], 0)
        self.assertEqual(body["skipped"], 1)
        self.assertEqual(body["replaced"], 0)
        names = sorted(row["name"] for row in self._plan_items())
        self.assertEqual(names, ["Groceries", "Mortgage"])

        added = self._import(
            text.replace("Mortgage", "Second mortgage"),
            mode="add",
            filename="plan.csv",
        )
        self.assertEqual(added.get_json()["imported"], 1)
        self.assertEqual(len(self._plan_items()), 3)

    def test_hand_written_csv_columns_and_us_dates_are_accepted(self):
        text = (
            "Type,Name,Amount,Frequency,Due date,Category\r\n"
            "Expense,Water bill,$62.40,Every two weeks,8/15/2026,Utilities\r\n"
            "income,Rental,\"1,250\",Monthly,,Rental\r\n"
        )
        result = self._import(text, mode="add", filename="bills.csv")
        self.assertEqual(result.status_code, 200, result.get_json())
        by_name = {row["name"]: row for row in self._plan_items()}
        self.assertEqual(by_name["Water bill"]["amount"], 62.4)
        self.assertEqual(by_name["Water bill"]["frequency"], "biweekly")
        self.assertEqual(by_name["Water bill"]["due_date"], "2026-08-15")
        self.assertEqual(by_name["Water bill"]["start_date"], "2026-08-15")
        self.assertEqual(by_name["Rental"]["kind"], "income")
        self.assertEqual(by_name["Rental"]["amount"], 1250)

    def test_a_bad_row_imports_nothing_and_names_the_line(self):
        self._add(name="Mortgage", amount=1500)
        text = (
            "Type,Name,Amount,Frequency\r\n"
            "Expense,Water bill,62.40,Monthly\r\n"
            "Expense,,25,Monthly\r\n"
            "Expense,Cable,-30,Every fortnight or so\r\n"
        )
        result = self._import(text, mode="replace", filename="bills.csv")
        self.assertEqual(result.status_code, 400)
        body = result.get_json()
        self.assertEqual(len(body["errors"]), 2)
        # Parse failures and validation failures are found in separate passes
        # but must be reported in file order.
        self.assertTrue(body["errors"][0].startswith("Row 3"))
        self.assertTrue(body["errors"][1].startswith("Row 4"))
        # The replace must not have run: the existing plan is untouched.
        self.assertEqual([row["name"] for row in self._plan_items()], ["Mortgage"])

    def test_unreadable_files_are_rejected_with_a_usable_message(self):
        empty = self._import("   ", filename="plan.csv")
        self.assertEqual(empty.status_code, 400)
        self.assertIn("empty", empty.get_json()["error"].lower())

        wrong = self._import(
            "Ticker,Shares\r\nSCHD,100\r\n", filename="holdings.csv"
        )
        self.assertEqual(wrong.status_code, 400)
        self.assertIn("column", wrong.get_json()["error"])

        broken = self._import("{not json", filename="backup.json")
        self.assertEqual(broken.status_code, 400)
        self.assertIn("JSON", broken.get_json()["error"])

    def test_import_into_a_borrowed_plan_is_refused(self):
        self._add(name="Mortgage", amount=1500)
        text = self._export("csv").data.decode("utf-8-sig")
        conn = self._get_connection()
        try:
            conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (2, 'Roth')")
            conn.commit()
        finally:
            conn.close()
        borrower = self.client.get(
            "/api/cash-flow/plans?profile_id=2"
        ).get_json()["plans"][0]["id"]
        linked = self.client.put(
            f"/api/cash-flow/plans/{borrower}/source?profile_id=2",
            json={"source_plan_id": self.plan_id},
        )
        self.assertEqual(linked.status_code, 200)

        refused = self.client.post(
            "/api/cash-flow/import?profile_id=2",
            data={
                "plan_id": str(borrower),
                "mode": "replace",
                "file": (io.BytesIO(text.encode("utf-8")), "plan.csv"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(refused.status_code, 400)
        self.assertIn("borrows", refused.get_json()["error"])
        # Borrowing means the export still shows the entries being modelled.
        borrowed_export = self.client.get(
            f"/api/cash-flow/export?profile_id=2&plan_id={borrower}&format=json"
        )
        document = json.loads(borrowed_export.data.decode("utf-8"))
        self.assertEqual(len(document["items"]), 1)
        self.assertEqual(document["plan"]["borrowed_from_plan_id"], self.plan_id)

    def test_export_filename_and_format_guard(self):
        response = self._export("csv")
        disposition = response.headers.get("Content-Disposition", "")
        self.assertIn("cash-flow-owner-monthly-cash-flow-", disposition)
        self.assertIn(".csv", disposition)
        bad = self.client.get(
            f"/api/cash-flow/export?profile_id=1&plan_id={self.plan_id}&format=pdf"
        )
        self.assertEqual(bad.status_code, 400)


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

    def test_growth_and_income_fund_types_use_ticker_strategy_registries(self):
        for ticker, description in (
            ("QQQI", "NEOS Nasdaq-100 High Income ETF"),
            ("SPYI", "NEOS S&P 500 High Income ETF"),
            ("GPIQ", "Goldman Sachs Nasdaq-100 Premium Income ETF"),
            ("GPIX", "Goldman Sachs S&P 500 Premium Income ETF"),
        ):
            with self.subTest(ticker=ticker):
                self.assertEqual(
                    classify_holding_scenario_type({
                        "ticker": ticker,
                        "description": description,
                        "classification_type": "ETF",
                        "value": 100000,
                        "annual_income": 10000,
                    }),
                    "option_income",
                )

        self.assertEqual(
            classify_holding_scenario_type({
                "ticker": "SCHD",
                "description": "Schwab U.S. Dividend Equity ETF",
                "classification_type": "ETF",
                "value": 100000,
                "annual_income": 3500,
            }),
            "dividend_growth",
        )
        self.assertEqual(
            classify_holding_scenario_type({
                "ticker": "QQQM",
                "description": "Invesco NASDAQ 100 ETF",
                "classification_type": "ETF",
                "value": 100000,
                "annual_income": 600,
            }),
            "non_income_equity",
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
