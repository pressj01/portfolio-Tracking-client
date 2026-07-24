import sys
import unittest
import datetime
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import (
    app,
    _build_transaction_aware_portfolio_series,
    _normalize_prices_to_100,
    _portfolio_period_metrics,
    _resolve_total_return_period,
)


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
            "1mo": "2026-06-23",
            "3mo": "2026-04-23",
            "ytd": "2026-01-01",
            "1y": "2025-07-23",
            "5y": "2021-07-23",
            "10y": "2016-07-23",
        }

        for period, expected_start in expected_starts.items():
            with self.subTest(period=period):
                result = _resolve_total_return_period(period, today=self.today)
                self.assertEqual(result["start_date"], expected_start)
                self.assertEqual(result["end_date"], "2026-07-23")
                self.assertEqual(result["yf_kwargs"]["start"], expected_start)
                self.assertEqual(result["yf_kwargs"]["end"], "2026-07-24")

    def test_resolves_any_completed_calendar_year(self):
        for year in (2025, 2018):
            with self.subTest(year=year):
                result = _resolve_total_return_period(str(year), today=self.today)

                self.assertEqual(result["label"], f"Calendar Year {year}")
                self.assertEqual(result["start_date"], f"{year}-01-01")
                self.assertEqual(result["end_date"], f"{year}-12-31")
                self.assertEqual(result["yf_kwargs"]["end"], f"{year + 1}-01-01")

    def test_resolves_all_max(self):
        result = _resolve_total_return_period("max", today=self.today)

        self.assertEqual(result["label"], "All / Max")
        self.assertIsNone(result["start_date"])
        self.assertEqual(result["end_date"], "2026-07-23")
        self.assertEqual(result["yf_kwargs"], {"period": "max"})

    def test_clamps_leap_day_for_rolling_year(self):
        result = _resolve_total_return_period(
            "1y",
            today=datetime.date(2024, 2, 29),
        )

        self.assertEqual(result["start_date"], "2023-02-28")


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


class PortfolioReturnSeriesTest(unittest.TestCase):
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
            [],
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
            [],
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


if __name__ == "__main__":
    unittest.main()
