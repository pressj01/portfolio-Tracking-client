import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class CategoryCrudTest(unittest.TestCase):
    """Covers editing and deleting categories, including the auto-seed guard
    that used to rebuild every category as soon as the last one was deleted."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute(
            "INSERT INTO categories (id, name, target_pct, profile_id, sort_order) VALUES (1, 'Metals', 10, 1, 0)"
        )
        conn.execute(
            "INSERT INTO categories (id, name, target_pct, profile_id, sort_order) VALUES (2, 'Anchors', 20, 1, 1)"
        )
        for ticker, cat_id in [("GLD", 1), ("SLV", 1), ("SCHD", 2)]:
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, description, classification_type, quantity, current_value, "
                " approx_monthly_income, div_frequency, nav_erosion_scope, gain_or_loss_percentage) "
                "VALUES (?, 1, ?, 'ETF', 100, 1000, 5, 'M', 'auto', 0)",
                (ticker, f"{ticker} fund"),
            )
            conn.execute(
                "INSERT INTO ticker_categories (ticker, category_id, profile_id) VALUES (?, ?, 1)",
                (ticker, cat_id),
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
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _data(self):
        return self.client.get("/api/categories/data?profile_id=1").get_json()

    def _names(self):
        return sorted(c["name"] for c in self._data()["categories"])

    # ── delete ────────────────────────────────────────────────────────────────
    def test_delete_removes_only_that_category(self):
        res = self.client.delete("/api/categories/1?profile_id=1")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._names(), ["Anchors"])

    def test_deleting_every_category_leaves_none_behind(self):
        """The reported bug: they were deleted, then came straight back."""
        self._data()  # load the screen first, as the UI does
        self.client.delete("/api/categories/1?profile_id=1")
        self.client.delete("/api/categories/2?profile_id=1")
        self.assertEqual(self._data()["categories"], [])
        # Still empty on a later visit, not just the reload right after deleting.
        self.assertEqual(self._data()["categories"], [])

    def test_deleting_every_category_without_loading_first_stays_deleted(self):
        self.client.delete("/api/categories/1?profile_id=1")
        self.client.delete("/api/categories/2?profile_id=1")
        self.assertEqual(self._data()["categories"], [])

    def test_delete_unallocates_its_tickers(self):
        self.client.delete("/api/categories/1?profile_id=1")
        unallocated = {t["ticker"] for t in self._data()["unallocated"]}
        self.assertEqual(unallocated, {"GLD", "SLV"})

    def test_delete_removes_child_subcategories(self):
        self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "Gold"})
        res = self.client.delete("/api/categories/1?profile_id=1")
        self.assertEqual(res.status_code, 200)
        conn = self._get_connection()
        try:
            left = conn.execute("SELECT COUNT(*) c FROM subcategories WHERE category_id = 1").fetchone()["c"]
        finally:
            conn.close()
        self.assertEqual(left, 0)

    # ── first-run seeding still works ─────────────────────────────────────────
    def test_profile_with_no_categories_is_seeded_on_first_visit(self):
        conn = self._get_connection()
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (2, 'New')")
        conn.execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, description, classification_type, quantity, current_value, "
            " approx_monthly_income, div_frequency, nav_erosion_scope, gain_or_loss_percentage) "
            "VALUES ('QQQI', 2, 'QQQI fund', 'ETF', 100, 1000, 5, 'M', 'auto', 0)"
        )
        conn.commit()
        conn.close()
        seeded = self.client.get("/api/categories/data?profile_id=2").get_json()
        self.assertTrue(seeded["categories"], "a fresh profile should still auto-seed once")

    # ── edit ──────────────────────────────────────────────────────────────────
    def test_rename_category(self):
        res = self.client.put("/api/categories/1?profile_id=1", json={"name": "Precious Metals"})
        self.assertEqual(res.status_code, 200)
        self.assertIn("Precious Metals", self._names())

    def test_edit_target_pct(self):
        res = self.client.put("/api/categories/1?profile_id=1", json={"target_pct": 42.5})
        self.assertEqual(res.status_code, 200)
        cat = next(c for c in self._data()["categories"] if c["id"] == 1)
        self.assertAlmostEqual(cat["target_pct"], 42.5)

    def test_rename_onto_existing_name_is_rejected(self):
        res = self.client.put("/api/categories/1?profile_id=1", json={"name": "Anchors"})
        self.assertEqual(res.status_code, 409)
        self.assertIn("already uses that name", res.get_json()["error"])

    def test_edit_unknown_category_reports_not_found(self):
        res = self.client.put("/api/categories/999?profile_id=1", json={"name": "Ghost"})
        self.assertEqual(res.status_code, 404)

    def test_edit_on_aggregate_is_rejected(self):
        res = self.client.put("/api/categories/1?aggregate_id=1", json={"name": "Nope"})
        self.assertEqual(res.status_code, 400)

    def test_delete_on_aggregate_is_rejected(self):
        res = self.client.delete("/api/categories/1?aggregate_id=1")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self._names(), ["Anchors", "Metals"])


if __name__ == "__main__":
    unittest.main()
