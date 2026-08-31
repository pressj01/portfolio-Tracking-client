"""Daily / weekly / monthly dividend payment ledger.

Answers three questions off the dividend_payments table:

  * What was I paid today?
  * What has this week paid out so far?
  * What has this month paid out so far?

Every payment lands on exactly one day, so the weekly and monthly figures are
running totals over the daily ones: a day with payments pushes both running
totals up by that day's amount, and a day with none leaves them where they
were. The ledger reports the carried-forward value on quiet days rather than
a gap, so the running total always reads as a balance.

Weeks are real weeks, not month slices. A week that straddles a month
boundary is reported with its full seven-day total, and the ledger includes
the handful of adjacent-month days it needs to make that total add up — those
days are flagged in_month=False so the month-to-date column can skip them.

Rows sourced from 'refresh_estimate' are projections written by the price
refresh, not money a broker confirmed. Their totals are carried alongside the
confirmed ones at every level so a projected week can never be mistaken for a
paid one.

A payment is always written against the account that received it, so a view
covering several accounts — an aggregate, or Owner reading its linked
accounts — is the sum of its members. The caller resolves which profiles those
are; the ledger reports them back in `scope` and breaks the month down per
account so a roll-up shows what each one contributed.
"""

from __future__ import annotations

import calendar
import datetime

ESTIMATE_SOURCE = "refresh_estimate"

WEEK_STARTS = ("mon", "sun")


def _norm_source(source):
    return str(source or "").strip().lower()


def is_estimate(source):
    """True when a payment row is a refresh projection rather than a broker record."""
    return _norm_source(source) == ESTIMATE_SOURCE


def normalize_week_start(raw):
    value = str(raw or "").strip().lower()[:3]
    return value if value in WEEK_STARTS else "mon"


def week_start_for(day, week_start="mon"):
    """First date of the week containing `day`."""
    # weekday() is 0 on Monday, so a Sunday-based week needs one extra step back.
    offset = day.weekday() if week_start == "mon" else (day.weekday() + 1) % 7
    return day - datetime.timedelta(days=offset)


def week_end_for(day, week_start="mon"):
    return week_start_for(day, week_start) + datetime.timedelta(days=6)


def month_bounds(year, month):
    return (
        datetime.date(year, month, 1),
        datetime.date(year, month, calendar.monthrange(year, month)[1]),
    )


def parse_month(raw, today):
    """Return (year, month) from a 'YYYY-MM' string, falling back to today's month."""
    try:
        parts = str(raw).split("-")
        year, month = int(parts[0]), int(parts[1])
        if 1 <= month <= 12 and 1900 <= year <= 2999:
            return year, month
    except (AttributeError, IndexError, TypeError, ValueError):
        pass
    return today.year, today.month


def add_months(year, month, delta):
    index = (year * 12 + (month - 1)) + delta
    return index // 12, index % 12 + 1


def day_label(day):
    """'Aug 3' — built by hand because %-d is not portable to Windows."""
    return f"{calendar.month_abbr[day.month]} {day.day}"


def range_label(start, end):
    if start.month == end.month and start.year == end.year:
        return f"{calendar.month_abbr[start.month]} {start.day}–{end.day}"
    return f"{day_label(start)} – {day_label(end)}"


# ── Reads ─────────────────────────────────────────────────────────────────────

