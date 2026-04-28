"""Annual tax report computation.

Pure functions that read from existing tables (transactions,
transaction_lot_allocations, dividend_payments, all_account_info,
dividend_tax_overrides) and produce a per-tax-year breakdown of:

  - Dividend income split into qualified / ordinary / ROC
  - Realized capital gains split into short-term (<= 365 days) and long-term

The report is an estimate — wash-sale rules and the strict 60-day qualified
holding-period test are not enforced. Treatment defaults follow asset-class
heuristics and may be overridden per ticker (and optionally per year) via
the dividend_tax_overrides table.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime


# Default tax-treatment lookup keyed by classification_type. Single-letter
# codes (A/B/G/J) refer to the app's pillar categories — they are equity
# positions so qualified is the right default.
_DEFAULT_TREATMENT = {
    "A": "qualified",
    "B": "qualified",
    "G": "qualified",
    "J": "qualified",
    "HA": "qualified",
    "GS": "qualified",
    "EQUITY": "qualified",
    "ETF": "qualified",
    "STOCK": "qualified",
    "REIT": "ordinary",
    "BDC": "ordinary",
    "CEF": "ordinary",
    "MLP": "ordinary",
    "PREFERRED": "ordinary",
}


def _parse_date(s):
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:len(fmt) + 4], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).date()
    except Exception:
        return None


def _year_of(s):
    d = _parse_date(s)
    return d.year if d else None


def default_treatment_for(classification_type):
    """Return the heuristic tax treatment for a ticker's classification."""
    if not classification_type:
        return "qualified"
    return _DEFAULT_TREATMENT.get(str(classification_type).strip().upper(), "qualified")


def is_tax_advantaged(name):
    """IRAs, Roth IRAs, 401(k)s, HSAs, etc. — accounts whose income and gains
    are not reportable as taxable events in the year they occur."""
    if not name:
        return False
    n = str(name).upper()
    if "IRA" in n:
        return True
    for marker in ("401(K)", "401K", "403(B)", "403B", "HSA", "529"):
        if marker in n:
            return True
    return False


def _resolve_profile_ids(conn, profile_id):
    """Owner (profile 1) aggregates across all member profiles flagged
    include_in_owner, excluding tax-advantaged accounts (IRA, Roth IRA, 401k,
    HSA, 529). Other profiles are returned as-is."""
    if profile_id != 1:
        return [profile_id]
    rows = conn.execute(
        "SELECT id, name FROM profiles WHERE id != 1 AND include_in_owner = 1"
    ).fetchall()
    member_ids = [dict(r)["id"] for r in rows
                  if not is_tax_advantaged(dict(r).get("name"))]
    return member_ids if member_ids else [1]


def _placeholders(items):
    return ",".join("?" for _ in items)


def _override_split(row):
    treatment = (row.get("treatment") or "").strip().lower()
    total_amount = row.get("total_amount")
    base = {
        "total_amount": float(total_amount) if total_amount is not None else None,
    }
    if treatment == "qualified":
        return {**base, "treatment": treatment, "qualified_pct": 100.0, "ordinary_pct": 0.0, "roc_pct": 0.0}
    if treatment == "ordinary":
        return {**base, "treatment": treatment, "qualified_pct": 0.0, "ordinary_pct": 100.0, "roc_pct": 0.0}
    if treatment == "roc":
        return {**base, "treatment": treatment, "qualified_pct": 0.0, "ordinary_pct": 0.0, "roc_pct": 100.0}
    return {
        **base,
        "treatment": "split",
        "qualified_pct": float(row.get("qualified_pct") or 0),
        "ordinary_pct": float(row.get("ordinary_pct") or 0),
        "roc_pct": float(row.get("roc_pct") or 0),
    }


def load_overrides(conn, profile_id, year):
    """Return {ticker: override} resolving year-specific over year=0 default.
    Owner profile aggregates overrides from all member profiles."""
    ids = _resolve_profile_ids(conn, profile_id)
    ph = _placeholders(ids)
    rows = conn.execute(
        f"SELECT ticker, year, treatment, qualified_pct, ordinary_pct, roc_pct, total_amount FROM dividend_tax_overrides "
        f"WHERE profile_id IN ({ph})",
        ids,
    ).fetchall()
    out = {}
    for r in rows:
        r = dict(r)
        t = r["ticker"]
        y = int(r["year"] or 0)
        if y == year:
            out[t] = _override_split(r)
        elif y == 0 and t not in out:
            out[t] = _override_split(r)
    return out


