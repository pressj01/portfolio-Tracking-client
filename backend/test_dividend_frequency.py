import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


def _distributions(dates):
    return pd.Series(1.0, index=pd.to_datetime(dates))


class DividendFrequencyTest(unittest.TestCase):
    def test_research_frequency_uses_wrth_quarterly_launch_schedule(self):
        divs = _distributions(["2026-06-29"])

        self.assertEqual(
            app_module._research_dividend_frequency(divs, "WRTH"),
            "Quarterly",
        )

    def test_research_frequency_does_not_guess_monthly_from_one_payment(self):
        divs = _distributions(["2026-06-29"])

        self.assertEqual(
            app_module._research_dividend_frequency(divs, "NEWF"),
            "Annual/Irregular",
        )

    def test_research_frequency_prefers_observed_spacing_after_launch(self):
        divs = _distributions([
            "2026-06-29", "2026-07-29", "2026-08-28",
        ])

        self.assertEqual(
            app_module._research_dividend_frequency(divs, "WRTH"),
            "Monthly",
        )

    def test_recent_monthly_cadence_overrides_older_quarterly_history(self):
        # Regression: OVL changed from quarterly to monthly in January 2026.
        divs = _distributions([
            "2025-04-03", "2025-07-03", "2025-10-03", "2025-12-23",
            "2026-01-28", "2026-02-25", "2026-03-27", "2026-04-28",
            "2026-05-27",
        ])

        self.assertEqual(app_module._div_calc_infer_frequency(divs), "M")

    def test_annualized_yield_uses_only_new_monthly_run(self):
        dates = [
            "2025-04-03", "2025-07-03", "2025-10-03",
            "2025-12-23", "2026-01-28", "2026-02-25", "2026-03-27",
            "2026-04-28", "2026-05-27",
        ]
        amounts = [0.374, 0.390, 0.410, 0.420, 0.471, 0.466, 0.441, 0.469, 0.498]
        divs = pd.Series(amounts, index=pd.to_datetime(dates))

        annual, _ttm, source = app_module._div_calc_annual_dividend(divs, "M")

        self.assertAlmostEqual(annual, 5.53, places=2)
        self.assertEqual(source, "annualized_recent_distributions")

    def test_recent_quarterly_cadence_remains_quarterly(self):
        divs = _distributions([
            "2025-07-03", "2025-10-03", "2025-12-23", "2026-03-27",
        ])

        self.assertEqual(app_module._div_calc_infer_frequency(divs), "Q")

    def test_one_shifted_monthly_payment_does_not_break_cadence(self):
        divs = _distributions([
            "2026-01-02", "2026-01-30", "2026-03-06", "2026-04-03",
        ])

        self.assertEqual(app_module._div_calc_infer_frequency(divs), "M")

    def test_fresh_monthly_snapshot_overrides_stale_weekly_database_value(self):
        # Regression: TUGN was stored as weekly, which annualized its $0.275
        # monthly distribution 52 times rather than 12 times.
        self.assertEqual(
            app_module._resolve_refresh_dividend_frequency("TUGN", "M", set()),
            "M",
        )

    def test_curated_weekly_override_remains_authoritative(self):
        self.assertEqual(
            app_module._resolve_refresh_dividend_frequency("KYLD", "M", {"KYLD"}),
            "W",
        )

    def test_refresh_preserves_saved_frequency_when_one_payment_cannot_establish_cadence(self):
        divs = _distributions(["2026-06-29"])

        self.assertEqual(
            app_module._resolve_refresh_dividend_frequency(
                "NEWF",
                "A",
                set(),
                fallback_frequency="Q",
                history=divs,
            ),
            "Q",
        )

    def test_refresh_uses_wrth_launch_schedule_until_spacing_is_observed(self):
        divs = _distributions(["2026-06-29"])

        self.assertEqual(
            app_module._resolve_refresh_dividend_frequency(
                "WRTH",
                "A",
                set(),
                history=divs,
            ),
            "Q",
        )

    def test_refresh_prefers_observed_cadence_over_saved_frequency(self):
        divs = _distributions([
            "2026-06-29", "2026-07-29", "2026-08-28",
        ])

        self.assertEqual(
            app_module._resolve_refresh_dividend_frequency(
                "WRTH",
                "M",
                set(),
                fallback_frequency="Q",
                history=divs,
            ),
            "M",
        )


if __name__ == "__main__":
    unittest.main()
