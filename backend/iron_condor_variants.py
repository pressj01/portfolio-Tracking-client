"""Directional, ratio'd, and hedged iron condor variants.

The base ``iron_condor_scanner`` builds one structure: a delta-matched, equal-
quantity, symmetric condor that expresses no opinion about direction. That is
the right default and it stays the default. This module adds the structures a
trader reaches for when they *do* have an opinion, or when the two wings do not
deserve the same amount of capital.

Everything here follows Craig Severson's *Advanced Iron Condor Trading Guide*,
which is the source the user works from. Two rules out of that book drive almost
all of the geometry below, and both are quoted where they are applied:

  * **Bias by delta, not by distance.** "In the event of a major trend, we can
    bias the trade in one direction by using smaller Deltas for the spread in
    the expected direction, and larger Deltas for the spread in the opposite
    direction. For example, if we're expecting an uptrend continuation, we'll
    select a .35 to .40 Delta for the short put strike, and a .25 Delta for the
    short call strike." (Appendix B). Stated a second time in the Low
    Probability chapter: "bullish bias overall, I can secure a slightly higher
    delta than .30 on the short put leg, while leaving the short call at .30 or
    better."

    This is worth pausing on, because it reads backwards on first pass. A
    *bullish* tilt sells the **put** closer to the money and pushes the **call**
    further away. The structure moves up with the price you expect, so the call
    wing — the side price is walking toward — gets more room, and the put wing —
    the side you have just decided is safe — gets paid more for the risk it is
    no longer really taking.

  * **Hedge gamma with debit spreads and butterflies.** "We'll use Gamma Risk
    hedges like Butterflies or Debit spreads to help proactively defend a
    late-cycle attack against a position", and "We will typically combine a
    Delta/Gamma hedge by adding a Debit Spread on top of the attacked spread to
    'Butterfly off' the credit spread."

The eight structures
--------------------
Three constructions × two directions, plus the two Weirdor forms and the Jeep::

    balanced         the existing neutral condor, unchanged
    strike_tilt      equal quantities, delta-biased strikes
    ratio_tilt       delta-biased strikes AND fewer contracts on the side price
                     is expected to move toward
    risk_ratio       centred delta-matched strikes, fewer contracts on whichever
                     side actually measures riskier
    weirdor_ratio    Weirdor: downside-heavy ratio, solved toward delta-neutral
    weirdor_hedged   Weirdor: a condor plus Severson's defensive butterfly moat
    jeep             a Weirdor whose put side carries a front debit spread

Why the payoff is measured numerically
--------------------------------------
The base scanner can say ``max_loss = max(put_wing, call_wing) - credit``
because both wings are 1x and the geometry is fixed. The moment quantities
differ per side, or a butterfly is bolted on, or a sixth leg appears, that
formula is wrong — and wrong quietly, in the direction that flatters the trade.

So nothing here derives a closed form. `analyze_structure` walks the actual
piecewise-linear expiration curve through every strike, reads max profit, max
loss and both breakevens off it, and — most importantly — **refuses any
structure whose risk is not bounded on both ends**. That last check is the
whole reason this approach was chosen: a ratio'd condor with more shorts than
longs on a side is a naked position wearing a defined-risk name, and it is the
single easiest way for an "unbalanced condor" feature to hand someone an
unlimited loss. Slope-at-the-tails is a proof, not a heuristic.
"""

from __future__ import annotations

from put_scanner import _num

CONTRACT_MULTIPLIER = 100.0

# Severson biases a .30-delta condor to roughly .375/.225 when he wants a lean.
# Expressed as a fraction of the user's own base delta rather than as hardcoded
# strikes, so a conservative 0.12-delta scan gets a proportional tilt instead of
# being silently converted into a low-probability trade it never asked for.
DEFAULT_TILT_STRENGTH = 0.25

# How much smaller the light side gets on a ratio'd structure. 2:1 is the ratio
# in the guide's own worked bias examples and in the standard asymmetric condor.
DEFAULT_RATIO = 2

