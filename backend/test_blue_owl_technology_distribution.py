import datetime
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


OTF_DIVIDEND_PAGE = """
<html>
  <head><title>Dividends :: Blue Owl Technology Finance Corp. (OTF)</title></head>
  <body>
    <h2>Upcoming Dividends</h2>
    <table>
      <tr>
        <th>Announced</th><th>Ex-Div Date</th><th>Record</th>
        <th>Payment</th><th>Amount</th><th>Frequency</th>
      </tr>
      <tr><td>08/04/2026</td><td>09/30/2026</td><td>09/30/2026</td><td>10/15/2026</td><td>$0.35</td><td>Quarterly</td></tr>
      <tr><td>06/02/2025</td><td>09/21/2026</td><td>09/21/2026</td><td>10/06/2026</td><td>$0.05</td><td>Special</td></tr>
    </table>
    <h2>Dividend History</h2>
    <table>
      <tr>
        <th>Announced</th><th>Ex-Div Date</th><th>Record</th>
        <th>Payment</th><th>Amount</th><th>Frequency</th>
      </tr>
      <tr><td>05/05/2026</td><td>06/30/2026</td><td>06/30/2026</td><td>07/15/2026</td><td>$0.35</td><td>Quarterly</td></tr>
      <tr><td>06/02/2025</td><td>06/22/2026</td><td>06/22/2026</td><td>07/07/2026</td><td>$0.05</td><td>Special</td></tr>
      <tr><td>02/18/2026</td><td>03/31/2026</td><td>03/31/2026</td><td>04/15/2026</td><td>$0.35</td><td>Quarterly</td></tr>
      <tr><td>06/02/2025</td><td>03/23/2026</td><td>03/23/2026</td><td>04/07/2026</td><td>$0.05</td><td>Special</td></tr>
    </table>
  </body>
</html>
"""


