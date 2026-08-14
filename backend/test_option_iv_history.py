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
    def test_rank_is_the_share_of_prior_prints_below_current(self):
        self.assertAlmostEqual(history.calculate_iv_rank([0.20, 0.40], 0.30), 50.0)
        self.assertAlmostEqual(history.calculate_iv_rank([0.20, 0.30, 0.40], 0.30), 100 / 3)

    def test_new_high_and_new_low_are_100_and_0(self):
        self.assertEqual(history.calculate_iv_rank([0.20, 0.30, 0.40], 0.50), 100.0)
        self.assertEqual(history.calculate_iv_rank([0.20, 0.30, 0.40], 0.10), 0.0)

    def test_a_one_day_spike_does_not_define_the_top_of_the_year(self):
        cluster = [0.20 + index * 0.001 for index in range(12)] + [0.80]
        self.assertGreaterEqual(history.calculate_iv_rank(cluster, 0.211), 80.0)

    def test_invalid_iv_prints_are_ignored(self):
        self.assertAlmostEqual(history.calculate_iv_rank([0.20, 0.0, 4.0, 0.40], 0.30), 50.0)
        self.assertIsNone(history.calculate_iv_rank([0.20, 0.40], 0.0))

    def test_flat_or_empty_history_has_no_rank(self):
        self.assertIsNone(history.calculate_iv_rank([0.25, 0.25], 0.25))
        self.assertIsNone(history.calculate_iv_rank([], 0.25))

    def test_percentile_rank_handles_negative_spreads(self):
        self.assertAlmostEqual(
            history.calculate_percentile_rank([-4.0, 0.0, 4.0], 0.0),
            50.0,
        )
        self.assertEqual(history.calculate_percentile_rank([-4.0, 0.0, 4.0], 6.0), 100.0)
        self.assertEqual(history.calculate_percentile_rank([-4.0, 0.0, 4.0], -6.0), 0.0)

    def test_iv_minus_rv_is_signed_volatility_points(self):
        self.assertAlmostEqual(history.calculate_iv_rv(0.22, 0.18), 4.0)
        self.assertAlmostEqual(history.calculate_iv_rv(0.16, 0.20), -4.0)
        self.assertIsNone(history.calculate_iv_rv(0, 0.20))
        self.assertIsNone(history.calculate_iv_rv(0.20, None))


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
            self.assertAlmostEqual(last["rank"], 100.0)
            self.assertEqual(updated["observations"], 3)
            self.assertAlmostEqual(updated["rank"], 100.0)

            with patch.object(history, "get_connection", side_effect=connection):
                series = history.fetch_iv_observations("SPY", observed_on=start + timedelta(days=2))
            self.assertEqual(len(series), 3)
            self.assertEqual(series[0]["observed_on"], start)
            self.assertAlmostEqual(series[-1]["atm_iv"], 0.35)

    def test_same_day_keeps_the_closer_to_30_dte_print(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "iv-history.db")

            def connection():
                conn = sqlite3.connect(path)
                conn.row_factory = sqlite3.Row
                return conn

            day = date(2026, 1, 2)
            with patch.object(history, "get_connection", side_effect=connection):
                history.record_iv_snapshot(
                    "SPY", 0.22, "2026-02-01", observed_on=day, min_observations=1,
                )
                history.record_iv_snapshot(
                    "SPY", 0.40, "2026-01-09", observed_on=day, min_observations=1,
                )
                kept = history.fetch_iv_observations("SPY", observed_on=day)

            self.assertEqual(len(kept), 1)
            self.assertAlmostEqual(kept[0]["atm_iv"], 0.22)

    def test_rank_uses_front_month_history_when_enough_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "iv-history.db")

            def connection():
                conn = sqlite3.connect(path)
                conn.row_factory = sqlite3.Row
                return conn

            start = date(2026, 1, 2)
            with patch.object(history, "get_connection", side_effect=connection):
                for index in range(20):
                    day = start + timedelta(days=index)
                    history.record_iv_snapshot(
                        "SPY", 0.50, (day + timedelta(days=7)).isoformat(),
                        observed_on=day,
                    )
                for index in range(20, 40):
                    day = start + timedelta(days=index)
                    history.record_iv_snapshot(
                        "SPY", 0.20, (day + timedelta(days=30)).isoformat(),
                        observed_on=day,
                    )
                last = history.record_iv_snapshot(
                    "SPY", 0.21, (start + timedelta(days=40 + 30)).isoformat(),
                    observed_on=start + timedelta(days=40),
                )

            self.assertGreaterEqual(last["rank"], 90)


if __name__ == "__main__":
    unittest.main()
