"""Pure-math tests for the covered call scanner. No network access."""

import math
import os
import sys
import unittest
from datetime import date, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import call_scanner as cs
import put_scanner as ps


def synthetic_frame(daily_sigma=0.012, drift=0.0, days=300, run_pct=None,
                    run_days=21, seed=7):
    """Build a deterministic OHLCV frame, optionally with a late advance."""
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, daily_sigma, days)
    if run_pct is not None:
        # Replace the tail with an even advance of the requested size.
        per_day = math.log(1.0 + run_pct / 100.0) / run_days
        rets[-run_days:] = per_day
    close = 100.0 * np.exp(np.cumsum(rets))
    index = pd.bdate_range(end=date.today(), periods=days)
    return pd.DataFrame({
        "Open": close * 0.999,
        "High": close * 1.008,
        "Low": close * 0.992,
        "Close": close,
        "Volume": np.full(days, 3_000_000.0),
    }, index=index)


def a_call(**over):
    """A liquid, well-behaved OTM call to vary one field at a time."""
    base = {
        "strike": 110.0, "bid": 2.0, "ask": 2.1, "mid": 2.05, "iv": 0.30,
        "atm_iv": 0.30, "delta": 0.25, "prob_keep_shares": 75.0,
        "open_interest": 1200, "volume": 300, "spread_pct": 5.0,
        "premium_yield_pct": 2.05, "annualized_pct": 21.4, "if_called_pct": 12.05,
        "if_called_annualized_pct": 125.6, "otm_pct": 10.0, "dte": 35,
        "expiration": (date.today() + timedelta(days=35)).isoformat(),
        "ex_dividend_inside": False, "early_assignment": {"level": "none"},
        "below_basis": False,
    }
    base.update(over)
    return base


def a_tech(**over):
    """An extended-but-cooling name: the shape the screen is looking for."""
    base = {
        "ticker": "TEST", "price": 100.0, "run_pct": 12.0, "stretch_sigma": 2.0,
        "pct_of_52w_range": 88.0, "atr_above_sma50": 2.0, "excess_run_pct": 8.0,
        "rsi_14": 68.0, "rv_30": 0.24, "rv_252": 0.26, "fresh_high": False,
        "pullback_from_high_pct": 2.5, "accel_pp": -3.0, "below_52w_high_pct": 5.0,
        "avg_dollar_volume": 400e6, "sma_200": 85.0,
    }
    base.update(over)
    return base


LARGE_STOCK = {"market_cap": 120e9, "quote_type": "EQUITY"}


class WindowStretchSharingTests(unittest.TestCase):
    """The stretch primitive is shared with the put screen, not re-derived."""

    def test_call_scanner_uses_the_shared_helper(self):
        self.assertIs(cs.window_stretch, ps.window_stretch)

    def test_run_reads_positive_and_drop_reads_negative(self):
        sub = synthetic_frame(daily_sigma=0.008, run_pct=20.0, run_days=21)
        tech = cs._compute_technicals(sub, None, 21)
        self.assertIsNotNone(tech)
        self.assertGreater(tech["stretch_sigma"], 3.0)
        self.assertGreater(tech["run_pct"], 15.0)

        # The same frame read by the put screen is a large *negative* stretch.
        put_tech = ps._compute_technicals(sub, None, 21)
        self.assertAlmostEqual(tech["stretch_sigma"], -put_tech["stretch_sigma"], places=6)

    def test_baseline_vol_still_excludes_the_run_window(self):
        """A quiet name that then rips must read as a big stretch, not ~1σ."""
        sub = synthetic_frame(daily_sigma=0.006, run_pct=18.0, run_days=21)
        tech = cs._compute_technicals(sub, None, 21)
        self.assertGreater(tech["stretch_sigma"], 4.0)

    def test_volatile_name_with_the_same_run_is_less_unusual(self):
        quiet = cs._compute_technicals(synthetic_frame(daily_sigma=0.008, run_pct=20.0), None, 21)
        noisy = cs._compute_technicals(synthetic_frame(daily_sigma=0.035, run_pct=20.0), None, 21)
        self.assertGreater(quiet["stretch_sigma"], noisy["stretch_sigma"])


class TargetDteTests(unittest.TestCase):
    def _exp(self, days):
        return (date.today() + timedelta(days=days)).isoformat()

    def test_default_window_does_not_cap_a_long_dated_target(self):
        """Covered-call UI targets beyond 70 DTE must reach later chains."""
        exps = [self._exp(35), self._exp(63), self._exp(124)]
        chosen, dte, _ = ps._pick_expiration(
            exps,
            120,
            cs.DEFAULTS["min_dte"],
            cs.DEFAULTS["max_dte"],
        )
        self.assertEqual(chosen, self._exp(124))
        self.assertEqual(dte, 124)


