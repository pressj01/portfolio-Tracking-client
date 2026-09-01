"""The opt-in "reuse recent prices" setting."""
import unittest
from unittest.mock import patch

import pandas as pd

import app as app_module
import yahoo_gateway as gw


NAN = float("nan")
INDEX = pd.to_datetime(["2026-08-28", "2026-08-31"])


def batch_frame(rows):
    data = {}
    for ticker, closes in rows.items():
        data[("Close", ticker)] = closes if closes is not None else [NAN, NAN]
        data[("Volume", ticker)] = [1000, 1100] if closes is not None else [NAN, NAN]
    frame = pd.DataFrame(data, index=INDEX)
    frame.columns = pd.MultiIndex.from_tuples(frame.columns)
    return frame


class _Throttled(Exception):
    def __init__(self):
        super().__init__("Too Many Requests. Rate limited. Try after a while.")


class PriceReusePolicyTest(unittest.TestCase):
    def setUp(self):
        gw.reset_reuse_cache()
        self.addCleanup(gw.reset_reuse_cache)
        self.addCleanup(gw.set_reuse_policy, False)

    def test_off_by_default(self):
        self.assertFalse(gw.reuse_policy()["enabled"])

    def test_ttl_is_clamped_to_a_sane_range(self):
        self.assertEqual(gw.set_reuse_policy(True, 5)["ttl_sec"], gw.MIN_REUSE_TTL_SEC)
        self.assertEqual(gw.set_reuse_policy(True, 99999)["ttl_sec"], gw.MAX_REUSE_TTL_SEC)

    def test_turning_it_off_drops_everything_held(self):
        gw.set_reuse_policy(True, 600)
        gw.store_download(("k",), batch_frame({"AAA": [1.0, 2.0]}))
        self.assertEqual(gw.reuse_stats()["entries"], 1)
        gw.set_reuse_policy(False)
        self.assertEqual(gw.reuse_stats()["entries"], 0)

    def test_changing_the_window_also_drops_everything_held(self):
        gw.set_reuse_policy(True, 600)
        gw.store_download(("k",), batch_frame({"AAA": [1.0, 2.0]}))
        gw.set_reuse_policy(True, 120)
        self.assertEqual(
            gw.reuse_stats()["entries"], 0,
            "a shortened window must take effect at once, not as entries age out",
        )

    def test_nothing_is_served_while_disabled(self):
        gw.set_reuse_policy(True, 600)
        gw.store_download(("k",), batch_frame({"AAA": [1.0, 2.0]}))
        gw.set_reuse_policy(False)
        self.assertIsNone(gw.cached_download(("k",)))

    def test_an_expired_entry_is_not_served(self):
        gw.set_reuse_policy(True, 600)
        gw.store_download(("k",), batch_frame({"AAA": [1.0, 2.0]}))
        with patch.object(gw.time, "time", lambda: 1e12):
            self.assertIsNone(gw.cached_download(("k",)))

    def test_the_cache_is_bounded(self):
        gw.set_reuse_policy(True, 600)
        for i in range(gw.REUSE_MAX_ENTRIES + 10):
            gw.store_download((f"k{i}",), batch_frame({"AAA": [1.0, 2.0]}))
        self.assertLessEqual(gw.reuse_stats()["entries"], gw.REUSE_MAX_ENTRIES)

    def test_an_empty_frame_is_never_stored(self):
        gw.set_reuse_policy(True, 600)
        gw.store_download(("k",), pd.DataFrame())
        self.assertEqual(
            gw.reuse_stats()["entries"], 0,
            "caching a throttled blank would serve an outage back as a price",
        )