def fetch_payments(conn, profile_ids, start, end, include_estimates=True):
    """Every dividend payment for the profiles inside [start, end], one row each."""
    if not profile_ids:
        return []
    placeholders = ",".join("?" * len(profile_ids))
    sql = (
        "SELECT dp.payment_date, dp.ticker, dp.profile_id, dp.amount, dp.source, "
        "       dp.notes, COALESCE(p.name, 'Portfolio ' || dp.profile_id) AS account "
        "FROM dividend_payments dp "
        "LEFT JOIN profiles p ON p.id = dp.profile_id "
        f"WHERE dp.profile_id IN ({placeholders}) "
        "  AND dp.payment_date >= ? AND dp.payment_date <= ? "
    )
    params = list(profile_ids) + [start.isoformat(), end.isoformat()]
    if not include_estimates:
        sql += "  AND LOWER(COALESCE(dp.source, '')) != ? "
        params.append(ESTIMATE_SOURCE)
    sql += "ORDER BY dp.payment_date, dp.ticker"

    payments = []
    for row in conn.execute(sql, params).fetchall():
        payments.append({
            "date": str(row["payment_date"])[:10],
            "ticker": row["ticker"],
            "amount": round(float(row["amount"] or 0), 2),
            "source": row["source"] or "",
            "notes": row["notes"] or "",
            "profile_id": row["profile_id"],
            "account": row["account"],
            "estimated": is_estimate(row["source"]),
        })
    return payments


def fetch_holding_payment_floors(conn, profile_ids):
    """Declared cash per ticker from current lots (shares × DPS).

    The dividend calendar already uses this figure for a pay date. A broker
    import can miss cap-gain/ROC lines, or cash from an account that no longer
    has the holding, so the ledger would otherwise show less than the calendar
    on the same day.
    """
    ids = list(dict.fromkeys(int(pid) for pid in (profile_ids or []) if pid is not None))
    if not ids:
        return {}
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""SELECT UPPER(TRIM(ticker)) AS ticker,
                   SUM(COALESCE(div, 0) * COALESCE(quantity, 0)) AS declared
            FROM all_account_info
            WHERE profile_id IN ({placeholders})
              AND COALESCE(quantity, 0) > 0
            GROUP BY UPPER(TRIM(ticker))
            HAVING declared > 0""",
        ids,
    ).fetchall()
    floors = {}
    for row in rows:
        try:
            declared = float(row["declared"] or 0)
        except (TypeError, ValueError):
            continue
        if declared > 0:
            floors[str(row["ticker"] or "").strip().upper()] = declared
    return floors


def apply_holding_payment_floors(entries, floors):
    """Raise a pay date's imported cash up to the calendar's declared amount."""
    if not floors or not entries:
        return entries
    by_key = {}
    for index, entry in enumerate(entries):
        ticker = str(entry.get("ticker") or "").strip().upper()
        date = entry.get("date")
        if not ticker or not date:
            continue
        by_key.setdefault((ticker, date), []).append(index)

    for (ticker, _date), indexes in by_key.items():
        declared = floors.get(ticker)
        if not declared:
            continue
        cash = sum(float(entries[index]["amount"] or 0) for index in indexes)
        extra = round(float(declared) - cash, 2)
        if extra <= 0.009:
            continue
        target = next(
            (index for index in indexes if not entries[index].get("estimated")),
            indexes[0],
        )
        entries[target]["amount"] = round(float(entries[target]["amount"] or 0) + extra, 2)
    return entries


def resolve_accounts(conn, profile_ids):
    """Name every account the ledger is summing, in profile-id order."""
    ids = list(dict.fromkeys(int(pid) for pid in (profile_ids or []) if pid is not None))
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT id, name FROM profiles WHERE id IN ({placeholders})", ids
    ).fetchall()
    names = {int(row["id"]): row["name"] for row in rows}
    return [
        {"profile_id": pid, "account": names.get(pid) or f"Portfolio {pid}"}
        for pid in ids
    ]


def available_months(conn, profile_ids, include_estimates=True, limit=120):
    """Months that have at least one payment, newest first, for the month picker."""
    if not profile_ids:
        return []
    placeholders = ",".join("?" * len(profile_ids))
    sql = (
        "SELECT DISTINCT substr(payment_date, 1, 7) AS ym FROM dividend_payments "
        f"WHERE profile_id IN ({placeholders}) "
    )
    params = list(profile_ids)
    if not include_estimates:
        sql += "AND LOWER(COALESCE(source, '')) != ? "
        params.append(ESTIMATE_SOURCE)
    sql += "ORDER BY ym DESC LIMIT ?"
    params.append(int(limit))
    return [str(row["ym"]) for row in conn.execute(sql, params).fetchall() if row["ym"]]


# ── Aggregation ───────────────────────────────────────────────────────────────

def _blank_total():
    return {
        "total": 0.0,
        "actual": 0.0,
        "estimated": 0.0,
        "payment_count": 0,
        "ticker_count": 0,
        "paid_days": 0,
    }


def summarize(entries):
    """Confirmed/projected split plus counts for an arbitrary set of payments."""
    out = _blank_total()
    tickers = set()
    days = set()
    for entry in entries:
        out["total"] += entry["amount"]
        if entry["estimated"]:
            out["estimated"] += entry["amount"]
        else:
            out["actual"] += entry["amount"]
        out["payment_count"] += 1
        tickers.add(entry["ticker"])
        days.add(entry["date"])
    out["total"] = round(out["total"], 2)
    out["actual"] = round(out["actual"], 2)
    out["estimated"] = round(out["estimated"], 2)
    out["ticker_count"] = len(tickers)
    out["paid_days"] = len(days)
    return out


def group_by_ticker(entries):
    """Collapse a day's rows to one per ticker, keeping the per-account split."""
    grouped = {}
    for entry in entries:
        bucket = grouped.get(entry["ticker"])
        if bucket is None:
            bucket = grouped[entry["ticker"]] = {
                "ticker": entry["ticker"],
                "amount": 0.0,
                "actual": 0.0,
                "estimated": 0.0,
                "accounts": [],
                "sources": [],
                "notes": entry["notes"],
            }
        bucket["amount"] += entry["amount"]
        if entry["estimated"]:
            bucket["estimated"] += entry["amount"]
        else:
            bucket["actual"] += entry["amount"]
        bucket["accounts"].append({
            "account": entry["account"],
            "profile_id": entry["profile_id"],
            "amount": entry["amount"],
            "estimated": entry["estimated"],
        })
        if entry["source"] and entry["source"] not in bucket["sources"]:
            bucket["sources"].append(entry["source"])

    rows = []
    for bucket in grouped.values():
        bucket["amount"] = round(bucket["amount"], 2)
        bucket["actual"] = round(bucket["actual"], 2)
        bucket["estimated"] = round(bucket["estimated"], 2)
        bucket["estimated_only"] = bucket["actual"] == 0 and bucket["estimated"] > 0
        rows.append(bucket)
    rows.sort(key=lambda row: (-row["amount"], row["ticker"]))
    return rows