# "I will usually pay about 10% of the value of the credit that I am protecting
# to set up a Defensive Butterfly." — the moat is insurance, and insurance that
# costs much more than this stops being worth claiming against.
HEDGE_BUDGET_PCT = 10.0

# Slope tolerance when proving the tails are flat. Strikes and mids are in
# dollars, so anything this small is float noise rather than real exposure.
FLAT_SLOPE_EPS = 1e-6

# The Jeep's front debit spread is built narrower than the credit-spread wing.
# See the construction note in `build_structure` — equal widths cancel below the
# lowest strike and manufacture a riskless bottom that no chain would price.
FRONT_WIDTH_FRACTION = 0.5

# How far above spot the Jeep's front debit spread may reach. In the reference
# position the front spread sits essentially *on* the money — its strikes
# straddle spot — so clipping it strictly below would either refuse to build the
# structure or squeeze it onto whatever single strike was left underneath.
FRONT_SPOT_HEADROOM = 1.03

# When these structures are actually closed. Severson takes "half of the
# position for a nominal 25% return on risk" well before expiration, and the
# whole family is managed rather than held: the base screen reassesses at 21 DTE
# and closes by 7.
#
# This matters more than it looks. A terminal probability answers "where does
# price finish?", which is a question these trades never get to. Between half
# and two-thirds of the way through the cycle the distribution is materially
# narrower, so the odds of being in profit *at the close the plan actually
# specifies* are not the odds of expiring in profit — usually they are better,
# because there is less time left for price to travel. Quoting only the
# expiration number understates a trade that is designed to be taken off early.
EARLY_CLOSE_FRACTIONS = (0.50, 2.0 / 3.0)


def early_close_exits(dte: int | None) -> list[dict]:
    """Planned-close exit points at half and two-thirds of the cycle.

    Fed to `profit_probability_schedule`, which always appends expiration on its
    own, so the caller gets the managed odds and the held-to-expiry odds side by
    side rather than having to choose between them.
    """
    days = int(_num(dte, 0) or 0)
    if days < 2:
        return []
    points: list[dict] = []
    for fraction in EARLY_CLOSE_FRACTIONS:
        elapsed = int(round(days * fraction))
        remaining = days - elapsed
        if remaining < 1 or remaining >= days:
            continue
        points.append({
            "kind": "planned_close",
            "label": f"Closed at {fraction:.0%} of the cycle",
            "remaining_dte": remaining,
            "elapsed_fraction": fraction,
        })
    # Collapse the two if a short cycle rounds them onto the same day.
    seen: set[int] = set()
    unique: list[dict] = []
    for point in points:
        if point["remaining_dte"] not in seen:
            seen.add(point["remaining_dte"])
            unique.append(point)
    return unique


# ---------------------------------------------------------------------------
# Variant registry
# ---------------------------------------------------------------------------

DIRECTIONS = ("neutral", "bullish", "bearish")

