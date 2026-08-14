"""Ex-div and pay dates typed on the holdings screen have to stick.

Both columns were rewritten unconditionally by the market refresh, and the
dividend calendar re-derived them from the issuer feed on top of that, so a
looked-up schedule was overwritten in two independent places. They are pinned
now -- until the pay date the user entered has actually passed, at which point
the projected schedule is the better answer again.

Unlike the amount pin next door this one is anchored on a date the user typed
rather than on a projected cycle. Frequency is deliberately not on this clock:
a wrong cadence is permanently wrong, so its lock never expires on its own.
Clearing the frequency field is how it comes off, at which point the refresh
and the calendar go back to predicting the cadence.
"""

import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database as database_module


class ManualDividendDatesWindowTest(unittest.TestCase):
    def test_entered_pay_date_is_the_anchor(self):
        until = app_module._manual_dividend_dates_override_expiry(
            "09/04/26", "09/02/26", "M", today=datetime.date(2026, 8, 10)
        )

        self.assertEqual(until, "2026-09-04")

    def test_pin_survives_between_ex_date_and_pay_date(self):
        # The ex-date is behind us but the distribution has not been paid yet,
        # which is exactly the window the user typed the dates to describe.
        until = app_module._manual_dividend_dates_override_expiry(
            "09/04/26", "09/02/26", "M", today=datetime.date(2026, 9, 3)
        )

        self.assertTrue(
            app_module._manual_dividend_override_active(until, datetime.date(2026, 9, 3))
        )

    def test_pin_lapses_the_day_after_the_pay_date(self):
        until = app_module._manual_dividend_dates_override_expiry(
            "09/04/26", "09/02/26", "M", today=datetime.date(2026, 8, 10)
        )

        self.assertTrue(
            app_module._manual_dividend_override_active(until, datetime.date(2026, 9, 4))
        )
        self.assertFalse(
            app_module._manual_dividend_override_active(until, datetime.date(2026, 9, 5))
        )

    def test_backdated_pay_date_does_not_freeze_the_schedule(self):
        # Correcting a historical record should not pin the upcoming schedule,
        # so a past pay date reads as an already-expired window.
        until = app_module._manual_dividend_dates_override_expiry(
            "01/09/26", "01/07/26", "M", today=datetime.date(2026, 8, 10)
        )

        self.assertFalse(
            app_module._manual_dividend_override_active(until, datetime.date(2026, 8, 10))
        )

    def test_ex_date_only_edit_falls_back_to_the_cadence_window(self):
        until = app_module._manual_dividend_dates_override_expiry(
            None, "09/02/26", "M", today=datetime.date(2026, 8, 10)
        )

        # The amount pin's projection: next ex-date plus a few days' grace.
        self.assertEqual(until, "2026-09-05")

    def test_no_schedule_at_all_falls_back_to_a_fixed_window(self):
        until = app_module._manual_dividend_dates_override_expiry(
            None, None, None, today=datetime.date(2026, 8, 10)
        )

        self.assertEqual(until, "2026-09-24")

    def test_same_date_in_a_different_format_is_not_an_edit(self):
        # The modal renders MM/DD/YY while imports store ISO, and a text compare
        # would read every untouched resubmit as a fresh edit.
        self.assertFalse(app_module._manual_dividend_date_changed("09/02/26", "2026-09-02"))
        self.assertFalse(app_module._manual_dividend_date_changed("09/02/26", "09/02/26"))
        self.assertFalse(app_module._manual_dividend_date_changed(None, None))
        self.assertTrue(app_module._manual_dividend_date_changed("09/02/26", "09/09/26"))
        self.assertTrue(app_module._manual_dividend_date_changed(None, "09/02/26"))


class ManualDividendDatesApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._get_connection()
        try:
            database_module.ensure_tables_exist(conn)
            conn.execute(
                "INSERT INTO profiles (id, name, include_in_owner) VALUES (2, 'Taxable', 0)"
            )
            conn.execute(
                "INSERT INTO profiles (id, name, include_in_owner) VALUES (3, 'IRA', 0)"
            )
            conn.commit()
        finally:
            conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_populate_holdings = app_module.populate_holdings
        self._orig_populate_dividends = app_module.populate_dividends
        self._orig_populate_income_tracking = app_module.populate_income_tracking
        self._orig_testing = app_module.app.testing
        app_module.get_connection = self._get_connection
        app_module.populate_holdings = lambda profile_id: None
        app_module.populate_dividends = lambda profile_id: None
        app_module.populate_income_tracking = lambda profile_id: None
        app_module.app.testing = True
        self.client = app_module.app.test_client()
        app_module._DIVIDEND_CALENDAR_CACHE.clear()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.populate_holdings = self._orig_populate_holdings
        app_module.populate_dividends = self._orig_populate_dividends
        app_module.populate_income_tracking = self._orig_populate_income_tracking
        app_module.app.testing = self._orig_testing
        app_module._DIVIDEND_CALENDAR_CACHE.clear()
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _future(self, days):
        return datetime.date.today() + datetime.timedelta(days=days)

    def _mdy(self, d):
        return d.strftime("%m/%d/%y")

    def _add_holding(self, profile_id, ticker="XQQI", quantity=247.1125,
                     ex_div="07/02/26", pay_date="07/04/26"):
        conn = self._get_connection()
        try:
            conn.execute(
                """INSERT INTO all_account_info
                   (ticker, profile_id, description, quantity, price_paid, current_price,
                    purchase_value, current_value, purchase_date, base_quantity, import_date,
                    div, div_frequency, ex_div_date, div_pay_date, reinvest,
                    estim_payment_per_year, approx_monthly_income)
                   VALUES (?, ?, 'NEOS BOOSTED NASDAQ', ?, 48.665, 49.425,
                           ?, ?, '2026-02-13', ?, '2026-02-13',
                           0.8236, 'M', ?, ?, 'N', ?, ?)""",
                (
                    ticker,
                    profile_id,
                    quantity,
                    quantity * 48.665,
                    quantity * 49.425,
                    quantity,
                    ex_div,
                    pay_date,
                    0.8236 * quantity * 12,
                    0.8236 * quantity,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def _row(self, ticker="XQQI", profile_id=2):
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM all_account_info WHERE ticker = ? AND profile_id = ?",
                (ticker, profile_id),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _pin_dates(self, ex_div, pay_date, profile_id=2):
        return self.client.put(
            f"/api/holdings/XQQI?profile_id={profile_id}",
            json={"ex_div_date": ex_div, "div_pay_date": pay_date},
        )

    def _refresh(self, profile_id=2, close=49.425, official=None):
        """Run the real refresh against a Yahoo response with an older schedule.

        The issuer feed is stubbed out as well as Yahoo. XQQI is a real NEOS
        fund, so leaving it live let the refresh reach neosfunds.com and write
        that fund's genuine upcoming dates -- which happened to match the ones
        under test, and would have made these pass without a pin at all.
        """
        history = pd.DataFrame(
            {"Close": [close, close], "Dividends": [0.0, 0.8236]},
            index=pd.to_datetime(["2026-06-02", "2026-07-02"]),
        )
        with patch.object(app_module, "_chunked_yf_download", return_value=history), \
             patch.object(
                 app_module, "_fetch_official_distribution_snapshot", return_value=official
             ):
            return self.client.post(f"/api/refresh?profile_id={profile_id}")

    def _refresh_with_monthly_history(self, profile_id=2):
        """Refresh against market data that plainly says monthly.

        The dividend snapshot is stubbed rather than the download, because the
        refresh reads cadence straight off yf.Ticker -- left live, XQQI's real
        Yahoo data decides the outcome and the test proves nothing.
        """
        # A full year of them: the refresh reads cadence from the batch
        # download first, and a handful of payments reads as quarterly however
        # they are spaced.
        dates = pd.to_datetime([
            (datetime.date.today().replace(day=2) - datetime.timedelta(days=30 * i))
            for i in range(12, 0, -1)
        ])
        snapshot = {
            "known": True,
            "has_dividend": True,
            "div": 0.8236,
            "ex_div_date": "07/02/26",
            "div_pay_date": "07/04/26",
            "freq": "M",
            "history": pd.Series([0.8236] * 12, index=dates),
        }
        history = pd.DataFrame(
            {"Close": [49.425] * 12, "Dividends": [0.8236] * 12}, index=dates
        )
        with patch.object(app_module, "_chunked_yf_download", return_value=history), \
             patch.object(
                 app_module, "_fetch_refresh_dividend_snapshot", return_value=snapshot
             ), \
             patch.object(
                 app_module, "_fetch_official_distribution_snapshot", return_value=None
             ):
            return self.client.post(f"/api/refresh?profile_id={profile_id}")

    def _calendar(self, profile_id=2, official=None):
        """Build calendar events with the issuer feed under our control."""
        app_module._DIVIDEND_CALENDAR_CACHE.clear()
        with patch.object(app_module, "get_profile_id", return_value=profile_id), \
             patch.object(
                 app_module, "_fetch_official_distribution_snapshot", return_value=official
             ), \
             patch.object(app_module, "_yf_div_pay_date", return_value=None):
            return app_module._build_cal_events()

    def test_edited_dates_are_pinned_to_the_entered_pay_date(self):
        self._add_holding(2)
        ex_div, pay_date = self._mdy(self._future(23)), self._mdy(self._future(25))

        res = self._pin_dates(ex_div, pay_date)

        self.assertEqual(res.status_code, 200)
        row = self._row()
        self.assertEqual(row["ex_div_date"], ex_div)
        self.assertEqual(row["div_pay_date"], pay_date)
        self.assertEqual(
            row["div_dates_manual_until"], self._future(25).isoformat()
        )
        self.assertEqual(
            row["div_dates_manual_set_at"], datetime.date.today().isoformat()
        )

    def test_resubmitting_the_same_dates_does_not_pin_them(self):
        self._add_holding(2)

        res = self.client.put(
            "/api/holdings/XQQI?profile_id=2",
            # The modal resubmits every field it renders, dates included.
            json={"quantity": 250, "ex_div_date": "07/02/26", "div_pay_date": "07/04/26"},
        )

        self.assertEqual(res.status_code, 200)
        self.assertIsNone(self._row()["div_dates_manual_until"])

    def test_edit_applies_to_every_account_holding_the_ticker(self):
        self._add_holding(2)
        self._add_holding(3, quantity=10)
        ex_div, pay_date = self._mdy(self._future(23)), self._mdy(self._future(25))

        self._pin_dates(ex_div, pay_date)

        other = self._row(profile_id=3)
        self.assertEqual(other["ex_div_date"], ex_div)
        self.assertEqual(other["div_pay_date"], pay_date)
        self.assertTrue(
            app_module._manual_dividend_override_active(other["div_dates_manual_until"])
        )

    def test_market_refresh_leaves_pinned_dates_alone(self):
        self._add_holding(2)
        ex_div, pay_date = self._mdy(self._future(23)), self._mdy(self._future(25))
        self._pin_dates(ex_div, pay_date)

        res = self._refresh()

        self.assertEqual(res.status_code, 200)
        row = self._row()
        self.assertEqual(row["ex_div_date"], ex_div)
        self.assertEqual(row["div_pay_date"], pay_date)
        self.assertIsNotNone(row["div_dates_manual_until"])

    def test_refresh_takes_the_schedule_back_once_the_pin_expires(self):
        self._add_holding(2)
        self._pin_dates(self._mdy(self._future(23)), self._mdy(self._future(25)))
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET div_dates_manual_until = ? WHERE ticker = 'XQQI'",
                ((datetime.date.today() - datetime.timedelta(days=1)).isoformat(),),
            )
            conn.commit()
        finally:
            conn.close()

        res = self._refresh()

        self.assertEqual(res.status_code, 200)
        row = self._row()
        self.assertEqual(row["ex_div_date"], "07/02/26")
        # The lapsed pin is cleared rather than left to be re-evaluated forever.
        self.assertIsNone(row["div_dates_manual_until"])

    def test_releasing_the_pin_hands_the_schedule_straight_back(self):
        self._add_holding(2)
        self._pin_dates(self._mdy(self._future(23)), self._mdy(self._future(25)))

        res = self.client.put(
            "/api/holdings/XQQI?profile_id=2", json={"div_dates_manual_clear": True}
        )

        self.assertEqual(res.status_code, 200)
        self.assertIsNone(self._row()["div_dates_manual_until"])

    def test_pinning_dates_does_not_pin_the_amount(self):
        self._add_holding(2)

        self._pin_dates(self._mdy(self._future(23)), self._mdy(self._future(25)))

        self.assertIsNone(self._row()["div_manual_until"])

    def test_frequency_lock_is_not_put_on_the_expiring_clock(self):
        # A wrong cadence is permanently wrong, so its lock has no expiry and
        # must not be released when the date pin lapses.
        self._add_holding(2)
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": "M"})
        self._pin_dates(self._mdy(self._future(23)), self._mdy(self._future(25)))
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET div_dates_manual_until = ? WHERE ticker = 'XQQI'",
                ((datetime.date.today() - datetime.timedelta(days=1)).isoformat(),),
            )
            conn.commit()
        finally:
            conn.close()

        self._refresh()

        self.assertEqual(self._row()["div_frequency_locked"], 1)

    def test_calendar_shows_the_entered_dates_over_the_issuer_feed(self):
        self._add_holding(2)
        ex_div, pay_date = self._mdy(self._future(23)), self._mdy(self._future(25))
        self._pin_dates(ex_div, pay_date)

        events = self._calendar(official={
            "has_dividend": True,
            "freq": "M",
            "div": 0.9,
            "ex_div_date": self._mdy(self._future(9)),
            "div_pay_date": self._mdy(self._future(11)),
            "pay_lag_days": 2,
        })

        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["date"], self._future(23).isoformat())
        self.assertEqual(event["pay_date"], self._future(25).isoformat())
        # A date the user looked up is a fact, not a projection.
        self.assertFalse(event["pay_estimated"])

    def test_calendar_returns_to_the_issuer_feed_once_the_pin_expires(self):
        self._add_holding(2)
        self._pin_dates(self._mdy(self._future(23)), self._mdy(self._future(25)))
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET div_dates_manual_until = ? WHERE ticker = 'XQQI'",
                ((datetime.date.today() - datetime.timedelta(days=1)).isoformat(),),
            )
            conn.commit()
        finally:
            conn.close()

        events = self._calendar(official={
            "has_dividend": True,
            "freq": "M",
            "div": 0.9,
            "ex_div_date": self._mdy(self._future(9)),
            "div_pay_date": self._mdy(self._future(11)),
            "pay_lag_days": 2,
        })

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["date"], self._future(9).isoformat())
        self.assertEqual(events[0]["pay_date"], self._future(11).isoformat())

    def test_calendar_keeps_a_pinned_amount_off_the_issuer_feed(self):
        self._add_holding(2)
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div": 0.95})

        events = self._calendar(official={
            "has_dividend": True,
            "freq": "M",
            "div": 0.8236,
            "ex_div_date": self._mdy(self._future(9)),
            "div_pay_date": self._mdy(self._future(11)),
        })

        self.assertEqual(len(events), 1)
        self.assertAlmostEqual(events[0]["amount"], 0.95, places=4)

    def test_calendar_keeps_a_locked_frequency_off_the_issuer_feed(self):
        self._add_holding(2)
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": "M"})

        events = self._calendar(official={
            "has_dividend": True,
            "freq": "Q",
            "div": 0.8236,
            "ex_div_date": self._mdy(self._future(9)),
            "div_pay_date": self._mdy(self._future(11)),
        })

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["freq"], "M")

    def test_unpinned_holding_still_follows_the_issuer_feed(self):
        # The pin is the exception; without one nothing about the existing
        # behaviour should change.
        self._add_holding(2)

        events = self._calendar(official={
            "has_dividend": True,
            "freq": "M",
            "div": 0.9,
            "ex_div_date": self._mdy(self._future(9)),
            "div_pay_date": self._mdy(self._future(11)),
        })

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["date"], self._future(9).isoformat())
        self.assertAlmostEqual(events[0]["amount"], 0.9, places=4)

    def test_clearing_the_frequency_releases_the_pin(self):
        self._add_holding(2)
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": "A"})
        self.assertEqual(self._row()["div_frequency_locked"], 1)

        res = self.client.put(
            "/api/holdings/XQQI?profile_id=2", json={"div_frequency": ""}
        )

        self.assertEqual(res.status_code, 200)
        self.assertEqual(self._row()["div_frequency_locked"], 0)
        self.assertEqual(self._row()["div_frequency"], "")

    def test_released_frequency_is_predicted_again_by_the_refresh(self):
        self._add_holding(2)
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": "A"})
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": ""})

        self._refresh_with_monthly_history()

        self.assertEqual(self._row()["div_frequency"], "M")

    def test_a_frequency_still_pinned_survives_the_same_refresh(self):
        # The contrast that makes the test above mean something: identical
        # market data, and the only difference is whether the pin was released.
        self._add_holding(2)
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": "A"})

        self._refresh_with_monthly_history()

        self.assertEqual(self._row()["div_frequency"], "A")

    def test_releasing_the_pin_reaches_every_account_holding_the_ticker(self):
        # update_holding writes one row and propagates security-level fields to
        # the rest, so the release has to travel with the cleared value or the
        # other accounts stay pinned to a cadence nobody can see any more.
        self._add_holding(2)
        self._add_holding(3, quantity=100.0)
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": "A"})
        self.assertEqual(self._row(profile_id=3)["div_frequency_locked"], 1)

        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": ""})

        self.assertEqual(self._row(profile_id=3)["div_frequency_locked"], 0)
        self.assertEqual(self._row(profile_id=3)["div_frequency"], "")

    def test_calendar_follows_the_issuer_feed_again_once_the_pin_is_released(self):
        self._add_holding(2)
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": "A"})
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": "Q"})
        self.client.put("/api/holdings/XQQI?profile_id=2", json={"div_frequency": ""})

        events = self._calendar(official={
            "has_dividend": True,
            "freq": "M",
            "div": 0.8236,
            "ex_div_date": self._mdy(self._future(9)),
            "div_pay_date": self._mdy(self._future(11)),
        })

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["freq"], "M")


if __name__ == "__main__":
    unittest.main()
