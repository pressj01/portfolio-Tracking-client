"""Tests for the Dave Andresen double-hedge put butterfly scanner."""

from datetime import date
import math
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


def eligible_monthly(low=160, high=230):
    today = date.today()
    year, month = today.year, today.month
    while True:
        month += 1
        if month > 12:
            month = 1
            year += 1
        expiration = butterfly._third_friday(year, month)
        dte = (expiration - today).days
        if low <= dte <= high:
            return expiration.isoformat(), dte


def skewed_put_chain(spot, dte):
    """Black-Scholes puts at every $1 strike, with an index-style put skew."""
    years = dte / 365.0
    rate = butterfly.RISK_FREE

    def cdf(x):
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    chain = []
    for strike in range(int(spot * 0.5), int(spot)):
        vol = 0.16 + 0.35 * max(0.0, 1.0 - strike / spot)
        root = vol * math.sqrt(years)
        d1 = (math.log(spot / strike) + (rate + vol * vol / 2) * years) / root
        d2 = d1 - root
        price = (
            strike * math.exp(-rate * years) * cdf(-d2) - spot * cdf(-d1)
        )
        if price < 0.02:
            continue
        chain.append({
            **leg(strike, price, -cdf(-d1), iv=vol, spread=0.02),
            "dte": dte,
        })
    return chain


def nearest_strike(chain, target_delta):
    return min(
        chain,
        key=lambda item: abs(abs(item["delta"]) - target_delta),
    )["strike"]


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
        self.assertEqual(scanner.DEFAULTS["tickers"], "SPY,QQQ,IWM,VOO")
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


def run_scan_with(candidate, expiration, **payload):
    """Run the whole scan on one prepared candidate and a stubbed feed."""

    class FakeTicker:
        options = [expiration]

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
        return scanner.run_488_scan({"tickers": "SPY", **payload})


class RatioSize(unittest.TestCase):
    def test_quantity_scales_the_whole_one_two_two_ratio(self):
        expiration, dte = eligible_monthly()
        for size, quantities in ((1, (1, 2, 2)), (2, (2, 4, 4)), (4, (4, 8, 8))):
            candidate = butterfly._build_butterfly(
                leg(100, 10, -0.25),
                leg(90, 7, -0.15),
                leg(70, 2, -0.025),
                spot=110,
                expiration=expiration,
                dte=dte,
                upper_long_target=0.25,
                tranche_quantity=size,
                lower_long_quantity_multiplier=2,
                lower_long_target=0.025,
                structure_kind="double-hedge-put-butterfly",
            )
            self.assertEqual(
                (
                    candidate["upper_long_quantity"],
                    candidate["body_short_quantity"],
                    candidate["lower_long_quantity"],
                ),
                quantities,
            )
            self.assertAlmostEqual(candidate["max_loss_dollars"], 1000.0 * size)

    def test_omitted_dollar_rules_scale_with_the_size(self):
        expiration, dte = eligible_monthly()
        params = run_scan_with(
            base_candidate(expiration, dte),
            expiration,
            target_dte=dte,
            min_dte=dte,
            max_dte=dte,
            tranche_quantity=1,
        )["params"]

        self.assertEqual(params["ratio_label"], "1/-2/+2")
        self.assertAlmostEqual(params["min_theta_dollars"], 2.5)
        self.assertAlmostEqual(params["min_t0_minus_20_dollars"], -2500.0)
        self.assertAlmostEqual(
            params["planned_capital_per_tranche_dollars"],
            3125.0,
        )
        self.assertAlmostEqual(params["upper_line_target_dollars"], -75.0)
        # The requested debit places CC4's lower hedge now, so its bias
        # band and upper-line tolerance no longer apply.
        self.assertIsNone(params["bias_delta_min"])
        self.assertIsNone(params["uel_tolerance_dollars"])

    def test_an_explicit_zero_rule_is_not_replaced_by_the_default(self):
        expiration, dte = eligible_monthly()
        params = run_scan_with(
            base_candidate(expiration, dte),
            expiration,
            target_dte=dte,
            min_dte=dte,
            max_dte=dte,
            min_theta_dollars=0,
            min_t0_minus_20_dollars=0,
            upper_line_amount_dollars=0,
        )["params"]

        self.assertEqual(params["min_theta_dollars"], 0.0)
        self.assertEqual(params["min_t0_minus_20_dollars"], 0.0)
        self.assertEqual(params["upper_line_amount_dollars"], 0.0)

    def test_lpta_hedge_groups_count_base_tranches_not_small_ones(self):
        expiration, dte = eligible_monthly()
        common = dict(
            target_dte=dte,
            min_dte=dte,
            max_dte=dte,
            tranche_quantity=1,
            warning_signal_count=4,
        )
        twelve_units = run_scan_with(
            base_candidate(expiration, dte),
            expiration,
            open_tranches=12,
            **common,
        )
        thirteen_units = run_scan_with(
            base_candidate(expiration, dte),
            expiration,
            open_tranches=13,
            **common,
        )

        # Twelve 1/-2/+2 tranches are three 4/-8/+8 tranches: one hedge.
        self.assertEqual(twelve_units["params"]["required_lpta_puts"], 1)
        self.assertEqual(thirteen_units["params"]["required_lpta_puts"], 2)


