"""Distributions page for a Portfolio Builder model portfolio.

A Builder model has no payment records, trades or DRIP settings, only a
dollar amount per ticker. Its income is modeled: each fund's own historical
distributions (per share, split-consistent, from the same market history the
Distribution Analyzer reads) times the shares the model buys at the latest
close. That is the Builder's own share count (dollars / price, fractional).

Share counts are held constant back through history, the way the Portfolio
Income tab applies trailing distributions to today's shares. A fund that had
not started trading in a year simply pays nothing in it, and the payload says
which holdings those are.

Market history dates distributions by ex-date. Where the user's own payment
records show how many days a fund pays after its ex-date, the modeled payment
is moved by that median lag, so months line up with the real Monthly Income
tab; otherwise it is dated on the ex-date.
"""

from bisect import bisect_right
from collections import defaultdict
from datetime import date, timedelta
from statistics import median

from distribution_analysis import CADENCES, _cadence
from special_distributions import special_flags

# A recorded payment further than this after the nearest ex-date is not
# evidence of the fund's pay timing (a missed ex-date, a special payout).
MAX_PAY_LAG_DAYS = 40
MIN_LAG_SAMPLES = 3
# A fund whose newest distribution is older than this no longer pays.
STALE_PAYER_DAYS = 400
MODEL_ACCOUNT_ID = 0


