"""Tests for the shared option-scanner probability schedules."""

from __future__ import annotations

import math
import os
import sys
import unittest
from datetime import date, timedelta
from random import Random
from statistics import NormalDist

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from option_probability import (
    price_scenario_schedule,
    profit_capture_schedule,
    profit_probability_schedule,
)
from options_pricing import black_scholes


class ProfitProbabilityScheduleTests(unittest.TestCase):
    def test_short_put_has_planned_exit_and_complementary_expiration_odds(self):
        schedule = profit_probability_schedule(
            spot=100,
            dte=30,
            expiration="2026-08-29",
            distribution_iv=0.20,
            entry_cashflow=2.0,
            legs=[{
                "option_type": "put",
                "strike": 95,
                "iv": 0.20,
                "quantity": -1,
            }],
            exit_points=[{
                "kind": "reassess",
                "label": "Reassess / exit",
                "remaining_dte": 15,
            }],
        )

        self.assertEqual([point["kind"] for point in schedule], ["reassess", "expiration"])
        self.assertEqual(schedule[0]["exit_date"], "2026-08-14")
        self.assertEqual(schedule[1]["exit_date"], "2026-08-29")
        for point in schedule:
            self.assertAlmostEqual(
                point["probability_success_pct"] + point["probability_failure_pct"],
                100.0,
                places=7,
            )

        # At expiration a short 95 put sold for 2 is profitable above 93.
        years = 30 / 365.0
        d2 = (
            math.log(100 / 93)
            - 0.5 * 0.20 * 0.20 * years
        ) / (0.20 * math.sqrt(years))
        expected_success = NormalDist().cdf(d2) * 100.0
        self.assertAlmostEqual(
            schedule[-1]["probability_success_pct"],
            expected_success,
            delta=0.15,
        )

    def test_credit_spread_schedule_includes_reassess_close_by_and_expiration(self):
        schedule = profit_probability_schedule(
            spot=100,
            dte=45,
            expiration="2026-09-13",
            distribution_iv=0.24,
            entry_cashflow=1.20,
            legs=[
                {"option_type": "put", "strike": 95, "iv": 0.25, "quantity": -1},
                {"option_type": "put", "strike": 90, "iv": 0.27, "quantity": 1},
            ],
            exit_points=[
                {"kind": "reassess", "label": "Reassess", "remaining_dte": 21},
                {
                    "kind": "ex_dividend",
                    "label": "Exit before ex-dividend",
                    "exit_date": "2026-09-01",
                },
                {"kind": "close_by", "label": "Close by", "remaining_dte": 3},
            ],
        )

        self.assertEqual(
            [point["remaining_dte"] for point in schedule],
            [21, 12, 3, 0],
        )
        self.assertEqual(schedule[1]["exit_date"], "2026-09-01")
        self.assertTrue(all(
            0 <= point["probability_success_pct"] <= 100
            for point in schedule
        ))
        self.assertTrue(all(
            point["probability_failure_pct"]
            == round(100.0 - point["probability_success_pct"], 1)
            for point in schedule
        ))

    def test_covered_call_probability_includes_the_share_position(self):
        schedule = profit_probability_schedule(
            spot=100,
            dte=30,
            expiration="2026-08-29",
            distribution_iv=0.20,
            entry_cashflow=2.0,
            legs=[{
                "option_type": "call",
                "strike": 105,
                "iv": 0.20,
                "quantity": -1,
            }],
            underlying_quantity=1,
        )

        terminal = schedule[-1]
        profitable_range = terminal["profitable_ranges"][0]
        self.assertAlmostEqual(profitable_range["lower"], 98.0, places=2)
        self.assertIsNone(profitable_range["upper"])
        self.assertAlmostEqual(
            terminal["probability_success_pct"]
            + terminal["probability_failure_pct"],
            100.0,
            places=7,
        )

    def test_managed_upper_region_keeps_unadjusted_probability_visible(self):
        schedule = profit_probability_schedule(
            spot=100,
            dte=60,
            expiration="2026-09-28",
            distribution_iv=0.20,
            entry_cashflow=-0.25,
            legs=[
                {"option_type": "put", "strike": 98, "iv": 0.18, "quantity": 1},
                {"option_type": "put", "strike": 94, "iv": 0.20, "quantity": -2},
                {"option_type": "put", "strike": 89, "iv": 0.23, "quantity": 1},
            ],
            exit_points=[{
                "kind": "planned_exit",
                "label": "Two-thirds close",
                "remaining_dte": 20,
            }],
            always_success_above=98,
            include_breakeven=True,
        )

        for point in schedule:
            self.assertGreaterEqual(
                point["probability_success_pct"],
                point["probability_unadjusted_success_pct"],
            )
            self.assertAlmostEqual(
                point["probability_success_pct"],
                point["probability_unadjusted_success_pct"]
                + point["probability_managed_upside_pct"],
                delta=0.2,
            )

    def test_missing_iv_suppresses_schedule(self):
        self.assertEqual(
            profit_probability_schedule(
                spot=100,
                dte=30,
                expiration="2026-08-29",
                distribution_iv=None,
                entry_cashflow=2,
                legs=[{
                    "option_type": "put",
                    "strike": 95,
                    "iv": 0.20,
                    "quantity": -1,
                }],
            ),
            [],
        )


