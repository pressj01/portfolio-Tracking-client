import math
import os
import sys
import unittest
from datetime import date, timedelta
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import put_scanner as ps


def synthetic_frame(daily_sigma=0.012, drift=0.0, days=300, drop_pct=None,
                    drop_days=21, seed=7):
    """Build a deterministic OHLCV frame, optionally with a late selloff."""
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, daily_sigma, days)
    if drop_pct is not None:
        # Replace the tail with an even decline of the requested size.
        per_day = math.log(1.0 - drop_pct / 100.0) / drop_days
        rets[-drop_days:] = per_day
    close = 100.0 * np.exp(np.cumsum(rets))
    index = pd.bdate_range(end=date.today(), periods=days)
    return pd.DataFrame({
        "Open": close * 0.999,
        "High": close * 1.008,
        "Low": close * 0.992,
        "Close": close,
        "Volume": np.full(days, 3_000_000.0),
    }, index=index)


class RampTests(unittest.TestCase):
    def test_ramp_clamps_both_ends(self):
        self.assertEqual(ps._ramp(0, 1, 3, 15), 0.0)
        self.assertEqual(ps._ramp(5, 1, 3, 15), 15.0)
        self.assertEqual(ps._ramp(2, 1, 3, 15), 7.5)

    def test_ramp_handles_none(self):
        self.assertEqual(ps._ramp(None, 1, 3, 15), 0.0)


class TechnicalTests(unittest.TestCase):
    def test_quiet_stock_with_big_drop_is_high_sigma(self):
        """A 20% drop on a low-vol name should read as a large stretch."""
        sub = synthetic_frame(daily_sigma=0.008, drop_pct=20.0, drop_days=21)
        tech = ps._compute_technicals(sub, None, 21)
        self.assertIsNotNone(tech)
        self.assertGreater(tech["stretch_sigma"], 3.0)
        self.assertLess(tech["drawdown_pct"], -15.0)

    def test_volatile_stock_with_same_drop_is_lower_sigma(self):
        """The same drop on a noisy name is far less unusual."""
        quiet = ps._compute_technicals(synthetic_frame(daily_sigma=0.008, drop_pct=20.0), None, 21)
        noisy = ps._compute_technicals(synthetic_frame(daily_sigma=0.035, drop_pct=20.0), None, 21)
        self.assertGreater(quiet["stretch_sigma"], noisy["stretch_sigma"])

    def test_baseline_vol_excludes_the_drop_window(self):
        """The crash must not inflate the yardstick it is measured against."""
        sub = synthetic_frame(daily_sigma=0.008, drop_pct=25.0, drop_days=21)
        tech = ps._compute_technicals(sub, None, 21)
        # Baseline sigma should stay near the pre-drop 0.008/day, so the
        # 21-day expected move stays small relative to the 25% decline.
        self.assertLess(tech["expected_move_pct"], 8.0)

    def test_flat_stock_produces_no_dislocation(self):
        tech = ps._compute_technicals(synthetic_frame(daily_sigma=0.010), None, 21)
        self.assertLess(abs(tech["stretch_sigma"]), 2.5)

    def test_excess_drop_isolates_idiosyncratic_moves(self):
        """A stock that falls only as much as the market shows little excess."""
        market = synthetic_frame(daily_sigma=0.010, drop_pct=15.0, seed=3)
        bench_ret = np.log(market["Close"] / market["Close"].shift(1)).dropna()
        together = ps._compute_technicals(market.copy(), bench_ret, 21)
        self.assertLess(abs(together["excess_drop_pct"]), 3.0)

        worse = synthetic_frame(daily_sigma=0.010, drop_pct=35.0, seed=3)
        alone = ps._compute_technicals(worse, bench_ret, 21)
        self.assertLess(alone["excess_drop_pct"], -10.0)

    def test_fresh_low_is_detected(self):
        sub = synthetic_frame(daily_sigma=0.008, drop_pct=30.0, drop_days=40)
        tech = ps._compute_technicals(sub, None, 21)
        self.assertTrue(tech["fresh_low"])

    def test_thin_history_is_rejected(self):
        self.assertIsNone(ps._compute_technicals(synthetic_frame(days=30), None, 21))

    def test_rsi_bounds(self):
        rsi = ps._wilder_rsi(synthetic_frame(drop_pct=25.0)["Close"])
        self.assertTrue(0 <= rsi <= 100)
        self.assertLess(rsi, 40)


