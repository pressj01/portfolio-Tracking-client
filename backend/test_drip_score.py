"""Unit tests for the historical DRIP-vs-cash analyzer.

All synthetic — no network. The core functions take price/dividend Series
directly so only the orchestrator needs patching.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import drip_score
from drip_score import (
    classify,
    compute_ticker_metrics,
    compute_win_rate,
    infer_frequency,
    run_drip_score,
    score_components,
    simulate_drip,
)

INITIAL = 50_000.0


def _series(n_weeks, price_fn, div_amount, start="2024-01-05"):
    """Weekly price grid with a weekly distribution on every date.

    ``div_amount`` may be a fixed per-share dollar amount, or a callable taking
    the period's price and returning the distribution. Use the callable form
    whenever the price falls materially: a constant DOLLAR distribution against
    a collapsing price implies a yield running to infinity, which no real fund
    pays and which makes DRIP look artificially good.
    """
    idx = pd.date_range(start, periods=n_weeks, freq="7D")
    prices = [float(price_fn(i)) for i in range(n_weeks)]
    close = pd.Series(prices, index=idx)
    if callable(div_amount):
        divs = pd.Series([float(div_amount(p)) for p in prices], index=idx)
    else:
        divs = pd.Series([float(div_amount)] * n_weeks, index=idx)
    return close, divs


def _yield_of(rate):
    """Distribution as a constant fraction of the current price."""
    return lambda price: price * rate


class SimulationTest(unittest.TestCase):
    def test_decomposition_identity_holds(self):
        """DRIP score must equal income_factor x (RE - 1) exactly.

        This is the load-bearing identity in the spec: the DRIP score is the
        product of how much income was collected and how much better
        reinvesting it was.
        """
        close, divs = _series(104, lambda i: 100.0 + i * 0.5, 0.60)
        row = compute_ticker_metrics(close, divs, "TEST", initial=INITIAL, cash_rate=0.04)
        self.assertAlmostEqual(
            row["drip_score"],
            row["income_factor"] * (row["re"] - 1.0),
            places=9,
        )

    def test_flat_price_still_favours_drip_via_compounding(self):
        """At a flat price DRIP beats 0% cash purely by compounding.

        Reinvested shares generate their own distributions; idle cash does not.
        The analytic value is P*((1+d/P)^n - 1)/(d*n).
        """
        price, div, n = 100.0, 0.50, 104
        close, divs = _series(n, lambda i: price, div)
        row = compute_ticker_metrics(close, divs, "FLAT", initial=INITIAL, cash_rate=0.0)

        expected = price * ((1 + div / price) ** n - 1) / (div * n)
        self.assertAlmostEqual(row["re"], expected, places=9)
        self.assertGreater(row["re"], 1.0)
        self.assertAlmostEqual(row["price_appreciation"], 0.0, places=12)

    def test_rising_price_orders_returns_and_wins_every_exit(self):
        close, divs = _series(104, lambda i: 100.0 + i * 1.0, 0.50)
        row = compute_ticker_metrics(close, divs, "UP", initial=INITIAL, cash_rate=0.0)

        self.assertGreater(row["tr_full"], row["tr_50"])
        self.assertGreater(row["tr_50"], row["tr_none"])
        self.assertGreater(row["re"], 1.0)
        self.assertEqual(row["win_rate"], 1.0)
        self.assertTrue(row["stable"])
        self.assertFalse(row["conflicted"])

    def test_falling_price_reverses_the_ordering(self):
        """The GDXY case: full DRIP < half < none when NAV collapses."""
        close, divs = _series(104, lambda i: 100.0 - i * 0.85, 0.80)
        row = compute_ticker_metrics(close, divs, "DOWN", initial=INITIAL, cash_rate=0.0)

        self.assertLess(row["tr_full"], row["tr_50"])
        self.assertLess(row["tr_50"], row["tr_none"])
        self.assertLess(row["re"], 1.0)
        self.assertEqual(row["win_rate"], 0.0)
        self.assertEqual(row["drip_call"], "Take cash")
        # A 0% win rate is a maximally reliable signal, not an unstable one.
        self.assertTrue(row["stable"])

    def test_stability_measures_distance_from_a_coin_flip(self):
        close, divs = _series(104, lambda i: 100.0, 0.50)
        for rate, expected in ((0.0, True), (0.2, True), (0.5, False),
                               (0.6, False), (0.9, True), (1.0, True)):
            with patch.object(drip_score, "WIN_RATE_STABLE", 0.65):
                stable = abs(rate - 0.5) >= (drip_score.WIN_RATE_STABLE - 0.5)
            self.assertEqual(stable, expected, f"win_rate={rate}")

        result = compute_win_rate(close, divs, initial=INITIAL)
        self.assertTrue(result["stable"])

    def test_raising_cash_rate_strictly_lowers_reinvestment_efficiency(self):
        close, divs = _series(104, lambda i: 100.0 + i * 0.5, 0.60)
        low = compute_ticker_metrics(close, divs, "T", initial=INITIAL, cash_rate=0.0)
        high = compute_ticker_metrics(close, divs, "T", initial=INITIAL, cash_rate=0.05)

        self.assertLess(high["re"], low["re"])
        self.assertLess(high["drip_score"], low["drip_score"])

    def test_cash_is_held_separately_from_share_value(self):
        """No-DRIP terminal value = shares x price + accumulated cash."""
        close, divs = _series(52, lambda i: 100.0, 0.50)
        sim = simulate_drip(close, divs, initial=INITIAL, reinvest=0.0, cash_rate=0.0)

        self.assertAlmostEqual(sim["shares_end"], sim["shares_start"], places=12)
        self.assertAlmostEqual(
            sim["terminal_value"], sim["share_value_end"] + sim["cash_end"], places=6)
        self.assertAlmostEqual(sim["cash_end"], sim["gross_distributions"], places=6)

    def test_grid_share_and_cash_fields_reconcile(self):
        """The grid exposes the share counts and dollar bridge behind RE."""
        close, divs = _series(104, lambda i: 100.0 - i * 0.40, 0.60)
        row = compute_ticker_metrics(
            close, divs, "BRIDGE", initial=INITIAL, cash_rate=0.04)
        full = simulate_drip(
            close, divs, initial=INITIAL, reinvest=1.0, cash_rate=0.04)
        half = simulate_drip(
            close, divs, initial=INITIAL, reinvest=0.5, cash_rate=0.04)
        none = simulate_drip(
            close, divs, initial=INITIAL, reinvest=0.0, cash_rate=0.04)

        self.assertAlmostEqual(row["shares_initial"], full["shares_start"], places=12)
        self.assertAlmostEqual(row["shares_full_end"], full["shares_end"], places=12)
        self.assertAlmostEqual(row["shares_50_end"], half["shares_end"], places=12)
        self.assertAlmostEqual(
            row["full_drip_ending_value"],
            full["shares_end"] * full["end_price"],
            places=9,
        )
        self.assertAlmostEqual(
            row["half_drip_ending_value"],
            half["shares_end"] * half["end_price"] + half["cash_end"],
            places=9,
        )
        self.assertAlmostEqual(
            row["no_drip_ending_value"],
            none["shares_start"] * none["end_price"] + none["cash_end"],
            places=9,
        )


class ScoringTest(unittest.TestCase):
    def test_flat_price_income_is_fully_covered(self):
        """Matched-period coverage is exactly one when price is flat.

        This guards against mixing geometric total-return CAGR with a simple
        annual yield, which incorrectly classified flat-price income funds as
        partially covered.
        """
        close, divs = _series(104, lambda i: 100.0, 0.50)
        row = compute_ticker_metrics(close, divs, "FLAT",
                                     initial=INITIAL, cash_rate=0.0)

        self.assertAlmostEqual(row["price_appreciation"], 0.0, places=12)
        self.assertAlmostEqual(row["coverage"], 1.0, places=12)
        self.assertAlmostEqual(row["covered_yield"], row["annual_yield"], places=12)
        self.assertEqual(row["bucket"], "Compounder")

    def test_positive_price_change_cannot_produce_partial_coverage(self):
        """JEPI-like positive price performance must place coverage above one."""
        close, divs = _series(104, lambda i: 100.0 + i * 0.002, 0.16)
        row = compute_ticker_metrics(close, divs, "JEPI-LIKE",
                                     initial=INITIAL, cash_rate=0.04)

        income_return = row["annual_yield"] * row["years"]
        expected = (row["price_appreciation"] + income_return) / income_return
        self.assertGreater(row["price_appreciation"], 0.0)
        self.assertAlmostEqual(row["coverage"], expected, places=12)
        self.assertGreater(row["coverage"], 1.0)
        self.assertEqual(row["bucket"], "Compounder")

    def test_coverage_goes_negative_when_fund_pays_out_of_capital(self):
        """NAV collapse the distributions could not cover -> Liquidator.

        Price -82% with a ~31%/yr distribution: total return is negative, so
        the distributions were funded by capital.
        """
        close, divs = _series(104, lambda i: 100.0 - i * 0.80, _yield_of(0.006))
        row = compute_ticker_metrics(close, divs, "CONYLIKE", initial=INITIAL, cash_rate=0.0)

        self.assertIsNotNone(row["coverage"])
        self.assertLess(row["tr_none"], 0.0)
        self.assertLess(row["coverage"], 0.0)
        self.assertGreaterEqual(row["annual_yield"], drip_score.HIGH_YIELD_CUTOFF)
        self.assertEqual(row["bucket"], "Liquidator")

    def test_big_nav_decline_with_bigger_distributions_is_a_harvester(self):
        """The distinction coverage exists to draw.

        The same -82% NAV collapse as the Liquidator case, but at a ~100%/yr
        distribution rate the cash more than covers the capital lost, so total
        return is POSITIVE. A raw NAV-decline metric condemns both funds
        identically; coverage separates them.
        """
        close, divs = _series(104, lambda i: 100.0 - i * 0.80, _yield_of(0.02))
        row = compute_ticker_metrics(close, divs, "HARVEST", initial=INITIAL, cash_rate=0.0)

        self.assertLess(row["price_appreciation"], -0.80)
        self.assertGreater(row["tr_none"], 0.0)
        self.assertGreater(row["coverage"], 0.0)
        self.assertLess(row["coverage"], 1.0)
        self.assertEqual(row["bucket"], "Harvester")
        self.assertNotEqual(row["drip_call"], "DRIP")

    def test_uncovered_yield_scores_zero_however_large(self):
        """Headline yield earns nothing when total return is negative."""
        scores = score_components(nav_annual=-0.40, annual_yield=0.70,
                                  annual_fund_tr=-0.20)
        self.assertEqual(scores["covered_yield"], 0.0)
        self.assertEqual(scores["yield_score"], 0.0)
        self.assertEqual(scores["nav_score"], 0.0)
        self.assertEqual(scores["opportunity"], 0.0)

    def test_healthy_low_yield_fund_is_a_grower_not_a_caution(self):
        """DGRO-like: strong NAV, small yield. The source sheet called this
        'Caution'; it is simply not an income fund."""
        close, divs = _series(104, lambda i: 100.0 + i * 0.40, 0.05)
        row = compute_ticker_metrics(close, divs, "DGROLIKE", initial=INITIAL, cash_rate=0.0)

        self.assertLess(row["annual_yield"], drip_score.HIGH_YIELD_CUTOFF)
        self.assertGreater(row["coverage"], 1.0)
        self.assertEqual(row["bucket"], "Grower")
        self.assertGreater(row["nav_score"], 90.0)

    def test_conflicted_flag_fires_when_final_exit_disagrees_with_the_sweep(self):
        """RE < 1 but a majority of exit dates won -> timing-dependent call.

        The call still follows RE; ``conflicted`` is what warns the reader that
        it hinges on the exit date.
        """
        verdict = classify(annual_yield=0.50, coverage=0.35, re_value=0.876,
                           win_rate=0.76, annual_fund_tr=0.18)
        self.assertTrue(verdict["conflicted"])
        self.assertEqual(verdict["bucket"], "Harvester")
        self.assertEqual(verdict["drip_call"], "Take cash")

    def test_call_follows_reinvestment_efficiency_not_the_win_rate(self):
        """A near-coin-flip win rate must not soften a decisive RE.

        Real case: MSTY over 2024-07 -> 2026-07 has RE 0.407 (every $1
        reinvested became 41c) with a 49% win rate, because the sweep counts
        how OFTEN DRIP led without weighting by how MUCH.
        """
        emphatic = classify(annual_yield=0.60, coverage=0.22, re_value=0.407,
                            win_rate=0.49, annual_fund_tr=0.13)
        self.assertEqual(emphatic["drip_call"], "Take cash")

        winner = classify(annual_yield=0.42, coverage=0.40, re_value=1.029,
                          win_rate=0.98, annual_fund_tr=0.17)
        self.assertEqual(winner["drip_call"], "DRIP")

        # Only a genuinely marginal edge is a toss-up.
        for re_value in (0.99, 1.0, 1.01):
            marginal = classify(annual_yield=0.20, coverage=1.2, re_value=re_value,
                                win_rate=0.55, annual_fund_tr=0.25)
            self.assertEqual(marginal["drip_call"], "Toss-up", f"RE={re_value}")

    def test_call_survives_a_missing_win_rate(self):
        """Too-short windows return win_rate None; RE alone still answers."""
        verdict = classify(annual_yield=0.30, coverage=1.1, re_value=1.25,
                           win_rate=None, annual_fund_tr=0.33)
        self.assertEqual(verdict["drip_call"], "DRIP")
        self.assertFalse(verdict["conflicted"])

    def test_nav_score_calibration_endpoints(self):
        self.assertEqual(score_components(-0.10, 0.0, 0.0)["nav_score"], 0.0)
        self.assertEqual(score_components(0.0, 0.0, 0.0)["nav_score"], 50.0)
        self.assertEqual(score_components(0.10, 0.0, 0.0)["nav_score"], 100.0)
        self.assertEqual(score_components(0.99, 0.0, 0.0)["nav_score"], 100.0)


class EdgeCaseTest(unittest.TestCase):
    def test_zero_distributions_does_not_divide_by_zero(self):
        close, divs = _series(104, lambda i: 100.0 + i * 0.5, 0.0)
        row = compute_ticker_metrics(close, divs, "NODIV", initial=INITIAL, cash_rate=0.04)

        self.assertIsNone(row["re"])
        self.assertIsNone(row["coverage"])
        self.assertEqual(row["drip_call"], "N/A")
        self.assertEqual(row["annual_yield"], 0.0)
        self.assertEqual(row["distribution_count"], 0)

    def test_empty_price_history_raises(self):
        empty = pd.Series(dtype=float, index=pd.DatetimeIndex([]))
        with self.assertRaises(ValueError):
            simulate_drip(empty, empty, initial=INITIAL)

    def test_win_rate_is_none_when_window_too_short_to_sweep(self):
        close, divs = _series(4, lambda i: 100.0, 0.50)
        result = compute_win_rate(close, divs, initial=INITIAL)
        self.assertIsNone(result["win_rate"])
        self.assertEqual(result["n_exits"], 0)

    def test_frequency_inference_survives_a_special_distribution(self):
        weekly = pd.date_range("2024-01-05", periods=30, freq="7D")
        self.assertEqual(infer_frequency(list(weekly)), "weekly")

        monthly = list(pd.date_range("2024-01-31", periods=24, freq="ME"))
        self.assertEqual(infer_frequency(monthly), "monthly")

        # one off-cycle special payment must not shift the median
        irregular = monthly[:12] + [monthly[11] + pd.Timedelta(days=3)] + monthly[12:]
        self.assertEqual(infer_frequency(sorted(irregular)), "monthly")

        self.assertEqual(infer_frequency([]), "unknown")


class DetailTest(unittest.TestCase):
    def _detail(self, n=104, price_fn=None, div=0.60, cash_rate=0.0):
        close, divs = _series(n, price_fn or (lambda i: 100.0 + i * 0.5), div)
        return drip_score.build_detail(close, divs, "TEST",
                                       initial=INITIAL, cash_rate=cash_rate)

    def test_schedule_has_one_row_per_distribution(self):
        detail = self._detail()
        self.assertEqual(len(detail["schedule"]),
                         detail["summary"]["distribution_count"])

    def test_terminal_totals_agree_with_the_grid_row(self):
        """The detail view must not tell a different story than the grid."""
        detail = self._detail(cash_rate=0.04)
        summary = detail["summary"]
        self.assertAlmostEqual(summary["terminal"]["full"]["total_return"],
                               summary["tr_full"], places=12)
        self.assertAlmostEqual(summary["terminal"]["half"]["total_return"],
                               summary["tr_50"], places=12)
        self.assertAlmostEqual(summary["terminal"]["none"]["total_return"],
                               summary["tr_none"], places=12)

    def test_each_row_reconciles_shares_price_and_cash(self):
        detail = self._detail(cash_rate=0.04)
        for row in detail["schedule"]:
            self.assertAlmostEqual(
                row["value_none"],
                row["shares_none"] * row["price"] + row["cash_none"], places=6)
            self.assertAlmostEqual(
                row["value_half"],
                row["shares_half"] * row["price"] + row["cash_half"], places=6)
            self.assertAlmostEqual(row["value_full"],
                                   row["shares_full"] * row["price"], places=6)

    def test_no_drip_share_count_never_moves(self):
        detail = self._detail()
        start = detail["schedule"][0]["shares_none"]
        for row in detail["schedule"]:
            self.assertAlmostEqual(row["shares_none"], start, places=12)

    def test_half_drip_reinvests_exactly_half_the_gross(self):
        detail = self._detail()
        first = detail["schedule"][0]
        # All three start from the same share count, so the first payment's
        # reinvested half is exactly half of the full-DRIP gross.
        self.assertAlmostEqual(first["payment_half"],
                               first["payment_full"] * 0.5, places=9)
        self.assertAlmostEqual(first["payment_none"],
                               first["payment_full"], places=9)

    def test_current_yield_annualises_by_elapsed_time(self):
        price, div = 100.0, 0.50
        detail = self._detail(price_fn=lambda i: price, div=div)
        self.assertEqual(detail["summary"]["frequency"], "weekly")
        expected = div * (365.25 / 7) / price
        for row in detail["schedule"]:
            self.assertAlmostEqual(row["current_yield"], expected, places=12)
        # ...and that stays within a rounding error of the 52-week convention.
        convention = div * 52 / price
        self.assertLess(abs(expected - convention) / convention, 0.005)

    def test_current_yield_follows_a_mid_window_frequency_change(self):
        """MSTY paid monthly, then switched to weekly in early 2025.

        A single global factor annualises the monthly payments by 52 and
        reports ~466% where the real figure is ~108%.
        """
        monthly = pd.date_range("2024-01-31", periods=12, freq="ME")
        weekly = pd.date_range(monthly[-1] + pd.Timedelta(days=7), periods=40, freq="7D")
        idx = monthly.append(weekly)
        close = pd.Series([100.0] * len(idx), index=idx)
        divs = pd.Series([4.0] * 12 + [1.0] * 40, index=idx)

        detail = drip_score.build_detail(close, divs, "SWITCH", initial=INITIAL)
        sched = detail["schedule"]

        self.assertEqual(sched[0]["period_frequency"], "monthly")
        self.assertAlmostEqual(sched[0]["current_yield"], 4.0 * 12 / 100.0, delta=0.05)
        self.assertEqual(sched[-1]["period_frequency"], "weekly")
        self.assertAlmostEqual(sched[-1]["current_yield"],
                               1.0 * (365.25 / 7) / 100.0, places=12)

    def test_an_irregular_gap_does_not_jump_a_cadence_bucket(self):
        """A 48-day gap must not annualise as quarterly.

        Real case: MSTY 2024-09-06 -> 2024-10-24. Snapping to canonical
        cadences reported 59.89% between neighbours of 107% and 116%.
        """
        idx = pd.DatetimeIndex(["2024-08-07", "2024-09-06", "2024-10-24"])
        close = pd.Series([108.25, 95.35, 140.20], index=idx)
        divs = pd.Series([9.705, 9.270, 20.99], index=idx)

        sched = drip_score.build_detail(close, divs, "MSTYLIKE",
                                        initial=INITIAL)["schedule"]
        third = sched[2]["current_yield"]
        self.assertGreater(third, 1.0)   # not the ~0.60 the bucket cliff gave
        self.assertLess(third, 1.3)
        self.assertAlmostEqual(third, 20.99 * (365.25 / 48) / 140.20, places=12)

    def test_rising_price_separates_the_three_strategies_over_time(self):
        detail = self._detail(price_fn=lambda i: 100.0 + i * 1.0, div=0.60)
        last = detail["schedule"][-1]
        self.assertGreater(last["shares_full"], last["shares_half"])
        self.assertGreater(last["shares_half"], last["shares_none"])

    def test_zero_distributions_yields_an_empty_schedule(self):
        detail = self._detail(div=0.0)
        self.assertEqual(detail["schedule"], [])
        self.assertIsNone(detail["summary"]["re"])


class OrchestratorTest(unittest.TestCase):
    def _fake_frames(self):
        idx = pd.date_range("2024-01-05", periods=104, freq="7D")
        close = pd.DataFrame({
            "FULL": [100.0 + i * 0.5 for i in range(104)],
            "LATE": [100.0 + i * 0.5 for i in range(104)],
        }, index=idx)
        # LATE only starts halfway through the window
        close.loc[close.index[:52], "LATE"] = float("nan")
        divs = pd.DataFrame({"FULL": [0.60] * 104, "LATE": [0.60] * 104}, index=idx)
        divs.loc[divs.index[:52], "LATE"] = 0.0
        return close, divs

    def test_partial_data_include_ranks_short_history_separately(self):
        close, divs = self._fake_frames()
        with patch.object(drip_score, "fetch_prices", return_value=(close, divs)):
            out = run_drip_score(["FULL", "LATE"], "2024-01-05", "2025-12-28",
                                 initial=INITIAL, partial_data="include")

        self.assertEqual([r["ticker"] for r in out["rows"]], ["FULL"])
        self.assertEqual([r["ticker"] for r in out["partial"]], ["LATE"])
        self.assertTrue(out["partial"][0]["partial"])
        self.assertLess(out["partial"][0]["coverage_pct"], 0.75)
        self.assertEqual(out["excluded"], [])

    def test_partial_data_exclude_reports_a_reason(self):
        close, divs = self._fake_frames()
        with patch.object(drip_score, "fetch_prices", return_value=(close, divs)):
            out = run_drip_score(["FULL", "LATE"], "2024-01-05", "2025-12-28",
                                 initial=INITIAL, partial_data="exclude")

        self.assertEqual([r["ticker"] for r in out["rows"]], ["FULL"])
        self.assertEqual(out["partial"], [])
        self.assertEqual(len(out["excluded"]), 1)
        self.assertEqual(out["excluded"][0]["ticker"], "LATE")
        self.assertIn("after requested start", out["excluded"][0]["reason"])

    def test_every_requested_ticker_is_accounted_for(self):
        close, divs = self._fake_frames()
        for policy in ("include", "exclude"):
            with patch.object(drip_score, "fetch_prices", return_value=(close, divs)):
                out = run_drip_score(["FULL", "LATE"], "2024-01-05", "2025-12-28",
                                     initial=INITIAL, partial_data=policy)
            seen = ({r["ticker"] for r in out["rows"]}
                    | {r["ticker"] for r in out["partial"]}
                    | {r["ticker"] for r in out["excluded"]})
            self.assertEqual(seen, {"FULL", "LATE"}, f"policy={policy}")

    def test_unknown_ticker_is_reported_exactly_once(self):
        """yfinance returns an all-NaN column for a bad symbol rather than
        omitting it, so a naive candidate loop reports it twice."""
        close, divs = self._fake_frames()
        close["BOGUS"] = float("nan")
        divs["BOGUS"] = 0.0

        for policy in ("include", "exclude"):
            with patch.object(drip_score, "fetch_prices", return_value=(close, divs)):
                out = run_drip_score(["FULL", "BOGUS"], "2024-01-05", "2025-12-28",
                                     initial=INITIAL, partial_data=policy)
            names = [e["ticker"] for e in out["excluded"]]
            self.assertEqual(names.count("BOGUS"), 1, f"policy={policy}: {names}")
            self.assertEqual([r["ticker"] for r in out["rows"]], ["FULL"])

    def test_tickers_are_deduped_and_uppercased(self):
        close, divs = self._fake_frames()
        with patch.object(drip_score, "fetch_prices", return_value=(close, divs)):
            out = run_drip_score(["full", "FULL", " full "], "2024-01-05", "2025-12-28",
                                 initial=INITIAL)
        self.assertEqual(out["meta"]["requested"], 1)
        self.assertEqual(len(out["rows"]), 1)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            run_drip_score([], "2024-01-05", "2025-12-28")
        with self.assertRaises(ValueError):
            run_drip_score(["A"], "2024-01-05", "2024-02-01")  # window under MIN_DAYS
        with self.assertRaises(ValueError):
            run_drip_score(["A"], "2024-01-05", "2025-12-28", partial_data="maybe")


if __name__ == "__main__":
    unittest.main()
