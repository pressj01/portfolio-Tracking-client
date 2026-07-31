"""Pure-math tests for the bear put spread scanner. No network access."""

import math
import os
import sys
import unittest
from datetime import date, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bear_put_spread_scanner as bps
import call_scanner as cs
import put_scanner as ps
from options_pricing import black_scholes


def synthetic_frame(daily_sigma=0.012, drift=0.0, days=300, move_pct=None,
                    move_days=21, seed=7):
    """Deterministic OHLCV, optionally with an even move over the tail window."""
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, daily_sigma, days)
    if move_pct is not None:
        per_day = math.log(1.0 + move_pct / 100.0) / move_days
        rets[-move_days:] = per_day
    close = 100.0 * np.exp(np.cumsum(rets))
    index = pd.bdate_range(end=date.today(), periods=days)
    return pd.DataFrame({
        "Open": close * 0.999,
        "High": close * 1.008,
        "Low": close * 0.992,
        "Close": close,
        "Volume": np.full(days, 3_000_000.0),
    }, index=index)


def a_leg(strike, bid, ask, iv=0.32, delta=-0.5, oi=800, vol=200):
    return {
        "strike": strike, "bid": bid, "ask": ask, "mid": (bid + ask) / 2.0,
        "iv": iv, "delta": delta, "open_interest": oi, "volume": vol, "dte": 45,
    }


def a_spread(**over):
    """A well-structured 100/90 put spread on a $100 stock, 45 DTE."""
    base = {
        "expiration": (date.today() + timedelta(days=45)).isoformat(),
        "dte": 45,
        "long_strike": 100.0, "short_strike": 90.0, "width": 10.0,
        "debit": 3.40, "debit_worst_case": 3.80, "debit_pct_of_width": 34.0,
        "max_profit": 6.60, "max_loss": 3.40, "reward_risk": 1.94,
        "breakeven": 96.60, "required_move_pct": 10.0, "breakeven_move_pct": 3.4,
        "required_move_sigma": 0.95, "breakeven_move_sigma": 0.32,
        "expected_move_pct_life": 10.5,
        "prob_profit": 39.0, "prob_max_profit": 17.0,
        "fair_value": 3.85, "edge": 0.45, "edge_pct": 13.2,
        "skew_ratio": 1.12, "atm_iv": 0.32,
        "exec_cost": 0.28, "exec_cost_pct": 8.2,
        "open_interest_min": 800, "volume_min": 150,
        "debit_dollars": 340.0, "max_profit_dollars": 660.0, "max_loss_dollars": 340.0,
        "outright_cost": 4.80, "cost_saving_pct": 29.0,
        "constraints_relaxed": False, "pairs_considered": 12,
        "long_leg": a_leg(100.0, 4.70, 4.90, delta=-0.50),
        "short_leg": a_leg(90.0, 1.42, 1.58, iv=0.358, delta=-0.22),
    }
    base.update(over)
    return base


def a_tech(**over):
    """A breakdown in progress: the shape the screen is looking for."""
    base = {
        "ticker": "TEST", "price": 100.0,
        "window_pct": -9.0, "decline_pct": 9.0, "stretch_sigma": 1.4,
        "drawdown_pct": -14.0, "above_52w_low_pct": 22.0, "pct_of_52w_range": 55.0,
        "rel_weakness_pct": 6.0, "excess_move_pct": -6.0, "beta": 1.1,
        "rsi_14": 42.0, "rsi_roll_pp": -12.0,
        "sma_20": 103.0, "sma_50": 107.0, "sma_200": 112.0,
        "below_sma20": True, "below_sma50": True,
        "sma20_below_sma50": True, "sma50_below_sma200": True,
        "below_sma50_pct": 6.5, "room_to_sma200_pct": -10.7, "days_below_sma50": 9,
        "lower_high": True, "fresh_low": False, "bounce_off_low_pct": 1.5,
        "accel_pp": -3.0, "rv_30": 0.30, "rv_252": 0.28,
        "avg_dollar_volume": 400e6,
    }
    base.update(over)
    return base


LARGE_STOCK = {"market_cap": 120e9, "quote_type": "EQUITY"}


# ---------------------------------------------------------------------------

class SharedHelperTests(unittest.TestCase):
    """The primitives are shared with the other two screens, not re-derived."""

    def test_stretch_primitive_is_the_shared_one(self):
        self.assertIs(bps.window_stretch, ps.window_stretch)

    def test_put_chain_loader_is_shared_so_the_cache_is_shared(self):
        self.assertIs(bps._load_put_chain, ps._load_put_chain)

    def test_small_cap_universe_comes_from_the_call_screen(self):
        self.assertIs(bps.SMALL_CAP_SET, cs.SMALL_CAP_SET)

    def test_decline_reads_positive_and_a_run_reads_negative(self):
        sub = synthetic_frame(daily_sigma=0.008, move_pct=-18.0, move_days=21)
        tech = bps._compute_technicals(sub, None, 21)
        self.assertIsNotNone(tech)
        self.assertGreater(tech["stretch_sigma"], 3.0)
        self.assertGreater(tech["decline_pct"], 15.0)

        # The same frame read by the covered call screen is the mirror image.
        call_tech = cs._compute_technicals(sub, None, 21)
        self.assertAlmostEqual(tech["stretch_sigma"], -call_tech["stretch_sigma"], places=6)


class BandTests(unittest.TestCase):
    """The trapezoid is the heart of the screen — it must peak in the middle."""

    def test_zero_below_the_rise_and_above_the_fall(self):
        self.assertEqual(bps._band(-1.0, 0, 1, 2, 3, 10), 0.0)
        self.assertEqual(bps._band(0.0, 0, 1, 2, 3, 10), 0.0)
        self.assertEqual(bps._band(3.0, 0, 1, 2, 3, 10), 0.0)
        self.assertEqual(bps._band(9.9, 0, 1, 2, 3, 10), 0.0)

    def test_full_points_across_the_plateau(self):
        for v in (1.0, 1.5, 2.0):
            self.assertEqual(bps._band(v, 0, 1, 2, 3, 10), 10.0)

    def test_ramps_up_then_down(self):
        self.assertAlmostEqual(bps._band(0.5, 0, 1, 2, 3, 10), 5.0)
        self.assertAlmostEqual(bps._band(2.5, 0, 1, 2, 3, 10), 5.0)

    def test_missing_value_scores_nothing(self):
        self.assertEqual(bps._band(None, 0, 1, 2, 3, 10), 0.0)

    def test_an_extreme_decline_scores_below_a_moderate_one(self):
        """The one behaviour a plain ramp gets backwards."""
        moderate = bps.score_candidate(a_tech(stretch_sigma=1.5), LARGE_STOCK, a_spread())
        extreme = bps.score_candidate(a_tech(stretch_sigma=3.6), LARGE_STOCK, a_spread())
        self.assertGreater(moderate["components"]["breakdown"], extreme["components"]["breakdown"])


