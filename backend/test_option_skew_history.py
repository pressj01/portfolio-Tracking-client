"""Tests for option-skew calculations and locally collected rank history."""

import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import option_skew_history as skew_history


class SkewMathTests(unittest.TestCase):
    def test_calculates_side_and_put_call_skews_at_target_deltas(self):
        puts = [
            {"delta": -0.50, "iv": 0.20},
            {"delta": -0.25, "iv": 0.30},
        ]
        calls = [
            {"delta": 0.50, "iv": 0.21},
            {"delta": 0.25, "iv": 0.18},
        ]
        metrics = skew_history.calculate_skew_metrics(puts, calls)
        self.assertAlmostEqual(metrics["put_skew"], 10.0)
        self.assertAlmostEqual(metrics["call_skew"], -3.0)
        self.assertAlmostEqual(metrics["skew"], 12.0)

    def test_interpolates_iv_in_delta_space(self):
        puts = [
            {"delta": -0.20, "iv": 0.30},
            {"delta": -0.30, "iv": 0.26},
            {"delta": -0.45, "iv": 0.22},
            {"delta": -0.55, "iv": 0.20},
        ]
        metrics = skew_history.calculate_skew_metrics(puts, [])
        self.assertAlmostEqual(metrics["put_25_delta_iv"], 0.28)
        self.assertAlmostEqual(metrics["put_atm_iv"], 0.21)
        self.assertAlmostEqual(metrics["put_skew"], 7.0)
        self.assertIsNone(metrics["skew"])


class SkewPersistenceTests(unittest.TestCase):
    def test_rank_warms_up_then_becomes_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "skew-history.db")

            def connection():
                conn = sqlite3.connect(path)
                conn.row_factory = sqlite3.Row
                return conn

            start = date(2026, 1, 2)
            with patch.object(skew_history, "get_connection", side_effect=connection):
                first = skew_history.record_skew_snapshot(
                    "spy", {"put_skew": 1, "call_skew": -2, "skew": 3},
                    (start + timedelta(days=30)).isoformat(),
                    observed_on=start, min_observations=3,
                )
                skew_history.record_skew_snapshot(
                    "SPY", {"put_skew": 2, "call_skew": -1, "skew": 4},
                    (start + timedelta(days=31)).isoformat(),
                    observed_on=start + timedelta(days=1), min_observations=3,
                )
                last = skew_history.record_skew_snapshot(
                    "SPY", {"put_skew": 4, "call_skew": 1, "skew": 7},
                    (start + timedelta(days=32)).isoformat(),
                    observed_on=start + timedelta(days=2), min_observations=3,
                )

            self.assertFalse(first["put_skew"]["ready"])
            self.assertTrue(last["put_skew"]["ready"])
            self.assertEqual(last["put_skew"]["observations"], 3)
            self.assertAlmostEqual(last["put_skew"]["rank"], 100.0)
            self.assertAlmostEqual(last["skew"]["rank"], 100.0)


if __name__ == "__main__":
    unittest.main()
