"""Persist daily Yahoo ATM implied-volatility snapshots and calculate IV rank.

Yahoo exposes a current option chain, not a historical IV-rank series.  The app
therefore records one ATM IV observation per ticker and trading day whenever a
scanner prices a chain.  Once enough daily observations exist, IV rank is the
current reading's position between the trailing one-year low and high.

The small module is scanner-agnostic so every option scanner can share the same
history as the compact Samurai-style filters are rolled out.
"""

from __future__ import annotations

from datetime import date, timedelta

from config import get_connection

MIN_IV_RANK_OBSERVATIONS = 20
IV_RANK_LOOKBACK_DAYS = 365


def _ensure_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS option_iv_history (
            ticker       TEXT NOT NULL,
            observed_on  DATE NOT NULL,
            atm_iv       REAL NOT NULL,
            expiration   DATE,
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


def calculate_iv_rank(values: list[float], current_iv: float) -> float | None:
    """Return the current IV's empirical 0-100 percentile rank.

    Option Samurai describes its IV Rank as the percentage of recent readings
    below the current reading (while also labelling it an IV percentile). Ties
    receive their midpoint rank so a flat series remains uninformative.
    """
    clean = [float(value) for value in values if value is not None and float(value) > 0]
    current = float(current_iv or 0)
    if not clean or current <= 0:
        return None
    if max(clean) - min(clean) <= 1e-12:
        return None
    below = sum(1 for value in clean if value < current)
    equal = sum(1 for value in clean if abs(value - current) <= 1e-12)
    percentile = (below + equal / 2.0) / len(clean) * 100.0
    return max(0.0, min(100.0, percentile))


def record_iv_snapshot(
    ticker: str,
    atm_iv: float,
    expiration: str | None = None,
    *,
    observed_on: date | None = None,
    source: str = "yahoo",
    min_observations: int = MIN_IV_RANK_OBSERVATIONS,
) -> dict:
    """Upsert today's ATM IV and return trailing IV-rank metadata.

    One observation per ticker/day prevents repeated scans from overweighting a
    volatile session.  ``rank`` stays ``None`` until ``min_observations`` daily
    samples exist; callers can disclose a temporary proxy while history warms.
    """
    symbol = str(ticker or "").strip().upper()
    value = float(atm_iv or 0)
    day = observed_on or date.today()
    if not symbol or value <= 0:
        return {"rank": None, "observations": 0, "ready": False}

    cutoff = day - timedelta(days=IV_RANK_LOOKBACK_DAYS)
    conn = get_connection()
    try:
        _ensure_table(conn)
        conn.execute(
            """
            INSERT INTO option_iv_history
                (ticker, observed_on, atm_iv, expiration, source)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(ticker, observed_on, source) DO UPDATE SET
                atm_iv = excluded.atm_iv,
                expiration = excluded.expiration,
                updated_at = CURRENT_TIMESTAMP
            """,
            (symbol, day.isoformat(), value, expiration, source),
        )
        rows = conn.execute(
            """
            SELECT atm_iv
            FROM option_iv_history
            WHERE ticker = ? AND source = ? AND observed_on >= ?
            ORDER BY observed_on
            """,
            (symbol, source, cutoff.isoformat()),
        ).fetchall()
        conn.commit()
    finally:
        conn.close()

    values = [float(row[0]) for row in rows if row[0] is not None]
    ready = len(values) >= max(2, int(min_observations))
    rank = calculate_iv_rank(values, value) if ready else None
    return {
        "rank": rank,
        "observations": len(values),
        "ready": ready and rank is not None,
        "low": min(values) if values else None,
        "high": max(values) if values else None,
    }