# `directional` marks the variants that mean something different depending on
# which way the user thinks the market is going. The Weirdor forms and the Jeep
# are shape-defined rather than opinion-defined, so they appear once.
VARIANTS: dict[str, dict] = {
    "balanced": {
        "label": "Balanced",
        "directional": False,
        "blurb": (
            "The classic condor: delta-matched short strikes, equal contracts, "
            "no directional opinion."
        ),
    },
    "strike_tilt": {
        "label": "Strike tilt",
        "directional": True,
        "blurb": (
            "Equal contracts on both sides; the lean comes entirely from moving "
            "the strikes. Severson's delta-bias rule — the side you expect price "
            "to move toward is sold further out."
        ),
    },
    "ratio_tilt": {
        "label": "Ratio tilt",
        "directional": True,
        "blurb": (
            "Delta-biased strikes and fewer contracts on the side price is "
            "expected to move toward, so the wing most likely to be tested is "
            "also the one carrying the least size."
        ),
    },
    "risk_ratio": {
        "label": "Centred ratio",
        "directional": True,
        "blurb": (
            "Strikes stay centred and delta-matched; only the contract counts "
            "move. The side that measures riskier is cut back."
        ),
    },
    "weirdor_ratio": {
        "label": "Weirdor (ratio)",
        "directional": False,
        "blurb": (
            "Downside-heavy asymmetric condor: more put spreads far out, fewer "
            "call spreads closer in, with the ratio solved toward a flat net "
            "delta. Wide profit shelf below, upside is the real risk."
        ),
    },
    "weirdor_hedged": {
        "label": "Weirdor (hedged)",
        "directional": False,
        "blurb": (
            "A condor plus Severson's defensive butterfly moat placed just "
            "inside each short strike — long gamma bought as insurance against "
            "a late-cycle attack."
        ),
    },
    "jeep": {
        "label": "Jeep",
        "directional": False,
        "blurb": (
            "A Weirdor whose put side carries a front debit spread, "
            "'butterflying off' the put credit spread. Builds a raised profit "
            "shelf below the market while the call spread funds it."
        ),
    },
}

# Variants whose risk is genuinely one-sided. Their scoring must not be judged
# by the balanced screen's neutrality terms, and their verdicts say so.
ASYMMETRIC_VARIANTS = {"weirdor_ratio", "weirdor_hedged", "jeep"}


def variant_choices() -> list[dict]:
    """The pickable (variant, direction) combinations, for the UI and the API."""
    out: list[dict] = []
    for key, spec in VARIANTS.items():
        if spec["directional"]:
            for direction in ("bullish", "bearish"):
                out.append({
                    "id": f"{key}:{direction}",
                    "variant": key,
                    "direction": direction,
                    "label": f"{spec['label']} · {direction.capitalize()}",
                    "blurb": spec["blurb"],
                })
        else:
            out.append({
                "id": key,
                "variant": key,
                "direction": "neutral",
                "label": spec["label"],
                "blurb": spec["blurb"],
            })
    return out


def resolve_variants(construction: str | None, direction: str | None) -> list[tuple[str, str]]:
    """(variant, direction) pairs to build for one scan.

    ``construction='all'`` means every construction valid for the chosen
    direction — which for a directional pick is the three tilted forms plus the
    three shape-defined ones, and for neutral is the balanced condor plus the
    three shape-defined ones. The tilted constructions are omitted from a
    neutral scan on purpose: a "tilt" with no direction to tilt toward is just
    the balanced condor with extra steps.
    """
    construction = (construction or "balanced").strip().lower()
    direction = (direction or "neutral").strip().lower()
    if direction not in DIRECTIONS:
        direction = "neutral"

    if construction == "all":
        if direction == "neutral":
            keys = ["balanced", "weirdor_ratio", "weirdor_hedged", "jeep"]
        else:
            keys = [
                "strike_tilt", "ratio_tilt", "risk_ratio",
                "weirdor_ratio", "weirdor_hedged", "jeep",
            ]
        return [
            (key, direction if VARIANTS[key]["directional"] else "neutral")
            for key in keys
        ]

    if construction not in VARIANTS:
        construction = "balanced"
    if not VARIANTS[construction]["directional"]:
        return [(construction, "neutral")]
    # A directional construction with no direction picked has nothing to express.
    return [(construction, direction if direction != "neutral" else "bullish")]


# ---------------------------------------------------------------------------
# Payoff analysis
# ---------------------------------------------------------------------------

def _intrinsic(option_type: str, strike: float, spot: float) -> float:
    if option_type == "put":
        return max(0.0, strike - spot)
    return max(0.0, spot - strike)


def entry_cashflow(legs: list[dict]) -> float:
    """Net cash at entry, in points. Positive is a credit received.

    ``qty`` is signed: positive is long (pay the mid), negative is short
    (receive it).
    """
    total = 0.0
    for leg in legs:
        mid = _num(leg.get("mid"))
        if mid is None:
            return 0.0
        total -= float(leg["qty"]) * mid
    return total


