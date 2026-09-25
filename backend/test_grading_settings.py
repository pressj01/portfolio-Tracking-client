import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grading import (  # noqa: E402
    DEFAULT_GRADING_SETTINGS,
    grade_portfolio,
    letter_grade,
    normalize_grading_settings,
    ticker_score,
)


def _returns(seed, n=260):
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0006, 0.01, n),
                     index=pd.bdate_range("2024-01-02", periods=n))


class GradingSettingsTest(unittest.TestCase):
    def test_missing_settings_normalize_to_defaults(self):
        self.assertEqual(normalize_grading_settings(None), DEFAULT_GRADING_SETTINGS)
        self.assertEqual(normalize_grading_settings("junk"), DEFAULT_GRADING_SETTINGS)

    def test_partial_settings_keep_every_other_default(self):
        settings = normalize_grading_settings({"holdingWeights": {"sharpe": 40}})
        self.assertEqual(settings["holdingWeights"]["sharpe"], 40)
        self.assertEqual(settings["holdingWeights"]["calmar"], 20)
        self.assertEqual(settings["lowerBands"], DEFAULT_GRADING_SETTINGS["lowerBands"])

    def test_out_of_order_bands_fall_back_per_metric(self):
        settings = normalize_grading_settings({
            "higherBands": {"sharpe": {"excellent": 0.1, "good": 1, "fair": 2, "poor": 3}},
            "lowerBands": {"ulcerIndex": {"excellent": 2, "good": 4, "fair": 6, "poor": 8}},
            "letterCutoffs": {"aPlus": 50},
        })
        self.assertEqual(settings["higherBands"]["sharpe"],
                         DEFAULT_GRADING_SETTINGS["higherBands"]["sharpe"])
        self.assertEqual(settings["lowerBands"]["ulcerIndex"]["poor"], 8)
        self.assertEqual(settings["letterCutoffs"], DEFAULT_GRADING_SETTINGS["letterCutoffs"])

    def test_letter_cutoffs_are_adjustable(self):
        self.assertEqual(letter_grade(85), "B")
        strict = {"letterCutoffs": {
            "aPlus": 99, "a": 98, "aMinus": 97, "bPlus": 96, "b": 95, "bMinus": 94,
            "cPlus": 93, "c": 92, "cMinus": 91, "dPlus": 90, "d": 89, "dMinus": 88,
        }}
        self.assertEqual(letter_grade(85, strict), "F")

    def test_holding_weights_change_the_ticker_score(self):
        ret = _returns(1)
        close = (1 + ret).cumprod() * 100
        default_score = ticker_score(close, ret)[0]
        sharpe_only = {"holdingWeights": {
            "ulcerIndex": 0, "calmar": 0, "omega": 0, "sortino": 0,
            "sharpe": 1, "maxDrawdown": 0, "downCapture": 0,
        }}
        sharpe_score = ticker_score(close, ret, grading_settings=sharpe_only)[0]
        self.assertNotEqual(default_score, sharpe_score)

    def test_nav_health_uses_the_formula_and_its_weight(self):
        returns_df = pd.DataFrame({"A": _returns(2), "B": _returns(3)})
        weights = np.array([0.5, 0.5])

        without = grade_portfolio(returns_df, weights)
        categories = [b["category"] for b in without["grade"]["breakdown"]]
        self.assertNotIn("NAV Health", categories)

        # A 10% weighted NAV decline at the default 2-point penalty scores 80.
        with_nav = grade_portfolio(returns_df, weights, nav_erosion=-0.10)
        nav = next(b for b in with_nav["grade"]["breakdown"] if b["category"] == "NAV Health")
        self.assertEqual(nav["score"], 80.0)
        self.assertEqual(nav["weight"], 10)
        self.assertEqual(with_nav["nav_erosion_avg_pct"], -10.0)

        harsher = grade_portfolio(
            returns_df, weights, nav_erosion=-0.10,
            grading_settings={"navHealth": {"fullScore": 100, "penaltyPerDeclinePct": 5}},
        )
        nav = next(b for b in harsher["grade"]["breakdown"] if b["category"] == "NAV Health")
        self.assertEqual(nav["score"], 50.0)

    def test_zero_weight_excludes_a_metric_and_shares_sum_to_100(self):
        returns_df = pd.DataFrame({"A": _returns(4), "B": _returns(5)})
        pm = grade_portfolio(
            returns_df, np.array([0.5, 0.5]), nav_erosion=0.0,
            grading_settings={"portfolioWeights": {"diversification": 0}},
        )
        breakdown = pm["grade"]["breakdown"]
        self.assertNotIn("Diversification", [b["category"] for b in breakdown])
        self.assertAlmostEqual(sum(b["weight_pct"] for b in breakdown), 100.0, delta=0.5)
        self.assertEqual(pm["grade"]["settings"]["portfolioWeights"]["diversification"], 0)


if __name__ == "__main__":
    unittest.main()
