import unittest
from unittest.mock import patch

import pandas as pd

from backend.app import (
    _XFUNDS_CURRENT_TICKERS,
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

    def get(self, url, params=None, headers=None, timeout=None):
        if params:
            table = self.FUND_INFO if params.get("type") == "fund-info-table" else self.DAILY_NAV
            return _FakeResponse(payload={"html": table})
        if "TidalFG_Holdings_DRMY.csv" in url:
            return _FakeResponse(text=self.HOLDINGS)
        if url.lower().endswith("/drmy/"):
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
            "BHDG", "NGHT", "GIAX", "FITZ", "FIAX",
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
            "DRMY", session=_DistributionSession()
        )

        self.assertTrue(snapshot["has_dividend"])
        self.assertEqual(snapshot["source"], "X Funds")
        self.assertEqual(snapshot["freq"], "W")
        self.assertEqual(snapshot["ex_div_date"], "07/28/26")
        self.assertEqual(snapshot["div_pay_date"], "07/29/26")
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
        snapshot = _fetch_xfunds_distribution_snapshot(
            "DRMY", session=_FakeSession()
        )

        self.assertFalse(snapshot["has_dividend"])
        self.assertEqual(snapshot["freq"], "W")
        self.assertTrue(snapshot["history"].empty)
        self.assertEqual(snapshot["ex_div_date"], "08/12/26")
        self.assertEqual(snapshot["div_pay_date"], "08/13/26")
        self.assertEqual(len(snapshot["future_schedule"]), 3)

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
