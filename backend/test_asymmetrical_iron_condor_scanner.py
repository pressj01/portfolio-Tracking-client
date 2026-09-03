"""Tests for the 14-day and monthly asymmetrical iron condor scanner."""

from datetime import date, timedelta
import os
import sys
import unittest
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import asymmetrical_iron_condor_scanner as scanner


DTE_14 = 32
DTE_MONTHLY = 45


def expiration_in(days):
    return (date.today() + timedelta(days=days)).isoformat()


def leg(strike, mid, delta, *, spread=0.10, oi=500, volume=100, option_type="put"):
    signed_delta = -abs(delta) if option_type == "put" else abs(delta)
    return {
        "strike": float(strike),
        "bid": float(mid - spread / 2),
        "ask": float(mid + spread / 2),
        "mid": float(mid),
        "iv": 0.22,
        "delta": float(signed_delta),
        "open_interest": oi,
        "volume": volume,
        "dte": DTE_14,
        "quote_source": "live_bid_ask",
    }


def aic_chain():
    puts = [
        leg(70, 1.00, 0.07),
        leg(75, 1.40, 0.10),
        leg(80, 2.00, 0.16),
        leg(85, 3.00, 0.25),
        leg(88, 3.60, 0.32),
        leg(90, 4.20, 0.35),
        leg(92, 4.80, 0.40),
    ]
    calls = [
        leg(108, 1.50, 0.12, option_type="call"),
        leg(115, 0.60, 0.05, option_type="call"),
    ]
    return puts, calls


class CampaignRules(unittest.TestCase):
    def test_fourteen_day_defaults_match_the_video(self):
        spec = scanner.campaign_spec("fourteen_day")
        self.assertEqual(spec["min_dte"], 28)
        self.assertEqual(spec["target_dte"], 32)
        self.assertEqual(spec["max_dte"], 38)
        self.assertEqual(spec["put_short_delta"], 0.25)
        self.assertEqual(spec["call_short_delta"], 0.12)
        self.assertEqual(spec["put_credit_qty"], 4)
        self.assertEqual(spec["call_credit_qty"], 1)
        self.assertEqual(spec["hedge_qty"], 1)
        self.assertEqual(spec["max_hold_days"], 14)
        self.assertEqual(spec["profit_target_low_pct"], 2.0)
        self.assertEqual(spec["profit_target_high_pct"], 4.0)
        self.assertEqual(spec["max_loss_pct"], 5.0)
        self.assertEqual(spec["plan_capital_dollars"], 18000.0)

    def test_monthly_defaults_match_the_longer_campaign(self):
        spec = scanner.campaign_spec("monthly")
        self.assertEqual(spec["min_dte"], 40)
        self.assertEqual(spec["target_dte"], 45)
        self.assertEqual(spec["max_dte"], 55)
        self.assertEqual(spec["put_short_delta"], 0.16)
        self.assertEqual(spec["call_short_delta"], 0.12)
        self.assertEqual(spec["put_credit_qty"], 10)
        self.assertEqual(spec["call_credit_qty"], 2)
        self.assertEqual(spec["hedge_qty"], 1)
        self.assertEqual(spec["exit_remaining_dte"], 14)
        self.assertEqual(spec["profit_target_low_pct"], 7.0)
        self.assertEqual(spec["profit_target_high_pct"], 8.0)
        self.assertIn("IWM", scanner.DEFAULT_TICKERS)

    def test_fourteen_day_management_is_a_hold_not_a_14_dte_option(self):
        points = scanner._management_points(32, max_hold_days=14, exit_remaining_dte=None)
        self.assertEqual(
            [point["label"] for point in points],
            ["Day-6 review", "14-day hold exit"],
        )
        self.assertEqual([point["remaining_dte"] for point in points], [26, 18])

    def test_monthly_management_exits_at_14_dte_remaining(self):
        points = scanner._management_points(45, max_hold_days=None, exit_remaining_dte=14)
        labels = [point["label"] for point in points]
        self.assertIn("14-DTE exit", labels)
        self.assertEqual(
            next(point["remaining_dte"] for point in points if point["kind"] == "planned_exit"),
            14,
        )


