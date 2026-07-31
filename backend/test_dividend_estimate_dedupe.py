"""Refresh projections must not stack up into phantom dividend income.

Covers the two ways one distribution used to be recorded several times:
  1. the projected pay date moves between refreshes, inserting a second row;
  2. the broker's real payment lands on a different date than the projection,
     leaving the projection behind alongside it.
"""

import datetime
import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as app_module
import repair_dividend_estimates as repair


SCHEMA = """
CREATE TABLE dividend_payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker       TEXT NOT NULL,
    profile_id   INTEGER NOT NULL DEFAULT 1,
    payment_date TEXT NOT NULL,
    amount       REAL NOT NULL,
    source       TEXT DEFAULT 'manual',
    notes        TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ticker, profile_id, payment_date)
);
CREATE TABLE all_account_info (
    ticker        TEXT,
    profile_id    INTEGER,
    div_frequency TEXT
);
CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO profiles (id, name) VALUES (6, 'Pressj04');
"""


class DividendEstimateDedupeTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    def tearDown(self):
        self.conn.close()

    def add_payment(self, ticker, date, amount, source, profile_id=6):
        self.conn.execute(
            "INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source) "
            "VALUES (?, ?, ?, ?, ?)",
            (ticker, profile_id, date, amount, source),
        )

    def add_holding(self, ticker, frequency, profile_id=6):
        self.conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, div_frequency) VALUES (?, ?, ?)",
            (ticker, profile_id, frequency),
        )

    def payments(self, ticker, profile_id=6):
        return [dict(r) for r in self.conn.execute(
            "SELECT payment_date, amount, source FROM dividend_payments "
            "WHERE ticker = ? AND profile_id = ? ORDER BY payment_date",
            (ticker, profile_id),
        )]

    # ── window sizing ────────────────────────────────────────────────────────

    def test_window_stays_under_half_the_payout_period(self):
        """A window wider than half a period would merge two real distributions."""
        period_days = {"W": 7, "BW": 14, "SM": 15, "M": 30, "Q": 91, "SA": 182, "A": 365}
        for freq, period in period_days.items():
            self.assertLess(
                app_module._distribution_window_days(freq) * 2,
                period,
                "%s window must stay under half its %d-day payout period" % (freq, period),
            )

    def test_repair_script_window_matches_app(self):
        """The standalone repair script must cluster exactly like the writer."""
        self.assertEqual(repair.WINDOW_DAYS, app_module._DISTRIBUTION_WINDOW_DAYS)
        self.assertEqual(repair.DEFAULT_WINDOW_DAYS, app_module._DEFAULT_DISTRIBUTION_WINDOW_DAYS)

    def test_unknown_frequency_falls_back_to_default(self):
        self.assertEqual(
            app_module._distribution_window_days(None),
            app_module._DEFAULT_DISTRIBUTION_WINDOW_DAYS,
        )
        self.assertEqual(app_module._distribution_window_days("q"), 40)

    # ── period matching ──────────────────────────────────────────────────────

    def test_period_rows_match_a_moved_pay_date(self):
        self.add_payment("PBDC", "2026-07-14", 165.53, "schwab_transactions")
        rows = app_module._find_distribution_period_rows(self.conn, "PBDC", 6, "2026-07-27", "Q")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["payment_date"], "2026-07-14")

    def test_period_rows_exclude_the_next_distribution(self):
        """A monthly fund's next payment is outside the window, not a duplicate."""
        self.add_payment("TSPY", "2026-06-03", 67.83, "schwab_transactions")
        rows = app_module._find_distribution_period_rows(self.conn, "TSPY", 6, "2026-07-01", "M")
        self.assertEqual(rows, [])

    def test_weekly_payments_stay_separate(self):
        self.add_payment("YMAX", "2026-07-02", 40.0, "schwab_transactions")
        rows = app_module._find_distribution_period_rows(self.conn, "YMAX", 6, "2026-07-09", "W")
        self.assertEqual(rows, [])

    # ── prune on import ──────────────────────────────────────────────────────

    def test_real_payment_prunes_projection_on_another_date(self):
        self.add_payment("PBDC", "2026-07-27", 165.65, "refresh_estimate")
        self.add_payment("PBDC", "2026-07-14", 165.53, "schwab_transactions")
        removed = app_module._prune_superseded_refresh_estimates(
            self.conn, "PBDC", 6, "2026-07-14", "Q"
        )
        self.assertEqual(removed, 1)
        rows = self.payments("PBDC")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source"], "schwab_transactions")

    def test_prune_leaves_the_next_periods_projection_alone(self):
        self.add_payment("TUGN", "2026-07-24", 61.44, "schwab_transactions")
        self.add_payment("TUGN", "2026-08-28", 61.55, "refresh_estimate")
        removed = app_module._prune_superseded_refresh_estimates(
            self.conn, "TUGN", 6, "2026-07-24", "M"
        )
        self.assertEqual(removed, 0)
        self.assertEqual(len(self.payments("TUGN")), 2)

    def test_prune_never_deletes_recorded_payments(self):
        self.add_payment("PFFA", "2026-07-27", 23.70, "schwab_transactions")
        self.add_payment("PFFA", "2026-07-29", 23.70, "etrade_transactions")
        removed = app_module._prune_superseded_refresh_estimates(
            self.conn, "PFFA", 6, "2026-07-27", "M"
        )
        self.assertEqual(removed, 0)
        self.assertEqual(len(self.payments("PFFA")), 2)

    def test_frequency_lookup(self):
        self.add_holding("PBDC", "Q")
        self.assertEqual(app_module._ticker_div_frequency(self.conn, "PBDC", 6), "Q")
        self.assertIsNone(app_module._ticker_div_frequency(self.conn, "NOPE", 6))

    # ── repair script ────────────────────────────────────────────────────────

    def test_repair_removes_the_real_world_pbdc_case(self):
        """Real data: one quarterly distribution recorded three times."""
        self.add_holding("PBDC", "Q")
        self.add_payment("PBDC", "2026-07-14", 165.53, "schwab_transactions")
        self.add_payment("PBDC", "2026-07-27", 165.65, "refresh_estimate")
        self.add_payment("PBDC", "2026-07-31", 165.65, "refresh_estimate")

        doomed, stats = repair.find_duplicates(self.conn)
        self.assertEqual(len(doomed), 2)
        self.assertEqual(stats["superseded_by_real"], 2)
        self.assertAlmostEqual(sum(r["amount"] for r in doomed), 331.30, places=2)

    def test_repair_removes_the_real_world_tugn_case(self):
        """Two monthly distributions, each with a stray projection beside it."""
        self.add_holding("TUGN", "M")
        self.add_payment("TUGN", "2026-06-26", 60.49, "schwab_transactions")
        self.add_payment("TUGN", "2026-07-02", 61.10, "refresh_estimate")
        self.add_payment("TUGN", "2026-07-24", 61.44, "schwab_transactions")
        self.add_payment("TUGN", "2026-07-30", 61.55, "refresh_estimate")

        doomed, _ = repair.find_duplicates(self.conn)
        self.assertEqual({r["date"] for r in doomed}, {"2026-07-02", "2026-07-30"})

    def test_repair_keeps_one_projection_when_no_real_payment_exists(self):
        self.add_holding("SLJY", "M")
        self.add_payment("SLJY", "2026-07-03", 63.74, "refresh_estimate")
        self.add_payment("SLJY", "2026-07-07", 63.74, "refresh_estimate")

        doomed, stats = repair.find_duplicates(self.conn)
        self.assertEqual(len(doomed), 1)
        self.assertEqual(stats["duplicate_estimates"], 1)
        self.assertEqual(doomed[0]["date"], "2026-07-07")

    def test_repair_keeps_clean_history_untouched(self):
        """Twelve real monthly payments and no projections: nothing to remove."""
        self.add_holding("MO", "Q")
        for month in range(1, 13):
            self.add_payment("MO", "2025-%02d-15" % month, 100.0, "schwab_transactions")
        doomed, _ = repair.find_duplicates(self.conn)
        self.assertEqual(doomed, [])

    def test_repair_keeps_legitimate_weekly_projections(self):
        self.add_holding("YMAX", "W")
        for day in ("02", "09", "16", "23", "30"):
            self.add_payment("YMAX", "2026-07-%s" % day, 40.0, "refresh_estimate")
        doomed, _ = repair.find_duplicates(self.conn)
        self.assertEqual(doomed, [])

    def test_repair_infers_frequency_when_missing(self):
        """No div_frequency recorded: spacing of real payments supplies it."""
        for month in (3, 4, 5, 6):
            self.add_payment("UNK", "2026-%02d-15" % month, 50.0, "schwab_transactions")
        self.add_payment("UNK", "2026-06-20", 50.0, "refresh_estimate")
        doomed, stats = repair.find_duplicates(self.conn)
        self.assertEqual(stats["inferred_frequency"], 1)
        self.assertEqual([r["date"] for r in doomed], ["2026-06-20"])

    def test_repair_keeps_projection_when_recorded_frequency_is_wrong(self):
        """OVL is filed as quarterly in most profiles but pays monthly.

        A quarterly window is wide enough to pull May's real payment and July's
        projection into one period and delete the projection, which is income
        the broker simply has not reported yet. Cadence pooled across accounts
        has to override the recorded label.
        """
        self.conn.execute("INSERT INTO profiles (id, name) VALUES (19, 'Etrade Trading')")
        for pid in (6, 19):
            self.add_holding("OVL", "Q", profile_id=pid)
        # The fund's real cadence, spread across two accounts.
        for date in ("2026-03-30", "2026-04-29", "2026-06-29"):
            self.add_payment("OVL", date, 10.19, "schwab_transactions", profile_id=6)
        self.add_payment("OVL", "2026-05-28", 14.93, "etrade_transactions", profile_id=19)
        # Not yet reported by the broker — must survive.
        self.add_payment("OVL", "2026-07-02", 18.70, "refresh_estimate", profile_id=19)

        doomed, _ = repair.find_duplicates(self.conn)
        self.assertEqual(doomed, [])

    def test_collapse_events_merges_cross_broker_dates(self):
        """Two brokers settling one distribution must read as a single event."""
        d = datetime.date
        events = repair.collapse_events([d(2026, 6, 29), d(2026, 7, 2), d(2026, 7, 30)])
        self.assertEqual(events, [d(2026, 6, 29), d(2026, 7, 30)])

    def test_infer_frequency_spacings(self):
        def dates(step, n=6):
            start = datetime.date(2026, 1, 5)
            return [start + datetime.timedelta(days=step * i) for i in range(n)]
        self.assertEqual(repair.infer_frequency(dates(7)), "W")
        self.assertEqual(repair.infer_frequency(dates(30)), "M")
        self.assertEqual(repair.infer_frequency(dates(91)), "Q")
        self.assertIsNone(repair.infer_frequency(dates(30, n=2)))


if __name__ == "__main__":
    unittest.main()