class ProbabilityTests(unittest.TestCase):
    def test_prob_below_the_spot_is_about_half(self):
        p = bps.prob_below(100.0, 100.0, 45 / 365, 0.30)
        self.assertAlmostEqual(p, 0.5, delta=0.03)

    def test_prob_below_falls_as_the_strike_falls(self):
        T = 45 / 365
        near = bps.prob_below(100.0, 97.0, T, 0.30)
        far = bps.prob_below(100.0, 85.0, T, 0.30)
        self.assertGreater(near, far)
        self.assertLess(far, 0.15)

    def test_prob_below_is_not_the_same_as_delta(self):
        """N(-d2), not N(-d1): a put's delta *understates* finishing below the strike.

        Which matters in the direction that flatters the trade — using the short
        leg's delta as the probability of max profit would quietly understate how
        often the short strike is breached.
        """
        T, vol = 45 / 365, 0.30
        for K in (105.0, 100.0, 95.0, 90.0, 85.0):
            for r, q in ((0.0, 0.0), (bps.RISK_FREE, 0.0), (bps.RISK_FREE, 0.02)):
                prob = bps.prob_below(100.0, K, T, vol, r, q)
                delta = abs(black_scholes(100.0, K, T, r, q, vol, "put")["delta"])
                self.assertGreater(prob, delta, f"K={K} r={r} q={q}")

    def test_degenerate_inputs_return_none(self):
        self.assertIsNone(bps.prob_below(0.0, 90.0, 0.1, 0.3))
        self.assertIsNone(bps.prob_below(100.0, 90.0, 0.1, 0.0))
        self.assertIsNone(bps.prob_below(100.0, 90.0, 0.0, 0.3))

    def test_strike_for_put_delta_inverts_black_scholes(self):
        T = 45 / 365
        for target in (0.50, 0.35, 0.25, 0.15):
            k = bps.strike_for_put_delta(100.0, target, 0.30, T)
            got = abs(black_scholes(100.0, k, T, 0.0, 0.0, 0.30, "put")["delta"])
            self.assertAlmostEqual(got, target, places=3)

    def test_strike_for_put_delta_degrades_to_spot_without_vol(self):
        self.assertEqual(bps.strike_for_put_delta(100.0, 0.25, 0.0, 0.1), 100.0)


class FairValueTests(unittest.TestCase):
    def test_fair_value_is_positive_and_below_the_width(self):
        fv = bps.vertical_fair_value(100.0, 100.0, 90.0, 45 / 365, 0.30)
        self.assertGreater(fv, 0.0)
        self.assertLess(fv, 10.0)

    def test_higher_volatility_is_worth_more(self):
        T = 45 / 365
        quiet = bps.vertical_fair_value(100.0, 100.0, 90.0, T, 0.18)
        wild = bps.vertical_fair_value(100.0, 100.0, 90.0, T, 0.45)
        self.assertGreater(wild, quiet)

    def test_it_equals_the_difference_of_two_zero_carry_puts(self):
        T, vol = 45 / 365, 0.30
        expected = (black_scholes(100.0, 100.0, T, 0.0, 0.0, vol, "put")["price"]
                    - black_scholes(100.0, 90.0, T, 0.0, 0.0, vol, "put")["price"])
        self.assertAlmostEqual(bps.vertical_fair_value(100.0, 100.0, 90.0, T, vol),
                               expected, places=9)

    def test_no_volatility_means_no_fair_value(self):
        self.assertIsNone(bps.vertical_fair_value(100.0, 100.0, 90.0, 0.1, 0.0))


class TechnicalTests(unittest.TestCase):
    def test_thin_history_returns_none(self):
        self.assertIsNone(bps._compute_technicals(synthetic_frame(days=40), None, 21))

    def test_a_falling_name_is_below_its_moving_averages(self):
        sub = synthetic_frame(daily_sigma=0.01, drift=-0.0012, move_pct=-12.0, move_days=21)
        tech = bps._compute_technicals(sub, None, 21)
        self.assertTrue(tech["below_sma50"])
        self.assertTrue(tech["sma20_below_sma50"])
        self.assertIsNotNone(tech["days_below_sma50"])
        self.assertGreater(tech["below_sma50_pct"], 0.0)

    def test_days_below_sma50_is_small_for_a_fresh_break(self):
        # A year of steady advance — so price is above its 50-day right up to the
        # break — then a sharp two-week drop straight through the average.
        sub = synthetic_frame(daily_sigma=0.005, drift=0.0010, days=300, seed=21).copy()
        closes = sub["Close"].values.copy()
        base = closes[-11]
        for i in range(10):
            closes[-10 + i] = base * (1.0 - 0.014 * (i + 1))
        sub["Close"] = closes
        tech = bps._compute_technicals(sub, None, 21)
        self.assertTrue(tech["below_sma50"])
        self.assertLessEqual(tech["days_below_sma50"], 15)

    def test_days_below_sma50_is_large_for_an_established_downtrend(self):
        sub = synthetic_frame(daily_sigma=0.008, drift=-0.0015, days=300, seed=13)
        tech = bps._compute_technicals(sub, None, 21)
        self.assertTrue(tech["below_sma50"])
        self.assertGreater(tech["days_below_sma50"], 30)

    def test_lower_high_is_set_when_the_recent_high_is_under_the_older_one(self):
        sub = synthetic_frame(daily_sigma=0.008, drift=-0.001, move_pct=-15.0, move_days=21)
        tech = bps._compute_technicals(sub, None, 21)
        self.assertTrue(tech["lower_high"])

    def test_rsi_roll_is_negative_while_momentum_deteriorates(self):
        sub = synthetic_frame(daily_sigma=0.008, move_pct=-16.0, move_days=21, seed=4)
        tech = bps._compute_technicals(sub, None, 21)
        self.assertIsNotNone(tech["rsi_roll_pp"])
        self.assertLess(tech["rsi_roll_pp"], 0.0)

    def test_relative_weakness_strips_out_market_beta(self):
        """A name that only fell with the market is not breaking down on its own."""
        sub = synthetic_frame(daily_sigma=0.01, move_pct=-15.0, move_days=21, seed=5)
        bench_ret = np.log(sub["Close"] / sub["Close"].shift(1)).dropna()
        tech = bps._compute_technicals(sub, bench_ret, 21)
        self.assertLess(abs(tech["rel_weakness_pct"]), 2.0)

    def test_relative_weakness_is_the_negated_excess_move(self):
        sub = synthetic_frame(daily_sigma=0.012, move_pct=-14.0, move_days=21, seed=8)
        bench = synthetic_frame(daily_sigma=0.008, days=300, seed=99)
        bench_ret = np.log(bench["Close"] / bench["Close"].shift(1)).dropna()
        tech = bps._compute_technicals(sub, bench_ret, 21)
        self.assertAlmostEqual(tech["rel_weakness_pct"], -tech["excess_move_pct"], places=9)

    def test_fresh_low_is_detected(self):
        sub = synthetic_frame(daily_sigma=0.01, drift=-0.0015, move_pct=-20.0, move_days=21)
        tech = bps._compute_technicals(sub, None, 21)
        self.assertTrue(tech["fresh_low"])

    def test_range_position_stays_inside_zero_to_one_hundred(self):
        tech = bps._compute_technicals(synthetic_frame(daily_sigma=0.02, seed=3), None, 21)
        self.assertGreaterEqual(tech["pct_of_52w_range"], 0.0)
        self.assertLessEqual(tech["pct_of_52w_range"], 100.0)