def build_account_totals(entries, accounts):
    """Split a set of payments by the account that received them.

    A roll-up total is only trustworthy if its parts are visible, so every
    account in the view gets a row — including one that paid nothing, which is
    a real answer rather than an omission.
    """
    by_profile = {}
    for entry in entries:
        by_profile.setdefault(entry["profile_id"], []).append(entry)

    rows = [
        {**account, **summarize(by_profile.pop(account["profile_id"], []))}
        for account in accounts
    ]
    # Payments left over belong to a profile the caller did not name (a deleted
    # account, say). They are in the totals, so they need a row of their own.
    for profile_id, bucket in by_profile.items():
        rows.append({
            "profile_id": profile_id,
            "account": bucket[0]["account"],
            **summarize(bucket),
        })
    rows.sort(key=lambda row: (-row["total"], row["account"]))
    return rows


def _by_date(entries):
    buckets = {}
    for entry in entries:
        buckets.setdefault(entry["date"], []).append(entry)
    return buckets


def build_days(entries, first_day, last_day, month_first, month_last, today, week_start):
    """One row per calendar day with the running week- and month-to-date totals."""
    by_date = _by_date(entries)
    days = []
    week_run = 0.0
    month_run = 0.0
    current_week = None

    day = first_day
    while day <= last_day:
        this_week = week_start_for(day, week_start)
        if this_week != current_week:
            current_week = this_week
            week_run = 0.0

        day_entries = by_date.get(day.isoformat(), [])
        stats = summarize(day_entries)
        in_month = month_first <= day <= month_last

        # A quiet day adds nothing, so both running totals carry forward.
        week_run = round(week_run + stats["total"], 2)
        if in_month:
            month_run = round(month_run + stats["total"], 2)

        days.append({
            "date": day.isoformat(),
            "dow": calendar.day_abbr[day.weekday()],
            "dom": day.day,
            "label": day_label(day),
            "in_month": in_month,
            "week_start": this_week.isoformat(),
            "is_week_end": day == this_week + datetime.timedelta(days=6),
            "is_today": day == today,
            "is_future": day > today,
            "is_weekend": day.weekday() >= 5,
            "total": stats["total"],
            "actual": stats["actual"],
            "estimated": stats["estimated"],
            "payment_count": stats["payment_count"],
            "ticker_count": stats["ticker_count"],
            "week_to_date": week_run,
            "month_to_date": month_run if in_month else None,
            "payments": group_by_ticker(day_entries),
        })
        day += datetime.timedelta(days=1)
    return days


