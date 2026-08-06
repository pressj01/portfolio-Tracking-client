"""Tests for the directional, ratio'd and hedged iron condor variants.

The centre of gravity here is `analyze_structure`. Once contract counts differ
per side, the balanced screen's ``max(wing) - credit`` shortcut is not merely
imprecise, it is wrong by the ratio — and wrong in the flattering direction. The
first two tests pin that down with numbers that can be checked by hand.
"""

from __future__ import annotations

import pytest

import iron_condor_scanner as scanner
from iron_condor_variants import (
    analyze_structure,
    build_structure,
    early_close_exits,
    payoff_at,
    resolve_variants,
    riskier_side,
    tilted_deltas,
    _neutral_ratio,
)
from options_pricing import black_scholes

SPOT, DTE, RATE, DIV = 100.0, 45, 0.04, 0.0
YEARS = DTE / 365.0


def leg(option_type, strike, qty, mid, delta=None):
    return {
        "option_type": option_type, "strike": strike, "qty": qty, "mid": mid,
        "bid": mid - 0.05, "ask": mid + 0.05, "iv": 0.25, "delta": delta,
        "open_interest": 500, "volume": 100,
    }


@pytest.fixture
def chain():
    """A synthetic chain with a realistic equity put-skew smile."""
    def build(option_type):
        out = []
        for strike in range(60, 141):
            strike = float(strike)
            iv = max(0.10, min(0.70, 0.24 - 0.35 * ((strike - SPOT) / SPOT)))
            greeks = black_scholes(SPOT, strike, YEARS, RATE, DIV, iv, option_type)
            if greeks["price"] < 0.02:
                continue
            out.append({
                "strike": strike, "mid": round(greeks["price"], 2),
                "bid": round(max(0.01, greeks["price"] - 0.03), 2),
                "ask": round(greeks["price"] + 0.03, 2),
                "iv": iv, "delta": greeks["delta"],
                "open_interest": 800, "volume": 200,
                "quote_source": "live_bid_ask",
            })
        return out

    puts = [q for q in build("put") if q["strike"] < SPOT * 1.03]
    calls = [q for q in build("call") if q["strike"] > SPOT * 0.97]
    return puts, calls


def chain_for_dte(dte):
    years = dte / 365.0

    def build(option_type):
        rows = []
        for strike in range(40, 161):
            priced = black_scholes(SPOT, float(strike), years, RATE, DIV, 0.25, option_type)
            if priced["price"] < 0.01:
                continue
            rows.append({
                "strike": float(strike),
                "mid": priced["price"],
                "bid": max(0.01, priced["price"] - 0.02),
                "ask": priced["price"] + 0.02,
                "iv": 0.25,
                "delta": priced["delta"],
                "open_interest": 800,
                "volume": 200,
                "quote_source": "live_bid_ask",
            })
        return rows

    return build("put"), build("call")


TECH = {"range_position_pct": 55.0, "drift_sigma": 0.4, "drift_direction": "up"}


# ---------------------------------------------------------------------------
# Payoff analysis
# ---------------------------------------------------------------------------

def test_balanced_condor_matches_the_closed_form():
    """A 1x symmetric condor must agree with ``max(wing) - credit`` exactly."""
    legs = [
        leg("put", 85, +1, 0.50), leg("put", 90, -1, 1.50),
        leg("call", 110, -1, 1.50), leg("call", 115, +1, 0.50),
    ]
    result = analyze_structure(legs)
    assert result["entry_cashflow"] == pytest.approx(2.00)
    assert result["max_profit"] == pytest.approx(2.00)
    assert result["max_loss"] == pytest.approx(3.00)     # 5 wide - 2.00 credit
    assert result["lower_breakeven"] == pytest.approx(88.00)
    assert result["upper_breakeven"] == pytest.approx(112.00)


