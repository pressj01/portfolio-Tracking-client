import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class WatchlistDescriptionTest(unittest.TestCase):
    def test_prefers_existing_holding_description(self):
        with patch.object(app_module, "_cached_yf_info") as cached_info:
            description = app_module._watchlist_security_description(
                "SCHD",
                "Schwab U.S. Dividend Equity ETF",
                object(),
            )

        self.assertEqual(description, "Schwab U.S. Dividend Equity ETF")
        cached_info.assert_not_called()

    def test_uses_yahoo_name_when_no_holding_description_exists(self):
        with patch.object(
            app_module,
            "_cached_yf_info",
            return_value={"longName": "Apple Inc."},
        ):
            description = app_module._watchlist_security_description(
                "AAPL",
                "",
                object(),
            )

        self.assertEqual(description, "Apple Inc.")


if __name__ == "__main__":
    unittest.main()
