"""Cash-secured put selling candidate scanner.

Finds large/mid-cap stocks that have sold off harder than their own volatility
justifies, then rates them as candidates for selling cash-secured puts.

The screen runs in three stages so a broad universe stays affordable:

  1. Price stage  - one batched history download for the whole universe, then
                    pure-pandas technicals (drawdown, sigma stretch, excess
                    move vs the market, RSI, ATR, realized vol, stabilization).
                    Cached ~15 min, so re-running with different filters is
                    instant.
  2. Fundamental  - `.info` only for tickers that survived the price stage.
                    Concurrent, cached ~6 h.
  3. Option stage - live put chain for the finalists only: strike near the
                    target delta, premium, annualized return on cash, and the
                    effective cost basis if assigned. Cached ~5 min.

Endpoints:
  GET  /api/options/put-scan/universes
  POST /api/options/put-scan
"""

from __future__ import annotations

import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import yfinance as yf
from flask import jsonify, request

from config import get_connection
from option_probability import profit_probability_schedule
from option_skew_history import calculate_skew_metrics, record_skew_snapshot
from option_strike_targets import strike_for_delta
from options_pricing import black_scholes, implied_vol

# ---------------------------------------------------------------------------
# Universes
# ---------------------------------------------------------------------------
# Curated optionable names. The live market-cap filter is what actually decides
# large vs mid, so these lists only need to be a sane optionable starting pool.

LARGE_CAP_UNIVERSE = [
    # Technology & communications
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "ORCL", "CRM", "AMD",
    "ADBE", "CSCO", "ACN", "INTU", "TXN", "QCOM", "NOW", "IBM", "AMAT", "MU",
    "ADI", "LRCX", "KLAC", "PANW", "SNPS", "CDNS", "ANET", "INTC", "NXPI", "MRVL",
    "FTNT", "ADSK", "ROP", "MSI", "APH", "TEL", "WDAY", "DDOG", "SNOW", "TEAM",
    "CRWD", "ZS", "NET", "SHOP", "UBER", "ABNB", "PYPL", "EBAY", "NFLX", "DIS",
    "CMCSA", "TMUS", "VZ", "T", "EA", "TTWO", "SPOT", "PINS", "MDB", "HPQ",
    "DELL", "GLW", "STX", "WDC", "ON", "SWKS", "TER", "CTSH", "IT",
    # Financials
    "BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "SCHW", "BLK",
    "AXP", "C", "SPGI", "CB", "PGR", "CME", "ICE", "AON", "COF",
    "USB", "PNC", "TFC", "BK", "AIG", "MET", "PRU", "ALL", "TRV", "AFL",
    "DFS", "SYF", "FITB", "HBAN", "RF", "KEY", "CFG", "STT", "AMP", "NDAQ",
    # Healthcare
    "LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "DHR", "PFE", "AMGN",
    "BMY", "GILD", "CVS", "MDT", "ISRG", "SYK", "BSX", "VRTX", "REGN", "ZTS",
    "ELV", "CI", "HCA", "MCK", "BDX", "EW", "HUM", "BIIB", "MRNA", "IQV",
    "A", "DXCM", "IDXX", "RMD", "CNC", "ZBH", "BAX", "VTRS", "COR",
    # Consumer
    "WMT", "COST", "PG", "HD", "KO", "PEP", "MCD", "NKE", "LOW", "SBUX",
    "TJX", "TGT", "DG", "DLTR", "CL", "KMB", "GIS", "HSY", "STZ",
    "KHC", "MDLZ", "MO", "PM", "KDP", "MNST", "CMG", "YUM", "DRI", "ROST",
    "BBY", "ORLY", "AZO", "F", "GM", "LULU", "DECK", "EL", "CLX", "SYY",
    "KR", "TSCO", "ULTA", "MAR", "HLT", "RCL", "CCL", "DPZ", "TSLA",
    # Industrials
    "CAT", "DE", "BA", "HON", "UNP", "UPS", "FDX", "LMT", "RTX", "NOC",
    "GD", "GE", "MMM", "EMR", "ETN", "ITW", "PH", "CSX", "NSC", "WM",
    "RSG", "JCI", "CMI", "PCAR", "ROK", "DOV", "AME", "FAST", "PWR", "URI",
    "TDG", "LHX", "TXT", "SWK", "CARR", "OTIS", "LUV", "DAL", "UAL", "GWW",
    # Energy, materials, utilities
    "XOM", "CVX", "COP", "EOG", "SLB", "PSX", "VLO", "MPC", "OXY", "WMB",
    "KMI", "OKE", "HAL", "DVN", "FANG", "LIN", "APD", "SHW", "ECL",
    "FCX", "NEM", "NUE", "DOW", "DD", "PPG", "VMC", "MLM", "NEE", "DUK",
    "SO", "D", "AEP", "SRE", "EXC", "XEL", "ED", "PEG", "WEC", "ES",
    # REITs
    "PLD", "AMT", "EQIX", "CCI", "SPG", "O", "PSA", "WELL", "DLR", "VICI",
    "AVB", "EQR", "IRM", "EXR",
]

MID_CAP_UNIVERSE = [
    "ACHC", "AA", "ALGN", "ALK", "AMKR", "AN", "ANSS", "APA", "AR", "ARMK",
    "ATO", "AVNT", "AXTA", "BC", "BJ", "BLDR", "BURL", "BYD", "CACI", "CAR",
    "CHRW", "CHX", "CIEN", "CLF", "CNM", "COHR", "CROX", "CRUS", "CVNA", "DAR",
    "DINO", "DKS", "DOCS", "DXC", "EAT", "ELAN", "ENPH", "EQT", "EXAS", "EXPD",
    "FHN", "FIVE", "FLS", "FND", "FOUR", "GNRC", "GPC", "GT", "HELE", "HII",
    "HOG", "HUN", "IBKR", "INCY", "IPG", "IRDM", "JAZZ", "JBHT", "JBL", "JEF",
    "KBH", "KMX", "KNX", "KSS", "LEA", "LECO", "LNC", "LSCC", "M", "MANH",
    "MASI", "MAT", "MOS", "MSM", "MTCH", "MTZ", "MUR", "NCLH", "NOV", "NWL",
    "NYT", "OLN", "OMF", "ONTO", "OSK", "OVV", "PAG", "PATH", "PENN", "PII",
    "PLNT", "POST", "PSTG", "PVH", "R", "RH", "RIG", "RRC", "SAIA", "SAIC",
    "SEE", "SKX", "SLAB", "SM", "SNX", "SON", "SSD", "STLD", "STWD", "TDC",
    "TOL", "TPR", "TPX", "TREX", "TRIP", "TTC", "TXRH", "UAA", "UHS", "VAC",
    "VC", "VFC", "VNO", "VSH", "WAL", "WEN", "WHR", "WOLF", "WSM", "WU",
    "WYNN", "X", "XRAY", "YETI", "ZBRA", "ZION",
]

# Broad-market, style, and rates index funds. These are the steadiest put-selling
# underlyings there are: an index cannot miss earnings or blow up on one
# headline, and the whole basket has to fall for the strike to come into play.
INDEX_ETF_UNIVERSE = [
    # US broad market
    "SPY", "VOO", "IVV", "SPLG", "QQQ", "QQQM", "DIA", "IWM", "VTI", "ITOT",
    "RSP", "MDY", "IJH", "IJR", "SPMD", "SPSM", "SCHX", "SCHB", "OEF",
    # Style and factor
    "VUG", "VTV", "IWF", "IWD", "IWB", "IWO", "IWN", "IWP", "IWS",
    "MTUM", "QUAL", "USMV", "VLUE", "SPHQ",
    # Dividend
    "SCHD", "VYM", "DVY", "SDY", "NOBL", "VIG", "HDV", "DGRO",
    # International broad
    "EFA", "IEFA", "VEA", "EEM", "IEMG", "VWO", "ACWI", "VT", "VXUS", "VGK", "VPL",
    # Rates and credit
    "TLT", "IEF", "SHY", "AGG", "BND", "LQD", "HYG", "JNK", "TIP", "EMB", "MBB",
]

# Sector, industry, and single-country funds. More concentrated than a
# broad index, so a sector selloff is a real dislocation rather than market beta.
SECTOR_ETF_UNIVERSE = [
    # SPDR select sectors
    "XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
    # Vanguard sectors
    "VGT", "VFH", "VHT", "VDE", "VIS", "VCR", "VDC", "VPU", "VAW", "VNQ", "VOX",
    # Technology industry
    "SMH", "SOXX", "IGV", "XSD", "SKYY", "HACK", "CIBR", "FDN", "WCLD", "ARKK", "ARKG",
    # Healthcare industry
    "IBB", "XBI", "IHI", "XPH", "XHE",
    # Financials industry
    "KRE", "KBE", "IAI", "KIE",
    # Energy industry
    "XOP", "OIH", "AMLP", "ICLN", "TAN", "URA", "URNM", "FCG",
    # Materials and mining
    "XME", "GDX", "GDXJ", "SIL", "COPX", "LIT", "REMX", "MOO",
    # Real estate and housing
    "IYR", "XHB", "ITB", "REZ",
    # Consumer, retail, transport
    "XRT", "IYT", "JETS", "PEJ", "PBJ",
    # Aerospace, defense, infrastructure
    "PAVE", "IFRA", "ITA", "XAR", "PPA",
    # Single country and region
    "FXI", "KWEB", "MCHI", "EWZ", "EWJ", "EWY", "EWT", "INDA", "EWG", "EWU",
    "EWC", "EWA", "EWW",
]

# Keep commodity funds separate from sector funds so a scan can request broad
# indexes plus gold/oil/agriculture without pulling in XLK or KRE as well.
COMMODITY_ETF_UNIVERSE = [
    "GLD", "IAU", "SLV", "PPLT", "PALL", "USO", "UNG", "DBC", "DBA", "CPER",
    "GSG", "PDBC", "BCI", "DJP",
]
ALL_ETF_UNIVERSE = INDEX_ETF_UNIVERSE + SECTOR_ETF_UNIVERSE + COMMODITY_ETF_UNIVERSE
INDEX_ETF_SET = frozenset(INDEX_ETF_UNIVERSE)
SECTOR_ETF_SET = frozenset(SECTOR_ETF_UNIVERSE)
COMMODITY_ETF_SET = frozenset(COMMODITY_ETF_UNIVERSE)

