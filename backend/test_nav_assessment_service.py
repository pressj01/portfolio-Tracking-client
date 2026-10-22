import datetime as dt
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nav_assessment_service import (
    REGISTRY, build_payload, compare_reference, guidance, reference_plan, validate_choice,
)


def holding(**extra):
    return {"current_value": 100, "current_price": 100, "quantity": 1, **extra}


def source(end=70, paid=10, **extra):
    return {"basis": "published_nav", "nav": [{"date": "2026-01-02", "nav": 100}, {"date": "2026-01-05", "nav": end}],
            "distributions": [{"date": "2026-01-05", "amount": paid}], "distributions_complete": True,
            "corporate_actions_resolved": True, "label": "Test published source", **extra}


class SourceGatedAssessmentTest(unittest.TestCase):
    def build(self, holdings=None, nav=None, reference=None, **extra):
        return build_payload(holdings or {"QQQI": holding()},
            lambda *args: source() if nav is None else nav,
            reference or (lambda *args: {"2026-01-02": 100, "2026-01-05": 80}),
            as_of=dt.date(2026, 1, 5), cash=0, **extra)

    def test_market_drop_with_same_cash_does_not_become_destructive_verdict(self):
        row = self.build()["results"][0]
        self.assertEqual(row["capital_status"], "declined")
        self.assertEqual(row["reference_result"]["comparison"], "within_precision")
        self.assertEqual(row["structural_erosion"], "unconfirmed")
        self.assertNotIn("overall_nav_erosion_score", row)

    def test_reference_outage_preserves_valid_nav_accounting(self):
        def outage(*args):
            raise RuntimeError("Network unavailable")
        row = self.build(reference=outage)["results"][0]
        self.assertEqual(row["metrics"]["investment_result"], -20)
        self.assertEqual(row["reference_result"]["status"], "unavailable")

    def test_nav_source_failure_is_unconfirmed_not_zero(self):
        payload = build_payload({"QQQI": holding()}, lambda *a: None, Mock(), cash=0)
        row = payload["results"][0]
        self.assertIsNone(row["metrics"])
        self.assertEqual(payload["summary"]["states"]["unconfirmed"]["share"], 1)

    def test_price_proxy_and_unresolved_actions_cannot_receive_nav_status(self):
        for flags in ({"basis": "market_price"}, {"corporate_actions_resolved": False}, {"distributions_complete": False}):
            row = self.build(nav=source(**flags))["results"][0]
            self.assertEqual(row["capital_status"], "unconfirmed")
            self.assertIsNone(row["metrics"])

    def test_split_adjusts_nav_and_payouts_per_original_share(self):
        row = self.build(nav=source(end=50, paid=5, splits=[{"date": "2026-01-05", "ratio": 2}]))["results"][0]
        self.assertEqual(row["capital_status"], "within_precision")
        self.assertEqual(row["metrics"]["investment_result"], 10)

    def test_duplicate_distribution_is_not_paid_twice(self):
        src = source()
        src["distributions"] *= 2
        row = self.build(nav=src)["results"][0]
        self.assertEqual(row["capital_status"], "unconfirmed")

    def test_future_undeclared_distribution_is_excluded(self):
        src = source()
        src["distributions"].append({"date": "2026-02-01", "amount": None})
        self.assertIsNotNone(self.build(nav=src)["results"][0]["metrics"])

    def test_stale_source_and_missing_start_are_not_current_verdicts(self):
        result = build_payload({"QQQI": holding()}, lambda *a: source(), Mock(), as_of=dt.date(2026, 2, 1), cash=0)
        self.assertEqual(result["results"][0]["capital_status"], "unconfirmed")
        self.assertIn("stale", result["results"][0]["reason"])

    def test_reference_missing_ex_date_does_not_invent_return(self):
        src = source()
        src["distributions"][0]["date"] = "2026-01-03"
        row = self.build(nav=src)["results"][0]
        self.assertEqual(row["reference_result"]["status"], "unavailable")
        self.assertIsNotNone(row["metrics"])

    def test_nonfund_bdc_and_unknown_holdings_are_kept_in_denominator(self):
        info = {"QQQI": holding(), "JNJ": holding(current_value=20), "ARCC": holding(current_value=10), "UNLISTED": holding(current_value=5)}
        payload = build_payload(info, lambda *a: source(), lambda *a: {}, as_of=dt.date(2026, 1, 5), cash=15)
        states = payload["summary"]["states"]
        self.assertEqual(payload["summary"]["account_value"], 150)
        self.assertEqual(states["not_applicable"]["value"], 20)
        self.assertEqual(states["unconfirmed"]["value"], 15)
        self.assertAlmostEqual(states["declined"]["share"], 100/150)

    def test_missing_current_value_withholds_percentage(self):
        payload = self.build(holdings={"QQQI": holding(current_value=None)})
        self.assertFalse(payload["summary"]["value_coverage_complete"])
        self.assertIsNone(payload["summary"]["states"]["declined"]["share"])

    def test_skipped_holdings_are_unconfirmed_not_excluded(self):
        row = self.build(holdings={"QQQI": holding(nav_erosion_scope="skip")})["results"][0]
        self.assertEqual(row["capital_status"], "unconfirmed")

    def test_registry_covers_reviewed_portfolio_without_one_universal_reference(self):
        self.assertEqual(len(REGISTRY), 74)
        self.assertIsNone(guidance("UNLISTED", {})["suggestion"])
        self.assertEqual(guidance("GPTY", {})["suggestion"], "QQQ")


