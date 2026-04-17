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


def _infer_snowball_asset_type(sector, category):
    sector = (sector or "").strip().lower()
    category = (category or "").strip().lower()
    if sector == "funds" or "fund" in category:
        return "Fund"
    if sector == "bonds":
        return "Bond"
    if sector:
        return sector.title()
    return "Security"


def parse_snowball_holdings_csv(file_path, filename):
    """Parse a Snowball holdings CSV as a migration-style positions snapshot.

    Keeps only the fields this app can store and use meaningfully:
    ticker, description, shares, cost basis, current price/value, dividend
    metadata, dividends received, and category.
    """
    with open(file_path, "r", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        headers = reader.fieldnames or []
        rows = list(reader)

    required = {"Holding", "Holdings' name", "Shares", "Cost basis", "Current value", "Share price"}
    missing = sorted(required - set(headers))
    if missing:
        raise ValueError(
            "This does not look like a Snowball Holdings CSV export. "
            f"Missing required columns: {', '.join(missing)}"
        )
    if not rows:
        raise ValueError("The CSV file is empty or has no data rows.")

    positions = []
    filtered_count = 0

    for row in rows:
        ticker = (row.get("Holding") or "").strip().upper()
        if not ticker or not TICKER_RE.match(ticker):
            filtered_count += 1
            continue

        quantity = _safe_float(row.get("Shares"))
        purchase_value = _safe_float(row.get("Cost basis"))
        current_value = _safe_float(row.get("Current value"))
        current_price = _safe_float(row.get("Share price"))

        if quantity is None or quantity <= 0:
            filtered_count += 1
            continue

        if current_value is None and current_price is not None:
            current_value = quantity * current_price
        if purchase_value is None:
            filtered_count += 1
            continue

        current_value = current_value if current_value is not None else 0.0
        cost_per_share = (purchase_value / quantity) if quantity else 0.0
        annual_payment = _safe_float(row.get("Dividends")) or 0.0
        div_per_share = _safe_float(row.get("Dividends per share")) or 0.0
        total_divs_received = _safe_float(row.get("Div. received")) or 0.0
        dividend_yield = _safe_float(row.get("Dividend yield"))
        ex_div_date = _parse_date_str(row.get("Ex-dividend date"))
        div_pay_date = _parse_date_str(row.get("Date of the next payment"))
        category = (row.get("Category") or "").strip()
        sector = (row.get("Sector") or "").strip()

        positions.append({
            "ticker": ticker,
            "description": (row.get("Holdings' name") or "").strip(),
            "quantity": round(quantity, 6),
            "cost_per_share": round(cost_per_share, 6),
            "current_price": round(current_price or 0.0, 6),
            "purchase_value": round(purchase_value, 2),
            "current_value": round(current_value, 2),
            "gain_or_loss": round(current_value - purchase_value, 2),
            "div": round(div_per_share, 6),
            "dividend_yield": dividend_yield,
            "ex_div_date": ex_div_date,
            "div_pay_date": div_pay_date,
            "estim_payment_per_year": round(annual_payment, 2),
            "approx_monthly_income": round(annual_payment / 12.0, 2) if annual_payment > 0 else 0.0,
            "total_divs_received": round(total_divs_received, 2),
            "category": category,
            "classification_type": _infer_snowball_asset_type(sector, category),
            "asset_type": _infer_snowball_asset_type(sector, category),
        })

    if not positions:
        raise ValueError("No valid holdings rows were found in the Snowball holdings CSV.")

    return {
        "positions": positions,
        "summary": {
            "holdings": len(positions),
            "filtered": filtered_count,
            "options": 0,
        },
        "format_type": "positions",
        "source_format": "snowball_holdings",
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
            "reinvest_dividends": None,
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


def _fidelity_read_xlsx(file_path, sheet_name=None):
    import openpyxl

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    try:
        ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
        return [list(row) for row in ws.iter_rows(values_only=True)]
    finally:
        wb.close()


def _fidelity_parse_percent_fraction(raw):
    val = _safe_float(raw)
    if val is None:
        return None
    return val * 100.0


def parse_fidelity_positions_xlsx(file_path, filename):
    """Parse a Fidelity positions XLSX export."""
    rows = _fidelity_read_xlsx(file_path, "Position")
    if not rows:
        raise ValueError("The Fidelity positions workbook is empty.")

    header = [str(c or "").strip() for c in rows[0]]
    if "Account Name" not in header or "Symbol" not in header or "Current value" not in header:
        raise ValueError(
            "Could not find the Fidelity positions columns. "
            "Make sure this is a Fidelity positions export workbook."
        )

    positions = []
    filtered_count = 0
    cash_value = 0.0
    account_names = set()
    account_numbers = set()

    for row in rows[1:]:
        if not any(v is not None and str(v).strip() != "" for v in row):
            continue
        record = dict(zip(header, row + [None] * max(0, len(header) - len(row))))
        account_name = (str(record.get("Account Name") or "")).strip()
        account_number = (str(record.get("Account Number") or "")).strip()
        if account_name:
            account_names.add(account_name)
        if account_number:
            account_numbers.add(account_number)

        ticker = (str(record.get("Symbol") or "")).strip().upper()
        description = (str(record.get("Description") or "")).strip()
        holding_type = (str(record.get("Type") or "")).strip()
        current_value = _safe_float(record.get("Current value")) or 0.0
        quantity = _safe_float(record.get("Quantity"))

        if holding_type.lower() == "cash" or ticker.endswith("**") or quantity is None or quantity <= 0:
            cash_value += current_value
            filtered_count += 1
            continue

        if not ticker or not TICKER_RE.match(ticker):
            filtered_count += 1
            continue

        current_price = _safe_float(record.get("Last Price")) or 0.0
        purchase_value = _safe_float(record.get("Cost basis total"))
        cost_per_share = _safe_float(record.get("Average cost basis"))
        gain_or_loss = _safe_float(record.get("Total gain/loss $"))
        purchase_value = purchase_value if purchase_value is not None else quantity * (cost_per_share or 0.0)
        gain_or_loss = gain_or_loss if gain_or_loss is not None else current_value - purchase_value
        dist_yield = _fidelity_parse_percent_fraction(record.get("Dist. yield"))
        est_annual_income = _safe_float(record.get("Est. annual income")) or 0.0

        positions.append({
            "ticker": ticker,
            "description": description,
            "quantity": quantity,
            "cost_per_share": cost_per_share or (purchase_value / quantity if quantity else 0.0),
            "current_price": current_price,
            "purchase_value": round(purchase_value, 2),
            "current_value": round(current_value, 2),
            "gain_or_loss": round(gain_or_loss, 2),
            "dividend_yield": dist_yield,
            "div": _safe_float(record.get("Amount per share")),
            "ex_div_date": _parse_date_str(record.get("Ex-date")),
            "div_pay_date": _parse_date_str(record.get("Pay date")),
            "estim_payment_per_year": round(est_annual_income, 2) if est_annual_income > 0 else None,
            "approx_monthly_income": round(est_annual_income / 12.0, 2) if est_annual_income > 0 else None,
            "reinvest_dividends": None,
            "asset_type": "Security",
        })

    if len(account_names) > 1 or len(account_numbers) > 1:
        raise ValueError(
            "This appears to include more than one Fidelity account. "
            "Please export a single account at a time."
        )
    if not positions:
        raise ValueError("No holdings rows were found in the Fidelity positions workbook.")

    account_name = next(iter(account_names), "")
    positions_value = round(sum(p["current_value"] for p in positions), 2)
    return {
        "positions": positions,
        "summary": {
            "holdings": len(positions),
            "filtered": filtered_count,
            "options": 0,
            "cash": round(cash_value, 2),
            "account_value": round(positions_value + cash_value, 2),
        },
        "format_type": "positions",
        "source_format": "fidelity",
        "account_name": account_name,
    }


def parse_fidelity_transactions_xlsx(file_path, filename):
    """Parse a Fidelity transactions XLSX export."""
    rows = _fidelity_read_xlsx(file_path, "Transactions")
    if len(rows) < 4:
        raise ValueError("The Fidelity transactions workbook has too few rows.")

    header_idx = None
    for idx, row in enumerate(rows):
        vals = [str(c or "").strip() for c in row]
        if "Run Date" in vals and "Action" in vals and "Symbol" in vals:
            header_idx = idx
            header = vals
            break
    if header_idx is None:
        raise ValueError(
            "Could not find the Fidelity transaction header row. "
            "Make sure this is a Fidelity transactions export workbook."
        )

    kept = []
    filtered_count = 0

    for row in rows[header_idx + 1:]:
        if not any(v is not None and str(v).strip() != "" for v in row):
            continue
        record = dict(zip(header, row + [None] * max(0, len(header) - len(row))))
        action = (str(record.get("Action") or "")).strip()
        symbol = (str(record.get("Symbol") or "")).strip().upper()
        if not symbol or not TICKER_RE.match(symbol):
            filtered_count += 1
            continue

        date_str = _parse_date_str(record.get("Run Date"))
        if not date_str:
            filtered_count += 1
            continue

        qty_val = _safe_float(record.get("Quantity"))
        price_val = _safe_float(record.get("Price ($)"))
        amount_val = _safe_float(record.get("Amount ($)"))
        commission = _safe_float(record.get("Commission ($)")) or 0.0
        fees = _safe_float(record.get("Fees ($)")) or 0.0
        total_fees = round(commission + fees, 2)
        action_upper = action.upper()

        if "DIVIDEND RECEIVED" in action_upper:
            if amount_val is None:
                filtered_count += 1
                continue
            kept.append({
                "type": "DIVIDEND",
                "ticker": symbol,
                "date": date_str,
                "shares": None,
                "price_per_share": None,
                "fees": 0.0,
                "dividend_amount": round(abs(amount_val), 2),
                "notes": "Dividend Received",
            })
            continue

        if "REINVESTMENT" in action_upper:
            if qty_val is None or qty_val == 0:
                filtered_count += 1
                continue
            kept.append({
                "type": "BUY",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty_val),
                "price_per_share": price_val,
                "fees": total_fees,
                "dividend_amount": None,
                "notes": "[DRIP] Reinvestment",
            })
            continue

        if "YOU BOUGHT" in action_upper:
            if qty_val is None or qty_val == 0:
                filtered_count += 1
                continue
            kept.append({
                "type": "BUY",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty_val),
                "price_per_share": price_val,
                "fees": total_fees,
                "dividend_amount": None,
                "notes": "",
            })
            continue

        if "YOU SOLD" in action_upper:
            if qty_val is None or qty_val == 0:
                filtered_count += 1
                continue
            kept.append({
                "type": "SELL",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty_val),
                "price_per_share": price_val,
                "fees": total_fees,
                "dividend_amount": None,
                "notes": "",
            })
            continue

        filtered_count += 1

    drip_count = sum(1 for t in kept if t["type"] == "BUY" and "[DRIP]" in (t["notes"] or ""))
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
            "splits_applied": 0,
        },
    }


