"""Permanent option trade ledger, calculations, and Flask routes."""

from __future__ import annotations

import math
import os
import re
import sqlite3
import tempfile
from collections import defaultdict
from datetime import date, datetime

from flask import jsonify, request

from config import get_connection
from option_trade_import import SUPPORTED_FORMATS, parse_option_transactions


OPEN_ACTIONS = {"BTO", "STO"}
CLOSE_ACTIONS = {"BTC", "STC", "EXPIRE", "ASSIGN", "EXERCISE"}
VALID_ACTIONS = OPEN_ACTIONS | CLOSE_ACTIONS
VALID_SIDES = {"LONG", "SHORT"}
VALID_TYPES = {"CALL", "PUT"}
VALID_PURPOSES = {"Income", "Directional", "Hedge", "Adjustment", "Other"}


def _number(value, default=None):
    if value in (None, ""):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _iso_date(value, field_name, required=False):
    text = str(value or "").strip()
    if not text:
        if required:
            raise ValueError(f"{field_name} is required")
        return None
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError as exc:
        raise ValueError(f"{field_name} must use YYYY-MM-DD format") from exc


def _cash_effect(execution):
    action = str(execution.get("action") or "").upper()
    price = float(execution.get("price") or 0)
    contracts = int(execution.get("contracts") or 0)
    multiplier = int(execution.get("multiplier") or 100)
    gross = price * contracts * multiplier
    if action in {"STO", "STC"}:
        gross = abs(gross)
    elif action in {"BTO", "BTC"}:
        gross = -abs(gross)
    else:
        gross = 0
    return gross - abs(float(execution.get("fees") or 0))


def _position_sides_for_action(action):
    if action in {"BTO", "STC"}:
        return ["LONG"]
    if action in {"STO", "BTC"}:
        return ["SHORT"]
    # Expiration, assignment, and exercise exports often omit whether the
    # contract was long or short. Match the actual open leg in either order.
    return ["LONG", "SHORT"]


def _serialize_execution(row, multiplier=100):
    result = dict(row)
    result["cash_effect"] = round(_cash_effect({**result, "multiplier": multiplier}), 2)
    return result


def _derived_max_risk(trade, legs):
    explicit = _number(trade.get("max_risk"))
    if explicit is not None and explicit >= 0:
        return round(explicit, 2), "entered"
    if not legs:
        return None, None

    entry_net = sum(execution["cash_effect"] for leg in legs for execution in leg["executions"] if execution["action"] in OPEN_ACTIONS)
    option_types = {leg["option_type"] for leg in legs}
    expirations = {leg["expiration"] for leg in legs}
    sides = {leg["position_side"] for leg in legs}
    equal_contracts = len({leg["contracts"] for leg in legs}) == 1

    if entry_net < 0 and all(leg["position_side"] == "LONG" for leg in legs):
        return round(abs(entry_net), 2), "net debit"
    if len(legs) == 2 and len(option_types) == 1 and len(expirations) == 1 and sides == {"LONG", "SHORT"} and equal_contracts:
        width = abs(float(legs[0]["strike"]) - float(legs[1]["strike"]))
        gross_width = width * int(legs[0]["contracts"]) * int(legs[0]["multiplier"])
        risk = gross_width - max(0, entry_net) if entry_net >= 0 else abs(entry_net)
        return round(max(0, risk), 2), "derived spread width"
    if len(legs) == 4 and option_types == {"CALL", "PUT"} and len(expirations) == 1 and equal_contracts:
        widths = []
        for option_type in ("CALL", "PUT"):
            strikes = sorted(float(leg["strike"]) for leg in legs if leg["option_type"] == option_type)
            if len(strikes) == 2:
                widths.append(strikes[1] - strikes[0])
        if widths:
            gross_width = max(widths) * int(legs[0]["contracts"]) * int(legs[0]["multiplier"])
            return round(max(0, gross_width - max(0, entry_net)), 2), "derived condor width"
    return None, None


