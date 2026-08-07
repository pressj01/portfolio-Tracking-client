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
        self.assertEqual(trade["opening_dte"], 48)
        self.assertAlmostEqual(
            trade["annualized_return_pct"],
            151 / 349 * 365 / 48 * 100,
            places=2,
        )
        self.assertEqual(len(trade["legs"]), 4)

        close_rows = []
        for leg, price in zip(trade["legs"], [0.10, 0.20, 0.15, 0.05]):
            close_rows.append({"leg_id": leg["id"], "contracts": 1, "price": price, "fees": 1})
        tracker.close_trade(self.conn, 1, trade_id, {"closed_at": "2026-08-03", "executions": close_rows})

        closed = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(closed["status"], "CLOSED")
        self.assertEqual(closed["realized_pnl"], 127)
        self.assertEqual(closed["annualized_return_pct"], trade["annualized_return_pct"])
        self.assertEqual(closed["days_held"], 2)
        self.assertAlmostEqual(
            closed["realized_annualized_return_pct"],
            127 / 349 * 365 / 2 * 100,
            places=2,
        )
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

    def test_transaction_import_deduplicates_across_broker_source_formats(self):
        rows = [
            ["Date", "Action", "Option Symbol", "Contracts", "Price", "Fees"],
            ["2026-01-02", "Buy to Open", "QQQ260220C00500000", 1, 2.00, 1.00],
            ["2026-01-20", "Sell to Close", "QQQ260220C00500000", 1, 3.00, 1.00],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broker.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            schwab = parse_option_transactions(str(path), path.name, "schwab")
            etrade = parse_option_transactions(str(path), path.name, "etrade")

        first = tracker.import_option_executions(self.conn, 1, schwab)
        preview = tracker.annotate_import_preview(self.conn, 1, etrade)
        second = tracker.import_option_executions(self.conn, 1, etrade)

        self.assertEqual(first["inserted"], 2)
        self.assertEqual(preview["summary"]["duplicates"], 2)
        self.assertEqual(preview["summary"]["unmatched_closes"], 0)
        self.assertEqual(second["inserted"], 0)
        self.assertEqual(second["duplicates"], 2)
        self.assertEqual(len(tracker.load_trades(self.conn, [1])), 1)

    def test_generic_import_is_rejected_after_broker_import(self):
        rows = [
            ["Date", "Action", "Option Symbol", "Contracts", "Price", "Fees"],
            ["2026-01-02", "Buy to Open", "QQQ260220C00500000", 1, 2.00, 1.00],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broker.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            schwab = parse_option_transactions(str(path), path.name, "schwab")
            generic = parse_option_transactions(str(path), path.name, "generic")

        tracker.import_option_executions(self.conn, 1, schwab)

        with self.assertRaisesRegex(ValueError, "Select the original broker format"):
            tracker.annotate_import_preview(self.conn, 1, generic)
        with self.assertRaisesRegex(ValueError, "Select the original broker format"):
            tracker.import_option_executions(self.conn, 1, generic)
        self.conn.rollback()

    def test_transaction_import_preserves_identical_fills_from_one_file(self):
        rows = [
            ["Date", "Action", "Option Symbol", "Contracts", "Price", "Fees"],
            ["2026-01-02", "Buy to Open", "QQQ260220C00500000", 1, 2.00, 1.00],
            ["2026-01-02", "Buy to Open", "QQQ260220C00500000", 1, 2.00, 1.00],
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
        self.assertEqual(second["duplicates"], 2)
        self.assertEqual(trade["open_contracts"], 2)
        self.assertEqual(len(trade["legs"][0]["executions"]), 2)

    def test_transaction_import_dedupe_is_scoped_to_portfolio(self):
        self.conn.execute("INSERT INTO profiles (id, name) VALUES (2, 'Other Portfolio')")
        self.conn.commit()
        rows = [
            ["Date", "Action", "Option Symbol", "Contracts", "Price", "Fees"],
            ["2026-01-02", "Buy to Open", "QQQ260220C00500000", 1, 2.00, 1.00],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broker.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")

        first = tracker.import_option_executions(self.conn, 1, parsed)
        second = tracker.import_option_executions(self.conn, 2, parsed)

        self.assertEqual(first["inserted"], 1)
        self.assertEqual(second["inserted"], 1)
        self.assertEqual(len(tracker.load_trades(self.conn, [1])), 1)
        self.assertEqual(len(tracker.load_trades(self.conn, [2])), 1)

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
        self.assertEqual(expired["max_risk"], 19875)
        self.assertEqual(expired["max_risk_source"], "derived short put")
        self.assertEqual(expired["opening_dte"], 32)
        self.assertAlmostEqual(
            expired["annualized_return_pct"],
            125 / 19875 * 365 / 32 * 100,
            places=2,
        )
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
        self.assertEqual(closed["days_held"], 33)
        self.assertAlmostEqual(
            closed["realized_annualized_return_pct"],
            125 / 19875 * 365 / 33 * 100,
            places=2,
        )

        future_id = tracker.create_trade(self.conn, 1, {
            "underlying": "SPY", "strategy_type": "Long Call", "purpose": "Directional",
            "opened_at": "2026-08-01",
            "legs": [{
                "position_side": "LONG", "option_type": "CALL", "expiration": "2026-09-18",
                "strike": 700, "contracts": 1, "price": 2, "fees": 0,
            }],
        })
        future = next(trade for trade in tracker.load_trades(self.conn, [1]) if trade["id"] == future_id)
        self.assertIsNone(future["annualized_return_pct"])
        self.assertIsNone(future["realized_annualized_return_pct"])
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


class ExpiredTradeReconcileTest(unittest.TestCase):
    """A broker export has no row for an option that simply expired."""

    def setUp(self):
        self.conn = memory_database()

    def tearDown(self):
        self.conn.close()

    def _spread(self, opened_at, expiration):
        return tracker.create_trade(self.conn, 1, {
            "underlying": "SPX", "strategy_type": "Bear Call Spread", "purpose": "Income",
            "opened_at": opened_at,
            "legs": [
                {"position_side": "SHORT", "option_type": "CALL", "expiration": expiration,
                 "strike": 6300, "contracts": 1, "price": 13.37, "fees": 0},
                {"position_side": "LONG", "option_type": "CALL", "expiration": expiration,
                 "strike": 6400, "contracts": 1, "price": 9.47, "fees": 0},
            ],
        })

    def test_late_expire_is_dated_at_expiration_not_at_entry_time(self):
        """The bug: recording an old expiration today booked it into today's month."""
        trade_id = self._spread("2024-04-01", "2024-07-19")
        trade = next(item for item in tracker.load_trades(self.conn, [1]) if item["id"] == trade_id)
        tracker.close_trade(self.conn, 1, trade_id, {
            "closed_at": "2026-08-07",
            "executions": [
                {"leg_id": leg["id"], "action": "EXPIRE", "contracts": 1, "price": 0, "fees": 0,
                 "executed_at": "2024-07-19"}
                for leg in trade["legs"]
            ],
        })
        closed = next(item for item in tracker.load_trades(self.conn, [1]) if item["id"] == trade_id)
        self.assertEqual(closed["status"], "CLOSED")
        self.assertEqual(closed["closed_at"], "2024-07-19")
        self.assertEqual(closed["days_held"], 109)
        metrics = tracker.trade_metrics([closed], today=tracker.date(2026, 8, 7))
        self.assertEqual(metrics["realized_mtd"], 0)

    def test_omitting_execution_date_still_uses_the_trade_close_date(self):
        trade_id = self._spread("2026-06-01", "2026-07-17")
        trade = next(item for item in tracker.load_trades(self.conn, [1]) if item["id"] == trade_id)
        tracker.close_trade(self.conn, 1, trade_id, {
            "closed_at": "2026-07-20",
            "executions": [
                {"leg_id": leg["id"], "action": "EXPIRE", "contracts": 1, "price": 0, "fees": 0}
                for leg in trade["legs"]
            ],
        })
        closed = next(item for item in tracker.load_trades(self.conn, [1]) if item["id"] == trade_id)
        self.assertEqual(closed["closed_at"], "2026-07-20")

    def test_execution_date_before_expiration_is_still_rejected(self):
        trade_id = self._spread("2026-06-01", "2026-09-18")
        trade = next(item for item in tracker.load_trades(self.conn, [1]) if item["id"] == trade_id)
        with self.assertRaisesRegex(ValueError, "does not expire until"):
            tracker.close_trade(self.conn, 1, trade_id, {
                "closed_at": "2026-12-01",
                "executions": [{
                    "leg_id": trade["legs"][0]["id"], "action": "EXPIRE",
                    "contracts": 1, "price": 0, "fees": 0, "executed_at": "2026-08-07",
                }],
            })

    def test_settle_expired_closes_stale_trades_at_their_own_expirations(self):
        stale = self._spread("2024-04-01", "2024-07-19")
        calendar = tracker.create_trade(self.conn, 1, {
            "underlying": "QQQ", "strategy_type": "Calendar", "purpose": "Directional",
            "opened_at": "2024-05-01",
            "legs": [
                {"position_side": "SHORT", "option_type": "CALL", "expiration": "2024-08-16",
                 "strike": 500, "contracts": 1, "price": 1, "fees": 0},
                {"position_side": "LONG", "option_type": "CALL", "expiration": "2024-09-20",
                 "strike": 500, "contracts": 1, "price": 2, "fees": 0},
            ],
        })
        live = self._spread("2026-08-01", "2026-12-18")

        today = tracker.date(2026, 8, 7)
        pending = tracker.expired_open_legs(self.conn, [1], today=today)
        self.assertEqual({row["trade_id"] for row in pending}, {stale, calendar})
        self.assertEqual(len(pending), 4)
        self.assertEqual(
            next(row["days_past_expiration"] for row in pending if row["expiration"] == "2024-07-19"),
            749,
        )

        result = tracker.settle_expired_legs(self.conn, [1], today=today)
        self.assertEqual(result["trades_settled"], 2)
        self.assertEqual(result["legs_settled"], 4)

        trades = {item["id"]: item for item in tracker.load_trades(self.conn, [1])}
        self.assertEqual(trades[stale]["status"], "CLOSED")
        self.assertEqual(trades[stale]["closed_at"], "2024-07-19")
        # Each leg of the calendar is stamped with its own expiration, so the
        # trade closes on the later one rather than on a single blanket date.
        self.assertEqual(trades[calendar]["status"], "CLOSED")
        self.assertEqual(trades[calendar]["closed_at"], "2024-09-20")
        self.assertEqual(trades[live]["status"], "OPEN")
        self.assertEqual(tracker.expired_open_legs(self.conn, [1], today=today), [])

    def test_settle_expired_can_target_one_trade(self):
        first = self._spread("2024-04-01", "2024-07-19")
        second = self._spread("2024-05-01", "2024-08-16")
        today = tracker.date(2026, 8, 7)
        result = tracker.settle_expired_legs(self.conn, [1], trade_ids=[first], today=today)
        self.assertEqual(result["trade_ids"], [first])
        trades = {item["id"]: item for item in tracker.load_trades(self.conn, [1])}
        self.assertEqual(trades[first]["status"], "CLOSED")
        self.assertEqual(trades[second]["status"], "OPEN")

    def test_settle_expired_leaves_partially_closed_contracts_alone(self):
        trade_id = self._spread("2024-04-01", "2024-07-19")
        trade = next(item for item in tracker.load_trades(self.conn, [1]) if item["id"] == trade_id)
        short_leg = next(leg for leg in trade["legs"] if leg["position_side"] == "SHORT")
        tracker.close_trade(self.conn, 1, trade_id, {
            "closed_at": "2024-06-10",
            "executions": [{"leg_id": short_leg["id"], "action": "BTC", "contracts": 1, "price": 2, "fees": 0}],
        })
        today = tracker.date(2026, 8, 7)
        pending = tracker.expired_open_legs(self.conn, [1], today=today)
        self.assertEqual([row["position_side"] for row in pending], ["LONG"])
        tracker.settle_expired_legs(self.conn, [1], today=today)
        closed = next(item for item in tracker.load_trades(self.conn, [1]) if item["id"] == trade_id)
        self.assertEqual(closed["status"], "CLOSED")
        bought_back = [
            execution for leg in closed["legs"] for execution in leg["executions"]
            if execution["action"] == "BTC"
        ]
        self.assertEqual(len(bought_back), 1)
        self.assertEqual(bought_back[0]["executed_at"], "2024-06-10")


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
