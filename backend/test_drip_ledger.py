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


def pay(conn, ticker, pid, day, amount, source="schwab_transactions", ex=None):
    conn.execute("INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source, ex_date) VALUES (?, ?, ?, ?, ?, ?)",
                 (ticker, pid, str(day), amount, source, str(ex) if ex else None))


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


def test_combined_drip_rows_include_cash_and_nonpaying_accounts(connection):
    hold(connection, "MIX", 2, 110, "Y")
    hold(connection, "MIX", 3, 50, "N")
    hold(connection, "MIX", 4, 25, "N")
    trade(connection, "MIX", 2, "2025-12-01", 100, 10)
    drip(connection, "MIX", 2, "2026-01-15", 10, 10)
    pay(connection, "MIX", 3, "2026-01-15", 50)
    pay(connection, "MIX", 3, "2026-02-15", 50)
    connection.commit()
    market = flat_market(D("2025-12-01"), TODAY, 10)
    result = build_drip_ledger(connection, [2, 3, 4], ["MIX"], "2026-01", "2026-02",
                               markets={"MIX": market}, account_names={2: "Taxable", 3: "Roth"}, today=TODAY)
    rows = by_month(result["rows"], "MIX")
    jan, feb = rows["2026-01"], rows["2026-02"]
    assert (jan["base_shares"], jan["end_shares"], jan["total_value"]) == (175, 185, 1850)
    assert (jan["distribution"], jan["drip_amount"], jan["cash"], jan["source"]) == (150, 100, 50, "Partly cash")
    assert {(p["account"], p["kind"]) for p in jan["payments"]} == {("Taxable", "drip"), ("Roth", "cash")}
    assert (feb["base_shares"], feb["distribution"], feb["drip_amount"], feb["source"]) == (185, 50, 0, "Cash")
    assert build_drip_ledger(connection, [3, 4], ["MIX"], "2026-01", "2026-02", today=TODAY)["rows"] == []


@pytest.mark.parametrize("second_ex, entitled", [("2026-01-08", 0), ("2026-01-11", 0),
                                                  ("2026-01-12", 0), ("2026-01-13", 10)])
def test_actual_drip_income_uses_ex_date_and_actual_reinvestment_date(connection, second_ex, entitled):
    hold(connection, "EX", 2, 110, "Y")
    trade(connection, "EX", 2, "2025-12-01", 100, 10)
    pay(connection, "EX", 2, "2026-01-10", 100, ex="2026-01-05")
    trade(connection, "EX", 2, "2026-01-12", 10, 10, notes="[DRIP] Reinvest Shares")
    pay(connection, "EX", 2, "2026-01-20", 100 + entitled, ex=second_ex)
    connection.commit()
    row = build_drip_ledger(connection, [2], ["EX"], "2026-01", "2026-01", today=TODAY)["rows"][0]
    assert row["income_from_drip"] == entitled
    assert row["payments"][1]["shares_held"] == 100 + entitled
    assert row["drip_shares"] == 10


def test_drip_income_preserves_entitlement_when_shares_are_sold_before_payment(connection):
    hold(connection, "EX", 2, 55, "Y")
    trade(connection, "EX", 2, "2025-12-01", 100, 10)
    drip(connection, "EX", 2, "2026-01-10", 10, 10)
    trade(connection, "EX", 2, "2026-01-16", 55, 10, kind="SELL")
    pay(connection, "EX", 2, "2026-01-20", 110, ex="2026-01-15")
    connection.commit()
    row = build_drip_ledger(connection, [2], ["EX"], "2026-01", "2026-01", today=TODAY)["rows"][0]
    assert row["income_from_drip"] == 10
    assert row["drip_shares"] == 5


def test_modeled_extra_income_uses_shares_owned_on_ex_date(connection):
    hold(connection, "EX", 2, 100, "N")
    pay(connection, "EX", 2, "2026-01-10", 100, ex="2026-01-05")
    pay(connection, "EX", 2, "2026-01-20", 100, ex="2026-01-09")
    pay(connection, "EX", 2, "2026-02-10", 100, ex="2026-01-25")
    connection.commit()
    market = flat_market(D("2025-12-01"), TODAY, 10)
    result = build_drip_ledger(connection, [2], ["EX"], "2026-01", "2026-02", model_all=True,
                               markets={"EX": market}, today=TODAY)
    rows = by_month(result["rows"], "EX")
    assert rows["2026-01"]["income_from_drip"] == rows["2026-01"]["extra_income"] == 0
    assert rows["2026-01"]["payments"][1]["shares_held"] == 100
    feb = rows["2026-02"]
    assert feb["income_from_drip"] == feb["extra_income"] == 20
    assert feb["payments"][0]["shares_held"] == 120


