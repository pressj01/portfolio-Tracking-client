"""Helpers for the Dashboard portfolio-value history chart."""


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


def build_nav_history_payload(nav_rows, payment_rows):
    """Add an income-aware value to NAV points without moving the baseline.

    Total return starts at the same value as price return, then adds actual
    dividend cash paid after the first visible NAV date. Estimated/projection
    rows are deliberately excluded.
    """
    points = []
    for row in nav_rows:
        nav_date = str(_row_value(row, "nav_date", 0) or "")[:10]
        try:
            value = float(_row_value(row, "total_value", 1))
        except (TypeError, ValueError):
            continue
        if nav_date:
            points.append((nav_date, value))
    points.sort(key=lambda item: item[0])
    if not points:
        return []

    first_nav_date = points[0][0]
    payments_by_date = {}
    for row in payment_rows:
        payment_date = str(_row_value(row, "payment_date", 0) or "")[:10]
        source = str(_row_value(row, "source", 2) or "").strip().lower()
        if not payment_date or payment_date <= first_nav_date:
            continue
        if source in NON_ACTUAL_DIVIDEND_SOURCES:
            continue
        try:
            amount = float(_row_value(row, "amount", 1) or 0)
        except (TypeError, ValueError):
            continue
        payments_by_date[payment_date] = payments_by_date.get(payment_date, 0.0) + amount

    dated_payments = sorted(payments_by_date.items())
    payment_index = 0
    cumulative_dividends = 0.0
    payload = []
    for nav_date, value in points:
        while payment_index < len(dated_payments) and dated_payments[payment_index][0] <= nav_date:
            cumulative_dividends += dated_payments[payment_index][1]
            payment_index += 1
        payload.append({
            "date": nav_date,
            "value": round(value, 2),
            "total_return_value": round(value + cumulative_dividends, 2),
            "cumulative_dividends": round(cumulative_dividends, 2),
        })
    return payload
