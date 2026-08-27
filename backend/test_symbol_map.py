"""Broker symbol -> Yahoo symbol translation.

Broker exports carry symbols Yahoo does not use, and a holding Yahoo cannot
price gets no grade and no NAV score. The broker spelling stays the identity
everywhere in the app; the translation applies only at the moment of the call
and is undone before the caller sees the result.

Two sources feed the translation, checked in that order (see `_yahoo_symbol`):
`market_symbols.yahoo_symbol_for_ticker` — the existing, developer-curated
static map (BRK-A/B, the generic XXX-PR<Y> preferred-share pattern, and
ticker renames via the accounting-alias table) — already used at 20+ call
sites in this file, and covered by its own tests in
test_holdings_transactions.py. Then the `symbol_map` DB table this feature
adds, for what has no pattern to derive: a non-US listing a broker exports
without its exchange suffix.
"""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class SymbolCandidateTest(unittest.TestCase):
    """`_yahoo_symbol_candidates` covers only what the static map can't: a
    plain listing exported without its exchange suffix. Preferred-share and
    share-class patterns are the static map's job (asserted in
    SymbolTranslationTest.test_defers_to_the_static_map_first below) and are
    deliberately NOT regenerated here.
    """

    def test_bare_symbol_gets_exchange_suffixes(self):
        candidates = app_module._yahoo_symbol_candidates("PGDC")
        self.assertIn("PGDC.V", candidates)
        self.assertIn("PGDC.TO", candidates)
        self.assertLess(
            candidates.index("PGDC.V"), candidates.index("PGDC.TO"),
            "TSX Venture is the more common broker-bare listing, so try it first",
        )

    def test_symbol_that_already_carries_a_suffix_is_left_alone(self):
        self.assertEqual(app_module._yahoo_symbol_candidates("PGDC.V"), [])

    def test_symbol_the_static_map_already_resolves_is_left_alone(self):
        # No point guessing exchange suffixes onto something the static,
        # pattern-based map already has a real answer for.
        self.assertEqual(app_module._yahoo_symbol_candidates("BRKB"), [])
        self.assertEqual(app_module._yahoo_symbol_candidates("CIM-PRB"), [])

    def test_never_suggests_itself(self):
        for symbol in ("SPY", "BRK-B", "CIM-PB"):
            self.assertNotIn(symbol, app_module._yahoo_symbol_candidates(symbol))


