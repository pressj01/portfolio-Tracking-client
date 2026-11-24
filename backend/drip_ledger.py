"""DRIP ledger: what each holding's distributions bought, month by month.

Every confirmed payment (``dividend_payments``) is paired with the ``[DRIP]``
buy that reinvested it (``transactions``). Share counts are replayed backwards
from today's broker quantity, the way the dividend calendar works out who was
entitled to an ex-date, so a ledger that starts after the position was opened
still lands on the shares the account really holds.

With ``model_all`` every payment that was taken as cash is reinvested at that
day's close as well, those shares earn the payments after them, and a holding
with no payment records at all is modeled from the fund's distribution
history. That is the "as if every holding were on DRIP" view.

The same pairing decides what each account's DRIP checkbox should say: the
newest evidence wins, whether it is a broker positions file, a payment that
was or was not reinvested, or the box ticked by hand.
"""

from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import date, timedelta
import re

from distribution_analysis import ESTIMATE_SOURCES

# A reinvestment posts on the payment date at most brokers, but some record it
# a few days either side of the cash row.
PAIR_DAYS_BEFORE = 3
PAIR_DAYS_AFTER = 7
# A cash payment this close to the account's newest record may still get its
# reinvestment buy in the next import, so it is not yet evidence of "cash".
SETTLE_DAYS = 4
# Typed-in payments say nothing about whether a reinvestment followed.
NON_EVIDENCE_SOURCES = ("manual",)
MAX_MONTHS = 240
REINVEST_LOOKBACK_DAYS = 400
_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")


# ── Small helpers ─────────────────────────────────────────────────────────────