def test_ratio_max_loss_scales_with_the_heavy_side():
    """The regression this whole module exists to prevent.

    Three put spreads against one call spread. The naive reading — the wider
    wing minus the credit — gives 5 - 4 = $1.00. The truth is 3 x 5 - 4 =
    $11.00, eleven times larger, and the breakeven moves too because the
    position loses three points per point below the short strike.
    """
    legs = [
        leg("put", 85, +3, 0.50), leg("put", 90, -3, 1.50),
        leg("call", 110, -1, 1.50), leg("call", 115, +1, 0.50),
    ]
    result = analyze_structure(legs)
    assert result["entry_cashflow"] == pytest.approx(4.00)
    assert result["max_loss"] == pytest.approx(11.00)
    assert result["max_loss"] != pytest.approx(1.00)
    assert result["lower_breakeven"] == pytest.approx(90 - 4 / 3)
    assert result["upper_breakeven"] == pytest.approx(114.00)


def test_unbounded_risk_is_refused():
    """More shorts than longs on a side is a naked position, not a condor."""
    legs = [
        leg("put", 85, +1, 0.50), leg("put", 90, -3, 1.50),
        leg("call", 110, -1, 1.50), leg("call", 115, +1, 0.50),
    ]
    assert analyze_structure(legs) is None


def test_breakevens_keep_full_precision():
    """Breakevens are sized against, so they must not pick up display rounding."""
    legs = [
        leg("put", 85, +3, 0.50), leg("put", 90, -3, 1.50),
        leg("call", 110, -1, 1.50), leg("call", 115, +1, 0.50),
    ]
    result = analyze_structure(legs)
    assert result["lower_breakeven"] == pytest.approx(88.6666666, abs=1e-6)


def test_debit_variant_reports_entry_and_payoff_metrics_without_calling_it_credit():
    """A debit is an entry cost; max profit/span is a separate payoff fact."""
    legs = [
        leg("put", 85, -1, 0.50), leg("put", 90, +1, 1.50),
        leg("call", 110, +1, 1.50), leg("call", 115, -1, 0.50),
    ]
    for item, role in zip(legs, ("put_long", "put_short", "call_short", "call_long")):
        item["role"] = role
        item["quote_source"] = "live_bid_ask"
    built = {
        "variant": "jeep", "direction": "neutral", "legs": legs,
        "put_long_strike": 85.0, "put_short_strike": 90.0,
        "call_short_strike": 110.0, "call_long_strike": 115.0,
        "put_quantity": 1, "call_quantity": 1,
    }
    analysis = analyze_structure(legs)
    metrics = scanner._structure_metrics(
        built, analysis, SPOT, DTE, DIV, 0.20, "2026-09-18", 0.20,
    )

    assert metrics["entry_cashflow"] == pytest.approx(-2.0)
    assert metrics["entry_debit"] == pytest.approx(2.0)
    assert metrics["entry_credit"] == pytest.approx(0.0)
    assert metrics["credit_pct_of_width"] is None
    assert metrics["max_profit_pct_of_range"] == pytest.approx(60.0)
    assert metrics["entry_debit_pct_of_max_loss"] == pytest.approx(100.0)
    assert metrics["put_leg_short"]["strike"] == 90.0
    assert metrics["lower_cushion_pct"] is not None
    assert metrics["upper_cushion_pct"] is not None
    schedule = scanner.profit_probability_schedule(
        spot=SPOT,
        dte=DTE,
        expiration="2026-09-18",
        distribution_iv=0.20,
        entry_cashflow=metrics["entry_cashflow"],
        legs=[
            {
                "option_type": item["option_type"],
                "strike": item["strike"],
                "iv": item["iv"],
                "quantity": item["qty"],
            }
            for item in legs
        ],
        risk_free_rate=scanner.RISK_FREE,
        dividend_yield=DIV,
    )
    expiration = next(point for point in schedule if point["kind"] == "expiration")
    assert metrics["prob_profit"] == pytest.approx(
        expiration["probability_success_pct"], abs=0.11,
    )


