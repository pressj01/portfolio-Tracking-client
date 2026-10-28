"""Source-gated fund accounting and explicitly hypothetical reference comparisons.

The legacy price-loss score is deliberately not used by this service. Providers
must identify their NAV/share basis; unsupported securities remain in coverage.
"""
import calendar
import datetime as dt
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from .nav_assessment import CapitalObservation, assess, same_cash_reference
    from .nav_auto_guidance import infer_guidance, name_says_option_income, strategy_from_holdings
except ImportError:
    from nav_assessment import CapitalObservation, assess, same_cash_reference
    from nav_auto_guidance import infer_guidance, name_says_option_income, strategy_from_holdings

VERSION = "nav-assessment-v11-underlying"
VERDICT_LABELS = {
    "strong": "Strong NAV Erosion",
    "weak": "Weak NAV Erosion",
    "none": "No NAV Erosion",
    "insufficient": "Insufficient evidence",
}
REGISTRY = json.loads(Path(__file__).with_name("nav_reference_registry.json").read_text(encoding="utf-8"))
WINDOWS = {"1D": 0, "7D": 0, "1M": 1, "3M": 3, "6M": 6, "YTD": 0, "1Y": 12, "2Y": 24, "3Y": 36, "5Y": 60,
           "6Y": 72, "7Y": 84, "8Y": 96, "9Y": 108, "10Y": 120, "ALL": None, "CUSTOM": 0}
BAD_REFERENCES = {
    "GPTY": {"GOOG", "GOOGL"}, "XSPI": {"SPCX"},
    "SLJY": {"SLV"}, "TDAX": {"QQQ"},
}
SYMBOL = re.compile(r"^[A-Z0-9.^=\-]{1,20}$")


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def date(value):
    return dt.date.fromisoformat(str(value)[:10])


def window_start(as_of, window):
    if window == "CUSTOM":
        raise ValueError("Custom assessment requires an explicit start date")
    if window == "YTD":
        return dt.date(as_of.year, 1, 1)
    if window in {"1D", "7D"}:
        return as_of - dt.timedelta(days=1 if window == "1D" else 7)
    months = WINDOWS[window]
    if months is None:
        return dt.date(1900, 1, 1)
    year, month0 = divmod(as_of.year * 12 + as_of.month - 1 - months, 12)
    month = month0 + 1
    return dt.date(year, month, min(as_of.day, calendar.monthrange(year, month)[1]))


def manual_scope(info):
    """Include (manual): screen this holding against the user's own benchmark."""
    return str((info or {}).get("nav_erosion_scope") or "auto").strip().lower() == "test"


# The user's answer to "Does this fund sell call options?" for a fund whose
# strategy is not documented. Only call sellers can receive the covered-call
# eroder label; put sellers keep the capital/payout review.
STRATEGY_ANSWERS = {
    "calls": {"kind": "covered_call", "label": "Sells call options (your answer)",
              "reason": "You said this fund sells call options, so it is screened as a call-income fund."},
    "both": {"kind": "covered_call", "label": "Sells call and put options (your answer)",
             "reason": "You said this fund sells both calls and puts. Its call selling makes it eligible for the covered-call screen."},
    "puts": {"kind": "capital_review", "label": "Sells put options (your answer)",
             "reason": "You said this fund sells put options only. Put sellers get the capital, payout and reference review; "
                       "the covered-call eroder label applies only to call sellers."},
    "none": {"kind": "capital_review", "label": "No option selling (your answer)", "payout_driven_only": True,
             "reason": "You said this fund does not sell options. Lagging its reference alone is treated as relative "
                       "performance; it is flagged only when payouts also repeatedly exceeded the reference's return."},
}


def validate_strategy_answer(data):
    if not isinstance(data, dict):
        raise ValueError("The answer must be an object")
    answer = data.get("answer")
    if answer in (None, "", "unsure"):
        return None
    if answer not in STRATEGY_ANSWERS:
        raise ValueError("Answer calls, puts, both or none")
    return answer


def guidance(ticker, info):
    # Holdings outside the reviewed registry get guidance inferred from their
    # stored category, quote type and name instead of stopping at "needs
    # verification" (an account of ordinary index and bond funds).
    row = dict(REGISTRY.get(ticker) or infer_guidance(ticker, info) or {
        "family": "Security type needs verification", "suggestion": None,
        "source_url": None, "source_checked": None,
        "guidance": "Identify the security and verify its issuer objective before choosing a reference.",
        "limitations": "No automatic broad-market fallback is applied.",
        "suggested_direction": "No validated reference available",
    })
    family = row["family"]
    category = str(info.get("classification_type") or "").upper()
    row["security_kind"] = row.get("security_kind") or (
        "stock" if family == "Operating-company stock" else
        "bdc" if family == "Quarterly BDC NAV" or category == "BDC" else
        "reit" if family == "Quarterly mortgage REIT book value" else
        "cef" if family == "Published CEF NAV" else
        "fund" if ticker in REGISTRY or category in {"ETF", "CEF", "FUND"} else "unknown"
    )
    answer = (info.get("strategy_answer") or {}).get("answer")
    answer = answer if answer in STRATEGY_ANSWERS else None
    if (manual_scope(info) or (answer and answer != "none")) and row["security_kind"] in {"stock", "cash", "unknown"}:
        # The user says this is a fund to screen; respect that over the
        # automatic type, which can misread an unusual name.
        row["security_kind"] = "fund"
        row["manual_type"] = True
    # Eligibility follows the documented strategy, never the distribution yield
    # or a user-selected benchmark. Other funds retain capital/payout metrics.
    documented = "screen_strategy" in row and not row.get("inferred")
    row.setdefault("screen_strategy", {
        "kind": "capital_review" if row["security_kind"] in {"bdc", "reit", "cef"} or family in {
            "Fixed income / short maturity", "BDC fund basket", "Preferred securities",
            "Dividend/growth equity", "CEF basket with hedging", "Equity with put-spread overlay"
        } else "needs_verification",
        "label": family,
        "reason": "Capital, credit, payout and discount changes need their own review. This is not a verified equity/asset covered-call mandate."
    })
    # Settle "does it sell options?" from the most trusted source available:
    # the user's answer, the reviewed registry, the fund's disclosed option
    # positions, then its name or category. Only a fund none of these settle
    # asks the user ("unverified").
    profile = info.get("security_profile") or {}
    held = strategy_from_holdings(profile.get("option_holdings"), profile.get("holdings_as_of"))
    if held and row["security_kind"] == "unknown":
        row["security_kind"] = "fund"
    if row["security_kind"] in {"stock", "cash"}:
        source = "not_applicable"
    elif answer:
        row["screen_strategy"] = dict(STRATEGY_ANSWERS[answer])
        source = "user"
    elif documented:
        source = "registry"
    elif held and row["security_kind"] not in {"stock", "cash"}:
        row["screen_strategy"] = {key: held[key] for key in ("kind", "label", "reason")}
        source = "holdings"
    elif row.get("inferred"):
        source = "inferred"
    elif row["screen_strategy"]["kind"] != "needs_verification":
        source = "family"
    elif name_says_option_income(info):
        row["screen_strategy"] = {
            "kind": "covered_call", "label": "Option-income strategy (from its name or category)",
            "reason": "Its fund category or name says option income, so it is screened as a call-income fund. "
                      "Answer whether it sells call options to confirm or change this.",
        }
        source = "inferred"
    elif manual_scope(info):
        row["screen_strategy"] = {
            "kind": "covered_call", "label": "Option-income strategy (Include manual)",
            "reason": "Screened as a call-income fund because the holding is set to Include (manual). "
                      "Answer whether it sells call options to confirm or change this.",
        }
        source = "manual"
    else:
        source = "unverified"
    row["strategy_source"] = source
    row["strategy_answer"] = answer
    row["holdings_strategy"] = held["answer"] if held else None
    row["fit"] = "Exposure reference" if row.get("suggestion") else "Needs verification"
    if ticker in {"CHPY", "SLJY", "QVOL"}:
        row["fit"] = "Sector / exposure proxy"
    if ticker in {"XQQI", "XSPI"}:
        row["fit"] = "Unboosted market context"
    return row


