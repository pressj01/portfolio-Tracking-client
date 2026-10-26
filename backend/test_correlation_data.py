import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as app_module
from grading import portfolio_returns_frame


def _as_download(close):
    zeros = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    return pd.concat({"Close": close, "Adj Close": close, "Dividends": zeros}, axis=1)


def _market_close(periods=80, start="2026-01-05", seed=11):
    dates = pd.bdate_range(start, periods=periods)
    rng = np.random.default_rng(seed)
    specs = {
        "AAA": (100, 0.0006, 0.020),
        "BBB": (80, 0.0002, 0.015),
        "CCC": (50, -0.0004, 0.030),
        "SPY": (475, 0.0004, 0.010),
        "QQQ": (405, 0.0005, 0.013),
    }
    return pd.DataFrame(
        {
            name: base * np.cumprod(1 + rng.normal(drift, vol, len(dates)))
            for name, (base, drift, vol) in specs.items()
        },
        index=dates,
    )


class CorrelationDataTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY, name TEXT, include_in_owner INTEGER DEFAULT 0
            );
            CREATE TABLE aggregates (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE aggregate_config (aggregate_id INTEGER, member_profile_id INTEGER);
            CREATE TABLE all_account_info (
                ticker TEXT, profile_id INTEGER, quantity REAL, current_value REAL
            );
            INSERT INTO profiles VALUES (2, 'Brokerage', 0), (3, 'Roth IRA', 0), (4, 'SPY', 0),
                                        (5, 'Empty', 0);
            INSERT INTO aggregates VALUES (7, 'Retirement');
            INSERT INTO aggregate_config VALUES (7, 2), (7, 3);
            INSERT INTO all_account_info VALUES
                ('AAA', 2, 10, 3000), ('BBB', 2, 20, 1000), ('NOPE', 2, 5, 500),
                ('BBB', 3, 5, 1000), ('CCC', 3, 8, 2000),
                ('QQQ', 4, 1, 400),
                ('AAA', 5, 0, 0);
            """
        )
        conn.commit()
        conn.close()

        self.close = _market_close()
        self.downloads = []
        self.orig_connection = app_module.get_connection
        self.orig_download = app_module._chunked_yf_download
        self.orig_testing = app_module.app.testing
        self.orig_initialized = getattr(app_module.app, "_db_initialized", False)
        app_module.get_connection = self._get_connection
        app_module._chunked_yf_download = self._download
        app_module.app.testing = True
        app_module.app._db_initialized = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.get_connection = self.orig_connection
        app_module._chunked_yf_download = self.orig_download
        app_module.app.testing = self.orig_testing
        app_module.app._db_initialized = self.orig_initialized
        Path(self.db_path).unlink(missing_ok=True)

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _download(self, tickers, **kwargs):
        names = tickers.split() if isinstance(tickers, str) else list(tickers)
        self.downloads.append(names)
        cols = [n for n in names if n in self.close.columns]
        return _as_download(self.close[cols])

    def _post(self, **body):
        body.setdefault("period", "1y")
        response = self.client.post("/api/correlation/data", json=body)
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def _cell(self, payload, a, b):
        labels = payload["tickers"]
        return payload["matrix"][labels.index(a)][labels.index(b)]

    def test_tickers_only_matches_the_plain_pairwise_correlation(self):
        payload = self._post(tickers=["SPY", "QQQ", "ZZZ"])

        self.assertEqual(payload["tickers"], ["SPY", "QQQ"])
        self.assertEqual(payload["missing"], ["ZZZ"])
        self.assertEqual(payload["data_points"], len(self.close))
        expected = self.close["SPY"].pct_change().corr(self.close["QQQ"].pct_change())
        self.assertAlmostEqual(self._cell(payload, "SPY", "QQQ"), round(expected, 3), places=3)
        self.assertEqual([s["kind"] for s in payload["series"]], ["ticker", "ticker"])

    def test_portfolio_is_one_value_weighted_series(self):
        payload = self._post(tickers=["SPY"], portfolios=[{"kind": "profile", "id": 2}])

        self.assertEqual(payload["tickers"], ["SPY", "Brokerage"])
        weights = np.array([3000.0, 1000.0]) / 4000.0
        port = portfolio_returns_frame(self.close[["AAA", "BBB"]]).dot(weights)
        expected = port.corr(self.close["SPY"].pct_change().iloc[1:])
        self.assertAlmostEqual(self._cell(payload, "SPY", "Brokerage"), round(expected, 3), places=3)

        info = payload["series"][1]
        self.assertEqual(info["kind"], "portfolio")
        self.assertEqual(info["holdings_total"], 3)
        self.assertEqual(info["holdings_priced"], 2)
        self.assertEqual(info["unpriced"], ["NOPE"])
        self.assertAlmostEqual(info["value_coverage_pct"], 88.9)
        # The holdings rode along in the same download as the typed ticker.
        self.assertEqual(len(self.downloads), 1)
        self.assertEqual(set(self.downloads[0]), {"SPY", "AAA", "BBB", "NOPE"})

    def test_two_portfolios_need_no_tickers(self):
        payload = self._post(portfolios=[
            {"kind": "profile", "id": 2},
            {"kind": "aggregate", "id": 7},
        ])

        self.assertEqual(payload["tickers"], ["Brokerage", "Retirement"])
        # The aggregate sums its members per ticker: AAA 3000, BBB 1000+1000,
        # CCC 2000 (NOPE has no prices and drops out of the weights).
        weights = np.array([3000.0, 2000.0, 2000.0]) / 7000.0
        retirement = portfolio_returns_frame(self.close[["AAA", "BBB", "CCC"]]).dot(weights)
        brokerage = portfolio_returns_frame(self.close[["AAA", "BBB"]]).dot(np.array([0.75, 0.25]))
        self.assertAlmostEqual(
            self._cell(payload, "Brokerage", "Retirement"),
            round(brokerage.corr(retirement), 3),
            places=3,
        )
        self.assertEqual(payload["series"][1]["holdings_total"], 4)
        self.assertEqual(payload["series"][1]["holdings_priced"], 3)

    def test_portfolio_named_like_a_ticker_gets_a_distinct_label(self):
        payload = self._post(tickers=["SPY", "QQQ"], portfolios=[{"kind": "profile", "id": 4}])

        self.assertEqual(payload["tickers"], ["SPY", "QQQ", "SPY (portfolio)"])
        # A one-holding portfolio of QQQ moves exactly with QQQ.
        self.assertAlmostEqual(self._cell(payload, "QQQ", "SPY (portfolio)"), 1.0, places=3)

    def test_empty_or_unknown_portfolios_are_reported_missing(self):
        payload = self._post(tickers=["SPY", "QQQ"], portfolios=[
            {"kind": "profile", "id": 5},
            {"kind": "aggregate", "id": 99},
        ])

        self.assertEqual(payload["tickers"], ["SPY", "QQQ"])
        self.assertEqual(payload["missing"], ["Empty (no holdings)", "Portfolio (not found)"])

    def test_one_portfolio_with_holdings_runs_on_its_own(self):
        payload = self._post(portfolios=[{"kind": "profile", "id": 2, "holdings": True}])

        # Largest position first, unpriced NOPE left out, whole portfolio last.
        self.assertEqual(payload["tickers"], ["AAA", "BBB", "Brokerage"])
        self.assertEqual([s["kind"] for s in payload["series"]], ["holding", "holding", "portfolio"])
        self.assertEqual(payload["series"][0]["weight_pct"], 75.0)
        self.assertEqual(payload["series"][0]["portfolio"], "Brokerage")
        expected = self.close["AAA"].pct_change().corr(self.close["BBB"].pct_change())
        self.assertAlmostEqual(self._cell(payload, "AAA", "BBB"), round(expected, 3), places=3)
        port = portfolio_returns_frame(self.close[["AAA", "BBB"]]).dot(np.array([0.75, 0.25]))
        self.assertAlmostEqual(
            self._cell(payload, "AAA", "Brokerage"),
            round(port.corr(self.close["AAA"].pct_change().iloc[1:]), 3),
            places=3,
        )

    def test_holdings_are_listed_once_across_tickers_and_portfolios(self):
        payload = self._post(tickers=["BBB"], portfolios=[
            {"kind": "profile", "id": 2, "holdings": True},
            {"kind": "aggregate", "id": 7, "holdings": True},
        ])

        self.assertEqual(
            payload["tickers"], ["BBB", "AAA", "CCC", "Brokerage", "Retirement"],
        )
        ccc = payload["series"][2]
        self.assertEqual((ccc["kind"], ccc["portfolio"]), ("holding", "Retirement"))

    def test_holdings_too_young_to_stand_alone_stay_in_the_portfolio(self):
        self.close.loc[self.close.index[:60], "BBB"] = np.nan

        payload = self._post(portfolios=[{"kind": "profile", "id": 2, "holdings": True}])

        self.assertEqual(payload["tickers"], ["AAA", "Brokerage"])
        info = payload["series"][-1]
        self.assertEqual(info["short_history"], ["BBB"])
        self.assertEqual(info["holdings_priced"], 2)

    def test_a_single_series_is_rejected(self):
        payload = self._post(portfolios=[{"kind": "profile", "id": 2}])
        self.assertIn("at least 2", payload["error"])

        payload = self._post(tickers=["SPY"], portfolios=[{"kind": "bogus", "id": 2}])
        self.assertIn("at least 2", payload["error"])

    def test_a_holding_on_another_calendar_leaves_ticker_cells_alone(self):
        # A weekend-trading holding adds Saturday rows to the download. The
        # SPY/QQQ cell must not change because a portfolio held it.
        saturdays = pd.date_range(self.close.index[0], self.close.index[-1], freq="W-SAT")
        crypto = pd.Series(np.linspace(60000, 66000, len(self.close) + len(saturdays)),
                           index=self.close.index.union(saturdays))
        self.close = self.close.reindex(crypto.index)
        self.close["BTC-USD"] = crypto
        conn = sqlite3.connect(self.db_path)
        conn.execute("INSERT INTO all_account_info VALUES ('BTC-USD', 4, 1, 60000)")
        conn.commit()
        conn.close()

        alone = self._post(tickers=["SPY", "QQQ"])
        with_portfolio = self._post(tickers=["SPY", "QQQ"], portfolios=[{"kind": "profile", "id": 4}])

        self.assertEqual(self._cell(alone, "SPY", "QQQ"), self._cell(with_portfolio, "SPY", "QQQ"))
        self.assertEqual(alone["data_points"], len(self.close) - len(saturdays))


if __name__ == "__main__":
    unittest.main()
