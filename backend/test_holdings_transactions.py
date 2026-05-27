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

    def test_original_basis_refresh_updates_only_when_transaction_shares_match(self):
        app_module._ensure_basis_columns(self.conn)
        self.conn.execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, purchase_value, original_price_paid, "
            "original_purchase_value, broker_price_paid, broker_purchase_value, current_value) "
            "VALUES ('ABC', 1, 8, 20, 160, 20, 160, 20, 160, 200)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-01', 10, 10, 0)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'SELL', '2026-01-10', 2, 15, 0)"
        )

        result = app_module._refresh_original_basis_from_transactions("ABC", 1, self.conn)

        self.assertEqual(result["status"], "updated")
        row = self.conn.execute(
            "SELECT quantity, price_paid, purchase_value, original_price_paid, "
            "original_purchase_value, broker_price_paid, broker_purchase_value, realized_gains "
            "FROM all_account_info WHERE ticker = 'ABC'"
        ).fetchone()
        self.assertEqual(row["quantity"], 8)
        self.assertEqual(row["price_paid"], 20)
        self.assertEqual(row["purchase_value"], 160)
        self.assertEqual(row["broker_price_paid"], 20)
        self.assertEqual(row["broker_purchase_value"], 160)
        self.assertEqual(row["original_price_paid"], 10)
        self.assertEqual(row["original_purchase_value"], 80)
        self.assertEqual(row["realized_gains"], 10)

    def test_original_basis_refresh_skips_when_transaction_shares_do_not_match(self):
        app_module._ensure_basis_columns(self.conn)
        self.conn.execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, purchase_value, original_price_paid, "
            "original_purchase_value, broker_price_paid, broker_purchase_value) "
            "VALUES ('ABC', 1, 8, 20, 160, 20, 160, 20, 160)"
        )
        self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-01', 10, 10, 0)"
        )

        result = app_module._refresh_original_basis_from_transactions("ABC", 1, self.conn)

        self.assertEqual(result["status"], "share_mismatch")
        row = self.conn.execute(
            "SELECT original_price_paid, original_purchase_value, broker_price_paid, broker_purchase_value "
            "FROM all_account_info WHERE ticker = 'ABC'"
        ).fetchone()
        self.assertEqual(row["original_price_paid"], 20)
        self.assertEqual(row["original_purchase_value"], 160)
        self.assertEqual(row["broker_price_paid"], 20)
        self.assertEqual(row["broker_purchase_value"], 160)

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
                ytd_divs REAL,
                paid_for_itself REAL,
                dividend_actuals_source TEXT,
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
            CREATE TABLE dividend_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                profile_id INTEGER,
                payment_date TEXT,
                amount REAL,
                source TEXT,
                notes TEXT,
                created_at TEXT,
                UNIQUE (ticker, profile_id, payment_date)
            );
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY,
                name TEXT,
                broker_source TEXT,
                include_in_owner INTEGER DEFAULT 0,
                positions_managed INTEGER DEFAULT 0
            );
            CREATE TABLE aggregates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            );
            CREATE TABLE aggregate_config (
                aggregate_id INTEGER NOT NULL,
                member_profile_id INTEGER NOT NULL,
                UNIQUE (aggregate_id, member_profile_id)
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

    def test_snowball_transactions_layer_on_broker_and_generic_positions(self):
        sources = ["schwab", "etrade", "fidelity", "shear_group", "generic", "other"]
        conn = self._get_connection()
        try:
            for idx, source in enumerate(sources, start=20):
                conn.execute(
                    "INSERT INTO profiles (id, name, broker_source, include_in_owner, positions_managed) "
                    "VALUES (?, ?, ?, 0, 0)",
                    (idx, f"{source} portfolio", source),
                )
                conn.execute(
                    "INSERT INTO all_account_info (ticker, profile_id, quantity, price_paid, purchase_value) "
                    "VALUES ('ABC', ?, 10, 20, 200)",
                    (idx,),
                )
            conn.commit()

            for idx, source in enumerate(sources, start=20):
                self.assertTrue(
                    app_module._should_preserve_positions_for_transaction_import(idx, "snowball", conn),
                    source,
                )
        finally:
            conn.close()

    def test_shear_group_positions_filter_to_selected_account(self):
        self._execute(
            "INSERT INTO profiles (id, name, broker_source, include_in_owner) "
            "VALUES (23, 'Shear_Jpresser', 'shear_group', 0)"
        )
        parsed = {
            "positions": [],
            "format_type": "positions",
            "source_format": "shear_group",
            "summary": {"holdings": 2, "cash": 15, "account_count": 2, "account_value": 315},
            "_cash_by_account": {
                "PRESSER JAMES, 45514950": 10,
                "PRESSER CYNTHIA, 27287326": 5,
            },
            "_raw_positions": [
                {
                    "ticker": "AAA",
                    "description": "AAA Inc",
                    "quantity": 2,
                    "cost_per_share": 40,
                    "current_price": 50,
                    "purchase_value": 80,
                    "current_value": 100,
                    "gain_or_loss": 20,
                    "_account_label": "PRESSER JAMES, 45514950",
                    "_account_name": "PRESSER JAMES",
                    "_account_number": "45514950",
                },
                {
                    "ticker": "BBB",
                    "description": "BBB Inc",
                    "quantity": 4,
                    "cost_per_share": 45,
                    "current_price": 50,
                    "purchase_value": 180,
                    "current_value": 200,
                    "gain_or_loss": 20,
                    "_account_label": "PRESSER CYNTHIA, 27287326",
                    "_account_name": "PRESSER CYNTHIA",
                    "_account_number": "27287326",
                },
            ],
        }

        filtered = app_module._filter_shear_group_result_for_profile(parsed, 23)

        self.assertEqual([pos["ticker"] for pos in filtered["positions"]], ["AAA"])
        self.assertEqual(filtered["summary"]["cash"], 10)
        self.assertEqual(filtered["summary"]["account_count"], 1)
        self.assertEqual(filtered["summary"]["account_value"], 110)
        self.assertEqual(
            filtered["account_match"]["matched_accounts"],
            ["PRESSER JAMES, 45514950"],
        )
        self.assertNotIn("_account_name", filtered["positions"][0])

    def test_position_managed_nav_history_trims_partial_transaction_backfill(self):
        self._execute(
            "INSERT INTO profiles (id, name, broker_source, include_in_owner, positions_managed) "
            "VALUES (23, 'Shear_Jpresser', 'shear_group', 0, 1)"
        )
        rows = [
            {"nav_date": "2026-05-21", "total_value": 78282.99},
            {"nav_date": "2026-05-22", "total_value": 78457.52},
            {"nav_date": "2026-05-26", "total_value": 493397.52},
        ]
        conn = self._get_connection()
        try:
            trimmed = app_module._trim_incompatible_position_nav_history(rows, 23, conn)
        finally:
            conn.close()

        self.assertEqual(trimmed, rows[-1:])

    def test_position_managed_nav_history_keeps_stable_daily_snapshots(self):
        self._execute(
            "INSERT INTO profiles (id, name, broker_source, include_in_owner, positions_managed) "
            "VALUES (6, 'Pressj04', 'schwab', 1, 1)"
        )
        rows = [
            {"nav_date": "2026-05-19", "total_value": 185483.93},
            {"nav_date": "2026-05-20", "total_value": 186784.15},
            {"nav_date": "2026-05-21", "total_value": 188092.28},
            {"nav_date": "2026-05-26", "total_value": 190297.55},
        ]
        conn = self._get_connection()
        try:
            trimmed = app_module._trim_incompatible_position_nav_history(rows, 6, conn)
        finally:
            conn.close()

        self.assertEqual(trimmed, rows)

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
        self._execute("INSERT INTO aggregates (id, name) VALUES (1, 'Combined')")
        self._execute("INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (1, 2)")
        self._execute("INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (1, 3)")
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

        res = self.client.get("/api/holdings/ABC/transactions?aggregate_id=1")

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
        self._execute("INSERT INTO aggregates (id, name) VALUES (1, 'Combined')")
        self._execute("INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (1, 2)")
        self._execute("INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (1, 3)")
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

        res = self.client.get("/api/gains-losses/summary?aggregate_id=1")

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

    def test_single_sheet_portfolio_export_imports_into_selected_profile(self):
        import pandas as pd

        self._execute(
            "INSERT INTO profiles (id, name, include_in_owner) VALUES (20, 'Snowball_Studwell', 0)"
        )
        workbook = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        workbook.close()
        workbook_path = Path(workbook.name)
        try:
            with pd.ExcelWriter(workbook_path, engine="openpyxl") as writer:
                pd.DataFrame([{
                    "Ticker": "ABC",
                    "Shares": 3,
                    "Price Paid": 10,
                    "Current Price": 12,
                    "Purchase Value": 30,
                    "Current Value": 36,
                }]).to_excel(writer, sheet_name="Trust", index=False)
                pd.DataFrame([{
                    "Transaction ID": 1,
                    "Profile": "Trust",
                    "Ticker": "ABC",
                    "Type": "BUY",
                    "Date": "2026-01-02",
                    "Shares": 3,
                    "Price/Share": 10,
                    "Fees": 0,
                    "Realized Gain": None,
                    "Notes": "exported transaction",
                    "Created At": "2026-01-02",
                }, {
                    "Transaction ID": "DIV-1",
                    "Profile": "Trust",
                    "Ticker": "ABC",
                    "Type": "DIVIDEND",
                    "Date": "2026-02-15",
                    "Shares": None,
                    "Price/Share": None,
                    "Fees": None,
                    "Realized Gain": None,
                    "Dividend Amount": 4.25,
                    "Notes": "exported dividend",
                    "Created At": "2026-02-15",
                }]).to_excel(writer, sheet_name="Transactions", index=False)

            parsed = app_module._parse_portfolio_export_workbook(str(workbook_path), workbook_path.name)
            self.assertEqual(parsed["summary"]["dividends"], 1)

            imported_profiles = []
            orig_import_from_upload = app_module.import_from_upload
            orig_populate_income_tracking = app_module.populate_income_tracking
            orig_snapshot_nav = app_module._snapshot_nav_after_profile_update
            orig_auto_reconcile_owner = app_module._auto_reconcile_owner
            try:
                def fake_import_from_upload(df, profile_id):
                    imported_profiles.append(profile_id)
                    return len(df), f"Imported {len(df)} holdings for profile {profile_id}."

                app_module.import_from_upload = fake_import_from_upload
                app_module.populate_income_tracking = lambda profile_id: None
                app_module._snapshot_nav_after_profile_update = lambda profile_id, nav_date=None: None
                app_module._auto_reconcile_owner = lambda: None

                with app_module.app.app_context():
                    res = app_module._import_portfolio_export_workbook(parsed, str(workbook_path), 20)
                    data = res.get_json()
            finally:
                app_module.import_from_upload = orig_import_from_upload
                app_module.populate_income_tracking = orig_populate_income_tracking
                app_module._snapshot_nav_after_profile_update = orig_snapshot_nav
                app_module._auto_reconcile_owner = orig_auto_reconcile_owner

            self.assertEqual(imported_profiles, [20])
            self.assertEqual(data["details"][0]["profile_id"], 20)
            self.assertEqual(data["details"][0]["profile_name"], "Snowball_Studwell")
            self.assertEqual(data["details"][0]["source_sheet"], "Trust")
            self.assertEqual(
                self._scalar("SELECT profile_id FROM transactions WHERE ticker = 'ABC'"),
                20,
            )
            self.assertEqual(
                self._scalar("SELECT COUNT(*) FROM dividend_payments WHERE ticker = 'ABC' AND profile_id = 20"),
                1,
            )
            self.assertEqual(
                self._scalar("SELECT amount FROM dividend_payments WHERE ticker = 'ABC' AND profile_id = 20"),
                4.25,
            )
            self.assertEqual(self._scalar("SELECT COUNT(*) FROM profiles WHERE name = 'Trust'"), 0)
        finally:
            workbook_path.unlink(missing_ok=True)

    def test_snowball_parser_accepts_minute_precision_dates(self):
        csv_file = tempfile.NamedTemporaryFile(suffix=".csv", mode="w", newline="", delete=False)
        csv_path = Path(csv_file.name)
        try:
            csv_file.write("Event,Date,Symbol,Price,Quantity,Currency,FeeTax,Exchange,FeeCurrency,DoNotAdjustCash,Note\n")
            csv_file.write("BUY,3/23/2021 0:00,VMBS,53.3887,2247,USD,0,NASDAQ,,FALSE,Buy\n")
            csv_file.write("DIVIDEND,4/9/2021 0:00,VMBS,0,95.72,USD,0,NASDAQ,,FALSE,DIVPLUG\n")
            csv_file.close()

            parsed = app_module.TXN_PARSERS["snowball"](str(csv_path), csv_path.name)

            self.assertEqual(parsed["summary"]["buys"], 1)
            self.assertEqual(parsed["summary"]["dividends"], 1)
            self.assertEqual(parsed["transactions"][0]["date"], "2021-03-23")
            self.assertEqual(parsed["transactions"][1]["date"], "2021-04-09")
        finally:
            csv_file.close()
            csv_path.unlink(missing_ok=True)

    def test_combined_export_includes_closed_ticker_transactions_and_dividends(self):
        self._execute(
            "INSERT INTO profiles (id, name, include_in_owner) VALUES (20, 'Trust', 0)"
        )
        self._execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, purchase_value, current_value) "
            "VALUES ('ABC', 20, 5, 10, 50, 60)"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('XYZ', 20, 'BUY', '2021-03-23', 10, 11, 0, 'closed position buy')"
        )
        self._execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('XYZ', 20, 'SELL', '2022-03-23', 10, 12, 0, 'closed position sell')"
        )
        self._execute(
            "INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source, notes) "
            "VALUES ('XYZ', 20, '2021-04-09', 3.21, 'snowball', 'closed position dividend')"
        )

        conn = self._get_connection()
        try:
            rows = app_module._read_transaction_export_rows(conn, False, [20])
        finally:
            conn.close()

        xyz_rows = [r for r in rows if r["Ticker"] == "XYZ"]
        self.assertEqual([r["Type"] for r in xyz_rows], ["BUY", "DIVIDEND", "SELL"])
        self.assertEqual(xyz_rows[0]["Date"], "2021-03-23")
        self.assertEqual(xyz_rows[1]["Dividend Amount"], 3.21)

    def test_portfolio_export_backfills_original_basis_from_transactions(self):
        import pandas as pd

        self._execute(
            "INSERT INTO profiles (id, name, include_in_owner) VALUES (20, 'Snowball_Studwell', 0)"
        )
        workbook = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        workbook.close()
        workbook_path = Path(workbook.name)
        try:
            with pd.ExcelWriter(workbook_path, engine="openpyxl") as writer:
                pd.DataFrame([{
                    "Ticker": "ABC",
                    "Shares": 8,
                    "Price Paid": 20,
                    "Current Price": 25,
                    "Purchase Value": 160,
                    "Current Value": 200,
                }]).to_excel(writer, sheet_name="Trust", index=False)
                pd.DataFrame([
                    {
                        "Transaction ID": 1,
                        "Profile": "Trust",
                        "Ticker": "ABC",
                        "Type": "BUY",
                        "Date": "2026-01-01",
                        "Shares": 10,
                        "Price/Share": 10,
                        "Fees": 0,
                        "Realized Gain": None,
                        "Notes": "",
                        "Created At": "2026-01-01",
                    },
                    {
                        "Transaction ID": 2,
                        "Profile": "Trust",
                        "Ticker": "ABC",
                        "Type": "SELL",
                        "Date": "2026-01-10",
                        "Shares": 2,
                        "Price/Share": 15,
                        "Fees": 0,
                        "Realized Gain": None,
                        "Notes": "",
                        "Created At": "2026-01-10",
                    },
                ]).to_excel(writer, sheet_name="Transactions", index=False)

            parsed = app_module._parse_portfolio_export_workbook(str(workbook_path), workbook_path.name)

            orig_import_from_upload = app_module.import_from_upload
            orig_populate_holdings = app_module.populate_holdings
            orig_populate_dividends = app_module.populate_dividends
            orig_populate_income_tracking = app_module.populate_income_tracking
            orig_snapshot_nav = app_module._snapshot_nav_after_profile_update
            orig_auto_reconcile_owner = app_module._auto_reconcile_owner
            try:
                def fake_import_from_upload(df, profile_id):
                    conn = self._get_connection()
                    try:
                        app_module._ensure_basis_columns(conn)
                        conn.execute(
                            "INSERT INTO all_account_info "
                            "(ticker, profile_id, quantity, price_paid, purchase_value, "
                            "original_price_paid, original_purchase_value, broker_price_paid, "
                            "broker_purchase_value, current_value) "
                            "VALUES ('ABC', ?, 8, 20, 160, 20, 160, 20, 160, 200)",
                            (profile_id,),
                        )
                        conn.commit()
                    finally:
                        conn.close()
                    return len(df), f"Imported {len(df)} holdings for profile {profile_id}."

                app_module.import_from_upload = fake_import_from_upload
                app_module.populate_holdings = lambda profile_id: None
                app_module.populate_dividends = lambda profile_id: None
                app_module.populate_income_tracking = lambda profile_id: None
                app_module._snapshot_nav_after_profile_update = lambda profile_id, nav_date=None: None
                app_module._auto_reconcile_owner = lambda: None

                with app_module.app.app_context():
                    res = app_module._import_portfolio_export_workbook(parsed, str(workbook_path), 20)
                    data = res.get_json()
            finally:
                app_module.import_from_upload = orig_import_from_upload
                app_module.populate_holdings = orig_populate_holdings
                app_module.populate_dividends = orig_populate_dividends
                app_module.populate_income_tracking = orig_populate_income_tracking
                app_module._snapshot_nav_after_profile_update = orig_snapshot_nav
                app_module._auto_reconcile_owner = orig_auto_reconcile_owner

            self.assertEqual(data["original_basis_updated"], 1)
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT price_paid, purchase_value, original_price_paid, original_purchase_value, "
                    "broker_price_paid, broker_purchase_value, realized_gains "
                    "FROM all_account_info WHERE ticker = 'ABC' AND profile_id = 20"
                ).fetchone()
            finally:
                conn.close()
            self.assertEqual(row["price_paid"], 20)
            self.assertEqual(row["purchase_value"], 160)
            self.assertEqual(row["broker_price_paid"], 20)
            self.assertEqual(row["broker_purchase_value"], 160)
            self.assertEqual(row["original_price_paid"], 10)
            self.assertEqual(row["original_purchase_value"], 80)
            self.assertEqual(row["realized_gains"], 10)
        finally:
            workbook_path.unlink(missing_ok=True)

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
