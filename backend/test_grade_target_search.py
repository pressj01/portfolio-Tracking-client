import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grading import grade_portfolio, portfolio_returns_frame, search_grade_options, search_weights_for_grade


def _portfolio(seed=3, n=8, days=252):
    """A market factor plus per-fund drift, so some holdings help the grade and some hurt it."""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2025-10-01", periods=days)
    market = rng.normal(0.0003, 0.009, days)
    drift = np.linspace(-0.0012, 0.0012, n)
    rets = market[:, None] * rng.uniform(0.5, 1.3, n) + rng.normal(drift, 0.012, (days, n))
    close = pd.DataFrame(100 * np.cumprod(1 + rets, axis=0), index=dates, columns=[f"F{i}" for i in range(n)])
    bench = pd.Series(100 * np.cumprod(1 + market), index=dates).pct_change().dropna()
    # Heaviest in the weakest funds, so there is room to improve.
    weights = np.array([30, 25, 15, 10, 8, 6, 4, 2], dtype=float)[:n]
    return portfolio_returns_frame(close), bench, weights


def _score(returns, weights, bench):
    return grade_portfolio(returns, weights, bench, min_obs=30)["grade"]["score"]


class SearchWeightsForGradeTest(unittest.TestCase):
    def test_reaches_a_higher_grade_using_only_held_funds(self):
        returns, bench, weights = _portfolio()
        weights[3] = 0  # listed but not held: must stay at zero
        start = _score(returns, weights, bench)
        target = start + 5
        out = search_weights_for_grade(returns, weights, bench, target, min_obs=30, max_weight=0.30)

        self.assertTrue(out["reached"], out)
        self.assertEqual(out["stopped"], "reached")
        self.assertGreaterEqual(out["score"], target)
        self.assertEqual(out["weights"][3], 0)
        self.assertAlmostEqual(float(out["weights"].sum()), 1.0, places=9)
        self.assertTrue((out["weights"] >= -1e-12).all())
        # The reported score is what grade_portfolio gives the returned mix.
        self.assertEqual(out["score"], _score(returns, out["weights"], bench))

    def test_blocked_holdings_never_grow_and_none_grows_past_the_cap(self):
        returns, bench, weights = _portfolio()
        current = weights / weights.sum()
        can_increase = [i != 7 for i in range(len(weights))]  # the strongest fund is off limits
        out = search_weights_for_grade(returns, weights, bench, _score(returns, weights, bench) + 4,
                                       can_increase=can_increase, min_obs=30, max_weight=0.20)

        self.assertLessEqual(out["weights"][7], current[7] + 1e-12)
        grew = out["weights"] > current + 1e-12
        self.assertTrue((out["weights"][grew] <= 0.20 + 1e-9).all(), out["weights"])

    def test_already_at_target_changes_nothing(self):
        returns, bench, weights = _portfolio()
        out = search_weights_for_grade(returns, weights, bench, 0, min_obs=30)

        self.assertTrue(out["reached"])
        self.assertEqual(out["iterations"], 0)
        np.testing.assert_allclose(out["weights"], weights / weights.sum())

    def test_unreachable_target_returns_the_best_mix_found(self):
        returns, bench, weights = _portfolio()
        start = _score(returns, weights, bench)
        out = search_weights_for_grade(returns, weights, bench, 101, min_obs=30, max_iterations=6)

        self.assertFalse(out["reached"])
        self.assertIn(out["stopped"], {"stuck", "budget"})
        self.assertGreaterEqual(out["score"], start)

    def test_nothing_held_returns_none(self):
        returns, bench, weights = _portfolio()
        self.assertIsNone(search_weights_for_grade(returns, weights * 0, bench, 80, min_obs=30))

    def test_no_eligible_recipient_leaves_the_mix_unchanged(self):
        returns, bench, weights = _portfolio()
        out = search_weights_for_grade(returns, weights, bench, 101,
                                       can_increase=[False] * len(weights))
        self.assertFalse(out["reached"])
        self.assertEqual(out["stopped"], "stuck")
        np.testing.assert_allclose(out["weights"], weights / weights.sum())

    def test_expired_search_budget_reports_a_limit_without_claiming_success(self):
        returns, bench, weights = _portfolio()
        out = search_weights_for_grade(returns, weights, bench, 101, time_budget=0)
        self.assertFalse(out["reached"])
        self.assertEqual(out["stopped"], "budget")
        self.assertEqual(out["iterations"], 0)
        np.testing.assert_allclose(out["weights"], weights / weights.sum())

    def test_protected_holdings_never_shrink(self):
        returns, bench, weights = _portfolio()
        current = weights / weights.sum()
        can_decrease = [i != 0 for i in range(len(weights))]  # the largest, weakest fund
        out = search_weights_for_grade(returns, weights, bench, _score(returns, weights, bench) + 5,
                                       can_decrease=can_decrease, min_obs=30, max_weight=0.30)

        self.assertTrue(out["reached"], out)
        self.assertGreaterEqual(out["weights"][0], current[0] - 1e-12)

    def test_with_yields_income_never_falls(self):
        returns, bench, weights = _portfolio()
        current = weights / weights.sum()
        # The weakest funds pay the most, as covered-call funds often do.
        yields = np.linspace(0.12, 0.0, len(weights))
        out = search_weights_for_grade(returns, weights, bench, _score(returns, weights, bench) + 5,
                                       yields=yields, min_obs=30, max_weight=0.30)

        self.assertTrue(out["reached"], out)
        self.assertGreaterEqual(float(out["weights"] @ yields), float(current @ yields) - 1e-12)


