"""WAL-safe SQLite backup and restore.

Copying a live WAL database with shutil.copy2 only captures portfolio.db.
Uncheckpointed pages stay in portfolio.db-wal, and a restore that leaves those
sidecars in place will replay old writes onto the restored copy.

Use SQLite's backup() API for a consistent snapshot, checkpoint, then replace
the destination atomically and drop leftover -wal/-shm files.
"""
from __future__ import annotations

import os
import sqlite3


_SIDECARS = ("-wal", "-shm")


def sidecar_paths(db_path):
    """Return the WAL and SHM paths that belong to db_path."""
    return [db_path + suffix for suffix in _SIDECARS]


def remove_sidecars(db_path):
    """Delete leftover -wal/-shm files so they cannot replay onto db_path."""
    for path in sidecar_paths(db_path):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def _connect(db_path):
    conn = sqlite3.connect(db_path, timeout=60.0)
    conn.execute("PRAGMA busy_timeout=60000")
    return conn


def _checkpoint(conn, mode="TRUNCATE", require_complete=False):
    if require_complete:
        # A restore must fail safely instead of waiting and then deleting a WAL
        # that another connection still needs. These connections are dedicated
        # to one backup/restore operation, so changing their timeout is local.
        conn.execute("PRAGMA busy_timeout=0")
    try:
        result = conn.execute(f"PRAGMA wal_checkpoint({mode})").fetchone()
    except sqlite3.OperationalError:
        if require_complete:
            raise
        return False

    busy = bool(result and result[0])
    log_frames = int(result[1]) if result and result[1] is not None else -1
    checkpointed = int(result[2]) if result and result[2] is not None else -1
    incomplete = log_frames >= 0 and checkpointed >= 0 and checkpointed < log_frames
    if require_complete and (busy or incomplete):
        raise sqlite3.OperationalError(
            "database is busy; close active readers before restoring the backup"
        )
    return not (busy or incomplete)


def sqlite_backup(src_path, dest_path):
    """Write a consistent copy of src_path to dest_path.

    The destination is a self-contained database file: WAL pages from the live
    source are folded in via backup(), then the copy is checkpointed so it
    does not need sidecar files.
    """
    if not os.path.isfile(src_path):
        raise FileNotFoundError(src_path)

    dest_dir = os.path.dirname(os.path.abspath(dest_path))
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)

    tmp_path = dest_path + ".tmp"
    remove_sidecars(tmp_path)
    try:
        os.remove(tmp_path)
    except FileNotFoundError:
        pass

    src = _connect(src_path)
    try:
        _checkpoint(src, "PASSIVE")
        dst = _connect(tmp_path)
        try:
            src.backup(dst)
            _checkpoint(dst, "TRUNCATE", require_complete=True)
        finally:
            dst.close()
    finally:
        src.close()

    remove_sidecars(tmp_path)
    os.replace(tmp_path, dest_path)
    remove_sidecars(dest_path)
    return dest_path


def sqlite_restore(backup_path, dest_path):
    """Replace dest_path with backup_path without replaying leftover WAL.

    Copies the backup into a temp file via backup(), checkpoints it, atomically
    replaces the destination, then deletes dest -wal/-shm so an old journal
    cannot replay onto the restored database.
    """
    if not os.path.isfile(backup_path):
        raise FileNotFoundError(backup_path)

    dest_dir = os.path.dirname(os.path.abspath(dest_path))
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)

    tmp_path = dest_path + ".restore_tmp"
    remove_sidecars(tmp_path)
    try:
        os.remove(tmp_path)
    except FileNotFoundError:
        pass

    # Flush the live database so the upcoming replace is not racing a writer.
    if os.path.exists(dest_path):
        live = _connect(dest_path)
        try:
            _checkpoint(live, "TRUNCATE", require_complete=True)
        finally:
            live.close()
        remove_sidecars(dest_path)

    src = _connect(backup_path)
    try:
        dst = _connect(tmp_path)
        try:
            src.backup(dst)
            _checkpoint(dst, "TRUNCATE", require_complete=True)
        finally:
            dst.close()
    finally:
        src.close()

    remove_sidecars(tmp_path)
    try:
        os.replace(tmp_path, dest_path)
    except OSError:
        # File is still locked (typical on Windows while Flask holds a handle).
        # Copy into the live connection instead of replacing the file.
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        remove_sidecars(tmp_path)
        src = _connect(backup_path)
        dst = _connect(dest_path)
        try:
            src.backup(dst)
            _checkpoint(dst, "TRUNCATE", require_complete=True)
        finally:
            src.close()
            dst.close()

    remove_sidecars(dest_path)
    return dest_path
