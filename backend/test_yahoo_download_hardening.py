"""The rate-limit hardening as it behaves through `_chunked_yf_download`."""
import threading
import time
import unittest
from unittest.mock import patch

import pandas as pd

import app as app_module
import yahoo_gateway as gw


NAN = float("nan")
INDEX = pd.to_datetime(["2026-08-28", "2026-08-31"])


def batch_frame(rows):
    """A multi-ticker download frame. `rows` maps ticker -> closes, or None."""
    data = {}
    for ticker, closes in rows.items():
        data[("Close", ticker)] = closes if closes is not None else [NAN, NAN]
        data[("Volume", ticker)] = [1000, 1100] if closes is not None else [NAN, NAN]
    frame = pd.DataFrame(data, index=INDEX)
    frame.columns = pd.MultiIndex.from_tuples(frame.columns)
    return frame


def single_frame(closes):
    """A single-ticker download frame: flat columns, as yfinance returns them."""
    return pd.DataFrame({"Close": closes, "Volume": [1000, 1100]}, index=INDEX)


class _Throttled(Exception):
    def __init__(self):
        super().__init__("Too Many Requests. Rate limited. Try after a while.")


class DownloadHardeningTest(unittest.TestCase):
    def setUp(self):
        gw.reset_breaker()
        gw.reset_persistence()
        # Keep the symbol translation out of the way: these tests are about the
        # rate-limit policy, not about broker->Yahoo spelling.
        patcher = patch.object(app_module, "_symbol_map_load", lambda conn=None: {})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(gw.reset_breaker)
        self.addCleanup(gw.reset_persistence)

    # ── Missing-ticker-only retries ────────────────────────────────────────

    def test_only_the_unpriced_symbol_is_re_requested(self):
        calls = []

        def fake_download(tickers, **kwargs):
            calls.append(tickers)
            if isinstance(tickers, str):
                return single_frame([30.0, 31.0])
            return batch_frame({"AAA": [10.0, 11.0], "BBB": [20.0, 21.0], "CCC": None})

        with patch("yfinance.download", side_effect=fake_download):
            frame = app_module._chunked_yf_download(["AAA", "BBB", "CCC"], period="1mo")

        self.assertEqual(len(calls), 2, "one batch plus one recovery request")
        self.assertEqual(calls[1], "CCC", "only the symbol with no data is retried")
        self.assertEqual(float(frame[("Close", "CCC")].iloc[-1]), 31.0)
        # The recovered column replaces the all-NaN placeholder rather than
        # sitting beside it.
        self.assertEqual(
            sum(1 for label in frame.columns if label == ("Close", "CCC")), 1
        )
        self.assertEqual(float(frame[("Close", "AAA")].iloc[-1]), 11.0)

    def test_a_mostly_empty_batch_is_left_alone_because_it_is_an_outage(self):
        calls = []

        def fake_download(tickers, **kwargs):
            calls.append(tickers)
            return batch_frame({"AAA": [10.0, 11.0], "BBB": [20.0, 21.0],
                                "CCC": [30.0, 31.0],
                                "DDD": None, "EEE": None, "FFF": None})

        with patch("yfinance.download", side_effect=fake_download):
            app_module._chunked_yf_download(
                ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"], period="1mo"
            )

        self.assertEqual(
            len(calls), 1,
            "half the batch empty is a throttled feed; per-symbol retries extend it",
        )

    def test_one_blank_in_a_small_batch_is_still_recovered(self):
        """50% missing, but only one symbol: that is a dropped name, not an
        outage, and suppressing the retry would leave it unpriced for nothing."""
        calls = []

        def fake_download(tickers, **kwargs):
            calls.append(tickers)
            if isinstance(tickers, str):
                return single_frame([30.0, 31.0])
            return batch_frame({"AAA": [10.0, 11.0], "BBB": None})

        with patch("yfinance.download", side_effect=fake_download):
            frame = app_module._chunked_yf_download(["AAA", "BBB"], period="1mo")

        self.assertEqual(calls[1:], ["BBB"])
        self.assertEqual(float(frame[("Close", "BBB")].iloc[-1]), 31.0)

    def test_a_recovery_pass_is_capped_in_absolute_size(self):
        missing = [f"M{i}" for i in range(12)]
        priced = [f"P{i}" for i in range(30)]
        calls = []

        def fake_download(tickers, **kwargs):
            calls.append(tickers)
            if isinstance(tickers, str):
                return single_frame([1.0, 2.0])
            rows = {t: [1.0, 2.0] for t in priced}
            rows.update({t: None for t in missing})
            return batch_frame(rows)

        with patch("yfinance.download", side_effect=fake_download):
            app_module._chunked_yf_download(priced + missing, chunk_size=100, period="1mo")

        singles = [c for c in calls if isinstance(c, str)]
        self.assertEqual(len(singles), app_module._MAX_RECOVERY_REQUESTS)

    def test_recovery_stops_at_the_first_throttled_symbol(self):
        """Two symbols need recovering; the first is throttled, so the second
        is never asked for. Continuing the list is how a brief throttle became
        a long one."""
        calls = []

        def fake_download(tickers, **kwargs):
            calls.append(tickers)
            if isinstance(tickers, str):
                raise _Throttled()
            return batch_frame({
                "AAA": [1.0, 2.0], "BBB": [1.0, 2.0], "CCC": [1.0, 2.0],
                "DDD": [1.0, 2.0], "EEE": None, "FFF": None,
            })

        with patch("yfinance.download", side_effect=fake_download), \
             patch.object(gw, "BREAKER_THRESHOLD", 1), \
             patch.object(gw, "BASE_BACKOFF_SEC", 0.001):
            app_module._chunked_yf_download(
                ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"], period="1mo"
            )

        single_requests = [c for c in calls if isinstance(c, str)]
        self.assertEqual(
            single_requests, ["EEE"],
            "the first throttled recovery must stop the pass, not continue the list",
        )
        self.assertTrue(gw.is_cooling_down())

    def test_single_ticker_download_is_not_put_through_the_recovery_pass(self):
        calls = []

        def fake_download(tickers, **kwargs):
            calls.append(tickers)
            return single_frame([NAN, NAN])

        with patch("yfinance.download", side_effect=fake_download):
            app_module._chunked_yf_download(["AAA"], period="1mo")

        self.assertEqual(len(calls), 1, "backoff already covers a lone symbol")

    # ── Circuit breaker ────────────────────────────────────────────────────

    def test_an_open_breaker_returns_an_empty_frame_without_calling_yahoo(self):
        calls = []

        with patch.object(gw, "BREAKER_THRESHOLD", 1), \
             patch.object(gw, "BREAKER_BASE_COOLDOWN_SEC", 30.0):
            gw.note_rate_limit()

        with patch("yfinance.download", side_effect=lambda *a, **k: calls.append(1)):
            frame = app_module._chunked_yf_download(["AAA", "BBB"], period="1mo")

        self.assertEqual(calls, [])
        self.assertTrue(frame.empty)

    def test_a_throttled_batch_opens_the_breaker(self):
        def fake_download(tickers, **kwargs):
            raise _Throttled()

        with patch("yfinance.download", side_effect=fake_download), \
             patch.object(gw, "BREAKER_THRESHOLD", 1), \
             patch.object(gw, "BASE_BACKOFF_SEC", 0.001):
            frame = app_module._chunked_yf_download(["AAA", "BBB"], period="1mo")

        self.assertTrue(frame.empty)
        self.assertTrue(gw.is_cooling_down())

    def test_a_delisted_symbol_does_not_open_the_breaker(self):
        def fake_download(tickers, **kwargs):
            raise Exception("$ZZZZ: possibly delisted; no price data found")

        with patch("yfinance.download", side_effect=fake_download):
            for _ in range(gw.BREAKER_THRESHOLD + 2):
                app_module._chunked_yf_download(["ZZZZ", "YYYY"], period="1mo")

        self.assertFalse(
            gw.is_cooling_down(),
            "symbols Yahoo does not list must not be read as a feed outage",
        )

    # ── Request coalescing ─────────────────────────────────────────────────

    def test_identical_concurrent_downloads_share_one_request(self):
        calls = []
        released = threading.Event()

        def fake_download(tickers, **kwargs):
            calls.append(tickers)
            released.wait(2.0)
            return batch_frame({"AAA": [10.0, 11.0], "BBB": [20.0, 21.0]})

        results = []

        def run():
            with patch("yfinance.download", side_effect=fake_download):
                results.append(
                    app_module._chunked_yf_download(["AAA", "BBB"], period="6mo")
                )

        threads = [threading.Thread(target=run) for _ in range(4)]
        for thread in threads:
            thread.start()
        time.sleep(0.2)
        released.set()
        for thread in threads:
            thread.join(4.0)

        self.assertEqual(len(calls), 1, "four callers, one download")
        self.assertEqual(len(results), 4)
        self.assertTrue(all(not frame.empty for frame in results))

    def test_different_windows_are_not_coalesced_together(self):
        calls = []

        def fake_download(tickers, **kwargs):
            calls.append(kwargs.get("period"))
            return batch_frame({"AAA": [10.0, 11.0], "BBB": [20.0, 21.0]})

        with patch("yfinance.download", side_effect=fake_download):
            app_module._chunked_yf_download(["AAA", "BBB"], period="6mo")
            app_module._chunked_yf_download(["AAA", "BBB"], period="1y")

        self.assertEqual(calls, ["6mo", "1y"])

    def test_each_coalesced_caller_can_mutate_its_own_frame(self):
        released = threading.Event()

        def fake_download(tickers, **kwargs):
            released.wait(2.0)
            return batch_frame({"AAA": [10.0, 11.0], "BBB": [20.0, 21.0]})

        results = []

        def run():
            with patch("yfinance.download", side_effect=fake_download):
                results.append(
                    app_module._chunked_yf_download(["AAA", "BBB"], period="3mo")
                )

        threads = [threading.Thread(target=run) for _ in range(3)]
        for thread in threads:
            thread.start()
        time.sleep(0.2)
        released.set()
        for thread in threads:
            thread.join(4.0)

        # The dashboard grade path assigns recovered columns straight into the
        # frame it is handed; that must not reach another request's copy.
        results[0][("Close", "AAA")] = [99.0, 99.0]
        self.assertEqual(float(results[1][("Close", "AAA")].iloc[0]), 10.0)


