"""Shared cash-flow scheduling and sustainability calculations.

The functions in this module are deliberately Flask-free. API routes, tests,
and other portfolio tools can all use the same recurrence expansion and avoid
silently calculating different monthly spending needs.
"""

import calendar
import csv
import datetime
import io
import json
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


# Shared strategy registries used by portfolio cash-flow tools and the
# accumulation simulator.  Text descriptions from quote providers are often
# too terse to expose an ETF's option overlay (QQQI and SPYI are common
# examples), so known products are classified before falling back to text.
OPTION_INCOME_TICKERS = frozenset({
    # JPM / Global X / classic covered call
    "JEPI", "JEPQ", "JEPY", "QYLD", "XYLD", "RYLD", "DJIA", "QYLG",
    "XYLG", "TYLG", "EDGQ", "EDGX", "QRMI", "XRMI", "QCLR", "XCLR",
    "DIVO", "PUTW",
    # Amplify / XFunds / Nicholas Wealth
    "BAGY", "BITY", "QDVO", "IDVO", "HCOW", "HAKY", "ETTY", "SLJY",
    "GIAX", "BLOX", "FIAX", "FIZY", "WEPN", "NUKX", "GLDN", "SLVX",
    # NEOS option-income and hedged-income
    "SPYI", "QQQI", "IWMI", "IYRI", "BTCI", "ETHI", "NEHI", "NIHI",
    "MLPI", "IAUI", "HYBI", "CSHI", "QQQH", "SPYH", "XQQI", "XSPI",
    # Goldman / First Trust / Simplify / iShares / Roundhill / Defiance
    "GPIQ", "GPIX", "FTQI", "SVOL", "TLTW", "KLIP", "USOI", "QQQY",
    "XDTE", "QDTE", "RDTE", "WDTE", "BALI", "ISPY", "JEPX", "SPXX",
    "QQXX", "IWMW",
    # Kurv / REX Shares / Quantify / VistaShares
    "KQQQ", "KYLD", "KGLD", "KSLV", "KCOP", "AMZP", "AAPY", "GOOP",
    "MSFY", "NFLP", "TSLP", "AIPI", "FEPI", "CEPI", "ULTI", "GIF",
    "ATCL", "COII", "MSII", "NVII", "TSII", "HOII", "PLTI", "CWII",
    "LLII", "WMTI", "TLDR", "ISBG", "ISSB", "ACKY", "OMAH", "QUSA",
    "DRKY", "SIOO", "TPRY", "BTYB",
    # GraniteShares and other option-income products
    "YSPY", "TQQY", "YBST", "YBTY", "NVYY", "XBTY", "MTYY", "PLYY",
    "MAAY", "IOYY", "RTYY", "HMYY", "CHPY", "GPTY", "TSPY", "TDAQ",
    "TDAX", "TSYX", "SEPI", "OVL", "YMAX", "YMAG", "ULTY", "LFGY",
    "SLTY", "BIGY", "FIVY",
})

DIVIDEND_GROWTH_TICKERS = frozenset({
    "SCHD", "DGRO", "VIG", "VIGI", "DGRW", "DGRS", "NOBL", "SDY",
    "RDVY", "FDVV", "DIVB", "LEAD", "DTD", "FVD", "REGL", "SMDV",
})

GROWTH_EQUITY_TICKERS = frozenset({
    "QQQ", "QQQM", "VUG", "SCHG", "IWF", "IVW", "MGK", "VOOG",
    "VONG", "SPYG", "IWY", "FSPGX", "VIGAX",
})


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
        ticker in OPTION_INCOME_TICKERS
        or strategy.strip().lower() == "options income"
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
    ) or ticker in DIVIDEND_GROWTH_TICKERS:
        return "dividend_growth"
    growth_name = any(
        phrase in text
        for phrase in (
            "large cap growth",
            "large growth",
            "growth etf",
            "growth index",
            "nasdaq 100 index",
            "nasdaq-100 index",
        )
    )
    if ticker in GROWTH_EQUITY_TICKERS or (growth_name and current_yield < 0.03):
        return "non_income_equity"
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


OWNER_PROFILE_ID = 1


