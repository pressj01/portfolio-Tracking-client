"""
Parsers for importing transaction history from external sources.

Each parser accepts a file path + filename and returns a normalised result dict:
    {
        "transactions": [ ... ],       # list of normalised dicts
        "summary": {
            "buys": int,
            "sells": int,
            "dividends": int,
            "filtered": int,
            "drip_detected": int,
            "splits_applied": int,
        },
    }

Normalised transaction dict keys:
    type            "BUY" | "SELL" | "DIVIDEND"
    ticker          str
    date            str  (YYYY-MM-DD)
    shares          float | None  (None for DIVIDEND)
    price_per_share float | None  (None for DIVIDEND)
    fees            float
    dividend_amount float | None  (only for DIVIDEND)
    notes           str
"""

import csv
import re
from collections import defaultdict
from datetime import datetime

TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-/]{0,10}$")
ADJUSTMENT_NOTE = "Automatically generated transaction to adjust"


# ── Snowball Analytics ──────────────────────────────────────────────────────────

def parse_snowball_csv(file_path, filename):
    """Parse a per-account Snowball Analytics CSV export.

    Rejects combined (multi-account) exports based on filename and content
    heuristics.
    """

    # ── Check 1: filename ────────────────────────────────────────────────────
    if "combined" in filename.lower():
        raise ValueError(
            "This appears to be a combined portfolio export. "
            "Please export each account individually from Snowball."
        )

    # ── Read all rows ────────────────────────────────────────────────────────
    rows = []
    with open(file_path, "r", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append(row)

    if not rows:
        raise ValueError("The CSV file is empty or has no data rows.")

    # ── Check 2: multiple CASH_IN on earliest date → combined export ─────────
    earliest_date = None
    cash_in_dates = []
    for row in rows:
        event = (row.get("Event") or "").strip()
        raw_date = (row.get("Date") or "").strip()
        if not raw_date:
            continue
        d = _parse_date(raw_date)
        if d and (earliest_date is None or d < earliest_date):
            earliest_date = d
        if event == "CASH_IN" and d:
            cash_in_dates.append(d)

    if earliest_date:
        earliest_cash_ins = sum(1 for d in cash_in_dates if d == earliest_date)
        if earliest_cash_ins > 1:
            raise ValueError(
                "This appears to be a combined portfolio export "
                f"({earliest_cash_ins} accounts detected). "
                "Please export each account individually from Snowball."
            )

    # ── Parse and filter rows ────────────────────────────────────────────────
    kept = []
    split_events = []
    filtered_count = 0
    importable_events = {"BUY", "SELL", "DIVIDEND"}

    for idx, row in enumerate(rows):
        event = (row.get("Event") or "").strip().upper()
        note = row.get("Note") or ""

        if event == "SPLIT":
            ticker = (row.get("Symbol") or "").strip().upper()
            raw_date = (row.get("Date") or "").strip()
            date_str = _parse_date_str(raw_date)
            ratio = _safe_float(row.get("Price"))
            if ticker and TICKER_RE.match(ticker) and date_str and ratio and ratio > 0:
                split_events.append({
                    "ticker": ticker,
                    "date": date_str,
                    "row_idx": idx,
                    "ratio": ratio,
                })
            else:
                filtered_count += 1
            continue

        # Skip non-importable event types
        if event not in importable_events:
            filtered_count += 1
            continue

        ticker = (row.get("Symbol") or "").strip().upper()
        if not ticker or not TICKER_RE.match(ticker):
            filtered_count += 1
            continue

        raw_date = (row.get("Date") or "").strip()
        date_str = _parse_date_str(raw_date)
        if not date_str:
            filtered_count += 1
            continue

        qty = _safe_float(row.get("Quantity"))
        price = _safe_float(row.get("Price"))
        fees = _safe_float(row.get("FeeTax"))
        is_adjustment = ADJUSTMENT_NOTE in note

        if event == "DIVIDEND":
            # Skip dividend adjustments (cash balance corrections, not real payments)
            if is_adjustment:
                filtered_count += 1
                continue
            kept.append({
                "type": "DIVIDEND",
                "ticker": ticker,
                "date": date_str,
                "shares": None,
                "price_per_share": None,
                "fees": 0.0,
                "dividend_amount": qty,  # Quantity is dollar amount for dividends
                "notes": note.strip(),
            })
        else:
            if qty is None or qty == 0:
                filtered_count += 1
                continue

            # Handle Snowball balance adjustments — these are opening position
            # corrections that make the transaction math add up.
            # Positive qty → BUY, negative qty → SELL (convert accordingly).
            if is_adjustment:
                if qty > 0:
                    txn_type = "BUY"
                else:
                    txn_type = "SELL"
                adj_note = f"[Opening balance] {note.strip()}"
            else:
                # Regular transaction — negative BUY qty shouldn't happen
                # outside adjustments, but handle gracefully
                if event == "BUY" and qty < 0:
                    filtered_count += 1
                    continue
                txn_type = event
                adj_note = note.strip()

            kept.append({
                "type": txn_type,
                "ticker": ticker,
                "date": date_str,
                "shares": abs(qty),
                "price_per_share": price,
                "fees": fees or 0.0,
                "dividend_amount": None,
                "notes": adj_note,
                "_row_idx": idx,
            })

    splits_applied = 0
    for split in sorted(split_events, key=lambda s: (s["date"], s["row_idx"])):
        adjusted_any = False
        for txn in kept:
            if txn["type"] == "DIVIDEND" or txn["ticker"] != split["ticker"]:
                continue
            if (txn["date"], txn.get("_row_idx", -1)) >= (split["date"], split["row_idx"]):
                continue
            txn["shares"] = round((txn["shares"] or 0) * split["ratio"], 10)
            if txn["price_per_share"]:
                txn["price_per_share"] = txn["price_per_share"] / split["ratio"]
            adjusted_any = True
        if adjusted_any:
            splits_applied += 1

    for txn in kept:
        txn.pop("_row_idx", None)

    # ── DRIP detection ───────────────────────────────────────────────────────
    drip_count = _detect_drip(kept)

    # ── Build summary ────────────────────────────────────────────────────────
    buys = sum(1 for t in kept if t["type"] == "BUY")
    sells = sum(1 for t in kept if t["type"] == "SELL")
    divs = sum(1 for t in kept if t["type"] == "DIVIDEND")

    return {
        "transactions": kept,
        "summary": {
            "buys": buys,
            "sells": sells,
            "dividends": divs,
            "filtered": filtered_count,
            "drip_detected": drip_count,
            "splits_applied": splits_applied,
        },
    }


# ── DRIP detection ───────────────────────────────────────────────────────────

def _detect_drip(transactions):
    """Flag BUY transactions that look like DRIP reinvestments.

    Heuristic: a BUY on the same date and ticker as a DIVIDEND, where the
    BUY total cost is within 20% of the dividend amount.
    """
    # Build lookup: (ticker, date) → list of DIVIDEND amounts
    div_lookup = defaultdict(list)
    for t in transactions:
        if t["type"] == "DIVIDEND":
            div_lookup[(t["ticker"], t["date"])].append(t["dividend_amount"] or 0)

    drip_count = 0
    for t in transactions:
        if t["type"] != "BUY":
            continue
        key = (t["ticker"], t["date"])
        if key not in div_lookup:
            continue
        buy_cost = (t["shares"] or 0) * (t["price_per_share"] or 0)
        for div_amt in div_lookup[key]:
            if div_amt > 0 and buy_cost > 0:
                ratio = buy_cost / div_amt
                if 0.8 <= ratio <= 1.2:
                    if "[DRIP]" not in (t["notes"] or ""):
                        t["notes"] = f"[DRIP] {t['notes']}".strip()
                        drip_count += 1
                    break

    return drip_count


# ── Charles Schwab (Positions file) ────────────────────────────────────────

# Rows to skip in the positions CSV (not actual holdings)
_SCHWAB_SKIP_SYMBOLS = {
    "Futures Cash", "Futures Positions Market Value",
    "Cash & Cash Investments", "Positions Total",
}


def parse_schwab_csv(file_path, filename):
    """Parse a Schwab Positions CSV export.

    The positions file is the source of truth for current holdings —
    it includes shares from inter-account transfers, reverse splits,
    and all corporate actions.

    Returns a positions-based result dict (not transactions):
        {
            "positions": [ ... ],
            "summary": { "holdings": int, "filtered": int, "options": int },
            "format_type": "positions",
        }
    """

    # First line is a header like "Positions for account ..." — skip it
    # Second line is blank, then the CSV header follows
    with open(file_path, "r", encoding="utf-8-sig") as fh:
        lines = fh.readlines()

    # Find the CSV header row (starts with "Symbol")
    header_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith('"Symbol"') or line.strip().startswith("Symbol"):
            header_idx = i
            break

    if header_idx is None:
        raise ValueError(
            "Could not find the positions header row. "
            "Make sure this is a Schwab Positions CSV export."
        )

    import io
    csv_text = "".join(lines[header_idx:])
    reader = csv.DictReader(io.StringIO(csv_text))

    positions = []
    filtered_count = 0
    options_count = 0

    for row in reader:
        sym = (row.get("Symbol") or "").strip()
        desc = (row.get("Description") or "").strip()
        asset_type = (row.get("Asset Type") or "").strip()

        # Skip summary rows
        if sym in _SCHWAB_SKIP_SYMBOLS or not sym:
            filtered_count += 1
            continue

        # Skip options
        if asset_type == "Option" or " " in sym:
            options_count += 1
            continue

        ticker = sym.upper()
        if not TICKER_RE.match(ticker):
            filtered_count += 1
            continue

        qty = _safe_float((row.get("Qty (Quantity)") or "").replace(",", ""))
        cost_per_share = _safe_float(
            (row.get("Cost/Share") or "").replace("$", "").replace(",", "")
        )
        price = _safe_float(
            (row.get("Price") or "").replace("$", "").replace(",", "")
        )
        mkt_val = _safe_float(
            (row.get("Mkt Val (Market Value)") or "").replace("$", "").replace(",", "")
        )
        gain = _safe_float(
            (row.get("Gain $ (Gain/Loss $)") or "").replace("$", "").replace(",", "")
        )
        div_yield = (row.get("Div Yld (Dividend Yield)") or "").replace("%", "").strip()
        div_yield = _safe_float(div_yield)
        reinvest = (row.get("Reinvest?") or "").strip().lower() == "yes"

        if qty is None or qty <= 0:
            filtered_count += 1
            continue

        purchase_value = qty * (cost_per_share or 0)
        current_value = mkt_val or (qty * (price or 0))

        positions.append({
            "ticker": ticker,
            "description": desc,
            "quantity": qty,
            "cost_per_share": cost_per_share or 0,
            "current_price": price or 0,
            "purchase_value": round(purchase_value, 2),
            "current_value": round(current_value, 2),
            "gain_or_loss": gain or round(current_value - purchase_value, 2),
            "dividend_yield": div_yield,
            "reinvest_dividends": reinvest,
            "asset_type": asset_type,
        })

    # Schwab can emit the same ticker more than once when lots are split across
    # sub-positions. Merge them so the import updates one consolidated holding.
    merged = {}
    for pos in positions:
        ticker = pos["ticker"]
        if ticker not in merged:
            merged[ticker] = dict(pos)
            continue

        existing = merged[ticker]
        total_qty = existing["quantity"] + pos["quantity"]
        total_purchase = existing["purchase_value"] + pos["purchase_value"]
        total_current = existing["current_value"] + pos["current_value"]
        total_gain = existing["gain_or_loss"] + pos["gain_or_loss"]

        existing["quantity"] = total_qty
        existing["purchase_value"] = round(total_purchase, 2)
        existing["current_value"] = round(total_current, 2)
        existing["gain_or_loss"] = round(total_gain, 2)
        existing["cost_per_share"] = round(total_purchase / total_qty, 4) if total_qty else 0
        existing["current_price"] = pos["current_price"] or existing["current_price"]
        existing["dividend_yield"] = pos["dividend_yield"] or existing["dividend_yield"]
        existing["reinvest_dividends"] = existing["reinvest_dividends"] or pos["reinvest_dividends"]
        if not existing["description"]:
            existing["description"] = pos["description"]
        if not existing["asset_type"]:
            existing["asset_type"] = pos["asset_type"]

    positions = list(merged.values())

    return {
        "positions": positions,
        "summary": {
            "holdings": len(positions),
            "filtered": filtered_count,
            "options": options_count,
        },
        "format_type": "positions",
    }


def parse_etrade_csv(file_path, filename):
    """Parse an E*TRADE portfolio download CSV as current positions.

    Returns a positions-based result dict similar to the Schwab parser.
    """
    import io

    with open(file_path, "r", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))

    if not rows:
        raise ValueError("The CSV file is empty.")

    account_name = ""
    account_value = 0.0
    cash_value = 0.0
    header_idx = None

    for idx, row in enumerate(rows):
        first = (row[0] if row else "").strip()
        second = (row[1] if len(row) > 1 else "").strip()

        if first == "Account" and second == "Net Account Value":
            data_idx = idx + 1
            while data_idx < len(rows) and not any(cell.strip() for cell in rows[data_idx]):
                data_idx += 1
            if data_idx < len(rows):
                account_row = rows[data_idx]
                account_name = (account_row[0] if len(account_row) > 0 else "").strip()
                account_value = _safe_float(account_row[1] if len(account_row) > 1 else None) or 0.0
                cash_value = _safe_float(account_row[7] if len(account_row) > 7 else None) or 0.0

        if first == "Symbol" and second == "Price Paid $":
            header_idx = idx
            break

    if header_idx is None:
        raise ValueError(
            "Could not find the E*TRADE holdings table. "
            "Make sure this is an E*TRADE portfolio download CSV."
        )

    header = rows[header_idx]
    positions = []
    filtered_count = 0

    for row in rows[header_idx + 1:]:
        if not any(cell.strip() for cell in row):
            continue

        first = (row[0] if row else "").strip()
        if first.startswith("Generated at"):
            break

        padded = row + [""] * max(0, len(header) - len(row))
        record = dict(zip(header, padded))

        ticker = (record.get("Symbol") or "").strip().upper()
        if not ticker or ticker in {"CASH", "TOTAL"}:
            filtered_count += 1
            if ticker == "CASH":
                cash_value = _safe_float(record.get("Value $")) or cash_value
            if ticker == "TOTAL":
                account_value = _safe_float(record.get("Value $")) or account_value
            continue

        if not TICKER_RE.match(ticker):
            filtered_count += 1
            continue

        qty = _safe_float(record.get("Qty #"))
        cost_per_share = _safe_float(record.get("Price Paid $"))
        current_price = _safe_float(record.get("Last Price $"))
        current_value = _safe_float(record.get("Value $"))
        purchase_value = _safe_float(record.get("Total Cost"))
        gain_or_loss = _safe_float(record.get("Total Gain $"))

        if qty is None or qty <= 0:
            filtered_count += 1
            continue

        purchase_value = purchase_value if purchase_value is not None else qty * (cost_per_share or 0)
        current_value = current_value if current_value is not None else qty * (current_price or 0)
        if gain_or_loss is None:
            gain_or_loss = round(current_value - purchase_value, 2)

        positions.append({
            "ticker": ticker,
            "description": "",
            "quantity": qty,
            "cost_per_share": cost_per_share or 0.0,
            "current_price": current_price or 0.0,
            "purchase_value": round(purchase_value, 2),
            "current_value": round(current_value, 2),
            "gain_or_loss": round(gain_or_loss, 2),
            "dividend_yield": _safe_float(record.get("Dividend Yield %")),
            "reinvest_dividends": False,
            "asset_type": "Security",
        })

    if not positions:
        raise ValueError("No holdings rows were found in the E*TRADE CSV.")

    return {
        "positions": positions,
        "summary": {
            "holdings": len(positions),
            "filtered": filtered_count,
            "cash": round(cash_value, 2),
            "account_value": round(account_value, 2),
        },
        "format_type": "positions",
        "account_name": account_name,
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_date(raw):
    """Parse a date string to a datetime.date, or None."""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%Y %H:%M:%S"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except (ValueError, AttributeError):
            continue
    return None


def _parse_date_str(raw):
    """Parse a date string and return YYYY-MM-DD, or None."""
    d = _parse_date(raw)
    return d.isoformat() if d else None


def _safe_float(val):
    """Convert a value to float, stripping quotes and whitespace. Returns None on failure."""
    if val is None:
        return None
    try:
        return float(str(val).strip().strip('"').replace(",", ""))
    except (ValueError, TypeError):
        return None


# ── Parser registry ──────────────────────────────────────────────────────────

PARSERS = {
    "snowball": parse_snowball_csv,
    "schwab": parse_schwab_csv,
    "etrade": parse_etrade_csv,
    # "fidelity": parse_fidelity_csv,    # future
}

# Labels shown in the UI format dropdown
PARSER_LABELS = {
    "snowball": "Snowball Analytics",
    "schwab": "Charles Schwab",
    "etrade": "E*Trade",
    "fidelity": "Fidelity",
}
