import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module
import database


class DividendPayDatePipelineTest(unittest.TestCase):
    def setUp(self):
        app_module._clear_dividend_event_caches()

    @staticmethod
    def _holding(history=None):
        return {
            "ticker": "PIPE",
            "description": "Pipeline Income Fund",
            "date": "2026-07-27",
            "pay_date": "2026-08-24",
            "amount": 1.0,
            "freq": "Q",
            "quantity": 10.0,
            "current_price": 20.0,
            "current_value": 200.0,
            "annual_income": 40.0,
            "payment_income": 10.0,
            "payment_history": history or [],
        }

    @classmethod
    def _event(cls, confirmed=False):
        event = cls._holding()
        event.update({
            "day": "27",
            "month": "Jul",
            "weekday": "Mon",
            "freq_label": "quarterly",
            "color": "#7ecfff",
            "pay_month": "Aug",
            "pay_day": "24",
            "pay_estimated": not confirmed,
        })
        return event

    def test_no_imported_transactions_preserves_saved_schedule_fallback(self):
        payments = app_module._project_dividend_payments_for_month(
            [self._holding()], [self._event()], "2026-08"
        )
        self.assertEqual(len(payments), 1)
        self.assertEqual(payments[0]["calendar_pay_date"], "2026-08-24")
        self.assertEqual(payments[0]["calendar_source"], "projected")

    def test_actual_import_switches_to_recurring_transaction_pattern(self):
        history = [
            "2025-02-03", "2025-05-05", "2025-08-04",
            "2025-11-03", "2026-02-02", "2026-05-04",
        ]
        holding = self._holding(history)
        resolved = app_module._apply_payment_history_to_calendar_events(
            [holding], [self._event()]
        )
        self.assertEqual(resolved[0]["pay_date"], "2026-08-03")
        self.assertEqual(resolved[0]["pay_source"], "projected")

        month_payments = app_module._project_dividend_payments_for_month(
            [holding], resolved, "2026-08"
        )
        self.assertEqual(month_payments[0]["calendar_pay_date"], "2026-08-03")

    def test_actual_transaction_wins_when_monthly_schedule_moves_a_full_week(self):
        holding = self._holding([
            "2026-05-22", "2026-06-18", "2026-07-24", "2026-08-21",
        ])
        holding.update({"freq": "M", "pay_date": "2026-08-28"})
        event = self._event()
        event.update({"freq": "M", "pay_date": "2026-08-28", "pay_day": "28"})

        payments = app_module._project_dividend_payments_for_month(
            [holding], [event], "2026-08"
        )
        resolved = app_module._apply_payment_history_to_calendar_events(
            [holding], [event]
        )

        self.assertEqual(len(payments), 1)
        self.assertEqual(payments[0]["calendar_pay_date"], "2026-08-21")
        self.assertEqual(payments[0]["calendar_source"], "history")
        self.assertFalse(payments[0]["calendar_estimated"])
        self.assertEqual(resolved[0]["pay_date"], "2026-08-21")
        self.assertEqual(resolved[0]["pay_source"], "history")

    def test_agenda_keeps_current_transaction_after_event_advances_to_next_month(self):
        holding = self._holding([
            "2026-05-22", "2026-06-18", "2026-07-24", "2026-08-21",
        ])
        holding.update({"freq": "M", "pay_date": "2026-09-18"})
        event = self._event(confirmed=True)
        event.update({
            "freq": "M",
            "date": "2026-09-16",
            "pay_date": "2026-09-18",
            "pay_month": "Sep",
            "pay_day": "18",
        })

        agenda = app_module._dividend_agenda_payments(
            [holding], [event], today=datetime.date(2026, 8, 21)
        )

        self.assertEqual(
            [(row["pay_date"], row["ticker"]) for row in agenda],
            [("2026-08-21", "PIPE"), ("2026-09-18", "PIPE")],
        )
        self.assertEqual(agenda[0]["pay_source"], "history")
        self.assertFalse(agenda[0]["pay_estimated"])
        self.assertEqual(agenda[0]["date"], "2026-08-19")

    def test_dashboard_and_month_use_the_same_resolved_date(self):
        holding = self._holding([
            "2025-02-03", "2025-05-05", "2025-08-04",
            "2025-11-03", "2026-02-02", "2026-05-04",
        ])
        resolved = app_module._apply_payment_history_to_calendar_events(
            [holding], [self._event()]
        )
        connection = MagicMock()
        with (
            patch.object(app_module, "get_profile_filter", return_value=(False, [1])),
            patch.object(app_module, "get_connection", return_value=connection),
            patch.object(
                app_module,
                "_dividend_calendar_holdings_for_view",
                return_value=[holding],
            ),
            patch.object(app_module, "_build_cal_events", return_value=resolved),
        ):
            dashboard = app_module._canonical_upcoming_dividends(
                today=datetime.date(2026, 7, 30)
            )
        month = app_module._project_dividend_payments_for_month(
            [holding], resolved, "2026-08"
        )

        self.assertEqual(dashboard[0]["pay_date"], "2026-08-03")
        self.assertEqual(month[0]["calendar_pay_date"], dashboard[0]["pay_date"])
        connection.close.assert_called_once_with()

    def test_confirmed_date_remains_authoritative_over_history(self):
        holding = self._holding([
            "2025-02-03", "2025-05-05", "2025-08-04", "2025-11-03",
        ])
        resolved = app_module._apply_payment_history_to_calendar_events(
            [holding], [self._event(confirmed=True)]
        )
        self.assertEqual(resolved[0]["pay_date"], "2026-08-24")
        self.assertFalse(resolved[0]["pay_estimated"])

    def test_no_history_uses_existing_frequency_estimator(self):
        ex_date = datetime.date.today() + datetime.timedelta(days=2)
        holding = self._holding()
        holding.update({
            "ticker": "NOHIST",
            "date": ex_date.isoformat(),
            "pay_date": None,
            "freq": "M",
            "payment_history": [],
        })
        expected = app_module._estimate_dividend_pay_timestamp(ex_date, "M").date()

        with (
            patch.object(app_module, "_fetch_official_distribution_snapshot", return_value=None),
            patch.object(app_module, "_yf_div_pay_date", return_value=None),
            patch.object(app_module, "_build_dividend_lag_patterns", return_value={}),
        ):
            events = app_module._build_cal_events([holding], False, [1])

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["pay_date"], expected.isoformat())
        self.assertTrue(events[0]["pay_estimated"])

    def test_payment_history_changes_calendar_cache_signature(self):
        without_history = app_module._rows_signature(
            [self._holding()], ("ticker", "payment_history")
        )
        with_history = app_module._rows_signature(
            [self._holding(["2026-05-04"])], ("ticker", "payment_history")
        )
        self.assertNotEqual(without_history, with_history)

    def test_snowball_dividend_import_is_actual_payment_history(self):
        temp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        temp.close()
        conn = None
        try:
            conn = sqlite3.connect(temp.name)
            conn.row_factory = sqlite3.Row
            database.ensure_tables_exist(conn)
            conn.execute(
                "INSERT OR REPLACE INTO profiles (id, name) VALUES (2, 'Imported')"
            )
            conn.execute(
                """INSERT INTO all_account_info
                   (ticker, profile_id, description, quantity, current_price,
                    current_value, div, div_frequency, estim_payment_per_year)
                   VALUES ('PIPE', 2, 'Pipeline Income Fund', 10, 20, 200, 1, 'M', 120)"""
            )
            payment_date = (datetime.date.today() - datetime.timedelta(days=14)).isoformat()
            conn.execute(
                """INSERT INTO dividend_payments
                   (ticker, profile_id, payment_date, amount, source)
                   VALUES ('PIPE', 2, ?, 10, 'snowball')""",
                (payment_date,),
            )
            conn.commit()

            holding = app_module._dividend_calendar_holdings_for_view(
                conn, False, [2]
            )[0]
            self.assertEqual(holding["payment_history"], [payment_date])
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            Path(temp.name).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