class SearchGradeOptionsTest(unittest.TestCase):
    def setUp(self):
        self.returns, self.bench, self.weights = _portfolio()
        self.current = self.weights / self.weights.sum()
        self.yields = np.linspace(0.12, 0.0, len(self.weights))
        self.target = _score(self.returns, self.weights, self.bench) + 5

    def _options(self, target=None, **kwargs):
        return search_grade_options(self.returns, self.weights, self.bench,
                                    self.target if target is None else target,
                                    yields=self.yields, min_obs=30, max_weight=0.30, **kwargs)

    def test_offers_different_mixes_that_each_reach_the_target(self):
        options = self._options()
        main = search_weights_for_grade(self.returns, self.weights, self.bench, self.target,
                                        min_obs=30, max_weight=0.30)

        self.assertGreaterEqual(len(options), 2, [o["kind"] for o in options])
        self.assertLessEqual(len(options), 5)
        # The first option is the search's own answer.
        self.assertEqual(options[0]["kind"], "main")
        np.testing.assert_allclose(options[0]["weights"], main["weights"])
        for option in options:
            self.assertTrue(option["reached"], option["kind"])
            self.assertGreaterEqual(option["score"], self.target)
            self.assertEqual(option["score"], _score(self.returns, option["weights"], self.bench))
            self.assertAlmostEqual(float(option["weights"].sum()), 1.0, places=9)
        # No two options are near copies of each other.
        for i, a in enumerate(options):
            for b in options[i + 1:]:
                self.assertGreater(float(np.abs(a["weights"] - b["weights"]).sum()) / 2, 0.0025,
                                   (a["kind"], b["kind"]))

    def test_each_alternative_keeps_its_rule(self):
        options = self._options()
        names = list(self.returns.columns)
        kinds = {o["kind"] for o in options}
        self.assertTrue(kinds & {"income", "keep", "avoid"}, kinds)
        for option in options:
            change = option["weights"] - self.current
            if option["kind"] == "income":
                self.assertGreaterEqual(float(change @ self.yields), -1e-12)
            elif option["kind"] == "keep":
                self.assertGreaterEqual(change[names.index(option["ticker"])], -1e-12)
                # It protects a holding the main plan trims.
                self.assertLess((options[0]["weights"] - self.current)[names.index(option["ticker"])], 0)
            elif option["kind"] == "avoid":
                self.assertLessEqual(change[names.index(option["ticker"])], 1e-12)
                self.assertGreater((options[0]["weights"] - self.current)[names.index(option["ticker"])], 0)

    def test_alternatives_respect_the_callers_limits(self):
        blocked = 7
        options = self._options(can_increase=[i != blocked for i in range(len(self.weights))], max_options=3)

        self.assertLessEqual(len(options), 3)
        for option in options:
            self.assertLessEqual(option["weights"][blocked], self.current[blocked] + 1e-12, option["kind"])
            self.assertTrue((option["weights"][option["weights"] > self.current + 1e-12] <= 0.30 + 1e-9).all())

    def test_no_alternatives_when_already_there_or_out_of_reach(self):
        already = self._options(target=0)
        self.assertEqual([o["kind"] for o in already], ["main"])
        np.testing.assert_allclose(already[0]["weights"], self.current)

        out_of_reach = self._options(target=101, max_iterations=4)
        self.assertEqual([o["kind"] for o in out_of_reach], ["main"])
        self.assertFalse(out_of_reach[0]["reached"])

    def test_expired_time_budget_stops_after_the_main_plan(self):
        options = self._options(total_time_budget=0)
        self.assertEqual([o["kind"] for o in options], ["main"])
        self.assertTrue(options[0]["reached"])

    def test_nothing_held_returns_no_options(self):
        self.assertEqual(search_grade_options(self.returns, self.weights * 0, self.bench, 80, min_obs=30), [])


if __name__ == "__main__":
    unittest.main()
