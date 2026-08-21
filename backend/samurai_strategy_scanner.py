"""Shared Yahoo-chain scanner for the standard strategies missing from legacy screens.

The specialized scanners remain responsible for the app's established trades.
This module covers the conventional single-leg, vertical, volatility, calendar,
diagonal, collar, ratio, and long-butterfly structures so the General Option
Scanner can expose the complete strategy menu without placeholder results.
"""

from __future__ import annotations

from datetime import date, datetime
import math
from statistics import NormalDist

from options_api import _fetch_chain, _fetch_expirations, _fetch_quote
from options_pricing import black_scholes


SUPPORTED = {
    "naked-call", "long-call", "long-put", "married-put", "married-call",
    "bull-call-spread", "long-straddle", "long-strangle", "short-straddle",
    "short-strangle", "call-butterfly", "put-butterfly",
    "long-call-calendar", "long-put-calendar", "long-call-diagonal",
    "long-put-diagonal", "collar", "call-ratio-spread", "put-ratio-spread",
}

CALENDAR_KINDS = {
    "long-call-calendar", "long-put-calendar",
    "long-call-diagonal", "long-put-diagonal",
}


def _num(value, default=None):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _tickers(raw) -> list[str]:
    if isinstance(raw, str):
        raw = raw.replace(";", ",").replace(" ", ",").split(",")
    result, seen = [], set()
    for value in raw or []:
        ticker = str(value or "").strip().upper()
        if ticker and ticker not in seen:
            seen.add(ticker)
            result.append(ticker)
    return result[:200]


def _dte(expiration: str) -> int:
    try:
        return (datetime.strptime(expiration, "%Y-%m-%d").date() - date.today()).days
    except (TypeError, ValueError):
        return -1


def _expirations(ticker: str, minimum: int, maximum: int, target: int, limit: int = 3) -> list[str]:
    candidates = [
        expiration for expiration in _fetch_expirations(ticker)
        if minimum <= _dte(expiration) <= maximum
    ]
    return sorted(candidates, key=lambda expiration: (abs(_dte(expiration) - target), _dte(expiration)))[:limit]


def _contracts(chain: dict, option_type: str) -> list[dict]:
    values = chain.get("calls" if option_type == "call" else "puts") or []
    return sorted([
        contract for contract in values
        if _num(contract.get("strike"), 0) > 0
        and max(_num(contract.get("bid"), 0), _num(contract.get("ask"), 0), _num(contract.get("last"), 0)) > 0
    ], key=lambda contract: contract["strike"])


def _nearest(contracts: list[dict], strike: float, *, above=None, below=None) -> dict | None:
    eligible = [contract for contract in contracts
                if (above is None or contract["strike"] > above)
                and (below is None or contract["strike"] < below)]
    return min(eligible, key=lambda contract: abs(contract["strike"] - strike)) if eligible else None


def _nearest_delta(contracts: list[dict], target: float, *, above=None, below=None) -> dict | None:
    eligible = [contract for contract in contracts
                if (above is None or contract["strike"] > above)
                and (below is None or contract["strike"] < below)]
    with_delta = [contract for contract in eligible if _num(contract.get("delta")) is not None]
    if with_delta:
        return min(with_delta, key=lambda contract: abs(abs(_num(contract.get("delta"), 0)) - target))
    return None


def _common_atm(calls: list[dict], puts: list[dict], spot: float) -> tuple[dict, dict] | None:
    call_by_strike = {contract["strike"]: contract for contract in calls}
    put_by_strike = {contract["strike"]: contract for contract in puts}
    common = set(call_by_strike).intersection(put_by_strike)
    if not common:
        return None
    strike = min(common, key=lambda value: abs(value - spot))
    return call_by_strike[strike], put_by_strike[strike]


