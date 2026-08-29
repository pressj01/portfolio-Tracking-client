"""Hand-entered account cash, and what a later broker import does to it."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import _cash_snapshot_summary, _set_profile_cash_value  # noqa: E402


class FakeRow(dict):
    """sqlite3.Row-alike: the helpers index by column name."""


def row(cash_value, source=None, updated_at=None):
    return FakeRow(
        cash_value=cash_value, cash_source=source, cash_updated_at=updated_at,
    )


class CashSnapshotSummaryTest(unittest.TestCase):
    """A rollup is only as fresh as its stalest account."""

    def test_reports_the_oldest_stamp_across_the_rollup(self):
        # The real shape: four Schwab accounts imported on different days.
        summary = _cash_snapshot_summary([
            row(984.58, "schwab", "2026-08-26T11:55:07"),
            row(965.98, "schwab", "2026-08-26T12:41:48"),
            row(1607.62, "schwab", "2026-08-26T12:42:32"),
            row(116.55, "schwab", "2026-08-24T14:59:08"),
        ])

        self.assertEqual(summary["as_of"], "2026-08-24T14:59:08")
        self.assertEqual(summary["source"], "schwab")
        self.assertEqual(summary["accounts"], 4)

    def test_an_account_holding_cash_with_no_stamp_leaves_the_total_undated(self):
        # Claiming the fresher date would date the total more precisely than its
        # least-known part, which is the one thing the stamp must never do.
        summary = _cash_snapshot_summary([
            row(500.0, "schwab", "2026-08-26T11:55:07"),
            row(250.0, "schwab", None),
        ])

        self.assertIsNone(summary["as_of"])
        self.assertEqual(summary["undated_accounts"], 1)

    def test_an_account_with_no_cash_cannot_make_the_total_look_stale(self):
        # A zero-cash account contributes nothing, so its old stamp is not the
        # age of a figure it had no part in.
        summary = _cash_snapshot_summary([
            row(500.0, "schwab", "2026-08-26T11:55:07"),
            row(0.0, "schwab", "2020-01-01T00:00:00"),
        ])

        self.assertEqual(summary["as_of"], "2026-08-26T11:55:07")
        self.assertEqual(summary["accounts"], 1)

    def test_a_hand_entry_beside_an_import_reads_as_mixed(self):
        summary = _cash_snapshot_summary([
            row(500.0, "schwab", "2026-08-26T11:55:07"),
            row(250.0, "manual", "2026-08-29T09:00:00"),
        ])

        self.assertEqual(summary["source"], "mixed")

    def test_no_cash_anywhere_reports_nothing_to_date(self):
        summary = _cash_snapshot_summary([row(0.0, "schwab", "2026-08-26T11:55:07")])

        self.assertIsNone(summary["as_of"])
        self.assertEqual(summary["accounts"], 0)


class CashWriteOrderTest(unittest.TestCase):
    """Last write wins, whoever wrote it. No lock, in either direction."""

    def setUp(self):
        import sqlite3
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(
            """CREATE TABLE profiles (
                   id INTEGER PRIMARY KEY, name TEXT,
                   cash_value REAL, cash_source TEXT, cash_updated_at TEXT)"""
        )
        self.conn.execute("INSERT INTO profiles (id, name) VALUES (6, 'Pressj04')")

    def tearDown(self):
        self.conn.close()

    def _read(self):
        return self.conn.execute(
            "SELECT cash_value, cash_source FROM profiles WHERE id = 6",
        ).fetchone()

    def test_an_import_overwrites_a_hand_entered_figure(self):
        # The whole design in one test. A typed figure is a snapshot that decays
        # as distributions settle; the broker's number is right for its own day,
        # so the import must not have to ask permission.
        _set_profile_cash_value(self.conn, 6, 1343.98, source="manual")
        _set_profile_cash_value(self.conn, 6, 1401.22, source="schwab")

        saved = self._read()
        self.assertAlmostEqual(saved["cash_value"], 1401.22)
        self.assertEqual(saved["cash_source"], "schwab")

    def test_a_hand_entry_overwrites_a_stale_import(self):
        # And the reverse, so a figure can be corrected between imports.
        _set_profile_cash_value(self.conn, 6, 984.58, source="schwab")
        _set_profile_cash_value(self.conn, 6, 1343.98, source="manual")

        saved = self._read()
        self.assertAlmostEqual(saved["cash_value"], 1343.98)
        self.assertEqual(saved["cash_source"], "manual")

    def test_every_write_restamps_the_date(self):
        _set_profile_cash_value(self.conn, 6, 100.0, source="schwab")
        first = self.conn.execute(
            "SELECT cash_updated_at FROM profiles WHERE id = 6",
        ).fetchone()["cash_updated_at"]

        _set_profile_cash_value(self.conn, 6, 200.0, source="manual")
        second = self.conn.execute(
            "SELECT cash_updated_at FROM profiles WHERE id = 6",
        ).fetchone()["cash_updated_at"]

        self.assertIsNotNone(first)
        self.assertGreaterEqual(second, first)


if __name__ == "__main__":
    unittest.main()
