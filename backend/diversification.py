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
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

import requests
from flask import jsonify, request

from config import get_connection
import yahoo_gateway
import market_data_provider as market_data

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
    # Plural too: StockAnalysis files TDAX/SEPQ/OVF cash as "US DOLLARS", which
    # used to chart as a 0.6% company.
    r"^u\.?s\.?\s+dollars?$|^\$?usd$)",
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

# A nested fund is only looked through when its own holdings cover this much
# of it -- below that, expanding it would swap known exposure for a remainder.
NESTABLE_COVERAGE = 90.0

# Issuer files change daily and these funds roll their option legs weekly, so a
# resolved fund older than this is re-read by an ordinary (non-forced) pass.
STALE_AFTER_DAYS = 7
# How soon after one refresh the page may start another by itself. Without it a
# fund whose publisher is down would trigger a full sweep on every visit.
AUTO_REFRESH_COOLDOWN_HOURS = 20
_LAST_REFRESH_KEY = "xray_last_refresh_started"

# Option legs arrive in two shapes: an OCC symbol in the symbol column
# ("2COPX260918C00045000", "SPXW260813P06375000" once punctuation is stripped)
# or a broker descriptor in the name ("DRAM 09/18/2026 57.01 P",
# "MU US 08/07/26 P825").
_OCC_SYM_PAT = re.compile(r"^\d?([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$")
_OPT_DESC_PAT = re.compile(
    r"^([A-Z][A-Z.]{0,5})\s+(?:US\s+)?(\d{1,2})/(\d{1,2})/(\d{2,4})\s+"
    r"(?:([CP])\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*([CP]))$",
    re.I,
)
# Index options settle against an index nobody can hold, so a synthetic
# position on one is looked through via the ETF that tracks the same index.
_INDEX_OPTION_PROXY = {
    "SPX": "VOO", "SPXW": "VOO", "XSP": "VOO",
    "NDX": "QQQM", "NDXP": "QQQM", "XND": "QQQM",
    "RUT": "IWM", "RUTW": "IWM", "MRUT": "IWM",
    "MXEA": "IEFA",
}
# "MICRON TECHNOLOGY INC SWAP NM", "SK HYNIX INC-SWAP-GOLD-L": a single-name
# total-return swap names the company it tracks ahead of the word "swap".
_SWAP_REF_PAT = re.compile(r"^(.*?)[\s,.\-]*\bswap\b", re.I)

# Two listings of one company. The look-through is a concentration check, and
# Alphabet split across GOOG and GOOGL reads as two ~2% names when it is one
# ~4% name. Keys are normalised symbols (punctuation stripped, so BRK.A ->
# BRKA); the value is the listing the combined slice is filed under.
_SHARE_CLASS_ALIASES = {
    "GOOG": "GOOGL", "BRKA": "BRKB", "FOX": "FOXA", "NWS": "NWSA",
    "UA": "UAA", "LENB": "LEN", "HEIA": "HEI", "BFA": "BFB", "ZG": "Z",
    "LBRDA": "LBRDK", "BATRA": "BATRK", "CENT": "CENTA",
}
_CLASS_SUFFIX_PAT = re.compile(r"[\s,]*\b(?:class|cl)\s+[A-Z]\b\.?", re.I)


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _age_days(stamp, now=None):
    """Days since an ISO timestamp written by _now(), or None if unreadable."""
    if not stamp:
        return None
    try:
        then = datetime.datetime.fromisoformat(str(stamp)[:19])
    except ValueError:
        return None
    return ((now or datetime.datetime.now()) - then).total_seconds() / 86400.0


def _app_module(attr):
    """The live app.py module, or None if it does not provide `attr`.

    PyInstaller runs app.py as ``__main__``, so ``import app`` inside a packaged
    build does not hand back the running module -- it executes a *second* copy
    of a 43,000-line file, building a duplicate Flask application and a
    duplicate set of module caches inside whichever request asked first. That is
    slow and it silently splits state that is supposed to be shared. Prefer the
    entry module; importing by name is only for tests and callers that imported
    this module on its own.

    `attr` is the function the caller actually needs, so an unrelated or
    half-initialised ``__main__`` (a test runner, a REPL) is rejected instead of
    being mistaken for the application.
    """
    main = sys.modules.get("__main__")
    if main is not None and hasattr(main, attr):
        return main
    try:
        import app as _app
    except Exception:
        return None
    return _app if hasattr(_app, attr) else None


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


def _coverage(rows):
    """How much of a fund a set of rows names, capped at the whole fund."""
    return min(sum(r.get("weight_pct") or 0 for r in rows or []), 100.0)


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
    # A "holdings file" link can serve a spreadsheet whatever its URL says --
    # InfraCap's download-holdings .php returns an .xls -- so sniff the bytes.
    content = resp.content or b""
    if content[:4] in (b"\xd0\xcf\x11\xe0", b"PK\x03\x04"):
        return _parse_generic_excel_bytes(content, limit)
    return _parse_generic_csv_text(resp.text or "", limit)


def _parse_generic_excel_bytes(content, limit=None):
    """Parse issuer XLS/XLSX files after locating their real header row."""
    import pandas as pd

    try:
        if content[:4] == b"\xd0\xcf\x11\xe0":
            # Legacy .xls. Web-generated ones often fail xlrd's stream check
            # ("Workbook corruption: seen[3] == 4") while reading perfectly
            # well -- InfraCap's QVOL file does -- so the check is skipped, and
            # xlrd's diagnostic dump is kept out of the server log.
            import xlrd
            book = xlrd.open_workbook(file_contents=content, ignore_workbook_corruption=True,
                                      logfile=io.StringIO())
            raw = pd.read_excel(book, header=None, engine="xlrd")
        else:
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
    parsed = urllib.parse.urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    # XFUNDS publishes the complete Tidal holdings CSV alongside the rendered
    # table. Prefer it because it includes exchange tickers; the HTML widget
    # exposes CUSIPs instead, which makes look-through resolution less precise.
    csv_url = (
        f"{origin}/wp-content/uploads/data/"
        f"TidalFG_Holdings_{ticker.strip().upper()}.csv"
    )
    csv_response = _http_get(csv_url, tries=2)
    if csv_response is not None:
        csv_rows = _parse_generic_csv_text(csv_response.text or "", limit)
        if csv_rows:
            return csv_rows

    page = _http_get(url, tries=2)
    if page is None:
        return []
    ids = re.findall(r"elementor-(\d{3,7})\b", page.text or "")
    if not ids:
        return []
    # The page's own id dominates the stylesheet; element ids appear once each.
    post_id = max(set(ids), key=ids.count)

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
    ("infracap", "InfraCap / Virtus", "generic_csv",
     "https://www.infracapfund.com/download-holdings-usbanks.php?fund={ticker}",
     "https://infracapfund.com",
     "Official daily holdings .xls linked from each fund page (QVOL: ~195 rows "
     "including option legs, vs a 76% top-25 table)."),
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
    "nicholas": [
        "DRMY", "GLDN", "SLVX", "NUKX", "WEPN", "BLOX",
        "BHDG", "NGHT", "GIAX", "FITZ", "FIZY", "FIAX",
    ],
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
    symbol = ticker.strip().upper()

    def _load():
        return market_data.ticker(symbol).info or {}

    # Persisted: a fund's family and name do not change, so the last good
    # answer is as good as a live one and costs nothing during a throttle.
    info, _meta = yahoo_gateway.fetch("fund_family_info", symbol, _load)
    if not info:
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
    _app = _app_module("_fetch_stockanalysis_top_holdings")
    if _app is None:
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
    def _load():
        return market_data.ticker(ticker.strip().upper()).funds_data.top_holdings

    try:
        holdings = yahoo_gateway.call(_load)
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
    _app = _app_module("_cef_row_map")
    if _app is not None:
        try:
            if sym in (_app._cef_row_map() or {}):
                return "CEF"
        except Exception:
            pass
    def _load():
        return market_data.ticker(sym).info or {}

    # A quote type is a fixed property of the listing, so the stored answer
    # stays correct; without the fallback a throttled sweep reclassifies every
    # fund as unknown.
    info, _meta = yahoo_gateway.fetch("quote_type_info", sym, _load)
    qt = ((info or {}).get("quoteType") or "").upper()
    return qt or ""


