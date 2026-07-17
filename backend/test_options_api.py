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

    def test_dividend_yield_normalization_uses_trailing_yield_to_resolve_units(self):
        self.assertAlmostEqual(options_api._normalize_dividend_yield(0.41, 0.00245), 0.0041)
        self.assertAlmostEqual(options_api._normalize_dividend_yield(1.5, 0.015), 0.015)
        self.assertAlmostEqual(options_api._normalize_dividend_yield(0.015, 0.014), 0.015)

    def test_greek_surface_returns_primary_and_higher_order_grids(self):
        response = self.client.post("/api/options/greek-surface", json={
            "underlying": "SPY",
            "spot_override": 100,
            "strike": 100,
            "dte": 45,
            "iv": 0.24,
            "rate": 0.04,
            "div_yield": 0.01,
            "opt_type": "call",
            "model": "black-scholes",
            "price_range_pct": 15,
        })

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(len(data["profile"]["spots"]), 61)
        self.assertEqual(len(data["surface"]["spots"]), 31)
        self.assertEqual(len(data["surface"]["dtes"]), 24)
        self.assertGreater(data["selected_point"]["gamma"], 0)
        # Theoretical mark powers the current-value P/L curve; an ATM call has
        # positive extrinsic value and the per-share value profile rises with spot.
        self.assertEqual(len(data["profile"]["value"]), 61)
        self.assertGreater(data["selected_point"]["value"], 0)
        self.assertGreater(data["profile"]["value"][-1], data["profile"]["value"][0])
        # Surface value grid lets the risk graph slice the value curve at any DTE.
        self.assertEqual(len(data["surface"]["value"]), 24)
        self.assertEqual(len(data["surface"]["value"][0]), 31)
        for greek in (
            "delta", "gamma", "theta", "vega", "rho",
            "vanna", "vomma", "charm", "speed", "color", "zomma",
        ):
            self.assertIn(greek, data["metrics"])
            self.assertEqual(len(data["profile"]["values"][greek]), 61)
            self.assertEqual(len(data["surface"]["values"][greek]), 24)
            self.assertEqual(len(data["surface"]["values"][greek][0]), 31)

    def test_greek_surface_rejects_invalid_contract_inputs(self):
        response = self.client.post("/api/options/greek-surface", json={
            "spot_override": 100,
            "strike": 0,
            "dte": 30,
            "iv": 0.2,
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("strike", response.get_json()["error"])

    def test_greek_relationship_returns_projected_and_exact_first_order_values(self):
        response = self.client.post("/api/options/greek-surface", json={
            "underlying": "SPY",
            "spot_override": 100,
            "strike": 100,
            "dte": 45,
            "iv": 0.24,
            "rate": 0.04,
            "div_yield": 0.01,
            "opt_type": "call",
            "model": "black-scholes",
            "price_range_pct": 15,
            "relationship": "gamma",
            "relationship_shock": 1,
        })

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        relationship = data["relationship"]
        self.assertEqual(relationship["driver"], "gamma")
        self.assertEqual(relationship["target"], "delta")
        self.assertEqual(relationship["shock_kind"], "price")
        self.assertEqual(len(relationship["profile"]["base"]), 61)
        self.assertEqual(len(relationship["surface"]["projected_change"]), 24)
        self.assertEqual(len(relationship["surface"]["projected_change"][0]), 31)
        self.assertIsNotNone(relationship["selected"]["driver"])
        self.assertIsNotNone(relationship["selected"]["projected_change"])
        midpoint = 30
        self.assertAlmostEqual(
            relationship["profile"]["projected_change"][midpoint],
            relationship["profile"]["driver"][midpoint],
            places=8,
        )
        self.assertIsNotNone(relationship["profile"]["exact"][midpoint])

    def test_greek_surface_rejects_unknown_relationship(self):
        response = self.client.post("/api/options/greek-surface", json={
            "spot_override": 100,
            "strike": 100,
            "dte": 30,
            "iv": 0.2,
            "relationship": "not-a-greek",
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("relationship", response.get_json()["error"].lower())

    def test_every_supported_greek_relationship_returns_a_selected_impact(self):
        expected_targets = {
            "gamma": "delta",
            "vanna": "delta",
            "charm": "delta",
            "vomma": "vega",
            "speed": "gamma",
            "color": "gamma",
            "zomma": "gamma",
        }
        for relationship_id, target in expected_targets.items():
            with self.subTest(relationship=relationship_id):
                response = self.client.post("/api/options/greek-surface", json={
                    "spot_override": 100,
                    "strike": 100,
                    "dte": 45,
                    "iv": 0.24,
                    "rate": 0.04,
                    "opt_type": "call",
                    "relationship": relationship_id,
                    "relationship_shock": 1,
                })

                self.assertEqual(response.status_code, 200)
                relationship = response.get_json()["relationship"]
                self.assertEqual(relationship["target"], target)
                self.assertIsNotNone(relationship["selected"]["driver"])
                self.assertIsNotNone(relationship["selected"]["exact_change"])

    def test_greek_surface_aggregates_an_iron_condor_position(self):
        expiration = (self.today + timedelta(days=45)).isoformat()
        response = self.client.post("/api/options/greek-surface", json={
            "underlying": "SPY",
            "spot_override": 100,
            "rate": 0.04,
            "div_yield": 0.01,
            "model": "black-scholes",
            "price_range_pct": 20,
            "relationship": "vanna",
            "relationship_shock": 1,
            "legs": [
                {"side": "BUY", "qty": 1, "opt_type": "PUT", "strike": 90, "expiration": expiration, "iv": 0.24},
                {"side": "SELL", "qty": 1, "opt_type": "PUT", "strike": 95, "expiration": expiration, "iv": 0.24},
                {"side": "SELL", "qty": 1, "opt_type": "CALL", "strike": 105, "expiration": expiration, "iv": 0.24},
                {"side": "BUY", "qty": 1, "opt_type": "CALL", "strike": 110, "expiration": expiration, "iv": 0.24},
            ],
        })

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["assumptions"]["position_mode"])
        self.assertEqual(data["assumptions"]["position_leg_count"], 4)
        self.assertEqual(data["assumptions"]["position_strikes"], [90, 95, 105, 110])
        self.assertEqual(data["selected_point"]["dte"], 45)
        self.assertIsNotNone(data["selected_point"]["gamma"])
        self.assertEqual(len(data["profile"]["values"]["delta"]), 61)
        self.assertEqual(len(data["surface"]["values"]["theta"]), 24)
        # Net position mark is signed dollars across every leg (defined debit/credit condor).
        self.assertEqual(len(data["profile"]["value"]), 61)
        self.assertIsNotNone(data["selected_point"]["value"])
        self.assertEqual(data["relationship"]["driver"], "vanna")
        self.assertEqual(data["relationship"]["target"], "delta")
        self.assertEqual(len(data["relationship"]["profile"]["projected"]), 61)


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
    def test_stock_leg_uses_share_quantity_and_cost_basis(self, _quote):
        payload = self.payload(self.today)
        payload["price_range"] = {"low": 90, "high": 110, "steps": 3}
        payload["day_step"] = 0
        payload["legs"] = [{
            "side": "BUY",
            "qty": 100,
            "opt_type": "STOCK",
            "strike": 0,
            "expiration": "",
            "entry_price": 100,
        }]

        response = self.client.post("/api/options/risk-graph", json=payload)

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(
            [point["pnl"] for point in data["curves"]["expiration"]],
            [-1000.0, -500.0, 0.0, 500.0, 1000.0],
        )
        self.assertEqual(data["portfolio_greeks"]["delta"], 100.0)
        self.assertEqual(data["per_leg"][0]["opt_type"], "stock")
        self.assertIn("stock", data["supported_leg_types"])

    @patch("options_api._fetch_quote", return_value={"last": 100, "div_yield": 0.01})
    def test_covered_call_combines_stock_and_option_payoffs(self, _quote):
        expiration = self.today + timedelta(days=30)
        payload = self.payload(expiration)
        payload["price_range"] = {"low": 90, "high": 130, "steps": 5}
        payload["day_step"] = 0
        payload["probability_range"] = {
            "enabled": True,
            "low": 99,
            "high": 121,
            "iv": 0.25,
            "anchor_strike": 110,
            "opt_type": "CALL",
            "itm_pct": 10,
            "otm_pct": 10,
            "lower_label": "10% OTM",
            "upper_label": "10% ITM",
        }
        payload["legs"] = [
            {
                "side": "BUY",
                "qty": 100,
                "opt_type": "STOCK",
                "strike": 0,
                "expiration": "",
                "entry_price": 95,
            },
            {
                "side": "SELL",
                "qty": 1,
                "opt_type": "CALL",
                "strike": 110,
                "expiration": expiration.isoformat(),
                "entry_price": 2,
                "iv": 0.25,
            },
        ]

        response = self.client.post("/api/options/risk-graph", json=payload)

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(
            [point["pnl"] for point in data["curves"]["expiration"]],
            [-300.0, 700.0, 1700.0, 1700.0, 1700.0],
        )
        self.assertIn(93.0, data["breakevens"])
        self.assertEqual(data["max_profit"], 1700.0)
        probability = data["probability_range"]
        self.assertEqual(probability["low"], 99.0)
        self.assertEqual(probability["high"], 121.0)
        self.assertEqual(probability["lower_label"], "10% OTM")
        self.assertEqual(probability["upper_label"], "10% ITM")
        self.assertAlmostEqual(
            probability["below_pct"] + probability["inside_pct"] + probability["above_pct"],
            100.0,
            places=1,
        )
        self.assertAlmostEqual(
            probability["probability_otm_pct"] + probability["probability_itm_pct"],
            100.0,
            places=1,
        )

    @patch("options_api._fetch_quote", return_value={"last": 725.51, "div_yield": 0.0041})
    def test_covered_call_with_put_spread_reports_whole_domain_bounds(self, _quote):
        expiration = self.today + timedelta(days=40)
        payload = {
            "underlying": "QQQ",
            "spot_override": 725.51,
            "eval_date": self.today.isoformat(),
            "model": "black-scholes",
            "rate": 0.0375,
            "div_yield": 0.0041,
            "price_range": {"low": 416.075, "high": 1033.925, "steps": 241},
            "day_step": 0,
            "legs": [
                {"side": "BUY", "qty": 100, "opt_type": "STOCK", "strike": 0,
                 "expiration": "", "entry_price": 725.51},
                {"side": "SELL", "qty": 1, "opt_type": "CALL", "strike": 780,
                 "expiration": expiration.isoformat(), "entry_price": 3.86, "iv": 0.206},
                {"side": "SELL", "qty": 1, "opt_type": "PUT", "strike": 670,
                 "expiration": expiration.isoformat(), "entry_price": 6.55, "iv": 0.271},
                {"side": "BUY", "qty": 1, "opt_type": "PUT", "strike": 720,
                 "expiration": expiration.isoformat(), "entry_price": 18.58, "iv": 0.220},
            ],
        }

        response = self.client.post("/api/options/risk-graph", json=payload)

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["theoretical_max_profit"], 4632.0)
        self.assertEqual(data["theoretical_max_loss"], -68368.0)
        self.assertFalse(data["max_profit_unlimited"])
        self.assertFalse(data["max_loss_unlimited"])
        self.assertIn(733.68, data["breakevens"])
        self.assertAlmostEqual(data["div_yield"], 0.0041)

    @patch("options_api._fetch_quote", return_value={"last": 100, "div_yield": 0.01})
    def test_risk_strategy_is_independent_of_leg_addition_order(self, _quote):
        payload = self.payload(self.today)
        payload["day_step"] = 5
        payload["price_slices"] = [{"s": 90}, {"s": 100}, {"s": 110}]
        payload["legs"] = [
            {"side": "BUY", "qty": 1, "opt_type": "PUT", "strike": 85,
             "expiration": self.expiration.isoformat(), "entry_price": 0.65, "iv": 0.28},
            {"side": "SELL", "qty": 1, "opt_type": "PUT", "strike": 90,
             "expiration": self.expiration.isoformat(), "entry_price": 1.25, "iv": 0.26},
            {"side": "SELL", "qty": 1, "opt_type": "CALL", "strike": 110,
             "expiration": self.expiration.isoformat(), "entry_price": 1.15, "iv": 0.24},
            {"side": "BUY", "qty": 1, "opt_type": "CALL", "strike": 115,
             "expiration": self.expiration.isoformat(), "entry_price": 0.55, "iv": 0.25},
        ]

        original = self.client.post("/api/options/risk-graph", json=payload)
        reversed_payload = {**payload, "legs": list(reversed(payload["legs"]))}
        reversed_response = self.client.post("/api/options/risk-graph", json=reversed_payload)

        self.assertEqual(original.status_code, 200)
        self.assertEqual(reversed_response.status_code, 200)
        original_data = original.get_json()
        reversed_data = reversed_response.get_json()
        for field in (
            "curves", "breakevens", "max_profit", "max_loss",
            "theoretical_max_profit", "theoretical_max_loss",
            "max_profit_unlimited", "max_loss_unlimited",
            "portfolio_greeks", "price_slices",
        ):
            self.assertEqual(original_data[field], reversed_data[field], field)

    def test_probability_otm_changes_with_volatility(self):
        low_vol = options_api._lognormal_cdf(100, 110, 0.10, 30 / 365, 0.04, 0.01)
        high_vol = options_api._lognormal_cdf(100, 110, 0.50, 30 / 365, 0.04, 0.01)

        self.assertGreater(low_vol, high_vol)

    @patch("options_api._fetch_quote", return_value={"last": 100, "div_yield": 0.01})
    def test_probability_mode_returns_adjustable_band_and_touch_probability(self, _quote):
        expiration = self.today + timedelta(days=45)
        payload = self.payload(expiration)
        payload["probability_range"] = {
            "enabled": True,
            "range_mode": "probability",
            "probability_mode": "TOUCH",
            "range_pct": 68.27,
            "iv": 0.25,
            "anchor_strike": 110,
            "opt_type": "CALL",
        }

        response = self.client.post("/api/options/risk-graph", json=payload)

        self.assertEqual(response.status_code, 200)
        probability = response.get_json()["probability_range"]
        self.assertEqual(probability["range_mode"], "probability")
        self.assertEqual(probability["probability_mode"], "TOUCH")
        self.assertAlmostEqual(probability["inside_pct"], 68.27, places=1)
        self.assertGreater(probability["high"], probability["low"])
        self.assertGreaterEqual(
            probability["probability_touch_pct"],
            probability["probability_itm_pct"],
        )
        self.assertLessEqual(probability["probability_touch_pct"], 100.0)

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