def validate_choice(data):
    """User choices are context, never self-certified strategy matches."""
    if not isinstance(data, dict):
        raise ValueError("Reference settings must be an object")
    mode = data.get("mode", "auto")
    if mode == "auto":
        return {"mode": "auto"}
    if mode == "symbol":
        symbol = str(data.get("symbol") or "").strip().upper()
        if not SYMBOL.fullmatch(symbol):
            raise ValueError("Enter one reference ticker, such as QQQ or SPY")
        return {"mode": "symbol", "symbol": symbol}
    if mode != "custom":
        raise ValueError("Choose suggested, ticker context or custom daily basket")
    legs = data.get("legs")
    if not isinstance(legs, list) or not 1 <= len(legs) <= 6:
        raise ValueError("A custom reference needs 1 to 6 legs")
    cleaned = []
    for leg in legs:
        if not isinstance(leg, dict):
            raise ValueError("Each leg needs a ticker and exposure")
        symbol = str(leg.get("symbol") or "").strip().upper()
        weight = number(leg.get("weight"))
        if not SYMBOL.fullmatch(symbol) or weight is None or not 0 < weight <= 3:
            raise ValueError("Each leg needs a valid ticker and an exposure above 0% and at most 300%")
        cleaned.append({"symbol": symbol, "weight": weight})
    if len({leg["symbol"] for leg in cleaned}) != len(cleaned):
        raise ValueError("Combine duplicate tickers into one leg")
    if sum(leg["weight"] for leg in cleaned) > 4:
        raise ValueError("Total custom exposure must not exceed 400%")
    annual_cost = number(data.get("annual_cost"))
    if annual_cost is None or not 0 <= annual_cost <= .5:
        raise ValueError("Specify incremental annual costs between 0% and 50%")
    effective = date(data.get("effective_date"))
    reason = str(data.get("reason") or "").strip()
    if not 5 <= len(reason) <= 1000:
        raise ValueError("Explain the exposure and cost assumptions (5–1000 characters)")
    return {"mode": mode, "legs": cleaned, "annual_cost": annual_cost,
            "effective_date": effective.isoformat(), "reason": reason, "rebalance": "daily"}


def reference_plan(ticker, info, guide, choice=None):
    choice = validate_choice(choice or {"mode": "auto"})
    legacy = str(info.get("nav_benchmark_override") or "").strip().upper()
    automatic_label = guide.get("automatic_label") or guide.get("suggestion")
    # Include (manual) compares against the holding's own benchmark box. A
    # saved symbol or custom basket still wins, and a benchmark already known
    # to misrepresent the fund stays unused.
    manual_notice = None
    manual = False
    if manual_scope(info) and choice["mode"] == "auto" and legacy:
        if not SYMBOL.fullmatch(legacy):
            manual_notice = f"Include (manual) benchmark {legacy} is not a valid ticker; using the automatic reference."
        elif legacy in BAD_REFERENCES.get(ticker, set()):
            manual_notice = (f"Include (manual) benchmark {legacy} does not represent this fund's exposure, "
                             f"so the automatic reference {automatic_label or ''} is used instead.").replace("  ", " ")
        else:
            choice = {"mode": "symbol", "symbol": legacy}
            manual = True
    automatic = choice["mode"] == "auto"
    selected = choice.get("symbol") if choice["mode"] == "symbol" else automatic_label
    warning = None
    if choice["mode"] == "symbol" and selected in BAD_REFERENCES.get(ticker, set()):
        warning = f"{selected} does not represent this fund's exposure. Choose a different reference."
    legs = choice.get("legs") if choice["mode"] == "custom" else guide.get("automatic_legs", []) if automatic else (
        [{"symbol": selected, "weight": 1.0}] if selected and SYMBOL.fullmatch(selected) else []
    )
    if selected and not legs and choice["mode"] != "custom":
        warning = "The saved composite needs documented weights, funding and rebalance rules. Define a custom daily basket."
    fit = guide.get("automatic_fit", "Needs verification") if automatic and legs else "Custom daily context" if choice["mode"] == "custom" else (
        "Your Include (manual) benchmark" if manual else
        guide["fit"] if selected and selected == guide.get("suggestion") else "User-selected context" if selected else "Needs verification"
    )
    return {"choice": choice, "legacy_override": legacy, "selected": selected if choice["mode"] != "custom" else "Custom basket",
            "legs": legs, "fit": fit, "warning": warning, "causal_match": False,
            "automatic": automatic and bool(legs), "manual": manual, "automatic_label": automatic_label,
            "inferred": bool(guide.get("inferred")) and automatic,
            "screen_strategy": guide["screen_strategy"],
            "why": (f"Your Include (manual) benchmark for {ticker}." if manual else guide.get("automatic_reason") or guide["guidance"]),
            "legacy_notice": manual_notice or (f"Benchmark {legacy} is saved for this holding; it is used only when the NAV setting is Include (manual)."
                                               if automatic and legacy and not manual_scope(info) else None),
            "requires_aligned_crypto_close": any(leg["symbol"].endswith("-USD") for leg in legs),
            "annual_cost": choice.get("annual_cost", 0), "effective_date": choice.get("effective_date"),
            "status": "needs_review" if warning or not legs else "awaiting_data"}


