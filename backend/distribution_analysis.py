"""Distribution workspace: recorded portfolio cash and per-share market analysis."""

from bisect import bisect_left
from collections import defaultdict
from datetime import date, timedelta
from math import isfinite
from statistics import mean, median


ESTIMATE_SOURCES = ("refresh_estimate", "projection", "estimate", "estimated")
CADENCES = {"W": ("Weekly", 52), "BW": ("Biweekly", 26), "M": ("Monthly", 12), "Q": ("Quarterly", 4),
            "SA": ("Semiannual", 2), "A": ("Annual", 1), "D": ("Daily", 252)}


def _money(value):
    return round(float(value or 0), 2)


def _unsupported_duplicate_estimates(conn, profile_ids, as_of):
    """Find wrong-account refresh projections with no evidence of ownership.

    Do not deduplicate legitimate payments across accounts. Two accounts can
    own equal shares and get the same cash on the same day. Suppress only a
    refresh estimate with an exact confirmed counterpart in another account
    and no holding, trade, or confirmed payout at all for its own account.
    The ledger itself is not changed; the distribution report exposes these
    excluded projections separately.
    """
    if not profile_ids:
        return []
    marks = ",".join("?" for _ in profile_ids)
    sources = ",".join("?" for _ in ESTIMATE_SOURCES)
    return [dict(row) for row in conn.execute(
        f"""SELECT e.id, e.ticker, e.payment_date, e.amount
            FROM dividend_payments e
            WHERE e.profile_id IN ({marks}) AND e.payment_date <= ?
              AND LOWER(TRIM(COALESCE(e.source, ''))) = 'refresh_estimate'
              AND NOT EXISTS (SELECT 1 FROM all_account_info h
                  WHERE h.profile_id = e.profile_id AND h.ticker = e.ticker COLLATE NOCASE)
              AND NOT EXISTS (SELECT 1 FROM transactions t
                  WHERE t.profile_id = e.profile_id AND t.ticker = e.ticker COLLATE NOCASE)
              AND NOT EXISTS (SELECT 1 FROM dividend_payments own
                  WHERE own.profile_id = e.profile_id AND own.ticker = e.ticker COLLATE NOCASE
                    AND LOWER(TRIM(COALESCE(own.source, ''))) NOT IN ({sources}))
              AND EXISTS (SELECT 1 FROM dividend_payments actual
                  WHERE actual.profile_id != e.profile_id AND actual.ticker = e.ticker COLLATE NOCASE
                    AND actual.payment_date = e.payment_date AND ABS(actual.amount - e.amount) < 0.005
                    AND LOWER(TRIM(COALESCE(actual.source, ''))) NOT IN ({sources}))
            ORDER BY e.payment_date, e.ticker, e.id""",
        [*profile_ids, as_of, *ESTIMATE_SOURCES, *ESTIMATE_SOURCES],
    )]


