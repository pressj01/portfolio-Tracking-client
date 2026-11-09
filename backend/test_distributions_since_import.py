"""Distributions paid since a broker file, added to a broker-synced account's value.

Between positions imports the account is (file shares x today's price) + file
cash. Each ex-date drops the price, but the payment only arrives with the next
file, so the value drifts low by everything paid since. The estimate closes that
gap and a newer file or cash figure absorbs it.
"""
import datetime
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module  # noqa: E402
import normalize  # noqa: E402
from app import (  # noqa: E402
    _distribution_baselines,
    _distribution_detail_value,
    _distributions_since_broker_file,
    _distributions_since_file_summary,
    _rebase_distributions_since_file,
    _set_profile_cash_value,
)
from database import ensure_tables_exist  # noqa: E402

D = datetime.date
TODAY = D(2026, 11, 9)
FILE = D(2026, 11, 5)


def weekly(ex, pay, per_share=0.50):
    return {"ex": ex, "pay": pay, "per_share": per_share}


class DistributionsSinceFileTest(unittest.TestCase):
    """Which payments count, and how much each is worth."""

    def calc(self, events, quantity=100, **kwargs):
        kwargs.setdefault("is_drip", False)
        kwargs.setdefault("as_of", FILE)
        kwargs.setdefault("today", TODAY)
        return _distributions_since_broker_file(events, quantity, **kwargs)

    def test_counts_payments_after_the_file_up_to_today(self):
        result = self.calc([
            weekly(D(2026, 10, 29), D(2026, 10, 30)),  # in the file
            weekly(D(2026, 11, 5), D(2026, 11, 6)),    # went ex on the file day, paid after
            weekly(D(2026, 11, 12), D(2026, 11, 13)),  # not paid yet
        ])

        self.assertEqual(result["value"], 50.0)
        self.assertEqual(result["cash"], 50.0)
        self.assertEqual([e["pay"] for e in result["events"]], ["2026-11-06"])
        self.assertEqual(result["events"][0]["source"], "estimate")

    def test_a_payment_on_the_file_day_is_already_in_it(self):
        result = self.calc([weekly(D(2026, 11, 4), D(2026, 11, 5))])
        self.assertEqual(result["value"], 0.0)

    def test_gone_ex_but_not_yet_paid_does_not_count(self):
        # The price has dropped, but no broker shows the cash until the pay date.
        result = self.calc([weekly(D(2026, 11, 9), D(2026, 11, 10))])
        self.assertEqual(result["value"], 0.0)

    def test_an_ex_date_before_the_file_still_counts_when_it_pays_after(self):
        # A quarterly CEF that went ex before the file and paid after it: the
        # file's price is already ex, its cash does not have the payment yet.
        result = self.calc([weekly(D(2026, 10, 20), D(2026, 11, 7), per_share=1.20)])
        self.assertEqual(result["value"], 120.0)

    def test_shares_bought_on_or_after_the_ex_date_are_not_paid(self):
        events = [weekly(D(2026, 11, 6), D(2026, 11, 7))]
        self.assertEqual(self.calc(events, purchase_date="2026-11-06")["value"], 0.0)
        self.assertEqual(self.calc(events, purchase_date="2026-11-05")["value"], 50.0)

    def test_no_baseline_or_no_shares_means_no_estimate(self):
        events = [weekly(D(2026, 11, 6), D(2026, 11, 7))]
        self.assertEqual(self.calc(events, as_of=None)["value"], 0.0)
        self.assertEqual(self.calc(events, quantity=0)["value"], 0.0)

    def test_reinvested_payments_buy_shares_valued_at_todays_price(self):
        closes = pd.Series(
            [10.0, 8.0, 9.0],
            index=pd.to_datetime(["2026-11-06", "2026-11-07", "2026-11-09"]),
        )
        result = self.calc(
            [
                weekly(D(2026, 11, 5), D(2026, 11, 6), per_share=1.00),
                weekly(D(2026, 11, 7), D(2026, 11, 7), per_share=1.00),
            ],
            is_drip=True,
            close_series=closes,
            current_price=9.0,
        )

        # $100 buys 10 shares at $10; the next distribution pays on 110 shares,
        # $110 buys 13.75 at $8. 23.75 shares at today's $9.
        self.assertAlmostEqual(result["drip_shares"], 23.75)
        self.assertAlmostEqual(result["value"], 213.75)
        self.assertEqual(result["cash"], 0.0)
        self.assertEqual(result["events"][1]["shares"], 110.0)
        self.assertEqual({e["kind"] for e in result["events"]}, {"drip"})

    def test_a_reported_payment_replaces_the_estimate_for_its_distribution(self):
        result = self.calc(
            [weekly(D(2026, 11, 5), D(2026, 11, 6))],
            broker_payments=[{"pay": "2026-11-07", "amount": 48.73}],
            match_days=3,
        )

        self.assertEqual(result["value"], 48.73)
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(result["events"][0]["source"], "broker")
        self.assertEqual(result["events"][0]["pay"], "2026-11-07")

    def test_a_reported_payment_with_no_event_still_counts(self):
        # Yahoo's history can miss a distribution the broker did pay.
        result = self.calc(
            [],
            broker_payments=[
                {"pay": "2026-11-06", "amount": 12.50},
                {"pay": "2026-11-05", "amount": 99.00},  # inside the file already
            ],
        )
        self.assertEqual(result["value"], 12.50)

    def test_stored_events_revalue_at_a_new_price(self):
        events = [
            {"kind": "cash", "amount": 40.0},
            {"kind": "drip", "drip_shares": 2.0, "reinvest_price": 10.0},
        ]
        self.assertEqual(_distribution_detail_value(events, 12.0), 64.0)
        self.assertEqual(_distribution_detail_value(events, None), 60.0)


