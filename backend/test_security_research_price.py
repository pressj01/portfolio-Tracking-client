import unittest
from unittest.mock import patch

import pandas as pd

from backend.app import _research_market_price


class _TickerWithoutQuote:
    fast_info = {}


class SecurityResearchPriceTests(unittest.TestCase):
    def test_uses_market_history_when_quote_summary_has_no_price(self):
        prices = pd.DataFrame({"Close": [55.91, 56.38]})
        with patch("backend.app._chunked_yf_download", return_value=prices) as download:
            price = _research_market_price(_TickerWithoutQuote(), {}, "GPIX")

        self.assertEqual(price, 56.38)
        download.assert_called_once_with(
            ["GPIX"], period="5d", interval="1d", auto_adjust=False, progress=False,
        )

    def test_uses_quote_summary_before_fallbacks(self):
        with patch("backend.app._chunked_yf_download") as download:
            price = _research_market_price(None, {"currentPrice": 56.38}, "GPIQ")

        self.assertEqual(price, 56.38)
        download.assert_not_called()


if __name__ == "__main__":
    unittest.main()
