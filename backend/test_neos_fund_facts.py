"""NEOS funds read their AUM from neosfunds.com, not the stale seed catalog.

The bundled ETF provider catalog is a point-in-time StockAnalysis snapshot. For
fast-growing NEOS funds it was months behind -- MLPI read $46M against NEOS's
$943M and the Boosted XSPI/XQQI/XBCI a fifth to a third of their size -- so the
dashboard and Action Center flagged them for closure.
"""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


def _profile(assets, expense=0.68, inception="2025-12-17"):
    return {
        "total_assets": assets,
        "expense_ratio_pct": expense,
        "inception_date": inception,
        "source_url": "https://neosfunds.com/mlpi/",
        "data_source": "NEOS Investments",
    }


class NeosFundFactsTest(unittest.TestCase):
    def setUp(self):
        app_module._NEOS_FUND_FACTS_CACHE.clear()
        app_module._NEOS_FUND_FACTS_MISSES.clear()
        self.store = {}
        self.persisted_is_fresh = True

        def persist(source, ticker, kind, payload):
            self.store[(source, ticker, kind)] = dict(payload)

        def load(source, ticker, kind, ttl=None):
            if ttl is not None and not self.persisted_is_fresh:
                return None
            return self.store.get((source, ticker, kind))

        for name, fake in (
            ("_persist_market_payload", persist),
            ("_load_persisted_market_payload", load),
        ):
            patcher = patch.object(app_module, name, side_effect=fake)
            patcher.start()
            self.addCleanup(patcher.stop)

    def tearDown(self):
        app_module._NEOS_FUND_FACTS_CACHE.clear()
        app_module._NEOS_FUND_FACTS_MISSES.clear()

    def test_footnoted_label_still_parses(self):
        # HYBI's page footnotes its labels, which used to blank its expense ratio.
        html = (
            '<td class="fund-details-table-sizing" style="x;">'
            "Total Annual Fund Operating Expenses*</td>\n"
            '<td class="fund-details-table-sizing" style="text-align: right;">0.72%</td>'
        )
        self.assertEqual(
            app_module._neos_detail_value(html, "Total Annual Fund Operating Expenses"),
            "0.72%",
        )

    def test_issuer_net_assets_are_fetched_once_then_cached(self):
        with patch.object(
            app_module, "_fetch_neos_etf_profile", return_value=_profile(942_596_775.0)
        ) as fetch:
            first = app_module._neos_official_fund_facts("mlpi")
            second = app_module._neos_official_fund_facts("MLPI")

        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(first["assets"], 942_596_775.0)
        self.assertEqual(first["exp_ratio"], 0.68)
        self.assertEqual(first["inception_date"], "2025-12-17")
        self.assertEqual(first["source"], "NEOS Investments")
        self.assertEqual(second["assets"], first["assets"])
        self.assertIn(("neos", "MLPI", "fund_facts"), self.store)

    def test_failed_fetch_keeps_the_last_good_figures(self):
        with patch.object(
            app_module, "_fetch_neos_etf_profile", return_value=_profile(942_596_775.0)
        ):
            app_module._neos_official_fund_facts("MLPI")

        # Next session: memory is cold, the persisted copy is past its TTL,
        # and the site is down.
        app_module._NEOS_FUND_FACTS_CACHE.clear()
        self.persisted_is_fresh = False
        with patch.object(app_module, "_fetch_neos_etf_profile", return_value=None) as fetch:
            during_outage = app_module._neos_official_fund_facts("MLPI")
            again = app_module._neos_official_fund_facts("MLPI")

        self.assertEqual(during_outage["assets"], 942_596_775.0)
        self.assertEqual(again["assets"], 942_596_775.0)
        # The miss is remembered, so an outage isn't refetched on every load.
        self.assertEqual(fetch.call_count, 1)

    def test_no_figures_at_all_returns_none(self):
        with patch.object(app_module, "_fetch_neos_etf_profile", return_value=None):
            self.assertIsNone(app_module._neos_official_fund_facts("XSPI"))

    def test_non_neos_symbols_are_never_fetched(self):
        with patch.object(app_module, "_fetch_neos_etf_profile") as fetch:
            self.assertEqual(app_module._neos_fund_facts_batch(["SCHD", "AAPL", ""]), {})
            self.assertIsNone(app_module._neos_official_fund_facts("SCHD"))
        fetch.assert_not_called()

    def test_batch_covers_every_boosted_fund(self):
        issuer = {
            "XSPI": 114_269_183.0,
            "XQQI": 367_817_531.0,
            "XBCI": 190_332_081.0,
        }
        with patch.object(
            app_module,
            "_fetch_neos_etf_profile",
            side_effect=lambda t: _profile(issuer[t], expense=0.98, inception="2026-02-02"),
        ):
            facts = app_module._neos_fund_facts_batch(["XSPI", "XQQI", "XBCI", "SCHD"])

        self.assertEqual({t: f["assets"] for t, f in facts.items()}, issuer)

    def test_closure_rating_uses_issuer_aum_over_the_stale_catalog(self):
        catalog = {"MLPI": {"assets": 46_380_000.0, "exp_ratio": 0.68}}
        stale = app_module._ticker_closure_risk_from_local_sources(["MLPI"], catalog)
        self.assertEqual(stale["MLPI"]["aum"], 46_380_000.0)

        with patch.object(
            app_module, "_fetch_neos_etf_profile", return_value=_profile(942_596_775.0)
        ):
            facts = app_module._overlay_neos_fund_facts(catalog, ["MLPI"])
        risk = app_module._ticker_closure_risk_from_local_sources(["MLPI"], facts)["MLPI"]

        self.assertEqual(risk["tier"], "ok")
        self.assertEqual(risk["aum"], 942_596_775.0)
        self.assertEqual(risk["aum_source"], "NEOS Investments")
        self.assertIn("AUM from NEOS Investments.", risk["reason"])

    def test_catalog_rows_without_an_issuer_figure_are_unchanged(self):
        catalog = {"MLPI": {"assets": 46_380_000.0, "exp_ratio": 0.68}}
        with patch.object(app_module, "_fetch_neos_etf_profile", return_value=None):
            facts = app_module._overlay_neos_fund_facts(catalog, ["MLPI"])
        self.assertEqual(facts, catalog)

    def test_action_center_closure_rows_use_issuer_aum(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.execute(
            "CREATE TABLE etf_provider_funds (provider_id INTEGER, symbol TEXT, assets REAL)"
        )
        conn.executemany(
            "INSERT INTO etf_provider_funds VALUES (27, ?, ?)",
            [("MLPI", 46_380_000.0), ("XSPI", 35_420_000.0), ("NLSI", None)],
        )
        issuer = {"MLPI": 942_596_775.0, "XSPI": 114_269_183.0, "NLSI": 4_541_293.0}
        with patch.object(
            app_module,
            "_fetch_neos_etf_profile",
            side_effect=lambda t: _profile(issuer[t]),
        ):
            rows = app_module._action_center_etf_closure_rows(
                conn, [{"ticker": "MLPI"}, {"ticker": "XSPI"}, {"ticker": "NLSI"}]
            )
        conn.close()

        # MLPI/XSPI were "watch" on the catalog snapshot; NEOS says they are
        # large. NLSI had no catalog AUM at all and is genuinely tiny.
        self.assertEqual(rows, [{"ticker": "NLSI", "aum": 4_541_293.0, "tier": "high"}])


class NeosFundSearchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        conn = sqlite3.connect(self.tmp.name)
        conn.executescript(
            """
            CREATE TABLE etf_providers (id INTEGER PRIMARY KEY, provider TEXT);
            CREATE TABLE etf_provider_funds (
                provider_id INTEGER, symbol TEXT, fund_name TEXT, assets REAL,
                div_yield REAL, exp_ratio REAL, change_1y REAL
            );
            INSERT INTO etf_providers VALUES (27, 'Neos');
            INSERT INTO etf_provider_funds VALUES
                (27, 'XBCI', 'NEOS Boosted Bitcoin High Income ETF', 34680000, 30, 0.98, NULL),
                (27, 'SPYI', 'NEOS S&P 500 High Income ETF', 9150000000, 12, 0.68, NULL);
            """
        )
        conn.commit()
        conn.close()
        self.orig_connection = app_module.get_connection

        def connect():
            c = sqlite3.connect(self.tmp.name)
            c.row_factory = sqlite3.Row
            return c

        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = connect
        app_module.app.testing = True
        app_module.app._db_initialized = True
        app_module._NEOS_FUND_FACTS_CACHE.clear()
        app_module._NEOS_FUND_FACTS_MISSES.clear()
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module.app.testing = self.orig_testing
        app_module.app._db_initialized = self.orig_initialized
        app_module._NEOS_FUND_FACTS_CACHE.clear()
        app_module._NEOS_FUND_FACTS_MISSES.clear()
        try:
            Path(self.tmp.name).unlink(missing_ok=True)
        except PermissionError:
            pass

    def test_provider_browse_shows_issuer_aum(self):
        issuer = {"XBCI": 190_332_081.0, "SPYI": 12_277_268_673.0}
        with patch.object(app_module, "_persist_market_payload"), patch.object(
            app_module, "_load_persisted_market_payload", return_value=None
        ), patch.object(
            app_module,
            "_fetch_neos_etf_profile",
            side_effect=lambda t: _profile(issuer[t], expense=0.98),
        ):
            response = self.client.get("/api/etf-funds/search?provider=Neos")
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)

        by_symbol = {f["symbol"]: f for f in payload["funds"]}
        self.assertEqual(by_symbol["XBCI"]["assets"], 190_332_081.0)
        self.assertEqual(by_symbol["SPYI"]["assets"], 12_277_268_673.0)


if __name__ == "__main__":
    unittest.main()
