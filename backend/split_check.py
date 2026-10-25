"""Catch a trade entered in pre-split units before it reaches the ledger.

The cost-basis ledger (``_rollup_transactions``, FIFO realized G/L, sell
validation) replays raw share counts and has no SPLIT type, so every row has to
be in today's units. A BUY copied from an old statement, such as GOOGL 2 @
$2,871.49 before the 20-for-1 split, then sits next to post-split sells of 40
shares at about $120. FIFO matches the two and reports large phantom losses.

This module answers one question about a BUY or SELL: is it dated before a
split Yahoo reports, and is its price a pre-split one? It only warns.
Converting is the user's call, because a row that someone already restated by
hand is correct as it stands and must not be divided again.

The performance engines' own Yahoo split handling
(``_should_apply_yahoo_split_adjustment``) is separate and unaffected.

Nothing here imports ``app``; the module is a leaf like ``yahoo_gateway``.
"""
from __future__ import annotations

import datetime
import math
import statistics
from urllib.parse import quote

import yahoo_gateway

_CHART_URL = "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
SPLIT_HISTORY_KIND = "split_history"
# A split never changes after the fact, so a cached history is right for every
# past date. The TTL only bounds how long a brand-new split goes unseen.
SPLIT_HISTORY_TTL_SEC = 7 * 24 * 3600
# Compare against the trades nearest the split, not the whole later history: a
# price years after the split has drifted further from the one being checked.
REFERENCE_ROWS = 3
# Where the reference price sits between the price as entered (0) and its
# post-split reading (1), in log terms. Past the midpoint it reads as pre-split.
PRE_SPLIT_POSITION = 0.5


def _download_split_history(symbol):
    """Yahoo's split events and monthly trading ranges for ``symbol``, or None.

    One chart request over the full range at a monthly interval returns a few
    dozen kilobytes: the split events with their exact dates, and each month's
    low and high already restated for every split since (today's units). None
    means Yahoo returned no bars at all, such as a symbol it does not know.
    That is not the same answer as "never split", so it is not cached as one.
    """
    from yfinance.data import YfData

    payload = YfData().get_raw_json(
        _CHART_URL.format(symbol=quote(symbol, safe="")),
        params={"range": "max", "interval": "1mo", "events": "split"},
    )
    results = ((payload or {}).get("chart") or {}).get("result") or []
    if not results or not results[0].get("timestamp"):
        return None
    result = results[0]
    # Stamps are session opens in UTC; the exchange offset puts them on the
    # local trading date.
    offset = int((result.get("meta") or {}).get("gmtoffset") or 0)

    def local_day(stamp):
        return datetime.datetime.fromtimestamp(
            int(stamp) + offset, tz=datetime.timezone.utc,
        ).date()

    splits = []
    for event in ((result.get("events") or {}).get("splits") or {}).values():
        try:
            ratio = float(event["numerator"]) / float(event["denominator"])
            day = local_day(event["date"])
        except (KeyError, TypeError, ValueError, ZeroDivisionError, OverflowError, OSError):
            continue
        if ratio > 0 and abs(ratio - 1.0) > 1e-9:
            splits.append({"date": day.isoformat(), "ratio": ratio})

    months = {}
    quote_rows = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    for stamp, low, high in zip(
        result["timestamp"], quote_rows.get("low") or [], quote_rows.get("high") or [],
    ):
        try:
            month = local_day(stamp).strftime("%Y-%m")
            low, high = float(low), float(high)
        except (TypeError, ValueError, OverflowError, OSError):
            continue
        if 0 < low <= high:
            months[month] = [round(low, 6), round(high, 6)]
    return {
        "splits": sorted(splits, key=lambda split: split["date"]),
        "monthly_ranges": months,
    }


def yahoo_split_history(ticker, yahoo_symbol=None, attempts=1):
    """``{"splits", "monthly_ranges"}`` for ``ticker`` from Yahoo, or None.

    ``splits`` is oldest first. ``monthly_ranges`` maps ``YYYY-MM`` to that
    month's split-adjusted ``[low, high]``.

    Goes through the Yahoo gateway, so a throttle trips the shared breaker and
    the last good answer is served while it is shut. ``attempts=1`` because the
    caller is a save or an import preview: a failed lookup skips the check
    rather than holding the request in backoff.
    """
    symbol = str(yahoo_symbol or ticker or "").strip().upper()
    if not symbol:
        return None
    payload, _meta = yahoo_gateway.fetch(
        SPLIT_HISTORY_KIND,
        symbol,
        lambda: _download_split_history(symbol),
        ttl=SPLIT_HISTORY_TTL_SEC,
        attempts=attempts,
    )
    if not isinstance(payload, dict):
        return None
    splits = []
    for item in payload.get("splits") or []:
        date_key = _date_key((item or {}).get("date"))
        ratio = _positive_float((item or {}).get("ratio"))
        if date_key and ratio and abs(ratio - 1.0) > 1e-9:
            splits.append({"date": date_key, "ratio": ratio})
    months = {}
    for month, bounds in (payload.get("monthly_ranges") or {}).items():
        try:
            low, high = (_positive_float(value) for value in bounds)
        except (TypeError, ValueError):
            continue
        if low and high and low <= high:
            months[str(month)] = [low, high]
    return {
        "splits": sorted(splits, key=lambda split: split["date"]),
        "monthly_ranges": months,
    }