class TechnicalTests(unittest.TestCase):
    def test_thin_history_returns_none(self):
        self.assertIsNone(cs._compute_technicals(synthetic_frame(days=40), None, 21))

    def test_run_into_the_close_sets_fresh_high(self):
        # Needs an uptrending walk: a flat random walk can end far below its own
        # 52-week high even after a 25% run, which is not a fresh-high frame.
        sub = synthetic_frame(daily_sigma=0.01, drift=0.0012, run_pct=25.0, run_days=21)
        tech = cs._compute_technicals(sub, None, 21)
        self.assertTrue(tech["fresh_high"])
        self.assertGreater(tech["pct_of_52w_range"], 95.0)

    def test_pullback_after_the_run_clears_fresh_high(self):
        sub = synthetic_frame(daily_sigma=0.01, drift=0.0012, run_pct=25.0, run_days=21)
        # Fade the last three sessions ~4% off the peak.
        sub = sub.copy()
        peak = float(sub["Close"].iloc[-4])
        for i, mult in enumerate((0.985, 0.972, 0.962)):
            sub.iloc[-3 + i, sub.columns.get_loc("Close")] = peak * mult
        tech = cs._compute_technicals(sub, None, 21)
        self.assertFalse(tech["fresh_high"])
        self.assertGreater(tech["pullback_from_high_pct"], 2.0)
        self.assertGreater(tech["below_52w_high_pct"], 2.0)

    def test_range_position_is_low_for_a_mid_range_name(self):
        sub = synthetic_frame(daily_sigma=0.02, days=300, seed=3)
        tech = cs._compute_technicals(sub, None, 21)
        self.assertIsNotNone(tech["pct_of_52w_range"])
        self.assertLessEqual(tech["pct_of_52w_range"], 100.0)
        self.assertGreaterEqual(tech["pct_of_52w_range"], 0.0)

    def test_atr_above_sma50_is_positive_when_extended(self):
        sub = synthetic_frame(daily_sigma=0.008, run_pct=20.0, run_days=21)
        tech = cs._compute_technicals(sub, None, 21)
        self.assertGreater(tech["atr_above_sma50"], 1.0)

    def test_accel_is_negative_when_the_advance_cools(self):
        sub = synthetic_frame(daily_sigma=0.005, days=300, seed=11)
        sub = sub.copy()
        closes = sub["Close"].values.copy()
        base = closes[-11]
        # Prior five sessions +6%, last five flat: a decelerating advance.
        for i in range(5):
            closes[-10 + i] = base * (1 + 0.012 * (i + 1))
        for i in range(5):
            closes[-5 + i] = closes[-6]
        sub["Close"] = closes
        tech = cs._compute_technicals(sub, None, 21)
        self.assertLess(tech["accel_pp"], 0.0)

    def test_excess_run_strips_out_market_beta(self):
        """A name that only rose with the market is not specially extended."""
        sub = synthetic_frame(daily_sigma=0.01, run_pct=15.0, run_days=21, seed=5)
        bench_close = sub["Close"] * 1.0
        bench_ret = np.log(bench_close / bench_close.shift(1)).dropna()
        tech = cs._compute_technicals(sub, bench_ret, 21)
        # Perfectly correlated with beta ~1, so almost nothing is unexplained.
        self.assertLess(abs(tech["excess_run_pct"]), 2.0)


