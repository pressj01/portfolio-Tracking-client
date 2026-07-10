from datetime import date, datetime, timedelta, timezone


def _coerce_date(value):
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _nth_weekday(year, month, weekday, n):
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + (n - 1) * 7)


def _last_weekday(year, month, weekday):
    if month == 12:
        last = date(year, 12, 31)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _easter_date(year):
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _observed_fixed_holiday(year, month, day, observe_saturday=True):
    actual = date(year, month, day)
    if actual.weekday() == 5:
        return actual - timedelta(days=1) if observe_saturday else None
    if actual.weekday() == 6:
        return actual + timedelta(days=1)
    return actual


def nyse_market_holidays(year):
    """Return regular NYSE full-day market holidays for a calendar year."""
    holidays = {}

    new_year = _observed_fixed_holiday(year, 1, 1, observe_saturday=False)
    if new_year and new_year.year == year:
        holidays[new_year] = "New Year's Day"

    holidays[_nth_weekday(year, 1, 0, 3)] = "Martin Luther King Jr. Day"
    holidays[_nth_weekday(year, 2, 0, 3)] = "Washington's Birthday"
    holidays[_easter_date(year) - timedelta(days=2)] = "Good Friday"
    holidays[_last_weekday(year, 5, 0)] = "Memorial Day"

    if year >= 2022:
        juneteenth = _observed_fixed_holiday(year, 6, 19)
        if juneteenth and juneteenth.year == year:
            holidays[juneteenth] = "Juneteenth National Independence Day"

    independence = _observed_fixed_holiday(year, 7, 4)
    if independence and independence.year == year:
        holidays[independence] = "Independence Day"

    holidays[_nth_weekday(year, 9, 0, 1)] = "Labor Day"
    holidays[_nth_weekday(year, 11, 3, 4)] = "Thanksgiving Day"

    christmas = _observed_fixed_holiday(year, 12, 25)
    if christmas and christmas.year == year:
        holidays[christmas] = "Christmas Day"

    return holidays


def nyse_closure_reason(value):
    day = _coerce_date(value)
    if day.weekday() >= 5:
        return "weekend"
    return nyse_market_holidays(day.year).get(day)


def is_nyse_trading_day(value):
    return nyse_closure_reason(value) is None


# US Eastern is UTC-5 (EST) or UTC-4 (EDT). DST runs from the 2nd Sunday of
# March through the 1st Sunday of November. We derive the offset ourselves so
# the app never depends on the platform IANA tz database (absent on stock
# Windows) and so an odd machine clock/timezone can't mis-time the capture.
def _us_eastern_is_dst(day):
    year = day.year
    dst_start = _nth_weekday(year, 3, 6, 2)   # 2nd Sunday of March
    dst_end = _nth_weekday(year, 11, 6, 1)    # 1st Sunday of November
    return dst_start <= day < dst_end


def eastern_now(now_utc=None):
    """Return the current instant as a US/Eastern-aware datetime."""
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    elif now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    offset = -4 if _us_eastern_is_dst(now_utc.date()) else -5
    return now_utc.astimezone(timezone(timedelta(hours=offset)))


# The regular NYSE session ends at 16:00 ET. A short buffer lets the settled
# closing print post to the data provider before we capture it as the close.
NYSE_CLOSE_HOUR = 16
NYSE_CLOSE_BUFFER_MINUTES = 15


def market_has_closed(now_et=None):
    """True once 16:00 ET plus the settle buffer has passed (in Eastern time)."""
    if now_et is None:
        now_et = eastern_now()
    cutoff = now_et.replace(
        hour=NYSE_CLOSE_HOUR,
        minute=NYSE_CLOSE_BUFFER_MINUTES,
        second=0,
        microsecond=0,
    )
    return now_et >= cutoff