def load_classification_map(conn, profile_id):
    ids = _resolve_profile_ids(conn, profile_id)
    ph = _placeholders(ids)
    rows = conn.execute(
        f"SELECT ticker, classification_type FROM all_account_info WHERE profile_id IN ({ph})",
        ids,
    ).fetchall()
    out = {}
    for r in rows:
        r = dict(r)
        # Same ticker may exist in multiple member profiles — keep the first
        # non-empty classification we see.
        if r["ticker"] not in out or not out[r["ticker"]]:
            out[r["ticker"]] = r.get("classification_type")
    return out


def resolve_treatment(ticker, classification_map, overrides):
    if ticker in overrides:
        return overrides[ticker]
    treatment = default_treatment_for(classification_map.get(ticker))
    return _override_split({"treatment": treatment})


def available_years(conn, profile_id):
    """Distinct calendar years with any taxable activity for this profile."""
    ids = _resolve_profile_ids(conn, profile_id)
    ph = _placeholders(ids)
    years = set()
    rows = conn.execute(
        f"SELECT DISTINCT substr(transaction_date, 1, 4) AS y FROM transactions "
        f"WHERE transaction_type = 'SELL' AND profile_id IN ({ph}) "
        f"AND transaction_date IS NOT NULL",
        ids,
    ).fetchall()
    for r in rows:
        y = dict(r).get("y")
        if y and y.isdigit():
            years.add(int(y))
    rows = conn.execute(
        f"SELECT DISTINCT substr(payment_date, 1, 4) AS y FROM dividend_payments "
        f"WHERE profile_id IN ({ph}) AND payment_date IS NOT NULL",
        ids,
    ).fetchall()
    for r in rows:
        y = dict(r).get("y")
        if y and y.isdigit():
            years.add(int(y))
    return sorted(years, reverse=True)


def compute_dividend_breakdown(conn, profile_id, year):
    """Sum dividend_payments by ticker and treatment for the given year."""
    ids = _resolve_profile_ids(conn, profile_id)
    ph = _placeholders(ids)
    rows = conn.execute(
        f"SELECT ticker, SUM(amount) AS total, COUNT(*) AS count FROM dividend_payments "
        f"WHERE profile_id IN ({ph}) AND substr(payment_date, 1, 4) = ? "
        f"GROUP BY ticker",
        list(ids) + [str(year)],
    ).fetchall()
    classification = load_classification_map(conn, profile_id)
    overrides = load_overrides(conn, profile_id, year)

    by_ticker = defaultdict(lambda: {
        "qualified": 0.0, "ordinary": 0.0, "roc": 0.0, "total": 0.0, "count": 0,
        "treatment": None, "is_override": False,
    })
    totals = {"qualified": 0.0, "ordinary": 0.0, "roc": 0.0, "total": 0.0}

    for r in rows:
        r = dict(r)
        t = r["ticker"]
        actual_total = float(r.get("total") or 0)
        treatment = resolve_treatment(t, classification, overrides)
        bucket = by_ticker[t]
        amt = float(treatment["total_amount"] if treatment.get("total_amount") is not None else actual_total)
        q_amt = amt * float(treatment["qualified_pct"] or 0) / 100.0
        o_amt = amt * float(treatment["ordinary_pct"] or 0) / 100.0
        r_amt = amt * float(treatment["roc_pct"] or 0) / 100.0
        bucket["qualified"] += q_amt
        bucket["ordinary"] += o_amt
        bucket["roc"] += r_amt
        bucket["total"] += amt
        bucket["actual_total"] = actual_total
        bucket["total_amount"] = treatment.get("total_amount")
        bucket["count"] += int(r.get("count") or 0)
        bucket["treatment"] = treatment["treatment"]
        bucket["qualified_pct"] = treatment["qualified_pct"]
        bucket["ordinary_pct"] = treatment["ordinary_pct"]
        bucket["roc_pct"] = treatment["roc_pct"]
        bucket["is_override"] = t in overrides
        totals["qualified"] += q_amt
        totals["ordinary"] += o_amt
        totals["roc"] += r_amt
        totals["total"] += amt

    by_ticker_list = []
    for t, b in by_ticker.items():
        b["ticker"] = t
        b["classification_type"] = classification.get(t)
        by_ticker_list.append(b)
    by_ticker_list.sort(key=lambda x: x["total"], reverse=True)
    return {"totals": totals, "by_ticker": by_ticker_list}


