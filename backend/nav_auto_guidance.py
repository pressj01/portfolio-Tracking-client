"""Automatic NAV-screen guidance for holdings outside the reviewed registry.

The registry documents the funds the screen was built around. Any other
holding (a plain index ETF, a bond mutual fund, a newer option-income ETF)
used to stop at "Security type needs verification" with no reference, so an
account of ordinary funds could never be screened. This infers the security
type, whether the fund runs an option-income strategy, and a reference ETF
from data the app already stores: Yahoo's quote type and fund category, the
fund-holdings security type, the scanner's strategy tag and the fund name.

Everything here is labelled as inferred. Nothing is issuer-verified, and an
inferred reference never satisfies the stronger verified-NAV screen, which
requires a documented "Exposure reference" fit.
"""
import re

INFERRED_FIT = "Inferred exposure reference"
BROAD_FIT = "Broad context — inferred"

# Morningstar/Yahoo fund categories -> (asset class, reference, description).
CATEGORY_REFERENCES = {
    "Large Blend": ("equity", "SPY", "US large-cap stocks"),
    "Large Value": ("equity", "VTV", "US large-cap value stocks"),
    "Large Growth": ("equity", "VUG", "US large-cap growth stocks"),
    "Mid-Cap Blend": ("equity", "IJH", "US mid-cap stocks"),
    "Mid-Cap Value": ("equity", "IJJ", "US mid-cap value stocks"),
    "Mid-Cap Growth": ("equity", "IJK", "US mid-cap growth stocks"),
    "Small Blend": ("equity", "IJR", "US small-cap stocks"),
    "Small Value": ("equity", "IJS", "US small-cap value stocks"),
    "Small Growth": ("equity", "IJT", "US small-cap growth stocks"),
    "Foreign Large Blend": ("equity", "EFA", "developed-market stocks outside the US"),
    "Foreign Large Value": ("equity", "EFV", "developed-market value stocks outside the US"),
    "Foreign Large Growth": ("equity", "EFG", "developed-market growth stocks outside the US"),
    "Foreign Small/Mid Blend": ("equity", "SCZ", "developed-market small-cap stocks outside the US"),
    "Foreign Small/Mid Value": ("equity", "SCZ", "developed-market small-cap stocks outside the US"),
    "Foreign Small/Mid Growth": ("equity", "SCZ", "developed-market small-cap stocks outside the US"),
    "Diversified Emerging Mkts": ("equity", "EEM", "emerging-market stocks"),
    "Global Large-Stock Blend": ("equity", "ACWI", "global stocks"),
    "Global Large-Stock Value": ("equity", "ACWI", "global stocks"),
    "Global Large-Stock Growth": ("equity", "ACWI", "global stocks"),
    "World Large-Stock Blend": ("equity", "ACWI", "global stocks"),
    "World Large-Stock Value": ("equity", "ACWI", "global stocks"),
    "World Large-Stock Growth": ("equity", "ACWI", "global stocks"),
    "Global Small/Mid Stock": ("equity", "ACWI", "global stocks"),
    "Japan Stock": ("equity", "EWJ", "Japanese stocks"),
    "China Region": ("equity", "MCHI", "Chinese stocks"),
    "India Equity": ("equity", "INDA", "Indian stocks"),
    "Europe Stock": ("equity", "VGK", "European stocks"),
    "Pacific/Asia ex-Japan Stk": ("equity", "AAXJ", "Asia-Pacific stocks"),
    "Latin America Stock": ("equity", "ILF", "Latin American stocks"),
    "Technology": ("equity", "XLK", "US technology stocks"),
    "Health": ("equity", "XLV", "US health-care stocks"),
    "Financial": ("equity", "XLF", "US financial stocks"),
    "Industrials": ("equity", "XLI", "US industrial stocks"),
    "Utilities": ("equity", "XLU", "US utility stocks"),
    "Real Estate": ("equity", "VNQ", "US real estate stocks"),
    "Equity Energy": ("equity", "XLE", "US energy stocks"),
    "Energy Limited Partnership": ("equity", "AMLP", "energy midstream partnerships"),
    "Natural Resources": ("equity", "XLB", "materials and natural-resource stocks"),
    "Equity Precious Metals": ("equity", "GDX", "gold and silver miners"),
    "Communications": ("equity", "XLC", "communication-services stocks"),
    "Consumer Cyclical": ("equity", "XLY", "consumer-discretionary stocks"),
    "Consumer Defensive": ("equity", "XLP", "consumer-staples stocks"),
    "Infrastructure": ("equity", "IGF", "global infrastructure stocks"),
    "Intermediate Core Bond": ("bond", "AGG", "US investment-grade bonds"),
    "Intermediate Core-Plus Bond": ("bond", "AGG", "US investment-grade bonds"),
    "Multisector Bond": ("bond", "AGG", "US bonds"),
    "Short-Term Bond": ("bond", "BSV", "short-term US bonds"),
    "Ultrashort Bond": ("bond", "JPST", "ultra-short bonds"),
    "Short Government": ("bond", "SHY", "short-term Treasuries"),
    "Intermediate Government": ("bond", "IEF", "intermediate Treasuries"),
    "Long Government": ("bond", "TLT", "long-term Treasuries"),
    "Inflation-Protected Bond": ("bond", "TIP", "Treasury inflation-protected securities"),
    "Short-Term Inflation-Protected Bond": ("bond", "VTIP", "short-term TIPS"),
    "Corporate Bond": ("bond", "LQD", "investment-grade corporate bonds"),
    "Long-Term Bond": ("bond", "BLV", "long-term bonds"),
    "High Yield Bond": ("bond", "HYG", "high-yield corporate bonds"),
    "Bank Loan": ("bond", "SRLN", "senior bank loans"),
    "Securitized Bond - Focused": ("bond", "JAAA", "AAA collateralized loan obligations"),
    "Securitized Bond - Diversified": ("bond", "MBB", "mortgage-backed securities"),
    "Muni National Interm": ("bond", "MUB", "national municipal bonds"),
    "Muni National Short": ("bond", "SUB", "short-term municipal bonds"),
    "Muni National Long": ("bond", "MLN", "long-term municipal bonds"),
    "Muni Single State Short": ("bond", "SUB", "short-term municipal bonds"),
    "Muni California Intermediate": ("bond", "CMF", "California municipal bonds"),
    "Muni California Long": ("bond", "CMF", "California municipal bonds"),
    "High Yield Muni": ("bond", "HYD", "high-yield municipal bonds"),
    "Emerging Markets Bond": ("bond", "EMB", "emerging-market bonds"),
    "Global Bond": ("bond", "BNDX", "international bonds"),
    "World Bond": ("bond", "BNDX", "international bonds"),
    "Preferred Stock": ("bond", "PFF", "preferred securities"),
    "Convertibles": ("bond", "CWB", "convertible bonds"),
    "Commodities Broad Basket": ("commodity", "DBC", "a broad commodity basket"),
    "Moderate Allocation": ("allocation", "AOR", "a 60/40 stock-bond mix"),
    "Moderately Aggressive Allocation": ("allocation", "AOA", "an 80/20 stock-bond mix"),
    "Aggressive Allocation": ("allocation", "AOA", "an 80/20 stock-bond mix"),
    "Moderately Conservative Allocation": ("allocation", "AOM", "a 40/60 stock-bond mix"),
    "Conservative Allocation": ("allocation", "AOK", "a 30/70 stock-bond mix"),
    "Tactical Allocation": ("allocation", "AOR", "a 60/40 stock-bond mix"),
    "Global Moderate Allocation": ("allocation", "AOR", "a 60/40 stock-bond mix"),
}

