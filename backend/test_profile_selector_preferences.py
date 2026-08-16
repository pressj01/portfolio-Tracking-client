import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class ProfileSelectorPreferencesApiTest(unittest.TestCase):
    def setUp(self):
        temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        temp_file.close()
        self.db_path = temp_file.name
        conn = self._get_connection()
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute("INSERT INTO profiles (id, name) VALUES (2, 'Brokerage')")
        conn.execute("INSERT INTO profiles (id, name) VALUES (3, 'Test Portfolio')")
        conn.execute("INSERT INTO aggregates (id, name) VALUES (1, 'Combined')")
        conn.execute("INSERT INTO aggregates (id, name) VALUES (2, 'Test Aggregate')")
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def test_profiles_can_be_reordered_and_hidden_from_selector(self):
        ordered = self.client.put("/api/profiles/order", json={"ordered_ids": [3, 1, 2]})
        self.assertEqual(ordered.status_code, 200)

        hidden = self.client.put(
            "/api/profiles/3/selector-visibility", json={"visible": False}
        )
        self.assertEqual(hidden.status_code, 200)

        profiles = self.client.get("/api/profiles").get_json()
        self.assertEqual([profile["id"] for profile in profiles], [3, 1, 2])
        self.assertEqual(profiles[0]["hidden_from_selector"], 1)

        owner_hidden = self.client.put(
            "/api/profiles/1/selector-visibility", json={"visible": False}
        )
        self.assertEqual(owner_hidden.status_code, 400)

    def test_aggregates_can_be_reordered_and_hidden_from_selector(self):
        ordered = self.client.put("/api/aggregates/order", json={"ordered_ids": [2, 1]})
        self.assertEqual(ordered.status_code, 200)

        hidden = self.client.put(
            "/api/aggregates/2", json={"hidden_from_selector": True}
        )
        self.assertEqual(hidden.status_code, 200)

        aggregates = self.client.get("/api/aggregates").get_json()["aggregates"]
        self.assertEqual([aggregate["id"] for aggregate in aggregates], [2, 1])
        self.assertEqual(aggregates[0]["hidden_from_selector"], 1)


if __name__ == "__main__":
    unittest.main()
