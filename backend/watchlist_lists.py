"""Named watchlists stored locally.

The flat ``watchlist_watching`` table stays in place so scanners, the dividend
calendar, and the command palette keep reading one ticker set. It is a
projection of every list: the list rows are the source of truth.
"""

import json
import re

ICONS = ("chart", "laptop", "crown", "rocket", "shield", "star", "bolt", "globe")
COLORS = (
    "#7c8cff",
    "#3ecf8e",
    "#f5a524",
    "#ef5350",
    "#42a5f5",
    "#ec407a",
    "#ab47bc",
    "#26c6da",
)
DEFAULT_ICON = ICONS[0]
DEFAULT_COLOR = COLORS[0]
TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")

# Exact symbols whose issuer name must win over a fuzzy catalog hit.
# TDAQ is the TappAlpha Innovation 100 fund, not an unrelated listing.
KNOWN_FUNDS = {
    "TDAQ": {
        "name": "TappAlpha Innovation 100 Growth & Daily Income ETF",
        "issuer": "TappAlpha",
    },
    "TSPY": {
        "name": "TappAlpha SPY Growth & Daily Income ETF",
        "issuer": "TappAlpha",
    },
}

QUOTE_FIELDS = (
    "name",
    "price",
    "change_1d",
    "div_yield",
    "div_yield_source",
    "aum",
    "next_ex_date",
    "one_yr_ret",
)
HISTORY_FIELDS = (
    "div_growth_5y",
    "div_yield",
    "div_yield_source",
    "one_yr_ret",
    "cov_sig",
    "nav_erosion_prob",
    "benchmark",
    "benchmark_valid",
    "nav_tested",
)


def _row_value(row, key, index):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return row[index]


def normalize_ticker(value):
    ticker = str(value or "").strip().upper()
    if not TICKER_RE.fullmatch(ticker):
        return ""
    return ticker


def known_fund(ticker):
    return KNOWN_FUNDS.get(normalize_ticker(ticker))


def _clean_text(value, limit):
    text = str(value or "").strip()
    return text[:limit]


def _clean_icon(value):
    icon = str(value or "").strip().lower()
    return icon if icon in ICONS else DEFAULT_ICON


def _clean_color(value):
    color = str(value or "").strip().lower()
    if color in COLORS:
        return color
    return DEFAULT_COLOR


def _clean_scope(value):
    scope = str(value or "auto").strip().lower()
    return scope if scope in ("auto", "test", "skip") else "auto"