class BaselineTest(unittest.TestCase):
    """The last day each broker figure already covers."""

    def test_broker_cash_is_as_of_the_file_not_the_import_moment(self):
        cash, shares = _distribution_baselines(
            {"broker_snapshot_date": "2026-11-05", "import_date": "2026-11-05"},
            {"cash_source": "schwab", "cash_updated_at": "2026-11-09T13:57:17"},
        )
        self.assertEqual(cash, FILE)
        self.assertEqual(shares, FILE)

    def test_hand_entered_cash_is_as_of_the_day_it_was_typed(self):
        cash, _ = _distribution_baselines(
            {"broker_snapshot_date": "2026-11-05", "import_date": "2026-11-05"},
            {"cash_source": "manual", "cash_updated_at": "2026-11-08T09:00:00"},
        )
        self.assertEqual(cash, D(2026, 11, 8))

    def test_no_cash_on_record_falls_back_to_the_file(self):
        cash, _ = _distribution_baselines({"import_date": "11/05/26"}, {})
        self.assertEqual(cash, FILE)

    def test_a_rolled_forward_count_covers_the_trades_it_applied(self):
        # The IB roll-forward advances import_date past the statement; the cash
        # is still the statement's.
        cash, shares = _distribution_baselines(
            {"broker_snapshot_date": "2026-08-31", "import_date": "2026-11-04"},
            {"cash_source": "interactive_brokers", "cash_updated_at": "2026-09-02T10:00:00"},
        )
        self.assertEqual(cash, D(2026, 8, 31))
        self.assertEqual(shares, D(2026, 11, 4))


