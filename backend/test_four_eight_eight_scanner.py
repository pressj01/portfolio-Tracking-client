"""Tests for the Dave Andresen double-hedge put butterfly scanner."""

from datetime import date
import os
import sys
import unittest
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import four_eight_eight_scanner as scanner
import unbalanced_butterfly_scanner as butterfly


def leg(strike, mid, delta, *, iv=0.20, spread=0.20, oi=500, volume=100):
    return {
        "strike": float(strike),
        "bid": float(mid - spread / 2),
        "ask": float(mid + spread / 2),
        "mid": float(mid),
        "iv": float(iv),
        "delta": float(delta),
        "open_interest": oi,
        "volume": volume,
        "dte": 200,
    }


def eligible_monthly():
    today = date.today()
    year, month = today.year, today.month
    while True:
        month += 1
        if month > 12:
            month = 1
            year += 1
        expiration = butterfly._third_friday(year, month)
        dte = (expiration - today).days
        if 160 <= dte <= 230:
            return expiration.isoformat(), dte


def base_candidate(expiration, dte):
    candidate = butterfly._build_butterfly(
        leg(100, 10, -0.25),
        leg(90, 7, -0.15),
        leg(70, 2, -0.025),
        spot=110,
        expiration=expiration,
        dte=dte,
        upper_long_target=0.25,
        tranche_quantity=4,
        lower_long_quantity_multiplier=2,
        lower_long_target=0.025,
        structure_kind="double-hedge-put-butterfly",
    )
    candidate.update({
        "theta_dollars_per_day": 20.0,
        "t0_minus_15_dollars": -2500.0,
        "t0_minus_20_dollars": -5000.0,
    })
    return candidate


class DocumentDefaults(unittest.TestCase):
    def test_defaults_match_the_presentation(self):
        self.assertEqual(scanner.DEFAULTS["tickers"], "SPY,QQQ,IWM")
        self.assertEqual(scanner.DEFAULTS["target_dte"], 200)
        self.assertEqual(scanner.DEFAULTS["min_dte"], 160)
        self.assertEqual(scanner.DEFAULTS["max_dte"], 230)
        self.assertEqual(scanner.DEFAULTS["tranche_quantity"], 4)
        self.assertEqual(scanner.DEFAULTS["min_theta_dollars"], 10.0)
        self.assertEqual(
            scanner.DEFAULTS["min_t0_minus_20_dollars"],
            -10000.0,
        )

    def test_manual_monitor_defaults_do_not_claim_a_favorable_entry(self):
        self.assertEqual(scanner.DEFAULTS["price_signal"], "unconfirmed")
        self.assertEqual(scanner.DEFAULTS["concavity_signal"], "unconfirmed")
        self.assertEqual(scanner.DEFAULTS["skew_signal"], "unconfirmed")


