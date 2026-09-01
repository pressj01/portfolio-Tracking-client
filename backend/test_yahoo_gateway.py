import sqlite3
import threading
import time
import unittest
from unittest.mock import patch

import pandas as pd

import yahoo_gateway as gw


class _Throttled(Exception):
    """Stands in for yfinance's YFRateLimitError."""

    def __init__(self, message="Too Many Requests. Rate limited. Try after a while."):
        super().__init__(message)


class _Response:
    def __init__(self, status_code, headers=None):
        self.status_code = status_code
        self.headers = headers or {}


class _HttpError(Exception):
    def __init__(self, message, response):
        super().__init__(message)
        self.response = response


class _SharedConnection:
    """An in-memory SQLite connection whose close() is a no-op.

    The gateway opens and closes a connection per flush; an in-memory database
    would be destroyed by the first close, so tests keep one alive underneath.
    """

    def __init__(self, conn):
        self._conn = conn

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def close(self):
        return None


class RateLimitDetectionTest(unittest.TestCase):
    def test_throttle_wording_is_recognized(self):
        self.assertTrue(gw.is_rate_limited(_Throttled()))
        self.assertTrue(gw.is_rate_limited(Exception("rate limit exceeded")))
        self.assertTrue(gw.is_rate_limited(_HttpError("nope", _Response(429))))

    def test_missing_symbol_is_not_a_throttle(self):
        # The distinction the whole module rests on: retrying this cannot help.
        self.assertFalse(gw.is_rate_limited(Exception("$FOO: possibly delisted; no price data found")))
        self.assertFalse(gw.is_transient(Exception("$FOO: possibly delisted; no price data found")))

    def test_bare_429_in_text_is_not_treated_as_a_status_code(self):
        # A strike price or a share count must not read as a rate limit.
        self.assertFalse(gw.is_rate_limited(Exception("strike 429.0 has no bid")))
        self.assertTrue(gw.is_rate_limited(Exception("HTTP error 429 from Yahoo")))

    def test_transport_blips_are_transient_not_throttles(self):
        self.assertTrue(gw.is_transient(Exception("Connection reset by peer")))
        self.assertTrue(gw.is_transient(_HttpError("bad", _Response(503))))
        self.assertFalse(gw.is_rate_limited(Exception("Connection reset by peer")))

    def test_retry_after_header_is_read(self):
        exc = _HttpError("slow down", _Response(429, {"Retry-After": "17"}))
        self.assertEqual(gw.retry_after_seconds(exc), 17.0)
        self.assertIsNone(gw.retry_after_seconds(Exception("no response")))


class BackoffTest(unittest.TestCase):
    def setUp(self):
        gw.reset_breaker()
        self.addCleanup(gw.reset_breaker)

    def test_transient_failure_is_retried_then_succeeds(self):
        calls = []

        def flaky():
            calls.append(1)
            if len(calls) < 3:
                raise Exception("Connection reset by peer")
            return "ok"

        with patch.object(gw, "BASE_BACKOFF_SEC", 0.001):
            self.assertEqual(gw.call(flaky), "ok")
        self.assertEqual(len(calls), 3)

    def test_permanent_failure_is_not_retried(self):
        calls = []

        def delisted():
            calls.append(1)
            raise Exception("$FOO: possibly delisted; no price data found")

        with self.assertRaises(Exception):
            gw.call(delisted)
        self.assertEqual(len(calls), 1, "a delisted symbol must not be retried")

    def test_isolated_throttle_is_retried_without_opening_the_breaker(self):
        calls = []

        def once_throttled():
            calls.append(1)
            if len(calls) == 1:
                raise _Throttled()
            return "ok"

        with patch.object(gw, "BASE_BACKOFF_SEC", 0.001):
            self.assertEqual(gw.call(once_throttled), "ok")
        self.assertFalse(gw.is_cooling_down())

    def test_backoff_sleep_is_bounded_by_the_total_budget(self):
        slept = []

        with patch.object(gw, "BASE_BACKOFF_SEC", 100.0), \
             patch.object(gw, "MAX_BACKOFF_SEC", 100.0), \
             patch.object(gw, "MAX_TOTAL_BACKOFF_SEC", 0.05), \
             patch.object(gw.time, "sleep", lambda s: slept.append(s)):
            with self.assertRaises(Exception):
                gw.call(lambda: (_ for _ in ()).throw(Exception("timed out")))
        self.assertTrue(all(s <= 0.05 for s in slept), slept)


