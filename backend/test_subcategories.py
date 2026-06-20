import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class SubcategoryApiTest(unittest.TestCase):
    """Covers the sub-category tier added to the Categories screen:
    creation, nesting in /api/categories/data, leaf assignment, validation,
    rename, and the delete/cascade behaviours."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        # Build the real schema (exercises the subcategories table + subcategory_id
        # migration) so the before-request migrations in app._ensure_db succeed.
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        # One top-level category "Metals" and three metal holdings.
        conn.execute(
            "INSERT INTO categories (id, name, target_pct, profile_id, sort_order) VALUES (1, 'Metals', 10, 1, 0)"
        )
        for ticker, value, monthly in [("GLD", 5000, 0), ("SLV", 3000, 0), ("CPER", 2000, 0)]:
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, description, classification_type, quantity, current_value, "
                " approx_monthly_income, div_frequency, nav_erosion_scope, gain_or_loss_percentage) "
                "VALUES (?, 1, ?, 'ETF', 100, ?, ?, 'M', 'auto', 0)",
                (ticker, f"{ticker} fund", value, monthly),
            )
            conn.execute(
                "INSERT INTO ticker_categories (ticker, category_id, profile_id) VALUES (?, 1, 1)",
                (ticker,),
            )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True  # schema already built; skip _ensure_db
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass  # Windows can briefly hold the temp file; best-effort cleanup.

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _row(self, sql, params=()):
        conn = self._get_connection()
        try:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _create_sub(self, name, category_id=1):
        return self.client.post(
            f"/api/categories/{category_id}/subcategories?profile_id=1",
            json={"name": name},
        )

    def _category(self, data, cat_id=1):
        return next(c for c in data["categories"] if c["id"] == cat_id)

    # ── creation ──────────────────────────────────────────────────────────────
    def test_create_subcategory(self):
        res = self._create_sub("Gold")
        self.assertEqual(res.status_code, 200)
        row = self._row("SELECT category_id, name FROM subcategories WHERE name = 'Gold'")
        self.assertEqual(row["category_id"], 1)

    def test_create_subcategory_requires_name(self):
        res = self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "  "})
        self.assertEqual(res.status_code, 400)

    def test_create_subcategory_unknown_category_404(self):
        res = self.client.post("/api/categories/999/subcategories?profile_id=1", json={"name": "Gold"})
        self.assertEqual(res.status_code, 404)

    def test_duplicate_subcategory_name_conflicts(self):
        self._create_sub("Gold")
        res = self._create_sub("Gold")
        self.assertEqual(res.status_code, 409)

    def test_same_name_allowed_in_different_categories(self):
        self.client.post("/api/categories?profile_id=1", json={"name": "Crypto"})
        crypto_id = self._row("SELECT id FROM categories WHERE name = 'Crypto'")["id"]
        self.assertEqual(self._create_sub("Gold").status_code, 200)
        self.assertEqual(self._create_sub("Gold", category_id=crypto_id).status_code, 200)

    # ── nesting in the data endpoint ────────────────────────────────────────────
    def test_data_endpoint_nests_subcategories(self):
        self._create_sub("Gold")
        self._create_sub("Silver")
        data = self.client.get("/api/categories/data?profile_id=1").get_json()
        metals = self._category(data)
        names = [s["name"] for s in metals["subcategories"]]
        self.assertEqual(names, ["Gold", "Silver"])

    # ── leaf assignment ─────────────────────────────────────────────────────────
    def test_assign_ticker_to_subcategory(self):
        self._create_sub("Gold")
        gold_id = self._row("SELECT id FROM subcategories WHERE name = 'Gold'")["id"]
        res = self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": 1, "subcategory_id": gold_id, "tickers": ["GLD"]},
        )
        self.assertEqual(res.status_code, 200)
        row = self._row("SELECT category_id, subcategory_id FROM ticker_categories WHERE ticker = 'GLD'")
        self.assertEqual(row["category_id"], 1)
        self.assertEqual(row["subcategory_id"], gold_id)

    def test_data_endpoint_tags_ticker_with_subcategory_id(self):
        self._create_sub("Gold")
        gold_id = self._row("SELECT id FROM subcategories WHERE name = 'Gold'")["id"]
        self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": 1, "subcategory_id": gold_id, "tickers": ["GLD"]},
        )
        data = self.client.get("/api/categories/data?profile_id=1").get_json()
        metals = self._category(data)
        gld = next(t for t in metals["tickers"] if t["ticker"] == "GLD")
        self.assertEqual(gld["subcategory_id"], gold_id)
        # Untouched tickers stay unclassified within the parent.
        slv = next(t for t in metals["tickers"] if t["ticker"] == "SLV")
        self.assertIsNone(slv["subcategory_id"])

    def test_assign_subcategory_from_other_category_rejected(self):
        # Sub-category that belongs to a different category must not attach here.
        self.client.post("/api/categories?profile_id=1", json={"name": "Crypto"})
        crypto_id = self._row("SELECT id FROM categories WHERE name = 'Crypto'")["id"]
        self._create_sub("BTC", category_id=crypto_id)
        btc_sub_id = self._row("SELECT id FROM subcategories WHERE name = 'BTC'")["id"]
        res = self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": 1, "subcategory_id": btc_sub_id, "tickers": ["GLD"]},
        )
        self.assertEqual(res.status_code, 400)

    def test_reassigning_ticker_replaces_subcategory(self):
        self._create_sub("Gold")
        self._create_sub("Silver")
        gold_id = self._row("SELECT id FROM subcategories WHERE name = 'Gold'")["id"]
        silver_id = self._row("SELECT id FROM subcategories WHERE name = 'Silver'")["id"]
        for sub_id in (gold_id, silver_id):
            self.client.post(
                "/api/categories/assign?profile_id=1",
                json={"category_id": 1, "subcategory_id": sub_id, "tickers": ["GLD"]},
            )
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT subcategory_id FROM ticker_categories WHERE ticker = 'GLD'"
            ).fetchall()
        finally:
            conn.close()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["subcategory_id"], silver_id)

    # ── rename ───────────────────────────────────────────────────────────────────
    def test_rename_subcategory(self):
        self._create_sub("Gold")
        gold_id = self._row("SELECT id FROM subcategories WHERE name = 'Gold'")["id"]
        res = self.client.put(f"/api/subcategories/{gold_id}?profile_id=1", json={"name": "Gold Bullion"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._row("SELECT name FROM subcategories WHERE id = ?", (gold_id,))["name"], "Gold Bullion")

    # ── deletes ──────────────────────────────────────────────────────────────────
    def test_delete_subcategory_keeps_ticker_in_parent(self):
        self._create_sub("Gold")
        gold_id = self._row("SELECT id FROM subcategories WHERE name = 'Gold'")["id"]
        self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": 1, "subcategory_id": gold_id, "tickers": ["GLD"]},
        )
        res = self.client.delete(f"/api/subcategories/{gold_id}?profile_id=1")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(self._row("SELECT id FROM subcategories WHERE id = ?", (gold_id,)))
        row = self._row("SELECT category_id, subcategory_id FROM ticker_categories WHERE ticker = 'GLD'")
        self.assertEqual(row["category_id"], 1)
        self.assertIsNone(row["subcategory_id"])

    def test_delete_category_cascades_subcategories(self):
        self._create_sub("Gold")
        self.client.delete("/api/categories/1?profile_id=1")
        self.assertIsNone(self._row("SELECT id FROM subcategories WHERE category_id = 1"))
        self.assertIsNone(self._row("SELECT id FROM categories WHERE id = 1"))

    # ── sub-category target (% of parent category) ───────────────────────────────
    def test_create_subcategory_with_target(self):
        res = self.client.post(
            "/api/categories/1/subcategories?profile_id=1",
            json={"name": "Gold", "target_pct": 60},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._row("SELECT target_pct FROM subcategories WHERE name = 'Gold'")["target_pct"], 60)

    def test_data_endpoint_exposes_subcategory_target(self):
        self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "Gold", "target_pct": 60})
        data = self.client.get("/api/categories/data?profile_id=1").get_json()
        gold = self._category(data)["subcategories"][0]
        self.assertEqual(gold["target_pct"], 60)

    def test_update_subcategory_target_only(self):
        self._create_sub("Gold")
        gold_id = self._row("SELECT id FROM subcategories WHERE name = 'Gold'")["id"]
        res = self.client.put(f"/api/subcategories/{gold_id}?profile_id=1", json={"target_pct": 40})
        self.assertEqual(res.status_code, 200)
        row = self._row("SELECT name, target_pct FROM subcategories WHERE id = ?", (gold_id,))
        self.assertEqual(row["name"], "Gold")  # name preserved
        self.assertEqual(row["target_pct"], 40)

    # ── push to sub-accounts ─────────────────────────────────────────────────────
    def _seed_subaccount(self, pid=2, name="Sub"):
        conn = self._get_connection()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO profiles (id, name, include_in_owner) VALUES (?, ?, 1)",
                (pid, name),
            )
            conn.commit()
        finally:
            conn.close()

    def test_push_creates_categories_and_subcategories_in_subaccount(self):
        self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "Gold", "target_pct": 60})
        self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "Silver", "target_pct": 40})
        self._seed_subaccount(pid=2)
        res = self.client.post("/api/categories/push-to-subaccounts?profile_id=1")
        self.assertEqual(res.status_code, 200)
        cat = self._row("SELECT id, target_pct FROM categories WHERE name = 'Metals' AND profile_id = 2")
        self.assertIsNotNone(cat)
        self.assertEqual(cat["target_pct"], 10)
        conn = self._get_connection()
        try:
            subs = conn.execute(
                "SELECT name, target_pct FROM subcategories WHERE profile_id = 2 ORDER BY name"
            ).fetchall()
        finally:
            conn.close()
        self.assertEqual([(s["name"], s["target_pct"]) for s in subs], [("Gold", 60), ("Silver", 40)])

    def test_push_overwrites_existing_subaccount_category(self):
        self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "Gold", "target_pct": 60})
        self._seed_subaccount(pid=2)
        # Pre-existing differing category + sub-category in the sub-account.
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, target_pct, profile_id, sort_order) VALUES ('Metals', 99, 2, 5)")
            cat2 = conn.execute("SELECT id FROM categories WHERE name='Metals' AND profile_id=2").fetchone()["id"]
            conn.execute("INSERT INTO subcategories (category_id, name, profile_id) VALUES (?, 'Platinum', 2)", (cat2,))
            conn.commit()
        finally:
            conn.close()
        self.client.post("/api/categories/push-to-subaccounts?profile_id=1")
        # Target overwritten to owner's, old sub-category gone, owner's sub-category present.
        self.assertEqual(self._row("SELECT target_pct FROM categories WHERE name='Metals' AND profile_id=2")["target_pct"], 10)
        self.assertIsNone(self._row("SELECT id FROM subcategories WHERE name='Platinum' AND profile_id=2"))
        self.assertIsNotNone(self._row("SELECT id FROM subcategories WHERE name='Gold' AND profile_id=2"))

    def test_push_preserves_existing_subaccount_assignments(self):
        # Owner has Metals -> Gold. Sub-account already has Metals -> Gold with a
        # ticker assigned to it. Pushing must keep that ticker in Gold (no id churn).
        self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "Gold", "target_pct": 70})
        self._seed_subaccount(pid=2)
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, target_pct, profile_id, sort_order) VALUES ('Metals', 5, 2, 0)")
            cat2 = conn.execute("SELECT id FROM categories WHERE name='Metals' AND profile_id=2").fetchone()["id"]
            conn.execute("INSERT INTO subcategories (category_id, name, profile_id) VALUES (?, 'Gold', 2)", (cat2,))
            gold2 = conn.execute("SELECT id FROM subcategories WHERE name='Gold' AND profile_id=2").fetchone()["id"]
            conn.execute(
                "INSERT INTO all_account_info (ticker, profile_id, description, classification_type, quantity, current_value, approx_monthly_income, div_frequency, nav_erosion_scope, gain_or_loss_percentage) "
                "VALUES ('IAU', 2, 'IAU fund', 'ETF', 100, 1000, 0, 'M', 'auto', 0)"
            )
            conn.execute(
                "INSERT INTO ticker_categories (ticker, category_id, subcategory_id, profile_id) VALUES ('IAU', ?, ?, 2)",
                (cat2, gold2),
            )
            conn.commit()
        finally:
            conn.close()
        self.client.post("/api/categories/push-to-subaccounts?profile_id=1")
        # Same Gold sub-category id kept, IAU still assigned to it, target synced to owner's.
        row = self._row("SELECT id, target_pct FROM subcategories WHERE name='Gold' AND profile_id=2")
        self.assertEqual(row["id"], gold2)
        self.assertEqual(row["target_pct"], 70)
        self.assertEqual(self._row("SELECT subcategory_id FROM ticker_categories WHERE ticker='IAU'")["subcategory_id"], gold2)

    def test_push_rejected_for_non_owner(self):
        self._seed_subaccount(pid=2)
        res = self.client.post("/api/categories/push-to-subaccounts?profile_id=2")
        self.assertEqual(res.status_code, 403)


if __name__ == "__main__":
    unittest.main()
