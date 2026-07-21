import unittest

from backend.app import (
    _XFUNDS_CURRENT_TICKERS,
    _fetch_xfunds_etf_profile,
    _is_xfunds_fund,
    _merge_official_research_profile,
)


class _FakeResponse:
    def __init__(self, text="", payload=None, status_code=200):
        self.text = text
        self._payload = payload
        self.status_code = status_code

    def json(self):
        if self._payload is None:
            raise ValueError("No JSON payload")
        return self._payload


class _FakeSession:
    PAGE = """
        <html><body>
          <h1>XFUNDS Memory Income ETF</h1>
          <h2>Fund Summary</h2>
          <p>DRMY seeks income and capital appreciation from memory companies.</p>
          <h2>Fund Objective</h2>
          <p>The fund seeks current income and capital appreciation.</p>
          <div data-twm-type="fund-info-table" data-post-id="123"></div>
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
        if url.endswith("/drmy/"):
            return _FakeResponse(text=self.PAGE)
        return _FakeResponse(status_code=404)


class XFundsSecurityResearchTests(unittest.TestCase):
    def test_current_official_lineup_is_recognized(self):
        expected = {
            "DRMY", "GLDN", "SLVX", "NUKX", "WEPN", "BLOX",
            "BHDG", "NGHT", "GIAX", "FITZ", "FIAX",
        }
        self.assertEqual(_XFUNDS_CURRENT_TICKERS, expected)
        self.assertTrue(all(_is_xfunds_fund(ticker) for ticker in expected))
        self.assertFalse(_is_xfunds_fund("DRMP"))

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
        self.assertEqual(profile["top_holdings"][0]["symbol"], "MU")
        self.assertEqual(profile["top_holdings"][0]["weight_pct"], 8.25)

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