# ── Charles Schwab (Transactions file) ────────────────────────────────────────

# Action types that represent dividend/distribution income
_SCHWAB_DIVIDEND_ACTIONS = {
    "Cash Dividend", "Non-Qualified Div", "Reinvest Dividend",
    "Div Adjustment", "Long Term Cap Gain", "Long Term Cap Gain Reinvest",
    "Short Term Cap Gain Reinvest", "Ret Cap Reinvest",
    "Pr Yr Cash Div", "Pr Yr Non Qual Div", "Pr Yr Div Reinvest",
}

# Action types that represent share purchases from reinvested dividends/distributions
_SCHWAB_DRIP_ACTIONS = {"Reinvest Shares"}

# Action types that are adjustments to reinvestments (share corrections)
_SCHWAB_REINVEST_ADJ_ACTIONS = {"Reinvestment Adj"}


def _schwab_parse_amount(raw):
    """Parse a Schwab Amount field like '$1,234.56 ' or '($33.02)' → float."""
    if not raw:
        return None
    s = raw.strip()
    negative = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace("$", "").replace(",", "").strip()
    val = _safe_float(s)
    if val is not None and negative:
        val = -val
    return val


def _schwab_parse_date_field(raw):
    """Parse Schwab date like '4/14/2026' or '04/02/2026 as of 03/25/2026'.

    For 'as of' dates, use the first date (the posting/settlement date).
    Returns YYYY-MM-DD string or None.
    """
    if not raw:
        return None
    # Take the first date when "as of" is present
    date_part = raw.split(" as of ")[0].strip()
    return _parse_date_str(date_part)