def _clean_override(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def _clean_benchmark(value):
    text = str(value or "").strip().upper()
    return text[:40]


def ensure_watchlist_schema(conn):
    """Create the list tables and adopt an existing single watchlist once."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS watchlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            icon TEXT NOT NULL DEFAULT 'chart',
            color TEXT NOT NULL DEFAULT '#7c8cff',
            is_default INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS watchlist_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            watchlist_id INTEGER NOT NULL,
            ticker TEXT NOT NULL,
            name TEXT,
            notes TEXT,
            div_yield_override REAL,
            nav_erosion_scope TEXT NOT NULL DEFAULT 'auto',
            nav_benchmark_override TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            added_date TEXT NOT NULL DEFAULT (date('now')),
            UNIQUE (watchlist_id, ticker)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS watchlist_market_cache (
            ticker TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    list_count = conn.execute("SELECT COUNT(*) FROM watchlists").fetchone()[0]
    watching_count = _watching_count(conn)
    if list_count == 0 and watching_count > 0:
        _migrate_legacy(conn)
        conn.commit()
        return
    item_count = conn.execute("SELECT COUNT(*) FROM watchlist_items").fetchone()[0]
    if list_count > 0 and item_count > 0 and watching_count == 0:
        project_watching(conn)
        conn.commit()


def _watching_count(conn):
    try:
        return conn.execute("SELECT COUNT(*) FROM watchlist_watching").fetchone()[0]
    except Exception:
        return 0


def _legacy_rows(conn):
    try:
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(watchlist_watching)").fetchall()
        }
    except Exception:
        return []
    if "ticker" not in columns:
        return []
    notes = "notes" if "notes" in columns else "''"
    added = "added_date" if "added_date" in columns else "date('now')"
    sort_order = "sort_order" if "sort_order" in columns else "id"
    override = "div_yield_override" if "div_yield_override" in columns else "NULL"
    scope = "nav_erosion_scope" if "nav_erosion_scope" in columns else "'auto'"
    bench = "nav_benchmark_override" if "nav_benchmark_override" in columns else "NULL"
    order = sort_order if sort_order != "id" else "id"
    return conn.execute(
        f"""
        SELECT ticker, {notes} AS notes, {added} AS added_date, {order} AS sort_order,
               {override} AS div_yield_override, {scope} AS nav_erosion_scope,
               {bench} AS nav_benchmark_override
        FROM watchlist_watching
        ORDER BY {order}, id
        """
    ).fetchall()


def _migrate_legacy(conn):
    rows = _legacy_rows(conn)
    if not rows:
        return
    list_id = _insert_list(conn, "Watchlist", "", DEFAULT_ICON, DEFAULT_COLOR, True, 0)
    seen = set()
    for index, row in enumerate(rows):
        ticker = normalize_ticker(_row_value(row, "ticker", 0))
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        _insert_item(
            conn,
            list_id,
            ticker,
            "",
            _row_value(row, "notes", 1) or "",
            _row_value(row, "div_yield_override", 4),
            _row_value(row, "nav_erosion_scope", 5) or "auto",
            _row_value(row, "nav_benchmark_override", 6) or "",
            index,
            _row_value(row, "added_date", 2) or None,
        )


def _insert_list(conn, name, description, icon, color, is_default, sort_order):
    if is_default:
        conn.execute("UPDATE watchlists SET is_default = 0")
    conn.execute(
        """
        INSERT INTO watchlists (name, description, icon, color, is_default, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (name, description, icon, color, 1 if is_default else 0, sort_order),
    )
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def _insert_item(conn, list_id, ticker, name, notes, override, scope, benchmark, sort_order, added_date):
    conn.execute(
        """
        INSERT INTO watchlist_items (
            watchlist_id, ticker, name, notes, div_yield_override,
            nav_erosion_scope, nav_benchmark_override, sort_order, added_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now')))
        """,
        (
            list_id,
            ticker,
            _clean_text(name, 200),
            _clean_text(notes, 500),
            _clean_override(override),
            _clean_scope(scope),
            _clean_benchmark(benchmark) or None,
            sort_order,
            added_date,
        ),
    )


def _list_row(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"] or "",
        "icon": row["icon"] or DEFAULT_ICON,
        "color": row["color"] or DEFAULT_COLOR,
        "is_default": bool(row["is_default"]),
        "sort_order": row["sort_order"],
    }


def _item_row(row):
    return {
        "id": row["id"],
        "ticker": row["ticker"],
        "name": row["name"] or "",
        "notes": row["notes"] or "",
        "div_yield_override": row["div_yield_override"],
        "nav_erosion_scope": row["nav_erosion_scope"] or "auto",
        "nav_benchmark_override": row["nav_benchmark_override"] or "",
        "sort_order": row["sort_order"],
        "added_date": row["added_date"] or "",
    }


def fetch_watchlists(conn):
    lists = []
    for row in conn.execute(
        "SELECT id, name, description, icon, color, is_default, sort_order "
        "FROM watchlists ORDER BY sort_order, id"
    ).fetchall():
        entry = _list_row(row)
        items = conn.execute(
            """
            SELECT id, ticker, name, notes, div_yield_override, nav_erosion_scope,
                   nav_benchmark_override, sort_order, added_date
            FROM watchlist_items
            WHERE watchlist_id = ?
            ORDER BY sort_order, id
            """,
            (entry["id"],),
        ).fetchall()
        entry["items"] = [_item_row(item) for item in items]
        lists.append(entry)
    return lists


def _fetch_one(conn, list_id):
    for entry in fetch_watchlists(conn):
        if entry["id"] == list_id:
            return entry
    return None


def _next_sort(conn):
    row = conn.execute("SELECT COALESCE(MAX(sort_order), -1) FROM watchlists").fetchone()
    return (row[0] if row else -1) + 1


def _ensure_some_default(conn):
    row = conn.execute("SELECT id FROM watchlists WHERE is_default = 1 ORDER BY id LIMIT 1").fetchone()
    if row:
        return row[0]
    first = conn.execute("SELECT id FROM watchlists ORDER BY sort_order, id LIMIT 1").fetchone()
    if not first:
        return None
    conn.execute("UPDATE watchlists SET is_default = 0")
    conn.execute("UPDATE watchlists SET is_default = 1 WHERE id = ?", (first[0],))
    return first[0]


def create_watchlist(conn, name, description="", icon=DEFAULT_ICON, color=DEFAULT_COLOR, tickers=None):
    clean_name = _clean_text(name, 60)
    if not clean_name:
        raise ValueError("Enter a watchlist name.")
    is_default = conn.execute("SELECT COUNT(*) FROM watchlists").fetchone()[0] == 0
    list_id = _insert_list(
        conn,
        clean_name,
        _clean_text(description, 240),
        _clean_icon(icon),
        _clean_color(color),
        is_default,
        _next_sort(conn),
    )
    seen = set()
    index = 0
    for raw in tickers or []:
        if isinstance(raw, dict):
            ticker = normalize_ticker(raw.get("ticker"))
            item_name = raw.get("name") or ""
            notes = raw.get("notes") or ""
        else:
            ticker = normalize_ticker(raw)
            item_name = ""
            notes = ""
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        _insert_item(conn, list_id, ticker, item_name, notes, None, "auto", "", index, None)
        index += 1
    project_watching(conn)
    return _fetch_one(conn, list_id)


def update_watchlist(conn, list_id, fields):
    current = _fetch_one(conn, list_id)
    if not current:
        return None
    name = _clean_text(fields.get("name", current["name"]), 60) or current["name"]
    description = _clean_text(fields.get("description", current["description"]), 240)
    icon = _clean_icon(fields.get("icon", current["icon"]))
    color = _clean_color(fields.get("color", current["color"]))
    conn.execute(
        "UPDATE watchlists SET name = ?, description = ?, icon = ?, color = ? WHERE id = ?",
        (name, description, icon, color, list_id),
    )
    if "is_default" in fields:
        if fields.get("is_default"):
            conn.execute("UPDATE watchlists SET is_default = 0")
            conn.execute("UPDATE watchlists SET is_default = 1 WHERE id = ?", (list_id,))
        elif current["is_default"]:
            conn.execute("UPDATE watchlists SET is_default = 0 WHERE id = ?", (list_id,))
            nxt = conn.execute(
                "SELECT id FROM watchlists WHERE id != ? ORDER BY sort_order, id LIMIT 1",
                (list_id,),
            ).fetchone()
            if nxt:
                conn.execute("UPDATE watchlists SET is_default = 1 WHERE id = ?", (nxt[0],))
            else:
                conn.execute("UPDATE watchlists SET is_default = 1 WHERE id = ?", (list_id,))
    project_watching(conn)
    return _fetch_one(conn, list_id)


def delete_watchlist(conn, list_id):
    current = _fetch_one(conn, list_id)
    if not current:
        return False
    conn.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", (list_id,))
    conn.execute("DELETE FROM watchlists WHERE id = ?", (list_id,))
    _ensure_some_default(conn)
    project_watching(conn)
    return True


def add_item(conn, list_id, ticker, name="", notes=""):
    if not _fetch_one(conn, list_id):
        return None
    symbol = normalize_ticker(ticker)
    if not symbol:
        raise ValueError("Enter a ticker symbol.")
    existing = conn.execute(
        "SELECT id FROM watchlist_items WHERE watchlist_id = ? AND ticker = ?",
        (list_id, symbol),
    ).fetchone()
    if existing:
        if str(notes or "").strip():
            conn.execute(
                "UPDATE watchlist_items SET notes = ? WHERE id = ?",
                (_clean_text(notes, 500), existing[0]),
            )
        if str(name or "").strip():
            conn.execute(
                """
                UPDATE watchlist_items
                SET name = ?
                WHERE id = ? AND (name IS NULL OR TRIM(name) = '')
                """,
                (_clean_text(name, 200), existing[0]),
            )
    else:
        order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM watchlist_items WHERE watchlist_id = ?",
            (list_id,),
        ).fetchone()[0] + 1
        _insert_item(conn, list_id, symbol, name, notes, None, "auto", "", order, None)
    project_watching(conn)
    row = conn.execute(
        """
        SELECT id, ticker, name, notes, div_yield_override, nav_erosion_scope,
               nav_benchmark_override, sort_order, added_date
        FROM watchlist_items
        WHERE watchlist_id = ? AND ticker = ?
        """,
        (list_id, symbol),
    ).fetchone()
    return _item_row(row)


