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
import math
import re
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


def _clean_text(value) -> str:
    return str(value or "").strip()


def _clean_upper(value) -> str:
    return _clean_text(value).upper()


def _num(value, default=None):
    try:
        if value is None:
            return default
        n = float(value)
        if math.isnan(n) or math.isinf(n):
            return default
        return n
    except (TypeError, ValueError):
        return default


def _yield_ratio(value):
    y = _num(value)
    if y is None or y < 0:
        return None
    if y > 100:
        return y / 10000.0
    return y / 100.0 if y > 1 else y


def _freq_bucket(value):
    raw = _clean_text(value).upper()
    if raw in {"W", "52", "WEEKLY"}:
        return "W"
    if raw in {"M", "12", "MONTHLY"}:
        return "M"
    if raw in {"Q", "4", "QUARTERLY"}:
        return "Q"
    if raw in {"SA", "S", "2", "SEMIANNUAL", "SEMI-ANNUAL"}:
        return "SA"
    if raw in {"A", "1", "ANNUAL", "YEARLY"}:
        return "A"
    return raw or None


def _is_preferred_symbol(ticker: str) -> bool:
    symbol = _clean_upper(ticker)
    return bool(re.match(r"^[A-Z]+-?P[A-Z]$", symbol) or re.match(r"^[A-Z]+-?PR[A-Z]$", symbol))


def _profile_text(profile: dict) -> str:
    fields = (
        "ticker", "name", "description", "classification_type", "asset_type",
        "sector", "industry", "etf_category", "etf_strategy", "provider",
        "category",
    )
    return " ".join(_clean_text(profile.get(f)) for f in fields).lower()


def _asset_family(profile: dict) -> str:
    text = _profile_text(profile)
    asset_type = _clean_text(profile.get("asset_type")).lower()
    classification = _clean_text(profile.get("classification_type")).lower()
    ticker = _clean_upper(profile.get("ticker"))

    if _is_preferred_symbol(ticker) or "preferred" in text:
        return "preferred"
    if "closed-end" in text or "closed end" in text or " cef" in f" {text} ":
        return "cef"
    if "bdc" in text or "business development" in text:
        return "bdc"
    if "reit" in text or "real estate investment trust" in text:
        return "reit"
    if any(term in text for term in ("etf", "fund", "trust")) or asset_type in {"etf", "fund"} or classification in {"etf", "fund"}:
        return "fund"
    if asset_type in {"stock", "equity"} or classification in {"stock", "equity"}:
        return "stock"
    return "security"


def _profile_tags(profile: dict) -> set[str]:
    text = _profile_text(profile)
    y = profile.get("yield")
    tags: set[str] = set()

    if any(term in text for term in ("covered call", "option income", "premium income", "incomemax", "yieldmax", "defiance", "rex shares", "neos")):
        tags.add("option_income")
    if any(term in text for term in ("income", "yield", "dividend", "distribution")) or (y is not None and y >= 0.06):
        tags.add("income")
    if "dividend" in text:
        tags.add("dividend")
    if any(term in text for term in ("bond", "fixed income", "treasury", "municipal", "muni", "high yield", "credit")):
        tags.add("fixed_income")
    if any(term in text for term in ("treasury", "t-bill", "t bill")):
        tags.add("treasury")
    if any(term in text for term in ("municipal", "muni")):
        tags.add("muni")
    if any(term in text for term in ("growth", "nasdaq", "innovation")):
        tags.add("growth")
    if any(term in text for term in ("s&p 500", "total market", "large blend", "broad market")):
        tags.add("broad_equity")
    if any(term in text for term in ("covered call", "call writing", "buywrite")):
        tags.add("covered_call")
    if _asset_family(profile) in {"preferred", "reit", "bdc", "cef"}:
        tags.add(_asset_family(profile))
    return tags


def _fetchone_dict(conn, sql: str, params: list | tuple) -> dict:
    row = conn.execute(sql, params).fetchone()
    return dict(row) if row else {}


