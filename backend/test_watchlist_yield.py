import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class WatchlistExpectedYieldTest(unittest.TestCase):
    def test_drmp_prefers_issuer_distribution_rate(self):
        distributions = pd.Series(
            [0.20, 0.20, 0.20, 0.20, 0.16, 0.16],
            index=pd.to_datetime([
                "2026-06-18", "2026-06-26", "2026-07-02",
                "2026-07-10", "2026-07-17", "2026-07-24",
            ]),
        )

        result, source = app_module._expected_annual_distribution_yield_pct(
            "DRMP",
            21.61,
            distributions,
            frequency="W",
            distribution_rate_pct=37.44,
        )

        self.assertEqual(result, 37.44)
        self.assertEqual(source, "issuer_distribution_rate")

    def test_qvol_annualizes_current_monthly_distributions(self):
        distributions = pd.Series(
            [1.00, 1.04],
            index=pd.to_datetime(["2026-05-28", "2026-06-29"]),
        )

        result, source = app_module._expected_annual_distribution_yield_pct(
            "QVOL",
            94.6351,
            distributions,
            frequency="M",
        )

        self.assertAlmostEqual(result, 12.93, places=2)
        self.assertEqual(source, "annualized_recent_distributions")

    def test_wrth_annualizes_partial_first_quarter_since_launch(self):
        distributions = pd.Series(
            [0.4094],
            index=pd.to_datetime(["2026-06-29"]),
        )
        price_history = pd.Series(
            [25.00, 25.705],
            index=pd.to_datetime(["2026-04-28", "2026-07-24"]),
        )

        result, source = app_module._expected_annual_distribution_yield_pct(
            "WRTH",
            25.705,
            distributions,
            frequency="Q",
            price_history=price_history,
        )

        self.assertAlmostEqual(result, 9.38, places=2)
        self.assertEqual(source, "annualized_since_launch")

    def test_established_monthly_fund_uses_full_trailing_year(self):
        # Anchored to today: fixed dates age out of the trailing year and the
        # test then measures 11 payments while claiming to measure 12.
        distributions = pd.Series(
            [1.00] * 12,
            index=pd.date_range(
                pd.Timestamp.today().normalize() - pd.DateOffset(months=11),
                periods=12,
                freq="MS",
            ),
        )

        result, source = app_module._expected_annual_distribution_yield_pct(
            "ESTB",
            100.00,
            distributions,
            frequency="M",
        )

        self.assertEqual(result, 12.00)
        self.assertEqual(source, "trailing_12_month")


if __name__ == "__main__":
    unittest.main()
