"""Account-level broker activity recorded for whole-account performance."""

import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import config
import database


SCHWAB_CASH_ACTIVITY = "\n".join([
    "Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount",
    '04/01/2026,MoneyLink Transfer,,"Tfr BANK OF AMERICA, JANE DOE",,,,"$5,000.00"',
    "04/02/2026,Service Fee,,Account maintenance fee,,,,-$5.00",
    "04/03/2026,Wire Sent,,JANE DOE DISBURSED,,,,-$1000.00",
]).encode("utf-8")


class AccountActivityImportEndpointTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        conn.execute(
            "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order) "
            "VALUES (1, 'Owner', '', 1, 1), (2, 'Schwab Brokerage', 'schwab', 1, 2)"
        )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_backup = app_module._create_import_backup
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_db_path = config.DB_PATH
        config.DB_PATH = self.db_path
        app_module.get_connection = self._get_connection
        app_module._create_import_backup = lambda profile_id=None: None
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module._create_import_backup = self._orig_backup
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        config.DB_PATH = self._orig_db_path
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _import(self):
        data = {
            "file": (io.BytesIO(SCHWAB_CASH_ACTIVITY), "Schwab_Transactions.csv"),
            "format": "schwab_transactions",
        }
        response = self.client.post(
            "/api/import/transactions?profile_id=2",
            data=data,
            content_type="multipart/form-data",
        )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200, payload)
        return payload

    def test_import_records_each_signed_flow_once(self):
        first = self._import()
        second = self._import()

        self.assertEqual(first["account_activity_inserted"], 3)
        self.assertEqual(second["account_activity_inserted"], 0)
        self.assertEqual(second["account_activity_duplicates_skipped"], 3)
        self.assertIn("Nothing new to import", second["message"])

        conn = self._get_connection()
        try:
            rows = [
                tuple(row) for row in conn.execute(
                    "SELECT activity_date, activity_type, performance_treatment, base_amount "
                    "FROM account_activity WHERE profile_id = 2 ORDER BY activity_date"
                ).fetchall()
            ]
            owner_rows = conn.execute(
                "SELECT COUNT(*) FROM account_activity WHERE profile_id = 1"
            ).fetchone()[0]
        finally:
            conn.close()

        self.assertEqual(rows, [
            ("2026-04-01", "TRANSFER_IN", "EXTERNAL_FLOW", 5000.0),
            ("2026-04-02", "FEE", "EXPENSE", -5.0),
            ("2026-04-03", "WITHDRAWAL", "EXTERNAL_FLOW", -1000.0),
        ])
        self.assertEqual(owner_rows, 0)


if __name__ == "__main__":
    unittest.main()