class TickerLevelTest(unittest.TestCase):
    """Which MultiIndex level holds symbols, when a symbol looks like a field."""

    def test_default_group_by_puts_symbols_on_level_one(self):
        frame = batch_frame({"AAA": [1.0, 2.0]})
        self.assertEqual(app_module._ticker_level(frame.columns), 1)

    def test_a_portfolio_holding_low_and_open_still_resolves_correctly(self):
        # LOW (Lowe's) and OPEN (Opendoor) are real tickers whose names collide
        # with yfinance's field labels. Matching on symbols would pick the
        # field level and report every holding as unpriced.
        frame = batch_frame({"LOW": [10.0, 11.0], "OPEN": [2.0, 3.0]})
        self.assertEqual(app_module._ticker_level(frame.columns), 1)
        self.assertEqual(
            app_module._frame_symbols_with_data(frame, ["LOW", "OPEN"]),
            {"LOW", "OPEN"},
        )

    def test_group_by_ticker_puts_symbols_on_level_zero(self):
        frame = batch_frame({"AAA": [1.0, 2.0], "BBB": [3.0, 4.0]})
        frame.columns = pd.MultiIndex.from_tuples(
            [(t, f) for (f, t) in frame.columns]
        )
        self.assertEqual(app_module._ticker_level(frame.columns), 0)

    def test_all_nan_column_counts_as_no_data_not_as_present(self):
        # A rate-limited symbol still gets a column; only the values reveal it.
        frame = batch_frame({"AAA": [1.0, 2.0], "BBB": None})
        self.assertEqual(
            app_module._frame_symbols_with_data(frame, ["AAA", "BBB"]), {"AAA"}
        )


if __name__ == "__main__":
    unittest.main()
