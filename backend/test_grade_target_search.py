import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grading import grade_portfolio, portfolio_returns_frame, search_weights_for_grade


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


if __name__ == "__main__":
    unittest.main()
