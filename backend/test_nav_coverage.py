import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import _nav_aggregate_severity


class NavCoverageAggregationTest(unittest.TestCase):
    def test_aggregate_severity_uses_portfolio_ratio_not_worst_holding(self):
        results = [
            {"ticker": "SMALL", "nav_erosion_severity": "High"},
            {"ticker": "CORE", "nav_erosion_severity": "Low"},
        ]

        self.assertEqual(_nav_aggregate_severity(0.1118, results), "Low")

    def test_aggregate_severity_thresholds_follow_weighted_ratio(self):
        self.assertEqual(_nav_aggregate_severity(0.25), "Low")
        self.assertEqual(_nav_aggregate_severity(0.5), "Medium")
        self.assertEqual(_nav_aggregate_severity(0.7501), "High")


if __name__ == "__main__":
    unittest.main()
