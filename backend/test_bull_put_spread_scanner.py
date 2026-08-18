"""Regression tests for the bull put credit spread scanner."""

from __future__ import annotations

import unittest
from datetime import date, timedelta
from unittest.mock import patch

import bull_put_spread_scanner as bps


def leg(strike, bid, ask, delta, oi=500, volume=100, iv=0.28):
    return {
        "strike": float(strike),
        "bid": float(bid),
        "ask": float(ask),
        "mid": (float(bid) + float(ask)) / 2.0,
        "delta": float(delta),
        "open_interest": oi,
        "volume": volume,
        "iv": iv,
    }


def tech(**overrides):
    base = {
        "ticker": "XYZ",
        "price": 100.0,
        "window_pct": -4.0,
        "stretch_sigma": 1.0,
        "drawdown_pct": -8.0,
        "rsi_14": 44.0,
        "sma_20": 101.0,
        "sma_50": 103.0,
        "sma_200": 95.0,
        "rv_30": 0.24,
        "rv_252": 0.22,
        "fresh_low": False,
        "bounce_off_low_pct": 3.0,
        "decel_pp": 2.0,
        "above_52w_low_pct": 25.0,
        "avg_dollar_volume": 250e6,
    }
    base.update(overrides)
    return base


def fund(**overrides):
    base = {
        "name": "Example",
        "quote_type": "EQUITY",
        "market_cap": 50e9,
        "trailing_eps": 5.0,
        "profit_margin": 0.15,
        "debt_to_equity": 60.0,
        "current_ratio": 1.4,
        "next_earnings": None,
    }
    base.update(overrides)
    return base


def spread(**overrides):
    base = {
        "short_strike": 95.0,
        "long_strike": 90.0,
        "width": 5.0,
        "credit": 1.25,
        "natural_credit": 1.10,
        "credit_pct_of_width": 25.0,
        "max_profit": 1.25,
        "max_loss": 3.75,
        "return_on_risk_pct": 33.3,
        "annualized_return_on_risk_pct": 347.0,
        "breakeven": 93.75,
        "short_otm_pct": 5.0,
        "breakeven_cushion_pct": 6.25,
        "prob_otm": 75.0,
        "premium_edge_pct": 15.0,
        "exec_cost_pct": 16.0,
        "open_interest_min": 500,
        "atm_iv": 0.30,
        "dte": 35,
        "expiration": (date.today() + timedelta(days=35)).isoformat(),
        "constraints_relaxed": False,
    }
    base.update(overrides)
    return base


class BandTests(unittest.TestCase):
    def test_middle_scores_full_points(self):
        self.assertEqual(bps._band(1.0, 0.0, 0.5, 1.5, 3.0, 8), 8)

    def test_extremes_score_zero(self):
        self.assertEqual(bps._band(0.0, 0.0, 0.5, 1.5, 3.0, 8), 0)
        self.assertEqual(bps._band(3.0, 0.0, 0.5, 1.5, 3.0, 8), 0)


class PairMathTests(unittest.TestCase):
    def setUp(self):
        self.short = leg(95, 2.00, 2.10, -0.25)
        self.long = leg(90, 0.75, 0.85, -0.10)

    def test_credit_spread_arithmetic(self):
        pair = bps._build_credit_pair(
            self.short, self.long, 100.0, 35, 0.24
        )
        self.assertAlmostEqual(pair["width"], 5.0)
        self.assertAlmostEqual(pair["credit"], 1.25)
        self.assertAlmostEqual(pair["max_loss"], 3.75)
        self.assertAlmostEqual(pair["breakeven"], 93.75)
        self.assertAlmostEqual(pair["credit_pct_of_width"], 25.0)
        self.assertAlmostEqual(pair["return_on_risk_pct"], 33.3333, places=3)

    def test_natural_credit_crosses_both_markets(self):
        pair = bps._build_credit_pair(
            self.short, self.long, 100.0, 35, 0.24
        )
        self.assertAlmostEqual(pair["natural_credit"], 1.15)
        self.assertAlmostEqual(pair["exec_cost"], 0.20)

    def test_maximum_dollars_reconcile(self):
        pair = bps._build_credit_pair(
            self.short, self.long, 100.0, 35, 0.24
        )
        self.assertAlmostEqual(pair["max_profit_dollars"], 125.0)
        self.assertAlmostEqual(pair["max_loss_dollars"], 375.0)

    def test_reversed_strikes_are_rejected(self):
        self.assertIsNone(
            bps._build_credit_pair(self.long, self.short, 100.0, 35, 0.24)
        )

    def test_credit_at_or_above_width_is_rejected(self):
        short = leg(95, 6.0, 6.2, -0.25)
        long = leg(90, 0.5, 0.6, -0.10)
        self.assertIsNone(
            bps._build_credit_pair(short, long, 100.0, 35, 0.24)
        )


