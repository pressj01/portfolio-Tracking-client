import math
import threading
import unittest
from datetime import date, timedelta
from statistics import NormalDist
from unittest.mock import patch

from options_pricing import black_scholes
from samurai_strategy_scanner import (
    _prime_option_ticker,
    _profile,
    _same_expiration_legs,
    run_samurai_strategy_scan,
)


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

    @patch("samurai_strategy_scanner._prime_option_ticker",
           return_value=(object(), ["2026-09-18", "2026-10-16"], None, None))
    @patch("samurai_strategy_scanner._fetch_quote", return_value={"last": 100, "name": "Example"})
    @patch("samurai_strategy_scanner._fetch_chain",
           side_effect=lambda ticker, expiration, **kwargs: chain(expiration))
    def test_calendar_uses_front_and_back_expirations(self, fetch_chain, fetch_quote, prime):
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


SPOT, VOL, RATE, DIV_YIELD = 100.0, 0.30, 0.0375, 0.02


def fair_chain(expiration):
    """A chain priced exactly at Black-Scholes, so odds have closed forms."""
    dte = (date.fromisoformat(expiration) - date.today()).days
    years = dte / 365.0

    def contract(strike, option_type):
        greeks = black_scholes(SPOT, strike, years, RATE, DIV_YIELD, VOL, option_type)
        mid = max(0.01, greeks["price"])
        return {
            "strike": strike, "bid": round(mid - 0.05, 4), "ask": round(mid + 0.05, 4),
            "mid": mid, "last": mid, "iv": VOL, "delta": greeks["delta"],
            "volume": 500, "open_interest": 1000,
        }

    strikes = [70 + 2.5 * index for index in range(25)]
    return {
        "ticker": "XYZ", "expiration": expiration, "spot": SPOT,
        "div_yield": DIV_YIELD, "rate": RATE, "T": years,
        "calls": [contract(strike, "call") for strike in strikes],
        "puts": [contract(strike, "put") for strike in strikes],
    }


def below_strike_odds(strike, dte, spot=SPOT):
    """Closed-form P(S_T < strike) under the same risk-neutral lognormal."""
    years = dte / 365.0
    d2 = (
        math.log(spot / strike)
        + (RATE - DIV_YIELD - 0.5 * VOL * VOL) * years
    ) / (VOL * math.sqrt(years))
    return NormalDist().cdf(-d2) * 100.0


def scan_fair(kind, **overrides):
    expirations = [
        (date.today() + timedelta(days=days)).isoformat() for days in (30, 45, 75)
    ]
    chains = {expiration: fair_chain(expiration) for expiration in expirations}
    payload = {
        "generic_strategy": kind, "tickers": ["XYZ"],
        "min_dte": 7, "max_dte": 60, "target_dte": 30,
        "far_target_dte": 75, "min_expiration_gap_days": 20,
        **overrides,
    }
    with patch(
        "samurai_strategy_scanner._prime_option_ticker",
        return_value=(object(), expirations, None, None),
    ), patch(
        "samurai_strategy_scanner._fetch_quote",
        return_value={"last": SPOT, "name": "Example"},
    ), patch(
        "samurai_strategy_scanner._fetch_chain",
        side_effect=lambda ticker, expiration, **kwargs: chains[expiration],
    ):
        return run_samurai_strategy_scan(payload)


