"""Yahoo split conversion must not double-count Snowball-adjusted lots.

Snowball's importer rewrites historical BUY/SELL quantities into today's share
units (ratio in the SPLIT row). Growth, Total Return, Dashboard tracker, and
NAV backfill then multiply those same lots by Yahoo's Stock Splits series.
A reverse split (OXLC 0.2) makes the replay miss the saved snapshot, so the
engine invents an opening lot and Start Value jumps while current holdings
still look right. A forward split (NVDA 10) inflates a closed cycle the same
way.

As-traded broker history still needs the Yahoo conversion: Close is already
in today's units.

This module is the contract for that decision. Cases are written against
`_build_transaction_aware_portfolio_series` so a regression fails here before
it shows up as an overstated Growth card.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import (
    _build_transaction_aware_portfolio_series,
    _opening_lot_plan,
    _portfolio_period_metrics,
)
from transaction_import import parse_snowball_csv


def _txn(ticker, kind, day, shares, price=None, profile_id=1):
    row = {
        "ticker": ticker,
        "market_symbol": ticker,
        "position_key": (profile_id, ticker),
        "profile_id": profile_id,
        "transaction_type": kind,
        "transaction_date": day,
        "shares": shares,
    }
    if price is not None:
        row["price_per_share"] = price
    return row


def _holding(ticker, quantity, purchase_date, profile_id=1):
    return {
        "ticker": ticker,
        "market_symbol": ticker,
        "position_key": (profile_id, ticker),
        "profile_id": profile_id,
        "quantity": quantity,
        "purchase_date": purchase_date,
    }


def _frames(close_map, split_map=None):
    close = pd.DataFrame(close_map)
    close.index = pd.to_datetime(close.index)
    zeros = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    splits = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    if split_map:
        extra_index = sorted(set(close.index).union(pd.to_datetime(list(split_map))))
        splits = pd.DataFrame(0.0, index=extra_index, columns=close.columns)
        for day, by_ticker in split_map.items():
            for ticker, factor in by_ticker.items():
                splits.loc[pd.Timestamp(day), ticker] = factor
    return close, zeros, splits


def _series(close, transactions, holdings, splits):
    zeros = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    return _build_transaction_aware_portfolio_series(
        close, close, zeros, zeros, transactions, holdings, stock_splits=splits,
    )


class SnowballImportAppliesSplitOnceTest(unittest.TestCase):
    """The importer must convert as-traded Snowball rows into today's units."""

    def _parse(self, rows):
        content = "Event,Date,Symbol,Price,Quantity,Currency,FeeTax,Exchange,FeeCurrency,DoNotAdjustCash,Note\n"
        content += "\n".join(rows)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Snowball_Export_IRA.csv"
            path.write_text(content, encoding="utf-8")
            return parse_snowball_csv(str(path), path.name)

    def test_reverse_split_rewrites_pre_split_buy_quantity_and_price(self):
        parsed = self._parse([
            '"BUY","2024-08-07 00:00:00","OXLC","5.42","1842","USD","0","NASDAQ","","False","Buy"',
            '"SPLIT","2025-09-07 03:00:00","OXLC","0.2","0","USD","0","NASDAQ","","",""',
            '"SELL","2025-10-17 00:00:00","OXLC","14.89","1720","USD","0","NASDAQ","","False","Sold"',
        ])
        buys = [row for row in parsed["transactions"] if row["type"] == "BUY"]
        sells = [row for row in parsed["transactions"] if row["type"] == "SELL"]
        self.assertEqual(parsed["summary"]["splits_applied"], 1)
        self.assertEqual(len(buys), 1)
        self.assertAlmostEqual(buys[0]["shares"], 368.4, places=6)
        self.assertAlmostEqual(buys[0]["price_per_share"], 27.1, places=6)
        self.assertEqual(len(sells), 1)
        self.assertAlmostEqual(sells[0]["shares"], 1720.0, places=6)
        self.assertAlmostEqual(sells[0]["price_per_share"], 14.89, places=6)

    def test_forward_split_rewrites_pre_split_buy_quantity_and_price(self):
        parsed = self._parse([
            '"BUY","2024-06-07 00:00:00","NVDA","1207.2747","5","USD","0","NASDAQ","","False","Buy"',
            '"SPLIT","2024-06-09 03:00:00","NVDA","10","0","USD","0","NASDAQ","","",""',
            '"BUY","2024-06-10 00:00:00","NVDA","122.1359","34","USD","0","NASDAQ","","False","Buy"',
            '"SELL","2024-07-16 00:00:00","NVDA","125.62","84","USD","0","NASDAQ","","False","Sell"',
        ])
        buys = [row for row in parsed["transactions"] if row["type"] == "BUY"]
        self.assertEqual(parsed["summary"]["splits_applied"], 1)
        self.assertAlmostEqual(buys[0]["shares"], 50.0, places=6)
        self.assertAlmostEqual(buys[0]["price_per_share"], 120.72747, places=5)
        self.assertAlmostEqual(buys[1]["shares"], 34.0, places=6)
        self.assertAlmostEqual(buys[1]["price_per_share"], 122.1359, places=4)

    def test_post_split_rows_are_left_in_traded_units(self):
        parsed = self._parse([
            '"BUY","2024-08-07 00:00:00","OXLC","5.42","1842","USD","0","NASDAQ","","False","Buy"',
            '"SPLIT","2025-09-07 03:00:00","OXLC","0.2","0","USD","0","NASDAQ","","",""',
            '"BUY","2026-08-13 00:00:00","OXLC","9.75","256","USD","0","NASDAQ","","False","Buy"',
        ])
        later = [row for row in parsed["transactions"] if row["date"] == "2026-08-13"][0]
        self.assertAlmostEqual(later["shares"], 256.0, places=6)
        self.assertAlmostEqual(later["price_per_share"], 9.75, places=6)