class PairSelectionTests(unittest.TestCase):
    def setUp(self):
        self.expiration = (date.today() + timedelta(days=35)).isoformat()
        self.chain = [
            leg(100, 4.8, 5.0, -0.48, 1000),
            leg(95, 2.0, 2.1, -0.25, 700),
            leg(92, 1.2, 1.3, -0.16, 600),
            leg(90, 0.75, 0.85, -0.10, 500),
            leg(85, 0.30, 0.40, -0.05, 300),
        ]

    def _scan(self, **overrides):
        kwargs = {
            "ticker": "XYZ",
            "spot": 100.0,
            "div_yield": 0.0,
            "forecast_vol": 0.24,
            "target_dte": 35,
            "min_dte": 1,
            "max_dte": 1095,
            "short_delta": 0.25,
            "long_delta": 0.10,
            "delta_tolerance": 0.08,
            "min_width_pct": 1.0,
            "max_width_pct": 15.0,
            "min_credit_pct_of_width": 20.0,
            "min_cushion_pct": 3.0,
            "min_open_interest": 50,
            "max_exec_cost_pct": 30.0,
        }
        kwargs.update(overrides)
        fake_ticker = type("FakeTicker", (), {"options": [self.expiration]})()
        with patch.object(bps.yf, "Ticker", return_value=fake_ticker), patch.object(
            bps, "_load_put_chain", return_value=self.chain
        ):
            return bps._suggest_bull_put_spread(**kwargs)

    def test_short_is_higher_than_long_and_both_share_expiration(self):
        picked = self._scan()
        self.assertGreater(picked["short_strike"], picked["long_strike"])
        self.assertEqual(picked["expiration"], self.expiration)

    def test_short_leg_lands_near_requested_delta(self):
        picked = self._scan()
        self.assertAlmostEqual(abs(picked["short_leg"]["delta"]), 0.25)

    def test_qualifying_pair_does_not_relax_constraints(self):
        picked = self._scan()
        self.assertFalse(picked["constraints_relaxed"])
        self.assertGreaterEqual(picked["credit_pct_of_width"], 20.0)
        self.assertGreaterEqual(picked["breakeven_cushion_pct"], 3.0)
        self.assertGreaterEqual(picked["open_interest_min"], 50)

    def test_impossible_credit_floor_returns_watchlist_fallback(self):
        picked = self._scan(min_credit_pct_of_width=80.0)
        self.assertTrue(picked["constraints_relaxed"])

    def test_recent_trades_keep_after_hours_analysis_available(self):
        broken = [leg(95, 0, 2.0, -0.25), leg(90, 0.5, 0.4, -0.10)]
        with patch.object(bps.yf, "Ticker", return_value=type(
            "FakeTicker", (), {"options": [self.expiration]}
        )()), patch.object(bps, "_load_put_chain", return_value=broken):
            picked = bps._suggest_bull_put_spread(
                "XYZ", 100, 0, 0.24, 35, 1, 1095
            )
        self.assertIsNotNone(picked)
        self.assertTrue(picked["uses_last_trade_prices"])
        self.assertEqual(picked["quote_source"], "last_trade_estimate")
        self.assertTrue(picked["constraints_relaxed"])
        self.assertIsNone(picked["natural_credit"])
        self.assertIsNone(picked["exec_cost_pct"])

    def test_long_dated_target_is_not_clipped(self):
        long_exp = (date.today() + timedelta(days=400)).isoformat()
        fake_ticker = type("FakeTicker", (), {
            "options": [self.expiration, long_exp]
        })()
        with patch.object(bps.yf, "Ticker", return_value=fake_ticker), patch.object(
            bps, "_load_put_chain", return_value=self.chain
        ):
            picked = bps._suggest_bull_put_spread(
                "XYZ", 100, 0, 0.24, 400, 1, 1095,
                min_credit_pct_of_width=1,
                min_cushion_pct=0,
                min_open_interest=0,
                max_exec_cost_pct=100,
            )
        self.assertEqual(picked["expiration"], long_exp)


class ScoringTests(unittest.TestCase):
    def test_component_maxima_total_one_hundred(self):
        rating = bps.score_candidate(tech(), fund(), spread())
        self.assertEqual(sum(rating["component_max"].values()), 100)

    def test_healthy_setup_scores_better_than_broken_trend(self):
        good = bps.score_candidate(tech(), fund(), spread())
        bad = bps.score_candidate(
            tech(price=80, sma_50=90, sma_200=100, fresh_low=True),
            fund(),
            spread(),
        )
        self.assertGreater(good["score"], bad["score"])
        self.assertIn("Price below the 200-day average", bad["flags"])

    def test_better_execution_scores_higher(self):
        good = bps.score_candidate(
            tech(), fund(), spread(exec_cost_pct=8, open_interest_min=1000)
        )
        bad = bps.score_candidate(
            tech(), fund(), spread(exec_cost_pct=60, open_interest_min=10)
        )
        self.assertGreater(good["score"], bad["score"])
        self.assertIn("Two-leg slippage is high", bad["flags"])

    def test_earnings_inside_trade_is_flagged(self):
        earnings = (date.today() + timedelta(days=20)).isoformat()
        rating = bps.score_candidate(
            tech(), fund(next_earnings=earnings), spread()
        )
        self.assertTrue(rating["earnings_before_expiry"])
        self.assertIn("Earnings before expiration", rating["flags"])

    def test_unpriced_candidate_has_partial_score(self):
        rating = bps.score_candidate(tech(), fund(), None)
        self.assertTrue(rating["scored_on_partial"])
        self.assertIn("Option chain unavailable", rating["flags"])