# BDCs and mortgage REITs are companies with their own loan books: a sector
# ETF is a peer, not something they track.
NO_UNDERLYING_KINDS = {"stock", "cash", "bdc", "reit"}


def underlying_plan(ticker, info, guide, choice=None):
    """The fund's own underlying for TR/Und, which is not the NAV benchmark box.

    A reference saved in the reference editor wins, then the documented or
    inferred exposure. The Include (manual) benchmark is used only when the
    fund has nothing else: it is a screening choice, and old holdings rows
    still carry legacy defaults that are not the underlying (QQQ for CHPY,
    ULTY for KYLD). None when the security has no underlying to track.
    """
    if guide["security_kind"] in NO_UNDERLYING_KINDS:
        return None
    bad = BAD_REFERENCES.get(ticker, set())
    choice = validate_choice(choice or {"mode": "auto"})
    if choice["mode"] == "symbol" and choice["symbol"] not in bad:
        return {"label": choice["symbol"], "legs": [{"symbol": choice["symbol"], "weight": 1.0}],
                "source": "saved", "fit": "Your saved reference", "why": None}
    if choice["mode"] == "custom":
        return {"label": "Custom basket", "legs": choice["legs"], "source": "saved",
                "fit": "Custom daily context", "why": choice["reason"]}
    legs = guide.get("automatic_legs") or []
    if legs:
        return {"label": guide.get("automatic_label") or guide.get("suggestion"), "legs": legs,
                "source": "inferred" if guide.get("inferred") else "documented",
                "fit": guide.get("automatic_fit"), "why": guide.get("automatic_reason")}
    legacy = str(info.get("nav_benchmark_override") or "").strip().upper()
    if manual_scope(info) and SYMBOL.fullmatch(legacy) and legacy not in bad:
        return {"label": legacy, "legs": [{"symbol": legacy, "weight": 1.0}], "source": "manual",
                "fit": "Your Include (manual) benchmark", "why": None}
    return None


def underlying_pending(plan, kind):
    """TR/Und before market data arrives; the price screen fills it in."""
    if not plan:
        return {"status": "not_applicable", "selected": None, "legs": [],
                "reason": "No underlying: this is a company, not a fund that tracks one." if kind in NO_UNDERLYING_KINDS
                else "No underlying is known for this fund. Choose one in the NAV reference editor (Details)."}
    return {"status": "unavailable", "selected": plan["label"], "legs": plan["legs"], "source": plan["source"],
            "fit": plan["fit"], "why": plan["why"], "reason": "Market price and payout history are unavailable."}


def normalize_source(source, start, as_of):
    """Provider records contain actual (not dividend-adjusted) per-share NAV."""
    nav = {}
    for row in source.get("nav", []):
        day, value = date(row["date"]), number(row.get("nav"))
        if day > as_of:
            continue
        if value is None or value <= 0:
            raise ValueError("Published NAV contains an invalid observation")
        if day in nav and nav[day] != value:
            raise ValueError("Conflicting NAV observations on the same date")
        nav[day] = value
    if len(nav) < 2:
        raise ValueError("At least two published NAV observations are required")
    days = sorted(nav)
    before = [day for day in days if day <= start]
    first, last = (before[-1] if before else days[0]), days[-1]
    if first >= last:
        raise ValueError("No usable NAV interval in this window")
    if before and (start-first).days > 7:
        raise ValueError("No NAV close near the requested starting date")
    if (as_of-last).days > 7:
        raise ValueError(f"Published NAV history is stale; last observation {last}")
    distributions = {}
    for row in source.get("distributions", []):
        day = date(row["date"])
        if not first < day <= last:
            continue
        value = number(row.get("amount"))
        if value is None or value < 0 or day in distributions:
            raise ValueError("Incomplete or duplicate distribution entitlements")
        distributions[day] = value
    splits = sorted((date(r["date"]), float(r["ratio"])) for r in source.get("splits", []))
    if any(not math.isfinite(ratio) or ratio <= 0 for _, ratio in splits):
        raise ValueError("Invalid share adjustment")
    def shares(day):
        return math.prod(ratio for split_day, ratio in splits if first < split_day <= day)
    normalized_nav = {day: nav[day] * shares(day) for day in days if first <= day <= last}
    distributions = {day: amount * shares(day) for day, amount in distributions.items()}
    return first, last, normalized_nav, distributions