# A selected-fund scan is intentionally allowed to show the best available
# contract even when the technical screen has no fully qualifying result.  The
# row remains clearly non-actionable: this flag reaches the UI, the verdict,
# and the more defensive management plan.
LOW_CONFIDENCE_SELECTED_FUND_FLAG = (
    "Misses selected underlying filters — lower-confidence candidate"
)

# Tickers known to be single companies before any network call. The price stage
# uses this to decide which thresholds to apply; anything in neither this set nor
# the ETF sets (a holding, a watchlist name, a custom ticker) is unknown until
# `.info` comes back in stage 2. See the gating note in run_put_scan.
CURATED_STOCK_SET = frozenset(LARGE_CAP_UNIVERSE) | frozenset(MID_CAP_UNIVERSE)

BENCHMARK = "SPY"

UNIVERSE_CHOICES = {
    "large_cap": {"label": "Large caps", "tickers": LARGE_CAP_UNIVERSE},
    "large_mid": {"label": "Large + mid caps", "tickers": LARGE_CAP_UNIVERSE + MID_CAP_UNIVERSE},
    "mid_cap": {"label": "Mid caps only", "tickers": MID_CAP_UNIVERSE},
    "index_etf": {"label": "Index ETFs (SPY, QQQ, IWM…)", "tickers": INDEX_ETF_UNIVERSE},
    "sector_etf": {"label": "Sector ETFs (XLK, XLE…)", "tickers": SECTOR_ETF_UNIVERSE},
    "etf_all": {"label": "All ETFs (index + sector + commodity)", "tickers": ALL_ETF_UNIVERSE},
    "stocks_and_etfs": {"label": "Large caps + ETFs", "tickers": LARGE_CAP_UNIVERSE + ALL_ETF_UNIVERSE},
    "commodity_etf": {"label": "Commodity ETFs", "tickers": COMMODITY_ETF_UNIVERSE},
    "holdings": {"label": "My holdings", "tickers": None},
    "watchlist": {"label": "My watchlist", "tickers": None},
    "custom": {"label": "Custom ticker list", "tickers": None},
}

# Leveraged and inverse funds decay and gap in ways a cash-secured put seller is
# not compensated for. Detected by name and category so holdings/watchlist/custom
# scans catch them too, not just the curated lists (which contain none).
#
# The detection is two-tier on purpose. Plain substring hints do not work here:
# "SHORT" and "ULTRA" are duration words as often as leverage words, so hints
# like "SHORT " and "ULTRA" classified the entire short-duration bond complex as
# leveraged — SHY ("Short Government"), BIL, JPST and ICSH ("Ultrashort Bond")
# were all silently dropped from every scan, and those are exactly the funds a
# real portfolio holds.
#
# Tier 1 is unambiguous leverage language, including the Morningstar/Yahoo
# "Trading--Leveraged" / "Trading--Inverse" categories that every real leveraged
# ETF carries. Tier 2 is the ambiguous wording, and only counts when the string
# does not also read as a bond-duration description.
_LEVERAGE_STRONG_RE = re.compile(
    r"\b-?[23]X\b"
    r"|\b-1X\b"
    r"|\bULTRAPRO\b"
    r"|\bLEVERAGED\b"
    r"|\bINVERSE\b"
    r"|\bDOUBLE\b|\bTRIPLE\b"
    r"|\b(?:BEAR|BULL)\s*-?[123]\s*X\b"
    r"|\bTRADING\W+(?:LEVERAGED|INVERSE)\b"
)
_LEVERAGE_WEAK_RE = re.compile(r"\bULTRA\b|\bULTRASHORT\b|\bSHORT\b")
_BOND_DURATION_RE = re.compile(
    r"\b(?:ULTRA[\s-]?SHORT|SHORT)[\s-]?"
    r"(?:TERM|DURATION|MATURITY|GOVERNMENT|CREDIT|CORPORATE|TREASURY|BOND|MUNI)"
)


def _reads_as_leveraged(text: str) -> bool:
    """True when a fund's name/category describes leverage or an inverse."""
    if _LEVERAGE_STRONG_RE.search(text):
        return True
    return bool(_LEVERAGE_WEAK_RE.search(text)) and not _BOND_DURATION_RE.search(text)

RISK_FREE = 0.0375
TRADING_DAYS = 252
# Zero keeps same-day expirations available while the market still lists and
# quotes them.  MAX_TARGET_DTE deliberately reaches well beyond one year so
# every option scanner can use LEAPS through three years.
MIN_TARGET_DTE = 0
MAX_TARGET_DTE = 1095

# ---------------------------------------------------------------------------
# Caches
# ---------------------------------------------------------------------------

_HISTORY_TTL = 900        # 15 min
_INFO_TTL = 6 * 3600      # 6 h
_CHAIN_TTL = 300          # 5 min

_history_cache: dict[tuple, tuple[float, pd.DataFrame]] = {}
_info_cache: dict[str, tuple[float, dict]] = {}
_put_chain_cache: dict[tuple[str, str], tuple[float, list]] = {}
_put_skew_call_cache: dict[tuple[str, str], tuple[float, list]] = {}


def _cache_get(cache: dict, key, ttl: float):
    entry = cache.get(key)
    if entry and (time.time() - entry[0]) < ttl:
        return entry[1]
    return None


def _cache_set(cache: dict, key, value):
    cache[key] = (time.time(), value)


# ---------------------------------------------------------------------------
# Small numeric helpers
# ---------------------------------------------------------------------------

def _num(v, default=None):
    """Coerce to a finite float, else `default`."""
    try:
        if v is None:
            return default
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _round(v, dec=2):
    f = _num(v)
    return None if f is None else round(f, dec)


def _parse_date(value) -> date | None:
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _ts_to_iso(value) -> str | None:
    """Yahoo returns dividend dates as a unix timestamp; keep them as ISO days."""
    ts = _num(value)
    if ts is None or ts <= 0:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
    except (OSError, OverflowError, ValueError):
        return None


def _quoted_spread_pct(bid, ask, mid) -> float | None:
    """Bid/ask width as a percentage of the mid, or None when unquotable.

    Returns None rather than a number for a crossed or one-sided quote (ask below
    bid, or either side missing), which Yahoo does return on stale chains. The old
    `ask - bid` arithmetic turned those into a *negative* spread, which then
    sailed through every "is this tight enough" comparison.
    """
    b, a, m = _num(bid), _num(ask), _num(mid)
    if b is None or a is None or m is None or m <= 0:
        return None
    if b <= 0 or a <= 0 or a < b:
        return None
    return (a - b) / m * 100.0


def dividend_yield_for_pricing(fund: dict, price: float | None) -> float:
    """Continuous dividend yield (decimal) for the Black-Scholes carry term.

    Derived from dollars per share over price rather than Yahoo's
    `dividendYield` field, which is genuinely ambiguous: current yfinance
    returns it in percent (AAPL 0.32 meaning 0.32%), older versions returned a
    decimal, and a "divide by 100 only if > 1" heuristic silently mis-reads
    every sub-1% payer as a 32%-yield stock — which distorts delta and so picks
    the wrong strike. Dollars per share has no such ambiguity.
    """
    px = _num(price)
    if px and px > 0:
        for key in ("dividend_rate", "trailing_annual_dividend_rate"):
            rate = _num(fund.get(key))
            if rate is not None and rate > 0:
                return min(0.5, rate / px)

    # No per-share figure available. The reported yield is percent in current
    # yfinance, so scale it once; clamped because a bad unit here is worse than
    # ignoring the carry term entirely.
    reported = _num(fund.get("dividend_yield"))
    if reported is None or reported <= 0:
        return 0.0
    return min(0.5, reported / 100.0)


def _is_fund(fund: dict, ticker: str = "") -> bool:
    """True for ETFs and mutual funds, which have AUM instead of a market cap."""
    quote_type = str(fund.get("quote_type") or "").upper()
    if quote_type in ("ETF", "MUTUALFUND"):
        return True
    if ticker and (ticker in INDEX_ETF_SET or ticker in SECTOR_ETF_SET or ticker in COMMODITY_ETF_SET):
        return True
    # yfinance sometimes omits quoteType; AUM with no market cap still means fund.
    return fund.get("total_assets") is not None and fund.get("market_cap") is None


def _fund_kind(ticker: str, fund: dict) -> str:
    """Classify a fund by how diversified it is.

    Breadth is the fund equivalent of company quality here: a broad index cannot
    be sunk by one company's bad quarter, while a narrow thematic fund can.
    """
    name = f"{fund.get('name') or ''} {fund.get('category') or ''}".upper()
    if _reads_as_leveraged(name):
        return "leveraged"
    if ticker in INDEX_ETF_SET:
        return "index"
    if ticker in SECTOR_ETF_SET:
        return "sector"
    if ticker in COMMODITY_ETF_SET:
        return "commodity"
    category = str(fund.get("category") or "").upper()
    if any(word in category for word in ("BLEND", "TOTAL", "LARGE", "500", "WORLD", "BOND")):
        return "index"
    return "narrow"


def _fund_size(fund: dict):
    """Size in dollars: market cap for companies, AUM for funds."""
    return _num(fund.get("market_cap")) or _num(fund.get("total_assets"))


def _ramp(value, lo, hi, points):
    """Linear 0..points as `value` moves lo..hi. Clamped at both ends."""
    v = _num(value)
    if v is None or hi == lo:
        return 0.0
    frac = (v - lo) / (hi - lo)
    return round(max(0.0, min(1.0, frac)) * points, 2)


