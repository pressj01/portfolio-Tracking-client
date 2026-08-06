import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class ActionCenterCompletionApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._get_connection()
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, description, quantity, current_value, div,
                estim_payment_per_year, approx_monthly_income)
               VALUES ('META', 1, 'Metadata test holding', 10, 1000, 1, 12, 1)"""
        )
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
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _action_center(self):
        response = self.client.get("/api/action-center?profile_id=1")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_completed_item_moves_out_of_active_list_and_can_be_restored(self):
        before = self._action_center()
        item = next(
            item for item in before["items"]
            if item["id"] == "complete-dividend-metadata"
        )
        self.assertTrue(item["can_complete"])

        complete = self.client.post(
            "/api/action-center/completions?profile_id=1",
            json={"action_id": item["id"]},
        )
        self.assertEqual(complete.status_code, 200)

        completed = self._action_center()
        self.assertNotIn(item["id"], [row["id"] for row in completed["items"]])
        restored_item = next(
            row for row in completed["completed_items"]
            if row["id"] == item["id"]
        )
        self.assertTrue(restored_item["completed"])
        self.assertEqual(completed["summary"]["completed_count"], 1)

        restore = self.client.delete(
            f"/api/action-center/completions/{item['id']}?profile_id=1"
        )
        self.assertEqual(restore.status_code, 200)

        after_restore = self._action_center()
        self.assertIn(item["id"], [row["id"] for row in after_restore["items"]])
        self.assertEqual(after_restore["summary"]["completed_count"], 0)

    def test_completion_requires_a_valid_action_id(self):
        response = self.client.post(
            "/api/action-center/completions?profile_id=1",
            json={"action_id": "not valid"},
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