def compare_reference(start_nav, end_nav, first, last, distributions, plan, loader):
    if plan["warning"] or not plan["legs"]:
        return {"status": "needs_review", "ending_value": None}
    if plan.get("requires_aligned_crypto_close"):
        return {"status": "unavailable", "ending_value": None,
                "reason": "Crypto market reference selected. Matching fund valuation-time prices are needed; midnight crypto closes are not substituted for a US fund close."}
    if plan.get("effective_date") and date(plan["effective_date"]) > first:
        return {"status": "unavailable", "ending_value": None,
                "reason": "Custom assumptions start after this NAV window; choose a shorter window or earlier documented assumptions."}
    histories = []
    for leg in plan["legs"]:
        raw = loader(leg["symbol"], first, last)
        clean = {date(day): number(value) for day, value in (raw or {}).items()}
        if first not in clean or last not in clean or any(value is None or value <= 0 for value in clean.values()):
            return {"status": "unavailable", "ending_value": None, "reason": "Reference needs valid total-return closes on both NAV dates."}
        histories.append({day: value for day, value in clean.items() if first <= day <= last})
    dates = sorted(histories[0])
    if any(sorted(hist) != dates for hist in histories[1:]) or any(day not in dates for day in distributions):
        return {"status": "unavailable", "ending_value": None, "reason": "Reference legs and ex-dates do not align; no missing returns were invented."}
    if any((b-a).days > 7 for a, b in zip(dates, dates[1:])):
        return {"status": "unavailable", "ending_value": None, "reason": "Reference history has an unexplained gap."}
    returns, cash = [], []
    for previous, day in zip(dates, dates[1:]):
        ret = sum(leg["weight"] * (hist[day]/hist[previous]-1) for leg, hist in zip(plan["legs"], histories))
        ret -= plan["annual_cost"] * (day-previous).days / 365.25
        if ret < -1:
            return {"status": "exhausted", "ending_value": None}
        returns.append(ret)
        cash.append(distributions.get(day, 0))
    result = same_cash_reference(start_nav, returns, cash)
    if result["status"] == "available":
        result["start_nav"] = start_nav
        result["before_payout_return"] = math.prod(1 + ret for ret in returns) - 1
        result["capital_gap"] = end_nav-result["ending_value"]
        result["capital_gap_rate"] = result["capital_gap"]/start_nav
        result["comparison"] = "below" if result["capital_gap"] < -.01 else "above" if result["capital_gap"] > .01 else "within_precision"
    return result


VERIFIED_EROSION_LABEL = "Potential NAV erosion — review"
VERIFIED_EROSION_REASON = (
    "Published NAV declined in at least two of the most recent four completed quarters while the exposure reference "
    "was flat/rising. This is a persistent capital-depletion review signal; payout policy, options, expenses and "
    "exposure differences still need investigation.")


def verified_erosion_candidate(row):
    """The published-NAV quarterly check's erosion flag for one fund."""
    ref, plan = row.get("reference_result") or {}, row["reference"]
    return bool(row.get("metrics") and row["capital_status"] == "declined"
                and ref.get("status") == "available"
                and plan["fit"] == "Exposure reference" and not plan["warning"]
                and (row.get("persistence") or {}).get("qualifying_quarters", 0) >= 2)


def erosion_overview(results):
    """Triage observations, not calibrated probabilities or causal assertions.

    An endpoint difference is not a persistent signal. Require at least two
    separate recent completed quarters with declining NAV while the exposure
    reference was flat/rising. Reference outperformance cannot erase repeated
    capital depletion. This is triage, not a calibrated causal probability.
    """
    applicable = [row for row in results if row["capital_status"] != "not_applicable"]
    known = [row for row in applicable if row.get("metrics")]
    candidates, payouts, declines = [], [], []
    for row in known:
        metrics, ref = row["metrics"], row["reference_result"]
        if row["capital_status"] != "declined":
            continue
        declines.append(row["ticker"])
        if metrics["investment_result"] >= 0 and metrics["payouts_not_replenished"]:
            payouts.append(row["ticker"])
        if verified_erosion_candidate(row):
            candidates.append({"ticker": row["ticker"], "label": VERIFIED_EROSION_LABEL,
                "reason": VERIFIED_EROSION_REASON,
                "nav_change_rate": metrics["capital_change_rate"], "reference_gap_rate": ref["capital_gap_rate"]})
    partial = len(known) < len(applicable)
    persistence_evidence_count = sum(row.get("persistence", {}).get("quarters_compared", 0) >= 2 for row in known)
    title = "No applicable fund holdings" if not applicable else "Review indicated — persistent shortfalls" if candidates else "NAV verdict unavailable — incomplete portfolio coverage" if partial else "No persistent erosion signal established in assessed holdings" if persistence_evidence_count else "Inconclusive — insufficient completed-quarter evidence" if known else "Inconclusive — more NAV evidence needed"
    return {"title": title, "partial": partial, "applicable_count": len(applicable), "assessed_count": len(known),
            "candidates": candidates, "payout_pressure_tickers": payouts, "nav_decline_tickers": declines,
            "data_needed_tickers": [row["ticker"] for row in applicable if not row.get("metrics")],
            "causal_verdict": "unconfirmed",
            "persistence_evidence_count": persistence_evidence_count,
            "explanation": "Potential candidates require repeated qualifying quarters, not a small endpoint decline. This is a review screen, not a probability or confirmation of destructive erosion. Market declines alone do not qualify. Unconfirmed holdings prevent a complete portfolio-wide conclusion."}


NAV_STATUS_LABELS = {"declined": "NAV declined", "preserved": "Capital preserved",
                     "within_precision": "Within source precision", "liquidated": "Liquidated"}


def _signed_pct(value):
    return "—" if value is None else f"{value * 100:.2f}%"