class ReferenceChoiceTest(unittest.TestCase):
    def test_bad_legacy_references_are_preserved_but_auto_uses_exposure_policy(self):
        for ticker, bad in [("GPTY", "GOOG"), ("XSPI", "SPCX"), ("SLJY", "SLV"), ("TDAX", "QQQ")]:
            plan = reference_plan(ticker, {"nav_benchmark_override": bad}, guidance(ticker, {}))
            self.assertEqual(plan["legacy_override"], bad)
            self.assertTrue(plan["legacy_notice"])
            self.assertIsNone(plan["warning"])
            self.assertNotEqual(plan["selected"], bad)
            self.assertFalse(plan["causal_match"])

    def test_every_reviewed_nonstock_has_an_automatic_plan(self):
        for ticker in REGISTRY:
            guide = guidance(ticker, {})
            if guide["security_kind"] == "stock":
                continue
            with self.subTest(ticker=ticker):
                plan = reference_plan(ticker, {}, guide)
                self.assertTrue(plan["automatic"])
                self.assertTrue(plan["legs"])

    def test_bitcoin_reference_is_coin_series_not_a_similarly_named_equity(self):
        plan = reference_plan("BTCI", {}, guidance("BTCI", {}))
        self.assertEqual(plan["selected"], "Bitcoin (BTC)")
        self.assertEqual(plan["legs"], [{"symbol": "BTC-USD", "weight": 1}])
        self.assertTrue(plan["requires_aligned_crypto_close"])

    def test_automatic_stacked_and_daily_targets_keep_their_exposures(self):
        for ticker, total in [("ISBG",2),("ISSB",2),("TDAX",1.3)]:
            plan = reference_plan(ticker, {}, guidance(ticker, {}))
            self.assertAlmostEqual(sum(leg["weight"] for leg in plan["legs"]), total)