class HundredDayPlan(unittest.TestCase):
    plan = scanner.STRUCTURE_VARIANTS["100dte"]

    def choose(self, chain, dte, upper_line_target=None, **overrides):
        expiration, _ = eligible_monthly(80, 120)
        rules = dict(
            spot=100.0,
            expiration=expiration,
            dte=dte,
            quantity=1,
            min_lower_wing_ratio=1.05,
            dividend_yield=0.0,
            # A neutral band this plan's -12 deltas per unit could never meet.
            bias_low=-0.25,
            bias_high=0.25,
            min_theta_dollars=2.5,
            min_t0_minus_20_dollars=-2500.0,
        )
        rules.update(overrides)
        candidates = scanner._candidates(
            chain,
            **rules,
            variant=self.plan,
            upper_line_target=upper_line_target,
        )
        return scanner._choose_candidate(
            candidates,
            bias_low=rules["bias_low"],
            bias_high=rules["bias_high"],
            delta_tolerance=0.02,
            min_open_interest=0,
            min_theta_dollars=rules["min_theta_dollars"],
            min_t0_minus_20_dollars=rules["min_t0_minus_20_dollars"],
            document_rules=self.plan["document_rules"],
            upper_line_target=upper_line_target,
        )

    def test_plan_is_the_user_specified_structure(self):
        self.assertEqual(
            (
                self.plan["upper_long_delta"],
                self.plan["body_short_delta"],
                self.plan["lower_long_delta"],
            ),
            (0.30, 0.12, 0.03),
        )
        self.assertEqual(
            (self.plan["min_dte"], self.plan["target_dte"], self.plan["max_dte"]),
            (80, 100, 120),
        )
        self.assertFalse(self.plan["document_rules"])

    def test_legs_sit_on_30_12_3_delta_without_bias_shifting(self):
        chain = skewed_put_chain(100.0, 100)
        chosen = self.choose(chain, 100)

        self.assertEqual(chosen["upper_long_strike"], nearest_strike(chain, 0.30))
        self.assertEqual(chosen["body_short_strike"], nearest_strike(chain, 0.12))
        # CC4 would push this hedge toward the farthest strike to chase a
        # neutral band; the 100-DTE plan keeps the 3-delta put.
        self.assertEqual(chosen["lower_long_strike"], nearest_strike(chain, 0.03))
        self.assertEqual(
            (
                chosen["upper_long_quantity"],
                chosen["body_short_quantity"],
                chosen["lower_long_quantity"],
            ),
            (1, 2, 2),
        )
        # About -0.30 + 2(0.12) - 2(0.03) = -0.12 per share of one unit.
        self.assertLess(chosen["position_delta"], -9)
        self.assertGreater(chosen["position_delta"], -15)
        self.assertLess(chosen["entry_credit"], 0, "opens for a debit")

    def test_scaling_keeps_the_legs_and_multiplies_the_risk(self):
        chain = skewed_put_chain(100.0, 100)
        one = self.choose(chain, 100)
        three = self.choose(
            chain,
            100,
            quantity=3,
            bias_low=-0.75,
            bias_high=0.75,
            min_theta_dollars=7.5,
            min_t0_minus_20_dollars=-7500.0,
        )

        for key in ("upper_long_strike", "body_short_strike", "lower_long_strike"):
            self.assertEqual(three[key], one[key])
        self.assertEqual(
            (
                three["upper_long_quantity"],
                three["body_short_quantity"],
                three["lower_long_quantity"],
            ),
            (3, 6, 6),
        )
        self.assertAlmostEqual(
            three["max_loss_dollars"],
            3 * one["max_loss_dollars"],
        )

    def test_an_untested_finish_above_the_upper_long_counts_as_success(self):
        chain = skewed_put_chain(100.0, 100)
        chosen = butterfly.with_full_analytics(self.choose(chain, 100))
        at_expiration = next(
            point for point in chosen["probability_schedule"]
            if point.get("kind") == "expiration"
        )

        # The entry debit is an upper line that can be raised after entry,
        # so, as with CC4, only the downside valley counts as failure. A
        # 30-delta upper long alone finishes untested about 70% of the time.
        self.assertGreater(at_expiration["probability_success_pct"], 80.0)

    def test_scan_skips_the_cc4_document_rules(self):
        expiration, dte = eligible_monthly(80, 120)
        chain = skewed_put_chain(100.0, dte)
        candidate = self.choose(chain, dte)
        result = run_scan_with(
            candidate,
            expiration,
            structure_variant="100dte",
            tranche_quantity=1,
            # Room for any debit this fixture can have on any date.
            upper_line_amount_dollars=1000,
            price_signal="unconfirmed",
            warning_signal_count=5,
            awaiting_all_clear=True,
            campaign_planned_capital_dollars=0,
            open_tranches=9,
        )
        row = result["rows"][0]
        params = result["params"]

        # No DTE was sent, so the plan's own window applies.
        self.assertEqual((params["min_dte"], params["max_dte"]), (80, 120))
        self.assertEqual(params["structure_variant"], "100dte")
        self.assertEqual(row["status"], "actionable")
        self.assertEqual(row["entry_monitor_status"], "not_applicable")
        self.assertEqual(row["monitor_flags"], [])
        self.assertEqual(row["flags"], [])
        self.assertIsNone(row["market_bias"])
        self.assertIsNone(row["min_theta_dollars"])
        self.assertIsNone(row["required_lpta_puts"])
        self.assertIsNone(row["course_profit_target_dollars"])
        self.assertEqual(
            row["scanner_variant"],
            "double-hedge-put-butterfly-100dte-q1",
        )

    def test_unknown_plan_is_rejected(self):
        with self.assertRaises(ValueError):
            scanner.run_488_scan({"structure_variant": "weekly"})