def build_distribution_history(conn, profile_ids, year=None, today=None):
    """Aggregate the payment ledger once, never backfill it with today's shares."""
    today = today or date.today()
    year = today.year if year is None else year
    if not 1900 <= year <= today.year:
        raise ValueError("Select a year between 1900 and the current year.")
    ids = list(dict.fromkeys(profile_ids))
    marks = ",".join("?" for _ in ids)
    estimate_test = "LOWER(TRIM(COALESCE(source, ''))) IN (?, ?, ?, ?)"
    row_map = defaultdict(lambda: {"actual": [0.0] * 12, "estimated": [0.0] * 12})
    annual = defaultdict(lambda: {"actual": 0.0, "estimated": 0.0, "realized_gain": None})
    prior = {"actual": None, "estimated": None}
    previous_year_dec = f"{year - 1:04d}-12"
    past_30 = {"actual": 0.0, "estimated": 0.0}
    year_options = {today.year, year}
    excluded = _unsupported_duplicate_estimates(conn, ids, today.isoformat())
    excluded_ids = [row["id"] for row in excluded]
    exclude_sql = f" AND id NOT IN ({','.join('?' for _ in excluded_ids)})" if excluded_ids else ""
    if ids:
        for row in conn.execute(
            f"""SELECT UPPER(TRIM(ticker)) AS ticker, SUBSTR(payment_date, 1, 7) AS month,
                       CASE WHEN {estimate_test} THEN 1 ELSE 0 END AS estimated,
                       SUM(amount) AS amount
                FROM dividend_payments WHERE profile_id IN ({marks}) AND payment_date <= ?{exclude_sql}
                GROUP BY 1, 2, 3 ORDER BY 2""",
            [*ESTIMATE_SOURCES, *ids, today.isoformat(), *excluded_ids],
        ):
            try:
                yr, mo = map(int, row["month"].split("-"))
                if not 1900 <= yr <= today.year or not 1 <= mo <= 12:
                    continue
            except (ValueError, AttributeError):
                continue
            kind = "estimated" if row["estimated"] else "actual"
            amount = float(row["amount"] or 0)
            year_options.add(yr)
            annual[yr][kind] += amount
            if row["month"] == previous_year_dec:
                prior[kind] = (prior[kind] or 0) + amount
            if yr == year and row["ticker"]:
                row_map[row["ticker"]][kind][mo - 1] += amount

        for row in conn.execute(
            f"""SELECT CASE WHEN {estimate_test} THEN 1 ELSE 0 END AS estimated,
                       SUM(amount) AS amount FROM dividend_payments
                WHERE profile_id IN ({marks}) AND payment_date BETWEEN ? AND ?{exclude_sql} GROUP BY 1""",
            [*ESTIMATE_SOURCES, *ids, (today - timedelta(days=29)).isoformat(), today.isoformat(), *excluded_ids],
        ):
            past_30["estimated" if row["estimated"] else "actual"] = _money(row["amount"])

        # Same realized-sale definition as the Gains & Losses ledger; transfers
        # are movements, not sales. Missing realized data remains unknown.
        for row in conn.execute(
            f"""SELECT SUBSTR(transaction_date, 1, 4) AS year, SUM(realized_gain) AS gain
                FROM transactions WHERE profile_id IN ({marks}) AND transaction_date <= ?
                  AND UPPER(COALESCE(transaction_type, '')) = 'SELL'
                  AND realized_gain IS NOT NULL
                  AND INSTR(LOWER(COALESCE(notes, '')), '[transfer') = 0
                GROUP BY 1""",
            [*ids, today.isoformat()],
        ):
            try:
                yr = int(row["year"])
                if not 1900 <= yr <= today.year:
                    continue
            except (TypeError, ValueError):
                continue
            year_options.add(yr)
            annual[yr]["realized_gain"] = _money(row["gain"])

    elapsed = today.month if year == today.year else 12
    rows = [
        {"ticker": ticker, **{kind: [_money(v) if i < elapsed else None for i, v in enumerate(values)]
                              for kind, values in amounts.items()}}
        for ticker, amounts in sorted(row_map.items())
    ]
    yearly = [{"year": yr, "actual": _money(v["actual"]), "estimated": _money(v["estimated"]),
               "realized_gain": v["realized_gain"]} for yr, v in sorted(annual.items())]
    excluded_for_year = [row for row in excluded if str(row["payment_date"]).startswith(f"{year:04d}-")]
    return {
        "year": year, "years": sorted(year_options, reverse=True), "as_of": today.isoformat(),
        "rows": rows, "previous_december": {k: _money(v) if v is not None else None for k, v in prior.items()},
        "yearly": yearly, "past_30_days": past_30,
        "excluded_duplicate_estimates": {"count": len(excluded_for_year),
            "amount": _money(sum(float(row["amount"] or 0) for row in excluded_for_year)),
            "tickers": sorted({row["ticker"] for row in excluded_for_year})},
    }


def _number(value):
    try:
        result = float(value)
        return result if isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _cadence(gaps):
    if not gaps:
        return None
    days = median(gaps)
    if days <= 3:
        return "D"
    if days <= 10:
        return "W"
    if days <= 19:
        return "BW"
    if days <= 45:
        return "M"
    if days <= 115:
        return "Q"
    if days <= 240:
        return "SA"
    return "A"


