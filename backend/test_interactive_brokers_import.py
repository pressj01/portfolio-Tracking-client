"""Interactive Brokers Activity Statement and Transaction History import."""

import csv
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_template import (
    create_interactive_brokers_template,
    create_interactive_brokers_transactions_template,
)
from transaction_import import (
    parse_interactive_brokers_positions,
    parse_interactive_brokers_transactions,
)

IB_SAMPLE_DIR = Path(os.environ.get("IB_SAMPLE_DIR", r"C:\Interactive Broker"))
IB_POSITIONS_SAMPLE = next(
    (path for path in IB_SAMPLE_DIR.glob("*.csv") if "transaction" not in path.name.lower()),
    None,
)
IB_TRANSACTIONS_SAMPLE = next(
    (path for path in IB_SAMPLE_DIR.glob("*.csv") if "transaction" in path.name.lower()),
    None,
)


def _write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(rows)


class InteractiveBrokersImportTest(unittest.TestCase):
    def test_positions_template_reads_stocks_preferred_fx_and_skips_options(self):
        path = Path(create_interactive_brokers_template())
        result = parse_interactive_brokers_positions(str(path), path.name)

        self.assertEqual(result["format_type"], "positions")
        self.assertEqual(result["source_format"], "interactive_brokers")
        self.assertEqual(result["as_of"], "2026-07-31")
        self.assertEqual(result["account_name"], "U0000000")
        self.assertEqual(result["summary"]["options"], 1)
        self.assertEqual(result["summary"]["cash"], 1500.0)

        by_ticker = {pos["ticker"]: pos for pos in result["positions"]}
        self.assertEqual(set(by_ticker), {"JEPI", "SCHD", "CIM-PRB", "PGDC"})
        self.assertEqual(by_ticker["CIM-PRB"]["description"], "CIM 8 PERP PD")
        self.assertEqual(by_ticker["JEPI"]["quantity"], 100)
        self.assertEqual(by_ticker["JEPI"]["purchase_value"], 5550.0)
        self.assertAlmostEqual(by_ticker["PGDC"]["purchase_value"], 35.5, places=2)
        self.assertAlmostEqual(by_ticker["PGDC"]["current_value"], 28.4, places=2)
        self.assertAlmostEqual(by_ticker["PGDC"]["current_price"], 0.284, places=3)

    def test_transactions_template_imports_buys_sells_dividends_drip_and_assignments(self):
        path = Path(create_interactive_brokers_transactions_template())
        result = parse_interactive_brokers_transactions(str(path), path.name)

        self.assertEqual(result["summary"]["buys"], 3)
        self.assertEqual(result["summary"]["sells"], 1)
        self.assertEqual(result["summary"]["dividends"], 2)
        self.assertGreaterEqual(result["summary"]["drip_detected"], 1)
        self.assertEqual(result["summary"]["filtered"], 1)

        by_key = {(row["type"], row["ticker"], row["notes"]): row for row in result["transactions"]}
        self.assertIn(("BUY", "JEPI", ""), by_key)
        self.assertIn(("SELL", "SCHD", ""), by_key)
        self.assertIn(("DIVIDEND", "JEPI", "Dividend"), by_key)
        self.assertIn(("DIVIDEND", "MLPI", "Payment in Lieu"), by_key)
        self.assertIn(("BUY", "AGQ", "Assignment"), by_key)
        drip = next(row for row in result["transactions"] if "[DRIP]" in (row["notes"] or ""))
        self.assertEqual(drip["ticker"], "JEPI")
        self.assertAlmostEqual(drip["shares"], 0.7867, places=4)

    def test_transaction_history_file_is_rejected_as_positions(self):
        path = Path(create_interactive_brokers_transactions_template())
        with self.assertRaises(ValueError) as ctx:
            parse_interactive_brokers_positions(str(path), path.name)
        self.assertIn("Transaction History", str(ctx.exception))

    def test_activity_statement_trades_and_dividends_import_as_transactions(self):
        rows = [
            ["Statement", "Header", "Field Name", "Field Value"],
            ["Statement", "Data", "BrokerName", "Interactive Brokers LLC"],
            ["Account Information", "Header", "Field Name", "Field Value"],
            ["Account Information", "Data", "Account", "U1234567"],
            ["Trades", "Header", "DataDiscriminator", "Asset Category", "Currency", "Account", "Symbol", "Date/Time", "Quantity", "T. Price", "Proceeds", "Comm/Fee"],
            ["Trades", "Data", "Order", "Stocks", "USD", "U1234567", "JEPI", "2026-07-23, 10:08:19", "4", "25", "-100", "-0.33"],
            ["Trades", "Data", "Order", "Stocks", "USD", "U1234567", "SCHD", "2026-07-24, 09:30:00", "-10", "82.50", "825", "-0.45"],
            ["Trades", "SubTotal", "", "Stocks", "USD", "JEPI", "", "", "4", "", "-100", "-0.33"],
            ["Dividends", "Header", "Currency", "Account", "Date", "Description", "Amount"],
            ["Dividends", "Data", "USD", "U1234567", "2026-07-01", "JEPI(US46641Q3320) Cash Dividend USD 0.45 per Share (Ordinary Dividend)", "45.00"],
            ["Dividends", "Data", "USD", "U1234567", "2026-07-06", "PBR A(US71654V1017) Payment in Lieu of Dividend (Ordinary Dividend)", "19.43"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ib-activity.csv"
            _write_csv(path, rows)
            result = parse_interactive_brokers_transactions(str(path), path.name)

        kinds = {(row["type"], row["ticker"]) for row in result["transactions"]}
        self.assertEqual(kinds, {("BUY", "JEPI"), ("SELL", "SCHD"), ("DIVIDEND", "JEPI"), ("DIVIDEND", "PBR-A")})
        sell = next(row for row in result["transactions"] if row["type"] == "SELL")
        self.assertEqual(sell["shares"], 10)
        self.assertAlmostEqual(sell["price_per_share"], 82.5)

    def test_preferred_and_occ_option_symbols_are_normalized_or_skipped(self):
        rows = [
            ["Statement", "Header", "Field Name", "Field Value"],
            ["Statement", "Data", "Title", "Transaction History"],
            ["Transaction History", "Header", "Date", "Account", "Description", "Transaction Type", "Symbol", "Quantity", "Price", "Price Currency", "Gross Amount", "Commission", "Net Amount"],
            ["Transaction History", "Data", "2026-04-15", "U1", "CIM 8 PERP PD", "Dividend", "CIM PRB", "-", "-", "-", "12.50", "-", "12.50"],
            ["Transaction History", "Data", "2026-04-16", "U1", "PETROLEO BRASIL-SP PREF ADR", "Dividend", "PBR A", "-", "-", "-", "8.10", "-", "8.10"],
            ["Transaction History", "Data", "2026-04-17", "U1", "PUT", "Sell", "AG    270115P00010000", "-1", "1.05", "USD", "105", "-0.65", "104.35"],
            ["Transaction History", "Data", "2026-04-18", "U1", "RIGHTS", "Buy", "TYG RTWI", "10", "0.01", "USD", "-0.10", "0", "-0.10"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ib-txn.csv"
            _write_csv(path, rows)
            result = parse_interactive_brokers_transactions(str(path), path.name)

        tickers = {row["ticker"] for row in result["transactions"]}
        self.assertEqual(tickers, {"CIM-PRB", "PBR-A"})
        self.assertEqual(result["summary"]["filtered"], 2)

    def test_cad_buy_uses_gross_amount_as_usd_price(self):
        rows = [
            ["Statement", "Header", "Field Name", "Field Value"],
            ["Statement", "Data", "Title", "Transaction History"],
            ["Transaction History", "Header", "Date", "Account", "Description", "Transaction Type", "Symbol", "Quantity", "Price", "Price Currency", "Gross Amount", "Commission", "Net Amount"],
            ["Transaction History", "Data", "2026-03-03", "U1", "PATAGONIA GOLD CORP", "Buy", "PGDC", "500.0", "1.16", "CAD", "-424.0264", "-1.79", "-425.82"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ib-cad.csv"
            _write_csv(path, rows)
            result = parse_interactive_brokers_transactions(str(path), path.name)

        buy = result["transactions"][0]
        self.assertEqual(buy["ticker"], "PGDC")
        self.assertAlmostEqual(buy["price_per_share"], 0.84805, places=4)
        self.assertAlmostEqual(buy["fees"], 1.79, places=2)

    def test_assignment_direction_follows_the_stock_quantity(self):
        rows = [
            ["Statement", "Header", "Field Name", "Field Value"],
            ["Statement", "Data", "Title", "Transaction History"],
            ["Transaction History", "Header", "Date", "Account", "Description", "Transaction Type", "Symbol", "Quantity", "Price", "Price Currency", "Gross Amount", "Commission", "Net Amount"],
            ["Transaction History", "Data", "2026-08-21", "U1", "Sell 100 EXAMPLE CORP (Assignment)", "Assignment", "EXM", "-100", "25", "USD", "2500", "-", "2500"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ib-assignment.csv"
            _write_csv(path, rows)
            result = parse_interactive_brokers_transactions(str(path), path.name)

        assignment = result["transactions"][0]
        self.assertEqual(assignment["type"], "SELL")
        self.assertEqual(assignment["shares"], 100)
        self.assertEqual(assignment["notes"], "Assignment")

    def test_activity_statement_converts_non_usd_trades(self):
        rows = [
            ["Statement", "Header", "Field Name", "Field Value"],
            ["Statement", "Data", "BrokerName", "Interactive Brokers LLC"],
            ["Forex Balances", "Header", "Asset Category", "Currency", "Description", "Quantity", "Cost Price", "Cost Basis in USD", "Close Price", "Value in USD", "Unrealized P/L in USD", "Code"],
            ["Forex Balances", "Data", "Forex", "USD", "CAD", "100", "0.72", "72", "0.71", "71", "-1", ""],
            ["Trades", "Header", "DataDiscriminator", "Asset Category", "Currency", "Account", "Symbol", "Date/Time", "Quantity", "T. Price", "C. Price", "Proceeds", "Comm/Fee", "Basis", "Realized P/L", "MTM P/L", "Code"],
            ["Trades", "Data", "Order", "Stocks", "CAD", "U1", "PGDC", "2026-07-23, 10:08:19", "100", "1.00", "1.01", "-100", "-1", "101", "0", "1", "O"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ib-activity-cad.csv"
            _write_csv(path, rows)
            result = parse_interactive_brokers_transactions(str(path), path.name)

        buy = result["transactions"][0]
        self.assertAlmostEqual(buy["price_per_share"], 0.71, places=4)
        self.assertAlmostEqual(buy["fees"], 0.71, places=4)


class InteractiveBrokersSampleFileTest(unittest.TestCase):
    @unittest.skipUnless(IB_POSITIONS_SAMPLE is not None, "sample IB Activity Statement not present")
    def test_july_activity_statement_open_positions(self):
        result = parse_interactive_brokers_positions(
            str(IB_POSITIONS_SAMPLE),
            IB_POSITIONS_SAMPLE.name,
        )
        tickers = {pos["ticker"] for pos in result["positions"]}
        self.assertGreaterEqual(result["summary"]["holdings"], 100)
        self.assertIn("AMZN", tickers)
        self.assertIn("CIM-PRB", tickers)
        self.assertIn("PBR-A", tickers)
        self.assertIn("PGDC", tickers)
        self.assertGreater(result["summary"]["options"], 0)
        self.assertLess(result["summary"]["cash"], 0)
        self.assertEqual(result["as_of"], "2026-07-31")
        pgdc = next(pos for pos in result["positions"] if pos["ticker"] == "PGDC")
        self.assertGreater(pgdc["purchase_value"], 1000)
        self.assertLess(pgdc["purchase_value"], 2000)
        self.assertTrue(all(" " not in pos["ticker"] for pos in result["positions"]))

    @unittest.skipUnless(IB_TRANSACTIONS_SAMPLE is not None, "sample IB Transaction History not present")
    def test_transaction_history_sample_counts(self):
        result = parse_interactive_brokers_transactions(
            str(IB_TRANSACTIONS_SAMPLE),
            IB_TRANSACTIONS_SAMPLE.name,
        )
        self.assertGreater(result["summary"]["buys"], 900)
        self.assertGreater(result["summary"]["dividends"], 800)
        self.assertGreater(result["summary"]["sells"], 100)
        self.assertTrue(result.get("account_name"))
        tickers = {row["ticker"] for row in result["transactions"]}
        self.assertIn("CIM-PRB", tickers)
        self.assertIn("PBR-A", tickers)
        self.assertTrue(all(" " not in row["ticker"] for row in result["transactions"]))


if __name__ == "__main__":
    unittest.main()