def parse_schwab_transactions_csv(file_path, filename):
    """Parse a Schwab Transactions CSV export.

    Columns: Date, Action, Symbol, Description, Quantity, Price, Fees & Comm, Amount

    Returns a normalised transaction result dict with BUY, SELL, and DIVIDEND entries.
    Reinvest Shares are imported as BUY with [DRIP] tag.
    All dividend-like distributions (cash, reinvested, cap gains, return of capital)
    are imported as DIVIDEND.
    """

    with open(file_path, "r", encoding="utf-8-sig") as fh:
        lines = fh.readlines()

    if not lines:
        raise ValueError("The CSV file is empty.")

    # Schwab transaction CSVs start directly with the header row
    # (Date,Action,Symbol,...) — no preamble lines like the positions file.
    # Find the header row to be safe.
    import io
    header_idx = None
    for i, line in enumerate(lines):
        stripped = line.strip().strip('"')
        if stripped.startswith("Date") and "Action" in line and "Symbol" in line:
            header_idx = i
            break

    if header_idx is None:
        raise ValueError(
            "Could not find the transaction header row (Date,Action,Symbol,...). "
            "Make sure this is a Schwab Transactions CSV export."
        )

    csv_text = "".join(lines[header_idx:])
    reader = csv.DictReader(io.StringIO(csv_text))

    kept = []
    filtered_count = 0

    for row in reader:
        action = (row.get("Action") or "").strip()
        symbol = (row.get("Symbol") or "").strip().upper()
        raw_date = (row.get("Date") or "").strip()
        raw_qty = (row.get("Quantity") or "").strip()
        raw_price = (row.get("Price") or "").replace("$", "").replace(",", "").strip()
        raw_fees = (row.get("Fees & Comm") or "").replace("$", "").replace(",", "").strip()
        raw_amount = (row.get("Amount") or "").strip()

        # Skip rows without a valid ticker
        if not symbol or not TICKER_RE.match(symbol):
            filtered_count += 1
            continue

        date_str = _schwab_parse_date_field(raw_date)
        if not date_str:
            filtered_count += 1
            continue

        amount = _schwab_parse_amount(raw_amount)
        qty = _safe_float(raw_qty)
        price = _safe_float(raw_price)
        fees = _safe_float(raw_fees) or 0.0

        # ── Dividend / distribution ──────────────────────────────────────
        if action in _SCHWAB_DIVIDEND_ACTIONS:
            div_amount = abs(amount) if amount is not None else 0.0
            # Div Adjustment can be negative (reversal)
            if action == "Div Adjustment" and amount is not None and amount < 0:
                div_amount = amount  # keep negative
            kept.append({
                "type": "DIVIDEND",
                "ticker": symbol,
                "date": date_str,
                "shares": None,
                "price_per_share": None,
                "fees": 0.0,
                "dividend_amount": round(div_amount, 2),
                "notes": action,
            })
            continue

        # ── DRIP reinvestment shares ─────────────────────────────────────
        if action in _SCHWAB_DRIP_ACTIONS:
            if qty is None or qty == 0:
                filtered_count += 1
                continue
            kept.append({
                "type": "BUY",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty),
                "price_per_share": price,
                "fees": fees,
                "dividend_amount": None,
                "notes": f"[DRIP] {action}",
            })
            continue

        # ── Reinvestment adjustment (share correction) ───────────────────
        if action in _SCHWAB_REINVEST_ADJ_ACTIONS:
            if qty is None or qty == 0:
                filtered_count += 1
                continue
            # Positive qty = shares added back, negative = shares removed
            txn_type = "BUY" if qty > 0 else "SELL"
            kept.append({
                "type": txn_type,
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty),
                "price_per_share": price,
                "fees": fees,
                "dividend_amount": None,
                "notes": f"[Adjustment] {action}",
            })
            continue

        # ── Buy ──────────────────────────────────────────────────────────
        if action == "Buy":
            if qty is None or qty == 0:
                filtered_count += 1
                continue
            kept.append({
                "type": "BUY",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty),
                "price_per_share": price,
                "fees": fees,
                "dividend_amount": None,
                "notes": "",
            })
            continue

        # ── Sell ─────────────────────────────────────────────────────────
        if action == "Sell":
            if qty is None or qty == 0:
                filtered_count += 1
                continue
            kept.append({
                "type": "SELL",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty),
                "price_per_share": price,
                "fees": fees,
                "dividend_amount": None,
                "notes": "",
            })
            continue

        # ── Unknown action — skip ────────────────────────────────────────
        filtered_count += 1

    # ── DRIP detection (for BUYs not already tagged) ────────────────────
    drip_count = _detect_drip(kept)
    # Don't double-count DRIP tags we already set
    already_drip = sum(1 for t in kept if t["type"] == "BUY" and "[DRIP]" in (t["notes"] or "") and t["notes"].startswith("[DRIP]"))
    drip_count = max(drip_count, already_drip)

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
            "splits_applied": 0,
        },
    }


