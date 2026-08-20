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
    _normalize_prices_to_100,
    _portfolio_period_metrics,
    _resolve_total_return_period,
    _stock_split_history_for_period,
    _transactions_for_current_positions,
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
            "5y": "2021-07-23",
        }

        for period, expected_start in expected_starts.items():
            with self.subTest(period=period):
                result = _resolve_total_return_period(period, today=self.today)
                self.assertEqual(result["start_date"], expected_start)
                self.assertEqual(result["end_date"], "2026-07-23")
                if period == "ytd":
                    self.assertLess(result["yf_kwargs"]["start"], expected_start)
                    self.assertEqual(
                        result["yf_kwargs"]["anchor_on_or_before"],
                        expected_start,
                    )
                else:
                    self.assertEqual(result["yf_kwargs"]["start"], expected_start)
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
        self.assertEqual(result["fallback_positions"], 1)
        self.assertEqual(result["fallback_date_sources"]["import_date"], 1)

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


if __name__ == "__main__":
    unittest.main()