# ─────────────────────────────────────────────────────────────────────────────
# SEC N-PORT -- quarterly full holdings for closed-end funds
#
# CEF Connect and every issuer page publish only a fund's ten largest
# positions. Measured across the 29 closed-end funds held here that is a
# median 42.4% of the fund (NAD 6.7%, BCAT 6.4%, VCV 13.5%). Every registered
# fund, closed-end included, must file its complete portfolio with the SEC
# quarterly on Form N-PORT -- the same regulatory filing behind CEF Connect's
# own numbers, just not truncated. Measured coverage from it: a median 100.2%
# across the same 29 funds (BCAT alone: 1,397 holdings, 108.7%).
# ─────────────────────────────────────────────────────────────────────────────

# SEC's fair-access policy requires a descriptive User-Agent with contact
# information on automated requests and can rate-limit or block a generic
# browser string. Kept separate from HTTP_HEADERS, which every other fetcher
# in this module uses and which SEC does not accept.
_SEC_HEADERS = {"User-Agent": "Portfolio Tracker (personal desktop app; contact pressj01@gmail.com)"}
_SEC_TIMEOUT = 30


# SEC's fair-access limit is ten requests a second per client. A refresh runs
# three workers and now reaches EDGAR for ETFs as well as closed-end funds, so
# requests are spaced process-wide rather than trusting the workers to be slow.
_SEC_MIN_GAP = 0.15
_SEC_PACE_LOCK = threading.Lock()
_SEC_LAST_REQUEST = [0.0]


def _sec_pace():
    with _SEC_PACE_LOCK:
        wait = _SEC_LAST_REQUEST[0] + _SEC_MIN_GAP - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _SEC_LAST_REQUEST[0] = time.monotonic()


def _sec_get(url, as_json=False, tries=3, backoff=1.5):
    last = None
    for attempt in range(tries):
        try:
            _sec_pace()
            resp = requests.get(url, timeout=_SEC_TIMEOUT, headers=_SEC_HEADERS)
            if resp.status_code == 200:
                return resp.json() if as_json else resp.text
            if resp.status_code == 404:
                return None
            last = resp
        except Exception:
            last = None
        if attempt < tries - 1:
            time.sleep(backoff * (attempt + 1))
    return None


# ticker -> (cik, title). Built once per process from a single ~1 MB file
# covering every filer, rather than once per fund -- a full sweep resolves up
# to a few dozen CEFs and there is no reason to re-download the same index for
# each of them.
_SEC_CIK_MAP = None
_SEC_CIK_LOCK = threading.Lock()


def _sec_cik_for(ticker):
    global _SEC_CIK_MAP
    if _SEC_CIK_MAP is None:
        with _SEC_CIK_LOCK:
            if _SEC_CIK_MAP is None:
                data = _sec_get("https://www.sec.gov/files/company_tickers.json", as_json=True) or {}
                built = {}
                for row in data.values():
                    sym = (row.get("ticker") or "").strip().upper()
                    if sym:
                        built[sym] = (str(row["cik_str"]).zfill(10), row.get("title"))
                _SEC_CIK_MAP = built
    return _SEC_CIK_MAP.get(ticker.strip().upper(), (None, None))


def _sec_latest_nport_accession(cik):
    """The most recent Form N-PORT-P filing's accession number and report date."""
    data = _sec_get(f"https://data.sec.gov/submissions/CIK{cik}.json", as_json=True)
    if not data:
        return None, None
    recent = (data.get("filings") or {}).get("recent") or {}
    for form, acc, date in zip(recent.get("form", []), recent.get("accessionNumber", []),
                               recent.get("reportDate", [])):
        if form.startswith("NPORT-P"):
            return acc.replace("-", ""), date
    return None, None


# Open-end funds and ETFs are not companies, so company_tickers.json does not
# list them. They are share classes of a *series* inside a trust -- IEFA is
# series S000038930 of iShares Trust -- and the trust files one N-PORT per
# series under its own CIK. ticker -> (cik, series_id), built once per process.
_SEC_SERIES_MAP = None
_SEC_SERIES_LOCK = threading.Lock()


def _sec_series_for(ticker):
    global _SEC_SERIES_MAP
    if _SEC_SERIES_MAP is None:
        with _SEC_SERIES_LOCK:
            if _SEC_SERIES_MAP is None:
                data = _sec_get("https://www.sec.gov/files/company_tickers_mf.json",
                                as_json=True) or {}
                fields = data.get("fields") or []
                built = {}
                if {"cik", "seriesId", "symbol"} <= set(fields):
                    i_cik = fields.index("cik")
                    i_series = fields.index("seriesId")
                    i_sym = fields.index("symbol")
                    for row in data.get("data") or []:
                        sym = str(row[i_sym] or "").strip().upper()
                        if sym and row[i_series]:
                            built[sym] = (str(row[i_cik]).zfill(10), row[i_series])
                # A failed download is not "no funds exist": leave the map unset
                # so the next lookup tries again instead of caching the miss.
                if not built:
                    return None, None
                _SEC_SERIES_MAP = built
    return _SEC_SERIES_MAP.get(ticker.strip().upper(), (None, None))


def _sec_series_latest_nport(series_id):
    """Accession number of a series' most recent N-PORT, or None.

    The trust's own submissions feed interleaves hundreds of series (iShares
    Trust files for ~400), so finding one fund there means opening filings one
    by one. EDGAR's company browser accepts a series id in place of a CIK and
    lists only that series' filings.
    """
    atom = _sec_get(
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
        f"&CIK={series_id}&type=NPORT-P&dateb=&owner=include&count=10&output=atom"
    )
    accessions = re.findall(r"<accession-n(?:umber|o)>\s*([\d-]+)\s*<", atom or "")
    return accessions[0].replace("-", "") if accessions else None


# assetCat / issuerCat -> bucket. Vocabulary confirmed against N-PORT filings
# for 29 funds spanning equity, municipal-bond, corporate-bond, and leveraged
# CEFs: EC/EP are equity, repo and short-term paper are Cash, and the
# D-prefixed derivative categories are Options & derivatives. issuerCat=RF
# (the CEF holds shares of another registered fund) still reports assetCat=EC
# and is treated as equity -- if that fund is itself a known ticker, nested
# expansion picks it up the same way it already does for TSPY/TDAQ wrappers.
_NPORT_EQUITY_CATS = {"EC", "EP"}
_NPORT_CASH_CATS = {"RA", "STIV"}
_NPORT_DERIV_CATS = {"DE", "DFE", "DIR", "DCR", "DCO", "DO"}
# Debt-shaped: plain debt, asset/mortgage-backed, bank loans, structured
# notes. Everything else recognised as debt routes here; nothing does so by
# default (see below).
_NPORT_DEBT_CATS = {"DBT", "ABS-MBS", "ABS-APCP", "ABS-CBDO", "ABS-O", "LON", "SN"}


def _nport_bucket(asset_cat):
    """assetCat -> 'equity' | 'cash' | 'derivatives' | 'fixed_income'.

    Unrecognised and blank codes default to equity, not fixed income. Blank
    assetCat is real, not a parsing gap -- confirmed on ASGI, where 20 rows
    with no assetCat are private-placement LLC/LP equity stakes summing to
    21.4% of the fund, matching CEF Connect's own "Other" figure for the same
    fund (22.5%) almost exactly. Defaulting those to Fixed Income would have
    been confidently wrong; defaulting to equity means an unrecognised
    position surfaces as its own named, unmatched holding -- visibly
    uncertain rather than silently miscategorised.
    """
    cat = (asset_cat or "").strip().upper()
    if cat in _NPORT_CASH_CATS:
        return "cash"
    if cat in _NPORT_DERIV_CATS:
        return "derivatives"
    if cat in _NPORT_DEBT_CATS:
        return "fixed_income"
    return "equity"


