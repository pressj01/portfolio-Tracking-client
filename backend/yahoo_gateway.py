"""Centralized guard rails for every Yahoo request the app makes.

Yahoo's rate limiter cannot be avoided — there is no key to raise, and the free
quote/chain endpoints throttle by IP. What *can* be controlled is how the app
behaves once throttling starts, and the failure mode this module exists to stop
is the one that made throttling so damaging: a rate-limited response was
treated as an ordinary miss, so the app immediately retried it, symbol by
symbol, from several code paths at once. That turns one 429 into dozens and
extends the throttle instead of riding it out.

Five mechanisms, all shared rather than per-caller:

* **429-aware exponential backoff.** A throttled call is retried with growing,
  jittered pauses (honouring ``Retry-After`` when the exception carries a
  response). A miss that is *not* a throttle — a delisted symbol, a bad period
  — is not retried at all, because a retry cannot change that answer.
* **A cooldown circuit breaker.** After a few consecutive throttles the gate
  closes: further calls fail fast with :class:`YahooCooldown` instead of
  reaching Yahoo. Repeat trips lengthen the cooldown, and the gate reopens
  through a single probe rather than releasing every waiting thread at once.
* **Missing-ticker-only retries.** After a batch download only the symbols that
  actually came back empty are re-requested, and only when the batch was mostly
  successful — a wholly empty batch is a feed outage that per-symbol retries
  would make worse.
* **Request coalescing.** Concurrent callers asking for the identical thing
  share one network request. The scanners are thread pools and a dashboard load
  fires several overlapping endpoints, so this removes duplicate work that the
  download lock previously just serialized.
* **Persistent last-good data.** Successful payloads are written to
  ``market_data_cache``; when a fetch is throttled or the breaker is open the
  last known-good value is served with an explicit staleness marker instead of
  a blank.

Nothing here imports ``app``; the module is a leaf so any backend module can
use it.
"""
from __future__ import annotations

import os
import random
import threading
import time
from collections import OrderedDict

import market_data_store as mds
from config import get_connection


# ── Tunables ────────────────────────────────────────────────────────────────
#
# Read from the environment once so a packaged build can be nudged without a
# rebuild, but the defaults are the intended operating point.

