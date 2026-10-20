"""A positions import that keeps an existing share count says so, and can be overruled.

_large_unsold_position_drop_guard keeps the old quantity when a file's count
falls sharply and no SELL explains it. The response names each holding it
kept, and re-sending the same file with `accept_broker_quantity` takes the
file's count for those holdings only.
"""

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
from test_fidelity_all_accounts_import import build_export, position_row


class PositionsPreservedQuantityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        for pid, name in [
            (1, "Owner"),
            (2, "Fidelity Roth IRA"),
            (3, "Fidelity IRA"),
        ]:
            conn.execute(
                "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order) "
                "VALUES (?, ?, 'fidelity', 1, ?)",
                (pid, name, pid),
            )
        # A holding the ledger says is 100 shares, with no SELL to explain a drop.
        conn.execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, price_paid, purchase_value, current_price, "
            "current_value, broker_price_paid, broker_purchase_value, import_date) "
            "VALUES ('SPYI', 2, 100, 50, 5000, 54, 5400, 50, 5000, '2026-01-02')"
        )
        conn.execute(
            "INSERT INTO transactions "
            "(ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
            "VALUES ('SPYI', 2, 'BUY', '2026-01-01', 100, 50, 0, '')"
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

    def _query(self, sql, params=()):
        conn = self._get_connection()
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    def _quantity(self, profile_id, ticker="SPYI"):
        rows = self._query(
            "SELECT quantity FROM all_account_info WHERE profile_id = ? AND ticker = ?",
            (profile_id, ticker),
        )
        return rows[0]["quantity"] if rows else None

    def _transaction_count(self):
        return self._query("SELECT COUNT(*) AS n FROM transactions")[0]["n"]

    def _post(self, content, fmt, profile_id=None, endpoint="/api/import/transactions", **fields):
        data = {
            "file": (io.BytesIO(content.encode("utf-8")), "Portfolio_Positions.csv"),
            "format": fmt,
            "nav_date": self.nav_date,
        }
        data.update(fields)
        url = endpoint
        if profile_id is not None:
            url += f"?profile_id={profile_id}"
        return self.client.post(url, data=data, content_type="multipart/form-data")

    def _single_export(self):
        return build_export([[position_row("Z111", "Roth IRA - BDA", "SPYI", 10, 50, 54)]])

    def _multi_export(self):
        return build_export([
            [position_row("Z111", "Roth IRA - BDA", "SPYI", 10, 50, 54)],
            [position_row("Z222", "Traditional IRA", "QQQI", 20, 44, 55)],
        ])

    def test_single_account_import_lists_the_kept_count(self):
        response = self._post(self._single_export(), "fidelity", profile_id=2)
        data = response.get_json()

        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(self._quantity(2), 100)
        self.assertEqual(len(data["preserved_quantity"]), 1)
        item = data["preserved_quantity"][0]
        self.assertEqual(item["ticker"], "SPYI")
        self.assertEqual(item["profile_id"], 2)
        self.assertEqual(item["imported_quantity"], 10)
        self.assertEqual(item["kept_quantity"], 100)
        self.assertEqual(data["accepted_quantity"], [])

    def test_resending_with_accept_takes_the_file_count_and_leaves_the_ledger(self):
        self._post(self._single_export(), "fidelity", profile_id=2)
        response = self._post(
            self._single_export(),
            "fidelity",
            profile_id=2,
            accept_broker_quantity=json.dumps([{"profile_id": 2, "ticker": "spyi"}]),
        )
        data = response.get_json()

        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(self._quantity(2), 10)
        self.assertEqual(data["preserved_quantity"], [])
        self.assertEqual(data["accepted_quantity"], ["SPYI"])
        self.assertIn("Used the broker's share count for SPYI", data["message"])
        self.assertEqual(self._transaction_count(), 1)

    def test_accept_for_another_portfolio_is_refused_without_importing(self):
        response = self._post(
            self._single_export(),
            "fidelity",
            profile_id=2,
            accept_broker_quantity=json.dumps([{"profile_id": 3, "ticker": "SPYI"}]),
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("different portfolio", response.get_json()["error"])
        self.assertEqual(self._quantity(2), 100)

    def test_unreadable_accept_list_is_refused(self):
        response = self._post(
            self._single_export(),
            "fidelity",
            profile_id=2,
            accept_broker_quantity="SPYI",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._quantity(2), 100)

    def test_all_accounts_import_lists_the_kept_count_and_its_routing(self):
        preview = self._post(
            self._multi_export(), "fidelity_all_accounts",
            endpoint="/api/import/transactions/preview",
        ).get_json()
        keys = {a["account_name"]: a["account_key"] for a in preview.get("accounts") or []}
        # Opening a portfolio on the spot must come back as its id, not "new".
        account_map = {keys["Roth IRA - BDA"]: "2", keys["Traditional IRA"]: "new"}

        response = self._post(
            self._multi_export(),
            "fidelity_all_accounts",
            account_map=json.dumps(account_map),
        )
        data = response.get_json()

        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(self._quantity(2), 100)
        self.assertEqual(len(data["preserved_quantity"]), 1)
        item = data["preserved_quantity"][0]
        self.assertEqual(
            (item["ticker"], item["profile_id"], item["profile_name"], item["account_label"]),
            ("SPYI", 2, "Fidelity Roth IRA", data["details"][0]["account_label"]),
        )
        applied = data["applied_account_map"]
        self.assertEqual(applied[keys["Roth IRA - BDA"]], 2)
        self.assertIsInstance(applied[keys["Traditional IRA"]], int)

    def test_all_accounts_resend_takes_the_file_count_without_a_new_portfolio(self):
        preview = self._post(
            self._multi_export(), "fidelity_all_accounts",
            endpoint="/api/import/transactions/preview",
        ).get_json()
        keys = {a["account_name"]: a["account_key"] for a in preview.get("accounts") or []}
        first = self._post(
            self._multi_export(),
            "fidelity_all_accounts",
            account_map=json.dumps({keys["Roth IRA - BDA"]: "2", keys["Traditional IRA"]: "new"}),
        ).get_json()
        profiles_before = self._query("SELECT COUNT(*) AS n FROM profiles")[0]["n"]

        retry_map = {
            key: (pid if pid == 2 else "skip")
            for key, pid in first["applied_account_map"].items()
        }
        response = self._post(
            self._multi_export(),
            "fidelity_all_accounts",
            account_map=json.dumps(retry_map),
            accept_broker_quantity=json.dumps(first["preserved_quantity"]),
        )
        data = response.get_json()

        self.assertEqual(response.status_code, 200, data)
        self.assertEqual(self._quantity(2), 10)
        self.assertEqual(data["preserved_quantity"], [])
        self.assertEqual(data["details"][0]["accepted_quantity"], ["SPYI"])
        self.assertEqual(self._query("SELECT COUNT(*) AS n FROM profiles")[0]["n"], profiles_before)
        self.assertEqual(self._transaction_count(), 1)

    def test_all_accounts_accept_for_an_unrouted_portfolio_is_refused(self):
        preview = self._post(
            self._multi_export(), "fidelity_all_accounts",
            endpoint="/api/import/transactions/preview",
        ).get_json()
        keys = {a["account_name"]: a["account_key"] for a in preview.get("accounts") or []}

        response = self._post(
            self._multi_export(),
            "fidelity_all_accounts",
            account_map=json.dumps({keys["Roth IRA - BDA"]: "skip", keys["Traditional IRA"]: "3"}),
            accept_broker_quantity=json.dumps([{"profile_id": 2, "ticker": "SPYI"}]),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._quantity(2), 100)
        self.assertIsNone(self._quantity(3, "QQQI"))


if __name__ == "__main__":
    unittest.main()