def _trade_payload(trade_row, leg_rows, execution_rows, today=None):
    trade = dict(trade_row)
    today = today or date.today()
    executions_by_leg = defaultdict(list)
    for execution in execution_rows:
        executions_by_leg[int(execution["leg_id"])].append(execution)

    legs = []
    for raw_leg in leg_rows:
        leg = dict(raw_leg)
        executions = [
            _serialize_execution(row, int(leg.get("multiplier") or 100))
            for row in executions_by_leg[int(leg["id"])]
        ]
        opened = sum(int(row["contracts"] or 0) for row in executions if row["action"] in OPEN_ACTIONS)
        closed = sum(int(row["contracts"] or 0) for row in executions if row["action"] in CLOSE_ACTIONS)
        leg["open_contracts"] = max(0, opened - closed)
        leg["executions"] = executions
        leg["net_cash_flow"] = round(sum(row["cash_effect"] for row in executions), 2)
        closing_dates = [
            str(row.get("executed_at") or "")[:10]
            for row in executions
            if row["action"] in CLOSE_ACTIONS and row.get("executed_at")
        ]
        leg["realized_at"] = max(closing_dates) if leg["open_contracts"] == 0 and closing_dates else None
        legs.append(leg)

    all_executions = [execution for leg in legs for execution in leg["executions"]]
    opening_executions = [row for row in all_executions if row["action"] in OPEN_ACTIONS]
    entry_net = round(sum(row["cash_effect"] for row in opening_executions), 2)
    total_cash = round(sum(row["cash_effect"] for row in all_executions), 2)
    total_fees = round(sum(abs(float(row.get("fees") or 0)) for row in all_executions), 2)
    is_closed = str(trade.get("status") or "").upper() == "CLOSED"
    summary_pnl = _number(trade.get("summary_realized_pnl"))
    if bool(trade.get("limited_history")) and summary_pnl is not None:
        realized = round(summary_pnl, 2)
    elif is_closed:
        realized = total_cash
    else:
        realized = round(sum(leg["net_cash_flow"] for leg in legs if leg["open_contracts"] == 0), 2)

    max_risk, risk_source = _derived_max_risk(trade, legs)
    open_expirations = []
    for leg in legs:
        if leg["open_contracts"] <= 0:
            continue
        try:
            open_expirations.append(date.fromisoformat(str(leg["expiration"])[:10]))
        except ValueError:
            continue
    dte = (min(open_expirations) - today).days if open_expirations else None
    outcome = None
    if is_closed:
        outcome = "WIN" if realized > 0.005 else "LOSS" if realized < -0.005 else "BREAKEVEN"

    if bool(trade.get("limited_history")) and summary_pnl is not None:
        realized_events = [{
            "date": str(trade.get("closed_at") or trade.get("opened_at") or "")[:10],
            "amount": round(summary_pnl, 2),
            "source": "summary",
        }]
    else:
        realized_events = [
            {
                "date": leg["realized_at"],
                "amount": round(leg["net_cash_flow"], 2),
                "source": "leg",
                "leg_id": leg["id"],
            }
            for leg in legs
            if leg.get("realized_at")
        ]

    trade.update({
        "legs": legs,
        "entry_net_amount": entry_net,
        "entry_type": "CREDIT" if entry_net > 0.005 else "DEBIT" if entry_net < -0.005 else "EVEN",
        "net_cash_flow": total_cash,
        "realized_pnl": realized,
        "total_fees": total_fees,
        "max_risk": max_risk,
        "max_risk_source": risk_source,
        "return_on_risk_pct": round(realized / max_risk * 100, 2) if is_closed and max_risk else None,
        "dte": dte,
        "outcome": outcome,
        "open_contracts": sum(leg["open_contracts"] for leg in legs),
        "realized_events": realized_events,
    })
    return trade


def _attach_stock_positions(conn, trades):
    """Link stock-backed option trades to holdings in the same portfolio.

    The option ledger remains separate from the holdings ledger.  This is a
    read-only association used to show coverage and to build a complete covered
    call risk graph without duplicating or changing the holding.
    """
    stock_backed = [
        trade for trade in trades
        if str(trade.get("strategy_type") or "").strip().lower() == "covered call"
    ]
    if not stock_backed:
        return trades

    profile_ids = sorted({int(trade["profile_id"]) for trade in stock_backed})
    tickers = sorted({str(trade["underlying"]).upper() for trade in stock_backed})
    profile_placeholders = ",".join("?" for _ in profile_ids)
    ticker_placeholders = ",".join("?" for _ in tickers)
    rows = conn.execute(
        f"""SELECT profile_id, UPPER(ticker) AS ticker, quantity, price_paid,
                   broker_price_paid, current_price
              FROM all_account_info
             WHERE profile_id IN ({profile_placeholders})
               AND UPPER(ticker) IN ({ticker_placeholders})""",
        [*profile_ids, *tickers],
    ).fetchall()
    holdings = {(int(row["profile_id"]), row["ticker"]): dict(row) for row in rows}

    for trade in stock_backed:
        open_trade = str(trade.get("status") or "").upper() == "OPEN"
        required_shares = sum(
            int(leg.get("multiplier") or 100)
            * int((leg.get("open_contracts") if open_trade else leg.get("contracts")) or 0)
            for leg in trade.get("legs") or []
            if leg.get("position_side") == "SHORT" and leg.get("option_type") == "CALL"
        )
        holding = holdings.get((int(trade["profile_id"]), str(trade["underlying"]).upper())) or {}
        portfolio_shares = max(0.0, float(_number(holding.get("quantity"), 0) or 0))
        linked_shares = min(portfolio_shares, float(required_shares))
        broker_basis = _number(holding.get("broker_price_paid"))
        holding_basis = _number(holding.get("price_paid"))
        cost_basis = broker_basis if broker_basis is not None else holding_basis
        trade["stock_position"] = {
            "source": "portfolio_holdings",
            "shares": linked_shares,
            "portfolio_shares": portfolio_shares,
            "required_shares": required_shares,
            "shortfall_shares": max(0.0, float(required_shares) - portfolio_shares),
            "coverage_pct": round(min(100.0, portfolio_shares / required_shares * 100), 1) if required_shares else None,
            "covered": bool(required_shares and portfolio_shares >= required_shares),
            "cost_basis": cost_basis,
            "cost_basis_source": "broker" if broker_basis is not None else "holding" if holding_basis is not None else None,
            "current_price": _number(holding.get("current_price")),
        }
    return trades


