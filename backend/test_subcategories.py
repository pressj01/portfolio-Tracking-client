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

    # Assignment safety
    def test_reassigning_ticker_to_different_category_replaces_row(self):
        self.client.post("/api/categories?profile_id=1", json={"name": "Equity"})
        equity_id = self._row("SELECT id FROM categories WHERE name = 'Equity'")["id"]
        res = self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": equity_id, "tickers": ["GLD"]},
        )
        self.assertEqual(res.status_code, 200)
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT category_id, subcategory_id FROM ticker_categories WHERE ticker = 'GLD' AND profile_id = 1"
            ).fetchall()
        finally:
            conn.close()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["category_id"], equity_id)
        self.assertIsNone(rows[0]["subcategory_id"])

    def test_assign_rejects_aggregate_context(self):
        res = self.client.post(
            "/api/categories/assign?aggregate_id=1",
            json={"category_id": 1, "tickers": ["GLD"]},
        )
        self.assertEqual(res.status_code, 400)

    def test_data_endpoint_does_not_delete_inactive_assignment(self):
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET quantity = 0 WHERE ticker = 'GLD' AND profile_id = 1"
            )
            conn.commit()
        finally:
            conn.close()
        data = self.client.get("/api/categories/data?profile_id=1").get_json()
        metals = self._category(data)
        self.assertNotIn("GLD", [t["ticker"] for t in metals["tickers"]])
        row = self._row(
            "SELECT category_id FROM ticker_categories WHERE ticker = 'GLD' AND profile_id = 1"
        )
        self.assertIsNotNone(row)

    # Rename
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

    # ── ordering (Move up / Move down on the Categories screen) ──────────────────
    def _sub_id(self, name, category_id=1):
        return self._row(
            "SELECT id FROM subcategories WHERE name = ? AND category_id = ?",
            (name, category_id),
        )["id"]

    def test_reorder_subcategories_changes_data_order(self):
        for name in ("Gold", "Silver", "Copper"):
            self._create_sub(name)
        order = [self._sub_id("Copper"), self._sub_id("Gold"), self._sub_id("Silver")]
        res = self.client.post(
            "/api/categories/1/subcategories/reorder?profile_id=1", json={"order": order},
        )
        self.assertEqual(res.status_code, 200)
        data = self.client.get("/api/categories/data?profile_id=1").get_json()
        names = [s["name"] for s in self._category(data)["subcategories"]]
        self.assertEqual(names, ["Copper", "Gold", "Silver"])

    def test_reorder_subcategories_ignores_other_categories(self):
        self.client.post("/api/categories?profile_id=1", json={"name": "Crypto"})
        crypto_id = self._row("SELECT id FROM categories WHERE name = 'Crypto'")["id"]
        self._create_sub("Gold")
        self._create_sub("Bitcoin", category_id=crypto_id)
        bitcoin_id = self._sub_id("Bitcoin", crypto_id)
        before = self._row("SELECT sort_order FROM subcategories WHERE id = ?", (bitcoin_id,))["sort_order"]
        self.client.post(
            "/api/categories/1/subcategories/reorder?profile_id=1",
            json={"order": [bitcoin_id, self._sub_id("Gold")]},
        )
        after = self._row("SELECT sort_order FROM subcategories WHERE id = ?", (bitcoin_id,))["sort_order"]
        self.assertEqual(after, before)
        self.assertEqual(self._row("SELECT sort_order FROM subcategories WHERE name = 'Gold'")["sort_order"], 1)

    def test_reorder_subcategories_unknown_category_404(self):
        res = self.client.post("/api/categories/999/subcategories/reorder?profile_id=1", json={"order": []})
        self.assertEqual(res.status_code, 404)

    def test_reorder_subcategories_rejects_bad_order(self):
        res = self.client.post("/api/categories/1/subcategories/reorder?profile_id=1", json={"order": "x"})
        self.assertEqual(res.status_code, 400)
        res = self.client.post("/api/categories/1/subcategories/reorder?profile_id=1", json={"order": ["a"]})
        self.assertEqual(res.status_code, 400)

    def test_reorder_subcategories_rejects_aggregate_context(self):
        res = self.client.post("/api/categories/1/subcategories/reorder?aggregate_id=1", json={"order": []})
        self.assertEqual(res.status_code, 400)

    def test_reorder_categories_changes_data_order(self):
        self.client.post("/api/categories?profile_id=1", json={"name": "Crypto"})
        crypto_id = self._row("SELECT id FROM categories WHERE name = 'Crypto'")["id"]
        res = self.client.post("/api/categories/reorder?profile_id=1", json={"order": [crypto_id, 1]})
        self.assertEqual(res.status_code, 200)
        data = self.client.get("/api/categories/data?profile_id=1").get_json()
        self.assertEqual([c["name"] for c in data["categories"]], ["Crypto", "Metals"])

    # ── nesting (sub-categories inside sub-categories, any depth) ────────────────
    def _create_nested(self, name, parent_id, category_id=1, **extra):
        return self.client.post(
            f"/api/categories/{category_id}/subcategories?profile_id=1",
            json={"name": name, "parent_id": parent_id, **extra},
        )

    def _gold_tree(self):
        """Metals › Gold › Miners › Juniors, plus Metals › Silver."""
        gold = self._create_sub("Gold").get_json()["id"]
        self._create_sub("Silver")
        miners = self._create_nested("Miners", gold).get_json()["id"]
        juniors = self._create_nested("Juniors", miners).get_json()["id"]
        return gold, miners, juniors

    def test_nested_subcategories_come_back_in_tree_order_with_depth(self):
        gold, miners, juniors = self._gold_tree()
        data = self.client.get("/api/categories/data?profile_id=1").get_json()
        subs = [(s["name"], s["parent_id"], s["depth"]) for s in self._category(data)["subcategories"]]
        self.assertEqual(subs, [
            ("Gold", None, 0),
            ("Miners", gold, 1),
            ("Juniors", miners, 2),
            ("Silver", None, 0),
        ])

    def test_same_name_allowed_under_different_parents_but_not_siblings(self):
        gold, _, _ = self._gold_tree()
        silver = self._row("SELECT id FROM subcategories WHERE name = 'Silver'")["id"]
        self.assertEqual(self._create_nested("Miners", silver).status_code, 200)
        self.assertEqual(self._create_nested("Miners", gold).status_code, 409)

    def test_parent_from_another_category_is_rejected(self):
        self.client.post("/api/categories?profile_id=1", json={"name": "Crypto"})
        crypto_id = self._row("SELECT id FROM categories WHERE name = 'Crypto'")["id"]
        gold = self._create_sub("Gold").get_json()["id"]
        res = self._create_nested("Coins", gold, category_id=crypto_id)
        self.assertEqual(res.status_code, 404)

    def test_filtering_by_a_parent_includes_nested_holdings(self):
        gold, miners, juniors = self._gold_tree()
        self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": 1, "subcategory_id": juniors, "tickers": ["GLD"]},
        )
        self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": 1, "subcategory_id": gold, "tickers": ["SLV"]},
        )
        conn = self._get_connection()
        try:
            self.assertEqual(app_module._subcategory_ticker_set(conn, [1], [gold]), {"GLD", "SLV"})
            self.assertEqual(app_module._subcategory_ticker_set(conn, [1], [miners]), {"GLD"})
            self.assertEqual(
                app_module._expand_subcategory_ids(conn, [1], [miners]), sorted([miners, juniors]),
            )
        finally:
            conn.close()

    def test_holding_rows_get_their_subcategory_path(self):
        gold, miners, juniors = self._gold_tree()
        conn = self._get_connection()
        try:
            rows = app_module._attach_subcategory_paths(
                conn, [1], [{"ticker": "GLD", "subcategory_id": juniors}, {"ticker": "X", "subcategory_id": None}],
            )
        finally:
            conn.close()
        self.assertEqual(rows[0]["subcategory_path_ids"], [gold, miners, juniors])
        self.assertEqual(rows[0]["subcategory_path"], ["Gold", "Miners", "Juniors"])
        self.assertEqual(rows[1]["subcategory_path_ids"], [])

    def test_deleting_a_middle_level_moves_its_holdings_up_one_level(self):
        gold, miners, juniors = self._gold_tree()
        self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": 1, "subcategory_id": juniors, "tickers": ["GLD"]},
        )
        res = self.client.delete(f"/api/subcategories/{miners}?profile_id=1")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(self._row("SELECT id FROM subcategories WHERE id IN (?, ?)", (miners, juniors)))
        row = self._row("SELECT category_id, subcategory_id FROM ticker_categories WHERE ticker = 'GLD'")
        self.assertEqual((row["category_id"], row["subcategory_id"]), (1, gold))

    def test_deleting_a_top_level_branch_keeps_holdings_in_the_category(self):
        gold, _, juniors = self._gold_tree()
        self.client.post(
            "/api/categories/assign?profile_id=1",
            json={"category_id": 1, "subcategory_id": juniors, "tickers": ["GLD"]},
        )
        self.client.delete(f"/api/subcategories/{gold}?profile_id=1")
        row = self._row("SELECT category_id, subcategory_id FROM ticker_categories WHERE ticker = 'GLD'")
        self.assertEqual((row["category_id"], row["subcategory_id"]), (1, None))
        self.assertEqual(self._row("SELECT COUNT(*) AS n FROM subcategories")["n"], 1)  # Silver

    def test_reorder_works_among_nested_siblings(self):
        gold, miners, _ = self._gold_tree()
        royalties = self._create_nested("Royalties", gold).get_json()["id"]
        self.client.post(
            "/api/categories/1/subcategories/reorder?profile_id=1", json={"order": [royalties, miners]},
        )
        data = self.client.get("/api/categories/data?profile_id=1").get_json()
        names = [s["name"] for s in self._category(data)["subcategories"]]
        self.assertEqual(names, ["Gold", "Royalties", "Miners", "Juniors", "Silver"])

    def test_old_database_gains_nesting_without_losing_assignments(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        conn = sqlite3.connect(tmp.name)
        conn.row_factory = sqlite3.Row
        try:
            # The pre-nesting table, with its category-wide UNIQUE name rule.
            conn.execute("""
                CREATE TABLE subcategories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL,
                    name TEXT NOT NULL, target_pct REAL, profile_id INTEGER NOT NULL DEFAULT 1,
                    sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE (category_id, name, profile_id)
                )
            """)
            conn.execute("INSERT INTO subcategories (id, category_id, name, profile_id) VALUES (7, 1, 'Gold', 1)")
            conn.commit()
            database.ensure_tables_exist(conn)
            cols = {r[1] for r in conn.execute("PRAGMA table_info(subcategories)").fetchall()}
            self.assertIn("parent_id", cols)
            self.assertEqual(conn.execute("SELECT name FROM subcategories WHERE id = 7").fetchone()[0], "Gold")
            conn.execute("INSERT INTO subcategories (category_id, parent_id, name, profile_id) VALUES (1, 7, 'Gold', 1)")
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO subcategories (category_id, parent_id, name, profile_id) VALUES (1, NULL, 'Gold', 1)")
        finally:
            conn.close()
            try:
                Path(tmp.name).unlink(missing_ok=True)
            except PermissionError:
                pass

    # ── copy categories to other accounts ────────────────────────────────────────
    # Copying the category *shell* into any account. Strictly additive: an
    # account's own categories, targets and ticker assignments are never touched.
    def _seed_account(self, pid=2, name="Sub", include_in_owner=1):
        conn = self._get_connection()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO profiles (id, name, include_in_owner) VALUES (?, ?, ?)",
                (pid, name, include_in_owner),
            )
            conn.commit()
        finally:
            conn.close()

    def _copy(self, profile_id=1, **body):
        payload = {"category_ids": [1], "target_profile_ids": [2]}
        payload.update(body)
        return self.client.post(
            f"/api/categories/copy-to-accounts?profile_id={profile_id}", json=payload
        )

    def _subs(self, profile_id):
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT name, target_pct FROM subcategories WHERE profile_id = ? ORDER BY name",
                (profile_id,),
            ).fetchall()
            return [(r["name"], r["target_pct"]) for r in rows]
        finally:
            conn.close()

    def test_copy_creates_category_and_subcategories(self):
        self._create_sub("Gold")
        self._create_sub("Silver")
        self._seed_account(pid=2)
        res = self._copy()
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(self._row("SELECT id FROM categories WHERE name='Metals' AND profile_id=2"))
        self.assertEqual([n for n, _ in self._subs(2)], ["Gold", "Silver"])

    def test_copy_omits_targets_by_default(self):
        self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "Gold", "target_pct": 60})
        self._seed_account(pid=2)
        self._copy()
        # Source Metals has target 10 and Gold has 60; neither travels unless asked.
        self.assertIsNone(self._row("SELECT target_pct FROM categories WHERE name='Metals' AND profile_id=2")["target_pct"])
        self.assertEqual(self._subs(2), [("Gold", None)])

    def test_copy_include_targets_carries_percentages(self):
        self.client.post("/api/categories/1/subcategories?profile_id=1", json={"name": "Gold", "target_pct": 60})
        self._seed_account(pid=2)
        self._copy(include_targets=True)
        self.assertEqual(self._row("SELECT target_pct FROM categories WHERE name='Metals' AND profile_id=2")["target_pct"], 10)
        self.assertEqual(self._subs(2), [("Gold", 60)])

    def test_copy_skips_existing_category_and_keeps_its_target(self):
        self._seed_account(pid=2)
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, target_pct, profile_id, sort_order) VALUES ('Metals', 99, 2, 5)")
            conn.commit()
        finally:
            conn.close()
        res = self._copy(include_targets=True)
        # The account's own target survives even though the source says 10.
        self.assertEqual(self._row("SELECT target_pct FROM categories WHERE name='Metals' AND profile_id=2")["target_pct"], 99)
        self.assertEqual(res.get_json()["categories_skipped"], 1)
        self.assertEqual(res.get_json()["categories_created"], 0)

    def test_copy_matches_existing_category_regardless_of_case(self):
        # UNIQUE(name, profile_id) is case-sensitive, so a plain "=" match would
        # create "Metals" alongside the account's own "metals" — a duplicate bucket.
        self._create_sub("Gold")
        self._seed_account(pid=2)
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, target_pct, profile_id, sort_order) VALUES ('metals', 42, 2, 0)")
            cat2 = conn.execute("SELECT id FROM categories WHERE name='metals' AND profile_id=2").fetchone()["id"]
            conn.execute("INSERT INTO subcategories (category_id, name, profile_id) VALUES (?, 'gold', 2)", (cat2,))
            conn.commit()
        finally:
            conn.close()
        res = self._copy()
        conn = self._get_connection()
        try:
            names = [r["name"] for r in conn.execute(
                "SELECT name FROM categories WHERE profile_id = 2"
            ).fetchall()]
        finally:
            conn.close()
        self.assertEqual(names, ["metals"])                    # no duplicate created
        self.assertEqual(self._subs(2), [("gold", None)])      # no duplicate sub-category
        self.assertEqual(res.get_json()["categories_skipped"], 1)
        self.assertEqual(self._row("SELECT target_pct FROM categories WHERE profile_id=2")["target_pct"], 42)

    def test_copy_adds_missing_subcategories_without_deleting_others(self):
        self._create_sub("Gold")
        self._seed_account(pid=2)
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, target_pct, profile_id, sort_order) VALUES ('Metals', 99, 2, 0)")
            cat2 = conn.execute("SELECT id FROM categories WHERE name='Metals' AND profile_id=2").fetchone()["id"]
            conn.execute("INSERT INTO subcategories (category_id, name, profile_id) VALUES (?, 'Platinum', 2)", (cat2,))
            conn.commit()
        finally:
            conn.close()
        self._copy()
        # Platinum is not in the source but must survive; Gold is added alongside it.
        self.assertEqual([n for n, _ in self._subs(2)], ["Gold", "Platinum"])

    def test_copy_never_touches_ticker_assignments(self):
        self._create_sub("Gold")
        self._seed_account(pid=2)
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, target_pct, profile_id, sort_order) VALUES ('Metals', 5, 2, 0)")
            cat2 = conn.execute("SELECT id FROM categories WHERE name='Metals' AND profile_id=2").fetchone()["id"]
            conn.execute("INSERT INTO subcategories (category_id, name, profile_id) VALUES (?, 'Gold', 2)", (cat2,))
            gold2 = conn.execute("SELECT id FROM subcategories WHERE name='Gold' AND profile_id=2").fetchone()["id"]
            conn.execute(
                "INSERT INTO ticker_categories (ticker, category_id, subcategory_id, profile_id) VALUES ('IAU', ?, ?, 2)",
                (cat2, gold2),
            )
            conn.commit()
        finally:
            conn.close()
        self._copy()
        row = self._row("SELECT category_id, subcategory_id FROM ticker_categories WHERE ticker='IAU' AND profile_id=2")
        self.assertEqual((row["category_id"], row["subcategory_id"]), (cat2, gold2))
        # The source's own tickers are not pushed into the target account.
        self.assertIsNone(self._row("SELECT ticker FROM ticker_categories WHERE ticker='GLD' AND profile_id=2"))

    def test_copy_skips_subcategories_when_not_requested(self):
        self._create_sub("Gold")
        self._seed_account(pid=2)
        self._copy(include_subcategories=False)
        self.assertEqual(self._subs(2), [])

    def test_copy_reaches_accounts_outside_owner_rollup(self):
        self._seed_account(pid=3, name="Excluded", include_in_owner=0)
        res = self._copy(target_profile_ids=[3])
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(self._row("SELECT id FROM categories WHERE name='Metals' AND profile_id=3"))

    def test_copy_works_from_a_non_owner_account(self):
        self._seed_account(pid=2)
        self._seed_account(pid=3, name="Third")
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, profile_id, sort_order) VALUES ('Growth', 2, 0)")
            cat2 = conn.execute("SELECT id FROM categories WHERE name='Growth' AND profile_id=2").fetchone()["id"]
            conn.commit()
        finally:
            conn.close()
        res = self._copy(profile_id=2, category_ids=[cat2], target_profile_ids=[3])
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(self._row("SELECT id FROM categories WHERE name='Growth' AND profile_id=3"))

    def test_copy_appends_without_disturbing_existing_sort_order(self):
        self._seed_account(pid=2)
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, profile_id, sort_order) VALUES ('Income', 2, 0)")
            conn.commit()
        finally:
            conn.close()
        self._copy()
        self.assertEqual(self._row("SELECT sort_order FROM categories WHERE name='Income' AND profile_id=2")["sort_order"], 0)
        self.assertEqual(self._row("SELECT sort_order FROM categories WHERE name='Metals' AND profile_id=2")["sort_order"], 1)

    def test_copy_carries_the_nested_tree_and_is_idempotent(self):
        self._seed_account(pid=2)
        self._gold_tree()
        self.assertEqual(self._copy().status_code, 200)
        conn = self._get_connection()
        try:
            def tree():
                rows = app_module._subcategory_rows(conn, [2])
                return [(s["name"], s["depth"]) for s in rows]
            self.assertEqual(tree(), [("Gold", 0), ("Miners", 1), ("Juniors", 2), ("Silver", 0)])
            # A second copy finds every level already there and adds nothing.
            body = self._copy().get_json()
            self.assertEqual(body["subcategories_created"], 0)
            self.assertEqual(tree(), [("Gold", 0), ("Miners", 1), ("Juniors", 2), ("Silver", 0)])
        finally:
            conn.close()

    def test_copy_targets_key_nested_subcategories_by_path(self):
        self._seed_account(pid=2)
        self._gold_tree()
        self._copy()
        body = self.client.get("/api/categories/copy-targets?profile_id=1").get_json()
        keys = next(a for a in body["accounts"] if a["id"] == 2)["subcategory_keys"]
        self.assertIn("Metals›Gold›Miners›Juniors", keys)
        self.assertIn("Metals›Silver", keys)

    def test_copy_requires_a_category(self):
        self._seed_account(pid=2)
        self.assertEqual(self._copy(category_ids=[]).status_code, 400)

    def test_copy_requires_a_target_account(self):
        self._seed_account(pid=2)
        self.assertEqual(self._copy(target_profile_ids=[]).status_code, 400)

    def test_copy_rejects_copying_onto_itself(self):
        self.assertEqual(self._copy(target_profile_ids=[1]).status_code, 400)

    def test_copy_rejects_categories_from_another_account(self):
        self._seed_account(pid=2)
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (id, name, profile_id, sort_order) VALUES (77, 'Foreign', 2, 0)")
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(self._copy(category_ids=[77]).status_code, 404)

    def test_copy_rejected_on_an_aggregate_view(self):
        self._seed_account(pid=2)
        res = self.client.post(
            "/api/categories/copy-to-accounts?profile_id=1&aggregate_id=1",
            json={"category_ids": [1], "target_profile_ids": [2]},
        )
        self.assertEqual(res.status_code, 400)

    # ── copy targets listing ─────────────────────────────────────────────────────
    def test_copy_targets_lists_other_accounts_with_their_categories(self):
        self._seed_account(pid=2)
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO categories (name, profile_id, sort_order) VALUES ('Income', 2, 0)")
            cat2 = conn.execute("SELECT id FROM categories WHERE name='Income' AND profile_id=2").fetchone()["id"]
            conn.execute("INSERT INTO subcategories (category_id, name, profile_id) VALUES (?, 'REITs', 2)", (cat2,))
            conn.commit()
        finally:
            conn.close()
        body = self.client.get("/api/categories/copy-targets?profile_id=1").get_json()
        self.assertEqual([a["id"] for a in body["accounts"]], [2])
        acct = body["accounts"][0]
        self.assertEqual(acct["category_names"], ["Income"])
        self.assertEqual(acct["subcategory_keys"], ["Income›REITs"])

    def test_copy_targets_excludes_the_current_account(self):
        self._seed_account(pid=2)
        body = self.client.get("/api/categories/copy-targets?profile_id=2").get_json()
        self.assertEqual([a["id"] for a in body["accounts"]], [1])


