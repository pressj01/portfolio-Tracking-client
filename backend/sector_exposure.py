"""Sector exposure, looked through funds to the sectors underneath.

Answers "how much of this portfolio is Information Technology, and which funds
put it there" — the sector-level companion to diversification.py, which does the
same job at the individual-company level and supplies the look-through data
this module folds up.

Three things make a naive version of this wrong, and each is handled here:

1. Yahoo mislabels closed-end funds. ADX, NAD, NAC, NXG and NML all report
   sector='Financial Services' from their quote, because that is what the
   *wrapper* looks like. Measured on this portfolio that is 21% of value
   landing in the wrong sector, and it looks entirely plausible on a chart.
   CEFs are therefore never sector-mapped from their own quote; they go through
   their constituents like any other fund.

2. GICS sectors describe equities. A bond ETF, a gold fund, a money-market
   sleeve and T-bill collateral are not sectors, and folding them into the
   denominator overstates every sector weight. Measured here, 37% of the
   portfolio has no equity sector at all. Those land in explicit non-equity
   asset classes and the split is reported, never normalised away.

3. Coverage is a ceiling, not a rounding error. Issuer top-25 tables leave 18.7%
   of this portfolio undisclosed. Whatever cannot be attributed is reported as
   Unclassified rather than being redistributed across the sectors that happen
   to be known.
"""

import re
import threading
from concurrent.futures import ThreadPoolExecutor

from flask import jsonify, request

from config import get_connection
from diversification import (
    _BILL_SYM_PAT,
    _CASH_PAT,
    _DERIV_PAT,
    _DERIV_SYM_PAT,
    _app_module,
    _ensure_bootstrapped,
    _expand_nested,
    _load_cache,
    _name_index,
    _norm_name,
    _norm_symbol,
    _now,
    _portfolio_positions,
    _scope_profile_ids,
)

# ─────────────────────────────────────────────────────────────────────────────
# Taxonomy
# ─────────────────────────────────────────────────────────────────────────────

# The 11 GICS sectors, in the order they are presented. Yahoo publishes exactly
# these eleven under its own spellings, so the mapping below is 1:1 rather than
# a lossy approximation.
SECTORS = [
    "Information Technology",
    "Financials",
    "Health Care",
    "Consumer Discretionary",
    "Communication Services",
    "Industrials",
    "Consumer Staples",
    "Energy",
    "Utilities",
    "Real Estate",
    "Materials",
]
SECTOR_SET = set(SECTORS)

# Yahoo uses two different spellings for the same eleven sectors: snake_case
# keys in a fund's sector_weightings, and title-case labels in an equity's
# quote. Both are normalised to the GICS names above.
_SECTOR_ALIASES = {
    "technology": "Information Technology",
    "information technology": "Information Technology",
    "financial_services": "Financials",
    "financial services": "Financials",
    "financials": "Financials",
    "healthcare": "Health Care",
    "health care": "Health Care",
    "consumer_cyclical": "Consumer Discretionary",
    "consumer cyclical": "Consumer Discretionary",
    "consumer discretionary": "Consumer Discretionary",
    "consumer_defensive": "Consumer Staples",
    "consumer defensive": "Consumer Staples",
    "consumer staples": "Consumer Staples",
    "communication_services": "Communication Services",
    "communication services": "Communication Services",
    "industrials": "Industrials",
    "energy": "Energy",
    "utilities": "Utilities",
    "realestate": "Real Estate",
    "real_estate": "Real Estate",
    "real estate": "Real Estate",
    "basic_materials": "Materials",
    "basic materials": "Materials",
    "materials": "Materials",
}

# Non-equity buckets. These are deliberately *not* sectors: they are what the
# money is in when it is not in equities, and they keep the sector denominator
# honest.
CASH = "Cash & equivalents"
COLLATERAL = "Cash & T-bill collateral"
FIXED_INCOME = "Fixed Income"
COMMODITIES = "Commodities"
DIGITAL = "Digital Assets"
DERIVATIVES = "Options & derivatives"
PRIVATE = "Private markets"
UNCLASSIFIED = "Unclassified"

NON_EQUITY = [CASH, COLLATERAL, FIXED_INCOME, COMMODITIES, DIGITAL,
              DERIVATIVES, PRIVATE]