# ── E*Trade (Transaction History — Buys & Sells) ─────────────────────────────

def _etrade_read_xlsx(file_path):
    """Read an E*Trade transaction history XLSX and return (account_info, header, data_rows).

    The file layout is:
        Row 1: Title (e.g. "Buys & Sells Activity Types")
        Row 3: Account info (e.g. "Account Activity for IRA -2797 from ...")
        Row 5: Total line
        Row 7: Column headers
        Row 8+: Data rows (until empty/disclaimer text)
    """
    import openpyxl

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if len(rows) < 8:
        raise ValueError("File has too few rows to be an E*Trade transaction export.")

    account_info = str(rows[2][0] or "").strip()  # Row 3
    header = [str(c or "").strip() for c in rows[6]]  # Row 7

    data_rows = []
    for row in rows[7:]:  # Row 8+
        # Stop at empty rows or disclaimer text
        if not row[0]:
            continue
        val = str(row[0]).strip()
        # Skip disclaimer/legal text at the bottom
        if val.startswith("The information") or val.startswith("E*TRADE") or val.startswith("Under the"):
            continue
        # Must have an activity type
        activity = row[3] if len(row) > 3 else None
        if not activity:
            continue
        data_rows.append(dict(zip(header, row)))

    return account_info, data_rows


