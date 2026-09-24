import csv
import sqlite3
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from flask import Flask, request

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import ensure_tables_exist
from option_trade_import import _strategy_for_legs, parse_occ_symbol, parse_option_transactions
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
    def test_scanner_shapes_use_strikes_expirations_sides_and_ratios(self):
        def leg(kind, side, strike, quantity=1, expiration="2026-09-25"):
            return {"option_type": kind, "position_side": side, "strike": strike,
                    "contracts": quantity, "expiration": expiration}

        self.assertEqual(_strategy_for_legs([
            leg("PUT", "LONG", 120, 2), leg("PUT", "SHORT", 130, 2),
            leg("PUT", "SHORT", 180), leg("PUT", "LONG", 190),
        ]), "Unbalanced Put Condor")
        self.assertEqual(_strategy_for_legs([
            leg("CALL", "SHORT", 200, expiration="2026-09-25"),
            leg("CALL", "LONG", 200, expiration="2026-11-20"),
        ]), "Long Call Calendar")
        self.assertEqual(_strategy_for_legs([
            leg("PUT", "SHORT", 150, expiration="2026-09-25"),
            leg("PUT", "LONG", 140, expiration="2026-11-20"),
        ]), "Long Put Diagonal")
        self.assertEqual(_strategy_for_legs([
            leg("PUT", "LONG", 120, 8), leg("PUT", "SHORT", 160, 8),
            leg("PUT", "LONG", 180, 4),
        ]), "Double-Hedge Put Butterfly")
        self.assertEqual(_strategy_for_legs([
            leg("PUT", "LONG", 593), leg("PUT", "SHORT", 741, 10),
            leg("PUT", "LONG", 715, 5), leg("PUT", "LONG", 758, 5),
        ]), "Custom")
        self.assertEqual(_strategy_for_legs([
            leg("PUT", "LONG", 120), leg("PUT", "SHORT", 130),
            leg("CALL", "LONG", 185), leg("CALL", "SHORT", 195),
        ]), "Custom")
        self.assertEqual(_strategy_for_legs([
            leg("PUT", "LONG", 120, expiration="2027-03-19"),
            leg("PUT", "SHORT", 130, expiration="2027-03-19"),
            leg("CALL", "SHORT", 180, expiration="2027-03-19"),
            leg("CALL", "LONG", 190, expiration="2027-03-19"),
        ]), "Iron Condor")
        for expiration in ("2026-10-16", "2027-03-19"):
            self.assertEqual(_strategy_for_legs([
                leg("PUT", "LONG", 120, 2, expiration),
                leg("PUT", "SHORT", 130, 2, expiration),
                leg("CALL", "SHORT", 180, 1, expiration),
                leg("CALL", "LONG", 195, 1, expiration),
            ]), "Unbalanced Iron Condor")
        self.assertEqual(_strategy_for_legs([
            leg("PUT", "LONG", 120), leg("PUT", "SHORT", 130),
            leg("CALL", "SHORT", 180), leg("CALL", "LONG", 190, 2),
        ]), "Custom")

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

    def test_schwab_expiration_uses_as_of_date(self):
        rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["09/21/2026 as of 09/18/2026", "Expired", "AMD 09/18/2026 580.00 C", -1, "", ""],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")
        self.assertEqual(parsed["summary"]["recognized"], 1)
        self.assertEqual(parsed["executions"][0]["executed_at"], "2026-09-18")
        self.assertEqual(parsed["executions"][0]["action"], "EXPIRE")
        self.assertEqual(parsed["executions"][0]["price"], 0)


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

    def test_custom_spy_put_package_has_bounded_payoff_risk(self):
        tracker.create_trade(self.conn, 1, {
            "underlying": "SPY", "strategy_type": "Road Trip Butterfly",
            "purpose": "Directional", "opened_at": "2026-09-22",
            "legs": [
                {"position_side": "LONG", "option_type": "PUT", "expiration": "2026-11-30", "strike": 593, "contracts": 1, "price": 0.86, "fees": 0.66},
                {"position_side": "SHORT", "option_type": "PUT", "expiration": "2026-11-30", "strike": 741, "contracts": 10, "price": 7.17, "fees": 6.8},
                {"position_side": "LONG", "option_type": "PUT", "expiration": "2026-11-30", "strike": 715, "contracts": 5, "price": 4.33, "fees": 3.31},
                {"position_side": "LONG", "option_type": "PUT", "expiration": "2026-11-30", "strike": 758, "contracts": 5, "price": 10.48, "fees": 3.31},
            ],
        })
        trade = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(trade["entry_net_amount"], -335.08)
        self.assertEqual(trade["max_risk"], 4835.08)
        self.assertEqual(trade["max_risk_source"], "derived expiration payoff")
        self.assertEqual(trade["status"], "OPEN")

    def test_uncovered_short_call_has_no_finite_maximum_risk(self):
        tracker.create_trade(self.conn, 1, {
            "underlying": "SPY", "strategy_type": "Short Call",
            "purpose": "Income", "opened_at": "2026-09-22",
            "legs": [{"position_side": "SHORT", "option_type": "CALL",
                      "expiration": "2026-11-30", "strike": 800,
                      "contracts": 1, "price": 1, "fees": 0}],
        })
        trade = tracker.load_trades(self.conn, [1])[0]
        self.assertIsNone(trade["max_risk"])

    def test_repeated_condor_legs_count_all_contracts_in_risk(self):
        tracker.create_trade(self.conn, 1, {
            "underlying": "IWM", "strategy_type": "Unbalanced Iron Condor",
            "purpose": "Income", "opened_at": "2026-08-10",
            "legs": [
                {"position_side": "LONG", "option_type": "PUT", "expiration": "2026-09-18", "strike": 270, "contracts": 1, "price": 0.63, "fees": 0.66},
                {"position_side": "SHORT", "option_type": "PUT", "expiration": "2026-09-18", "strike": 280, "contracts": 1, "price": 1.30, "fees": 0.66},
                {"position_side": "LONG", "option_type": "CALL", "expiration": "2026-09-18", "strike": 321, "contracts": 1, "price": 0.67, "fees": 0.66},
                {"position_side": "SHORT", "option_type": "CALL", "expiration": "2026-09-18", "strike": 313, "contracts": 1, "price": 1.89, "fees": 0.66},
                {"position_side": "LONG", "option_type": "CALL", "expiration": "2026-09-18", "strike": 321, "contracts": 1, "price": 0.67, "fees": 0.66},
                {"position_side": "SHORT", "option_type": "CALL", "expiration": "2026-09-18", "strike": 313, "contracts": 1, "price": 1.89, "fees": 0.66},
            ],
        })
        trade = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(trade["entry_net_amount"], 307.04)
        self.assertEqual(trade["max_risk"], 1292.96)
        self.assertEqual(trade["max_risk_source"], "derived expiration payoff")
        self.assertEqual(trade["scanner_strategy_key"], "iron-condor")

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

    def test_owner_rejects_export_already_imported_in_included_portfolio(self):
        self.conn.execute("INSERT INTO profiles (id, name, include_in_owner) VALUES (6, 'Pressj04', 1)")
        self.conn.commit()
        rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["08/18/2026", "Sell to Open", "GLW 09/25/2026 200.00 C", 1, "$3.42", "$0.67"],
            ["08/18/2026", "Buy to Open", "GLW 09/25/2026 205.00 C", 1, "$2.92", "$0.66"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")
        tracker.import_option_executions(self.conn, 6, parsed)
        with self.assertRaisesRegex(ValueError, "Import this export into Pressj04"):
            tracker.annotate_import_preview(self.conn, 1, parsed)
        with self.assertRaisesRegex(ValueError, "Import this export into Pressj04"):
            tracker.import_option_executions(self.conn, 1, parsed)
        self.conn.rollback()
        self.assertEqual(len(tracker.load_trades(self.conn, [1])), 0)

    def test_schwab_bulk_close_spans_two_trades_and_reimports_cleanly(self):
        rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["08/18/2026", "Sell to Open", "GLW 09/25/2026 200.00 C", 1, "$3.42", "$0.67"],
            ["08/18/2026", "Buy to Open", "GLW 09/25/2026 205.00 C", 1, "$2.92", "$0.66"],
            ["08/19/2026", "Buy to Open", "GLW 09/25/2026 205.00 C", 1, "$2.31", "$0.66"],
            ["08/19/2026", "Sell to Open", "GLW 09/25/2026 200.00 C", 1, "$2.62", "$0.67"],
            ["08/24/2026", "Sell to Close", "GLW 09/25/2026 205.00 C", 2, "$0.66", "$1.34"],
            ["08/24/2026", "Buy to Close", "GLW 09/25/2026 200.00 C", 2, "$0.85", "$1.33"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")

        preview = tracker.annotate_import_preview(self.conn, 1, parsed)
        self.assertEqual(preview["summary"]["unmatched_closes"], 0)
        first = tracker.import_option_executions(self.conn, 1, parsed)
        trades = tracker.load_trades(self.conn, [1])
        self.assertEqual(first["inserted"], 6)
        self.assertEqual(first["unmatched"], 0)
        self.assertEqual(len(trades), 2)
        self.assertTrue(all(trade["status"] == "CLOSED" for trade in trades))
        self.assertEqual(sum(trade["realized_pnl"] for trade in trades), 37.67)
        self.assertEqual(
            sorted(sum(execution["fees"] for leg in trade["legs"] for execution in leg["executions"]
                       if execution["action"] in {"STC", "BTC"}) for trade in trades),
            [1.33, 1.34],
        )
        again = tracker.annotate_import_preview(self.conn, 1, parsed)
        self.assertEqual(again["summary"]["duplicates"], 6)
        second = tracker.import_option_executions(self.conn, 1, parsed)
        self.assertEqual(second["inserted"], 0)
        self.assertEqual(second["duplicates"], 6)

    def test_broker_bulk_close_replaces_later_auto_expirations_across_trades(self):
        opening_rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["11/06/2025", "Sell to Open", "SPY 03/20/2026 565.00 P", 6, "$6.00", "$3.96"],
            ["11/06/2025", "Buy to Open", "SPY 03/20/2026 555.00 P", 6, "$5.00", "$3.96"],
            ["11/14/2025", "Sell to Open", "SPY 03/20/2026 565.00 P", 1, "$5.00", "$0.66"],
            ["11/14/2025", "Buy to Open", "SPY 03/20/2026 555.00 P", 1, "$4.00", "$0.66"],
            ["12/02/2025", "Sell to Open", "SPY 03/20/2026 565.00 P", 1, "$4.00", "$0.66"],
            ["12/02/2025", "Buy to Open", "SPY 03/20/2026 555.00 P", 1, "$3.00", "$0.66"],
        ]
        closing_rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["03/12/2026", "Sell to Close", "SPY 03/20/2026 555.00 P", 8, "$0.29", "$5.33"],
            ["03/12/2026", "Buy to Close", "SPY 03/20/2026 565.00 P", 8, "$0.33", "$5.30"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(opening_rows)
            openings = parse_option_transactions(str(path), path.name, "schwab")
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(closing_rows)
            closes = parse_option_transactions(str(path), path.name, "schwab")
        tracker.import_option_executions(self.conn, 1, openings)
        tracker.settle_expired_legs(self.conn, [1], today=date(2026, 3, 21))
        before = tracker.load_trades(self.conn, [1])
        self.assertEqual(len(before), 3)
        self.assertTrue(all(t["closed_at"] == "2026-03-20" for t in before))
        preview = tracker.annotate_import_preview(self.conn, 1, closes)
        self.assertEqual(preview["summary"]["auto_expiry_corrections"], 2)
        self.assertEqual(preview["summary"]["unmatched_closes"], 0)
        result = tracker.import_option_executions(self.conn, 1, closes)
        self.assertEqual(result["inserted"], 2)
        self.assertEqual(result["auto_expiry_corrections"], 2)
        after = tracker.load_trades(self.conn, [1])
        self.assertTrue(all(t["closed_at"] == "2026-03-12" for t in after))
        self.assertEqual(
            round(sum(t["realized_pnl"] for t in after) - sum(t["realized_pnl"] for t in before), 2),
            -42.63,
        )
        self.assertEqual(self.conn.execute(
            "SELECT COUNT(*) FROM option_executions WHERE source = 'auto_expire'"
        ).fetchone()[0], 0)
        self.assertEqual(tracker.import_option_executions(self.conn, 1, closes)["duplicates"], 2)

    def test_close_quantity_must_fit_all_matching_open_legs(self):
        rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["08/18/2026", "Sell to Open", "GLW 09/25/2026 200.00 C", 1, "$3.42", "$0.67"],
            ["08/19/2026", "Sell to Open", "GLW 09/25/2026 200.00 C", 1, "$2.62", "$0.67"],
            ["08/24/2026", "Buy to Close", "GLW 09/25/2026 200.00 C", 3, "$0.85", "$2.00"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")
        preview = tracker.annotate_import_preview(self.conn, 1, parsed)
        self.assertEqual(preview["summary"]["unmatched_closes"], 1)
        result = tracker.import_option_executions(self.conn, 1, parsed)
        self.assertEqual(result["unmatched"], 1)
        self.assertEqual(result["inserted"], 2)
        self.assertEqual(len(tracker.load_trades(self.conn, [1], status="OPEN")), 2)

    def test_staged_put_and_call_spreads_closed_together_become_one_iron_condor(self):
        rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["08/13/2026", "Buy to Open", "GLW 09/25/2026 120.00 P", 1, "$1.30", "$0.66"],
            ["08/13/2026", "Sell to Open", "GLW 09/25/2026 130.00 P", 1, "$2.50", "$0.67"],
            ["08/26/2026", "Buy to Open", "GLW 09/25/2026 195.00 C", 1, "$1.25", "$0.66"],
            ["08/26/2026", "Sell to Open", "GLW 09/25/2026 185.00 C", 1, "$2.14", "$0.66"],
            ["09/03/2026", "Sell to Close", "GLW 09/25/2026 120.00 P", 1, "$0.73", "$0.66"],
            ["09/03/2026", "Sell to Close", "GLW 09/25/2026 195.00 C", 1, "$0.43", "$0.66"],
            ["09/03/2026", "Buy to Close", "GLW 09/25/2026 130.00 P", 1, "$2.28", "$0.66"],
            ["09/03/2026", "Buy to Close", "GLW 09/25/2026 185.00 C", 1, "$0.48", "$0.66"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")

        imported = tracker.import_option_executions(self.conn, 1, parsed)
        self.assertEqual(imported["trades_grouped"], 1)
        trades = tracker.load_trades(self.conn, [1])
        self.assertEqual(len(trades), 1)
        condor = trades[0]
        self.assertEqual(condor["strategy_type"], "Iron Condor")
        self.assertEqual(condor["scanner_strategy_key"], "iron-condor")
        self.assertEqual(condor["opened_at"], "2026-08-13")
        self.assertEqual(condor["closed_at"], "2026-09-03")
        self.assertEqual(len(condor["legs"]), 4)
        self.assertEqual(condor["entry_net_amount"], 206.35)
        self.assertEqual(condor["realized_pnl"], 43.71)
        self.assertEqual(condor["max_risk"], 793.65)
        expected_entry_years = (881.33 * 13 + 793.65 * 30) / 365
        expected_realized_years = (881.33 * 13 + 793.65 * 8) / 365
        self.assertAlmostEqual(condor["entry_risk_years"], expected_entry_years)
        self.assertAlmostEqual(condor["realized_risk_years"], expected_realized_years)
        self.assertEqual(condor["annualized_return_pct"], round(206.35 / expected_entry_years * 100, 2))
        self.assertEqual(condor["realized_annualized_return_pct"], round(43.71 / expected_realized_years * 100, 2))
        self.assertEqual(tracker.import_option_executions(self.conn, 1, parsed)["duplicates"], 8)
        self.assertEqual(len(tracker.load_trades(self.conn, [1])), 1)

    def test_staged_unbalanced_condor_uses_larger_side_for_risk(self):
        rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["08/13/2026", "Buy to Open", "GLW 10/16/2026 120.00 P", 2, "$1.00", "$0.00"],
            ["08/13/2026", "Sell to Open", "GLW 10/16/2026 130.00 P", 2, "$2.00", "$0.00"],
            ["08/26/2026", "Sell to Open", "GLW 10/16/2026 180.00 C", 1, "$2.00", "$0.00"],
            ["08/26/2026", "Buy to Open", "GLW 10/16/2026 195.00 C", 1, "$1.00", "$0.00"],
            ["09/03/2026", "Sell to Close", "GLW 10/16/2026 120.00 P", 2, "$0.50", "$0.00"],
            ["09/03/2026", "Buy to Close", "GLW 10/16/2026 130.00 P", 2, "$1.00", "$0.00"],
            ["09/03/2026", "Buy to Close", "GLW 10/16/2026 180.00 C", 1, "$0.50", "$0.00"],
            ["09/03/2026", "Sell to Close", "GLW 10/16/2026 195.00 C", 1, "$0.20", "$0.00"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")
        imported = tracker.import_option_executions(self.conn, 1, parsed)
        self.assertEqual(imported["trades_grouped"], 1)
        trade = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(trade["strategy_type"], "Unbalanced Iron Condor")
        self.assertEqual(trade["scanner_strategy_key"], "iron-condor")
        self.assertEqual(trade["entry_net_amount"], 300)
        self.assertEqual(trade["realized_pnl"], 170)
        self.assertEqual(trade["max_risk"], 1700)
        expected_years = (1800 * 13 + 1700 * 51) / 365
        self.assertAlmostEqual(trade["entry_risk_years"], expected_years)
        self.conn.execute("UPDATE option_trades SET strategy_type = 'Iron Condor' WHERE id = ?", (trade["id"],))
        self.conn.commit()
        self.assertEqual(tracker.import_option_executions(self.conn, 1, parsed)["trades_classified"], 1)
        self.assertEqual(tracker.load_trades(self.conn, [1])[0]["strategy_type"], "Unbalanced Iron Condor")
        self.assertEqual(tracker.import_option_executions(self.conn, 1, parsed)["duplicates"], 8)
        self.assertEqual(len(tracker.load_trades(self.conn, [1])), 1)

    def test_reimport_identifies_a_legacy_custom_put_condor(self):
        rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["08/18/2026", "Buy to Open", "SPY 09/25/2026 500.00 P", 1, "$0.20", "$0.66"],
            ["08/18/2026", "Sell to Open", "SPY 09/25/2026 510.00 P", 1, "$0.50", "$0.67"],
            ["08/18/2026", "Sell to Open", "SPY 09/25/2026 540.00 P", 1, "$1.00", "$0.67"],
            ["08/18/2026", "Buy to Open", "SPY 09/25/2026 550.00 P", 1, "$1.50", "$0.66"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")
        self.assertEqual({row["strategy_type"] for row in parsed["executions"]}, {"Put Condor"})
        tracker.import_option_executions(self.conn, 1, parsed)
        trade_id = tracker.load_trades(self.conn, [1])[0]["id"]
        self.conn.execute("UPDATE option_trades SET strategy_type = 'Custom' WHERE id = ?", (trade_id,))
        self.conn.commit()
        again = tracker.import_option_executions(self.conn, 1, parsed)
        self.assertEqual(again["inserted"], 0)
        self.assertEqual(again["trades_classified"], 1)
        trade = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(trade["strategy_type"], "Put Condor")
        self.assertEqual(trade["scanner_strategy_key"], "put-call-condor")

    def test_broker_expiration_corrects_a_late_manual_expiration_date(self):
        trade_id = tracker.create_trade(self.conn, 1, {
            "underlying": "SPY", "strategy_type": "Long Put", "purpose": "Directional",
            "opened_at": "2026-03-30",
            "legs": [{"position_side": "LONG", "option_type": "PUT",
                      "expiration": "2026-06-18", "strike": 430,
                      "contracts": 1, "price": 1.98, "fees": 0.66}],
        })
        leg_id = tracker.load_trades(self.conn, [1])[0]["legs"][0]["id"]
        tracker.close_trade(self.conn, 1, trade_id, {
            "closed_at": "2026-08-03",
            "executions": [{"leg_id": leg_id, "action": "EXPIRE", "price": 0, "fees": 0}],
        })
        rows = [
            ["Date", "Action", "Symbol", "Quantity", "Price", "Fees & Comm"],
            ["06/22/2026 as of 06/18/2026", "Expired", "SPY 06/18/2026 430.00 P", -1, "", ""],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schwab.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            parsed = parse_option_transactions(str(path), path.name, "schwab")
        preview = tracker.annotate_import_preview(self.conn, 1, parsed)
        self.assertEqual(preview["summary"]["date_corrections"], 1)
        result = tracker.import_option_executions(self.conn, 1, parsed)
        self.assertEqual(result["inserted"], 0)
        self.assertEqual(result["corrected"], 1)
        trade = tracker.load_trades(self.conn, [1])[0]
        self.assertEqual(trade["closed_at"], "2026-06-18")
        self.assertEqual(trade["realized_events"][0]["date"], "2026-06-18")
        self.assertEqual(trade["realized_pnl"], -198.66)
        self.assertEqual(tracker.import_option_executions(self.conn, 1, parsed)["duplicates"], 1)

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

    def _closed_put(self, underlying, opened_at, closed_at, price, close_price, purpose="Income"):
        created = self.client.post("/api/option-trades?profile_id=1", json={
            "underlying": underlying, "strategy_type": "Short Put", "purpose": purpose,
            "opened_at": opened_at, "max_risk": 1000,
            "legs": [{
                "position_side": "SHORT", "option_type": "PUT",
                "expiration": closed_at, "strike": 100, "contracts": 1,
                "price": price, "fees": 0,
            }],
        })
        trade = created.get_json()
        self.client.post(f"/api/option-trades/{trade['id']}/close?profile_id=1", json={
            "closed_at": closed_at,
            "executions": [{
                "leg_id": trade["legs"][0]["id"], "action": "BTC",
                "contracts": 1, "price": close_price, "fees": 0,
            }],
        })
        return trade["id"]

    def test_summary_metrics_follow_the_table_filters(self):
        """The cards describe the filtered rows, not the whole account."""
        self._closed_put("AAA", "2025-03-03", "2025-04-04", 2.00, 0.50)
        self._closed_put("BBB", "2026-03-03", "2026-04-04", 3.00, 1.00, purpose="Directional")

        everything = self.client.get("/api/option-trades?profile_id=1").get_json()
        self.assertEqual(everything["metrics"]["closed_trades"], 2)
        self.assertEqual(everything["total_trades"], 2)
        self.assertEqual(everything["years"], ["2026", "2025"])
        # The bug: All years reported only the current year on the wide card
        # while every other card counted all 2 trades. It now spans both years
        # (150 realized in 2025 plus 200 in 2026).
        self.assertEqual(everything["metrics"]["period_scope"], "all")
        self.assertEqual(everything["metrics"]["period_label"], "all time")
        self.assertEqual(everything["metrics"]["realized_ytd"], 350.0)

        by_year = self.client.get("/api/option-trades?profile_id=1&year=2025").get_json()
        self.assertEqual([trade["underlying"] for trade in by_year["trades"]], ["AAA"])
        self.assertEqual(by_year["metrics"]["closed_trades"], 1)
        self.assertEqual(by_year["metrics"]["realized_ytd"], 150.0)
        self.assertEqual(by_year["metrics"]["period_label"], "2025")
        self.assertEqual(by_year["metrics"]["period_start"], "2025-01-01")
        self.assertEqual(by_year["metrics"]["period_end"], "2025-12-31")
        # A past year has no month-to-date, so the narrow card slides back to
        # that year's final month rather than reporting an empty current month.
        self.assertEqual(by_year["metrics"]["month_label"], "Dec 2025")
        self.assertEqual(by_year["metrics"]["realized_mtd"], 0.0)
        self.assertFalse(by_year["metrics"]["is_current_period"])
        # The picker still offers every year the account has, so the selected
        # one cannot disappear out from under the filter.
        self.assertEqual(by_year["years"], ["2026", "2025"])
        self.assertEqual(by_year["total_trades"], 2)

        by_purpose = self.client.get("/api/option-trades?profile_id=1&purpose=Directional").get_json()
        self.assertEqual([trade["underlying"] for trade in by_purpose["trades"]], ["BBB"])
        self.assertEqual(by_purpose["metrics"]["closed_trades"], 1)

        by_ticker = self.client.get("/api/option-trades?profile_id=1&underlying=AAA").get_json()
        self.assertEqual(by_ticker["metrics"]["closed_trades"], 1)
        self.assertEqual(by_ticker["metrics"]["known_open_risk"], 0)

    def test_year_picker_offers_the_current_year_before_it_has_a_trade(self):
        """The list rolls forward each January without waiting for a fill."""
        conn = self.connection()
        try:
            self.assertEqual(tracker.trade_years(conn, [1], today=tracker.date(2027, 1, 2)), ["2027"])
            self._closed_put("DDD", "2025-03-03", "2025-04-04", 2.00, 0.50)
            self.assertEqual(
                tracker.trade_years(conn, [1], today=tracker.date(2027, 1, 2)),
                ["2027", "2025"],
            )
        finally:
            conn.close()

    def test_year_filter_keeps_a_trade_that_spans_two_years(self):
        self._closed_put("CCC", "2025-12-01", "2026-02-02", 2.00, 0.00)

        opened_in = self.client.get("/api/option-trades?profile_id=1&year=2025").get_json()
        closed_in = self.client.get("/api/option-trades?profile_id=1&year=2026").get_json()
        self.assertEqual(len(opened_in["trades"]), 1)
        self.assertEqual(len(closed_in["trades"]), 1)
        # It is listed under both years, but it realized in 2026 alone.
        self.assertEqual(opened_in["metrics"]["realized_ytd"], 0.0)
        self.assertEqual(closed_in["metrics"]["realized_ytd"], 200.0)


class OpenOptionLiquidatingValueTest(unittest.TestCase):
    """Net liq carries open contracts; the holdings tables never do."""

    def setUp(self):
        self.conn = memory_database()

    def tearDown(self):
        self.conn.close()

    def _short_spread(self):
        return tracker.create_trade(self.conn, 1, {
            "underlying": "SPY",
            "strategy_type": "Bull Put Spread",
            "purpose": "Income",
            "opened_at": "2026-08-01",
            "legs": [
                {"position_side": "SHORT", "option_type": "PUT", "expiration": "2026-09-18", "strike": 545, "contracts": 1, "price": 1.00},
                {"position_side": "LONG", "option_type": "PUT", "expiration": "2026-09-18", "strike": 540, "contracts": 1, "price": 0.30},
            ],
        })

    def _chain(self, mids):
        def fake_chain(underlying, expiration):
            return {"puts": [{"strike": k, "mid": v} for k, v in mids.items()], "calls": []}
        return fake_chain

    def test_absent_when_the_account_holds_no_options(self):
        self.assertIsNone(tracker.open_option_liquidating_value(self.conn, [1]))

    def test_short_spread_marks_negative_against_account_value(self):
        self._short_spread()
        with patch("options_api._fetch_chain", self._chain({545.0: 2.00, 540.0: 0.80})):
            snapshot = tracker.open_option_liquidating_value(self.conn, [1])

        # Costs 1.20 x 100 to buy back, so it reduces net liq.
        self.assertEqual(snapshot["liquidating_value"], -120.0)
        self.assertEqual(snapshot["open_trades"], 1)
        self.assertEqual(snapshot["open_contracts"], 2)
        self.assertEqual(snapshot["unpriced_legs"], [])

    def test_absent_once_every_contract_is_closed(self):
        trade_id = self._short_spread()
        trade = tracker.load_trades(self.conn, [1])[0]
        tracker.close_trade(self.conn, 1, trade_id, {
            "closed_at": "2026-08-05",
            "executions": [
                {"leg_id": leg["id"], "contracts": 1, "price": 0.10}
                for leg in trade["legs"]
            ],
        })

        self.assertIsNone(tracker.open_option_liquidating_value(self.conn, [1]))

    def test_unquoted_leg_is_reported_rather_than_marked_at_zero(self):
        self._short_spread()
        with patch("options_api._fetch_chain", self._chain({545.0: 2.00, 540.0: 0.0})):
            snapshot = tracker.open_option_liquidating_value(self.conn, [1])

        self.assertEqual(snapshot["priced_legs"], 1)
        self.assertEqual(snapshot["unpriced_legs"], ["SPY 2026-09-18 540P"])


if __name__ == "__main__":
    unittest.main()
