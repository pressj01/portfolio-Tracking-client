"""Rate-limit behaviour of the options quote/expiration/chain fetchers."""
import sqlite3
import threading
import time
import unittest
from unittest.mock import patch

import options_api
import yahoo_gateway as gw


class _Throttled(Exception):
    def __init__(self):
        super().__init__("Too Many Requests. Rate limited. Try after a while.")


class _SharedConnection:
    def __init__(self, conn):
        self._conn = conn

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def close(self):
        return None


class _FastInfo:
    def __init__(self, values, raises=None):
        self._values = values
        self._raises = raises

    def __getattr__(self, name):
        if self._raises is not None:
            raise self._raises()
        return self._values.get(name)

    def __getitem__(self, name):
        if self._raises is not None:
            raise self._raises()
        return self._values.get(name)


class _FakeTicker:
    """Minimal stand-in for yf.Ticker with per-surface failure injection."""

    def __init__(self, *, fast=None, fast_raises=None, options=None,
                 options_raises=None, info=None, info_raises=None):
        self._fast = _FastInfo(fast or {}, fast_raises)
        self._options = options
        self._options_raises = options_raises
        self._info = info or {}
        self._info_raises = info_raises

    @property
    def fast_info(self):
        return self._fast

    @property
    def options(self):
        if self._options_raises is not None:
            raise self._options_raises()
        return self._options

    @property
    def info(self):
        if self._info_raises is not None:
            raise self._info_raises()
        return self._info

    def history(self, *args, **kwargs):
        raise _Throttled()


