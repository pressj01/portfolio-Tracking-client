import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent))
import option_dashboard


def synthetic_market_history(periods=6200):
    index = pd.bdate_range("2001-01-02", periods=periods)
    fields = {}

    def add(symbol, start, end, wobble=0.015):
        path = np.linspace(start, end, periods)
        path *= 1 + np.sin(np.linspace(0, 80, periods)) * wobble
        fields[("Open", symbol)] = path * 0.998
        fields[("High", symbol)] = path * 1.006
        fields[("Low", symbol)] = path * 0.994
        fields[("Close", symbol)] = path
        fields[("Volume", symbol)] = np.full(periods, 1_000_000.0)

    for symbol, start, end in (("SPY", 100, 620), ("QQQ", 80, 590), ("IWM", 70, 270)):
        add(symbol, start, end)
    add("^TNX", 4.0, 4.5, 0.001)
    add("^IRX", 4.0, 3.5, 0.001)
    add("HYG", 70, 100)
    add("LQD", 100, 112)
    add("XLY", 40, 210)
    add("XLP", 40, 90)
    add("XLI", 35, 160)
    add("TIP", 95, 110)
    add("IEF", 90, 112)
    add("^VIX", 15, 15, 0.01)
    return pd.DataFrame(fields, index=index)


class OptionDashboardModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = synthetic_market_history()
        cls.dashboard = option_dashboard.build_dashboard(cls.raw)

    def test_all_markets_and_timeframes_include_auditable_indicators(self):
        self.assertEqual(set(self.dashboard["timeframes"]), {"daily", "weekly", "monthly"})
        for timeframe in self.dashboard["timeframes"].values():
            self.assertEqual(set(timeframe["markets"]), {"SPY", "QQQ", "IWM"})
            spy = timeframe["markets"]["SPY"]
            self.assertEqual(spy["as_of"], self.raw.index[-1].date().isoformat())
            self.assertIn("ema_20", spy["indicators"])
            self.assertIn("ema_200", spy["indicators"])
            self.assertIn("macd_histogram", spy["indicators"])
            self.assertIn("rsi_14", spy["indicators"])
            self.assertIn("awesome_oscillator", spy["indicators"])
            self.assertIn("adx_14", spy["indicators"])
            self.assertEqual(len(spy["components"]), 8)

    def test_constructive_market_favors_bullish_defined_risk_over_bearish_debit(self):
        rows = self.dashboard["timeframes"]["weekly"]["recommendations"]
        spy_rows = {row["strategy_key"]: row for row in rows if row["market"] == "SPY"}
        self.assertGreater(spy_rows["bull_put_spread"]["score"], spy_rows["bear_put_spread"]["score"])
        self.assertGreater(spy_rows["bull_put_spread"]["technical_fit"], spy_rows["bear_put_spread"]["technical_fit"])

    def test_economic_outlook_exposes_each_weighted_input(self):
        economy = self.dashboard["economy"]
        self.assertGreater(economy["score"], 0)
        self.assertEqual(
            {item["key"] for item in economy["evidence"]},
            {"yield_curve", "credit", "consumer", "industrials", "inflation", "vix"},
        )
        self.assertEqual(sum(item["contribution"] for item in economy["evidence"]), economy["score"])

    def test_scanner_fit_weights_and_macro_adjustment_reconcile(self):
        row = self.dashboard["timeframes"]["daily"]["recommendations"][0]
        expected = round(row["technical_fit"] * 0.55 + row["macro_fit"] * 0.25 + row["volatility_fit"] * 0.20)
        self.assertEqual(row["score"], expected)
        self.assertAlmostEqual(row["macro_adjustment"], round((row["macro_fit"] - 50) * 0.25, 1))


class OptionDashboardApiTest(unittest.TestCase):
    def setUp(self):
        option_dashboard._CACHE.update({"data": None, "timestamp": 0.0, "ttl": 900})
        self.raw = synthetic_market_history()
        self.app = Flask(__name__)
        option_dashboard.register_routes(self.app, download_history=lambda *args, **kwargs: self.raw)
        self.client = self.app.test_client()

    def test_endpoint_returns_live_then_cached_payload(self):
        live = self.client.get("/api/options/dashboard")
        cached = self.client.get("/api/options/dashboard")
        self.assertEqual(live.status_code, 200)
        self.assertEqual(live.get_json()["freshness"]["status"], "live")
        self.assertEqual(cached.get_json()["freshness"]["status"], "cached")


if __name__ == "__main__":
    unittest.main()
