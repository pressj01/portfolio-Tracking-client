import unittest
from datetime import date, timedelta
from unittest.mock import patch

import pandas as pd

from general_option_scanner import (
    STRATEGIES,
    _filter_reasons,
    _iv_history,
    _realized_vol_metrics,
    _runner_payload,
    _technical_context,
    run_general_option_scan,
)


class GeneralOptionScannerTests(unittest.TestCase):
    def test_technical_context_exposes_expiration_scenario_references(self):
        context = _technical_context({
            "price": 100,
            "sma_200": 95,
            "atr_14": 3.25,
            "rv_30": 0.22,
            "target_mean_price": 120,
            "week52_high": 130,
            "week52_low": 70,
        }, None)

        self.assertEqual(context["sma_200"], 95)
        self.assertEqual(context["atr_14"], 3.25)
        self.assertEqual(context["rv_30"], 0.22)
        self.assertEqual(context["target_mean_price"], 120)
        self.assertEqual(context["week52_high"], 130)
        self.assertEqual(context["week52_low"], 70)

    def test_every_strategy_receives_same_day_through_three_year_dte_filters(self):
        for strategy in STRATEGIES:
            with self.subTest(strategy=strategy):
                payload = _runner_payload(strategy, {
                    "symbols": "SPY",
                    "min_dte": 0,
                    "target_dte": 0,
                    "max_dte": 1095,
                })
                self.assertEqual(payload["min_dte"], 0)
                self.assertEqual(payload["target_dte"], 0)
                self.assertEqual(payload["max_dte"], 1095)

    def test_standard_strategy_uses_custom_symbols_and_broad_source_scan(self):
        payload = _runner_payload("covered-call", {
            "symbols": "spy, AAPL spy",
            "min_dte": 14,
            "max_dte": 45,
        })
        self.assertEqual(payload["universe"], "custom")
        self.assertEqual(payload["custom_tickers"], ["SPY", "AAPL"])
        self.assertFalse(payload["exclude_earnings_before_expiry"])
        self.assertEqual(payload["min_dte"], 14)
        self.assertEqual(payload["min_market_cap"], 0)
        self.assertEqual(payload["min_avg_dollar_volume"], 0)

    def test_standard_strategy_forwards_quality_gates_to_the_runner(self):
        payload = _runner_payload("cash-secured-put", {
            "exclude_earnings_before_expiry": True,
            "min_market_cap": 5e9,
            "fund_min_aum": 500e6,
            "min_avg_dollar_volume": 25e6,
            "min_open_interest": 100,
        })
        self.assertTrue(payload["exclude_earnings_before_expiry"])
        self.assertEqual(payload["min_market_cap"], 5e9)
        self.assertEqual(payload["fund_min_aum"], 500e6)
        self.assertEqual(payload["min_avg_dollar_volume"], 25e6)
        self.assertEqual(payload["min_open_interest"], 100)

    def test_quality_filters_reject_known_failures_and_ignore_missing_metrics(self):
        stock = {
            "ticker": "AAPL", "is_etf": False, "market_cap": 1e9,
            "avg_dollar_volume": 5e6, "earnings_before_expiry": True,
            "skew_rank": 20, "min_leg_open_interest": 40,
        }
        tight = {
            "exclude_earnings_before_expiry": True,
            "min_market_cap": 5e9,
            "min_avg_dollar_volume": 25e6,
            "min_open_interest": 100,
            "min_skew_rank": 40,
        }
        reasons = _filter_reasons(stock, tight)
        self.assertIn("Earnings before expiry", reasons)
        self.assertIn("Market cap", reasons)
        self.assertIn("Share dollar volume", reasons)
        self.assertIn("Open interest", reasons)
        self.assertIn("Skew Rank", reasons)

        unknown = _filter_reasons({"ticker": "AAPL", "is_etf": False}, tight)
        self.assertEqual(unknown, [])

        fund = _filter_reasons(
            {"ticker": "SPY", "is_etf": True, "fund_aum": 100e6, "earnings_before_expiry": True},
            {"exclude_earnings_before_expiry": True, "fund_min_aum": 500e6},
        )
        self.assertIn("Fund AUM", fund)
        self.assertNotIn("Earnings before expiry", fund)

    def test_iron_condor_is_the_only_legacy_runner_given_general_mode(self):
        self.assertTrue(_runner_payload("iron-condor", {})["general_scanner_mode"])
        self.assertNotIn("general_scanner_mode", _runner_payload("cash-secured-put", {}))

    def test_standard_strategy_passes_the_selected_index_subset(self):
        payload = _runner_payload("iron-condor", {
            "include_stocks": False,
            "include_index_etfs": True,
            "index_tickers": "SPY,QQQ,IWM",
        })
        self.assertEqual(payload["index_tickers"], "SPY,QQQ,IWM")

    def test_short_delta_profile_changes_standard_scanner_construction(self):
        payload = _runner_payload("bull-put-spread", {
            "reference_delta_mode": "short",
            "min_reference_delta": 5,
            "max_reference_delta": 15,
        })
        self.assertAlmostEqual(payload["short_delta"], 0.10)
        self.assertAlmostEqual(payload["long_delta"], 0.045)

    def test_long_dated_unbalanced_structures_use_index_etfs_only(self):
        payload = _runner_payload("unbalanced-butterfly", {})
        self.assertEqual(payload["tickers"], "SPY,QQQ,IWM,VOO")
        self.assertFalse(payload["include_stocks"])
        self.assertTrue(payload["include_index_etfs"])

        with self.assertRaisesRegex(ValueError, "index ETFs"):
            _runner_payload("unbalanced-put-condor", {"symbols": "SPY,AAPL"})

    @patch("general_option_scanner.resolve_scan_universe", return_value=["GLD", "SLV", "DBC"])
    def test_ticker_strategy_uses_the_selected_shared_universe(self, resolve):
        payload = _runner_payload("iron-butterfly", {
            "include_stocks": False,
            "include_index_etfs": False,
            "include_commodity_etfs": True,
        })
        self.assertEqual(payload["tickers"], "GLD,SLV,DBC")
        resolve.assert_called_once()

    def test_specialized_put_call_condor_keeps_its_supported_underlying(self):
        self.assertEqual(
            _runner_payload("put-call-condor", {"symbols": "^XSP"})["underlying"],
            "^XSP",
        )

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_index_only_profiles_filter_total_opening_cashflow(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        rows = [
            {"ticker": "DEBIT", "price": 100, "entry_credit": -0.25, "expiration": "2026-09-18", "body_strike": 100},
            {"ticker": "FLAT", "price": 100, "entry_credit": 0.0, "expiration": "2026-09-18", "body_strike": 100},
            {"ticker": "SMALL", "price": 100, "entry_credit": 0.25, "expiration": "2026-09-18", "body_strike": 100},
            {"ticker": "LARGE", "price": 100, "entry_credit": 0.75, "expiration": "2026-09-18", "body_strike": 100},
        ]
        result = run_general_option_scan(
            {
                "strategy": "unbalanced-butterfly",
                "entry_credit_mode": "flat_or_slight_credit",
                "entry_credit_max_points": 0.5,
            },
            runner=lambda _: {"rows": rows},
        )
        self.assertEqual([row["ticker"] for row in result["rows"]], ["FLAT", "SMALL"])

    @patch("general_option_scanner.resolve_scan_universe", return_value=["SPY", "QQQ", "AAPL"])
    def test_missing_strategy_uses_shared_engine_and_selected_universe(self, resolve):
        payload = _runner_payload("bull-call-spread", {
            "universe": "large_cap", "include_stocks": True,
            "include_index_etfs": True, "bid_ask_level": "25% price improvement",
        })
        self.assertEqual(payload["generic_strategy"], "bull-call-spread")
        self.assertEqual(payload["tickers"], ["SPY", "QQQ", "AAPL"])
        self.assertEqual(payload["bid_ask_level"], "25% price improvement")

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_normalizes_and_filters_available_metrics(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={
                "fundamental": 7, "growth": 8, "technical": 9,
            }) for row in rows
        ]
        source = {
            "ticker": "XYZ", "name": "Example", "price": 100,
            "spread": {
                "expiration": "2026-09-18", "dte": 37,
                "short_strike": 95, "long_strike": 90,
                "max_profit_dollars": 125, "max_loss_dollars": 375,
                "expected_value_dollars": 22, "prob_max_profit": 68,
            },
        }
        result = run_general_option_scan(
            {"strategy": "bull-put-spread", "min_expected_value": 10},
            runner=lambda _: {"rows": [source], "stats": {"final": 1}},
        )
        self.assertEqual(len(result["rows"]), 1)
        meta = result["rows"][0]["_general"]
        self.assertEqual(meta["ticker"], "XYZ")
        self.assertEqual(meta["expected_value"], 22)
        self.assertEqual(meta["strikes"], "90 / 95")
        self.assertAlmostEqual(meta["profit_ratio"], 100 / 3)

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_cash_secured_put_fills_position_wide_table_calculations(
        self, score_rows, iv_history
    ):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        expiration = (date.today() + timedelta(days=30)).isoformat()
        result = run_general_option_scan(
            {"strategy": "cash-secured-put"},
            runner=lambda _: {"rows": [{
                "ticker": "XYZ", "price": 100,
                "put": {
                    "expiration": expiration, "dte": 30, "strike": 95,
                    "mid": 2.0, "bid": 1.9, "ask": 2.1,
                    "iv": 0.25, "atm_iv": 0.24, "delta": -0.20,
                    "volume": 250, "total_option_volume": 12_345,
                },
            }]},
        )
        meta = result["rows"][0]["_general"]
        self.assertEqual(meta["total_option_volume"], 12_345)
        self.assertEqual(meta["total_option_volume_source"], "chain")
        self.assertAlmostEqual(meta["delta"], 20.0)
        self.assertGreater(meta["prob_max_profit"], 0)
        self.assertEqual(meta["prob_max_loss"], 0.0)
        self.assertIsNotNone(meta["expected_value"])
        self.assertEqual(meta["max_profit"], 200.0)
        self.assertEqual(meta["max_loss"], 9_300.0)
        self.assertAlmostEqual(meta["profit_ratio"], 200 / 9_300 * 100)

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_credit_vertical_fills_delta_loss_probability_and_expected_value(
        self, score_rows, iv_history
    ):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        expiration = (date.today() + timedelta(days=30)).isoformat()
        result = run_general_option_scan(
            {"strategy": "bull-put-spread"},
            runner=lambda _: {"rows": [{
                "ticker": "XYZ", "price": 100,
                "spread": {
                    "expiration": expiration, "dte": 30, "atm_iv": 0.24,
                    "short_strike": 95, "long_strike": 90,
                    "max_profit_dollars": 150, "max_loss_dollars": 350,
                    "prob_otm": 75, "total_option_volume": 4_200,
                    "short_leg": {
                        "strike": 95, "mid": 2.5, "bid": 2.4, "ask": 2.6,
                        "iv": 0.25, "delta": -0.25, "volume": 300,
                    },
                    "long_leg": {
                        "strike": 90, "mid": 1.0, "bid": 0.9, "ask": 1.1,
                        "iv": 0.26, "delta": -0.10, "volume": 200,
                    },
                },
            }]},
        )
        meta = result["rows"][0]["_general"]
        self.assertEqual(meta["total_option_volume"], 4_200)
        self.assertAlmostEqual(meta["delta"], 15.0)
        self.assertEqual(meta["prob_max_profit"], 75.0)
        self.assertGreater(meta["prob_max_loss"], 0)
        self.assertLess(meta["prob_max_loss"], 100)
        self.assertIsNotNone(meta["expected_value"])
        self.assertEqual(meta["max_profit"], 150)
        self.assertEqual(meta["max_loss"], 350)

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_covered_call_uses_the_whole_position_for_risk_and_delta(
        self, score_rows, iv_history
    ):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        expiration = (date.today() + timedelta(days=30)).isoformat()
        result = run_general_option_scan(
            {"strategy": "covered-call"},
            runner=lambda _: {"rows": [{
                "ticker": "XYZ", "price": 100, "cost_basis": 100,
                "call": {
                    "expiration": expiration, "dte": 30, "strike": 105,
                    "mid": 2.0, "bid": 1.9, "ask": 2.1,
                    "iv": 0.24, "atm_iv": 0.23, "delta": 0.30,
                    "volume": 150,
                },
            }]},
        )
        meta = result["rows"][0]["_general"]
        self.assertAlmostEqual(meta["delta"], 70.0)
        self.assertEqual(meta["max_profit"], 700.0)
        self.assertEqual(meta["max_loss"], 9_800.0)
        self.assertGreater(meta["prob_max_profit"], 0)
        self.assertEqual(meta["prob_max_loss"], 0.0)
        self.assertIsNotNone(meta["expected_value"])
        self.assertEqual(meta["total_option_volume"], 150)
        self.assertEqual(meta["total_option_volume_source"], "selected_legs")

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_maps_complete_probability_breakdown(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        schedule = [
            {"kind": "management", "label": "21 DTE", "remaining_dte": 21,
             "probability_success_pct": 72.0, "probability_failure_pct": 28.0},
            {"kind": "expiration", "label": "Expiration", "remaining_dte": 0,
             "probability_success_pct": 68.0, "probability_failure_pct": 32.0},
        ]
        result = run_general_option_scan(
            {"strategy": "bull-put-spread"},
            runner=lambda _: {"rows": [{
                "ticker": "SPY", "price": 100,
                "spread": {
                    "expiration": (date.today() + timedelta(days=30)).isoformat(),
                    "dte": 30, "short_strike": 95, "long_strike": 90,
                    "prob_otm": 82, "probability_schedule": schedule,
                },
            }]},
        )
        meta = result["rows"][0]["_general"]
        self.assertEqual(meta["prob_success"], 68)
        self.assertEqual(meta["prob_failure"], 32)
        self.assertEqual(meta["prob_itm"], 18)
        self.assertEqual(meta["prob_touch"], 36)
        self.assertTrue(meta["prob_touch_estimated"])
        self.assertEqual(meta["probability_schedule"], schedule)

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_expired_contracts_never_return_even_as_near_matches(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        expired = (date.today() - timedelta(days=1)).isoformat()
        result = run_general_option_scan(
            {"strategy": "bull-put-spread", "include_near_matches": True},
            runner=lambda _: {"rows": [{
                "ticker": "OLD", "price": 100,
                "spread": {"expiration": expired, "dte": -1, "short_strike": 95, "long_strike": 90},
            }]},
        )
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["stats"]["filter_rejections"]["Expired contract"], 1)

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_missing_metric_does_not_hide_strategy(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        result = run_general_option_scan(
            {"strategy": "covered-call", "min_iv_rank": 80},
            runner=lambda _: {"rows": [{
                "ticker": "XYZ", "price": 100,
                "call": {"expiration": "2026-09-18", "strike": 105},
            }]},
        )
        self.assertEqual(len(result["rows"]), 1)

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_requested_quality_score_rejects_missing_score(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={
                "fundamental": None, "growth": 8, "technical": 9,
            }) for row in rows
        ]
        result = run_general_option_scan(
            {
                "strategy": "covered-call",
                "stock_score_fundamental_min": 7,
                "stock_score_fundamental_max": 10,
            },
            runner=lambda _: {"rows": [{
                "ticker": "XYZ", "price": 100,
                "call": {"expiration": "2026-09-18", "strike": 105},
            }]},
        )
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["stats"]["candidates_evaluated"], 1)
        self.assertEqual(result["stats"]["filter_rejections"], {
            "Fundamental score unavailable": 1,
        })

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_general_screen_returns_priced_near_match_when_preset_has_no_exact_match(
        self, score_rows, iv_history
    ):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        result = run_general_option_scan(
            {
                "strategy": "bull-put-spread",
                "min_max_profit_dollars": 100,
                "include_near_matches": True,
            },
            runner=lambda _: {
                "rows": [],
                "watchlist_rows": [{
                    "ticker": "SPY",
                    "price": 100,
                    "chain_status": "constraints_relaxed",
                    "spread": {
                        "expiration": "2026-09-18",
                        "short_strike": 95,
                        "long_strike": 90,
                        "max_profit_dollars": 75,
                    },
                }],
            },
        )
        self.assertEqual([row["ticker"] for row in result["rows"]], ["SPY"])
        self.assertEqual(result["rows"][0]["_general"]["match_status"], "near_match")
        self.assertEqual(result["rows"][0]["_general"]["filter_reasons"], ["Maximum profit"])
        self.assertTrue(result["stats"]["showing_near_matches"])

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_requested_quality_score_keeps_only_scores_in_range(self, score_rows, iv_history):
        def populate(rows):
            for row in rows:
                row["_general"]["stock_scores"] = {
                    "fundamental": 8 if row["ticker"] == "GOOD" else 5,
                    "growth": 8,
                    "technical": 8,
                }
        score_rows.side_effect = populate
        result = run_general_option_scan(
            {
                "strategy": "covered-call",
                "stock_score_fundamental_min": 7,
                "stock_score_fundamental_max": 10,
            },
            runner=lambda _: {"rows": [
                {"ticker": "GOOD", "price": 100, "call": {"expiration": "2026-09-18", "strike": 105}},
                {"ticker": "LOW", "price": 100, "call": {"expiration": "2026-09-18", "strike": 105}},
            ]},
        )
        self.assertEqual([row["ticker"] for row in result["rows"]], ["GOOD"])

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_fundamental_score_filter_skips_index_and_sector_etfs(self, score_rows, iv_history):
        def populate(rows):
            for row in rows:
                row["_general"]["stock_scores"] = {
                    "fundamental": 1,
                    "growth": 1,
                    "technical": 8,
                }
        score_rows.side_effect = populate
        result = run_general_option_scan(
            {
                "strategy": "covered-call",
                "stock_score_fundamental_min": 9,
                "stock_score_fundamental_max": 10,
            },
            runner=lambda _: {"rows": [
                {"ticker": "SPY", "price": 100, "call": {"expiration": "2026-09-18", "strike": 105}},
                {"ticker": "QQQ", "price": 100, "call": {"expiration": "2026-09-18", "strike": 105}},
                {"ticker": "IWM", "price": 100, "call": {"expiration": "2026-09-18", "strike": 105}},
                {"ticker": "XLK", "price": 100, "call": {"expiration": "2026-09-18", "strike": 105}},
                {"ticker": "AAPL", "price": 100, "call": {"expiration": "2026-09-18", "strike": 105}},
            ]},
        )
        self.assertEqual([row["ticker"] for row in result["rows"]], ["IWM", "QQQ", "SPY", "XLK"])
        self.assertEqual(result["stats"]["filter_rejections"], {"Fundamental score": 1})

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_market_uptrend_with_underlying_pullback_is_enforced(self, score_rows, iv_history):
        def populate(rows):
            for row in rows:
                recent_move = -2.0 if row["ticker"] == "PULLBACK" else 1.0
                row["_general"].update(
                    stock_scores={"fundamental": 8, "growth": 8, "technical": 8},
                    market_technicals={"trend": "uptrend"},
                    technicals={
                        "trend": "uptrend", "rsi_14": 45,
                        "moves_pct": {"5": recent_move},
                    },
                )
        score_rows.side_effect = populate
        result = run_general_option_scan(
            {
                "strategy": "cash-secured-put",
                "market_trend": "uptrend",
                "underlying_trend": "uptrend",
                "recent_move_direction": "down",
                "recent_move_lookback": 5,
                "min_abs_recent_move_pct": 1,
            },
            runner=lambda _: {"rows": [
                {"ticker": "PULLBACK", "price": 100, "put": {"expiration": "2026-09-18", "strike": 95}},
                {"ticker": "RALLY", "price": 100, "put": {"expiration": "2026-09-18", "strike": 95}},
            ]},
        )
        self.assertEqual([row["ticker"] for row in result["rows"]], ["PULLBACK"])

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_condor_shape_uses_actual_tail_payoff(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        result = run_general_option_scan(
            {"strategy": "iron-condor", "iron_condor_shape": "riskless_up"},
            runner=lambda _: {"rows": [{
                "ticker": "XYZ", "price": 100,
                "spread": {
                    "expiration": "2026-09-18",
                    "put_long_strike": 80, "put_short_strike": 90,
                    "call_short_strike": 105, "call_long_strike": 110,
                    "put_width": 10, "call_width": 5, "entry_credit": 5.25,
                },
            }]},
        )
        self.assertEqual(len(result["rows"]), 1)
        self.assertIn("riskless_up", result["rows"][0]["_general"]["condor_shapes"])

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_reference_short_delta_band_filters_completed_legs(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        result = run_general_option_scan(
            {
                "strategy": "bull-put-spread",
                "reference_delta_mode": "short",
                "min_reference_delta": 5,
                "max_reference_delta": 15,
            },
            runner=lambda _: {"rows": [
                {"ticker": "KEEP", "price": 100, "expiration": "2026-09-18", "legs": [
                    {"option_type": "put", "qty": -1, "strike": 95, "delta": -0.10, "expiration": "2026-09-18"},
                    {"option_type": "put", "qty": 1, "strike": 90, "delta": -0.04, "expiration": "2026-09-18"},
                ]},
                {"ticker": "DROP", "price": 100, "expiration": "2026-09-18", "legs": [
                    {"option_type": "put", "qty": -1, "strike": 98, "delta": -0.25, "expiration": "2026-09-18"},
                    {"option_type": "put", "qty": 1, "strike": 90, "delta": -0.04, "expiration": "2026-09-18"},
                ]},
            ]},
        )
        self.assertEqual([row["ticker"] for row in result["rows"]], ["KEEP"])
        self.assertEqual(result["rows"][0]["_general"]["reference_delta"], 10.0)
        self.assertEqual(result["stats"]["filter_rejections"], {"Reference option delta": 1})

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_unpriced_cash_secured_puts_are_not_shown_as_trades(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        result = run_general_option_scan(
            {
                "strategy": "cash-secured-put",
                "reference_delta_mode": "short",
                "min_reference_delta": 5,
                "max_reference_delta": 15,
                "include_near_matches": True,
            },
            runner=lambda _: {"rows": [
                {"ticker": "SHELL", "price": 100, "put": None, "score": 88},
                {"ticker": "LIVE", "price": 100, "put": {
                    "expiration": "2026-09-18", "strike": 95, "delta": -0.10,
                }},
            ]},
        )
        self.assertEqual([row["ticker"] for row in result["rows"]], ["LIVE"])
        self.assertEqual(result["stats"]["unpriced_dropped"], 1)
        self.assertEqual(result["rows"][0]["_general"]["strikes"], "95")

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_risk_averse_near_matches_still_require_a_listed_contract(
        self, score_rows, iv_history
    ):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        result = run_general_option_scan(
            {
                "strategy": "cash-secured-put",
                "reference_delta_mode": "short",
                "min_reference_delta": 5,
                "max_reference_delta": 15,
                "include_near_matches": True,
            },
            runner=lambda _: {"rows": [
                {"ticker": "AAPL", "price": 190, "put": None},
                {"ticker": "MSFT", "price": 420, "put": None},
                {"ticker": "NVDA", "price": 120, "put": None},
            ]},
        )
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["stats"]["unpriced_dropped"], 3)
        self.assertFalse(result["stats"]["showing_near_matches"])

    @patch("general_option_scanner._iv_history")
    @patch("general_option_scanner._score_rows")
    def test_unpriced_covered_calls_are_dropped(self, score_rows, iv_history):
        score_rows.side_effect = lambda rows: [
            row["_general"].update(stock_scores={}) for row in rows
        ]
        result = run_general_option_scan(
            {"strategy": "covered-call", "include_near_matches": True},
            runner=lambda _: {"rows": [
                {"ticker": "XYZ", "price": 100, "call": None},
            ]},
        )
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["stats"]["unpriced_dropped"], 1)


class VolatilityMetricTests(unittest.TestCase):
    def test_realized_vol_rank_is_high_after_a_volatile_month(self):
        dates = pd.bdate_range("2025-01-02", periods=252)
        prices = [100.0]
        for index in range(1, 231):
            prices.append(prices[-1] * (1.001 if index % 2 == 0 else 0.999))
        for index in range(231, 252):
            prices.append(prices[-1] * (1.04 if index % 2 == 0 else 0.96))
        metrics = _realized_vol_metrics(pd.DataFrame({"Close": prices}, index=dates))
        self.assertGreater(metrics["rv"], 0.2)
        self.assertGreaterEqual(metrics["rv_rank"], 90)

    def test_missing_volatility_metrics_do_not_reject_a_row(self):
        reasons = _filter_reasons(
            {"ticker": "XYZ", "iv_rank": None, "iv_rv": None, "iv_rv_rank": None,
             "rv_rank": None, "volatility_score": None},
            {
                "min_iv_rank": 80,
                "min_iv_rv": 2,
                "min_iv_rv_rank": 70,
                "min_rv_rank": 70,
                "min_volatility_score": 70,
            },
        )
        self.assertEqual(reasons, [])

    def test_volatility_filters_use_the_new_metrics(self):
        expensive = _filter_reasons(
            {"ticker": "RICH", "iv_rv": 6.0, "iv_rv_rank": 88, "rv_rank": 40,
             "volatility_score": 82},
            {"max_iv_rv": 2, "max_iv_rv_rank": 70, "max_volatility_score": 60},
        )
        cheap = _filter_reasons(
            {"ticker": "CHEAP", "iv_rv": -3.0, "iv_rv_rank": 20, "rv_rank": 30,
             "volatility_score": 25},
            {"max_iv_rv": 2, "max_iv_rv_rank": 70, "max_volatility_score": 60},
        )
        self.assertEqual(set(expensive), {"IV − RV", "IV − RV Rank", "Volatility score"})
        self.assertEqual(cheap, [])

    @patch("general_option_scanner.fetch_iv_observations")
    @patch("general_option_scanner.record_iv_snapshot")
    def test_iv_history_builds_spread_rank_and_volatility_score(self, record, fetch):
        start = date(2026, 1, 2)
        fetch.return_value = [
            {"observed_on": start + timedelta(days=index), "atm_iv": 0.16 + index * 0.002}
            for index in range(20)
        ]
        record.return_value = {"rank": 70.0, "observations": 20, "ready": True}
        rv_by_date = {
            start + timedelta(days=index): 0.18
            for index in range(20)
        }
        row = {"_general": {
            "ticker": "SPY",
            "atm_iv": 0.198,
            "expiration": "2026-02-20",
            "iv_rank": None,
            "rv": 18.0,
            "_rv_by_date": rv_by_date,
        }}
        _iv_history([row])
        meta = row["_general"]
        self.assertAlmostEqual(meta["iv_rv"], 1.8)
        self.assertEqual(meta["iv_rank"], 70.0)
        self.assertGreaterEqual(meta["iv_rv_rank"], 90)
        self.assertAlmostEqual(meta["volatility_score"], round((70.0 + meta["iv_rv_rank"]) / 2.0, 1))
        self.assertNotIn("_rv_by_date", meta)

    @patch("general_option_scanner.fetch_iv_observations")
    @patch("general_option_scanner.record_iv_snapshot")
    def test_volatility_score_uses_disclosed_provisional_ranks_during_warmup(self, record, fetch):
        days = [date.today() - timedelta(days=offset) for offset in (3, 2, 1)]
        fetch.return_value = [
            {"observed_on": day, "atm_iv": implied}
            for day, implied in zip(days, (0.19, 0.21, 0.22))
        ]
        record.return_value = {
            "rank": None,
            "provisional_rank": 75.0,
            "observations": 4,
            "ready": False,
        }
        row = {"_general": {
            "ticker": "SPY",
            "atm_iv": 0.24,
            "expiration": "2026-09-18",
            "iv_rank": None,
            "rv": 18.0,
            "_rv_by_date": {day: 0.18 for day in days},
        }}
        _iv_history([row])
        meta = row["_general"]
        self.assertEqual(meta["iv_rank"], 75.0)
        self.assertEqual(meta["iv_rank_source"], "provisional_history")
        self.assertIsNotNone(meta["iv_rv_rank"])
        self.assertIsNotNone(meta["volatility_score"])
        self.assertTrue(meta["volatility_score_provisional"])
        self.assertEqual(meta["volatility_score_observations"], 4)


if __name__ == "__main__":
    unittest.main()