# diversification.py's exposure map records an asset class per synthetic fund
# (KGLD -> Commodities, BTCI -> Digital Assets). Those names map straight onto
# the buckets above.
_ASSET_CLASS_BUCKET = {
    "commodities": COMMODITIES,
    "digital assets": DIGITAL,
    "fixed income": FIXED_INCOME,
    "cash & equivalents": CASH,
    "cash and equivalents": CASH,
    "private": PRIVATE,
}

# Yahoo's fund `category`, used only when a fund publishes no sector weights of
# its own. Order matters: the first match wins.
#
# Deliberately absent: anything matching "preferred" or "derivative income".
# PFFA and the option-income wrappers *do* publish sector weights, and those
# weights are the better answer — routing them here on a category keyword would
# throw away a real equity breakdown. Commodity keywords are likewise only
# consulted after sector weights come back empty, so an equity precious-metals
# miners fund stays in Materials instead of becoming a gold bar.
_CATEGORY_RULES = [
    (re.compile(r"money\s*market", re.I), CASH),
    (re.compile(r"digital\s*asset|cryptocurrenc|bitcoin|ethereum", re.I), DIGITAL),
    (re.compile(r"commodit|precious\s*metal", re.I), COMMODITIES),
    (re.compile(r"bond|treasury|muni|government|credit|tips|"
                r"inflation-?protected|securitized|bank\s*loan|ultrashort",
                re.I), FIXED_INCOME),
]


def canonical_sector(raw):
    """Yahoo's sector spelling -> the GICS name, or None if unrecognised."""
    if not raw:
        return None
    key = str(raw).strip().lower().replace("-", "_")
    hit = _SECTOR_ALIASES.get(key)
    if hit:
        return hit
    return _SECTOR_ALIASES.get(key.replace("_", " "))


def _asset_class_bucket(raw):
    if not raw:
        return None
    return _ASSET_CLASS_BUCKET.get(str(raw).strip().lower())


def _category_bucket(category):
    if not category:
        return None
    for pat, bucket in _CATEGORY_RULES:
        if pat.search(str(category)):
            return bucket
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Fetching
# ─────────────────────────────────────────────────────────────────────────────

def _is_cef(ticker):
    """Membership of the CEF Connect universe.

    The reason this exists is in the module docstring: a CEF's own quote names
    the wrapper's sector, not the portfolio's, and every one of them comes back
    'Financial Services'. Best-effort — if the universe cannot be read we lose
    the guard rather than the screen, and the fund still resolves through its
    constituents first.
    """
    _app = _app_module("_cef_row_map")
    if _app is None:
        return False
    try:
        return ticker.strip().upper() in (_app._cef_row_map() or {})
    except Exception:
        return False


# CEF Connect's sector grid mixes equity sectors with fixed-income and cash
# sleeves, because a closed-end fund is often not an equity fund at all. These
# are the non-equity leaf labels seen across the funds held here.
_CEF_ASSET_LABELS = [
    (re.compile(r"cash\s*equivalent", re.I), CASH),
    (re.compile(r"swap|derivative", re.I), DERIVATIVES),
    (re.compile(r"municipal|corporate\s*bond|bank\s*loan|government|mortgage|"
                r"asset\s*backed|convertible|preferred\s*stock|securitized|bond",
                re.I), FIXED_INCOME),
]


def _cef_bucket(label):
    """One CEF Connect sector-grid label -> a sector or an asset class."""
    sector = canonical_sector(label)
    if sector:
        return sector
    for pat, bucket in _CEF_ASSET_LABELS:
        if pat.search(label):
            return bucket
    return None


