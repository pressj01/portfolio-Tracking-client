import os
import sys
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from flask import Flask

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import options_api
from options_backtest import STRATEGIES, monthly_expirations, run_options_backtest


def deterministic_history(start="2020-01-01", end="2023-12-29"):
    index = pd.bdate_range(start, end)
    positions = np.arange(len(index), dtype=float)
    close = 100.0 * np.exp(positions * (0.12 / 252.0))
    close *= 1.0 + 0.025 * np.sin(positions / 17.0)
    dividend = np.zeros(len(index))
    dividend[::63] = 0.40
    return pd.DataFrame({
        "open": close * 0.999,
        "close": close,
        "dividend": dividend,
        "spy_close": close * 1.02,
        "qqq_close": close * 1.08,
        "vix": np.full(len(index), 20.0),
        "vxn": np.full(len(index), 24.0),
        "irx": np.full(len(index), 4.5),
    }, index=index)


def payload(**overrides):
    values = {
        "ticker": "SPY",
        "strategy": "covered_call",
        "start": "2021-01-04",
        "end": "2023-12-29",
        "initial_capital": 100000,
        "target_dte": 30,
        "target_delta": 0.30,
        "pricing_model": "black-scholes",
        "commission_per_contract": 0.65,
        "slippage_pct": 0.05,
        "minimum_slippage": 0.02,
    }
    values.update(overrides)
    return values


