"""Road Trip unbalanced butterfly scanner.

Sources: John A. Sarkett, "A Road Trip With Options Supertraders," Technical
Analysis of Stocks & Commodities V.35:02 (22-27), describing Dan Harvey and Tom
Nunamaker's road trip trade (RTT), plus the Options Trading IQ write-up of the
same model.

One position is a same-expiration 1/-2/+1 broken-wing put butterfly:

    BUY  1 upper long put    placed BEHIND the market (below spot)
    SELL 2 body puts
    BUY  1 lower long put    on a wider wing than the upper one

The article's SPX example with the index at 2000 is 1975/1930/1875: the upper
long sits 1.25% below spot, the upper wing is 45 points and the lower wing 55.
That geometry, not a delta ladder, is what the article specifies, so this
scanner selects on percentage placement and reports the deltas it lands on.

What separates this screen from the long-dated STT butterfly next door:

  * Entry is a DEBIT, and the governing price rule is that the debit must be
    under 5% of the initial margin (the article's own arithmetic is
    487 / 12,732 = 3.8%). A cheap entry is what leaves room for the upside
    adjustment to lift the T+0 line later.
  * The upper expiration line is therefore a real loss, not a retained credit.
  * 70-85 DTE on any listed expiration. The pair trades SPX/ES weeklies, so
    unlike the STT screens this one does not restrict to standard monthlies.
  * Management is scheduled, not discretionary: leave it alone for the first
    21-30 days, exit 15-20 days before expiration, target 7-15% on capital at
    risk, and cut the trade if the loss passes 4-5% of utilized capital.

Endpoints:
  GET  /api/options/road-trip-butterfly-scan/defaults
  POST /api/options/road-trip-butterfly-scan
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
import math
import re

import numpy as np
import yfinance as yf
from flask import jsonify, request

from put_scanner import (
    MAX_TARGET_DTE,
    MIN_TARGET_DTE,
    _clean_tickers,
    _fetch_fundamentals_bulk,
    _load_history,
    _load_put_chain,
    _num,
    _round,
    _ticker_frame,
    dividend_yield_for_pricing,
)
from unbalanced_butterfly_scanner import (
    _build_butterfly,
    _distance_to_range,
    _is_standard_monthly,
    _modeled_butterfly_pl,
    _prepare_scan_leg,
    _round_candidate,
)
from unbalanced_put_condor_scanner import (
    CONTRACT_MULTIPLIER,
    EARLY_CLOSE_FRACTIONS,
    _elapsed_days_for_fraction,
)


# The article's SPX 2000 -> 1975/1930/1875 example, expressed as percentages of
# spot so the same shape can be placed on any underlying.
ARTICLE_UPPER_OFFSET_PCT = 1.25
ARTICLE_UPPER_WING_PCT = 2.25
ARTICLE_LOWER_WING_PCT = 2.75
BASE_QUANTITY = 5

# Net delta per single butterfly, in share equivalents. Unlike the STT ladder,
# an RTT butterfly is not algebraically delta-balanced by its strike choice, so
# these bands are wider and are scaled by contract count rather than by a ratio
# to some base size.
BIAS_RANGES = {
    "bearish": (-24.0, -8.0),
    "neutral": (-8.0, 8.0),
    "bullish": (8.0, 24.0),
}

DEFAULT_TICKERS = ["SPY", "QQQ", "IWM"]
DEFAULTS = {
    "tickers": ",".join(DEFAULT_TICKERS),
    "market_bias": "neutral",
    # "They choose expirations 70 to 85 days out."
    "target_dte": 77,
    "min_dte": 70,
    "max_dte": 85,
    # "Size is typically 5x10x5 or 6x12x6 contracts."
    "tranche_quantity": BASE_QUANTITY,
    "upper_offset_pct": ARTICLE_UPPER_OFFSET_PCT,
    "offset_tolerance_pct": 0.75,
    "upper_wing_pct": ARTICLE_UPPER_WING_PCT,
    "lower_wing_pct": ARTICLE_LOWER_WING_PCT,
    "wing_tolerance_pct": 1.0,
    "min_lower_wing_ratio": 1.05,
    # "The entry debit must be less than 5% of the initial margin."
    "max_debit_to_margin_pct": 5.0,
    "min_theta_dollars": 1.0,
    # "earn 7% to 15% per trade" / "exit ... if the loss exceeds 4% to 5%".
    "profit_target_low_pct": 7.0,
    "profit_target_high_pct": 15.0,
    "max_loss_pct": 5.0,
    # "They plan ahead to exit 15 to 20 days before expiration."
    "exit_days_before_expiration": 17,
    # "in the first 21 to 30 days ... leave it alone and let theta do its job."
    "hands_off_days": 25,
    "downside_hedge_width_pct": 0.5,
    "require_favorable_entry_timing": False,
    "min_open_interest": 0,
    # "They add a new RTT position every two weeks and typically have four or
    # five on at a time."
    "open_positions": 0,
    "max_concurrent_positions": 5,
    "entry_interval_days": 14,
    "days_since_last_entry": 14,
    "max_results": 100,
}


def _ticker_list(raw) -> list[str]:
    if isinstance(raw, str):
        raw = re.split(r"[\s,;]+", raw)
    return _clean_tickers(raw)[:20]


def _bias_name(value) -> str:
    normalized = str(value or "neutral").strip().lower()
    if normalized not in BIAS_RANGES:
        raise ValueError("market_bias must be bearish, neutral, or bullish")
    return normalized


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _clamp(value, default, low, high):
    return min(high, max(low, _num(value, default) or default))


def _expirations_in_window(
    expirations: list[str],
    target_dte: int,
    min_dte: int,
    max_dte: int,
) -> list[tuple[str, int, bool]]:
    """Every listed expiration in range, nearest the requested DTE first.

    The road trip trade runs on SPX and ES weeklies, so weekly expirations are
    eligible here. The monthly flag is carried through only as a liquidity note.
    """
    today = date.today()
    choices = []
    for expiration in expirations:
        try:
            expiration_date = datetime.strptime(expiration, "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        dte = (expiration_date - today).days
        if min_dte <= dte <= max_dte:
            choices.append((expiration, dte, _is_standard_monthly(expiration)))
    choices.sort(key=lambda choice: (
        abs(choice[1] - target_dte),
        choice[1],
        choice[0],
    ))
    return choices


def _entry_timing(frame) -> dict:
    """Whether today looks like the article's preferred entry session.

    "The timing of the entry is not critical, but the pair prefers a down day
    when volatility is up." Implied-vol history is not available from the price
    feed, so elevation is measured on realized volatility, which is honest
    about what it is: a 20-day realized reading and its own one-year percentile.
    """
    empty = {
        "session_change_pct": None,
        "realized_vol_20d_pct": None,
        "realized_vol_60d_pct": None,
        "realized_vol_percentile": None,
    }
    if frame is None:
        return empty
    closes = frame["Close"].dropna()
    if len(closes) < 30:
        return empty

    log_returns = np.diff(np.log(closes.to_numpy(dtype=float)))
    if len(log_returns) < 25:
        return empty

    annualize = math.sqrt(252.0) * 100.0
    realized_20 = float(np.std(log_returns[-20:], ddof=1)) * annualize
    realized_60 = (
        float(np.std(log_returns[-60:], ddof=1)) * annualize
        if len(log_returns) >= 60 else None
    )

    # Percentile of the current 20-day reading against every other 20-day
    # window in the loaded year of history.
    history = [
        float(np.std(log_returns[index - 20:index], ddof=1)) * annualize
        for index in range(20, len(log_returns) + 1)
    ]
    percentile = None
    if len(history) >= 30:
        percentile = 100.0 * sum(
            1 for value in history if value <= realized_20
        ) / len(history)

    return {
        "session_change_pct": float(
            closes.iloc[-1] / closes.iloc[-2] - 1.0
        ) * 100.0,
        "realized_vol_20d_pct": realized_20,
        "realized_vol_60d_pct": realized_60,
        "realized_vol_percentile": percentile,
    }


def _timing_status(timing: dict, body_iv: float | None) -> dict:
    """Grade the session against the article's stated entry preference."""
    change = timing.get("session_change_pct")
    realized = timing.get("realized_vol_20d_pct")
    percentile = timing.get("realized_vol_percentile")

    iv_vs_realized = None
    if body_iv and body_iv > 0 and realized and realized > 0:
        iv_vs_realized = (body_iv * 100.0) / realized

    down_day = change is not None and change < 0
    # "Volatility is up" has to mean up against this underlying's own recent
    # history. A rich IV-over-realized ratio does not qualify on its own: the
    # variance risk premium keeps that ratio above 1 almost all the time, so
    # treating it as sufficient grades a one-year volatility low as favorable.
    # It stays reported as context and confirmation.
    vol_elevated = percentile is not None and percentile >= 50.0

    if down_day and vol_elevated:
        status = "favorable"
    elif down_day or vol_elevated:
        status = "acceptable"
    else:
        status = "unfavorable"

    return {
        **timing,
        "iv_vs_realized_ratio": iv_vs_realized,
        "entry_is_down_day": down_day,
        "entry_vol_elevated": vol_elevated,
        "entry_timing_status": status,
    }


