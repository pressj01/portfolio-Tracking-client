"""Stable identity for equity BUY/SELL rows.

Option executions already store a unique dedupe_hash. Equity transactions only
had an autoincrement id, so re-importing the same file created duplicates
(see dedup_transactions.py). The hash is scoped to a portfolio and uses an
occurrence index so genuine same-day multi-fills stay distinct while a second
import of the same rows collides.
"""
from __future__ import annotations

import hashlib
import sqlite3
from collections import Counter


_IDENTITY_VERSION = "equity-txn-v1"
_STORED_VERSION = "equity-txn-stored-v1"


def _as_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def equity_identity(profile_id, ticker, transaction_type, transaction_date, shares, price_per_share, fees=0):
    """Return the economic identity used for import counting and hashing."""
    return (
        int(profile_id or 0),
        str(ticker or "").strip().upper(),
        str(transaction_type or "BUY").strip().upper(),
        str(transaction_date or "")[:10],
        round(_as_float(shares), 4),
        round(_as_float(price_per_share), 2),
        round(_as_float(fees), 2),
    )


def equity_identity_hash(identity):
    payload = "|".join([_IDENTITY_VERSION, *[str(part) for part in identity]])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def stored_equity_hash(identity_hash, occurrence):
    payload = f"{_STORED_VERSION}|{identity_hash}|{int(occurrence)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def equity_dedupe_hash(profile_id, ticker, transaction_type, transaction_date, shares, price_per_share, fees=0, occurrence=1):
    ident = equity_identity(
        profile_id, ticker, transaction_type, transaction_date, shares, price_per_share, fees
    )
    return stored_equity_hash(equity_identity_hash(ident), occurrence)


def transaction_columns(conn):
    cached = getattr(conn, "_txn_columns", None)
    if cached is not None:
        return cached
    cols = {row[1] for row in conn.execute("PRAGMA table_info(transactions)")}
    try:
        conn._txn_columns = cols
    except Exception:
        pass
    return cols


def transactions_have_dedupe_hash(conn):
    return "dedupe_hash" in transaction_columns(conn)


def next_equity_occurrence(conn, identity, exclude_id=None):
    """Return the first unused occurrence index for identity (1-based).

    Counting matching rows is not sufficient: deleting occurrence 1 while
    occurrence 2 remains would choose 2 again and collide with the unique
    dedupe index. Looking at the stored hashes reuses gaps safely.
    """
    sql = (
        "SELECT dedupe_hash FROM transactions "
        "WHERE profile_id = ? AND UPPER(TRIM(ticker)) = ? "
        "AND UPPER(TRIM(COALESCE(transaction_type, 'BUY'))) = ? "
        "AND COALESCE(SUBSTR(transaction_date, 1, 10), '') = ? "
        "AND ABS(COALESCE(shares, 0) - ?) < 0.0001 "
        "AND ABS(COALESCE(price_per_share, 0) - ?) < 0.01 "
        "AND ABS(COALESCE(fees, 0) - ?) < 0.01"
    )
    params = list(identity)
    if exclude_id is not None:
        sql += " AND id != ?"
        params.append(exclude_id)
    rows = conn.execute(sql, params).fetchall()
    used_hashes = {
        row["dedupe_hash"] if isinstance(row, sqlite3.Row) else row[0]
        for row in rows
        if (row["dedupe_hash"] if isinstance(row, sqlite3.Row) else row[0])
    }
    identity_hash = equity_identity_hash(identity)
    occurrence = 1
    while stored_equity_hash(identity_hash, occurrence) in used_hashes:
        occurrence += 1
    return occurrence