# A fund that tracks its own reference cannot be compared with itself.
ALTERNATES = {"SPY": "IVV", "IVV": "SPY", "VOO": "SPY", "QQQ": "QQQM", "IWM": "VTWO", "AGG": "BND", "BND": "AGG",
              "VTV": "IVE", "VUG": "IVW", "IJH": "MDY", "IJR": "SLY", "EFA": "IEFA", "EEM": "IEMG", "VTI": "ITOT",
              "TLT": "VGLT", "SHY": "VGSH", "IEF": "VGIT", "LQD": "VCIT", "HYG": "JNK", "TIP": "SCHP",
              "VTIP": "STIP", "BSV": "VCSH", "GLD": "IAU", "SLV": "SIVR", "XLK": "VGT", "XLE": "VDE", "VNQ": "SCHH",
              "EFV": "EFA", "EFG": "EFA", "SCZ": "EFA", "IJS": "IJR", "IJT": "IJR", "IJJ": "IJH", "IJK": "IJH",
              "XLV": "VHT", "XLF": "VFH", "XLU": "VPU", "XLI": "VIS", "XLB": "VAW", "XLP": "VDC", "XLY": "VCR",
              "XLC": "VOX", "GDX": "RING", "SOXX": "SMH", "SMH": "SOXX", "DBC": "PDBC", "PFF": "PGX", "MUB": "VTEB",
              "SGOV": "BIL", "JPST": "ICSH", "IBIT": "FBTC", "ETHA": "FETH", "ACWI": "VT", "VYM": "SCHD", "VIG": "DGRO",
              "RSP": "SPY", "AMLP": "MLPA", "IGF": "IFRA", "ITA": "XAR", "XAR": "ITA"}
COMMODITY_REFERENCES = {"GLD", "IAU", "SLV", "SIVR", "PPLT", "DBC", "PDBC"}

