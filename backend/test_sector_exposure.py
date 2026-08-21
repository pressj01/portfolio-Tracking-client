import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sector_exposure as sx
from database import ensure_tables_exist


def _memory_db():
    conn = sqlite3.connect(":memory:")
    ensure_tables_exist(conn)
    return conn


def _add_position(conn, ticker, value, profile_id=1):
    conn.execute(
        "INSERT INTO all_account_info (profile_id, ticker, quantity, current_value) VALUES (?,?,?,?)",
        (profile_id, ticker, 1, value),
    )
    conn.commit()


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


def _set_profile(conn, ticker, kind, weights=None, asset_class=None, source="test"):
    sx.store_sector_profile(conn, {
        "ticker": ticker, "kind": kind, "asset_class": asset_class,
        "weights": weights or {}, "covered_pct": sum((weights or {}).values()) or 0.0,
        "source": source, "quote_type": None, "category": None, "note": None,
    })


class TaxonomyTests(unittest.TestCase):
    def test_both_yahoo_spellings_map_to_gics(self):
        # A fund's sector_weightings uses snake_case keys; an equity quote uses
        # title case. Both have to land on the same bucket or one security's
        # technology and another's would be charted as different sectors.
        self.assertEqual(sx.canonical_sector("technology"), "Information Technology")
        self.assertEqual(sx.canonical_sector("Technology"), "Information Technology")
        self.assertEqual(sx.canonical_sector("financial_services"), "Financials")
        self.assertEqual(sx.canonical_sector("Financial Services"), "Financials")
        self.assertEqual(sx.canonical_sector("consumer_cyclical"), "Consumer Discretionary")
        self.assertEqual(sx.canonical_sector("Consumer Defensive"), "Consumer Staples")
        self.assertEqual(sx.canonical_sector("realestate"), "Real Estate")
        self.assertEqual(sx.canonical_sector("basic_materials"), "Materials")

    def test_every_alias_target_is_a_known_sector(self):
        for label in sx._SECTOR_ALIASES.values():
            self.assertIn(label, sx.SECTOR_SET)

    def test_unknown_sector_is_not_invented(self):
        self.assertIsNone(sx.canonical_sector("Blockchain"))
        self.assertIsNone(sx.canonical_sector(""))
        self.assertIsNone(sx.canonical_sector(None))

    def test_bond_categories_route_to_fixed_income(self):
        for category in ("Intermediate Core Bond", "Short Government",
                         "Muni Single State Short", "Securitized Bond - Focused",
                         "Short-Term Inflation-Protected Bond"):
            self.assertEqual(sx._category_bucket(category), sx.FIXED_INCOME, category)

    def test_option_income_categories_are_left_alone(self):
        # These funds publish real sector weights. Routing them on a category
        # keyword would throw that breakdown away.
        self.assertIsNone(sx._category_bucket("Derivative Income"))
        self.assertIsNone(sx._category_bucket("Trading--Leveraged Equity"))

    def test_share_class_alias_is_a_fallback_not_a_replacement(self):
        # _norm_symbol flattens BRK.B to BRKB, which Yahoo cannot resolve, so a
        # hyphenated spelling is offered as well. The symbol as stored is always
        # tried first -- the alias is only reached when that returns nothing, so
        # a genuine four-letter ticker never pays for it.
        self.assertEqual(sx._yahoo_symbol("BRKB")[0], "BRKB")
        self.assertIn("BRK-B", sx._yahoo_symbol("BRKB"))
        self.assertEqual(sx._yahoo_symbol("NVDA")[0], "NVDA")
        self.assertEqual(sx._yahoo_symbol("SPYI"), ["SPYI"])


class _FakeCefApp:
    """Stands in for app.py's CEF Connect reader."""

    def __init__(self, rows):
        self._rows = rows

    def _cef_portfolio_characteristics(self, _ticker):
        return {"top_sectors": {"rows": self._rows}}


