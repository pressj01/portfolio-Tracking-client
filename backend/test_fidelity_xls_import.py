"""Fidelity files saved as Excel 97-2003 (.xls), and Fidelity Trader+ positions.

openpyxl reads only .xlsx/.xlsm, so a Fidelity download re-saved from Excel as
.xls failed with every Fidelity format before a single row was read. The
fixtures in test_fixtures/ are made-up data in the layouts of real files; see
test_fixtures/make_fidelity_xls_fixtures.py.
"""

import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import config
import database
from transaction_import import (
    parse_fidelity_all_accounts_positions,
    parse_fidelity_positions_xlsx,
    parse_fidelity_transactions_xlsx,
)

FIXTURES = Path(__file__).resolve().parent / "test_fixtures"
TRADER_PLUS_HEADER = (
    "Symbol,Bid,Ask,Volume,$ Avg Cost,Notes,$ Day G/L,% Day G/L,$ Total G/L,% Total G/L,"
    "Value,% of Acct,Basis,Day Range,52W Range,Earnings Date,Div Amt,Div Ex-Date,"
    "Description,Quantity,Last,Div Pay Date"
)


def fixture(name):
    return str(FIXTURES / name), name


class FidelityXlsParserTest(unittest.TestCase):
    def test_accounts_history_xls_reads_dates_and_whole_account_numbers(self):
        result = parse_fidelity_transactions_xlsx(*fixture("fidelity_accounts_history.xls"))

        self.assertEqual(
            [
                (txn["type"], txn["ticker"], txn["date"], txn["_account_number"])
                for txn in result["transactions"]
            ],
            [
                ("DIVIDEND", "TDAX", "2026-10-15", "222222222"),
                # Run Date, not the Settlement Date a day later.
                ("BUY", "ARCC", "2026-10-01", "222222222"),
            ],
        )
        dividend, buy = result["transactions"]
        self.assertEqual(dividend["dividend_amount"], 92.89)
        self.assertEqual(dividend["_account_label"], "Rollover IRA ...2222")
        self.assertEqual((buy["shares"], buy["price_per_share"]), (100, 20.11))
        self.assertEqual(
            [(row["amount"], row["_account_name"]) for row in result["account_activity"]],
            [(-257.38, "Health Savings Account")],
        )

    def test_website_positions_xls_with_lowercase_headers(self):
        result = parse_fidelity_positions_xlsx(*fixture("fidelity_portfolio_positions.xls"))

        self.assertEqual(result["account_name"], "Rollover IRA")
        self.assertEqual(result["summary"]["cash"], 5000.25)
        self.assertEqual(result["summary"]["account_value"], 6892.25)
        self.assertNotIn("cash_reported", result["summary"])
        [arcc] = result["positions"]
        self.assertEqual(arcc["ticker"], "ARCC")
        self.assertEqual(arcc["quantity"], 100)
        self.assertEqual(arcc["purchase_value"], 2011.0)
        self.assertEqual(arcc["gain_or_loss"], -119.0)

    def test_trader_plus_positions_xls(self):
        result = parse_fidelity_positions_xlsx(*fixture("fidelity_trader_plus_positions.xls"))

        positions = {position["ticker"]: position for position in result["positions"]}
        self.assertEqual(set(positions), {"IDVO", "ARCC"})
        idvo = positions["IDVO"]
        self.assertEqual(idvo["description"], "AMPLIFY ETF TR CWP INTL ENHANCE")
        self.assertEqual(idvo["quantity"], 100)
        self.assertEqual(idvo["cost_per_share"], 42.69)
        self.assertEqual(idvo["current_price"], 41.04)
        self.assertEqual(idvo["purchase_value"], 4269.0)
        self.assertEqual(idvo["current_value"], 4104.0)
        self.assertEqual(idvo["gain_or_loss"], -165.0)
        self.assertEqual(idvo["div"], 0.2124)
        self.assertEqual(idvo["ex_div_date"], "2026-09-29")
        self.assertEqual(idvo["div_pay_date"], "2026-09-30")
        self.assertEqual(result["account_name"], "")
        # Trader+ lists securities only; the import must not read that as $0 cash.
        self.assertNotIn("cash", result["summary"])
        self.assertIs(result["summary"]["cash_reported"], False)
        self.assertEqual(result["summary"]["account_value"], 5996.0)

    def test_trader_plus_positions_csv(self):
        content = "\n".join([
            TRADER_PLUS_HEADER,
            "ARCC,18.9,18.94,4061572,20.11,--,33,1.77,-119,-5.92,1892,31.55,2011,"
            "18.63-19.02,17.40-21.14,Oct-27-2026,0.48,Sep-15-2026,ARES CAPITAL CORP COM,100,18.92,Sep-30-2026",
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Positions.csv"
            path.write_text(content, encoding="utf-8")
            result = parse_fidelity_positions_xlsx(str(path), path.name)

        [arcc] = result["positions"]
        self.assertEqual(
            (arcc["quantity"], arcc["cost_per_share"], arcc["purchase_value"], arcc["div"]),
            (100, 20.11, 2011.0, 0.48),
        )
        self.assertNotIn("cash", result["summary"])

    def test_all_accounts_format_reads_xls(self):
        result = parse_fidelity_all_accounts_positions(*fixture("fidelity_portfolio_positions.xls"))

        [account] = result["accounts"]
        self.assertEqual(account["account_label"], "Rollover IRA")
        self.assertEqual(result["summary"]["cash"], 5000.25)


class FidelityPositionsCashImportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        for pid, name in [(1, "Owner"), (2, "Fidelity Rollover IRA")]:
            conn.execute(
                "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order, cash_value) "
                "VALUES (?, ?, 'fidelity', 1, ?, 750.0)",
                (pid, name, pid),
            )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_db_path = config.DB_PATH
        config.DB_PATH = self.db_path
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()
        self.nav_date = app_module.datetime.date.today().isoformat()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        config.DB_PATH = self._orig_db_path
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _import(self, name):
        data = {
            "file": (io.BytesIO((FIXTURES / name).read_bytes()), name),
            "format": "fidelity",
            "nav_date": self.nav_date,
        }
        response = self.client.post(
            "/api/import/transactions?profile_id=2",
            data=data,
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200, response.get_json())

    def _saved(self):
        conn = self._get_connection()
        try:
            cash = conn.execute("SELECT cash_value FROM profiles WHERE id = 2").fetchone()[0]
            rows = conn.execute(
                "SELECT ticker, quantity FROM all_account_info WHERE profile_id = 2"
            ).fetchall()
        finally:
            conn.close()
        return cash, {row["ticker"]: row["quantity"] for row in rows}

    def test_trader_plus_import_keeps_the_cash_balance(self):
        self._import("fidelity_trader_plus_positions.xls")

        cash, holdings = self._saved()
        self.assertEqual(holdings, {"IDVO": 100, "ARCC": 100})
        self.assertEqual(cash, 750.0)

    def test_website_positions_import_still_sets_cash(self):
        self._import("fidelity_portfolio_positions.xls")

        cash, holdings = self._saved()
        self.assertEqual(holdings, {"ARCC": 100})
        self.assertEqual(cash, 5000.25)


if __name__ == "__main__":
    unittest.main()