def _source_profile(conn, ticker: str, profile_ids: list[int]) -> dict:
    placeholders = ",".join("?" * len(profile_ids))
    ticker = _clean_upper(ticker)
    holding = _fetchone_dict(conn, f"""
        SELECT ticker,
               MAX(description) AS description,
               MAX(classification_type) AS classification_type,
               SUM(current_value) AS current_value,
               SUM(estim_payment_per_year) AS annual_income,
               MAX(current_annual_yield) AS holding_yield,
               MAX(div_frequency) AS div_frequency
        FROM all_account_info
        WHERE UPPER(ticker) = ?
          AND profile_id IN ({placeholders})
        GROUP BY UPPER(ticker)
    """, [ticker, *profile_ids])

    if not holding:
        holding = _fetchone_dict(conn, f"""
            SELECT h.ticker,
                   MAX(h.description) AS description,
                   MAX(h.classification_type) AS classification_type,
                   SUM(h.current_value) AS current_value,
                   NULL AS annual_income,
                   MAX(d.current_annual_yield) AS holding_yield,
                   MAX(d.div_frequency) AS div_frequency
            FROM holdings h
            LEFT JOIN dividends d
              ON UPPER(d.ticker) = UPPER(h.ticker)
             AND d.profile_id = h.profile_id
            WHERE UPPER(h.ticker) = ?
              AND h.profile_id IN ({placeholders})
            GROUP BY UPPER(h.ticker)
        """, [ticker, *profile_ids])

    scanner = _fetchone_dict(conn, """
        SELECT ticker, name, sector, industry, asset_type, etf_category, etf_strategy,
               dividend_yield, market_cap, aum
        FROM general_scanner_cache
        WHERE UPPER(ticker) = ?
        LIMIT 1
    """, [ticker])

    provider = _fetchone_dict(conn, """
        SELECT f.symbol AS ticker, f.fund_name AS name, f.div_yield, f.frequency,
               f.assets, p.provider
        FROM etf_provider_funds f
        JOIN etf_providers p ON p.id = f.provider_id
        WHERE UPPER(f.symbol) = ?
        LIMIT 1
    """, [ticker])

    cats = conn.execute(f"""
        SELECT DISTINCT c.name
        FROM ticker_categories tc
        JOIN categories c ON c.id = tc.category_id
        WHERE UPPER(tc.ticker) = ?
          AND tc.profile_id IN ({placeholders})
    """, [ticker, *profile_ids]).fetchall()
    category_names = [_clean_text(r["name"]) for r in cats if _clean_text(r["name"])]

    current_value = _num(holding.get("current_value"), 0) or 0
    annual_income = _num(holding.get("annual_income"))
    holding_yield = _yield_ratio(holding.get("holding_yield"))
    scanner_yield = _yield_ratio(scanner.get("dividend_yield"))
    provider_yield = _yield_ratio(provider.get("div_yield"))
    income_yield = (annual_income / current_value) if annual_income is not None and current_value > 0 else None
    y = next((v for v in (income_yield, holding_yield, scanner_yield, provider_yield) if v is not None), None)

    profile = {
        "ticker": ticker,
        "description": holding.get("description"),
        "classification_type": holding.get("classification_type"),
        "current_value": current_value,
        "yield": y,
        "div_frequency": _freq_bucket(holding.get("div_frequency") or provider.get("frequency")),
        "name": scanner.get("name") or provider.get("name") or holding.get("description"),
        "sector": scanner.get("sector"),
        "industry": scanner.get("industry"),
        "asset_type": scanner.get("asset_type"),
        "etf_category": scanner.get("etf_category"),
        "etf_strategy": scanner.get("etf_strategy"),
        "provider": provider.get("provider"),
        "category": ", ".join(category_names),
        "category_names": category_names,
    }
    profile["asset_family"] = _asset_family(profile)
    profile["tags"] = _profile_tags(profile)
    return profile