if __name__ == "__main__":
    unittest.main()


class PriceScenarioScheduleTests(unittest.TestCase):
    """The scenario table: what the trade is worth each month, at three prices."""

    BROKEN_WING_FLY = dict(
        spot=711.37,
        dte=176,
        expiration="2027-02-19",
        distribution_iv=0.262,
        entry_cashflow=-1.76,
        legs=[
            {"option_type": "put", "strike": 630, "iv": 0.2419, "quantity": 4},
            {"option_type": "put", "strike": 600, "iv": 0.2620, "quantity": -8},
            {"option_type": "put", "strike": 560, "iv": 0.2900, "quantity": 4},
        ],
        risk_free_rate=0.0375,
        dividend_yield=0.005,
    )

    def test_columns_are_one_a_month_ending_at_expiration(self):
        data = price_scenario_schedule(**self.BROKEN_WING_FLY)
        columns = data["columns"]
        self.assertEqual(columns[-1]["remaining_dte"], 0)
        self.assertEqual(columns[-1]["kind"], "expiration")
        self.assertEqual(columns[-1]["exit_date"], "2027-02-19")
        # Strictly earlier to later, roughly a month apart.
        gaps = [
            columns[index]["remaining_dte"] - columns[index + 1]["remaining_dte"]
            for index in range(len(columns) - 1)
        ]
        self.assertTrue(all(20 <= gap <= 35 for gap in gaps), gaps)
        self.assertEqual(columns[0]["month_label"], "September 2026")

    def test_rows_step_toward_and_away_from_the_tent(self):
        # The tent is below spot on a put structure, so "toward" is a lower
        # price. Taking the direction from the strikes rather than assuming it
        # is what lets a call structure share this code.
        data = price_scenario_schedule(**self.BROKEN_WING_FLY)
        self.assertTrue(data["downside"])
        self.assertAlmostEqual(data["tent_edge"], 630.0, places=2)
        current, toward, away = data["rows"]
        self.assertAlmostEqual(current["price"], 711.37, places=2)
        self.assertAlmostEqual(toward["price"], 711.37 * 0.95, places=2)
        self.assertAlmostEqual(away["price"], 711.37 * 1.05, places=2)
        self.assertTrue(current["is_spot"])

    def test_moving_toward_the_tent_pays_more_than_moving_away(self):
        data = price_scenario_schedule(**self.BROKEN_WING_FLY)
        _, toward, away = data["rows"]
        for near, far in zip(toward["cells"][:-1], away["cells"][:-1]):
            self.assertGreater(near["profit"], far["profit"], near["exit_date"])
        # At expiration the advantage vanishes: both prices are above the upper
        # wing, so every leg expires worthless and both rows are the same full
        # debit. Being nearer the tent only pays while there is time value left
        # to sell it back.
        self.assertEqual(toward["cells"][-1]["profit"], away["cells"][-1]["profit"])
        self.assertLess(toward["cells"][-1]["profit"], 0)

    def test_touch_odds_grow_with_time_and_the_spot_row_is_certain(self):
        data = price_scenario_schedule(**self.BROKEN_WING_FLY)
        current, toward, _ = data["rows"]
        for cell in current["cells"]:
            self.assertEqual(cell["touch_pct"], 100.0)
        touches = [cell["touch_pct"] for cell in toward["cells"]]
        self.assertEqual(touches, sorted(touches))
        # Reaching a level is always likelier than being past it on the day.
        for cell in toward["cells"]:
            self.assertGreaterEqual(cell["touch_pct"], cell["beyond_pct"])

    def test_each_row_flags_its_own_best_month(self):
        data = price_scenario_schedule(**self.BROKEN_WING_FLY)
        for row in data["rows"]:
            flagged = [cell for cell in row["cells"] if cell["is_row_best"]]
            self.assertEqual(len(flagged), 1, row["label"])
            self.assertEqual(
                flagged[0]["profit"],
                max(cell["profit"] for cell in row["cells"]),
            )
            self.assertEqual(
                row["best_month"]["remaining_dte"], flagged[0]["remaining_dte"]
            )

    def test_the_best_month_differs_by_price_rather_than_being_expiration(self):
        # The point of the table: at an unchanged price this fly peaks months
        # before expiry and then bleeds to the full debit, so a single "hold to
        # expiration" answer would be wrong for two of the three rows.
        data = price_scenario_schedule(**self.BROKEN_WING_FLY)
        current, toward, away = data["rows"]
        self.assertGreater(current["best_month"]["remaining_dte"], 0)
        self.assertGreater(toward["best_month"]["remaining_dte"], 0)
        self.assertGreater(away["best_month"]["remaining_dte"], 0)
        self.assertNotEqual(
            current["best_month"]["month_label"], toward["best_month"]["month_label"]
        )
        for row in (current, toward, away):
            self.assertEqual(row["cells"][-1]["profit_dollars"], -176.0)

    def test_hold_zone_runs_from_inside_the_tent_to_above_spot(self):
        data = price_scenario_schedule(**self.BROKEN_WING_FLY)
        zone = data["zone"]
        self.assertAlmostEqual(zone["low"], 630.0 * 0.99, places=2)
        self.assertAlmostEqual(zone["high"], 711.37 * 1.10, places=2)
        for column in data["columns"]:
            self.assertGreaterEqual(column["zone_best_price"], zone["low"] - 1e-6)
            self.assertLessEqual(column["zone_best_price"], zone["high"] + 1e-6)

    def test_zone_best_is_never_beaten_by_a_row_at_the_same_date(self):
        # The rows sit inside the zone, so the zone scan has to dominate them.
        data = price_scenario_schedule(**self.BROKEN_WING_FLY)
        ceilings = {
            column["remaining_dte"]: column["zone_best_profit"]
            for column in data["columns"]
        }
        for row in data["rows"]:
            if not zone_contains(data, row["price"]):
                continue
            for cell in row["cells"]:
                self.assertGreaterEqual(
                    ceilings[cell["remaining_dte"]] + 1e-6, cell["profit"]
                )

    def test_a_short_dated_trade_still_gets_expiration(self):
        data = price_scenario_schedule(**{
            **self.BROKEN_WING_FLY, "dte": 20, "expiration": "2026-09-16",
        })
        self.assertEqual([c["remaining_dte"] for c in data["columns"]], [0])

    def test_missing_volatility_suppresses_the_table(self):
        self.assertIsNone(price_scenario_schedule(**{
            **self.BROKEN_WING_FLY, "distribution_iv": None,
        }))


