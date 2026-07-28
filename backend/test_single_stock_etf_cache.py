import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class SingleStockEtfCacheTest(unittest.TestCase):
    """The single-stock ETF list is read from settings on every lookup.

    It is consulted once per fund row while scanning, so the read is cached;
    the cache must still pick up edits made on the Settings screen, and must
    not latch onto the built-in-only fallback used when settings are
    unreadable (which happens at import time on a fresh database).
    """

    def setUp(self):
        fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        conn = sqlite3.connect(self.db_path)
        conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        conn.commit()
        conn.close()

        self.connections = 0
        self._orig_get_connection = app_module.get_connection

        def fake_get_connection():
            self.connections += 1
            if self.db_path is None:
                raise sqlite3.OperationalError("no such database")
            c = sqlite3.connect(self.db_path)
            c.row_factory = sqlite3.Row
            return c

        app_module.get_connection = fake_get_connection
        app_module._invalidate_single_stock_etf_caches()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module._invalidate_single_stock_etf_caches()
        if self.db_path and os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def _set_user_tickers(self, value):
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('single_stock_etfs', ?)",
            (value,),
        )
        conn.commit()
        conn.close()

    def test_repeated_lookups_hit_the_database_once(self):
        for _ in range(50):
            app_module._get_single_stock_etfs()
        self.assertEqual(self.connections, 1)

    def test_user_added_tickers_are_returned(self):
        self._set_user_tickers("ZZUSER,QQUSER")
        result = app_module._get_single_stock_etfs()
        self.assertIn("ZZUSER", result)
        self.assertIn("QQUSER", result)
        self.assertIn("TSLY", result)  # built-ins still present

    def test_invalidation_picks_up_an_edit_without_restart(self):
        self._set_user_tickers("ZZUSER")
        self.assertIn("ZZUSER", app_module._get_single_stock_etfs())

        self._set_user_tickers("ZZUSER,LATEADD")
        # Without invalidation the cached copy is still served.
        self.assertNotIn("LATEADD", app_module._get_single_stock_etfs())

        app_module._invalidate_single_stock_etf_caches()
        self.assertIn("LATEADD", app_module._get_single_stock_etfs())

    def test_unreadable_settings_are_not_cached(self):
        # Mimics the import-time call on a fresh database: the read raises, the
        # built-ins are returned, and a later call must retry rather than latch.
        good_path, self.db_path = self.db_path, None
        result = app_module._get_single_stock_etfs()
        self.assertIn("TSLY", result)
        self.assertIsNone(app_module._single_stock_etf_cache)

        self.db_path = good_path
        self._set_user_tickers("RECOVERED")
        self.assertIn("RECOVERED", app_module._get_single_stock_etfs())

    def test_returned_set_is_a_copy(self):
        first = app_module._get_single_stock_etfs()
        first.add("MUTATED")
        self.assertNotIn("MUTATED", app_module._get_single_stock_etfs())

    def test_option_income_universe_follows_the_settings_list(self):
        self._set_user_tickers("ZZUSER")
        self.assertIn("ZZUSER", app_module._option_income_tickers())
        self.assertIn("SPYI", app_module._option_income_tickers())  # static member

        self._set_user_tickers("ZZUSER,LATEADD")
        app_module._invalidate_single_stock_etf_caches()
        self.assertIn("LATEADD", app_module._option_income_tickers())

    def test_strategy_overrides_follow_the_settings_list(self):
        self._set_user_tickers("ZZUSER")
        self.assertEqual(app_module._ticker_strategy_overrides().get("ZZUSER"), "Options Income")

        self._set_user_tickers("ZZUSER,LATEADD")
        app_module._invalidate_single_stock_etf_caches()
        self.assertEqual(app_module._ticker_strategy_overrides().get("LATEADD"), "Options Income")

    def test_static_strategy_entries_win_over_generated_ones(self):
        # BST appears in both the option-income list and the CEF list; the
        # original dict literal merged the static entries last, so CEF wins.
        overrides = app_module._ticker_strategy_overrides()
        self.assertEqual(overrides.get("BST"), "CEF")
        self.assertEqual(overrides.get("ARCC"), "BDC")
        self.assertEqual(overrides.get("TSLY"), "Options Income")


if __name__ == "__main__":
    unittest.main()
