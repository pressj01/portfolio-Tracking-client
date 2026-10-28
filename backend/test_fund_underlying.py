"""TR/Und: a fund's total return over its own underlying's.

The underlying is the fund's documented exposure, never the NAV screen's
Include (manual) benchmark box, which can hold a legacy default unrelated to
the fund (QQQ for the semiconductor fund CHPY).
"""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nav_assessment_service import build_payload, guidance, underlying_pending, underlying_plan
from nav_price_screen import UNDERLYING_RATIO_FLOOR, underlying_comparison

START, END = dt.date(2026, 1, 2), dt.date(2026, 1, 7)
DAYS = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]


def market(closes, distributions=(), days=DAYS):
    return {"basis": "split_adjusted_market_price", "distributions_complete": True, "corporate_actions_resolved": True,
            "prices": [{"date": day, "close": close} for day, close in zip(days, closes)],
            "distributions": [{"date": day, "amount": amount} for day, amount in distributions]}


def loader(series):
    def load(symbol, first, last):
        return {day: value for day, value in series[symbol].items()
                if first <= dt.date.fromisoformat(day) <= last}
    return load


def plan_for(ticker, info=None, choice=None):
    info = info or {}
    return underlying_pending(underlying_plan(ticker, info, guidance(ticker, info), choice),
                              guidance(ticker, info)["security_kind"])


class UnderlyingPlanTest(unittest.TestCase):
    def test_manual_benchmark_does_not_replace_the_documented_underlying(self):
        for ticker, legacy, expected in [("CHPY", "QQQ", "SOXX"), ("KYLD", "ULTY", "SPY"), ("EGGQ", "SPY", "QQQ")]:
            with self.subTest(ticker=ticker):
                plan = plan_for(ticker, {"nav_erosion_scope": "test", "nav_benchmark_override": legacy})
                self.assertEqual(plan["selected"], expected)
                self.assertEqual(plan["source"], "documented")

    def test_manual_benchmark_is_the_last_resort_for_an_unknown_fund(self):
        plan = plan_for("ZZZZ", {"nav_erosion_scope": "test", "nav_benchmark_override": "xle"})
        self.assertEqual(plan["legs"], [{"symbol": "XLE", "weight": 1.0}])
        self.assertEqual(plan["source"], "manual")
        self.assertEqual(plan_for("ZZZZ")["status"], "not_applicable")

    def test_a_saved_reference_choice_wins(self):
        plan = plan_for("CHPY", choice={"mode": "symbol", "symbol": "SMH"})
        self.assertEqual(plan["selected"], "SMH")
        self.assertEqual(plan["source"], "saved")

    def test_companies_have_no_underlying(self):
        for ticker in ("ARCC", "DX"):
            with self.subTest(ticker=ticker):
                plan = plan_for(ticker)
                self.assertEqual(plan["status"], "not_applicable")
                self.assertIn("company", plan["reason"])


class UnderlyingComparisonTest(unittest.TestCase):
    def test_distributions_are_reinvested_like_the_underlying(self):
        # 100 -> 90 with a 10 payout, then 90 -> 99: reinvested +10%, cash only +9%.
        source = market([100, 90, 90, 99], [("2026-01-05", 10)])
        refs = loader({"SOXX": dict(zip(DAYS, [100, 105, 110, 120]))})
        result = underlying_comparison(source, START, END, plan_for("CHPY"), refs)
        self.assertEqual(result["status"], "available")
        self.assertAlmostEqual(result["fund_return"], 0.10)
        self.assertAlmostEqual(result["underlying_return"], 0.20)
        self.assertAlmostEqual(result["ratio"], 0.5)
        self.assertAlmostEqual(result["gap"], -0.10)
        self.assertFalse(result["shorter_history"])

    def test_falling_underlying_gives_only_the_gap(self):
        source = market([100, 100, 100, 100.5])
        refs = loader({"SOXX": dict(zip(DAYS, [100, 98, 96, 94]))})
        result = underlying_comparison(source, START, END, plan_for("CHPY"), refs)
        self.assertIsNone(result["ratio"])
        self.assertAlmostEqual(result["gap"], 0.065)
        self.assertEqual(result["ratio_floor"], UNDERLYING_RATIO_FLOOR)

    def test_weighted_legs_compound_daily(self):
        source = market([100, 100, 100, 100])
        refs = loader({"A": dict(zip(DAYS, [100, 110, 110, 110])), "B": dict(zip(DAYS, [100, 100, 100, 120]))})
        plan = {"selected": "Basket", "legs": [{"symbol": "A", "weight": .5}, {"symbol": "B", "weight": .5}],
                "source": "saved", "fit": "Custom daily context", "why": None}
        result = underlying_comparison(source, START, END, plan, refs)
        self.assertAlmostEqual(result["underlying_return"], 1.05 * 1.10 - 1)

    def test_compares_on_the_latest_close_both_have(self):
        # The underlying has not published the last bar yet.
        source = market([100, 101, 102, 103])
        refs = loader({"SOXX": dict(zip(DAYS[:3], [100, 102, 104]))})
        result = underlying_comparison(source, START, END, plan_for("CHPY"), refs)
        self.assertEqual(result["end"], "2026-01-06")
        self.assertAlmostEqual(result["fund_return"], 0.02)

    def test_a_fund_younger_than_the_window_is_flagged(self):
        source = market([100, 101, 102], days=DAYS[1:])
        refs = loader({"SOXX": dict(zip(DAYS, [100, 101, 102, 103]))})
        result = underlying_comparison(source, START, END, plan_for("CHPY"), refs)
        self.assertTrue(result["shorter_history"])
        self.assertEqual(result["start"], "2026-01-05")

    def test_crypto_closes_are_not_matched_to_a_fund_close(self):
        result = underlying_comparison(market([100, 101, 102, 103]), START, END, plan_for("SOLM"), loader({}))
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("Crypto", result["reason"])


class PayloadTest(unittest.TestCase):
    def test_tr_und_uses_soxx_while_the_nav_screen_keeps_the_manual_qqq(self):
        holdings = {"CHPY": {"current_value": 100, "current_price": 100, "quantity": 1,
                             "nav_erosion_scope": "test", "nav_benchmark_override": "QQQ"}}
        refs = loader({"SOXX": dict(zip(DAYS, [100, 110, 115, 120])), "QQQ": dict(zip(DAYS, [100, 101, 102, 103]))})
        payload = build_payload(holdings, lambda *a: None, refs, window="CUSTOM", start_date=START, as_of=END,
                                market_loader=lambda *a: market([100, 104, 106, 110]))
        row = payload["results"][0]
        self.assertEqual(row["reference"]["selected"], "QQQ")
        self.assertEqual(row["underlying"]["selected"], "SOXX")
        self.assertAlmostEqual(row["underlying"]["underlying_return"], 0.20)
        self.assertAlmostEqual(row["underlying"]["ratio"], 0.5)

    def test_skipped_fund_says_why_it_is_blank(self):
        holdings = {"CHPY": {"current_value": 100, "current_price": 100, "quantity": 1, "nav_erosion_scope": "skip"}}
        payload = build_payload(holdings, lambda *a: None, loader({}), window="CUSTOM", start_date=START, as_of=END,
                                market_loader=lambda *a: market([100, 101, 102, 103]))
        self.assertIn("Skipped", payload["results"][0]["underlying"]["reason"])


if __name__ == "__main__":
    unittest.main()
