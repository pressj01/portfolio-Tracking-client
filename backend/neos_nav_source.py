"""Published NAV per share for NEOS funds, rebuilt from the issuer's fund page.

neosfunds.com publishes three things for each fund: today's closing NAV per
share ("Data as of MM/DD/YYYY ... Net Asset Value $X"), a daily "Growth of
$10,000 at NAV" series that reinvests distributions, and the distribution
table with ex-dates. Daily NAV per share follows from those. Reinvesting a
distribution D on its ex-date gives G[t] / G[t-1] = (N[t] + D[t]) / N[t-1],
so working back from today's NAV:

    N[t-1] = (N[t] + D[t]) * G[t-1] / G[t]

The growth series is in whole dollars of $10,000, but the ratios telescope
between ex-dates, so the rebuilt NAV stays within about 0.01%. Measured on
2026-10-22: QQQI, CSHI, BTCI, IWMI and IYRI rebuild to their $50.00 launch NAV
within a cent.

A missing distribution would shift every earlier rebuilt NAV by its amount,
so the result is cross-checked against market closes (an ETF trades within a
fraction of a percent of NAV) before it is treated as complete.
"""
import datetime as dt
import html
import re
import statistics

DIST_ROW = re.compile(
    r"<td class=\"bg-f7f7f7\">(\d{2}/\d{2}/\d{4})</td>\s*"
    r"<td class=\"bg-f7f7f7\">(\d{2}/\d{2}/\d{4})</td>\s*"
    r"<td class=\"bg-f7f7f7\">(\d{2}/\d{2}/\d{4})</td>\s*"
    r"<td class=\"bg-f7f7f7\">(\d{2}/\d{2}/\d{4})</td>\s*"
    r"<td class=\"bg-f7f7f7\">\$?([0-9.]*)</td>",
    re.I,
)
# An ETF's close sits within a fraction of a percent of NAV. A missing monthly
# payout (about 1% or more for these funds) would push the rebuilt NAV past this.
PREMIUM_TOLERANCE = .0075


def _date(text, fmt="%m/%d/%Y"):
    return dt.datetime.strptime(text, fmt).date()


def _page_text(page):
    stripped = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", stripped)))


def parse_fund_page(page):
    """The NAV, growth series and distributions on a NEOS fund page.

    Returns None when the page is not a NEOS fund page. A page without the
    growth chart (newer funds) returns its NAV with an empty series.
    """
    if not page or "neos" not in page[:5000].lower():
        return None
    text = _page_text(page)
    as_of = re.search(r"Data as of (\d{2}/\d{2}/\d{4}) Closing NAV", text)
    nav = re.search(r"Net Asset Value \$([0-9][0-9,]*\.?[0-9]*)", text)
    if not as_of or not nav:
        return None
    dates = re.search(r"const dates = \[(.*?)\]", page, re.S)
    values = re.search(r"const navValues = \[(.*?)\]", page, re.S)
    series = []
    if dates and values:
        days = re.findall(r"\"(\d{4}-\d{2}-\d{2})\"", dates.group(1))
        growth = [float(item) for item in values.group(1).split(",") if item.strip()]
        if len(days) == len(growth):
            series = [(_date(day, "%Y-%m-%d"), value) for day, value in zip(days, growth) if value > 0]
    distributions = {}
    for _declared, ex_date, _record, _pay, amount in DIST_ROW.findall(page):
        if amount:
            distributions[_date(ex_date)] = distributions.get(_date(ex_date), 0) + float(amount)
    return {"as_of": _date(as_of.group(1)), "nav": float(nav.group(1).replace(",", "")),
            "growth": series, "distributions": sorted(distributions.items())}


def rebuild_nav(parsed):
    """Daily NAV per share on today's share basis, newest anchored to the published NAV."""
    growth = parsed["growth"]
    if len(growth) < 2 or growth[-1][0] != parsed["as_of"]:
        return None
    paid = dict(parsed["distributions"])
    nav = {growth[-1][0]: parsed["nav"]}
    for (previous, g_prev), (day, g_day) in zip(reversed(growth[:-1]), reversed(growth[1:])):
        nav[previous] = (nav[day] + paid.get(day, 0)) * g_prev / g_day
    return nav