def build_weeks(days, month_first, month_last, today, week_start):
    """Roll the daily rows up into the real weeks the ledger window covers."""
    order = []
    buckets = {}
    for day in days:
        key = day["week_start"]
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(day)

    weeks = []
    for index, key in enumerate(order):
        members = buckets[key]
        start = datetime.date.fromisoformat(key)
        end = start + datetime.timedelta(days=6)
        in_month = [d for d in members if d["in_month"]]
        weeks.append({
            "index": index,
            "start": key,
            "end": end.isoformat(),
            "label": range_label(start, end),
            "total": round(sum(d["total"] for d in members), 2),
            "actual": round(sum(d["actual"] for d in members), 2),
            "estimated": round(sum(d["estimated"] for d in members), 2),
            "paid_days": sum(1 for d in members if d["total"] > 0),
            "in_month_total": round(sum(d["total"] for d in in_month), 2),
            "days_in_month": len(in_month),
            "complete": end <= today,
            "is_current": start <= today <= end,
            "spans_prior_month": start < month_first,
            "spans_next_month": end > month_last,
        })
    return weeks


def build_month_summary(days, month_first, month_last, today, prior_entries,
                        month_entries=(), accounts=()):
    """Selected-month totals, its best day, and the same-day prior-month pace."""
    in_month = [d for d in days if d["in_month"]]
    paid = [d for d in in_month if d["total"] > 0]
    total = round(sum(d["total"] for d in in_month), 2)
    best = max(paid, key=lambda d: d["total"], default=None)

    days_in_month = len(in_month)
    if today < month_first:
        days_elapsed = 0
    elif today > month_last:
        days_elapsed = days_in_month
    else:
        days_elapsed = today.day

    prior_total = round(sum(e["amount"] for e in prior_entries), 2)
    prior_first, prior_last = month_bounds(*add_months(month_first.year, month_first.month, -1))
    # Compare like with like. A month still running is measured against the same
    # slice of the month before it — 7 days in, only the prior month's first 7
    # days count. A finished month is measured against a finished month.
    if today > month_last:
        prior_cutoff = prior_last
        comparison_basis = "full month"
    else:
        cutoff_day = min(days_elapsed or days_in_month, prior_last.day)
        prior_cutoff = prior_first + datetime.timedelta(days=cutoff_day - 1)
        comparison_basis = "same days"
    prior_to_date = round(
        sum(e["amount"] for e in prior_entries if e["date"] <= prior_cutoff.isoformat()), 2
    )

    tickers = set()
    for day in in_month:
        for payment in day["payments"]:
            tickers.add(payment["ticker"])

    return {
        "month": f"{month_first.year:04d}-{month_first.month:02d}",
        "label": f"{calendar.month_name[month_first.month]} {month_first.year}",
        "short_label": f"{calendar.month_abbr[month_first.month]} {month_first.year}",
        "total": total,
        "actual": round(sum(d["actual"] for d in in_month), 2),
        "estimated": round(sum(d["estimated"] for d in in_month), 2),
        "paid_days": len(paid),
        "days_in_month": days_in_month,
        "days_elapsed": days_elapsed,
        "is_complete": today > month_last,
        "is_current": month_first <= today <= month_last,
        "ticker_count": len(tickers),
        "by_account": build_account_totals(month_entries, accounts),
        "avg_per_paid_day": round(total / len(paid), 2) if paid else 0.0,
        "avg_per_elapsed_day": round(total / days_elapsed, 2) if days_elapsed else 0.0,
        "best_day": {
            "date": best["date"],
            "label": best["label"],
            "dow": best["dow"],
            "total": best["total"],
        } if best else None,
        "prior_month": {
            "month": f"{prior_first.year:04d}-{prior_first.month:02d}",
            "label": f"{calendar.month_abbr[prior_first.month]} {prior_first.year}",
            "total": prior_total,
            "to_same_day": prior_to_date,
            "through": prior_cutoff.isoformat(),
            "basis": comparison_basis,
        },
        "vs_prior_pct": round((total - prior_to_date) / prior_to_date * 100, 1) if prior_to_date > 0 else None,
    }