# Named exposures checked against the fund name, most specific first.
CRYPTO = [
    (r"\bBITCOIN\b|\bBTC\b", "IBIT", "spot bitcoin (IBIT, priced at the US close)"),
    (r"\bETHEREUM\b|\bETHER\b|\bETH\b", "ETHA", "spot ether (ETHA, priced at the US close)"),
    (r"\bSOLANA\b", "SOL-USD", "Solana"),
    (r"\bXRP", "XRP-USD", "XRP"),
]
INDEXES = [
    (r"NASDAQ[- ]?COMPOSITE", "ONEQ", "the Nasdaq Composite"),
    (r"NASDAQ|\bN100\b|\bNDX\b|\bQQQ\b", "QQQ", "the Nasdaq-100"),
    (r"S&P ?MID ?CAP|S&P 400", "IJH", "the S&P MidCap 400"),
    (r"S&P ?SMALL ?CAP|S&P 600", "IJR", "the S&P SmallCap 600"),
    (r"S&P ?500|\bSPX\b|\bU\.? ?S\.? 500\b|\b500 (INDEX|INCOME|PREMIUM|FUND)", "SPY", "the S&P 500"),
    (r"RUSSELL 2000|\bR2000\b|\bRUT\b", "IWM", "the Russell 2000"),
    (r"RUSSELL 1000", "IWB", "the Russell 1000"),
    (r"DOW JONES INDUSTRIAL|\bDJIA\b|\bDOW 30\b", "DIA", "the Dow Jones Industrial Average"),
    (r"TOTAL (US )?STOCK|TOTAL MARKET|RUSSELL 3000", "VTI", "the total US stock market"),
    (r"\bFANG\b", "QQQ", "large US technology stocks"),
]
THEMES = [
    (r"SPECIALTY LENDING|DIRECT LENDING", "BIZD", "listed business development companies"),
    (r"SEMICONDUCTOR|\bSEMIS?\b|\bSOX\b", "SOXX", "semiconductor stocks"),
    (r"CYBER|\bHACK\b", "CIBR", "cybersecurity stocks"),
    (r"BIOTECH", "XBI", "biotech stocks"),
    (r"HEALTH|LIFE SCIENCES", "XLV", "health-care stocks"),
    (r"MORTGAGE REIT|\bMREIT", "REM", "mortgage REITs"),
    (r"REAL ESTATE|\bREALTY\b|\bRLTY\b|\bREITS?\b", "VNQ", "real estate stocks"),
    (r"MIDSTREAM|\bMLPS?\b|PIPELINE|ENERGY INFRA|ENERGY INFRSTR", "AMLP", "energy midstream partnerships"),
    (r"INFRASTR|INFRSTR", "IGF", "global infrastructure stocks"),
    (r"ENERGY|OIL & GAS|\bOIL\b", "XLE", "energy stocks"),
    (r"UTILIT", "XLU", "utility stocks"),
    (r"AEROSPACE|DEFENSE", "ITA", "aerospace and defense stocks"),
    (r"FINANCIAL|\bBANKS?\b(?! LOAN)", "XLF", "financial stocks"),
    (r"INDUSTRIAL", "XLI", "industrial stocks"),
    (r"TECHNOLOGY|\bTECH\b|TECHNOLOGIES|\bTEC\b|INF TECH", "XLK", "technology stocks"),
    (r"(JR|JUNIOR) (GOLD|GLD)", "GDXJ", "junior gold miners"),
    (r"(GOLD|GLD) (MINERS|MNRS|MINING)", "GDX", "gold miners"),
    (r"(JR|JUNIOR) (SILVER|SLVR)|(SILVER|SLVR) MINER", "SILJ", "silver miners"),
    (r"COPPER", "COPX", "copper miners"),
    (r"URANIUM", "URA", "uranium miners"),
    (r"PLATINUM", "PPLT", "platinum"),
    (r"\bGOLD\b|\bGLD\b", "GLD", "gold"),
    (r"\bSILVER\b|\bSLVR?\b", "SLV", "silver"),
    (r"COMMODIT", "DBC", "a broad commodity basket"),
    (r"CRITICAL MATERIALS|NATURAL RESOURCE|\bMATERIALS\b", "XLB", "materials and natural-resource stocks"),
    (r"EMERGING|\bEM\b|EX[- ]CHINA", "EEM", "emerging-market stocks"),
    (r"JAPAN", "EWJ", "Japanese stocks"),
    (r"\bCHINA\b", "MCHI", "Chinese stocks"),
    (r"\bINDIA\b", "INDA", "Indian stocks"),
    (r"EUROPE", "VGK", "European stocks"),
    (r"ASIA|PACIFIC", "AAXJ", "Asia-Pacific stocks"),
    (r"INTERNATIONAL|\bINTL\b|FOREIGN|OVERSEAS|\bEAFE\b|DEVELOPED|\bEX[- ]US\b", "EFA", "developed-market stocks outside the US"),
    (r"GLOBAL|\bWORLD\b|\bGL\b", "ACWI", "global stocks"),
]
BONDS = [
    (r"T-?BILL|TREASURY BILL|0-3 MONTH|ULTRA[- ]?SHORT", "bond", "SGOV", "Treasury bills"),
    (r"(SHORT|0-5|0-5 YR|1-5).*(TIPS|INFLATION)|(TIPS|INFLATION).*(SHORT|0-5)", "bond", "VTIP", "short-term TIPS"),
    (r"\bTIPS\b|INFLATION", "bond", "TIP", "Treasury inflation-protected securities"),
    (r"(SHORT|1-3).*(TREASURY|GOVT|GOVERNMENT)", "bond", "SHY", "short-term Treasuries"),
    (r"(LONG|20\+).*(TREASURY|GOVT|GOVERNMENT)", "bond", "TLT", "long-term Treasuries"),
    (r"TREASURY|GOVT\b|GOVERNMENT", "bond", "IEF", "intermediate Treasuries"),
    (r"(CALIFORNIA|CALIF|\bCA\b).*\bMUN", "bond", "CMF", "California municipal bonds"),
    (r"MUNI|\bMUN\b|MUNCP|MUNICIPAL|TAX[- ]?FREE|TAX[- ]?EXEMPT", "bond", "MUB", "municipal bonds"),
    (r"SHORT.*(CORP|CREDIT)", "bond", "VCSH", "short-term corporate bonds"),
    (r"HIGH YIELD|\bHY\b|JUNK", "bond", "HYG", "high-yield corporate bonds"),
    (r"SENIOR LOAN|BANK LOAN|FLOATING RATE|\bCLO\b", "bond", "SRLN", "floating-rate loans"),
    (r"PREFERRED|\bPFD\b|\bPREF\b", "bond", "PFF", "preferred securities"),
    (r"CONVERTIBLE", "bond", "CWB", "convertible bonds"),
    (r"CORPORATE|\bCORP BOND|INCOME STRATEGY|DYNAMIC INCOME|CORP & INC", "bond", "HYG", "corporate credit"),
    (r"MORTGAGE|SECURITIZED", "bond", "MBB", "mortgage-backed securities"),
    (r"AGGREGATE|CORE BOND|CORE PLUS|TOTAL BOND|\bBOND\b|FIXED INC", "bond", "AGG", "US investment-grade bonds"),
]
STYLES = [
    (r"SMALL ?CAP VAL|SMALL[- ]CAP VAL", "IJS", "US small-cap value stocks"),
    (r"SMALL ?CAP GR|SMALL[- ]CAP GR", "IJT", "US small-cap growth stocks"),
    (r"SMALL[- ]?CAP|SMALLCAP|SMALL CO|SMALLER", "IWM", "US small-cap stocks"),
    (r"MID[- ]?CAP", "IJH", "US mid-cap stocks"),
    (r"EQUAL WEIGHT", "RSP", "equal-weight US large caps"),
    (r"MOMENTUM|MOMNTM", "MTUM", "US momentum stocks"),
    (r"DIVIDEND GROWTH|DIV GROWTH", "VIG", "US dividend-growth stocks"),
    (r"HIGH DIV|DIVIDEND|\bDVD\b|\bDIV\b", "VYM", "US high-dividend stocks"),
    (r"GROWTH|\bGRW|\bGRWTH\b", "VUG", "US large-cap growth stocks"),
    (r"VALUE|\bVAL\b|\bVLU\b", "VTV", "US large-cap value stocks"),
    (r"LARGE CAP|LRG CAP|\bCORE\b", "SPY", "US large-cap stocks"),
]
ALLOCATIONS = [
    (r"CONSERVATIVE", "AOK", "a 30/70 stock-bond mix"),
    (r"BALANCED|ALLOCATION|MODERATE|TARGET DATE|RETIREMENT 20\d\d|LIFEPATH|FREEDOM 20\d\d", "AOR", "a 60/40 stock-bond mix"),
]
# Option-income underlyings named by ticker or company in fund names.
SINGLE_STOCKS = {
    "TSLA": r"\bTSLA\b|TESLA", "NVDA": r"\bNVDA\b|NVIDIA", "AAPL": r"\bAAPL\b|\bAPPLE\b", "AMZN": r"\bAMZN\b|AMAZON",
    "MSFT": r"\bMSFT\b|MICROSOFT", "GOOGL": r"\bGOOGL?\b|GOOGLE|ALPHABET", "META": r"\bMETA\b|FACEBOOK",
    "NFLX": r"\bNFLX\b|NETFLIX", "AMD": r"\bAMD\b", "COIN": r"\bCOIN\b|COINBASE", "MSTR": r"\bMSTR\b|MICROSTRATEGY",
    "PLTR": r"\bPLTR\b|PALANTIR", "LLY": r"\bLLY\b|ELI LILLY", "WMT": r"\bWMT\b|WALMART", "AVGO": r"\bAVGO\b|BROADCOM",
    "SMCI": r"\bSMCI\b", "ARKK": r"\bARKK\b", "KWEB": r"\bKWEB\b", "BABA": r"\bBABA\b|ALIBABA", "UBER": r"\bUBER\b",
    "HOOD": r"\bHOOD\b|ROBINHOOD", "SNOW": r"\bSNOW\b|SNOWFLAKE", "CRWD": r"\bCRWD\b|CROWDSTRIKE",
    "SPCX": r"\bSPACEX\b", "JPM": r"\bJPM\b", "XOM": r"\bXOM\b", "DIS": r"\bDIS\b|DISNEY", "PYPL": r"\bPYPL\b|PAYPAL",
    "RBLX": r"\bRBLX\b|ROBLOX", "SHOP": r"\bSHOP\b|SHOPIFY", "ABNB": r"\bABNB\b|AIRBNB", "RIVN": r"\bRIVN\b",
    "GME": r"\bGME\b", "TSM": r"\bTSM\b", "MU": r"\bMICRON\b", "INTC": r"\bINTC\b",
}

