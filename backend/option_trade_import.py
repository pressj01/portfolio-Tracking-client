"""Normalize generic and broker option-transaction exports.

The existing portfolio import intentionally ignores option contracts.  This
module reads the same kind of broker activity file through a separate path and
turns each recognized row into an option execution.  It never writes to the
equity ``transactions`` or holdings tables.
"""

from __future__ import annotations

import csv
import hashlib
import re
from collections import Counter, defaultdict
from functools import lru_cache
from itertools import combinations
from datetime import date, datetime


SUPPORTED_FORMATS = {
    "generic": "Generic Options Transactions",
    "schwab": "Charles Schwab Transactions",
    "etrade": "E*TRADE Transactions",
    "fidelity": "Fidelity Transactions",
    "robinhood": "Robinhood Transactions",
    "shear_group": "Shear Group Activity",
    "interactive_brokers": "Interactive Brokers Transactions",
}


HEADER_ALIASES = {
    "Date": ["Transaction Date", "Run Date", "Activity/Trade Date", "Activity Date", "Process Date", "Trade Date", "Executed At"],
    "Action": ["Type", "Transaction Type", "Transaction Code", "Trans Code", "Activity", "Activity Type", "Side"],
    "Underlying": ["Ticker", "Underlying Symbol", "Root Symbol"],
    "Symbol": ["Option Symbol", "OCC Symbol", "Instrument", "Security", "Symbol/CUSIP"],
    "Description": ["Security Description", "Instrument Description", "Name"],
    "Option Type": ["Call/Put", "Put/Call", "C/P", "Contract Type"],
    "Expiration": ["Expiration Date", "Expiry", "Exp Date"],
    "Strike": ["Strike Price"],
    "Contracts": ["Quantity", "Qty", "Quantity #"],
    "Price": ["Fill Price", "Price ($)", "Price $", "Unit Price", "Price/Contract"],
    "Fees": ["Fee", "Fees ($)", "Fees & Comm", "Fees & Commissions", "Regulatory Fees"],
    "Commission": ["Commission ($)", "Commissions"],
    "Trade ID": ["Group ID", "Strategy ID", "Position ID"],
    "Order ID": ["Transaction ID", "Activity ID", "Reference", "Reference #", "Confirmation Number"],
    "Strategy": ["Strategy Type", "Trade Type"],
    "Purpose": ["Trade Purpose", "Income Classification"],
    "Account": ["Account Name", "Account", "Account Number", "Account Nickname"],
    "Notes": ["Note", "Memo", "Comments"],
}


def _header_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _alias_map():
    result = {}
    for canonical, aliases in HEADER_ALIASES.items():
        for alias in [canonical, *aliases]:
            result.setdefault(_header_key(alias), canonical)
    return result


_ALIASES = _alias_map()


def _read_rows(file_path, filename):
    if str(filename or file_path).lower().endswith(".csv"):
        with open(file_path, "r", encoding="utf-8-sig", newline="") as handle:
            return list(csv.reader(handle))

    import openpyxl

    workbook = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    try:
        sheet = workbook["Transactions"] if "Transactions" in workbook.sheetnames else workbook.active
        return [list(row) for row in sheet.iter_rows(values_only=True)]
    finally:
        workbook.close()


def _find_records(rows):
    best = None
    for index, row in enumerate(rows[:50]):
        header = [_ALIASES.get(_header_key(cell), str(cell or "").strip()) for cell in row]
        present = set(header)
        if "Date" not in present or "Action" not in present:
            continue
        score = len(present & set(HEADER_ALIASES))
        if best is None or score > best[0]:
            best = (score, index, header)
    if best is None:
        raise ValueError(
            "Could not find option transaction columns. The file needs at least Date and Action columns."
        )

    _, header_index, header = best
    records = []
    for row_number, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
        if not any(value is not None and str(value).strip() for value in row):
            continue
        values = list(row) + [None] * max(0, len(header) - len(row))
        record = {"_row": row_number}
        for key, value in zip(header, values):
            if not key:
                continue
            if key not in record or record[key] in (None, ""):
                record[key] = value
        records.append(record)
    return records


