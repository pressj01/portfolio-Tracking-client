import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module


class TrackerReturnAlignmentTest(unittest.TestCase):
    """Growth, Growth 2, and Total Return must report the same tracker TR%."""

    def setUp(self):
        # The production cache keys include DB mtimes. Temporary files created
        # within the same clock tick can otherwise reuse a prior test's payload.
        app_module._TOTAL_RETURN_DASHBOARD_CACHE.clear()
        app_module._TOTAL_RETURN_MARKET_SNAPSHOT_CACHE.clear()
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY, name TEXT, cash_value REAL DEFAULT 0
            );
            CREATE TABLE all_account_info (
                ticker TEXT, profile_id INTEGER, description TEXT,
                classification_type TEXT, quantity REAL, current_value REAL,
                purchase_value REAL, price_paid REAL, purchase_date TEXT,
                import_date TEXT
            );
            CREATE TABLE transactions (
                id INTEGER PRIMARY KEY, ticker TEXT, profile_id INTEGER,
                transaction_type TEXT, transaction_date TEXT, shares REAL,
                price_per_share REAL, fees REAL, realized_gain REAL, notes TEXT
            );
            CREATE TABLE dividend_payments (
                ticker TEXT, profile_id INTEGER, payment_date TEXT,
                amount REAL, source TEXT
            );
            CREATE TABLE categories (
                id INTEGER, name TEXT, profile_id INTEGER, sort_order INTEGER
            );
            CREATE TABLE subcategories (
                id INTEGER, category_id INTEGER, name TEXT, profile_id INTEGER,
                sort_order INTEGER
            );
            CREATE TABLE ticker_categories (
                ticker TEXT, profile_id INTEGER, category_id INTEGER,
                subcategory_id INTEGER
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO profiles (id, name, cash_value) VALUES (6, 'Test', 0);
            INSERT INTO all_account_info VALUES (
                'AAA', 6, 'Example', 'Stock', 2, 24, 20, 10, '2024-01-02', NULL
            );
            INSERT INTO transactions
                VALUES (1, 'AAA', 6, 'BUY', '2024-01-02', 2, 10, 0, 0, '');
            """
        )
        conn.commit()
        conn.close()

        dates = pd.to_datetime(["1972-01-03", "2024-01-02", "2024-12-31"])
        close = pd.DataFrame(
            {
                "AAA": [1.0, 10.0, 12.0],
                "BBB": [1.0, 20.0, 18.0],
                "SPY": [2.0, 100.0, 110.0],
            },
            index=dates,
        )
        adjusted = pd.DataFrame(
            {
                "AAA": [1.0, 10.0, 14.0],
                "BBB": [1.0, 20.0, 17.0],
                "SPY": [2.0, 100.0, 115.0],
            },
            index=dates,
        )
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        self.market_data = pd.concat({
            "Close": close,
            "Adj Close": adjusted,
            "Dividends": zeros,
            "Capital Gains": zeros,
            "Stock Splits": zeros,
        }, axis=1)

        self.orig_connection = app_module.get_connection
        self.orig_download = app_module._chunked_yf_download
        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module._chunked_yf_download = self._download
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._chunked_yf_download = self.orig_download
        app_module.app.testing = self.orig_testing
        app_module.app._db_initialized = self.orig_initialized
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _download(self, tickers, **kwargs):
        return self.market_data.copy()

    def test_tracker_total_return_pct_matches_across_growth_total_return_and_growth_2(self):
        params = "profile_id=6&period=all"
        growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY")
        growth_2 = self.client.get(f"/api/growth-2/data?{params}")
        total_return = self.client.get(f"/api/total-return/charts?{params}")

        self.assertEqual(growth.status_code, 200, growth.get_json())
        self.assertEqual(growth_2.status_code, 200, growth_2.get_json())
        self.assertEqual(total_return.status_code, 200, total_return.get_json())

        growth_pct = growth.get_json()["portfolio_metrics"]["total_return_pct"]
        growth_2_pct = growth_2.get_json()["summary"]["total_return_pct"]
        total_return_pct = total_return.get_json()["portfolio_metrics"]["total_return_pct"]
        growth_price = growth.get_json()["portfolio_metrics"]["price_return_pct"]
        total_return_price = total_return.get_json()["portfolio_metrics"]["price_return_pct"]

        self.assertEqual(growth_pct, 40.0)
        self.assertEqual(growth_pct, growth_2_pct)
        self.assertEqual(growth_pct, total_return_pct)
        self.assertEqual(growth_price, 20.0)
        self.assertEqual(growth_price, total_return_price)

        growth_dollar = growth.get_json()["portfolio_metrics"]["price_return_dollar"]
        total_return_dollar = total_return.get_json()["portfolio_metrics"]["price_return_dollar"]
        growth_2_dollar = growth_2.get_json()["summary"]["price_return_amount"]
        self.assertEqual(growth_dollar, total_return_dollar)
        self.assertEqual(growth_dollar, growth_2_dollar)

    def test_broker_payments_drive_every_tracker_return_measure(self):
        conn = self._get_connection()
        conn.executemany(
            "INSERT INTO dividend_payments VALUES (?, ?, ?, ?, ?)",
            [
                ("AAA", 6, "2024-12-31", 3.0, "schwab"),
                ("AAA", 6, "2024-12-31", 100.0, "refresh_estimate"),
            ],
        )
        conn.commit()
        conn.close()

        params = "profile_id=6&period=all"
        growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY")
        growth_dollars = self.client.get(f"/api/growth-2/data?{params}")
        total_return = self.client.get(f"/api/total-return/charts?{params}")

        self.assertEqual(growth.status_code, 200, growth.get_json())
        self.assertEqual(
            growth_dollars.status_code, 200, growth_dollars.get_json(),
        )
        self.assertEqual(total_return.status_code, 200, total_return.get_json())

        growth_data = growth.get_json()
        growth_dollars_data = growth_dollars.get_json()
        total_return_data = total_return.get_json()
        metrics = [
            growth_data["portfolio_metrics"],
            growth_dollars_data["summary"],
            total_return_data["portfolio_metrics"],
        ]
        for metric in metrics:
            distribution_key = (
                "distribution_amount"
                if "distribution_amount" in metric
                else "distribution_dollar"
            )
            self.assertEqual(metric[distribution_key], 3.0)
            self.assertEqual(metric["total_return_pct"], 35.0)
            self.assertIn("Broker payment history", metric["distribution_source"])

        self.assertEqual(growth_data["portfolio_total"]["values"][-1], 135.0)
        self.assertEqual(total_return_data["portfolio_series"]["total"][-1], 135.0)
        self.assertEqual(growth_data["ticker_returns"], [{
            "ticker": "AAA",
            "return_pct": 35.0,
        }])

    def test_payment_after_final_quote_is_in_every_tracker_series_and_percentage(self):
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO dividend_payments VALUES (?, ?, ?, ?, ?)",
            ("AAA", 6, "2025-01-04", 3.0, "schwab"),
        )
        conn.commit()
        conn.close()

        params = "profile_id=6&period=all"
        growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY").get_json()
        growth_dollars = self.client.get(f"/api/growth-2/data?{params}").get_json()
        total_return = self.client.get(f"/api/total-return/charts?{params}").get_json()

        self.assertEqual(growth["portfolio_total"]["values"][-1], 135.0)
        self.assertEqual(total_return["portfolio_series"]["total"][-1], 135.0)
        self.assertEqual(growth["portfolio_metrics"]["total_return_pct"], 35.0)
        self.assertEqual(total_return["portfolio_metrics"]["total_return_pct"], 35.0)
        self.assertEqual(growth_dollars["summary"]["total_return_pct"], 35.0)
        self.assertEqual(growth_dollars["summary"]["distribution_amount"], 3.0)

    def test_category_scope_matches_between_dashboard_growth_and_total_return(self):
        conn = self._get_connection()
        conn.executescript(
            """
            INSERT INTO all_account_info VALUES (
                'BBB', 6, 'Other', 'Stock', 1, 18, 20, 20, '2024-01-02', NULL
            );
            INSERT INTO transactions
                VALUES (2, 'BBB', 6, 'BUY', '2024-01-02', 1, 20, 0, 0, '');
            INSERT INTO categories VALUES (10, 'Core', 6, 0);
            INSERT INTO categories VALUES (20, 'Other', 6, 1);
            INSERT INTO ticker_categories VALUES ('AAA', 6, 10, NULL);
            INSERT INTO ticker_categories VALUES ('BBB', 6, 20, NULL);
            """
        )
        conn.commit()
        conn.close()

        params = "profile_id=6&period=all&category=10"
        dashboard = self.client.get(f"/api/total-return/charts?{params}")
        growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY")

        self.assertEqual(dashboard.status_code, 200, dashboard.get_json())
        self.assertEqual(growth.status_code, 200, growth.get_json())
        dashboard_metrics = dashboard.get_json()["portfolio_metrics"]
        growth_metrics = growth.get_json()["portfolio_metrics"]
        for key in (
            "start_value",
            "end_value",
            "price_return_dollar",
            "price_return_pct",
            "distribution_dollar",
            "total_return_dollar",
            "total_return_pct",
        ):
            self.assertEqual(dashboard_metrics[key], growth_metrics[key], key)
        self.assertEqual(
            [row["ticker"] for row in dashboard.get_json()["performance_rows"]],
            ["AAA"],
        )

    def test_open_position_price_return_matches_across_tracking_pages(self):
        conn = self._get_connection()
        conn.executescript(
            """
            INSERT INTO transactions
                VALUES (2, 'BBB', 6, 'BUY', '2024-01-02', 1, 20, 0, 0, '');
            INSERT INTO transactions
                VALUES (3, 'BBB', 6, 'SELL', '2024-12-31', 1, 18, 0, -2, '');
            """
        )
        conn.commit()
        conn.close()

        params = "profile_id=6&period=all"
        growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY")
        tracker = self.client.get(f"/api/total-return/charts?{params}")

        self.assertEqual(growth.status_code, 200, growth.get_json())
        self.assertEqual(tracker.status_code, 200, tracker.get_json())
        growth_open = growth.get_json()["open_position_metrics"]
        tracker_open = tracker.get_json()["open_position_metrics"]
        for key in (
            "start_value",
            "end_value",
            "price_return_dollar",
            "price_return_pct",
            "total_return_pct",
        ):
            self.assertEqual(growth_open[key], tracker_open[key], key)
        self.assertEqual(tracker_open["price_return_dollar"], 4.0)
        self.assertEqual(tracker_open["price_return_pct"], 20.0)
        self.assertNotEqual(
            tracker.get_json()["portfolio_metrics"]["price_return_dollar"],
            tracker_open["price_return_dollar"],
        )

    def _seed_owner_with_two_accounts(self, second_aaa_buy=("2024-01-02", 10)):
        # AAA is held in both accounts; only account 6 has broker payment
        # history for it, so account 7's cash comes from Yahoo's distribution
        # history ($0.50 a share). BBB is held in account 7 only; account 6
        # was paid on it and has since sold out.
        self.market_data.loc[pd.Timestamp("2024-12-31"), ("Dividends", "AAA")] = 0.5
        buy_date, buy_price = second_aaa_buy
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO all_account_info VALUES "
            "('AAA', 7, 'Example', 'Stock', 4, 48, ?, ?, ?, NULL)",
            (4 * buy_price, buy_price, buy_date),
        )
        conn.execute(
            "INSERT INTO transactions VALUES (2, 'AAA', 7, 'BUY', ?, 4, ?, 0, 0, '')",
            (buy_date, buy_price),
        )
        conn.executescript(
            """
            ALTER TABLE profiles ADD COLUMN include_in_owner INTEGER DEFAULT 0;
            UPDATE profiles SET include_in_owner = 1 WHERE id = 6;
            INSERT INTO profiles (id, name, cash_value, include_in_owner)
                VALUES (1, 'Owner', 0, 0);
            INSERT INTO profiles (id, name, cash_value, include_in_owner)
                VALUES (7, 'Second', 0, 1);
            INSERT INTO all_account_info VALUES (
                'BBB', 7, 'Other', 'Stock', 1, 18, 20, 20, '2024-01-02', NULL
            );
            INSERT INTO all_account_info VALUES (
                'AAA', 1, 'Example', 'Stock', 6, 72, 60, 10, '2024-01-02', NULL
            );
            INSERT INTO all_account_info VALUES (
                'BBB', 1, 'Other', 'Stock', 1, 18, 20, 20, '2024-01-02', NULL
            );
            INSERT INTO transactions
                VALUES (3, 'BBB', 7, 'BUY', '2024-01-02', 1, 20, 0, 0, '');
            INSERT INTO transactions
                VALUES (4, 'BBB', 6, 'BUY', '2024-01-02', 1, 20, 0, 0, '');
            INSERT INTO transactions
                VALUES (5, 'BBB', 6, 'SELL', '2024-12-31', 1, 18, 0, -2, '');
            INSERT INTO dividend_payments
                VALUES ('AAA', 6, '2024-06-28', 3.0, 'schwab');
            INSERT INTO dividend_payments
                VALUES ('BBB', 6, '2024-03-28', 1.25, 'schwab');
            """
        )
        conn.commit()
        conn.close()

    def test_owner_distributions_are_its_accounts_added_up(self):
        # Broker history or Yahoo history used to be chosen once per ticker for
        # the whole view. Account 6's AAA payments switched the Yahoo fallback
        # off for account 7's AAA shares, and account 6's BBB cash landed on
        # the row for the BBB share only account 7 holds.
        self._seed_owner_with_two_accounts()

        def charts(profile_id):
            res = self.client.get(f"/api/total-return/charts?profile_id={profile_id}&period=all")
            self.assertEqual(res.status_code, 200, res.get_json())
            return res.get_json()

        def dollars(profile_id):
            res = self.client.get(f"/api/growth-2/data?profile_id={profile_id}&period=all")
            self.assertEqual(res.status_code, 200, res.get_json())
            return res.get_json()["summary"]["distribution_amount"]

        def growth(profile_id):
            res = self.client.get(
                f"/api/growth/data?profile_id={profile_id}&period=all&benchmark=SPY"
            )
            self.assertEqual(res.status_code, 200, res.get_json())
            return res.get_json()["portfolio_metrics"]

        owner, first, second = charts(1), charts(6), charts(7)
        rows = lambda payload: {row["ticker"]: row for row in payload["performance_rows"]}

        self.assertEqual(rows(first)["AAA"]["distribution_dollar"], 3.0)
        self.assertEqual(rows(second)["AAA"]["distribution_dollar"], 2.0)
        self.assertEqual(rows(owner)["AAA"]["distribution_dollar"], 5.0)
        self.assertEqual(rows(second)["BBB"]["distribution_dollar"], 0.0)
        self.assertEqual(rows(owner)["BBB"]["distribution_dollar"], 0.0)
        # Still BBB's cash for the range, kept for the by-ticker table.
        self.assertEqual(rows(owner)["BBB"]["closed_account_distribution_dollar"], 1.25)
        self.assertEqual(rows(first)["AAA"]["closed_account_distribution_dollar"], 0.0)
        for block in ("portfolio_metrics", "open_position_metrics"):
            self.assertAlmostEqual(
                owner[block]["distribution_dollar"],
                first[block]["distribution_dollar"] + second[block]["distribution_dollar"],
                places=4,
                msg=block,
            )
        self.assertEqual(owner["open_position_metrics"]["distribution_dollar"], 5.0)
        self.assertEqual(owner["portfolio_metrics"]["distribution_dollar"], 6.25)
        self.assertAlmostEqual(dollars(1), dollars(6) + dollars(7), places=2)
        self.assertAlmostEqual(dollars(1), 6.25, places=2)
        owner_growth, first_growth, second_growth = growth(1), growth(6), growth(7)
        for key in ("distribution_dollar", "total_return_dollar"):
            self.assertAlmostEqual(
                owner_growth[key],
                first_growth[key] + second_growth[key],
                places=4,
                msg=key,
            )
        self.assertEqual(
            owner_growth["distribution_dollar"],
            owner["portfolio_metrics"]["distribution_dollar"],
        )
        self.assertEqual(
            owner_growth["total_return_pct"],
            owner["portfolio_metrics"]["total_return_pct"],
        )

    def test_owner_start_value_adds_up_accounts_that_opened_on_different_days(self):
        # Account 6 held AAA all year; account 7 bought it in June. Replayed
        # together the row started in January on account 6's shares alone and
        # counted account 7's purchase as money added later, so Owner's Start
        # Value was $20 against the $20 + $44 the two accounts show.
        dates = pd.to_datetime(["1972-01-03", "2024-01-02", "2024-06-28", "2024-12-31"])
        close = pd.DataFrame(
            {
                "AAA": [1.0, 10.0, 11.0, 12.0],
                "BBB": [1.0, 20.0, 19.0, 18.0],
                "SPY": [2.0, 100.0, 105.0, 110.0],
            },
            index=dates,
        )
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        self.market_data = pd.concat({
            "Close": close,
            "Adj Close": close,
            "Dividends": zeros,
            "Capital Gains": zeros,
            "Stock Splits": zeros,
        }, axis=1)
        self._seed_owner_with_two_accounts(second_aaa_buy=("2024-06-28", 11))

        def aaa_row(profile_id):
            res = self.client.get(f"/api/total-return/charts?profile_id={profile_id}&period=all")
            self.assertEqual(res.status_code, 200, res.get_json())
            return next(row for row in res.get_json()["performance_rows"] if row["ticker"] == "AAA")

        owner, first, second = aaa_row(1), aaa_row(6), aaa_row(7)

        self.assertEqual(first["start_value"], 20.0)
        self.assertEqual(second["start_value"], 44.0)
        self.assertEqual(owner["start_value"], 64.0)
        for key in ("end_value", "price_return_dollar", "distribution_dollar", "total_return_dollar"):
            self.assertAlmostEqual(owner[key], first[key] + second[key], places=4, msg=key)

    def test_owner_price_return_adds_up_when_one_account_runs_short_of_shares(self):
        # Account 6's AAA ledger sells three shares against the two it holds
        # and buys them back a month later; account 7 holds four throughout.
        # Account 6's own replay leaves its negative balance out. Owner's
        # netted it against account 7's shares first and valued three for that
        # month, so its price return read $39 against the $10 + $32 its
        # accounts show. With broker cash on record the total return was worse:
        # four shares' ending value over three shares' starting value, a gain
        # nobody earned, compounded into the index (237.78% against 90%).
        self._market(
            ["2024-01-02", "2024-03-01", "2024-03-15", "2024-04-01", "2024-12-31"],
            [10.0, 12.0, 16.0, 15.0, 18.0],
        )
        conn = self._get_connection()
        conn.executescript(
            """
            ALTER TABLE profiles ADD COLUMN include_in_owner INTEGER DEFAULT 0;
            UPDATE profiles SET include_in_owner = 1 WHERE id = 6;
            INSERT INTO profiles (id, name, cash_value, include_in_owner)
                VALUES (1, 'Owner', 0, 0);
            INSERT INTO profiles (id, name, cash_value, include_in_owner)
                VALUES (7, 'Second', 0, 1);
            INSERT INTO all_account_info VALUES (
                'AAA', 7, 'Example', 'Stock', 4, 72, 40, 10, '2024-01-02', NULL
            );
            INSERT INTO all_account_info VALUES (
                'AAA', 1, 'Example', 'Stock', 6, 108, 60, 10, '2024-01-02', NULL
            );
            INSERT INTO transactions
                VALUES (2, 'AAA', 6, 'SELL', '2024-03-01', 3, 12, 0, 0, '');
            INSERT INTO transactions
                VALUES (3, 'AAA', 6, 'BUY', '2024-04-01', 3, 15, 0, 0, '');
            INSERT INTO transactions
                VALUES (4, 'AAA', 7, 'BUY', '2024-01-02', 4, 10, 0, 0, '');
            INSERT INTO dividend_payments
                VALUES ('AAA', 7, '2024-12-31', 6.0, 'schwab');
            """
        )
        conn.commit()
        conn.close()

        def figures(profile_id):
            params = f"profile_id={profile_id}&period=all"
            charts = self.client.get(f"/api/total-return/charts?{params}")
            growth = self.client.get(f"/api/growth/data?{params}&benchmark=SPY")
            dollars = self.client.get(f"/api/growth-2/data?{params}")
            for response in (charts, growth, dollars):
                self.assertEqual(response.status_code, 200, response.get_json())
            return (
                charts.get_json()["portfolio_metrics"],
                growth.get_json()["portfolio_metrics"],
                dollars.get_json()["summary"],
            )

        owner, first, second = figures(1), figures(6), figures(7)

        for page, name in ((0, "Total Return"), (1, "Growth")):
            # An account's own figures are what they were before.
            self.assertEqual(first[page]["price_return_dollar"], 10.0, name)
            self.assertEqual(second[page]["price_return_dollar"], 32.0, name)
            self.assertEqual(first[page]["total_return_pct"], 44.0, name)
            self.assertEqual(second[page]["total_return_pct"], 95.0, name)
            self.assertEqual(owner[page]["price_return_dollar"], 42.0, name)
            for key in ("price_return_dollar", "distribution_dollar", "total_return_dollar", "end_value"):
                self.assertAlmostEqual(
                    owner[page][key],
                    first[page][key] + second[page][key],
                    places=4,
                    msg=f"{name} {key}",
                )
            # AAA went from $10 to $18 and the $6 landed on a $90 day at an
            # index of 150: 80 points of price and 10 of cash.
            self.assertEqual(owner[page]["price_return_pct"], 80.0, name)
            self.assertEqual(owner[page]["total_return_pct"], 90.0, name)
        self.assertEqual(first[2]["price_return_amount"], 10.0)
        self.assertEqual(second[2]["price_return_amount"], 32.0)
        self.assertEqual(owner[2]["price_return_amount"], 42.0)
        self.assertEqual(owner[2]["total_return_pct"], 90.0)

    def _market(self, dates, aaa):
        dates = pd.to_datetime(dates)
        close = pd.DataFrame({
            "AAA": aaa,
            "BBB": [20.0] * len(dates),
            "SPY": [100.0 + step for step in range(len(dates))],
        }, index=dates)
        zeros = pd.DataFrame(0.0, index=dates, columns=close.columns)
        self.market_data = pd.concat({
            "Close": close,
            "Adj Close": close,
            "Dividends": zeros,
            "Capital Gains": zeros,
            "Stock Splits": zeros,
        }, axis=1)

    def _distribution_figures(self):
        charts = self.client.get("/api/total-return/charts?profile_id=6&period=all")
        growth = self.client.get("/api/growth/data?profile_id=6&period=all&benchmark=SPY")
        dollars = self.client.get("/api/growth-2/data?profile_id=6&period=all")
        for response in (charts, growth, dollars):
            self.assertEqual(response.status_code, 200, response.get_json())
        return charts.get_json(), growth.get_json(), dollars.get_json()

    def test_cash_paid_before_a_rebuy_stays_on_the_row_and_in_its_itemization(self):
        # AAA was sold in March and bought back in June. The replay follows the
        # lot held now, so on the day the first cycle's $3 posted it held
        # nothing, and the engine counted recorded cash only on days with a
        # balance: the row read $4 while its own payment list said the row
        # total was $7.
        self._market(
            ["1972-01-03", "2024-01-02", "2024-02-15", "2024-03-01",
             "2024-06-03", "2024-09-16", "2024-12-31"],
            [1.0, 10.0, 10.5, 11.0, 11.0, 11.5, 12.0],
        )
        conn = self._get_connection()
        conn.executescript(
            """
            ALTER TABLE dividend_payments ADD COLUMN id INTEGER;
            ALTER TABLE dividend_payments ADD COLUMN notes TEXT;
            UPDATE all_account_info SET purchase_date = '2024-06-03' WHERE ticker = 'AAA';
            INSERT INTO transactions VALUES (2, 'AAA', 6, 'SELL', '2024-03-01', 2, 11, 0, 2, '');
            INSERT INTO transactions VALUES (3, 'AAA', 6, 'BUY', '2024-06-03', 2, 11, 0, 0, '');
            INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source)
                VALUES ('AAA', 6, '2024-02-15', 3.0, 'schwab');
            INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source)
                VALUES ('AAA', 6, '2024-09-16', 4.0, 'schwab');
            """
        )
        conn.commit()
        conn.close()

        charts, growth, dollars = self._distribution_figures()
        itemized = self.client.get(
            "/api/total-return/distributions/AAA?profile_id=6&period=all&view=open"
        ).get_json()
        row = next(item for item in charts["performance_rows"] if item["ticker"] == "AAA")

        self.assertEqual(itemized["counted_total"], 7.0)
        self.assertEqual(row["distribution_dollar"], 7.0)
        self.assertEqual(charts["open_position_metrics"]["distribution_dollar"], 7.0)
        self.assertEqual(growth["portfolio_metrics"]["distribution_dollar"], 7.0)
        self.assertEqual(dollars["summary"]["distribution_amount"], 7.0)

    def test_a_dividend_paid_after_the_last_share_was_sold_is_counted_everywhere(self):
        # BBB was sold on 03-01 and paid its last dividend on 03-15. Total
        # Return adds up one replay per ticker, and BBB's held nothing that
        # day, so its card read $0.00 where Growth, replaying the whole
        # portfolio with AAA still in it, read $1.25.
        self._market(
            ["1972-01-03", "2024-01-02", "2024-03-01", "2024-03-15", "2024-12-31"],
            [1.0, 10.0, 11.0, 11.0, 12.0],
        )
        conn = self._get_connection()
        conn.executescript(
            """
            INSERT INTO transactions VALUES (2, 'BBB', 6, 'BUY', '2024-01-02', 1, 20, 0, 0, '');
            INSERT INTO transactions VALUES (3, 'BBB', 6, 'SELL', '2024-03-01', 1, 20, 0, 0, '');
            INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source)
                VALUES ('BBB', 6, '2024-03-15', 1.25, 'schwab');
            """
        )
        conn.commit()
        conn.close()

        charts, growth, dollars = self._distribution_figures()

        self.assertEqual(charts["portfolio_metrics"]["distribution_dollar"], 1.25)
        self.assertEqual(growth["portfolio_metrics"]["distribution_dollar"], 1.25)
        self.assertEqual(dollars["summary"]["distribution_amount"], 1.25)
        self.assertEqual(
            charts["portfolio_metrics"]["total_return_dollar"],
            growth["portfolio_metrics"]["total_return_dollar"],
        )

    def test_cash_on_a_closed_ticker_that_cannot_be_priced_matches_growth(self):
        # GONE was sold and has since been delisted, so no screen can price
        # it. Its recorded dividend is still income for the range. Total
        # Return added up one replay per ticker and GONE has none, so its
        # all-positions card left the cash out while Growth counted it.
        conn = self._get_connection()
        conn.executescript(
            """
            INSERT INTO transactions VALUES (2, 'GONE', 6, 'BUY', '2024-01-02', 5, 4, 0, 0, '');
            INSERT INTO transactions VALUES (3, 'GONE', 6, 'SELL', '2024-06-03', 5, 4, 0, 0, '');
            INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source)
                VALUES ('GONE', 6, '2024-03-15', 2.5, 'schwab');
            """
        )
        conn.commit()
        conn.close()

        charts, growth, dollars = self._distribution_figures()

        self.assertEqual(growth["portfolio_metrics"]["distribution_dollar"], 2.5)
        self.assertEqual(charts["portfolio_metrics"]["distribution_dollar"], 2.5)
        self.assertEqual(dollars["summary"]["distribution_amount"], 2.5)
        self.assertEqual(
            charts["portfolio_metrics"]["total_return_dollar"],
            growth["portfolio_metrics"]["total_return_dollar"],
        )

    def test_open_row_itemization_leaves_out_an_account_that_sold_out(self):
        self._seed_owner_with_two_accounts()
        conn = self._get_connection()
        # The itemization reads two columns this fixture's ledger leaves out.
        conn.executescript(
            """
            ALTER TABLE dividend_payments ADD COLUMN id INTEGER;
            ALTER TABLE dividend_payments ADD COLUMN notes TEXT;
            """
        )
        conn.commit()
        conn.close()

        everything = self.client.get(
            "/api/total-return/distributions/BBB?profile_id=1&period=all"
        ).get_json()
        open_row = self.client.get(
            "/api/total-return/distributions/BBB?profile_id=1&period=all&view=open"
        ).get_json()

        self.assertEqual(everything["counted_total"], 1.25)
        self.assertEqual(open_row["counted_total"], 0)
        self.assertEqual(open_row["excluded_total"], 1.25)
        self.assertEqual(
            open_row["payments"][0]["excluded_reason"],
            "paid to Test, which no longer holds BBB",
        )

    def test_itemization_names_the_yahoo_fallback_behind_the_clicked_row(self):
        response = self.client.get(
            "/api/total-return/distributions/AAA?profile_id=6&period=all&view=open"
            "&row_total=2.5&row_source=Yahoo%20market%20history"
        )

        self.assertEqual(response.status_code, 200, response.get_json())
        payload = response.get_json()
        self.assertEqual(payload["recorded_counted_total"], 0)
        self.assertEqual(payload["estimated_total"], 2.5)
        self.assertEqual(payload["counted_total"], 2.5)
        estimate = next(row for row in payload["payments"] if row.get("estimated"))
        self.assertEqual(estimate["amount"], 2.5)
        self.assertEqual(estimate["source"], "Yahoo market history estimate")
        self.assertTrue(estimate["counted"])

    def test_portfolio_tester_actual_history_reuses_tracker_total_return(self):
        history = app_module._portfolio_tester_actual_history(
            [6],
            "2024-01-02",
            "2024-12-31",
            selected_tickers=["AAA"],
        )
        tracker = self.client.get(
            "/api/total-return/charts?profile_id=6&period=custom"
            "&start_date=2024-01-02&end_date=2024-12-31"
        )

        self.assertEqual(tracker.status_code, 200, tracker.get_json())
        self.assertEqual(
            history["metrics"]["total_return_pct"],
            tracker.get_json()["portfolio_metrics"]["total_return_pct"],
        )
        self.assertEqual(history["actual_start_date"], "2024-01-02")
        self.assertEqual(history["actual_end_date"], "2024-12-31")
        self.assertAlmostEqual(history["values"][0], 100.0)
        self.assertAlmostEqual(history["values"][-1], 140.0)
        self.assertEqual(history["scope"], "selected_holdings")
        self.assertEqual(history["selected_tickers"], ["AAA"])

    def test_portfolio_tester_route_aligns_hypothetical_to_actual_coverage(self):
        history = {
            "dates": ["2024-03-01", "2024-12-31"],
            "values": [100.0, 120.0],
            "actual_start_date": "2024-03-01",
            "actual_end_date": "2024-12-31",
            "metrics": {"total_return_pct": 20.0},
        }
        run_result = {"valid": True, "portfolios": []}
        with patch.object(
            app_module,
            "_portfolio_tester_actual_history",
            return_value=history,
        ) as actual_history, patch("portfolio_tester.run_backtest", return_value=run_result) as run:
            response = self.client.post(
                "/api/portfolio-tester/run?profile_id=6",
                json={
                    "portfolios": [
                        {
                            "name": "Actual",
                            "source": "actual",
                            "holdings": [],
                            "actual_tickers": ["AAA"],
                        },
                        {
                            "name": "Alternative",
                            "source": "hypothetical",
                            "holdings": [{"ticker": "SPY", "weight": 1.0}],
                        },
                    ],
                    "start": "2024-01-01",
                    "end": "2024-12-31",
                    "initial": 10000,
                    "include_div": True,
                    "reinvest_div": True,
                    "include_benchmark": False,
                },
            )

        self.assertEqual(response.status_code, 200, response.get_json())
        kwargs = run.call_args.kwargs
        self.assertEqual(kwargs["start"], "2024-03-01")
        self.assertEqual(kwargs["end"], "2024-12-31")
        self.assertEqual(kwargs["portfolios"][0]["history"], history)
        self.assertEqual(response.get_json()["requested_start"], "2024-01-01")
        self.assertEqual(actual_history.call_args.kwargs["selected_tickers"], ["AAA"])


if __name__ == "__main__":
    unittest.main()