def test_actual_and_modeled_drip_income_follow_ex_dates_across_months(connection):
    hold(connection, "EX", 2, 110, "Y")
    trade(connection, "EX", 2, "2025-12-01", 100, 10)
    pay(connection, "EX", 2, "2026-01-29", 100, ex="2026-01-27")
    trade(connection, "EX", 2, "2026-01-30", 10, 10, notes="[DRIP] Reinvest Shares")
    pay(connection, "EX", 2, "2026-02-05", 110, ex="2026-02-02")
    pay(connection, "EX", 2, "2026-02-20", 100, ex="2026-01-28")
    pay(connection, "EX", 2, "2026-03-10", 110, ex="2026-02-06")
    connection.commit()

    market = flat_market(D("2025-12-01"), TODAY, 10)
    result = build_drip_ledger(connection, [2], ["EX"], "2026-01", "2026-03", model_all=True,
                               markets={"EX": market}, today=TODAY)
    rows = by_month(result["rows"], "EX")
    feb, mar = rows["2026-02"], rows["2026-03"]
    assert [p["shares_held"] for p in feb["payments"]] == [110, 100]
    assert (feb["income_from_drip"], feb["extra_income"]) == (10, 0)
    assert mar["payments"][0]["shares_held"] == 121
    assert (mar["income_from_drip"], mar["extra_income"]) == (21, 11)


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


def test_owner_checkbox_sets_the_only_account_that_holds_a_ticker(connection):
    hold(connection, "SOLE", 1, 40, "N")
    hold(connection, "SOLE", 2, 40, "N")
    hold(connection, "SOLE", 4, 5, "N")  # excluded from Owner
    connection.commit()
    client = app_module.app.test_client()
    sole = next(r for r in client.get("/api/holdings?profile_id=1").get_json() if r["ticker"] == "SOLE")
    assert [a["profile_id"] for a in sole["reinvest_accounts"]] == [2]
    for flag in ("Y", "N"):
        response = client.put("/api/holdings/SOLE?profile_id=1", json={"reinvest": flag, "reinvest_all_accounts": True})
        assert response.status_code == 200, response.get_json()
        app_module._sync_owner_drip_flags(connection, ["SOLE"])
        connection.commit()
        rows = {r["profile_id"]: r["reinvest"] for r in connection.execute(
            "SELECT profile_id, reinvest FROM all_account_info WHERE ticker = 'SOLE'")}
        assert rows == {1: flag, 2: flag, 4: "N"}


# ── Endpoints ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("scope", ["owner", "aggregate"])
def test_ledger_endpoints_include_cash_taking_member_accounts(connection, monkeypatch, scope):
    today = date.today()
    first = date(today.year, today.month, 1) - timedelta(days=40)
    day = date(first.year, first.month, 15)
    hold(connection, "MNY", 1, 1070)  # Owner's rollup row has no payments of its own
    hold(connection, "MNY", 2, 1020, "Y")
    hold(connection, "MNY", 3, 50, "N")
    hold(connection, "MNY", 4, 200, "N")
    trade(connection, "MNY", 2, day - timedelta(days=30), 1000, 10)
    drip(connection, "MNY", 2, day, 20, 10)
    pay(connection, "MNY", 3, day, 10)
    pay(connection, "MNY", 4, day, 40)
    connection.commit()
    calls = []

    def loader(symbol, start, end):
        calls.append(symbol)
        return flat_market(start - timedelta(days=10), end, 10)

    monkeypatch.setattr(app_module, "_nav_screen_market_history", loader)
    client = app_module.app.test_client()
    params = {"profile_id": 1}
    if scope == "aggregate":
        aggregate = client.post("/api/aggregates", json={"name": "Combined", "member_ids": [2, 3]})
        assert aggregate.status_code == 200, aggregate.get_json()
        params = {"aggregate_id": aggregate.get_json()["id"]}
    tickers = client.get("/api/portfolio-distributions/drip-ledger/tickers", query_string=params).get_json()
    assert [t["ticker"] for t in tickers["tickers"]] == ["MNY"]
    response = client.get("/api/portfolio-distributions/drip-ledger", query_string={**params, "tickers": "MNY"})
    assert response.status_code == 200
    row = response.get_json()["rows"][0]
    assert (row["ticker"], row["shares_bought"], row["value_of_drip"]) == ("MNY", 20, 200) and calls == ["MNY"]
    assert (row["end_shares"], row["distribution"], row["cash"]) == (1070, 210, 10)
    assert (row["base_shares"], row["total_value"], row["source"]) == (1050, 10700, "Partly cash")
    assert {(p["account"], p["kind"]) for p in row["payments"]} == {("Taxable", "drip"), ("Roth", "cash")}
    assert client.get("/api/portfolio-distributions/drip-ledger").status_code == 400
    assert client.get("/api/portfolio-distributions/drip-ledger/tickers?start=2026-13").status_code == 400