def owner_default_plan_id(conn):
    """The Owner profile's default plan, or None if it has no entries yet."""
    row = conn.execute(
        """SELECT p.id FROM cash_flow_plans p
           WHERE p.scope_type = 'profile' AND p.scope_id = ?
             AND EXISTS (SELECT 1 FROM cash_flow_items i
                          WHERE i.plan_id = p.id AND i.active = 1)
           ORDER BY p.is_default DESC, p.id ASC LIMIT 1""",
        (OWNER_PROFILE_ID,),
    ).fetchone()
    return row["id"] if row else None


def inherits_owner_budget(conn, scope_type, scope_id):
    """Whether a scope is one of Owner's own sub-accounts.

    ``include_in_owner`` already means "this account's holdings roll up into
    the Owner view", so those accounts share Owner's household bills.  Other
    people's portfolios are never matched, and aggregates are left alone
    because their membership can span more than one household.
    """
    if scope_type != "profile" or int(scope_id) == OWNER_PROFILE_ID:
        return False
    row = conn.execute(
        "SELECT include_in_owner FROM profiles WHERE id = ?", (int(scope_id),)
    ).fetchone()
    return bool(row and row["include_in_owner"])


def backfill_owner_subaccount_sources(conn):
    """Point Owner's sub-account plans at Owner's budget.

    Only plans with no entries of their own and no existing link are touched,
    so a deliberate unlink or a sub-account with its own bills is preserved.
    Returns the number of plans linked.
    """
    owner_plan_id = owner_default_plan_id(conn)
    if not owner_plan_id:
        return 0
    rows = conn.execute(
        """SELECT p.id FROM cash_flow_plans p
           JOIN profiles pr ON pr.id = p.scope_id
           WHERE p.scope_type = 'profile'
             AND p.scope_id != ?
             AND pr.include_in_owner = 1
             AND p.source_plan_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM cash_flow_items i
                              WHERE i.plan_id = p.id AND i.active = 1)""",
        (OWNER_PROFILE_ID,),
    ).fetchall()
    for row in rows:
        conn.execute(
            """UPDATE cash_flow_plans
               SET source_plan_id = ?, version = version + 1
               WHERE id = ?""",
            (owner_plan_id, row["id"]),
        )
    if rows:
        conn.commit()
    return len(rows)


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

    # A brand-new sub-account plan starts pointed at Owner's budget so the
    # screen does not fall back to placeholder defaults on first open.
    source_plan_id = None
    if inherits_owner_budget(conn, scope_type, scope_id):
        source_plan_id = owner_default_plan_id(conn)
    cur = conn.execute(
        """INSERT INTO cash_flow_plans
           (name, scope_type, scope_id, is_default, source_plan_id)
           VALUES ('Monthly Cash Flow', ?, ?, 1, ?)""",
        (scope_type, int(scope_id), source_plan_id),
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


def _plan_value(row, key, default=None):
    """Read a column that older databases may not have yet."""
    try:
        value = row[key]
    except (IndexError, KeyError):
        return default
    return default if value is None else value


def resolve_source_plan_id(conn, plan_id):
    """The plan whose line items a plan actually uses.

    A plan may borrow another plan's bills and income (see the
    ``source_plan_id`` migration).  Only one hop is followed so a chain cannot
    loop, and a dangling link falls back to the plan's own items.
    """
    row = conn.execute(
        "SELECT * FROM cash_flow_plans WHERE id = ?", (int(plan_id),)
    ).fetchone()
    if row is None:
        return int(plan_id)
    source_id = _plan_value(row, "source_plan_id")
    if not source_id or int(source_id) == int(plan_id):
        return int(plan_id)
    exists = conn.execute(
        "SELECT 1 FROM cash_flow_plans WHERE id = ?", (int(source_id),)
    ).fetchone()
    return int(source_id) if exists else int(plan_id)


def serialize_plan(row, conn=None):
    source_plan_id = _plan_value(row, "source_plan_id")
    result = {
        "id": row["id"],
        "name": row["name"],
        "scope_type": row["scope_type"],
        "scope_id": row["scope_id"],
        "is_default": bool(row["is_default"]),
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "source_plan_id": int(source_plan_id) if source_plan_id else None,
        "source_plan_name": None,
    }
    if conn is not None and result["source_plan_id"]:
        source = conn.execute(
            "SELECT name, scope_type, scope_id FROM cash_flow_plans WHERE id = ?",
            (result["source_plan_id"],),
        ).fetchone()
        if source is not None:
            result["source_plan_name"] = source["name"]
            result["source_scope_type"] = source["scope_type"]
            result["source_scope_id"] = source["scope_id"]
        else:
            # Dangling link: report it as unset so the UI matches expansion.
            result["source_plan_id"] = None
    return result


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


# ── backup: export and import ────────────────────────────────────────────────
# A cash-flow plan is hand-entered data that exists nowhere else, so it needs a
# file the user can keep. Two formats, one parser:
#
#   JSON  a complete backup — assumptions, saved-off entries, per-month
#         overrides and paid history — meant to restore the plan exactly.
#   CSV   the same entries as a spreadsheet, for reviewing or bulk editing in
#         Excel. History and assumptions do not survive a CSV round trip.

EXPORT_FORMAT = "portfolio-tracker-cash-flow"
EXPORT_VERSION = 1

FREQUENCY_LABELS = {
    "one_time": "One time",
    "weekly": "Weekly",
    "biweekly": "Every two weeks",
    "monthly": "Monthly",
    "quarterly": "Quarterly",
    "semiannual": "Twice a year",
    "annual": "Annual",
}

# Anything a spreadsheet is likely to hold after a human has edited it.
FREQUENCY_ALIASES = {
    "one time": "one_time", "onetime": "one_time", "once": "one_time",
    "single": "one_time", "one off": "one_time",
    "weekly": "weekly", "every week": "weekly", "week": "weekly",
    "every two weeks": "biweekly", "biweekly": "biweekly",
    "every 2 weeks": "biweekly", "fortnightly": "biweekly",
    "twice a month": "biweekly",
    "monthly": "monthly", "every month": "monthly", "month": "monthly",
    "quarterly": "quarterly", "every quarter": "quarterly",
    "every 3 months": "quarterly", "quarter": "quarterly",
    "twice a year": "semiannual", "semiannual": "semiannual",
    "semi annually": "semiannual", "every six months": "semiannual",
    "every 6 months": "semiannual", "half yearly": "semiannual",
    "annual": "annual", "annually": "annual", "yearly": "annual",
    "every year": "annual", "year": "annual",
}

# "Due date" and "Pay by" are the recurrence anchors, not the upcoming bill:
# they are what recreates the schedule on import, and writing the next
# occurrence into them would walk every bill forward on each restore. The
# expenses table shows the next occurrence under the same two words, so the
# headers say which one this is and "Next due" carries the other meaning as a
# read-only snapshot taken when the file was exported.
CSV_COLUMNS = [
    "Type", "Name", "Category", "Amount", "Frequency", "Start date",
    "End date", "Due date (recurring)", "Pay by (recurring)", "Next due",
    "Essential", "Tax %", "Annual change %", "Notes", "Status",
]

# Header spellings accepted on import, compared with punctuation and spaces
# removed so "Tax %", "tax_rate_pct" and "Tax Rate" all land on one field.
CSV_FIELD_ALIASES = {
    "type": "kind", "kind": "kind", "entrytype": "kind",
    "name": "name", "item": "name", "expense": "name", "description": "name",
    "label": "name",
    "category": "category",
    "amount": "amount", "amountusd": "amount", "cost": "amount",
    "value": "amount",
    "frequency": "frequency", "howoften": "frequency", "repeats": "frequency",
    "startdate": "start_date", "start": "start_date",
    "activefrom": "start_date", "starts": "start_date",
    "enddate": "end_date", "end": "end_date", "stopafter": "end_date",
    "ends": "end_date",
    # Plain "Due date"/"Pay by" stay mapped so files exported before the
    # headers were disambiguated still import.
    "duedate": "due_date", "due": "due_date",
    "duedaterecurring": "due_date", "recurringduedate": "due_date",
    "payby": "pay_date", "paydate": "pay_date", "paybydate": "pay_date",
    "paybyrecurring": "pay_date", "recurringpayby": "pay_date",
    "essential": "essential", "required": "essential",
    "tax": "tax_rate_pct", "taxrate": "tax_rate_pct",
    "taxratepct": "tax_rate_pct", "estimatedtax": "tax_rate_pct",
    "annualchange": "annual_change_pct",
    "annualchangepct": "annual_change_pct", "inflation": "annual_change_pct",
    "notes": "notes", "note": "notes", "memo": "notes",
    "status": "active", "active": "active",
}

_TRUE_WORDS = {"1", "y", "yes", "true", "t", "x", "on", "essential"}
_FALSE_WORDS = {"0", "n", "no", "false", "f", "off", ""}
_INACTIVE_WORDS = {
    "saved off", "saved", "inactive", "off", "no", "false", "0",
    "archived", "paused", "hidden",
}


def _header_key(name):
    return "".join(ch for ch in str(name or "").lower() if ch.isalnum())


def _clean_text(value):
    if value is None:
        return ""
    return str(value).strip()


def _parse_bool_cell(value, field_name):
    text = _clean_text(value).lower()
    if text in _TRUE_WORDS:
        return True
    if text in _FALSE_WORDS:
        return False
    raise ValueError(f"{field_name} must be Yes or No.")


def _parse_amount_cell(value):
    """Read a money cell the way a spreadsheet is likely to have written it."""
    text = _clean_text(value).replace("$", "").replace(",", "").replace(" ", "")
    if text.startswith("(") and text.endswith(")"):
        text = f"-{text[1:-1]}"
    if not text:
        raise ValueError("Amount is required.")
    try:
        return float(text)
    except ValueError:
        raise ValueError(f'"{_clean_text(value)}" is not a valid amount.')


def _parse_number_cell(value, field_name):
    text = _clean_text(value).replace("%", "").replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        raise ValueError(f'{field_name} "{_clean_text(value)}" is not a number.')


def _normalize_date_cell(value, field_name):
    """Accept ISO dates plus what Excel writes for a date-formatted cell."""
    text = _clean_text(value)
    if not text:
        return ""
    text = text.split("T")[0].split(" ")[0]
    try:
        return datetime.date.fromisoformat(text).isoformat()
    except ValueError:
        pass
    for pattern in ("%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%d-%b-%Y", "%b %d, %Y"):
        try:
            return datetime.datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f'{field_name} "{text}" is not a date the importer can read.')


