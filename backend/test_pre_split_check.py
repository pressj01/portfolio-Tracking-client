"""Stock splits in the generic import, and the pre-split trade warning.

The cost-basis ledger replays raw share counts and has no SPLIT type, so a lot
recorded in pre-split units mixes with post-split sells and FIFO reports false
gains and losses. GOOGL split 20-for-1 in July 2022: a BUY of 2 @ $2,871.49
before the split paired with later sells near $120 showed realized losses of
-$527.60 and -$3,986 instead of small gains.

Two defences are pinned here. A SPLIT row in a generic transactions file
rescales that ticker's earlier rows, as the Snowball importer already does.
Without one, a BUY/SELL dated before a split Yahoo reports and priced like a
pre-split trade is flagged with its post-split figures, both in the import
preview and when entered by hand, and is never converted without the user
choosing it.
"""

import datetime
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import config
import database
import split_check
import yahoo_gateway
from transaction_import import parse_generic_transactions, parse_split_ratio

GOOGL_SPLITS = [{"date": "2022-07-15", "ratio": 20.0}]
# conftest stubs the downloader for every test; keep the real one to test it.
_DOWNLOAD_SPLIT_HISTORY = split_check._download_split_history

GENERIC_HEADER = "Date,Type,Ticker,Shares,Price Per Share,Fees,Amount,Split Ratio,Notes"


def _generic_csv(rows):
    return "\n".join([GENERIC_HEADER, *rows]) + "\n"


def _parse_generic(rows):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "generic_transactions.csv"
        path.write_text(_generic_csv(rows), encoding="utf-8")
        return parse_generic_transactions(str(path), path.name)


class ParseSplitRatioTest(unittest.TestCase):
    def test_accepts_factor_and_new_to_old_notation(self):
        for value, expected in [
            ("20", 20.0), (20, 20.0), ("20:1", 20.0), ("20-for-1", 20.0),
            ("20 for 1", 20.0), ("3/2", 1.5), ("1:10", 0.1), ("0.1", 0.1),
            ("1-for-10", 0.1),
        ]:
            with self.subTest(value=value):
                self.assertAlmostEqual(parse_split_ratio(value), expected)

    def test_reverse_split_resolves_either_way_round(self):
        self.assertAlmostEqual(parse_split_ratio("10", reverse=True), 0.1)
        self.assertAlmostEqual(parse_split_ratio("10:1", reverse=True), 0.1)
        self.assertAlmostEqual(parse_split_ratio("1:10", reverse=True), 0.1)

    def test_excel_time_from_a_typed_ratio_is_read_back_as_the_ratio(self):
        # Excel stores a typed 20:1 as the time 20:01 unless the cell is text.
        self.assertAlmostEqual(parse_split_ratio(datetime.time(20, 1)), 20.0)
        self.assertAlmostEqual(parse_split_ratio(datetime.time(1, 10)), 0.1)

    def test_rejects_blank_zero_one_and_text(self):
        for value in (None, "", "0", 0, "1", "1:1", "abc", True, datetime.time(20, 0)):
            with self.subTest(value=value):
                self.assertIsNone(parse_split_ratio(value))


