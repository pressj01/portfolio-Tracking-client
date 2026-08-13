"""Tests for locally collected Yahoo IV history."""

import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import option_iv_history as history


class IvRankMathTests(unittest.TestCase):
    def test_rank_uses_empirical_percentile(self):
        self.assertAlmostEqual(history.calculate_iv_rank([0.20, 0.30, 0.40], 0.30), 50.0)

    def test_rank_is_not_distorted_by_one_extreme_value(self):
        self.assertAlmostEqual(
            history.calculate_iv_rank([0.20, 0.21, 0.22, 0.80], 0.22),
            62.5,
        )

    def test_rank_is_clamped(self):
        self.assertEqual(history.calculate_iv_rank([0.20, 0.40], 0.50), 100.0)
        self.assertEqual(history.calculate_iv_rank([0.20, 0.40], 0.10), 0.0)

    def test_flat_or_empty_history_has_no_rank(self):
        self.assertIsNone(history.calculate_iv_rank([0.25, 0.25], 0.25))
        self.assertIsNone(history.calculate_iv_rank([], 0.25))


class IvRankPersistenceTests(unittest.TestCase):
    def test_records_one_snapshot_per_day_and_warms_up(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "iv-history.db")

            def connection():
                conn = sqlite3.connect(path)
                conn.row_factory = sqlite3.Row
                return conn

            start = date(2026, 1, 2)
            with patch.object(history, "get_connection", side_effect=connection):
                first = history.record_iv_snapshot(
                    "spy", 0.20, "2026-02-20", observed_on=start, min_observations=3,
                )
                history.record_iv_snapshot(
                    "SPY", 0.30, "2026-02-20", observed_on=start + timedelta(days=1),
                    min_observations=3,
                )
                last = history.record_iv_snapshot(
                    "SPY", 0.40, "2026-02-20", observed_on=start + timedelta(days=2),
                    min_observations=3,
                )
                updated = history.record_iv_snapshot(
                    "SPY", 0.35, "2026-02-20", observed_on=start + timedelta(days=2),
                    min_observations=3,
                )

            self.assertFalse(first["ready"])
            self.assertTrue(last["ready"])
            self.assertAlmostEqual(last["rank"], 83.3333333333)
            self.assertEqual(updated["observations"], 3)
            self.assertAlmostEqual(updated["rank"], 83.3333333333)


if __name__ == "__main__":
    unittest.main()
