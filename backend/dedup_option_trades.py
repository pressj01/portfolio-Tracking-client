"""Remove exact option-trade copies caused by choosing Generic after a broker import.

By default, only a Generic trade whose trade fields, legs, and execution ledger
exactly match an existing non-Generic broker-import trade in the same portfolio
is selected. ``--all-generic`` selects every Generic option-trade import. The
default mode is a dry run. ``--apply`` creates a SQLite backup before deleting
the selected trades and their cascading leg/execution rows.
"""

from __future__ import annotations

import argparse
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from config import DB_PATH


def _normalized_number(value, places=6):
    return round(float(value or 0), places)


def _trade_signature(conn, trade):
    legs = conn.execute(
        """SELECT option_type, position_side, expiration, strike, contracts,
                  multiplier, status
             FROM option_trade_legs
            WHERE trade_id = ?""",
        (trade["id"],),
    ).fetchall()
    executions = conn.execute(
        """SELECT e.action, e.executed_at, e.contracts, e.price, e.fees,
                  l.option_type, l.position_side, l.expiration, l.strike,
                  l.multiplier
             FROM option_executions e
             JOIN option_trade_legs l ON l.id = e.leg_id
            WHERE e.trade_id = ?""",
        (trade["id"],),
    ).fetchall()
    leg_signature = tuple(sorted(
        (
            row["option_type"],
            row["position_side"],
            str(row["expiration"] or "")[:10],
            _normalized_number(row["strike"], 4),
            int(row["contracts"] or 0),
            int(row["multiplier"] or 100),
            row["status"],
        )
        for row in legs
    ))
    execution_signature = tuple(sorted(
        (
            row["action"],
            str(row["executed_at"] or "")[:10],
            int(row["contracts"] or 0),
            _normalized_number(row["price"]),
            _normalized_number(row["fees"], 2),
            row["option_type"],
            row["position_side"],
            str(row["expiration"] or "")[:10],
            _normalized_number(row["strike"], 4),
            int(row["multiplier"] or 100),
        )
        for row in executions
    ))
    return (
        int(trade["profile_id"]),
        str(trade["underlying"] or "").upper(),
        trade["strategy_type"],
        trade["purpose"],
        trade["status"],
        str(trade["opened_at"] or "")[:10],
        str(trade["closed_at"] or "")[:10],
        int(trade["limited_history"] or 0),
        _normalized_number(trade["summary_realized_pnl"], 2)
        if trade["summary_realized_pnl"] is not None else None,
        leg_signature,
        execution_signature,
    )


def find_duplicate_trades(conn):
    trades = conn.execute(
        """SELECT id, profile_id, underlying, strategy_type, purpose, status,
                  opened_at, closed_at, limited_history, summary_realized_pnl,
                  source_format
             FROM option_trades
            WHERE source = 'broker_import'
            ORDER BY id"""
    ).fetchall()
    groups = defaultdict(list)
    for trade in trades:
        groups[_trade_signature(conn, trade)].append(trade)

    duplicates = []
    for matches in groups.values():
        broker = next(
            (row for row in matches if str(row["source_format"] or "") not in {"", "generic"}),
            None,
        )
        if broker is None:
            continue
        for row in matches:
            if row["id"] != broker["id"] and row["source_format"] == "generic":
                duplicates.append({
                    "keep_id": int(broker["id"]),
                    "delete_id": int(row["id"]),
                    "profile_id": int(row["profile_id"]),
                    "underlying": row["underlying"],
                    "opened_at": row["opened_at"],
                })
    return duplicates


def find_all_generic_trades(conn):
    rows = conn.execute(
        """SELECT id, profile_id, underlying, opened_at
             FROM option_trades
            WHERE source = 'broker_import' AND source_format = 'generic'
            ORDER BY id"""
    ).fetchall()
    return [
        {
            "keep_id": None,
            "delete_id": int(row["id"]),
            "profile_id": int(row["profile_id"]),
            "underlying": row["underlying"],
            "opened_at": row["opened_at"],
        }
        for row in rows
    ]


def _backup_database(conn, db_path):
    backup_dir = db_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"portfolio_pre_option_dedupe_{timestamp}.db"
    backup_conn = sqlite3.connect(backup_path)
    try:
        conn.backup(backup_conn)
    finally:
        backup_conn.close()
    return backup_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=DB_PATH, help="SQLite portfolio database path")
    parser.add_argument("--apply", action="store_true", help="Back up the database and delete selected trades")
    parser.add_argument(
        "--all-generic",
        action="store_true",
        help="Select every Generic option-trade import, including unmatched trades",
    )
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.is_file():
        raise SystemExit(f"Database does not exist: {db_path}")

    conn = sqlite3.connect(db_path, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=60000")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        duplicates = (
            find_all_generic_trades(conn)
            if args.all_generic
            else find_duplicate_trades(conn)
        )
        target_label = "Generic option-trade imports" if args.all_generic else "Exact Generic duplicate trades"
        print(f"Database: {db_path}")
        print(f"{target_label}: {len(duplicates)}")
        for row in duplicates:
            keep = f" -> keep {row['keep_id']}" if row["keep_id"] is not None else ""
            print(
                f"  delete {row['delete_id']}{keep} | profile {row['profile_id']} | "
                f"{row['underlying']} | {row['opened_at']}"
            )

        if not args.apply:
            print("Dry run only; no data changed. Re-run with --apply to clean the database.")
            return
        if not duplicates:
            print("No changes needed.")
            return

        backup_path = _backup_database(conn, db_path)
        delete_ids = [row["delete_id"] for row in duplicates]
        placeholders = ",".join("?" for _ in delete_ids)
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute(
            f"DELETE FROM option_trades WHERE id IN ({placeholders})",
            delete_ids,
        )
        if cursor.rowcount != len(delete_ids):
            conn.rollback()
            raise RuntimeError(
                f"Expected to delete {len(delete_ids)} trades, deleted {cursor.rowcount}; rolled back"
            )
        conn.commit()
        print(f"Backup: {backup_path}")
        print(f"Deleted {cursor.rowcount} selected option trades.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