class ExpirationTests(unittest.TestCase):
    def _exp(self, days):
        return (date.today() + timedelta(days=days)).isoformat()

    def test_picks_nearest_to_target_within_bounds(self):
        exps = [self._exp(7), self._exp(21), self._exp(35), self._exp(90)]
        chosen, dte, _ = ps._pick_expiration(exps, 35, 14, 70)
        self.assertEqual(chosen, self._exp(35))
        self.assertEqual(dte, 35)

    def test_respects_the_window(self):
        exps = [self._exp(3), self._exp(120)]
        chosen, _, _ = ps._pick_expiration(exps, 35, 14, 70)
        self.assertIsNone(chosen)

    def test_ignores_unparseable_dates(self):
        chosen, _, _ = ps._pick_expiration(["not-a-date", self._exp(30)], 35, 14, 70)
        self.assertEqual(chosen, self._exp(30))

    def test_prefers_an_expiration_that_closes_before_earnings(self):
        """Given the choice, take the expiry that dodges the report."""
        exps = [self._exp(14), self._exp(21), self._exp(35), self._exp(49)]
        earnings = date.today() + timedelta(days=30)
        chosen, dte, cleared = ps._pick_expiration(
            exps, 35, 14, 70, expire_before=earnings - timedelta(days=5),
        )
        self.assertTrue(cleared)
        self.assertEqual(chosen, self._exp(21))   # 35 and 49 straddle earnings
        self.assertEqual(dte, 21)

    def test_falls_back_when_no_expiration_clears_earnings(self):
        """Report the best available and tell the caller it could not dodge."""
        exps = [self._exp(35), self._exp(49)]
        earnings = date.today() + timedelta(days=20)
        chosen, _, cleared = ps._pick_expiration(
            exps, 35, 14, 70, expire_before=earnings - timedelta(days=5),
        )
        self.assertFalse(cleared)
        self.assertEqual(chosen, self._exp(35))

    def test_no_earnings_date_means_no_constraint(self):
        """With no cutoff every expiry trivially clears; _suggest_put reports None."""
        exps = [self._exp(21), self._exp(35)]
        chosen, _, cleared = ps._pick_expiration(exps, 35, 14, 70, expire_before=None)
        self.assertEqual(chosen, self._exp(35))
        self.assertTrue(cleared)

    def test_default_window_does_not_cap_a_long_dated_target(self):
        """The UI only sends target_dte, so backend defaults must allow it to move."""
        exps = [self._exp(35), self._exp(63), self._exp(124)]
        chosen, dte, _ = ps._pick_expiration(
            exps,
            120,
            ps.DEFAULTS["min_dte"],
            ps.DEFAULTS["max_dte"],
        )
        self.assertEqual(chosen, self._exp(124))
        self.assertEqual(dte, 124)


class PutQuotePreparationTests(unittest.TestCase):
    def test_live_two_sided_quote_keeps_market_iv_and_delta(self):
        prepared = ps._prepare_put_quote(
            {
                "strike": 90.0,
                "bid": 2.0,
                "ask": 2.2,
                "mid": 2.1,
                "iv": 0.32,
                "delta": -0.24,
                "volume": 0,
            },
            spot=100.0,
            dte=35,
            dividend_yield=0.0,
        )

        self.assertEqual(prepared["quote_source"], "live_bid_ask")
        self.assertEqual(prepared["iv"], 0.32)
        self.assertEqual(prepared["delta"], -0.24)

    def test_same_session_last_trade_recomputes_iv_and_delta(self):
        dte = 35
        years = dte / 365.0
        market = ps.black_scholes(
            100.0,
            90.0,
            years,
            ps.RISK_FREE,
            0.0,
            0.30,
            "put",
        )
        prepared = ps._prepare_put_quote(
            {
                "strike": 90.0,
                "bid": 0.0,
                "ask": 0.0,
                "mid": market["price"],
                "iv": 0.001,
                "delta": -0.001,
                "volume": 25,
            },
            spot=100.0,
            dte=dte,
            dividend_yield=0.0,
        )

        self.assertEqual(prepared["quote_source"], "last_trade_estimate")
        self.assertAlmostEqual(prepared["iv"], 0.30, places=3)
        self.assertAlmostEqual(prepared["delta"], market["delta"], places=3)

    def test_untraded_contract_without_live_quote_is_rejected(self):
        prepared = ps._prepare_put_quote(
            {
                "strike": 90.0,
                "bid": 0.0,
                "ask": 0.0,
                "mid": 2.0,
                "iv": 0.30,
                "delta": -0.20,
                "volume": 0,
            },
            spot=100.0,
            dte=35,
            dividend_yield=0.0,
        )

        self.assertIsNone(prepared)


