import datetime as _dt
import json
import math
import time


SAFETY_CACHE_TTL_HOURS = 24
SAFETY_MODEL_VERSION = 22
_NAV_BENCHMARK_OVERRIDE_CACHE = {"ts": 0, "data": {}}


def _clean_number(value):
    if value is None:
        return None
    try:
        if hasattr(value, "item"):
            value = value.item()
        value = float(value)
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    except (TypeError, ValueError):
        return None


def _clamp(value, low=0, high=100):
    return max(low, min(high, value))


def _score_lower_better(value, best, warn, bad):
    value = _clean_number(value)
    if value is None:
        return None
    if value <= best:
        return 100
    if value >= bad:
        return 0
    if value <= warn:
        return 100 - ((value - best) / (warn - best)) * 35
    return 65 - ((value - warn) / (bad - warn)) * 65


def _score_higher_better(value, bad, warn, best):
    value = _clean_number(value)
    if value is None:
        return None
    if value >= best:
        return 100
    if value <= bad:
        return 0
    if value >= warn:
        return 65 + ((value - warn) / (best - warn)) * 35
    return ((value - bad) / (warn - bad)) * 65


def _years_with_dividends(dividends):
    years = set()
    if dividends is None:
        return years
    try:
        items = dividends.items()
    except Exception:
        return years
    for ts, amount in items:
        amt = _clean_number(amount)
        if amt is None or amt <= 0:
            continue
        year = getattr(ts, "year", None)
        if year:
            years.add(int(year))
    return years


def _dividend_streak_years(dividends):
    years = _years_with_dividends(dividends)
    if not years:
        return 0
    today = _dt.date.today()
    start_year = today.year if today.month >= 10 and today.year in years else today.year - 1
    streak = 0
    for year in range(start_year, min(years) - 1, -1):
        if year not in years:
            break
        streak += 1
    return streak


def _distribution_consistency(dividends):
    years = _years_with_dividends(dividends)
    if not years:
        return 0
    latest = max(years)
    window = set(range(latest - 4, latest + 1))
    present = len(years.intersection(window))
    return present / 5


def _nav_benchmark_overrides():
    try:
        from config import get_connection
        now = time.time()
        cached = _NAV_BENCHMARK_OVERRIDE_CACHE
        if cached.get("data") is not None and (now - float(cached.get("ts") or 0)) < 60:
            return cached.get("data") or {}
        conn = get_connection()
        row = conn.execute("SELECT value FROM settings WHERE key = 'nav_benchmark_overrides'").fetchone()
        conn.close()
        raw = json.loads(row["value"]) if row and row["value"] else {}
        data = {
            str(k).strip().upper(): str(v).strip().upper()
            for k, v in raw.items()
            if str(k).strip() and str(v).strip()
        }
        _NAV_BENCHMARK_OVERRIDE_CACHE.update({"ts": now, "data": data})
        return data
    except Exception:
        _NAV_BENCHMARK_OVERRIDE_CACHE.update({"ts": time.time(), "data": {}})
        return {}


