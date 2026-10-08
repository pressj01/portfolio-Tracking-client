"""ETF holdings overlap.

Answers "how much of these two funds is the same investment" by weight rather
than by counting shared tickers. Two funds can share 96 names and still differ
a great deal if one holds 8% of a company and the other 0.5%, so the headline
number is the sum, over every shared holding, of the smaller of the two weights.

Holdings come from diversification.py's look-through cache, so this inherits
its sources (issuer files first), its manual overrides and its limits. Two of
those limits change how the answer has to be read, and both are reported
instead of being normalised away:

1. Coverage is a floor. A fund resolved from a top-25 table only discloses part
   of itself, and an undisclosed holding cannot overlap with anything. The
   overlap is therefore a minimum whenever either fund is under ~100% covered.

2. Collateral is not a holding. Two option-income funds that both file Treasury
   bills do not "overlap" in any sense an investor cares about, so cash and
   derivative rows are totalled per fund and kept out of the comparison.
"""

import re
import threading
from concurrent.futures import ThreadPoolExecutor

from flask import jsonify, request

import sector_exposure as sx
from config import get_connection
from diversification import (
    _BILL_SYM_PAT,
    _CASH_PAT,
    _DERIV_PAT,
    _DERIV_SYM_PAT,
    _ensure_bootstrapped,
    _expand_nested,
    _load_cache,
    _name_index,
    _norm_name,
    _norm_symbol,
    resolve_fund,
)

# A constituent this large may itself be a fund (TSPY is ~100% VOO), and is
# worth one lookup so the wrapper is compared on what it really holds.
_NESTED_MIN_WEIGHT = 20.0
# How many of the largest holdings get a per-stock sector and industry looked
# up. The tail of a 500-row index is rounding noise and not worth a quote
# request each.
_SECTOR_FILL_LIMIT = 60
_LOOKUP_SYM_PAT = re.compile(r"^[A-Z]{1,6}$")

_SECTOR_LOCK = threading.Lock()
_SECTOR_INFLIGHT = set()
# Symbols already asked about in this process. A symbol Yahoo cannot classify
# stays unclassified; without this every page load would ask again.
_SECTOR_ATTEMPTED = set()


def _fund_items(ticker, holdings, meta, name_idx):
    """One fund's comparable holdings, keyed so the same company matches.

    Returns ({key: {symbol, name, weight}}, cash_pct, derivatives_pct).
    """
    rows = _expand_nested(holdings.get(ticker, []), holdings, meta, depth=2)
    items = {}
    cash = 0.0
    derivatives = 0.0
    for r in rows:
        weight = r.get("weight_pct")
        if not weight:
            continue
        sym = _norm_symbol(r.get("symbol") or "")
        name = r.get("name") or sym
        if _CASH_PAT.search(name) or _BILL_SYM_PAT.match(sym):
            cash += weight
            continue
        if _DERIV_PAT.search(name) or _DERIV_SYM_PAT.search(sym):
            derivatives += weight
            continue
        if weight <= 0:
            continue
        if not sym:
            sym = name_idx.get(_norm_name(name)) or ""
        key = sym or ("N:" + _norm_name(name))
        if key == "N:":
            continue
        item = items.setdefault(key, {"symbol": sym, "name": name, "weight": 0.0})
        item["weight"] += weight
    return items, cash, derivatives


def _row_sector(sym, sector_cache):
    prof = sector_cache.get(sym) if sym else None
    if not prof:
        return None
    if prof["kind"] == "asset":
        return prof.get("asset_class")
    if prof["kind"] == "sectors" and prof["weights"]:
        if len(prof["weights"]) == 1:
            return next(iter(prof["weights"]))
        return "Fund"
    return None


def _row_industry(sym, sector_cache):
    prof = sector_cache.get(sym) if sym else None
    return (prof or {}).get("industry") or None


def _needs_lookup(prof):
    """Whether a holding's sector or industry is still worth asking for."""
    if not prof or prof["kind"] == "none":
        return True
    # Stocks profiled before industry was recorded have a sector and nothing
    # else. Only an equity quote can supply one, so funds are left alone.
    return prof.get("source") == "yahoo_quote" and not prof.get("industry")


def _fund_sectors(ticker, holdings, meta, name_idx, sector_cache):
    """{sector: percent of fund}, and which evidence it came from."""
    prof = sector_cache.get(ticker)
    if prof and prof["kind"] == "sectors" and len(prof["weights"]) > 1:
        return dict(prof["weights"]), "fund"
    rows = _expand_nested(holdings.get(ticker, []), holdings, meta, depth=2)
    splits, _covered = sx._constituent_splits(rows, sector_cache, name_idx, False)
    return splits, "constituents"


