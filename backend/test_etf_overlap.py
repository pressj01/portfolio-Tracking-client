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


def _set_profile(conn, ticker, weights):
    sx.store_sector_profile(conn, {
        "ticker": ticker, "kind": "sectors", "asset_class": None,
        "weights": weights, "covered_pct": sum(weights.values()),
        "source": "test", "quote_type": None, "category": None, "note": None,
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


if __name__ == "__main__":
    unittest.main()
