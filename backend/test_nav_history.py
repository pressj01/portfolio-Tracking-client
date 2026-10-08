import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nav_history import activity_flows, build_nav_history_payload, dividend_outflows, flow_coverage_gaps


class NavHistoryPayloadTest(unittest.TestCase):
    def test_total_return_ends_at_the_recorded_value(self):
        nav_rows = [
            {"nav_date": "2026-07-01", "total_value": 1000},
            {"nav_date": "2026-07-02", "total_value": 990},
            {"nav_date": "2026-07-06", "total_value": 1010},
        ]
        flows = [
            ("2026-06-30", -50),   # before the first point: already inside it
            ("2026-07-02", -12.5),  # belongs to the 07-02 value
            ("2026-07-03", -7.5),   # belongs to the 07-06 value
            ("2026-07-07", -99),   # after the last point: not charted yet
        ]

        payload = build_nav_history_payload(nav_rows, flows)

        self.assertEqual([row["total_return_value"] for row in payload], [980.0, 982.5, 1010.0])
        self.assertEqual([row["net_withdrawn_after"] for row in payload], [20.0, 7.5, 0.0])
        self.assertEqual([row["value"] for row in payload], [1000.0, 990.0, 1010.0])

    def test_deposit_after_a_point_raises_it_so_the_deposit_is_not_gain(self):
        payload = build_nav_history_payload(
            [("2026-07-01", 1000), ("2026-07-02", 1600)],
            [("2026-07-02", 500)],
        )

        self.assertEqual([row["total_return_value"] for row in payload], [1500.0, 1600.0])

    def test_no_flows_leaves_total_return_equal_to_value(self):
        payload = build_nav_history_payload([("2026-07-01", 1000), ("2026-07-02", 1010)])

        self.assertEqual([row["total_return_value"] for row in payload], [1000.0, 1010.0])


class FlowCoverageGapsTest(unittest.TestCase):
    def test_full_coverage_is_not_a_gap_and_quiet_edge_days_are_tolerated(self):
        gaps = flow_coverage_gaps(
            "2026-05-19", "2026-10-08",
            {6: [("2026-05-01", "2026-10-05")]},
            {6: "Schwab"},
        )

        self.assertEqual(gaps, [])

    def test_history_that_starts_late_or_stops_early_is_a_gap(self):
        gaps = flow_coverage_gaps(
            "2026-05-19", "2026-10-08",
            {19: [("2026-06-29", "2026-09-24")], 6: [("2026-05-01", "2026-10-08")]},
            {19: "Etrade Trading", 6: "Schwab"},
        )

        self.assertEqual(gaps, [{
            "profile_id": 19, "name": "Etrade Trading",
            "covered_from": "2026-06-29", "covered_to": "2026-09-24",
        }])

    def test_history_that_stops_well_before_the_chart_ends_is_a_gap(self):
        gaps = flow_coverage_gaps(
            "2026-05-19", "2026-10-08", {6: [("2026-05-01", "2026-09-01")]}, {6: "Schwab"},
        )

        self.assertEqual([gap["name"] for gap in gaps], ["Schwab"])

    def test_an_account_with_no_import_reports_no_dates(self):
        gaps = flow_coverage_gaps("2026-05-19", "2026-10-08", {9: []}, {9: "Roth IRA"})

        self.assertEqual(gaps, [{
            "profile_id": 9, "name": "Roth IRA", "covered_from": None, "covered_to": None,
        }])

    def test_a_single_point_has_no_flows_to_miss(self):
        self.assertEqual(flow_coverage_gaps("2026-10-08", "2026-10-08", {9: []}), [])

    def test_gaps_ride_on_the_first_point_only(self):
        gap = {"profile_id": 9, "name": "Roth IRA", "covered_from": None, "covered_to": None}
        payload = build_nav_history_payload(
            [("2026-07-01", 1000), ("2026-07-02", 1010)], flow_gaps=[gap],
        )

        self.assertEqual(payload[0]["flow_gaps"], [gap])
        self.assertNotIn("flow_gaps", payload[1])
        self.assertNotIn("flow_gaps", build_nav_history_payload([("2026-07-01", 1000)])[0])


class DividendOutflowsTest(unittest.TestCase):
    def test_estimated_payments_are_excluded(self):
        flows = dividend_outflows([
            ("2026-07-02", 25, "refresh_estimate"),
            ("2026-07-02", 10, "portfolio_export"),
        ])

        self.assertEqual(flows, [("2026-07-02", -10.0)])


