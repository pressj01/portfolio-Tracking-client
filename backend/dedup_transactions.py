"""One-off repair: remove duplicate transactions created by overlapping imports.

A duplicate is a transaction that matches another on
(profile_id, ticker, transaction_date, transaction_type, shares-to-4dp) with a
near-identical price (<=1% relative difference) but was inserted by a *different*
import run (different created_at). Genuine same-day multi-fills always share a
single created_at batch and are therefore never touched.

Within each match group the earliest row (lowest id) is kept; later re-imported
copies are deleted. transaction_lot_allocations rows cascade-delete via FK.

Run with --apply to perform deletions; default is a dry run (report only).
"""
import sqlite3
import sys
from collections import defaultdict

DB = r"C:\Users\Press\Portfolio_Tracking_client\backend\portfolio.db"
PRICE_TOL = 0.01  # 1% relative price tolerance


def find_duplicates(conn):
    rows = conn.execute(
        """SELECT id, profile_id, ticker, transaction_date, transaction_type,
                  shares, price_per_share, created_at
           FROM transactions
           ORDER BY profile_id, ticker, transaction_date, transaction_type,
                    ROUND(shares,4), id"""
    ).fetchall()

    groups = defaultdict(list)
    for r in rows:
        key = (r["profile_id"], r["ticker"], r["transaction_date"],
               r["transaction_type"], round(r["shares"] or 0, 4))
        groups[key].append(r)

    delete_ids = []          # ids to remove
    pairs = []               # (kept_id, deleted_id) for audit
    for key, grp in groups.items():
        if len(grp) < 2:
            continue
        # A row is a re-import duplicate when an already-kept row from a
        # STRICTLY EARLIER import batch matches it on price. Keeping only the
        # earliest-batch member of each price cluster removes every later
        # re-imported copy (handles triplicates) while never deleting two rows
        # from the same batch (legitimate same-day multi-fills are preserved).
        kept = []
        for r in grp:  # ascending id order
            price = r["price_per_share"] or 0
            batch = r["created_at"]
            match = None
            for k in kept:
                if not (k["created_at"] < batch):
                    continue  # only an earlier batch can make r a duplicate
                kp = k["price_per_share"] or 0
                hi = max(abs(price), abs(kp), 1e-9)
                if abs(price - kp) / hi <= PRICE_TOL:
                    match = k
                    break
            if match is not None:
                delete_ids.append(r["id"])
                pairs.append((match["id"], r["id"]))
            else:
                kept.append(r)
    return delete_ids, pairs


def main():
    apply = "--apply" in sys.argv
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")

    total_before = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    delete_ids, pairs = find_duplicates(conn)

    # Breakdown by profile and type
    by_profile = defaultdict(int)
    by_type = defaultdict(int)
    if delete_ids:
        ph = ",".join("?" * len(delete_ids))
        for r in conn.execute(
            f"SELECT profile_id, transaction_type FROM transactions WHERE id IN ({ph})",
            delete_ids,
        ):
            by_profile[r["profile_id"]] += 1
            by_type[r["transaction_type"]] += 1

    # affected (ticker, profile) for DRIP recompute
    affected = set()
    if delete_ids:
        ph = ",".join("?" * len(delete_ids))
        for r in conn.execute(
            f"SELECT DISTINCT ticker, profile_id FROM transactions WHERE id IN ({ph})",
            delete_ids,
        ):
            affected.add((r["ticker"], r["profile_id"]))

    print(f"Transactions before: {total_before}")
    print(f"Duplicate rows identified: {len(delete_ids)}")
    print(f"By profile: {dict(sorted(by_profile.items()))}")
    print(f"By type: {dict(by_type)}")
    print(f"Distinct (ticker, profile) affected: {len(affected)}")

    # ASGI focus
    asgi = conn.execute(
        """SELECT id, profile_id, transaction_date, shares, price_per_share, created_at
           FROM transactions WHERE ticker='ASGI' AND profile_id=6 AND transaction_type='BUY'
           ORDER BY id"""
    ).fetchall()
    asgi_del = {i for i in delete_ids}
    print("\nASGI p6 BUY rows (DEL = will be removed):")
    for r in asgi:
        flag = "DEL" if r["id"] in asgi_del else "keep"
        print(f"  [{flag}] id={r['id']} {r['transaction_date']} sh={r['shares']} px={r['price_per_share']} created={r['created_at']}")

    if not apply:
        print("\n--- DRY RUN (no changes). Re-run with --apply to delete. ---")
        conn.close()
        return

    cur = conn.cursor()
    cur.execute("BEGIN")
    ph = ",".join("?" * len(delete_ids))
    cur.execute(f"DELETE FROM transactions WHERE id IN ({ph})", delete_ids)
    deleted = cur.rowcount
    conn.commit()
    total_after = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    print(f"\nDeleted {deleted} rows. Transactions now: {total_after}")

    # Recompute DRIP tracking for affected holdings from the cleaned transactions
    recomputed = 0
    for ticker, pid in affected:
        row = conn.execute(
            "SELECT COALESCE(SUM(shares),0) sh, "
            "COALESCE(SUM(shares*COALESCE(price_per_share,0)),0) cash "
            "FROM transactions WHERE ticker=? AND profile_id=? AND transaction_type='BUY' "
            "AND (notes LIKE '%[DRIP]%' OR LOWER(COALESCE(notes,'')) LIKE '%reinvest%')",
            (ticker, pid),
        ).fetchone()
        drip_shares = float(row["sh"] or 0)
        if drip_shares <= 1e-9:
            continue
        drip_cash = float(row["cash"] or 0)
        h = conn.execute(
            "SELECT quantity FROM all_account_info WHERE ticker=? AND profile_id=?",
            (ticker, pid),
        ).fetchone()
        if not h:
            continue
        qty = float(h["quantity"] or 0)
        if qty > 0 and drip_shares > qty:
            drip_cash *= qty / drip_shares
            drip_shares = qty
        conn.execute(
            "UPDATE all_account_info SET shares_bought_from_dividend=?, total_cash_reinvested=? "
            "WHERE ticker=? AND profile_id=?",
            (round(drip_shares, 6), round(drip_cash, 2), ticker, pid),
        )
        recomputed += 1
    conn.commit()
    print(f"Recomputed DRIP tracking for {recomputed} holdings.")
    conn.close()


if __name__ == "__main__":
    main()
