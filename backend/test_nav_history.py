import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nav_history import build_nav_history_payload


class NavHistoryPayloadTest(unittest.TestCase):
    def test_total_return_is_anchored_then_adds_actual_payments(self):
        nav_rows = [
            {"nav_date": "2026-07-01", "total_value": 1000},
            {"nav_date": "2026-07-02", "total_value": 990},
            {"nav_date": "2026-07-06", "total_value": 1010},
        ]
        payment_rows = [
            {"payment_date": "2026-06-30", "amount": 50, "source": "schwab"},
            {"payment_date": "2026-07-02", "amount": 12.50, "source": "schwab"},
            {"payment_date": "2026-07-03", "amount": 7.50, "source": "manual"},
        ]

        payload = build_nav_history_payload(nav_rows, payment_rows)

        self.assertEqual([row["total_return_value"] for row in payload], [1000.0, 1002.5, 1030.0])
        self.assertEqual([row["cumulative_dividends"] for row in payload], [0.0, 12.5, 20.0])

    def test_estimated_payments_are_excluded(self):
        nav_rows = [
            ("2026-07-01", 1000),
            ("2026-07-02", 1000),
        ]
        payment_rows = [
            ("2026-07-02", 25, "refresh_estimate"),
            ("2026-07-02", 10, "portfolio_export"),
        ]

        payload = build_nav_history_payload(nav_rows, payment_rows)

        self.assertEqual(payload[-1]["total_return_value"], 1010.0)
        self.assertEqual(payload[-1]["cumulative_dividends"], 10.0)


if __name__ == "__main__":
    unittest.main()
