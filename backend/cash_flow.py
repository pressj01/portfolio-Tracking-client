"""Shared cash-flow scheduling and sustainability calculations.

The functions in this module are deliberately Flask-free. API routes, tests,
and other portfolio tools can all use the same recurrence expansion and avoid
silently calculating different monthly spending needs.
"""

import calendar
import datetime
import math


FREQUENCIES = {
    "one_time": None,
    "weekly": 7,
    "biweekly": 14,
    "monthly": 1,
    "quarterly": 3,
    "semiannual": 6,
    "annual": 12,
}

DEFAULT_SETTINGS = {
    "horizon_years": 20,
    "expense_inflation_pct": 3.0,
    "portfolio_tax_pct": 15.0,
    "starting_cash_cents": 0,
    "surplus_mode": "reinvest",
}


# Cash-flow projections keep the two parts of an income portfolio separate:
# holding values move with the market, while owned shares generate cash
# distributions at their current run rate. Distributions are not deducted from
# the holding value a second time. Only a genuine cash-flow shortfall can sell
# shares and reduce ownership.
#
# Rates are deterministic planning assumptions, not forecasts. The important
# behavior is the separation of payout changes from market-price changes and
# the different stress applied to each income strategy.
HOLDING_SCENARIO_PROFILES = {
    "option_income": {
        "label": "Diversified option income",
        "bullish": {"income_growth": 0.02, "total_return": 0.10},
        "neutral": {"income_growth": 0.00, "total_return": 0.07},
        "bearish": {
            "income_shock": -0.10,
            "total_return": -0.18,
            "recovery_income_growth": 0.02,
            "recovery_total_return": 0.08,
        },
    },
    "high_distribution_option": {
        "label": "High-distribution / concentrated option income",
        "bullish": {"income_growth": 0.00, "total_return": 0.11},
        "neutral": {"income_growth": -0.04, "total_return": 0.07},
        "bearish": {
            "income_shock": -0.20,
            "total_return": -0.30,
            "recovery_income_growth": 0.00,
            "recovery_total_return": 0.08,
        },
    },
    "fixed_income": {
        "label": "Bonds / fixed income",
        "bullish": {"income_growth": 0.005, "total_return": 0.05},
        "neutral": {"income_growth": 0.00, "total_return": 0.05},
        "bearish": {
            "income_shock": -0.02,
            "total_return": -0.03,
            "recovery_income_growth": 0.01,
            "recovery_total_return": 0.05,
        },
    },
    "cash": {
        "label": "Cash / money market",
        "bullish": {"income_growth": 0.00, "total_return": 0.04},
        "neutral": {"income_growth": 0.00, "total_return": 0.035},
        "bearish": {
            "income_shock": -0.20,
            "total_return": 0.03,
            "recovery_income_growth": 0.00,
            "recovery_total_return": 0.03,
        },
    },
    "preferred_credit": {
        "label": "Preferred stock / credit",
        "bullish": {"income_growth": 0.01, "total_return": 0.07},
        "neutral": {"income_growth": 0.00, "total_return": 0.06},
        "bearish": {
            "income_shock": -0.08,
            "total_return": -0.12,
            "recovery_income_growth": 0.01,
            "recovery_total_return": 0.07,
        },
    },
    "bdc": {
        "label": "BDCs",
        "bullish": {"income_growth": 0.03, "total_return": 0.10},
        "neutral": {"income_growth": 0.01, "total_return": 0.08},
        "bearish": {
            "income_shock": -0.15,
            "total_return": -0.25,
            "recovery_income_growth": 0.03,
            "recovery_total_return": 0.09,
        },
    },
    "cef": {
        "label": "Closed-end funds",
        "bullish": {"income_growth": 0.01, "total_return": 0.08},
        "neutral": {"income_growth": 0.00, "total_return": 0.07},
        "bearish": {
            "income_shock": -0.10,
            "total_return": -0.18,
            "recovery_income_growth": 0.02,
            "recovery_total_return": 0.08,
        },
    },
    "reit": {
        "label": "REITs / real estate",
        "bullish": {"income_growth": 0.03, "total_return": 0.10},
        "neutral": {"income_growth": 0.02, "total_return": 0.08},
        "bearish": {
            "income_shock": -0.12,
            "total_return": -0.25,
            "recovery_income_growth": 0.03,
            "recovery_total_return": 0.09,
        },
    },
    "dividend_growth": {
        "label": "Dividend growth",
        "bullish": {"income_growth": 0.05, "total_return": 0.10},
        "neutral": {"income_growth": 0.03, "total_return": 0.08},
        "bearish": {
            "income_shock": -0.06,
            "total_return": -0.20,
            "recovery_income_growth": 0.04,
            "recovery_total_return": 0.09,
        },
    },
    "equity_income": {
        "label": "Equity income",
        "bullish": {"income_growth": 0.03, "total_return": 0.09},
        "neutral": {"income_growth": 0.015, "total_return": 0.07},
        "bearish": {
            "income_shock": -0.10,
            "total_return": -0.22,
            "recovery_income_growth": 0.03,
            "recovery_total_return": 0.08,
        },
    },
    "commodities": {
        "label": "Commodities / natural resources",
        "bullish": {"income_growth": 0.01, "total_return": 0.09},
        "neutral": {"income_growth": 0.00, "total_return": 0.06},
        "bearish": {
            "income_shock": -0.10,
            "total_return": -0.20,
            "recovery_income_growth": 0.02,
            "recovery_total_return": 0.08,
        },
    },
    "non_income_equity": {
        "label": "Growth / non-income equity",
        "bullish": {"income_growth": 0.00, "total_return": 0.11},
        "neutral": {"income_growth": 0.00, "total_return": 0.08},
        "bearish": {
            "income_shock": 0.00,
            "total_return": -0.25,
            "recovery_income_growth": 0.00,
            "recovery_total_return": 0.09,
        },
    },
    "other": {
        "label": "Other / unclassified",
        "bullish": {"income_growth": 0.02, "total_return": 0.08},
        "neutral": {"income_growth": 0.01, "total_return": 0.06},
        "bearish": {
            "income_shock": -0.10,
            "total_return": -0.20,
            "recovery_income_growth": 0.02,
            "recovery_total_return": 0.07,
        },
    },
}


