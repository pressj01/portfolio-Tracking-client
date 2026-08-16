"""A Div/Share typed on the holdings screen has to survive the market refresh.

The refresh writes Yahoo's per-share amount back on every run and the dashboard
fires one on load, so a manual correction used to be gone before it could be
seen anywhere. It is pinned now -- until the fund declares its next
distribution, at which point the market speaks for the holding again.
"""

import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database as database_module


class ManualDividendOverrideWindowTest(unittest.TestCase):
    def test_weekly_payer_expires_after_about_a_week(self):
        # Stored ex-date is the last one, so the window runs to the next.
        until = app_module._manual_dividend_override_expiry(
            "08/05/26", "W", today=datetime.date(2026, 8, 8)
        )

        self.assertEqual(until, "2026-08-15")

    def test_quarterly_payer_holds_through_the_cycle(self):
        until = app_module._manual_dividend_override_expiry(
            "07/14/26", "Q", today=datetime.date(2026, 8, 8)
        )

        self.assertEqual(until, "2026-10-16")

    def test_stale_ex_date_still_projects_a_future_expiry(self):
        # Two years of monthly payments to step through, not one cycle.
        until = app_module._manual_dividend_override_expiry(
            "01/15/24", "M", today=datetime.date(2026, 8, 8)
        )

        self.assertGreater(until, "2026-08-08")
        self.assertLess(until, "2026-09-20")

    def test_missing_schedule_falls_back_to_a_fixed_window(self):
        until = app_module._manual_dividend_override_expiry(
            None, None, today=datetime.date(2026, 8, 8)
        )

        self.assertEqual(until, "2026-09-22")

    def test_override_is_active_through_its_final_day(self):
        today = datetime.date(2026, 8, 8)

        self.assertTrue(app_module._manual_dividend_override_active("2026-08-08", today))
        self.assertFalse(app_module._manual_dividend_override_active("2026-08-07", today))
        self.assertFalse(app_module._manual_dividend_override_active(None, today))

    def test_resubmitting_the_same_amount_is_not_an_edit(self):
        self.assertFalse(app_module._manual_dividend_value_changed(0.165, 0.165))
        self.assertFalse(app_module._manual_dividend_value_changed(None, 0))
        self.assertTrue(app_module._manual_dividend_value_changed(0.165, 0.22))
        self.assertTrue(app_module._manual_dividend_value_changed(0.165, 0))


class ManualDividendOverrideApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._get_connection()
        try:
            database_module.ensure_tables_exist(conn)
            conn.execute(
                "INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Taxable', 0)"
            )
            conn.execute(
                "INSERT INTO profiles (id, name, include_in_owner) VALUES (3, 'IRA', 0)"
            )
            conn.commit()
        finally:
            conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_populate_holdings = app_module.populate_holdings
        self._orig_populate_dividends = app_module.populate_dividends
        self._orig_populate_income_tracking = app_module.populate_income_tracking
        self._orig_testing = app_module.app.testing
        app_module.get_connection = self._get_connection
        app_module.populate_holdings = lambda profile_id: None
        app_module.populate_dividends = lambda profile_id: None
        app_module.populate_income_tracking = lambda profile_id: None
        app_module.app.testing = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.populate_holdings = self._orig_populate_holdings
        app_module.populate_dividends = self._orig_populate_dividends
        app_module.populate_income_tracking = self._orig_populate_income_tracking
        app_module.app.testing = self._orig_testing
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _add_holding(self, profile_id, ticker="UTF", div=0.165, quantity=68.8091):
        conn = self._get_connection()
        try:
            conn.execute(
                """INSERT INTO all_account_info
                   (ticker, profile_id, description, quantity, price_paid, current_price,
                    purchase_value, current_value, purchase_date, base_quantity, import_date,
                    div, div_frequency, ex_div_date, div_pay_date, reinvest,
                    estim_payment_per_year, approx_monthly_income)
                   VALUES (?, ?, 'COHEN AND STEERS INFRASTRUCTURE', ?, 26.839, 27.23,
                           ?, ?, '2024-06-02', ?, '2026-01-02',
                           ?, 'M', '07/14/26', '07/28/26', 'N', ?, ?)""",
                (
                    ticker,
                    profile_id,
                    quantity,
                    quantity * 26.839,
                    quantity * 27.23,
                    quantity,
                    div,
                    div * quantity * 12,
                    div * quantity,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def _row(self, ticker="UTF", profile_id=2):
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM all_account_info WHERE ticker = ? AND profile_id = ?",
                (ticker, profile_id),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _refresh(self, profile_id=2, yahoo_div=0.165, close=27.23):
        """Run the real refresh against a one-ticker Yahoo response."""
        history = pd.DataFrame(
            {"Close": [close, close], "Dividends": [0.0, yahoo_div]},
            index=pd.to_datetime(["2026-06-12", "2026-07-14"]),
        )
        with patch.object(app_module, "_chunked_yf_download", return_value=history):
            return self.client.post(f"/api/refresh?profile_id={profile_id}")

    def _refresh_with_monthly_history(self, profile_id=2, yahoo_div=0.309, close=27.23):
        """Refresh with a provider history that incorrectly looks monthly."""
        history = pd.DataFrame(
            {"Close": [close, close, close], "Dividends": [0.0, yahoo_div, yahoo_div]},
            index=pd.to_datetime(["2026-06-12", "2026-06-16", "2026-07-16"]),
        )
        with patch.object(app_module, "_chunked_yf_download", return_value=history):
            return self.client.post(f"/api/refresh?profile_id={profile_id}")

    def test_edited_div_is_pinned_and_income_follows_it(self):
        self._add_holding(2)

        res = self.client.put("/api/holdings/UTF?profile_id=2", json={"div": 0.22})

        self.assertEqual(res.status_code, 200)
        row = self._row()
        self.assertAlmostEqual(row["div"], 0.22, places=6)
        self.assertEqual(row["div_manual_set_at"], datetime.date.today().isoformat())
        self.assertTrue(app_module._manual_dividend_override_active(row["div_manual_until"]))
        # 0.22 x 68.8091 shares x 12 months
        self.assertAlmostEqual(row["estim_payment_per_year"], 181.66, places=2)
        self.assertAlmostEqual(row["approx_monthly_income"], 15.14, places=2)

    def test_editing_something_else_does_not_pin_the_dividend(self):
        self._add_holding(2)

        res = self.client.put(
            "/api/holdings/UTF?profile_id=2",
            # The edit modal resubmits every field it renders, dividend included.
            json={"quantity": 70, "div": 0.165},
        )

        self.assertEqual(res.status_code, 200)
        self.assertIsNone(self._row()["div_manual_until"])

    def test_edit_applies_to_every_account_holding_the_ticker(self):
        self._add_holding(2)
        self._add_holding(3, quantity=10)

        self.client.put("/api/holdings/UTF?profile_id=2", json={"div": 0.22})

        other = self._row(profile_id=3)
        self.assertAlmostEqual(other["div"], 0.22, places=6)
        self.assertTrue(app_module._manual_dividend_override_active(other["div_manual_until"]))
        self.assertAlmostEqual(other["estim_payment_per_year"], 0.22 * 10 * 12, places=2)

    def test_market_refresh_leaves_a_pinned_dividend_alone(self):
        self._add_holding(2)
        self.client.put("/api/holdings/UTF?profile_id=2", json={"div": 0.22})

        res = self._refresh(yahoo_div=0.165)

        self.assertEqual(res.status_code, 200)
        row = self._row()
        self.assertAlmostEqual(row["div"], 0.22, places=6)
        self.assertAlmostEqual(row["estim_payment_per_year"], 0.22 * 68.8091 * 12, places=2)
        self.assertIsNotNone(row["div_manual_until"])

    def test_market_refresh_annualizes_a_locked_weekly_frequency_as_weekly(self):
        self._add_holding(2)
        self.client.put("/api/holdings/UTF?profile_id=2", json={"div_frequency": "W"})

        res = self._refresh_with_monthly_history()

        self.assertEqual(res.status_code, 200)
        row = self._row()
        self.assertEqual(row["div_frequency"], "W")
        self.assertTrue(row["div_frequency_locked"])
        self.assertAlmostEqual(row["div"], 0.309, places=6)
        self.assertAlmostEqual(row["estim_payment_per_year"], 0.309 * 68.8091 * 52, places=2)
        self.assertAlmostEqual(row["approx_monthly_income"], 0.309 * 68.8091 * 52 / 12, places=2)

    def test_refresh_takes_market_data_back_once_the_override_expires(self):
        self._add_holding(2)
        self.client.put("/api/holdings/UTF?profile_id=2", json={"div": 0.22})
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET div_manual_until = ? WHERE ticker = 'UTF'",
                ((datetime.date.today() - datetime.timedelta(days=1)).isoformat(),),
            )
            conn.commit()
        finally:
            conn.close()

        res = self._refresh(yahoo_div=0.165)

        self.assertEqual(res.status_code, 200)
        row = self._row()
        self.assertAlmostEqual(row["div"], 0.165, places=6)
        self.assertIsNone(row["div_manual_until"])
        self.assertIsNone(row["div_manual_set_at"])

    def test_handing_the_dividend_back_to_the_market_clears_the_pin(self):
        self._add_holding(2)
        self._add_holding(3, quantity=10)
        self.client.put("/api/holdings/UTF?profile_id=2", json={"div": 0.22})

        res = self.client.put(
            "/api/holdings/UTF?profile_id=2",
            json={"div": 0.22, "div_manual_clear": True},
        )

        self.assertEqual(res.status_code, 200)
        self.assertIsNone(self._row()["div_manual_until"])
        self.assertIsNone(self._row(profile_id=3)["div_manual_until"])

    def test_aggregate_read_reports_the_pinned_amount(self):
        # The aggregate folds Div/Share to cash paid per share, an average that
        # reads low when one account bought after the ex-date. A pinned amount
        # has to come through that fold intact.
        self._add_holding(2)
        self._add_holding(3, quantity=10)
        conn = self._get_connection()
        try:
            conn.execute(
                "INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (5, 2), (5, 3)"
            )
            # Bought after the ex-date, so this account collects nothing for the
            # current distribution and drags the cash-per-share average down.
            conn.execute(
                "UPDATE all_account_info SET purchase_date = '2026-08-01' WHERE profile_id = 3"
            )
            conn.commit()
        finally:
            conn.close()
        self.client.put("/api/holdings/UTF?profile_id=2", json={"div": 0.22})
        self.assertEqual(self._row(profile_id=3)["dividend_paid"], 0)

        res = self.client.get("/api/holdings?aggregate_id=5")

        self.assertEqual(res.status_code, 200)
        row = res.get_json()[0]
        self.assertEqual(row["ticker"], "UTF")
        self.assertAlmostEqual(row["div"], 0.22, places=6)
        self.assertTrue(app_module._manual_dividend_override_active(row["div_manual_until"]))

    def test_holdings_read_reports_the_pinned_amount_and_its_expiry(self):
        self._add_holding(2)
        self.client.put("/api/holdings/UTF?profile_id=2", json={"div": 0.22})

        res = self.client.get("/api/holdings?profile_id=2")

        self.assertEqual(res.status_code, 200)
        row = res.get_json()[0]
        self.assertAlmostEqual(row["div"], 0.22, places=6)
        self.assertTrue(app_module._manual_dividend_override_active(row["div_manual_until"]))

    def test_holdings_read_does_not_fetch_calendar_providers_on_cache_miss(self):
        self._add_holding(2)
        app_module._clear_dividend_event_caches()

        with (
            patch.object(app_module, "_yf_div_pay_date") as yahoo_pay_date,
            patch.object(app_module, "_fetch_official_distribution_snapshot") as official_snapshot,
        ):
            res = self.client.get("/api/holdings?profile_id=2")

        self.assertEqual(res.status_code, 200)
        yahoo_pay_date.assert_not_called()
        official_snapshot.assert_not_called()


if __name__ == "__main__":
    unittest.main()
