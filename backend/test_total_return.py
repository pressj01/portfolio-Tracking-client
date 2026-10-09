import sys
import unittest
import datetime
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import (
    app,
    _anchor_from_prior_close,
    _annotate_transaction_rows,
    _build_transaction_aware_portfolio_series,
    _distribution_payment_policy,
    _normalize_prices_to_100,
    _portfolio_period_metrics,
    _resolve_total_return_period,
    _stock_split_history_for_period,
    _total_return_market_download,
    _TOTAL_RETURN_MARKET_SNAPSHOT_CACHE,
    _transactions_for_current_positions,
    _market_coverage_shortfall,
    _money_market_symbols,
    _trim_to_last_bars,
)
from market_symbols import accounting_symbol_for_ticker, yahoo_symbol_for_ticker


class AccountingSymbolTest(unittest.TestCase):
    def test_corporate_action_symbols_share_current_market_identity(self):
        expected = {
            "AITXD": "AITX",
            "NYCB": "FLG",
            "WPAY": "TOPW",
        }

        for historical, current in expected.items():
            with self.subTest(historical=historical):
                self.assertEqual(accounting_symbol_for_ticker(historical), current)
                self.assertEqual(yahoo_symbol_for_ticker(historical), current)


class TotalReturnNormalizationTest(unittest.TestCase):
    def test_normalizes_after_removing_duplicate_dates(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-02", "2026-01-09"])
        close = pd.DataFrame({"AAA": [None, 10.0, 12.0]}, index=dates)

        result = _normalize_prices_to_100(close)

        self.assertFalse(result.index.has_duplicates)
        self.assertEqual(result["AAA"].tolist(), [100.0, 120.0])

    def test_normalizes_after_removing_duplicate_ticker_columns(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-09"])
        close = pd.DataFrame(
            [[20.0, 99.0], [25.0, 101.0]],
            index=dates,
            columns=["AAA", "AAA"],
        )

        result = _normalize_prices_to_100(close)

        self.assertFalse(result.columns.has_duplicates)
        self.assertEqual(result.columns.tolist(), ["AAA"])
        self.assertEqual(result["AAA"].tolist(), [100.0, 125.0])


class TotalReturnMarketSnapshotTest(unittest.TestCase):
    def setUp(self):
        _TOTAL_RETURN_MARKET_SNAPSHOT_CACHE.clear()
        self.addCleanup(_TOTAL_RETURN_MARKET_SNAPSHOT_CACHE.clear)

    def test_overlapping_account_requests_reuse_the_same_ticker_quote(self):
        dates = pd.to_datetime(["2026-10-07", "2026-10-08"])
        calls = []

        def download(tickers, **_kwargs):
            symbols = list(tickers)
            calls.append(symbols)
            request_number = len(calls)
            data = {}
            for offset, symbol in enumerate(symbols):
                last = request_number * 10.0 + offset
                data[("Close", symbol)] = [last - 1.0, last]
            frame = pd.DataFrame(data, index=dates)
            frame.columns = pd.MultiIndex.from_tuples(frame.columns)
            return frame

        kwargs = {"period": "1y", "auto_adjust": False, "actions": True}
        with patch("app._chunked_yf_download", side_effect=download):
            first = _total_return_market_download(["PDPR", "RDGL"], **kwargs)
            second = _total_return_market_download(["RDGL", "SPY"], **kwargs)

        self.assertEqual(calls, [["PDPR", "RDGL"], ["SPY"]])
        self.assertEqual(float(first[("Close", "RDGL")].iloc[-1]), 11.0)
        self.assertEqual(float(second[("Close", "RDGL")].iloc[-1]), 11.0)
        self.assertEqual(first.attrs["market_snapshot_at"], second.attrs["market_snapshot_at"])

    def test_a_throttled_batch_is_not_kept_as_the_snapshot(self):
        # Yahoo answers a throttled request with a column of NaN for each symbol
        # it refused. Keeping that as the page's answer left most positions
        # unpriced for ten minutes after the feed came back.
        dates = pd.to_datetime(["2026-10-07", "2026-10-08"])
        symbols = ["AAA", "BBB", "CCC", "DDD"]
        calls = []

        def download(tickers, **_kwargs):
            calls.append(list(tickers))
            throttled = len(calls) == 1
            data = {
                ("Close", symbol): (
                    [float("nan"), float("nan")]
                    if throttled and symbol != "AAA" else [10.0, 11.0]
                )
                for symbol in tickers
            }
            frame = pd.DataFrame(data, index=dates)
            frame.columns = pd.MultiIndex.from_tuples(frame.columns)
            return frame

        kwargs = {"period": "1y", "auto_adjust": False, "actions": True}
        with patch("app._chunked_yf_download", side_effect=download):
            first = _total_return_market_download(symbols, **kwargs)
            second = _total_return_market_download(symbols, **kwargs)
            third = _total_return_market_download(symbols, **kwargs)

        self.assertTrue(first[("Close", "BBB")].isna().all())
        self.assertEqual(float(second[("Close", "BBB")].iloc[-1]), 11.0)
        # Asked again after the outage, then served from the snapshot.
        self.assertEqual(calls, [symbols, symbols])
        self.assertEqual(float(third[("Close", "DDD")].iloc[-1]), 11.0)


class TotalReturnPeriodTest(unittest.TestCase):
    def setUp(self):
        self.today = datetime.date(2026, 7, 23)

    def test_resolves_broker_style_rolling_ranges_date_to_date(self):
        expected_starts = {
            "7d": "2026-07-16",
            "1mo": "2026-06-23",
            "3mo": "2026-04-23",
            "6mo": "2026-01-23",
            "ytd": "2026-01-01",
            "1y": "2025-07-23",
            "2y": "2024-07-23",
            "5y": "2021-07-23",
        }

        for period, expected_start in expected_starts.items():
            with self.subTest(period=period):
                result = _resolve_total_return_period(period, today=self.today)
                # The reported window is the range the user asked for and does
                # not move. Only the download reaches further back.
                self.assertEqual(result["start_date"], expected_start)
                self.assertEqual(result["end_date"], "2026-07-23")
                # Every calendar offset can land on a weekend or a holiday, so
                # every one of them over-requests and anchors on the close
                # already held going into the window. YTD used to be the only
                # period guarded this way; the rest opened on the session after
                # their start and silently dropped that first move.
                self.assertLess(result["yf_kwargs"]["start"], expected_start)
                self.assertEqual(
                    result["yf_kwargs"]["anchor_on_or_before"],
                    expected_start,
                )
                self.assertEqual(result["yf_kwargs"]["end"], "2026-07-24")

    def test_resolves_all_from_portfolio_inception(self):
        result = _resolve_total_return_period(
            "max",
            today=self.today,
            inception_date="2022-04-15",
        )

        self.assertEqual(result["key"], "all")
        self.assertEqual(result["label"], "From First Trade")
        self.assertEqual(result["start_date"], "2022-04-15")
        self.assertEqual(result["end_date"], "2026-07-23")
        self.assertEqual(result["yf_kwargs"]["start"], "2022-04-15")
        self.assertEqual(result["yf_kwargs"]["end"], "2026-07-24")

    def test_short_period_retains_split_history_from_portfolio_inception(self):
        history_dates = pd.to_datetime(["2024-01-23", "2026-08-07"])
        raw = pd.concat(
            {
                "Close": pd.DataFrame(
                    {"SPLITTEST": [50.0, 60.0]}, index=history_dates,
                ),
                "Stock Splits": pd.DataFrame(
                    {"SPLITTEST": [0.01, 0.0]}, index=history_dates,
                ),
            },
            axis=1,
        )
        current = pd.DataFrame(
            {"SPLITTEST": [0.0]}, index=pd.to_datetime(["2026-08-07"]),
        )
        period_range = {
            "start_date": "2026-08-07",
            "end_date": "2026-08-10",
        }

        with patch("app._chunked_yf_download", return_value=raw):
            result = _stock_split_history_for_period(
                ["SPLITTEST"], current, period_range, "2022-04-18",
            )

        self.assertEqual(
            float(result.loc[pd.Timestamp("2024-01-23"), "SPLITTEST"]),
            0.01,
        )

    def test_resolves_inclusive_custom_range(self):
        result = _resolve_total_return_period(
            "custom",
            today=self.today,
            start_date="2024-02-01",
            end_date="2024-03-31",
        )

        self.assertEqual(result["start_date"], "2024-02-01")
        self.assertEqual(result["end_date"], "2024-03-31")
        self.assertEqual(result["yf_kwargs"]["end"], "2024-04-01")

    def test_clamps_leap_day_for_rolling_year(self):
        result = _resolve_total_return_period(
            "1y",
            today=datetime.date(2024, 2, 29),
        )

        self.assertEqual(result["start_date"], "2023-02-28")

    def test_one_day_measures_back_to_the_previous_session(self):
        # A calendar offset would put the baseline on a closed market: Sunday
        # from a Monday, Saturday from a Sunday. Each case must land on a
        # weekday with an actual close.
        expected = {
            datetime.date(2026, 8, 10): ("2026-08-07", "2026-08-10"),  # Mon -> Fri
            datetime.date(2026, 8, 11): ("2026-08-10", "2026-08-11"),  # Tue -> Mon
            datetime.date(2026, 8, 8): ("2026-08-06", "2026-08-07"),   # Sat -> Thu/Fri
            datetime.date(2026, 8, 9): ("2026-08-06", "2026-08-07"),   # Sun -> Thu/Fri
        }

        for today, (expected_start, expected_end) in expected.items():
            with self.subTest(today=today, weekday=today.strftime("%a")):
                result = _resolve_total_return_period("1d", today=today)
                self.assertEqual(result["start_date"], expected_start)
                self.assertEqual(result["end_date"], expected_end)
                self.assertLess(
                    datetime.date.fromisoformat(result["start_date"]).weekday(),
                    5,
                )

    def test_one_day_over_requests_then_trims_to_two_sessions(self):
        result = _resolve_total_return_period("1d", today=datetime.date(2026, 8, 10))

        # The download must reach back past any holiday run, while the reported
        # window stays on the real single session.
        self.assertEqual(result["yf_kwargs"]["trim_to_last_bars"], 2)
        self.assertLess(result["yf_kwargs"]["start"], result["start_date"])
        self.assertEqual(result["yf_kwargs"]["end"], "2026-08-11")

    def test_custom_anchors_on_the_close_before_a_non_trading_start(self):
        # Sunday-to-Monday is the case that reported 0%: there is no Sunday bar,
        # so the baseline has to be the Friday close, not Monday's own.
        result = _resolve_total_return_period(
            "custom",
            today=self.today,
            start_date="2026-07-19",
            end_date="2026-07-20",
        )

        self.assertEqual(result["start_date"], "2026-07-19")
        self.assertEqual(result["yf_kwargs"]["anchor_on_or_before"], "2026-07-19")
        self.assertLess(result["yf_kwargs"]["start"], "2026-07-19")

    def test_ytd_anchors_on_the_prior_year_close(self):
        result = _resolve_total_return_period(
            "ytd",
            today=datetime.date(2026, 8, 10),
        )

        self.assertEqual(result["start_date"], "2026-01-01")
        self.assertEqual(result["end_date"], "2026-08-10")
        self.assertEqual(result["yf_kwargs"]["anchor_on_or_before"], "2026-01-01")
        self.assertLess(result["yf_kwargs"]["start"], "2026-01-01")
        self.assertEqual(result["yf_kwargs"]["end"], "2026-08-11")

    def test_anchor_falls_back_to_the_prior_session(self):
        dates = pd.to_datetime([
            "2026-08-06", "2026-08-07", "2026-08-10", "2026-08-11",
        ])
        frame = pd.DataFrame({"AAA": [1.0, 2.0, 3.0, 4.0]}, index=dates)

        # Sunday 8/9 has no bar, so Friday 8/7 becomes the baseline.
        anchored = _anchor_from_prior_close(frame, "2026-08-09")
        self.assertEqual(anchored["AAA"].tolist(), [2.0, 3.0, 4.0])

        # A start that is already a trading day keeps exactly that bar.
        exact = _anchor_from_prior_close(frame, "2026-08-07")
        self.assertEqual(exact["AAA"].tolist(), [2.0, 3.0, 4.0])

        # Nothing that early exists, so the ticker's own history stands.
        early = _anchor_from_prior_close(frame, "2020-01-01")
        self.assertEqual(len(early), 4)

    def test_trim_keeps_the_final_sessions_of_a_padded_download(self):
        dates = pd.to_datetime([
            "2026-07-31", "2026-08-03", "2026-08-04",
            "2026-08-05", "2026-08-06", "2026-08-07",
        ])
        frame = pd.DataFrame({"AAA": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]}, index=dates)

        trimmed = _trim_to_last_bars(frame, 2)

        self.assertEqual(trimmed["AAA"].tolist(), [5.0, 6.0])
        self.assertEqual(
            list(trimmed.index.strftime("%Y-%m-%d")),
            ["2026-08-06", "2026-08-07"],
        )

    def test_trim_is_a_no_op_without_a_bar_count(self):
        dates = pd.to_datetime(["2026-08-06", "2026-08-07"])
        frame = pd.DataFrame({"AAA": [5.0, 6.0]}, index=dates)

        self.assertEqual(len(_trim_to_last_bars(frame, None)), 2)
        self.assertTrue(_trim_to_last_bars(pd.DataFrame(), 2).empty)

    def test_rejects_partial_year_typed_into_a_date_input(self):
        # A date input emits a value per keystroke, so typing "2026" sends
        # 0002, 0020 and 0202 first. Each parses and is correctly ordered
        # against the end date, so only a floor stops the download.
        for partial in ("0002-08-10", "0020-08-10", "0202-08-10"):
            with self.subTest(start_date=partial):
                with self.assertRaises(ValueError) as caught:
                    _resolve_total_return_period(
                        "custom",
                        today=self.today,
                        start_date=partial,
                        end_date="2026-07-23",
                    )
                self.assertIn("1970-01-01", str(caught.exception))

    def test_still_accepts_a_genuinely_old_custom_start(self):
        result = _resolve_total_return_period(
            "custom",
            today=self.today,
            start_date="1993-01-29",
            end_date="2026-07-23",
        )

        self.assertEqual(result["start_date"], "1993-01-29")


class TotalReturnComparisonTest(unittest.TestCase):
    def setUp(self):
        _TOTAL_RETURN_MARKET_SNAPSHOT_CACHE.clear()
        self._original_db_initialized = getattr(app, "_db_initialized", False)
        app._db_initialized = True

    def tearDown(self):
        app._db_initialized = self._original_db_initialized

    def test_max_range_keeps_newer_ticker_aligned_to_shared_dates(self):
        dates = pd.to_datetime(["2020-01-02", "2021-01-04", "2022-01-03"])
        close = pd.DataFrame(
            {"AAA": [10.0, 12.0, 14.0], "NEW": [None, 20.0, 22.0]},
            index=dates,
        )
        adjusted_close = close.copy()
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        market_data = pd.concat({
            "Close": close,
            "Adj Close": adjusted_close,
            "Dividends": zeros,
            "Capital Gains": zeros,
        }, axis=1)

        with patch("app._chunked_yf_download", return_value=market_data):
            response = app.test_client().get(
                "/api/total-return/compare?extra=AAA,NEW&period=max"
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        data = response.get_json()
        self.assertEqual(data["dates"], ["2020-01-02", "2021-01-04", "2022-01-03"])
        self.assertEqual(data["price"]["AAA"], [100.0, 120.0, 140.0])
        self.assertEqual(data["price"]["NEW"], [None, 100.0, 110.0])
        self.assertEqual(data["pricediv"]["NEW"], [None, 100.0, 110.0])
        self.assertEqual(data["total"]["NEW"], [None, 100.0, 110.0])

    def test_endpoint_can_return_entire_portfolio_without_individual_tickers(self):
        dates = pd.to_datetime(["2025-12-31", "2026-01-02", "2026-01-05"])
        close = pd.DataFrame({"AAA": [90.0, 100.0, 110.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        market_data = pd.concat({
            "Close": close,
            "Adj Close": close,
            "Dividends": zeros,
            "Capital Gains": zeros,
        }, axis=1)

        class FakeRows(list):
            def fetchall(self):
                return self

        class FakeConnection:
            def execute(self, sql, _params=None):
                if "FROM transactions" in sql:
                    return FakeRows([{
                        "ticker": "AAA",
                        "profile_id": 1,
                        "transaction_type": "BUY",
                        "transaction_date": "2026-01-02",
                        "shares": 1,
                        "price_per_share": 100,
                        "fees": 0,
                        "notes": "",
                    }])
                if "FROM all_account_info" in sql:
                    return FakeRows([{
                        "ticker": "AAA",
                        "profile_id": 1,
                        "quantity": 1,
                        "purchase_date": "2026-01-02",
                    }])
                return FakeRows()

            def close(self):
                return None

        with (
            patch("app.get_profile_filter", return_value=(False, [1])),
            patch("app.get_connection", return_value=FakeConnection()),
            patch("app.ensure_tables_exist"),
            patch("app._chunked_yf_download", return_value=market_data),
        ):
            response = app.test_client().get(
                "/api/total-return/compare?portfolio=1&period=1y"
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        data = response.get_json()
        self.assertEqual(data["tickers"], ["PORTFOLIO"])
        self.assertEqual(data["labels"]["PORTFOLIO"], "Entire Portfolio")
        self.assertEqual(data["price"]["PORTFOLIO"], [100.0, 110.0])
        self.assertEqual(data["dates"], ["2026-01-02", "2026-01-05"])
        self.assertEqual(data["actual_start_date"], "2026-01-02")
        self.assertEqual(data["portfolio_coverage"]["transaction_count"], 1)

    def test_selected_holding_uses_owned_period_transaction_aware_series(self):
        dates = pd.to_datetime(["2025-12-31", "2026-01-02", "2026-01-05"])
        close = pd.DataFrame({"AAA": [90.0, 100.0, 110.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        market_data = pd.concat({
            "Close": close,
            "Adj Close": close,
            "Dividends": zeros,
            "Capital Gains": zeros,
        }, axis=1)

        class FakeRows(list):
            def fetchall(self):
                return self

        class FakeConnection:
            def execute(self, sql, _params=None):
                if "FROM transactions" in sql:
                    return FakeRows([{
                        "ticker": "AAA",
                        "profile_id": 1,
                        "transaction_type": "BUY",
                        "transaction_date": "2026-01-02",
                        "shares": 1,
                        "price_per_share": 100,
                        "fees": 0,
                        "notes": "",
                    }])
                if "FROM all_account_info" in sql:
                    return FakeRows([{
                        "ticker": "AAA",
                        "profile_id": 1,
                        "quantity": 1,
                        "purchase_date": "2026-01-02",
                        "import_date": None,
                    }])
                return FakeRows()

            def close(self):
                return None

        with (
            patch("app.get_profile_filter", return_value=(False, [1])),
            patch("app.get_connection", return_value=FakeConnection()),
            patch("app.ensure_tables_exist"),
            patch("app._chunked_yf_download", return_value=market_data),
        ):
            response = app.test_client().get(
                "/api/total-return/compare?tickers=AAA&period=custom"
                "&start_date=2025-12-31&end_date=2026-01-05"
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        data = response.get_json()
        self.assertEqual(data["dates"], ["2026-01-02", "2026-01-05"])
        self.assertEqual(data["price"]["AAA"], [100.0, 110.0])
        self.assertEqual(data["total"]["AAA"], [100.0, 110.0])


class TotalReturnDashboardPeriodTest(unittest.TestCase):
    def setUp(self):
        _TOTAL_RETURN_MARKET_SNAPSHOT_CACHE.clear()
        self._original_db_initialized = getattr(app, "_db_initialized", False)
        app._db_initialized = True

    def tearDown(self):
        app._db_initialized = self._original_db_initialized

    def test_dashboard_cards_and_rows_share_transaction_aware_period(self):
        dates = pd.to_datetime(["2025-12-31", "2026-01-02", "2026-01-05"])
        close = pd.DataFrame({
            "AAA": [90.0, 100.0, 110.0],
            "SPY": [400.0, 402.0, 404.0],
        }, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        market_data = pd.concat({
            "Close": close,
            "Adj Close": close,
            "Dividends": zeros,
            "Capital Gains": zeros,
        }, axis=1)

        class FakeRows(list):
            def fetchall(self):
                return self

            def fetchone(self):
                return self[0] if self else None

        class FakeConnection:
            def execute(self, sql, _params=None):
                if "FROM all_account_info" in sql:
                    return FakeRows([{
                        "ticker": "AAA",
                        "profile_id": 1,
                        "description": "Example",
                        "classification_type": "Stock",
                        "purchase_value": 100,
                        "quantity": 1,
                        "purchase_date": "2026-01-02",
                        "import_date": "2026-01-02",
                    }])
                if "FROM transactions" in sql:
                    return FakeRows([{
                        "ticker": "AAA",
                        "profile_id": 1,
                        "transaction_type": "BUY",
                        "transaction_date": "2026-01-02",
                        "shares": 1,
                        "price_per_share": 100,
                        "fees": 0,
                        "notes": "",
                    }])
                return FakeRows()

            def close(self):
                return None

        with (
            patch("app.get_profile_filter", return_value=(False, [1])),
            patch("app.get_connection", return_value=FakeConnection()),
            patch("app.ensure_tables_exist"),
            patch("app._chunked_yf_download", return_value=market_data),
        ):
            response = app.test_client().get(
                "/api/total-return/charts?period=1y"
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        data = response.get_json()
        self.assertEqual(data["portfolio_metrics"]["actual_start_date"], "2026-01-02")
        self.assertEqual(data["portfolio_metrics"]["actual_end_date"], "2026-01-05")
        self.assertEqual(data["portfolio_metrics"]["start_value"], 100.0)
        self.assertEqual(data["portfolio_metrics"]["end_value"], 110.0)
        self.assertEqual(data["portfolio_metrics"]["total_return_pct"], 10.0)
        self.assertEqual(data["period_key"], "1y")
        self.assertEqual(
            data["portfolio_series"],
            {
                "dates": ["2026-01-02", "2026-01-05"],
                "price": [100.0, 110.0],
                "pricediv": [100.0, 110.0],
                "total": [100.0, 110.0],
            },
        )
        self.assertEqual(data["performance_rows"][0]["ticker"], "AAA")
        self.assertEqual(data["performance_rows"][0]["total_return_pct"], 10.0)
        self.assertEqual(data["bar"]["data"][0]["text"], ["+10.00%"])
        self.assertIn("%{x:+.2f}%", data["bar"]["data"][0]["hovertemplate"])

    def test_open_holdings_total_excludes_fully_closed_transaction_history(self):
        dates = pd.to_datetime(["2025-12-31", "2026-01-02", "2026-01-05"])
        close = pd.DataFrame({
            "AAA": [90.0, 100.0, 110.0],
            "OLD": [100.0, 150.0, 200.0],
            "SPY": [400.0, 402.0, 404.0],
        }, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        market_data = pd.concat({
            "Close": close,
            "Adj Close": close,
            "Dividends": zeros,
            "Capital Gains": zeros,
            "Stock Splits": zeros,
        }, axis=1)

        class FakeRows(list):
            def fetchall(self):
                return self

            def fetchone(self):
                return self[0] if self else None

        class FakeConnection:
            def execute(self, sql, _params=None):
                if "FROM all_account_info" in sql:
                    return FakeRows([{
                        "ticker": "AAA",
                        "profile_id": 1,
                        "description": "Open position",
                        "classification_type": "Stock",
                        "purchase_value": 100,
                        "quantity": 1,
                        "purchase_date": "2026-01-02",
                        "import_date": "2026-01-02",
                    }])
                if "FROM transactions" in sql:
                    return FakeRows([
                        {
                            "ticker": "OLD",
                            "profile_id": 1,
                            "transaction_type": "BUY",
                            "transaction_date": "2025-12-31",
                            "shares": 1,
                            "price_per_share": 100,
                            "fees": 0,
                            "notes": "",
                        },
                        {
                            "ticker": "OLD",
                            "profile_id": 1,
                            "transaction_type": "SELL",
                            "transaction_date": "2026-01-02",
                            "shares": 1,
                            "price_per_share": 150,
                            "fees": 0,
                            "notes": "",
                        },
                        {
                            "ticker": "AAA",
                            "profile_id": 1,
                            "transaction_type": "BUY",
                            "transaction_date": "2026-01-02",
                            "shares": 1,
                            "price_per_share": 100,
                            "fees": 0,
                            "notes": "",
                        },
                    ])
                return FakeRows()

            def close(self):
                return None

        with (
            patch("app.get_profile_filter", return_value=(False, [1])),
            patch("app.get_connection", return_value=FakeConnection()),
            patch("app.ensure_tables_exist"),
            patch("app._chunked_yf_download", return_value=market_data),
        ):
            response = app.test_client().get(
                "/api/total-return/charts?period=custom"
                "&start_date=2025-12-31&end_date=2026-01-05"
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        data = response.get_json()
        rows = data["performance_rows"]
        portfolio = data["portfolio_metrics"]
        open_positions = data["open_position_metrics"]
        self.assertEqual([row["ticker"] for row in rows], ["AAA"])
        self.assertEqual(portfolio["transaction_count"], 3)
        self.assertEqual(open_positions["transaction_count"], 1)
        self.assertEqual(open_positions["price_return_dollar"], 10.0)
        self.assertEqual(
            open_positions["price_return_dollar"],
            sum(row["price_return_dollar"] for row in rows),
        )
        self.assertEqual(open_positions["price_return_pct"], 10.0)


class PortfolioReturnSeriesTest(unittest.TestCase):
    def test_payment_policy_separates_performance_date_from_cash_date(self):
        position = (1, "AAA")
        policy = _distribution_payment_policy(
            [{
                "ticker": "AAA",
                "profile_id": 1,
                "payment_date": "2026-04-10",
                "ex_date": "2026-03-15",
                "amount": 5.0,
                "source": "generic_transactions",
                "coverage_start_date": "2026-03-01",
                "coverage_end_date": "2026-03-31",
                "coverage_metadata_available": 1,
            }],
            {"start_date": "2026-03-01", "end_date": "2026-03-31"},
        )

        self.assertEqual(policy["coverage_by_position"][position], [("2026-03-01", "2026-03-31")])
        self.assertEqual(policy["fully_covered_positions"], {position})
        self.assertEqual(policy["totals_by_position"], {position: 5.0})
        self.assertEqual(policy["cash_totals_by_position"], {})
        self.assertEqual(policy["events"][0]["effective_date"], "2026-03-15")

    def test_current_position_scope_matches_account_and_ticker(self):
        transactions = [
            {"profile_id": 1, "ticker": "AAA", "transaction_type": "BUY"},
            {"profile_id": 2, "ticker": "AAA", "transaction_type": "BUY"},
            {"profile_id": 1, "ticker": "OLD", "transaction_type": "BUY"},
        ]
        holdings = [
            {"profile_id": 1, "ticker": "AAA", "quantity": 5},
        ]

        result = _transactions_for_current_positions(transactions, holdings)

        self.assertEqual(result, [transactions[0]])

    def test_reverse_split_normalizes_historical_transaction_shares(self):
        dates = pd.to_datetime(["2022-01-03", "2022-01-04", "2024-01-23"])
        close = pd.DataFrame({"SIRC": [100.0, 50.0, 50.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        splits = pd.DataFrame({"SIRC": [0.0, 0.0, 0.01]}, index=dates)
        transactions = [
            {
                "ticker": "SIRC",
                "market_symbol": "SIRC",
                "position_key": (1, "SIRC"),
                "transaction_type": "BUY",
                "transaction_date": "2022-01-03",
                "shares": 100,
            },
            {
                "ticker": "SIRC",
                "market_symbol": "SIRC",
                "position_key": (1, "SIRC"),
                "transaction_type": "SELL",
                "transaction_date": "2022-01-04",
                "shares": 100,
            },
        ]

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            transactions,
            [],
            stock_splits=splits,
        )

        self.assertEqual(result["market_value"][:2], [100.0, 0.0])
        self.assertEqual(result["price_gain_dollar"], -50.0)
        self.assertEqual(result["split_adjusted_transactions"], 2)
        self.assertEqual(result["split_adjusted_positions"], 1)

    def test_current_snapshot_closes_phantom_transaction_only_position(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame({"CLOSED": [10.0, 11.0, 12.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [
            {
                "ticker": "CLOSED",
                "market_symbol": "CLOSED",
                "position_key": (1, "CLOSED"),
                "transaction_type": "BUY",
                "transaction_date": "2026-01-02",
                "shares": 10,
            },
            {
                "ticker": "CLOSED",
                "market_symbol": "CLOSED",
                "position_key": (1, "CLOSED"),
                "transaction_type": "SELL",
                "transaction_date": "2026-01-05",
                "shares": 5,
            },
        ]

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            transactions,
            [],
        )

        self.assertEqual(result["market_value"], [100.0, 0.0, 0.0])
        self.assertEqual(result["price_gain_dollar"], 10.0)
        self.assertEqual(result["inferred_closing_positions"], 1)

    def test_closing_reconciliation_names_the_position_and_its_cause(self):
        # "13 residual historical positions were closed" is unanswerable
        # without the rows: which ones, and does anything need fixing.
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame({"CLOSED": [10.0, 11.0, 12.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [
            {
                "ticker": "CLOSED",
                "market_symbol": "CLOSED",
                "position_key": (1, "CLOSED"),
                "transaction_type": "BUY",
                "transaction_date": "2026-01-02",
                "shares": 10,
            },
            {
                "ticker": "CLOSED",
                "market_symbol": "CLOSED",
                "position_key": (1, "CLOSED"),
                "transaction_type": "SELL",
                "transaction_date": "2026-01-05",
                "shares": 5,
            },
        ]

        result = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros, transactions, [],
        )

        detail = result["inferred_closing_detail"]
        self.assertEqual(len(detail), 1)
        self.assertEqual(detail[0]["ticker"], "CLOSED")
        self.assertAlmostEqual(detail[0]["shares"], 5.0)
        self.assertAlmostEqual(detail[0]["ledger_net_shares"], 5.0)
        self.assertAlmostEqual(detail[0]["snapshot_quantity"], 0.0)
        self.assertEqual(detail[0]["close_date"], "2026-01-05")
        # The full ledger holds 5 shares the broker snapshot does not, so the
        # export really is missing a sale. That is the row worth surfacing.
        self.assertTrue(detail[0]["ledger_gap"])
        self.assertEqual(detail[0]["ledger_gap_direction"], "surplus")
        self.assertAlmostEqual(detail[0]["ledger_difference_shares"], 5.0)
        self.assertTrue(detail[0]["ledger_surplus"])

    def test_closing_reconciliation_flags_a_ledger_deficit_too(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame({"GAP": [10.0, 11.0, 12.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [
            {
                "ticker": "GAP",
                "market_symbol": "GAP",
                "position_key": (1, "GAP"),
                "transaction_type": "SELL",
                "transaction_date": "2026-01-02",
                "shares": 10,
            },
            {
                "ticker": "GAP",
                "market_symbol": "GAP",
                "position_key": (1, "GAP"),
                "transaction_type": "BUY",
                "transaction_date": "2026-01-05",
                "shares": 10,
            },
        ]
        holdings = [{
            "ticker": "GAP",
            "market_symbol": "GAP",
            "position_key": (1, "GAP"),
            "quantity": 5,
            "purchase_date": "2026-01-05",
        }]

        result = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros, transactions, holdings,
        )

        detail = result["inferred_closing_detail"]
        self.assertEqual(len(detail), 1)
        self.assertTrue(detail[0]["ledger_gap"])
        self.assertEqual(detail[0]["ledger_gap_direction"], "deficit")
        self.assertAlmostEqual(detail[0]["ledger_difference_shares"], -5.0)
        self.assertFalse(detail[0]["ledger_surplus"])

    def test_missing_market_history_is_excluded_and_reported(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-05"])
        close = pd.DataFrame(
            {"AAA": [10.0, 11.0], "DELISTED": [None, None]},
            index=dates,
        )
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [
            {
                "ticker": "AAA",
                "market_symbol": "AAA",
                "position_key": (1, "AAA"),
                "transaction_type": "BUY",
                "transaction_date": "2026-01-02",
                "shares": 1,
            },
            {
                "ticker": "DELISTED",
                "market_symbol": "DELISTED",
                "position_key": (1, "DELISTED"),
                "transaction_type": "BUY",
                "transaction_date": "2026-01-02",
                "shares": 5,
            },
        ]

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            transactions,
            [{"position_key": (1, "AAA"), "ticker": "AAA", "quantity": 1}],
        )

        self.assertEqual(result["price"], [100.0, 110.0])
        self.assertEqual(result["transaction_count"], 1)
        self.assertEqual(result["missing_market_symbols"], ["DELISTED"])

    def test_buys_and_sells_change_weights_without_creating_return_jumps(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame(
            {
                "AAA": [100.0, 110.0, 121.0],
                "BBB": [50.0, 50.0, 55.0],
            },
            index=dates,
        )
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [
            {
                "ticker": "AAA",
                "market_symbol": "AAA",
                "position_key": (1, "AAA"),
                "transaction_type": "BUY",
                "transaction_date": "2026-01-02",
                "shares": 2,
            },
            {
                "ticker": "BBB",
                "market_symbol": "BBB",
                "position_key": (1, "BBB"),
                "transaction_type": "BUY",
                "transaction_date": "2026-01-05",
                "shares": 2,
            },
            {
                "ticker": "AAA",
                "market_symbol": "AAA",
                "position_key": (1, "AAA"),
                "transaction_type": "SELL",
                "transaction_date": "2026-01-05",
                "shares": 1,
            },
        ]

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            transactions,
            [
                {"position_key": (1, "AAA"), "ticker": "AAA", "quantity": 1},
                {"position_key": (1, "BBB"), "ticker": "BBB", "quantity": 2},
            ],
        )

        self.assertEqual(result["price"], [100.0, 110.0, 121.0])
        self.assertEqual(result["total"], [100.0, 110.0, 121.0])
        self.assertEqual(result["market_value"], [200.0, 210.0, 231.0])
        self.assertEqual(result["price_gain_dollar"], 41.0)
        self.assertEqual(result["total_gain_dollar"], 41.0)
        self.assertEqual(result["transaction_count"], 3)

    def test_price_dividends_and_total_return_are_distinct(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-05"])
        close = pd.DataFrame({"AAA": [100.0, 90.0]}, index=dates)
        adjusted = pd.DataFrame({"AAA": [100.0, 100.0]}, index=dates)
        dividends = pd.DataFrame({"AAA": [0.0, 10.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [{
            "ticker": "AAA",
            "market_symbol": "AAA",
            "position_key": (1, "AAA"),
            "transaction_type": "BUY",
            "transaction_date": "2026-01-02",
            "shares": 1,
        }]

        result = _build_transaction_aware_portfolio_series(
            close,
            adjusted,
            dividends,
            zeros,
            transactions,
            [{"position_key": (1, "AAA"), "ticker": "AAA", "quantity": 1}],
        )

        self.assertEqual(result["price"], [100.0, 90.0])
        self.assertEqual(result["pricediv"], [100.0, 100.0])
        self.assertEqual(result["total"], [100.0, 100.0])
        self.assertEqual(result["price_gain_dollar"], -10.0)
        self.assertEqual(result["distribution_dollar"], 10.0)
        self.assertEqual(result["total_gain_dollar"], 0.0)

        metrics = _portfolio_period_metrics(result)
        self.assertEqual(metrics["start_value"], 100.0)
        self.assertEqual(metrics["end_value"], 90.0)
        self.assertEqual(metrics["price_return_pct"], -10.0)
        self.assertEqual(metrics["pricediv_return_pct"], 0.0)
        self.assertEqual(metrics["total_return_pct"], 0.0)

    def test_broker_payment_after_final_market_session_lands_on_final_row(self):
        dates = pd.to_datetime(["2026-07-02", "2026-07-03"])
        close = pd.DataFrame({"AAA": [100.0, 100.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        position = (1, "AAA")

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            [{
                "ticker": "AAA", "market_symbol": "AAA", "position_key": position,
                "transaction_type": "BUY", "transaction_date": "2026-07-02", "shares": 1,
            }],
            [{"ticker": "AAA", "market_symbol": "AAA", "position_key": position, "quantity": 1}],
            actual_distribution_events=[{
                "position_key": position,
                "ticker": "AAA",
                "payment_date": "2026-07-04",
                "effective_date": "2026-07-04",
                "amount": 5.0,
            }],
            actual_distribution_covered_positions={position},
            actual_distribution_coverage={position: [("2026-07-04", "2026-07-04")]},
        )

        self.assertEqual(result["distribution_dollar"], 5.0)
        self.assertEqual(result["distribution_dollar_series"], [0.0, 5.0])
        self.assertEqual(result["total"][-1], 105.0)
        self.assertEqual(_portfolio_period_metrics(result)["total_return_pct"], 5.0)

    def test_partial_broker_coverage_uses_yahoo_outside_imported_span(self):
        dates = pd.to_datetime(["2026-01-02", "2026-03-02", "2026-06-01"])
        close = pd.DataFrame({"AAA": [100.0, 100.0, 100.0]}, index=dates)
        adjusted = pd.DataFrame({"AAA": [100.0, 105.0, 112.0]}, index=dates)
        dividends = pd.DataFrame({"AAA": [0.0, 5.0, 7.0]}, index=dates)
        position = (1, "AAA")

        result = _build_transaction_aware_portfolio_series(
            close,
            adjusted,
            dividends,
            pd.DataFrame(0.0, index=dates, columns=close.columns),
            [{
                "ticker": "AAA", "market_symbol": "AAA", "position_key": position,
                "transaction_type": "BUY", "transaction_date": "2026-01-02", "shares": 1,
            }],
            [{"ticker": "AAA", "market_symbol": "AAA", "position_key": position, "quantity": 1}],
            actual_distribution_events=[{
                "position_key": position,
                "ticker": "AAA",
                "payment_date": "2026-03-10",
                "ex_date": "2026-03-02",
                "effective_date": "2026-03-02",
                "amount": 4.0,
            }],
            actual_distribution_covered_positions={position},
            actual_distribution_coverage={position: [("2026-03-01", "2026-03-31")]},
        )

        self.assertEqual(result["distribution_dollar"], 11.0)
        self.assertEqual(result["distribution_dollar_series"], [0.0, 4.0, 11.0])
        self.assertAlmostEqual(result["total"][-1], 110.9333, places=4)

    def test_ex_date_times_performance_before_a_later_purchase(self):
        dates = pd.to_datetime([
            "2026-01-02", "2026-01-03", "2026-01-06", "2026-01-07",
        ])
        close = pd.DataFrame({"AAA": [100.0] * 4}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        position = (1, "AAA")

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            [
                {
                    "ticker": "AAA", "market_symbol": "AAA", "position_key": position,
                    "transaction_type": "BUY", "transaction_date": "2026-01-02", "shares": 1,
                },
                {
                    "ticker": "AAA", "market_symbol": "AAA", "position_key": position,
                    "transaction_type": "BUY", "transaction_date": "2026-01-06", "shares": 1,
                },
            ],
            [{"ticker": "AAA", "market_symbol": "AAA", "position_key": position, "quantity": 2}],
            actual_distribution_events=[{
                "position_key": position,
                "ticker": "AAA",
                "payment_date": "2026-01-07",
                "ex_date": "2026-01-03",
                "effective_date": "2026-01-03",
                "amount": 10.0,
            }],
            actual_distribution_covered_positions={position},
            actual_distribution_coverage={position: [("2026-01-03", "2026-01-03")]},
        )

        self.assertEqual(result["distribution_dollar"], 10.0)
        self.assertEqual(result["distribution_dollar_series"], [0.0, 10.0, 10.0, 10.0])
        self.assertEqual(_portfolio_period_metrics(result)["total_return_pct"], 10.0)

    def test_undated_fallback_holding_begins_on_import_date_not_first_quote(self):
        dates = pd.to_datetime(["2011-05-18", "2026-07-09", "2026-07-10"])
        close = pd.DataFrame({"AAA": [1.0, 100.0, 110.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        holdings = [{
            "ticker": "AAA",
            "market_symbol": "AAA",
            "position_key": (1, "AAA"),
            "quantity": 2,
            "purchase_date": None,
            "import_date": "2026-07-09",
        }]

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            [],
            holdings,
        )

        self.assertEqual(result["price"], [None, 100.0, 110.0])
        self.assertEqual(result["total"], [None, 100.0, 110.0])
        self.assertEqual(result["market_value"], [None, 200.0, 220.0])
        self.assertEqual(result["start_price"], 100.0)
        self.assertEqual(result["end_price"], 110.0)
        self.assertEqual(result["fallback_positions"], 1)
        self.assertEqual(result["fallback_date_sources"]["import_date"], 1)

        metrics = _portfolio_period_metrics(result)
        self.assertEqual(metrics["start_price"], 100.0)
        self.assertEqual(metrics["end_price"], 110.0)

    def test_missing_opening_lot_is_inferred_from_current_quantity(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame({"AAA": [100.0, 110.0, 121.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [{
            "ticker": "AAA",
            "market_symbol": "AAA",
            "position_key": (1, "AAA"),
            "transaction_type": "BUY",
            "transaction_date": "2026-01-05",
            "shares": 1,
        }]
        holdings = [{
            "ticker": "AAA",
            "market_symbol": "AAA",
            "position_key": (1, "AAA"),
            "quantity": 11,
            "purchase_date": None,
            "import_date": "2026-01-06",
        }]

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            transactions,
            holdings,
        )

        self.assertEqual(result["price"], [None, 100.0, 110.0])
        self.assertEqual(result["market_value"], [None, 1210.0, 1331.0])
        self.assertEqual(result["inferred_opening_positions"], 1)

    def test_inferred_lot_reports_the_ledger_gap_it_invented(self):
        """A duplicated sale is indistinguishable from a partial export.

        Both leave the ledger short of the saved quantity, and the replay closes
        the gap by inventing an opening lot. Since the numbers cannot say which
        happened, report the arithmetic so the screen can flag the position
        rather than pricing the invented shares as fact.
        """
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame({"AAA": [100.0, 110.0, 121.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)

        def txn(kind, date, shares):
            return {
                "ticker": "AAA",
                "market_symbol": "AAA",
                "position_key": (1, "AAA"),
                "transaction_type": kind,
                "transaction_date": date,
                "shares": shares,
            }

        holdings = [{
            "ticker": "AAA",
            "market_symbol": "AAA",
            "position_key": (1, "AAA"),
            "quantity": 10,
            "purchase_date": "2026-01-02",
            "import_date": "2026-01-06",
        }]

        clean = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros,
            [txn("BUY", "2026-01-02", 30), txn("SELL", "2026-01-05", 20)],
            holdings,
        )
        self.assertEqual(clean["inferred_opening_detail"], [])
        self.assertEqual(clean["market_value"][0], 3000.0)

        duplicated = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros,
            [
                txn("BUY", "2026-01-02", 30),
                txn("SELL", "2026-01-05", 20),
                txn("SELL", "2026-01-05", 20),
            ],
            holdings,
        )
        # The duplicate leaves the ledger 20 shares short, so the replay holds
        # 50 on day one instead of the 30 that were actually bought.
        self.assertEqual(duplicated["market_value"][0], 5000.0)
        self.assertEqual(duplicated["inferred_opening_detail"], [{
            "ticker": "AAA",
            "profile_id": 1,
            "shares": 20.0,
            "seed_date": "2026-01-01",
            "ledger_net_shares": -10.0,
            "snapshot_quantity": 10.0,
            # 20 invented shares priced at the first plotted observation (100.0).
            "start_value_overstatement": 2000.0,
            "opening_price": 100.0,
        }])

    def test_open_lot_clip_is_not_flagged_when_the_full_ledger_reconciles(self):
        """A sold-and-rebought ticker must not look like a missing opening lot.

        Purchase-date clipping drops the closed cycle, so the replay invents
        those shares to land on the saved quantity. The full ledger already
        nets to that quantity. Recording an opening lot would double-count,
        so Start Value is not flagged — the same test the holdings button uses.
        """
        dates = pd.to_datetime(["2025-06-27", "2025-06-30", "2025-09-30"])
        close = pd.DataFrame({"SCHG": [30.0, 31.0, 32.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [
            {
                "ticker": "SCHG",
                "market_symbol": "SCHG",
                "position_key": (6, "SCHG"),
                "transaction_type": "BUY",
                "transaction_date": "2025-02-13",
                "shares": 30,
            },
            {
                "ticker": "SCHG",
                "market_symbol": "SCHG",
                "position_key": (6, "SCHG"),
                "transaction_type": "BUY",
                "transaction_date": "2025-04-02",
                "shares": 15,
            },
            {
                "ticker": "SCHG",
                "market_symbol": "SCHG",
                "position_key": (6, "SCHG"),
                "transaction_type": "SELL",
                "transaction_date": "2025-04-04",
                "shares": 20,
            },
            {
                "ticker": "SCHG",
                "market_symbol": "SCHG",
                "position_key": (6, "SCHG"),
                "transaction_type": "SELL",
                "transaction_date": "2025-06-30",
                "shares": 25.0335,
            },
            {
                "ticker": "SCHG",
                "market_symbol": "SCHG",
                "position_key": (6, "SCHG"),
                "transaction_type": "BUY",
                "transaction_date": "2025-06-30",
                "shares": 0.024,
            },
            {
                "ticker": "SCHG",
                "market_symbol": "SCHG",
                "position_key": (6, "SCHG"),
                "transaction_type": "BUY",
                "transaction_date": "2025-09-30",
                "shares": 50,
            },
        ]
        holdings = [{
            "ticker": "SCHG",
            "market_symbol": "SCHG",
            "position_key": (6, "SCHG"),
            # 30+15-20-25.0335+0.024+50 — the full ledger already balances.
            "quantity": 49.9905,
            "purchase_date": "2025-06-30",
        }]

        result = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros, transactions, holdings,
        )
        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertEqual(result["inferred_opening_positions"], 0)
        # Replay still seeds the clipped gap so the open lot ends on 49.9905.
        self.assertAlmostEqual(result["market_value"][-1], 49.9905 * 32.0, places=4)

    def test_true_missing_opening_lot_is_still_flagged_after_open_lot_clip(self):
        """A clipped open lot must still flag a shortfall recording would fix."""
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame({"AAA": [100.0, 110.0, 121.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [{
            "ticker": "AAA",
            "market_symbol": "AAA",
            "position_key": (1, "AAA"),
            "transaction_type": "BUY",
            "transaction_date": "2026-01-05",
            "shares": 1,
        }]
        holdings = [{
            "ticker": "AAA",
            "market_symbol": "AAA",
            "position_key": (1, "AAA"),
            "quantity": 11,
            "purchase_date": "2026-01-05",
        }]

        result = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros, transactions, holdings,
        )
        self.assertEqual(result["inferred_opening_positions"], 1)
        self.assertEqual(result["inferred_opening_detail"][0]["shares"], 10.0)
        self.assertEqual(result["inferred_opening_detail"][0]["ledger_net_shares"], 1.0)
        self.assertEqual(result["inferred_opening_detail"][0]["snapshot_quantity"], 11.0)

    def test_short_window_applies_inferred_lot_before_historical_sales(self):
        """A short period must not add an inferred lot after replaying history."""
        dates = pd.to_datetime(["2026-01-02", "2026-01-05"])
        close = pd.DataFrame({"AAA": [10.0, 11.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [
            {
                "ticker": "AAA",
                "market_symbol": "AAA",
                "position_key": (1, "AAA"),
                "transaction_type": "SELL",
                "transaction_date": "2025-01-02",
                "shares": 90,
            },
            {
                "ticker": "AAA",
                "market_symbol": "AAA",
                "position_key": (1, "AAA"),
                "transaction_type": "BUY",
                "transaction_date": "2025-12-31",
                "shares": 2,
            },
        ]
        holdings = [{
            "ticker": "AAA",
            "market_symbol": "AAA",
            "position_key": (1, "AAA"),
            "quantity": 12,
        }]

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            transactions,
            holdings,
        )

        self.assertEqual(result["market_value"], [120.0, 132.0])
        metrics = _portfolio_period_metrics(result)
        self.assertEqual(metrics["start_value"], 120.0)
        self.assertEqual(metrics["end_value"], 132.0)

    def test_same_day_sell_then_rebuy_does_not_leave_phantom_shares(self):
        """Dates carry no time, so a same-day round trip can replay sell-first."""
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame({"AAA": [10.0, 11.0, 12.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [
            {
                "ticker": "AAA",
                "market_symbol": "AAA",
                "position_key": (1, "AAA"),
                "transaction_type": "SELL",
                "transaction_date": "2026-01-05",
                "shares": 300,
            },
            {
                "ticker": "AAA",
                "market_symbol": "AAA",
                "position_key": (1, "AAA"),
                "transaction_type": "BUY",
                "transaction_date": "2026-01-05",
                "shares": 300,
            },
        ]

        result = _build_transaction_aware_portfolio_series(
            close,
            close,
            zeros,
            zeros,
            transactions,
            [],
        )

        self.assertEqual(result["market_value"], [None, None, None])

    def test_sold_and_rebought_ticker_uses_current_open_lot(self):
        """A closed cycle must not keep compounding on the current lot."""
        dates = pd.to_datetime([
            "2024-03-05", "2025-03-07", "2026-07-06", "2026-08-18",
        ])
        close = pd.DataFrame({"VGT": [64.38, 70.57, 116.82, 119.79]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        position = {"ticker": "VGT", "market_symbol": "VGT", "position_key": (99, "VGT")}
        transactions = [
            {**position, "transaction_type": "BUY", "transaction_date": "2024-03-05",
             "shares": 152, "price_per_share": 64.38},
            {**position, "transaction_type": "SELL", "transaction_date": "2025-03-07",
             "shares": 152, "price_per_share": 70.57},
            {**position, "transaction_type": "BUY", "transaction_date": "2026-07-06",
             "shares": 85.605, "price_per_share": 116.82},
        ]
        holdings = [{**position, "quantity": 85.605, "purchase_date": "2026-07-06"}]

        result = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros, transactions, holdings,
        )
        metrics = _portfolio_period_metrics(result)

        self.assertEqual(metrics["actual_start_date"], "2026-07-06")
        self.assertEqual(metrics["actual_end_date"], "2026-08-18")
        self.assertAlmostEqual(metrics["total_return_pct"], (119.79 / 116.82 - 1) * 100, places=2)
        self.assertLess(metrics["total_return_pct"], 10)
        self.assertGreater(metrics["end_value"], 10_000)

    def test_closed_buy_lots_report_no_unrealized_gain(self):
        rows = [
            {"id": 1, "transaction_type": "BUY", "shares": 152,
             "price_per_share": 64.38, "fees": 0, "notes": None},
            {"id": 2, "transaction_type": "SELL", "shares": 152,
             "price_per_share": 70.57, "fees": 0, "notes": None},
            {"id": 3, "transaction_type": "BUY", "shares": 85.605,
             "price_per_share": 116.82, "fees": 0, "notes": None},
        ]

        annotated = _annotate_transaction_rows(rows, {})

        self.assertEqual(annotated[0]["shares_remaining"], 0.0)
        self.assertIsNone(annotated[1]["shares_remaining"])
        self.assertAlmostEqual(annotated[2]["shares_remaining"], 85.605, places=3)


class OneDayCoverageTest(unittest.TestCase):
    """The 1D window is the only period trimmed down to two rows.

    Every guard written against a long window has to be re-checked at that
    size: a rule like "at least two real bars" silently becomes "every session
    must have printed" once the window is only two sessions long.
    """

    @staticmethod
    def _raw_download(closes, dividends=None, days=10):
        index = pd.bdate_range("2026-08-17", periods=days)
        fields = ["Close"] + (["Dividends"] if dividends else [])
        columns = pd.MultiIndex.from_product([fields, list(closes)])
        data = {("Close", ticker): values for ticker, values in closes.items()}
        for ticker, values in (dividends or {}).items():
            data[("Dividends", ticker)] = values
        return pd.DataFrame(data, index=index)[columns]

    @staticmethod
    def _holdings(values, purchase_date="2026-01-05"):
        return [
            {
                "ticker": ticker,
                "market_symbol": ticker,
                "position_key": (1, ticker),
                "quantity": 1000,
                "current_value": value,
                "purchase_date": purchase_date,
            }
            for ticker, value in values.items()
        ]

    def test_a_missed_print_no_longer_deletes_the_position(self):
        # THIN stopped printing before the kept window and BIG missed only the
        # final session. Both used to fail the two-observation test and drop
        # out of Start Value, End Value and the return together.
        raw = self._raw_download({
            "GOOD": [100.0] * 9 + [96.0],
            "THIN": [50.0] * 8 + [float("nan"), float("nan")],
            "BIG": [500.0] * 9 + [float("nan")],
        })

        close = _trim_to_last_bars(raw, 2)["Close"]
        result = _build_transaction_aware_portfolio_series(
            close, None, None, None, [],
            self._holdings({"GOOD": 96000, "THIN": 50000, "BIG": 500000}),
        )

        self.assertEqual(result["missing_market_symbols"], [])
        # A ticker that did not trade is carried at its real last close, so the
        # whole book is priced instead of only the ticker that printed twice.
        self.assertAlmostEqual(result["market_value"][0], 650000.0)
        self.assertAlmostEqual(result["market_value"][-1], 646000.0)
        self.assertAlmostEqual(result["price_gain_dollar"], -4000.0)

    def test_carry_forward_never_repeats_a_distribution(self):
        # Prices are levels and carry forward; dividends are events and must
        # not. Repeating one would pay the same distribution twice.
        raw = self._raw_download(
            {"GOOD": [100.0] * 9 + [float("nan")]},
            dividends={"GOOD": [0.0] * 7 + [1.25, 0.0, 0.0]},
        )

        trimmed = _trim_to_last_bars(raw, 2)

        self.assertEqual(list(trimmed["Close"]["GOOD"]), [100.0, 100.0])
        self.assertEqual(list(trimmed["Dividends"]["GOOD"]), [0.0, 0.0])

    def test_group_by_ticker_columns_are_carried_too(self):
        # yfinance emits (ticker, field) under group_by="ticker", so the level
        # holding the field names has to be found rather than assumed.
        index = pd.bdate_range("2026-08-17", periods=10)
        columns = pd.MultiIndex.from_tuples([("GOOD", "Close"), ("GOOD", "Dividends")])
        raw = pd.DataFrame(
            {
                ("GOOD", "Close"): [100.0] * 9 + [float("nan")],
                ("GOOD", "Dividends"): [0.0] * 7 + [1.25, 0.0, 0.0],
            },
            index=index,
        )[columns]

        trimmed = _trim_to_last_bars(raw, 2)

        self.assertEqual(list(trimmed[("GOOD", "Close")]), [100.0, 100.0])
        self.assertEqual(list(trimmed[("GOOD", "Dividends")]), [0.0, 0.0])

    def test_a_ticker_with_no_history_at_all_is_still_excluded(self):
        # A throttled chunk comes back all-NaN rather than absent. There is no
        # price to carry, so the position cannot be replayed and must not be
        # invented.
        raw = self._raw_download({
            "GOOD": [100.0] * 9 + [96.0],
            "DEAD": [float("nan")] * 10,
        })

        close = _trim_to_last_bars(raw, 2)["Close"]
        result = _build_transaction_aware_portfolio_series(
            close, None, None, None, [],
            self._holdings({"GOOD": 96000, "DEAD": 500000}),
        )

        self.assertEqual(result["missing_market_symbols"], ["DEAD"])

    def test_a_position_first_priced_on_the_closing_session_has_no_baseline(self):
        # Its first ever print is the closing session, so there is no prior
        # close to measure from and nothing earlier to carry.
        raw = self._raw_download({
            "GOOD": [100.0] * 9 + [96.0],
            "NEW": [float("nan")] * 9 + [25.0],
        })

        close = _trim_to_last_bars(raw, 2)["Close"]
        result = _build_transaction_aware_portfolio_series(
            close, None, None, None, [],
            self._holdings({"GOOD": 96000, "NEW": 25000}),
        )

        self.assertEqual(result["missing_market_symbols"], ["NEW"])

    def test_long_windows_keep_the_two_observation_rule(self):
        # The count proxy is still the right test once the window is long
        # enough that it cannot mean "every session must have printed".
        index = pd.bdate_range("2026-07-20", periods=30)
        close = pd.DataFrame(
            {
                "SPARSE": [10.0] + [float("nan")] * 28 + [12.0],
                "LONE": [10.0] + [float("nan")] * 29,
            },
            index=index,
        )

        result = _build_transaction_aware_portfolio_series(
            close, None, None, None, [],
            self._holdings({"SPARSE": 12000, "LONE": 10000}),
        )

        self.assertEqual(result["missing_market_symbols"], ["LONE"])


class CoverageShortfallTest(unittest.TestCase):
    """A list of dropped tickers cannot tell a reader whether the number is
    still their portfolio's. Only the weight separates the two."""

    @staticmethod
    def _holdings(values):
        return [
            {
                "ticker": ticker,
                "market_symbol": ticker,
                "quantity": 1,
                "current_value": value,
            }
            for ticker, value in values.items()
        ]

    def test_weighs_the_excluded_value_against_the_book(self):
        shortfall = _market_coverage_shortfall(
            ["BIG"], self._holdings({"GOOD": 96000, "BIG": 500000}),
        )

        self.assertEqual(shortfall["excluded_positions"], 1)
        self.assertAlmostEqual(shortfall["excluded_value"], 500000.0)
        self.assertAlmostEqual(shortfall["covered_value"], 96000.0)
        self.assertAlmostEqual(shortfall["excluded_weight"], 500000 / 596000, places=6)
        self.assertTrue(shortfall["is_material"])

    def test_a_trivial_gap_is_not_material(self):
        shortfall = _market_coverage_shortfall(
            ["TINY"], self._holdings({"GOOD": 1000000, "TINY": 500}),
        )

        self.assertFalse(shortfall["is_material"])

    def test_nothing_missing_is_never_material(self):
        shortfall = _market_coverage_shortfall([], self._holdings({"GOOD": 1000}))

        self.assertFalse(shortfall["is_material"])
        self.assertEqual(shortfall["excluded_value"], 0.0)

    def test_a_closed_position_carries_no_weight(self):
        # Missing from the price frame but no longer held, so it cannot move
        # the current book and must not raise an alarm.
        shortfall = _market_coverage_shortfall(
            ["SOLD"], self._holdings({"GOOD": 100000}),
        )

        self.assertFalse(shortfall["is_material"])
        self.assertEqual(shortfall["excluded_value"], 0.0)

    def test_a_cash_fund_is_reported_but_never_raises_the_alarm(self):
        # The replay supplied a fixed $1 NAV, so this balance is measured rather
        # than silently dropped or mislabeled as unknown market history.
        shortfall = _market_coverage_shortfall(
            ["FSPXX", "FZEXX"],
            self._holdings({"GOOD": 1648746, "FSPXX": 164660, "FZEXX": 28386}),
            ["FSPXX", "FZEXX"],
        )

        self.assertFalse(shortfall["is_material"])
        self.assertEqual(shortfall["excluded_value"], 0.0)
        self.assertEqual(shortfall["excluded_positions"], 0)
        self.assertEqual(shortfall["cash_equivalent_positions"], 2)
        self.assertAlmostEqual(shortfall["cash_equivalent_value"], 193046.0)
        self.assertEqual(
            shortfall["cash_equivalent_symbols"], ["FSPXX", "FZEXX"],
        )
        self.assertAlmostEqual(shortfall["covered_value"], 1841792.0)

    def test_a_cash_fund_named_off_pattern_is_caught_by_its_row(self):
        # The *XX ticker shape is a heuristic; the holding row carries the
        # broker's own classification and must win when they disagree.
        holdings = [{
            "ticker": "CASHFUND",
            "market_symbol": "CASHFUND",
            "quantity": 1,
            "current_value": 500000,
            "classification_type": "MONEYMARKET",
        }, {
            "ticker": "GOOD",
            "market_symbol": "GOOD",
            "quantity": 1,
            "current_value": 100000,
        }]

        cash_symbols = _money_market_symbols(["CASHFUND"], holdings)
        shortfall = _market_coverage_shortfall(
            ["CASHFUND"], holdings, cash_symbols,
        )

        self.assertEqual(cash_symbols, {"CASHFUND"})
        self.assertFalse(shortfall["is_material"])
        self.assertEqual(shortfall["cash_equivalent_symbols"], ["CASHFUND"])

    def test_an_unpriced_holding_still_raises_the_alarm_beside_cash(self):
        # Cash standing down must not take a real gap down with it.
        shortfall = _market_coverage_shortfall(
            ["SPAXX", "BROKEN"],
            self._holdings({"GOOD": 400000, "SPAXX": 150000, "BROKEN": 200000}),
            ["SPAXX"],
        )

        self.assertTrue(shortfall["is_material"])
        self.assertEqual(shortfall["held_unpriced_symbols"], ["BROKEN"])
        self.assertEqual(shortfall["cash_equivalent_symbols"], ["SPAXX"])
        self.assertAlmostEqual(shortfall["excluded_value"], 200000.0)
        # Weighed against the whole book, cash included: the reader is asking
        # how much of their account is unmeasured, not how much of a subset.
        self.assertAlmostEqual(
            shortfall["excluded_weight"], 200000 / 750000, places=6,
        )

    def test_missing_symbols_are_sorted_by_why_they_are_missing(self):
        # One flat list cannot tell a delisting apart from a cash fund apart
        # from a live hole, and the note has to say something different for
        # each of the three.
        shortfall = _market_coverage_shortfall(
            ["SPAXX", "DELISTED", "BROKEN"],
            self._holdings({"GOOD": 900000, "SPAXX": 50000, "BROKEN": 50000}),
            ["SPAXX"],
        )

        self.assertEqual(shortfall["cash_equivalent_symbols"], ["SPAXX"])
        self.assertEqual(shortfall["held_unpriced_symbols"], ["BROKEN"])
        self.assertEqual(shortfall["closed_unpriced_symbols"], ["DELISTED"])

    def test_a_synthetic_cash_nav_keeps_cash_in_the_return_weight(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-05"])
        close = pd.DataFrame({
            "GOOD": [100.0, 110.0],
            # Yahoo's common money-market shape: only the latest $1 quote.
            "SPAXX": [float("nan"), 1.0],
        }, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [{
            "ticker": "GOOD",
            "market_symbol": "GOOD",
            "position_key": (1, "GOOD"),
            "transaction_type": "BUY",
            "transaction_date": "2026-01-02",
            "shares": 9,
        }, {
            "ticker": "SPAXX",
            "market_symbol": "SPAXX",
            "position_key": (1, "SPAXX"),
            "transaction_type": "BUY",
            "transaction_date": "2026-01-02",
            "shares": 100,
        }]
        holdings = [{
            "ticker": "GOOD",
            "market_symbol": "GOOD",
            "position_key": (1, "GOOD"),
            "quantity": 9,
            "current_value": 990,
        }, {
            "ticker": "SPAXX",
            "market_symbol": "SPAXX",
            "position_key": (1, "SPAXX"),
            "quantity": 100,
            "current_value": 100,
            "classification_type": "MONEYMARKET",
        }]

        result = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros, transactions, holdings,
        )

        self.assertEqual(result["missing_market_symbols"], [])
        self.assertEqual(result["market_value"], [1000.0, 1090.0])
        self.assertAlmostEqual(result["price"][-1], 109.0)
        self.assertEqual(
            result["coverage_shortfall"]["cash_equivalent_symbols"],
            ["SPAXX"],
        )
        self.assertAlmostEqual(
            result["coverage_shortfall"]["covered_value"], 1090.0,
        )

    def test_an_unpriced_book_stays_silent_rather_than_guessing(self):
        # Nothing to weigh against, so no alarm can be substantiated. The
        # symbols are still listed either way.
        shortfall = _market_coverage_shortfall(["ANY"], self._holdings({"GOOD": 0}))

        self.assertFalse(shortfall["is_material"])
        self.assertEqual(shortfall["excluded_weight"], 0.0)


class WeekendStartAnchorTest(unittest.TestCase):
    """A calendar offset lands on a closed market often enough to matter.

    The same day-of-month is a weekend roughly two times in seven, and 7D is
    one every weekend. Without an anchor the window opens on the session after
    the start rather than the close already held going into it, so the first
    session's move leaves the return without leaving a trace.
    """

    def test_every_preset_anchors_a_weekend_start_backward(self):
        # 2026-08-29 is a Saturday, so 7D asks for Saturday 2026-08-22 and the
        # monthly and yearly offsets land on weekends of their own.
        saturday = datetime.date(2026, 8, 29)

        for period in ("7d", "1m", "3m", "6m", "ytd", "1y", "2y", "5y"):
            with self.subTest(period=period):
                result = _resolve_total_return_period(period, today=saturday)
                kwargs = result["yf_kwargs"]
                self.assertEqual(
                    kwargs["anchor_on_or_before"], result["start_date"],
                    "the anchor is the requested start, not the download start",
                )
                self.assertLess(
                    kwargs["start"], result["start_date"],
                    "the download has to reach past the closure to find a baseline",
                )

    def test_the_anchor_reaches_past_a_long_holiday_closure(self):
        # Independence Day 2026 falls on a Saturday and is observed Friday the
        # 3rd, so a start on the 4th has to look back through a three-day gap.
        result = _resolve_total_return_period(
            "custom", start_date="2026-07-04", end_date="2026-07-31",
        )
        reach = (
            datetime.date.fromisoformat(result["start_date"])
            - datetime.date.fromisoformat(result["yf_kwargs"]["start"])
        ).days
        self.assertGreaterEqual(reach, 4)

    def test_a_weekend_start_measures_from_the_prior_close(self):
        # The bug in one frame: a stock closes Friday at 100 and holds 104 all
        # of the following week. Opening on Monday reports 0% for a week it
        # plainly rose 4%.
        sessions = pd.to_datetime([
            "2026-08-21", "2026-08-24", "2026-08-25",
            "2026-08-26", "2026-08-27", "2026-08-28",
        ])
        frame = pd.DataFrame({"AAA": [100.0, 104.0, 104.0, 104.0, 104.0, 104.0]},
                             index=sessions)

        anchored = _anchor_from_prior_close(frame, "2026-08-22")

        self.assertEqual(anchored.index[0].date(), datetime.date(2026, 8, 21))
        self.assertEqual(float(anchored["AAA"].iloc[0]), 100.0)

    def test_a_trading_day_start_keeps_its_own_bar(self):
        # Ordinary ranges must not move: the anchor only rescues starts that
        # would otherwise have opened on a later session.
        sessions = pd.to_datetime(["2026-08-21", "2026-08-24", "2026-08-25"])
        frame = pd.DataFrame({"AAA": [100.0, 104.0, 105.0]}, index=sessions)

        anchored = _anchor_from_prior_close(frame, "2026-08-24")

        self.assertEqual(anchored.index[0].date(), datetime.date(2026, 8, 24))

    def test_cash_paid_on_the_anchor_bar_is_not_counted(self):
        # Anchoring backward pulls an extra bar in. That bar is the baseline,
        # so a distribution on it belongs to the period before this one.
        sessions = pd.to_datetime(["2026-02-27", "2026-03-02", "2026-03-03"])
        close = pd.DataFrame({"AAA": [100.0, 100.0, 100.0]}, index=sessions)
        dividends = pd.DataFrame({"AAA": [5.0, 3.0, 0.0]}, index=sessions)
        zeros = pd.DataFrame(0.0, index=sessions, columns=["AAA"])
        holdings = [{
            "ticker": "AAA", "market_symbol": "AAA", "position_key": (1, "AAA"),
            "quantity": 100, "current_value": 10000, "purchase_date": "2025-01-01",
        }]

        result = _build_transaction_aware_portfolio_series(
            close, close, dividends, zeros, [], holdings,
        )

        # Only the $3 paid after the baseline, never the $5 paid on it.
        self.assertAlmostEqual(result["distribution_dollar"], 300.0)


class ClosedUnpricedWindowTest(unittest.TestCase):
    """A closed name is unpriced for this range only when its shares overlapped it.

    Total Return and Growth both print this list. Counting every historical
    delisting makes a year-to-date page name tickers that were already flat
    years earlier, and the two pages then disagree about the hole.
    """

    @staticmethod
    def _close():
        index = pd.bdate_range("2026-01-02", periods=10)
        return pd.DataFrame({"GOOD": [100.0] * 10}, index=index)

    @staticmethod
    def _held():
        return [{
            "ticker": "GOOD",
            "market_symbol": "GOOD",
            "position_key": (6, "GOOD"),
            "quantity": 10,
            "current_value": 1000,
            "purchase_date": "2025-06-01",
        }]

    @staticmethod
    def _txn(ticker, date, kind, shares, profile=6):
        return {
            "ticker": ticker,
            "market_symbol": ticker,
            "profile_id": profile,
            "position_key": (profile, ticker),
            "transaction_type": kind,
            "transaction_date": date,
            "shares": shares,
        }

    def _series(self, transactions, holdings=None, close=None):
        return _build_transaction_aware_portfolio_series(
            close if close is not None else self._close(),
            None,
            None,
            None,
            transactions,
            self._held() if holdings is None else holdings,
        )

    def test_names_closed_before_the_window_are_not_listed(self):
        result = self._series([
            self._txn("HMBL", "2022-12-01", "SELL", 900),
            self._txn("LEG", "2022-04-18", "BUY", 1.313),
            self._txn("LEG", "2022-06-08", "SELL", 50),
            self._txn("LEG", "2022-07-15", "BUY", 0.745),
            self._txn("LEG", "2022-09-30", "SELL", 0.273),
            self._txn("LEG", "2022-09-30", "SELL", 63),
            self._txn("AOTS", "2026-01-02", "BUY", 110),
            self._txn("AOTS", "2026-03-06", "SELL", 110),
            self._txn("ASGIRT", "2026-01-08", "SELL", 111),
            self._txn("TUGN", "2026-01-06", "BUY", 220),
        ])

        self.assertEqual(
            result["missing_market_symbols"],
            ["AOTS", "ASGIRT", "TUGN"],
        )
        self.assertEqual(
            result["coverage_shortfall"]["closed_unpriced_symbols"],
            ["AOTS", "ASGIRT", "TUGN"],
        )

    def test_a_sale_after_the_window_still_covers_the_range(self):
        # No opening buy, and the only sale is later: the shares were held
        # through this window.
        result = self._series([
            self._txn("LATER", "2026-04-01", "SELL", 40),
        ])

        self.assertEqual(result["missing_market_symbols"], ["LATER"])

    def test_a_sale_of_an_older_lot_inside_the_window_stays_listed(self):
        result = self._series([
            self._txn("CARRY", "2024-06-03", "BUY", 8),
            self._txn("CARRY", "2026-01-06", "SELL", 8),
        ])

        self.assertEqual(result["missing_market_symbols"], ["CARRY"])

    def test_a_later_round_trip_does_not_fill_the_gap(self):
        result = self._series([
            self._txn("GAP", "2020-01-02", "BUY", 10),
            self._txn("GAP", "2020-06-01", "SELL", 10),
            self._txn("GAP", "2027-02-01", "BUY", 10),
            self._txn("GAP", "2027-03-02", "SELL", 10),
        ])

        self.assertEqual(result["missing_market_symbols"], [])

    def test_one_account_still_in_range_keeps_the_symbol(self):
        result = self._series([
            self._txn("BOTH", "2020-01-02", "BUY", 10, profile=1),
            self._txn("BOTH", "2020-06-01", "SELL", 10, profile=1),
            self._txn("BOTH", "2026-01-05", "BUY", 4, profile=2),
            self._txn("BOTH", "2026-01-06", "SELL", 4, profile=2),
        ])

        self.assertEqual(result["missing_market_symbols"], ["BOTH"])

    def test_a_held_unpriced_name_stays_listed(self):
        holdings = self._held() + [{
            "ticker": "DEAD",
            "market_symbol": "DEAD",
            "position_key": (6, "DEAD"),
            "quantity": 5,
            "current_value": 50,
            "purchase_date": "2020-01-02",
        }]
        result = self._series(
            [self._txn("DEAD", "2020-01-02", "BUY", 5)],
            holdings=holdings,
        )

        self.assertEqual(result["missing_market_symbols"], ["DEAD"])
        self.assertEqual(
            result["coverage_shortfall"]["held_unpriced_symbols"],
            ["DEAD"],
        )

    def test_undated_activity_stays_listed(self):
        result = self._series([
            self._txn("MYSTERY", None, "SELL", 10),
        ])

        self.assertEqual(result["missing_market_symbols"], ["MYSTERY"])

    def test_an_empty_price_frame_still_drops_names_closed_before_it(self):
        index = pd.bdate_range("2026-01-02", periods=10)
        close = pd.DataFrame({
            "OLD": [float("nan")] * 10,
            "NOW": [float("nan")] * 10,
        }, index=index)
        result = self._series(
            [
                self._txn("OLD", "2022-01-03", "BUY", 1),
                self._txn("OLD", "2022-02-01", "SELL", 1),
                self._txn("NOW", "2026-01-05", "BUY", 1),
                self._txn("NOW", "2026-01-06", "SELL", 1),
            ],
            holdings=[],
            close=close,
        )

        self.assertEqual(result["missing_market_symbols"], ["NOW"])
        self.assertEqual(
            result["coverage_shortfall"]["closed_unpriced_symbols"],
            ["NOW"],
        )


if __name__ == "__main__":
    unittest.main()
