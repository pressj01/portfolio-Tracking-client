import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import etf_overlap as eo
import sector_exposure as sx
from database import ensure_tables_exist


def _memory_db():
    conn = sqlite3.connect(":memory:")
    ensure_tables_exist(conn)
    return conn


def _add_fund(conn, ticker, rows, status="resolved", source="test"):
    coverage = round(sum(w for _s, _n, w in rows), 2)
    for sym, name, weight in rows:
        conn.execute(
            "INSERT INTO fund_holdings (fund_ticker, symbol, name, weight_pct, source) VALUES (?,?,?,?,?)",
            (ticker, sym, name, weight, source),
        )
    conn.execute(
        "INSERT INTO fund_holdings_meta (fund_ticker, status, source, coverage_pct, holdings_count) "
        "VALUES (?,?,?,?,?)",
        (ticker, status, source, coverage, len(rows)),
    )
    conn.commit()


def _set_profile(conn, ticker, weights, source="test", industry=None):
    sx.store_sector_profile(conn, {
        "ticker": ticker, "kind": "sectors", "asset_class": None,
        "weights": weights, "covered_pct": sum(weights.values()),
        "source": source, "quote_type": None, "category": None, "note": None,
        "industry": industry,
    })


class OverlapMathTests(unittest.TestCase):
    def test_overlap_is_the_sum_of_the_smaller_weights(self):
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0), ("AAPL", "Apple Inc", 7.0),
                                ("NEM", "Newmont", 0.2)])
        _add_fund(conn, "BBB", [("NVDA", "NVIDIA Corp", 7.5), ("AAPL", "Apple Inc", 0.5),
                                ("LMT", "Lockheed Martin", 0.2)])
        out = eo.build_overlap(conn, "aaa", "bbb")
        # 7.5 (NVDA) + 0.5 (AAPL): sharing Apple at 7% vs 0.5% is 0.5 of
        # common exposure, not 7.
        self.assertAlmostEqual(out["overlap_pct"], 8.0)
        self.assertEqual(out["shared_count"], 2)
        self.assertEqual(out["only_a_count"], 1)
        self.assertEqual(out["only_b_count"], 1)
        self.assertAlmostEqual(out["a_weight_in_shared"], 15.0)
        self.assertAlmostEqual(out["b_weight_in_shared"], 8.0)
        self.assertEqual(out["holdings"][0]["symbol"], "NVDA")

    def test_share_class_spellings_match(self):
        # One issuer files BRK/B, another BRK-B. Compared as text they show up
        # as an overweight in each fund and never as a shared holding.
        conn = _memory_db()
        _add_fund(conn, "AAA", [("BRKB", "Berkshire Hathaway Inc Class B", 1.4)])
        _add_fund(conn, "BBB", [("", "Berkshire Hathaway Inc Class B", 1.5),
                                ("XOM", "Exxon Mobil", 1.0)])
        out = eo.build_overlap(conn, "AAA", "BBB")
        self.assertEqual(out["shared_count"], 1)
        self.assertAlmostEqual(out["overlap_pct"], 1.4)

    def test_cash_and_option_legs_are_not_overlap(self):
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0),
                                ("", "United States Treasury Bill", 40.0),
                                ("", "SPXW US 08/03/26 C7595", -1.2)])
        _add_fund(conn, "BBB", [("NVDA", "NVIDIA Corp", 6.0),
                                ("", "United States Treasury Bill", 50.0)])
        out = eo.build_overlap(conn, "AAA", "BBB")
        self.assertAlmostEqual(out["overlap_pct"], 6.0)
        self.assertAlmostEqual(out["a"]["cash_pct"], 40.0)
        self.assertAlmostEqual(out["a"]["derivatives_pct"], -1.2)
        self.assertEqual(out["a"]["holdings_count"], 1)

    def test_wrapper_is_compared_on_what_it_holds(self):
        conn = _memory_db()
        _add_fund(conn, "VOO", [("NVDA", "NVIDIA Corp", 60.0), ("AAPL", "Apple Inc", 40.0)])
        _add_fund(conn, "WRAP", [("VOO", "Vanguard S&P 500 ETF", 100.0)])
        _add_fund(conn, "BBB", [("NVDA", "NVIDIA Corp", 50.0), ("MSFT", "Microsoft", 50.0)])
        out = eo.build_overlap(conn, "WRAP", "BBB")
        self.assertAlmostEqual(out["overlap_pct"], 50.0)

    def test_a_stock_is_reported_not_compared(self):
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0)])
        _add_fund(conn, "NVDA", [], status="self")
        out = eo.build_overlap(conn, "AAA", "NVDA")
        self.assertIn("single stock", out["error"])
        self.assertEqual(out["ticker"], "NVDA")

    def test_synthetic_fund_is_not_called_missing(self):
        # KGLD files three Treasury bills and nothing else. That is a resolved
        # fund with nothing comparable, not a fund with no data.
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0)])
        _add_fund(conn, "SYN", [("", "United States Treasury Bill", 60.0),
                                ("", "Treasury Bill 0% 09/03/26", 40.0)])
        out = eo.build_overlap(conn, "AAA", "SYN")
        self.assertIn("no stock holdings to compare", out["error"])
        self.assertNotIn("No holdings data", out["error"])

    def test_unknown_fund_is_reported(self):
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0)])
        out = eo.build_overlap(conn, "AAA", "ZZZZ")
        self.assertIn("No holdings data", out["error"])


class SectorTests(unittest.TestCase):
    def test_fund_level_weights_drive_the_drift(self):
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0)])
        _add_fund(conn, "BBB", [("NVDA", "NVIDIA Corp", 6.0)])
        _set_profile(conn, "AAA", {"Information Technology": 40.0, "Financials": 10.0})
        _set_profile(conn, "BBB", {"Information Technology": 30.0, "Financials": 14.0})
        _set_profile(conn, "NVDA", {"Information Technology": 100.0})
        out = eo.build_overlap(conn, "AAA", "BBB")
        drift = {s["sector"]: s["diff"] for s in out["sectors"]}
        self.assertAlmostEqual(drift["Information Technology"], 10.0)
        self.assertAlmostEqual(drift["Financials"], -4.0)
        self.assertEqual(out["a"]["sector_basis"], "fund")
        self.assertEqual(out["holdings"][0]["sector"], "Information Technology")

    def test_falls_back_to_constituents_without_a_fund_profile(self):
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0), ("JPM", "JPMorgan", 2.0)])
        _add_fund(conn, "BBB", [("NVDA", "NVIDIA Corp", 6.0)])
        _set_profile(conn, "NVDA", {"Information Technology": 100.0})
        out = eo.build_overlap(conn, "AAA", "BBB")
        self.assertEqual(out["a"]["sector_basis"], "constituents")
        by = {s["sector"]: s for s in out["sectors"]}
        self.assertAlmostEqual(by["Information Technology"]["a"], 8.0)
        self.assertAlmostEqual(by[sx.UNCLASSIFIED]["a"], 2.0)

    def test_fill_targets_skip_known_and_unlookupable_symbols(self):
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0), ("JPM", "JPMorgan", 2.0),
                                ("", "Some Private Placement", 1.0)])
        _add_fund(conn, "BBB", [("NVDA", "NVIDIA Corp", 6.0)])
        _set_profile(conn, "NVDA", {"Information Technology": 100.0})
        out = eo.build_overlap(conn, "AAA", "BBB")
        self.assertEqual(eo._sector_fill_targets(out, sx.load_sector_cache(conn)), ["JPM"])

    def test_failed_lookup_does_not_erase_a_known_sector(self):
        # Re-asking for a stock's industry can be throttled. The empty answer
        # must not replace the sector the stock already had.
        conn = _memory_db()
        _set_profile(conn, "CRWD", {"Information Technology": 100.0}, source="yahoo_quote")
        empty = {"ticker": "CRWD", "kind": "none", "asset_class": None, "weights": {},
                 "covered_pct": 0.0, "source": None, "quote_type": None,
                 "category": None, "note": "rate limited", "industry": None}
        self.assertFalse(eo._store_lookup(conn, empty, sx.load_sector_cache(conn)))
        kept = sx.load_sector_cache(conn)["CRWD"]
        self.assertEqual(kept["weights"], {"Information Technology": 100.0})

        # A stock with nothing cached still records the miss, as before.
        empty_new = {**empty, "ticker": "ZZZZ"}
        self.assertTrue(eo._store_lookup(conn, empty_new, sx.load_sector_cache(conn)))
        self.assertEqual(sx.load_sector_cache(conn)["ZZZZ"]["kind"], "none")

    def test_industry_is_reported_per_holding(self):
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0), ("JPM", "JPMorgan", 2.0)])
        _add_fund(conn, "BBB", [("NVDA", "NVIDIA Corp", 6.0)])
        _set_profile(conn, "NVDA", {"Information Technology": 100.0},
                     source="yahoo_quote", industry="Semiconductors")
        out = eo.build_overlap(conn, "AAA", "BBB")
        by = {r["symbol"]: r for r in out["holdings"]}
        self.assertEqual(by["NVDA"]["industry"], "Semiconductors")
        self.assertIsNone(by["JPM"]["industry"])

    def test_stocks_profiled_before_industry_existed_are_looked_up_again(self):
        # Every stock already in the cache has a sector and no industry. Without
        # this the column would stay blank for exactly the largest holdings.
        conn = _memory_db()
        _add_fund(conn, "AAA", [("NVDA", "NVIDIA Corp", 8.0), ("AAPL", "Apple Inc", 7.0),
                                ("VOO", "Vanguard S&P 500 ETF", 5.0)])
        _add_fund(conn, "BBB", [("NVDA", "NVIDIA Corp", 6.0)])
        _set_profile(conn, "NVDA", {"Information Technology": 100.0}, source="yahoo_quote")
        _set_profile(conn, "AAPL", {"Information Technology": 100.0},
                     source="yahoo_quote", industry="Consumer Electronics")
        # A fund has sector weights but can never have an industry; asking
        # again would spend a request on every comparison for nothing.
        _set_profile(conn, "VOO", {"Information Technology": 60.0, "Financials": 40.0},
                     source="yahoo_fund_sectors")
        out = eo.build_overlap(conn, "AAA", "BBB")
        self.assertEqual(eo._sector_fill_targets(out, sx.load_sector_cache(conn)), ["NVDA"])


