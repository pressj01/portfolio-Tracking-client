"""Tests for the Road Trip unbalanced butterfly scanner.

The reference trade throughout is the one in the article: SPX at 2000 with a
1975/1930/1875 broken-wing put butterfly, a 45-point upper wing, a 55-point
lower wing, and an entry debit under 5% of the initial margin.
"""

from datetime import date, timedelta
import os
import sys
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import road_trip_butterfly_scanner as scanner
import unbalanced_butterfly_scanner as butterfly
from options_pricing import black_scholes


DTE = 77


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
        "dte": DTE,
    }


def expiration_for(dte=DTE):
    return (date.today() + timedelta(days=dte)).isoformat()


def article_butterfly(**overrides):
    """The article's 1975/1930/1875 structure at five contracts."""
    kwargs = {
        "upper_long": leg(1975, 40.0, -0.42),
        "body_short": leg(1930, 26.0, -0.31),
        "lower_long": leg(1875, 15.0, -0.20),
        "quantity": 5,
    }
    kwargs.update(overrides)
    return butterfly._build_butterfly(
        kwargs["upper_long"],
        kwargs["body_short"],
        kwargs["lower_long"],
        spot=2000.0,
        expiration=expiration_for(),
        dte=DTE,
        upper_long_target=0.42,
        tranche_quantity=kwargs["quantity"],
        lower_long_target=0.20,
        body_short_target=0.31,
        structure_kind="road-trip-butterfly",
        always_success_above_upper=True,
    )


def synthetic_chain(spot=2000.0, dte=DTE, low=1700, high=2000, step=5):
    """A skewed Black-Scholes put chain so structures price realistically."""
    years = dte / 365.0
    rows = []
    for strike in range(low, high + 1, step):
        iv = 0.14 + (spot - strike) / spot * 0.35
        priced = black_scholes(spot, strike, years, 0.0375, 0.0, iv, "put")
        rows.append({
            "strike": float(strike),
            "bid": priced["price"] - 0.25,
            "ask": priced["price"] + 0.25,
            "mid": priced["price"],
            "iv": iv,
            "delta": priced["delta"],
            "volume": 50,
            "open_interest": 500,
            "dte": dte,
        })
    return rows


def price_frame(
    spot=2000.0,
    *,
    down_day=True,
    vol_spike=True,
    daily_sigma=0.008,
    seed=7,
):
    """A close series with controllable recent volatility and last session.

    The most recent 30 sessions are scaled up for a spike or down for a lull.
    An unscaled random walk will not do: its trailing 20-day realized reading
    lands anywhere in its own one-year distribution by chance, which makes the
    percentile assertions flap.
    """
    rng = np.random.default_rng(seed)
    steps = rng.normal(0, daily_sigma, 300)
    steps[-30:] *= 4.0 if vol_spike else 0.2
    walk = np.cumsum(steps)
    walk -= walk[-1]
    closes = spot * np.exp(walk)
    closes[-2] = closes[-1] / (0.988 if down_day else 1.012)
    return pd.DataFrame({"Close": closes})


def run_scan(chain=None, frame=None, dte=DTE, **payload):
    expiration = expiration_for(dte)

    class FakeTicker:
        options = [expiration]

    with (
        patch.object(scanner, "_load_history", return_value=object()),
        patch.object(
            scanner,
            "_ticker_frame",
            return_value=price_frame() if frame is None else frame,
        ),
        patch.object(
            scanner,
            "_fetch_fundamentals_bulk",
            return_value={"SPY": {"name": "Test"}},
        ),
        patch.object(scanner.yf, "Ticker", return_value=FakeTicker()),
        patch.object(
            scanner,
            "_load_put_chain",
            return_value=synthetic_chain(dte=dte) if chain is None else chain,
        ),
    ):
        return scanner.run_road_trip_butterfly_scan({
            "tickers": "SPY",
            "target_dte": dte,
            "min_dte": dte,
            "max_dte": dte,
            **payload,
        })