class BuildPairTests(unittest.TestCase):
    def _pair(self, long_leg, short_leg, spot=100.0, vol=0.30, dte=45):
        return bps._build_pair(long_leg, short_leg, spot, dte, dte / 365.0, vol, 0.0)

    def test_basic_arithmetic(self):
        p = self._pair(a_leg(100.0, 4.70, 4.90, delta=-0.50),
                       a_leg(90.0, 1.42, 1.58, iv=0.358, delta=-0.22))
        self.assertAlmostEqual(p["width"], 10.0)
        self.assertAlmostEqual(p["debit"], 4.80 - 1.50)
        self.assertAlmostEqual(p["max_profit"], 10.0 - p["debit"])
        self.assertAlmostEqual(p["reward_risk"], p["max_profit"] / p["debit"])
        self.assertAlmostEqual(p["breakeven"], 100.0 - p["debit"])
        self.assertAlmostEqual(p["max_loss_dollars"], p["debit"] * 100.0)
        self.assertAlmostEqual(p["debit_pct_of_width"], p["debit"] / 10.0 * 100.0)

    def test_worst_case_debit_pays_both_spreads(self):
        p = self._pair(a_leg(100.0, 4.70, 4.90), a_leg(90.0, 1.42, 1.58))
        self.assertAlmostEqual(p["debit_worst_case"], 4.90 - 1.42)
        self.assertGreater(p["debit_worst_case"], p["debit"])
        self.assertAlmostEqual(p["exec_cost"], 0.20 + 0.16)

    def test_required_move_is_measured_in_the_names_own_sigma(self):
        p = self._pair(a_leg(100.0, 4.70, 4.90), a_leg(90.0, 1.42, 1.58), vol=0.30)
        sigma_T = 0.30 * math.sqrt(45 / 365)
        self.assertAlmostEqual(p["required_move_sigma"], -math.log(90 / 100) / sigma_T, places=9)
        # A quieter stock needs a bigger move in its own terms for the same strike.
        quiet = self._pair(a_leg(100.0, 4.70, 4.90), a_leg(90.0, 1.42, 1.58), vol=0.15)
        self.assertGreater(quiet["required_move_sigma"], p["required_move_sigma"])

    def test_breakeven_is_nearer_than_the_short_strike(self):
        p = self._pair(a_leg(100.0, 4.70, 4.90), a_leg(90.0, 1.42, 1.58))
        self.assertLess(p["breakeven_move_sigma"], p["required_move_sigma"])
        self.assertGreater(p["prob_profit"], p["prob_max_profit"])

    def test_edge_is_positive_when_the_debit_undercuts_realized_vol_fair_value(self):
        cheap = self._pair(a_leg(100.0, 4.00, 4.10), a_leg(90.0, 1.60, 1.70), vol=0.34)
        self.assertGreater(cheap["edge_pct"], 0.0)
        rich = self._pair(a_leg(100.0, 6.40, 6.60), a_leg(90.0, 1.00, 1.10), vol=0.18)
        self.assertLess(rich["edge_pct"], 0.0)

    def test_skew_ratio_reads_the_short_leg_against_the_long_leg(self):
        p = self._pair(a_leg(100.0, 4.70, 4.90, iv=0.30),
                       a_leg(90.0, 1.42, 1.58, iv=0.36))
        self.assertAlmostEqual(p["skew_ratio"], 0.36 / 0.30, places=9)

    def test_inverted_strikes_are_rejected(self):
        self.assertIsNone(self._pair(a_leg(90.0, 1.42, 1.58), a_leg(100.0, 4.70, 4.90)))

    def test_a_debit_at_or_above_the_width_is_bad_data_not_free_money(self):
        # Long leg quoted below the short leg of a lower strike: impossible.
        self.assertIsNone(self._pair(a_leg(100.0, 1.00, 1.10), a_leg(90.0, 4.70, 4.90)))
        # And a debit above the width would guarantee a loss.
        self.assertIsNone(self._pair(a_leg(100.0, 20.0, 20.2), a_leg(90.0, 1.0, 1.1)))

    def test_cost_saving_against_the_outright_put(self):
        p = self._pair(a_leg(100.0, 4.70, 4.90), a_leg(90.0, 1.42, 1.58))
        self.assertAlmostEqual(p["outright_cost"], 4.80)
        self.assertAlmostEqual(p["cost_saving_pct"], (1 - p["debit"] / 4.80) * 100.0, places=9)


class QuotableTests(unittest.TestCase):
    def test_both_sides_live_is_quotable(self):
        self.assertTrue(bps._quotable(a_leg(100.0, 4.70, 4.90)))

    def test_a_missing_side_is_not(self):
        self.assertFalse(bps._quotable({"bid": 0.0, "ask": 4.9, "mid": 4.9}))
        self.assertFalse(bps._quotable({"bid": 4.7, "ask": 0.0, "mid": 4.7}))

    def test_a_crossed_quote_is_not(self):
        self.assertFalse(bps._quotable({"bid": 5.0, "ask": 4.5, "mid": 4.75}))