def _balanced_triplet(contracts: list[dict], spot: float, low_pct: float, high_pct: float) -> tuple[dict, dict, dict] | None:
    low_price = spot * (1.0 + low_pct / 100.0)
    high_price = spot * (1.0 + high_pct / 100.0)
    eligible = [contract for contract in contracts if low_price <= contract["strike"] <= high_price]
    if len(eligible) < 3:
        eligible = contracts
    if len(eligible) < 3:
        return None
    center_target = spot * (1.0 + (low_pct + high_pct) / 200.0)
    best = None
    for left_index in range(len(eligible) - 2):
        for body_index in range(left_index + 1, min(len(eligible) - 1, left_index + 7)):
            for right_index in range(body_index + 1, min(len(eligible), body_index + 7)):
                left, body, right = eligible[left_index], eligible[body_index], eligible[right_index]
                lower_width = body["strike"] - left["strike"]
                upper_width = right["strike"] - body["strike"]
                tolerance = max(0.01, max(lower_width, upper_width) * 0.02)
                if abs(lower_width - upper_width) > tolerance:
                    continue
                score = abs(body["strike"] - center_target) + abs(lower_width - upper_width) * 10
                if best is None or score < best[0]:
                    best = (score, left, body, right)
    return best[1:] if best else None


def _fill(contract: dict, quantity: int, pricing: str) -> float:
    bid = _num(contract.get("bid"), 0)
    ask = _num(contract.get("ask"), 0)
    mid = _num(contract.get("mid"), None)
    if mid is None:
        mid = (bid + ask) / 2.0 if bid and ask else _num(contract.get("last"), 0)
    natural = ask if quantity > 0 else bid
    if not natural:
        natural = mid
    if pricing == "Mid":
        return max(0.0, mid)
    if pricing == "25% price improvement":
        return max(0.0, natural + 0.25 * (mid - natural))
    return max(0.0, natural)


def _leg(contract: dict, option_type: str, quantity: int, expiration: str, pricing: str) -> dict:
    fill = _fill(contract, quantity, pricing)
    return {
        "option_type": option_type,
        "qty": int(quantity),
        "expiration": expiration,
        "strike": _num(contract.get("strike"), 0),
        "bid": _num(contract.get("bid"), 0),
        "ask": _num(contract.get("ask"), 0),
        "mid": _num(contract.get("mid"), fill),
        "entry_price": fill,
        "last": _num(contract.get("last"), 0),
        "iv": max(0.0001, _num(contract.get("iv"), 0.2)),
        "delta": _num(contract.get("delta"), 0),
        "open_interest": int(_num(contract.get("open_interest"), 0)),
        "volume": int(_num(contract.get("volume"), 0)),
        "quote_source": "live_bid_ask" if _num(contract.get("bid"), 0) and _num(contract.get("ask"), 0) else "recent_trade",
    }


def _stock(quantity: int, spot: float) -> dict:
    return {
        "option_type": "stock", "qty": int(quantity), "strike": 0,
        "expiration": "", "entry_price": spot, "mid": spot, "delta": 1,
        "iv": None, "quote_source": "underlying_quote",
    }


