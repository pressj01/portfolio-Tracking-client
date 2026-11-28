"""Reinvestment Impact page: the Historical endpoint on real records and on a Builder model."""

from datetime import date, timedelta
import sqlite3

import pytest

import app as app_module
import database
from drip_ledger import Position
from reinvestment_model import model_reinvestment_history


def month_day(months_ago, day, today=None):
    """``day`` of the month ``months_ago`` before today's month."""
    today = today or date.today()
    index = today.year * 12 + today.month - 1 - months_ago
    return date(index // 12, index % 12 + 1, day)


def market(start, end, close, distributions=()):
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return {"prices": [{"date": d.isoformat(), "close": close} for d in days if d.weekday() < 5],
            "distributions": [{"date": str(d), "amount": a} for d, a in distributions],
            "splits": [], "distributions_complete": True, "corporate_actions_resolved": True}


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "reinvest.db"

    def connect():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn

    conn = connect()
    database.ensure_tables_exist(conn)
    conn.execute("UPDATE profiles SET owner_active = 1 WHERE id = 1")
    conn.execute("INSERT OR IGNORE INTO profiles (id, name, include_in_owner) VALUES (2, 'Taxable', 1)")
    conn.commit()
    conn.close()
    monkeypatch.setattr(app_module, "get_connection", connect)
    monkeypatch.setattr(app_module.app, "_db_initialized", True, raising=False)
    return connect


def add_trades(conn, rows):
    conn.executemany(
        "INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, price_per_share, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)", rows)


def add_payments(conn, rows):
    conn.executemany(
        "INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source) VALUES (?, ?, ?, ?, 'schwab')",
        rows)


def get(path):
    response = app_module.app.test_client().get(path)
    return response.status_code, response.get_json()


# ── Real records ──────────────────────────────────────────────────────────────

def test_a_sold_ticker_scoped_on_owner_reads_the_member_accounts_ledger(db):
    """No open row anywhere must not switch the read to Owner's own (empty) ledger."""
    conn = db()
    add_trades(conn, [("OLD", 2, "BUY", str(month_day(6, 2)), 100, 10.0, ""),
                      ("OLD", 2, "SELL", str(month_day(1, 20)), 100, 10.0, "")])
    add_payments(conn, [("OLD", 2, str(month_day(m, 15)), 10.0) for m in (5, 4, 3, 2)])
    conn.commit()
    conn.close()

    code, body = get("/api/reinvestment-impact/data?profile_id=1&view=monthly&months_back=24&ticker=OLD")
    assert code == 200
    assert [t["ticker"] for t in body["per_ticker"]] == ["OLD"]
    assert body["per_ticker"][0]["closed"] is True
    assert body["summary"]["total_payout"] == pytest.approx(40.0)
    assert body["summary"]["covers_all_records"] is True

    _, short = get("/api/reinvestment-impact/data?profile_id=1&view=monthly&months_back=2&ticker=OLD")
    assert short["summary"]["covers_all_records"] is False


def test_a_payment_after_the_sale_is_not_read_as_a_distribution_rate_jump(db):
    """Sold between ex-date and pay date: the payment is on the shares that were sold."""
    conn = db()
    add_trades(conn, [("SOLD", 2, "BUY", str(month_day(6, 1)), 100, 10.0, ""),
                      ("SOLD", 2, "SELL", str(month_day(1, 10)), 100, 10.0, "")])
    add_payments(conn, [("SOLD", 2, str(month_day(m, 15)), 10.0) for m in (5, 4, 3, 2, 1)])
    conn.commit()
    conn.close()

    code, body = get("/api/reinvestment-impact/data?profile_id=2&view=monthly&months_back=24")
    assert code == 200
    sold = next(t for t in body["per_ticker"] if t["ticker"] == "SOLD")
    # $10 on 100 shares every month: $0.10/share throughout, including the last one.
    assert sold["dps"] == [pytest.approx(0.1)] * 5
    assert sold["rate_impact"] == pytest.approx(0.0, abs=0.01)
    assert max(abs(v) for v in body["series"]["decomp"]["rate"]) < 0.01
    assert max(abs(v) for v in body["series"]["decomp"]["price"]) < 0.01
    assert not body["rate_raises"] and not body["rate_cuts"]


def test_shares_entitled_falls_back_to_the_count_held_before_a_recent_sale():
    d = date.fromisoformat
    trades = [{"day": d("2026-01-02"), "order": 0, "shares": 50, "signed": 50, "drip": False},
              {"day": d("2026-03-10"), "order": 1, "shares": 50, "signed": -50, "drip": False}]
    pos = Position(2, "AAA", 0, trades, [])
    assert app_module._reinvest_shares_entitled(pos, d("2026-03-01")) == pytest.approx(50)
    # Paid five days after the sale: still the 50 shares that were sold.
    assert app_module._reinvest_shares_entitled(pos, d("2026-03-15")) == pytest.approx(50)
    # Long after the sale it is no longer evidence.
    assert app_module._reinvest_shares_entitled(pos, d("2026-06-15")) == 0


def test_a_bad_months_back_falls_back_to_the_default_window(db):
    code, body = get("/api/reinvestment-impact/data?profile_id=2&view=monthly&months_back=abc")
    assert code == 200 and body["months_back"] == 60


# ── Builder model ─────────────────────────────────────────────────────────────

TODAY = date(2026, 6, 20)


def monthly_key(day):
    return f"{day.year:04d}-{day.month:02d}"


def model_position(ticker="AAA", shares=100.0, price=10.0, start=date(2025, 1, 1), months=18, amount=0.1):
    dists = []
    year, month = start.year, start.month
    for _ in range(months):
        dists.append((date(year, month, 10), amount))
        year, month = year + (month == 12), month % 12 + 1
    return {"ticker": ticker, "description": f"{ticker} Income ETF", "amount": shares * price, "price": price,
            "price_date": TODAY, "first_date": start, "shares": shares, "distributions": dists, "available": True}, \
        market(start, TODAY, price, dists)


def history(positions, markets, **kwargs):
    defaults = dict(view="monthly", cutoff_date=date(2026, 1, 1), pre_cutoff_date=date(2025, 9, 1), today=TODAY,
                    period_key=monthly_key, current_key="2026-06", is_current_partial=True)
    defaults.update(kwargs)
    return model_reinvestment_history(positions, markets, {}, **defaults)


def test_model_history_reinvests_every_payment_from_the_window_start():
    position, payload = model_position()
    body = history([position], {"AAA": payload})
    series = body["series"]
    assert series["labels"] == ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
    # 100 shares × $0.10 = $10 buys 1 share at $10; each later payment is on the grown count.
    expected = [100 * 0.1 * 1.01 ** i for i in range(6)]
    assert series["payout"] == [pytest.approx(v, abs=0.01) for v in expected]
    # Never reinvested = the model's shares unchanged: the Distributions page's modeled income.
    assert series["payout_nodrip"] == [pytest.approx(10.0)] * 6
    assert series["cash_amount"] == [0.0] * 6
    assert series["payout_source"] == ["reconstructed"] * 6
    assert series["partial_periods"][-1] is True
    # A steady per-share payout: every change comes from the reinvested shares.
    assert all(abs(v) < 0.01 for v in series["decomp"]["rate"] + series["decomp"]["trades"])
    assert sum(series["decomp"]["shares"]) == pytest.approx(expected[-1] - expected[0], abs=0.02)

    summary = body["summary"]
    assert summary["pct_reinvested"] == 100.0 and summary["current_reinvest_pct"] == 100.0
    assert summary["extra_income_from_drip"] == pytest.approx(sum(expected) - 60.0, abs=0.02)
    assert summary["total_drip_shares"] == pytest.approx(sum(v / 10.0 for v in expected), abs=0.001)
    assert summary["est_annual_income"] == pytest.approx(12 * 0.1 * 100)
    assert summary["has_reconstructed"] is True and summary["has_actual"] is False
    assert body["per_ticker"][0]["model"] is True


def test_model_history_scope_and_late_starters():
    early, early_market = model_position("AAA")
    late, late_market = model_position("BBB", start=date(2026, 4, 1), months=3)
    markets = {"AAA": early_market, "BBB": late_market}

    both = history([early, late], markets)
    bbb = next(t for t in both["per_ticker"] if t["ticker"] == "BBB")
    assert bbb["labels"] == ["2026-04", "2026-05", "2026-06"]  # pays nothing before it traded

    only = history([early, late], markets, tickers={"BBB"}, single_ticker="BBB")
    assert [t["ticker"] for t in only["per_ticker"]] == ["BBB"]
    assert only["series"]["labels"] == ["2026-04", "2026-05", "2026-06"]
    assert history([early, late], markets, tickers=set())["series"]["labels"] == []


@pytest.fixture
def model_client(db, monkeypatch):
    conn = db()
    conn.execute("INSERT INTO builder_portfolios (id, profile_id, name) VALUES (7, 2, 'Income Model')")
    conn.executemany("INSERT INTO builder_holdings (portfolio_id, ticker, dollar_amount) VALUES (?, ?, ?)",
                     [(7, "AAA", 1000), (7, "ZZZ", 500)])
    conn.execute("INSERT INTO categories (id, name, profile_id) VALUES (40, 'Income', 1)")
    conn.execute("INSERT INTO subcategories (id, category_id, parent_id, name, profile_id) VALUES (41, 40, NULL, 'Monthly', 1)")
    conn.execute("INSERT INTO subcategories (id, category_id, parent_id, name, profile_id) VALUES (42, 40, 41, 'ETFs', 1)")
    conn.execute("INSERT INTO ticker_categories (ticker, category_id, profile_id, subcategory_id) VALUES ('AAA', 40, 1, 42)")
    conn.commit()
    conn.close()
    today = date.today()
    ex_days = [month_day(m, 10) for m in range(1, 8)]

    def loader(symbol, start, end):
        if symbol == "ZZZ":
            return None
        return market(month_day(9, 1), end, 10.0, [(d, 0.1) for d in ex_days if d <= today])

    monkeypatch.setattr(app_module, "_nav_screen_market_history", loader)
    return app_module.app.test_client()


def test_model_endpoint_models_history_for_any_accounts_builder_model(model_client):
    response = model_client.get("/api/reinvestment-impact/data?profile_id=1&view=monthly&months_back=24&builder_id=7")
    assert response.status_code == 200
    body = response.get_json()
    assert body["model"]["name"] == "Income Model" and body["model"]["unavailable"] == ["ZZZ"]
    assert [t["ticker"] for t in body["per_ticker"]] == ["AAA"]
    assert len(body["series"]["labels"]) == 7
    assert body["summary"]["cash_payout"] == 0.0 and body["summary"]["pct_reinvested"] == 100.0
    # The first modeled payment: 100 shares (=$1,000 / $10) × $0.10.
    assert body["series"]["payout"][0] == pytest.approx(10.0)

    scoped = model_client.get("/api/reinvestment-impact/data?profile_id=1&months_back=24&builder_id=7&category=40").get_json()
    assert [t["ticker"] for t in scoped["per_ticker"]] == ["AAA"]
    none = model_client.get("/api/reinvestment-impact/data?profile_id=1&months_back=24&builder_id=7&ticker=ZZZ").get_json()
    assert none["per_ticker"] == [] and none["series"]["labels"] == []

    assert model_client.get("/api/reinvestment-impact/data?profile_id=1&builder_id=999").status_code == 404
    assert model_client.get("/api/reinvestment-impact/data?profile_id=1&builder_id=x").status_code == 400


def test_model_holdings_carry_the_sub_category_chain(model_client):
    rows = model_client.get("/api/portfolio-distributions/model-holdings?builder_id=7&profile_id=1").get_json()["rows"]
    aaa = next(r for r in rows if r["ticker"] == "AAA")
    assert (aaa["category"], aaa["subcategory_id"], aaa["subcategory_path_ids"]) == ("Income", 42, [41, 42])
