"""Live Yahoo quote for the Stock and ETF Analysis chart.

The technical chart loads its bars once. While it stays open, it polls this
endpoint so the last candle, the moving averages and the price tag at the
chart's right edge follow Yahoo's current price instead of freezing at the
moment the bars were downloaded.

One symbol per request, through the rate-limit gateway with a short TTL: two
charts (or a split view) polling the same ticker share one Yahoo call, and a
throttle answers from the gateway's cooldown instead of piling on retries. A
quote served from the last-good cache after a failed fetch is flagged ``stale``
so the chart does not fold an old price into today's bar.
"""
from datetime import datetime, timezone

from flask import jsonify, request

import yahoo_gateway
from market_calendar import eastern_now
from market_symbols import yahoo_symbol_for_ticker
from refresh_sessions import QUOTE_URL

LIVE_QUOTE_FIELDS = ",".join((
    "regularMarketPrice",
    "regularMarketTime",
    "regularMarketPreviousClose",
    "regularMarketOpen",
    "regularMarketDayHigh",
    "regularMarketDayLow",
    "regularMarketVolume",
    "marketState",
))
# A chart polls every 15 s during the session; two pollers inside this window
# share one Yahoo request.
LIVE_QUOTE_TTL_SEC = 10


def _positive(row, key):
    try:
        value = float(row.get(key) or 0)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def parse_live_quote(payload, symbol):
    """The quote for ``symbol`` in a v7 quote payload, or None.

    ``session`` is the New York trading date of the last regular-session trade
    and ``time`` its New York clock time ("YYYY-MM-DD HH:MM"), the same clock the
    chart's intraday bars are labelled in.
    """
    wanted = str(symbol or "").strip().upper()
    rows = ((payload or {}).get("quoteResponse") or {}).get("result") or []
    row = next((r for r in rows if str(r.get("symbol") or "").strip().upper() == wanted), None)
    if row is None:
        return None
    price = _positive(row, "regularMarketPrice")
    try:
        stamp = int(row.get("regularMarketTime") or 0)
    except (TypeError, ValueError):
        stamp = 0
    if price is None or stamp <= 0:
        return None
    when = eastern_now(datetime.fromtimestamp(stamp, timezone.utc))
    try:
        volume = int(float(row.get("regularMarketVolume") or 0))
    except (TypeError, ValueError):
        volume = 0
    return {
        "symbol": wanted,
        "price": price,
        "previous_close": _positive(row, "regularMarketPreviousClose"),
        "open": _positive(row, "regularMarketOpen"),
        "day_high": _positive(row, "regularMarketDayHigh"),
        "day_low": _positive(row, "regularMarketDayLow"),
        "volume": max(0, volume),
        "session": when.date().isoformat(),
        "time": when.strftime("%Y-%m-%d %H:%M"),
        "epoch": stamp,
        "market_state": str(row.get("marketState") or "").upper() or None,
    }


def fetch_live_quote(symbol, request_json):
    """``(quote, meta)`` for one Yahoo symbol; ``request_json(params)`` does the call."""
    params = {"symbols": symbol, "fields": LIVE_QUOTE_FIELDS}
    return yahoo_gateway.fetch(
        "live_quote",
        symbol,
        lambda: parse_live_quote(request_json(params), symbol),
        ttl=LIVE_QUOTE_TTL_SEC,
        attempts=1,
    )


def _yahoo_request(params):
    from yfinance.data import YfData

    return YfData().get_raw_json(QUOTE_URL, params=params)


def register_routes(app):
    @app.route("/api/etf-screen/quote")
    def etf_screen_quote():
        ticker = request.args.get("ticker", "").strip().upper()
        if not ticker:
            return jsonify(error="ticker is required"), 400
        symbol = yahoo_symbol_for_ticker(ticker)
        quote, meta = fetch_live_quote(symbol, _yahoo_request)
        if not quote:
            return jsonify(
                error=meta.get("error") or f"No quote for {ticker}",
                ticker=ticker,
                cooling_down=bool(meta.get("cooling_down")),
            ), 404
        return jsonify({**quote, "ticker": ticker, "stale": bool(meta.get("stale"))})
