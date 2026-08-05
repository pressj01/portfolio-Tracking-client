import sqlite3
import sys
import unittest
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import diversification as dv
from database import ensure_tables_exist


def _memory_db():
    conn = sqlite3.connect(":memory:")
    ensure_tables_exist(conn)
    return conn


def _add_position(conn, ticker, value, profile_id=1):
    conn.execute(
        "INSERT INTO holdings (profile_id, ticker, quantity, current_value) VALUES (?,?,?,?)",
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


def _by_key(result, key):
    for row in result["constituents"]:
        if row["key"] == key:
            return row
    return None


class LookThroughAggregationTest(unittest.TestCase):
    def test_same_stock_across_two_funds_merges_into_one_slice(self):
        conn = _memory_db()
        _add_position(conn, "FUNDA", 1000)
        _add_position(conn, "FUNDB", 1000)
        _add_fund(conn, "FUNDA", [("NVDA", "NVIDIA Corp", 50.0), ("AAPL", "Apple Inc", 50.0)])
        _add_fund(conn, "FUNDB", [("NVDA", "NVIDIA Corp", 100.0)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        nvda = _by_key(result, "NVDA")
        self.assertIsNotNone(nvda)
        # 50% of 1000 + 100% of 1000
        self.assertAlmostEqual(nvda["value"], 1500.0, places=2)
        self.assertAlmostEqual(nvda["weight_pct"], 75.0, places=2)

    def test_uncovered_remainder_is_reported_not_normalised_away(self):
        """A top-25 list covering 40% must leave 60% visible as Undisclosed."""
        conn = _memory_db()
        _add_position(conn, "PARTIAL", 1000)
        _add_fund(conn, "PARTIAL", [("NVDA", "NVIDIA Corp", 40.0)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        nvda = _by_key(result, "NVDA")
        undisclosed = _by_key(result, "UNDISCLOSED::PARTIAL")
        self.assertAlmostEqual(nvda["value"], 400.0, places=2)
        self.assertIsNotNone(undisclosed)
        self.assertAlmostEqual(undisclosed["value"], 600.0, places=2)
        self.assertEqual(undisclosed["kind"], "undisclosed")
        self.assertAlmostEqual(result["coverage"]["undisclosed_pct"], 60.0, places=2)

    def test_economic_mode_overrides_treasury_collateral_with_real_exposure(self):
        """KGLD files T-bills but is economically gold -- literal must not win."""
        conn = _memory_db()
        _add_position(conn, "KGLD", 1000)
        _add_fund(conn, "KGLD", [("B0122426", "B 0 12.24.26", 100.0)])
        conn.execute(
            "INSERT INTO fund_exposure_map (fund_ticker, symbol, name, exposure_pct, asset_class, source) "
            "VALUES ('KGLD','','Gold',100.0,'Commodities','seed')"
        )
        conn.commit()

        literal = dv.build_diversification(conn, None, xray=True, mode="literal")
        economic = dv.build_diversification(conn, None, xray=True, mode="economic")

        # Literal: the bill collateral groups as cash, not as a bogus equity.
        self.assertIsNotNone(_by_key(literal, "CASH"))
        self.assertIsNone(_by_key(literal, "NAME::GOLD"))

        gold = _by_key(economic, "NAME::GOLD")
        self.assertIsNotNone(gold)
        self.assertAlmostEqual(gold["value"], 1000.0, places=2)

    def test_manual_rows_survive_a_resolve_pass(self):
        conn = _memory_db()
        _add_position(conn, "MUTFUND", 500)
        conn.execute(
            "INSERT INTO fund_holdings (fund_ticker, symbol, name, weight_pct, source) "
            "VALUES ('MUTFUND','MSFT','Microsoft Corp',80.0,'manual')"
        )
        conn.commit()

        meta = dv.resolve_fund("MUTFUND", conn)
        self.assertEqual(meta["status"], "manual")
        self.assertAlmostEqual(meta["coverage_pct"], 80.0, places=2)

        result = dv.build_diversification(conn, None, xray=True, mode="economic")
        self.assertAlmostEqual(_by_key(result, "MSFT")["value"], 400.0, places=2)
        self.assertAlmostEqual(_by_key(result, "UNDISCLOSED::MUTFUND")["value"], 100.0, places=2)

    def test_xray_off_reports_positions_as_held(self):
        conn = _memory_db()
        _add_position(conn, "FUNDA", 750)
        _add_fund(conn, "FUNDA", [("NVDA", "NVIDIA Corp", 100.0)])

        result = dv.build_diversification(conn, None, xray=False)

        self.assertEqual(len(result["constituents"]), 1)
        self.assertEqual(result["constituents"][0]["key"], "FUNDA")
        self.assertAlmostEqual(result["constituents"][0]["weight_pct"], 100.0, places=2)

    def test_name_only_cef_rows_merge_with_symbol_rows(self):
        """CEF Connect publishes names without tickers; they must still group."""
        conn = _memory_db()
        _add_position(conn, "ETFX", 1000)   # has symbols
        _add_position(conn, "CEFX", 1000)   # names only
        _add_fund(conn, "ETFX", [("NVDA", "NVIDIA CORP", 100.0)])
        _add_fund(conn, "CEFX", [("", "NVIDIA Corp", 100.0)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        nvda = _by_key(result, "NVDA")
        self.assertIsNotNone(nvda)
        self.assertAlmostEqual(nvda["value"], 2000.0, places=2)

    def test_scope_limits_positions_to_selected_profiles(self):
        conn = _memory_db()
        _add_position(conn, "AAA", 1000, profile_id=1)
        _add_position(conn, "BBB", 4000, profile_id=2)

        self.assertAlmostEqual(
            dv.build_diversification(conn, [1], xray=False)["total_value"], 1000.0, places=2
        )
        self.assertAlmostEqual(
            dv.build_diversification(conn, [1, 2], xray=False)["total_value"], 5000.0, places=2
        )


class NestedFundTest(unittest.TestCase):
    def test_wrapper_expands_to_underlying_companies(self):
        """TSPY-style wrapper holding ~100% of one ETF must show that ETF's stocks."""
        conn = _memory_db()
        _add_position(conn, "WRAP", 1000)
        _add_fund(conn, "WRAP", [("BIGETF", "Big Index ETF", 100.0)])
        _add_fund(conn, "BIGETF", [("NVDA", "NVIDIA Corp", 60.0), ("AAPL", "Apple Inc", 40.0)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        self.assertIsNone(_by_key(result, "BIGETF"), "wrapper's ETF should not remain a leaf")
        self.assertAlmostEqual(_by_key(result, "NVDA")["value"], 600.0, places=2)
        self.assertAlmostEqual(_by_key(result, "AAPL")["value"], 400.0, places=2)

    def test_partial_weight_wrapper_scales_inner_weights(self):
        conn = _memory_db()
        _add_position(conn, "WRAP", 1000)
        _add_fund(conn, "WRAP", [("BIGETF", "Big Index ETF", 50.0), ("MSFT", "Microsoft", 50.0)])
        _add_fund(conn, "BIGETF", [("NVDA", "NVIDIA Corp", 100.0)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        self.assertAlmostEqual(_by_key(result, "NVDA")["value"], 500.0, places=2)
        self.assertAlmostEqual(_by_key(result, "MSFT")["value"], 500.0, places=2)

    def test_thinly_covered_nested_fund_is_left_intact(self):
        """Expanding a 40%-covered fund would turn known exposure into Undisclosed."""
        conn = _memory_db()
        _add_position(conn, "WRAP", 1000)
        _add_fund(conn, "WRAP", [("THIN", "Thin ETF", 100.0)])
        _add_fund(conn, "THIN", [("NVDA", "NVIDIA Corp", 40.0)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        self.assertIsNotNone(_by_key(result, "THIN"))
        self.assertAlmostEqual(_by_key(result, "THIN")["value"], 1000.0, places=2)

    def test_circular_nesting_terminates(self):
        conn = _memory_db()
        _add_position(conn, "AAA", 1000)
        _add_fund(conn, "AAA", [("BBB", "B Fund", 100.0)])
        _add_fund(conn, "BBB", [("AAA", "A Fund", 100.0)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")
        self.assertGreater(result["total_value"], 0)

    def test_discovers_funds_held_only_inside_other_funds(self):
        conn = _memory_db()
        _add_position(conn, "WRAP", 1000)
        _add_fund(conn, "WRAP", [("VOO", "Vanguard S&P 500", 99.0), ("TINY", "Tiny", 1.0)])

        found = dv._discover_nested_candidates(conn, ["WRAP"])
        self.assertIn("VOO", found)
        self.assertNotIn("TINY", found, "sub-threshold constituents should not be chased")

    def test_xray_off_never_expands(self):
        conn = _memory_db()
        _add_position(conn, "WRAP", 1000)
        _add_fund(conn, "WRAP", [("BIGETF", "Big Index ETF", 100.0)])
        _add_fund(conn, "BIGETF", [("NVDA", "NVIDIA Corp", 100.0)])

        result = dv.build_diversification(conn, None, xray=False)
        self.assertEqual([r["key"] for r in result["constituents"]], ["WRAP"])


class IssuerLookupTest(unittest.TestCase):
    def setUp(self):
        self.conn = _memory_db()
        dv._seed_issuers(self.conn)

    def test_url_template_substitutes_both_case_forms(self):
        self.conn.execute(
            "INSERT OR REPLACE INTO fund_issuers (issuer_key, label, url_template, parser, enabled) "
            "VALUES ('demo','Demo','https://x.com/{ticker_lower}/{ticker}.csv','generic_csv',1)"
        )
        self.conn.execute(
            "INSERT OR REPLACE INTO fund_issuer_map (fund_ticker, issuer_key) VALUES ('ABC','demo')"
        )
        self.conn.commit()

        key, parser, url = dv._issuer_for(self.conn, "ABC")
        self.assertEqual(key, "demo")
        self.assertEqual(url, "https://x.com/abc/ABC.csv")

    def test_url_driven_parsers_actually_receive_the_url(self):
        """Regression: html_table was called without a URL and always returned []."""
        seen = {}

        def spy(ticker, limit=None, url=None):
            seen["url"] = url
            return [{"symbol": "NVDA", "name": "NVIDIA Corp", "weight_pct": 100.0}]

        original = dv.PARSERS.get("html_table")
        dv.PARSERS["html_table"] = spy
        try:
            self.conn.execute(
                "INSERT OR REPLACE INTO fund_issuers (issuer_key, label, url_template, parser, enabled) "
                "VALUES ('demo','Demo','https://x.com/{ticker_lower}/','html_table',1)"
            )
            self.conn.execute(
                "INSERT OR REPLACE INTO fund_issuer_map (fund_ticker, issuer_key) VALUES ('ABC','demo')"
            )
            self.conn.commit()

            rows, key = dv._fetch_from_issuer(self.conn, "ABC")
            self.assertEqual(seen.get("url"), "https://x.com/abc/")
            self.assertEqual(key, "demo")
            self.assertEqual(len(rows), 1)
        finally:
            if original is not None:
                dv.PARSERS["html_table"] = original

    def test_per_ticker_url_override_beats_family_template(self):
        """BlackRock keys holdings on a product id, so one template cannot serve all."""
        self.conn.execute(
            "INSERT OR REPLACE INTO fund_issuers (issuer_key, label, url_template, parser, enabled) "
            "VALUES ('demo','Demo','https://x.com/{ticker}.csv','generic_csv',1)"
        )
        self.conn.execute(
            "INSERT OR REPLACE INTO fund_issuer_map (fund_ticker, issuer_key, url_override) "
            "VALUES ('ABC','demo','https://x.com/special/999.csv')"
        )
        self.conn.commit()

        _key, _parser, url = dv._issuer_for(self.conn, "ABC")
        self.assertEqual(url, "https://x.com/special/999.csv")

    def test_family_name_routes_to_issuer_without_manual_mapping(self):
        self.conn.execute(
            "INSERT OR REPLACE INTO fund_issuers (issuer_key, label, url_template, parser, enabled, match_pattern) "
            "VALUES ('demo','Demo','https://x.com/{ticker}.csv','generic_csv',1,'demofunds|demo capital')"
        )
        self.conn.commit()

        original = dv._fund_family_text
        dv._fund_family_text = lambda t: "Demo Capital Growth & Income ETF"
        try:
            self.assertEqual(dv._detect_issuer(self.conn, "ZZZ"), "demo")
        finally:
            dv._fund_family_text = original

        row = self.conn.execute(
            "SELECT issuer_key, source FROM fund_issuer_map WHERE fund_ticker='ZZZ'"
        ).fetchone()
        self.assertEqual((row[0], row[1]), ("demo", "auto"))

    def test_detection_does_not_invent_a_mapping_for_unknown_families(self):
        original = dv._fund_family_text
        dv._fund_family_text = lambda t: "Totally Unaffiliated Trust"
        try:
            self.assertIsNone(dv._detect_issuer(self.conn, "QQQZ"))
        finally:
            dv._fund_family_text = original

    def test_disabled_or_urlless_issuer_is_skipped(self):
        self.conn.execute(
            "INSERT OR REPLACE INTO fund_issuers (issuer_key, label, url_template, parser, enabled) "
            "VALUES ('off','Off','https://x.com/{ticker}.csv','generic_csv',0)"
        )
        self.conn.execute(
            "INSERT OR REPLACE INTO fund_issuer_map (fund_ticker, issuer_key) VALUES ('ABC','off')"
        )
        self.conn.commit()
        self.assertIsNone(dv._issuer_for(self.conn, "ABC"))

    def test_seed_adds_official_override_but_preserves_manual_mapping(self):
        self.conn.execute(
            "UPDATE fund_issuer_map SET issuer_key='kurv', source='manual', "
            "url_override='https://example.test/custom.csv' WHERE fund_ticker='PFFA'"
        )
        self.conn.execute(
            "UPDATE fund_issuer_map SET source='auto', url_override=NULL WHERE fund_ticker='TUGN'"
        )
        self.conn.commit()

        dv._seed_issuers(self.conn)

        pffa = self.conn.execute(
            "SELECT issuer_key, source, url_override FROM fund_issuer_map WHERE fund_ticker='PFFA'"
        ).fetchone()
        tugn = self.conn.execute(
            "SELECT issuer_key, source, url_override FROM fund_issuer_map WHERE fund_ticker='TUGN'"
        ).fetchone()
        self.assertEqual(tuple(pffa), ("kurv", "manual", "https://example.test/custom.csv"))
        self.assertEqual(tugn[0], "shelton")
        self.assertEqual(tugn[1], "seed")
        self.assertIn("tugn-holdings", tugn[2])


class OfficialHoldingsParserTest(unittest.TestCase):
    def test_csv_prefers_percentage_weight_over_dollar_net_assets(self):
        rows = dv._parse_generic_csv_text(
            "Name,Ticker,Net Assets,Weightings\n"
            "Example Corp,EXM,1250000000,61.25%\n"
            "Cash,,794000000,38.75%\n"
        )

        self.assertEqual(len(rows), 2)
        self.assertAlmostEqual(sum(row["weight_pct"] for row in rows), 100.0)
        self.assertEqual(rows[0]["symbol"], "EXM")

    def test_spreadsheet_nan_does_not_become_a_fake_ticker(self):
        rows = dv._records_to_rows([
            {"Ticker": float("nan"), "Security Name": "Cash equivalents", "Weight": -2.5}
        ])

        self.assertEqual(rows[0]["symbol"], "")
        self.assertEqual(rows[0]["name"], "Cash equivalents")

    def test_download_links_accept_vaneck_extensionless_xlsx(self):
        page = (
            '<a href="/us/en/etf/equity/smh/holdings/download/xlsx/">'
            'All Fund Holdings</a>'
            '<a href="/files/smh-nav-history.csv">NAV History</a>'
        )

        links = dv._download_links(
            "https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/holdings/",
            page,
        )

        self.assertEqual(len(links), 1)
        self.assertTrue(links[0].endswith("/holdings/download/xlsx/"))

    def test_avantis_reads_all_embedded_holdings_not_visible_page_only(self):
        payload = (
            '<script>data={etfHoldings:['
            '{name:"Alpha Corp",weight:"60.5%",ticker:"AAA"},'
            '{name:"Beta &amp; Co",weight:"39.5%",ticker:"BBB"}'
            ']}</script>'
        )
        original = dv._http_get
        dv._http_get = lambda *_args, **_kwargs: SimpleNamespace(text=payload)
        try:
            rows = dv._fetch_avantis_holdings("AVUV", url="https://example.test/holdings")
        finally:
            dv._http_get = original

        self.assertEqual([row["symbol"] for row in rows], ["AAA", "BBB"])
        self.assertEqual(rows[1]["name"], "Beta & Co")
        self.assertAlmostEqual(sum(row["weight_pct"] for row in rows), 100.0)

    def test_partial_cached_fund_is_retried_against_issuer(self):
        conn = _memory_db()
        _add_fund(conn, "PARTIAL", [("AAA", "Alpha", 40.0)])
        original_security_type = dv._security_type
        original_fetch = dv._fetch_from_issuer
        dv._security_type = lambda _ticker: "ETF"
        dv._fetch_from_issuer = lambda _conn, _ticker: (
            [
                {"symbol": "AAA", "name": "Alpha", "weight_pct": 40.0},
                {"symbol": "BBB", "name": "Beta", "weight_pct": 60.0},
            ],
            "official",
        )
        try:
            result = dv.resolve_fund("PARTIAL", conn, force=False)
        finally:
            dv._security_type = original_security_type
            dv._fetch_from_issuer = original_fetch

        self.assertNotIn("cached", result)
        self.assertEqual(result["source"], "official")
        self.assertAlmostEqual(result["coverage_pct"], 100.0)

    def test_broker_normalised_preferred_share_is_not_an_undefined_fund(self):
        self.assertEqual(dv._security_type("CODIPRB"), "EQUITY")

    def test_adams_report_schedule_yields_full_portfolio_weights(self):
        report_text = """
        S CHEDULE OF I NVESTMENTS
        June 30, 2026
        Shares Value (a)
        Common Stocks — 90.0%
        Alphabet Inc. Class A 1,000 $ 600,000
        State Street Communication Services Select Sector
        SPDR ETF 2,000 300,000
        Short-Term Investments — 10.0%
        Money Market Funds — 10.0%
        Morgan Stanley Institutional Liquidity Funds Prime
        Portfolio, Institutional Class, 3.69% (e) 100,000 102,000
        Total — 100.0%
        Net Assets — 100.0% $1,000,000
        """

        rows = dv._parse_adams_schedule_text(report_text)

        self.assertEqual(len(rows), 4)
        self.assertAlmostEqual(sum(row["weight_pct"] for row in rows), 100.0)
        self.assertEqual(rows[1]["symbol"], "XLC")
        self.assertIn("Morgan Stanley", rows[2]["name"])
        self.assertAlmostEqual(rows[3]["weight_pct"], -0.2)
        self.assertTrue(all(row["as_of"] == "2026-06-30" for row in rows))


class DerivativeFilterTest(unittest.TestCase):
    def test_option_legs_are_bucketed_not_listed_as_holdings(self):
        conn = _memory_db()
        _add_position(conn, "OPTFUND", 1000)
        _add_fund(conn, "OPTFUND", [
            ("", "Ibit 12/18/2026 35.01 C", 30.0),
            ("", "SPXW US 08/03/26 C7595", 20.0),
            ("NVDA", "NVIDIA Corp", 50.0),
        ])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        self.assertIsNotNone(_by_key(result, "DERIVATIVES"))
        self.assertAlmostEqual(_by_key(result, "DERIVATIVES")["value"], 500.0, places=2)
        self.assertAlmostEqual(_by_key(result, "NVDA")["value"], 500.0, places=2)

    def test_currency_forwards_are_not_treated_as_companies(self):
        conn = _memory_db()
        _add_position(conn, "FXFUND", 1000)
        _add_fund(conn, "FXFUND", [("NOKUSD09162026CURNCY", "NOK/USD 09/16/2026 Curncy", 100.0)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")
        self.assertIsNotNone(_by_key(result, "DERIVATIVES"))

    def test_real_companies_are_not_misfiled_as_derivatives(self):
        for name in ("NVIDIA Corp", "Apple Inc", "Talen Energy Corp.",
                     "Putnam Investments", "Callaway Golf Co"):
            self.assertIsNone(dv._DERIV_PAT.search(name) if "/" in name else None,
                              f"{name} should not match on punctuation alone")
        conn = _memory_db()
        _add_position(conn, "EQFUND", 1000)
        _add_fund(conn, "EQFUND", [("NVDA", "NVIDIA Corp", 100.0)])
        result = dv.build_diversification(conn, None, xray=True, mode="literal")
        self.assertIsNone(_by_key(result, "DERIVATIVES"))
        self.assertAlmostEqual(_by_key(result, "NVDA")["value"], 1000.0, places=2)

    def test_option_collateral_is_separate_from_account_cash(self):
        conn = _memory_db()
        _add_position(conn, "OPTFUND", 1000)
        _add_fund(conn, "OPTFUND", [
            ("B0090326", "United States Treasury Bill", 40.0),
            ("FGXXX", "First American Government Obligations Fund", 40.0),
            ("", "SPXW US 08/03/26 C7595", 20.0),
        ])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        collateral = _by_key(result, "COLLATERAL")
        self.assertIsNotNone(collateral)
        self.assertAlmostEqual(collateral["value"], 800.0, places=2)
        self.assertIsNone(_by_key(result, "CASH"))
        self.assertEqual(collateral["contributors"][0]["ticker"], "OPTFUND")

    def test_depositary_receipt_company_is_not_cash(self):
        conn = _memory_db()
        _add_position(conn, "GLOBAL", 1000)
        _add_fund(conn, "GLOBAL", [
            ("ARM", "Arm Holdings plc American Depositary Shares", 100.0),
        ])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        self.assertIsNone(_by_key(result, "CASH"))
        self.assertAlmostEqual(_by_key(result, "ARM")["value"], 1000.0, places=2)


class GapKindTest(unittest.TestCase):
    """A partially-disclosed fund and a fund with no data are different problems."""

    def test_partial_coverage_reports_undisclosed_not_undefined(self):
        conn = _memory_db()
        _add_position(conn, "TOPTEN", 1000)
        _add_fund(conn, "TOPTEN", [("NVDA", "NVIDIA Corp", 48.4)])

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        gap = _by_key(result, "UNDISCLOSED::TOPTEN")
        self.assertIsNotNone(gap)
        self.assertEqual(gap["kind"], "undisclosed")
        self.assertIsNone(_by_key(result, "UNDEFINED::TOPTEN"))
        self.assertEqual(result["coverage"]["undefined_pct"], 0.0)
        self.assertGreater(result["coverage"]["undisclosed_pct"], 0)

    def test_fund_with_no_data_reports_undefined(self):
        conn = _memory_db()
        _add_position(conn, "MYSTERY", 1000)

        result = dv.build_diversification(conn, None, xray=True, mode="literal")

        gap = _by_key(result, "UNDEFINED::MYSTERY")
        self.assertIsNotNone(gap)
        self.assertEqual(gap["kind"], "undefined")
        self.assertAlmostEqual(result["coverage"]["undefined_pct"], 100.0, places=2)
        self.assertEqual(result["coverage"]["unresolved_funds"], 1)


class PackagedFallbackTest(unittest.TestCase):
    def test_app_fetchers_are_reused_from_frozen_main_module(self):
        """PyInstaller exposes app.py as __main__, not as importable app."""
        original_main = sys.modules.get("__main__")
        fake_main = SimpleNamespace(
            _fetch_stockanalysis_top_holdings=lambda ticker, limit=None: [
                {"symbol": "AAA", "name": "Alpha", "weight_pct": 50.0},
                {"symbol": "BBB", "name": "Beta", "weight_pct": 30.0},
                {"symbol": "CCC", "name": "Gamma", "weight_pct": 20.0},
            ],
        )
        sys.modules["__main__"] = fake_main
        try:
            rows, source = dv._fetch_via_app("TEST")
        finally:
            if original_main is None:
                sys.modules.pop("__main__", None)
            else:
                sys.modules["__main__"] = original_main

        self.assertEqual(source, "stockanalysis")
        self.assertEqual([row["symbol"] for row in rows], ["AAA", "BBB", "CCC"])
        self.assertAlmostEqual(sum(row["weight_pct"] for row in rows), 100.0)


class SymbolNormalisationTest(unittest.TestCase):
    def test_share_class_punctuation_collapses(self):
        self.assertEqual(dv._norm_symbol("BRK.B"), dv._norm_symbol("BRK-B"))
        self.assertEqual(dv._norm_symbol("BRK.B"), "BRKB")

    def test_placeholder_symbols_are_dropped(self):
        for junk in ("-", "n/a", "N/A", "None", "--"):
            self.assertEqual(dv._norm_symbol(junk), "")

    def test_issuer_name_variants_normalise_together(self):
        self.assertEqual(dv._norm_name("NVIDIA CORP"), dv._norm_name("NVIDIA Corp."))
        self.assertEqual(dv._norm_name("Alphabet Inc Class A"), dv._norm_name("ALPHABET INC CL A"))


if __name__ == "__main__":
    unittest.main()