class CircuitBreakerTest(unittest.TestCase):
    def setUp(self):
        gw.reset_breaker()
        self.addCleanup(gw.reset_breaker)

    def _always_throttled(self):
        raise _Throttled()

    def test_consecutive_throttles_open_the_gate_and_later_calls_never_run(self):
        with patch.object(gw, "BASE_BACKOFF_SEC", 0.001):
            for _ in range(gw.BREAKER_THRESHOLD):
                with self.assertRaises(Exception):
                    gw.call(self._always_throttled, attempts=1)

        self.assertTrue(gw.is_cooling_down())

        ran = []
        with self.assertRaises(gw.YahooCooldown):
            gw.call(lambda: ran.append(1))
        self.assertEqual(ran, [], "the breaker must fail fast, not call Yahoo")

    def test_cooldown_escalates_with_repeated_trips(self):
        first = gw.note_rate_limit()
        for _ in range(gw.BREAKER_THRESHOLD - 1):
            gw.note_rate_limit()
        # Threshold reached: the first cooldown is the base span.
        self.assertAlmostEqual(gw._cooldown_for(1), gw.BREAKER_BASE_COOLDOWN_SEC)
        self.assertGreater(gw._cooldown_for(3), gw._cooldown_for(1))
        self.assertLessEqual(gw._cooldown_for(99), gw.BREAKER_MAX_COOLDOWN_SEC)
        self.assertEqual(first, 0.0, "one isolated throttle must not open the gate")

    def test_retry_after_extends_a_short_cooldown(self):
        with patch.object(gw, "BREAKER_THRESHOLD", 1), \
             patch.object(gw, "BREAKER_BASE_COOLDOWN_SEC", 5.0):
            cooldown = gw.note_rate_limit(retry_after=120)
        self.assertEqual(cooldown, 120.0)

    def test_half_open_admits_exactly_one_probe(self):
        with patch.object(gw, "BREAKER_THRESHOLD", 1), \
             patch.object(gw, "BREAKER_BASE_COOLDOWN_SEC", 0.05):
            gw.note_rate_limit()
            self.assertTrue(gw.is_cooling_down())
            time.sleep(0.08)

            allowed_first, _ = gw._admit()
            allowed_second, _ = gw._admit()

        self.assertTrue(allowed_first, "the elapsed cooldown must admit a probe")
        self.assertFalse(allowed_second, "only one probe may test a recovered feed")

    def test_successful_probe_closes_the_gate(self):
        with patch.object(gw, "BREAKER_THRESHOLD", 1), \
             patch.object(gw, "BREAKER_BASE_COOLDOWN_SEC", 0.05):
            gw.note_rate_limit()
            time.sleep(0.08)
            self.assertEqual(gw.call(lambda: "back"), "back")
        self.assertFalse(gw.is_cooling_down())

    def test_failed_probe_reopens_immediately_without_waiting_for_a_new_run(self):
        with patch.object(gw, "BREAKER_THRESHOLD", 3), \
             patch.object(gw, "BREAKER_BASE_COOLDOWN_SEC", 0.05):
            # Force a trip, let it lapse, then fail the probe.
            for _ in range(3):
                gw.note_rate_limit()
            time.sleep(0.08)
            allowed, _ = gw._admit()
            self.assertTrue(allowed)
            gw.note_rate_limit()
        # One failed probe re-opens the gate even though `consecutive` is only 1.
        self.assertTrue(gw.is_cooling_down())

    def test_non_throttle_failure_does_not_open_the_gate(self):
        for _ in range(gw.BREAKER_THRESHOLD + 2):
            with self.assertRaises(Exception):
                gw.call(lambda: (_ for _ in ()).throw(Exception("no price data found")))
        self.assertFalse(gw.is_cooling_down())
        self.assertIn("no price data found", gw.breaker_state()["last_error"])


