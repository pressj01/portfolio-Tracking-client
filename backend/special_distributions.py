"""One-off special distributions, recognized so they are never annualized.

A fund now and then pays a one-off amount far above its usual payout: a
year-end capital-gain distribution or a return of excess income, say $2.01
against a regular $0.14 a month. Received income keeps every special. A
forward estimate must not multiply one by the fund's cadence: averaged into
the last three payments and annualized x12, that single payment overstated
the fund's income about fivefold, and projections that compound it went wild.

The rules (chosen 2026-11-27):
- a special is a payment at least 3x the median of the fund's other recent
  payments;
- specials are left out of forward estimates (income, yields, projections);
- once a special has been paid, the per-share amount reverts to the last
  regular payment, while a declared, still-unpaid special stays the amount
  of the next payment.

A high payment next to another high payment is not a special: two or more
in a row are a level change (a fund that went from weekly to monthly, or
raised its payout), and the estimate has to follow it.
"""

from statistics import median

SPECIAL_MULTIPLE = 3.0
# The latest payments judged: about a year of a monthly payer, a quarter of a
# weekly one. Older payments never drive a forward estimate.
LOOKBACK = 13
# Fewer peers than this cannot say what is "usual".
MIN_PEERS = 4


def _amounts(values):
    out = []
    for value in values:
        try:
            number = float(value or 0)
        except (TypeError, ValueError):
            number = 0.0
        out.append(number if number == number else 0.0)
    return out


def special_flags(amounts, multiple=SPECIAL_MULTIPLE, lookback=LOOKBACK, min_peers=MIN_PEERS):
    """One boolean per amount (oldest first): True for a one-off special."""
    values = _amounts(amounts)
    flags = [False] * len(values)
    start = max(0, len(values) - lookback)
    window = values[start:]
    if len(window) < min_peers + 1:
        return flags
    high = []
    for i, value in enumerate(window):
        peers = [v for j, v in enumerate(window) if j != i and v > 0]
        typical = median(peers) if len(peers) >= min_peers else 0.0
        high.append(typical > 0 and value >= multiple * typical)
    for i, is_high in enumerate(high):
        if not is_high:
            continue
        if (i > 0 and high[i - 1]) or (i + 1 < len(high) and high[i + 1]):
            continue  # part of a run of high payments: a level change
        flags[start + i] = True
    return flags


def regular_amounts(amounts):
    """The amounts with one-off specials left out, in their original order."""
    values = _amounts(amounts)
    return [v for v, special in zip(values, special_flags(values)) if not special]


def declared_is_special(declared, history_amounts, multiple=SPECIAL_MULTIPLE,
                        lookback=LOOKBACK, min_peers=MIN_PEERS):
    """Whether a declared per-share amount is a special against the payment history.

    A declaration already recorded as the latest payment is judged as that
    payment; a new one (not in the history yet) against the regular payments
    before it.
    """
    try:
        declared = float(declared or 0)
    except (TypeError, ValueError):
        return False
    values = _amounts(history_amounts)
    if declared <= 0:
        return False
    if values and abs(values[-1] - declared) <= 1e-9:
        return special_flags(values, multiple, lookback, min_peers)[-1]
    regular = [v for v in regular_amounts(values) if v > 0][-(lookback - 1):]
    if len(regular) < min_peers:
        return False
    typical = median(regular)
    return typical > 0 and declared >= multiple * typical