def payoff_at(legs: list[dict], cashflow: float, spot: float) -> float:
    """Total P&L per structure at expiration, in points, at underlying ``spot``."""
    total = cashflow
    for leg in legs:
        total += float(leg["qty"]) * _intrinsic(leg["option_type"], float(leg["strike"]), spot)
    return total


def _tail_slope(legs: list[dict], cashflow: float, low: float, high: float) -> float:
    """Slope of the expiration curve across a segment with no strike inside it."""
    if high <= low:
        return 0.0
    return (payoff_at(legs, cashflow, high) - payoff_at(legs, cashflow, low)) / (high - low)


def analyze_structure(legs: list[dict]) -> dict | None:
    """Max profit, max loss and breakevens read off the real expiration curve.

    Returns None when the structure is unusable — which here means one specific
    thing above all others: **the risk is not bounded**. A ratio'd or hedged
    condor can very easily end up net short options at one tail, and that is not
    a condor at all, it is a naked short wearing four to six legs. The check is
    the slope of the payoff outside the outermost strikes: for genuinely defined
    risk it must be flat at both ends.
    """
    if not legs:
        return None
    for leg in legs:
        if not _num(leg.get("strike")) or _num(leg.get("mid")) is None:
            return None
        if not int(leg.get("qty") or 0):
            return None

    cashflow = entry_cashflow(legs)
    strikes = sorted({float(leg["strike"]) for leg in legs})
    lowest, highest = strikes[0], strikes[-1]
    step = max(1.0, (highest - lowest) * 0.5)

    # Below the lowest strike and above the highest, the curve is a straight
    # line forever. Flat at both ends is the definition of defined risk.
    if abs(_tail_slope(legs, cashflow, max(0.0, lowest - step * 2), max(0.01, lowest - step))) > FLAT_SLOPE_EPS:
        return None
    if abs(_tail_slope(legs, cashflow, highest + step, highest + step * 2)) > FLAT_SLOPE_EPS:
        return None

    # With both tails flat, every extreme sits on a kink, and the kinks are the
    # strikes themselves plus the two flat shelves beyond them.
    probes = [max(0.0, lowest - step)] + strikes + [highest + step]
    curve = [(x, payoff_at(legs, cashflow, x)) for x in probes]

    max_profit = max(value for _, value in curve)
    max_loss_value = min(value for _, value in curve)
    # Reported as a positive number, matching the base scanner's convention.
    max_loss = -max_loss_value if max_loss_value < 0 else 0.0

    found: list[float] = []
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if y0 == 0.0:
            found.append(x0)
        if (y0 < 0.0 < y1) or (y1 < 0.0 < y0):
            found.append(x0 + (x1 - x0) * (-y0) / (y1 - y0))
    if curve[-1][1] == 0.0:
        found.append(curve[-1][0])
    # Deduped on a rounded key but stored at full precision — a breakeven is a
    # price the position is sized against, so it must not pick up display
    # rounding on the way through the analyzer.
    breakevens: list[float] = []
    seen: set[float] = set()
    for value in sorted(found):
        key = round(value, 4)
        if key not in seen:
            seen.add(key)
            breakevens.append(value)

    return {
        "entry_cashflow": cashflow,
        "max_profit": max_profit,
        "max_loss": max_loss,
        "breakevens": breakevens,
        "lower_breakeven": breakevens[0] if breakevens else None,
        "upper_breakeven": breakevens[-1] if breakevens else None,
        "curve": curve,
    }


# ---------------------------------------------------------------------------
# Strike selection
# ---------------------------------------------------------------------------

def nearest_delta(legs: list[dict], target: float) -> dict | None:
    """The leg whose absolute delta sits closest to ``target``."""
    pool = [leg for leg in legs if _num(leg.get("delta")) is not None]
    if not pool:
        return None
    return min(pool, key=lambda leg: abs(abs(_num(leg["delta"])) - target))


