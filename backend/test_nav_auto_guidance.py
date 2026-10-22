import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nav_assessment_service import build_payload, guidance, reference_plan
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