def fund_finding(row):
    """The one result every NAV screen shows for a fund.

    The Dashboard, the NAV Erosion page and the NAV Erosion Screener all
    display this, so a fund over the same dates and reference reads the same
    on each. Erosion outranks NAV lag, which outranks a plain NAV status.
    """
    price = row.get("price_screen") or {}
    price = price if price.get("status") == "available" else None
    lag = (price or {}).get("nav_lag") or {}
    metrics = row.get("metrics")
    if row["capital_status"] == "not_applicable":
        money_market = (row.get("guidance") or {}).get("family") == "Money market fund"
        return {"code": "not_applicable", "label": "Not applicable", "tone": "muted", "basis": None,
                "detail": "Money-market fund" if money_market else "Not a fund", "reason": row.get("reason")}
    if row.get("nav_erosion_scope") == "skip":
        return {"code": "skipped", "label": "Skipped", "tone": "muted", "basis": None,
                "detail": "Excluded from the NAV screen", "reason": row.get("reason")}
    basis = "published_nav" if metrics else "market_price" if price else None
    detail = (f"{_signed_pct(metrics['capital_change_rate'])} published NAV" if metrics else
              f"{_signed_pct(price['price_change_rate'])} price · {_signed_pct(price['cash_total_return'])} with payouts"
              if price else "Price history unavailable")

    def result(code, label, tone, reason, shown=detail):
        return {"code": code, "label": label, "tone": tone, "detail": shown, "reason": reason, "basis": basis}

    if row.get("erosion_review"):
        return result("verified_erosion", VERIFIED_EROSION_LABEL, "neg", VERIFIED_EROSION_REASON)
    if price and price.get("estimated_eroder"):
        return result("estimated_eroder", price["label"], "neg", price["reason"])
    if price and price.get("review_candidate"):
        return result("losing_capital", price["label"], "warn", price["reason"])
    if lag.get("status") == "lag":
        return result("nav_lag", price["label"], "lag", lag["reason"],
                      f"{_signed_pct(lag['fund_price_change_rate'])} price vs "
                      f"{_signed_pct(lag['underlying_price_change_rate'])} {lag['reference']}")
    if metrics:
        return result(row["capital_status"], NAV_STATUS_LABELS.get(row["capital_status"], "Unconfirmed"),
                      "warn" if row["capital_status"] == "declined" else "ok", row.get("reason"))
    if price:
        if (price.get("strategy") or {}).get("kind") == "needs_verification":
            return result("needs_strategy", price["label"], "muted", price["reason"])
        if price["persistence"]["supportive_intervals"] < 2:
            return result("limited_evidence", price["label"], "muted", price["reason"])
        return result("no_signal", price["label"], "ok", price["reason"])
    return result("unconfirmed", "Unconfirmed", "muted", row.get("reason"))


def _verdict_share(value, account, complete):
    if not complete or account is None or account <= 0 or value is None:
        return None
    return value / account


def _verdict_value(results, tickers):
    wanted = {str(ticker) for ticker in tickers}
    return sum((row.get("current_value") or 0) for row in results if row["ticker"] in wanted)


def _verdict_weight(share, count, applicable_count):
    if share is not None:
        return share
    if applicable_count:
        return count / applicable_count
    return 0.0


def _verdict_money(value):
    if value is None:
        return None
    return f"${value:,.0f}"


def _verdict_pct(share):
    if share is None:
        return None
    return f"{share * 100:.0f}%"


def _holding_entry(row, role, account, complete, extra=None):
    extra = extra or {}
    price = (row or {}).get("price_screen") or {}
    value = (row or {}).get("current_value")
    labels = {
        "verified": "Verified persistent candidate",
        "estimated_eroder": "Estimated covered-call eroder",
        "review": price.get("label") or "Price-based review",
    }
    return {
        "ticker": extra.get("ticker") or row["ticker"],
        "role": role,
        "label": labels[role],
        "current_value": value,
        "value_share": _verdict_share(value, account, complete),
        "reason": extra.get("reason") or (price.get("reason") if role != "verified" else None) or (row or {}).get("reason"),
    }


def _reduction_plan(strength, probability, *, verified, eroders, reviews, eroder_share, eroder_value, account, complete):
    def names(rows):
        return [item["ticker"] for item in rows]

    if strength == "insufficient":
        return {
            "under_50": False,
            "headline": "There is not enough completed-month or published-NAV evidence to name a path under 50%.",
            "steps": ["Refresh after published NAV and at least two completed months are available. Missing evidence is not treated as No NAV Erosion."],
        }
    if strength == "none":
        return {
            "under_50": True,
            "headline": "No implicated tickers. Evidence probability is already under 50%.",
            "steps": ["50% is the Strong-band floor of this evidence score, not a forecast. The screen did not establish a persistent or estimated erosion signal."],
        }
    if strength == "weak":
        remaining = names(eroders) + names(reviews)
        return {
            "under_50": True,
            "headline": f"Evidence probability is already under 50% ({probability}%). 50% is the Strong-band floor, not a forecast.",
            "steps": [
                f"Remaining Weak names: {', '.join(remaining)}." if remaining else "No remaining estimated eroders or review candidates.",
                "To reach No NAV Erosion, the screen needs no estimated covered-call eroders and no price-based review candidates.",
            ],
        }
    steps = ["50% is the Strong-band floor of this evidence score, not a forecast that NAV will keep falling."]
    if verified:
        steps.append(
            "Clear verified persistent candidates (" + ", ".join(names(verified)) + "). "
            "Those names keep the account in Strong because published NAV declined in at least two qualifying quarters."
        )
    if eroders and (eroder_share is None or eroder_share >= 0.10):
        if complete and account and eroder_share is not None:
            trim = max(0.0, (eroder_value or 0) - 0.10 * account)
            steps.append(
                f"Reduce estimated covered-call eroders from {_verdict_pct(eroder_share)} to below 10% of current account value "
                f"({', '.join(names(eroders))}). At today's account value of {_verdict_money(account)}, that means cutting more than "
                f"{_verdict_money(trim)} from those holdings, or growing the rest of the account until they are a smaller sleeve. "
                "That leaves the Strong band and puts the evidence score in Weak (20–49%)."
            )
        else:
            steps.append(
                "Reduce estimated covered-call eroders (" + ", ".join(names(eroders)) + ") below 10% of current account value. "
                "Value coverage is incomplete, so refresh after holdings values are complete and trim until that sleeve is a small share."
            )
    leftover = names(eroders) + names(reviews)
    if leftover:
        steps.append(
            "After leaving Strong, remaining estimated eroders and review candidates (" + ", ".join(leftover) + ") still keep a Weak reading (20–49%). "
            "To reach No NAV Erosion, the screen needs none of those names."
        )
    return {"under_50": False, "headline": "Leave Strong to get the evidence score under 50%.", "steps": steps}