class TickerCategorySchemaMigrationTest(unittest.TestCase):
    def test_migration_collapses_duplicate_ticker_assignments(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        db_path = tmp.name
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute(
                "CREATE TABLE profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE categories ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "name TEXT NOT NULL, target_pct REAL, profile_id INTEGER NOT NULL DEFAULT 1, "
                "sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE (name, profile_id))"
            )
            conn.execute(
                "CREATE TABLE ticker_categories ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, "
                "category_id INTEGER NOT NULL, profile_id INTEGER NOT NULL DEFAULT 1, "
                "subcategory_id INTEGER, UNIQUE (ticker, category_id, profile_id))"
            )
            conn.execute("INSERT INTO profiles (id, name) VALUES (1, 'Owner')")
            conn.execute(
                "INSERT INTO categories (id, name, profile_id, sort_order) VALUES (1, 'Metals', 1, 0)"
            )
            conn.execute(
                "INSERT INTO categories (id, name, profile_id, sort_order) VALUES (2, 'Equity', 1, 1)"
            )
            conn.execute(
                "INSERT INTO ticker_categories (id, ticker, category_id, profile_id) VALUES (1, 'GLD', 1, 1)"
            )
            conn.execute(
                "INSERT INTO ticker_categories (id, ticker, category_id, profile_id) VALUES (2, 'GLD', 2, 1)"
            )
            conn.commit()

            database.ensure_tables_exist(conn)

            rows = conn.execute(
                "SELECT ticker, category_id FROM ticker_categories WHERE ticker = 'GLD' AND profile_id = 1"
            ).fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["category_id"], 2)
        finally:
            conn.close()
            try:
                Path(db_path).unlink(missing_ok=True)
            except PermissionError:
                pass


if __name__ == "__main__":
    unittest.main()
