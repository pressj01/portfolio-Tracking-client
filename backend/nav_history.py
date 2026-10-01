"""Helpers for the Dashboard portfolio-value history chart."""

from account_performance import flow_value


NON_ACTUAL_DIVIDEND_SOURCES = {
    "refresh_estimate",
    "projection",
    "estimate",
    "estimated",
}


def _row_value(row, key, index):
    try:
        return row[key]
    except (KeyError, TypeError, IndexError):
        return row[index]


def dividend_outflows(payment_rows):
    """Paid dividends as money leaving the recorded value (money in positive).

    Only for portfolios whose recorded value does not capture paid income: a
    manually kept portfolio's value is shares x price, so a cash dividend
    never shows up in it. Estimated/projection rows are excluded.
    """
    flows = []
    for row in payment_rows:
        payment_date = str(_row_value(row, "payment_date", 0) or "")[:10]
        source = str(_row_value(row, "source", 2) or "").strip().lower()
        if not payment_date or source in NON_ACTUAL_DIVIDEND_SOURCES:
            continue
        try:
            amount = float(_row_value(row, "amount", 1) or 0)
        except (TypeError, ValueError):
            continue
        if amount:
            flows.append((payment_date, -amount))
    return flows


def activity_flows(activity_rows, price_on=None):
    """Signed external flows from EXTERNAL_FLOW account_activity rows.

    Returns ``(flows, unvalued)``. A security journal written as an OUT row
    and a matching IN row (same account, day, ticker and share count) moves
    nothing out of the account, so the pair cancels before any pricing.
    """
    rows = [dict(row) for row in activity_rows]
    security_legs = {}
    for index, row in enumerate(rows):
        if row.get("base_amount") is not None or not row.get("ticker") or not row.get("quantity"):
            continue
        key = (
            row.get("profile_id"),
            str(row.get("activity_date") or "")[:10],
            str(row["ticker"]).upper(),
            abs(float(row["quantity"])),
        )
        direction = str(row.get("direction") or "").upper()
        security_legs.setdefault(key, {"IN": [], "OUT": []}).setdefault(direction, []).append(index)
    cancelled = set()
    for legs in security_legs.values():
        for leg_in, leg_out in zip(legs["IN"], legs["OUT"]):
            cancelled.update((leg_in, leg_out))

    flows = []
    unvalued = 0
    for index, row in enumerate(rows):
        if index in cancelled:
            continue
        value = flow_value(row, price_on)
        if value is None:
            unvalued += 1
            continue
        if value:
            flows.append((str(row["activity_date"])[:10], value))
    return flows, unvalued


def build_nav_history_payload(nav_rows, flows=()):
    """Add a total-return value to each NAV point, anchored at the latest one.

    ``flows`` is ``[(date, amount)]`` with money in positive: deposits and
    withdrawals for broker accounts, whose recorded value already holds every
    dividend (reinvested as shares or sitting in cash), plus paid dividends as
    outflows for manually kept portfolios, whose value never sees them.

    Like an adjusted close, the latest point equals the recorded value and
    each earlier point is shifted by the net money that left after it, so the
    change from any point to today is investment gain, never a deposit or a
    withdrawal. A flow belongs to the first recorded value on or after its
    date, since a recorded value is taken after that day's activity.
    """
    points = []
    for row in nav_rows:
        nav_date = str(_row_value(row, "nav_date", 0) or "")[:10]
        try:
            value = float(_row_value(row, "total_value", 1))
        except (TypeError, ValueError):
            continue
        try:
            source = _row_value(row, "source", 2)
        except (IndexError, KeyError):
            source = None
        if nav_date:
            points.append((nav_date, value, source))
    points.sort(key=lambda item: item[0])
    if not points:
        return []

    first_date, last_date = points[0][0], points[-1][0]
    flow_by_date = {}
    for day, amount in flows or ():
        day = str(day or "")[:10]
        if first_date < day <= last_date:
            flow_by_date[day] = flow_by_date.get(day, 0.0) + float(amount)

    # Walk backwards so each point sees only the flows dated after it.
    dated_flows = sorted(flow_by_date.items(), reverse=True)
    flow_index = 0
    net_withdrawn_after = 0.0
    payload = []
    for nav_date, value, source in reversed(points):
        while flow_index < len(dated_flows) and dated_flows[flow_index][0] > nav_date:
            net_withdrawn_after -= dated_flows[flow_index][1]
            flow_index += 1
        payload.append({
            "date": nav_date,
            "value": round(value, 2),
            "total_return_value": round(value - net_withdrawn_after, 2),
            "net_withdrawn_after": round(net_withdrawn_after, 2),
            "source": source,
        })
    payload.reverse()
    return payload