def classify_holding_scenario_type(holding):
    """Classify one holding for cash-flow scenario behavior.

    Structured fund metadata wins over text heuristics.  Current yield is used
    only to separate very high-distribution option strategies, whose payout and
    NAV paths should not be treated like diversified covered-call funds.
    """
    ticker = str(holding.get("ticker") or "").strip().upper()
    description = str(holding.get("description") or "")
    classification = str(holding.get("classification_type") or "")
    strategy = str(holding.get("etf_strategy") or "")
    category = str(holding.get("etf_category") or "")
    fund_kind = str(holding.get("fund_kind") or "")
    income_bucket = str(holding.get("income_bucket") or "")
    text = " ".join(
        [ticker, description, classification, strategy, category, fund_kind, income_bucket]
    ).lower().replace("-", " ").replace("_", " ")
    annual_income = max(0.0, float(holding.get("annual_income") or 0))
    value = max(0.0, float(holding.get("value") or 0))
    current_yield = annual_income / value if value > 0 else 0.0

    if classification.strip().upper() == "MONEYMARKET" or any(
        phrase in text for phrase in ("money market", "money mkt", "t bill cash")
    ):
        return "cash"

    option_income = (
        strategy.strip().lower() == "options income"
        or fund_kind.strip().lower() == "option income"
        or "covered call / options income" in income_bucket.lower()
        or any(
            phrase in text
            for phrase in (
                "option income",
                "options income",
                "covered call",
                "premium income",
                "derivative income",
                "yieldmax",
                "yield premium",
                "income blast",
                "tappalpha",
            )
        )
    )
    if option_income:
        aggressive = (
            current_yield >= 0.20
            or any(
                phrase in text
                for phrase in (
                    "single stock",
                    "leveraged equity",
                    "crypto",
                    "bitcoin",
                    "ethereum",
                    "2x",
                    "3% monthly",
                )
            )
        )
        return "high_distribution_option" if aggressive else "option_income"

    if classification.strip().upper() == "BDC" or strategy.strip().upper() == "BDC" or (
        "business development" in text or "bdcs" in income_bucket.lower()
    ):
        return "bdc"
    if classification.strip().upper() == "REIT" or any(
        phrase in text for phrase in ("reits / real estate", "real estate", "realty income")
    ):
        return "reit"
    if strategy.strip().lower() == "preferred" or any(
        phrase in text
        for phrase in ("preferred stock / credit", "preferred stock", " pfd", "credit opportunities")
    ):
        return "preferred_credit"
    if "bonds / fixed income" in income_bucket.lower() or any(
        phrase in text
        for phrase in (
            "bond",
            "fixed income",
            "treasury",
            "municipal",
            " muni ",
            "clo",
            "short term corp",
        )
    ):
        return "fixed_income"

    cef_by_name = (
        not ticker.endswith("X")
        and classification.strip().upper() not in {"ETF", "REIT", "BDC"}
        and any(phrase in text for phrase in (" fund", " trust"))
    )
    if (
        strategy.strip().upper() == "CEF"
        or fund_kind.strip().lower() == "cef"
        or "cefs" in income_bucket.lower()
        or "closed end" in text
        or cef_by_name
    ):
        return "cef"
    if "commodities / gold & silver" in income_bucket.lower() or any(
        phrase in text
        for phrase in ("commodity", "gold", "silver", "natural resources", "midstream")
    ):
        return "commodities"
    if "dividend growth" in income_bucket.lower() or any(
        phrase in text
        for phrase in ("dividend growth", "dividend appreciation", "aristocrat", "quality dividend")
    ):
        return "dividend_growth"
    if annual_income > 0:
        return "equity_income"
    if classification.strip().upper() in {"ETF", "STOCK", "EQUITY", "NONE", ""}:
        return "non_income_equity"
    return "other"