def update_item(conn, list_id, ticker, fields):
    symbol = normalize_ticker(ticker)
    row = conn.execute(
        "SELECT id, notes FROM watchlist_items WHERE watchlist_id = ? AND ticker = ?",
        (list_id, symbol),
    ).fetchone()
    if not row:
        return None
    notes = _clean_text(fields.get("notes", row["notes"]), 500) if "notes" in fields else None
    assignments = []
    values = []
    if notes is not None:
        assignments.append("notes = ?")
        values.append(notes)
    if "name" in fields:
        assignments.append("name = ?")
        values.append(_clean_text(fields.get("name"), 200))
    if "div_yield_override" in fields:
        assignments.append("div_yield_override = ?")
        values.append(_clean_override(fields.get("div_yield_override")))
    if "nav_erosion_scope" in fields:
        assignments.append("nav_erosion_scope = ?")
        values.append(_clean_scope(fields.get("nav_erosion_scope")))
    if "nav_benchmark_override" in fields:
        assignments.append("nav_benchmark_override = ?")
        values.append(_clean_benchmark(fields.get("nav_benchmark_override")) or None)
    if assignments:
        values.append(row["id"])
        conn.execute(
            f"UPDATE watchlist_items SET {', '.join(assignments)} WHERE id = ?",
            values,
        )
    project_watching(conn)
    updated = conn.execute(
        """
        SELECT id, ticker, name, notes, div_yield_override, nav_erosion_scope,
               nav_benchmark_override, sort_order, added_date
        FROM watchlist_items WHERE id = ?
        """,
        (row["id"],),
    ).fetchone()
    return _item_row(updated)


