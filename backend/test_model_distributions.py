"""Distributions page tested on a Portfolio Builder model portfolio."""

from datetime import date, timedelta
import sqlite3

import pytest

import app as app_module
import database
from model_distributions import (
    build_model_distribution_history,
    model_holding_rows,
    model_payment_records,
    model_positions,
    observed_pay_lags,
)
from drip_ledger import build_model_drip_ledger, model_ledger_candidates


TODAY = date(2026, 6, 20)
D = date.fromisoformat


def market(start, end, close, distributions=()):
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return {"prices": [{"date": d.isoformat(), "close": close} for d in days if d.weekday() < 5],
            "distributions": [{"date": str(d), "amount": a} for d, a in distributions],
            "splits": [], "distributions_complete": True, "corporate_actions_resolved": True}


def monthly(start, months, amount, day=14):
    out, year, month = [], start.year, start.month
    for _ in range(months):
        out.append((date(year, month, day), amount))
        year, month = year + (month == 12), month % 12 + 1
    return out


# ── Positions, pay timing and the modeled history ─────────────────────────────

def test_shares_come_from_the_latest_close_and_unpriced_holdings_get_none():
    markets = {"AAA": market(D("2025-01-01"), TODAY, 20.0), "BBB": None}
    positions = model_positions([{"ticker": "aaa", "dollar_amount": 1000}, {"ticker": "BBB", "dollar_amount": 500}],
                                markets, TODAY, {"AAA": "Alpha Income ETF"})
    aaa, bbb = positions
    assert (aaa["ticker"], aaa["shares"], aaa["price"], aaa["description"]) == ("AAA", 50.0, 20.0, "Alpha Income ETF")
    assert aaa["price_date"] == D("2026-06-19") and aaa["available"]
    assert (bbb["shares"], bbb["available"]) == (0.0, False)


def test_pay_lag_is_the_median_gap_from_recorded_payments_to_the_prior_ex_date():
    dists = monthly(D("2025-01-01"), 18, 0.1, day=10)
    positions = model_positions([{"ticker": "AAA", "dollar_amount": 1000}, {"ticker": "BBB", "dollar_amount": 1000}],
                                {"AAA": market(D("2024-12-01"), TODAY, 10.0, dists),
                                 "BBB": market(D("2024-12-01"), TODAY, 10.0, dists)}, TODAY)
    paid = [str(day + timedelta(days=lag)) for (day, _), lag in zip(dists, [3, 3, 4, 3, 90])]
    lags = observed_pay_lags({"AAA": paid, "BBB": paid[:2]}, positions)
    # The 90-day gap is matched to a later ex-date; BBB has too few samples.
    assert lags == {"AAA": 3}


def test_history_models_each_payment_on_the_model_shares_by_pay_month():
    # Ex-dates on the 28th paid four days later land in the next month.
    dists = monthly(D("2025-11-01"), 8, 0.5, day=28)
    positions = model_positions([{"ticker": "AAA", "dollar_amount": 2000}],
                                {"AAA": market(D("2025-10-01"), TODAY, 20.0, dists)}, TODAY)
    history = build_model_distribution_history(positions, {"AAA": 4}, 2026, TODAY)
    row = history["rows"][0]
    # 100 shares × $0.50; Dec 28 2025 (a Sunday) is paid Jan 1, ..., May 28 is paid Jun 1.
    assert row["actual"][:6] == [50.0, 50.0, 50.0, 50.0, 50.0, 50.0]
    assert row["actual"][6:] == [None] * 6
    assert history["previous_december"]["actual"] == 50.0
    assert [y["year"] for y in history["yearly"]] == [2025, 2026]
    assert history["yearly"][0] == {"year": 2025, "actual": 50.0, "estimated": 0.0, "realized_gain": None}
    assert history["past_30_days"] == {"actual": 50.0, "estimated": 0.0}
    assert history["model"]["pay_dates_from_records"] == ["AAA"]
    assert history["years"] == [2026, 2025]


