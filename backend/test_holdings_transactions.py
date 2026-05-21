import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from app import (
    _refresh_transaction_realized_gains,
    _rollup_transactions,
    _validate_sell_quantity_available,
    _yahoo_symbol_for_ticker,
)


class HoldingsTransactionTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT,
                profile_id INTEGER,
                quantity REAL,
                price_paid REAL,
                purchase_value REAL,
                purchase_date TEXT,
                base_quantity REAL,
                import_date TEXT,
                realized_gains REAL,
                current_price REAL,
                current_value REAL,
                gain_or_loss REAL,
                gain_or_loss_percentage REAL,
                percent_change REAL,
                div REAL,
                div_frequency TEXT,
                ex_div_date TEXT,
                estim_payment_per_year REAL,
                approx_monthly_income REAL,
                annual_yield_on_cost REAL,
                current_annual_yield REAL,
                current_month_income REAL,
                dividend_paid REAL
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
            """
        )
        self._orig_populate_holdings = app_module.populate_holdings
        self._orig_populate_dividends = app_module.populate_dividends
        app_module.populate_holdings = lambda profile_id: None
        app_module.populate_dividends = lambda profile_id: None

    def tearDown(self):
        app_module.populate_holdings = self._orig_populate_holdings
        app_module.populate_dividends = self._orig_populate_dividends
        self.conn.close()

    def test_sell_rejects_more_shares_than_available_on_sell_date(self):
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-10', 10, 20, 0)"
        )

        with self.assertRaisesRegex(ValueError, "only 0.000000 shares are available"):
            _validate_sell_quantity_available(
                self.conn,
                "ABC",
                1,
                1,
                transaction_date="2026-01-09",
            )

        with self.assertRaisesRegex(ValueError, "only 10.000000 shares are available"):
            _validate_sell_quantity_available(
                self.conn,
                "ABC",
                1,
                11,
                transaction_date="2026-01-11",
            )

    def test_sell_rejects_when_it_breaks_later_existing_sell(self):
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-10', 10, 20, 0)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'SELL', '2026-01-20', 5, 21, 0)"
        )

        with self.assertRaisesRegex(ValueError, "only 4.000000 shares are available"):
            _validate_sell_quantity_available(
                self.conn,
                "ABC",
                1,
                6,
                transaction_date="2026-01-15",
            )

    def test_rollup_recreates_missing_holding_when_open_shares_return(self):
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-10', 10, 20, 1)"
        )

        _rollup_transactions("ABC", 1, self.conn)

        row = self.conn.execute(
            "SELECT quantity, price_paid, purchase_value, purchase_date FROM all_account_info "
            "WHERE ticker = 'ABC' AND profile_id = 1"
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["quantity"], 10)
        self.assertEqual(row["price_paid"], 20.1)
        self.assertEqual(row["purchase_value"], 201)
        self.assertEqual(row["purchase_date"], "2026-01-10")

    def test_preserved_position_realized_gain_refresh_does_not_change_holding(self):
        self.conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, price_paid, purchase_value, current_value, gain_or_loss) "
            "VALUES ('ABC', 1, 8, 10, 80, 96, 16)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-01', 10, 10, 0)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'SELL', '2026-01-10', 2, 15, 1)"
        )

        _refresh_transaction_realized_gains("ABC", 1, self.conn)

        sell_gain = self.conn.execute(
            "SELECT realized_gain FROM transactions WHERE ticker = 'ABC' AND transaction_type = 'SELL'"
        ).fetchone()["realized_gain"]
        holding = self.conn.execute(
            "SELECT quantity, purchase_value, current_value, gain_or_loss FROM all_account_info WHERE ticker = 'ABC'"
        ).fetchone()
        self.assertEqual(sell_gain, 9)
        self.assertEqual(holding["quantity"], 8)
        self.assertEqual(holding["purchase_value"], 80)
        self.assertEqual(holding["current_value"], 96)
        self.assertEqual(holding["gain_or_loss"], 16)

    def test_yahoo_symbol_normalizes_common_broker_spellings(self):
        self.assertEqual(_yahoo_symbol_for_ticker("BRKB"), "BRK-B")
        self.assertEqual(_yahoo_symbol_for_ticker("CODIPRB"), "CODI-PB")
        self.assertEqual(_yahoo_symbol_for_ticker("CODI-PRB"), "CODI-PB")
        self.assertEqual(_yahoo_symbol_for_ticker("CODI-PB"), "CODI-PB")
        self.assertEqual(_yahoo_symbol_for_ticker("CODIPRD"), "CODI-PD")
        self.assertEqual(_yahoo_symbol_for_ticker("MSFT"), "MSFT")


class HoldingsTransactionApiTest(unittest.TestCase):
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
                quantity REAL,
                price_paid REAL,
                purchase_value REAL,
                purchase_date TEXT,
                base_quantity REAL,
                import_date TEXT,
                realized_gains REAL,
                current_price REAL,
                current_value REAL,
                gain_or_loss REAL,
                gain_or_loss_percentage REAL,
                percent_change REAL,
                div REAL,
                div_frequency TEXT,
                ex_div_date TEXT,
                div_pay_date TEXT,
                estim_payment_per_year REAL,
                approx_monthly_income REAL,
                annual_yield_on_cost REAL,
                current_annual_yield REAL,
                current_month_income REAL,
                dividend_paid REAL,
                total_divs_received REAL,
                classification_type TEXT,
                reinvest TEXT
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
                realized_gain REAL,
                created_at TEXT
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
                include_in_owner INTEGER DEFAULT 0,
                positions_managed INTEGER DEFAULT 0
            );
            CREATE TABLE aggregate_config (
                member_profile_id INTEGER PRIMARY KEY
            );
            CREATE TABLE categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                profile_id INTEGER,
                sort_order INTEGER
            );
            CREATE TABLE ticker_categories (
                ticker TEXT,
                category_id INTEGER,
                profile_id INTEGER
            );
            CREATE TABLE dividends (
                ticker TEXT,
                profile_id INTEGER,
                total_divs_received REAL
            );
            CREATE TABLE watchlist_sold (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                buy_price REAL,
                sell_price REAL,
                shares_sold REAL,
                sell_date TEXT,
                divs_received REAL,
                notes TEXT
            );
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            """
        )
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_populate_holdings = app_module.populate_holdings
        self._orig_populate_dividends = app_module.populate_dividends
        self._orig_db_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.populate_holdings = lambda profile_id: None
        app_module.populate_dividends = lambda profile_id: None
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.populate_holdings = self._orig_populate_holdings
        app_module.populate_dividends = self._orig_populate_dividends
        app_module.app._db_initialized = self._orig_db_initialized
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

    def _scalar(self, sql, params=()):
        conn = self._get_connection()
        try:
            row = conn.execute(sql, params).fetchone()
            return row[0] if row else None
        finally:
            conn.close()

    def test_owner_transaction_list_includes_owner_member_accounts_with_source_notes(self):
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (1, 'Owner', 1)")
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Schwab IRA', 1)")
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (3, 'Outside Account', 0)")
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-01', 1, 10, 0, 'owner note')"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('ABC', 2, 'BUY', '2026-01-02', 2, 11, 0, 'member note')"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('ABC', 3, 'BUY', '2026-01-03', 3, 12, 0, 'excluded note')"
        )

        res = self.client.get("/api/holdings/ABC/transactions?profile_id=1")

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual([row["profile_id"] for row in data], [1, 2])
        self.assertEqual(data[0]["notes"], "Account: Owner; owner note")
        self.assertEqual(data[0]["raw_notes"], "owner note")
        self.assertEqual(data[1]["notes"], "Account: Schwab IRA; member note")
        self.assertEqual(data[1]["source_account_name"], "Schwab IRA")

    def test_aggregate_transaction_list_adds_source_account_to_notes(self):
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Schwab IRA', 0)")
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (3, 'Fidelity Taxable', 0)")
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (4, 'Outside Account', 0)")
        self._execute("INSERT INTO aggregate_config (member_profile_id) VALUES (2)")
        self._execute("INSERT INTO aggregate_config (member_profile_id) VALUES (3)")
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('ABC', 2, 'BUY', '2026-01-01', 1, 10, 0, '')"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('ABC', 3, 'BUY', '2026-01-02', 2, 11, 0, 'drip buy')"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('ABC', 4, 'BUY', '2026-01-03', 3, 12, 0, 'excluded note')"
        )

        res = self.client.get("/api/holdings/ABC/transactions?aggregate=true")

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual([row["profile_id"] for row in data], [2, 3])
        self.assertEqual(data[0]["notes"], "Account: Schwab IRA")
        self.assertEqual(data[0]["raw_notes"], "")
        self.assertEqual(data[1]["notes"], "Account: Fidelity Taxable; drip buy")
        self.assertEqual(data[1]["source_account_name"], "Fidelity Taxable")

    def test_accrual_summary_includes_expected_payment_details(self):
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Schwab IRA', 1)")
        self._execute(
            "INSERT INTO settings (key, value) VALUES ('last_refresh_2', '2026-05-19T08:00:00')"
        )
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, div, div_frequency, ex_div_date) "
            "VALUES ('CSHI', 2, 10, 0.25, 'M', '05/13/26')"
        )

        res = self.client.get("/api/holdings/accrual-summary?profile_id=1")

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        account = data["accounts"][0]
        self.assertEqual(account["confirmed_payments"], 1)
        self.assertEqual(account["payment_details"][0]["ticker"], "CSHI")
        self.assertEqual(account["payment_details"][0]["expected_pay_date"], "2026-05-20")
        self.assertEqual(account["payment_details"][0]["amount"], 2.5)

    def test_gains_losses_summary_combines_aggregate_member_broker_positions_and_transactions(self):
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Broker One', 0)")
        self._execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (3, 'Broker Two', 0)")
        self._execute("INSERT INTO aggregate_config (member_profile_id) VALUES (2)")
        self._execute("INSERT INTO aggregate_config (member_profile_id) VALUES (3)")
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, description, quantity, price_paid, purchase_value, current_price, current_value, gain_or_loss, total_divs_received) "
            "VALUES ('ABC', 2, 'ABC Fund', 10, 10, 100, 12, 120, 20, 5)"
        )
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, description, quantity, price_paid, purchase_value, current_price, current_value, gain_or_loss, total_divs_received) "
            "VALUES ('ABC', 3, 'ABC Fund', 5, 14, 70, 18, 90, 20, 7)"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, realized_gain) "
            "VALUES ('ABC', 3, 'SELL', '2026-01-10', 2, 20, 0, 12)"
        )

        res = self.client.get("/api/gains-losses/summary?aggregate=true")

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(len(data["unrealized"]), 1)
        row = data["unrealized"][0]
        self.assertEqual(row["ticker"], "ABC")
        self.assertEqual(row["quantity"], 15)
        self.assertEqual(row["purchase_value"], 170)
        self.assertEqual(row["current_value"], 210)
        self.assertEqual(row["price_gl"], 40)
        self.assertEqual(row["divs_received"], 12)
        self.assertEqual(data["totals"]["unrealized_total_gl"], 52)
        self.assertEqual(data["realized"][0]["price_gl"], 12)

    def test_post_sell_without_holding_is_rejected_without_creating_rows(self):
        res = self.client.post(
            "/api/holdings/ABC/transactions?profile_id=1",
            json={
                "transaction_type": "SELL",
                "transaction_date": "2026-01-10",
                "shares": 1,
                "price_per_share": 20,
            },
        )

        self.assertEqual(res.status_code, 400)
        self.assertIn("no holding exists", res.get_json()["error"])
        self.assertEqual(self._scalar("SELECT COUNT(*) FROM all_account_info"), 0)
        self.assertEqual(self._scalar("SELECT COUNT(*) FROM transactions"), 0)

    def test_post_oversell_existing_holding_is_rejected_without_seed_side_effect(self):
        self._execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, price_paid, purchase_date) "
            "VALUES ('ABC', 1, 5, 10, '2026-01-01')"
        )

        res = self.client.post(
            "/api/holdings/ABC/transactions?profile_id=1",
            json={
                "transaction_type": "SELL",
                "transaction_date": "2026-01-10",
                "shares": 6,
                "price_per_share": 20,
            },
        )

        self.assertEqual(res.status_code, 400)
        self.assertIn("only 5.000000 shares are available", res.get_json()["error"])
        self.assertEqual(self._scalar("SELECT COUNT(*) FROM transactions"), 0)

    def test_put_oversell_is_rejected_and_keeps_existing_sell_unchanged(self):
        self._execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, price_paid, purchase_date) "
            "VALUES ('ABC', 1, 5, 10, '2026-01-01')"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-01', 10, 10, 0)"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'SELL', '2026-01-10', 5, 20, 0)"
        )
        sell_id = self._scalar(
            "SELECT id FROM transactions WHERE ticker = 'ABC' AND transaction_type = 'SELL'"
        )

        res = self.client.put(
            f"/api/holdings/ABC/transactions/{sell_id}?profile_id=1",
            json={"transaction_type": "SELL", "shares": 11},
        )

        self.assertEqual(res.status_code, 400)
        self.assertIn("only 10.000000 shares are available", res.get_json()["error"])
        self.assertEqual(
            self._scalar("SELECT shares FROM transactions WHERE id = ?", (sell_id,)),
            5,
        )

    def test_delete_full_sale_restores_holding_from_remaining_buy_lot(self):
        self._execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, price_paid, purchase_date) "
            "VALUES ('ABC', 1, 10, 10, '2026-01-01')"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-01', 10, 10, 0)"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'SELL', '2026-01-10', 10, 20, 0)"
        )
        conn = self._get_connection()
        try:
            _rollup_transactions("ABC", 1, conn)
        finally:
            conn.close()
        self.assertEqual(self._scalar("SELECT COUNT(*) FROM all_account_info WHERE ticker = 'ABC'"), 0)
        sell_id = self._scalar(
            "SELECT id FROM transactions WHERE ticker = 'ABC' AND transaction_type = 'SELL'"
        )

        res = self.client.delete(f"/api/holdings/ABC/transactions/{sell_id}?profile_id=1")

        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            self._scalar("SELECT quantity FROM all_account_info WHERE ticker = 'ABC' AND profile_id = 1"),
            10,
        )


if __name__ == "__main__":
    unittest.main()