class OptionsBacktestEngineTests(unittest.TestCase):
    def test_incomplete_current_month_is_not_treated_as_an_expiration(self):
        index = pd.bdate_range("2026-06-01", "2026-07-15")
        expirations = monthly_expirations(index)

        self.assertIn(pd.Timestamp("2026-06-19"), expirations)
        self.assertFalse(any(expiration.month == 7 for expiration in expirations))

    def test_returns_scenarios_benchmark_metrics_and_reconciled_cycles(self):
        result = run_options_backtest(payload(), history=deterministic_history())

        self.assertTrue(result["modeled"])
        self.assertEqual(set(result["scenarios"]), {"conservative", "base", "favorable"})
        self.assertGreater(result["benchmark"]["metrics"]["ending_value"], 0)
        self.assertEqual(result["assumptions"]["volatility_index"], "VIX")
        self.assertIn("no historical option quotes", result["data_sources"]["option_quotes"].lower())

        base = result["scenarios"]["base"]
        self.assertGreater(base["summary"]["cycle_count"], 20)
        self.assertEqual(base["metrics"]["initial_value"], 100000)
        self.assertEqual(len(base["curve"]["dates"]), len(base["curve"]["values"]))
        self.assertEqual(len(base["curve"]["values"]), len(base["curve"]["drawdowns"]))
        first = base["cycles"][0]
        expected_option_pnl = (
            first["gross_premium"] - first["intrinsic_value"] - first["commission"]
        )
        self.assertAlmostEqual(first["option_pnl"], expected_option_pnl, places=2)

    def test_future_prices_do_not_change_an_earlier_trade_entry(self):
        original = deterministic_history()
        changed = original.copy()
        changed.loc[changed.index >= "2022-06-01", "close"] *= 1.8
        changed.loc[changed.index >= "2022-06-01", "open"] *= 1.8

        original_result = run_options_backtest(payload(), history=original)
        changed_result = run_options_backtest(payload(), history=changed)
        original_first = original_result["scenarios"]["base"]["cycles"][0]
        changed_first = changed_result["scenarios"]["base"]["cycles"][0]

        for key in ("entry_date", "expiration_date", "entry_spot", "strike", "modeled_iv", "fill_price"):
            self.assertEqual(original_first[key], changed_first[key])

    def test_assignment_and_costs_are_reported(self):
        history = deterministic_history()
        positions = np.arange(len(history), dtype=float)
        history["close"] = 80.0 * np.exp(positions * (0.45 / 252.0))
        history["open"] = history["close"]
        result = run_options_backtest(payload(), history=history)
        cycles = result["scenarios"]["base"]["cycles"]

        self.assertTrue(any(cycle["assigned"] for cycle in cycles))
        self.assertGreater(result["scenarios"]["base"]["summary"]["estimated_costs"], 0)

    def test_new_entry_shares_do_not_receive_same_day_dividend(self):
        history = deterministic_history()
        history["dividend"] = 0.0
        test_dates = history.loc["2021-01-04":"2021-01-05"].index
        history.loc[test_dates, "dividend"] = 1.0

        result = run_options_backtest(payload(), history=history)
        first_cycle = result["scenarios"]["base"]["cycles"][0]

        expected_dividend = first_cycle["contracts"] * 100.0
        self.assertEqual(first_cycle["dividends"], expected_dividend)

    def test_rejects_capital_below_one_covered_lot(self):
        with self.assertRaisesRegex(ValueError, "100 shares"):
            run_options_backtest(
                payload(initial_capital=1000),
                history=deterministic_history(),
            )

    def test_all_same_expiration_templates_run_with_shared_leg_expiry(self):
        history = deterministic_history()
        for strategy_id, definition in STRATEGIES.items():
            with self.subTest(strategy=strategy_id):
                result = run_options_backtest(
                    payload(strategy=strategy_id),
                    history=history,
                )
                base = result["scenarios"]["base"]
                self.assertGreater(base["summary"]["cycle_count"], 0)
                self.assertGreater(base["metrics"]["ending_value"], 0)
                self.assertEqual(len(base["cycles"][0]["legs"]), len(definition["legs"]))
                self.assertTrue(result["assumptions"]["same_expiration_legs"])

    def test_any_dte_supported_by_history_uses_nearest_trading_date(self):
        history = deterministic_history()
        one_day = run_options_backtest(payload(target_dte=1), history=history)
        long_dated = run_options_backtest(payload(target_dte=365), history=history)

        one_day_dtes = {cycle["dte"] for cycle in one_day["scenarios"]["base"]["cycles"]}
        long_dtes = {cycle["dte"] for cycle in long_dated["scenarios"]["base"]["cycles"]}
        self.assertTrue(one_day_dtes.issubset({1, 2, 3, 4}))
        self.assertTrue(all(abs(value - 365) <= 3 for value in long_dtes))
        self.assertEqual(long_dated["assumptions"]["target_dte"], 365)

    def test_per_leg_delta_moneyness_and_fixed_strikes_are_applied(self):
        result = run_options_backtest(
            payload(
                strategy="iron_condor",
                capital_allocation_pct=0.10,
                leg_rules=[
                    {"method": "moneyness", "value": -10},
                    {"method": "delta", "value": 0.30},
                    {"method": "fixed", "value": 120},
                    {"method": "moneyness", "value": 15},
                ],
            ),
            history=deterministic_history(),
        )
        first = result["scenarios"]["base"]["cycles"][0]

        self.assertEqual([leg["strike_rule"]["method"] for leg in first["legs"]], [
            "moneyness", "delta", "fixed", "moneyness",
        ])
        self.assertEqual(first["legs"][2]["strike"], 120.0)
        self.assertAlmostEqual(first["legs"][0]["strike"], first["entry_spot"] * 0.90, delta=1.0)

    def test_defined_risk_default_allocation_limits_cycle_risk(self):
        result = run_options_backtest(
            payload(strategy="long_straddle"),
            history=deterministic_history(),
        )
        first = result["scenarios"]["base"]["cycles"][0]

        self.assertEqual(result["assumptions"]["capital_allocation_pct"], 0.10)
        self.assertLessEqual(first["capital_per_contract"] * first["contracts"], 10000)

    def test_rejects_dte_longer_than_test_range(self):
        with self.assertRaisesRegex(ValueError, "shorter than the requested backtest range"):
            run_options_backtest(
                payload(target_dte=2000),
                history=deterministic_history(),
            )

    def test_saved_unbalanced_condor_preserves_asymmetric_legs_and_quantities(self):
        result = run_options_backtest(
            payload(
                strategy="custom_same_expiration",
                custom_strategy={
                    "name": "unbalanced condor",
                    "stock_units": 0,
                    "legs": [
                        {"name": "Long put", "side": "buy", "option_type": "put", "quantity": 1},
                        {"name": "Short put", "side": "sell", "option_type": "put", "quantity": 2},
                        {"name": "Long put", "side": "buy", "option_type": "put", "quantity": 1},
                    ],
                },
                leg_rules=[
                    {"method": "moneyness", "value": 10},
                    {"method": "moneyness", "value": 0},
                    {"method": "moneyness", "value": -20},
                ],
            ),
            history=deterministic_history(),
        )
        first = result["scenarios"]["base"]["cycles"][0]

        self.assertEqual(result["strategy_label"], "unbalanced condor")
        self.assertEqual([leg["quantity"] for leg in first["legs"]], [1, 2, 1])
        self.assertAlmostEqual(first["legs"][0]["strike"], first["entry_spot"] * 1.10, delta=1.0)
        self.assertAlmostEqual(first["legs"][1]["strike"], first["entry_spot"], delta=1.0)
        self.assertAlmostEqual(first["legs"][2]["strike"], first["entry_spot"] * 0.80, delta=1.0)
        self.assertEqual(result["assumptions"]["capital_allocation_pct"], 0.10)

    def test_saved_strategy_with_uncovered_calls_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "uncovered upside risk"):
            run_options_backtest(
                payload(
                    strategy="custom_same_expiration",
                    custom_strategy={
                        "name": "naked call",
                        "legs": [
                            {"name": "Short call", "side": "sell", "option_type": "call", "quantity": 1},
                        ],
                    },
                    leg_rules=[{"method": "moneyness", "value": 10}],
                ),
                history=deterministic_history(),
            )


class OptionsBacktestRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config["TESTING"] = True
        options_api.register_routes(app)
        self.client = app.test_client()

    @patch("options_api.run_options_backtest")
    def test_backtest_route_returns_engine_payload(self, mocked_run):
        mocked_run.return_value = {"ticker": "SPY", "modeled": True}
        response = self.client.post("/api/options/backtest", json=payload())

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["modeled"])
        mocked_run.assert_called_once()

    @patch("options_api.run_options_backtest", side_effect=ValueError("bad assumptions"))
    def test_backtest_route_returns_validation_error(self, _mocked_run):
        response = self.client.post("/api/options/backtest", json={})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "bad assumptions")


if __name__ == "__main__":
    unittest.main()