def _day(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number else 0.0


def _row_value(row, key, index):
    try:
        return row[key]
    except (IndexError, KeyError, TypeError):
        return row[index]


def is_drip_notes(notes):
    """Same test the importers' ``[DRIP]`` tagging and the DRIP tracker use."""
    text = str(notes or "").casefold()
    return "[drip]" in text or "reinvest" in text


def month_key(day):
    return f"{day.year:04d}-{day.month:02d}"


def month_start(key):
    year, month = map(int, key.split("-"))
    return date(year, month, 1)


def next_month(day):
    return date(day.year + (day.month == 12), day.month % 12 + 1, 1)


def month_keys(start_key, end_key):
    keys, cursor, end = [], month_start(start_key), month_start(end_key)
    while cursor <= end:
        keys.append(month_key(cursor))
        cursor = next_month(cursor)
    return keys


def parse_range(start, end, today):
    """Validate 'YYYY-MM' bounds; the default is the trailing 12 months."""
    current = month_key(today)
    if not start:
        year, month = today.year, today.month - 11
        while month <= 0:
            month += 12
            year -= 1
        start = f"{year:04d}-{month:02d}"
    end = end or current
    for value in (start, end):
        match = _MONTH_RE.match(str(value))
        if not match or not 1 <= int(match.group(2)) <= 12 or int(match.group(1)) < 1900:
            raise ValueError("Months must be written as YYYY-MM.")
    if end > current:
        end = current
    if start > end:
        raise ValueError("The start month must be on or before the end month.")
    if len(month_keys(start, end)) > MAX_MONTHS:
        raise ValueError(f"Choose a range of at most {MAX_MONTHS // 12} years.")
    return start, end


def _cost_fits(cost, amount, price):
    """Whether a reinvestment costing ``cost`` can be the payment of ``amount``.

    Whole-share DRIP leaves up to one share's price behind as cash, and
    brokers round shares and prices differently, so allow both.
    """
    return cost <= amount * 1.03 + 0.05 and amount - cost <= max(price, amount * 0.03) + 0.05


def pair_payments(payments, drip_buys):
    """Pair each ``[DRIP]`` buy with the payment it reinvested.

    ``payments`` are dicts with ``day`` and ``amount`` (and optional ``ex``,
    ``source``); ``drip_buys`` have ``day``, ``shares`` and ``price``. Returns
    payment events sorted by day, each with ``reinvested`` dollars, ``shares``
    bought and their average ``price``. A payment nothing reinvested is cash.
    A buy with no payment record still happened, so it becomes a payment of
    its own cost (``synthetic``).
    """
    events = [dict(p, reinvested=0.0, shares=0.0, cost=0.0, buys=[])
              for p in sorted(payments, key=lambda p: p["day"])]
    for buy in sorted(drip_buys, key=lambda b: b["day"]):
        price = _num(buy.get("price"))
        cost = buy["shares"] * price if price > 0 else None
        best = None
        for event in events:
            if event.get("synthetic"):
                continue
            gap = (buy["day"] - event["day"]).days
            if not -PAIR_DAYS_BEFORE <= gap <= PAIR_DAYS_AFTER:
                continue
            if cost is not None and not _cost_fits(event["cost"] + cost, event["amount"], price):
                continue
            if cost is None and event["buys"]:
                continue
            score = (len(event["buys"]), abs(gap), abs((cost or event["amount"]) - event["amount"]))
            if best is None or score < best[0]:
                best = (score, event)
        if best is None:
            if cost is None or cost <= 0:
                continue
            events.append({"day": buy["day"], "ex": None, "amount": cost, "source": "drip_record",
                           "synthetic": True, "reinvested": cost, "shares": buy["shares"],
                           "cost": cost, "buys": [buy], "profile_id": buy.get("profile_id")})
            continue
        event = best[1]
        event["buys"].append(buy)
        event["shares"] += buy["shares"]
        event["cost"] += cost if cost is not None else event["amount"]
    for event in events:
        event["reinvested"] = min(event["cost"], event["amount"]) if event["shares"] > 0 else 0.0
        event["price"] = event["cost"] / event["shares"] if event["shares"] > 0 else None
    events.sort(key=lambda e: (e["day"], 1 if e.get("synthetic") else 0))
    return events


# ── Market data (prices, distributions, splits) ───────────────────────────────

class Market:
    """Daily closes, per-share distributions and splits in today's share units."""

    def __init__(self, payload):
        payload = payload or {}
        prices = sorted((d, _num(p.get("close"))) for p in payload.get("prices") or ()
                        if (d := _day(p.get("date"))) is not None and _num(p.get("close")) > 0)
        self.days = [d for d, _ in prices]
        self.closes = [c for _, c in prices]
        self.distributions = sorted((d, _num(p.get("amount"))) for p in payload.get("distributions") or ()
                                    if (d := _day(p.get("date"))) is not None and _num(p.get("amount")) > 0)
        self.splits = sorted((d, _num(s.get("ratio"))) for s in payload.get("splits") or ()
                             if (d := _day(s.get("date"))) is not None and _num(s.get("ratio")) > 0)

    def close_on_or_before(self, day):
        index = bisect_right(self.days, day)
        return self.closes[index - 1] if index else None

    def factor_after(self, day):
        factor = 1.0
        for split_day, ratio in self.splits:
            if split_day > day:
                factor *= ratio
        return factor


def to_todays_units(trades, quantity, market):
    """Restate as-traded share counts in today's units after a split.

    Market closes are split-adjusted. Schwab-style ledgers keep each trade as
    it was traded, while Snowball imports already restate them. Prefer
    whichever reading lands closer to the quantity the account holds now (a
    tie converts), the rule the performance engines use.
    """
    if not trades or market is None or not market.splits:
        return trades
    factors = [market.factor_after(t["day"]) for t in trades]
    if all(abs(f - 1.0) < 1e-12 for f in factors):
        return trades
    native = sum(t["signed"] for t in trades)
    restated = sum(t["signed"] * f for t, f in zip(trades, factors))
    if abs(quantity - restated) > abs(quantity - native) + 1e-8:
        return trades
    return [dict(t, shares=t["shares"] * f, signed=t["signed"] * f,
                 price=(t["price"] / f) if t.get("price") else t.get("price"))
            for t, f in zip(trades, factors)]


# ── One account's position ────────────────────────────────────────────────────

class Position:
    """One account's holding of one ticker, with its trades and payments."""

    def __init__(self, profile_id, ticker, quantity, trades, payments, market=None):
        self.profile_id = profile_id
        self.ticker = ticker
        self.quantity = max(0.0, _num(quantity))
        trades = sorted(trades, key=lambda t: (t["day"], t.get("order", 0)))
        self.trades = to_todays_units(trades, self.quantity, market)
        self.days = [t["day"] for t in self.trades]
        self.suffix = [0.0] * (len(self.trades) + 1)
        for i in range(len(self.trades) - 1, -1, -1):
            self.suffix[i] = self.suffix[i + 1] + self.trades[i]["signed"]
        self.payments = sorted(payments, key=lambda p: p["day"])
        self.market = market

    def shares_before(self, day):
        """Shares held at the start of ``day``: today's count less later trades."""
        return max(0.0, self.quantity - self.suffix[bisect_left(self.days, day)])

    def shares_around(self, index):
        """(before, after) the trade at ``index``."""
        after = max(0.0, self.quantity - self.suffix[index + 1])
        return max(0.0, after - self.trades[index]["signed"]), after

    def has_drip_buy(self, start_day, end_bound):
        return any(t["drip"] and start_day <= t["day"] < end_bound for t in self.trades)

    def has_payment(self, start_day, end_bound):
        return any(start_day <= p["day"] < end_bound for p in self.payments)


def replay_position(position, months, today, model_all=False, model_from_market=False):
    """Month-by-month DRIP records for one account's position.

    Returns {month_key: record}. Each record has the shares entering and
    leaving the month, the payments in it with what each bought, and the
    shares bought by reinvesting since the range began (scaled down when the
    account sold part of the position).
    """
    market = position.market
    start_day = month_start(months[0])
    end_bound = min(next_month(month_start(months[-1])), today + timedelta(days=1))
    pair_floor = start_day - timedelta(days=PAIR_DAYS_AFTER + PAIR_DAYS_BEFORE)
    payments = [p for p in position.payments if pair_floor <= p["day"] < end_bound]
    buys = [t for t in position.trades
            if t["drip"] and pair_floor <= t["day"] < end_bound + timedelta(days=PAIR_DAYS_AFTER)
            and t["day"] <= today]
    events = [e for e in pair_payments(payments, buys) if start_day <= e["day"] < end_bound]

    if model_from_market and not events and market is not None:
        for day, per_share in market.distributions:
            if start_day <= day < end_bound:
                held = position.shares_before(day)
                if held > 0:
                    events.append({"day": day, "ex": day, "amount": per_share * held,
                                   "per_share": per_share, "reinvested": 0.0, "shares": 0.0,
                                   "price": None, "source": "market", "from_market": True})

    timeline = [(e["day"], 0, "pay", e) for e in events]
    for index, trade in enumerate(position.trades):
        if start_day <= trade["day"] < end_bound and not trade["drip"]:
            timeline.append((trade["day"], 1, "trade", index))
    timeline.sort(key=lambda item: (item[0], item[1]))

    records = {}
    cursor = 0
    drip_cum = 0.0   # shares bought by actual reinvestment since the range began
    modeled = 0.0    # shares that modeled reinvestment would have added
    for key in months:
        m0 = month_start(key)
        if m0 > today:
            break
        m1 = next_month(m0)
        record = {
            "base": position.shares_before(m0) + modeled,
            "distribution": 0.0, "reinvested": 0.0, "cash": 0.0, "shares_bought": 0.0,
            "other_shares": 0.0, "income_from_drip": 0.0, "extra_income": 0.0,
            "modeled": False, "payments": [],
        }
        while cursor < len(timeline) and timeline[cursor][0] < m1:
            day, _, kind, item = timeline[cursor]
            cursor += 1
            if kind == "trade":
                trade = position.trades[item]
                record["other_shares"] += trade["signed"]
                if trade["signed"] < 0:
                    before, after = position.shares_around(item)
                    ratio = min(1.0, after / before) if before > 0 else 0.0
                    drip_cum *= ratio
                    modeled *= ratio
                continue
            event = item
            entitle_day = event.get("ex") or event["day"]
            held = position.shares_before(entitle_day)
            per_share = event.get("per_share") or (event["amount"] / held if held > 0 else None)
            drip_held = min(drip_cum, held) + modeled
            extra = per_share * modeled if (model_all and per_share) else 0.0
            cash = max(0.0, event["amount"] - event["reinvested"])
            modeled_amount = modeled_shares = 0.0
            modeled_price = None
            if model_all and cash + extra > 0.005:
                modeled_price = (market.close_on_or_before(event["day"]) if market else None) or event.get("price")
                if modeled_price:
                    modeled_amount = cash + extra
                    modeled_shares = modeled_amount / modeled_price
            drip_cum += event["shares"]
            modeled += modeled_shares
            is_modeled = bool(modeled_shares or extra or event.get("from_market"))
            record["distribution"] += event["amount"] + extra
            record["reinvested"] += event["reinvested"] + modeled_amount
            record["cash"] += max(0.0, cash + extra - modeled_amount)
            record["shares_bought"] += event["shares"] + modeled_shares
            record["income_from_drip"] += per_share * drip_held if per_share else 0.0
            record["extra_income"] += extra
            record["modeled"] = record["modeled"] or is_modeled
            if event.get("from_market"):
                kind_label = "modeled"
            elif event["shares"] > 0:
                kind_label = "partial" if cash > 0.01 and not modeled_shares else "drip"
            else:
                kind_label = "modeled" if modeled_shares else "cash"
            record["payments"].append({
                "date": event["day"].isoformat(), "profile_id": position.profile_id,
                "amount": round(event["amount"] + extra, 2), "paid": round(event["amount"], 2),
                "extra": round(extra, 2), "per_share": round(per_share, 6) if per_share else None,
                "shares_held": round(held + (modeled - modeled_shares), 6),
                "reinvested": round(event["reinvested"] + modeled_amount, 2),
                "shares": round(event["shares"] + modeled_shares, 6),
                "price": round(event["price"], 4) if event.get("price") else (round(modeled_price, 4) if modeled_price else None),
                "cash": round(max(0.0, cash + extra - modeled_amount), 2),
                "kind": kind_label, "synthetic": bool(event.get("synthetic")),
            })
        end_day = min(m1, today + timedelta(days=1))
        actual_end = position.shares_before(end_day)
        drip_cum = min(drip_cum, actual_end)
        record["end"] = actual_end + modeled
        record["drip_shares"] = drip_cum + modeled
        record["price_day"] = min(m1 - timedelta(days=1), today)
        records[key] = record
    return records


def _source_label(row):
    if row["modeled"]:
        return "Modeled"
    if row["drip_amount"] > 0.005 and row["cash"] > 0.01:
        return "Partly cash"
    if row["drip_amount"] > 0.005:
        return "Actual"
    return "Cash"


# ── Database reads ────────────────────────────────────────────────────────────

def _marks(values):
    return ",".join("?" for _ in values)


def _estimate_filter():
    return f"LOWER(TRIM(COALESCE(source, ''))) NOT IN ({_marks(ESTIMATE_SOURCES)})"


def _drip_note_sql(alias=""):
    prefix = f"{alias}." if alias else ""
    return f"({prefix}notes LIKE '%[DRIP]%' OR LOWER(COALESCE({prefix}notes, '')) LIKE '%reinvest%')"


def ledger_candidates(conn, profile_ids, start_key, end_key, model_all, today):
    """Tickers the ledger lists for these accounts and months.

    Without ``model_all`` that is every ticker an account reinvested in the
    range. With it, also every ticker that paid anything, and every current
    income holding (modeled from its distribution history if it has no
    records). Also returns the earliest month any record exists, and the
    holdings marked DRIP that have no reinvestment records in the range.
    """
    ids = list(dict.fromkeys(int(pid) for pid in profile_ids))
    if not ids:
        return {"tickers": [], "first_month": None, "flagged_without_records": []}
    start = month_start(start_key).isoformat()
    end = min(next_month(month_start(end_key)) - timedelta(days=1), today).isoformat()
    marks = _marks(ids)
    descriptions = {}
    held_income = set()
    flagged = set()
    for row in conn.execute(
        f"""SELECT UPPER(TRIM(ticker)) AS ticker, MAX(description) AS description,
                   SUM(COALESCE(quantity, 0)) AS quantity,
                   MAX(CASE WHEN COALESCE(div, 0) > 0 OR COALESCE(estim_payment_per_year, 0) > 0 THEN 1 ELSE 0 END) AS pays,
                   MAX(CASE WHEN reinvest = 'Y' AND COALESCE(quantity, 0) > 0 THEN 1 ELSE 0 END) AS flagged
            FROM all_account_info WHERE profile_id IN ({marks}) GROUP BY 1""", ids,
    ):
        descriptions[row["ticker"]] = row["description"] or ""
        if _num(row["quantity"]) > 1e-9 and row["pays"]:
            held_income.add(row["ticker"])
        if row["flagged"]:
            flagged.add(row["ticker"])
    drip = {row[0] for row in conn.execute(
        f"""SELECT DISTINCT UPPER(TRIM(ticker)) FROM transactions
            WHERE profile_id IN ({marks}) AND UPPER(COALESCE(transaction_type, '')) = 'BUY'
              AND transaction_date >= ? AND transaction_date <= ? AND {_drip_note_sql()}""",
        [*ids, start, end],
    )}
    tickers = set(drip)
    if model_all:
        tickers |= {row[0] for row in conn.execute(
            f"""SELECT DISTINCT UPPER(TRIM(ticker)) FROM dividend_payments
                WHERE profile_id IN ({marks}) AND payment_date >= ? AND payment_date <= ?
                  AND amount > 0 AND {_estimate_filter()}""",
            [*ids, start, end, *ESTIMATE_SOURCES],
        )}
        tickers |= held_income
    first = None
    for row in conn.execute(
        f"""SELECT MIN(day) FROM (
                SELECT MIN(transaction_date) AS day FROM transactions
                WHERE profile_id IN ({marks}) AND UPPER(COALESCE(transaction_type, '')) = 'BUY' AND {_drip_note_sql()}
                UNION ALL
                SELECT MIN(payment_date) FROM dividend_payments
                WHERE profile_id IN ({marks}) AND amount > 0 AND {_estimate_filter()})""",
        [*ids, *ids, *ESTIMATE_SOURCES],
    ):
        day = _day(row[0])
        first = month_key(day) if day and day <= today else None
    tickers.discard("")
    return {
        "tickers": [{"ticker": t, "description": descriptions.get(t, "")} for t in sorted(tickers)],
        "first_month": first,
        "flagged_without_records": sorted(flagged - drip),
    }


def _load_positions(conn, profile_ids, tickers, since, today):
    """Holdings, trades (all of them, for the backwards replay) and payments."""
    ids = list(dict.fromkeys(int(pid) for pid in profile_ids))
    tickers = sorted({str(t).strip().upper() for t in tickers if str(t).strip()})
    if not ids or not tickers:
        return {}, {}, {}
    id_marks, t_marks = _marks(ids), _marks(tickers)
    holdings = {}
    for row in conn.execute(
        f"""SELECT profile_id, UPPER(TRIM(ticker)) AS ticker, SUM(COALESCE(quantity, 0)) AS quantity,
                   MAX(description) AS description, MAX(div) AS div,
                   MAX(estim_payment_per_year) AS estim
            FROM all_account_info WHERE profile_id IN ({id_marks}) AND UPPER(TRIM(ticker)) IN ({t_marks})
            GROUP BY 1, 2""", [*ids, *tickers],
    ):
        holdings[(int(row["profile_id"]), row["ticker"])] = dict(row)
    trades = defaultdict(list)
    for order, row in enumerate(conn.execute(
        f"""SELECT profile_id, UPPER(TRIM(ticker)) AS ticker, transaction_date,
                   UPPER(transaction_type) AS kind, shares, price_per_share, notes
            FROM transactions
            WHERE profile_id IN ({id_marks}) AND UPPER(TRIM(ticker)) IN ({t_marks})
              AND UPPER(COALESCE(transaction_type, '')) IN ('BUY', 'SELL') AND transaction_date <= ?
            ORDER BY transaction_date, COALESCE(sort_order, id), id""",
        [*ids, *tickers, today.isoformat()],
    )):
        day = _day(row["transaction_date"])
        shares = abs(_num(row["shares"]))
        if day is None or shares <= 0:
            continue
        buy = row["kind"] == "BUY"
        trades[(int(row["profile_id"]), row["ticker"])].append({
            "day": day, "order": order, "kind": row["kind"], "shares": shares,
            "signed": shares if buy else -shares, "price": _num(row["price_per_share"]) or None,
            "drip": buy and is_drip_notes(row["notes"]), "profile_id": int(row["profile_id"]),
        })
    payments = defaultdict(list)
    for row in conn.execute(
        f"""SELECT profile_id, UPPER(TRIM(ticker)) AS ticker, payment_date, ex_date, amount, source
            FROM dividend_payments
            WHERE profile_id IN ({id_marks}) AND UPPER(TRIM(ticker)) IN ({t_marks})
              AND payment_date >= ? AND payment_date <= ? AND amount > 0 AND {_estimate_filter()}""",
        [*ids, *tickers, since.isoformat(), today.isoformat(), *ESTIMATE_SOURCES],
    ):
        day = _day(row["payment_date"])
        if day is None:
            continue
        ex = _day(row["ex_date"])
        payments[(int(row["profile_id"]), row["ticker"])].append({
            "day": day, "ex": ex if ex and ex <= day else None, "amount": _num(row["amount"]),
            "source": str(row["source"] or "").strip().lower(), "profile_id": int(row["profile_id"]),
        })
    return holdings, trades, payments


def build_drip_ledger(conn, profile_ids, tickers, start_key, end_key, *, model_all=False,
                      markets=None, account_names=None, today=None):
    """Monthly DRIP rows for ``tickers``, summed over the accounts that hold them.

    ``markets`` maps ticker -> market payload (prices, distributions, splits)
    or None when it could not be loaded; month-end values and modeling need it.
    """
    today = today or date.today()
    months = month_keys(start_key, end_key)
    start_day = month_start(months[0])
    end_bound = min(next_month(month_start(months[-1])), today + timedelta(days=1))
    since = start_day - timedelta(days=PAIR_DAYS_AFTER + PAIR_DAYS_BEFORE)
    holdings, trades, payments = _load_positions(conn, profile_ids, tickers, since, today)
    markets = markets or {}
    names = account_names or {}
    keys = sorted(set(holdings) | set(trades) | set(payments))
    by_ticker = defaultdict(list)
    for key in keys:
        by_ticker[key[1]].append(key)

    rows, statuses = [], []
    current = month_key(today)
    for ticker in sorted({str(t).strip().upper() for t in tickers if str(t).strip()}):
        payload = markets.get(ticker)
        market = Market(payload) if payload else None
        description = ""
        positions = []
        for key in by_ticker.get(ticker, ()):
            holding = holdings.get(key) or {}
            description = description or holding.get("description") or ""
            position = Position(key[0], ticker, holding.get("quantity"), trades.get(key, []),
                                payments.get(key, []), market)
            reinvested = position.has_drip_buy(start_day, end_bound)
            pays = position.has_payment(start_day, end_bound)
            income_holding = position.quantity > 1e-9 and (_num(holding.get("div")) > 0 or _num(holding.get("estim")) > 0)
            if reinvested or (model_all and (pays or income_holding)):
                positions.append((position, model_all and not pays and not reinvested))
        status = {"ticker": ticker, "description": description,
                  "market": "ok" if market and market.days else "unavailable"}
        if not positions:
            status["message"] = "No reinvestment records in this range."
            statuses.append(status)
            continue
        replays = [(position, replay_position(position, months, today, model_all, from_market))
                   for position, from_market in positions]
        if market is None and any(from_market for _, from_market in positions):
            status["message"] = "No payment records, and the fund's distribution history could not be loaded to model them."
        elif market is None:
            status["message"] = "Market prices could not be loaded, so month-end values are blank."
        emitted = 0
        for key in months:
            records = [(position, records[key]) for position, records in replays if key in records]
            if not any(record["payments"] for _, record in records):
                continue
            row = {"month": key, "ticker": ticker, "description": description, "partial": key == current,
                   "base_shares": 0.0, "distribution": 0.0, "drip_amount": 0.0, "cash": 0.0,
                   "shares_bought": 0.0, "other_shares": 0.0, "end_shares": 0.0, "drip_shares": 0.0,
                   "income_from_drip": 0.0, "extra_income": 0.0, "modeled": False, "payments": []}
            for position, record in records:
                row["base_shares"] += record["base"]
                row["distribution"] += record["distribution"]
                row["drip_amount"] += record["reinvested"]
                row["cash"] += record["cash"]
                row["shares_bought"] += record["shares_bought"]
                row["other_shares"] += record["other_shares"]
                row["end_shares"] += record["end"]
                row["drip_shares"] += record["drip_shares"]
                row["income_from_drip"] += record["income_from_drip"]
                row["extra_income"] += record["extra_income"]
                row["modeled"] = row["modeled"] or record["modeled"]
                for payment in record["payments"]:
                    row["payments"].append(dict(payment, account=names.get(payment["profile_id"], str(payment["profile_id"]))))
            row["payments"].sort(key=lambda p: (p["date"], p["account"]))
            price_day = min(next_month(month_start(key)) - timedelta(days=1), today)
            close = market.close_on_or_before(price_day) if market else None
            row["month_end_price"] = round(close, 4) if close else None
            row["value_of_drip"] = round(row["drip_shares"] * close, 2) if close else None
            # The whole holding at the month-end close, so the growth from shares
            # reinvesting added shows next to the shares themselves.
            row["total_value"] = round(row["end_shares"] * close, 2) if close else None
            row["avg_price"] = round(row["drip_amount"] / row["shares_bought"], 4) if row["shares_bought"] > 1e-9 else None
            row["source"] = _source_label(row)
            for field in ("base_shares", "shares_bought", "other_shares", "end_shares", "drip_shares"):
                row[field] = round(row[field], 6)
            for field in ("distribution", "drip_amount", "cash", "income_from_drip", "extra_income"):
                row[field] = round(row[field], 2)
            rows.append(row)
            emitted += 1
        if not emitted and "message" not in status:
            status["message"] = "No payments in this range."
        statuses.append(status)
    return {"rows": rows, "tickers": statuses}


# ── DRIP checkbox evidence ────────────────────────────────────────────────────

def detect_reinvest_evidence(conn, profile_ids, today=None, lookback_days=REINVEST_LOOKBACK_DAYS):
    """What each held position's newest payment says about DRIP.

    Returns {(profile_id, TICKER): {"flag": "Y"|"N", "day": date, "note": str}}.
    A payment its ``[DRIP]`` buy reinvested says Y. A payment with no buy
    says N, but only once the account has records a few days past it (the
    buy may come in the next import) and only when the payment came from a
    broker file rather than being typed in.
    """
    today = today or date.today()
    ids = list(dict.fromkeys(int(pid) for pid in profile_ids or ()))
    if not ids:
        return {}
    since = today - timedelta(days=lookback_days)
    marks = _marks(ids)
    held = {(int(row[0]), row[1]) for row in conn.execute(
        f"""SELECT profile_id, UPPER(TRIM(ticker)) FROM all_account_info
            WHERE profile_id IN ({marks}) AND COALESCE(quantity, 0) > 1e-9""", ids)}
    if not held:
        return {}
    latest = {}
    for row in conn.execute(
        f"""SELECT profile_id, MAX(day) FROM (
                SELECT profile_id, transaction_date AS day FROM transactions
                WHERE profile_id IN ({marks}) AND transaction_date <= ?
                UNION ALL
                SELECT profile_id, payment_date FROM dividend_payments
                WHERE profile_id IN ({marks}) AND payment_date <= ? AND {_estimate_filter()})
            GROUP BY profile_id""",
        [*ids, today.isoformat(), *ids, today.isoformat(), *ESTIMATE_SOURCES],
    ):
        latest[int(row[0])] = _day(row[1])
    window = since - timedelta(days=PAIR_DAYS_AFTER + PAIR_DAYS_BEFORE)
    pays, buys = defaultdict(list), defaultdict(list)
    for row in conn.execute(
        f"""SELECT profile_id, UPPER(TRIM(ticker)) AS ticker, payment_date, amount, source
            FROM dividend_payments WHERE profile_id IN ({marks}) AND payment_date >= ? AND payment_date <= ?
              AND amount > 0 AND {_estimate_filter()}""",
        [*ids, window.isoformat(), today.isoformat(), *ESTIMATE_SOURCES],
    ):
        key = (int(row["profile_id"]), row["ticker"])
        if key in held and (day := _day(row["payment_date"])):
            pays[key].append({"day": day, "amount": _num(row["amount"]),
                              "source": str(row["source"] or "").strip().lower()})
    for row in conn.execute(
        f"""SELECT profile_id, UPPER(TRIM(ticker)) AS ticker, transaction_date, shares, price_per_share
            FROM transactions WHERE profile_id IN ({marks}) AND UPPER(COALESCE(transaction_type, '')) = 'BUY'
              AND transaction_date >= ? AND transaction_date <= ? AND {_drip_note_sql()}""",
        [*ids, window.isoformat(), today.isoformat()],
    ):
        key = (int(row["profile_id"]), row["ticker"])
        shares = abs(_num(row["shares"]))
        if key in held and shares > 0 and (day := _day(row["transaction_date"])):
            buys[key].append({"day": day, "shares": shares, "price": _num(row["price_per_share"]) or None})
    evidence = {}
    for key in held:
        if not pays.get(key) and not buys.get(key):
            continue
        newest = latest.get(key[0])
        for event in reversed(pair_payments(pays.get(key, []), buys.get(key, []))):
            if event["day"] < since:
                break
            if event["shares"] > 0:
                price = f" @ ${event['price']:,.2f}" if event.get("price") else ""
                evidence[key] = {"flag": "Y", "day": event["day"],
                                 "note": f"Reinvested the {event['day'].isoformat()} payment ({event['shares']:,.4f} sh{price})."}
                break
            if event.get("source") in NON_EVIDENCE_SOURCES:
                continue
            if newest is None or (newest - event["day"]).days < SETTLE_DAYS:
                continue
            evidence[key] = {"flag": "N", "day": event["day"],
                             "note": f"The {event['day'].isoformat()} payment (${event['amount']:,.2f}) was taken as cash."}
            break
    return evidence


def apply_reinvest_evidence(conn, profile_ids, today=None, evidence=None):
    """Bring each account's DRIP flag up to its newest evidence.

    A flag set by a broker positions file or by hand carries the date it was
    set (``reinvest_as_of``); older rows fall back to their last import date.
    Payment evidence only replaces a flag when it is newer than that, so
    ticking the box by hand holds until the next payment says otherwise.
    Returns the set of tickers whose Y/N changed. The caller commits.
    """
    if evidence is None:
        evidence = detect_reinvest_evidence(conn, profile_ids, today)
    if not evidence:
        return set()
    ids = sorted({pid for pid, _ in evidence})
    has_dividends = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dividends'"
    ).fetchone() is not None
    rows = conn.execute(
        f"""SELECT profile_id, ticker, reinvest, reinvest_source, reinvest_as_of, import_date
            FROM all_account_info WHERE profile_id IN ({_marks(ids)})""", ids,
    ).fetchall()
    changed = set()
    for row in rows:
        key = (int(_row_value(row, "profile_id", 0)), str(_row_value(row, "ticker", 1) or "").strip().upper())
        found = evidence.get(key)
        if not found:
            continue
        flag = str(_row_value(row, "reinvest", 2) or "").strip().upper()
        source = _row_value(row, "reinvest_source", 3)
        as_of = _day(_row_value(row, "reinvest_as_of", 4))
        if as_of is None and source is None and flag in ("Y", "N"):
            as_of = _day(_row_value(row, "import_date", 5))
        if as_of is not None and found["day"] <= as_of and source != "records":
            continue
        if as_of is not None and source == "records" and found["day"] < as_of:
            continue
        if flag == found["flag"] and source == "records" and as_of == found["day"]:
            continue
        conn.execute(
            """UPDATE all_account_info SET reinvest = ?, reinvest_source = 'records', reinvest_as_of = ?
               WHERE profile_id = ? AND ticker = ?""",
            (found["flag"], found["day"].isoformat(), key[0], _row_value(row, "ticker", 1)),
        )
        if flag != found["flag"]:
            if has_dividends:
                conn.execute("UPDATE dividends SET reinvest = ? WHERE profile_id = ? AND ticker = ?",
                             (found["flag"], key[0], _row_value(row, "ticker", 1)))
            changed.add(key[1])
    return changed


