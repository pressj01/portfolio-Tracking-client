"""Tests for the 60/40/20 delta-neutral fly scanner."""

from datetime import date, timedelta
import os
import sys
import unittest
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sixty_forty_twenty_fly_scanner as scanner


DTE = 70


def expiration_in(days=DTE):
    return (date.today() + timedelta(days=days)).isoformat()


def leg(strike, mid, delta, *, spread=0.10, oi=500, volume=100):
    return {
        "strike": float(strike),
        "bid": float(mid - spread / 2),
        "ask": float(mid + spread / 2),
        "mid": float(mid),
        "iv": 0.24,
        "delta": float(delta),
        "open_interest": oi,
        "volume": volume,
        "dte": DTE,
    }


def exact_chain():
    return [
        leg(96, 2.0, -0.20),
        leg(100, 4.0, -0.40),
        leg(106, 8.0, -0.60),
    ]


class StrategyRules(unittest.TestCase):
    def test_defaults_match_the_entry_and_exit_rules(self):
        self.assertEqual(scanner.DEFAULTS["min_dte"], 60)
        self.assertEqual(scanner.DEFAULTS["max_dte"], 80)
        self.assertEqual(scanner.DEFAULTS["exit_dte"], 30)
        self.assertEqual(scanner.DEFAULTS["delta_theta_caution_pct"], 50.0)
        self.assertEqual(scanner.DEFAULTS["delta_theta_exit_pct"], 60.0)
        self.assertIn("VOO", scanner.DEFAULT_TICKERS)

    def test_relative_delta_monitor_bands_are_computed_from_entry(self):
        upper = scanner._relative_delta_bands(0.60)
        body = scanner._relative_delta_bands(0.40)

        self.assertEqual(upper, {
            "target": 0.60,
            "caution_low": 0.48,
            "caution_high": 0.72,
            "exit_low": 0.42,
            "exit_high": 0.78,
        })
        self.assertEqual(body, {
            "target": 0.40,
            "caution_low": 0.32,
            "caution_high": 0.48,
            "exit_low": 0.28,
            "exit_high": 0.52,
        })

    def test_reviews_include_day_8_day_14_and_the_30_dte_exit(self):
        points = scanner._management_points(70, 30)

        self.assertEqual(
            [point["label"] for point in points],
            ["8-day review", "14-day review", "30-DTE exit"],
        )
        self.assertEqual(
            [point["remaining_dte"] for point in points],
            [62, 56, 30],
        )


class CandidateConstruction(unittest.TestCase):
    def test_exact_deltas_create_a_neutral_one_two_one_fly(self):
        result = scanner._build_candidate(
            exact_chain()[2],
            exact_chain()[1],
            exact_chain()[0],
            spot=100.0,
            expiration=expiration_in(),
            dte=DTE,
            quantity=1,
            dividend_yield=0.0,
            exit_dte=30,
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["structure_kind"], "sixty-forty-twenty-fly")
        self.assertEqual(result["upper_long_quantity"], 1)
        self.assertEqual(result["body_short_quantity"], 2)
        self.assertEqual(result["lower_long_quantity"], 1)
        self.assertAlmostEqual(result["position_delta"], 0.0)
        # The 6-point upper wing and 4-point lower wing prove this scanner is
        # not incorrectly constrained to the neighboring broken-wing rule.
        self.assertEqual(result["upper_width"], 6.0)
        self.assertEqual(result["lower_width"], 4.0)
        self.assertEqual(result["entry_side"], "debit")

    def test_scan_returns_one_best_candidate_with_management_fields(self):
        expiration = expiration_in()

        class FakeTicker:
            options = [expiration]

        with (
            patch.object(scanner, "_load_history", return_value=object()),
            patch.object(
                scanner,
                "_ticker_frame",
                return_value=pd.DataFrame({"Close": [99.0, 100.0]}),
            ),
            patch.object(
                scanner,
                "_fetch_fundamentals_bulk",
                return_value={"SPY": {"name": "SPDR S&P 500 ETF Trust"}},
            ),
            patch.object(scanner.yf, "Ticker", return_value=FakeTicker()),
            patch.object(scanner, "_load_put_chain", return_value=exact_chain()),
        ):
            result = scanner.run_sixty_forty_twenty_fly_scan({
                "tickers": "SPY",
                "target_dte": DTE,
                "min_dte": DTE,
                "max_dte": DTE,
                "max_bid_ask_pct": 10,
            })

        self.assertEqual(result["stats"]["structures_found"], 1)
        row = result["rows"][0]
        self.assertEqual(row["ticker"], "SPY")
        self.assertEqual(row["mandatory_exit_dte"], 30)
        self.assertEqual(row["upper_delta_monitor"]["caution_low"], 0.48)
        self.assertEqual(
            [point["label"] for point in row["probability_schedule"][:-1]],
            ["8-day review", "14-day review", "30-DTE exit"],
        )


if __name__ == "__main__":
    unittest.main()