def _fetch_cef_sectors(ticker):
    """Sector split for a closed-end fund, from CEF Connect's own grid.

    Far better than reading the fund's constituents: measured across the 29
    closed-end funds held here, the grid covers a median 97.1% of the fund
    against 42.4% for the published top holdings, and several funds are barely
    covered at all by holdings alone (NAD 6.7%, BCAT 6.4%, VCV 13.5%).

    Two shapes in the data have to be handled or the numbers come out wrong:

    * Rows labelled "(Super Sector)" are Morningstar rollups -- Sensitive,
      Cyclical, Defensive -- that already contain the individual sectors listed
      beside them. Summing both double-counts the entire fund.
    * Leveraged funds report more than 100% (PTY 164.7%, PCN 156.5%) because
      the weights are percent of *net* assets. The caller normalises, so what
      survives is the fund's sector mix rather than its gross exposure.
    """
    _app = _app_module("_cef_portfolio_characteristics")
    if _app is None:
        return {}
    try:
        payload = _app._cef_portfolio_characteristics(ticker) or {}
    except Exception:
        return {}

    weights = {}
    for row in ((payload.get("top_sectors") or {}).get("rows") or []):
        label = (row.get("label") or "").strip()
        if not label or "(Super Sector)" in label:
            continue
        try:
            pct = float(str(row.get("value", "")).replace("%", "").replace(",", "").strip())
        except (TypeError, ValueError):
            continue
        if pct <= 0:
            continue
        bucket = _cef_bucket(label)
        if bucket:
            weights[bucket] = weights.get(bucket, 0.0) + pct
    return weights


def _yahoo_symbol(sym):
    """Candidate Yahoo spellings for a normalised symbol.

    _norm_symbol strips punctuation so BRK.B and BRK-B both store as BRKB,
    which Yahoo cannot look up. Re-inserting the hyphen recovers the share
    class without keeping a hand-maintained alias table.
    """
    out = [sym]
    m = re.match(r"^([A-Z]{2,4})([AB])$", sym)
    if m:
        out.append(f"{m.group(1)}-{m.group(2)}")
    return out


def fetch_sector_profile(ticker):
    """Resolve one security to either an equity sector split or an asset class.

    Returns a dict: kind is 'sectors' (weights populated), 'asset'
    (asset_class populated) or 'none'.
    """
    sym = (ticker or "").strip().upper()
    blank = {"ticker": sym, "kind": "none", "asset_class": None, "weights": {},
             "covered_pct": 0.0, "source": None, "quote_type": None,
             "category": None, "note": None}
    if not sym:
        return blank

    try:
        import yfinance as yf
    except Exception as exc:
        blank["note"] = f"yfinance unavailable: {type(exc).__name__}"
        return blank

    info = {}
    last_err = None
    tk = None
    for candidate in _yahoo_symbol(sym):
        try:
            tk = yf.Ticker(candidate)
            info = tk.info or {}
        except Exception as exc:
            last_err = f"{type(exc).__name__}"
            info = {}
        # Yahoo answers an unknown symbol with the *string* "NONE" rather than
        # an empty quote. Treating that as a hit stopped the alias sweep on its
        # first try, so BRKB never got to ask about BRK-B.
        if (info.get("quoteType") or "").upper() not in {"", "NONE"}:
            break
        info = {}

    quote_type = (info.get("quoteType") or "").upper() or None
    category = info.get("category") or None
    blank["quote_type"] = quote_type
    blank["category"] = category

    # A money-market fund has no sector weights and no category; its quote type
    # is the only signal that it is cash rather than an unresolvable fund.
    if quote_type == "MONEYMARKET":
        return {**blank, "kind": "asset", "asset_class": CASH,
                "covered_pct": 100.0, "source": "quote_type"}

    # Closed-end funds first, from CEF Connect. Yahoo has no fund-level sector
    # data for them at all, and its quote-level sector names the wrapper rather
    # than the portfolio -- see _is_cef.
    if _is_cef(sym):
        cef_weights = _fetch_cef_sectors(sym)
        if cef_weights:
            return {**blank, "kind": "sectors", "weights": cef_weights,
                    "covered_pct": round(sum(cef_weights.values()), 4),
                    "source": "cefconnect_sectors"}

    # Sector weights first. A fund that publishes them is answering the exact
    # question being asked, and its answer covers the whole fund rather than
    # only the constituents an issuer chose to disclose.
    weights = {}
    if tk is not None:
        try:
            raw = tk.funds_data.sector_weightings or {}
        except Exception as exc:
            raw = {}
            last_err = last_err or type(exc).__name__
        for key, value in (raw.items() if hasattr(raw, "items") else []):
            label = canonical_sector(key)
            if not label:
                continue
            try:
                pct = float(value) * 100.0
            except (TypeError, ValueError):
                continue
            if pct > 0:
                weights[label] = weights.get(label, 0.0) + pct

    if weights:
        return {**blank, "kind": "sectors", "weights": weights,
                "covered_pct": round(sum(weights.values()), 4),
                "source": "yahoo_fund_sectors"}

    bucket = _category_bucket(category)
    if bucket:
        return {**blank, "kind": "asset", "asset_class": bucket,
                "covered_pct": 100.0, "source": "yahoo_category"}

    sector = canonical_sector(info.get("sector"))
    if sector and not _is_cef(sym):
        return {**blank, "kind": "sectors", "weights": {sector: 100.0},
                "covered_pct": 100.0, "source": "yahoo_quote"}

    if sector:
        # Expected, not a failure: the CEF guard did its job and the fund will
        # be read through its constituents instead.
        blank["note"] = "CEF quote sector ignored; resolved via constituents"
        blank["source"] = "cef_guard"
    elif last_err:
        blank["note"] = last_err
    return blank