def test_ledger_endpoint_uses_latest_completed_close_after_selected_range(connection, monkeypatch):
    today = date.today()
    payment_day = today.replace(day=1) - timedelta(days=40)
    month = payment_day.strftime("%Y-%m")
    last_session = today - timedelta(days=1)
    hold(connection, "MNY", 2, 110, "Y")
    drip(connection, "MNY", 2, payment_day, 10, 10)
    connection.commit()

    def loader(symbol, start, end):
        closes = [(payment_day, 10), (last_session, 13), (today, 15)]  # today's session is still open
        return {"prices": [{"date": str(day), "close": close} for day, close in closes if start <= day <= end]}

    monkeypatch.setattr(app_module, "_distribution_market_end", lambda symbol, today: last_session)
    monkeypatch.setattr(app_module, "_nav_screen_market_history", loader)
    client = app_module.app.test_client()
    response = client.get("/api/portfolio-distributions/drip-ledger", query_string={
        "profile_id": 2, "tickers": "MNY", "start": month, "end": month, "evaluate": 1,
    })
    assert response.status_code == 200, response.get_json()
    payload = response.get_json()
    assert payload["rows"][0]["month_end_price"] == 10
    assert payload["tickers"][0]["latest_close"] == 13


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


# ── DRIP fit evaluation ───────────────────────────────────────────────────────

def trending_market(start, end, first_price, yearly_change, monthly_payout_rate):
    """Weekday closes changing steadily, paying a share of the price on each month's first weekday."""
    prices, distributions, paid, day = [], [], set(), start
    while day <= end:
        if day.weekday() < 5:
            price = first_price * (1 + yearly_change) ** ((day - start).days / 365.25)
            prices.append({"date": day.isoformat(), "close": price})
            if (day.year, day.month) not in paid:
                paid.add((day.year, day.month))
                distributions.append({"date": day.isoformat(), "amount": price * monthly_payout_rate})
        day += timedelta(days=1)
    return {"prices": prices, "distributions": distributions}


def test_drip_fit_separates_compounders_from_eroding_funds():
    from drip_ledger import evaluate_drip_fit, fit_window_start
    start = fit_window_start("2026-01", TODAY)
    assert start == date(2023, 6, 20)  # three years beats a six-month range
    assert fit_window_start("2021-01", TODAY) == date(2021, 1, 1)

    growing = evaluate_drip_fit(trending_market(start, TODAY, 20, 0.10, 0.004), "GROW", start, TODAY)
    assert growing["label"] == "Good DRIP candidate" and growing["re"] > 1.02 and growing["bucket"] == "Grower"
    eroding = evaluate_drip_fit(trending_market(start, TODAY, 20, -0.35, 0.03), "MELT", start, TODAY)
    assert eroding["label"] == "Not a good DRIP candidate" and eroding["re"] < 0.98 and eroding["bucket"] == "Liquidator"
    # Reinvesting is always paid more (the new shares earn too), yet it can still lose:
    # the extra payouts are already inside the end value the verdict compares.
    for fit in (growing, eroding):
        assert fit["paid_drip"] > fit["paid_cash"] > 0 and fit["extra_payout_pct"] > 0
        assert fit["drip_shares_value"] / fit["cash_value"] == pytest.approx(fit["re"], rel=1e-3)
    assert eroding["drip_shares_value"] < eroding["cash_value"] < eroding["paid_drip"]
    young = evaluate_drip_fit(trending_market(TODAY - timedelta(days=60), TODAY, 20, 0.1, 0.01), "NEW", start, TODAY)
    assert young["label"] == "Not enough history" and young["call"] is None
    assert evaluate_drip_fit({"prices": [], "distributions": []}, "NONE", start, TODAY)["call"] is None
    no_pay = evaluate_drip_fit({"prices": trending_market(start, TODAY, 50, 0.1, 0.0)["prices"], "distributions": []}, "GROW", start, TODAY)
    assert no_pay["label"] == "No distributions" and no_pay["call"] is None