def _same_expiration_legs(kind: str, chain: dict, payload: dict) -> list[dict] | None:
    spot = _num(chain.get("spot"), 0)
    expiration = chain["expiration"]
    pricing = str(payload.get("bid_ask_level") or "Mid")
    calls, puts = _contracts(chain, "call"), _contracts(chain, "put")
    low_pct = _num(payload.get("min_moneyness_pct"), -15)
    high_pct = _num(payload.get("max_moneyness_pct"), 15)
    center_pct = (low_pct + high_pct) / 2.0
    center = spot * (1.0 + center_pct / 100.0)
    width_pct = max(2.0, min(10.0, abs(high_pct - low_pct) / 3.0 or 5.0))
    reference_mode = str(payload.get("reference_delta_mode") or "none").strip().lower()
    target_delta = _num(payload.get("target_reference_delta"))

    def call(target, qty=1, delta_target=None, **bounds):
        contract = _nearest_delta(calls, delta_target, **bounds) if delta_target is not None else None
        contract = contract or _nearest(calls, target, **bounds)
        return _leg(contract, "call", qty, expiration, pricing) if contract else None

    def put(target, qty=1, delta_target=None, **bounds):
        contract = _nearest_delta(puts, delta_target, **bounds) if delta_target is not None else None
        contract = contract or _nearest(puts, target, **bounds)
        return _leg(contract, "put", qty, expiration, pricing) if contract else None

    if kind == "naked-call":
        legs = [call(center, -1, delta_target=target_delta if reference_mode == "short" else None)]
    elif kind == "long-call":
        legs = [call(center, 1, delta_target=target_delta if reference_mode == "long" else None)]
    elif kind == "long-put":
        legs = [put(center, 1, delta_target=target_delta if reference_mode == "long" else None)]
    elif kind == "married-put":
        legs = [_stock(100, spot), put(spot * (1.0 + min(-2.0, center_pct) / 100.0), 1,
                                       delta_target=target_delta if reference_mode == "long" else None)]
    elif kind == "married-call":
        legs = [_stock(-100, spot), call(spot * (1.0 + max(2.0, center_pct) / 100.0), 1,
                                        delta_target=target_delta if reference_mode == "long" else None)]
    elif kind == "bull-call-spread":
        long_leg = call(spot * (1.0 + min(0.0, center_pct) / 100.0), 1,
                        delta_target=target_delta if reference_mode == "long" else None)
        short_leg = call(spot * (1.0 + max(3.0, center_pct + width_pct) / 100.0), -1,
                         above=long_leg["strike"] if long_leg else None)
        legs = [long_leg, short_leg]
    elif kind in {"long-straddle", "short-straddle"}:
        pair = _common_atm(calls, puts, spot)
        if not pair:
            return None
        quantity = 1 if kind == "long-straddle" else -1
        legs = [_leg(pair[0], "call", quantity, expiration, pricing), _leg(pair[1], "put", quantity, expiration, pricing)]
    elif kind in {"long-strangle", "short-strangle"}:
        quantity = 1 if kind == "long-strangle" else -1
        short_target = target_delta if kind == "short-strangle" and reference_mode == "short" else None
        legs = [
            put(spot * 0.95, quantity, below=spot, delta_target=short_target),
            call(spot * 1.05, quantity, above=spot, delta_target=short_target),
        ]
    elif kind in {"call-butterfly", "put-butterfly"}:
        option_type = "call" if kind == "call-butterfly" else "put"
        triplet = _balanced_triplet(calls if option_type == "call" else puts, spot, low_pct, high_pct)
        if not triplet:
            return None
        legs = [
            _leg(triplet[0], option_type, 1, expiration, pricing),
            _leg(triplet[1], option_type, -2, expiration, pricing),
            _leg(triplet[2], option_type, 1, expiration, pricing),
        ]
    elif kind == "collar":
        legs = [_stock(100, spot), put(spot * 0.95, 1, below=spot),
                call(spot * 1.05, -1, above=spot,
                     delta_target=target_delta if reference_mode == "short" else None)]
    elif kind == "call-ratio-spread":
        long_leg = call(spot, 1)
        short_leg = call(spot * 1.05, -2, above=long_leg["strike"] if long_leg else None,
                         delta_target=target_delta if reference_mode == "short" else None)
        legs = [long_leg, short_leg]
    elif kind == "put-ratio-spread":
        long_leg = put(spot, 1)
        short_leg = put(spot * 0.95, -2, below=long_leg["strike"] if long_leg else None,
                        delta_target=target_delta if reference_mode == "short" else None)
        legs = [long_leg, short_leg]
    else:
        return None
    return legs if legs and all(legs) else None


def _calendar_legs(kind: str, near_chain: dict, far_chain: dict, payload: dict) -> list[dict] | None:
    option_type = "call" if "call" in kind else "put"
    diagonal = "diagonal" in kind
    pricing = str(payload.get("bid_ask_level") or "Mid")
    spot = _num(near_chain.get("spot"), 0)
    near_contracts = _contracts(near_chain, option_type)
    far_contracts = _contracts(far_chain, option_type)
    reference_mode = str(payload.get("reference_delta_mode") or "none").strip().lower()
    target_delta = _num(payload.get("target_reference_delta"))
    if not near_contracts or not far_contracts:
        return None
    if diagonal:
        if option_type == "call":
            far_contract = _nearest(far_contracts, spot * 0.98)
            near_contract = _nearest(near_contracts, spot * 1.05, above=far_contract["strike"] if far_contract else None)
        else:
            far_contract = _nearest(far_contracts, spot * 1.02)
            near_contract = _nearest(near_contracts, spot * 0.95, below=far_contract["strike"] if far_contract else None)
    else:
        near_by_strike = {contract["strike"]: contract for contract in near_contracts}
        far_by_strike = {contract["strike"]: contract for contract in far_contracts}
        common = set(near_by_strike).intersection(far_by_strike)
        if not common:
            return None
        strike = min(common, key=lambda value: abs(value - spot))
        near_contract, far_contract = near_by_strike[strike], far_by_strike[strike]
    if target_delta is not None and reference_mode == "short":
        targeted_near = _nearest_delta(near_contracts, target_delta)
        if targeted_near is not None:
            near_contract = targeted_near
            if not diagonal:
                far_contract = _nearest(far_contracts, near_contract["strike"])
    elif target_delta is not None and reference_mode == "long":
        targeted_far = _nearest_delta(far_contracts, target_delta)
        if targeted_far is not None:
            far_contract = targeted_far
            if not diagonal:
                near_contract = _nearest(near_contracts, far_contract["strike"])
    if not near_contract or not far_contract:
        return None
    return [
        _leg(near_contract, option_type, -1, near_chain["expiration"], pricing),
        _leg(far_contract, option_type, 1, far_chain["expiration"], pricing),
    ]


