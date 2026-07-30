import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class ManualHoldingEditApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT,
                profile_id INTEGER,
                description TEXT,
                classification_type TEXT,
                quantity REAL,
                price_paid REAL,
                current_price REAL,
                purchase_value REAL,
                original_price_paid REAL,
                original_purchase_value REAL,
                broker_price_paid REAL,
                broker_purchase_value REAL,
                current_value REAL,
                gain_or_loss REAL,
                gain_or_loss_percentage REAL,
                percent_change REAL,
                purchase_date TEXT,
                base_quantity REAL,
                import_date TEXT,
                realized_gains REAL,
                div REAL,
                div_frequency TEXT,
                reinvest TEXT,
                ex_div_date TEXT,
                div_pay_date TEXT,
                dividend_paid REAL,
                estim_payment_per_year REAL,
                approx_monthly_income REAL,
                annual_yield_on_cost REAL,
                current_annual_yield REAL,
                current_month_income REAL,
                ytd_divs REAL,
                total_divs_received REAL,
                paid_for_itself REAL,
                cash_not_reinvested REAL,
                total_cash_reinvested REAL,
                shares_bought_from_dividend REAL,
                shares_bought_in_year REAL,
                shares_in_month REAL,
                withdraw_8pct_cost_annually REAL,
                withdraw_8pct_per_month REAL,
                nav_erosion_scope TEXT,
                nav_benchmark_override TEXT
            );
            CREATE TABLE categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                profile_id INTEGER
            );
            CREATE TABLE ticker_categories (
                ticker TEXT,
                category_id INTEGER,
                subcategory_id INTEGER,
                profile_id INTEGER
            );
            CREATE TABLE subcategories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER,
                name TEXT
            );
            CREATE TABLE dividend_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                profile_id INTEGER,
                payment_date TEXT,
                amount REAL,
                source TEXT,
                notes TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                profile_id INTEGER,
                transaction_type TEXT,
                transaction_date TEXT,
                shares REAL,
                price_per_share REAL,
                fees REAL,
                notes TEXT,
                realized_gain REAL
            );
            CREATE TABLE transaction_lot_allocations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sell_txn_id INTEGER,
                buy_txn_id INTEGER,
                shares REAL
            );
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY,
                name TEXT,
                include_in_owner INTEGER DEFAULT 0
            );
            INSERT INTO profiles (id, name, include_in_owner) VALUES (1, 'Owner', 0);
            """
        )
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

    def _execute(self, sql, params=()):
        conn = self._get_connection()
        try:
            conn.execute(sql, params)
            conn.commit()
        finally:
            conn.close()

    def _row(self, sql, params=()):
        conn = self._get_connection()
        try:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def test_add_holding_calculates_values_and_saves_reinvestment_fields(self):
        res = self.client.post(
            "/api/holdings?profile_id=1",
            json={
                "ticker": "abc",
                "quantity": 10,
                "price_paid": 20,
                "current_price": 25,
                "total_divs_received": 40,
                "cash_not_reinvested": 3,
                "total_cash_reinvested": 7,
                "shares_bought_from_dividend": 0.25,
            },
        )

        self.assertEqual(res.status_code, 201)
        row = self._row(
            "SELECT ticker, quantity, purchase_value, current_value, gain_or_loss, "
            "gain_or_loss_percentage, paid_for_itself, cash_not_reinvested, "
            "total_cash_reinvested, shares_bought_from_dividend "
            "FROM all_account_info WHERE ticker = 'ABC' AND profile_id = 1"
        )
        self.assertEqual(row["ticker"], "ABC")
        self.assertEqual(row["quantity"], 10)
        self.assertEqual(row["purchase_value"], 200)
        self.assertEqual(row["current_value"], 250)
        self.assertEqual(row["gain_or_loss"], 50)
        self.assertEqual(row["gain_or_loss_percentage"], 0.25)
        self.assertEqual(row["paid_for_itself"], 0.2)
        self.assertEqual(row["cash_not_reinvested"], 3)
        self.assertEqual(row["total_cash_reinvested"], 7)
        self.assertEqual(row["shares_bought_from_dividend"], 0.25)

    def test_update_current_price_recalculates_current_value_and_gain(self):
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
            "gain_or_loss, gain_or_loss_percentage, percent_change, total_divs_received) "
            "VALUES ('ABC', 1, 10, 20, 22, 200, 220, 20, 0.1, 0.1, 0)"
        )

        res = self.client.put(
            "/api/holdings/ABC?profile_id=1",
            json={"current_price": 18},
        )

        self.assertEqual(res.status_code, 200)
        row = self._row(
            "SELECT current_price, purchase_value, current_value, gain_or_loss, "
            "gain_or_loss_percentage, percent_change "
            "FROM all_account_info WHERE ticker = 'ABC' AND profile_id = 1"
        )
        self.assertEqual(row["current_price"], 18)
        self.assertEqual(row["purchase_value"], 200)
        self.assertEqual(row["current_value"], 180)
        self.assertEqual(row["gain_or_loss"], -20)
        self.assertEqual(row["gain_or_loss_percentage"], -0.1)
        self.assertEqual(row["percent_change"], -0.1)

    def test_dashboard_holdings_read_returns_saved_frequency_and_recomputed_income(self):
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
            "div, div_frequency, estim_payment_per_year, approx_monthly_income) "
            "VALUES ('WRTH', 1, 10, 30, 35, 300, 350, 0.409, 'A', 4.09, 0.34)"
        )

        update_res = self.client.put(
            "/api/holdings/WRTH?profile_id=1",
            json={"div_frequency": "Q"},
        )
        dashboard_res = self.client.get("/api/holdings?profile_id=1")

        self.assertEqual(update_res.status_code, 200)
        self.assertEqual(dashboard_res.status_code, 200)
        row = dashboard_res.get_json()[0]
        self.assertEqual(row["ticker"], "WRTH")
        self.assertEqual(row["div_frequency"], "Q")
        self.assertAlmostEqual(row["estim_payment_per_year"], 16.36, places=2)
        self.assertAlmostEqual(row["approx_monthly_income"], 1.36, places=2)

    def test_aggregate_dashboard_ticker_return_uses_member_holdings(self):
        self._execute(
            "CREATE TABLE aggregate_config "
            "(aggregate_id INTEGER, member_profile_id INTEGER)"
        )
        self._execute(
            "INSERT INTO aggregate_config (aggregate_id, member_profile_id) "
            "VALUES (3, 23), (3, 24)"
        )
        self._execute(
            "INSERT INTO profiles (id, name, include_in_owner) "
            "VALUES (23, 'Member A', 0), (24, 'Member B', 0)"
        )
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, description, quantity, purchase_date, price_paid, "
            "purchase_value, original_price_paid, original_purchase_value, "
            "broker_price_paid, broker_purchase_value) "
            "VALUES ('JPME', 23, 'JPMorgan Diversified Return U.S. Mid Cap Equity ETF', "
            "82, '2026-01-07', 104.21939, 8545.99, 104.209186, 8961.99, 104.21939, 8545.99)"
        )
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, description, quantity, purchase_date, price_paid, "
            "purchase_value, original_price_paid, original_purchase_value, "
            "broker_price_paid, broker_purchase_value) "
            "VALUES ('JPME', 24, 'JPMorgan Diversified Return U.S. Mid Cap Equity ETF', "
            "29, '2026-02-02', 104.23069, 3022.69, 104.215806, 3230.69, 104.23069, 3022.69)"
        )
        history = pd.DataFrame(
            {
                "Close": [110.0, 112.0, 114.0],
                "Dividends": [0.0, 0.25, 0.0],
            },
            index=pd.to_datetime(["2026-01-07", "2026-01-08", "2026-01-09"]),
        )

        with (
            patch("yfinance.Ticker") as ticker_mock,
            patch.object(app_module, "_chunked_yf_download", return_value=history),
        ):
            ticker_mock.return_value.info = {}
            res = self.client.get(
                "/api/ticker-return/JPME?aggregate_id=3&basis_mode=original"
            )

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["ticker"], "JPME")
        self.assertEqual(data["purchase_date"], "2026-01-07")
        self.assertEqual(len(data["dates"]), 3)
        self.assertEqual(len(data["price_return"]), 3)
        self.assertEqual(len(data["total_return"]), 3)
        self.assertAlmostEqual(
            data["price_paid"],
            (8961.99 + 3230.69) / (82 + 29),
            places=6,
        )

    def test_holdings_read_repairs_stored_excel_line_breaks_in_fund_name(self):
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, description, quantity, price_paid, purchase_value) "
            "VALUES ('JPME', 1, 'JPMORGAN_x000d_\nDIVERSIFIED RETURN U S_x000D_\nMID CAP EQUITY ETF', "
            "10, 104, 1040)"
        )

        res = self.client.get("/api/holdings?profile_id=1")

        self.assertEqual(res.status_code, 200)
        expected = "JPMORGAN DIVERSIFIED RETURN U S MID CAP EQUITY ETF"
        self.assertEqual(res.get_json()[0]["description"], expected)
        stored = self._row(
            "SELECT description FROM all_account_info "
            "WHERE ticker = 'JPME' AND profile_id = 1"
        )
        self.assertEqual(stored["description"], expected)

    def test_holdings_recomputes_current_yield_and_yoc_from_annual_income(self):
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
            "div, div_frequency, estim_payment_per_year, approx_monthly_income, "
            "annual_yield_on_cost, current_annual_yield, reinvest, shares_bought_from_dividend, "
            "total_cash_reinvested) "
            "VALUES ('WEPN', 1, 50.2562, 46.25315458, 45, 1875.17, 2261.529, "
            "0.1093, 'W', 285.64, 23.803333, 0, 0, 'Y', 0.2562, 11.77)"
        )

        res = self.client.get("/api/holdings?profile_id=1")

        self.assertEqual(res.status_code, 200)
        row = res.get_json()[0]
        self.assertAlmostEqual(row["current_annual_yield"], 285.64 / 2261.529, places=8)
        self.assertAlmostEqual(row["annual_yield_on_cost"], 285.64 / 1875.17, places=8)

    def test_holdings_yoc_uses_selected_basis_mode(self):
        conn = self._get_connection()
        try:
            app_module._ensure_basis_columns(conn)
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
                "original_price_paid, original_purchase_value, broker_price_paid, broker_purchase_value, "
                "estim_payment_per_year, approx_monthly_income, annual_yield_on_cost, current_annual_yield, "
                "reinvest, shares_bought_from_dividend, total_cash_reinvested) "
                "VALUES ('ABC', 1, 10, 10, 20, 100, 200, 10, 100, 12, 120, "
                "24, 2, 0, 0, 'N', 0, 0)"
            )
            conn.commit()
        finally:
            conn.close()

        original_res = self.client.get("/api/holdings?profile_id=1&basis_mode=original")
        broker_res = self.client.get("/api/holdings?profile_id=1&basis_mode=broker_adjusted")

        self.assertEqual(original_res.status_code, 200)
        self.assertEqual(broker_res.status_code, 200)
        original = original_res.get_json()[0]
        broker = broker_res.get_json()[0]
        self.assertAlmostEqual(original["annual_yield_on_cost"], 24 / 100, places=8)
        self.assertAlmostEqual(original["current_annual_yield"], 24 / 200, places=8)
        self.assertEqual(original["purchase_value"], 100)
        self.assertAlmostEqual(broker["annual_yield_on_cost"], 24 / 120, places=8)
        self.assertAlmostEqual(broker["current_annual_yield"], 24 / 200, places=8)
        self.assertEqual(broker["purchase_value"], 120)

    def test_holdings_prefers_explicit_broker_total_over_quantity_times_price(self):
        conn = self._get_connection()
        try:
            app_module._ensure_basis_columns(conn)
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
                "original_price_paid, original_purchase_value, broker_price_paid, broker_purchase_value, "
                "estim_payment_per_year, total_divs_received, reinvest) "
                "VALUES ('DRIP', 1, 50, 30, 45, 1500, 2250, 30, 1500, 40, 1800, 180, 360, 'Y')"
            )
            conn.commit()
        finally:
            conn.close()

        res = self.client.get("/api/holdings?profile_id=1&basis_mode=broker_adjusted")

        self.assertEqual(res.status_code, 200)
        row = res.get_json()[0]
        self.assertEqual(row["purchase_value"], 1800)
        self.assertEqual(row["gain_or_loss"], 450)
        self.assertAlmostEqual(row["annual_yield_on_cost"], 180 / 1800, places=8)
        self.assertAlmostEqual(row["paid_for_itself"], 360 / 1800, places=8)

    def test_broker_mode_manual_edit_preserves_original_basis(self):
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
            "original_price_paid, original_purchase_value, broker_price_paid, broker_purchase_value) "
            "VALUES ('ABC', 1, 10, 10, 25, 100, 250, 10, 100, 12, 120)"
        )

        res = self.client.put(
            "/api/holdings/ABC?profile_id=1&basis_mode=broker_adjusted",
            json={"price_paid": 14},
        )

        self.assertEqual(res.status_code, 200)
        row = self._row(
            "SELECT price_paid, purchase_value, original_price_paid, original_purchase_value, "
            "broker_price_paid, broker_purchase_value FROM all_account_info WHERE ticker = 'ABC'"
        )
        self.assertEqual(row["price_paid"], 14)
        self.assertEqual(row["purchase_value"], 140)
        self.assertEqual(row["broker_price_paid"], 14)
        self.assertEqual(row["broker_purchase_value"], 140)
        self.assertEqual(row["original_price_paid"], 10)
        self.assertEqual(row["original_purchase_value"], 100)

    def test_reconcile_owner_syncs_aggregate_basis_fields(self):
        conn = self._get_connection()
        try:
            app_module._ensure_basis_columns(conn)
            conn.execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (6, 'Taxable', 1)")
            conn.execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (7, 'IRA', 1)")
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
                "gain_or_loss, gain_or_loss_percentage, percent_change, original_price_paid, "
                "original_purchase_value, broker_price_paid, broker_purchase_value, reinvest, "
                "dividend_paid, estim_payment_per_year, approx_monthly_income) "
                "VALUES ('OVL', 1, 121, 56.94, 57.52, 6889.35, 6959.92, "
                "70.57, 0.010243, 0.010243, 56.44, 2822, 56.44, 2822, 'N', 0, 0, 0)"
            )
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
                "gain_or_loss, gain_or_loss_percentage, percent_change, original_price_paid, "
                "original_purchase_value, broker_price_paid, broker_purchase_value, reinvest, "
                "dividend_paid, estim_payment_per_year, approx_monthly_income) "
                "VALUES ('OVL', 6, 16, 56.45, 57.52, 903.2, 920.32, "
                "17.12, 0.018955, 0.018955, 56.445, 903.12, 56.45, 903.2, 'N', 0, 100, 8.333333)"
            )
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
                "gain_or_loss, gain_or_loss_percentage, percent_change, original_price_paid, "
                "original_purchase_value, broker_price_paid, broker_purchase_value, reinvest, "
                "dividend_paid, estim_payment_per_year, approx_monthly_income) "
                "VALUES ('OVL', 7, 105, 56.54, 57.52, 5986.15, 6039.6, "
                "53.45, 0.008928, 0.008928, 57.0138, 5986.35, 56.535, 5986.15, 'N', 0, 300, 25)"
            )
            conn.commit()
        finally:
            conn.close()

        res = self.client.post("/api/profiles/reconcile-owner", json={})

        self.assertEqual(res.status_code, 200)
        row = self._row(
            "SELECT quantity, purchase_value, original_price_paid, original_purchase_value, "
            "broker_price_paid, broker_purchase_value, estim_payment_per_year, "
            "annual_yield_on_cost, current_annual_yield "
            "FROM all_account_info WHERE ticker = 'OVL' AND profile_id = 1"
        )
        self.assertEqual(row["quantity"], 121)
        self.assertAlmostEqual(row["purchase_value"], 6889.35, places=2)
        self.assertAlmostEqual(row["original_purchase_value"], 6889.47, places=2)
        self.assertAlmostEqual(row["original_price_paid"], 6889.47 / 121, places=6)
        self.assertAlmostEqual(row["broker_purchase_value"], 6889.35, places=2)
        self.assertAlmostEqual(row["broker_price_paid"], 6889.35 / 121, places=6)
        self.assertAlmostEqual(row["estim_payment_per_year"], 400, places=6)
        self.assertAlmostEqual(row["annual_yield_on_cost"], 400 / 6889.35, places=8)
        self.assertAlmostEqual(row["current_annual_yield"], 400 / 6959.92, places=8)

    def test_update_quantity_to_zero_clears_stale_position_values(self):
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
            "gain_or_loss, gain_or_loss_percentage, percent_change, estim_payment_per_year, approx_monthly_income) "
            "VALUES ('ABC', 1, 10, 20, 25, 200, 250, 50, 0.25, 0.25, 12, 1)"
        )

        res = self.client.put(
            "/api/holdings/ABC?profile_id=1",
            json={"quantity": 0},
        )

        self.assertEqual(res.status_code, 200)
        row = self._row(
            "SELECT quantity, purchase_value, current_value, gain_or_loss, "
            "gain_or_loss_percentage, percent_change, estim_payment_per_year, approx_monthly_income "
            "FROM all_account_info WHERE ticker = 'ABC' AND profile_id = 1"
        )
        self.assertEqual(row["quantity"], 0)
        self.assertEqual(row["purchase_value"], 0)
        self.assertEqual(row["current_value"], 0)
        self.assertEqual(row["gain_or_loss"], 0)
        self.assertEqual(row["gain_or_loss_percentage"], 0)
        self.assertEqual(row["percent_change"], 0)
        self.assertEqual(row["estim_payment_per_year"], 0)
        self.assertEqual(row["approx_monthly_income"], 0)

    def test_drip_toggle_does_not_credit_dividend_bought_after_ex_date(self):
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
            "purchase_date, div, div_frequency, ex_div_date, div_pay_date, reinvest, "
            "dividend_paid, current_month_income, estim_payment_per_year, approx_monthly_income) "
            "VALUES ('UTF', 1, 68, 67.5811, 26.78, 4595.51, 1821.16, "
            "'2026-06-02', 0.165, 'M', '05/12/26', '06/02/26', 'N', "
            "11.22, 11.22, 134.64, 11.22)"
        )
        self._execute(
            "INSERT INTO dividend_payments "
            "(ticker, profile_id, payment_date, amount, source, notes) "
            "VALUES ('UTF', 1, '2026-06-02', 11.22, 'refresh_estimate', 'stale')"
        )

        res = self.client.put(
            "/api/holdings/UTF?profile_id=1",
            json={"reinvest": "Y"},
        )

        self.assertEqual(res.status_code, 200)
        row = self._row(
            "SELECT reinvest, dividend_paid, current_month_income, "
            "estim_payment_per_year, approx_monthly_income "
            "FROM all_account_info WHERE ticker = 'UTF' AND profile_id = 1"
        )
        self.assertEqual(row["reinvest"], "Y")
        self.assertEqual(row["dividend_paid"], 0)
        self.assertEqual(row["current_month_income"], 0)
        self.assertAlmostEqual(row["estim_payment_per_year"], 134.64, places=2)
        self.assertAlmostEqual(row["approx_monthly_income"], 11.22, places=2)
        payment = self._row(
            "SELECT amount FROM dividend_payments "
            "WHERE ticker = 'UTF' AND profile_id = 1 AND payment_date = '2026-06-02'"
        )
        self.assertIsNone(payment)

    def test_clearing_price_paid_removes_stale_cost_basis_and_gain(self):
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, current_price, purchase_value, current_value, "
            "gain_or_loss, gain_or_loss_percentage, percent_change) "
            "VALUES ('ABC', 1, 10, 20, 25, 200, 250, 50, 0.25, 0.25)"
        )

        res = self.client.put(
            "/api/holdings/ABC?profile_id=1",
            json={"price_paid": None},
        )

        self.assertEqual(res.status_code, 200)
        row = self._row(
            "SELECT price_paid, purchase_value, current_value, gain_or_loss, "
            "gain_or_loss_percentage, percent_change "
            "FROM all_account_info WHERE ticker = 'ABC' AND profile_id = 1"
        )
        self.assertIsNone(row["price_paid"])
        self.assertIsNone(row["purchase_value"])
        self.assertEqual(row["current_value"], 250)
        self.assertIsNone(row["gain_or_loss"])
        self.assertIsNone(row["gain_or_loss_percentage"])
        self.assertIsNone(row["percent_change"])


if __name__ == "__main__":
    unittest.main()
