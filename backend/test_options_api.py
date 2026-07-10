import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parent))
import options_api


class OptionsRiskGraphApiTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        options_api.register_routes(self.app)
        self.client = self.app.test_client()
        self.today = date.today()
        self.expiration = self.today + timedelta(days=30)

    def payload(self, evaluation_date):
        return {
            "underlying": "SPY",
            "spot_override": 100,
            "eval_date": evaluation_date.isoformat(),
            "model": "black-scholes",
            "rate": 0.04,
            "div_yield": 0.01,
            "price_range": {"low": 70, "high": 130, "steps": 61},
            "day_step": 5,
            "legs": [
                {
                    "side": "BUY",
                    "qty": 1,
                    "opt_type": "CALL",
                    "strike": 100,
                    "expiration": self.expiration.isoformat(),
                    "entry_price": 4.5,
                    "iv": 0.25,
                },
                {
                    "side": "SELL",
                    "qty": 1,
                    "opt_type": "CALL",
                    "strike": 110,
                    "expiration": self.expiration.isoformat(),
                    "entry_price": 1.5,
                    "iv": 0.24,
                },
            ],
        }

    @patch("options_api._fetch_quote", return_value={"last": 100, "div_yield": 0.01})
    def test_multi_leg_curve_and_greeks_evolve_with_analysis_date(self, _quote):
        initial = self.client.post("/api/options/risk-graph", json=self.payload(self.today))
        evolved = self.client.post(
            "/api/options/risk-graph",
            json=self.payload(self.today + timedelta(days=15)),
        )

        self.assertEqual(initial.status_code, 200)
        self.assertEqual(evolved.status_code, 200)
        initial_data = initial.get_json()
        evolved_data = evolved.get_json()
        self.assertEqual(len(initial_data["curves"]["today"]), 61)
        self.assertEqual(len(initial_data["curves"]["expiration"]), 61)
        self.assertEqual(len(initial_data["curves"]["day_steps"]), 5)
        self.assertEqual(initial_data["curves"]["day_steps"][0]["date"], (self.today + timedelta(days=5)).isoformat())
        self.assertEqual(len(initial_data["curves"]["day_steps"][0]["curve"]), 61)
        self.assertNotEqual(initial_data["curves"]["today"], evolved_data["curves"]["today"])
        self.assertNotEqual(
            initial_data["portfolio_greeks"]["theta"],
            evolved_data["portfolio_greeks"]["theta"],
        )
        self.assertGreaterEqual(len(initial_data["breakevens"]), 1)

    def test_same_day_contracts_keep_intraday_time_value(self):
        self.assertGreater(options_api._year_frac(self.today.isoformat(), self.today), 0)

    @patch("options_api._fetch_quote", return_value={"last": 100, "div_yield": 0.01})
    def test_mixed_expiration_analysis_stops_at_first_expiration(self, _quote):
        first_expiration = self.today + timedelta(days=10)
        later_expiration = self.today + timedelta(days=30)
        payload = self.payload(self.today + timedelta(days=20))
        payload["legs"] = [
            {
                "side": "BUY",
                "qty": 1,
                "opt_type": "CALL",
                "strike": 100,
                "expiration": first_expiration.isoformat(),
                "entry_price": 0,
                "iv": 0.20,
            },
            {
                "side": "BUY",
                "qty": 1,
                "opt_type": "PUT",
                "strike": 100,
                "expiration": later_expiration.isoformat(),
                "entry_price": 0,
                "iv": 0.20,
            },
        ]

        response = self.client.post("/api/options/risk-graph", json=payload)

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["analysis_date_adjusted"])
        self.assertTrue(data["mixed_expirations"])
        self.assertEqual(data["eval_date"], first_expiration.isoformat())
        self.assertEqual(data["analysis_horizon"], first_expiration.isoformat())
        self.assertEqual(data["curves"]["expiration_date"], first_expiration.isoformat())
        self.assertEqual(data["curves"]["today"], data["curves"]["expiration"])
        # At the first expiration the call is intrinsic-only, while the later
        # put still has 20 days of time value at the money.
        self.assertGreater(data["curves"]["expiration"][30]["pnl"], 0)

    @patch("options_api._fetch_quote", return_value={"last": 100, "div_yield": 0.01})
    def test_chain_contracts_include_configurable_greek_columns(self, _quote):
        expiration = self.expiration.isoformat()
        row = {
            "strike": 100,
            "bid": 4.8,
            "ask": 5.2,
            "lastPrice": 5.0,
            "impliedVolatility": 0.25,
            "volume": 120,
            "openInterest": 450,
        }

        class Frame:
            def iterrows(self):
                return iter([(0, row)])

        fake_ticker = SimpleNamespace(
            option_chain=lambda _expiration: SimpleNamespace(calls=Frame(), puts=Frame())
        )
        options_api._chain_cache.pop(("TEST", expiration), None)
        with patch("options_api.yf.Ticker", return_value=fake_ticker):
            chain = options_api._fetch_chain("TEST", expiration)

        for contract in (chain["calls"][0], chain["puts"][0]):
            for greek in ("delta", "gamma", "theta", "vega", "rho"):
                self.assertIn(greek, contract)
                self.assertIsNotNone(contract[greek])
            self.assertEqual(contract["volume"], 120)
            self.assertEqual(contract["open_interest"], 450)


if __name__ == "__main__":
    unittest.main()