def _option_value(leg: dict, underlying: float, evaluation: date) -> float:
    option_type = leg["option_type"]
    strike = leg["strike"]
    expiration = datetime.strptime(leg["expiration"], "%Y-%m-%d").date()
    remaining = max(0, (expiration - evaluation).days) / 365.0
    if remaining <= 0:
        return max(underlying - strike, 0.0) if option_type == "call" else max(strike - underlying, 0.0)
    return black_scholes(
        max(0.01, underlying), strike, remaining, 0.0375, 0.0,
        max(0.0001, _num(leg.get("iv"), 0.2)), option_type,
    )["price"]


def _payoff(legs: list[dict], spot: float, underlying: float, evaluation: date) -> float:
    result = 0.0
    for leg in legs:
        quantity = int(leg["qty"])
        if leg["option_type"] == "stock":
            result += quantity * (underlying - spot)
        else:
            result += quantity * (_option_value(leg, underlying, evaluation) - leg["entry_price"]) * 100.0
    return result


def _profile(legs: list[dict], spot: float, evaluation_expiration: str, atm_iv: float) -> dict:
    evaluation = datetime.strptime(evaluation_expiration, "%Y-%m-%d").date()
    dte = max(1, (evaluation - date.today()).days)
    grid = [spot * index / 100.0 * 2.5 for index in range(101)]
    payoffs = [_payoff(legs, spot, value, evaluation) for value in grid]
    high_slope = sum(leg["qty"] for leg in legs if leg["option_type"] == "call") * 100
    high_slope += sum(leg["qty"] for leg in legs if leg["option_type"] == "stock")
    max_profit = None if high_slope > 0 else max(payoffs)
    max_loss = None if high_slope < 0 else max(0.0, -min(payoffs))
    normal = NormalDist()
    sigma = max(0.05, atm_iv or 0.25)
    horizon = dte / 365.0
    simulations = []
    for index in range(160):
        probability = (index + 0.5) / 160.0
        z_score = normal.inv_cdf(probability)
        terminal = spot * math.exp((0.0375 - 0.5 * sigma * sigma) * horizon + sigma * math.sqrt(horizon) * z_score)
        simulations.append(_payoff(legs, spot, terminal, evaluation))
    expected = sum(simulations) / len(simulations)
    probability_profit = sum(value > 0 for value in simulations) / len(simulations) * 100.0
    if max_profit is None:
        probability_max_profit = None
    else:
        profit_cutoff = max_profit - max(1.0, abs(max_profit) * 0.02)
        probability_max_profit = sum(value >= profit_cutoff for value in simulations) / len(simulations) * 100.0
    if max_loss is None:
        probability_max_loss = None
    elif max_loss <= 0:
        probability_max_loss = 0.0
    else:
        loss_cutoff = -max_loss + max(1.0, max_loss * 0.02)
        probability_max_loss = sum(value <= loss_cutoff for value in simulations) / len(simulations) * 100.0
    return {
        "max_profit_dollars": round(max_profit, 2) if max_profit is not None else None,
        "max_loss_dollars": round(max_loss, 2) if max_loss is not None else None,
        "max_profit_unbounded": high_slope > 0,
        "max_loss_unbounded": high_slope < 0,
        "expected_value_dollars": round(expected, 2),
        "probability_profit": round(probability_profit, 2),
        "prob_max_profit": round(probability_max_profit, 2) if probability_max_profit is not None else None,
        "prob_max_loss": round(probability_max_loss, 2) if probability_max_loss is not None else None,
        "lower_tail_dollars": round(payoffs[0], 2),
        "upper_tail_dollars": round(payoffs[-1], 2),
    }


