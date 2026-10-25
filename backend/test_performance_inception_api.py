import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as module


class PerformanceInceptionApiTest(unittest.TestCase):
    """The shared range buttons gray out presets older than this date."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(Path(self.temp.name) / "test.db")
        conn = self.connect()
        conn.executescript("""
            CREATE TABLE all_account_info (profile_id INTEGER, ticker TEXT, quantity REAL,
                purchase_date TEXT, import_date TEXT);
            CREATE TABLE transactions (profile_id INTEGER, ticker TEXT, transaction_date TEXT);
            INSERT INTO all_account_info VALUES
                (2, 'AAA', 10, '2023-06-01', NULL),
                (2, 'BBB', 0, '2019-01-02', NULL),
                (2, 'CCC', 5, NULL, '2024-02-01'),
                (3, 'DDD', 5, '2015-03-04', NULL);
            INSERT INTO transactions VALUES
                (2, 'AAA', '2022-04-18'),
                (2, 'AAA', NULL),
                (3, 'DDD', '2014-01-02');
        """)
        conn.commit()
        conn.close()
        for item in (
            patch.object(module, 'get_connection', self.connect),
            patch.object(module.app, '_db_initialized', True, create=True),
        ):
            item.start()
            self.addCleanup(item.stop)
        self.client = module.app.test_client()

    def connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def inception(self, profile_ids):
        with patch.object(module, 'get_profile_filter', return_value=(False, profile_ids)):
            response = self.client.get('/api/performance/inception')
        self.assertEqual(response.status_code, 200)
        return response.get_json()['inception_date']

    def test_earliest_trade_wins_and_closed_positions_purchase_date_is_ignored(self):
        # BBB's 2019 purchase date belongs to a position no longer held; its
        # trades, if any, would be in the transactions table.
        self.assertEqual(self.inception([2]), '2022-04-18')

    def test_an_aggregate_spans_every_member(self):
        self.assertEqual(self.inception([2, 3]), '2014-01-02')

    def test_no_members_has_no_inception(self):
        self.assertIsNone(self.inception([]))


if __name__ == '__main__':
    unittest.main()
