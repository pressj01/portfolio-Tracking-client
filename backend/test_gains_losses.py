import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import database


class GainsLossesCategoryFilterTest(unittest.TestCase):
    """The Realized and Combined tabs must honour the same holdings filter as
    the Unrealized tab.

    Before this was fixed only the unrealized frame was filtered, so selecting a
    category left every sale ever recorded in the Realized tab and made the
    lifetime cards add a filtered open side to an unfiltered closed side.
    """

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")

        # Two categories, one open holding and one recorded sale in each.
        conn.execute(
            "INSERT INTO categories (id, name, target_pct, profile_id, sort_order) "
            "VALUES (1, 'Metals', 10, 1, 0)"
        )
        conn.execute(
            "INSERT INTO categories (id, name, target_pct, profile_id, sort_order) "
            "VALUES (2, 'Income', 10, 1, 1)"
        )
        for ticker, category_id, quantity, basis, value in [
            ("GLD", 1, 100, 5000, 6000),
            ("JEPI", 2, 200, 4000, 4400),
        ]:
            conn.execute(
                "INSERT INTO all_account_info "
                "(ticker, profile_id, description, classification_type, quantity, "
                " price_paid, purchase_value, original_purchase_value, current_value, "
                " total_divs_received, estim_payment_per_year, div_frequency, "
                " nav_erosion_scope, gain_or_loss_percentage) "
                "VALUES (?, 1, ?, 'ETF', ?, ?, ?, ?, ?, 0, 0, 'M', 'auto', 0)",
                (
                    ticker, f"{ticker} fund", quantity,
                    basis / quantity, basis, basis, value,
                ),
            )
            conn.execute(
                "INSERT INTO ticker_categories (ticker, category_id, profile_id) "
                "VALUES (?, ?, 1)",
                (ticker, category_id),
            )

        # SLV is a fully closed Metals position; QYLD is a closed Income one.
        # Both keep a category assignment even though they are out of holdings.
        for ticker, category_id in [("SLV", 1), ("QYLD", 2)]:
            conn.execute(
                "INSERT INTO ticker_categories (ticker, category_id, profile_id) "
                "VALUES (?, ?, 1)",
                (ticker, category_id),
            )
        conn.execute(
            "INSERT INTO transactions "
            "(profile_id, ticker, transaction_type, transaction_date, shares, "
            " price_per_share, realized_gain, fees) "
            "VALUES (1, 'SLV', 'SELL', '2026-03-02', 50, 30, 250, 0)"
        )
        conn.execute(
            "INSERT INTO transactions "
            "(profile_id, ticker, transaction_type, transaction_date, shares, "
            " price_per_share, realized_gain, fees) "
            "VALUES (1, 'QYLD', 'SELL', '2026-03-09', 100, 18, 400, 0)"
        )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass  # Windows can briefly hold the temp file; best-effort cleanup.

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _summary(self, query=""):
        response = self.client.get(f"/api/gains-losses/summary?profile_id=1{query}")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_unfiltered_summary_reports_both_categories(self):
        payload = self._summary()

        self.assertEqual(
            {row["ticker"] for row in payload["unrealized"]}, {"GLD", "JEPI"},
        )
        self.assertEqual(
            {row["ticker"] for row in payload["realized"]}, {"SLV", "QYLD"},
        )

    def test_category_filter_applies_to_realized_rows(self):
        payload = self._summary("&category=1")

        self.assertEqual({row["ticker"] for row in payload["unrealized"]}, {"GLD"})
        self.assertEqual(
            {row["ticker"] for row in payload["realized"]}, {"SLV"},
            "a sale outside the selected category must not stay in the table",
        )
        self.assertEqual(
            {row["ticker"] for row in payload["combined"]}, {"GLD", "SLV"},
        )

    def test_category_filter_applies_to_realized_totals(self):
        everything = self._summary()["totals"]
        metals = self._summary("&category=1")["totals"]

        # SLV sold 50 shares at 30 for 1500 proceeds on a 250 realized gain.
        self.assertAlmostEqual(metals["realized_proceeds"], 1500.0, places=2)
        self.assertAlmostEqual(metals["realized_price_gl"], 250.0, places=2)
        self.assertLess(
            metals["realized_total_gl"], everything["realized_total_gl"],
            "the filtered realized total must drop the other category's sale",
        )
        # The combined card has to stay internally consistent: it is the sum of
        # the same filtered open and closed sides shown in the tabs.
        self.assertAlmostEqual(
            metals["combined_total_gl"],
            metals["unrealized_total_gl"] + metals["realized_total_gl"],
            places=2,
        )

    def test_subcategory_filter_applies_to_realized_rows(self):
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO subcategories (id, category_id, name, profile_id, sort_order) "
            "VALUES (1, 1, 'Silver', 1, 0)"
        )
        conn.execute(
            "UPDATE ticker_categories SET subcategory_id = 1 WHERE ticker = 'SLV'"
        )
        conn.commit()
        conn.close()

        payload = self._summary("&subcategory=1")

        self.assertEqual({row["ticker"] for row in payload["realized"]}, {"SLV"})
        self.assertEqual(payload["unrealized"], [])


