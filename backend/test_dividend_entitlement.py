"""A distribution is only paid on shares held before its ex-date.

DX went ex-dividend on 9/21 and pays on 9/30. An account that bought its shares
on 9/29 was still shown a 9/30 payment, because the calendar priced every event
off today's share count. These tests pin the cut-off the same way
``_holding_eligible_for_current_dividend`` applies it to ``dividend_paid``: a
share bought on or after the ex-date is not owed that distribution.
"""
import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database

TODAY = datetime.date.today()


def days(offset):
    return TODAY + datetime.timedelta(days=offset)


def iso(offset):
    return days(offset).isoformat()


def lot(quantity, purchase_offset=None, flows=()):
    return {
        "quantity": quantity,
        "purchase_date": iso(purchase_offset) if purchase_offset is not None else None,
        "flows": [(iso(offset), delta) for offset, delta in flows],
    }


class EntitledQuantityTest(unittest.TestCase):
    def held(self, lots, ex_offset):
        return app_module._entitled_quantity_at_ex_date(lots, iso(ex_offset), TODAY)

    def test_shares_bought_after_the_ex_date_are_not_entitled(self):
        # DX: ex-dividend 8 days ago, all shares bought today.
        self.assertEqual(self.held([lot(67, 0, [(0, 67)])], -8), 0.0)

    def test_buying_on_the_ex_date_is_too_late(self):
        self.assertEqual(self.held([lot(50, -3, [(-3, 50)])], -3), 0.0)

    def test_buying_the_day_before_the_ex_date_qualifies(self):
        self.assertEqual(self.held([lot(50, -4, [(-4, 50)])], -3), 50.0)

    def test_adding_to_an_older_position_counts_only_the_old_shares(self):
        # purchase_date is the earliest open lot, so it alone would call all
        # 150 shares eligible; the ledger shows 50 arrived after the ex-date.
        lots = [lot(150, -200, [(-200, 100), (0, 50)])]
        self.assertEqual(self.held(lots, -8), 100.0)

    def test_accounts_are_judged_separately_and_summed(self):
        lots = [lot(100, -30), lot(67, 0, [(0, 67)])]
        self.assertEqual(self.held(lots, -8), 100.0)

    def test_a_sale_after_the_ex_date_never_raises_the_count_above_holdings(self):
        # Sold down to 50 after the ex-date. Crediting the sold shares back
        # would rest on a ledger that may be newer than the position snapshot.
        self.assertEqual(self.held([lot(50, -200, [(-1, -50)])], -8), 50.0)

    def test_a_future_ex_date_is_open_to_everything_held_now(self):
        self.assertEqual(self.held([lot(67, 0, [(0, 67)])], 21), 67.0)

    def test_nothing_known_leaves_the_caller_alone(self):
        self.assertIsNone(self.held([], -8))
        self.assertIsNone(self.held(None, -8))
        self.assertIsNone(app_module._entitled_quantity_at_ex_date([lot(5)], None, TODAY))


class ApplyEntitlementToEventTest(unittest.TestCase):
    @staticmethod
    def _event(quantity, ex_offset=-8):
        return {
            "ticker": "DX", "date": iso(ex_offset), "quantity": quantity,
            "amount": 0.17, "payment_income": round(0.17 * quantity, 2),
            "annual_income": round(0.17 * quantity * 12, 2),
        }

    def apply(self, event, lots):
        return app_module._apply_ex_date_entitlement(event, lots, TODAY)

    def test_fully_entitled_event_is_returned_untouched(self):
        event = self._event(100)
        self.assertIs(self.apply(event, [lot(100, -60)]), event)

    def test_partly_entitled_event_is_scaled_to_the_qualifying_shares(self):
        adjusted = self.apply(self._event(150), [lot(150, -200, [(0, 50)])])
        self.assertEqual(adjusted["entitled_quantity"], 100.0)
        self.assertEqual(adjusted["payment_income"], 17.0)
        self.assertEqual(adjusted["annual_income"], round(0.17 * 150 * 12, 2))

    def test_event_nobody_qualifies_for_is_dropped(self):
        self.assertIsNone(self.apply(self._event(67), [lot(67, 0, [(0, 67)])]))

    def test_no_ledger_information_keeps_the_event(self):
        event = self._event(67)
        self.assertIs(self.apply(event, None), event)


