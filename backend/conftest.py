"""Shared test fixtures for the backend suite."""
import sys

import pytest

import yahoo_gateway


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
