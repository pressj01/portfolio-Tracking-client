"""Remove duplicate projected dividend payments.

Refresh Prices & Divs records a projected distribution into ``dividend_payments``
with source ``refresh_estimate``. Until the accompanying fix in app.py, that
writer deduped only on an exact (ticker, profile_id, payment_date) match, so:

  * every refresh that projected a moved pay date inserted ANOTHER row for the
    same distribution, and
  * a projection was never cleared when the broker's real payment arrived on a
    different date.

The result is one distribution recorded two or three times. This script clusters
each holding's payments into distribution periods and, within a period, keeps a
real payment over any projection and at most one projection otherwise. It only
ever deletes ``refresh_estimate`` rows; recorded broker payments are untouched.

Usage:
    py repair_dividend_estimates.py --dry-run
    py repair_dividend_estimates.py --apply
"""

import argparse
import datetime
import os
import shutil
import sqlite3
import sys
from collections import defaultdict

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "portfolio.db")

ESTIMATE_SOURCE = "refresh_estimate"

# Half-width of the window that identifies "the same distribution", kept under
# half the payout period so consecutive real distributions stay separate. Mirrors
# _DISTRIBUTION_WINDOW_DAYS in app.py; test_dividend_estimate_dedupe.py asserts
# the two stay in sync.
WINDOW_DAYS = {"W": 3, "BW": 6, "SM": 6, "M": 12, "Q": 40, "SA": 75, "A": 150}
DEFAULT_WINDOW_DAYS = 12

# Median spacing (days) between real payments -> frequency, used when a holding
# has no div_frequency recorded. Bounds are midpoints between payout periods.
INFERRED_FREQUENCY_BOUNDS = ((10, "W"), (20, "BW"), (45, "M"), (135, "Q"), (270, "SA"))


def window_days(frequency):
    return WINDOW_DAYS.get(str(frequency or "").strip().upper(), DEFAULT_WINDOW_DAYS)


# Two brokers settle one distribution a few days apart, so pooled dates need
# near-duplicates collapsed before they can describe a payout cadence.
SAME_EVENT_DAYS = 5


def collapse_events(dates):
    """Collapse dates that describe the same distribution into one event."""
    events = []
    for d in sorted(dates):
        if not events or (d - events[-1]).days > SAME_EVENT_DAYS:
            events.append(d)
    return events