def _verdict_probability(strength, *, verified_weight, eroder_weight, review_weight,
                         verified_count, eroder_count, extra_quarters, coverage):
    if strength == "insufficient":
        return None
    implicated = max(verified_weight, eroder_weight, review_weight)
    if strength == "strong":
        return int(round(min(95, 52 + 28 * implicated + 6 * min(3, verified_count + max(0, eroder_count - 1)) + min(9, extra_quarters * 3))))
    if strength == "weak":
        return int(round(min(49, 20 + 22 * implicated + 4 * min(3, max(eroder_count, 0) + max(0, (1 if review_weight else 0))))))
    missing = 1 - min(1.0, coverage if coverage is not None else 0.5)
    return int(round(min(15, 3 + 12 * missing)))


def portfolio_verdict(results, preliminary, overall, summary):
    """Glanceable Strong / Weak / No card for the selected portfolio.

    The probability is an evidence score from 0–100, not a calibrated forecast.
    It answers how strongly the available persistence and reference screens
    support NAV erosion in this account. Incomplete coverage is not labeled
    No NAV Erosion.
    """
    preliminary = preliminary or {}
    overall = overall or {}
    summary = summary or {}
    applicable = [row for row in results if row.get("capital_status") != "not_applicable"]
    complete = bool(summary.get("value_coverage_complete"))
    account = number(summary.get("account_value")) or 0
    applicable_count = len(applicable)

    by_ticker = {row.get("ticker"): row for row in results}
    eroder_rows = [row for row in results if (row.get("price_screen") or {}).get("estimated_eroder")]
    review_rows = [row for row in results if (row.get("price_screen") or {}).get("review_candidate")]
    verified = list(overall.get("candidates") or [])
    eroder_tickers = {row["ticker"] for row in eroder_rows}
    review_only_rows = [row for row in review_rows if row["ticker"] not in eroder_tickers]
    verified_holdings = [_holding_entry(by_ticker.get(item.get("ticker")), "verified", account, complete, item) for item in verified]
    eroder_holdings = [_holding_entry(row, "estimated_eroder", account, complete) for row in eroder_rows]
    review_holdings = [_holding_entry(row, "review", account, complete) for row in review_only_rows]
    implicated = verified_holdings + eroder_holdings + review_holdings
    eroder_value = _verdict_value(results, [row["ticker"] for row in eroder_rows])
    eroder_count = len(eroder_rows)
    review_count = len(review_rows)
    verified_count = len(verified)
    extra_quarters = 0
    for candidate in verified:
        row = next((item for item in results if item.get("ticker") == candidate.get("ticker")), None)
        extra_quarters += max(0, ((row or {}).get("persistence") or {}).get("qualifying_quarters", 0) - 2)

    eroder_share = _verdict_share(_verdict_value(results, [row["ticker"] for row in eroder_rows]), account, complete)
    review_share = _verdict_share(_verdict_value(results, [row["ticker"] for row in review_rows]), account, complete)
    verified_share = _verdict_share(_verdict_value(results, [row.get("ticker") for row in verified]), account, complete)
    eroder_weight = _verdict_weight(eroder_share, eroder_count, applicable_count)
    review_weight = _verdict_weight(review_share, review_count, applicable_count)
    verified_weight = _verdict_weight(verified_share, verified_count, applicable_count)
    implicated_shares = [share for share in (verified_share, eroder_share, review_share) if share is not None]
    implicated_share = max(implicated_shares) if implicated_shares else None
    coverage = preliminary.get("value_coverage")
    if coverage is None and overall.get("applicable_count"):
        coverage = overall.get("assessed_count", 0) / overall["applicable_count"]

    price_ready = preliminary.get("persistence_evaluable_count", 0) >= 2 or preliminary.get("covered_count", 0) >= 1
    nav_ready = (overall.get("assessed_count") or 0) > 0
    has_signal = verified_count or eroder_count or review_count

    if not applicable:
        strength = "none"
        explanation = "No applicable fund holdings in this portfolio."
        summary_text = "No fund holdings to assess."
    elif verified_count or eroder_weight >= 0.10:
        strength = "strong"
        explanation = (
            "This account has a persistent NAV-erosion signal: verified quarterly NAV shortfalls "
            "and/or estimated covered-call eroders covering at least 10% of current account value. "
            "The probability is an evidence score for that screen, not a forecast that NAV will keep falling."
        )
        summary_text = "Persistent or estimated erosion signal in this account."
    elif eroder_count or review_count:
        strength = "weak"
        explanation = (
            "Holdings need review because of price-based shortfalls or a small estimated-eroder position, "
            "but the account does not yet meet the Strong NAV Erosion threshold. "
            "This is not verified causation."
        )
        summary_text = "Review indicated; the Strong NAV Erosion threshold was not met."
    elif price_ready or nav_ready:
        strength = "none"
        explanation = (
            "Screened holdings did not establish a persistent NAV-erosion or estimated covered-call eroder signal. "
            "This does not certify that every holding preserved NAV, especially where published NAV is still missing."
        )
        summary_text = "No persistent or estimated erosion signal in screened holdings."
    else:
        strength = "insufficient"
        explanation = (
            "Not enough completed-month price evidence or published NAV to classify this portfolio as "
            "Strong, Weak, or No NAV Erosion."
        )
        summary_text = "Completed-month and published-NAV evidence are still incomplete."

    parts = []
    if verified_count:
        parts.append(f"{verified_count} verified persistent candidate{'s' if verified_count != 1 else ''}")
    if eroder_count:
        parts.append(f"{eroder_count} estimated covered-call eroder{'s' if eroder_count != 1 else ''}")
    elif review_count:
        parts.append(f"{review_count} price-based review candidate{'s' if review_count != 1 else ''}")
    if implicated_share is not None and has_signal:
        parts.append(f"{implicated_share * 100:.0f}% of current account value")
    if parts:
        summary_text = " · ".join(parts)

    # Shown beside the verdict so it is visibly accounted for; NAV lag never
    # counts toward Strong or Weak.
    nav_lag = [{
        "ticker": row["ticker"], "label": row["finding"]["label"], "detail": row["finding"]["detail"],
        "reason": row["finding"]["reason"], "current_value": row.get("current_value"),
        "value_share": _verdict_share(row.get("current_value"), account, complete),
    } for row in results if (row.get("finding") or {}).get("code") == "nav_lag"]

    probability = 0 if not applicable else _verdict_probability(
        strength, verified_weight=verified_weight, eroder_weight=eroder_weight,
        review_weight=review_weight, verified_count=verified_count, eroder_count=eroder_count,
        extra_quarters=extra_quarters, coverage=coverage,
    )
    return {
        "label": VERDICT_LABELS[strength],
        "strength": strength,
        "probability": probability,
        "probability_label": "Evidence probability",
        "summary": summary_text,
        "explanation": explanation,
        "verified_count": verified_count,
        "eroder_count": eroder_count,
        "review_count": review_count,
        "value_share": implicated_share,
        "has_signal": bool(has_signal),
        "nav_lag": nav_lag,
        "holdings": {
            "verified": verified_holdings,
            "estimated_eroders": eroder_holdings,
            "review": review_holdings,
            "implicated": implicated,
        },
        "reduction": _reduction_plan(
            strength, probability, verified=verified_holdings, eroders=eroder_holdings,
            reviews=review_holdings, eroder_share=eroder_share, eroder_value=eroder_value,
            account=account, complete=complete,
        ),
    }