def load_trades(conn, profile_ids, status=None, purpose=None, underlying=None):
    if not profile_ids:
        return []
    placeholders = ",".join("?" for _ in profile_ids)
    where = [f"profile_id IN ({placeholders})"]
    params = list(profile_ids)
    if status and str(status).upper() != "ALL":
        where.append("status = ?")
        params.append(str(status).upper())
    if purpose and str(purpose).upper() != "ALL":
        where.append("purpose = ?")
        params.append(str(purpose).title())
    if underlying:
        where.append("underlying LIKE ?")
        params.append(f"%{str(underlying).strip().upper()}%")
    trade_rows = conn.execute(
        f"SELECT * FROM option_trades WHERE {' AND '.join(where)} ORDER BY COALESCE(opened_at, created_at) DESC, id DESC",
        params,
    ).fetchall()
    if not trade_rows:
        return []
    trade_ids = [int(row["id"]) for row in trade_rows]
    trade_placeholders = ",".join("?" for _ in trade_ids)
    leg_rows = conn.execute(
        f"SELECT * FROM option_trade_legs WHERE trade_id IN ({trade_placeholders}) ORDER BY trade_id, sort_order, id",
        trade_ids,
    ).fetchall()
    execution_rows = conn.execute(
        f"SELECT * FROM option_executions WHERE trade_id IN ({trade_placeholders}) ORDER BY executed_at, id",
        trade_ids,
    ).fetchall()
    legs_by_trade = defaultdict(list)
    executions_by_trade = defaultdict(list)
    for row in leg_rows:
        legs_by_trade[int(row["trade_id"])].append(row)
    for row in execution_rows:
        executions_by_trade[int(row["trade_id"])].append(row)
    trades = [
        _trade_payload(row, legs_by_trade[int(row["id"])], executions_by_trade[int(row["id"])])
        for row in trade_rows
    ]
    trade_profile_ids = sorted({int(trade["profile_id"]) for trade in trades})
    profile_placeholders = ",".join("?" for _ in trade_profile_ids)
    profile_rows = conn.execute(
        f"SELECT id, name FROM profiles WHERE id IN ({profile_placeholders})",
        trade_profile_ids,
    ).fetchall()
    profile_names = {int(row["id"]): row["name"] for row in profile_rows}
    for trade in trades:
        trade["profile_name"] = profile_names.get(int(trade["profile_id"]), f"Account {trade['profile_id']}")
    return _attach_stock_positions(conn, trades)


def _option_trade_read_scope(conn, is_aggregate, profile_ids):
    """Expand Owner reads to the same source accounts used by income totals."""
    resolved_ids = list(dict.fromkeys(int(profile_id) for profile_id in (profile_ids or [1])))
    scope_type = "aggregate" if is_aggregate else "profile"
    if not is_aggregate and resolved_ids == [1]:
        source_rows = conn.execute(
            "SELECT id FROM profiles WHERE id != 1 AND include_in_owner = 1 ORDER BY id"
        ).fetchall()
        source_ids = [int(row["id"]) for row in source_rows]
        if source_ids:
            resolved_ids = [1, *source_ids]
            scope_type = "owner"

    placeholders = ",".join("?" for _ in resolved_ids)
    name_rows = conn.execute(
        f"SELECT id, name FROM profiles WHERE id IN ({placeholders}) ORDER BY id",
        resolved_ids,
    ).fetchall()
    names = {int(row["id"]): row["name"] for row in name_rows}
    return resolved_ids, {
        "type": scope_type,
        "profile_ids": resolved_ids,
        "accounts": [
            {"id": profile_id, "name": names.get(profile_id, f"Account {profile_id}")}
            for profile_id in resolved_ids
        ],
    }