class BlueOwlTechnologyDistributionTests(unittest.TestCase):
    def setUp(self):
        app_module._clear_dividend_event_caches()
        app_module._OFFICIAL_DISTRIBUTION_CACHE.clear()

    def test_otf_routes_to_the_company_dividend_parser(self):
        entry = app_module._match_fund_family("OTF")

        self.assertIsNotNone(entry)
        self.assertEqual(
            entry["fetcher"], "_fetch_blue_owl_technology_distribution_snapshot"
        )

    def test_parser_keeps_regular_run_rate_and_returns_both_declared_events(self):
        snapshot = app_module._blue_owl_technology_snapshot_from_html(
            OTF_DIVIDEND_PAGE, as_of="2026-08-25"
        )

        self.assertEqual(snapshot["div"], 0.35)
        self.assertEqual(snapshot["freq"], "Q")
        self.assertEqual(snapshot["ex_div_date"], "09/30/26")
        self.assertEqual(snapshot["div_pay_date"], "10/15/26")
        self.assertEqual(float(snapshot["history"].iloc[-1]), 0.35)
        self.assertEqual(
            snapshot["future_schedule"],
            [
                {
                    "ex_dividend_date": "2026-09-21",
                    "payable_date": "2026-10-06",
                    "amount": 0.05,
                    "frequency": "Special",
                    "frequency_code": None,
                },
                {
                    "ex_dividend_date": "2026-09-30",
                    "payable_date": "2026-10-15",
                    "amount": 0.35,
                    "frequency": "Quarterly",
                    "frequency_code": "Q",
                },
            ],
        )

    def test_calendar_shows_special_and_regular_payments_with_separate_amounts(self):
        snapshot = app_module._blue_owl_technology_snapshot_from_html(
            OTF_DIVIDEND_PAGE, as_of="2026-08-25"
        )
        holding = {
            "ticker": "OTF",
            "description": "Blue Owl Technology Finance Corp.",
            "date": "2026-09-30",
            "pay_date": "2026-10-15",
            "amount": 0.35,
            "freq": "Q",
            "quantity": 607.0,
            "current_price": 11.18,
            "current_value": 6786.26,
            "annual_income": 850.0,
            "payment_income": 212.45,
            "payment_history": [],
        }
        base_event = {
            **holding,
            "day": "30",
            "month": "Sep",
            "weekday": "Wed",
            "freq_label": "quarterly",
            "color": "#7ecfff",
            "pay_month": "Oct",
            "pay_day": "15",
            "pay_estimated": False,
        }

        events = app_module._calendar_events_from_official_schedule(
            snapshot["future_schedule"],
            base_event,
            today=datetime.date(2026, 8, 25),
        )
        payments = app_module._project_dividend_payments_for_month(
            [holding], events, "2026-10"
        )
        january = app_module._project_dividend_payments_for_month(
            [holding], events, "2027-01"
        )

        self.assertEqual(
            [
                (
                    event["date"], event["pay_date"], event["payment_income"],
                    event["annual_income"], event["freq"],
                )
                for event in events
            ],
            [
                ("2026-09-21", "2026-10-06", 30.35, 30.35, "A"),
                ("2026-09-30", "2026-10-15", 212.45, 849.8, "Q"),
            ],
        )
        self.assertEqual(
            [
                (row["calendar_pay_date"], row["payment_income"], row["calendar_source"])
                for row in payments
            ],
            [
                ("2026-10-06", 30.35, "confirmed"),
                ("2026-10-15", 212.45, "confirmed"),
            ],
        )
        self.assertEqual(len(january), 1)
        self.assertEqual(january[0]["calendar_pay_date"], "2027-01-15")
        self.assertEqual(january[0]["payment_income"], 212.45)

    def test_calendar_builder_expands_the_live_snapshot_rows(self):
        snapshot = app_module._blue_owl_technology_snapshot_from_html(
            OTF_DIVIDEND_PAGE, as_of="2026-08-25"
        )
        today = datetime.date.today()
        special_ex = today + datetime.timedelta(days=27)
        special_pay = today + datetime.timedelta(days=42)
        regular_ex = today + datetime.timedelta(days=36)
        regular_pay = today + datetime.timedelta(days=51)
        snapshot.update({
            "ex_div_date": regular_ex.strftime("%m/%d/%y"),
            "div_pay_date": regular_pay.strftime("%m/%d/%y"),
            "future_schedule": [
                {
                    "ex_dividend_date": special_ex.isoformat(),
                    "payable_date": special_pay.isoformat(),
                    "amount": 0.05,
                    "frequency": "Special",
                    "frequency_code": None,
                },
                {
                    "ex_dividend_date": regular_ex.isoformat(),
                    "payable_date": regular_pay.isoformat(),
                    "amount": 0.35,
                    "frequency": "Quarterly",
                    "frequency_code": "Q",
                },
            ],
        })
        holding = {
            "ticker": "OTF",
            "description": "Blue Owl Technology Finance Corp.",
            "date": "2026-06-30",
            "pay_date": "2026-07-15",
            "amount": 0.35,
            "freq": "Q",
            "div_frequency_locked": False,
            "div_manual_until": None,
            "div_dates_manual_until": None,
            "quantity": 607.0,
            "current_price": 11.18,
            "current_value": 6786.26,
            "annual_income": 850.0,
            "payment_income": 212.45,
            "payment_history": [],
        }
        connection = MagicMock()

        with (
            patch.object(
                app_module,
                "_fetch_official_distribution_snapshot",
                return_value=snapshot,
            ),
            patch.object(app_module, "_yf_div_pay_date", return_value=None),
            patch.object(app_module, "get_connection", return_value=connection),
            patch.object(app_module, "_build_dividend_lag_patterns", return_value={}),
            patch.object(app_module, "_persist_calendar_dividend_metadata"),
        ):
            events = app_module._build_cal_events([holding], False, [1])

        self.assertEqual(
            [(event["date"], event["pay_date"], event["payment_income"]) for event in events],
            [
                (special_ex.isoformat(), special_pay.isoformat(), 30.35),
                (regular_ex.isoformat(), regular_pay.isoformat(), 212.45),
            ],
        )

    def test_refresh_prefers_yahoo_announced_date_over_completed_history(self):
        class YahooOTF:
            ticker = "OTF"
            info = {
                "quoteType": "EQUITY",
                "longName": "Blue Owl Technology Finance Corp.",
                "exDividendDate": int(
                    pd.Timestamp("2026-09-21", tz="UTC").timestamp()
                ),
            }
            dividends = pd.Series(
                [0.05, 0.35],
                index=pd.DatetimeIndex([
                    pd.Timestamp("2026-06-22"),
                    pd.Timestamp("2026-06-30"),
                ]),
            )
            calendar = {}

        with patch.object(
            app_module, "_fetch_official_distribution_snapshot", return_value=None
        ):
            snapshot = app_module._fetch_refresh_dividend_snapshot(YahooOTF())

        self.assertEqual(snapshot["ex_div_date"], "09/21/26")
        self.assertEqual(snapshot["div"], 0.35)


if __name__ == "__main__":
    unittest.main()