def _benchmark_for_ticker(ticker, name="", category=""):
    t = str(ticker or "").upper()
    text = f"{name or ''} {category or ''}".lower()
    override = _nav_benchmark_overrides().get(t)
    if override:
        return override
    direct = {
        "QQQI": "QQQ", "XQQI": "QQQ", "KQQQ": "QQQ", "TDAQ": "QQQ", "TDAX": "QQQ",
        "TQQY": "QQQ", "QDTE": "QQQ", "QYLD": "QQQ", "JEPQ": "QQQ",
        "SPYI": "SPY", "SPYH": "SPY", "XSPI": "SPY", "TSPY": "SPY",
        "TSYX": "SPY", "XDTE": "SPY", "DIVO": "SPY", "JEPI": "SPY", "XYLD": "SPY",
        "IWMI": "IWM", "RDTE": "IWM", "RYLD": "IWM",
        "BTCI": "BTC-USD", "BLOX": "BTC-USD",
        "ISBG": "BTC-USD+GLD", "ISSB": "SPY+BTC-USD",
        "BITY": "BTC-USD", "XBCI": "BTC-USD",
        "ETTY": "ETH-USD", "ETHI": "ETH-USD", "ETHY": "ETH-USD", "NEHI": "ETH-USD",
        "SOL": "SOL-USD", "SOLM": "SOL-USD", "SOLY": "SOL-USD",
        "IAUI": "GLD", "KGLD": "GLD", "GLDN": "GLD",
        "KSLV": "SLV", "SLVX": "SLV", "SLJY": "SLV",
        "MLPI": "AMLP",
        "KCOP": "CPER",
        "XLEI": "XLE", "NUKX": "NLR", "WEPN": "ITA",
        "CSHI": "BIL", "BIL": "BIL", "SGOV": "BIL", "SHV": "BIL",
        "PFFA": "PFF",
        "PBDC": "BIZD", "BIZD": "BIZD",
        "TSLY": "TSLA", "TSLP": "TSLA", "TSMY": "TSLA",
        "NVDY": "NVDA", "NVDP": "NVDA",
        "CONY": "COIN", "MSTY": "MSTR", "AMZY": "AMZN", "MSFO": "MSFT",
        "APLY": "AAPL", "GOOY": "GOOG", "GOOP": "GOOG", "GPTY": "GOOG",
        "FBY": "META", "NFLY": "NFLX", "DISO": "DIS", "PYPY": "PYPL",
        "SQY": "SQ", "AMDY": "AMD", "JPMO": "JPM", "PLTY": "PLTR",
        "SMCY": "SMCI", "GMEY": "GME", "MARO": "MARA", "MRNY": "MRNA",
        "SNOY": "SNOW", "XOMO": "XOM", "OARK": "ARKK",
    }
    if t in direct:
        return direct[t]
    if "nasdaq" in text or "qqq" in text:
        return "QQQ"
    if "s&p 500" in text or "s&p" in text or "spy" in text:
        return "SPY"
    if "russell 2000" in text or "small cap" in text:
        return "IWM"
    if "dow jones" in text or " dow " in f" {text} ":
        return "DIA"
    if "msci eafe" in text or "eafe" in text or "international" in text:
        return "EFA"
    if "emerging market" in text:
        return "EEM"
    if "bitcoin" in text or "btc" in text:
        return "BTC-USD"
    if "ethereum" in text or "ether" in text:
        return "ETH-USD"
    if "solana" in text:
        return "SOL-USD"
    if "crypto" in text:
        return "BTC-USD"
    if "gold" in text:
        return "GLD"
    if "silver" in text:
        return "SLV"
    if "copper" in text:
        return "CPER"
    if "mlp" in text or "energy infrastructure" in text:
        return "AMLP"
    if "semiconductor" in text or "semiconductors" in text:
        return "SOXX"
    if "preferred" in text or "preferreds" in text:
        return "PFF"
    if "treasury bill" in text or "t-bill" in text or "cash" in text:
        return "BIL"
    if "treasury" in text and ("long" in text or "20+" in text):
        return "TLT"
    if "treasury" in text or "bond" in text or "fixed income" in text:
        return "BND"
    if "nuclear" in text or "uranium" in text:
        return "NLR"
    if "defense" in text or "aerospace" in text or "weapon" in text:
        return "ITA"
    if "energy" in text or "oil" in text:
        return "XLE"
    if "real estate" in text or "reit" in text:
        return "VNQ"
    if "financial" in text or "bank" in text:
        return "XLF"
    if "healthcare" in text or "health care" in text:
        return "XLV"
    if "utility" in text or "utilities" in text:
        return "XLU"
    return "SPY"


def _nav_erosion_numerator(fund_return, benchmark_return):
    if fund_return is None or benchmark_return is None:
        return None
    if fund_return >= 0 or benchmark_return < 0:
        return 0.0
    return abs(fund_return)