class GenericSplitRowsTest(unittest.TestCase):
    def test_split_row_rescales_earlier_trades_like_snowball(self):
        parsed = _parse_generic([
            "2021-11-08,BUY,GOOGL,2,2871.49,0,,,Pre-split lot",
            "2022-03-01,DIVIDEND,GOOGL,,,,5.00,,Not a real dividend",
            "2022-07-15,SPLIT,GOOGL,,,,,20:1,",
            "2023-03-01,SELL,GOOGL,20,120.00,0,,,Post-split sale",
            "2021-11-08,BUY,MSFT,3,330.00,0,,,Other ticker",
        ])

        trades = {(t["ticker"], t["type"], t["date"]): t for t in parsed["transactions"]}
        buy = trades[("GOOGL", "BUY", "2021-11-08")]
        self.assertAlmostEqual(buy["shares"], 40.0)
        self.assertAlmostEqual(buy["price_per_share"], 143.5745)
        self.assertAlmostEqual(buy["shares"] * buy["price_per_share"], 2 * 2871.49)
        sell = trades[("GOOGL", "SELL", "2023-03-01")]
        self.assertEqual((sell["shares"], sell["price_per_share"]), (20, 120.0))
        self.assertEqual(trades[("GOOGL", "DIVIDEND", "2022-03-01")]["dividend_amount"], 5.0)
        msft = trades[("MSFT", "BUY", "2021-11-08")]
        self.assertEqual((msft["shares"], msft["price_per_share"]), (3, 330.0))
        self.assertEqual(parsed["summary"]["splits_applied"], 1)
        self.assertEqual(parsed["splits"], [
            {"ticker": "GOOGL", "date": "2022-07-15", "ratio": 20.0, "rows_adjusted": 1},
        ])
        self.assertTrue(all("_row_idx" not in t for t in parsed["transactions"]))

    def test_same_date_rows_follow_their_position_around_the_split_row(self):
        parsed = _parse_generic([
            "2022-07-15,BUY,GOOGL,1,2250.00,0,,,Above the split row",
            "2022-07-15,SPLIT,GOOGL,,,,,20,",
            "2022-07-15,BUY,GOOGL,20,112.50,0,,,Below the split row",
        ])

        notes = {t["notes"]: t for t in parsed["transactions"]}
        self.assertAlmostEqual(notes["Above the split row"]["shares"], 20.0)
        self.assertAlmostEqual(notes["Above the split row"]["price_per_share"], 112.5)
        self.assertEqual(notes["Below the split row"]["shares"], 20)

    def test_reverse_split_and_drip_rows(self):
        parsed = _parse_generic([
            "2025-01-02,BUY,OXLC,100,4.00,0,,,",
            "2025-02-03,DRIP,OXLC,5,4.20,0,,,",
            "2025-09-08,REVERSE SPLIT,OXLC,,,,,5,",
        ])

        buy, drip = parsed["transactions"]
        self.assertAlmostEqual(buy["shares"], 20.0)
        self.assertAlmostEqual(buy["price_per_share"], 20.0)
        self.assertAlmostEqual(drip["shares"], 1.0)
        self.assertAlmostEqual(drip["price_per_share"], 21.0)
        self.assertTrue(drip["notes"].startswith("[DRIP]"))
        self.assertEqual(parsed["summary"]["splits_applied"], 1)

    def test_split_row_without_a_ratio_is_filtered_not_guessed(self):
        parsed = _parse_generic([
            "2021-11-08,BUY,GOOGL,2,2871.49,0,,,",
            "2022-07-15,SPLIT,GOOGL,20,,,,,Ratio typed in Shares",
        ])

        self.assertEqual(parsed["transactions"][0]["shares"], 2)
        self.assertEqual(parsed["summary"]["filtered"], 1)
        self.assertEqual(parsed["summary"]["splits_applied"], 0)

    def test_xlsx_split_ratio_cell_stored_as_a_time(self):
        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Transactions"
        ws.append(GENERIC_HEADER.split(","))
        ws.append([datetime.date(2021, 11, 8), "BUY", "GOOGL", 2, 2871.49, 0, None, None, None])
        ws.append([datetime.date(2022, 7, 15), "SPLIT", "GOOGL", None, None, None, None,
                   datetime.time(20, 1), None])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "generic_transactions.xlsx"
            wb.save(path)
            parsed = parse_generic_transactions(str(path), path.name)

        self.assertAlmostEqual(parsed["transactions"][0]["shares"], 40.0)
        self.assertEqual(parsed["summary"]["splits_applied"], 1)


