"""Charles Schwab All-Accounts positions import.

One export carries every account the user holds at Schwab, so these cover the
two halves of the feature: splitting the file into account blocks whatever the
accounts are called, and routing each block to its own portfolio.
"""

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
import config
import database
from transaction_import import parse_schwab_all_accounts_csv, parse_schwab_csv

COLUMNS = (
    '"Symbol","Description","Qty (Quantity)","Cost/Share","Price","Prev Close",'
    '"Price Chng $ (Price Change $)","Price Chng % (Price Change %)","Mkt Val (Market Value)",'
    '"Day Chng $ (Day Change $)","Day Chng % (Day Change %)","Gain $ (Gain/Loss $)",'
    '"Gain % (Gain/Loss %)","Ratings","Reinvest?","Reinvest Capital Gains?",'
    '"% of Acct (% of Account)","Ex-Div (Ex-Dividend Date)","Last Div (Last Dividend)",'
    '"Div Pay Date","Div Yld (Dividend Yield)","Asset Type",'
)


def position_row(ticker, qty, cost_share, price, asset_type="Equity", reinvest="No"):
    value = round(qty * price, 2)
    basis = round(qty * cost_share, 2)
    return (
        f'"{ticker}","{ticker} FUND","{qty}","${cost_share:.2f}","{price}","{price}",'
        f'"0.00","0%","${value:,.2f}","$0.00","0%","${value - basis:,.2f}","0%","-",'
        f'"{reinvest}","N/A","1%","N/A","N/A","N/A","5%","{asset_type}",'
    )


def option_row(symbol, qty, market_value):
    return (
        f'"{symbol}","CALL SOMETHING","{qty}","$1.00","1.00","1.00","0.00","0%",'
        f'"${market_value:,.2f}","$0.00","0%","$0.00","0%","-","N/A","N/A","0%",'
        f'"N/A","--","N/A","--","Option",'
    )


def cash_row(amount):
    return (
        f'"Cash & Cash Investments","--","--","--","--","--","--","--","${amount:,.2f}",'
        '"$0.00","0%","--","--","--","--","--","1%","--","--","--","--","Cash and Money Market",'
    )


def total_row(amount):
    return (
        f'"Positions Total","","--","--","--","--","--","--","${amount:,.2f}","$0.00","0%",'
        '"$0.00","0%","--","--","--","--","--","--","--","--","--",'
    )


def build_export(accounts, title="Positions for All-Accounts as of 04:46 PM ET, 08/18/2026"):
    """Render a Schwab All-Accounts CSV from {label: [rows]} blocks."""
    lines = [f'"{title}"', ""]
    for label, rows in accounts:
        lines.append(label)
        lines.append(COLUMNS)
        lines.extend(rows)
        lines.append("")
        lines.append("")
    return "\n".join(lines)


