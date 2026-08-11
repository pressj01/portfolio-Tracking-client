import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