# ─────────────────────────────────────────────────────────────────────────────
# Cache
# ─────────────────────────────────────────────────────────────────────────────

def load_sector_cache(conn):
    profiles = {}
    for row in conn.execute(
        "SELECT ticker, kind, asset_class, covered_pct, source, quote_type, "
        "category, note, updated_at FROM security_sector_profile"
    ).fetchall():
        profiles[row[0]] = {"ticker": row[0], "kind": row[1], "asset_class": row[2],
                            "covered_pct": row[3], "source": row[4],
                            "quote_type": row[5], "category": row[6],
                            "note": row[7], "updated_at": row[8], "weights": {}}
    for tkr, sector, pct in conn.execute(
        "SELECT ticker, sector, weight_pct FROM security_sector_weights"
    ).fetchall():
        if tkr in profiles:
            profiles[tkr]["weights"][sector] = pct
    return profiles


def store_sector_profile(conn, profile):
    tkr = profile["ticker"]
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO security_sector_profile "
        "(ticker, kind, asset_class, covered_pct, source, quote_type, category, note, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(ticker) DO UPDATE SET kind=excluded.kind, "
        "asset_class=excluded.asset_class, covered_pct=excluded.covered_pct, "
        "source=excluded.source, quote_type=excluded.quote_type, "
        "category=excluded.category, note=excluded.note, updated_at=excluded.updated_at",
        (tkr, profile["kind"], profile["asset_class"], profile["covered_pct"],
         profile["source"], profile["quote_type"], profile["category"],
         profile["note"], _now()),
    )
    cur.execute("DELETE FROM security_sector_weights WHERE ticker=?", (tkr,))
    for sector, pct in (profile.get("weights") or {}).items():
        cur.execute(
            "INSERT INTO security_sector_weights (ticker, sector, weight_pct) VALUES (?,?,?)",
            (tkr, sector, pct),
        )
    conn.commit()
    return profile


def resolve_security(ticker, conn, force=False):
    """Cached sector profile for one security."""
    sym = (ticker or "").strip().upper()
    if not sym:
        return None
    if not force:
        cached = load_sector_cache(conn).get(sym)
        if cached and cached["kind"] != "none":
            return cached
    return store_sector_profile(conn, fetch_sector_profile(sym))


# ─────────────────────────────────────────────────────────────────────────────
# Aggregation
# ─────────────────────────────────────────────────────────────────────────────

# Constituents are resolved in descending weight until this much of a fund is
# accounted for. The tail of a 600-row index file is rounding noise and is not
# worth a Yahoo call each.
_CONSTITUENT_COVERAGE_TARGET = 97.0