class PortfolioFundsTests(unittest.TestCase):
    def _hold(self, conn, ticker, value, profile_id=1, description=""):
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, description, current_value) VALUES (?,?,?,?)",
            (ticker, profile_id, description, value),
        )

    def _mark(self, conn, ticker, status):
        conn.execute(
            "INSERT INTO fund_holdings_meta (fund_ticker, status) VALUES (?,?)", (ticker, status))

    def test_lists_this_portfolios_funds_largest_first(self):
        conn = _memory_db()
        self._hold(conn, "SCHD", 500.0, description="Schwab US Dividend Equity")
        self._hold(conn, "SPYI", 900.0)
        self._hold(conn, "AAPL", 2000.0)
        self._hold(conn, "SWVXX", 3000.0)
        self._hold(conn, "NEWF", 100.0)       # never looked up: may be a fund
        self._hold(conn, "GONE", 0.0)         # closed position
        self._hold(conn, "JEPI", 700.0, profile_id=2)
        self._mark(conn, "SCHD", "resolved")
        self._mark(conn, "SPYI", "unresolved")
        self._mark(conn, "AAPL", "self")
        self._mark(conn, "SWVXX", "cash")

        out = eo.portfolio_funds(conn, [1])
        self.assertEqual([f["ticker"] for f in out], ["SPYI", "SCHD", "NEWF"])
        self.assertEqual(out[1]["description"], "Schwab US Dividend Equity")

    def test_a_rollup_adds_the_same_fund_across_accounts(self):
        conn = _memory_db()
        self._hold(conn, "SCHD", 500.0, profile_id=1)
        self._hold(conn, "SCHD", 250.0, profile_id=2)
        out = eo.portfolio_funds(conn, [1, 2])
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0]["current_value"], 750.0)


if __name__ == "__main__":
    unittest.main()