class EarningsTargetWindowTests(unittest.TestCase):
    def setUp(self):
        self.as_of = date(2026, 7, 29)

    def test_report_inside_target_horizon_is_excluded(self):
        earnings = self.as_of + timedelta(days=15)
        self.assertTrue(ps._earnings_within_target_window(
            earnings, 60, 5, as_of=self.as_of,
        ))

    def test_buffer_is_part_of_the_exclusion_window(self):
        earnings = self.as_of + timedelta(days=65)
        self.assertTrue(ps._earnings_within_target_window(
            earnings, 60, 5, as_of=self.as_of,
        ))

    def test_report_beyond_target_and_buffer_is_clear(self):
        earnings = self.as_of + timedelta(days=66)
        self.assertFalse(ps._earnings_within_target_window(
            earnings, 60, 5, as_of=self.as_of,
        ))

    def test_missing_or_stale_report_is_not_a_conflict(self):
        self.assertFalse(ps._earnings_within_target_window(
            None, 60, 5, as_of=self.as_of,
        ))
        self.assertFalse(ps._earnings_within_target_window(
            self.as_of - timedelta(days=1), 60, 5, as_of=self.as_of,
        ))


class ScoringTests(unittest.TestCase):
    def base_tech(self, **over):
        tech = {
            "price": 100.0, "stretch_sigma": 2.5, "drawdown_pct": -25.0,
            "excess_drop_pct": -12.0, "rv_30": 0.30, "rv_252": 0.28,
            "fresh_low": False, "bounce_off_low_pct": 4.0, "decel_pp": 5.0,
            "above_52w_low_pct": 10.0, "avg_dollar_volume": 300e6, "sma_200": 115.0,
        }
        tech.update(over)
        return tech

    def base_fund(self, **over):
        fund = {
            "market_cap": 250e9, "trailing_eps": 6.0, "profit_margin": 0.22,
            "debt_to_equity": 45.0, "current_ratio": 1.4, "next_earnings": None,
        }
        fund.update(over)
        return fund

    def base_put(self, **over):
        put = {
            "atm_iv": 0.45, "annualized_pct": 24.0, "spread_pct": 8.0,
            "open_interest": 2500, "expiration": (date.today() + timedelta(days=35)).isoformat(),
        }
        put.update(over)
        return put

    def test_ideal_candidate_scores_high(self):
        r = ps.score_candidate(self.base_tech(), self.base_fund(), self.base_put())
        self.assertGreaterEqual(r["score"], 75)
        self.assertIn(r["grade"], ("A", "B"))
        self.assertEqual(r["flags"], [])

    def test_falling_knife_is_penalized(self):
        good = ps.score_candidate(self.base_tech(), self.base_fund(), self.base_put())
        knife = ps.score_candidate(
            self.base_tech(fresh_low=True, bounce_off_low_pct=0.0, decel_pp=-6.0,
                           above_52w_low_pct=0.5),
            self.base_fund(), self.base_put(),
        )
        self.assertLess(knife["score"], good["score"])
        self.assertIn("Making fresh 52-week lows", knife["flags"])

    def test_unprofitable_company_is_penalized_and_flagged(self):
        r = ps.score_candidate(
            self.base_tech(),
            self.base_fund(trailing_eps=-2.0, profit_margin=-0.15),
            self.base_put(),
        )
        self.assertIn("Not profitable on trailing earnings", r["flags"])
        self.assertLess(r["components"]["quality"], 20)

    def test_cheap_options_score_less_premium_than_rich_ones(self):
        rich = ps.score_candidate(self.base_tech(), self.base_fund(), self.base_put(atm_iv=0.50))
        cheap = ps.score_candidate(self.base_tech(), self.base_fund(), self.base_put(atm_iv=0.28))
        self.assertGreater(rich["components"]["premium"], cheap["components"]["premium"])
        self.assertGreater(rich["iv_rv_ratio"], cheap["iv_rv_ratio"])

    def test_earnings_before_expiry_is_flagged(self):
        r = ps.score_candidate(
            self.base_tech(),
            self.base_fund(next_earnings=(date.today() + timedelta(days=10)).isoformat()),
            self.base_put(),
        )
        self.assertTrue(r["earnings_before_expiry"])
        self.assertIn("Earnings before expiration", r["flags"])

    def test_earnings_after_expiry_is_not_flagged(self):
        r = ps.score_candidate(
            self.base_tech(),
            self.base_fund(next_earnings=(date.today() + timedelta(days=90)).isoformat()),
            self.base_put(),
        )
        self.assertFalse(r["earnings_before_expiry"])
        self.assertNotIn("Earnings before expiration", r["flags"])
        self.assertEqual(r["days_to_earnings"], 90)

    def test_earnings_just_after_expiry_is_flagged(self):
        """Expiry is clear, but a report 2 days later still matters if you roll."""
        r = ps.score_candidate(
            self.base_tech(),
            self.base_fund(next_earnings=(date.today() + timedelta(days=37)).isoformat()),
            self.base_put(),   # expires in 35 days
        )
        self.assertFalse(r["earnings_before_expiry"])
        self.assertIn("Earnings 2d after expiry", r["flags"])

    def test_earnings_inside_the_trade_costs_premium_points(self):
        """Premium earned by straddling a report is not really free money."""
        clear = ps.score_candidate(
            self.base_tech(),
            self.base_fund(next_earnings=(date.today() + timedelta(days=200)).isoformat()),
            self.base_put(),
        )
        through = ps.score_candidate(
            self.base_tech(),
            self.base_fund(next_earnings=(date.today() + timedelta(days=10)).isoformat()),
            self.base_put(),
        )
        self.assertLess(through["components"]["premium"], clear["components"]["premium"])
        self.assertLess(through["score"], clear["score"])

    def test_missing_chain_normalizes_over_the_scored_axes(self):
        """A missing chain must not read as a bad candidate."""
        r = ps.score_candidate(self.base_tech(), self.base_fund(), None)
        self.assertTrue(r["scored_on_partial"])
        self.assertGreater(r["score"], 60)
        self.assertLessEqual(r["score"], 100)
        self.assertIn("Option chain unavailable", r["flags"])

    def test_partial_scores_rank_below_priced_ones(self):
        """The smaller denominator must not float an unpriceable name to the top.

        Bites when the premium axis scores badly: cheap options drag the full
        score down, while the same name with no chain skips that axis entirely.
        """
        priced = ps.score_candidate(
            self.base_tech(), self.base_fund(),
            self.base_put(atm_iv=0.20, annualized_pct=6.0),
        )
        partial = ps.score_candidate(self.base_tech(), self.base_fund(), None)
        # The partial score comes out numerically higher...
        self.assertGreater(partial["score"], priced["score"])
        # ...so the ranking key, not the raw score, has to break the tie.
        rows = [
            {"ticker": "NOCHAIN", "put": None, "score": partial["score"]},
            {"ticker": "PRICED", "put": {"strike": 100}, "score": priced["score"]},
        ]
        rows.sort(key=lambda r: (0 if r.get("put") else 1, -(r.get("score") or 0)))
        self.assertEqual([r["ticker"] for r in rows], ["PRICED", "NOCHAIN"])

    def test_illiquid_names_are_flagged(self):
        r = ps.score_candidate(
            self.base_tech(avg_dollar_volume=1e6), self.base_fund(), self.base_put()
        )
        self.assertIn("Thin share liquidity", r["flags"])

    def test_wide_spreads_and_thin_oi_flagged(self):
        r = ps.score_candidate(
            self.base_tech(), self.base_fund(),
            self.base_put(spread_pct=45.0, open_interest=5),
        )
        self.assertIn("Wide bid/ask spread", r["flags"])
        self.assertIn("Thin open interest", r["flags"])

    def test_recent_trade_estimate_is_explicitly_flagged(self):
        r = ps.score_candidate(
            self.base_tech(),
            self.base_fund(),
            self.base_put(quote_source="last_trade_estimate"),
        )
        self.assertIn("Recent trade estimate — no live bid/ask", r["flags"])

    def test_score_never_exceeds_100(self):
        r = ps.score_candidate(
            self.base_tech(stretch_sigma=9.0, drawdown_pct=-70.0, excess_drop_pct=-60.0,
                           bounce_off_low_pct=40.0, decel_pp=40.0, above_52w_low_pct=60.0),
            self.base_fund(market_cap=3e12),
            self.base_put(atm_iv=3.0, annualized_pct=200.0),
        )
        self.assertLessEqual(r["score"], 100.0)