OPTION_WORDS = re.compile(
    r"OPTION|COVERED CALL|\bCC\b|\bCOV\b|BUY[- ]?WRITE|PREMIUM INC|EQUITY PREMIUM|YIELD PREMIUM|YLD PREM|PREM INC"
    r"|PREMIUM (TEC|TECH|STRATEGY)|HIGH INCOME|ENHANCED INCOME|ENH(ANCED)? (EQ|EQT|EQUITY|DIV|DIVIDEND)\b|\bENHAN\b"
    r"|INCOME EDGE|YIELDMAX|\bOP INC|\bOPT INC|\bMON OP\b|\bOI ETF|INCOME BLAST|TARGET \d+ (DISTRIBUTION|INCOME)"
    r"|DISTRIBUTION ETF|GROWTH (&|AND) INCOME ETF")
BOND_WORDS = re.compile(r"BOND|MUNI|\bMUN\b|MUNCP|MUNICIPAL|CREDIT|LOAN|TREASURY|CORPORATE|FIXED INC|MORTGAGE|PIMCO|DOUBLELINE"
                        r"|INCOME STRATEGY|DYNAMIC INCOME|CORP & INC")
LEVERAGED_WORDS = re.compile(r"\b[2-4]X\b|\b-[1-4]X\b|ULTRAPRO|\bLEVERAGED\b|\bINVERSE\b|\bBEAR\b|\bBULL\b|\bVIX\b"
                             r"|VOLATILITY|WEEKLY ?PAY|WEKLYPAY|\bWKPY\b|\bLIFT\b")