def remove_item(conn, list_id, ticker):
    symbol = normalize_ticker(ticker)
    cursor = conn.execute(
        "DELETE FROM watchlist_items WHERE watchlist_id = ? AND ticker = ?",
        (list_id, symbol),
    )
    if cursor.rowcount:
        project_watching(conn)
    return cursor.rowcount > 0


def remember_names(conn, names):
    for ticker, name in (names or {}).items():
        symbol = normalize_ticker(ticker)
        clean = _clean_text(name, 200)
        if not symbol or not clean:
            continue
        conn.execute(
            """
            UPDATE watchlist_items
            SET name = ?
            WHERE ticker = ? AND (name IS NULL OR TRIM(name) = '')
            """,
            (clean, symbol),
        )


def item_settings(conn, tickers):
    """NAV and yield settings for a refresh, preferring the Home list."""
    wanted = [normalize_ticker(ticker) for ticker in tickers]
    wanted = [ticker for ticker in wanted if ticker]
    settings = {
        ticker: {
            "nav_erosion_scope": "auto",
            "nav_benchmark_override": "",
            "div_yield_override": None,
        }
        for ticker in wanted
    }
    if not wanted:
        return settings
    placeholders = ",".join("?" for _ in wanted)
    rows = conn.execute(
        f"""
        SELECT i.ticker, i.nav_erosion_scope, i.nav_benchmark_override, i.div_yield_override,
               w.is_default
        FROM watchlist_items i
        JOIN watchlists w ON w.id = i.watchlist_id
        WHERE i.ticker IN ({placeholders})
        ORDER BY w.is_default DESC, w.sort_order, i.sort_order
        """,
        wanted,
    ).fetchall()
    seen = set()
    for row in rows:
        ticker = row["ticker"]
        if ticker in seen:
            continue
        seen.add(ticker)
        settings[ticker] = {
            "nav_erosion_scope": row["nav_erosion_scope"] or "auto",
            "nav_benchmark_override": row["nav_benchmark_override"] or "",
            "div_yield_override": row["div_yield_override"],
        }
    return settings


