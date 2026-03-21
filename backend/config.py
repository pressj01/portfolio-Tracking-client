import sqlite3
import os
import shutil

# When running inside Electron, PORTFOLIO_DB_DIR points to the user-data
# folder (%APPDATA%/Portfolio Tracking Client) so the database survives
# app updates.  In dev mode the env var is unset and we fall back to the
# backend/ directory.
_db_dir = os.environ.get("PORTFOLIO_DB_DIR") or os.path.dirname(__file__)
DB_PATH = os.path.join(_db_dir, "portfolio.db")

# One-time migration: if the database exists in the old location (inside the
# app bundle) but not yet in the user-data folder, copy it over so existing
# data is preserved after the first update.
_old_db = os.path.join(os.path.dirname(__file__), "portfolio.db")
if (
    os.environ.get("PORTFOLIO_DB_DIR")
    and _old_db != DB_PATH
    and os.path.exists(_old_db)
    and not os.path.exists(DB_PATH)
):
    os.makedirs(_db_dir, exist_ok=True)
    shutil.copy2(_old_db, DB_PATH)


def get_connection():
    """Return a SQLite connection with WAL mode and foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