class ArticleDefaults(unittest.TestCase):
    def test_defaults_match_the_article(self):
        self.assertEqual(scanner.DEFAULTS["min_dte"], 70)
        self.assertEqual(scanner.DEFAULTS["max_dte"], 85)
        self.assertEqual(scanner.DEFAULTS["tranche_quantity"], 5)
        self.assertEqual(scanner.DEFAULTS["max_debit_to_margin_pct"], 5.0)
        self.assertEqual(scanner.DEFAULTS["profit_target_low_pct"], 7.0)
        self.assertEqual(scanner.DEFAULTS["profit_target_high_pct"], 15.0)
        self.assertEqual(scanner.DEFAULTS["max_loss_pct"], 5.0)
        self.assertEqual(scanner.DEFAULTS["max_concurrent_positions"], 5)
        self.assertEqual(scanner.DEFAULTS["entry_interval_days"], 14)

    def test_planned_exit_and_hands_off_windows_match_the_article(self):
        # "exit 15 to 20 days before expiration" and "the first 21 to 30 days".
        self.assertTrue(
            15 <= scanner.DEFAULTS["exit_days_before_expiration"] <= 20
        )
        self.assertTrue(21 <= scanner.DEFAULTS["hands_off_days"] <= 30)

    def test_placement_defaults_encode_the_spx_example(self):
        # SPX 2000 -> 1975/1930/1875 is 1.25% behind with 45/55 wings.
        self.assertAlmostEqual(scanner.DEFAULTS["upper_offset_pct"], 1.25)
        self.assertAlmostEqual(scanner.DEFAULTS["upper_wing_pct"], 2.25)
        self.assertAlmostEqual(scanner.DEFAULTS["lower_wing_pct"], 2.75)

    def test_reference_geometry_expands_with_dte(self):
        self.assertAlmostEqual(
            scanner.dte_scaled_pct(2.25, scanner.REFERENCE_DTE, scanner.REFERENCE_DTE),
            2.25,
        )
        self.assertGreater(
            scanner.dte_scaled_pct(2.25, 154, scanner.REFERENCE_DTE),
            2.25,
        )