class CandidateConstruction(unittest.TestCase):
    def test_fourteen_day_unit_is_four_put_credits_one_call_and_one_hedge(self):
        puts, calls = aic_chain()
        by_strike = {row["strike"]: row for row in puts + calls}
        result = scanner._build_candidate(
            by_strike[75], by_strike[85], by_strike[88], by_strike[92],
            by_strike[108], by_strike[115],
            spot=100.0,
            expiration=expiration_in(DTE_14),
            dte=DTE_14,
            campaign=scanner.campaign_spec("fourteen_day"),
            tranche_quantity=1,
            dividend_yield=0.0,
            max_hold_days=14,
            exit_remaining_dte=None,
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["structure_kind"], "fourteen-day-aic")
        self.assertEqual(result["put_quantity"], 4)
        self.assertEqual(result["call_quantity"], 1)
        self.assertEqual(result["hedge_quantity"], 1)
        self.assertEqual(len(result["legs"]), 6)
        self.assertGreater(result["entry_credit"], 0)
        self.assertGreater(result["position_delta"], 0)
        self.assertEqual(result["max_hold_days"], 14)
        self.assertAlmostEqual(result["profit_target_low_dollars"], 360.0)
        self.assertAlmostEqual(result["profit_target_high_dollars"], 720.0)
        self.assertAlmostEqual(result["management_max_loss_dollars"], 900.0)

    def test_monthly_unit_uses_the_original_10_to_2_to_1_ratio(self):
        puts, calls = aic_chain()
        by_strike = {row["strike"]: row for row in puts + calls}
        result = scanner._build_candidate(
            by_strike[70], by_strike[80], by_strike[85], by_strike[90],
            by_strike[108], by_strike[115],
            spot=100.0,
            expiration=expiration_in(DTE_MONTHLY),
            dte=DTE_MONTHLY,
            campaign=scanner.campaign_spec("monthly"),
            tranche_quantity=1,
            dividend_yield=0.0,
            max_hold_days=None,
            exit_remaining_dte=14,
        )

        self.assertIsNotNone(result)
        self.assertEqual(result["structure_kind"], "monthly-aic")
        self.assertEqual(result["put_quantity"], 10)
        self.assertEqual(result["call_quantity"], 2)
        self.assertEqual(result["hedge_quantity"], 1)
        self.assertGreater(result["position_delta"], 0)
        self.assertEqual(result["exit_remaining_dte"], 14)
        self.assertAlmostEqual(result["profit_target_low_dollars"], 1260.0)

    def test_scan_returns_the_14_day_structure_and_hold_exit(self):
        expiration = expiration_in(DTE_14)
        puts, calls = aic_chain()

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
                return_value={"IWM": {"name": "iShares Russell 2000 ETF"}},
            ),
            patch.object(scanner.yf, "Ticker", return_value=FakeTicker()),
            patch.object(
                scanner.yahoo_gateway,
                "fetch",
                return_value=([expiration], {"stale": False}),
            ),
            patch.object(scanner, "_load_put_chain", return_value=puts),
            patch.object(scanner, "_load_call_chain", return_value=calls),
            patch.object(scanner, "_prepare_side", side_effect=lambda legs, **kwargs: legs),
        ):
            result = scanner.run_asymmetrical_iron_condor_scan({
                "tickers": "IWM",
                "campaign": "fourteen_day",
                "target_dte": DTE_14,
                "min_dte": DTE_14,
                "max_dte": DTE_14,
                "max_bid_ask_pct": 20,
            })

        self.assertEqual(result["stats"]["structures_found"], 1)
        row = result["rows"][0]
        self.assertEqual(row["ticker"], "IWM")
        self.assertEqual(row["campaign"], "fourteen_day")
        self.assertEqual(row["put_quantity"], 4)
        self.assertEqual(row["call_quantity"], 1)
        self.assertIn(
            "14-day hold exit",
            [point["label"] for point in row["probability_schedule"][:-1]],
        )

    def test_stock_symbols_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "index ETFs"):
            scanner.run_asymmetrical_iron_condor_scan({"tickers": "IWM,AAPL"})


if __name__ == "__main__":
    unittest.main()