def compute_realized_lots(conn, profile_id, year):
    """Walk SELL transactions in `year`, expand against transaction_lot_allocations
    to produce per-lot ST/LT rows. Sells without explicit allocations fall back
    to FIFO across BUY rows on or before the sell date.
    """
    ids = _resolve_profile_ids(conn, profile_id)
    ph = _placeholders(ids)
    sells = conn.execute(
        f"""SELECT t.id, t.ticker, t.profile_id, t.transaction_date, t.shares,
                   t.price_per_share, t.fees, t.realized_gain
              FROM transactions t
             WHERE t.transaction_type = 'SELL'
               AND t.profile_id IN ({ph})
               AND substr(t.transaction_date, 1, 4) = ?
             ORDER BY t.transaction_date, t.id""",
        list(ids) + [str(year)],
    ).fetchall()
    sells = [dict(s) for s in sells]
    if not sells:
        return {
            "totals": {"short_term": 0.0, "long_term": 0.0, "total": 0.0,
                       "st_proceeds": 0.0, "st_cost": 0.0,
                       "lt_proceeds": 0.0, "lt_cost": 0.0},
            "lots": [],
        }

    sell_ids = [s["id"] for s in sells]
    placeholders = ",".join("?" for _ in sell_ids)
    alloc_rows = conn.execute(
        f"SELECT sell_txn_id, buy_txn_id, shares FROM transaction_lot_allocations "
        f"WHERE sell_txn_id IN ({placeholders}) ORDER BY id",
        sell_ids,
    ).fetchall()
    alloc_map = defaultdict(list)
    buy_ids_needed = set()
    for r in alloc_rows:
        r = dict(r)
        alloc_map[r["sell_txn_id"]].append(r)
        buy_ids_needed.add(r["buy_txn_id"])

    buy_lookup = {}
    if buy_ids_needed:
        bplaceholders = ",".join("?" for _ in buy_ids_needed)
        for br in conn.execute(
            f"SELECT id, ticker, transaction_date, price_per_share, fees, shares "
            f"FROM transactions WHERE id IN ({bplaceholders})",
            list(buy_ids_needed),
        ).fetchall():
            buy_lookup[dict(br)["id"]] = dict(br)

    fifo_buys = defaultdict(list)
    fifo_loaded = set()

    def _load_fifo(ticker, sell_profile_id):
        # Cache per (ticker, profile_id) — buys must come from the same profile
        # that recorded the sell, since each profile has its own lots.
        key = (ticker, sell_profile_id)
        if key in fifo_loaded:
            return
        fifo_loaded.add(key)
        rows = conn.execute(
            """SELECT id, transaction_date, price_per_share, fees, shares
                 FROM transactions
                WHERE ticker = ? AND profile_id = ? AND transaction_type = 'BUY'
                ORDER BY transaction_date, id""",
            (ticker, sell_profile_id),
        ).fetchall()
        fifo_buys[key] = [dict(r) for r in rows]

    lots = []
    totals = {"short_term": 0.0, "long_term": 0.0, "total": 0.0,
              "st_proceeds": 0.0, "st_cost": 0.0,
              "lt_proceeds": 0.0, "lt_cost": 0.0}

    def _emit(ticker, sell_date, sp, fee_per_share, buy_date, buy_price, shares):
        if not shares:
            return
        bd = _parse_date(buy_date)
        sd = _parse_date(sell_date)
        days = (sd - bd).days if (bd and sd) else None
        term = "LT" if (days is not None and days > 365) else "ST"
        proceeds = sp * shares
        cost = (buy_price or 0) * shares
        gain = proceeds - cost - fee_per_share * shares
        lots.append({
            "ticker": ticker,
            "sell_date": str(sell_date) if sell_date else None,
            "buy_date": str(buy_date) if buy_date else None,
            "shares": round(shares, 6),
            "sell_price": round(sp, 4),
            "buy_price": round(buy_price or 0, 4),
            "proceeds": round(proceeds, 2),
            "cost": round(cost, 2),
            "gain": round(gain, 2),
            "holding_days": days,
            "term": term,
        })
        if term == "LT":
            totals["long_term"] += gain
            totals["lt_proceeds"] += proceeds
            totals["lt_cost"] += cost
        else:
            totals["short_term"] += gain
            totals["st_proceeds"] += proceeds
            totals["st_cost"] += cost
        totals["total"] += gain

    for s in sells:
        sid = s["id"]
        ticker = s["ticker"]
        sp = float(s.get("price_per_share") or 0)
        total_shares = float(s.get("shares") or 0)
        fees = float(s.get("fees") or 0)
        fee_per_share = (fees / total_shares) if total_shares else 0
        sell_date = s["transaction_date"]

        allocs = alloc_map.get(sid)
        if allocs:
            for a in allocs:
                buy = buy_lookup.get(a["buy_txn_id"]) or {}
                _emit(
                    ticker, sell_date, sp, fee_per_share,
                    buy.get("transaction_date"),
                    float(buy.get("price_per_share") or 0),
                    float(a["shares"] or 0),
                )
        else:
            sell_profile = s.get("profile_id") or profile_id
            _load_fifo(ticker, sell_profile)
            remaining = total_shares
            queue = fifo_buys[(ticker, sell_profile)]
            for buy in queue:
                if remaining <= 1e-9:
                    break
                bd = _parse_date(buy.get("transaction_date"))
                sd = _parse_date(sell_date)
                if bd and sd and bd > sd:
                    continue
                avail = float(buy.get("shares") or 0) - float(buy.get("_consumed", 0))
                if avail <= 1e-9:
                    continue
                take = min(avail, remaining)
                buy["_consumed"] = float(buy.get("_consumed", 0)) + take
                remaining -= take
                _emit(
                    ticker, sell_date, sp, fee_per_share,
                    buy.get("transaction_date"),
                    float(buy.get("price_per_share") or 0),
                    take,
                )
            if remaining > 1e-6:
                # Couldn't match all shares — emit a row with no buy info so the
                # user sees the gap rather than silently dropping it.
                _emit(ticker, sell_date, sp, fee_per_share, None, 0, remaining)

    for k in totals:
        totals[k] = round(totals[k], 2)

    lots.sort(key=lambda r: (r["sell_date"] or "", r["ticker"]))
    return {"totals": totals, "lots": lots}