def persistence_check(nav, distributions, first, last, plan, loader):
    """Use independent completed calendar quarters within the selected window.

    Keep the actual cash dates; do not count overlapping rolling windows as
    independent confirmation. Source rounding remains a measurement tolerance.
    """
    windows = []
    dates = sorted(nav)
    for year in range(first.year, last.year + 1):
        for month in (3, 6, 9, 12):
            end = dt.date(year, month, calendar.monthrange(year, month)[1])
            beginning = dt.date(year-1, 12, 31) if month == 3 else dt.date(year, month-3, calendar.monthrange(year, month-3)[1])
            if beginning < first or end > last:
                continue
            starts = [day for day in dates if day <= beginning]
            ends = [day for day in dates if day <= end]
            if not starts or not ends:
                continue
            a, b = starts[-1], ends[-1]
            if a < first or a >= b or (beginning-a).days > 7 or (end-b).days > 7:
                continue
            paid = {day: amount for day, amount in distributions.items() if a < day <= b}
            try:
                ref = compare_reference(nav[a], nav[b], a, b, paid, plan, loader)
            except Exception:
                ref = {"status": "unavailable"}
            valid = ref.get("status") == "available"
            supportive = valid and ref["before_payout_return"] >= 0
            qualifies = bool(supportive and nav[b] < nav[a]-.01)
            windows.append({"start": a.isoformat(), "end": b.isoformat(),
                "nav_change_rate": nav[b]/nav[a]-1,
                "reference_return": ref.get("before_payout_return"),
                "reference_gap_rate": ref.get("capital_gap_rate"),
                "reference_status": ref.get("status"), "qualifies": qualifies})
    windows = windows[-4:]
    available = sum(window["reference_status"] == "available" for window in windows)
    qualifying = sum(window["qualifies"] for window in windows)
    return {"status": "repeated_shortfalls" if qualifying >= 2 else "not_established" if available >= 2 else "insufficient_quarterly_evidence",
            "qualifying_quarters": qualifying, "quarters_compared": available, "minimum_required": 2, "windows": windows}