INVERSE_WORDS = re.compile(r"\bSHORT\b(?![- ]?(TERM|DURATION|MATURITY|DUR\b|GOVT|GOVERNMENT|TREASURY|CORP|BOND))|\bINVERSE\b|\bBEAR\b|-1X")
FUND_WORDS = re.compile(r"\b(ETF|ETN|ETFS|FUND|FD|FDS|FUNDS|INSTL|INSTITUTIONAL|ADMIRAL|PORTFOLIO|MUTUAL)\b")
WEAK_FUND_WORDS = re.compile(r"\b(TRUST|TR|CL [A-Z0-9]{1,2}|SHARES|INDEX)\b")
COMPANY_WORDS = re.compile(r"\b(CORP|CORPORATION|LTD|LIMITED|PLC|ADR|LP|L P|MINING|MINES|MNG|SA|NV|N V|AG|SE|CO)\b"
                           r"|\bINC\b|-CLASS [A-Z]|\bCL[- ][AB]$")
# "INC" closes both company names and CEF names ("... DVD INC" = dividend income).
INCOME_WORDS = re.compile(r"\b(DVD|DIV|DIVIDEND|INCOME|INCM|EQT|EQUITY|TAX|MUNI|MUNICIPAL|STRATEGY|STRAT|OPPORT"
                          r"|PREMIUM|ENH|ENHAN|ENHANCED|YIELD|BOND|CREDIT|TERM|TOT RET|TOTAL RETURN|INFRASTR)\b")
PREFERRED_SECURITY = re.compile(r"\b(PERP|PFD|PREF|PD|PREFERRED|CUM)\b")
ALTERNATIVE_WORDS = re.compile(r"LONG[ /-]?SHORT|MARKET NEUTRAL|MULTI[- ]?STRATEGY|ABSOLUTE RETURN|MANAGED FUTURES|CURRENCY")
CEF_OPTION_WORDS = re.compile(r"OPTION|COVERED CALL|BUY[- ]?WRITE|PREMIUM|ENHANCED EQUITY|ENH EQT|ENHAN|ENH(ANCED)? (EQ|EQUITY)")


# --- Option positions in a fund's disclosed holdings -------------------------
# Issuers list written (sold) options with a negative weight. That is direct
# evidence of the strategy, stronger than the fund name or category.
OCC_SYMBOL = re.compile(r"^\d?([A-Z]{1,6})(\d{6})([CP])(\d{8})$")
OPTION_NAMES = [
    # NDX US 09/18/26 C29075
    re.compile(r"^(?P<u>[A-Z0-9.]+)\s+(?:US\s+)?(?P<d>\d{2}/\d{2}/\d{2,4})\s+(?P<t>[CP])\s?(?P<k>\d+(?:\.\d+)?)$"),
    # GLD 09/18/2026 382 C
    re.compile(r"^(?P<u>[A-Z0-9.]+)\s+(?P<d>\d{2}/\d{2}/\d{2,4})\s+(?P<k>\d+(?:\.\d+)?)\s+(?P<t>[CP])$"),
    # ... ENERGY SELECT SEC AUG26 62 CALL
    re.compile(r"^(?P<u>.+?)\s+(?P<d>[A-Z]{3}\d{2})\s+(?P<k>\d+(?:\.\d+)?)\s+(?P<t>CALL|PUT)$"),
    # NVIDIA C PUT OPT 08/26 210
    re.compile(r"^(?P<u>.+?)\s+(?P<t>CALL|PUT)\s+OPT\s+(?P<d>\d{2}/\d{2})\s+(?P<k>\d+(?:\.\d+)?)$"),
    # Put On S&P 500 Jul26
    re.compile(r"^(?P<t>PUT|CALL)\s+ON\s+(?P<u>.+?)(?:\s+(?P<d>[A-Z][a-z]{2}\d{2}))?$", re.I),
]