class HundredDayCashFlowFit(unittest.TestCase):
    """The lower longs shift to fit the opening debit or credit you pick."""

    upper = leg(100, 10.0, -0.30)
    body = leg(90, 5.0, -0.12)
    # Upper line per 1/-2/+2 unit with each hedge: 2(5) - 10 - 2(lower mid).
    pool = [
        leg(80, 1.5, -0.04),   # -$300
        leg(75, 1.0, -0.03),   # -$200, the 3-delta guide
        leg(70, 0.6, -0.02),   # -$120
        leg(65, 0.3, -0.01),   # -$60
    ]

    def fit(self, target, quantity=1):
        fitted = scanner._fit_lower_long(
            self.pool,
            upper_long=self.upper,
            body_short=self.body,
            quantity=quantity,
            target_dollars=target,
        )
        return fitted["strike"] if fitted else None

    def test_the_highest_hedge_that_meets_the_target_is_chosen(self):
        self.assertEqual(self.fit(-200), 75)
        # A tighter debit shifts the hedge down; room to spare shifts it up.
        self.assertEqual(self.fit(-150), 70)
        self.assertEqual(self.fit(-100), 65)
        self.assertEqual(self.fit(-400), 80)
        # The limit is for the whole position, so it scales with the size.
        self.assertEqual(self.fit(-400, quantity=2), 75)

    def test_no_lower_hedge_can_reach_an_impossible_target(self):
        self.assertIsNone(self.fit(500))

    def test_the_lower_longs_move_first(self):
        chain = skewed_put_chain(100.0, 100)
        plan = HundredDayPlan()
        exact = plan.choose(chain, 100)
        fitted = plan.choose(chain, 100, upper_line_target=-80.0)

        self.assertLess(exact["upper_flat_dollars"], -80)
        self.assertGreaterEqual(fitted["upper_flat_dollars"], -80)
        self.assertEqual(fitted["upper_long_strike"], nearest_strike(chain, 0.30))
        self.assertEqual(fitted["body_short_strike"], nearest_strike(chain, 0.12))
        self.assertLess(fitted["lower_long_strike"], exact["lower_long_strike"])

    def test_the_upper_long_moves_down_only_when_the_lower_longs_cannot(self):
        chain = skewed_put_chain(100.0, 100)
        # The 30/12 pair alone costs ~$61 here: no lower hedge reaches $60.
        fitted = HundredDayPlan().choose(chain, 100, upper_line_target=-60.0)

        self.assertGreaterEqual(fitted["upper_flat_dollars"], -60)
        self.assertEqual(fitted["body_short_strike"], nearest_strike(chain, 0.12))
        self.assertLess(fitted["upper_long_strike"], nearest_strike(chain, 0.30))

    def test_out_of_reach_shows_the_plan_trade_and_the_best_line(self):
        chain = skewed_put_chain(100.0, 100)
        unreachable = HundredDayPlan().choose(chain, 100, upper_line_target=1000.0)

        self.assertEqual(unreachable["upper_long_strike"], nearest_strike(chain, 0.30))
        self.assertEqual(unreachable["body_short_strike"], nearest_strike(chain, 0.12))
        self.assertEqual(unreachable["lower_long_strike"], nearest_strike(chain, 0.03))
        self.assertLess(unreachable["upper_line_best_dollars"], 1000.0)
        self.assertGreater(
            unreachable["upper_line_best_dollars"],
            unreachable["upper_flat_dollars"],
        )

    def test_a_missed_target_is_flagged_on_the_row(self):
        expiration, dte = eligible_monthly(80, 120)
        candidate = HundredDayPlan().choose(
            skewed_put_chain(100.0, dte),
            dte,
            upper_line_target=10000.0,
        )
        row = run_scan_with(
            candidate,
            expiration,
            structure_variant="100dte",
            tranche_quantity=1,
            upper_line_mode="credit",
            upper_line_amount_dollars=10000,
        )["rows"][0]

        self.assertEqual(row["status"], "near_match")
        self.assertEqual(row["upper_line_target_dollars"], 10000.0)
        self.assertTrue(any(
            "credit of at least $10,000; the closest is $" in flag
            for flag in row["flags"]
        ))

    def test_default_limit_is_a_300_dollar_debit_at_the_base_size(self):
        expiration, dte = eligible_monthly(80, 120)
        candidate = HundredDayPlan().choose(skewed_put_chain(100.0, dte), dte)
        four = run_scan_with(candidate, expiration, structure_variant="100dte")
        two = run_scan_with(
            candidate,
            expiration,
            structure_variant="100dte",
            tranche_quantity=2,
        )

        self.assertEqual(four["params"]["upper_line_target_dollars"], -300.0)
        self.assertEqual(two["params"]["upper_line_target_dollars"], -150.0)
        # The regular CC4 plan takes the same debit or credit choice.
        cc4 = run_scan_with(
            base_candidate(*eligible_monthly()),
            eligible_monthly()[0],
            upper_line_mode="credit",
            upper_line_amount_dollars=50,
        )
        self.assertEqual(cc4["params"]["upper_line_target_dollars"], 50.0)
        self.assertEqual(cc4["rows"][0]["upper_line_mode"], "credit")

    def test_cc4_fits_its_lower_hedge_to_the_same_limit(self):
        chain = skewed_put_chain(100.0, 200)
        cc4 = HundredDayPlan()
        cc4.plan = scanner.STRUCTURE_VARIANTS["cc4"]
        roomy = cc4.choose(chain, 200, upper_line_target=-100000.0)
        tighter = cc4.choose(
            chain,
            200,
            upper_line_target=roomy["upper_flat_dollars"] + 1.0,
        )

        for chosen in (roomy, tighter):
            self.assertEqual(chosen["body_short_strike"], nearest_strike(chain, 0.15))
        self.assertGreaterEqual(
            tighter["upper_flat_dollars"],
            roomy["upper_flat_dollars"] + 1.0,
        )
        # Less debit comes from a cheaper, lower hedge.
        self.assertLess(tighter["lower_long_strike"], roomy["lower_long_strike"])


if __name__ == "__main__":
    unittest.main()