def _fund_summary(ticker, info, items, cash, derivatives):
    return {
        "ticker": ticker,
        "status": info.get("status"),
        "source": info.get("source"),
        "coverage_pct": info.get("coverage_pct"),
        "as_of": info.get("as_of"),
        "holdings_count": len(items),
        "securities_pct": round(sum(i["weight"] for i in items.values()), 2),
        "cash_pct": round(cash, 2),
        "derivatives_pct": round(derivatives, 2),
    }


def _fund_problem(ticker, info, items, collateral):
    status = (info or {}).get("status")
    if status == "self":
        return f"{ticker} is a single stock, not a fund, so it has no holdings to compare."
    if status == "cash":
        return f"{ticker} is a money-market fund and publishes no holdings."
    if not items and collateral:
        # A synthetic fund did resolve -- it just files Treasuries and option
        # legs. Saying "no data" would send the user off to fix a fund that is
        # reporting exactly what it owns.
        return (f"{ticker} holds only cash, Treasury bills and option positions, "
                "so it has no stock holdings to compare. Synthetic option-income "
                "funds get their exposure from derivatives rather than from a "
                "portfolio of securities.")
    if not items:
        return (f"No holdings data could be found for {ticker}. If it is a fund, "
                "its holdings can be entered on the Fund Definitions page.")
    return None