def _holding_profile(holding):
    scenario_type = holding.get("scenario_type") or classify_holding_scenario_type(holding)
    return scenario_type, HOLDING_SCENARIO_PROFILES.get(
        scenario_type, HOLDING_SCENARIO_PROFILES["other"]
    )


def holding_income_factor(holding, scenario, month_number):
    """Return the payout factor for one holding at a simulation month."""
    _, profile = _holding_profile(holding)
    scenario = scenario if scenario in {"bullish", "neutral", "bearish"} else "neutral"
    assumptions = profile[scenario]
    years = max(0.0, float(month_number) / 12.0)
    if scenario != "bearish":
        return (1.0 + assumptions["income_growth"]) ** years
    if month_number <= 12:
        return (1.0 + assumptions["income_shock"]) ** years
    recovery_years = (float(month_number) - 12.0) / 12.0
    return (1.0 + assumptions["income_shock"]) * (
        1.0 + assumptions["recovery_income_growth"]
    ) ** recovery_years


def holding_monthly_market_return(holding, scenario, month_number):
    """Return the monthly market-value change for one holding."""
    _, profile = _holding_profile(holding)
    scenario = scenario if scenario in {"bullish", "neutral", "bearish"} else "neutral"
    assumptions = profile[scenario]
    if scenario == "bearish" and month_number > 12:
        annual_rate = assumptions["recovery_total_return"]
    else:
        annual_rate = assumptions["total_return"]
    return (1.0 + annual_rate) ** (1.0 / 12.0) - 1.0


def holding_monthly_total_return(holding, scenario, month_number):
    """Backward-compatible alias for the market-return assumption."""
    return holding_monthly_market_return(holding, scenario, month_number)


