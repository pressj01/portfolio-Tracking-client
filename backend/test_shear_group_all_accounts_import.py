"""Shear Group All Accounts positions/activity parsing and routing."""

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
    parse_shear_group_all_accounts_activity,
    parse_shear_group_all_accounts_positions,
)


SHEAR_ACCOUNTS = [
    ("1234562472", "PRESSER CYNTHIA", "CINDY2472", "Cindy_2472"),
    ("1234564734", "PRESSER CYNTHIA", "CINDY4734", "Cindy_4734"),
    ("1234567326", "PRESSER CYNTHIA", "CINDY7326", "Cindy_7326"),
    ("1234564950", "PRESSER JAMES", "JAMES4950", "Shear_Jpresser"),
]

POSITION_HEADERS = [
    "Account Number", "Account Name", "Account Nick Name", "Symbol/CUSIP",
    "Description", "Quantity", "Price ($)", "Value ($)", "Unit Cost",
    "Cost Basis ($)", "Unrealized G/L ($)", "Security Type Description",
]

ACTIVITY_HEADERS = [
    "Date", "Activity", "Symbol", "Description", "Quantity", "Unit Price",
    "Value", "Held In", "Account Nickname", "Account Number",
]


def csv_bytes(headers, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


def positions_export():
    rows = []
    for index, (number, name, ticker, _) in enumerate(SHEAR_ACCOUNTS, start=1):
        quantity = index * 10
        price = 20 + index
        cost = 15 + index
        rows.append([
            number, name, "", ticker, f"{ticker} FUND", quantity, price,
            quantity * price, cost, quantity * cost, quantity * (price - cost), "Equity",
        ])
        rows.append([
            number, name, "", "CASH", "CASH", "", "", 100 + index, "", "", "", "Cash",
        ])
    return csv_bytes(POSITION_HEADERS, rows)


def activity_export():
    rows = []
    for index, (number, name, ticker, _) in enumerate(SHEAR_ACCOUNTS, start=1):
        suffix = number[-4:]
        rows.append([
            "2026-08-01", "Cash Dividend", ticker, f"{ticker} FUND", "", "",
            10 + index, "Cash", name, suffix,
        ])
        rows.append([
            "2026-08-02", "Dividend Reinvest", ticker, f"{ticker} FUND", 0.25,
            40 + index, -(10 + index), "Cash", name, suffix,
        ])
    return csv_bytes(ACTIVITY_HEADERS, rows)


class ShearGroupAllAccountsParserTest(unittest.TestCase):
    def _parse(self, filename, content, parser):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / filename
            path.write_bytes(content)
            return parser(str(path), path.name)

    def test_positions_group_by_last_four_without_exposing_full_numbers(self):
        result = self._parse(
            "Positions.csv", positions_export(), parse_shear_group_all_accounts_positions
        )

        self.assertEqual(result["format_type"], "positions_multi")
        self.assertEqual(result["source_format"], "shear_group_all_accounts")
        self.assertEqual(result["summary"]["accounts"], 4)
        self.assertEqual(result["summary"]["holdings"], 4)
        self.assertEqual(result["summary"]["cash"], 410.0)
        self.assertEqual(
            {account["account_number"] for account in result["accounts"]},
            {"2472", "4734", "7326", "4950"},
        )
        self.assertNotIn("123456", json.dumps(result))

    def test_activity_uses_the_same_last_four_account_keys(self):
        result = self._parse(
            "Activity.csv", activity_export(), parse_shear_group_all_accounts_activity
        )

        self.assertEqual(result["format_type"], "transactions_multi")
        self.assertEqual(result["source_format"], "shear_group_all_accounts_activity")
        self.assertEqual(result["summary"]["accounts"], 4)
        self.assertEqual(result["summary"]["transactions"], 8)
        self.assertEqual(result["summary"]["buys"], 4)
        self.assertEqual(result["summary"]["dividends"], 4)


class ShearGroupAllAccountsImportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        profiles = [
            (1, "Owner", "shear_group"),
            (2, "Cindy_2472", "shear_group"),
            (3, "Cindy_4734", "shear_group"),
            (4, "Cindy_7326", "shear_group"),
            (5, "Shear_Jpresser", "shear_group"),
            (6, "Fidelity IRA", "fidelity"),
        ]
        for pid, name, broker in profiles:
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
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _post(self, endpoint, kind="positions", **fields):
        if kind == "activity":
            payload = activity_export()
            filename = "Activity.csv"
            fmt = "shear_group_all_accounts_activity"
        else:
            payload = positions_export()
            filename = "Positions.csv"
            fmt = "shear_group_all_accounts"
        data = {"file": (io.BytesIO(payload), filename), "format": fmt}
        data.update(fields)
        return self.client.post(endpoint, data=data, content_type="multipart/form-data")

    def test_preview_maps_all_four_accounts_including_jpresser(self):
        for kind in ("positions", "activity"):
            with self.subTest(kind=kind):
                response = self._post("/api/import/transactions/preview", kind=kind)
                data = response.get_json()
                self.assertEqual(response.status_code, 200, data)
                self.assertEqual(data["broker_source"], "shear_group")
                self.assertEqual(
                    {
                        account["account_number"]: account["suggested_profile_name"]
                        for account in data["accounts"]
                    },
                    {
                        "2472": "Cindy_2472",
                        "4734": "Cindy_4734",
                        "7326": "Cindy_7326",
                        "4950": "Shear_Jpresser",
                    },
                )
                self.assertNotIn("Fidelity IRA", {choice["name"] for choice in data["profile_choices"]})

    def test_positions_and_activity_follow_the_same_saved_routing(self):
        positions = self._post(
            "/api/import/transactions", nav_date=self.nav_date
        )
        self.assertEqual(positions.status_code, 200, positions.get_json())
        self.assertEqual(positions.get_json()["imported_accounts"], 4)

        activity = self._post(
            "/api/import/transactions", kind="activity", nav_date=self.nav_date
        )
        activity_data = activity.get_json()
        self.assertEqual(activity.status_code, 200, activity_data)
        self.assertEqual(activity_data["imported_accounts"], 4)

        repeated = self._post(
            "/api/import/transactions", kind="activity", nav_date=self.nav_date
        )
        repeated_data = repeated.get_json()
        self.assertEqual(repeated.status_code, 200, repeated_data)
        self.assertEqual(
            sum(detail["duplicates_skipped"] for detail in repeated_data["details"]),
            8,
        )

        conn = self._get_connection()
        try:
            for profile_id in (2, 3, 4, 5):
                holdings = conn.execute(
                    "SELECT COUNT(*) FROM all_account_info WHERE profile_id = ?",
                    (profile_id,),
                ).fetchone()[0]
                buys = conn.execute(
                    "SELECT COUNT(*) FROM transactions WHERE profile_id = ? AND transaction_type = 'BUY'",
                    (profile_id,),
                ).fetchone()[0]
                dividends = conn.execute(
                    "SELECT COUNT(*) FROM dividend_payments WHERE profile_id = ?",
                    (profile_id,),
                ).fetchone()[0]
                self.assertEqual((holdings, buys, dividends), (1, 1, 1))
            saved = conn.execute(
                "SELECT value FROM settings WHERE key = 'shear_group_account_profile_map'"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(json.loads(saved), {
            "num:2472": 2,
            "num:4734": 3,
            "num:7326": 4,
            "num:4950": 5,
        })

    def test_near_date_refresh_estimates_yield_to_actual_activity(self):
        positions = self._post(
            "/api/import/transactions", nav_date=self.nav_date
        )
        self.assertEqual(positions.status_code, 200, positions.get_json())

        conn = self._get_connection()
        try:
            conn.executemany(
                "INSERT INTO dividend_payments "
                "(ticker, profile_id, payment_date, amount, source, notes) "
                "VALUES (?, ?, '2026-07-31', ?, 'refresh_estimate', 'projected')",
                [
                    (ticker, index + 1, 10 + index)
                    for index, (_, _, ticker, _) in enumerate(SHEAR_ACCOUNTS, start=1)
                ],
            )
            conn.commit()
        finally:
            conn.close()

        activity = self._post(
            "/api/import/transactions", kind="activity", nav_date=self.nav_date
        )
        self.assertEqual(activity.status_code, 200, activity.get_json())

        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT ticker, profile_id, payment_date, amount, source "
                "FROM dividend_payments ORDER BY profile_id"
            ).fetchall()
        finally:
            conn.close()

        self.assertEqual(len(rows), 4)
        self.assertEqual({row["payment_date"] for row in rows}, {"2026-08-01"})
        self.assertEqual(
            {row["source"] for row in rows},
            {"shear_group_all_accounts_activity"},
        )
        self.assertEqual(
            [(row["profile_id"], row["ticker"], row["amount"]) for row in rows],
            [
                (2, "CINDY2472", 11.0),
                (3, "CINDY4734", 12.0),
                (4, "CINDY7326", 13.0),
                (5, "JAMES4950", 14.0),
            ],
        )

    def test_rejects_a_non_shear_destination(self):
        preview = self._post("/api/import/transactions/preview").get_json()
        key = preview["accounts"][0]["account_key"]
        response = self._post(
            "/api/import/transactions",
            nav_date=self.nav_date,
            account_map=json.dumps({key: "6"}),
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Shear Group", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