class PairSelectionTests(unittest.TestCase):
    """Strike-pair selection, exercised against a synthetic chain (no network)."""

    def _chain(self):
        """Puts from 80 to 106 on a $100 stock, with a realistic downside skew."""
        rows = []
        T = 45 / 365
        for strike in range(80, 108, 2):
            k = float(strike)
            # Skew: implied vol rises as the strike falls.
            iv = 0.30 + max(0.0, (100.0 - k)) * 0.005
            greeks = black_scholes(100.0, k, T, 0.04, 0.0, iv, "put")
            mid = max(0.05, greeks["price"])
            rows.append({
                "strike": k, "bid": round(mid - 0.06, 2), "ask": round(mid + 0.06, 2),
                "mid": round(mid, 2), "iv": iv, "delta": greeks["delta"],
                "volume": 150, "open_interest": 900, "dte": 45,
            })
        return rows

    def _suggest(self, chain=None, **over):
        chain = chain if chain is not None else self._chain()
        expiration = (date.today() + timedelta(days=45)).isoformat()

        class FakeTicker:
            options = [expiration]

        real_ticker, real_chain = bps.yf.Ticker, bps._load_put_chain
        bps.yf.Ticker = lambda *_a, **_k: FakeTicker()
        bps._load_put_chain = lambda *_a, **_k: chain
        try:
            kwargs = {
                "ticker": "TEST", "spot": 100.0, "div_yield": 0.0, "forecast_vol": 0.30,
                "target_dte": 45, "min_dte": 21, "max_dte": 90,
            }
            kwargs.update(over)
            return bps._suggest_spread(**kwargs)
        finally:
            bps.yf.Ticker, bps._load_put_chain = real_ticker, real_chain

    def test_it_returns_a_long_above_a_short(self):
        s = self._suggest()
        self.assertIsNotNone(s)
        self.assertGreater(s["long_strike"], s["short_strike"])
        self.assertGreater(s["debit"], 0.0)
        self.assertLess(s["debit"], s["width"])

    def test_the_long_leg_lands_near_the_requested_delta(self):
        s = self._suggest(long_delta=0.50, short_delta=0.25, delta_tolerance=0.08)
        self.assertAlmostEqual(abs(s["long_leg"]["delta"]), 0.50, delta=0.12)

    def test_a_lower_short_delta_widens_the_spread(self):
        near = self._suggest(short_delta=0.35, delta_tolerance=0.05)
        far = self._suggest(short_delta=0.12, delta_tolerance=0.05)
        self.assertGreater(far["width"], near["width"])
        # ...and a wider spread costs proportionally less of its width.
        self.assertLess(far["debit_pct_of_width"], near["debit_pct_of_width"])

    def test_the_debit_filter_is_respected_when_it_can_be(self):
        s = self._suggest(max_debit_pct_of_width=45.0)
        self.assertLessEqual(s["debit_pct_of_width"], 45.0)
        self.assertFalse(s["constraints_relaxed"])

    def test_an_impossible_filter_relaxes_and_says_so(self):
        s = self._suggest(max_debit_pct_of_width=5.0, min_reward_risk=25.0)
        self.assertIsNotNone(s)
        self.assertTrue(s["constraints_relaxed"])

    def test_the_width_window_is_respected(self):
        s = self._suggest(min_width_pct=12.0, max_width_pct=20.0)
        self.assertGreaterEqual(s["width"], 12.0)
        self.assertLessEqual(s["width"], 20.0)

    def test_reward_risk_floor_is_respected(self):
        s = self._suggest(min_reward_risk=2.0)
        self.assertGreaterEqual(s["reward_risk"], 2.0)

    def test_recent_trades_keep_after_hours_analysis_available(self):
        chain = [{**r, "bid": 0.0} for r in self._chain()]
        spread = self._suggest(chain=chain)
        self.assertIsNotNone(spread)
        self.assertTrue(spread["uses_last_trade_prices"])
        self.assertEqual(spread["quote_source"], "last_trade_estimate")
        self.assertTrue(spread["constraints_relaxed"])
        self.assertIsNone(spread["debit_worst_case"])
        self.assertIsNone(spread["exec_cost_pct"])

    def test_a_chain_with_no_implied_vols_still_places_the_strikes(self):
        """The delta-inversion fallback: no IV means no per-strike delta."""
        chain = [{**r, "iv": 0.0, "delta": None} for r in self._chain()]
        s = self._suggest(chain=chain)
        self.assertIsNotNone(s)
        self.assertGreater(s["long_strike"], s["short_strike"])
        # The long leg should still land near the money.
        self.assertLess(abs(s["long_strike"] - 100.0), 8.0)

    def test_the_downside_skew_shows_up_as_a_ratio_above_one(self):
        s = self._suggest()
        self.assertGreater(s["skew_ratio"], 1.0)

    def test_earnings_cutoff_is_passed_through_to_the_expiration_choice(self):
        soon = (date.today() + timedelta(days=20)).isoformat()
        s = self._suggest(earnings_date=soon, earnings_buffer_days=5)
        self.assertFalse(s["avoids_earnings"])
        self.assertEqual(s["earnings_date"], soon)

    def test_an_explicit_window_still_narrows_the_choice(self):
        self.assertIsNone(self._suggest(min_dte=120, max_dte=200))

    def test_a_long_dated_target_is_honoured_rather_than_clipped(self):
        """A LEAP put spread on a broken trend is a legitimate use of the screen."""
        far = (date.today() + timedelta(days=400)).isoformat()
        near = (date.today() + timedelta(days=30)).isoformat()
        chain = self._chain()

        class FakeTicker:
            options = [near, far]

        real_ticker, real_chain = bps.yf.Ticker, bps._load_put_chain
        bps.yf.Ticker = lambda *_a, **_k: FakeTicker()
        bps._load_put_chain = lambda *_a, **_k: chain
        try:
            s = bps._suggest_spread(
                "TEST", 100.0, 0.0, 0.30, target_dte=400,
                min_dte=bps.MIN_TARGET_DTE, max_dte=bps.MAX_TARGET_DTE,
            )
        finally:
            bps.yf.Ticker, bps._load_put_chain = real_ticker, real_chain
        self.assertEqual(s["expiration"], far)
        self.assertGreater(s["dte"], 300)

    def test_atm_iv_comes_from_the_whole_chain_not_the_chosen_strikes(self):
        s = self._suggest()
        self.assertAlmostEqual(s["atm_iv"], 0.30, delta=0.02)


