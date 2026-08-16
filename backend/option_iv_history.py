"""Persist daily Yahoo ATM implied-volatility snapshots and calculate IV rank.

Yahoo exposes a current option chain, not a historical IV-rank series.  The app
therefore records one ATM IV observation per ticker and trading day whenever a
scanner prices a chain.  Once enough daily observations exist, IV Rank is the
share of *prior* trailing-year prints that sit below today's ATM IV.

The column is labelled IV Rank to match Option Samurai, but the calculation is
a percentile rather than the (current − low) / (high − low) rank formula.
Front-month (about 21–60 DTE) prints are preferred so weekly and LEAP scans do
not mix tenors, and one-day IV spikes are removed before ranking.

The small module is scanner-agnostic so every option scanner can share the same
history as the compact Samurai-style filters are rolled out.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta

from config import get_connection

MIN_IV_RANK_OBSERVATIONS = 20
MIN_PROVISIONAL_IV_RANK_OBSERVATIONS = 3
IV_RANK_LOOKBACK_DAYS = 365
TARGET_IV_DTE = 30
PREFERRED_IV_DTE_MIN = 21
PREFERRED_IV_DTE_MAX = 60
MIN_VALID_IV = 0.03
MAX_VALID_IV = 3.0
MIN_IV_RANGE = 0.005


def _parse_day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _ensure_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS option_iv_history (
            ticker       TEXT NOT NULL,
            observed_on  DATE NOT NULL,
            atm_iv       REAL NOT NULL,
            expiration   DATE,
            dte          INTEGER,
            source       TEXT NOT NULL DEFAULT 'yahoo',
            created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, observed_on, source)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_option_iv_history_ticker_date
        ON option_iv_history (ticker, observed_on DESC)
        """
    )
    columns = {
        str(row[1])
        for row in conn.execute("PRAGMA table_info(option_iv_history)").fetchall()
    }
    if "dte" not in columns:
        conn.execute("ALTER TABLE option_iv_history ADD COLUMN dte INTEGER")


def calculate_percentile_rank(values: list[float], current: float) -> float | None:
    """Return the current value's empirical 0-100 percentile rank.

    Ties receive their midpoint rank so a flat series remains uninformative.
    Negative values are allowed so IV−RV spreads can be ranked the same way.
    """
    clean = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    try:
        current_value = float(current)
    except (TypeError, ValueError):
        return None
    if not clean or not math.isfinite(current_value):
        return None
    if max(clean) - min(clean) <= 1e-12:
        return None
    below = sum(1 for value in clean if value < current_value)
    equal = sum(1 for value in clean if abs(value - current_value) <= 1e-12)
    percentile = (below + equal / 2.0) / len(clean) * 100.0
    return max(0.0, min(100.0, percentile))


def _valid_iv(value) -> float | None:
    try:
        implied = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(implied) or implied < MIN_VALID_IV or implied > MAX_VALID_IV:
        return None
    return implied


def _dte_from_expiration(expiration, observed_on: date) -> int | None:
    exp = _parse_day(expiration)
    if exp is None:
        return None
    return (exp - observed_on).days


def _preferred_tenor(dte) -> bool:
    try:
        days = int(dte)
    except (TypeError, ValueError):
        return False
    return PREFERRED_IV_DTE_MIN <= days <= PREFERRED_IV_DTE_MAX


def _closer_to_target_dte(existing_dte, new_dte) -> bool:
    """True when the new print is a better (or equal) 30-day ATM proxy."""
    try:
        new_gap = abs(int(new_dte) - TARGET_IV_DTE)
    except (TypeError, ValueError):
        return existing_dte is None
    try:
        old_gap = abs(int(existing_dte) - TARGET_IV_DTE)
    except (TypeError, ValueError):
        return True
    return new_gap <= old_gap