def test_ledger_endpoint_adds_drip_fit_when_asked(connection, monkeypatch):
    today = date.today()
    day = date(today.year, today.month, 1) - timedelta(days=20)
    hold(connection, "MNY", 2, 1020, "Y")
    trade(connection, "MNY", 2, day - timedelta(days=30), 1000, 10)
    drip(connection, "MNY", 2, day, 20, 10)
    connection.commit()
    starts = []

    def loader(symbol, start, end):
        starts.append(start)
        return trending_market(start - timedelta(days=5), end, 10, 0.08, 0.005)

    monkeypatch.setattr(app_module, "_nav_screen_market_history", loader)
    client = app_module.app.test_client()
    plain = client.get("/api/portfolio-distributions/drip-ledger?profile_id=2&tickers=MNY").get_json()
    assert "evaluation" not in plain["tickers"][0]
    judged = client.get("/api/portfolio-distributions/drip-ledger?profile_id=2&tickers=MNY&evaluate=1").get_json()
    assert judged["tickers"][0]["evaluation"]["label"] == "Good DRIP candidate" and judged["rows"]
    assert judged["tickers"][0]["evaluations"] == {"current": judged["tickers"][0]["evaluation"]}
    assert judged["tickers"][0]["evaluation"]["cash_rate"] == 0.04
    assert (today - starts[-1]).days >= 365 * 3 - 1  # fetched the longer window


def test_market_scenarios_keep_daily_swings_and_holding_specific_trends():
    import pandas as pd
    from drip_ledger import FIT_MARKET_RATES, _fit_scenario_closes

    dates = pd.bdate_range("2025-01-02", "2026-01-02")
    moves = (-0.025, 0.02, 0.012, -0.007, 0.003)
    benchmark = 100 * pd.Series([1] + [1 + moves[i % len(moves)] for i in range(len(dates) - 1)],
                                index=dates).cumprod()
    elapsed_years = (dates - dates[0]).days / 365.25
    for scenario in ("bull", "bear", "flat"):
        rate = FIT_MARKET_RATES[scenario]
        path = _fit_scenario_closes(benchmark, benchmark, rate)
        assert path.iloc[0] == 100
        assert path.iloc[-1] == pytest.approx(100 * (1 + rate) ** elapsed_years[-1])
        assert (path.diff() < 0).any() and (path.diff() > 0).any()

    eroding = benchmark * 0.65 ** elapsed_years
    bull = _fit_scenario_closes(eroding, benchmark, FIT_MARKET_RATES["bull"])
    assert bull.iloc[-1] < bull.iloc[0]


def test_ledger_evaluates_selected_markets_and_cash_return(connection, monkeypatch):
    calls = []

    def loader(symbol, start, end):
        calls.append(symbol)
        market = trending_market(start, end, 100, 0.07, 0.003)
        for point in market["prices"]:
            point["close"] *= (0.97, 1.01, 0.99, 1.02, 1)[D(point["date"]).weekday()]
        return market

    monkeypatch.setattr(app_module, "_nav_screen_market_history", loader)
    client = app_module.app.test_client()
    params = {"profile_id": 2, "tickers": "MNY", "evaluate": 1, "market_scenarios": "current,bull,bear,flat"}
    response = client.get("/api/portfolio-distributions/drip-ledger", query_string={**params, "cash_rate": 0})
    assert response.status_code == 200, response.get_json()
    fits = response.get_json()["tickers"][0]["evaluations"]
    assert set(fits) == {"current", "bull", "bear", "flat"}
    assert sorted(calls) == ["MNY", "SPY"]
    assert fits["bull"]["re"] > fits["flat"]["re"] > fits["bear"]["re"]
    assert all(fit["cash_rate"] == 0 and fit["cash_value"] == fit["paid_cash"] for fit in fits.values())

    for rate in (0.0475, -0.02):
        query = {**params, "cash_rate": rate, "market_scenarios": "bull"}
        response = client.get("/api/portfolio-distributions/drip-ledger", query_string=query)
        fit = response.get_json()["tickers"][0]["evaluations"]["bull"]
        assert fit["cash_rate"] == rate
        assert fit["drip_shares_value"] == fits["bull"]["drip_shares_value"]
        assert (fit["re"] < fits["bull"]["re"]) == (rate > 0)