def _wilder_rsi(closes: pd.Series, period: int = 14):
    if len(closes) < period + 1:
        return None
    delta = closes.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    last_gain = _num(avg_gain.iloc[-1])
    last_loss = _num(avg_loss.iloc[-1])
    if last_gain is None or last_loss is None:
        return None
    if last_loss == 0:
        return 100.0
    rs = last_gain / last_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14):
    if len(close) < period + 1:
        return None
    prev_close = close.shift(1)
    tr = pd.concat([
        (high - low).abs(),
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return _num(tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean().iloc[-1])


def window_stretch(log_ret: pd.Series, lookback_days: int) -> dict | None:
    """Size the recent move against the volatility that came before it.

    Shared by both option scanners, because the subtlety here decides whether
    either screen discriminates at all: the baseline sigma is measured from the
    period *before* the window. Letting the move itself into its own yardstick
    collapses every name toward ~1σ and the ranking stops meaning anything.

    `stretch_sigma` is signed for a decline (positive = fell that many sigma),
    which is what the put screen wants; the call screen negates it.
    """
    n = min(lookback_days, len(log_ret) - 1)
    if n < 5:
        return None

    window_log_ret = float(log_ret.iloc[-n:].sum())

    baseline = log_ret.iloc[:-n]
    if len(baseline) < 40:
        baseline = log_ret
    sigma_d = _num(baseline.std())
    if not sigma_d or sigma_d <= 0:
        return None

    root_n = math.sqrt(n)
    return {
        "n": n,
        "window_log_ret": window_log_ret,
        "window_pct": (math.exp(window_log_ret) - 1.0) * 100.0,
        "sigma_d": sigma_d,
        "expected_move_pct": sigma_d * root_n * 100.0,
        "stretch_sigma": -window_log_ret / (sigma_d * root_n),
    }


# ---------------------------------------------------------------------------
# Stage 1 - price history and technicals
# ---------------------------------------------------------------------------

def _chunked_download(tickers: list[str], period: str = "1y", chunk_size: int = 25):
    """Batched yf.download. Yahoo silently drops tickers past ~50 per call."""
    frames = []
    for i in range(0, len(tickers), chunk_size):
        if i > 0:
            time.sleep(0.6)
        chunk = tickers[i:i + chunk_size]
        try:
            raw = yf.download(
                chunk if len(chunk) > 1 else chunk[0],
                period=period, interval="1d", progress=False,
                auto_adjust=False, group_by="ticker", threads=True,
            )
        except Exception:
            continue
        if raw is None or raw.empty:
            continue
        if len(chunk) == 1 and not isinstance(raw.columns, pd.MultiIndex):
            raw = pd.concat({chunk[0]: raw}, axis=1)
        frames.append(raw)

    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, axis=1)
    if combined.index.has_duplicates:
        combined = combined.loc[~combined.index.duplicated(keep="last")]
    if combined.columns.has_duplicates:
        combined = combined.loc[:, ~combined.columns.duplicated(keep="first")]
    return combined.sort_index()


def _load_history(tickers: list[str]):
    """Download (or reuse cached) 1y daily OHLCV for the universe + benchmark."""
    want = sorted(set(t for t in tickers if t) | {BENCHMARK})
    key = tuple(want)
    cached = _cache_get(_history_cache, key, _HISTORY_TTL)
    if cached is not None:
        return cached
    frame = _chunked_download(want)
    _cache_set(_history_cache, key, frame)
    return frame


def _ticker_frame(hist: pd.DataFrame, ticker: str):
    """Pull one ticker's OHLCV out of the grouped download frame."""
    if hist is None or hist.empty or not isinstance(hist.columns, pd.MultiIndex):
        return None
    if ticker not in hist.columns.get_level_values(0):
        return None
    try:
        sub = hist[ticker].dropna(how="all")
    except (KeyError, IndexError):
        return None
    if sub.empty or "Close" not in sub.columns:
        return None
    return sub


def _benchmark_returns(hist: pd.DataFrame):
    sub = _ticker_frame(hist, BENCHMARK)
    if sub is None:
        return None
    close = sub["Close"].dropna()
    if len(close) < 30:
        return None
    return np.log(close / close.shift(1)).dropna()


def _compute_technicals(sub: pd.DataFrame, bench_ret, lookback_days: int) -> dict | None:
    """Per-ticker price metrics. Returns None when history is too thin."""
    close = sub["Close"].dropna()
    if len(close) < 60:
        return None

    price = _num(close.iloc[-1])
    if not price or price <= 0:
        return None

    log_ret = np.log(close / close.shift(1)).dropna()
    # Baseline vol comes from before the window — see window_stretch.
    ws = window_stretch(log_ret, lookback_days)
    if ws is None:
        return None
    n = ws["n"]
    window_log_ret = ws["window_log_ret"]
    window_pct = ws["window_pct"]
    sigma_d = ws["sigma_d"]
    expected_move_pct = ws["expected_move_pct"]
    stretch_sigma = ws["stretch_sigma"]

    # Drawdown from the 52-week high, and how many sigma that drop represents
    # over the number of sessions it actually took.
    week52_high = _num(close.max())
    week52_low = _num(close.min())
    drawdown_pct = ((price - week52_high) / week52_high * 100.0) if week52_high else None
    high_idx = int(close.values.argmax())
    days_since_high = max(1, len(close) - 1 - high_idx)
    dd_stretch = None
    if week52_high and week52_high > 0:
        dd_stretch = -math.log(price / week52_high) / (sigma_d * math.sqrt(days_since_high))

    # Beta vs the benchmark, then the part of the drop the market does not explain.
    beta = None
    excess_drop_pct = None
    if bench_ret is not None:
        joined = pd.concat([log_ret, bench_ret], axis=1, join="inner").dropna()
        if len(joined) >= 60:
            stock_r = joined.iloc[:, 0]
            bench_r = joined.iloc[:, 1]
            var_b = _num(bench_r.var())
            if var_b and var_b > 0:
                beta = _num(stock_r.cov(bench_r) / var_b)
            if beta is not None and len(bench_r) >= n:
                bench_window = (math.exp(float(bench_r.iloc[-n:].sum())) - 1.0) * 100.0
                excess_drop_pct = window_pct - beta * bench_window

    sma_20 = _num(close.rolling(20).mean().iloc[-1]) if len(close) >= 20 else None
    sma_50 = _num(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None
    sma_200 = _num(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None

    high_s = sub["High"] if "High" in sub.columns else close
    low_s = sub["Low"] if "Low" in sub.columns else close
    atr14 = _atr(high_s.dropna(), low_s.dropna(), close)
    atr_below_sma50 = None
    if atr14 and atr14 > 0 and sma_50:
        atr_below_sma50 = (sma_50 - price) / atr14

    # Realized vol: 30d for the IV comparison, 1y for context.
    rv_30 = _num(log_ret.iloc[-30:].std() * math.sqrt(TRADING_DAYS)) if len(log_ret) >= 30 else None
    rv_252 = _num(log_ret.std() * math.sqrt(TRADING_DAYS))

    # Stabilization: is it still actively falling, or has it started to base?
    recent_low = _num(close.iloc[-3:].min())
    fresh_low = bool(week52_low and recent_low and recent_low <= week52_low * 1.005)
    low_10 = _num(close.iloc[-10:].min())
    bounce_off_low_pct = ((price - low_10) / low_10 * 100.0) if low_10 else None
    above_52w_low_pct = ((price - week52_low) / week52_low * 100.0) if week52_low else None

    decel_pp = None
    if len(log_ret) >= 10:
        last5 = (math.exp(float(log_ret.iloc[-5:].sum())) - 1.0) * 100.0
        prior5 = (math.exp(float(log_ret.iloc[-10:-5].sum())) - 1.0) * 100.0
        decel_pp = last5 - prior5

    vol_s = sub["Volume"].dropna() if "Volume" in sub.columns else None
    avg_volume = _num(vol_s.iloc[-30:].mean()) if vol_s is not None and len(vol_s) else None
    avg_dollar_volume = (avg_volume * price) if avg_volume else None

    return {
        "price": price,
        "window_pct": window_pct,
        "expected_move_pct": expected_move_pct,
        "stretch_sigma": stretch_sigma,
        "drawdown_pct": drawdown_pct,
        "dd_stretch_sigma": dd_stretch,
        "days_since_high": days_since_high,
        "week52_high": week52_high,
        "week52_low": week52_low,
        "beta": beta,
        "excess_drop_pct": excess_drop_pct,
        "rsi_14": _wilder_rsi(close),
        "sma_20": sma_20,
        "sma_50": sma_50,
        "sma_200": sma_200,
        "atr_14": atr14,
        "atr_below_sma50": atr_below_sma50,
        "rv_30": rv_30,
        "rv_252": rv_252,
        "fresh_low": fresh_low,
        "bounce_off_low_pct": bounce_off_low_pct,
        "above_52w_low_pct": above_52w_low_pct,
        "decel_pp": decel_pp,
        "avg_volume": avg_volume,
        "avg_dollar_volume": avg_dollar_volume,
    }


# ---------------------------------------------------------------------------
# Stage 2 - fundamentals
# ---------------------------------------------------------------------------

def _next_earnings_date(tk) -> str | None:
    today = date.today()
    try:
        cal = tk.calendar
    except Exception:
        cal = None
    candidates = []
    if isinstance(cal, dict):
        raw = cal.get("Earnings Date") or cal.get("earningsDate") or []
        candidates = raw if isinstance(raw, (list, tuple)) else [raw]
    elif isinstance(cal, pd.DataFrame) and not cal.empty:
        try:
            candidates = list(cal.loc["Earnings Date"].values)
        except (KeyError, IndexError):
            candidates = []
    for c in candidates:
        try:
            d = pd.Timestamp(c).date()
        except (ValueError, TypeError):
            continue
        if d >= today:
            return d.isoformat()

    try:
        ed = tk.earnings_dates
        if ed is not None and not ed.empty:
            upcoming = [pd.Timestamp(i).date() for i in ed.index]
            future = sorted(d for d in upcoming if d >= today)
            if future:
                return future[0].isoformat()
    except Exception:
        pass
    return None


def _fetch_fundamentals(ticker: str) -> dict:
    cached = _cache_get(_info_cache, ticker, _INFO_TTL)
    if cached is not None:
        return cached

    out = {
        "name": None, "sector": None, "industry": None, "market_cap": None,
        "trailing_eps": None, "profit_margin": None, "debt_to_equity": None,
        "current_ratio": None, "forward_pe": None, "trailing_pe": None,
        "return_on_equity": None, "return_on_assets": None,
        "revenue_growth": None, "earnings_growth": None,
        "dividend_yield": None, "target_mean_price": None, "quote_type": None,
        "next_earnings": None, "total_assets": None, "category": None,
        "fund_family": None, "expense_ratio": None,
        # Dividend detail. The put screen only needs the yield for the carry
        # term, but the covered-call screen needs the dates and the per-payment
        # amount to judge early assignment, and both share this cache.
        "dividend_rate": None, "trailing_annual_dividend_rate": None,
        "last_dividend_value": None, "ex_dividend_date": None,
        "last_dividend_date": None,
    }
    try:
        tk = yf.Ticker(ticker)
        info = tk.info or {}
        out.update({
            "name": info.get("shortName") or info.get("longName"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "market_cap": _num(info.get("marketCap")),
            "trailing_eps": _num(info.get("trailingEps")),
            "profit_margin": _num(info.get("profitMargins")),
            "debt_to_equity": _num(info.get("debtToEquity")),
            "current_ratio": _num(info.get("currentRatio")),
            "return_on_equity": _num(info.get("returnOnEquity")),
            "return_on_assets": _num(info.get("returnOnAssets")),
            "revenue_growth": _num(info.get("revenueGrowth")),
            "earnings_growth": _num(info.get("earningsGrowth")),
            "forward_pe": _num(info.get("forwardPE")),
            "trailing_pe": _num(info.get("trailingPE")),
            "dividend_yield": _num(info.get("dividendYield")),
            "dividend_rate": _num(info.get("dividendRate")),
            "trailing_annual_dividend_rate": _num(info.get("trailingAnnualDividendRate")),
            "last_dividend_value": _num(info.get("lastDividendValue")),
            "ex_dividend_date": _ts_to_iso(info.get("exDividendDate")),
            "last_dividend_date": _ts_to_iso(info.get("lastDividendDate")),
            "target_mean_price": _num(info.get("targetMeanPrice")),
            "quote_type": info.get("quoteType"),
            # Funds report size as AUM; marketCap comes back empty for them.
            "total_assets": _num(info.get("totalAssets")),
            "category": info.get("category"),
            "fund_family": info.get("fundFamily"),
            "expense_ratio": _num(
                info.get("netExpenseRatio")
                if info.get("netExpenseRatio") is not None
                else info.get("annualReportExpenseRatio")
            ),
        })
        # A fund has no earnings report, and the lookup is the slowest call here.
        if not _is_fund(out, ticker):
            out["next_earnings"] = _next_earnings_date(tk)
    except Exception:
        pass

    _cache_set(_info_cache, ticker, out)
    return out


def _fetch_fundamentals_bulk(tickers: list[str], workers: int = 8) -> dict[str, dict]:
    results: dict[str, dict] = {}
    if not tickers:
        return results
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for ticker, data in zip(tickers, pool.map(_fetch_fundamentals, tickers)):
            results[ticker] = data
    return results


# ---------------------------------------------------------------------------
# Stage 3 - put chain and the suggested strike
# ---------------------------------------------------------------------------

def _load_put_chain(ticker: str, expiration: str, spot: float, div_yield: float) -> list[dict]:
    """Puts plus a cached call-side companion for 25-delta skew metrics."""
    key = (ticker, expiration)
    cached = _cache_get(_put_chain_cache, key, _CHAIN_TTL)
    if cached is not None:
        return cached

    try:
        chain = yf.Ticker(ticker).option_chain(expiration)
    except Exception:
        _cache_set(_put_chain_cache, key, [])
        _cache_set(_put_skew_call_cache, key, [])
        return []

    dte = max((datetime.strptime(expiration, "%Y-%m-%d").date() - date.today()).days, 0)
    T = max(dte, 0.25) / 365.0

    def rows_for(frame, option_type):
        rows = []
        for _, r in frame.iterrows():
            strike = _num(r.get("strike"))
            if not strike or strike <= 0:
                continue
            bid = _num(r.get("bid"), 0.0) or 0.0
            ask = _num(r.get("ask"), 0.0) or 0.0
            last = _num(r.get("lastPrice"), 0.0) or 0.0
            iv = _num(r.get("impliedVolatility"), 0.0) or 0.0
            mid = (bid + ask) / 2.0 if (bid > 0 and ask > 0) else last
            delta = None
            if iv > 0 and spot > 0:
                try:
                    delta = _num(
                        black_scholes(
                            spot, strike, T, RISK_FREE, div_yield, iv, option_type
                        ).get("delta")
                    )
                except Exception:
                    delta = None
            rows.append({
                "strike": strike,
                "bid": bid,
                "ask": ask,
                "last": last,
                "mid": mid,
                "iv": iv,
                "delta": delta,
                "volume": int(_num(r.get("volume"), 0) or 0),
                "open_interest": int(_num(r.get("openInterest"), 0) or 0),
                "dte": dte,
            })
        return rows

    puts = rows_for(getattr(chain, "puts", pd.DataFrame()), "put")
    calls = rows_for(getattr(chain, "calls", pd.DataFrame()), "call")
    _cache_set(_put_chain_cache, key, puts)
    _cache_set(_put_skew_call_cache, key, calls)
    return puts


def _load_put_skew_calls(ticker: str, expiration: str) -> list[dict]:
    """Return calls side-loaded by ``_load_put_chain`` without another request."""
    return _cache_get(_put_skew_call_cache, (ticker, expiration), _CHAIN_TTL) or []


def _prepare_option_quote(
    leg: dict,
    *,
    option_type: str,
    spot: float,
    dte: int,
    dividend_yield: float,
) -> dict | None:
    """Make a live quote or recent-session last trade usable for screening.

    Yahoo commonly clears bid/ask after the close while retaining that day's
    last trade and volume. Live two-sided quotes always take priority. A last
    trade is accepted only when the contract reports positive current-session
    volume, and its IV/delta are recomputed so placeholder after-hours IVs do
    not distort strike selection. The caller labels this as a non-live estimate.
    """
    if option_type not in {"put", "call"}:
        raise ValueError(f"Unsupported option type: {option_type}")

    prepared = dict(leg)
    bid = _num(prepared.get("bid"), 0.0) or 0.0
    ask = _num(prepared.get("ask"), 0.0) or 0.0
    mid = _num(prepared.get("mid"), 0.0) or 0.0
    if bid > 0 and ask >= bid and mid > 0:
        prepared["quote_source"] = "live_bid_ask"
        return prepared

    volume = int(_num(prepared.get("volume"), 0) or 0)
    strike = _num(prepared.get("strike"))
    if (
        mid <= 0
        or volume <= 0
        or strike is None
        or strike <= 0
        or spot <= 0
        or dte <= 0
    ):
        return None

    years = dte / 365.0
    volatility = implied_vol(
        mid,
        spot,
        strike,
        years,
        RISK_FREE,
        dividend_yield,
        option_type,
    )
    if volatility is None or not 0.005 <= volatility <= 5.0:
        return None
    modeled = black_scholes(
        spot,
        strike,
        years,
        RISK_FREE,
        dividend_yield,
        volatility,
        option_type,
    )
    delta = _num(modeled.get("delta"))
    if delta is None:
        return None

    prepared.update({
        "iv": volatility,
        "delta": delta,
        "quote_source": "last_trade_estimate",
    })
    return prepared


def _prepare_put_quote(
    leg: dict,
    *,
    spot: float,
    dte: int,
    dividend_yield: float,
) -> dict | None:
    """Put-specific wrapper retained for scanner and test call sites."""
    return _prepare_option_quote(
        leg,
        option_type="put",
        spot=spot,
        dte=dte,
        dividend_yield=dividend_yield,
    )


def _pick_expiration(expirations: list[str], target_dte: int, min_dte: int, max_dte: int,
                     expire_before: date | None = None):
    """Expiration nearest the target DTE inside the window.

    When `expire_before` is set (the earnings cutoff), expirations that land on
    or after it are only used if nothing in the window clears the date — selling
    a put through an earnings report is a different trade than the screen
    intends. Returns (expiration, dte, cleared_cutoff).
    """
    today = date.today()
    clearing, any_valid = [], []
    for exp in expirations:
        try:
            exp_d = datetime.strptime(exp, "%Y-%m-%d").date()
        except ValueError:
            continue
        d = (exp_d - today).days
        if d < min_dte or d > max_dte:
            continue
        entry = (abs(d - target_dte), exp, d)
        any_valid.append(entry)
        if expire_before is None or exp_d < expire_before:
            clearing.append(entry)

    pool = clearing or any_valid
    if not pool:
        return None, None, False
    best = min(pool, key=lambda e: e[0])
    return best[1], best[2], bool(clearing)


def _earnings_within_target_window(
    earnings_date,
    target_dte: int,
    buffer_days: int = 0,
    *,
    as_of: date | None = None,
) -> bool:
    """True when a report conflicts with the requested trade horizon.

    The Target DTE control is a trade-horizon decision, not permission to
    substitute a near-expiration contract.  When the earnings skip is enabled,
    a stock with a report inside that horizon (plus the safety buffer) is
    removed before any option-chain lookup.
    """
    earnings_d = _parse_date(earnings_date)
    if not earnings_d:
        return False
    days = (earnings_d - (as_of or date.today())).days
    return 0 <= days <= max(0, int(target_dte)) + max(0, int(buffer_days))


def _suggest_put(ticker: str, spot: float, div_yield: float, target_dte: int,
                 target_delta: float, min_dte: int, max_dte: int,
                 earnings_date: str | None = None, earnings_buffer_days: int = 5,
                 fallback_vol: float | None = None) -> dict | None:
    """Best short-put candidate: nearest the target delta, with real quotes.

    Prefers an expiration that closes before the next earnings report (with a
    buffer), so the position is not held through the announcement.
    """
    try:
        expirations = list(yf.Ticker(ticker).options or [])
    except Exception:
        return None

    cutoff = None
    earnings_d = _parse_date(earnings_date)
    if earnings_d:
        cutoff = earnings_d - timedelta(days=max(0, earnings_buffer_days))

    expiration, dte, cleared = _pick_expiration(
        expirations, target_dte, min_dte, max_dte, expire_before=cutoff,
    )
    if not expiration:
        return None

    puts = _load_put_chain(ticker, expiration, spot, div_yield)
    calls = _load_put_skew_calls(ticker, expiration)
    prepared_puts = [
        prepared
        for leg in puts
        if (
            prepared := _prepare_put_quote(
                leg,
                spot=spot,
                dte=dte,
                dividend_yield=div_yield,
            )
        ) is not None
    ]
    if not prepared_puts:
        return None

    # Prefer executable two-sided markets. When Yahoo has cleared the entire
    # chain after hours, retain recent traded contracts as estimates instead of
    # disabling every scanner handoff.
    live_tradable = [
        p for p in prepared_puts
        if p["strike"] < spot
        and p["mid"] > 0
        and p.get("quote_source") == "live_bid_ask"
    ]
    estimated_tradable = [
        p for p in prepared_puts
        if p["strike"] < spot
        and p["mid"] > 0
        and p.get("quote_source") == "last_trade_estimate"
    ]
    tradable = live_tradable or estimated_tradable
    if not tradable:
        return None

    with_delta = [p for p in tradable if p["delta"] is not None]
    if with_delta:
        pick = min(with_delta, key=lambda p: abs(abs(p["delta"]) - target_delta))
    else:
        # Preserve the requested delta's time scaling even when the chain has
        # no usable IV/delta rather than falling back to a fixed percent OTM.
        want = strike_for_delta(spot, target_delta, fallback_vol, dte, "put") or spot
        pick = min(tradable, key=lambda p: abs(p["strike"] - want))

    # At-the-money IV drives the IV/RV comparison, not the OTM strike's skew.
    atm = min(prepared_puts, key=lambda p: abs(p["strike"] - spot))
    atm_iv = atm["iv"] if atm["iv"] > 0 else pick["iv"]
    skew_metrics = calculate_skew_metrics(puts, calls)

    strike = pick["strike"]
    mid = pick["mid"]
    dte_eff = max(dte or 1, 1)
    premium_yield = mid / strike * 100.0
    annualized = premium_yield * (365.0 / dte_eff)
    effective_basis = strike - mid
    spread_pct = (
        _quoted_spread_pct(pick["bid"], pick["ask"], pick["mid"])
        if pick.get("quote_source") == "live_bid_ask" else None
    )

    return {
        "expiration": expiration,
        "dte": dte,
        "strike": strike,
        "bid": pick["bid"],
        "ask": pick["ask"],
        "mid": mid,
        "iv": pick["iv"],
        "atm_iv": atm_iv,
        "delta": pick["delta"],
        "prob_otm": (1.0 - abs(pick["delta"])) * 100.0 if pick["delta"] is not None else None,
        "open_interest": pick["open_interest"],
        "volume": pick["volume"],
        "total_option_volume": sum(
            int(_num(leg.get("volume"), 0) or 0) for leg in puts
        ) + sum(int(_num(leg.get("volume"), 0) or 0) for leg in calls),
        **skew_metrics,
        "spread_pct": spread_pct,
        "quote_source": pick.get("quote_source", "live_bid_ask"),
        "premium_yield_pct": premium_yield,
        "annualized_pct": annualized,
        "cash_required": strike * 100.0,
        "premium_dollars": mid * 100.0,
        "effective_basis": effective_basis,
        "discount_to_spot_pct": (spot - effective_basis) / spot * 100.0 if spot else None,
        "otm_pct": (spot - strike) / spot * 100.0 if spot else None,
        # Earnings handling for this specific expiration.
        "earnings_date": earnings_d.isoformat() if earnings_d else None,
        "avoids_earnings": cleared if earnings_d else None,
        "days_earnings_after_expiry": (
            (earnings_d - datetime.strptime(expiration, "%Y-%m-%d").date()).days
            if earnings_d else None
        ),
    }


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
# Named so the partial-score denominator stays in step with what the chain
# actually contributes. Premium is the only axis that needs a live chain, so a
# row without one is rated on the other 75 points.
PREMIUM_MAX = 25.0


def score_candidate(tech: dict, fund: dict, put: dict | None,
                    earnings_buffer_days: int = 5) -> dict:
    """Rate a name as a short-put candidate on four independent axes.

    Dislocation  (30) - has it fallen further than its own vol justifies?
    Premium      (25) - are option sellers being paid above fair value?
    Quality      (25) - is this a business worth being assigned?
    Stabilization(20) - has the fall stopped, or is it still a falling knife?
    """
    flags: list[str] = []

    # ── Dislocation ───────────────────────────────────────────────────────
    dislocation = 0.0
    dislocation += _ramp(tech.get("stretch_sigma"), 1.0, 3.0, 15)
    dislocation += _ramp(-(tech.get("drawdown_pct") or 0.0), 10, 35, 8)
    # excess_drop_pct is negative when the stock fell more than beta predicts.
    excess = tech.get("excess_drop_pct")
    dislocation += _ramp(-(excess if excess is not None else 0.0), 3, 20, 7)

    # ── Premium ───────────────────────────────────────────────────────────
    premium = 0.0
    iv_rv = None
    iv_rank = None
    if put:
        atm_iv = _num(put.get("atm_iv"))
        rv30 = _num(tech.get("rv_30")) or _num(tech.get("rv_252"))
        if atm_iv and rv30 and rv30 > 0:
            iv_rv = atm_iv / rv30
            premium += _ramp(iv_rv, 1.0, 1.6, 14)
        rv252 = _num(tech.get("rv_252"))
        if atm_iv and rv252 and rv252 > 0:
            # No historical IV series available, so rank current IV against the
            # stock's own realized vol as a stand-in for an IV percentile.
            iv_rank = min(100.0, max(0.0, (atm_iv / rv252 - 0.7) / 0.9 * 100.0))
            premium += _ramp(iv_rank, 30, 80, 6)
        premium += _ramp(put.get("annualized_pct"), 8, 30, 5)

        if (put.get("spread_pct") or 0) > 25:
            flags.append("Wide bid/ask spread")
        if (put.get("open_interest") or 0) < 50:
            flags.append("Thin open interest")
        if put.get("quote_source") == "last_trade_estimate":
            flags.append("Recent trade estimate — no live bid/ask")

    # ── Quality ───────────────────────────────────────────────────────────
    # Same 25-point budget for both, but a fund has no earnings or balance
    # sheet to judge. Breadth of holdings replaces profitability, because that
    # is what actually decides whether being assigned is survivable.
    quality = 0.0
    ticker = tech.get("ticker") or ""
    is_fund = _is_fund(fund, ticker)
    fund_kind = _fund_kind(ticker, fund) if is_fund else None
    size = _fund_size(fund) or 0.0

    if is_fund:
        # Size (8) — AUM, since funds report no market cap.
        if size >= 100e9:
            quality += 8
        elif size >= 20e9:
            quality += 7
        elif size >= 5e9:
            quality += 6
        elif size >= 1e9:
            quality += 4.5
        elif size >= 300e6:
            quality += 3
        else:
            quality += 1
            flags.append("Small fund")

        # Diversification (9) — how much single-name risk you inherit.
        if fund_kind == "index":
            quality += 9
        elif fund_kind == "sector":
            quality += 7
        elif fund_kind == "leveraged":
            quality += 0
            flags.append("Leveraged or inverse fund")
        else:
            quality += 4
    else:
        # Size (7)
        if size >= 200e9:
            quality += 7
        elif size >= 50e9:
            quality += 6
        elif size >= 10e9:
            quality += 5
        elif size >= 5e9:
            quality += 3.5
        elif size >= 2e9:
            quality += 2

        # Profitability (7)
        eps = _num(fund.get("trailing_eps"))
        margin = _num(fund.get("profit_margin"))
        if eps is not None and eps > 0 and margin is not None and margin > 0.10:
            quality += 7
        elif eps is not None and eps > 0 and margin is not None and margin > 0:
            quality += 5.5
        elif eps is not None and eps > 0:
            quality += 4
        elif margin is not None and margin > 0:
            quality += 3
        else:
            flags.append("Not profitable on trailing earnings")

        # Balance sheet (6)
        de = _num(fund.get("debt_to_equity"))
        bs = 0.0
        if de is None:
            bs = 3.0
        elif de < 50:
            bs = 5.0
        elif de < 100:
            bs = 4.0
        elif de < 200:
            bs = 3.0
        elif de < 300:
            bs = 1.5
        else:
            flags.append("Heavy debt load")
        cr = _num(fund.get("current_ratio"))
        if cr is not None and cr >= 1.2:
            bs += 1.0
        quality += min(6.0, bs)

    # Liquidity closes out the 25-point budget on both paths: 5 for a stock
    # (which also spent 6 on its balance sheet), 8 for a fund (which has none).
    # The totals must match or funds would rank low for a reason that is not
    # about the trade.
    adv = _num(tech.get("avg_dollar_volume")) or 0.0
    liq_max = 8.0 if is_fund else 5.0
    if adv >= 200e6:
        quality += liq_max
    elif adv >= 50e6:
        quality += liq_max * 0.8
    elif adv >= 20e6:
        quality += liq_max * 0.6
    elif adv >= 5e6:
        quality += liq_max * 0.3
    else:
        flags.append("Thin share liquidity")

    # ── Stabilization ─────────────────────────────────────────────────────
    stabilization = 0.0
    if tech.get("fresh_low"):
        flags.append("Making fresh 52-week lows")
    else:
        stabilization += 7
    stabilization += _ramp(tech.get("bounce_off_low_pct"), 0, 6, 5)
    stabilization += _ramp(tech.get("decel_pp"), 0, 8, 4)
    stabilization += _ramp(tech.get("above_52w_low_pct"), 2, 15, 4)

    price = _num(tech.get("price"))
    sma200 = _num(tech.get("sma_200"))
    if price and sma200 and price < sma200 * 0.85:
        flags.append("Far below the 200-day average")

    # ── Event risk ────────────────────────────────────────────────────────
    # Holding a short put through an earnings report is a different trade than
    # this screen intends: a single announcement can gap the stock straight
    # through the strike, and no amount of premium compensates for that.
    earnings_before_expiry = None
    earnings_date = _parse_date(fund.get("next_earnings"))
    expiry_date = _parse_date(put["expiration"]) if put else None
    if earnings_date and expiry_date:
        earnings_before_expiry = earnings_date <= expiry_date
        gap = (earnings_date - expiry_date).days
        if earnings_before_expiry:
            flags.append("Earnings before expiration")
            premium = max(0.0, premium - 6)   # the premium is not really free
        elif gap <= earnings_buffer_days:
            flags.append(f"Earnings {gap}d after expiry")

    total = dislocation + premium + quality + stabilization
    # Without a chain the premium axis cannot score; rate on the other 75 so a
    # missing chain does not silently look like a bad candidate. Such a name is
    # still less actionable than a priced one, so run_put_scan ranks it below
    # every candidate that did get a chain rather than letting the smaller
    # denominator float it to the top.
    scored_max = 100.0 if put else (100.0 - PREMIUM_MAX)
    normalized = total / scored_max * 100.0
    if put is None:
        flags.append("Option chain unavailable")

    if normalized >= 80:
        grade = "A"
    elif normalized >= 70:
        grade = "B"
    elif normalized >= 60:
        grade = "C"
    elif normalized >= 50:
        grade = "D"
    else:
        grade = "F"

    return {
        "score": round(normalized, 1),
        "grade": grade,
        "components": {
            "dislocation": round(dislocation, 1),
            "premium": round(premium, 1),
            "quality": round(quality, 1),
            "stabilization": round(stabilization, 1),
        },
        "component_max": {
            "dislocation": 30, "premium": 25, "quality": 25, "stabilization": 20,
        },
        "iv_rv_ratio": _round(iv_rv, 2),
        "iv_rank": _round(iv_rank, 0),
        "earnings_before_expiry": earnings_before_expiry,
        "days_to_earnings": (earnings_date - date.today()).days if earnings_date else None,
        "is_fund": is_fund,
        "fund_kind": fund_kind,
        "flags": flags,
        "scored_on_partial": put is None,
    }


def recommend_buyback(put: dict | None, rating: dict | None) -> dict | None:
    """Return a success-oriented buy-to-close target for a newly sold put.

    The target keeps a majority of the quoted credit while removing the
    remaining assignment and gamma risk before expiration. It is a transparent
    management heuristic, not an estimate of the probability that a specific
    target price will trade.
    """
    if not put:
        return None
    credit = _num(put.get("mid"))
    if credit is None or credit <= 0:
        return None

    rating = rating or {}
    score = _num(rating.get("score"), 0.0) or 0.0
    grade = str(rating.get("grade") or "")
    prob_otm = _num(put.get("prob_otm"))
    delta_raw = _num(put.get("delta"))
    delta = abs(delta_raw) if delta_raw is not None else 1.0
    dte_raw = _num(put.get("dte"))
    dte = max(1, int(dte_raw)) if dte_raw is not None else 1
    # `or 100.0` would be wrong here: a perfectly tight market quotes 0.0, and
    # treating that as a 100% spread demoted the best-quoted setups on the board
    # to "Defensive". Only a genuinely missing spread means "assume the worst".
    spread_pct = _num(put.get("spread_pct"))
    if spread_pct is None:
        spread_pct = 100.0
    open_interest = int(_num(put.get("open_interest"), 0) or 0)
    flags = set(rating.get("flags") or [])
    material_risk_flags = {
        "Making fresh 52-week lows",
        "Earnings before expiration",
        "Wide bid/ask spread",
        "Thin open interest",
        LOW_CONFIDENCE_SELECTED_FUND_FLAG,
    }
    has_material_risk = bool(flags & material_risk_flags)

    if (
        grade == "A"
        and score >= 80
        and prob_otm is not None
        and prob_otm >= 78
        and delta <= 0.22
        and dte >= 28
        and spread_pct <= 15
        and open_interest >= 200
        and not has_material_risk
    ):
        target_capture_pct = 70.0
        profile = "Strong setup"
        rationale = (
            "The high setup score, low delta, and liquid chain support waiting "
            "for 70% of the quoted credit before removing the remaining risk."
        )
    elif (
        grade in {"A", "B"}
        and score >= 70
        and prob_otm is not None
        and prob_otm >= 70
        and delta <= 0.30
        and not has_material_risk
    ):
        target_capture_pct = 65.0
        profile = "Balanced setup"
        rationale = (
            "A 65% profit target keeps nearly two-thirds of the credit while "
            "closing before the final premium carries disproportionate risk."
        )
    else:
        target_capture_pct = 60.0
        profile = "Defensive setup"
        rationale = (
            "The setup or chain carries added risk, so the target closes sooner "
            "after retaining 60% of the quoted credit."
        )

    target_price = max(0.01, round(credit * (1.0 - target_capture_pct / 100.0), 2))
    premium_kept_per_share = max(0.0, credit - target_price)
    actual_capture_pct = premium_kept_per_share / credit * 100.0
    reassess_dte = 21 if dte > 28 else max(7, int(round(dte * 0.5)))

    return {
        "target_price": round(target_price, 2),
        "profit_capture_pct": round(actual_capture_pct, 1),
        "premium_kept_dollars": round(premium_kept_per_share * 100.0, 0),
        "premium_returned_dollars": round(target_price * 100.0, 0),
        "entry_credit_basis": round(credit, 2),
        "reassess_dte": reassess_dte,
        "profile": profile,
        "rationale": rationale,
    }


def build_verdict(row: dict) -> str:
    """One line explaining why this name is (or is not) worth selling puts on."""
    tech, put = row, row.get("put") or {}
    stretch = _num(tech.get("stretch_sigma")) or 0.0
    drop = _num(tech.get("drawdown_pct")) or 0.0
    grade = row.get("grade")

    move = f"down {abs(drop):.0f}% from its 52-week high"
    sigma = f"{stretch:.1f}σ beyond its normal range"

    subject = {
        "index": "Broad index fund",
        "sector": "Sector fund",
        "leveraged": "Leveraged fund",
        "narrow": "Narrow fund",
    }.get(row.get("fund_kind") or "", "Quality name")

    if grade in ("A", "B"):
        lead = f"{subject} {move}, {sigma}"
    elif grade == "C":
        lead = f"{'Workable setup' if not row.get('is_fund') else subject + ', workable setup'} {move}, {sigma}"
    else:
        lead = f"{'Marginal setup' if not row.get('is_fund') else subject + ', marginal setup'} {move}, {sigma}"

    if row.get("candidate_status") == "lower_confidence":
        lead += ". It missed one or more selected underlying filters, so this is a lower-confidence trade"

    if put.get("annualized_pct") and put.get("strike"):
        lead += (
            f". Selling the {put['expiration']} ${put['strike']:g} put pays "
            f"{put['annualized_pct']:.0f}% annualized on cash"
        )
        if put.get("effective_basis"):
            lead += f", assigned basis ${put['effective_basis']:.2f}"
        buyback = put.get("buyback") or {}
        if buyback.get("target_price") is not None:
            lead += (
                f". Success-oriented exit: buy it back near "
                f"${buyback['target_price']:.2f} to retain about "
                f"{buyback['profit_capture_pct']:.0f}% of the quoted credit"
            )
    if "Making fresh 52-week lows" in (row.get("flags") or []):
        lead += ". Still falling — wait for a base"
    elif "Earnings before expiration" in (row.get("flags") or []):
        lead += ". Earnings land inside the trade"
    elif put.get("avoids_earnings") and put.get("days_earnings_after_expiry") is not None:
        lead += (
            f". This expiration closes {put['days_earnings_after_expiry']}d before "
            f"earnings on {put['earnings_date']}"
        )
    return lead + "."


# ---------------------------------------------------------------------------
# Universe resolution
# ---------------------------------------------------------------------------

def _clean_tickers(raw) -> list[str]:
    if isinstance(raw, str):
        raw = re.split(r"[\s,;]+", raw)
    out, seen = [], set()
    for t in raw or []:
        if t is None:
            continue
        s = str(t).strip().upper()
        if s and s not in seen and len(s) <= 10:
            seen.add(s)
            out.append(s)
    return out


def _index_only_tickers(raw, defaults, limit: int = 50) -> list[str]:
    """Normalize an index-only universe and reject stock symbols explicitly."""
    tickers = _clean_tickers(raw)
    invalid = [ticker for ticker in tickers if ticker not in INDEX_ETF_SET]
    if invalid:
        raise ValueError(
            "This long-dated structure is limited to index ETFs; remove stock "
            f"symbols: {', '.join(invalid)}"
        )
    return (tickers or list(defaults))[:limit]


def _profile_scope(profile_id, aggregate_id):
    """Mirror the app's profile/aggregate selection for holdings lookups."""
    conn = get_connection()
    try:
        ids = []
        if aggregate_id:
            rows = conn.execute(
                "SELECT member_profile_id FROM aggregate_config WHERE aggregate_id = ? "
                "ORDER BY member_profile_id",
                (aggregate_id,),
            ).fetchall()
            ids = [r[0] for r in rows]
        if not ids:
            ids = [profile_id or 1]
        placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"SELECT DISTINCT ticker FROM holdings WHERE profile_id IN ({placeholders}) "
            "AND quantity > 0 ORDER BY ticker",
            ids,
        ).fetchall()
        return [r[0] for r in rows]
    finally:
        conn.close()


def _watchlist_tickers():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT DISTINCT ticker FROM watchlist_watching ORDER BY ticker"
        ).fetchall()
        return [r[0] for r in rows]
    finally:
        conn.close()


def resolve_universe(name: str, custom, profile_id=None, aggregate_id=None) -> list[str]:
    if name == "custom":
        return _clean_tickers(custom)
    if name == "holdings":
        return _clean_tickers(_profile_scope(profile_id, aggregate_id))
    if name == "watchlist":
        return _clean_tickers(_watchlist_tickers())
    choice = UNIVERSE_CHOICES.get(name) or UNIVERSE_CHOICES["large_cap"]
    return _clean_tickers(choice["tickers"])


def resolve_index_etfs(raw) -> list[str]:
    """Resolve an optional index subset; blank means the complete index list."""
    selected = _clean_tickers(raw)
    return selected or list(INDEX_ETF_UNIVERSE)


def resolve_scan_universe(p: dict) -> list[str]:
    """Union of the enabled groups.

    Each group is independent, so an index-only scan really does download only
    the index ETFs — unchecking stocks skips the whole stock universe rather
    than filtering it out afterwards.
    """
    tickers: list[str] = []
    if p.get("include_stocks", True):
        tickers += resolve_universe(
            p.get("universe") or "large_cap", p.get("custom_tickers"),
            profile_id=p.get("profile_id"), aggregate_id=p.get("aggregate_id"),
        )
    if p.get("include_index_etfs"):
        tickers += resolve_index_etfs(p.get("index_tickers"))
    if p.get("include_sector_etfs"):
        tickers += SECTOR_ETF_UNIVERSE
    if p.get("include_commodity_etfs"):
        tickers += COMMODITY_ETF_UNIVERSE
    if p.get("include_selected_funds"):
        tickers += _clean_tickers(p.get("selected_fund_tickers"))
    return _clean_tickers(tickers)


# ---------------------------------------------------------------------------
# The scan
# ---------------------------------------------------------------------------

DEFAULTS = {
    "universe": "large_cap",
    # Independent groups. An index-only scan skips the stock universe entirely
    # rather than downloading it and filtering afterwards.
    "include_stocks": True,
    "include_index_etfs": False,
    "include_sector_etfs": False,
    "include_commodity_etfs": False,
    # A short, user-selected universe such as SPY, QQQ, IWM, GLD.  These are
    # independent of the broad ETF groups above, so a user can scan exactly
    # the funds they name.
    "include_selected_funds": False,
    "selected_fund_tickers": [],
    "include_lower_confidence_selected_funds": True,
    "lookback_days": 21,
    "min_market_cap": 10e9,
    "min_drop_pct": 12.0,
    "min_stretch_sigma": 1.5,
    # Funds need their own floors. SPY almost never falls 12% from its high, so
    # sharing the stock thresholds would leave the ETF list permanently empty.
    # The sigma stretch still does the real work — a 6% drop on a low-vol index
    # can be just as many standard deviations as a 25% drop on a semiconductor.
    "fund_min_drop_pct": 5.0,
    "fund_min_stretch_sigma": 1.5,
    "fund_min_aum": 300e6,
    "exclude_leveraged_funds": True,
    "max_rsi": 45.0,
    "min_avg_dollar_volume": 20e6,
    "require_profitable": True,
    "exclude_fresh_lows": True,
    # On by default: an earnings report inside the trade is the event this
    # screen most wants to avoid, so candidates that cannot dodge it are cut.
    "exclude_earnings_before_expiry": True,
    "earnings_buffer_days": 5,
    "target_dte": 35,
    # Target DTE is user-controlled, so the implicit API window must not cap it.
    # Explicit callers can still provide narrower min/max bounds when needed.
    "min_dte": MIN_TARGET_DTE,
    "max_dte": MAX_TARGET_DTE,
    "target_delta": 0.25,
    "chain_limit": 20,
    "max_results": 40,
}


def run_put_scan(payload: dict) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in (payload or {}).items() if v is not None}}

    lookback = max(5, min(126, int(_num(p["lookback_days"], 21))))
    min_cap = max(0.0, _num(p["min_market_cap"], 0.0) or 0.0)
    min_drop = _num(p["min_drop_pct"], 0.0) or 0.0
    min_stretch = _num(p["min_stretch_sigma"], 0.0) or 0.0
    fund_min_drop = _num(p["fund_min_drop_pct"], 0.0) or 0.0
    fund_min_stretch = _num(p["fund_min_stretch_sigma"], 0.0) or 0.0
    fund_min_aum = max(0.0, _num(p["fund_min_aum"], 0.0) or 0.0)
    max_rsi = _num(p["max_rsi"], 100.0) or 100.0
    min_adv = _num(p["min_avg_dollar_volume"], 0.0) or 0.0
    target_dte = max(
        MIN_TARGET_DTE,
        min(MAX_TARGET_DTE, int(_num(p["target_dte"], 35))),
    )
    min_dte = max(MIN_TARGET_DTE, int(_num(p["min_dte"], MIN_TARGET_DTE)))
    max_dte = max(min_dte, int(_num(p["max_dte"], MAX_TARGET_DTE)))
    target_delta = min(0.9, max(0.01, _num(p["target_delta"], 0.25) or 0.25))
    earnings_buffer = max(0, min(30, int(_num(p["earnings_buffer_days"], 5))))
    chain_limit = max(0, min(60, int(_num(p["chain_limit"], 20))))
    max_results = max(1, min(200, int(_num(p["max_results"], 40))))

    tickers = resolve_scan_universe(p)
    selected_fund_tickers = set(_clean_tickers(p.get("selected_fund_tickers"))) \
        if p.get("include_selected_funds") else set()
    allow_lower_confidence_selected_funds = bool(
        selected_fund_tickers
        and p.get("include_lower_confidence_selected_funds", True)
    )
    if not tickers:
        return {
            "rows": [], "stats": {"universe": 0, "priced": 0, "passed_price": 0, "final": 0},
            "params": p,
            "error": "Nothing selected to scan. Enable stocks, index ETFs, sector ETFs, or commodity ETFs.",
        }
    # A ticker from the curated ETF lists is known to be a fund before any
    # network call, so the price stage can apply the right thresholds up front.
    etf_hint = INDEX_ETF_SET | SECTOR_ETF_SET | COMMODITY_ETF_SET

    hist = _load_history(tickers)
    if hist is None or hist.empty:
        return {
            "rows": [], "stats": {"universe": len(tickers), "priced": 0, "passed_price": 0, "final": 0},
            "params": p, "error": "Price history unavailable. Yahoo may be rate-limiting; try again shortly.",
        }

    bench_ret = _benchmark_returns(hist)

    priced, price_pass, lower_confidence_price = 0, [], []
    for ticker in tickers:
        sub = _ticker_frame(hist, ticker)
        if sub is None:
            continue
        tech = _compute_technicals(sub, bench_ret, lookback)
        if tech is None:
            continue
        priced += 1

        # A curated ticker is known to be a fund (or a company) before any network
        # call, so the right floor can be applied here. Anything else — a holding,
        # a watchlist name, a custom ticker — is unknown until `.info` comes back
        # in stage 2, and gating it on the stock floors silently dropped every ETF
        # a user actually holds: SCHD or JEPI almost never falls 12% from its high,
        # so a holdings scan quietly hid the whole fund side of the portfolio.
        # Unknown tickers therefore clear the *looser* of the two floors here and
        # are re-checked against the correct one once _is_fund can answer.
        drop = -(tech.get("drawdown_pct") or 0.0)
        stretch = tech.get("stretch_sigma") or 0.0
        if ticker in etf_hint:
            drop_floor, stretch_floor = fund_min_drop, fund_min_stretch
        elif ticker in CURATED_STOCK_SET:
            drop_floor, stretch_floor = min_drop, min_stretch
        else:
            drop_floor = min(min_drop, fund_min_drop)
            stretch_floor = min(min_stretch, fund_min_stretch)
        passes_price_screen = drop >= drop_floor and stretch >= stretch_floor
        rsi = tech.get("rsi_14")
        passes_price_screen = passes_price_screen and (
            rsi is None or rsi <= max_rsi
        )
        passes_price_screen = passes_price_screen and (
            (tech.get("avg_dollar_volume") or 0.0) >= min_adv
        )
        passes_price_screen = passes_price_screen and not (
            p["exclude_fresh_lows"] and tech.get("fresh_low")
        )
        tech["ticker"] = ticker
        if passes_price_screen:
            price_pass.append(tech)
        elif (
            allow_lower_confidence_selected_funds
            and ticker in selected_fund_tickers
        ):
            # This is a deliberately small, user-selected universe.  Let the
            # full score and the option market describe the trade rather than
            # hiding it behind a binary technical gate.
            lower_confidence_price.append(tech)

    # Rank the price stage so the expensive stages only touch the best names.
    price_pass.sort(key=lambda t: -(t.get("stretch_sigma") or 0.0))
    lower_confidence_price.sort(
        key=lambda t: -(t.get("stretch_sigma") or 0.0)
    )
    fundamentals = _fetch_fundamentals_bulk([
        t["ticker"] for t in price_pass + lower_confidence_price
    ])

    survivors = []
    lower_confidence_price_tickers = {
        tech["ticker"] for tech in lower_confidence_price
    }
    for tech in price_pass + lower_confidence_price:
        ticker = tech["ticker"]
        fund = fundamentals.get(ticker, {})
        is_fund = _is_fund(fund, ticker)
        lower_confidence = ticker in lower_confidence_price_tickers
        drop = -(tech.get("drawdown_pct") or 0.0)
        stretch = tech.get("stretch_sigma") or 0.0
        selected_fund_fallback = (
            allow_lower_confidence_selected_funds
            and ticker in selected_fund_tickers
            and is_fund
            and _fund_kind(ticker, fund) != "leveraged"
        )

        # A fund reports AUM, not a market cap, and has no earnings or margins
        # to be profitable with — applying the stock gates would drop them all.
        # The drop/stretch floors are re-applied here because the price stage can
        # only guess at which set a non-curated ticker belongs to.
        if is_fund:
            misses_fund_filters = (
                drop < fund_min_drop
                or stretch < fund_min_stretch
                or (
                    fund_min_aum
                    and (_num(fund.get("total_assets")) or 0.0) < fund_min_aum
                )
            )
            if (
                p["exclude_leveraged_funds"]
                and _fund_kind(ticker, fund) == "leveraged"
            ):
                continue
            if misses_fund_filters:
                if not selected_fund_fallback:
                    continue
                lower_confidence = True
        else:
            if drop < min_drop or stretch < min_stretch:
                continue
            if min_cap and (_num(fund.get("market_cap")) or 0.0) < min_cap:
                continue
            if p["require_profitable"]:
                eps = _num(fund.get("trailing_eps"))
                margin = _num(fund.get("profit_margin"))
                profitable = (eps is not None and eps > 0) or (margin is not None and margin > 0)
                if not profitable:
                    continue
        survivors.append((tech, fund, lower_confidence))

    # Keep the funnel truthful: selected-fund fallbacks are deliberately shown
    # despite missing the normal screen, not counted as having passed it.
    passed_fundamentals = sum(1 for _, _, lower in survivors if not lower)
    dropped_for_earnings = 0
    if p["exclude_earnings_before_expiry"]:
        kept = []
        for tech, fund, lower_confidence in survivors:
            if (
                not _is_fund(fund, tech["ticker"])
                and _earnings_within_target_window(
                    fund.get("next_earnings"), target_dte, earnings_buffer
                )
            ):
                dropped_for_earnings += 1
                continue
            kept.append((tech, fund, lower_confidence))
        survivors = kept

    # Provisional score without the chain, to choose who gets a chain lookup.
    survivors.sort(
        key=lambda pair: (
            0 if pair[0]["ticker"] in selected_fund_tickers else 1,
            pair[2],
            -score_candidate(pair[0], pair[1], None)["score"],
        )
    )

    chain_targets = survivors[:chain_limit]

    def _chain_for(pair):
        tech, fund, _ = pair
        div_y = dividend_yield_for_pricing(fund, tech.get("price"))
        try:
            return _suggest_put(
                tech["ticker"], tech["price"], div_y,
                target_dte, target_delta, min_dte, max_dte,
                earnings_date=fund.get("next_earnings"),
                earnings_buffer_days=earnings_buffer,
                fallback_vol=_num(tech.get("rv_30")) or _num(tech.get("rv_252")),
            )
        except Exception:
            return None

    puts: dict[str, dict | None] = {}
    if chain_targets:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for pair, put in zip(chain_targets, pool.map(_chain_for, chain_targets)):
                puts[pair[0]["ticker"]] = put

    rows = []
    for tech, fund, lower_confidence in survivors:
        put = puts.get(tech["ticker"])
        rating = score_candidate(tech, fund, put, earnings_buffer_days=earnings_buffer)
        if lower_confidence:
            rating = {
                **rating,
                "flags": list(dict.fromkeys([
                    *rating.get("flags", []),
                    LOW_CONFIDENCE_SELECTED_FUND_FLAG,
                ])),
            }
        # _suggest_put already tried to find an expiration that closes before the
        # report; reaching here means no expiration in the DTE window could.
        if p["exclude_earnings_before_expiry"] and rating.get("earnings_before_expiry"):
            dropped_for_earnings += 1
            continue
        if put:
            skew_history = record_skew_snapshot(
                tech["ticker"],
                put,
                put.get("expiration"),
                dte=put.get("dte"),
            )
            for metric in ("put_skew", "call_skew", "skew"):
                rank_meta = skew_history.get(metric) or {}
                put[f"{metric}_rank"] = (
                    rank_meta.get("rank")
                    if rank_meta.get("rank") is not None
                    else rank_meta.get("provisional_rank")
                )
                put[f"{metric}_rank_ready"] = bool(rank_meta.get("ready"))
                put[f"{metric}_rank_observations"] = int(
                    rank_meta.get("observations") or 0
                )
            buyback = recommend_buyback(put, rating)
            div_yield = dividend_yield_for_pricing(fund, tech.get("price"))
            probability_schedule, profit_capture = profit_probability_schedule(
                spot=tech.get("price"),
                dte=put.get("dte"),
                expiration=put.get("expiration"),
                distribution_iv=put.get("atm_iv") or put.get("iv"),
                entry_cashflow=put.get("mid"),
                legs=[{
                    "option_type": "put",
                    "strike": put.get("strike"),
                    "iv": put.get("iv"),
                    "quantity": -1,
                }],
                exit_points=[{
                    "kind": "reassess",
                    "label": "Reassess / exit",
                    "remaining_dte": (buyback or {}).get("reassess_dte"),
                }],
                risk_free_rate=RISK_FREE,
                dividend_yield=div_yield,
                return_capture=True,
            )
            put = {
                **put,
                "buyback": buyback,
                "probability_schedule": probability_schedule,
                "profit_capture": profit_capture,
            }

        row = {
            "ticker": tech["ticker"],
            "name": fund.get("name"),
            "sector": fund.get("sector"),
            "industry": fund.get("industry"),
            "market_cap": _num(fund.get("market_cap")),
            "total_assets": _num(fund.get("total_assets")),
            # One size field the UI can show for both: market cap or AUM.
            "size": _fund_size(fund),
            "category": fund.get("category"),
            "expense_ratio": _round(fund.get("expense_ratio"), 4),
            "price": _round(tech.get("price")),
            "drawdown_pct": _round(tech.get("drawdown_pct")),
            "window_pct": _round(tech.get("window_pct")),
            "expected_move_pct": _round(tech.get("expected_move_pct")),
            "stretch_sigma": _round(tech.get("stretch_sigma")),
            "dd_stretch_sigma": _round(tech.get("dd_stretch_sigma")),
            "excess_drop_pct": _round(tech.get("excess_drop_pct")),
            "beta": _round(tech.get("beta")),
            "rsi_14": _round(tech.get("rsi_14"), 1),
            "atr_below_sma50": _round(tech.get("atr_below_sma50")),
            "week52_high": _round(tech.get("week52_high")),
            "week52_low": _round(tech.get("week52_low")),
            "above_52w_low_pct": _round(tech.get("above_52w_low_pct"), 1),
            "bounce_off_low_pct": _round(tech.get("bounce_off_low_pct"), 1),
            "decel_pp": _round(tech.get("decel_pp"), 1),
            "fresh_low": tech.get("fresh_low"),
            "sma_50": _round(tech.get("sma_50")),
            "sma_200": _round(tech.get("sma_200")),
            "rv_30": _round(tech.get("rv_30"), 3),
            "rv_252": _round(tech.get("rv_252"), 3),
            "avg_dollar_volume": _num(tech.get("avg_dollar_volume")),
            "trailing_eps": _round(fund.get("trailing_eps")),
            "profit_margin": _round(fund.get("profit_margin"), 4),
            "debt_to_equity": _round(fund.get("debt_to_equity"), 1),
            "forward_pe": _round(fund.get("forward_pe"), 1),
            "target_mean_price": _round(fund.get("target_mean_price")),
            "next_earnings": fund.get("next_earnings"),
            "put": _round_put(put),
            "candidate_status": (
                "lower_confidence" if lower_confidence else "qualified"
            ),
            **rating,
        }
        row["verdict"] = build_verdict(row)
        rows.append(row)

    # Priced candidates first: a partial score is computed over a smaller
    # denominator, so it is not comparable to a fully scored one.
    rows.sort(key=lambda r: (0 if r.get("put") else 1, -(r.get("score") or 0)))
    rows = rows[:max_results]

    return {
        "rows": rows,
        "stats": {
            "universe": len(tickers),
            "priced": priced,
            "passed_price": len(price_pass),
            "passed_fundamentals": passed_fundamentals,
            "chains_fetched": sum(1 for v in puts.values() if v),
            "dropped_for_earnings": dropped_for_earnings,
            "lower_confidence": sum(
                1 for row in rows
                if row.get("candidate_status") == "lower_confidence"
            ),
            "final": len(rows),
        },
        "params": {
            "universe": p["universe"], "lookback_days": lookback,
            "min_market_cap": min_cap, "min_drop_pct": min_drop,
            "min_stretch_sigma": min_stretch, "max_rsi": max_rsi,
            "min_avg_dollar_volume": min_adv,
            "include_stocks": bool(p["include_stocks"]),
            "include_index_etfs": bool(p["include_index_etfs"]),
            "include_sector_etfs": bool(p["include_sector_etfs"]),
            "include_commodity_etfs": bool(p["include_commodity_etfs"]),
            "include_selected_funds": bool(p["include_selected_funds"]),
            "selected_fund_tickers": sorted(selected_fund_tickers),
            "include_lower_confidence_selected_funds": bool(
                p.get("include_lower_confidence_selected_funds", True)
            ),
            "fund_min_drop_pct": fund_min_drop,
            "fund_min_stretch_sigma": fund_min_stretch,
            "fund_min_aum": fund_min_aum,
            "exclude_leveraged_funds": bool(p["exclude_leveraged_funds"]),
            "require_profitable": bool(p["require_profitable"]),
            "exclude_fresh_lows": bool(p["exclude_fresh_lows"]),
            "exclude_earnings_before_expiry": bool(p["exclude_earnings_before_expiry"]),
            "earnings_buffer_days": earnings_buffer,
            "target_dte": target_dte, "min_dte": min_dte, "max_dte": max_dte,
            "target_delta": target_delta, "chain_limit": chain_limit,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def _round_put(put: dict | None) -> dict | None:
    if not put:
        return None
    out = dict(put)
    for k, dec in (
        ("strike", 2), ("bid", 2), ("ask", 2), ("mid", 2), ("iv", 4), ("atm_iv", 4),
        ("delta", 3), ("prob_otm", 1), ("spread_pct", 1), ("premium_yield_pct", 2),
        ("annualized_pct", 1), ("cash_required", 0), ("premium_dollars", 0),
        ("effective_basis", 2), ("discount_to_spot_pct", 1), ("otm_pct", 1),
        ("put_skew", 2), ("call_skew", 2), ("skew", 2),
        ("put_skew_rank", 1), ("call_skew_rank", 1), ("skew_rank", 1),
    ):
        if k in out:
            out[k] = _round(out[k], dec)
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def register_routes(app):

    @app.route("/api/options/put-scan/universes", methods=["GET"])
    def put_scan_universes():
        return jsonify(
            universes=[
                {
                    "id": key,
                    "label": val["label"],
                    "count": len(val["tickers"]) if val["tickers"] else None,
                }
                for key, val in UNIVERSE_CHOICES.items()
            ],
            defaults=DEFAULTS,
        )

    @app.route("/api/options/put-scan", methods=["POST"])
    def put_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            payload.setdefault("profile_id", request.args.get("profile_id", type=int))
            payload.setdefault("aggregate_id", request.args.get("aggregate_id", type=int))
            return jsonify(run_put_scan(payload))
        except ValueError as e:
            return jsonify(error=str(e)), 400
        except Exception as e:
            return jsonify(error=str(e)), 500