def _benchmark_parts(benchmark):
    parts = [
        p.strip().upper()
        for p in str(benchmark or "").replace("/", "+").split("+")
        if p.strip()
    ]
    return parts or ["SPY"]


def _nav_distribution_coverage(ticker_obj, benchmark_ticker=None, annual_yield_floor=None):
    try:
        hist = ticker_obj.history(period="1y", auto_adjust=False, actions=True)
    except Exception:
        return None, None
    try:
        if hist is None or hist.empty or "Close" not in hist.columns:
            return None, None
        close = hist["Close"].dropna()
        if len(close) < 2:
            return None, None
        cur_price = float(close.iloc[-1])
        first_price = float(close.iloc[0])
        if cur_price <= 0 or first_price <= 0:
            return None, None
        divs = hist["Dividends"] if "Dividends" in hist.columns else None
        ttm_dist_per_share = float(divs[divs > 0].sum()) if divs is not None else 0.0
        if ttm_dist_per_share <= 0:
            return None, None
        fund_return = (cur_price - first_price) / first_price
        ttm_dist_yield = ttm_dist_per_share / cur_price
        floor_yield = _clean_number(annual_yield_floor)
        if floor_yield is not None and floor_yield > ttm_dist_yield:
            ttm_dist_yield = floor_yield
        if ttm_dist_yield <= 0:
            return None, None
        benchmark_return = fund_return
        if benchmark_ticker:
            import yfinance as yf
            component_returns = []
            for bench in _benchmark_parts(benchmark_ticker):
                bench_hist = yf.Ticker(bench).history(period="1y", auto_adjust=True)
                if bench_hist is not None and not bench_hist.empty and "Close" in bench_hist.columns:
                    bench_close = bench_hist["Close"].dropna()
                    if len(bench_close) >= 2:
                        bench_start = float(bench_close.iloc[0])
                        bench_end = float(bench_close.iloc[-1])
                        if bench_start > 0 and bench_end > 0:
                            component_returns.append((bench_end - bench_start) / bench_start)
            if component_returns:
                benchmark_return = sum(component_returns)
        numerator = _nav_erosion_numerator(fund_return, benchmark_return)
        if numerator is None:
            return None, None
        ratio = round(numerator / ttm_dist_yield, 4)
        if ratio <= 0.25:
            return ratio, "Low"
        if ratio <= 0.75:
            return ratio, "Medium"
        return ratio, "High"
    except Exception:
        return None, None


def _risk_level(score):
    if score is None:
        return "Unknown"
    if score >= 80:
        return "Low"
    if score >= 65:
        return "Moderate"
    if score >= 45:
        return "Elevated"
    return "High"


def _has_dividend_or_distribution(holding, annual_dividend, current_yield_pct, dividends):
    annual_income = _clean_number(holding.get("estim_payment_per_year"))
    div_per_share = _clean_number(holding.get("div"))
    if annual_income is not None and annual_income > 0:
        return True
    if annual_dividend is not None and annual_dividend > 0:
        return True
    if div_per_share is not None and div_per_share > 0:
        return True
    if current_yield_pct is not None and current_yield_pct > 0:
        return True
    return bool(_years_with_dividends(dividends))


