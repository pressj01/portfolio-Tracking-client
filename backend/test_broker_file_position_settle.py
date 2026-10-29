"""A sale imported after the positions file hands the share count back to the file.

The Import checklist runs a broker's positions file first and its transactions
file second. On a day with a large sale, the positions import's drop guard
sees no SELL yet and keeps the old count; the transactions import that then
records the sale must let the file's count through. Before this, a file
showing 90 shares after 50 of 140 were sold left the holding at 140, and the
account read above the broker by the shares it no longer held.
"""

import datetime
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import config
import database


TODAY = datetime.date.today()


def _us(day):
    return day.strftime("%m/%d/%Y")


def etrade_positions(giax_qty, giax_cost):
    giax_value = round(giax_qty * 14.86, 4)
    total = round(giax_value + 1015.60 + 250.00, 2)
    return "\n".join([
        "Account Summary",
        "Account,Net Account Value,Total Gain $,Total Gain %,Day's Gain Unrealized $,"
        "Day's Gain Unrealized %,Day's Gain Realized $,2026 Contributions,Cash Purchasing Power",
        f'"IRA -1234",{total},-150.00,-5.00,-30.00,-1.00,-80.00,.00,250.00',
        "",
        "",
        "View Summary - Dividends",
        "Filters applied: ",
        "Symbol,Security type(s),Sort by,Sort order,",
        ",All,Symbol,Asc,",
        "",
        "Symbol,Price Paid $,Last Price $,Change %,Day's Gain $,Qty #,Total Gain $,Total Gain %,"
        "Value $,Ex-Div Date,Dividend Pay Date,Dividend Yield %,Dividend,Annual Dividend,Total Cost,Change $",
        f"GIAX,{round(giax_cost / giax_qty, 4)},14.86,-2.37,-30.00,{giax_qty},"
        f"{round(giax_value - giax_cost, 4)},-12.00,{giax_value},10/23/2026,10/26/2026,25.0000,"
        f".0700,0.84,{giax_cost},-0.36",
        "OVQ,25.00,25.39,-1.67,-.2000,40.0000,15.6000,1.5600,1015.6000,--,--,.0000,.0000,0.00,1000.0000,-0.43",
        "CASH,,,,,,,,250.00,,,,,,,,",
        f"TOTAL,,,,-30.00,,,,{total},,,,,,,,",
        "",
    ])


def etrade_transactions(rows):
    lines = [
        "All Transactions Activity Types",
        "",
        "Account Activity for IRA -1234 from Current Year",
        "",
        "Total:,,,,,,,,,-250.00,,,",
        "",
        "Activity/Trade Date,Transaction Date,Settlement Date,Activity Type,Description,Symbol,"
        "Cusip,Quantity #,Price $,Amount $,Commission,Category,Note",
    ]
    lines.extend(rows)
    return "\n".join(lines) + "\n"


def sold_giax(day, shares=50):
    return (
        f"{_us(day)},{_us(day)},,Sold,NICHOLAS GLBL EQ INC ETF UNSOLICITED TRADE,GIAX,--,"
        f"-{shares},14.85,{round(shares * 14.85, 2)},0.0,--,--"
    )


def bought_ovq(day):
    return (
        f"{_us(day)},{_us(day)},,Bought,OVERLAY SHARES NASDAQ 100 INCM UNSOLICITED TRADE,OVQ,--,"
        "40.0,25.00,-1000.00,0.0,--,--"
    )


def giax_dividend(day):
    return f"{_us(day)},{_us(day)},{_us(day)},Dividend,NICHOLAS GLBL EQ INC ETF,GIAX,--,,,9.80,0.0,--,--"