def zone_contains(data, value):
    return data["zone"]["low"] <= value <= data["zone"]["high"]


class ProfitCaptureScheduleTests(unittest.TestCase):
    """The capture panel: odds of banking part of the maximum profit early."""

    CREDIT_SPREAD = dict(
        spot=100,
        dte=31,
        expiration="2026-09-18",
        distribution_iv=0.30,
        entry_cashflow=0.45,
        legs=[
            {"option_type": "call", "strike": 110, "iv": 0.30, "quantity": -1},
            {"option_type": "call", "strike": 115, "iv": 0.30, "quantity": 1},
        ],
        risk_free_rate=0.04,
    )

    def test_credit_spread_max_profit_is_the_credit(self):
        capture = profit_capture_schedule(**self.CREDIT_SPREAD)
        self.assertIsNotNone(capture)
        self.assertAlmostEqual(capture["max_profit"], 0.45, places=2)
        self.assertEqual(
            [target["fraction"] for target in capture["targets"]],
            [0.5, 0.6667],
        )

    def test_debit_spread_max_profit_is_width_less_debit(self):
        capture = profit_capture_schedule(
            spot=100,
            dte=31,
            expiration="2026-09-18",
            distribution_iv=0.30,
            entry_cashflow=-1.94,
            legs=[
                {"option_type": "put", "strike": 100, "iv": 0.30, "quantity": 1},
                {"option_type": "put", "strike": 95, "iv": 0.30, "quantity": -1},
            ],
        )
        self.assertIsNotNone(capture)
        self.assertAlmostEqual(capture["max_profit"], 5 - 1.94, places=2)

    def test_unbounded_payoff_gets_no_capture_targets(self):
        # A long call has no maximum profit, so there is no fraction of it to
        # target and the panel must stay off rather than invent a ceiling.
        self.assertIsNone(profit_capture_schedule(
            spot=100,
            dte=31,
            expiration="2026-09-18",
            distribution_iv=0.30,
            entry_cashflow=-2.5,
            legs=[
                {"option_type": "call", "strike": 105, "iv": 0.30, "quantity": 1},
            ],
        ))

    BROKEN_WING_FLY = dict(
        # A long put butterfly whose body sits far below spot with half a year
        # to run: the shape only pays near expiration, so partial-profit
        # targets are unquotable at the early checkpoints.
        spot=711.37,
        dte=176,
        expiration="2027-02-19",
        distribution_iv=0.262,
        entry_cashflow=-1.76,
        legs=[
            {"option_type": "put", "strike": 630, "iv": 0.2419, "quantity": 4},
            {"option_type": "put", "strike": 600, "iv": 0.2620, "quantity": -8},
            {"option_type": "put", "strike": 560, "iv": 0.2900, "quantity": 4},
        ],
        risk_free_rate=0.0375,
        dividend_yield=0.005,
    )

    def test_butterfly_max_profit_lands_on_the_body_strike(self):
        # The peak is a kink sitting exactly on the body. A log-spaced scan
        # steps past it, and every capture target is a fraction of whatever it
        # reports, so the strikes have to be in the grid.
        capture = profit_capture_schedule(**self.BROKEN_WING_FLY)
        self.assertAlmostEqual(capture["max_profit"], 4 * (630 - 600) - 1.76, places=2)

    def test_unreachable_target_is_flagged_rather_than_shown_as_long_odds(self):
        # $0 of the target is available at 88 DTE no matter where price goes:
        # that is arithmetic about the structure, not a 0% market call.
        capture = profit_capture_schedule(**self.BROKEN_WING_FLY)
        for target in capture["targets"]:
            early, _, expiry = target["horizons"]
            self.assertFalse(early["reachable"], target["label"])
            self.assertEqual(early["probability_by_pct"], 0.0)
            self.assertLess(early["best_profit"], target["target_profit"])
            self.assertTrue(expiry["reachable"], target["label"])
            self.assertAlmostEqual(
                expiry["best_profit"], capture["max_profit"], places=2
            )

    def test_unreachable_target_reports_when_it_becomes_priceable(self):
        capture = profit_capture_schedule(**self.BROKEN_WING_FLY)
        half, two_thirds = capture["targets"]
        # The greedier target needs the tent to converge further, so it opens
        # later, and neither is available at the panel's early checkpoints.
        self.assertLess(two_thirds["reachable_from_dte"], half["reachable_from_dte"])
        self.assertLess(half["reachable_from_dte"], half["horizons"][1]["remaining_dte"])
        self.assertEqual(
            half["reachable_from_date"],
            (date(2027, 2, 19) - timedelta(days=half["reachable_from_dte"])).isoformat(),
        )

    def test_a_reachable_target_carries_no_out_of_reach_flag(self):
        # The credit spread can be bought back for half its credit at any point,
        # so nothing in its panel should be marked unreachable.
        capture = profit_capture_schedule(**self.CREDIT_SPREAD)
        for target in capture["targets"]:
            for point in target["horizons"]:
                self.assertTrue(point["reachable"], f'{target["label"]} @ {point["remaining_dte"]}')
            self.assertEqual(target["reachable_from_dte"], 31)

    def test_reaching_a_target_is_likelier_than_still_holding_it(self):
        capture = profit_capture_schedule(**self.CREDIT_SPREAD)
        for target in capture["targets"]:
            for point in target["horizons"]:
                self.assertGreaterEqual(
                    point["probability_by_pct"],
                    point["probability_at_pct"] - 1e-9,
                    f'{target["label"]} at {point["remaining_dte"]} DTE',
                )

    def test_odds_improve_with_time_and_worsen_with_a_greedier_target(self):
        capture = profit_capture_schedule(**self.CREDIT_SPREAD)
        half, two_thirds = capture["targets"]
        for target in capture["targets"]:
            by_horizon = [point["probability_by_pct"] for point in target["horizons"]]
            self.assertEqual(by_horizon, sorted(by_horizon))
        for cheap, greedy in zip(half["horizons"], two_thirds["horizons"]):
            self.assertGreater(cheap["probability_by_pct"], greedy["probability_by_pct"])

    def test_horizons_land_on_the_requested_fractions_of_the_trade(self):
        capture = profit_capture_schedule(**self.CREDIT_SPREAD)
        points = capture["targets"][0]["horizons"]
        self.assertEqual([point["remaining_dte"] for point in points], [16, 10, 0])
        self.assertEqual([point["exit_date"] for point in points], [
            "2026-09-02", "2026-09-08", "2026-09-18",
        ])
        self.assertEqual(points[-1]["kind"], "expiration")

    def test_first_passage_odds_match_a_monte_carlo_of_the_same_barrier(self):
        # The panel's headline number is a first-passage probability computed on
        # a grid. Simulating the same moving barrier independently confirms the
        # grid is not merely self-consistent.
        capture = profit_capture_schedule(**self.CREDIT_SPREAD)
        target = capture["targets"][0]
        threshold = target["target_profit"]
        credit, years = 0.45, 31 / 365.0
        steps, paths = 248, 60_000

        def spread_value(spot, remaining_years):
            return (
                black_scholes(spot, 110, remaining_years, 0.04, 0.0, 0.30, "call")["price"]
                - black_scholes(spot, 115, remaining_years, 0.04, 0.0, 0.30, "call")["price"]
            )

        step_years = years / steps
        random = Random(11)
        drift = (0.04 - 0.5 * 0.30 * 0.30) * step_years
        diffusion = 0.30 * math.sqrt(step_years)
        barriers = []
        for index in range(steps):
            remaining = years - (index + 1) * step_years
            low, high = 1.0, 400.0
            for _ in range(60):
                mid = 0.5 * (low + high)
                if credit - spread_value(mid, remaining) >= threshold:
                    low = mid
                else:
                    high = mid
            barriers.append(low)

        hits = 0
        for _ in range(paths):
            log_spot = math.log(100.0)
            for index in range(steps):
                log_spot += drift + diffusion * random.gauss(0.0, 1.0)
                if math.exp(log_spot) <= barriers[index]:
                    hits += 1
                    break
        simulated = hits / paths * 100.0
        self.assertAlmostEqual(
            target["horizons"][-1]["probability_by_pct"],
            simulated,
            delta=1.0,
        )
