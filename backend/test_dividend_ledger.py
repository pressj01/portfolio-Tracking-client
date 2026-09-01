import datetime
import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database
from dividend_ledger import (
    build_ledger,
    group_by_ticker,
    normalize_week_start,
    week_start_for,
)


TODAY = datetime.date(2026, 8, 7)  # a Friday


class DividendLedgerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute("UPDATE profiles SET owner_active = 1 WHERE id = 1")
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (2, 'Roth')")
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        app_module.get_connection = self._connect
        app_module.app.testing = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        try:
            Path(self.db_path).unlink()
        except OSError:
            pass

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _pay(self, date, ticker, amount, profile_id=1, source="schwab_transactions"):
        conn = self._connect()
        conn.execute(
            "INSERT OR REPLACE INTO dividend_payments "
            "(ticker, profile_id, payment_date, amount, source) VALUES (?, ?, ?, ?, ?)",
            (ticker, profile_id, date, amount, source),
        )
        conn.commit()
        conn.close()

    def _ledger(self, **kwargs):
        profile_ids = kwargs.pop("profile_ids", [1])
        kwargs.setdefault("today", TODAY)
        conn = self._connect()
        try:
            return build_ledger(conn, profile_ids, **kwargs)
        finally:
            conn.close()

    def _day(self, payload, date):
        return next(d for d in payload["days"] if d["date"] == date)

    # ── week arithmetic ──────────────────────────────────────────────────────

    def test_week_start_monday_and_sunday(self):
        friday = datetime.date(2026, 8, 7)
        self.assertEqual(week_start_for(friday, "mon"), datetime.date(2026, 8, 3))
        self.assertEqual(week_start_for(friday, "sun"), datetime.date(2026, 8, 2))
        sunday = datetime.date(2026, 8, 9)
        self.assertEqual(week_start_for(sunday, "mon"), datetime.date(2026, 8, 3))
        self.assertEqual(week_start_for(sunday, "sun"), sunday)

    def test_normalize_week_start_rejects_junk(self):
        self.assertEqual(normalize_week_start("sun"), "sun")
        self.assertEqual(normalize_week_start("SUNDAY"), "sun")
        self.assertEqual(normalize_week_start("tue"), "mon")
        self.assertEqual(normalize_week_start(None), "mon")

    # ── running totals ───────────────────────────────────────────────────────

    def test_quiet_day_carries_running_totals_forward(self):
        self._pay("2026-08-03", "SPYI", 100.00)
        self._pay("2026-08-06", "QQQI", 25.00)
        payload = self._ledger(month="2026-08")

        mon = self._day(payload, "2026-08-03")
        self.assertEqual(mon["total"], 100.00)
        self.assertEqual(mon["week_to_date"], 100.00)
        self.assertEqual(mon["month_to_date"], 100.00)

        # Nothing paid Tue–Wed, so both running totals hold at Monday's value.
        for quiet in ("2026-08-04", "2026-08-05"):
            row = self._day(payload, quiet)
            self.assertEqual(row["total"], 0.0)
            self.assertEqual(row["week_to_date"], 100.00)
            self.assertEqual(row["month_to_date"], 100.00)

        thu = self._day(payload, "2026-08-06")
        self.assertEqual(thu["total"], 25.00)
        self.assertEqual(thu["week_to_date"], 125.00)
        self.assertEqual(thu["month_to_date"], 125.00)

    def test_week_to_date_resets_each_week_month_to_date_does_not(self):
        self._pay("2026-08-06", "SPYI", 40.00)   # week of Aug 3
        self._pay("2026-08-13", "SPYI", 60.00)   # week of Aug 10
        payload = self._ledger(month="2026-08")

        first = self._day(payload, "2026-08-06")
        second = self._day(payload, "2026-08-13")
        self.assertEqual(first["week_to_date"], 40.00)
        self.assertEqual(second["week_to_date"], 60.00)   # new week, restarted
        self.assertEqual(second["month_to_date"], 100.00)  # month keeps running

    def test_month_to_date_ignores_adjacent_month_days(self):
        # Aug 2026 starts on a Saturday, so the first Monday-based week of the
        # ledger opens Jul 27 — those days must not feed month-to-date.
        self._pay("2026-07-30", "SPYI", 500.00)
        self._pay("2026-08-01", "QQQI", 10.00)
        payload = self._ledger(month="2026-08")

        july = self._day(payload, "2026-07-30")
        self.assertFalse(july["in_month"])
        self.assertIsNone(july["month_to_date"])
        self.assertEqual(july["week_to_date"], 500.00)

        august = self._day(payload, "2026-08-01")
        self.assertTrue(august["in_month"])
        self.assertEqual(august["month_to_date"], 10.00)
        # The straddling week still reports its true seven-day total.
        self.assertEqual(august["week_to_date"], 510.00)
        self.assertEqual(payload["month_summary"]["total"], 10.00)

    def test_week_rollup_spans_month_boundary(self):
        self._pay("2026-07-30", "SPYI", 500.00)
        self._pay("2026-08-01", "QQQI", 10.00)
        payload = self._ledger(month="2026-08")

        straddler = next(w for w in payload["weeks"] if w["start"] == "2026-07-27")
        self.assertEqual(straddler["total"], 510.00)
        self.assertEqual(straddler["in_month_total"], 10.00)
        self.assertTrue(straddler["spans_prior_month"])
        self.assertEqual(straddler["days_in_month"], 2)  # Aug 1 and 2

    def test_sunday_week_start_shifts_the_boundary(self):
        self._pay("2026-08-02", "SPYI", 30.00)  # Sunday
        self._pay("2026-08-03", "QQQI", 70.00)  # Monday

        monday_weeks = self._ledger(month="2026-08", week_start="mon")
        sunday_weeks = self._ledger(month="2026-08", week_start="sun")

        # Monday-based: Aug 2 closes the prior week, Aug 3 opens a new one.
        self.assertEqual(self._day(monday_weeks, "2026-08-03")["week_to_date"], 70.00)
        # Sunday-based: both land in the same week.
        self.assertEqual(self._day(sunday_weeks, "2026-08-03")["week_to_date"], 100.00)

    # ── estimates ────────────────────────────────────────────────────────────

    def test_estimates_are_split_out_and_can_be_excluded(self):
        self._pay("2026-08-06", "SPYI", 80.00)
        self._pay("2026-08-06", "CHPY", 20.00, source="refresh_estimate")

        included = self._ledger(month="2026-08")
        day = self._day(included, "2026-08-06")
        self.assertEqual(day["total"], 100.00)
        self.assertEqual(day["actual"], 80.00)
        self.assertEqual(day["estimated"], 20.00)

        excluded = self._ledger(month="2026-08", include_estimates=False)
        day = self._day(excluded, "2026-08-06")
        self.assertEqual(day["total"], 80.00)
        self.assertEqual(day["estimated"], 0.0)
        self.assertEqual(excluded["month_summary"]["total"], 80.00)

    def test_estimated_only_ticker_is_flagged(self):
        rows = group_by_ticker([
            {"ticker": "CHPY", "amount": 20.0, "estimated": True, "source": "refresh_estimate",
             "notes": "", "account": "Owner", "profile_id": 1},
        ])
        self.assertTrue(rows[0]["estimated_only"])

    # ── live day / week / month / year figures ───────────────────────────────

    def test_now_totals_track_today_this_week_this_month(self):
        self._pay("2026-08-07", "SPYI", 12.00)   # today, Friday
        self._pay("2026-08-03", "QQQI", 30.00)   # Monday of this week
        self._pay("2026-08-01", "IWMI", 7.00)    # earlier this month, prior week
        self._pay("2026-03-02", "IYRI", 500.00)  # earlier this year
        self._pay("2025-08-04", "IYRI", 1000.00)  # last year, before the cutoff

        now = self._ledger(month="2026-08")["now"]
        self.assertEqual(now["day"]["total"], 12.00)
        self.assertEqual(now["week"]["total"], 42.00)
        self.assertEqual(now["week"]["start"], "2026-08-03")
        self.assertEqual(now["week"]["days_elapsed"], 5)
        self.assertEqual(now["month"]["total"], 49.00)
        self.assertEqual(now["year"]["total"], 549.00)
        self.assertEqual(now["year"]["prior_to_same_day"], 1000.00)

    def test_now_ignores_future_dated_payments(self):
        self._pay("2026-08-07", "SPYI", 12.00)
        self._pay("2026-08-10", "SPYI", 99.00)  # next week, already recorded
        now = self._ledger(month="2026-08")["now"]
        self.assertEqual(now["day"]["total"], 12.00)
        self.assertEqual(now["month"]["total"], 12.00)

    def test_last_paid_reports_the_most_recent_earlier_day(self):
        self._pay("2026-08-04", "SPYI", 55.00)
        now = self._ledger(month="2026-08")["now"]
        self.assertEqual(now["day"]["total"], 0.0)
        self.assertEqual(now["last_paid"]["date"], "2026-08-04")
        self.assertEqual(now["last_paid"]["total"], 55.00)
        self.assertEqual(now["last_paid"]["days_ago"], 3)

    # ── month summary ────────────────────────────────────────────────────────

    def test_prior_month_compares_the_same_slice_of_days(self):
        self._pay("2026-08-03", "SPYI", 100.00)
        self._pay("2026-07-02", "SPYI", 40.00)   # within the first 7 days
        self._pay("2026-07-28", "SPYI", 900.00)  # after the cutoff
        summary = self._ledger(month="2026-08")["month_summary"]

        self.assertEqual(summary["total"], 100.00)
        self.assertEqual(summary["prior_month"]["total"], 940.00)
        self.assertEqual(summary["prior_month"]["to_same_day"], 40.00)
        self.assertEqual(summary["prior_month"]["through"], "2026-07-07")
        self.assertEqual(summary["vs_prior_pct"], 150.0)

    def test_completed_month_compares_whole_months(self):
        self._pay("2026-06-15", "SPYI", 200.00)
        # May 31 has no counterpart in a 30-day June, but both months are over,
        # so the comparison is full month vs full month and it must still count.
        self._pay("2026-05-31", "SPYI", 100.00)
        summary = self._ledger(month="2026-06")["month_summary"]
        self.assertTrue(summary["is_complete"])
        self.assertEqual(summary["days_elapsed"], 30)
        self.assertEqual(summary["prior_month"]["basis"], "full month")
        self.assertEqual(summary["prior_month"]["through"], "2026-05-31")
        self.assertEqual(summary["prior_month"]["to_same_day"], 100.00)
        self.assertEqual(summary["vs_prior_pct"], 100.0)

    def test_running_month_clamps_the_slice_when_the_prior_month_is_shorter(self):
        # Day 31 of a 31-day month against a 30-day prior month: the slice has
        # to clamp instead of running past the prior month's end.
        self._pay("2026-04-30", "SPYI", 50.00)
        summary = self._ledger(month="2026-05", today=datetime.date(2026, 5, 31))["month_summary"]
        self.assertEqual(summary["prior_month"]["basis"], "same days")
        self.assertEqual(summary["prior_month"]["through"], "2026-04-30")
        self.assertEqual(summary["prior_month"]["to_same_day"], 50.00)

    def test_month_summary_best_day_and_averages(self):
        self._pay("2026-08-03", "SPYI", 100.00)
        self._pay("2026-08-06", "QQQI", 300.00)
        summary = self._ledger(month="2026-08")["month_summary"]
        self.assertEqual(summary["best_day"]["date"], "2026-08-06")
        self.assertEqual(summary["best_day"]["total"], 300.00)
        self.assertEqual(summary["paid_days"], 2)
        self.assertEqual(summary["avg_per_paid_day"], 200.00)

    def test_empty_month_is_all_zeros_not_an_error(self):
        payload = self._ledger(month="2026-08")
        self.assertEqual(payload["month_summary"]["total"], 0.0)
        self.assertIsNone(payload["month_summary"]["best_day"])
        self.assertIsNone(payload["month_summary"]["vs_prior_pct"])
        self.assertEqual(payload["now"]["day"]["total"], 0.0)
        self.assertIsNone(payload["now"]["last_paid"])
        self.assertTrue(all(d["total"] == 0.0 for d in payload["days"]))

    # ── multi-account rollup ─────────────────────────────────────────────────

    def test_same_ticker_across_accounts_collapses_to_one_row(self):
        self._pay("2026-08-06", "SPYI", 40.00, profile_id=1)
        self._pay("2026-08-06", "SPYI", 60.00, profile_id=2)
        payload = self._ledger(month="2026-08", profile_ids=[1, 2])
        day = self._day(payload, "2026-08-06")

        self.assertEqual(day["total"], 100.00)
        self.assertEqual(day["ticker_count"], 1)
        self.assertEqual(day["payment_count"], 2)
        self.assertEqual(len(day["payments"]), 1)
        self.assertEqual(day["payments"][0]["amount"], 100.00)
        self.assertEqual(
            sorted(a["account"] for a in day["payments"][0]["accounts"]),
            ["Owner", "Roth"],
        )

    def test_other_profiles_are_excluded(self):
        self._pay("2026-08-06", "SPYI", 40.00, profile_id=1)
        self._pay("2026-08-06", "QQQI", 60.00, profile_id=2)
        payload = self._ledger(month="2026-08", profile_ids=[1])
        self.assertEqual(self._day(payload, "2026-08-06")["total"], 40.00)

    def test_scope_names_every_account_being_summed(self):
        payload = self._ledger(month="2026-08", profile_ids=[1, 2])
        self.assertTrue(payload["scope"]["multi_account"])
        self.assertEqual(payload["scope"]["profile_ids"], [1, 2])
        self.assertEqual(
            [a["account"] for a in payload["scope"]["accounts"]], ["Owner", "Roth"]
        )

        single = self._ledger(month="2026-08", profile_ids=[2])
        self.assertFalse(single["scope"]["multi_account"])

    def test_month_splits_the_total_back_out_per_account(self):
        self._pay("2026-08-03", "SPYI", 40.00, profile_id=1)
        self._pay("2026-08-06", "QQQI", 60.00, profile_id=2)
        self._pay("2026-08-06", "CHPY", 10.00, profile_id=2, source="refresh_estimate")
        summary = self._ledger(month="2026-08", profile_ids=[1, 2])["month_summary"]

        self.assertEqual(summary["total"], 110.00)
        by_account = {a["account"]: a for a in summary["by_account"]}
        self.assertEqual(by_account["Roth"]["total"], 70.00)
        self.assertEqual(by_account["Roth"]["estimated"], 10.00)
        self.assertEqual(by_account["Owner"]["total"], 40.00)
        self.assertEqual(by_account["Owner"]["paid_days"], 1)
        # The parts have to add back up to the roll-up they came from.
        self.assertEqual(
            round(sum(a["total"] for a in summary["by_account"]), 2), summary["total"]
        )

    def test_account_with_no_payments_still_gets_a_row(self):
        self._pay("2026-08-03", "SPYI", 40.00, profile_id=1)
        summary = self._ledger(month="2026-08", profile_ids=[1, 2])["month_summary"]
        quiet = next(a for a in summary["by_account"] if a["account"] == "Roth")
        self.assertEqual(quiet["total"], 0.0)
        self.assertEqual(quiet["paid_days"], 0)

    def test_prior_month_payments_stay_out_of_the_account_split(self):
        self._pay("2026-07-30", "SPYI", 500.00, profile_id=2)
        self._pay("2026-08-03", "SPYI", 40.00, profile_id=1)
        summary = self._ledger(month="2026-08", profile_ids=[1, 2])["month_summary"]
        by_account = {a["account"]: a["total"] for a in summary["by_account"]}
        self.assertEqual(by_account["Roth"], 0.0)  # Jul 30 is in the window, not the month
        self.assertEqual(by_account["Owner"], 40.00)

    # ── Owner roll-up ────────────────────────────────────────────────────────

    def _link_to_owner(self, *profile_ids):
        conn = self._connect()
        for pid in profile_ids:
            conn.execute("UPDATE profiles SET include_in_owner = 1 WHERE id = ?", (pid,))
        conn.commit()
        conn.close()

    def test_owner_sums_the_accounts_linked_to_it(self):
        # Payments are only ever written against the account that received
        # them, so Owner reading profile 1 literally would report nothing.
        conn = self._connect()
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (3, 'Taxable')")
        conn.commit()
        conn.close()
        self._link_to_owner(2, 3)
        self._pay("2026-08-06", "SPYI", 40.00, profile_id=2)
        self._pay("2026-08-06", "QQQI", 60.00, profile_id=3)

        res = self.client.get("/api/dividend-ledger?profile_id=1&month=2026-08")
        payload = res.get_json()
        day = next(d for d in payload["days"] if d["date"] == "2026-08-06")
        self.assertEqual(day["total"], 100.00)
        self.assertEqual(payload["month_summary"]["total"], 100.00)
        self.assertEqual(
            sorted(a["account"] for a in payload["scope"]["accounts"]),
            ["Roth", "Taxable"],
        )
        self.assertTrue(payload["scope"]["multi_account"])

    def test_owner_with_no_linked_accounts_reads_its_own_payments(self):
        self._pay("2026-08-06", "SPYI", 40.00, profile_id=1)
        payload = self.client.get("/api/dividend-ledger?profile_id=1&month=2026-08").get_json()
        self.assertEqual(payload["month_summary"]["total"], 40.00)
        self.assertFalse(payload["scope"]["multi_account"])

    def test_aggregate_sums_its_member_accounts(self):
        conn = self._connect()
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (3, 'Taxable')")
        conn.execute("INSERT INTO aggregates (id, name) VALUES (5, 'Combined')")
        conn.executemany(
            "INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (?, ?)",
            [(5, 2), (5, 3)],
        )
        conn.commit()
        conn.close()
        self._pay("2026-08-06", "SPYI", 40.00, profile_id=2)
        self._pay("2026-08-06", "QQQI", 60.00, profile_id=3)
        self._pay("2026-08-06", "IWMI", 99.00, profile_id=1)  # not a member

        payload = self.client.get(
            "/api/dividend-ledger?aggregate_id=5&month=2026-08"
        ).get_json()
        self.assertEqual(payload["month_summary"]["total"], 100.00)
        self.assertEqual(payload["scope"]["profile_ids"], [2, 3])

    def test_a_single_account_is_unaffected_by_owner_linking(self):
        self._link_to_owner(2)
        self._pay("2026-08-06", "SPYI", 40.00, profile_id=1)
        self._pay("2026-08-06", "QQQI", 60.00, profile_id=2)
        payload = self.client.get("/api/dividend-ledger?profile_id=2&month=2026-08").get_json()
        self.assertEqual(payload["month_summary"]["total"], 60.00)
        self.assertEqual(payload["scope"]["profile_ids"], [2])

    # ── endpoint ─────────────────────────────────────────────────────────────

    def test_endpoint_returns_the_ledger(self):
        self._pay("2026-08-06", "SPYI", 40.00)
        res = self.client.get("/api/dividend-ledger?profile_id=1&month=2026-08")
        self.assertEqual(res.status_code, 200)
        payload = res.get_json()
        self.assertEqual(payload["month"], "2026-08")
        self.assertEqual(payload["week_start"], "mon")
        self.assertTrue(payload["include_estimates"])
        self.assertIn("2026-08", payload["months_available"])
        self.assertEqual(
            next(d for d in payload["days"] if d["date"] == "2026-08-06")["total"], 40.00
        )

    def test_endpoint_honors_week_start_and_estimate_flags(self):
        self._pay("2026-08-06", "CHPY", 20.00, source="refresh_estimate")
        res = self.client.get(
            "/api/dividend-ledger?profile_id=1&month=2026-08&week_start=sun&include_estimates=0"
        )
        payload = res.get_json()
        self.assertEqual(payload["week_start"], "sun")
        self.assertFalse(payload["include_estimates"])
        self.assertEqual(payload["month_summary"]["total"], 0.0)
        self.assertEqual(payload["months_available"], [])

    def test_endpoint_defaults_to_the_current_month(self):
        res = self.client.get("/api/dividend-ledger?profile_id=1")
        payload = res.get_json()
        today = datetime.date.today()
        self.assertEqual(payload["month"], f"{today.year:04d}-{today.month:02d}")

    def test_endpoint_survives_a_junk_month(self):
        res = self.client.get("/api/dividend-ledger?profile_id=1&month=not-a-month")
        self.assertEqual(res.status_code, 200)
        today = datetime.date.today()
        self.assertEqual(res.get_json()["month"], f"{today.year:04d}-{today.month:02d}")

    def test_fidelity_reimport_fills_in_cap_gain_and_roc_on_same_day(self):
        # Calendar showed GDXW $2,315.81; the ledger kept only the ordinary
        # DIVIDEND RECEIVED line from an earlier Fidelity import.
        self._pay(
            "2026-08-25", "GDXW", 1519.25,
            profile_id=2, source="fidelity_transactions",
        )
        content = "\n".join([
            "Run Date,Account,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Amount ($)",
            '08/25/2026,ROTH IRA,DIVIDEND RECEIVED as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,1519.25',
            '08/25/2026,ROTH IRA,LONG-TERM CAP GAIN as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,500.00',
            '08/25/2026,ROTH IRA,SHORT-TERM CAP GAIN as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,200.00',
            '08/25/2026,ROTH IRA,RETURN OF CAPITAL as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,96.56',
        ])
        orig_income = app_module.populate_income_tracking
        orig_snapshot = app_module._snapshot_nav_after_profile_update
        app_module.populate_income_tracking = lambda profile_id: None
        app_module._snapshot_nav_after_profile_update = lambda *a, **k: None
        try:
            res = self.client.post(
                "/api/import/transactions?profile_id=2",
                data={
                    "format": "fidelity_transactions",
                    "file": (io.BytesIO(content.encode()), "History.csv"),
                },
                content_type="multipart/form-data",
            )
        finally:
            app_module.populate_income_tracking = orig_income
            app_module._snapshot_nav_after_profile_update = orig_snapshot

        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT amount, notes FROM dividend_payments "
                "WHERE ticker = 'GDXW' AND profile_id = 2 AND payment_date = '2026-08-25'"
            ).fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(row)
        self.assertAlmostEqual(row["amount"], 2315.81, places=2)
        payload = self._ledger(
            profile_ids=[2], month="2026-08", today=datetime.date(2026, 8, 27),
        )
        day = self._day(payload, "2026-08-25")
        self.assertAlmostEqual(day["total"], 2315.81, places=2)
        self.assertEqual(day["payments"][0]["ticker"], "GDXW")
        self.assertAlmostEqual(day["payments"][0]["amount"], 2315.81, places=2)

    def _holding(self, ticker, quantity, div, profile_id=1):
        conn = self._connect()
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, description, quantity, current_price,
                current_value, div, div_frequency, estim_payment_per_year)
               VALUES (?, ?, ?, ?, 50, ?, ?, 'M', ?)""",
            (
                ticker, profile_id, f"{ticker} fund", quantity,
                quantity * 50, div, quantity * div * 12,
            ),
        )
        conn.commit()
        conn.close()

    def test_ledger_matches_calendar_declared_cash_without_the_other_holding(self):
        # One Fidelity account imported $1,519.25. The calendar still shows
        # $2,315.81 because remaining shares × DPS already cover both accounts'
        # payout — even if the second account no longer has a GDXW lot.
        self._pay("2026-08-25", "GDXW", 1519.25, source="fidelity_transactions")
        self._holding("GDXW", 100, 23.1581)
        payload = self._ledger(month="2026-08", today=datetime.date(2026, 8, 27))
        day = self._day(payload, "2026-08-25")
        self.assertAlmostEqual(day["total"], 2315.81, places=2)
        self.assertAlmostEqual(day["payments"][0]["amount"], 2315.81, places=2)

    def test_ledger_does_not_stack_declared_floor_on_top_of_both_accounts(self):
        self._pay("2026-08-25", "GDXW", 1519.25, profile_id=1, source="fidelity_transactions")
        self._pay("2026-08-25", "GDXW", 796.56, profile_id=2, source="fidelity_transactions")
        self._holding("GDXW", 100, 23.1581, profile_id=1)
        payload = self._ledger(
            profile_ids=[1, 2], month="2026-08", today=datetime.date(2026, 8, 27),
        )
        day = self._day(payload, "2026-08-25")
        self.assertAlmostEqual(day["total"], 2315.81, places=2)

    def test_closed_position_cash_still_shows_without_a_holding(self):
        self._pay("2026-08-25", "GDXW", 796.56, profile_id=2, source="fidelity_transactions")
        payload = self._ledger(
            profile_ids=[2], month="2026-08", today=datetime.date(2026, 8, 27),
        )
        day = self._day(payload, "2026-08-25")
        self.assertAlmostEqual(day["total"], 796.56, places=2)

    def test_second_fidelity_account_same_day_import_adds_without_a_holding(self):
        first = "\n".join([
            "Run Date,Account,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Amount ($)",
            '08/25/2026,ROTH IRA,DIVIDEND RECEIVED as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,1519.25',
        ])
        second = "\n".join([
            "Run Date,Account,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Amount ($)",
            '08/25/2026,INDIVIDUAL,DIVIDEND RECEIVED as of 08/25/2026,GDXW,ROUNDHILL ETF TRUST,Cash,,,0,0,796.56',
        ])
        orig_income = app_module.populate_income_tracking
        orig_snapshot = app_module._snapshot_nav_after_profile_update
        app_module.populate_income_tracking = lambda profile_id: None
        app_module._snapshot_nav_after_profile_update = lambda *a, **k: None
        try:
            for content, name in ((first, "Roth.csv"), (second, "Individual.csv")):
                res = self.client.post(
                    "/api/import/transactions?profile_id=2",
                    data={
                        "format": "fidelity_transactions",
                        "file": (io.BytesIO(content.encode()), name),
                    },
                    content_type="multipart/form-data",
                )
                self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        finally:
            app_module.populate_income_tracking = orig_income
            app_module._snapshot_nav_after_profile_update = orig_snapshot

        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT amount, notes FROM dividend_payments "
                "WHERE ticker = 'GDXW' AND profile_id = 2 AND payment_date = '2026-08-25'"
            ).fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(row)
        self.assertAlmostEqual(row["amount"], 2315.81, places=2)
        self.assertIn("[acct:ROTH IRA]", row["notes"] or "")
        self.assertIn("[acct:INDIVIDUAL]", row["notes"] or "")
        payload = self._ledger(
            profile_ids=[2], month="2026-08", today=datetime.date(2026, 8, 27),
        )
        day = self._day(payload, "2026-08-25")
        self.assertAlmostEqual(day["total"], 2315.81, places=2)


if __name__ == "__main__":
    unittest.main()
