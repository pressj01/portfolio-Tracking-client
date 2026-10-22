import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nav_assessment_service import build_payload, guidance, reference_plan
from nav_auto_guidance import parse_option_position, strategy_from_holdings, summarize_option_holdings
from nav_price_screen import screen
from test_nav_price_screen import example


def fund(description, **profile):
    return {"description": description, "security_profile": profile, "current_value": 100, "quantity": 1}


class InferredGuidanceTest(unittest.TestCase):
    """Funds outside the reviewed registry, like a Shear Group account's."""

    def plan(self, ticker, info):
        return reference_plan(ticker, info, guidance(ticker, info))

    def test_plain_index_bond_and_mutual_funds_get_an_automatic_reference(self):
        cases = {
            "SPYM": (fund("STATE STREET SPDR PORT S&P 500 ETF", security_type="ETF"), "SPY"),
            "SPAB": (fund("STATE STREET SPDR PORTFOLIO AGGREGATE BOND ETF", quote_type="ETF",
                          category="Intermediate Core Bond"), "AGG"),
            "WOBDX": (fund("JPMORGAN CORE BOND CL I", quote_type="MUTUALFUND"), "AGG"),
            "FESCX": (fund("FIRST EAGLE SMALL CAP OPPTY CL I", quote_type="MUTUALFUND"), "IWM"),
            "SGOIX": (fund("FIRST EAGLE OVERSEAS CL I", quote_type="MUTUALFUND"), "EFA"),
            "TMCPX": (fund("TOUCHSTONE MID CAP CL Y", quote_type="MUTUALFUND"), "IJH"),
            "PBTP": (fund("INVESCO 0-5 YR U S TIPS ETF", category="Short-Term Inflation-Protected Bond"), "VTIP"),
        }
        for ticker, (info, expected) in cases.items():
            with self.subTest(ticker=ticker):
                plan = self.plan(ticker, info)
                self.assertEqual(plan["legs"], [{"symbol": expected, "weight": 1.0}])
                self.assertTrue(plan["automatic"])
                self.assertTrue(plan["inferred"])
                self.assertEqual(guidance(ticker, info)["security_kind"], "fund")
                self.assertEqual(plan["screen_strategy"]["kind"], "capital_review")

    def test_inferred_reference_never_claims_the_verified_exposure_fit(self):
        plan = self.plan("SPYM", fund("STATE STREET SPDR PORT S&P 500 ETF", security_type="ETF"))
        self.assertNotEqual(plan["fit"], "Exposure reference")

    def test_long_short_fund_is_net_long_not_inverse(self):
        plan = self.plan("NLSIX", fund("NEUBERGER LONG SHORT INSTL CL", quote_type="MUTUALFUND"))
        self.assertEqual(plan["legs"], [{"symbol": "SPY", "weight": 0.5}])

    def test_fund_that_is_its_own_category_benchmark_uses_an_equivalent(self):
        plan = self.plan("EFV", fund("ISHARES TR EAFE VALUE ETF", quote_type="ETF", category="Foreign Large Value"))
        self.assertEqual(plan["legs"][0]["symbol"], "EFA")

    def test_option_income_funds_are_screened_as_call_income_with_their_underlying(self):
        cases = {
            "GPIQ": (fund("GS NASDAQ-100 PR INC ETF-USD", quote_type="ETF", category="Derivative Income"), "QQQ"),
            "AMZP": (fund("Kurv Yield Premium Strategy Amazon (AMZN) ETF", quote_type="ETF", category="Derivative Income"), "AMZN"),
            "XBCI": (fund("NEOS Boosted Bitcoin High Income ETF", quote_type="ETF", category="Digital Assets"), "IBIT"),
        }
        for ticker, (info, expected) in cases.items():
            with self.subTest(ticker=ticker):
                plan = self.plan(ticker, info)
                self.assertEqual(plan["legs"][0]["symbol"], expected)
                self.assertEqual(plan["screen_strategy"]["kind"], "covered_call")
                self.assertFalse(plan["requires_aligned_crypto_close"])

    def test_inverse_option_income_gets_no_automatic_reference(self):
        plan = self.plan("YQQQ", fund("YieldMax Short N100 Option Income Strategy ETF", quote_type="ETF",
                                      category="Derivative Income"))
        self.assertEqual(plan["legs"], [])

    def test_money_market_and_company_stock_are_not_applicable(self):
        info = {
            "SPAXX": fund("FIDELITY GOVERNMENT MONEY MARKET", quote_type="MONEYMARKET"),
            "AGXPF": fund("SILVER X MINING CORP"),
            "CIM-PRB": fund("CIM 8 PERP PD"),
        }
        payload = build_payload(info, lambda *a: None, lambda *a: {}, cash=0)
        for row in payload["results"]:
            with self.subTest(ticker=row["ticker"]):
                self.assertEqual(row["capital_status"], "not_applicable")
                if row["ticker"] != "SPAXX":
                    # A misread fund can still be screened.
                    self.assertIn("Include (manual)", row["reason"])

    def test_a_holding_with_no_stored_data_still_needs_verification(self):
        self.assertIsNone(guidance("UNLISTED", {})["suggestion"])
        self.assertEqual(guidance("UNLISTED", {})["security_kind"], "unknown")


