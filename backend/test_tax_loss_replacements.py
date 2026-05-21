import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tax_loss import candidate_replacements


class TaxLossReplacementTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT,
                profile_id INTEGER,
                description TEXT,
                classification_type TEXT,
                current_value REAL,
                estim_payment_per_year REAL,
                current_annual_yield REAL,
                div_frequency TEXT
            );
            CREATE TABLE holdings (
                ticker TEXT,
                profile_id INTEGER,
                quantity REAL
            );
            CREATE TABLE dividends (
                ticker TEXT,
                profile_id INTEGER,
                current_annual_yield REAL,
                div_frequency TEXT
            );
            CREATE TABLE general_scanner_cache (
                ticker TEXT,
                name TEXT,
                sector TEXT,
                industry TEXT,
                asset_type TEXT,
                etf_category TEXT,
                etf_strategy TEXT,
                dividend_yield REAL,
                market_cap REAL,
                aum REAL
            );
            CREATE TABLE etf_providers (
                id INTEGER PRIMARY KEY,
                provider TEXT
            );
            CREATE TABLE etf_provider_funds (
                provider_id INTEGER,
                symbol TEXT,
                fund_name TEXT,
                div_yield REAL,
                frequency TEXT,
                assets REAL
            );
            CREATE TABLE categories (
                id INTEGER PRIMARY KEY,
                name TEXT
            );
            CREATE TABLE ticker_categories (
                ticker TEXT,
                profile_id INTEGER,
                category_id INTEGER
            );
            CREATE TABLE swap_candidates (
                profile_id INTEGER,
                ticker TEXT
            );
            """
        )

    def tearDown(self):
        self.conn.close()

    def test_income_replacement_prefers_similar_income_fund(self):
        self.conn.execute(
            "INSERT INTO all_account_info VALUES (?,?,?,?,?,?,?,?)",
            ("YMAX", 1, "YieldMax option income ETF", "ETF", 10000, 1800, 0.18, "M"),
        )
        self.conn.execute("INSERT INTO holdings VALUES (?,?,?)", ("YMAX", 1, 100))
        rows = [
            ("YMAX", "YieldMax option income ETF", None, None, "ETF", "Derivative Income", "Covered Call", 0.18, None, 1000000000),
            ("GOOD", "NEOS Premium Income ETF", None, None, "ETF", "Derivative Income", "Covered Call", 0.165, None, 900000000),
            ("SPY", "SPDR S&P 500 ETF Trust", None, None, "ETF", "Large Blend", "Broad Equity", 0.012, None, 500000000000),
            ("BOND", "Core Bond ETF", None, None, "ETF", "Fixed Income", "Core Bond", 0.045, None, 5000000000),
        ]
        self.conn.executemany("INSERT INTO general_scanner_cache VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
        self.conn.execute("INSERT INTO dividends VALUES (?,?,?,?)", ("GOOD", 1, 0.165, "M"))
        self.conn.execute("INSERT INTO dividends VALUES (?,?,?,?)", ("SPY", 1, 0.012, "Q"))
        self.conn.execute("INSERT INTO dividends VALUES (?,?,?,?)", ("BOND", 1, 0.045, "M"))

        suggestions = candidate_replacements(
            self.conn,
            "YMAX",
            {"holding_profile_ids": [1], "transaction_profile_ids": [1]},
        )

        tickers = [s["ticker"] for s in suggestions]
        self.assertIn("GOOD", tickers)
        self.assertNotIn("SPY", tickers)
        self.assertNotIn("BOND", tickers)
        self.assertLess(abs(suggestions[0]["yield_delta"]), 0.03)
        self.assertIn("same ETF category", suggestions[0]["match_reasons"])


if __name__ == "__main__":
    unittest.main()
