import csv
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

from flask import Flask, request

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import ensure_tables_exist
from option_trade_import import parse_occ_symbol, parse_option_transactions
import option_trade_tracker as tracker


def memory_database():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    ensure_tables_exist(conn)
    conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Test Portfolio')")
    conn.commit()
    return conn


class OptionTradeImportParserTest(unittest.TestCase):
    def test_occ_symbol_decodes_contract(self):
        parsed = parse_occ_symbol("SPY   260821C00600000")
        self.assertEqual(parsed["underlying"], "SPY")
        self.assertEqual(parsed["expiration"], "2026-08-21")
        self.assertEqual(parsed["option_type"], "CALL")
        self.assertEqual(parsed["strike"], 600)

    def test_generic_file_groups_legs_and_detects_iron_condor(self):
        rows = [
            ["Date", "Action", "Underlying", "Option Type", "Expiration", "Strike", "Contracts", "Price", "Fees", "Trade ID"],
            ["2026-08-03", "BTO", "SPY", "PUT", "2026-09-18", 540, 1, 0.30, 0.65, "condor-1"],
            ["2026-08-03", "STO", "SPY", "PUT", "2026-09-18", 545, 1, 0.90, 0.65, "condor-1"],
            ["2026-08-03", "STO", "SPY", "CALL", "2026-09-18", 660, 1, 0.85, 0.65, "condor-1"],
            ["2026-08-03", "BTO", "SPY", "CALL", "2026-09-18", 665, 1, 0.25, 0.65, "condor-1"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "options.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            result = parse_option_transactions(str(path), path.name, "generic")

        self.assertEqual(result["summary"]["recognized"], 4)
        self.assertEqual(result["summary"]["groups"], 1)
        self.assertEqual({row["strategy_type"] for row in result["executions"]}, {"Iron Condor"})
        self.assertEqual({row["purpose"] for row in result["executions"]}, {"Income"})


class OptionTradeLedgerTest(unittest.TestCase):
    def setUp(self):
        self.conn = memory_database()

    def tearDown(self):
        self.conn.close()

    def test_manual_trade_preserves_legs_and_calculates_realized_pnl(self):
        trade_id = tracker.create_trade(self.conn, 1, {
            "underlying": "SPY",
            "strategy_type": "Iron Condor",
            "purpose": "Income",
            "opened_at": "2026-08-01",
            "legs": [
                {"position_side": "LONG", "option_type": "PUT", "expiration": "2026-09-18", "strike": 540, "contracts": 1, "price": 0.30, "fees": 1},
                {"position_side": "SHORT", "option_type": "PUT", "expiration": "2026-09-18", "strike": 545, "contracts": 1, "price": 1.00, "fees": 1},
                {"position_side": "SHORT", "option_type": "CALL", "expiration": "2026-09-18", "strike": 660, "contracts": 1, "price": 1.10, "fees": 1},
                {"position_side": "LONG", "option_type": "CALL", "expiration": "2026-09-18", "strike": 665, "contracts": 1, "price": 0.25, "fees": 1},
            ],
        })
        trade = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(trade["entry_net_amount"], 151)
        self.assertEqual(trade["max_risk"], 349)
        self.assertEqual(len(trade["legs"]), 4)

        close_rows = []
        for leg, price in zip(trade["legs"], [0.10, 0.20, 0.15, 0.05]):
            close_rows.append({"leg_id": leg["id"], "contracts": 1, "price": price, "fees": 1})
        tracker.close_trade(self.conn, 1, trade_id, {"closed_at": "2026-08-03", "executions": close_rows})

        closed = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(closed["status"], "CLOSED")
        self.assertEqual(closed["realized_pnl"], 127)
        self.assertEqual(closed["outcome"], "WIN")
        self.assertEqual(tracker.realized_option_income(self.conn, [1], "2026-08-01", "2026-08-31"), 127)

    def test_transaction_import_matches_close_and_deduplicates_repeat_file(self):
        rows = [
            ["Date", "Action", "Option Symbol", "Contracts", "Price", "Fees", "Order ID"],
            ["2026-01-02", "Buy to Open", "QQQ260220C00500000", 1, 2.00, 1.00, "open-1"],
            ["2026-01-20", "Sell to Close", "QQQ260220C00500000", 1, 3.00, 1.00, "close-1"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broker.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")

        first = tracker.import_option_executions(self.conn, 1, parsed)
        second = tracker.import_option_executions(self.conn, 1, parsed)
        trade = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(first["inserted"], 2)
        self.assertEqual(first["unmatched"], 0)
        self.assertEqual(second["duplicates"], 2)
        self.assertEqual(trade["status"], "CLOSED")
        self.assertEqual(trade["realized_pnl"], 98)

    def test_covered_call_links_only_the_required_stock_from_same_account(self):
        self.conn.execute(
            """INSERT INTO all_account_info
                  (ticker, profile_id, quantity, price_paid, broker_price_paid, current_price)
               VALUES ('QQQ', 1, 250, 470, 475.25, 500)"""
        )
        tracker.create_trade(self.conn, 1, {
            "underlying": "QQQ",
            "strategy_type": "Covered Call",
            "purpose": "Income",
            "opened_at": "2026-08-03",
            "legs": [{
                "position_side": "SHORT", "option_type": "CALL", "expiration": "2026-09-18",
                "strike": 520, "contracts": 1, "price": 1.50, "fees": 0.65,
            }],
        })

        stock = tracker.load_trades(self.conn, [1])[0]["stock_position"]
        self.assertEqual(stock["portfolio_shares"], 250)
        self.assertEqual(stock["required_shares"], 100)
        self.assertEqual(stock["shares"], 100)
        self.assertEqual(stock["cost_basis"], 475.25)
        self.assertTrue(stock["covered"])

    def test_expired_position_closes_at_zero_and_future_expiration_is_rejected(self):
        expired_id = tracker.create_trade(self.conn, 1, {
            "underlying": "IWM", "strategy_type": "Short Put", "purpose": "Income",
            "opened_at": "2026-07-01",
            "legs": [{
                "position_side": "SHORT", "option_type": "PUT", "expiration": "2026-08-02",
                "strike": 200, "contracts": 1, "price": 1.25, "fees": 0,
            }],
        })
        expired = tracker.load_trades(self.conn, [1])[0]
        tracker.close_trade(self.conn, 1, expired_id, {
            "closed_at": "2026-08-03",
            "executions": [{
                "leg_id": expired["legs"][0]["id"], "action": "EXPIRE",
                "contracts": 1, "price": 0, "fees": 0,
            }],
        })
        closed = next(trade for trade in tracker.load_trades(self.conn, [1]) if trade["id"] == expired_id)
        self.assertEqual(closed["status"], "CLOSED")
        self.assertEqual(closed["realized_pnl"], 125)

        future_id = tracker.create_trade(self.conn, 1, {
            "underlying": "SPY", "strategy_type": "Long Call", "purpose": "Directional",
            "opened_at": "2026-08-01",
            "legs": [{
                "position_side": "LONG", "option_type": "CALL", "expiration": "2026-09-18",
                "strike": 700, "contracts": 1, "price": 2, "fees": 0,
            }],
        })
        future = next(trade for trade in tracker.load_trades(self.conn, [1]) if trade["id"] == future_id)
        with self.assertRaisesRegex(ValueError, "does not expire until"):
            tracker.close_trade(self.conn, 1, future_id, {
                "closed_at": "2026-08-03",
                "executions": [{
                    "leg_id": future["legs"][0]["id"], "action": "EXPIRE",
                    "contracts": 1, "price": 0, "fees": 0,
                }],
            })

        calendar_id = tracker.create_trade(self.conn, 1, {
            "underlying": "QQQ", "strategy_type": "Calendar", "purpose": "Directional",
            "opened_at": "2026-07-01",
            "legs": [
                {"position_side": "SHORT", "option_type": "CALL", "expiration": "2026-08-02", "strike": 500, "contracts": 1, "price": 1, "fees": 0},
                {"position_side": "LONG", "option_type": "CALL", "expiration": "2026-09-18", "strike": 500, "contracts": 1, "price": 2, "fees": 0},
            ],
        })
        calendar = next(trade for trade in tracker.load_trades(self.conn, [1]) if trade["id"] == calendar_id)
        tracker.close_trade(self.conn, 1, calendar_id, {
            "closed_at": "2026-08-03",
            "executions": [{
                "leg_id": calendar["legs"][0]["id"], "action": "EXPIRE",
                "contracts": 1, "price": 0, "fees": 0,
            }],
        })
        adjusted = next(trade for trade in tracker.load_trades(self.conn, [1]) if trade["id"] == calendar_id)
        self.assertEqual(adjusted["status"], "OPEN")
        self.assertEqual(adjusted["realized_pnl"], 100)
        self.assertEqual(adjusted["open_contracts"], 1)
        partial_metrics = tracker.trade_metrics([adjusted], today=tracker.date(2026, 8, 3))
        self.assertEqual(partial_metrics["realized_mtd"], 100)
        self.assertEqual(partial_metrics["realized_ytd"], 100)
        self.assertEqual(partial_metrics["realized_mtd_events"], [{
            "date": "2026-08-03",
            "amount": 100.0,
            "source": "leg",
            "leg_id": adjusted["legs"][0]["id"],
            "trade_id": calendar_id,
            "profile_id": 1,
            "profile_name": adjusted["profile_name"],
            "underlying": "QQQ",
            "strategy_type": "Calendar",
            "purpose": "Directional",
            "trade_status": "OPEN",
        }])


class OptionTradeApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "trades.db"
        conn = self.connection()
        ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'API Portfolio')")
        conn.execute("INSERT OR IGNORE INTO profiles (id, name, include_in_owner) VALUES (2, 'Owner Source', 1)")
        conn.execute("INSERT OR IGNORE INTO profiles (id, name, include_in_owner) VALUES (3, 'Separate Account', 0)")
        conn.commit()
        conn.close()

        self.original_connection = tracker.get_connection
        tracker.get_connection = self.connection
        self.app = Flask(__name__)
        tracker.register_routes(
            self.app,
            get_profile_filter=lambda: (False, [int(request.args.get("profile_id", 1))]),
            get_profile_id=lambda: int(request.args.get("profile_id", 1)),
        )
        self.client = self.app.test_client()

    def tearDown(self):
        tracker.get_connection = self.original_connection
        self.temp_dir.cleanup()

    def connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def test_create_and_list_trade(self):
        response = self.client.post("/api/option-trades?profile_id=1", json={
            "underlying": "IWM",
            "strategy_type": "Short Put",
            "purpose": "Income",
            "opened_at": "2026-08-03",
            "max_risk": 2500,
            "legs": [{
                "position_side": "SHORT", "option_type": "PUT", "expiration": "2026-09-18",
                "strike": 210, "contracts": 1, "price": 1.25, "fees": 0.65,
            }],
        })
        listing = self.client.get("/api/option-trades?profile_id=1")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(listing.status_code, 200)
        payload = listing.get_json()
        self.assertEqual(payload["metrics"]["open_trades"], 1)
        self.assertEqual(payload["trades"][0]["underlying"], "IWM")

        trade_id = response.get_json()["id"]
        classified = self.client.put(f"/api/option-trades/{trade_id}?profile_id=1", json={
            "strategy_type": "Cash-Secured Put",
            "purpose": "Income",
            "max_risk": 2500,
            "notes": "Reviewed classification",
        })
        self.assertEqual(classified.status_code, 200)
        classified_trade = classified.get_json()
        self.assertEqual(classified_trade["strategy_type"], "Cash-Secured Put")
        self.assertEqual(classified_trade["purpose"], "Income")
        self.assertEqual(classified_trade["max_risk"], 2500)
        self.assertEqual(classified_trade["notes"], "Reviewed classification")

    def test_owner_list_includes_only_accounts_marked_for_owner(self):
        trade_payload = {
            "underlying": "SPY",
            "strategy_type": "Short Put",
            "purpose": "Income",
            "opened_at": "2026-08-03",
            "legs": [{
                "position_side": "SHORT", "option_type": "PUT", "expiration": "2026-09-18",
                "strike": 600, "contracts": 1, "price": 1.25, "fees": 0,
            }],
        }
        included = self.client.post("/api/option-trades?profile_id=2", json=trade_payload)
        excluded = self.client.post("/api/option-trades?profile_id=3", json={**trade_payload, "underlying": "QQQ"})
        self.assertEqual(included.status_code, 201)
        self.assertEqual(excluded.status_code, 201)

        listing = self.client.get("/api/option-trades?profile_id=1")
        self.assertEqual(listing.status_code, 200)
        payload = listing.get_json()
        self.assertEqual(payload["scope"]["type"], "owner")
        self.assertEqual(payload["scope"]["profile_ids"], [1, 2])
        self.assertEqual(payload["metrics"]["open_trades"], 1)
        self.assertEqual(len(payload["trades"]), 1)
        self.assertEqual(payload["trades"][0]["profile_id"], 2)
        self.assertEqual(payload["trades"][0]["profile_name"], "Owner Source")


if __name__ == "__main__":
    unittest.main()
