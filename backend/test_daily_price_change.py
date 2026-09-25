import sys
import unittest
from datetime import date
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

    def test_never_diffs_a_holding_across_other_sessions(self):
        # The 2026-09-23 shape: most of the book's last two bars were Friday and
        # Monday, and diffing those was reported as "Sep 22 to Sep 23".
        result = _portfolio_daily_price_change(
            {(6, "BIG"): {"qty": 100}, (6, "SMALL"): {"qty": 1}},
            {
                "BIG": pd.Series([10.0, 12.0], index=pd.to_datetime(["2026-09-18", "2026-09-21"])),
                "SMALL": pd.Series(
                    [5.0, 5.5, 6.0],
                    index=pd.to_datetime(["2026-09-21", "2026-09-22", "2026-09-23"]),
                ),
            },
            profile_ids=[6],
            sessions=(date(2026, 9, 22), date(2026, 9, 23)),
        )

        self.assertIsNone(result["amount"])
        self.assertIsNone(result["percent"])
        self.assertEqual(result["previous_date"], "2026-09-22")
        self.assertEqual(result["as_of_date"], "2026-09-23")
        self.assertEqual(result["missing_tickers"], ["BIG"])
        self.assertEqual(result["missing_by_session"], {"2026-09-22": 1, "2026-09-23": 1})
        self.assertEqual(result["tickers_total"], 2)
        self.assertEqual(result["holdings_covered"], 1)

    def test_a_small_gap_is_left_out_and_named(self):
        dates = pd.to_datetime(["2026-09-22", "2026-09-23"])
        result = _portfolio_daily_price_change(
            {(6, "AAA"): {"qty": 100}, (7, "AAA"): {"qty": 50}, (6, "THIN"): {"qty": 10}},
            {
                "AAA": pd.Series([100.0, 99.0], index=dates),
                "THIN": pd.Series([2.0], index=pd.to_datetime(["2026-09-22"])),
            },
            profile_ids=[6, 7],
            sessions=(date(2026, 9, 22), date(2026, 9, 23)),
        )

        self.assertEqual(result["amount"], -150.0)
        self.assertEqual(result["missing_tickers"], ["THIN"])
        self.assertEqual(result["missing_by_session"], {"2026-09-23": 1})
        self.assertEqual(result["holdings_total"], 3)
        self.assertEqual(result["holdings_covered"], 2)
        self.assertGreater(result["coverage_pct"], 99)

    def test_money_market_fund_is_flat_not_missing(self):
        # Yahoo returns only today's $1.00 bar for FZDXX and no previous close.
        # At 60% of the book it used to withhold the whole day change.
        dates = pd.to_datetime(["2026-09-24", "2026-09-25"])
        result = _portfolio_daily_price_change(
            {
                (6, "AAA"): {"qty": 100},
                (6, "FZDXX"): {"qty": 15000, "description": "FIDELITY MONEY MARKET"},
                (6, "SWEEP"): {"qty": 500, "description": "Treasury Money Market Fund", "current_value": 500},
            },
            {
                "AAA": pd.Series([100.0, 99.0], index=dates),
                "FZDXX": pd.Series([1.0], index=pd.to_datetime(["2026-09-25"])),
            },
            profile_ids=[6],
            sessions=(date(2026, 9, 24), date(2026, 9, 25)),
        )

        self.assertEqual(result["amount"], -100.0)
        self.assertEqual(result["missing_tickers"], [])
        self.assertEqual(result["holdings_covered"], 3)
        self.assertEqual(result["previous_value"], 25500.0)

    def test_without_sessions_every_holding_uses_the_latest_two_seen(self):
        result = _portfolio_daily_price_change(
            {(6, "AAA"): {"qty": 1}, (6, "LAG"): {"qty": 1000}},
            {
                "AAA": pd.Series([1.0, 2.0], index=pd.to_datetime(["2026-09-22", "2026-09-23"])),
                "LAG": pd.Series([3.0, 4.0], index=pd.to_datetime(["2026-09-18", "2026-09-21"])),
            },
            profile_ids=[6],
        )

        self.assertEqual(result["as_of_date"], "2026-09-23")
        self.assertEqual(result["previous_date"], "2026-09-22")
        self.assertIsNone(result["amount"])
        self.assertEqual(result["missing_tickers"], ["LAG"])


if __name__ == "__main__":
    unittest.main()
