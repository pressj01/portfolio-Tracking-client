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


class DividendCalendarScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = self._connect()
        database.ensure_tables_exist(conn)
        conn.executemany(
            "INSERT OR REPLACE INTO profiles (id, name, include_in_owner) VALUES (?, ?, ?)",
            [
                (1, "Owner", 0),
                (6, "Broker A", 1),
                (7, "Broker B", 1),
                (12, "Other user", 0),
            ],
        )
        conn.execute("UPDATE profiles SET owner_active = 1 WHERE id = 1")
        self._holding(conn, 1, "AAA", 999)  # duplicated Owner snapshot
        self._holding(conn, 6, "AAA", 10)
        self._holding(conn, 6, "BBB", 20)
        self._holding(conn, 7, "AAA", 5)
        self._holding(conn, 7, "CCC", 30)
        self._holding(conn, 12, "DDD", 40)

        today = datetime.date.today()
        actual_date = (today - datetime.timedelta(days=30)).isoformat()
        estimated_date = (today - datetime.timedelta(days=20)).isoformat()
        future_date = (today + datetime.timedelta(days=1)).isoformat()
        conn.executemany(
            """INSERT OR REPLACE INTO dividend_payments
               (ticker, profile_id, payment_date, amount, source)
               VALUES (?, ?, ?, ?, ?)""",
            [
                ("AAA", 6, actual_date, 1.0, "schwab_transactions"),
                ("AAA", 6, estimated_date, 1.0, "refresh_estimate"),
                ("AAA", 6, future_date, 1.0, "schwab_transactions"),
                ("CCC", 7, actual_date, 1.0, "fidelity"),
                ("DDD", 12, actual_date, 1.0, "etrade_transactions"),
            ],
        )
        conn.commit()
        conn.close()
        self.actual_date = actual_date

    def tearDown(self):
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except OSError:
            pass

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _holding(conn, profile_id, ticker, quantity):
        conn.execute(
            """INSERT OR REPLACE INTO all_account_info
               (ticker, profile_id, description, quantity, current_price,
                current_value, div, div_frequency, estim_payment_per_year)
               VALUES (?, ?, ?, ?, 10, ?, 1, 'M', ?)""",
            (ticker, profile_id, f"{ticker} fund", quantity, quantity * 10, quantity * 12),
        )

    def _rows(self, is_aggregate, profile_ids):
        conn = self._connect()
        try:
            return app_module._dividend_calendar_holdings_for_view(
                conn, is_aggregate, profile_ids
            )
        finally:
            conn.close()

    def test_owner_uses_linked_accounts_without_duplicate_snapshot(self):
        rows = {row["ticker"]: row for row in self._rows(False, [1])}
        self.assertEqual(set(rows), {"AAA", "BBB", "CCC"})
        self.assertEqual(rows["AAA"]["quantity"], 15)
        self.assertEqual(rows["AAA"]["profile_count"], 2)
        self.assertEqual(rows["AAA"]["payment_history"], [self.actual_date])

    def test_individual_account_keeps_its_own_tickers_and_dates(self):
        rows = {row["ticker"]: row for row in self._rows(False, [6])}
        self.assertEqual(set(rows), {"AAA", "BBB"})
        self.assertEqual(rows["AAA"]["quantity"], 10)
        self.assertEqual(rows["AAA"]["payment_history"], [self.actual_date])

    def test_aggregate_unions_only_configured_members(self):
        rows = {row["ticker"]: row for row in self._rows(True, [6, 12])}
        self.assertEqual(set(rows), {"AAA", "BBB", "DDD"})
        self.assertNotIn("CCC", rows)
        self.assertEqual(rows["DDD"]["payment_history"], [self.actual_date])

    def test_analytics_income_calendar_sums_aggregate_accounts(self):
        with patch.object(app_module, "get_connection", self._connect), \
             patch.object(app_module, "get_profile_filter", return_value=(True, [6, 7])):
            response = app_module.app.test_client().post(
                "/api/analytics/income-calendar",
                json={"tickers": ["AAA"]},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["tickers"][0]["amounts"], [15.0] * 12)
        self.assertEqual(payload["monthly_totals"], [15.0] * 12)

    def _pin(self, profile_id, ticker, ex_div_date=None):
        conn = self._connect()
        conn.execute(
            """UPDATE all_account_info
               SET div_frequency = 'SA', div_frequency_locked = 1, ex_div_date = ?
               WHERE ticker = ? AND profile_id = ?""",
            (ex_div_date, ticker, profile_id),
        )
        conn.commit()
        conn.close()

    def test_frequency_pin_survives_a_holding_with_no_ex_div_date(self):
        # The issuer feed can still date the event, so the calendar went on to
        # rebuild the cadence the holdings screen had just overruled.
        self._pin(6, "BBB")

        rows = {row["ticker"]: row for row in self._rows(False, [6])}
        self.assertIsNone(rows["BBB"]["date"])
        self.assertTrue(rows["BBB"]["div_frequency_locked"])

    def test_frequency_pin_is_read_across_rows_not_just_the_dated_one(self):
        # A later import can add an unpinned row for a ticker already pinned by
        # hand. The merged holding takes its ex-div date from that new row, and
        # the pin has to survive being read off a different one.
        self._pin(7, "AAA")
        conn = self._connect()
        conn.execute(
            "UPDATE all_account_info SET ex_div_date = '2026-07-15' "
            "WHERE ticker = 'AAA' AND profile_id = 6"
        )
        conn.commit()
        conn.close()

        rows = {row["ticker"]: row for row in self._rows(False, [1])}
        self.assertEqual(rows["AAA"]["date"], "2026-07-15")
        self.assertTrue(rows["AAA"]["div_frequency_locked"])

    def _add_fzdxx(self, profile_id=6, quantity=10000):
        conn = self._connect()
        conn.execute(
            """INSERT OR REPLACE INTO all_account_info
               (ticker, profile_id, description, quantity, current_price,
                current_value, div, div_frequency, estim_payment_per_year)
               VALUES ('FZDXX', ?, 'FIDELITY TREASURY MONEY MARKET', ?, 1, ?, 0, NULL, 0)""",
            (profile_id, quantity, quantity),
        )
        conn.commit()
        conn.close()

    def test_money_market_without_dates_stays_in_the_holding_universe(self):
        self._add_fzdxx()
        rows = {row["ticker"]: row for row in self._rows(False, [6])}
        self.assertIn("FZDXX", rows)
        self.assertEqual(rows["FZDXX"]["freq"], "M")
        self.assertIsNone(rows["FZDXX"]["date"])

    def test_money_market_without_dates_appears_on_every_calendar_surface(self):
        self._add_fzdxx()
        today = datetime.date.today()
        expected_ex, expected_pay = app_module._money_market_calendar_dates(today)
        app_module._DIVIDEND_CALENDAR_CACHE.clear()

        with patch.object(app_module, "get_connection", self._connect), \
             patch.object(app_module, "_fetch_official_distribution_snapshot", return_value=None), \
             patch.object(app_module, "_yf_div_pay_date", return_value=None), \
             patch.object(app_module, "_money_market_sec_yield", return_value=0.04):
            holdings = self._rows(False, [6])
            events = app_module._build_cal_events(holdings, False, [6])
            payments = app_module._project_dividend_payments_for_month(
                holdings, events, today.strftime("%Y-%m")
            )

        event = next(item for item in events if item["ticker"] == "FZDXX")
        self.assertEqual(event["date"], expected_ex.isoformat())
        self.assertEqual(event["pay_date"], expected_pay.isoformat())
        self.assertEqual(event["freq"], "M")
        self.assertAlmostEqual(event["annual_income"], 400.0, places=2)
        self.assertAlmostEqual(event["payment_income"], 400.0 / 12.0, places=2)
        self.assertTrue(any(item["ticker"] == "FZDXX" for item in payments))
        self.assertFalse(any(item["ticker"] == "BBB" for item in events))

    def test_money_market_blank_dates_and_guessed_cadence_still_appear(self):
        # This is the Fidelity-test-account shape: refresh stored SA from an
        # empty Yahoo history and wrote empty strings instead of NULL dates.
        conn = self._connect()
        conn.execute(
            """INSERT OR REPLACE INTO all_account_info
               (ticker, profile_id, description, quantity, current_price,
                current_value, div, div_frequency, ex_div_date, div_pay_date,
                estim_payment_per_year)
               VALUES ('FZDXX', 6, 'Fidelity Hereford Street Trust - Fidelity Money Market Fund',
                       100, 1, 100, NULL, 'SA', '', '', 0)"""
        )
        conn.commit()
        conn.close()
        app_module._DIVIDEND_CALENDAR_CACHE.clear()

        with patch.object(app_module, "get_connection", self._connect), \
             patch.object(app_module, "_fetch_official_distribution_snapshot", return_value=None), \
             patch.object(app_module, "_yf_div_pay_date", return_value=None), \
             patch.object(app_module, "_money_market_sec_yield", return_value=0.035):
            holdings = self._rows(False, [6])
            events = app_module._build_cal_events(holdings, False, [6])
            payments = app_module._project_dividend_payments_for_month(
                holdings, events, datetime.date.today().strftime("%Y-%m")
            )

        self.assertEqual(next(h["freq"] for h in holdings if h["ticker"] == "FZDXX"), "M")
        event = next(item for item in events if item["ticker"] == "FZDXX")
        self.assertEqual(event["freq"], "M")
        self.assertTrue(event["date"])
        self.assertTrue(any(item["ticker"] == "FZDXX" for item in payments))

    def test_semiannual_default_months_are_march_and_september(self):
        ex_date, pay_date = app_module._frequency_calendar_dates(
            "SA", datetime.date(2026, 8, 14)
        )
        self.assertEqual(ex_date, datetime.date(2026, 9, 30))
        self.assertEqual(pay_date, datetime.date(2026, 9, 30))
        ex_date, pay_date = app_module._frequency_calendar_dates(
            "SA", datetime.date(2026, 10, 1)
        )
        self.assertEqual(ex_date, datetime.date(2027, 3, 31))
        self.assertEqual(pay_date, datetime.date(2027, 3, 31))

    def test_pinned_semiannual_without_dates_appears_in_march_and_september(self):
        # GIF on the Fidelity test account: user pinned SA, Yahoo has no
        # ex-div / calendar / history, so the missing-date check dropped it.
        conn = self._connect()
        conn.execute(
            """INSERT OR REPLACE INTO all_account_info
               (ticker, profile_id, description, quantity, current_price,
                current_value, div, div_frequency, div_frequency_locked,
                ex_div_date, div_pay_date, estim_payment_per_year)
               VALUES ('GIF', 6, 'Rex Growth & Income Universe ETF',
                       100, 22.55, 2255, NULL, 'SA', 1, '', '', 0)"""
        )
        conn.commit()
        conn.close()
        app_module._DIVIDEND_CALENDAR_CACHE.clear()

        with patch.object(app_module, "get_connection", self._connect), \
             patch.object(app_module, "_fetch_official_distribution_snapshot", return_value=None), \
             patch.object(app_module, "_yf_div_pay_date", return_value=None):
            holdings = self._rows(False, [6])
            events = app_module._build_cal_events(holdings, False, [6])
            september = app_module._project_dividend_payments_for_month(
                holdings, events, "2026-09"
            )
            march = app_module._project_dividend_payments_for_month(
                holdings, events, "2026-03"
            )
            august = app_module._project_dividend_payments_for_month(
                holdings, events, "2026-08"
            )

        event = next(item for item in events if item["ticker"] == "GIF")
        self.assertEqual(event["freq"], "SA")
        self.assertIn(event["date"][5:7], ("03", "09"))
        self.assertTrue(any(item["ticker"] == "GIF" for item in september))
        self.assertTrue(any(item["ticker"] == "GIF" for item in march))
        self.assertFalse(any(item["ticker"] == "GIF" for item in august))

    def test_plain_holding_without_dates_is_still_omitted(self):
        app_module._DIVIDEND_CALENDAR_CACHE.clear()
        with patch.object(app_module, "get_connection", self._connect), \
             patch.object(app_module, "_fetch_official_distribution_snapshot", return_value=None), \
             patch.object(app_module, "_yf_div_pay_date", return_value=None):
            events = app_module._build_cal_events(self._rows(False, [6]), False, [6])
        self.assertNotIn("BBB", {item["ticker"] for item in events})


if __name__ == "__main__":
    unittest.main()