class ManualIncludeTest(unittest.TestCase):
    """Include (manual) = screen against the holding's own benchmark box."""

    def test_manual_benchmark_replaces_the_automatic_reference(self):
        info = {"nav_erosion_scope": "test", "nav_benchmark_override": "xle"}
        plan = reference_plan("SRV", info, guidance("SRV", info))
        self.assertTrue(plan["manual"])
        self.assertFalse(plan["automatic"])
        self.assertEqual(plan["legs"], [{"symbol": "XLE", "weight": 1.0}])
        self.assertIsNone(plan["legacy_notice"])

    def test_auto_scope_keeps_the_benchmark_but_explains_it_is_unused(self):
        info = {"nav_erosion_scope": "auto", "nav_benchmark_override": "QQQ"}
        plan = reference_plan("CHPY", info, guidance("CHPY", info))
        self.assertFalse(plan["manual"])
        self.assertEqual(plan["legs"][0]["symbol"], "SOXX")
        self.assertIn("Include (manual)", plan["legacy_notice"])

    def test_known_bad_manual_benchmark_falls_back_to_automatic(self):
        info = {"nav_erosion_scope": "test", "nav_benchmark_override": "SPCX"}
        plan = reference_plan("XSPI", info, guidance("XSPI", info))
        self.assertFalse(plan["manual"])
        self.assertIsNone(plan["warning"])
        self.assertEqual(plan["legs"][0]["symbol"], "SPY")
        self.assertIn("SPCX", plan["legacy_notice"])

    def test_saved_reference_choice_still_wins_over_the_manual_benchmark(self):
        info = {"nav_erosion_scope": "test", "nav_benchmark_override": "XLE"}
        plan = reference_plan("SRV", info, guidance("SRV", info), {"mode": "symbol", "symbol": "AMLP"})
        self.assertFalse(plan["manual"])
        self.assertEqual(plan["legs"][0]["symbol"], "AMLP")

    def test_manual_include_screens_an_unrecognized_or_stock_holding(self):
        for ticker, info in [("UNLISTED", {}), ("JNJ", {})]:
            with self.subTest(ticker=ticker):
                manual = {**info, "nav_erosion_scope": "test", "nav_benchmark_override": "SPY", "current_value": 100}
                guide = guidance(ticker, manual)
                self.assertEqual(guide["security_kind"], "fund")
                self.assertEqual(guide["screen_strategy"]["kind"], "covered_call")
                row = build_payload({ticker: manual}, lambda *a: None, lambda *a: {}, cash=0)["results"][0]
                self.assertEqual(row["capital_status"], "unconfirmed")
                self.assertEqual(row["reference"]["legs"], [{"symbol": "SPY", "weight": 1.0}])
                self.assertEqual(row["nav_benchmark_override"], "SPY")


class HoldingsStrategyTest(unittest.TestCase):
    """Written options in a fund's disclosed holdings settle its strategy."""

    def test_issuer_formats_parse_and_company_names_do_not(self):
        cases = [
            (("NDX260918C29075000", "NDX US 09/18/26 C29075", -0.62), ("C", "short", 29075.0)),
            (("2GLD260918C00382000", "GLD 09/18/2026 382 C", -0.52), ("C", "short", 382.0)),
            (("", "STATE STREET ENERGY SELECT SEC AUG26 62 CALL", -0.01), ("C", "short", 62.0)),
            (("", "NVIDIA C PUT OPT 08/26 210", 0.06), ("P", "long", 210.0)),
            (("", "Put On S&P 500 Jul26", 0.37), ("P", "long", None)),
            (("SPXW260813P06375000", "SPXW US 08/13/26 P6375", 0.0), ("P", "unknown", 6375.0)),
        ]
        for row, (kind, side, strike) in cases:
            with self.subTest(name=row[1]):
                option = parse_option_position(*row)
                self.assertEqual((option["type"], option["side"], option["strike"]), (kind, side, strike))
        for row in [("OPCH", "Option Care Health Inc.", 0.1), ("CALY", "Callaway Golf Co.", 0.08), ("603986C1", "GigaDevice", 2.2)]:
            self.assertIsNone(parse_option_position(*row))

    def test_written_calls_make_a_call_seller(self):
        summary = summarize_option_holdings([("SPX260918C07610000", "", -0.6), ("SPY", "SPDR", 98.0)])
        self.assertEqual(strategy_from_holdings(summary)["answer"], "calls")

    def test_synthetic_long_put_is_not_put_selling(self):
        # ETTY/SOLM: long call + short put at one strike = synthetic stock.
        summary = summarize_option_holdings([
            ("4ETHA260918C00011050", "", 22.74), ("4ETHA260918P00011050", "", -1.16), ("4ETHA260804C00015350", "", -0.02)])
        self.assertEqual((summary["short_calls"], summary["short_puts"]), (1, 0))
        self.assertEqual(strategy_from_holdings(summary)["answer"], "calls")

    def test_synthetic_short_call_and_protective_put_spread_are_not_income_selling(self):
        summary = summarize_option_holdings([
            ("MSTR261016C00300000", "", -10.0), ("MSTR261016P00300000", "", 10.0),   # synthetic short
            ("NDX260918P25000000", "", -0.42), ("NDX260918P26800000", "", 1.04)])    # bought protection
        self.assertEqual((summary["short_calls"], summary["short_puts"]), (0, 0))
        self.assertIsNone(strategy_from_holdings(summary))

    def test_written_puts_only_is_a_put_seller_with_capital_review(self):
        held = strategy_from_holdings(summarize_option_holdings([("WMT261002P00106000", "", -0.07)]), "2026-10-01")
        self.assertEqual((held["answer"], held["kind"]), ("puts", "capital_review"))
        self.assertIn("2026-10-01", held["reason"])

    def test_zero_weight_rows_do_not_decide(self):
        self.assertIsNone(strategy_from_holdings(summarize_option_holdings([("SPXW260813P06375000", "", 0.0)])))


