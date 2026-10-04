"""Named watchlists, the flat scanner projection, and TDAQ lookup."""

import datetime
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import database
from watchlist_lists import (
    HISTORY_FIELDS,
    QUOTE_FIELDS,
    apply_import,
    create_watchlist,
    delete_watchlist,
    ensure_watchlist_schema,
    fetch_watchlists,
    merge_market_cache,
    read_market_cache,
    select_lookup_results,
)
from watchlist_market import daily_change_pct, five_year_dividend_growth, quote_yield_pct


class WatchlistListsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.conn = sqlite3.connect(self.tmp.name)
        self.conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(self.conn)

    def tearDown(self):
        self.conn.close()
        Path(self.tmp.name).unlink(missing_ok=True)

    def test_legacy_watchlist_becomes_the_home_list(self):
        self.conn.execute(
            "INSERT INTO watchlist_watching (ticker, notes, sort_order) VALUES ('TDAQ', 'income', 0)"
        )
        self.conn.commit()
        ensure_watchlist_schema(self.conn)
        lists = fetch_watchlists(self.conn)
        self.assertEqual(len(lists), 1)
        self.assertTrue(lists[0]["is_default"])
        self.assertEqual(lists[0]["name"], "Watchlist")
        self.assertEqual(lists[0]["items"][0]["ticker"], "TDAQ")
        self.assertEqual(lists[0]["items"][0]["notes"], "income")

    def test_each_list_keeps_its_symbols_and_scanners_see_both(self):
        home = create_watchlist(self.conn, "Growth", tickers=["SCHG"])
        other = create_watchlist(
            self.conn,
            "Jims picks",
            tickers=[{"ticker": "TDAQ", "name": "TappAlpha Innovation 100 Growth & Daily Income ETF"}],
        )
        self.conn.commit()
        self.assertTrue(home["is_default"])
        self.assertFalse(other["is_default"])
        self.assertEqual([item["ticker"] for item in other["items"]], ["TDAQ"])
        flat = [
            row["ticker"]
            for row in self.conn.execute(
                "SELECT ticker FROM watchlist_watching ORDER BY ticker"
            ).fetchall()
        ]
        self.assertEqual(flat, ["SCHG", "TDAQ"])

    def test_replacing_the_home_list_leaves_the_other_list(self):
        create_watchlist(self.conn, "Growth", tickers=["SCHG"])
        create_watchlist(self.conn, "Jims picks", tickers=["TDAQ"])
        apply_import(self.conn, [{"ticker": "QQQI", "notes": "nasdaq income"}], replace=True)
        self.conn.commit()
        lists = {entry["name"]: [item["ticker"] for item in entry["items"]] for entry in fetch_watchlists(self.conn)}
        self.assertEqual(lists["Growth"], ["QQQI"])
        self.assertEqual(lists["Jims picks"], ["TDAQ"])

    def test_deleting_the_home_list_promotes_the_next_one(self):
        home = create_watchlist(self.conn, "Growth", tickers=["SCHG"])
        create_watchlist(self.conn, "Jims picks", tickers=["TDAQ"])
        delete_watchlist(self.conn, home["id"])
        self.conn.commit()
        lists = fetch_watchlists(self.conn)
        self.assertEqual([entry["name"] for entry in lists], ["Jims picks"])
        self.assertTrue(lists[0]["is_default"])

    def test_tdaq_lookup_is_the_tappalpha_etf(self):
        hits = [
            {"symbol": "005935.KS", "name": "Samsung Electronics Co., Ltd.", "issuer": ""},
            {"symbol": "AMD.BA", "name": "Advanced Micro Devices, Inc.", "issuer": ""},
            {"symbol": "000660.KS", "name": "SK hynix Inc.", "issuer": ""},
            {"symbol": "V.BA", "name": "Visa Inc.", "issuer": ""},
        ]
        results = select_lookup_results("tdaq", hits)
        self.assertEqual([hit["symbol"] for hit in results], ["TDAQ"])
        self.assertEqual(results[0]["issuer"], "TappAlpha")
        self.assertIn("Innovation 100", results[0]["name"])

    def test_market_cache_keeps_quote_fields_when_history_arrives(self):
        merge_market_cache(
            self.conn,
            {"TDAQ": {"name": "TappAlpha Innovation 100 Growth & Daily Income ETF", "price": 27.24, "change_1d": 0.07}},
            QUOTE_FIELDS,
        )
        merge_market_cache(
            self.conn,
            {"TDAQ": {"div_growth_5y": None, "nav_erosion_prob": "Low", "cov_sig": "BUY"}},
            HISTORY_FIELDS,
        )
        self.conn.commit()
        cached = read_market_cache(self.conn, ["TDAQ"])["TDAQ"]
        self.assertEqual(cached["price"], 27.24)
        self.assertEqual(cached["nav_erosion_prob"], "Low")
        self.assertNotIn("signal", cached)
        self.assertTrue({"signal", "ao_sig", "rsi_sig", "macd_sig", "sma50_sig", "sma200_sig", "sharpe", "sortino"}.isdisjoint(QUOTE_FIELDS + HISTORY_FIELDS))

    def test_five_year_growth_and_daily_change(self):
        import pandas as pd

        years = [2018, 2019, 2020, 2021, 2022, 2023]
        values = [1.0 * (1.1 ** index) for index in range(len(years))]
        series = pd.Series(values, index=pd.to_datetime([f"{year}-12-15" for year in years]))
        growth = five_year_dividend_growth(series, today=datetime.date(2026, 10, 3))
        self.assertAlmostEqual(growth, 10.0, places=1)
        self.assertEqual(daily_change_pct(55.55, 55.461), 0.16)
        self.assertEqual(quote_yield_pct(0.0009, 14.2), 14.2)
        self.assertEqual(quote_yield_pct(0.0814, None), 8.14)
        self.assertEqual(quote_yield_pct(None, 0.37), 0.37)
        self.assertIsNone(five_year_dividend_growth(pd.Series([1.0], index=pd.to_datetime(["2024-06-01"]))))

    def test_quote_yield_comes_from_payments_not_the_quote_field(self):
        # Yahoo's quote reports dividendYield 0.09 for QQQI, a fund paying
        # roughly 13%. The payments it actually made are the evidence.
        import types
        import pandas as pd
        import watchlist_market

        today = pd.Timestamp.today().normalize()
        months = pd.date_range(end=today, periods=12, freq="30D")
        paid = pd.Series([0.62] * 12, index=months)
        seen = {}

        def expected(symbol, price, dividends):
            seen["args"] = (symbol, price, len(dividends))
            return round(float(dividends.sum()) / price * 100, 2), "trailing_12_month"

        fake_app = types.SimpleNamespace(
            _yf_ticker=lambda symbol: symbol,
            _cached_yf_dividends=lambda obj, symbol: paid,
            _expected_annual_distribution_yield_pct=expected,
        )
        value = watchlist_market.distribution_yield_pct(fake_app, "QQQI", 56.08)
        self.assertEqual(seen["args"], ("QQQI", 56.08, 12))
        self.assertAlmostEqual(value, 13.27, places=2)
        # No price, no payments, or a failing lookup all fall through to the
        # quote field instead of raising.
        self.assertIsNone(watchlist_market.distribution_yield_pct(fake_app, "QQQI", None))
        fake_app._expected_annual_distribution_yield_pct = lambda *a: (None, None)
        self.assertIsNone(watchlist_market.distribution_yield_pct(fake_app, "QQQI", 56.08))
        fake_app._cached_yf_dividends = lambda obj, symbol: 1 / 0
        self.assertIsNone(watchlist_market.distribution_yield_pct(fake_app, "QQQI", 56.08))

    def test_clearing_home_promotes_another_list(self):
        from watchlist_lists import update_watchlist

        home = create_watchlist(self.conn, "Growth", tickers=["SCHG"])
        other = create_watchlist(self.conn, "Jims picks", tickers=["TDAQ"])
        update_watchlist(self.conn, home["id"], {"is_default": False})
        self.conn.commit()
        lists = {entry["name"]: entry["is_default"] for entry in fetch_watchlists(self.conn)}
        self.assertFalse(lists["Growth"])
        self.assertTrue(lists["Jims picks"])
        self.assertEqual(other["name"], "Jims picks")


