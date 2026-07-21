import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import _blend_price_drip, _normalize_etf_comparer_price_basis


class ETFComparerSplitNormalizationTest(unittest.TestCase):
    def test_nusi_reverse_split_does_not_create_a_return_jump(self):
        dates = pd.to_datetime(["2025-02-14", "2025-02-18", "2025-02-19"])
        yahoo_close = pd.Series([26.81, 53.62, 53.72], index=dates)

        normalized = _normalize_etf_comparer_price_basis("NUSI", yahoo_close)
        returns = _blend_price_drip(
            normalized,
            pd.Series([0.0, 0.0, 0.0], index=dates),
            frac=1.0,
        )

        self.assertEqual(normalized.tolist(), [53.62, 53.62, 53.72])
        self.assertAlmostEqual(float(returns.iloc[1]), 100.0, places=8)
        self.assertAlmostEqual(float(returns.iloc[-1]), 100.1865, places=4)

    def test_nusi_pre_split_close_matches_retroactively_adjusted_dividend_basis(self):
        dates = pd.to_datetime(["2025-01-21", "2025-01-22"])
        yahoo_close = pd.Series([26.00, 26.10], index=dates)
        yahoo_dividend = pd.Series([0.0, 0.3862], index=dates)

        normalized = _normalize_etf_comparer_price_basis("nusi", yahoo_close)
        returns = _blend_price_drip(normalized, yahoo_dividend, frac=1.0)

        # The dividend is already stated per post-split share, so the matching
        # price is $52.20 rather than Yahoo's stale pre-split $26.10.
        expected = ((52.20 + 0.3862) / 52.00) * 100
        self.assertAlmostEqual(float(returns.iloc[-1]), expected, places=8)

    def test_unrelated_ticker_is_unchanged(self):
        dates = pd.to_datetime(["2025-02-14", "2025-02-18"])
        close = pd.Series([25.0, 50.0], index=dates)

        result = _normalize_etf_comparer_price_basis("OTHER", close)

        self.assertIs(result, close)
        self.assertEqual(result.tolist(), [25.0, 50.0])


if __name__ == "__main__":
    unittest.main()
