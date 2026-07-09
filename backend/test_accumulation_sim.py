import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from accumulation_sim import (
    _release_return_paths,
    _scenario_month_parameters,
    build_market_assumptions,
    generate_return_paths,
    normalize_strategy,
    run_accumulation_comparison,
    validate_settings,
)


def assumption(ticker, *, total_return=0.0, yield_rate=0.0, scenario_type="other"):
    return {
        "ticker": ticker,
        "description": ticker,
        "scenario_type": scenario_type,
        "scenario_label": scenario_type,
        "current_price": 100.0,
        "current_yield": yield_rate,
        "expected_total_return": total_return,
        "annual_volatility": 0.0,
        "beta": 0.0,
        "neutral_distribution_growth": 0.0,
        "sustainable_yield_cap": 0.45 if scenario_type == "high_distribution_option" else 0.18,
        "history_years": 10.0,
        "source": "test",
    }


class AccumulationSimulationTest(unittest.TestCase):
    def base_payload(self):
        return {
            "years": 1,
            "starting_capital": 12000,
            "monthly_contribution": 100,
            "inflation_rate": 0,
            "freedom_monthly_target": 0,
            "spending_rate": 4,
            "paths": 100,
            "seed": 123,
            "strategies": [
                {
                    "name": "A",
                    "style": "income",
                    "holdings": [{"ticker": "AAA", "weight": 100}],
                },
                {
                    "name": "B",
                    "style": "growth",
                    "holdings": [{"ticker": "BBB", "weight": 100}],
                },
            ],
        }

    def test_strategy_supports_more_than_eighty_tickers(self):
        strategy = normalize_strategy({
            "name": "Large aggregate",
            "style": "custom",
            "holdings": [
                {"ticker": f"T{i:03d}", "weight": 1}
                for i in range(108)
            ],
        })
        self.assertEqual(len(strategy["holdings"]), 108)
        self.assertAlmostEqual(
            sum(row["weight"] for row in strategy["holdings"]),
            1.0,
        )

    def test_strategy_rejects_more_than_two_hundred_fifty_tickers(self):
        with self.assertRaisesRegex(ValueError, "maximum of 250 tickers"):
            normalize_strategy({
                "name": "Too large",
                "style": "custom",
                "holdings": [
                    {"ticker": f"T{i:03d}", "weight": 1}
                    for i in range(251)
                ],
            })

    def test_large_return_cube_uses_disk_backed_storage_and_cleans_up(self):
        payload = self.base_payload()
        settings = validate_settings(payload)
        assumptions = {
            "AAA": assumption("AAA", total_return=0.07),
            "BBB": assumption("BBB", total_return=0.07),
        }
        with patch("accumulation_sim.IN_MEMORY_RETURN_PATH_CELLS", 1):
            paths = generate_return_paths(assumptions, "neutral", settings)
        storage = paths["__storage__"]
        storage_path = storage["path"]
        self.assertEqual(storage["mode"], "temporary_disk")
        self.assertIsNotNone(storage_path)
        self.assertTrue(os.path.exists(storage_path))
        self.assertEqual(storage["matrix"].dtype, np.float32)
        _release_return_paths(paths)
        self.assertFalse(os.path.exists(storage_path))

    def test_zero_return_reconciles_starting_capital_and_contributions(self):
        payload = self.base_payload()
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA"),
                "BBB": assumption("BBB"),
            },
        )
        neutral = result["scenarios"]["neutral"]["strategies"]
        for strategy in neutral:
            self.assertAlmostEqual(strategy["summary"]["final_value"]["p50"], 13200, delta=1)
            self.assertEqual(strategy["summary"]["total_contributions"], 1200)

    def test_identical_portfolios_receive_identical_market_paths(self):
        payload = self.base_payload()
        payload["strategies"][1]["holdings"] = [{"ticker": "AAA", "weight": 100}]
        result = run_accumulation_comparison(
            payload,
            assumptions_override={"AAA": assumption("AAA", total_return=0.08, yield_rate=0.03)},
        )
        for scenario in ("bullish", "neutral", "bearish"):
            a, b = result["scenarios"][scenario]["strategies"]
            self.assertEqual(a["summary"]["final_value"], b["summary"]["final_value"])
            self.assertEqual(a["summary"]["final_annual_income"], b["summary"]["final_annual_income"])

    def test_non_dividend_growth_holding_receives_monthly_contributions(self):
        payload = self.base_payload()
        payload["monthly_contribution"] = 500
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", yield_rate=0.05),
                "BBB": assumption("BBB", yield_rate=0.0, scenario_type="non_income_equity"),
            },
        )
        growth = result["scenarios"]["neutral"]["strategies"][1]
        self.assertAlmostEqual(growth["summary"]["final_value"]["p50"], 18000, delta=2)
        self.assertEqual(growth["summary"]["final_annual_income"]["p50"], 0)

    def test_distributions_are_reinvested_without_being_double_counted(self):
        payload = self.base_payload()
        payload["monthly_contribution"] = 0
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.06, yield_rate=0.06),
                "BBB": assumption("BBB", total_return=0.06, yield_rate=0.0),
            },
        )
        income, growth = result["scenarios"]["neutral"]["strategies"]
        # Equal total-return assumptions should finish together even though one
        # security delivers its return as distributions.
        self.assertAlmostEqual(
            income["summary"]["final_value"]["p50"],
            growth["summary"]["final_value"]["p50"],
            delta=5,
        )
        self.assertGreater(
            income["summary"]["cumulative_distributions_reinvested"]["p50"],
            0,
        )
        self.assertEqual(
            growth["summary"]["cumulative_distributions_reinvested"]["p50"],
            0,
        )

    def test_growth_strategy_reinvests_income_when_its_holding_pays(self):
        payload = self.base_payload()
        payload["monthly_contribution"] = 0
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.06, yield_rate=0.02),
                "BBB": assumption("BBB", total_return=0.08, yield_rate=0.03),
            },
        )
        growth = result["scenarios"]["neutral"]["strategies"][1]
        self.assertEqual(growth["style"], "growth")
        self.assertGreater(growth["summary"]["final_annual_income"]["p50"], 0)
        self.assertGreater(
            growth["summary"]["cumulative_distributions_reinvested"]["p50"],
            0,
        )

    def test_accepts_twenty_five_year_horizon_and_reports_target_probability(self):
        payload = self.base_payload()
        payload.update({
            "years": 25,
            "monthly_contribution": 250,
            "freedom_monthly_target": 100,
            "paths": 100,
        })
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.07, yield_rate=0.04),
                "BBB": assumption("BBB", total_return=0.08, yield_rate=0.01),
            },
        )
        neutral = result["scenarios"]["neutral"]["strategies"][0]
        self.assertEqual(len(neutral["yearly_series"]), 26)
        self.assertIsNotNone(neutral["summary"]["income_target_probability"])
        self.assertGreaterEqual(neutral["summary"]["income_target_probability"], 0)
        self.assertLessEqual(neutral["summary"]["income_target_probability"], 100)
        self.assertGreaterEqual(
            neutral["summary"]["freedom_target_probability"],
            neutral["summary"]["income_target_probability"],
        )
        self.assertGreaterEqual(
            neutral["summary"]["freedom_target_probability"],
            neutral["summary"]["spending_target_probability"],
        )
        self.assertLessEqual(neutral["summary"]["freedom_target_probability"], 100)

    def test_percentiles_are_ordered(self):
        payload = self.base_payload()
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.08),
                "BBB": assumption("BBB", total_return=0.08),
            },
        )
        final_value = result["scenarios"]["neutral"]["strategies"][0]["summary"]["final_value"]
        self.assertLessEqual(final_value["p10"], final_value["p50"])
        self.assertLessEqual(final_value["p50"], final_value["p90"])

    def test_extreme_yield_mean_reverts_without_numeric_explosion(self):
        payload = self.base_payload()
        payload["years"] = 25
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption(
                    "AAA",
                    total_return=0.065,
                    yield_rate=0.60,
                    scenario_type="high_distribution_option",
                ),
                "BBB": assumption(
                    "BBB",
                    total_return=0.065,
                    yield_rate=0.60,
                    scenario_type="high_distribution_option",
                ),
            },
        )
        for scenario in ("bullish", "neutral", "bearish"):
            summary = result["scenarios"][scenario]["strategies"][0]["summary"]
            self.assertGreater(summary["final_value"]["p50"], 0)
            self.assertLess(summary["final_value"]["p90"], 1e10)

    def test_large_contributions_do_not_hide_bear_market_drawdown(self):
        payload = self.base_payload()
        payload["starting_capital"] = 1000
        payload["monthly_contribution"] = 10000
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption(
                    "AAA",
                    total_return=0.08,
                    scenario_type="non_income_equity",
                ),
                "BBB": assumption(
                    "BBB",
                    total_return=0.08,
                    scenario_type="non_income_equity",
                ),
            },
        )
        drawdown = (
            result["scenarios"]["bearish"]["strategies"][0]["summary"]
            ["max_drawdown_pct"]["p50"]
        )
        self.assertLess(drawdown, -10)

    def test_generate_return_paths_extension_preserves_existing_months(self):
        payload = self.base_payload()
        payload["years"] = 2
        settings = validate_settings(payload)
        assumptions = {"AAA": assumption("AAA", total_return=0.07, yield_rate=0.04)}
        short = generate_return_paths(assumptions, "neutral", settings)
        extended = generate_return_paths(assumptions, "neutral", settings, withdrawal_months=240)
        accumulation_months = settings.years * 12
        np.testing.assert_array_equal(
            short["AAA"]["log_returns"],
            extended["AAA"]["log_returns"][:, :accumulation_months],
        )
        np.testing.assert_array_equal(
            short["AAA"]["dps_growth"],
            extended["AAA"]["dps_growth"][:accumulation_months],
        )

    def test_sustainable_freedom_probability_matches_freedom_target_probability_with_all_toggles_off(self):
        payload = self.base_payload()
        payload.update({"years": 10, "freedom_monthly_target": 50})
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.07, yield_rate=0.05),
                "BBB": assumption("BBB", total_return=0.08, yield_rate=0.01),
            },
        )
        for scenario in ("bullish", "neutral", "bearish"):
            for strategy in result["scenarios"][scenario]["strategies"]:
                summary = strategy["summary"]
                self.assertEqual(
                    summary["sustainable_freedom_probability"],
                    summary["freedom_target_probability"],
                )

        zero_target_result = run_accumulation_comparison(
            self.base_payload(),
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.07, yield_rate=0.05),
                "BBB": assumption("BBB", total_return=0.08, yield_rate=0.01),
            },
        )
        zero_summary = zero_target_result["scenarios"]["neutral"]["strategies"][0]["summary"]
        self.assertIsNone(zero_summary["freedom_target_probability"])
        self.assertIsNone(zero_summary["sustainable_freedom_probability"])

    def test_drip_stop_capital_stability_hand_computable(self):
        payload = self.base_payload()
        payload["monthly_contribution"] = 0
        payload["sustainability"] = {"check_drip_stop_stability": True}

        positive = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.05, yield_rate=0.0),
                "BBB": assumption("BBB", total_return=0.05, yield_rate=0.0),
            },
        )
        positive_summary = positive["scenarios"]["neutral"]["strategies"][0]["summary"]
        self.assertEqual(
            positive_summary["sustainability_detail"]["capital_stability_probability"], 100.0
        )

        negative = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=-0.30, yield_rate=0.0),
                "BBB": assumption("BBB", total_return=-0.30, yield_rate=0.0),
            },
        )
        negative_summary = negative["scenarios"]["neutral"]["strategies"][0]["summary"]
        self.assertEqual(
            negative_summary["sustainability_detail"]["capital_stability_probability"], 0.0
        )

    def test_withdrawal_phase_depletion_under_extreme_case(self):
        payload = self.base_payload()
        payload.update({
            "starting_capital": 2000,
            "monthly_contribution": 0,
            "freedom_monthly_target": 2000,
            "sustainability": {"run_withdrawal_phase": True, "withdrawal_years": 5},
        })
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.05, yield_rate=0.03),
                "BBB": assumption("BBB", total_return=0.05, yield_rate=0.03),
            },
        )
        detail = result["scenarios"]["neutral"]["strategies"][0]["summary"]["sustainability_detail"]
        survival = detail["withdrawal_survival_probability"]
        self.assertIsNotNone(survival)
        self.assertGreaterEqual(survival, 0.0)
        self.assertLess(survival, 10.0)

    def test_payout_cap_limits_sustainable_income_when_yield_exceeds_total_return(self):
        payload = self.base_payload()
        payload["monthly_contribution"] = 0
        payload["freedom_monthly_target"] = 1
        payload["sustainability"] = {"cap_payout_to_total_return": True}
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption(
                    "AAA", total_return=0.05, yield_rate=0.20, scenario_type="high_distribution_option"
                ),
                "BBB": assumption(
                    "BBB", total_return=0.05, yield_rate=0.20, scenario_type="high_distribution_option"
                ),
            },
        )
        summary = result["scenarios"]["neutral"]["strategies"][0]["summary"]
        detail = summary["sustainability_detail"]
        # Yield (20%) exceeds total return (5%) -> ratio well above 100%.
        self.assertGreater(detail["payout_sustainable_ratio_pct"], 100.0)
        adjusted = detail["sustainability_adjusted_monthly_income"]
        gross = summary["final_monthly_income"]
        self.assertIsNotNone(adjusted)
        self.assertLessEqual(adjusted["p50"], gross["p50"])

    def test_withdrawal_extension_can_use_disk_backed_paths(self):
        payload = self.base_payload()
        payload.update({
            "sustainability": {"run_withdrawal_phase": True, "withdrawal_years": 1},
        })
        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch("accumulation_sim.IN_MEMORY_RETURN_PATH_CELLS", 1),
                patch("accumulation_sim.tempfile.tempdir", temp_dir),
            ):
                result = run_accumulation_comparison(
                    payload,
                    assumptions_override={
                        "AAA": assumption("AAA", total_return=0.05),
                        "BBB": assumption("BBB", total_return=0.05),
                    },
                )
            self.assertEqual(os.listdir(temp_dir), [])
        self.assertEqual(result["settings"]["return_path_storage"], "temporary_disk")
        self.assertEqual(result["settings"]["return_path_cells"], 4800)


    def test_distributions_covering_target_reach_fi_immediately(self):
        payload = self.base_payload()
        payload.update({
            "years": 3,
            "monthly_contribution": 0,
            "inflation_rate": 0,
            "freedom_monthly_target": 100,  # $1,200/yr, far below the payout
            "paths": 100,
        })
        # 10% total return delivered entirely as a 10% distribution: retiring in
        # any year, the payout dwarfs the target, so no shares are sold and the
        # pile grows -> FI reached in year 1 for both "lasts" and "preserves".
        cover = dict(total_return=0.10, yield_rate=0.10)
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", **cover),
                "BBB": assumption("BBB", **cover),
            },
        )
        summary = result["scenarios"]["neutral"]["strategies"][0]["summary"]
        self.assertEqual(summary["fi_year_lasts"], 1)
        self.assertEqual(summary["fi_year_principal"], 1)
        self.assertEqual(summary["fi_lasts_probability"], 100.0)
        self.assertEqual(summary["fi_principal_probability"], 100.0)
        self.assertEqual(summary["fi_confidence_pct"], 85.0)
        self.assertEqual(summary["money_lasts_years"], 25)

    def test_growth_pile_lasts_when_large_and_depletes_when_small(self):
        # Large pile, tiny withdrawal: growth holding funds the target purely by
        # selling shares and still lasts -> FI in year 1.
        big = self.base_payload()
        big.update({
            "years": 3,
            "monthly_contribution": 0,
            "inflation_rate": 0,
            "freedom_monthly_target": 100,  # $1,200/yr from $100k
            "starting_capital": 100000,
            "paths": 100,
        })
        big_result = run_accumulation_comparison(
            big,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.06, yield_rate=0.0,
                                  scenario_type="non_income_equity"),
                "BBB": assumption("BBB", total_return=0.06, yield_rate=0.0,
                                  scenario_type="non_income_equity"),
            },
        )
        big_summary = big_result["scenarios"]["neutral"]["strategies"][0]["summary"]
        self.assertEqual(big_summary["fi_year_lasts"], 1)
        self.assertIsNotNone(big_summary["fi_year_principal"])

        # Tiny pile, huge withdrawal: depletes almost immediately -> never FI.
        small = self.base_payload()
        small.update({
            "years": 2,
            "monthly_contribution": 0,
            "inflation_rate": 0,
            "freedom_monthly_target": 2000,  # $24,000/yr from ~$2k
            "starting_capital": 2000,
            "paths": 100,
        })
        small_result = run_accumulation_comparison(
            small,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.05, yield_rate=0.0,
                                  scenario_type="non_income_equity"),
                "BBB": assumption("BBB", total_return=0.05, yield_rate=0.0,
                                  scenario_type="non_income_equity"),
            },
        )
        small_summary = small_result["scenarios"]["neutral"]["strategies"][0]["summary"]
        self.assertIsNone(small_summary["fi_year_lasts"])
        self.assertIsNone(small_summary["fi_year_principal"])
        self.assertIsNotNone(small_summary["fi_lasts_probability"])
        self.assertLess(small_summary["fi_lasts_probability"], 50.0)

    def test_lower_fi_confidence_reaches_freedom_no_later(self):
        def run(confidence_pct):
            payload = self.base_payload()
            payload.update({
                "years": 10,
                "monthly_contribution": 0,
                "inflation_rate": 0,
                "freedom_monthly_target": 500,
                "starting_capital": 100000,
                "paths": 200,
                "fi_confidence_pct": confidence_pct,
            })
            volatile = assumption("AAA", total_return=0.07, yield_rate=0.04,
                                  scenario_type="equity_income")
            volatile["annual_volatility"] = 0.16
            volatile["beta"] = 0.6
            other = dict(volatile)
            other["ticker"] = "BBB"
            result = run_accumulation_comparison(
                payload,
                assumptions_override={"AAA": volatile, "BBB": other},
            )
            return result["scenarios"]["neutral"]["strategies"][0]["summary"]

        lenient = run(50)
        strict = run(90)
        rank = lambda year: year if year is not None else 999
        # A lower confidence bar can only be cleared the same year or earlier.
        self.assertLessEqual(rank(lenient["fi_year_lasts"]), rank(strict["fi_year_lasts"]))
        # Preserving principal is stricter than merely lasting, so its FI year is
        # never earlier than the "lasts" year at the same confidence.
        self.assertGreaterEqual(rank(strict["fi_year_principal"]), rank(strict["fi_year_lasts"]))

    def test_no_freedom_target_leaves_fi_fields_none(self):
        payload = self.base_payload()  # freedom_monthly_target == 0
        result = run_accumulation_comparison(
            payload,
            assumptions_override={
                "AAA": assumption("AAA", total_return=0.08, yield_rate=0.03),
                "BBB": assumption("BBB", total_return=0.08, yield_rate=0.03),
            },
        )
        summary = result["scenarios"]["neutral"]["strategies"][0]["summary"]
        for key in (
            "fi_year_lasts",
            "fi_year_principal",
            "fi_lasts_probability",
            "fi_principal_probability",
            "fi_confidence_pct",
            "money_lasts_years",
        ):
            self.assertIsNone(summary[key], key)

    def test_variance_correction_keeps_expected_return_stable_across_volatility(self):
        payload = self.base_payload()
        payload.update({"years": 1, "paths": 2000, "monthly_contribution": 0})
        settings = validate_settings(payload)
        low = assumption("LOW", total_return=0.08)
        low["annual_volatility"] = 0.05
        high = assumption("HIGH", total_return=0.08)
        high["annual_volatility"] = 0.35
        paths = generate_return_paths({"LOW": low, "HIGH": high}, "neutral", settings)

        low_gross = np.exp(paths["LOW"]["log_returns"]).prod(axis=1)
        high_gross = np.exp(paths["HIGH"]["log_returns"]).prod(axis=1)
        self.assertAlmostEqual(float(low_gross.mean()), 1.08, delta=0.015)
        self.assertAlmostEqual(float(high_gross.mean()), 1.08, delta=0.025)
        self.assertLess(abs(float(high_gross.mean() - low_gross.mean())), 0.025)

    def test_similar_option_funds_receive_conservative_fallback_correlation(self):
        payload = self.base_payload()
        payload.update({"years": 2, "paths": 1000})
        settings = validate_settings(payload)
        left = assumption(
            "AAA", total_return=0.07, scenario_type="option_income"
        )
        right = assumption(
            "BBB", total_return=0.07, scenario_type="option_income"
        )
        left["annual_volatility"] = right["annual_volatility"] = 0.20
        left["correlation_group"] = right["correlation_group"] = "option_income"
        paths = generate_return_paths({"AAA": left, "BBB": right}, "neutral", settings)
        realized = float(np.corrcoef(
            paths["AAA"]["log_returns"].ravel(),
            paths["BBB"]["log_returns"].ravel(),
        )[0, 1])
        self.assertGreater(realized, 0.65)

    def test_bear_scenario_raises_risk_asset_correlation(self):
        payload = self.base_payload()
        payload.update({"years": 2, "paths": 1000})
        settings = validate_settings(payload)
        left = assumption(
            "AAA", total_return=0.07, scenario_type="non_income_equity"
        )
        right = assumption(
            "BBB", total_return=0.07, scenario_type="non_income_equity"
        )
        for row, other in ((left, "BBB"), (right, "AAA")):
            row["annual_volatility"] = 0.20
            row["correlation_group"] = "us_equity"
            row["correlations"] = {row["ticker"]: 1.0, other: 0.30}
        assumptions = {"AAA": left, "BBB": right}
        neutral = generate_return_paths(assumptions, "neutral", settings)
        bearish = generate_return_paths(assumptions, "bearish", settings)
        neutral_corr = float(np.corrcoef(
            neutral["AAA"]["log_returns"][:, :12].ravel(),
            neutral["BBB"]["log_returns"][:, :12].ravel(),
        )[0, 1])
        bear_corr = float(np.corrcoef(
            bearish["AAA"]["log_returns"][:, :12].ravel(),
            bearish["BBB"]["log_returns"][:, :12].ravel(),
        )[0, 1])
        self.assertGreater(bear_corr, neutral_corr + 0.15)

    def test_market_history_builds_pair_correlation_and_widens_short_history(self):
        def frame_from_returns(monthly_returns):
            dates = pd.date_range("2020-01-31", periods=len(monthly_returns) + 1, freq="ME")
            closes = [100.0]
            for monthly_return in monthly_returns:
                closes.append(closes[-1] * (1.0 + monthly_return))
            return pd.DataFrame(
                {"Close": closes, "Dividends": np.zeros(len(closes))},
                index=dates,
            )

        long_returns = np.array(
            [0.015, -0.010, 0.020, 0.005, -0.012, 0.018] * 10,
            dtype=float,
        )
        short_returns = np.array(
            [0.020, -0.015, 0.010, 0.005, -0.010, 0.012] * 2,
            dtype=float,
        )
        histories = {
            "AAA": frame_from_returns(long_returns),
            "BBB": frame_from_returns(long_returns * 0.9),
            "NEW": frame_from_returns(short_returns),
            "SPY": frame_from_returns(long_returns * 0.8),
        }
        holdings = [
            {
                "ticker": "AAA", "weight": 1, "scenario_type": "non_income_equity",
                "correlation_group": "us_equity",
            },
            {
                "ticker": "BBB", "weight": 1, "scenario_type": "fixed_income",
                "correlation_group": "fixed_income",
            },
            {
                "ticker": "NEW", "weight": 1, "scenario_type": "option_income",
                "correlation_group": "option_income",
            },
        ]
        assumptions, warnings = build_market_assumptions(
            holdings, history_loader=lambda _tickers: histories
        )
        self.assertGreater(assumptions["AAA"]["correlations"]["BBB"], 0.70)
        self.assertEqual(
            assumptions["AAA"]["correlation_history_months"]["BBB"], 60
        )
        self.assertGreater(
            assumptions["NEW"]["forecast_annual_volatility"],
            assumptions["NEW"]["annual_volatility"],
        )
        self.assertTrue(any("NEW: limited price history" in warning for warning in warnings))

    def test_option_structure_changes_tail_behavior_only_when_specified(self):
        covered = assumption(
            "COVERED", total_return=0.07, scenario_type="option_income"
        )
        covered["option_strategy"] = "covered_call"
        protective = assumption(
            "PROTECT", total_return=0.07, scenario_type="option_income"
        )
        protective["option_strategy"] = "protective_put_spread"
        unspecified = assumption(
            "UNSPEC", total_return=0.07, scenario_type="option_income"
        )
        unspecified["option_strategy"] = "put_spread"

        covered_bull = _scenario_month_parameters(covered, "bullish", 0)[0]
        unspecified_bull = _scenario_month_parameters(unspecified, "bullish", 0)[0]
        covered_bear = _scenario_month_parameters(covered, "bearish", 0)[0]
        protective_bear = _scenario_month_parameters(protective, "bearish", 0)[0]
        self.assertLess(covered_bull, unspecified_bull)
        self.assertGreater(protective_bear, covered_bear)

    def test_strategy_normalization_preserves_model_overrides(self):
        strategy = normalize_strategy({
            "name": "Overrides",
            "style": "custom",
            "holdings": [{
                "ticker": "AAA",
                "weight": 100,
                "scenario_type": "option_income",
                "scenario_type_override": "option_income",
                "option_strategy": "short_put_spread",
                "correlation_group": "sp500",
            }],
        })
        holding = strategy["holdings"][0]
        self.assertEqual(holding["scenario_type_override"], "option_income")
        self.assertEqual(holding["option_strategy"], "short_put_spread")
        self.assertEqual(holding["correlation_group"], "sp500")


if __name__ == "__main__":
    unittest.main()