def build_summary(conn, profile_id, year):
    div = compute_dividend_breakdown(conn, profile_id, year)
    realized = compute_realized_lots(conn, profile_id, year)

    dt = div["totals"]
    rt = realized["totals"]
    form_1099_div = {
        "box_1a_total_ordinary": round(dt.get("qualified", 0) + dt.get("ordinary", 0), 2),
        "box_1b_qualified": round(dt.get("qualified", 0), 2),
        "box_3_nondividend_distributions": round(dt.get("roc", 0), 2),
    }
    form_8949 = {
        "short_term_proceeds": rt.get("st_proceeds", 0),
        "short_term_cost":     rt.get("st_cost", 0),
        "short_term_gain":     rt.get("short_term", 0),
        "long_term_proceeds":  rt.get("lt_proceeds", 0),
        "long_term_cost":      rt.get("lt_cost", 0),
        "long_term_gain":      rt.get("long_term", 0),
    }
    return {
        "year": year,
        "dividends": div,
        "realized": realized,
        "form_1099_div_preview": form_1099_div,
        "form_8949_preview": form_8949,
        "disclaimers": [
            "Estimates only — verify against your 1099-DIV and brokerage statements before filing.",
            "Wash-sale rules are not applied.",
            "The 60-day qualified-dividend holding-period test is not enforced; treatment is based on asset class with optional per-ticker overrides.",
            "Return-of-capital amounts come from manual overrides only — they are not inferred.",
        ],
    }
