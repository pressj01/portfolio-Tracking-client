"""Intrinsic-value engine for the Stock Valuation (DCF) screen.

Pure, testable functions — no Flask, no network. The Flask layer (``app.py``)
fetches the yfinance ``info`` blob plus the balance sheet / income statement /
cash-flow statement, cleans the numbers, and feeds them in here. This module
turns those numbers into:

  * a two-stage discounted-cash-flow intrinsic value,
  * multiples-implied fair values (forward P/E, P/B, P/S) and a dividend
    discount model for payers,
  * a blended intrinsic value with a per-method breakdown,
  * an Undervalued / Fair / Overvalued verdict with a margin-of-safety %,
  * derived ratios that yfinance often omits (FCF yield, debt ratio, interest
    coverage, payout / PEG / ROE / ROA fallbacks), and
  * a quality & risk scorecard (profitability, leverage, risk-adjusted return).

Risk-ratio math (Sharpe / Sortino / Calmar / Omega) is reused from ``grading``.

Simplifications, documented where they matter:
  * The DCF treats yfinance ``freeCashflow`` as firm-level free cash flow (FCFF)
    and bridges to equity value with net cash (total cash − total debt).
  * The discount rate is CAPM cost of equity, not a full WACC (no reliable
    cost-of-debt from yfinance); the caller exposes it as an editable input so
    the user can substitute a WACC.
"""

import statistics

from grading import _sharpe, _sortino, _calmar, _omega


# A compact slice of the sector baselines in src/utils/stockGrading.js — only the
# three multiples used to derive a "fair" price. Kept on the Python side so the
# valuation backend is self-contained. Values are intentionally conservative
# (a "fair", not aspirational, multiple).
SECTOR_FAIR_MULTIPLES = {
    "Technology":             {"forward_pe": 26, "price_to_book": 6.0, "price_to_sales": 6.0},
    "Communication Services": {"forward_pe": 18, "price_to_book": 3.0, "price_to_sales": 3.0},
    "Healthcare":             {"forward_pe": 18, "price_to_book": 4.0, "price_to_sales": 4.0},
    "Financial Services":     {"forward_pe": 12, "price_to_book": 1.4, "price_to_sales": 3.0},
    "Consumer Cyclical":      {"forward_pe": 17, "price_to_book": 4.0, "price_to_sales": 1.5},
    "Consumer Defensive":     {"forward_pe": 19, "price_to_book": 4.0, "price_to_sales": 1.5},
    "Industrials":            {"forward_pe": 18, "price_to_book": 4.0, "price_to_sales": 2.0},
    "Energy":                 {"forward_pe": 11, "price_to_book": 1.8, "price_to_sales": 1.2},
    "Utilities":              {"forward_pe": 16, "price_to_book": 1.8, "price_to_sales": 2.5},
    "Real Estate":            {"forward_pe": 28, "price_to_book": 2.0, "price_to_sales": 6.0},
    "Basic Materials":        {"forward_pe": 13, "price_to_book": 2.0, "price_to_sales": 1.5},
    "Default":                {"forward_pe": 18, "price_to_book": 3.0, "price_to_sales": 3.0},
}


def sector_fair_multiples(sector):
    """Fair forward-P/E, P/B and P/S for a sector (falls back to the default)."""
    return SECTOR_FAIR_MULTIPLES.get(sector or "", SECTOR_FAIR_MULTIPLES["Default"])


# ── small numeric helpers ────────────────────────────────────────────────────

