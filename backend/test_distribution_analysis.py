from datetime import date
import sqlite3

import pytest

import app as app_module
import database
from distribution_analysis import analyze_distribution_market, build_distribution_history


TODAY = date(2026, 8, 7)


@pytest.fixture
def connection(tmp_path, monkeypatch):
    path = tmp_path / "distribution.db"

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


def pay(conn, ticker, pid, day, amount, source="manual"):
    conn.execute("INSERT INTO dividend_payments (ticker, profile_id, payment_date, amount, source) VALUES (?, ?, ?, ?, ?)",
                 (ticker, pid, day, amount, source))


def test_monthly_cash_separates_estimates_includes_closed_and_reconciles_years(connection):
    pay(connection, "OLD", 2, "2025-12-05", 25)
    pay(connection, "QQQI", 2, "2026-01-05", 100)
    pay(connection, "QQQI", 3, "2026-01-05", 50)
    pay(connection, "CLOSED", 3, "2026-08-05", 20)
    pay(connection, "QQQI", 2, "2026-08-06", 70, "refresh_estimate")
    pay(connection, "QQQI", 3, "2026-08-07", 10, "projection")
    pay(connection, "QQQI", 2, "2026-08-08", 999)  # future, even if marked confirmed
    pay(connection, "QQQI", 4, "2026-01-05", 999)  # unrelated account
    connection.executemany("INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares, realized_gain, notes) VALUES (?, ?, 'SELL', ?, 1, ?, ?)",
                           [("CLOSED", 2, "2026-07-01", -30, ""), ("CLOSED", 3, "2026-07-01", 10, ""),
                            ("QQQI", 2, "2026-07-02", 99, "[Transfer out]"), ("QQQI", 4, "2026-07-02", 500, "")])
    result = build_distribution_history(connection, [2, 3, 2], 2026, TODAY)
    rows = {r["ticker"]: r for r in result["rows"]}
    assert rows["QQQI"]["actual"] == [150, 0, 0, 0, 0, 0, 0, 0, None, None, None, None]
    assert rows["QQQI"]["estimated"][7] == 80
    assert rows["CLOSED"]["actual"][7] == 20
    assert result["previous_december"] == {"actual": 25, "estimated": None}
    assert result["past_30_days"] == {"actual": 20, "estimated": 80}
    assert result["yearly"] == [
        {"year": 2025, "actual": 25, "estimated": 0, "realized_gain": None},
        {"year": 2026, "actual": 170, "estimated": 80, "realized_gain": -20},
    ]
    assert result["years"] == [2026, 2025]
    old = build_distribution_history(connection, [2, 3], 2025, TODAY)
    assert old["rows"][0]["actual"][-1] == 25
    assert old["previous_december"]["actual"] is None


def test_api_scopes_owner_single_and_aggregate_without_double_count(connection):
    pay(connection, "FUND", 1, "2024-01-10", 1000)  # Owner is a rollup when linked
    pay(connection, "FUND", 2, "2024-01-10", 25)
    pay(connection, "FUND", 3, "2024-01-10", 35)
    pay(connection, "FUND", 4, "2024-01-10", 500)
    connection.execute("INSERT INTO aggregates (id, name) VALUES (5, 'Combined')")
    connection.executemany("INSERT INTO aggregate_config (aggregate_id, member_profile_id) VALUES (5, ?)", [(2,), (3,)])
    connection.commit()
    client = app_module.app.test_client()
    for scope, expected in [("profile_id=1", 60), ("profile_id=2", 25), ("aggregate_id=5", 60)]:
        response = client.get(f"/api/portfolio-distributions?{scope}&year=2024")
        assert response.status_code == 200
        assert response.get_json()["rows"][0]["actual"][0] == expected
    assert client.get("/api/portfolio-distributions?year=not-a-year").status_code == 400
    assert client.get("/api/portfolio-distributions?year=9999").status_code == 400


def test_estimate_only_ticker_remains_in_monthly_history_without_marking_paid(connection):
    # A held quarterly payer may have only estimates until a broker activity
    # file supplies the matching confirmed dividend cash.
    pay(connection, "CVS", 2, "2026-02-02", 13.30, "refresh_estimate")
    pay(connection, "CVS", 2, "2026-05-04", 13.30, "refresh_estimate")
    result = build_distribution_history(connection, [2], 2026, TODAY)
    assert len(result["rows"]) == 1
    row = result["rows"][0]
    assert row["ticker"] == "CVS"
    assert sum(v or 0 for v in row["actual"]) == 0
    assert row["estimated"][1] == row["estimated"][4] == 13.30
    assert result["yearly"][0]["actual"] == 0
    assert result["yearly"][0]["estimated"] == 26.60