def _coarse_strike_fit(legs: list[dict], strikes: list[float]) -> int | None:
    """How many legs land on the chain's coarse strike grid.

    Harvey prefers legs on quarter strikes for liquidity. Rather than assume a
    25-point SPX ladder, derive the grid from the chain: take the modal strike
    spacing and treat every fifth increment as a coarse strike.
    """
    unique = sorted({float(value) for value in strikes if value and value > 0})
    if len(unique) < 6:
        return None
    gaps = [
        round(unique[index + 1] - unique[index], 4)
        for index in range(len(unique) - 1)
    ]
    gaps = [gap for gap in gaps if gap > 0]
    if not gaps:
        return None
    spacing = max(set(gaps), key=gaps.count)
    coarse = spacing * 5.0
    if coarse <= 0:
        return None
    return sum(
        1 for leg in legs
        if abs((float(leg["strike"]) / coarse) - round(float(leg["strike"]) / coarse)) < 1e-6
    )


def _management_exit_points(
    dte: int,
) -> list[dict]:
    """Model the preferred close window halfway to two-thirds through.

    The hands-off date and the article's 15-20 DTE exit remain management
    guardrails, but neither is the right headline horizon for probability of a
    profitable close. The time-value curve is intentionally broad during this
    earlier window, matching the neighboring unbalanced-butterfly scanner.
    """
    labels = ("Halfway close", "Two-thirds close")
    points = []
    for label, fraction in zip(labels, EARLY_CLOSE_FRACTIONS):
        elapsed_days = _elapsed_days_for_fraction(dte, fraction)
        if elapsed_days is None:
            continue
        points.append({
            "kind": "planned_exit",
            "label": label,
            "remaining_dte": dte - elapsed_days,
        })
    return points


def _nearest_leg(legs: list[dict], strike: float) -> dict | None:
    usable = [leg for leg in legs if _num(leg.get("mid")) is not None]
    if not usable:
        return None
    return min(usable, key=lambda leg: abs(float(leg["strike"]) - strike))