class ScoringTests(unittest.TestCase):
    def test_component_maxima_add_to_one_hundred(self):
        rating = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread())
        self.assertFalse(rating["scored_on_partial"])
        self.assertEqual(sum(rating["component_max"].values()), 100)

    def test_a_solid_but_ordinary_setup_lands_mid_scale(self):
        """Calibrated against the other two screens, which rate their equivalent
        setups around 60-75, so a C means the same thing on all three."""
        rating = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread())
        self.assertIn(rating["grade"], ("C", "B"))
        self.assertGreater(rating["score"], 55.0)
        self.assertLess(rating["score"], 80.0)

    def test_an_exceptional_setup_reaches_the_top_grades(self):
        rating = bps.score_candidate(
            a_tech(rel_weakness_pct=13.0, rsi_roll_pp=-22.0, stretch_sigma=1.6,
                   above_52w_low_pct=45.0, pct_of_52w_range=78.0, drawdown_pct=-10.0,
                   days_below_sma50=6),
            LARGE_STOCK,
            a_spread(reward_risk=3.1, edge_pct=42.0, required_move_sigma=0.85,
                     skew_ratio=1.28, exec_cost_pct=5.0, open_interest_min=3000),
        )
        self.assertIn(rating["grade"], ("A", "B"))
        self.assertGreater(rating["score"], 80.0)

    def test_a_name_with_no_broken_structure_scores_poorly_on_breakdown(self):
        intact = bps.score_candidate(
            a_tech(below_sma50=False, sma20_below_sma50=False, sma50_below_sma200=False,
                   days_below_sma50=0, lower_high=False),
            LARGE_STOCK, a_spread(),
        )
        broken = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread())
        self.assertGreater(broken["components"]["breakdown"], intact["components"]["breakdown"] + 8)

    def test_relative_weakness_drives_the_breakdown_axis(self):
        weak = bps.score_candidate(a_tech(rel_weakness_pct=12.0), LARGE_STOCK, a_spread())
        market = bps.score_candidate(a_tech(rel_weakness_pct=0.5), LARGE_STOCK, a_spread())
        self.assertGreater(weak["components"]["breakdown"], market["components"]["breakdown"])

    def test_fresh_lows_and_deep_oversold_are_flagged(self):
        rating = bps.score_candidate(
            a_tech(fresh_low=True, rsi_14=24.0, bounce_off_low_pct=11.0),
            LARGE_STOCK, a_spread(),
        )
        self.assertIn("Making fresh 52-week lows", rating["flags"])
        self.assertIn("Already deeply oversold — bounce risk", rating["flags"])
        self.assertIn("Sharp bounce off the recent low", rating["flags"])

    def test_a_stale_downtrend_is_flagged(self):
        rating = bps.score_candidate(a_tech(days_below_sma50=200), LARGE_STOCK, a_spread())
        self.assertIn("Downtrend already months old", rating["flags"])

    def test_no_room_to_fall_costs_room_points(self):
        roomy = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread())
        pinned = bps.score_candidate(
            a_tech(above_52w_low_pct=2.0, pct_of_52w_range=4.0, drawdown_pct=-55.0),
            LARGE_STOCK, a_spread(),
        )
        self.assertGreater(roomy["components"]["room"], pinned["components"]["room"])
        self.assertEqual(pinned["components"]["room"], 0.0)

    def test_better_reward_to_risk_scores_higher_on_structure(self):
        cheap = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(reward_risk=3.0))
        pricey = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(reward_risk=1.0))
        self.assertGreater(cheap["components"]["structure"], pricey["components"]["structure"])

    def test_an_unreachable_short_strike_scores_worse_than_a_reachable_one(self):
        reachable = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(required_move_sigma=0.9))
        moonshot = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(required_move_sigma=2.6))
        self.assertGreater(reachable["components"]["structure"], moonshot["components"]["structure"])
        self.assertIn("Short strike needs an outsized move", moonshot["flags"])

    def test_a_short_strike_that_is_already_nearly_there_also_scores_worse(self):
        """The band cuts both ways: a target one tick away is priced as done."""
        good = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(required_move_sigma=0.9))
        trivial = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(required_move_sigma=0.05))
        self.assertGreater(good["components"]["structure"], trivial["components"]["structure"])

    def test_paying_above_realized_vol_fair_value_is_flagged_and_costs_points(self):
        fair = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(edge_pct=20.0))
        rich = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(edge_pct=-12.0))
        self.assertGreater(fair["components"]["structure"], rich["components"]["structure"])
        self.assertIn("Priced above realized-vol fair value", rich["flags"])

    def test_rich_implied_vol_is_flagged_because_this_screen_is_the_buyer(self):
        """IV/RV above 1 is a *negative* here — the opposite of the two sellers."""
        rating = bps.score_candidate(a_tech(rv_30=0.20), LARGE_STOCK, a_spread(atm_iv=0.40))
        self.assertGreater(rating["iv_rv_ratio"], 1.25)
        self.assertIn("Implied vol rich — expensive to buy", rating["flags"])

    def test_steeper_skew_scores_higher_on_structure(self):
        flat = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(skew_ratio=1.0))
        steep = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(skew_ratio=1.3))
        self.assertGreater(steep["components"]["structure"], flat["components"]["structure"])

    def test_debit_over_half_the_width_is_flagged(self):
        rating = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(debit_pct_of_width=62.0))
        self.assertIn("Debit over half the width", rating["flags"])

    def test_relaxed_constraints_are_flagged(self):
        rating = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(constraints_relaxed=True))
        self.assertIn("No pair met the debit and reward filters", rating["flags"])

    def test_two_leg_slippage_costs_execution_points_and_is_flagged(self):
        tight = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(exec_cost_pct=6.0))
        wide = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(exec_cost_pct=35.0))
        self.assertGreater(tight["components"]["execution"], wide["components"]["execution"])
        self.assertIn("Leg slippage eats the edge", wide["flags"])

    def test_thin_open_interest_on_either_leg_is_flagged(self):
        rating = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread(open_interest_min=12))
        self.assertIn("Thin open interest on one leg", rating["flags"])

    def test_thin_share_liquidity_and_a_small_underlying_are_flagged(self):
        rating = bps.score_candidate(
            a_tech(avg_dollar_volume=2e6), {"market_cap": 400e6, "quote_type": "EQUITY"}, a_spread())
        self.assertIn("Thin share liquidity", rating["flags"])
        self.assertIn("Small underlying", rating["flags"])

    def test_earnings_inside_the_trade_docks_structure_and_flags(self):
        soon = (date.today() + timedelta(days=10)).isoformat()
        clear = bps.score_candidate(a_tech(), LARGE_STOCK, a_spread())
        inside = bps.score_candidate(
            a_tech(), {**LARGE_STOCK, "next_earnings": soon}, a_spread())
        self.assertTrue(inside["earnings_before_expiry"])
        self.assertIn("Earnings before expiration", inside["flags"])
        self.assertLess(inside["components"]["structure"], clear["components"]["structure"])

    def test_earnings_just_after_expiry_is_noted_not_penalised(self):
        just_after = (date.today() + timedelta(days=47)).isoformat()
        rating = bps.score_candidate(
            a_tech(), {**LARGE_STOCK, "next_earnings": just_after}, a_spread())
        self.assertFalse(rating["earnings_before_expiry"])
        self.assertTrue(any(f.startswith("Earnings ") and f.endswith("after expiry")
                            for f in rating["flags"]))

    def test_far_below_the_200_day_is_flagged(self):
        rating = bps.score_candidate(a_tech(sma_200=160.0), LARGE_STOCK, a_spread())
        self.assertIn("Far below the 200-day average", rating["flags"])

    def test_components_never_exceed_their_maximums(self):
        maxed = a_tech(rel_weakness_pct=99.0, rsi_roll_pp=-99.0, stretch_sigma=1.4,
                       above_52w_low_pct=999.0, pct_of_52w_range=100.0,
                       drawdown_pct=-8.0, days_below_sma50=1, rv_30=0.9)
        rating = bps.score_candidate(
            maxed, LARGE_STOCK,
            a_spread(reward_risk=99.0, edge_pct=999.0, required_move_sigma=0.9,
                     skew_ratio=9.0, exec_cost_pct=0.0, open_interest_min=99999),
        )
        for key, cap in rating["component_max"].items():
            self.assertLessEqual(rating["components"][key], cap, key)
        self.assertLessEqual(rating["score"], 100.0)

    def test_score_is_never_negative(self):
        soon = (date.today() + timedelta(days=3)).isoformat()
        rating = bps.score_candidate({"ticker": "X", "price": 10.0},
                                     {"next_earnings": soon}, a_spread(debit=0.01))
        self.assertGreaterEqual(rating["score"], 0.0)

    def test_an_empty_technical_payload_does_not_raise(self):
        rating = bps.score_candidate({}, {}, None)
        self.assertGreaterEqual(rating["score"], 0.0)