def portfolio_scenario_assumptions(portfolio_holdings, scenario):
    """Summarize weighted assumptions and the holding-type mix for the UI."""
    holdings = list(portfolio_holdings or [])
    total_value = sum(max(0.0, float(row.get("value") or 0)) for row in holdings)
    total_income = sum(
        max(0.0, float(row.get("annual_income") or 0)) for row in holdings
    )
    income_factor = 0.0
    market_return = 0.0
    grouped = {}
    for row in holdings:
        value = max(0.0, float(row.get("value") or 0))
        income = max(0.0, float(row.get("annual_income") or 0))
        scenario_type, profile = _holding_profile(row)
        assumptions = profile[scenario]
        year_one_return = assumptions["total_return"]
        year_one_income_factor = holding_income_factor(row, scenario, 12)
        income_factor += income * year_one_income_factor
        market_return += value * year_one_return
        bucket = grouped.setdefault(
            scenario_type,
            {
                "key": scenario_type,
                "label": profile["label"],
                "value": 0.0,
                "annual_income": 0.0,
                "holding_count": 0,
                "year_one_income_change_pct": round(
                    (year_one_income_factor - 1.0) * 100.0, 1
                ),
                "year_one_total_return_pct": round(year_one_return * 100.0, 1),
                "year_one_market_return_pct": round(year_one_return * 100.0, 1),
            },
        )
        bucket["value"] += value
        bucket["annual_income"] += income
        bucket["holding_count"] += 1

    mix = []
    for bucket in grouped.values():
        bucket["value"] = round(bucket["value"], 2)
        bucket["annual_income"] = round(bucket["annual_income"], 2)
        bucket["value_pct"] = round(
            bucket["value"] / total_value * 100.0, 1
        ) if total_value > 0 else 0.0
        bucket["income_pct"] = round(
            bucket["annual_income"] / total_income * 100.0, 1
        ) if total_income > 0 else 0.0
        mix.append(bucket)
    mix.sort(key=lambda row: (-row["annual_income"], -row["value"], row["label"]))

    return {
        "scenario": scenario,
        "year_one_income_change_pct": round(
            (income_factor / total_income - 1.0) * 100.0, 1
        ) if total_income > 0 else 0.0,
        "year_one_total_return_pct": round(
            market_return / total_value * 100.0, 1
        ) if total_value > 0 else 0.0,
        "year_one_market_return_pct": round(
            market_return / total_value * 100.0, 1
        ) if total_value > 0 else 0.0,
        "mix": mix,
        "method": "holding_level_market_plus_distributions",
    }


def parse_month(value):
    """Return the first day of a YYYY-MM month."""
    try:
        return datetime.datetime.strptime(str(value), "%Y-%m").date().replace(day=1)
    except (TypeError, ValueError):
        raise ValueError("Month must use YYYY-MM format.")


def parse_date(value, field_name="Date", required=False):
    if value in (None, ""):
        if required:
            raise ValueError(f"{field_name} is required.")
        return None
    try:
        return datetime.date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must use YYYY-MM-DD format.")


def add_months(value, count):
    total = value.year * 12 + value.month - 1 + int(count)
    year, month_zero = divmod(total, 12)
    return datetime.date(year, month_zero + 1, 1)


def _item_value(item, key, default=None):
    try:
        value = item[key]
    except (KeyError, IndexError, TypeError):
        value = default
    return default if value is None else value


def _date_in_month(anchor, month_start):
    day = min(
        anchor.day,
        calendar.monthrange(month_start.year, month_start.month)[1],
    )
    return datetime.date(month_start.year, month_start.month, day)


def _expense_anchor(item):
    return datetime.date.fromisoformat(
        str(_item_value(item, "due_date") or _item_value(item, "start_date"))
    )


def _pay_date_for_due(item, due_date):
    anchor_due = _expense_anchor(item)
    raw_pay_date = _item_value(item, "pay_date")
    anchor_pay = (
        datetime.date.fromisoformat(str(raw_pay_date))
        if raw_pay_date
        else anchor_due - datetime.timedelta(days=2)
    )
    return due_date + (anchor_pay - anchor_due)


def month_difference(start, end):
    return (end.year - start.year) * 12 + end.month - start.month


def money_to_cents(value, field_name="Amount"):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a number.")
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{field_name} cannot be negative.")
    if number > 1_000_000_000:
        raise ValueError(f"{field_name} is too large.")
    return int(round(number * 100))


def cents_to_money(value):
    return round(int(value or 0) / 100.0, 2)


def get_or_create_default_plan(conn, scope_type, scope_id):
    row = conn.execute(
        """SELECT * FROM cash_flow_plans
           WHERE scope_type = ? AND scope_id = ?
           ORDER BY is_default DESC, id ASC LIMIT 1""",
        (scope_type, int(scope_id)),
    ).fetchone()
    if row:
        ensure_settings(conn, row["id"])
        return row

    cur = conn.execute(
        """INSERT INTO cash_flow_plans
           (name, scope_type, scope_id, is_default)
           VALUES ('Monthly Cash Flow', ?, ?, 1)""",
        (scope_type, int(scope_id)),
    )
    ensure_settings(conn, cur.lastrowid)
    conn.commit()
    return conn.execute(
        "SELECT * FROM cash_flow_plans WHERE id = ?", (cur.lastrowid,)
    ).fetchone()


def ensure_settings(conn, plan_id):
    conn.execute(
        """INSERT OR IGNORE INTO cash_flow_settings
           (plan_id, horizon_years, expense_inflation_pct, portfolio_tax_pct,
            starting_cash_cents, surplus_mode)
           VALUES (?, 20, 3, 15, 0, 'reinvest')""",
        (int(plan_id),),
    )