def insert_equity_transaction(
    conn,
    ticker,
    profile_id,
    transaction_type="BUY",
    transaction_date=None,
    shares=0,
    price_per_share=None,
    fees=0,
    notes=None,
    realized_gain=None,
    acquired_date=None,
    dedupe_hash=None,
    occurrence=None,
):
    """Insert a BUY/SELL row and return its id, or None on a hash collision."""
    ident = equity_identity(
        profile_id, ticker, transaction_type, transaction_date, shares, price_per_share, fees
    )
    cols = transaction_columns(conn)
    has_hash = "dedupe_hash" in cols
    if has_hash and not dedupe_hash:
        if occurrence is None:
            occurrence = next_equity_occurrence(conn, ident)
        dedupe_hash = stored_equity_hash(equity_identity_hash(ident), occurrence)

    wanted = [
        ("ticker", str(ticker or "").strip().upper()),
        ("profile_id", profile_id),
        ("transaction_type", str(transaction_type or "BUY").strip().upper()),
        ("transaction_date", transaction_date),
        ("shares", shares),
        ("price_per_share", price_per_share),
        ("fees", fees or 0),
        ("notes", notes),
        ("realized_gain", realized_gain),
        ("acquired_date", acquired_date),
        ("dedupe_hash", dedupe_hash),
    ]
    columns = []
    values = []
    for name, value in wanted:
        if name in cols:
            columns.append(name)
            values.append(value)

    placeholders = ", ".join("?" * len(columns))
    sql = f"INSERT INTO transactions ({', '.join(columns)}) VALUES ({placeholders})"
    try:
        cur = conn.execute(sql, values)
    except sqlite3.IntegrityError:
        # Only a collision on our dedupe hash means "already imported". Do
        # not hide unrelated NOT NULL, CHECK, or foreign-key violations.
        if has_hash and dedupe_hash:
            collision = conn.execute(
                "SELECT 1 FROM transactions WHERE dedupe_hash = ? LIMIT 1",
                (dedupe_hash,),
            ).fetchone()
            if collision:
                return None
        raise
    return cur.lastrowid


def refresh_transaction_dedupe_hash(conn, txn_id):
    """Recompute dedupe_hash after an edit. Keep the hash when identity is unchanged."""
    if not transactions_have_dedupe_hash(conn):
        return
    row = conn.execute(
        """SELECT id, profile_id, ticker, transaction_type, transaction_date,
                  shares, price_per_share, fees, dedupe_hash
           FROM transactions WHERE id = ?""",
        (txn_id,),
    ).fetchone()
    if not row:
        return
    ident = equity_identity(
        row["profile_id"] if isinstance(row, sqlite3.Row) else row[1],
        row["ticker"] if isinstance(row, sqlite3.Row) else row[2],
        row["transaction_type"] if isinstance(row, sqlite3.Row) else row[3],
        row["transaction_date"] if isinstance(row, sqlite3.Row) else row[4],
        row["shares"] if isinstance(row, sqlite3.Row) else row[5],
        row["price_per_share"] if isinstance(row, sqlite3.Row) else row[6],
        row["fees"] if isinstance(row, sqlite3.Row) else row[7],
    )
    current = row["dedupe_hash"] if isinstance(row, sqlite3.Row) else row[8]
    occurrence = next_equity_occurrence(conn, ident, exclude_id=txn_id)
    new_hash = stored_equity_hash(equity_identity_hash(ident), occurrence)
    if current == new_hash:
        return
    try:
        conn.execute("UPDATE transactions SET dedupe_hash = ? WHERE id = ?", (new_hash, txn_id))
    except sqlite3.IntegrityError:
        # Notes-only edits of a same-day multi-fill keep the existing hash.
        if current:
            return
        fallback = hashlib.sha256(f"equity-txn-id|{txn_id}".encode("utf-8")).hexdigest()
        conn.execute("UPDATE transactions SET dedupe_hash = ? WHERE id = ?", (fallback, txn_id))


def backfill_equity_dedupe_hashes(conn):
    """Fill NULL dedupe_hash values in id order, then safe to create the unique index."""
    if not transactions_have_dedupe_hash(conn):
        return 0
    rows = conn.execute(
        """SELECT id, profile_id, ticker, transaction_type, transaction_date,
                  shares, price_per_share, fees, dedupe_hash
           FROM transactions
           ORDER BY id"""
    ).fetchall()
    counts = Counter()
    updated = 0
    for row in rows:
        if isinstance(row, sqlite3.Row):
            txn_id = row["id"]
            ident = equity_identity(
                row["profile_id"], row["ticker"], row["transaction_type"],
                row["transaction_date"], row["shares"], row["price_per_share"], row["fees"],
            )
            existing = row["dedupe_hash"]
        else:
            txn_id = row[0]
            ident = equity_identity(row[1], row[2], row[3], row[4], row[5], row[6], row[7])
            existing = row[8]
        counts[ident] += 1
        if existing:
            continue
        stored = stored_equity_hash(equity_identity_hash(ident), counts[ident])
        try:
            conn.execute("UPDATE transactions SET dedupe_hash = ? WHERE id = ?", (stored, txn_id))
        except sqlite3.IntegrityError:
            fallback = hashlib.sha256(f"equity-txn-id|{txn_id}".encode("utf-8")).hexdigest()
            conn.execute("UPDATE transactions SET dedupe_hash = ? WHERE id = ?", (fallback, txn_id))
        updated += 1
    return updated
