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
        empty = {"order": {}, "hidden": [], "preset": None}
        self.assertEqual(self.client.get("/api/menu-order").get_json(), empty)

        order = {
            "top-level": ["admin", "dashboard"],
            "options": ["option-greeks", "option-dashboard"],
        }
        saved = self.client.put("/api/menu-order", json={"order": order})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.get_json()["order"], order)
        self.assertEqual(saved.get_json()["hidden"], [])
        self.assertEqual(self.client.get("/api/menu-order").get_json()["order"], order)

        reset = self.client.delete("/api/menu-order")
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(self.client.get("/api/menu-order").get_json(), empty)

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

    def test_hidden_pages_and_preset_round_trip(self):
        saved = self.client.put(
            "/api/menu-order",
            json={
                "hidden": ["options", "dashboard", "dividend-compare"],
                "preset": "income-tracker",
            },
        )
        self.assertEqual(saved.status_code, 200)
        body = saved.get_json()
        self.assertEqual(body["hidden"], ["options", "dividend-compare"])
        self.assertEqual(body["preset"], "income-tracker")
        loaded = self.client.get("/api/menu-order").get_json()
        self.assertEqual(loaded["hidden"], ["options", "dividend-compare"])
        self.assertEqual(loaded["preset"], "income-tracker")

    def test_put_order_preserves_hidden_pages(self):
        self.client.put(
            "/api/menu-order",
            json={"hidden": ["dividend-compare"], "preset": "cef-analyst"},
        )
        saved = self.client.put(
            "/api/menu-order",
            json={"order": {"options": ["option-dashboard"]}},
        )
        self.assertEqual(saved.status_code, 200)
        body = saved.get_json()
        self.assertEqual(body["order"], {"options": ["option-dashboard"]})
        self.assertEqual(body["hidden"], ["dividend-compare"])
        self.assertEqual(body["preset"], "cef-analyst")

    def test_legacy_order_document_still_loads(self):
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            ("menu_order", '{"options":["option-greeks"]}'),
        )
        conn.commit()
        conn.close()
        body = self.client.get("/api/menu-order").get_json()
        self.assertEqual(body["order"], {"options": ["option-greeks"]})
        self.assertEqual(body["hidden"], [])
        self.assertIsNone(body["preset"])

    def test_invalid_preset_is_rejected(self):
        bad = self.client.put("/api/menu-order", json={"preset": "day-trader"})
        self.assertEqual(bad.status_code, 400)


if __name__ == "__main__":
    unittest.main()