class DividendTests(unittest.TestCase):
    def test_future_reported_ex_date_is_used_as_declared(self):
        future = (date.today() + timedelta(days=20)).isoformat()
        iso, estimated = cs.next_ex_dividend({"ex_dividend_date": future})
        self.assertEqual(iso, future)
        self.assertFalse(estimated)

    def test_past_ex_date_is_projected_forward_and_marked_estimated(self):
        """Yahoo reports the *last* ex-date until the next one is declared."""
        last = (date.today() - timedelta(days=30)).isoformat()
        iso, estimated = cs.next_ex_dividend({
            "ex_dividend_date": last, "last_dividend_date": last,
            "last_dividend_value": 0.27, "dividend_rate": 1.08,
        })
        self.assertTrue(estimated)
        projected = date.fromisoformat(iso)
        self.assertGreaterEqual(projected, date.today())
        # 1.08 / 0.27 = 4 payments a year, so roughly a quarter after the last.
        self.assertAlmostEqual((projected - date.fromisoformat(last)).days, 91, delta=2)

    def test_monthly_payer_projects_a_month_out(self):
        last = (date.today() - timedelta(days=10)).isoformat()
        iso, estimated = cs.next_ex_dividend({
            "last_dividend_date": last, "last_dividend_value": 0.10,
            "dividend_rate": 1.20,
        })
        self.assertTrue(estimated)
        self.assertAlmostEqual((date.fromisoformat(iso) - date.fromisoformat(last)).days, 30, delta=2)

    def test_stale_date_rolls_forward_past_today(self):
        last = (date.today() - timedelta(days=400)).isoformat()
        iso, _ = cs.next_ex_dividend({
            "last_dividend_date": last, "last_dividend_value": 0.5, "dividend_rate": 2.0,
        })
        self.assertGreaterEqual(date.fromisoformat(iso), date.today())

    def test_non_payer_has_no_ex_date(self):
        self.assertEqual(cs.next_ex_dividend({}), (None, False))

    def test_per_payment_amount_prefers_the_reported_value(self):
        self.assertEqual(cs.expected_dividend_amount({"last_dividend_value": 0.53}, 88.0), 0.53)

    def test_fund_amount_falls_back_to_quarterly_off_the_annual_rate(self):
        # Funds report no per-payment figure; SPY-style annual rate over four.
        self.assertAlmostEqual(
            cs.expected_dividend_amount({"trailing_annual_dividend_rate": 5.662}, 560.0),
            5.662 / 4.0,
        )

    def test_no_dividend_data_returns_none(self):
        self.assertIsNone(cs.expected_dividend_amount({}, 100.0))


class EarlyAssignmentTests(unittest.TestCase):
    def test_no_ex_date_inside_the_trade_is_no_risk(self):
        r = cs.assess_early_assignment(2.05, 100.0, 110.0, 0.90, False)
        self.assertEqual(r["level"], "none")

    def test_small_dividend_against_a_fat_premium_is_low_risk(self):
        r = cs.assess_early_assignment(2.05, 100.0, 110.0, 0.20, True)
        self.assertEqual(r["level"], "low")

    def test_dividend_near_half_the_premium_is_elevated(self):
        r = cs.assess_early_assignment(2.00, 100.0, 110.0, 1.10, True)
        self.assertEqual(r["level"], "elevated")

    def test_dividend_exceeding_the_premium_is_high(self):
        r = cs.assess_early_assignment(0.80, 100.0, 110.0, 0.95, True)
        self.assertEqual(r["level"], "high")

    def test_itm_call_with_little_extrinsic_left_is_high(self):
        """The real early-exercise case: extrinsic worth less than the dividend."""
        r = cs.assess_early_assignment(mid=5.20, spot=105.0, strike=100.0,
                                       dividend=0.60, ex_div_inside=True)
        self.assertEqual(r["extrinsic"], 0.2)
        self.assertEqual(r["level"], "high")

    def test_zero_premium_is_not_a_division_error(self):
        r = cs.assess_early_assignment(0.0, 100.0, 110.0, 0.5, True)
        self.assertEqual(r["level"], "none")