def _constituent_splits(rows, sector_cache, name_idx, collateral_context):
    """Fold a fund's constituent rows into {bucket: percent of fund}."""
    splits = {}
    covered = 0.0
    for r in rows:
        weight = r.get("weight_pct")
        if not weight:
            continue
        covered += weight
        sym = _norm_symbol(r.get("symbol") or "")
        name = r.get("name") or sym
        if not sym:
            sym = name_idx.get(_norm_name(name)) or ""

        if _CASH_PAT.search(name) or _BILL_SYM_PAT.match(sym):
            bucket = COLLATERAL if collateral_context else CASH
        elif _DERIV_PAT.search(name) or _DERIV_SYM_PAT.search(sym):
            bucket = DERIVATIVES
        else:
            prof = sector_cache.get(sym) if sym else None
            if prof and prof["kind"] == "sectors" and prof["weights"]:
                scale = weight / (sum(prof["weights"].values()) or 100.0)
                for sector, pct in prof["weights"].items():
                    splits[sector] = splits.get(sector, 0.0) + pct * scale
                continue
            if prof and prof["kind"] == "asset" and prof["asset_class"]:
                bucket = prof["asset_class"]
            else:
                bucket = UNCLASSIFIED
        splits[bucket] = splits.get(bucket, 0.0) + weight

    return splits, min(covered, 100.0)


def _position_splits(tkr, meta, holdings, exposure, sector_cache, name_idx,
                     mode, nest_depth=2):
    """How one position divides across sectors and asset classes.

    Returns ({bucket: percent of position}, source).
    """
    info = meta.get(tkr, {})
    if info.get("status") == "cash":
        return {CASH: 100.0}, "cash_position"

    # Economic exposure wins where it is defined: KGLD files three T-bill rows
    # and is a gold fund, so its literal holdings are the wrong answer.
    if mode == "economic" and exposure.get(tkr):
        splits = {}
        for row in exposure[tkr]:
            pct = row.get("weight_pct") or 0.0
            if not pct:
                continue
            bucket = _asset_class_bucket(row.get("asset_class"))
            if bucket:
                splits[bucket] = splits.get(bucket, 0.0) + pct
                continue
            sym = _norm_symbol(row.get("symbol") or "")
            prof = sector_cache.get(sym) if sym else None
            if prof and prof["kind"] == "sectors" and prof["weights"]:
                scale = pct / (sum(prof["weights"].values()) or 100.0)
                for sector, weight in prof["weights"].items():
                    splits[sector] = splits.get(sector, 0.0) + weight * scale
            else:
                splits[UNCLASSIFIED] = splits.get(UNCLASSIFIED, 0.0) + pct
        if splits:
            return splits, "exposure_map"

    prof = sector_cache.get(tkr)

    # A published sector breakdown covers the whole fund, including the part its
    # holdings file never discloses, so it beats the constituent roll-up.
    if prof and prof["kind"] == "sectors" and prof["weights"]:
        total = sum(prof["weights"].values()) or 100.0
        splits = {s: 100.0 * w / total for s, w in prof["weights"].items()}
        return splits, prof.get("source") or "sector_weights"

    if prof and prof["kind"] == "asset" and prof["asset_class"]:
        return {prof["asset_class"]: 100.0}, prof.get("source") or "asset_class"

    # Constituent roll-up. This is what carries closed-end funds, whose own
    # quote would put every one of them in Financials.
    rows = holdings.get(tkr)
    if rows:
        filed = holdings.get(tkr, [])
        collateral_context = any(
            _DERIV_PAT.search(r.get("name") or "")
            or _DERIV_SYM_PAT.search(r.get("symbol") or "")
            for r in filed
        ) or any(
            (r.get("weight_pct") or 0) < -1
            and (_CASH_PAT.search(r.get("name") or "")
                 or _BILL_SYM_PAT.match(r.get("symbol") or ""))
            for r in filed
        )
        expanded = _expand_nested(rows, holdings, meta, depth=nest_depth)
        splits, covered = _constituent_splits(
            expanded, sector_cache, name_idx, collateral_context)
        if covered < 99.5:
            splits[UNCLASSIFIED] = splits.get(UNCLASSIFIED, 0.0) + (100.0 - covered)
        if splits:
            return splits, "constituents"

    return {UNCLASSIFIED: 100.0}, "unresolved"


