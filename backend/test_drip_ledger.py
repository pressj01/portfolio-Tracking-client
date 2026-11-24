"""DRIP ledger (Distributions page) and the Holdings DRIP checkbox evidence."""

from datetime import date, timedelta
import sqlite3

import pytest

import app as app_module
import database
from drip_ledger import (
    apply_reinvest_evidence,
    build_drip_ledger,
    detect_reinvest_evidence,
    ledger_candidates,
    pair_payments,
    parse_range,
)


TODAY = date(2026, 6, 20)
D = date.fromisoformat


@pytest.fixture
def connection(tmp_path, monkeypatch):
    path = tmp_path / "drip.db"

    def connect():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn

    conn = connect()
    database.ensure_tables_exist(conn)
    conn.execute("UPDATE profiles SET owner_active = 1 WHERE id = 1")
    conn.executemany("INSERT OR IGNORE INTO profiles (id, name, include_in_owner) VALUES (?, ?, ?)",
                     [(2, "Taxable", 1), (3, "Roth", 1), (4, "Other", 0)])
    conn.commit()
    monkeypatch.setattr(app_module, "get_connection", connect)
    monkeypatch.setattr(app_module.app, "_db_initialized", True, raising=False)
    yield conn
    conn.close()


def hold(conn, ticker, pid, quantity, reinvest=None, div=0.2, **extra):
    columns = ["ticker", "profile_id", "quantity", "reinvest", "div", *extra]
    conn.execute(f"INSERT INTO all_account_info ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})",
                 [ticker, pid, quantity, reinvest, div, *extra.values()])


def trade(conn, ticker, pid, day, shares, price, kind="BUY", notes=""):
    conn.execute("""INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""", (ticker, pid, kind, str(day), shares, price, notes))


def pay(conn, ticker, pid, day, amount, source="schwab_transactions"):
    conn.execute("INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source) VALUES (?, ?, ?, ?, ?)",
                 (ticker, pid, str(day), amount, source))


def drip(conn, ticker, pid, day, shares, price, amount=None):
    """A payment and the [DRIP] buy that reinvested it."""
    pay(conn, ticker, pid, day, round(shares * price, 2) if amount is None else amount)
    trade(conn, ticker, pid, day, shares, price, notes="[DRIP] Reinvest Shares")


def flat_market(start, end, close, distributions=(), splits=()):
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return {"prices": [{"date": d.isoformat(), "close": close(d) if callable(close) else close} for d in days],
            "distributions": [{"date": str(d), "amount": a} for d, a in distributions],
            "splits": [{"date": str(d), "ratio": r} for d, r in splits]}


def by_month(rows, ticker):
    return {r["month"]: r for r in rows if r["ticker"] == ticker}


# ── Pairing payments with their reinvestment buys ─────────────────────────────

def test_pairing_handles_whole_share_leftovers_missing_payments_and_distant_buys():
    payments = [{"day": D("2026-10-26"), "amount": 15.49}, {"day": D("2026-11-02"), "amount": 15.18},
                {"day": D("2026-11-09"), "amount": 14.32}]
    buys = [{"day": D("2026-10-26"), "shares": 1.0, "price": 10.91},        # whole share, $4.58 left as cash
            {"day": D("2026-11-03"), "shares": 1.4457, "price": 10.5},      # posted a day late
            {"day": D("2026-11-30"), "shares": 2.0, "price": 9.0}]          # no payment record at all
    events = pair_payments(payments, buys)
    assert [(e["day"].isoformat(), round(e["reinvested"], 2), round(e["shares"], 4)) for e in events] == [
        ("2026-10-26", 10.91, 1.0), ("2026-11-02", 15.18, 1.4457), ("2026-11-09", 0.0, 0.0), ("2026-11-30", 18.0, 2.0)]
    assert events[-1]["synthetic"] and events[0]["price"] == pytest.approx(10.91)
    # Ten days away is a different payment, not this one's reinvestment.
    assert pair_payments([{"day": D("2026-01-01"), "amount": 10}], [{"day": D("2026-01-11"), "shares": 1, "price": 10}])[0]["shares"] == 0


def test_range_defaults_to_trailing_twelve_months_and_rejects_bad_input():
    assert parse_range(None, None, TODAY) == ("2025-07", "2026-06")
    assert parse_range("2026-01", "2027-03", TODAY) == ("2026-01", "2026-06")
    for start, end in [("2026-13", None), ("2026-05", "2026-01"), ("26-01", None), ("1990-01", "2026-06")]:
        with pytest.raises(ValueError):
            parse_range(start, end, TODAY)


# ── Ledger rows ────────────────────────────────────────────────────────────────