class ScoringTests(unittest.TestCase):
    def test_component_maxima_add_to_one_hundred(self):
        rating = cs.score_candidate(a_tech(), LARGE_STOCK, a_call())
        self.assertFalse(rating["scored_on_partial"])
        self.assertEqual(sum(rating["component_max"].values()), 100)

    def test_a_solid_but_ordinary_setup_lands_mid_scale(self):
        """Calibrated to match the put screen, which rates its equivalent ~60.

        The two screens sit next to each other, so a C has to mean the same
        thing on both: a workable setup, with A and B held back for genuinely
        extreme dislocations rather than handed out for a decent one.
        """
        rating = cs.score_candidate(a_tech(), LARGE_STOCK, a_call())
        self.assertIn(rating["grade"], ("C", "B"))
        self.assertGreater(rating["score"], 55.0)
        self.assertLess(rating["score"], 78.0)

    def test_an_exceptional_setup_reaches_the_top_grades(self):
        """The other end of the scale: A/B must be reachable, or the screen
        can never actually recommend anything."""
        rating = cs.score_candidate(
            a_tech(stretch_sigma=2.9, pct_of_52w_range=96.0, atr_above_sma50=2.9,
                   excess_run_pct=14.0, rv_30=0.20, pullback_from_high_pct=3.6,
                   accel_pp=-7.0, below_52w_high_pct=9.0),
            LARGE_STOCK,
            a_call(atm_iv=0.31, annualized_pct=29.0, if_called_annualized_pct=200.0,
                   otm_pct=11.0),
        )
        self.assertIn(rating["grade"], ("A", "B"))
        self.assertGreater(rating["score"], 80.0)

    def test_fresh_high_loses_the_stall_points_and_is_flagged(self):
        cool = cs.score_candidate(a_tech(), LARGE_STOCK, a_call())
        hot = cs.score_candidate(a_tech(fresh_high=True), LARGE_STOCK, a_call())
        self.assertLess(hot["components"]["stall"], cool["components"]["stall"])
        self.assertIn("Making fresh 52-week highs", hot["flags"])

    def test_accelerating_advance_is_flagged(self):
        rating = cs.score_candidate(a_tech(accel_pp=9.0), LARGE_STOCK, a_call())
        self.assertIn("Advance still accelerating", rating["flags"])

    def test_more_stretch_scores_higher_on_overextension(self):
        low = cs.score_candidate(a_tech(stretch_sigma=1.0), LARGE_STOCK, a_call())
        high = cs.score_candidate(a_tech(stretch_sigma=3.0), LARGE_STOCK, a_call())
        self.assertGreater(high["components"]["overextension"], low["components"]["overextension"])

    def test_rich_iv_scores_higher_on_premium(self):
        cheap = cs.score_candidate(a_tech(rv_30=0.40), LARGE_STOCK, a_call(atm_iv=0.30))
        rich = cs.score_candidate(a_tech(rv_30=0.20), LARGE_STOCK, a_call(atm_iv=0.34))
        self.assertGreater(rich["components"]["premium"], cheap["components"]["premium"])
        self.assertGreater(rich["iv_rv_ratio"], 1.0)

    def test_more_upside_room_scores_higher_on_terms(self):
        tight = cs.score_candidate(a_tech(), LARGE_STOCK, a_call(otm_pct=2.0))
        roomy = cs.score_candidate(a_tech(), LARGE_STOCK, a_call(otm_pct=12.0))
        self.assertGreater(roomy["components"]["terms"], tight["components"]["terms"])

    def test_wide_spread_and_thin_oi_are_flagged(self):
        rating = cs.score_candidate(a_tech(), LARGE_STOCK, a_call(spread_pct=40.0, open_interest=10))
        self.assertIn("Wide bid/ask spread", rating["flags"])
        self.assertIn("Thin open interest", rating["flags"])

    def test_strike_below_cost_basis_is_flagged(self):
        rating = cs.score_candidate(a_tech(), LARGE_STOCK, a_call(below_basis=True))
        self.assertIn("Strike below your cost basis", rating["flags"])

    def test_high_early_assignment_risk_costs_terms_points(self):
        safe = cs.score_candidate(a_tech(), LARGE_STOCK, a_call())
        risky = cs.score_candidate(
            a_tech(), LARGE_STOCK,
            a_call(ex_dividend_inside=True, early_assignment={"level": "high"}),
        )
        self.assertLess(risky["components"]["terms"], safe["components"]["terms"])
        self.assertIn("Dividend exceeds option premium — likely early assignment", risky["flags"])

    def test_earnings_inside_the_trade_docks_premium_and_flags(self):
        soon = (date.today() + timedelta(days=10)).isoformat()
        rating = cs.score_candidate(a_tech(), {**LARGE_STOCK, "next_earnings": soon}, a_call())
        self.assertTrue(rating["earnings_before_expiry"])
        self.assertIn("Earnings before expiration", rating["flags"])

    def test_earnings_just_after_expiry_is_noted_not_penalised(self):
        just_after = (date.today() + timedelta(days=37)).isoformat()
        rating = cs.score_candidate(a_tech(), {**LARGE_STOCK, "next_earnings": just_after}, a_call())
        self.assertFalse(rating["earnings_before_expiry"])
        self.assertTrue(any(f.startswith("Earnings ") and f.endswith("after expiry")
                            for f in rating["flags"]))

    def test_far_above_the_200_day_is_flagged(self):
        rating = cs.score_candidate(a_tech(sma_200=60.0), LARGE_STOCK, a_call())
        self.assertIn("Far above the 200-day average", rating["flags"])

    def test_components_never_exceed_their_maximums(self):
        maxed = a_tech(stretch_sigma=9.0, pct_of_52w_range=100.0, atr_above_sma50=9.0,
                       excess_run_pct=99.0, pullback_from_high_pct=99.0,
                       accel_pp=-99.0, below_52w_high_pct=99.0, rv_30=0.05)
        rating = cs.score_candidate(maxed, LARGE_STOCK,
                                    a_call(atm_iv=0.9, annualized_pct=99.0,
                                           if_called_annualized_pct=999.0, otm_pct=99.0))
        for key, cap in rating["component_max"].items():
            self.assertLessEqual(rating["components"][key], cap, key)
        self.assertLessEqual(rating["score"], 100.0)

    def test_score_is_never_negative(self):
        soon = (date.today() + timedelta(days=5)).isoformat()
        empty = {"ticker": "X", "price": 10.0}
        rating = cs.score_candidate(empty, {"next_earnings": soon}, a_call(mid=0.01))
        self.assertGreaterEqual(rating["score"], 0.0)


