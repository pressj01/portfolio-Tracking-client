"""Whole-account time-weighted return, the series behind the account's alpha.

A fund's alpha regresses its price history on a benchmark. An account has no
price history of its own: its recorded value moves with the market *and* with
every deposit, withdrawal and transfer. This module strips those external
flows out of the recorded values and chains what is left into a
time-weighted index, which the shared regression in app.py can then treat
exactly like a fund's closes.

Nothing here touches the database or the network, so every rule is testable
on plain dates and numbers.
"""

import datetime

import pandas as pd

# Longest quiet stretch between two broker activity files that still reads as
# one continuous record. Exports are cut on a date, so a long weekend plus a
# holiday can leave four silent days between the last row of one file and the
# first row of the next.
COVERAGE_MAX_GAP_DAYS = 5

# One recorded day moving the account by more than this, with no recorded
# flow to explain it, is missing data (an untracked transfer, a partial
# snapshot), not a market move. Margin accounts can legitimately swing 10%+
# in a day, so the bar sits well above that.
MAX_UNEXPLAINED_DAILY_MOVE = 0.25


def as_date(value):
    """Coerce an ISO string, date or datetime to a ``datetime.date``."""
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    return datetime.date.fromisoformat(str(value)[:10])


def merge_coverage(spans, max_gap_days=COVERAGE_MAX_GAP_DAYS):
    """Merge ``(start, end)`` spans into continuous covered runs, sorted."""
    ordered = sorted(
        (as_date(start), as_date(end)) for start, end in spans or [] if start and end
    )
    runs = []
    for start, end in ordered:
        if end < start:
            start, end = end, start
        if runs and (start - runs[-1][1]).days <= max_gap_days:
            runs[-1] = (runs[-1][0], max(runs[-1][1], end))
        else:
            runs.append((start, end))
    return runs


def coverage_for_window(spans, window_start, window_end):
    """The covered run that best serves a window, or ``None``.

    Only one continuous run can back a time-weighted return: a gap in the
    activity record is a stretch where a deposit could have happened unseen.
    Among runs that overlap the window, the one reaching latest wins, so the
    measurement stays as current as the imports allow.
    """
    window_start = as_date(window_start) if window_start else None
    window_end = as_date(window_end)
    best = None
    for start, end in merge_coverage(spans):
        if end < (window_start or start) or start > window_end:
            continue
        if best is None or end > best[1]:
            best = (start, end)
    return best


def intersect_runs(runs):
    """The span every run covers, or ``None`` when they do not all overlap."""
    runs = list(runs)
    if not runs:
        return None
    start = max(run[0] for run in runs)
    end = min(run[1] for run in runs)
    return (start, end) if start <= end else None


def flow_value(row, price_on=None):
    """Signed base-currency value of one external-flow row, or ``None``.

    Money in is positive. Cash rows carry their own signed base amount. A
    security transfer carries shares instead, valued at the row's own price or
    else the market close ``price_on(ticker, date)`` returns; its direction
    comes from the row, because brokers such as Robinhood report transfer-out
    quantities as positive numbers.
    """
    base_amount = row.get("base_amount")
    if base_amount is not None:
        return float(base_amount)
    quantity = row.get("quantity")
    ticker = row.get("ticker")
    if not quantity or not ticker:
        return None
    price = row.get("price_per_share")
    if not price or price <= 0:
        price = price_on(ticker, as_date(row["activity_date"])) if price_on else None
    if not price or price <= 0:
        return None
    sign = -1.0 if str(row.get("direction") or "").upper() == "OUT" else 1.0
    return sign * abs(float(quantity)) * float(price)


def time_weighted_index(nav_points, flows):
    """Chain recorded account values into a time-weighted index.

    ``nav_points`` is ``[(date, value)]``; ``flows`` is ``[(date, amount)]``
    with money in positive. A flow belongs to the first recorded value on or
    after its date, since a recorded value is taken after that day's activity:
    the period return is ``(V_i - F_i) / V_(i-1) - 1``. Flows on or before the
    first recorded value are already inside it and are ignored.

    Returns ``(index, problem)``. ``index`` is a Series starting at 1.0, or
    ``None`` with ``problem`` naming the first bad date:
    ``("non_positive_value", date)`` or ``("unexplained_jump", date, move)``.
    """
    points = sorted((as_date(day), float(value)) for day, value in nav_points)
    if len(points) < 2:
        return None, ("too_few_values", None)

    dates = [day for day, _ in points]
    flow_by_point = [0.0] * len(points)
    for day, amount in flows or []:
        day = as_date(day)
        if day <= dates[0]:
            continue
        for position in range(1, len(dates)):
            if day <= dates[position]:
                flow_by_point[position] += float(amount)
                break

    level = 1.0
    levels = [level]
    for position in range(1, len(points)):
        previous = points[position - 1][1]
        current = points[position][1]
        if previous <= 0 or current <= 0:
            return None, ("non_positive_value", dates[position])
        period_return = (current - flow_by_point[position]) / previous - 1.0
        if abs(period_return) > MAX_UNEXPLAINED_DAILY_MOVE:
            return None, ("unexplained_jump", dates[position], period_return)
        level *= 1.0 + period_return
        levels.append(level)
    return pd.Series(levels, index=pd.DatetimeIndex(dates)), None
