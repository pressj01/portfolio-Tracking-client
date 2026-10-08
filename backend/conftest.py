"""Shared test fixtures for the backend suite."""
import atexit
import os
import shutil
import sys
import tempfile

# Point the whole suite at a throwaway database, and do it before anything
# imports config: DB_PATH is fixed at import. Most tests swap app.get_connection
# for their own file, but that swap does not reach the modules that import
# get_connection straight from config (market_data_provider, yahoo_gateway, ...)
# or the before_request migrations, and those were landing on the developer's
# real portfolio.db. That is how a suite run read a live Tiingo key and made
# real requests with it, ran startup repairs on real holdings, and left a
# gigabyte of "pre-import" snapshots in backups/, pushing real ones out of the
# retention window. The file is created empty so config does not treat the temp
# folder as a fresh install and copy the real database into it.
_SUITE_DB_DIR = tempfile.mkdtemp(prefix="portfolio-tests-")
open(os.path.join(_SUITE_DB_DIR, "portfolio.db"), "wb").close()
os.environ["PORTFOLIO_DB_DIR"] = _SUITE_DB_DIR
atexit.register(shutil.rmtree, _SUITE_DB_DIR, ignore_errors=True)

import pytest  # noqa: E402

import yahoo_gateway  # noqa: E402
from config import get_connection  # noqa: E402
from database import ensure_tables_exist  # noqa: E402

# Several suites reach the shared database through the real connection and
# expect its tables to be there already, as they are on a machine that has run
# the app. Build the schema once so a first run behaves the same as a later one.
_suite_conn = get_connection()
try:
    ensure_tables_exist(_suite_conn)
    _suite_conn.commit()
finally:
    _suite_conn.close()


@pytest.fixture(autouse=True)
def _isolate_yahoo_gateway():
    """Reset the Yahoo rate-limit state between tests.

    The circuit breaker is deliberately process-wide: a throttle met by the
    scanner *should* stop the dashboard from calling Yahoo a moment later. That
    is the point of it in production, but it makes tests order-dependent —
    several suites simulate a throttled feed, and without this the breaker they
    trip stays shut and every later test that touches Yahoo gets a cooldown
    instead of its mocked response.

    Also drops the buffered last-good writes and any reused download, so a
    payload remembered by one test cannot be recalled by the next.
    """
    yahoo_gateway.reset_breaker()
    yahoo_gateway.reset_persistence()
    yahoo_gateway.reset_reuse_cache()
    yield
    yahoo_gateway.reset_breaker()
    yahoo_gateway.reset_persistence()
    yahoo_gateway.reset_reuse_cache()


@pytest.fixture(autouse=True)
def _no_live_neos_fund_pages(monkeypatch):
    """Keep neosfunds.com out of the suite.

    The dashboard, Action Center, watchlist, comparer, and fund search all read
    NEOS Net Assets from the issuer's page, so any test that happens to hold a
    NEOS ticker (BTCI, QQQI, ...) would otherwise go to the network. Tests that
    exercise the NEOS path patch ``_fetch_neos_etf_profile`` themselves.
    """
    app = sys.modules.get("app")
    if app is None or not hasattr(app, "_NEOS_FUND_FACTS_CACHE"):
        yield
        return
    app._NEOS_FUND_FACTS_CACHE.clear()
    app._NEOS_FUND_FACTS_MISSES.clear()
    monkeypatch.setattr(app, "_fetch_neos_etf_profile", lambda ticker: None)
    yield
    app._NEOS_FUND_FACTS_CACHE.clear()
    app._NEOS_FUND_FACTS_MISSES.clear()