class PartialScoreTests(unittest.TestCase):
    """A score computed without a chain must not be comparable to a priced one."""

    def test_partial_denominator_matches_the_chain_dependent_points(self):
        rating = cs.score_candidate(a_tech(), LARGE_STOCK, None)
        self.assertTrue(rating["scored_on_partial"])
        self.assertIn("Option chain unavailable", rating["flags"])
        # 100 - premium(25) - the chain-dependent slice of Trade terms(17)
        scorable = rating["components"]["overextension"] + rating["components"]["stall"] \
            + rating["components"]["terms"]
        expected = scorable / (100.0 - cs.PREMIUM_MAX - cs.TERMS_CHAIN_MAX) * 100.0
        self.assertAlmostEqual(rating["score"], round(expected, 1), places=1)

    def test_unpriced_row_can_outscore_a_priced_one_so_ranking_must_tier(self):
        """The smaller denominator inflates the number — the reason for the tier."""
        strong_unpriced = cs.score_candidate(a_tech(), LARGE_STOCK, None)
        weak_priced = cs.score_candidate(
            a_tech(stretch_sigma=1.1, pct_of_52w_range=66.0, atr_above_sma50=0.6,
                   excess_run_pct=2.5, rv_30=0.45),
            LARGE_STOCK, a_call(atm_iv=0.26, annualized_pct=9.0, otm_pct=2.5),
        )
        self.assertGreater(strong_unpriced["score"], weak_priced["score"])

        # ...so the sort key used by run_call_scan puts the priced one first.
        rows = [
            {"ticker": "UNPRICED", "call": None, "score": strong_unpriced["score"]},
            {"ticker": "PRICED", "call": a_call(), "score": weak_priced["score"]},
        ]
        rows.sort(key=lambda r: (0 if r.get("call") else 1, -(r.get("score") or 0)))
        self.assertEqual([r["ticker"] for r in rows], ["PRICED", "UNPRICED"])


class ManagementTests(unittest.TestCase):
    def test_no_call_means_no_plan(self):
        self.assertIsNone(cs.recommend_management(None, {"grade": "A", "score": 90}))

    def test_zero_credit_means_no_plan(self):
        self.assertIsNone(cs.recommend_management(a_call(mid=0.0), {"grade": "A", "score": 90}))

    def test_strong_setup_targets_seventy_percent(self):
        plan = cs.recommend_management(a_call(delta=0.24, prob_keep_shares=76.0),
                                       {"grade": "A", "score": 85, "flags": []})
        self.assertEqual(plan["profile"], "Strong setup")
        self.assertAlmostEqual(plan["profit_capture_pct"], 70.0, delta=1.5)

    def test_balanced_setup_targets_sixty_five(self):
        plan = cs.recommend_management(a_call(delta=0.32, prob_keep_shares=71.0),
                                       {"grade": "B", "score": 74, "flags": []})
        self.assertEqual(plan["profile"], "Balanced setup")
        self.assertAlmostEqual(plan["profit_capture_pct"], 65.0, delta=1.5)

    def test_a_material_risk_flag_forces_the_defensive_target(self):
        plan = cs.recommend_management(
            a_call(), {"grade": "A", "score": 90, "flags": ["Making fresh 52-week highs"]},
        )
        self.assertEqual(plan["profile"], "Defensive setup")
        self.assertAlmostEqual(plan["profit_capture_pct"], 60.0, delta=1.5)

    def test_target_is_below_the_entry_credit(self):
        plan = cs.recommend_management(a_call(), {"grade": "A", "score": 85, "flags": []})
        self.assertLess(plan["target_price"], plan["entry_credit_basis"])
        self.assertGreater(plan["target_price"], 0.0)

    def test_defend_price_is_the_strike(self):
        plan = cs.recommend_management(a_call(strike=110.0), {"grade": "B", "score": 72, "flags": []})
        self.assertEqual(plan["defend_price"], 110.0)

    def test_dividend_risk_changes_the_defence_note(self):
        plan = cs.recommend_management(
            a_call(ex_dividend_inside=True, early_assignment={"level": "high"}),
            {"grade": "C", "score": 65, "flags": []},
        )
        self.assertIn("ex-dividend", plan["defend_note"])

    def test_penny_credit_still_yields_a_positive_target(self):
        plan = cs.recommend_management(a_call(mid=0.02), {"grade": "F", "score": 20, "flags": []})
        self.assertGreaterEqual(plan["target_price"], 0.01)