class PartialScoreTests(unittest.TestCase):
    """A score computed without a chain must not be comparable to a priced one."""

    def test_partial_denominator_matches_the_chain_dependent_points(self):
        rating = bps.score_candidate(a_tech(), LARGE_STOCK, None)
        self.assertTrue(rating["scored_on_partial"])
        self.assertIn("Option chain unavailable", rating["flags"])
        scorable = (rating["components"]["breakdown"] + rating["components"]["room"]
                    + rating["components"]["execution"])
        expected = scorable / bps.PARTIAL_MAX * 100.0
        # The reported components are each rounded to one decimal, so summing them
        # can differ from the internal total by a few hundredths of a point.
        self.assertAlmostEqual(rating["score"], expected, delta=0.4)

    def test_the_partial_budget_equals_one_hundred_minus_the_chain_points(self):
        self.assertEqual(bps.PARTIAL_MAX, 100.0 - bps.STRUCTURE_MAX - bps.EXECUTION_CHAIN_MAX)
        # Same budget as the covered call screen, so the grades stay comparable.
        self.assertEqual(bps.PARTIAL_MAX, 100.0 - cs.PREMIUM_MAX - cs.TERMS_CHAIN_MAX)

    def test_unpriced_row_can_outscore_a_priced_one_so_ranking_must_tier(self):
        strong_unpriced = bps.score_candidate(a_tech(rel_weakness_pct=14.0), LARGE_STOCK, None)
        weak_priced = bps.score_candidate(
            a_tech(rel_weakness_pct=1.0, rsi_roll_pp=-1.0, lower_high=False,
                   days_below_sma50=200, above_52w_low_pct=6.0, pct_of_52w_range=26.0),
            LARGE_STOCK,
            a_spread(reward_risk=1.0, edge_pct=-14.0, required_move_sigma=2.4,
                     skew_ratio=1.0, exec_cost_pct=38.0, open_interest_min=20),
        )
        self.assertGreater(strong_unpriced["score"], weak_priced["score"])

        rows = [
            {"ticker": "UNPRICED", "spread": None, "score": strong_unpriced["score"]},
            {"ticker": "PRICED", "spread": a_spread(), "score": weak_priced["score"]},
        ]
        rows.sort(key=lambda r: (0 if r.get("spread") else 1, -(r.get("score") or 0)))
        self.assertEqual([r["ticker"] for r in rows], ["PRICED", "UNPRICED"])


class CandidatePartitionTests(unittest.TestCase):
    def _row(self, ticker, score, spread=None, chain_status=None):
        return {
            "ticker": ticker,
            "score": score,
            "spread": spread,
            "chain_status": chain_status,
        }

    def test_primary_rows_require_a_fully_qualified_live_spread(self):
        rows = [
            self._row("GOOD", 72, {"constraints_relaxed": False}, "actionable"),
            self._row("RELAXED", 95, {"constraints_relaxed": True}, "constraints_relaxed"),
            self._row("EARNINGS", 97, {"constraints_relaxed": False}, "earnings"),
            self._row("NOCHAIN", 90, None, "unavailable"),
            self._row("UNPRICED", 88, None, "not_priced"),
        ]

        actionable, watchlist = bps._partition_candidate_rows(rows, 40)

        self.assertEqual([row["ticker"] for row in actionable], ["GOOD"])
        self.assertEqual(
            [row["ticker"] for row in watchlist],
            ["EARNINGS", "RELAXED", "NOCHAIN", "UNPRICED"],
        )

    def test_each_section_obeys_the_result_limit(self):
        rows = [
            self._row(f"A{i}", 100 - i, {"constraints_relaxed": False}, "actionable")
            for i in range(3)
        ] + [
            self._row(f"W{i}", 100 - i, None, "not_priced")
            for i in range(3)
        ]

        actionable, watchlist = bps._partition_candidate_rows(rows, 2)

        self.assertEqual([row["ticker"] for row in actionable], ["A0", "A1"])
        self.assertEqual([row["ticker"] for row in watchlist], ["W0", "W1"])


class PlanTests(unittest.TestCase):
    def test_no_spread_means_no_plan(self):
        self.assertIsNone(bps.recommend_plan(None, {"grade": "A", "score": 90}))

    def test_zero_debit_means_no_plan(self):
        self.assertIsNone(bps.recommend_plan(a_spread(debit=0.0), {"grade": "A", "score": 90}))

    def test_zero_max_profit_means_no_plan(self):
        self.assertIsNone(bps.recommend_plan(a_spread(max_profit=0.0), {"grade": "A", "score": 90}))

    def test_strong_setup_holds_for_three_quarters_of_the_payoff(self):
        plan = bps.recommend_plan(
            a_spread(reward_risk=2.4, edge_pct=18.0, exec_cost_pct=8.0, open_interest_min=1500),
            {"grade": "A", "score": 86, "flags": []},
        )
        self.assertEqual(plan["profile"], "Strong setup")
        self.assertEqual(plan["target_capture_pct"], 75.0)

    def test_balanced_setup_takes_sixty_five(self):
        plan = bps.recommend_plan(a_spread(reward_risk=1.7),
                                  {"grade": "B", "score": 73, "flags": []})
        self.assertEqual(plan["profile"], "Balanced setup")
        self.assertEqual(plan["target_capture_pct"], 65.0)

    def test_a_material_risk_flag_forces_the_defensive_plan(self):
        plan = bps.recommend_plan(
            a_spread(reward_risk=2.5, edge_pct=30.0, exec_cost_pct=6.0, open_interest_min=2000),
            {"grade": "A", "score": 92, "flags": ["Making fresh 52-week lows"]},
        )
        self.assertEqual(plan["profile"], "Defensive setup")
        self.assertEqual(plan["target_capture_pct"], 50.0)

    def test_a_perfectly_tight_market_is_not_read_as_the_worst_case(self):
        """`or 100.0` on a 0.0% cost would demote the best-quoted spread here."""
        plan = bps.recommend_plan(
            a_spread(reward_risk=2.4, edge_pct=18.0, exec_cost_pct=0.0, open_interest_min=1500),
            {"grade": "A", "score": 86, "flags": []},
        )
        self.assertEqual(plan["profile"], "Strong setup")

    def test_the_target_is_above_the_debit_and_below_the_width(self):
        plan = bps.recommend_plan(a_spread(), {"grade": "B", "score": 74, "flags": []})
        self.assertGreater(plan["target_price"], plan["entry_debit_basis"])
        self.assertLess(plan["target_price"], 10.0)

    def test_the_stop_is_below_the_debit_and_positive(self):
        plan = bps.recommend_plan(a_spread(), {"grade": "B", "score": 74, "flags": []})
        self.assertLess(plan["stop_price"], plan["entry_debit_basis"])
        self.assertGreater(plan["stop_price"], 0.0)

    def test_target_and_stop_dollars_reconcile_with_the_prices(self):
        plan = bps.recommend_plan(a_spread(), {"grade": "B", "score": 74, "flags": []})
        s = a_spread()
        self.assertAlmostEqual(
            plan["target_profit_dollars"],
            round((plan["target_price"] - s["debit"]) * 100.0, 0), delta=1.0)
        self.assertAlmostEqual(
            plan["stop_loss_dollars"],
            round((s["debit"] - plan["stop_price"]) * 100.0, 0), delta=1.0)

    def test_a_long_dated_spread_reassesses_at_twenty_one_dte(self):
        plan = bps.recommend_plan(a_spread(dte=60), {"grade": "B", "score": 74, "flags": []})
        self.assertEqual(plan["reassess_dte"], 21)

    def test_a_short_dated_spread_reassesses_at_half_its_life(self):
        plan = bps.recommend_plan(a_spread(dte=28), {"grade": "B", "score": 74, "flags": []})
        self.assertEqual(plan["reassess_dte"], 14)

    def test_the_invalidation_level_is_the_nearest_average_overhead(self):
        plan = bps.recommend_plan(a_spread(), {"grade": "B", "score": 74, "flags": []}, a_tech())
        self.assertEqual(plan["invalidate_price"], 103.0)      # the 20-day, not the 50
        self.assertIn("20-day", plan["invalidate_note"])

    def test_it_skips_an_average_that_is_already_below_price(self):
        tech = a_tech(sma_20=97.0)      # price 100 is back above the 20-day
        plan = bps.recommend_plan(a_spread(), {"grade": "B", "score": 74, "flags": []}, tech)
        self.assertEqual(plan["invalidate_price"], 107.0)      # falls through to the 50-day

    def test_no_technicals_still_yields_a_usable_note(self):
        plan = bps.recommend_plan(a_spread(), {"grade": "B", "score": 74, "flags": []})
        self.assertIsNone(plan["invalidate_price"])
        self.assertIn("moving averages", plan["invalidate_note"])