class CefConnectTests(unittest.TestCase):
    """CEF Connect is the source for closed-end funds.

    Measured across the 29 CEFs held here it covers a median 97.1% of each
    fund, against 42.4% for their published top holdings.
    """

    def _with_rows(self, rows):
        fake = _FakeCefApp(rows)
        original = sx._app_module
        sx._app_module = lambda attr: fake
        self.addCleanup(lambda: setattr(sx, "_app_module", original))
        return fake

    def test_super_sector_rows_are_excluded(self):
        # Sensitive / Cyclical / Defensive are Morningstar rollups that already
        # contain the sectors listed beside them. Counting both double-counts
        # the whole fund.
        self._with_rows([
            {"label": "Sensitive (Super Sector)", "value": "60.03%"},
            {"label": "Technology", "value": "38.56%"},
            {"label": "Cyclical (Super Sector)", "value": "24.26%"},
            {"label": "Financial Services", "value": "11.95%"},
        ])
        weights = sx._fetch_cef_sectors("ADX")
        self.assertEqual(weights, {"Information Technology": 38.56, "Financials": 11.95})

    def test_municipal_cef_is_fixed_income_not_an_equity_sector(self):
        # NAD is 99.6% municipal. Charting that as a sector would put a bond
        # fund straight into the equity denominator.
        self._with_rows([
            {"label": "Municipal (Super Sector)", "value": "99.62%"},
            {"label": "US Municipal Tax Advantaged", "value": "99.62%"},
            {"label": "Cash Equivalents", "value": "0.37%"},
        ])
        weights = sx._fetch_cef_sectors("NAD")
        self.assertEqual(weights, {sx.FIXED_INCOME: 99.62, sx.CASH: 0.37})

    def test_every_observed_label_is_classified(self):
        # The full vocabulary seen across the closed-end funds held here. An
        # unmapped label silently becomes Unclassified, so this is the guard
        # against CEF Connect quietly adding a sleeve name.
        equity = ["Technology", "Financial Services", "Consumer Cyclical",
                  "Consumer Defensive", "Healthcare", "Communication Services",
                  "Industrials", "Energy", "Utilities", "Basic Materials",
                  "Real Estate"]
        non_equity = {
            "Cash Equivalents": sx.CASH,
            "Corporate Bond": sx.FIXED_INCOME,
            "Bank Loan": sx.FIXED_INCOME,
            "US Municipal Tax Advantaged": sx.FIXED_INCOME,
            "Government Related": sx.FIXED_INCOME,
            "Government": sx.FIXED_INCOME,
            "Agency Mortgage Backed": sx.FIXED_INCOME,
            "Non Agency Residential Mortgage Backed": sx.FIXED_INCOME,
            "Asset Backed": sx.FIXED_INCOME,
            "Convertible": sx.FIXED_INCOME,
            "Municipal": sx.FIXED_INCOME,
            "Preferred Stock": sx.FIXED_INCOME,
            "Swap": sx.DERIVATIVES,
        }
        for label in equity:
            self.assertIn(sx._cef_bucket(label), sx.SECTOR_SET, label)
        for label, bucket in non_equity.items():
            self.assertEqual(sx._cef_bucket(label), bucket, label)

    def test_leveraged_fund_over_100_percent_still_reconciles(self):
        # PTY reports 164.7% because the weights are percent of *net* assets.
        # The position is still worth what it is worth.
        self._with_rows([
            {"label": "Corporate Bond", "value": "120.00%"},
            {"label": "Technology", "value": "44.71%"},
        ])
        conn = _memory_db()
        _add_position(conn, "PTY", 10000)
        _set_profile(conn, "PTY", "sectors",
                     sx._fetch_cef_sectors("PTY"), source="cefconnect_sectors")
        out = sx.build_sector_exposure(conn, None)
        charted = sum(r["value"] for r in out["sectors"] + out["other"])
        self.assertAlmostEqual(charted, 10000.0, places=2)

    def test_no_cef_connect_data_falls_back_to_constituents(self):
        # FSCO returns an empty grid. The fund still has to resolve somehow.
        self._with_rows([])
        self.assertEqual(sx._fetch_cef_sectors("FSCO"), {})
        conn = _memory_db()
        _add_position(conn, "FSCO", 10000)
        _add_fund(conn, "FSCO", [("NVDA", "NVIDIA Corp", 100.0)])
        _set_profile(conn, "FSCO", "none", source="cef_guard")
        _set_profile(conn, "NVDA", "sectors", {"Information Technology": 100.0})
        out = sx.build_sector_exposure(conn, None)
        self.assertEqual([r["name"] for r in out["sectors"]], ["Information Technology"])