class BuybackRecommendationTests(unittest.TestCase):
    def base_put(self, **over):
        put = {
            "mid": 2.0,
            "dte": 35,
            "prob_otm": 80.0,
            "delta": -0.20,
            "spread_pct": 10.0,
            "open_interest": 1000,
        }
        put.update(over)
        return put

    def test_strong_liquid_setup_targets_seventy_percent_capture(self):
        rec = ps.recommend_buyback(
            self.base_put(),
            {"score": 85.0, "grade": "A", "flags": []},
        )
        self.assertEqual(rec["target_price"], 0.60)
        self.assertEqual(rec["profit_capture_pct"], 70.0)
        self.assertEqual(rec["premium_kept_dollars"], 140.0)
        self.assertEqual(rec["premium_returned_dollars"], 60.0)
        self.assertEqual(rec["reassess_dte"], 21)
        self.assertEqual(rec["profile"], "Strong setup")

    def test_balanced_setup_targets_sixty_five_percent_capture(self):
        rec = ps.recommend_buyback(
            self.base_put(prob_otm=74.0, delta=-0.25),
            {"score": 75.0, "grade": "B", "flags": []},
        )
        self.assertEqual(rec["target_price"], 0.70)
        self.assertEqual(rec["profit_capture_pct"], 65.0)
        self.assertEqual(rec["premium_kept_dollars"], 130.0)
        self.assertEqual(rec["profile"], "Balanced setup")

    def test_risk_flag_uses_earlier_sixty_percent_exit(self):
        rec = ps.recommend_buyback(
            self.base_put(),
            {
                "score": 85.0,
                "grade": "A",
                "flags": ["Earnings before expiration"],
            },
        )
        self.assertEqual(rec["target_price"], 0.80)
        self.assertEqual(rec["profit_capture_pct"], 60.0)
        self.assertEqual(rec["premium_kept_dollars"], 120.0)
        self.assertEqual(rec["profile"], "Defensive setup")

    def test_missing_or_zero_credit_has_no_buyback_target(self):
        self.assertIsNone(ps.recommend_buyback(None, {}))
        self.assertIsNone(ps.recommend_buyback({"mid": 0}, {}))