def test_recent_trade_variant_never_invents_a_natural_fill():
    legs = [
        leg("put", 85, +1, 0.50), leg("put", 90, -1, 1.50),
        leg("call", 110, -1, 1.50), leg("call", 115, +1, 0.50),
    ]
    for item, role in zip(legs, ("put_long", "put_short", "call_short", "call_long")):
        item["role"] = role
        item["quote_source"] = "last_trade_estimate"
    built = {
        "variant": "strike_tilt", "direction": "bullish", "legs": legs,
        "put_long_strike": 85.0, "put_short_strike": 90.0,
        "call_short_strike": 110.0, "call_long_strike": 115.0,
        "put_quantity": 1, "call_quantity": 1,
    }
    metrics = scanner._structure_metrics(
        built, analyze_structure(legs), SPOT, DTE, DIV, 0.20,
        "2026-09-18", 0.20,
    )

    assert metrics["uses_last_trade_prices"] is True
    assert metrics["quote_source"] == "last_trade_estimate"
    assert metrics["natural_cashflow"] is None
    assert metrics["exec_cost"] is None
    assert metrics["constraints_relaxed"] is True


# ---------------------------------------------------------------------------
# Directional tilt
# ---------------------------------------------------------------------------

def test_bullish_tilt_raises_the_put_delta():
    """Severson's rule, which reads backwards until you see why.

    Bullish sells the *put* closer to the money and pushes the call away, so
    the structure moves up with the price it expects. Appendix B: "if we're
    expecting an uptrend continuation, we'll select a .35 to .40 Delta for the
    short put strike, and a .25 Delta for the short call strike."
    """
    put_delta, call_delta = tilted_deltas(0.30, "bullish")
    assert put_delta > call_delta
    assert put_delta == pytest.approx(0.375)
    assert call_delta == pytest.approx(0.225)

    put_delta, call_delta = tilted_deltas(0.30, "bearish")
    assert call_delta > put_delta

    assert tilted_deltas(0.30, "neutral") == (0.30, 0.30)


def test_bullish_structure_sits_above_bearish(chain):
    puts, calls = chain
    bull = build_structure("strike_tilt", "bullish", puts, calls, SPOT, TECH)
    bear = build_structure("strike_tilt", "bearish", puts, calls, SPOT, TECH)
    assert bull["put_short_strike"] > bear["put_short_strike"]
    assert bull["call_short_strike"] > bear["call_short_strike"]


def test_variant_short_and_long_deltas_move_farther_with_dte():
    near_puts, near_calls = chain_for_dte(30)
    far_puts, far_calls = chain_for_dte(120)
    near = build_structure("risk_ratio", "neutral", near_puts, near_calls, SPOT, TECH)
    far = build_structure("risk_ratio", "neutral", far_puts, far_calls, SPOT, TECH)

    assert far["put_short_strike"] < near["put_short_strike"]
    assert far["put_long_strike"] < near["put_long_strike"]
    assert far["call_short_strike"] > near["call_short_strike"]
    assert far["call_long_strike"] > near["call_long_strike"]


def test_ratio_tilt_puts_less_size_where_price_is_heading(chain):
    puts, calls = chain
    bull = build_structure("ratio_tilt", "bullish", puts, calls, SPOT, TECH)
    assert bull["put_quantity"] > bull["call_quantity"]
    bear = build_structure("ratio_tilt", "bearish", puts, calls, SPOT, TECH)
    assert bear["call_quantity"] > bear["put_quantity"]


def test_riskier_side_follows_the_stated_view():
    side, reasons = riskier_side("bullish", TECH, None, None)
    assert side == "call"
    assert reasons
    side, _ = riskier_side("bearish", TECH, None, None)
    assert side == "put"


# ---------------------------------------------------------------------------
# Weirdor and Jeep
# ---------------------------------------------------------------------------

def test_weirdor_is_downside_heavy(chain):
    """The reference RUT Weirdor is 20 put spreads against 4 call spreads."""
    puts, calls = chain
    built = build_structure("weirdor_ratio", "neutral", puts, calls, SPOT, TECH)
    assert built["put_quantity"] > built["call_quantity"]