def _reverse_harvey_roll(
    candidate: dict,
    *,
    legs: list[dict],
    quantity: int,
) -> dict:
    """Price one step of the article's upside adjustment.

    "The long wings are rolled in toward the short strike in order to generate
    a credit, and lift the T+0 curve to the right of the tent." The credit
    generator is the upper wing: sell the current upper long and buy the next
    strike down toward the body. Rolling the lower long up instead cuts margin
    but costs a debit, so only the upper roll is priced here.
    """
    blank = {
        "reverse_harvey_roll_strike": None,
        "reverse_harvey_credit_dollars": None,
        "reverse_harvey_upper_flat_dollars": None,
        "reverse_harvey_upper_width": None,
        "reverse_harvey_clears_upper_line": None,
    }
    upper_strike = _num(candidate.get("upper_long_strike"))
    body_strike = _num(candidate.get("body_short_strike"))
    upper_mid = _num((candidate.get("upper_long_leg") or {}).get("mid"))
    if upper_strike is None or body_strike is None or upper_mid is None:
        return blank

    inner = [
        leg for leg in legs
        if body_strike < float(leg["strike"]) < upper_strike
        and _num(leg.get("mid")) is not None
    ]
    if not inner:
        return blank

    roll_to = max(inner, key=lambda leg: float(leg["strike"]))
    roll_mid = _num(roll_to.get("mid"))
    if roll_mid is None:
        return blank

    credit_dollars = (upper_mid - roll_mid) * quantity * CONTRACT_MULTIPLIER
    new_upper_flat = (
        _num(candidate.get("upper_flat_dollars"), 0.0) or 0.0
    ) + credit_dollars
    return {
        "reverse_harvey_roll_strike": float(roll_to["strike"]),
        "reverse_harvey_credit_dollars": credit_dollars,
        "reverse_harvey_upper_flat_dollars": new_upper_flat,
        "reverse_harvey_upper_width": float(roll_to["strike"]) - body_strike,
        "reverse_harvey_clears_upper_line": new_upper_flat >= 0,
    }


def _downside_hedge(
    candidate: dict,
    *,
    legs: list[dict],
    spot: float,
    width_pct: float,
) -> dict:
    """Price the pre-entered downside adjustment.

    "A large down move will typically cause the pair to add a long put debit
    spread ... entered in advance as a GTC conditional order at the SPX price
    point near the short strike where the risk curve starts to turn back down
    from its high point." That turning point is the body strike. A long put
    debit spread buys the higher strike and sells one below it, which is what
    flattens delta as price falls into the tent.
    """
    blank = {
        "downside_hedge_trigger_price": None,
        "downside_hedge_long_strike": None,
        "downside_hedge_short_strike": None,
        "downside_hedge_debit_dollars": None,
        "downside_hedge_close_low_dollars": None,
        "downside_hedge_close_high_dollars": None,
    }
    body_strike = _num(candidate.get("body_short_strike"))
    if body_strike is None or spot <= 0:
        return blank

    width = max(0.01, spot * width_pct / 100.0)
    long_leg = _nearest_leg(legs, body_strike)
    short_leg = _nearest_leg(
        [leg for leg in legs if float(leg["strike"]) < body_strike],
        body_strike - width,
    )
    if long_leg is None or short_leg is None:
        return {**blank, "downside_hedge_trigger_price": body_strike}
    if float(short_leg["strike"]) >= float(long_leg["strike"]):
        return {**blank, "downside_hedge_trigger_price": body_strike}

    debit = _num(long_leg.get("mid"), 0.0) - _num(short_leg.get("mid"), 0.0)
    debit_dollars = debit * CONTRACT_MULTIPLIER
    return {
        "downside_hedge_trigger_price": body_strike,
        "downside_hedge_long_strike": float(long_leg["strike"]),
        "downside_hedge_short_strike": float(short_leg["strike"]),
        "downside_hedge_debit_dollars": debit_dollars,
        # "taking off a put debit spread if the price falls to 50% to 75% of
        # the debit paid."
        "downside_hedge_close_low_dollars": debit_dollars * 0.50,
        "downside_hedge_close_high_dollars": debit_dollars * 0.75,
    }