def _day(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number and number not in (float("inf"), float("-inf")) else 0.0


def _money(value):
    return round(float(value or 0), 2)


def _business_day(day):
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def model_positions(holdings, markets, today=None, descriptions=None):
    """One position per model holding: shares = dollars / latest close.

    ``holdings`` are Builder rows ({ticker, dollar_amount}); ``markets`` maps
    ticker -> market payload (prices, distributions) or None when it could not
    be loaded. A holding without a price gets no shares and is reported as
    unavailable rather than guessed at.
    """
    today = today or date.today()
    descriptions = descriptions or {}
    positions = []
    for holding in holdings:
        ticker = str(holding.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        amount = _num(holding.get("dollar_amount"))
        payload = markets.get(ticker) or {}
        prices = sorted((day, close) for point in payload.get("prices") or ()
                        if (day := _day(point.get("date"))) is not None and day <= today
                        and (close := _num(point.get("close"))) > 0)
        distributions = sorted((day, cash) for point in payload.get("distributions") or ()
                               if (day := _day(point.get("date"))) is not None and day <= today
                               and (cash := _num(point.get("amount"))) > 0)
        price = prices[-1][1] if prices else None
        positions.append({
            "ticker": ticker,
            "description": descriptions.get(ticker) or "",
            "amount": amount,
            "price": price,
            "price_date": prices[-1][0] if prices else None,
            "first_date": prices[0][0] if prices else None,
            "shares": amount / price if price else 0.0,
            "distributions": distributions,
            "available": bool(prices),
        })
    return positions


def observed_pay_lags(payment_dates, positions):
    """Median days from ex-date to payment, from the user's own payment records.

    ``payment_dates`` maps ticker -> recorded payment dates. Each payment is
    matched to the nearest market ex-date on or before it; a ticker needs a
    few matches before its lag is trusted.
    """
    lags = {}
    for position in positions:
        ex_days = [day for day, _ in position["distributions"]]
        if not ex_days:
            continue
        samples = []
        for paid in payment_dates.get(position["ticker"], ()):
            paid = _day(paid)
            if paid is None:
                continue
            index = bisect_right(ex_days, paid)
            if index and (gap := (paid - ex_days[index - 1]).days) <= MAX_PAY_LAG_DAYS:
                samples.append(gap)
        if len(samples) >= MIN_LAG_SAMPLES:
            lags[position["ticker"]] = int(round(median(samples)))
    return lags


def modeled_payments(position, lag=None, today=None):
    """Each historical distribution paid on the model's share count.

    A distribution already past its ex-date but not yet paid is ``pending``:
    the model is entitled to it, the cash has not arrived.
    """
    today = today or date.today()
    shares = position["shares"]
    out = []
    if shares <= 0:
        return out
    for ex, per_share in position["distributions"]:
        pay = _business_day(ex + timedelta(days=lag or 0))
        out.append({"ticker": position["ticker"], "ex": ex, "pay": pay, "per_share": per_share,
                    "amount": per_share * shares, "pending": pay > today})
    return out


def model_income_estimate(position, today=None):
    """Latest payout run rate for the model's shares, like a holding's estimate.

    Returns (latest per-share payout, cadence code, annual income). A fund
    whose newest payout is more than a year old has stopped paying.
    """
    today = today or date.today()
    distributions = position["distributions"]
    if not distributions or position["shares"] <= 0:
        return 0.0, None, 0.0
    if (today - distributions[-1][0]).days > STALE_PAYER_DAYS:
        return 0.0, None, 0.0
    # A one-off special is left out of the rate (rule chosen 2026-11-27): the
    # latest *regular* payout × cadence. A single $2.01 special against a usual
    # $0.14 a month had been annualized x12.
    flags = special_flags([cash for _, cash in distributions])
    regular = [item for item, special in zip(distributions, flags) if not special] or distributions
    last_day, latest = regular[-1]
    days = [day for day, _ in regular]
    code = _cadence([(b - a).days for a, b in zip(days, days[1:])][-3:])
    per_year = CADENCES.get(code, (None, None))[1]
    if per_year:
        annual = latest * per_year * position["shares"]
    else:
        annual = sum(cash for day, cash in regular if (last_day - day).days < 365) * position["shares"]
    return latest, code, annual


def model_holding_rows(positions, categories=None, today=None):
    """Holdings-shaped rows (the fields the Distributions page reads)."""
    today = today or date.today()
    categories = categories or {}
    total = sum(p["amount"] for p in positions if p["shares"] > 0)
    rows = []
    for position in positions:
        latest, code, annual = model_income_estimate(position, today)
        value = position["shares"] * position["price"] if position["price"] else None
        category = categories.get(position["ticker"]) or {}
        rows.append({
            "ticker": position["ticker"],
            "description": position["description"],
            "quantity": round(position["shares"], 6),
            "price": position["price"],
            "price_date": position["price_date"].isoformat() if position["price_date"] else None,
            "current_value": _money(value) if value is not None else None,
            "purchase_value": _money(position["amount"]),
            "original_purchase_value": _money(position["amount"]),
            "div": latest,
            "div_frequency": code,
            "estim_payment_per_year": _money(annual),
            "category": category.get("category"),
            "subcategory": category.get("subcategory"),
            "subcategory_id": category.get("subcategory_id"),
            "percent_of_account": round(position["amount"] / total * 100, 4) if total > 0 and position["shares"] > 0 else 0.0,
            "reinvest": None,
            "first_date": position["first_date"].isoformat() if position["first_date"] else None,
            "available": position["available"],
            "model": True,
        })
    return rows


def build_model_distribution_history(positions, lags=None, year=None, today=None):
    """The Monthly Income / Income Floor payload for a model, modeled.

    Same shape as ``distribution_analysis.build_distribution_history``:
    ``actual`` holds modeled payments already paid, ``estimated`` the ones
    past their ex-date but not yet paid. Realized gains do not exist.
    """
    today = today or date.today()
    year = today.year if year is None else year
    if not 1900 <= year <= today.year:
        raise ValueError("Select a year between 1900 and the current year.")
    lags = lags or {}
    row_map = defaultdict(lambda: {"actual": [0.0] * 12, "estimated": [0.0] * 12})
    annual = defaultdict(lambda: {"actual": 0.0, "estimated": 0.0, "realized_gain": None})
    prior = {"actual": None, "estimated": None}
    past_30 = {"actual": 0.0, "estimated": 0.0}
    window_start = today - timedelta(days=29)
    year_options = {today.year, year}
    current_month = (today.year, today.month)
    for position in positions:
        for payment in modeled_payments(position, lags.get(position["ticker"]), today):
            pay = payment["pay"]
            if (pay.year, pay.month) > current_month:
                continue
            kind = "estimated" if payment["pending"] else "actual"
            amount = payment["amount"]
            year_options.add(pay.year)
            annual[pay.year][kind] += amount
            if (pay.year, pay.month) == (year - 1, 12):
                prior[kind] = (prior[kind] or 0) + amount
            if pay.year == year:
                row_map[position["ticker"]][kind][pay.month - 1] += amount
            if window_start <= pay <= today:
                past_30[kind] += amount

    elapsed = today.month if year == today.year else 12
    rows = [
        {"ticker": ticker, **{kind: [_money(v) if i < elapsed else None for i, v in enumerate(values)]
                              for kind, values in amounts.items()}}
        for ticker, amounts in sorted(row_map.items())
    ]
    yearly = [{"year": yr, "actual": _money(v["actual"]), "estimated": _money(v["estimated"]),
               "realized_gain": None} for yr, v in sorted(annual.items())]
    year_start = date(year, 1, 1)
    priced = [p for p in positions if p["available"]]
    payers = [p for p in priced if p["distributions"]]
    return {
        "year": year, "years": sorted(year_options, reverse=True), "as_of": today.isoformat(),
        "rows": rows, "previous_december": {k: _money(v) if v is not None else None for k, v in prior.items()},
        "yearly": yearly, "past_30_days": {k: _money(v) for k, v in past_30.items()},
        "excluded_duplicate_estimates": {"count": 0, "amount": 0.0, "tickers": []},
        "model": {
            "holdings": len(positions),
            "invested": _money(sum(p["amount"] for p in priced)),
            "price_date": max((p["price_date"] for p in priced), default=None).isoformat() if priced else None,
            # Started trading after this year began, so the year is partial or empty for them.
            "late_starters": [{"ticker": p["ticker"], "first_date": p["first_date"].isoformat()}
                              for p in sorted(priced, key=lambda p: p["first_date"]) if p["first_date"] > year_start],
            "unavailable": sorted(p["ticker"] for p in positions if not p["available"]),
            "pay_dates_from_records": sorted(p["ticker"] for p in payers if p["ticker"] in lags),
            "pay_dates_on_ex_date": sorted(p["ticker"] for p in payers if p["ticker"] not in lags),
        },
    }


def model_payment_records(positions, lags=None, today=None):
    """Modeled payments as DRIP ledger payment records, keyed like the real ones."""
    today = today or date.today()
    lags = lags or {}
    records = defaultdict(list)
    for position in positions:
        for payment in modeled_payments(position, lags.get(position["ticker"]), today):
            if payment["pending"]:
                continue
            records[(MODEL_ACCOUNT_ID, position["ticker"])].append({
                "day": payment["pay"], "ex": payment["ex"], "amount": payment["amount"],
                "source": "model", "profile_id": MODEL_ACCOUNT_ID,
            })
    return records
