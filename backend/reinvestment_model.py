"""Reinvestment Impact's Historical view for a Portfolio Builder model.

A Builder model has no payment records, trades or DRIP settings, only the
shares its dollars buy at the latest close (``model_distributions.model_positions``).
Its history is modeled the way the Distributions page models it: each fund's
actual past distributions paid on those shares, dated on the pay date. On top
of that, every modeled payment from the window start on is reinvested at that
day's close, so the share count grows and later payments are larger.

The "never reinvested" counterfactual is the same shares held unchanged, which
is exactly the Distributions page's modeled income for the model. The gap
between the two is the extra income the reinvested shares earned.
"""

from collections import defaultdict
from datetime import date

from drip_ledger import Market
from model_distributions import model_income_estimate, modeled_payments

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
PERIODS_PER_YEAR = {"weekly": 52, "monthly": 12, "yearly": 1}
TOP_TICKERS = 15


def _shift_months(day, delta):
    index = day.year * 12 + (day.month - 1) + delta
    return date(index // 12, index % 12 + 1, 1)


def _fmt_month(day):
    return f"{MONTH_ABBR[day.month - 1]} '{str(day.year)[-2:]}"


def _empty_period():
    return {"payout": 0.0, "income_from_drip": 0.0, "reinvested": 0.0, "cash": 0.0,
            "drip_added": 0.0, "dps": 0.0, "count": 0}


def _empty_bucket():
    return dict(_empty_period(), shares_eff=0.0, trades_eff=0.0, rate_eff=0.0, price_eff=0.0)


def _replay_position(position, market, lag, *, cutoff_key, pre_cutoff_date, today, period_key):
    """Per-period modeled payments for one holding, reinvested from the window start.

    Returns ({period_key: record}, [(pay_day, amount, income_from_drip)], drip shares held).
    """
    shares = position["shares"]
    periods = defaultdict(_empty_period)
    events = []
    lots = []  # (bought_on, shares) bought by reinvesting
    payments = sorted(
        (p for p in modeled_payments(position, lag, today)
         if not p["pending"] and pre_cutoff_date <= p["pay"] <= today),
        key=lambda p: (p["pay"], p["ex"]),
    )
    for payment in payments:
        key = period_key(payment["pay"])
        # Shares bought by reinvesting are entitled to distributions whose
        # ex-date comes after the purchase.
        drip_held = sum(bought for day, bought in lots if day < payment["ex"])
        amount = payment["per_share"] * (shares + drip_held)
        from_drip = payment["per_share"] * drip_held
        record = periods[key]
        record["payout"] += amount
        record["income_from_drip"] += from_drip
        record["dps"] += payment["per_share"]
        record["count"] += 1
        if key < cutoff_key:
            continue  # the prior period only gives the first in-window period a baseline
        close = market.close_on_or_before(payment["pay"])
        if close and close > 0:
            bought = amount / close
            lots.append((payment["pay"], bought))
            record["drip_added"] += bought
            record["reinvested"] += amount
        else:
            record["cash"] += amount
        events.append((payment["pay"], amount, from_drip))
    return periods, events, sum(bought for _, bought in lots)


def model_reinvestment_history(positions, markets, lags=None, *, view, cutoff_date, pre_cutoff_date,
                               today, period_key, current_key, is_current_partial,
                               tickers=None, single_ticker=None):
    """The ``/api/reinvestment-impact/data`` payload (series, per_ticker, summary) for a model.

    ``positions`` come from ``model_distributions.model_positions`` and
    ``markets`` map ticker -> market payload (split-adjusted closes). ``tickers``
    limits the model to a scope (None = every holding). ``period_key`` maps a
    date to the view's period key.
    """
    lags = lags or {}
    cutoff_key = period_key(cutoff_date)
    agg = defaultdict(_empty_bucket)
    per_ticker = []
    daily_events = []
    total_est_annual = 0.0
    total_drip_held = 0.0
    total_drip_value = 0.0

    for position in positions:
        ticker = position["ticker"]
        if tickers is not None and ticker not in tickers:
            continue
        if position["shares"] <= 0 or not position.get("available", True):
            continue
        _, _, annual = model_income_estimate(position, today)
        total_est_annual += annual
        periods, events, drip_held = _replay_position(
            position, Market(markets.get(ticker) or {}), lags.get(ticker),
            cutoff_key=cutoff_key, pre_cutoff_date=pre_cutoff_date, today=today, period_key=period_key,
        )
        daily_events.extend(events)

        labels, payouts, drip_added, dps_list, counts = [], [], [], [], []
        reinvested = cash = from_drip_total = rate_impact = 0.0
        prev = None  # (base shares, DRIP shares, per-share rate) of the previous period
        for key in sorted(periods):
            record = periods[key]
            if record["dps"] <= 0:
                continue
            s_drip = record["income_from_drip"] / record["dps"]
            s_base = max(0.0, (record["payout"] - record["income_from_drip"]) / record["dps"])
            if key < cutoff_key:
                prev = (s_base, s_drip, record["dps"])
                continue
            bucket = agg[key]
            for field in ("payout", "income_from_drip", "reinvested", "cash", "drip_added"):
                bucket[field] += record[field]
            if prev is not None:
                base0, drip0, dps0 = prev
                d_drip, d_base, d_dps = s_drip - drip0, s_base - base0, record["dps"] - dps0
                bucket["shares_eff"] += d_drip * dps0
                bucket["trades_eff"] += d_base * dps0
                bucket["rate_eff"] += d_dps * (base0 + drip0)
                bucket["price_eff"] += (d_drip + d_base) * d_dps
                rate_impact += d_dps * (base0 + drip0)
            prev = (s_base, s_drip, record["dps"])
            labels.append(key)
            payouts.append(round(record["payout"], 2))
            drip_added.append(round(record["drip_added"], 4))
            dps_list.append(round(record["dps"], 6))
            counts.append(record["count"])
            reinvested += record["reinvested"]
            cash += record["cash"]
            from_drip_total += record["income_from_drip"]

        if not labels:
            continue
        drip_value = round(drip_held * (position.get("price") or 0.0), 2)
        total_drip_held += drip_held
        total_drip_value += drip_value
        covered = reinvested + cash
        per_ticker.append({
            "ticker": ticker,
            "description": (position.get("description") or "")[:40],
            "closed": False,
            "model": True,
            "reinvest": True,
            "accounts_total": 1,
            "accounts_reinvest_on": 1,
            "current_reinvest_pct": 100.0,
            "est_annual_income": round(annual, 2),
            "reinvest_pct": round(100.0 * reinvested / covered, 1) if covered > 1e-9 else 100.0,
            "labels": labels,
            "payout": payouts,
            "drip_shares_added": drip_added,
            "dps": dps_list,
            "payment_counts": counts,
            "total_payout": round(sum(payouts), 2),
            "reinvested_payout": round(reinvested, 2),
            "cash_payout": round(cash, 2),
            "total_drip_shares": round(sum(drip_added), 4),
            "net_drip_shares_held": round(drip_held, 4),
            "drip_shares_value": drip_value,
            "extra_income_from_drip": round(from_drip_total, 2),
            "rate_impact": round(rate_impact, 2),
        })

    labels = sorted(agg)
    payout = [round(agg[k]["payout"], 2) for k in labels]
    from_drip = [round(agg[k]["income_from_drip"], 2) for k in labels]
    reinvested_series = [round(agg[k]["reinvested"], 2) for k in labels]
    cash_series = [round(agg[k]["cash"], 2) for k in labels]
    drip_series = [round(agg[k]["drip_added"], 4) for k in labels]
    partial = [bool(is_current_partial and k == current_key) for k in labels]
    cumulative_shares, benefit, run_shares, run_benefit = [], [], 0.0, 0.0
    for shares_added, extra in zip(drip_series, from_drip):
        run_shares += shares_added
        run_benefit += extra
        cumulative_shares.append(round(run_shares, 4))
        benefit.append(round(run_benefit, 2))
    decomp = {
        "shares": [round(agg[k]["shares_eff"], 2) for k in labels],
        "trades": [round(agg[k]["trades_eff"], 2) for k in labels],
        "rate": [round(agg[k]["rate_eff"], 2) for k in labels],
        "price": [round(agg[k]["price_eff"], 2) for k in labels],
    }

    total_payout = round(sum(payout), 2)
    extra_income = round(sum(from_drip), 2)
    total_nodrip = round(max(0.0, total_payout - extra_income), 2)
    reinvested_total = sum(t["reinvested_payout"] for t in per_ticker)
    cash_total = sum(t["cash_payout"] for t in per_ticker)
    covered_total = reinvested_total + cash_total
    gross = abs(sum(decomp["shares"])) + abs(sum(decomp["rate"])) + abs(sum(decomp["price"]))

    # Realized pace: the last three completed calendar months × 4 (or the last
    # twelve), the same basis the portfolio view uses.
    month_start = today.replace(day=1)
    last_full_day = date.fromordinal(month_start.toordinal() - 1)
    m3_start, m12_start = _shift_months(month_start, -3), _shift_months(month_start, -12)
    earliest = min((day for day, _, _ in daily_events), default=None)
    sum_3m = sum(a for d, a, _ in daily_events if m3_start <= d <= last_full_day)
    drip_3m = sum(x for d, _, x in daily_events if m3_start <= d <= last_full_day)
    sum_12m = sum(a for d, a, _ in daily_events if m12_start <= d <= last_full_day)
    drip_12m = sum(x for d, _, x in daily_events if m12_start <= d <= last_full_day)
    if earliest is not None and earliest <= m3_start and sum_3m > 0:
        realized, pace = round(sum_3m * 4.0, 2), round(drip_3m * 4.0, 2)
        realized_basis = f"{_fmt_month(m3_start)}–{_fmt_month(last_full_day)} × 4"
    elif earliest is not None and earliest <= m12_start and sum_12m > 0:
        realized, pace = round(sum_12m, 2), round(drip_12m, 2)
        realized_basis = f"{_fmt_month(m12_start)}–{_fmt_month(last_full_day)}"
    else:
        completed = [i for i, p in enumerate(partial) if not p]
        ref = completed[-1] if completed else (len(payout) - 1 if payout else None)
        per_year = PERIODS_PER_YEAR[view]
        if ref is None:
            realized, pace, realized_basis = 0.0, 0.0, "no completed periods"
        else:
            realized, pace = round(payout[ref] * per_year, 2), round(from_drip[ref] * per_year, 2)
            realized_basis = f"{labels[ref]} × {per_year}"

    est_annual = round(total_est_annual, 2)
    rate_sorted = sorted((t for t in per_ticker if abs(t["rate_impact"]) > 0.005), key=lambda t: t["rate_impact"])
    rate_cuts = [{"ticker": t["ticker"], "rate_impact": t["rate_impact"]} for t in rate_sorted[:3] if t["rate_impact"] < 0]
    rate_raises = [{"ticker": t["ticker"], "rate_impact": t["rate_impact"]}
                   for t in reversed(rate_sorted[-3:]) if t["rate_impact"] > 0]
    per_ticker.sort(key=lambda t: t["total_payout"], reverse=True)
    if not single_ticker:
        per_ticker = per_ticker[:TOP_TICKERS]

    return {
        "series": {
            "labels": labels,
            "payout": payout,
            "payout_actual": [0.0] * len(labels),
            "payout_reconstructed": payout,
            "payout_source": ["reconstructed"] * len(labels),
            "partial_periods": partial,
            "payout_nodrip": [round(max(0.0, p - x), 2) for p, x in zip(payout, from_drip)],
            "income_from_drip": from_drip,
            "reinvested_amount": reinvested_series,
            "cash_amount": cash_series,
            "drip_benefit_cumulative": benefit,
            "drip_shares_added": drip_series,
            "drip_shares_cumulative": cumulative_shares,
            "decomp": decomp,
        },
        "per_ticker": per_ticker,
        "rate_raises": rate_raises,
        "rate_cuts": rate_cuts,
        "summary": {
            "total_payout": total_payout,
            "total_actual_payout": 0.0,
            "total_reconstructed_payout": total_payout,
            "total_drip_shares": round(sum(drip_series), 4),
            "net_drip_shares_held": round(total_drip_held, 4),
            "drip_shares_value": round(total_drip_value, 2),
            "drip_pct_of_growth": round(100 * sum(decomp["shares"]) / gross, 1) if gross > 1e-9 else 0.0,
            "run_rate": est_annual if est_annual > 0 else realized,
            "run_rate_basis": "model's latest payouts × cadence" if est_annual > 0 else realized_basis,
            "est_annual_income": est_annual,
            "est_monthly_income": round(total_est_annual / 12.0, 2),
            "est_annual_reinvested": est_annual,
            "est_annual_cash": 0.0,
            "realized_run_rate": realized,
            "realized_run_rate_basis": realized_basis,
            "current_drip_pace": pace,
            "current_drip_share_pct": round(100.0 * pace / realized, 1) if realized > 1e-9 else 0.0,
            "has_actual": False,
            "has_reconstructed": bool(labels),
            "has_partial_last": bool(partial and partial[-1]),
            "covers_all_records": False,
            "extra_income_from_drip": extra_income,
            "extra_income_pct": round(100.0 * extra_income / total_nodrip, 1) if total_nodrip > 1e-9 else 0.0,
            "total_nodrip": total_nodrip,
            "pct_reinvested": round(100.0 * reinvested_total / covered_total, 1) if covered_total > 1e-9 else 0.0,
            "current_reinvest_pct": 100.0,
            "reinvested_payout": round(reinvested_total, 2),
            "cash_payout": round(cash_total, 2),
            "drip_off": [],
        },
    }