def seed_compounding(conn):
    """1,000 shares paying $0.20/share monthly, every payment reinvested at $10."""
    hold(conn, "MNY", 2, 1061.208, "Y")
    trade(conn, "MNY", 2, "2025-12-01", 1000, 10)
    drip(conn, "MNY", 2, "2026-01-15", 20, 10)
    drip(conn, "MNY", 2, "2026-02-13", 20.4, 10)
    drip(conn, "MNY", 2, "2026-03-16", 20.808, 10)
    conn.commit()


def test_actual_ledger_replays_base_shares_and_income_from_reinvested_shares(connection):
    seed_compounding(connection)
    market = flat_market(D("2025-12-01"), TODAY, 10)
    result = build_drip_ledger(connection, [2, 3], ["MNY"], "2026-01", "2026-04", markets={"MNY": market},
                               account_names={2: "Taxable"}, today=TODAY)
    rows = by_month(result["rows"], "MNY")
    assert list(rows) == ["2026-01", "2026-02", "2026-03"]  # April paid nothing
    jan, feb, mar = rows["2026-01"], rows["2026-02"], rows["2026-03"]
    assert (jan["base_shares"], jan["drip_amount"], jan["shares_bought"], jan["end_shares"]) == (1000, 200, 20, 1020)
    assert (feb["base_shares"], feb["distribution"], feb["income_from_drip"]) == (1020, 204, 4.0)
    assert (mar["base_shares"], mar["income_from_drip"], mar["drip_shares"]) == (1040.4, 8.08, 61.208)
    assert mar["value_of_drip"] == pytest.approx(612.08) and mar["avg_price"] == 10
    assert (jan["total_value"], mar["total_value"]) == (pytest.approx(10200), pytest.approx(10612.08))
    assert {r["source"] for r in rows.values()} == {"Actual"}
    assert jan["payments"][0]["account"] == "Taxable" and jan["payments"][0]["kind"] == "drip"


def test_cash_payments_show_only_when_the_account_reinvests_and_are_modeled_on_request(connection):
    seed_compounding(connection)
    hold(connection, "CSH", 3, 100, "N")
    trade(connection, "OTHER", 3, "2026-03-01", 1, 5)
    pay(connection, "CSH", 3, "2026-01-10", 50)
    pay(connection, "CSH", 3, "2026-02-10", 50)
    hold(connection, "NOPAY", 3, 10, None, div=1)
    connection.commit()
    markets = {"CSH": flat_market(D("2025-12-01"), TODAY, 25),
               "NOPAY": flat_market(D("2025-12-01"), TODAY, 20, distributions=[("2026-01-20", 1.0)])}

    actual = ledger_candidates(connection, [2, 3], "2026-01", "2026-03", False, TODAY)
    assert [t["ticker"] for t in actual["tickers"]] == ["MNY"]
    modeled = ledger_candidates(connection, [2, 3], "2026-01", "2026-03", True, TODAY)
    assert [t["ticker"] for t in modeled["tickers"]] == ["CSH", "MNY", "NOPAY"]
    assert modeled["first_month"] == "2026-01"  # the first DRIP buy or payment, not the opening buy

    assert build_drip_ledger(connection, [2, 3], ["CSH"], "2026-01", "2026-03", markets=markets, today=TODAY)["rows"] == []
    result = build_drip_ledger(connection, [2, 3], ["CSH", "NOPAY"], "2026-01", "2026-03", model_all=True,
                               markets=markets, today=TODAY)
    csh = by_month(result["rows"], "CSH")
    assert (csh["2026-01"]["drip_amount"], csh["2026-01"]["shares_bought"], csh["2026-01"]["cash"]) == (50, 2, 0)
    # February pays $0.50 on the 2 modeled shares too, and reinvests that as well.
    feb = csh["2026-02"]
    assert (feb["distribution"], feb["extra_income"], feb["income_from_drip"]) == (51, 1, 1)
    assert feb["shares_bought"] == pytest.approx(2.04) and feb["drip_shares"] == pytest.approx(4.04)
    assert feb["source"] == "Modeled" and feb["base_shares"] == 102
    nopay = by_month(result["rows"], "NOPAY")["2026-01"]
    assert (nopay["distribution"], nopay["shares_bought"], nopay["source"]) == (10, 0.5, "Modeled")


def test_as_traded_ledger_is_restated_in_todays_units_after_a_reverse_split(connection):
    hold(connection, "SPL", 2, 10.4, "Y")
    trade(connection, "SPL", 2, "2025-12-01", 100, 5)
    drip(connection, "SPL", 2, "2026-01-15", 2, 5)       # before the 1-for-10 split
    drip(connection, "SPL", 2, "2026-03-15", 0.2, 50)    # after it
    connection.commit()
    market = flat_market(D("2025-12-01"), TODAY, lambda d: 50.0, splits=[("2026-02-01", 0.1)])
    rows = by_month(build_drip_ledger(connection, [2], ["SPL"], "2026-01", "2026-03", markets={"SPL": market},
                                      today=TODAY)["rows"], "SPL")
    assert rows["2026-01"]["base_shares"] == 10 and rows["2026-01"]["shares_bought"] == pytest.approx(0.2)
    assert rows["2026-01"]["avg_price"] == 50 and rows["2026-03"]["end_shares"] == pytest.approx(10.4)