class VerdictTests(unittest.TestCase):
    def _row(self, tech_over=None, call_over=None, fund=None):
        tech = a_tech(**(tech_over or {}))
        call = a_call(**(call_over or {}))
        rating = cs.score_candidate(tech, fund or LARGE_STOCK, call)
        row = {**tech, "call": call, **rating}
        call["management"] = cs.recommend_management(call, rating)
        return row

    def test_verdict_names_the_contract_and_both_returns(self):
        row = self._row()
        text = cs.build_verdict(row)
        self.assertIn("$110 call", text)
        self.assertIn("annualized on the shares", text)
        self.assertIn("if called away", text)
        self.assertTrue(text.endswith("."))

    def test_fresh_high_verdict_warns_about_capping_the_move(self):
        row = self._row(tech_over={"fresh_high": True})
        self.assertIn("caps the move you own it for", cs.build_verdict(row))

    def test_below_basis_verdict_says_it_would_realize_a_loss(self):
        row = self._row(call_over={"below_basis": True})
        self.assertIn("realize a loss", cs.build_verdict(row))

    def test_fund_verdict_names_the_fund_kind(self):
        row = self._row(tech_over={"ticker": "XLK"}, fund={"quote_type": "ETF", "total_assets": 60e9})
        self.assertIn("Sector fund", cs.build_verdict(row))

    def test_verdict_survives_a_row_with_no_chain(self):
        tech = a_tech()
        rating = cs.score_candidate(tech, LARGE_STOCK, None)
        text = cs.build_verdict({**tech, "call": None, **rating})
        self.assertTrue(text.endswith("."))


class SuggestCallSelectionTests(unittest.TestCase):
    """Strike selection, exercised against a synthetic chain (no network)."""

    def _chain(self):
        return [
            {"strike": s, "bid": max(0.05, 6.0 - (s - 100) * 0.5),
             "ask": max(0.10, 6.2 - (s - 100) * 0.5),
             "mid": max(0.08, 6.1 - (s - 100) * 0.5), "iv": 0.3,
             "delta": max(0.02, 0.55 - (s - 100) * 0.05),
             "volume": 100, "open_interest": 500, "dte": 35}
            for s in (100.0, 102.0, 104.0, 106.0, 108.0, 110.0, 112.0)
        ]

    def _suggest(self, **over):
        """Run _suggest_call with the network calls stubbed out."""
        chain = self._chain()
        expiration = (date.today() + timedelta(days=35)).isoformat()

        class FakeTicker:
            options = [expiration]

        real_ticker, real_chain = cs.yf.Ticker, cs._load_call_chain
        cs.yf.Ticker = lambda *_a, **_k: FakeTicker()
        cs._load_call_chain = lambda *_a, **_k: chain
        try:
            kwargs = {
                "ticker": "TEST", "spot": 100.0, "div_yield": 0.0, "target_dte": 35,
                "target_delta": 0.30, "min_dte": 14, "max_dte": 70, "min_otm_pct": 2.0,
            }
            kwargs.update(over)
            return cs._suggest_call(**kwargs)
        finally:
            cs.yf.Ticker, cs._load_call_chain = real_ticker, real_chain

    def test_picks_the_strike_nearest_the_target_delta(self):
        pick = self._suggest(target_delta=0.30)
        self.assertEqual(pick["strike"], 106.0)   # delta 0.25 is nearest 0.30

    def test_never_picks_a_strike_inside_the_min_otm_floor(self):
        pick = self._suggest(min_otm_pct=8.0)
        self.assertGreaterEqual(pick["strike"], 108.0)

    def test_at_the_money_strike_is_excluded(self):
        pick = self._suggest(min_otm_pct=0.0, target_delta=0.55)
        self.assertGreater(pick["strike"], 100.0)

    def test_cost_basis_floor_lifts_the_strike_above_what_you_paid(self):
        pick = self._suggest(cost_basis=109.0, respect_cost_basis=True)
        self.assertGreaterEqual(pick["strike"], 109.0)
        self.assertFalse(pick["below_basis"])
        self.assertTrue(pick["basis_floor_binding"])

    def test_cost_basis_floor_can_be_turned_off(self):
        pick = self._suggest(cost_basis=109.0, respect_cost_basis=False)
        self.assertEqual(pick["strike"], 106.0)
        self.assertTrue(pick["below_basis"])

    def test_unreachable_basis_falls_back_and_marks_below_basis(self):
        """No strike in the chain clears the basis, so it cannot be honoured."""
        pick = self._suggest(cost_basis=500.0, respect_cost_basis=True)
        self.assertTrue(pick["below_basis"])

    def test_static_and_if_called_returns_are_consistent(self):
        pick = self._suggest()
        spot, strike, mid = 100.0, pick["strike"], pick["mid"]
        self.assertAlmostEqual(pick["premium_yield_pct"], mid / spot * 100.0, places=6)
        self.assertAlmostEqual(pick["if_called_pct"], (mid + strike - spot) / spot * 100.0, places=6)
        # If-called must beat static for an OTM strike: it adds the capital gain.
        self.assertGreater(pick["if_called_pct"], pick["premium_yield_pct"])

    def test_upside_cap_and_breakeven(self):
        pick = self._suggest()
        self.assertAlmostEqual(pick["upside_cap"], pick["strike"] + pick["mid"], places=6)
        self.assertAlmostEqual(pick["downside_breakeven"], 100.0 - pick["mid"], places=6)

    def test_prob_keep_shares_is_the_complement_of_delta(self):
        pick = self._suggest()
        self.assertAlmostEqual(pick["prob_keep_shares"], (1.0 - pick["delta"]) * 100.0, places=6)

    def test_called_gain_is_measured_against_the_basis(self):
        pick = self._suggest(cost_basis=90.0)
        expected = (pick["strike"] - 90.0 + pick["mid"]) / 90.0 * 100.0
        self.assertAlmostEqual(pick["called_gain_pct"], expected, places=6)

    def test_ex_dividend_inside_the_trade_is_detected(self):
        inside = (date.today() + timedelta(days=15)).isoformat()
        pick = self._suggest(fund={"ex_dividend_date": inside, "last_dividend_value": 1.50})
        self.assertTrue(pick["ex_dividend_inside"])
        self.assertEqual(pick["dividend_amount"], 1.5)
        self.assertIn(pick["early_assignment"]["level"], ("low", "elevated", "high"))

    def test_earnings_cutoff_is_passed_through_to_the_expiration_choice(self):
        # Only one expiration exists and it is after the report, so it cannot be
        # dodged — avoids_earnings must say so rather than silently pass.
        soon = (date.today() + timedelta(days=20)).isoformat()
        pick = self._suggest(earnings_date=soon, earnings_buffer_days=5)
        self.assertFalse(pick["avoids_earnings"])
        self.assertEqual(pick["earnings_date"], soon)