def parse_option_position(symbol, name, weight):
    """{type, underlying, expiry, strike, side} for an option row, else None."""
    symbol = str(symbol or "").strip().upper()
    name = str(name or "").strip()
    found = OCC_SYMBOL.match(symbol)
    if found:
        underlying, expiry, kind, strike = found.groups()
        option = {"type": kind, "underlying": underlying, "expiry": expiry, "strike": int(strike) / 1000}
    else:
        option = None
        for pattern in OPTION_NAMES:
            match = pattern.match(name if pattern.flags & re.I else name.upper())
            if match:
                parts = match.groupdict()
                strike = parts.get("k")
                option = {"type": parts["t"].upper()[0], "underlying": (parts.get("u") or "").upper().strip(),
                          "expiry": parts.get("d"), "strike": float(strike) if strike else None}
                break
        if option is None:
            return None
    weight = number_or_none(weight)
    option["side"] = "short" if weight is not None and weight < 0 else "long" if weight else "unknown"
    return option


def number_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def summarize_option_holdings(rows):
    """Count written calls and written puts in disclosed holdings.

    A short put paired with a long call at the same strike and expiry is
    synthetic long stock, a short call paired with a long put is synthetic
    short stock, and a short put below a long put is bought protection; none
    of them is option selling for income. Rows whose weight rounds to zero do
    not say which side the fund is on and are not counted.
    """
    options = [option for option in (parse_option_position(*row) for row in rows) if option]
    if not options:
        return None
    def key(option):
        return option["underlying"], option["expiry"]
    # Pairs need a strike; name-only rows without one are never paired.
    long_calls = {(key(o), o["strike"]) for o in options
                  if o["type"] == "C" and o["side"] == "long" and o["strike"] is not None}
    long_put_strikes = {(key(o), o["strike"]) for o in options
                        if o["type"] == "P" and o["side"] == "long" and o["strike"] is not None}
    long_puts = {}
    for option in options:
        if option["type"] == "P" and option["side"] == "long" and option["strike"] is not None:
            long_puts.setdefault(key(option), []).append(option["strike"])
    short_calls = sum(o["type"] == "C" and o["side"] == "short" and (key(o), o["strike"]) not in long_put_strikes
                      for o in options)
    short_puts = 0
    for option in options:
        if option["type"] != "P" or option["side"] != "short":
            continue
        if (key(option), option["strike"]) in long_calls:
            continue
        if option["strike"] is not None and any(strike > option["strike"] for strike in long_puts.get(key(option), [])):
            continue
        short_puts += 1
    return {"positions": len(options), "short_calls": short_calls, "short_puts": short_puts,
            "long_only": short_calls == 0 and short_puts == 0
            and any(o["side"] == "long" for o in options),
            "unknown_side": sum(o["side"] == "unknown" for o in options)}


def strategy_from_holdings(summary, as_of=None):
    """The answer the holdings give to "does it sell options?", or None."""
    if not summary or not (summary["short_calls"] or summary["short_puts"]):
        return None
    when = f" (as of {as_of})" if as_of else ""
    calls, puts = summary["short_calls"], summary["short_puts"]
    if calls and puts:
        answer, label = "both", "Writes calls and puts (from holdings)"
    elif calls:
        answer, label = "calls", "Writes call options (from holdings)"
    else:
        answer, label = "puts", "Writes put options (from holdings)"
    counted = " and ".join(part for part in (
        f"{calls} written call position{'s' if calls != 1 else ''}" if calls else "",
        f"{puts} written put position{'s' if puts != 1 else ''}" if puts else "") if part)
    reason = f"Its disclosed holdings{when} include {counted}."
    if answer == "puts":
        reason += (" Put sellers get the capital, payout and reference review; the covered-call eroder label applies only "
                   "to call sellers.")
    else:
        reason += " It is screened as a call-income fund."
    return {"answer": answer, "kind": "covered_call" if calls else "capital_review", "label": label, "reason": reason}


def name_says_option_income(info):
    """True when the stored category, scanner tag or fund name says option income."""
    profile = info.get("security_profile") or {}
    text = _text(info, profile)
    category = str(profile.get("category") or profile.get("etf_category") or "").strip()
    return (str(profile.get("fund_kind") or "").lower() == "option_income" or category == "Derivative Income"
            or str(profile.get("etf_strategy") or "").strip().upper() == "OPTIONS INCOME"
            or bool(OPTION_WORDS.search(text) and not (BOND_WORDS.search(text) and "OPTION" not in text)))


def _text(info, profile):
    parts = [info.get("description") or "", *(profile.get("names") or [])]
    return " ".join(str(part) for part in parts if part).upper().replace("’", "'")


def _first(patterns, text):
    for pattern, *rest in patterns:
        if re.search(pattern, text):
            return rest
    return None


def _single_stock(text):
    paren = re.search(r"\(([A-Z]{1,5})\)", text)
    if paren and paren.group(1) not in {"ETF", "ETN", "USD"}:
        return paren.group(1)
    for symbol, pattern in SINGLE_STOCKS.items():
        if re.search(pattern, text):
            return symbol
    return None