class DividendEntitlementCalendarTest(unittest.TestCase):
    """DX-shaped scenario: ex 8 days ago, Yahoo says it pays tomorrow."""

    TICKER = "DX"

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._connect()
        database.ensure_tables_exist(conn)
        conn.executemany(
            "INSERT INTO profiles (id, name, include_in_owner) VALUES (?, ?, 0)",
            [(2, "New buyer"), (3, "Adds to old"), (4, "Long held")],
        )
        # 67 shares, all bought today: the account in the report.
        self._holding(conn, 2, 67, purchase_offset=0)
        self._txn(conn, 2, 0, 67, "BUY")
        # 150 shares: 100 from months ago plus 50 bought today.
        self._holding(conn, 3, 150, purchase_offset=-200)
        self._txn(conn, 3, -200, 100, "BUY")
        self._txn(conn, 3, 0, 50, "BUY")
        # 100 shares held since well before the ex-date.
        self._holding(conn, 4, 100, purchase_offset=-200)
        self._txn(conn, 4, -200, 100, "BUY")
        conn.commit()
        conn.close()
        app_module._clear_dividend_event_caches()

    def tearDown(self):
        app_module._clear_dividend_event_caches()
        Path(self.db_path).unlink(missing_ok=True)

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _holding(self, conn, profile_id, quantity, purchase_offset):
        conn.execute(
            """INSERT INTO all_account_info
               (ticker, profile_id, description, quantity, current_price,
                current_value, div, div_frequency, ex_div_date, div_pay_date,
                purchase_date, estim_payment_per_year, approx_monthly_income)
               VALUES (?, ?, 'DYNEX CAP INC REIT', ?, 11.39, ?, 0.17, 'M',
                       ?, ?, ?, ?, ?)""",
            (
                self.TICKER, profile_id, quantity, quantity * 11.39,
                days(-8).strftime("%m/%d/%y"),
                # The stored pay date is only ex-date plus a default lag.
                days(-1).strftime("%m/%d/%y"),
                iso(purchase_offset),
                quantity * 0.17 * 12, quantity * 0.17,
            ),
        )

    def _txn(self, conn, profile_id, offset, shares, kind):
        conn.execute(
            """INSERT INTO transactions
               (ticker, profile_id, transaction_date, shares, price_per_share,
                transaction_type)
               VALUES (?, ?, ?, ?, 11.39, ?)""",
            (self.TICKER, profile_id, iso(offset), shares, kind),
        )

    def _view(self, profile_id, official=None):
        """(holdings, DX events) for one account, issuer feed and Yahoo mocked."""
        app_module._clear_dividend_event_caches()
        conn = self._connect()
        try:
            holdings = app_module._dividend_calendar_holdings_for_view(
                conn, False, [profile_id]
            )
        finally:
            conn.close()
        with patch.object(app_module, "get_connection", self._connect), \
             patch.object(app_module, "_fetch_official_distribution_snapshot", return_value=official), \
             patch.object(app_module, "_yf_div_pay_date", return_value=days(1)):
            events = app_module._build_cal_events(holdings, False, [profile_id])
        return holdings, [e for e in events if e["ticker"] == self.TICKER]

    def test_lots_carry_the_ledger_and_ignore_future_dated_rows(self):
        conn = self._connect()
        self._txn(conn, 4, 60, 500, "BUY")  # a typo'd future date
        conn.commit()
        conn.close()
        holdings, _ = self._view(4)
        lots = holdings[0]["entitlement_lots"]
        self.assertEqual(len(lots), 1)
        self.assertEqual(lots[0]["quantity"], 100.0)
        self.assertEqual([delta for _, delta in lots[0]["flows"]], [100.0])

    def test_account_that_bought_after_the_ex_date_is_not_told_it_is_paid(self):
        _, events = self._view(2)
        self.assertEqual(len(events), 1)
        event = events[0]
        # Rolled to the next cycle rather than showing the one it missed.
        self.assertGreater(event["date"], TODAY.isoformat())
        self.assertNotEqual(event["pay_date"], iso(1))
        self.assertGreater(event["pay_date"], event["date"])
        # Yahoo's date belonged to the missed cycle, so this one is a projection.
        self.assertTrue(event["pay_estimated"])
        self.assertTrue(event["entitlement_rolled"])
        self.assertEqual(event["payment_income"], round(0.17 * 67, 2))

    def test_account_that_held_before_the_ex_date_keeps_the_confirmed_date(self):
        _, events = self._view(4)
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["date"], iso(-8))
        self.assertEqual(event["pay_date"], iso(1))
        self.assertFalse(event["pay_estimated"])
        self.assertEqual(event["payment_income"], 17.0)
        self.assertNotIn("entitled_quantity", event)

    def test_account_that_added_shares_is_paid_only_on_the_old_ones(self):
        _, events = self._view(3)
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event["date"], iso(-8))
        self.assertEqual(event["pay_date"], iso(1))
        self.assertEqual(event["entitled_quantity"], 100.0)
        self.assertEqual(event["payment_income"], 17.0)

    def test_month_view_agrees_with_the_calendar(self):
        pay_month = days(1).strftime("%Y-%m")

        holdings, events = self._view(2)
        month = [
            p for p in app_module._project_dividend_payments_for_month(
                holdings, events, pay_month
            ) if p["ticker"] == self.TICKER
        ]
        self.assertNotIn(iso(1), [p["calendar_pay_date"] for p in month])

        holdings, events = self._view(3)
        month = [
            p for p in app_module._project_dividend_payments_for_month(
                holdings, events, pay_month
            ) if p["ticker"] == self.TICKER
        ]
        self.assertEqual([p["calendar_pay_date"] for p in month], [iso(1)])
        self.assertEqual(month[0]["payment_income"], 17.0)

        holdings, events = self._view(4)
        month = [
            p for p in app_module._project_dividend_payments_for_month(
                holdings, events, pay_month
            ) if p["ticker"] == self.TICKER
        ]
        self.assertEqual([p["calendar_pay_date"] for p in month], [iso(1)])
        self.assertEqual(month[0]["payment_income"], 17.0)

    def test_rolled_projection_is_not_written_back_to_shared_holdings(self):
        # Blank dates are filled from the calendar for every account holding the
        # ticker. One account's roll past a missed cycle must not leak into the
        # rows of accounts that were owed it.
        official = {"ex_div_date": iso(-8), "div_pay_date": iso(1)}
        conn = self._connect()
        conn.execute(
            "UPDATE all_account_info SET ex_div_date = NULL, div_pay_date = NULL "
            "WHERE profile_id = 2"
        )
        conn.commit()
        conn.close()

        def stored_dates():
            conn = self._connect()
            try:
                return conn.execute(
                    "SELECT ex_div_date, div_pay_date FROM all_account_info "
                    "WHERE profile_id = 2"
                ).fetchone()
            finally:
                conn.close()

        _, events = self._view(2, official)
        self.assertTrue(events[0]["entitlement_rolled"])
        row = stored_dates()
        self.assertFalse((row["ex_div_date"] or "").strip())
        self.assertFalse((row["div_pay_date"] or "").strip())

        # Control: an account that was owed the cycle does fill the blanks.
        self._view(4, official)
        row = stored_dates()
        self.assertEqual(row["ex_div_date"], days(-8).strftime("%m/%d/%y"))


if __name__ == "__main__":
    unittest.main()
