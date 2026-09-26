import os
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

import pandas as pd

import market_data_provider as provider
import app as app_module


class FakeResponse:
    def __init__(self, status=200, payload=None, text="", headers=None):
        self.status_code = status
        self._payload = payload
        self.text = text
        self.headers = headers or {}

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


def tiingo_prices(close=100.0):
    return [
        {
            "date": "2026-09-24T00:00:00.000Z",
            "open": close - 1,
            "high": close + 1,
            "low": close - 2,
            "close": close,
            "volume": 1000,
            "adjOpen": close - 1,
            "adjHigh": close + 1,
            "adjLow": close - 2,
            "adjClose": close,
            "adjVolume": 1000,
            "divCash": 0.25,
            "splitFactor": 1.0,
        }
    ]


class MarketDataProviderTests(unittest.TestCase):
    def setUp(self):
        provider.invalidate_config()
        provider.reset_runtime_status()

    def _enabled_config(self):
        return {
            "requested": True,
            "token": "valid-token",
            "key_configured": True,
            "key_valid": True,
            "enabled": True,
            "mode": provider.TIINGO_HYBRID_MODE,
        }

    def test_config_requires_checkbox_token_and_matching_validation_hash(self):
        handle, path = tempfile.mkstemp(suffix=".db")
        os.close(handle)
        try:
            conn = sqlite3.connect(path)
            conn.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
            conn.executemany(
                "INSERT INTO settings (key, value) VALUES (?, ?)",
                [
                    (provider.USE_TIINGO_KEY, "false"),
                    (provider.TIINGO_TOKEN_KEY, "abc123"),
                    (provider.TIINGO_VALIDATED_HASH_KEY, provider.token_hash("abc123")),
                ],
            )
            conn.commit()
            conn.close()

            def connect():
                opened = sqlite3.connect(path)
                opened.row_factory = sqlite3.Row
                return opened

            with patch.object(provider, "get_connection", side_effect=connect):
                disabled = provider.provider_config(force=True)
                self.assertFalse(disabled["enabled"])
                conn = connect()
                conn.execute(
                    "UPDATE settings SET value='true' WHERE key=?",
                    (provider.USE_TIINGO_KEY,),
                )
                conn.execute(
                    "UPDATE settings SET value='wrong-hash' WHERE key=?",
                    (provider.TIINGO_VALIDATED_HASH_KEY,),
                )
                conn.commit()
                conn.close()
                mismatch = provider.provider_config(force=True)
                self.assertFalse(mismatch["enabled"])
                conn = connect()
                conn.execute(
                    "UPDATE settings SET value=? WHERE key=?",
                    (provider.token_hash("abc123"), provider.TIINGO_VALIDATED_HASH_KEY),
                )
                conn.commit()
                conn.close()
                enabled = provider.provider_config(force=True)
                self.assertTrue(enabled["enabled"])
                self.assertNotIn("token", enabled)
        finally:
            os.unlink(path)

    def test_yahoo_is_primary_when_tiingo_is_not_enabled(self):
        yahoo = Mock(return_value=pd.DataFrame({"Close": [10.0]}))
        with patch.object(provider, "tiingo_enabled", return_value=False), \
             patch.object(provider.requests, "get") as request_get:
            frame = provider.download("ABC", yahoo_fetch=yahoo, period="5d")
        request_get.assert_not_called()
        yahoo.assert_called_once()
        self.assertEqual(frame.attrs["market_data_sources"], {"ABC": "yahoo"})

    def test_valid_opt_in_uses_tiingo_without_yahoo(self):
        yahoo = Mock(return_value=pd.DataFrame({"Close": [9.0]}))
        with patch.object(provider, "_load_config", return_value=self._enabled_config()), \
             patch.object(provider.requests, "get", return_value=FakeResponse(payload=tiingo_prices())):
            frame = provider.download(
                "ABC", yahoo_fetch=yahoo, period="5d", auto_adjust=False, actions=True
            )
        yahoo.assert_not_called()
        self.assertAlmostEqual(float(frame["Close"].iloc[-1]), 100.0)
        self.assertAlmostEqual(float(frame["Dividends"].iloc[-1]), 0.25)
        self.assertEqual(frame.attrs["market_data_sources"], {"ABC": "tiingo"})

    def test_refusal_falls_back_to_yahoo_and_records_reason(self):
        yahoo_frame = pd.DataFrame(
            {"Close": [88.0]}, index=pd.to_datetime(["2026-09-24"])
        )
        yahoo = Mock(return_value=yahoo_frame)
        refusal = FakeResponse(status=403, payload={"detail": "Plan does not include this data"})
        with patch.object(provider, "_load_config", return_value=self._enabled_config()), \
             patch.object(provider.requests, "get", return_value=refusal):
            frame = provider.download("ABC", yahoo_fetch=yahoo, period="5d")
        yahoo.assert_called_once()
        self.assertAlmostEqual(float(frame["Close"].iloc[-1]), 88.0)
        self.assertEqual(frame.attrs["market_data_sources"], {"ABC": "yahoo_fallback"})
        self.assertEqual(frame.attrs["market_data_fallback_reasons"], {"ABC": "not_entitled"})
        self.assertEqual(provider.runtime_status()["yahoo_fallbacks"], 1)

    def test_mixed_portfolio_keeps_each_ticker_on_one_provider(self):
        def request_get(url, **_kwargs):
            if "/GOOD/" in url:
                return FakeResponse(payload=tiingo_prices(101.0))
            return FakeResponse(status=404, payload={"detail": "Ticker not found"})

        yahoo_frame = pd.DataFrame(
            {"Close": [55.0]}, index=pd.to_datetime(["2026-09-24"])
        )
        yahoo = Mock(return_value=yahoo_frame)
        with patch.object(provider, "_load_config", return_value=self._enabled_config()), \
             patch.object(provider.requests, "get", side_effect=request_get):
            frame = provider.download(
                ["GOOD", "MISS"], yahoo_fetch=yahoo, period="5d", auto_adjust=False
            )
        self.assertIsInstance(frame.columns, pd.MultiIndex)
        self.assertAlmostEqual(float(frame[("Close", "GOOD")].dropna().iloc[-1]), 101.0)
        self.assertAlmostEqual(float(frame[("Close", "MISS")].dropna().iloc[-1]), 55.0)
        self.assertEqual(
            frame.attrs["market_data_sources"],
            {"GOOD": "tiingo", "MISS": "yahoo_fallback"},
        )

    def test_option_override_never_contacts_tiingo(self):
        yahoo = Mock(return_value=pd.DataFrame({"Close": [10.0]}))
        with patch.object(provider, "_load_config", return_value=self._enabled_config()), \
             patch.object(provider.requests, "get") as request_get:
            provider.download(
                "ABC", yahoo_fetch=yahoo, provider_override=provider.YAHOO_MODE, period="5d"
            )
        request_get.assert_not_called()
        yahoo.assert_called_once()

    def test_validation_rejects_bad_key(self):
        response = FakeResponse(status=401, payload={"detail": "Invalid token"})
        with patch.object(provider.requests, "get", return_value=response):
            with self.assertRaises(provider.TiingoError) as raised:
                provider.validate_token("bad-token")
        self.assertEqual(raised.exception.reason, "invalid_key")


