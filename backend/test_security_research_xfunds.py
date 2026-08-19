import unittest
from unittest.mock import patch

import pandas as pd

from backend.app import (
    _XFUNDS_CURRENT_TICKERS,
    _apply_resolved_pay_dates,
    _distribution_per_share_from_holding_actuals,
    _fetch_goldman_distribution_snapshot,
    _fetch_xfunds_distribution_snapshot,
    _fetch_xfunds_etf_profile,
    _is_xfunds_fund,
    _merge_official_distribution_snapshot,
    _merge_official_research_profile,
)


class _FakeResponse:
    def __init__(self, text="", payload=None, status_code=200):
        self.text = text
        self.content = text.encode("utf-8")
        self._payload = payload
        self.status_code = status_code

    def json(self):
        if self._payload is None:
            raise ValueError("No JSON payload")
        return self._payload

    def raise_for_status(self):
        if self.status_code != 200:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeSession:
    PAGE = r"""
        <html><body>
          <main class="distribution-frequency-taxonomy-weekly">
          <h1>XFUNDS Memory Income ETF</h1>
          <h2>Fund Summary</h2>
          <p>DRMY seeks income and capital appreciation from memory companies.</p>
          <h2>Fund Objective</h2>
          <p>The fund seeks current income and capital appreciation.</p>
          <div data-twm-type="fund-info-table" data-post-id="123"></div>
          <table class="future-dist-table">
            <thead><tr><th>Declaration Date</th><th>Ex/Record Date</th><th>Payable Date</th></tr></thead>
            <tbody>
              <tr><td>08/11/2026</td><td>08/12/2026</td><td>08/13/2026</td></tr>
              <tr><td>08/18/2026</td><td>08/19/2026</td><td>08/20/2026</td></tr>
              <tr><td>08/25/2026</td><td>08/26/2026</td><td>08/27/2026</td></tr>
            </tbody>
          </table>
          <script>var distributionCsvUrl = "https:\/\/nicholasx.com\/?twm_download=distribution\\u0026ticker=DRMY\\u0026nonce=test";</script>
          </main>
        </body></html>
    """
    FUND_INFO = """
        <table>
          <tr><td>Ticker</td><td>DRMY</td></tr>
          <tr><td>Fund Inception</td><td>07/16/2026</td></tr>
          <tr><td>Expense Ratio*</td><td>1.01%</td></tr>
          <tr><td>Distribution Rate</td><td>12.50%</td></tr>
          <tr><td>30 Day SEC Yield</td><td>3.25%</td></tr>
        </table>
    """
    DAILY_NAV = """
        <table>
          <tr><td>Net Assets</td><td>$1.13M</td></tr>
          <tr><td>NAV</td><td>$45.07</td></tr>
          <tr><td>Closing Price</td><td>$45.40</td></tr>
        </table>
    """
    HOLDINGS = """Date,Account,StockTicker,CUSIP,SecurityName,Shares,Price,MarketValue,Weightings,NetAssets,SharesOutstanding,CreationUnits
07/20/2026,DRMY,MU,595112103,Micron Technology Inc,100,180,18000,8.25%,1126687.50,25000,1
07/20/2026,DRMY,WDC,958102105,Western Digital Corp,100,90,9000,4.10%,1126687.50,25000,1
"""

    DISTRIBUTION_TABLE = """
        <table>
          <tr><td>EX Date</td><td>Record Date</td><td>Payable Date</td><td>Fund Total</td></tr>
        </table>
    """

    def get(self, url, params=None, headers=None, timeout=None):
        if params:
            table_type = params.get("type")
            if table_type == "fund-info-table":
                return _FakeResponse(payload={"html": self.FUND_INFO})
            if table_type == "daily-nav-table":
                return _FakeResponse(payload={"html": self.DAILY_NAV})
            if table_type == "distribution-table":
                return _FakeResponse(payload={"html": self.DISTRIBUTION_TABLE})
            return _FakeResponse(status_code=404)
        if "TidalFG_Holdings_DRMY.csv" in url or "TidalFG_Holdings_FIZY.csv" in url:
            return _FakeResponse(text=self.HOLDINGS)
        if url.lower().endswith("/drmy/") or url.lower().endswith("/fizy/"):
            return _FakeResponse(text=self.PAGE)
        return _FakeResponse(status_code=404)