def project_watching(conn):
    """Rewrite the flat ticker table from every list."""
    rows = conn.execute(
        """
        SELECT i.ticker, i.notes, i.div_yield_override, i.nav_erosion_scope,
               i.nav_benchmark_override, i.added_date, w.is_default, w.sort_order, i.sort_order
        FROM watchlist_items i
        JOIN watchlists w ON w.id = i.watchlist_id
        ORDER BY w.is_default DESC, w.sort_order, i.sort_order, i.id
        """
    ).fetchall()
    chosen = {}
    order = []
    for row in rows:
        ticker = row["ticker"]
        if ticker in chosen:
            continue
        chosen[ticker] = row
        order.append(ticker)
    conn.execute("DELETE FROM watchlist_watching")
    for index, ticker in enumerate(order):
        row = chosen[ticker]
        conn.execute(
            """
            INSERT INTO watchlist_watching (
                ticker, notes, sort_order, div_yield_override,
                nav_erosion_scope, nav_benchmark_override, added_date
            ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now')))
            """,
            (
                ticker,
                row["notes"] or "",
                index,
                row["div_yield_override"],
                row["nav_erosion_scope"] or "auto",
                row["nav_benchmark_override"],
                row["added_date"],
            ),
        )


def replace_default_items(conn, rows):
    """Replace the Home list. Other lists stay. Creates the Home list if needed."""
    default_id = _ensure_some_default(conn)
    if default_id is None:
        default_id = _insert_list(conn, "Watchlist", "", DEFAULT_ICON, DEFAULT_COLOR, True, 0)
    conn.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", (default_id,))
    for index, raw in enumerate(rows or []):
        ticker = normalize_ticker(raw.get("ticker") if isinstance(raw, dict) else raw)
        if not ticker:
            continue
        raw = raw if isinstance(raw, dict) else {}
        _insert_item(
            conn,
            default_id,
            ticker,
            raw.get("name") or "",
            raw.get("notes") or "",
            raw.get("div_yield_override"),
            raw.get("nav_erosion_scope") or "auto",
            raw.get("nav_benchmark_override") or "",
            index,
            None,
        )
    project_watching(conn)
    return _fetch_one(conn, default_id)


def _list_id_by_name(conn, name, create=False):
    clean = _clean_text(name, 60)
    if not clean:
        return _ensure_some_default(conn) or _insert_list(
            conn, "Watchlist", "", DEFAULT_ICON, DEFAULT_COLOR, True, 0
        )
    row = conn.execute(
        "SELECT id FROM watchlists WHERE LOWER(name) = LOWER(?) ORDER BY id LIMIT 1",
        (clean,),
    ).fetchone()
    if row:
        return row[0]
    if not create:
        return None
    is_default = conn.execute("SELECT COUNT(*) FROM watchlists").fetchone()[0] == 0
    return _insert_list(conn, clean, "", DEFAULT_ICON, DEFAULT_COLOR, is_default, _next_sort(conn))


def apply_import(conn, rows, replace=False):
    """Import ticker rows. A Watchlist column chooses the list; otherwise Home."""
    ensure_watchlist_schema(conn)
    grouped = {}
    for raw in rows:
        list_name = _clean_text(raw.get("watchlist") or raw.get("list") or "", 60)
        grouped.setdefault(list_name, []).append(raw)
    added = 0
    updated = 0
    for list_name, items in grouped.items():
        list_id = _list_id_by_name(conn, list_name, create=True)
        if replace:
            conn.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", (list_id,))
        seen = set()
        for raw in items:
            ticker = normalize_ticker(raw.get("ticker"))
            if not ticker or ticker in seen:
                continue
            seen.add(ticker)
            existing = conn.execute(
                "SELECT id FROM watchlist_items WHERE watchlist_id = ? AND ticker = ?",
                (list_id, ticker),
            ).fetchone()
            if existing and not replace:
                fields = {}
                if str(raw.get("notes") or "").strip():
                    fields["notes"] = raw.get("notes")
                if raw.get("div_yield_override") is not None:
                    fields["div_yield_override"] = raw.get("div_yield_override")
                scope = str(raw.get("nav_erosion_scope") or "").strip().lower()
                if scope in ("test", "skip"):
                    fields["nav_erosion_scope"] = scope
                if str(raw.get("nav_benchmark_override") or "").strip():
                    fields["nav_benchmark_override"] = raw.get("nav_benchmark_override")
                if fields:
                    update_item(conn, list_id, ticker, fields)
                    updated += 1
                continue
            order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) FROM watchlist_items WHERE watchlist_id = ?",
                (list_id,),
            ).fetchone()[0] + 1
            _insert_item(
                conn,
                list_id,
                ticker,
                raw.get("name") or "",
                raw.get("notes") or "",
                raw.get("div_yield_override"),
                raw.get("nav_erosion_scope") or "auto",
                raw.get("nav_benchmark_override") or "",
                order,
                None,
            )
            added += 1
    project_watching(conn)
    return {"added": added, "updated": updated}


