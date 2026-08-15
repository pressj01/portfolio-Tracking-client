import sys
import unittest
import datetime
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import (
    app,
    _blend_price_drip,
    _etf_screen_period_bounds,
    _etf_screen_period_download_kwargs,
    _normalize_etf_comparer_price_basis,
)


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


class ETFComparerPeriodRequestTest(unittest.TestCase):
    def test_ytd_includes_the_prior_year_close_as_its_baseline(self):
        kwargs = _etf_screen_period_download_kwargs(
            "ytd", today=datetime.date(2026, 8, 15),
        )

        self.assertNotIn("period", kwargs)
        self.assertEqual(kwargs["anchor_on_or_before"], "2026-01-01")
        self.assertLess(kwargs["start"], "2026-01-01")
        self.assertEqual(kwargs["end"], "2026-08-15")

    def test_rolling_periods_anchor_on_the_displayed_boundary(self):
        bounds = _etf_screen_period_bounds(
            "6mo", today=datetime.date(2026, 8, 15),
        )
        kwargs = _etf_screen_period_download_kwargs(
            "6mo", today=datetime.date(2026, 8, 15),
        )

        self.assertEqual(
            bounds, (datetime.date(2026, 2, 14), datetime.date(2026, 8, 14)),
        )
        self.assertEqual(kwargs["anchor_on_or_before"], "2026-02-14")
        self.assertEqual(kwargs["start"], "2026-02-04")
        self.assertEqual(kwargs["end"], "2026-08-15")

    def test_max_keeps_yahoos_native_full_history_request(self):
        self.assertEqual(
            _etf_screen_period_download_kwargs("max"), {"period": "max"},
        )

    def test_ytd_endpoint_rebases_to_the_prior_year_close(self):
        dates = pd.to_datetime(["2025-12-31", "2026-01-02", "2026-08-14"])
        market_data = pd.concat({
            "Close": pd.DataFrame({"KSLV": [35.07, 35.74, 27.05]}, index=dates),
            "Dividends": pd.DataFrame({"KSLV": [0.0, 0.0, 0.0]}, index=dates),
        }, axis=1)
        calls = []

        def download(tickers, **kwargs):
            calls.append((tickers, kwargs))
            return market_data if "KSLV" in tickers else pd.DataFrame()

        with (
            patch("app._chunked_yf_download", side_effect=download),
            patch("app._cached_yf_info", return_value={}),
        ):
            response = app.test_client().get(
                "/api/etf-screen/data?ticker=KSLV&period=ytd&mode=price"
                "&refresh=ytd-baseline-test",
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()
        series = result["series"]["KSLV"]
        self.assertEqual(
            series["dates"], ["2026-01-01", "2026-01-02", "2026-08-14"],
        )
        self.assertAlmostEqual(series["traces"]["price"][-1], 77.1315, places=4)
        self.assertTrue(calls)
        self.assertEqual(calls[0][1]["anchor_on_or_before"], "2026-01-01")


if __name__ == "__main__":
    unittest.main()