def _enrich_candidate(
    candidate: dict,
    *,
    legs: list[dict],
    upper_long: dict,
    body_short: dict,
    lower_long: dict,
    spot: float,
    dte: int,
    quantity: int,
    dividend_yield: float,
    expiration_date: date,
    exit_days_before_expiration: int,
    hands_off_days: int,
    profit_target_low_pct: float,
    profit_target_high_pct: float,
    max_loss_pct: float,
    downside_hedge_width_pct: float,
    upper_offset_pct: float,
    upper_wing_pct: float,
    lower_wing_pct: float,
) -> dict:
    debit_dollars = _num(candidate.get("entry_debit_dollars"), 0.0) or 0.0
    margin_dollars = _num(candidate.get("max_loss_dollars"), 0.0) or 0.0
    # The article's initial margin is the downside risk of the broken wing:
    # (lower wing - upper wing) x 100 x contracts, plus the debit paid.
    debit_to_margin_pct = (
        debit_dollars / margin_dollars * 100.0 if margin_dollars > 0 else None
    )

    actual_upper_offset = (spot - candidate["upper_long_strike"]) / spot * 100.0
    actual_upper_wing = candidate["upper_width"] / spot * 100.0
    actual_lower_wing = candidate["lower_width"] / spot * 100.0

    # Price the preferred halfway-to-two-thirds close window as well as the
    # article's 15-20 DTE backstop. The probability cards lead with the former;
    # the latter remains visible as the latest planned exit.
    planned_exit_dte = max(0, min(int(dte) - 1, exit_days_before_expiration))
    halfway_elapsed = _elapsed_days_for_fraction(dte, EARLY_CLOSE_FRACTIONS[0])
    two_thirds_elapsed = _elapsed_days_for_fraction(
        dte,
        EARLY_CLOSE_FRACTIONS[1],
    )
    halfway_close_dte = int(dte) - int(halfway_elapsed or 0)
    two_thirds_close_dte = int(dte) - int(two_thirds_elapsed or 0)
    exit_marks = {}
    for prefix, remaining_dte in (
        ("halfway_close", halfway_close_dte),
        ("two_thirds_close", two_thirds_close_dte),
        ("planned_exit", planned_exit_dte),
    ):
        for label, exit_spot in (
            ("unchanged", spot),
            ("body_peak", candidate["body_short_strike"]),
            ("upper_long", candidate["upper_long_strike"]),
        ):
            modeled = _modeled_butterfly_pl(
                exit_spot=exit_spot,
                remaining_dte=remaining_dte,
                entry_credit=candidate["entry_credit"],
                upper_long=upper_long,
                body_short=body_short,
                lower_long=lower_long,
                quantity=quantity,
                dividend_yield=dividend_yield,
            )
            exit_marks[f"{prefix}_{label}_pl_dollars"] = (
                modeled * CONTRACT_MULTIPLIER if modeled is not None else None
            )

    unchanged_exit = exit_marks.get("planned_exit_unchanged_pl_dollars")
    two_thirds_unchanged = exit_marks.get(
        "two_thirds_close_unchanged_pl_dollars"
    )
    candidate.update(exit_marks)
    candidate.update(_reverse_harvey_roll(
        candidate,
        legs=legs,
        quantity=quantity,
    ))
    candidate.update(_downside_hedge(
        candidate,
        legs=legs,
        spot=spot,
        width_pct=downside_hedge_width_pct,
    ))
    candidate.update({
        "debit_to_margin_pct": debit_to_margin_pct,
        "initial_margin_dollars": margin_dollars,
        "target_upper_offset_pct": upper_offset_pct,
        "actual_upper_offset_pct": actual_upper_offset,
        "upper_offset_error_pct": abs(actual_upper_offset - upper_offset_pct),
        "target_upper_wing_pct": upper_wing_pct,
        "actual_upper_wing_pct": actual_upper_wing,
        "target_lower_wing_pct": lower_wing_pct,
        "actual_lower_wing_pct": actual_lower_wing,
        "wing_error_pct": (
            abs(actual_upper_wing - upper_wing_pct)
            + abs(actual_lower_wing - lower_wing_pct)
        ),
        "behind_the_market": candidate["upper_long_strike"] < spot,
        "planned_exit_dte": planned_exit_dte,
        "planned_exit_date": (
            expiration_date - timedelta(days=planned_exit_dte)
        ).isoformat(),
        "planned_hold_days": int(dte) - planned_exit_dte,
        "close_window_start_dte": halfway_close_dte,
        "close_window_end_dte": two_thirds_close_dte,
        "close_window_start_date": (
            expiration_date - timedelta(days=halfway_close_dte)
        ).isoformat(),
        "close_window_end_date": (
            expiration_date - timedelta(days=two_thirds_close_dte)
        ).isoformat(),
        "hands_off_days": hands_off_days,
        "hands_off_until_date": (
            date.today() + timedelta(days=hands_off_days)
        ).isoformat(),
        "planned_exit_unchanged_return_pct": (
            unchanged_exit / margin_dollars * 100.0
            if unchanged_exit is not None and margin_dollars > 0 else None
        ),
        "two_thirds_close_unchanged_return_pct": (
            two_thirds_unchanged / margin_dollars * 100.0
            if two_thirds_unchanged is not None and margin_dollars > 0 else None
        ),
        "profit_target_low_dollars": margin_dollars * profit_target_low_pct / 100.0,
        "profit_target_high_dollars": margin_dollars * profit_target_high_pct / 100.0,
        "stop_loss_dollars": margin_dollars * max_loss_pct / 100.0,
        "profit_target_low_pct": profit_target_low_pct,
        "profit_target_high_pct": profit_target_high_pct,
        "max_loss_pct": max_loss_pct,
        "coarse_strike_legs": _coarse_strike_fit(
            [upper_long, body_short, lower_long],
            [leg["strike"] for leg in legs],
        ),
    })
    return candidate


def _candidate_quality(
    candidate: dict,
    *,
    bias_low: float,
    bias_high: float,
    max_debit_to_margin_pct: float,
    min_theta_dollars: float,
) -> tuple:
    debit_ratio = candidate.get("debit_to_margin_pct")
    theta = candidate.get("theta_dollars_per_day")
    return (
        # The 5% price rule is the article's own gate, so its miss sorts first.
        (
            max(0.0, debit_ratio - max_debit_to_margin_pct)
            if debit_ratio is not None else math.inf
        ),
        _distance_to_range(
            candidate.get("position_delta"),
            bias_low,
            bias_high,
        ),
        max(0.0, min_theta_dollars - theta) if theta is not None else math.inf,
        # Geometry decides among everything that clears those gates. The debit
        # rule is a ceiling, not a quantity to minimize: ranking on cheapness
        # first walks the search to the narrowest near-the-money wings the
        # tolerances allow, which is a different trade from the one specified.
        candidate.get("upper_offset_error_pct", math.inf)
        + candidate.get("wing_error_pct", math.inf),
        # Only as a tiebreak does a cheaper entry win, because it leaves more
        # room for the reverse Harvey to lift the upside later.
        debit_ratio if debit_ratio is not None else math.inf,
        candidate.get("execution_cost_dollars") or math.inf,
        -(candidate.get("open_interest_min") or 0),
    )


