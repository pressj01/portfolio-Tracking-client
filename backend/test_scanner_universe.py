import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from app import _get_default_scanner_etfs, _get_default_scanner_stocks


class ScannerDefaultUniverseTest(unittest.TestCase):
    """_get_default_scanner_etfs seeds the General Scanner's default universe.

    It concatenates several ticker lists with the single-stock ETF set, which is
    a set rather than a list -- an unguarded `list + set` there raises TypeError
    and leaves the scanner unable to load its universe at all.
    """

    def setUp(self):
        self._orig = app_module._get_single_stock_etfs
        # Hermetic: don't let the caller's settings table decide the result.
        app_module._get_single_stock_etfs = lambda: {"TSLY", "NVDY", "ZZUSER"}

    def tearDown(self):
        app_module._get_single_stock_etfs = self._orig

    def test_returns_a_list_of_tickers(self):
        universe = _get_default_scanner_etfs()
        self.assertIsInstance(universe, list)
        self.assertGreater(len(universe), 0)
        self.assertTrue(all(isinstance(t, str) for t in universe))

    def test_includes_single_stock_etfs_including_user_added(self):
        universe = _get_default_scanner_etfs()
        for ticker in ("TSLY", "NVDY", "ZZUSER"):
            self.assertIn(ticker, universe)

    def test_deduplicates(self):
        universe = _get_default_scanner_etfs()
        self.assertEqual(len(universe), len(set(universe)))

    def test_order_is_stable_across_calls(self):
        # Set iteration order varies with the hash seed, so the single-stock
        # tickers must be sorted before they reach the universe.
        self.assertEqual(_get_default_scanner_etfs(), _get_default_scanner_etfs())

    def test_stock_universe_still_builds(self):
        stocks = _get_default_scanner_stocks()
        self.assertIsInstance(stocks, list)
        self.assertEqual(len(stocks), len(set(stocks)))


if __name__ == "__main__":
    unittest.main()
