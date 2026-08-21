import sqlite3
import unittest

from snowball_assign import apply_snowball_assignment, parse_snowball_category_label


class SnowballAssignTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                target_pct REAL,
                profile_id INTEGER,
                sort_order INTEGER
            );
            CREATE TABLE subcategories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER,
                name TEXT,
                target_pct REAL,
                profile_id INTEGER,
                sort_order INTEGER
            );
            CREATE TABLE ticker_categories (
                ticker TEXT,
                category_id INTEGER,
                subcategory_id INTEGER,
                profile_id INTEGER
            );
            """
        )

    def tearDown(self):
        self.conn.close()

    def test_parse_slash_and_plain_labels(self):
        self.assertEqual(
            parse_snowball_category_label("GROWTH / Growth-Stocks"),
            ("GROWTH", "Growth-Stocks"),
        )
        self.assertEqual(parse_snowball_category_label("CASH"), ("CASH", ""))
        self.assertEqual(parse_snowball_category_label("  "), ("", ""))

    def test_slash_label_writes_parent_child_and_subcategory_id(self):
        stats = apply_snowball_assignment(self.conn, 1, "WMT", "GROWTH / Growth-Stocks")
        self.assertTrue(stats["category_created"])
        self.assertTrue(stats["subcategory_created"])
        self.assertTrue(stats["assignment_added"])

        row = self.conn.execute(
            """SELECT c.name AS category, s.name AS subcategory, tc.subcategory_id
               FROM ticker_categories tc
               JOIN categories c ON c.id = tc.category_id
               LEFT JOIN subcategories s ON s.id = tc.subcategory_id
               WHERE tc.ticker = 'WMT' AND tc.profile_id = 1"""
        ).fetchone()
        self.assertEqual(row["category"], "GROWTH")
        self.assertEqual(row["subcategory"], "Growth-Stocks")
        self.assertIsNotNone(row["subcategory_id"])

    def test_plain_label_has_no_subcategory(self):
        apply_snowball_assignment(self.conn, 1, "ICSH", "CASH")
        row = self.conn.execute(
            "SELECT subcategory_id FROM ticker_categories WHERE ticker = 'ICSH'"
        ).fetchone()
        self.assertIsNone(row["subcategory_id"])

    def test_preserve_existing_does_not_overwrite_other_parent(self):
        apply_snowball_assignment(self.conn, 1, "ARCC", "Legacy Income")
        stats = apply_snowball_assignment(
            self.conn, 1, "ARCC", "BDC", preserve_existing_assignment=True
        )
        self.assertTrue(stats["assignment_preserved"])
        name = self.conn.execute(
            """SELECT c.name FROM ticker_categories tc
               JOIN categories c ON c.id = tc.category_id
               WHERE tc.ticker = 'ARCC'"""
        ).fetchone()[0]
        self.assertEqual(name, "Legacy Income")

    def test_matching_parent_fills_missing_subcategory_id(self):
        apply_snowball_assignment(self.conn, 1, "WMT", "GROWTH")
        stats = apply_snowball_assignment(
            self.conn, 1, "WMT", "GROWTH / Growth-Stocks", preserve_existing_assignment=True
        )
        self.assertTrue(stats["assignment_added"])
        row = self.conn.execute(
            """SELECT s.name FROM ticker_categories tc
               JOIN subcategories s ON s.id = tc.subcategory_id
               WHERE tc.ticker = 'WMT'"""
        ).fetchone()
        self.assertEqual(row[0], "Growth-Stocks")

    def test_new_sort_orders_advance_past_zero(self):
        apply_snowball_assignment(self.conn, 1, "AAA", "GROWTH / Stocks")
        apply_snowball_assignment(self.conn, 1, "BBB", "INCOME / Bonds")
        apply_snowball_assignment(self.conn, 1, "CCC", "GROWTH / Funds")

        categories = self.conn.execute(
            "SELECT name, sort_order FROM categories ORDER BY id"
        ).fetchall()
        subcategories = self.conn.execute(
            """SELECT name, sort_order FROM subcategories
               WHERE category_id = (SELECT id FROM categories WHERE name = 'GROWTH')
               ORDER BY id"""
        ).fetchall()

        self.assertEqual([(row["name"], row["sort_order"]) for row in categories], [
            ("GROWTH", 0),
            ("INCOME", 1),
        ])
        self.assertEqual([(row["name"], row["sort_order"]) for row in subcategories], [
            ("Stocks", 0),
            ("Funds", 1),
        ])


if __name__ == "__main__":
    unittest.main()
