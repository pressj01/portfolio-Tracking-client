import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from db_backup import remove_sidecars, sqlite_backup, sqlite_restore


class SqliteWalBackupRestoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.live = os.path.join(self.dir, "portfolio.db")
        self.backup = os.path.join(self.dir, "backup.db")

    def tearDown(self):
        self.tmp.cleanup()

    def _connect(self, path):
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def test_backup_includes_uncheckpointed_wal_pages(self):
        conn = self._connect(self.live)
        conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        conn.execute("INSERT INTO items (name) VALUES ('old')")
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("INSERT INTO items (name) VALUES ('new')")
        conn.commit()
        # Leave 'new' in the WAL; do not checkpoint before backup.
        conn.close()

        sqlite_backup(self.live, self.backup)

        restored = sqlite3.connect(self.backup)
        names = [row[0] for row in restored.execute("SELECT name FROM items ORDER BY id")]
        restored.close()
        self.assertEqual(names, ["old", "new"])
        self.assertFalse(os.path.exists(self.backup + "-wal"))

    def test_restore_does_not_replay_leftover_destination_wal(self):
        live = self._connect(self.live)
        live.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        live.execute("INSERT INTO items (name) VALUES ('old')")
        live.commit()
        live.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        live.close()

        sqlite_backup(self.live, self.backup)

        live = self._connect(self.live)
        live.execute("INSERT INTO items (name) VALUES ('new')")
        live.commit()
        live.close()

        sqlite_restore(self.backup, self.live)

        self.assertFalse(os.path.exists(self.live + "-wal"))
        self.assertFalse(os.path.exists(self.live + "-shm"))
        conn = sqlite3.connect(self.live)
        names = [row[0] for row in conn.execute("SELECT name FROM items ORDER BY id")]
        conn.close()
        self.assertEqual(names, ["old"])

    def test_remove_sidecars_deletes_wal_and_shm(self):
        Path(self.live + "-wal").write_text("x", encoding="utf-8")
        Path(self.live + "-shm").write_text("y", encoding="utf-8")
        remove_sidecars(self.live)
        self.assertFalse(os.path.exists(self.live + "-wal"))
        self.assertFalse(os.path.exists(self.live + "-shm"))

    def test_restore_aborts_without_removing_a_busy_wal(self):
        live = self._connect(self.live)
        live.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        live.execute("INSERT INTO items (name) VALUES ('old')")
        live.commit()
        live.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        live.close()
        sqlite_backup(self.live, self.backup)

        reader = self._connect(self.live)
        reader.execute("BEGIN")
        reader.execute("SELECT * FROM items").fetchall()
        writer = self._connect(self.live)
        writer.execute("INSERT INTO items (name) VALUES ('new')")
        writer.commit()
        writer.close()
        self.assertTrue(os.path.exists(self.live + "-wal"))

        try:
            with self.assertRaises(sqlite3.OperationalError):
                sqlite_restore(self.backup, self.live)
            self.assertTrue(os.path.exists(self.live + "-wal"))
        finally:
            reader.close()

        conn = sqlite3.connect(self.live)
        names = [row[0] for row in conn.execute("SELECT name FROM items ORDER BY id")]
        conn.close()
        self.assertEqual(names, ["old", "new"])

    def test_backup_does_not_create_a_missing_source_database(self):
        missing = os.path.join(self.dir, "missing.db")
        with self.assertRaises(FileNotFoundError):
            sqlite_backup(missing, self.backup)
        self.assertFalse(os.path.exists(missing))


if __name__ == "__main__":
    unittest.main()