def frequency_key(value):
    """Map a frequency label or key onto a stored key, or None if unknown."""
    raw = _clean_text(value).lower()
    if not raw:
        return "monthly"
    if raw in FREQUENCIES:
        return raw
    compact = " ".join(raw.replace("-", " ").replace("_", " ").split())
    if compact in FREQUENCIES:
        return compact
    return FREQUENCY_ALIASES.get(compact)


def _parse_kind_cell(value):
    text = _clean_text(value).lower().rstrip("s")
    if not text:
        raise ValueError("Type is required — use Expense or Income.")
    if text in {"expense", "bill", "outflow", "spending", "cost"}:
        return "expense"
    if text in {"income", "inflow", "earning", "revenue"}:
        return "income"
    raise ValueError(f'Type "{_clean_text(value)}" must be Expense or Income.')


def _month_overrides_for_item(conn, item_id):
    rows = conn.execute(
        """SELECT month, amount_cents, excluded, paid, notes
           FROM cash_flow_month_overrides
           WHERE item_id = ? ORDER BY month""",
        (int(item_id),),
    ).fetchall()
    result = []
    for row in rows:
        result.append(
            {
                "month": row["month"],
                "amount": (
                    cents_to_money(row["amount_cents"])
                    if row["amount_cents"] is not None
                    else None
                ),
                "excluded": bool(row["excluded"]),
                "paid": bool(_item_value(row, "paid", 0)),
                "notes": row["notes"] or "",
            }
        )
    return result