class PreSplitWarningTest(unittest.TestCase):
    LATER = [
        {"date": "2022-10-03", "price_per_share": 99.30},
        {"date": "2023-03-01", "price_per_share": 120.00},
        {"date": "2024-05-01", "price_per_share": 165.00},
    ]

    def _warn(self, shares, price, *, date="2021-11-08", splits=GOOGL_SPLITS,
              later=None, current_price=None, txn_type="BUY", months=None):
        return split_check.pre_split_warning(
            "GOOGL", txn_type, date, shares, price, splits,
            self.LATER if later is None else later,
            current_price=current_price, monthly_ranges=months,
            today=datetime.date(2026, 10, 24),
        )

    def test_yahoo_month_range_is_the_first_reference(self):
        months = {"2021-11": [141.6015, 150.9665]}
        warning = self._warn(2, 2871.49, months=months)

        self.assertEqual(warning["reference_basis"], "yahoo_month")
        self.assertEqual(warning["reference_range"], [141.6015, 150.9665])
        self.assertAlmostEqual(warning["suggested_shares"], 40.0)
        self.assertIn("Yahoo's split-adjusted range for 2021-11", warning["message"])
        self.assertIsNone(self._warn(40, 143.57, months=months))

    def test_yahoo_month_range_catches_growth_that_hides_the_split_from_later_trades(self):
        # NVDA rose about 27-fold in today's shares between late 2019 and mid
        # 2024, nearly its 40-fold in splits, so a 2019 as-traded price is
        # close to the post-split sales. Only the same month's range tells.
        splits = [{"date": "2021-07-20", "ratio": 4.0}, {"date": "2024-06-10", "ratio": 10.0}]
        later = [{"date": "2024-07-01", "price_per_share": 124.0}]
        args = dict(date="2019-11-15", splits=splits, later=later)
        self.assertIsNone(self._warn(10, 216.0, **args))

        warning = self._warn(10, 216.0, months={"2019-11": [4.96475, 5.53525]}, **args)
        self.assertEqual(warning["split_ratio"], 40.0)
        self.assertAlmostEqual(warning["suggested_shares"], 400.0)
        self.assertAlmostEqual(warning["suggested_price_per_share"], 5.4)
        self.assertIn("4-for-1 on 2021-07-20 and 10-for-1 on 2024-06-10", warning["message"])
        self.assertIsNone(self._warn(400, 5.4, months={"2019-11": [4.96475, 5.53525]}, **args))

    def test_googl_pre_split_buy_is_flagged_with_post_split_figures(self):
        warning = self._warn(2, 2871.49)

        self.assertIsNotNone(warning)
        self.assertEqual(warning["split_ratio"], 20.0)
        self.assertAlmostEqual(warning["suggested_shares"], 40.0)
        self.assertAlmostEqual(round(warning["suggested_price_per_share"], 2), 143.57)
        self.assertAlmostEqual(
            warning["suggested_shares"] * warning["suggested_price_per_share"], 2 * 2871.49,
            places=4,
        )
        self.assertEqual(warning["reference_basis"], "later_trades")
        self.assertEqual(warning["reference_dates"], ["2022-10-03", "2023-03-01", "2024-05-01"])
        self.assertEqual(warning["splits"], GOOGL_SPLITS)
        self.assertIn("20-for-1 on 2022-07-15", warning["message"])
        self.assertIn("40 shares at $143.57", warning["message"])

    def test_row_already_restated_by_hand_is_left_alone(self):
        self.assertIsNone(self._warn(40, 143.57))

    def test_trade_after_the_split_is_not_checked(self):
        self.assertIsNone(self._warn(20, 120.0, date="2023-03-01"))
        # Yahoo dates a split on its first split-adjusted session.
        self.assertIsNone(self._warn(20, 112.5, date="2022-07-15"))

    def test_sell_is_checked_too(self):
        warning = self._warn(1, 2900.0, txn_type="SELL")
        self.assertEqual(warning["transaction_type"], "SELL")
        self.assertAlmostEqual(warning["suggested_shares"], 20.0)
        self.assertIn("This SELL of 1 share at $2,900.00", warning["message"])

    def test_only_trades_after_the_split_are_references(self):
        # A pre-split row in today's units (the user's workaround) is not a
        # reference, so it cannot make an as-traded row look correct.
        later = [{"date": "2021-12-01", "price_per_share": 2950.0}, *self.LATER]
        self.assertIsNotNone(self._warn(2, 2871.49, later=later))

    def test_current_price_stands_in_when_no_later_trade_exists(self):
        warning = self._warn(2, 2871.49, later=[], current_price=255.0)
        self.assertEqual(warning["reference_basis"], "current_price")
        self.assertIn("the current price", warning["message"])
        self.assertIsNone(self._warn(2, 2871.49, later=[], current_price=None))

    def test_reverse_split(self):
        splits = [{"date": "2025-09-08", "ratio": 0.2}]
        later = [{"date": "2025-10-01", "price_per_share": 21.0}]
        warning = self._warn(100, 4.10, date="2025-06-02", splits=splits, later=later)
        self.assertAlmostEqual(warning["suggested_shares"], 20.0)
        self.assertAlmostEqual(warning["suggested_price_per_share"], 20.5)
        self.assertIn("1-for-5", warning["message"])
        self.assertIsNone(self._warn(20, 20.5, date="2025-06-02", splits=splits, later=later))

    def test_several_splits_compound(self):
        splits = [{"date": "2014-06-09", "ratio": 7.0}, {"date": "2020-08-31", "ratio": 4.0}]
        months = {"2013-05": [15.6, 16.7], "2019-05": [43.7, 52.1]}
        warning = self._warn(10, 450.0, date="2013-05-01", splits=splits, months=months)
        self.assertEqual(warning["split_ratio"], 28.0)
        self.assertAlmostEqual(warning["suggested_shares"], 280.0)
        # Between the two splits only the second still applies.
        warning = self._warn(10, 190.0, date="2019-05-01", splits=splits, months=months)
        self.assertEqual(warning["split_ratio"], 4.0)
        self.assertAlmostEqual(warning["suggested_price_per_share"], 47.5)

    def test_splits_dated_after_today_are_ignored(self):
        splits = [{"date": "2027-01-04", "ratio": 2.0}]
        self.assertIsNone(self._warn(2, 2871.49, splits=splits))