def _safe_float(value):
    if value is None or str(value).strip() in {"", "-", "--"}:
        return None
    text = str(value).strip().replace("$", "").replace(",", "")
    negative = text.startswith("(") and text.endswith(")")
    try:
        number = float(text.strip("()"))
        return -number if negative else number
    except (TypeError, ValueError):
        return None


def _date_string(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    # Schwab posts expiration on the next business day, for example
    # "09/21/2026 as of 09/18/2026". The as-of date is the actual outcome
    # date and belongs in realized P/L, rather than the posting date.
    as_of = re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}\s+as of\s+(\d{1,2}/\d{1,2}/\d{4})", text, re.IGNORECASE)
    if as_of:
        text = as_of.group(1)
    for fmt in (
        "%Y-%m-%d",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%m/%d/%Y %H:%M:%S",
        "%b %d, %Y",
        "%b-%d-%Y",
    ):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_occ_symbol(value):
    """Return OCC contract fields from padded or compact OSI symbols."""
    raw = str(value or "").strip().upper()
    compact = re.sub(r"\s+", "", raw.removeprefix("O:").lstrip("-"))
    match = re.fullmatch(r"([A-Z][A-Z0-9.]{0,5})(\d{6})([CP])(\d{8})", compact)
    if not match:
        return None
    underlying, raw_date, option_type, raw_strike = match.groups()
    try:
        expiration = datetime.strptime(raw_date, "%y%m%d").date().isoformat()
    except ValueError:
        return None
    return {
        "underlying": underlying,
        "expiration": expiration,
        "option_type": "CALL" if option_type == "C" else "PUT",
        "strike": int(raw_strike) / 1000,
        "occ_symbol": compact,
    }


