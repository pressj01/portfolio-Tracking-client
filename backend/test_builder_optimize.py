"""Weight optimization for Portfolio Builder model mixes."""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grading import optimize_portfolio_weights
from test_grade_target_search import _portfolio, _score


class OptimizePortfolioWeightsTest(unittest.TestCase):
    def test_max_score_improves_or_stays(self):
        returns, bench, weights = _portfolio()
        start = _score(returns, weights, bench)
        out = optimize_portfolio_weights(
            returns, weights, bench, "max_score", min_obs=30, max_weight=0.35, time_budget=4.0)

        self.assertIsNotNone(out)
        self.assertEqual(out["objective"], "max_score")
        self.assertAlmostEqual(float(out["weights"].sum()), 1.0, places=8)
        self.assertGreaterEqual(out["metrics"]["shown_score"], start - 0.05)

    def test_min_drawdown_preserves_upside_guard(self):
        returns, bench, weights = _portfolio()
        out = optimize_portfolio_weights(
            returns, weights, bench, "min_drawdown", min_obs=30, max_weight=0.35, time_budget=4.0)
        self.assertIsNotNone(out)
        if out["start_metrics"]["total_return_pct"] is not None and out["metrics"]["total_return_pct"] is not None:
            # Allow the documented slack, plus a tiny float cushion.
            floor = out["start_metrics"]["total_return_pct"] - abs(out["start_metrics"]["total_return_pct"]) * 0.02 - 0.3
            self.assertGreaterEqual(out["metrics"]["total_return_pct"], floor - 1e-6)

    def test_unknown_objective_returns_none(self):
        returns, bench, weights = _portfolio()
        self.assertIsNone(optimize_portfolio_weights(returns, weights, bench, "nope"))

    def test_best_balance_keeps_every_held_ticker(self):
        returns, bench, weights = _portfolio()
        held = weights > 0
        out = optimize_portfolio_weights(
            returns, weights, bench, "best_balance", min_obs=30, max_weight=0.35, time_budget=4.0)
        self.assertIsNotNone(out)
        self.assertEqual(out["objective"], "best_balance")
        self.assertAlmostEqual(float(out["weights"].sum()), 1.0, places=8)
        self.assertTrue(np.all(out["weights"][held] > 1e-6))
        self.assertTrue(np.all(out["weights"][~held] == 0))


if __name__ == "__main__":
    unittest.main()
