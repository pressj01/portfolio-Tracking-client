"""Comparer chart tools: intraday windows, dividend history, saved comparisons,
and the chart-data Excel export."""

import io
import sys
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from app import app, _etf_screen_intraday_series


class IntradaySeriesTest(unittest.TestCase):
    def _bars(self, stamps, values):
        index = pd.DatetimeIndex(pd.to_datetime(stamps)).tz_localize("America/New_York")
        return pd.Series(values, index=index, dtype=float)

    def test_prior_session_close_becomes_the_baseline(self):
        bars = self._bars(
            ["2026-11-20 09:30", "2026-11-20 09:35", "2026-11-20 15:55"],
            [101.0, 102.0, 103.0],
        )
        daily = pd.Series(
            [99.0, 100.0, 103.0],
            index=pd.to_datetime(["2026-11-18", "2026-11-19", "2026-11-20"]),
        )

        closes, divs = _etf_screen_intraday_series(bars, daily, pd.Series(dtype=float))

        self.assertEqual(closes.tolist(), [100.0, 101.0, 102.0, 103.0])
        self.assertEqual(closes.index[0].strftime("%Y-%m-%d %H:%M"), "2026-11-19 15:59")
        self.assertEqual(divs.tolist(), [0.0, 0.0, 0.0, 0.0])

    def test_dividend_lands_on_the_first_bar_of_its_ex_date(self):
        bars = self._bars(
            ["2026-11-19 15:45", "2026-11-20 09:30", "2026-11-20 09:45"],
            [50.0, 49.6, 49.7],
        )
        daily = pd.Series([50.2], index=pd.to_datetime(["2026-11-18"]))
        dividends = pd.Series(
            [0.0, 0.4],
            index=pd.to_datetime(["2026-11-19", "2026-11-20"]),
        )

        closes, divs = _etf_screen_intraday_series(bars, daily, dividends)

        # baseline (11-18 close), 11-19 15:45, then the ex-date's first bar.
        self.assertEqual(len(closes), 4)
        self.assertEqual(divs.tolist(), [0.0, 0.0, 0.4, 0.0])

    def test_utc_bars_are_shown_in_exchange_time(self):
        index = pd.DatetimeIndex(pd.to_datetime(["2026-11-20 14:30"])).tz_localize("UTC")
        bars = pd.Series([10.0], index=index)

        closes, _divs = _etf_screen_intraday_series(bars)

        self.assertEqual(closes.index[0].strftime("%H:%M"), "09:30")

    def test_naive_bars_are_read_as_utc(self):
        # The Tiingo facade returns timezone-naive UTC; 14:30 UTC is the open.
        bars = pd.Series(
            [10.0, 10.1],
            index=pd.DatetimeIndex(pd.to_datetime(["2026-11-20 14:30", "2026-11-20 20:55"])),
        )

        closes, _divs = _etf_screen_intraday_series(bars)

        self.assertEqual(
            [ts.strftime("%Y-%m-%d %H:%M") for ts in closes.index],
            ["2026-11-20 09:30", "2026-11-20 15:55"],
        )

    def test_extra_provider_history_is_trimmed_to_the_requested_sessions(self):
        # Tiingo answers period="1d" with ten calendar days of bars.
        bars = self._bars(
            ["2026-11-18 09:30", "2026-11-18 15:55", "2026-11-19 09:30",
             "2026-11-19 15:55", "2026-11-20 09:30", "2026-11-20 15:55"],
            [90.0, 91.0, 95.0, 96.0, 99.0, 101.0],
        )
        daily = pd.Series(
            [91.0, 96.5, 101.0],
            index=pd.to_datetime(["2026-11-18", "2026-11-19", "2026-11-20"]),
        )

        closes, _divs = _etf_screen_intraday_series(bars, daily, sessions=1)

        self.assertEqual(closes.tolist(), [96.5, 99.0, 101.0])
        self.assertEqual(closes.index[0].strftime("%Y-%m-%d %H:%M"), "2026-11-19 15:59")

        five_day, _ = _etf_screen_intraday_series(bars, daily, sessions=5)
        self.assertEqual(len(five_day), 6)  # fewer sessions than asked: all kept

    def test_trimmed_window_falls_back_to_the_prior_intraday_close(self):
        bars = self._bars(
            ["2026-11-19 09:30", "2026-11-19 15:55", "2026-11-20 09:30"],
            [95.0, 96.0, 99.0],
        )

        closes, _divs = _etf_screen_intraday_series(bars, None, sessions=1)

        self.assertEqual(closes.tolist(), [96.0, 99.0])
        self.assertEqual(closes.index[0].strftime("%Y-%m-%d %H:%M"), "2026-11-19 15:59")

    def test_empty_input_returns_empty_series(self):
        closes, divs = _etf_screen_intraday_series(pd.Series(dtype=float))
        self.assertTrue(closes.empty)
        self.assertTrue(divs.empty)