class AsTradedBrokerHistoryStillConvertsTest(unittest.TestCase):
    """Yahoo Close is in today's units; as-traded quantities must be scaled."""

    def test_reverse_split_round_trip_values_in_today_share_units(self):
        dates = pd.to_datetime(["2022-01-03", "2022-01-04", "2024-01-23"])
        close = pd.DataFrame({"SIRC": [100.0, 50.0, 50.0]}, index=dates)
        splits = pd.DataFrame({"SIRC": [0.0, 0.0, 0.01]}, index=dates)
        transactions = [
            _txn("SIRC", "BUY", "2022-01-03", 100),
            _txn("SIRC", "SELL", "2022-01-04", 100),
        ]

        result = _series(close, transactions, [], splits)

        self.assertEqual(result["market_value"][:2], [100.0, 0.0])
        self.assertEqual(result["price_gain_dollar"], -50.0)
        self.assertEqual(result["split_adjusted_transactions"], 2)
        self.assertEqual(result["split_adjusted_positions"], 1)
        self.assertEqual(result["inferred_opening_detail"], [])

    def test_reverse_split_open_position_matches_saved_post_split_shares(self):
        close, zeros, splits = _frames(
            {"OXLC": {"2024-08-07": 27.10, "2025-10-17": 14.89, "2026-08-13": 9.28}},
            {"2025-09-07": {"OXLC": 0.2}},
        )
        transactions = [
            _txn("OXLC", "BUY", "2024-08-07", 1842, 5.42),
            _txn("OXLC", "BUY", "2026-08-13", 417, 9.28),
        ]
        holdings = [_holding("OXLC", 1842 * 0.2 + 417, "2024-08-07")]

        result = _series(close, transactions, holdings, splits)
        metrics = _portfolio_period_metrics(result)

        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertGreater(result["split_adjusted_transactions"], 0)
        self.assertAlmostEqual(metrics["start_value"], 1842 * 0.2 * 27.10, places=2)
        self.assertAlmostEqual(metrics["end_value"], (1842 * 0.2 + 417) * 9.28, places=2)

    def test_forward_split_as_traded_buy_is_scaled_up(self):
        close, zeros, splits = _frames(
            {"NVDA": {"2024-06-07": 120.73, "2024-06-10": 122.14, "2024-07-16": 125.62}},
            {"2024-06-09": {"NVDA": 10.0}},
        )
        transactions = [
            _txn("NVDA", "BUY", "2024-06-07", 5, 1207.27),
            _txn("NVDA", "BUY", "2024-06-10", 34, 122.14),
            _txn("NVDA", "SELL", "2024-07-16", 84, 125.62),
        ]

        result = _series(close, transactions, [], splits)

        self.assertAlmostEqual(result["market_value"][0], 50 * 120.73, places=2)
        self.assertAlmostEqual(result["market_value"][1], 84 * 122.14, places=2)
        self.assertAlmostEqual(result["market_value"][2], 0.0, places=6)
        self.assertGreater(result["split_adjusted_transactions"], 0)
        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertEqual(result["inferred_closing_positions"], 0)