def _num(value):
    """Coerce to a finite float or None."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return f


def _safe_div(a, b):
    a = _num(a)
    b = _num(b)
    if a is None or b is None or b == 0:
        return None
    return a / b


def _round(value, digits=2):
    v = _num(value)
    return None if v is None else round(v, digits)


# ── derived ratios (computed when yfinance omits them) ───────────────────────

def fcf_yield_pct(free_cash_flow, market_cap):
    """Free cash flow as a % of market cap. Higher = cheaper on a cash basis."""
    r = _safe_div(free_cash_flow, market_cap)
    return None if r is None else round(r * 100, 2)


def debt_ratio(total_debt, total_assets):
    """Total debt / total assets (0–1+)."""
    return _round(_safe_div(total_debt, total_assets), 3)


def interest_coverage(ebit, interest_expense):
    """EBIT / interest expense. yfinance reports interest expense as a positive or
    negative magnitude depending on version, so the absolute value is used."""
    ie = _num(interest_expense)
    if ie is not None:
        ie = abs(ie)
    return _round(_safe_div(ebit, ie), 2)


def payout_ratio_pct(dividend_per_share, eps):
    """Dividend payout ratio as a %. Fallback when yfinance omits payoutRatio."""
    r = _safe_div(dividend_per_share, eps)
    return None if r is None else round(r * 100, 2)


def peg_ratio(forward_pe, earnings_growth_pct):
    """PEG = forward P/E ÷ growth%. ``earnings_growth_pct`` is in percent units
    (e.g. 12.0 for 12%). Fallback when yfinance omits pegRatio."""
    return _round(_safe_div(forward_pe, earnings_growth_pct), 2)


def roe_pct(net_income, shareholder_equity):
    r = _safe_div(net_income, shareholder_equity)
    return None if r is None else round(r * 100, 2)


def roa_pct(net_income, total_assets):
    r = _safe_div(net_income, total_assets)
    return None if r is None else round(r * 100, 2)


# ── intrinsic-value methods ──────────────────────────────────────────────────

def capm_cost_of_equity(beta, risk_free=0.045, equity_risk_premium=0.05):
    """CAPM cost of equity = rf + β·ERP. Used as the DCF discount-rate default.
    A missing/odd beta falls back to 1.0 (market risk)."""
    b = _num(beta)
    if b is None or b <= 0:
        b = 1.0
    return round(risk_free + b * equity_risk_premium, 4)


def discounted_cash_flow(base_fcf, growth, discount, terminal_growth, years,
                         net_cash=0.0, shares=None):
    """Two-stage DCF.

    Stage 1: ``base_fcf`` grows at ``growth`` for ``years``, each year discounted
    at ``discount``. Stage 2: a Gordon-growth terminal value at
    ``terminal_growth``, discounted back. Enterprise value = ΣPV + PV(terminal);
    equity value = enterprise value + ``net_cash``; per-share = ÷ ``shares``.

    Returns a dict (assumptions, per-year projection, enterprise/equity value,
    intrinsic value per share) or None if the inputs cannot produce a value.
    """
    base = _num(base_fcf)
    growth = _num(growth)
    discount = _num(discount)
    terminal_growth = _num(terminal_growth)
    shares = _num(shares)
    net_cash = _num(net_cash) or 0.0
    try:
        years = int(years)
    except (TypeError, ValueError):
        return None

    # DCF is only meaningful with positive cash flow, a positive share count, and
    # a discount rate above the terminal growth rate (else the Gordon term blows up).
    if base is None or base <= 0 or shares is None or shares <= 0:
        return None
    if growth is None or discount is None or terminal_growth is None:
        return None
    if years < 1 or discount <= terminal_growth:
        return None

    # Stage-1 growth fades linearly from `growth` (year 1) down to
    # `terminal_growth` (final year) rather than holding flat. A constant high
    # growth rate held for the whole horizon massively overstates mega-caps whose
    # near-term growth is elevated (often off a depressed earnings base); the fade
    # converges smoothly into the terminal value and keeps the result realistic.
    projection = []
    pv_sum = 0.0
    fcf = base
    for yr in range(1, years + 1):
        if years > 1:
            g_yr = growth + (terminal_growth - growth) * (yr - 1) / (years - 1)
        else:
            g_yr = growth
        fcf = fcf * (1 + g_yr)
        pv = fcf / ((1 + discount) ** yr)
        pv_sum += pv
        projection.append({"year": yr, "fcf": round(fcf, 2), "pv": round(pv, 2), "growth": round(g_yr, 4)})

    terminal_value = fcf * (1 + terminal_growth) / (discount - terminal_growth)
    pv_terminal = terminal_value / ((1 + discount) ** years)
    enterprise_value = pv_sum + pv_terminal
    equity_value = enterprise_value + net_cash
    per_share = equity_value / shares

    return {
        "assumptions": {
            "growth": round(growth, 4),
            "discount": round(discount, 4),
            "terminal": round(terminal_growth, 4),
            "years": years,
        },
        "projection": projection,
        "enterprise_value": round(enterprise_value, 2),
        "equity_value": round(equity_value, 2),
        "terminal_value": round(terminal_value, 2),
        "value": round(per_share, 2) if per_share > 0 else None,
    }


def fair_value_from_multiple(fair_multiple, per_share_metric):
    """fair price = fair multiple × a per-share metric (EPS / book / sales)."""
    m = _num(fair_multiple)
    x = _num(per_share_metric)
    if m is None or x is None or m <= 0 or x <= 0:
        return None
    return round(m * x, 2)


def dividend_discount_value(annual_dividend, discount, growth):
    """Gordon dividend discount model: D1 / (r − g), where D1 = next year's
    dividend = current annual dividend × (1 + g). Requires r > g and a dividend."""
    d0 = _num(annual_dividend)
    r = _num(discount)
    g = _num(growth)
    if d0 is None or d0 <= 0 or r is None or g is None or r <= g:
        return None
    d1 = d0 * (1 + g)
    return round(d1 / (r - g), 2)


def blend_intrinsic_value(methods, trim_ratio=3.0):
    """Blend per-method intrinsic values into one number.

    ``methods``: list of {"name", "value", "weight"}. Entries with no value are
    dropped. Gross outliers — a method more than ``trim_ratio``× above or below
    the median of the methods — are excluded from the blend (e.g. a sector P/S
    multiple applied to a very-low-margin company), so one wild estimate can't
    drag the result. Excluded methods are still returned (flagged) for
    transparency. Confidence reflects how tightly the surviving methods agree.
    """
    present = [m for m in methods if _num(m.get("value")) is not None and _num(m.get("value")) > 0]
    if not present:
        return {"value": None, "low": None, "high": None, "methods": [], "confidence": "none"}

    def _val(m):
        return _num(m["value"])

    values = [_val(m) for m in present]
    excluded_ids = set()
    if len(present) >= 3:
        med = statistics.median(values)
        if med and med > 0:
            kept = [m for m in present if (med / trim_ratio) <= _val(m) <= (med * trim_ratio)]
            if len(kept) >= 2:
                kept_ids = {id(m) for m in kept}
                excluded_ids = {id(m) for m in present if id(m) not in kept_ids}
    blend_set = [m for m in present if id(m) not in excluded_ids]

    total_w = sum(max(_num(m.get("weight")) or 0.0, 0.0) for m in blend_set)
    if total_w <= 0:
        total_w = float(len(blend_set))
        for m in blend_set:
            m["weight"] = 1.0

    blended = 0.0
    out_methods = []
    for m in present:
        is_excl = id(m) in excluded_ids
        w = 0.0 if is_excl else max(_num(m.get("weight")) or 0.0, 0.0) / total_w
        if not is_excl:
            blended += w * _val(m)
        out_methods.append({
            "name": m["name"], "value": round(_val(m), 2),
            "weight_pct": round(w * 100, 1), "excluded": is_excl,
        })

    kept_values = [_val(m) for m in blend_set]
    lo, hi = min(kept_values), max(kept_values)
    spread = (hi / lo) if lo > 0 else None
    confidence = (
        "high" if (spread is not None and spread <= 1.5)
        else "medium" if (spread is not None and spread <= 2.5)
        else "low"
    )
    return {
        "value": round(blended, 2),
        "low": round(lo, 2),
        "high": round(hi, 2),
        "confidence": confidence,
        "methods": out_methods,
    }


def valuation_verdict(price, intrinsic, fair_band=0.15):
    """Compare price to intrinsic value.

    Margin of safety = (intrinsic − price) / intrinsic. Outside ±``fair_band``
    the stock reads Undervalued (cheaper than worth) or Overvalued; inside, Fair.
    """
    p = _num(price)
    iv = _num(intrinsic)
    if p is None or iv is None or iv <= 0 or p <= 0:
        return {"label": "Unknown", "tone": "info", "margin_of_safety_pct": None,
                "upside_pct": None, "detail": "Not enough data to estimate fair value."}

    mos = (iv - p) / iv
    upside = (iv - p) / p
    if mos > fair_band:
        label, tone = "Undervalued", "pass"
    elif mos < -fair_band:
        label, tone = "Overvalued", "fail"
    else:
        label, tone = "Fairly Valued", "warn"

    detail = (
        f"Estimated fair value {iv:,.2f} vs current price {p:,.2f} — "
        f"a {abs(upside) * 100:.1f}% {'discount' if upside > 0 else 'premium'} "
        f"to intrinsic value."
    )
    return {
        "label": label, "tone": tone,
        "margin_of_safety_pct": round(mos * 100, 1),
        "upside_pct": round(upside * 100, 1),
        "detail": detail,
    }


# ── risk-adjusted ratios (reuse grading.py) ──────────────────────────────────

def risk_ratios(close):
    """Sharpe / Sortino / Calmar / Omega from a daily close price Series.

    ``close`` is a pandas Series; ``grading._omega`` expects daily returns, so
    they are derived here. Returns None for any ratio that can't be computed.
    """
    out = {"sharpe": None, "sortino": None, "calmar": None, "omega": None}
    if close is None:
        return out
    try:
        if len(close) < 30:
            return out
    except TypeError:
        return out
    out["sharpe"] = _sharpe(close)
    out["sortino"] = _sortino(close)
    out["calmar"] = _calmar(close)
    try:
        out["omega"] = _omega(close.pct_change().dropna())
    except Exception:
        out["omega"] = None
    return out


# ── scorecard grading ────────────────────────────────────────────────────────

def _badge(score):
    if score is None:
        return "info"
    return "pass" if score >= 75 else "warn" if score >= 50 else "fail"


def _score_higher(value, warn, good):
    """Higher-is-better metric: <warn fails, [warn,good) warns, ≥good passes."""
    v = _num(value)
    if v is None:
        return None
    if v >= good:
        return 100
    if v >= warn:
        return 60
    return 25


def _score_lower(value, good, warn):
    """Lower-is-better metric: ≤good passes, (good,warn] warns, >warn fails."""
    v = _num(value)
    if v is None:
        return None
    if v <= good:
        return 100
    if v <= warn:
        return 60
    return 25


def _score_lower_vs_benchmark(value, benchmark):
    """Lower-is-better relative to a sector benchmark (PE/PB/PS). Non-positive
    value means no earnings/odd data — a red flag."""
    v = _num(value)
    b = _num(benchmark)
    if v is None:
        return None
    if v <= 0:
        return 25
    if b is None or b <= 0:
        return 60
    r = v / b
    if r <= 0.85:
        return 100
    if r <= 1.15:
        return 70
    if r <= 1.5:
        return 45
    return 25


def _row(label, value, unit, score, benchmark=None, note=None):
    return {
        "label": label,
        "value": _round(value, 3) if unit == "x" else _round(value, 2),
        "unit": unit,
        "score": score,
        "badge": _badge(score),
        "benchmark": _round(benchmark, 2) if benchmark is not None else None,
        "note": note,
    }


def _section(section_id, title, rows):
    scored = [r["score"] for r in rows if r["score"] is not None]
    grade = round(sum(scored) / len(scored)) if scored else None
    return {
        "id": section_id,
        "title": title,
        "rows": rows,
        "grade": {
            "score": grade,
            "tone": _badge(grade),
            "label": (
                "Strong" if grade is not None and grade >= 75
                else "Adequate" if grade is not None and grade >= 50
                else "Weak" if grade is not None else "n/a"
            ),
        },
    }


def valuation_section(forward_pe, peg, price_to_book, price_to_sales,
                      fcf_yield, payout_ratio, sector):
    """Multiples section — graded lower-is-better against sector fair multiples."""
    fair = sector_fair_multiples(sector)
    rows = [
        _row("Forward P/E", forward_pe, "x", _score_lower_vs_benchmark(forward_pe, fair["forward_pe"]), fair["forward_pe"]),
        _row("PEG ratio", peg, "x", _score_lower(peg, 1.0, 2.0) if _num(peg) and _num(peg) > 0 else (25 if _num(peg) is not None else None), 1.0,
             "Fair around 1.0; below 1 is cheap for the growth."),
        _row("Price / Book", price_to_book, "x", _score_lower_vs_benchmark(price_to_book, fair["price_to_book"]), fair["price_to_book"]),
        _row("Price / Sales", price_to_sales, "x", _score_lower_vs_benchmark(price_to_sales, fair["price_to_sales"]), fair["price_to_sales"]),
        _row("FCF yield", fcf_yield, "%", _score_higher(fcf_yield, 3.0, 5.0), 5.0,
             "Free cash flow vs market cap; higher is cheaper."),
        _row("Dividend payout", payout_ratio, "%", _score_lower(payout_ratio, 60.0, 85.0) if _num(payout_ratio) is not None else None, 60.0,
             "Room to keep paying through a downturn under ~60%."),
    ]
    return _section("valuation", "Valuation multiples", rows)


def quality_section(roe, roa, operating_margin, net_margin, gross_margin):
    rows = [
        _row("Return on equity", roe, "%", _score_higher(roe, 8.0, 15.0), 15.0),
        _row("Return on assets", roa, "%", _score_higher(roa, 2.0, 6.0), 6.0),
        _row("Operating margin", operating_margin, "%", _score_higher(operating_margin, 7.0, 15.0), 15.0),
        _row("Net margin", net_margin, "%", _score_higher(net_margin, 5.0, 12.0), 12.0),
        _row("Gross margin", gross_margin, "%", _score_higher(gross_margin, 25.0, 40.0), 40.0),
    ]
    return _section("quality", "Profitability & returns", rows)


def health_section(debt_to_equity, dratio, int_cov, current_ratio):
    rows = [
        # yfinance reports debt/equity on a percent scale (100 = 1.0x).
        _row("Debt / equity", debt_to_equity, "%", _score_lower(debt_to_equity, 80.0, 150.0), 80.0,
             "yfinance scale (100 = 1.0×); banks & utilities run higher."),
        _row("Debt ratio", dratio, "x", _score_lower(dratio, 0.5, 0.7), 0.5,
             "Total debt ÷ total assets."),
        _row("Interest coverage", int_cov, "x", _score_higher(int_cov, 2.0, 5.0), 5.0,
             "EBIT ÷ interest expense; how easily debt is serviced."),
        _row("Current ratio", current_ratio, "x", _score_higher(current_ratio, 1.0, 1.5), 1.5),
    ]
    return _section("health", "Financial health", rows)


def risk_section(sharpe, sortino, calmar, omega):
    rows = [
        _row("Sharpe ratio", sharpe, "", _score_higher(sharpe, 0.5, 1.0), 1.0,
             "Excess return per unit of total volatility."),
        _row("Sortino ratio", sortino, "", _score_higher(sortino, 0.7, 1.5), 1.5,
             "Like Sharpe but penalizes only downside volatility."),
        _row("Calmar ratio", calmar, "", _score_higher(calmar, 0.5, 1.0), 1.0,
             "Annual return ÷ worst drawdown."),
        _row("Omega ratio", omega, "", _score_higher(omega, 1.2, 1.5), 1.5,
             "Probability-weighted gains ÷ losses; >1 favours gains."),
    ]
    return _section("risk", "Risk-adjusted returns (3y)", rows)
