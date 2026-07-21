import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import _normalize_prices_to_100


class TotalReturnNormalizationTest(unittest.TestCase):
    def test_normalizes_after_removing_duplicate_dates(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-02", "2026-01-09"])
        close = pd.DataFrame({"AAA": [None, 10.0, 12.0]}, index=dates)

        result = _normalize_prices_to_100(close)

        self.assertFalse(result.index.has_duplicates)
        self.assertEqual(result["AAA"].tolist(), [100.0, 120.0])

    def test_normalizes_after_removing_duplicate_ticker_columns(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-09"])
        close = pd.DataFrame(
            [[20.0, 99.0], [25.0, 101.0]],
            index=dates,
            columns=["AAA", "AAA"],
        )

        result = _normalize_prices_to_100(close)

        self.assertFalse(result.columns.has_duplicates)
        self.assertEqual(result.columns.tolist(), ["AAA"])
        self.assertEqual(result["AAA"].tolist(), [100.0, 125.0])


if __name__ == "__main__":
    unittest.main()