def _etrade_extract_account_name(account_info):
    """Extract the account name from an E*TRADE activity header line."""
    text = (account_info or "").strip()
    if not text:
        return ""

    match = re.search(r"Account Activity for\s+(.+?)\s+from\s+", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()

    return text


def _etrade_parse_date_str(raw):
    """Parse E*Trade date like '03/06/26' (MM/DD/YY) or '2026-03-06'."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Try MM/DD/YY (2-digit year)
    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except (ValueError, AttributeError):
            continue
    return _parse_date_str(s)


def parse_etrade_buys_sells_xlsx(file_path, filename):
    """Parse an E*Trade Buys & Sells transaction history XLSX export.

    Returns a normalised transaction result dict with BUY and SELL entries.
    """
    account_info, data_rows = _etrade_read_xlsx(file_path)
    account_name = _etrade_extract_account_name(account_info)

    if not data_rows:
        raise ValueError("No transaction rows found in the E*Trade buys/sells file.")

    kept = []
    filtered_count = 0

    for row in data_rows:
        activity = (str(row.get("Activity Type") or "")).strip()
        symbol = (str(row.get("Symbol") or "")).strip().upper()
        raw_date = row.get("Activity/Trade Date")
        qty = row.get("Quantity #")
        price = row.get("Price $")
        amount = row.get("Amount $")
        commission = row.get("Commission")

        if not symbol or not TICKER_RE.match(symbol):
            filtered_count += 1
            continue

        date_str = _etrade_parse_date_str(raw_date)
        if not date_str:
            filtered_count += 1
            continue

        qty_val = _safe_float(qty)
        price_val = _safe_float(price)
        fees = _safe_float(commission) or 0.0

        if activity == "Bought":
            if qty_val is None or qty_val == 0:
                filtered_count += 1
                continue
            kept.append({
                "type": "BUY",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty_val),
                "price_per_share": price_val,
                "fees": fees,
                "dividend_amount": None,
                "notes": "",
            })
        elif activity == "Sold":
            if qty_val is None or qty_val == 0:
                filtered_count += 1
                continue
            kept.append({
                "type": "SELL",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty_val),
                "price_per_share": price_val,
                "fees": fees,
                "dividend_amount": None,
                "notes": "",
            })
        else:
            filtered_count += 1

    buys = sum(1 for t in kept if t["type"] == "BUY")
    sells = sum(1 for t in kept if t["type"] == "SELL")

    return {
        "account_name": account_name,
        "transactions": kept,
        "summary": {
            "buys": buys,
            "sells": sells,
            "dividends": 0,
            "filtered": filtered_count,
            "drip_detected": 0,
            "splits_applied": 0,
        },
    }


# ── E*Trade (Transaction History — Dividends) ────────────────────────────────

def parse_etrade_dividends_xlsx(file_path, filename):
    """Parse an E*Trade Dividends transaction history XLSX export.

    Positive Amount = cash dividend payment → DIVIDEND
    Negative Amount with Quantity/Price = DRIP reinvestment → BUY with [DRIP] tag
    Both the cash dividend and the DRIP buy are imported so the full picture
    is captured (dividend income + share accumulation).
    """
    account_info, data_rows = _etrade_read_xlsx(file_path)
    account_name = _etrade_extract_account_name(account_info)

    if not data_rows:
        raise ValueError("No dividend rows found in the E*Trade dividends file.")

    kept = []
    filtered_count = 0

    for row in data_rows:
        symbol = (str(row.get("Symbol") or "")).strip().upper()
        raw_date = row.get("Activity/Trade Date")
        qty = row.get("Quantity #")
        price = row.get("Price $")
        amount = row.get("Amount $")
        activity = (str(row.get("Activity Type") or "")).strip()
        description = str(row.get("Description") or "").strip()

        if not symbol or not TICKER_RE.match(symbol):
            filtered_count += 1
            continue

        date_str = _etrade_parse_date_str(raw_date)
        if not date_str:
            filtered_count += 1
            continue

        amount_val = _safe_float(amount)
        qty_val = _safe_float(qty)
        price_val = _safe_float(price)

        if amount_val is None:
            filtered_count += 1
            continue

        is_reinvestment = amount_val < 0 and qty_val is not None and qty_val > 0
        activity_lower = activity.lower()
        description_lower = description.lower()
        looks_like_dividend = (
            "dividend" in activity_lower
            or "capital gain" in activity_lower
            or "dividend" in description_lower
            or "capital gain" in description_lower
        )

        if is_reinvestment:
            # DRIP reinvestment — the negative amount is the cost of shares bought
            kept.append({
                "type": "BUY",
                "ticker": symbol,
                "date": date_str,
                "shares": abs(qty_val),
                "price_per_share": price_val,
                "fees": 0.0,
                "dividend_amount": None,
                "notes": "[DRIP] Dividend Reinvestment",
            })
        elif amount_val > 0 and looks_like_dividend:
            # Cash dividend / capital gain distribution
            kept.append({
                "type": "DIVIDEND",
                "ticker": symbol,
                "date": date_str,
                "shares": None,
                "price_per_share": None,
                "fees": 0.0,
                "dividend_amount": round(amount_val, 2),
                "notes": activity or description or "Dividend",
            })
        else:
            filtered_count += 1

    drip_count = sum(1 for t in kept if t["type"] == "BUY" and "[DRIP]" in (t["notes"] or ""))
    buys = sum(1 for t in kept if t["type"] == "BUY")
    divs = sum(1 for t in kept if t["type"] == "DIVIDEND")

    return {
        "account_name": account_name,
        "transactions": kept,
        "summary": {
            "buys": buys,
            "sells": 0,
            "dividends": divs,
            "filtered": filtered_count,
            "drip_detected": drip_count,
            "splits_applied": 0,
        },
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_date(raw):
    """Parse a date string to a datetime.date, or None."""
    if raw is None:
        return None

    raw = str(raw).strip()
    if not raw:
        return None

    snowball_match = re.match(r"^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}", raw)
    if snowball_match:
        try:
            return datetime.strptime(snowball_match.group(0), "%a %b %d %Y").date()
        except ValueError:
            pass

    if isinstance(raw, datetime):
        return raw.date()

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%Y %H:%M:%S", "%b-%d-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
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
    "snowball_holdings": parse_snowball_holdings_csv,
    "schwab": parse_schwab_csv,
    "schwab_transactions": parse_schwab_transactions_csv,
    "etrade": parse_etrade_csv,
    "etrade_buys_sells": parse_etrade_buys_sells_xlsx,
    "etrade_dividends": parse_etrade_dividends_xlsx,
    "fidelity": parse_fidelity_positions_xlsx,
    "fidelity_transactions": parse_fidelity_transactions_xlsx,
}

# Labels shown in the UI format dropdown
PARSER_LABELS = {
    "snowball": "Snowball Analytics",
    "snowball_holdings": "Snowball Holdings (Migration)",
    "schwab": "Charles Schwab (Positions)",
    "schwab_transactions": "Charles Schwab (Transactions)",
    "etrade": "E*Trade (Positions)",
    "etrade_buys_sells": "E*Trade (Buys & Sells)",
    "etrade_dividends": "E*Trade (Dividends)",
    "fidelity": "Fidelity (Positions)",
    "fidelity_transactions": "Fidelity (Transactions)",
}
