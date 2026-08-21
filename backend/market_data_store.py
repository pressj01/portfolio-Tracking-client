"""Persist Yahoo/XFUNDS market-data payloads so a restart is not a cold start.

In-memory caches drop on process exit. A later scrape miss then falls through
to Yahoo, which is a poor fit for new XFUNDS names (DRMY, FIZY) that the
issuer site already published. Last-successful payloads live in
market_data_cache and are reused within TTL, or as a stale fallback when a
fresh scrape fails.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

try:
    import pandas as pd
except Exception:  # pragma: no cover - pandas is a runtime dependency of the app
    pd = None


def ensure_market_data_cache(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS market_data_cache (
            cache_key   TEXT PRIMARY KEY,
            source      TEXT NOT NULL,
            ticker      TEXT NOT NULL,
            kind        TEXT NOT NULL,
            fetched_at  TEXT NOT NULL,
            payload     TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_market_data_cache_ticker
        ON market_data_cache (ticker, source, kind)
        """
    )


def cache_key(source, ticker, kind):
    return f"{source}:{kind}:{str(ticker or '').strip().upper()}"


def _now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _encode_default(obj):
    if pd is not None and isinstance(obj, pd.Series):
        data = []
        for idx, val in obj.items():
            if hasattr(idx, "isoformat"):
                idx_s = idx.isoformat()
            else:
                idx_s = str(idx)
            if val is None:
                encoded_val = None
            elif hasattr(val, "item"):
                try:
                    encoded_val = val.item()
                except Exception:
                    encoded_val = float(val) if val == val else None
            else:
                try:
                    encoded_val = float(val)
                except (TypeError, ValueError):
                    encoded_val = val
            data.append([idx_s, encoded_val])
        return {"__type__": "series", "data": data}
    if pd is not None and isinstance(obj, pd.Timestamp):
        return {"__type__": "timestamp", "value": obj.isoformat()}
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "item"):
        try:
            return obj.item()
        except Exception:
            pass
    return str(obj)


def encode_payload(payload):
    return json.dumps(payload, default=_encode_default)


def _decode_object(obj):
    kind = obj.get("__type__") if isinstance(obj, dict) else None
    if kind == "series" and pd is not None:
        pairs = obj.get("data") or []
        if not pairs:
            return pd.Series(dtype=float)
        index = pd.to_datetime([item[0] for item in pairs], errors="coerce")
        values = [item[1] for item in pairs]
        return pd.Series(values, index=index)
    if kind == "timestamp" and pd is not None:
        return pd.Timestamp(obj.get("value"))
    return obj


def decode_payload(raw):
    if not raw:
        return None
    try:
        return json.loads(raw, object_hook=_decode_object)
    except Exception:
        return None


def save(conn, source, ticker, kind, payload):
    if payload is None or conn is None:
        return
    ensure_market_data_cache(conn)
    ticker = str(ticker or "").strip().upper()
    conn.execute(
        """
        INSERT INTO market_data_cache (cache_key, source, ticker, kind, fetched_at, payload)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            payload = excluded.payload,
            source = excluded.source,
            ticker = excluded.ticker,
            kind = excluded.kind
        """,
        (
            cache_key(source, ticker, kind),
            str(source or ""),
            ticker,
            str(kind or ""),
            _now_iso(),
            encode_payload(payload),
        ),
    )


def load(conn, source, ticker, kind, max_age_sec=None):
    """Return the stored payload, or None.

    When max_age_sec is set, ignore rows older than that. When it is None,
    return the last successful payload even if it is stale (scrape-miss fallback).
    """
    if conn is None:
        return None
    ensure_market_data_cache(conn)
    row = conn.execute(
        """SELECT fetched_at, payload
           FROM market_data_cache
           WHERE cache_key = ?""",
        (cache_key(source, ticker, kind),),
    ).fetchone()
    if not row:
        return None
    fetched_at = row["fetched_at"] if hasattr(row, "keys") else row[0]
    raw = row["payload"] if hasattr(row, "keys") else row[1]
    if max_age_sec is not None:
        try:
            fetched = datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
            if fetched.tzinfo is None:
                fetched = fetched.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - fetched).total_seconds()
            if age > float(max_age_sec):
                return None
        except Exception:
            return None
    return decode_payload(raw)