def _guide(kind, family, *, reference=None, weight=1.0, reason=None, fit=INFERRED_FIT, strategy=None,
           evidence="", crypto=False, not_applicable_reason=None):
    legs = [{"symbol": reference, "weight": weight}] if reference else []
    label = reference if weight == 1 else f"{weight:.0%} {reference}" if reference else None
    note = ("This holding is not in the reviewed fund list. Its type, strategy and reference were inferred from "
            f"{evidence or 'its stored data'}; check the issuer's documents before relying on them.")
    row = {
        "family": family, "suggestion": reference, "source_url": None, "source_checked": None,
        "guidance": note,
        "limitations": "Inferred automatically, not issuer-verified. Open Advanced to choose another reference.",
        "suggested_direction": f"{label}: {reason}" if reference else "No automatic reference could be inferred",
        "security_kind": kind, "inferred": True, "inferred_from": evidence,
    }
    if reference:
        row.update(automatic_legs=legs, automatic_label=label, automatic_fit=fit,
                   automatic_reason=f"{reason[0].upper()}{reason[1:]} (inferred from {evidence})." if reason else None,
                   automatic_version="inferred-v1")
    if strategy:
        row["screen_strategy"] = strategy
    if crypto:
        row["crypto_related"] = True
    if not_applicable_reason:
        row["not_applicable_reason"] = not_applicable_reason
    return row


def _security_kind(ticker, text, profile, user_type):
    quote = str(profile.get("quote_type") or "").upper()
    sec_type = str(profile.get("security_type") or "").upper()
    asset_type = str(profile.get("asset_type") or "").upper()
    strategy = str(profile.get("etf_strategy") or "").upper()
    source = str(profile.get("profile_source") or "").lower()
    category = profile.get("category") or profile.get("etf_category") or ""
    if (quote == "MONEYMARKET" or sec_type == "MONEYMARKET" or user_type == "MONEYMARKET" or "money market" in category.lower()
            or re.fullmatch(r"[A-Z]{3}XX", ticker) or re.search(r"MONEY ?(MKT|MARKET)|\bMMKT\b", text)):
        return "cash"
    if user_type == "BDC" or strategy == "BDC" or "BUSINESS DEVELOPMENT" in text:
        return "bdc"
    if sec_type == "CEF" or strategy == "CEF" or source.startswith("cefconnect") or user_type == "CEF":
        return "cef"
    fund_meta = (quote in {"ETF", "MUTUALFUND"} or sec_type in {"ETF", "MUTUALFUND"} or asset_type in {"ETF", "FUND", "MUTUAL FUND"}
                 or bool(category) or bool(profile.get("fund_kind")))
    if fund_meta:
        return "fund"
    if FUND_WORDS.search(text):
        return "fund"
    stock_meta = asset_type == "STOCK" or (quote == "EQUITY" and sec_type in {"", "EQUITY", "NONE"})
    company = COMPANY_WORDS.search(text) and not (re.search(r"\bINC\b", text) and INCOME_WORDS.search(text)
                                                  and not re.search(r"\b(CORP|CORPORATION|LTD|PLC|ADR)\b", text))
    if stock_meta or PREFERRED_SECURITY.search(text) and not WEAK_FUND_WORDS.search(text):
        return "stock"
    if company:
        return "stock"
    if WEAK_FUND_WORDS.search(text) or INCOME_WORDS.search(text):
        return "fund"
    return None


def _reference(ticker, text, category, option_income):
    """(asset class, symbol, weight, description, evidence, fit) or None."""
    crypto = _first(CRYPTO, text)
    if crypto:
        return ("crypto", crypto[0], 1.0, crypto[1], "the fund name", INFERRED_FIT)
    if option_income:
        stock = _single_stock(text)
        if stock:
            return ("equity", stock, 1.0, f"{stock}, the stock its options are written on", "the fund name", INFERRED_FIT)
    index = _first(INDEXES, text)
    if index:
        return ("equity", index[0], 1.0, index[1], "the fund name", INFERRED_FIT)
    mapped = CATEGORY_REFERENCES.get(category)
    if mapped:
        return (mapped[0], mapped[1], 1.0, mapped[2], f"the fund category “{category}”", INFERRED_FIT)
    bond = _first(BONDS, text) if BOND_WORDS.search(text) or re.search(r"PREFERRED|\bPFD\b|TIPS|INFLATION|T-?BILL", text) else None
    if bond:
        return (bond[0], bond[1], 1.0, bond[2], "the fund name", INFERRED_FIT)
    theme = _first(THEMES, text)
    if theme:
        return ("equity", theme[0], 1.0, theme[1], "the fund name", INFERRED_FIT)
    if ALTERNATIVE_WORDS.search(text) or category in {"Long-Short Equity"}:
        if re.search(r"LONG[ /-]?SHORT", text) or category == "Long-Short Equity":
            return ("alternative", "SPY", 0.5, "the S&P 500 at 50%, a typical long/short net exposure",
                    "the fund name" if not category else f"the fund category “{category}”", BROAD_FIT)
        return None
    allocation = _first(ALLOCATIONS, text)
    if allocation:
        return ("allocation", allocation[0], 1.0, allocation[1], "the fund name", INFERRED_FIT)
    style = _first(STYLES, text)
    if style:
        return ("equity", style[0], 1.0, style[1], "the fund name", INFERRED_FIT)
    # A stock fund in a category the table above does not map (for example
    # "Miscellaneous Sector") still gets broad market context.
    equity_category = category and not re.match(r"Commodities|Digital|Trading|Muni|Single Currency|.*Bond", category)
    if option_income or equity_category or re.search(r"\b(EQUITY|EQT|STOCK|STK)\b", text):
        return ("equity", "SPY", 1.0, "broad US large-cap stocks",
                f"the fund category “{category}”" if equity_category else "the fund type", BROAD_FIT)
    return None