class ManagementTests(unittest.TestCase):
    def test_target_closes_for_less_than_entry_credit(self):
        plan = bps.recommend_management(spread(), {"grade": "B", "score": 75, "flags": []})
        self.assertLess(plan["target_debit"], spread()["credit"])
        self.assertGreater(plan["profit_capture_pct"], 0)

    def test_stop_is_above_entry_credit_but_below_width(self):
        plan = bps.recommend_management(spread(), {"grade": "C", "score": 65, "flags": []})
        self.assertGreater(plan["stop_debit"], spread()["credit"])
        self.assertLess(plan["stop_debit"], spread()["width"])

    def test_plan_closes_before_expiration(self):
        plan = bps.recommend_management(spread(dte=35), {"grade": "B", "score": 75, "flags": []})
        self.assertEqual(plan["close_by_dte"], 3)
        self.assertGreater(plan["reassess_dte"], plan["close_by_dte"])


class PartitionTests(unittest.TestCase):
    def test_only_actionable_rows_reach_primary_results(self):
        rows = [
            {"ticker": "GOOD", "score": 70, "chain_status": "actionable"},
            {"ticker": "EARN", "score": 90, "chain_status": "earnings"},
            {"ticker": "RELAX", "score": 85, "chain_status": "constraints_relaxed"},
            {"ticker": "NONE", "score": 80, "chain_status": "unavailable"},
        ]
        actionable, watchlist = bps._partition_candidate_rows(rows, 40)
        self.assertEqual([row["ticker"] for row in actionable], ["GOOD"])
        self.assertEqual(
            [row["ticker"] for row in watchlist],
            ["EARN", "RELAX", "NONE"],
        )


class DefaultsTests(unittest.TestCase):
    def test_default_underlying_is_a_pullback_in_an_uptrend(self):
        self.assertTrue(bps.DEFAULTS["require_above_sma200"])
        self.assertTrue(bps.DEFAULTS["exclude_fresh_lows"])
        self.assertLess(bps.DEFAULTS["min_drop_pct"], bps.DEFAULTS["max_drop_pct"])
        self.assertLess(bps.DEFAULTS["min_rsi"], bps.DEFAULTS["max_rsi"])

    def test_default_short_leg_is_higher_delta_than_long_leg(self):
        self.assertGreater(
            bps.DEFAULTS["short_delta"], bps.DEFAULTS["long_delta"]
        )

    def test_default_expiration_window_does_not_cap_target(self):
        self.assertLessEqual(
            bps.DEFAULTS["min_dte"], bps.DEFAULTS["target_dte"]
        )
        self.assertGreaterEqual(
            bps.DEFAULTS["max_dte"], bps.DEFAULTS["target_dte"]
        )


class SelectedFundFallbackTests(unittest.TestCase):
    def test_selected_etf_technical_near_miss_is_watchlist_only(self):
        weak_tech = tech(
            ticker="GLD", drawdown_pct=-0.2, stretch_sigma=0.1, rsi_14=75.0,
            price=100.0, sma_50=99.0, sma_200=95.0,
        )
        commodity_fund = fund(
            quote_type="ETF", market_cap=None, total_assets=100e9,
            name="SPDR Gold Shares", category="Commodities Precious Metals",
        )
        quoted_spread = spread(
            short_leg=leg(95, 2.0, 2.1, -0.25),
            long_leg=leg(90, 0.75, 0.85, -0.10),
            max_profit_dollars=125.0,
            max_loss_dollars=375.0,
        )
        with (
            patch.object(
                bps, "_load_history",
                return_value=type("History", (), {"empty": False})(),
            ),
            patch.object(bps, "_benchmark_returns", return_value=None),
            patch.object(bps, "_ticker_frame", return_value=object()),
            patch.object(bps, "_compute_technicals", return_value=weak_tech),
            patch.object(bps, "_fetch_fundamentals_bulk", return_value={"GLD": commodity_fund}),
            patch.object(bps, "_suggest_bull_put_spread", return_value=quoted_spread),
            patch.object(bps, "profit_probability_schedule", return_value=([], None)),
        ):
            result = bps.run_bull_put_spread_scan({
                "include_stocks": False,
                "include_index_etfs": False,
                "include_sector_etfs": False,
                "include_selected_funds": True,
                "selected_fund_tickers": "GLD",
                "include_lower_confidence_selected_funds": True,
            })

        self.assertEqual(result["rows"], [])
        self.assertEqual(result["watchlist_rows"][0]["ticker"], "GLD")
        self.assertEqual(
            result["watchlist_rows"][0]["chain_status"],
            "underlying_filters_missed",
        )
        self.assertIn(
            bps.LOW_CONFIDENCE_SELECTED_FUND_FLAG,
            result["watchlist_rows"][0]["flags"],
        )


if __name__ == "__main__":
    unittest.main()
