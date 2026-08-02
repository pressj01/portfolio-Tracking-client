"""Tests for the three-strike, four-leg iron butterfly scanner."""

from datetime import date, timedelta
import os
import sys
import unittest
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import iron_butterfly_scanner as scanner


DTE = 45


def expiration_in(days=DTE):
    return (date.today() + timedelta(days=days)).isoformat()


def leg(strike, mid, delta, *, option_type=None):
    return {
        "strike": float(strike),
        "bid": float(mid - 0.05),
        "ask": float(mid + 0.05),
        "mid": float(mid),
        "iv": 0.25,
        "delta": float(delta),
        "open_interest": 500,
        "volume": 100,
        "dte": DTE,
        **({"option_type": option_type} if option_type else {}),
    }


def standard_legs():
    return {
        "put_long": leg(90, 0.50, -0.10),
        "put_short": leg(100, 2.50, -0.50),
        "call_short": leg(100, 2.50, 0.50),
        "call_long": leg(110, 0.50, 0.10),
    }


def standard_butterfly():
    legs = standard_legs()
    return scanner._build_iron_butterfly(
        legs["put_long"],
        legs["put_short"],
        legs["call_short"],
        legs["call_long"],
        spot=100.0,
        expiration=expiration_in(),
        dte=DTE,
        quantity=1,
        dividend_yield=0.0,
        exit_dte=21,
    )


class IronButterflyRules(unittest.TestCase):
    def test_iron_butterfly_has_three_strikes_and_four_legs(self):
        butterfly = standard_butterfly()

        self.assertIsNotNone(butterfly)
        self.assertEqual(butterfly["put_long_strike"], 90.0)
        self.assertEqual(butterfly["body_strike"], 100.0)
        self.assertEqual(butterfly["call_long_strike"], 110.0)
        self.assertEqual([leg["qty"] for leg in butterfly["legs"]], [1, -1, -1, 1])

    def test_payoff_uses_credit_and_wider_wing_for_max_loss(self):
        butterfly = standard_butterfly()

        self.assertEqual(butterfly["entry_credit"], 4.0)
        self.assertEqual(butterfly["max_profit"], 4.0)
        self.assertEqual(butterfly["max_loss"], 6.0)
        self.assertEqual(butterfly["lower_breakeven"], 96.0)
        self.assertEqual(butterfly["upper_breakeven"], 104.0)

    def test_scan_accepts_exact_strike_overrides_and_any_target_dte(self):
        expiration = expiration_in()
        class FakeTicker:
            options = [expiration]

        puts = [standard_legs()["put_long"], standard_legs()["put_short"]]
        calls = [standard_legs()["call_short"], standard_legs()["call_long"]]
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
            patch("yfinance.Ticker", return_value=FakeTicker()),
            patch.object(scanner, "_load_put_chain", return_value=puts),
            patch.object(scanner, "_load_call_chain", return_value=calls),
        ):
            result = scanner.run_iron_butterfly_scan({
                "tickers": "SPY",
                "target_dte": DTE,
                "min_dte": DTE,
                "max_dte": DTE,
                "body_strike": 100,
                "put_wing_strike": 90,
                "call_wing_strike": 110,
                "min_open_interest": 100,
                "max_bid_ask_pct": 25,
            })

        self.assertEqual(result["stats"]["structures_found"], 1)
        row = result["rows"][0]
        self.assertEqual(row["status"], "actionable")
        self.assertEqual(row["body_strike"], 100.0)
        self.assertEqual(row["dte"], DTE)

    def test_discovery_defers_probability_model_until_a_candidate_is_chosen(self):
        strikes = list(range(50, 151, 5))
        puts = [leg(strike, max(0.5, (strike - 40) * 0.12), -0.25) for strike in strikes]
        calls = [leg(strike, max(0.5, (160 - strike) * 0.12), 0.25) for strike in strikes]

        with patch.object(scanner, "profit_probability_schedule") as probabilities:
            candidates = scanner._candidate_combinations(
                puts,
                calls,
                spot=100.0,
                expiration=expiration_in(),
                dte=DTE,
                quantity=1,
                dividend_yield=0.0,
                exit_dte=21,
                body_strike=None,
                put_wing_strike=None,
                call_wing_strike=None,
                min_wing_width_pct=1.0,
                max_wing_width_pct=50.0,
                include_analysis=False,
            )

        self.assertTrue(candidates)
        probabilities.assert_not_called()
