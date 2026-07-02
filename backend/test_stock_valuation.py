import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import valuation as ve


class DcfMathTest(unittest.TestCase):
    def test_single_stage_gordon_closed_form(self):
        # base 100, no stage-1 growth, 10% discount, 0% terminal, 1 yr, 10 shares.
        # Year-1 FCF 100 → PV 90.909; terminal 100/0.10 = 1000 → PV 909.09;
        # enterprise 1000 → /10 shares → 100.00 per share.
        dcf = ve.discounted_cash_flow(100, 0.0, 0.10, 0.0, 1, net_cash=0, shares=10)
        self.assertAlmostEqual(dcf["value"], 100.0, places=2)
        self.assertEqual(len(dcf["projection"]), 1)

    def test_value_is_horizon_invariant_for_flat_perpetuity(self):
        # A flat 100 perpetuity discounted at 10% is worth 1000 regardless of the
        # explicit horizon (1 share, no growth, no terminal growth, no net cash).
        for years in (1, 2, 5, 10):
            dcf = ve.discounted_cash_flow(100, 0.0, 0.10, 0.0, years, net_cash=0, shares=1)
            self.assertAlmostEqual(dcf["value"], 1000.0, places=2)

    def test_net_cash_lifts_equity_value(self):
        no_cash = ve.discounted_cash_flow(100, 0.0, 0.10, 0.0, 5, net_cash=0, shares=1)
        with_cash = ve.discounted_cash_flow(100, 0.0, 0.10, 0.0, 5, net_cash=500, shares=1)
        self.assertAlmostEqual(with_cash["value"] - no_cash["value"], 500.0, places=2)

    def test_unusable_inputs_return_none(self):
        self.assertIsNone(ve.discounted_cash_flow(-50, 0.05, 0.10, 0.02, 5, shares=10))   # negative FCF
        self.assertIsNone(ve.discounted_cash_flow(100, 0.05, 0.10, 0.02, 5, shares=0))    # no shares
        self.assertIsNone(ve.discounted_cash_flow(100, 0.05, 0.02, 0.02, 5, shares=10))   # discount <= terminal
        self.assertIsNone(ve.discounted_cash_flow(100, 0.05, 0.10, 0.02, 0, shares=10))   # zero years

    def test_stage1_growth_fades_to_terminal(self):
        dcf = ve.discounted_cash_flow(100, 0.20, 0.10, 0.02, 5, net_cash=0, shares=1)
        proj = dcf["projection"]
        # Year 1 grows at the stage-1 rate; the final year at the terminal rate;
        # the per-year growth declines monotonically in between.
        self.assertAlmostEqual(proj[0]["growth"], 0.20, places=4)
        self.assertAlmostEqual(proj[-1]["growth"], 0.02, places=4)
        growths = [p["growth"] for p in proj]
        self.assertEqual(growths, sorted(growths, reverse=True))

    def test_capm_cost_of_equity(self):
        self.assertAlmostEqual(ve.capm_cost_of_equity(1.2, 0.045, 0.05), 0.105, places=4)
        # Missing/odd beta falls back to market beta of 1.0.
        self.assertAlmostEqual(ve.capm_cost_of_equity(None, 0.045, 0.05), 0.095, places=4)


class DerivedRatioTest(unittest.TestCase):
    def test_fcf_yield(self):
        self.assertEqual(ve.fcf_yield_pct(50, 1000), 5.0)
        self.assertIsNone(ve.fcf_yield_pct(50, 0))

    def test_debt_ratio(self):
        self.assertEqual(ve.debt_ratio(50, 200), 0.25)

    def test_interest_coverage_uses_absolute_interest(self):
        self.assertEqual(ve.interest_coverage(1000, -100), 10.0)
        self.assertEqual(ve.interest_coverage(1000, 100), 10.0)
        self.assertIsNone(ve.interest_coverage(1000, 0))

    def test_payout_peg_roe_roa_fallbacks(self):
        self.assertEqual(ve.payout_ratio_pct(2, 4), 50.0)
        self.assertEqual(ve.peg_ratio(20, 10), 2.0)
        self.assertEqual(ve.roe_pct(20, 100), 20.0)
        self.assertEqual(ve.roa_pct(6, 100), 6.0)
        self.assertIsNone(ve.roe_pct(20, 0))


class MultiplesAndDdmTest(unittest.TestCase):
    def test_fair_value_from_multiple(self):
        self.assertEqual(ve.fair_value_from_multiple(18, 5), 90.0)
        self.assertIsNone(ve.fair_value_from_multiple(18, -5))   # negative EPS
        self.assertIsNone(ve.fair_value_from_multiple(0, 5))

    def test_dividend_discount_value(self):
        # D0=2, g=5%, r=10% → D1=2.10 / 0.05 = 42.00
        self.assertAlmostEqual(ve.dividend_discount_value(2, 0.10, 0.05), 42.0, places=2)
        self.assertIsNone(ve.dividend_discount_value(2, 0.05, 0.05))   # r <= g
        self.assertIsNone(ve.dividend_discount_value(0, 0.10, 0.05))   # no dividend


