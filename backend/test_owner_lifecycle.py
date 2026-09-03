"""Optional Owner lifecycle and first-account behavior."""

import io
import sqlite3
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import config
import database


class OwnerLifecycleTest(unittest.TestCase):
    def setUp(self):
        temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        temp_file.close()
        self.db_path = temp_file.name
        conn = self._get_connection()
        database.ensure_tables_exist(conn)
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_backup = app_module._create_import_backup
        self._orig_db_path = config.DB_PATH
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        app_module._create_import_backup = lambda profile_id=None: "/tmp/owner-test.db"
        config.DB_PATH = self.db_path
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        app_module._create_import_backup = self._orig_backup
        config.DB_PATH = self._orig_db_path
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def test_fresh_database_hides_reserved_owner_and_first_account_is_regular(self):
        self.assertEqual(self.client.get("/api/profiles").get_json(), [])
        hidden_owner = self.client.put(
            "/api/profiles/1/selector-visibility", json={"visible": True}
        )
        self.assertEqual(hidden_owner.status_code, 404)

        created = self.client.post(
            "/api/profiles", json={"name": "Schwab", "broker_source": "schwab"}
        )
        self.assertEqual(created.status_code, 201)
        body = created.get_json()
        self.assertNotEqual(body["id"], 1)
        self.assertFalse(body["is_owner"])
        self.assertEqual(body["include_in_owner"], 0)

        profiles = self.client.get("/api/profiles").get_json()
        self.assertEqual([profile["name"] for profile in profiles], ["Schwab"])
        self.assertEqual(profiles[0]["is_owner"], 0)

    def test_existing_profile_one_remains_active_during_schema_upgrade(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as legacy_file:
            legacy_path = Path(legacy_file.name)
        try:
            conn = sqlite3.connect(legacy_path)
            conn.execute(
                """CREATE TABLE profiles (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       name TEXT NOT NULL,
                       broker_source TEXT,
                       include_in_owner INTEGER NOT NULL DEFAULT 0,
                       positions_managed INTEGER NOT NULL DEFAULT 0,
                       display_order INTEGER NOT NULL DEFAULT 0,
                       hidden_from_selector INTEGER NOT NULL DEFAULT 0,
                       is_user_owned INTEGER NOT NULL DEFAULT 1,
                       cash_value REAL NOT NULL DEFAULT 0,
                       cash_source TEXT,
                       cash_updated_at TEXT,
                       created_at TEXT DEFAULT CURRENT_TIMESTAMP
                   )"""
            )
            conn.execute(
                "INSERT INTO profiles (id, name, broker_source) VALUES (1, 'Schwab', 'schwab')"
            )
            database.ensure_tables_exist(conn)
            row = conn.execute(
                "SELECT name, owner_active FROM profiles WHERE id = 1"
            ).fetchone()
            self.assertEqual(row, ("Schwab", 1))
            conn.close()
        finally:
            legacy_path.unlink(missing_ok=True)

    def test_existing_standalone_data_survives_upgrade_and_refresh_without_a_broker_tag(self):
        conn = self._get_connection()
        # Model a populated database from before the optional Owner migration.
        conn.execute("ALTER TABLE profiles DROP COLUMN owner_active")
        conn.execute(
            "UPDATE profiles SET name = 'All Accounts', broker_source = '', "
            "hidden_from_selector = 0, cash_value = 75, positions_managed = 1 WHERE id = 1"
        )
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, price_paid, purchase_value, current_price, current_value) "
            "VALUES ('ABC', 1, 10, 20, 200, 25, 250)"
        )
        conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share) "
            "VALUES ('ABC', 1, 'BUY', '2026-01-01', 10, 20)"
        )
        conn.execute(
            "INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source) "
            "VALUES ('ABC', 1, '2026-08-01', 5, 'schwab_transactions')"
        )
        conn.execute("INSERT INTO settings (key, value) VALUES ('owner_import_used', 'true')")
        conn.commit()
        database.ensure_tables_exist(conn)
        conn.close()
        app_module.populate_holdings(1)
        app_module.populate_dividends(1)
        app_module.populate_income_tracking(1)

        # Startup migration and repeated refresh/reconciliation must preserve
        # the account even though it predates all new import/rollup metadata.
        app_module._auto_reconcile_owner()
        app_module._auto_reconcile_owner()
        profiles = self.client.get("/api/profiles").get_json()
        self.assertEqual([p["name"] for p in profiles], ["All Accounts"])
        conn = self._get_connection()
        for table in ("all_account_info", "holdings", "transactions", "dividend_payments"):
            self.assertEqual(conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE profile_id = 1"
            ).fetchone()[0], 1, table)
        self.assertEqual(tuple(conn.execute(
            "SELECT quantity, purchase_value, current_value FROM all_account_info WHERE profile_id = 1"
        ).fetchone()), (10, 200, 250))
        self.assertEqual(conn.execute("SELECT cash_value FROM profiles WHERE id = 1").fetchone()[0], 75)
        conn.close()

    def test_user_creates_owner_then_explicitly_chooses_members(self):
        regular = self.client.post(
            "/api/profiles", json={"name": "Schwab", "broker_source": "schwab"}
        ).get_json()
        owner = self.client.post("/api/owner")
        self.assertEqual(owner.status_code, 201)
        self.assertEqual(owner.get_json()["id"], 1)
        self.assertEqual(owner.get_json()["name"], "Owner")

        profiles = self.client.get("/api/profiles").get_json()
        self.assertEqual([profile["name"] for profile in profiles], ["Owner", "Schwab"])
        schwab = next(profile for profile in profiles if profile["id"] == regular["id"])
        self.assertEqual(schwab["include_in_owner"], 0)

        included = self.client.put(
            f"/api/profiles/{regular['id']}/include-in-owner", json={"include": True}
        )
        self.assertEqual(included.status_code, 200)
        summary = self.client.get("/api/profiles/summary").get_json()
        self.assertTrue(summary["owner_active"])
        self.assertEqual(summary["owner_member_count"], 1)

    def test_owner_must_be_empty_before_delete_and_can_be_recreated(self):
        regular = self.client.post(
            "/api/profiles", json={"name": "Interactive Brokers"}
        ).get_json()
        self.client.post("/api/owner")
        self.client.put(
            f"/api/profiles/{regular['id']}/include-in-owner", json={"include": True}
        )

        blocked = self.client.delete(
            "/api/profiles/1", json={"confirm_name": "Owner"}
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertIn("Remove all", blocked.get_json()["error"])

        removed = self.client.put(
            f"/api/profiles/{regular['id']}/include-in-owner", json={"include": False}
        )
        self.assertEqual(removed.status_code, 200)
        deleted = self.client.delete(
            "/api/profiles/1", json={"confirm_name": "Owner"}
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(
            [profile["name"] for profile in self.client.get("/api/profiles").get_json()],
            ["Interactive Brokers"],
        )

        recreated = self.client.post("/api/owner")
        self.assertEqual(recreated.status_code, 201)
        self.assertEqual(recreated.get_json()["name"], "Owner")

    def _post_import(self, endpoint, fmt="schwab", content=None, query="profile_id=1"):
        if content is None:
            content = (
                b'Symbol,Description,Qty (Quantity),Cost/Share,Price,Mkt Val (Market Value)\n'
                b'ABC,Example Fund,10,20,25,250\n'
            )
        return self.client.post(
            f"{endpoint}?{query}",
            data={
                "format": fmt,
                "nav_date": date.today().isoformat(),
                "file": (io.BytesIO(content), "positions.csv"),
            },
            content_type="multipart/form-data",
        )

    def test_standalone_owner_previews_and_imports_single_account_positions_and_transactions(self):
        self.client.post("/api/owner")
        for name in ("Owner", "All Accounts"):
            with self.subTest(name=name):
                conn = self._get_connection()
                conn.execute("UPDATE profiles SET name = ? WHERE id = 1", (name,))
                conn.commit()
                conn.close()

                preview = self._post_import("/api/import/transactions/preview")
                self.assertEqual(preview.status_code, 200, preview.get_json())
                self.assertEqual(preview.get_json()["format_type"], "positions")
                imported = self._post_import("/api/import/transactions")
                self.assertEqual(imported.status_code, 200, imported.get_json())

        history = (
            b'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount\n'
            b'08/01/2026,Cash Dividend,ABC,Example Fund,,,,5.00\n'
        )
        for endpoint in ("/api/import/transactions/preview", "/api/import/transactions"):
            response = self._post_import(endpoint, "schwab_transactions", history)
            self.assertEqual(response.status_code, 200, response.get_json())
        # Market refresh also reconciles Owner. It must not erase a direct
        # import just because this standalone portfolio has no broker tag.
        app_module._auto_reconcile_owner()
        conn = self._get_connection()
        holding = conn.execute(
            "SELECT quantity, purchase_value FROM all_account_info WHERE profile_id = 1 AND ticker = 'ABC'"
        ).fetchone()
        self.assertEqual(tuple(holding), (10, 200))
        dividend = conn.execute(
            "SELECT amount FROM dividend_payments WHERE profile_id = 1 AND ticker = 'ABC'"
        ).fetchone()
        self.assertEqual(dividend[0], 5)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM profiles").fetchone()[0], 1)
        conn.close()

    def test_standalone_import_becomes_a_rollup_when_members_are_added(self):
        self.client.post("/api/owner")
        self.client.put(
            "/api/profiles/1", json={"name": "Owner", "broker_source": "schwab"}
        )
        imported = self._post_import("/api/import/transactions")
        self.assertEqual(imported.status_code, 200, imported.get_json())
        member = self.client.post("/api/profiles", json={"name": "Schwab"}).get_json()
        imported = self._post_import(
            "/api/import/transactions", query=f"profile_id={member['id']}"
        )
        self.assertEqual(imported.status_code, 200, imported.get_json())
        self.client.put(
            f"/api/profiles/{member['id']}/include-in-owner", json={"include": True}
        )
        self.client.put(
            f"/api/profiles/{member['id']}/include-in-owner", json={"include": False}
        )
        conn = self._get_connection()
        self.assertEqual(conn.execute(
            "SELECT COUNT(*) FROM all_account_info WHERE profile_id = 1"
        ).fetchone()[0], 0)
        self.assertEqual(conn.execute(
            "SELECT COUNT(*) FROM all_account_info WHERE profile_id = ?", (member['id'],)
        ).fetchone()[0], 1)
        conn.close()

    def test_direct_import_replaces_a_stale_rollup_marker(self):
        self.client.post("/api/owner")
        conn = self._get_connection()
        conn.execute("INSERT INTO settings (key, value) VALUES ('owner_rollup_snapshot', 'true')")
        conn.commit()
        conn.close()
        imported = self._post_import("/api/import/transactions")
        self.assertEqual(imported.status_code, 200, imported.get_json())
        app_module._auto_reconcile_owner()
        conn = self._get_connection()
        self.assertEqual(conn.execute(
            "SELECT quantity FROM all_account_info WHERE profile_id = 1 AND ticker = 'ABC'"
        ).fetchone()[0], 10)
        conn.close()

    def test_standalone_owner_can_set_broker_for_named_account_imports(self):
        self.client.post("/api/owner")
        updated = self.client.put(
            "/api/profiles/1", json={"name": "All Accounts", "broker_source": "fidelity"}
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["broker_source"], "fidelity")
        content = (
            b'Account number,Account name,Symbol,Description,Last Price,Current value,Cost basis total,Average cost basis,Quantity,Type\n'
            b'Z111,Roth IRA,ABC,Example Fund,25,250,200,20,10,ETF\n'
        )
        preview = self._post_import("/api/import/transactions/preview", "fidelity", content)
        self.assertEqual(preview.status_code, 200, preview.get_json())
        self.assertTrue(preview.get_json()["account_match"]["matched"])
        imported = self._post_import("/api/import/transactions", "fidelity", content)
        self.assertEqual(imported.status_code, 200, imported.get_json())

        wrong_broker = self._post_import("/api/import/transactions/preview", "schwab")
        self.assertEqual(wrong_broker.status_code, 400)
        self.assertIn("marked as Fidelity", wrong_broker.get_json()["error"])

    def test_unrelated_accounts_do_not_turn_owner_into_an_import_rollup(self):
        self.client.post("/api/owner")
        self.client.post("/api/profiles", json={"name": "Other Account"})
        preview = self._post_import("/api/import/transactions/preview")
        self.assertEqual(preview.status_code, 200, preview.get_json())

    def test_owner_with_members_blocks_single_account_imports_before_parsing(self):
        self.client.post("/api/owner")
        member = self.client.post(
            "/api/profiles", json={"name": "Schwab", "broker_source": "schwab"}
        ).get_json()
        self.client.put(
            f"/api/profiles/{member['id']}/include-in-owner", json={"include": True}
        )
        # Hidden members still feed the rollup.
        self.client.put(
            f"/api/profiles/{member['id']}/selector-visibility", json={"visible": False}
        )
        for endpoint in ("/api/import/transactions/preview", "/api/import/transactions"):
            for fmt in ("schwab", "schwab_transactions", "generic_transactions"):
                with self.subTest(endpoint=endpoint, fmt=fmt):
                    rejected = self._post_import(endpoint, fmt, b"not parsed")
                    self.assertEqual(rejected.status_code, 400)
                    self.assertIn("Owner is a rollup", rejected.get_json()["error"])
        for endpoint in ("/api/import/excel", "/api/import/generic"):
            rejected = self.client.post(f"{endpoint}?profile_id=1")
            self.assertEqual(rejected.status_code, 400)
            self.assertIn("Owner is a rollup", rejected.get_json()["error"])

        updated = self.client.put(
            "/api/profiles/1", json={"name": "Broker", "broker_source": "schwab"}
        )
        self.assertEqual(updated.get_json()["broker_source"], "")
        self.assertEqual(updated.get_json()["name"], "Owner")

    def test_standalone_owner_is_allowed_through_generic_and_excel_import_guards(self):
        self.client.post("/api/owner")
        for endpoint in ("/api/import/excel", "/api/import/generic"):
            response = self.client.post(f"{endpoint}?profile_id=1")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()["error"], "No file uploaded")

    def test_standalone_owner_generic_positions_survive_reconciliation(self):
        self.client.post("/api/owner")
        workbook = io.BytesIO()
        app_module.pd.DataFrame({"Ticker": ["ABC"], "Shares": [10]}).to_excel(workbook, index=False)
        workbook.seek(0)
        imported = self.client.post(
            "/api/import/generic?profile_id=1",
            data={"file": (workbook, "positions.xlsx")},
            content_type="multipart/form-data",
        )
        self.assertEqual(imported.status_code, 200, imported.get_json())
        app_module._auto_reconcile_owner()
        conn = self._get_connection()
        self.assertEqual(conn.execute(
            "SELECT quantity FROM all_account_info WHERE profile_id = 1 AND ticker = 'ABC'"
        ).fetchone()[0], 10)
        conn.close()

    def test_inactive_reserved_owner_is_not_an_import_destination(self):
        rejected = self._post_import("/api/import/transactions")
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("Owner has not been created", rejected.get_json()["error"])

    def test_aggregate_still_blocks_single_account_imports(self):
        self.client.post("/api/owner")
        for endpoint in ("/api/import/transactions/preview", "/api/import/transactions"):
            rejected = self._post_import(endpoint, query="aggregate_id=1")
            self.assertEqual(rejected.status_code, 400)
            self.assertIn("Aggregate", rejected.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