def build_payload(ticker_info, source_loader, reference_loader, *, window="1Y", as_of=None, start_date=None, choices=None, cash=0,
                  market_loader=None, price_loader=None):
    """Assess every fund in ticker_info. The Dashboard and both NAV Erosion
    screens all call this, so a fund gets the same result on each.

    reference_loader returns total-return closes and price_loader plain
    closes (used for NAV lag) for a reference symbol between two dates.
    """
    if window not in WINDOWS:
        raise ValueError("Unsupported NAV assessment window")
    as_of = as_of or dt.date.today()
    start = date(start_date) if start_date is not None else window_start(as_of, window)
    if start > as_of:
        raise ValueError("Assessment start must be on or before the end date")
    choices = choices or {}

    def one(item):
        ticker, info = item
        guide = guidance(ticker, info)
        plan = reference_plan(ticker, info, guide, choices.get(ticker))
        value = number(info.get("current_value"))
        value = value if value is not None and value >= 0 else None
        if value == 0 and (number(info.get("quantity")) or 0) > 0:
            value = None
        annual_income = number(info.get("annual_income"))
        payout_rate = annual_income/value if annual_income is not None and annual_income >= 0 and value else None
        crypto = bool(guide.get("crypto_related")) or "crypto" in guide["family"].lower()
        payout_priority = {
            "annual_rate": payout_rate, "threshold": .15, "crypto_related": crypto,
            "priority": not crypto and payout_rate is not None and payout_rate > .15,
            "status": "crypto_excluded" if crypto else "rate_unavailable" if payout_rate is None else "above_threshold" if payout_rate > .15 else "below_threshold",
            "source": "Current holding estimated annual cash income / current holding value",
        }
        row = {"ticker": ticker, "description": info.get("description", ""), "current_value": value,
               "payout_priority": payout_priority,
               "capital_status": "unconfirmed", "structural_erosion": "unconfirmed", "guidance": guide,
               "reference": plan, "reference_result": {"status": "unavailable"},
               "persistence": {"status": "insufficient_quarterly_evidence", "qualifying_quarters": 0, "quarters_compared": 0, "minimum_required": 2, "windows": []},
               "nav_erosion_scope": info.get("nav_erosion_scope") or "auto",
               "nav_benchmark_override": str(info.get("nav_benchmark_override") or "").strip().upper(),
               "metrics": None,
               "underlying": underlying_pending(underlying_plan(ticker, info, guide, choices.get(ticker)),
                                                guide["security_kind"]),
               "reason": "Published NAV and complete distribution/share-adjustment history are needed."}
        kind = guide["security_kind"]
        if kind in {"stock", "cash"}:
            row.update(capital_status="not_applicable",
                       reason=guide.get("not_applicable_reason") or "Fund NAV assessment does not apply to an operating-company stock.")
            return row
        if kind == "unknown":
            row["reason"] = ("Security identity/type needs verification before selecting an NAV source or reference. "
                             "Choose Include (manual) and enter a benchmark to screen it anyway.")
            return row
        if row["nav_erosion_scope"] == "skip":
            row["reason"] = "Skipped by user setting; included in unconfirmed exposure."
            return row
        if kind in {"bdc", "reit"}:
            row["reason"] = "Reported quarterly NAV/book value and distributions are needed; daily stock prices are not a substitute."
            return row
        try:
            source = source_loader(ticker, guide, start, as_of)
            if not source:
                return row
            row["source"] = {key: source.get(key) for key in ("label", "url", "fetched_at", "distribution_source", "adjustment_source")}
            if source.get("unavailable_reason"):
                # The issuer answered but publishes no usable NAV history.
                row["reason"] = source["unavailable_reason"]
                return row
            first, last, nav, distributions = normalize_source(source, start, as_of)
            row.update(window_start=first.isoformat(), window_end=last.isoformat(), shorter_history=start.year != 1900 and first>start)
            row["published_nav"] = {"start": nav[first], "end": nav[last]}
            observation = CapitalObservation(nav[first], nav[last], sum(distributions.values()),
                basis=source.get("basis", "unverified"),
                data_complete=source.get("distributions_complete") is True,
                corporate_actions_resolved=source.get("corporate_actions_resolved") is True)
            measured = assess(observation)
            if not measured["nav_observation_supported"]:
                row["reason"] = source.get("limitation") or "Published NAV observed; distribution completeness or share adjustments still need verification."
                return row
            row.update(capital_status=measured["capital_status"], metrics=measured, reason=measured["review"])
            # Reference failures cannot erase valid NAV accounting.
            try:
                histories = {}
                def aligned_history(symbol, a, b):
                    if symbol not in histories:
                        histories[symbol] = reference_loader(symbol, first, last)
                    return {day: value for day, value in histories[symbol].items() if a <= date(day) <= b}
                reference = compare_reference(nav[first], nav[last], first, last, distributions, plan, aligned_history)
                row["reference_result"] = reference
                if reference["status"] == "available":
                    row["metrics"] = assess(observation, reference, reference_quality="exposure")
                elif reference.get("reason"):
                    row["reference_result"]["reason"] = reference["reason"]
                row["persistence"] = persistence_check(nav, distributions, first, last, plan, aligned_history)
            except Exception:
                row["reference_result"] = {"status": "unavailable", "reason": "Reference total-return history is unavailable; NAV accounting is unaffected."}
        except json.JSONDecodeError:
            # The source answered with a web page instead of data: CEF Connect
            # does this when it blocks or rate-limits requests.
            row["reason"] = (
                "CEF Connect, the source of published closed-end fund NAV, sent a web page instead of NAV data, which "
                "usually means it is blocking or rate-limiting requests. Published NAV can't be checked until it "
                "answers again, so the result above uses market prices."
                if kind == "cef" else
                "The published NAV source sent something other than NAV data. Published NAV can't be checked until it "
                "recovers, so the result above uses market prices.")
        except Exception as exc:
            row["reason"] = str(exc) if isinstance(exc, ValueError) else "Published NAV source is temporarily unavailable."
        return row

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, sorted(ticker_info.items())))
    if market_loader is not None:
        try:
            from .nav_price_screen import screen, summarize, underlying_comparison
        except ImportError:
            from nav_price_screen import screen, summarize, underlying_comparison
        def preliminary(row):
            if row['nav_erosion_scope'] == 'skip' and row['underlying']['legs']:
                row['underlying'] = {**row['underlying'], 'reason': 'Skipped by the NAV setting, so TR/Und is not measured.'}
            if row['capital_status'] == 'not_applicable' or row['nav_erosion_scope'] == 'skip':
                return row
            try:
                source = market_loader(row['ticker'], start, as_of)
                row['price_screen'] = screen(source, start, as_of,
                                             row['reference'], reference_loader, price_loader,
                                             verified_erosion=verified_erosion_candidate(row))
            except Exception as exc:
                row['price_screen'] = {'status':'unavailable', 'reason':str(exc) if isinstance(exc,ValueError) else 'Market data is temporarily unavailable.'}
                return row
            if row['underlying']['legs']:
                try:
                    row['underlying'] = underlying_comparison(source, start, as_of, row['underlying'], reference_loader)
                except Exception as exc:
                    row['underlying'] = {**row['underlying'], 'reason': str(exc) if isinstance(exc, ValueError)
                                         else 'Market data is temporarily unavailable.'}
            return row
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(preliminary,results))
        preliminary_overview = summarize(results)
    else:
        preliminary_overview = None
    states = {key: {"count": 0, "value": 0.0} for key in ("declined", "preserved", "unconfirmed", "not_applicable")}
    missing_values = []
    for row in results:
        key = "preserved" if row["capital_status"] == "within_precision" else row["capital_status"]
        states[key]["count"] += 1
        if row["current_value"] is None:
            missing_values.append(row["ticker"])
        else:
            states[key]["value"] += row["current_value"]
    cash = number(cash)
    total = sum(state["value"] for state in states.values()) + (cash or 0)
    if preliminary_overview is not None:
        preliminary_overview['estimated_eroder_account_share'] = preliminary_overview['estimated_eroder_value']/total if total > 0 and cash is not None and not missing_values else None
    for state in states.values():
        state["share"] = state["value"]/total if total > 0 and cash is not None and not missing_values else None
    overall = erosion_overview(results)
    flagged = {row["ticker"] for row in overall["candidates"]}
    for row in results:
        row["erosion_review"] = row["ticker"] in flagged
        row["finding"] = fund_finding(row)
    summary = {"states": states, "cash": cash, "account_value": total,
               "value_coverage_complete": cash is not None and not missing_values,
               "missing_values": missing_values,
               "reference_available": sum(r["reference_result"]["status"] == "available" for r in results),
               "reference_needs_review": sum(bool(r["reference"]["warning"]) or not r["reference"]["legs"] for r in results if r["capital_status"] != "not_applicable")}
    return {"version": VERSION, "window": window, "requested_start": start.isoformat() if start.year != 1900 else None,
            "as_of": as_of.isoformat(), "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "results": results,
            "overall": overall, "preliminary": preliminary_overview, "verdict": portfolio_verdict(results, preliminary_overview, overall, summary),
            "summary": summary}