def build_overlap(conn, ticker_a, ticker_b):
    """Compare two already-resolved funds from the look-through cache."""
    a = ticker_a.strip().upper()
    b = ticker_b.strip().upper()
    holdings, meta, _exposure = _load_cache(conn)
    name_idx = _name_index(holdings)
    sector_cache = sx.load_sector_cache(conn)

    items_a, cash_a, deriv_a = _fund_items(a, holdings, meta, name_idx)
    items_b, cash_b, deriv_b = _fund_items(b, holdings, meta, name_idx)

    for tkr, items, collateral in ((a, items_a, abs(cash_a) + abs(deriv_a)),
                                   (b, items_b, abs(cash_b) + abs(deriv_b))):
        problem = _fund_problem(tkr, meta.get(tkr), items, collateral)
        if problem:
            return {"error": problem, "ticker": tkr}

    rows = []
    overlap = 0.0
    shared = 0
    a_in_shared = 0.0
    b_in_shared = 0.0
    for key in set(items_a) | set(items_b):
        ia = items_a.get(key)
        ib = items_b.get(key)
        wa = ia["weight"] if ia else 0.0
        wb = ib["weight"] if ib else 0.0
        common = min(wa, wb)
        if ia and ib:
            shared += 1
            overlap += common
            a_in_shared += wa
            b_in_shared += wb
        ref = ia or ib
        sym = ref["symbol"]
        rows.append({
            "key": key,
            "symbol": sym,
            "name": (ia or ib)["name"],
            "weight_a": round(wa, 4),
            "weight_b": round(wb, 4),
            "overlap": round(common, 4),
            "diff": round(wa - wb, 4),
            "sector": _row_sector(sym, sector_cache),
            "industry": _row_industry(sym, sector_cache),
        })
    rows.sort(key=lambda r: (-r["overlap"], -max(r["weight_a"], r["weight_b"])))

    sec_a, basis_a = _fund_sectors(a, holdings, meta, name_idx, sector_cache)
    sec_b, basis_b = _fund_sectors(b, holdings, meta, name_idx, sector_cache)
    sectors = []
    for label in set(sec_a) | set(sec_b):
        pa = sec_a.get(label, 0.0)
        pb = sec_b.get(label, 0.0)
        if max(pa, pb) < 0.05:
            continue
        sectors.append({"sector": label, "a": round(pa, 2), "b": round(pb, 2),
                        "diff": round(pa - pb, 2)})
    sectors.sort(key=lambda s: -abs(s["diff"]))

    return {
        "a": {**_fund_summary(a, meta.get(a, {}), items_a, cash_a, deriv_a),
              "sector_basis": basis_a},
        "b": {**_fund_summary(b, meta.get(b, {}), items_b, cash_b, deriv_b),
              "sector_basis": basis_b},
        "overlap_pct": round(overlap, 2),
        "shared_count": shared,
        "only_a_count": len(items_a) - shared,
        "only_b_count": len(items_b) - shared,
        "a_weight_in_shared": round(a_in_shared, 2),
        "b_weight_in_shared": round(b_in_shared, 2),
        "holdings": rows,
        "sectors": sectors,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Resolution (network) -- kept out of build_overlap so the maths is testable
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_pair(conn, tickers):
    """Fill the look-through cache for the funds and any wrapper they hold."""
    for tkr in tickers:
        try:
            resolve_fund(tkr, conn)
        except Exception:
            # A failed fetch leaves the cache as it was; build_overlap reports
            # the missing fund in plain words instead of a stack trace.
            pass
    nested = set()
    for tkr in tickers:
        for sym, weight in conn.execute(
            "SELECT symbol, weight_pct FROM fund_holdings WHERE fund_ticker=?", (tkr,)
        ).fetchall():
            if (sym and (weight or 0) >= _NESTED_MIN_WEIGHT and sym not in tickers
                    and _LOOKUP_SYM_PAT.match(sym)):
                nested.add(sym)
    for sym in nested:
        known = conn.execute(
            "SELECT 1 FROM fund_holdings_meta WHERE fund_ticker=?", (sym,)
        ).fetchone()
        if not known:
            try:
                resolve_fund(sym, conn)
            except Exception:
                pass
    for tkr in tickers:
        try:
            sx.resolve_security(tkr, conn)
        except Exception:
            pass


def _sector_fill_targets(result, sector_cache):
    ranked = sorted(result["holdings"],
                    key=lambda r: -max(r["weight_a"], r["weight_b"]))
    out = []
    for r in ranked[:_SECTOR_FILL_LIMIT]:
        sym = r["symbol"]
        if not sym or not _LOOKUP_SYM_PAT.match(sym):
            continue
        if _needs_lookup(sector_cache.get(sym)):
            out.append(sym)
    return out


def _store_lookup(conn, prof, cached):
    """Store a looked-up profile unless it would erase a better cached one.

    Stocks that already have a sector are asked about again to pick up their
    industry. If that request is throttled the answer is an empty profile, and
    writing it would trade a known sector for nothing.
    """
    prior = cached.get(prof["ticker"])
    if prof["kind"] == "none" and prior and prior["kind"] != "none":
        return False
    sx.store_sector_profile(conn, prof)
    return True


def _fill_sectors(symbols):
    conn = None
    try:
        conn = get_connection()
        cached = sx.load_sector_cache(conn)
        # Fetched in parallel, written from this thread only: sqlite
        # connections are not shared across threads.
        with ThreadPoolExecutor(max_workers=4) as ex:
            for prof in ex.map(sx._safe_fetch, symbols):
                try:
                    _store_lookup(conn, prof, cached)
                except Exception:
                    pass
    finally:
        with _SECTOR_LOCK:
            _SECTOR_INFLIGHT.difference_update(symbols)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _start_sector_fill(targets):
    """Look up missing per-stock sectors and industries in the background.

    Returns how many of `targets` are still being fetched, so the page knows
    whether asking again is worthwhile.
    """
    with _SECTOR_LOCK:
        fresh = [s for s in targets
                 if s not in _SECTOR_ATTEMPTED and s not in _SECTOR_INFLIGHT]
        _SECTOR_ATTEMPTED.update(fresh)
        _SECTOR_INFLIGHT.update(fresh)
        pending = sum(1 for s in targets if s in _SECTOR_INFLIGHT)
    if fresh:
        threading.Thread(target=_fill_sectors, args=(fresh,), daemon=True).start()
    return pending


def portfolio_funds(conn, profile_ids):
    """Current holdings that can be compared, largest position first.

    A holding the look-through cache already knows to be a single stock or a
    money-market fund is left out. One never looked up is kept: it may well be
    a fund, and comparing it is what finds out.
    """
    if not profile_ids:
        return []
    placeholders = ",".join("?" * len(profile_ids))
    rows = conn.execute(
        f"""SELECT a.ticker,
                   MAX(a.description) AS description,
                   SUM(a.current_value) AS current_value
              FROM all_account_info a
              LEFT JOIN fund_holdings_meta m ON m.fund_ticker = UPPER(a.ticker)
             WHERE a.profile_id IN ({placeholders})
               AND a.current_value > 0
               AND COALESCE(m.status, '') NOT IN ('self', 'cash')
          GROUP BY a.ticker
          ORDER BY current_value DESC""",
        list(profile_ids),
    ).fetchall()
    return [{"ticker": (r[0] or "").strip().upper(),
             "description": (r[1] or "").strip(),
             "current_value": float(r[2] or 0)}
            for r in rows if (r[0] or "").strip()]


def register_routes(app, get_profile_filter=None):

    @app.route("/api/etf-overlap/portfolio-funds", methods=["GET"])
    def api_etf_overlap_portfolio_funds():
        _, pids = get_profile_filter() if get_profile_filter else (False, [1])
        conn = get_connection()
        try:
            _ensure_bootstrapped(conn)
            return jsonify({"funds": portfolio_funds(conn, pids)})
        finally:
            conn.close()

    @app.route("/api/etf-overlap", methods=["GET"])
    def api_etf_overlap():
        a = (request.args.get("a") or "").strip().upper()
        b = (request.args.get("b") or "").strip().upper()
        if not a or not b:
            return jsonify({"error": "Enter two fund tickers to compare."}), 400
        if a == b:
            return jsonify({"error": "Pick two different funds."}), 400
        conn = get_connection()
        try:
            _ensure_bootstrapped(conn)
            _resolve_pair(conn, [a, b])
            result = build_overlap(conn, a, b)
            if result.get("error"):
                return jsonify(result), 404
            result["sectors_pending"] = _start_sector_fill(
                _sector_fill_targets(result, sx.load_sector_cache(conn)))
            return jsonify(result)
        finally:
            conn.close()