def long_at_width(legs: list[dict], short_leg: dict, width: float, is_put: bool) -> dict | None:
    """The protective leg closest to ``width`` away from the short, on the OTM side."""
    if not short_leg:
        return None
    short_strike = float(short_leg["strike"])
    if is_put:
        pool = [leg for leg in legs if float(leg["strike"]) < short_strike]
    else:
        pool = [leg for leg in legs if float(leg["strike"]) > short_strike]
    if not pool:
        return None
    return min(pool, key=lambda leg: abs(abs(float(leg["strike"]) - short_strike) - width))


def tilted_deltas(base_delta: float, direction: str,
                  tilt_strength: float = DEFAULT_TILT_STRENGTH) -> tuple[float, float]:
    """(put short delta, call short delta) for a directional lean.

    Severson's rule, applied proportionally: the side price is expected to move
    toward is sold at a *smaller* delta — further out of the money, more room —
    and the opposite side is sold at a *larger* one, closer in, collecting more
    for risk that the directional call has just decided is less real.

    Bullish therefore raises the put delta and lowers the call delta, which
    shifts the whole structure up with the move it expects.
    """
    tilt = max(0.0, min(0.75, tilt_strength))
    heavy = base_delta * (1.0 + tilt)
    light = base_delta * (1.0 - tilt)
    if direction == "bullish":
        return heavy, light
    if direction == "bearish":
        return light, heavy
    return base_delta, base_delta


def riskier_side(direction: str, tech: dict, put_short: dict | None,
                 call_short: dict | None) -> tuple[str, list[str]]:
    """Which wing is carrying more real risk, and the reasons why.

    Used by the centred-ratio construction, where the strikes stay symmetric and
    only the contract counts move. "Most risk" is a measurement here rather than
    a feeling, and it is deliberately not just the user's directional pick —
    though that is the heaviest single term when they have made one.

    Returns ``("put", reasons)`` or ``("call", reasons)``.
    """
    put_score = 0.0
    call_score = 0.0
    reasons: list[str] = []

    # The stated opinion. Bullish means price is walking toward the call wing.
    if direction == "bullish":
        call_score += 2.0
        reasons.append("bullish view puts price on a path toward the call wing")
    elif direction == "bearish":
        put_score += 2.0
        reasons.append("bearish view puts price on a path toward the put wing")

    # Where price actually sits in its own range. High in the range is closer to
    # the call wing in the only sense that matters — fewer points of room.
    position = _num(tech.get("range_position_pct"))
    if position is not None:
        if position >= 65:
            call_score += 1.0
            reasons.append(f"price sits {position:.0f}% up its range, close to the call side")
        elif position <= 35:
            put_score += 1.0
            reasons.append(f"price sits {position:.0f}% up its range, close to the put side")

    # Which way the recent drift points, regardless of how small it is.
    drift = _num(tech.get("drift_sigma"))
    if drift is not None and drift >= 0.5:
        if tech.get("drift_direction") == "down":
            put_score += 0.75
            reasons.append(f"{drift:.1f}σ of recent drift is downward")
        else:
            call_score += 0.75
            reasons.append(f"{drift:.1f}σ of recent drift is upward")

    # The chain's own opinion. Equity put skew normally makes the put short the
    # higher-delta leg at equal distance, which is the imbalance the balanced
    # screen spends a whole term correcting for.
    ps = _num((put_short or {}).get("delta"))
    cs = _num((call_short or {}).get("delta"))
    if ps is not None and cs is not None:
        gap = abs(ps) - abs(cs)
        if gap > 0.02:
            put_score += 1.0
            reasons.append(f"put short carries {abs(gap):.2f} more delta than the call short")
        elif gap < -0.02:
            call_score += 1.0
            reasons.append(f"call short carries {abs(gap):.2f} more delta than the put short")

    if call_score > put_score:
        return "call", reasons
    if put_score > call_score:
        return "put", reasons
    # A genuine tie goes to the put side. Equity gap risk is not symmetric —
    # indices fall faster than they rise, and the put wing is the one a crash
    # runs straight through.
    reasons.append("no clear edge either way; defaulting to the put side, which carries gap risk")
    return "put", reasons