class ActivityFlowsTest(unittest.TestCase):
    def test_cash_rows_use_their_signed_base_amount(self):
        flows, unvalued = activity_flows([
            {"profile_id": 6, "activity_date": "2026-07-21", "direction": "OUT",
             "base_amount": -334.0, "ticker": None, "quantity": None, "price_per_share": None},
            {"profile_id": 6, "activity_date": "2026-07-22", "direction": "IN",
             "base_amount": 250.0, "ticker": None, "quantity": None, "price_per_share": None},
        ])

        self.assertEqual(flows, [("2026-07-21", -334.0), ("2026-07-22", 250.0)])
        self.assertEqual(unvalued, 0)

    def test_security_journal_pair_cancels_without_a_price(self):
        leg = {"profile_id": 8, "activity_date": "2026-06-22", "base_amount": None,
               "ticker": "XSHP", "price_per_share": None}
        flows, unvalued = activity_flows([
            {**leg, "direction": "OUT", "quantity": -25.0},
            {**leg, "direction": "IN", "quantity": 25.0},
        ])

        self.assertEqual(flows, [])
        self.assertEqual(unvalued, 0)

    def test_unpaired_security_transfer_is_valued_by_price_lookup(self):
        flows, unvalued = activity_flows(
            [{"profile_id": 8, "activity_date": "2026-06-22", "direction": "OUT",
              "base_amount": None, "ticker": "XSHP", "quantity": -25.0, "price_per_share": None},
             {"profile_id": 8, "activity_date": "2026-06-23", "direction": "IN",
              "base_amount": None, "ticker": "NOPE", "quantity": 5.0, "price_per_share": None}],
            price_on=lambda ticker, _day: 40.0 if ticker == "XSHP" else None,
        )

        self.assertEqual(flows, [("2026-06-22", -1000.0)])
        self.assertEqual(unvalued, 1)


class NavHistoryFlowScopeTest(unittest.TestCase):
    """Broker accounts already hold their dividends; manual portfolios do not."""

    def setUp(self):
        import sqlite3

        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT, positions_managed INTEGER);
            CREATE TABLE dividend_payments (
                profile_id INTEGER, ticker TEXT, payment_date TEXT, amount REAL, source TEXT
            );
            CREATE TABLE account_activity (
                profile_id INTEGER, activity_date TEXT, direction TEXT, base_amount REAL,
                ticker TEXT, quantity REAL, price_per_share REAL, performance_treatment TEXT
            );
            CREATE TABLE all_account_info (profile_id INTEGER, ticker TEXT, current_price REAL);
            CREATE TABLE account_activity_coverage (
                profile_id INTEGER, start_date TEXT, end_date TEXT, source_format TEXT
            );
            INSERT INTO account_activity_coverage VALUES (6, '2026-06-29', '2026-07-05', 'schwab_transactions');
            INSERT INTO profiles VALUES (6, 'Schwab', 1), (14, 'Manual', 0);
            INSERT INTO dividend_payments VALUES
                (6, 'JEPI', '2026-07-02', 40, 'schwab_transactions'),
                (14, 'JEPI', '2026-07-02', 15, 'portfolio_export'),
                (14, 'JEPI', '2026-07-03', 99, 'refresh_estimate');
            INSERT INTO account_activity VALUES
                (6, '2026-07-02', 'OUT', -500, NULL, NULL, NULL, 'EXTERNAL_FLOW'),
                (6, '2026-07-02', 'IN', 12, NULL, NULL, NULL, 'INCOME'),
                (14, '2026-07-02', 'OUT', -70, NULL, NULL, NULL, 'EXTERNAL_FLOW');
            """
        )

    def tearDown(self):
        self.conn.close()

    def test_broker_uses_withdrawals_and_manual_uses_paid_dividends(self):
        import app as app_module

        flows = app_module._nav_history_flows(self.conn, [6, 14], "2026-07-01", "2026-07-06")

        self.assertEqual(sorted(flows), [("2026-07-02", -500.0), ("2026-07-02", -15.0)])

    def test_only_broker_accounts_are_checked_for_missing_deposit_history(self):
        import app as app_module

        gaps = app_module._nav_history_flow_gaps(self.conn, [6, 14], "2026-05-19", "2026-07-06")

        self.assertEqual(
            gaps,
            [{"profile_id": 6, "name": "Schwab", "covered_from": "2026-06-29", "covered_to": "2026-07-05"}],
        )


if __name__ == "__main__":
    unittest.main()
