"""Transferred-in shares: cost basis and carried-over holding period.

Two defects are covered here.

Basis: an ACAT '[Transfer in]' arrives as a BUY priced at 0, because a broker
activity export has no price on that row. The lot queue could not tell that
apart from shares that genuinely cost nothing, so every later SELL consumed a
$0 lot and booked the entire proceeds as realized gain.

Holding period: the transaction date on a transfer is the day the shares
landed at the receiving broker, but the capital-gains holding period carries
over from the delivering broker. Terming off the transaction date alone made
long-held positions read short-term for a year after any account move.
"""

import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import tax_report
from app import (
    _refresh_transaction_realized_gains,
    _scan_cost_basis_gaps,
    _transfer_in_cost_per_share,
)

SCHEMA = """
CREATE TABLE all_account_info (
    ticker TEXT,
    profile_id INTEGER,
    quantity REAL,
    price_paid REAL,
    purchase_value REAL,
    original_price_paid REAL,
    original_purchase_value REAL,
    broker_price_paid REAL,
    broker_purchase_value REAL,
    purchase_date TEXT,
    import_date TEXT,
    realized_gains REAL,
    current_price REAL,
    classification_type TEXT
);
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    profile_id INTEGER,
    transaction_type TEXT,
    transaction_date TEXT,
    acquired_date TEXT,
    shares REAL,
    price_per_share REAL,
    fees REAL,
    notes TEXT,
    realized_gain REAL
);
CREATE TABLE transaction_lot_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sell_txn_id INTEGER,
    buy_txn_id INTEGER,
    shares REAL
);
CREATE TABLE profiles (
    id INTEGER PRIMARY KEY,
    name TEXT,
    include_in_owner INTEGER DEFAULT 0
);
CREATE TABLE dividend_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    profile_id INTEGER,
    payment_date TEXT,
    amount REAL,
    source TEXT,
    notes TEXT
);
CREATE TABLE dividend_tax_overrides (
    ticker TEXT,
    profile_id INTEGER,
    year INTEGER,
    treatment TEXT,
    qualified_pct REAL,
    ordinary_pct REAL,
    roc_pct REAL,
    total_amount REAL
);
"""


class TransferBasisTestCase(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.execute("INSERT INTO profiles (id, name) VALUES (7, 'Brokerage')")

    def tearDown(self):
        self.conn.close()

    def _holding(self, ticker, price_paid, quantity=100):
        self.conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, price_paid) "
            "VALUES (?, 7, ?, ?)",
            (ticker, quantity, price_paid),
        )

    def _txn(self, ticker, ttype, date, shares, price, notes="", acquired=None):
        cur = self.conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, "
            "transaction_date, acquired_date, shares, price_per_share, fees, notes) "
            "VALUES (?, 7, ?, ?, ?, ?, ?, 0, ?)",
            (ticker, ttype, date, acquired, shares, price, notes),
        )
        return cur.lastrowid

    def _gain(self, txn_id):
        row = self.conn.execute(
            "SELECT realized_gain FROM transactions WHERE id = ?", (txn_id,)
        ).fetchone()
        return row["realized_gain"]