def hedge_contracts(credit_dollars: float, hedge_debit: float,
                    budget_pct: float = HEDGE_BUDGET_PCT) -> int:
    """How many butterflies the moat budget buys.

    "As an example, if I receive a $1000 credit from a Credit Spread and I'm
    trying to protect that credit against a late-month attack, then I'll look to
    spend somewhere around $100 on 'insurance' against that trade."
    """
    if not credit_dollars or credit_dollars <= 0:
        return 0
    if not hedge_debit or hedge_debit <= 0:
        return 0
    budget = credit_dollars * max(0.0, budget_pct) / 100.0
    return max(0, int(budget // (hedge_debit * CONTRACT_MULTIPLIER)))


# ---------------------------------------------------------------------------
# Structure assembly
# ---------------------------------------------------------------------------

def _leg(quote: dict, option_type: str, qty: int, role: str) -> dict:
    """One leg of a structure. ``qty`` is signed: positive long, negative short."""
    return {
        "option_type": option_type,
        "strike": float(quote["strike"]),
        "qty": int(qty),
        "mid": _num(quote.get("mid")),
        "bid": _num(quote.get("bid")),
        "ask": _num(quote.get("ask")),
        "iv": _num(quote.get("iv")),
        "delta": _num(quote.get("delta")),
        "open_interest": int(_num(quote.get("open_interest"), 0) or 0),
        "volume": int(_num(quote.get("volume"), 0) or 0),
        "quote_source": quote.get("quote_source", "live_bid_ask"),
        "role": role,
    }


def _spread_delta(short_leg: dict, long_leg: dict) -> float | None:
    """Net delta of one vertical, short leg sold and long leg bought."""
    s, l = _num(short_leg.get("delta")), _num(long_leg.get("delta"))
    if s is None or l is None:
        return None
    return -s + l


def _neutral_ratio(put_spread_delta: float | None, call_spread_delta: float | None,
                   max_ratio: int = 5) -> tuple[int, int]:
    """Whole-contract (put, call) counts that come closest to a flat net delta.

    A short put spread is net long delta and a short call spread is net short
    delta, so there is always some ratio between them that nets out. Searching
    small integer pairs rather than rounding a float keeps the answer tradeable:
    3:2 is an order a human can actually send, 2.87:1 is not.
    """
    if not put_spread_delta or not call_spread_delta:
        return 1, 1
    if put_spread_delta <= 0 or call_spread_delta >= 0:
        # Not the sign pair a short condor produces — bad deltas, don't guess.
        return 1, 1
    best = (1, 1)
    best_residual = None
    for put_qty in range(1, max_ratio + 1):
        for call_qty in range(1, max_ratio + 1):
            residual = abs(put_qty * put_spread_delta + call_qty * call_spread_delta)
            # Prefer the flattest, then the smallest total position.
            key = (round(residual, 4), put_qty + call_qty)
            if best_residual is None or key < best_residual:
                best_residual, best = key, (put_qty, call_qty)
    return best


def build_structure(
    variant: str,
    direction: str,
    put_legs: list[dict],
    call_legs: list[dict],
    spot: float,
    tech: dict,
    base_short_delta: float = 0.16,
    base_long_delta: float = 0.07,
    tilt_strength: float = DEFAULT_TILT_STRENGTH,
    ratio: int = DEFAULT_RATIO,
    width_pct: float = 5.0,
) -> dict | None:
    """Assemble the legs for one variant, or None when the chain cannot supply them.

    ``put_legs`` and ``call_legs`` are prepared, quotable chain rows below and
    above spot respectively. Everything returned is expressed as signed
    quantities so `analyze_structure` can measure the result without knowing
    which variant produced it.
    """
    if not put_legs or not call_legs or not spot or spot <= 0:
        return None

    width = max(0.01, spot * max(0.1, width_pct) / 100.0)
    notes: list[str] = []
    risk_reasons: list[str] = []

    # ── Short strike deltas ──────────────────────────────────────────────
    if variant in {"strike_tilt", "ratio_tilt"}:
        put_delta, call_delta = tilted_deltas(base_short_delta, direction, tilt_strength)
    elif variant == "weirdor_ratio" or variant == "jeep":
        # The Weirdor family is downside-heavy by construction: the put side is
        # pushed far out where it is cheap to defend, the call side is sold
        # closer where the premium actually is. The ratio, not the strikes, is
        # what brings the net delta back toward flat.
        put_delta = base_short_delta * 0.6
        call_delta = base_short_delta * 1.4
    else:
        put_delta, call_delta = base_short_delta, base_short_delta

    put_short = nearest_delta(put_legs, put_delta)
    call_short = nearest_delta(call_legs, call_delta)
    if not put_short or not call_short:
        return None

    # Both wings are built to the same width, including on the Weirdor family.
    # A reference Weirdor (RUT at 1161, Feb 2015) sells 20x the 1040/1020 put
    # spread against 4x the 1250/1270 call spread — 20 points wide on both
    # sides, with the entire asymmetry carried by the 5:1 contract count. Its
    # stated max margin of $36,160 is 20 x 20 x 100 less the credit, which only
    # reconciles if the put wing really is 20 wide.
    #
    # Severson does size his *hedge butterflies* 3-wide below and 2-wide above,
    # but that is a statement about the moat, not about the condor's wings, and
    # it belongs to `weirdor_hedged` alone.
    put_long = long_at_width(put_legs, put_short, width, is_put=True)
    call_long = long_at_width(call_legs, call_short, width, is_put=False)
    if not put_long or not call_long:
        return None
    if float(put_long["strike"]) >= float(put_short["strike"]):
        return None
    if float(call_long["strike"]) <= float(call_short["strike"]):
        return None

    # ── Contract counts ──────────────────────────────────────────────────
    put_qty, call_qty = 1, 1
    ratio = max(2, min(5, int(ratio or DEFAULT_RATIO)))

    if variant == "ratio_tilt":
        # Fewer contracts on the side price is expected to move toward, so the
        # wing most likely to be tested is also the one carrying least size.
        if direction == "bullish":
            put_qty, call_qty = ratio, 1
            notes.append(
                f"{ratio}:1 put-heavy — the call wing price is heading toward "
                f"carries the smaller position"
            )
        elif direction == "bearish":
            put_qty, call_qty = 1, ratio
            notes.append(
                f"1:{ratio} call-heavy — the put wing price is heading toward "
                f"carries the smaller position"
            )
    elif variant == "risk_ratio":
        side, risk_reasons = riskier_side(direction, tech, put_short, call_short)
        if side == "call":
            put_qty, call_qty = ratio, 1
            notes.append(f"{ratio}:1 put-heavy — the call wing measured riskier")
        else:
            put_qty, call_qty = 1, ratio
            notes.append(f"1:{ratio} call-heavy — the put wing measured riskier")
    elif variant in {"weirdor_ratio", "jeep"}:
        put_qty, call_qty = _neutral_ratio(
            _spread_delta(put_short, put_long),
            _spread_delta(call_short, call_long),
        )
        notes.append(
            f"{put_qty}:{call_qty} ratio solved toward a flat net delta rather "
            f"than matched by strike distance"
        )

    legs = [
        _leg(put_long, "put", +put_qty, "put_long"),
        _leg(put_short, "put", -put_qty, "put_short"),
        _leg(call_short, "call", -call_qty, "call_short"),
        _leg(call_long, "call", +call_qty, "call_long"),
    ]

    # ── The Jeep's front debit spread ────────────────────────────────────
    # "adding a Debit Spread on top of the attacked spread to 'Butterfly off'
    # the credit spread". The long leg sits nearest the money and the short leg
    # lands on — or just above — the credit spread's short strike, which is what
    # raises the profit shelf between them instead of merely widening the wing.
    front = None
    if variant == "jeep":
        front_short = nearest_delta(
            [leg for leg in put_legs if float(leg["strike"]) > float(put_short["strike"])],
            base_short_delta * 2.2,
        )
        if not front_short:
            return None
        # Deliberately narrower than the credit-spread wing. Matching the two
        # widths makes the front spread cancel the credit spread below the
        # lowest strike, which flattens the downside to zero risk — a shape no
        # chain will actually price, and one that would report a free lunch on
        # stale quotes. The gap between the two widths *is* the Jeep's downside.
        front_width = max(0.01, width * FRONT_WIDTH_FRACTION)
        front_long = long_at_width(
            [leg for leg in put_legs if float(leg["strike"]) > float(front_short["strike"])],
            front_short, front_width, is_put=False,
        )
        if not front_long or float(front_long["strike"]) <= float(front_short["strike"]):
            return None
        if float(front_long["strike"]) > spot * FRONT_SPOT_HEADROOM:
            # Near the money is the point; well *above* it is a different trade.
            return None
        legs.append(_leg(front_long, "put", +put_qty, "front_debit_long"))
        legs.append(_leg(front_short, "put", -put_qty, "front_debit_short"))
        front = {
            "long_strike": float(front_long["strike"]),
            "short_strike": float(front_short["strike"]),
            "quantity": put_qty,
        }
        notes.append(
            "Front put debit spread raises the profit shelf below the market; "
            "its lower strike butterflies off the put credit spread"
        )

    # ── The Weirdor's defensive butterfly moat ───────────────────────────
    # "I try to place the Butterfly as close to the vertical spread as possible"
    # — just inside the short strike, between it and spot, so it is long gamma
    # exactly where a late attack arrives.
    hedges: list[dict] = []
    if variant == "weirdor_hedged":
        for side, chain, short_leg, qty in (
            ("put", put_legs, put_short, put_qty),
            ("call", call_legs, call_short, call_qty),
        ):
            body = nearest_delta(
                [
                    leg for leg in chain
                    if (float(leg["strike"]) > float(short_leg["strike"]))
                    == (side == "put")
                    and abs(float(leg["strike"]) - spot) > 0
                ],
                base_short_delta * 1.8,
            )
            if not body:
                continue
            inner = long_at_width(chain, body, width, is_put=(side == "call"))
            outer = long_at_width(chain, body, width, is_put=(side == "put"))
            if not inner or not outer:
                continue
            if inner["strike"] == body["strike"] or outer["strike"] == body["strike"]:
                continue
            hedges.extend([
                _leg(inner, side, +qty, f"{side}_hedge_wing"),
                _leg(body, side, -2 * qty, f"{side}_hedge_body"),
                _leg(outer, side, +qty, f"{side}_hedge_wing"),
            ])
        if not hedges:
            return None
        legs.extend(hedges)
        notes.append(
            "Defensive butterflies sit just inside each short strike — long "
            "gamma bought as insurance, most effective against a late attack"
        )

    return {
        "variant": variant,
        "direction": direction,
        "legs": legs,
        "put_quantity": put_qty,
        "call_quantity": call_qty,
        "put_short_strike": float(put_short["strike"]),
        "put_long_strike": float(put_long["strike"]),
        "call_short_strike": float(call_short["strike"]),
        "call_long_strike": float(call_long["strike"]),
        "front_debit": front,
        "hedge_legs": len(hedges),
        "target_put_delta": put_delta,
        "target_call_delta": call_delta,
        "notes": notes,
        "risk_reasons": risk_reasons,
    }
