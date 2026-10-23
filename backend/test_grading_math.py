import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grading import (  # noqa: E402
    DEFAULT_GRADING_SETTINGS,
    _capture_ratio,
    _capture_ratios,
    _diversification_ratio,
    _score_higher,
    _score_lower,
    grade_portfolio,
    portfolio_returns_frame,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def _bench(n=120, seed=1):
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0005, 0.01, n),
                     index=pd.bdate_range("2025-01-01", periods=n))


class CaptureRatioAlignmentTest(unittest.TestCase):
    def test_a_holding_younger_than_the_window_is_measured_on_its_own_days(self):
        bench = _bench()
        # Identical to the benchmark over the days it existed, so 100/100.
        young = bench.iloc[60:].copy()
        self.assertEqual(_capture_ratios(young, bench, min_obs=30), (100.0, 100.0))

    def test_a_bar_the_benchmark_lacks_does_not_blank_the_ratio(self):
        bench = _bench()
        crypto = bench.copy()
        crypto.loc[pd.Timestamp("2025-03-01")] = 0.02  # a Saturday print
        crypto = crypto.sort_index()
        self.assertEqual(_capture_ratios(crypto, bench, min_obs=30), (100.0, 100.0))

    def test_overlap_shorter_than_min_obs_is_unreported(self):
        bench = _bench()
        self.assertEqual(_capture_ratios(bench.iloc[100:], bench, min_obs=30), (None, None))


class ScoreTailTest(unittest.TestCase):
    def test_default_positive_floor_is_unchanged(self):
        thr = (1.5, 1.0, 0.5, 0.2)
        self.assertAlmostEqual(_score_higher(0.1, thr), 20.0)
        self.assertEqual(_score_higher(-0.3, thr), 0.0)
        lower = (3, 7, 12, 20)
        self.assertAlmostEqual(_score_lower(30, lower), 20.0)
        self.assertEqual(_score_lower(45, lower), 0.0)

    def test_negative_floor_keeps_worse_values_scoring_lower(self):
        thr = (1.5, 1.0, 0.5, -0.5)  # a user-set Sharpe floor below zero
        scores = [_score_higher(v, thr) for v in (-0.5, -0.6, -0.8, -1.0, -2.0)]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(0.0 <= s <= 40.0 for s in scores))
        self.assertEqual(_score_higher(-2.0, thr), 0.0)

    def test_negative_floor_on_a_lower_is_better_metric(self):
        thr = (-40, -30, -20, -10)  # e.g. down capture bands below zero
        scores = [_score_lower(v, thr) for v in (-10, -8, -5, 0, 10)]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(0.0 <= s <= 40.0 for s in scores))


class PortfolioReturnsFrameTest(unittest.TestCase):
    def test_a_missing_bar_keeps_the_move_across_the_gap(self):
        idx = pd.bdate_range("2026-01-05", periods=5)
        close = pd.DataFrame({"AAA": [10.0, 10.0, np.nan, 11.0, 11.0]}, index=idx)
        returns = portfolio_returns_frame(close)
        self.assertAlmostEqual(float((1 + returns["AAA"]).prod()), 1.1)

    def test_first_row_is_dropped_and_pre_listing_days_are_zero(self):
        idx = pd.bdate_range("2026-01-05", periods=4)
        close = pd.DataFrame(
            {"OLD": [10.0, 11.0, 12.1, 12.1], "NEW": [np.nan, np.nan, 5.0, 5.5]},
            index=idx,
        )
        returns = portfolio_returns_frame(close)
        self.assertEqual(list(returns.index), list(idx[1:]))
        self.assertEqual(returns["NEW"].tolist()[:2], [0.0, 0.0])
        self.assertAlmostEqual(returns["NEW"].iloc[-1], 0.1)

    def test_grade_sees_one_return_per_trading_day(self):
        bench = _bench(n=61)
        close = pd.DataFrame({"AAA": 100 * (1 + bench).cumprod(),
                              "BBB": 50 * (1 + bench * 0.5).cumprod()})
        returns = portfolio_returns_frame(close)
        self.assertEqual(len(returns), len(close) - 1)
        self.assertFalse((returns.iloc[0] == 0).all())
        pm = grade_portfolio(returns, np.array([1.0, 1.0]), min_obs=30)
        self.assertIsNotNone(pm["sharpe"])


def _noise(seed, n=500, vol=0.01):
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0004, vol, n), index=pd.bdate_range("2024-01-02", periods=n))