_NPORT_NS = {"n": "http://www.sec.gov/edgar/nport"}


def _parse_nport_holdings(xml_text):
    """Raw {name, ticker, pct, asset_cat} rows from a primary_doc.xml filing."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    out = []
    for inv in root.iter():
        if not inv.tag.endswith("}invstOrSec"):
            continue

        def val(tag):
            el = inv.find(f"n:{tag}", _NPORT_NS)
            return el.text.strip() if el is not None and el.text else ""

        ticker = ""
        ident = inv.find("n:identifiers", _NPORT_NS)
        if ident is not None:
            for child in ident:
                if child.tag.endswith("}ticker"):
                    ticker = (child.get("value") or "").strip()

        pct = _clean_weight(val("pctVal"))
        if not pct or pct <= 0:
            continue
        out.append({
            "name": val("name") or val("title"),
            "ticker": ticker,
            "asset_cat": val("assetCat"),
            "pct": pct,
        })
    return out


# Labels for the three non-equity aggregates. Deliberately the same strings
# sector_exposure.py's FIXED_INCOME / CASH / DERIVATIVES constants use --
# imported lazily below rather than duplicated, so the two screens can never
# drift to different names for the same bucket. Lazy because sector_exposure
# imports from this module; a top-level import here would be circular.
def _nport_aggregate_labels():
    from sector_exposure import CASH, DERIVATIVES, FIXED_INCOME
    return {"cash": CASH, "derivatives": DERIVATIVES, "fixed_income": FIXED_INCOME}


def _fetch_sec_nport_holdings(ticker, limit=None):
    """A closed-end fund's complete quarterly holdings, from its own SEC filing.

    Unlike every other fetcher in this module, `limit` is intentionally not
    applied to equity rows: N-PORT's entire value is completeness (BCAT alone
    reports 1,397 positions), and truncating here would throw that away before
    it ever reaches the page. The existing top-N truncation in
    build_diversification already caps what a chart displays -- capping the
    cache too would just reintroduce the coverage gap this exists to close.
    """
    sym = ticker.strip().upper()
    cik, _title = _sec_cik_for(sym)
    if not cik:
        return []
    acc, report_date = _sec_latest_nport_accession(cik)
    if not acc:
        return []
    xml_text = _sec_get(
        f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/primary_doc.xml"
    )
    if not xml_text:
        return []
    return _nport_rows(xml_text, report_date)


def _fetch_sec_series_nport_holdings(ticker, limit=None):
    """An ETF's or mutual fund's complete holdings from its quarterly N-PORT.

    The fallback for funds whose issuer cannot be read: iShares and Invesco
    block automated downloads, and the free tables stop at a top 25. IEFA was
    unresolved here -- so OVF and NIHI, which hold it, charted "iShares Core
    MSCI EAFE ETF" as if it were a company -- while its filing lists all 2,625
    holdings. N-PORT is quarterly and public about two months after quarter
    end, so resolve_fund prefers a fresher source whenever that one is
    complete. `limit` is ignored for the same reason as the CEF fetcher.
    """
    cik, series_id = _sec_series_for(ticker)
    if not series_id:
        return []
    acc = _sec_series_latest_nport(series_id)
    if not acc:
        return []
    xml_text = _sec_get(
        f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/primary_doc.xml"
    )
    if not xml_text:
        return []
    # Every series in a trust files under the same CIK; a filing for the wrong
    # one would chart a different fund's portfolio without complaint.
    filed = re.search(r"<seriesId>\s*(S\d+)\s*</seriesId>", xml_text)
    if filed and filed.group(1) != series_id:
        return []
    report = re.search(r"<repPdDate>\s*([\d-]+)\s*</repPdDate>", xml_text)
    return _nport_rows(xml_text, report.group(1) if report else None)


def _nport_rows(xml_text, report_date):
    """Cache rows from one N-PORT filing: equities named, everything else pooled."""
    raw = _parse_nport_holdings(xml_text)
    if not raw:
        return []

    # Leveraged funds report position sizes as a percent of net assets, so a
    # fund that borrows to hold $1.60 of bonds per $1 of investor capital
    # files rows summing to ~160%. Scaled down (never up -- a filing that
    # sums under 100% is left as reported rather than having weight invented
    # for it) so the total matches what a share of the fund actually is.
    total = sum(r["pct"] for r in raw)
    scale = 100.0 / total if total > 100.5 else 1.0

    labels = _nport_aggregate_labels()
    aggregates = {"cash": 0.0, "derivatives": 0.0, "fixed_income": 0.0}
    rows = []
    for r in raw:
        pct = r["pct"] * scale
        bucket = _nport_bucket(r["asset_cat"])
        if bucket == "equity":
            rows.append(_row(r["ticker"], r["name"], pct))
        else:
            aggregates[bucket] += pct

    for bucket, pct in aggregates.items():
        if pct > 0:
            rows.append(_row("", labels[bucket], pct))

    if rows:
        rows[0] = {**rows[0], "as_of": report_date}
    return rows


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
    # TDAX targets 130% of TDAQ's daily return through a swap (prospectus band
    # 120-140%); the other -30% is the cash that leverage borrows. Its filing
    # shows only the swap and a cash offset, which charted as $10k of "Options
    # & derivatives" against negative collateral. TDAQ is defined as QQQM, so
    # the nesting pass carries this through to the Nasdaq-100 names.
    "TDAX": [("TDAQ", "TappAlpha Nasdaq-100 (TDAQ)", 130.0, "Equity"),
             ("", "Borrowed cash (swap financing)", -30.0, "Cash & Equivalents")],
}

# SpaceX now trades as SPCX and sits in the Nasdaq-100 (QQQM holds 4.9%), so
# XSHP's single holding is that listed company rather than a private label.
EXPOSURE_SEED["XSHP"] = [("SPCX", "Space Exploration Technologies Corp", 100.0, "Equity")]

# Spot commodity and crypto trusts. They are not 1940-Act funds, so they file
# no N-PORT and publish no holdings list -- a trust's only holding is the metal
# or the coin. Mapped so a fund holding one (BLOX holds FBTC and ETHA, XBCI
# holds IBIT) looks through to Bitcoin and Ethereum instead of charting a
# trust as if it were a company.
_TRUST_ASSETS = {
    ("Gold", "Commodities"): ("GLD", "IAU", "IAUM", "GLDM", "AAAU", "SGOL", "BAR", "OUNZ"),
    ("Silver", "Commodities"): ("SLV", "SIVR"),
    ("Bitcoin", "Digital Assets"): ("IBIT", "FBTC", "GBTC", "BTC", "BITB", "ARKB", "HODL",
                                    "BRRR", "EZBC", "BTCO", "BTCW"),
    ("Ethereum", "Digital Assets"): ("ETHA", "ETHE", "ETH", "FETH", "ETHW", "CETH", "QETH",
                                     "EZET"),
}
EXPOSURE_SEED.update({
    tkr: [("", asset, 100.0, asset_class)]
    for (asset, asset_class), tickers in _TRUST_ASSETS.items() for tkr in tickers
})

# Seeds that were right when written and have since gone stale. A fund's map
# is rewritten only while it is still exactly the old seed: a user's own edit,
# or any row they added, leaves it alone.
EXPOSURE_SEED_UPGRADES = {
    "XSHP": [("", "SpaceX (private)", 100.0, "Private")],
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
    for tkr, old in EXPOSURE_SEED_UPGRADES.items():
        current = cur.execute(
            "SELECT symbol, name, exposure_pct, asset_class, source FROM fund_exposure_map "
            "WHERE fund_ticker=?", (tkr,),
        ).fetchall()
        untouched = sorted((s or "", n, p, c) for s, n, p, c, src in current if src == "seed")
        if current and len(untouched) == len(current) and untouched == sorted(
                (_norm_symbol(s), n, p, c) for s, n, p, c in old):
            cur.execute("DELETE FROM fund_exposure_map WHERE fund_ticker=?", (tkr,))
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


_BOOTSTRAPPED = False
_BOOTSTRAP_LOCK = threading.Lock()


def bootstrap(conn):
    """Install the built-in issuer registry, exposures and wrapper definitions.

    These were previously seeded only from inside a refresh run, which is fine
    on a developer machine whose database has been refreshed for months and
    wrong everywhere else: a freshly installed copy started with an empty
    registry, so every position reported "no holdings data", KGLD/BTCI/KSLV had
    no economic exposure to show, and the wrapper funds had no definition. The
    screen looked broken when it was merely un-seeded.

    Every seeder here skips rows that already exist and never overwrites a
    user's own edits, so running it on each launch is safe. Failures are
    returned rather than raised -- a seeding problem must not stop the backend
    from starting, but it must not be invisible either.
    """
    problems = {}
    for name, fn in (("exposures", _seed_exposures),
                     ("issuers", _seed_issuers),
                     ("wrappers", _seed_wrappers)):
        try:
            fn(conn)
        except Exception as exc:
            problems[name] = f"{type(exc).__name__}: {str(exc)[:160]}"
    return problems


def _ensure_bootstrapped(conn):
    """Seed the built-ins once per process, on whichever request arrives first.

    Done lazily rather than at import time because the tables are created after
    this module is imported, and lazily rather than only at startup so the
    seeds also land for a process that was pointed at a different database.
    """
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return {}
    with _BOOTSTRAP_LOCK:
        if _BOOTSTRAPPED:
            return {}
        problems = bootstrap(conn)
        _BOOTSTRAPPED = True
    return problems


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

    prior = conn.execute(
        "SELECT status, source, coverage_pct, COALESCE(fetched_at, updated_at) "
        "FROM fund_holdings_meta WHERE fund_ticker=?",
        (sym,),
    ).fetchone()
    if not force and prior:
        # A normal resolve pass should also improve shallow top-holdings
        # results now that an issuer has begun publishing a complete file.
        # Near-complete files vary slightly around 100% because of rounding,
        # cash and short derivatives, so 99% is the stable cache threshold.
        # Complete files still age out: these funds rotate their option legs
        # weekly, and a cache that was never re-read left 87% of one portfolio
        # charted from holdings 81 days old.
        coverage = float(prior[2] or 0)
        age = _age_days(prior[3])
        fresh = age is not None and age < STALE_AFTER_DAYS
        if (prior[0] in {"self", "cash"}
                or (prior[0] == "resolved" and coverage >= 99.0 and fresh)):
            return {"ticker": sym, "status": prior[0], "source": prior[1],
                    "coverage_pct": prior[2], "cached": True}

    sec_type = _security_type(sym)

    if sec_type == "MONEYMARKET":
        _store_rows(conn, sym, [], "classified", None, sec_type)
        conn.execute("UPDATE fund_holdings_meta SET status='cash' WHERE fund_ticker=?", (sym,))
        conn.commit()
        return {"ticker": sym, "status": "cash", "source": "classified", "coverage_pct": 100.0}

    # Closed-end funds are checked against their own SEC filing before
    # anything else. Every registered CEF must file its complete portfolio on
    # Form N-PORT quarterly, which is both more authoritative and far deeper
    # than any issuer page or CEF Connect's published top ten -- measured
    # across the 29 CEFs held here, a median 100.2% vs 42.4%.
    rows, source = ([], None)
    if sec_type == "CEF":
        rows = _fetch_sec_nport_holdings(sym)
        source = "sec_nport" if rows else None

    # Resolution order for everything else: the fund's own issuer publishes
    # the most complete data, then the public scrapers, then Yahoo as a
    # shallow last resort.
    if not rows:
        rows, source = _fetch_from_issuer(conn, sym)

    if not rows:
        rows, source = _fetch_via_app(sym)

    if not rows:
        rows = _fetch_yahoo_holdings(sym)
        source = "yahoo" if rows else None

    # Every registered ETF and mutual fund files its complete portfolio on
    # N-PORT, the same as a closed-end fund does. It is a quarter old, so it
    # only replaces a fresher answer that leaves a real part of the fund
    # unnamed -- SEPQ's top-25 table covers 77.6%, its filing 99.2%. Not gated
    # on Yahoo's quote type: Yahoo calls SEPQ an EQUITY. The SEC's own fund
    # list decides, and a plain stock is simply not on it.
    if sec_type != "CEF" and _coverage(rows) < NESTABLE_COVERAGE:
        filed = _fetch_sec_series_nport_holdings(sym)
        if filed and _coverage(filed) >= _coverage(rows) + 10:
            rows, source = filed, "sec_nport"

    cached_rows = conn.execute(
        "SELECT COUNT(*) FROM fund_holdings WHERE fund_ticker=? AND source!='manual'",
        (sym,),
    ).fetchone()[0]
    prior_good = bool(cached_rows and prior and prior[0] == "resolved")
    prior_coverage = min(float(prior[2] or 0), 100.0) if prior else 0.0
    # Never let a transient fetch failure demote a fund that already has good
    # cached rows -- a rate-limited sweep would otherwise blank out complete
    # issuer data and inflate the Undisclosed slice. A *shallower* answer is
    # the same failure in disguise: with the issuer throttled, a stale-cache
    # refresh falls through to a top-25 table and would overwrite a complete
    # file with a quarter of it.
    if prior_good and (not rows or (prior_coverage >= NESTABLE_COVERAGE
                                    and _coverage(rows) < prior_coverage - 10)):
        return {"ticker": sym, "status": "resolved", "source": prior[1],
                "coverage_pct": prior[2], "kept_cached": True}

    if not rows:
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
    sql = (
        "SELECT ticker, SUM(current_value) FROM all_account_info "
        "WHERE current_value > 0 AND COALESCE(quantity, 0) > 1e-9 "
    )
    args = []
    if profile_ids:
        sql += f"AND profile_id IN ({','.join('?' * len(profile_ids))}) "
        args.extend(profile_ids)
    sql += "GROUP BY ticker HAVING SUM(current_value) > 0"
    return [(r[0].strip().upper(), float(r[1] or 0))
            for r in conn.execute(sql, args).fetchall() if r[0]]


def _scope_profile_ids():
    """Resolve the request's portfolio scope using app.py's shared helper.

    Falling back to None means "every profile", so losing this lookup does not
    fail loudly -- it quietly charts the wrong portfolio. That is what a
    packaged build did while this reached for ``import app``.
    """
    _app = _app_module("get_profile_filter")
    if _app is None:
        return None
    try:
        _is_agg, ids = _app.get_profile_filter()
        return ids
    except Exception:
        return None


def _discover_nested_candidates(conn, already, min_weight=5.0, limit=40, force=False,
                                within=None):
    """Funds that show up *inside* resolved funds but aren't positions themselves.

    TSPY holds VOO and TDAQ holds QQQM; neither VOO nor QQQM is a portfolio
    position, so without this they stay unresolved and render as if they were
    companies. Only constituents carrying real weight are chased, plus the
    ETFs the economic view looks through: synthetic option underlyings (DRMY's
    DRAM) and exposure-map targets (TDAX -> TDAQ).

    A nested fund that is already settled is skipped. One that failed, or whose
    holdings have aged out, is offered again -- skipping anything with a meta
    row at all left IEFA unresolved from its first failure onward, so the two
    funds holding it charted an iShares ETF as if it were a company.

    `within` limits the search to what those funds hold, so resolving three
    newly bought positions does not turn into a sweep of every aged-out ETF.
    """
    seen = {t.strip().upper() for t in already}
    scope, args = "", []
    if within:
        scope = f"AND fund_ticker IN ({','.join('?' * len(within))}) "
        args = [t.strip().upper() for t in within]
    weighted = [r[0] for r in conn.execute(
        "SELECT symbol, MAX(weight_pct) FROM fund_holdings "
        "WHERE symbol IS NOT NULL AND symbol != '' " + scope +
        "GROUP BY symbol HAVING MAX(weight_pct) >= ? ORDER BY MAX(weight_pct) DESC",
        (*args, min_weight),
    ).fetchall()]
    mapped = [r[0] for r in conn.execute(
        "SELECT DISTINCT symbol FROM fund_exposure_map "
        "WHERE symbol IS NOT NULL AND symbol != '' " + scope,
        args,
    ).fetchall()]
    # A nested gold or bitcoin trust is read from the exposure map; it has no
    # holdings file to fetch, so chasing it is a guaranteed miss every pass.
    seen |= {r[0] for r in conn.execute(
        "SELECT DISTINCT fund_ticker FROM fund_exposure_map"
    ).fetchall()}

    out = []
    for sym in _synthetic_underlyings(conn, within) + mapped + weighted:
        sym = (sym or "").strip().upper()
        if not sym or sym in seen:
            continue
        # Bond and swap sleeves carry CUSIPs and internal identifiers in the
        # symbol column ("912797SA6", "6771720TRS052427GS"). Chasing those
        # wastes lookups and pollutes the cache with junk tickers.
        if not _TICKER_PAT.match(sym):
            continue
        seen.add(sym)
        known = conn.execute(
            "SELECT status, coverage_pct, COALESCE(fetched_at, updated_at) "
            "FROM fund_holdings_meta WHERE fund_ticker=?", (sym,)
        ).fetchone()
        if known and not force:
            age = _age_days(known[2])
            settled = known[0] in {"manual", "self", "cash"} or (
                known[0] == "resolved" and (known[1] or 0) >= NESTABLE_COVERAGE
                and age is not None and age < STALE_AFTER_DAYS)
            if settled:
                continue
        out.append(sym)
        if len(out) >= limit:
            break
    return out


def _synthetic_underlyings(conn, within=None):
    """Every ETF a cached fund holds synthetically, as a ticker to resolve."""
    out = []
    holdings, _meta, _exposure = _load_cache(conn)
    funds = {t.strip().upper() for t in within} if within else None
    for fund, rows in holdings.items():
        if funds is not None and fund not in funds:
            continue
        for under in _synthetic_pairs(rows):
            sym = _INDEX_OPTION_PROXY.get(under, under)
            if sym not in out:
                out.append(sym)
    return out


def _run_refresh(tickers, force, targeted=False):
    # Published before any work starts. The job used to be marked running only
    # after seeding, so anything that threw before that point left _JOB in its
    # never-run state: the page polled once, saw running=False with zero
    # progress, and reported nothing at all -- identical to a refresh that was
    # never requested. A failure has to be distinguishable from a no-op.
    with _JOB_LOCK:
        _JOB.update(running=True, done=0, total=len(tickers), current="",
                    started=_now(), finished=None, errors=[], summary=None)
    conn = None
    try:
        conn = get_connection()
        for name, problem in bootstrap(conn).items():
            with _JOB_LOCK:
                _JOB["errors"].append(f"built-in {name} seed: {problem}")
        # Read back by build_diversification to decide whether the page may
        # start the next stale-holdings refresh on its own. A targeted job
        # (just the newly bought positions) refreshes nothing stale, so it
        # must not reset that clock.
        if not targeted:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (_LAST_REFRESH_KEY, _now()),
            )
            conn.commit()

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
        nested = _discover_nested_candidates(conn, tickers, force=force,
                                             within=tickers if targeted else None)
        if nested:
            with _JOB_LOCK:
                _JOB["total"] += len(nested)
            with ThreadPoolExecutor(max_workers=3) as ex:
                list(ex.map(work, nested))

        counts = {}
        for r in results.values():
            counts[r.get("status", "?")] = counts.get(r.get("status", "?"), 0) + 1
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
        "SELECT fund_ticker, status, source, coverage_pct, holdings_count, security_type, is_manual, as_of, "
        "COALESCE(fetched_at, updated_at) "
        "FROM fund_holdings_meta"
    ).fetchall():
        meta[row[0]] = {"status": row[1], "source": row[2], "coverage_pct": row[3],
                        "holdings_count": row[4], "security_type": row[5],
                        "is_manual": bool(row[6]), "as_of": row[7], "fetched_at": row[8]}
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


def _expand_nested(rows, holdings, meta, depth=2, _seen=None, rows_for=None):
    """Replace fund constituents with their own constituents, recursively.

    A wrapper holding 99.7% QQQM becomes the Nasdaq 100 names at 99.7% of their
    in-QQQM weights. Only expands when the nested fund is itself resolved and
    well covered (>=90%); a thinly-covered nested fund would silently convert
    known exposure into an Undisclosed remainder, which is worse than leaving
    the fund as its own slice. _seen breaks circular references.

    `rows_for(symbol)` reads a nested fund the same way the caller reads a
    position -- economic exposure, synthetic legs, capped at 100% -- so a
    fund looked through from inside another is not treated more literally
    than the same fund held directly. It also decides whether a fund nests at
    all, returning None to keep it as one slice. Without it the raw cache and
    the coverage rule above are used.
    """
    if depth <= 0:
        return rows
    _seen = _seen or set()

    out = []
    for r in rows:
        sym = (r.get("symbol") or "").strip().upper()
        weight = r.get("weight_pct")
        if not sym or not weight or sym in _seen:
            out.append(r)
            continue
        if rows_for is not None:
            nested = rows_for(sym)
        else:
            info = meta.get(sym) or {}
            nested = holdings.get(sym) if (
                info.get("status") in {"resolved", "manual"}
                and (info.get("coverage_pct") or 0) >= NESTABLE_COVERAGE) else None
        if not nested:
            out.append(r)
            continue

        inner = _expand_nested(nested, holdings, meta, depth - 1, _seen | {sym}, rows_for)
        scale = weight / 100.0
        for ir in inner:
            iw = ir.get("weight_pct")
            if not iw:
                continue
            # Carries the row's own markers (an exposure-map row stays one) so
            # the caller classifies it exactly as if it were held directly.
            out.append({**ir, "weight_pct": iw * scale, "via": sym})
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Reading one fund's rows
#
# Filed holdings are a balance sheet, not an exposure report. Three shapes
# misstate what a position is worth or what it is exposed to, and each is
# corrected here before anything is aggregated.
# ─────────────────────────────────────────────────────────────────────────────

def _is_cash_row(row):
    return bool(_CASH_PAT.search(row.get("name") or "")
                or _BILL_SYM_PAT.match(row.get("symbol") or ""))


def _is_derivative_row(row):
    return bool(_DERIV_PAT.search(row.get("name") or "")
                or _DERIV_SYM_PAT.search(row.get("symbol") or ""))


def _parse_option_leg(symbol, name):
    """(underlying, 'YYYY-MM-DD', strike, 'C'|'P') for an option row, else None."""
    m = _OCC_SYM_PAT.match(symbol or "")
    if m:
        root, yy, mm, dd, cp, strike = m.groups()
        return root, f"20{yy}-{mm}-{dd}", round(int(strike) / 1000.0, 3), cp
    m = _OPT_DESC_PAT.match((name or "").strip())
    if m:
        root, mo, dy, yr, cp1, k1, k2, cp2 = m.groups()
        year = yr if len(yr) == 4 else f"20{yr}"
        return (root.upper().replace(".", ""), f"{year}-{int(mo):02d}-{int(dy):02d}",
                round(float(k1 or k2), 3), (cp1 or cp2).upper())
    return None


def _synthetic_pairs(rows):
    """{underlying: [row indexes]} for synthetic long positions.

    A long call and a short put at the same strike and expiry pay off exactly
    like owning the shares; funds that cannot (or prefer not to) hold an asset
    build it this way on top of T-bill collateral. DRMY holds DRAM like this,
    KCOP holds COPX and CPER. A put *spread* (GIAX) or a lone covered call is
    not a synthetic long and is never matched.
    """
    legs = {}
    for i, r in enumerate(rows):
        if not r.get("weight_pct"):
            continue
        leg = _parse_option_leg(r.get("symbol"), r.get("name"))
        if leg:
            under, expiry, strike, side = leg
            legs.setdefault((under, expiry, strike), {"C": [], "P": []})[side].append(i)
    pairs = {}
    for (under, _expiry, _strike), side in legs.items():
        call = sum(rows[i]["weight_pct"] for i in side["C"])
        put = sum(rows[i]["weight_pct"] for i in side["P"])
        if side["C"] and side["P"] and call > 0 and put < 0:
            pairs.setdefault(under, []).extend(side["C"] + side["P"])
    return pairs


def _fold_synthetic_exposure(rows):
    """Economic reading of a fund that owns assets synthetically.

    Its cash and T-bills are not idle: they collateralise the synthetic
    position, and the pair's own value is that position's gain or loss. Both
    are re-attributed to the underlying -- what you would hold had you bought
    it outright -- so DRMY's 55% "collateral" becomes the DRAM it stands for,
    and the nesting pass then reads DRAM's memory-chip holdings.

    With several underlyings (KCOP: COPX and CPER) the collateral is split in
    proportion to each pair's gross option value. Filed market values carry no
    contract counts, so that split is an estimate; the underlyings themselves
    are not. Returns (rows, {symbol: weight}).
    """
    pairs = _synthetic_pairs(rows)
    if not pairs:
        return rows, {}
    legs = {i for idx in pairs.values() for i in idx}
    backing = [i for i, r in enumerate(rows)
               if i not in legs and (r.get("weight_pct") or 0) > 0 and _is_cash_row(r)]
    pool = sum(rows[i]["weight_pct"] for i in backing) + sum(rows[i]["weight_pct"] for i in legs)
    if pool <= 0:
        return rows, {}

    gross = {under: sum(abs(rows[i]["weight_pct"]) for i in idx) for under, idx in pairs.items()}
    gross_total = sum(gross.values())
    used = legs | set(backing)
    out = [r for i, r in enumerate(rows) if i not in used]
    synthetic = {}
    for under, g in sorted(gross.items(), key=lambda item: -item[1]):
        sym = _INDEX_OPTION_PROXY.get(under, under)
        weight = pool * g / gross_total
        out.append({"symbol": sym, "name": "", "weight_pct": weight, "synthetic": True})
        synthetic[sym] = synthetic.get(sym, 0.0) + weight
    return out, {sym: round(w, 2) for sym, w in synthetic.items()}


def _map_swap_references(rows, name_idx):
    """Single-name total-return swaps, read as the company they track.

    DRAM files "MICRON TECHNOLOGY INC SWAP NM" at 14.1% -- a position in
    Micron, bought with a swap instead of shares. Matched by name against the
    companies other funds hold; an unrecognised reference (an index basket, a
    fund's own strategy) stays a derivative.
    """
    out = []
    for r in rows:
        w = r.get("weight_pct") or 0
        m = _SWAP_REF_PAT.match(r.get("name") or "") if w > 0 else None
        ref = m.group(1).strip(" ,.-") if m else ""
        sym = name_idx.get(_norm_name(ref)) if ref else None
        if sym:
            out.append({**r, "symbol": sym, "name": ref, "swap": True})
        else:
            out.append(r)
    return out


def _cap_at_fund_value(rows):
    """Never let one fund's rows add up to more than the fund is worth.

    Filed weights can sum past 100% in two ways, and both inflated the chart --
    the buckets summed to $2,349 more than one portfolio held. A swap filed at
    notional counts its exposure *and* the T-bills behind it (DRAM: 122%), and
    the free top-25 tables drop the minus sign from short options and cash
    offsets (ULTI 109%, EGGY 107%). Either way the excess lives in the cash and
    derivative lines, so those are trimmed first and company weights stay as
    filed; only if that is not enough is the whole fund scaled down.
    """
    total = sum(r.get("weight_pct") or 0 for r in rows)
    excess = total - 100.0
    if excess <= 0.5:
        return rows
    out = [dict(r) for r in rows]
    soft = [i for i, r in enumerate(out)
            if (r.get("weight_pct") or 0) > 0 and not r.get("synthetic") and not r.get("swap")
            and (_is_cash_row(r) or _is_derivative_row(r))]
    soft_total = sum(out[i]["weight_pct"] for i in soft)
    if soft_total > 0:
        keep = max(soft_total - excess, 0.0) / soft_total
        for i in soft:
            out[i]["weight_pct"] *= keep
    total = sum(r.get("weight_pct") or 0 for r in out)
    if total > 100.5:
        scale = 100.0 / total
        for r in out:
            if r.get("weight_pct"):
                r["weight_pct"] *= scale
    return out


def _merge_listings(buckets):
    """Fold one company's other listings into a single bucket.

    Issuers name the same company with different symbols -- SK hynix arrives
    as 000660KS and SKHY, TC Energy as TRPCN and TRP -- so it charted as two
    unrelated slices. Buckets whose names normalise identically are merged,
    filed under the plainest symbol. Share classes (GOOG/GOOGL) differ in name
    and are folded earlier, via _SHARE_CLASS_ALIASES.
    """
    groups = {}
    for key, b in buckets.items():
        if b["kind"] not in {"holding", "stock"}:
            continue
        norm = _norm_name(b["name"])
        # Too short to identify a company on its own ("AG", "OR").
        if len(norm) >= 4:
            groups.setdefault(norm, []).append(key)

    for keys in groups.values():
        if len(keys) < 2:
            continue
        keys.sort(key=lambda k: (not _TICKER_PAT.match(buckets[k]["symbol"] or ""),
                                 len(buckets[k]["symbol"] or "~" * 12),
                                 -buckets[k]["value"]))
        keep = buckets[keys[0]]
        for k in keys[1:]:
            other = buckets.pop(k)
            keep["value"] += other["value"]
            for ticker, amount in other["contributions"].items():
                keep["contributions"][ticker] = keep["contributions"].get(ticker, 0.0) + amount
            keep["listings"] |= other["listings"]
            if keep["name"].isupper() and not other["name"].isupper():
                keep["name"] = other["name"]


def _undisclosed_composition(conn, ticker):
    """What kind of thing a fund's undisclosed remainder is, as {label: share}.

    CEF Connect publishes only a fund's ten largest positions, so a closed-end
    fund's look-through stops at a median 42% of the fund here and several stop
    far earlier (NAD 6.7%, BCAT 6.4%). The rest used to chart as one anonymous
    grey slice, which is honest but says nothing -- NAD's missing 93% is
    municipal bonds, and that is worth knowing.

    Reuses the sector profile the Sectors tab already caches, so this costs a
    table read rather than another fetch. Equity sectors collapse to a single
    "Equities" label because the remainder's *sector* mix is not known -- only
    that it is equity. Returns {} when nothing is cached, which keeps the
    original single-slice behaviour.
    """
    # Imported here rather than at module scope: sector_exposure imports this
    # module, so a top-level import would be circular.
    from sector_exposure import SECTOR_SET

    try:
        rows = conn.execute(
            "SELECT sector, weight_pct FROM security_sector_weights WHERE ticker=?",
            (ticker,),
        ).fetchall()
    except Exception:
        return {}

    groups = {}
    for label, weight in rows:
        # Leveraged funds report negative sleeves (borrowed cash). They say
        # how the fund is financed, not what the undisclosed part holds.
        if not weight or weight <= 0:
            continue
        key = "Equities" if label in SECTOR_SET else label
        groups[key] = groups.get(key, 0.0) + weight

    total = sum(groups.values())
    if not total:
        return {}
    return {label: weight / total for label, weight in groups.items()}


def _concentration(out, total, kinds):
    """How concentrated the named part of the portfolio is.

    `effective_holdings` is the inverse Herfindahl index: the number of
    equal-sized positions that would be exactly as concentrated. 3,000 look-
    through constituents can still behave like 60 if the top names dominate,
    which a count of slices never shows. Measured over named exposure only --
    cash, collateral and the undisclosed remainder are not positions.
    """
    named = [b for b in out if b["kind"] in kinds and b["value"] > 0]
    if not named or not total:
        return None
    measured = sum(b["value"] for b in named)
    hhi = sum((b["value"] / measured) ** 2 for b in named)
    largest = max(named, key=lambda b: b["value"])
    return {
        "effective_holdings": round(1.0 / hhi, 1),
        "holdings_count": len(named),
        "top10_pct": round(100.0 * sum(sorted((b["value"] for b in named), reverse=True)[:10])
                           / total, 2),
        "measured_pct": round(100.0 * measured / total, 2),
        "largest": {"symbol": largest["symbol"], "name": largest["name"],
                    "weight_pct": round(100.0 * largest["value"] / total, 2)},
    }


def _last_refresh_started(conn):
    try:
        row = conn.execute("SELECT value FROM settings WHERE key=?",
                           (_LAST_REFRESH_KEY,)).fetchone()
    except Exception:
        return None
    return row[0] if row else None


def build_diversification(conn, profile_ids=None, xray=True, mode="economic",
                          top=None, nest_depth=2):
    positions = _portfolio_positions(conn, profile_ids)
    total = sum(v for _, v in positions)
    position_value = dict(positions)
    holdings, meta, exposure = _load_cache(conn)
    name_idx = _name_index(holdings) if xray else {}
    # Lazy import (sector_exposure imports from this module, so a top-level
    # import here would be circular): the exact label SEC N-PORT rows use for
    # a fund's aggregated bond sleeve, so it can be recognised below and given
    # its own bucket instead of falling through as an unlabelled "holding".
    fixed_income_label = _nport_aggregate_labels()["fixed_income"]

    buckets = {}   # key -> dict
    fund_detail = []

    def add(key, label, value, kind, symbol="", contributor="", listing=""):
        b = buckets.setdefault(key, {"key": key, "name": label, "symbol": symbol,
                                     "value": 0.0, "kind": kind, "contributions": {},
                                     "listings": set()})
        b["value"] += value
        if contributor:
            b["contributions"][contributor] = (
                b["contributions"].get(contributor, 0.0) + value
            )
        if listing:
            b["listings"].add(listing)
        if kind in {"undisclosed", "undefined"}:
            b["kind"] = kind
        # Whichever fund reports a company first names its slice. Prefer a
        # real name over a bare ticker and mixed case over a shouted one
        # ("MARVELL TECHNOLOGY INC"), regardless of which fund came first.
        elif (kind in {"holding", "stock"} and label and label != b["name"]
              and (b["name"] in {b["symbol"], ""}
                   or (b["name"].isupper() and not label.isupper()))):
            b["name"] = label

    prepared = {}

    def fund_rows(fund):
        """(rows, basis, synthetic) for one fund, as the selected mode reads it."""
        if fund not in prepared:
            synthetic = {}
            if mode == "economic" and exposure.get(fund):
                rows = [{**r, "mapped": True} for r in exposure[fund]]
                basis = "exposure"
            elif holdings.get(fund):
                rows = holdings[fund]
                basis = meta.get(fund, {}).get("source") or "cache"
                if mode == "economic":
                    rows = _map_swap_references(rows, name_idx)
                    rows, synthetic = _fold_synthetic_exposure(rows)
                rows = _cap_at_fund_value(rows)
            else:
                rows, basis = None, None
            prepared[fund] = (rows, basis, synthetic)
        return prepared[fund]

    def nested_rows(fund):
        """A fund met inside another, or None to leave it as one slice.

        Exposure-mapped funds always nest in economic mode -- a gold trust has
        no holdings file to be "covered" by, it simply is gold. Anything else
        must be resolved and well covered, as before.
        """
        if mode == "economic" and exposure.get(fund):
            return fund_rows(fund)[0]
        info = meta.get(fund) or {}
        if (info.get("status") in {"resolved", "manual"}
                and (info.get("coverage_pct") or 0) >= NESTABLE_COVERAGE):
            return fund_rows(fund)[0]
        return None

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
            canon = _SHARE_CLASS_ALIASES.get(tkr, tkr)
            add(canon, canon, value, "stock", canon, tkr, listing=tkr)
            continue

        rows, used, synthetic = fund_rows(tkr)

        if not rows:
            # Distinct from a partial remainder: nothing is known about this
            # fund at all, which is a different problem with a different fix.
            # A position bought since the last resolve has simply never been
            # looked up -- that is not a fund that publishes nothing.
            never = tkr not in meta
            add(f"UNDEFINED::{tkr}",
                f"{tkr} — not looked up yet" if never else f"{tkr} — no holdings data",
                value, "undefined", tkr, tkr)
            fund_detail.append({"ticker": tkr, "value": value, "status": "unresolved",
                                "coverage_pct": 0.0, "source": None, "never_checked": never})
            continue

        economic = used == "exposure" or bool(synthetic) or any(r.get("swap") for r in rows)

        # Fund-of-fund expansion. Several option-income wrappers are a single
        # ETF plus collateral -- TSPY is 100.6% VOO, TDAQ 99.7% QQQM, OVL 99.9%
        # VOO. Stopping at "you own VOO" hides that this is really 500 stocks,
        # and defeats the whole point of merging exposure across funds.
        rows = _expand_nested(rows, holdings, meta, depth=nest_depth, rows_for=nested_rows)
        # Collateral is judged from what the fund *files*. Rows from the
        # exposure map already say what they are: CSHI is mapped to T-bills
        # because it is a T-bill fund, and its filed put spreads used to turn
        # that into "collateral" anyway.
        filed_rows = [] if used == "exposure" else holdings.get(tkr, [])
        derivative_context = any(_is_derivative_row(r) for r in filed_rows)
        financing_context = any(
            (r.get("weight_pct") or 0) < -1 and _is_cash_row(r) for r in filed_rows
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
            mapped = bool(r.get("mapped"))
            cash_class = mapped and (r.get("asset_class") or "").lower().startswith("cash")
            # Bill / cash collateral groups regardless of whether the issuer
            # gave it a symbol -- otherwise literal mode scatters a fund's
            # Treasury sleeve across rows like "B0090326".
            if cash_class or _is_cash_row({"symbol": sym, "name": nm}):
                # A mapped negative cash row is borrowing (TDAX's leverage):
                # it finances exposure, so it nets against collateral.
                if (mapped and w < 0) or (not mapped and collateral_context):
                    add("COLLATERAL", "Cash & T-bill collateral", share,
                        "collateral", contributor=tkr)
                else:
                    add("CASH", "Cash & equivalents", share, "cash", contributor=tkr)
                continue
            if _is_derivative_row({"symbol": sym, "name": nm}):
                add("DERIVATIVES", "Options & derivatives", share,
                    "derivative", contributor=tkr)
                continue
            # SEC N-PORT rows fold a fund's entire bond sleeve into one row
            # named exactly this (see _fetch_sec_nport_holdings). Without this
            # check a bond CEF's 90%+ debt position would land as an
            # unlabelled "holding" bucket, indistinguishable on the chart from
            # a single company that happened to be named "Fixed Income".
            if not sym and nm == fixed_income_label:
                add("FIXED_INCOME", fixed_income_label, share,
                    "fixed_income", contributor=tkr)
                continue
            canon = _SHARE_CLASS_ALIASES.get(sym, sym)
            key = canon or f"NAME::{_norm_name(nm)}"
            add(key, nm if not sym else (nm or sym), share, "holding", canon, tkr, listing=sym)

        covered = min(covered, 100.0)
        if covered < 99.5:
            remainder = value * (1 - covered / 100.0)
            # Name the remainder by asset class where the fund publishes one.
            # Still charted as Undisclosed -- this says what kind of thing is
            # missing, not which companies, so no weight is ever estimated.
            composition = _undisclosed_composition(conn, tkr)
            if composition:
                for label, share in composition.items():
                    add(f"UNDISCLOSED::{tkr}::{label}",
                        f"{tkr} — undisclosed ({label})",
                        remainder * share, "undisclosed", tkr, tkr)
            else:
                add(f"UNDISCLOSED::{tkr}", f"{tkr} — rest not disclosed by issuer",
                    remainder, "undisclosed", tkr, tkr)
        age = _age_days(info.get("fetched_at"))
        fund_detail.append({"ticker": tkr, "value": value, "status": status,
                            "coverage_pct": round(covered, 2), "source": used,
                            "mode": "economic" if economic else "literal",
                            "synthetic": synthetic or None,
                            "as_of": info.get("as_of"),
                            "fetched_at": info.get("fetched_at"),
                            "age_days": round(age, 1) if age is not None else None})

    if xray:
        _merge_listings(buckets)

    out = []
    for b in buckets.values():
        name = b["name"]
        others = sorted(b["listings"] - {b["symbol"]})
        # Share classes are one company under two names ("Alphabet Inc. Class
        # A" / "Class C"), so the class drops out of the combined label.
        if any(o in _SHARE_CLASS_ALIASES for o in others):
            base = _CLASS_SUFFIX_PAT.sub("", name).strip(" ,")
            name = f"{base} ({' + '.join([b['symbol']] + others)})"
        out.append({
            "key": b["key"], "symbol": b["symbol"], "name": name,
            "value": round(b["value"], 2),
            "weight_pct": round(100.0 * b["value"] / total, 4) if total else 0.0,
            "kind": b["kind"],
            "listings": [b["symbol"]] + others if others else [],
            "contributor_count": len(b["contributions"]),
            "contributors": [
                {"ticker": ticker, "value": round(amount, 2),
                 # How much of that position this slice is -- "NVDA is 7.7%
                 # of SPYI" -- which the dollar figure alone does not say.
                 "fund_pct": (round(100.0 * amount / position_value[ticker], 3)
                              if position_value.get(ticker) else None)}
                for ticker, amount in sorted(
                    b["contributions"].items(), key=lambda item: -abs(item[1])
                )[:5]
            ],
        })
    out.sort(key=lambda r: -r["value"])

    # Coverage is measured over every bucket, before any truncation. It used to
    # be summed from the truncated list, so asking for `top` silently reported
    # less Undisclosed than the portfolio actually has -- the one number on this
    # screen that must never read low.
    resolved_val = sum(f["value"] for f in fund_detail if f["status"] != "unresolved")
    undisclosed_val = sum(b["value"] for b in out if b["kind"] == "undisclosed")
    undefined_val = sum(b["value"] for b in out if b["kind"] == "undefined")
    concentration = _concentration(out, total, {"holding", "stock"} if xray else {"fund"})

    # Holdings older than a week are re-read by the next ordinary resolve.
    # Exposure-mapped funds are left out: their chart comes from the map, not
    # from the filed rows that aged.
    stale = [f for f in fund_detail
             if f["status"] == "resolved" and f.get("source") != "exposure"
             and (f.get("age_days") or 0) >= STALE_AFTER_DAYS]
    stale_val = sum(f["value"] for f in stale)
    unchecked = [f["ticker"] for f in fund_detail if f.get("never_checked")]
    last_refresh = _last_refresh_started(conn)
    since_refresh = _age_days(last_refresh)
    fetched = [f["fetched_at"] for f in fund_detail
               if f["status"] == "resolved" and f.get("fetched_at")]

    constituent_count = len(out)
    truncated_value = 0.0
    if top and constituent_count > top:
        # A broad portfolio looks through to ~14,000 constituents and the screen
        # charts 60 of them, so sending all of them is ~2.9 MB spent to render a
        # top-40 donut. Everything that is not a plain holding stays regardless
        # of rank: the page looks those up by kind to decide whether to warn
        # about collateral or undisclosed weight, and a missing bucket would
        # silently drop the warning rather than shrink the list.
        head = out[:top]
        kept = {id(r) for r in head}
        specials = [r for r in out[top:] if r["kind"] != "holding"]
        tail = [r for r in out[top:]
                if r["kind"] == "holding" and id(r) not in kept]
        truncated_value = round(sum(r["value"] for r in tail), 2)
        out = head + specials

    return {
        "total_value": round(total, 2),
        "position_count": len(positions),
        "xray": xray,
        "mode": mode,
        # Nothing has ever been *fetched* on this installation. Distinct from
        # "every fund failed to resolve": the first is a cache that has not been
        # filled yet, which is what a new install looks like, and the advice for
        # it ("run a resolve") is the opposite of the advice for the second
        # ("map an issuer or define the fund by hand"). Built-in wrapper
        # definitions are seeded at startup and do not count as a filled cache.
        "cache_empty": not any(not m.get("is_manual") for m in meta.values()),
        "constituents": out,
        # How many buckets exist in total, and what the rows left out are worth,
        # so a truncated response can still label "Other (N)" honestly.
        "constituent_count": constituent_count,
        "truncated_value": truncated_value,
        "concentration": concentration,
        "funds": sorted(fund_detail, key=lambda r: -r["value"]),
        "freshness": {
            "stale_after_days": STALE_AFTER_DAYS,
            "stale_funds": len(stale),
            "stale_value": round(stale_val, 2),
            "stale_pct": round(100.0 * stale_val / total, 2) if total else 0.0,
            "oldest_fetched_at": min(fetched) if fetched else None,
            # Positions never looked up at all -- bought since the last resolve.
            "unchecked": unchecked,
            "last_refresh_at": last_refresh,
            # The page starts a refresh by itself only when stale holdings
            # carry real weight and it has not just tried, so a publisher that
            # is down does not cost a full sweep on every visit.
            "auto_refresh_due": bool(
                total and stale_val >= 0.01 * total
                and (since_refresh is None
                     or since_refresh * 24 >= AUTO_REFRESH_COOLDOWN_HOURS)
            ),
        },
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
            # Of those, positions never looked up -- the page resolves these
            # itself, so they are not counted as funds needing a definition.
            "unchecked_funds": len(unchecked),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

def register_routes(app):

    @app.route("/api/diversification", methods=["GET"])
    def api_diversification():
        xray = request.args.get("xray", "1") not in {"0", "false", "no"}
        mode = "literal" if request.args.get("mode", "economic") == "literal" else "economic"
        top = request.args.get("top", type=int)
        if top is not None:
            top = max(1, min(top, 1000))
        scope = _scope_profile_ids()
        conn = get_connection()
        try:
            _ensure_bootstrapped(conn)
            return jsonify(build_diversification(conn, scope, xray, mode, top))
        finally:
            conn.close()

    @app.route("/api/diversification/funds", methods=["GET"])
    def api_diversification_funds():
        """Per-fund resolution status -- drives the manual-definition screen."""
        scope = _scope_profile_ids()
        conn = get_connection()
        try:
            _ensure_bootstrapped(conn)
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
            _ensure_bootstrapped(conn)
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
            _ensure_bootstrapped(conn)
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
        threading.Thread(target=_run_refresh, args=(tickers, force, bool(payload.get("tickers"))),
                         daemon=True).start()
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
