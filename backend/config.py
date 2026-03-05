import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "portfolio.db")


def get_connection():
    """Return a SQLite connection with WAL mode and foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