def test_ledger_evaluation_lookback_can_use_trailing_year_or_ledger_range(connection, monkeypatch):
    today = date.today()
    ledger_year = today.year - 2
    monkeypatch.setattr(app_module, "_nav_screen_market_history",
                        lambda symbol, start, end: trending_market(start, end, 100, 0.08, 0.005))
    client = app_module.app.test_client()
    params = {"profile_id": 2, "tickers": "MNY", "evaluate": 1,
              "start": f"{ledger_year}-01", "end": f"{ledger_year}-12"}

    response = client.get("/api/portfolio-distributions/drip-ledger", query_string={**params, "fit_window": 1})
    fit = response.get_json()["tickers"][0]["evaluation"]
    assert fit["years"] == pytest.approx(1, abs=0.02)
    assert D(fit["end"]).year == today.year or (today - D(fit["end"])).days < 7

    response = client.get("/api/portfolio-distributions/drip-ledger", query_string={**params, "fit_window": "ledger"})
    fit = response.get_json()["tickers"][0]["evaluation"]
    assert D(fit["start"]).year == D(fit["end"]).year == ledger_year
    assert fit["years"] == pytest.approx(1, abs=0.02)


@pytest.mark.parametrize("invalid", [
    {"cash_rate": "-1"}, {"cash_rate": "NaN"}, {"cash_rate": "Infinity"}, {"cash_rate": "not a number"},
    {"market_scenarios": "bull,unknown"}, {"fit_window": "0"}, {"fit_window": "arbitrary"},
])
def test_ledger_evaluation_validates_inputs(connection, invalid):
    client = app_module.app.test_client()
    response = client.get("/api/portfolio-distributions/drip-ledger",
                          query_string={"profile_id": 2, "tickers": "MNY", "evaluate": 1, **invalid})
    assert response.status_code == 400
    assert response.get_json()["error"]


def test_evaluating_judges_every_holding_in_the_account(connection, monkeypatch):
    """Every current holding gets a verdict, including one that stopped reinvesting and one that pays nothing."""
    today = date.today()
    recent = date(today.year, today.month, 1) - timedelta(days=20)
    long_ago = recent - timedelta(days=420)
    hold(connection, "MNY", 8, 1020, "Y")
    trade(connection, "MNY", 8, recent - timedelta(days=30), 1000, 10)
    drip(connection, "MNY", 8, recent, 20, 10)
    hold(connection, "KQ", 8, 100, "N", div=0.35)
    trade(connection, "KQ", 8, long_ago - timedelta(days=20), 99, 28)
    drip(connection, "KQ", 8, long_ago, 1, 28)          # reinvested once, long before the range
    pay(connection, "KQ", 8, recent, 35)                 # cash since
    hold(connection, "NOPAY", 8, 10, None, div=0)          # a holding that pays nothing is still in the account
    connection.execute("INSERT OR IGNORE INTO profiles (id, name, include_in_owner) VALUES (8, 'IRA', 0)")
    connection.commit()

    start, end = parse_range(None, None, today)
    assert [t["ticker"] for t in ledger_candidates(connection, [8], start, end, False, today)["tickers"]] == ["MNY"]
    judged = ledger_candidates(connection, [8], start, end, False, today, evaluate=True)
    assert [t["ticker"] for t in judged["tickers"]] == ["KQ", "MNY", "NOPAY"]

    monkeypatch.setattr(app_module, "_nav_screen_market_history",
                        lambda symbol, start, end: trending_market(start - timedelta(days=5), end, 28, 0.05, 0.012))
    client = app_module.app.test_client()
    listed = client.get("/api/portfolio-distributions/drip-ledger/tickers?profile_id=8&evaluate=1").get_json()
    assert [t["ticker"] for t in listed["tickers"]] == ["KQ", "MNY", "NOPAY"]
    data = client.get("/api/portfolio-distributions/drip-ledger?profile_id=8&evaluate=1&tickers=KQ,MNY").get_json()
    statuses = {s["ticker"]: s for s in data["tickers"]}
    assert {r["ticker"] for r in data["rows"]} == {"MNY"}                     # the ledger lists what reinvested
    assert statuses["KQ"]["evaluation"]["call"] in ("DRIP", "Take cash", "Toss-up")  # but KQ is still judged
    assert statuses["KQ"]["message"] == "No reinvestment records in this range."
