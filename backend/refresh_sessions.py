"""Keep a price refresh on the market sessions it claims to be reporting.

Yahoo's daily bars can trail its quotes. On 2026-09-23 the 9/22 bar was missing
for 68 of 73 holdings, and at the evening refresh most had no 9/23 bar yet
either. Reading each ticker's last bar as its current price valued the book at
Monday's close ($4.4k above Schwab), and the day change diffed Friday against
Monday under a "Sep 22 to Sep 23" label.

The two sessions come from the NYSE calendar rather than from the bars, because
a missing bar cannot announce that it is missing. Every holding without a bar
on one of them is quoted in one batched request to Yahoo's quote endpoint,
which reports the last trade and the prior session's close even where the chart
has a hole.
"""
from datetime import datetime, timedelta, timezone

import pandas as pd

from market_calendar import eastern_now, is_nyse_trading_day

QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
QUOTE_FIELDS = "regularMarketPrice,regularMarketTime,regularMarketPreviousClose"
QUOTE_BATCH_SIZE = 50
NYSE_OPEN = (9, 30)

# Listings that keep another calendar: foreign exchanges (PGDC.V), FX (CAD=X),
# indexes (^GSPC) and crypto pairs. The NYSE sessions say nothing about them.
_OFF_CALENDAR_MARKERS = (".", "=", "^")
_CRYPTO_QUOTE_SUFFIXES = ("-USD", "-USDT", "-USDC", "-EUR", "-GBP", "-CAD", "-BTC", "-ETH")


def previous_trading_day(day):
    day -= timedelta(days=1)
    while not is_nyse_trading_day(day):
        day -= timedelta(days=1)
    return day


def current_sessions(now_et=None):
    """(prior, latest) NYSE sessions; latest is today once the opening bell has rung."""
    if now_et is None:
        now_et = eastern_now()
    today = now_et.date()
    opened = (now_et.hour, now_et.minute) >= NYSE_OPEN
    latest = today if opened and is_nyse_trading_day(today) else previous_trading_day(today)
    return previous_trading_day(latest), latest


def on_nyse_calendar(yahoo_symbol):
    symbol = str(yahoo_symbol or "").strip().upper()
    if not symbol or any(marker in symbol for marker in _OFF_CALENDAR_MARKERS):
        return False
    return not symbol.endswith(_CRYPTO_QUOTE_SUFFIXES)


def closes_by_session(series):
    """{session date: close} for a close series, whatever its index flavour."""
    closes = {}
    if series is None:
        return closes
    for stamp, value in series.dropna().items():
        try:
            day = pd.Timestamp(stamp).date()
            price = float(value)
        except (TypeError, ValueError):
            continue
        if price > 0:
            closes[day] = price
    return closes


def _parse_quote(row):
    symbol = str(row.get("symbol") or "").strip().upper()
    try:
        price = float(row.get("regularMarketPrice") or 0)
        stamp = int(row.get("regularMarketTime") or 0)
    except (TypeError, ValueError):
        return None
    if not symbol or price <= 0 or stamp <= 0:
        return None
    try:
        previous = float(row.get("regularMarketPreviousClose") or 0)
    except (TypeError, ValueError):
        previous = 0.0
    session = eastern_now(datetime.fromtimestamp(stamp, timezone.utc)).date()
    return {
        "symbol": symbol,
        "price": price,
        "previous_close": previous if previous > 0 else None,
        "session": session.isoformat(),
    }