class OverallAssessmentTest(unittest.TestCase):
    build = SourceGatedAssessmentTest.build
    def test_one_endpoint_shortfall_cannot_flag_a_review_candidate(self):
        result = self.build(nav=source(end=90, paid=20), reference=lambda *a: {"2026-01-02":100,"2026-01-05":130})
        self.assertEqual(result["overall"]["candidates"], [])
        self.assertEqual(result["overall"]["causal_verdict"], "unconfirmed")
        self.assertFalse(result["results"][0]["erosion_review"])

    def repeated(self, nav_values, reference_values):
        days = ['2025-12-31','2026-03-31','2026-06-30','2026-09-30']
        src = source(nav=[{'date':day,'nav':value} for day,value in zip(days,nav_values)],
                     distributions=[{'date':day,'amount':20} for day in days[1:]])
        prices = {}
        for index in range(3):
            a,b=dt.date.fromisoformat(days[index]),dt.date.fromisoformat(days[index+1])
            steps=(b-a).days
            for step in range(steps+1):
                prices[(a+dt.timedelta(days=step)).isoformat()] = reference_values[index] * (reference_values[index+1]/reference_values[index]) ** (step/steps)
        return build_payload({'QQQI':holding()},lambda *a:src,lambda *a:prices,
                             as_of=dt.date(2026,9,30),cash=0)

    def test_repeated_completed_quarter_shortfalls_can_flag_a_review_candidate(self):
        result = self.repeated([100,90,80,70],[100,130,169,219.7])
        self.assertEqual(result['overall']['candidates'][0]['ticker'],'QQQI')
        self.assertEqual(result['results'][0]['persistence']['qualifying_quarters'],3)
        self.assertTrue(result['results'][0]['erosion_review'])

    def test_repeated_losses_in_falling_market_do_not_establish_erosion_signal(self):
        result = self.repeated([100,70,50,30],[100,80,64,51.2])
        self.assertEqual(result['overall']['candidates'],[])
        self.assertEqual(result['results'][0]['persistence']['qualifying_quarters'],0)

    def test_repeated_capital_depletion_in_flat_market_is_not_hidden_by_outperformance(self):
        result = self.repeated([100,90,80,70],[100,100,100,100])
        self.assertEqual(result['overall']['candidates'][0]['ticker'],'QQQI')
        self.assertEqual(result['results'][0]['reference_result']['comparison'],'above')

    def test_growing_remaining_capital_is_not_flagged_for_quarterly_underperformance(self):
        result = self.repeated([100,120,110,105],[100,130,169,219.7])
        self.assertEqual(result['overall']['candidates'],[])

    def test_tspy_like_down_market_recovery_and_near_flat_quarter_is_not_persistent(self):
        result = self.repeated([25.46,23.13,25.36,25.32],[100,95.63,110.09,112.71])
        self.assertEqual(result['overall']['candidates'],[])
        self.assertLess(result['results'][0]['persistence']['qualifying_quarters'],2)

    def test_market_fall_does_not_trigger_the_erosion_watchlist(self):
        self.assertEqual(self.build()["overall"]["candidates"], [])

    def test_rally_underperformance_without_capital_decline_does_not_flag(self):
        result = self.build(nav=source(end=105, paid=10), reference=lambda *a: {"2026-01-02":100,"2026-01-05":130})
        self.assertEqual(result["overall"]["candidates"], [])

    def test_payout_pressure_remains_visible_even_when_fund_outperforms(self):
        result = self.build(nav=source(end=90, paid=30), reference=lambda *a: {"2026-01-02":100,"2026-01-05":110})
        self.assertEqual(result["overall"]["candidates"], [])
        self.assertEqual(result["overall"]["payout_pressure_tickers"], ["QQQI"])

    def test_unknown_nav_prevents_complete_portfolio_conclusion(self):
        payload = build_payload({"QQQI":holding()},lambda *a:None,Mock(),cash=0)
        self.assertTrue(payload["overall"]["partial"])
        self.assertEqual(payload["overall"]["assessed_count"], 0)

    def test_no_fund_holdings_is_not_a_capital_preservation_claim(self):
        payload = build_payload({"JNJ":holding()}, Mock(), Mock(),cash=20)
        self.assertEqual(payload["overall"]["title"], "No applicable fund holdings")

    def test_explicit_suggestion_can_replace_bad_context_without_deleting_legacy(self):
        plan = reference_plan("XSPI", {"nav_benchmark_override": "SPCX"}, guidance("XSPI", {}), {"mode": "symbol", "symbol": "SPY"})
        self.assertEqual(plan["selected"], "SPY")
        self.assertEqual(plan["legacy_override"], "SPCX")
        self.assertIsNone(plan["warning"])
        self.assertEqual(plan["fit"], "Unboosted market context")

    def test_custom_exposures_do_not_normalize_stacked_legs(self):
        choice = validate_choice({"mode": "custom", "legs": [{"symbol": "BTC-USD", "weight": 1}, {"symbol": "GLD", "weight": 1}],
                                  "annual_cost": .02, "effective_date": "2025-01-01", "reason": "One unit each; funding specified"})
        self.assertEqual(sum(leg["weight"] for leg in choice["legs"]), 2)

    def test_custom_cost_compounds_by_actual_elapsed_calendar_days(self):
        choice = {"mode": "custom", "legs": [{"symbol": "SPY", "weight": 1.3}], "annual_cost": .1,
                  "effective_date": "2025-01-01", "reason": "Documented daily 130% context"}
        plan = reference_plan("TDAX", {}, guidance("TDAX", {}), choice)
        result = compare_reference(100, 110, dt.date(2026, 1, 2), dt.date(2026, 1, 5), {}, plan,
                                   lambda *a: {"2026-01-02": 100, "2026-01-05": 110})
        self.assertAlmostEqual(result["ending_value"], 113 - 100*.1*3/365.25)

    def test_custom_assumptions_do_not_apply_before_their_effective_date(self):
        plan = reference_plan("QQQI", {}, guidance("QQQI", {}), {"mode": "custom", "legs": [{"symbol": "QQQ", "weight": 1}],
            "annual_cost": 0, "effective_date": "2026-02-01", "reason": "New assumptions effective February"})
        result = compare_reference(100, 100, dt.date(2026, 1, 2), dt.date(2026, 1, 5), {}, plan, Mock())
        self.assertEqual(result["status"], "unavailable")

    def test_malformed_inputs_are_rejected(self):
        for choice in [[], {"mode": "symbol", "symbol": "https://example.com"}, {"mode": "custom", "legs": []}, {"mode": "strategy_matched"}]:
            with self.assertRaises(ValueError):
                validate_choice(choice)


if __name__ == "__main__":
    unittest.main()