def _payments_for_item(conn, item_id):
    rows = conn.execute(
        """SELECT due_date, paid_at FROM cash_flow_item_payments
           WHERE item_id = ? ORDER BY due_date""",
        (int(item_id),),
    ).fetchall()
    return [
        {"due_date": row["due_date"], "paid_at": row["paid_at"]} for row in rows
    ]


def build_plan_export(conn, plan_id, *, scope_label=None):
    """Everything needed to rebuild one plan: entries, history, assumptions."""
    plan = conn.execute(
        "SELECT * FROM cash_flow_plans WHERE id = ?", (int(plan_id),)
    ).fetchone()
    if plan is None:
        raise ValueError("Cash-flow plan not found.")

    # A borrowed plan shows the source's entries on screen, so that is what a
    # backup of it has to contain.
    items_plan_id = resolve_source_plan_id(conn, plan["id"])
    rows = conn.execute(
        """SELECT * FROM cash_flow_items
           WHERE plan_id = ?
           ORDER BY kind, active DESC, name, id""",
        (items_plan_id,),
    ).fetchall()

    items = []
    for row in rows:
        item = serialize_item(row)
        for field in ("id", "plan_id", "created_at", "updated_at"):
            item.pop(field, None)
        item["month_overrides"] = _month_overrides_for_item(conn, row["id"])
        item["payments"] = _payments_for_item(conn, row["id"])
        items.append(item)

    settings = settings_for_plan(conn, plan["id"])
    settings.pop("plan_id", None)
    settings.pop("starting_cash_cents", None)

    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "exported_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "amounts_are": "the amounts entered on the Cash Flow screen",
        "plan": {
            "name": plan["name"],
            "scope_type": plan["scope_type"],
            "scope_id": plan["scope_id"],
            "scope_label": scope_label,
            "borrowed_from_plan_id": (
                items_plan_id if items_plan_id != plan["id"] else None
            ),
        },
        "settings": settings,
        "items": items,
    }


