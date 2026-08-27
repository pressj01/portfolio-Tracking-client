"""NAV coverage must not turn a quote-feed outage into a verdict.

Two failures lived here. A rate-limited run produced `coverage_ratio: None` for
every holding and cached that payload for the full TTL, so the NAV column stayed
blank long after Yahoo recovered. And when only the *benchmark* download failed,
the fund was gated against its own return, which always scores 0.0 — a confident
"Low NAV erosion" for a fund that may have fallen hard.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


def _history(start=100.0, end=70.0, periods=260, dividend=0.0):
    dates = pd.bdate_range("2024-01-02", periods=periods)
    close = np.linspace(start, end, periods)
    return pd.DataFrame(
        {
            "Close": close,
            "Open": close,
            "High": close,
            "Low": close,
            "Volume": np.full(periods, 1000.0),
            "Dividends": np.full(periods, dividend),
        },
        index=dates,
    )


class FakeTicker:
    """Stands in for yf.Ticker, per-symbol scripted."""

    def __init__(self, symbol, frames):
        self.symbol = symbol
        self._frames = frames

    def history(self, **kwargs):
        frame = self._frames.get(self.symbol)
        return pd.DataFrame() if frame is None else frame.copy()

    @property
    def dividends(self):
        frame = self._frames.get(self.symbol)
        if frame is None or "Dividends" not in frame:
            return pd.Series(dtype=float)
        return frame["Dividends"]


class NavCoverageOutageTest(unittest.TestCase):
    def setUp(self):
        # SPYI is NAV-tested against SPY by the built-in benchmark map.
        self.ticker_info = {
            "SPYI": {
                "current_price": 50.0,
                "quantity": 100.0,
                "description": "NEOS S&P 500 High Income ETF",
                "classification_type": "ETF",
                "annual_income": 600.0,
                "current_value": 5000.0,
                "nav_erosion_scope": "auto",
                "nav_benchmark_override": None,
            }
        }
        app_module._PORTFOLIO_COVERAGE_CACHE.clear()

    def tearDown(self):
        app_module._PORTFOLIO_COVERAGE_CACHE.clear()

    def _run(self, frames, cache_key=("test", "nav")):
        with patch(
            "yfinance.Ticker",
            side_effect=lambda symbol, *a, **k: FakeTicker(symbol, frames),
        ):
            return app_module._build_nav_coverage_payload(self.ticker_info, cache_key)

    def test_empty_history_is_reported_and_never_cached(self):
        payload = self._run({})
        row = payload["results"][0]

        self.assertEqual(payload["unpriced_tickers"], ["SPYI"])
        self.assertTrue(row["price_data_unavailable"])
        self.assertFalse(row["nav_tested"])
        self.assertIsNone(row["coverage_ratio"])
        self.assertEqual(
            len(app_module._PORTFOLIO_COVERAGE_CACHE), 0,
            "an outage payload must not be cached over a good one",
        )

    def test_failed_benchmark_does_not_score_the_fund_against_itself(self):
        # The fund prices and is down 30%; only the benchmark download fails.
        payload = self._run({"SPYI": _history(100.0, 70.0, dividend=0.05)})
        row = payload["results"][0]

        self.assertIsNone(
            row["coverage_ratio"],
            "a missing benchmark must read as untested, not as 0.0 (Low erosion)",
        )
        self.assertFalse(row["nav_tested"])
        self.assertFalse(row["benchmark_valid"])
        self.assertEqual(row["benchmark"], "SPY")
        self.assertIn("SPY", row["warning"])
        self.assertEqual(payload["unpriced_tickers"], ["SPYI"])

    def test_priced_fund_and_benchmark_still_score_and_cache(self):
        # Fund down 30%, SPY up 20% — a real NAV eroder, not a market drawdown.
        payload = self._run({
            "SPYI": _history(100.0, 70.0, dividend=0.05),
            "SPY": _history(400.0, 480.0),
        })
        row = payload["results"][0]

        self.assertEqual(payload["unpriced_tickers"], [])
        self.assertTrue(row["nav_tested"])
        self.assertIsNotNone(row["coverage_ratio"])
        self.assertGreater(row["coverage_ratio"], 0)
        self.assertEqual(len(app_module._PORTFOLIO_COVERAGE_CACHE), 1)

    def test_shared_benchmark_is_downloaded_once(self):
        """Twelve SPY-benchmarked funds must not pull SPY twelve times."""
        self.ticker_info = {
            tk: {
                "current_price": 50.0,
                "quantity": 100.0,
                "description": desc,
                "classification_type": "ETF",
                "annual_income": 600.0,
                "current_value": 5000.0,
                # Forced on, so this exercises the benchmark fetch rather than
                # the separate is-this-a-candidate gate.
                "nav_erosion_scope": "test",
                "nav_benchmark_override": None,
            }
            for tk, desc in (
                ("SPYI", "NEOS S&P 500 High Income ETF"),
                ("TSPY", "TappAlpha SPY Growth and Daily Income ETF"),
                ("XSPI", "FT Vest S&P 500 Income ETF"),
            )
        }
        frames = {
            "SPYI": _history(100.0, 70.0, dividend=0.05),
            "TSPY": _history(100.0, 80.0, dividend=0.05),
            "XSPI": _history(100.0, 90.0, dividend=0.05),
            "SPY": _history(400.0, 480.0),
        }
        calls = []

        def _make(symbol, *a, **k):
            calls.append(symbol)
            return FakeTicker(symbol, frames)

        with patch("yfinance.Ticker", side_effect=_make):
            payload = app_module._build_nav_coverage_payload(self.ticker_info, None)

        self.assertEqual(
            calls.count("SPY"), 1,
            f"SPY was downloaded {calls.count('SPY')} times: {calls}",
        )
        self.assertEqual(payload["unpriced_tickers"], [])
        for row in payload["results"]:
            self.assertTrue(row["nav_tested"], row)
            self.assertIsNotNone(row["coverage_ratio"], row)

    def test_scope_skip_is_not_an_outage(self):
        self.ticker_info["SPYI"]["nav_erosion_scope"] = "skip"
        payload = self._run({})
        row = payload["results"][0]

        self.assertEqual(
            payload["unpriced_tickers"], [],
            "a deliberate skip is a policy decision, not a feed failure",
        )
        self.assertNotIn("price_data_unavailable", row)
        self.assertEqual(len(app_module._PORTFOLIO_COVERAGE_CACHE), 1)


if __name__ == "__main__":
    unittest.main()
