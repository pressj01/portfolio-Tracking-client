"""Time-weighted account return and the coverage rules behind account alpha."""

import datetime
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import account_performance as ap

D = datetime.date


class CoverageTest(unittest.TestCase):
    def test_adjacent_exports_merge_but_a_real_gap_splits(self):
        runs = ap.merge_coverage([
            ("2026-01-02", "2026-03-31"),
            ("2026-04-03", "2026-06-30"),   # 3 quiet days: same record
            ("2026-08-01", "2026-08-28"),   # a month missing: new run
        ])
        self.assertEqual(runs, [(D(2026, 1, 2), D(2026, 6, 30)), (D(2026, 8, 1), D(2026, 8, 28))])

    def test_window_uses_the_latest_overlapping_run(self):
        spans = [("2026-01-02", "2026-03-31"), ("2026-06-01", "2026-08-28")]
        self.assertEqual(
            ap.coverage_for_window(spans, D(2026, 2, 1), D(2026, 9, 23)),
            (D(2026, 6, 1), D(2026, 8, 28)),
        )
        self.assertIsNone(ap.coverage_for_window(spans, D(2026, 9, 1), D(2026, 9, 23)))

    def test_accounts_must_all_cover_the_same_days(self):
        self.assertEqual(
            ap.intersect_runs([(D(2026, 1, 1), D(2026, 6, 30)), (D(2026, 3, 1), D(2026, 9, 1))]),
            (D(2026, 3, 1), D(2026, 6, 30)),
        )
        self.assertIsNone(
            ap.intersect_runs([(D(2026, 1, 1), D(2026, 2, 1)), (D(2026, 3, 1), D(2026, 4, 1))])
        )


class TimeWeightedIndexTest(unittest.TestCase):
    def test_a_deposit_is_not_a_gain(self):
        index, problem = ap.time_weighted_index(
            [("2026-06-01", 1000.0), ("2026-06-02", 1510.0)],
            [("2026-06-02", 500.0)],
        )
        self.assertIsNone(problem)
        self.assertAlmostEqual(float(index.iloc[-1]), 1.01)

    def test_weekend_flow_lands_on_the_next_recorded_value(self):
        index, _ = ap.time_weighted_index(
            [("2026-06-05", 1000.0), ("2026-06-08", 900.0)],   # Fri, Mon
            [("2026-06-06", -100.0)],                          # Saturday withdrawal
        )
        self.assertAlmostEqual(float(index.iloc[-1]), 1.0)

    def test_flow_already_inside_the_first_value_is_ignored(self):
        index, _ = ap.time_weighted_index(
            [("2026-06-01", 1000.0), ("2026-06-02", 1010.0)],
            [("2026-06-01", 5000.0)],
        )
        self.assertAlmostEqual(float(index.iloc[-1]), 1.01)

    def test_unexplained_jump_is_refused(self):
        index, problem = ap.time_weighted_index(
            [("2026-06-01", 1000.0), ("2026-06-02", 1600.0)],
            [],
        )
        self.assertIsNone(index)
        self.assertEqual(problem[:2], ("unexplained_jump", D(2026, 6, 2)))


class FlowValueTest(unittest.TestCase):
    def test_cash_rows_keep_their_signed_amount(self):
        self.assertEqual(ap.flow_value({"base_amount": -600.0}), -600.0)

    def test_transfer_out_is_negative_even_with_a_positive_quantity(self):
        row = {
            "activity_date": "2026-06-07", "direction": "OUT", "base_amount": None,
            "ticker": "SNOY", "quantity": 27, "price_per_share": None,
        }
        self.assertAlmostEqual(ap.flow_value(row, lambda ticker, day: 10.0), -270.0)
        self.assertIsNone(ap.flow_value(row, lambda ticker, day: None))


if __name__ == "__main__":
    unittest.main()