class TransferInCostResolutionTest(TransferBasisTestCase):
    def test_zero_priced_transfer_in_uses_the_positions_carried_over_basis(self):
        # The bug: 8 shares arrive by ACAT at $0 and sell for $90.07 each.
        # Booking $720.56 of proceeds as $720.56 of profit is the defect.
        self._holding("CAOS", price_paid=62.50)
        self._txn("CAOS", "BUY", "2025-07-25", 8, 0, notes="[Transfer in] ACAT")
        sell_id = self._txn("CAOS", "SELL", "2025-11-14", 8, 90.07)

        _refresh_transaction_realized_gains("CAOS", 7, self.conn)

        # 8 * (90.07 - 62.50) = 220.56
        self.assertAlmostEqual(self._gain(sell_id), 220.56, places=2)

    def test_transfer_in_without_any_recoverable_basis_reports_no_gain(self):
        # Position was closed out, so no holding row survives to read a basis
        # from. Proceeds-minus-zero is not a gain, and must not be reported as
        # one; the sell is left unpriced for the repair report to surface.
        self._txn("NTSX", "BUY", "2025-07-25", 1, 0, notes="[Transfer in] ACAT")
        sell_id = self._txn("NTSX", "SELL", "2025-09-26", 1, 53.24)

        _refresh_transaction_realized_gains("NTSX", 7, self.conn)

        self.assertIsNone(self._gain(sell_id))

    def test_hand_entered_price_on_a_transfer_in_is_used_as_given(self):
        # The escape hatch: once the user supplies the real carried-over cost
        # it must win over the position's blended average.
        self._holding("VTI", price_paid=250.00)
        self._txn("VTI", "BUY", "2025-01-09", 10, 120.00, notes="[Transfer in] ACAT")
        sell_id = self._txn("VTI", "SELL", "2025-06-02", 10, 300.00)

        _refresh_transaction_realized_gains("VTI", 7, self.conn)

        self.assertAlmostEqual(self._gain(sell_id), 1800.00, places=2)

    def test_ordinary_zero_priced_buy_is_left_alone(self):
        # Only transfers get the substitute basis. A $0 BUY with no transfer
        # tag (a genuine freebie, a spinoff share) keeps its zero cost.
        self._holding("FREE", price_paid=25.00)
        self._txn("FREE", "BUY", "2025-02-01", 4, 0, notes="Promotional shares")
        sell_id = self._txn("FREE", "SELL", "2025-08-01", 4, 10.00)

        _refresh_transaction_realized_gains("FREE", 7, self.conn)

        self.assertAlmostEqual(self._gain(sell_id), 40.00, places=2)

    def test_transfer_out_still_records_no_gain(self):
        # The existing transfer-out guard must survive the transfer-in fix.
        self._holding("MOVE", price_paid=10.00)
        self._txn("MOVE", "BUY", "2025-01-02", 50, 10.00)
        out_id = self._txn("MOVE", "SELL", "2025-03-02", 50, 0,
                           notes="[Transfer out] ACAT")

        _refresh_transaction_realized_gains("MOVE", 7, self.conn)

        self.assertIsNone(self._gain(out_id))

    def test_partial_sale_mixing_real_and_transferred_lots(self):
        # FIFO consumes the transferred lot first, then the real one.
        self._holding("ARCC", price_paid=18.00)
        self._txn("ARCC", "BUY", "2025-07-25", 8, 0, notes="[Transfer in] ACAT")
        self._txn("ARCC", "BUY", "2025-08-01", 4, 20.00)
        sell_id = self._txn("ARCC", "SELL", "2025-09-23", 10, 21.00)

        _refresh_transaction_realized_gains("ARCC", 7, self.conn)

        # 8 transferred @18 + 2 real @20 = 184 cost, 210 proceeds
        self.assertAlmostEqual(self._gain(sell_id), 26.00, places=2)

    def test_sell_against_an_empty_queue_with_no_basis_reports_no_gain(self):
        # JNJ's shape: a transfer-out drained the queue, the position was later
        # closed, and the remaining sells found nothing to cost against. The
        # empty-queue fallback has no holding row to read, so charging zero
        # booked the whole sale as profit.
        self._txn("JNJ", "BUY", "2022-09-30", 15, 0, notes="[Transfer in] TDA TRAN")
        self._txn("JNJ", "SELL", "2024-05-13", 15, 0, notes="[Transfer out] TDA TRAN")
        sell_id = self._txn("JNJ", "SELL", "2026-06-29", 38.3018, 254.8499)

        _refresh_transaction_realized_gains("JNJ", 7, self.conn)

        self.assertIsNone(self._gain(sell_id))

    def test_empty_queue_sell_still_uses_the_holding_basis_when_there_is_one(self):
        # The existing RDGL repair must keep working: an open position lends
        # its basis to shares the queue cannot account for.
        self._holding("RDGL", price_paid=0.14)
        self._txn("RDGL", "SELL", "2025-04-01", 6000, 0.1376)

        _refresh_transaction_realized_gains("RDGL", 7, self.conn)

        gains = self.conn.execute(
            "SELECT realized_gain FROM transactions WHERE ticker = 'RDGL'"
        ).fetchone()["realized_gain"]
        self.assertIsNotNone(gains)
        self.assertAlmostEqual(gains, -14.40, places=2)

    def test_cost_resolution_helper_reports_unknown_only_without_a_fallback(self):
        self.assertEqual(
            _transfer_in_cost_per_share("BUY", 0, "[Transfer in] ACAT", 31.25),
            (31.25, False),
        )
        self.assertEqual(
            _transfer_in_cost_per_share("BUY", 0, "[Transfer in] ACAT", None),
            (0.0, True),
        )
        self.assertEqual(
            _transfer_in_cost_per_share("BUY", 12.5, "[Transfer in] ACAT", 31.25),
            (12.5, False),
        )
        self.assertEqual(
            _transfer_in_cost_per_share("BUY", 0, "Regular buy", 31.25),
            (0.0, False),
        )