class PriceReuseThroughDownloadTest(unittest.TestCase):
    def setUp(self):
        gw.reset_breaker()
        gw.reset_reuse_cache()
        patcher = patch.object(app_module, "_symbol_map_load", lambda conn=None: {})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(gw.reset_breaker)
        self.addCleanup(gw.reset_reuse_cache)
        self.addCleanup(gw.set_reuse_policy, False)

    def _download(self, side_effect, calls_wanted, period="6mo"):
        with patch("yfinance.download", side_effect=side_effect):
            return app_module._chunked_yf_download(["AAA", "BBB"], period=period)

    def test_disabled_downloads_every_time(self):
        gw.set_reuse_policy(False)
        calls = []

        def fake(t, **kw):
            calls.append(t)
            return batch_frame({"AAA": [1.0, 2.0], "BBB": [3.0, 4.0]})

        for _ in range(3):
            self._download(fake, 3)
        self.assertEqual(len(calls), 3)

    def test_enabled_downloads_once_for_repeats_of_the_same_window(self):
        gw.set_reuse_policy(True, 600)
        calls = []

        def fake(t, **kw):
            calls.append(t)
            return batch_frame({"AAA": [1.0, 2.0], "BBB": [3.0, 4.0]})

        frames = [self._download(fake, 1) for _ in range(3)]
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(float(f[("Close", "AAA")].iloc[-1]) == 2.0 for f in frames))
        self.assertEqual(gw.reuse_stats()["requests_avoided"], 2)

    def test_a_different_window_is_not_served_from_another_windows_cache(self):
        gw.set_reuse_policy(True, 600)
        periods = []

        def fake(t, **kw):
            periods.append(kw.get("period"))
            return batch_frame({"AAA": [1.0, 2.0], "BBB": [3.0, 4.0]})

        self._download(fake, 1, period="6mo")
        self._download(fake, 2, period="1y")
        self._download(fake, 2, period="6mo")
        self.assertEqual(periods, ["6mo", "1y"])

    def test_a_reused_frame_is_isolated_from_the_callers_edits(self):
        gw.set_reuse_policy(True, 600)

        def fake(t, **kw):
            return batch_frame({"AAA": [1.0, 2.0], "BBB": [3.0, 4.0]})

        first = self._download(fake, 1)
        first[("Close", "AAA")] = [99.0, 99.0]
        second = self._download(fake, 1)
        self.assertEqual(
            float(second[("Close", "AAA")].iloc[0]), 1.0,
            "one screen's edits must not reach the next screen's prices",
        )

    def test_a_throttled_download_is_never_cached(self):
        gw.set_reuse_policy(True, 600)
        calls = []

        def fake(t, **kw):
            calls.append(t)
            raise _Throttled()

        with patch.object(gw, "BASE_BACKOFF_SEC", 0.001):
            self._download(fake, 1, period="2y")
        self.assertEqual(gw.reuse_stats()["entries"], 0)


class PriceReuseSettingTest(unittest.TestCase):
    """These exercise the real settings table, so they must put it back.

    The endpoint's whole job is persistence; stubbing the database out would
    test nothing. Instead the original rows are captured and restored, so
    running the suite never changes the user's own preference.
    """

    KEYS = (app_module.PRICE_REUSE_ENABLED_KEY, app_module.PRICE_REUSE_TTL_KEY)

    def setUp(self):
        self.client = app_module.app.test_client()
        conn = app_module.get_connection()
        try:
            self._original = {
                row["key"]: row["value"]
                for row in conn.execute(
                    "SELECT key, value FROM settings WHERE key IN (?, ?)", self.KEYS
                )
            }
        finally:
            conn.close()
        self.addCleanup(self._restore)
        self.addCleanup(gw.reset_reuse_cache)

    def _restore(self):
        conn = app_module.get_connection()
        try:
            for key in self.KEYS:
                if key in self._original:
                    conn.execute(
                        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                        (key, self._original[key]),
                    )
                else:
                    conn.execute("DELETE FROM settings WHERE key = ?", (key,))
            conn.commit()
        finally:
            conn.close()
        app_module._load_price_reuse_policy()

    def test_setting_round_trips_and_reaches_the_gateway(self):
        saved = self.client.post(
            "/api/market-feed/price-reuse",
            json={"enabled": True, "ttl_minutes": 15},
        ).get_json()
        self.assertTrue(saved["enabled"])
        self.assertEqual(saved["ttl_sec"], 900.0)
        self.assertTrue(gw.reuse_policy()["enabled"])

        # Reloading from the settings table must restore the same policy, which
        # is what makes the choice survive a restart.
        gw.set_reuse_policy(False)
        reloaded = app_module._load_price_reuse_policy()
        self.assertTrue(reloaded["enabled"])
        self.assertEqual(reloaded["ttl_sec"], 900.0)

        self.client.post("/api/market-feed/price-reuse", json={"enabled": False})
        self.assertFalse(app_module._load_price_reuse_policy()["enabled"])

    def test_ttl_minutes_are_clamped_at_the_endpoint(self):
        self.assertEqual(
            self.client.post("/api/market-feed/price-reuse",
                             json={"enabled": True, "ttl_minutes": 9999}).get_json()["ttl_sec"],
            3600.0,
        )

    def test_clear_endpoint_empties_the_cache(self):
        gw.set_reuse_policy(True, 600)
        gw.store_download(("k",), batch_frame({"AAA": [1.0, 2.0]}))
        cleared = self.client.post("/api/market-feed/clear-price-cache").get_json()
        self.assertEqual(cleared["entries"], 0)

    def test_status_endpoint_reports_the_reuse_state(self):
        payload = self.client.get("/api/market-feed/status").get_json()
        self.assertIn("price_reuse", payload)
        self.assertIn("enabled", payload["price_reuse"])


if __name__ == "__main__":
    unittest.main()