class BrokerFilePositionSettleTest(unittest.TestCase):
    PROFILE = 3

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        conn.execute(
            "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order) "
            "VALUES (1, 'Owner', NULL, 0, 1)"
        )
        conn.execute(
            "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order, "
            "positions_managed) VALUES (?, 'E*TRADE IRA', 'etrade', 1, 2, 1)",
            (self.PROFILE,),
        )
        conn.execute(
            "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order, "
            "positions_managed) VALUES (6, 'Schwab Brokerage', 'schwab', 1, 3, 1)"
        )
        # Yesterday's positions file: 140 GIAX, every lot on record.
        previous_file = (TODAY - datetime.timedelta(days=1)).isoformat()
        conn.execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, quantity, base_quantity, price_paid, purchase_value, "
            "broker_price_paid, broker_purchase_value, original_price_paid, original_purchase_value, "
            "current_price, current_value, import_date, broker_snapshot_date, broker_snapshot_at) "
            "VALUES ('GIAX', ?, 140, 140, 17, 2380, 17, 2380, 17, 2380, "
            "15.20, 2128, ?, ?, datetime('now', '-1 day'))",
            (self.PROFILE, previous_file, previous_file),
        )
        for day, shares in [("2025-05-02", 100), ("2025-08-11", 40)]:
            conn.execute(
                "INSERT INTO transactions "
                "(ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, "
                "fees, notes, created_at) "
                "VALUES ('GIAX', ?, 'BUY', ?, ?, 17, 0, '', datetime('now', '-30 days'))",
                (self.PROFILE, day, shares),
            )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_backup = app_module._create_import_backup
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_db_path = config.DB_PATH
        config.DB_PATH = self.db_path
        app_module.get_connection = self._get_connection
        app_module._create_import_backup = lambda profile_id=None: None
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module._create_import_backup = self._orig_backup
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        config.DB_PATH = self._orig_db_path
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _holding(self, ticker="GIAX", profile_id=None):
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM all_account_info WHERE ticker = ? AND profile_id = ?",
                (ticker, profile_id or self.PROFILE),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def _post(self, content, fmt, filename, profile_id=None):
        response = self.client.post(
            f"/api/import/transactions?profile_id={profile_id or self.PROFILE}",
            data={
                "file": (io.BytesIO(content.encode("utf-8")), filename),
                "format": fmt,
                "nav_date": TODAY.isoformat(),
            },
            content_type="multipart/form-data",
        )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        return payload

    def _import_positions(self, giax_qty=90, giax_cost=1530.00):
        return self._post(etrade_positions(giax_qty, giax_cost), "etrade", "PortfolioDownload.csv")

    def _import_transactions(self, rows):
        return self._post(etrade_transactions(rows), "etrade_transactions", "DownloadTxnHistory.csv")

    def test_sale_imported_after_the_positions_file_takes_the_files_count(self):
        positions = self._import_positions()
        self.assertEqual([item["ticker"] for item in positions["preserved_quantity"]], ["GIAX"])
        self.assertEqual(self._holding()["quantity"], 140)
        self.assertIn("import this account's transactions next", positions["message"])

        result = self._import_transactions([bought_ovq(TODAY), sold_giax(TODAY), giax_dividend(TODAY)])

        self.assertEqual(
            result["broker_count_settled"],
            [{"ticker": "GIAX", "kept_quantity": 140, "broker_quantity": 90}],
        )
        self.assertIn("GIAX (140 to 90)", result["message"])
        holding = self._holding()
        self.assertEqual(holding["quantity"], 90)
        self.assertEqual(holding["base_quantity"], 90)
        self.assertAlmostEqual(holding["current_value"], round(90 * 14.86, 2), places=2)
        self.assertAlmostEqual(holding["broker_purchase_value"], 1530.00, places=2)
        self.assertIsNone(holding["broker_file_position"])
        # The account now matches the broker's file: GIAX + OVQ, nothing extra.
        conn = self._get_connection()
        try:
            positions_total = conn.execute(
                "SELECT SUM(current_value) FROM all_account_info WHERE profile_id = ?",
                (self.PROFILE,),
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertAlmostEqual(positions_total, round(90 * 14.86, 2) + 1015.60, places=1)

    def test_transactions_without_the_sale_keep_waiting(self):
        self._import_positions()

        result = self._import_transactions([bought_ovq(TODAY), giax_dividend(TODAY)])

        self.assertEqual(result["broker_count_settled"], [])
        holding = self._holding()
        self.assertEqual(holding["quantity"], 140)
        held = json.loads(holding["broker_file_position"])
        self.assertEqual(held["quantity"], 90)
        self.assertEqual(held["kept_quantity"], 140)

        # The next export does carry the sale.
        result = self._import_transactions([sold_giax(TODAY)])
        self.assertEqual(result["broker_count_settled"][0]["ticker"], "GIAX")
        self.assertEqual(self._holding()["quantity"], 90)

    def test_a_partial_sale_does_not_explain_the_drop(self):
        self._import_positions()

        result = self._import_transactions([sold_giax(TODAY, shares=10)])

        self.assertEqual(result["broker_count_settled"], [])
        self.assertEqual(self._holding()["quantity"], 140)
        self.assertIsNotNone(self._holding()["broker_file_position"])

    def test_a_count_moved_since_the_file_is_left_alone(self):
        self._import_positions()
        conn = self._get_connection()
        try:
            conn.execute(
                "UPDATE all_account_info SET quantity = 120 WHERE ticker = 'GIAX' AND profile_id = ?",
                (self.PROFILE,),
            )
            conn.commit()
        finally:
            conn.close()

        result = self._import_transactions([sold_giax(TODAY)])

        self.assertEqual(result["broker_count_settled"], [])
        holding = self._holding()
        self.assertEqual(holding["quantity"], 120)
        self.assertIsNone(holding["broker_file_position"])

    def test_reimporting_the_positions_file_keeps_the_window_open_for_the_sale(self):
        # The file date moves to today on the first guarded import; a sale from
        # yesterday must still explain the drop when the file comes in again.
        self._import_positions()
        again = self._import_positions()
        self.assertEqual([item["ticker"] for item in again["preserved_quantity"]], ["GIAX"])

        result = self._import_transactions([sold_giax(TODAY - datetime.timedelta(days=1))])

        self.assertEqual(result["broker_count_settled"][0]["ticker"], "GIAX")
        self.assertEqual(self._holding()["quantity"], 90)

    def test_use_broker_count_clears_the_held_row(self):
        self._import_positions()
        response = self.client.post(
            f"/api/import/transactions?profile_id={self.PROFILE}",
            data={
                "file": (io.BytesIO(etrade_positions(90, 1530.00).encode("utf-8")), "PortfolioDownload.csv"),
                "format": "etrade",
                "nav_date": TODAY.isoformat(),
                "accept_broker_quantity": json.dumps([{"profile_id": self.PROFILE, "ticker": "GIAX"}]),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        holding = self._holding()
        self.assertEqual(holding["quantity"], 90)
        self.assertIsNone(holding["broker_file_position"])

        # The sale arriving afterwards changes nothing further.
        result = self._import_transactions([sold_giax(TODAY)])
        self.assertEqual(result["broker_count_settled"], [])
        self.assertEqual(self._holding()["quantity"], 90)

    def test_schwab_positions_then_transactions_settle_the_same_way(self):
        conn = self._get_connection()
        try:
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, quantity, base_quantity, price_paid, purchase_value, "
                "broker_price_paid, broker_purchase_value, current_price, current_value, import_date) "
                "VALUES ('PBDC', 6, 200, 200, 30, 6000, 30, 6000, 31, 6200, ?)",
                ((TODAY - datetime.timedelta(days=1)).isoformat(),),
            )
            conn.execute(
                "INSERT INTO transactions "
                "(ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, fees, notes) "
                "VALUES ('PBDC', 6, 'BUY', '2026-01-05', 200, 30, 0, '')"
            )
            conn.commit()
        finally:
            conn.close()

        positions = self._post(
            '"Positions for account Brokerage ...123"\n\n'
            "Symbol,Description,Qty (Quantity),Price,Cost Basis,Mkt Val (Market Value)\n"
            "PBDC,PUTNAM BDC INCOME ETF,120,$31.00,\"$3,600.00\",\"$3,720.00\"\n",
            "schwab",
            "Brokerage-Positions.csv",
            profile_id=6,
        )
        self.assertEqual([item["ticker"] for item in positions["preserved_quantity"]], ["PBDC"])
        self.assertEqual(self._holding("PBDC", 6)["quantity"], 200)

        result = self._post(
            "Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount\n"
            f"{_us(TODAY)},Sell,PBDC,PUTNAM BDC INCOME ETF,80,$31.00,$0.00,\"$2,480.00\"\n",
            "schwab_transactions",
            "Brokerage_Transactions.csv",
            profile_id=6,
        )

        self.assertEqual(result["broker_count_settled"][0]["ticker"], "PBDC")
        self.assertEqual(self._holding("PBDC", 6)["quantity"], 120)


if __name__ == "__main__":
    unittest.main()