class BlendTest(unittest.TestCase):
    def test_equal_weight_blend(self):
        out = ve.blend_intrinsic_value([
            {"name": "a", "value": 90, "weight": 1},
            {"name": "b", "value": 100, "weight": 1},
            {"name": "c", "value": 110, "weight": 1},
        ])
        self.assertAlmostEqual(out["value"], 100.0, places=2)
        self.assertEqual(out["low"], 90.0)
        self.assertEqual(out["high"], 110.0)
        self.assertEqual(len(out["methods"]), 3)

    def test_weighting_and_dropped_methods(self):
        out = ve.blend_intrinsic_value([
            {"name": "a", "value": 100, "weight": 3},
            {"name": "b", "value": 200, "weight": 1},
            {"name": "c", "value": None, "weight": 5},   # dropped
        ])
        # weights renormalize to 0.75 / 0.25 → 0.75*100 + 0.25*200 = 125
        self.assertAlmostEqual(out["value"], 125.0, places=2)
        self.assertEqual(len(out["methods"]), 2)

    def test_all_missing_returns_none(self):
        out = ve.blend_intrinsic_value([{"name": "a", "value": None, "weight": 1}])
        self.assertIsNone(out["value"])
        self.assertEqual(out["methods"], [])
        self.assertEqual(out["confidence"], "none")

    def test_gross_outlier_is_trimmed(self):
        # A wild method (e.g. a sector P/S applied to a low-margin company) is
        # excluded so it can't drag the blend; the others (90/100/110) average 100.
        out = ve.blend_intrinsic_value([
            {"name": "a", "value": 100, "weight": 1},
            {"name": "b", "value": 110, "weight": 1},
            {"name": "c", "value": 90, "weight": 1},
            {"name": "outlier", "value": 1200, "weight": 1},
        ])
        self.assertAlmostEqual(out["value"], 100.0, places=2)
        excl = {m["name"]: m["excluded"] for m in out["methods"]}
        self.assertTrue(excl["outlier"])
        self.assertFalse(excl["a"])
        self.assertEqual(out["high"], 110.0)   # kept range excludes the outlier

    def test_confidence_reflects_agreement(self):
        tight = ve.blend_intrinsic_value([
            {"name": "a", "value": 100, "weight": 1},
            {"name": "b", "value": 105, "weight": 1},
            {"name": "c", "value": 110, "weight": 1},
        ])
        self.assertEqual(tight["confidence"], "high")
        wide = ve.blend_intrinsic_value([
            {"name": "a", "value": 100, "weight": 1},
            {"name": "b", "value": 180, "weight": 1},
            {"name": "c", "value": 260, "weight": 1},
        ])
        self.assertEqual(wide["confidence"], "low")


class VerdictTest(unittest.TestCase):
    def test_bands(self):
        self.assertEqual(ve.valuation_verdict(80, 100)["label"], "Undervalued")
        self.assertEqual(ve.valuation_verdict(100, 100)["label"], "Fairly Valued")
        self.assertEqual(ve.valuation_verdict(130, 100)["label"], "Overvalued")

    def test_boundaries(self):
        # exactly 15% MOS is still "Fair" (strictly greater than the band flips it)
        self.assertEqual(ve.valuation_verdict(85, 100)["label"], "Fairly Valued")
        self.assertEqual(ve.valuation_verdict(84, 100)["label"], "Undervalued")

    def test_margin_of_safety_and_unknown(self):
        v = ve.valuation_verdict(80, 100)
        self.assertEqual(v["margin_of_safety_pct"], 20.0)
        self.assertEqual(v["upside_pct"], 25.0)
        self.assertEqual(ve.valuation_verdict(None, 100)["label"], "Unknown")
        self.assertEqual(ve.valuation_verdict(80, 0)["label"], "Unknown")


class RiskAndScorecardTest(unittest.TestCase):
    def test_risk_ratios_on_trending_series(self):
        # A noisy upward drift (real volatility, i.e. some down days) so all four
        # ratios are computable — a perfectly monotonic riser has no downside and
        # would legitimately leave Sortino/Omega undefined.
        rng = np.random.default_rng(42)
        idx = pd.date_range("2022-01-01", periods=500, freq="D")
        rets = rng.normal(0.0008, 0.012, 500)
        close = pd.Series(100 * np.cumprod(1 + rets), index=idx)
        out = ve.risk_ratios(close)
        for key in ("sharpe", "sortino", "calmar", "omega"):
            self.assertIsNotNone(out[key], key)
            self.assertGreater(out[key], 0, key)

    def test_risk_ratios_short_series_is_none(self):
        idx = pd.date_range("2022-01-01", periods=10, freq="D")
        out = ve.risk_ratios(pd.Series(np.arange(10.0), index=idx))
        self.assertTrue(all(v is None for v in out.values()))

    def test_section_grade_and_badges(self):
        sec = ve.valuation_section(
            forward_pe=10, peg=0.9, price_to_book=1.0, price_to_sales=1.0,
            fcf_yield=8.0, payout_ratio=30.0, sector="Technology",
        )
        self.assertEqual(sec["id"], "valuation")
        self.assertIsNotNone(sec["grade"]["score"])
        # A cheap, cash-generative profile should grade well.
        self.assertGreaterEqual(sec["grade"]["score"], 75)

    def test_section_handles_all_missing(self):
        sec = ve.quality_section(None, None, None, None, None)
        self.assertIsNone(sec["grade"]["score"])
        self.assertEqual(sec["grade"]["label"], "n/a")


if __name__ == "__main__":
    unittest.main()