class SymbolTranslationTest(unittest.TestCase):
    def setUp(self):
        app_module._SYMBOL_MAP_CACHE["ts"] = float("inf")
        # Neither symbol matches a static-map pattern, so these tests exercise
        # the DB-backed path specifically, not the static one.
        app_module._SYMBOL_MAP_CACHE["map"] = {"PGDC": "PGDC.V", "SCOT": "SCOT.V"}

    def tearDown(self):
        app_module._symbol_map_invalidate()

    def test_translates_only_mapped_symbols(self):
        symbols, reverse = app_module._yahoo_symbols_for(["SPY", "PGDC", "SCOT"])
        self.assertEqual(symbols, ["SPY", "PGDC.V", "SCOT.V"])
        self.assertEqual(reverse, {"PGDC.V": "PGDC", "SCOT.V": "SCOT"})

    def test_collision_with_a_symbol_already_in_the_batch_is_skipped(self):
        """Holding both spellings, the broker symbol must keep its own column."""
        symbols, reverse = app_module._yahoo_symbols_for(["PGDC", "PGDC.V"])
        self.assertEqual(symbols, ["PGDC", "PGDC.V"])
        self.assertEqual(reverse, {})

    def test_defers_to_the_static_map_first(self):
        """The static map wins even over a (here, deliberately wrong) DB entry.

        Nothing should ever populate `symbol_map` for a symbol the static map
        already resolves (see `_yahoo_symbol_candidates`), but resolution order
        must not depend on that never happening.
        """
        app_module._SYMBOL_MAP_CACHE["map"]["CIM-PRB"] = "SOMETHING-ELSE"
        self.assertEqual(app_module._yahoo_symbol("CIM-PRB"), "CIM-PB")
        self.assertEqual(app_module._yahoo_symbol("BRKB"), "BRK-B")

    def test_static_map_resolves_a_rename_with_no_db_entry_at_all(self):
        # WPAY -> TOPW: Roundhill's ticker changed. No suffix or preferred-share
        # pattern connects the two spellings, so only the accounting-alias
        # table (consulted inside the static map) can catch this — a symbol
        # this feature's own candidate probing would never guess.
        self.assertEqual(app_module._yahoo_symbol("WPAY"), "TOPW")

    def test_restores_default_column_layout(self):
        dates = pd.bdate_range("2024-01-02", periods=3)
        frame = pd.concat(
            {"Close": pd.DataFrame({"PGDC.V": [1.0, 2.0, 3.0], "SPY": [4.0, 5.0, 6.0]}, index=dates)},
            axis=1,
        )
        restored = app_module._restore_broker_symbols(frame, {"PGDC.V": "PGDC"})
        self.assertIn("PGDC", restored["Close"].columns)
        self.assertNotIn("PGDC.V", restored["Close"].columns)
        self.assertEqual(list(restored["Close"]["PGDC"]), [1.0, 2.0, 3.0])

    def test_restores_group_by_ticker_layout(self):
        dates = pd.bdate_range("2024-01-02", periods=3)
        frame = pd.concat(
            {"PGDC.V": pd.DataFrame({"Close": [1.0, 2.0, 3.0]}, index=dates)},
            axis=1,
        )
        restored = app_module._restore_broker_symbols(frame, {"PGDC.V": "PGDC"})
        self.assertIn("PGDC", restored.columns.get_level_values(0))

    def test_restores_flat_columns(self):
        dates = pd.bdate_range("2024-01-02", periods=3)
        frame = pd.DataFrame({"PGDC.V": [1.0, 2.0, 3.0]}, index=dates)
        restored = app_module._restore_broker_symbols(frame, {"PGDC.V": "PGDC"})
        self.assertEqual(list(restored.columns), ["PGDC"])


class ChunkedDownloadTranslationTest(unittest.TestCase):
    """The round trip a caller actually depends on."""

    def setUp(self):
        app_module._SYMBOL_MAP_CACHE["ts"] = float("inf")
        app_module._SYMBOL_MAP_CACHE["map"] = {"PGDC": "PGDC.V"}

    def tearDown(self):
        app_module._symbol_map_invalidate()

    def test_caller_asks_in_broker_symbols_and_gets_them_back(self):
        dates = pd.bdate_range("2024-01-02", periods=4)
        asked = {}

        def fake_download(tickers, **kwargs):
            asked["tickers"] = tickers
            symbols = tickers if isinstance(tickers, list) else [tickers]
            close = pd.DataFrame(
                {s: np.linspace(10, 20, len(dates)) for s in symbols}, index=dates
            )
            return pd.concat({"Close": close}, axis=1)

        with patch("yfinance.download", side_effect=fake_download):
            frame = app_module._chunked_yf_download("PGDC SPY", period="1mo")

        self.assertEqual(
            sorted(asked["tickers"]), ["PGDC.V", "SPY"],
            "Yahoo must be asked for the spelling it knows",
        )
        self.assertEqual(
            sorted(frame["Close"].columns), ["PGDC", "SPY"],
            "the caller must get its own symbols back",
        )


class SymbolMapPersistenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        conn = sqlite3.connect(self.tmp.name)
        conn.execute(
            """CREATE TABLE symbol_map (
                   broker_symbol TEXT PRIMARY KEY, yahoo_symbol TEXT,
                   source TEXT, note TEXT, updated_at DATETIME
               )"""
        )
        conn.commit()
        conn.close()
        self.orig_connection = app_module.get_connection
        app_module.get_connection = self._get_connection
        app_module._symbol_map_invalidate()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._symbol_map_invalidate()
        Path(self.tmp.name).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.tmp.name)
        conn.row_factory = sqlite3.Row
        return conn

    def test_write_then_read(self):
        app_module._symbol_map_write("PGDC", "PGDC.V", "manual")
        self.assertEqual(app_module._yahoo_symbol("PGDC"), "PGDC.V")
        self.assertEqual(app_module._yahoo_symbol("pgdc"), "PGDC.V")

    def test_upsert_replaces_rather_than_duplicating(self):
        app_module._symbol_map_write("PGDC", "PGDC.TO", "auto")
        app_module._symbol_map_write("PGDC", "PGDC.V", "manual")
        conn = self._get_connection()
        rows = conn.execute("SELECT yahoo_symbol, source FROM symbol_map").fetchall()
        conn.close()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["yahoo_symbol"], "PGDC.V")
        self.assertEqual(rows[0]["source"], "manual")

    def test_failed_probe_is_recorded_so_it_is_not_retried(self):
        with patch.object(app_module, "_symbol_prices_on_yahoo", return_value=False):
            self.assertIsNone(app_module._resolve_yahoo_symbol("LLII"))

        conn = self._get_connection()
        row = conn.execute(
            "SELECT yahoo_symbol FROM symbol_map WHERE broker_symbol = 'LLII'"
        ).fetchone()
        conn.close()
        self.assertIsNotNone(row, "a miss must still be recorded")
        self.assertEqual(row["yahoo_symbol"], "")
        # A recorded miss must not redirect the fetch to an empty symbol.
        self.assertEqual(app_module._yahoo_symbol("LLII"), "LLII")

    def test_resolving_a_statically_known_symbol_writes_nothing(self):
        """A symbol the static map owns (WPAY -> TOPW) has no candidates of its
        own (`_yahoo_symbol_candidates` skips it), so an explicit re-probe used
        to find nothing and overwrite it with a wrong, permanent miss. It must
        instead confirm the static answer and leave the DB untouched.
        """
        with patch.object(app_module, "_symbol_prices_on_yahoo", return_value=True):
            self.assertEqual(app_module._resolve_yahoo_symbol("WPAY"), "TOPW")

        conn = self._get_connection()
        row = conn.execute(
            "SELECT * FROM symbol_map WHERE broker_symbol = 'WPAY'"
        ).fetchone()
        conn.close()
        self.assertIsNone(row, "nothing needed persisting for a statically-resolved symbol")

    def test_re_probing_an_existing_good_mapping_does_not_overwrite_it(self):
        """Re-probing a symbol that already resolves (static or DB) must not
        run full candidate search and risk landing on a different, worse
        candidate than what is already known good.
        """
        app_module._symbol_map_write("PGDC", "PGDC.V", "manual")
        calls = []

        def fake_probe(symbol):
            calls.append(symbol)
            return symbol == "PGDC.V"

        with patch.object(app_module, "_symbol_prices_on_yahoo", side_effect=fake_probe):
            self.assertEqual(app_module._resolve_yahoo_symbol("PGDC"), "PGDC.V")

        self.assertEqual(calls, ["PGDC.V"], "must only confirm the existing mapping, not re-search")

    def test_probe_stops_at_the_first_candidate_that_prices(self):
        tried = []

        def fake_probe(symbol):
            tried.append(symbol)
            return symbol == "PGDC.V"

        with patch.object(app_module, "_symbol_prices_on_yahoo", side_effect=fake_probe):
            self.assertEqual(app_module._resolve_yahoo_symbol("PGDC"), "PGDC.V")

        self.assertEqual(tried[-1], "PGDC.V")
        self.assertNotIn("PGDC.TO", tried, "probing must stop at the first hit")


class SymbolMapDegradesWithoutTableTest(unittest.TestCase):
    """Older databases and minimal test harnesses have no symbol_map table."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        sqlite3.connect(self.tmp.name).close()
        self.orig_connection = app_module.get_connection
        app_module.get_connection = self._get_connection
        app_module._symbol_map_invalidate()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._symbol_map_invalidate()
        Path(self.tmp.name).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.tmp.name)
        conn.row_factory = sqlite3.Row
        return conn

    def test_missing_table_means_no_translation_not_an_error(self):
        self.assertEqual(app_module._symbol_map_load(), {})
        self.assertEqual(app_module._yahoo_symbol("PGDC"), "PGDC")


if __name__ == "__main__":
    unittest.main()