class DiversificationRatioTest(unittest.TestCase):
    def _ratio(self, returns, weights):
        w = np.asarray(weights, dtype=float)
        w = w / w.sum()
        return _diversification_ratio(returns, w, returns.dot(w), min_obs=30)

    def test_holdings_that_move_together_earn_no_benefit(self):
        a = _noise(1)
        returns = pd.DataFrame({"A": a, "B": a * 1.5})  # same moves, more leverage
        self.assertEqual(self._ratio(returns, [1, 1]), 1.0)

    def test_independent_holdings_approach_root_n(self):
        returns = pd.DataFrame({"A": _noise(1, n=5000), "B": _noise(2, n=5000)})
        self.assertAlmostEqual(self._ratio(returns, [1, 1]), np.sqrt(2), delta=0.03)

    def test_cash_earns_no_credit(self):
        a = _noise(3)
        returns = pd.DataFrame({"A": a, "CASH": 0.0 * a})
        self.assertEqual(self._ratio(returns, [1, 1]), 1.0)

    def test_effective_holdings_cannot_see_correlation(self):
        base = _noise(4)
        clones = pd.DataFrame({f"F{i}": base + _noise(10 + i, vol=0.001) for i in range(10)})
        pm = grade_portfolio(clones, np.ones(10), min_obs=30)
        self.assertEqual(pm["effective_n"], 10.0)
        self.assertLess(pm["diversification_ratio"], 1.01)

    def test_too_little_history_is_unreported(self):
        returns = pd.DataFrame({"A": _noise(1, n=20), "B": _noise(2, n=20)})
        self.assertIsNone(self._ratio(returns, [1, 1]))


class CaptureRatioTest(unittest.TestCase):
    def test_ratio_is_upside_over_downside(self):
        self.assertEqual(_capture_ratio(90.0, 75.0), 1.2)

    def test_undefined_without_positive_downside(self):
        self.assertIsNone(_capture_ratio(80.0, 0.0))
        self.assertIsNone(_capture_ratio(80.0, -12.0))
        self.assertIsNone(_capture_ratio(None, 75.0))

    def test_a_capped_fund_scores_below_one(self):
        bench = _noise(5, vol=0.012)
        # Keeps 40% of up days but 70% of down days, like a covered-call fund.
        capped = bench.where(bench < 0, bench * 0.4).where(bench >= 0, bench * 0.7)
        returns = pd.DataFrame({"CC": capped, "CC2": capped})
        pm = grade_portfolio(returns, np.array([1.0, 1.0]), bench, min_obs=30)
        self.assertEqual((pm["up_capture"], pm["down_capture"]), (40.0, 70.0))
        self.assertEqual(pm["capture_ratio"], round(40.0 / 70.0, 2))


class NewRatiosInTheGradeTest(unittest.TestCase):
    def setUp(self):
        self.bench = _noise(6)
        self.returns = pd.DataFrame({"A": self.bench * 0.9 + _noise(7, vol=0.004),
                                     "B": _noise(8)})

    def test_both_ratios_are_scored_with_their_default_weights(self):
        pm = grade_portfolio(self.returns, np.array([1.0, 1.0]), self.bench, min_obs=30)
        rows = {b["category"]: b for b in pm["grade"]["breakdown"]}
        self.assertEqual(rows["Diversification Ratio"]["weight"], 10.0)
        self.assertEqual(rows["Capture Ratio"]["weight"], 10.0)
        self.assertAlmostEqual(sum(b["weight_pct"] for b in rows.values()), 100.0, delta=0.5)

    def test_a_zero_weight_drops_each_ratio(self):
        pm = grade_portfolio(
            self.returns, np.array([1.0, 1.0]), self.bench, min_obs=30,
            grading_settings={"portfolioWeights": {"diversificationRatio": 0, "captureRatio": 0}},
        )
        categories = {b["category"] for b in pm["grade"]["breakdown"]}
        self.assertNotIn("Diversification Ratio", categories)
        self.assertNotIn("Capture Ratio", categories)
        self.assertIsNotNone(pm["diversification_ratio"])

    def test_bands_score_the_ratio(self):
        strict = {"higherBands": {"diversificationRatio": {
            "excellent": 9, "good": 8, "fair": 7, "poor": 6}}}
        lenient = {"higherBands": {"diversificationRatio": {
            "excellent": 1.0, "good": 0.9, "fair": 0.8, "poor": 0.7}}}
        def score(settings):
            pm = grade_portfolio(self.returns, np.array([1.0, 1.0]), self.bench,
                                 min_obs=30, grading_settings=settings)
            return {b["category"]: b["score"] for b in pm["grade"]["breakdown"]}["Diversification Ratio"]
        self.assertEqual(score(lenient), 100.0)
        self.assertLess(score(strict), 40.0)


@unittest.skipUnless(shutil.which("node"), "node is needed to read the browser defaults")
class DefaultFormulaParityTest(unittest.TestCase):
    def test_backend_defaults_match_the_settings_page(self):
        # The browser sends its saved formula; the backend copy serves every
        # caller that does not. If the two drift, the same portfolio grades
        # differently depending on who asked.
        script = (
            "import('./src/utils/gradingPreferences.js').then(m => "
            "console.log(JSON.stringify(m.DEFAULT_GRADING_PREFERENCES.portfolioRisk)))"
        )
        out = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout
        browser = json.loads(out.strip().splitlines()[-1])
        normalize = lambda value: (  # noqa: E731
            {k: normalize(v) for k, v in value.items()} if isinstance(value, dict) else float(value)
        )
        self.assertEqual(normalize(browser), normalize(DEFAULT_GRADING_SETTINGS))


if __name__ == "__main__":
    unittest.main()