class OptionsFeedHardeningTest(unittest.TestCase):
    def setUp(self):
        options_api._quote_cache.clear()
        options_api._exp_cache.clear()
        options_api._chain_cache.clear()
        gw.reset_breaker()
        gw.reset_persistence()
        self.raw = sqlite3.connect(":memory:")
        self.raw.row_factory = sqlite3.Row
        patcher = patch.object(gw, "get_connection", lambda: _SharedConnection(self.raw))
        patcher.start()
        self.addCleanup(patcher.stop)
        # The backoff is real time; these tests assert on policy, not duration.
        backoff = patch.object(gw, "BASE_BACKOFF_SEC", 0.001)
        backoff.start()
        self.addCleanup(backoff.stop)
        self.addCleanup(self.raw.close)
        self.addCleanup(gw.reset_breaker)
        self.addCleanup(gw.reset_persistence)
        self.addCleanup(options_api._quote_cache.clear)
        self.addCleanup(options_api._exp_cache.clear)

    # ── Quotes ─────────────────────────────────────────────────────────────

    def test_a_throttled_quote_is_not_cached_as_a_dead_ticker(self):
        throttled = _FakeTicker(fast_raises=_Throttled, info_raises=_Throttled)
        with patch.object(options_api, "yf") as fake_yf:
            fake_yf.Ticker.return_value = throttled
            quote = options_api._fetch_quote("SPY")

        self.assertIsNone(quote["last"])
        self.assertNotIn(
            "SPY", options_api._quote_cache,
            "caching a throttled blank pins 'no price' for the whole TTL",
        )

    def test_a_throttled_quote_falls_back_to_the_last_good_price(self):
        gw.remember("quote", "SPY", {"ticker": "SPY", "last": 512.5, "div_yield": 0.01},
                    flush=True)
        throttled = _FakeTicker(fast_raises=_Throttled, info_raises=_Throttled)
        with patch.object(options_api, "yf") as fake_yf:
            fake_yf.Ticker.return_value = throttled
            quote = options_api._fetch_quote("SPY")

        self.assertEqual(quote["last"], 512.5)
        self.assertTrue(quote["stale"])
        self.assertNotIn("SPY", options_api._quote_cache)

    def test_a_live_quote_is_cached_and_persisted(self):
        live = _FakeTicker(
            fast={"last_price": 100.0, "previous_close": 99.0, "bid": 99.9, "ask": 100.1},
            info={"shortName": "Test Fund", "dividendYield": 0.02},
        )
        with patch.object(options_api, "yf") as fake_yf:
            fake_yf.Ticker.return_value = live
            quote = options_api._fetch_quote("TEST")

        self.assertEqual(quote["last"], 100.0)
        self.assertFalse(quote["stale"])
        self.assertIn("TEST", options_api._quote_cache)
        self.assertEqual(gw.recall("quote", "TEST")["last"], 100.0)

    def test_a_throttled_info_scrape_does_not_discard_a_good_price(self):
        # fast_info answered; only the slow .info call was throttled. Reporting
        # an outage here would throw away a perfectly good live price.
        partial = _FakeTicker(
            fast={"last_price": 250.0, "previous_close": 249.0},
            info_raises=_Throttled,
        )
        with patch.object(options_api, "yf") as fake_yf:
            fake_yf.Ticker.return_value = partial
            quote = options_api._fetch_quote("PART")

        self.assertEqual(quote["last"], 250.0)
        self.assertFalse(quote["stale"])
        self.assertIn("PART", options_api._quote_cache)

    def test_concurrent_quotes_for_one_ticker_make_one_request(self):
        calls = []
        released = threading.Event()

        class _Slow(_FakeTicker):
            @property
            def fast_info(self):
                calls.append(1)
                released.wait(2.0)
                return super().fast_info

        slow = _Slow(fast={"last_price": 10.0, "previous_close": 9.5}, info={})
        results = []

        def run():
            with patch.object(options_api, "yf") as fake_yf:
                fake_yf.Ticker.return_value = slow
                results.append(options_api._fetch_quote("SLOW"))

        threads = [threading.Thread(target=run) for _ in range(4)]
        for thread in threads:
            thread.start()
        time.sleep(0.2)
        released.set()
        for thread in threads:
            thread.join(4.0)

        # fast_info is read once per accessor within a single build, so the
        # meaningful check is that only one build ran at all.
        self.assertEqual(len(results), 4)
        self.assertTrue(all(r["last"] == 10.0 for r in results))
        self.assertLessEqual(
            len(calls), 8, "a second concurrent build would double the accessor reads"
        )

    # ── Expirations ────────────────────────────────────────────────────────

    def test_a_throttled_catalog_is_not_cached_as_no_options(self):
        throttled = _FakeTicker(options_raises=_Throttled)
        with patch.object(options_api, "yf") as fake_yf:
            fake_yf.Ticker.return_value = throttled
            exps = options_api._fetch_expirations("SPY")

        self.assertEqual(exps, [])
        self.assertNotIn(
            "SPY", options_api._exp_cache,
            "a throttled catalog cached as [] reports 'no options' for 5 minutes",
        )

    def test_a_throttled_catalog_falls_back_to_the_last_good_one(self):
        gw.remember("option_expirations", "SPY", ["2026-09-18", "2026-10-16"], flush=True)
        throttled = _FakeTicker(options_raises=_Throttled)
        with patch.object(options_api, "yf") as fake_yf:
            fake_yf.Ticker.return_value = throttled
            exps = options_api._fetch_expirations("SPY")

        self.assertEqual(exps, ["2026-09-18", "2026-10-16"])

    def test_a_genuinely_optionless_ticker_is_cached(self):
        # An empty catalog from a healthy request is a real answer and must not
        # cost a fresh request every time it is asked for.
        no_options = _FakeTicker(options=[])
        with patch.object(options_api, "yf") as fake_yf:
            fake_yf.Ticker.return_value = no_options
            self.assertEqual(options_api._fetch_expirations("BOND"), [])

        self.assertIn("BOND", options_api._exp_cache)

    def test_a_live_catalog_is_cached_and_persisted(self):
        live = _FakeTicker(options=["2026-09-18"])
        with patch.object(options_api, "yf") as fake_yf:
            fake_yf.Ticker.return_value = live
            self.assertEqual(options_api._fetch_expirations("QQQ"), ["2026-09-18"])

        self.assertIn("QQQ", options_api._exp_cache)
        self.assertEqual(gw.recall("option_expirations", "QQQ"), ["2026-09-18"])

    def test_repeated_throttled_catalogs_open_the_breaker(self):
        throttled = _FakeTicker(options_raises=_Throttled)
        with patch.object(options_api, "yf") as fake_yf, \
             patch.object(gw, "BASE_BACKOFF_SEC", 0.001):
            fake_yf.Ticker.return_value = throttled
            for ticker in ("AAA", "BBB", "CCC", "DDD"):
                options_api._fetch_expirations(ticker)

        self.assertTrue(gw.is_cooling_down())


if __name__ == "__main__":
    unittest.main()