def _candidates(
    puts: list[dict],
    *,
    spot: float,
    expiration: str,
    expiration_date: date,
    dte: int,
    quantity: int,
    upper_offset_pct: float,
    offset_tolerance_pct: float,
    upper_wing_pct: float,
    lower_wing_pct: float,
    wing_tolerance_pct: float,
    min_lower_wing_ratio: float,
    dividend_yield: float,
    bias_low: float,
    bias_high: float,
    max_debit_to_margin_pct: float,
    min_theta_dollars: float,
    exit_days_before_expiration: int,
    hands_off_days: int,
    profit_target_low_pct: float,
    profit_target_high_pct: float,
    max_loss_pct: float,
    downside_hedge_width_pct: float,
) -> list[dict]:
    legs = []
    for leg in puts:
        prepared = _prepare_scan_leg(
            leg,
            spot=spot,
            dte=dte,
            dividend_yield=dividend_yield,
        )
        if (
            prepared is not None
            and prepared.get("delta") is not None
            and 0 < prepared["strike"] < spot
            and _num(prepared.get("iv"), 0.0) > 0
        ):
            legs.append(prepared)
    if len(legs) < 3:
        return []

    has_estimated_leg = any(
        leg.get("quote_source") == "last_trade" for leg in legs
    )
    upper_limit = 4 if has_estimated_leg else 8
    body_limit = 6 if has_estimated_leg else 12
    lower_limit = 8 if has_estimated_leg else 18

    def offset_pct(leg) -> float:
        return (spot - float(leg["strike"])) / spot * 100.0

    # "The traders start the trade with a broken wing butterfly with the
    # highest strike placed behind the market." Every upper long here is
    # already below spot; the tolerance decides how far behind.
    upper_longs = sorted(
        [
            leg for leg in legs
            if abs(offset_pct(leg) - upper_offset_pct) <= offset_tolerance_pct
        ],
        key=lambda leg: abs(offset_pct(leg) - upper_offset_pct),
    )[:upper_limit]

    candidates = []
    seen = set()
    for upper_long in upper_longs:
        upper_strike = float(upper_long["strike"])
        body_shorts = sorted(
            [
                leg for leg in legs
                if float(leg["strike"]) < upper_strike
                and abs(
                    (upper_strike - float(leg["strike"])) / spot * 100.0
                    - upper_wing_pct
                ) <= wing_tolerance_pct
            ],
            key=lambda leg: abs(
                (upper_strike - float(leg["strike"])) / spot * 100.0
                - upper_wing_pct
            ),
        )[:body_limit]
        for body_short in body_shorts:
            body_strike = float(body_short["strike"])
            upper_width = upper_strike - body_strike
            lower_longs = sorted(
                [
                    leg for leg in legs
                    if float(leg["strike"]) < body_strike
                    and body_strike - float(leg["strike"])
                    >= upper_width * min_lower_wing_ratio
                    and abs(
                        (body_strike - float(leg["strike"])) / spot * 100.0
                        - lower_wing_pct
                    ) <= wing_tolerance_pct
                ],
                key=lambda leg: (
                    abs(
                        (body_strike - float(leg["strike"])) / spot * 100.0
                        - lower_wing_pct
                    ),
                    _distance_to_range(
                        quantity * (
                            upper_long["delta"]
                            - 2.0 * body_short["delta"]
                            + leg["delta"]
                        ) * CONTRACT_MULTIPLIER,
                        bias_low,
                        bias_high,
                    ),
                ),
            )[:lower_limit]
            for lower_long in lower_longs:
                key = (upper_strike, body_strike, float(lower_long["strike"]))
                if key in seen:
                    continue
                seen.add(key)
                candidate = _build_butterfly(
                    upper_long,
                    body_short,
                    lower_long,
                    spot=spot,
                    expiration=expiration,
                    dte=dte,
                    upper_long_target=abs(_num(upper_long.get("delta"), 0.0) or 0.0),
                    tranche_quantity=quantity,
                    lower_long_target=abs(_num(lower_long.get("delta"), 0.0) or 0.0),
                    body_short_target=abs(_num(body_short.get("delta"), 0.0) or 0.0),
                    structure_kind="road-trip-butterfly",
                    dividend_yield=dividend_yield,
                    # After the hands-off period, a rally above the upper long
                    # is managed with successive reverse-Harvey rolls until the
                    # right side is flat or slightly profitable. Count that
                    # prescribed managed outcome as success, while the shared
                    # probability result also retains the unattended P/L odds.
                    always_success_above_upper=True,
                    exit_points=_management_exit_points(int(dte)),
                )
                if not candidate:
                    continue
                # A credit entry is a different trade from the one the article
                # describes and breaks its 5%-of-margin price rule outright.
                if candidate["entry_credit"] >= 0:
                    continue
                candidates.append(_enrich_candidate(
                    candidate,
                    legs=legs,
                    upper_long=upper_long,
                    body_short=body_short,
                    lower_long=lower_long,
                    spot=spot,
                    dte=dte,
                    quantity=quantity,
                    dividend_yield=dividend_yield,
                    expiration_date=expiration_date,
                    exit_days_before_expiration=exit_days_before_expiration,
                    hands_off_days=hands_off_days,
                    profit_target_low_pct=profit_target_low_pct,
                    profit_target_high_pct=profit_target_high_pct,
                    max_loss_pct=max_loss_pct,
                    downside_hedge_width_pct=downside_hedge_width_pct,
                    upper_offset_pct=upper_offset_pct,
                    upper_wing_pct=upper_wing_pct,
                    lower_wing_pct=lower_wing_pct,
                ))

    candidates.sort(key=lambda candidate: _candidate_quality(
        candidate,
        bias_low=bias_low,
        bias_high=bias_high,
        max_debit_to_margin_pct=max_debit_to_margin_pct,
        min_theta_dollars=min_theta_dollars,
    ))
    return candidates


def _choose_candidate(
    candidates: list[dict],
    *,
    bias_low: float,
    bias_high: float,
    max_debit_to_margin_pct: float,
    min_theta_dollars: float,
    min_open_interest: int,
) -> dict | None:
    if not candidates:
        return None
    passing = [
        candidate for candidate in candidates
        if (
            candidate.get("debit_to_margin_pct") is not None
            and candidate["debit_to_margin_pct"] <= max_debit_to_margin_pct
            and bias_low <= candidate["position_delta"] <= bias_high
            and candidate.get("theta_dollars_per_day") is not None
            and candidate["theta_dollars_per_day"] >= min_theta_dollars
            and candidate["open_interest_min"] >= min_open_interest
            and candidate["behind_the_market"]
        )
    ]
    return min(
        passing or candidates,
        key=lambda candidate: _candidate_quality(
            candidate,
            bias_low=bias_low,
            bias_high=bias_high,
            max_debit_to_margin_pct=max_debit_to_margin_pct,
            min_theta_dollars=min_theta_dollars,
        ),
    )