class WatchlistRoutesTest(unittest.TestCase):
    """Flask routes against a temporary database, including the TDAQ lookup."""

    def setUp(self):
        import app as app_module

        self.app_module = app_module
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        conn = self._get_connection()
        database.ensure_tables_exist(conn)
        conn.close()
        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.app_module.get_connection = self._orig_get_connection
        self.app_module.app.testing = self._orig_testing
        self.app_module.app._db_initialized = self._orig_db_init
        Path(self.tmp.name).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.tmp.name)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def test_create_lookup_and_add_tdaq(self):
        created = self.client.post(
            "/api/watchlists",
            json={"name": "Jims picks", "icon": "rocket", "color": "#7c8cff", "tickers": []},
        )
        self.assertEqual(created.status_code, 200, created.get_data(as_text=True))
        list_id = created.get_json()["list"]["id"]
        self.assertTrue(created.get_json()["list"]["is_default"])

        lookup = self.client.get("/api/watchlist/lookup?q=TDAQ")
        self.assertEqual(lookup.status_code, 200, lookup.get_data(as_text=True))
        results = lookup.get_json()["results"]
        self.assertTrue(results)
        self.assertEqual(results[0]["symbol"], "TDAQ")
        self.assertIn("Innovation 100", results[0]["name"])
        self.assertEqual(results[0]["issuer"], "TappAlpha")
        self.assertFalse(any("." in hit["symbol"] for hit in results))

        added = self.client.post(
            f"/api/watchlists/{list_id}/items",
            json={"ticker": "TDAQ", "name": results[0]["name"]},
        )
        self.assertEqual(added.status_code, 200, added.get_data(as_text=True))

        listed = self.client.get("/api/watchlists")
        self.assertEqual(listed.status_code, 200)
        body = listed.get_json()
        self.assertEqual(body["lists"][0]["items"][0]["ticker"], "TDAQ")
        self.assertIn("Innovation 100", body["lists"][0]["items"][0]["name"])
        self.assertNotIn("signal", body.get("market", {}).get("TDAQ", {}))