class _NamedTicker:
    """Minimal yfinance stand-in: Yahoo knows this symbol."""

    info = {"longName": "Ark Innovation ETF", "shortName": "ARKK"}


class _DelistedTicker:
    """Yahoo's answer for a dead symbol — an info block with no name in it."""

    info = {}


class _ThrottledTicker:
    """Yahoo's rate limiter: the request raises instead of answering."""

    @property
    def info(self):
        raise RuntimeError("Too Many Requests. Rate limited. Try after a while.")


class ClosedFundDescriptionTest(unittest.TestCase):
    """A fully sold position is deleted from the holdings tables, so its name has
    to be recovered from somewhere else or the Realized and Combined rows render
    a bare ticker with an empty Description column."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')")
        conn.execute(
            "INSERT INTO all_account_info "
            "(ticker, profile_id, description, classification_type, quantity, "
            " price_paid, purchase_value, original_purchase_value, current_value, "
            " total_divs_received, estim_payment_per_year, div_frequency, "
            " nav_erosion_scope, gain_or_loss_percentage) "
            "VALUES ('GLD', 1, 'SPDR Gold Shares', 'ETF', 100, 50, 5000, 5000, 6000, "
            " 0, 0, 'M', 'auto', 0)"
        )
        # Three closed positions, each named by a different local source, plus
        # one delisted symbol no table has ever heard of.
        conn.execute(
            "INSERT INTO etf_provider_funds (provider_id, symbol, fund_name) "
            "VALUES (1, 'ARKK', 'ARK Innovation ETF')"
        )
        conn.execute(
            "INSERT INTO general_scanner_cache (ticker, name) VALUES ('QYLD', 'Global X NASDAQ 100 Covered Call ETF')"
        )
        conn.execute(
            "INSERT INTO fund_holdings (fund_ticker, symbol, name, weight_pct) "
            "VALUES ('SPY', 'ROKU', 'Roku, Inc.', 0.1)"
        )
        for ticker in ("ARKK", "QYLD", "ROKU", "RAD"):
            conn.execute(
                "INSERT INTO transactions "
                "(profile_id, ticker, transaction_type, transaction_date, shares, "
                " price_per_share, realized_gain, fees) "
                "VALUES (1, ?, 'SELL', '2026-03-02', 10, 25, 100, 0)",
                (ticker,),
            )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass  # Windows can briefly hold the temp file; best-effort cleanup.

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _summary(self):
        response = self.client.get("/api/gains-losses/summary?profile_id=1")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_realized_rows_carry_a_description(self):
        by_ticker = {row["ticker"]: row for row in self._summary()["realized"]}

        self.assertEqual(by_ticker["ARKK"]["description"], "ARK Innovation ETF")
        self.assertEqual(
            by_ticker["QYLD"]["description"], "Global X NASDAQ 100 Covered Call ETF",
        )
        self.assertEqual(by_ticker["ROKU"]["description"], "Roku, Inc.")

    def test_combined_rows_name_closed_positions(self):
        by_ticker = {row["ticker"]: row for row in self._summary()["combined"]}

        self.assertEqual(by_ticker["ARKK"]["status"], "Closed")
        self.assertEqual(by_ticker["ARKK"]["description"], "ARK Innovation ETF")
        self.assertEqual(by_ticker["GLD"]["description"], "SPDR Gold Shares")
        self.assertEqual(
            by_ticker["RAD"]["description"], "",
            "a symbol no source knows must stay blank rather than break the row",
        )

    def test_cached_name_wins_over_every_other_source(self):
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO security_names (ticker, name, source) "
            "VALUES ('RAD', 'Rite Aid Corporation', 'yfinance')"
        )
        conn.commit()
        conn.close()

        by_ticker = {row["ticker"]: row for row in self._summary()["realized"]}
        self.assertEqual(by_ticker["RAD"]["description"], "Rite Aid Corporation")

    def test_lookup_caches_the_name_it_fetches(self):
        with patch("yfinance.Ticker", return_value=_NamedTicker()) as ticker:
            response = self.client.post(
                "/api/gains-losses/descriptions", json={"tickers": ["nvda"]},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json()["descriptions"], {"NVDA": "Ark Innovation ETF"},
        )
        self.assertEqual(ticker.call_count, 1)

        conn = self._get_connection()
        cached = conn.execute(
            "SELECT name FROM security_names WHERE ticker = 'NVDA'"
        ).fetchone()
        conn.close()
        self.assertEqual(cached["name"], "Ark Innovation ETF")

    def test_lookup_skips_tickers_a_local_table_already_names(self):
        with patch("yfinance.Ticker") as ticker:
            response = self.client.post(
                "/api/gains-losses/descriptions", json={"tickers": ["ARKK"]},
            )
        self.assertEqual(
            response.get_json()["descriptions"], {"ARKK": "ARK Innovation ETF"},
        )
        ticker.assert_not_called()

    def test_a_throttled_request_is_not_cached_as_a_missing_name(self):
        """A rate-limited reply looks exactly like "this fund has no name". Cache
        it and a live ticker renders blank for a month over one busy minute."""
        with patch("yfinance.Ticker", return_value=_ThrottledTicker()):
            response = self.client.post(
                "/api/gains-losses/descriptions", json={"tickers": ["JCE"]},
            )
        self.assertEqual(response.get_json()["unresolved"], ["JCE"])

        conn = self._get_connection()
        cached = conn.execute(
            "SELECT name FROM security_names WHERE ticker = 'JCE'"
        ).fetchone()
        conn.close()
        self.assertIsNone(cached, "a failed request must not be remembered as an answer")

        # The next visit asks again, and this time Yahoo answers.
        with patch("yfinance.Ticker", return_value=_NamedTicker()):
            retry = self.client.post(
                "/api/gains-losses/descriptions", json={"tickers": ["JCE"]},
            )
        self.assertEqual(retry.get_json()["descriptions"], {"JCE": "Ark Innovation ETF"})

    def test_a_delisted_symbol_is_only_looked_up_once(self):
        with patch("yfinance.Ticker", return_value=_DelistedTicker()) as ticker:
            first = self.client.post(
                "/api/gains-losses/descriptions", json={"tickers": ["RAD"]},
            )
            second = self.client.post(
                "/api/gains-losses/descriptions", json={"tickers": ["RAD"]},
            )

        self.assertEqual(first.get_json()["unresolved"], ["RAD"])
        self.assertEqual(second.get_json()["unresolved"], ["RAD"])
        self.assertEqual(
            ticker.call_count, 1,
            "the empty answer must be cached, not re-asked on the next page load",
        )


if __name__ == "__main__":
    unittest.main()
