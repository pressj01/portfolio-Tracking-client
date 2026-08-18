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

        with patch.object(
            scanner,
            "profit_probability_schedule",
            return_value=([], None),
        ) as probabilities:
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

    def test_same_wing_target_gets_wider_as_dte_increases(self):
        def chain_for(dte, option_type):
            rows = []
            for strike in range(60, 141):
                priced = scanner.black_scholes(
                    100.0,
                    float(strike),
                    dte / 365.0,
                    scanner.RISK_FREE,
                    0.0,
                    0.20,
                    option_type,
                )
                mid = max(0.02, priced["price"])
                rows.append({
                    "strike": float(strike),
                    "bid": max(0.01, mid - 0.01),
                    "ask": mid + 0.01,
                    "mid": mid,
                    "iv": 0.20,
                    "delta": priced["delta"],
                    "open_interest": 500,
                    "volume": 100,
                    "quote_source": "live_bid_ask",
                })
            return rows

        def best_for(dte):
            candidates = scanner._candidate_combinations(
                chain_for(dte, "put"),
                chain_for(dte, "call"),
                spot=100.0,
                expiration=expiration_in(dte),
                dte=dte,
                quantity=1,
                dividend_yield=0.0,
                exit_dte=min(21, dte - 1),
                body_strike=100.0,
                put_wing_strike=None,
                call_wing_strike=None,
                min_wing_width_pct=1.0,
                max_wing_width_pct=50.0,
                target_wing_delta=0.16,
                include_analysis=False,
            )
            return min(candidates, key=lambda item: item["wing_delta_error"])

        near = best_for(30)
        far = best_for(120)

        self.assertGreater(far["put_width"], near["put_width"])
        self.assertGreater(far["call_width"], near["call_width"])
        self.assertAlmostEqual(near["target_wing_delta"], 0.16)
        self.assertAlmostEqual(far["target_wing_delta"], 0.16)
        self.assertLess(near["wing_delta_error"], 0.02)
        self.assertLess(far["wing_delta_error"], 0.02)

    def test_default_universe_is_the_three_core_index_etfs(self):
        self.assertEqual(scanner.DEFAULT_TICKERS, ["SPY", "QQQ", "IWM"])

    def test_missing_bulk_price_falls_back_to_fast_info(self):
        fake_ticker = type("FakeTicker", (), {
            "fast_info": {"last_price": 512.25},
        })()
        with patch.object(scanner.yf, "Ticker", return_value=fake_ticker):
            self.assertEqual(scanner._fallback_spot_price("SPY"), 512.25)

    def test_target_dte_and_wing_delta_outrank_actionable_farther_trade(self):
        requested = {
            "dte": 40,
            "body_offset_pct": 0.0,
            "wing_delta_error": 0.001,
            "status": "near_match",
            "blocking_flags": ["wide market"],
            "position_delta": 11.0,
            "fit_score": 80.0,
            "open_interest_min": 50,
        }
        farther = {
            **requested,
            "dte": 33,
            "wing_delta_error": 0.03,
            "status": "actionable",
            "blocking_flags": [],
            "position_delta": 8.0,
            "fit_score": 100.0,
        }

        self.assertLess(
            scanner._quality(requested, 40, 0.0),
            scanner._quality(farther, 40, 0.0),
        )