def export_rows(conn):
    rows = []
    for entry in fetch_watchlists(conn):
        for item in entry["items"]:
            rows.append({
                "Watchlist": entry["name"],
                "Ticker": item["ticker"],
                "Notes": item["notes"],
                "Div Yield Override": item["div_yield_override"] if item["div_yield_override"] is not None else "",
                "NAV Erosion Scope": item["nav_erosion_scope"] or "auto",
                "NAV Benchmark Override": item["nav_benchmark_override"] or "",
                "Added Date": item["added_date"] or "",
            })
    return rows


def read_market_cache(conn, tickers):
    symbols = [normalize_ticker(ticker) for ticker in tickers]
    symbols = [ticker for ticker in symbols if ticker]
    if not symbols:
        return {}
    placeholders = ",".join("?" for _ in symbols)
    rows = conn.execute(
        f"SELECT ticker, payload, updated_at FROM watchlist_market_cache WHERE ticker IN ({placeholders})",
        symbols,
    ).fetchall()
    found = {}
    for row in rows:
        try:
            payload = json.loads(row["payload"] if not isinstance(row, tuple) else row[1])
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        payload["as_of"] = row["updated_at"] if not isinstance(row, tuple) else row[2]
        found[row["ticker"] if not isinstance(row, tuple) else row[0]] = payload
    return found


def merge_market_cache(conn, updates, keys):
    allowed = set(keys)
    for ticker, fields in (updates or {}).items():
        symbol = normalize_ticker(ticker)
        if not symbol or not isinstance(fields, dict):
            continue
        current = read_market_cache(conn, [symbol]).get(symbol, {})
        current.pop("as_of", None)
        for key, value in fields.items():
            if key in allowed:
                current[key] = value
        conn.execute(
            """
            INSERT INTO watchlist_market_cache (ticker, payload, updated_at)
            VALUES (?, ?, strftime('%s','now'))
            ON CONFLICT(ticker) DO UPDATE SET
                payload = excluded.payload,
                updated_at = excluded.updated_at
            """,
            (symbol, json.dumps(current)),
        )


def select_lookup_results(query, hits, limit=8):
    """Keep exact and name matches. A typed symbol never surfaces unrelated venues."""
    text = str(query or "").strip()
    upper = text.upper()
    if not upper:
        return []
    prepared = []
    known = KNOWN_FUNDS.get(upper)
    if known:
        prepared.append({
            "symbol": upper,
            "name": known["name"],
            "issuer": known["issuer"],
        })
    for hit in hits or []:
        symbol = normalize_ticker(hit.get("symbol"))
        if not symbol:
            continue
        name = _clean_text(hit.get("name") or hit.get("fund_name") or "", 200)
        issuer = _clean_text(hit.get("issuer") or hit.get("provider") or "", 80)
        if symbol == upper and symbol in KNOWN_FUNDS:
            continue
        prepared.append({"symbol": symbol, "name": name, "issuer": issuer})

    results = []
    seen = set()
    for hit in prepared:
        symbol = hit["symbol"]
        if symbol in seen:
            continue
        name = hit["name"].upper()
        exact = symbol == upper
        prefix = symbol.startswith(upper) and "." not in symbol
        foreign = "." in symbol and "." not in upper
        name_hit = len(upper) >= 2 and upper in name
        if foreign and not exact:
            continue
        if not (exact or prefix or name_hit):
            continue
        seen.add(symbol)
        results.append(hit)
    results.sort(key=lambda hit: (0 if hit["symbol"] == upper else 1, hit["symbol"]))
    return results[:limit]