def _round_rtt_candidate(candidate: dict) -> dict:
    out = _round_candidate(candidate)
    for key, decimals in (
        ("debit_to_margin_pct", 2),
        ("initial_margin_dollars", 0),
        ("target_upper_offset_pct", 2),
        ("actual_upper_offset_pct", 2),
        ("upper_offset_error_pct", 2),
        ("target_upper_wing_pct", 2),
        ("actual_upper_wing_pct", 2),
        ("target_lower_wing_pct", 2),
        ("actual_lower_wing_pct", 2),
        ("wing_error_pct", 2),
        ("planned_exit_unchanged_pl_dollars", 0),
        ("planned_exit_body_peak_pl_dollars", 0),
        ("planned_exit_upper_long_pl_dollars", 0),
        ("planned_exit_unchanged_return_pct", 1),
        ("halfway_close_unchanged_pl_dollars", 0),
        ("halfway_close_body_peak_pl_dollars", 0),
        ("halfway_close_upper_long_pl_dollars", 0),
        ("two_thirds_close_unchanged_pl_dollars", 0),
        ("two_thirds_close_body_peak_pl_dollars", 0),
        ("two_thirds_close_upper_long_pl_dollars", 0),
        ("two_thirds_close_unchanged_return_pct", 1),
        ("profit_target_low_dollars", 0),
        ("profit_target_high_dollars", 0),
        ("stop_loss_dollars", 0),
        ("reverse_harvey_roll_strike", 2),
        ("reverse_harvey_credit_dollars", 0),
        ("reverse_harvey_upper_flat_dollars", 0),
        ("reverse_harvey_upper_width", 2),
        ("downside_hedge_trigger_price", 2),
        ("downside_hedge_long_strike", 2),
        ("downside_hedge_short_strike", 2),
        ("downside_hedge_debit_dollars", 0),
        ("downside_hedge_close_low_dollars", 0),
        ("downside_hedge_close_high_dollars", 0),
        ("session_change_pct", 2),
        ("realized_vol_20d_pct", 1),
        ("realized_vol_60d_pct", 1),
        ("realized_vol_percentile", 0),
        ("iv_vs_realized_ratio", 2),
    ):
        out[key] = _round(out.get(key), decimals)
    return out


