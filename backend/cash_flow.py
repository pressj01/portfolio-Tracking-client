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
    "surplus_mode": "cash",
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
           VALUES (?, 20, 3, 15, 0, 'cash')""",
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


def occurrence_count(item, month_start):
    anchor = datetime.date.fromisoformat(item["start_date"])
    end_date = (
        datetime.date.fromisoformat(item["end_date"]) if item["end_date"] else None
    )
    month_end = datetime.date(
        month_start.year,
        month_start.month,
        calendar.monthrange(month_start.year, month_start.month)[1],
    )
    if month_end < anchor or (end_date and month_start > end_date):
        return 0

    frequency = item["frequency"]
    if frequency == "one_time":
        return 1 if anchor.year == month_start.year and anchor.month == month_start.month else 0
    if frequency in {"weekly", "biweekly"}:
        return _weekly_occurrences(
            anchor,
            month_start,
            month_end,
            FREQUENCIES[frequency],
            end_date,
        )

    anchor_month = anchor.replace(day=1)
    diff = month_difference(anchor_month, month_start)
    interval = FREQUENCIES[frequency]
    return 1 if diff >= 0 and diff % interval == 0 else 0


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
            count = occurrence_count(row, month)
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


def scenario_factors(scenario, month_number):
    """Distribution and price factors matching the Income Growth Simulator."""
    years = max(0.0, month_number / 12.0)
    if scenario == "bullish":
        return 1.04 ** years, 1.08 ** years
    if scenario == "bearish":
        if month_number <= 12:
            phase = month_number / 12.0
            return 0.65 ** phase, 0.75 ** phase
        recovery_years = (month_number - 12) / 12.0
        return 0.65 * (1.04 ** recovery_years), 0.75 * (1.08 ** recovery_years)
    return 1.01 ** years, 1.03 ** years


def simulate_sustainability(
    cash_flow_series,
    *,
    portfolio_value,
    annual_portfolio_income,
    portfolio_tax_pct=15.0,
    starting_cash=0.0,
    surplus_mode="cash",
    scenario="neutral",
    include_additional_income=True,
):
    """Run one deterministic monthly sustainability path."""
    base_value = max(0.0, float(portfolio_value or 0))
    base_monthly_income = max(0.0, float(annual_portfolio_income or 0)) / 12.0
    shares = 1.0 if base_value > 0 else 0.0
    cash = max(0.0, float(starting_cash or 0))
    tax_factor = 1.0 - max(0.0, min(95.0, float(portfolio_tax_pct))) / 100.0
    principal_drawn = 0.0
    worst_gap = 0.0
    depletion_month = None
    ever_sold = False
    path = []

    for index, cash_flow in enumerate(cash_flow_series, start=1):
        distribution_factor, price_factor = scenario_factors(scenario, index)
        unit_value = base_value * price_factor
        portfolio_before = unit_value * shares
        portfolio_income = base_monthly_income * distribution_factor * shares * tax_factor
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
                shares += net / unit_value
            else:
                cash += net
        else:
            gap = -net
            worst_gap = max(worst_gap, gap)
            cash_used = min(cash, gap)
            cash -= cash_used
            gap -= cash_used
            if gap > 0 and unit_value > 0 and shares > 0:
                sale = min(gap, unit_value * shares)
                shares -= sale / unit_value
                principal_drawn += sale
                gap -= sale
                ever_sold = ever_sold or sale > 0.005
            if gap > 0.005:
                unfunded = gap
                if depletion_month is None:
                    depletion_month = index

        portfolio_after = max(0.0, unit_value * shares)
        path.append(
            {
                "month": cash_flow["month"],
                "portfolio": round(portfolio_after, 2),
                "cash": round(cash, 2),
                "expenses": round(expenses, 2),
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
        "series": path,
    }
