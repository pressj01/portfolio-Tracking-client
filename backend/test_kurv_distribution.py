import datetime
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from app import (
    _fetch_kurv_distribution_snapshot,
    _is_kurv_fund,
    _match_fund_family,
    _merge_official_distribution_snapshot,
)


class _FakeResponse:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code != 200:
            raise RuntimeError(f"HTTP {self.status_code}")


KEO_PAGE = """
<table>
  <tr class="table_row is-head">
    <th><span><div class="u-cms-text">Declaration Date</div></span></th>
    <th><span><div class="u-cms-text">Ex-Dividend Date</div></span></th>
    <th><span><div class="u-cms-text">Record Date</div></span></th>
    <th><span><div class="u-cms-text">Payable Date</div></span></th>
    <th><span><div class="u-cms-text">$ per Share</div></span></th>
  </tr>
  <tr class="table_row">
    <th><span><div class="u-cms-text">09/01/2026</div></span></th>
    <td><span><div class="u-cms-text">09/02/2026</div></span></td>
    <td><span><div class="u-cms-text">09/02/2026</div></span></td>
    <td><span><div class="u-cms-text">09/03/2026</div></span></td>
    <td><span><div class="u-cms-text">--</div></span></td>
  </tr>
  <tr class="table_row">
    <th><span><div class="u-cms-text">08/25/2026</div></span></th>
    <td><span><div class="u-cms-text">08/26/2026</div></span></td>
    <td><span><div class="u-cms-text">08/26/2026</div></span></td>
    <td><span><div class="u-cms-text">08/27/2026</div></span></td>
    <td><span><div class="u-cms-text">$0.0830</div></span></td>
  </tr>
  <tr class="table_row">
    <th><span><div class="u-cms-text">08/18/2026</div></span></th>
    <td><span><div class="u-cms-text">08/19/2026</div></span></td>
    <td><span><div class="u-cms-text">08/19/2026</div></span></td>
    <td><span><div class="u-cms-text">08/20/2026</div></span></td>
    <td><span><div class="u-cms-text">$0.0800</div></span></td>
  </tr>
</table>
"""

KGLD_PAGE = """
<table>
  <tr class="table_row"><th><div class="u-cms-text">Declaration Date</div></th>
    <td>Ex-Dividend Date</td><td>Record Date</td><td>Payable Date</td><td>$ per Share</td></tr>
  <tr class="table_row">
    <th><div class="u-cms-text">11/03/2026</div></th>
    <td><div class="u-cms-text">11/04/2026</div></td>
    <td><div class="u-cms-text">11/04/2026</div></td>
    <td><div class="u-cms-text">11/05/2026</div></td>
    <td><div class="u-cms-text">--</div></td>
  </tr>
  <tr class="table_row">
    <th><div class="u-cms-text">10/06/2026</div></th>
    <td><div class="u-cms-text">10/07/2026</div></td>
    <td><div class="u-cms-text">10/07/2026</div></td>
    <td><div class="u-cms-text">10/08/2026</div></td>
    <td><div class="u-cms-text">$0.3500</div></td>
  </tr>
</table>
"""


