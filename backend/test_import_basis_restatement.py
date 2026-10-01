"""A re-imported spreadsheet row must move the cost basis the holdings table shows.

The merge updated price_paid/purchase_value but left original_* and broker_*
at what the first import recorded, so a position re-imported with more shares
kept reporting the old total against the new share count.
"""
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_data import _basis_restatement


class BasisRestatementTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute(
            """CREATE TABLE all_account_info (
                   ticker TEXT, profile_id INTEGER, quantity REAL, price_paid REAL,
                   purchase_value REAL, original_price_paid REAL,
                   original_purchase_value REAL, broker_price_paid REAL,
                   broker_purchase_value REAL)"""
        )
        self.conn.execute(
            "INSERT INTO all_account_info VALUES ('ABC', 1, 10, 20, 200, 20, 200, 18, 180)"
        )
        self.cur = self.conn.cursor()

    def tearDown(self):
        self.conn.close()

    def _restate(self, quantity, price_paid, purchase_value, **kwargs):
        sets, values = _basis_restatement(
            self.cur, "ABC", 1, quantity, price_paid, purchase_value, **kwargs
        )
        return dict(zip((s.split(" = ")[0] for s in sets), values))

    def test_unchanged_row_leaves_a_hand_edited_basis_alone(self):
        self.assertEqual(self._restate(10, 20, 200), {})

    def test_more_shares_at_a_new_cost_restates_both_bases(self):
        self.assertEqual(self._restate(20, 25, 500), {
            "original_price_paid": 25, "original_purchase_value": 500,
            "broker_price_paid": 25, "broker_purchase_value": 500,
        })

    def test_corrected_cost_at_the_same_shares_is_a_restatement(self):
        self.assertEqual(self._restate(10, 22, 220)["original_purchase_value"], 220)

    def test_missing_total_is_derived_from_shares_and_price(self):
        self.assertEqual(self._restate(20, 25, float("nan"))["original_purchase_value"], 500)

    def test_sheet_without_cost_keeps_each_price_and_moves_the_totals(self):
        # price_paid here is only today's price standing in for a missing column.
        self.assertEqual(self._restate(20, 31.5, 630, sheet_has_cost=False), {
            "original_purchase_value": 400,
            "broker_purchase_value": 360,
        })
        self.assertEqual(self._restate(10, 31.5, 315, sheet_has_cost=False), {})

    def test_new_ticker_has_nothing_to_restate(self):
        self.assertEqual(
            _basis_restatement(self.cur, "NEW", 1, 5, 10, 50), ([], [])
        )


if __name__ == "__main__":
    unittest.main()
