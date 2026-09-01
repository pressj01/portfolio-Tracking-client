"""Shared test fixtures for the backend suite."""
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