class StableNavBasisTest(TransferBasisTestCase):
    """Cash sweeps: more shares sold than bought, no holding, one fixed price."""

    def _spaxx_ledger(self):
        # Fidelity's core sweep. Money reaches it by routes the activity export
        # does not record as purchases, so sells outnumber buys and the queue
        # drains. Every share is worth exactly $1.00, always.
        self._txn("SPAXX", "BUY", "2024-09-24", 1000, 1.00)
        self._txn("SPAXX", "BUY", "2024-10-01", 715617.79, 1.00)
        return self._txn("SPAXX", "SELL", "2026-05-01", 139452.18, 1.00)

    def test_sweep_sale_beyond_the_recorded_buys_is_not_pure_profit(self):
        sell_id = self._spaxx_ledger()
        # Drain the queue first so the sale lands on untracked shares.
        self._txn("SPAXX", "SELL", "2025-01-02", 716617.79, 1.00)

        _refresh_transaction_realized_gains("SPAXX", 7, self.conn)

        self.assertAlmostEqual(self._gain(sell_id), 0.0, places=2)

    def test_uniform_buy_price_supplies_the_basis(self):
        self._spaxx_ledger()
        self.assertAlmostEqual(
            app_module._uniform_buy_price(self.conn, "SPAXX", 7), 1.00, places=4
        )

    def test_mixed_purchase_prices_yield_no_uniform_basis(self):
        self._txn("MSFT", "BUY", "2024-01-02", 10, 300.00)
        self._txn("MSFT", "BUY", "2024-06-02", 10, 420.00)
        self.assertIsNone(app_module._uniform_buy_price(self.conn, "MSFT", 7))

    def test_zero_priced_transfer_buys_do_not_count_as_a_uniform_price(self):
        # Otherwise a transferred-in lot would resolve to a basis of free
        # instead of being reported as unknown.
        self._txn("GONE", "BUY", "2025-07-25", 8, 0, notes="[Transfer in] ACAT")
        self.assertIsNone(app_module._uniform_buy_price(self.conn, "GONE", 7))

    def test_holding_basis_still_wins_over_the_uniform_price(self):
        self._holding("ARCC", price_paid=18.00)
        self._txn("ARCC", "BUY", "2024-01-02", 100, 20.00)
        self.assertAlmostEqual(
            app_module._untracked_share_basis(self.conn, "ARCC", 7), 18.00, places=2
        )

    def test_tax_report_does_not_bill_a_sweep_sale_as_gain(self):
        self._spaxx_ledger()
        self._txn("SPAXX", "SELL", "2025-01-02", 716617.79, 1.00)

        result = tax_report.compute_realized_lots(self.conn, 7, 2026)

        self.assertTrue(result["lots"])
        self.assertAlmostEqual(result["totals"]["total"], 0.0, places=2)
        self.assertEqual(result["totals"]["unknown_basis_lots"], 0)

    def test_tax_report_flags_unmatched_shares_with_no_basis_at_all(self):
        # No buys anywhere, so nothing can price these shares.
        self._txn("MYST", "SELL", "2025-04-01", 10, 25.00)

        result = tax_report.compute_realized_lots(self.conn, 7, 2025)

        lot = result["lots"][0]
        self.assertTrue(lot["basis_unknown"])
        self.assertIsNone(lot["gain"])
        self.assertAlmostEqual(result["totals"]["total"], 0.0, places=2)