# ── Is this a good ticker to DRIP into? ───────────────────────────────────────

FIT_YEARS = 3
MIN_FIT_DAYS = 120  # portfolio_tester.MIN_DAYS, the DRIP vs. Cash Analyzer's floor
FIT_DISPLAY_BASE = 1000.0  # payouts and end values are shown per $1,000 invested at the start
FIT_LABELS = {"DRIP": "Good DRIP candidate", "Take cash": "Not a good DRIP candidate", "Toss-up": "Borderline"}
NO_FIT = "Not enough history"


def fit_window_start(start_key, today):
    """The selected range or the last FIT_YEARS years, whichever starts earlier."""
    floor = date(today.year - FIT_YEARS, today.month, min(today.day, 28))
    return min(month_start(start_key), floor)


def evaluate_drip_fit(payload, ticker, start_day, today):
    """Would reinvesting this ticker have beaten taking the cash?

    The DRIP vs. Cash Analyzer's own test (``drip_score``), run on the
    ticker's split-adjusted closes and distributions from ``start_day`` to
    ``today``: what $1 of distributions became when reinvested versus kept as
    cash earning the analyzer's cash rate (RE), how often DRIP was ahead across
    every possible sell date, and what kind of fund the history describes.
    History only; it says nothing certain about what comes next.
    """
    import pandas as pd
    import drip_score

    prices = []
    for point in (payload or {}).get("prices") or ():
        day, close = _day(point.get("date")), _num(point.get("close"))
        if day is not None and start_day <= day <= today and close > 0:
            prices.append((day, close))
    prices.sort()
    if len(prices) < 2 or (prices[-1][0] - prices[0][0]).days < MIN_FIT_DAYS:
        return {"label": NO_FIT, "call": None,
                "reason": f"Needs at least {MIN_FIT_DAYS} days of prices in the window."}
    index = pd.DatetimeIndex([pd.Timestamp(day) for day, _ in prices])
    close = pd.Series([value for _, value in prices], index=index, dtype=float)
    divs = pd.Series(0.0, index=index)
    for point in (payload or {}).get("distributions") or ():
        day, amount = _day(point.get("date")), _num(point.get("amount"))
        if day is not None and amount > 0 and pd.Timestamp(day) in divs.index:
            divs.loc[pd.Timestamp(day)] += amount
    if not (divs > 0).any():
        return {"label": NO_FIT, "call": None,
                "reason": "No distributions in the window, so there is nothing to reinvest."}
    try:
        metrics = drip_score.compute_ticker_metrics(close, divs, ticker)
        # The same two paths the verdict compares, kept for display: what each
        # was paid and what it ended with, per $1,000 invested at the start.
        # The verdict already counts the reinvested path's extra payouts (they
        # bought the shares valued below); this only makes them visible.
        reinvest = drip_score.simulate_drip(close, divs, initial=FIT_DISPLAY_BASE, reinvest=1.0)
        cash = drip_score.simulate_drip(close, divs, initial=FIT_DISPLAY_BASE, reinvest=0.0,
                                        cash_rate=drip_score.DEFAULT_CASH_RATE)
    except (ValueError, ZeroDivisionError) as problem:
        return {"label": NO_FIT, "call": None, "reason": str(problem)}
    call = metrics.get("drip_call")
    paid_cash = cash["gross_distributions"]
    paid_drip = reinvest["gross_distributions"]
    payouts = {
        "base": FIT_DISPLAY_BASE,
        "paid_cash": round(paid_cash, 2),
        "paid_drip": round(paid_drip, 2),
        "extra_payout_pct": (paid_drip / paid_cash - 1) if paid_cash > 0 else None,
        "cash_value": round(cash["cash_end"], 2),
        "drip_shares_value": round((reinvest["shares_end"] - reinvest["shares_start"]) * reinvest["end_price"], 2),
    }
    return {
        **payouts,
        "label": FIT_LABELS.get(call, NO_FIT),
        "call": call if call in FIT_LABELS else None,
        "bucket": metrics.get("bucket"),
        "re": metrics.get("re"),
        "win_rate": metrics.get("win_rate"),
        "conflicted": bool(metrics.get("conflicted")),
        "price_cagr": metrics.get("nav_annual"),
        "coverage": metrics.get("coverage"),
        "annual_yield": metrics.get("annual_yield"),
        "cash_rate": drip_score.DEFAULT_CASH_RATE,
        "start": metrics.get("effective_start"),
        "end": metrics.get("effective_end"),
        "years": metrics.get("years"),
    }