def settings_for_plan(conn, plan_id):
    ensure_settings(conn, plan_id)
    row = conn.execute(
        "SELECT * FROM cash_flow_settings WHERE plan_id = ?", (int(plan_id),)
    ).fetchone()
    return {
        "plan_id": int(plan_id),
        "horizon_years": int(row["horizon_years"]),
        "expense_inflation_pct": float(row["expense_inflation_pct"]),
        "portfolio_tax_pct": float(row["portfolio_tax_pct"]),
        "starting_cash_cents": int(row["starting_cash_cents"]),
        "starting_cash": cents_to_money(row["starting_cash_cents"]),
        "surplus_mode": row["surplus_mode"],
    }


def serialize_plan(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "scope_type": row["scope_type"],
        "scope_id": row["scope_id"],
        "is_default": bool(row["is_default"]),
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def serialize_item(row):
    return {
        "id": row["id"],
        "plan_id": row["plan_id"],
        "kind": row["kind"],
        "name": row["name"],
        "category": row["category"] or "",
        "amount": cents_to_money(row["amount_cents"]),
        "frequency": row["frequency"],
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "due_date": _item_value(row, "due_date"),
        "pay_date": _item_value(row, "pay_date"),
        "essential": bool(row["essential"]),
        "tax_rate_pct": row["tax_rate_pct"],
        "annual_change_pct": row["annual_change_pct"],
        "notes": row["notes"] or "",
        "active": bool(row["active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def validate_item_payload(data, today=None):
    today = today or datetime.date.today()
    kind = str(data.get("kind", "")).strip().lower()
    if kind not in {"expense", "income"}:
        raise ValueError("Type must be expense or income.")

    name = str(data.get("name", "")).strip()
    if not name:
        raise ValueError("Name is required.")
    if len(name) > 120:
        raise ValueError("Name must be 120 characters or less.")

    category = str(data.get("category", "") or "").strip()
    if len(category) > 80:
        raise ValueError("Category must be 80 characters or less.")

    frequency = str(data.get("frequency", "monthly")).strip().lower()
    if frequency not in FREQUENCIES:
        raise ValueError("Unsupported frequency.")

    start_default = today.isoformat()
    start_date = parse_date(
        data.get("start_date") or start_default, "Start date", required=True
    )
    end_date = parse_date(data.get("end_date"), "End date")
    if end_date and end_date < start_date:
        raise ValueError("End date cannot be before the start date.")

    if kind == "expense":
        due_date = parse_date(
            data.get("due_date") or start_date.isoformat(),
            "Due date",
            required=True,
        )
        pay_date = parse_date(data.get("pay_date"), "Pay date")
        if pay_date is None:
            pay_date = due_date - datetime.timedelta(days=2)
    else:
        due_date = None
        pay_date = None

    tax_rate = data.get("tax_rate_pct")
    if tax_rate in ("", None):
        tax_rate = None
    else:
        try:
            tax_rate = float(tax_rate)
        except (TypeError, ValueError):
            raise ValueError("Tax rate must be a number.")
        if not 0 <= tax_rate <= 95:
            raise ValueError("Tax rate must be between 0 and 95.")

    annual_change = data.get("annual_change_pct")
    if annual_change in ("", None):
        annual_change = None
    else:
        try:
            annual_change = float(annual_change)
        except (TypeError, ValueError):
            raise ValueError("Annual change must be a number.")
        if not -100 <= annual_change <= 100:
            raise ValueError("Annual change must be between -100 and 100.")

    notes = str(data.get("notes", "") or "").strip()
    if len(notes) > 1000:
        raise ValueError("Notes must be 1,000 characters or less.")

    return {
        "kind": kind,
        "name": name,
        "category": category or None,
        "amount_cents": money_to_cents(data.get("amount", 0)),
        "frequency": frequency,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat() if end_date else None,
        "due_date": due_date.isoformat() if due_date else None,
        "pay_date": pay_date.isoformat() if pay_date else None,
        "essential": 1 if data.get("essential") and kind == "expense" else 0,
        "tax_rate_pct": tax_rate if kind == "income" else None,
        "annual_change_pct": annual_change,
        "notes": notes or None,
        "active": 0 if data.get("active") is False else 1,
    }


def _weekly_occurrences(anchor, month_start, month_end, interval_days, end_date):
    first = max(anchor, month_start)
    delta = (first - anchor).days
    remainder = delta % interval_days
    if remainder:
        first += datetime.timedelta(days=interval_days - remainder)
    if first > month_end or (end_date and first > end_date):
        return 0
    last = min(month_end, end_date) if end_date else month_end
    return ((last - first).days // interval_days) + 1


def occurrence_dates(item, month_start):
    """Return scheduled occurrence dates within one calendar month."""
    start_date = datetime.date.fromisoformat(item["start_date"])
    anchor = (
        _expense_anchor(item)
        if _item_value(item, "kind") == "expense"
        else start_date
    )
    end_date = (
        datetime.date.fromisoformat(item["end_date"]) if item["end_date"] else None
    )
    month_end = datetime.date(
        month_start.year,
        month_start.month,
        calendar.monthrange(month_start.year, month_start.month)[1],
    )
    if month_end < start_date or month_end < anchor or (
        end_date and month_start > end_date
    ):
        return []

    frequency = item["frequency"]
    if frequency == "one_time":
        if (
            anchor.year == month_start.year
            and anchor.month == month_start.month
            and anchor >= start_date
            and (not end_date or anchor <= end_date)
        ):
            return [anchor]
        return []
    if frequency in {"weekly", "biweekly"}:
        interval = FREQUENCIES[frequency]
        first = max(anchor, start_date, month_start)
        remainder = (first - anchor).days % interval
        if remainder:
            first += datetime.timedelta(days=interval - remainder)
        last = min(month_end, end_date) if end_date else month_end
        dates = []
        candidate = first
        while candidate <= last:
            dates.append(candidate)
            candidate += datetime.timedelta(days=interval)
        return dates

    anchor_month = anchor.replace(day=1)
    diff = month_difference(anchor_month, month_start)
    interval = FREQUENCIES[frequency]
    if diff < 0 or diff % interval != 0:
        return []
    candidate = _date_in_month(anchor, month_start)
    if candidate < start_date or (end_date and candidate > end_date):
        return []
    return [candidate]


def occurrence_count(item, month_start):
    return len(occurrence_dates(item, month_start))


def next_bill_schedule(item, today=None):
    """Return the open bill occurrence on or after today.

    A paid flag can be attached to the returned due date. On the day after that
    date, this function advances to the next occurrence automatically.
    """
    if _item_value(item, "kind") != "expense":
        return {"due_date": None, "pay_date": None}

    today = today or datetime.date.today()
    start_date = datetime.date.fromisoformat(item["start_date"])
    end_date = (
        datetime.date.fromisoformat(item["end_date"]) if item["end_date"] else None
    )
    anchor = _expense_anchor(item)
    reference = max(today, start_date)
    frequency = item["frequency"]

    if frequency == "one_time":
        candidate = anchor
    elif frequency in {"weekly", "biweekly"}:
        interval = FREQUENCIES[frequency]
        if reference <= anchor:
            candidate = anchor
        else:
            elapsed = (reference - anchor).days
            steps = (elapsed + interval - 1) // interval
            candidate = anchor + datetime.timedelta(days=steps * interval)
    else:
        interval = FREQUENCIES[frequency]
        if reference <= anchor:
            candidate = anchor
        else:
            anchor_month = anchor.replace(day=1)
            reference_month = reference.replace(day=1)
            elapsed_months = max(0, month_difference(anchor_month, reference_month))
            steps = elapsed_months // interval
            candidate_month = add_months(anchor_month, steps * interval)
            candidate = _date_in_month(anchor, candidate_month)
            if candidate < reference:
                candidate_month = add_months(candidate_month, interval)
                candidate = _date_in_month(anchor, candidate_month)

    if candidate < start_date:
        return {"due_date": None, "pay_date": None}
    if candidate < reference or (end_date and candidate > end_date):
        return {"due_date": None, "pay_date": None}
    return {
        "due_date": candidate.isoformat(),
        "pay_date": _pay_date_for_due(item, candidate).isoformat(),
    }


def expand_plan(conn, plan_id, start_month, months):
    """Expand saved cash-flow rules into exact monthly totals."""
    start = parse_month(start_month) if not isinstance(start_month, datetime.date) else start_month.replace(day=1)
    month_count = max(1, min(600, int(months)))
    settings = settings_for_plan(conn, plan_id)
    items = conn.execute(
        """SELECT * FROM cash_flow_items
           WHERE plan_id = ? AND active = 1
           ORDER BY kind, name, id""",
        (int(plan_id),),
    ).fetchall()
    overrides = conn.execute(
        """SELECT o.* FROM cash_flow_month_overrides o
           JOIN cash_flow_items i ON i.id = o.item_id
           WHERE i.plan_id = ?""",
        (int(plan_id),),
    ).fetchall()
    override_map = {(row["item_id"], row["month"]): row for row in overrides}

    series = []
    for offset in range(month_count):
        month = add_months(start, offset)
        month_key = month.strftime("%Y-%m")
        expense_cents = 0
        income_gross_cents = 0
        income_net_cents = 0
        detail = []

        for row in items:
            scheduled_dates = occurrence_dates(row, month)
            count = len(scheduled_dates)
            override = override_map.get((row["id"], month_key))
            if override and override["excluded"]:
                count = 0
            if not count and not (override and override["amount_cents"] is not None):
                continue

            if override and override["amount_cents"] is not None:
                amount_cents = int(override["amount_cents"])
            else:
                annual_change = row["annual_change_pct"]
                if annual_change is None:
                    annual_change = (
                        settings["expense_inflation_pct"]
                        if row["kind"] == "expense"
                        else 0.0
                    )
                anchor_month = datetime.date.fromisoformat(row["start_date"]).replace(day=1)
                elapsed_years = max(0, month_difference(anchor_month, month)) / 12.0
                factor = (1.0 + float(annual_change) / 100.0) ** elapsed_years
                amount_cents = int(round(int(row["amount_cents"]) * count * factor))

            if row["kind"] == "expense":
                expense_cents += amount_cents
                net_cents = amount_cents
            else:
                income_gross_cents += amount_cents
                tax_rate = float(row["tax_rate_pct"] or 0)
                net_cents = int(round(amount_cents * (1.0 - tax_rate / 100.0)))
                income_net_cents += net_cents

            detail.append(
                {
                    "id": row["id"],
                    "kind": row["kind"],
                    "name": row["name"],
                    "category": row["category"] or "",
                    "amount": cents_to_money(amount_cents),
                    "net_amount": cents_to_money(net_cents),
                    "paid": bool(override["paid"]) if override else False,
                    "due_dates": [
                        value.isoformat() for value in scheduled_dates
                    ] if row["kind"] == "expense" else [],
                    "pay_dates": [
                        _pay_date_for_due(row, value).isoformat()
                        for value in scheduled_dates
                    ] if row["kind"] == "expense" else [],
                }
            )

        series.append(
            {
                "month": month_key,
                "expenses": cents_to_money(expense_cents),
                "additional_income_gross": cents_to_money(income_gross_cents),
                "additional_income_net": cents_to_money(income_net_cents),
                "portfolio_required": cents_to_money(
                    max(0, expense_cents - income_net_cents)
                ),
                "items": detail,
            }
        )
    return series


def simulate_sustainability(
    cash_flow_series,
    *,
    portfolio_value,
    annual_portfolio_income,
    portfolio_holdings=None,
    portfolio_tax_pct=15.0,
    starting_cash=0.0,
    surplus_mode="reinvest",
    scenario="neutral",
    include_additional_income=True,
):
    """Run one deterministic, holding-aware monthly sustainability path."""
    base_value = max(0.0, float(portfolio_value or 0))
    base_annual_income = max(0.0, float(annual_portfolio_income or 0))
    holdings = []
    for index, source in enumerate(portfolio_holdings or []):
        value = max(0.0, float(source.get("value") or 0))
        if value <= 0:
            continue
        row = dict(source)
        row["value"] = value
        row["annual_income"] = max(0.0, float(source.get("annual_income") or 0))
        row["distribution_yield"] = (
            row["annual_income"] / value if value > 0 else 0.0
        )
        row["scenario_type"] = (
            source.get("scenario_type") or classify_holding_scenario_type(row)
        )
        row["_key"] = f"{row.get('ticker') or 'holding'}:{index}"
        holdings.append(row)

    # Preserve the public helper's old aggregate-only calling convention while
    # using the same total-return accounting as the holding-aware API path.
    if not holdings and base_value > 0:
        holdings = [
            {
                "ticker": "PORTFOLIO",
                "value": base_value,
                "annual_income": base_annual_income,
                "distribution_yield": (
                    base_annual_income / base_value if base_value > 0 else 0.0
                ),
                "scenario_type": "other",
                "_key": "PORTFOLIO:0",
            }
        ]
    elif holdings:
        base_value = sum(row["value"] for row in holdings)
        base_annual_income = sum(row["annual_income"] for row in holdings)

    unit_values = {row["_key"]: row["value"] for row in holdings}
    ownership = 1.0 if base_value > 0 else 0.0
    cash = max(0.0, float(starting_cash or 0))
    tax_factor = 1.0 - max(0.0, min(95.0, float(portfolio_tax_pct))) / 100.0
    principal_drawn = 0.0
    worst_gap = 0.0
    depletion_month = None
    ever_sold = False
    path = []

    for index, cash_flow in enumerate(cash_flow_series, start=1):
        full_portfolio_income_gross = 0.0
        for holding in holdings:
            key = holding["_key"]
            monthly_market_return = holding_monthly_market_return(
                holding, scenario, index
            )
            opening_value = unit_values[key]
            unit_values[key] = max(
                0.0, opening_value * (1.0 + monthly_market_return)
            )
            # The current distribution yield establishes the cash run rate for
            # the shares already owned. Market movement changes their value but
            # does not consume that cash distribution. Payout scenarios adjust
            # the per-share run rate independently.
            scheduled_distribution = (
                holding["value"]
                * holding["distribution_yield"]
                * holding_income_factor(holding, scenario, index)
                / 12.0
            )
            full_portfolio_income_gross += max(0.0, scheduled_distribution)

        unit_value = sum(unit_values.values())
        portfolio_before = unit_value * ownership
        portfolio_income_gross = full_portfolio_income_gross * ownership
        portfolio_income = portfolio_income_gross * tax_factor
        outside_income = (
            float(cash_flow["additional_income_net"])
            if include_additional_income
            else 0.0
        )
        expenses = float(cash_flow["expenses"])
        net = portfolio_income + outside_income - expenses
        unfunded = 0.0

        if net >= 0:
            if surplus_mode == "reinvest" and unit_value > 0:
                ownership += net / unit_value
            else:
                cash += net
        else:
            gap = -net
            worst_gap = max(worst_gap, gap)
            cash_used = min(cash, gap)
            cash -= cash_used
            gap -= cash_used
            if gap > 0 and unit_value > 0 and ownership > 0:
                sale = min(gap, unit_value * ownership)
                ownership -= sale / unit_value
                principal_drawn += sale
                gap -= sale
                ever_sold = ever_sold or sale > 0.005
            if gap > 0.005:
                unfunded = gap
                if depletion_month is None:
                    depletion_month = index

        portfolio_after = max(0.0, unit_value * ownership)
        path.append(
            {
                "month": cash_flow["month"],
                "portfolio": round(portfolio_after, 2),
                "cash": round(cash, 2),
                "expenses": round(expenses, 2),
                "portfolio_income_gross": round(portfolio_income_gross, 2),
                "portfolio_income": round(portfolio_income, 2),
                "additional_income": round(outside_income, 2),
                "unfunded": round(unfunded, 2),
            }
        )

    ending_portfolio = path[-1]["portfolio"] if path else base_value
    ending_cash = path[-1]["cash"] if path else cash
    if depletion_month is not None:
        status = "not_sustainable"
    elif ever_sold:
        status = "funded_from_principal"
    else:
        status = "income_covered"

    return {
        "scenario": scenario,
        "include_additional_income": bool(include_additional_income),
        "status": status,
        "ending_portfolio": round(ending_portfolio, 2),
        "ending_cash": round(ending_cash, 2),
        "principal_drawn": round(principal_drawn, 2),
        "worst_monthly_gap": round(worst_gap, 2),
        "depletion_month": depletion_month,
        "months_funded": (
            depletion_month - 1 if depletion_month is not None else len(cash_flow_series)
        ),
        "starting_portfolio": round(base_value, 2),
        "starting_annual_income": round(base_annual_income, 2),
        "starting_distribution_yield_pct": round(
            base_annual_income / base_value * 100.0, 2
        ) if base_value > 0 else 0.0,
        "ending_value_retained_pct": round(
            ending_portfolio / base_value * 100.0, 1
        ) if base_value > 0 else 0.0,
        "series": path,
    }