def trade_metrics(trades, today=None):
    today = today or date.today()
    month_start = today.replace(day=1).isoformat()
    year_start = today.replace(month=1, day=1).isoformat()
    closed = [trade for trade in trades if trade["status"] == "CLOSED"]
    wins = [trade for trade in closed if trade["realized_pnl"] > 0.005]
    losses = [trade for trade in closed if trade["realized_pnl"] < -0.005]
    gross_profit = sum(trade["realized_pnl"] for trade in wins)
    gross_loss = abs(sum(trade["realized_pnl"] for trade in losses))
    realized_events = [
        {
            **event,
            "trade_id": trade.get("id"),
            "profile_id": trade.get("profile_id"),
            "profile_name": trade.get("profile_name"),
            "underlying": trade.get("underlying"),
            "strategy_type": trade.get("strategy_type"),
            "purpose": trade.get("purpose"),
            "trade_status": trade.get("status"),
        }
        for trade in trades
        for event in trade.get("realized_events") or []
    ]

    def events_in_window(start, purpose=None):
        return sorted(
            [
                event
                for event in realized_events
                if start <= str(event.get("date") or "")[:10] <= today.isoformat()
                and (purpose is None or event.get("purpose") == purpose)
            ],
            key=lambda event: (str(event.get("date") or ""), int(event.get("trade_id") or 0), int(event.get("leg_id") or 0)),
        )

    def event_total(start, purpose=None):
        return sum(
            float(event.get("amount") or 0)
            for event in events_in_window(start, purpose)
        )

    return {
        "open_trades": sum(trade["status"] == "OPEN" for trade in trades),
        "known_open_risk": round(sum(trade["max_risk"] or 0 for trade in trades if trade["status"] == "OPEN"), 2),
        "open_risk_coverage": sum(trade["max_risk"] is not None for trade in trades if trade["status"] == "OPEN"),
        "realized_mtd": round(event_total(month_start), 2),
        "realized_mtd_events": events_in_window(month_start),
        "realized_ytd": round(event_total(year_start), 2),
        "realized_ytd_events": events_in_window(year_start),
        "income_realized_ytd": round(event_total(year_start, "Income"), 2),
        "win_rate_pct": round(len(wins) / len(closed) * 100, 1) if closed else None,
        "average_winner": round(gross_profit / len(wins), 2) if wins else None,
        "average_loser": round(-gross_loss / len(losses), 2) if losses else None,
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss else None,
        "closed_trades": len(closed),
    }


def realized_option_income(conn, profile_ids, start_date, end_date):
    """Net option P/L realized in the window, including completed legs of open trades."""
    try:
        trades = load_trades(conn, profile_ids, purpose="Income")
    except sqlite3.OperationalError as exc:
        # Some narrow endpoint tests construct only the legacy income tables.
        # Production startup always runs the full database migration.
        if "no such table" in str(exc).lower():
            return 0.0
        raise
    return round(sum(
        float(event.get("amount") or 0)
        for trade in trades
        for event in trade.get("realized_events") or []
        if start_date <= str(event.get("date") or "")[:10] <= end_date
    ), 2)


def _validate_trade_payload(payload):
    underlying = str(payload.get("underlying") or "").strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-/]{0,10}", underlying):
        raise ValueError("Enter a valid underlying ticker")
    purpose = str(payload.get("purpose") or "Income").strip().title()
    if purpose not in VALID_PURPOSES:
        raise ValueError(f"purpose must be one of {', '.join(sorted(VALID_PURPOSES))}")
    opened_at = _iso_date(payload.get("opened_at"), "Open date", required=True)
    strategy_type = str(payload.get("strategy_type") or "Custom").strip() or "Custom"
    legs = payload.get("legs") or []
    if not isinstance(legs, list) or not legs:
        raise ValueError("At least one option leg is required")
    normalized_legs = []
    for index, raw in enumerate(legs):
        side = str(raw.get("position_side") or raw.get("side") or "").strip().upper()
        option_type = str(raw.get("option_type") or raw.get("opt_type") or "").strip().upper()
        if side not in VALID_SIDES:
            raise ValueError(f"Leg {index + 1} side must be LONG or SHORT")
        if option_type not in VALID_TYPES:
            raise ValueError(f"Leg {index + 1} type must be CALL or PUT")
        expiration = _iso_date(raw.get("expiration"), f"Leg {index + 1} expiration", required=True)
        strike = _number(raw.get("strike"))
        contracts = int(_number(raw.get("contracts"), 0) or 0)
        price = _number(raw.get("price", raw.get("entry_price")), 0)
        fees = _number(raw.get("fees"), 0)
        multiplier = int(_number(raw.get("multiplier"), 100) or 100)
        if strike is None or strike <= 0:
            raise ValueError(f"Leg {index + 1} strike must be greater than zero")
        if contracts <= 0:
            raise ValueError(f"Leg {index + 1} contracts must be greater than zero")
        if price is None or price < 0 or fees is None or fees < 0:
            raise ValueError(f"Leg {index + 1} price and fees cannot be negative")
        normalized_legs.append({
            "position_side": side,
            "option_type": option_type,
            "expiration": expiration,
            "strike": strike,
            "contracts": contracts,
            "price": price,
            "fees": fees,
            "multiplier": multiplier,
            "occ_symbol": str(raw.get("occ_symbol") or "").strip().upper() or None,
        })
    max_risk = _number(payload.get("max_risk"))
    if max_risk is not None and max_risk < 0:
        raise ValueError("Maximum risk cannot be negative")
    return {
        "underlying": underlying,
        "purpose": purpose,
        "opened_at": opened_at,
        "strategy_type": strategy_type,
        "max_risk": max_risk,
        "notes": str(payload.get("notes") or "").strip() or None,
        "linked_strategy_id": payload.get("linked_strategy_id"),
        "legs": normalized_legs,
    }