def _date_key(value):
    text = str(value or "").strip()[:10]
    try:
        return datetime.date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _positive_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or number <= 0:
        return None
    return number


def splits_after(splits, date_str, today=None):
    """The splits dated after ``date_str`` and no later than today, oldest first.

    Yahoo dates a split on the first day the stock trades split-adjusted, so a
    trade on that date is already in post-split units.
    """
    date_key = _date_key(date_str)
    if not date_key:
        return []
    today_key = (today or datetime.date.today()).isoformat()
    return [
        split for split in sorted(splits or [], key=lambda item: item["date"])
        if date_key < split["date"] <= today_key
    ]


def ratio_label(ratio):
    """``20-for-1`` for a forward split, ``1-for-10`` for a reverse one."""
    if ratio >= 1:
        return f"{_trim(ratio)}-for-1"
    return f"1-for-{_trim(1.0 / ratio)}"


def _trim(value, places=6):
    text = f"{value:,.{places}f}".rstrip("0").rstrip(".")
    return text or "0"


def _shares(value):
    return f"{_trim(value)} share{'' if value == 1 else 's'}"


def _money(value):
    return f"${value:,.2f}" if abs(value) >= 1 else f"${value:,.4f}"


def _log_distance(price, low, high):
    """How far ``price`` sits outside ``[low, high]``, in log terms (0 inside)."""
    if price < low:
        return math.log(low / price)
    if price > high:
        return math.log(price / high)
    return 0.0


def pre_split_warning(
    ticker,
    transaction_type,
    transaction_date,
    shares,
    price_per_share,
    splits,
    later_rows,
    current_price=None,
    monthly_ranges=None,
    today=None,
):
    """A warning dict when a BUY/SELL looks entered in pre-split units, else None.

    The test is on price, against the best reference available:

    1. Yahoo's split-adjusted low-high range for the trade's month
       (``monthly_ranges``). It is the same date in today's units, so it holds
       even for a stock that rose many times over between this trade and the
       next, which is common for the stocks that split.
    2. ``later_rows``, the ticker's other trades as ``{"date",
       "price_per_share"}``. Only rows on or after the last split that follows
       this trade count, since nothing has restated those.
    3. The holding's ``current_price``.

    The trade reads as pre-split when its price divided by the split factor
    sits closer to the reference than the price as entered does. The warning
    carries the post-split figures (shares times the factor, price divided by
    it, so the cost is unchanged) for the caller to offer. Nothing is converted
    here.
    """
    shares = _positive_float(shares)
    price = _positive_float(price_per_share)
    date_key = _date_key(transaction_date)
    if not shares or not price or not date_key:
        return None
    pending = splits_after(splits, date_key, today=today)
    if not pending:
        return None
    factor = math.prod(split["ratio"] for split in pending)
    if abs(math.log(factor)) < 1e-9:
        return None
    post_split_price = price / factor

    month = date_key[:7]
    month_range = (monthly_ranges or {}).get(month)
    references = []
    if month_range:
        low, high = month_range
        if _log_distance(post_split_price, low, high) >= _log_distance(price, low, high):
            return None
        basis = "yahoo_month"
        reference = math.sqrt(low * high)
        compared_with = (
            f"Yahoo's split-adjusted range for {month} "
            f"({_money(low)} to {_money(high)} a share)"
        )
    else:
        boundary = pending[-1]["date"]
        for row in later_rows or []:
            row_date = _date_key(row.get("date"))
            row_price = _positive_float(row.get("price_per_share"))
            if row_date and row_price and row_date >= boundary:
                references.append((row_date, row_price))
        references = sorted(references)[:REFERENCE_ROWS]
        if references:
            reference = statistics.median(row_price for _row_date, row_price in references)
            basis = "later_trades"
            compared_with = f"the later trades (about {_money(reference)} a share)"
        else:
            reference = _positive_float(current_price)
            basis = "current_price"
            compared_with = f"the current price ({_money(reference or 0)} a share)"
            if not reference:
                return None
        position = (math.log(price) - math.log(reference)) / math.log(factor)
        if position <= PRE_SPLIT_POSITION:
            return None

    suggested_shares = round(shares * factor, 10)
    suggested_price = round(post_split_price, 6)
    txn_type = str(transaction_type or "BUY").upper()
    split_text = " and ".join(
        f"{ratio_label(split['ratio'])} on {split['date']}" for split in pending
    )
    message = (
        f"{ticker} split {split_text}. This {txn_type} of {_shares(shares)} at "
        f"{_money(price)} is dated before the split, and its price looks pre-split next to "
        f"{compared_with}. The cost-basis ledger does not adjust for splits, so in "
        f"post-split shares it is {_shares(suggested_shares)} at "
        f"{_money(suggested_price)}."
    )
    return {
        "ticker": ticker,
        "transaction_type": txn_type,
        "transaction_date": date_key,
        "shares": shares,
        "price_per_share": price,
        "split_ratio": factor,
        "splits": [dict(split) for split in pending],
        "suggested_shares": suggested_shares,
        "suggested_price_per_share": suggested_price,
        "reference_price": round(reference, 6),
        "reference_basis": basis,
        "reference_range": list(month_range) if month_range else None,
        "reference_dates": [row_date for row_date, _row_price in references],
        "message": message,
    }