class YahooSplitHistoryTest(unittest.TestCase):
    def test_reads_through_the_gateway_and_caches(self):
        calls = []

        def fake_download(symbol):
            calls.append(symbol)
            return {
                "splits": [{"date": "2022-07-18", "ratio": 20.0}, {"date": "2014-04-03", "ratio": 1.998}],
                "monthly_ranges": {"2021-11": [141.6015, 150.9665], "2022-13": ["bad"]},
            }

        with patch.object(split_check, "_download_split_history", fake_download):
            first = split_check.yahoo_split_history("SPLITCHKA")
            second = split_check.yahoo_split_history("SPLITCHKA")

        self.assertEqual(first, {
            "splits": [
                {"date": "2014-04-03", "ratio": 1.998},
                {"date": "2022-07-18", "ratio": 20.0},
            ],
            "monthly_ranges": {"2021-11": [141.6015, 150.9665]},
        })
        self.assertEqual(second, first)
        self.assertEqual(calls, ["SPLITCHKA"])

    def test_chart_response_is_read_into_splits_and_monthly_ranges(self):
        # 2022-07-18 13:30 UTC, the 09:30 New York open of GOOGL's first
        # split-adjusted session; bars are stamped at each month's first open.
        chart = {"chart": {"result": [{
            "meta": {"gmtoffset": -14400},
            "timestamp": [1635773400, 1656682200],
            "events": {"splits": {"1656648000": {
                "date": 1658151000, "numerator": 20.0, "denominator": 1.0, "splitRatio": "20:1",
            }}},
            "indicators": {"quote": [{
                "low": [141.6015, 101.88], "high": [150.9665, 122.85],
            }]},
        }]}}

        class FakeYfData:
            def get_raw_json(self, url, params=None):
                self.url, self.params = url, params
                return chart

        with patch("yfinance.data.YfData", FakeYfData):
            history = _DOWNLOAD_SPLIT_HISTORY("GOOGL")

        self.assertEqual(history["splits"], [{"date": "2022-07-18", "ratio": 20.0}])
        self.assertEqual(history["monthly_ranges"], {
            "2021-11": [141.6015, 150.9665], "2022-07": [101.88, 122.85],
        })

    def test_unknown_symbol_is_none_and_not_cached(self):
        calls = []

        def fake_download(symbol):
            calls.append(symbol)
            return None

        with patch.object(split_check, "_download_split_history", fake_download):
            self.assertIsNone(split_check.yahoo_split_history("SPLITCHKB"))
            self.assertIsNone(split_check.yahoo_split_history("SPLITCHKB"))
        self.assertEqual(calls, ["SPLITCHKB", "SPLITCHKB"])

    def test_throttled_lookup_skips_the_check(self):
        def throttled(symbol):
            raise RuntimeError("HTTP Error 429: Too Many Requests")

        with patch.object(split_check, "_download_split_history", throttled):
            self.assertIsNone(split_check.yahoo_split_history("SPLITCHKC"))
        yahoo_gateway.reset_breaker()


