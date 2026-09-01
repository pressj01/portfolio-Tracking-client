"""Optional Owner lifecycle and first-account behavior."""

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

    def test_owner_is_never_a_single_broker_import_target(self):
        self.client.post("/api/owner")
        rejected = self.client.post(
            "/api/import/transactions?profile_id=1",
            data={
                "format": "schwab",
                "file": (io.BytesIO(b"not parsed"), "history.csv"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("Owner is a rollup", rejected.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