def infer_guidance(ticker, info):
    """Registry-shaped guidance inferred for a holding, or None without evidence."""
    profile = info.get("security_profile") or {}
    text = _text(info, profile)
    user_type = str(info.get("classification_type") or "").strip().upper()
    category = str(profile.get("category") or profile.get("etf_category") or "").strip()
    strategy_tag = str(profile.get("etf_strategy") or "").strip().upper()
    if not (text or category or profile):
        return None
    kind = _security_kind(ticker, text, profile, user_type)
    if kind is None:
        return None
    if kind == "cash":
        return _guide("cash", "Money market fund", evidence="its quote type and name",
                      not_applicable_reason="A money-market fund holds a stable $1 NAV; the NAV erosion screen does not apply.")
    if kind == "stock":
        preferred = PREFERRED_SECURITY.search(text) and not FUND_WORDS.search(text)
        return _guide("stock", "Operating-company stock", evidence="its quote type and name",
                      not_applicable_reason=(
                          ("An individual preferred security" if preferred else "An operating-company stock")
                          + " has no fund NAV to assess. Detected automatically from its name and quote type; "
                            "choose Include (manual) if it is actually a fund."))
    if kind == "bdc":
        return _guide("bdc", "Quarterly BDC NAV", reference="BIZD", reason="listed business development companies",
                      evidence="its BDC classification")

    option_income = (str(profile.get("fund_kind") or "").lower() == "option_income" or category == "Derivative Income"
                     or strategy_tag == "OPTIONS INCOME"
                     or (OPTION_WORDS.search(text) and not (BOND_WORDS.search(text) and "OPTION" not in text)))
    if kind == "cef":
        option_income = option_income or bool(CEF_OPTION_WORDS.search(text))
    leveraged = bool(LEVERAGED_WORDS.search(text)) or category.startswith("Trading--")
    # "Long/short" equity funds are net long; only a short-only fund is inverse.
    inverse = bool(INVERSE_WORDS.search(text)) and not re.search(r"LONG[ /-]?SHORT", text)
    found = None if inverse else _reference(ticker, text, category, option_income)
    if leveraged and not option_income:
        found = None
    if found and found[1] == ticker:
        alternate = ALTERNATES.get(ticker)
        found = found[:1] + (alternate,) + found[2:] if alternate else None
    asset, symbol, weight, description, evidence, fit = found or (None, None, 1.0, None, "its stored data", INFERRED_FIT)
    if symbol in COMMODITY_REFERENCES and asset == "equity":
        asset = "commodity"
    if leveraged and option_income and symbol:
        fit = "Unlevered underlying context — inferred"
    if "BOOSTED" in text and symbol:
        fit = "Unboosted market context — inferred"

    if option_income:
        source = ("its option-income category" if category == "Derivative Income" or strategy_tag == "OPTIONS INCOME"
                  else "the fund name")
        strategy = {"kind": "covered_call", "label": "Option-income strategy (inferred)",
                    "reason": f"Treated as an equity/asset call-income fund, inferred from {source}. Put-write, collar "
                              "and buffer funds share that category; check the issuer's strategy before acting on a label."}
        family = "Option-income fund (inferred)"
    else:
        labels = {"equity": "Equity fund", "bond": "Bond fund", "commodity": "Commodity fund", "crypto": "Crypto fund",
                  "allocation": "Allocation fund", "alternative": "Alternative-strategy fund"}
        family = ("Leveraged, inverse or trading product (inferred)" if leveraged or inverse else
                  f"{labels[asset]} (inferred)" if asset else "Fund (strategy not inferred)")
        # A plain fund lagging its reference is relative performance, not
        # erosion; it is flagged only when payouts also repeatedly exceeded
        # what the reference earned.
        strategy = {"kind": "capital_review", "label": family, "payout_driven_only": kind != "cef",
                    "reason": "Not an option-income strategy, so it cannot receive a covered-call eroder label. Capital, "
                              "payout and reference metrics still apply."}
    if kind == "cef":
        # The exact family string routes the holding to the CEF NAV source.
        family = "Published CEF NAV"
        if not option_income:
            strategy["label"] = "Closed-end fund (inferred)"
    reason = description
    if inverse:
        reason = None
    guide = _guide(kind, family, reference=symbol, weight=weight, reason=reason, fit=fit, strategy=strategy,
                   evidence=evidence, crypto=asset == "crypto")
    if inverse or (leveraged and not symbol):
        guide["suggested_direction"] = "Leveraged or inverse exposure: define a custom daily basket under Advanced"
    return guide