class PreSplitEndpointTest(unittest.TestCase):
    PROFILE = 2

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        conn.execute(
            "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order) "
            "VALUES (1, 'Owner', '', 1, 1), (2, 'Brokerage', '', 1, 2)"
        )
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, description, quantity, price_paid, "
            "purchase_value, current_price, current_value, import_date) "
            "VALUES ('GOOGL', 2, 'Alphabet Inc.', 40, 110, 4400, 255, 10200, '2022-10-03')"
        )
        conn.executemany(
            "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, "
            "shares, price_per_share, fees, notes) VALUES ('GOOGL', 2, ?, ?, ?, ?, 0, '')",
            [("BUY", "2022-10-03", 60, 99.30), ("SELL", "2023-03-01", 20, 120.00)],
        )
        conn.commit()
        conn.close()

        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        self._orig_db_path = config.DB_PATH
        config.DB_PATH = self.db_path
        app_module.app._db_initialized = True
        self._patches = [
            patch.object(app_module, "get_connection", self._get_connection),
            patch.object(app_module, "_create_import_backup", lambda profile_id=None: None),
            patch.object(app_module, "populate_holdings", lambda profile_id: None),
            patch.object(app_module, "populate_dividends", lambda profile_id: None),
            patch.object(app_module, "populate_income_tracking", lambda profile_id: None),
            patch.object(
                app_module, "_snapshot_nav_after_profile_update",
                lambda profile_id, nav_date=None: None,
            ),
            patch.object(app_module, "_yahoo_split_history", self._split_history),
        ]
        for patcher in self._patches:
            patcher.start()
        self.split_lookups = []
        self.client = app_module.app.test_client()

    def tearDown(self):
        for patcher in reversed(self._patches):
            patcher.stop()
        app_module.app._db_initialized = self._orig_db_init
        config.DB_PATH = self._orig_db_path
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _split_history(self, ticker):
        # No monthly ranges, so these exercise the later-trades reference.
        self.split_lookups.append(ticker)
        splits = list(GOOGL_SPLITS) if ticker == "GOOGL" else []
        return {"splits": splits, "monthly_ranges": {}}

    def _trades(self):
        conn = self._get_connection()
        try:
            return [
                tuple(row) for row in conn.execute(
                    "SELECT transaction_type, transaction_date, shares, price_per_share "
                    "FROM transactions WHERE ticker = 'GOOGL' AND profile_id = 2 "
                    "ORDER BY transaction_date, id"
                ).fetchall()
            ]
        finally:
            conn.close()

    def _post(self, **fields):
        body = {
            "transaction_type": "BUY", "transaction_date": "2021-11-08",
            "shares": 2, "price_per_share": 2871.49, "fees": 0, **fields,
        }
        return self.client.post(
            f"/api/holdings/GOOGL/transactions?profile_id={self.PROFILE}", json=body,
        )

    def test_hand_entered_pre_split_buy_is_held_back_with_the_post_split_figures(self):
        before = self._trades()
        response = self._post()

        self.assertEqual(response.status_code, 409)
        warning = response.get_json()["split_warning"]
        self.assertAlmostEqual(warning["suggested_shares"], 40.0)
        self.assertAlmostEqual(round(warning["suggested_price_per_share"], 2), 143.57)
        self.assertEqual(response.get_json()["error"], warning["message"])
        self.assertEqual(self._trades(), before)

    def test_keep_as_entered_saves_the_row_unconverted(self):
        response = self._post(ignore_split_warning=True)

        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertIn(("BUY", "2021-11-08", 2.0, 2871.49), self._trades())

    def test_post_split_figures_save_without_a_warning(self):
        response = self._post(shares=40, price_per_share=143.5745)

        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertIn(("BUY", "2021-11-08", 40.0, 143.5745), self._trades())

    def test_todays_trade_never_asks_yahoo(self):
        response = self._post(
            transaction_date=datetime.date.today().isoformat(), shares=1, price_per_share=255,
        )

        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertEqual(self.split_lookups, [])

    def test_unreachable_split_history_never_blocks_a_save(self):
        with patch.object(app_module, "_yahoo_split_history", lambda ticker: None):
            response = self._post()
        self.assertEqual(response.status_code, 201, response.get_json())

    def test_editing_a_row_into_pre_split_units_is_held_back(self):
        conn = self._get_connection()
        try:
            txn_id = conn.execute(
                "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, "
                "shares, price_per_share, fees, notes) "
                "VALUES ('GOOGL', 2, 'BUY', '2021-11-08', 40, 143.5745, 0, '')"
            ).lastrowid
            conn.commit()
        finally:
            conn.close()
        url = f"/api/holdings/GOOGL/transactions/{txn_id}?profile_id={self.PROFILE}"
        body = {"transaction_type": "BUY", "transaction_date": "2021-11-08",
                "shares": 2, "price_per_share": 2871.49, "fees": 0, "notes": ""}

        response = self.client.put(url, json=body)
        self.assertEqual(response.status_code, 409)
        self.assertAlmostEqual(response.get_json()["split_warning"]["suggested_shares"], 40.0)
        self.assertIn(("BUY", "2021-11-08", 40.0, 143.5745), self._trades())

        response = self.client.put(url, json={**body, "ignore_split_warning": True})
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertIn(("BUY", "2021-11-08", 2.0, 2871.49), self._trades())

    def _generic_form(self, **extra):
        content = _generic_csv([
            "2021-11-08,BUY,GOOGL,2,2871.49,0,,,Pre-split lot",
            "2021-12-01,BUY,GOOGL,1,2950.00,0,,,Another pre-split lot",
        ]).encode("utf-8")
        return {
            "file": (io.BytesIO(content), "generic_transactions.csv"),
            "format": "generic_transactions",
            **extra,
        }

    def test_generic_preview_flags_pre_split_rows_and_import_converts_only_the_chosen(self):
        response = self.client.post(
            f"/api/import/transactions/preview?profile_id={self.PROFILE}",
            data=self._generic_form(), content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        preview = response.get_json()
        warnings = preview["split_warnings"]
        self.assertEqual([w["index"] for w in warnings], [0, 1])
        self.assertAlmostEqual(warnings[0]["suggested_shares"], 40.0)
        self.assertAlmostEqual(round(warnings[0]["suggested_price_per_share"], 2), 143.57)
        self.assertFalse(warnings[0]["already_in_ledger"])
        self.assertFalse(warnings[0]["post_split_in_ledger"])
        # The preview itself converts nothing.
        self.assertEqual(preview["transactions"][0]["shares"], 2)

        response = self.client.post(
            f"/api/import/transactions?profile_id={self.PROFILE}",
            data=self._generic_form(split_conversions=json.dumps([warnings[0]])),
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["split_conversions"], 1)
        trades = self._trades()
        converted = [t for t in trades if t[1] == "2021-11-08"]
        self.assertEqual(len(converted), 1)
        self.assertAlmostEqual(converted[0][2], 40.0)
        self.assertAlmostEqual(converted[0][3], 143.5745)
        self.assertIn(("BUY", "2021-12-01", 1.0, 2950.0), trades)

    def test_preview_marks_a_row_already_saved_either_way(self):
        conn = self._get_connection()
        try:
            conn.executemany(
                "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, "
                "shares, price_per_share, fees, notes) VALUES ('GOOGL', 2, 'BUY', ?, ?, ?, 0, '')",
                [("2021-11-08", 2, 2871.49), ("2021-12-01", 20, 147.50)],
            )
            conn.commit()
        finally:
            conn.close()

        response = self.client.post(
            f"/api/import/transactions/preview?profile_id={self.PROFILE}",
            data=self._generic_form(), content_type="multipart/form-data",
        )
        warnings = {w["index"]: w for w in response.get_json()["split_warnings"]}
        self.assertTrue(warnings[0]["already_in_ledger"])
        self.assertTrue(warnings[1]["post_split_in_ledger"])

    def test_import_refuses_conversions_for_a_file_changed_since_the_preview(self):
        stale = {
            "index": 0, "ticker": "GOOGL", "transaction_type": "BUY",
            "transaction_date": "2021-11-08", "shares": 3, "price_per_share": 2871.49,
            "split_ratio": 20,
        }
        before = self._trades()
        response = self.client.post(
            f"/api/import/transactions?profile_id={self.PROFILE}",
            data=self._generic_form(split_conversions=json.dumps([stale])),
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Preview it again", response.get_json()["error"])
        self.assertEqual(self._trades(), before)


if __name__ == "__main__":
    unittest.main()