class BuildTests(unittest.TestCase):
    def test_buckets_sum_to_the_portfolio(self):
        conn = _memory_db()
        _add_position(conn, "SPYX", 10000)
        _set_profile(conn, "SPYX", "sectors",
                     {"Information Technology": 60.0, "Financials": 40.0})
        out = sx.build_sector_exposure(conn, None)
        charted = sum(r["value"] for r in out["sectors"] + out["other"])
        self.assertAlmostEqual(charted, out["total_value"], places=2)

    def test_negative_weights_are_kept_not_dropped(self):
        # Holdings files carry short and financing lines at negative weight.
        # Discarding them makes the buckets sum to more than the portfolio,
        # by an amount small enough to be mistaken for rounding.
        conn = _memory_db()
        _add_position(conn, "LEV", 10000)
        _add_fund(conn, "LEV", [
            ("AAPL", "Apple Inc", 110.0),
            ("", "Cash collateral payable", -10.0),
        ])
        _set_profile(conn, "AAPL", "sectors", {"Information Technology": 100.0})
        out = sx.build_sector_exposure(conn, None)
        charted = sum(r["value"] for r in out["sectors"] + out["other"])
        self.assertAlmostEqual(charted, out["total_value"], places=2)

    def test_sector_percentages_span_the_equity_sleeve(self):
        conn = _memory_db()
        _add_position(conn, "STK", 5000)
        _add_position(conn, "BND", 5000)
        _set_profile(conn, "STK", "sectors", {"Health Care": 100.0})
        _set_profile(conn, "BND", "asset", asset_class=sx.FIXED_INCOME)
        out = sx.build_sector_exposure(conn, None)
        self.assertAlmostEqual(sum(r["sector_pct"] for r in out["sectors"]), 100.0, places=2)
        self.assertAlmostEqual(out["equity_pct"], 50.0, places=2)
        self.assertAlmostEqual(out["non_equity_pct"], 50.0, places=2)

    def test_bond_fund_stays_out_of_the_sector_denominator(self):
        # The whole reason sectors are reported against the equity sleeve: a
        # bond fund in the denominator quietly deflates every sector weight.
        conn = _memory_db()
        _add_position(conn, "STK", 5000)
        _add_position(conn, "BND", 15000)
        _set_profile(conn, "STK", "sectors", {"Energy": 100.0})
        _set_profile(conn, "BND", "asset", asset_class=sx.FIXED_INCOME)
        out = sx.build_sector_exposure(conn, None)
        energy = next(r for r in out["sectors"] if r["name"] == "Energy")
        self.assertAlmostEqual(energy["sector_pct"], 100.0, places=2)
        self.assertAlmostEqual(energy["portfolio_pct"], 25.0, places=2)
        self.assertEqual([r["name"] for r in out["other"]], [sx.FIXED_INCOME])

    def test_undisclosed_remainder_becomes_unclassified(self):
        # An issuer publishing only its top holdings is a ceiling. The gap is
        # charted rather than spread across the names that happen to be known.
        conn = _memory_db()
        _add_position(conn, "PARTIAL", 10000)
        _add_fund(conn, "PARTIAL", [("AAPL", "Apple Inc", 40.0)])
        _set_profile(conn, "AAPL", "sectors", {"Information Technology": 100.0})
        out = sx.build_sector_exposure(conn, None)
        tech = next(r for r in out["sectors"] if r["name"] == "Information Technology")
        unclassified = next(r for r in out["other"] if r["name"] == sx.UNCLASSIFIED)
        self.assertAlmostEqual(tech["portfolio_pct"], 40.0, places=2)
        self.assertAlmostEqual(unclassified["portfolio_pct"], 60.0, places=2)

    def test_fund_sector_weights_beat_the_constituent_rollup(self):
        # A published breakdown covers the whole fund, including the part the
        # holdings file never discloses.
        conn = _memory_db()
        _add_position(conn, "FUND", 10000)
        _add_fund(conn, "FUND", [("AAPL", "Apple Inc", 30.0)])
        _set_profile(conn, "AAPL", "sectors", {"Information Technology": 100.0})
        _set_profile(conn, "FUND", "sectors", {"Energy": 100.0},
                     source="yahoo_fund_sectors")
        out = sx.build_sector_exposure(conn, None)
        self.assertEqual([r["name"] for r in out["sectors"]], ["Energy"])
        self.assertEqual(out["other"], [])

    def test_closed_end_fund_resolves_through_constituents(self):
        # ADX and friends report sector='Financial Services' from their own
        # quote because that is what the wrapper looks like. Measured on a real
        # portfolio that was 21% of value landing in the wrong sector.
        conn = _memory_db()
        _add_position(conn, "ADX", 10000)
        _add_fund(conn, "ADX", [
            ("NVDA", "NVIDIA Corp", 50.0),
            ("XOM", "Exxon Mobil Corp", 50.0),
        ])
        _set_profile(conn, "NVDA", "sectors", {"Information Technology": 100.0})
        _set_profile(conn, "XOM", "sectors", {"Energy": 100.0})
        # The guard stores no usable profile for the CEF itself.
        _set_profile(conn, "ADX", "none", source="cef_guard")
        out = sx.build_sector_exposure(conn, None)
        names = {r["name"]: r["portfolio_pct"] for r in out["sectors"]}
        self.assertAlmostEqual(names["Information Technology"], 50.0, places=2)
        self.assertAlmostEqual(names["Energy"], 50.0, places=2)
        self.assertNotIn("Financials", names)

    def test_direct_and_through_fund_are_reported_separately(self):
        conn = _memory_db()
        _add_position(conn, "NVDA", 2000)
        _add_position(conn, "FUND", 8000)
        _set_profile(conn, "NVDA", "sectors", {"Information Technology": 100.0},
                     source="yahoo_quote")
        _set_profile(conn, "FUND", "sectors", {"Information Technology": 100.0},
                     source="yahoo_fund_sectors")
        out = sx.build_sector_exposure(conn, None)
        tech = next(r for r in out["sectors"] if r["name"] == "Information Technology")
        self.assertAlmostEqual(tech["direct_pct"], 20.0, places=2)
        by_ticker = {c["ticker"]: c for c in tech["contributors"]}
        self.assertTrue(by_ticker["NVDA"]["direct"])
        self.assertFalse(by_ticker["FUND"]["direct"])

    def test_economic_exposure_wins_over_filed_holdings(self):
        # KGLD files three T-bill rows and is a gold fund. Read literally the
        # portfolio looks like cash.
        conn = _memory_db()
        _add_position(conn, "KGLD", 10000)
        _add_fund(conn, "KGLD", [("", "US Treasury Bill 0% 09/03/26", 100.0)])
        conn.execute(
            "INSERT INTO fund_exposure_map (fund_ticker, symbol, name, exposure_pct, asset_class, source) "
            "VALUES ('KGLD','','Gold',100.0,'Commodities','seed')"
        )
        conn.commit()
        out = sx.build_sector_exposure(conn, None, mode="economic")
        self.assertEqual([r["name"] for r in out["other"]], [sx.COMMODITIES])
        literal = sx.build_sector_exposure(conn, None, mode="literal")
        self.assertEqual([r["name"] for r in literal["other"]], [sx.CASH])

    def test_position_with_nothing_known_is_unclassified(self):
        conn = _memory_db()
        _add_position(conn, "MYSTERY", 10000)
        out = sx.build_sector_exposure(conn, None)
        self.assertEqual(out["unresolved_positions"], 1)
        self.assertEqual([r["name"] for r in out["other"]], [sx.UNCLASSIFIED])
        self.assertEqual(out["sectors"], [])

    def test_empty_portfolio_does_not_divide_by_zero(self):
        conn = _memory_db()
        out = sx.build_sector_exposure(conn, None)
        self.assertEqual(out["total_value"], 0)
        self.assertEqual(out["sectors"], [])
        self.assertEqual(out["concentration"]["level"], "unknown")


