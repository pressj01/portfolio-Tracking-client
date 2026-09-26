"""User-selectable market-data provider with Tiingo-first Yahoo fallback.

Tiingo is deliberately opt-in.  It is active only when all three conditions
are true:

* the user selected it in Settings;
* a token is stored locally; and
* the hash of that token matches the hash recorded after Tiingo's validation
  endpoint accepted it.

The module returns yfinance-shaped pandas frames so callers can select a data
provider without rewriting their analytics.  Yahoo remains the fallback for
coverage, entitlement and quota gaps, and option modules continue to call
yfinance directly rather than using this facade.
"""
from __future__ import annotations

import hashlib
import re
import threading
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable

import pandas as pd
import requests

from config import get_connection


YAHOO_MODE = "yahoo"
TIINGO_HYBRID_MODE = "tiingo_hybrid"
USE_TIINGO_KEY = "use_tiingo"
TIINGO_TOKEN_KEY = "tiingo_api_key"
TIINGO_VALIDATED_HASH_KEY = "tiingo_validated_key_hash"
TIINGO_API_BASE = "https://api.tiingo.com"

_CONFIG_TTL_SEC = 2.0
_config_lock = threading.Lock()
_config_cache = {"loaded_at": 0.0, "value": None}

_state_lock = threading.Lock()
_runtime = {
    "tiingo_requests": 0,
    "tiingo_successes": 0,
    "yahoo_fallbacks": 0,
    "last_fallback_reason": None,
    "last_fallback_at": None,
    "last_tiingo_error": None,
    "cooldown_until": 0.0,
    "cooldown_reason": None,
}
_fallback_reasons: Counter = Counter()

_TIINGO_FIELDS = (
    "Open", "High", "Low", "Close", "Adj Close", "Volume",
    "Dividends", "Stock Splits", "Capital Gains",
)


class TiingoError(RuntimeError):
    """A classified Tiingo refusal or transport failure."""

    def __init__(self, message, *, status=None, reason="request_failed", retry_after=None):
        super().__init__(str(message))
        self.status = status
        self.reason = str(reason or "request_failed")
        self.retry_after = retry_after


def token_hash(token: str) -> str:
    return hashlib.sha256(str(token or "").strip().encode("utf-8")).hexdigest()


def mask_token(token: str) -> str | None:
    token = str(token or "").strip()
    if not token:
        return None
    if len(token) <= 8:
        return "••••••••"
    return f"{token[:4]}••••{token[-4:]}"


def invalidate_config():
    """Make a saved Settings change effective on the next provider request."""
    with _config_lock:
        _config_cache.update(loaded_at=0.0, value=None)
    with _state_lock:
        _runtime["cooldown_until"] = 0.0
        _runtime["cooldown_reason"] = None


def _load_config(force=False):
    now = time.monotonic()
    with _config_lock:
        cached = _config_cache.get("value")
        if not force and cached is not None and now - _config_cache["loaded_at"] < _CONFIG_TTL_SEC:
            return dict(cached)

    rows = {}
    conn = None
    try:
        conn = get_connection()
        wanted = (USE_TIINGO_KEY, TIINGO_TOKEN_KEY, TIINGO_VALIDATED_HASH_KEY)
        rows = {
            row["key"]: row["value"]
            for row in conn.execute(
                f"SELECT key, value FROM settings WHERE key IN ({','.join('?' for _ in wanted)})",
                wanted,
            )
        }
    except Exception:
        rows = {}
    finally:
        if conn is not None:
            conn.close()

    requested = str(rows.get(USE_TIINGO_KEY, "")).strip().lower() in {"1", "true", "yes", "on"}
    token = str(rows.get(TIINGO_TOKEN_KEY, "") or "").strip()
    validated_hash = str(rows.get(TIINGO_VALIDATED_HASH_KEY, "") or "").strip()
    valid = bool(token and validated_hash and token_hash(token) == validated_hash)
    value = {
        "requested": requested,
        "token": token,
        "key_configured": bool(token),
        "key_valid": valid,
        "enabled": bool(requested and valid),
        "mode": TIINGO_HYBRID_MODE if requested and valid else YAHOO_MODE,
    }
    with _config_lock:
        _config_cache.update(loaded_at=now, value=value)
    return dict(value)