class StoredEstimateTest(unittest.TestCase):
    """A newer file or cash figure absorbs the estimate; reads sum it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.tmp.name) / "distributions.db"
        conn = self._connect()
        ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        conn.execute(
            "INSERT INTO profiles (id, name, include_in_owner, positions_managed, cash_value,"
            " cash_source, cash_updated_at, owner_active)"
            " VALUES (1, 'Owner', 0, 0, 0, NULL, NULL, 1)"
        )
        conn.execute(
            "INSERT INTO profiles (id, name, include_in_owner, positions_managed, cash_value,"
            " cash_source, cash_updated_at) VALUES (6, 'Pressj04', 1, 1, 1000, 'schwab',"
            " '2026-11-05T13:57:17')"
        )
        conn.execute(
            "INSERT INTO profiles (id, name, include_in_owner, positions_managed, cash_value,"
            " cash_source, cash_updated_at) VALUES (7, 'Pressj05', 1, 1, 500, 'schwab',"
            " '2026-11-05T13:58:12')"
        )
        self._holding(conn, 6, "CASHY", 100, 20.0, "N", [
            {"ex": "2026-11-05", "pay": "2026-11-06", "kind": "cash", "amount": 50.0, "source": "estimate"},
            {"ex": "2026-11-08", "pay": "2026-11-09", "kind": "cash", "amount": 50.0, "source": "estimate"},
        ])
        self._holding(conn, 6, "DRIPPY", 100, 10.0, "Y", [
            {"ex": "2026-11-05", "pay": "2026-11-06", "kind": "drip", "amount": 30.0,
             "drip_shares": 3.0, "reinvest_price": 10.0, "source": "estimate"},
        ])
        self._holding(conn, 7, "OTHER", 50, 40.0, "N", [
            {"ex": "2026-11-06", "pay": "2026-11-07", "kind": "cash", "amount": 25.0, "source": "broker"},
        ])
        # Owner's rollup rows never carry the estimate; it reads the sources.
        conn.execute(
            "INSERT INTO all_account_info (ticker, profile_id, quantity, current_price, current_value)"
            " VALUES ('CASHY', 1, 100, 20.0, 2000), ('DRIPPY', 1, 100, 10.0, 1000),"
            " ('OTHER', 1, 50, 40.0, 2000)"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        self.tmp.cleanup()

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _holding(self, conn, pid, ticker, quantity, price, reinvest, events):
        detail = {"since": "2026-11-05", "events": events}
        conn.execute(
            """INSERT INTO all_account_info
                   (ticker, profile_id, quantity, current_price, current_value, reinvest,
                    import_date, broker_snapshot_date, dist_since_file_value,
                    dist_since_file_detail)
               VALUES (?, ?, ?, ?, ?, ?, '2026-11-05', '2026-11-05', ?, ?)""",
            (ticker, pid, quantity, price, quantity * price, reinvest,
             _distribution_detail_value(events, price), json.dumps(detail)),
        )

    def _value(self, conn, ticker, pid=6):
        return conn.execute(
            "SELECT dist_since_file_value, dist_since_file_detail FROM all_account_info"
            " WHERE ticker = ? AND profile_id = ?", (ticker, pid),
        ).fetchone()

    def test_summary_sums_each_account_and_names_the_shared_file_date(self):
        conn = self._connect()
        try:
            summary = _distributions_since_file_summary(conn, [6, 7])
        finally:
            conn.close()

        self.assertEqual(summary["value"], 155.0)
        self.assertEqual(summary["payments"], 4)
        self.assertEqual(summary["since"], "2026-11-05")
        by_account = {a["profile_id"]: a for a in summary["accounts"]}
        self.assertEqual(by_account[6]["value"], 130.0)
        self.assertEqual(by_account[6]["estimated"], 3)
        self.assertEqual(by_account[7]["estimated"], 0)

    def test_a_sold_holding_drops_out_of_the_total(self):
        conn = self._connect()
        try:
            conn.execute("UPDATE all_account_info SET quantity = 0 WHERE ticker = 'OTHER'")
            summary = _distributions_since_file_summary(conn, [6, 7])
        finally:
            conn.close()
        self.assertEqual(summary["value"], 130.0)

    def test_a_file_dated_today_absorbs_everything(self):
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE all_account_info SET import_date = '2026-11-09',"
                " broker_snapshot_date = '2026-11-09' WHERE profile_id = 6"
            )
            conn.execute(
                "UPDATE profiles SET cash_updated_at = '2026-11-09T14:00:00' WHERE id = 6"
            )
            _rebase_distributions_since_file(conn, 6)
            for ticker in ("CASHY", "DRIPPY"):
                row = self._value(conn, ticker)
                self.assertEqual(row["dist_since_file_value"], 0.0)
                self.assertIsNone(row["dist_since_file_detail"])
            # Another account is untouched.
            self.assertEqual(self._value(conn, "OTHER", 7)["dist_since_file_value"], 25.0)
        finally:
            conn.close()

    def test_an_older_file_keeps_what_paid_after_it(self):
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE all_account_info SET import_date = '2026-11-06',"
                " broker_snapshot_date = '2026-11-06' WHERE profile_id = 6"
            )
            conn.execute(
                "UPDATE profiles SET cash_updated_at = '2026-11-09T14:00:00' WHERE id = 6"
            )
            _rebase_distributions_since_file(conn, 6)
            row = self._value(conn, "CASHY")
            self.assertEqual(row["dist_since_file_value"], 50.0)
            detail = json.loads(row["dist_since_file_detail"])
            self.assertEqual([e["pay"] for e in detail["events"]], ["2026-11-09"])
            self.assertEqual(detail["since"], "2026-11-06")
            self.assertEqual(self._value(conn, "DRIPPY")["dist_since_file_value"], 0.0)
        finally:
            conn.close()

    def test_a_hand_entered_balance_absorbs_cash_but_not_reinvested_shares(self):
        conn = self._connect()
        try:
            _set_profile_cash_value(conn, 6, 1100.0, source="manual")
            self.assertEqual(self._value(conn, "CASHY")["dist_since_file_value"], 0.0)
            # The shares are still the file's, so their reinvestment still counts.
            self.assertEqual(self._value(conn, "DRIPPY")["dist_since_file_value"], 30.0)
        finally:
            conn.close()

    def test_nav_snapshot_carries_the_estimate_and_owner_reads_its_sources(self):
        original = normalize.get_connection
        normalize.get_connection = lambda: sqlite3.connect(self.db_path)
        try:
            self.assertEqual(normalize.snapshot_nav(6, nav_date="2026-11-09"), 4130.0)
            self.assertEqual(normalize.snapshot_nav(1, nav_date="2026-11-09"), 6655.0)
        finally:
            normalize.get_connection = original


class PortfolioValueEndpointTest(StoredEstimateTest):
    """The Portfolio Value box adds the estimate and says how much it added."""

    def setUp(self):
        super().setUp()
        self._orig_get_connection = app_module.get_connection
        self._orig_db_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._connect
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app._db_initialized = self._orig_db_initialized
        super().tearDown()

    def test_account_value_includes_distributions_since_import(self):
        payload = self.client.get("/api/portfolio-value?profile_id=6").get_json()

        self.assertEqual(payload["holdings_value"], 3000.0)
        self.assertEqual(payload["cash_value"], 1000.0)
        self.assertEqual(payload["broker_value"], 4000.0)
        self.assertEqual(payload["distributions_since_import"]["value"], 130.0)
        self.assertEqual(payload["account_value"], 4130.0)

    def test_owner_adds_the_estimate_from_its_source_accounts(self):
        payload = self.client.get("/api/portfolio-value?profile_id=1").get_json()

        self.assertEqual(payload["cash_value"], 1500.0)
        self.assertEqual(payload["distributions_since_import"]["value"], 155.0)
        self.assertEqual(payload["account_value"], 6655.0)

    def test_manage_portfolios_total_matches_the_box(self):
        payload = self.client.get("/api/profiles/summary").get_json()
        profiles = payload["profiles"] if isinstance(payload, dict) else payload
        by_id = {p["id"]: p for p in profiles}

        self.assertEqual(by_id[6]["distributions_since_import"], 130.0)
        self.assertEqual(by_id[6]["total_value"], 4130.0)


class RefreshWritesTheEstimateTest(unittest.TestCase):
    """The real market refresh, against a mocked Yahoo response."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.tmp.name) / "refresh.db"
        self.today = datetime.date.today()
        self.file_day = self.today - datetime.timedelta(days=7)
        conn = self._connect()
        ensure_tables_exist(conn)
        conn.execute(
            "INSERT INTO profiles (id, name, include_in_owner, positions_managed, cash_value,"
            " cash_source, cash_updated_at) VALUES (2, 'Schwab', 0, 1, 500, 'schwab', ?)",
            (f"{self.file_day.isoformat()}T13:00:00",),
        )
        conn.execute(
            "INSERT INTO profiles (id, name, include_in_owner, positions_managed)"
            " VALUES (3, 'Manual', 0, 0)"
        )
        for pid in (2, 3):
            conn.execute(
                """INSERT INTO all_account_info
                       (ticker, profile_id, description, quantity, base_quantity, price_paid,
                        purchase_value, current_price, current_value, purchase_date,
                        import_date, broker_snapshot_date, reinvest, div, div_frequency)
                   VALUES ('WKLY', ?, 'Test Income Fund', 100, 100, 20, 2000, 20, 2000,
                           '2025-01-02', ?, ?, 'N', 0.5, 'W')""",
                (pid, self.file_day.isoformat(), self.file_day.isoformat()),
            )
        conn.commit()
        conn.close()

        self._orig = {
            "get_connection": app_module.get_connection,
            "populate_holdings": app_module.populate_holdings,
            "populate_dividends": app_module.populate_dividends,
            "db_initialized": getattr(app_module.app, "_db_initialized", False),
        }
        app_module.get_connection = self._connect
        app_module.populate_holdings = lambda profile_id: None
        app_module.populate_dividends = lambda profile_id: None
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self._orig["get_connection"]
        app_module.populate_holdings = self._orig["populate_holdings"]
        app_module.populate_dividends = self._orig["populate_dividends"]
        app_module.app._db_initialized = self._orig["db_initialized"]
        self.tmp.cleanup()

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _refresh(self, profile_id, dividends=True):
        days = [self.today - datetime.timedelta(days=n) for n in (14, 5, 1)]
        frame = pd.DataFrame(
            {
                "Close": [20.0, 19.5, 19.0],
                "Dividends": [0.5, 0.5, 0.5] if dividends else [0.0, 0.0, 0.0],
            },
            index=pd.to_datetime([day.isoformat() for day in days]),
        )

        def pay_next_day(ex_div_date, *args, **kwargs):
            stamp = pd.Timestamp(ex_div_date) if ex_div_date else None
            return stamp + pd.Timedelta(days=1) if stamp is not None else None

        with (
            patch.object(app_module, "_chunked_yf_download", return_value=frame),
            patch.object(app_module, "_estimate_dividend_pay_from_pattern", side_effect=pay_next_day),
            patch.object(app_module, "_fetch_refresh_dividend_snapshot", return_value=None),
        ):
            response = self.client.post(f"/api/refresh?profile_id={profile_id}")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def _stored(self, profile_id):
        conn = self._connect()
        try:
            return conn.execute(
                "SELECT dist_since_file_value, dist_since_file_detail FROM all_account_info"
                " WHERE profile_id = ?", (profile_id,),
            ).fetchone()
        finally:
            conn.close()

    def test_a_broker_synced_holding_is_credited_for_payments_after_its_file(self):
        self._refresh(2)

        row = self._stored(2)
        # Two of the three went ex after the file and have paid; the first paid
        # a week before it. 0.50 x 100 shares each.
        self.assertEqual(row["dist_since_file_value"], 100.0)
        detail = json.loads(row["dist_since_file_detail"])
        self.assertEqual(detail["since"], self.file_day.isoformat())
        self.assertEqual(len(detail["events"]), 2)

        payload = self.client.get("/api/portfolio-value?profile_id=2").get_json()
        self.assertEqual(payload["distributions_since_import"]["value"], 100.0)
        self.assertEqual(payload["account_value"], round(100 * 19.0 + 500 + 100, 2))

    def test_a_manual_portfolio_gets_no_estimate(self):
        self._refresh(3)
        self.assertEqual(self._stored(3)["dist_since_file_value"], 0.0)

    def test_a_refresh_without_dividend_data_keeps_the_last_estimate(self):
        self._refresh(2)
        self._refresh(2, dividends=False)
        self.assertEqual(self._stored(2)["dist_since_file_value"], 100.0)


if __name__ == "__main__":
    unittest.main()