def build_sector_exposure(conn, profile_ids=None, mode="economic", nest_depth=2):
    positions = _portfolio_positions(conn, profile_ids)
    total = sum(v for _, v in positions)
    holdings, meta, exposure = _load_cache(conn)
    sector_cache = load_sector_cache(conn)
    name_idx = _name_index(holdings)

    buckets = {}
    per_position = []
    # A position is "direct" when the sector is the security's own rather than
    # something it holds — a share of NVDA, not a slice of a fund that holds
    # NVDA. The screen reports the two separately because they are different
    # kinds of exposure: one you chose by name, the other you inherited.
    direct = set()

    for tkr, value in positions:
        splits, source = _position_splits(
            tkr, meta, holdings, exposure, sector_cache, name_idx, mode, nest_depth)
        if source == "yahoo_quote" or meta.get(tkr, {}).get("status") == "self":
            direct.add(tkr)
        scale = sum(splits.values()) or 100.0
        for bucket, pct in splits.items():
            share = value * (pct / scale)
            # Negative shares are kept. Holdings files carry short and financing
            # lines at negative weight, and discarding them here made the
            # buckets sum to more than the portfolio -- measured at +0.26%,
            # which is small enough to look like rounding and is not.
            b = buckets.setdefault(bucket, {"value": 0.0, "contributions": {}})
            b["value"] += share
            b["contributions"][tkr] = b["contributions"].get(tkr, 0.0) + share
        per_position.append({
            "ticker": tkr,
            "value": round(value, 2),
            "portfolio_pct": round(100.0 * value / total, 4) if total else 0.0,
            "source": source,
            "resolved": source != "unresolved",
        })

    equity_value = sum(b["value"] for name, b in buckets.items() if name in SECTOR_SET)

    def rows_for(names, kind):
        out = []
        for name in names:
            b = buckets.get(name)
            # Kept when negative, dropped only when it rounds to nothing: a
            # net-short collateral line is a real position, not an empty bucket.
            if not b or round(b["value"], 2) == 0:
                continue
            out.append({
                "name": name,
                "kind": kind,
                "value": round(b["value"], 2),
                # Two denominators, both reported, because they answer different
                # questions: portfolio_pct is how much of your money this is,
                # sector_pct is how your equity sleeve is tilted. A screen that
                # shows only the second silently prices a bond fund into the
                # sector weights.
                "portfolio_pct": round(100.0 * b["value"] / total, 4) if total else 0.0,
                "sector_pct": (round(100.0 * b["value"] / equity_value, 4)
                               if kind == "sector" and equity_value else None),
                "contributors": [
                    {"ticker": t, "value": round(v, 2),
                     "portfolio_pct": round(100.0 * v / total, 4) if total else 0.0,
                     "direct": t in direct}
                    for t, v in sorted(b["contributions"].items(),
                                       key=lambda kv: -abs(kv[1]))
                ],
                "direct_pct": round(
                    100.0 * sum(v for t, v in b["contributions"].items() if t in direct) / total, 4
                ) if total else 0.0,
            })
        out.sort(key=lambda r: -r["value"])
        return out

    sectors = rows_for(SECTORS, "sector")
    other = rows_for(NON_EQUITY, "asset") + rows_for([UNCLASSIFIED], "unclassified")
    other.sort(key=lambda r: -r["value"])

    non_equity_value = sum(r["value"] for r in other)
    unresolved = [p for p in per_position if not p["resolved"]]

    return {
        "total_value": round(total, 2),
        "position_count": len(positions),
        "mode": mode,
        "sectors": sectors,
        "other": other,
        "sector_count": len(sectors),
        "sector_universe": len(SECTORS),
        "equity_value": round(equity_value, 2),
        "equity_pct": round(100.0 * equity_value / total, 4) if total else 0.0,
        "non_equity_value": round(non_equity_value, 2),
        "non_equity_pct": round(100.0 * non_equity_value / total, 4) if total else 0.0,
        "unclassified_pct": round(
            100.0 * (buckets.get(UNCLASSIFIED, {}).get("value", 0.0)) / total, 4
        ) if total else 0.0,
        "positions": sorted(per_position, key=lambda r: -r["value"]),
        "unresolved_positions": len(unresolved),
        # Nothing has ever been fetched here. A fresh install otherwise looks
        # identical to a portfolio nothing could be determined for, and the two
        # need opposite advice.
        "cache_empty": not sector_cache,
        "concentration": _concentration(sectors, equity_value),
    }