class KurvDistributionTests(unittest.TestCase):
    @patch("requests.get", return_value=_FakeResponse(KGLD_PAGE))
    def test_kgld_schedule_does_not_confirm_the_previous_months_amount(self, _request_get):
        snapshot = _fetch_kurv_distribution_snapshot("KGLD", as_of="2026-10-23")
        self.assertEqual(snapshot["ex_div_date"], "11/04/26")
        self.assertEqual(snapshot["div_pay_date"], "11/05/26")
        self.assertEqual(snapshot["div"], 0.35)
        self.assertEqual(snapshot["amount_ex_div_date"], "2026-10-07")
        self.assertTrue(snapshot["amount_estimated"])

    @patch("requests.get", return_value=_FakeResponse(KGLD_PAGE.replace("--", "$0.4200")))
    def test_kgld_declared_amount_is_confirmed_for_its_own_cycle(self, _request_get):
        november = _fetch_kurv_distribution_snapshot("KGLD", as_of="2026-11-03")
        self.assertEqual(november["div"], 0.42)
        self.assertEqual(november["amount_ex_div_date"], "2026-11-04")
        self.assertFalse(november["amount_estimated"])
        october = _fetch_kurv_distribution_snapshot("KGLD", as_of="2026-10-06")
        self.assertEqual(october["div"], 0.35)
        self.assertEqual(october["amount_ex_div_date"], "2026-10-07")
        self.assertFalse(october["amount_estimated"])

    def test_calendar_api_keeps_date_and_amount_confirmation_separate(self):
        today = datetime.date.today()
        ex_date = today + datetime.timedelta(days=5)
        pay_date = ex_date + datetime.timedelta(days=1)
        previous_ex = ex_date - datetime.timedelta(days=28)
        holding = {
            "ticker": "KGLD", "description": "Kurv Gold Enhanced Income ETF",
            "date": ex_date.isoformat(), "pay_date": pay_date.isoformat(),
            "amount": 0.35, "freq": "M", "quantity": 100,
            "current_price": 25, "current_value": 2500,
            "annual_income": 420, "payment_income": 35, "payment_history": [],
        }
        official = {
            "has_dividend": True, "div": 0.35, "freq": "M",
            "ex_div_date": ex_date.isoformat(), "div_pay_date": pay_date.isoformat(),
            "history": pd.Series([0.35], index=pd.DatetimeIndex([previous_ex])),
            "amount_ex_div_date": previous_ex.isoformat(), "amount_estimated": True,
        }
        with (
            patch.object(app_module.app, "_db_initialized", True, create=True),
            patch.object(app_module, "get_profile_filter", return_value=(False, [2])),
            patch.object(app_module, "get_connection", return_value=MagicMock()),
            patch.object(app_module, "_dividend_calendar_holdings_for_view", return_value=[holding]),
            patch.object(app_module, "_fetch_official_distribution_snapshot", return_value=official),
            patch.object(app_module, "_yf_div_pay_date", return_value=None),
            patch.object(app_module, "_build_dividend_lag_patterns", return_value={}),
            patch.object(app_module, "_persist_calendar_dividend_metadata"),
            patch.object(app_module, "_dividend_optimization_current_month", return_value={}),
        ):
            app_module._clear_dividend_event_caches()
            try:
                response = app_module.app.test_client().get(
                    f"/api/div-calendar?month={pay_date:%Y-%m}"
                )
                self.assertEqual(response.status_code, 200, response.get_json())
                data = response.get_json()
                for rows in (data["events"], data["agenda_payments"], data["payments"]):
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]["pay_date"], pay_date.isoformat())
                    self.assertFalse(rows[0]["pay_estimated"])
                    self.assertTrue(rows[0]["amount_estimated"])
                    self.assertEqual(rows[0]["amount"], 0.35)
                    self.assertEqual(rows[0]["payment_income"], 35)

                # The next issuer refresh declares this cycle's actual amount.
                official.update({
                    "div": 0.42, "amount_ex_div_date": ex_date.isoformat(),
                    "amount_estimated": False,
                    "history": pd.Series([0.42], index=pd.DatetimeIndex([ex_date])),
                })
                app_module._clear_dividend_event_caches()
                response = app_module.app.test_client().get(
                    f"/api/div-calendar?month={pay_date:%Y-%m}"
                )
                self.assertEqual(response.status_code, 200, response.get_json())
                data = response.get_json()
                for rows in (data["events"], data["agenda_payments"], data["payments"]):
                    self.assertFalse(rows[0]["amount_estimated"])
                    self.assertEqual(rows[0]["amount"], 0.42)
                    self.assertEqual(rows[0]["payment_income"], 42)
            finally:
                app_module._clear_dividend_event_caches()

    def test_keo_routes_from_issuer_metadata_without_a_ticker_list_entry(self):
        self.assertFalse(_is_kurv_fund("KEO"))
        self.assertTrue(_is_kurv_fund("KEO", "Kurv Enduring Equity ETF"))
        family = _match_fund_family("KEO", "Kurv Enduring Equity ETF")
        self.assertIsNotNone(family)
        self.assertEqual(family["fetcher"], "_fetch_kurv_distribution_snapshot")

    @patch("requests.get", return_value=_FakeResponse(KEO_PAGE))
    def test_keo_uses_official_amount_dates_and_weekly_schedule(self, request_get):
        snapshot = _fetch_kurv_distribution_snapshot("KEO", as_of="2026-08-25")

        request_get.assert_called_once()
        self.assertTrue(snapshot["has_dividend"])
        self.assertEqual(snapshot["source"], "Kurv")
        self.assertEqual(snapshot["source_url"], "https://www.kurvinvest.com/etf/keo")
        self.assertEqual(snapshot["div"], 0.083)
        self.assertEqual(snapshot["ex_div_date"], "08/26/26")
        self.assertEqual(snapshot["div_pay_date"], "08/27/26")
        self.assertEqual(snapshot["freq"], "W")
        self.assertEqual(
            list(snapshot["history"].items()),
            [
                (pd.Timestamp("2026-08-19"), 0.08),
                (pd.Timestamp("2026-08-26"), 0.083),
            ],
        )

        merged = _merge_official_distribution_snapshot(
            {"freq": "M", "history": pd.Series(dtype=float)}, snapshot
        )
        self.assertTrue(merged["frequency_authoritative"])

    @patch("requests.get", side_effect=RuntimeError("Kurv unavailable"))
    def test_yahoo_snapshot_is_unchanged_when_kurv_data_is_unavailable(self, _request_get):
        yahoo_history = pd.Series(
            [0.075], index=pd.DatetimeIndex([pd.Timestamp("2026-08-19")])
        )
        yahoo = {
            "known": True,
            "has_dividend": True,
            "div": 0.075,
            "ex_div_date": "08/19/26",
            "div_pay_date": "08/20/26",
            "freq": "W",
            "history": yahoo_history,
            "source": "Yahoo Finance",
        }

        official = _fetch_kurv_distribution_snapshot("KEO", as_of="2026-08-25")
        merged = _merge_official_distribution_snapshot(yahoo, official)

        self.assertIsNone(official)
        self.assertEqual(merged, yahoo)
        self.assertTrue(merged["history"].equals(yahoo_history))


if __name__ == "__main__":
    unittest.main()