def fetch_quotes(yahoo_symbols, request, *, recall=None, remember=None):
    """{yahoo symbol: quote}, ``QUOTE_BATCH_SIZE`` symbols per request.

    ``request(params)`` performs one call and returns the parsed JSON. The
    caller supplies it so the rate-limit gateway wraps every request.
    ``recall(symbol)`` / ``remember(symbol, quote)`` are an optional short-TTL
    cache, so reloading the Dashboard does not re-ask for the same holes. A
    failed request ends the sweep and keeps whatever was already quoted.
    """
    quotes = {}
    pending = []
    for symbol in sorted({str(s or "").strip().upper() for s in yahoo_symbols} - {""}):
        cached = recall(symbol) if recall else None
        if cached:
            quotes[symbol] = cached
        else:
            pending.append(symbol)
    for start in range(0, len(pending), QUOTE_BATCH_SIZE):
        chunk = pending[start:start + QUOTE_BATCH_SIZE]
        try:
            payload = request({"symbols": ",".join(chunk), "fields": QUOTE_FIELDS})
        except Exception:
            break
        for row in ((payload or {}).get("quoteResponse") or {}).get("result") or []:
            quote = _parse_quote(row)
            if quote and quote["symbol"] in chunk:
                quotes[quote["symbol"]] = quote
                if remember:
                    remember(quote["symbol"], quote)
    return quotes


def _with_bars(series, bars):
    """``series`` plus ``bars`` ({date: close}); existing bars are never replaced."""
    tz = getattr(series.index, "tz", None)
    stamps = [pd.Timestamp(day) for day in bars]
    if tz is not None:
        stamps = [stamp.tz_localize(tz) for stamp in stamps]
    extra = pd.Series(list(bars.values()), index=pd.DatetimeIndex(stamps), dtype=float)
    combined = pd.concat([series.dropna(), extra])
    combined = combined[~combined.index.duplicated(keep="first")].sort_index()
    combined.name = series.name
    return combined


def _bars_from_quote(quote, closes, prior, latest):
    """Session bars a quote can supply that ``closes`` is missing."""
    session = datetime.strptime(quote["session"], "%Y-%m-%d").date()
    last_bar = max(closes)
    if session < last_bar or session > latest:
        # A quote older than the chart, or one from past the calendar's latest
        # session (a wrong clock), has nothing trustworthy to add.
        return {}
    bars = {}
    if session > last_bar:
        bars[session] = quote["price"]
    if session == latest and prior not in closes and quote["previous_close"]:
        bars[prior] = quote["previous_close"]
    # Yahoo reports the fund's last trade on an earlier session: it has not
    # traded since, so that trade is its price on the later sessions too. This
    # is what a broker's day change does with a fund that has not printed yet.
    for day in (prior, latest):
        if day > session and day not in closes:
            bars.setdefault(day, quote["price"])
    return bars


def align_to_sessions(close_history, yahoo_symbols, request, *, now_et=None,
                      recall=None, remember=None):
    """Fill the session bars Yahoo's chart left out, from its quotes.

    ``close_history`` ({ticker: close series}) is updated in place.
    ``yahoo_symbols`` maps a broker ticker to the symbol Yahoo knows it by.

    Returns ``sessions`` (prior, latest), ``repriced`` (tickers whose last bar
    moved, so their current price must be re-read) and ``stale`` ({ticker:
    ISO date of the bar it is still priced from}) for holdings behind the
    latest session with no quote to vouch for them.
    """
    prior, latest = current_sessions(now_et)
    report = {"sessions": (prior, latest), "repriced": [], "stale": {}}
    gaps = {}
    for ticker, series in close_history.items():
        symbol = str(yahoo_symbols.get(ticker) or ticker).strip().upper()
        if not on_nyse_calendar(symbol):
            continue
        closes = closes_by_session(series)
        if not closes or max(closes) > latest:
            continue
        if latest not in closes or prior not in closes:
            gaps[ticker] = (symbol, closes)
    if not gaps:
        return report

    quotes = fetch_quotes(
        [symbol for symbol, _ in gaps.values()],
        request,
        recall=recall,
        remember=remember,
    )
    for ticker, (symbol, closes) in sorted(gaps.items()):
        quote = quotes.get(symbol)
        last_bar = max(closes)
        if quote is None:
            if last_bar < latest:
                report["stale"][ticker] = last_bar.isoformat()
            continue
        bars = _bars_from_quote(quote, closes, prior, latest)
        if not bars:
            continue
        close_history[ticker] = _with_bars(close_history[ticker], bars)
        if max(bars) > last_bar:
            report["repriced"].append(ticker)
    return report
