"""Live quote for the Stock and ETF Analysis chart's price tag and last bar."""
from datetime import datetime, timezone

import live_quote
from live_quote import fetch_live_quote, parse_live_quote


def _epoch(year, month, day, hour, minute):
    return int(datetime(year, month, day, hour, minute, tzinfo=timezone.utc).timestamp())


def _payload(**overrides):
    row = {
        "symbol": "QQQ",
        "regularMarketPrice": 652.26,
        "regularMarketTime": _epoch(2026, 11, 23, 20, 59),
        "regularMarketPreviousClose": 608.45,
        "regularMarketOpen": 612.10,
        "regularMarketDayHigh": 655.00,
        "regularMarketDayLow": 610.50,
        "regularMarketVolume": 35148674,
        "marketState": "REGULAR",
    }
    row.update(overrides)
    return {"quoteResponse": {"result": [row]}}


def test_parse_maps_the_session_fields_on_new_york_time():
    quote = parse_live_quote(_payload(), "qqq")
    assert quote == {
        "symbol": "QQQ",
        "price": 652.26,
        "previous_close": 608.45,
        "open": 612.10,
        "day_high": 655.00,
        "day_low": 610.50,
        "volume": 35148674,
        # 20:59 UTC in November is 15:59 EST.
        "session": "2026-11-23",
        "time": "2026-11-23 15:59",
        "epoch": _epoch(2026, 11, 23, 20, 59),
        "market_state": "REGULAR",
    }


def test_parse_reads_summer_trades_on_daylight_time():
    quote = parse_live_quote(_payload(regularMarketTime=_epoch(2026, 7, 15, 19, 30)), "QQQ")
    assert quote["time"] == "2026-07-15 15:30"
    assert quote["session"] == "2026-07-15"


def test_parse_skips_rows_without_a_usable_price_or_time():
    assert parse_live_quote(_payload(), "SPY") is None
    assert parse_live_quote(_payload(regularMarketPrice=0), "QQQ") is None
    assert parse_live_quote(_payload(regularMarketTime=None), "QQQ") is None
    assert parse_live_quote({}, "QQQ") is None
    assert parse_live_quote(None, "QQQ") is None


def test_parse_leaves_missing_day_fields_empty():
    quote = parse_live_quote(_payload(
        regularMarketOpen=None, regularMarketDayHigh="", regularMarketDayLow=0,
        regularMarketPreviousClose=None, regularMarketVolume=None, marketState=None,
    ), "QQQ")
    assert quote["price"] == 652.26
    assert quote["open"] is None and quote["day_high"] is None and quote["day_low"] is None
    assert quote["previous_close"] is None
    assert quote["volume"] == 0
    assert quote["market_state"] is None


def test_pollers_inside_the_ttl_share_one_request():
    calls = []

    def request_json(params):
        calls.append(params)
        return _payload()

    first, meta = fetch_live_quote("QQQ", request_json)
    second, _ = fetch_live_quote("QQQ", request_json)
    assert len(calls) == 1
    assert calls[0]["symbols"] == "QQQ"
    assert "regularMarketDayHigh" in calls[0]["fields"]
    assert first["price"] == second["price"] == 652.26
    assert meta["stale"] is False


def test_a_failed_fetch_returns_the_last_quote_flagged_stale(monkeypatch):
    fetch_live_quote("QQQ", lambda params: _payload())
    monkeypatch.setattr(live_quote, "LIVE_QUOTE_TTL_SEC", 0)

    def throttled(params):
        raise RuntimeError("429 Too Many Requests")

    quote, meta = fetch_live_quote("QQQ", throttled)
    assert quote["price"] == 652.26
    assert meta["stale"] is True


def test_an_unknown_symbol_is_not_remembered():
    quote, meta = fetch_live_quote("NOPE", lambda params: {"quoteResponse": {"result": []}})
    assert quote is None
    assert meta["stale"] is False
