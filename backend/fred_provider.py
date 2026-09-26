"""Per-installation FRED API-key storage and validation.

FRED requires every user of an application to use that user's own API key.
This module intentionally has no environment or bundled-key fallback: a
validated key saved in the local application database is the only way to make
FRED requests.
"""
from __future__ import annotations

import hashlib
import threading
import time

import requests

from config import get_connection


FRED_TOKEN_KEY = "fred_api_key"
FRED_VALIDATED_HASH_KEY = "fred_validated_key_hash"
FRED_API_BASE = "https://api.stlouisfed.org/fred"
FRED_API_KEY_URL = "https://fredaccount.stlouisfed.org/apikeys"
FRED_TERMS_URL = "https://fred.stlouisfed.org/docs/api/terms_of_use.html"

_CONFIG_TTL_SEC = 2.0
_config_lock = threading.Lock()
_config_cache = {"loaded_at": 0.0, "value": None}


class FredError(RuntimeError):
    """A rejected or unavailable FRED API key."""


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
    """Make a saved Settings change effective on the next FRED request."""
    with _config_lock:
        _config_cache.update(loaded_at=0.0, value=None)


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
        keys = (FRED_TOKEN_KEY, FRED_VALIDATED_HASH_KEY)
        rows = {
            row["key"]: row["value"]
            for row in conn.execute(
                f"SELECT key, value FROM settings WHERE key IN ({','.join('?' for _ in keys)})",
                keys,
            )
        }
    finally:
        if conn is not None:
            conn.close()

    token = str(rows.get(FRED_TOKEN_KEY, "") or "").strip()
    validated_hash = str(rows.get(FRED_VALIDATED_HASH_KEY, "") or "").strip()
    value = {
        "token": token,
        "key_configured": bool(token),
        "key_valid": bool(token and validated_hash and token_hash(token) == validated_hash),
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


def active_key() -> str | None:
    config = _load_config()
    return config.get("token") if config.get("key_valid") else None


def validate_token(token: str) -> None:
    """Confirm a key with a minimal official FRED observations request."""
    token = str(token or "").strip()
    if not token:
        raise FredError("Enter a FRED API key first.")
    try:
        response = requests.get(
            f"{FRED_API_BASE}/series/observations",
            params={
                "series_id": "GDP",
                "api_key": token,
                "file_type": "json",
                "limit": 1,
            },
            timeout=15,
        )
    except requests.RequestException as exc:
        raise FredError(f"Could not reach FRED: {exc}") from exc

    if response.status_code != 200:
        try:
            detail = response.json().get("error_message")
        except ValueError:
            detail = None
        raise FredError(detail or f"FRED returned HTTP {response.status_code}.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise FredError("FRED returned an invalid validation response.") from exc
    if not isinstance(payload.get("observations"), list):
        raise FredError("FRED did not confirm this API key.")