class ArticleStructure(unittest.TestCase):
    def test_broken_wing_geometry_and_margin_follow_the_article(self):
        result = article_butterfly()

        self.assertEqual(result["upper_width"], 45.0)
        self.assertEqual(result["lower_width"], 55.0)
        self.assertGreater(result["lower_wing_ratio"], 1.0)
        self.assertEqual(result["upper_long_quantity"], 5)
        self.assertEqual(result["body_short_quantity"], 10)
        self.assertEqual(result["lower_long_quantity"], 5)

        # Initial margin is the downside risk: (lower - upper) x 100 x lots,
        # plus the debit paid.
        debit = result["entry_debit_dollars"]
        self.assertAlmostEqual(
            result["max_loss_dollars"],
            5 * (55.0 - 45.0) * 100.0 + debit,
        )

    def test_entry_is_a_debit_with_a_losing_upper_expiration_line(self):
        result = article_butterfly()

        self.assertLess(result["entry_credit"], 0)
        self.assertGreater(result["entry_debit_dollars"], 0)
        # Above the upper long every put expires worthless and the debit is
        # simply lost. That loss is what the reverse Harvey later lifts.
        self.assertAlmostEqual(
            result["upper_flat_dollars"],
            -result["entry_debit_dollars"],
        )

    def test_managed_upside_is_success_but_unadjusted_debit_loss_is_disclosed(self):
        result = article_butterfly()
        terminal = [
            point for point in result["probability_schedule"]
            if point.get("kind") == "expiration"
        ][0]
        upper_strike = result["upper_long_strike"]
        self.assertTrue(any(
            band.get("lower") == upper_strike and band.get("upper") is None
            for band in terminal.get("profitable_ranges", [])
        ))
        self.assertGreater(
            terminal["probability_success_pct"],
            terminal["probability_unadjusted_success_pct"],
        )
        self.assertGreater(terminal["probability_managed_upside_pct"], 0)

    def test_spy_reference_payoff_matches_the_risk_graph_arithmetic(self):
        """The supplied 738/723/702 five-lot costs $120 total."""
        result = butterfly._build_butterfly(
            leg(738, 20.0, -0.42, iv=0.1403),
            leg(723, 12.0, -0.31, iv=0.1561),
            leg(702, 4.24, -0.20, iv=0.1783),
            spot=747.03,
            expiration=expiration_for(),
            dte=DTE,
            upper_long_target=0.42,
            tranche_quantity=5,
            lower_long_target=0.20,
            body_short_target=0.31,
            structure_kind="road-trip-butterfly",
            dividend_yield=0.011,
            always_success_above_upper=True,
            exit_points=scanner._management_exit_points(DTE),
        )

        self.assertAlmostEqual(result["entry_debit_dollars"], 120.0)
        self.assertAlmostEqual(result["max_profit_dollars"], 7380.0)
        self.assertAlmostEqual(result["max_loss_dollars"], 3120.0)
        self.assertAlmostEqual(result["lower_breakeven"], 708.24)
        self.assertAlmostEqual(result["upper_breakeven"], 737.76)
        by_label = {
            point["label"]: point for point in result["probability_schedule"]
        }
        self.assertGreater(
            by_label["Halfway close"]["probability_success_pct"],
            80.0,
        )
        self.assertGreater(
            by_label["Two-thirds close"]["probability_success_pct"],
            80.0,
        )

    def test_body_delta_target_is_the_road_trip_body_not_fifteen_delta(self):
        result = article_butterfly()
        self.assertAlmostEqual(result["target_body_short_delta"], 0.31)
        self.assertAlmostEqual(result["body_short_delta_error"], 0.0)

    def test_shared_builder_keeps_its_course_defaults(self):
        """The two new parameters must not change the STT screens."""
        course = butterfly._build_butterfly(
            leg(100, 10, -0.25),
            leg(90, 7, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_for(180),
            dte=180,
            upper_long_target=0.25,
        )
        self.assertAlmostEqual(
            course["target_body_short_delta"],
            butterfly.BODY_SHORT_TARGET,
        )


class SelectionRules(unittest.TestCase):
    def test_scan_reproduces_the_articles_own_placement(self):
        result = run_scan()
        row = result["rows"][0]

        self.assertEqual(row["upper_long_strike"], 1975.0)
        self.assertEqual(row["lower_long_strike"], 1875.0)
        self.assertAlmostEqual(row["actual_upper_offset_pct"], 1.25, places=2)
        self.assertTrue(row["behind_the_market"])
        self.assertGreater(row["lower_width"], row["upper_width"])

    def test_debit_rule_is_a_ceiling_not_a_quantity_to_minimize(self):
        """Ranking on cheapness alone collapses to the narrowest wings.

        The scanner returns one row per ticker, so the ordering has to be
        checked against the whole ranked candidate list, not the winner alone.
        """
        ranked = scanner._candidates(
            synthetic_chain(),
            spot=2000.0,
            expiration=expiration_for(),
            expiration_date=date.today() + timedelta(days=DTE),
            dte=DTE,
            quantity=5,
            upper_offset_pct=1.25,
            offset_tolerance_pct=0.75,
            upper_wing_pct=2.25,
            lower_wing_pct=2.75,
            wing_tolerance_pct=1.0,
            min_lower_wing_ratio=1.05,
            dividend_yield=0.0,
            bias_low=-40.0,
            bias_high=40.0,
            max_debit_to_margin_pct=5.0,
            min_theta_dollars=1.0,
            exit_days_before_expiration=17,
            hands_off_days=25,
            profit_target_low_pct=7.0,
            profit_target_high_pct=15.0,
            max_loss_pct=5.0,
            downside_hedge_width_pct=0.5,
        )
        self.assertGreater(len(ranked), 5)

        def geometry(row):
            return row["upper_offset_error_pct"] + row["wing_error_pct"]

        winner = ranked[0]
        cheapest = min(ranked, key=lambda row: row["debit_to_margin_pct"])
        passing = [
            row for row in ranked if row["debit_to_margin_pct"] <= 5.0
        ]
        self.assertTrue(passing)

        # Geometry decides, but only within the price rule.
        self.assertLessEqual(winner["debit_to_margin_pct"], 5.0)
        self.assertLessEqual(
            geometry(winner),
            min(geometry(row) for row in passing) + 1e-9,
        )
        # And it is genuinely a different choice from the cheapest structure.
        self.assertLess(geometry(winner), geometry(cheapest))

    def test_the_price_rule_can_exclude_the_best_fitting_geometry(self):
        """The 5% rule outranks the article's own illustrative wing widths.

        A 45/55 broken wing risks only (55 - 45) x 100 x lots, so its margin
        base is small and the debit ratio is correspondingly sensitive. Widening
        the lower wing raises margin and cheapens the lower long at the same
        time, which is why the price rule, not the illustration, governs.
        """
        ranked = scanner._candidates(
            synthetic_chain(),
            spot=2000.0,
            expiration=expiration_for(),
            expiration_date=date.today() + timedelta(days=DTE),
            dte=DTE,
            quantity=5,
            upper_offset_pct=1.25,
            offset_tolerance_pct=0.75,
            upper_wing_pct=2.25,
            lower_wing_pct=2.75,
            wing_tolerance_pct=1.0,
            min_lower_wing_ratio=1.05,
            dividend_yield=0.0,
            bias_low=-40.0,
            bias_high=40.0,
            max_debit_to_margin_pct=5.0,
            min_theta_dollars=1.0,
            exit_days_before_expiration=17,
            hands_off_days=25,
            profit_target_low_pct=7.0,
            profit_target_high_pct=15.0,
            max_loss_pct=5.0,
            downside_hedge_width_pct=0.5,
        )
        exact = [
            row for row in ranked
            if (row["upper_long_strike"], row["body_short_strike"],
                row["lower_long_strike"]) == (1975.0, 1930.0, 1875.0)
        ]
        self.assertEqual(len(exact), 1, "the article's own strikes are priced")
        self.assertEqual(exact[0]["upper_width"], 45.0)
        self.assertEqual(exact[0]["lower_width"], 55.0)
        self.assertGreater(exact[0]["debit_to_margin_pct"], 5.0)
        self.assertIsNot(ranked[0], exact[0])
        # The winner buys its way inside the rule with a wider lower wing.
        self.assertGreater(
            ranked[0]["lower_wing_ratio"], exact[0]["lower_wing_ratio"],
        )

    def test_an_expensive_entry_is_flagged_and_not_actionable(self):
        expensive = article_butterfly()
        scanner._enrich_candidate(
            expensive,
            legs=synthetic_chain(),
            upper_long=leg(1975, 40.0, -0.42),
            body_short=leg(1930, 26.0, -0.31),
            lower_long=leg(1875, 15.0, -0.20),
            spot=2000.0,
            dte=DTE,
            quantity=5,
            dividend_yield=0.0,
            expiration_date=date.today() + timedelta(days=DTE),
            exit_days_before_expiration=17,
            hands_off_days=25,
            profit_target_low_pct=7.0,
            profit_target_high_pct=15.0,
            max_loss_pct=5.0,
            downside_hedge_width_pct=0.5,
            upper_offset_pct=1.25,
            upper_wing_pct=2.25,
            lower_wing_pct=2.75,
        )
        self.assertGreater(expensive["debit_to_margin_pct"], 5.0)

        with patch.object(scanner, "_candidates", return_value=[expensive]):
            row = run_scan()["rows"][0]

        self.assertEqual(row["status"], "near_match")
        self.assertEqual(row["structural_status"], "near_match")
        self.assertTrue(any(
            "percentage-of-margin" in flag for flag in row["structure_flags"]
        ))

    def test_weekly_expirations_are_eligible(self):
        """Unlike the STT screens, the road trip trade uses weeklies."""
        weeklies = [
            (date.today() + timedelta(days=offset)).isoformat()
            for offset in range(70, 86)
        ]
        non_monthly = [
            value for value in weeklies
            if not butterfly._is_standard_monthly(value)
        ]
        self.assertTrue(non_monthly, "expected a non-monthly date in range")

        window = scanner._expirations_in_window(non_monthly, DTE, 70, 85)
        self.assertEqual(len(window), len(non_monthly))
        self.assertTrue(all(not is_monthly for _, _, is_monthly in window))

    def test_delta_band_scales_with_contract_count(self):
        one = run_scan(tranche_quantity=1)
        five = run_scan(tranche_quantity=5)
        self.assertAlmostEqual(
            five["params"]["bias_delta_max"],
            one["params"]["bias_delta_max"] * 5,
        )


class Adjustments(unittest.TestCase):
    def test_reverse_harvey_roll_generates_a_credit_and_lifts_the_line(self):
        row = run_scan()["rows"][0]

        # The credit comes from rolling the upper long in toward the body.
        self.assertLess(row["reverse_harvey_roll_strike"], row["upper_long_strike"])
        self.assertGreater(row["reverse_harvey_roll_strike"], row["body_short_strike"])
        self.assertGreater(row["reverse_harvey_credit_dollars"], 0)
        self.assertGreater(
            row["reverse_harvey_upper_flat_dollars"],
            row["upper_flat_dollars"],
        )

    def test_downside_hedge_is_a_debit_spread_triggered_at_the_body(self):
        row = run_scan()["rows"][0]

        self.assertEqual(
            row["downside_hedge_trigger_price"],
            row["body_short_strike"],
        )
        # A long put debit spread buys the higher strike and sells below it.
        self.assertGreater(
            row["downside_hedge_long_strike"],
            row["downside_hedge_short_strike"],
        )
        self.assertGreater(row["downside_hedge_debit_dollars"], 0)
        self.assertAlmostEqual(
            row["downside_hedge_close_low_dollars"],
            round(row["downside_hedge_debit_dollars"] * 0.50),
        )

    def test_targets_and_stop_are_percentages_of_capital_at_risk(self):
        row = run_scan()["rows"][0]
        margin = row["initial_margin_dollars"]

        self.assertAlmostEqual(
            row["profit_target_low_dollars"], round(margin * 0.07),
        )
        self.assertAlmostEqual(
            row["profit_target_high_dollars"], round(margin * 0.15),
        )
        self.assertAlmostEqual(row["stop_loss_dollars"], round(margin * 0.05))

    def test_planned_exit_lands_before_expiration(self):
        row = run_scan()["rows"][0]
        self.assertEqual(row["planned_exit_dte"], 17)
        self.assertEqual(row["planned_hold_days"], DTE - 17)
        self.assertIsNotNone(row["planned_exit_unchanged_pl_dollars"])
        self.assertEqual(row["close_window_start_dte"], 39)
        self.assertEqual(row["close_window_end_dte"], 26)
        self.assertIsNotNone(row["two_thirds_close_unchanged_pl_dollars"])

    def test_probability_cards_use_the_preferred_close_window(self):
        row = run_scan()["rows"][0]
        schedule = row["probability_schedule"]

        self.assertEqual(
            [point["label"] for point in schedule],
            ["Halfway close", "Two-thirds close", "Expiration"],
        )
        by_label = {point["label"]: point for point in schedule}
        self.assertEqual(by_label["Halfway close"]["elapsed_days"], 38)
        self.assertEqual(by_label["Two-thirds close"]["remaining_dte"], 26)

        # The card and the detail metric must agree on the same exit mark.
        self.assertEqual(
            by_label["Two-thirds close"]["unchanged_spot_pl_dollars"],
            row["two_thirds_close_unchanged_pl_dollars"],
        )

    def test_closing_early_beats_running_to_expiration(self):
        """The whole reason the model exits 15-20 days out."""
        row = run_scan()["rows"][0]
        by_label = {
            point["label"]: point for point in row["probability_schedule"]
        }
        self.assertGreater(
            by_label["Two-thirds close"]["probability_success_pct"],
            by_label["Expiration"]["probability_success_pct"],
        )

    def test_shared_builder_keeps_its_own_exit_points_by_default(self):
        course = butterfly._build_butterfly(
            leg(100, 10, -0.25),
            leg(90, 7, -0.15),
            leg(70, 2, -0.05),
            spot=110,
            expiration=expiration_for(180),
            dte=180,
            upper_long_target=0.25,
        )
        self.assertEqual(
            [point["label"] for point in course["probability_schedule"]],
            ["Halfway review", "Two-thirds review", "Expiration"],
        )


class EntryTiming(unittest.TestCase):
    def test_down_day_with_elevated_volatility_is_favorable(self):
        row = run_scan(
            frame=price_frame(down_day=True, vol_spike=True),
        )["rows"][0]
        self.assertLess(row["session_change_pct"], 0)
        self.assertTrue(row["entry_is_down_day"])
        self.assertTrue(row["entry_vol_elevated"])
        self.assertGreaterEqual(row["realized_vol_percentile"], 50)
        self.assertEqual(row["entry_timing_status"], "favorable")

    def test_up_day_downgrades_the_timing_grade(self):
        row = run_scan(
            frame=price_frame(down_day=False, vol_spike=True),
        )["rows"][0]
        self.assertFalse(row["entry_is_down_day"])
        self.assertNotEqual(row["entry_timing_status"], "favorable")

    def test_quiet_volatility_is_not_elevated_however_rich_the_premium(self):
        """A rich IV-over-realized ratio is the normal state, not a signal."""
        row = run_scan(
            frame=price_frame(down_day=True, vol_spike=False),
        )["rows"][0]
        self.assertLess(row["realized_vol_percentile"], 50)
        # The synthetic chain is priced well above this quiet realized vol.
        self.assertGreater(row["iv_vs_realized_ratio"], 1.0)
        self.assertFalse(row["entry_vol_elevated"])
        self.assertEqual(row["entry_timing_status"], "acceptable")

    def test_a_quiet_up_day_is_unfavorable(self):
        row = run_scan(
            frame=price_frame(down_day=False, vol_spike=False),
        )["rows"][0]
        self.assertEqual(row["entry_timing_status"], "unfavorable")

    def test_timing_is_advisory_unless_the_user_requires_it(self):
        quiet_up_day = {"frame": price_frame(down_day=False, vol_spike=False)}
        advisory = run_scan(**quiet_up_day)["rows"][0]
        self.assertNotIn(
            "preferred down day",
            " ".join(advisory["blocking_flags"]),
        )

        required = run_scan(
            **quiet_up_day,
            require_favorable_entry_timing=True,
        )["rows"][0]
        self.assertEqual(required["status"], "near_match")
        self.assertTrue(any(
            "preferred down day" in flag
            for flag in required["blocking_flags"]
        ))


class Laddering(unittest.TestCase):
    def test_a_full_ladder_blocks_another_entry(self):
        row = run_scan(open_positions=5, max_concurrent_positions=5)["rows"][0]
        self.assertEqual(row["status"], "near_match")
        self.assertEqual(row["structural_status"], "matched")
        self.assertTrue(any(
            "concurrent" in flag for flag in row["ladder_flags"]
        ))

    def test_entering_too_soon_after_the_last_position_is_flagged(self):
        row = run_scan(days_since_last_entry=3, entry_interval_days=14)["rows"][0]
        self.assertTrue(any(
            "days have passed" in flag for flag in row["ladder_flags"]
        ))

    def test_a_staggered_ladder_with_room_is_clean(self):
        row = run_scan(open_positions=2, days_since_last_entry=14)["rows"][0]
        self.assertEqual(row["ladder_flags"], [])


if __name__ == "__main__":
    unittest.main()