class _DistributionSession(_FakeSession):
    DISTRIBUTIONS = """Ex Date,Payable Date,Fund Total
07/14/2026,07/15/2026,$0.1000
07/21/2026,07/22/2026,$0.1250
07/28/2026,07/29/2026,$0.1500
"""

    def get(self, url, params=None, headers=None, timeout=None):
        if "TidalFG_Distribution_DRMY.csv" in url:
            return _FakeResponse(status_code=404)
        if "twm_download=distribution" in url:
            return _FakeResponse(text=self.DISTRIBUTIONS)
        return super().get(url, params=params, headers=headers, timeout=timeout)


class _GoldmanSession:
    def post(self, url, json=None, timeout=None, headers=None):
        return _FakeResponse(payload={
            "data": {
                "fundsDetail": {
                    "fundName": "Goldman Sachs S&P 500 Premium Income ETF",
                    "distributionFrequency": "Monthly",
                    "yield": [{"value": "8.11%"}],
                    "distributions": [],
                },
            },
        })


class XFundsSecurityResearchTests(unittest.TestCase):
    def test_current_official_lineup_is_recognized(self):
        expected = {
            "DRMY", "GLDN", "SLVX", "NUKX", "WEPN", "BLOX",
            "BHDG", "NGHT", "GIAX", "FITZ", "FIZY", "FIAX",
        }
        self.assertEqual(_XFUNDS_CURRENT_TICKERS, expected)
        self.assertTrue(all(_is_xfunds_fund(ticker) for ticker in expected))
        self.assertFalse(_is_xfunds_fund("DRMP"))

    def test_goldman_snapshot_includes_the_official_fund_name(self):
        fund = {"pvNumber": "123", "shareClassId": "456", "fundName": "GPIX"}
        with patch("backend.app._fetch_goldman_fund_map", return_value={"GPIX": fund}):
            snapshot = _fetch_goldman_distribution_snapshot("GPIX", session=_GoldmanSession())

        self.assertEqual(snapshot["fund_name"], "Goldman Sachs S&P 500 Premium Income ETF")
        self.assertEqual(snapshot["freq"], "M")
        self.assertEqual(snapshot["distribution_rate_pct"], 8.11)

    def test_official_profile_parses_fund_site_fields(self):
        profile = _fetch_xfunds_etf_profile(
            "DRMY", session=_FakeSession(), use_cache=False
        )

        self.assertEqual(profile["data_source"], "XFUNDS")
        self.assertEqual(profile["name"], "XFUNDS Memory Income ETF")
        self.assertEqual(profile["inception_date"], "2026-07-16")
        self.assertEqual(profile["expense_ratio_pct"], 1.01)
        self.assertEqual(profile["estimated_yield_pct"], 12.5)
        self.assertEqual(profile["sec_30_day_yield_pct"], 3.25)
        self.assertEqual(profile["total_assets"], 1126687.5)
        self.assertEqual(profile["nav_price"], 45.07)
        self.assertEqual(profile["price"], 45.4)
        self.assertEqual(profile["dividend_frequency"], "Weekly")
        self.assertEqual(
            profile["future_distribution_schedule"][0],
            {
                "declaration_date": "2026-08-11",
                "ex_dividend_date": "2026-08-12",
                "payable_date": "2026-08-13",
            },
        )
        self.assertEqual(profile["top_holdings"][0]["symbol"], "MU")
        self.assertEqual(profile["top_holdings"][0]["weight_pct"], 8.25)

    def test_distribution_snapshot_uses_official_dates_amounts_and_frequency(self):
        snapshot = _fetch_xfunds_distribution_snapshot(
            "DRMY", session=_DistributionSession(), as_of="2026-08-19"
        )

        self.assertTrue(snapshot["has_dividend"])
        self.assertEqual(snapshot["source"], "X Funds")
        self.assertEqual(snapshot["freq"], "W")
        # Newly launched funds publish the current cycle on the page before the
        # amount table catches up, so dates come from the schedule.
        self.assertEqual(snapshot["ex_div_date"], "08/19/26")
        self.assertEqual(snapshot["div_pay_date"], "08/20/26")
        self.assertEqual(snapshot["div"], 0.15)
        self.assertEqual(
            list(snapshot["history"].items()),
            [
                (pd.Timestamp("2026-07-14"), 0.1),
                (pd.Timestamp("2026-07-21"), 0.125),
                (pd.Timestamp("2026-07-28"), 0.15),
            ],
        )

    def test_distribution_snapshot_keeps_official_schedule_when_amount_is_not_declared(self):
        class _NoAmountSession(_FakeSession):
            FUND_INFO = """
                <table>
                  <tr><td>Ticker</td><td>DRMY</td></tr>
                  <tr><td>Distribution Rate</td><td>-%</td></tr>
                </table>
            """

        snapshot = _fetch_xfunds_distribution_snapshot(
            "DRMY", session=_NoAmountSession(), as_of="2026-08-19"
        )

        self.assertFalse(snapshot["has_dividend"])
        self.assertEqual(snapshot["freq"], "W")
        self.assertTrue(snapshot["history"].empty)
        self.assertEqual(snapshot["ex_div_date"], "08/19/26")
        self.assertEqual(snapshot["div_pay_date"], "08/20/26")
        self.assertEqual(len(snapshot["future_schedule"]), 3)

    def test_new_xfunds_fund_uses_schedule_dates_and_implied_amount(self):
        class _NewFundSession(_FakeSession):
            FUND_INFO = """
                <table>
                  <tr><td>Ticker</td><td>FIZY</td></tr>
                  <tr><td>Fund Inception</td><td>08/03/2026</td></tr>
                  <tr><td>Distribution Rate**</td><td>14.00%</td></tr>
                </table>
            """
            DAILY_NAV = """
                <table>
                  <tr><td>Net Assets</td><td>$8.16M</td></tr>
                  <tr><td>NAV</td><td>$26.31</td></tr>
                  <tr><td>Closing Price</td><td>$26.41</td></tr>
                </table>
            """
            DISTRIBUTION_TABLE = """
                <table>
                  <tr><td>Ex-Date</td><td>Record Date</td><td>Payable Date</td><td>Fund Total</td></tr>
                  <tr><td>XX/XX/XXXX</td><td>XX/XX/XXXX</td><td>XX/XX/XXXX</td><td>-</td></tr>
                </table>
            """

        snapshot = _fetch_xfunds_distribution_snapshot(
            "FIZY", session=_NewFundSession(), as_of="2026-08-19"
        )

        self.assertTrue(snapshot["has_dividend"])
        self.assertEqual(snapshot["freq"], "W")
        self.assertEqual(snapshot["ex_div_date"], "08/19/26")
        self.assertEqual(snapshot["div_pay_date"], "08/20/26")
        self.assertEqual(snapshot["div"], 0.070835)
        self.assertEqual(snapshot["distribution_rate_pct"], 14.0)
        self.assertTrue(snapshot["history"].empty)

    def test_published_schedule_overrides_stale_page_frequency(self):
        class StaleFrequencySession(_FakeSession):
            pass

        StaleFrequencySession.PAGE = _FakeSession.PAGE.replace(
            "distribution-frequency-taxonomy-weekly",
            "distribution-frequency-taxonomy-monthly",
        )

        profile = _fetch_xfunds_etf_profile(
            "DRMY", session=StaleFrequencySession(), use_cache=False
        )
        snapshot = _fetch_xfunds_distribution_snapshot(
            "DRMY", session=StaleFrequencySession(), as_of="2026-08-19"
        )

        self.assertEqual(profile["dividend_frequency"], "Weekly")
        self.assertEqual(snapshot["freq"], "W")

    def test_official_schedule_metadata_does_not_erase_yahoo_distribution_fallback(self):
        yahoo_history = pd.Series(
            [0.2], index=pd.DatetimeIndex([pd.Timestamp("2026-07-24")])
        )
        yahoo = {
            "known": True,
            "has_dividend": True,
            "div": 0.2,
            "ex_div_date": "07/24/26",
            "div_pay_date": "07/27/26",
            "freq": "A",
            "history": yahoo_history,
        }
        official = {
            "known": True,
            "has_dividend": False,
            "div": None,
            "ex_div_date": "08/12/26",
            "div_pay_date": "08/13/26",
            "freq": "W",
            "history": pd.Series(dtype=float),
            "future_schedule": [{"ex_dividend_date": "2026-08-12"}],
            "source": "X Funds",
        }

        merged = _merge_official_distribution_snapshot(yahoo, official)

        self.assertTrue(merged["has_dividend"])
        self.assertEqual(merged["div"], 0.2)
        self.assertTrue(merged["history"].equals(yahoo_history))
        self.assertEqual(merged["freq"], "W")
        self.assertEqual(merged["ex_div_date"], "08/12/26")
        self.assertEqual(merged["source"], "X Funds")
        self.assertTrue(merged["known"])

    def test_paid_cash_fills_per_share_when_issuer_amount_is_still_blank(self):
        per_share = _distribution_per_share_from_holding_actuals({
            "qty": 340.043,
            "last_payment_cash": 99.14,
            "current_month_income": 99.14,
            "ytd_divs": 99.14,
        })
        self.assertAlmostEqual(per_share, 0.291552, places=5)

    def test_schedule_only_official_data_is_still_known(self):
        merged = _merge_official_distribution_snapshot(
            {"known": False, "has_dividend": False, "div": 0.0},
            {
                "known": True,
                "has_dividend": False,
                "div": None,
                "ex_div_date": "08/19/26",
                "div_pay_date": "08/20/26",
                "freq": "W",
            },
        )
        self.assertTrue(merged["known"])
        self.assertEqual(merged["ex_div_date"], "08/19/26")
        self.assertEqual(merged["div_pay_date"], "08/20/26")
        self.assertFalse(merged["has_dividend"])

    def test_holdings_overlay_fills_blank_drmy_dates_from_calendar_event(self):
        rows = [{
            "ticker": "DRMY",
            "div": 0.2916,
            "ex_div_date": None,
            "div_pay_date": None,
            "estim_payment_per_year": 0,
            "current_value": 15696.36,
            "purchase_value": 16160.0,
        }]
        events = [{
            "ticker": "DRMY",
            "date": "2026-08-19",
            "pay_date": "2026-08-20",
            "pay_estimated": False,
            "amount": 0.2933,
            "annual_income": 5155.28,
        }]
        overlaid = _apply_resolved_pay_dates(rows, events)
        self.assertEqual(overlaid[0]["ex_div_date"], "08/19/26")
        self.assertEqual(overlaid[0]["div_pay_date"], "08/20/26")
        self.assertEqual(overlaid[0]["div"], 0.2916)
        self.assertEqual(overlaid[0]["estim_payment_per_year"], 5155.28)
        self.assertGreater(overlaid[0]["current_annual_yield"], 0)
        self.assertGreater(overlaid[0]["approx_monthly_income"], 0)

    def test_official_fields_override_yahoo_and_yahoo_fills_gaps(self):
        yahoo = {
            "name": "Yahoo Name",
            "category": "Yahoo Category",
            "expense_ratio_pct": 9.99,
            "data_source": "Yahoo Finance",
        }
        official = {
            "name": "Official Name",
            "expense_ratio_pct": 1.01,
            "category": None,
            "data_source": "XFUNDS",
            "source_url": "https://nicholasx.com/drmy/",
        }

        merged = _merge_official_research_profile(yahoo, official)

        self.assertEqual(merged["name"], "Official Name")
        self.assertEqual(merged["expense_ratio_pct"], 1.01)
        self.assertEqual(merged["category"], "Yahoo Category")
        self.assertEqual(merged["data_source"], "XFUNDS")
        self.assertEqual(merged["fallback_source"], "Yahoo Finance")


if __name__ == "__main__":
    unittest.main()
