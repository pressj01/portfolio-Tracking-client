"""Look-through diversification.

Resolves what each fund in the portfolio actually owns, then folds those
constituents up into portfolio-level weights so a position in three S&P funds
reports as one NVDA slice rather than three fund slices.

Three things make this harder than it looks, and each is handled explicitly:

1. Depth. The free top-25 tables cover as little as 6% of a broad fund (RSP
   6.1%, SPSB 8.4%, AVUV 17.7% when measured). Issuer files are used first
   because they are complete -- SSGA's SPYM sheet carries 596 rows summing to
   99.96%. Whatever is still missing is reported as "Undisclosed" instead of
   being normalised away, so the chart never overstates what is known.

2. Synthetics. Option-income funds file Treasuries and option legs, not
   exposure: KGLD's filed holdings are three T-bill rows at 35.7/33.3/31.8%.
   Read literally the portfolio looks like cash. fund_exposure_map records what
   such a fund is economically exposed to, and 'economic' mode uses it.

3. Gaps. Mutual funds and money-market funds have no free constituent source at
   all. Those are surfaced for manual entry rather than silently dropped;
   source='manual' rows always win and are never overwritten by a refresh.
"""

import datetime
import html as html_lib
import io
import json
import re
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import requests
from flask import jsonify, request

from config import get_connection

HTTP_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
HTTP_TIMEOUT = 25


def _http_get(url, tries=3, backoff=1.5):
    """GET with retry.

    Resolving the whole portfolio hits these hosts a few hundred times, and
    under concurrency they throttle: SPAB and SPSB both resolve alone but came
    back empty in a 6-worker sweep, silently downgrading two fully-covered SSGA
    funds to 'unresolved'. Retrying turns a rate-limit into a slow success
    instead of a wrong answer.
    """
    last = None
    for attempt in range(tries):
        try:
            resp = requests.get(url, timeout=HTTP_TIMEOUT, headers=HTTP_HEADERS)
            if resp.status_code == 200:
                return resp
            # 404 means "not this issuer's fund" -- retrying cannot help.
            if resp.status_code == 404:
                return None
            last = resp
        except Exception:
            last = None
        if attempt < tries - 1:
            time.sleep(backoff * (attempt + 1))
    return last if (last is not None and getattr(last, "status_code", 0) == 200) else None

# Rows the issuers use for cash / derivative sleeves. Kept as real constituents
# (they are genuinely part of the fund) but labelled so they group together
# instead of scattering as dozens of one-off CUSIP strings.
_CASH_PAT = re.compile(
    r"(\bcash\b|money\s*market|government\s+obligations\s+fund|"
    r"treasury\s+bill|t-?bill|^b\.0|repurchase|repo\b|"
    r"deposit\b|net\s+other|other\s+assets|payable|receivable|margin|"
    # Issuers list the fund's own cash line as a currency ("US Dollar", $USD).
    r"^u\.?s\.?\s+dollar$|^\$?usd$)",
    re.I,
)
_DERIV_PAT = re.compile(
    r"(swap|option|future|forward|call\b|put\b|irs\s+usd|written|curncy|"
    # Broker-style contract descriptors: "Ibit 12/18/2026 35.01 C",
    # "Etha 09/18/2026 11.05 P". These carry no ticker and are not exposure to
    # a company, so they belong in the derivatives bucket rather than sitting in
    # the list looking like a holding.
    r"\d{1,2}/\d{1,2}/\d{2,4}\s+[\d.]+\s*[CP]\b|"
    # Currency forwards: "NOK/USD 09/16/2026 Curncy".
    r"^[A-Z]{3}/[A-Z]{3}\s|"
    # Broker descriptors: "SPXW US 08/03/26 C7595".
    r"\d{1,2}/\d{1,2}/\d{2,4}\s+[CP]\d+\b)",
    re.I,
)
# Option/forward identifiers that arrive in the symbol column.
_DERIV_SYM_PAT = re.compile(r"(CURNCY$|^\w+\d{6}[CP]\d+$|\d{6}[CP]\d{5,}$)", re.I)
# Zero-coupon bill tickers arrive as "B 0 09.03.26", normalising to B0090326.
_BILL_SYM_PAT = re.compile(r"^B0\d{6}$")
# A real exchange ticker: letters only, at most 5 (BRKB, VOO, QQQM). Excludes
# CUSIPs and swap identifiers, which are digit-bearing and/or much longer.
_TICKER_PAT = re.compile(r"^[A-Z]{1,5}$")


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _norm_symbol(sym):
    """Normalise a ticker so BRK.B / BRK-B / BRKB aggregate together."""
    if not sym:
        return ""
    s = str(sym).strip().upper()
    if s in {"-", "N/A", "NA", "NONE", "--", "CASH"}:
        return ""
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


def _norm_name(name):
    """Normalise an issuer name so 'NVIDIA CORP' == 'NVIDIA Corp.'."""
    if not name:
        return ""
    s = str(name).upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(
        r"\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|LP|LLC|NV|SA|AG|"
        r"CLASS|CL|COM|COMMON|STOCK|SHARES|SHS|THE|GROUP|HOLDINGS|HLDGS|REIT)\b",
        " ",
        s,
    )
    return re.sub(r"\s+", " ", s).strip()