def create_trade(conn, profile_id, payload, source="manual", source_format=None, external_group_id=None):
    trade = _validate_trade_payload(payload)
    cursor = conn.execute(
        """INSERT INTO option_trades
              (profile_id, underlying, strategy_type, purpose, status, opened_at,
               source, source_format, external_group_id, linked_strategy_id,
               max_risk, notes)
           VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)""",
        (
            profile_id, trade["underlying"], trade["strategy_type"], trade["purpose"],
            trade["opened_at"], source, source_format, external_group_id,
            trade["linked_strategy_id"], trade["max_risk"], trade["notes"],
        ),
    )
    trade_id = int(cursor.lastrowid)
    for index, leg in enumerate(trade["legs"]):
        leg_cursor = conn.execute(
            """INSERT INTO option_trade_legs
                  (trade_id, option_type, position_side, expiration, strike,
                   contracts, multiplier, occ_symbol, status, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)""",
            (
                trade_id, leg["option_type"], leg["position_side"], leg["expiration"],
                leg["strike"], leg["contracts"], leg["multiplier"], leg["occ_symbol"], index,
            ),
        )
        action = "BTO" if leg["position_side"] == "LONG" else "STO"
        conn.execute(
            """INSERT INTO option_executions
                  (trade_id, leg_id, action, executed_at, contracts, price, fees, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                trade_id, int(leg_cursor.lastrowid), action, trade["opened_at"],
                leg["contracts"], leg["price"], leg["fees"], source,
            ),
        )
    conn.commit()
    return trade_id


def _open_contracts_for_leg(conn, leg_id):
    row = conn.execute(
        """SELECT
               COALESCE(SUM(CASE WHEN action IN ('BTO','STO') THEN contracts ELSE 0 END), 0) AS opened,
               COALESCE(SUM(CASE WHEN action IN ('BTC','STC','EXPIRE','ASSIGN','EXERCISE') THEN contracts ELSE 0 END), 0) AS closed
           FROM option_executions WHERE leg_id = ?""",
        (leg_id,),
    ).fetchone()
    return max(0, int(row["opened"] or 0) - int(row["closed"] or 0))


def _refresh_trade_status(conn, trade_id):
    legs = conn.execute("SELECT id FROM option_trade_legs WHERE trade_id = ?", (trade_id,)).fetchall()
    remaining = 0
    for leg in legs:
        open_contracts = _open_contracts_for_leg(conn, int(leg["id"]))
        remaining += open_contracts
        conn.execute(
            "UPDATE option_trade_legs SET status = ? WHERE id = ?",
            ("OPEN" if open_contracts else "CLOSED", int(leg["id"])),
        )
    if legs and remaining == 0:
        closed_row = conn.execute(
            "SELECT MAX(executed_at) AS closed_at FROM option_executions WHERE trade_id = ? AND action IN ('BTC','STC','EXPIRE','ASSIGN','EXERCISE')",
            (trade_id,),
        ).fetchone()
        conn.execute(
            "UPDATE option_trades SET status = 'CLOSED', closed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (closed_row["closed_at"], trade_id),
        )
    else:
        conn.execute(
            "UPDATE option_trades SET status = 'OPEN', closed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (trade_id,),
        )


def close_trade(conn, profile_id, trade_id, payload):
    trade = conn.execute(
        "SELECT id, status FROM option_trades WHERE id = ? AND profile_id = ?",
        (trade_id, profile_id),
    ).fetchone()
    if not trade:
        raise LookupError("Option trade not found")
    if trade["status"] == "CLOSED":
        raise ValueError("This trade is already closed")
    closed_at = _iso_date(payload.get("closed_at"), "Close date", required=True)
    rows = payload.get("executions") or []
    if not rows:
        raise ValueError("Enter a close price or outcome for at least one leg")
    for raw in rows:
        leg_id = int(raw.get("leg_id") or 0)
        leg = conn.execute(
            "SELECT * FROM option_trade_legs WHERE id = ? AND trade_id = ?",
            (leg_id, trade_id),
        ).fetchone()
        if not leg:
            raise ValueError("A closing execution references an invalid leg")
        remaining = _open_contracts_for_leg(conn, leg_id)
        contracts = int(_number(raw.get("contracts"), remaining) or 0)
        if contracts <= 0 or contracts > remaining:
            raise ValueError(f"Closing contracts for leg {leg_id} must be between 1 and {remaining}")
        default_action = "STC" if leg["position_side"] == "LONG" else "BTC"
        action = str(raw.get("action") or default_action).strip().upper()
        if action not in CLOSE_ACTIONS:
            raise ValueError("Closing action must be BTC, STC, EXPIRE, ASSIGN, or EXERCISE")
        if action == "EXPIRE" and str(leg["expiration"] or "")[:10] > closed_at:
            raise ValueError(f"Leg {leg_id} does not expire until {str(leg['expiration'])[:10]}")
        price = _number(raw.get("price"), 0)
        fees = _number(raw.get("fees"), 0)
        if price is None or price < 0 or fees is None or fees < 0:
            raise ValueError("Close price and fees cannot be negative")
        conn.execute(
            """INSERT INTO option_executions
                  (trade_id, leg_id, action, executed_at, contracts, price, fees, source, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)""",
            (trade_id, leg_id, action, closed_at, contracts, price, fees, str(raw.get("notes") or "").strip() or None),
        )
    _refresh_trade_status(conn, trade_id)
    conn.commit()


def _contract_key(row, side=None):
    return (
        str(row.get("underlying") or "").upper(),
        str(row.get("option_type") or "").upper(),
        str(row.get("expiration") or "")[:10],
        round(float(row.get("strike") or 0), 4),
        side or row.get("position_side"),
    )


def _find_matching_open_leg(conn, profile_id, execution, preferred_trade_id=None):
    sides = _position_sides_for_action(execution["action"])
    side_placeholders = ",".join("?" for _ in sides)
    params = [profile_id, execution["underlying"], execution["option_type"], execution["expiration"], execution["strike"], *sides]
    trade_clause = ""
    if preferred_trade_id:
        trade_clause = " AND t.id = ?"
        params.append(preferred_trade_id)
    candidates = conn.execute(
        """SELECT l.*, t.id AS matched_trade_id
             FROM option_trade_legs l
             JOIN option_trades t ON t.id = l.trade_id
            WHERE t.profile_id = ? AND t.status = 'OPEN'
              AND t.underlying = ? AND l.option_type = ? AND l.expiration = ?
              AND ABS(l.strike - ?) < 0.0001 AND l.position_side IN (""" + side_placeholders + ")" + trade_clause +
        " ORDER BY COALESCE(t.opened_at, t.created_at), t.id",
        params,
    ).fetchall()
    for candidate in candidates:
        if _open_contracts_for_leg(conn, int(candidate["id"])) > 0:
            return candidate
    return None


def import_option_executions(conn, profile_id, parsed):
    source_format = parsed["source_format"]
    existing_hashes = {
        row["dedupe_hash"] for row in conn.execute(
            "SELECT dedupe_hash FROM option_executions WHERE dedupe_hash IS NOT NULL"
        ).fetchall()
    }
    group_trades = {}
    touched = set()
    inserted = duplicates = unmatched = 0
    errors = []
    for execution in parsed["executions"]:
        if execution["dedupe_hash"] in existing_hashes:
            duplicates += 1
            continue
        group_key = execution["group_key"]
        trade_id = group_trades.get(group_key)

        if execution["action"] in OPEN_ACTIONS:
            if not trade_id:
                existing = conn.execute(
                    """SELECT id FROM option_trades
                       WHERE profile_id = ? AND source_format = ? AND external_group_id = ?
                       ORDER BY id DESC LIMIT 1""",
                    (profile_id, source_format, group_key),
                ).fetchone()
                if existing:
                    trade_id = int(existing["id"])
                else:
                    cursor = conn.execute(
                        """INSERT INTO option_trades
                              (profile_id, underlying, strategy_type, purpose, status,
                               opened_at, source, source_format, external_group_id, notes)
                           VALUES (?, ?, ?, ?, 'OPEN', ?, 'broker_import', ?, ?, ?)""",
                        (
                            profile_id, execution["underlying"], execution.get("strategy_type") or "Custom",
                            execution.get("purpose") or "Other", execution["executed_at"], source_format,
                            group_key, f"Imported from {parsed.get('source_label') or source_format}",
                        ),
                    )
                    trade_id = int(cursor.lastrowid)
                group_trades[group_key] = trade_id

            leg = _find_matching_open_leg(conn, profile_id, execution, preferred_trade_id=trade_id)
            if leg:
                leg_id = int(leg["id"])
                conn.execute(
                    "UPDATE option_trade_legs SET contracts = contracts + ? WHERE id = ?",
                    (execution["contracts"], leg_id),
                )
            else:
                cursor = conn.execute(
                    """INSERT INTO option_trade_legs
                          (trade_id, option_type, position_side, expiration, strike,
                           contracts, multiplier, occ_symbol, status, sort_order)
                       VALUES (?, ?, ?, ?, ?, ?, 100, ?, 'OPEN',
                               (SELECT COUNT(*) FROM option_trade_legs WHERE trade_id = ?))""",
                    (
                        trade_id, execution["option_type"], execution["position_side"],
                        execution["expiration"], execution["strike"], execution["contracts"],
                        execution.get("occ_symbol"), trade_id,
                    ),
                )
                leg_id = int(cursor.lastrowid)
        else:
            leg = _find_matching_open_leg(conn, profile_id, execution, preferred_trade_id=trade_id)
            if not leg and trade_id:
                leg = _find_matching_open_leg(conn, profile_id, execution)
            if not leg:
                unmatched += 1
                errors.append({"row": execution["source_row"], "reason": "No matching open option leg was found"})
                continue
            leg_id = int(leg["id"])
            trade_id = int(leg["matched_trade_id"])
            remaining = _open_contracts_for_leg(conn, leg_id)
            if execution["contracts"] > remaining:
                unmatched += 1
                errors.append({"row": execution["source_row"], "reason": f"Close quantity exceeds {remaining} open contract(s)"})
                continue

        conn.execute(
            """INSERT INTO option_executions
                  (trade_id, leg_id, action, executed_at, contracts, price, fees,
                   external_id, dedupe_hash, source, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'broker_import', ?)""",
            (
                trade_id, leg_id, execution["action"], execution["executed_at"],
                execution["contracts"], execution["price"], execution["fees"],
                execution.get("external_id"), execution["dedupe_hash"], execution.get("notes"),
            ),
        )
        existing_hashes.add(execution["dedupe_hash"])
        inserted += 1
        touched.add(trade_id)

    for trade_id in touched:
        _refresh_trade_status(conn, trade_id)
    conn.commit()
    return {"inserted": inserted, "duplicates": duplicates, "unmatched": unmatched, "errors": errors, "trades_touched": len(touched)}


def annotate_import_preview(conn, profile_id, parsed):
    hashes = {
        row["dedupe_hash"] for row in conn.execute(
            "SELECT dedupe_hash FROM option_executions WHERE dedupe_hash IS NOT NULL"
        ).fetchall()
    }
    opening_keys = {_contract_key(row) for row in parsed["executions"] if row["action"] in OPEN_ACTIONS}
    duplicate_count = unmatched_count = 0
    rows = []
    for raw in parsed["executions"]:
        row = dict(raw)
        row["duplicate"] = row["dedupe_hash"] in hashes
        if row["duplicate"]:
            duplicate_count += 1
        if row["action"] in CLOSE_ACTIONS:
            match = any(
                _contract_key(row, side) in opening_keys
                for side in _position_sides_for_action(row["action"])
            ) or _find_matching_open_leg(conn, profile_id, row) is not None
            row["match_status"] = "matched" if match else "unmatched"
            if not match:
                unmatched_count += 1
        else:
            row["match_status"] = "opening"
        rows.append(row)
    result = dict(parsed)
    result["executions"] = rows
    result["summary"] = {**parsed["summary"], "duplicates": duplicate_count, "unmatched_closes": unmatched_count}
    return result


def register_routes(app, get_profile_filter, get_profile_id):
    @app.get("/api/option-trades")
    def api_option_trades():
        is_aggregate, profile_ids = get_profile_filter()
        conn = get_connection()
        try:
            profile_ids, scope = _option_trade_read_scope(conn, is_aggregate, profile_ids)
            trades = load_trades(
                conn,
                profile_ids,
                status=request.args.get("status"),
                purpose=request.args.get("purpose"),
                underlying=request.args.get("underlying"),
            )
            all_trades = load_trades(conn, profile_ids)
            return jsonify({
                "trades": trades,
                "metrics": trade_metrics(all_trades),
                "count": len(trades),
                "scope": scope,
            })
        finally:
            conn.close()

    @app.post("/api/option-trades")
    def api_create_option_trade():
        if request.args.get("aggregate_id") not in (None, ""):
            return jsonify({"error": "Option trades can only be added to an individual portfolio."}), 400
        conn = get_connection()
        try:
            trade_id = create_trade(conn, get_profile_id(), request.get_json(silent=True) or {})
            trade = load_trades(conn, [get_profile_id()])
            created = next(item for item in trade if int(item["id"]) == trade_id)
            return jsonify(created), 201
        except ValueError as exc:
            conn.rollback()
            return jsonify({"error": str(exc)}), 400
        finally:
            conn.close()

    @app.put("/api/option-trades/<int:trade_id>")
    def api_update_option_trade(trade_id):
        if request.args.get("aggregate_id") not in (None, ""):
            return jsonify({"error": "Option trades can only be edited in an individual portfolio."}), 400
        payload = request.get_json(silent=True) or {}
        purpose = str(payload.get("purpose") or "").strip().title()
        if purpose and purpose not in VALID_PURPOSES:
            return jsonify({"error": "Invalid trade purpose"}), 400
        conn = get_connection()
        try:
            row = conn.execute("SELECT id FROM option_trades WHERE id = ? AND profile_id = ?", (trade_id, get_profile_id())).fetchone()
            if not row:
                return jsonify({"error": "Option trade not found"}), 404
            fields = []
            values = []
            for key, column in (("strategy_type", "strategy_type"), ("notes", "notes")):
                if key in payload:
                    fields.append(f"{column} = ?")
                    values.append(str(payload.get(key) or "").strip() or None)
            if purpose:
                fields.append("purpose = ?")
                values.append(purpose)
            if "max_risk" in payload:
                risk = _number(payload.get("max_risk"))
                if risk is not None and risk < 0:
                    return jsonify({"error": "Maximum risk cannot be negative"}), 400
                fields.append("max_risk = ?")
                values.append(risk)
            if fields:
                values.append(trade_id)
                conn.execute(f"UPDATE option_trades SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", values)
                conn.commit()
            updated = next(item for item in load_trades(conn, [get_profile_id()]) if int(item["id"]) == trade_id)
            return jsonify(updated)
        finally:
            conn.close()

    @app.post("/api/option-trades/<int:trade_id>/close")
    def api_close_option_trade(trade_id):
        if request.args.get("aggregate_id") not in (None, ""):
            return jsonify({"error": "Option trades can only be edited in an individual portfolio."}), 400
        conn = get_connection()
        try:
            close_trade(conn, get_profile_id(), trade_id, request.get_json(silent=True) or {})
            updated = next(item for item in load_trades(conn, [get_profile_id()]) if int(item["id"]) == trade_id)
            return jsonify(updated)
        except LookupError as exc:
            conn.rollback()
            return jsonify({"error": str(exc)}), 404
        except ValueError as exc:
            conn.rollback()
            return jsonify({"error": str(exc)}), 400
        finally:
            conn.close()

    @app.delete("/api/option-trades/<int:trade_id>")
    def api_delete_option_trade(trade_id):
        if request.args.get("aggregate_id") not in (None, ""):
            return jsonify({"error": "Option trades can only be deleted in an individual portfolio."}), 400
        conn = get_connection()
        try:
            cursor = conn.execute("DELETE FROM option_trades WHERE id = ? AND profile_id = ?", (trade_id, get_profile_id()))
            conn.commit()
            if not cursor.rowcount:
                return jsonify({"error": "Option trade not found"}), 404
            return jsonify({"deleted": True, "id": trade_id})
        finally:
            conn.close()

    def parse_upload():
        upload = request.files.get("file")
        if not upload or not upload.filename:
            raise ValueError("Choose a CSV or XLSX transaction file")
        source_format = str(request.form.get("format") or "generic").strip().lower()
        suffix = os.path.splitext(upload.filename)[1].lower()
        if suffix not in {".csv", ".xlsx", ".xlsm"}:
            raise ValueError("Options imports support CSV and XLSX files")
        handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        temp_path = handle.name
        handle.close()
        try:
            upload.save(temp_path)
            return parse_option_transactions(temp_path, upload.filename, source_format)
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    @app.post("/api/option-trades/import/preview")
    def api_option_trade_import_preview():
        if request.args.get("aggregate_id") not in (None, ""):
            return jsonify({"error": "Import into an individual portfolio, not an aggregate."}), 400
        try:
            parsed = parse_upload()
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        conn = get_connection()
        try:
            return jsonify(annotate_import_preview(conn, get_profile_id(), parsed))
        finally:
            conn.close()

    @app.post("/api/option-trades/import")
    def api_option_trade_import():
        if request.args.get("aggregate_id") not in (None, ""):
            return jsonify({"error": "Import into an individual portfolio, not an aggregate."}), 400
        try:
            parsed = parse_upload()
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        conn = get_connection()
        try:
            result = import_option_executions(conn, get_profile_id(), parsed)
            return jsonify({**result, "parsed": parsed["summary"], "source_format": parsed["source_format"]})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.get("/api/option-trades/import/formats")
    def api_option_trade_import_formats():
        return jsonify([{"value": value, "label": label} for value, label in SUPPORTED_FORMATS.items()])