def test_unsupported_wrong_account_duplicate_is_not_counted_but_real_accounts_are_preserved(connection):
    # A $42.56 GPTY payment was recorded in one account; an identical projection
    # was left in a different account that never held the ticker.
    pay(connection, "GPTY", 2, "2026-07-16", 42.56, "schwab_transactions")
    pay(connection, "GPTY", 3, "2026-07-16", 42.56, "refresh_estimate")
    # A separate account that really holds the same ticker could legitimately
    # receive an identical amount. Its estimate must not be suppressed.
    connection.execute("INSERT INTO all_account_info (ticker, profile_id, quantity) VALUES ('GPTY', 4, 20)")
    pay(connection, "GPTY", 4, "2026-07-16", 42.56, "refresh_estimate")
    # A formerly held position with a trade record also has ownership evidence.
    connection.execute("INSERT INTO transactions (ticker, profile_id, transaction_type, transaction_date, shares) VALUES ('OLD', 3, 'BUY', '2026-01-01', 1)")
    pay(connection, "OLD", 2, "2026-07-17", 10, "schwab_transactions")
    pay(connection, "OLD", 3, "2026-07-17", 10, "refresh_estimate")
    # An estimate-only holding with no exact counterpart is still an estimate,
    # not automatically a duplicate, even if the historical holding is absent.
    pay(connection, "UNMATCHED", 3, "2026-07-18", 7, "refresh_estimate")
    result = build_distribution_history(connection, [2, 3, 4], 2026, TODAY)
    rows = {row["ticker"]: row for row in result["rows"]}
    assert rows["GPTY"]["actual"][6] == 42.56
    assert rows["GPTY"]["estimated"][6] == 42.56
    assert rows["OLD"]["estimated"][6] == 10
    assert rows["UNMATCHED"]["estimated"][6] == 7
    assert result["excluded_duplicate_estimates"] == {"count": 1, "amount": 42.56, "tickers": ["GPTY"]}
    assert result["past_30_days"] == {"actual": 52.56, "estimated": 59.56}
    assert result["yearly"][0]["estimated"] == 59.56
    # The report excludes the orphan without deleting any original records.
    assert connection.execute("SELECT COUNT(*) FROM dividend_payments WHERE ticker='GPTY'").fetchone()[0] == 3


def market_fixture():
    dates = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-06", "2026-05-05", "2026-06-05"]
    closes = [10, 8, 10, 8, 10, 10]
    payouts = [1, 1, 1, 1.5, 1.5, 1.5]
    prices = [{"date": "2025-01-02", "close": 10}]
    for day, close in zip(dates, closes):
        previous = date.fromisoformat(day).replace(day=int(day[-2:]) - 1)
        prices.extend([{"date": previous.isoformat(), "close": close}, {"date": day, "close": 20}])
    return {"provider": "test", "prices": prices + [{"date": "2026-08-07", "close": 15}],
            "distributions": [{"date": d, "amount": a} for d, a in zip(dates, payouts)],
            "distributions_complete": True, "corporate_actions_resolved": True}


def test_market_analyzer_uses_previous_close_and_compares_payouts():
    result = analyze_distribution_market(market_fixture(), TODAY)
    assert result["frequency"] == "Monthly"
    assert result["low"] == pytest.approx(120)
    assert result["high"] == pytest.approx(225)
    assert result["latest"] == pytest.approx(180)
    assert result["average"] == pytest.approx((120 + 150 + 120 + 225 + 180 + 180) / 6)
    assert result["down_average"] == pytest.approx((150 + 225) / 2)
    assert result["up_average"] == pytest.approx((120 + 180) / 2)
    assert result["down_up"] == pytest.approx(37.5)
    assert result["price_change"] == pytest.approx(0)
    assert result["payout_trend"] == pytest.approx(50)
    assert result["ttm_per_share"] == pytest.approx(7.5)
    assert result["ttm_yield"] == pytest.approx(50)
    assert result["events"][0]["close"] == 10  # ex-date close was 20


def test_new_fund_missing_previous_close_and_missing_corporate_actions():
    market = market_fixture()
    market["prices"] = market["prices"][2:]  # no price before the first payout
    result = analyze_distribution_market(market, TODAY)
    assert result["ttm_yield"] is None
    assert result["events"][0]["annualized_yield"] is None
    assert result["priced_count"] == 5
    market["corporate_actions_resolved"] = False
    assert analyze_distribution_market(market, TODAY)["status"] == "unavailable"


def test_analyzer_api_preserves_individual_market_errors(connection, monkeypatch):
    def loader(ticker, start, end):
        if ticker == "FAIL":
            raise RuntimeError("unavailable")
        return market_fixture()

    monkeypatch.setattr(app_module, "_nav_screen_market_history", loader)
    client = app_module.app.test_client()
    response = client.get("/api/portfolio-distributions/analyzer?tickers=QQQI,FAIL,QQQI&profile_id=2")
    assert response.status_code == 200
    rows = response.get_json()["rows"]
    assert [(r["ticker"], r["status"]) for r in rows] == [("QQQI", "ok"), ("FAIL", "unavailable")]
    assert client.get("/api/portfolio-distributions/analyzer").status_code == 400