class SchwabAllAccountsParserTest(unittest.TestCase):
    """Splitting one export into per-account blocks."""

    def parse(self, content, name="All-Accounts-Positions.csv"):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / name
            path.write_text(content, encoding="utf-8")
            return parse_schwab_all_accounts_csv(str(path), path.name)

    def test_splits_every_account_into_its_own_block(self):
        content = build_export([
            ("Roth_IRA ...995", [position_row("SPYI", 10, 50.0, 54.0), cash_row(75.22), total_row(615.22)]),
            ("Individual ...730", [position_row("ARCC", 20, 19.0, 19.7), cash_row(100.0), total_row(494.0)]),
            ("Joint Tenant ...111", [position_row("JNJ", 5, 120.0, 271.05), cash_row(0.0), total_row(1355.25)]),
        ])
        result = self.parse(content)

        self.assertEqual(result["format_type"], "positions_multi")
        self.assertEqual(result["summary"]["accounts"], 3)
        self.assertEqual(
            [(a["account_name"], a["account_number"]) for a in result["accounts"]],
            [("Roth_IRA", "995"), ("Individual", "730"), ("Joint Tenant", "111")],
        )
        self.assertEqual(
            [a["positions"][0]["ticker"] for a in result["accounts"]],
            ["SPYI", "ARCC", "JNJ"],
        )

    def test_holdings_and_cash_stay_with_their_own_account(self):
        content = build_export([
            ("IRA ...426", [position_row("SPYI", 10, 50.0, 54.0), cash_row(500.0), total_row(1040.0)]),
            ("Roth ...995", [position_row("QQQI", 4, 40.0, 55.0), cash_row(25.0), total_row(245.0)]),
        ])
        result = self.parse(content)

        first, second = result["accounts"]
        self.assertEqual(first["summary"]["cash"], 500.0)
        self.assertEqual(first["summary"]["account_value"], 1040.0)
        self.assertEqual(second["summary"]["cash"], 25.0)
        self.assertEqual(second["summary"]["account_value"], 245.0)
        self.assertEqual(result["summary"]["cash"], 525.0)

    def test_account_value_reconciles_against_schwab_total_through_options(self):
        # Schwab's own Positions Total counts open options; holdings do not, so
        # the difference has to be reported rather than silently swallowed.
        content = build_export([
            ("Trading ...730", [
                position_row("ARCC", 100, 19.0, 20.0),
                option_row("PEP 09/18/2026 150.00 C", -1, -60.0),
                option_row("PEP 09/18/2026 160.00 C", 1, 22.0),
                cash_row(500.0),
                total_row(2462.0),
            ]),
        ])
        account = self.parse(content)["accounts"][0]

        self.assertEqual(account["summary"]["holdings"], 1)
        self.assertEqual(account["summary"]["options"], 2)
        self.assertEqual(account["summary"]["options_value"], -38.0)
        self.assertEqual(account["summary"]["account_value"], 2500.0)
        self.assertEqual(
            round(account["summary"]["account_value"] + account["summary"]["options_value"], 2),
            account["summary"]["reported_total"],
        )

    def test_reads_the_account_types_people_actually_hold(self):
        labels = [
            "Individual ...100",
            "Roth Contributory IRA ...200",
            "Rollover IRA ...300",
            "SEP-IRA ...400",
            "Custodial ...500",
            "Doe Family Trust, Jane Doe ...600",
            "Designated Beneficiary Plan XXXX-700",
        ]
        content = build_export([
            (label, [position_row("SPYI", 1, 50.0, 54.0), cash_row(1.0), total_row(55.0)])
            for label in labels
        ])
        result = self.parse(content)

        self.assertEqual(result["summary"]["accounts"], len(labels))
        self.assertEqual(
            [a["account_number"] for a in result["accounts"]],
            ["100", "200", "300", "400", "500", "600", "700"],
        )
        self.assertEqual(
            result["accounts"][5]["account_name"], "Doe Family Trust, Jane Doe"
        )

    def test_keeps_a_cash_only_account(self):
        content = build_export([
            ("Bank ...111", [cash_row(2500.0), total_row(2500.0)]),
            ("Brokerage ...222", [position_row("SPYI", 10, 50.0, 54.0), cash_row(0.0), total_row(540.0)]),
        ])
        result = self.parse(content)

        self.assertEqual(result["summary"]["accounts"], 2)
        self.assertEqual(result["accounts"][0]["summary"]["holdings"], 0)
        self.assertEqual(result["accounts"][0]["summary"]["cash"], 2500.0)

    def test_reads_the_as_of_date_from_the_title(self):
        content = build_export([
            ("IRA ...426", [position_row("SPYI", 10, 50.0, 54.0), cash_row(0.0), total_row(540.0)]),
        ])
        self.assertEqual(self.parse(content)["as_of"], "2026-08-18")

    def test_trailing_disclaimer_is_not_read_as_an_account(self):
        content = build_export([
            ("IRA ...426", [position_row("SPYI", 10, 50.0, 54.0), cash_row(0.0), total_row(540.0)]),
        ])
        content += '\n"Important: The data and information in this report is provided as-is."\n'

        self.assertEqual(self.parse(content)["summary"]["accounts"], 1)

    def test_single_account_file_points_at_the_single_account_format(self):
        content = "\n".join([
            '"Positions for Roth_IRA ...995 as of 04:46 PM ET, 08/18/2026"',
            "",
            COLUMNS,
            position_row("SPYI", 10, 50.0, 54.0),
            cash_row(0.0),
            total_row(540.0),
        ])
        with self.assertRaises(ValueError) as ctx:
            self.parse(content)
        self.assertIn("Charles Schwab (Positions)", str(ctx.exception))

    def test_single_account_parser_points_all_accounts_file_at_the_multi_format(self):
        content = build_export([
            ("Roth_IRA ...995", [position_row("SPYI", 10, 50.0, 54.0), cash_row(0.0), total_row(540.0)]),
            ("Individual ...730", [position_row("ARCC", 20, 19.0, 19.7), cash_row(0.0), total_row(394.0)]),
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "All-Accounts-Positions.csv"
            path.write_text(content, encoding="utf-8")
            with self.assertRaises(ValueError) as ctx:
                parse_schwab_csv(str(path), path.name)
        self.assertIn("All Accounts Positions", str(ctx.exception))

    def test_single_account_parser_accepts_one_account_all_accounts_export(self):
        content = build_export([
            ("Roth_IRA ...995", [
                position_row("SPYI", 10, 50.0, 54.0),
                cash_row(75.22),
                total_row(615.22),
            ]),
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "All-Accounts-Positions-2026-08-21-141808.csv"
            path.write_text(content, encoding="utf-8")
            result = parse_schwab_csv(str(path), path.name)

        self.assertEqual(result["format_type"], "positions")
        self.assertEqual(result["summary"]["holdings"], 1)
        self.assertEqual(result["positions"][0]["ticker"], "SPYI")
        self.assertEqual(result["summary"]["account_value"], 615.22)

    def test_merges_split_lots_and_comma_quantities(self):
        lots = (
            '"KYLD","KURV HIGH INCOME ETF","112,967","$23.66","21.15","21.15","0.00","0%",'
            '"$2,389.25","$0.00","0%","$0.00","0%","--","No","N/A","1%","N/A","N/A","N/A","5%","ETFs & Closed End Funds",'
        )
        second = (
            '"KYLD","KURV HIGH INCOME ETF","50","$23.66","21.15","21.15","0.00","0%",'
            '"$1,057.50","$0.00","0%","$0.00","0%","--","No","N/A","1%","N/A","N/A","N/A","5%","ETFs & Closed End Funds",'
        )
        content = build_export([
            ("pressj04 ...730", [lots, second, cash_row(0.0), total_row(3446.75)]),
        ])
        account = self.parse(content)["accounts"][0]
        self.assertEqual(account["account_name"], "pressj04")
        self.assertEqual(len(account["positions"]), 1)
        self.assertEqual(account["positions"][0]["ticker"], "KYLD")
        self.assertEqual(account["positions"][0]["quantity"], 113017.0)

    def test_parses_local_aug_18_export_when_present(self):
        path = Path(r"C:\Schwab\All Account\Aug 18\All-Accounts-Positions-2026-08-18-164611.csv")
        if not path.exists():
            self.skipTest("local Schwab All-Accounts export not present")
        result = parse_schwab_all_accounts_csv(str(path), path.name)
        self.assertEqual(result["as_of"], "2026-08-18")
        self.assertEqual(
            [(a["account_name"], a["account_number"], a["summary"]["holdings"]) for a in result["accounts"]],
            [
                ("Standard_IRA", "426", 48),
                ("Roth_IRA", "995", 21),
                ("pressj04", "730", 51),
                ("Pressj05", "625", 46),
            ],
        )
        self.assertEqual(result["summary"]["options"], 18)
        self.assertEqual(result["summary"]["cash"], 3679.59)

    def test_all_accounts_file_is_refused_by_the_single_account_format(self):
        # Read as a single account, every portfolio's holdings would merge into
        # whichever portfolio was selected.
        content = build_export([
            ("IRA ...426", [position_row("SPYI", 10, 50.0, 54.0), cash_row(0.0), total_row(540.0)]),
            ("Roth ...995", [position_row("SPYI", 4, 40.0, 54.0), cash_row(0.0), total_row(216.0)]),
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "All-Accounts-Positions.csv"
            path.write_text(content, encoding="utf-8")
            with self.assertRaises(ValueError) as ctx:
                parse_schwab_csv(str(path), path.name)
        self.assertIn("All Accounts Positions", str(ctx.exception))

    def test_a_single_account_file_with_footers_is_not_mistaken_for_all_accounts(self):
        # Export footers sit on short lines like an account label does, so the
        # single-account import must not be turned away by them.
        content = "\n".join([
            '"Positions for Roth_IRA ...995 as of 04:46 PM ET, 08/18/2026"',
            "",
            COLUMNS,
            position_row("SPYI", 10, 50.0, 54.0),
            cash_row(75.22),
            total_row(615.22),
            "",
            '"Data as of 08/18/2026"',
            '"Important: The data and information in this report is provided as-is."',
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Positions.csv"
            path.write_text(content, encoding="utf-8")
            result = parse_schwab_csv(str(path), path.name)

        self.assertEqual(result["summary"]["holdings"], 1)
        self.assertEqual(result["summary"]["account_value"], 615.22)

    def test_single_account_parser_still_reads_a_single_account_file(self):
        # The two formats share a row parser; the refactor must not move the
        # single-account import.
        content = "\n".join([
            '"Positions for Roth_IRA ...995 as of 04:46 PM ET, 08/18/2026"',
            "",
            COLUMNS,
            position_row("SPYI", 10, 50.0, 54.0),
            cash_row(75.22),
            total_row(615.22),
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Positions.csv"
            path.write_text(content, encoding="utf-8")
            result = parse_schwab_csv(str(path), path.name)

        self.assertEqual(result["format_type"], "positions")
        self.assertEqual(result["summary"]["holdings"], 1)
        self.assertEqual(result["summary"]["cash"], 75.22)
        self.assertEqual(result["summary"]["account_value"], 615.22)


class SchwabAllAccountsImportTest(unittest.TestCase):
    """Routing each account block to its own portfolio."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        database.ensure_tables_exist(conn)
        conn.execute("DELETE FROM profiles")
        for pid, name, broker in [
            (1, "Owner", "schwab"),
            (2, "Roth IRA", "schwab"),
            (3, "IRA", "schwab"),
            (4, "Individual", "schwab"),
            (5, "Jim Fidelity", "fidelity"),
        ]:
            conn.execute(
                "INSERT INTO profiles (id, name, broker_source, include_in_owner, display_order) "
                "VALUES (?, ?, ?, 1, ?)",
                (pid, name, broker, pid),
            )
        conn.commit()
        conn.close()

        self._orig_get_connection = app_module.get_connection
        self._orig_testing = app_module.app.testing
        self._orig_db_init = getattr(app_module.app, "_db_initialized", False)
        # The import path calls into normalize.py, which opens config.DB_PATH
        # itself, so pinning app.get_connection alone is not enough.
        self._orig_db_path = config.DB_PATH
        config.DB_PATH = self.db_path
        app_module.get_connection = self._get_connection
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()
        # Position imports intentionally reject snapshots whose date is not
        # today. Keep these routing tests stable instead of letting their fixed
        # fixture date become "backdated" as soon as the calendar advances.
        self.nav_date = app_module.datetime.date.today().isoformat()

    def tearDown(self):
        app_module.get_connection = self._orig_get_connection
        app_module.app.testing = self._orig_testing
        app_module.app._db_initialized = self._orig_db_init
        config.DB_PATH = self._orig_db_path
        try:
            Path(self.db_path).unlink(missing_ok=True)
        except PermissionError:
            pass  # Windows can briefly hold the temp file; best-effort cleanup.

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _export(self, accounts=None):
        accounts = accounts or [
            ("Roth_IRA ...995", [position_row("SPYI", 10, 50.0, 54.0), cash_row(75.22), total_row(615.22)]),
            ("Standard_IRA ...426", [position_row("QQQI", 20, 44.0, 55.0), cash_row(100.0), total_row(1200.0)]),
            ("Individual ...730", [position_row("ARCC", 30, 19.0, 19.7), cash_row(5.0), total_row(596.0)]),
        ]
        return build_export(accounts).encode("utf-8")

    def _post(self, endpoint, content=None, **fields):
        data = {
            "file": (__import__("io").BytesIO(content or self._export()), "All-Accounts-Positions.csv"),
            "format": "schwab_all_accounts",
        }
        data.update(fields)
        return self.client.post(endpoint, data=data, content_type="multipart/form-data")

    def _preview(self, content=None):
        res = self._post("/api/import/transactions/preview", content)
        self.assertEqual(res.status_code, 200, res.get_json())
        return res.get_json()

    def _holdings(self, profile_id):
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT ticker, quantity FROM all_account_info WHERE profile_id = ?",
                (profile_id,),
            ).fetchall()
            return {row["ticker"]: row["quantity"] for row in rows}
        finally:
            conn.close()

    # ── matching ────────────────────────────────────────────────────────────
    def test_preview_matches_a_schwab_nickname_to_the_same_portfolio(self):
        # Live Schwab exports label taxable accounts with the nickname
        # (pressj04), not "Individual". That has to match Pressj04.
        conn = self._get_connection()
        try:
            conn.execute("UPDATE profiles SET name = 'Pressj04' WHERE id = 4")
            conn.commit()
        finally:
            conn.close()
        content = build_export([
            ("pressj04 ...730", [position_row("ARCC", 10, 19.0, 19.7), cash_row(0.0), total_row(197.0)]),
        ]).encode("utf-8")
        account = self._preview(content)["accounts"][0]
        self.assertEqual(account["suggested_profile_id"], 4)
        self.assertEqual(account["suggested_profile_name"], "Pressj04")

    def test_preview_matches_each_account_to_a_portfolio(self):
        data = self._preview()

        self.assertEqual(data["format_type"], "positions_multi")
        self.assertEqual(
            {a["account_label"]: a["suggested_profile_name"] for a in data["accounts"]},
            {
                "Roth_IRA ...995": "Roth IRA",
                "Standard_IRA ...426": "IRA",
                "Individual ...730": "Individual",
            },
        )

    def test_preview_offers_only_portfolios_that_accept_schwab(self):
        names = {choice["name"] for choice in self._preview()["profile_choices"]}

        self.assertNotIn("Jim Fidelity", names)
        self.assertIn("Roth IRA", names)

    def test_preview_leaves_an_unrecognized_account_for_the_user(self):
        content = build_export([
            ("Beach House Fund ...777", [position_row("SPYI", 10, 50.0, 54.0), cash_row(0.0), total_row(540.0)]),
        ]).encode("utf-8")
        account = self._preview(content)["accounts"][0]

        self.assertIsNone(account["suggested_profile_id"])
        self.assertEqual(account["match_reason"], "unmatched")
        self.assertEqual(account["new_profile_name"], "Beach House Fund")

    def test_preview_will_not_guess_between_two_accounts_of_the_same_name(self):
        content = build_export([
            ("Individual ...111", [position_row("SPYI", 10, 50.0, 54.0), cash_row(0.0), total_row(540.0)]),
            ("Individual ...222", [position_row("QQQI", 10, 50.0, 55.0), cash_row(0.0), total_row(550.0)]),
        ]).encode("utf-8")

        for account in self._preview(content)["accounts"]:
            self.assertIsNone(account["suggested_profile_id"], account["account_label"])

    def test_preview_will_not_route_a_cash_only_account_by_itself(self):
        # Importing an empty block would clear whatever portfolio it hit.
        content = build_export([
            ("Individual ...730", [cash_row(2500.0), total_row(2500.0)]),
        ]).encode("utf-8")
        account = self._preview(content)["accounts"][0]

        self.assertIsNone(account["suggested_profile_id"])
        self.assertEqual(account["match_reason"], "no_holdings")

    # ── importing ───────────────────────────────────────────────────────────
    def test_imports_every_account_in_one_pass(self):
        res = self._post("/api/import/transactions", nav_date=self.nav_date)
        data = res.get_json()

        self.assertEqual(res.status_code, 200, data)
        self.assertEqual(data["imported_accounts"], 3)
        self.assertEqual(self._holdings(2), {"SPYI": 10})
        self.assertEqual(self._holdings(3), {"QQQI": 20})
        self.assertEqual(self._holdings(4), {"ARCC": 30})

    def test_each_account_lands_with_its_own_cash(self):
        self._post("/api/import/transactions", nav_date=self.nav_date)
        conn = self._get_connection()
        try:
            rows = conn.execute("SELECT id, cash_value FROM profiles").fetchall()
            cash = {row["id"]: row["cash_value"] for row in rows}
        finally:
            conn.close()

        self.assertEqual(cash[2], 75.22)
        self.assertEqual(cash[3], 100.0)
        self.assertEqual(cash[4], 5.0)

    def test_account_map_overrides_the_suggested_portfolio(self):
        preview = self._preview()
        keys = {a["account_label"]: a["account_key"] for a in preview["accounts"]}
        account_map = {
            keys["Roth_IRA ...995"]: "3",
            keys["Standard_IRA ...426"]: "2",
            keys["Individual ...730"]: "4",
        }

        res = self._post(
            "/api/import/transactions",
            nav_date=self.nav_date,
            account_map=json.dumps(account_map),
        )

        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(self._holdings(3), {"SPYI": 10})
        self.assertEqual(self._holdings(2), {"QQQI": 20})

    def test_skipped_account_is_left_alone(self):
        preview = self._preview()
        keys = {a["account_label"]: a["account_key"] for a in preview["accounts"]}
        account_map = {
            keys["Roth_IRA ...995"]: "2",
            keys["Standard_IRA ...426"]: "",
            keys["Individual ...730"]: "4",
        }

        res = self._post(
            "/api/import/transactions",
            nav_date=self.nav_date,
            account_map=json.dumps(account_map),
        )
        data = res.get_json()

        self.assertEqual(data["imported_accounts"], 2)
        self.assertEqual(data["skipped_accounts"], ["Standard_IRA ...426"])
        self.assertEqual(self._holdings(3), {})

    def test_two_accounts_cannot_share_one_portfolio(self):
        preview = self._preview()
        keys = {a["account_label"]: a["account_key"] for a in preview["accounts"]}
        account_map = {
            keys["Roth_IRA ...995"]: "2",
            keys["Standard_IRA ...426"]: "2",
            keys["Individual ...730"]: "",
        }

        res = self._post(
            "/api/import/transactions",
            nav_date=self.nav_date,
            account_map=json.dumps(account_map),
        )

        self.assertEqual(res.status_code, 400)
        self.assertIn("own portfolio", res.get_json()["error"])
        self.assertEqual(self._holdings(2), {})

    def test_a_portfolio_pinned_to_another_broker_is_refused(self):
        preview = self._preview()
        keys = {a["account_label"]: a["account_key"] for a in preview["accounts"]}
        account_map = {keys["Roth_IRA ...995"]: "5"}

        res = self._post(
            "/api/import/transactions",
            nav_date=self.nav_date,
            account_map=json.dumps(account_map),
        )

        self.assertEqual(res.status_code, 400)
        self.assertIn("Charles Schwab", res.get_json()["error"])

    def test_an_unmatched_account_can_open_its_own_portfolio(self):
        content = build_export([
            ("Beach House Fund ...777", [position_row("SPYI", 10, 50.0, 54.0), cash_row(0.0), total_row(540.0)]),
        ]).encode("utf-8")
        key = self._preview(content)["accounts"][0]["account_key"]

        res = self._post(
            "/api/import/transactions",
            content,
            nav_date=self.nav_date,
            account_map=json.dumps({key: "new"}),
        )
        data = res.get_json()

        self.assertEqual(res.status_code, 200, data)
        self.assertEqual(data["created_profiles"], ["Beach House Fund"])
        conn = self._get_connection()
        try:
            row = conn.execute(
                "SELECT id, broker_source FROM profiles WHERE name = 'Beach House Fund'"
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(row["broker_source"], "schwab")
        self.assertEqual(self._holdings(row["id"]), {"SPYI": 10})

    def test_a_confirmed_routing_is_reused_next_time(self):
        preview = self._preview()
        keys = {a["account_label"]: a["account_key"] for a in preview["accounts"]}
        self._post(
            "/api/import/transactions",
            nav_date=self.nav_date,
            account_map=json.dumps({
                keys["Roth_IRA ...995"]: "3",
                keys["Standard_IRA ...426"]: "2",
                keys["Individual ...730"]: "4",
            }),
        )

        # The next export has to follow the routing the user confirmed, not the
        # name match it would otherwise fall back to.
        again = self._preview()
        self.assertEqual(
            {a["account_label"]: (a["suggested_profile_name"], a["match_reason"])
             for a in again["accounts"]},
            {
                "Roth_IRA ...995": ("IRA", "saved_mapping"),
                "Standard_IRA ...426": ("Roth IRA", "saved_mapping"),
                "Individual ...730": ("Individual", "saved_mapping"),
            },
        )

    def test_nav_only_records_snapshots_without_touching_holdings(self):
        res = self._post(
            "/api/import/transactions",
            nav_date=self.nav_date,
            nav_only="true",
        )
        data = res.get_json()

        self.assertEqual(res.status_code, 200, data)
        self.assertEqual(self._holdings(2), {})
        conn = self._get_connection()
        try:
            rows = conn.execute(
                "SELECT profile_id, total_value FROM portfolio_nav WHERE nav_date = ?",
                (self.nav_date,),
            ).fetchall()
            navs = {row["profile_id"]: row["total_value"] for row in rows}
        finally:
            conn.close()
        self.assertEqual(navs[2], 615.22)

    def test_a_stale_holding_is_dropped_from_the_right_portfolio_only(self):
        conn = self._get_connection()
        try:
            for pid, ticker in [(2, "OLD"), (3, "QQQI")]:
                conn.execute(
                    "INSERT INTO all_account_info (ticker, profile_id, quantity, current_value) "
                    "VALUES (?, ?, 5, 100)",
                    (ticker, pid),
                )
            conn.commit()
        finally:
            conn.close()

        self._post("/api/import/transactions", nav_date=self.nav_date)

        self.assertEqual(self._holdings(2), {"SPYI": 10})
        self.assertEqual(self._holdings(3), {"QQQI": 20})

    def test_runs_from_an_aggregate_view(self):
        # Other broker imports are blocked from an aggregate because they need
        # one target; this one carries its own targets, so it is allowed.
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO aggregates (id, name) VALUES (1, 'Everything')")
            for pid in (2, 3, 4):
                conn.execute(
                    "INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (1, ?)",
                    (pid,),
                )
            conn.commit()
        finally:
            conn.close()

        preview = self.client.post(
            "/api/import/transactions/preview?aggregate_id=1",
            data={
                "file": (__import__("io").BytesIO(self._export()), "All-Accounts-Positions.csv"),
                "format": "schwab_all_accounts",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(preview.status_code, 200, preview.get_json())

        res = self.client.post(
            "/api/import/transactions?aggregate_id=1",
            data={
                "file": (__import__("io").BytesIO(self._export()), "All-Accounts-Positions.csv"),
                "format": "schwab_all_accounts",
                "nav_date": self.nav_date,
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()["imported_accounts"], 3)
        self.assertEqual(self._holdings(2), {"SPYI": 10})

    def test_a_single_account_schwab_import_is_still_blocked_from_an_aggregate(self):
        conn = self._get_connection()
        try:
            conn.execute("INSERT INTO aggregates (id, name) VALUES (1, 'Everything')")
            conn.commit()
        finally:
            conn.close()

        res = self.client.post(
            "/api/import/transactions?aggregate_id=1",
            data={
                "file": (__import__("io").BytesIO(self._export()), "Positions.csv"),
                "format": "schwab",
                "nav_date": self.nav_date,
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(res.status_code, 400)
        self.assertIn("Aggregate", res.get_json()["error"])

    def test_the_selected_portfolio_is_not_an_import_target(self):
        # The page can be sitting on any portfolio; routing comes from the file.
        res = self.client.post(
            "/api/import/transactions?profile_id=5",
            data={
                "file": (__import__("io").BytesIO(self._export()), "All-Accounts-Positions.csv"),
                "format": "schwab_all_accounts",
                "nav_date": self.nav_date,
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(self._holdings(5), {})
        self.assertEqual(self._holdings(2), {"SPYI": 10})


if __name__ == "__main__":
    unittest.main()
