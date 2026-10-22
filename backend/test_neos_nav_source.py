import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import neos_nav_source as neos
from nav_assessment_service import build_payload


def fund_page(nav_by_day, payouts, *, today=None, chart=True, drop_payout=None):
    """A NEOS-style fund page whose growth series reinvests payouts at ex-date NAV."""
    days = sorted(nav_by_day)
    growth, value = [], 10000.0
    for previous, day in zip([None] + days, days):
        if previous is not None:
            value *= (nav_by_day[day] + payouts.get(day, 0)) / nav_by_day[previous]
        growth.append(round(value))  # NEOS publishes whole dollars
    today = today or days[-1]
    rows = "".join(
        f'<tr><td class="bg-f7f7f7">{d:%m/%d/%Y}</td><td class="bg-f7f7f7">{d:%m/%d/%Y}</td>'
        f'<td class="bg-f7f7f7">{d:%m/%d/%Y}</td><td class="bg-f7f7f7">{d:%m/%d/%Y}</td>'
        f'<td class="bg-f7f7f7">${amount:.4f}</td></tr>'
        for d, amount in sorted(payouts.items()) if d != drop_payout)
    script = (f'<script>const dates = [{",".join(chr(34) + d.isoformat() + chr(34) for d in days)}];'
              f'const navValues = [{",".join(str(g) for g in growth)}];</script>') if chart else ""
    return (f"<html><head><title>TEST - Example ETF | NEOS Investments</title></head><body>"
            f"<p>Data as of {today:%m/%d/%Y} Closing NAV Price</p><p>Net Asset Value ${nav_by_day[days[-1]]:.2f}</p>"
            f"{script}<table>{rows}</table></body></html>")


def weekdays(start, end):
    day, out = start, []
    while day <= end:
        if day.weekday() < 5:
            out.append(day)
        day += dt.timedelta(days=1)
    return out


class NeosNavSourceTest(unittest.TestCase):
    def setUp(self):
        self.days = weekdays(dt.date(2025, 9, 1), dt.date(2026, 9, 30))
        # NAV drifts down 2 cents a day; a $0.50 payout on the 15th-ish of each month.
        self.nav = {day: 50 - 0.02 * i for i, day in enumerate(self.days)}
        self.payouts = {}
        for day in self.days:
            if day.day >= 15 and not any(p.month == day.month and p.year == day.year for p in self.payouts):
                self.payouts[day] = 0.5
        self.prices = {day: value * 1.001 for day, value in self.nav.items()}  # 0.1% premium

    def test_page_parses_and_the_rebuild_recovers_nav_per_share(self):
        parsed = neos.parse_fund_page(fund_page(self.nav, self.payouts))
        self.assertEqual(parsed["as_of"], self.days[-1])
        self.assertEqual(len(parsed["distributions"]), len(self.payouts))
        rebuilt = neos.rebuild_nav(parsed)
        for day in (self.days[0], self.days[len(self.days) // 2], self.days[-1]):
            self.assertAlmostEqual(rebuilt[day], self.nav[day], delta=self.nav[day] * 1e-4)

    def test_complete_history_that_matches_market_closes_is_verified(self):
        source = neos.build_source(neos.parse_fund_page(fund_page(self.nav, self.payouts)),
                                   dt.date(2025, 10, 1), self.days[-1], prices=self.prices)
        self.assertTrue(source["distributions_complete"])
        self.assertTrue(source["corporate_actions_resolved"])
        self.assertEqual(source["basis"], "published_nav")
        self.assertNotIn("limitation", source)

    def test_a_missing_distribution_is_caught_by_the_market_cross_check(self):
        dropped = sorted(self.payouts)[3]
        source = neos.build_source(neos.parse_fund_page(fund_page(self.nav, self.payouts, drop_payout=dropped)),
                                   dt.date(2025, 10, 1), self.days[-1], prices=self.prices)
        self.assertFalse(source["distributions_complete"])
        self.assertIn("distribution may be missing", source["limitation"])

    def test_table_that_starts_after_these_dates_is_not_complete(self):
        late = {day: amount for day, amount in self.payouts.items() if day >= dt.date(2026, 3, 1)}
        source = neos.build_source(neos.parse_fund_page(fund_page(self.nav, late)), dt.date(2025, 10, 1),
                                   self.days[-1], prices=self.prices)
        self.assertFalse(source["distributions_complete"])
        self.assertIn("does not reach back", source["limitation"])

    def test_split_in_these_dates_is_left_unresolved(self):
        source = neos.build_source(neos.parse_fund_page(fund_page(self.nav, self.payouts)), dt.date(2025, 10, 1),
                                   self.days[-1], prices=self.prices, splits=[(dt.date(2026, 2, 2), 2.0)])
        self.assertFalse(source["corporate_actions_resolved"])

    def test_fund_without_a_nav_history_says_so(self):
        source = neos.build_source(neos.parse_fund_page(fund_page(self.nav, self.payouts, chart=False)),
                                   dt.date(2025, 10, 1), self.days[-1], prices=self.prices)
        self.assertIn("does not publish a daily NAV history", source["unavailable_reason"])
        self.assertIsNone(neos.parse_fund_page("<html>Some other site</html>"))

    def test_stale_chart_is_not_anchored_to_todays_nav(self):
        page = fund_page(self.nav, self.payouts, today=self.days[-1] + dt.timedelta(days=1))
        source = neos.build_source(neos.parse_fund_page(page), dt.date(2025, 10, 1), self.days[-1], prices=self.prices)
        self.assertIn("not from the same day", source["unavailable_reason"])

    def test_verified_neos_source_gives_a_published_nav_result(self):
        start = dt.date(2025, 10, 1)
        source = neos.build_source(neos.parse_fund_page(fund_page(self.nav, self.payouts)), start, self.days[-1],
                                   prices=self.prices)
        row = build_payload({"QQQI": {"current_value": 100, "quantity": 2}}, lambda *a: source, lambda *a: {},
                            as_of=self.days[-1], start_date=start.isoformat(), cash=0)["results"][0]
        self.assertIsNotNone(row["metrics"])
        self.assertEqual(row["capital_status"], "declined")
        self.assertEqual(row["source"]["label"], "NEOS published NAV (rebuilt daily from neosfunds.com)")

    def test_unavailable_reason_reaches_the_holding(self):
        source = neos.build_source(neos.parse_fund_page(fund_page(self.nav, self.payouts, chart=False)),
                                   dt.date(2025, 10, 1), self.days[-1], prices=self.prices)
        info = {"current_value": 100, "quantity": 2, "description": "NEOS Boosted Bitcoin High Income ETF",
                "security_profile": {"quote_type": "ETF", "category": "Digital Assets"}}
        row = build_payload({"XBCI": info}, lambda *a: source, lambda *a: {},
                            as_of=self.days[-1], start_date="2025-10-01", cash=0)["results"][0]
        self.assertEqual(row["capital_status"], "unconfirmed")
        self.assertIn("daily NAV history", row["reason"])


if __name__ == "__main__":
    unittest.main()