def _window(entries, start, end):
    lo, hi = start.isoformat(), end.isoformat()
    return [e for e in entries if lo <= e["date"] <= hi]


def build_now(entries, today, week_start):
    """The live day / week / month / year figures, independent of the browsed month."""
    this_week_start = week_start_for(today, week_start)
    this_week_end = this_week_start + datetime.timedelta(days=6)
    prior_week_start = this_week_start - datetime.timedelta(days=7)
    prior_week_end = this_week_start - datetime.timedelta(days=1)

    month_first, month_last = month_bounds(today.year, today.month)
    prior_month_first, prior_month_last = month_bounds(*add_months(today.year, today.month, -1))
    # Same slice of the previous month, so a month 7 days in is judged on 7 days.
    prior_month_cutoff = min(
        prior_month_first + datetime.timedelta(days=today.day - 1), prior_month_last
    )

    year_first = datetime.date(today.year, 1, 1)
    prior_year_first = datetime.date(today.year - 1, 1, 1)
    try:
        prior_year_cutoff = today.replace(year=today.year - 1)
    except ValueError:  # Feb 29 in a leap year has no counterpart
        prior_year_cutoff = datetime.date(today.year - 1, 2, 28)

    day_entries = _window(entries, today, today)
    week_entries = _window(entries, this_week_start, min(today, this_week_end))
    month_entries = _window(entries, month_first, min(today, month_last))
    year_entries = _window(entries, year_first, today)

    paid_before_today = [e for e in entries if e["date"] < today.isoformat()]
    last_paid = None
    if paid_before_today:
        last_date = max(e["date"] for e in paid_before_today)
        last_day = datetime.date.fromisoformat(last_date)
        last_entries = [e for e in paid_before_today if e["date"] == last_date]
        last_paid = {
            "date": last_date,
            "label": day_label(last_day),
            "dow": calendar.day_abbr[last_day.weekday()],
            "days_ago": (today - last_day).days,
            **summarize(last_entries),
        }

    return {
        "date": today.isoformat(),
        "label": day_label(today),
        "dow": calendar.day_abbr[today.weekday()],
        "week_start": week_start,
        "day": {
            **summarize(day_entries),
            "payments": group_by_ticker(day_entries),
            "prior_week_same_day": round(
                sum(e["amount"] for e in entries
                    if e["date"] == (today - datetime.timedelta(days=7)).isoformat()), 2
            ),
        },
        "week": {
            **summarize(week_entries),
            "start": this_week_start.isoformat(),
            "end": this_week_end.isoformat(),
            "label": range_label(this_week_start, this_week_end),
            "days_elapsed": (min(today, this_week_end) - this_week_start).days + 1,
            "days_total": 7,
            "prior_total": round(sum(e["amount"] for e in _window(entries, prior_week_start, prior_week_end)), 2),
            "prior_label": range_label(prior_week_start, prior_week_end),
            "prior_to_same_day": round(
                sum(e["amount"] for e in _window(
                    entries, prior_week_start,
                    prior_week_start + datetime.timedelta(days=(today - this_week_start).days),
                )), 2
            ),
        },
        "month": {
            **summarize(month_entries),
            "start": month_first.isoformat(),
            "end": month_last.isoformat(),
            "month": f"{today.year:04d}-{today.month:02d}",
            "label": f"{calendar.month_name[today.month]} {today.year}",
            "days_elapsed": today.day,
            "days_total": month_last.day,
            "prior_total": round(sum(e["amount"] for e in _window(entries, prior_month_first, prior_month_last)), 2),
            "prior_label": f"{calendar.month_abbr[prior_month_first.month]} {prior_month_first.year}",
            "prior_to_same_day": round(
                sum(e["amount"] for e in _window(entries, prior_month_first, prior_month_cutoff)), 2
            ),
        },
        "year": {
            **summarize(year_entries),
            "label": str(today.year),
            "prior_label": str(today.year - 1),
            "prior_to_same_day": round(
                sum(e["amount"] for e in _window(entries, prior_year_first, prior_year_cutoff)), 2
            ),
            "prior_total": round(
                sum(e["amount"] for e in _window(
                    entries, prior_year_first, datetime.date(today.year - 1, 12, 31))), 2
            ),
        },
        "last_paid": last_paid,
    }


