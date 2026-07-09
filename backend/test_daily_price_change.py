import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import _portfolio_daily_price_change


class PortfolioDailyPriceChangeTest(unittest.TestCase):
    def test_aggregates_selected_profiles_using_current_quantities(self):
        dates = pd.to_datetime(["2026-06-26", "2026-06-29"])
        holding_map = {
            (1, "AAA"): {"qty": 10},
            (2, "AAA"): {"qty": 5},
            (2, "BBB"): {"qty": 4},
            (3, "AAA"): {"qty": 100},
        }
        close_history = {
            "AAA": pd.Series([100.0, 105.0], index=dates),
            "BBB": pd.Series([50.0, 45.0], index=dates),
        }

        result = _portfolio_daily_price_change(
            holding_map,
            close_history,
            profile_ids=[1, 2],
        )

        self.assertEqual(result["amount"], 55.0)
        self.assertEqual(result["percent"], 3.2353)
        self.assertEqual(result["previous_value"], 1700.0)
        self.assertEqual(result["current_value"], 1755.0)
        self.assertEqual(result["holdings_covered"], 3)
        self.assertEqual(result["holdings_total"], 3)
        self.assertEqual(result["previous_date"], "2026-06-26")
        self.assertEqual(result["as_of_date"], "2026-06-29")

    def test_uses_full_account_value_for_percentage_when_available(self):
        dates = pd.to_datetime(["2026-06-26", "2026-06-29"])
        result = _portfolio_daily_price_change(
            {(6, "AAA"): {"qty": 10}},
            {"AAA": pd.Series([100.0, 105.0], index=dates)},
            profile_ids=[6],
            account_current_value=1250.0,
        )

        self.assertEqual(result["amount"], 50.0)
        self.assertEqual(result["percent"], 4.1667)
        self.assertEqual(result["account_previous_value"], 1200.0)
        self.assertEqual(result["account_current_value"], 1250.0)


if __name__ == "__main__":
    unittest.main()