class SnowballAdjustedLotsMustNotConvertAgainTest(unittest.TestCase):
    """Stored lots already in today's units: Yahoo conversion overstates start."""

    def test_reverse_split_does_not_invent_opening_shares_before_later_buys(self):
        # IRA-BDA OXLC shape: several already-adjusted pre-split buys, a
        # post-split sell of the whole position, then a new lot. Native ledger
        # nets to the snapshot. Applying 0.2 again makes the sell dwarf the
        # buys, so the replay seeds a huge opening lot on day one.
        close, zeros, splits = _frames(
            {"OXLC": {
                "2024-08-07": 27.10,
                "2025-06-27": 20.70,
                "2025-10-17": 14.89,
                "2026-08-13": 9.28,
                "2026-08-14": 9.28,
            }},
            {"2025-09-07": {"OXLC": 0.2}},
        )
        transactions = [
            _txn("OXLC", "BUY", "2024-08-07", 368.4, 27.10),
            _txn("OXLC", "BUY", "2025-06-27", 1351.6, 20.70),
            _txn("OXLC", "SELL", "2025-10-17", 1720.0, 14.89),
            _txn("OXLC", "BUY", "2026-08-13", 417.0, 9.28),
        ]
        holdings = [_holding("OXLC", 417.0, "2024-08-07")]

        result = _series(close, transactions, holdings, splits)
        metrics = _portfolio_period_metrics(result)

        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertEqual(result["inferred_opening_positions"], 0)
        self.assertEqual(result["split_adjusted_transactions"], 0)
        self.assertAlmostEqual(result["market_value"][0], 368.4 * 27.10, places=2)
        self.assertAlmostEqual(result["market_value"][1], 1720.0 * 20.70, places=2)
        self.assertAlmostEqual(result["market_value"][2], 0.0, places=6)
        self.assertAlmostEqual(result["market_value"][3], 417.0 * 9.28, places=2)
        self.assertAlmostEqual(metrics["start_value"], 368.4 * 27.10, places=2)
        self.assertAlmostEqual(metrics["end_value"], 417.0 * 9.28, places=2)

    def test_current_open_lot_after_reverse_split_is_not_flagged(self):
        close, zeros, splits = _frames(
            {"OXLC": {"2026-01-02": 12.00, "2026-08-13": 9.28, "2026-08-18": 9.28}},
            {"2025-09-07": {"OXLC": 0.2}},
        )
        transactions = [
            _txn("OXLC", "BUY", "2024-08-07", 368.4, 27.10),
            _txn("OXLC", "BUY", "2025-06-27", 1351.6, 20.70),
            _txn("OXLC", "SELL", "2025-10-17", 1720.0, 14.89),
            _txn("OXLC", "BUY", "2026-08-13", 256.0, 9.75),
            _txn("OXLC", "BUY", "2026-08-18", 161.0, 9.28),
        ]
        holdings = [_holding("OXLC", 417.0, "2026-08-13")]

        result = _series(close, transactions, holdings, splits)
        metrics = _portfolio_period_metrics(result)

        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertEqual(result["split_adjusted_transactions"], 0)
        self.assertAlmostEqual(metrics["start_value"], 256.0 * 9.28, places=2)
        self.assertAlmostEqual(metrics["end_value"], 417.0 * 9.28, places=2)

    def test_forward_split_closed_cycle_does_not_inflate_day_one(self):
        close, zeros, splits = _frames(
            {"NVDA": {"2024-06-07": 120.73, "2024-06-10": 122.14, "2024-07-16": 125.62}},
            {"2024-06-09": {"NVDA": 10.0}},
        )
        transactions = [
            _txn("NVDA", "BUY", "2024-06-07", 50.0, 120.72747),
            _txn("NVDA", "BUY", "2024-06-10", 34.0, 122.14),
            _txn("NVDA", "SELL", "2024-07-16", 1.0, 125.89),
            _txn("NVDA", "SELL", "2024-07-16", 83.0, 125.62),
        ]

        result = _series(close, transactions, [], splits)

        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertEqual(result["inferred_closing_positions"], 0)
        self.assertEqual(result["split_adjusted_transactions"], 0)
        self.assertAlmostEqual(result["market_value"][0], 50.0 * 120.73, places=2)
        self.assertAlmostEqual(result["market_value"][1], 84.0 * 122.14, places=2)
        self.assertAlmostEqual(result["market_value"][2], 0.0, places=6)

    def test_imported_snowball_rows_are_not_converted_a_second_time(self):
        content = "\n".join([
            "Event,Date,Symbol,Price,Quantity,Currency,FeeTax,Exchange,FeeCurrency,DoNotAdjustCash,Note",
            '"BUY","2024-08-07 00:00:00","OXLC","5.42","1842","USD","0","NASDAQ","","False","Buy"',
            '"BUY","2025-06-27 00:00:00","OXLC","4.14","6758","USD","0","NASDAQ","","False","Buy"',
            '"SPLIT","2025-09-07 03:00:00","OXLC","0.2","0","USD","0","NASDAQ","","",""',
            '"SELL","2025-10-17 00:00:00","OXLC","14.89","1720","USD","0","NASDAQ","","False","Sold"',
            '"BUY","2026-08-13 00:00:00","OXLC","9.28","417","USD","0","NASDAQ","","False","Buy"',
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Snowball_Export_IRA.csv"
            path.write_text(content, encoding="utf-8")
            parsed = parse_snowball_csv(str(path), path.name)

        transactions = []
        for row in parsed["transactions"]:
            if row["type"] not in {"BUY", "SELL"}:
                continue
            transactions.append(_txn(
                "OXLC", row["type"], row["date"], row["shares"], row.get("price_per_share"),
            ))
        close, zeros, splits = _frames(
            {"OXLC": {
                "2024-08-07": 27.10,
                "2025-06-27": 20.70,
                "2025-10-17": 14.89,
                "2026-08-13": 9.28,
                "2026-08-14": 9.28,
            }},
            {"2025-09-07": {"OXLC": 0.2}},
        )
        holdings = [_holding("OXLC", 417.0, "2024-08-07")]

        result = _series(close, transactions, holdings, splits)
        metrics = _portfolio_period_metrics(result)

        self.assertAlmostEqual(transactions[0]["shares"], 368.4, places=4)
        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertEqual(result["split_adjusted_transactions"], 0)
        self.assertAlmostEqual(metrics["start_value"], 368.4 * 27.10, places=2)
        self.assertAlmostEqual(metrics["end_value"], 417.0 * 9.28, places=2)


class MixedBookAppliesConversionPerPositionTest(unittest.TestCase):
    def test_already_adjusted_ticker_skips_conversion_as_traded_ticker_does_not(self):
        close, zeros, splits = _frames(
            {
                "OXLC": {
                    "2024-08-07": 27.10,
                    "2025-10-17": 14.89,
                    "2026-08-13": 9.28,
                },
                "SIRC": {
                    "2024-08-07": 100.0,
                    "2025-10-17": 50.0,
                    "2026-08-13": 50.0,
                },
            },
            {
                "2025-09-07": {"OXLC": 0.2},
                "2025-01-23": {"SIRC": 0.01},
            },
        )
        transactions = [
            _txn("OXLC", "BUY", "2024-08-07", 368.4, 27.10),
            _txn("OXLC", "BUY", "2025-06-27", 1351.6, 20.70),
            _txn("OXLC", "SELL", "2025-10-17", 1720.0, 14.89),
            _txn("OXLC", "BUY", "2026-08-13", 417.0, 9.28),
            _txn("SIRC", "BUY", "2024-08-07", 100),
            _txn("SIRC", "SELL", "2024-08-08", 100),
        ]
        holdings = [_holding("OXLC", 417.0, "2024-08-07")]

        result = _series(close, transactions, holdings, splits)

        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertEqual(result["split_adjusted_positions"], 1)
        self.assertAlmostEqual(result["market_value"][0], 368.4 * 27.10 + 1.0 * 100.0, places=2)


class MissingOpeningLotWithoutSplitStillInferredTest(unittest.TestCase):
    def test_short_ledger_still_invents_the_native_gap(self):
        dates = pd.to_datetime(["2026-01-02", "2026-01-05", "2026-01-06"])
        close = pd.DataFrame({"AAA": [100.0, 110.0, 121.0]}, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        transactions = [_txn("AAA", "BUY", "2026-01-05", 1)]
        holdings = [_holding("AAA", 11, None)]
        holdings[0]["import_date"] = "2026-01-06"

        result = _build_transaction_aware_portfolio_series(
            close, close, zeros, zeros, transactions, holdings,
        )

        self.assertEqual(result["inferred_opening_positions"], 1)
        self.assertEqual(result["inferred_opening_detail"][0]["shares"], 10.0)
        self.assertEqual(result["market_value"], [None, 1210.0, 1331.0])

    def test_as_traded_history_that_already_matches_snapshot_does_not_infer(self):
        close, zeros, splits = _frames(
            {"OXLC": {"2024-08-07": 27.10, "2026-08-13": 9.28}},
            {"2025-09-07": {"OXLC": 0.2}},
        )
        transactions = [_txn("OXLC", "BUY", "2024-08-07", 1000, 5.42)]
        holdings = [_holding("OXLC", 200.0, "2024-08-07")]

        result = _series(close, transactions, holdings, splits)

        self.assertEqual(result["inferred_opening_detail"], [])
        self.assertAlmostEqual(result["market_value"][0], 200.0 * 27.10, places=2)


class OpeningLotPlanUsesNativeSharesTest(unittest.TestCase):
    """The Transactions modal must keep using stored shares, not Yahoo units."""

    def _plan(self, rows, quantity, purchase_date):
        import sqlite3

        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(
            """
            CREATE TABLE all_account_info (
                ticker TEXT, profile_id INTEGER, quantity REAL, purchase_date TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY,
                ticker TEXT, profile_id INTEGER, transaction_type TEXT,
                transaction_date TEXT, shares REAL
            );
            """
        )
        conn.execute(
            "INSERT INTO all_account_info VALUES ('OXLC', 1, ?, ?)",
            (quantity, purchase_date),
        )
        for index, row in enumerate(rows, start=1):
            conn.execute(
                "INSERT INTO transactions VALUES (?, 'OXLC', 1, ?, ?, ?)",
                (index, row["transaction_type"], row["transaction_date"], row["shares"]),
            )
        conn.commit()
        try:
            return _opening_lot_plan(conn, "OXLC", 1)
        finally:
            conn.close()

    def test_balanced_already_adjusted_ledger_does_not_need_an_opening_lot(self):
        plan = self._plan(
            [
                _txn("OXLC", "BUY", "2024-08-07", 368.4),
                _txn("OXLC", "BUY", "2025-06-27", 1351.6),
                _txn("OXLC", "SELL", "2025-10-17", 1720.0),
                _txn("OXLC", "BUY", "2026-08-13", 417.0),
            ],
            quantity=417.0,
            purchase_date="2024-08-07",
        )
        self.assertFalse(plan["needed"])
        self.assertEqual(plan["reason"], "reconciles")

    def test_clip_only_gap_is_not_offered_as_an_opening_lot(self):
        # Closed cycle still on the ledger, open lot starts mid-history.
        # Clipped net is short of the snapshot; the full ledger is not.
        plan = self._plan(
            [
                _txn("OXLC", "BUY", "2025-02-13", 30.0),
                _txn("OXLC", "BUY", "2025-04-02", 15.0),
                _txn("OXLC", "SELL", "2025-04-04", 20.0),
                _txn("OXLC", "SELL", "2025-06-30", 25.0335),
                _txn("OXLC", "BUY", "2025-06-30", 0.024),
                _txn("OXLC", "BUY", "2025-09-30", 50.0),
            ],
            quantity=49.9905,
            purchase_date="2025-06-30",
        )
        self.assertFalse(plan["needed"])
        self.assertEqual(plan["reason"], "clip_only")

    def test_true_shortfall_is_still_offered(self):
        plan = self._plan(
            [_txn("OXLC", "BUY", "2026-08-13", 1.0)],
            quantity=11.0,
            purchase_date="2026-08-13",
        )
        self.assertTrue(plan["needed"])
        self.assertEqual(plan["reason"], "missing_opening_lot")
        self.assertAlmostEqual(plan["shares"], 10.0, places=6)


class NavBackfillShareScalingTest(unittest.TestCase):
    """NAV history uses the same per-ticker convert-or-not rule as Growth."""

    def test_scale_helper_skips_tickers_whose_native_ledger_already_matches(self):
        from app import _scale_transaction_events_for_yahoo_prices

        events = [
            ("2024-08-07", "OXLC", "BUY", 368.4),
            ("2025-06-27", "OXLC", "BUY", 1351.6),
            ("2025-10-17", "OXLC", "SELL", 1720.0),
            ("2026-08-13", "OXLC", "BUY", 417.0),
            ("2024-06-07", "NVDA", "BUY", 5.0),
            ("2024-06-10", "NVDA", "BUY", 34.0),
            ("2024-07-16", "NVDA", "SELL", 84.0),
        ]
        snapshots = {"OXLC": 417.0}
        split_factors = {
            "OXLC": [("2025-09-07", 0.2)],
            "NVDA": [("2024-06-09", 10.0)],
        }

        scaled = _scale_transaction_events_for_yahoo_prices(
            events, snapshots, split_factors,
        )
        by_key = {
            (day, ticker, kind): shares for day, ticker, kind, shares in scaled
        }
        self.assertAlmostEqual(by_key[("2024-08-07", "OXLC", "BUY")], 368.4, places=4)
        self.assertAlmostEqual(by_key[("2025-10-17", "OXLC", "SELL")], 1720.0, places=4)
        self.assertAlmostEqual(by_key[("2024-06-07", "NVDA", "BUY")], 50.0, places=4)
        self.assertAlmostEqual(by_key[("2024-07-16", "NVDA", "SELL")], 84.0, places=4)


if __name__ == "__main__":
    unittest.main()