class ConcentrationTests(unittest.TestCase):
    def test_overweight_is_measured_against_an_even_share(self):
        conn = _memory_db()
        _add_position(conn, "TECHY", 10000)
        _set_profile(conn, "TECHY", "sectors",
                     {"Information Technology": 80.0, "Financials": 20.0})
        conc = sx.build_sector_exposure(conn, None)["concentration"]
        self.assertEqual(conc["top_sector"], "Information Technology")
        self.assertEqual(conc["level"], "high")
        # Even weight across 11 sectors is 9.09%, so 80% is 8.8x that.
        top = next(o for o in conc["overweight"] if o["name"] == "Information Technology")
        self.assertAlmostEqual(top["times_even"], 8.8, places=1)

    def test_evenly_spread_portfolio_is_not_flagged(self):
        conn = _memory_db()
        _add_position(conn, "SPREAD", 11000)
        _set_profile(conn, "SPREAD", "sectors", {s: 100.0 / 11 for s in sx.SECTORS})
        conc = sx.build_sector_exposure(conn, None)["concentration"]
        self.assertEqual(conc["level"], "low")
        self.assertEqual(conc["overweight"], [])
        self.assertEqual(conc["covered"], 11)


class RefreshTargetTests(unittest.TestCase):
    def test_constituents_are_skipped_for_funds_that_publish_sectors(self):
        # Sizing both passes at once asked for 4,069 lookups on a real
        # portfolio where a few hundred were needed: on an empty cache no fund
        # looks resolved yet, so every one of them had its holdings chased.
        conn = _memory_db()
        _add_position(conn, "FUND", 10000)
        _add_fund(conn, "FUND", [("AAPL", "Apple Inc", 50.0), ("MSFT", "Microsoft", 50.0)])
        _set_profile(conn, "FUND", "sectors", {"Information Technology": 100.0})
        self.assertEqual(sx._constituent_targets(conn, None, False), [])

    def test_constituents_are_chased_when_the_fund_cannot_answer(self):
        conn = _memory_db()
        _add_position(conn, "CEFX", 10000)
        _add_fund(conn, "CEFX", [("AAPL", "Apple Inc", 50.0), ("MSFT", "Microsoft", 50.0)])
        _set_profile(conn, "CEFX", "none", source="cef_guard")
        self.assertEqual(sorted(sx._constituent_targets(conn, None, False)),
                         ["AAPL", "MSFT"])

    def test_cash_and_derivative_rows_are_never_looked_up(self):
        conn = _memory_db()
        _add_position(conn, "OPT", 10000)
        _add_fund(conn, "OPT", [
            ("AAPL", "Apple Inc", 60.0),
            ("", "US Treasury Bill 0% 09/03/26", 20.0),
            ("", "SPX 12/18/2026 5000 C", 20.0),
        ])
        _set_profile(conn, "OPT", "none")
        self.assertEqual(sx._constituent_targets(conn, None, False), ["AAPL"])

    def test_positions_needing_a_profile_are_listed(self):
        conn = _memory_db()
        _add_position(conn, "KNOWN", 5000)
        _add_position(conn, "NEW", 5000)
        _set_profile(conn, "KNOWN", "sectors", {"Energy": 100.0})
        self.assertEqual(sx._position_targets(conn, None, False), ["NEW"])
        self.assertEqual(sorted(sx._position_targets(conn, None, True)), ["KNOWN", "NEW"])


if __name__ == "__main__":
    unittest.main()