def infer_frequency(dates):
    """Infer payout frequency from the median gap between real payments.

    Payout cadence is a property of the fund, so callers pool a ticker's real
    payments across every account: a holding on its own rarely has the three
    payments needed, and the recorded div_frequency is often wrong (OVL is filed
    as quarterly in six profiles while paying monthly in all of them).
    """
    events = collapse_events(dates)
    if len(events) < 3:
        return None
    gaps = sorted((events[i] - events[i - 1]).days for i in range(1, len(events)))
    median = gaps[len(gaps) // 2]
    for bound, freq in INFERRED_FREQUENCY_BOUNDS:
        if median <= bound:
            return freq
    return "A"


def parse_date(value):
    try:
        return datetime.date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def cluster_periods(rows, window):
    """Group date-sorted rows into distribution periods.

    Each cluster is anchored on its first row so a long run of nearby rows can't
    chain into one oversized period.
    """
    clusters = []
    for row in rows:
        if clusters and (row["date"] - clusters[-1][0]["date"]).days <= window:
            clusters[-1].append(row)
        else:
            clusters.append([row])
    return clusters


def find_duplicates(conn):
    """Return (rows_to_delete, stats) without modifying anything."""
    freq_by_key = {}
    for r in conn.execute(
        "SELECT ticker, profile_id, div_frequency FROM all_account_info "
        "WHERE div_frequency IS NOT NULL"
    ):
        freq_by_key.setdefault((r["profile_id"], str(r["ticker"]).upper()), r["div_frequency"])

    payments = defaultdict(list)
    for r in conn.execute(
        "SELECT id, ticker, profile_id, payment_date, amount, source "
        "FROM dividend_payments ORDER BY payment_date, id"
    ):
        d = parse_date(r["payment_date"])
        if d is None:
            continue
        payments[(r["profile_id"], str(r["ticker"]).upper())].append({
            "id": r["id"],
            "date": d,
            "amount": float(r["amount"] or 0),
            "source": str(r["source"] or "").strip().lower(),
        })

    # Pool each ticker's real payments across accounts so cadence can be read
    # even from a holding that has only one or two payments of its own.
    real_dates_by_ticker = defaultdict(set)
    for (_pid, ticker), rows in payments.items():
        for row in rows:
            if row["source"] != ESTIMATE_SOURCE:
                real_dates_by_ticker[ticker].add(row["date"])
    observed_by_ticker = {
        ticker: infer_frequency(list(dates))
        for ticker, dates in real_dates_by_ticker.items()
    }

    doomed = []
    stats = {
        "superseded_by_real": 0,
        "duplicate_estimates": 0,
        "inferred_frequency": 0,
        "narrowed_by_observed": 0,
    }
    for key, rows in payments.items():
        rows.sort(key=lambda r: (r["date"], r["id"]))
        # Trust what the holding actually paid over its recorded div_frequency,
        # which goes stale: OVL is filed as quarterly but pays monthly, and a
        # quarterly window is wide enough to swallow two real monthly payments.
        # Take the narrower of the two so a wrong label can only ever make the
        # repair more conservative.
        recorded = freq_by_key.get(key)
        observed = observed_by_ticker.get(key[1])
        if observed and not recorded:
            stats["inferred_frequency"] += 1
        elif observed and recorded and window_days(observed) < window_days(recorded):
            stats["narrowed_by_observed"] += 1
        candidates = [window_days(f) for f in (recorded, observed) if f]
        window = min(candidates) if candidates else DEFAULT_WINDOW_DAYS

        for cluster in cluster_periods(rows, window):
            estimates = [r for r in cluster if r["source"] == ESTIMATE_SOURCE]
            if not estimates:
                continue
            has_real = any(r["source"] != ESTIMATE_SOURCE for r in cluster)
            if has_real:
                drop = estimates
                stats["superseded_by_real"] += len(drop)
            elif len(estimates) > 1:
                drop = estimates[1:]  # keep the earliest projection
                stats["duplicate_estimates"] += len(drop)
            else:
                continue
            for row in drop:
                doomed.append({
                    "id": row["id"],
                    "profile_id": key[0],
                    "ticker": key[1],
                    "date": row["date"].isoformat(),
                    "amount": row["amount"],
                    "reason": "superseded by recorded payment" if has_real else "duplicate projection",
                })
    return doomed, stats


def summarise(conn, doomed):
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM profiles")}
    by_month = defaultdict(float)
    by_profile = defaultdict(float)
    for row in doomed:
        by_month[row["date"][:7]] += row["amount"]
        by_profile[row["profile_id"]] += row["amount"]

    print("\nPhantom income by month:")
    for ym in sorted(by_month):
        print("  %-9s  $%10.2f" % (ym, by_month[ym]))
    print("\nPhantom income by account:")
    for pid in sorted(by_profile, key=lambda p: -by_profile[p]):
        print("  %-22s $%10.2f" % (names.get(pid, "profile %s" % pid), by_profile[pid]))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=DB_PATH, help="path to portfolio.db")
    ap.add_argument("--apply", action="store_true", help="delete the rows (default is a dry run)")
    ap.add_argument("--dry-run", action="store_true", help="report only (default)")
    ap.add_argument("--verbose", action="store_true", help="list every affected row")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        print("No database at %s" % args.db)
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    doomed, stats = find_duplicates(conn)

    total = sum(r["amount"] for r in doomed)
    print("Found %d duplicate projected payments totalling $%.2f" % (len(doomed), total))
    print("  superseded by a recorded payment: %d" % stats["superseded_by_real"])
    print("  duplicate projections:            %d" % stats["duplicate_estimates"])
    if stats["inferred_frequency"]:
        print("  holdings with frequency inferred: %d" % stats["inferred_frequency"])
    if stats["narrowed_by_observed"]:
        print("  holdings whose recorded frequency was too wide: %d" % stats["narrowed_by_observed"])
    if doomed:
        summarise(conn, doomed)
    if args.verbose:
        for row in sorted(doomed, key=lambda r: (r["date"], r["ticker"])):
            print("  %s  p%-3s %-6s $%8.2f  (%s)" % (
                row["date"], row["profile_id"], row["ticker"], row["amount"], row["reason"]))

    if not args.apply:
        print("\nDry run — nothing changed. Re-run with --apply to delete these rows.")
        conn.close()
        return 0

    if not doomed:
        print("\nNothing to do.")
        conn.close()
        return 0

    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = "%s.before_estimate_repair_%s" % (args.db, stamp)
    conn.close()
    shutil.copy2(args.db, backup)
    print("\nBacked up database to %s" % backup)

    conn = sqlite3.connect(args.db)
    conn.executemany("DELETE FROM dividend_payments WHERE id = ?", [(r["id"],) for r in doomed])
    conn.commit()
    conn.close()
    print("Deleted %d rows ($%.2f of phantom income)." % (len(doomed), total))
    return 0


if __name__ == "__main__":
    sys.exit(main())