def test_a_sale_scales_down_the_reinvested_shares(connection):
    seed_compounding(connection)
    trade(connection, "MNY", 2, "2026-02-20", 510, 10, kind="SELL")
    connection.execute("UPDATE all_account_info SET quantity = 551.208 WHERE ticker = 'MNY'")
    connection.commit()
    rows = by_month(build_drip_ledger(connection, [2], ["MNY"], "2026-01", "2026-03", today=TODAY)["rows"], "MNY")
    assert rows["2026-02"]["other_shares"] == -510 and rows["2026-02"]["drip_shares"] == pytest.approx(40.4 * 530.4 / 1040.4)
    assert rows["2026-02"]["value_of_drip"] is None and rows["2026-02"]["total_value"] is None  # no market loaded


# ── DRIP checkbox evidence ────────────────────────────────────────────────────

def test_newest_evidence_sets_the_checkbox_and_respects_newer_settings(connection):
    seed_compounding(connection)
    connection.execute("UPDATE all_account_info SET reinvest = NULL WHERE ticker = 'MNY'")  # blank, reinvests -> Y
    hold(connection, "CSH", 3, 100, "Y")                                     # cash, settled -> N
    pay(connection, "CSH", 3, "2026-02-10", 50)
    trade(connection, "OTHER", 3, "2026-03-01", 1, 5)
    hold(connection, "FILE", 3, 100, "Y", reinvest_source="broker_file", reinvest_as_of="2026-06-01")
    pay(connection, "FILE", 3, "2026-05-15", 50)                             # older than the broker file
    hold(connection, "HAND", 3, 100, "N", reinvest_source="manual", reinvest_as_of="2026-05-01")
    drip(connection, "HAND", 3, "2026-05-15", 5, 10)                         # newer than the hand tick
    hold(connection, "TYPED", 3, 100, "Y")
    pay(connection, "TYPED", 3, "2026-05-20", 50, source="manual")            # says nothing about DRIP
    hold(connection, "LATE", 4, 100, "Y", import_date="2026-01-01")
    pay(connection, "LATE", 4, "2026-06-18", 50)                             # its buy may not be imported yet
    connection.commit()

    evidence = detect_reinvest_evidence(connection, [2, 3, 4], TODAY)
    assert evidence[(2, "MNY")]["flag"] == "Y" and "2026-03-16" in evidence[(2, "MNY")]["note"]
    assert evidence[(3, "CSH")]["flag"] == "N" and (4, "LATE") not in evidence and (3, "TYPED") not in evidence
    changed = apply_reinvest_evidence(connection, [2, 3, 4], TODAY, evidence)
    flags = {r["ticker"]: (r["reinvest"], r["reinvest_source"]) for r in connection.execute(
        "SELECT ticker, reinvest, reinvest_source FROM all_account_info")}
    assert flags == {"MNY": ("Y", "records"), "CSH": ("N", "records"), "FILE": ("Y", "broker_file"),
                     "HAND": ("Y", "records"), "TYPED": ("Y", None), "LATE": ("Y", None)}
    assert changed == {"MNY", "CSH", "HAND"}
    assert apply_reinvest_evidence(connection, [2, 3, 4], TODAY) == set()


def test_owner_follows_its_accounts_and_its_checkbox_sets_all_of_them(connection):
    for pid, qty, flag in [(1, 40, "Y"), (2, 10, "Y"), (3, 30, "N")]:
        hold(connection, "BOTH", pid, qty, flag)
    connection.commit()
    assert app_module._sync_owner_drip_flags(connection) == 1
    owner = connection.execute("SELECT reinvest, drip_quantity FROM all_account_info WHERE profile_id = 1").fetchone()
    assert tuple(owner) == ("Y", 10)
    connection.commit()

    client = app_module.app.test_client()
    response = client.put("/api/holdings/BOTH?profile_id=1", json={"reinvest": "Y", "reinvest_all_accounts": True})
    assert response.status_code == 200, response.get_json()
    rows = {r["profile_id"]: (r["reinvest"], r["reinvest_source"], r["drip_quantity"]) for r in connection.execute(
        "SELECT profile_id, reinvest, reinvest_source, drip_quantity FROM all_account_info")}
    assert rows[2][:2] == ("Y", "manual") and rows[3][:2] == ("Y", "manual") and rows[1][2] is None

    response = client.put("/api/holdings/BOTH?profile_id=3", json={"reinvest": "N"})
    assert response.status_code == 200
    matrix = client.get("/api/drip-matrix").get_json()
    both = next(t for t in matrix["tickers"] if t["ticker"] == "BOTH")
    assert both["accounts"]["3"]["reinvest"] is False and both["accounts"]["3"]["source"] == "manual"


