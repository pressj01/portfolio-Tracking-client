"""Tax-loss harvesting algorithm.

Computes per-lot unrealized losses on currently held positions, scans for
wash-sale conflicts in the +/- 30 day window, classifies short vs long term,
estimates tax savings, and proposes replacement candidates.

The wash-sale scan inspects only the `transactions` table — DRIP reinvestments
are already materialized as BUY rows during import (tagged `[DRIP]` in notes),
so dividend_payments does not need to be consulted for acquisition events.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Iterable

WASH_WINDOW_DAYS_DEFAULT = 30
DEFAULT_ST_RATE = 0.32
DEFAULT_LT_RATE = 0.15
DEFAULT_STATE_RATE = 0.0

# Pairs that are clearly "substantially identical" — same underlying index,
# different ticker. Used to hard-block these as replacement suggestions.
SUBSTANTIALLY_IDENTICAL = {
    "VOO": {"IVV", "SPLG", "SPY"},
    "IVV": {"VOO", "SPLG", "SPY"},
    "SPLG": {"VOO", "IVV", "SPY"},
    "SPY":  {"VOO", "IVV", "SPLG"},
    "VTI":  {"ITOT", "SCHB"},
    "ITOT": {"VTI", "SCHB"},
    "QQQ":  {"QQQM"},
    "QQQM": {"QQQ"},
    "VEA":  {"IEFA"},
    "IEFA": {"VEA"},
    "VWO":  {"IEMG"},
    "IEMG": {"VWO"},
}


def _parse_date(s) -> date | None:
    if not s:
        return None
    if isinstance(s, date) and not isinstance(s, datetime):
        return s
    if isinstance(s, datetime):
        return s.date()
    try:
        return datetime.fromisoformat(str(s)[:10]).date()
    except (ValueError, TypeError):
        return None


def _load_tax_rates(conn) -> dict:
    """Read tax rates from the settings table with sane defaults."""
    rows = conn.execute(
        "SELECT key, value FROM settings WHERE key IN "
        "('tax_short_term_rate','tax_long_term_rate','tax_state_rate','tax_loss_wash_window_days')"
    ).fetchall()
    cfg = {r["key"]: r["value"] for r in rows}

    def _f(key, default):
        try:
            return float(cfg.get(key, default))
        except (TypeError, ValueError):
            return default

    return {
        "short": _f("tax_short_term_rate", DEFAULT_ST_RATE),
        "long":  _f("tax_long_term_rate", DEFAULT_LT_RATE),
        "state": _f("tax_state_rate", DEFAULT_STATE_RATE),
        "wash_days": int(_f("tax_loss_wash_window_days", WASH_WINDOW_DAYS_DEFAULT)),
    }


def _open_shares_by_lot(conn, profile_ids: list[int]) -> list[dict]:
    """Return BUY transactions with their remaining open shares (post-SELL allocations).

    Profile-scoped. Only lots with open_shares > 1e-9 are returned.
    """
    placeholders = ",".join("?" * len(profile_ids))
    rows = conn.execute(
        f"""
        SELECT t.id           AS txn_id,
               t.ticker       AS ticker,
               t.profile_id   AS profile_id,
               t.transaction_date AS buy_date,
               t.shares       AS shares,
               t.price_per_share AS price_per_share,
               t.fees         AS fees,
               t.notes        AS notes,
               COALESCE((SELECT SUM(a.shares)
                         FROM transaction_lot_allocations a
                         WHERE a.buy_txn_id = t.id), 0) AS allocated
        FROM transactions t
        WHERE t.transaction_type = 'BUY'
          AND t.profile_id IN ({placeholders})
        """,
        profile_ids,
    ).fetchall()

    lots = []
    for r in rows:
        r = dict(r)
        open_sh = float(r["shares"] or 0) - float(r["allocated"] or 0)
        if open_sh <= 1e-9:
            continue
        lots.append({
            "txn_id": r["txn_id"],
            "ticker": (r["ticker"] or "").upper(),
            "profile_id": r["profile_id"],
            "buy_date": r["buy_date"],
            "open_shares": open_sh,
            "price_per_share": float(r["price_per_share"] or 0),
            "fees_per_share": (float(r["fees"] or 0) / float(r["shares"]) if r["shares"] else 0),
            "notes": r["notes"] or "",
        })
    return lots


def _current_prices(conn, profile_ids: list[int]) -> dict[str, float]:
    """Map ticker -> current_price using the holdings snapshot.

    For aggregate profiles, take the most-recent non-null price across members.
    """
    placeholders = ",".join("?" * len(profile_ids))
    rows = conn.execute(
        f"""SELECT ticker,
                   AVG(current_price) AS price
            FROM holdings
            WHERE profile_id IN ({placeholders})
              AND current_price IS NOT NULL
              AND current_price > 0
            GROUP BY ticker""",
        profile_ids,
    ).fetchall()
    return {(r["ticker"] or "").upper(): float(r["price"] or 0) for r in rows}


def _wash_sale_check(conn, ticker: str, profile_ids: list[int], wash_days: int, today: date) -> dict:
    """Return wash-sale status for harvesting `ticker` today.

    Looks at BUY transactions in [today - wash_days, today] across the household
    (all profile_ids in scope). The IRS treats the household as one taxpayer,
    so a buy in any account counts.

    Returns:
        {
            status: "clear" | "blocked",
            clears_on: ISO date or None,
            offenders: [{txn_id, profile_id, date, shares, notes}],
        }
    """
    placeholders = ",".join("?" * len(profile_ids))
    window_start = (today - timedelta(days=wash_days)).isoformat()
    today_iso = today.isoformat()
    rows = conn.execute(
        f"""SELECT id, profile_id, transaction_date, shares, notes
            FROM transactions
            WHERE transaction_type = 'BUY'
              AND UPPER(ticker) = ?
              AND profile_id IN ({placeholders})
              AND transaction_date >= ?
              AND transaction_date <= ?
            ORDER BY transaction_date DESC""",
        [ticker.upper(), *profile_ids, window_start, today_iso],
    ).fetchall()

    if not rows:
        return {"status": "clear", "clears_on": None, "offenders": []}

    offenders = [{
        "txn_id": r["id"],
        "profile_id": r["profile_id"],
        "date": r["transaction_date"],
        "shares": float(r["shares"] or 0),
        "notes": r["notes"] or "",
        "is_drip": "[DRIP]" in (r["notes"] or ""),
    } for r in rows]

    # Latest BUY date determines when the wash window clears.
    latest = max(_parse_date(o["date"]) or today for o in offenders)
    clears_on = (latest + timedelta(days=wash_days + 1)).isoformat()
    return {"status": "blocked", "clears_on": clears_on, "offenders": offenders}


def _classify_term(buy_date_str, today: date) -> str:
    bd = _parse_date(buy_date_str)
    if not bd:
        return "unknown"
    return "long" if (today - bd).days > 365 else "short"


def _tax_saved(loss_amount: float, term: str, rates: dict) -> float:
    """Convert a loss (positive number) to estimated tax saved."""
    rate = rates["long"] if term == "long" else rates["short"]
    total_rate = rate + rates["state"]
    return abs(loss_amount) * total_rate


def build_candidates(conn, scope: dict, today: date | None = None) -> dict:
    """Top-level harvesting computation.

    Args:
        conn: sqlite3 connection (Row factory).
        scope: result of _get_gains_losses_profile_scope.
        today: override for testing.

    Returns:
        {
            candidates: [...],          # per-lot loss candidates
            summary: {...},             # aggregates
            rates: {...},               # effective tax rates used
            as_of: "YYYY-MM-DD",
        }
    """
    today = today or date.today()
    rates = _load_tax_rates(conn)

    holding_pids = scope["holding_profile_ids"]
    txn_pids = scope["transaction_profile_ids"]

    prices = _current_prices(conn, holding_pids)
    lots = _open_shares_by_lot(conn, txn_pids)

    # Cache wash-sale results per ticker — same answer for every lot of that ticker.
    wash_cache: dict[str, dict] = {}

    candidates = []
    for lot in lots:
        tkr = lot["ticker"]
        cur_price = prices.get(tkr)
        if not cur_price or cur_price <= 0:
            continue  # no current price -> can't evaluate

        cost_per_share = lot["price_per_share"] + lot["fees_per_share"]
        loss_per_share = cur_price - cost_per_share
        if loss_per_share >= 0:
            continue  # not a loss

        total_loss = loss_per_share * lot["open_shares"]   # negative number
        term = _classify_term(lot["buy_date"], today)
        est_tax = _tax_saved(total_loss, term, rates)

        if tkr not in wash_cache:
            wash_cache[tkr] = _wash_sale_check(conn, tkr, txn_pids, rates["wash_days"], today)
        wash = wash_cache[tkr]

        candidates.append({
            "txn_id": lot["txn_id"],
            "ticker": tkr,
            "profile_id": lot["profile_id"],
            "buy_date": lot["buy_date"],
            "open_shares": round(lot["open_shares"], 6),
            "cost_per_share": round(cost_per_share, 4),
            "current_price": round(cur_price, 4),
            "unrealized_loss": round(total_loss, 2),
            "term": term,
            "est_tax_saved": round(est_tax, 2),
            "wash_status": wash["status"],
            "wash_clears_on": wash["clears_on"],
            "wash_offenders": wash["offenders"],
            "is_drip_lot": "[DRIP]" in lot["notes"],
        })

    candidates.sort(key=lambda c: c["unrealized_loss"])  # most negative first

    # Aggregates
    total_harvestable = sum(c["unrealized_loss"] for c in candidates if c["wash_status"] == "clear")
    total_blocked = sum(c["unrealized_loss"] for c in candidates if c["wash_status"] == "blocked")
    est_tax_saved = sum(c["est_tax_saved"] for c in candidates if c["wash_status"] == "clear")

    return {
        "candidates": candidates,
        "summary": {
            "candidate_count": len(candidates),
            "harvestable_loss": round(total_harvestable, 2),
            "blocked_loss": round(total_blocked, 2),
            "est_tax_saved": round(est_tax_saved, 2),
        },
        "rates": rates,
        "as_of": today.isoformat(),
    }


def ytd_realized(conn, scope: dict, today: date | None = None) -> dict:
    """YTD realized gain/loss summary across the household."""
    today = today or date.today()
    year_start = date(today.year, 1, 1).isoformat()
    pids = scope["transaction_profile_ids"]
    placeholders = ",".join("?" * len(pids))
    row = conn.execute(
        f"""SELECT COALESCE(SUM(realized_gain), 0) AS rg,
                   COUNT(*) AS sell_count
            FROM transactions
            WHERE transaction_type = 'SELL'
              AND profile_id IN ({placeholders})
              AND transaction_date >= ?""",
        [*pids, year_start],
    ).fetchone()
    return {
        "ytd_realized": float(row["rg"] or 0),
        "ytd_sell_count": int(row["sell_count"] or 0),
        "year": today.year,
    }


def candidate_replacements(conn, ticker: str, scope: dict, limit: int = 3) -> list[dict]:
    """Suggest replacement candidates for a losing ticker.

    Primary source: tickers in the same user category that aren't currently held.
    Fallback: broader universe from general_scanner_cache matched on sector or
    etf_category. Substantially-identical pairs are always excluded.
    """
    ticker = ticker.upper()
    pids = scope["holding_profile_ids"]
    placeholders = ",".join("?" * len(pids))

    held_tickers = {
        (r["ticker"] or "").upper()
        for r in conn.execute(
            f"""SELECT DISTINCT ticker FROM holdings
                WHERE profile_id IN ({placeholders})
                  AND COALESCE(quantity, 0) > 1e-9""",
            pids,
        ).fetchall()
    }
    blocked = SUBSTANTIALLY_IDENTICAL.get(ticker, set()) | {ticker} | held_tickers

    cat_row = conn.execute(
        f"""SELECT c.id, c.name
            FROM ticker_categories tc
            JOIN categories c ON c.id = tc.category_id
            WHERE UPPER(tc.ticker) = ?
              AND tc.profile_id IN ({placeholders})
            LIMIT 1""",
        [ticker, *pids],
    ).fetchone()

    peers: list[tuple[str, str]] = []  # (ticker, why)

    if cat_row:
        cat_name = cat_row["name"]
        peer_rows = conn.execute(
            f"""SELECT DISTINCT UPPER(tc.ticker) AS ticker
                FROM ticker_categories tc
                WHERE tc.category_id = ?
                  AND tc.profile_id IN ({placeholders})""",
            [cat_row["id"], *pids],
        ).fetchall()
        for r in peer_rows:
            t = r["ticker"]
            if t and t not in blocked:
                peers.append((t, cat_name))

    # Fallback: broader universe by sector / etf_category from general_scanner_cache.
    if len(peers) < limit:
        meta = conn.execute(
            "SELECT sector, etf_category, asset_type FROM general_scanner_cache WHERE UPPER(ticker) = ?",
            [ticker],
        ).fetchone()
        if meta:
            sector = meta["sector"]
            etf_cat = meta["etf_category"]
            extra_rows = []
            if etf_cat:
                extra_rows.extend(conn.execute(
                    "SELECT UPPER(ticker) AS ticker, etf_category AS label "
                    "FROM general_scanner_cache "
                    "WHERE etf_category = ? AND UPPER(ticker) != ? "
                    "ORDER BY COALESCE(aum, 0) DESC LIMIT 20",
                    [etf_cat, ticker],
                ).fetchall())
            if sector:
                extra_rows.extend(conn.execute(
                    "SELECT UPPER(ticker) AS ticker, sector AS label "
                    "FROM general_scanner_cache "
                    "WHERE sector = ? AND UPPER(ticker) != ? "
                    "ORDER BY COALESCE(market_cap, 0) DESC LIMIT 20",
                    [sector, ticker],
                ).fetchall())
            seen_p = {p[0] for p in peers}
            for r in extra_rows:
                t = r["ticker"]
                if t and t not in blocked and t not in seen_p:
                    peers.append((t, r["label"] or "Sector"))
                    seen_p.add(t)
                    if len(peers) >= limit * 3:
                        break

    suggestions = []
    for peer, label in peers[:max(limit * 3, limit)]:
        meta = conn.execute(
            "SELECT current_annual_yield FROM dividends WHERE UPPER(ticker) = ? LIMIT 1",
            [peer],
        ).fetchone()
        suggestions.append({
            "ticker": peer,
            "category": label,
            "yield": float(meta["current_annual_yield"]) if meta and meta["current_annual_yield"] is not None else None,
        })
        if len(suggestions) >= limit:
            break
    return suggestions