def build_ledger(conn, profile_ids, month=None, today=None, week_start="mon",
                 include_estimates=True):
    """Full payload for the daily / weekly / monthly payments page."""
    today = today or datetime.date.today()
    week_start = normalize_week_start(week_start)
    year, month_num = parse_month(month, today)
    month_first, month_last = month_bounds(year, month_num)

    # Pad the window out to whole weeks so every week subtotal is a real
    # seven-day total rather than the slice that happens to fall in the month.
    first_visible = week_start_for(month_first, week_start)
    last_visible = week_end_for(month_last, week_start)

    floors = fetch_holding_payment_floors(conn, profile_ids)
    ledger_entries = apply_holding_payment_floors(
        fetch_payments(
            conn, profile_ids, first_visible, last_visible, include_estimates
        ),
        floors,
    )
    days = build_days(
        ledger_entries, first_visible, last_visible,
        month_first, month_last, today, week_start,
    )
    weeks = build_weeks(days, month_first, month_last, today, week_start)

    accounts = resolve_accounts(conn, profile_ids)
    prior_first, prior_last = month_bounds(*add_months(year, month_num, -1))
    prior_entries = apply_holding_payment_floors(
        fetch_payments(conn, profile_ids, prior_first, prior_last, include_estimates),
        floors,
    )
    month_summary = build_month_summary(
        days, month_first, month_last, today, prior_entries,
        month_entries=_window(ledger_entries, month_first, month_last),
        accounts=accounts,
    )

    # "Now" spans back to the start of last year for the year-over-year reads.
    now_start = datetime.date(today.year - 1, 1, 1)
    now_end = max(today, week_end_for(today, week_start), month_bounds(today.year, today.month)[1])
    now_entries = apply_holding_payment_floors(
        fetch_payments(conn, profile_ids, now_start, now_end, include_estimates),
        floors,
    )

    return {
        "today": today.isoformat(),
        "week_start": week_start,
        "include_estimates": bool(include_estimates),
        "month": f"{year:04d}-{month_num:02d}",
        "window": {"start": first_visible.isoformat(), "end": last_visible.isoformat()},
        "scope": {
            "profile_ids": [a["profile_id"] for a in accounts],
            "accounts": accounts,
            "multi_account": len(accounts) > 1,
        },
        "now": build_now(now_entries, today, week_start),
        "days": days,
        "weeks": weeks,
        "month_summary": month_summary,
        "months_available": available_months(conn, profile_ids, include_estimates),
        "estimate_source": ESTIMATE_SOURCE,
    }