class VerdictTests(unittest.TestCase):
    def test_verdict_mentions_the_trade(self):
        row = {
            "grade": "A", "stretch_sigma": 2.6, "drawdown_pct": -22.0, "flags": [],
            "put": {
                "expiration": "2026-09-18", "strike": 85.0,
                "annualized_pct": 26.0, "effective_basis": 82.5,
                "buyback": {
                    "target_price": 0.75,
                    "profit_capture_pct": 65.0,
                },
            },
        }
        text = ps.build_verdict(row)
        self.assertIn("$85 put", text)
        self.assertIn("26% annualized", text)
        self.assertIn("2.6", text)
        self.assertIn("buy it back near $0.75", text)

    def test_verdict_warns_on_fresh_lows(self):
        row = {
            "grade": "D", "stretch_sigma": 2.0, "drawdown_pct": -40.0,
            "flags": ["Making fresh 52-week lows"], "put": None,
        }
        self.assertIn("wait for a base", ps.build_verdict(row))


class BuybackTests(unittest.TestCase):
    """Buy-to-close target: keep most of the credit, drop the tail risk."""

    def put(self, **over):
        p = {
            "mid": 10.00, "dte": 35, "delta": -0.20, "prob_otm": 80.0,
            "spread_pct": 8.0, "open_interest": 2500,
        }
        p.update(over)
        return p

    def rating(self, **over):
        r = {"score": 85.0, "grade": "A", "flags": []}
        r.update(over)
        return r

    def test_no_put_means_no_target(self):
        self.assertIsNone(ps.recommend_buyback(None, self.rating()))

    def test_zero_credit_means_no_target(self):
        self.assertIsNone(ps.recommend_buyback(self.put(mid=0.0), self.rating()))

    def test_strong_setup_holds_out_for_70_percent(self):
        b = ps.recommend_buyback(self.put(), self.rating())
        self.assertEqual(b["profile"], "Strong setup")
        self.assertAlmostEqual(b["target_price"], 3.00, places=2)
        self.assertAlmostEqual(b["profit_capture_pct"], 70.0, places=1)
        self.assertAlmostEqual(b["premium_kept_dollars"], 700.0, places=0)

    def test_balanced_setup_takes_65_percent(self):
        b = ps.recommend_buyback(self.put(delta=-0.28), self.rating(grade="B", score=72.0))
        self.assertEqual(b["profile"], "Balanced setup")
        self.assertAlmostEqual(b["target_price"], 3.50, places=2)

    def test_material_risk_drops_to_the_defensive_target(self):
        """A flagged setup should be closed sooner, not held for max credit."""
        b = ps.recommend_buyback(
            self.put(), self.rating(flags=["Making fresh 52-week lows"]),
        )
        self.assertEqual(b["profile"], "Defensive setup")
        self.assertAlmostEqual(b["target_price"], 4.00, places=2)
        self.assertAlmostEqual(b["profit_capture_pct"], 60.0, places=1)

    def test_illiquid_chain_is_defensive_even_with_a_top_score(self):
        b = ps.recommend_buyback(
            self.put(spread_pct=40.0, open_interest=10),
            self.rating(flags=["Wide bid/ask spread", "Thin open interest"]),
        )
        self.assertEqual(b["profile"], "Defensive setup")

    def test_target_is_always_below_the_credit(self):
        for credit in (0.05, 0.40, 2.75, 18.30):
            b = ps.recommend_buyback(self.put(mid=credit), self.rating())
            self.assertLess(b["target_price"], credit + 1e-9)
            self.assertGreater(b["target_price"], 0)
            self.assertGreaterEqual(b["premium_kept_dollars"], 0)

    def test_kept_plus_returned_reconciles_to_the_credit(self):
        b = ps.recommend_buyback(self.put(mid=6.40), self.rating())
        total = b["premium_kept_dollars"] + b["premium_returned_dollars"]
        self.assertAlmostEqual(total, 640.0, delta=1.0)

    def test_reassess_dte_shortens_for_near_dated_puts(self):
        self.assertEqual(ps.recommend_buyback(self.put(dte=35), self.rating())["reassess_dte"], 21)
        near = ps.recommend_buyback(self.put(dte=14), self.rating())
        self.assertEqual(near["reassess_dte"], 7)
        self.assertLess(near["reassess_dte"], 14)