def run_road_trip_butterfly_scan(payload: dict) -> dict:
    supplied = payload or {}
    p = {
        **DEFAULTS,
        **{key: value for key, value in supplied.items() if value is not None},
    }
    tickers = _ticker_list(p.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker to scan")

    market_bias = _bias_name(p.get("market_bias"))
    target_dte = int(_clamp(
        p.get("target_dte"), 77, MIN_TARGET_DTE, MAX_TARGET_DTE,
    ))
    min_dte = int(_clamp(p.get("min_dte"), 70, MIN_TARGET_DTE, MAX_TARGET_DTE))
    max_dte = int(_clamp(p.get("max_dte"), 85, min_dte, MAX_TARGET_DTE))
    target_dte = min(max_dte, max(min_dte, target_dte))
    quantity = int(_clamp(p.get("tranche_quantity"), BASE_QUANTITY, 1, 100))

    base_bias_low, base_bias_high = BIAS_RANGES[market_bias]
    bias_low = base_bias_low * quantity
    bias_high = base_bias_high * quantity

    upper_offset_pct = _clamp(p.get("upper_offset_pct"), ARTICLE_UPPER_OFFSET_PCT, 0.0, 25.0)
    offset_tolerance_pct = _clamp(p.get("offset_tolerance_pct"), 0.75, 0.05, 15.0)
    upper_wing_pct = _clamp(p.get("upper_wing_pct"), ARTICLE_UPPER_WING_PCT, 0.1, 30.0)
    lower_wing_pct = _clamp(p.get("lower_wing_pct"), ARTICLE_LOWER_WING_PCT, 0.1, 40.0)
    wing_tolerance_pct = _clamp(p.get("wing_tolerance_pct"), 1.0, 0.05, 20.0)
    min_lower_wing_ratio = _clamp(p.get("min_lower_wing_ratio"), 1.05, 1.001, 10.0)
    max_debit_to_margin_pct = _clamp(p.get("max_debit_to_margin_pct"), 5.0, 0.1, 100.0)
    min_theta_dollars = _clamp(p.get("min_theta_dollars"), 1.0, -5000.0, 5000.0)
    profit_target_low_pct = _clamp(p.get("profit_target_low_pct"), 7.0, 0.1, 200.0)
    profit_target_high_pct = _clamp(
        p.get("profit_target_high_pct"), 15.0, profit_target_low_pct, 500.0,
    )
    max_loss_pct = _clamp(p.get("max_loss_pct"), 5.0, 0.1, 100.0)
    exit_days_before_expiration = int(_clamp(
        p.get("exit_days_before_expiration"), 17, 0, max(1, min_dte - 1),
    ))
    hands_off_days = int(_clamp(p.get("hands_off_days"), 25, 0, max(1, min_dte - 1)))
    downside_hedge_width_pct = _clamp(p.get("downside_hedge_width_pct"), 0.5, 0.05, 10.0)
    require_favorable_entry_timing = _as_bool(p.get("require_favorable_entry_timing"))
    min_open_interest = max(0, int(_num(p.get("min_open_interest"), 0) or 0))
    open_positions = max(0, int(_num(p.get("open_positions"), 0) or 0))
    max_concurrent_positions = max(
        1, int(_num(p.get("max_concurrent_positions"), 5) or 5),
    )
    entry_interval_days = max(0, int(_num(p.get("entry_interval_days"), 14) or 0))
    days_since_last_entry = max(0, int(_num(p.get("days_since_last_entry"), 14) or 0))
    max_results = max(1, min(300, int(_num(p.get("max_results"), 100) or 100)))

    # "They add a new RTT position every two weeks and typically have four or
    # five on at a time." Both are laddering limits, not structure filters.
    ladder_flags = []
    if open_positions >= max_concurrent_positions:
        ladder_flags.append(
            f"{open_positions} of {max_concurrent_positions} concurrent road "
            "trip positions are already open"
        )
    if entry_interval_days and days_since_last_entry < entry_interval_days:
        ladder_flags.append(
            f"Only {days_since_last_entry} of {entry_interval_days} days have "
            "passed since the last entry; the model staggers entries"
        )

    history = _load_history(tickers)
    fundamentals = _fetch_fundamentals_bulk(tickers)
    spots = {}
    timings = {}
    for ticker in tickers:
        frame = _ticker_frame(history, ticker)
        if frame is None:
            continue
        close = frame["Close"].dropna()
        if not close.empty:
            spots[ticker] = _num(close.iloc[-1])
        timings[ticker] = _entry_timing(frame)

    def scan_ticker(ticker: str) -> dict:
        spot = spots.get(ticker)
        if not spot or spot <= 0:
            return {
                "ticker": ticker,
                "status": "unavailable",
                "reason": "Current underlying price is unavailable.",
                "candidates": [],
            }
        try:
            expirations = list(yf.Ticker(ticker).options or [])
        except Exception:
            expirations = []
        window = _expirations_in_window(
            expirations, target_dte, min_dte, max_dte,
        )
        if not window:
            return {
                "ticker": ticker,
                "price": _round(spot),
                "status": "unavailable",
                "reason": (
                    f"No listed expiration is between {min_dte} and "
                    f"{max_dte} DTE."
                ),
                "candidates": [],
            }

        fund = fundamentals.get(ticker, {})
        dividend_yield = dividend_yield_for_pricing(fund, spot)
        chosen = None
        chosen_monthly = False
        expirations_priced = 0
        usable_chains = 0
        for expiration, dte, is_monthly in window:
            puts = _load_put_chain(ticker, expiration, spot, dividend_yield)
            expirations_priced += 1
            if not puts:
                continue
            usable_chains += 1
            candidates = _candidates(
                puts,
                spot=spot,
                expiration=expiration,
                expiration_date=datetime.strptime(expiration, "%Y-%m-%d").date(),
                dte=dte,
                quantity=quantity,
                upper_offset_pct=upper_offset_pct,
                offset_tolerance_pct=offset_tolerance_pct,
                upper_wing_pct=upper_wing_pct,
                lower_wing_pct=lower_wing_pct,
                wing_tolerance_pct=wing_tolerance_pct,
                min_lower_wing_ratio=min_lower_wing_ratio,
                dividend_yield=dividend_yield,
                bias_low=bias_low,
                bias_high=bias_high,
                max_debit_to_margin_pct=max_debit_to_margin_pct,
                min_theta_dollars=min_theta_dollars,
                exit_days_before_expiration=exit_days_before_expiration,
                hands_off_days=hands_off_days,
                profit_target_low_pct=profit_target_low_pct,
                profit_target_high_pct=profit_target_high_pct,
                max_loss_pct=max_loss_pct,
                downside_hedge_width_pct=downside_hedge_width_pct,
            )
            if not candidates:
                continue
            chosen = _choose_candidate(
                candidates,
                bias_low=bias_low,
                bias_high=bias_high,
                max_debit_to_margin_pct=max_debit_to_margin_pct,
                min_theta_dollars=min_theta_dollars,
                min_open_interest=min_open_interest,
            )
            if chosen:
                chosen_monthly = is_monthly
                break

        first_expiration, first_dte, _ = window[0]
        if not chosen:
            reason = (
                "The selected expiration window has no usable put chain."
                if usable_chains == 0
                else (
                    "No debit broken-wing butterfly matched the requested "
                    "behind-the-market placement and wing widths."
                )
            )
            return {
                "ticker": ticker,
                "name": fund.get("name"),
                "price": _round(spot),
                "expiration": first_expiration,
                "dte": first_dte,
                "expirations_priced": expirations_priced,
                "status": "unavailable",
                "reason": reason,
                "candidates": [],
            }

        timing = _timing_status(
            timings.get(ticker, {}),
            _num((chosen.get("body_short_leg") or {}).get("iv")),
        )
        chosen.update(timing)
        chosen["market_bias"] = market_bias
        chosen["bias_delta_min"] = bias_low
        chosen["bias_delta_max"] = bias_high
        chosen["position_delta_error"] = _distance_to_range(
            chosen.get("position_delta"), bias_low, bias_high,
        )

        structure_flags = []
        advisories = []
        if not chosen["behind_the_market"]:
            structure_flags.append(
                "The upper long is not behind the market"
            )
        debit_ratio = chosen.get("debit_to_margin_pct")
        if debit_ratio is None or debit_ratio > max_debit_to_margin_pct:
            structure_flags.append(
                "Entry debit is above the article's percentage-of-margin limit"
            )
        if chosen["position_delta_error"] > 0:
            structure_flags.append(
                f"Net delta is outside the scaled {market_bias} range"
            )
        theta = chosen.get("theta_dollars_per_day")
        if theta is None or theta < min_theta_dollars:
            structure_flags.append("Daily theta is below the required minimum")
        if chosen["open_interest_min"] < min_open_interest:
            structure_flags.append(
                "One or more legs are below minimum open interest"
            )
        if chosen.get("uses_last_trade_prices"):
            structure_flags.append(
                "Live bid/ask unavailable on one or more legs; entry values "
                "use recent trades"
            )

        timing_flags = []
        if timing["entry_timing_status"] != "favorable":
            message = (
                "Entry session is not the preferred down day with elevated "
                "volatility"
            )
            (timing_flags if require_favorable_entry_timing else advisories).append(message)
        # Coarse-strike fit is reported on the detail card rather than flagged.
        # Placement is chosen on percentage geometry, so the legs almost never
        # land on round strikes and a warning here would fire on every row.
        if not chosen_monthly:
            advisories.append(
                "Weekly expiration; confirm the complex-order liquidity"
            )
        natural_credit = chosen.get("natural_credit")
        if natural_credit is not None:
            natural_debit = -natural_credit * CONTRACT_MULTIPLIER
            if (
                chosen.get("initial_margin_dollars")
                and natural_debit
                > chosen["initial_margin_dollars"] * max_debit_to_margin_pct / 100.0
            ):
                advisories.append(
                    "Mid clears the debit rule but the natural market does not"
                )

        blocking_flags = [*structure_flags, *timing_flags, *ladder_flags]
        chosen.update({
            "ticker": ticker,
            "name": fund.get("name"),
            "price": spot,
            "is_monthly_expiration": chosen_monthly,
            "status": "actionable" if not blocking_flags else "near_match",
            "structural_status": (
                "matched" if not structure_flags else "near_match"
            ),
            "flags": [*blocking_flags, *advisories],
            "blocking_flags": blocking_flags,
            "structure_flags": structure_flags,
            "ladder_flags": ladder_flags,
            "scanner_variant": (
                f"road-trip-butterfly-{market_bias}-q{quantity}"
            ),
            "max_debit_to_margin_pct": max_debit_to_margin_pct,
            "min_theta_dollars": min_theta_dollars,
            "open_positions": open_positions,
            "max_concurrent_positions": max_concurrent_positions,
            "entry_interval_days": entry_interval_days,
            "days_since_last_entry": days_since_last_entry,
        })
        return {
            "ticker": ticker,
            "name": fund.get("name"),
            "price": _round(spot),
            "expiration": chosen["expiration"],
            "dte": chosen["dte"],
            "expirations_priced": expirations_priced,
            "status": "found",
            "reason": None,
            "candidates": [_round_rtt_candidate(chosen)],
        }

    scan_results = []
    with ThreadPoolExecutor(max_workers=min(8, len(tickers))) as pool:
        scan_results.extend(pool.map(scan_ticker, tickers))

    rows = [
        candidate
        for result in scan_results
        for candidate in result.get("candidates", [])
    ]

    def row_quality(row):
        debit_ratio = row.get("debit_to_margin_pct")
        theta = row.get("theta_dollars_per_day")
        return (
            row.get("status") != "actionable",
            row.get("structural_status") != "matched",
            (
                max(0.0, debit_ratio - max_debit_to_margin_pct)
                if debit_ratio is not None else math.inf
            ),
            row.get("position_delta_error", math.inf),
            (
                max(0.0, min_theta_dollars - theta)
                if theta is not None else math.inf
            ),
            debit_ratio if debit_ratio is not None else math.inf,
        )

    rows.sort(key=row_quality)
    rows = rows[:max_results]
    unavailable = [
        {
            "ticker": result["ticker"],
            "name": result.get("name"),
            "price": result.get("price"),
            "expiration": result.get("expiration"),
            "dte": result.get("dte"),
            "reason": result.get("reason"),
        }
        for result in scan_results
        if not result.get("candidates")
    ]

    return {
        "rows": rows,
        "unavailable": unavailable,
        "stats": {
            "tickers": len(tickers),
            "expirations_priced": sum(
                result.get("expirations_priced", 0)
                for result in scan_results
            ),
            "structures_found": len(rows),
            "structural_matches": sum(
                1 for row in rows if row["structural_status"] == "matched"
            ),
            "actionable": sum(
                1 for row in rows if row["status"] == "actionable"
            ),
            "near_matches": sum(
                1 for row in rows if row["status"] == "near_match"
            ),
        },
        "params": {
            "tickers": tickers,
            "market_bias": market_bias,
            "bias_delta_min": bias_low,
            "bias_delta_max": bias_high,
            "target_dte": target_dte,
            "min_dte": min_dte,
            "max_dte": max_dte,
            "tranche_quantity": quantity,
            "upper_offset_pct": upper_offset_pct,
            "offset_tolerance_pct": offset_tolerance_pct,
            "upper_wing_pct": upper_wing_pct,
            "lower_wing_pct": lower_wing_pct,
            "wing_tolerance_pct": wing_tolerance_pct,
            "min_lower_wing_ratio": min_lower_wing_ratio,
            "max_debit_to_margin_pct": max_debit_to_margin_pct,
            "min_theta_dollars": min_theta_dollars,
            "profit_target_low_pct": profit_target_low_pct,
            "profit_target_high_pct": profit_target_high_pct,
            "max_loss_pct": max_loss_pct,
            "exit_days_before_expiration": exit_days_before_expiration,
            "hands_off_days": hands_off_days,
            "downside_hedge_width_pct": downside_hedge_width_pct,
            "require_favorable_entry_timing": require_favorable_entry_timing,
            "min_open_interest": min_open_interest,
            "open_positions": open_positions,
            "max_concurrent_positions": max_concurrent_positions,
            "entry_interval_days": entry_interval_days,
            "days_since_last_entry": days_since_last_entry,
            "ladder_flags": ladder_flags,
        },
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


def register_routes(app):
    @app.route(
        "/api/options/road-trip-butterfly-scan/defaults",
        methods=["GET"],
    )
    def road_trip_butterfly_scan_defaults():
        return jsonify(
            defaults=DEFAULTS,
            structure={
                "upper_long_quantity": 1,
                "body_short_quantity": 2,
                "lower_long_quantity": 1,
                "base_quantity": BASE_QUANTITY,
                "article_upper_offset_pct": ARTICLE_UPPER_OFFSET_PCT,
                "article_upper_wing_pct": ARTICLE_UPPER_WING_PCT,
                "article_lower_wing_pct": ARTICLE_LOWER_WING_PCT,
            },
            market_biases=[
                {
                    "id": name,
                    "minimum_delta_per_butterfly": limits[0],
                    "maximum_delta_per_butterfly": limits[1],
                }
                for name, limits in BIAS_RANGES.items()
            ],
        )

    @app.route("/api/options/road-trip-butterfly-scan", methods=["POST"])
    def road_trip_butterfly_scan():
        payload = request.get_json(force=True, silent=True) or {}
        try:
            return jsonify(run_road_trip_butterfly_scan(payload))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except Exception as exc:
            return jsonify(error=str(exc)), 500