def _core_iv_sample(history: list[float]) -> list[float]:
    """Drop one-day Yahoo spikes that would otherwise dominate the sample.

    A single 80% print in an otherwise 20–22% name should not define the top of
    the year.  Readings more than about five median absolute deviations from the
    median are ignored when enough observations remain.
    """
    if len(history) < 10:
        return history
    ordered = sorted(history)
    median = ordered[len(ordered) // 2]
    mad = sorted(abs(value - median) for value in history)[len(history) // 2]
    if mad < 1e-6:
        return history
    width = 5.0 * 1.4826 * mad
    core = [value for value in history if abs(value - median) <= width]
    return core if len(core) >= 8 else history


def calculate_iv_rank(values: list[float], current_iv: float) -> float | None:
    """Return the current IV's 0-100 percentile versus prior readings.

    The column is labelled IV Rank, but the calculation is IV Percentile: the
    share of the prior lookback sample that printed *below* today's ATM IV.
    ``values`` should be prior observations, not today's print, so a new high is
    100 and a new low is 0.  Midpoint-of-ties is not used — a name sitting at
    the same print for many days should not drift toward 50.
    """
    current = _valid_iv(current_iv)
    history = _core_iv_sample([
        implied for implied in (_valid_iv(value) for value in values) if implied is not None
    ])
    if current is None or not history:
        return None
    low = min(min(history), current)
    high = max(max(history), current)
    if high - low < max(MIN_IV_RANGE, 0.03 * current):
        return None
    below = sum(1 for implied in history if implied < current)
    return max(0.0, min(100.0, below / len(history) * 100.0))


def calculate_iv_rv(atm_iv: float, rv: float) -> float | None:
    """Return IV minus one-month RV in volatility points.

    A positive value means implied vol is richer than recent realized vol
    (options look expensive versus the past month). Both inputs are decimals
    such as 0.22 for 22%.
    """
    try:
        implied = float(atm_iv)
        realized = float(rv)
    except (TypeError, ValueError):
        return None
    if implied <= 0 or realized <= 0 or not math.isfinite(implied) or not math.isfinite(realized):
        return None
    return (implied - realized) * 100.0


def record_iv_snapshot(
    ticker: str,
    atm_iv: float,
    expiration: str | None = None,
    *,
    observed_on: date | None = None,
    source: str = "yahoo",
    min_observations: int = MIN_IV_RANK_OBSERVATIONS,
    dte: int | None = None,
) -> dict:
    """Upsert today's ATM IV and return trailing IV-rank metadata.

    One observation per ticker/day prevents repeated scans from overweighting a
    volatile session.  A later same-day scan only replaces the stored print when
    its expiration is closer to 30 DTE, so weekly and LEAP scans do not overwrite
    a front-month ATM reading.  ``rank`` stays ``None`` until
    ``min_observations`` daily samples exist; callers can disclose a temporary
    proxy while history warms.
    """
    symbol = str(ticker or "").strip().upper()
    value = _valid_iv(atm_iv)
    day = observed_on or date.today()
    if not symbol or value is None:
        return {
            "rank": None, "provisional_rank": None,
            "observations": 0, "ready": False,
        }

    stored_dte = None
    try:
        stored_dte = int(dte) if dte is not None else _dte_from_expiration(expiration, day)
    except (TypeError, ValueError):
        stored_dte = _dte_from_expiration(expiration, day)
    cutoff = day - timedelta(days=IV_RANK_LOOKBACK_DAYS)
    conn = get_connection()
    try:
        _ensure_table(conn)
        existing = conn.execute(
            """
            SELECT atm_iv, dte
            FROM option_iv_history
            WHERE ticker = ? AND observed_on = ? AND source = ?
            """,
            (symbol, day.isoformat(), source),
        ).fetchone()
        replace = existing is None or _closer_to_target_dte(
            existing[1] if existing is not None else None,
            stored_dte,
        )
        if replace:
            conn.execute(
                """
                INSERT INTO option_iv_history
                    (ticker, observed_on, atm_iv, expiration, source, dte)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(ticker, observed_on, source) DO UPDATE SET
                    atm_iv = excluded.atm_iv,
                    expiration = excluded.expiration,
                    dte = excluded.dte,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (symbol, day.isoformat(), value, expiration, source, stored_dte),
            )
        rows = conn.execute(
            """
            SELECT observed_on, atm_iv, dte
            FROM option_iv_history
            WHERE ticker = ? AND source = ? AND observed_on >= ?
            ORDER BY observed_on
            """,
            (symbol, source, cutoff.isoformat()),
        ).fetchall()
        conn.commit()
    finally:
        conn.close()

    samples = []
    for row in rows:
        implied = _valid_iv(row[1])
        observed = _parse_day(row[0])
        if implied is None or observed is None:
            continue
        samples.append({"observed_on": observed, "atm_iv": implied, "dte": row[2]})
    prior = [item for item in samples if item["observed_on"] != day]
    preferred = [item["atm_iv"] for item in prior if _preferred_tenor(item["dte"])]
    history = preferred if len(preferred) >= max(2, int(min_observations)) else [
        item["atm_iv"] for item in prior
    ]
    ready = len(samples) >= max(2, int(min_observations)) and len(history) >= 2
    provisional_rank = (
        calculate_iv_rank(history, value)
        if len(samples) >= MIN_PROVISIONAL_IV_RANK_OBSERVATIONS and len(history) >= 2
        else None
    )
    rank = provisional_rank if ready else None
    values = [item["atm_iv"] for item in samples]
    return {
        "rank": rank,
        "provisional_rank": provisional_rank,
        "observations": len(samples),
        "ready": ready and rank is not None,
        "low": min(values) if values else None,
        "high": max(values) if values else None,
    }


def fetch_iv_observations(
    ticker: str,
    *,
    observed_on: date | None = None,
    source: str = "yahoo",
) -> list[dict]:
    """Return trailing daily ATM IV snapshots for pairing with realized vol."""
    symbol = str(ticker or "").strip().upper()
    if not symbol:
        return []
    day = observed_on or date.today()
    cutoff = day - timedelta(days=IV_RANK_LOOKBACK_DAYS)
    conn = get_connection()
    try:
        _ensure_table(conn)
        rows = conn.execute(
            """
            SELECT observed_on, atm_iv
            FROM option_iv_history
            WHERE ticker = ? AND source = ? AND observed_on >= ?
            ORDER BY observed_on
            """,
            (symbol, source, cutoff.isoformat()),
        ).fetchall()
    finally:
        conn.close()

    observations = []
    for row in rows:
        observed = _parse_day(row[0])
        try:
            atm_iv = float(row[1])
        except (TypeError, ValueError):
            continue
        if observed is None or atm_iv <= 0 or not math.isfinite(atm_iv):
            continue
        observations.append({"observed_on": observed, "atm_iv": atm_iv})
    return observations
