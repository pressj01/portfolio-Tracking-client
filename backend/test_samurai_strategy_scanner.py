import unittest
from unittest.mock import patch

from samurai_strategy_scanner import _profile, _same_expiration_legs, run_samurai_strategy_scan


def contract(strike, option_type):
    distance = abs(strike - 100)
    intrinsic = max(100 - strike, 0) if option_type == "put" else max(strike - 100, 0)
    mid = max(0.5, 4.0 - distance * 0.12 + intrinsic * 0.05)
    delta = (0.5 if option_type == "call" else -0.5) - (strike - 100) * 0.02
    return {
        "strike": strike, "bid": max(0.05, mid - 0.1), "ask": mid + 0.1,
        "mid": mid, "last": mid, "iv": 0.25, "delta": delta,
        "volume": 500, "open_interest": 1000,
    }


def chain(expiration="2026-09-18"):
    strikes = list(range(80, 125, 5))
    return {
        "ticker": "XYZ", "expiration": expiration, "spot": 100,
        "calls": [contract(strike, "call") for strike in strikes],
        "puts": [contract(strike, "put") for strike in strikes],
    }


class SamuraiStrategyScannerTests(unittest.TestCase):
    def test_bull_call_builds_long_lower_and_short_higher_call(self):
        legs = _same_expiration_legs("bull-call-spread", chain(), {
            "min_moneyness_pct": -15, "max_moneyness_pct": 15,
            "bid_ask_level": "Mid",
        })
        self.assertEqual([(leg["option_type"], leg["qty"]) for leg in legs], [("call", 1), ("call", -1)])
        self.assertLess(legs[0]["strike"], legs[1]["strike"])

    def test_call_butterfly_is_balanced_one_two_one(self):
        legs = _same_expiration_legs("call-butterfly", chain(), {
            "min_moneyness_pct": 0, "max_moneyness_pct": 15,
            "bid_ask_level": "Mid",
        })
        self.assertEqual([leg["qty"] for leg in legs], [1, -2, 1])
        self.assertEqual(legs[1]["strike"] - legs[0]["strike"], legs[2]["strike"] - legs[1]["strike"])

    @patch("samurai_strategy_scanner._fetch_quote", return_value={"last": 100, "name": "Example"})
    @patch("samurai_strategy_scanner._fetch_expirations", return_value=["2026-09-18", "2026-10-16"])
    @patch("samurai_strategy_scanner._fetch_chain", side_effect=lambda ticker, expiration: chain(expiration))
    def test_calendar_uses_front_and_back_expirations(self, fetch_chain, fetch_expirations, fetch_quote):
        result = run_samurai_strategy_scan({
            "generic_strategy": "long-call-calendar", "tickers": ["XYZ"],
            "min_dte": 7, "target_dte": 35, "max_dte": 60,
            "far_target_dte": 70, "min_expiration_gap_days": 20,
        })
        self.assertGreaterEqual(len(result["rows"]), 1)
        expirations = {leg["expiration"] for leg in result["rows"][0]["legs"]}
        self.assertEqual(expirations, {"2026-09-18", "2026-10-16"})

    def test_naked_call_reports_unbounded_max_loss(self):
        legs = _same_expiration_legs("naked-call", chain(), {
            "min_moneyness_pct": 0, "max_moneyness_pct": 15,
            "bid_ask_level": "Mid",
        })
        profile = _profile(legs, 100, "2026-09-18", 0.25)
        self.assertIsNone(profile["max_loss_dollars"])
        self.assertTrue(profile["max_loss_unbounded"])
        self.assertIsNone(profile["prob_max_loss"])

    def test_short_option_profile_constructs_near_requested_delta(self):
        legs = _same_expiration_legs("naked-call", chain(), {
            "min_moneyness_pct": 0,
            "max_moneyness_pct": 15,
            "reference_delta_mode": "short",
            "target_reference_delta": 0.10,
            "bid_ask_level": "Mid",
        })
        self.assertAlmostEqual(abs(legs[0]["delta"]), 0.10)
        self.assertEqual(legs[0]["qty"], -1)


if __name__ == "__main__":
    unittest.main()