class GenericStrategyProbabilityTests(unittest.TestCase):
    """The odds a long call reports have to survive a closed-form check."""

    def test_long_call_max_loss_odds_match_the_closed_form(self):
        rows = scan_fair("long-call")["rows"]
        self.assertTrue(rows)
        for row in rows:
            expected = below_strike_odds(row["legs"][0]["strike"], row["dte"])
            self.assertAlmostEqual(row["prob_max_loss"], expected, delta=0.05)
            # A long call expires worthless exactly when it takes its maximum
            # loss, so these two readings cannot disagree.
            self.assertAlmostEqual(row["prob_otm"], row["prob_max_loss"], delta=0.05)

    def test_long_call_break_even_odds_match_the_closed_form(self):
        rows = scan_fair("long-call")["rows"]
        self.assertTrue(rows)
        for row in rows:
            leg = row["legs"][0]
            break_even = leg["strike"] + leg["entry_price"]
            expected = 100.0 - below_strike_odds(break_even, row["dte"])
            self.assertAlmostEqual(row["prob_success"], expected, delta=0.15)
            self.assertAlmostEqual(row["probability_profit"], expected, delta=0.15)
            self.assertAlmostEqual(
                row["prob_success"] + row["prob_failure"], 100.0, delta=0.01
            )

    def test_two_expirations_do_not_report_identical_odds(self):
        """Counting a fixed sample used to quantise these into one bucket."""
        rows = scan_fair("long-call")["rows"]
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["prob_max_loss"], rows[1]["prob_max_loss"])
        self.assertNotEqual(rows[0]["prob_success"], rows[1]["prob_success"])

    def test_dividend_yield_lowers_the_odds_a_long_call_pays_off(self):
        """Dropping the yield from the drift quietly flatters every payer."""
        row = scan_fair("long-call")["rows"][0]
        leg = row["legs"][0]
        years = row["dte"] / 365.0
        without_yield = NormalDist().cdf(
            (
                math.log(SPOT / (leg["strike"] + leg["entry_price"]))
                + (RATE - 0.5 * VOL * VOL) * years
            ) / (VOL * math.sqrt(years))
        ) * 100.0
        self.assertLess(row["prob_success"], without_yield)

    def test_expected_value_is_the_carry_on_a_fairly_priced_call(self):
        """A call bought at fair value earns only the rate on its premium."""
        row = scan_fair("long-call")["rows"][0]
        debit = row["legs"][0]["entry_price"]
        carry = debit * (math.exp(RATE * row["dte"] / 365.0) - 1.0) * 100.0
        self.assertAlmostEqual(row["expected_value_dollars"], carry, delta=0.05)

    def test_unbounded_sides_report_no_probability(self):
        long_call = scan_fair("long-call")["rows"][0]
        self.assertTrue(long_call["max_profit_unbounded"])
        self.assertIsNone(long_call["prob_max_profit"])
        naked_call = scan_fair("naked-call")["rows"][0]
        self.assertTrue(naked_call["max_loss_unbounded"])
        self.assertIsNone(naked_call["prob_max_loss"])

    def test_calendars_keep_the_two_expiration_model(self):
        """Legs at different expirations are outside the single-expiry model."""
        row = scan_fair("long-call-calendar")["rows"][0]
        self.assertEqual(len({leg["expiration"] for leg in row["legs"]}), 2)
        self.assertIsNone(row.get("prob_success"))
        self.assertIsNotNone(row["probability_profit"])

    def test_legs_carry_no_private_fields(self):
        row = scan_fair("long-call")["rows"][0]
        for leg in row["legs"]:
            self.assertFalse([key for key in leg if key.startswith("_")])


