"""Comparable, cost-aware selection metrics for short puts and put spreads."""
from datetime import date
import math

from option_probability import (expiration_payoff_profile, _terminal_price_cdf,
                                _capture_probabilities, _position_profit)
from options_pricing import black_scholes


SELECTION_DEFAULTS = {
    "bid_ask_level": "Conservative (use bid/ask values)",
    "commission_per_contract": 0.65,  # per side, editable
    "exit_slippage_per_contract": 1.0,  # dollars, editable
    # Each extra expiration is another chain request per ticker, and a broad
    # universe trips Yahoo's rate limiter long before it runs out of strikes.
    "expiration_candidates": 1,
    "ranking_mode": "probability",
    "require_live_quotes": True,
    "require_stabilization": False,
    "require_short_below_support": False,
    "max_assignment_dollars": None,
    "max_stress_loss_pct": None,
    "profit_target_pct": 50,
    "stop_loss_credit_multiple": 2,
}


def number(value, fallback=None):
    try:
        value = float(value)
        return value if math.isfinite(value) else fallback
    except (ValueError, TypeError):
        return fallback


def selection_settings(payload):
    return {**SELECTION_DEFAULTS, **(payload or {})}


def expiration_choices(expirations, target, minimum, maximum, count=3, cutoff=None):
    choices = []
    for expiration in expirations:
        try:
            expiry = date.fromisoformat(expiration)
        except (ValueError, TypeError):
            continue
        dte = (expiry - date.today()).days
        if max(1, minimum) <= dte <= maximum and (cutoff is None or expiry <= cutoff):
            choices.append((abs(dte - target), dte, expiration))
    return [item[2] for item in sorted(choices)[:max(1, min(5, int(number(count, 3))))]]


def price_leg(leg, quantity, settings):
    """Keep market mid separate from assumed fill and cost-adjusted entry."""
    bid, ask = number(leg.get("bid")), number(leg.get("ask"))
    live = bid is not None and ask is not None and 0 < bid <= ask
    if live:
        mid = (bid + ask) / 2
        natural = bid if quantity < 0 else ask
        mode = settings.get("bid_ask_level", "Mid")
        fraction = 0 if str(mode).startswith("Conservative") else 0.25 if mode == "25% price improvement" else 1
        fill = natural + fraction * (mid - natural)
    else:
        fill = number(leg.get("mid"))
    if fill is None:
        return None
    costs = 2 * max(0, number(settings.get("commission_per_contract"), 0))
    costs += max(0, number(settings.get("exit_slippage_per_contract"), 0))
    net_entry = fill + (costs / 100 if quantity > 0 else -costs / 100)
    return {**leg, "option_type": "put", "quantity": quantity,
            "entry_price": fill, "net_entry_price": net_entry,
            "estimated_costs_dollars": costs * abs(quantity),
            "quote_source": "live_bid_ask" if live else "last_trade_estimate"}


def income_metrics(legs, spot, dte, expiration, settings, rate=0.0375, dividend_yield=0):
    """All money is per one contract/one spread; probabilities are model estimates."""
    modeled = [{**leg, "expiration": expiration, "entry_price": leg["net_entry_price"]} for leg in legs]
    credit = -sum(leg["quantity"] * leg["net_entry_price"] for leg in legs)
    short = next(leg for leg in legs if leg["quantity"] < 0)
    ivs = [number(leg.get("iv")) for leg in legs]
    iv = sum(ivs) / len(ivs) if all(value is not None and value > 0 for value in ivs) else None
    profile = expiration_payoff_profile(modeled, spot, dte, iv, rate, dividend_yield)
    breakeven = short["strike"] - credit
    success = None
    if iv and dte > 0 and credit > 0:
        success = 100 * (1 - _terminal_price_cdf(
            breakeven, spot=spot, years=dte / 365, volatility=iv,
            risk_free_rate=rate, dividend_yield=dividend_yield))
    capital = short["strike"] * 100 if len(legs) == 1 else profile["max_loss"]
    expected = profile["expected_value"]
    stress = None
    if iv and dte > 0:
        # Mark the position after a 10% decline and a 25% IV increase in one day.
        pnl = credit
        for leg in legs:
            mark = black_scholes(spot * 0.9, leg["strike"], max(0, dte - 1) / 365,
                                rate, dividend_yield, leg["iv"] * 1.25, "put")["price"]
            pnl += leg["quantity"] * mark
        stress = pnl * 100
    return {
        "net_credit": credit, "breakeven": breakeven,
        "prob_profit": success, "prob_max_profit": profile["prob_max_profit"],
        "prob_max_loss": profile["prob_max_loss"],
        "expected_value_dollars": expected, "capital_required": capital,
        "expected_return_on_capital_pct": expected / capital * 100 if expected is not None and capital and capital > 0 else None,
        "stress_pnl_dollars": stress,
        "stress_loss_pct": max(0, -stress) / capital * 100 if stress is not None and capital and capital > 0 else None,
        "estimated_costs_dollars": sum(leg["estimated_costs_dollars"] for leg in legs),
        "max_profit_dollars": profile["max_profit"], "max_loss_dollars": profile["max_loss"],
        "distribution_iv": iv,
    }