class StructureArithmetic(unittest.TestCase):
    def test_four_eight_eight_quantities_and_delta_are_correct(self):
        expiration, dte = eligible_monthly()
        result = base_candidate(expiration, dte)

        self.assertEqual(
            result["structure_kind"],
            "double-hedge-put-butterfly",
        )
        self.assertEqual(result["upper_long_quantity"], 4)
        self.assertEqual(result["body_short_quantity"], 8)
        self.assertEqual(result["lower_long_quantity"], 8)
        self.assertAlmostEqual(result["target_lower_long_delta"], 0.025)
        self.assertAlmostEqual(result["position_delta"], 0.0)

    def test_doubled_lower_long_creates_a_crash_recovery_tail(self):
        expiration, dte = eligible_monthly()
        result = base_candidate(expiration, dte)

        self.assertAlmostEqual(result["entry_credit"], 0.0)
        self.assertAlmostEqual(result["upper_flat_dollars"], 0.0)
        self.assertAlmostEqual(result["center_max_profit_dollars"], 4000.0)
        self.assertAlmostEqual(result["lower_corner_dollars"], -4000.0)
        self.assertAlmostEqual(result["zero_price_tail_dollars"], 24000.0)
        self.assertAlmostEqual(result["max_loss_dollars"], 4000.0)
        self.assertAlmostEqual(result["lower_breakeven"], 80.0)
        self.assertAlmostEqual(result["downside_breakeven"], 60.0)

    def test_t0_stress_and_cross_strike_diagnostics_are_calculated(self):
        expiration, dte = eligible_monthly()
        upper = leg(100, 10, -0.25, iv=0.18)
        body = leg(90, 7, -0.15, iv=0.20)
        lower = leg(70, 2, -0.025, iv=0.26)
        candidate = butterfly._build_butterfly(
            upper,
            body,
            lower,
            spot=110,
            expiration=expiration,
            dte=dte,
            upper_long_target=0.25,
            tranche_quantity=4,
            lower_long_quantity_multiplier=2,
            lower_long_target=0.025,
            structure_kind="double-hedge-put-butterfly",
        )

        scanner._enrich_candidate(
            candidate,
            upper_long=upper,
            body_short=body,
            lower_long=lower,
            spot=110,
            dte=dte,
            quantity=4,
            dividend_yield=0.0,
        )

        self.assertIsNotNone(candidate["t0_minus_15_dollars"])
        self.assertIsNotNone(candidate["t0_minus_20_dollars"])
        self.assertGreater(candidate["put_skew_iv_points"], 0)
        self.assertAlmostEqual(
            candidate["theta_reference_profit_target_dollars"],
            max(0, candidate["theta_dollars_per_day"]) * 120,
        )


class EntryReadiness(unittest.TestCase):
    def run_with(self, **overrides):
        expiration, dte = eligible_monthly()
        candidate = base_candidate(expiration, dte)

        class FakeTicker:
            options = [expiration]

        payload = {
            "tickers": "SPY",
            "target_dte": dte,
            "min_dte": dte,
            "max_dte": dte,
            "price_signal": "favorable",
            "concavity_signal": "favorable",
            "skew_signal": "favorable",
            **overrides,
        }
        with (
            patch.object(scanner, "_load_history", return_value=object()),
            patch.object(
                scanner,
                "_ticker_frame",
                return_value=pd.DataFrame({"Close": [110.0]}),
            ),
            patch.object(
                scanner,
                "_fetch_fundamentals_bulk",
                return_value={"SPY": {}},
            ),
            patch.object(scanner.yf, "Ticker", return_value=FakeTicker()),
            patch.object(scanner, "_load_put_chain", return_value=[{}]),
            patch.object(scanner, "_candidates", return_value=[candidate]),
        ):
            return scanner.run_488_scan(payload)

    def test_favorable_monitors_and_structure_are_entry_ready(self):
        result = self.run_with()
        row = result["rows"][0]
        self.assertEqual(row["structural_status"], "matched")
        self.assertEqual(row["entry_monitor_status"], "ready")
        self.assertEqual(row["status"], "actionable")

    def test_four_warning_signals_stop_new_entries_and_size_lpta(self):
        result = self.run_with(warning_signal_count=4, open_tranches=5)
        row = result["rows"][0]
        self.assertEqual(row["status"], "near_match")
        self.assertEqual(row["required_lpta_puts"], 2)
        self.assertTrue(any(
            "do not enter" in flag for flag in row["monitor_flags"]
        ))

        three_tranche_result = self.run_with(
            warning_signal_count=4,
            open_tranches=3,
        )
        self.assertEqual(
            three_tranche_result["rows"][0]["required_lpta_puts"],
            1,
        )

    def test_full_campaign_blocks_an_additional_tranche(self):
        result = self.run_with(
            campaign_planned_capital_dollars=25000,
            planned_capital_per_tranche_dollars=12500,
            open_tranches=2,
        )
        row = result["rows"][0]
        self.assertEqual(row["campaign_capacity_remaining"], 0)
        self.assertTrue(any(
            "capacity" in flag.lower() for flag in row["monitor_flags"]
        ))


if __name__ == "__main__":
    unittest.main()