class StrategyOrderTest(unittest.TestCase):
    """User answer > reviewed registry > holdings > name/category > ask."""

    def calls(self):
        return {"positions": 2, "short_calls": 2, "short_puts": 0, "long_only": False, "unknown_side": 0}

    def test_holdings_settle_a_registry_fund_with_no_documented_strategy(self):
        guide = guidance("ETTY", {"security_profile": {"option_holdings": self.calls()}})
        self.assertEqual(guide["strategy_source"], "holdings")
        self.assertEqual(guide["screen_strategy"]["kind"], "covered_call")

    def test_documented_registry_strategy_is_not_overridden_by_holdings(self):
        puts = {"positions": 1, "short_calls": 0, "short_puts": 1, "long_only": False, "unknown_side": 0}
        guide = guidance("QQQI", {"security_profile": {"option_holdings": puts}})
        self.assertEqual(guide["strategy_source"], "registry")
        self.assertEqual(guide["screen_strategy"]["kind"], "covered_call")

    def test_holdings_override_a_name_inference(self):
        info = fund("STATE STREET SPDR PORT S&P 500 ETF", security_type="ETF", option_holdings=self.calls())
        guide = guidance("SPYM", info)
        self.assertEqual((guide["strategy_source"], guide["screen_strategy"]["kind"]), ("holdings", "covered_call"))

    def test_undetectable_registry_fund_asks_the_user(self):
        guide = guidance("EGGQ", {"description": "NESTYIELD VISIONARY ETF"})
        self.assertEqual(guide["strategy_source"], "unverified")
        self.assertEqual(guide["screen_strategy"]["kind"], "needs_verification")

    def test_registry_fund_named_as_option_income_is_detected(self):
        guide = guidance("EGGQ", {"description": "NestYield Visionary Covered Call ETF"})
        self.assertEqual((guide["strategy_source"], guide["screen_strategy"]["kind"]), ("inferred", "covered_call"))

    def test_user_answer_wins_and_each_answer_maps_to_a_screen(self):
        expected = {"calls": "covered_call", "both": "covered_call", "puts": "capital_review", "none": "capital_review"}
        for answer, kind in expected.items():
            with self.subTest(answer=answer):
                guide = guidance("QQQI", {"strategy_answer": {"answer": answer}})
                self.assertEqual((guide["strategy_source"], guide["strategy_answer"]), ("user", answer))
                self.assertEqual(guide["screen_strategy"]["kind"], kind)
        self.assertTrue(guidance("QQQI", {"strategy_answer": {"answer": "none"}})["screen_strategy"]["payout_driven_only"])

    def test_answering_calls_for_an_unidentified_holding_screens_it_as_a_fund(self):
        guide = guidance("UNLISTED", {"strategy_answer": {"answer": "calls"}})
        self.assertEqual(guide["security_kind"], "fund")


class PlainFundLagTest(unittest.TestCase):
    def plain_plan(self):
        info = fund("STATE STREET SPDR PORT S&P 500 ETF", security_type="ETF")
        return reference_plan("SPYM", info, guidance("SPYM", info))

    def test_plain_fund_that_only_lagged_its_reference_is_not_a_review_candidate(self):
        src, start, end, loader = example(reference_growth=.001, amount=.01)
        result = screen(src, start, end, self.plain_plan(), loader)
        self.assertFalse(result["review_candidate"])
        self.assertEqual(result["label"], "Lagged reference — no payout erosion")

    def test_plain_fund_whose_payouts_also_outran_the_reference_is_still_flagged(self):
        src, start, end, loader = example()
        result = screen(src, start, end, self.plain_plan(), loader)
        self.assertTrue(result["review_candidate"])
        self.assertFalse(result["estimated_eroder"])


if __name__ == "__main__":
    unittest.main()