# ── Endpoints ──────────────────────────────────────────────────────────────────

def test_ledger_endpoints_read_owner_member_accounts(connection, monkeypatch):
    today = date.today()
    first = date(today.year, today.month, 1) - timedelta(days=40)
    day = date(first.year, first.month, 15)
    hold(connection, "MNY", 1, 1020)  # Owner's rollup row has no payments of its own
    hold(connection, "MNY", 2, 1020, "Y")
    trade(connection, "MNY", 2, day - timedelta(days=30), 1000, 10)
    drip(connection, "MNY", 2, day, 20, 10)
    connection.commit()
    calls = []

    def loader(symbol, start, end):
        calls.append(symbol)
        return flat_market(start - timedelta(days=10), end, 10)

    monkeypatch.setattr(app_module, "_nav_screen_market_history", loader)
    client = app_module.app.test_client()
    tickers = client.get("/api/portfolio-distributions/drip-ledger/tickers?profile_id=1").get_json()
    assert [t["ticker"] for t in tickers["tickers"]] == ["MNY"]
    response = client.get("/api/portfolio-distributions/drip-ledger?profile_id=1&tickers=MNY")
    assert response.status_code == 200
    row = response.get_json()["rows"][0]
    assert (row["ticker"], row["shares_bought"], row["value_of_drip"]) == ("MNY", 20, 200) and calls == ["MNY"]
    assert row["payments"][0]["account"] == "Taxable"
    assert client.get("/api/portfolio-distributions/drip-ledger").status_code == 400
    assert client.get("/api/portfolio-distributions/drip-ledger/tickers?start=2026-13").status_code == 400


OWNER_ACCOUNT_CASES = (
    [(n, frozenset(i for i in range(n) if i % 3 == 1)) for n in range(1, 11)]  # some, or none, reinvest
    + [(10, frozenset(range(10))), (10, frozenset({9}))]                          # all of them; only the last
)


@pytest.mark.parametrize("count, reinvesting", OWNER_ACCOUNT_CASES,
                         ids=[f"{n}-accounts-{len(r)}-drip" for n, r in OWNER_ACCOUNT_CASES])
def test_owner_with_up_to_ten_accounts_is_checked_when_any_reinvests_and_lists_them(connection, count, reinvesting):
    accounts = [(100 + i, f"Account {i + 1:02d}", 10.0 * (i + 1)) for i in range(count)]
    connection.executemany("INSERT INTO profiles (id, name, include_in_owner) VALUES (?, ?, 1)",
                           [(pid, name) for pid, name, _ in accounts])
    hold(connection, "MANY", 1, sum(qty for *_, qty in accounts), "N")
    for i, (pid, _, qty) in enumerate(accounts):
        hold(connection, "MANY", pid, qty, "Y" if i in reinvesting else "N")
    connection.commit()
    app_module._sync_owner_drip_flags(connection)
    connection.commit()

    total = sum(qty for *_, qty in accounts)
    dripping = sum(qty for i, (*_, qty) in enumerate(accounts) if i in reinvesting)
    owner = connection.execute("SELECT reinvest, drip_quantity FROM all_account_info WHERE profile_id = 1").fetchone()
    # Any account reinvesting checks Owner. The DRIP share count is the
    # reinvesting accounts' shares, or None (every share) when all reinvest.
    expected_quantity = None if len(reinvesting) in (0, count) else dripping
    assert tuple(owner) == ("Y" if reinvesting else "N", expected_quantity)

    rows = app_module.app.test_client().get("/api/holdings?profile_id=1").get_json()
    many = next(r for r in rows if r["ticker"] == "MANY")
    assert many["reinvest"] == ("Y" if reinvesting else "N")
    assert many["reinvest_share_pct"] == pytest.approx(round(dripping / total * 100, 2))
    assert [(a["account"], a["reinvest"], a["quantity"]) for a in many["reinvest_accounts"]] == [
        (name, i in reinvesting, qty) for i, (_, name, qty) in enumerate(accounts)]

    matrix = app_module.app.test_client().get("/api/drip-matrix").get_json()
    row = next(t for t in matrix["tickers"] if t["ticker"] == "MANY")
    assert row["owner_drip"] is bool(reinvesting) and row["drip_qty"] == (dripping if reinvesting else 0)
    assert sum(1 for a in row["accounts"].values() if a["reinvest"]) == len(reinvesting)