def _concentration(sectors, equity_value):
    """Plain-language read on how evenly the equity sleeve is spread.

    Even weight is the yardstick: with 11 sectors that is 9.09% each, so a
    sector carrying more than double its even share is the thing worth naming.
    Deliberately descriptive — it reports what the allocation *is* and leaves
    what to do about it to the person holding it.
    """
    if not sectors or not equity_value:
        return {"covered": 0, "universe": len(SECTORS), "even_pct": None,
                "overweight": [], "level": "unknown", "hhi": None,
                "top_sector": None, "top_pct": None}

    even = 100.0 / len(SECTORS)
    shares = [(r["name"], 100.0 * r["value"] / equity_value)
              for r in sectors if r["value"] > 0]
    if not shares:
        return {"covered": 0, "universe": len(SECTORS), "even_pct": None,
                "overweight": [], "level": "unknown", "hhi": None,
                "top_sector": None, "top_pct": None}
    shares.sort(key=lambda kv: -kv[1])
    overweight = [{"name": n, "sector_pct": round(p, 2),
                   "times_even": round(p / even, 2)}
                  for n, p in shares if p >= even * 2]
    hhi = sum((p / 100.0) ** 2 for _n, p in shares)

    top_name, top_pct = shares[0]
    if top_pct >= 40 or hhi >= 0.25:
        level = "high"
    elif top_pct >= 25 or hhi >= 0.18:
        level = "moderate"
    else:
        level = "low"

    return {
        "covered": len(sectors),
        "universe": len(SECTORS),
        "even_pct": round(even, 2),
        "overweight": overweight,
        "level": level,
        "hhi": round(hhi, 4),
        "top_sector": top_name,
        "top_pct": round(top_pct, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Refresh job
# ─────────────────────────────────────────────────────────────────────────────

_JOB = {"running": False, "done": 0, "total": 0, "current": "", "started": None,
        "finished": None, "errors": [], "summary": None}
_JOB_LOCK = threading.Lock()


def _needs_profile(cache, sym, force):
    if not sym:
        return False
    if force:
        return True
    prof = cache.get(sym)
    return not prof or prof["kind"] == "none"


def _position_targets(conn, profile_ids, force):
    """The portfolio's own tickers that still need a sector profile."""
    cache = load_sector_cache(conn)
    return [t for t, _v in _portfolio_positions(conn, profile_ids)
            if _needs_profile(cache, t, force)]


def _constituent_targets(conn, profile_ids, force):
    """Constituents of funds that will fall through to the roll-up.

    Deliberately computed *after* the positions themselves are resolved, not
    alongside them. Most funds publish their own sector split and never touch
    their constituents, but on an empty cache none of them look resolved yet —
    chasing constituents up front asked for 4,069 lookups where a few hundred
    are needed.

    Constituents are taken in descending weight and stopped once the fund is
    mostly accounted for, so a 600-row index file costs a handful of lookups
    rather than six hundred.
    """
    holdings, meta, exposure = _load_cache(conn)
    cache = load_sector_cache(conn)
    targets = []
    seen = set()

    for tkr, _value in _portfolio_positions(conn, profile_ids):
        prof = cache.get(tkr)
        # A fund with its own published sector split never consults its
        # constituents, so resolving them would be wasted lookups.
        if prof and prof["kind"] in {"sectors", "asset"}:
            continue
        # A fund with an economic-exposure mapping is a synthetic whose filed
        # holdings are T-bills and option legs. Those need no sector lookup in
        # either mode, so its constituents are never worth chasing.
        if exposure.get(tkr):
            continue
        rows = holdings.get(tkr)
        if not rows:
            continue
        expanded = sorted(_expand_nested(rows, holdings, meta, depth=2),
                          key=lambda r: -(r.get("weight_pct") or 0))
        covered = 0.0
        for r in expanded:
            if covered >= _CONSTITUENT_COVERAGE_TARGET:
                break
            covered += r.get("weight_pct") or 0
            name = r.get("name") or ""
            sym = _norm_symbol(r.get("symbol") or "")
            if not sym or sym in seen:
                continue
            seen.add(sym)
            if _CASH_PAT.search(name) or _BILL_SYM_PAT.match(sym):
                continue
            if _DERIV_PAT.search(name) or _DERIV_SYM_PAT.search(sym):
                continue
            if _needs_profile(cache, sym, force):
                targets.append(sym)

    return targets


def _safe_fetch(ticker):
    try:
        return fetch_sector_profile(ticker)
    except Exception as exc:
        return {"ticker": ticker, "kind": "none", "asset_class": None, "weights": {},
                "covered_pct": 0.0, "source": None, "quote_type": None,
                "category": None, "note": f"{type(exc).__name__}: {str(exc)[:120]}"}


def _run_refresh(tickers, force, profile_ids=None):
    with _JOB_LOCK:
        _JOB.update(running=True, done=0, total=len(tickers), current="",
                    started=_now(), finished=None, errors=[], summary=None)
    conn = None
    try:
        conn = get_connection()
        counts = {}

        def sweep(batch):
            # Fetched in parallel, written from this thread only: sqlite
            # connections are not shared across threads, and the writes are far
            # cheaper than the network calls anyway.
            with ThreadPoolExecutor(max_workers=4) as ex:
                for prof in ex.map(_safe_fetch, batch):
                    try:
                        store_sector_profile(conn, prof)
                    except Exception as exc:
                        with _JOB_LOCK:
                            _JOB["errors"].append(f"{prof['ticker']}: {str(exc)[:120]}")
                    counts[prof["kind"]] = counts.get(prof["kind"], 0) + 1
                    # The CEF guard is a designed outcome, not a problem to
                    # report -- listing it made a working sweep look like it
                    # had failed on a third of the closed-end funds.
                    if (prof["kind"] == "none" and prof.get("note")
                            and prof.get("source") != "cef_guard"):
                        with _JOB_LOCK:
                            _JOB["errors"].append(f"{prof['ticker']}: {prof['note'][:100]}")
                    with _JOB_LOCK:
                        _JOB["done"] += 1
                        _JOB["current"] = prof["ticker"]

        sweep(tickers)

        # Second pass, now that the positions have answered for themselves:
        # only the funds still without a profile need their constituents.
        extra = _constituent_targets(conn, profile_ids, force)
        if extra:
            with _JOB_LOCK:
                _JOB["total"] += len(extra)
            sweep(extra)

        with _JOB_LOCK:
            _JOB["summary"] = counts
    except Exception as exc:
        with _JOB_LOCK:
            _JOB["errors"].append(f"refresh failed: {type(exc).__name__}: {str(exc)[:200]}")
    finally:
        with _JOB_LOCK:
            _JOB.update(running=False, finished=_now())
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

def register_routes(app):

    @app.route("/api/sector-exposure", methods=["GET"])
    def api_sector_exposure():
        mode = "literal" if request.args.get("mode", "economic") == "literal" else "economic"
        scope = _scope_profile_ids()
        conn = get_connection()
        try:
            _ensure_bootstrapped(conn)
            return jsonify(build_sector_exposure(conn, scope, mode))
        finally:
            conn.close()

    @app.route("/api/sector-exposure/security/<ticker>", methods=["GET"])
    def api_sector_security(ticker):
        sym = ticker.strip().upper()
        conn = get_connection()
        try:
            prof = load_sector_cache(conn).get(sym)
            return jsonify(prof or {"ticker": sym, "kind": "none", "weights": {}})
        finally:
            conn.close()

    @app.route("/api/sector-exposure/refresh", methods=["POST"])
    def api_sector_refresh():
        with _JOB_LOCK:
            if _JOB["running"]:
                return jsonify({"ok": False, "error": "A sector refresh is already running."}), 409
        force = bool((request.get_json(silent=True) or {}).get("force"))
        scope = _scope_profile_ids()
        conn = get_connection()
        try:
            _ensure_bootstrapped(conn)
            targets = _position_targets(conn, scope, force)
            # The constituent pass is sized only after the positions resolve,
            # so an "already resolved" answer has to consider it too.
            pending = targets or _constituent_targets(conn, scope, force)
        finally:
            conn.close()
        if not pending:
            return jsonify({"ok": True, "total": 0, "note": "Everything is already resolved."})
        threading.Thread(target=_run_refresh, args=(targets, force, scope),
                         daemon=True).start()
        return jsonify({"ok": True, "total": len(targets) or len(pending)})

    @app.route("/api/sector-exposure/refresh/status", methods=["GET"])
    def api_sector_refresh_status():
        with _JOB_LOCK:
            return jsonify(dict(_JOB))
