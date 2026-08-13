"""Pure tests for the shared 1-10 stock-selection scores."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from stock_scores import stock_selection_scores


class StockSelectionScoreTests(unittest.TestCase):
    def test_quality_growth_and_uptrend_score_higher(self):
        strong = stock_selection_scores(
            {
                "profit_margin": 0.22, "return_on_equity": 0.28,
                "debt_to_equity": 35, "current_ratio": 2.0, "forward_pe": 18,
                "revenue_growth": 0.18, "earnings_growth": 0.25, "trailing_eps": 5,
            },
            {
                "price": 120, "sma_20": 115, "sma_50": 110, "sma_200": 100,
                "rsi_14": 58, "rel_strength_pct": 8,
            },
        )
        weak = stock_selection_scores(
            {
                "profit_margin": -0.05, "return_on_equity": -0.10,
                "debt_to_equity": 300, "current_ratio": 0.6, "forward_pe": 70,
                "revenue_growth": -0.12, "earnings_growth": -0.20, "trailing_eps": -2,
            },
            {
                "price": 80, "sma_20": 90, "sma_50": 100, "sma_200": 110,
                "rsi_14": 24, "rel_strength_pct": -12,
            },
        )
        for key in ("fundamental", "growth", "technical"):
            self.assertGreater(strong[key], weak[key])
            self.assertGreaterEqual(strong[key], 1)
            self.assertLessEqual(strong[key], 10)

    def test_funds_are_not_scored_as_companies(self):
        scores = stock_selection_scores({}, {
            "price": 110, "sma_20": 105, "sma_50": 100, "sma_200": 90,
            "rsi_14": 55, "rel_strength_pct": 4,
        }, is_fund=True)
        self.assertIsNone(scores["fundamental"])
        self.assertIsNone(scores["growth"])
        self.assertGreater(scores["technical"], 1)


if __name__ == "__main__":
    unittest.main()