class TransferBasisReportTest(TransferBasisTestCase):
    def test_report_separates_recoverable_from_unrecoverable_lots(self):
        self._holding("OPEN", price_paid=40.00)
        self._txn("OPEN", "BUY", "2025-07-25", 5, 0, notes="[Transfer in] ACAT")
        self._txn("GONE", "BUY", "2025-07-25", 3, 0, notes="[Transfer in] ACAT")
        self._txn("GONE", "SELL", "2025-10-01", 3, 15.00)

        report = _scan_cost_basis_gaps(self.conn, [7])

        self.assertEqual([e["ticker"] for e in report["resolved"]], ["OPEN"])
        self.assertEqual(report["resolved"][0]["resolved_basis"], 40.00)
        self.assertEqual([e["ticker"] for e in report["unresolved"]], ["GONE"])
        self.assertEqual([s["ticker"] for s in report["affected_sells"]], ["GONE"])
        self.assertEqual(report["affected_sells"][0]["proceeds"], 45.00)

    def test_targets_include_positions_that_only_transferred_out(self):
        # A transfer-out drains the queue, so sells recorded after it lose
        # their basis too and must be replayed even though no transfer-in
        # lot exists on the position.
        self._holding("SENT", price_paid=12.00)
        self._txn("SENT", "BUY", "2024-01-02", 100, 12.00)
        self._txn("SENT", "SELL", "2024-05-13", 100, 0, notes="[Transfer out] ACAT")
        self._txn("SENT", "SELL", "2025-03-01", 20, 30.00)

        report = _scan_cost_basis_gaps(self.conn, [7])

        self.assertEqual(report["unresolved"], [])
        self.assertIn(("SENT", 7), [tuple(t) for t in report["targets"]])

    def test_targets_cover_a_position_whose_totals_balance(self):
        # SQQQ's shape: buys and sells net to zero, but a sell dated ahead of
        # its covering buy still finds an empty queue. No share-count test
        # catches that, so every position with a sell is replayed.
        self._txn("SQQQ", "SELL", "2025-03-31", 60, 38.00)
        self._txn("SQQQ", "BUY", "2025-04-02", 60, 34.66)

        report = _scan_cost_basis_gaps(self.conn, [7])

        self.assertIn(("SQQQ", 7), [tuple(t) for t in report["targets"]])

    def test_positions_with_no_sells_are_not_replayed(self):
        self._holding("HOLD", price_paid=10.00)
        self._txn("HOLD", "BUY", "2025-01-02", 50, 10.00)

        report = _scan_cost_basis_gaps(self.conn, [7])

        self.assertNotIn(("HOLD", 7), [tuple(t) for t in report["targets"]])

    def test_priced_transfer_in_is_not_reported(self):
        self._holding("DONE", price_paid=40.00)
        self._txn("DONE", "BUY", "2025-07-25", 5, 38.10, notes="[Transfer in] ACAT")

        report = _scan_cost_basis_gaps(self.conn, [7])

        self.assertEqual(report["resolved"], [])
        self.assertEqual(report["unresolved"], [])