def _safe_json_loads(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def ensure_dividend_safety_cache(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dividend_safety_cache (
            ticker TEXT PRIMARY KEY,
            as_of TEXT NOT NULL,
            payload TEXT NOT NULL
        )
        """
    )


def _cache_get(conn, ticker, refresh=False):
    if refresh:
        return None
    ensure_dividend_safety_cache(conn)
    row = conn.execute(
        "SELECT as_of, payload FROM dividend_safety_cache WHERE ticker = ?",
        (ticker,),
    ).fetchone()
    if not row:
        return None
    try:
        as_of = _dt.datetime.fromisoformat(row["as_of"])
    except Exception:
        return None
    age = _dt.datetime.utcnow() - as_of
    if age.total_seconds() > SAFETY_CACHE_TTL_HOURS * 3600:
        return None
    payload = _safe_json_loads(row["payload"])
    if not payload or payload.get("model_version") != SAFETY_MODEL_VERSION:
        return None
    return payload


def _cache_set(conn, ticker, payload):
    ensure_dividend_safety_cache(conn)
    conn.execute(
        """
        INSERT INTO dividend_safety_cache (ticker, as_of, payload)
        VALUES (?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
            as_of = excluded.as_of,
            payload = excluded.payload
        """,
        (ticker, _dt.datetime.utcnow().isoformat(timespec="seconds"), json.dumps(payload)),
    )


def _is_fund(info, holding):
    qtype = str(info.get("quoteType") or holding.get("classification_type") or "").upper()
    category = str(info.get("category") or "").lower()
    name = str(info.get("longName") or info.get("shortName") or holding.get("description") or "").lower()
    return (
        qtype in {"ETF", "MUTUALFUND", "INDEX"}
        or "fund" in category
        or "fund" in name
        or "etf" in name
        or "trust" in name
    )


def _is_option_income_fund(info, holding):
    qtype = str(info.get("quoteType") or holding.get("classification_type") or "").upper()
    name = str(info.get("longName") or info.get("shortName") or holding.get("description") or "").lower()
    category = str(info.get("category") or "").lower()
    ticker = str(holding.get("ticker") or "").upper()
    bdc_tickers = {
        "PBDC", "BIZD",
        "ARCC", "MAIN", "OBDC", "BXSL", "HTGC", "GBDC", "FDUS", "CSWC",
        "FSK", "OCSL", "TCPC", "TPVG", "PSEC", "NMFC", "TSLX", "BDC",
        "HRZN", "GLAD", "GAIN", "SAR", "CGBD", "CCAP", "TRIN", "RWAY",
    }
    if ticker in bdc_tickers:
        return False
    issuer_markers = (
        "neos", "tappalpha", "kurv", "yieldmax", "defiance", "roundhill",
        "rex shares", "rex ", "global x", "amplify", "jpmorgan", "evolve",
        "incomestkd", "quantify", "nicholas", "nicoloas", "xfunds",
        "state street", "spdr",
    )
    strategy_markers = (
        "covered call", "buywrite", "buy-write", "option income", "options income",
        "premium income", "income etf", "high income", "daily income",
        "enhanced income", "boosted", "hedged equity income",
        "option strategy", "option premium", "incomemax", "income max",
    )
    known_tickers = {
        "QQQI", "SPYI", "IWMI", "SPYH", "BNDI", "CSHI",
        "XDTE", "QDTE", "RDTE", "TSPY", "TQQY", "TDAQ", "XQQI", "KQQQ",
        "JEPI", "JEPQ", "ULTY", "YMAX", "YMAG", "CONY", "MSTY", "NVDY", "TSLY",
        "BTCI", "KYLD", "BLOX", "ISBG", "ISSB", "BITY", "XBCI",
        "ETTY", "ETHI", "ETHY", "NEHI", "SOL", "SOLM", "SOLY", "TSYX", "TDAX",
        "ULTI", "FEPI", "AIPI", "CEPI", "GIF", "TLDR", "ATCL",
        "GIAX", "FIAX", "WEPN", "NUKX", "GLDN", "SLVX", "SLJY", "KCOP",
        "XLEI", "CHPY", "GPTY", "GOOP", "YQQQ", "WNTR", "BEGS",
    }
    if ticker in known_tickers:
        return True
    return (
        any(marker in name or marker in category for marker in strategy_markers)
        or any(marker in name for marker in issuer_markers)
        or (qtype == "ETF" and ("income" in name or "premium" in name))
    )


def _is_bdc_income_vehicle(info, holding):
    name = str(info.get("longName") or info.get("shortName") or holding.get("description") or "").lower()
    industry = str(info.get("industry") or "").lower()
    ticker = str(holding.get("ticker") or "").upper()
    known_tickers = {
        "PBDC", "BIZD",
        "ARCC", "MAIN", "OBDC", "BXSL", "HTGC", "GBDC", "FDUS", "CSWC",
        "FSK", "OCSL", "TCPC", "TPVG", "PSEC", "NMFC", "TSLX", "BDC",
        "HRZN", "GLAD", "GAIN", "SAR", "CGBD", "CCAP", "TRIN", "RWAY",
    }
    markers = (
        "business development", " bdc", "bdc ", "bdc income",
        "secured lending fund", "specialty lending", "direct lending",
    )
    return (
        ticker in known_tickers
        or any(marker in name for marker in markers)
        or (industry == "asset management" and ("lending fund" in name or "capital bdc" in name))
    )


def _score_stock(metrics):
    payout = metrics.get("payout_ratio_pct")
    coverage = metrics.get("earnings_coverage")
    streak = metrics.get("dividend_streak_years")
    debt = metrics.get("debt_to_equity")

    parts = [
        (_score_lower_better(payout, 60, 90, 120), 0.35),
        (_score_higher_better(coverage, 0.75, 1.25, 2.0), 0.25),
        (_score_higher_better(streak, 0, 5, 10), 0.20),
        (_score_lower_better(debt, 1.0, 2.0, 3.0), 0.20),
    ]
    scored = [(score, weight) for score, weight in parts if score is not None]
    if not scored:
        return None
    total_weight = sum(weight for _, weight in scored)
    return round(sum(score * weight for score, weight in scored) / total_weight)


def _score_fund(metrics):
    streak = metrics.get("dividend_streak_years")
    consistency = metrics.get("distribution_consistency")
    yield_pct = metrics.get("current_yield_pct")
    streak_score = _score_higher_better(streak, 0, 3, 7)
    consistency_score = _score_higher_better(consistency, 0.2, 0.6, 1.0)
    yield_score = _score_lower_better(yield_pct, 8, 15, 25)
    parts = [(streak_score, 0.45), (consistency_score, 0.35), (yield_score, 0.20)]
    scored = [(score, weight) for score, weight in parts if score is not None]
    if not scored:
        return None
    total_weight = sum(weight for _, weight in scored)
    return max(55, round(sum(score * weight for score, weight in scored) / total_weight))


def _score_option_income_fund(metrics):
    nav_coverage = metrics.get("nav_coverage_ratio")
    nav_erosion = metrics.get("nav_erosion_risk")
    if nav_coverage is not None:
        if nav_coverage <= 0.25 or nav_erosion == "Low":
            return 90
        if nav_coverage > 0.75 or nav_erosion == "High":
            return 62
        return 68
    consistency = metrics.get("distribution_consistency")
    streak = metrics.get("dividend_streak_years")
    if consistency is None:
        consistency = 0
    if consistency >= 0.6:
        return 92
    if consistency >= 0.4:
        return 86
    if streak and streak >= 1:
        return 82
    return 70


def _score_bdc(metrics):
    nav_coverage = metrics.get("nav_coverage_ratio")
    nav_erosion = metrics.get("nav_erosion_risk")
    if nav_coverage is not None:
        if nav_coverage <= 0.25 or nav_erosion == "Low":
            return 86
        if nav_coverage > 0.75 or nav_erosion == "High":
            return 70
        return 74

    streak = metrics.get("dividend_streak_years")
    consistency = metrics.get("distribution_consistency")
    yield_pct = metrics.get("current_yield_pct")
    streak_score = _score_higher_better(streak, 0, 4, 8)
    consistency_score = _score_higher_better(consistency, 0.2, 0.6, 1.0)
    yield_score = _score_lower_better(yield_pct, 10, 14, 22)
    parts = [(streak_score, 0.45), (consistency_score, 0.35), (yield_score, 0.20)]
    scored = [(score, weight) for score, weight in parts if score is not None]
    if not scored:
        return None
    total_weight = sum(weight for _, weight in scored)
    return round(sum(score * weight for score, weight in scored) / total_weight)


def _risk_reasons(metrics, model):
    reasons = []
    payout = metrics.get("payout_ratio_pct")
    coverage = metrics.get("earnings_coverage")
    streak = metrics.get("dividend_streak_years")
    debt = metrics.get("debt_to_equity")
    yield_pct = metrics.get("current_yield_pct")
    if model == "option_income":
        nav_coverage = metrics.get("nav_coverage_ratio")
        nav_erosion = metrics.get("nav_erosion_risk")
        if nav_coverage is not None and (nav_coverage <= 0.25 or nav_erosion == "Low"):
            reasons.append("Low benchmark-adjusted NAV erosion")
        elif nav_coverage is not None and (nav_coverage > 0.75 or nav_erosion == "High"):
            reasons.append("NAV drift versus benchmark")
        if streak is not None and streak < 1:
            reasons.append("Limited distribution history")
        return reasons[:4]
    if model == "bdc":
        nav_coverage = metrics.get("nav_coverage_ratio")
        nav_erosion = metrics.get("nav_erosion_risk")
        if nav_coverage is not None and (nav_coverage <= 0.25 or nav_erosion == "Low"):
            reasons.append("Low benchmark-adjusted NAV erosion")
        elif nav_coverage is not None and (nav_coverage > 0.75 or nav_erosion == "High"):
            reasons.append("BDC NAV drift versus benchmark; verify NII dividend coverage")
        if streak is not None and streak < 2:
            reasons.append("Limited BDC distribution history")
        return reasons[:4]
    if model == "fund":
        if streak is not None and streak < 2:
            reasons.append("Short distribution history")
        return reasons[:4]
    if payout is not None and payout >= 100:
        reasons.append("Payout ratio at or above 100%")
    elif payout is not None and payout >= 90:
        reasons.append("Payout ratio above 90%")
    if coverage is not None and coverage < 1:
        reasons.append("Dividend is not fully covered by EPS")
    if debt is not None and debt >= 2:
        reasons.append("Debt/equity above 2.0")
    if streak is not None and streak < 3:
        reasons.append("Short dividend streak")
    if yield_pct is not None and yield_pct >= 15:
        reasons.append("Very high current yield")
    return reasons[:4]


def _build_payload(ticker, holding):
    import yfinance as yf

    ticker = ticker.strip().upper()
    tk = yf.Ticker(ticker)
    info = {}
    dividends = None
    try:
        info = tk.info or {}
    except Exception:
        info = {}
    try:
        dividends = tk.dividends
    except Exception:
        dividends = None

    dividend_rate = _clean_number(info.get("dividendRate"))
    trailing_eps = _clean_number(info.get("trailingEps"))
    forward_eps = _clean_number(info.get("forwardEps"))
    payout_ratio = _clean_number(info.get("payoutRatio"))
    debt_to_equity = _clean_number(info.get("debtToEquity"))
    current_yield = _clean_number(holding.get("current_annual_yield"))
    if current_yield is None:
        current_yield = _clean_number(info.get("dividendYield") or info.get("yield"))
    current_yield_pct = current_yield * 100 if current_yield is not None and current_yield <= 1.5 else current_yield

    annual_dividend = dividend_rate
    if annual_dividend is None:
        annual_dividend = _clean_number(holding.get("div"))
        if annual_dividend is not None and holding.get("div_frequency") in {"Q", "Quarterly"}:
            annual_dividend *= 4

    if not _has_dividend_or_distribution(holding, annual_dividend, current_yield_pct, dividends):
        return {
            "ticker": ticker,
            "model_version": SAFETY_MODEL_VERSION,
            "safety_score": None,
            "risk_level": "No Dividend",
            "cut_risk_flag": False,
            "risk_reasons": [],
            "score_model": "none",
            "payout_ratio_pct": None,
            "earnings_coverage": None,
            "dividend_streak_years": 0,
            "debt_to_equity": None,
            "distribution_consistency": 0,
            "current_yield_pct": None,
            "nav_coverage_ratio": None,
            "nav_erosion_risk": None,
        }

    eps = trailing_eps if trailing_eps not in (None, 0) else forward_eps
    earnings_coverage = (eps / annual_dividend) if eps is not None and annual_dividend not in (None, 0) else None
    if payout_ratio is None and earnings_coverage not in (None, 0):
        payout_ratio = 1 / earnings_coverage

    bdc_income = _is_bdc_income_vehicle(info, {**holding, "ticker": ticker})
    option_income = _is_option_income_fund(info, {**holding, "ticker": ticker})
    benchmark_ticker = _benchmark_for_ticker(
        ticker,
        info.get("longName") or info.get("shortName") or holding.get("description") or "",
        info.get("category") or holding.get("classification_type") or "",
    )
    nav_coverage, nav_erosion = (
        _nav_distribution_coverage(tk, benchmark_ticker, (current_yield_pct / 100) if current_yield_pct is not None else None)
        if option_income else (None, None)
    )

    metrics = {
        "payout_ratio_pct": round(payout_ratio * 100, 2) if payout_ratio is not None and payout_ratio <= 10 else round(payout_ratio, 2) if payout_ratio is not None else None,
        "earnings_coverage": round(earnings_coverage, 2) if earnings_coverage is not None else None,
        "dividend_streak_years": _dividend_streak_years(dividends),
        "debt_to_equity": round(debt_to_equity / 100, 2) if debt_to_equity is not None and debt_to_equity > 20 else round(debt_to_equity, 2) if debt_to_equity is not None else None,
        "distribution_consistency": round(_distribution_consistency(dividends), 2),
        "current_yield_pct": round(current_yield_pct, 2) if current_yield_pct is not None else None,
        "nav_coverage_ratio": nav_coverage,
        "nav_erosion_risk": nav_erosion,
    }

    fund_like = _is_fund(info, holding)
    model = "bdc" if bdc_income else ("option_income" if option_income else ("fund" if fund_like else "stock"))
    if model == "option_income":
        score = _score_option_income_fund(metrics)
    elif model == "bdc":
        score = _score_bdc(metrics)
    elif model == "fund":
        score = _score_fund(metrics)
    else:
        score = _score_stock(metrics)
    risk = _risk_level(score)
    reasons = _risk_reasons(metrics, model)
    if model == "option_income":
        cut_risk = risk == "High"
    elif model == "bdc":
        cut_risk = risk == "High"
    elif model == "fund":
        cut_risk = False
    else:
        cut_risk = risk in {"Elevated", "High"} or any(
            reason.startswith("Payout ratio") or reason.startswith("Dividend is not")
            for reason in reasons
        )

    return {
        "ticker": ticker,
        "model_version": SAFETY_MODEL_VERSION,
        "safety_score": score,
        "risk_level": risk,
        "cut_risk_flag": bool(cut_risk),
        "risk_reasons": reasons,
        "score_model": model,
        **metrics,
    }


def get_dividend_safety_for_holdings(conn, profile_id, holdings, refresh=False):
    del profile_id  # Cache is ticker-level because fundamentals are not profile-specific.
    ensure_dividend_safety_cache(conn)
    by_ticker = {}
    for holding in holdings or []:
        ticker = str(holding.get("ticker") or "").strip().upper()
        if not ticker or ticker in by_ticker:
            continue
        cached = _cache_get(conn, ticker, refresh=refresh)
        if cached is not None:
            by_ticker[ticker] = cached
            continue
        try:
            payload = _build_payload(ticker, holding)
        except Exception as exc:
            payload = {
                "ticker": ticker,
                "model_version": SAFETY_MODEL_VERSION,
                "safety_score": None,
                "risk_level": "Unknown",
                "cut_risk_flag": False,
                "risk_reasons": [f"Safety data unavailable: {exc.__class__.__name__}"],
                "score_model": "unknown",
                "payout_ratio_pct": None,
                "earnings_coverage": None,
                "dividend_streak_years": None,
                "debt_to_equity": None,
                "distribution_consistency": None,
                "current_yield_pct": None,
            }
        by_ticker[ticker] = payload
        _cache_set(conn, ticker, payload)
    conn.commit()
    return by_ticker


def apply_nav_coverage_overlay(payload, coverage_ratio=None, nav_erosion=None):
    """Use benchmark-adjusted NAV erosion ratio for income-vehicle overlays.

    The ratio is lower-is-better:
      max(0, benchmark_return - fund_price_return) / distribution_yield
    """
    out = dict(payload or {})
    model = out.get("score_model")
    if str(out.get("ticker") or "").upper() in {"PBDC", "BIZD"}:
        model = "bdc"
        out["score_model"] = "bdc"
    if model not in {"option_income", "bdc", "fund"}:
        return out
    cov = _clean_number(coverage_ratio)
    erosion = str(nav_erosion or "").lower()
    if cov is None:
        return out
    if model == "fund":
        out["nav_coverage_ratio"] = cov
        out["nav_erosion_risk"] = nav_erosion
        return out
    reasons = list(out.get("risk_reasons") or [])
    if cov <= 0.25 or erosion == "low":
        target_score = 88 if model == "option_income" else (86 if model == "bdc" else 82)
        out["safety_score"] = max(_clean_number(out.get("safety_score")) or 0, target_score)
        out["risk_level"] = "Low"
        out["cut_risk_flag"] = False
        out["risk_reasons"] = ["Low benchmark-adjusted NAV erosion"]
    elif cov > 0.75 or erosion == "high":
        if model in {"option_income", "bdc"}:
            out["safety_score"] = 62 if model == "option_income" else 70
            out["risk_level"] = "Elevated" if model == "option_income" else "Moderate"
            out["cut_risk_flag"] = False
            if model == "bdc":
                out["risk_reasons"] = ["BDC NAV drift versus benchmark; verify NII dividend coverage"] + reasons[:2]
            else:
                out["risk_reasons"] = ["NAV drift versus benchmark, not a confirmed cut risk"] + reasons[:2]
        else:
            out["safety_score"] = min(_clean_number(out.get("safety_score")) or 100, 44)
            out["risk_level"] = "High"
            out["cut_risk_flag"] = True
            out["risk_reasons"] = ["High benchmark-adjusted NAV erosion"] + reasons[:2]
    elif cov <= 0.75 or erosion == "medium":
        if model == "bdc":
            out["safety_score"] = max(_clean_number(out.get("safety_score")) or 0, 70)
            out["risk_level"] = "Moderate"
            out["cut_risk_flag"] = False
            out["risk_reasons"] = ["Moderate BDC NAV drift versus benchmark"] + reasons[:2]
        elif model == "option_income":
            out["safety_score"] = max(_clean_number(out.get("safety_score")) or 0, 68)
            out["risk_level"] = "Moderate"
            out["cut_risk_flag"] = False
            out["risk_reasons"] = ["Moderate NAV drift versus benchmark"] + reasons[:2]
    return out


def summarize_dividend_safety(rows):
    scores = [_clean_number(r.get("safety_score")) for r in rows or []]
    scores = [s for s in scores if s is not None]
    def _row_risk(row):
        return row.get("risk_level") or row.get("safety_risk_level")

    high = [r for r in rows or [] if _row_risk(r) == "High"]
    elevated = [r for r in rows or [] if _row_risk(r) == "Elevated"]
    income_at_risk = 0.0
    for row in high + elevated:
        income = _clean_number(row.get("estim_payment_per_year"))
        if income is not None:
            income_at_risk += income
    return {
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
        "high_risk_count": len(high),
        "elevated_risk_count": len(elevated),
        "portfolio_income_at_risk": round(income_at_risk, 2),
    }