class IntradayEndpointTest(unittest.TestCase):
    def test_one_day_window_returns_time_stamped_bars(self):
        index = pd.DatetimeIndex(
            pd.to_datetime(["2026-11-20 09:30", "2026-11-20 09:35"]),
        ).tz_localize("America/New_York")
        intraday = pd.concat({"Close": pd.DataFrame({"SPY": [600.0, 606.0]}, index=index)}, axis=1)
        daily_index = pd.to_datetime(["2026-11-18", "2026-11-19", "2026-11-20"])
        daily = pd.concat({
            "Close": pd.DataFrame({"SPY": [590.0, 594.0, 606.0]}, index=daily_index),
            "Dividends": pd.DataFrame({"SPY": [0.0, 0.0, 0.0]}, index=daily_index),
        }, axis=1)
        calls = []

        def download(tickers, **kwargs):
            calls.append(kwargs)
            if kwargs.get("interval") == "5m":
                return intraday
            if kwargs.get("period") == "1mo":
                return daily
            return pd.DataFrame()

        with (
            patch("app._chunked_yf_download", side_effect=download),
            patch("app._cached_yf_info", return_value={}),
            patch("app._neos_fund_facts_batch", return_value={}),
        ):
            response = app.test_client().get(
                "/api/etf-screen/data?ticker=SPY&period=1d&mode=all4&defer_details=1"
                "&refresh=intraday-1d-test",
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        payload = response.get_json()
        self.assertTrue(payload["intraday"])
        self.assertEqual(payload["interval"], "5m")
        series = payload["series"]["SPY"]
        self.assertEqual(series["dates"], ["2026-11-19 15:59", "2026-11-20 09:30", "2026-11-20 09:35"])
        self.assertEqual(series["closes"], [594.0, 600.0, 606.0])
        self.assertAlmostEqual(series["traces"]["price"][-1], 606.0 / 594.0 * 100, places=3)
        self.assertIsNone(payload["profiles"]["SPY"]["sharpe"])
        self.assertTrue(any(call.get("interval") == "5m" and call.get("period") == "1d" for call in calls))


class DividendHistoryEndpointTest(unittest.TestCase):
    def test_returns_positive_split_adjusted_payments_per_ticker(self):
        history = pd.Series(
            [0.0, 0.5, 0.55],
            index=pd.to_datetime(["2025-03-01", "2025-06-01", "2025-09-01"]),
        )
        with patch("app._cached_yf_dividends", return_value=history):
            response = app.test_client().get("/api/etf-screen/dividends?tickers=schd,SCHD,vti")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["requested_symbols"], ["SCHD", "VTI"])
        self.assertEqual(payload["series"]["SCHD"]["dates"], ["2025-06-01", "2025-09-01"])
        self.assertEqual(payload["series"]["SCHD"]["amounts"], [0.5, 0.55])

    def test_requires_tickers(self):
        response = app.test_client().get("/api/etf-screen/dividends")
        self.assertEqual(response.status_code, 400)


class SavedComparisonsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_file = Path(self.tmp.name) / "saved_comparisons.sqlite"

        def connect():
            conn = sqlite3.connect(self.db_file)
            conn.row_factory = sqlite3.Row
            return conn

        self.patcher = patch.object(app_module, "get_connection", side_effect=connect)
        self.patcher.start()
        self.client = app.test_client()

    def tearDown(self):
        self.patcher.stop()
        self.tmp.cleanup()

    def test_create_list_rename_and_delete(self):
        created = self.client.post("/api/saved-comparisons", json={
            "scope": "etf",
            "symbols": ["spy", "QQQ", "SPY", "VOO"],
            "metric": "total_pct",
            "settings": {"period": "1y"},
        })
        self.assertEqual(created.status_code, 201, created.get_json())
        item = created.get_json()["item"]
        self.assertEqual(item["symbols"], ["SPY", "QQQ", "VOO"])
        self.assertEqual(item["name"], "SPY, QQQ, VOO")
        self.assertEqual(item["settings"], {"period": "1y"})

        self.client.post("/api/saved-comparisons", json={
            "scope": "stock", "symbols": ["AAPL"], "metric": "price",
        })
        listed = self.client.get("/api/saved-comparisons?scope=etf").get_json()["items"]
        self.assertEqual([entry["id"] for entry in listed], [item["id"]])

        renamed = self.client.put(f"/api/saved-comparisons/{item['id']}", json={"name": "Core index funds"})
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.get_json()["item"]["name"], "Core index funds")
        self.assertEqual(renamed.get_json()["item"]["symbols"], ["SPY", "QQQ", "VOO"])

        blank = self.client.put(f"/api/saved-comparisons/{item['id']}", json={"name": "  "})
        self.assertEqual(blank.status_code, 400)

        deleted = self.client.delete(f"/api/saved-comparisons/{item['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/saved-comparisons?scope=etf").get_json()["items"], [])
        self.assertEqual(self.client.delete(f"/api/saved-comparisons/{item['id']}").status_code, 404)

    def test_rejects_unknown_scope_and_empty_symbols(self):
        self.assertEqual(self.client.get("/api/saved-comparisons?scope=nope").status_code, 400)
        response = self.client.post("/api/saved-comparisons", json={"scope": "etf", "symbols": []})
        self.assertEqual(response.status_code, 400)


class ChartExcelExportTest(unittest.TestCase):
    def test_writes_dates_and_numbers_as_typed_cells(self):
        response = app.test_client().post("/api/export/chart-xlsx", json={
            "filename": "spy vs qqq",
            "sheet": "Total Return (%)",
            "columns": ["Date", "SPY (%)", "QQQ (%)"],
            "rows": [["2026-01-02", 0, 0], ["2026-01-05", 1.25, None], ["2026-01-05 09:30", -0.5, 2]],
        })

        self.assertEqual(response.status_code, 200)
        self.assertIn("spy vs qqq.xlsx", response.headers["Content-Disposition"])
        workbook = load_workbook(io.BytesIO(response.data))
        sheet = workbook.active
        self.assertEqual(sheet.title, "Total Return (%)")
        self.assertEqual([cell.value for cell in sheet[1]], ["Date", "SPY (%)", "QQQ (%)"])
        self.assertEqual(sheet["A2"].value.strftime("%Y-%m-%d"), "2026-01-02")
        self.assertEqual(sheet["B3"].value, 1.25)
        self.assertIsNone(sheet["C3"].value)
        self.assertEqual(sheet["A4"].value.strftime("%Y-%m-%d %H:%M"), "2026-01-05 09:30")

    def test_requires_columns(self):
        response = app.test_client().post("/api/export/chart-xlsx", json={"rows": []})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