class FundTests(unittest.TestCase):
    """ETFs report AUM and have no earnings, so the stock gates cannot apply."""

    def etf(self, **over):
        f = {
            "quote_type": "ETF", "market_cap": None, "total_assets": 780e9,
            "trailing_eps": None, "profit_margin": None, "debt_to_equity": None,
            "name": "SPDR S&P 500 ETF Trust", "category": "Large Blend",
            "next_earnings": None,
        }
        f.update(over)
        return f

    def tech(self, ticker="SPY", **over):
        t = {
            "ticker": ticker, "price": 600.0, "stretch_sigma": 2.2,
            "drawdown_pct": -7.0, "excess_drop_pct": -1.0, "rv_30": 0.16,
            "rv_252": 0.15, "fresh_low": False, "bounce_off_low_pct": 3.0,
            "decel_pp": 4.0, "above_52w_low_pct": 12.0,
            "avg_dollar_volume": 30e9, "sma_200": 640.0,
        }
        t.update(over)
        return t

    def test_etf_is_detected_without_a_market_cap(self):
        self.assertTrue(ps._is_fund(self.etf(), "SPY"))
        self.assertTrue(ps._is_fund({"quote_type": None, "total_assets": 5e9, "market_cap": None}, "ZZZZ"))
        self.assertFalse(ps._is_fund({"quote_type": "EQUITY", "market_cap": 3e11}, "AAPL"))

    def test_curated_tickers_classify_by_breadth(self):
        self.assertEqual(ps._fund_kind("SPY", self.etf()), "index")
        self.assertEqual(ps._fund_kind("QQQ", self.etf()), "index")
        self.assertEqual(ps._fund_kind("XLK", self.etf(category="Technology")), "sector")
        self.assertEqual(ps._fund_kind("GLD", self.etf(category="Commodities Precious Metals")), "sector")

    def test_leveraged_and_inverse_funds_are_identified(self):
        self.assertEqual(ps._fund_kind("TQQQ", self.etf(name="ProShares UltraPro QQQ")), "leveraged")
        self.assertEqual(ps._fund_kind("SQQQ", self.etf(name="ProShares UltraPro Short QQQ")), "leveraged")
        self.assertEqual(ps._fund_kind("SPXL", self.etf(name="Direxion Daily S&P 500 Bull 3X")), "leveraged")

    def test_fund_size_falls_back_to_aum(self):
        self.assertEqual(ps._fund_size(self.etf()), 780e9)
        self.assertEqual(ps._fund_size({"market_cap": 3e11, "total_assets": None}), 3e11)

    def test_broad_index_scores_full_quality_without_earnings(self):
        """SPY has no EPS; it must not be punished for that."""
        r = ps.score_candidate(self.tech(), self.etf(), None)
        self.assertTrue(r["is_fund"])
        self.assertEqual(r["fund_kind"], "index")
        self.assertGreaterEqual(r["components"]["quality"], 24)
        self.assertNotIn("Not profitable on trailing earnings", r["flags"])
        self.assertIsNone(r["days_to_earnings"])

    def test_sector_fund_scores_below_a_broad_index(self):
        broad = ps.score_candidate(self.tech("SPY"), self.etf(), None)
        sector = ps.score_candidate(
            self.tech("XLE"), self.etf(name="Energy Select Sector SPDR", total_assets=35e9), None
        )
        self.assertEqual(sector["fund_kind"], "sector")
        self.assertLess(sector["components"]["quality"], broad["components"]["quality"])

    def test_leveraged_fund_is_flagged_and_scores_zero_diversification(self):
        r = ps.score_candidate(
            self.tech("TQQQ"), self.etf(name="ProShares UltraPro QQQ", total_assets=20e9), None
        )
        self.assertIn("Leveraged or inverse fund", r["flags"])
        self.assertLess(r["components"]["quality"], 18)

    def test_tiny_fund_is_flagged(self):
        r = ps.score_candidate(self.tech("XYZ"), self.etf(total_assets=50e6), None)
        self.assertIn("Small fund", r["flags"])

    def test_verdict_describes_a_fund_not_a_company(self):
        row = {
            "grade": "B", "stretch_sigma": 2.2, "drawdown_pct": -7.0, "flags": [],
            "is_fund": True, "fund_kind": "index", "put": None,
        }
        self.assertIn("Broad index fund", ps.build_verdict(row))