def items_to_csv(items, today=None):
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for item in items or []:
        kind = str(item.get("kind") or "expense")
        # Blank rather than "Complete" for a finished or non-recurring entry:
        # a word in a date column breaks sorting in a spreadsheet.
        next_due = next_bill_schedule(item, today=today)["due_date"] or ""
        writer.writerow(
            [
                "Expense" if kind == "expense" else "Income",
                item.get("name") or "",
                item.get("category") or "",
                f"{float(item.get('amount') or 0):.2f}",
                FREQUENCY_LABELS.get(
                    item.get("frequency"), item.get("frequency") or ""
                ),
                item.get("start_date") or "",
                item.get("end_date") or "",
                item.get("due_date") or "",
                item.get("pay_date") or "",
                next_due,
                "Yes" if item.get("essential") else "No",
                (
                    ""
                    if kind != "income" or item.get("tax_rate_pct") is None
                    else f"{float(item['tax_rate_pct']):g}"
                ),
                (
                    ""
                    if item.get("annual_change_pct") is None
                    else f"{float(item['annual_change_pct']):g}"
                ),
                item.get("notes") or "",
                "Active" if item.get("active", True) else "Saved off",
            ]
        )
    return buffer.getvalue()


def _row_to_entry(raw_row, label):
    """Turn one spreadsheet row into a payload validate_item_payload accepts."""
    values = {}
    for header, cell in (raw_row or {}).items():
        field = CSV_FIELD_ALIASES.get(_header_key(header))
        if field and field not in values:
            values[field] = cell

    if "name" not in values and "kind" not in values:
        raise ValueError("no recognizable columns.")

    kind = _parse_kind_cell(values.get("kind", "expense"))
    frequency = frequency_key(values.get("frequency", "monthly"))
    if frequency is None:
        raise ValueError(f'Frequency "{_clean_text(values.get("frequency"))}" is not one of the supported options.')

    entry = {
        "kind": kind,
        "name": _clean_text(values.get("name")),
        "category": _clean_text(values.get("category")),
        "amount": _parse_amount_cell(values.get("amount")),
        "frequency": frequency,
        "start_date": _normalize_date_cell(values.get("start_date"), "Start date"),
        "end_date": _normalize_date_cell(values.get("end_date"), "End date"),
        "due_date": _normalize_date_cell(values.get("due_date"), "Due date"),
        "pay_date": _normalize_date_cell(values.get("pay_date"), "Pay by"),
        "notes": _clean_text(values.get("notes")),
        "essential": (
            _parse_bool_cell(values.get("essential"), "Essential")
            if _clean_text(values.get("essential"))
            else kind == "expense"
        ),
        "tax_rate_pct": _parse_number_cell(values.get("tax_rate_pct"), "Tax %"),
        "annual_change_pct": _parse_number_cell(
            values.get("annual_change_pct"), "Annual change %"
        ),
        "active": True,
        "_label": label,
    }

    status = _clean_text(values.get("active")).lower()
    if status:
        entry["active"] = status not in _INACTIVE_WORDS

    # A start date is optional in the file: an expense can anchor on its due
    # date, and validate_item_payload falls back to today for the rest.
    if not entry["start_date"] and entry["due_date"]:
        entry["start_date"] = entry["due_date"]
    for field in ("start_date", "end_date", "due_date", "pay_date"):
        if not entry[field]:
            entry[field] = None
    return entry


