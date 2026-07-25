"""CRUD round-trip tests for the DRIP Score set endpoints.

Uses Flask's test client against a temporary SQLite file so nothing touches the
working database. No network — these tests never call /run.
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))


_TMPDIR = None
_APP_MODULE = None


def setUpModule():
    """Point the app at a throwaway database, ONCE for the whole module.

    Deliberately module-level rather than per-class: ``app`` is imported once
    per process and holds onto the database it was configured with, so tearing
    a temp DB down between classes leaves the app pointing at a deleted file
    and every later request fails.
    """
    global _TMPDIR, _APP_MODULE
    _TMPDIR = tempfile.TemporaryDirectory()
    db_path = os.path.join(_TMPDIR.name, "test_drip.db")
    os.environ["PORTFOLIO_DB_PATH"] = db_path

    import config
    config.DB_PATH = db_path

    import app as app_module
    app_module.DB_PATH = db_path
    app_module.app.config["TESTING"] = True
    _APP_MODULE = app_module

    from database import ensure_tables_exist
    conn = config.get_connection()
    ensure_tables_exist(conn)
    conn.commit()
    conn.close()


def tearDownModule():
    os.environ.pop("PORTFOLIO_DB_PATH", None)
    if _TMPDIR is not None:
        _TMPDIR.cleanup()


class _DripApiBase(unittest.TestCase):
    """Shared fixture. Holds no tests of its own."""

    @property
    def app_module(self):
        return _APP_MODULE

    def setUp(self):
        self.client = self.app_module.app.test_client()
        import config
        conn = config.get_connection()
        for table in ("drip_score_runs", "drip_score_set_tickers", "drip_score_sets"):
            conn.execute(f"DELETE FROM {table}")
        conn.commit()
        conn.close()

    def _create(self, **overrides):
        body = {
            "name": "Weekly payers",
            "tickers": ["aapw", "CONY", " msty "],
            "start_date": "2025-06-02",
            "end_date": "2026-07-26",
            "cash_rate": 0.04,
            "initial_investment": 50000,
            "partial_data": "include",
        }
        body.update(overrides)
        return self.client.post("/api/drip-score/sets", json=body)


class DripScoreSetApiTest(_DripApiBase):
    """Set CRUD."""

    def test_create_normalises_tickers_and_returns_the_set(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 201)
        data = resp.get_json()["set"]
        self.assertEqual(data["tickers"], ["AAPW", "CONY", "MSTY"])
        self.assertEqual(data["name"], "Weekly payers")
        self.assertEqual(data["partial_data"], "include")

    def test_ticker_order_is_preserved_across_a_round_trip(self):
        set_id = self._create(tickers=["ZZZ", "AAA", "MMM"]).get_json()["set"]["id"]
        got = self.client.get(f"/api/drip-score/sets/{set_id}").get_json()["set"]
        self.assertEqual(got["tickers"], ["ZZZ", "AAA", "MMM"])

    def test_duplicate_tickers_are_collapsed(self):
        resp = self._create(tickers=["QQQI", "qqqi", "QQQI "])
        self.assertEqual(resp.get_json()["set"]["tickers"], ["QQQI"])

    def test_comma_separated_string_is_accepted(self):
        resp = self._create(tickers="AAPW, CONY MSTY")
        self.assertEqual(resp.get_json()["set"]["tickers"], ["AAPW", "CONY", "MSTY"])

    def test_list_reports_ticker_count(self):
        self._create()
        sets = self.client.get("/api/drip-score/sets").get_json()["sets"]
        self.assertEqual(len(sets), 1)
        self.assertEqual(sets[0]["ticker_count"], 3)

    def test_update_replaces_tickers_rather_than_appending(self):
        set_id = self._create().get_json()["set"]["id"]
        resp = self.client.put(f"/api/drip-score/sets/{set_id}",
                               json={"name": "Renamed", "tickers": ["SPY", "QQQ"]})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()["set"]
        self.assertEqual(data["tickers"], ["SPY", "QQQ"])
        self.assertEqual(data["name"], "Renamed")

    def test_update_without_tickers_keeps_the_existing_list(self):
        set_id = self._create().get_json()["set"]["id"]
        resp = self.client.put(f"/api/drip-score/sets/{set_id}",
                               json={"cash_rate": 0.05})
        data = resp.get_json()["set"]
        self.assertEqual(data["tickers"], ["AAPW", "CONY", "MSTY"])
        self.assertAlmostEqual(data["cash_rate"], 0.05)

    def test_update_clears_the_stale_cached_run(self):
        set_id = self._create().get_json()["set"]["id"]
        import config
        conn = config.get_connection()
        conn.execute(
            "INSERT INTO drip_score_runs (set_id, params_json, rows_json) "
            "VALUES (?, '{}', '{}')", (set_id,))
        conn.commit()
        conn.close()

        resp = self.client.put(
            f"/api/drip-score/sets/{set_id}",
            json={"tickers": ["SPY", "QQQ"]})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/drip-score/sets/{set_id}/last-run").status_code,
            404)

    def test_delete_removes_the_set_and_its_tickers(self):
        set_id = self._create().get_json()["set"]["id"]
        self.assertEqual(
            self.client.delete(f"/api/drip-score/sets/{set_id}").status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/drip-score/sets/{set_id}").status_code, 404)

        import config
        conn = config.get_connection()
        orphans = conn.execute(
            "SELECT COUNT(*) FROM drip_score_set_tickers WHERE set_id = ?",
            (set_id,)).fetchone()[0]
        conn.close()
        self.assertEqual(orphans, 0, "child rows must be deleted explicitly")

    def test_duplicate_name_is_rejected_with_409(self):
        self._create()
        resp = self._create()
        self.assertEqual(resp.status_code, 409)
        self.assertIn("already exists", resp.get_json()["error"])

    def test_validation_rejects_bad_input(self):
        cases = [
            ({"name": ""}, "name"),
            ({"tickers": []}, "ticker"),
            ({"partial_data": "maybe"}, "partial_data"),
            ({"cash_rate": 5}, "cash_rate"),
            ({"initial_investment": 0}, "initial_investment"),
            ({"cash_rate": "abc"}, "numbers"),
        ]
        for overrides, expected in cases:
            resp = self._create(**overrides)
            self.assertEqual(resp.status_code, 400, f"{overrides} should be rejected")
            self.assertIn(expected.lower(), resp.get_json()["error"].lower())

    def test_too_many_tickers_is_rejected(self):
        import drip_score
        many = [f"T{i:03d}" for i in range(drip_score.MAX_TICKERS + 1)]
        resp = self._create(tickers=many)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("max", resp.get_json()["error"].lower())

    def test_missing_set_returns_404(self):
        self.assertEqual(self.client.get("/api/drip-score/sets/99999").status_code, 404)
        self.assertEqual(self.client.put("/api/drip-score/sets/99999",
                                         json={"name": "x"}).status_code, 404)
        self.assertEqual(
            self.client.delete("/api/drip-score/sets/99999").status_code, 404)


def _fake_result(tickers=("AAPW",)):
    return {
        "meta": {"start_date": "2025-06-02", "end_date": "2026-07-26", "years": 1.15,
                 "cash_rate": 0.04, "initial_investment": 50000.0,
                 "partial_data": "include", "requested": len(tickers)},
        "rows": [{"ticker": t, "opportunity": 90.0, "bucket": "Compounder",
                  "drip_call": "DRIP", "re": 1.28} for t in tickers],
        "partial": [],
        "excluded": [],
    }


class DripScoreRunApiTest(_DripApiBase):
    """Run endpoint. ``run_drip_score`` is patched so nothing hits the network."""

    def _patch_run(self, result=None, side_effect=None):
        import drip_score
        return patch.object(drip_score, "run_drip_score",
                            side_effect=side_effect,
                            return_value=result or _fake_result())

    def test_run_with_inline_tickers(self):
        with self._patch_run() as mock_run:
            resp = self.client.post("/api/drip-score/run", json={
                "tickers": ["aapw"], "start_date": "2025-06-02",
                "end_date": "2026-07-26", "cash_rate": 0.04,
                "initial_investment": 50000, "partial_data": "include"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(mock_run.call_args.args[0], ["AAPW"])
        self.assertEqual(resp.get_json()["rows"][0]["ticker"], "AAPW")

    def test_run_inherits_parameters_from_a_saved_set(self):
        set_id = self._create(tickers=["AAPW", "CONY"],
                              cash_rate=0.03).get_json()["set"]["id"]
        with self._patch_run(_fake_result(("AAPW", "CONY"))) as mock_run:
            resp = self.client.post("/api/drip-score/run", json={"set_id": set_id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(mock_run.call_args.args[0], ["AAPW", "CONY"])
        self.assertAlmostEqual(mock_run.call_args.kwargs["cash_rate"], 0.03)

    def test_run_body_overrides_saved_set_parameters(self):
        set_id = self._create(cash_rate=0.03).get_json()["set"]["id"]
        with self._patch_run(_fake_result(("AAPW", "CONY", "MSTY"))) as mock_run:
            self.client.post("/api/drip-score/run",
                             json={"set_id": set_id, "cash_rate": 0.06})
        self.assertAlmostEqual(mock_run.call_args.kwargs["cash_rate"], 0.06)

    def test_run_attaches_fund_names_from_seed_data(self):
        # Let the provider id autoincrement and use a symbol the bundled seed
        # data cannot already contain: hardcoding an id collides with the seed,
        # and an escaping IntegrityError would leave a write txn holding the
        # database lock for the rest of the run.
        import config
        conn = config.get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO etf_providers (provider) VALUES ('TestCo')")
            conn.execute(
                "INSERT INTO etf_provider_funds (provider_id, symbol, fund_name) "
                "VALUES (?, ?, ?)",
                (cur.lastrowid, "ZTST", "Test Weekly Income ETF"))
            conn.commit()
        finally:
            conn.close()

        with self._patch_run(_fake_result(("ZTST",))):
            resp = self.client.post("/api/drip-score/run", json={
                "tickers": ["ZTST"], "start_date": "2025-06-02",
                "end_date": "2026-07-26"})
        self.assertEqual(resp.get_json()["rows"][0]["name"],
                         "Test Weekly Income ETF")

    def test_holdings_description_is_the_fallback_name(self):
        import config
        conn = config.get_connection()
        try:
            conn.execute(
                "INSERT INTO holdings (ticker, profile_id, description) "
                "VALUES ('ZHLD', 1, 'BROKER ALL CAPS NAME')")
            conn.commit()
        finally:
            conn.close()

        with self._patch_run(_fake_result(("ZHLD",))):
            resp = self.client.post("/api/drip-score/run", json={
                "tickers": ["ZHLD"], "start_date": "2025-06-02",
                "end_date": "2026-07-26"})
        self.assertEqual(resp.get_json()["rows"][0]["name"], "BROKER ALL CAPS NAME")

    def test_unknown_ticker_gets_a_null_name_rather_than_failing(self):
        with self._patch_run(_fake_result(("ZZZZ",))):
            resp = self.client.post("/api/drip-score/run", json={
                "tickers": ["ZZZZ"], "start_date": "2025-06-02",
                "end_date": "2026-07-26"})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.get_json()["rows"][0]["name"])

    def test_run_caches_the_result_for_a_saved_set(self):
        set_id = self._create().get_json()["set"]["id"]
        self.assertEqual(
            self.client.get(f"/api/drip-score/sets/{set_id}/last-run").status_code, 404)

        with self._patch_run():
            self.client.post("/api/drip-score/run", json={"set_id": set_id})

        cached = self.client.get(f"/api/drip-score/sets/{set_id}/last-run")
        self.assertEqual(cached.status_code, 200)
        body = cached.get_json()
        self.assertEqual(body["rows"][0]["ticker"], "AAPW")
        self.assertEqual(body["meta"]["cash_rate"], 0.04)
        self.assertTrue(body["run_at"])

    def test_only_the_latest_run_is_cached(self):
        set_id = self._create().get_json()["set"]["id"]
        for _ in range(3):
            with self._patch_run():
                self.client.post("/api/drip-score/run", json={"set_id": set_id})

        import config
        conn = config.get_connection()
        count = conn.execute("SELECT COUNT(*) FROM drip_score_runs WHERE set_id = ?",
                             (set_id,)).fetchone()[0]
        conn.close()
        self.assertEqual(count, 1)

    def test_deleting_a_set_clears_its_cached_run(self):
        set_id = self._create().get_json()["set"]["id"]
        with self._patch_run():
            self.client.post("/api/drip-score/run", json={"set_id": set_id})
        self.client.delete(f"/api/drip-score/sets/{set_id}")

        import config
        conn = config.get_connection()
        count = conn.execute("SELECT COUNT(*) FROM drip_score_runs WHERE set_id = ?",
                             (set_id,)).fetchone()[0]
        conn.close()
        self.assertEqual(count, 0)

    def test_an_ad_hoc_run_is_not_cached(self):
        with self._patch_run():
            self.client.post("/api/drip-score/run", json={
                "tickers": ["AAPW"], "start_date": "2025-06-02",
                "end_date": "2026-07-26"})
        import config
        conn = config.get_connection()
        count = conn.execute("SELECT COUNT(*) FROM drip_score_runs").fetchone()[0]
        conn.close()
        self.assertEqual(count, 0)

    def test_engine_value_error_becomes_a_400(self):
        with self._patch_run(side_effect=ValueError("window must be at least 120 days")):
            resp = self.client.post("/api/drip-score/run", json={
                "tickers": ["AAPW"], "start_date": "2026-07-01",
                "end_date": "2026-07-26"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("120 days", resp.get_json()["error"])

    def test_engine_crash_becomes_a_500(self):
        with self._patch_run(side_effect=RuntimeError("yfinance exploded")):
            resp = self.client.post("/api/drip-score/run", json={
                "tickers": ["AAPW"], "start_date": "2025-06-02",
                "end_date": "2026-07-26"})
        self.assertEqual(resp.status_code, 500)
        self.assertIn("yfinance exploded", resp.get_json()["error"])

    def test_detail_returns_schedule_and_summary(self):
        import drip_score
        fake = {"summary": {"ticker": "AAPW", "tr_full": 0.53},
                "schedule": [{"date": "2025-06-10", "price": 36.0}]}
        with patch.object(drip_score, "run_detail", return_value=fake) as mock:
            resp = self.client.get("/api/drip-score/detail?ticker=aapw"
                                   "&start_date=2025-06-02&end_date=2026-07-26"
                                   "&cash_rate=0.04&initial_investment=50000")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(mock.call_args.args[0], "AAPW")
        self.assertAlmostEqual(mock.call_args.kwargs["cash_rate"], 0.04)
        body = resp.get_json()
        self.assertEqual(len(body["schedule"]), 1)
        self.assertIn("name", body["summary"])

    def test_detail_validates_its_inputs(self):
        base = "/api/drip-score/detail?start_date=2025-06-02&end_date=2026-07-26"
        self.assertEqual(self.client.get(base).status_code, 400)
        self.assertEqual(
            self.client.get("/api/drip-score/detail?ticker=AAPW").status_code, 400)
        self.assertEqual(
            self.client.get(base + "&ticker=AAPW&cash_rate=9").status_code, 400)

    def test_detail_surfaces_engine_errors(self):
        import drip_score
        with patch.object(drip_score, "run_detail",
                          side_effect=ValueError("No price history for ZZZ")):
            resp = self.client.get("/api/drip-score/detail?ticker=ZZZ"
                                   "&start_date=2025-06-02&end_date=2026-07-26")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No price history", resp.get_json()["error"])

    def test_run_rejects_missing_dates_and_unknown_sets(self):
        with self._patch_run():
            resp = self.client.post("/api/drip-score/run", json={"tickers": ["AAPW"]})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("dates", resp.get_json()["error"].lower())

        resp = self.client.post("/api/drip-score/run", json={"set_id": 99999})
        self.assertEqual(resp.status_code, 404)

        resp = self.client.post("/api/drip-score/run", json={"tickers": []})
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