def _gaps_ok(ex_dates):
    """No distribution is missing from the middle of the table."""
    if len(ex_dates) < 3:
        return True
    gaps = [(b - a).days for a, b in zip(ex_dates, ex_dates[1:])]
    typical = statistics.median(gaps)
    return all(gap <= typical * 1.6 + 3 for gap in gaps)


def build_source(parsed, start, end, *, prices=None, splits=(), url=None, fetched_at=None):
    """Assessment source dict for one NEOS fund over [start, end].

    ``prices`` are the market closes the price screen already loads
    ({date: close}, same share basis). They set the trading-day calendar and
    the cross-check; without them the NAV is reported but not marked complete.
    """
    base = {"basis": "published_nav", "url": url, "fetched_at": fetched_at, "splits": [],
            "label": "NEOS published NAV (rebuilt daily from neosfunds.com)",
            "distribution_source": "NEOS distribution table (ex-dates)",
            "adjustment_source": "Rebuilt on today's share basis from the issuer's NAV and growth-of-$10,000 series"}
    if parsed is None:
        return None
    if not parsed["growth"]:
        return {**base, "nav": [], "distributions": [], "distributions_complete": False,
                "corporate_actions_resolved": False,
                "unavailable_reason": "NEOS does not publish a daily NAV history for this fund yet (only today's NAV), so "
                                      "published NAV can't be checked over a date range. The result above uses market prices."}
    nav = rebuild_nav(parsed)
    if nav is None:
        return {**base, "nav": [], "distributions": [], "distributions_complete": False,
                "corporate_actions_resolved": False,
                "unavailable_reason": "The NEOS NAV history and today's NAV are not from the same day, so the daily NAV "
                                      "can't be rebuilt yet. Retry after neosfunds.com updates."}
    trading = set(prices) if prices else None
    first_chart = parsed["growth"][0][0]
    days = sorted(day for day in nav if (trading is None and day.weekday() < 5) or (trading is not None and day in trading))
    observations = [{"date": day.isoformat(), "nav": round(nav[day], 6)} for day in days if day <= end]
    ex_dates = [day for day, _ in parsed["distributions"]]
    window_from = max(start, first_chart)
    in_window = [day for day in ex_dates if window_from < day <= end]
    distributions = [{"date": day.isoformat(), "amount": amount} for day, amount in parsed["distributions"]
                     if first_chart < day <= end]
    problems = []
    # The table must reach back to the start of these dates, with no month
    # missing in between (converted funds list only NEOS-era payouts).
    if not ex_dates or ex_dates[0] > window_from + dt.timedelta(days=45):
        problems.append("the NEOS distribution table does not reach back to the start of these dates")
    elif not _gaps_ok([day for day in ex_dates if day >= window_from - dt.timedelta(days=45)]):
        problems.append("the NEOS distribution table has a gap")
    split_days = [day for day, ratio in splits if ratio and window_from < day <= end]
    if split_days:
        problems.append(f"a share split on {split_days[0].isoformat()} still needs handling")
    checked = []
    if prices:
        for label, day in (("start", max([d for d in days if d <= start] or days[:1])), ("end", days[-1] if days else None)):
            if day in prices and day in nav and prices[day] > 0:
                premium = prices[day] / nav[day] - 1
                checked.append((label, day, premium))
                if abs(premium) > PREMIUM_TOLERANCE:
                    problems.append(f"the rebuilt NAV is {abs(premium) * 100:.2f}% away from the {day.isoformat()} market close, "
                                    "so a distribution may be missing")
    else:
        problems.append("market closes were not available to cross-check the rebuilt NAV")
    source = {**base, "nav": observations, "distributions": distributions,
              "distributions_complete": not problems,
              "corporate_actions_resolved": not split_days,
              "cross_check": [{"point": label, "date": day.isoformat(), "premium": premium} for label, day, premium in checked]}
    if problems:
        source["limitation"] = "NEOS NAV was rebuilt, but " + "; ".join(problems) + ". The result above uses market prices."
    return source