class ScanUniverseTests(unittest.TestCase):
    def test_groups_are_independent(self):
        only_index = ps.resolve_scan_universe({
            "include_stocks": False, "include_index_etfs": True, "include_sector_etfs": False,
        })
        self.assertIn("SPY", only_index)
        self.assertIn("QQQ", only_index)
        self.assertNotIn("AAPL", only_index)
        self.assertNotIn("XLK", only_index)
        self.assertEqual(len(only_index), len(ps.INDEX_ETF_UNIVERSE))

    def test_index_only_scan_does_not_pull_the_stock_universe(self):
        """Unchecking stocks must shrink the download, not just the results."""
        both = ps.resolve_scan_universe({
            "include_stocks": True, "universe": "large_cap", "include_index_etfs": True,
        })
        etf_only = ps.resolve_scan_universe({
            "include_stocks": False, "include_index_etfs": True,
        })
        self.assertLess(len(etf_only), len(both) / 3)

    def test_sector_group_carries_the_commodity_funds(self):
        sect = ps.resolve_scan_universe({"include_stocks": False, "include_sector_etfs": True})
        for t in ("XLK", "XLE", "GLD", "SLV", "GDX", "SMH"):
            self.assertIn(t, sect)

    def test_combined_selection_dedupes(self):
        all_on = ps.resolve_scan_universe({
            "include_stocks": True, "universe": "large_cap",
            "include_index_etfs": True, "include_sector_etfs": True,
        })
        self.assertEqual(len(all_on), len(set(all_on)))

    def test_nothing_selected_yields_nothing(self):
        self.assertEqual(ps.resolve_scan_universe({
            "include_stocks": False, "include_index_etfs": False, "include_sector_etfs": False,
        }), [])

    def test_selected_funds_are_an_exact_user_defined_universe(self):
        tickers = ps.resolve_scan_universe({
            "include_stocks": False,
            "include_index_etfs": False,
            "include_sector_etfs": False,
            "include_selected_funds": True,
            "selected_fund_tickers": "spy, qqq; iwm GLD",
        })
        self.assertEqual(tickers, ["SPY", "QQQ", "IWM", "GLD"])