class HeldPositionTests(unittest.TestCase):
    def test_contracts_writable_floors_at_one_hundred_share_lots(self):
        for shares, expected in ((0, 0), (99, 0), (100, 1), (250, 2), (1000, 10)):
            self.assertEqual(int(shares // 100), expected)


class UniverseTests(unittest.TestCase):
    def test_nothing_enabled_resolves_to_nothing(self):
        self.assertEqual(
            cs.resolve_scan_universe({
                "include_stocks": False, "include_index_etfs": False,
                "include_sector_etfs": False,
            }),
            [],
        )

    def test_index_only_skips_the_stock_universe(self):
        tickers = cs.resolve_scan_universe({
            "include_stocks": False, "include_index_etfs": True, "include_sector_etfs": False,
        })
        self.assertIn("SPY", tickers)
        self.assertNotIn("XLK", tickers)

    def test_sector_only_skips_the_index_universe(self):
        tickers = cs.resolve_scan_universe({
            "include_stocks": False, "include_index_etfs": False, "include_sector_etfs": True,
        })
        self.assertIn("XLK", tickers)
        self.assertNotIn("SPY", tickers)

    def test_custom_list_is_cleaned_and_deduped(self):
        tickers = cs.resolve_scan_universe({
            "include_stocks": True, "universe": "custom",
            "custom_tickers": ["aapl", "AAPL", " msft ", "", None],
        })
        self.assertEqual(tickers, ["AAPL", "MSFT"])

    def test_defaults_scan_holdings_first(self):
        self.assertEqual(cs.DEFAULTS["universe"], "holdings")

    def test_fresh_highs_are_excluded_by_default(self):
        """The single most important default: momentum takes the shares."""
        self.assertTrue(cs.DEFAULTS["exclude_fresh_highs"])

    def test_default_delta_is_the_conventional_covered_call_target(self):
        self.assertEqual(cs.DEFAULTS["target_delta"], 0.30)


class SmallCapTests(unittest.TestCase):
    """Small caps exist on this screen only — the put screen must not see them."""

    def test_small_cap_choices_are_additive_to_the_shared_ones(self):
        for key in ("small_cap", "large_mid_small", "mid_small"):
            self.assertIn(key, cs.CALL_UNIVERSE_CHOICES)
            self.assertNotIn(key, ps.UNIVERSE_CHOICES)
        # Every shared universe is still offered.
        for key in ps.UNIVERSE_CHOICES:
            self.assertIn(key, cs.CALL_UNIVERSE_CHOICES)

    def test_small_cap_universe_resolves(self):
        tickers = cs.resolve_call_universe("small_cap", None)
        self.assertGreater(len(tickers), 100)
        self.assertIn("SRPT", tickers)
        self.assertEqual(tickers, list(dict.fromkeys(tickers)))   # deduped

    def test_combined_universe_contains_both_tiers(self):
        tickers = cs.resolve_call_universe("large_mid_small", None)
        self.assertIn("AAPL", tickers)     # large
        self.assertIn("ZION", tickers)     # mid
        self.assertIn("AAON", tickers)     # small

    def test_small_cap_list_does_not_overlap_the_mid_cap_list(self):
        overlap = cs.SMALL_CAP_SET & set(ps.MID_CAP_UNIVERSE)
        self.assertEqual(overlap, set(), f"duplicated across tiers: {sorted(overlap)}")

    def test_small_cap_list_does_not_overlap_the_large_cap_list(self):
        overlap = cs.SMALL_CAP_SET & set(ps.LARGE_CAP_UNIVERSE)
        self.assertEqual(overlap, set(), f"duplicated across tiers: {sorted(overlap)}")

    def test_small_cap_tickers_are_not_etfs(self):
        self.assertEqual(cs.SMALL_CAP_SET & (ps.INDEX_ETF_SET | ps.SECTOR_ETF_SET), set())

    def test_small_caps_get_their_own_market_cap_floor(self):
        # The large-cap default would drop every small cap outright.
        self.assertLess(cs.DEFAULTS["small_cap_min_market_cap"], cs.DEFAULTS["min_market_cap"])
        self.assertGreater(cs.DEFAULTS["small_cap_min_market_cap"], 0)

    def test_a_shared_universe_still_routes_through_the_put_resolver(self):
        tickers = cs.resolve_call_universe("large_cap", None)
        self.assertEqual(tickers, ps.resolve_universe("large_cap", None))

    def test_small_underlying_is_flagged_and_scores_fewer_size_points(self):
        big = cs.score_candidate(a_tech(), {"market_cap": 120e9, "quote_type": "EQUITY"}, a_call())
        small = cs.score_candidate(a_tech(), {"market_cap": 800e6, "quote_type": "EQUITY"}, a_call())
        self.assertLess(small["components"]["terms"], big["components"]["terms"])
        self.assertNotIn("Small underlying", big["flags"])

    def test_a_thinly_traded_small_cap_is_flagged(self):
        rating = cs.score_candidate(
            a_tech(avg_dollar_volume=2e6), {"market_cap": 600e6, "quote_type": "EQUITY"}, a_call())
        self.assertIn("Thin share liquidity", rating["flags"])


class DividendYieldForPricingTests(unittest.TestCase):
    """The shared carry-yield helper, which both scanners now use."""

    def test_sub_one_percent_payer_is_not_read_as_thirty_two_percent(self):
        # AAPL: dividendYield 0.32 (percent), rate $1.08 on a ~$250 share.
        q = ps.dividend_yield_for_pricing(
            {"dividend_yield": 0.32, "dividend_rate": 1.08}, 250.0)
        self.assertAlmostEqual(q, 1.08 / 250.0, places=6)
        self.assertLess(q, 0.01)

    def test_normal_payer_uses_dollars_per_share(self):
        q = ps.dividend_yield_for_pricing(
            {"dividend_yield": 2.4, "dividend_rate": 2.12}, 88.0)
        self.assertAlmostEqual(q, 2.12 / 88.0, places=6)

    def test_fund_falls_back_to_the_trailing_annual_rate(self):
        q = ps.dividend_yield_for_pricing(
            {"dividend_yield": 1.01, "trailing_annual_dividend_rate": 5.662}, 560.0)
        self.assertAlmostEqual(q, 5.662 / 560.0, places=6)

    def test_yield_only_payload_is_scaled_from_percent(self):
        q = ps.dividend_yield_for_pricing({"dividend_yield": 2.4}, 88.0)
        self.assertAlmostEqual(q, 0.024, places=6)

    def test_non_payer_and_missing_price_are_zero(self):
        self.assertEqual(ps.dividend_yield_for_pricing({}, 100.0), 0.0)
        self.assertEqual(ps.dividend_yield_for_pricing({"dividend_rate": 1.0}, None), 0.0)

    def test_absurd_yield_is_clamped(self):
        q = ps.dividend_yield_for_pricing({"dividend_rate": 500.0}, 10.0)
        self.assertEqual(q, 0.5)


if __name__ == "__main__":
    unittest.main()