class VerdictTests(unittest.TestCase):
    def _row(self, tech_over=None, spread_over=None, fund=None):
        tech = a_tech(**(tech_over or {}))
        spread = a_spread(**(spread_over or {}))
        rating = bps.score_candidate(tech, fund or LARGE_STOCK, spread)
        spread["plan"] = bps.recommend_plan(spread, rating, tech)
        return {**tech, "spread": spread, **rating}

    def test_verdict_names_the_spread_the_risk_and_the_move_needed(self):
        text = bps.build_verdict(self._row())
        self.assertIn("$100/$90 put spread", text)
        self.assertIn("risk $340 to make $660", text)
        self.assertIn("needs a 10% fall", text)
        self.assertIn("below its 50-day", text)
        self.assertTrue(text.endswith("."))

    def test_fresh_lows_verdict_says_this_is_the_sellers_setup(self):
        text = bps.build_verdict(self._row(tech_over={"fresh_low": True}))
        self.assertIn("put sellers get paid", text)

    def test_oversold_verdict_warns_about_the_bounce(self):
        text = bps.build_verdict(self._row(tech_over={"rsi_14": 22.0}))
        self.assertIn("as likely to be the bounce", text)

    def test_expensive_debit_verdict_says_so(self):
        text = bps.build_verdict(self._row(spread_over={"edge_pct": -20.0}))
        self.assertIn("above what this name", text)

    def test_fund_verdict_names_the_fund_kind(self):
        row = self._row(tech_over={"ticker": "XLE"},
                        fund={"quote_type": "ETF", "total_assets": 40e9})
        self.assertIn("Sector fund", bps.build_verdict(row))

    def test_verdict_survives_a_row_with_no_chain(self):
        tech = a_tech()
        rating = bps.score_candidate(tech, LARGE_STOCK, None)
        text = bps.build_verdict({**tech, "spread": None, **rating})
        self.assertTrue(text.endswith("."))

    def test_verdict_mentions_a_dodged_earnings_report(self):
        soon = (date.today() + timedelta(days=60)).isoformat()
        row = self._row(spread_over={
            "avoids_earnings": True, "days_earnings_after_expiry": 15, "earnings_date": soon,
        })
        self.assertIn("15d before", bps.build_verdict(row))


class RoundingTests(unittest.TestCase):
    def test_legs_are_rounded_without_being_dropped(self):
        out = bps._round_spread(a_spread())
        self.assertEqual(out["long_leg"]["strike"], 100.0)
        self.assertEqual(out["short_leg"]["strike"], 90.0)
        self.assertIsNotNone(out["long_leg"]["delta"])
        self.assertEqual(out["debit"], 3.4)

    def test_none_stays_none(self):
        self.assertIsNone(bps._round_spread(None))

    def test_every_reported_number_survives_json_rounding(self):
        out = bps._round_spread(a_spread())
        for key in ("reward_risk", "breakeven", "required_move_sigma", "edge_pct",
                    "skew_ratio", "exec_cost_pct", "max_profit_dollars"):
            self.assertIsNotNone(out[key], key)


class UniverseTests(unittest.TestCase):
    def test_nothing_enabled_resolves_to_nothing(self):
        self.assertEqual(
            bps.resolve_scan_universe({
                "include_stocks": False, "include_index_etfs": False,
                "include_sector_etfs": False,
            }),
            [],
        )

    def test_index_only_skips_the_stock_universe(self):
        tickers = bps.resolve_scan_universe({
            "include_stocks": False, "include_index_etfs": True, "include_sector_etfs": False,
        })
        self.assertIn("SPY", tickers)
        self.assertNotIn("XLK", tickers)

    def test_custom_list_is_cleaned_and_deduped(self):
        tickers = bps.resolve_scan_universe({
            "include_stocks": True, "universe": "custom",
            "custom_tickers": ["aapl", "AAPL", " msft ", "", None],
        })
        self.assertEqual(tickers, ["AAPL", "MSFT"])

    def test_small_cap_choices_are_additive_to_the_shared_ones(self):
        for key in ("small_cap", "large_mid_small", "mid_small"):
            self.assertIn(key, bps.SPREAD_UNIVERSE_CHOICES)
            self.assertNotIn(key, ps.UNIVERSE_CHOICES)
        for key in ps.UNIVERSE_CHOICES:
            self.assertIn(key, bps.SPREAD_UNIVERSE_CHOICES)

    def test_a_shared_universe_still_routes_through_the_put_resolver(self):
        self.assertEqual(bps.resolve_spread_universe("large_cap", None),
                         ps.resolve_universe("large_cap", None))

    def test_small_cap_universe_resolves(self):
        tickers = bps.resolve_spread_universe("small_cap", None)
        self.assertGreater(len(tickers), 100)
        self.assertIn("SRPT", tickers)


class DefaultsTests(unittest.TestCase):
    def test_the_rsi_gate_is_a_band_not_a_ceiling(self):
        """The clearest structural difference from both selling screens."""
        self.assertGreater(bps.DEFAULTS["min_rsi"], 0.0)
        self.assertLess(bps.DEFAULTS["max_rsi"], 100.0)
        self.assertLess(bps.DEFAULTS["min_rsi"], bps.DEFAULTS["max_rsi"])

    def test_the_stretch_gate_is_a_band_too(self):
        self.assertLess(bps.DEFAULTS["min_stretch_sigma"], bps.DEFAULTS["max_stretch_sigma"])
        # Crash-chasing is excluded by default: this is not the put screen inverted.
        self.assertLessEqual(bps.DEFAULTS["max_stretch_sigma"], 3.0)

    def test_fresh_lows_are_excluded_by_default(self):
        self.assertTrue(bps.DEFAULTS["exclude_fresh_lows"])

    def test_broken_trend_structure_is_required_by_default(self):
        self.assertTrue(bps.DEFAULTS["require_below_sma50"])

    def test_it_buys_more_time_than_the_selling_screens(self):
        """A debit spread needs the move to actually happen."""
        self.assertGreater(bps.DEFAULTS["target_dte"], ps.DEFAULTS["target_dte"])
        self.assertGreater(bps.DEFAULTS["target_dte"], cs.DEFAULTS["target_dte"])

    def test_the_expiration_window_does_not_cap_the_target_dte(self):
        """Target DTE is user-controlled, so the implicit window must not clip it.

        Same bounds as the other two screens, so a weekly and a LEAP are both
        reachable on all three.
        """
        self.assertEqual(bps.DEFAULTS["min_dte"], bps.MIN_TARGET_DTE)
        self.assertEqual(bps.DEFAULTS["max_dte"], bps.MAX_TARGET_DTE)
        self.assertEqual(bps.DEFAULTS["min_dte"], ps.DEFAULTS["min_dte"])
        self.assertEqual(bps.DEFAULTS["max_dte"], ps.DEFAULTS["max_dte"])
        self.assertLessEqual(bps.MIN_TARGET_DTE, 1)
        self.assertGreaterEqual(bps.MAX_TARGET_DTE, 730)
        # The default target sits well inside the window, so it is never clamped.
        self.assertGreater(bps.DEFAULTS["target_dte"], bps.DEFAULTS["min_dte"])
        self.assertLess(bps.DEFAULTS["target_dte"], bps.DEFAULTS["max_dte"])

    def test_the_long_leg_is_nearer_the_money_than_the_short_leg(self):
        self.assertGreater(bps.DEFAULTS["long_delta"], bps.DEFAULTS["short_delta"])

    def test_the_debit_ceiling_keeps_reward_to_risk_near_or_above_one(self):
        implied_rr = (100.0 - bps.DEFAULTS["max_debit_pct_of_width"]) / bps.DEFAULTS["max_debit_pct_of_width"]
        self.assertGreaterEqual(implied_rr, 0.8)

    def test_liquidity_floor_is_stricter_than_the_single_leg_screens(self):
        """Two legs to cross, so the share-liquidity proxy has to be tighter."""
        self.assertGreaterEqual(bps.DEFAULTS["min_avg_dollar_volume"],
                                cs.DEFAULTS["min_avg_dollar_volume"])