def _env_float(name, default):
    try:
        return float(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


def _env_int(name, default):
    try:
        return int(float(os.environ.get(name, "") or default))
    except (TypeError, ValueError):
        return default


# Retries are for throttles only, and deliberately few. Yahoo's throttle window
# is measured in tens of seconds; sitting in a retry loop past that just holds a
# Flask worker hostage, and the breaker below is the right tool for a sustained
# throttle.
MAX_ATTEMPTS = _env_int("YF_MAX_ATTEMPTS", 3)
BASE_BACKOFF_SEC = _env_float("YF_BASE_BACKOFF", 1.5)
MAX_BACKOFF_SEC = _env_float("YF_MAX_BACKOFF", 12.0)
# Hard ceiling on how long one logical request may spend sleeping. A user
# staring at a spinner is a worse outcome than a partial answer.
MAX_TOTAL_BACKOFF_SEC = _env_float("YF_MAX_TOTAL_BACKOFF", 20.0)

# Consecutive throttles before the gate closes. One 429 is noise; three in a row
# is Yahoo telling the app to stop.
BREAKER_THRESHOLD = _env_int("YF_BREAKER_THRESHOLD", 3)
BREAKER_BASE_COOLDOWN_SEC = _env_float("YF_BREAKER_COOLDOWN", 60.0)
BREAKER_MAX_COOLDOWN_SEC = _env_float("YF_BREAKER_MAX_COOLDOWN", 900.0)
# A trip that has not recurred for this long is forgiven, so an unlucky morning
# does not leave the app pessimistic for the rest of the session.
BREAKER_TRIP_DECAY_SEC = _env_float("YF_BREAKER_DECAY", 600.0)

# How long a coalescing follower waits for the leader before giving up and
# fetching for itself. Longer than any single call should take, short enough
# that a wedged leader cannot hang every other request behind it.
COALESCE_WAIT_SEC = _env_float("YF_COALESCE_WAIT", 45.0)

# Buffered last-good writes. A 200-ticker scan would otherwise open 200 SQLite
# connections purely to record cache rows.
PERSIST_FLUSH_ROWS = _env_int("YF_PERSIST_FLUSH_ROWS", 25)
PERSIST_FLUSH_SEC = _env_float("YF_PERSIST_FLUSH_SEC", 5.0)

DEFAULT_SOURCE = "yahoo"


class YahooCooldown(RuntimeError):
    """Raised instead of calling Yahoo while the breaker is open.

    Carries ``retry_after`` (seconds) so a caller can tell the user when the
    feed is expected back rather than reporting a generic failure, and
    ``cause`` — the text of the throttle that shut the gate — so a caller
    building a user-facing message does not have to lose what Yahoo said.
    """

    def __init__(self, retry_after=0.0, reason="Yahoo requests are cooling down",
                 cause=None):
        self.retry_after = max(0.0, float(retry_after or 0.0))
        self.cause = str(cause) if cause is not None else None
        detail = f" after {self.cause}" if self.cause else ""
        super().__init__(f"{reason} ({self.retry_after:.0f}s remaining){detail}")


# ── Throttle detection ──────────────────────────────────────────────────────

# Substrings that identify a *feed* problem rather than a *symbol* problem.
# Matching is on the lowercased exception text, so this catches yfinance's own
# wording, requests' wording, and the raw HTTP status line alike.
_THROTTLE_SIGNS = (
    "too many requests",
    "rate limit",
    "rate-limit",
    "ratelimit",
    "temporarily blocked",
    "try after a while",
)

# Transient transport failures. Not throttles, but equally worth one retry and
# equally wrong to cache as "this symbol has no data".
_TRANSIENT_SIGNS = (
    "timed out",
    "timeout",
    "connection reset",
    "connection aborted",
    "connection error",
    "max retries exceeded",
    "temporarily unavailable",
    "remote end closed",
    "bad gateway",
    "service unavailable",
)

_TRANSIENT_STATUS = (500, 502, 503, 504)


def _status_code(exc):
    """HTTP status carried by an exception, when there is one."""
    response = getattr(exc, "response", None)
    code = getattr(response, "status_code", None)
    if code is None:
        code = getattr(exc, "status_code", None)
    try:
        return int(code)
    except (TypeError, ValueError):
        return None


def _exception_text(exc):
    return f"{type(exc).__name__}: {exc}".lower()


def is_rate_limited(exc) -> bool:
    """Whether an exception means "Yahoo is throttling", not "no such symbol"."""
    if exc is None:
        return False
    if type(exc).__name__ == "YFRateLimitError":
        return True
    if _status_code(exc) == 429:
        return True
    text = _exception_text(exc)
    if any(sign in text for sign in _THROTTLE_SIGNS):
        return True
    # "429" on its own is too loose to match anywhere in a message — a strike
    # price or a share count would trip it — so it only counts next to wording
    # that makes it a status code.
    return "429" in text and ("status" in text or "http" in text or "error" in text)


def is_transient(exc) -> bool:
    """Whether an exception is a transport blip worth one more attempt."""
    if exc is None:
        return False
    if _status_code(exc) in _TRANSIENT_STATUS:
        return True
    return any(sign in _exception_text(exc) for sign in _TRANSIENT_SIGNS)


def retry_after_seconds(exc):
    """``Retry-After`` from the response behind an exception, if present."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or {}
    try:
        raw = headers.get("Retry-After") or headers.get("retry-after")
    except Exception:
        return None
    if raw is None:
        return None
    try:
        # Only the delta-seconds form is honoured. The HTTP-date form is legal
        # but Yahoo does not send it, and parsing it wrong would be worse than
        # falling back to the computed backoff.
        return max(0.0, float(str(raw).strip()))
    except (TypeError, ValueError):
        return None


# ── Circuit breaker ─────────────────────────────────────────────────────────

_breaker_lock = threading.Lock()
_breaker = {
    "consecutive": 0,     # throttles in a row since the last success
    "trips": 0,           # cooldowns opened; drives the escalating duration
    "open_until": 0.0,    # monotonic deadline, 0 when closed
    "last_trip": 0.0,     # monotonic time of the most recent trip
    "probing": False,     # a half-open probe is in flight
    "throttles": 0,       # lifetime counters, for the status endpoint
    "successes": 0,
    "last_throttle_wall": None,
    "last_error": None,   # most recent non-throttle failure, for diagnostics
    "last_error_wall": None,
}


def _cooldown_for(trips):
    span = BREAKER_BASE_COOLDOWN_SEC * (2 ** max(0, int(trips) - 1))
    return min(span, BREAKER_MAX_COOLDOWN_SEC)


def cooldown_remaining() -> float:
    """Seconds until Yahoo requests resume. 0 when the gate is open."""
    with _breaker_lock:
        return max(0.0, _breaker["open_until"] - time.monotonic())


def is_cooling_down() -> bool:
    return cooldown_remaining() > 0


def note_success():
    """Record a call that reached Yahoo and came back."""
    with _breaker_lock:
        _breaker["consecutive"] = 0
        _breaker["successes"] += 1
        _breaker["probing"] = False
        _breaker["open_until"] = 0.0
        # Forgive the escalation once the app has gone a while without being
        # throttled; otherwise one bad spell permanently lengthens every future
        # cooldown for the life of the process.
        if _breaker["trips"] and (time.monotonic() - _breaker["last_trip"]) > BREAKER_TRIP_DECAY_SEC:
            _breaker["trips"] = 0


def note_rate_limit(retry_after=None):
    """Record a throttled call, opening the gate once they stop being isolated.

    Returns the seconds of cooldown now in force (0 while still closed).
    """
    now = time.monotonic()
    with _breaker_lock:
        _breaker["consecutive"] += 1
        _breaker["throttles"] += 1
        _breaker["last_throttle_wall"] = time.time()
        was_probing = _breaker["probing"]
        _breaker["probing"] = False
        # A failed half-open probe means the throttle is still on: escalate
        # immediately rather than waiting to accumulate a fresh run of failures.
        if was_probing or _breaker["consecutive"] >= max(1, BREAKER_THRESHOLD):
            _breaker["trips"] += 1
            _breaker["last_trip"] = now
            cooldown = _cooldown_for(_breaker["trips"])
            if retry_after:
                cooldown = max(cooldown, float(retry_after))
            _breaker["open_until"] = now + cooldown
            _breaker["consecutive"] = 0
            return cooldown
    return 0.0


def note_failure(exc):
    """Record a non-throttle failure so the status endpoint can show a cause.

    Deliberately does not touch the breaker: a delisted symbol or a malformed
    period is a caller's problem, and counting it toward a cooldown would shut
    the feed off over data the feed answered correctly.
    """
    if exc is None:
        return
    with _breaker_lock:
        _breaker["last_error"] = f"{type(exc).__name__}: {exc}"[:300]
        _breaker["last_error_wall"] = time.time()


def _admit():
    """Claim permission to call Yahoo.

    Returns ``(allowed, retry_after)``. Exactly one caller is admitted while the
    gate is half-open, so a cooldown that has just elapsed is tested with a
    single probe instead of every blocked thread stampeding at once.
    """
    now = time.monotonic()
    with _breaker_lock:
        open_until = _breaker["open_until"]
        if open_until <= 0:
            return True, 0.0
        if now < open_until:
            return False, open_until - now
        # Cooldown elapsed: half-open.
        if _breaker["probing"]:
            return False, 0.0
        _breaker["probing"] = True
        return True, 0.0


def breaker_state() -> dict:
    """Snapshot for diagnostics and the feed-status endpoint."""
    with _breaker_lock:
        remaining = max(0.0, _breaker["open_until"] - time.monotonic())
        return {
            "cooling_down": remaining > 0,
            "retry_after_sec": round(remaining, 1),
            "consecutive_throttles": _breaker["consecutive"],
            "cooldowns_opened": _breaker["trips"],
            "throttles_seen": _breaker["throttles"],
            "successful_calls": _breaker["successes"],
            "last_throttle_at": _breaker["last_throttle_wall"],
            "last_error": _breaker["last_error"],
            "last_error_at": _breaker["last_error_wall"],
            "probing": _breaker["probing"],
        }


def reset_breaker():
    """Clear all breaker state. For tests, and for a user-driven "try again"."""
    with _breaker_lock:
        _breaker.update(
            consecutive=0, trips=0, open_until=0.0, last_trip=0.0, probing=False,
            throttles=0, successes=0, last_throttle_wall=None,
            last_error=None, last_error_wall=None,
        )


# ── Backoff-wrapped call ────────────────────────────────────────────────────

# yfinance keeps each download's frames in a module-level dict keyed by ticker
# alone, so concurrent downloads read each other's frames. This is the app-wide
# writer lock for that shared state; it lives here so the gateway can hold it
# for the network call and release it while sleeping between retries — a backoff
# pause must not block every other Yahoo caller in the process.
DOWNLOAD_LOCK = threading.RLock()


def _sleep_backoff(attempt, retry_after, budget_left):
    """Pause before the next attempt. Returns the seconds actually slept."""
    delay = float(retry_after) if retry_after else BASE_BACKOFF_SEC * (2 ** attempt)
    delay = min(delay, MAX_BACKOFF_SEC, max(0.0, budget_left))
    if delay <= 0:
        return 0.0
    # Half-to-full jitter: still grows, but several throttled callers do not
    # line up and retry in the same instant.
    delay *= 0.5 + random.random() * 0.5
    time.sleep(delay)
    return delay


def call(fn, *, lock=None, attempts=None, fail_fast=False):
    """Run one Yahoo-touching callable under the breaker and backoff policy.

    ``fn`` takes no arguments. ``lock`` is held only for the duration of each
    attempt, never across a backoff sleep.

    Raises :class:`YahooCooldown` when the breaker is open — the call is not
    attempted. Any other exception is the one Yahoo (or yfinance) produced,
    re-raised once retries are exhausted, so existing ``except Exception``
    handlers keep behaving as they do today.
    """
    allowed, retry_after = _admit()
    if not allowed:
        raise YahooCooldown(retry_after)

    limit = 1 if fail_fast else max(1, int(attempts if attempts is not None else MAX_ATTEMPTS))
    budget = MAX_TOTAL_BACKOFF_SEC
    last_exc = None

    for attempt in range(limit):
        try:
            if lock is not None:
                with lock:
                    result = fn()
            else:
                result = fn()
        except YahooCooldown:
            raise
        except Exception as exc:  # noqa: BLE001 - the policy decision is below
            last_exc = exc
            hinted = None
            if is_rate_limited(exc):
                hinted = retry_after_seconds(exc)
                cooldown = note_rate_limit(hinted)
                if cooldown:
                    # The gate just closed. Retrying now is exactly the
                    # behaviour that extends a throttle.
                    raise YahooCooldown(cooldown, cause=exc) from exc
            elif not is_transient(exc):
                # A symbol Yahoo does not have, a bad period, a parse error:
                # the same request will fail the same way. Fail immediately.
                note_failure(exc)
                raise
            if attempt + 1 >= limit or budget <= 0:
                note_failure(exc)
                raise
            budget -= _sleep_backoff(attempt, hinted, budget)
        else:
            note_success()
            return result

    if last_exc is not None:
        raise last_exc
    return None


# ── Request coalescing ──────────────────────────────────────────────────────

_inflight_lock = threading.Lock()
_inflight: dict = {}


class _Flight:
    __slots__ = ("event", "value", "error")

    def __init__(self):
        self.event = threading.Event()
        self.value = None
        self.error = None


def _defensive_copy(value):
    """Give each coalesced caller its own object.

    Callers routinely mutate what a fetch hands back — the dashboard grade path
    assigns recovered columns straight into the downloaded frame. Sharing one
    object between coalesced callers would let those edits leak sideways into an
    unrelated request, a far subtler bug than the duplicate download this saves.
    """
    if value is None or isinstance(value, (str, bytes, int, float, bool, tuple)):
        return value
    copier = getattr(value, "copy", None)
    if callable(copier):
        try:
            return copier()
        except Exception:
            return value
    return value


def coalesce(key, producer, *, wait_sec=None):
    """Run ``producer`` once on behalf of concurrent callers sharing ``key``.

    The first caller in does the work; the rest wait on it and receive their own
    copy of the result, or the same exception. A follower that waits longer than
    ``wait_sec`` stops waiting and fetches for itself rather than hanging behind
    a wedged leader.
    """
    if key is None:
        return producer()

    with _inflight_lock:
        flight = _inflight.get(key)
        leader = flight is None
        if leader:
            flight = _Flight()
            _inflight[key] = flight

    if leader:
        try:
            flight.value = producer()
        except BaseException as exc:  # noqa: BLE001 - re-raised below verbatim
            flight.error = exc
        finally:
            with _inflight_lock:
                if _inflight.get(key) is flight:
                    del _inflight[key]
            flight.event.set()
        if flight.error is not None:
            raise flight.error
        return _defensive_copy(flight.value)

    timeout = COALESCE_WAIT_SEC if wait_sec is None else wait_sec
    if not flight.event.wait(timeout=timeout):
        return producer()
    if flight.error is not None:
        raise flight.error
    return _defensive_copy(flight.value)


def inflight_count() -> int:
    with _inflight_lock:
        return len(_inflight)


# ── Persistent last-good payloads ───────────────────────────────────────────

_persist_lock = threading.Lock()
_persist_buffer: dict = {}
_persist_last_flush = [0.0]


def _buffer_key(source, ticker, kind):
    return (str(source or ""), str(ticker or "").strip().upper(), str(kind or ""))


def remember(kind, ticker, payload, *, source=DEFAULT_SOURCE, flush=False):
    """Record a successful payload as this symbol's last-good value.

    Writes are buffered: a wide scan records hundreds of payloads and each one
    would otherwise cost its own SQLite connection. The buffer is also read back
    by :func:`recall`, so a value is available immediately whether or not it has
    reached disk yet.
    """
    if payload is None:
        return
    key = _buffer_key(source, ticker, kind)
    with _persist_lock:
        _persist_buffer[key] = (payload, time.time())
        due = (
            flush
            or len(_persist_buffer) >= PERSIST_FLUSH_ROWS
            or (time.time() - _persist_last_flush[0]) >= PERSIST_FLUSH_SEC
        )
    if due:
        flush_persisted()


def flush_persisted():
    """Write buffered last-good payloads to ``market_data_cache``."""
    with _persist_lock:
        if not _persist_buffer:
            _persist_last_flush[0] = time.time()
            return
        pending = list(_persist_buffer.items())
        _persist_buffer.clear()
        _persist_last_flush[0] = time.time()
    conn = None
    try:
        conn = get_connection()
        for (source, ticker, kind), (payload, _written_at) in pending:
            try:
                mds.save(conn, source, ticker, kind, payload)
            except Exception:
                continue
        conn.commit()
    except Exception:
        # Persistence is a convenience, never a reason to fail a live request.
        # The payloads are dropped rather than retried; the next successful
        # fetch re-records them.
        return
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def recall(kind, ticker, *, source=DEFAULT_SOURCE, max_age_sec=None):
    """Last-good payload for a symbol, or None.

    ``max_age_sec=None`` returns the last success however old it is — that is
    the point during an outage. Pass a TTL to use this as an ordinary cache.
    """
    key = _buffer_key(source, ticker, kind)
    with _persist_lock:
        buffered = _persist_buffer.get(key)
    if buffered is not None:
        payload, written_at = buffered
        if max_age_sec is None or (time.time() - written_at) <= float(max_age_sec):
            return payload
        return None
    conn = None
    try:
        conn = get_connection()
        return mds.load(conn, source, ticker, kind, max_age_sec=max_age_sec)
    except Exception:
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def reset_persistence():
    """Drop buffered writes without flushing them. For tests."""
    with _persist_lock:
        _persist_buffer.clear()
        _persist_last_flush[0] = 0.0


# ── Short-lived download reuse (opt-in) ─────────────────────────────────────
#
# Everything above makes the app behave well *once* Yahoo is throttling. This is
# the one piece that reduces how often throttling starts, by not asking twice
# for something already in hand: flip back and forth between two dashboard
# ranges and the second visit to each is served locally.
#
# It is off by default and user-controlled, because it is the only mechanism
# here that trades freshness for request volume. Everything else is invisible;
# this one changes what a price means, so the user decides.
#
# Deliberately in memory rather than in market_data_cache: the TTL is minutes,
# a cached frame is hundreds of kilobytes, and writing every download window to
# SQLite would grow the database for a benefit that only lasts the session. The
# persistent layer above already covers the case that outlives a restart —
# last-good data during an outage.

DEFAULT_REUSE_TTL_SEC = 600.0
MIN_REUSE_TTL_SEC = 60.0
MAX_REUSE_TTL_SEC = 3600.0
# Bounded so a long session cannot grow this without limit. Each entry is one
# (tickers, window) combination; a user cycling ranges touches a handful.
REUSE_MAX_ENTRIES = _env_int("YF_REUSE_MAX_ENTRIES", 48)

_reuse_lock = threading.Lock()
# Ordered so the oldest entry is the one evicted when the cache is full.
_reuse_cache: OrderedDict = OrderedDict()
_reuse_policy = {"enabled": False, "ttl_sec": DEFAULT_REUSE_TTL_SEC}
_reuse_stats = {"hits": 0, "misses": 0, "stores": 0}


def set_reuse_policy(enabled, ttl_sec=None):
    """Turn short-lived download reuse on or off, and set its window.

    Changing either setting clears whatever is held, so a user switching this
    off never sees another cached price, and a shortened TTL takes effect at
    once rather than after the old entries age out.
    """
    ttl = DEFAULT_REUSE_TTL_SEC if ttl_sec is None else float(ttl_sec)
    ttl = max(MIN_REUSE_TTL_SEC, min(MAX_REUSE_TTL_SEC, ttl))
    with _reuse_lock:
        changed = (
            bool(enabled) != _reuse_policy["enabled"]
            or ttl != _reuse_policy["ttl_sec"]
        )
        _reuse_policy["enabled"] = bool(enabled)
        _reuse_policy["ttl_sec"] = ttl
        if changed:
            _reuse_cache.clear()
    return dict(_reuse_policy)


def reuse_policy():
    with _reuse_lock:
        return dict(_reuse_policy)


def reuse_enabled():
    with _reuse_lock:
        return _reuse_policy["enabled"]


def cached_download(key):
    """A recent identical download, or None. Returns ``(payload, age_sec)``."""
    if key is None:
        return None
    with _reuse_lock:
        if not _reuse_policy["enabled"]:
            return None
        entry = _reuse_cache.get(key)
        if entry is None:
            _reuse_stats["misses"] += 1
            return None
        stored_at, payload = entry
        age = time.time() - stored_at
        if age > _reuse_policy["ttl_sec"]:
            del _reuse_cache[key]
            _reuse_stats["misses"] += 1
            return None
        _reuse_cache.move_to_end(key)
        _reuse_stats["hits"] += 1
    return _defensive_copy(payload), age


def store_download(key, payload):
    """Remember a *successful* download for reuse inside the TTL.

    An empty or failed result is never stored. Caching one would reproduce the
    bug this whole module exists to remove: a throttled answer served back as
    though it were the market's.
    """
    if key is None or payload is None:
        return
    if getattr(payload, "empty", False):
        return
    with _reuse_lock:
        if not _reuse_policy["enabled"]:
            return
        _reuse_cache[key] = (time.time(), _defensive_copy(payload))
        _reuse_cache.move_to_end(key)
        _reuse_stats["stores"] += 1
        while len(_reuse_cache) > max(1, REUSE_MAX_ENTRIES):
            _reuse_cache.popitem(last=False)


def reuse_stats():
    with _reuse_lock:
        total = _reuse_stats["hits"] + _reuse_stats["misses"]
        return {
            "enabled": _reuse_policy["enabled"],
            "ttl_sec": _reuse_policy["ttl_sec"],
            "entries": len(_reuse_cache),
            "hits": _reuse_stats["hits"],
            "misses": _reuse_stats["misses"],
            "requests_avoided": _reuse_stats["hits"],
            "hit_rate": round(_reuse_stats["hits"] / total, 3) if total else None,
        }


def reset_reuse_cache():
    """Drop every cached download. For tests, and for an explicit user refresh."""
    with _reuse_lock:
        _reuse_cache.clear()
        _reuse_stats.update(hits=0, misses=0, stores=0)


# ── The combined entry point ────────────────────────────────────────────────

def fetch(kind, ticker, producer, *, source=DEFAULT_SOURCE, coalesce_key=None,
          persist=True, stale_ok=True, ttl=None, lock=None, attempts=None):
    """Fetch one thing from Yahoo with every guard rail applied.

    Order of operations: serve a fresh persisted value when ``ttl`` allows one,
    otherwise coalesce concurrent callers onto a single breaker-guarded,
    backoff-retried call, record the result as last-good, and — when the call is
    throttled or the breaker is shut — fall back to the last-good value rather
    than returning a blank.

    Returns ``(payload, meta)``. ``meta`` carries ``stale`` (the payload came
    from cache after a failed fetch), ``cooling_down``/``retry_after_sec``, and
    ``error``, so a caller can tell the user *why* a value is old instead of
    silently showing stale numbers as live ones.
    """
    if ttl:
        cached = recall(kind, ticker, source=source, max_age_sec=ttl)
        if cached is not None:
            return cached, {"stale": False, "cached": True, "cooling_down": False,
                            "retry_after_sec": 0.0, "error": None}

    key = coalesce_key if coalesce_key is not None else (source, kind, str(ticker or "").upper())

    def _run():
        return call(producer, lock=lock, attempts=attempts)

    try:
        payload = coalesce(key, _run)
    except YahooCooldown as exc:
        fallback = recall(kind, ticker, source=source) if stale_ok else None
        return fallback, {"stale": fallback is not None, "cached": False,
                          "cooling_down": True, "retry_after_sec": exc.retry_after,
                          "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - reported back through meta
        fallback = recall(kind, ticker, source=source) if stale_ok else None
        return fallback, {"stale": fallback is not None, "cached": False,
                          "cooling_down": is_cooling_down(),
                          "retry_after_sec": cooldown_remaining(),
                          "error": str(exc)}

    if persist and payload is not None:
        remember(kind, ticker, payload, source=source)
    return payload, {"stale": False, "cached": False, "cooling_down": False,
                     "retry_after_sec": 0.0, "error": None}
