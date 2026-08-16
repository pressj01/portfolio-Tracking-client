import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class MenuOrderApiTest(unittest.TestCase):
    def setUp(self):
        temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        temp_file.close()
        self.db_path = temp_file.name

        conn = self._get_connection()
        database.ensure_tables_exist(conn)
        conn.commit()
        conn.close()

        self._original_get_connection = app_module.get_connection
        self._original_testing = app_module.app.testing
        self._original_db_init = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._original_get_connection
        app_module.app.testing = self._original_testing
        app_module.app._db_initialized = self._original_db_init
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def test_menu_order_round_trip_and_reset(self):
        self.assertEqual(self.client.get("/api/menu-order").get_json(), {"order": {}})

        order = {
            "top-level": ["admin", "dashboard"],
            "options": ["option-greeks", "option-dashboard"],
        }
        saved = self.client.put("/api/menu-order", json={"order": order})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.get_json()["order"], order)
        self.assertEqual(self.client.get("/api/menu-order").get_json()["order"], order)

        reset = self.client.delete("/api/menu-order")
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(self.client.get("/api/menu-order").get_json(), {"order": {}})

    def test_menu_order_rejects_duplicate_or_malformed_ids(self):
        duplicate = self.client.put(
            "/api/menu-order",
            json={"order": {"options": ["option-greeks", "option-greeks"]}},
        )
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn("duplicate", duplicate.get_json()["error"])

        malformed = self.client.put(
            "/api/menu-order", json={"order": {"options": "option-greeks"}}
        )
        self.assertEqual(malformed.status_code, 400)


if __name__ == "__main__":
    unittest.main()