def _row(kind: str, ticker: str, quote: dict, chains: list[dict], legs: list[dict]) -> dict:
    spot = _num(chains[0].get("spot"), _num(quote.get("last"), 0))
    evaluation_expiration = min(leg["expiration"] for leg in legs if leg["option_type"] != "stock")
    option_legs = [leg for leg in legs if leg["option_type"] != "stock"]
    atm_leg = min(option_legs, key=lambda leg: abs(leg["strike"] - spot))
    atm_iv = _num(atm_leg.get("iv"), 0.25)
    profile = _profile(legs, spot, evaluation_expiration, atm_iv)
    max_profit = profile["max_profit_dollars"]
    max_loss = profile["max_loss_dollars"]
    ratio = abs(max_profit / max_loss) * 100.0 if max_profit is not None and max_loss not in (None, 0) else None
    entry_cashflow = -sum(leg["qty"] * leg["entry_price"] * 100.0 for leg in option_legs)
    return {
        "ticker": ticker,
        "name": quote.get("name") or quote.get("short_name"),
        "price": round(spot, 4),
        "expiration": evaluation_expiration,
        "dte": _dte(evaluation_expiration),
        "legs": legs,
        "reference_strike": atm_leg["strike"],
        "atm_iv": atm_iv,
        "total_option_volume": sum(sum(int(_num(contract.get("volume"), 0)) for contract in (chain.get("calls") or []) + (chain.get("puts") or [])) for chain in chains),
        "position_delta": round(sum(leg["qty"] * _num(leg.get("delta"), 0) * (1 if leg["option_type"] == "stock" else 100) for leg in legs), 2),
        "entry_cashflow": round(entry_cashflow, 2),
        "profit_ratio_pct": round(ratio, 2) if ratio is not None else None,
        "strategy_kind": kind,
        **profile,
    }


def run_samurai_strategy_scan(payload: dict) -> dict:
    kind = str(payload.get("generic_strategy") or payload.get("strategy") or "").strip().lower()
    if kind not in SUPPORTED:
        raise ValueError(f"Unsupported shared strategy: {kind}")
    tickers = _tickers(payload.get("tickers") or payload.get("symbols")) or ["SPY", "QQQ", "IWM"]
    minimum_dte = max(0, int(_num(payload.get("min_dte"), 7)))
    maximum_dte = max(minimum_dte, int(_num(payload.get("max_dte"), 60)))
    target_dte = max(minimum_dte, int(_num(payload.get("target_dte"), 30)))
    rows, unavailable = [], []
    chains_priced = 0
    for ticker in tickers:
        try:
            quote = _fetch_quote(ticker)
            near_expirations = _expirations(ticker, minimum_dte, maximum_dte, target_dte, 2)
            if not near_expirations:
                unavailable.append({"ticker": ticker, "reason": "No expiration in the requested DTE range"})
                continue
            if kind in CALENDAR_KINDS:
                all_expirations = _fetch_expirations(ticker)
                gap = int(_num(payload.get("min_expiration_gap_days"), 21))
                far_target = int(_num(payload.get("far_target_dte"), target_dte + 35))
                for near_expiration in near_expirations:
                    near_dte = _dte(near_expiration)
                    far_choices = [expiration for expiration in all_expirations if _dte(expiration) >= near_dte + gap]
                    if not far_choices:
                        continue
                    far_expiration = min(far_choices, key=lambda expiration: abs(_dte(expiration) - far_target))
                    near_chain = _fetch_chain(ticker, near_expiration)
                    far_chain = _fetch_chain(ticker, far_expiration)
                    chains_priced += 2
                    legs = _calendar_legs(kind, near_chain, far_chain, payload)
                    if legs:
                        rows.append(_row(kind, ticker, quote, [near_chain, far_chain], legs))
            else:
                for expiration in near_expirations:
                    chain = _fetch_chain(ticker, expiration)
                    chains_priced += 1
                    legs = _same_expiration_legs(kind, chain, payload)
                    if legs:
                        rows.append(_row(kind, ticker, quote, [chain], legs))
        except Exception as exc:
            unavailable.append({"ticker": ticker, "reason": str(exc)})
    rows.sort(key=lambda row: (-(row.get("expected_value_dollars") or -1e12), -(row.get("prob_max_profit") or 0)))
    return {
        "rows": rows,
        "stats": {"universe": len(tickers), "chains_fetched": chains_priced, "final": len(rows)},
        "unavailable": unavailable,
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }
