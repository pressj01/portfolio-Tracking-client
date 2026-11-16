import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tax_loss import _source_profile, candidate_replacements


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
                div_frequency TEXT,
                quantity REAL DEFAULT 1
            );
            CREATE TABLE holdings (
                ticker TEXT,
                profile_id INTEGER,
                quantity REAL,
                description TEXT,
                classification_type TEXT,
                current_value REAL
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
            "INSERT INTO all_account_info VALUES (?,?,?,?,?,?,?,?,?)",
            ("YMAX", 1, "YieldMax option income ETF", "ETF", 10000, 1800, 0.18, "M", 100),
        )
        self.conn.execute(
            "INSERT INTO holdings (ticker, profile_id, quantity) VALUES (?,?,?)",
            ("YMAX", 1, 100),
        )
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

    def test_low_yield_funds_are_not_offered_for_a_high_income_holding(self):
        # CRF: a ~20% closed-end fund whose broker description abbreviates
        # "fund" to "FD". Issuer listings store yield in percent, so 0.2375 is
        # a 0.24% fund -- it used to be read as a 23.75% one and offered as a
        # close income match.
        self.conn.execute(
            "INSERT INTO all_account_info VALUES (?,?,?,?,?,?,?,?,?)",
            ("CRF", 1, "CORNERSTONE TOTAL RETURN FD IN COM", None, 10000, 2100, 0.21, "M", 1700),
        )
        self.conn.execute("INSERT INTO etf_providers VALUES (1, 'Test Provider')")
        self.conn.executemany(
            "INSERT INTO etf_provider_funds VALUES (1,?,?,?,?,?)",
            [
                ("ARKQ", "ARK Autonomous Technology & Robotics ETF", 0.2375, None, 2.1e9),
                ("IBB", "iShares Biotechnology ETF", 0.2299, None, 7.8e9),
                ("HIGH", "High Income Premium ETF", 19.5, "Monthly", 1.5e9),
            ],
        )

        source = _source_profile(self.conn, "CRF", [1])
        self.assertEqual(source["asset_family"], "fund")

        suggestions = candidate_replacements(
            self.conn,
            "CRF",
            {"holding_profile_ids": [1], "transaction_profile_ids": [1]},
        )
        by_ticker = {s["ticker"]: s for s in suggestions}
        self.assertIn("HIGH", by_ticker)
        self.assertAlmostEqual(by_ticker["HIGH"]["yield"], 0.195)
        self.assertNotIn("ARKQ", by_ticker)
        self.assertNotIn("IBB", by_ticker)

    def test_scanner_yield_is_read_in_the_unit_it_was_saved_in(self):
        from tax_loss import _scanner_yield_ratio

        # Percent x 100 before the 2026-05-28 build, plain percent after.
        self.assertAlmostEqual(_scanner_yield_ratio(39.0, "2026-04-16T12:13:43"), 0.0039)
        self.assertAlmostEqual(_scanner_yield_ratio(840.0, "2026-04-16T12:13:43"), 0.084)
        self.assertAlmostEqual(_scanner_yield_ratio(6.91, "2026-05-28T09:39:53"), 0.0691)
        self.assertAlmostEqual(_scanner_yield_ratio(5564.0, "2026-09-01T00:00:00"), 0.5564)
        self.assertIsNone(_scanner_yield_ratio(None, "2026-09-01"))

    def test_legacy_mirror_fallback_uses_dividend_aliases(self):
        self.conn.execute(
            """INSERT INTO holdings
               (ticker, profile_id, quantity, description, classification_type, current_value)
               VALUES ('LEGACY', 1, 10, 'Legacy Income ETF', 'ETF', 1000)"""
        )
        self.conn.execute(
            "INSERT INTO dividends VALUES ('LEGACY', 1, 0.12, 'M')"
        )

        profile = _source_profile(self.conn, "LEGACY", [1])

        self.assertEqual(profile["ticker"], "LEGACY")
        self.assertEqual(profile["description"], "Legacy Income ETF")
        self.assertAlmostEqual(profile["yield"], 0.12)


if __name__ == "__main__":
    unittest.main()