def _candidate_universe(conn, source: dict, profile_ids: list[int], blocked: set[str]) -> dict[str, dict]:
    placeholders = ",".join("?" * len(profile_ids))
    universe: dict[str, dict] = {}

    def add(ticker, source_label, **fields):
        t = _clean_upper(ticker)
        if not t or t in blocked:
            return
        existing = universe.setdefault(t, {"ticker": t, "sources": set()})
        existing["sources"].add(source_label)
        for k, v in fields.items():
            if v not in (None, "") and existing.get(k) in (None, ""):
                existing[k] = v

    for cat in source.get("category_names") or []:
        rows = conn.execute(f"""
            SELECT DISTINCT UPPER(tc.ticker) AS ticker
            FROM ticker_categories tc
            JOIN categories c ON c.id = tc.category_id
            WHERE c.name = ?
              AND tc.profile_id IN ({placeholders})
        """, [cat, *profile_ids]).fetchall()
        for r in rows:
            add(r["ticker"], "same user category", category=cat)

    for r in conn.execute("SELECT ticker FROM swap_candidates WHERE profile_id IN ({})".format(placeholders), profile_ids).fetchall():
        add(r["ticker"], "swap list")

    for field, source_label in (("etf_strategy", "same ETF strategy"), ("etf_category", "same ETF category"), ("industry", "same industry")):
        value = source.get(field)
        if not value:
            continue
        rows = conn.execute(f"""
            SELECT ticker, name, sector, industry, asset_type, etf_category, etf_strategy,
                   dividend_yield, market_cap, aum
            FROM general_scanner_cache
            WHERE UPPER(ticker) != ?
              AND {field} = ?
            ORDER BY COALESCE(aum, market_cap, 0) DESC
            LIMIT 100
        """, [source["ticker"], value]).fetchall()
        for row in rows:
            d = dict(row)
            add(
                d["ticker"], source_label,
                name=d.get("name"), sector=d.get("sector"), industry=d.get("industry"),
                asset_type=d.get("asset_type"), etf_category=d.get("etf_category"),
                etf_strategy=d.get("etf_strategy"), yield_value=d.get("dividend_yield"),
                size=d.get("aum") or d.get("market_cap"),
            )

    scanner_clauses = []
    params = []
    for field in ("asset_type", "etf_category", "etf_strategy", "sector", "industry"):
        value = source.get(field)
        if value:
            scanner_clauses.append(f"{field} = ?")
            params.append(value)
    if source.get("yield") is not None:
        scanner_clauses.append("dividend_yield IS NOT NULL")
    if scanner_clauses:
        rows = conn.execute(f"""
            SELECT ticker, name, sector, industry, asset_type, etf_category, etf_strategy,
                   dividend_yield, market_cap, aum
            FROM general_scanner_cache
            WHERE UPPER(ticker) != ?
              AND ({' OR '.join(scanner_clauses)})
            ORDER BY COALESCE(aum, market_cap, 0) DESC
            LIMIT 250
        """, [source["ticker"], *params]).fetchall()
        for row in rows:
            d = dict(row)
            add(
                d["ticker"], "scanner match",
                name=d.get("name"), sector=d.get("sector"), industry=d.get("industry"),
                asset_type=d.get("asset_type"), etf_category=d.get("etf_category"),
                etf_strategy=d.get("etf_strategy"), yield_value=d.get("dividend_yield"),
                size=d.get("aum") or d.get("market_cap"),
            )

    if source.get("asset_family") in {"fund", "cef"} or source.get("yield"):
        provider_rows = conn.execute("""
            SELECT f.symbol AS ticker, f.fund_name AS name, f.div_yield, f.frequency,
                   f.assets, p.provider
            FROM etf_provider_funds f
            JOIN etf_providers p ON p.id = f.provider_id
            WHERE UPPER(f.symbol) != ?
            ORDER BY COALESCE(f.assets, 0) DESC
            LIMIT 600
        """, [source["ticker"]]).fetchall()
        for row in provider_rows:
            d = dict(row)
            add(
                d["ticker"], "ETF provider universe",
                name=d.get("name"), provider=d.get("provider"), yield_value=d.get("div_yield"),
                div_frequency=d.get("frequency"), size=d.get("assets"),
                asset_type="ETF",
            )

    for t, profile in list(universe.items()):
        div = _fetchone_dict(conn, """
            SELECT current_annual_yield, div_frequency
            FROM dividends
            WHERE UPPER(ticker) = ?
            LIMIT 1
        """, [t])
        if div:
            profile.setdefault("yield_value", div.get("current_annual_yield"))
            profile.setdefault("div_frequency", div.get("div_frequency"))
        scanner = _fetchone_dict(conn, """
            SELECT name, sector, industry, asset_type, etf_category, etf_strategy,
                   dividend_yield, market_cap, aum
            FROM general_scanner_cache
            WHERE UPPER(ticker) = ?
            LIMIT 1
        """, [t])
        if scanner:
            for k in ("name", "sector", "industry", "asset_type", "etf_category", "etf_strategy"):
                profile.setdefault(k, scanner.get(k))
            profile.setdefault("yield_value", scanner.get("dividend_yield"))
            profile.setdefault("size", scanner.get("aum") or scanner.get("market_cap"))
        profile["yield"] = _yield_ratio(profile.get("yield_value"))
        profile["div_frequency"] = _freq_bucket(profile.get("div_frequency"))
        profile["asset_family"] = _asset_family(profile)
        profile["tags"] = _profile_tags(profile)

    return universe