def test_weirdor_wings_are_the_same_width(chain):
    """Both wings 20 points on the reference position; only the ratio differs.

    Its stated max margin of $36,160 only reconciles as 20 x 20 x 100 less the
    credit, which requires the put wing to be the same 20 wide as the call wing.
    """
    puts, calls = chain
    built = build_structure("weirdor_ratio", "neutral", puts, calls, SPOT, TECH)
    put_width = built["put_short_strike"] - built["put_long_strike"]
    call_width = built["call_long_strike"] - built["call_short_strike"]
    assert put_width == pytest.approx(call_width, rel=0.35)


def test_neutral_ratio_solves_toward_flat_delta():
    put_qty, call_qty = _neutral_ratio(0.05, -0.14)
    assert put_qty > call_qty
    assert abs(put_qty * 0.05 + call_qty * -0.14) < 0.05


def test_jeep_has_a_front_debit_spread_and_a_raised_shelf(chain):
    """Six legs, the front spread in front, and a shelf above the base credit."""
    puts, calls = chain
    built = build_structure("jeep", "neutral", puts, calls, SPOT, TECH)
    assert len(built["legs"]) == 6
    front = built["front_debit"]
    assert front is not None
    # "The front part is a put debit spread" — it sits between the put credit
    # spread and the money, which is what lifts the shelf below the market.
    assert front["short_strike"] > built["put_short_strike"]
    assert front["long_strike"] > front["short_strike"]

    analysis = analyze_structure(built["legs"])
    cashflow = analysis["entry_cashflow"]
    shelf = payoff_at(built["legs"], cashflow,
                      (front["short_strike"] + built["put_short_strike"]) / 2)
    base = payoff_at(built["legs"], cashflow, SPOT)
    deep = payoff_at(built["legs"], cashflow, built["put_long_strike"] - 10)
    assert shelf > base, "the front debit spread must raise the shelf below the market"
    assert deep < base, "the downside must stay a real, capped loss"
    assert analysis["max_loss"] > 0


def test_jeep_front_spread_is_narrower_than_the_credit_wing(chain):
    """Equal widths would cancel below the lowest strike and fake a riskless bottom."""
    puts, calls = chain
    built = build_structure("jeep", "neutral", puts, calls, SPOT, TECH)
    front = built["front_debit"]
    front_width = front["long_strike"] - front["short_strike"]
    credit_width = built["put_short_strike"] - built["put_long_strike"]
    assert front_width < credit_width


def test_hedged_weirdor_carries_butterfly_legs(chain):
    puts, calls = chain
    built = build_structure("weirdor_hedged", "neutral", puts, calls, SPOT, TECH)
    assert built["hedge_legs"] > 0
    assert len(built["legs"]) > 4
    assert analyze_structure(built["legs"]) is not None


# ---------------------------------------------------------------------------
# Fan-out and exits
# ---------------------------------------------------------------------------

def test_every_variant_builds_and_is_defined_risk(chain):
    puts, calls = chain
    seen = set()
    for construction, direction in (("all", "bullish"), ("all", "bearish"), ("all", "neutral")):
        for variant, lean in resolve_variants(construction, direction):
            if (variant, lean) in seen:
                continue
            seen.add((variant, lean))
            if variant == "balanced":
                continue        # served by the original code path
            built = build_structure(variant, lean, puts, calls, SPOT, TECH)
            assert built, f"{variant}/{lean} failed to build"
            assert analyze_structure(built["legs"]), f"{variant}/{lean} is not defined risk"
    assert len(seen) >= 9


def test_neutral_scan_offers_no_tilted_constructions():
    """A tilt with no direction to tilt toward is the balanced condor with steps."""
    variants = dict(resolve_variants("all", "neutral"))
    assert "balanced" in variants
    assert "strike_tilt" not in variants
    assert "ratio_tilt" not in variants


def test_early_close_exits_land_inside_the_cycle():
    """Trades are closed at roughly half to two-thirds, not held to expiration."""
    points = early_close_exits(45)
    assert len(points) == 2
    assert [p["remaining_dte"] for p in points] == [23, 15]
    assert all(0 < p["remaining_dte"] < 45 for p in points)
    assert early_close_exits(1) == []