class CoalescingTest(unittest.TestCase):
    def setUp(self):
        gw.reset_breaker()
        self.addCleanup(gw.reset_breaker)

    def test_concurrent_callers_share_one_request(self):
        calls = []
        released = threading.Event()

        def slow():
            calls.append(1)
            released.wait(2.0)
            return {"value": 1}

        results = []
        threads = [
            threading.Thread(target=lambda: results.append(gw.coalesce("k", slow)))
            for _ in range(5)
        ]
        for thread in threads:
            thread.start()
        time.sleep(0.15)
        released.set()
        for thread in threads:
            thread.join(3.0)

        self.assertEqual(len(calls), 1, "five callers, one network request")
        self.assertEqual(len(results), 5)
        self.assertTrue(all(r == {"value": 1} for r in results))

    def test_each_caller_gets_its_own_object(self):
        released = threading.Event()

        def slow():
            released.wait(2.0)
            return {"shared": True}

        results = []
        threads = [
            threading.Thread(target=lambda: results.append(gw.coalesce("k2", slow)))
            for _ in range(3)
        ]
        for thread in threads:
            thread.start()
        time.sleep(0.15)
        released.set()
        for thread in threads:
            thread.join(3.0)

        results[0]["mutated"] = True
        self.assertNotIn("mutated", results[1], "a caller's edits must not leak sideways")

    def test_dataframe_result_is_copied_per_caller(self):
        frame = pd.DataFrame({"Close": [1.0, 2.0]})
        first = gw.coalesce("frame", lambda: frame)
        first.loc[0, "Close"] = 99.0
        self.assertEqual(frame.loc[0, "Close"], 1.0)

    def test_failure_reaches_every_waiter(self):
        released = threading.Event()

        def boom():
            released.wait(2.0)
            raise ValueError("bang")

        errors = []

        def run():
            try:
                gw.coalesce("k3", boom)
            except Exception as exc:
                errors.append(type(exc).__name__)

        threads = [threading.Thread(target=run) for _ in range(3)]
        for thread in threads:
            thread.start()
        time.sleep(0.15)
        released.set()
        for thread in threads:
            thread.join(3.0)

        self.assertEqual(errors, ["ValueError"] * 3)
        self.assertEqual(gw.inflight_count(), 0, "the flight must be cleared on failure")

    def test_key_is_released_after_completion(self):
        gw.coalesce("k4", lambda: 1)
        self.assertEqual(gw.inflight_count(), 0)


class PersistenceTest(unittest.TestCase):
    def setUp(self):
        gw.reset_breaker()
        gw.reset_persistence()
        self.raw = sqlite3.connect(":memory:")
        self.raw.row_factory = sqlite3.Row
        patcher = patch.object(gw, "get_connection", lambda: _SharedConnection(self.raw))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.raw.close)
        self.addCleanup(gw.reset_persistence)
        self.addCleanup(gw.reset_breaker)

    def test_buffered_value_is_readable_before_it_reaches_disk(self):
        gw.remember("quote", "AAPL", {"last": 190.0})
        self.assertEqual(gw.recall("quote", "AAPL")["last"], 190.0)

    def test_flush_writes_through_and_survives_a_buffer_reset(self):
        gw.remember("quote", "MSFT", {"last": 400.0})
        gw.flush_persisted()
        gw.reset_persistence()
        self.assertEqual(gw.recall("quote", "MSFT")["last"], 400.0)

    def test_recall_is_case_insensitive_on_the_ticker(self):
        gw.remember("quote", "nvda", {"last": 1.0}, flush=True)
        self.assertIsNotNone(gw.recall("quote", "NVDA"))

    def test_fetch_serves_last_good_when_the_breaker_is_open(self):
        gw.remember("quote", "SPY", {"last": 500.0}, flush=True)
        with patch.object(gw, "BREAKER_THRESHOLD", 1), \
             patch.object(gw, "BREAKER_BASE_COOLDOWN_SEC", 30.0):
            gw.note_rate_limit()

        ran = []
        payload, meta = gw.fetch("quote", "SPY", lambda: ran.append(1))

        self.assertEqual(ran, [], "no request may be made during a cooldown")
        self.assertEqual(payload["last"], 500.0)
        self.assertTrue(meta["stale"])
        self.assertTrue(meta["cooling_down"])
        self.assertGreater(meta["retry_after_sec"], 0)

    def test_fetch_reports_a_live_answer_as_not_stale_and_persists_it(self):
        payload, meta = gw.fetch("quote", "QQQ", lambda: {"last": 450.0})
        self.assertEqual(payload["last"], 450.0)
        self.assertFalse(meta["stale"])
        self.assertIsNone(meta["error"])
        self.assertEqual(gw.recall("quote", "QQQ")["last"], 450.0)

    def test_fetch_without_stored_history_returns_none_not_a_crash(self):
        payload, meta = gw.fetch(
            "quote", "NEW", lambda: (_ for _ in ()).throw(Exception("no price data found"))
        )
        self.assertIsNone(payload)
        self.assertFalse(meta["stale"])
        self.assertIn("no price data", meta["error"])

    def test_ttl_hit_skips_the_network_entirely(self):
        gw.remember("info", "VOO", {"sector": "Broad"}, flush=True)
        ran = []
        payload, meta = gw.fetch("info", "VOO", lambda: ran.append(1), ttl=3600)
        self.assertEqual(ran, [])
        self.assertTrue(meta["cached"])
        self.assertEqual(payload["sector"], "Broad")


if __name__ == "__main__":
    unittest.main()