class MarketDataProviderSettingTests(unittest.TestCase):
    KEYS = (
        provider.USE_TIINGO_KEY,
        provider.TIINGO_TOKEN_KEY,
        provider.TIINGO_VALIDATED_HASH_KEY,
    )

    def setUp(self):
        self.client = app_module.app.test_client()
        conn = app_module.get_connection()
        try:
            self.original = {
                row["key"]: row["value"]
                for row in conn.execute(
                    f"SELECT key, value FROM settings WHERE key IN ({','.join('?' for _ in self.KEYS)})",
                    self.KEYS,
                )
            }
        finally:
            conn.close()
        self.addCleanup(self._restore)

    def _restore(self):
        conn = app_module.get_connection()
        try:
            for key in self.KEYS:
                if key in self.original:
                    conn.execute(
                        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                        (key, self.original[key]),
                    )
                else:
                    conn.execute("DELETE FROM settings WHERE key = ?", (key,))
            conn.commit()
        finally:
            conn.close()
        provider.invalidate_config()

    def test_saved_key_does_not_enable_tiingo_while_checkbox_is_off(self):
        with patch.object(provider, "validate_token", return_value=True):
            response = self.client.post(
                "/api/market-feed/provider",
                json={"use_tiingo": False, "tiingo_api_key": "valid-test-key"},
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["key_configured"])
        self.assertTrue(payload["key_valid"])
        self.assertFalse(payload["enabled"])
        self.assertEqual(payload["mode"], provider.YAHOO_MODE)
        self.assertNotIn("token", payload)

    def test_checkbox_with_valid_key_enables_hybrid_mode(self):
        with patch.object(provider, "validate_token", return_value=True) as validate:
            response = self.client.post(
                "/api/market-feed/provider",
                json={"use_tiingo": True, "tiingo_api_key": "valid-test-key"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["enabled"])
        validate.assert_called_once_with("valid-test-key")
        conn = app_module.get_connection()
        try:
            stored = {
                row["key"]: row["value"]
                for row in conn.execute(
                    f"SELECT key, value FROM settings WHERE key IN ({','.join('?' for _ in self.KEYS)})",
                    self.KEYS,
                )
            }
        finally:
            conn.close()
        self.assertEqual(stored[provider.USE_TIINGO_KEY], "true")
        self.assertEqual(
            stored[provider.TIINGO_VALIDATED_HASH_KEY],
            provider.token_hash("valid-test-key"),
        )

    def test_invalid_key_is_not_saved_or_enabled(self):
        error = provider.TiingoError("Invalid token", status=401, reason="invalid_key")
        with patch.object(provider, "validate_token", side_effect=error):
            response = self.client.post(
                "/api/market-feed/provider",
                json={"use_tiingo": True, "tiingo_api_key": "bad-test-key"},
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["reason"], "invalid_key")
        conn = app_module.get_connection()
        try:
            row = conn.execute(
                "SELECT value FROM settings WHERE key = ?",
                (provider.TIINGO_TOKEN_KEY,),
            ).fetchone()
        finally:
            conn.close()
        current = row["value"] if row else None
        self.assertEqual(current, self.original.get(provider.TIINGO_TOKEN_KEY))

    def test_disabling_does_not_contact_tiingo(self):
        with patch.object(provider, "validate_token") as validate:
            response = self.client.post(
                "/api/market-feed/provider", json={"use_tiingo": False}
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["enabled"])
        validate.assert_not_called()

    def test_key_test_requires_a_key_even_when_tiingo_is_off(self):
        conn = app_module.get_connection()
        try:
            conn.execute(
                "DELETE FROM settings WHERE key IN (?, ?)",
                (provider.TIINGO_TOKEN_KEY, provider.TIINGO_VALIDATED_HASH_KEY),
            )
            conn.commit()
        finally:
            conn.close()
        provider.invalidate_config()
        with patch.object(provider, "validate_token") as validate:
            response = self.client.post(
                "/api/market-feed/provider",
                json={"use_tiingo": False, "test_only": True},
            )
        self.assertEqual(response.status_code, 400)
        validate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
