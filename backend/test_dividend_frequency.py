import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


def _distributions(dates):
    return pd.Series(1.0, index=pd.to_datetime(dates))


class DividendFrequencyTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
