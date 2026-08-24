"""Fidelity All Accounts positions parsing and routing."""

import csv
import io
import json
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
)


HEADERS = [
    "Account number", "Account name", "Symbol", "Description", "Last Price",
    "Current value", "Cost basis total", "Average cost basis", "Total gain/loss $",
    "Quantity", "Type", "Dist. rate", "Est. annual income",
]


def position_row(number, name, ticker, quantity, cost_per_share, price, dist_rate="5.00%"):
    current_value = round(quantity * price, 2)
    cost_basis = round(quantity * cost_per_share, 2)
    return [
        number, name, ticker, f"{ticker} FUND", price, current_value, cost_basis,
        cost_per_share, round(current_value - cost_basis, 2), quantity, "ETF",
        dist_rate, round(current_value * 0.05, 2),
    ]


def cash_row(number, name, amount):
    return [
        number, name, "SPAXX**", "HELD IN MONEY MARKET", "", amount, "", "", "",
        "", "Cash", "3.32%", "",
    ]


def build_export(accounts, download_date="Aug-18-2026"):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(HEADERS)
    for rows in accounts:
        writer.writerows(rows)
    writer.writerow([])
    writer.writerow(["The data and information in this spreadsheet is provided for informational purposes only."])
    writer.writerow([f"Date downloaded {download_date} 3:44 p.m ET"])
    return stream.getvalue()


class FidelityAllAccountsParserTest(unittest.TestCase):
    def parse(self, content):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Portfolio_Positions.csv"
            path.write_text(content, encoding="utf-8")
            return parse_fidelity_all_accounts_positions(str(path), path.name)

    def test_groups_holdings_and_cash_by_the_account_columns(self):
        result = self.parse(build_export([
            [
                position_row("Z111", "Roth IRA - BDA", "SPYI", 10, 50, 54, "7.28%"),
                cash_row("Z111", "Roth IRA - BDA", 75.22),
            ],
            [position_row("Z222", "Traditional IRA", "QQQI", 20, 44, 55)],
        ]))

        self.assertEqual(result["format_type"], "positions_multi")
        self.assertEqual(result["source_format"], "fidelity_all_accounts")
        self.assertEqual(result["as_of"], "2026-08-18")
        self.assertEqual(result["summary"]["accounts"], 2)
        self.assertEqual(result["summary"]["holdings"], 2)
        self.assertEqual(result["summary"]["cash"], 75.22)
        self.assertEqual(result["accounts"][0]["summary"]["cash"], 75.22)
        self.assertEqual(result["accounts"][1]["summary"]["cash"], 0.0)
        self.assertEqual(result["accounts"][0]["positions"][0]["dividend_yield"], 7.28)

    def test_single_account_format_redirects_a_combined_file(self):
        content = build_export([
            [position_row("Z111", "Roth IRA", "SPYI", 10, 50, 54)],
            [position_row("Z222", "Traditional IRA", "QQQI", 20, 44, 55)],
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Portfolio_Positions.csv"
            path.write_text(content, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, r"Fidelity \(All Accounts Positions\)"):
                parse_fidelity_positions_xlsx(str(path), path.name)

    def test_redacted_placeholder_numbers_do_not_merge_named_accounts(self):
        result = self.parse(build_export([
            [position_row("xxxxxxxx", "Roth IRA - BDA", "SPYI", 10, 50, 54)],
            [position_row("xxxxxxxx", "Traditional IRA", "QQQI", 20, 44, 55)],
        ]))

        self.assertEqual(result["summary"]["accounts"], 2)
        self.assertEqual(
            [account["account_name"] for account in result["accounts"]],
            ["Roth IRA - BDA", "Traditional IRA"],
        )


class FidelityAllAccountsImportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        for pid, name, broker in [
            (1, "Owner", "fidelity"),
            (2, "Fidelity Roth IRA", "fidelity"),
            (3, "Fidelity IRA", "fidelity"),
            (4, "Individual Schwab", "schwab"),
        ]:
            conn.execute(
                "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order) "
                "VALUES (?, ?, ?, 1, ?)",
                (pid, name, broker, pid),
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

    def _export(self):
        return build_export([
            [
                position_row("Z111", "Roth IRA - BDA", "SPYI", 10, 50, 54),
                cash_row("Z111", "Roth IRA - BDA", 75.22),
            ],
            [position_row("Z222", "Traditional IRA", "QQQI", 20, 44, 55)],
        ]).encode("utf-8")

    def _post(self, endpoint, **fields):
        data = {
            "file": (io.BytesIO(self._export()), "Portfolio_Positions.csv"),
            "format": "fidelity_all_accounts",
        }
        data.update(fields)
        return self.client.post(endpoint, data=data, content_type="multipart/form-data")

    def _holdings(self, profile_id):
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT ticker, quantity FROM all_account_info WHERE profile_id = ?",
                (profile_id,),
            ).fetchall()
            return {row["ticker"]: row["quantity"] for row in rows}
        finally:
            conn.close()

    def test_preview_matches_only_fidelity_destinations(self):
        response = self._post("/api/import/transactions/preview")
        data = response.get_json()

        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(data["broker_source"], "fidelity")
        self.assertEqual(
            {account["account_name"]: account["suggested_profile_name"] for account in data["accounts"]},
            {
                "Roth IRA - BDA": "Fidelity Roth IRA",
                "Traditional IRA": "Fidelity IRA",
            },
        )
        self.assertEqual(
            {choice["name"] for choice in data["profile_choices"]},
            {"Fidelity Roth IRA", "Fidelity IRA"},
        )

    def test_imports_each_fidelity_account_through_the_shared_workflow(self):
        response = self._post("/api/import/transactions", nav_date=self.nav_date)
        data = response.get_json()

        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(data["imported_accounts"], 2)
        self.assertEqual(self._holdings(2), {"SPYI": 10})
        self.assertEqual(self._holdings(3), {"QQQI": 20})
        conn = self._get_connection()
        try:
            cash = conn.execute("SELECT cash_value FROM profiles WHERE id = 2").fetchone()[0]
            saved = conn.execute(
                "SELECT value FROM settings WHERE key = 'fidelity_account_profile_map'"
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(cash, 75.22)
        self.assertIsNotNone(saved)

    def test_rejects_a_schwab_destination(self):
        preview = self._post("/api/import/transactions/preview").get_json()
        account_key = preview["accounts"][0]["account_key"]
        response = self._post(
            "/api/import/transactions",
            nav_date=self.nav_date,
            account_map=json.dumps({account_key: "4"}),
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Fidelity", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