def parse_option_descriptor(value):
    """Read common broker descriptions such as ``SPY 08/21/26 600 C``."""
    text = " ".join(str(value or "").upper().replace("$", " ").split())
    occ_match = re.search(r"[A-Z][A-Z0-9.]{0,5}\s*\d{6}[CP]\d{8}", text)
    if occ_match:
        parsed = parse_occ_symbol(occ_match.group(0))
        if parsed:
            return parsed

    cp = r"(?:C|CALL|P|PUT)"
    patterns = [
        rf"(?P<underlying>[A-Z][A-Z0-9.]{{0,9}})\s+(?P<date>\d{{1,2}}/\d{{1,2}}/\d{{2,4}})\s+(?P<strike>\d+(?:\.\d+)?)\s*(?P<cp>{cp})\b",
        rf"(?P<underlying>[A-Z][A-Z0-9.]{{0,9}})\s+(?P<date>\d{{1,2}}/\d{{1,2}}/\d{{2,4}})\s+(?P<cp>{cp})\s*(?P<strike>\d+(?:\.\d+)?)\b",
        rf"(?P<cp>{cp})\s+(?P<underlying>[A-Z][A-Z0-9.]{{0,9}})\s+(?P<date>\d{{1,2}}/\d{{1,2}}/\d{{2,4}})\s+(?P<strike>\d+(?:\.\d+)?)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        expiration = _date_string(match.group("date"))
        if not expiration:
            continue
        option_type = match.group("cp")
        return {
            "underlying": match.group("underlying"),
            "expiration": expiration,
            "option_type": "CALL" if option_type in {"C", "CALL"} else "PUT",
            "strike": float(match.group("strike")),
            "occ_symbol": None,
        }
    return None


def _normalize_option_type(value):
    text = str(value or "").strip().upper()
    if text in {"C", "CALL", "CALLS"}:
        return "CALL"
    if text in {"P", "PUT", "PUTS"}:
        return "PUT"
    return None


def _normalize_action(value):
    text = " ".join(str(value or "").upper().replace("_", " ").replace("-", " ").split())
    compact = text.replace(" ", "")
    direct = {"BTO": "BTO", "STO": "STO", "BTC": "BTC", "STC": "STC"}
    if compact in direct:
        return direct[compact], None
    if "EXPIR" in text:
        return "EXPIRE", None
    if "ASSIGN" in text:
        return "ASSIGN", None
    if "EXERCI" in text:
        return "EXERCISE", None

    is_buy = "BUY" in text or "BOUGHT" in text
    is_sell = "SELL" in text or "SOLD" in text
    is_open = "OPEN" in text
    is_close = "CLOS" in text
    if is_buy and is_open:
        return "BTO", None
    if is_sell and is_open:
        return "STO", None
    if is_buy and is_close:
        return "BTC", None
    if is_sell and is_close:
        return "STC", None
    if is_buy:
        return "BTO", "Action did not identify opening or closing; assumed Buy to Open."
    if is_sell:
        return "STO", "Action did not identify opening or closing; assumed Sell to Open."
    return None, "Unrecognized option action."


def _aggregate_positions(legs):
    """Net identical fills into sorted (type, side, expiration, strike, contracts)."""
    quantities = defaultdict(int)
    for row in legs:
        key = (str(row["option_type"]).upper(), str(row["position_side"]).upper(),
               str(row["expiration"])[:10], float(row["strike"]))
        quantities[key] += int(row["contracts"])
    return tuple(sorted((*key, quantity) for key, quantity in quantities.items() if quantity > 0))


def _strategy_for_legs(legs):
    """Match fill geometry to the scanner's named option structures.

    A broker's order group is only evidence of which fills arrived together.
    It does not identify the strategy. Aggregate identical fills first, then
    require the scanner pattern's sides, strikes, expirations and quantities.

    The importer groups every opening fill for an underlying on one day, so a
    package is often two structures placed together -- a double-hedge put
    butterfly with its bear call spread, or bear call spreads on two
    expirations. Those are named by their parts ("Double-Hedge Put Butterfly
    + Bear Call Spread") rather than hidden as Custom. Custom is left for
    packages that do not break into a few named structures.
    """
    return _classify_positions(_aggregate_positions(legs))


@lru_cache(maxsize=4096)
def _classify_positions(positions):
    if not positions:
        return "Custom"
    named = _named_structure(positions)
    if named != "Custom":
        return named
    parts = _decompose_positions(positions)
    return _composite_label(parts) if parts else "Custom"


@lru_cache(maxsize=65536)
def _named_structure(positions):
    """One named structure for these aggregated positions, else Custom."""
    if len(positions) == 1:
        option_type, side, _, _, _ = positions[0]
        if side == "SHORT":
            return "Short Call" if option_type == "CALL" else "Short Put"
        return "Long Call" if option_type == "CALL" else "Long Put"

    if len(positions) == 2:
        first, second = positions
        types = {first[0], second[0]}
        sides = {first[1], second[1]}
        same_expiration = first[2] == second[2]
        if len(types) == 1 and sides == {"LONG", "SHORT"}:
            option_type = first[0]
            long_leg = next(row for row in positions if row[1] == "LONG")
            short_leg = next(row for row in positions if row[1] == "SHORT")
            long_strike, short_strike = long_leg[3], short_leg[3]
            if not same_expiration:
                if long_leg[2] > short_leg[2] and long_leg[4] == short_leg[4]:
                    pattern = "Calendar" if long_strike == short_strike else "Diagonal"
                    return f"Long {option_type.title()} {pattern}"
                return "Custom"
            if long_leg[4] == short_leg[4] and long_strike != short_strike:
                if option_type == "CALL":
                    return "Bull Call Spread" if long_strike < short_strike else "Bear Call Spread"
                return "Bear Put Spread" if long_strike > short_strike else "Bull Put Spread"
            if long_leg[4] < short_leg[4] and (
                (option_type == "CALL" and long_strike < short_strike)
                or (option_type == "PUT" and long_strike > short_strike)
            ):
                return f"{option_type.title()} Ratio Spread"
            # More long contracts, further out of the money than the short.
            if long_leg[4] > short_leg[4] and (
                (option_type == "CALL" and long_strike > short_strike)
                or (option_type == "PUT" and long_strike < short_strike)
            ):
                return f"{option_type.title()} Backspread"
        if types == {"CALL", "PUT"} and same_expiration and first[4] == second[4]:
            if len(sides) == 1:
                same_strike = first[3] == second[3]
                prefix = "Long" if first[1] == "LONG" else "Short"
                return f"{prefix} {'Straddle' if same_strike else 'Strangle'}"
            if first[3] == second[3]:
                call = first if first[0] == "CALL" else second
                return "Synthetic Long Stock" if call[1] == "LONG" else "Synthetic Short Stock"

    if len(positions) == 3:
        types = {row[0] for row in positions}
        expirations = {row[2] for row in positions}
        if len(types) == len(expirations) == 1 and len({row[3] for row in positions}) == 3:
            low, body, high = sorted(positions, key=lambda row: row[3])
            if (low[1], body[1], high[1]) == ("LONG", "SHORT", "LONG"):
                if low[4] == high[4] and body[4] == low[4] * 2:
                    if body[3] - low[3] == high[3] - body[3]:
                        return f"{low[0].title()} Butterfly"
                    return f"Unbalanced {low[0].title()} Butterfly"
                if (low[0] == "PUT" and low[4] == high[4] * 2
                        and body[4] == high[4] * 2
                        and body[3] - low[3] > high[3] - body[3]):
                    return "Double-Hedge Put Butterfly"
                # The call-side mirror: the doubled wing is the far upper one.
                if (low[0] == "CALL" and high[4] == low[4] * 2
                        and body[4] == low[4] * 2
                        and high[3] - body[3] > body[3] - low[3]):
                    return "Double-Hedge Call Butterfly"
        return "Custom"

    if len(positions) == 4 and len({row[2] for row in positions}) == 1:
        calls = [row for row in positions if row[0] == "CALL"]
        puts = [row for row in positions if row[0] == "PUT"]
        if len(calls) == len(puts) == 2:
            by_leg = {(row[0], row[1]): row for row in positions}
            if len(by_leg) == 4:
                long_put = by_leg[("PUT", "LONG")]
                short_put = by_leg[("PUT", "SHORT")]
                short_call = by_leg[("CALL", "SHORT")]
                long_call = by_leg[("CALL", "LONG")]
                paired_sides = (long_put[4] == short_put[4]
                                and short_call[4] == long_call[4])
                if paired_sides and long_put[3] < short_put[3] <= short_call[3] < long_call[3]:
                    equal_size = long_put[4] == long_call[4]
                    equal_width = abs((short_put[3] - long_put[3])
                                      - (long_call[3] - short_call[3])) < 0.000001
                    if short_put[3] == short_call[3]:
                        return "Iron Butterfly" if equal_size and equal_width else "Custom"
                    return "Iron Condor" if equal_size and equal_width else "Unbalanced Iron Condor"
        if len(calls) == 4 or len(puts) == 4:
            ordered = sorted(positions, key=lambda row: row[3])
            if (len({row[3] for row in ordered}) == 4
                    and [row[1] for row in ordered] == ["LONG", "SHORT", "SHORT", "LONG"]
                    and ordered[0][4] == ordered[1][4]
                    and ordered[2][4] == ordered[3][4]):
                kind = ordered[0][0].title()
                if ordered[0][4] == ordered[2][4]:
                    return f"{kind} Condor"
                return f"Unbalanced {kind} Condor"

    # Asymmetrical iron condor (AIC / Weirdor): a put credit spread, a smaller
    # put debit spread above it as the hedge, and a smaller call credit spread.
    if len(positions) == 6 and len({row[2] for row in positions}) == 1:
        puts = sorted((row for row in positions if row[0] == "PUT"), key=lambda row: row[3])
        calls = sorted((row for row in positions if row[0] == "CALL"), key=lambda row: row[3])
        if len(puts) == 4 and len(calls) == 2:
            put_long, put_short, hedge_short, hedge_long = puts
            call_short, call_long = calls
            if ([row[1] for row in puts] == ["LONG", "SHORT", "SHORT", "LONG"]
                    and [row[1] for row in calls] == ["SHORT", "LONG"]
                    and put_long[3] < put_short[3] < hedge_short[3] < hedge_long[3]
                    < call_short[3] < call_long[3]
                    and put_long[4] == put_short[4]
                    and hedge_short[4] == hedge_long[4]
                    and call_short[4] == call_long[4]
                    and hedge_short[4] < put_short[4]
                    # The scanner's call side is 1:4 or 2:10 of the put side.
                    # A near-equal call condor is two unbalanced condors.
                    and call_short[4] * 2 <= put_short[4]):
                return "Asymmetrical Iron Condor"
    return "Custom"


# Sizes of the structures _named_structure can name, largest first.
_STRUCTURE_SIZES = (6, 4, 3, 2, 1)
# Beyond this a label stops describing the trade; leave it Custom for review.
_MAX_COMPOSITE_PARTS = 4
_MAX_COMPOSITE_GROUP = 10


def _decompose_positions(positions):
    """Fewest named structures that exactly cover the positions, or None.

    Structures only combine legs of one expiration (a calendar or diagonal is
    recognized only as a whole two-leg package), so each expiration is split
    on its own. Among equally short splits, fewer single-leg parts win, so a
    butterfly plus a call spread beats an unbalanced condor plus a stray put.
    """
    by_expiration = defaultdict(list)
    for position in positions:
        by_expiration[position[2]].append(position)
    parts = []
    for expiration in sorted(by_expiration):
        group = tuple(by_expiration[expiration])
        if len(group) > _MAX_COMPOSITE_GROUP:
            return None
        split = _best_partition(group)
        if split is None:
            return None
        parts.extend((name, size) for name, size, _ in split)
    if len(parts) < 2 or len(parts) > _MAX_COMPOSITE_PARTS:
        return None
    return parts


def _best_partition(group):
    # Fewest parts, then fewest single legs, then fewest "Unbalanced" parts,
    # then fewest parts mixing calls and puts: a 4x10 call condor beside a
    # 1-lot put spread reads as that, not as a lopsided iron condor.
    def score(parts):
        return (
            len(parts),
            sum(size == 1 for _, size, _ in parts),
            sum(name.startswith("Unbalanced") for name, _, _ in parts),
            sum(mixed for _, _, mixed in parts),
            sorted(parts),
        )

    @lru_cache(maxsize=None)
    def solve(mask):
        if not mask:
            return ()
        first = (mask & -mask).bit_length() - 1
        others = [index for index in range(len(group)) if mask >> index & 1 and index != first]
        best = None
        for size in _STRUCTURE_SIZES:
            if size - 1 > len(others):
                continue
            for combo in combinations(others, size - 1):
                subset = (first, *combo)
                name = _named_structure(tuple(group[index] for index in subset))
                if name == "Custom":
                    continue
                rest = solve(mask & ~sum(1 << index for index in subset))
                if rest is None:
                    continue
                mixed = len({group[index][0] for index in subset}) > 1
                candidate = ((name, size, mixed), *rest)
                if best is None or score(candidate) < score(best):
                    best = candidate
        return best

    return solve((1 << len(group)) - 1)


def _composite_label(parts):
    counts = Counter(name for name, _ in parts)
    sizes = {name: size for name, size in parts}
    ordered = sorted(counts, key=lambda name: (-sizes[name], name))
    return " + ".join(
        f"{counts[name]}x {name}" if counts[name] > 1 else name for name in ordered
    )


STRUCTURE_NAMES = frozenset({
    "Long Call", "Long Put", "Short Call", "Short Put",
    "Bull Call Spread", "Bear Call Spread", "Bull Put Spread", "Bear Put Spread",
    "Call Ratio Spread", "Put Ratio Spread", "Call Backspread", "Put Backspread",
    "Long Call Calendar", "Long Put Calendar", "Long Call Diagonal", "Long Put Diagonal",
    "Long Straddle", "Short Straddle", "Long Strangle", "Short Strangle",
    "Synthetic Long Stock", "Synthetic Short Stock",
    "Call Butterfly", "Put Butterfly",
    "Unbalanced Call Butterfly", "Unbalanced Put Butterfly",
    "Double-Hedge Put Butterfly", "Double-Hedge Call Butterfly",
    "Iron Butterfly", "Iron Condor", "Unbalanced Iron Condor",
    "Call Condor", "Put Condor", "Unbalanced Call Condor", "Unbalanced Put Condor",
    "Asymmetrical Iron Condor",
})
# Labels earlier importer versions wrote before the current classifier.
_LEGACY_IMPORT_LABELS = frozenset({"Custom", "Butterfly / Custom", "Unbalanced Butterfly"})


def strategy_parts(label):
    """Structure names in a label, without the "2x " multiplicity prefix."""
    return [re.sub(r"^\d+x ", "", part.strip()) for part in str(label or "").split(" + ")]


def is_generated_strategy_label(label):
    """True when the classifier (current or legacy) could have written label."""
    if label in _LEGACY_IMPORT_LABELS:
        return True
    parts = strategy_parts(label)
    return bool(parts) and all(part in STRUCTURE_NAMES for part in parts)


SCANNER_STRATEGY_KEYS = {
    "Bull Put Spread": "bull-put-spread", "Bear Call Spread": "bear-call-spread",
    "Bull Call Spread": "bull-call-spread", "Bear Put Spread": "bear-put-spread",
    "Iron Condor": "iron-condor", "Unbalanced Iron Condor": "iron-condor",
    "Iron Butterfly": "iron-butterfly",
    "Put Condor": "put-call-condor", "Call Condor": "put-call-condor",
    "Unbalanced Put Condor": "unbalanced-put-condor",
    "Put Butterfly": "put-butterfly", "Call Butterfly": "call-butterfly",
    "Unbalanced Call Butterfly": "unbalanced-butterfly",
    "Unbalanced Put Butterfly": "unbalanced-butterfly",
    "Double-Hedge Put Butterfly": "double-hedge-put-butterfly",
    "Long Call Calendar": "long-call-calendar", "Long Put Calendar": "long-put-calendar",
    "Long Call Diagonal": "long-call-diagonal", "Long Put Diagonal": "long-put-diagonal",
    "Call Ratio Spread": "call-ratio-spread", "Put Ratio Spread": "put-ratio-spread",
    "Long Call": "long-call", "Long Put": "long-put",
    "Long Straddle": "long-straddle", "Long Strangle": "long-strangle",
    "Short Straddle": "short-straddle", "Short Strangle": "short-strangle",
}


def scanner_strategy_key(strategy, opening_dte=None):
    """General-scanner key for a single named structure, else None."""
    if strategy == "Asymmetrical Iron Condor":
        if opening_dte is None:
            return None
        # The 14-Day AIC enters at 30-35 DTE and the Monthly at 40-50.
        return "fourteen-day-aic" if opening_dte < 38 else "monthly-aic"
    return SCANNER_STRATEGY_KEYS.get(strategy)


def _opening_dte(rows):
    try:
        opened = min(date.fromisoformat(str(row["executed_at"])[:10]) for row in rows)
        expiration = min(date.fromisoformat(str(row["expiration"])[:10]) for row in rows)
    except (KeyError, TypeError, ValueError):
        return None
    return (expiration - opened).days


_INCOME_STRUCTURES = frozenset({
    "Short Call", "Short Put", "Bull Put Spread", "Bear Call Spread",
    "Iron Condor", "Unbalanced Iron Condor", "Iron Butterfly",
    "Short Straddle", "Short Strangle", "Asymmetrical Iron Condor",
})


def _default_purpose(strategy):
    parts = strategy_parts(strategy)
    return "Income" if all(part in _INCOME_STRUCTURES for part in parts) else "Directional"


def _dedupe_hash(row, source_format):
    parts = [
        source_format,
        row.get("account"),
        row.get("external_id"),
        row.get("executed_at"),
        row.get("action"),
        row.get("underlying"),
        row.get("expiration"),
        row.get("option_type"),
        row.get("strike"),
        row.get("contracts"),
        row.get("price"),
        row.get("fees"),
    ]
    return hashlib.sha256("|".join(str(value or "") for value in parts).encode("utf-8")).hexdigest()


def parse_option_transactions(file_path, filename, source_format="generic"):
    """Return normalized executions, review warnings, and import counts."""
    source_format = str(source_format or "generic").strip().lower()
    if source_format not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported option transaction format: {source_format}")

    records = _find_records(_read_rows(file_path, filename))
    executions = []
    filtered = []
    for record in records:
        action, action_warning = _normalize_action(record.get("Action"))
        executed_at = _date_string(record.get("Date"))
        parsed = None
        for candidate in (record.get("Symbol"), record.get("Description")):
            parsed = parse_occ_symbol(candidate) or parse_option_descriptor(candidate)
            if parsed:
                break

        separate_type = _normalize_option_type(record.get("Option Type"))
        separate_expiration = _date_string(record.get("Expiration"))
        separate_strike = _safe_float(record.get("Strike"))
        underlying = str(record.get("Underlying") or (parsed or {}).get("underlying") or "").strip().upper()
        option_type = separate_type or (parsed or {}).get("option_type")
        expiration = separate_expiration or (parsed or {}).get("expiration")
        strike = separate_strike if separate_strike is not None else (parsed or {}).get("strike")
        occ_symbol = (parsed or {}).get("occ_symbol")
        contracts = _safe_float(record.get("Contracts"))
        price = _safe_float(record.get("Price"))
        fees = (_safe_float(record.get("Fees")) or 0) + (_safe_float(record.get("Commission")) or 0)

        missing = []
        if not action:
            missing.append("action")
        if not executed_at:
            missing.append("date")
        if not underlying:
            missing.append("underlying")
        if not option_type:
            missing.append("call/put")
        if not expiration:
            missing.append("expiration")
        if strike is None:
            missing.append("strike")
        if contracts is None or contracts == 0:
            missing.append("contracts")
        if price is None and action not in {"EXPIRE", "ASSIGN", "EXERCISE"}:
            missing.append("price")
        if missing:
            filtered.append({"row": record["_row"], "reason": f"Missing or invalid {', '.join(missing)}"})
            continue

        trade_id = str(record.get("Trade ID") or "").strip() or None
        external_id = str(record.get("Order ID") or "").strip() or None
        phase = "OPEN" if action in {"BTO", "STO"} else "CLOSE"
        group_key = (
            f"trade:{trade_id}" if trade_id else
            f"order:{external_id}" if external_id else
            f"auto:{underlying}:{executed_at}:{phase}"
        )
        position_side = "LONG" if action in {"BTO", "STC"} else "SHORT"
        warnings = [warning for warning in [action_warning] if warning]
        normalized = {
            "source_row": record["_row"],
            "account": str(record.get("Account") or "").strip() or None,
            "executed_at": executed_at,
            "action": action,
            "underlying": underlying,
            "option_type": option_type,
            "expiration": expiration,
            "strike": float(strike),
            "contracts": int(abs(contracts)),
            "price": abs(float(price or 0)),
            "fees": round(abs(float(fees)), 2),
            "occ_symbol": occ_symbol,
            "position_side": position_side,
            "trade_group_id": trade_id,
            "group_key": group_key,
            "external_id": external_id,
            "strategy_type": str(record.get("Strategy") or "").strip() or None,
            "purpose": str(record.get("Purpose") or "").strip().title() or None,
            "notes": str(record.get("Notes") or record.get("Description") or "").strip(),
            "warnings": warnings,
        }
        normalized["dedupe_hash"] = _dedupe_hash(normalized, source_format)
        executions.append(normalized)

    opening_groups = defaultdict(list)
    for execution in executions:
        if execution["action"] in {"BTO", "STO"}:
            opening_groups[execution["group_key"]].append(execution)
    for group in opening_groups.values():
        specified = next((row["strategy_type"] for row in group if row["strategy_type"]), None)
        strategy = specified or _strategy_for_legs(group)
        purpose = next((row["purpose"] for row in group if row["purpose"]), None) or _default_purpose(strategy)
        for row in group:
            row["strategy_type"] = strategy
            row["purpose"] = purpose
            row["scanner_strategy_key"] = scanner_strategy_key(strategy, _opening_dte(group))

    executions.sort(key=lambda row: (row["executed_at"], row["source_row"]))
    warning_count = sum(bool(row["warnings"]) for row in executions)
    return {
        "source_format": source_format,
        "source_label": SUPPORTED_FORMATS[source_format],
        "executions": executions,
        "filtered_rows": filtered,
        "summary": {
            "recognized": len(executions),
            "opening": sum(row["action"] in {"BTO", "STO"} for row in executions),
            "closing": sum(row["action"] not in {"BTO", "STO"} for row in executions),
            "needs_review": warning_count,
            "filtered": len(filtered),
            "groups": len(opening_groups),
        },
    }