def _parse_csv_document(text):
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return {"kind": "csv", "items": [], "settings": None, "errors": []}
    recognized = [
        name for name in reader.fieldnames
        if CSV_FIELD_ALIASES.get(_header_key(name))
    ]
    if not recognized:
        raise ValueError(
            "That spreadsheet has no Type, Name or Amount column. Export a "
            "copy from this screen to see the expected columns."
        )

    entries, errors = [], []
    for index, raw_row in enumerate(reader, start=2):
        if not any(_clean_text(cell) for cell in raw_row.values()):
            continue
        label = f"Row {index}"
        try:
            entries.append(_row_to_entry(raw_row, label))
        except ValueError as exc:
            errors.append(f"{label}: {exc}")
    return {"kind": "csv", "items": entries, "settings": None, "errors": errors}


def _clean_history_entries(raw_overrides, raw_payments):
    """Keep only per-month edits and paid marks that still parse.

    History is a convenience, not the plan itself, so a damaged entry is
    dropped rather than failing a restore that would otherwise succeed.
    """
    overrides = []
    for row in raw_overrides or []:
        if not isinstance(row, dict):
            continue
        try:
            month = parse_month(row.get("month")).strftime("%Y-%m")
        except ValueError:
            continue
        amount_cents = None
        if row.get("amount") not in (None, ""):
            try:
                amount_cents = money_to_cents(row.get("amount"))
            except ValueError:
                continue
        overrides.append(
            {
                "month": month,
                "amount_cents": amount_cents,
                "excluded": 1 if row.get("excluded") else 0,
                "paid": 1 if row.get("paid") else 0,
                "notes": _clean_text(row.get("notes")) or None,
            }
        )

    payments = []
    for row in raw_payments or []:
        due_date = row.get("due_date") if isinstance(row, dict) else row
        try:
            due_date = parse_date(due_date, "Paid date", required=True).isoformat()
        except ValueError:
            continue
        paid_at = _clean_text(row.get("paid_at")) if isinstance(row, dict) else ""
        payments.append({"due_date": due_date, "paid_at": paid_at or None})
    return overrides, payments


def _clean_import_settings(raw):
    """Assumptions from a backup, bounded the same way the settings API is."""
    if not isinstance(raw, dict):
        return None
    result = {}
    try:
        if raw.get("horizon_years") not in (None, ""):
            result["horizon_years"] = max(1, min(50, int(float(raw["horizon_years"]))))
        if raw.get("expense_inflation_pct") not in (None, ""):
            result["expense_inflation_pct"] = max(
                -10.0, min(30.0, float(raw["expense_inflation_pct"]))
            )
        if raw.get("portfolio_tax_pct") not in (None, ""):
            result["portfolio_tax_pct"] = max(
                0.0, min(95.0, float(raw["portfolio_tax_pct"]))
            )
        if raw.get("starting_cash") not in (None, ""):
            result["starting_cash_cents"] = money_to_cents(
                raw["starting_cash"], "Starting cash"
            )
        elif raw.get("starting_cash_cents") not in (None, ""):
            result["starting_cash_cents"] = max(
                0, int(float(raw["starting_cash_cents"]))
            )
    except (TypeError, ValueError):
        return None
    mode = _clean_text(raw.get("surplus_mode")).lower()
    if mode in {"cash", "reinvest"}:
        result["surplus_mode"] = mode
    return result or None