class SelectedFundFallbackTests(unittest.TestCase):
    def test_selected_etf_technical_near_miss_is_returned_with_warning(self):
        weak_tech = {
            "price": 100.0, "drawdown_pct": -0.2, "stretch_sigma": 0.1,
            "rsi_14": 75.0, "avg_dollar_volume": 2e9, "fresh_low": False,
            "rv_30": 0.20, "rv_252": 0.18, "window_pct": 0.1,
            "expected_move_pct": 2.0, "excess_drop_pct": 0.0,
            "beta": 1.0, "week52_high": 101.0, "week52_low": 90.0,
            "above_52w_low_pct": 11.0, "bounce_off_low_pct": 1.0,
            "decel_pp": 0.0, "sma_50": 99.0, "sma_200": 95.0,
        }
        etf = {
            "quote_type": "ETF", "total_assets": 500e9,
            "name": "SPDR S&P 500 ETF Trust", "category": "Large Blend",
            "next_earnings": None,
        }
        put = {
            "expiration": (date.today() + timedelta(days=35)).isoformat(),
            "dte": 35, "strike": 95.0, "bid": 1.0, "ask": 1.1,
            "mid": 1.05, "iv": 0.22, "atm_iv": 0.23, "delta": -0.25,
            "prob_otm": 75.0, "open_interest": 1000, "volume": 100,
            "spread_pct": 9.5, "quote_source": "live_bid_ask",
            "premium_yield_pct": 1.1, "annualized_pct": 11.0,
            "cash_required": 9500.0, "premium_dollars": 105.0,
            "effective_basis": 93.95, "discount_to_spot_pct": 6.1,
            "otm_pct": 5.0,
        }
        with (
            patch.object(ps, "_load_history", return_value=pd.DataFrame({"x": [1]})),
            patch.object(ps, "_benchmark_returns", return_value=None),
            patch.object(ps, "_ticker_frame", return_value=pd.DataFrame({"x": [1]})),
            patch.object(ps, "_compute_technicals", return_value=weak_tech),
            patch.object(ps, "_fetch_fundamentals_bulk", return_value={"SPY": etf}),
            patch.object(ps, "_suggest_put", return_value=put),
            patch.object(ps, "profit_probability_schedule", return_value=[]),
        ):
            result = ps.run_put_scan({
                "include_stocks": False,
                "include_index_etfs": False,
                "include_sector_etfs": False,
                "include_selected_funds": True,
                "selected_fund_tickers": "SPY",
                "include_lower_confidence_selected_funds": True,
            })

        self.assertEqual(result["rows"][0]["ticker"], "SPY")
        self.assertEqual(result["rows"][0]["candidate_status"], "lower_confidence")
        self.assertIn(ps.LOW_CONFIDENCE_SELECTED_FUND_FLAG, result["rows"][0]["flags"])
        self.assertEqual(result["stats"]["lower_confidence"], 1)


class UniverseTests(unittest.TestCase):
    def test_no_duplicates_or_overlap(self):
        self.assertEqual(len(ps.LARGE_CAP_UNIVERSE), len(set(ps.LARGE_CAP_UNIVERSE)))
        self.assertEqual(len(ps.MID_CAP_UNIVERSE), len(set(ps.MID_CAP_UNIVERSE)))
        self.assertFalse(set(ps.LARGE_CAP_UNIVERSE) & set(ps.MID_CAP_UNIVERSE))

    def test_custom_universe_is_cleaned(self):
        got = ps.resolve_universe("custom", [" aapl ", "MSFT", "aapl", "", None])
        self.assertEqual(got, ["AAPL", "MSFT"])

    def test_unknown_universe_falls_back_to_large_cap(self):
        self.assertEqual(
            ps.resolve_universe("nonsense", None),
            ps._clean_tickers(ps.LARGE_CAP_UNIVERSE),
        )


if __name__ == "__main__":
    unittest.main()
