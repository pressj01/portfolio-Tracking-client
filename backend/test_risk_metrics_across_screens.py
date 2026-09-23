"""Beta and Alpha must mean the same thing on every screen that shows them.

Three screens report these now — the Dashboard Holdings overview, the ETF
Comparer and Security Research — and they all route through `_risk_profile` so a
fix or a guard lands everywhere at once. These tests pin that contract at the
payload level, because a screen assembling its own beta/alpha pair is exactly
the regression that would go unnoticed: each number looks individually plausible
while describing a different benchmark than the one printed next to it.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


def _market(n=400, seed=7):
    """A QQQ-driven fund plus both benchmarks, on one shared calendar.

    Anchored on today: the research helper defaults to a trailing 1Y window, so
    a fixture ending in the past would trim to an empty series.
    """
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=n)
    rng = np.random.default_rng(seed)
    spy = pd.Series(100 * np.cumprod(1 + rng.normal(4e-4, 0.010, n)), index=idx)
    qqq = pd.Series(400 * np.cumprod(1 + rng.normal(5e-4, 0.015, n)), index=idx)
    fund = pd.Series(
        50 * np.cumprod(
            1 + 3e-4 + 1.25 * qqq.pct_change().fillna(0).values
            + rng.normal(0, 0.002, n)
        ),
        index=idx,
    )
    return idx, fund, spy, qqq


class ETFComparerRiskPayloadTest(unittest.TestCase):
    """The comparer must ship whatever _risk_profile measured, unaltered.

    The endpoint reaches several data sources besides the price download, so
    these patch the helper itself: what is under test is the wiring between
    _risk_profile and the payload, not yfinance.
    """

    SENTINEL = {
        "beta": 1.23,
        "alpha": 0.0456,
        "beta_benchmark": "QQQ",
        "delta_up": 0.81,
        "delta_down": 1.14,
    }

    def _fetch(self, risk, info, refresh):
        idx, fund, spy, qqq = _market(n=60)
        zeros = pd.Series(0.0, index=idx)

        def download(tickers, **kwargs):
            wanted = tickers.split() if isinstance(tickers, str) else list(tickers)
            cols = {s: v for s, v in
                    {"FUND": fund, "SPY": spy, "QQQ": qqq}.items() if s in wanted}
            if not cols:
                return pd.DataFrame()
            return pd.concat(
                {
                    "Close": pd.DataFrame(cols, index=idx),
                    "Dividends": pd.DataFrame({s: zeros for s in cols}, index=idx),
                },
                axis=1,
            )

        with (
            patch("app._chunked_yf_download", side_effect=download),
            patch("app._cached_yf_info", return_value=info),
            patch("app._risk_profile", return_value=dict(risk)) as spy_risk,
            patch("app._yf_ticker"),
        ):
            response = app_module.app.test_client().get(
                f"/api/etf-screen/data?ticker=FUND&period=1y&mode=price&refresh={refresh}"
            )
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()["profiles"]["FUND"], spy_risk

    def test_alpha_ships_beside_beta_and_names_the_same_benchmark(self):
        row, spy_risk = self._fetch(self.SENTINEL, {}, "alpha-payload-test")

        self.assertTrue(spy_risk.called, "the comparer must use the shared helper")
        self.assertEqual(row["alpha"], self.SENTINEL["alpha"])
        self.assertEqual(row["beta"], self.SENTINEL["beta"])
        self.assertEqual(row["beta_benchmark"], "QQQ")
        self.assertEqual(row["delta_up"], self.SENTINEL["delta_up"])

    def test_alpha_is_absent_rather_than_guessed_when_beta_falls_back_to_yahoo(self):
        """Yahoo publishes a beta but no alpha; never pair them."""
        blank = dict(self.SENTINEL, beta=None, alpha=None, beta_benchmark=None)
        row, _ = self._fetch(blank, {"beta": 1.11}, "alpha-fallback-test")

        self.assertEqual(row["beta"], 1.11, "Yahoo's beta should still fill in")
        self.assertIsNone(row["beta_benchmark"], row)
        self.assertIsNone(row["alpha"], row)


class SecurityResearchRiskProfileTest(unittest.TestCase):
    def setUp(self):
        self.idx, self.fund, self.spy, self.qqq = _market()
        self.series = {"FUND": self.fund, "SPY": self.spy, "QQQ": self.qqq}

    def _loader(self, symbol, force_refresh=False):
        series = self.series.get(symbol)
        return (series, symbol) if series is not None else (None, symbol)

    def test_profile_carries_beta_alpha_and_a_labelled_window(self):
        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            profile = app_module._research_risk_profile("FUND", "max")

        self.assertEqual(profile["beta_benchmark"], "QQQ")
        self.assertIsNotNone(profile["beta"])
        self.assertAlmostEqual(
            profile["alpha"], app_module._capm_alpha(self.fund, self.qqq), places=9
        )
        # The screen has no range picker, so the payload must say what window it
        # used or the number reads like the Dashboard's selected-range figure.
        window = profile["risk_window"]
        self.assertEqual(window["start"], self.idx[0].strftime("%Y-%m-%d"))
        self.assertEqual(window["end"], self.idx[-1].strftime("%Y-%m-%d"))
        self.assertEqual(window["observations"], len(self.idx))

    def test_a_benchmark_is_not_regressed_against_itself(self):
        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            profile = app_module._research_risk_profile("SPY", "max")

        # SPY vs SPY is a true but useless beta 1.00 / alpha 0.00, so it should
        # route to the other benchmark instead.
        self.assertEqual(profile["beta_benchmark"], "QQQ")

    def test_missing_history_blanks_every_field_without_raising(self):
        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            profile = app_module._research_risk_profile("UNKNOWN", "max")

        self.assertIsNone(profile["beta"])
        self.assertIsNone(profile["alpha"])
        self.assertIsNone(profile["risk_window"])

    def test_yahoo_beta_fills_in_only_when_the_regression_could_not_run(self):
        blank = dict(app_module._risk_profile(None, []), risk_window=None)
        filled = app_module._research_with_yahoo_beta_fallback(blank, {"beta": 0.87})
        self.assertEqual(filled["beta"], 0.87)
        self.assertIsNone(filled["alpha"], "a Yahoo beta must not imply an alpha")
        self.assertIsNone(filled["beta_benchmark"])

        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            real = app_module._research_risk_profile("FUND", "max")
        kept = app_module._research_with_yahoo_beta_fallback(real, {"beta": 0.87})
        self.assertEqual(kept["beta"], real["beta"], "regressed beta must win")


class _InertTicker:
    """A yfinance Ticker stand-in that yields nothing, without raising."""

    funds_data = None
    info = {}
    dividends = pd.Series(dtype=float)

    def history(self, *args, **kwargs):
        return pd.DataFrame()


class AlphaBasisTest(unittest.TestCase):
    """Alpha must be measured on total return, on BOTH sides, on every screen.

    Beta survives a price-only basis almost unchanged, which is why the comparer
    got away with unadjusted closes for years. Alpha is a mean, so stripping a
    fund's distributions moves it by the whole distribution rate: QQQI measured
    -17.32% price-only against -2.33% on total return, a ~15-point gap that is
    purely the income it pays out.
    """

    def _income_fund(self, n=400, payout_annual=0.14):
        """A fund that pays out most of its return, like a covered-call ETF."""
        idx = pd.bdate_range("2024-01-02", periods=n)
        rng = np.random.default_rng(11)
        bench_ret = rng.normal(6e-4, 0.012, n)
        bench = pd.Series(400 * np.cumprod(1 + bench_ret), index=idx)
        # Price grinds sideways because the payout is stripped out daily.
        daily_payout = payout_annual / 252
        price = pd.Series(
            50 * np.cumprod(1 + 0.85 * bench_ret - daily_payout), index=idx
        )
        divs = pd.Series(0.0, index=idx)
        divs.iloc[::21] = price.iloc[::21] * daily_payout * 21
        return price, divs, bench

    def test_stripping_distributions_would_understate_alpha_badly(self):
        price, divs, bench = self._income_fund()
        total_return = app_module._blend_price_drip(price, divs, 1.0, track_cash=True)

        price_only = app_module._capm_alpha(price, bench)
        on_total = app_module._capm_alpha(total_return, bench)

        self.assertLess(price_only, on_total)
        self.assertGreater(
            on_total - price_only, 0.08,
            "a 14%-payout fund should read ~14 points worse on a price-only basis",
        )
        # Beta is the control: it barely moves, which is why only alpha broke.
        self.assertAlmostEqual(
            app_module._beta_and_corr(price, bench)[0],
            app_module._beta_and_corr(total_return, bench)[0],
            delta=0.05,
        )

    def test_a_dividend_stripped_benchmark_gifts_the_fund_free_alpha(self):
        price, divs, bench = self._income_fund()
        total_return = app_module._blend_price_drip(price, divs, 1.0, track_cash=True)
        # Same benchmark with ~1.5%/yr of dividends removed from its path.
        stripped = pd.Series(
            float(bench.iloc[0])
            * np.cumprod(1 + bench.pct_change().fillna(0).values - 0.015 / 252),
            index=bench.index,
        )

        fair = app_module._capm_alpha(total_return, bench)
        flattered = app_module._capm_alpha(total_return, stripped)
        self.assertGreater(
            flattered, fair,
            "regressing total return against a price-only benchmark inflates alpha",
        )


class ProviderMergeKeepsRiskKeysTest(unittest.TestCase):
    """A fund-site profile overlays the Yahoo response; it must not drop risk.

    NEOS/TappAlpha/XFunds ETFs are rebuilt through
    _merge_official_research_profile, which reassigns `response` — so a merge
    that whitelisted keys instead of overlaying would silently blank Beta and
    Alpha for exactly the funds this app cares most about.
    """

    def test_a_neos_fund_still_reports_beta_and_alpha(self):
        idx, fund, spy, qqq = _market()
        series = {"QQQI": fund, "SPY": spy, "QQQ": qqq}

        def loader(symbol, force_refresh=False):
            return (series.get(symbol), symbol)

        official = {
            "name": "NEOS Nasdaq-100 High Income ETF",
            "issuer": "NEOS Investments",
            "data_source": "NEOS Investments",
            "expense_ratio_pct": 0.68,
        }

        with (
            patch("app._research_adjusted_close_series", side_effect=loader),
            patch("app._fetch_neos_etf_profile", return_value=official),
            patch("app._cached_yf_info", return_value={"quoteType": "ETF"}),
            # A bare MagicMock leaks un-serializable attributes into the
            # payload, and a raising stub escapes the endpoint - so hand it an
            # inert ticker with no fund data, which is a branch it handles.
            patch("app._yf_ticker", return_value=_InertTicker()),
            patch("app._chunked_yf_download", return_value=pd.DataFrame()),
        ):
            response = app_module.app.test_client().get(
                "/api/security-research/etf/QQQI"
            )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        # The provider overlay must have happened...
        self.assertEqual(payload.get("data_source"), "NEOS Investments", payload)
        # ...without losing the regression the shared helper produced.
        for key in ("beta", "alpha", "beta_benchmark", "risk_window"):
            self.assertIn(key, payload, f"{key} was dropped by the provider merge")
        self.assertEqual(payload["beta_benchmark"], "QQQ", payload)
        self.assertIsNotNone(payload["beta"], payload)
        self.assertIsNotNone(payload["alpha"], payload)


class ResearchRiskWindowTest(unittest.TestCase):
    """Security Research's window control must line up with the comparer's.

    Two screens showing the same fund a different alpha is defensible only if
    the user can put them on the same window and see them agree. "1Y" therefore
    has to mean the identical span on both, which is why both resolve it through
    _etf_screen_period_bounds rather than each rolling their own.
    """

    def setUp(self):
        idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=900)
        rng = np.random.default_rng(23)
        spy = pd.Series(100 * np.cumprod(1 + rng.normal(4e-4, 0.010, 900)), index=idx)
        qqq = pd.Series(400 * np.cumprod(1 + rng.normal(5e-4, 0.015, 900)), index=idx)
        fund = pd.Series(
            50 * np.cumprod(
                1 + 2e-4 + 1.2 * qqq.pct_change().fillna(0).values
                + rng.normal(0, 0.002, 900)
            ),
            index=idx,
        )
        self.series = {"FUND": fund, "SPY": spy, "QQQ": qqq}

    def _loader(self, symbol, force_refresh=False):
        return (self.series.get(symbol), symbol)

    def test_the_window_honours_the_requested_period(self):
        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            one_year = app_module._research_risk_profile("FUND", "1y")
            full = app_module._research_risk_profile("FUND", "max")

        self.assertEqual(one_year["risk_period"], "1y")
        self.assertLess(
            one_year["risk_window"]["observations"],
            full["risk_window"]["observations"],
            "1Y must measure fewer days than the full history",
        )
        self.assertNotAlmostEqual(one_year["alpha"], full["alpha"], places=6)

    def test_one_year_spans_exactly_the_comparers_one_year(self):
        bounds = app_module._etf_screen_period_bounds("1y")
        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            profile = app_module._research_risk_profile("FUND", "1y")

        window = profile["risk_window"]
        self.assertGreaterEqual(window["start"], bounds[0].strftime("%Y-%m-%d"))
        self.assertLessEqual(window["end"], bounds[1].strftime("%Y-%m-%d"))

    def test_the_benchmark_is_trimmed_to_the_same_span_as_the_fund(self):
        """Regressing a 1Y fund against a full-history benchmark is meaningless."""
        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            profile = app_module._research_risk_profile("FUND", "1y")

        trimmed_fund = app_module._research_trim_to_period(self.series["FUND"], "1y")
        trimmed_bench = app_module._research_trim_to_period(self.series["QQQ"], "1y")
        self.assertAlmostEqual(
            profile["alpha"],
            app_module._capm_alpha(trimmed_fund, trimmed_bench),
            places=9,
        )

    def test_an_unknown_period_falls_back_to_full_history_not_an_error(self):
        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            bogus = app_module._research_risk_profile("FUND", "not-a-period")
            full = app_module._research_risk_profile("FUND", "max")
        self.assertEqual(bogus["alpha"], full["alpha"])

    def test_the_risk_endpoint_serves_one_window_without_the_full_payload(self):
        with patch("app._research_adjusted_close_series", side_effect=self._loader):
            response = app_module.app.test_client().get(
                "/api/security-research/risk/FUND?period=1y"
            )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        self.assertEqual(payload["risk_period"], "1y")
        self.assertIsNotNone(payload["alpha"])
        # Cheap by construction: no issuer scrape, no Yahoo profile fields.
        self.assertNotIn("business_summary", payload)
        self.assertNotIn("top_holdings", payload)


class SharedHelperIsTheOnlyAssemblerTest(unittest.TestCase):
    def test_no_screen_builds_its_own_beta_alpha_pair(self):
        """_capm_alpha must only ever be called from inside _risk_profile."""
        source = Path(app_module.__file__).with_suffix(".py").read_text(encoding="utf-8")
        call_sites = [
            line.strip()
            for line in source.splitlines()
            if "_capm_alpha(" in line and not line.strip().startswith("#")
            and "def _capm_alpha" not in line
        ]
        self.assertEqual(
            len(call_sites), 1,
            "alpha is assembled somewhere other than _risk_profile:\n"
            + "\n".join(call_sites),
        )
        self.assertIn('"alpha": _capm_alpha(fund_close, bench_close)', call_sites[0])


if __name__ == "__main__":
    unittest.main()
