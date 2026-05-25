import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from market_calendar import is_nyse_trading_day, nyse_closure_reason


class NyseMarketCalendarTest(unittest.TestCase):
    def test_memorial_day_2026_is_closed(self):
        self.assertFalse(is_nyse_trading_day("2026-05-25"))
        self.assertEqual(nyse_closure_reason("2026-05-25"), "Memorial Day")

    def test_regular_weekday_before_memorial_day_is_open(self):
        self.assertTrue(is_nyse_trading_day("2026-05-22"))
        self.assertIsNone(nyse_closure_reason("2026-05-22"))

    def test_observed_independence_day_2026_is_closed(self):
        self.assertFalse(is_nyse_trading_day("2026-07-03"))
        self.assertEqual(nyse_closure_reason("2026-07-03"), "Independence Day")

    def test_weekends_are_closed(self):
        self.assertFalse(is_nyse_trading_day("2026-05-23"))
        self.assertEqual(nyse_closure_reason("2026-05-23"), "weekend")


if __name__ == "__main__":
    unittest.main()
