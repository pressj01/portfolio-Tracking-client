import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

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
                profile_id INTEGER
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
            """
        )
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_populate_holdings = app_module.populate_holdings
        self._orig_populate_dividends = app_module.populate_dividends
        app_module.get_connection = self._get_connection
        app_module.populate_holdings = lambda profile_id: None
        app_module.populate_dividends = lambda profile_id: None
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.populate_holdings = self._orig_populate_holdings
        app_module.populate_dividends = self._orig_populate_dividends
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