def test_a_payment_past_its_ex_date_but_not_yet_paid_is_estimated():
    dists = [(D("2026-06-18"), 0.25)]
    positions = model_positions([{"ticker": "AAA", "dollar_amount": 1000}],
                                {"AAA": market(D("2026-01-01"), TODAY, 10.0, dists)}, TODAY)
    history = build_model_distribution_history(positions, {"AAA": 5}, None, TODAY)
    row = history["rows"][0]
    # Paid Jun 23, after "today": the model is entitled, the cash has not arrived.
    assert (row["actual"][5], row["estimated"][5]) == (0.0, 25.0)
    assert model_payment_records(positions, {"AAA": 5}, TODAY) == {}


def test_late_starters_and_unavailable_holdings_are_named_for_the_year():
    positions = model_positions(
        [{"ticker": "OLD", "dollar_amount": 1000}, {"ticker": "NEW", "dollar_amount": 1000}, {"ticker": "GONE", "dollar_amount": 1000}],
        {"OLD": market(D("2020-01-01"), TODAY, 10.0), "NEW": market(D("2026-03-02"), TODAY, 10.0)}, TODAY)
    meta = build_model_distribution_history(positions, {}, 2026, TODAY)["model"]
    assert meta["late_starters"] == [{"ticker": "NEW", "first_date": "2026-03-02"}]
    assert meta["unavailable"] == ["GONE"]
    assert meta["invested"] == 2000.0
    with pytest.raises(ValueError):
        build_model_distribution_history(positions, {}, TODAY.year + 1, TODAY)


def test_holding_rows_carry_the_run_rate_and_skip_funds_that_stopped_paying():
    payer = monthly(D("2025-07-01"), 12, 0.2)
    stopped = monthly(D("2023-01-01"), 6, 0.2)
    positions = model_positions(
        [{"ticker": "PAY", "dollar_amount": 1000}, {"ticker": "OFF", "dollar_amount": 3000}],
        {"PAY": market(D("2025-01-01"), TODAY, 10.0, payer), "OFF": market(D("2023-01-01"), TODAY, 10.0, stopped)}, TODAY)
    pay_row, off_row = model_holding_rows(positions, {"PAY": {"category": "Income", "subcategory": None}}, TODAY)
    assert (pay_row["quantity"], pay_row["div"], pay_row["div_frequency"]) == (100.0, 0.2, "M")
    assert pay_row["estim_payment_per_year"] == 240.0 and pay_row["category"] == "Income"
    assert (pay_row["original_purchase_value"], pay_row["current_value"], pay_row["percent_of_account"]) == (1000.0, 1000.0, 25.0)
    assert (off_row["div"], off_row["estim_payment_per_year"]) == (0.0, 0.0)


def test_model_drip_ledger_reinvests_every_modeled_payment():
    dists = monthly(D("2026-01-01"), 5, 1.0, day=15)
    markets = {"AAA": market(D("2025-12-01"), TODAY, 10.0, dists)}
    positions = model_positions([{"ticker": "AAA", "dollar_amount": 1000}], markets, TODAY)
    payments = model_payment_records(positions, {}, TODAY)
    candidates = model_ledger_candidates(positions, payments, "2026-01", "2026-06", TODAY)
    assert [t["ticker"] for t in candidates["tickers"]] == ["AAA"] and candidates["first_month"] == "2026-01"
    payload = build_model_drip_ledger(positions, payments, ["AAA"], "2026-01", "2026-06",
                                      markets=markets, name="Alex Portfolio", today=TODAY)
    rows = {r["month"]: r for r in payload["rows"]}
    # 100 shares × $1 buys 10 shares at $10; February's payment is on 110 shares.
    assert (rows["2026-01"]["distribution"], rows["2026-01"]["shares_bought"]) == (100.0, 10.0)
    assert (rows["2026-02"]["distribution"], rows["2026-02"]["extra_income"]) == (110.0, 10.0)
    assert rows["2026-05"]["end_shares"] == pytest.approx(100 * 1.1 ** 5)
    assert {p["account"] for r in payload["rows"] for p in r["payments"]} == {"Alex Portfolio"}
    assert all(r["source"] == "Modeled" for r in payload["rows"])


def test_all_history_is_kept_within_the_ledger_range_limit():
    dists = monthly(D("1995-01-01"), 12, 0.1)
    positions = model_positions([{"ticker": "AAA", "dollar_amount": 1000}],
                                {"AAA": market(D("1995-01-01"), TODAY, 10.0, dists)}, TODAY)
    payments = model_payment_records(positions, {}, TODAY)
    first = model_ledger_candidates(positions, payments, "2026-01", "2026-06", TODAY)["first_month"]
    assert first == "2006-07"  # 240 months through June 2026


