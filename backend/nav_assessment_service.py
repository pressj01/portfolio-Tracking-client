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
except ImportError:
    from nav_assessment import CapitalObservation, assess, same_cash_reference

VERSION = "nav-assessment-v5-evidence-tiers"
REGISTRY = json.loads(Path(__file__).with_name("nav_reference_registry.json").read_text(encoding="utf-8"))
WINDOWS = {"1D": 0, "7D": 0, "1M": 1, "3M": 3, "6M": 6, "YTD": 0, "1Y": 12, "2Y": 24, "3Y": 36, "5Y": 60, "ALL": None, "CUSTOM": 0}
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


def guidance(ticker, info):
    row = dict(REGISTRY.get(ticker, {
        "family": "Security type needs verification", "suggestion": None,
        "source_url": None, "source_checked": None,
        "guidance": "Identify the security and verify its issuer objective before choosing a reference.",
        "limitations": "No automatic broad-market fallback is applied.",
        "suggested_direction": "No validated reference available",
    }))
    family = row["family"]
    category = str(info.get("classification_type") or "").upper()
    row["security_kind"] = (
        "stock" if family == "Operating-company stock" else
        "bdc" if family == "Quarterly BDC NAV" or category == "BDC" else
        "reit" if family == "Quarterly mortgage REIT book value" else
        "cef" if family == "Published CEF NAV" else
        "fund" if ticker in REGISTRY or category in {"ETF", "CEF", "FUND"} else "unknown"
    )
    # Eligibility follows the documented strategy, never the distribution yield
    # or a user-selected benchmark. Other funds retain capital/payout metrics.
    row.setdefault("screen_strategy", {
        "kind": "capital_review" if row["security_kind"] in {"bdc", "reit", "cef"} or family in {
            "Fixed income / short maturity", "BDC fund basket", "Preferred securities",
            "Dividend/growth equity", "CEF basket with hedging", "Equity with put-spread overlay"
        } else "needs_verification",
        "label": family,
        "reason": "Capital, credit, payout and discount changes need their own review. This is not a verified equity/asset covered-call mandate."
    })
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
    automatic = choice["mode"] == "auto"
    selected = choice.get("symbol") if choice["mode"] == "symbol" else guide.get("automatic_label") or guide.get("suggestion")
    warning = None
    if choice["mode"] == "symbol" and selected in BAD_REFERENCES.get(ticker, set()):
        warning = f"{selected} does not represent this fund's exposure. Choose a different reference."
    legs = choice.get("legs") if choice["mode"] == "custom" else guide.get("automatic_legs", []) if automatic else (
        [{"symbol": selected, "weight": 1.0}] if selected and SYMBOL.fullmatch(selected) else []
    )
    if selected and not legs and choice["mode"] != "custom":
        warning = "The saved composite needs documented weights, funding and rebalance rules. Define a custom daily basket."
    fit = guide.get("automatic_fit", "Needs verification") if automatic else "Custom daily context" if choice["mode"] == "custom" else (
        guide["fit"] if selected and selected == guide.get("suggestion") else "User-selected context" if selected else "Needs verification"
    )
    return {"choice": choice, "legacy_override": legacy, "selected": selected if choice["mode"] != "custom" else "Custom basket",
            "legs": legs, "fit": fit, "warning": warning, "causal_match": False,
            "automatic": automatic,
            "screen_strategy": guide["screen_strategy"],
            "why": guide.get("automatic_reason", guide["guidance"]),
            "legacy_notice": (f"Holding override {legacy} is retained but not used in automatic mode." if automatic and legacy else None),
            "requires_aligned_crypto_close": any(leg["symbol"].endswith("-USD") for leg in legs),
            "annual_cost": choice.get("annual_cost", 0), "effective_date": choice.get("effective_date"),
            "status": "needs_review" if warning or not legs else "awaiting_data"}


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
        metrics, ref, plan = row["metrics"], row["reference_result"], row["reference"]
        if row["capital_status"] != "declined":
            continue
        declines.append(row["ticker"])
        if metrics["investment_result"] >= 0 and metrics["payouts_not_replenished"]:
            payouts.append(row["ticker"])
        if (ref.get("status") == "available"
                and plan["fit"] == "Exposure reference" and not plan["warning"]
                and row.get("persistence", {}).get("qualifying_quarters", 0) >= 2):
            candidates.append({"ticker": row["ticker"], "label": "Potential NAV erosion — review",
                "reason": "Published NAV declined in at least two of the most recent four completed quarters while the exposure reference was flat/rising. This is a persistent capital-depletion review signal; payout policy, options, expenses and exposure differences still need investigation.",
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


def build_payload(ticker_info, source_loader, reference_loader, *, window="1Y", as_of=None, start_date=None, choices=None, cash=0, market_loader=None):
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
               "nav_erosion_scope": info.get("nav_erosion_scope", "auto"), "metrics": None,
               "reason": "Published NAV and complete distribution/share-adjustment history are needed."}
        kind = guide["security_kind"]
        if kind == "stock":
            row.update(capital_status="not_applicable", reason="Fund NAV assessment does not apply to an operating-company stock.")
            return row
        if kind == "unknown":
            row["reason"] = "Security identity/type needs verification before selecting an NAV source or reference."
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
            row["reason"] = "The published NAV feed could not be read. Retry after the source recovers."
        except Exception as exc:
            row["reason"] = str(exc) if isinstance(exc, ValueError) else "Published NAV source is temporarily unavailable."
        return row

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, sorted(ticker_info.items())))
    if market_loader is not None:
        try:
            from .nav_price_screen import screen, summarize
        except ImportError:
            from nav_price_screen import screen, summarize
        def preliminary(row):
            if row['capital_status'] == 'not_applicable' or row['nav_erosion_scope'] == 'skip':
                return row
            try:
                row['price_screen'] = screen(market_loader(row['ticker'], start, as_of), start, as_of,
                                             row['reference'], reference_loader)
            except Exception as exc:
                row['price_screen'] = {'status':'unavailable', 'reason':str(exc) if isinstance(exc,ValueError) else 'Market data is temporarily unavailable.'}
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
    return {"version": VERSION, "window": window, "requested_start": start.isoformat() if start.year != 1900 else None,
            "as_of": as_of.isoformat(), "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "results": results,
            "overall": overall, "preliminary": preliminary_overview,
            "summary": {"states": states, "cash": cash, "account_value": total,
                        "value_coverage_complete": cash is not None and not missing_values,
                        "missing_values": missing_values,
                        "reference_available": sum(r["reference_result"]["status"] == "available" for r in results),
                        "reference_needs_review": sum(bool(r["reference"]["warning"]) or not r["reference"]["legs"] for r in results if r["capital_status"] != "not_applicable")}}
