"""Calculate and persist 30-DTE option-skew observations.

The scanner uses three conventional volatility-surface readings:

* put skew: 25-delta put IV minus 50-delta (ATM) put IV;
* call skew: 25-delta call IV minus 50-delta (ATM) call IV; and
* skew: 25-delta put IV minus 25-delta call IV.

Raw readings are expressed in volatility points.  Their displayed ranks are
empirical percentiles versus the ticker's own trailing-year observations.  As
with locally collected IV Rank, the history is built one daily Yahoo snapshot
at a time and prefers the expiration nearest 30 DTE.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta

from config import get_connection
from option_iv_history import calculate_percentile_rank


MIN_SKEW_RANK_OBSERVATIONS = 20
MIN_PROVISIONAL_OBSERVATIONS = 3
SKEW_LOOKBACK_DAYS = 365
TARGET_SKEW_DTE = 30
SKEW_FIELDS = ("put_skew", "call_skew", "skew")


def _num(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _parse_day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _dte_from_expiration(expiration, observed_on: date) -> int | None:
    expiration_day = _parse_day(expiration)
    return (expiration_day - observed_on).days if expiration_day else None


def _closer_to_target_dte(existing_dte, new_dte) -> bool:
    try:
        new_gap = abs(int(new_dte) - TARGET_SKEW_DTE)
    except (TypeError, ValueError):
        return existing_dte is None
    try:
        old_gap = abs(int(existing_dte) - TARGET_SKEW_DTE)
    except (TypeError, ValueError):
        return True
    return new_gap <= old_gap


def _iv_at_delta(legs: list[dict], target_delta: float) -> float | None:
    """Interpolate IV at an absolute delta on one side of the chain."""
    by_delta: dict[float, list[float]] = {}
    for leg in legs or []:
        if not isinstance(leg, dict):
            continue
        delta = _num(leg.get("delta"))
        implied = _num(leg.get("iv"))
        if delta is None or implied is None or not 0.005 <= implied <= 5.0:
            continue
        absolute_delta = abs(delta)
        if not 0.01 <= absolute_delta <= 0.99:
            continue
        by_delta.setdefault(absolute_delta, []).append(implied)
    points = sorted(
        (delta, sum(values) / len(values))
        for delta, values in by_delta.items()
    )
    if not points:
        return None

    lower = max((point for point in points if point[0] <= target_delta), default=None)
    upper = min((point for point in points if point[0] >= target_delta), default=None)
    if lower and upper:
        if abs(upper[0] - lower[0]) <= 1e-12:
            return lower[1]
        weight = (target_delta - lower[0]) / (upper[0] - lower[0])
        return lower[1] + weight * (upper[1] - lower[1])

    nearest = min(points, key=lambda point: abs(point[0] - target_delta))
    # Avoid pretending that a very sparse chain contains a 25- or 50-delta
    # quote when its nearest usable contract is nowhere near that target.
    return nearest[1] if abs(nearest[0] - target_delta) <= 0.10 else None


def calculate_skew_metrics(puts: list[dict], calls: list[dict]) -> dict:
    """Return raw put, call, and put-versus-call skew in volatility points."""
    put_25 = _iv_at_delta(puts, 0.25)
    put_50 = _iv_at_delta(puts, 0.50)
    call_25 = _iv_at_delta(calls, 0.25)
    call_50 = _iv_at_delta(calls, 0.50)

    def difference(left, right):
        if left is None or right is None:
            return None
        return (left - right) * 100.0

    return {
        "put_skew": difference(put_25, put_50),
        "call_skew": difference(call_25, call_50),
        "skew": difference(put_25, call_25),
        "put_25_delta_iv": put_25,
        "put_atm_iv": put_50,
        "call_25_delta_iv": call_25,
        "call_atm_iv": call_50,
    }


def _ensure_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS option_skew_history (
            ticker       TEXT NOT NULL,
            observed_on  DATE NOT NULL,
            expiration   DATE,
            dte          INTEGER,
            put_skew     REAL,
            call_skew    REAL,
            skew         REAL,
            source       TEXT NOT NULL DEFAULT 'yahoo',
            created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, observed_on, source)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_option_skew_history_ticker_date
        ON option_skew_history (ticker, observed_on DESC)
        """
    )


def record_skew_snapshot(
    ticker: str,
    metrics: dict,
    expiration: str | None = None,
    *,
    observed_on: date | None = None,
    source: str = "yahoo",
    min_observations: int = MIN_SKEW_RANK_OBSERVATIONS,
    dte: int | None = None,
) -> dict:
    """Store one daily surface snapshot and return rank metadata per metric."""
    symbol = str(ticker or "").strip().upper()
    values = {field: _num((metrics or {}).get(field)) for field in SKEW_FIELDS}
    day = observed_on or date.today()
    if not symbol or all(value is None for value in values.values()):
        return {
            field: {"rank": None, "provisional_rank": None, "observations": 0, "ready": False}
            for field in SKEW_FIELDS
        }

    stored_dte = None
    try:
        stored_dte = int(dte) if dte is not None else _dte_from_expiration(expiration, day)
    except (TypeError, ValueError):
        stored_dte = _dte_from_expiration(expiration, day)
    cutoff = day - timedelta(days=SKEW_LOOKBACK_DAYS)
    conn = get_connection()
    try:
        _ensure_table(conn)
        existing = conn.execute(
            """
            SELECT dte FROM option_skew_history
            WHERE ticker = ? AND observed_on = ? AND source = ?
            """,
            (symbol, day.isoformat(), source),
        ).fetchone()
        if existing is None or _closer_to_target_dte(existing[0], stored_dte):
            conn.execute(
                """
                INSERT INTO option_skew_history
                    (ticker, observed_on, expiration, dte, put_skew, call_skew, skew, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(ticker, observed_on, source) DO UPDATE SET
                    expiration = excluded.expiration,
                    dte = excluded.dte,
                    put_skew = excluded.put_skew,
                    call_skew = excluded.call_skew,
                    skew = excluded.skew,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    symbol, day.isoformat(), expiration, stored_dte,
                    values["put_skew"], values["call_skew"], values["skew"], source,
                ),
            )
        rows = conn.execute(
            """
            SELECT observed_on, put_skew, call_skew, skew
            FROM option_skew_history
            WHERE ticker = ? AND source = ? AND observed_on >= ?
            ORDER BY observed_on
            """,
            (symbol, source, cutoff.isoformat()),
        ).fetchall()
        conn.commit()
    finally:
        conn.close()

    result = {}
    required = max(2, int(min_observations))
    for index, field in enumerate(SKEW_FIELDS, start=1):
        current = values[field]
        history = [
            _num(row[index])
            for row in rows
            if _parse_day(row[0]) != day and _num(row[index]) is not None
        ]
        observations = len(history) + (1 if current is not None else 0)
        provisional = (
            calculate_percentile_rank(history, current)
            if current is not None and observations >= MIN_PROVISIONAL_OBSERVATIONS
            else None
        )
        ready = observations >= required and provisional is not None
        result[field] = {
            "rank": provisional if ready else None,
            "provisional_rank": provisional,
            "observations": observations,
            "ready": ready,
        }
    return result