def _compatible_family(source_family: str, candidate_family: str) -> bool:
    if source_family == candidate_family:
        return True
    if source_family == "fund" and candidate_family in {"cef"}:
        return True
    if source_family == "cef" and candidate_family in {"fund"}:
        return True
    return source_family == "security"


def _score_replacement(source: dict, candidate: dict) -> tuple[float, list[str], list[str]]:
    score = 0.0
    reasons: list[str] = []
    warnings: list[str] = []

    if not _compatible_family(source.get("asset_family"), candidate.get("asset_family")):
        return -999, [], ["Different security type"]
    score += 25
    reasons.append(f"Type: {candidate.get('asset_family')}")

    for field, label, points in (
        ("category", "same user category", 35),
        ("etf_category", "same ETF category", 28),
        ("etf_strategy", "same ETF strategy", 22),
        ("sector", "same sector", 18),
        ("industry", "same industry", 14),
    ):
        sv = _clean_text(source.get(field)).lower()
        cv = _clean_text(candidate.get(field)).lower()
        if sv and cv and sv == cv:
            score += points
            reasons.append(label)

    source_tags = source.get("tags") or set()
    cand_tags = candidate.get("tags") or set()
    important = {"option_income", "covered_call", "fixed_income", "preferred", "reit", "bdc", "cef"}
    for tag in sorted(source_tags & cand_tags):
        score += 12 if tag in important else 7
        reasons.append(tag.replace("_", " "))
    for tag in sorted(source_tags & important - cand_tags):
        score -= 35
        warnings.append(f"Missing {tag.replace('_', ' ')} exposure")

    sy = source.get("yield")
    cy = candidate.get("yield")
    if sy is not None and sy > 0:
        if cy is None:
            score -= 18 if ("income" in source_tags or sy >= 0.04) else 4
            warnings.append("Yield unavailable")
        else:
            diff = abs(cy - sy)
            rel = diff / max(sy, 0.01)
            score += max(0, 34 * (1 - min(rel, 1)))
            reasons.append(f"yield within {diff * 100:.1f} pts")
            if ("income" in source_tags or sy >= 0.04) and cy < max(sy * 0.55, sy - 0.05):
                score -= 28
                warnings.append("Income materially lower")

    sf = source.get("div_frequency")
    cf = candidate.get("div_frequency")
    if sf and cf:
        if sf == cf:
            score += 10
            reasons.append("same payout frequency")
        elif sy is not None and sy >= 0.04:
            score -= 8
            warnings.append("Different payout frequency")

    size = _num(candidate.get("size"), 0) or 0
    if size > 0:
        score += min(8, math.log10(max(size, 1)) / 2)

    return score, reasons, warnings


def candidate_replacements(conn, ticker: str, scope: dict, limit: int = 5) -> list[dict]:
    """Suggest replacement candidates for a losing ticker.

    Candidates are ranked for economic similarity to the harvested position:
    security/fund type, category/strategy, income yield, payout frequency, and
    broad exposure. Substantially-identical and currently-held tickers are
    always excluded.
    """
    ticker = _clean_upper(ticker)
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

    source = _source_profile(conn, ticker, pids)
    universe = _candidate_universe(conn, source, pids, blocked)
    source_tags = source.get("tags") or set()
    source_yield = source.get("yield")

    ranked = []
    for cand in universe.values():
        score, reasons, warnings = _score_replacement(source, cand)
        if score < 35:
            continue
        if source_yield is not None and source_yield >= 0.04:
            candidate_yield = cand.get("yield")
            if "income" not in (cand.get("tags") or set()) and (candidate_yield is None or candidate_yield < source_yield * 0.5):
                continue
        if "option_income" in source_tags and "option_income" not in (cand.get("tags") or set()):
            continue
        ranked.append((score, cand, reasons, warnings))

    ranked.sort(key=lambda item: item[0], reverse=True)

    suggestions = []
    for score, cand, reasons, warnings in ranked[:limit]:
        y = cand.get("yield")
        sy = source.get("yield")
        suggestions.append({
            "ticker": cand["ticker"],
            "category": cand.get("category") or cand.get("etf_category") or cand.get("sector") or ", ".join(sorted(cand.get("sources", []))),
            "name": cand.get("name"),
            "type": cand.get("asset_family"),
            "yield": y,
            "yield_delta": round((y - sy), 6) if y is not None and sy is not None else None,
            "frequency": cand.get("div_frequency"),
            "score": round(score, 1),
            "match_reasons": reasons[:5],
            "warnings": warnings[:3],
        })
    return suggestions