def analyze_distribution_market(market, today=None, frequency_hint=None):
    """Use split-consistent cash/share and the strictly pre-ex-date close.

    Annualize each payout at its observed cadence (the latest three gaps, or
    the first gaps for the earliest payouts), rather than retroactively applying
    a fund's current weekly/monthly schedule to a different historical cadence.
    """
    today = today or date.today()
    if not market or not market.get("prices"):
        return {"status": "unavailable", "message": "No market price history returned."}
    if not market.get("distributions_complete") or not market.get("corporate_actions_resolved"):
        return {"status": "unavailable", "message": "Distribution or split history is incomplete."}

    def dated_values(rows, key):
        result = {}
        for entry in rows:
            try:
                day = date.fromisoformat(str(entry["date"])[:10])
            except (ValueError, KeyError):
                continue
            value = _number(entry.get(key))
            if day <= today and value is not None and value > 0:
                result[day] = result.get(day, 0) + value if key == "amount" else value
        return result

    prices = dated_values(market["prices"], "close")
    if not prices:
        return {"status": "unavailable", "message": "No valid closing prices returned."}
    days = sorted(prices)
    last_day = days[-1]
    payouts = dated_values(market.get("distributions", []), "amount")
    pay_days = sorted(d for d in payouts if d <= last_day)
    provider = {"provider": market.get("provider"), "price_date": last_day.isoformat(),
                "history_start": days[0].isoformat(), "payout_count": len(pay_days)}
    if not pay_days:
        return {**provider, "status": "no_payouts", "message": "No cash payouts in available market history."}

    gaps = [(b - a).days for a, b in zip(pay_days, pay_days[1:])]
    current_code = _cadence(gaps[-3:]) or (frequency_hint if frequency_hint in CADENCES else None)
    current_frequency, per_year = CADENCES.get(current_code, (None, None))
    events = []
    for i, day in enumerate(pay_days):
        idx = bisect_left(days, day) - 1
        # A stale close from weeks before the ex-date is not a valid anchor.
        price = prices[days[idx]] if idx >= 0 and (day - days[idx]).days <= 7 else None
        code = _cadence(gaps[max(0, i - 3):i] if i else gaps[:3]) or current_code
        multiplier = CADENCES.get(code, (None, None))[1]
        rate = payouts[day] / price * multiplier * 100 if price and multiplier else None
        events.append({"date": day.isoformat(), "amount": payouts[day], "close": price,
                       "annualized_yield": rate})

    rates = [e["annualized_yield"] for e in events if e["annualized_yield"] is not None]
    down, up = [], []
    for previous, current in zip(events, events[1:]):
        if previous["close"] is None or current["close"] is None or current["annualized_yield"] is None:
            continue
        if current["close"] < previous["close"]:
            down.append(current["annualized_yield"])
        elif current["close"] > previous["close"]:
            up.append(current["annualized_yield"])
    priced = [e for e in events if e["close"] is not None]
    latest = events[-1]
    # A full trailing year cannot be calculated for newly listed securities.
    cutoff = last_day - timedelta(days=365)
    covered = days[0] <= cutoff
    ttm = sum(payouts[d] for d in pay_days if d > cutoff) if covered else None
    trend = None
    if len(events) >= 6:
        previous_mean = mean(e["amount"] for e in events[-6:-3])
        trend = (mean(e["amount"] for e in events[-3:]) / previous_mean - 1) * 100 if previous_mean else None
    down_avg, up_avg = (mean(down) if down else None), (mean(up) if up else None)
    return {
        **provider, "status": "ok", "frequency": current_frequency, "payments_per_year": per_year,
        "low": min(rates) if rates else None, "average": mean(rates) if rates else None,
        "median": median(rates) if rates else None, "high": max(rates) if rates else None,
        "latest": latest["annualized_yield"], "latest_amount": latest["amount"], "latest_date": latest["date"],
        "ttm_per_share": ttm, "ttm_yield": ttm / prices[last_day] * 100 if ttm is not None else None,
        "down_average": down_avg, "up_average": up_avg,
        "down_up": down_avg - up_avg if down_avg is not None and up_avg is not None else None,
        "price_change": (priced[-1]["close"] / priced[0]["close"] - 1) * 100 if len(priced) >= 2 else None,
        "payout_trend": trend, "priced_count": len(rates), "events": events,
    }