class PutScannerRegressionTests(unittest.TestCase):
    """Bugs found in put_scanner while building this screen."""

    def test_short_duration_bond_funds_are_not_leveraged(self):
        for ticker, name, category in (
            ("SHY", "iShares 1-3 Year Treasury Bond ETF", "Short Government"),
            ("BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF", "Ultrashort Bond"),
            ("JPST", "JPMorgan Ultra-Short Income ETF", "Ultrashort Bond"),
            ("ICSH", "iShares Ultra Short-Term Bond ETF", "Ultrashort Bond"),
        ):
            kind = ps._fund_kind(ticker, {"name": name, "category": category, "quote_type": "ETF"})
            self.assertNotEqual(kind, "leveraged", f"{ticker} misread as leveraged")

    def test_real_leveraged_and_inverse_funds_are_still_caught(self):
        for name, category in (
            ("ProShares UltraPro QQQ", "Trading--Leveraged Equity"),
            ("ProShares UltraShort S&P500", "Trading--Inverse Equity"),
            ("ProShares Ultra S&P500", "Trading--Leveraged Equity"),
            ("ProShares Short S&P500", "Trading--Inverse Equity"),
            ("Direxion Daily S&P 500 Bull 3X Shares", "Trading--Leveraged Equity"),
            ("Direxion Daily Semiconductor Bear 3X Shares", "Trading--Inverse Equity"),
            ("GraniteShares 2x Long NVDA Daily ETF", "Trading--Leveraged Equity"),
        ):
            kind = ps._fund_kind("ZZZZ", {"name": name, "category": category, "quote_type": "ETF"})
            self.assertEqual(kind, "leveraged", f"{name} not caught")

    def test_a_crossed_or_one_sided_quote_has_no_spread_rather_than_a_negative_one(self):
        self.assertIsNone(ps._quoted_spread_pct(5.0, 4.5, 4.75))   # crossed
        self.assertIsNone(ps._quoted_spread_pct(4.7, 0.0, 4.7))    # no ask
        self.assertIsNone(ps._quoted_spread_pct(0.0, 4.9, 4.9))    # no bid
        self.assertAlmostEqual(ps._quoted_spread_pct(4.7, 4.9, 4.8), 0.2 / 4.8 * 100.0)

    def test_a_zero_spread_is_not_demoted_to_the_worst_case(self):
        base = {
            "mid": 2.05, "prob_otm": 80.0, "delta": -0.20, "dte": 35,
            "open_interest": 900,
        }
        tight = ps.recommend_buyback({**base, "spread_pct": 0.0},
                                     {"grade": "A", "score": 85, "flags": []})
        self.assertEqual(tight["profile"], "Strong setup")
        # A genuinely unknown spread still has to fall short of the top profile.
        unknown = ps.recommend_buyback({**base, "spread_pct": None},
                                       {"grade": "A", "score": 85, "flags": []})
        self.assertNotEqual(unknown["profile"], "Strong setup")

    def test_the_partial_denominator_is_derived_not_hardcoded(self):
        self.assertEqual(ps.PREMIUM_MAX, 25.0)
        rating = ps.score_candidate(
            {"ticker": "T", "price": 100.0, "stretch_sigma": 2.0, "drawdown_pct": -20.0,
             "avg_dollar_volume": 300e6}, {"market_cap": 100e9, "quote_type": "EQUITY"}, None)
        scorable = sum(v for k, v in rating["components"].items() if k != "premium")
        self.assertAlmostEqual(
            rating["score"], round(scorable / (100.0 - ps.PREMIUM_MAX) * 100.0, 1), places=1)

    def test_an_etf_holding_is_not_gated_on_the_stock_drop_floor(self):
        """A non-curated ETF (a holding, a watchlist name) used to be measured
        against the stock floors at the price stage and silently dropped."""
        # JEPI is a real portfolio holding and appears in neither curated list.
        self.assertNotIn("JEPI", ps.CURATED_STOCK_SET)
        self.assertNotIn("JEPI", ps.INDEX_ETF_SET | ps.SECTOR_ETF_SET)
        # The provisional floor an unknown ticker faces is the looser of the two.
        self.assertEqual(min(ps.DEFAULTS["min_drop_pct"], ps.DEFAULTS["fund_min_drop_pct"]),
                         ps.DEFAULTS["fund_min_drop_pct"])

    def test_curated_stock_set_covers_both_stock_tiers_and_no_funds(self):
        self.assertIn("AAPL", ps.CURATED_STOCK_SET)
        self.assertIn("ZION", ps.CURATED_STOCK_SET)
        self.assertEqual(ps.CURATED_STOCK_SET & (ps.INDEX_ETF_SET | ps.SECTOR_ETF_SET), set())


class CallScannerRegressionTests(unittest.TestCase):
    def test_a_zero_spread_is_not_demoted_to_the_worst_case(self):
        base = {"mid": 2.05, "prob_keep_shares": 78.0, "delta": 0.22, "dte": 35,
                "open_interest": 900}
        tight = cs.recommend_management({**base, "spread_pct": 0.0},
                                        {"grade": "A", "score": 85, "flags": []})
        self.assertEqual(tight["profile"], "Strong setup")

    def test_weekly_payers_project_a_week_out_not_a_month(self):
        last = (date.today() - timedelta(days=3)).isoformat()
        iso, estimated = cs.next_ex_dividend({
            "last_dividend_date": last, "last_dividend_value": 0.20, "dividend_rate": 10.40,
        })
        self.assertTrue(estimated)
        self.assertAlmostEqual((date.fromisoformat(iso) - date.fromisoformat(last)).days,
                               7, delta=1)


if __name__ == "__main__":
    unittest.main()