def candidate_reasons(legs, metrics, settings):
    reasons = []
    if settings.get("require_live_quotes") and any(leg.get("quote_source") != "live_bid_ask" for leg in legs):
        reasons.append("Live quotes unavailable")
    for leg in legs:
        minimum = number(settings.get("min_open_interest"), 0)
        oi = number(leg.get("open_interest"))
        if minimum > 0 and (oi is None or oi < minimum):
            reasons.append("Open interest unavailable" if oi is None else "Open interest")
        maximum = number(settings.get("max_bid_ask_spread"))
        bid, ask = number(leg.get("bid")), number(leg.get("ask"))
        if maximum is not None and (bid is None or ask is None or bid <= 0 or ask < bid or ask - bid > maximum):
            reasons.append("Bid/ask spread")
        if leg["quantity"] < 0 and settings.get("reference_delta_mode") == "short":
            delta = number(leg.get("delta"))
            if delta is None or not settings.get("min_reference_delta", 0) <= abs(delta) * 100 <= settings.get("max_reference_delta", 100):
                reasons.append("Reference option delta")
        if leg["quantity"] < 0 and settings.get("require_short_below_support"):
            support = number(settings.get("support_price"))
            if support is None or leg["strike"] >= support:
                reasons.append("Short strike below support unavailable" if support is None else "Short strike above support")
    # Labels match the general scanner's so the two screens dedupe rather than
    # reporting the same broken rule twice under different names.
    for field, key, direction, label in (
        ("prob_profit", "min_prob_profit", "min", "Probability of any profit"),
        ("prob_max_profit", "min_prob_max_profit", "min", "Probability of max profit"),
        ("prob_max_loss", "max_prob_max_loss", "max", "Probability of max loss"),
        ("max_profit_dollars", "min_max_profit_dollars", "min", "Maximum profit"),
        ("max_loss_dollars", "max_max_loss_dollars", "max", "Maximum loss"),
        ("stress_loss_pct", "max_stress_loss_pct", "max", "Stress loss"),
    ):
        limit = number(settings.get(key))
        if limit is None or (direction == "min" and limit <= 0) or (field.startswith("prob_") and direction == "max" and limit >= 100):
            continue
        actual = number(metrics.get(field))
        if actual is None:
            reasons.append(f"{label} unavailable")
        elif (actual < limit if direction == "min" else actual > limit):
            reasons.append(label)
    if settings.get("require_positive_expected_value") and (number(metrics.get("expected_value_dollars"), -1) <= 0):
        reasons.append("Expected value")
    if len(legs) == 1:
        maximum = number(settings.get("max_assignment_dollars"))
        if maximum is not None and metrics["capital_required"] > maximum:
            reasons.append("Assignment budget")
    if metrics["net_credit"] <= 0:
        reasons.append("Credit does not cover estimated costs")
    return list(dict.fromkeys(reasons))


def selection_rank(metrics, settings):
    mode = settings.get("ranking_mode", "probability")
    key = {"probability": "prob_profit", "return_on_capital": "expected_return_on_capital_pct",
           "downside_risk": "stress_loss_pct", "expected_value": "expected_value_dollars"}.get(mode, "prob_profit")
    value = number(metrics.get(key))
    if value is None:
        value = -math.inf
    elif mode == "downside_risk":
        value = -value
    return (value, number(metrics.get("expected_return_on_capital_pct"), -math.inf))


def underlying_reasons(technicals, fund, settings, is_fund=False):
    reasons = []
    if settings.get("exclude_earnings_before_expiry") and not is_fund and not fund.get("next_earnings"):
        reasons.append("Earnings date unavailable")
    if settings.get("require_stabilization"):
        bounce, decel = number(technicals.get("bounce_off_low_pct")), number(technicals.get("decel_pp"))
        if bounce is None or decel is None or technicals.get("fresh_low") is None:
            reasons.append("Stabilization unavailable")
        elif technicals["fresh_low"] or bounce < 1 or decel <= 0:
            reasons.append("Decline has not stabilized")
    return reasons


def managed_probability(legs, metrics, spot, dte, settings, rate=0.0375, dividend_yield=0):
    """Profit target before a loss stop, monitored on the model's discrete grid."""
    credit = number(metrics.get("net_credit"))
    iv = number(metrics.get("distribution_iv"))
    if not credit or credit <= 0 or not iv or dte is None or dte <= 0:
        return None
    target = credit * min(100, max(1, number(settings.get("profit_target_pct"), 50))) / 100
    stop = credit * max(0.1, number(settings.get("stop_loss_credit_multiple"), 2))
    def profit_at_spot(exit_spot, remaining_years):
        return _position_profit(exit_spot, remaining_years, entry_spot=spot,
                                entry_cashflow=credit, legs=legs, risk_free_rate=rate,
                                dividend_yield=dividend_yield, underlying_quantity=0)
    result = _capture_probabilities(
        spot=spot, total_years=dte / 365, distribution_iv=iv, thresholds=[target],
        profit_at_spot=profit_at_spot, risk_free_rate=rate, dividend_yield=dividend_yield,
        horizon_years=[0], extra_spots=[leg["strike"] for leg in legs], stop_loss=stop)
    return {"probability_pct": 100 * result[target][0] if result is not None else None,
            "profit_target_dollars": target * 100, "loss_stop_dollars": stop * 100,
            "monitoring": "Discrete model time steps; fixed IV, no jumps or guaranteed stop fills",
            "costs_included": True}