def provider_config(force=False, include_token=False):
    config = _load_config(force=force)
    token = config.get("token")
    if not include_token:
        config.pop("token", None)
    config["masked_key"] = mask_token(token)
    return config


def tiingo_enabled() -> bool:
    return bool(_load_config().get("enabled"))


def active_mode() -> str:
    return _load_config().get("mode") or YAHOO_MODE


def _note_request(success=False):
    with _state_lock:
        _runtime["tiingo_requests"] += 1
        if success:
            _runtime["tiingo_successes"] += 1


def _note_fallback(reason, count=1):
    reason = str(reason or "unknown")
    with _state_lock:
        _runtime["yahoo_fallbacks"] += max(1, int(count or 1))
        _runtime["last_fallback_reason"] = reason
        _runtime["last_fallback_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        _fallback_reasons[reason] += max(1, int(count or 1))


def _set_error(exc: TiingoError):
    cooldown = 0.0
    if exc.status == 429:
        cooldown = float(exc.retry_after or 900.0)
    elif exc.status in {401, 403}:
        cooldown = 300.0
    elif exc.reason in {"timeout", "transport", "server_error"}:
        cooldown = 30.0
    with _state_lock:
        _runtime["last_tiingo_error"] = str(exc)
        if cooldown > 0:
            _runtime["cooldown_until"] = max(
                float(_runtime.get("cooldown_until") or 0.0),
                time.monotonic() + cooldown,
            )
            _runtime["cooldown_reason"] = exc.reason


def runtime_status():
    with _state_lock:
        remaining = max(0.0, float(_runtime.get("cooldown_until") or 0.0) - time.monotonic())
        data = dict(_runtime)
        data["cooldown_remaining_sec"] = round(remaining, 1)
        data["cooling_down"] = remaining > 0
        data["fallback_reasons"] = dict(_fallback_reasons)
        data.pop("cooldown_until", None)
    return data


def reset_runtime_status():
    with _state_lock:
        _runtime.update(
            tiingo_requests=0,
            tiingo_successes=0,
            yahoo_fallbacks=0,
            last_fallback_reason=None,
            last_fallback_at=None,
            last_tiingo_error=None,
            cooldown_until=0.0,
            cooldown_reason=None,
        )
        _fallback_reasons.clear()


def _error_reason(status):
    if status == 401:
        return "invalid_key"
    if status == 403:
        return "not_entitled"
    if status == 404:
        return "unsupported_symbol"
    if status == 429:
        return "quota_exceeded"
    if status and status >= 500:
        return "server_error"
    return "request_failed"


def _request_json(path, *, token, params=None, timeout=15, force=False):
    token = str(token or "").strip()
    if not token:
        raise TiingoError("A Tiingo API key is required.", status=401, reason="invalid_key")
    if not force:
        with _state_lock:
            remaining = float(_runtime.get("cooldown_until") or 0.0) - time.monotonic()
            reason = _runtime.get("cooldown_reason")
        if remaining > 0:
            raise TiingoError(
                f"Tiingo is cooling down after {reason or 'a failed request'}.",
                reason=reason or "cooldown",
                retry_after=remaining,
            )

    url = f"{TIINGO_API_BASE}{path}"
    try:
        response = requests.get(
            url,
            params=params or None,
            headers={
                "Accept": "application/json",
                "Authorization": f"Token {token}",
                "User-Agent": "PortfolioTrackingClient/1.0",
            },
            timeout=timeout,
        )
    except requests.Timeout as exc:
        _note_request(False)
        error = TiingoError("Tiingo request timed out.", reason="timeout")
        _set_error(error)
        raise error from exc
    except requests.RequestException as exc:
        _note_request(False)
        error = TiingoError(f"Tiingo connection failed: {exc}", reason="transport")
        _set_error(error)
        raise error from exc

    ok = 200 <= response.status_code < 300
    _note_request(ok)
    if not ok:
        retry_after = response.headers.get("Retry-After")
        try:
            retry_after = float(retry_after) if retry_after else None
        except (TypeError, ValueError):
            retry_after = None
        detail = ""
        try:
            payload = response.json()
            detail = payload.get("detail") or payload.get("message") or payload.get("error") or ""
        except Exception:
            detail = (response.text or "").strip()[:240]
        reason = _error_reason(response.status_code)
        error = TiingoError(
            detail or f"Tiingo returned HTTP {response.status_code}.",
            status=response.status_code,
            reason=reason,
            retry_after=retry_after,
        )
        _set_error(error)
        raise error
    try:
        return response.json()
    except ValueError as exc:
        error = TiingoError("Tiingo returned an unreadable response.", reason="invalid_response")
        _set_error(error)
        raise error from exc


def validate_token(token: str):
    """Validate a token directly with Tiingo; never stores it."""
    payload = _request_json("/api/test/", token=token, timeout=12, force=True)
    if not isinstance(payload, dict):
        raise TiingoError("Tiingo did not confirm this API key.", reason="invalid_response")
    return True


def _as_tickers(tickers) -> list[str]:
    if isinstance(tickers, str):
        values = tickers.replace(",", " ").split()
    elif isinstance(tickers, Iterable):
        values = list(tickers)
    else:
        values = [tickers]
    return list(dict.fromkeys(str(value or "").strip().upper() for value in values if str(value or "").strip()))


def tiingo_symbol(symbol: str) -> str | None:
    """Translate common Yahoo spellings; return None for unsupported asset families."""
    symbol = str(symbol or "").strip().upper()
    if not symbol or symbol.startswith("^") or symbol.endswith("=X"):
        return None
    if symbol.endswith(("-USD", "-USDT")):
        return None
    # The EOD endpoint documents US equity/fund symbols. Exchange-suffixed
    # Yahoo symbols represent other markets and should fall through to Yahoo.
    if re.search(r"\.[A-Z]{1,4}$", symbol):
        return None
    preferred = re.match(r"^([A-Z0-9]+)-P([A-Z])$", symbol)
    if preferred:
        return f"{preferred.group(1)}-P-{preferred.group(2)}"
    return symbol


def _period_start(period, now=None):
    now = pd.Timestamp(now or datetime.now(timezone.utc)).tz_localize(None).normalize()
    period = str(period or "1mo").lower()
    offsets = {
        "1d": pd.Timedelta(days=10),
        "5d": pd.Timedelta(days=14),
        "7d": pd.Timedelta(days=14),
        "1mo": pd.DateOffset(months=1),
        "3mo": pd.DateOffset(months=3),
        "6mo": pd.DateOffset(months=6),
        "1y": pd.DateOffset(years=1),
        "2y": pd.DateOffset(years=2),
        "3y": pd.DateOffset(years=3),
        "5y": pd.DateOffset(years=5),
        "10y": pd.DateOffset(years=10),
    }
    if period == "max":
        return None
    if period == "ytd":
        return pd.Timestamp(year=now.year, month=1, day=1)
    offset = offsets.get(period, pd.DateOffset(months=1))
    return now - offset


def _history_params(kwargs):
    start = kwargs.get("start")
    end = kwargs.get("end")
    period = kwargs.get("period")
    interval = str(kwargs.get("interval") or "1d").lower()
    if start is None:
        start = _period_start(period)
    else:
        start = pd.Timestamp(start).tz_localize(None) if pd.Timestamp(start).tzinfo else pd.Timestamp(start)
    if end is not None:
        end = pd.Timestamp(end).tz_localize(None) if pd.Timestamp(end).tzinfo else pd.Timestamp(end)
        # yfinance treats end as exclusive; Tiingo's endDate is inclusive.
        tiingo_end = end.normalize() - pd.Timedelta(days=1)
    else:
        tiingo_end = pd.Timestamp.now().normalize()
    params = {}
    if start is not None:
        # Ask for a prior trading bar so anchor-on-or-before callers can retain
        # a weekend/holiday baseline before their normal trimming runs.
        params["startDate"] = (start.normalize() - pd.Timedelta(days=7)).strftime("%Y-%m-%d")
    if tiingo_end is not None:
        params["endDate"] = tiingo_end.strftime("%Y-%m-%d")
    resamples = {"1wk": "weekly", "1w": "weekly", "1mo": "monthly", "3mo": "monthly"}
    if interval in resamples:
        params["resampleFreq"] = resamples[interval]
    return params, start, end, interval


def _split_value(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if abs(number - 1.0) < 1e-12 else number


def _eod_frame(symbol, token, kwargs):
    tiingo = tiingo_symbol(symbol)
    if not tiingo:
        raise TiingoError(f"{symbol} is not supported by Tiingo EOD.", reason="unsupported_symbol")
    params, start, end, interval = _history_params(kwargs)
    if interval not in {"1d", "1wk", "1w", "1mo", "3mo"}:
        return _intraday_frame(symbol, tiingo, token, kwargs, params, start, end, interval)
    payload = _request_json(f"/tiingo/daily/{tiingo}/prices", token=token, params=params)
    if not isinstance(payload, list) or not payload:
        raise TiingoError(f"Tiingo returned no price history for {symbol}.", reason="no_data")
    rows = []
    index = []
    auto_adjust = bool(kwargs.get("auto_adjust", True))
    actions = bool(kwargs.get("actions", False))
    for item in payload:
        if not isinstance(item, dict) or not item.get("date"):
            continue
        stamp = pd.to_datetime(item.get("date"), errors="coerce", utc=True)
        if pd.isna(stamp):
            continue
        stamp = stamp.tz_convert(None).normalize()
        if start is not None and stamp < start.normalize() - pd.Timedelta(days=7):
            continue
        if end is not None and stamp >= end.normalize():
            continue
        if auto_adjust:
            row = {
                "Open": item.get("adjOpen"), "High": item.get("adjHigh"),
                "Low": item.get("adjLow"), "Close": item.get("adjClose"),
                "Volume": item.get("adjVolume"),
            }
        else:
            row = {
                "Open": item.get("open"), "High": item.get("high"),
                "Low": item.get("low"), "Close": item.get("close"),
                "Adj Close": item.get("adjClose"), "Volume": item.get("volume"),
            }
        if actions:
            row.update({
                "Dividends": item.get("divCash") or 0.0,
                "Stock Splits": _split_value(item.get("splitFactor")),
            })
        rows.append(row)
        index.append(stamp)
    if not rows:
        raise TiingoError(f"Tiingo returned no usable price history for {symbol}.", reason="no_data")
    frame = pd.DataFrame(rows, index=pd.DatetimeIndex(index, name="Date"))
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    tail = {"1d": 1, "5d": 5, "7d": 7}.get(str(kwargs.get("period") or "").lower())
    if tail:
        frame = frame.tail(tail)
    return frame


def _intraday_frame(symbol, tiingo, token, kwargs, params, start, end, interval):
    resample = {
        "1m": "1min", "2m": "2min", "5m": "5min", "15m": "15min",
        "30m": "30min", "60m": "1hour", "90m": "90min", "1h": "1hour",
    }.get(interval)
    if not resample:
        raise TiingoError(f"Tiingo does not support interval {interval} for {symbol}.", reason="unsupported_interval")
    params = dict(params)
    params["resampleFreq"] = resample
    params["columns"] = "open,high,low,close,volume"
    payload = _request_json(f"/iex/{tiingo}/prices", token=token, params=params)
    if not isinstance(payload, list) or not payload:
        raise TiingoError(f"Tiingo returned no intraday history for {symbol}.", reason="no_data")
    rows, index = [], []
    for item in payload:
        stamp = pd.to_datetime(item.get("date"), errors="coerce", utc=True)
        if pd.isna(stamp):
            continue
        stamp = stamp.tz_convert(None)
        if start is not None and stamp < start:
            continue
        if end is not None and stamp >= end:
            continue
        rows.append({
            "Open": item.get("open"), "High": item.get("high"),
            "Low": item.get("low"), "Close": item.get("close"),
            "Volume": item.get("volume"),
        })
        index.append(stamp)
    if not rows:
        raise TiingoError(f"Tiingo returned no usable intraday history for {symbol}.", reason="no_data")
    return pd.DataFrame(rows, index=pd.DatetimeIndex(index, name="Datetime")).sort_index()


def _field_level(columns):
    if not isinstance(columns, pd.MultiIndex):
        return None
    fields = {field.casefold() for field in _TIINGO_FIELDS}
    for level in range(columns.nlevels):
        values = {str(value).casefold() for value in columns.get_level_values(level)}
        if "close" in values and values <= fields:
            return level
    return None


def _split_frame(frame, symbols):
    """Turn either yfinance MultiIndex orientation into flat per-symbol frames."""
    if frame is None or getattr(frame, "empty", True):
        return {}
    symbols = _as_tickers(symbols)
    if not isinstance(frame.columns, pd.MultiIndex):
        return {symbols[0]: frame.copy()} if len(symbols) == 1 else {}
    level = _field_level(frame.columns)
    if level is None:
        return {}
    ticker_level = 1 - level if frame.columns.nlevels == 2 else None
    if ticker_level is None:
        return {}
    result = {}
    available = {str(v).upper() for v in frame.columns.get_level_values(ticker_level)}
    for symbol in symbols:
        if symbol not in available:
            continue
        try:
            part = frame.xs(symbol, axis=1, level=ticker_level, drop_level=True).copy()
        except (KeyError, ValueError):
            continue
        if part is not None and not part.empty:
            result[symbol] = part
    return result


def _assemble_frames(frames, symbols, group_by=None):
    symbols = [symbol for symbol in symbols if symbol in frames]
    if not symbols:
        return pd.DataFrame()
    if len(symbols) == 1:
        return frames[symbols[0]].sort_index()
    if group_by == "ticker":
        combined = pd.concat({symbol: frames[symbol] for symbol in symbols}, axis=1)
    else:
        combined = pd.concat({symbol: frames[symbol] for symbol in symbols}, axis=1)
        combined = combined.swaplevel(0, 1, axis=1)
        order = [
            (field, symbol)
            for field in _TIINGO_FIELDS
            for symbol in symbols
            if (field, symbol) in combined.columns
        ]
        extras = [column for column in combined.columns if column not in order]
        combined = combined.loc[:, order + extras]
    if combined.index.has_duplicates:
        combined = combined.loc[~combined.index.duplicated(keep="last")]
    return combined.sort_index()


def _default_yahoo_fetch(symbols, kwargs):
    import yfinance as yf
    return yf.download(symbols if len(symbols) > 1 else symbols[0], **kwargs)


def download(tickers, *, yahoo_fetch: Callable | None = None, provider_override=None, **kwargs):
    """Download a yfinance-shaped frame through the selected provider.

    ``yahoo_fetch`` receives ``(symbols, kwargs)`` and is supplied by app.py so
    its existing Yahoo breaker and shared download lock remain authoritative.
    """
    symbols = _as_tickers(tickers)
    if not symbols:
        return pd.DataFrame()
    yahoo_fetch = yahoo_fetch or _default_yahoo_fetch
    if provider_override == YAHOO_MODE or not tiingo_enabled():
        frame = yahoo_fetch(symbols, dict(kwargs))
        if frame is not None:
            frame.attrs["market_data_sources"] = {symbol: "yahoo" for symbol in symbols}
        return frame

    token = _load_config().get("token")
    frames = {}
    sources = {}
    failures = {}
    for symbol in symbols:
        try:
            frame = _eod_frame(symbol, token, kwargs)
            frames[symbol] = frame
            sources[symbol] = "tiingo"
        except TiingoError as exc:
            failures[symbol] = exc.reason
        except Exception as exc:  # a malformed symbol response must not blank the app
            failures[symbol] = "invalid_response"
            _set_error(TiingoError(str(exc), reason="invalid_response"))

    if failures:
        failed_symbols = list(failures)
        fallback = yahoo_fetch(failed_symbols, dict(kwargs))
        fallback_frames = _split_frame(fallback, failed_symbols)
        if len(failed_symbols) == len(symbols) and not frames:
            reason = next(iter(failures.values())) if len(set(failures.values())) == 1 else "mixed_tiingo_failure"
            _note_fallback(reason, len(failed_symbols))
            if fallback is not None:
                fallback.attrs["market_data_sources"] = {symbol: "yahoo_fallback" for symbol in failed_symbols}
                fallback.attrs["market_data_fallback_reasons"] = dict(failures)
            return fallback
        for symbol, part in fallback_frames.items():
            frames[symbol] = part
            sources[symbol] = "yahoo_fallback"
        for reason, count in Counter(failures.values()).items():
            _note_fallback(reason, count)

    result = _assemble_frames(frames, symbols, kwargs.get("group_by"))
    result.attrs["market_data_sources"] = sources
    if failures:
        result.attrs["market_data_fallback_reasons"] = failures
    return result


def tiingo_metadata(symbol, *, token=None):
    token = token or _load_config().get("token")
    tiingo = tiingo_symbol(symbol)
    if not tiingo:
        raise TiingoError(f"{symbol} is not supported by Tiingo metadata.", reason="unsupported_symbol")
    payload = _request_json(f"/tiingo/daily/{tiingo}", token=token)
    if not isinstance(payload, dict):
        raise TiingoError("Tiingo returned invalid metadata.", reason="invalid_response")
    return {
        "symbol": str(payload.get("ticker") or symbol).upper(),
        "shortName": payload.get("name"),
        "longName": payload.get("name"),
        "longBusinessSummary": payload.get("description"),
        "exchange": payload.get("exchangeCode"),
        "firstTradeDateEpochUtc": payload.get("startDate"),
        "tiingoEndDate": payload.get("endDate"),
    }


class HybridTicker:
    """Small Ticker facade: Tiingo for supported history/actions, Yahoo for gaps."""

    def __init__(self, symbol, *args, **kwargs):
        import yfinance as yf
        self.ticker = str(symbol or "").strip().upper()
        self._yahoo = yf.Ticker(self.ticker, *args, **kwargs)

    def history(self, *args, **kwargs):
        if args and "period" not in kwargs:
            kwargs["period"] = args[0]

        def yahoo_fetch(_symbols, _kwargs):
            allowed = dict(_kwargs)
            for key in ("group_by", "progress", "threads"):
                allowed.pop(key, None)
            return self._yahoo.history(**allowed)

        return download([self.ticker], yahoo_fetch=yahoo_fetch, **kwargs)

    @property
    def dividends(self):
        frame = self.history(period="max", auto_adjust=False, actions=True)
        if frame is None or frame.empty or "Dividends" not in frame.columns:
            return pd.Series(dtype=float)
        series = frame["Dividends"].dropna()
        return series[series != 0]

    @property
    def splits(self):
        frame = self.history(period="max", auto_adjust=False, actions=True)
        if frame is None or frame.empty or "Stock Splits" not in frame.columns:
            return pd.Series(dtype=float)
        series = frame["Stock Splits"].dropna()
        return series[series != 0]

    @property
    def actions(self):
        frame = self.history(period="max", auto_adjust=False, actions=True)
        wanted = [field for field in ("Dividends", "Stock Splits", "Capital Gains") if field in frame.columns]
        return frame[wanted] if wanted else pd.DataFrame(index=frame.index)

    @property
    def info(self):
        if not tiingo_enabled():
            return self._yahoo.info
        basic = {}
        try:
            basic = tiingo_metadata(self.ticker)
        except Exception:
            pass
        # EOD metadata intentionally contains no sector, beta, yield, financial
        # statements, fund fees or holdings. Hybrid mode uses Yahoo for those
        # missing capabilities while retaining Tiingo's canonical identity.
        try:
            yahoo = self._yahoo.info or {}
            _note_fallback("metadata_not_in_tiingo")
        except Exception:
            yahoo = {}
        return {**yahoo, **{key: value for key, value in basic.items() if value is not None}}

    def get_info(self, *args, **kwargs):
        return self.info

    def __getattr__(self, name):
        # Options, earnings calendars, statements, fund holdings and other
        # yfinance-only surfaces are explicit capability fallbacks.
        if name.startswith("_"):
            raise AttributeError(name)
        if tiingo_enabled():
            _note_fallback(f"capability:{name}")
        return getattr(self._yahoo, name)


def ticker(symbol, *args, provider_override=None, **kwargs):
    if provider_override == YAHOO_MODE or not tiingo_enabled():
        import yfinance as yf
        return yf.Ticker(symbol, *args, **kwargs)
    return HybridTicker(symbol, *args, **kwargs)
