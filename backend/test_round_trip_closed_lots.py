"""A position sold out and bought back is two histories, not one open one.

CRF (reported from a Fidelity account): bought 2024-11-04, reinvested monthly,
sold to zero on 2025-10-17 in two FIFO sales, then bought again a year later.
Tax-Loss Harvest counted a lot as sold only when a sale named it in
transaction_lot_allocations, which an imported or FIFO sale never does, so the
2024 lot -- 2,387 shares at $8.39 -- came back as a $6,444.90 harvestable loss
on shares that no longer exist. Transaction History asked only whether the
ticker is held today, so every row of the closed round trip read "Open".
"""

import sqlite3
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import config
import database
import tax_loss

# (date, side, shares, price, notes) exactly as the broker export lists them.
DRIP = "[DRIP] Reinvestment"
CRF_FIRST_ROUND_TRIP = [
    ("2024-11-04", "BUY", 2387, 8.39, ""),
    ("2024-12-02", "BUY", 36.083, 6.86, DRIP),
    ("2025-01-07", "BUY", 37.006, 6.79, DRIP),
    ("2025-02-04", "BUY", 42.132, 6.82, DRIP),
    ("2025-03-03", "BUY", 44.148, 6.62, DRIP),
    ("2025-04-01", "BUY", 49.242, 6.04, DRIP),
    ("2025-04-07", "BUY", 785, 6.38, ""),
    ("2025-05-05", "BUY", 67.267, 5.87, DRIP),
    ("2025-06-04", "BUY", 64.331, 6.26, DRIP),
    ("2025-06-30", "BUY", 63.015, 6.51, DRIP),
    ("2025-08-01", "BUY", 63.271, 6.60, DRIP),
    ("2025-08-29", "BUY", 64.784, 6.56, DRIP),
    ("2025-09-30", "BUY", 65.24, 6.63, DRIP),
    ("2025-10-17", "SELL", 3768, 7.93, ""),
    ("2025-10-17", "SELL", 0.519, 7.94, ""),
]
CRF_SECOND_ROUND_TRIP = [
    ("2026-10-05", "BUY", 812, 6.16, ""),
    ("2026-10-16", "BUY", 850, 5.86, ""),
    ("2026-10-26", "BUY", 1660, 5.64, ""),
    ("2026-10-30", "BUY", 120, 5.85, ""),
    ("2026-11-06", "BUY", 16.275, 5.87, DRIP),
]
CRF_HELD_NOW = sum(row[2] for row in CRF_SECOND_ROUND_TRIP)
CRF_PRICE_NOW = 5.69
TODAY = date(2026, 11, 15)
ACCOUNT = 2


class RoundTripClosedLotsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        app_module._ensure_basis_columns(conn)
        conn.execute("DELETE FROM profiles")
        conn.execute(
            "INSERT INTO profiles (id, name, broker_source, positions_managed) VALUES "
            "(1, 'Owner', '', 0), (2, 'Trust 2.0', '', 0)"
        )
        for day, side, shares, price, notes in [*CRF_FIRST_ROUND_TRIP, *CRF_SECOND_ROUND_TRIP]:
            self._insert_txn(conn, "CRF", side, day, shares, price, notes)
        # The closed round trip's last distribution paid after the sale.
        for day, amount in (("2025-09-30", 432.54), ("2025-11-03", 440.16), ("2026-11-06", 95.49)):
            conn.execute(
                "INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source, notes) "
                "VALUES ('CRF', ?, ?, ?, 'import', 'Dividend Received')",
                (ACCOUNT, day, amount),
            )
        conn.execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, base_quantity, price_paid, purchase_value, "
            "current_price, current_value, import_date) VALUES ('CRF', ?, ?, ?, 5.79, ?, ?, ?, '2026-11-06')",
            (ACCOUNT, CRF_HELD_NOW, CRF_HELD_NOW, round(CRF_HELD_NOW * 5.79, 2),
             CRF_PRICE_NOW, round(CRF_HELD_NOW * CRF_PRICE_NOW, 2)),
        )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_db_path = config.DB_PATH
        config.DB_PATH = self.db_path
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        config.DB_PATH = self._orig_db_path
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass

    @staticmethod
    def _insert_txn(conn, ticker, side, day, shares, price, notes="", pid=ACCOUNT):
        return conn.execute(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, "
            "shares, price_per_share, fees, notes) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
            (ticker, pid, side, day, shares, price, notes),
        ).lastrowid

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _candidates(self, today=TODAY):
        conn = self._get_connection()
        try:
            scope = {"holding_profile_ids": [ACCOUNT], "transaction_profile_ids": [ACCOUNT]}
            return tax_loss.build_candidates(conn, scope, today=today)
        finally:
            conn.close()

    def _history(self):
        response = self.client.get(f"/api/transactions/history?profile_id={ACCOUNT}")
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    # ── Tax-Loss Harvest ────────────────────────────────────────────────────

    def test_lots_closed_by_a_fifo_sale_are_not_harvest_candidates(self):
        result = self._candidates()
        buy_dates = sorted(c["buy_date"] for c in result["candidates"])
        # Only this year's purchases above $5.69 are still held at a loss; the
        # $5.64 lot is in profit and everything from 2024-25 was sold.
        self.assertEqual(buy_dates, ["2026-10-05", "2026-10-16", "2026-10-30", "2026-11-06"])
        self.assertNotIn(2387.0, [c["open_shares"] for c in result["candidates"]])
        open_shares = sum(c["open_shares"] for c in result["candidates"])
        self.assertAlmostEqual(open_shares, CRF_HELD_NOW - 1660, places=3)

    def test_a_specific_lot_sale_closes_the_lot_it_names(self):
        conn = self._get_connection()
        first = self._insert_txn(conn, "ABC", "BUY", "2024-01-10", 100, 50.0)
        second = self._insert_txn(conn, "ABC", "BUY", "2024-02-10", 100, 60.0)
        sale = self._insert_txn(conn, "ABC", "SELL", "2024-06-01", 100, 40.0)
        conn.execute(
            "INSERT INTO transaction_lot_allocations (sell_txn_id, buy_txn_id, shares) VALUES (?, ?, 100)",
            (sale, second),
        )
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, current_price, current_value) "
            "VALUES ('ABC', ?, 100, 30, 3000)",
            (ACCOUNT,),
        )
        conn.commit()
        conn.close()

        abc = [c for c in self._candidates()["candidates"] if c["ticker"] == "ABC"]
        self.assertEqual([c["txn_id"] for c in abc], [first])
        self.assertAlmostEqual(abc[0]["open_shares"], 100)
        self.assertAlmostEqual(abc[0]["unrealized_loss"], -2000.0)

    def test_a_lone_recent_purchase_does_not_block_itself(self):
        conn = self._get_connection()
        self._insert_txn(conn, "SOLO", "BUY", "2026-11-05", 10, 100.0)
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, current_price, current_value) "
            "VALUES ('SOLO', ?, 10, 80, 800)",
            (ACCOUNT,),
        )
        conn.commit()
        conn.close()

        result = self._candidates()
        solo = next(c for c in result["candidates"] if c["ticker"] == "SOLO")
        self.assertEqual(solo["wash_status"], "clear")
        self.assertEqual(solo["wash_offenders"], [])
        # CRF's lots were each bought alongside others inside the window, so
        # each is still blocked -- by the others, never by itself.
        for lot in (c for c in result["candidates"] if c["ticker"] == "CRF"):
            self.assertEqual(lot["wash_status"], "blocked")
            self.assertNotIn(lot["txn_id"], [o["txn_id"] for o in lot["wash_offenders"]])

    # ── Transaction History ─────────────────────────────────────────────────

    def test_history_marks_the_sold_out_round_trip_closed(self):
        events = self._history()["events"]
        by_status = {True: set(), False: set()}
        for event in events:
            by_status[bool(event["closed_position"])].add(event["transaction_date"][:4])
        self.assertEqual(by_status[True], {"2024", "2025"})
        self.assertEqual(by_status[False], {"2026"})

        closed_dividend = next(
            e for e in events if e["record_type"] == "dividend" and e["transaction_date"] == "2025-11-03"
        )
        self.assertTrue(closed_dividend["closed_position"], "paid after the sale, for the closed round trip")
        self.assertEqual(
            self._history()["summary"]["closed_position_events"],
            len(CRF_FIRST_ROUND_TRIP) + 2,
        )

    def test_history_keeps_a_partly_sold_position_open(self):
        conn = self._get_connection()
        self._insert_txn(conn, "PART", "BUY", "2025-01-10", 100, 10.0)
        self._insert_txn(conn, "PART", "SELL", "2025-06-10", 40, 12.0)
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, current_price, current_value) "
            "VALUES ('PART', ?, 60, 11, 660)",
            (ACCOUNT,),
        )
        # More sold than the ledger bought: the opening lot is missing, which
        # says nothing about the position having been closed.
        self._insert_txn(conn, "GAP", "SELL", "2025-03-01", 50, 20.0)
        self._insert_txn(conn, "GAP", "BUY", "2025-04-01", 80, 21.0)
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, current_price, current_value) "
            "VALUES ('GAP', ?, 130, 22, 2860)",
            (ACCOUNT,),
        )
        conn.commit()
        conn.close()

        events = [e for e in self._history()["events"] if e["ticker"] in {"PART", "GAP"}]
        self.assertEqual(len(events), 4)
        self.assertFalse(any(e["closed_position"] for e in events))

    def test_history_still_closes_a_ticker_no_longer_held(self):
        conn = self._get_connection()
        self._insert_txn(conn, "GONE", "BUY", "2025-01-10", 10, 10.0)
        conn.commit()
        conn.close()
        gone = [e for e in self._history()["events"] if e["ticker"] == "GONE"]
        self.assertTrue(gone[0]["closed_position"])

    # ── Bulk delete ─────────────────────────────────────────────────────────

    def test_bulk_delete_removes_the_selected_rows_and_replays_once(self):
        events = self._history()["events"]
        closed = [e for e in events if e["closed_position"]]
        body = {
            "transactions": [
                {"id": e["transaction_id"], "profile_id": e["profile_id"]}
                for e in closed if e["record_type"] == "equity"
            ],
            "dividends": [
                {"id": e["dividend_payment_id"], "profile_id": e["profile_id"]}
                for e in closed if e["record_type"] == "dividend"
            ],
        }
        response = self.client.post(f"/api/transactions/bulk-delete?profile_id={ACCOUNT}", json=body)
        self.assertEqual(response.status_code, 200, response.get_json())
        payload = response.get_json()
        self.assertEqual(payload["deleted_transactions"], len(CRF_FIRST_ROUND_TRIP))
        self.assertEqual(payload["deleted_dividends"], 2)
        self.assertEqual(payload["tickers"], ["CRF"])

        remaining = self._history()["events"]
        self.assertEqual({e["transaction_date"][:4] for e in remaining}, {"2026"})
        conn = self._get_connection()
        try:
            holding = conn.execute(
                "SELECT quantity FROM all_account_info WHERE ticker = 'CRF' AND profile_id = ?", (ACCOUNT,)
            ).fetchone()
        finally:
            conn.close()
        self.assertAlmostEqual(holding["quantity"], CRF_HELD_NOW, places=3)

    def test_bulk_delete_refuses_rows_outside_the_view(self):
        conn = self._get_connection()
        conn.execute("INSERT INTO profiles (id, name, broker_source, positions_managed) VALUES (9, 'Other', '', 0)")
        other = self._insert_txn(conn, "ZZZ", "BUY", "2025-01-10", 5, 10.0, pid=9)
        conn.commit()
        conn.close()

        response = self.client.post(
            f"/api/transactions/bulk-delete?profile_id={ACCOUNT}",
            json={"transactions": [{"id": other, "profile_id": 9}]},
        )
        self.assertEqual(response.status_code, 400)
        conn = self._get_connection()
        try:
            self.assertIsNotNone(conn.execute("SELECT 1 FROM transactions WHERE id = ?", (other,)).fetchone())
        finally:
            conn.close()

    def test_bulk_delete_ignores_a_row_filed_under_the_wrong_account(self):
        conn = self._get_connection()
        txn_id = conn.execute("SELECT id FROM transactions WHERE ticker = 'CRF' LIMIT 1").fetchone()[0]
        conn.close()
        # Profile 1 is readable from this view only if it shares the ledger;
        # either way the id does not belong to it, so nothing may be removed.
        response = self.client.post(
            "/api/transactions/bulk-delete?profile_id=1",
            json={"transactions": [{"id": txn_id, "profile_id": 1}]},
        )
        self.assertIn(response.status_code, (200, 400))
        conn = self._get_connection()
        try:
            self.assertIsNotNone(conn.execute("SELECT 1 FROM transactions WHERE id = ?", (txn_id,)).fetchone())
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