class ScanSessionTests(unittest.TestCase):
    def test_one_catalog_download_serves_the_whole_ticker(self):
        """A fresh Ticker per chain re-downloads the expiration catalog."""
        expirations = [
            (date.today() + timedelta(days=days)).isoformat() for days in (30, 45)
        ]
        chains = {expiration: fair_chain(expiration) for expiration in expirations}
        session = object()
        sessions = []

        def fetch_chain(ticker, expiration, session_ticker=None, chain=None):
            sessions.append(session_ticker)
            return chains[expiration]

        with patch(
            "samurai_strategy_scanner._prime_option_ticker",
            return_value=(session, expirations, None, None),
        ) as prime, patch(
            "samurai_strategy_scanner._fetch_quote",
            return_value={"last": SPOT, "name": "Example"},
        ), patch("samurai_strategy_scanner._fetch_chain", side_effect=fetch_chain):
            run_samurai_strategy_scan({
                "generic_strategy": "long-call", "tickers": ["XYZ"],
                "min_dte": 7, "max_dte": 60, "target_dte": 30,
            })

        self.assertEqual(prime.call_count, 1)
        self.assertEqual(sessions, [session, session])

    def test_the_default_chain_is_reused_when_it_is_a_wanted_expiration(self):
        expiration = (date.today() + timedelta(days=30)).isoformat()
        default_chain = object()
        passed = []

        def fetch_chain(ticker, exp, session_ticker=None, chain=None):
            passed.append(chain)
            return fair_chain(exp)

        with patch(
            "samurai_strategy_scanner._prime_option_ticker",
            return_value=(object(), [expiration], default_chain, None),
        ), patch(
            "samurai_strategy_scanner._option_bundle_expiration",
            return_value=expiration,
        ), patch(
            "samurai_strategy_scanner._fetch_quote",
            return_value={"last": SPOT, "name": "Example"},
        ), patch("samurai_strategy_scanner._fetch_chain", side_effect=fetch_chain):
            run_samurai_strategy_scan({
                "generic_strategy": "long-call", "tickers": ["XYZ"],
                "min_dte": 7, "max_dte": 60, "target_dte": 30,
            })

        self.assertEqual(passed, [default_chain])

    def test_a_throttled_catalog_is_reported_as_an_outage(self):
        """A rate limit is not a ticker without options in that DTE range."""
        with patch(
            "samurai_strategy_scanner._prime_option_ticker",
            return_value=(
                object(), [], None, "Option chain unavailable: Too Many Requests",
            ),
        ):
            result = run_samurai_strategy_scan({
                "generic_strategy": "long-call", "tickers": ["XYZ"],
            })
        self.assertEqual(result["rows"], [])
        self.assertIn("Too Many Requests", result["unavailable"][0]["reason"])

    def test_an_empty_catalog_is_not_reported_as_a_dte_miss(self):
        with patch(
            "samurai_strategy_scanner._prime_option_ticker",
            return_value=(object(), [], None, None),
        ):
            result = run_samurai_strategy_scan({
                "generic_strategy": "long-call", "tickers": ["XYZ"],
            })
        self.assertEqual(
            result["unavailable"][0]["reason"], "No listed option expirations"
        )

    def test_priming_reports_a_failed_catalog_instead_of_swallowing_it(self):
        class Throttled:
            def option_chain(self, date=None):
                raise RuntimeError("Too Many Requests")

        with patch("samurai_strategy_scanner.yf.Ticker", return_value=Throttled()), \
             patch("samurai_strategy_scanner._cache_get", return_value=None):
            session, catalog, default_chain, outage = _prime_option_ticker("XYZ")
        self.assertEqual(catalog, [])
        self.assertIsNone(default_chain)
        self.assertIn("Too Many Requests", outage)

    def test_tickers_are_priced_concurrently(self):
        expiration = (date.today() + timedelta(days=30)).isoformat()
        tickers = [f"T{index}" for index in range(8)]
        threads = set()

        def prime(ticker):
            threads.add(threading.get_ident())
            return object(), [expiration], None, None

        with patch(
            "samurai_strategy_scanner._prime_option_ticker", side_effect=prime,
        ), patch(
            "samurai_strategy_scanner._fetch_quote",
            return_value={"last": SPOT, "name": "Example"},
        ), patch(
            "samurai_strategy_scanner._fetch_chain",
            side_effect=lambda ticker, exp, **kwargs: fair_chain(exp),
        ):
            result = run_samurai_strategy_scan({
                "generic_strategy": "long-call", "tickers": tickers,
                "min_dte": 7, "max_dte": 60, "target_dte": 30,
            })

        self.assertEqual(len(result["rows"]), len(tickers))
        self.assertGreater(len(threads), 1)


if __name__ == "__main__":
    unittest.main()