def _clean_weight(value):
    if value is None:
        return None
    try:
        w = float(str(value).replace("%", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    if w != w:  # NaN
        return None
    return round(w, 4)


def _row(symbol, name, weight):
    return {
        "symbol": _norm_symbol(symbol),
        "name": (str(name).strip() if name else "") or _norm_symbol(symbol),
        "weight_pct": _clean_weight(weight),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Issuer fetchers -- complete holdings, preferred over any top-N table
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_ssga_holdings(ticker, limit=None):
    """SSGA / SPDR daily holdings workbook (SPYM, SPAB, SPSB, SPTS, ...)."""
    import pandas as pd

    url = (
        "https://www.ssga.com/us/en/intermediary/library-content/products/"
        f"fund-data/etfs/us/holdings-daily-us-en-{ticker.strip().lower()}.xlsx"
    )
    resp = _http_get(url)
    if resp is None or len(resp.content) < 2000:
        return []
    try:
        raw = pd.read_excel(io.BytesIO(resp.content), header=None)
    except Exception:
        return []

    # Equity sheets carry Name/Ticker/Weight; bond sheets carry
    # Name/Identifier/Weight with no Ticker column at all, so keying off
    # "ticker" alone silently dropped every fixed-income fund (SPAB's 8,597
    # rows read as zero). Name + Weight is the real common denominator.
    header_row = None
    for i in range(min(15, len(raw))):
        cells = [str(x).strip().lower() for x in raw.iloc[i].tolist()]
        if "name" in cells and any(c == "weight" for c in cells):
            header_row = i
            break
    if header_row is None:
        return []

    try:
        df = pd.read_excel(io.BytesIO(resp.content), header=header_row)
    except Exception:
        return []
    df.columns = [str(c).strip() for c in df.columns]
    if "Weight" not in df.columns:
        return []

    rows = []
    for _, r in df.iterrows():
        name = r.get("Name")
        if name is None or str(name).strip().lower() in {"nan", ""}:
            continue
        weight = _clean_weight(r.get("Weight"))
        if weight is None:
            continue
        rows.append(_row(r.get("Ticker"), name, weight))
        if limit and len(rows) >= limit:
            break
    return rows


def _fetch_vanguard_holdings(ticker, limit=None):
    """Vanguard profile API -- full holdings, following pagination.

    The endpoint caps each response at 500 entities. Broad funds run far past
    that (VTWO reports size=1998), and taking only the first page left it 65%
    covered -- under the nesting threshold, so it stayed an unexpanded fund
    slice. Paging to the reported size fixes both.
    """
    sym = ticker.strip().upper()
    page_size = 500
    out = []
    for sleeve in ("stock", "bond"):
        base = ("https://investor.vanguard.com/investment-products/etfs/profile/api/"
                f"{sym}/portfolio-holding/{sleeve}")
        start, total = 1, None
        while True:
            url = base if start == 1 else f"{base}?start={start}&count={page_size}"
            resp = _http_get(url)
            if resp is None:
                break
            try:
                data = resp.json() or {}
            except Exception:
                break
            if total is None:
                try:
                    total = int(data.get("size") or 0)
                except (TypeError, ValueError):
                    total = 0
            entities = (data.get("fund") or {}).get("entity") or []
            if not entities:
                break
            for e in entities:
                weight = _clean_weight(e.get("percentWeight"))
                if weight is None:
                    continue
                out.append(_row(e.get("ticker"), e.get("longName") or e.get("shortName"), weight))
                if limit and len(out) >= limit:
                    return out
            start += len(entities)
            if not total or start > total or len(entities) < page_size:
                break
    return out


def _fetch_neos_full_holdings(ticker, limit=None):
    """NEOS holdings CSV -- the COMPLETE file, not the top 25.

    app.py's _fetch_neos_top_holdings hits this same endpoint but truncates to
    25 rows, which is why QQQI resolved at 30.7%. The file itself is complete:
    QQQI is 106 rows and SPYI is 509. Covers the whole NEOS lineup (QQQI, SPYI,
    XQQI, IAUI, BTCI, CSHI, HYBI, NEHI, IWMI, IYRI ...).
    """
    import csv
    from io import StringIO

    sym = ticker.strip().upper()
    url = ("https://neosfunds.com/wp-admin/admin-ajax.php"
           f"?action=download_holdings_csv&ticker={urllib.parse.quote(sym)}")
    resp = _http_get(url)
    if resp is None:
        return []
    try:
        reader = list(csv.DictReader(StringIO(resp.text or "")))
    except Exception:
        return []

    rows = []
    for r in reader:
        # Guard against the endpoint returning some other fund's file.
        account = (r.get("Account") or "").strip().upper()
        if account and account != sym:
            continue
        weight = _clean_weight(r.get("Weightings"))
        if weight is None:
            continue
        name = (r.get("SecurityName") or "").strip()
        symbol = (r.get("StockTicker") or "").strip()
        if symbol.lower() in {"cash&other", "cash & other"}:
            symbol = ""
        rows.append(_row(symbol, name or symbol, weight))
        if limit and len(rows) >= limit:
            break
    return rows


def _fetch_amplify_holdings(ticker, limit=None):
    """Amplify ETFs publish a full holdings CSV per fund (DIVO, DRVR, ETTY...)."""
    sym = ticker.strip().upper()
    import csv
    from io import StringIO

    for url in (
        f"https://amplifyetfs.com/wp-content/fundholdings/{sym}-holdings.csv",
        f"https://amplifyetfs.com/wp-content/uploads/fundholdings/{sym}-holdings.csv",
    ):
        resp = _http_get(url, tries=2)
        if resp is None or "<html" in (resp.text or "")[:200].lower():
            continue
        try:
            reader = list(csv.DictReader(StringIO(resp.text or "")))
        except Exception:
            continue
        rows = []
        for r in reader:
            keys = {k.strip().lower(): k for k in r.keys() if k}
            wcol = next((keys[k] for k in keys if "weight" in k or "% of" in k), None)
            ncol = next((keys[k] for k in keys if "name" in k or "security" in k), None)
            scol = next((keys[k] for k in keys if k in {"ticker", "symbol", "stockticker"}), None)
            if not wcol:
                break
            weight = _clean_weight(r.get(wcol))
            if weight is None:
                continue
            rows.append(_row(r.get(scol) if scol else "", r.get(ncol) if ncol else "", weight))
            if limit and len(rows) >= limit:
                break
        if len(rows) >= 3:
            return rows
    return []


def _records_to_rows(records, limit=None):
    """Turn tabular issuer records into our common holdings row shape."""
    if not records:
        return []

    keys = {(str(k) if k is not None else "").strip().lower(): k
            for k in records[0].keys() if k is not None}

    # Prefer exact percentage labels before fuzzy matching. Several issuer
    # files contain both "Net Assets" (a dollar amount) and "Weightings" (the
    # percentage we need); picking the first column containing "assets" would
    # turn a $1bn fund into billions of percent coverage.
    exact_weights = (
        "weightings", "weight", "weight (%)", "weight(%)", "weight %",
        "% of fund", "% of assets", "% of net assets", "% market value",
        "percent of assets", "percent of portfolio", "allocation",
    )
    wcol = next((keys[k] for k in exact_weights if k in keys), None)
    if wcol is None:
        wcol = next((keys[k] for k in keys
                     if "weight" in k or "% of" in k or "percent of" in k
                     or k.endswith(" allocation")), None)
    if not wcol:
        return []

    ncol = next((keys[k] for k in keys
                 if k in {"name", "security name", "holding name", "description"}), None)
    if ncol is None:
        ncol = next((keys[k] for k in keys
                     if "name" in k or "security" in k or "description" in k), None)
    scol = next((keys[k] for k in keys
                 if k in {"ticker", "symbol", "stockticker", "stock ticker",
                          "holding ticker"}), None)

    def clean_cell(value):
        if value is None:
            return ""
        # pandas represents empty spreadsheet cells as floating-point NaN.
        # Letting that become the literal ticker "NAN" creates a fake holding.
        try:
            if value != value:
                return ""
        except Exception:
            pass
        text = str(value).strip()
        return "" if text.lower() in {"nan", "none", "null"} else text

    rows = []
    for record in records:
        weight = _clean_weight(record.get(wcol))
        if weight is None:
            continue
        symbol = clean_cell(record.get(scol)) if scol else ""
        name = clean_cell(record.get(ncol)) if ncol else ""
        if not (symbol or name):
            continue
        rows.append(_row(symbol, name, weight))
        if limit and len(rows) >= limit:
            break
    return rows


def _parse_generic_csv_text(text, limit=None):
    """Parse a holdings CSV whose issuer-specific preamble/columns may vary."""
    import csv
    from io import StringIO

    if "<html" in text[:400].lower():
        return []

    # Issuers often precede the header with title rows -- BlackRock ships
    # 'Fund Holdings as of,"Jun 30, 2026"' and a blank line before
    # 'Name,Weight (%)'. Feeding that to DictReader makes the title the header
    # and yields nothing, so find the real header first.
    lines = text.splitlines()
    start = 0
    for i, line in enumerate(lines[:25]):
        low = line.lower()
        if ("weight" in low or "% of" in low) and line.count(",") >= 1:
            start = i
            break
    try:
        reader = list(csv.DictReader(StringIO("\n".join(lines[start:]))))
    except Exception:
        return []
    return _records_to_rows(reader, limit)


def _fetch_generic_csv(ticker, limit=None, url=None):
    """Column-sniffing CSV reader for issuers that publish a plain holdings file."""
    if not url:
        return []
    resp = _http_get(url, tries=2)
    if resp is None:
        return []
    return _parse_generic_csv_text(resp.text or "", limit)


def _parse_generic_excel_bytes(content, limit=None):
    """Parse issuer XLS/XLSX files after locating their real header row."""
    import pandas as pd

    try:
        raw = pd.read_excel(io.BytesIO(content), header=None)
    except Exception:
        return []
    if raw.empty:
        return []

    header_row = None
    for i in range(min(30, len(raw))):
        cells = [str(x).strip().lower() for x in raw.iloc[i].tolist()]
        if any("weight" in c or "% of" in c or "percent of" in c for c in cells):
            header_row = i
            break
    if header_row is None:
        return []

    headers = [str(x).strip() if str(x).lower() != "nan" else ""
               for x in raw.iloc[header_row].tolist()]
    records = []
    for values in raw.iloc[header_row + 1:].itertuples(index=False, name=None):
        records.append({headers[i]: value for i, value in enumerate(values) if headers[i]})
    return _records_to_rows(records, limit)


def _download_links(page_url, page_html):
    """Rank official holdings downloads found on a fund page."""
    links = []
    decoded = html_lib.unescape(page_html or "")
    for match in re.finditer(r"(?is)<a\b([^>]*?)>(.*?)</a>", decoded):
        attrs, label_html = match.group(1), match.group(2)
        href_match = re.search(r'''(?is)href\s*=\s*["']([^"']+)["']''', attrs)
        if not href_match:
            continue
        href = urllib.parse.urljoin(page_url, href_match.group(1).strip())
        low = f"{href} {_strip_tags(label_html)}".lower()
        parsed_path = urllib.parse.urlsplit(href).path.lower()
        # VanEck's official workbook is served from an extensionless route
        # ending in /download/xlsx/. Accept explicit format path segments as
        # well as conventional filenames.
        if not re.search(r"(?:\.xlsx?|\.csv)$|/(?:xlsx?|csv)/?$", parsed_path):
            continue
        if not any(token in low for token in ("holding", "position")):
            continue
        if any(token in low for token in
               ("nav_history", "nav-history", "distribution", "intraday", "intra-day", "trade")):
            continue
        score = (4 if "holding" in low else 0) + (3 if "position" in low else 0)
        score += 2 if re.search(r"(?:\.csv$|/csv/?$)", parsed_path) else 1
        if href not in {item[1] for item in links}:
            links.append((score, href))
    return [href for _score, href in sorted(links, key=lambda item: -item[0])]


def _fetch_page_download(ticker, limit=None, url=None):
    """Follow an issuer page's current Holdings download and parse it.

    The dated filename changes daily for Schwab and Shelton, so storing the
    download URL itself would go stale. Visiting the fund page also establishes
    the session cookie required by Schwab's otherwise-public CSV endpoint.
    """
    if not url:
        return []
    session = requests.Session()
    try:
        page = session.get(url, timeout=HTTP_TIMEOUT, headers=HTTP_HEADERS)
    except Exception:
        return []
    if page.status_code != 200:
        return []

    candidates = _download_links(page.url, page.text or "")
    best = []
    best_coverage = float("-inf")
    for download_url in candidates:
        try:
            resp = session.get(
                download_url,
                timeout=HTTP_TIMEOUT,
                headers={**HTTP_HEADERS, "Referer": page.url,
                         "Accept": "text/csv,application/vnd.ms-excel,"
                                   "application/vnd.openxmlformats-officedocument."
                                   "spreadsheetml.sheet,*/*;q=0.8"},
            )
        except Exception:
            continue
        if resp.status_code != 200 or not resp.content:
            continue

        magic = resp.content[:8]
        if magic.startswith(b"PK\x03\x04") or magic.startswith(b"\xd0\xcf\x11\xe0"):
            rows = _parse_generic_excel_bytes(resp.content, limit)
        else:
            rows = _parse_generic_csv_text(resp.text or "", limit)
        coverage = sum(r.get("weight_pct") or 0 for r in rows)
        # A distribution/history table can also contain percentages. Reject
        # obviously impossible totals instead of poisoning the cache.
        if rows and -5 <= coverage <= 125 and (coverage, len(rows)) > (best_coverage, len(best)):
            best, best_coverage = rows, coverage

    if best:
        return best
    # A few issuers put all rows directly in the page instead of a file.
    return _parse_holdings_table_html(page.text or "", limit)


def _fetch_avantis_holdings(ticker, limit=None, url=None):
    """Read Avantis' complete embedded ETF holdings array.

    Their total-holdings page renders only 50 rows at a time, but its server
    payload contains the complete `etfHoldings` array (hundreds or thousands of
    rows). Reading that payload avoids both pagination loss and rescaling.
    """
    if not url:
        return []
    resp = _http_get(url, tries=2)
    if resp is None:
        return []
    text = html_lib.unescape(resp.text or "")
    marker = "etfHoldings:["
    start = text.find(marker)
    if start < 0:
        return []
    start += len(marker) - 1

    depth = 0
    quote = None
    escaped = False
    end = None
    for i in range(start, len(text)):
        ch = text[i]
        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            continue
        if ch in {'"', "'"}:
            quote = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end is None:
        return []

    def prop(obj, key):
        found = re.search(rf'''(?:^|,)\s*{re.escape(key)}:"((?:\\.|[^"\\])*)"''', obj)
        if not found:
            return ""
        try:
            return json.loads('"' + found.group(1) + '"')
        except Exception:
            return found.group(1)

    rows = []
    for obj in re.findall(r"\{([^{}]*)\}", text[start + 1:end]):
        weight = _clean_weight(prop(obj, "weight"))
        name = prop(obj, "name")
        symbol = prop(obj, "ticker")
        if weight is None or not (name or symbol):
            continue
        rows.append(_row(symbol, name, weight))
        if limit and len(rows) >= limit:
            break
    return rows


_ADAMS_REPORT_SYMBOLS = {
    "ADAMS NATURAL RESOURCES FUND": "PEO",
    "STATE STREET COMMUNICATION SERVICES SELECT SECTOR SPDR ETF": "XLC",
    "STATE STREET CONSUMER STAPLES SELECT SECTOR SPDR ETF": "XLP",
    "STATE STREET FINANCIAL SELECT SECTOR SPDR ETF": "XLF",
    "STATE STREET TECHNOLOGY SELECT SECTOR SPDR ETF": "XLK",
    "STATE STREET MATERIALS SELECT SECTOR SPDR ETF": "XLB",
    "ISHARES U S REAL ESTATE ETF": "IYR",
}


def _parse_adams_schedule_text(text, limit=None):
    """Parse the complete Schedule of Investments from an Adams report PDF."""
    schedule_match = re.search(
        r"S\s*CHEDULE OF\s+I\s*NVESTMENTS(?:\s*\([^)]*\))?.{0,300}?"
        r"Shares\s+Value.*?Common Stocks",
        text or "", re.I | re.S,
    )
    if not schedule_match:
        return []

    # Reports contain comparison dates in earlier statements. Bind the date to
    # the actual schedule (or its first continued page), not the PDF's first
    # date-like string.
    schedule_tail = (text or "")[schedule_match.start():schedule_match.start() + 6000]
    date_match = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|"
        r"November|December)\s+(\d{1,2}),\s+(\d{4})\b",
        schedule_tail, re.I,
    )
    as_of = None
    if date_match:
        try:
            as_of = datetime.datetime.strptime(
                " ".join(date_match.groups()), "%B %d %Y"
            ).date().isoformat()
        except ValueError:
            pass
    after_schedule = (text or "")[schedule_match.start():]
    net_match = re.search(
        r"Net Assets\s*[\u2014-]\s*100\.0%\s*\$?\s*([\d,]+)", after_schedule, re.I
    )
    if not net_match:
        return []
    net_assets = float(net_match.group(1).replace(",", ""))
    if net_assets <= 0:
        return []

    segment = after_schedule[:net_match.end()]
    rows = []
    pending = ""
    row_pattern = re.compile(
        r"^(.*?)\s+(\d[\d,]*)\s+\$?\s*([\d,]+)$"
    )

    def clean_name(value):
        value = re.sub(r"\s+", " ", value).strip()
        # pypdf occasionally separates the first capital from the rest of a
        # word ("T esla", "T echnology").
        value = re.sub(r"\b([A-Z])\s+(?=[a-z]{2})", r"\1", value)
        value = re.sub(r"\s+([,.;])", r"\1", value)
        value = re.sub(r"(?:\s*\([a-z]\))+$", "", value, flags=re.I)
        return value.strip()

    for raw in segment.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        low = line.lower()
        if not line or low in {"shares value (a)", "(unaudited)"}:
            continue
        if ("schedule of investments" in low or re.search(r"\s[\u2014-]\s*\(?\d", line)
                or low.startswith(("total ", "net assets", "other assets", "(cost "))
                or re.fullmatch(r"[\d,]+", line)
                or re.fullmatch(r"(?:january|february|march|april|may|june|july|august|"
                                 r"september|october|november|december) \d{1,2}, \d{4}",
                                 low)):
            pending = ""
            continue

        match = row_pattern.match(line)
        if not match:
            # Multi-line security names are common for the sector ETFs and
            # money-market funds. Keep only plausible name fragments.
            if not any(token in low for token in
                       ("common stocks", "other investments", "short-term investments",
                        "money market funds", "financials", "utilities")):
                pending = f"{pending} {line}".strip()
            continue

        name_part, _shares, market_value = match.groups()
        name = clean_name(f"{pending} {name_part}".strip())
        pending = ""
        if not name or name.lower().startswith(("total ", "cost ")):
            continue
        value = float(market_value.replace(",", ""))
        if value <= 0:
            continue
        normalised = _norm_name(name)
        symbol = _ADAMS_REPORT_SYMBOLS.get(normalised, "")
        row = _row(symbol, name, 100.0 * value / net_assets)
        if as_of:
            row["as_of"] = as_of
        rows.append(row)
        if limit and len(rows) >= limit:
            break
    # The schedule states securities at market value and reports a separate
    # "other assets less liabilities" line to reconcile them to net assets.
    # Preserve that signed balance so look-through dollars do not exceed (or
    # fall short of) the value of the fund position.
    coverage = sum(row.get("weight_pct") or 0 for row in rows)
    balance = 100.0 - coverage
    if not limit and rows and 0.01 <= abs(balance) <= 5.0:
        row = _row("", "Cash & other assets, net of liabilities", balance)
        if as_of:
            row["as_of"] = as_of
        rows.append(row)
    return rows


def _fetch_adams_report(ticker, limit=None, url=None):
    """Follow the fund page to its newest quarterly/annual holdings report.

    Adams' page displays only ten holdings, but the linked financial report
    contains the complete Schedule of Investments. Reports are ranked as Q1,
    Q2, Q3, then annual/Q4 within each year so refresh automatically advances
    when Adams publishes the next report.
    """
    if not url:
        return []
    sym = ticker.strip().lower()
    candidates = []
    for _attempt in range(3):
        page = _http_get(url, tries=1)
        if page is None:
            continue
        for href in re.findall(r'''(?is)href\s*=\s*["']([^"']+\.pdf)["']''',
                               html_lib.unescape(page.text or "")):
            absolute = urllib.parse.urljoin(page.url, href)
            filename = urllib.parse.urlsplit(absolute).path.rsplit("/", 1)[-1].lower()
            quarter = re.fullmatch(rf"{re.escape(sym)}_q([1-3])_(\d{{4}})\.pdf", filename)
            annual = re.fullmatch(
                rf"{re.escape(sym)}_annual(?:_report)?_(\d{{4}})\.pdf", filename
            )
            if quarter:
                candidates.append(((int(quarter.group(2)), int(quarter.group(1))), absolute))
            elif annual:
                candidates.append(((int(annual.group(1)), 4), absolute))
        if candidates:
            break
    if not candidates:
        return []

    from pypdf import PdfReader

    for _rank, report_url in sorted(set(candidates), reverse=True):
        report = _http_get(report_url, tries=2)
        if report is None or not report.content.startswith(b"%PDF"):
            continue
        try:
            reader = PdfReader(io.BytesIO(report.content))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception:
            continue
        rows = _parse_adams_schedule_text(text, limit)
        coverage = sum(row.get("weight_pct") or 0 for row in rows)
        if rows and 95 <= coverage <= 105:
            return rows
    return []


def _fetch_html_table(ticker, limit=None, url=None):
    """Scrape a server-rendered holdings table from an issuer page.

    Covers issuers that publish holdings as plain HTML (Reaves' UTG page, Adams'
    ADX page, Amplify's fund pages). Pages that build their table in JavaScript
    return nothing here -- see _fetch_tidal_json for one such platform.
    """
    if not url:
        return []
    resp = _http_get(url, tries=2)
    if resp is None:
        return []
    return _parse_holdings_table_html(resp.text or "", limit)


def _fetch_tidal_json(ticker, limit=None, url=None):
    """Holdings from the Tidal Website Manager REST API.

    Tidal-hosted fund sites (nicholasx.com / XFUNDS) render holdings in
    JavaScript, so there is no table in the page source. The widget fetches
    `/wp-json/twm/v1/data?type=holdings-table&post_id=N` and that endpoint
    returns the finished table as HTML inside JSON -- full holdings, not a top
    ten (NUKX comes back with 57 rows).

    `url` is the fund page; the numeric post_id is read from its Elementor
    page class ("elementor-2183"), since nothing else on the page exposes it.
    """
    if not url:
        return []
    page = _http_get(url, tries=2)
    if page is None:
        return []
    ids = re.findall(r"elementor-(\d{3,7})\b", page.text or "")
    if not ids:
        return []
    # The page's own id dominates the stylesheet; element ids appear once each.
    post_id = max(set(ids), key=ids.count)

    parsed = urllib.parse.urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    api = (f"{origin}/wp-json/twm/v1/data"
           f"?type=holdings-table&post_id={urllib.parse.quote(post_id)}")
    resp = _http_get(api, tries=2)
    if resp is None:
        return []
    try:
        payload = resp.json()
    except Exception:
        return []
    html = payload.get("html") if isinstance(payload, dict) else None
    if not html:
        return []
    return _parse_holdings_table_html(html, limit)


def _fetch_amplify_firestore(ticker, limit=None, url=None):
    """Full holdings from Amplify's Firestore feed.

    Amplify's fund page shows only a top 10 (DRVR came back 36.8% covered), but
    the site's own holdings page reads the complete list from Firestore at
    funds/{TICKER}/holdings/{as_of_date} -- 51 rows for DRVR. This makes the
    same public read the page makes.

    `url` is the collection endpoint including the API key; the newest as-of
    document is selected from it.
    """
    if not url:
        return []
    sym = ticker.strip().upper()
    listing = _http_get(url.replace("{ticker}", urllib.parse.quote(sym)), tries=2)
    if listing is None:
        return []
    try:
        docs = (listing.json() or {}).get("documents") or []
    except Exception:
        return []
    if not docs:
        return []

    # Document ids are as-of dates, so the newest sorts last.
    latest = max(d.get("name", "").rsplit("/", 1)[-1] for d in docs if d.get("name"))
    doc = next((d for d in docs if d.get("name", "").endswith("/" + latest)), None)
    if doc is None:
        return []

    values = (((doc.get("fields") or {}).get("holdings") or {})
              .get("arrayValue", {}).get("values") or [])
    rows = []
    for item in values:
        fields = (item.get("mapValue") or {}).get("fields") or {}

        def field(key):
            holder = fields.get(key) or {}
            for v in holder.values():
                return v
            return None

        weight = _clean_weight(field("Weightings"))
        if weight is None:
            continue
        symbol = str(field("StockTicker") or "").strip()
        name = str(field("SecurityName") or "").strip()
        if symbol.lower() in {"cash&other", "cash & other"}:
            symbol = ""
        rows.append(_row(symbol, name or symbol, weight))
        if limit and len(rows) >= limit:
            break
    return rows


def _parse_holdings_table_html(html, limit=None):
    """Read the best holdings table out of an HTML fragment.

    Picks the table whose header names a percent column, then reads name /
    ticker / weight from it.
    """
    best = []
    for tb in re.findall(r"(?is)<table[^>]*>(.*?)</table>", html):
        rows = re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", tb)
        if len(rows) < 3:
            continue
        header = [_strip_tags(c).lower()
                  for c in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", rows[0])]
        if not header:
            continue
        wi = next((i for i, h in enumerate(header)
                   if "%" in h or "weight" in h or "net asset" in h), None)

        body = [re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", rr) for rr in rows[1:]]
        if wi is None:
            # Some issuers head the block with a title instead of column names
            # ("TOP 10 HOLDINGS"). Find the column whose cells are actually
            # percentages rather than giving up on the table.
            widths = max((len(c) for c in body), default=0)
            for col in range(widths):
                vals = [_strip_tags(c[col]) for c in body if len(c) > col]
                pcts = [v for v in vals if v.strip().endswith("%") and _clean_weight(v) is not None]
                if vals and len(pcts) >= max(2, len(vals) // 2):
                    wi = col
                    break
        if wi is None:
            continue
        ni = next((i for i, h in enumerate(header)
                   if "name" in h or "company" in h or "security" in h or "holding" in h), None)
        si = next((i for i, h in enumerate(header)
                   if h.strip() in {"ticker", "symbol", "identifier", "holding ticker"}), None)

        def looks_like_tickers(col):
            """True when a column's values are mostly exchange symbols.

            'Identifier' carries tickers on First Trust's equity funds but
            CUSIPs on their bond funds, so the header alone cannot be trusted.
            """
            vals = [_strip_tags(c[col]) for c in body if len(c) > col]
            vals = [v for v in vals if v]
            if not vals:
                return False
            hits = sum(1 for v in vals if _TICKER_PAT.match(v.upper()))
            return hits >= max(2, int(len(vals) * 0.6))

        if si is not None and not looks_like_tickers(si):
            si = None
        if si is None:
            si = next((i for i in range(len(header))
                       if i != wi and i != ni and looks_like_tickers(i)), None)
        # Some issuers leave the name column's header blank (Adams Funds ships
        # "" | Market Value | Percent of Net Assets). Fall back to the first
        # column that isn't the weight, or every row would be dropped.
        if ni is None:
            ni = next((i for i in range(len(header)) if i != wi and i != si), None)

        out = []
        for rr in rows[1:]:
            cells = [_strip_tags(c) for c in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", rr)]
            if len(cells) <= wi:
                continue
            weight = _clean_weight(cells[wi])
            if weight is None:
                continue
            name = cells[ni] if ni is not None and len(cells) > ni else ""
            sym = cells[si] if si is not None and len(cells) > si else ""
            if not (name or sym):
                continue
            # Skip roll-up rows like "Total" / "Top Ten Holdings".
            if re.match(r"(?i)^(total|top\s|net\s|subtotal)", name.strip()):
                continue
            out.append(_row(sym, name or sym, weight))
            if limit and len(out) >= limit:
                break
        if len(out) > len(best):
            best = out
    return best


def _strip_tags(value):
    s = re.sub(r"(?is)<[^>]+>", " ", value or "")
    s = s.replace("&amp;", "&").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", s).strip()


# Format handlers. The URL and the ticker->issuer mapping come from the
# fund_issuers / fund_issuer_map tables; only the parsing lives in code.
PARSERS = {
    "neos_csv": _fetch_neos_full_holdings,
    "ssga_xlsx": _fetch_ssga_holdings,
    "vanguard_json": _fetch_vanguard_holdings,
    "generic_csv": _fetch_generic_csv,
    "page_download": _fetch_page_download,
    "avantis_html": _fetch_avantis_holdings,
    "adams_report_pdf": _fetch_adams_report,
    "html_table": _fetch_html_table,
    "tidal_json": _fetch_tidal_json,
    "amplify_firestore": _fetch_amplify_firestore,
}

# Parsers that read whatever URL the issuer row supplies, rather than building
# their own. Forgetting to pass the URL here silently returns zero holdings.
URL_DRIVEN_PARSERS = {
    "generic_csv", "page_download", "avantis_html", "adams_report_pdf", "html_table",
    "tidal_json", "amplify_firestore",
}

# Seeded once into fund_issuers. Editable afterwards -- the table is the
# authority, this is only the starting set.
ISSUER_SEED = [
    ("neos", "NEOS Investments", "neos_csv",
     "https://neosfunds.com/wp-admin/admin-ajax.php?action=download_holdings_csv&ticker={ticker}",
     "https://neosfunds.com", "Full holdings CSV; verified ~100% coverage."),
    ("ssga", "SSGA / SPDR", "ssga_xlsx",
     "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/"
     "holdings-daily-us-en-{ticker_lower}.xlsx",
     "https://www.ssga.com", "Daily holdings workbook; equity and bond sheets differ."),
    ("vanguard", "Vanguard", "vanguard_json",
     "https://investor.vanguard.com/investment-products/etfs/profile/api/{ticker}/portfolio-holding/stock",
     "https://investor.vanguard.com", "Profile API; stock and bond sleeves fetched separately."),
    ("amplify", "Amplify ETFs", "amplify_firestore",
     "https://firestore.googleapis.com/v1/projects/amplify-etfs-data-feed/"
     "databases/(default)/documents/funds/{ticker}/holdings"
     "?key=AIzaSyCibhGo4lu8ZALtBvf_ZT351BDMUPqOYjc&pageSize=300",
     "https://amplifyetfs.com",
     "Complete holdings from the same Firestore feed the fund page reads. The "
     "public /{ticker}/ page shows only a top 10."),
    ("tappalpha", "TappAlpha", "generic_csv", "",
     "https://www.tappalphafunds.com", "Holdings are JavaScript-rendered; no public file found."),
    ("nicholas", "Nicholas Wealth / XFUNDS", "tidal_json",
     "https://nicholasx.com/{ticker_lower}/",
     "https://nicholasx.com",
     "Tidal Website Manager REST API behind the fund page -- full holdings."),
    ("schwab", "Schwab Asset Management", "page_download",
     "https://www.schwabassetmanagement.com/products/{ticker_lower}",
     "https://www.schwabassetmanagement.com",
     "Follows the current dated FundHoldings CSV from the product page."),
    ("shelton", "Shelton Capital", "page_download",
     "https://advisor.sheltoncap.com/{ticker_lower}-holdings/",
     "https://sheltoncap.com",
     "Complete dated holdings CSV; TUGN uses a per-fund URL override."),
    ("yieldmax", "YieldMax ETFs", "page_download",
     "https://yieldmaxetfs.com/our-etfs/{ticker_lower}/",
     "https://yieldmaxetfs.com",
     "Follows the fund page's current TidalFG_Holdings CSV."),
    ("kurv", "Kurv Investment Management", "page_download",
     "https://www.kurvinvest.com/etf/{ticker_lower}",
     "https://www.kurvinvest.com",
     "Follows the complete holdings CSV published on each fund page."),
    ("virtus", "Virtus Investment Partners", "page_download",
     "https://www.virtus.com/products/{ticker_lower}",
     "https://www.virtus.com",
     "Official positions workbook; funds with descriptive page slugs use an override."),
    ("avantis", "Avantis Investors", "avantis_html",
     "https://www.avantisinvestors.com/avantis-investments/total-holdings/{ticker_lower}/?type=etf",
     "https://www.avantisinvestors.com",
     "Complete server payload behind the paginated Total Holdings page; fund-number override required."),
    ("vaneck", "VanEck", "page_download",
     "https://www.vaneck.com/us/en/investments/{ticker_lower}/holdings/",
     "https://www.vaneck.com",
     "Official daily holdings XLSX; descriptive page slugs use an override."),
    ("infracap", "InfraCap / Virtus", "generic_csv", "",
     "https://infracapfund.com", "URL not confirmed yet."),
    ("reaves", "Reaves Utility Income (UTG)", "html_table",
     "https://utilityincomefund.com/the_fund/",
     "https://utilityincomefund.com",
     "Server-rendered top-10 table with tickers. Single-fund page: the URL "
     "ignores {ticker}, so map only UTG here."),
    ("cohensteers", "Cohen & Steers", "html_table",
     "https://www.cohenandsteers.com/funds/infrastructure-fund/?symbol={ticker}",
     "https://www.cohenandsteers.com",
     "Holdings render in JavaScript -- no server-side table found."),
    ("aberdeen", "Aberdeen Investments", "html_table", "",
     "https://www.aberdeeninvestments.com",
     "Holdings render in JavaScript; the public page shows only a top 10."),
    ("goldman", "Goldman Sachs Asset Mgmt", "generic_csv", "",
     "https://www.gsam.com", "URL not confirmed yet -- GPIQ/GPIX live here."),
    ("stf", "STF Management", "generic_csv", "",
     "https://stfmanagement.com", "URL not confirmed yet -- TUGN lives here."),
    ("invesco", "Invesco", "generic_csv", "",
     "https://www.invesco.com",
     "Invesco returns HTTP 406 to automated requests, so its funds are served "
     "by the index-constituent source instead."),
    ("firsttrust", "First Trust", "html_table",
     "https://www.ftportfolios.com/Retail/Etf/EtfHoldings.aspx?Ticker={ticker}",
     "https://www.ftportfolios.com",
     "Full holdings with tickers in the 'Identifier' column."),
    ("nasdaq100_index", "Nasdaq-100 index constituents", "html_table",
     "https://www.slickcharts.com/nasdaq100",
     "https://www.slickcharts.com",
     "Index constituents and weights, not a fund's filed holdings. Valid for "
     "full-replication Nasdaq-100 trackers (QQQM, QQQ) whose issuer blocks "
     "automated access; the fund's small cash sleeve is not represented."),
    ("blackrock", "BlackRock", "page_download",
     "https://www.blackrock.com/us/individual/products/{ticker_lower}",
     "https://www.blackrock.com",
     "Follows latest-holdings.csv from each product page; product-id URL override required."),
    ("adams", "Adams Funds", "adams_report_pdf",
     "https://adamsfunds.com/funds/diversified-equity/",
     "https://adamsfunds.com",
     "Complete Schedule of Investments from the newest linked financial report; "
     "PEO uses a per-fund page override."),
]

# Ticker -> issuer. Seeded from the families confirmed while building this;
# users extend it from the Fund Definitions screen.
ISSUER_MAP_SEED = {
    "neos": ["QQQI", "SPYI", "XSPI", "XQQI", "IYRI", "IWMI", "IAUI", "BTCI",
             "CSHI", "HYBI", "NEHI", "GLDI", "NUKZ"],
    "ssga": ["SPYM", "SPAB", "SPSB", "SPTS", "KOMP", "XAR", "XLEI"],
    "vanguard": ["VOO", "VTWO", "VTI", "VYM", "VIG"],
    "amplify": ["DIVO", "DRVR", "ETTY", "SOLM", "SLJY"],
    "tappalpha": ["TDAQ", "TSPY", "TDAX", "TMGN", "TSYX"],
    "nicholas": ["DRMY", "BLOX", "NUKX", "GLDN", "WEPN", "GIAX"],
    "schwab": ["SCHG", "SCHD", "SCHB", "SCHX"],
    "shelton": ["TUGN", "SEPI"],
    "yieldmax": ["CHPY"],
    "kurv": ["KCOP"],
    "virtus": ["PFFA"],
    "avantis": ["AVUV", "AVDV"],
    "vaneck": ["SMH"],
    "blackrock": ["CALI", "EFV", "DGRO", "BST", "BSTZ", "BCAT"],
    # QQQM/QQQ track the Nasdaq-100 by full replication, and Invesco blocks
    # automated requests, so the index constituents stand in for the holdings.
    "nasdaq100_index": ["QQQM", "QQQ"],
    # Verified First Trust funds only. FSCO is FS Credit Opportunities and
    # FEOE is First Eagle -- similar-looking tickers, different issuers.
    "firsttrust": ["FBDC", "FTSM", "FVD"],
    "reaves": ["UTG"],
    "cohensteers": ["UTF"],
    "aberdeen": ["ASGI", "AOD", "AEF", "IAE", "IHD"],
    "adams": ["ADX", "PEO"],
    "infracap": ["QVOL"],
}


# Product pages whose path needs an issuer-specific id or descriptive slug.
# Seed/auto mappings may be upgraded, but a user's manual assignment always
# wins. Keeping the page URL (rather than a dated CSV) lets refresh discover the
# publisher's newest file every time.
ISSUER_URL_OVERRIDE_SEED = {
    "TUGN": ("shelton", "https://advisor.sheltoncap.com/investment-solutions/"
             "exchange-traded-funds/tugn/tugn-holdings/"),
    "SEPI": ("shelton", "https://advisor.sheltoncap.com/sepi-holdings/"),
    "PFFA": ("virtus", "https://www.virtus.com/products/virtus-infracap-us-preferred-stock-etf"),
    "AVUV": ("avantis", "https://www.avantisinvestors.com/avantis-investments/"
             "total-holdings/119/?type=etf"),
    "AVDV": ("avantis", "https://www.avantisinvestors.com/avantis-investments/"
             "total-holdings/120/?type=etf"),
    "SMH": ("vaneck", "https://www.vaneck.com/us/en/investments/"
            "semiconductor-etf-smh/holdings/"),
    "CALI": ("blackrock", "https://www.blackrock.com/us/individual/products/332497/"
             "blackrock-short-term-california-muni-bond-etf"),
    "EFV": ("blackrock", "https://www.blackrock.com/us/individual/products/239628/"
            "ishares-msci-eafe-value-etf"),
    "DGRO": ("blackrock", "https://www.blackrock.com/us/individual/products/264623/"
             "ishares-core-dividend-growth-etf"),
    "PEO": ("adams", "https://adamsfunds.com/funds/natural-resources/"),
}


# Exact old defaults from the first draft. Upgrade only these known values so a
# user-edited source remains authoritative.
ISSUER_DEFAULT_UPGRADES = {
    "shelton": (
        "html_table",
        "https://advisor.sheltoncap.com/investment-solutions/exchange-traded-funds/{ticker_lower}/",
    ),
    "blackrock": ("generic_csv", ""),
    "adams": ("html_table", "https://adamsfunds.com/funds/diversified-equity/"),
}


# Keywords matched against a fund's family/name (from Yahoo) so a newly held
# fund routes to its publisher automatically. '|' separated, case-insensitive.
ISSUER_MATCH = {
    "neos": "neos",
    "ssga": "spdr|state street|ssga",
    "vanguard": "vanguard",
    "amplify": "amplify",
    "tappalpha": "tappalpha",
    "nicholas": "nicholas|xfunds",
    "schwab": "schwab",
    "shelton": "shelton",
    "yieldmax": "yieldmax",
    "kurv": "kurv investment|kurv ",
    "virtus": "virtus",
    "avantis": "avantis",
    "vaneck": "vaneck",
    "infracap": "infracap",
    "reaves": "reaves",
    "cohensteers": "cohen & steers|cohen and steers",
    "aberdeen": "aberdeen|abrdn",
    "adams": "adams",
    "blackrock": "blackrock|ishares",
    # Deliberately not "ft " -- that would swallow First Eagle and others.
    "firsttrust": "first trust",
    "goldman": "goldman",
    "stf": "stf ",
    "invesco": "invesco",
}


def _seed_issuers(conn):
    cur = conn.cursor()
    added = 0
    for key, label, parser, url, site, note in ISSUER_SEED:
        exists = cur.execute(
            "SELECT parser, url_template FROM fund_issuers WHERE issuer_key=?", (key,)
        ).fetchone()
        if exists:
            # A row seeded before a working endpoint was known still has an
            # empty template. Filling it in is an upgrade, not an override --
            # anything the user has actually configured is left alone.
            old_default = ISSUER_DEFAULT_UPGRADES.get(key)
            if old_default and (exists[0], exists[1] or "") == old_default:
                cur.execute(
                    "UPDATE fund_issuers SET url_template=?, parser=?, enabled=1, note=?, "
                    "updated_at=? WHERE issuer_key=?",
                    (url, parser, note, _now(), key),
                )
            elif url and not (exists[1] or "").strip():
                cur.execute(
                    "UPDATE fund_issuers SET url_template=?, parser=?, enabled=1, note=?, "
                    "updated_at=? WHERE issuer_key=?",
                    (url, parser, note, _now(), key),
                )
            continue
        cur.execute(
            "INSERT INTO fund_issuers (issuer_key, label, url_template, parser, website, enabled, note, match_pattern, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (key, label, url, parser, site, 1 if url else 0, note,
             ISSUER_MATCH.get(key, ""), _now()),
        )
        added += 1
    # Backfill match patterns onto rows created before auto-detection existed.
    for key, pattern in ISSUER_MATCH.items():
        cur.execute(
            "UPDATE fund_issuers SET match_pattern=? "
            "WHERE issuer_key=? AND (match_pattern IS NULL OR match_pattern='')",
            (pattern, key),
        )
    for key, tickers in ISSUER_MAP_SEED.items():
        for t in tickers:
            cur.execute(
                "INSERT OR IGNORE INTO fund_issuer_map (fund_ticker, issuer_key, source, updated_at) "
                "VALUES (?,?, 'seed', ?)",
                (t.strip().upper(), key, _now()),
            )
    for ticker, (key, override) in ISSUER_URL_OVERRIDE_SEED.items():
        existing = cur.execute(
            "SELECT issuer_key, source, url_override FROM fund_issuer_map WHERE fund_ticker=?",
            (ticker,),
        ).fetchone()
        if not existing:
            cur.execute(
                "INSERT INTO fund_issuer_map "
                "(fund_ticker, issuer_key, source, url_override, updated_at) "
                "VALUES (?,?,'seed',?,?)",
                (ticker, key, override, _now()),
            )
        elif existing[1] != "manual" and not (existing[2] or "").strip():
            cur.execute(
                "UPDATE fund_issuer_map SET issuer_key=?, source='seed', url_override=?, "
                "updated_at=? WHERE fund_ticker=?",
                (key, override, _now(), ticker),
            )
    conn.commit()
    return added


def _fund_family_text(ticker):
    """Fund family + name, used to work out who publishes a fund's holdings."""
    try:
        import yfinance as yf
        info = yf.Ticker(ticker.strip().upper()).info or {}
    except Exception:
        return ""
    return " ".join(str(info.get(k) or "") for k in
                    ("fundFamily", "longName", "shortName")).strip()


def _detect_issuer(conn, ticker):
    """Match a fund to its issuer from its own family/name, and remember it.

    Yahoo carries the fund family, so a newly held NEOS or Amplify fund can be
    routed to the right publisher without anyone mapping it by hand. Recorded
    with source='auto' so it is visible and overridable.
    """
    text = _fund_family_text(ticker).lower()
    if not text:
        return None
    # Families without a working URL are matched too: recording "GPIQ is
    # Goldman Sachs" tells the user exactly which endpoint to supply, and
    # _issuer_for still skips disabled rows when actually fetching.
    rows = conn.execute(
        "SELECT issuer_key, match_pattern FROM fund_issuers "
        "WHERE match_pattern IS NOT NULL AND match_pattern != ''"
    ).fetchall()
    for key, pattern in rows:
        for token in (t.strip().lower() for t in (pattern or "").split("|")):
            if token and token in text:
                conn.execute(
                    "INSERT INTO fund_issuer_map (fund_ticker, issuer_key, source, updated_at) "
                    "VALUES (?,?, 'auto', ?) "
                    "ON CONFLICT(fund_ticker) DO UPDATE SET issuer_key=excluded.issuer_key, "
                    "source='auto', updated_at=excluded.updated_at",
                    (ticker.strip().upper(), key, _now()),
                )
                conn.commit()
                return key
    return None


def _issuer_for(conn, ticker, allow_detect=True):
    """Look up a ticker's issuer and return (issuer_key, parser, url) or None."""
    sym = ticker.strip().upper()

    def lookup():
        return conn.execute(
            "SELECT i.issuer_key, i.parser, i.url_template, i.enabled, m.url_override "
            "FROM fund_issuer_map m JOIN fund_issuers i ON i.issuer_key = m.issuer_key "
            "WHERE m.fund_ticker = ?",
            (sym,),
        ).fetchone()

    row = lookup()
    if not row and allow_detect:
        if _detect_issuer(conn, sym):
            row = lookup()
    if not row:
        return None

    key, parser, url_tpl, enabled, override = row[0], row[1], row[2], row[3], row[4]
    # A per-ticker override wins: some issuers key holdings on an internal
    # product id, so the family template cannot build the URL.
    url_tpl = override or url_tpl
    if not enabled or not url_tpl:
        return None
    url = url_tpl.replace("{ticker}", urllib.parse.quote(sym)).replace(
        "{ticker_lower}", urllib.parse.quote(sym.lower()))
    return key, parser, url


def _fetch_from_issuer(conn, ticker):
    """Resolve via the ticker's registered issuer. Returns (rows, issuer_key)."""
    found = _issuer_for(conn, ticker)
    if not found:
        return [], None
    key, parser, url = found
    fn = PARSERS.get(parser)
    if fn is None:
        return [], None
    try:
        # URL-driven parsers are handed the resolved template; the
        # issuer-specific handlers already know their own endpoint shape.
        rows = fn(ticker, url=url) if parser in URL_DRIVEN_PARSERS else fn(ticker)
    except Exception:
        rows = []
    return (rows, key) if rows else ([], None)


def _fetch_via_app(ticker, limit=25):
    """Fall back to the fetchers already living in app.py.

    Imported lazily: app.py imports this module, so a top-level import would be
    circular. Returns (rows, source_label).

    Every applicable source is tried and the one covering the most of the fund
    wins, rather than the first to answer. Measured on QQQI: the NEOS family
    page returns 25 rows totalling 30.7% while StockAnalysis returns 25 rows
    totalling 69.8% -- first-match would have silently kept the worse half and
    inflated the Undisclosed slice.
    """
    # When app.py is frozen by PyInstaller it runs as ``__main__`` and is not
    # importable under the name ``app``.  Re-importing app.py in source builds
    # also creates a second Flask application and a second set of route state.
    # Reuse the running entry module first; importing by name is only a fallback
    # for tests and callers that imported diversification independently.
    _app = sys.modules.get("__main__")
    if not _app or not hasattr(_app, "_fetch_stockanalysis_top_holdings"):
        try:
            import app as _app
        except Exception:
            return [], None

    sym = ticker.strip().upper()
    candidates = []

    def collect(fetcher, label, floor, tries=3):
        # These app.py fetchers do their own bare requests.get with no retry.
        # In a full-portfolio sweep the hosts throttle, and an empty answer here
        # is indistinguishable from "fund not covered" -- QQQI silently fell
        # back to a 30.7% source when its 69.8% one was merely rate-limited.
        raw = []
        for attempt in range(tries):
            try:
                raw = getattr(_app, fetcher)(sym, limit=limit) or []
            except Exception:
                raw = []
            if len(raw) >= floor:
                break
            if attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
        if len(raw) < floor:
            return
        rows = [_row(r.get("symbol"), r.get("name"), r.get("weight_pct")) for r in raw]
        coverage = sum(r["weight_pct"] or 0 for r in rows)
        candidates.append((coverage, len(rows), rows, label))

    # Family-specific official sources -- these know about option-income funds
    # whose pages the generic scrapers cannot read.
    for detector, fetcher, label in (
        ("_is_tuttle_capital_fund", "_fetch_income_blast_top_holdings", "incomeblast"),
        ("_is_neos_fund", "_fetch_neos_top_holdings", "neos"),
    ):
        try:
            if getattr(_app, detector)(sym, ""):
                collect(fetcher, label, 1)
        except Exception:
            pass

    collect("_fetch_stockanalysis_top_holdings", "stockanalysis", 3)
    if not candidates:
        collect("_fetch_cefconnect_top_holdings", "cefconnect", 2)

    if not candidates:
        return [], None
    coverage, _n, rows, label = max(candidates, key=lambda c: (c[0], c[1]))
    return rows, label


def _fetch_yahoo_holdings(ticker, limit=None):
    """Last-resort holdings from Yahoo's fund data.

    Shallow (Yahoo publishes a top-10 for most funds) and it has nothing at all
    for many option-income ETFs, but when an issuer endpoint is missing or
    blocked this beats reporting the whole position as Undisclosed.
    """
    try:
        import yfinance as yf
        fund_data = yf.Ticker(ticker.strip().upper()).funds_data
        holdings = fund_data.top_holdings
    except Exception:
        return []
    if holdings is None or getattr(holdings, "empty", True):
        return []

    rows = []
    for symbol, row in holdings.iterrows():
        try:
            pct = row.get("Holding Percent")
        except Exception:
            continue
        weight = _clean_weight(pct)
        if weight is None:
            continue
        # Yahoo reports fractions (0.0705) rather than percentages.
        if abs(weight) <= 1:
            weight = round(weight * 100, 4)
        name = row.get("Name") if hasattr(row, "get") else None
        rows.append(_row(symbol, name or symbol, weight))
        if limit and len(rows) >= limit:
            break
    return rows


def _security_type(ticker):
    """Best-effort asset classification, used to tell stocks from funds."""
    sym = ticker.strip().upper()
    # Broker imports commonly remove the punctuation from preferred-share
    # symbols (CODI-PRB / CODI^B -> CODIPRB). Yahoo cannot look that spelling
    # up and previously left a normal security as a 100% undefined "fund".
    if re.match(r"^[A-Z]{1,6}(?:PR|P)[A-Z]$", sym):
        return "EQUITY"
    try:
        import app as _app
        cef_rows = _app._cef_row_map() or {}
        if sym in cef_rows:
            return "CEF"
    except Exception:
        pass
    try:
        import yfinance as yf
        info = yf.Ticker(sym).info or {}
        qt = (info.get("quoteType") or "").upper()
        if qt:
            return qt
    except Exception:
        pass
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# Economic exposure seeds
#
# Only funds whose *filed* holdings misrepresent them belong here. QQQI/SPYI/
# CHPY actually hold the underlying equities, so their literal look-through is
# already correct and they are deliberately absent. KGLD/BTCI/KSLV hold T-bills
# plus option legs, so literally they read as cash.
# ─────────────────────────────────────────────────────────────────────────────

EXPOSURE_SEED = {
    "KGLD": [("", "Gold", 100.0, "Commodities")],
    "GLDN": [("", "Gold", 100.0, "Commodities")],
    "IAUI": [("", "Gold", 100.0, "Commodities")],
    "KSLV": [("", "Silver", 100.0, "Commodities")],
    "SLVX": [("", "Silver", 100.0, "Commodities")],
    "BTCI": [("", "Bitcoin", 100.0, "Digital Assets")],
    "ISBG": [("", "Bitcoin", 100.0, "Digital Assets")],
    "ISSB": [("", "Bitcoin", 100.0, "Digital Assets")],
    "NEHI": [("", "Ethereum", 100.0, "Digital Assets")],
    "ETTY": [("", "Ethereum", 100.0, "Digital Assets")],
    "SOLM": [("", "Solana", 100.0, "Digital Assets")],
    "NVII": [("NVDA", "NVIDIA Corp", 100.0, "Equity")],
    "TSII": [("TSLA", "Tesla Inc", 100.0, "Equity")],
    "TSLP": [("TSLA", "Tesla Inc", 100.0, "Equity")],
    "AMZP": [("AMZN", "Amazon.com Inc", 100.0, "Equity")],
    "GOOP": [("GOOGL", "Alphabet Inc", 100.0, "Equity")],
    "XSHP": [("", "SpaceX (private)", 100.0, "Private")],
    "CSHI": [("", "US Treasury Bills", 100.0, "Cash & Equivalents")],
    "LQID": [("", "Short-Term Credit", 100.0, "Fixed Income")],
}


# Funds whose issuer publishes holdings only through JavaScript, so no fetcher
# can read them. Seeded as editable rows -- delete or change them on the Fund
# Definitions screen and nothing here overrides that.
#
# The two wrappers point at the ETF they actually hold rather than at a label
# like "S&P 500": the nesting pass then expands VOO/QQQM into their live
# constituents, so the underlying weights stay current even though this mapping
# is static. TMGN holds its ten companies directly, so they are listed as filed.
WRAPPER_SEED = {
    "TSPY": ("TappAlpha S&P 500 wrapper -- fund holds VOO; verified on the issuer page.",
             [("VOO", "Vanguard S&P 500 ETF", 100.0)]),
    "TDAQ": ("TappAlpha Nasdaq-100 wrapper -- fund holds QQQM; verified on the issuer page.",
             [("QQQM", "Invesco Nasdaq 100 ETF", 100.0)]),
    "TMGN": ("TappAlpha Cboe Magnificent 10 -- holdings as filed on the issuer page.",
             [("MSFT", "Microsoft Corp", 12.24), ("AMZN", "Amazon.com Inc", 11.28),
              ("GOOGL", "Alphabet Inc", 10.31), ("NVDA", "NVIDIA Corp", 10.02),
              ("AVGO", "Broadcom Inc", 10.01), ("PLTR", "Palantir Technologies Inc", 9.67),
              ("AAPL", "Apple Inc", 9.52), ("AMD", "Advanced Micro Devices Inc", 8.92),
              ("META", "Meta Platforms Inc", 8.64), ("TSLA", "Tesla Inc", 8.08)]),
}


def _seed_wrappers(conn):
    """Seed known wrapper definitions, without touching anything already defined."""
    cur = conn.cursor()
    added = 0
    for tkr, (note, rows) in WRAPPER_SEED.items():
        existing = cur.execute(
            "SELECT COUNT(*) FROM fund_holdings WHERE fund_ticker=? AND source='manual'",
            (tkr,),
        ).fetchone()
        if existing and existing[0]:
            continue
        stamp = _now()
        for sym, name, weight in rows:
            cur.execute(
                "INSERT INTO fund_holdings (fund_ticker, symbol, name, weight_pct, source, fetched_at) "
                "VALUES (?,?,?,?, 'manual', ?)",
                (tkr, _norm_symbol(sym), name, weight, stamp),
            )
        coverage = round(sum(w for _s, _n, w in rows), 2)
        cur.execute(
            "INSERT INTO fund_holdings_meta "
            "(fund_ticker, status, source, coverage_pct, holdings_count, is_manual, note, updated_at) "
            "VALUES (?,'manual','manual',?,?,1,?,?) "
            "ON CONFLICT(fund_ticker) DO UPDATE SET status='manual', source='manual', "
            "coverage_pct=excluded.coverage_pct, holdings_count=excluded.holdings_count, "
            "is_manual=1, note=excluded.note, updated_at=excluded.updated_at",
            (tkr, coverage, len(rows), note, stamp),
        )
        added += 1
    if added:
        conn.commit()
    return added


def _seed_exposures(conn):
    cur = conn.cursor()
    have = {r[0] for r in cur.execute(
        "SELECT DISTINCT fund_ticker FROM fund_exposure_map"
    ).fetchall()}
    added = 0
    for tkr, rows in EXPOSURE_SEED.items():
        if tkr in have:
            continue
        for sym, name, pct, cls in rows:
            cur.execute(
                "INSERT INTO fund_exposure_map "
                "(fund_ticker, symbol, name, exposure_pct, asset_class, source, updated_at) "
                "VALUES (?,?,?,?,?,'seed',?)",
                (tkr, _norm_symbol(sym), name, pct, cls, _now()),
            )
            added += 1
    if added:
        conn.commit()
    return added


# ─────────────────────────────────────────────────────────────────────────────
# Resolution
# ─────────────────────────────────────────────────────────────────────────────

def _manual_rows(conn, ticker):
    return conn.execute(
        "SELECT symbol, name, weight_pct FROM fund_holdings "
        "WHERE fund_ticker=? AND source='manual' ORDER BY weight_pct DESC",
        (ticker,),
    ).fetchall()


def _store_rows(conn, ticker, rows, source, coverage, sec_type, as_of=None):
    cur = conn.cursor()
    cur.execute("DELETE FROM fund_holdings WHERE fund_ticker=? AND source!='manual'", (ticker,))
    stamp = _now()
    for r in rows:
        cur.execute(
            "INSERT INTO fund_holdings (fund_ticker, symbol, name, weight_pct, source, as_of, fetched_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (ticker, r["symbol"], r["name"], r["weight_pct"], source, as_of, stamp),
        )
    status = "resolved" if rows else "unresolved"
    cur.execute(
        "INSERT INTO fund_holdings_meta "
        "(fund_ticker, status, source, coverage_pct, holdings_count, security_type, is_manual, as_of, fetched_at, updated_at) "
        "VALUES (?,?,?,?,?,?,0,?,?,?) "
        "ON CONFLICT(fund_ticker) DO UPDATE SET "
        "status=excluded.status, source=excluded.source, coverage_pct=excluded.coverage_pct, "
        "holdings_count=excluded.holdings_count, security_type=excluded.security_type, "
        "as_of=excluded.as_of, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at",
        (ticker, status, source, coverage, len(rows), sec_type, as_of, stamp, stamp),
    )
    conn.commit()


def resolve_fund(ticker, conn, force=False):
    """Resolve one fund's constituents into the cache. Returns a meta dict."""
    sym = ticker.strip().upper()

    if _manual_rows(conn, sym):
        rows = _manual_rows(conn, sym)
        cov = sum(r[2] or 0 for r in rows)
        conn.execute(
            "INSERT INTO fund_holdings_meta "
            "(fund_ticker, status, source, coverage_pct, holdings_count, is_manual, updated_at) "
            "VALUES (?,'manual','manual',?,?,1,?) "
            "ON CONFLICT(fund_ticker) DO UPDATE SET status='manual', source='manual', "
            "coverage_pct=excluded.coverage_pct, holdings_count=excluded.holdings_count, "
            "is_manual=1, updated_at=excluded.updated_at",
            (sym, round(cov, 2), len(rows), _now()),
        )
        conn.commit()
        return {"ticker": sym, "status": "manual", "source": "manual", "coverage_pct": round(cov, 2)}

    if not force:
        existing = conn.execute(
            "SELECT status, source, coverage_pct FROM fund_holdings_meta WHERE fund_ticker=?",
            (sym,),
        ).fetchone()
        # A normal resolve pass should also improve shallow top-holdings
        # results now that an issuer has begun publishing a complete file.
        # Near-complete files vary slightly around 100% because of rounding,
        # cash and short derivatives, so 99% is the stable cache threshold.
        coverage = float(existing[2] or 0) if existing else 0.0
        if existing and (existing[0] in {"self", "cash"}
                         or (existing[0] == "resolved" and coverage >= 99.0)):
            return {"ticker": sym, "status": existing[0], "source": existing[1],
                    "coverage_pct": existing[2], "cached": True}

    sec_type = _security_type(sym)

    if sec_type == "MONEYMARKET":
        _store_rows(conn, sym, [], "classified", None, sec_type)
        conn.execute("UPDATE fund_holdings_meta SET status='cash' WHERE fund_ticker=?", (sym,))
        conn.commit()
        return {"ticker": sym, "status": "cash", "source": "classified", "coverage_pct": 100.0}

    # Resolution order: the fund's own issuer publishes the most complete data,
    # then the public scrapers, then Yahoo as a shallow last resort.
    rows, source = _fetch_from_issuer(conn, sym)

    if not rows:
        rows, source = _fetch_via_app(sym)

    if not rows:
        rows = _fetch_yahoo_holdings(sym)
        source = "yahoo" if rows else None

    if not rows:
        # Never let a transient fetch failure demote a fund that already has
        # good cached rows -- a rate-limited sweep would otherwise blank out
        # complete issuer data and inflate the Undisclosed slice.
        prior = conn.execute(
            "SELECT COUNT(*) FROM fund_holdings WHERE fund_ticker=? AND source!='manual'",
            (sym,),
        ).fetchone()
        prior_meta = conn.execute(
            "SELECT status, source, coverage_pct FROM fund_holdings_meta WHERE fund_ticker=?",
            (sym,),
        ).fetchone()
        if prior and prior[0] > 0 and prior_meta and prior_meta[0] == "resolved":
            return {"ticker": sym, "status": "resolved", "source": prior_meta[1],
                    "coverage_pct": prior_meta[2], "kept_cached": True}

        # A plain stock is its own constituent -- not a gap.
        if sec_type in {"EQUITY", "NONE"}:
            _store_rows(conn, sym, [], "classified", 100.0, sec_type)
            conn.execute("UPDATE fund_holdings_meta SET status='self' WHERE fund_ticker=?", (sym,))
            conn.commit()
            return {"ticker": sym, "status": "self", "source": "classified", "coverage_pct": 100.0}
        _store_rows(conn, sym, [], None, None, sec_type)
        return {"ticker": sym, "status": "unresolved", "source": None, "coverage_pct": 0.0}

    coverage = round(sum(r["weight_pct"] or 0 for r in rows), 2)
    as_of = next((r.get("as_of") for r in rows if r.get("as_of")), None)
    _store_rows(conn, sym, rows, source, coverage, sec_type, as_of=as_of)
    return {"ticker": sym, "status": "resolved", "source": source,
            "coverage_pct": coverage, "holdings_count": len(rows), "as_of": as_of}


# ─────────────────────────────────────────────────────────────────────────────
# Refresh job (background, pollable -- 190 funds exceeds any HTTP timeout)
# ─────────────────────────────────────────────────────────────────────────────

_JOB = {"running": False, "done": 0, "total": 0, "current": "", "started": None,
        "finished": None, "errors": [], "summary": None}
_JOB_LOCK = threading.Lock()


def _portfolio_positions(conn, profile_ids=None):
    """Positions for the selected scope, aggregated across accounts by ticker.

    profile_ids is the list from app.get_profile_filter(), so an aggregate
    portfolio spans its member accounts exactly like every other screen.
    """
    sql = "SELECT ticker, SUM(current_value) FROM holdings WHERE current_value > 0 "
    args = []
    if profile_ids:
        sql += f"AND profile_id IN ({','.join('?' * len(profile_ids))}) "
        args.extend(profile_ids)
    sql += "GROUP BY ticker HAVING SUM(current_value) > 0"
    return [(r[0].strip().upper(), float(r[1] or 0))
            for r in conn.execute(sql, args).fetchall() if r[0]]


def _scope_profile_ids():
    """Resolve the request's portfolio scope using app.py's shared helper."""
    try:
        import app as _app
        _is_agg, ids = _app.get_profile_filter()
        return ids
    except Exception:
        return None


def _discover_nested_candidates(conn, already, min_weight=5.0, limit=40):
    """Funds that show up *inside* resolved funds but aren't positions themselves.

    TSPY holds VOO and TDAQ holds QQQM; neither VOO nor QQQM is a portfolio
    position, so without this they stay unresolved and render as if they were
    companies. Only constituents carrying real weight are chased.
    """
    seen = {t.strip().upper() for t in already}
    rows = conn.execute(
        "SELECT symbol, MAX(weight_pct) FROM fund_holdings "
        "WHERE symbol IS NOT NULL AND symbol != '' "
        "GROUP BY symbol HAVING MAX(weight_pct) >= ? ORDER BY MAX(weight_pct) DESC",
        (min_weight,),
    ).fetchall()

    out = []
    for sym, _w in rows:
        sym = (sym or "").strip().upper()
        if not sym or sym in seen:
            continue
        # Bond and swap sleeves carry CUSIPs and internal identifiers in the
        # symbol column ("912797SA6", "6771720TRS052427GS"). Chasing those
        # wastes lookups and pollutes the cache with junk tickers.
        if not _TICKER_PAT.match(sym):
            continue
        known = conn.execute(
            "SELECT 1 FROM fund_holdings_meta WHERE fund_ticker=?", (sym,)
        ).fetchone()
        if known:
            continue
        out.append(sym)
        seen.add(sym)
        if len(out) >= limit:
            break
    return out


def _run_refresh(tickers, force):
    conn = get_connection()
    try:
        _seed_exposures(conn)
        _seed_issuers(conn)
        _seed_wrappers(conn)
        with _JOB_LOCK:
            _JOB.update(running=True, done=0, total=len(tickers), current="",
                        started=_now(), finished=None, errors=[], summary=None)

        results = {}
        lock = threading.Lock()

        def work(tkr):
            # Each worker needs its own sqlite connection.
            local = get_connection()
            try:
                res = resolve_fund(tkr, local, force=force)
            except Exception as exc:
                res = {"ticker": tkr, "status": "error", "error": str(exc)[:200]}
                with _JOB_LOCK:
                    _JOB["errors"].append(f"{tkr}: {str(exc)[:120]}")
            finally:
                try:
                    local.close()
                except Exception:
                    pass
            with lock:
                results[tkr] = res
            with _JOB_LOCK:
                _JOB["done"] += 1
                _JOB["current"] = tkr
            return res

        # Deliberately low: these are third-party pages that throttle, and a
        # rate-limited answer is worse than a slow one.
        with ThreadPoolExecutor(max_workers=3) as ex:
            list(ex.map(work, tickers))

        # Second pass: resolve funds discovered *inside* the funds above.
        # A wrapper like TSPY holds VOO, and VOO is not a portfolio position, so
        # the first pass never looks it up -- leaving a fund sitting in the
        # chart as if it were a company. Only chase constituents big enough to
        # matter, so this stays a handful of extra lookups rather than hundreds.
        nested = _discover_nested_candidates(conn, tickers)
        if nested:
            with _JOB_LOCK:
                _JOB["total"] += len(nested)
            with ThreadPoolExecutor(max_workers=3) as ex:
                list(ex.map(work, nested))

        counts = {}
        for r in results.values():
            counts[r.get("status", "?")] = counts.get(r.get("status", "?"), 0) + 1
        with _JOB_LOCK:
            _JOB.update(running=False, finished=_now(), summary=counts)
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Aggregation
# ─────────────────────────────────────────────────────────────────────────────

def _load_cache(conn):
    holdings = {}
    for fund, sym, name, weight, source in conn.execute(
        "SELECT fund_ticker, symbol, name, weight_pct, source FROM fund_holdings"
    ).fetchall():
        holdings.setdefault(fund, []).append(
            {"symbol": sym or "", "name": name or "", "weight_pct": weight, "source": source}
        )
    meta = {}
    for row in conn.execute(
        "SELECT fund_ticker, status, source, coverage_pct, holdings_count, security_type, is_manual, as_of "
        "FROM fund_holdings_meta"
    ).fetchall():
        meta[row[0]] = {"status": row[1], "source": row[2], "coverage_pct": row[3],
                        "holdings_count": row[4], "security_type": row[5],
                        "is_manual": bool(row[6]), "as_of": row[7]}
    exposure = {}
    for fund, sym, name, pct, cls, source in conn.execute(
        "SELECT fund_ticker, symbol, name, exposure_pct, asset_class, source FROM fund_exposure_map"
    ).fetchall():
        exposure.setdefault(fund, []).append(
            {"symbol": sym or "", "name": name or "", "weight_pct": pct,
             "asset_class": cls, "source": source}
        )
    return holdings, meta, exposure


def _name_index(holdings):
    """Map normalised company name -> ticker, built from rows that have both.

    CEF Connect publishes names without symbols ('NVIDIA Corp'), while issuer
    files publish both. This lets those name-only rows aggregate with the rest
    instead of sitting as separate slices.
    """
    idx = {}
    for rows in holdings.values():
        for r in rows:
            sym = r["symbol"]
            key = _norm_name(r["name"])
            if sym and key and key not in idx:
                idx[key] = sym
    return idx


def _expand_nested(rows, holdings, meta, depth=2, _seen=None):
    """Replace fund constituents with their own constituents, recursively.

    A wrapper holding 99.7% QQQM becomes the Nasdaq 100 names at 99.7% of their
    in-QQQM weights. Only expands when the nested fund is itself resolved and
    well covered (>=90%); a thinly-covered nested fund would silently convert
    known exposure into an Undisclosed remainder, which is worse than leaving
    the fund as its own slice. _seen breaks circular references.
    """
    if depth <= 0:
        return rows
    _seen = _seen or set()

    out = []
    for r in rows:
        sym = (r.get("symbol") or "").strip().upper()
        weight = r.get("weight_pct")
        info = meta.get(sym) if sym else None
        nested = holdings.get(sym) if sym else None

        if (not sym or not weight or sym in _seen or not nested or not info
                or info.get("status") not in {"resolved", "manual"}
                or (info.get("coverage_pct") or 0) < 90):
            out.append(r)
            continue

        inner = _expand_nested(nested, holdings, meta, depth - 1, _seen | {sym})
        scale = weight / 100.0
        for ir in inner:
            iw = ir.get("weight_pct")
            if not iw:
                continue
            out.append({
                "symbol": ir.get("symbol", ""),
                "name": ir.get("name", ""),
                "weight_pct": iw * scale,
                "via": sym,
            })
    return out


def build_diversification(conn, profile_ids=None, xray=True, mode="economic",
                          top=None, nest_depth=2):
    positions = _portfolio_positions(conn, profile_ids)
    total = sum(v for _, v in positions)
    holdings, meta, exposure = _load_cache(conn)
    name_idx = _name_index(holdings) if xray else {}

    buckets = {}   # key -> dict
    fund_detail = []

    def add(key, label, value, kind, symbol="", contributor=""):
        b = buckets.setdefault(key, {"key": key, "name": label, "symbol": symbol,
                                     "value": 0.0, "kind": kind, "contributions": {}})
        b["value"] += value
        if contributor:
            b["contributions"][contributor] = (
                b["contributions"].get(contributor, 0.0) + value
            )
        if kind in {"undisclosed", "undefined"}:
            b["kind"] = kind

    for tkr, value in positions:
        info = meta.get(tkr, {})
        status = info.get("status", "unresolved")

        if not xray:
            add(tkr, tkr, value, "fund", tkr, tkr)
            continue

        if status == "cash":
            add("CASH", "Cash & equivalents", value, "cash", contributor=tkr)
            continue

        if status == "self":
            add(tkr, tkr, value, "stock", tkr, tkr)
            continue

        rows = None
        used = None
        if mode == "economic" and exposure.get(tkr):
            rows = exposure[tkr]
            used = "exposure"
        elif holdings.get(tkr):
            rows = holdings[tkr]
            used = info.get("source") or "cache"

        if not rows:
            # Distinct from a partial remainder: nothing is known about this
            # fund at all, which is a different problem with a different fix.
            add(f"UNDEFINED::{tkr}", f"{tkr} — no holdings data", value,
                "undefined", tkr, tkr)
            fund_detail.append({"ticker": tkr, "value": value, "status": "unresolved",
                                "coverage_pct": 0.0, "source": None})
            continue

        # Fund-of-fund expansion. Several option-income wrappers are a single
        # ETF plus collateral -- TSPY is 100.6% VOO, TDAQ 99.7% QQQM, OVL 99.9%
        # VOO. Stopping at "you own VOO" hides that this is really 500 stocks,
        # and defeats the whole point of merging exposure across funds.
        rows = _expand_nested(rows, holdings, meta, depth=nest_depth)
        filed_rows = holdings.get(tkr, [])
        derivative_context = any(
            _DERIV_PAT.search(r.get("name") or "")
            or _DERIV_SYM_PAT.search(r.get("symbol") or "")
            for r in filed_rows
        )
        financing_context = any(
            (r.get("weight_pct") or 0) < -1
            and (_CASH_PAT.search(r.get("name") or "")
                 or _BILL_SYM_PAT.match(r.get("symbol") or ""))
            for r in filed_rows
        )
        collateral_context = derivative_context or financing_context

        covered = 0.0
        for r in rows:
            w = r.get("weight_pct")
            if not w:
                continue
            covered += w
            share = value * (w / 100.0)
            sym = r.get("symbol") or ""
            nm = r.get("name") or sym
            if not sym:
                guess = name_idx.get(_norm_name(nm))
                if guess:
                    sym = guess
            # Bill / cash collateral groups regardless of whether the issuer
            # gave it a symbol -- otherwise literal mode scatters a fund's
            # Treasury sleeve across rows like "B0090326".
            if _CASH_PAT.search(nm) or _BILL_SYM_PAT.match(sym):
                if collateral_context:
                    add("COLLATERAL", "Cash & T-bill collateral", share,
                        "collateral", contributor=tkr)
                else:
                    add("CASH", "Cash & equivalents", share, "cash", contributor=tkr)
                continue
            if _DERIV_PAT.search(nm) or _DERIV_SYM_PAT.search(sym):
                add("DERIVATIVES", "Options & derivatives", share,
                    "derivative", contributor=tkr)
                continue
            key = sym or f"NAME::{_norm_name(nm)}"
            add(key, nm if not sym else (nm or sym), share, "holding", sym, tkr)

        covered = min(covered, 100.0)
        if covered < 99.5:
            add(f"UNDISCLOSED::{tkr}", f"{tkr} — rest not disclosed by issuer",
                value * (1 - covered / 100.0), "undisclosed", tkr, tkr)
        fund_detail.append({"ticker": tkr, "value": value, "status": status,
                            "coverage_pct": round(covered, 2), "source": used,
                            "mode": "economic" if used == "exposure" else "literal",
                            "as_of": info.get("as_of")})

    out = []
    for b in buckets.values():
        out.append({
            "key": b["key"], "symbol": b["symbol"], "name": b["name"],
            "value": round(b["value"], 2),
            "weight_pct": round(100.0 * b["value"] / total, 4) if total else 0.0,
            "kind": b["kind"],
            "contributors": [
                {"ticker": ticker, "value": round(amount, 2)}
                for ticker, amount in sorted(
                    b["contributions"].items(), key=lambda item: -abs(item[1])
                )[:5]
            ],
        })
    out.sort(key=lambda r: -r["value"])
    if top:
        out = out[:top]

    resolved_val = sum(f["value"] for f in fund_detail if f["status"] != "unresolved")
    undisclosed_val = sum(b["value"] for b in out if b["kind"] == "undisclosed")
    undefined_val = sum(b["value"] for b in out if b["kind"] == "undefined")

    return {
        "total_value": round(total, 2),
        "position_count": len(positions),
        "xray": xray,
        "mode": mode,
        "constituents": out,
        "funds": sorted(fund_detail, key=lambda r: -r["value"]),
        "coverage": {
            "resolved_value": round(resolved_val, 2),
            # Split deliberately: an issuer publishing only a top 10 is a
            # ceiling nothing can fix, while a fund with no data at all is
            # fixable by mapping an issuer or defining it by hand.
            "undisclosed_value": round(undisclosed_val, 2),
            "undisclosed_pct": round(100.0 * undisclosed_val / total, 2) if total else 0.0,
            "undefined_value": round(undefined_val, 2),
            "undefined_pct": round(100.0 * undefined_val / total, 2) if total else 0.0,
            "unresolved_funds": sum(1 for f in fund_detail if f["status"] == "unresolved"),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

def register_routes(app):

    @app.route("/api/diversification", methods=["GET"])
    def api_diversification():
        xray = request.args.get("xray", "1") not in {"0", "false", "no"}
        mode = request.args.get("mode", "economic")
        top = request.args.get("top", type=int)
        scope = _scope_profile_ids()
        conn = get_connection()
        try:
            return jsonify(build_diversification(conn, scope, xray, mode, top))
        finally:
            conn.close()

    @app.route("/api/diversification/funds", methods=["GET"])
    def api_diversification_funds():
        """Per-fund resolution status -- drives the manual-definition screen."""
        scope = _scope_profile_ids()
        conn = get_connection()
        try:
            positions = _portfolio_positions(conn, scope)
            total = sum(v for _, v in positions)
            _holdings, meta, exposure = _load_cache(conn)
            rows = []
            for tkr, value in positions:
                info = meta.get(tkr, {})
                rows.append({
                    "ticker": tkr,
                    "value": round(value, 2),
                    "portfolio_pct": round(100.0 * value / total, 3) if total else 0.0,
                    "status": info.get("status", "unresolved"),
                    "source": info.get("source"),
                    "coverage_pct": info.get("coverage_pct"),
                    "holdings_count": info.get("holdings_count") or 0,
                    "security_type": info.get("security_type"),
                    "is_manual": info.get("is_manual", False),
                    "has_exposure": bool(exposure.get(tkr)),
                })
            rows.sort(key=lambda r: -r["value"])
            return jsonify({"funds": rows, "total_value": round(total, 2)})
        finally:
            conn.close()

    @app.route("/api/diversification/fund/<ticker>", methods=["GET"])
    def api_diversification_fund(ticker):
        sym = ticker.strip().upper()
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT symbol, name, weight_pct, source FROM fund_holdings "
                "WHERE fund_ticker=? ORDER BY weight_pct DESC", (sym,)
            ).fetchall()
            exp = conn.execute(
                "SELECT symbol, name, exposure_pct, asset_class, source FROM fund_exposure_map "
                "WHERE fund_ticker=? ORDER BY exposure_pct DESC", (sym,)
            ).fetchall()
            meta = conn.execute(
                "SELECT status, source, coverage_pct, holdings_count, security_type, is_manual, as_of "
                "FROM fund_holdings_meta WHERE fund_ticker=?", (sym,)
            ).fetchone()
            return jsonify({
                "ticker": sym,
                "holdings": [{"symbol": r[0], "name": r[1], "weight_pct": r[2], "source": r[3]} for r in rows],
                "exposure": [{"symbol": r[0], "name": r[1], "exposure_pct": r[2],
                              "asset_class": r[3], "source": r[4]} for r in exp],
                "meta": ({"status": meta[0], "source": meta[1], "coverage_pct": meta[2],
                          "holdings_count": meta[3], "security_type": meta[4],
                          "is_manual": bool(meta[5]), "as_of": meta[6]} if meta else None),
            })
        finally:
            conn.close()

    @app.route("/api/diversification/fund/<ticker>", methods=["PUT", "POST"])
    def api_diversification_fund_save(ticker):
        """Save hand-entered constituents. These are never overwritten by refresh."""
        sym = ticker.strip().upper()
        payload = request.get_json(silent=True) or {}
        rows = payload.get("holdings") or []
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM fund_holdings WHERE fund_ticker=? AND source='manual'", (sym,))
            stamp = _now()
            saved = 0
            for r in rows:
                weight = _clean_weight(r.get("weight_pct"))
                name = (r.get("name") or "").strip()
                symbol = _norm_symbol(r.get("symbol"))
                if weight is None or not (name or symbol):
                    continue
                cur.execute(
                    "INSERT INTO fund_holdings (fund_ticker, symbol, name, weight_pct, source, fetched_at) "
                    "VALUES (?,?,?,?, 'manual', ?)",
                    (sym, symbol, name or symbol, weight, stamp),
                )
                saved += 1
            cov = round(sum(_clean_weight(r.get("weight_pct")) or 0 for r in rows), 2)
            if saved:
                cur.execute(
                    "INSERT INTO fund_holdings_meta "
                    "(fund_ticker, status, source, coverage_pct, holdings_count, is_manual, note, updated_at) "
                    "VALUES (?,'manual','manual',?,?,1,?,?) "
                    "ON CONFLICT(fund_ticker) DO UPDATE SET status='manual', source='manual', "
                    "coverage_pct=excluded.coverage_pct, holdings_count=excluded.holdings_count, "
                    "is_manual=1, note=excluded.note, updated_at=excluded.updated_at",
                    (sym, cov, saved, (payload.get("note") or "").strip()[:400], stamp),
                )
            else:
                cur.execute(
                    "UPDATE fund_holdings_meta SET status='unresolved', source=NULL, is_manual=0, "
                    "coverage_pct=0, holdings_count=0, updated_at=? WHERE fund_ticker=?",
                    (stamp, sym),
                )
            conn.commit()
            return jsonify({"ok": True, "ticker": sym, "saved": saved, "coverage_pct": cov})
        finally:
            conn.close()

    @app.route("/api/diversification/exposure/<ticker>", methods=["PUT", "POST"])
    def api_diversification_exposure_save(ticker):
        """Save the economic exposure for a synthetic / option-income fund."""
        sym = ticker.strip().upper()
        payload = request.get_json(silent=True) or {}
        rows = payload.get("exposure") or []
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM fund_exposure_map WHERE fund_ticker=?", (sym,))
            stamp = _now()
            saved = 0
            for r in rows:
                pct = _clean_weight(r.get("exposure_pct"))
                name = (r.get("name") or "").strip()
                symbol = _norm_symbol(r.get("symbol"))
                if pct is None or not (name or symbol):
                    continue
                cur.execute(
                    "INSERT INTO fund_exposure_map "
                    "(fund_ticker, symbol, name, exposure_pct, asset_class, source, updated_at) "
                    "VALUES (?,?,?,?,?,'manual',?)",
                    (sym, symbol, name or symbol, pct, (r.get("asset_class") or "").strip(), stamp),
                )
                saved += 1
            conn.commit()
            return jsonify({"ok": True, "ticker": sym, "saved": saved})
        finally:
            conn.close()

    @app.route("/api/diversification/issuers", methods=["GET"])
    def api_diversification_issuers():
        conn = get_connection()
        try:
            _seed_issuers(conn)
            issuers = [
                {"issuer_key": r[0], "label": r[1], "url_template": r[2], "parser": r[3],
                 "website": r[4], "enabled": bool(r[5]), "note": r[6],
                 "ticker_count": r[7]}
                for r in conn.execute(
                    "SELECT i.issuer_key, i.label, i.url_template, i.parser, i.website, "
                    "i.enabled, i.note, "
                    "(SELECT COUNT(*) FROM fund_issuer_map m WHERE m.issuer_key=i.issuer_key) "
                    "FROM fund_issuers i ORDER BY i.enabled DESC, i.label"
                ).fetchall()
            ]
            mapping = [
                {"ticker": r[0], "issuer_key": r[1], "source": r[2], "url_override": r[3]}
                for r in conn.execute(
                    "SELECT fund_ticker, issuer_key, source, url_override "
                    "FROM fund_issuer_map ORDER BY fund_ticker"
                ).fetchall()
            ]
            return jsonify({"issuers": issuers, "map": mapping,
                            "parsers": sorted(PARSERS.keys())})
        finally:
            conn.close()

    @app.route("/api/diversification/issuers/<issuer_key>", methods=["PUT", "POST"])
    def api_diversification_issuer_save(issuer_key):
        key = (issuer_key or "").strip().lower()
        payload = request.get_json(silent=True) or {}
        if not key:
            return jsonify({"ok": False, "error": "Missing issuer key."}), 400
        parser = (payload.get("parser") or "generic_csv").strip()
        if parser not in PARSERS:
            return jsonify({"ok": False,
                            "error": f"Unknown parser '{parser}'. Choose one of: "
                                     + ", ".join(sorted(PARSERS))}), 400
        url_tpl = (payload.get("url_template") or "").strip()
        conn = get_connection()
        try:
            conn.execute(
                "INSERT INTO fund_issuers (issuer_key, label, url_template, parser, website, enabled, note, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(issuer_key) DO UPDATE SET label=excluded.label, "
                "url_template=excluded.url_template, parser=excluded.parser, "
                "website=excluded.website, enabled=excluded.enabled, note=excluded.note, "
                "updated_at=excluded.updated_at",
                (key, (payload.get("label") or key).strip(), url_tpl, parser,
                 (payload.get("website") or "").strip(),
                 1 if (payload.get("enabled", bool(url_tpl))) else 0,
                 (payload.get("note") or "").strip()[:400], _now()),
            )
            conn.commit()
            return jsonify({"ok": True, "issuer_key": key})
        finally:
            conn.close()

    @app.route("/api/diversification/issuer-map", methods=["PUT", "POST"])
    def api_diversification_issuer_map_save():
        """Assign tickers to an issuer, or clear them with issuer_key = ''."""
        payload = request.get_json(silent=True) or {}
        tickers = payload.get("tickers") or ([payload["ticker"]] if payload.get("ticker") else [])
        key = (payload.get("issuer_key") or "").strip().lower()
        override = (payload.get("url_override") or "").strip() or None
        conn = get_connection()
        try:
            cur = conn.cursor()
            n = 0
            for t in tickers:
                sym = (t or "").strip().upper()
                if not sym:
                    continue
                if key:
                    cur.execute(
                        "INSERT INTO fund_issuer_map (fund_ticker, issuer_key, source, url_override, updated_at) "
                        "VALUES (?,?, 'manual', ?, ?) "
                        "ON CONFLICT(fund_ticker) DO UPDATE SET issuer_key=excluded.issuer_key, "
                        "source='manual', url_override=excluded.url_override, "
                        "updated_at=excluded.updated_at",
                        (sym, key, override, _now()),
                    )
                else:
                    cur.execute("DELETE FROM fund_issuer_map WHERE fund_ticker=?", (sym,))
                n += 1
            conn.commit()
            return jsonify({"ok": True, "updated": n})
        finally:
            conn.close()

    @app.route("/api/diversification/issuer-test/<ticker>", methods=["POST"])
    def api_diversification_issuer_test(ticker):
        """Try a ticker's registered issuer and report what came back.

        Lets a URL template be validated from the UI without running a refresh.
        """
        sym = (ticker or "").strip().upper()
        conn = get_connection()
        try:
            found = _issuer_for(conn, sym)
            if not found:
                return jsonify({"ok": False,
                                "error": "No enabled issuer mapped for this ticker."})
            key, parser, url = found
            rows, _ = _fetch_from_issuer(conn, sym)
            return jsonify({
                "ok": bool(rows), "issuer_key": key, "parser": parser, "url": url,
                "rows": len(rows),
                "coverage_pct": round(sum(r["weight_pct"] or 0 for r in rows), 2) if rows else 0,
                "sample": rows[:5],
                "error": None if rows else "Issuer returned no parsable holdings.",
            })
        finally:
            conn.close()

    @app.route("/api/diversification/refresh", methods=["POST"])
    def api_diversification_refresh():
        payload = request.get_json(silent=True) or {}
        force = bool(payload.get("force"))
        with _JOB_LOCK:
            if _JOB["running"]:
                return jsonify({"ok": False, "error": "A refresh is already running.",
                                "job": {k: v for k, v in _JOB.items() if k != "errors"}}), 409
        scope = _scope_profile_ids()
        conn = get_connection()
        try:
            tickers = payload.get("tickers")
            if tickers:
                tickers = [t.strip().upper() for t in tickers if t and t.strip()]
            else:
                tickers = [t for t, _ in _portfolio_positions(conn, scope)]
        finally:
            conn.close()
        if not tickers:
            return jsonify({"ok": False, "error": "No positions to resolve."}), 400
        threading.Thread(target=_run_refresh, args=(tickers, force), daemon=True).start()
        time.sleep(0.2)
        return jsonify({"ok": True, "started": True, "total": len(tickers)})

    @app.route("/api/diversification/refresh/status", methods=["GET"])
    def api_diversification_refresh_status():
        with _JOB_LOCK:
            return jsonify(dict(_JOB))

    @app.route("/api/diversification/seed-exposures", methods=["POST"])
    def api_diversification_seed():
        conn = get_connection()
        try:
            return jsonify({"ok": True, "added": _seed_exposures(conn)})
        finally:
            conn.close()