# ── Endpoints ─────────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / "model.db"

    def connect():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn

    conn = connect()
    database.ensure_tables_exist(conn)
    conn.execute("INSERT OR IGNORE INTO profiles (id, name) VALUES (2, 'Taxable')")
    conn.execute("INSERT INTO builder_portfolios (id, profile_id, name) VALUES (7, 1, 'Alex Portfolio')")
    conn.execute("INSERT INTO builder_portfolios (id, profile_id, name) VALUES (8, 2, 'Not yours')")
    conn.executemany("INSERT INTO builder_holdings (portfolio_id, ticker, dollar_amount) VALUES (?, ?, ?)",
                     [(7, "AAA", 1000), (7, "ZZZ", 500), (8, "AAA", 50)])
    # A recorded payment history (in any account) gives AAA's pay timing.
    today = date.today()
    ex_days = [date(today.year, today.month, 1) - timedelta(days=30 * i) for i in range(1, 6)]
    conn.executemany("INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source) VALUES (?, ?, ?, ?, ?)",
                     [("AAA", 2, str(d + timedelta(days=2)), 5, "schwab") for d in ex_days])
    conn.commit()
    conn.close()
    monkeypatch.setattr(app_module, "get_connection", connect)
    monkeypatch.setattr(app_module.app, "_db_initialized", True, raising=False)
    calls = []

    def loader(symbol, start, end):
        calls.append((symbol, start))
        if symbol == "ZZZ":
            return None
        return market(date(2020, 1, 1), end, 10.0, [(d, 0.1) for d in ex_days])

    monkeypatch.setattr(app_module, "_nav_screen_market_history", loader)
    test_client = app_module.app.test_client()
    test_client.calls = calls
    return test_client


def test_model_endpoints_serve_holdings_history_and_drip_ledger(client):
    holdings = client.get("/api/portfolio-distributions/model-holdings?builder_id=7&profile_id=1")
    assert holdings.status_code == 200
    body = holdings.get_json()
    assert body["model"]["name"] == "Alex Portfolio" and body["model"]["unavailable"] == ["ZZZ"]
    aaa = next(r for r in body["rows"] if r["ticker"] == "AAA")
    assert (aaa["quantity"], aaa["div"], aaa["model"]) == (100.0, 0.1, True)
    # Every load reads full history, the Distribution Analyzer's cache key.
    assert {start for _, start in client.calls} == {date(1900, 1, 1)}

    history = client.get("/api/portfolio-distributions?builder_id=7&profile_id=1").get_json()
    assert history["model"]["name"] == "Alex Portfolio"
    assert history["model"]["pay_dates_from_records"] == ["AAA"]
    assert sum(history["yearly"][i]["actual"] for i in range(len(history["yearly"]))) == pytest.approx(50.0)

    tickers = client.get("/api/portfolio-distributions/drip-ledger/tickers?builder_id=7&profile_id=1").get_json()
    assert tickers["model_all"] is True and [t["ticker"] for t in tickers["tickers"]] == ["AAA"]
    ledger = client.get("/api/portfolio-distributions/drip-ledger?builder_id=7&profile_id=1&tickers=AAA&evaluate=1").get_json()
    assert ledger["model_all"] is True and ledger["rows"]
    assert all(p["account"] == "Alex Portfolio" for r in ledger["rows"] for p in r["payments"])
    assert ledger["tickers"][0]["evaluation"]["label"]


def test_model_endpoints_refuse_another_profiles_model_and_bad_ids(client):
    assert client.get("/api/portfolio-distributions?builder_id=8&profile_id=1").status_code == 404
    assert client.get("/api/portfolio-distributions/model-holdings?builder_id=8&profile_id=1").status_code == 404
    assert client.get("/api/portfolio-distributions/drip-ledger/tickers?builder_id=x&profile_id=1").status_code == 400
    assert client.get("/api/portfolio-distributions/model-holdings?profile_id=1").status_code == 400
    # Without builder_id the page reads the portfolio's own records, as before.
    own = client.get("/api/portfolio-distributions?profile_id=2").get_json()
    assert "model" not in own and own["yearly"]