def _parse_json_document(text):
    try:
        document = json.loads(text)
    except (TypeError, ValueError):
        raise ValueError("That file is not readable JSON.")

    if isinstance(document, list):
        raw_items, raw_settings = document, None
    elif isinstance(document, dict):
        raw_items = document.get("items")
        if raw_items is None:
            raw_items = document.get("expenses")
        raw_settings = document.get("settings")
    else:
        raise ValueError("That file does not contain a cash-flow backup.")

    if not isinstance(raw_items, list):
        raise ValueError(
            "That backup has no entries list. Use a file exported from the "
            "Cash Flow screen."
        )

    entries, errors = [], []
    for index, raw in enumerate(raw_items, start=1):
        name = _clean_text(raw.get("name")) if isinstance(raw, dict) else ""
        label = f"Entry {index}" + (f' ("{name}")' if name else "")
        if not isinstance(raw, dict):
            errors.append(f"{label}: entry is not a record.")
            continue
        frequency = frequency_key(raw.get("frequency", "monthly"))
        if frequency is None:
            errors.append(
                f'{label}: frequency "{_clean_text(raw.get("frequency"))}" is not supported.'
            )
            continue
        amount = raw.get("amount")
        if amount in (None, "") and raw.get("amount_cents") not in (None, ""):
            amount = cents_to_money(raw.get("amount_cents"))
        overrides, payments = _clean_history_entries(
            raw.get("month_overrides"), raw.get("payments")
        )
        entries.append(
            {
                **raw,
                "amount": amount,
                "frequency": frequency,
                "active": raw.get("active", True) is not False,
                "month_overrides": overrides,
                "payments": payments,
                "_label": label,
            }
        )
    return {
        "kind": "json",
        "items": entries,
        "settings": _clean_import_settings(raw_settings),
        "errors": errors,
    }


def parse_import_document(raw):
    """Read a backup file. Raises ValueError when nothing can be read at all."""
    if isinstance(raw, (bytes, bytearray)):
        try:
            text = bytes(raw).decode("utf-8-sig")
        except UnicodeDecodeError:
            text = bytes(raw).decode("latin-1")
    else:
        text = str(raw or "")
    if not text.strip():
        raise ValueError("That file is empty.")
    if text.lstrip()[:1] in {"{", "["}:
        return _parse_json_document(text)
    return _parse_csv_document(text)


def validate_import_entries(entries, today=None):
    """Validate parsed entries with the same rules the entry form uses."""
    prepared, errors = [], []
    for index, entry in enumerate(entries or [], start=1):
        label = entry.get("_label") or f"Entry {index}"
        try:
            record = validate_item_payload(entry, today=today)
        except ValueError as exc:
            errors.append(f"{label}: {exc}")
            continue
        record["month_overrides"] = entry.get("month_overrides") or []
        record["payments"] = entry.get("payments") or []
        prepared.append(record)
    return prepared, errors


def import_signature(record):
    """Identify the same entry twice so a merge does not duplicate it."""
    return (
        str(record.get("kind") or ""),
        str(record.get("name") or "").strip().lower(),
        str(record.get("frequency") or ""),
        int(record.get("amount_cents") or 0),
        str(record.get("start_date") or ""),
    )


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


def expand_plan(conn, plan_id, start_month, months, hold_growth=False):
    """Expand saved cash-flow rules into exact monthly totals.

    The opening month carries the amounts exactly as they were entered; later
    months escalate from there. ``hold_growth`` drops that escalation, leaving
    every month at the entered level. The months still differ wherever
    quarterly, annual, or ending bills fall, so averaging the series normalizes
    the lumps without also baking in inflation. Callers that apply their own
    inflation on top -- Retirement Readiness -- need that, or they charge it
    twice.
    """
    start = parse_month(start_month) if not isinstance(start_month, datetime.date) else start_month.replace(day=1)
    month_count = max(1, min(600, int(months)))
    # Assumptions stay with the plan being viewed; only the bills and income
    # come from the source, so an aggregate can borrow a budget while keeping
    # its own tax and horizon settings.
    settings = settings_for_plan(conn, plan_id)
    items_plan_id = resolve_source_plan_id(conn, plan_id)
    items = conn.execute(
        """SELECT * FROM cash_flow_items
           WHERE plan_id = ? AND active = 1
           ORDER BY kind, name, id""",
        (items_plan_id,),
    ).fetchall()
    overrides = conn.execute(
        """SELECT o.* FROM cash_flow_month_overrides o
           JOIN cash_flow_items i ON i.id = o.item_id
           WHERE i.plan_id = ?""",
        (items_plan_id,),
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
                # Saved amounts are current money, so escalation runs forward
                # from the month the series opens on. Measuring it from each
                # bill's own start date restated figures the user had just
                # typed -- the month being viewed stopped adding up to its own
                # entry table -- and pushed the plan further from those entries
                # every month it went untouched.
                elapsed_months = 0 if hold_growth else max(0, month_difference(start, month))
                factor = (1.0 + float(annual_change) / 100.0) ** (elapsed_months / 12.0)
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