class AcquiredDateHoldingPeriodTest(TransferBasisTestCase):
    def _lots(self, year=2025):
        return tax_report.compute_realized_lots(self.conn, 7, year)

    def test_carried_over_acquisition_date_makes_a_transfer_long_term(self):
        # VTI held at the old broker since 2021, moved 2025-01-09, sold in
        # June. Terming off the transfer date alone called this short-term.
        self._holding("VTI", price_paid=200.00)
        self._txn("VTI", "BUY", "2025-01-09", 10, 200.00,
                  notes="[Transfer in] ACAT", acquired="2021-04-15")
        self._txn("VTI", "SELL", "2025-06-02", 10, 300.00)

        result = self._lots()

        self.assertEqual(len(result["lots"]), 1)
        lot = result["lots"][0]
        self.assertEqual(lot["term"], "LT")
        self.assertEqual(lot["acquired_date"], "2021-04-15")
        self.assertAlmostEqual(result["totals"]["long_term"], 1000.00, places=2)
        self.assertAlmostEqual(result["totals"]["short_term"], 0.0, places=2)

    def test_without_an_acquired_date_the_transaction_date_still_governs(self):
        self._holding("QQQ", price_paid=100.00)
        self._txn("QQQ", "BUY", "2025-01-09", 10, 100.00)
        self._txn("QQQ", "SELL", "2025-06-02", 10, 130.00)

        result = self._lots()

        self.assertEqual(result["lots"][0]["term"], "ST")
        self.assertAlmostEqual(result["totals"]["short_term"], 300.00, places=2)

    def test_acquired_date_does_not_override_a_genuinely_short_hold(self):
        # Bought at the old broker only weeks before the move.
        self._holding("SPY", price_paid=500.00)
        self._txn("SPY", "BUY", "2025-01-09", 2, 500.00,
                  notes="[Transfer in] ACAT", acquired="2024-12-20")
        self._txn("SPY", "SELL", "2025-06-02", 2, 560.00)

        result = self._lots()

        self.assertEqual(result["lots"][0]["term"], "ST")


class TaxReportTransferBasisTest(TransferBasisTestCase):
    def _lots(self, year=2025):
        return tax_report.compute_realized_lots(self.conn, 7, year)

    def test_tax_report_prices_a_transferred_lot_from_the_holding(self):
        self._holding("CAOS", price_paid=62.50)
        self._txn("CAOS", "BUY", "2025-07-25", 8, 0, notes="[Transfer in] ACAT")
        self._txn("CAOS", "SELL", "2025-11-14", 8, 90.07)

        result = self._lots()

        lot = result["lots"][0]
        self.assertFalse(lot["basis_unknown"])
        self.assertAlmostEqual(lot["cost"], 500.00, places=2)
        self.assertAlmostEqual(lot["gain"], 220.56, places=2)
        self.assertAlmostEqual(result["totals"]["total"], 220.56, places=2)

    def test_unknown_basis_lot_is_flagged_and_kept_out_of_the_totals(self):
        # Reporting proceeds-minus-zero would overstate the year's gains by
        # the entire sale amount, which is the defect being fixed.
        self._txn("NTSX", "BUY", "2025-07-25", 1, 0, notes="[Transfer in] ACAT")
        self._txn("NTSX", "SELL", "2025-09-26", 1, 53.24)

        result = self._lots()

        lot = result["lots"][0]
        self.assertTrue(lot["basis_unknown"])
        self.assertIsNone(lot["gain"])
        self.assertTrue(lot["needs_basis"])
        self.assertAlmostEqual(result["totals"]["total"], 0.0, places=2)
        self.assertAlmostEqual(result["totals"]["short_term"], 0.0, places=2)
        self.assertEqual(result["totals"]["unknown_basis_lots"], 1)
        self.assertAlmostEqual(
            result["totals"]["unknown_basis_proceeds"], 53.24, places=2
        )

    def test_ordinary_lots_are_untouched_by_the_transfer_handling(self):
        self._holding("MSFT", price_paid=300.00)
        self._txn("MSFT", "BUY", "2023-02-01", 5, 300.00)
        self._txn("MSFT", "SELL", "2025-05-05", 5, 400.00)

        result = self._lots()

        lot = result["lots"][0]
        self.assertEqual(lot["term"], "LT")
        self.assertFalse(lot["basis_unknown"])
        self.assertAlmostEqual(lot["gain"], 500.00, places=2)
        self.assertEqual(result["totals"]["unknown_basis_lots"], 0)


if __name__ == "__main__":
    unittest.main()
