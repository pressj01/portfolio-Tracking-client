import os
import sys

# Ensure backend directory is on the Python path so sibling imports work
# regardless of the working directory (e.g. when launched from project root).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
from flask import Flask, request, jsonify, session, send_file
from flask_cors import CORS
from config import get_connection
from database import ensure_tables_exist
from import_data import (
    import_from_excel, import_from_upload,
    import_weekly_payouts, import_monthly_payouts,
    import_monthly_payout_tickers,
    import_multi_excel, import_multi_upload,
)
from normalize import (
    populate_holdings,
    populate_dividends,
    populate_income_tracking,
    populate_pillar_weights,
)

app = Flask(__name__)
app.secret_key = "portfolio-tracking-client-secret-key"
CORS(app)


@app.errorhandler(500)
def handle_500(e):
    return jsonify({"error": "Internal server error", "detail": str(e)}), 500


@app.errorhandler(404)
def handle_404(e):
    return jsonify({"error": "Not found"}), 404

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_profile_id():
    """Return a single profile_id (for write operations)."""
    return int(request.args.get("profile_id", session.get("profile_id", 1)))


def get_profile_filter():
    """Return (is_aggregate, profile_ids_list) for read operations.

    If ?aggregate=true, reads member IDs from aggregate_config.
    Otherwise returns (False, [single_profile_id]).
    """
    if request.args.get("aggregate") == "true":
        conn = get_connection()
        rows = conn.execute("SELECT member_profile_id FROM aggregate_config").fetchall()
        conn.close()
        ids = [r["member_profile_id"] if isinstance(r, dict) else r[0] for r in rows]
        return True, ids if ids else [1]
    pid = int(request.args.get("profile_id", session.get("profile_id", 1)))
    return False, [pid]


def _resolve_aggregate_profile(ticker, profile_ids):
    """For aggregate writes, find the profile with the largest position for a ticker."""
    conn = get_connection()
    placeholders = ",".join("?" * len(profile_ids))
    row = conn.execute(
        f"SELECT profile_id FROM all_account_info WHERE ticker = ? AND profile_id IN ({placeholders}) ORDER BY quantity DESC LIMIT 1",
        [ticker] + profile_ids,
    ).fetchone()
    conn.close()
    if row:
        return row["profile_id"] if isinstance(row, dict) else row[0]
    return profile_ids[0]


def _get_write_profile_id():
    """Get a single profile_id for write operations, resolving aggregate if needed."""
    is_agg, pids = get_profile_filter()
    if is_agg:
        return pids[0]  # default; caller should use _resolve_aggregate_profile for ticker-specific ops
    return pids[0]


def rows_to_dicts(rows):
    """Convert sqlite3.Row results to a list of dicts."""
    return [dict(r) for r in rows]


def _estimate_month_income(holding, month):
    """Estimate income for a specific month (1-12) from a single holding.

    Uses div_frequency and ex_div_date to determine whether the holding
    pays out in the given calendar month and returns qty * div if so.
    Weekly payers use 4.33 payments per month (52 / 12).
    """
    import datetime

    qty = float(holding.get("quantity") or 0)
    div = float(holding.get("div") or 0)
    freq = (holding.get("div_frequency") or "").strip().upper()
    ex_raw = holding.get("ex_div_date") or ""

    if qty <= 0 or div <= 0 or not freq:
        return 0.0

    # Weekly: one payment per week, 52 per year ≈ 4.33 per month.
    # Consistent with the projected income chart (annual / 52 * 4.33).
    if freq in ("W", "52"):
        return round(qty * div * 4.33, 2)

    # Monthly: always pays
    if freq == "M":
        return round(qty * div, 2)

    # For Q / SA / A we need the ex_div_date to figure out the cycle
    ex_month = None
    for fmt in ("%m/%d/%y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            ex_month = datetime.datetime.strptime(ex_raw.strip(), fmt).month
            break
        except (ValueError, TypeError):
            continue

    if ex_month is None:
        return 0.0

    period = {"Q": 3, "SA": 6, "A": 12}.get(freq)
    if period is None:
        return 0.0

    if (month - ex_month) % period == 0:
        return round(qty * div, 2)

    return 0.0


def _estimate_current_month_income(holding):
    """Estimate income for the current month from a single holding."""
    import datetime
    return _estimate_month_income(holding, datetime.date.today().month)


def _estimate_ytd_income(holding):
    """Estimate year-to-date income from a single holding (Jan through current month)."""
    import datetime
    cur_month = datetime.date.today().month
    return sum(_estimate_month_income(holding, m) for m in range(1, cur_month + 1))


def _auto_reconcile_owner():
    """Silently reconcile Owner (profile 1) from sub-profiles after any import.

    Only runs if the Owner import has been used (owner_import_used setting).
    Syncs quantities, prices, and income fields while preserving Owner-only
    data (ytd_divs, total_divs_received, paid_for_itself, current_month_income,
    estim_payment_per_year, approx_monthly_income).
    """
    from datetime import date as _date

    conn = get_connection()
    owner_id = 1

    # Only reconcile if Owner import was used
    _oiu = conn.execute(
        "SELECT value FROM settings WHERE key = 'owner_import_used'"
    ).fetchone()
    if not (_oiu and _oiu[0] == "true"):
        conn.close()
        return

    # Get all non-Owner profiles that are marked for inclusion
    rows = conn.execute("SELECT id FROM profiles WHERE id != ? AND include_in_owner = 1", (owner_id,)).fetchall()
    source_ids = [r["id"] if isinstance(r, dict) else r[0] for r in rows]
    if not source_ids:
        conn.close()
        return

    placeholders = ",".join("?" * len(source_ids))

    # Aggregate holdings from source portfolios
    agg_rows = conn.execute(f"""
        SELECT
            ticker,
            MAX(description) as description,
            MAX(classification_type) as classification_type,
            SUM(quantity) as quantity,
            CASE WHEN SUM(quantity) > 0 THEN SUM(purchase_value) / SUM(quantity) ELSE 0 END as price_paid,
            MAX(current_price) as current_price,
            SUM(purchase_value) as purchase_value,
            SUM(current_value) as current_value,
            SUM(gain_or_loss) as gain_or_loss,
            CASE WHEN SUM(purchase_value) > 0 THEN SUM(gain_or_loss) / SUM(purchase_value) ELSE 0 END as gain_or_loss_percentage,
            CASE WHEN SUM(purchase_value) > 0 THEN SUM(gain_or_loss) / SUM(purchase_value) ELSE 0 END as percent_change,
            MAX(div_frequency) as div_frequency,
            MAX(reinvest) as reinvest,
            MAX(ex_div_date) as ex_div_date,
            MAX(div_pay_date) as div_pay_date,
            MAX(div) as div,
            SUM(dividend_paid) as dividend_paid,
            SUM(estim_payment_per_year) as estim_payment_per_year,
            SUM(approx_monthly_income) as approx_monthly_income,
            SUM(withdraw_8pct_cost_annually) as withdraw_8pct_cost_annually,
            SUM(withdraw_8pct_per_month) as withdraw_8pct_per_month,
            SUM(cash_not_reinvested) as cash_not_reinvested,
            SUM(total_cash_reinvested) as total_cash_reinvested,
            SUM(shares_bought_from_dividend) as shares_bought_from_dividend,
            SUM(shares_bought_in_year) as shares_bought_in_year,
            SUM(shares_in_month) as shares_in_month,
            MIN(purchase_date) as purchase_date
        FROM all_account_info
        WHERE profile_id IN ({placeholders})
        GROUP BY ticker
    """, source_ids).fetchall()

    agg_map = {r["ticker"]: dict(r) for r in agg_rows}

    owner_rows = conn.execute(
        "SELECT ticker FROM all_account_info WHERE profile_id = ?", (owner_id,)
    ).fetchall()
    owner_tickers = {r["ticker"] for r in owner_rows}

    # Sync these fields from sub-profiles.  Owner-only payout history fields
    # (ytd_divs, total_divs_received, paid_for_itself, current_month_income)
    # are preserved since sub-profiles don't track those.
    sync_fields = [
        "description", "classification_type", "quantity", "price_paid",
        "current_price", "purchase_value", "current_value", "gain_or_loss",
        "gain_or_loss_percentage", "percent_change", "div_frequency", "reinvest",
        "ex_div_date", "div_pay_date", "div", "dividend_paid",
        "estim_payment_per_year", "approx_monthly_income",
        "withdraw_8pct_cost_annually", "withdraw_8pct_per_month",
        "cash_not_reinvested", "total_cash_reinvested",
        "shares_bought_from_dividend", "shares_bought_in_year", "shares_in_month",
        "purchase_date",
    ]

    for ticker, agg in agg_map.items():
        if ticker in owner_tickers:
            sets = [f"{f} = ?" for f in sync_fields] + ["import_date = ?"]
            vals = [agg.get(f) for f in sync_fields] + [_date.today().isoformat(), ticker, owner_id]
            conn.execute(
                f"UPDATE all_account_info SET {', '.join(sets)} WHERE ticker = ? AND profile_id = ?",
                vals,
            )
        else:
            cols = ["ticker", "profile_id", "import_date"] + sync_fields
            vals = [ticker, owner_id, _date.today().isoformat()] + [agg.get(f) for f in sync_fields]
            ph = ",".join("?" * len(cols))
            conn.execute(f"INSERT INTO all_account_info ({', '.join(cols)}) VALUES ({ph})", vals)

    # Remove tickers from Owner that no longer exist in any sub-portfolio
    for ticker in owner_tickers - set(agg_map.keys()):
        conn.execute(
            "DELETE FROM all_account_info WHERE ticker = ? AND profile_id = ?",
            (ticker, owner_id),
        )

    conn.commit()

    # Refresh derived tables for Owner
    populate_holdings(owner_id)
    populate_dividends(owner_id)
    populate_income_tracking(owner_id)

    conn.close()


# ── Startup ────────────────────────────────────────────────────────────────────

@app.before_request
def _ensure_db():
    """Create tables on first request if they don't exist."""
    if not getattr(app, '_db_initialized', False):
        conn = get_connection()
        ensure_tables_exist(conn)
        conn.close()
        app._db_initialized = True


# ── Profiles ───────────────────────────────────────────────────────────────────

@app.route("/api/profiles", methods=["GET"])
def list_profiles():
    conn = get_connection()
    rows = conn.execute("SELECT id, name, created_at FROM profiles ORDER BY id").fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/profiles", methods=["POST"])
def create_profile():
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    conn = get_connection()
    cur = conn.execute("INSERT INTO profiles (name) VALUES (?)", (name,))
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return jsonify({"id": pid, "name": name}), 201


@app.route("/api/profiles/<int:pid>", methods=["PUT"])
def update_profile(pid):
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    conn = get_connection()
    conn.execute("UPDATE profiles SET name = ? WHERE id = ?", (name, pid))
    conn.commit()
    conn.close()
    return jsonify({"id": pid, "name": name})


@app.route("/api/profiles/<int:pid>", methods=["DELETE"])
def delete_profile(pid):
    if pid == 1:
        return jsonify({"error": "Cannot delete the default profile"}), 400
    conn = get_connection()
    _clear_profile_data(conn, pid)
    conn.execute("DELETE FROM aggregate_config WHERE member_profile_id = ?", (pid,))
    conn.execute("DELETE FROM profiles WHERE id = ?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"deleted": pid})


def _clear_profile_data(conn, pid):
    """Remove all data for a profile from every profile-scoped table."""
    for table in [
        "all_account_info", "holdings", "dividends", "income_tracking",
        "weekly_payouts", "monthly_payouts", "weekly_payout_tickers",
        "monthly_payout_tickers", "drip_settings", "drip_contribution_targets",
        "drip_redirects", "swap_candidates", "ticker_categories",
    ]:
        conn.execute(f"DELETE FROM {table} WHERE profile_id = ?", (pid,))


@app.route("/api/profiles/<int:pid>/clear", methods=["POST"])
def clear_profile_data(pid):
    """Clear all data for a profile without deleting the profile itself."""
    conn = get_connection()
    _clear_profile_data(conn, pid)
    conn.commit()
    conn.close()
    return jsonify({"cleared": pid, "message": f"All data cleared for profile {pid}"})


@app.route("/api/profiles/<int:pid>/include-in-owner", methods=["PUT"])
def set_include_in_owner(pid):
    """Toggle whether a profile is included in Owner reconciliation."""
    if pid == 1:
        return jsonify({"error": "Owner is always included"}), 400
    data = request.get_json() or {}
    val = 1 if data.get("include") else 0
    conn = get_connection()
    conn.execute("UPDATE profiles SET include_in_owner = ? WHERE id = ?", (val, pid))
    conn.commit()
    conn.close()
    return jsonify({"id": pid, "include_in_owner": val})


@app.route("/api/profiles/summary", methods=["GET"])
def profiles_summary():
    """Return per-profile stats for the Manage Portfolios page."""
    conn = get_connection()
    rows = conn.execute("""
        SELECT p.id, p.name, p.created_at, p.include_in_owner,
               COUNT(a.ticker) as holdings_count,
               COALESCE(SUM(a.current_value), 0) as total_value
        FROM profiles p
        LEFT JOIN all_account_info a ON p.id = a.profile_id
        GROUP BY p.id
        ORDER BY p.id
    """).fetchall()
    flag = conn.execute("SELECT value FROM settings WHERE key = 'owner_import_used'").fetchone()
    conn.close()
    return jsonify({"profiles": rows_to_dicts(rows), "owner_import_used": bool(flag)})


@app.route("/api/aggregate-config", methods=["GET"])
def get_aggregate_config():
    conn = get_connection()
    rows = conn.execute("SELECT member_profile_id FROM aggregate_config").fetchall()
    name_row = conn.execute("SELECT value FROM settings WHERE key = 'aggregate_name'").fetchone()
    conn.close()
    ids = [r["member_profile_id"] if isinstance(r, dict) else r[0] for r in rows]
    name = (name_row[0] if name_row else "Aggregate")
    return jsonify({"member_ids": ids, "name": name})


@app.route("/api/aggregate-config", methods=["PUT"])
def set_aggregate_config():
    data = request.get_json()
    member_ids = data.get("member_ids", [])
    name = data.get("name", "Aggregate")
    conn = get_connection()
    conn.execute("DELETE FROM aggregate_config")
    for mid in member_ids:
        conn.execute("INSERT OR IGNORE INTO aggregate_config (member_profile_id) VALUES (?)", (mid,))
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ("aggregate_name", name))
    conn.commit()
    conn.close()
    return jsonify({"member_ids": member_ids, "name": name})


@app.route("/api/aggregate-config", methods=["DELETE"])
def delete_aggregate_config():
    conn = get_connection()
    conn.execute("DELETE FROM aggregate_config")
    conn.execute("DELETE FROM settings WHERE key = 'aggregate_name'")
    conn.commit()
    conn.close()
    return jsonify({"deleted": True})


@app.route("/api/profiles/reconcile-owner", methods=["POST"])
def reconcile_owner():
    """Compare Owner (profile 1) against the sum of the other portfolios and sync mismatches.

    For each ticker across all non-Owner profiles:
    - If missing from Owner: insert it
    - If quantity/value differs: update Owner
    - If ticker exists in Owner but not in any sub-portfolio: remove it
    """
    from datetime import date as _date

    data = request.get_json() or {}
    source_ids = data.get("source_ids", [])

    conn = get_connection()
    owner_id = 1

    if not source_ids:
        # Default: all profiles except Owner that are marked for inclusion
        rows = conn.execute("SELECT id FROM profiles WHERE id != ? AND include_in_owner = 1", (owner_id,)).fetchall()
        source_ids = [r["id"] if isinstance(r, dict) else r[0] for r in rows]

    if not source_ids:
        conn.close()
        return jsonify({"error": "No source portfolios to reconcile from"}), 400

    placeholders = ",".join("?" * len(source_ids))

    # Aggregate holdings from source portfolios
    agg_rows = conn.execute(f"""
        SELECT
            ticker,
            MAX(description) as description,
            MAX(classification_type) as classification_type,
            SUM(quantity) as quantity,
            CASE WHEN SUM(quantity) > 0 THEN SUM(purchase_value) / SUM(quantity) ELSE 0 END as price_paid,
            MAX(current_price) as current_price,
            SUM(purchase_value) as purchase_value,
            SUM(current_value) as current_value,
            SUM(gain_or_loss) as gain_or_loss,
            CASE WHEN SUM(purchase_value) > 0 THEN SUM(gain_or_loss) / SUM(purchase_value) ELSE 0 END as gain_or_loss_percentage,
            CASE WHEN SUM(purchase_value) > 0 THEN SUM(gain_or_loss) / SUM(purchase_value) ELSE 0 END as percent_change,
            MAX(div_frequency) as div_frequency,
            MAX(reinvest) as reinvest,
            MAX(ex_div_date) as ex_div_date,
            MAX(div_pay_date) as div_pay_date,
            MAX(div) as div,
            SUM(dividend_paid) as dividend_paid,
            SUM(estim_payment_per_year) as estim_payment_per_year,
            SUM(approx_monthly_income) as approx_monthly_income,
            SUM(withdraw_8pct_cost_annually) as withdraw_8pct_cost_annually,
            SUM(withdraw_8pct_per_month) as withdraw_8pct_per_month,
            SUM(cash_not_reinvested) as cash_not_reinvested,
            SUM(total_cash_reinvested) as total_cash_reinvested,
            SUM(shares_bought_from_dividend) as shares_bought_from_dividend,
            SUM(shares_bought_in_year) as shares_bought_in_year,
            SUM(shares_in_month) as shares_in_month,
            SUM(ytd_divs) as ytd_divs,
            SUM(total_divs_received) as total_divs_received,
            CASE WHEN SUM(purchase_value) > 0 THEN SUM(total_divs_received) / SUM(purchase_value) ELSE 0 END as paid_for_itself,
            MIN(purchase_date) as purchase_date,
            SUM(current_month_income) as current_month_income
        FROM all_account_info
        WHERE profile_id IN ({placeholders})
        GROUP BY ticker
    """, source_ids).fetchall()

    agg_map = {r["ticker"]: dict(r) for r in agg_rows}

    # Get current Owner holdings
    owner_rows = conn.execute(
        "SELECT ticker, quantity, current_value FROM all_account_info WHERE profile_id = ?",
        (owner_id,),
    ).fetchall()
    owner_tickers = {r["ticker"] for r in owner_rows}
    owner_qty = {r["ticker"]: r["quantity"] for r in owner_rows}

    inserted = 0
    updated = 0
    removed = 0

    # Fields to sync from sub-profiles to Owner.
    # Owner-only payout history fields are preserved: ytd_divs,
    # total_divs_received, paid_for_itself, current_month_income.
    update_fields = [
        "description", "classification_type", "quantity", "price_paid",
        "current_price", "purchase_value", "current_value", "gain_or_loss",
        "gain_or_loss_percentage", "percent_change", "div_frequency", "reinvest",
        "ex_div_date", "div_pay_date", "div", "dividend_paid",
        "estim_payment_per_year", "approx_monthly_income",
        "withdraw_8pct_cost_annually", "withdraw_8pct_per_month",
        "cash_not_reinvested", "total_cash_reinvested",
        "shares_bought_from_dividend", "shares_bought_in_year", "shares_in_month",
        "purchase_date",
    ]

    for ticker, agg in agg_map.items():
        if ticker in owner_tickers:
            # Sync quantity/income fields from sub-portfolios, preserve Owner-only fields
            sets = []
            vals = []
            for f in update_fields:
                v = agg.get(f)
                sets.append(f"{f} = ?")
                vals.append(v)
            sets.append("import_date = ?")
            vals.append(_date.today().isoformat())
            vals.extend([ticker, owner_id])
            conn.execute(
                f"UPDATE all_account_info SET {', '.join(sets)} WHERE ticker = ? AND profile_id = ?",
                vals,
            )
            updated += 1
        else:
            # Insert new ticker into Owner (includes all fields since Owner has no prior data)
            all_fields = update_fields + ["ytd_divs", "total_divs_received", "paid_for_itself", "current_month_income"]
            cols = ["ticker", "profile_id", "import_date"] + all_fields
            vals = [ticker, owner_id, _date.today().isoformat()] + [agg.get(f) for f in all_fields]
            ph = ",".join("?" * len(cols))
            conn.execute(f"INSERT INTO all_account_info ({', '.join(cols)}) VALUES ({ph})", vals)
            inserted += 1

    # Remove tickers from Owner that no longer exist in any sub-portfolio
    agg_tickers = set(agg_map.keys())
    for ticker in owner_tickers - agg_tickers:
        conn.execute(
            "DELETE FROM all_account_info WHERE ticker = ? AND profile_id = ?",
            (ticker, owner_id),
        )
        removed += 1

    conn.commit()

    # Refresh derived tables for Owner
    populate_holdings(owner_id)
    populate_dividends(owner_id)
    populate_income_tracking(owner_id)

    conn.close()

    parts = []
    if updated: parts.append(f"{updated} updated")
    if inserted: parts.append(f"{inserted} added")
    if removed: parts.append(f"{removed} removed")
    msg = f"Owner reconciled: {', '.join(parts)}." if parts else "Owner is already in sync — no changes needed."

    return jsonify({"updated": updated, "inserted": inserted, "removed": removed, "message": msg})


# ── Import endpoints ──────────────────────────────────────────────────────────

@app.route("/api/import/excel", methods=["POST"])
def api_import_excel():
    """Import the owner's Excel spreadsheet (All Accounts sheet)."""
    profile_id = get_profile_id()
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    path = os.path.join(UPLOAD_FOLDER, f.filename)
    f.save(path)
    try:
        multi = request.form.get("multi_sheet", "false").lower() == "true"
        if multi:
            results = import_multi_excel(path, default_profile_id=profile_id)
            # Populate derived tables for each imported profile
            for r in results:
                if r["rows"] > 0:
                    populate_holdings(r["profile_id"])
                    populate_dividends(r["profile_id"])
                    populate_income_tracking(r["profile_id"])
                    populate_pillar_weights(r["profile_id"])
            total = sum(r["rows"] for r in results)
            # Mark owner import as used
            conn2 = get_connection()
            conn2.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ("owner_import_used", "true"))
            conn2.commit()
            conn2.close()
            # Auto-reconcile Owner quantities from sub-profiles
            _auto_reconcile_owner()
            return jsonify({"rows": total, "message": f"Imported {len(results)} sheets ({total} total holdings)", "details": results})
        else:
            sheet = request.form.get("sheet_name", "All Accounts")
            count, msg = import_from_excel(path, sheet_name=sheet, profile_id=profile_id)
            # Auto-populate derived tables
            populate_holdings(profile_id)
            populate_dividends(profile_id)
            populate_income_tracking(profile_id)
            populate_pillar_weights(profile_id)
            # Mark owner import as used
            conn2 = get_connection()
            conn2.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ("owner_import_used", "true"))
            conn2.commit()
            conn2.close()
            # Auto-reconcile Owner quantities from sub-profiles
            _auto_reconcile_owner()
            return jsonify({"rows": count, "message": msg})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.route("/api/import/generic", methods=["POST"])
def api_import_generic():
    """Import a generic user spreadsheet (Ticker + Shares minimum)."""
    profile_id = get_profile_id()
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    path = os.path.join(UPLOAD_FOLDER, f.filename)
    f.save(path)
    try:
        multi = request.form.get("multi_sheet", "false").lower() == "true"
        if multi:
            results = import_multi_upload(path)
            for r in results:
                if r["rows"] > 0:
                    populate_holdings(r["profile_id"])
                    populate_dividends(r["profile_id"])
                    populate_income_tracking(r["profile_id"])
            total = sum(r["rows"] for r in results)
            # Auto-reconcile Owner quantities from sub-profiles
            _auto_reconcile_owner()
            return jsonify({"rows": total, "message": f"Imported {len(results)} portfolios ({total} total holdings)", "details": results})
        else:
            df = pd.read_excel(path, engine="openpyxl")
            count, msg = import_from_upload(df, profile_id)
            populate_holdings(profile_id)
        populate_dividends(profile_id)
        populate_income_tracking(profile_id)
        # Auto-reconcile Owner if a sub-profile was imported
        if profile_id != 1:
            _auto_reconcile_owner()
        return jsonify({"rows": count, "message": msg})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.route("/api/import/weekly-payouts", methods=["POST"])
def api_import_weekly():
    # Weekly payouts are portfolio-wide actuals — always store under Owner (id=1)
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    path = os.path.join(UPLOAD_FOLDER, f.filename)
    f.save(path)
    try:
        count, msg = import_weekly_payouts(path, 1)
        return jsonify({"rows": count, "message": msg})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.route("/api/import/monthly-payouts", methods=["POST"])
def api_import_monthly():
    # Monthly payouts are portfolio-wide actuals — always store under Owner (id=1)
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    path = os.path.join(UPLOAD_FOLDER, f.filename)
    f.save(path)
    try:
        count, msg = import_monthly_payouts(path, 1)
        return jsonify({"rows": count, "message": msg})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.route("/api/import/monthly-payout-tickers", methods=["POST"])
def api_import_monthly_tickers():
    # Monthly payout tickers are portfolio-wide — always store under Owner (id=1)
    profile_id = 1
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    path = os.path.join(UPLOAD_FOLDER, f.filename)
    f.save(path)
    try:
        count, msg = import_monthly_payout_tickers(path, profile_id)
        return jsonify({"rows": count, "message": msg})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if os.path.exists(path):
            os.remove(path)


# ── Ticker Lookup (yfinance) ────────────────────────────────────────────────────

@app.route("/api/lookup/<ticker>", methods=["GET"])
def lookup_ticker(ticker):
    """Fetch current price, dividend info, and description from Yahoo Finance."""
    import yfinance as yf
    from datetime import datetime as _dt

    ticker = ticker.strip().upper()
    result = {
        "ticker": ticker,
        "description": ticker,
        "classification_type": "ETF",
        "current_price": 0,
        "div": 0,
        "div_frequency": "Q",
        "ex_div_date": None,
        "div_pay_date": None,
        "dividend_paid": 0,
        "ytd_divs": 0,
        "total_divs_received": 0,
        "paid_for_itself": 0,
    }

    try:
        tk = yf.Ticker(ticker)
        info = tk.info or {}

        # Detect ticker rename (e.g. TOPW → WPAY)
        actual_symbol = info.get("symbol", "").upper()
        if actual_symbol and actual_symbol != ticker:
            # yfinance resolved this to a different ticker — fetch data under the new symbol
            tk = yf.Ticker(actual_symbol)
            info = tk.info or {}
            result["renamed_to"] = actual_symbol

        result["description"] = (info.get("longName") or info.get("shortName") or ticker)[:200]
        result["classification_type"] = (info.get("quoteType") or "ETF")[:20]
        result["current_price"] = info.get("regularMarketPrice") or info.get("currentPrice") or 0

        # Infer frequency and div from dividend history
        freq_code = "Q"
        try:
            hist = tk.dividends
            if hist is not None and len(hist) > 0:
                # Match timezone awareness of the index
                if hist.index.tz is not None:
                    one_year_ago = pd.Timestamp.now(tz=hist.index.tz) - pd.Timedelta(days=365)
                else:
                    one_year_ago = pd.Timestamp.now() - pd.Timedelta(days=365)
                recent = hist[hist.index >= one_year_ago]
                n = len(recent[recent > 0])
                if n >= 45:
                    freq_code = "W"
                elif n >= 10:
                    freq_code = "M"
                elif n >= 3:
                    freq_code = "Q"
                elif n >= 2:
                    freq_code = "SA"
                elif n >= 1:
                    freq_code = "A"

                # Last dividend per share (actual payment, not annual rate)
                last_div = recent[recent > 0]
                if not last_div.empty:
                    result["div"] = round(float(last_div.iloc[-1]), 6)

                # Ex-div date from last payment
                result["ex_div_date"] = last_div.index[-1].strftime("%m/%d/%y") if not last_div.empty else None
        except Exception:
            # Fallback to info fields
            annual_rate = info.get("dividendRate") or 0
            if annual_rate:
                result["div"] = round(annual_rate, 6)
            ex_ts = info.get("exDividendDate")
            if ex_ts:
                try:
                    result["ex_div_date"] = _dt.utcfromtimestamp(ex_ts).strftime("%m/%d/%y")
                except Exception:
                    pass

        result["div_frequency"] = freq_code

        # Dividend pay date — try yfinance calendar, else estimate from ex-div + 2-4 weeks
        try:
            cal = tk.calendar
            if cal is not None:
                # yfinance returns calendar as dict or DataFrame depending on version
                pay_date = None
                if isinstance(cal, dict):
                    pay_date = cal.get("Dividend Date") or cal.get("Payment Date")
                elif hasattr(cal, "loc"):
                    for key in ["Dividend Date", "Payment Date"]:
                        if key in cal.index:
                            pay_date = cal.loc[key].iloc[0] if hasattr(cal.loc[key], "iloc") else cal.loc[key]
                            break
                if pay_date is not None:
                    if hasattr(pay_date, "strftime"):
                        result["div_pay_date"] = pay_date.strftime("%m/%d/%y")
                    elif isinstance(pay_date, (int, float)):
                        result["div_pay_date"] = _dt.fromtimestamp(pay_date, tz=__import__('datetime').timezone.utc).strftime("%m/%d/%y")
        except Exception:
            pass

        # Estimate: ex-div + 3 weeks if we have ex-div but no pay date
        if not result["div_pay_date"] and result["ex_div_date"]:
            try:
                ex = _dt.strptime(result["ex_div_date"], "%m/%d/%y")
                est_pay = ex + pd.Timedelta(days=21)
                result["div_pay_date"] = est_pay.strftime("%m/%d/%y")
            except Exception:
                pass

    except Exception as e:
        return jsonify({"error": f"Could not look up {ticker}: {str(e)}"}), 404

    return jsonify(result)


# ── Refresh Market Data ─────────────────────────────────────────────────────────

@app.route("/api/refresh", methods=["POST"])
def refresh_market_data():
    """Update current price, div/share, ex-div date, and frequency for all holdings from Yahoo Finance."""
    import yfinance as yf
    from datetime import datetime as _dt

    profile_id = get_profile_id()
    conn = get_connection()

    # Refresh ALL profiles (including aggregate members) so div/income
    # values stay consistent across Owner and sub-profiles
    all_pids = [r[0] for r in conn.execute(
        "SELECT id FROM profiles"
    ).fetchall()] or [profile_id]

    # Collect unique tickers and per-profile holdings across ALL profiles
    all_rows = conn.execute(
        "SELECT profile_id, ticker, quantity, price_paid, purchase_value FROM all_account_info WHERE profile_id IN ({})".format(
            ",".join("?" * len(all_pids))
        ), all_pids,
    ).fetchall()

    if not all_rows:
        conn.close()
        return jsonify({"updated": 0, "message": "No holdings to refresh"})

    tickers = list({r["ticker"] for r in all_rows})
    # Build per-profile holding map: {(profile_id, ticker): (qty, price_paid, purchase_value)}
    holding_map = {}
    for r in all_rows:
        holding_map[(r["profile_id"], r["ticker"])] = (r["quantity"] or 0, r["price_paid"] or 0, r["purchase_value"] or 0)

    # Batch download prices + dividends (one yfinance call for all tickers)
    ticker_str = " ".join(tickers)
    price_map = {}
    div_map = {}
    exdiv_map = {}
    freq_map = {}

    try:
        raw = yf.download(ticker_str, period="1y", progress=False, auto_adjust=False, actions=True)
        if not raw.empty:
            def _col(name):
                if isinstance(raw.columns, pd.MultiIndex):
                    return raw[name] if name in raw.columns.get_level_values(0) else None
                return raw[name] if name in raw.columns else None

            # Prices
            close = _col("Close")
            if close is not None:
                if isinstance(close, pd.Series):
                    s = close.dropna()
                    if len(s):
                        price_map[tickers[0]] = float(s.iloc[-1])
                else:
                    for t in tickers:
                        if t in close.columns:
                            s = close[t].dropna()
                            if len(s):
                                price_map[t] = float(s.iloc[-1])

            # Dividends
            divs = _col("Dividends")
            if divs is not None:
                if isinstance(divs, pd.Series):
                    d = divs[divs > 0].dropna()
                    if not d.empty:
                        t0 = tickers[0]
                        div_map[t0] = float(d.iloc[-1])
                        exdiv_map[t0] = d.index[-1].strftime("%m/%d/%y")
                        n = len(d)
                        freq_map[t0] = "W" if n >= 45 else "M" if n >= 10 else "Q" if n >= 3 else "SA" if n >= 2 else "A"
                else:
                    for t in tickers:
                        if t in divs.columns:
                            d = divs[t][divs[t] > 0].dropna()
                            if not d.empty:
                                div_map[t] = float(d.iloc[-1])
                                exdiv_map[t] = d.index[-1].strftime("%m/%d/%y")
                                n = len(d)
                                freq_map[t] = "W" if n >= 45 else "M" if n >= 10 else "Q" if n >= 3 else "SA" if n >= 2 else "A"
    except Exception:
        pass

    # Detect renamed tickers: if a ticker got no price data from batch download,
    # check if yfinance maps it to a new symbol and pull data under that column.
    rename_map = {}  # old_ticker -> new_ticker
    for t in tickers:
        if t not in price_map:
            try:
                info = yf.Ticker(t).info or {}
                new_sym = (info.get("symbol") or "").upper()
                if new_sym and new_sym != t:
                    rename_map[t] = new_sym
                    # Try to pull data from the new symbol's column in the batch download
                    if not raw.empty and isinstance(raw.columns, pd.MultiIndex):
                        close = raw["Close"] if "Close" in raw.columns.get_level_values(0) else None
                        if close is not None and not isinstance(close, pd.Series) and new_sym in close.columns:
                            s = close[new_sym].dropna()
                            if len(s):
                                price_map[t] = float(s.iloc[-1])
                        divs = raw["Dividends"] if "Dividends" in raw.columns.get_level_values(0) else None
                        if divs is not None and not isinstance(divs, pd.Series) and new_sym in divs.columns:
                            d = divs[new_sym][divs[new_sym] > 0].dropna()
                            if not d.empty:
                                div_map[t] = float(d.iloc[-1])
                                exdiv_map[t] = d.index[-1].strftime("%m/%d/%y")
                                n = len(d)
                                freq_map[t] = "W" if n >= 45 else "M" if n >= 10 else "Q" if n >= 3 else "SA" if n >= 2 else "A"
                    # If still no data, try a separate download for the new symbol
                    if t not in price_map:
                        try:
                            r2 = yf.download(new_sym, period="1y", progress=False, auto_adjust=False, actions=True)
                            if not r2.empty:
                                c2 = r2["Close"] if "Close" in r2.columns else (r2["Close"][new_sym] if isinstance(r2.columns, pd.MultiIndex) else None)
                                if c2 is not None:
                                    s2 = c2.squeeze().dropna()
                                    if len(s2):
                                        price_map[t] = float(s2.iloc[-1])
                                d2 = r2["Dividends"] if "Dividends" in r2.columns else (r2["Dividends"][new_sym] if isinstance(r2.columns, pd.MultiIndex) else None)
                                if d2 is not None:
                                    d2s = d2.squeeze()
                                    d2s = d2s[d2s > 0].dropna()
                                    if not d2s.empty:
                                        div_map[t] = float(d2s.iloc[-1])
                                        exdiv_map[t] = d2s.index[-1].strftime("%m/%d/%y")
                                        n = len(d2s)
                                        freq_map[t] = "W" if n >= 45 else "M" if n >= 10 else "Q" if n >= 3 else "SA" if n >= 2 else "A"
                        except Exception:
                            pass
                    # Update description if it matches the ticker (i.e., never got enriched)
                    if new_sym:
                        try:
                            new_info = yf.Ticker(new_sym).info or {}
                            new_desc = new_info.get("longName") or new_info.get("shortName")
                            if new_desc:
                                for pid in all_pids:
                                    conn.execute(
                                        "UPDATE all_account_info SET description = ? WHERE ticker = ? AND profile_id = ? AND (description = ? OR description IS NULL OR description = '')",
                                        (new_desc[:200], t, pid, t),
                                    )
                        except Exception:
                            pass
            except Exception:
                pass

    # Load known weekly tickers across all profiles
    weekly_set = set()
    try:
        wrows = conn.execute("SELECT DISTINCT ticker FROM weekly_payout_tickers").fetchall()
        weekly_set = {r["ticker"] for r in wrows}
    except Exception:
        pass

    # Load current DB frequencies across all profiles (use highest rank per ticker)
    db_freq_map = {}
    try:
        frows = conn.execute("SELECT ticker, div_frequency FROM all_account_info").fetchall()
        freq_rank = {'W': 6, '52': 6, 'M': 5, 'Q': 4, 'SA': 3, 'A': 2, None: 0}
        for r in frows:
            t, f = r["ticker"], r["div_frequency"]
            if freq_rank.get(f, 0) > freq_rank.get(db_freq_map.get(t), 0):
                db_freq_map[t] = f
    except Exception:
        pass

    # Resolve effective frequency per ticker (once, shared across profiles)
    freq_rank = {'W': 6, '52': 6, 'M': 5, 'Q': 4, 'SA': 3, 'A': 2, None: 0}
    effective_freq = {}
    for t in tickers:
        nf = freq_map.get(t)
        if t in weekly_set:
            nf = 'W'
        else:
            db_rank = freq_rank.get(db_freq_map.get(t), 0)
            new_rank = freq_rank.get(nf, 0)
            if new_rank < db_rank:
                nf = db_freq_map.get(t)
        effective_freq[t] = nf

    updated = 0
    updated_pids = set()
    for pid in all_pids:
        for t in tickers:
            key = (pid, t)
            if key not in holding_map:
                continue

            new_price = price_map.get(t)
            new_div = div_map.get(t)
            new_exdiv = exdiv_map.get(t)
            new_freq = effective_freq.get(t)

            if not new_price and not new_div:
                continue

            qty, price_paid, purchase_value = holding_map[key]
            sets = []
            vals = []

            if new_price:
                current_value = new_price * qty
                gain = current_value - purchase_value if purchase_value else 0
                gain_pct = (gain / purchase_value) if purchase_value else 0
                sets.extend(["current_price = ?", "current_value = ?", "gain_or_loss = ?",
                             "gain_or_loss_percentage = ?", "percent_change = ?"])
                vals.extend([new_price, current_value, gain, gain_pct, gain_pct])

            if new_div:
                freq_mult = {'W': 52, '52': 52, 'M': 12, 'Q': 4, 'SA': 2, 'A': 1}
                cur_freq = (new_freq or 'Q').upper()
                mult = freq_mult.get(cur_freq, 4)
                annual_div = new_div * mult
                yoc = (annual_div / price_paid) if price_paid else 0
                cur_yield = (annual_div / new_price) if new_price else 0
                estim_annual = new_div * qty * mult
                estim_monthly = estim_annual / 12 if estim_annual else 0
                sets.extend(["div = ?", "annual_yield_on_cost = ?", "current_annual_yield = ?",
                             "estim_payment_per_year = ?", "approx_monthly_income = ?"])
                vals.extend([new_div, yoc, cur_yield, estim_annual, estim_monthly])

            if new_exdiv:
                sets.append("ex_div_date = ?")
                vals.append(new_exdiv)
                try:
                    ex_dt = _dt.strptime(new_exdiv, "%m/%d/%y")
                    est_pay = ex_dt + pd.Timedelta(days=21)
                    sets.append("div_pay_date = ?")
                    vals.append(est_pay.strftime("%m/%d/%y"))
                except Exception:
                    pass

            if new_freq:
                sets.append("div_frequency = ?")
                vals.append(new_freq)

            if sets:
                vals.extend([t, pid])
                conn.execute(
                    f"UPDATE all_account_info SET {', '.join(sets)} WHERE ticker = ? AND profile_id = ?",
                    vals,
                )
                updated += 1
                updated_pids.add(pid)

    conn.commit()

    # Update derived tables for all affected profiles
    for pid in updated_pids:
        populate_holdings(pid)
        populate_dividends(pid)

    conn.close()
    # Report count for the selected profile's tickers
    selected_count = sum(1 for t in tickers if (profile_id, t) in holding_map)
    return jsonify({"updated": updated, "message": f"Refreshed {selected_count} of {selected_count} holdings"})


# ── Holdings CRUD ──────────────────────────────────────────────────────────────

@app.route("/api/holdings", methods=["GET"])
def list_holdings():
    is_agg, pids = get_profile_filter()
    conn = get_connection()
    placeholders = ",".join("?" * len(pids))

    if is_agg and len(pids) > 1:
        # Check if Owner import was used — if so, prefer Owner's per-ticker
        # income/dividend data since the Owner spreadsheet is authoritative.
        # For generic-only imports (no Owner), just SUM across sub-profiles.
        _oiu = conn.execute(
            "SELECT value FROM settings WHERE key = 'owner_import_used'"
        ).fetchone()
        use_owner = _oiu and _oiu[0] == "true"

        def _own_or_sum(field):
            """COALESCE from Owner if Owner import exists, else plain SUM."""
            if use_owner:
                return (f"COALESCE((SELECT o.{field} FROM all_account_info o "
                        f"WHERE o.ticker = a.ticker AND o.profile_id = 1), SUM(a.{field}))")
            return f"SUM(a.{field})"

        # Income fields are recalculated by refresh for all profiles, so just SUM.
        # Payout history fields (ytd, total divs, current month) only exist in
        # Owner, so COALESCE from Owner when available.
        ytd = _own_or_sum("ytd_divs")
        tot_div = _own_or_sum("total_divs_received")
        cur_mo = _own_or_sum("current_month_income")

        # Aggregate: combine duplicate tickers across portfolios
        rows = conn.execute(
            f"""SELECT
                   a.ticker,
                   MAX(a.description) as description,
                   MAX(a.classification_type) as classification_type,
                   SUM(a.quantity) as quantity,
                   CASE WHEN SUM(a.quantity) > 0 THEN SUM(a.purchase_value) / SUM(a.quantity) ELSE 0 END as price_paid,
                   MAX(a.current_price) as current_price,
                   SUM(a.purchase_value) as purchase_value,
                   SUM(a.current_value) as current_value,
                   SUM(a.gain_or_loss) as gain_or_loss,
                   CASE WHEN SUM(a.purchase_value) > 0 THEN SUM(a.gain_or_loss) / SUM(a.purchase_value) ELSE 0 END as gain_or_loss_percentage,
                   CASE WHEN SUM(a.purchase_value) > 0 THEN SUM(a.gain_or_loss) / SUM(a.purchase_value) ELSE 0 END as percent_change,
                   MAX(a.div_frequency) as div_frequency,
                   MAX(a.reinvest) as reinvest,
                   MAX(a.ex_div_date) as ex_div_date,
                   MAX(a.div_pay_date) as div_pay_date,
                   CASE WHEN SUM(a.quantity) > 0 THEN SUM(a.dividend_paid) / SUM(a.quantity) ELSE MAX(a.div) END as div,
                   SUM(a.dividend_paid) as dividend_paid,
                   SUM(a.estim_payment_per_year) as estim_payment_per_year,
                   SUM(a.approx_monthly_income) as approx_monthly_income,
                   SUM(a.withdraw_8pct_cost_annually) as withdraw_8pct_cost_annually,
                   SUM(a.withdraw_8pct_per_month) as withdraw_8pct_per_month,
                   SUM(a.cash_not_reinvested) as cash_not_reinvested,
                   SUM(a.total_cash_reinvested) as total_cash_reinvested,
                   CASE WHEN SUM(a.purchase_value) > 0 THEN SUM(a.estim_payment_per_year) / SUM(a.purchase_value) ELSE 0 END as annual_yield_on_cost,
                   CASE WHEN SUM(a.current_value) > 0 THEN SUM(a.estim_payment_per_year) / SUM(a.current_value) ELSE 0 END as current_annual_yield,
                   NULL as percent_of_account,
                   SUM(a.shares_bought_from_dividend) as shares_bought_from_dividend,
                   SUM(a.shares_bought_in_year) as shares_bought_in_year,
                   SUM(a.shares_in_month) as shares_in_month,
                   {ytd} as ytd_divs,
                   {tot_div} as total_divs_received,
                   CASE WHEN SUM(a.purchase_value) > 0 THEN {tot_div} / SUM(a.purchase_value) ELSE 0 END as paid_for_itself,
                   MAX(a.import_date) as import_date,
                   MIN(a.purchase_date) as purchase_date,
                   {cur_mo} as current_month_income,
                   (SELECT c2.name FROM ticker_categories tc2
                    JOIN categories c2 ON tc2.category_id = c2.id
                    WHERE tc2.ticker = a.ticker AND tc2.profile_id = (
                        SELECT a2.profile_id FROM all_account_info a2
                        WHERE a2.ticker = a.ticker AND a2.profile_id IN ({placeholders})
                        ORDER BY a2.quantity DESC LIMIT 1
                    ) LIMIT 1) as category
               FROM all_account_info a
               WHERE a.profile_id IN ({placeholders})
               GROUP BY a.ticker
               ORDER BY a.ticker""",
            pids + pids,
        ).fetchall()
    else:
        pid = pids[0]
        rows = conn.execute(
            """SELECT a.*,
                      (SELECT c.name FROM ticker_categories tc
                       JOIN categories c ON tc.category_id = c.id
                       WHERE tc.ticker = a.ticker AND tc.profile_id = a.profile_id
                       LIMIT 1) AS category
               FROM all_account_info a
               WHERE a.profile_id = ?
               ORDER BY a.ticker""",
            (pid,),
        ).fetchall()

    # Recalculate percent_of_account
    results = rows_to_dicts(rows)
    total_value = sum(r.get("current_value") or 0 for r in results)
    if total_value > 0:
        for r in results:
            r["percent_of_account"] = (r.get("current_value") or 0) / total_value

    # Estimate current_month_income and ytd_divs for every holding
    for r in results:
        r["current_month_income"] = _estimate_current_month_income(r)
        r["ytd_divs"] = _estimate_ytd_income(r)

    conn.close()
    return jsonify(results)


@app.route("/api/holdings", methods=["POST"])
def add_holding():
    """Add a single holding manually."""
    profile_id = get_profile_id()
    data = request.get_json()
    ticker = (data.get("ticker") or "").strip().upper()
    if not ticker:
        return jsonify({"error": "Ticker is required"}), 400

    conn = get_connection()
    # Check for duplicate
    existing = conn.execute(
        "SELECT 1 FROM all_account_info WHERE ticker = ? AND profile_id = ?",
        (ticker, profile_id),
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": f"{ticker} already exists for this profile"}), 409

    cols = ["ticker", "profile_id"]
    vals = [ticker, profile_id]
    allowed_fields = [
        "description", "classification_type", "price_paid", "current_price",
        "quantity", "purchase_value", "current_value", "gain_or_loss",
        "gain_or_loss_percentage", "percent_change", "div_frequency", "reinvest",
        "ex_div_date", "div_pay_date", "div", "dividend_paid", "estim_payment_per_year",
        "approx_monthly_income", "annual_yield_on_cost", "current_annual_yield",
        "purchase_date", "ytd_divs", "total_divs_received", "paid_for_itself",
    ]
    for field in allowed_fields:
        if field in data and data[field] is not None:
            cols.append(field)
            vals.append(data[field])

    placeholders = ", ".join(["?"] * len(cols))
    conn.execute(
        f"INSERT INTO all_account_info ({', '.join(cols)}) VALUES ({placeholders})",
        vals,
    )
    # Handle category assignment
    cat_name = (data.get("category") or "").strip()
    if cat_name:
        cat_row = conn.execute(
            "SELECT id FROM categories WHERE name = ? AND profile_id = ?",
            (cat_name, profile_id),
        ).fetchone()
        if cat_row:
            conn.execute(
                "INSERT OR IGNORE INTO ticker_categories (ticker, category_id, profile_id) VALUES (?, ?, ?)",
                (ticker, cat_row["id"], profile_id),
            )

    conn.commit()

    # Update derived tables
    populate_holdings(profile_id)
    populate_dividends(profile_id)
    conn.close()
    return jsonify({"ticker": ticker, "message": f"{ticker} added"}), 201


@app.route("/api/holdings/<ticker>", methods=["PUT"])
def update_holding(ticker):
    """Update a holding's fields."""
    is_agg, pids = get_profile_filter()
    data = request.get_json()
    ticker = ticker.upper()

    if is_agg:
        profile_id = _resolve_aggregate_profile(ticker, pids)
    else:
        profile_id = pids[0]

    conn = get_connection()
    existing = conn.execute(
        "SELECT 1 FROM all_account_info WHERE ticker = ? AND profile_id = ?",
        (ticker, profile_id),
    ).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": f"{ticker} not found"}), 404

    allowed_fields = [
        "description", "classification_type", "price_paid", "current_price",
        "quantity", "purchase_value", "current_value", "gain_or_loss",
        "gain_or_loss_percentage", "percent_change", "div_frequency", "reinvest",
        "ex_div_date", "div_pay_date", "div", "dividend_paid", "estim_payment_per_year",
        "approx_monthly_income", "annual_yield_on_cost", "current_annual_yield",
        "purchase_date", "ytd_divs", "total_divs_received", "paid_for_itself",
        "cash_not_reinvested", "total_cash_reinvested", "shares_bought_from_dividend",
    ]
    updates = []
    vals = []
    for field in allowed_fields:
        if field in data:
            updates.append(f"{field} = ?")
            vals.append(data[field])

    if not updates:
        conn.close()
        return jsonify({"error": "No fields to update"}), 400

    vals.extend([ticker, profile_id])
    conn.execute(
        f"UPDATE all_account_info SET {', '.join(updates)} WHERE ticker = ? AND profile_id = ?",
        vals,
    )
    # Handle category assignment
    if "category" in data:
        cat_name = (data["category"] or "").strip()
        # Remove existing assignment
        conn.execute(
            "DELETE FROM ticker_categories WHERE ticker = ? AND profile_id = ?",
            (ticker, profile_id),
        )
        if cat_name:
            cat_row = conn.execute(
                "SELECT id FROM categories WHERE name = ? AND profile_id = ?",
                (cat_name, profile_id),
            ).fetchone()
            if cat_row:
                conn.execute(
                    "INSERT INTO ticker_categories (ticker, category_id, profile_id) VALUES (?, ?, ?)",
                    (ticker, cat_row["id"], profile_id),
                )

    conn.commit()

    populate_holdings(profile_id)
    populate_dividends(profile_id)
    conn.close()
    return jsonify({"ticker": ticker, "message": f"{ticker} updated"})


@app.route("/api/holdings/<ticker>", methods=["DELETE"])
def delete_holding(ticker):
    """Delete a holding."""
    is_agg, pids = get_profile_filter()
    if is_agg:
        profile_id = _resolve_aggregate_profile(ticker, pids)
    else:
        profile_id = pids[0]
    ticker = ticker.upper()
    conn = get_connection()
    conn.execute(
        "DELETE FROM all_account_info WHERE ticker = ? AND profile_id = ?",
        (ticker, profile_id),
    )
    conn.execute("DELETE FROM holdings WHERE ticker = ? AND profile_id = ?", (ticker, profile_id))
    conn.execute("DELETE FROM dividends WHERE ticker = ? AND profile_id = ?", (ticker, profile_id))
    conn.commit()
    conn.close()
    return jsonify({"ticker": ticker, "message": f"{ticker} deleted"})


# ── Dividends ──────────────────────────────────────────────────────────────────

@app.route("/api/dividends", methods=["GET"])
def list_dividends():
    is_agg, pids = get_profile_filter()
    conn = get_connection()
    placeholders = ",".join("?" * len(pids))
    rows = conn.execute(
        f"SELECT * FROM dividends WHERE profile_id IN ({placeholders}) ORDER BY ticker", pids
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/dividends/<ticker>", methods=["PUT"])
def update_dividend(ticker):
    data = request.get_json()
    ticker = ticker.upper()
    conn = get_connection()

    allowed = [
        "div_frequency", "reinvest", "ex_div_date", "div_per_share",
        "dividend_paid", "estim_payment_per_year", "approx_monthly_income",
        "annual_yield_on_cost", "current_annual_yield",
        "ytd_divs", "total_divs_received", "paid_for_itself",
    ]
    updates = []
    vals = []
    for field in allowed:
        if field in data:
            updates.append(f"{field} = ?")
            vals.append(data[field])

    if not updates:
        conn.close()
        return jsonify({"error": "No fields to update"}), 400

    is_agg, pids = get_profile_filter()
    if is_agg:
        upd_pid = _resolve_aggregate_profile(ticker, pids)
    else:
        upd_pid = pids[0]
    vals.append(ticker)
    vals.append(upd_pid)
    conn.execute(f"UPDATE dividends SET {', '.join(updates)} WHERE ticker = ? AND profile_id = ?", vals)
    conn.commit()
    conn.close()
    return jsonify({"ticker": ticker, "message": f"{ticker} dividend info updated"})


# ── Income Tracking ────────────────────────────────────────────────────────────

@app.route("/api/income-tracking", methods=["GET"])
def list_income_tracking():
    profile_id = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM income_tracking WHERE profile_id = ? ORDER BY import_date DESC, ticker",
        (profile_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


# ── Payouts ────────────────────────────────────────────────────────────────────

@app.route("/api/payouts/weekly", methods=["GET"])
def list_weekly_payouts():
    profile_id = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM weekly_payouts WHERE profile_id = ? ORDER BY pay_date DESC",
        (profile_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/payouts/monthly", methods=["GET"])
def list_monthly_payouts():
    profile_id = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM monthly_payouts WHERE profile_id = ? ORDER BY year DESC, month DESC",
        (profile_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/payouts/weekly-tickers", methods=["GET"])
def list_weekly_tickers():
    profile_id = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM weekly_payout_tickers WHERE profile_id = ? ORDER BY ticker",
        (profile_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


@app.route("/api/payouts/monthly-tickers", methods=["GET"])
def list_monthly_tickers():
    profile_id = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM monthly_payout_tickers WHERE profile_id = ? ORDER BY ticker, pay_month",
        (profile_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


# ── Template download ──────────────────────────────────────────────────────────

@app.route("/api/template/download", methods=["GET"])
def download_template():
    template_path = os.path.join(os.path.dirname(__file__), '..', 'templates', 'portfolio_upload_template.xlsx')
    if not os.path.exists(template_path):
        from create_template import create_template
        create_template()
    return send_file(
        os.path.abspath(template_path),
        as_attachment=True,
        download_name='portfolio_upload_template.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )


# ── Export Holdings ───────────────────────────────────────────────────────────

# Shared column definitions (matches create_template.py headers exactly)
_EXPORT_COL_MAP = [
    ("Ticker",              "ticker"),
    ("Shares",              "quantity"),
    ("Price Paid",          "price_paid"),
    ("Current Price",       "current_price"),
    ("Description",         "description"),
    ("Type",                "classification_type"),
    ("Date Purchased",      "purchase_date"),
    ("Purchase Value",      "purchase_value"),
    ("Current Value",       "current_value"),
    ("Gain/Loss",           "gain_or_loss"),
    ("Gain/Loss %",         "gain_or_loss_percentage"),
    ("% Change",            "percent_change"),
    ("Div/Share",           "div"),
    ("Frequency",           "div_frequency"),
    ("Ex-Div Date",         "ex_div_date"),
    ("Pay Date",            "div_pay_date"),
    ("DRIP",                "reinvest"),
    ("Div Paid",            "dividend_paid"),
    ("Est. Annual Pmt",     "estim_payment_per_year"),
    ("Monthly Income",      "approx_monthly_income"),
    ("Yield On Cost",       "annual_yield_on_cost"),
    ("Current Yield",       "current_annual_yield"),
    ("% of Account",        "percent_of_account"),
    ("YTD Divs",            "ytd_divs"),
    ("Total Divs Received", "total_divs_received"),
    ("Paid For Itself",     "paid_for_itself"),
    ("Cash Not Reinvest",   "cash_not_reinvested"),
    ("Cash Reinvested",     "total_cash_reinvested"),
    ("Shares from Div",     "shares_bought_from_dividend"),
    ("Shares/Year",         "shares_bought_in_year"),
    ("Shares/Month",        "shares_in_month"),
    ("8% Annual Wdraw",     "withdraw_8pct_cost_annually"),
    ("8% Monthly Wdraw",    "withdraw_8pct_per_month"),
    ("Category",            None),  # joined separately
]


def _export_profile_data(conn, profile_id):
    """Fetch export rows for a single profile. Returns (profile_name, [row_dicts])."""
    headers = [h for h, _ in _EXPORT_COL_MAP]
    sql_cols = [c for _, c in _EXPORT_COL_MAP if c is not None]

    prof = conn.execute("SELECT name FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    profile_name = prof["name"] if prof else f"Portfolio {profile_id}"

    rows = conn.execute(
        f"SELECT {', '.join(sql_cols)} FROM all_account_info WHERE profile_id = ?",
        (profile_id,),
    ).fetchall()

    cat_map = {}
    cat_rows = conn.execute(
        "SELECT tc.ticker, c.name AS category_name "
        "FROM ticker_categories tc JOIN categories c ON c.id = tc.category_id "
        "WHERE tc.profile_id = ?",
        (profile_id,),
    ).fetchall()
    for cr in cat_rows:
        cat_map.setdefault(cr["ticker"], []).append(cr["category_name"])

    out_rows = []
    for row in rows:
        out = {}
        for header, sql_col in _EXPORT_COL_MAP:
            if header == "Category":
                out[header] = ", ".join(cat_map.get(row["ticker"], []))
            else:
                val = row[sql_col]
                out[header] = val if val is not None else ""
        out_rows.append(out)

    return profile_name, out_rows


@app.route("/api/export/holdings", methods=["GET"])
def export_holdings():
    """Export holdings as an Excel file compatible with both Generic and Owner reimport."""
    from io import BytesIO
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    is_agg, profile_ids = get_profile_filter()
    conn = get_connection()
    headers = [h for h, _ in _EXPORT_COL_MAP]

    wb = Workbook()
    wb.remove(wb.active)

    header_font = Font(bold=True, color="FFFFFF", size=11)
    required_fill = PatternFill(start_color="1565C0", end_color="1565C0", fill_type="solid")
    optional_fill = PatternFill(start_color="37474F", end_color="37474F", fill_type="solid")
    thin_border = Border(bottom=Side(style="thin", color="90CAF9"))

    for pid in profile_ids:
        profile_name, rows = _export_profile_data(conn, pid)
        ws = wb.create_sheet(title=profile_name[:31])

        for ci, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=ci, value=header)
            cell.font = header_font
            cell.fill = required_fill if ci <= 2 else optional_fill
            cell.alignment = Alignment(horizontal="center")

        for ri, row in enumerate(rows, 2):
            for ci, header in enumerate(headers, 1):
                cell = ws.cell(row=ri, column=ci, value=row[header])
                cell.border = thin_border

        for i, header in enumerate(headers, 1):
            ws.column_dimensions[get_column_letter(i)].width = max(len(header) + 4, 12)

    conn.close()

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    if len(profile_ids) == 1:
        prof_name = wb.sheetnames[0].replace(" ", "_")
        fname = f"portfolio_export_{prof_name}.xlsx"
    else:
        fname = "portfolio_export_all.xlsx"

    return send_file(buf, as_attachment=True,
                     download_name=fname,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.route("/api/export/holdings/csv", methods=["GET"])
def export_holdings_csv():
    """Export holdings as a CSV file compatible with Generic reimport."""
    import csv
    from io import StringIO, BytesIO

    is_agg, profile_ids = get_profile_filter()
    conn = get_connection()
    headers = [h for h, _ in _EXPORT_COL_MAP]

    profile_name = None
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers)
    writer.writeheader()

    for pid in profile_ids:
        name, rows = _export_profile_data(conn, pid)
        if profile_name is None:
            profile_name = name
        writer.writerows(rows)

    conn.close()

    out = BytesIO(buf.getvalue().encode("utf-8"))

    if len(profile_ids) == 1:
        prof_name = (profile_name or "portfolio").replace(" ", "_")
        fname = f"portfolio_export_{prof_name}.csv"
    else:
        fname = "portfolio_export_all.csv"

    return send_file(out, as_attachment=True,
                     download_name=fname,
                     mimetype="text/csv")


# ── Dividend Comparison (Forward vs TTM) ──────────────────────────────────────

@app.route("/api/dividend-compare/holdings", methods=["GET"])
def dividend_compare_holdings():
    """Return forward and trailing-12-month dividend data for current portfolio holdings."""
    import yfinance as yf
    from datetime import datetime as _dt

    is_agg, pids = get_profile_filter()
    conn = get_connection()
    placeholders = ",".join("?" * len(pids))

    if is_agg and len(pids) > 1:
        rows = conn.execute(
            f"""SELECT ticker, MAX(description) as description, SUM(quantity) as quantity,
                   MAX(div_frequency) as div_frequency, MAX(current_price) as current_price,
                   CASE WHEN SUM(quantity) > 0 THEN SUM(purchase_value) / SUM(quantity) ELSE 0 END as price_paid
               FROM all_account_info
               WHERE profile_id IN ({placeholders}) AND quantity > 0
               GROUP BY ticker""",
            pids,
        ).fetchall()
    else:
        rows = conn.execute(
            f"""SELECT ticker, description, quantity, div_frequency, current_price, price_paid
               FROM all_account_info
               WHERE profile_id IN ({placeholders}) AND quantity > 0""",
            pids,
        ).fetchall()
    conn.close()

    if not rows:
        return jsonify([])

    tickers = [r["ticker"] for r in rows]
    holding_map = {r["ticker"]: dict(r) for r in rows}

    # Batch download dividend history (one yfinance call for TTM)
    ttm_map = {}
    try:
        raw = yf.download(" ".join(tickers), period="1y", progress=False, auto_adjust=False, actions=True)
        if not raw.empty:
            if isinstance(raw.columns, pd.MultiIndex):
                divs = raw["Dividends"] if "Dividends" in raw.columns.get_level_values(0) else None
            else:
                divs = raw[["Dividends"]] if "Dividends" in raw.columns else None

            if divs is not None:
                one_year_ago = pd.Timestamp.now() - pd.Timedelta(days=365)
                if hasattr(divs.index, 'tz') and divs.index.tz is not None:
                    one_year_ago = pd.Timestamp.now(tz=divs.index.tz) - pd.Timedelta(days=365)
                recent = divs[divs.index >= one_year_ago]

                if isinstance(recent, pd.Series):
                    # Single ticker
                    total = float(recent[recent > 0].sum())
                    if total > 0:
                        ttm_map[tickers[0]] = total
                else:
                    for t in tickers:
                        if t in recent.columns:
                            col = recent[t].dropna()
                            total = float(col[col > 0].sum())
                            if total > 0:
                                ttm_map[t] = total
    except Exception:
        pass

    # Fetch forward dividend rate via info (use threads for speed)
    from concurrent.futures import ThreadPoolExecutor, as_completed
    fwd_map = {}

    def _get_fwd(sym):
        try:
            info = yf.Ticker(sym).info or {}
            rate = info.get("dividendRate")
            return sym, rate if rate and rate > 0 else None
        except Exception:
            return sym, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_get_fwd, t): t for t in tickers}
        for fut in as_completed(futures):
            sym, rate = fut.result()
            if rate:
                fwd_map[sym] = rate

    # Build results
    results = []
    for tk_sym in tickers:
        h = holding_map[tk_sym]
        price = h["current_price"] or 0
        qty = h["quantity"] or 0
        fwd = fwd_map.get(tk_sym)
        ttm = ttm_map.get(tk_sym)

        entry = {
            "ticker": tk_sym,
            "description": h["description"] or tk_sym,
            "quantity": qty,
            "current_price": price,
            "price_paid": h["price_paid"] or 0,
            "div_frequency": h["div_frequency"] or "Q",
            "forward_annual_dividend": round(fwd, 4) if fwd else None,
            "forward_dividend_yield": round(fwd / price, 6) if fwd and price else None,
            "forward_income": round(fwd * qty, 2) if fwd else None,
            "ttm_dividend": round(ttm, 4) if ttm else None,
            "ttm_dividend_yield": round(ttm / price, 6) if ttm and price else None,
            "ttm_income": round(ttm * qty, 2) if ttm else None,
            "error": None if (fwd or ttm) else "Not enough information to compute",
        }
        results.append(entry)

    results.sort(key=lambda r: r["ticker"])
    return jsonify(results)


@app.route("/api/dividend-compare/lookup", methods=["POST"])
def dividend_compare_lookup():
    """Fetch forward and TTM dividend data for user-supplied tickers."""
    import yfinance as yf

    data = request.get_json()
    tickers = data.get("tickers", [])
    if not tickers:
        return jsonify([])

    results = []
    for tk_sym in tickers:
        tk_sym = tk_sym.strip().upper()
        if not tk_sym:
            continue
        entry = {
            "ticker": tk_sym,
            "description": tk_sym,
            "quantity": None,
            "current_price": 0,
            "price_paid": None,
            "div_frequency": None,
            "forward_annual_dividend": None,
            "forward_dividend_yield": None,
            "ttm_dividend": None,
            "ttm_dividend_yield": None,
            "ttm_income": None,
            "forward_income": None,
            "error": None,
        }
        try:
            tk = yf.Ticker(tk_sym)
            info = tk.info or {}
            price = info.get("regularMarketPrice") or info.get("currentPrice") or 0
            entry["current_price"] = price
            entry["description"] = (info.get("longName") or info.get("shortName") or tk_sym)[:200]

            # Infer frequency from history
            try:
                hist = tk.dividends
                if hist is not None and len(hist) > 0:
                    if hist.index.tz is not None:
                        one_year_ago = pd.Timestamp.now(tz=hist.index.tz) - pd.Timedelta(days=365)
                    else:
                        one_year_ago = pd.Timestamp.now() - pd.Timedelta(days=365)
                    recent = hist[hist.index >= one_year_ago]
                    n = len(recent[recent > 0])
                    entry["div_frequency"] = "W" if n >= 45 else "M" if n >= 10 else "Q" if n >= 3 else "SA" if n >= 2 else "A" if n >= 1 else None

                    ttm_total = float(recent[recent > 0].sum()) if n > 0 else 0
                    if ttm_total > 0:
                        entry["ttm_dividend"] = round(ttm_total, 4)
                        entry["ttm_dividend_yield"] = round(ttm_total / price, 6) if price else None
            except Exception:
                pass

            # Forward
            fwd = info.get("dividendRate")
            if fwd and fwd > 0:
                entry["forward_annual_dividend"] = round(fwd, 4)
                entry["forward_dividend_yield"] = round(fwd / price, 6) if price else None

            if entry["forward_annual_dividend"] is None and entry["ttm_dividend"] is None:
                entry["error"] = "Not enough information to compute"

        except Exception as e:
            entry["error"] = f"Lookup failed: {str(e)}"

        results.append(entry)

    return jsonify(results)


# ── Upcoming Dividends ─────────────────────────────────────────────────────────

@app.route("/api/upcoming-dividends", methods=["GET"])
def upcoming_dividends():
    """Return holdings with ex-div dates projected into the upcoming week."""
    from datetime import datetime, timedelta

    is_agg, pids = get_profile_filter()
    conn = get_connection()
    placeholders = ",".join("?" * len(pids))
    if is_agg and len(pids) > 1:
        rows = conn.execute(
            f"""SELECT ticker, MAX(description) as description, MAX(ex_div_date) as ex_div_date,
                   MAX(div) as div, MAX(div_frequency) as div_frequency,
                   SUM(quantity) as quantity, SUM(approx_monthly_income) as approx_monthly_income
               FROM all_account_info
               WHERE profile_id IN ({placeholders}) AND ex_div_date IS NOT NULL AND ex_div_date != ''
                 AND ex_div_date != '--' AND quantity > 0
               GROUP BY ticker""",
            pids,
        ).fetchall()
    else:
        rows = conn.execute(
            f"""SELECT ticker, description, ex_div_date, div, div_frequency, quantity, approx_monthly_income
               FROM all_account_info
               WHERE profile_id IN ({placeholders}) AND ex_div_date IS NOT NULL AND ex_div_date != ''
                 AND ex_div_date != '--' AND quantity > 0""",
            pids,
        ).fetchall()
    conn.close()

    if not rows:
        return jsonify([])

    today = datetime.today().date()
    week_end = today + timedelta(days=7)

    freq_days = {"W": 7, "52": 7, "M": 30, "Q": 91, "SA": 182, "A": 365}
    freq_labels = {"W": "Weekly", "52": "Weekly", "M": "Monthly", "Q": "Quarterly", "SA": "Semi-Annual", "A": "Annual"}
    freq_colors = {"M": "#00c9a7", "52": "#FFD700", "W": "#FFD700", "Q": "#7ecfff", "SA": "#f0a0ff", "A": "#f0a0ff"}

    def next_biz(d):
        if d.weekday() == 5:
            d += timedelta(days=2)
        elif d.weekday() == 6:
            d += timedelta(days=1)
        return d

    events = []
    for r in rows:
        try:
            ex = datetime.strptime(r["ex_div_date"], "%m/%d/%y").date()
        except (ValueError, TypeError):
            try:
                ex = datetime.strptime(r["ex_div_date"], "%Y-%m-%d").date()
            except (ValueError, TypeError):
                continue

        freq = (r["div_frequency"] or "Q").upper()
        step = freq_days.get(freq, 91)

        # Project forward — keep advancing until the estimated pay date >= today
        nxt = ex
        while True:
            if freq in ("W", "52"):
                pay = next_biz(nxt + timedelta(days=1))
            elif freq == "M":
                pay = next_biz(nxt + timedelta(days=2))
            else:
                pay = next_biz(nxt + timedelta(days=14))
            # Show if pay date is today or later
            if pay >= today:
                break
            nxt += timedelta(days=step)

        if nxt <= week_end:
            events.append({
                "ticker": r["ticker"],
                "description": r["description"] or r["ticker"],
                "ex_date": nxt.strftime("%Y-%m-%d"),
                "ex_weekday": nxt.strftime("%a"),
                "pay_date": pay.strftime("%Y-%m-%d"),
                "pay_weekday": pay.strftime("%a"),
                "amount": r["div"] or 0,
                "est_payment": round((r["div"] or 0) * (r["quantity"] or 0), 2),
                "frequency": freq,
                "freq_label": freq_labels.get(freq, "Quarterly"),
                "color": freq_colors.get(freq, "#7ecfff"),
            })

    events.sort(key=lambda e: e["ex_date"])
    return jsonify(events)


# ── Portfolio Summary Data (grades) ────────────────────────────────────────────

@app.route("/api/portfolio-coverage", methods=["GET"])
def portfolio_coverage():
    """Compute TTM yield-based coverage for each ticker and aggregate.

    Coverage ≈ (TTM price return % + TTM distribution yield %) / TTM distribution yield %
    This approximates  (SEC Yield + Option Yield) / 12-mo Distribution Yield.

    Interpretation:
      > 1.0  → sustainable
      0.8–1.0 → borderline
      < 0.8  → likely NAV decay
    """
    import warnings
    warnings.filterwarnings("ignore")

    pid = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        "SELECT ticker, current_price, quantity "
        "FROM all_account_info "
        "WHERE profile_id = ? AND quantity > 0",
        (pid,),
    ).fetchall()
    conn.close()

    import yfinance as yf
    from datetime import datetime as _dt, timedelta as _td

    # Deduplicate tickers, aggregate quantities and dollar values
    ticker_info = {}
    for r in rows:
        tk = r[0]
        cur_price = float(r[1] or 0)
        qty = float(r[2] or 0)
        if tk not in ticker_info:
            ticker_info[tk] = {"current_price": cur_price, "quantity": qty}
        else:
            ticker_info[tk]["quantity"] += qty
            if cur_price > 0:
                ticker_info[tk]["current_price"] = cur_price

    tickers = list(ticker_info.keys())
    one_year_ago = (_dt.now() - _td(days=365)).strftime("%Y-%m-%d")

    results = []
    total_price_return_dollars = 0.0
    total_dist_dollars = 0.0

    for tk in tickers:
        info = ticker_info[tk]
        cur_price = info["current_price"]
        qty = info["quantity"]

        if cur_price <= 0:
            results.append({"ticker": tk, "coverage_ratio": None})
            continue

        try:
            yf_tk = yf.Ticker(tk)
            hist = yf_tk.history(start=one_year_ago, interval="1d", auto_adjust=True)
            if hist.empty or len(hist) < 2:
                results.append({"ticker": tk, "coverage_ratio": None})
                continue

            price_1yr_ago = float(hist["Close"].iloc[0])
            if price_1yr_ago <= 0:
                results.append({"ticker": tk, "coverage_ratio": None})
                continue

            # TTM price return as a percentage of starting price
            ttm_price_return_pct = (cur_price - price_1yr_ago) / price_1yr_ago

            # TTM distributions per share
            divs = yf_tk.dividends
            if divs is not None and not divs.empty:
                cutoff = _dt.now() - _td(days=365)
                if divs.index.tz is not None:
                    cutoff = cutoff.astimezone(divs.index.tz)
                ttm_divs = divs[divs.index >= cutoff]
                ttm_dist_per_share = float(ttm_divs.sum())
            else:
                ttm_dist_per_share = 0.0

            # TTM distribution yield
            ttm_dist_yield = ttm_dist_per_share / cur_price if cur_price > 0 else 0.0

            if ttm_dist_yield > 0:
                coverage = round((ttm_price_return_pct + ttm_dist_yield) / ttm_dist_yield, 4)
            else:
                coverage = None

            results.append({"ticker": tk, "coverage_ratio": coverage})

            if coverage is not None:
                # Dollar-weight for aggregate
                dist_dollars = ttm_dist_per_share * qty
                price_return_dollars = (cur_price - price_1yr_ago) * qty
                total_dist_dollars += dist_dollars
                total_price_return_dollars += price_return_dollars

        except Exception:
            results.append({"ticker": tk, "coverage_ratio": None})

    if total_dist_dollars > 0:
        agg_coverage = round((total_price_return_dollars + total_dist_dollars) / total_dist_dollars, 4)
    else:
        agg_coverage = None

    return jsonify(results=results, aggregate_coverage=agg_coverage)


@app.route("/api/portfolio-summary/data", methods=["GET"])
def portfolio_summary_data():
    """Compute per-ticker grades and portfolio-level grade via yfinance."""
    import warnings
    import numpy as np
    import yfinance as yf
    from grading import ticker_score, grade_portfolio, letter_grade
    warnings.filterwarnings("ignore")

    is_agg, pids = get_profile_filter()
    conn = get_connection()
    placeholders = ",".join("?" * len(pids))
    rows = conn.execute(
        f"SELECT ticker, SUM(current_value) as current_value FROM all_account_info WHERE profile_id IN ({placeholders}) AND purchase_value > 0 AND quantity > 0 GROUP BY ticker",
        pids,
    ).fetchall()
    conn.close()

    if not rows:
        return jsonify({"error": "No data"}), 400

    tickers = [r["ticker"] for r in rows]
    all_dl = list(set(tickers + ["SPY"]))

    # Detect renamed tickers and include both old and new in download
    rename_map = {}
    for t in tickers:
        try:
            _info = yf.Ticker(t).info or {}
            _new = (_info.get("symbol") or "").upper()
            if _new and _new != t:
                rename_map[t] = _new
                if _new not in all_dl:
                    all_dl.append(_new)
        except Exception:
            pass

    try:
        raw = yf.download(" ".join(all_dl), period="1y", auto_adjust=True, progress=False)
        if raw.empty:
            return jsonify({"error": "No price data from yfinance"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"].dropna(how="all")
    else:
        close = raw[["Close"]].dropna(how="all")
        close.columns = [all_dl[0]]

    # Map renamed ticker columns back to original names
    for old_t, new_t in rename_map.items():
        if old_t not in close.columns and new_t in close.columns:
            close[old_t] = close[new_t]

    bench_close = close["SPY"] if "SPY" in close.columns else None
    bench_ret = bench_close.pct_change().dropna() if bench_close is not None else None

    ticker_grades = {}
    available = []
    for t in tickers:
        if t not in close.columns:
            ticker_grades[t] = {"grade": "N/A", "score": None}
            continue
        tc = close[t].dropna()
        if len(tc) < 30:
            ticker_grades[t] = {"grade": "N/A", "score": None}
            continue
        tr = tc.pct_change().dropna()
        score, *_ = ticker_score(tc, tr, bench_ret)
        ticker_grades[t] = {"grade": letter_grade(score), "score": score}
        available.append(t)

    import numpy as np
    portfolio_grade_info = {}
    if len(available) >= 2:
        returns_df = close[available].pct_change().fillna(0)
        val_map = {r["ticker"]: float(r["current_value"] or 0) for r in rows}
        weights_arr = np.array([val_map.get(t, 0.0) for t in available])
        pm = grade_portfolio(returns_df, weights_arr, bench_ret)
        portfolio_grade_info = pm.get("grade", {})
        portfolio_grade_info["sharpe"] = pm.get("sharpe")
        portfolio_grade_info["sortino"] = pm.get("sortino")
        portfolio_grade_info["calmar"] = pm.get("calmar")
        portfolio_grade_info["omega"] = pm.get("omega")
        portfolio_grade_info["max_drawdown"] = pm.get("max_drawdown")
        portfolio_grade_info["ulcer_index"] = pm.get("ulcer_index")

    return jsonify(ticker_grades=ticker_grades, portfolio_grade=portfolio_grade_info)


# ── Ticker Return Chart ───────────────────────────────────────────────────────

@app.route("/api/ticker-return/<ticker>", methods=["GET"])
def ticker_return_chart(ticker):
    """Return price return % and total return % data since purchase date."""
    import warnings
    import yfinance as yf
    warnings.filterwarnings("ignore")

    profile_id = get_profile_id()
    ticker = ticker.strip().upper()
    conn = get_connection()
    row = conn.execute(
        "SELECT purchase_date, price_paid, description FROM all_account_info WHERE ticker = ? AND profile_id = ? AND purchase_value > 0",
        (ticker, profile_id),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({"error": f"No data found for {ticker}"}), 404

    purchase_date = pd.to_datetime(row["purchase_date"])
    price_paid = float(row["price_paid"] or 0)
    description = row["description"] or ticker

    if pd.isna(purchase_date) or price_paid <= 0:
        return jsonify({"error": f"Missing purchase date or price for {ticker}"}), 404

    start_str = purchase_date.strftime("%Y-%m-%d")

    # Detect ticker rename (e.g. TOPW → WPAY)
    dl_ticker = ticker
    try:
        _info = yf.Ticker(ticker).info or {}
        _new_sym = (_info.get("symbol") or "").upper()
        if _new_sym and _new_sym != ticker:
            dl_ticker = _new_sym
    except Exception:
        pass

    try:
        raw = yf.download(dl_ticker, start=start_str, progress=False, auto_adjust=False, actions=True)
    except Exception as e:
        return jsonify({"error": f"Yahoo Finance error for {ticker}: {str(e)}"}), 404

    if raw.empty:
        return jsonify({"error": f"No Yahoo Finance data for {ticker}"}), 404

    try:
        if isinstance(raw.columns, pd.MultiIndex):
            close_col = raw["Close"][dl_ticker] if dl_ticker in raw["Close"].columns else raw["Close"].iloc[:, 0]
            divs_col = raw["Dividends"][dl_ticker] if dl_ticker in raw["Dividends"].columns else raw["Dividends"].iloc[:, 0]
        else:
            close_col = raw["Close"]
            divs_col = raw["Dividends"]

        # Ensure we have Series (not scalar from squeeze on single-row data)
        if not isinstance(close_col, pd.Series):
            close_col = pd.Series(close_col) if hasattr(close_col, '__iter__') else pd.Series()
        else:
            close_col = close_col.squeeze()
            if not isinstance(close_col, pd.Series):
                return jsonify({"error": f"Not enough price history for {ticker}"}), 404
        if not isinstance(divs_col, pd.Series):
            divs_col = pd.Series(0, index=close_col.index)
        else:
            divs_col = divs_col.squeeze()
            if not isinstance(divs_col, pd.Series):
                divs_col = pd.Series(0, index=close_col.index)

        if len(close_col) < 2:
            return jsonify({"error": f"Not enough price history for {ticker}"}), 404

        cum_divs = divs_col.reindex(close_col.index, fill_value=0).cumsum()

        price_return = ((close_col - price_paid) / price_paid * 100).round(2)
        total_return = ((close_col - price_paid + cum_divs) / price_paid * 100).round(2)

        return jsonify({
            "ticker": ticker,
            "description": description,
            "purchase_date": start_str,
            "price_paid": price_paid,
            "dates": close_col.index.strftime("%Y-%m-%d").tolist(),
            "price_return": price_return.tolist(),
            "total_return": total_return.tolist(),
        })
    except Exception as e:
        return jsonify({"error": f"Could not compute return data for {ticker}: {str(e)}"}), 500


# ── Data Management ───────────────────────────────────────────────────────────

@app.route("/api/data/clear-all", methods=["POST"])
def clear_all_data():
    """Delete all holdings, dividends, and related data for the current profile."""
    profile_id = get_profile_id()
    conn = get_connection()
    tables = [
        "all_account_info", "holdings", "dividends", "income_tracking",
        "weekly_payouts", "monthly_payouts", "weekly_payout_tickers", "monthly_payout_tickers",
    ]
    counts = {}
    for t in tables:
        if t == "all_account_info":
            r = conn.execute(f"DELETE FROM {t} WHERE profile_id = ?", (profile_id,))
        else:
            r = conn.execute(f"DELETE FROM {t}")
        counts[t] = r.rowcount
    conn.commit()
    conn.close()
    return jsonify({"message": "All data cleared", "deleted": counts})


@app.route("/api/data/stats", methods=["GET"])
def data_stats():
    """Return row counts for key tables."""
    is_agg, pids = get_profile_filter()
    conn = get_connection()
    placeholders = ",".join("?" * len(pids))
    holdings = conn.execute(
        f"SELECT COUNT(DISTINCT ticker) as c FROM all_account_info WHERE profile_id IN ({placeholders})", pids
    ).fetchone()["c"]
    dividends = conn.execute(
        f"SELECT COUNT(*) as c FROM dividends WHERE profile_id IN ({placeholders})", pids
    ).fetchone()["c"]
    income = conn.execute(
        f"SELECT COUNT(*) as c FROM income_tracking WHERE profile_id IN ({placeholders})", pids
    ).fetchone()["c"]
    conn.close()
    return jsonify({"holdings": holdings, "dividends": dividends, "income_tracking": income})


# ── Income Summary ────────────────────────────────────────────────────────────

@app.route("/api/income-summary", methods=["GET"])
def income_summary():
    """Compute current month and YTD income from payout tables + estimates."""
    import datetime
    is_agg, pids = get_profile_filter()
    conn = get_connection()
    today = datetime.date.today()
    year = today.year
    month = today.month
    placeholders = ",".join("?" * len(pids))

    month_start = f"{year}-{month:02d}-01"
    if month == 12:
        month_end = f"{year + 1}-01-01"
    else:
        month_end = f"{year}-{month + 1:02d}-01"

    # If Owner import was used AND we're viewing Owner (profile 1) or an
    # aggregated view that includes Owner, use actual payout tables.
    # Otherwise estimate from holdings data.
    _oiu = conn.execute(
        "SELECT value FROM settings WHERE key = 'owner_import_used'"
    ).fetchone()
    use_owner_payouts = (_oiu and _oiu[0] == "true") and (1 in pids)

    if use_owner_payouts:
        payout_pids = [1]
    else:
        payout_pids = pids
    pp_ph = ",".join("?" * len(payout_pids))

    # YTD from payout tables (only meaningful for Owner profile)
    weekly_ytd = conn.execute(
        f"SELECT COALESCE(SUM(amount), 0) as total FROM weekly_payouts WHERE profile_id IN ({pp_ph}) AND pay_date >= ? AND pay_date < ?",
        payout_pids + [f"{year}-01-01", f"{year + 1}-01-01"],
    ).fetchone()["total"]

    monthly_ytd = conn.execute(
        f"SELECT COALESCE(SUM(amount), 0) as total FROM monthly_payouts WHERE profile_id IN ({pp_ph}) AND year = ?",
        payout_pids + [year],
    ).fetchone()["total"]

    payout_ytd = weekly_ytd + monthly_ytd

    # Estimate from holdings using div_frequency logic
    holdings = conn.execute(
        f"""SELECT quantity, div, ex_div_date, div_frequency
            FROM all_account_info
            WHERE profile_id IN ({placeholders})
              AND div IS NOT NULL AND div > 0
              AND quantity IS NOT NULL AND quantity > 0""",
        pids,
    ).fetchall()

    estimated_month = 0.0
    estimated_ytd = 0.0
    for row in holdings:
        h = dict(row)
        estimated_month += _estimate_current_month_income(h)
        estimated_ytd += _estimate_ytd_income(h)

    # Use payout-table YTD if available (Owner), otherwise use estimate
    ytd_income = payout_ytd if payout_ytd > 0 else estimated_ytd

    conn.close()
    return jsonify({
        "ytd_income": ytd_income,
        "current_month_income": estimated_month,
        "month_label": today.strftime("%B"),
    })


# ── Categories ────────────────────────────────────────────────────────────────

_CLASSIFICATION_NAMES = {
    "A": "Anchors", "B": "Boosters", "G": "Growth", "J": "Juicers",
    "BDC": "BDC", "HA": "Hedged Anchor", "GS": "Gold Silver",
    "ETF": "ETF", "EQUITY": "Equity", "CEF": "CEF", "REIT": "REIT",
}


@app.route("/api/categories/data", methods=["GET"])
def categories_data():
    """Return categories with assigned tickers, unallocated tickers, and total value."""
    profile_id = get_profile_id()
    conn = get_connection()

    # Auto-seed categories from classification_type if none exist
    cat_count = conn.execute(
        "SELECT COUNT(*) as c FROM categories WHERE profile_id = ?", (profile_id,)
    ).fetchone()["c"]

    if cat_count == 0:
        types = conn.execute(
            "SELECT DISTINCT classification_type FROM all_account_info WHERE profile_id = ? AND classification_type IS NOT NULL",
            (profile_id,),
        ).fetchall()
        for i, row in enumerate(types):
            ct = row["classification_type"]
            name = _CLASSIFICATION_NAMES.get(ct, ct)
            conn.execute(
                "INSERT OR IGNORE INTO categories (name, profile_id, sort_order) VALUES (?, ?, ?)",
                (name, profile_id, i),
            )
        conn.commit()
        # Auto-assign tickers to their seeded categories
        cats = conn.execute(
            "SELECT id, name FROM categories WHERE profile_id = ?", (profile_id,)
        ).fetchall()
        name_to_id = {r["name"]: r["id"] for r in cats}
        holdings = conn.execute(
            "SELECT ticker, classification_type FROM all_account_info WHERE profile_id = ?",
            (profile_id,),
        ).fetchall()
        for h in holdings:
            ct = h["classification_type"]
            cat_name = _CLASSIFICATION_NAMES.get(ct, ct)
            cat_id = name_to_id.get(cat_name)
            if cat_id:
                conn.execute(
                    "INSERT OR IGNORE INTO ticker_categories (ticker, category_id, profile_id) VALUES (?, ?, ?)",
                    (h["ticker"], cat_id, profile_id),
                )
        conn.commit()

    # Fetch categories
    cats = conn.execute(
        "SELECT id, name, target_pct, sort_order FROM categories WHERE profile_id = ? ORDER BY sort_order, name",
        (profile_id,),
    ).fetchall()

    # Fetch all holdings
    all_holdings = conn.execute(
        "SELECT ticker, description, current_value FROM all_account_info WHERE profile_id = ?",
        (profile_id,),
    ).fetchall()
    total_value = sum(float(h["current_value"] or 0) for h in all_holdings)

    # Fetch ticker-category assignments
    assignments = conn.execute(
        "SELECT ticker, category_id FROM ticker_categories WHERE profile_id = ?",
        (profile_id,),
    ).fetchall()
    # Build response
    holding_map = {h["ticker"]: h for h in all_holdings}
    categories = []
    assigned_tickers = set()
    for cat in cats:
        cat_tickers = []
        for a in assignments:
            if a["category_id"] == cat["id"]:
                t = a["ticker"]
                h = holding_map.get(t)
                if h:
                    cat_tickers.append({
                        "ticker": t,
                        "description": h["description"],
                        "current_value": float(h["current_value"] or 0),
                    })
                    assigned_tickers.add(t)
        cat_value = sum(t["current_value"] for t in cat_tickers)
        categories.append({
            "id": cat["id"],
            "name": cat["name"],
            "target_pct": cat["target_pct"],
            "sort_order": cat["sort_order"],
            "tickers": sorted(cat_tickers, key=lambda x: x["ticker"]),
            "actual_value": cat_value,
            "actual_pct": (cat_value / total_value * 100) if total_value else 0,
        })

    unallocated = []
    for h in all_holdings:
        if h["ticker"] not in assigned_tickers:
            unallocated.append({
                "ticker": h["ticker"],
                "description": h["description"],
                "current_value": float(h["current_value"] or 0),
            })
    unallocated.sort(key=lambda x: x["ticker"])

    conn.close()
    return jsonify({
        "categories": categories,
        "unallocated": unallocated,
        "total_value": total_value,
    })


@app.route("/api/categories", methods=["POST"])
def create_category():
    profile_id = get_profile_id()
    data = request.get_json()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    target_pct = data.get("target_pct")
    conn = get_connection()
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 as n FROM categories WHERE profile_id = ?",
        (profile_id,),
    ).fetchone()["n"]
    try:
        conn.execute(
            "INSERT INTO categories (name, target_pct, profile_id, sort_order) VALUES (?, ?, ?, ?)",
            (name, target_pct, profile_id, max_order),
        )
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": f"Category '{name}' already exists"}), 409
    conn.close()
    return jsonify({"message": f"Category '{name}' created"})


@app.route("/api/categories/<int:cat_id>", methods=["PUT"])
def update_category(cat_id):
    profile_id = get_profile_id()
    data = request.get_json()
    conn = get_connection()
    sets, vals = [], []
    if "name" in data:
        sets.append("name = ?")
        vals.append(data["name"].strip())
    if "target_pct" in data:
        sets.append("target_pct = ?")
        vals.append(data["target_pct"])
    if not sets:
        conn.close()
        return jsonify({"error": "Nothing to update"}), 400
    vals.extend([cat_id, profile_id])
    conn.execute(
        f"UPDATE categories SET {', '.join(sets)} WHERE id = ? AND profile_id = ?", vals
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "Category updated"})


@app.route("/api/categories/<int:cat_id>", methods=["DELETE"])
def delete_category(cat_id):
    profile_id = get_profile_id()
    conn = get_connection()
    conn.execute(
        "DELETE FROM ticker_categories WHERE category_id = ? AND profile_id = ?",
        (cat_id, profile_id),
    )
    conn.execute(
        "DELETE FROM categories WHERE id = ? AND profile_id = ?",
        (cat_id, profile_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "Category deleted"})


@app.route("/api/categories/assign", methods=["POST"])
def assign_tickers():
    profile_id = get_profile_id()
    data = request.get_json()
    category_id = data.get("category_id")
    tickers = data.get("tickers", [])
    if not category_id or not tickers:
        return jsonify({"error": "category_id and tickers required"}), 400
    conn = get_connection()
    for t in tickers:
        conn.execute(
            "DELETE FROM ticker_categories WHERE ticker = ? AND profile_id = ?",
            (t, profile_id),
        )
        conn.execute(
            "INSERT INTO ticker_categories (ticker, category_id, profile_id) VALUES (?, ?, ?)",
            (t, category_id, profile_id),
        )
    conn.commit()
    conn.close()
    return jsonify({"message": f"Assigned {len(tickers)} ticker(s)"})


@app.route("/api/categories/unassign", methods=["POST"])
def unassign_tickers():
    profile_id = get_profile_id()
    data = request.get_json()
    tickers = data.get("tickers", [])
    if not tickers:
        return jsonify({"error": "tickers required"}), 400
    conn = get_connection()
    for t in tickers:
        conn.execute(
            "DELETE FROM ticker_categories WHERE ticker = ? AND profile_id = ?",
            (t, profile_id),
        )
    conn.commit()
    conn.close()
    return jsonify({"message": f"Unassigned {len(tickers)} ticker(s)"})


@app.route("/api/categories/reorder", methods=["POST"])
def reorder_categories():
    profile_id = get_profile_id()
    data = request.get_json()
    order = data.get("order", [])  # list of category IDs in desired order
    conn = get_connection()
    for i, cat_id in enumerate(order):
        conn.execute(
            "UPDATE categories SET sort_order = ? WHERE id = ? AND profile_id = ?",
            (i, cat_id, profile_id),
        )
    conn.commit()
    conn.close()
    return jsonify({"message": "Reordered"})


# ── Dividend Analysis ──────────────────────────────────────────────────────────

@app.route("/api/dividend-analysis/data", methods=["GET"])
def dividend_analysis_data():
    """Per-ticker dividend summary with charts, totals, grade, and category filter."""
    import math
    import json
    import datetime
    import warnings
    import numpy as np
    import yfinance as yf
    import plotly.graph_objects as go
    import plotly.utils
    from grading import grade_portfolio, letter_grade, _sharpe, _sortino
    warnings.filterwarnings("ignore")

    def _clean(v):
        if v is None:
            return None
        try:
            if math.isnan(v) or math.isinf(v):
                return None
        except (TypeError, ValueError):
            pass
        return v

    profile_id = get_profile_id()
    conn = get_connection()

    # Categories for filter dropdown
    cats = conn.execute(
        "SELECT id, name FROM categories WHERE profile_id = ? ORDER BY sort_order, name",
        (profile_id,),
    ).fetchall()
    categories = [{"id": c["id"], "name": c["name"]} for c in cats]

    # Category filter
    cat_param = request.args.get("category", "").strip()
    cat_ids = [c.strip() for c in cat_param.split(",") if c.strip()] if cat_param else []

    # Load holdings
    rows = conn.execute(
        """SELECT ticker, description, classification_type,
                  ytd_divs, total_divs_received, paid_for_itself,
                  dividend_paid, estim_payment_per_year, approx_monthly_income,
                  annual_yield_on_cost, current_annual_yield,
                  purchase_value, current_value, gain_or_loss,
                  div_frequency, ex_div_date, reinvest, div, current_price,
                  quantity
           FROM all_account_info
           WHERE purchase_value IS NOT NULL AND purchase_value > 0
             AND IFNULL(quantity, 0) > 0
             AND profile_id = ?
           ORDER BY IFNULL(total_divs_received, 0) DESC, ticker""",
        (profile_id,),
    ).fetchall()
    df = pd.DataFrame([dict(r) for r in rows])

    if df.empty:
        conn.close()
        return jsonify({"rows": [], "totals": {}, "charts": {}, "grade": {}, "categories": categories})

    # Enrich with category names
    try:
        cat_map_rows = conn.execute(
            "SELECT tc.ticker, c.name AS category_name "
            "FROM ticker_categories tc "
            "JOIN categories c ON c.id = tc.category_id "
            "WHERE tc.profile_id = ?", (profile_id,)
        ).fetchall()
        cat_map = pd.DataFrame([dict(r) for r in cat_map_rows])
        if not cat_map.empty:
            df = df.merge(cat_map, on="ticker", how="left")
        else:
            df["category_name"] = None
    except Exception:
        df["category_name"] = None

    if "classification_type" in df.columns:
        mask = df["category_name"].isna() | (df["category_name"] == "")
        df.loc[mask, "category_name"] = df.loc[mask, "classification_type"].map(
            lambda c: _CLASSIFICATION_NAMES.get(str(c).strip(), str(c).strip()) if pd.notna(c) else "Other"
        )
    df["category_name"] = df["category_name"].fillna("Other")

    # Apply category filter
    if cat_ids:
        cat_names = [c["name"] for c in categories if str(c["id"]) in cat_ids]
        if cat_names:
            df = df[df["category_name"].isin(cat_names)]

    if df.empty:
        conn.close()
        return jsonify({"rows": [], "totals": {}, "charts": {}, "grade": {}, "categories": categories})

    # Coerce numerics
    num_cols = ["ytd_divs", "total_divs_received", "estim_payment_per_year",
                "approx_monthly_income", "purchase_value", "dividend_paid",
                "current_value", "gain_or_loss", "annual_yield_on_cost",
                "current_annual_yield", "paid_for_itself", "div", "current_price", "quantity"]
    for col in num_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["description"] = df["description"].fillna("").astype(str)
    df["div_frequency"] = df["div_frequency"].fillna("").astype(str).str.strip()

    # ── Totals ──
    totals = {
        "ytd_divs": _clean(float(df["ytd_divs"].fillna(0).sum())),
        "total_divs_received": _clean(float(df["total_divs_received"].fillna(0).sum())),
        "dividend_paid": _clean(float(df["dividend_paid"].fillna(0).sum())),
        "estim_payment_per_year": _clean(float(df["estim_payment_per_year"].fillna(0).sum())),
        "approx_monthly_income": _clean(float(df["approx_monthly_income"].fillna(0).sum())),
    }

    # Actual monthly income from monthly_payouts
    today_d = datetime.date.today()
    month_label = today_d.strftime("%b %Y")
    totals["current_month_label"] = month_label
    try:
        actual_row = conn.execute(
            "SELECT amount FROM monthly_payouts WHERE year = ? AND month = ? AND profile_id = ?",
            (today_d.year, today_d.month, profile_id),
        ).fetchone()
        totals["actual_monthly_income"] = _clean(float(actual_row["amount"])) if actual_row else 0
    except Exception:
        totals["actual_monthly_income"] = 0

    # ── Build table rows ──
    table_rows = []
    for _, row in df.iterrows():
        table_rows.append({
            "ticker": row["ticker"],
            "description": row["description"],
            "category_name": row["category_name"],
            "ytd_divs": _clean(row.get("ytd_divs")),
            "total_divs_received": _clean(row.get("total_divs_received")),
            "paid_for_itself": _clean(row.get("paid_for_itself")),
            "dividend_paid": _clean(row.get("dividend_paid")),
            "estim_payment_per_year": _clean(row.get("estim_payment_per_year")),
            "approx_monthly_income": _clean(row.get("approx_monthly_income")),
            "annual_yield_on_cost": _clean(row.get("annual_yield_on_cost")),
            "current_annual_yield": _clean(row.get("current_annual_yield")),
            "gain_or_loss": _clean(row.get("gain_or_loss")),
        })

    # ── Charts ──
    charts = {}
    dark_layout = dict(template="plotly_dark", paper_bgcolor="#1a1f2e", plot_bgcolor="rgba(255,255,255,0.03)")

    # Chart 1: Est. Annual Income by Ticker (top 20)
    c1 = df[df["estim_payment_per_year"].fillna(0) > 0].nlargest(20, "estim_payment_per_year")
    if not c1.empty:
        fig1 = go.Figure(go.Bar(
            x=c1["ticker"].tolist(), y=c1["estim_payment_per_year"].tolist(),
            marker_color="#a855f7",
            text=[f"${v:,.0f}" for v in c1["estim_payment_per_year"].tolist()],
            textposition="outside", customdata=c1["description"].tolist(),
            hovertemplate="<b>%{x}</b><br>%{customdata}<br>Est. Annual: <b>$%{y:,.2f}</b><extra></extra>",
        ))
        fig1.update_layout(title="Est. Annual Income by Ticker (Top 20)", xaxis_tickangle=-45,
            yaxis=dict(title="Est. Annual Income ($)", range=[0, c1["estim_payment_per_year"].max() * 1.2]),
            margin=dict(t=50, b=100, l=60, r=20), **dark_layout)
        charts["annual_income"] = json.dumps(fig1, cls=plotly.utils.PlotlyJSONEncoder)

    # Chart 4: Total Divs Received by Ticker
    c4 = df[df["total_divs_received"].fillna(0) > 0].sort_values("total_divs_received", ascending=False)
    if not c4.empty:
        fig4 = go.Figure(go.Bar(
            x=c4["ticker"].tolist(), y=c4["total_divs_received"].tolist(),
            marker_color="#38bdf8",
            text=[f"${v:,.0f}" for v in c4["total_divs_received"].tolist()],
            textposition="outside", customdata=c4["description"].tolist(),
            hovertemplate="<b>%{x}</b><br>%{customdata}<br>Total Divs: <b>$%{y:,.2f}</b><extra></extra>",
        ))
        fig4.update_layout(title="Total Dividends Received by Ticker", xaxis_tickangle=-45,
            yaxis=dict(title="Total Divs Received ($)", range=[0, c4["total_divs_received"].max() * 1.2]),
            margin=dict(t=50, b=100, l=60, r=20), **dark_layout)
        charts["total_divs_ticker"] = json.dumps(fig4, cls=plotly.utils.PlotlyJSONEncoder)

    # Chart 5: Paid For Itself
    paid_df = df.copy()
    paid_df["paid_for_itself"] = pd.to_numeric(paid_df["paid_for_itself"], errors="coerce")
    paid_df = paid_df[paid_df["paid_for_itself"] > 0].copy()
    paid_df["paid_pct"] = (paid_df["paid_for_itself"] * 100).round(1)
    paid_df = paid_df.sort_values("paid_pct", ascending=False)
    if not paid_df.empty:
        fig5 = go.Figure()
        for ctype in paid_df["category_name"].unique().tolist():
            g = paid_df[paid_df["category_name"] == ctype]
            fig5.add_trace(go.Bar(
                x=g["ticker"].tolist(), y=g["paid_pct"].tolist(), name=ctype,
                text=[f"{v:.1f}%" for v in g["paid_pct"].tolist()],
                textposition="auto", customdata=g["description"].tolist(),
                hovertemplate="<b>%{x}</b><br>%{customdata}<br>Cost Recovered: <b>%{y:.1f}%</b><extra></extra>",
            ))
        fig5.add_hline(y=100, line_dash="dash", line_color="gold",
                       annotation_text="100% - Fully Paid For Itself", annotation_font_color="gold")
        _pfi_max = paid_df["paid_pct"].max()
        fig5.update_layout(title="Paid For Itself - % of Cost Recovered via Dividends",
            xaxis_tickangle=-45,
            yaxis=dict(title="% of Cost Recovered", range=[0, max(_pfi_max * 1.15, 110)]),
            legend_title="Category", margin=dict(t=60, b=100, l=60, r=20), **dark_layout)
        charts["paid_for_itself"] = json.dumps(fig5, cls=plotly.utils.PlotlyJSONEncoder)

    # Chart 6: Total Dividends by Category (pie)
    type_grp = df.groupby("category_name")["total_divs_received"].sum().reset_index()
    type_grp = type_grp[type_grp["total_divs_received"] > 0]
    if not type_grp.empty:
        fig6 = go.Figure(go.Pie(
            labels=type_grp["category_name"].tolist(),
            values=type_grp["total_divs_received"].tolist(),
            hovertemplate="<b>%{label}</b><br>Total Dividends: $%{value:,.2f}<br>Share: %{percent}<extra></extra>",
            textinfo="label+percent",
        ))
        fig6.update_layout(title="Total Dividends Received by Category", **dark_layout)
        charts["by_type"] = json.dumps(fig6, cls=plotly.utils.PlotlyJSONEncoder)

    # Chart 2: Projected Monthly Income - next 12 months
    def _add_m(d, n):
        mo = d.month - 1 + n
        return datetime.date(d.year + mo // 12, mo % 12 + 1, min(d.day, 28))

    def _safe_float(v):
        try:
            f = float(v)
            return f if not (math.isnan(f) or math.isinf(f)) else 0.0
        except (TypeError, ValueError):
            return 0.0

    month_start = today_d.replace(day=1)
    future_months = [_add_m(month_start, i) for i in range(12)]
    proj_key = {m: 0.0 for m in future_months}

    # Load actual pay-month assignments from monthly_payout_tickers
    mpt_rows = conn.execute(
        "SELECT ticker, pay_month FROM monthly_payout_tickers WHERE profile_id = ?",
        (profile_id,),
    ).fetchall()
    from collections import defaultdict
    ticker_pay_months = defaultdict(list)
    for r in mpt_rows:
        ticker_pay_months[r["ticker"]].append(r["pay_month"])

    for _, row in df.iterrows():
        annual = _safe_float(row.get("estim_payment_per_year"))
        if annual <= 0:
            continue
        freq = str(row.get("div_frequency") or "").strip()
        if freq in ("--", ""):
            continue
        ticker = row["ticker"]
        drip = str(row.get("reinvest") or "").strip().upper() == "Y"
        div_per_share = _safe_float(row.get("div"))
        price = _safe_float(row.get("current_price"))
        g = (div_per_share / price) if (drip and price > 0 and div_per_share > 0) else 0

        pay_months = ticker_pay_months.get(ticker, [])

        if freq in ("M", "52", "W"):
            # Monthly/weekly payers distribute to every month
            for i, m in enumerate(future_months):
                growth = (1 + g) ** (i // (1 if freq == "M" else 4))
                proj_key[m] += (annual / 12) * growth
        elif pay_months:
            # Use imported pay-month schedule for Q/SA/A payers
            n_pays = len(pay_months)
            per_pay = annual / n_pays
            pay_n = 0
            for m in future_months:
                if m.month in pay_months:
                    proj_key[m] += per_pay * ((1 + g) ** pay_n)
                    pay_n += 1
        else:
            # Fallback: spread evenly
            for m in future_months:
                proj_key[m] += annual / 12

    # Floor current month projected to actual if actual is higher
    try:
        if totals["actual_monthly_income"] and proj_key.get(month_start, 0) < totals["actual_monthly_income"]:
            proj_key[month_start] = totals["actual_monthly_income"]
    except Exception:
        pass

    proj_labels = [m.strftime("%b") for m in future_months]
    proj_vals = [round(v, 2) if not math.isnan(v) else 0.0 for v in (proj_key[m] for m in future_months)]
    total_12m = sum(proj_vals)
    fig2 = go.Figure(go.Bar(
        x=proj_labels, y=proj_vals, marker_color="#22d3ee",
        text=[f"${v:,.0f}" for v in proj_vals], textposition="outside",
        hovertemplate="<b>%{x}</b><br>Projected: <b>$%{y:,.2f}</b><extra></extra>",
    ))
    _proj_max = max(proj_vals) if proj_vals else 1
    fig2.update_layout(
        title=f"Projected Monthly Income - Next 12 Months  |  Est. Annual: ${total_12m:,.0f}  |  Monthly Avg: ${total_12m/12:,.0f}",
        xaxis=dict(type="category", categoryorder="array", categoryarray=proj_labels),
        yaxis=dict(title="Projected Income ($)", range=[0, _proj_max * 1.2]),
        margin=dict(t=60, b=60, l=60, r=20), **dark_layout)
    charts["projected_monthly"] = json.dumps(fig2, cls=plotly.utils.PlotlyJSONEncoder)

    # Chart 3: Monthly Dividends Received (past 12 months)
    # Uses actual monthly_payouts where available, fills gaps with estimates
    # from monthly_payout_tickers schedule + approx_monthly_income.
    try:
        da_window = [_add_m(month_start, i) for i in range(-11, 1)]
        win_start_key = da_window[0].year * 100 + da_window[0].month
        win_end_key = da_window[-1].year * 100 + da_window[-1].month
        mp_rows = conn.execute(
            "SELECT year, month, amount FROM monthly_payouts "
            "WHERE (year * 100 + month) >= ? AND (year * 100 + month) <= ? AND profile_id = ? "
            "ORDER BY year, month",
            (win_start_key, win_end_key, profile_id),
        ).fetchall()
        actuals = {(int(r["year"]), int(r["month"])): float(r["amount"]) for r in mp_rows}

        # Build estimated monthly income from pay-month schedule for gap-filling
        est_by_month = defaultdict(float)  # keyed by month number (1-12)
        for _, row in df.iterrows():
            annual = _safe_float(row.get("estim_payment_per_year"))
            if annual <= 0:
                continue
            freq = str(row.get("div_frequency") or "").strip()
            ticker = row["ticker"]
            pay_months = ticker_pay_months.get(ticker, [])
            if freq in ("M", "52", "W"):
                for mo in range(1, 13):
                    est_by_month[mo] += annual / 12
            elif pay_months:
                n_pays = len(pay_months)
                per_pay = annual / n_pays
                for mo in pay_months:
                    est_by_month[mo] += per_pay
            else:
                for mo in range(1, 13):
                    est_by_month[mo] += annual / 12

        rx_labels = [m.strftime("%b '%y") for m in da_window]
        rx_vals = []
        rx_is_actual = []
        for m in da_window:
            actual = actuals.get((m.year, m.month))
            if actual is not None and actual > 0:
                rx_vals.append(actual)
                rx_is_actual.append(True)
            else:
                # Use estimate for past months, 0 for future
                if m <= month_start:
                    rx_vals.append(round(est_by_month.get(m.month, 0), 2))
                    rx_is_actual.append(False)
                else:
                    rx_vals.append(0.0)
                    rx_is_actual.append(False)

        total_rx = sum(rx_vals)
        # Purple for actual, lighter/dashed for estimated
        bar_colors = ["#a855f7" if is_act else "#6b4d8a" for is_act in rx_is_actual]
        fig3 = go.Figure(go.Bar(
            x=rx_labels, y=rx_vals, marker_color=bar_colors,
            text=[f"${v:,.0f}" if v else "" for v in rx_vals], textposition="outside",
            hovertemplate="<b>%{x}</b><br>Amount: <b>$%{y:,.2f}</b><extra></extra>",
        ))
        _rx_max = max((v for v in rx_vals if v), default=1000)
        win_start, win_end = da_window[0], da_window[-1]
        fig3.update_layout(
            title=f"Monthly Dividends Received  |  {win_start.strftime('%b %Y')} - {win_end.strftime('%b %Y')}  |  Total: ${total_rx:,.0f}",
            xaxis=dict(type="category", categoryorder="array", categoryarray=rx_labels),
            yaxis=dict(title="Amount ($)", range=[0, _rx_max * 1.2]),
            margin=dict(t=60, b=60, l=60, r=20), **dark_layout)
        charts["monthly_received"] = json.dumps(fig3, cls=plotly.utils.PlotlyJSONEncoder)
    except Exception:
        pass

    # ── Portfolio Grade ──
    grade_info = {}
    tickers = df["ticker"].tolist()
    values_map = {row["ticker"]: float(row["current_value"] or 0) for _, row in df.iterrows()}
    try:
        all_dl = list(set(tickers + ["SPY"]))
        raw = yf.download(" ".join(all_dl), period="1y", auto_adjust=True, progress=False)
        if not raw.empty:
            if isinstance(raw.columns, pd.MultiIndex):
                close = raw["Close"].dropna(how="all")
            else:
                close = raw[["Close"]].dropna(how="all")
                close.columns = [all_dl[0]]
            bench_close = close["SPY"] if "SPY" in close.columns else None
            bench_ret = bench_close.pct_change().dropna() if bench_close is not None else None
            available = [t for t in tickers if t in close.columns and len(close[t].dropna()) >= 30]
            if len(available) >= 2:
                returns_df = close[available].pct_change().fillna(0)
                weights_arr = np.array([values_map.get(t, 0.0) for t in available])
                pm = grade_portfolio(returns_df, weights_arr, bench_ret)
                g = pm.get("grade", {})
                grade_info = {
                    "overall": g.get("overall", "N/A"),
                    "score": _clean(g.get("score")),
                    "sharpe": _clean(pm.get("sharpe")),
                    "sortino": _clean(pm.get("sortino")),
                }
    except Exception:
        pass

    conn.close()

    return jsonify(
        rows=table_rows,
        totals=totals,
        charts=charts,
        grade=grade_info,
        categories=categories,
    )


# ── DRIP Settings & Projections ───────────────────────────────────────────────

@app.route("/api/drip-settings", methods=["GET", "POST"])
def drip_settings():
    """GET: load saved reinvest % per ticker. POST: save/update reinvest % for multiple tickers."""
    profile_id = get_profile_id()
    conn = get_connection()
    ensure_tables_exist(conn)

    if request.method == "GET":
        rows = conn.execute(
            "SELECT ticker, reinvest_pct FROM drip_settings WHERE profile_id = ?",
            (profile_id,),
        ).fetchall()
        conn.close()
        return jsonify({r["ticker"]: r["reinvest_pct"] for r in rows})

    # POST — save settings
    data = request.get_json(force=True, silent=True) or {}
    settings = data.get("settings", {})  # {ticker: reinvest_pct}
    cur = conn.cursor()
    for ticker, pct in settings.items():
        ticker = str(ticker).strip().upper()
        if not ticker:
            continue
        try:
            pct = max(0.0, min(100.0, float(pct)))
        except (TypeError, ValueError):
            pct = 100.0
        cur.execute(
            "INSERT INTO drip_settings (ticker, reinvest_pct, profile_id) VALUES (?, ?, ?) "
            "ON CONFLICT(ticker, profile_id) DO UPDATE SET reinvest_pct = excluded.reinvest_pct",
            (ticker, pct, profile_id),
        )
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route("/api/drip-contribution-settings", methods=["GET", "POST"])
def drip_contribution_settings():
    """GET/POST monthly contribution settings for DRIP projections."""
    profile_id = get_profile_id()
    conn = get_connection()
    ensure_tables_exist(conn)

    if request.method == "GET":
        row = conn.execute(
            "SELECT monthly_amount, targeted FROM drip_monthly_contribution WHERE profile_id = ?",
            (profile_id,),
        ).fetchone()
        targets = [
            r["ticker"]
            for r in conn.execute(
                "SELECT ticker FROM drip_contribution_targets WHERE profile_id = ?",
                (profile_id,),
            ).fetchall()
        ]
        conn.close()
        return jsonify(
            monthly_amount=row["monthly_amount"] if row else 0,
            targeted=bool(row["targeted"]) if row else False,
            targets=targets,
        )

    # POST
    data = request.get_json(force=True, silent=True) or {}
    monthly_amount = max(0.0, float(data.get("monthly_amount", 0)))
    targeted = 1 if data.get("targeted") else 0
    targets = data.get("targets", [])

    cur = conn.cursor()
    cur.execute(
        "INSERT INTO drip_monthly_contribution (profile_id, monthly_amount, targeted) VALUES (?, ?, ?) "
        "ON CONFLICT(profile_id) DO UPDATE SET monthly_amount = excluded.monthly_amount, targeted = excluded.targeted",
        (profile_id, monthly_amount, targeted),
    )
    cur.execute("DELETE FROM drip_contribution_targets WHERE profile_id = ?", (profile_id,))
    for t in targets:
        t = str(t).strip().upper()
        if t:
            cur.execute(
                "INSERT OR IGNORE INTO drip_contribution_targets (profile_id, ticker) VALUES (?, ?)",
                (profile_id, t),
            )
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route("/api/drip-redirects", methods=["GET", "POST"])
def drip_redirects():
    """GET/POST distribution redirect pairs for DRIP projections."""
    profile_id = get_profile_id()
    conn = get_connection()
    ensure_tables_exist(conn)

    if request.method == "GET":
        rows = conn.execute(
            "SELECT source_ticker, target_ticker FROM drip_redirects WHERE profile_id = ?",
            (profile_id,),
        ).fetchall()
        conn.close()
        return jsonify(redirects=[{"source": r["source_ticker"], "target": r["target_ticker"]} for r in rows])

    # POST
    data = request.get_json(force=True, silent=True) or {}
    redirects = data.get("redirects", [])

    cur = conn.cursor()
    cur.execute("DELETE FROM drip_redirects WHERE profile_id = ?", (profile_id,))
    for rd in redirects:
        src = str(rd.get("source", "")).strip().upper()
        tgt = str(rd.get("target", "")).strip().upper()
        if src and tgt and src != tgt:
            cur.execute(
                "INSERT OR IGNORE INTO drip_redirects (profile_id, source_ticker, target_ticker) VALUES (?, ?, ?)",
                (profile_id, src, tgt),
            )
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route("/api/analytics/drip-projection", methods=["POST"])
def drip_projection():
    """Project DRIP compounding for actual portfolio holdings."""
    import math

    def _clean(v):
        if v is None:
            return None
        try:
            if math.isnan(v) or math.isinf(v):
                return None
        except (TypeError, ValueError):
            pass
        return v

    profile_id = get_profile_id()
    conn = get_connection()
    ensure_tables_exist(conn)

    data = request.get_json(force=True, silent=True) or {}
    years = max(1, min(30, int(data.get("years", 5))))
    drip_overrides = data.get("drip_settings", {})  # {ticker: reinvest_pct}
    drip_default = data.get("drip_default", None)  # fallback pct from "Set All"
    investment_overrides = data.get("investment_overrides", {})  # {ticker: dollar_amount}
    filter_categories = data.get("categories", [])   # list of category names

    # Load saved DRIP defaults
    saved_drip = {}
    for r in conn.execute("SELECT ticker, reinvest_pct FROM drip_settings WHERE profile_id = ?", (profile_id,)).fetchall():
        saved_drip[r["ticker"]] = r["reinvest_pct"]

    # Load holdings
    rows = conn.execute(
        """SELECT ticker, description, classification_type,
                  quantity, current_price, div, div_frequency,
                  current_annual_yield, estim_payment_per_year
           FROM all_account_info
           WHERE purchase_value IS NOT NULL AND purchase_value > 0
             AND IFNULL(quantity, 0) > 0
             AND profile_id = ?
           ORDER BY ticker""",
        (profile_id,),
    ).fetchall()
    df = pd.DataFrame([dict(r) for r in rows])
    if df.empty:
        conn.close()
        return jsonify(holdings=[], yearly=[], totals={}, categories=[])

    # Enrich with category names
    try:
        cat_map_rows = conn.execute(
            "SELECT tc.ticker, c.name AS category_name "
            "FROM ticker_categories tc "
            "JOIN categories c ON c.id = tc.category_id "
            "WHERE tc.profile_id = ?", (profile_id,)
        ).fetchall()
        cat_map = pd.DataFrame([dict(r) for r in cat_map_rows])
        if not cat_map.empty:
            df = df.merge(cat_map, on="ticker", how="left")
        else:
            df["category_name"] = None
    except Exception:
        df["category_name"] = None

    if "classification_type" in df.columns:
        mask = df["category_name"].isna() | (df["category_name"] == "")
        df.loc[mask, "category_name"] = df.loc[mask, "classification_type"].map(
            lambda c: _CLASSIFICATION_NAMES.get(str(c).strip(), str(c).strip()) if pd.notna(c) else "Other"
        )
    df["category_name"] = df["category_name"].fillna("Other")

    # Categories list for filter UI
    cats = conn.execute(
        "SELECT id, name FROM categories WHERE profile_id = ? ORDER BY sort_order, name",
        (profile_id,),
    ).fetchall()
    categories_list = [{"id": c["id"], "name": c["name"]} for c in cats]
    conn.close()

    # Apply category filter
    if filter_categories:
        df = df[df["category_name"].isin(filter_categories)]
    if df.empty:
        return jsonify(holdings=[], yearly=[], totals={}, categories=categories_list)

    # Coerce numerics
    for col in ["quantity", "current_price", "div", "current_annual_yield", "estim_payment_per_year"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["div_frequency"] = df["div_frequency"].fillna("").astype(str).str.strip()

    # New features: monthly contributions, targeted allocation, redirects
    monthly_contribution = max(0.0, float(data.get("monthly_contribution", 0)))
    contribution_targeted = bool(data.get("contribution_targeted", False))
    contribution_targets_list = [str(t).strip().upper() for t in data.get("contribution_targets", []) if str(t).strip()]
    redirects_list = data.get("redirects", [])
    redirect_map = {}  # source_ticker -> target_ticker
    for rd in redirects_list:
        src = str(rd.get("source", "")).strip().upper()
        tgt = str(rd.get("target", "")).strip().upper()
        if src and tgt and src != tgt:
            redirect_map[src] = tgt

    # Frequency multiplier (payments per year)
    freq_map = {
        "Monthly": 12, "M": 12, "Weekly": 52, "W": 52, "52": 52,
        "Bi-Weekly": 26, "BW": 26, "Quarterly": 4, "Q": 4,
        "Semi-Annual": 2, "SA": 2, "Annual": 1, "A": 1,
    }

    # Monthly payment schedule: which months each frequency pays in (1-indexed)
    # For weekly/bi-weekly, they pay every month with fractional payments
    month_pay_map = {
        12: list(range(1, 13)),          # Monthly: every month
        52: list(range(1, 13)),          # Weekly: every month (~4.33/month)
        26: list(range(1, 13)),          # Bi-Weekly: every month (~2.17/month)
        4:  [3, 6, 9, 12],              # Quarterly
        2:  [6, 12],                     # Semi-Annual
        1:  [12],                        # Annual
    }
    # Payments per month for each frequency
    payments_per_month = {
        12: 1, 52: 52 / 12, 26: 26 / 12, 4: 1, 2: 1, 1: 1,
    }

    # Build ticker info list
    tickers_info = []
    for _, row in df.iterrows():
        ticker = row["ticker"]
        shares = float(row["quantity"])
        price = float(row["current_price"]) if row["current_price"] > 0 else 0
        div_per_share = float(row["div"]) if row["div"] > 0 else 0
        freq_str = row["div_frequency"]
        freq = freq_map.get(freq_str, 0)
        annual_yield = float(row["current_annual_yield"]) if row["current_annual_yield"] else 0

        if div_per_share == 0 and shares > 0 and freq > 0:
            est_annual = float(row["estim_payment_per_year"])
            if est_annual > 0:
                div_per_share = est_annual / (shares * freq)

        # Apply investment override: recalculate shares from dollar amount
        if ticker in investment_overrides and price > 0:
            override_amt = max(0.0, float(investment_overrides[ticker]))
            shares = override_amt / price

        if ticker in drip_overrides:
            reinvest_pct = max(0.0, min(100.0, float(drip_overrides[ticker])))
        elif drip_default is not None:
            reinvest_pct = max(0.0, min(100.0, float(drip_default)))
        else:
            reinvest_pct = 0.0

        tickers_info.append({
            "ticker": ticker,
            "description": row.get("description", ""),
            "category": row.get("category_name", "Other"),
            "shares": shares,
            "price": price,
            "div_per_share": div_per_share,
            "freq_str": freq_str,
            "freq": freq,
            "annual_yield": annual_yield,
            "reinvest_pct": reinvest_pct,
        })

    # Add custom tickers (not in portfolio) for comparison
    custom_tickers_data = data.get("custom_tickers", [])
    existing_tickers = {t["ticker"] for t in tickers_info}
    for ct in custom_tickers_data:
        sym = str(ct.get("ticker", "")).strip().upper()
        if not sym or sym in existing_tickers:
            continue
        ct_price = float(ct.get("price", 0))
        ct_div = float(ct.get("div_per_share", 0))
        ct_freq_str = str(ct.get("freq_str", "Q"))
        ct_freq = freq_map.get(ct_freq_str, 0)
        if sym in investment_overrides and ct_price > 0:
            ct_shares = max(0.0, float(investment_overrides[sym])) / ct_price
        else:
            ct_shares = 0  # default to $0 invested for tickers not owned
        ct_reinvest = float(drip_overrides.get(sym, drip_default if drip_default is not None else 0))
        ct_annual_yield = (ct_div * ct_freq / ct_price) if ct_price > 0 and ct_freq > 0 else 0
        tickers_info.append({
            "ticker": sym,
            "description": ct.get("description", sym),
            "category": "Custom",
            "shares": ct_shares,
            "price": ct_price,
            "div_per_share": ct_div,
            "freq_str": ct_freq_str,
            "freq": ct_freq,
            "annual_yield": ct_annual_yield,
            "reinvest_pct": ct_reinvest,
        })
        existing_tickers.add(sym)

    # Build lookup maps
    ticker_list = [t["ticker"] for t in tickers_info]
    idx = {t["ticker"]: i for i, t in enumerate(tickers_info)}
    prices = {t["ticker"]: t["price"] for t in tickers_info}

    # Current state
    proj_shares = {t["ticker"]: t["shares"] for t in tickers_info}
    new_shares_drip = {t: 0.0 for t in ticker_list}
    new_shares_contrib = {t: 0.0 for t in ticker_list}
    new_shares_redirect_in = {t: 0.0 for t in ticker_list}

    # Year 0 = current state
    yearly_data = {yr: {} for yr in range(0, years + 1)}
    for t in tickers_info:
        tk = t["ticker"]
        annual_income = t["div_per_share"] * t["freq"] * t["shares"]
        yearly_data[0][tk] = {"shares": round(t["shares"], 4), "annual_income": round(annual_income, 2)}

    # Determine contribution-eligible tickers (min $0.50 price to avoid penny-stock distortion)
    # Exclude tickers with 0% reinvest unless explicitly targeted
    MIN_CONTRIB_PRICE = 0.50
    reinvest_by_ticker = {t["ticker"]: t["reinvest_pct"] for t in tickers_info}
    if contribution_targeted and contribution_targets_list:
        contrib_eligible = [t for t in contribution_targets_list if t in idx and prices.get(t, 0) >= MIN_CONTRIB_PRICE]
    else:
        contrib_eligible = [t for t in ticker_list if prices.get(t, 0) >= MIN_CONTRIB_PRICE and reinvest_by_ticker.get(t, 100) > 0]

    # Month-based simulation
    for yr in range(1, years + 1):
        for month in range(1, 13):
            # Step 1: Process dividend payments
            redirect_buys = {}  # target_ticker -> dollar amount to buy
            for ti in tickers_info:
                tk = ti["ticker"]
                freq = ti["freq"]
                if freq <= 0 or prices[tk] <= 0 or ti["div_per_share"] <= 0:
                    continue
                pay_months = month_pay_map.get(freq, [])
                if month not in pay_months:
                    continue
                ppm = payments_per_month.get(freq, 1)
                dividend = ti["div_per_share"] * proj_shares[tk] * ppm
                reinvest_amt = dividend * ti["reinvest_pct"] / 100.0

                if tk in redirect_map:
                    target = redirect_map[tk]
                    if target in idx and prices.get(target, 0) > 0:
                        redirect_buys[target] = redirect_buys.get(target, 0) + reinvest_amt
                    # Source ticker doesn't get new shares from its own dividends
                else:
                    new_sh = reinvest_amt / prices[tk]
                    proj_shares[tk] += new_sh
                    new_shares_drip[tk] += new_sh

            # Apply redirect buys
            for target, amt in redirect_buys.items():
                new_sh = amt / prices[target]
                proj_shares[target] += new_sh
                new_shares_redirect_in[target] += new_sh

            # Step 2: Monthly contribution
            if monthly_contribution > 0 and contrib_eligible:
                per_ticker = monthly_contribution / len(contrib_eligible)
                for t in contrib_eligible:
                    new_sh = per_ticker / prices[t]
                    proj_shares[t] += new_sh
                    new_shares_contrib[t] += new_sh

        # Record year-end state
        for ti in tickers_info:
            tk = ti["ticker"]
            yr_income = ti["div_per_share"] * ti["freq"] * proj_shares[tk]
            yearly_data[yr][tk] = {"shares": round(proj_shares[tk], 4), "annual_income": round(yr_income, 2)}

    # Build holdings output
    holdings_out = []
    for ti in tickers_info:
        tk = ti["ticker"]
        total_new = new_shares_drip[tk] + new_shares_contrib[tk] + new_shares_redirect_in[tk]
        proj_annual_income = ti["div_per_share"] * ti["freq"] * proj_shares[tk]
        annual_income_now = ti["div_per_share"] * ti["freq"] * ti["shares"]

        redirect_target = redirect_map.get(tk)

        holdings_out.append({
            "ticker": tk,
            "description": ti["description"],
            "category": ti["category"],
            "shares": round(ti["shares"], 4),
            "price": _clean(round(ti["price"], 2)),
            "div_per_share": _clean(round(ti["div_per_share"], 4)),
            "frequency": ti["freq_str"],
            "yield_pct": _clean(round(ti["annual_yield"] * 100, 2)),
            "reinvest_pct": round(ti["reinvest_pct"], 1),
            "projected_shares": round(proj_shares[tk], 4),
            "projected_annual_income": round(proj_annual_income, 2),
            "current_annual_income": round(annual_income_now, 2),
            "new_shares": round(total_new, 4),
            "new_shares_drip": round(new_shares_drip[tk], 4),
            "new_shares_contribution": round(new_shares_contrib[tk], 4),
            "new_shares_redirect_in": round(new_shares_redirect_in[tk], 4),
            "redirect_target": redirect_target,
        })

    # Build yearly totals for chart
    yearly_totals = []
    for yr in range(0, years + 1):
        total_income = sum(yearly_data[yr][tk]["annual_income"] for tk in ticker_list)
        total_shares_added = 0
        if yr > 0:
            for tk in ticker_list:
                total_shares_added += yearly_data[yr][tk]["shares"] - yearly_data[yr - 1][tk]["shares"]
        yearly_totals.append({
            "year": yr,
            "annual_income": round(total_income, 2),
            "new_shares_this_year": round(total_shares_added, 4),
        })

    # Per-ticker yearly series for stacked chart
    ticker_yearly = {}
    for tk in ticker_list:
        ticker_yearly[tk] = [{"year": yr, "annual_income": yearly_data[yr][tk]["annual_income"]} for yr in range(0, years + 1)]

    current_total = sum(h["current_annual_income"] for h in holdings_out)
    projected_total = sum(h["projected_annual_income"] for h in holdings_out)
    total_new = sum(h["new_shares"] for h in holdings_out)
    total_contrib_shares = sum(h["new_shares_contribution"] for h in holdings_out)

    totals = {
        "current_annual_income": round(current_total, 2),
        "projected_annual_income": round(projected_total, 2),
        "income_growth_pct": round((projected_total / current_total - 1) * 100, 2) if current_total > 0 else 0,
        "total_new_shares": round(total_new, 4),
        "total_contributions": round(monthly_contribution * 12 * years, 2),
        "contribution_new_shares": round(total_contrib_shares, 4),
        "years": years,
    }

    return jsonify(
        holdings=holdings_out,
        yearly_totals=yearly_totals,
        ticker_yearly=ticker_yearly,
        totals=totals,
        categories=categories_list,
    )


# ── Total Return ──────────────────────────────────────────────────────────────

@app.route("/api/total-return/summary", methods=["GET"])
def total_return_summary():
    """DB-based summary: cards, scatter chart, table rows. No yfinance needed."""
    import math, json
    import plotly.graph_objects as go
    import plotly.utils

    profile_id = get_profile_id()
    conn = get_connection()

    cats = conn.execute(
        "SELECT id, name FROM categories WHERE profile_id = ? ORDER BY sort_order, name",
        (profile_id,),
    ).fetchall()
    categories = [{"id": c["id"], "name": c["name"]} for c in cats]

    cat_param = request.args.get("category", "").strip()
    cat_ids = [c.strip() for c in cat_param.split(",") if c.strip()] if cat_param else []

    rows = conn.execute(
        """SELECT ticker, description, classification_type,
                  price_paid, current_price, quantity,
                  purchase_value, current_value,
                  gain_or_loss, gain_or_loss_percentage,
                  total_divs_received, ytd_divs,
                  estim_payment_per_year, annual_yield_on_cost
           FROM all_account_info
           WHERE purchase_value IS NOT NULL AND purchase_value > 0
             AND profile_id = ?
           ORDER BY ticker""",
        (profile_id,),
    ).fetchall()
    df = pd.DataFrame([dict(r) for r in rows])

    if df.empty:
        conn.close()
        return jsonify({"rows": [], "totals": {}, "scatter": None, "categories": categories})

    # Enrich category names
    try:
        cat_map_rows = conn.execute(
            "SELECT tc.ticker, c.name AS category_name "
            "FROM ticker_categories tc JOIN categories c ON c.id = tc.category_id "
            "WHERE tc.profile_id = ?", (profile_id,)
        ).fetchall()
        cat_map = pd.DataFrame([dict(r) for r in cat_map_rows])
        if not cat_map.empty:
            df = df.merge(cat_map, on="ticker", how="left")
        else:
            df["category_name"] = None
    except Exception:
        df["category_name"] = None

    if "classification_type" in df.columns:
        mask = df["category_name"].isna() | (df["category_name"] == "")
        df.loc[mask, "category_name"] = df.loc[mask, "classification_type"].map(
            lambda c: _CLASSIFICATION_NAMES.get(str(c).strip(), str(c).strip()) if pd.notna(c) else "Other"
        )
    df["category_name"] = df["category_name"].fillna("Other")
    conn.close()

    # Apply category filter
    if cat_ids:
        cat_names = [c["name"] for c in categories if str(c["id"]) in cat_ids]
        if cat_names:
            df = df[df["category_name"].isin(cat_names)]

    if df.empty:
        return jsonify({"rows": [], "totals": {}, "scatter": None, "categories": categories})

    def _safe(v):
        if v is None:
            return None
        try:
            f = float(v)
            return None if (math.isnan(f) or math.isinf(f)) else f
        except (TypeError, ValueError):
            return None

    # Compute return columns
    num_cols = ["price_paid", "current_price", "quantity", "purchase_value",
                "current_value", "gain_or_loss", "total_divs_received",
                "annual_yield_on_cost"]
    for c in num_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    df["total_divs_received"] = df["total_divs_received"].fillna(0)
    df["gain_or_loss"] = df["gain_or_loss"].fillna(0)
    df["total_return_dollar"] = df["gain_or_loss"] + df["total_divs_received"]
    df["total_return_pct"] = (df["total_return_dollar"] / df["purchase_value"].replace(0, float("nan"))) * 100
    df["price_return_pct"] = (df["gain_or_loss"] / df["purchase_value"].replace(0, float("nan"))) * 100

    # Totals
    total_cost = _safe(df["purchase_value"].sum())
    total_curr = _safe(df["current_value"].sum())
    total_gl = _safe(df["gain_or_loss"].sum())
    total_divs = _safe(df["total_divs_received"].sum())
    total_tr = (total_gl or 0) + (total_divs or 0)
    total_tr_pct = round(total_tr / total_cost * 100, 2) if total_cost else 0

    totals = {
        "total_invested": total_cost,
        "current_value": total_curr,
        "price_gl": total_gl,
        "total_divs": total_divs,
        "total_return_dollar": total_tr,
        "total_return_pct": total_tr_pct,
    }

    # Table rows
    table_rows = []
    for _, row in df.sort_values("total_return_pct", ascending=False).iterrows():
        table_rows.append({
            "ticker": row["ticker"],
            "category_name": row.get("category_name", ""),
            "quantity": _safe(row.get("quantity")),
            "price_paid": _safe(row.get("price_paid")),
            "current_price": _safe(row.get("current_price")),
            "purchase_value": _safe(row.get("purchase_value")),
            "current_value": _safe(row.get("current_value")),
            "gain_or_loss": _safe(row.get("gain_or_loss")),
            "price_return_pct": _safe(row.get("price_return_pct")),
            "total_divs_received": _safe(row.get("total_divs_received")),
            "total_return_dollar": _safe(row.get("total_return_dollar")),
            "total_return_pct": _safe(row.get("total_return_pct")),
        })

    # Scatter: Total Return % vs Yield on Cost
    scatter_json = None
    try:
        sdf = df.copy()
        sdf["yield_on_cost_pct"] = sdf["annual_yield_on_cost"].fillna(0) * 100
        sdf["category_name"] = sdf["category_name"].fillna("Other")
        max_pv = float(sdf["purchase_value"].max())
        sdf["bubble_size"] = ((sdf["purchase_value"] / max_pv * 35) + 8).clip(8, 43)

        fig_scatter = go.Figure()
        for ctype, grp in sdf.groupby("category_name"):
            fig_scatter.add_trace(go.Scatter(
                x=grp["yield_on_cost_pct"].tolist(),
                y=grp["total_return_pct"].tolist(),
                mode="markers+text", name=str(ctype),
                text=grp["ticker"].tolist(), textposition="top center",
                textfont=dict(size=9),
                marker=dict(size=grp["bubble_size"].tolist(), opacity=0.8),
                hovertemplate="<b>%{text}</b><br>Total Ret: %{y:.2f}%<br>Yield on Cost: %{x:.2f}%<extra>" + str(ctype) + "</extra>",
            ))
        fig_scatter.add_hline(y=0, line_dash="dash", line_color="gray", opacity=0.5)
        fig_scatter.update_layout(
            title="Total Return % vs Annual Yield on Cost (Since Purchase)",
            template="plotly_dark", height=520,
            xaxis_title="Annual Yield on Cost (%)",
            yaxis_title="Total Return % (Since Purchase)",
            legend_title="Category",
            paper_bgcolor="#1a1f2e", plot_bgcolor="rgba(255,255,255,0.03)",
        )
        scatter_json = json.dumps(fig_scatter, cls=plotly.utils.PlotlyJSONEncoder)
    except Exception:
        pass

    return jsonify(rows=table_rows, totals=totals, scatter=scatter_json, categories=categories)


@app.route("/api/total-return/charts", methods=["GET"])
def total_return_charts():
    """AJAX: yfinance bar + price-history charts for a given period."""
    import math, json, warnings, traceback
    from datetime import date as date_type
    import yfinance as yf
    import plotly.graph_objects as go
    import plotly.utils
    warnings.filterwarnings("ignore")

    period = request.args.get("period", "1y")
    compare = request.args.get("compare", "").strip()

    profile_id = get_profile_id()
    conn = get_connection()

    cat_param = request.args.get("category", "").strip()
    cat_ids = [c.strip() for c in cat_param.split(",") if c.strip()] if cat_param else []

    rows = conn.execute(
        "SELECT ticker, description, classification_type, purchase_value "
        "FROM all_account_info WHERE purchase_value IS NOT NULL AND purchase_value > 0 AND profile_id = ? ORDER BY ticker",
        (profile_id,),
    ).fetchall()
    df = pd.DataFrame([dict(r) for r in rows])

    if df.empty:
        conn.close()
        return jsonify({"error": "No portfolio data"}), 404

    # Enrich with category names and filter
    try:
        cat_map_rows = conn.execute(
            "SELECT tc.ticker, c.name AS category_name "
            "FROM ticker_categories tc JOIN categories c ON c.id = tc.category_id "
            "WHERE tc.profile_id = ?", (profile_id,)
        ).fetchall()
        cat_map = pd.DataFrame([dict(r) for r in cat_map_rows])
        if not cat_map.empty:
            df = df.merge(cat_map, on="ticker", how="left")
        else:
            df["category_name"] = None
    except Exception:
        df["category_name"] = None

    if "classification_type" in df.columns:
        mask = df["category_name"].isna() | (df["category_name"] == "")
        df.loc[mask, "category_name"] = df.loc[mask, "classification_type"].map(
            lambda c: _CLASSIFICATION_NAMES.get(str(c).strip(), str(c).strip()) if pd.notna(c) else "Other"
        )
    df["category_name"] = df["category_name"].fillna("Other")

    cats = conn.execute(
        "SELECT id, name FROM categories WHERE profile_id = ? ORDER BY sort_order, name",
        (profile_id,),
    ).fetchall()
    conn.close()

    if cat_ids:
        cat_names = [c["name"] for c in cats if str(c["id"]) in cat_ids]
        if cat_names:
            df = df[df["category_name"].isin(cat_names)]

    if df.empty:
        return jsonify({"error": "No holdings in selected categories"}), 404

    period_map = {
        "1mo": (dict(period="1mo"), "1d"),
        "3mo": (dict(period="3mo"), "1d"),
        "6mo": (dict(period="6mo"), "1d"),
        "ytd": (dict(period="ytd"), "1d"),
        "1y":  (dict(period="1y"), "1wk"),
        "2y":  (dict(period="2y"), "1wk"),
        "5y":  (dict(period="5y"), "1mo"),
        "max": (dict(period="max"), "1mo"),
    }

    if period.isdigit() and len(period) == 4:
        yr = int(period)
        today = date_type.today()
        start = f"{yr}-01-01"
        end = today.strftime("%Y-%m-%d") if yr == today.year else f"{yr}-12-31"
        yf_kwargs = dict(start=start, end=end)
        yf_interval = "1d" if yr == today.year else "1wk"
    else:
        yf_range, yf_interval = period_map.get(period, (dict(period="1y"), "1wk"))
        yf_kwargs = yf_range

    period_labels = {
        "1mo": "1 Month", "3mo": "3 Months", "6mo": "6 Months",
        "ytd": "Year to Date", "1y": "1 Year", "2y": "2 Years",
        "5y": "5 Years", "max": "All Available",
    }
    if period.isdigit() and len(period) == 4:
        period_labels[period] = f"Calendar {period}"
    period_label = period_labels.get(period, period)

    try:
        tickers_list = df["ticker"].tolist()
        # Parse comparison tickers
        compare_tickers = [t.strip().upper() for t in compare.replace(",", " ").split() if t.strip()] if compare else []
        # Always include SPY as benchmark
        extra = list(set(["SPY"] + compare_tickers))
        all_dl = list(set(tickers_list + extra))

        raw = yf.download(
            " ".join(all_dl), **yf_kwargs, interval=yf_interval,
            progress=False, auto_adjust=True,
        )

        if raw.empty or "Close" not in (raw.columns.get_level_values(0) if isinstance(raw.columns, pd.MultiIndex) else raw.columns):
            return jsonify({"error": "No price data from Yahoo Finance"}), 500

        if isinstance(raw.columns, pd.MultiIndex):
            close = raw["Close"]
        else:
            close = raw[["Close"]]
            close.columns = [all_dl[0]]

        # Normalize to 100
        norm = close.copy()
        for col in norm.columns:
            first_valid = norm[col].first_valid_index()
            if first_valid is not None:
                base = norm.loc[first_valid, col]
                norm[col] = (norm[col] / base) * 100 if base and base != 0 else None

        # Period return per ticker
        returns = {}
        for col in norm.columns:
            s = norm[col].dropna()
            returns[col] = round(float(s.iloc[-1] - 100), 2) if len(s) >= 2 else None

        spy_ret = returns.get("SPY")

        # Bar chart
        ret_df = df.copy()
        ret_df["period_return"] = ret_df["ticker"].map(returns)
        ret_df = ret_df[ret_df["period_return"].notna()].sort_values("period_return", ascending=True)

        if ret_df.empty:
            return jsonify({"error": f"No return data for period: {period_label}"}), 404

        colors = ["#4dff91" if v >= 0 else "#ff6b6b" for v in ret_df["period_return"]]
        fig_bar = go.Figure(go.Bar(
            x=ret_df["period_return"], y=ret_df["ticker"], orientation="h",
            marker_color=colors,
            text=ret_df["period_return"].apply(lambda v: f"{v:.1f}%"),
            textposition="outside",
            hovertemplate="<b>%{y}</b><br>Return: %{x:.2f}%<extra></extra>",
        ))
        if spy_ret is not None:
            fig_bar.add_vline(x=spy_ret, line_dash="dash", line_color="#FFD700",
                              annotation_text=f"SPY: {spy_ret:.1f}%", annotation_position="top")
        fig_bar.update_layout(
            title=f"Total Return % by Ticker - {period_label} (dividend-adjusted)",
            template="plotly_dark", xaxis_title="Total Return (%)", yaxis_title="",
            height=max(500, len(ret_df) * 20),
            margin=dict(l=70, r=80, t=60, b=50),
            paper_bgcolor="#1a1f2e", plot_bgcolor="rgba(255,255,255,0.03)",
        )

        # Price history line chart
        dates = [str(d)[:10] for d in norm.index]
        top5 = set(ret_df.nlargest(5, "period_return")["ticker"].tolist())
        bot5 = set(ret_df.nsmallest(5, "period_return")["ticker"].tolist())
        default_visible = top5 | bot5

        fig_hist = go.Figure()

        # Add SPY + comparison tickers first
        for etk in extra:
            if etk not in norm.columns:
                continue
            is_spy = etk == "SPY"
            fig_hist.add_trace(go.Scatter(
                x=dates, y=norm[etk].tolist(),
                name=f"{etk} (Benchmark)" if is_spy else etk,
                line=dict(color="#FFD700" if is_spy else None, width=3 if is_spy else 2, dash="dash" if is_spy else None),
                visible=True,
            ))

        for tkr in tickers_list:
            if tkr in extra or tkr not in norm.columns:
                continue
            vals = norm[tkr].tolist()
            desc_vals = df.loc[df["ticker"] == tkr, "description"].values
            hover_name = desc_vals[0][:35] if len(desc_vals) and pd.notna(desc_vals[0]) else tkr
            visible = True if tkr in default_visible else "legendonly"
            fig_hist.add_trace(go.Scatter(
                x=dates, y=vals, name=tkr, visible=visible,
                hovertemplate=f"<b>{tkr}</b> - {hover_name}<br>Normalized: %{{y:.1f}}<br>Date: %{{x}}<extra></extra>",
                line=dict(width=1.5),
            ))

        fig_hist.update_layout(
            title=f"Price Performance - {period_label} (normalized to 100, dividend-adjusted)",
            template="plotly_dark", xaxis_title="Date",
            yaxis_title="Normalized Price (100 = start)", height=550,
            legend=dict(orientation="v", x=1.01, y=1, font=dict(size=10)),
            hovermode="x unified",
            paper_bgcolor="#1a1f2e", plot_bgcolor="rgba(255,255,255,0.03)",
        )

        def _clean_val(v):
            if v is None:
                return None
            try:
                if math.isnan(v) or math.isinf(v):
                    return None
            except (TypeError, ValueError):
                pass
            return v

        return jsonify({
            "bar": json.loads(json.dumps(fig_bar, cls=plotly.utils.PlotlyJSONEncoder)),
            "history": json.loads(json.dumps(fig_hist, cls=plotly.utils.PlotlyJSONEncoder)),
            "spy_ret": _clean_val(spy_ret),
            "period_label": period_label,
        })

    except Exception as e:
        return jsonify({"error": str(e), "detail": traceback.format_exc(limit=3)}), 500


@app.route("/api/total-return/compare", methods=["GET"])
def total_return_compare():
    """Comparison chart: price return and total return for selected tickers."""
    import math, warnings
    import yfinance as yf
    warnings.filterwarnings("ignore")

    tickers_param = request.args.get("tickers", "").strip()
    extra_param = request.args.get("extra", "").strip()
    period = request.args.get("period", "1y")

    selected = [t.strip().upper() for t in tickers_param.replace(",", " ").split() if t.strip()]
    extras = [t.strip().upper() for t in extra_param.replace(",", " ").split() if t.strip()]
    all_tickers = list(dict.fromkeys(selected + extras))  # dedupe, preserve order

    if not all_tickers:
        return jsonify({"error": "No tickers selected"}), 400

    period_map = {
        "3mo": dict(period="3mo"), "6mo": dict(period="6mo"),
        "9mo": dict(period="9mo"), "1y": dict(period="1y"),
        "2y": dict(period="2y"), "3y": dict(period="3y"),
        "4y": dict(period="4y"), "5y": dict(period="5y"),
    }
    yf_kwargs = period_map.get(period, dict(period="1y"))
    period_labels = {
        "3mo": "3 Months", "6mo": "6 Months", "9mo": "9 Months",
        "1y": "1 Year", "2y": "2 Years", "3y": "3 Years",
        "4y": "4 Years", "5y": "5 Years",
    }
    period_label = period_labels.get(period, period)

    try:
        raw = yf.download(
            " ".join(all_tickers), **yf_kwargs,
            auto_adjust=False, actions=True, progress=False,
        )
        if raw.empty:
            return jsonify({"error": "No data from Yahoo Finance"}), 500

        if isinstance(raw.columns, pd.MultiIndex):
            close = raw["Close"]
            divs = raw["Dividends"].fillna(0) if "Dividends" in raw.columns.get_level_values(0) else pd.DataFrame(0, index=close.index, columns=close.columns)
        else:
            close = raw[["Close"]]
            close.columns = [all_tickers[0]]
            divs = raw[["Dividends"]].fillna(0) if "Dividends" in raw.columns else pd.DataFrame(0, index=close.index, columns=[all_tickers[0]])
            divs.columns = [all_tickers[0]]

        dates = [d.strftime("%Y-%m-%d") for d in close.index]

        def _clean(v):
            if v is None:
                return None
            try:
                f = float(v)
                return None if (math.isnan(f) or math.isinf(f)) else round(f, 2)
            except (TypeError, ValueError):
                return None

        price_series = {}
        total_series = {}

        for t in all_tickers:
            if t not in close.columns:
                continue
            c = close[t].dropna()
            if len(c) < 2:
                continue
            base = float(c.iloc[0])
            if base == 0:
                continue
            # Price return: normalized to 100
            price_norm = (c / base * 100)
            price_series[t] = [_clean(v) for v in price_norm]

            # Total return: price + cumulative dividends
            d = divs[t].reindex(close.index).fillna(0) if t in divs.columns else pd.Series(0, index=close.index)
            cum_div = d.cumsum()
            total_norm = ((c + cum_div) / base * 100)
            total_series[t] = [_clean(v) for v in total_norm]

        return jsonify({
            "dates": dates,
            "price": price_series,
            "total": total_series,
            "tickers": [t for t in all_tickers if t in price_series],
            "period_label": period_label,
        })

    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "detail": traceback.format_exc(limit=3)}), 500


# ── Growth ─────────────────────────────────────────────────────────────────────

@app.route("/api/growth/data", methods=["GET"])
def growth_data():
    """Portfolio growth charts, heatmap, correlation, and grading."""
    import math
    import warnings
    import numpy as np
    import yfinance as yf
    from grading import grade_portfolio, letter_grade, _sharpe, _sortino
    warnings.filterwarnings("ignore")

    def _clean(v):
        """Convert NaN/Inf to None for JSON safety."""
        if v is None:
            return None
        try:
            if math.isnan(v) or math.isinf(v):
                return None
        except (TypeError, ValueError):
            pass
        return v

    profile_id = get_profile_id()
    period = request.args.get("period", "1y")
    benchmark = request.args.get("benchmark", "SPY").upper().strip()
    category_id = request.args.get("category")

    if period not in ("1y", "5y", "max"):
        period = "1y"

    conn = get_connection()

    # Fetch holdings (optionally filtered by category)
    if category_id:
        cat_ids = [int(c) for c in category_id.split(",") if c.strip().isdigit()]
        placeholders = ",".join("?" * len(cat_ids))
        rows = conn.execute(
            f"""SELECT DISTINCT a.ticker, a.quantity, a.current_value
               FROM all_account_info a
               JOIN ticker_categories tc ON a.ticker = tc.ticker AND a.profile_id = tc.profile_id
               WHERE a.profile_id = ? AND tc.category_id IN ({placeholders})
                 AND a.purchase_value > 0 AND a.quantity > 0""",
            [profile_id] + cat_ids,
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT ticker, quantity, current_value
               FROM all_account_info
               WHERE profile_id = ? AND purchase_value > 0 AND quantity > 0""",
            (profile_id,),
        ).fetchall()

    # Fetch categories for filter dropdown
    cats = conn.execute(
        "SELECT id, name FROM categories WHERE profile_id = ? ORDER BY sort_order, name",
        (profile_id,),
    ).fetchall()
    conn.close()

    categories = [{"id": c["id"], "name": c["name"]} for c in cats]

    if not rows:
        return jsonify({"error": "No holdings found", "categories": categories}), 400

    tickers = [r["ticker"] for r in rows]
    quantities = {r["ticker"]: float(r["quantity"] or 0) for r in rows}
    values = {r["ticker"]: float(r["current_value"] or 0) for r in rows}
    all_dl = list(set(tickers + [benchmark]))

    try:
        raw = yf.download(
            " ".join(all_dl), period=period, auto_adjust=True,
            actions=True, progress=False
        )
        if raw.empty:
            return jsonify({"error": "No price data"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Parse close prices and dividends
    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"].dropna(how="all")
        divs = raw["Dividends"].fillna(0) if "Dividends" in raw.columns.get_level_values(0) else pd.DataFrame(0, index=close.index, columns=close.columns)
    else:
        close = raw[["Close"]].dropna(how="all")
        close.columns = [all_dl[0]]
        divs = raw[["Dividends"]].fillna(0) if "Dividends" in raw.columns else pd.DataFrame(0, index=close.index, columns=[all_dl[0]])
        divs.columns = [all_dl[0]]

    # Filter to tickers actually present in data
    available_tickers = [t for t in tickers if t in close.columns]
    if not available_tickers:
        return jsonify({"error": "No price data for holdings"}), 500

    # ── Portfolio value series (price-only and total return) ──
    first_valid = close[available_tickers].dropna(how="all").index[0]
    close_aligned = close[available_tickers].loc[first_valid:].ffill().bfill()
    divs_aligned = divs[available_tickers].loc[first_valid:].fillna(0) if set(available_tickers).issubset(divs.columns) else pd.DataFrame(0, index=close_aligned.index, columns=available_tickers)

    # Cumulative dividends per share
    cum_divs = divs_aligned.cumsum()

    # Portfolio price-only value
    port_price = pd.Series(0.0, index=close_aligned.index)
    port_total = pd.Series(0.0, index=close_aligned.index)
    for t in available_tickers:
        q = quantities.get(t, 0)
        port_price += close_aligned[t] * q
        port_total += (close_aligned[t] + cum_divs[t]) * q

    # Normalize to 100
    p0 = port_price.iloc[0]
    t0 = port_total.iloc[0]
    port_price_norm = (port_price / p0 * 100) if p0 > 0 else port_price
    port_total_norm = (port_total / t0 * 100) if t0 > 0 else port_total

    # ── Benchmark series ──
    bench_price_norm = pd.Series(dtype=float)
    bench_total_norm = pd.Series(dtype=float)
    if benchmark in close.columns:
        bc = close[benchmark].loc[first_valid:].ffill().bfill()
        bd = divs[benchmark].loc[first_valid:].fillna(0) if benchmark in divs.columns else pd.Series(0, index=bc.index)
        bc_cum_div = bd.cumsum()
        b0 = bc.iloc[0]
        bench_price_norm = (bc / b0 * 100) if b0 > 0 else bc
        bench_total_norm = ((bc + bc_cum_div) / b0 * 100) if b0 > 0 else bc

    dates_str = [d.strftime("%Y-%m-%d") for d in port_price_norm.index]

    # ── Per-ticker returns for bar chart ──
    def pct_return(series, n):
        if len(series) < n + 1:
            return None
        v = float((series.iloc[-1] / series.iloc[-n] - 1) * 100)
        return _clean(round(v, 2))

    def ytd_return(series):
        yr = series.index[-1].year
        yr_start = series.loc[series.index >= f"{yr}-01-01"]
        if len(yr_start) < 2:
            return None
        v = float((yr_start.iloc[-1] / yr_start.iloc[0] - 1) * 100)
        return _clean(round(v, 2))

    windows = {"1M": 21, "3M": 63, "6M": 126, "1Y": 252}
    ticker_returns = []
    for t in available_tickers:
        tc = close_aligned[t]
        row = {"ticker": t}
        for label, n in windows.items():
            row[label] = pct_return(tc, n)
        row["YTD"] = ytd_return(tc)
        ticker_returns.append(row)
    ticker_returns.sort(key=lambda r: r.get("1Y") or 0, reverse=True)

    # ── Heatmap ──
    heatmap_windows = {"1D": 1, "7D": 5, "1M": 21, "3M": 63, "6M": 126, "1Y": 252}
    heatmap_tickers = [r["ticker"] for r in ticker_returns]
    heatmap_labels = list(heatmap_windows.keys()) + ["YTD"]
    heatmap_values = []
    for t in heatmap_tickers:
        tc = close_aligned[t]
        row = []
        for label, n in heatmap_windows.items():
            row.append(pct_return(tc, n))
        row.append(ytd_return(tc))
        heatmap_values.append(row)

    # ── Correlation matrix ──
    daily_returns = close_aligned[available_tickers].pct_change().dropna()
    corr = daily_returns.corr()
    corr_tickers = list(corr.columns)
    corr_matrix = [[_clean(round(float(corr.iloc[i, j]), 3)) for j in range(len(corr_tickers))] for i in range(len(corr_tickers))]

    # ── Portfolio grade ──
    grade_info = {}
    if len(available_tickers) >= 2 and len(daily_returns) >= 30:
        weights_arr = np.array([values.get(t, 0.0) for t in available_tickers])
        bench_ret = daily_returns[benchmark].dropna() if benchmark in daily_returns.columns else None
        returns_for_grade = daily_returns[available_tickers]
        pm = grade_portfolio(returns_for_grade, weights_arr, bench_ret)
        g = pm.get("grade", {})
        grade_info = {
            "overall": g.get("overall", "N/A"),
            "score": _clean(g.get("score")),
            "sharpe": _clean(pm.get("sharpe")),
            "sortino": _clean(pm.get("sortino")),
        }

    # ── Benchmark metrics ──
    benchmark_metrics = {}
    if benchmark in close.columns:
        bc_full = close[benchmark].loc[first_valid:].dropna()
        benchmark_metrics = {
            "sharpe": _clean(_sharpe(bc_full)),
            "sortino": _clean(_sortino(bc_full)),
        }

    def _clean_series(s):
        return [_clean(round(float(v), 2)) for v in s]

    return jsonify(
        portfolio_price={"dates": dates_str, "values": _clean_series(port_price_norm)},
        portfolio_total={"dates": dates_str, "values": _clean_series(port_total_norm)},
        benchmark_price={"dates": [d.strftime("%Y-%m-%d") for d in bench_price_norm.index] if len(bench_price_norm) else [], "values": _clean_series(bench_price_norm)},
        benchmark_total={"dates": [d.strftime("%Y-%m-%d") for d in bench_total_norm.index] if len(bench_total_norm) else [], "values": _clean_series(bench_total_norm)},
        benchmark_ticker=benchmark,
        ticker_returns=ticker_returns,
        heatmap={"tickers": heatmap_tickers, "windows": heatmap_labels, "values": heatmap_values},
        correlation={"tickers": corr_tickers, "matrix": corr_matrix},
        grade=grade_info,
        benchmark_metrics=benchmark_metrics,
        categories=categories,
    )


# ── ETF Screen ─────────────────────────────────────────────────────────────────

def _blend_price_drip(close_series, divs_series, frac, track_cash=True):
    """Simulate reinvestment of dividends.

    frac=0 → price + cash dividends (no reinvestment)
    frac=1 → full DRIP (all dividends reinvested)
    Returns a pandas Series normalised to 100 at start.
    """
    shares = 1.0
    cash_divs = 0.0
    start_price = float(close_series.iloc[0])
    vals = []
    for i in range(len(close_series)):
        price = float(close_series.iloc[i])
        d = float(divs_series.iloc[i]) if i < len(divs_series) else 0.0
        if d > 0 and price > 0:
            reinvest = d * shares * frac
            if track_cash:
                cash_divs += d * shares * (1 - frac)
            shares += reinvest / price
        vals.append((shares * price + cash_divs) / start_price * 100)
    return pd.Series(vals, index=close_series.index)


@app.route("/api/etf-screen/data")
def etf_screen_data():
    """Return OHLCV + return data for one or more tickers."""
    import yfinance as yf

    ticker = request.args.get("ticker", "").strip().upper()
    extra = request.args.get("extra", "").strip()
    period = request.args.get("period", "1y")
    mode = request.args.get("mode", "ohlcv")  # ohlcv | total | price | pricediv | both | all3 | all4
    reinvest_pct = min(100, max(0, int(request.args.get("reinvest", 100))))
    interval = request.args.get("interval", "")

    if not ticker:
        return jsonify(error="ticker is required"), 400

    # Collect all symbols
    symbols = [ticker]
    if extra:
        for s in extra.split(","):
            s = s.strip().upper()
            if s and s not in symbols:
                symbols.append(s)

    # Auto-select interval
    if not interval:
        period_intervals = {
            "1mo": "1d", "3mo": "1d", "6mo": "1d",
            "ytd": "1d", "1y": "1d", "2y": "1wk",
            "5y": "1wk", "10y": "1mo", "max": "1mo",
        }
        interval = period_intervals.get(period, "1d")

    # ---------- OHLCV mode (for candlestick / technical chart) ----------
    if mode == "ohlcv":
        try:
            tk = yf.Ticker(ticker)
            df = tk.history(period=period, interval=interval, auto_adjust=False)
            if df.empty:
                return jsonify(error=f"No data found for {ticker}"), 404

            df = df.dropna(subset=["Open", "High", "Low", "Close"])
            records = []
            for dt, row in df.iterrows():
                records.append({
                    "date": dt.strftime("%Y-%m-%d %H:%M") if interval in ("1m","2m","5m","15m","30m","60m","90m","1h") else dt.strftime("%Y-%m-%d"),
                    "open": round(float(row["Open"]), 4),
                    "high": round(float(row["High"]), 4),
                    "low": round(float(row["Low"]), 4),
                    "close": round(float(row["Close"]), 4),
                    "volume": int(row["Volume"]),
                })

            info = tk.info or {}

            # Fetch ATM implied volatility from nearest options expiration
            iv_data = None
            try:
                expirations = tk.options
                if expirations:
                    chain = tk.option_chain(expirations[0])
                    last_close = float(df["Close"].iloc[-1])
                    # Find ATM call (closest strike to last close)
                    calls = chain.calls
                    if not calls.empty and "strike" in calls.columns and "impliedVolatility" in calls.columns:
                        calls = calls.dropna(subset=["impliedVolatility"])
                        if not calls.empty:
                            atm_idx = (calls["strike"] - last_close).abs().idxmin()
                            atm_call_iv = float(calls.loc[atm_idx, "impliedVolatility"]) * 100
                            # Also get ATM put
                            puts = chain.puts
                            atm_put_iv = None
                            if not puts.empty and "impliedVolatility" in puts.columns:
                                puts = puts.dropna(subset=["impliedVolatility"])
                                if not puts.empty:
                                    atm_put_idx = (puts["strike"] - last_close).abs().idxmin()
                                    atm_put_iv = float(puts.loc[atm_put_idx, "impliedVolatility"]) * 100
                            # Average call and put IV for ATM IV
                            if atm_put_iv is not None:
                                iv_data = {"atm_iv": round((atm_call_iv + atm_put_iv) / 2, 2),
                                           "call_iv": round(atm_call_iv, 2),
                                           "put_iv": round(atm_put_iv, 2),
                                           "expiration": expirations[0]}
                            else:
                                iv_data = {"atm_iv": round(atm_call_iv, 2),
                                           "call_iv": round(atm_call_iv, 2),
                                           "put_iv": None,
                                           "expiration": expirations[0]}
            except Exception:
                pass  # Options data not available for all tickers

            return jsonify(
                ticker=ticker,
                name=info.get("longName") or info.get("shortName") or ticker,
                records=records,
                iv=iv_data,
            )
        except Exception as e:
            return jsonify(error=str(e)), 500

    # ---------- Return modes ----------
    frac = reinvest_pct / 100.0
    try:
        # Download price data (unadjusted)
        price_df = yf.download(symbols, period=period, interval=interval, auto_adjust=False, progress=False)
        if price_df.empty:
            return jsonify(error="No price data found"), 404

        # Download daily data with dividends for return calcs
        div_df = yf.download(symbols, period=period, interval="1d", auto_adjust=False, actions=True, progress=False)

        result = {"mode": mode, "reinvest_pct": reinvest_pct, "series": {}, "stats": {}, "warnings": []}

        def _extract_col(df, col, sym):
            """Safely extract a Series from yfinance download (handles multi-level columns)."""
            if col not in df.columns and hasattr(df.columns, 'get_level_values'):
                # Multi-level columns
                if col in df.columns.get_level_values(0):
                    sub = df[col]
                    if isinstance(sub, pd.DataFrame):
                        if sym in sub.columns:
                            return sub[sym].dropna()
                        elif len(sub.columns) == 1:
                            return sub.iloc[:, 0].dropna()
                    return sub.dropna() if isinstance(sub, pd.Series) else pd.Series(dtype=float)
                return pd.Series(dtype=float)
            if col in df.columns:
                s = df[col]
                if isinstance(s, pd.DataFrame):
                    if sym in s.columns:
                        return s[sym].dropna()
                    elif len(s.columns) == 1:
                        return s.iloc[:, 0].dropna()
                    return pd.Series(dtype=float)
                return s.dropna()
            return pd.Series(dtype=float)

        for sym in symbols:
            close = _extract_col(price_df, "Close", sym)
            div_close = _extract_col(div_df, "Close", sym)
            if div_close.empty:
                div_close = close
            divs_raw = _extract_col(div_df, "Dividends", sym)
            divs = divs_raw.reindex(div_close.index, fill_value=0.0) if not divs_raw.empty else pd.Series(0.0, index=div_close.index)

            if close.empty and div_close.empty:
                result["warnings"].append(f"{sym}: no data available")
                continue

            # Use div_close (daily) for dates and price normalization so all
            # traces share the same x-axis.  close (from price_df) may use a
            # coarser interval (weekly/monthly) whose length differs from the
            # daily return traces, causing misaligned chart data.
            base = div_close if not div_close.empty else close
            dates = [d.strftime("%Y-%m-%d") for d in base.index]
            norm_price = [round(float(v), 4) for v in (base / float(base.iloc[0]) * 100)]

            # Compute return series based on mode
            traces = {}
            if mode == "price":
                traces["price"] = norm_price
            elif mode == "pricediv":
                pd_series = _blend_price_drip(div_close, divs, 0.0, track_cash=True)
                traces["pricediv"] = [round(v, 4) for v in pd_series.tolist()]
            elif mode == "total":
                tot = _blend_price_drip(div_close, divs, frac, track_cash=True)
                traces["total"] = [round(v, 4) for v in tot.tolist()]
            elif mode == "both":
                tot = _blend_price_drip(div_close, divs, frac, track_cash=True)
                traces["total"] = [round(v, 4) for v in tot.tolist()]
                traces["price"] = norm_price
            elif mode == "all3":
                traces["price"] = norm_price
                blend = _blend_price_drip(div_close, divs, frac, track_cash=True)
                traces["blend"] = [round(v, 4) for v in blend.tolist()]
                drip = _blend_price_drip(div_close, divs, 1.0, track_cash=True)
                traces["drip"] = [round(v, 4) for v in drip.tolist()]
            elif mode == "all4":
                traces["price"] = norm_price
                pdiv = _blend_price_drip(div_close, divs, 0.0, track_cash=True)
                traces["pricediv"] = [round(v, 4) for v in pdiv.tolist()]
                blend = _blend_price_drip(div_close, divs, frac, track_cash=True)
                traces["blend"] = [round(v, 4) for v in blend.tolist()]
                drip = _blend_price_drip(div_close, divs, 1.0, track_cash=True)
                traces["drip"] = [round(v, 4) for v in drip.tolist()]

            # Statistics — use base (daily) consistently with traces
            price_ret = round((float(base.iloc[-1]) / float(base.iloc[0]) - 1) * 100, 2)
            # Use the best available total return figure
            if "total" in traces:
                total_ret = round(traces["total"][-1] - 100, 2)
            elif "drip" in traces:
                total_ret = round(traces["drip"][-1] - 100, 2)
            elif "pricediv" in traces:
                total_ret = round(traces["pricediv"][-1] - 100, 2)
            else:
                total_ret = price_ret
            div_contrib = round(total_ret - price_ret, 2)

            # Annualized return
            n_days = (base.index[-1] - base.index[0]).days
            if n_days > 30:
                years = n_days / 365.25
                final_norm = 100 + total_ret
                ann = round(((final_norm / 100) ** (1 / years) - 1) * 100, 2)
            else:
                ann = None

            # Max drawdown (on price)
            running_max = base.cummax()
            drawdown = ((base - running_max) / running_max * 100)
            mdd = round(float(drawdown.min()), 2)

            result["series"][sym] = {"dates": dates, "traces": traces}
            result["stats"][sym] = {
                "total_ret": total_ret,
                "price_ret": price_ret,
                "div_contrib": div_contrib,
                "annualized": ann,
                "max_drawdown": mdd,
            }

        return jsonify(result)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route("/api/etf-screen/tickers")
def etf_screen_tickers():
    """Return list of portfolio tickers for the quick-pick dropdown."""
    profile_id = get_profile_id()
    conn = get_connection()
    conn.row_factory = __import__("sqlite3").Row
    rows = conn.execute(
        """SELECT ticker, description
           FROM all_account_info WHERE profile_id = ? ORDER BY ticker""",
        (profile_id,),
    ).fetchall()
    conn.close()
    return jsonify(tickers=[dict(r) for r in rows])


# ── Dividend Calendar ──────────────────────────────────────────────────────────

def _yf_div_pay_date(ticker):
    """Fetch next dividend pay date from yfinance. Returns date or None."""
    try:
        import yfinance as yf
        cal = yf.Ticker(ticker).calendar
        if not cal or not isinstance(cal, dict):
            return None
        d = cal.get("Dividend Date")
        if d is None:
            return None
        if hasattr(d, "date"):
            d = d.date()
        elif isinstance(d, str):
            from datetime import datetime as _dtm
            d = _dtm.strptime(d[:10], "%Y-%m-%d").date()
        import datetime as _dtmod
        if not isinstance(d, _dtmod.date):
            return None
        if d < _dtmod.date.today() - _dtmod.timedelta(days=548):
            return None
        return d
    except Exception:
        return None


def _build_cal_events():
    """Build dividend calendar events from all_account_info."""
    from datetime import datetime, timedelta
    import calendar as _cal

    FREQ_LABEL = {
        "M": "monthly", "52": "weekly", "W": "weekly",
        "Q": "quarterly", "SA": "semi-annual", "A": "annual",
    }
    FREQ_COLOR = {
        "M": "#00c9a7", "52": "#FFD700", "W": "#FFD700",
        "Q": "#7ecfff", "SA": "#f0a0ff", "A": "#f0a0ff",
    }
    FREQ_OFFSET = {"M": 10, "Q": 14, "SA": 21, "A": 21}

    profile_id = get_profile_id()
    conn = get_connection()
    try:
        df = pd.read_sql("""
            SELECT ticker, description, ex_div_date, div, div_frequency
            FROM all_account_info
            WHERE ex_div_date IS NOT NULL
              AND ex_div_date NOT IN ('', '--')
              AND current_price IS NOT NULL
              AND COALESCE(quantity, 0) > 0
              AND profile_id = ?
            ORDER BY ticker
        """, conn, params=[profile_id])
    except Exception:
        conn.close()
        return []
    conn.close()

    # Pre-fetch yfinance pay dates for non-weekly tickers
    yf_pay_dates = {}
    for tkr in df.loc[~df["div_frequency"].isin(["52", "W"]), "ticker"].tolist():
        pd_date = _yf_div_pay_date(tkr)
        if pd_date:
            yf_pay_dates[tkr] = pd_date

    events = []
    today_d = datetime.today().date()

    for _, row in df.iterrows():
        raw = str(row["ex_div_date"]).strip()
        dt = None
        for fmt in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(raw, fmt).date()
                break
            except ValueError:
                continue
        if dt is None:
            continue

        freq = str(row["div_frequency"]).strip() if pd.notna(row["div_frequency"]) else ""
        amount = float(row["div"]) if pd.notna(row["div"]) and row["div"] else None
        ticker = row["ticker"]

        # Project ex-div date forward to next upcoming occurrence
        # Owner (pid==1) non-weekly dates come from Excel import and are kept as-is
        # Weekly payers always project forward since the next ex-div is always ~1 week away
        threshold = today_d - timedelta(days=1)
        is_weekly = freq in ("52", "W")
        if (is_weekly or profile_id != 1) and dt < threshold and freq:
            def _add_months(d, n):
                m = d.month + n
                y = d.year + (m - 1) // 12
                m = (m - 1) % 12 + 1
                day = min(d.day, _cal.monthrange(y, m)[1])
                return d.replace(year=y, month=m, day=day)

            _period = {
                "M":  lambda d: _add_months(d, 1),
                "Q":  lambda d: _add_months(d, 3),
                "SA": lambda d: _add_months(d, 6),
                "A":  lambda d: _add_months(d, 12),
                "W":  lambda d: d + timedelta(weeks=1),
                "52": lambda d: d + timedelta(weeks=1),
            }.get(freq)
            if _period:
                while dt < threshold:
                    dt = _period(dt)

        # Determine pay date
        pay_estimated = True

        def _next_biz(base, days):
            d = base + timedelta(days=days)
            if d.weekday() == 5:
                d += timedelta(days=2)
            elif d.weekday() == 6:
                d += timedelta(days=1)
            return d

        if freq in ("52", "W"):
            # Weekly: pay 1 business day after ex-div
            pay_dt = _next_biz(dt, 1)
        elif ticker in yf_pay_dates:
            # Confirmed pay date from Yahoo Finance
            pay_dt = yf_pay_dates[ticker]
            pay_estimated = False
        elif freq == "M":
            # Monthly ETF distributions: pay within 2 days of ex-div
            pay_dt = _next_biz(dt, 2)
        else:
            offset = FREQ_OFFSET.get(freq, 10)
            pay_dt = dt + timedelta(days=offset)

        events.append({
            "ticker":        ticker,
            "description":   str(row["description"]) if pd.notna(row["description"]) else "",
            "date":          dt.isoformat(),
            "day":           str(dt.day),
            "month":         dt.strftime("%b"),
            "weekday":       dt.strftime("%a"),
            "amount":        round(amount, 4) if amount is not None else None,
            "freq":          freq,
            "freq_label":    FREQ_LABEL.get(freq, freq.lower() if freq else ""),
            "color":         FREQ_COLOR.get(freq, "#8899aa"),
            "pay_date":      pay_dt.isoformat(),
            "pay_month":     pay_dt.strftime("%b"),
            "pay_day":       str(pay_dt.day),
            "pay_estimated": pay_estimated,
        })

    events.sort(key=lambda e: e["pay_date"])
    return events


@app.route("/api/div-calendar")
def div_calendar():
    """Return dividend calendar events as JSON."""
    from datetime import date
    try:
        events = _build_cal_events()
        return jsonify(events=events, today=date.today().isoformat())
    except Exception as e:
        return jsonify(error=str(e)), 500


# ── Buy / Sell Signals ─────────────────────────────────────────────────────────

SIGNAL_COLOR = {"BUY": "#00c853", "SELL": "#d50000", "NEUTRAL": "#f9a825"}
SIGNAL_ORDER = {"BUY": 0, "NEUTRAL": 1, "SELL": 2}

SECTOR_WATCHLIST = [
    "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
]
ALT_WATCHLIST = [
    "HDG", "HFGM", "WTMF", "DBMF", "HFMF", "GMOM", "MFUT", "CFIT", "GAA",
    "RPAR", "IRVH", "WTIP", "RLY", "FTLS", "BTAL", "CSM", "WTLS", "ORR",
    "NLSI", "TAIL", "KMLM", "CTA", "MNA",
]
BSS_WATCHLIST_NAMES = {
    "XLB": "Materials Select Sector SPDR Fund",
    "XLC": "Communication Services Select Sector SPDR Fund",
    "XLE": "Energy Select Sector SPDR Fund",
    "XLF": "Financial Select Sector SPDR Fund",
    "XLI": "Industrial Select Sector SPDR Fund",
    "XLK": "Technology Select Sector SPDR Fund",
    "XLP": "Consumer Staples Select Sector SPDR Fund",
    "XLRE": "Real Estate Select Sector SPDR Fund",
    "XLU": "Utilities Select Sector SPDR Fund",
    "XLV": "Health Care Select Sector SPDR Fund",
    "XLY": "Consumer Discretionary Select Sector SPDR Fund",
    "HDG": "ProShares Hedge Replication ETF",
    "HFGM": "Unlimited HFGM Global Macro ETF",
    "WTMF": "WisdomTree Managed Futures Strategy Fund",
    "DBMF": "iMGP DBi Managed Futures Strategy ETF",
    "HFMF": "Unlimited HFMF Managed Futures ETF",
    "GMOM": "Cambria Global Momentum ETF",
    "MFUT": "Cambria Managed Futures Strategy ETF",
    "CFIT": "Cambria Fixed Income Trend ETF",
    "GAA": "Cambria Global Asset Allocation ETF",
    "RPAR": "RPAR Risk Parity ETF",
    "IRVH": "Global X Interest Rate Volatility & Inflation Hedge ETF",
    "WTIP": "WisdomTree Inflation Plus Fund",
    "RLY": "SPDR SSgA Multi-Asset Real Return ETF",
    "FTLS": "First Trust Long/Short Equity ETF",
    "BTAL": "AGFiQ US Market Neutral Anti-Beta Fund",
    "CSM": "ProShares Large Cap Core Plus",
    "WTLS": "WisdomTree Efficient Long/Short U.S. Equity Fund",
    "ORR": "Militia Long/Short Equity ETF",
    "NLSI": "NEOS Long/Short Equity Income ETF",
    "TAIL": "Cambria Tail Risk ETF",
    "KMLM": "KFA Mount Lucas Index Strategy ETF",
    "CTA": "Simplify Managed Futures Strategy ETF",
    "MNA": "IQ Merger Arbitrage ETF",
}


def _bss_ao(high, low):
    if len(high) < 34:
        return "NEUTRAL", None, ""
    mid = (high + low) / 2
    ao_v = (mid.rolling(5).mean() - mid.rolling(34).mean()).dropna()
    if len(ao_v) < 2:
        return "NEUTRAL", None, ""
    cur, prv = float(ao_v.iloc[-1]), float(ao_v.iloc[-2])
    direction = "Rising" if cur > prv else ("Falling" if cur < prv else "Flat")
    if cur > 0 and cur > prv:
        return "BUY", cur, direction
    if cur < 0 and cur < prv:
        return "SELL", cur, direction
    return "NEUTRAL", cur, direction


def _bss_rsi(close, period=14):
    if len(close) < period + 1:
        return "NEUTRAL", None
    delta = close.diff()
    avg_gain = delta.clip(lower=0).ewm(com=period - 1, adjust=False, min_periods=period).mean()
    avg_loss = (-delta).clip(lower=0).ewm(com=period - 1, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss
    val = float((100 - 100 / (1 + rs)).iloc[-1])
    if pd.isna(val):
        return "NEUTRAL", None
    if val < 30:
        return "BUY", val
    if val > 70:
        return "SELL", val
    return "NEUTRAL", val


def _bss_macd(close):
    if len(close) < 26:
        return "NEUTRAL"
    macd_line = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    sig_line = macd_line.ewm(span=9, adjust=False).mean()
    m, s = float(macd_line.iloc[-1]), float(sig_line.iloc[-1])
    if pd.isna(m) or pd.isna(s):
        return "NEUTRAL"
    return "BUY" if m > s else "SELL"


def _bss_sma(close, period):
    if len(close) < period:
        return "NEUTRAL", None, None
    sma_val = close.rolling(period).mean().iloc[-1]
    price = close.iloc[-1]
    if pd.isna(sma_val) or pd.isna(price) or float(sma_val) == 0:
        return "NEUTRAL", None, None
    sma_f, price_f = float(sma_val), float(price)
    pct = (price_f - sma_f) / sma_f * 100
    if price_f > sma_f * 1.01:
        return "BUY", sma_f, pct
    if price_f < sma_f * 0.99:
        return "SELL", sma_f, pct
    return "NEUTRAL", sma_f, pct


def _bss_vote(signals):
    """Majority-vote: need >50% of valid (non-None) signals to agree."""
    valid = [s for s in signals if s is not None]
    if not valid:
        return "NEUTRAL"
    threshold = len(valid) / 2
    if valid.count("BUY") > threshold:
        return "BUY"
    if valid.count("SELL") > threshold:
        return "SELL"
    return "NEUTRAL"


def _bss_coverage(close, divs_series):
    """Compute TTM yield-based coverage ratio — same formula as /api/portfolio-coverage.

    coverage = (TTM_price_return_pct + TTM_dist_yield) / TTM_dist_yield
    Returns (coverage_ratio, signal, nav_erosion_label).
    """
    try:
        if close is None or len(close) < 2:
            return None, None, None
        cur_price = float(close.iloc[-1])
        price_1yr_ago = float(close.iloc[0])
        if cur_price <= 0 or price_1yr_ago <= 0:
            return None, None, None

        ttm_price_return_pct = (cur_price - price_1yr_ago) / price_1yr_ago

        ttm_dist_per_share = float(divs_series.sum()) if divs_series is not None and not divs_series.empty else 0.0
        ttm_dist_yield = ttm_dist_per_share / cur_price if cur_price > 0 else 0.0

        if ttm_dist_yield <= 0:
            return None, None, None

        coverage = round((ttm_price_return_pct + ttm_dist_yield) / ttm_dist_yield, 4)

        if coverage > 1:
            sig = "BUY"
            erosion = "Low"
        elif coverage < 1:
            sig = "SELL"
            erosion = "High"
        else:
            sig = "NEUTRAL"
            erosion = "Medium"

        return coverage, sig, erosion
    except Exception:
        return None, None, None


def _bss_sharpe(close, risk_free_annual=0.05):
    import numpy as np
    try:
        if len(close) < 30:
            return None
        daily_ret = close.pct_change().dropna()
        if len(daily_ret) < 30:
            return None
        std = float(daily_ret.std())
        if std == 0 or np.isnan(std):
            return None
        return round((float(daily_ret.mean()) - risk_free_annual / 252) / std * np.sqrt(252), 2)
    except Exception:
        return None


def _bss_sortino(close, risk_free_annual=0.05):
    import numpy as np
    try:
        if len(close) < 30:
            return None
        daily_ret = close.pct_change().dropna()
        if len(daily_ret) < 30:
            return None
        neg_ret = daily_ret[daily_ret < 0]
        if len(neg_ret) == 0:
            return None
        down_std = float(neg_ret.std())
        if down_std == 0 or np.isnan(down_std):
            return None
        return round((float(daily_ret.mean()) - risk_free_annual / 252) / down_std * np.sqrt(252), 2)
    except Exception:
        return None


@app.route("/api/buy-sell-signals")
def buy_sell_signals_data():
    """Compute 5-indicator majority-vote signals for portfolio + sector/watchlist tickers."""
    import yfinance as yf
    import json
    import math
    import warnings
    warnings.filterwarnings("ignore")

    try:
        import plotly.graph_objects as go
        import plotly.utils
        has_plotly = True
    except ImportError:
        has_plotly = False

    WATCHLIST_SIZE = 1000

    def _fmt_pct(v):
        if v is None:
            return "\u2014"
        return f"+{v:.1f}%" if v >= 0 else f"{v:.1f}%"

    profile_id = get_profile_id()
    conn = get_connection()
    try:
        port = pd.read_sql("""
            SELECT ticker, description, classification_type, purchase_value
            FROM all_account_info
            WHERE purchase_value IS NOT NULL AND purchase_value > 0
              AND profile_id = ?
            ORDER BY ticker
        """, conn, params=[profile_id])
    except Exception:
        port = pd.DataFrame(columns=["ticker", "description", "classification_type", "purchase_value"])
    conn.close()

    port["description"] = port["description"].fillna("")
    port["classification_type"] = port["classification_type"].fillna("")
    port_sizes = dict(zip(port["ticker"].tolist(), port["purchase_value"].tolist()))
    port_desc = dict(zip(port["ticker"].tolist(), port["description"].tolist()))
    port_type = dict(zip(port["ticker"].tolist(), port["classification_type"].tolist()))

    all_wl = SECTOR_WATCHLIST + ALT_WATCHLIST
    all_tickers = sorted(set(port["ticker"].tolist() + all_wl))

    error = None
    fig_json = None
    table_rows = []

    try:
        raw = yf.download(
            " ".join(all_tickers),
            period="1y",
            interval="1d",
            auto_adjust=True,
            actions=True,
            progress=False,
        )

        if raw.empty:
            error = "No price data returned from Yahoo Finance."
        else:
            try:
                high_df = raw["High"]
                low_df = raw["Low"]
                close_df = raw["Close"]
            except KeyError:
                high_df = low_df = close_df = None

            # Extract dividends for coverage ratio
            try:
                divs_df = raw["Dividends"]
            except KeyError:
                divs_df = None

            if any(df is None for df in [high_df, low_df, close_df]):
                error = "Missing OHLC price data from Yahoo Finance."
            else:
                SECTOR_SET = set(SECTOR_WATCHLIST)
                labels = ["State Street Sectors"]
                parents_list = [""]
                values_list = [0]
                colors_list = ["#1a1a3a"]
                hover_texts = [""]
                empty = pd.Series([], dtype=float)

                for ticker in all_tickers:
                    has_data = (ticker in close_df.columns and
                                ticker in high_df.columns and
                                ticker in low_df.columns)
                    if has_data:
                        close = close_df[ticker].dropna()
                        high = high_df[ticker].dropna()
                        low = low_df[ticker].dropna()
                    else:
                        close = high = low = empty

                    ao_sig, ao_val, ao_dir = _bss_ao(high, low)
                    rsi_sig, rsi_val = _bss_rsi(close)
                    macd_sig = _bss_macd(close)
                    sma50_sig, sma50_v, sma50_pct = _bss_sma(close, 50)
                    sma200_sig, sma200_v, sma200_pct = _bss_sma(close, 200)
                    sharpe_val = _bss_sharpe(close)
                    sortino_val = _bss_sortino(close)

                    # Coverage ratio (same formula as /api/portfolio-coverage)
                    tk_divs = pd.Series(dtype=float)
                    if divs_df is not None and has_data:
                        if isinstance(divs_df, pd.DataFrame) and ticker in divs_df.columns:
                            tk_divs = divs_df[ticker].dropna()
                        elif isinstance(divs_df, pd.Series):
                            tk_divs = divs_df.dropna()
                    cov_ratio, cov_sig, nav_erosion = _bss_coverage(close, tk_divs)

                    signal = _bss_vote([ao_sig, rsi_sig, macd_sig, sma50_sig, sma200_sig, cov_sig])

                    is_portfolio = ticker in port_sizes
                    is_sector = ticker in SECTOR_SET and not is_portfolio
                    size = port_sizes.get(ticker, WATCHLIST_SIZE)

                    # Treemap nodes
                    if has_plotly:
                        ao_val_str = f"{ao_val:.4f}" if ao_val is not None else "\u2014"
                        rsi_val_str = f"{rsi_val:.1f}" if rsi_val is not None else "\u2014"
                        cov_str = f"{cov_ratio:.2f}" if cov_ratio is not None else "\u2014"
                        hover_text = (
                            f"<b>{signal}</b><br>"
                            f"AO: {ao_sig} ({ao_val_str}, {ao_dir or chr(8212)})<br>"
                            f"RSI: {rsi_sig} ({rsi_val_str})<br>"
                            f"MACD: {macd_sig}<br>"
                            f"SMA 50: {sma50_sig} ({_fmt_pct(sma50_pct)})<br>"
                            f"SMA 200: {sma200_sig} ({_fmt_pct(sma200_pct)})<br>"
                            f"Coverage: {cov_str} ({nav_erosion or chr(8212)} erosion risk)"
                        )
                        if is_portfolio:
                            labels.append(ticker)
                            parents_list.append("")
                            values_list.append(float(size))
                            colors_list.append(SIGNAL_COLOR[signal])
                            hover_texts.append(hover_text)
                        elif is_sector:
                            labels.append(ticker)
                            parents_list.append("State Street Sectors")
                            values_list.append(WATCHLIST_SIZE)
                            colors_list.append(SIGNAL_COLOR[signal])
                            hover_texts.append(hover_text)

                    table_rows.append({
                        "ticker": ticker,
                        "desc": port_desc.get(ticker) or BSS_WATCHLIST_NAMES.get(ticker, ""),
                        "ctype": port_type.get(ticker, ""),
                        "source": "Portfolio" if is_portfolio else ("Sectors" if is_sector else "Watchlist"),
                        "signal": signal,
                        "sig_order": SIGNAL_ORDER[signal],
                        "ao_sig": ao_sig,
                        "ao_sig_ord": SIGNAL_ORDER[ao_sig],
                        "ao_value": f"{ao_val:.4f}" if ao_val is not None else "\u2014",
                        "ao_val_num": ao_val if ao_val is not None else "",
                        "ao_dir": ao_dir,
                        "rsi_sig": rsi_sig,
                        "rsi_sig_ord": SIGNAL_ORDER[rsi_sig],
                        "rsi_value": f"{rsi_val:.1f}" if rsi_val is not None else "\u2014",
                        "rsi_val_num": rsi_val if rsi_val is not None else "",
                        "macd_sig": macd_sig,
                        "macd_sig_ord": SIGNAL_ORDER[macd_sig],
                        "sma50_sig": sma50_sig,
                        "sma50_sig_ord": SIGNAL_ORDER[sma50_sig],
                        "sma50_pct": _fmt_pct(sma50_pct),
                        "sma200_sig": sma200_sig,
                        "sma200_sig_ord": SIGNAL_ORDER[sma200_sig],
                        "sma200_pct": _fmt_pct(sma200_pct),
                        "sharpe_val": f"{sharpe_val:.2f}" if sharpe_val is not None else "\u2014",
                        "sharpe_val_num": sharpe_val if sharpe_val is not None else "",
                        "sortino_val": f"{sortino_val:.2f}" if sortino_val is not None else "\u2014",
                        "sortino_val_num": sortino_val if sortino_val is not None else "",
                        "cov_ratio": f"{cov_ratio:.2f}" if cov_ratio is not None else "\u2014",
                        "cov_ratio_num": cov_ratio if cov_ratio is not None else "",
                        "cov_sig": cov_sig or "NEUTRAL",
                        "cov_sig_ord": SIGNAL_ORDER.get(cov_sig or "NEUTRAL", 1),
                        "nav_erosion": nav_erosion or "\u2014",
                        "pv_fmt": f"${size:,.2f}" if is_portfolio else "\u2014",
                        "pv_num": float(size) if is_portfolio else 0,
                        "src_order": 0 if is_portfolio else (1 if is_sector else 2),
                    })

                table_rows.sort(key=lambda r: (r["src_order"], r["sig_order"], -r["pv_num"]))

                if has_plotly:
                    fig = go.Figure(go.Treemap(
                        labels=labels,
                        parents=parents_list,
                        values=values_list,
                        text=hover_texts,
                        marker=dict(colors=colors_list),
                        textinfo="label",
                        hovertemplate="<b>%{label}</b><br>%{text}<extra></extra>",
                    ))
                    fig.update_layout(
                        title="Buy / Sell Signal Dashboard",
                        template="plotly_dark",
                        margin=dict(t=50, l=5, r=5, b=5),
                        height=720,
                        hoverlabel=dict(bgcolor="#111124", bordercolor="#3a3a5c",
                                        font=dict(color="#e0e0e0", size=13)),
                    )
                    fig_json = json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)

    except Exception:
        import traceback
        error = traceback.format_exc(limit=5)

    def _scrub(obj):
        if isinstance(obj, list):
            return [_scrub(v) for v in obj]
        if isinstance(obj, dict):
            return {k: _scrub(v) for k, v in obj.items()}
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
        if obj is pd.NaT:
            return None
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        return obj

    table_rows = _scrub(table_rows)
    return jsonify(fig_json=fig_json, error=error, table_rows=table_rows)


# ── Watchlist ──────────────────────────────────────────────────────────────────

@app.route("/api/watchlist/watching", methods=["GET", "POST"])
def watchlist_watching_list():
    """GET: return watching rows.  POST: bulk-replace watching list."""
    conn = get_connection()

    if request.method == "POST":
        data = request.get_json(force=True)
        rows = data.get("rows", [])
        conn.execute("DELETE FROM watchlist_watching")
        for i, r in enumerate(rows):
            ticker = str(r.get("ticker", "")).strip().upper()
            if not ticker:
                continue
            notes = str(r.get("notes", ""))[:500]
            conn.execute(
                "INSERT INTO watchlist_watching (ticker, notes, sort_order) VALUES (?, ?, ?)",
                (ticker, notes, i),
            )
        conn.commit()
        conn.close()
        return jsonify(ok=True)

    # GET
    rows = conn.execute(
        "SELECT ticker, notes, added_date FROM watchlist_watching ORDER BY sort_order, id"
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        result.append({
            "ticker": r["ticker"],
            "notes": r["notes"] or "",
            "added_date": r["added_date"] or "",
        })
    return jsonify(rows=result)


@app.route("/api/watchlist/data")
def watchlist_data():
    """Analysis data for all watchlist tickers."""
    import yfinance as yf
    import numpy as np
    import warnings
    import math
    warnings.filterwarnings("ignore")

    conn = get_connection()
    try:
        watching_rows = conn.execute(
            "SELECT ticker, notes FROM watchlist_watching ORDER BY sort_order, id"
        ).fetchall()
    except Exception:
        watching_rows = []
    conn.close()

    watching_tickers = [r["ticker"] for r in watching_rows]
    if not watching_tickers:
        return jsonify(watching=[], counts={"BUY": 0, "SELL": 0, "NEUTRAL": 0})

    error = None
    result_rows = []
    counts = {"BUY": 0, "SELL": 0, "NEUTRAL": 0}

    # ── Indicator helpers ──

    def _ao(high, low):
        if len(high) < 34:
            return "NEUTRAL", None, ""
        mid = (high + low) / 2
        ao_v = (mid.rolling(5).mean() - mid.rolling(34).mean()).dropna()
        if len(ao_v) < 2:
            return "NEUTRAL", None, ""
        cur, prv = float(ao_v.iloc[-1]), float(ao_v.iloc[-2])
        direction = "Rising" if cur > prv else ("Falling" if cur < prv else "Flat")
        if cur > 0 and cur > prv:
            return "BUY", cur, direction
        if cur < 0 and cur < prv:
            return "SELL", cur, direction
        return "NEUTRAL", cur, direction

    def _rsi(close, period=14):
        if len(close) < period + 1:
            return "NEUTRAL", None
        delta = close.diff()
        avg_gain = delta.clip(lower=0).ewm(com=period - 1, adjust=False, min_periods=period).mean()
        avg_loss = (-delta).clip(lower=0).ewm(com=period - 1, adjust=False, min_periods=period).mean()
        rs = avg_gain / avg_loss
        val = float((100 - 100 / (1 + rs)).iloc[-1])
        if pd.isna(val):
            return "NEUTRAL", None
        if val < 30:
            return "BUY", val
        if val > 70:
            return "SELL", val
        return "NEUTRAL", val

    def _macd(close):
        if len(close) < 26:
            return "NEUTRAL"
        macd_line = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
        sig_line = macd_line.ewm(span=9, adjust=False).mean()
        m, s = float(macd_line.iloc[-1]), float(sig_line.iloc[-1])
        if pd.isna(m) or pd.isna(s):
            return "NEUTRAL"
        return "BUY" if m > s else "SELL"

    def _sma(close, period):
        if len(close) < period:
            return "NEUTRAL", None, None
        sma_val = close.rolling(period).mean().iloc[-1]
        price = close.iloc[-1]
        if pd.isna(sma_val) or pd.isna(price) or float(sma_val) == 0:
            return "NEUTRAL", None, None
        sma_f, price_f = float(sma_val), float(price)
        pct = (price_f - sma_f) / sma_f * 100
        if price_f > sma_f * 1.01:
            return "BUY", sma_f, pct
        if price_f < sma_f * 0.99:
            return "SELL", sma_f, pct
        return "NEUTRAL", sma_f, pct

    def _vote(signals):
        valid = [s for s in signals if s is not None]
        if not valid:
            return "NEUTRAL"
        threshold = len(valid) / 2
        if valid.count("BUY") > threshold:
            return "BUY"
        if valid.count("SELL") > threshold:
            return "SELL"
        return "NEUTRAL"

    def _sharpe(close, risk_free_annual=0.05):
        try:
            if len(close) < 30:
                return None
            daily_ret = close.pct_change().dropna()
            if len(daily_ret) < 30:
                return None
            std = float(daily_ret.std())
            if std == 0 or np.isnan(std):
                return None
            daily_rf = risk_free_annual / 252
            excess = float(daily_ret.mean()) - daily_rf
            return round(excess / std * np.sqrt(252), 2)
        except Exception:
            return None

    def _sortino(close, risk_free_annual=0.05):
        try:
            if len(close) < 30:
                return None
            daily_ret = close.pct_change().dropna()
            if len(daily_ret) < 30:
                return None
            daily_rf = risk_free_annual / 252
            neg_ret = daily_ret[daily_ret < 0]
            if len(neg_ret) == 0:
                return None
            down_std = float(neg_ret.std())
            if down_std == 0 or np.isnan(down_std):
                return None
            excess = float(daily_ret.mean()) - daily_rf
            return round(excess / down_std * np.sqrt(252), 2)
        except Exception:
            return None

    try:
        raw = yf.download(
            " ".join(watching_tickers),
            period="1y",
            interval="1d",
            auto_adjust=False,
            actions=True,
            progress=False,
        )

        if raw.empty:
            return jsonify(watching=[], counts=counts, error="No price data returned.")

        try:
            _top = raw.columns.get_level_values(0)
            has_multi = True
        except AttributeError:
            has_multi = False

        if has_multi:
            close_df = raw["Adj Close"] if "Adj Close" in _top else raw["Close"]
            unadj_close_df = raw["Close"]
            high_df = raw["High"]
            low_df = raw["Low"]
            divs_df = raw["Dividends"] if "Dividends" in _top else None
        else:
            close_df = raw[["Adj Close"]] if "Adj Close" in raw.columns else raw[["Close"]]
            unadj_close_df = raw[["Close"]]
            high_df = raw[["High"]]
            low_df = raw[["Low"]]
            divs_df = raw[["Dividends"]] if "Dividends" in raw.columns else None

        empty = pd.Series([], dtype=float)
        ticker_info = {}

        for ticker in watching_tickers:
            has_data = (ticker in close_df.columns and
                        ticker in high_df.columns and
                        ticker in low_df.columns)
            if has_data:
                close = close_df[ticker].dropna()
                high = high_df[ticker].dropna()
                low = low_df[ticker].dropna()
            else:
                close = high = low = empty

            ao_sig, ao_val, ao_dir = _ao(high, low)
            rsi_sig, rsi_val = _rsi(close)
            macd_sig = _macd(close)
            sma50_sig, sma50_v, sma50_pct = _sma(close, 50)
            sma200_sig, sma200_v, sma200_pct = _sma(close, 200)
            # Coverage ratio
            cov_ratio, cov_sig, cov_erosion = None, None, None
            if divs_df is not None and has_data:
                try:
                    t_divs_cov = divs_df[ticker].dropna() if ticker in divs_df.columns else pd.Series([], dtype=float)
                    t_divs_cov = t_divs_cov[t_divs_cov > 0]
                    cov_ratio, cov_sig, cov_erosion = _bss_coverage(close, t_divs_cov)
                except Exception:
                    pass

            signal = _vote([ao_sig, rsi_sig, macd_sig, sma50_sig, sma200_sig, cov_sig])

            sharpe_val = _sharpe(close)
            sortino_val = _sortino(close)

            price = float(close.iloc[-1]) if len(close) >= 1 else None
            prev_price = float(close.iloc[-2]) if len(close) >= 2 else None
            change_1d = round((price - prev_price) / prev_price * 100, 2) \
                if price is not None and prev_price else None

            div_yield = None
            if divs_df is not None and price is not None and price > 0:
                try:
                    t_divs = divs_df[ticker].dropna() if ticker in divs_df.columns else pd.Series([], dtype=float)
                    ttm_divs = t_divs[t_divs > 0].sum()
                    if ttm_divs > 0:
                        div_yield = round(ttm_divs / price * 100, 2)
                except Exception:
                    pass

            one_yr_ret = None
            if len(close) >= 2:
                first_price = float(close.iloc[0])
                if first_price > 0:
                    one_yr_ret = round((price - first_price) / first_price * 100, 2)

            nav_erosion = False
            unadj_close = unadj_close_df[ticker].dropna() if ticker in unadj_close_df.columns else pd.Series([], dtype=float)
            if len(unadj_close) >= 2:
                unadj_first = float(unadj_close.iloc[0])
                unadj_last = float(unadj_close.iloc[-1])
                if unadj_first > 0:
                    unadj_ret = (unadj_last - unadj_first) / unadj_first * 100
                    if unadj_ret < -5:
                        nav_erosion = True

            ticker_info[ticker] = {
                "price": round(price, 2) if price is not None else None,
                "change_1d": change_1d,
                "div_yield": div_yield,
                "signal": signal,
                "ao_sig": ao_sig,
                "ao_val": round(ao_val, 4) if ao_val is not None else None,
                "ao_dir": ao_dir,
                "rsi_sig": rsi_sig,
                "rsi_val": round(rsi_val, 1) if rsi_val is not None else None,
                "macd_sig": macd_sig,
                "sma50_sig": sma50_sig,
                "sma50_pct": round(sma50_pct, 1) if sma50_pct is not None else None,
                "sma200_sig": sma200_sig,
                "sma200_pct": round(sma200_pct, 1) if sma200_pct is not None else None,
                "one_yr_ret": one_yr_ret,
                "nav_erosion": nav_erosion,
                "sharpe": round(sharpe_val, 2) if sharpe_val is not None else None,
                "sortino": round(sortino_val, 2) if sortino_val is not None else None,
                "cov_ratio": round(cov_ratio, 4) if cov_ratio is not None else None,
                "cov_sig": cov_sig,
                "nav_erosion_prob": cov_erosion,
            }

        # Build watching result rows
        for wr in watching_rows:
            t = wr["ticker"]
            info = ticker_info.get(t, {})
            result_rows.append({
                "ticker": t,
                "notes": wr["notes"] or "",
                **info,
            })

    except Exception:
        import traceback
        error = traceback.format_exc(limit=5)

    # Scrub NaN/NaT
    def _scrub(obj):
        if isinstance(obj, list):
            return [_scrub(v) for v in obj]
        if isinstance(obj, dict):
            return {k: _scrub(v) for k, v in obj.items()}
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
        if obj is pd.NaT:
            return None
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        return obj

    result_rows = _scrub(result_rows)

    counts = {"BUY": 0, "SELL": 0, "NEUTRAL": 0}
    for row in result_rows:
        sig = row.get("signal", "NEUTRAL")
        counts[sig] = counts.get(sig, 0) + 1

    return jsonify(watching=result_rows, counts=counts, error=error)


# ── NAV Erosion Back-Tester ────────────────────────────────────────────────────

@app.route("/api/nav-erosion/data")
def nav_erosion_data():
    """Back-test a ticker for NAV erosion over a custom date range."""
    import warnings
    warnings.filterwarnings("ignore")

    sym = request.args.get("ticker", "").strip().upper()
    try:
        initial_investment = float(request.args.get("amount", 0))
    except (TypeError, ValueError):
        initial_investment = 0.0
    start_date = request.args.get("start", "")
    end_date = request.args.get("end", "")
    try:
        reinvest_pct = float(request.args.get("reinvest", 0))
    except (TypeError, ValueError):
        reinvest_pct = 0.0

    if not sym:
        return jsonify(error="Please enter a ticker symbol.")
    if initial_investment <= 0:
        return jsonify(error="Initial investment must be greater than zero.")
    if not start_date or not end_date:
        return jsonify(error="Please select both start and end dates.")

    error = None
    warning = None
    fig_json = None
    rows = []
    summary = {}

    try:
        from datetime import datetime as _dt
        import json
        import yfinance as yf
        import plotly.graph_objects as go
        import plotly.utils

        hist = yf.Ticker(sym).history(
            start=start_date, end=end_date,
            interval="1d", auto_adjust=False, actions=True,
        )

        if hist.empty:
            return jsonify(error=f"No data found for ticker {sym}. Check the symbol and date range.")

        # Detect if data starts later than requested
        requested_start = _dt.strptime(start_date, "%Y-%m-%d").date()
        actual_start = hist.index[0].date()
        if (actual_start - requested_start).days > 30:
            warning = (
                f"{sym} only has data going back to {actual_start.strftime('%B %d, %Y')}. "
                f"Results are shown from that date — your requested start "
                f"({requested_start.strftime('%B %d, %Y')}) predates when this ETF existed."
            )

        monthly_close = hist["Close"].resample("ME").last()
        monthly_divs = hist["Dividends"].resample("ME").sum()

        df = pd.DataFrame({"price": monthly_close, "div": monthly_divs}).dropna(subset=["price"])
        df["div"] = df["div"].fillna(0.0)

        if df.empty:
            return jsonify(error=f"No usable monthly data for {sym}.")

        initial_price = float(df["price"].iloc[0])
        if initial_price == 0:
            return jsonify(error=f"Initial price for {sym} is zero — cannot calculate.")

        current_shares = initial_investment / initial_price
        cumulative_dist = 0.0
        cumulative_reinvested = 0.0
        cumulative_shares_bought = 0.0
        prev_price = initial_price
        cumulative_divs_per_share = 0.0

        for dt, row in df.iterrows():
            price = float(row["price"])
            div_per_share = float(row["div"])
            total_dist = div_per_share * current_shares
            reinvest_amt = total_dist * reinvest_pct / 100.0
            shares_bought = (reinvest_amt / price) if price > 0 else 0.0
            current_shares += shares_bought
            portfolio_val = current_shares * price
            breakeven_sh = (initial_investment / price) if price > 0 else 0.0
            shares_deficit = breakeven_sh - current_shares
            price_delta_pct = (price - initial_price) / initial_price * 100 if initial_price else 0.0
            cumulative_dist += total_dist
            cumulative_reinvested += reinvest_amt
            cumulative_shares_bought += shares_bought
            cumulative_divs_per_share += div_per_share

            # Coverage ratio: (month-over-month price change + distribution) / distribution
            price_change = price - prev_price
            if div_per_share > 0:
                coverage_ratio = round((price_change + div_per_share) / div_per_share, 4)
            else:
                coverage_ratio = None
            prev_price = price

            rows.append({
                "date": dt.strftime("%b %Y"),
                "price": round(price, 4),
                "price_delta_pct": round(price_delta_pct, 2),
                "div_per_share": round(div_per_share, 4),
                "total_dist": round(total_dist, 2),
                "reinvested": round(reinvest_amt, 2),
                "shares_bought": round(shares_bought, 4),
                "total_shares": round(current_shares, 4),
                "portfolio_val": round(portfolio_val, 2),
                "breakeven_sh": round(breakeven_sh, 4),
                "shares_deficit": round(shares_deficit, 4),
                "coverage_ratio": coverage_ratio,
            })

        final_row = rows[-1]
        # Aggregate coverage: (total price change + total divs per share) / total divs per share
        total_price_change = final_row["price"] - initial_price
        if cumulative_divs_per_share > 0:
            total_coverage = round((total_price_change + cumulative_divs_per_share) / cumulative_divs_per_share, 4)
        else:
            total_coverage = None
        summary = {
            "total_dist": round(cumulative_dist, 2),
            "total_shares_bought": round(cumulative_shares_bought, 4),
            "total_reinvested": round(cumulative_reinvested, 2),
            "final_value": final_row["portfolio_val"],
            "price_chg_pct": final_row["price_delta_pct"],
            "has_erosion": final_row["shares_deficit"] > 0,
            "final_deficit": final_row["shares_deficit"],
            "total_coverage": total_coverage,
        }

        dates_list = [r["date"] for r in rows]
        prices_list = [r["price"] for r in rows]
        vals_list = [r["portfolio_val"] for r in rows]
        breakeven_list = [initial_investment] * len(rows)

        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=dates_list, y=prices_list,
            name="Share Price",
            line=dict(color="#7ecfff", width=2),
            yaxis="y1",
            hovertemplate="<b>%{x}</b><br>Price: $%{y:.2f}<extra></extra>",
        ))
        fig.add_trace(go.Scatter(
            x=dates_list, y=vals_list,
            name="Portfolio Value",
            line=dict(color="#00e89a", width=2),
            yaxis="y2",
            hovertemplate="<b>%{x}</b><br>Portfolio Value: $%{y:,.2f}<extra></extra>",
        ))
        fig.add_trace(go.Scatter(
            x=dates_list, y=breakeven_list,
            name="Initial Investment",
            line=dict(color="#888", width=1.5, dash="dash"),
            yaxis="y2",
            hovertemplate="<b>%{x}</b><br>Break-Even: $%{y:,.2f}<extra></extra>",
        ))
        fig.update_layout(
            title=f"{sym} — NAV Erosion Back-Test ({rows[0]['date']} → {rows[-1]['date']})",
            template="plotly_dark",
            margin=dict(t=50, l=60, r=60, b=50),
            height=420,
            legend=dict(orientation="h", y=1.08, x=0),
            hoverlabel=dict(
                bgcolor="#111124",
                bordercolor="#3a3a5c",
                font=dict(color="#e0e0e0", size=13),
            ),
            yaxis=dict(title="Share Price ($)", tickprefix="$", side="left"),
            yaxis2=dict(
                title="Portfolio Value ($)", tickprefix="$",
                overlaying="y", side="right", showgrid=False,
            ),
            hovermode="x unified",
        )
        fig_json = json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)

    except Exception:
        import traceback
        error = traceback.format_exc(limit=5)

    return jsonify(fig_json=fig_json, error=error, warning=warning, rows=rows, summary=summary)


# ── NAV Erosion Portfolio Screener ─────────────────────────────────────────────

@app.route("/api/nav-erosion-portfolio/list", methods=["GET", "POST"])
def nav_erosion_portfolio_list():
    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    if request.method == "GET":
        cur.execute(
            "SELECT ticker, amount, reinvest_pct FROM nav_erosion_portfolio_list ORDER BY sort_order"
        )
        rows = [{"ticker": r[0], "amount": r[1], "reinvest_pct": r[2]} for r in cur.fetchall()]
        conn.close()
        return jsonify(rows=rows)

    # POST — replace list
    data = request.get_json(force=True, silent=True) or {}
    rows = data.get("rows", [])

    if len(rows) > 80:
        conn.close()
        return jsonify(error="Maximum 80 ETFs allowed.")

    validated = []
    for i, r in enumerate(rows):
        ticker = str(r.get("ticker", "")).strip().upper()
        if not ticker:
            conn.close()
            return jsonify(error=f"Row {i+1}: ticker is required.")
        try:
            amount = float(r.get("amount", 0))
        except (TypeError, ValueError):
            conn.close()
            return jsonify(error=f"Row {i+1}: invalid amount.")
        if amount <= 0:
            conn.close()
            return jsonify(error=f"Row {i+1}: amount must be greater than 0.")
        try:
            reinvest_pct = float(r.get("reinvest_pct", 0))
        except (TypeError, ValueError):
            conn.close()
            return jsonify(error=f"Row {i+1}: invalid reinvest %.")
        if reinvest_pct < 0 or reinvest_pct > 100:
            conn.close()
            return jsonify(error=f"Row {i+1}: reinvest % must be 0–100.")
        validated.append((ticker, amount, reinvest_pct, i))

    cur.execute("DELETE FROM nav_erosion_portfolio_list")
    for ticker, amount, reinvest_pct, sort_order in validated:
        cur.execute(
            "INSERT INTO nav_erosion_portfolio_list (ticker, amount, reinvest_pct, sort_order) "
            "VALUES (?, ?, ?, ?)",
            (ticker, amount, reinvest_pct, sort_order),
        )
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route("/api/nav-erosion-portfolio/saved", methods=["GET", "POST"])
def nav_erosion_portfolio_saved():
    import json as _json
    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    if request.method == "GET":
        cur.execute(
            "SELECT id, name, created_at, start_date, end_date "
            "FROM nav_erosion_saved_backtests ORDER BY created_at DESC"
        )
        saved = [
            {
                "id": r[0], "name": r[1],
                "created_at": r[2] or "",
                "start_date": r[3], "end_date": r[4],
            }
            for r in cur.fetchall()
        ]
        conn.close()
        return jsonify(saved=saved)

    # POST — save a new named backtest
    data = request.get_json(force=True, silent=True) or {}
    name = str(data.get("name", "")).strip()
    if not name:
        conn.close()
        return jsonify(error="Name is required.")
    if len(name) > 200:
        conn.close()
        return jsonify(error="Name must be 200 characters or less.")
    rows_input = data.get("rows", [])
    start = str(data.get("start", ""))
    end = str(data.get("end", ""))
    rows_json = _json.dumps(rows_input)
    cur.execute(
        "INSERT INTO nav_erosion_saved_backtests (name, start_date, end_date, rows_json) "
        "VALUES (?, ?, ?, ?)",
        (name, start, end, rows_json),
    )
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify(ok=True, id=new_id)


@app.route("/api/nav-erosion-portfolio/saved/<int:saved_id>", methods=["GET", "PUT", "DELETE"])
def nav_erosion_portfolio_saved_item(saved_id):
    import json as _json
    conn = get_connection()
    cur = conn.cursor()

    if request.method == "DELETE":
        cur.execute("DELETE FROM nav_erosion_saved_backtests WHERE id = ?", (saved_id,))
        conn.commit()
        conn.close()
        return jsonify(ok=True)

    if request.method == "PUT":
        data = request.get_json(force=True, silent=True) or {}
        name = str(data.get("name", "")).strip()
        if not name:
            conn.close()
            return jsonify(error="Name is required.")
        if len(name) > 200:
            conn.close()
            return jsonify(error="Name must be 200 characters or less.")
        rows_input = data.get("rows", [])
        start = str(data.get("start", ""))
        end = str(data.get("end", ""))
        rows_json = _json.dumps(rows_input)
        cur.execute(
            "UPDATE nav_erosion_saved_backtests "
            "SET name=?, start_date=?, end_date=?, rows_json=?, created_at=CURRENT_TIMESTAMP "
            "WHERE id=?",
            (name, start, end, rows_json, saved_id),
        )
        conn.commit()
        conn.close()
        return jsonify(ok=True)

    # GET — load one saved backtest
    cur.execute(
        "SELECT name, start_date, end_date, rows_json "
        "FROM nav_erosion_saved_backtests WHERE id = ?",
        (saved_id,),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return jsonify(error="Not found."), 404
    return jsonify(
        name=row[0], start=row[1], end=row[2],
        rows=_json.loads(row[3]),
    )


@app.route("/api/nav-erosion-portfolio/data", methods=["POST"])
def nav_erosion_portfolio_data():
    import yfinance as yf
    import warnings
    warnings.filterwarnings("ignore")

    data = request.get_json(force=True, silent=True) or {}
    start_date = data.get("start", "")
    end_date = data.get("end", "")
    rows_input = data.get("rows", [])

    if not start_date or not end_date:
        return jsonify(error="Please select both start and end dates.")
    if not rows_input:
        return jsonify(error="No ETFs provided.")
    if len(rows_input) > 80:
        return jsonify(error="Maximum 80 ETFs allowed.")

    # Validate rows
    validated = []
    for i, r in enumerate(rows_input):
        ticker = str(r.get("ticker", "")).strip().upper()
        if not ticker:
            return jsonify(error=f"Row {i+1}: ticker is required.")
        try:
            amount = float(r.get("amount", 0))
        except (TypeError, ValueError):
            return jsonify(error=f"Row {i+1}: invalid amount.")
        if amount <= 0:
            return jsonify(error=f"Row {i+1}: amount must be greater than 0.")
        try:
            reinvest_pct = float(r.get("reinvest_pct", 0))
        except (TypeError, ValueError):
            return jsonify(error=f"Row {i+1}: invalid reinvest %.")
        if reinvest_pct < 0 or reinvest_pct > 100:
            return jsonify(error=f"Row {i+1}: reinvest % must be 0–100.")
        validated.append({"ticker": ticker, "amount": amount, "reinvest_pct": reinvest_pct})

    unique_tickers = list(dict.fromkeys(r["ticker"] for r in validated))

    # Batch download all tickers
    try:
        from datetime import datetime as _dt
        raw = yf.download(
            unique_tickers,
            start=start_date, end=end_date,
            interval="1d", auto_adjust=False, actions=True,
            group_by="ticker", progress=False,
        )
    except Exception as e:
        return jsonify(error=f"Failed to fetch data: {str(e)}")

    requested_start = _dt.strptime(start_date, "%Y-%m-%d").date()

    def get_ticker_df(sym):
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                top_keys = raw.columns.get_level_values(0).unique()
                if sym in top_keys:
                    sub = raw[sym]
                    close = sub["Close"] if "Close" in sub.columns else None
                    divs = sub["Dividends"] if "Dividends" in sub.columns else pd.Series(0.0, index=raw.index)
                elif "Close" in top_keys:
                    close = raw["Close"][sym] if sym in raw["Close"].columns else raw["Close"].iloc[:, 0]
                    divs_df = raw["Dividends"] if "Dividends" in top_keys else None
                    if divs_df is not None:
                        divs = divs_df[sym] if sym in divs_df.columns else pd.Series(0.0, index=raw.index)
                    else:
                        divs = pd.Series(0.0, index=raw.index)
                else:
                    return None, None
            else:
                close = raw["Close"] if "Close" in raw.columns else None
                divs = raw["Dividends"] if "Dividends" in raw.columns else pd.Series(0.0, index=raw.index)
        except Exception:
            return None, None
        if close is None:
            return None, None
        return close, divs

    results = []
    for r in validated:
        sym = r["ticker"]
        amount = r["amount"]
        reinvest_pct = r["reinvest_pct"]

        close, divs = get_ticker_df(sym)

        if close is None or close.dropna().empty:
            results.append({
                "ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                "error": f"No data found for {sym}.",
            })
            continue

        monthly_close = close.resample("ME").last()
        monthly_divs = divs.resample("ME").sum()

        df = pd.DataFrame({"price": monthly_close, "div": monthly_divs}).dropna(subset=["price"])
        df["div"] = df["div"].fillna(0.0)

        if df.empty:
            results.append({
                "ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                "error": f"No usable monthly data for {sym}.",
            })
            continue

        actual_start = df.index[0].date()
        warning = None
        if (actual_start - requested_start).days > 30:
            warning = (
                f"{sym} only has data going back to {actual_start.strftime('%B %d, %Y')}. "
                f"Results start from that date."
            )

        initial_price = float(df["price"].iloc[0])
        if initial_price == 0:
            results.append({
                "ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                "error": f"Initial price for {sym} is zero.",
            })
            continue

        current_shares = amount / initial_price
        cumul_dist = 0.0
        cumul_reinvested = 0.0
        cumul_divs_per_share = 0.0

        for dt, row in df.iterrows():
            price = float(row["price"])
            div_per_share = float(row["div"])
            total_dist = div_per_share * current_shares
            reinvest_amt = total_dist * reinvest_pct / 100.0
            shares_bought = (reinvest_amt / price) if price > 0 else 0.0
            current_shares += shares_bought
            cumul_dist += total_dist
            cumul_reinvested += reinvest_amt
            cumul_divs_per_share += div_per_share

        final_price = float(df["price"].iloc[-1])
        portfolio_val = current_shares * final_price
        breakeven_final = (amount / final_price) if final_price > 0 else 0.0
        final_deficit = breakeven_final - current_shares
        has_erosion_at_end = final_deficit > 0
        price_delta_pct = (final_price - initial_price) / initial_price * 100 if initial_price else 0.0
        gain_loss_dollar = portfolio_val - amount
        gain_loss_pct = gain_loss_dollar / amount * 100 if amount else 0.0
        cash_taken = cumul_dist - cumul_reinvested
        total_return_dollar = portfolio_val + cash_taken - amount
        total_return_pct = total_return_dollar / amount * 100 if amount else 0.0

        # Coverage ratio: (total price change + total divs per share) / total divs per share
        total_price_change = final_price - initial_price
        if cumul_divs_per_share > 0:
            coverage_ratio = round((total_price_change + cumul_divs_per_share) / cumul_divs_per_share, 4)
        else:
            coverage_ratio = None

        results.append({
            "ticker": sym,
            "amount": round(amount, 2),
            "reinvest_pct": round(reinvest_pct, 1),
            "start_price": round(initial_price, 4),
            "end_price": round(final_price, 4),
            "price_delta_pct": round(price_delta_pct, 2),
            "total_dist": round(cumul_dist, 2),
            "total_reinvested": round(cumul_reinvested, 2),
            "final_value": round(portfolio_val, 2),
            "gain_loss_dollar": round(gain_loss_dollar, 2),
            "gain_loss_pct": round(gain_loss_pct, 2),
            "total_return_dollar": round(total_return_dollar, 2),
            "total_return_pct": round(total_return_pct, 2),
            "has_erosion": has_erosion_at_end,
            "final_deficit": round(final_deficit, 4),
            "coverage_ratio": coverage_ratio,
            "warning": warning,
            "error": None,
        })

    return jsonify(results=results)


# ── Portfolio Income Simulator ─────────────────────────────────────────────────

@app.route("/api/pis/portfolio-tickers")
def pis_portfolio_tickers():
    """Return all live portfolio tickers for the picker modal."""
    pid = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        """SELECT ticker, description, classification_type,
                  purchase_value, reinvest, current_annual_yield
           FROM all_account_info
           WHERE current_price IS NOT NULL AND profile_id = ?
           ORDER BY ticker""",
        (pid,),
    ).fetchall()
    conn.close()
    tickers = [
        {
            "ticker": r[0],
            "description": r[1] or "",
            "type": r[2] or "",
            "amount": round(float(r[3] or 0), 2),
            "drip": (r[4] or "").upper() == "Y",
            "current_yield": round(float(r[5] or 0), 2),
        }
        for r in rows
    ]
    return jsonify(tickers=tickers)


@app.route("/api/pis/list", methods=["GET", "POST"])
def pis_list():
    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    if request.method == "GET":
        cur.execute(
            "SELECT ticker, amount, reinvest_pct, yield_override "
            "FROM portfolio_income_sim_list ORDER BY sort_order"
        )
        rows = [
            {"ticker": r[0], "amount": r[1], "reinvest_pct": r[2], "yield_override": r[3]}
            for r in cur.fetchall()
        ]
        conn.close()
        return jsonify(rows=rows)

    # POST — replace list
    data = request.get_json(force=True, silent=True) or {}
    rows = data.get("rows", [])
    if len(rows) > 80:
        conn.close()
        return jsonify(error="Maximum 80 ETFs allowed.")

    validated = []
    for i, r in enumerate(rows):
        ticker = str(r.get("ticker", "")).strip().upper()
        if not ticker:
            continue  # skip empty rows
        try:
            amount = float(r.get("amount", 0))
        except (TypeError, ValueError):
            conn.close()
            return jsonify(error=f"Row {i+1}: invalid amount.")
        if amount <= 0:
            conn.close()
            return jsonify(error=f"Row {i+1}: amount must be greater than 0.")
        try:
            reinvest_pct = float(r.get("reinvest_pct", 0))
        except (TypeError, ValueError):
            conn.close()
            return jsonify(error=f"Row {i+1}: invalid reinvest %.")
        if reinvest_pct < 0 or reinvest_pct > 100:
            conn.close()
            return jsonify(error=f"Row {i+1}: reinvest % must be 0–100.")
        yield_override = r.get("yield_override")
        if yield_override is not None and yield_override != "":
            try:
                yield_override = float(yield_override)
                if yield_override <= 0:
                    yield_override = None
            except (TypeError, ValueError):
                yield_override = None
        else:
            yield_override = None
        validated.append((ticker, amount, reinvest_pct, yield_override, len(validated)))

    cur.execute("DELETE FROM portfolio_income_sim_list")
    for ticker, amount, reinvest_pct, yield_override, sort_order in validated:
        cur.execute(
            "INSERT INTO portfolio_income_sim_list (ticker, amount, reinvest_pct, yield_override, sort_order) "
            "VALUES (?, ?, ?, ?, ?)",
            (ticker, amount, reinvest_pct, yield_override, sort_order),
        )
    conn.commit()
    conn.close()
    return jsonify(ok=True)


@app.route("/api/pis/saved", methods=["GET", "POST"])
def pis_saved():
    import json as _json
    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    if request.method == "GET":
        cur.execute(
            "SELECT id, name, created_at, mode, start_date, end_date, market_type, duration_months "
            "FROM portfolio_income_sim_saved ORDER BY created_at DESC"
        )
        saved = [
            {
                "id": r[0], "name": r[1], "created_at": r[2] or "",
                "mode": r[3], "start_date": r[4], "end_date": r[5],
                "market_type": r[6], "duration_months": r[7],
            }
            for r in cur.fetchall()
        ]
        conn.close()
        return jsonify(saved=saved)

    # POST — save new
    data = request.get_json(force=True, silent=True) or {}
    name = str(data.get("name", "")).strip()
    if not name:
        conn.close()
        return jsonify(error="Name is required.")
    if len(name) > 200:
        conn.close()
        return jsonify(error="Name must be 200 characters or less.")
    rows_input = data.get("rows", [])
    mode = str(data.get("mode", "historical"))
    start = str(data.get("start", ""))
    end = str(data.get("end", ""))
    market_type = str(data.get("market_type", ""))
    duration_months = data.get("duration_months")
    if duration_months is not None:
        try:
            duration_months = int(duration_months)
        except (TypeError, ValueError):
            duration_months = None
    rows_json = _json.dumps(rows_input)
    comparison_input = data.get("comparison_tickers", [])
    comparison_json = _json.dumps(comparison_input) if comparison_input else None
    cur.execute(
        "INSERT INTO portfolio_income_sim_saved "
        "(name, mode, start_date, end_date, market_type, duration_months, rows_json, comparison_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (name, mode, start, end, market_type, duration_months, rows_json, comparison_json),
    )
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify(ok=True, id=new_id)


@app.route("/api/pis/saved/<int:saved_id>", methods=["GET", "PUT", "DELETE"])
def pis_saved_item(saved_id):
    import json as _json
    conn = get_connection()
    cur = conn.cursor()

    if request.method == "DELETE":
        cur.execute("DELETE FROM portfolio_income_sim_saved WHERE id = ?", (saved_id,))
        conn.commit()
        conn.close()
        return jsonify(ok=True)

    if request.method == "PUT":
        data = request.get_json(force=True, silent=True) or {}
        name = str(data.get("name", "")).strip()
        if not name:
            conn.close()
            return jsonify(error="Name is required.")
        if len(name) > 200:
            conn.close()
            return jsonify(error="Name must be 200 characters or less.")
        rows_input = data.get("rows", [])
        mode = str(data.get("mode", "historical"))
        start = str(data.get("start", ""))
        end = str(data.get("end", ""))
        market_type = str(data.get("market_type", ""))
        duration_months = data.get("duration_months")
        if duration_months is not None:
            try:
                duration_months = int(duration_months)
            except (TypeError, ValueError):
                duration_months = None
        rows_json = _json.dumps(rows_input)
        comparison_input = data.get("comparison_tickers", [])
        comparison_json = _json.dumps(comparison_input) if comparison_input else None
        cur.execute(
            "UPDATE portfolio_income_sim_saved "
            "SET name=?, mode=?, start_date=?, end_date=?, market_type=?, "
            "    duration_months=?, rows_json=?, comparison_json=?, created_at=CURRENT_TIMESTAMP "
            "WHERE id=?",
            (name, mode, start, end, market_type, duration_months, rows_json, comparison_json, saved_id),
        )
        conn.commit()
        conn.close()
        return jsonify(ok=True)

    # GET
    cur.execute(
        "SELECT name, mode, start_date, end_date, market_type, duration_months, rows_json, comparison_json "
        "FROM portfolio_income_sim_saved WHERE id = ?",
        (saved_id,),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return jsonify(error="Not found."), 404
    comparison = _json.loads(row[7]) if row[7] else []
    return jsonify(
        name=row[0], mode=row[1], start=row[2], end=row[3],
        market_type=row[4], duration_months=row[5],
        rows=_json.loads(row[6]),
        comparison_tickers=comparison,
    )


@app.route("/api/pis/run", methods=["POST"])
def pis_run():
    import traceback as _tb
    try:
        return _pis_run_inner()
    except Exception as _e:
        return jsonify(error=f"Server error: {str(_e)}", detail=_tb.format_exc())


def _pis_run_inner():
    import yfinance as yf
    import numpy as np
    import warnings
    warnings.filterwarnings("ignore")

    data = request.get_json(force=True, silent=True) or {}
    mode = data.get("mode", "historical")
    rows_input = data.get("rows", [])
    # comparison_tickers: accept either strings or {ticker, reinvest_pct, amount} objects
    raw_comp = data.get("comparison_tickers", [])
    comparison_tickers = []
    for ct in raw_comp:
        if isinstance(ct, dict):
            t = str(ct.get("ticker", "")).strip().upper()
            rp = float(ct.get("reinvest_pct", 0))
            amt = float(ct.get("amount", 10000))
            yo = ct.get("yield_override", None)
            if yo is not None:
                try:
                    yo = float(yo)
                except (ValueError, TypeError):
                    yo = None
            if t:
                comparison_tickers.append({"ticker": t, "reinvest_pct": max(0.0, min(100.0, rp)), "amount": max(1.0, amt), "yield_override": yo})
        elif isinstance(ct, str) and ct.strip():
            comparison_tickers.append({"ticker": ct.strip().upper(), "reinvest_pct": 0.0, "amount": 10000.0, "yield_override": None})

    if not rows_input and not comparison_tickers:
        return jsonify(error="No ETFs provided.")
    if len(rows_input) > 80:
        return jsonify(error="Maximum 80 ETFs allowed.")

    # Validate portfolio rows
    validated = []
    for i, r in enumerate(rows_input):
        ticker = str(r.get("ticker", "")).strip().upper()
        if not ticker:
            continue
        try:
            amount = float(r.get("amount", 0))
        except (TypeError, ValueError):
            return jsonify(error=f"Row {i+1}: invalid amount.")
        if amount <= 0:
            return jsonify(error=f"Row {i+1}: amount must be greater than 0.")
        try:
            reinvest_pct = float(r.get("reinvest_pct", 0))
        except (TypeError, ValueError):
            return jsonify(error=f"Row {i+1}: invalid reinvest %.")
        if reinvest_pct < 0 or reinvest_pct > 100:
            return jsonify(error=f"Row {i+1}: reinvest % must be 0–100.")
        yield_override = r.get("yield_override")
        if yield_override is not None and yield_override != "":
            try:
                yield_override = float(yield_override)
                if yield_override <= 0:
                    yield_override = None
            except (TypeError, ValueError):
                yield_override = None
        else:
            yield_override = None
        validated.append({
            "ticker": ticker, "amount": amount,
            "reinvest_pct": reinvest_pct, "yield_override": yield_override,
            "is_comparison": False,
        })

    # Add comparison tickers (normalized $10,000, per-ticker reinvest %)
    reinvest_compare = data.get("reinvest_compare", False)
    reinvest_compare_pct = float(data.get("reinvest_compare_pct", 50))

    for ct in comparison_tickers:
        validated.append({
            "ticker": ct["ticker"], "amount": ct["amount"],
            "reinvest_pct": ct["reinvest_pct"], "yield_override": ct["yield_override"],
            "is_comparison": True,
        })

    if not validated:
        return jsonify(error="No valid ETFs to process.")

    unique_tickers = list(dict.fromkeys(r["ticker"] for r in validated))

    # ── HISTORICAL MODE ──────────────────────────────────────────────────────
    if mode == "historical":
        start_date = data.get("start", "")
        end_date = data.get("end", "")
        if not start_date or not end_date:
            return jsonify(error="Please select both start and end dates.")

        try:
            from datetime import datetime as _dt
            raw = yf.download(
                unique_tickers,
                start=start_date, end=end_date,
                interval="1d", auto_adjust=False, actions=True,
                group_by="ticker", progress=False,
            )
        except Exception as e:
            return jsonify(error=f"Failed to fetch data: {str(e)}")

        requested_start = _dt.strptime(start_date, "%Y-%m-%d").date()

        def get_ticker_df(sym):
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    top_keys = raw.columns.get_level_values(0).unique()
                    if sym in top_keys:
                        sub = raw[sym]
                        close = sub["Close"] if "Close" in sub.columns else None
                        divs = sub["Dividends"] if "Dividends" in sub.columns else pd.Series(0.0, index=raw.index)
                    elif "Close" in top_keys:
                        close = raw["Close"][sym] if sym in raw["Close"].columns else raw["Close"].iloc[:, 0]
                        divs_df = raw["Dividends"] if "Dividends" in top_keys else None
                        if divs_df is not None:
                            divs = divs_df[sym] if sym in divs_df.columns else pd.Series(0.0, index=raw.index)
                        else:
                            divs = pd.Series(0.0, index=raw.index)
                    else:
                        return None, None
                else:
                    close = raw["Close"] if "Close" in raw.columns else None
                    divs = raw["Dividends"] if "Dividends" in raw.columns else pd.Series(0.0, index=raw.index)
            except Exception:
                return None, None
            if close is None:
                return None, None
            return close, divs

        def _run_hist_sim(df, amount, reinvest_pct):
            initial_price = float(df["price"].iloc[0])
            current_shares = amount / initial_price
            cumul_dist = 0.0
            cumul_reinvested = 0.0
            m_prices, m_vals, m_divs = [], [], []
            for _, row in df.iterrows():
                price = float(row["price"])
                div_per_share = float(row["div"])
                total_dist_m = div_per_share * current_shares
                reinvest_amt = total_dist_m * reinvest_pct / 100.0
                shares_bought = (reinvest_amt / price) if price > 0 else 0.0
                current_shares += shares_bought
                cumul_dist += total_dist_m
                cumul_reinvested += reinvest_amt
                m_prices.append(round(price, 4))
                m_vals.append(round(current_shares * price, 2))
                m_divs.append(round(total_dist_m, 2))
            final_price = float(df["price"].iloc[-1])
            portfolio_val = current_shares * final_price
            breakeven_final = (amount / final_price) if final_price > 0 else 0.0
            final_deficit = breakeven_final - current_shares
            price_delta_pct = (final_price - initial_price) / initial_price * 100 if initial_price else 0.0
            gain_loss_dollar = portfolio_val - amount
            gain_loss_pct = gain_loss_dollar / amount * 100 if amount else 0.0
            effective_yield_pct = cumul_dist / amount * 100 if amount else 0.0
            return {
                "initial_price": initial_price, "final_price": final_price,
                "price_delta_pct": price_delta_pct, "cumul_dist": cumul_dist,
                "cumul_reinvested": cumul_reinvested, "portfolio_val": portfolio_val,
                "gain_loss_dollar": gain_loss_dollar, "gain_loss_pct": gain_loss_pct,
                "effective_yield_pct": effective_yield_pct, "has_erosion": final_deficit > 0,
                "final_deficit": final_deficit,
                "m_prices": m_prices, "m_vals": m_vals, "m_divs": m_divs,
            }

        results = []
        for r in validated:
            sym = r["ticker"]
            amount = r["amount"]
            reinvest_pct = r["reinvest_pct"]

            close, divs = get_ticker_df(sym)

            if close is None or close.dropna().empty:
                results.append({"ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                                "is_comparison": r["is_comparison"],
                                "error": f"No data found for {sym}.",
                                "monthly_prices": [], "monthly_portfolio_vals": [], "monthly_dividends": []})
                continue

            monthly_close = close.resample("ME").last()
            monthly_divs = divs.resample("ME").sum()
            df = pd.DataFrame({"price": monthly_close, "div": monthly_divs}).dropna(subset=["price"])
            df["div"] = df["div"].fillna(0.0)

            if df.empty:
                results.append({"ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                                "is_comparison": r["is_comparison"],
                                "error": f"No usable monthly data for {sym}.",
                                "monthly_prices": [], "monthly_portfolio_vals": [], "monthly_dividends": []})
                continue

            actual_start = df.index[0].date()
            warning = None
            if (actual_start - requested_start).days > 30:
                warning = (
                    f"{sym} only has data going back to {actual_start.strftime('%B %d, %Y')}. "
                    f"Results start from that date."
                )

            initial_price = float(df["price"].iloc[0])
            if initial_price == 0:
                results.append({"ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                                "is_comparison": r["is_comparison"],
                                "error": f"Initial price for {sym} is zero.",
                                "monthly_prices": [], "monthly_portfolio_vals": [], "monthly_dividends": []})
                continue

            date_labels = [dt.strftime("%Y-%m") for dt in df.index]

            # Determine which reinvest runs to perform
            # Comparison tickers use their own per-ticker reinvest_pct (single run)
            if reinvest_compare and not r["is_comparison"]:
                runs = [
                    (0.0, "baseline"),
                    (reinvest_compare_pct, "reinvested"),
                ]
            else:
                runs = [(reinvest_pct, None)]

            for run_pct, compare_group in runs:
                s = _run_hist_sim(df, amount, run_pct)
                rec = {
                    "ticker": sym,
                    "is_comparison": r["is_comparison"],
                    "amount": round(amount, 2),
                    "reinvest_pct": round(run_pct, 1),
                    "start_price": round(s["initial_price"], 4),
                    "end_price": round(s["final_price"], 4),
                    "price_delta_pct": round(s["price_delta_pct"], 2),
                    "total_dist": round(s["cumul_dist"], 2),
                    "total_reinvested": round(s["cumul_reinvested"], 2),
                    "final_value": round(s["portfolio_val"], 2),
                    "gain_loss_dollar": round(s["gain_loss_dollar"], 2),
                    "gain_loss_pct": round(s["gain_loss_pct"], 2),
                    "effective_yield_pct": round(s["effective_yield_pct"], 2),
                    "ttm_yield_pct": None,
                    "has_erosion": s["has_erosion"],
                    "final_deficit": round(s["final_deficit"], 4),
                    "monthly_prices": s["m_prices"],
                    "monthly_portfolio_vals": s["m_vals"],
                    "monthly_dividends": s["m_divs"],
                    "date_labels": date_labels,
                    "warning": warning,
                    "error": None,
                }
                if compare_group is not None:
                    rec["compare_group"] = compare_group
                results.append(rec)

        return jsonify(results=results)

    # ── SIMULATION MODE ──────────────────────────────────────────────────────
    if mode == "simulate":
        market_type = data.get("market_type", "neutral")
        duration_months = int(data.get("duration_months", 36))
        if duration_months < 1 or duration_months > 600:
            return jsonify(error="Duration must be between 1 and 600 months.")

        bias_map = {"bullish": +0.010, "bearish": -0.015, "neutral": 0.0}
        vol_mult_map = {"bullish": 0.9, "bearish": 1.2, "neutral": 1.0}
        bias = bias_map.get(market_type, 0.0)
        vol_mult = vol_mult_map.get(market_type, 1.0)

        results = []
        for r in validated:
            sym = r["ticker"]
            amount = r["amount"]
            reinvest_pct = r["reinvest_pct"]
            yo = r["yield_override"]

            try:
                hist = yf.Ticker(sym).history(period="1y", auto_adjust=False, actions=True)
            except Exception as e:
                results.append({"ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                                "is_comparison": r["is_comparison"],
                                "error": f"Failed to fetch data for {sym}: {str(e)}",
                                "monthly_prices": [], "monthly_portfolio_vals": [], "monthly_dividends": []})
                continue

            if hist is None or hist.empty:
                results.append({"ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                                "is_comparison": r["is_comparison"],
                                "error": f"No data found for {sym}.",
                                "monthly_prices": [], "monthly_portfolio_vals": [], "monthly_dividends": []})
                continue

            close = hist["Close"]
            divs = hist["Dividends"] if "Dividends" in hist.columns else pd.Series(0.0, index=hist.index)

            if close.dropna().empty:
                results.append({"ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                                "is_comparison": r["is_comparison"],
                                "error": f"No data found for {sym}.",
                                "monthly_prices": [], "monthly_portfolio_vals": [], "monthly_dividends": []})
                continue

            current_price = float(close.dropna().iloc[-1])
            if current_price <= 0:
                results.append({"ticker": sym, "amount": amount, "reinvest_pct": reinvest_pct,
                                "is_comparison": r["is_comparison"],
                                "error": f"Could not determine current price for {sym}.",
                                "monthly_prices": [], "monthly_portfolio_vals": [], "monthly_dividends": []})
                continue

            # TTM yield
            if yo is not None:
                ttm_yield = yo / 100.0
            else:
                ttm_divs_sum = float(divs.sum()) if divs is not None else 0.0
                ttm_yield = ttm_divs_sum / current_price if current_price > 0 else 0.0

            # Historical monthly return statistics
            monthly_returns = close.dropna().resample("ME").last().pct_change().dropna()
            if len(monthly_returns) >= 2:
                hist_sigma = float(monthly_returns.std())
                hist_mu = float(monthly_returns.mean())
            else:
                hist_sigma = 0.05
                hist_mu = 0.0

            # Historical skewness (captures covered-call truncated upside, etc.)
            if len(monthly_returns) >= 12:
                hist_skew = float(monthly_returns.skew())
                hist_kurt = float(monthly_returns.kurtosis())  # excess kurtosis
            else:
                hist_skew = 0.0
                hist_kurt = 0.0

            # Use ticker's own historical drift + market bias overlay
            mu = hist_mu + bias
            sigma = hist_sigma * vol_mult
            SIGMA_CAP = 0.25
            sigma_capped = sigma > SIGMA_CAP
            sigma = min(sigma, SIGMA_CAP)

            # Monte-Carlo GBM — 300 paths with skew-adjusted returns
            N_PATHS = 300
            drift = mu - 0.5 * sigma ** 2
            np.random.seed(None)
            Z = np.random.normal(0.0, 1.0, (N_PATHS, duration_months))
            # Cornish-Fisher expansion: adjust for skewness and excess kurtosis
            # This transforms normal draws to approximate the historical return shape
            skew_c = max(-2.0, min(2.0, hist_skew))   # clamp to avoid extreme distortion
            kurt_c = max(-2.0, min(7.0, hist_kurt))
            Z_adj = (Z
                     + (skew_c / 6.0) * (Z ** 2 - 1)
                     + (kurt_c / 24.0) * (Z ** 3 - 3 * Z)
                     - (skew_c ** 2 / 36.0) * (2 * Z ** 3 - 5 * Z))
            log_rets = drift + sigma * Z_adj
            cum_log = np.cumsum(
                np.hstack([np.zeros((N_PATHS, 1)), log_rets]), axis=1
            )
            price_floor = max(current_price * 0.0001, 1e-10)
            price_matrix = np.maximum(current_price * np.exp(cum_log), price_floor)
            prices = [float(v) for v in np.median(price_matrix, axis=0)]

            # Helper: simulate month-by-month for a given reinvest_pct
            def _run_fwd_sim(prices_arr, amount_v, reinvest_pct_v, ttm_yield_v, cur_price):
                initial_shares = amount_v / cur_price
                cs = initial_shares
                cd = 0.0; cr = 0.0
                mp, mv, md = [], [], []
                for price in prices_arr[1:]:
                    pct_chg = (price - cur_price) / cur_price * 100
                    if pct_chg >= 10:
                        factor = min(1.0 + (pct_chg - 10) * 0.02, 1.30)
                    elif pct_chg >= -10:
                        factor = 1.0
                    elif pct_chg >= -20:
                        factor = 0.85
                    elif pct_chg >= -30:
                        factor = 0.70
                    else:
                        factor = max(0.40, 1.0 + pct_chg * 0.02)
                    dist_ps = (ttm_yield_v / 12) * cur_price * factor
                    total_d = dist_ps * cs
                    ra = total_d * (reinvest_pct_v / 100)
                    sb = ra / price if price > 0 else 0.0
                    cs += sb; cd += total_d; cr += ra
                    mp.append(round(price, 4))
                    mv.append(round(cs * price, 2))
                    md.append(round(total_d, 2))
                fp = prices_arr[-1]
                fv = cs * fp
                be = amount_v / fp if fp else 0.0
                fd = be - cs
                return {
                    "final_price": fp, "final_value": fv, "final_deficit": fd,
                    "cumul_dist": cd, "cumul_reinvested": cr,
                    "gain_loss_dollar": fv - amount_v,
                    "gain_loss_pct": (fv - amount_v) / amount_v * 100 if amount_v else 0.0,
                    "eff_yield_pct": cd / amount_v * 100 if amount_v else 0.0,
                    "has_erosion": bool(fd > 0),
                    "mp": mp, "mv": mv, "md": md,
                }

            date_labels = [f"Month {i+1}" for i in range(duration_months)]
            price_delta_pct = (prices[-1] - current_price) / current_price * 100 if current_price else 0.0
            sim_warning = (
                f"{sym} has extreme historical volatility; monthly sigma was capped "
                f"at 25% (raw: {hist_sigma * vol_mult * 100:.0f}%) to prevent "
                f"unrealistic simulation outcomes."
            ) if sigma_capped else None

            # Pass per-ticker historical stats for transparency
            sim_stats = {
                "hist_mean_monthly": round(hist_mu * 100, 2),
                "hist_sigma_monthly": round(hist_sigma * 100, 2),
                "hist_skewness": round(hist_skew, 2) if len(monthly_returns) >= 12 else None,
            }

            # Determine which reinvest runs to perform
            # Comparison tickers use their own per-ticker reinvest_pct (single run)
            if reinvest_compare and not r["is_comparison"]:
                runs = [
                    (0.0, "baseline"),
                    (reinvest_compare_pct, "reinvested"),
                ]
            else:
                runs = [(reinvest_pct, None)]

            for run_pct, compare_group in runs:
                s = _run_fwd_sim(prices, amount, run_pct, ttm_yield, current_price)
                rec = {
                    "ticker": sym,
                    "is_comparison": r["is_comparison"],
                    "amount": round(amount, 2),
                    "reinvest_pct": round(run_pct, 1),
                    "start_price": round(current_price, 4),
                    "end_price": round(s["final_price"], 4),
                    "price_delta_pct": round(price_delta_pct, 2),
                    "total_dist": round(s["cumul_dist"], 2),
                    "total_reinvested": round(s["cumul_reinvested"], 2),
                    "final_value": round(s["final_value"], 2),
                    "gain_loss_dollar": round(s["gain_loss_dollar"], 2),
                    "gain_loss_pct": round(s["gain_loss_pct"], 2),
                    "effective_yield_pct": round(s["eff_yield_pct"], 2),
                    "ttm_yield_pct": round(ttm_yield * 100, 2),
                    "has_erosion": s["has_erosion"],
                    "final_deficit": round(s["final_deficit"], 4),
                    "monthly_prices": s["mp"],
                    "monthly_portfolio_vals": s["mv"],
                    "monthly_dividends": s["md"],
                    "date_labels": date_labels,
                    "warning": sim_warning,
                    "sim_stats": sim_stats,
                    "error": None,
                }
                if compare_group is not None:
                    rec["compare_group"] = compare_group
                results.append(rec)

        return jsonify(results=results)

    return jsonify(error=f"Unknown mode: {mode}")


# ── Portfolio Analytics ─────────────────────────────────────────────────────────

def _portfolio_sharpe(weights, returns_df, risk_free_annual=0.05):
    import numpy as np
    port_ret = returns_df.dot(weights)
    daily_rf = risk_free_annual / 252
    excess = float(port_ret.mean()) - daily_rf
    std = float(port_ret.std())
    if std == 0:
        return 0.0
    return excess / std * np.sqrt(252)


def _portfolio_max_dd(weights, returns_df):
    port_ret = returns_df.dot(weights)
    cum = (1 + port_ret).cumprod()
    running_max = cum.cummax()
    dd = (cum - running_max) / running_max
    return float(dd.min())


def _portfolio_sortino(w, returns_df):
    """Annualized Sortino ratio for a portfolio with given weights."""
    import numpy as np
    r_p = returns_df.values @ w
    rf_daily = 0.05 / 252
    excess = r_p - rf_daily
    neg = r_p[r_p < 0]
    down_std = float(neg.std()) if len(neg) > 1 else 1e-6
    return (float(excess.mean()) / max(down_std, 1e-6)) * np.sqrt(252)


def _optimize_sharpe(returns_df, current_weights=None, weight_caps=None, turnover_penalty=0.15):
    """Maximize returns using 60% Sharpe + 40% Sortino blend.
    Respects current weights (partial sells), NAV caps, and turnover penalty.
    """
    import numpy as np
    from scipy.optimize import minimize
    n = returns_df.shape[1]
    if current_weights is None:
        current_weights = np.ones(n) / n
    cw = np.array(current_weights)
    if weight_caps is None:
        weight_caps = [0.40] * n
    bounds = []
    for i in range(n):
        cap = weight_caps[i]
        if cap <= 0:
            bounds.append((0.0, 0.0))
        else:
            floor = cw[i] * 0.25 if cw[i] > 0.005 else 0.0
            bounds.append((floor, min(cap, 0.40)))
    n_current = int(np.sum(cw > 0.005))
    def neg_objective(w):
        sharpe = _portfolio_sharpe(w, returns_df)
        sortino = _portfolio_sortino(w, returns_df)
        norm_sharpe = min(max(sharpe, 0), 4) / 4.0
        norm_sortino = min(max(sortino, 0), 6) / 6.0
        score = 0.6 * norm_sharpe + 0.4 * norm_sortino
        turnover = float(np.sum(np.abs(w - cw)))
        n_active = float(np.sum(w > 0.005))
        diversification_loss = max(0, n_current - n_active) * 0.01
        return -(score - turnover_penalty * turnover - diversification_loss)
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1}]
    init = _clamp_and_normalize(cw, bounds)
    best = None
    starts = [init]
    rng = np.random.default_rng(42)
    for _ in range(4):
        d = rng.dirichlet(np.ones(n))
        starts.append(_clamp_and_normalize(d, bounds))
    for w0 in starts:
        try:
            res = minimize(neg_objective, w0, method="SLSQP", bounds=bounds,
                           constraints=constraints, options={"maxiter": 1000})
            if res.success and (best is None or res.fun < best.fun):
                best = res
        except Exception:
            pass
    if best is None:
        return init
    return _clamp_and_normalize(best.x, bounds)


def _compute_nav_erosion(close_df, tickers, trading_days=252):
    """Compute annualized price return per ticker. Negative = NAV erosion."""
    import numpy as np
    erosion = {}
    for t in tickers:
        if t not in close_df.columns:
            erosion[t] = 0.0
            continue
        s = close_df[t].dropna()
        if len(s) < 2:
            erosion[t] = 0.0
            continue
        total_ret = float(s.iloc[-1] / s.iloc[0]) - 1.0
        n_days = len(s)
        ann_ret = (1 + total_ret) ** (trading_days / max(n_days, 1)) - 1.0
        erosion[t] = ann_ret
    return erosion


def _adjust_yields_for_nav(yields, nav_returns, tickers):
    """Produce effective yields: yield + nav_return (clamped so minimum is 0).
    A fund yielding 40% but losing 30% NAV has effective yield of 10%.
    A fund yielding 5% with 10% NAV growth keeps its 5% yield (we don't boost beyond raw yield)."""
    import numpy as np
    adjusted = []
    for i, t in enumerate(tickers):
        raw_yield = yields[i]
        nav_ret = nav_returns.get(t, 0.0)
        if nav_ret < 0:
            # Penalize: effective yield = raw yield + nav return (which is negative)
            eff = max(raw_yield + nav_ret, 0.0)
        else:
            # Don't boost yield for price appreciation — that's captured by Sharpe/returns
            eff = raw_yield
        adjusted.append(eff)
    return adjusted


def _nav_weight_caps(nav_returns, tickers, severe=-0.30, moderate=-0.15):
    """Return per-ticker upper weight bounds based on NAV erosion severity.
    Severe erosion (>30% annualized loss): cap at 5%
    Moderate erosion (>15%): cap at 15%
    Otherwise: up to 100%"""
    caps = []
    for t in tickers:
        nav = nav_returns.get(t, 0.0)
        if nav <= severe:
            caps.append(0.05)
        elif nav <= moderate:
            caps.append(0.15)
        else:
            caps.append(1.0)
    return caps


def _clamp_and_normalize(w, bounds):
    """Enforce bounds and renormalize weights."""
    import numpy as np
    w = np.array(w, dtype=float)
    for i, (lo, hi) in enumerate(bounds):
        w[i] = max(lo, min(hi, w[i]))
    s = w.sum()
    if s > 0:
        w = w / s
        # Re-clamp after normalization (may shift slightly)
        for i, (lo, hi) in enumerate(bounds):
            w[i] = max(lo, min(hi, w[i]))
    return w


def _portfolio_income_score(w, returns_df_values, mu, rf_daily=0.05/252):
    """Composite quality score from Sortino, Omega, Calmar, Ulcer Index.
    All inputs are numpy arrays for speed. Returns 0-1 score (higher = better).
    """
    import numpy as np
    r_p = returns_df_values @ w
    n_days = len(r_p)
    if n_days < 30:
        return 0.0
    # Sortino
    excess_daily = r_p - rf_daily
    neg = r_p[r_p < 0]
    down_std = float(neg.std()) if len(neg) > 1 else 1e-6
    sortino = (float(excess_daily.mean()) / max(down_std, 1e-6)) * np.sqrt(252)
    norm_sortino = max(0, min(sortino, 4)) / 4.0
    # Omega
    gains = float(excess_daily[excess_daily > 0].sum())
    losses = abs(float(excess_daily[excess_daily <= 0].sum()))
    omega = gains / max(losses, 1e-8)
    norm_omega = max(0, min(omega, 3) - 0.5) / 2.5
    # Calmar
    cum = np.cumprod(1 + r_p)
    ann_ret = float(cum[-1] ** (252 / n_days) - 1)
    running_max = np.maximum.accumulate(cum)
    dd = (cum - running_max) / np.where(running_max > 0, running_max, 1)
    mdd = abs(float(dd.min()))
    calmar = ann_ret / max(mdd, 1e-6) if ann_ret > 0 else 0
    norm_calmar = max(0, min(calmar, 5)) / 5.0
    # Ulcer Index (lower = better)
    pct_dd = ((cum - running_max) / np.where(running_max > 0, running_max, 1)) * 100
    ulcer = float(np.sqrt((pct_dd ** 2).mean()))
    norm_ulcer = 1.0 - max(0, min(ulcer, 30)) / 30.0
    # Weighted composite: Ulcer 30%, Calmar 25%, Omega 25%, Sortino 20%
    return 0.30 * norm_ulcer + 0.25 * norm_calmar + 0.25 * norm_omega + 0.20 * norm_sortino


def _optimize_income(returns_df, yields, current_weights=None, weight_caps=None, turnover_penalty=0.2, nav_penalties=None):
    """Maximize income: blend yield and income-quality score (Sortino/Omega/Calmar/Ulcer).
    Uses 5 optimizer starts and a 20% per-holding cap to force diversification.
    nav_penalties: per-ticker penalty for NAV erosion.
    """
    import numpy as np
    from scipy.optimize import minimize
    n = returns_df.shape[1]
    mu = returns_df.mean().values * 252
    yields_arr = np.array(yields)
    target_yield = 0.15  # normalize against 15% target, not max ticker yield
    if current_weights is None:
        current_weights = np.ones(n) / n
    cw = np.array(current_weights)
    nav_pen = np.array(nav_penalties) if nav_penalties is not None else np.zeros(n)
    # Build bounds: partial sells (floor at 25% of current), zero-cap respected, 20% per-holding cap
    if weight_caps is None:
        weight_caps = [0.20] * n
    bounds = []
    for i in range(n):
        cap = weight_caps[i]
        if cap <= 0:
            bounds.append((0.0, 0.0))
        else:
            floor = cw[i] * 0.25 if cw[i] > 0.005 else 0.0
            bounds.append((floor, min(cap, 0.20)))
    n_current = int(np.sum(cw > 0.005))
    # Precompute returns matrix for income score
    ret_vals = returns_df.values
    ret_mu = mu  # already computed above
    # Income-focused blend: 70% yield, 30% income quality (Sortino/Omega/Calmar/Ulcer)
    import math
    blend = 0.7
    def neg_objective(w):
        port_yield = float(yields_arr @ w)
        # Log-scale: always rewards more yield but with diminishing returns
        # At 15%→0.69, 30%→1.10, 50%→1.50 — prevents extreme yields from dominating
        norm_yield = math.log(1.0 + port_yield / target_yield) if port_yield > 0 else 0.0
        quality = _portfolio_income_score(w, ret_vals, ret_mu)
        nav_cost = float(w.dot(nav_pen))
        turnover = float(np.sum(np.abs(w - cw)))
        n_active = float(np.sum(w > 0.005))
        diversification_loss = max(0, n_current - n_active) * 0.03
        hhi = float((w ** 2).sum())
        concentration_penalty = hhi * 0.15
        return -(blend * norm_yield + (1.0 - blend) * quality - turnover_penalty * turnover - diversification_loss - nav_cost - concentration_penalty)
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1}]
    init = _clamp_and_normalize(cw, bounds)
    best = None
    starts = [init]
    rng = np.random.default_rng(42)
    for _ in range(4):
        d = rng.dirichlet(np.ones(n))
        starts.append(_clamp_and_normalize(d, bounds))
    for w0 in starts:
        try:
            res = minimize(neg_objective, w0, method="SLSQP", bounds=bounds,
                           constraints=constraints, options={"maxiter": 500, "ftol": 1e-8})
            if res.success and (best is None or res.fun < best.fun):
                best = res
        except Exception:
            pass
    if best is None:
        return init
    return _clamp_and_normalize(best.x, bounds)


def _optimize_balanced(returns_df, yields, balance=0.5, current_weights=None, min_sharpe=0.8, max_dd=-0.20, weight_caps=None, turnover_penalty=0.3, nav_penalties=None):
    """Balanced optimization: slider controls yield vs safety blend.
    balance=1.0 → pure yield focus.
    balance=0.0 → pure safety focus (income quality: Sortino/Omega/Calmar/Ulcer).
    balance=0.5 → equal blend (default).
    Enforces quality floor penalty scaled by (1-balance), heavier turnover penalty.
    nav_penalties: per-ticker penalty for NAV erosion (higher = worse, 0 = no erosion).
    """
    import numpy as np
    from scipy.optimize import minimize
    n = returns_df.shape[1]
    yields_arr = np.array(yields)
    target_yield = 0.15  # normalize against 15% target, not max ticker yield
    if current_weights is None:
        current_weights = np.ones(n) / n
    cw = np.array(current_weights)
    mu = returns_df.mean().values * 252
    ret_vals = returns_df.values
    nav_pen = np.array(nav_penalties) if nav_penalties is not None else np.zeros(n)
    import math
    # Dynamic per-holding cap: 10% at safety end (balance=0), 20% at income end (balance=1)
    max_per_holding = 0.10 + 0.10 * balance
    if weight_caps is None:
        weight_caps = [max_per_holding] * n
    bounds = []
    for i in range(n):
        cap = weight_caps[i]
        if cap <= 0:
            bounds.append((0.0, 0.0))
        else:
            floor = cw[i] * 0.25 if cw[i] > 0.005 else 0.0
            bounds.append((floor, min(cap, max_per_holding)))
    n_current = int(np.sum(cw > 0.005))
    def neg_objective(w):
        port_yield = float(w.dot(yields_arr))
        # Log-scale: always rewards more yield but with diminishing returns
        norm_yield = math.log(1.0 + port_yield / target_yield) if port_yield > 0 else 0.0
        quality = _portfolio_income_score(w, ret_vals, mu)
        # NAV erosion penalty: scaled by balance (softer when income-focused)
        nav_scale = 1.0 - 0.5 * balance
        nav_cost = float(w.dot(nav_pen)) * nav_scale
        # Slider blend: balance toward yield, (1-balance) toward income quality
        blended = balance * norm_yield + (1.0 - balance) * quality
        # Safety penalty: quality floor enforced, scaled by safety focus
        safety_penalty = max(0, 0.4 - quality) * 2.0 * (1.0 - balance)
        turnover = float(np.sum(np.abs(w - cw)))
        n_active = float(np.sum(w > 0.005))
        diversification_loss = max(0, n_current - n_active) * 0.03
        hhi = float((w ** 2).sum())
        concentration_penalty = hhi * 0.15
        return -(blended - turnover_penalty * turnover - safety_penalty - diversification_loss - nav_cost - concentration_penalty)
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1}]
    init = _clamp_and_normalize(cw, bounds)
    best = None
    starts = [init]
    rng = np.random.default_rng(42)
    for _ in range(3):
        d = rng.dirichlet(np.ones(n))
        starts.append(_clamp_and_normalize(d, bounds))
    for w0 in starts:
        try:
            res = minimize(neg_objective, w0, method="SLSQP", bounds=bounds,
                           constraints=constraints, options={"maxiter": 500, "ftol": 1e-8})
            if res.success and (best is None or res.fun < best.fun):
                best = res
        except Exception:
            pass
    if best is None:
        return init
    return _clamp_and_normalize(best.x, bounds)


def _before_after_comparison(returns_df, opt_weights, bench_ret,
                              port_metrics_before, curr_income, opt_income,
                              current_weights=None, coverage_map=None,
                              available_tickers=None):
    """Compute before/after grade, income, coverage, and key metrics.
    Uses already-computed port_metrics and income values from the optimization branch
    so numbers match exactly what's shown in the optimization summary.
    If weights are essentially unchanged, reuses before metrics to avoid grading noise."""
    import numpy as np
    from grading import grade_portfolio
    pm = port_metrics_before or {}
    grade_before = pm.get("grade", {})

    # Compute weighted coverage for current and optimal weights
    def _weighted_coverage(weights_arr):
        if coverage_map is None or available_tickers is None:
            return None
        total_w = 0.0
        weighted_sum = 0.0
        for i, t in enumerate(available_tickers):
            cov = coverage_map.get(t)
            w = float(weights_arr[i]) if i < len(weights_arr) else 0
            if cov is not None and w > 0.001:
                weighted_sum += cov * w
                total_w += w
        return round(weighted_sum / total_w, 4) if total_w > 0 else None

    curr_cov = _weighted_coverage(current_weights) if current_weights is not None else None
    opt_cov = _weighted_coverage(opt_weights)

    before = {
        "grade": grade_before.get("overall", "—") if isinstance(grade_before, dict) else str(grade_before),
        "score": grade_before.get("score", 0) if isinstance(grade_before, dict) else 0,
        "sharpe": pm.get("sharpe"),
        "sortino": pm.get("sortino"),
        "omega": pm.get("omega"),
        "calmar": pm.get("calmar"),
        "ulcer_index": pm.get("ulcer_index"),
        "max_drawdown": pm.get("max_drawdown"),
        "annual_income": round(curr_income, 2),
        "monthly_income": round(curr_income / 12, 2),
        "coverage": curr_cov,
    }
    # If weights barely changed (all within 0.5%), reuse before metrics — no real change
    if current_weights is not None:
        max_change = float(np.max(np.abs(np.array(opt_weights) - np.array(current_weights)))) * 100
        if max_change < 0.5:
            return {"before": before, "after": dict(before)}
    pm_after = grade_portfolio(returns_df, opt_weights, bench_ret)
    return {
        "before": before,
        "after": {
            "grade": pm_after.get("grade", {}).get("overall", "—"),
            "score": pm_after.get("grade", {}).get("score", 0),
            "sharpe": pm_after.get("sharpe"),
            "sortino": pm_after.get("sortino"),
            "omega": pm_after.get("omega"),
            "calmar": pm_after.get("calmar"),
            "ulcer_index": pm_after.get("ulcer_index"),
            "max_drawdown": pm_after.get("max_drawdown"),
            "annual_income": round(opt_income, 2),
            "monthly_income": round(opt_income / 12, 2),
            "coverage": opt_cov,
        },
    }


def _enrich_weights_with_actions(weights_out, close_df, total_val, nav_returns=None, threshold=0.5):
    """Add action / dollar_change / shares_change / current_price / nav_change_pct to each weight dict."""
    total_buy = 0.0
    total_sell = 0.0
    for w in weights_out:
        ticker = w["ticker"]
        change_pct = w["optimal_pct"] - w["current_pct"]
        dollar_change = round((change_pct / 100) * total_val, 2)
        price = 0.0
        if ticker in close_df.columns:
            s = close_df[ticker].dropna()
            if len(s) > 0:
                price = round(float(s.iloc[-1]), 2)
        shares = int(dollar_change / price) if price > 0 else 0
        if nav_returns:
            w["nav_change_pct"] = round(nav_returns.get(ticker, 0.0) * 100, 1)
        if abs(change_pct) < threshold:
            action = "HOLD"
        elif change_pct > 0:
            action = "BUY"
        else:
            action = "SELL"
        w["action"] = action
        w["dollar_change"] = dollar_change
        w["shares_change"] = shares
        w["current_price"] = price
        if action == "BUY":
            total_buy += dollar_change
        elif action == "SELL":
            total_sell += abs(dollar_change)
    summary = {
        "total_buy": round(total_buy, 2),
        "total_sell": round(total_sell, 2),
        "num_buys": sum(1 for w in weights_out if w["action"] == "BUY"),
        "num_sells": sum(1 for w in weights_out if w["action"] == "SELL"),
        "num_holds": sum(1 for w in weights_out if w["action"] == "HOLD"),
    }
    return weights_out, summary


def _build_efficient_frontier(returns_df, n_points=30):
    import numpy as np
    from scipy.optimize import minimize
    n = returns_df.shape[1]
    mean_ret = returns_df.mean().values * 252
    cov = returns_df.cov().values * 252
    ret_range = np.linspace(mean_ret.min(), mean_ret.max(), n_points)
    frontier = []
    for target in ret_range:
        def portfolio_vol(w):
            return np.sqrt(w @ cov @ w)
        constraints = [
            {"type": "eq", "fun": lambda w: w.sum() - 1},
            {"type": "eq", "fun": lambda w, t=target: w @ mean_ret - t},
        ]
        bounds = [(0, 1)] * n
        init = np.ones(n) / n
        result = minimize(portfolio_vol, init, method="SLSQP", bounds=bounds,
                          constraints=constraints, options={"maxiter": 500})
        if result.success:
            vol = float(np.sqrt(result.x @ cov @ result.x))
            ret = float(result.x @ mean_ret)
            frontier.append({"vol": round(vol * 100, 2), "ret": round(ret * 100, 2)})
    return frontier


GROWTH_ETFS = ["QQQ", "VOO", "VGT", "VUG", "SCHG", "IWF", "MGK", "QQQM", "XLK", "SMH"]
INCOME_ETFS = ["SPYI", "QQQI", "MLPI", "TSPY", "TDAQ", "IWMI", "JEPQ", "CHPY", "ULTY", "O", "MAIN", "PBDC", "XQQI"]

# Single-stock ETFs — highest risk, destroy portfolio scores.
# Only recommended as BUY in optimize_income or balanced at 100%.
_DEFAULT_SINGLE_STOCK_ETFS = {
    # YieldMax single-stock option-income ETFs
    "TSLY", "NVDY", "CONY", "AMZY", "MSFO", "APLY", "GOOY", "FBY",
    "NFLY", "DISO", "PYPY", "SQY", "AMDY", "OARK", "MRNY", "SNOY",
    "JPMO", "BABO", "TSMY", "YBIT", "PLTY", "FIAT", "GMEY", "MARO",
    "CRSH", "ABNY", "SMCY", "MSTY", "METY", "FIVY", "LFGY",
    # YieldMax multi-single-stock baskets (composed entirely of single-stock ETFs)
    "ULTY", "YMAG", "YMAX",
    # Kurv single-stock
    "TSLP", "NVDP",
    # GraniteShares / REX single-stock leveraged
    "NVDL", "TSLL", "CONL", "AMDL",
}


def _get_single_stock_etfs():
    """Return built-in set merged with any user-added tickers from settings."""
    result = set(_DEFAULT_SINGLE_STOCK_ETFS)
    try:
        conn = get_connection()
        row = conn.execute("SELECT value FROM settings WHERE key = 'single_stock_etfs'").fetchone()
        conn.close()
        if row and row["value"]:
            user_tickers = {t.strip().upper() for t in row["value"].split(",") if t.strip()}
            result |= user_tickers
    except Exception:
        pass
    return result


@app.route("/api/analytics/data", methods=["POST"])
def analytics_data():
    """Compute risk metrics, portfolio grade, charts and optional optimization."""
    import warnings, math
    import numpy as np
    import yfinance as yf
    from grading import (ticker_score, grade_portfolio, letter_grade,
                         _sharpe, _sortino, _calmar, _omega,
                         _ulcer_index, _max_drawdown, _capture_ratios, _safe)
    warnings.filterwarnings("ignore")

    data = request.get_json(force=True, silent=True) or {}
    tickers = [str(t).strip().upper() for t in data.get("tickers", []) if str(t).strip()]
    benchmark = str(data.get("benchmark", "SPY")).strip().upper()
    period = data.get("period", "1y")
    mode = data.get("mode", "metrics")
    min_sharpe = float(data.get("min_sharpe", 0.8))
    max_dd = float(data.get("max_dd", -0.20))
    balance = float(data.get("balance", 0.5))

    if not tickers:
        return jsonify(error="No tickers provided."), 400

    valid_periods = {"1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "max"}
    if period not in valid_periods:
        period = "1y"

    all_dl = list(set(tickers + [benchmark]))
    try:
        raw = yf.download(" ".join(all_dl), period=period, auto_adjust=True, progress=False)
        if raw.empty:
            return jsonify(error="No price data returned."), 500
    except Exception as e:
        return jsonify(error=f"yfinance error: {str(e)}"), 500

    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"].dropna(how="all")
    else:
        close = raw[["Close"]].dropna(how="all")
        close.columns = [all_dl[0]]

    # DB weights and yields
    profile_id = get_profile_id()
    conn = get_connection()
    try:
        db_rows = conn.execute(
            "SELECT ticker, current_value, estim_payment_per_year FROM all_account_info "
            "WHERE current_value IS NOT NULL AND current_value > 0 AND profile_id = ?",
            (profile_id,)
        ).fetchall()
    except Exception:
        db_rows = []
    conn.close()

    db_df = pd.DataFrame([dict(r) for r in db_rows]) if db_rows else pd.DataFrame(columns=["ticker", "current_value", "estim_payment_per_year"])
    total_val = float(db_df["current_value"].sum()) if not db_df.empty else 1
    weight_map = {}
    yield_map = {}
    income_map = {}
    for _, r in db_df.iterrows():
        t = r["ticker"]
        weight_map[t] = float(r["current_value"]) / total_val if total_val > 0 else 0
        cv = float(r["current_value"]) if r["current_value"] and float(r["current_value"]) > 0 else 1
        ep = float(r["estim_payment_per_year"]) if pd.notna(r.get("estim_payment_per_year")) else 0
        yield_map[t] = ep / cv
        income_map[t] = ep

    # Per-ticker coverage ratio: (TTM price return % + TTM dist yield %) / TTM dist yield %
    coverage_map = {}
    for t in tickers:
        if t not in close.columns:
            continue
        tc = close[t].dropna()
        if len(tc) < 2:
            continue
        price_start = float(tc.iloc[0])
        price_end = float(tc.iloc[-1])
        if price_start <= 0:
            continue
        price_return_pct = (price_end - price_start) / price_start
        dist_yield = yield_map.get(t, 0)
        if dist_yield > 0:
            coverage_map[t] = round((price_return_pct + dist_yield) / dist_yield, 4)

    bench_close = close[benchmark] if benchmark in close.columns else None
    bench_ret = bench_close.pct_change().dropna() if bench_close is not None else None

    def safe(v):
        if v is None:
            return None
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return v

    # Per-ticker metrics
    metrics = []
    available_tickers = []
    for t in tickers:
        if t not in close.columns:
            continue
        tc = close[t].dropna()
        if len(tc) < 30:
            continue
        available_tickers.append(t)
        tr = tc.pct_change().dropna()
        score, sharpe_v, sortino_v, calmar_v, omega_v, mdd_v, dc_v, ulcer_v = ticker_score(tc, tr, bench_ret)
        uc_v, _ = _capture_ratios(tr, bench_ret) if bench_ret is not None else (None, None)
        annual_ret = round(float(tr.mean() * 252) * 100, 2)
        annual_total_ret = round(annual_ret + yield_map.get(t, 0) * 100, 2)
        annual_vol = round(float(tr.std() * np.sqrt(252)) * 100, 2)
        metrics.append({
            "ticker": t,
            "weight": round(weight_map.get(t, 0) * 100, 2),
            "sharpe": safe(sharpe_v),
            "sortino": safe(sortino_v),
            "calmar": safe(calmar_v),
            "omega": safe(omega_v),
            "ulcer_index": safe(ulcer_v),
            "up_capture": safe(uc_v),
            "down_capture": safe(dc_v),
            "max_drawdown": round(mdd_v * 100, 2) if mdd_v is not None else None,
            "annual_ret": annual_ret,
            "annual_total_ret": annual_total_ret,
            "annual_vol": annual_vol,
            "score": round(score, 1),
            "grade": letter_grade(score),
            "annual_income": round(income_map.get(t, 0), 2),
        })

    # Portfolio-level metrics and grade
    port_metrics = {}
    result_corr = None
    result_dd = None
    if len(available_tickers) >= 2:
        returns_df = close[available_tickers].pct_change().fillna(0)
        weights_arr = np.array([weight_map.get(t, 0) for t in available_tickers])
        w_sum = weights_arr.sum()
        if w_sum > 0:
            weights_arr = weights_arr / w_sum
        else:
            # No DB weights available — use equal weight
            weights_arr = np.ones(len(available_tickers)) / len(available_tickers)

        pm = grade_portfolio(returns_df, weights_arr, bench_ret)
        port_metrics = {
            "sharpe": pm.get("sharpe"),
            "sortino": pm.get("sortino"),
            "calmar": pm.get("calmar"),
            "omega": pm.get("omega"),
            "ulcer_index": pm.get("ulcer_index"),
            "max_drawdown": pm.get("max_drawdown"),
            "up_capture": pm.get("up_capture"),
            "down_capture": pm.get("down_capture"),
            "top_weight": pm.get("top_weight"),
            "effective_n": pm.get("effective_n"),
            "n_holdings": len(available_tickers),
            "grade": pm.get("grade"),
            "total_value": round(total_val, 2),
            "est_annual_income": round(sum(income_map.values()), 2),
        }

        # Correlation matrix
        corr = returns_df.corr()
        result_corr = {
            "labels": available_tickers,
            "matrix": [[round(float(corr.loc[a, b]), 3) for b in available_tickers]
                       for a in available_tickers],
        }

        # Portfolio drawdown series
        port_daily = returns_df.dot(weights_arr)
        port_cum = (1 + port_daily).cumprod()
        roll_max = port_cum.cummax()
        drawdown_s = (port_cum / roll_max - 1)
        step = max(1, len(drawdown_s) // 200)
        dd_sampled = drawdown_s.iloc[::step]
        result_dd = {
            "dates": [d.strftime("%Y-%m-%d") for d in dd_sampled.index],
            "values": [round(float(v) * 100, 2) for v in dd_sampled.values],
        }

    # Include per-ticker coverage and aggregate in response
    cov_results = [{"ticker": t, "coverage_ratio": coverage_map.get(t)} for t in available_tickers]
    # Dollar-weighted aggregate coverage
    _cov_num = 0.0
    _cov_den = 0.0
    for t in available_tickers:
        cov = coverage_map.get(t)
        w = weight_map.get(t, 0)
        if cov is not None and w > 0:
            _cov_num += cov * w
            _cov_den += w
    agg_cov = round(_cov_num / _cov_den, 4) if _cov_den > 0 else None

    result = {"metrics": metrics, "portfolio_metrics": port_metrics,
              "coverage": {"results": cov_results, "aggregate_coverage": agg_cov}}
    if result_corr:
        result["correlation"] = result_corr
        result["drawdown_series"] = result_dd

    # Sector breakdown (parallel yf.Ticker.info fetch)
    try:
        from concurrent.futures import ThreadPoolExecutor
        def _fetch_sector(t):
            try:
                info = yf.Ticker(t).info
                return t, info.get("sector", info.get("category", "Other")), info.get("quoteType", "Unknown")
            except Exception:
                return t, "Unknown", "Unknown"
        with ThreadPoolExecutor(max_workers=8) as pool:
            sector_info = dict()
            type_info = dict()
            for t, sector, qtype in pool.map(lambda t: _fetch_sector(t), available_tickers):
                val = weight_map.get(t, 0) * 100 if weight_map else 100 / max(len(available_tickers), 1)
                sector_info[sector or "Unknown"] = sector_info.get(sector or "Unknown", 0) + val
                type_info[qtype or "Unknown"] = type_info.get(qtype or "Unknown", 0) + val
        result["sector_breakdown"] = {
            "by_sector": [{"label": k, "value": round(v, 2)} for k, v in sorted(sector_info.items(), key=lambda x: -x[1])],
            "by_type": [{"label": k, "value": round(v, 2)} for k, v in sorted(type_info.items(), key=lambda x: -x[1])],
        }
    except Exception:
        pass

    # Risk contribution breakdown
    if result_corr and weight_map and len(available_tickers) >= 2:
        try:
            w_arr = np.array([weight_map.get(t, 0) for t in available_tickers])
            w_sum = w_arr.sum()
            if w_sum > 0:
                w_arr = w_arr / w_sum
                cov_mat = returns_df.cov().values * 252
                port_vol = float(np.sqrt(w_arr @ cov_mat @ w_arr))
                if port_vol > 0:
                    mctr = cov_mat @ w_arr / port_vol
                    risk_contrib = w_arr * mctr
                    rc_sum = risk_contrib.sum()
                    if rc_sum > 0:
                        pct_contrib = risk_contrib / rc_sum * 100
                        result["risk_contribution"] = [{"ticker": t, "pct": round(float(p), 2)} for t, p in zip(available_tickers, pct_contrib)]
        except Exception:
            pass

    # Detect portfolio type and suggest complementary ETFs
    if weight_map:
        weighted_yield = sum(yield_map.get(t, 0) * weight_map.get(t, 0) for t in weight_map)
        tickers_upper = [t.upper() for t in tickers]
        if weighted_yield > 0.05:
            result["portfolio_type"] = "income"
            result["suggested_growth"] = [t for t in GROWTH_ETFS if t not in tickers_upper]
        elif weighted_yield < 0.02:
            result["portfolio_type"] = "growth"
            result["suggested_income"] = [t for t in INCOME_ETFS if t not in tickers_upper]
        else:
            result["portfolio_type"] = "mixed"

    # Optimization modes
    if mode in ("optimize_returns", "optimize_income", "optimize_balanced") and len(available_tickers) >= 2:
        returns_df = close[available_tickers].pct_change().dropna()
        current_weights = np.array([weight_map.get(t, 0) for t in available_tickers])
        cw_sum = current_weights.sum()
        has_portfolio = cw_sum > 0  # True when user loaded real portfolio data
        if has_portfolio:
            current_weights = current_weights / cw_sum
        else:
            current_weights = np.ones(len(available_tickers)) / len(available_tickers)

        # Compute NAV erosion for yield-based optimizers
        nav_returns = _compute_nav_erosion(close, available_tickers)
        single_stock_etfs = _get_single_stock_etfs()

        if mode == "optimize_returns":
            ret_weight_caps = _nav_weight_caps(nav_returns, available_tickers)
            # Force sell single-stock ETFs — too risky for growth optimization
            for i, t in enumerate(available_tickers):
                if t in single_stock_etfs:
                    ret_weight_caps[i] = 0.0
            opt_w = _optimize_sharpe(returns_df, current_weights=current_weights, weight_caps=ret_weight_caps)
            frontier = _build_efficient_frontier(returns_df)
            opt_sharpe_val = _portfolio_sharpe(opt_w, returns_df)
            opt_sortino_val = _portfolio_sortino(opt_w, returns_df)
            curr_sharpe_val = _portfolio_sharpe(current_weights, returns_df)
            curr_sortino_val = _portfolio_sortino(current_weights, returns_df)
            mean_ret = float(returns_df.mean().values @ opt_w) * 252
            cov = returns_df.cov().values * 252
            opt_vol = float(np.sqrt(opt_w @ cov @ opt_w))
            curr_ret = float(returns_df.mean().values @ current_weights) * 252
            curr_vol = float(np.sqrt(current_weights @ cov @ current_weights))
            weights_out = [{"ticker": t, "current_pct": round(current_weights[i] * 100, 2),
                            "optimal_pct": round(opt_w[i] * 100, 2)} for i, t in enumerate(available_tickers)]
            weights_out, rebal_summary = _enrich_weights_with_actions(weights_out, close, total_val, nav_returns)
            opt_dict = {
                "weights": weights_out, "frontier": frontier,
                "optimal_point": {"vol": round(opt_vol * 100, 2), "ret": round(mean_ret * 100, 2)},
                "current_point": {"vol": round(curr_vol * 100, 2), "ret": round(curr_ret * 100, 2)},
                "summary": {"sharpe": round(opt_sharpe_val, 2), "sortino": round(opt_sortino_val, 2),
                             "curr_sharpe": round(curr_sharpe_val, 2), "curr_sortino": round(curr_sortino_val, 2),
                             "expected_return": round(mean_ret * 100, 2),
                             "expected_vol": round(opt_vol * 100, 2)},
                "rebalance_summary": rebal_summary,
            }
            if has_portfolio:
                yields_list_ret = [yield_map.get(t, 0) for t in available_tickers]
                ret_curr_income = float(current_weights.dot(np.array(yields_list_ret))) * total_val
                ret_opt_income = float(opt_w.dot(np.array(yields_list_ret))) * total_val
                opt_dict["comparison"] = _before_after_comparison(returns_df, opt_w, bench_ret,
                                                                   port_metrics, ret_curr_income, ret_opt_income,
                                                                   current_weights=current_weights,
                                                                   coverage_map=coverage_map,
                                                                   available_tickers=available_tickers)
            result["optimization"] = opt_dict

        elif mode == "optimize_income":
            yields_list = [yield_map.get(t, 0) for t in available_tickers]
            adj_yields = _adjust_yields_for_nav(yields_list, nav_returns, available_tickers)
            weight_caps = _nav_weight_caps(nav_returns, available_tickers)
            # Per-ticker NAV erosion penalty: abs(erosion) scaled, 0 for non-eroding
            nav_pen = [max(0, -nav_returns.get(t, 0.0)) * 1.5 for t in available_tickers]
            # Zero-yield tickers get capped to 0 in income modes — no reason to buy them
            for i, t in enumerate(available_tickers):
                if yields_list[i] <= 0:
                    weight_caps[i] = 0.0
            opt_w = _optimize_income(returns_df, adj_yields, current_weights=current_weights, weight_caps=weight_caps, nav_penalties=nav_pen)
            opt_yield = float(opt_w.dot(np.array(yields_list)))
            curr_yield = float(current_weights.dot(np.array(yields_list)))
            # Use port_metrics for current (matches Impact Analysis "before"), grade_portfolio for optimized
            opt_gp = grade_portfolio(returns_df, opt_w, bench_ret)
            opt_income = opt_yield * total_val
            curr_income = curr_yield * total_val
            weights_out = [{"ticker": t, "current_pct": round(current_weights[i] * 100, 2),
                            "optimal_pct": round(opt_w[i] * 100, 2), "yield_pct": round(yields_list[i] * 100, 2)}
                           for i, t in enumerate(available_tickers)]
            weights_out, rebal_summary = _enrich_weights_with_actions(weights_out, close, total_val, nav_returns)
            scatter_data = []
            for i, t in enumerate(available_tickers):
                tc = close[t].dropna()
                tr = tc.pct_change().dropna()
                vol = float(tr.std() * np.sqrt(252)) if len(tr) > 1 else 0
                scatter_data.append({"ticker": t, "yield_pct": round(yields_list[i] * 100, 2),
                                     "vol_pct": round(vol * 100, 2), "is_optimal": float(opt_w[i]) > 0.01})
            opt_dict = {
                "weights": weights_out, "scatter": scatter_data,
                "summary": {"opt_sortino": round(safe(opt_gp.get("sortino")) or 0, 2),
                             "curr_sortino": round(safe(port_metrics.get("sortino")) or 0, 2),
                             "opt_omega": round(safe(opt_gp.get("omega")) or 0, 2),
                             "curr_omega": round(safe(port_metrics.get("omega")) or 0, 2),
                             "opt_calmar": round(safe(opt_gp.get("calmar")) or 0, 2),
                             "curr_calmar": round(safe(port_metrics.get("calmar")) or 0, 2),
                             "opt_ulcer": round(safe(opt_gp.get("ulcer_index")) or 0, 2),
                             "curr_ulcer": round(safe(port_metrics.get("ulcer_index")) or 0, 2),
                             "max_dd": round((safe(opt_gp.get("max_drawdown")) or 0) * 100, 2),
                             "opt_yield": round(opt_yield * 100, 2), "curr_yield": round(curr_yield * 100, 2),
                             "opt_income": round(opt_income, 2), "curr_income": round(curr_income, 2)},
                "rebalance_summary": rebal_summary,
            }
            if has_portfolio:
                opt_dict["comparison"] = _before_after_comparison(returns_df, opt_w, bench_ret,
                                                                   port_metrics, curr_income, opt_income,
                                                                   current_weights=current_weights,
                                                                   coverage_map=coverage_map,
                                                                   available_tickers=available_tickers)
            result["optimization"] = opt_dict

        elif mode == "optimize_balanced":
            yields_list = [yield_map.get(t, 0) for t in available_tickers]
            adj_yields = _adjust_yields_for_nav(yields_list, nav_returns, available_tickers)
            weight_caps = _nav_weight_caps(nav_returns, available_tickers)
            # Zero-yield tickers get capped to 0 in income-oriented modes
            for i, t in enumerate(available_tickers):
                if yields_list[i] <= 0:
                    weight_caps[i] = 0.0
            # Single-stock ETFs: tiered handling based on balance slider and yield
            # <55%: scale toward sell (cap from 0 at balance=0 to current weight at 55%)
            # 55-70%: can buy but reduced priority (cap at half of max_per_holding)
            # >=70%: full priority ONLY if high yield (>=10%), otherwise still reduced
            high_yield_threshold = 0.10
            max_per_holding = 0.10 + 0.10 * balance  # match the cap used inside _optimize_balanced
            if balance < 0.55:
                for i, t in enumerate(available_tickers):
                    if t in single_stock_etfs:
                        ss_cap = current_weights[i] * (balance / 0.55)
                        weight_caps[i] = min(weight_caps[i], ss_cap)
            elif balance < 0.70:
                half_cap = max_per_holding * 0.5
                for i, t in enumerate(available_tickers):
                    if t in single_stock_etfs:
                        weight_caps[i] = min(weight_caps[i], half_cap)
            else:
                # >=70%: only high-yield single-stock ETFs get full priority
                half_cap = max_per_holding * 0.5
                for i, t in enumerate(available_tickers):
                    if t in single_stock_etfs and yield_map.get(t, 0) < high_yield_threshold:
                        weight_caps[i] = min(weight_caps[i], half_cap)
            nav_pen = [max(0, -nav_returns.get(t, 0.0)) * 1.5 for t in available_tickers]
            opt_w = _optimize_balanced(returns_df, adj_yields, balance=balance, current_weights=current_weights, min_sharpe=min_sharpe, max_dd=max_dd, weight_caps=weight_caps, nav_penalties=nav_pen)
            opt_yield = float(opt_w.dot(np.array(yields_list)))
            curr_yield = float(current_weights.dot(np.array(yields_list)))
            # Use port_metrics for current (matches Impact Analysis "before"), grade_portfolio for optimized
            opt_gp = grade_portfolio(returns_df, opt_w, bench_ret)
            opt_income = opt_yield * total_val
            curr_income = curr_yield * total_val
            weights_out = [{"ticker": t, "current_pct": round(current_weights[i] * 100, 2),
                            "optimal_pct": round(opt_w[i] * 100, 2), "yield_pct": round(yields_list[i] * 100, 2)}
                           for i, t in enumerate(available_tickers)]
            scatter_data = []
            for i, t in enumerate(available_tickers):
                tc = close[t].dropna()
                tr = tc.pct_change().dropna()
                vol = float(tr.std() * np.sqrt(252)) if len(tr) > 1 else 0
                sharpe_t = safe(_sharpe(tc))
                scatter_data.append({"ticker": t, "yield_pct": round(yields_list[i] * 100, 2),
                                     "vol_pct": round(vol * 100, 2), "sharpe": sharpe_t if sharpe_t else 0,
                                     "is_optimal": float(opt_w[i]) > 0.01})
            weights_out, rebal_summary = _enrich_weights_with_actions(weights_out, close, total_val, nav_returns)
            opt_dict = {
                "weights": weights_out, "scatter": scatter_data,
                "summary": {"opt_yield": round(opt_yield * 100, 2), "curr_yield": round(curr_yield * 100, 2),
                             "opt_income": round(opt_income, 2), "curr_income": round(curr_income, 2),
                             "opt_sortino": round(safe(opt_gp.get("sortino")) or 0, 2),
                             "curr_sortino": round(safe(port_metrics.get("sortino")) or 0, 2),
                             "opt_omega": round(safe(opt_gp.get("omega")) or 0, 2),
                             "curr_omega": round(safe(port_metrics.get("omega")) or 0, 2),
                             "opt_calmar": round(safe(opt_gp.get("calmar")) or 0, 2),
                             "curr_calmar": round(safe(port_metrics.get("calmar")) or 0, 2),
                             "opt_ulcer": round(safe(opt_gp.get("ulcer_index")) or 0, 2),
                             "curr_ulcer": round(safe(port_metrics.get("ulcer_index")) or 0, 2),
                             "max_dd": round((safe(opt_gp.get("max_drawdown")) or 0) * 100, 2),
                             "balance": round(balance * 100)},
                "rebalance_summary": rebal_summary,
            }
            if has_portfolio:
                opt_dict["comparison"] = _before_after_comparison(returns_df, opt_w, bench_ret,
                                                                   port_metrics, curr_income, opt_income,
                                                                   current_weights=current_weights,
                                                                   coverage_map=coverage_map,
                                                                   available_tickers=available_tickers)
            result["optimization"] = opt_dict

    return jsonify(result)


# ── Correlation Matrix ─────────────────────────────────────────────────────────

@app.route("/api/correlation/data", methods=["POST"])
def correlation_data():
    """Compute correlation matrix for arbitrary tickers over a given period."""
    import math
    import warnings
    import numpy as np
    import yfinance as yf
    warnings.filterwarnings("ignore")

    data = request.get_json(force=True, silent=True) or {}
    tickers = [str(t).strip().upper() for t in data.get("tickers", []) if str(t).strip()]
    period = data.get("period", "1y")

    if len(tickers) < 2:
        return jsonify(error="Please enter at least 2 tickers.")
    if len(tickers) > 50:
        return jsonify(error="Maximum 50 tickers allowed.")

    valid_periods = {"3mo", "6mo", "1y", "2y", "5y", "max"}
    if period not in valid_periods:
        period = "1y"

    unique = list(dict.fromkeys(tickers))

    try:
        raw = yf.download(" ".join(unique), period=period, auto_adjust=True, progress=False)
        if raw.empty:
            return jsonify(error="No price data returned from Yahoo Finance.")
    except Exception as e:
        return jsonify(error=f"Failed to fetch data: {str(e)}")

    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"].dropna(how="all")
    else:
        close = raw[["Close"]].dropna(how="all")
        close.columns = [unique[0]]

    available = [t for t in unique if t in close.columns and close[t].dropna().count() >= 30]
    missing = [t for t in unique if t not in available]

    if len(available) < 2:
        return jsonify(error="Need at least 2 tickers with sufficient data.")

    daily_returns = close[available].pct_change().dropna()
    corr = daily_returns.corr()

    def _safe(v):
        if v is None:
            return None
        try:
            f = float(v)
            return None if (math.isnan(f) or math.isinf(f)) else round(f, 3)
        except (TypeError, ValueError):
            return None

    matrix = [[_safe(corr.iloc[i, j]) for j in range(len(available))] for i in range(len(available))]

    return jsonify(
        tickers=available,
        matrix=matrix,
        missing=missing,
        period=period,
        data_points=len(daily_returns),
    )


# ── Analytics: Income Calendar ─────────────────────────────────────────────────

@app.route("/api/analytics/income-calendar", methods=["POST"])
def analytics_income_calendar():
    data = request.get_json() or {}
    req_tickers = [t.upper() for t in data.get("tickers", [])]
    if not req_tickers:
        return jsonify({"months": [], "tickers": [], "monthly_totals": []})

    _, cal_pids = get_profile_filter()
    cal_ph = ",".join("?" * len(cal_pids))
    conn = get_connection()
    months_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    ticker_data = []
    for t in req_tickers:
        # Get pay months from monthly_payout_tickers
        row = conn.execute("SELECT pay_month FROM monthly_payout_tickers WHERE ticker = ?", (t,)).fetchone()
        div_row = conn.execute(
            f"SELECT estim_payment_per_year, div_frequency FROM dividends WHERE ticker = ? AND profile_id IN ({cal_ph})",
            [t] + cal_pids
        ).fetchone()
        if not div_row:
            continue
        annual = float(div_row["estim_payment_per_year"] or 0)
        freq = (div_row["div_frequency"] or "").strip().upper()

        amounts = [0.0] * 12
        if freq == "W":
            # Weekly: spread evenly
            weekly = annual / 52
            amounts = [round(weekly * 4.33, 2)] * 12
        elif freq == "M":
            monthly = annual / 12
            amounts = [round(monthly, 2)] * 12
        elif row and row["pay_month"]:
            # Quarterly/Semi-annual/Annual — use pay_month data
            pay_months = [int(m.strip()) for m in str(row["pay_month"]).split(",") if m.strip().isdigit()]
            if pay_months:
                per_payment = annual / len(pay_months)
                for m in pay_months:
                    if 1 <= m <= 12:
                        amounts[m - 1] = round(per_payment, 2)
        else:
            # Default: spread quarterly starting month 3
            if freq == "Q":
                for m in [2, 5, 8, 11]:
                    amounts[m] = round(annual / 4, 2)
            elif freq in ("SA", "S"):
                for m in [5, 11]:
                    amounts[m] = round(annual / 2, 2)
            elif freq == "A":
                amounts[11] = round(annual, 2)
            else:
                monthly = annual / 12
                amounts = [round(monthly, 2)] * 12

        ticker_data.append({"ticker": t, "amounts": amounts})

    conn.close()

    monthly_totals = [0.0] * 12
    for td in ticker_data:
        for i in range(12):
            monthly_totals[i] += td["amounts"][i]
    monthly_totals = [round(v, 2) for v in monthly_totals]

    return jsonify({"months": months_labels, "tickers": ticker_data, "monthly_totals": monthly_totals})


# ── Analytics: Backtest ───────────────────────────────────────────────────────

@app.route("/api/analytics/backtest", methods=["POST"])
def analytics_backtest():
    import yfinance as yf
    data = request.get_json() or {}
    req_tickers = [t.upper() for t in data.get("tickers", [])]
    period = data.get("period", "1y")
    if not req_tickers:
        return jsonify({"dates": [], "series": []})

    try:
        close = yf.download(req_tickers, period=period, auto_adjust=True, progress=False)
        if hasattr(close, "columns") and isinstance(close.columns, pd.MultiIndex):
            close = close["Close"]
        elif "Close" in close.columns:
            close = close[["Close"]]
            close.columns = req_tickers[:1]
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    if close.empty:
        return jsonify({"dates": [], "series": []})

    series = []
    for t in req_tickers:
        if t not in close.columns:
            continue
        col = close[t].dropna()
        if len(col) < 2:
            continue
        normalized = (col / col.iloc[0]) * 10000
        step = max(1, len(normalized) // 200)
        sampled = normalized.iloc[::step]
        series.append({"ticker": t, "values": [round(float(v), 2) for v in sampled.values]})

    # Use the longest ticker's dates
    if series:
        longest = max(req_tickers, key=lambda t: len(close[t].dropna()) if t in close.columns else 0)
        col = close[longest].dropna()
        step = max(1, len(col) // 200)
        dates = [d.strftime("%Y-%m-%d") for d in col.index[::step]]
    else:
        dates = []

    return jsonify({"dates": dates, "series": series})


# ── Analytics: Yield Trend ────────────────────────────────────────────────────

@app.route("/api/analytics/yield-trend", methods=["POST"])
def analytics_yield_trend():
    import yfinance as yf
    data = request.get_json() or {}
    req_tickers = [t.upper() for t in data.get("tickers", [])]
    period = data.get("period", "2y")
    if not req_tickers:
        return jsonify({"series": []})

    result_series = []
    for t in req_tickers:
        try:
            tk = yf.Ticker(t)
            hist = tk.history(period=period)
            divs = tk.dividends
            if hist.empty or divs.empty:
                continue

            # Make both timezone-naive for comparison
            hist.index = hist.index.tz_localize(None)
            divs.index = divs.index.tz_localize(None)

            dates_out = []
            values_out = []
            close_prices = hist["Close"]
            # Compute trailing 12-month yield at sampled points
            step = max(1, len(close_prices) // 100)
            for i in range(step, len(close_prices), step):
                date = close_prices.index[i]
                price = float(close_prices.iloc[i])
                if price <= 0:
                    continue
                start = date - pd.Timedelta(days=365)
                ttm_divs = divs[(divs.index >= start) & (divs.index <= date)]
                ttm_yield = float(ttm_divs.sum()) / price * 100
                dates_out.append(date.strftime("%Y-%m-%d"))
                values_out.append(round(ttm_yield, 3))

            if dates_out:
                result_series.append({"ticker": t, "dates": dates_out, "values": values_out})
        except Exception:
            continue

    return jsonify({"series": result_series})


# ── Analytics: Rolling Metrics ────────────────────────────────────────────────

@app.route("/api/analytics/rolling-metrics", methods=["POST"])
def analytics_rolling_metrics():
    import yfinance as yf
    data = request.get_json() or {}
    req_tickers = [t.upper() for t in data.get("tickers", [])]
    period = data.get("period", "2y")
    window = int(data.get("window", 126))
    if not req_tickers:
        return jsonify({"dates": [], "sharpe": [], "sortino": []})

    try:
        close = yf.download(req_tickers, period=period, auto_adjust=True, progress=False)
        if hasattr(close, "columns") and isinstance(close.columns, pd.MultiIndex):
            close = close["Close"]
        elif "Close" in close.columns:
            close = close[["Close"]]
            close.columns = req_tickers[:1]
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    if close.empty:
        return jsonify({"dates": [], "sharpe": [], "sortino": []})

    returns = close.pct_change().dropna()
    sharpe_series = []
    sortino_series = []

    for t in req_tickers:
        if t not in returns.columns:
            continue
        r = returns[t].dropna()
        if len(r) < window + 10:
            continue

        sharpe_vals = []
        sortino_vals = []
        indices = range(window, len(r), max(1, (len(r) - window) // 200))
        for i in indices:
            w_ret = r.iloc[i - window:i]
            mean_ret = float(w_ret.mean()) * 252
            std_ret = float(w_ret.std()) * (252 ** 0.5)
            downside = w_ret[w_ret < 0]
            down_std = float(downside.std()) * (252 ** 0.5) if len(downside) > 1 else 0

            sharpe_vals.append(round(mean_ret / std_ret, 3) if std_ret > 0 else 0)
            sortino_vals.append(round(mean_ret / down_std, 3) if down_std > 0 else 0)

        dates_idx = [r.index[i] for i in indices]
        sharpe_series.append({"ticker": t, "values": sharpe_vals})
        sortino_series.append({"ticker": t, "values": sortino_vals})

    if sharpe_series:
        # Use first ticker's dates as reference
        t0 = req_tickers[0] if req_tickers[0] in returns.columns else list(returns.columns)[0]
        r0 = returns[t0].dropna()
        indices = range(window, len(r0), max(1, (len(r0) - window) // 200))
        dates = [r0.index[i].strftime("%Y-%m-%d") for i in indices]
    else:
        dates = []

    return jsonify({"dates": dates, "sharpe": sharpe_series, "sortino": sortino_series})


# ── Analytics: NAV Erosion Chart ──────────────────────────────────────────────

@app.route("/api/analytics/nav-erosion-chart", methods=["POST"])
def analytics_nav_erosion_chart():
    import yfinance as yf
    data = request.get_json() or {}
    req_tickers = [t.upper() for t in data.get("tickers", [])]
    period = data.get("period", "2y")
    if not req_tickers:
        return jsonify({"series": []})

    result_series = []
    for t in req_tickers:
        try:
            tk = yf.Ticker(t)
            hist = tk.history(period=period)
            divs = tk.dividends
            if hist.empty:
                continue

            hist.index = hist.index.tz_localize(None)
            close_prices = hist["Close"]

            # Build cumulative dividends
            cum_divs = [0.0] * len(close_prices)
            if not divs.empty:
                divs.index = divs.index.tz_localize(None)
                running = 0.0
                div_idx = 0
                sorted_divs = divs.sort_index()
                for i, date in enumerate(close_prices.index):
                    while div_idx < len(sorted_divs) and sorted_divs.index[div_idx] <= date:
                        running += float(sorted_divs.iloc[div_idx])
                        div_idx += 1
                    cum_divs[i] = round(running, 4)

            # Total return line (price + cumulative dividends, normalized to starting price)
            start_price = float(close_prices.iloc[0])
            total_return = [round(float(close_prices.iloc[i]) + cum_divs[i] - start_price + start_price, 2) for i in range(len(close_prices))]

            step = max(1, len(close_prices) // 200)
            dates = [d.strftime("%Y-%m-%d") for d in close_prices.index[::step]]
            prices = [round(float(v), 2) for v in close_prices.values[::step]]
            cum_d = [cum_divs[i] for i in range(0, len(cum_divs), step)]
            total_r = [total_return[i] for i in range(0, len(total_return), step)]

            result_series.append({
                "ticker": t, "dates": dates, "prices": prices,
                "cum_dividends": cum_d, "total_return_line": total_r,
            })
        except Exception:
            continue

    return jsonify({"series": result_series})


# ── Analytics: Peer Comparison ────────────────────────────────────────────────

PEER_GROUPS = {
    "S&P 500 Covered Calls": ["SPYI", "JEPI", "JEPY", "XYLD", "PBP", "SPY"],
    "Nasdaq Covered Calls": ["QQQI", "JEPQ", "QYLD", "QYLG", "QQQ"],
    "Dividend Growth": ["SCHD", "VIG", "DGRO", "DGRW", "NOBL", "SDY", "DVY", "HDV"],
    "Broad US Market": ["VOO", "VTI", "SPY", "IVV", "QQQ", "SPLG"],
    "Growth": ["VUG", "SCHG", "IWF", "SPYG", "QQQ", "VGT", "XLK"],
    "High-Yield Bonds": ["HYG", "JNK", "HYGV", "USHY", "SHYG"],
    "REITs": ["VNQ", "O", "STAG", "NNN", "SCHH", "IYR"],
    "BDCs": ["BIZD", "ARCC", "MAIN", "HTGC", "GBDC", "BXSL"],
    "MLPs & Infrastructure": ["MLPA", "AMLP", "TPVG", "EMD"],
    "Preferred Stock": ["PFF", "PGX", "PFFD", "PSK"],
    "Senior Loans / CLOs": ["JAAA", "CLOZ", "SRLN", "FLOT"],
    "International Dividend": ["VIGI", "IDV", "SCHY", "DWX"],
    "Bonds / Aggregate": ["BND", "AGG", "VCIT", "SCHZ", "TLT"],
    "Small-Cap": ["VBK", "IJR", "IWM", "SCHA"],
    "Semiconductors": ["SMH", "SOXX", "XSD"],
    "Russell 2000 CC": ["RYLD", "RYLG", "IWMI"],
}

@app.route("/api/analytics/peers", methods=["POST"])
def analytics_peers():
    import yfinance as yf
    data = request.get_json() or {}
    ticker = (data.get("ticker", "")).upper()
    if not ticker:
        return jsonify({"ticker": "", "category": "", "peers": []})

    # Find which group(s) this ticker belongs to
    found_category = ""
    peer_tickers = []
    for cat, members in PEER_GROUPS.items():
        if ticker in members:
            found_category = cat
            peer_tickers = [t for t in members if t != ticker]
            break

    # Also check single-stock ETFs
    if not found_category and ticker in _get_single_stock_etfs():
        found_category = "Single-Stock ETFs"
        ss = _get_single_stock_etfs()
        peer_tickers = sorted([t for t in ss if t != ticker])[:10]

    if not peer_tickers:
        return jsonify({"ticker": ticker, "category": "", "peers": []})

    # Fetch quick metrics for peers
    from concurrent.futures import ThreadPoolExecutor

    def _fetch_peer(t):
        try:
            info = yf.Ticker(t).info
            name = info.get("shortName", info.get("longName", ""))
            yld = info.get("yield", info.get("dividendYield", 0))
            if yld and yld > 0:
                yld = float(yld) * 100
            else:
                yld = None
            # 1Y return from regularMarketPrice / fiftyTwoWeekLow approximate
            price = info.get("regularMarketPrice", info.get("previousClose", 0))
            year_low = info.get("fiftyTwoWeekLow", 0)
            if price and year_low and year_low > 0:
                ret_1y = (price / year_low - 1) * 100  # approximation from 52w low
            else:
                ret_1y = None
            return {"ticker": t, "name": name, "yield_pct": round(yld, 2) if yld else None, "return_1y": round(ret_1y, 1) if ret_1y else None}
        except Exception:
            return {"ticker": t, "name": "", "yield_pct": None, "return_1y": None}

    with ThreadPoolExecutor(max_workers=6) as pool:
        peers = list(pool.map(_fetch_peer, peer_tickers))

    return jsonify({"ticker": ticker, "category": found_category, "peers": peers})


# ── Portfolio Builder CRUD ────────────────────────────────────────────────────

@app.route("/api/builder/portfolios", methods=["GET"])
def builder_list_portfolios():
    pid = get_profile_id()
    conn = get_connection()
    rows = conn.execute("""
        SELECT p.id, p.name, p.notes, p.created_at, p.updated_at,
               (SELECT COUNT(*) FROM builder_holdings h WHERE h.portfolio_id = p.id) AS holding_count
        FROM builder_portfolios p WHERE p.profile_id = ?
        ORDER BY p.updated_at DESC
    """, (pid,)).fetchall()
    conn.close()
    return jsonify({"portfolios": rows_to_dicts(rows)})


@app.route("/api/builder/portfolios", methods=["POST"])
def builder_create_portfolio():
    pid = get_profile_id()
    data = request.get_json()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    notes = (data.get("notes") or "").strip()
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO builder_portfolios (profile_id, name, notes) VALUES (?, ?, ?)",
            (pid, name, notes))
        conn.commit()
        new_id = cur.lastrowid
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 400
    conn.close()
    return jsonify({"id": new_id, "name": name}), 201


@app.route("/api/builder/portfolios/<int:port_id>", methods=["PATCH"])
def builder_update_portfolio(port_id):
    pid = get_profile_id()
    data = request.get_json()
    conn = get_connection()
    fields, vals = [], []
    if "name" in data:
        fields.append("name = ?")
        vals.append(data["name"].strip())
    if "notes" in data:
        fields.append("notes = ?")
        vals.append(data["notes"].strip())
    if not fields:
        conn.close()
        return jsonify({"error": "Nothing to update"}), 400
    fields.append("updated_at = CURRENT_TIMESTAMP")
    vals.extend([port_id, pid])
    conn.execute(f"UPDATE builder_portfolios SET {', '.join(fields)} WHERE id = ? AND profile_id = ?", vals)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/builder/portfolios/<int:port_id>", methods=["DELETE"])
def builder_delete_portfolio(port_id):
    pid = get_profile_id()
    conn = get_connection()
    conn.execute("DELETE FROM builder_holdings WHERE portfolio_id = ?", (port_id,))
    conn.execute("DELETE FROM builder_portfolios WHERE id = ? AND profile_id = ?", (port_id, pid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/builder/portfolios/<int:port_id>/holdings", methods=["GET"])
def builder_list_holdings(port_id):
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, ticker, dollar_amount, added_at FROM builder_holdings WHERE portfolio_id = ? ORDER BY added_at",
        (port_id,)).fetchall()
    conn.close()
    return jsonify({"holdings": rows_to_dicts(rows)})


@app.route("/api/builder/portfolios/<int:port_id>/holdings", methods=["POST"])
def builder_add_holding(port_id):
    data = request.get_json()
    ticker = (data.get("ticker") or "").strip().upper()
    dollar_amount = float(data.get("dollar_amount", 0))
    if not ticker:
        return jsonify({"error": "Ticker is required"}), 400
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO builder_holdings (portfolio_id, ticker, dollar_amount) VALUES (?, ?, ?)",
        (port_id, ticker, dollar_amount))
    conn.execute("UPDATE builder_portfolios SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (port_id,))
    conn.commit()
    conn.close()
    return jsonify({"ticker": ticker, "dollar_amount": dollar_amount})


@app.route("/api/builder/portfolios/<int:port_id>/holdings/<ticker>", methods=["DELETE"])
def builder_delete_holding(port_id, ticker):
    conn = get_connection()
    conn.execute("DELETE FROM builder_holdings WHERE portfolio_id = ? AND ticker = ?", (port_id, ticker.upper()))
    conn.execute("UPDATE builder_portfolios SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (port_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── Portfolio Builder Analyze ────────────────────────────────────────────────

@app.route("/api/builder/portfolios/<int:port_id>/analyze", methods=["POST"])
def builder_analyze(port_id):
    import numpy as np
    import math
    import yfinance as yf
    from grading import (ticker_score, grade_portfolio, letter_grade,
                         _ulcer_index, _sharpe, _sortino, _calmar, _omega,
                         _max_drawdown, _capture_ratios, _safe)

    data = request.get_json() or {}
    benchmark = (data.get("benchmark") or "SPY").strip().upper()
    period = data.get("period", "1y")

    conn = get_connection()
    rows = conn.execute(
        "SELECT ticker, dollar_amount FROM builder_holdings WHERE portfolio_id = ?",
        (port_id,)).fetchall()
    pname = conn.execute("SELECT name FROM builder_portfolios WHERE id = ?", (port_id,)).fetchone()
    conn.close()

    if not rows:
        return jsonify({"error": "No holdings in this portfolio"}), 400

    holdings_raw = [{"ticker": r["ticker"].upper(), "dollar_amount": float(r["dollar_amount"])} for r in rows]
    tickers = [h["ticker"] for h in holdings_raw]
    all_tickers = list(set(tickers + [benchmark]))

    # Download price data
    try:
        df = yf.download(all_tickers, period=period, auto_adjust=True, progress=False)
    except Exception as e:
        return jsonify({"error": f"yfinance download failed: {e}"}), 500

    if df.empty:
        return jsonify({"error": "No price data returned"}), 500

    if isinstance(df.columns, pd.MultiIndex):
        close_df = df["Close"] if "Close" in df.columns.get_level_values(0) else df
    else:
        close_df = df if len(all_tickers) == 1 else df
        if len(all_tickers) == 1:
            close_df = pd.DataFrame({all_tickers[0]: df["Close"] if "Close" in df.columns else df.iloc[:, 0]})

    close_df = close_df.ffill().dropna(how="all")
    bench_close = close_df[benchmark] if benchmark in close_df.columns else None
    bench_ret = bench_close.pct_change().dropna() if bench_close is not None else None

    # NAV erosion
    nav_erosion = _compute_nav_erosion(close_df, tickers)

    # Total portfolio value
    total_value = sum(h["dollar_amount"] for h in holdings_raw)
    if total_value <= 0:
        total_value = 1.0

    # Per-ticker analysis
    result_holdings = []
    returns_cols = {}
    weights_list = []

    for h in holdings_raw:
        t = h["ticker"]
        amt = h["dollar_amount"]
        weight = amt / total_value

        row = {
            "ticker": t, "dollar_amount": amt, "weight_pct": round(weight * 100, 2),
            "shares": 0, "current_price": 0, "score": 0, "grade": "N/A",
            "ulcer_index": None, "sharpe": None, "sortino": None, "calmar": None,
            "omega": None, "up_capture": None, "down_capture": None,
            "annual_ret": None, "annual_vol": None, "max_drawdown": None,
            "week52_high": None, "week52_low": None,
            "annual_yield_pct": 0, "annual_income": 0, "monthly_income": 0,
            "nav_erosion_pct": round((nav_erosion.get(t, 0)) * 100, 2),
        }

        if t not in close_df.columns:
            result_holdings.append(row)
            weights_list.append(weight)
            continue

        tc = close_df[t].dropna()
        if len(tc) < 10:
            result_holdings.append(row)
            weights_list.append(weight)
            continue

        daily_ret = tc.pct_change().dropna()
        returns_cols[t] = daily_ret

        # Current price and shares
        cur_price = float(tc.iloc[-1])
        row["current_price"] = round(cur_price, 2)
        row["shares"] = round(amt / cur_price, 4) if cur_price > 0 else 0

        # 52-week
        row["week52_high"] = round(float(tc.max()), 2)
        row["week52_low"] = round(float(tc.min()), 2)

        # Annualized return and vol
        n_days = len(tc)
        total_ret = float(tc.iloc[-1] / tc.iloc[0]) - 1.0
        ann_ret = (1 + total_ret) ** (252 / max(n_days, 1)) - 1.0
        ann_vol = float(daily_ret.std()) * np.sqrt(252) if len(daily_ret) > 1 else None

        row["annual_ret"] = round(ann_ret * 100, 2)
        row["annual_vol"] = round(ann_vol * 100, 2) if ann_vol is not None else None
        row["annual_total_ret"] = row["annual_ret"]

        # Ticker score (includes ulcer index)
        score, sharpe, sortino, calmar, omega, mdd, dc, ulcer = ticker_score(tc, daily_ret, bench_ret)
        row["score"] = score
        row["grade"] = letter_grade(score)
        row["sharpe"] = sharpe
        row["sortino"] = sortino
        row["calmar"] = calmar
        row["omega"] = omega
        row["max_drawdown"] = round(mdd * 100, 2) if mdd is not None else None
        row["down_capture"] = dc
        row["ulcer_index"] = ulcer

        # Up capture
        if bench_ret is not None:
            uc, _ = _capture_ratios(daily_ret, bench_ret)
            row["up_capture"] = uc

        # Dividend income — try info first, fall back to dividend history
        try:
            yf_ticker = yf.Ticker(t)
            info = yf_ticker.info or {}
            div_yield = info.get("yield") or 0
            # dividendYield from yfinance can be a percentage (e.g. 11.84) or
            # decimal (e.g. 0.1184) depending on the ticker — use "yield" which
            # is consistently a decimal, and fall back to dividendYield only if
            # it looks like a decimal (< 1)
            if div_yield == 0:
                dy = info.get("dividendYield") or 0
                if dy > 0:
                    div_yield = dy / 100 if dy > 1 else dy

            # Fallback: compute yield from dividend history, annualizing if < 1 year
            if div_yield == 0 and cur_price > 0:
                try:
                    divs = yf_ticker.dividends
                    if divs is not None and len(divs) > 0:
                        cutoff = divs.index[-1] - pd.Timedelta(days=365)
                        recent_divs = divs[divs.index >= cutoff]
                        if len(recent_divs) > 0:
                            total_div = float(recent_divs.sum())
                            span_days = (recent_divs.index[-1] - recent_divs.index[0]).days
                            if span_days < 300 and len(recent_divs) >= 2:
                                # Short history: annualize using avg payment × estimated frequency
                                avg_gap = span_days / (len(recent_divs) - 1)
                                payments_per_year = 365.0 / max(avg_gap, 1)
                                avg_payment = total_div / len(recent_divs)
                                annual_div_per_share = avg_payment * payments_per_year
                            else:
                                annual_div_per_share = total_div
                            div_yield = annual_div_per_share / cur_price
                except Exception:
                    pass

            # Fallback 2: check distributions (for return-of-capital / covered-call ETFs)
            if div_yield == 0 and cur_price > 0:
                try:
                    actions = yf_ticker.actions
                    if actions is not None and "Dividends" in actions.columns:
                        div_col = actions["Dividends"]
                        div_col = div_col[div_col > 0]
                        if len(div_col) > 0:
                            cutoff = div_col.index[-1] - pd.Timedelta(days=365)
                            recent = div_col[div_col.index >= cutoff]
                            if len(recent) > 0:
                                total_div = float(recent.sum())
                                span_days = (recent.index[-1] - recent.index[0]).days
                                if span_days < 300 and len(recent) >= 2:
                                    avg_gap = span_days / (len(recent) - 1)
                                    payments_per_year = 365.0 / max(avg_gap, 1)
                                    avg_payment = total_div / len(recent)
                                    annual_div_per_share = avg_payment * payments_per_year
                                else:
                                    annual_div_per_share = total_div
                                div_yield = annual_div_per_share / cur_price
                except Exception:
                    pass

            row["annual_yield_pct"] = round(div_yield * 100, 2)
            row["annual_income"] = round(amt * div_yield, 2)
            row["monthly_income"] = round(amt * div_yield / 12, 2)
        except Exception:
            pass

        result_holdings.append(row)
        weights_list.append(weight)

    # Portfolio-level metrics
    if returns_cols:
        # Exclude tickers with < 30 data points so they don't truncate
        # the overlap window below the grading minimum
        long_cols = {t: s for t, s in returns_cols.items() if len(s) >= 30}
        if not long_cols:
            long_cols = returns_cols  # fallback: use whatever we have
        returns_df = pd.DataFrame(long_cols).dropna()
        available = [t for t in tickers if t in long_cols]
        avail_weights = np.array([weights_list[tickers.index(t)] for t in available])
        if avail_weights.sum() > 0:
            avail_weights = avail_weights / avail_weights.sum()
        port_grade = grade_portfolio(returns_df[available], avail_weights, bench_ret)
    else:
        port_grade = {"grade": {"overall": "N/A", "score": 0, "breakdown": []}}
        returns_df = pd.DataFrame()
        available = []

    # NAV Health factor — add to grade breakdown
    if returns_cols and available:
        weighted_nav = sum(
            avail_weights[i] * nav_erosion.get(available[i], 0)
            for i in range(len(available))
        )
        if weighted_nav < 0:
            nav_health_score = max(0.0, 100.0 + weighted_nav * 200.0)
        else:
            nav_health_score = 100.0

        port_grade["grade"]["breakdown"].append({
            "category": "NAV Health",
            "score": round(nav_health_score, 1),
            "weight": 10,
            "grade": letter_grade(nav_health_score),
        })
        # Recalculate overall
        total_w = sum(b["weight"] for b in port_grade["grade"]["breakdown"])
        total_s = sum(b["score"] * b["weight"] for b in port_grade["grade"]["breakdown"])
        new_score = round(total_s / total_w, 1) if total_w > 0 else 0.0
        port_grade["grade"]["score"] = new_score
        port_grade["grade"]["overall"] = letter_grade(new_score)
        port_grade["nav_erosion_avg_pct"] = round(weighted_nav * 100, 2)

    port_grade["n_holdings"] = len(tickers)
    port_grade["total_value"] = round(total_value, 2)
    ann_income = sum(h["annual_income"] for h in result_holdings)
    port_grade["est_annual_income"] = round(ann_income, 2)
    port_grade["est_monthly_income"] = round(ann_income / 12, 2)

    # Correlation matrix
    corr_data = None
    if len(returns_cols) > 1:
        corr_df = pd.DataFrame(returns_cols).dropna().corr()
        labels = list(corr_df.columns)
        matrix = []
        for i in range(len(labels)):
            row = []
            for j in range(len(labels)):
                v = corr_df.iloc[i, j]
                row.append(round(float(v), 3) if not (math.isnan(v) or math.isinf(v)) else 0)
            matrix.append(row)
        corr_data = {"labels": labels, "matrix": matrix}

    # Drawdown series
    dd_data = None
    if returns_cols and available:
        port_daily = returns_df[available].dot(avail_weights)
        port_cum = (1 + port_daily).cumprod()
        running_max = port_cum.cummax()
        drawdown = ((port_cum - running_max) / running_max) * 100
        dates = [d.strftime("%Y-%m-%d") for d in drawdown.index]
        vals = [round(float(v), 2) for v in drawdown.values]
        # Subsample if > 300 points
        if len(dates) > 300:
            step = len(dates) // 300
            dates = dates[::step]
            vals = vals[::step]
        dd_data = {"dates": dates, "values": vals}

    return jsonify({
        "portfolio_id": port_id,
        "portfolio_name": pname["name"] if pname else "",
        "portfolio_metrics": port_grade,
        "holdings": result_holdings,
        "correlation": corr_data,
        "drawdown_series": dd_data,
    })


# ── Portfolio Builder Compare ────────────────────────────────────────────────

@app.route("/api/builder/compare", methods=["POST"])
def builder_compare():
    import numpy as np
    import yfinance as yf
    from grading import grade_portfolio, letter_grade

    data = request.get_json() or {}
    port_ids = data.get("portfolio_ids", [])
    period = data.get("period", "1y")
    benchmark = (data.get("benchmark") or "SPY").strip().upper()

    if len(port_ids) < 2:
        return jsonify({"error": "Select at least 2 portfolios"}), 400

    conn = get_connection()
    results = []

    # Gather all tickers across all portfolios
    all_tickers_set = {benchmark}
    port_data = []
    for pid in port_ids:
        rows = conn.execute(
            "SELECT ticker, dollar_amount FROM builder_holdings WHERE portfolio_id = ?", (pid,)).fetchall()
        pname = conn.execute("SELECT name FROM builder_portfolios WHERE id = ?", (pid,)).fetchone()
        holdings = [{"ticker": r["ticker"].upper(), "dollar_amount": float(r["dollar_amount"])} for r in rows]
        for h in holdings:
            all_tickers_set.add(h["ticker"])
        port_data.append({"id": pid, "name": pname["name"] if pname else f"Portfolio {pid}", "holdings": holdings})
    conn.close()

    all_tickers = list(all_tickers_set)
    try:
        df = yf.download(all_tickers, period=period, auto_adjust=True, progress=False)
    except Exception as e:
        return jsonify({"error": f"yfinance download failed: {e}"}), 500

    if df.empty:
        return jsonify({"error": "No price data"}), 500

    if isinstance(df.columns, pd.MultiIndex):
        close_df = df["Close"]
    else:
        close_df = df if len(all_tickers) > 1 else pd.DataFrame({all_tickers[0]: df["Close"]})

    close_df = close_df.ffill().dropna(how="all")
    bench_ret = close_df[benchmark].pct_change().dropna() if benchmark in close_df.columns else None

    for p in port_data:
        holdings = p["holdings"]
        total_val = sum(h["dollar_amount"] for h in holdings)
        if total_val <= 0:
            continue

        avail_tickers = [h["ticker"] for h in holdings if h["ticker"] in close_df.columns]
        if not avail_tickers:
            continue

        # Build returns per ticker, then exclude short-history tickers
        # (< 30 days) so they don't truncate the overlap below grading minimum
        returns_cols = {}
        for t in avail_tickers:
            col = close_df[t].dropna()
            if len(col) >= 2:
                returns_cols[t] = col.pct_change().dropna()
        if not returns_cols:
            continue
        long_cols = {t: s for t, s in returns_cols.items() if len(s) >= 30}
        if not long_cols:
            long_cols = returns_cols  # fallback
        returns_df = pd.DataFrame(long_cols).dropna()
        if len(returns_df) < 2:
            returns_df = pd.DataFrame(long_cols).fillna(0)
        used_tickers = list(long_cols.keys())
        weights = np.array([next(h["dollar_amount"] for h in holdings if h["ticker"] == t) for t in used_tickers])
        weights = weights / weights.sum()

        pg = grade_portfolio(returns_df[used_tickers], weights, bench_ret)

        # Add NAV Health to match analyze endpoint grading
        nav_erosion = _compute_nav_erosion(close_df, used_tickers)
        weighted_nav = sum(
            weights[i] * nav_erosion.get(used_tickers[i], 0)
            for i in range(len(used_tickers))
        )
        nav_health_score = max(0.0, 100.0 + weighted_nav * 200.0) if weighted_nav < 0 else 100.0
        pg["grade"]["breakdown"].append({
            "category": "NAV Health",
            "score": round(nav_health_score, 1),
            "weight": 10,
            "grade": letter_grade(nav_health_score),
        })
        total_w = sum(b["weight"] for b in pg["grade"]["breakdown"])
        total_s = sum(b["score"] * b["weight"] for b in pg["grade"]["breakdown"])
        new_score = round(total_s / total_w, 1) if total_w > 0 else 0.0
        pg["grade"]["score"] = new_score
        pg["grade"]["overall"] = letter_grade(new_score)

        ann_income = 0
        for h in holdings:
            try:
                info = yf.Ticker(h["ticker"]).info or {}
                dy = info.get("yield") or 0
                if dy == 0:
                    raw_dy = info.get("dividendYield") or 0
                    if raw_dy > 0:
                        dy = raw_dy / 100 if raw_dy > 1 else raw_dy
                ann_income += h["dollar_amount"] * dy
            except Exception:
                pass

        results.append({
            "id": p["id"],
            "name": p["name"],
            "score": pg["grade"]["score"],
            "grade": pg["grade"]["overall"],
            "monthly_income": round(ann_income / 12, 2),
            "sharpe": pg.get("sharpe"),
            "sortino": pg.get("sortino"),
            "calmar": pg.get("calmar"),
            "omega": pg.get("omega"),
            "ulcer_index": pg.get("ulcer_index"),
            "max_drawdown": pg.get("max_drawdown"),
            "effective_n": pg.get("effective_n"),
            "breakdown": {b["category"]: b["score"] for b in pg["grade"]["breakdown"]},
        })

    return jsonify({"results": results})


# ── Portfolio Builder All Weather ────────────────────────────────────────────

ALL_WEATHER_TARGETS_INCOME = [
    {"asset_class": "US Stocks",         "target_pct": 30.0, "etfs": ["SCHD", "SPYI", "QQQI", "JEPQ", "O", "MAIN"]},
    {"asset_class": "Long-Term Bonds",   "target_pct": 40.0, "etfs": ["TLT", "TLTW", "EDV"]},
    {"asset_class": "Intermediate Bonds", "target_pct": 15.0, "etfs": ["VCIT", "BND", "AGG"]},
    {"asset_class": "Gold",              "target_pct": 5.0,  "etfs": ["IAUI", "KGLD", "GLDN", "GLDM", "GLD", "IAU"]},
    {"asset_class": "Silver",            "target_pct": 2.5,  "etfs": ["KSLV", "SVLX"]},
    {"asset_class": "Commodities",       "target_pct": 7.5,  "etfs": ["PDBC", "DJP", "GSG"]},
]

ALL_WEATHER_TARGETS_GROWTH = [
    {"asset_class": "US Stocks",         "target_pct": 30.0, "etfs": ["VTI", "VOO", "QQQ", "VUG", "SCHG"]},
    {"asset_class": "Long-Term Bonds",   "target_pct": 40.0, "etfs": ["TLT", "EDV", "ZROZ"]},
    {"asset_class": "Intermediate Bonds", "target_pct": 15.0, "etfs": ["IEF", "BND", "GOVT"]},
    {"asset_class": "Gold",              "target_pct": 7.5,  "etfs": ["GLD", "GLDM", "IAU"]},
    {"asset_class": "Commodities",       "target_pct": 7.5,  "etfs": ["DJP", "PDBC", "GSG"]},
]

# ── Income Factory Targets (Steven Bavaria style: 2/3 credit, 1/3 equity-income) ──

INCOME_FACTORY_TARGETS_INCOME = [
    {"asset_class": "Covered Call ETFs",     "target_pct": 20.0, "etfs": ["SPYI", "QQQI", "JEPQ", "JEPI", "XYLD"]},
    {"asset_class": "High-Yield Bonds",      "target_pct": 20.0, "etfs": ["HYG", "JNK", "HYGV", "USHY"]},
    {"asset_class": "Senior Loans / CLOs",   "target_pct": 15.0, "etfs": ["JAAA", "CLOZ", "SRLN", "FLOT"]},
    {"asset_class": "BDCs",                  "target_pct": 15.0, "etfs": ["BIZD", "ARCC", "MAIN", "HTGC"]},
    {"asset_class": "REITs",                 "target_pct": 10.0, "etfs": ["O", "VNQ", "STAG", "NNN"]},
    {"asset_class": "MLPs & Infrastructure", "target_pct": 10.0, "etfs": ["MLPA", "AMLP", "TPVG"]},
    {"asset_class": "Preferred Stock",       "target_pct": 10.0, "etfs": ["PFF", "PGX", "PFFD"]},
]

INCOME_FACTORY_TARGETS_GROWTH = [
    {"asset_class": "Dividend Growth",       "target_pct": 20.0, "etfs": ["SCHD", "VIG", "DGRO", "DGRW"]},
    {"asset_class": "Covered Call ETFs",     "target_pct": 15.0, "etfs": ["SPYI", "QQQI", "JEPQ", "JEPI"]},
    {"asset_class": "High-Yield Bonds",      "target_pct": 15.0, "etfs": ["HYG", "JNK", "HYGV"]},
    {"asset_class": "Senior Loans / CLOs",   "target_pct": 15.0, "etfs": ["JAAA", "CLOZ", "SRLN", "FLOT"]},
    {"asset_class": "BDCs",                  "target_pct": 10.0, "etfs": ["BIZD", "ARCC", "MAIN"]},
    {"asset_class": "REITs",                 "target_pct": 10.0, "etfs": ["O", "VNQ", "STAG"]},
    {"asset_class": "MLPs & Infrastructure", "target_pct": 10.0, "etfs": ["MLPA", "AMLP", "TPVG"]},
    {"asset_class": "Preferred Stock",       "target_pct": 5.0,  "etfs": ["PFF", "PGX", "PFFD"]},
]

# ── Covered Call Income Portfolio ──────────────────────────────────────────
# Heavy allocation to covered-call / option-income ETFs for maximum premium income.

COVERED_CALL_TARGETS_INCOME = [
    {"asset_class": "S&P 500 Covered Calls",  "target_pct": 25.0, "etfs": ["SPYI", "JEPI", "XYLD", "PBP"]},
    {"asset_class": "Nasdaq Covered Calls",    "target_pct": 20.0, "etfs": ["QQQI", "JEPQ", "QYLD", "QYLG"]},
    {"asset_class": "Single-Stock CC / Yield", "target_pct": 15.0, "etfs": ["TSLY", "NVDY", "CONY", "MSTY", "AMZY", "APLY"]},
    {"asset_class": "Russell 2000 / Broad CC", "target_pct": 10.0, "etfs": ["RYLD", "RYLG", "IWMI"]},
    {"asset_class": "Dividend Growth Anchor",  "target_pct": 15.0, "etfs": ["SCHD", "VIG", "DGRO", "DGRW"]},
    {"asset_class": "Bonds / Stability",       "target_pct": 10.0, "etfs": ["JAAA", "BND", "VCIT", "AGG"]},
    {"asset_class": "REITs / Alternatives",    "target_pct": 5.0,  "etfs": ["O", "VNQ", "STAG", "NNN"]},
]

COVERED_CALL_TARGETS_GROWTH = [
    {"asset_class": "S&P 500 Covered Calls",  "target_pct": 20.0, "etfs": ["SPYI", "JEPI", "JEPY"]},
    {"asset_class": "Nasdaq Covered Calls",    "target_pct": 20.0, "etfs": ["QQQI", "JEPQ", "QYLG"]},
    {"asset_class": "Dividend Growth Core",    "target_pct": 25.0, "etfs": ["SCHD", "VIG", "DGRO", "DGRW"]},
    {"asset_class": "Russell 2000 / Broad CC", "target_pct": 10.0, "etfs": ["RYLD", "RYLG", "IWMI"]},
    {"asset_class": "Growth Equity",           "target_pct": 10.0, "etfs": ["VUG", "QQQ", "SCHG", "VTI"]},
    {"asset_class": "Bonds / Stability",       "target_pct": 10.0, "etfs": ["JAAA", "BND", "IEF", "GOVT"]},
    {"asset_class": "REITs / Alternatives",    "target_pct": 5.0,  "etfs": ["O", "VNQ", "STAG"]},
]


# ── Dividend Growth Portfolio ──────────────────────────────────────────────
# Focus on companies/ETFs with strong dividend growth track records.

DIVIDEND_GROWTH_TARGETS_INCOME = [
    {"asset_class": "Dividend Aristocrats",    "target_pct": 25.0, "etfs": ["NOBL", "SDY", "KNG"]},
    {"asset_class": "Broad Dividend Growth",   "target_pct": 25.0, "etfs": ["SCHD", "VIG", "DGRO", "DGRW"]},
    {"asset_class": "High-Yield Dividend",     "target_pct": 15.0, "etfs": ["HDV", "VYM", "SPYD", "DVY"]},
    {"asset_class": "International Dividend",  "target_pct": 10.0, "etfs": ["VIGI", "IDV", "SCHY", "DWX"]},
    {"asset_class": "REITs",                   "target_pct": 10.0, "etfs": ["O", "VNQ", "STAG", "NNN"]},
    {"asset_class": "Utilities / Staples",     "target_pct": 10.0, "etfs": ["XLU", "VPU", "XLP", "VDC"]},
    {"asset_class": "Bonds / Stability",       "target_pct": 5.0,  "etfs": ["BND", "VCIT", "AGG", "JAAA"]},
]

DIVIDEND_GROWTH_TARGETS_GROWTH = [
    {"asset_class": "Dividend Aristocrats",    "target_pct": 20.0, "etfs": ["NOBL", "SDY", "KNG"]},
    {"asset_class": "Broad Dividend Growth",   "target_pct": 30.0, "etfs": ["SCHD", "VIG", "DGRO", "DGRW"]},
    {"asset_class": "Quality / Low Vol",       "target_pct": 15.0, "etfs": ["QUAL", "SPHQ", "USMV", "SPLV"]},
    {"asset_class": "International Dividend",  "target_pct": 10.0, "etfs": ["VIGI", "IDV", "SCHY"]},
    {"asset_class": "Growth Equity",           "target_pct": 15.0, "etfs": ["VUG", "QQQ", "SCHG", "VTI"]},
    {"asset_class": "Bonds / Stability",       "target_pct": 10.0, "etfs": ["BND", "IEF", "GOVT", "JAAA"]},
]

# ── Retirement Income (Bucket Strategy) ───────────────────────────────────
# 3-bucket approach: near-term cash, medium-term bonds, long-term growth.

RETIREMENT_INCOME_TARGETS_INCOME = [
    {"asset_class": "Cash / Ultra-Short",      "target_pct": 15.0, "etfs": ["SGOV", "BIL", "SHV", "USFR"]},
    {"asset_class": "Short-Term Bonds",        "target_pct": 15.0, "etfs": ["JAAA", "VCSH", "SCHO", "FLOT"]},
    {"asset_class": "Intermediate Bonds",      "target_pct": 15.0, "etfs": ["VCIT", "BND", "AGG", "SCHZ"]},
    {"asset_class": "Dividend Income",         "target_pct": 20.0, "etfs": ["SCHD", "VYM", "HDV", "SPYD"]},
    {"asset_class": "Covered Call Income",     "target_pct": 15.0, "etfs": ["SPYI", "JEPI", "QQQI", "JEPQ"]},
    {"asset_class": "REITs",                   "target_pct": 10.0, "etfs": ["O", "VNQ", "STAG", "NNN"]},
    {"asset_class": "TIPS / Inflation Hedge",  "target_pct": 10.0, "etfs": ["TIP", "SCHP", "VTIP", "STIP"]},
]

RETIREMENT_INCOME_TARGETS_GROWTH = [
    {"asset_class": "Cash / Ultra-Short",      "target_pct": 10.0, "etfs": ["SGOV", "BIL", "SHV", "USFR"]},
    {"asset_class": "Short-Term Bonds",        "target_pct": 10.0, "etfs": ["JAAA", "VCSH", "SCHO"]},
    {"asset_class": "Intermediate Bonds",      "target_pct": 15.0, "etfs": ["VCIT", "BND", "AGG"]},
    {"asset_class": "Dividend Growth",         "target_pct": 20.0, "etfs": ["SCHD", "VIG", "DGRO", "DGRW"]},
    {"asset_class": "US Equity Growth",        "target_pct": 20.0, "etfs": ["VTI", "VOO", "VUG", "QQQ"]},
    {"asset_class": "International Equity",    "target_pct": 10.0, "etfs": ["VXUS", "VEA", "VIGI", "SCHY"]},
    {"asset_class": "TIPS / Inflation Hedge",  "target_pct": 10.0, "etfs": ["TIP", "SCHP", "VTIP", "STIP"]},
    {"asset_class": "REITs",                   "target_pct": 5.0,  "etfs": ["VNQ", "O", "STAG"]},
]

# ── Growth / Aggressive Growth Portfolio ──────────────────────────────────
# Capital appreciation focused, heavy tech/innovation, minimal income.

GROWTH_TARGETS_INCOME = [
    {"asset_class": "US Large-Cap Growth",     "target_pct": 30.0, "etfs": ["VUG", "SCHG", "IWF", "SPYG"]},
    {"asset_class": "Nasdaq / Tech",           "target_pct": 25.0, "etfs": ["QQQ", "QQQM", "XLK", "VGT"]},
    {"asset_class": "Semiconductors",          "target_pct": 10.0, "etfs": ["SMH", "SOXX", "XSD"]},
    {"asset_class": "Mid-Cap Growth",          "target_pct": 10.0, "etfs": ["VOT", "IJK", "MDYG"]},
    {"asset_class": "Small-Cap Growth",        "target_pct": 5.0,  "etfs": ["VBK", "IJT", "SLYG"]},
    {"asset_class": "International Growth",    "target_pct": 10.0, "etfs": ["VXUS", "VEA", "EFG", "VWO"]},
    {"asset_class": "Bonds / Stability",       "target_pct": 10.0, "etfs": ["BND", "JAAA", "VCSH", "AGG"]},
]

GROWTH_TARGETS_GROWTH = [
    {"asset_class": "US Large-Cap Growth",     "target_pct": 30.0, "etfs": ["VUG", "SCHG", "IWF", "SPYG"]},
    {"asset_class": "Nasdaq / Tech",           "target_pct": 25.0, "etfs": ["QQQ", "QQQM", "XLK", "VGT"]},
    {"asset_class": "Semiconductors",          "target_pct": 15.0, "etfs": ["SMH", "SOXX", "XSD"]},
    {"asset_class": "Innovation / Thematic",   "target_pct": 10.0, "etfs": ["ARKK", "ARKW", "MOON", "KOMP"]},
    {"asset_class": "Mid-Cap Growth",          "target_pct": 10.0, "etfs": ["VOT", "IJK", "MDYG"]},
    {"asset_class": "Small-Cap Growth",        "target_pct": 5.0,  "etfs": ["VBK", "IJT", "SLYG"]},
    {"asset_class": "International Growth",    "target_pct": 5.0,  "etfs": ["EFG", "VWO", "VXUS"]},
]


def get_strategy_targets(strategy, mode):
    """Pick the right target allocation list based on strategy + mode."""
    if strategy == "income_factory":
        return INCOME_FACTORY_TARGETS_INCOME if mode == "income" else INCOME_FACTORY_TARGETS_GROWTH
    if strategy == "covered_call":
        return COVERED_CALL_TARGETS_INCOME if mode == "income" else COVERED_CALL_TARGETS_GROWTH
    if strategy == "dividend_growth":
        return DIVIDEND_GROWTH_TARGETS_INCOME if mode == "income" else DIVIDEND_GROWTH_TARGETS_GROWTH
    if strategy == "retirement_income":
        return RETIREMENT_INCOME_TARGETS_INCOME if mode == "income" else RETIREMENT_INCOME_TARGETS_GROWTH
    if strategy == "growth":
        return GROWTH_TARGETS_INCOME if mode == "income" else GROWTH_TARGETS_GROWTH
    return ALL_WEATHER_TARGETS_INCOME if mode == "income" else ALL_WEATHER_TARGETS_GROWTH


@app.route("/api/builder/all-weather", methods=["POST"])
def builder_all_weather():
    data = request.get_json() or {}
    mode = data.get("mode", "income")
    budget = float(data.get("budget", 100000))
    strategy = data.get("strategy", "all_weather")
    funds_per_class = min(int(data.get("funds_per_class", 1)), 4)
    if funds_per_class < 1:
        funds_per_class = 1

    targets = get_strategy_targets(strategy, mode)

    # Get user's existing holdings for matching
    _, h_pids = get_profile_filter()
    conn = get_connection()
    h_ph = ",".join("?" * len(h_pids))
    existing = conn.execute(
        f"SELECT ticker, current_value FROM holdings WHERE profile_id IN ({h_ph})", h_pids
    ).fetchall()
    conn.close()
    existing_map = {r["ticker"].upper(): float(r["current_value"] or 0) for r in existing}

    allocations = []
    used_tickers = set()  # no duplicate tickers across classes
    for slot in targets:
        candidates = slot["etfs"]
        class_budget = budget * slot["target_pct"] / 100

        # Rank candidates: existing holdings first (by value desc), then remaining
        owned = [(etf, existing_map[etf.upper()]) for etf in candidates if etf.upper() in existing_map]
        owned.sort(key=lambda x: -x[1])
        not_owned = [etf for etf in candidates if etf.upper() not in existing_map]
        ranked = [etf for etf, _ in owned] + not_owned

        # Filter out already-used tickers
        available = [etf for etf in ranked if etf.upper() not in used_tickers]
        n_funds = min(funds_per_class, len(available))
        if n_funds < 1:
            n_funds = 1
            available = ranked[:1]  # fallback: reuse if no alternatives
        per_fund = round(class_budget / n_funds, 2)

        for i in range(n_funds):
            ticker = available[i]
            used_tickers.add(ticker.upper())
            source = "existing" if ticker.upper() in existing_map else "recommended"
            # Last fund gets any rounding remainder
            amt = per_fund if i < n_funds - 1 else round(class_budget - per_fund * (n_funds - 1), 2)
            allocations.append({
                "asset_class": slot["asset_class"],
                "target_pct": round(slot["target_pct"] / n_funds, 2),
                "ticker": ticker,
                "source": source,
                "dollar_amount": amt,
                "candidates": [c for c in candidates if c.upper() not in used_tickers or c.upper() == ticker.upper()],
            })

    return jsonify({"allocations": allocations, "mode": mode, "budget": budget})


# ── Settings API ──────────────────────────────────────────────────────────────

@app.route("/api/single-stock-etfs", methods=["GET"])
def get_single_stock_etfs():
    """Return built-in and user-added single-stock ETFs."""
    conn = get_connection()
    row = conn.execute("SELECT value FROM settings WHERE key = 'single_stock_etfs'").fetchone()
    conn.close()
    user_added = []
    if row and row["value"]:
        user_added = [t.strip().upper() for t in row["value"].split(",") if t.strip()]
    return jsonify({
        "builtin": sorted(_DEFAULT_SINGLE_STOCK_ETFS),
        "user_added": sorted(set(user_added)),
    })


@app.route("/api/single-stock-etfs", methods=["POST"])
def save_single_stock_etfs():
    """Save user-added single-stock ETF tickers."""
    data = request.get_json() or {}
    tickers = data.get("tickers", [])
    # Normalize and deduplicate, exclude any already in defaults
    cleaned = sorted({t.strip().upper() for t in tickers if t.strip()} - _DEFAULT_SINGLE_STOCK_ETFS)
    value = ",".join(cleaned)
    conn = get_connection()
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                 ("single_stock_etfs", value))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "user_added": cleaned})


@app.route("/api/settings", methods=["GET"])
def get_settings():
    conn = get_connection()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    out = {}
    for r in rows:
        k = r["key"]
        v = r["value"]
        # Mask sensitive keys
        if "key" in k.lower() or "secret" in k.lower():
            out[k] = v[:4] + "..." + v[-4:] if v and len(v) > 8 else "***"
        else:
            out[k] = v
    return jsonify(out)


@app.route("/api/settings", methods=["POST"])
def save_settings():
    data = request.get_json() or {}
    conn = get_connection()
    for k, v in data.items():
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, str(v)))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── Portfolio Builder Rebalance ────────────────────────────────────────────────

@app.route("/api/builder/portfolios/<int:pid>/rebalance", methods=["POST"])
def builder_rebalance(pid):
    data = request.get_json() or {}
    mode = data.get("mode", "income")
    strategy = data.get("strategy", "all_weather")

    targets = get_strategy_targets(strategy, mode)

    # Fetch portfolio holdings
    conn = get_connection()
    rows = conn.execute(
        "SELECT ticker, dollar_amount FROM builder_holdings WHERE portfolio_id = ?", (pid,)
    ).fetchall()
    if not rows:
        conn.close()
        return jsonify({"error": "Portfolio has no holdings"}), 400

    port_holdings = [{"ticker": r["ticker"].upper(), "amount": float(r["dollar_amount"] or 0)} for r in rows]
    total_value = sum(h["amount"] for h in port_holdings)
    if total_value <= 0:
        conn.close()
        return jsonify({"error": "Portfolio total value is zero"}), 400

    # Build ETF → asset class lookup
    etf_to_class = {}
    for slot in targets:
        for etf in slot["etfs"]:
            etf_to_class[etf.upper()] = slot["asset_class"]

    # Classify holdings
    class_holdings = {slot["asset_class"]: [] for slot in targets}
    unclassified = []
    for h in port_holdings:
        ac = etf_to_class.get(h["ticker"])
        if ac:
            class_holdings[ac].append(h)
        else:
            unclassified.append(h)

    # Get user's real holdings for suggesting new ETFs
    _, r_pids = get_profile_filter()
    r_ph = ",".join("?" * len(r_pids))
    existing = conn.execute(
        f"SELECT ticker, current_value FROM holdings WHERE profile_id IN ({r_ph})", r_pids
    ).fetchall()
    conn.close()
    existing_map = {r["ticker"].upper(): float(r["current_value"] or 0) for r in existing}

    suggestions = []
    for slot in targets:
        ac = slot["asset_class"]
        current_amount = sum(h["amount"] for h in class_holdings[ac])
        current_pct = round(current_amount / total_value * 100, 1)
        target_pct = slot["target_pct"]
        drift_pct = round(current_pct - target_pct, 1)
        target_amount = round(total_value * target_pct / 100, 2)
        change_amount = round(target_amount - current_amount, 2)

        # Determine action
        if not class_holdings[ac]:
            action = "add_new"
        elif change_amount > 0:
            action = "buy"
        elif change_amount < 0:
            action = "reduce"
        else:
            action = "on_target"

        # Suggest ETF: use existing holding in that class, or auto-select
        if class_holdings[ac]:
            suggested = max(class_holdings[ac], key=lambda h: h["amount"])["ticker"]
        else:
            # Same auto-select logic: prefer user's real holdings
            suggested = None
            best_val = -1
            for etf in slot["etfs"]:
                if etf.upper() in existing_map and existing_map[etf.upper()] > best_val:
                    best_val = existing_map[etf.upper()]
                    suggested = etf
            if suggested is None:
                suggested = slot["etfs"][0]

        suggestions.append({
            "asset_class": ac,
            "target_pct": target_pct,
            "current_pct": current_pct,
            "drift_pct": drift_pct,
            "current_amount": round(current_amount, 2),
            "target_amount": target_amount,
            "change_amount": change_amount,
            "action": action,
            "holdings": class_holdings[ac],
            "suggested_ticker": suggested,
        })

    return jsonify({
        "total_value": round(total_value, 2),
        "mode": mode,
        "suggestions": suggestions,
        "unclassified": unclassified,
    })


# ── Distribution Comparison ────────────────────────────────────────────────────

@app.route("/api/distribution-compare/lookup")
def distribution_compare_lookup():
    import yfinance as yf
    import warnings
    warnings.filterwarnings("ignore")

    ticker = request.args.get("ticker", "").strip().upper()
    if not ticker:
        return jsonify(error="No ticker provided."), 400

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="1y", auto_adjust=False, actions=True)
    except Exception as e:
        return jsonify(error=f"Failed to fetch data for {ticker}: {str(e)}"), 400

    if hist is None or hist.empty:
        return jsonify(error=f"No data found for {ticker}."), 404

    close = hist["Close"].dropna()
    if close.empty:
        return jsonify(error=f"No price data for {ticker}."), 404

    current_price = float(close.iloc[-1])
    divs = hist["Dividends"] if "Dividends" in hist.columns else pd.Series(0.0, index=hist.index)
    ttm_divs = float(divs.sum())
    ttm_yield = ttm_divs / current_price if current_price > 0 else 0.0
    yield_found = ttm_divs > 0

    return jsonify(
        ticker=ticker,
        price=round(current_price, 4),
        ttm_yield=round(ttm_yield * 100, 4),
        yield_found=yield_found,
    )


@app.route("/api/distribution-compare/run", methods=["POST"])
def distribution_compare_run():
    import traceback as _tb
    try:
        result = _distribution_compare_compute()
        if isinstance(result, dict) and "error" in result:
            return jsonify(error=result["error"])
        return jsonify(**result)
    except Exception as _e:
        return jsonify(error=f"Server error: {str(_e)}", detail=_tb.format_exc())


@app.route("/api/distribution-compare/export", methods=["POST"])
def distribution_compare_export():
    import traceback as _tb
    try:
        return _distribution_compare_export_inner()
    except Exception as _e:
        return jsonify(error=f"Server error: {str(_e)}")


def _distribution_compare_export_inner():
    from io import BytesIO
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, numbers

    result_data = _distribution_compare_compute()
    if isinstance(result_data, dict) and "error" in result_data:
        return jsonify(error=result_data["error"])

    wb = Workbook()
    # Summary sheet
    ws = wb.active
    ws.title = "Summary"
    header_font = Font(bold=True)
    ws.cell(row=1, column=1, value="Distribution Comparison Summary").font = Font(bold=True, size=14)
    ws.cell(row=2, column=1, value=f"Comparison Type: {result_data.get('comparison_type', '')}")
    ws.cell(row=3, column=1, value=f"Cash Wedge Initial: ${result_data.get('cash_wedge_initial', 0):,.2f}")

    summary_row = 5
    summary_headers = ["Metric", "Fund A", "Fund B"]
    if "fund_c" in result_data:
        summary_headers.append("Fund C")
    for ci, h in enumerate(summary_headers, 1):
        ws.cell(row=summary_row, column=ci, value=h).font = header_font

    fund_keys = ["fund_a", "fund_b"]
    if "fund_c" in result_data:
        fund_keys.append("fund_c")

    metrics = [
        ("Ticker", "ticker"),
        ("Role", "role"),
        ("Investment", "investment"),
        ("Initial Shares", "initial_shares"),
        ("Final Portfolio", "final_portfolio"),
        ("Final Withdrawn", "final_withdrawn"),
        ("Final Distributions", "final_distributions"),
        ("Final Total", "final_total"),
        ("Depleted", "depleted"),
    ]
    for mi, (metric_label, metric_key) in enumerate(metrics):
        row_num = summary_row + 1 + mi
        ws.cell(row=row_num, column=1, value=metric_label)
        for fi, fk in enumerate(fund_keys):
            if fk in result_data:
                val = result_data[fk].get(metric_key, "")
                ws.cell(row=row_num, column=2 + fi, value=val)

    # Fund detail sheets
    for fund_key in fund_keys:
        if fund_key not in result_data:
            continue
        fund = result_data[fund_key]
        ws_f = wb.create_sheet(title=f"{fund['ticker']} Detail")
        headers = ["Month", "Price", "Shares", "Portfolio", "Dist/Share", "Income",
                    "Withdrawal", "Excess", "Shares +/-", "Growth", "Cum Income",
                    "ROI ($)", "ROI (%)"]
        if fund.get("has_cash_wedge"):
            headers.insert(7, "CW Drawn")
            headers.insert(8, "CW Balance")
        if fund.get("drip") is False:
            headers.append("Cash Accumulated")
        for ci, h in enumerate(headers, 1):
            ws_f.cell(row=1, column=ci, value=h).font = header_font
        months = result_data.get("months", [])
        for ri, row in enumerate(fund["monthly_rows"], 2):
            vals = [months[ri - 2] if ri - 2 < len(months) else "",
                    row["price"], row["shares"], row["portfolio"],
                    row["dist_per_share"], row["income"], row["withdrawal"]]
            if fund.get("has_cash_wedge"):
                vals.extend([row.get("wedge_drawn", 0), row.get("wedge_bal", 0)])
            vals.extend([row["excess"], row["shares_delta"], row["growth"],
                         row["cum_income"], row["roi_dollar"], row["roi_pct"]])
            if fund.get("drip") is False:
                vals.append(row.get("cash_accumulated", 0))
            for ci, v in enumerate(vals, 1):
                ws_f.cell(row=ri, column=ci, value=v)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True,
                     download_name="distribution_comparison.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _distribution_compare_compute():
    """Core computation for distribution comparison. Returns a plain dict."""
    import yfinance as yf
    import numpy as np
    import warnings
    warnings.filterwarnings("ignore")
    from grading import _max_drawdown, _ulcer_index

    data = request.get_json(force=True, silent=True) or {}
    mode = data.get("mode", "historical")
    monthly_withdrawal = float(data.get("monthly_withdrawal", 0))
    if monthly_withdrawal < 0:
        return {"error": "Monthly withdrawal cannot be negative."}

    # Withdrawal strategy parameters
    withdrawal_strategy = data.get("withdrawal_strategy", "fixed")
    withdrawal_pct = float(data.get("withdrawal_pct", 4))
    inflation_rate = data.get("inflation_rate")
    if inflation_rate is not None:
        try:
            inflation_rate = float(inflation_rate)
        except (TypeError, ValueError):
            inflation_rate = None
    dynamic_reduce_pct = float(data.get("dynamic_reduce_pct", 25))
    dynamic_threshold_pct = float(data.get("dynamic_threshold_pct", 80))

    comparison_type = data.get("comparison_type", "income_vs_growth")
    cash_wedge_initial = float(data.get("cash_wedge", 0))
    if cash_wedge_initial < 0:
        cash_wedge_initial = 0.0

    growth_funds = set()
    if comparison_type == "income_vs_growth":
        growth_funds.add("fund_b")
    elif comparison_type == "growth_vs_growth":
        growth_funds.add("fund_a")
        growth_funds.add("fund_b")

    fund_a_input = data.get("fund_a", {})
    fund_b_input = data.get("fund_b", {})

    def _validate_fund(f, label):
        ticker = str(f.get("ticker", "")).strip().upper()
        if not ticker:
            return None, f"{label}: ticker is required."
        try:
            investment = float(f.get("investment", 0))
        except (TypeError, ValueError):
            return None, f"{label}: invalid investment amount."
        if investment <= 0:
            return None, f"{label}: investment must be greater than 0."
        yield_override = f.get("yield_override")
        if yield_override is not None and yield_override != "" and yield_override is not False:
            try:
                yield_override = float(yield_override)
                if yield_override <= 0:
                    yield_override = None
            except (TypeError, ValueError):
                yield_override = None
        else:
            yield_override = None
        drip = f.get("drip", True)
        return {"ticker": ticker, "investment": investment,
                "yield_override": yield_override, "drip": drip}, None

    fa, err = _validate_fund(fund_a_input, "Fund A")
    if err:
        return {"error": err}
    fb, err = _validate_fund(fund_b_input, "Fund B")
    if err:
        return {"error": err}

    # Optional Fund C
    fund_c_input = data.get("fund_c")
    fc = None
    if fund_c_input:
        fc, err = _validate_fund(fund_c_input, "Fund C")
        if err:
            return {"error": err}

    # Growth funds for fund_c
    if fc:
        if comparison_type == "income_vs_growth":
            growth_funds.add("fund_c")
        elif comparison_type == "growth_vs_growth":
            growth_funds.add("fund_c")
        # income_vs_income: fund_c stays as income (not in growth_funds)

    def _compute_effective_withdrawal(base_withdrawal, month_index, current_pv, initial_inv):
        """Compute effective withdrawal based on strategy + inflation."""
        if withdrawal_strategy == "percentage":
            eff = current_pv * (withdrawal_pct / 100.0 / 12.0)
        elif withdrawal_strategy == "dynamic":
            eff = base_withdrawal
            threshold = initial_inv * (dynamic_threshold_pct / 100.0)
            if current_pv < threshold:
                eff = eff * (1.0 - dynamic_reduce_pct / 100.0)
        else:
            eff = base_withdrawal
        # Apply inflation
        if inflation_rate is not None and inflation_rate != 0:
            eff *= (1.0 + inflation_rate / 100.0) ** (month_index / 12.0)
        return eff

    def _compute_risk_metrics(portfolio_values, monthly_rows):
        """Compute risk metrics for a fund's portfolio value series."""
        pv_series = pd.Series(portfolio_values)
        max_dd = _max_drawdown(pv_series) if len(pv_series) > 1 else None
        ulcer = _ulcer_index(pv_series)
        worst_month_val = min((r["growth"] for r in monthly_rows), default=0)
        worst_month_idx = next((i for i, r in enumerate(monthly_rows)
                                if r["growth"] == worst_month_val), None)
        recovery_months = None
        if max_dd is not None and max_dd < 0 and len(pv_series) > 1:
            running_max = pv_series.cummax()
            drawdowns = (pv_series - running_max) / running_max
            trough_idx = drawdowns.idxmin()
            peak_before = running_max.iloc[trough_idx]
            for ri in range(trough_idx + 1, len(pv_series)):
                if pv_series.iloc[ri] >= peak_before:
                    recovery_months = ri - trough_idx
                    break
        return {
            "max_drawdown_pct": round(max_dd * 100, 2) if max_dd else None,
            "ulcer_index": ulcer,
            "worst_month_value": round(worst_month_val, 2),
            "worst_month_idx": worst_month_idx,
            "recovery_months": recovery_months,
        }

    def _compute_depletion_month(depleted, monthly_rows):
        """Find the first month where depletion occurred."""
        if not depleted:
            return None
        for di, r in enumerate(monthly_rows):
            if r["shares"] == 0 and r["portfolio"] == 0:
                return di
        return None

    # ── HISTORICAL MODE ──
    if mode == "historical":
        duration_str = data.get("duration", "10y")

        all_funds = [fa, fb]
        if fc:
            all_funds.append(fc)
        tickers = [f["ticker"] for f in all_funds]
        unique_tickers = list(dict.fromkeys(tickers))

        try:
            raw = yf.download(
                unique_tickers, period="max", interval="1d",
                auto_adjust=False, actions=True, group_by="ticker", progress=False,
            )
        except Exception as e:
            return {"error": f"Failed to fetch data: {str(e)}"}

        if raw is None or raw.empty:
            return {"error": "No data returned from Yahoo Finance."}

        def _extract(sym):
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    top_keys = raw.columns.get_level_values(0).unique()
                    if sym in top_keys:
                        sub = raw[sym]
                        close = sub["Close"] if "Close" in sub.columns else None
                        divs = sub["Dividends"] if "Dividends" in sub.columns else pd.Series(0.0, index=raw.index)
                    elif "Close" in top_keys:
                        close = raw["Close"][sym] if sym in raw["Close"].columns else raw["Close"].iloc[:, 0]
                        divs_df = raw["Dividends"] if "Dividends" in top_keys else None
                        divs = divs_df[sym] if divs_df is not None and sym in divs_df.columns else pd.Series(0.0, index=raw.index)
                    else:
                        return None, None
                else:
                    close = raw["Close"] if "Close" in raw.columns else None
                    divs = raw["Dividends"] if "Dividends" in raw.columns else pd.Series(0.0, index=raw.index)
            except Exception:
                return None, None
            return close, divs

        common_start = None
        newer_ticker = None
        for fund in all_funds:
            close_tmp, _ = _extract(fund["ticker"])
            if close_tmp is None or close_tmp.dropna().empty:
                return {"error": f"No data found for {fund['ticker']}."}
            first_valid = close_tmp.dropna().index[0]
            if common_start is None or first_valid > common_start:
                common_start = first_valid
                newer_ticker = fund["ticker"]

        from datetime import datetime as _dt, timedelta
        available_months = (pd.Timestamp.now() - common_start).days / 30.44
        available_years = available_months / 12
        if duration_str != "max":
            requested_years = int(duration_str.replace("y", ""))
            if requested_years > available_years:
                max_yrs = int(available_years)
                return {"error": (
                    f"{newer_ticker} only has data from {common_start.strftime('%Y-%m-%d')} "
                    f"(~{max_yrs} year{'s' if max_yrs != 1 else ''} of overlap). "
                    f"Please select {max_yrs} year{'s' if max_yrs != 1 else ''} or less, or use Max."
                )}
            trim_start = pd.Timestamp(_dt.now() - timedelta(days=requested_years * 365))
            if trim_start > common_start:
                common_start = trim_start

        results = {}
        fund_list = [("fund_a", fa), ("fund_b", fb)]
        if fc:
            fund_list.append(("fund_c", fc))
        date_labels = []
        for label, fund in fund_list:
            sym = fund["ticker"]
            investment = fund["investment"]
            drip = fund["drip"]

            close, divs = _extract(sym)
            close = close[close.index >= common_start]
            divs = divs[divs.index >= common_start]

            monthly_close = close.resample("ME").last()
            monthly_divs = divs.resample("ME").sum()
            df_m = pd.DataFrame({"price": monthly_close, "div": monthly_divs}).dropna(subset=["price"])
            df_m["div"] = df_m["div"].fillna(0.0)

            if df_m.empty:
                return {"error": f"No usable monthly data for {sym}."}

            initial_price = float(df_m["price"].iloc[0])
            if initial_price <= 0:
                return {"error": f"Initial price for {sym} is zero."}

            is_growth = label in growth_funds
            wedge = cash_wedge_initial if is_growth else 0.0
            shares = investment / initial_price
            cum_withdrawals = 0.0
            cum_distributions = 0.0
            prev_pv = investment
            cash_accumulated = 0.0

            portfolio_values = []
            cumulative_withdrawals_list = []
            cumulative_distributions_list = []
            share_counts = []
            total_values = []
            monthly_rows = []
            depleted = False

            for month_index, (dt, row) in enumerate(df_m.iterrows()):
                price = float(row["price"])
                div_per_share = float(row["div"])

                if depleted or shares <= 0:
                    depleted = True
                    portfolio_values.append(0.0)
                    cumulative_withdrawals_list.append(round(cum_withdrawals, 2))
                    cumulative_distributions_list.append(round(cum_distributions, 2))
                    share_counts.append(0.0)
                    tv = cum_withdrawals + wedge + cash_accumulated
                    total_values.append(round(tv, 2))
                    row_data = {
                        "price": 0, "shares": 0, "portfolio": 0,
                        "dist_per_share": 0, "income": 0, "withdrawal": 0,
                        "wedge_drawn": 0, "wedge_bal": round(wedge, 2),
                        "excess": 0, "shares_delta": 0, "growth": 0,
                        "cum_income": round(cum_distributions, 2),
                        "roi_dollar": round(cum_withdrawals + wedge + cash_accumulated - investment - (cash_wedge_initial if is_growth else 0), 2),
                        "roi_pct": round(((cum_withdrawals + wedge + cash_accumulated - investment - (cash_wedge_initial if is_growth else 0)) / investment * 100), 2) if investment else 0,
                    }
                    if not drip:
                        row_data["cash_accumulated"] = round(cash_accumulated, 2)
                    monthly_rows.append(row_data)
                    continue

                shares_before = shares
                dist_this_month = div_per_share * shares
                cum_distributions += dist_this_month

                # Compute effective withdrawal for this month
                current_pv = shares * price
                effective_withdrawal = _compute_effective_withdrawal(
                    monthly_withdrawal, month_index, current_pv, investment)

                wedge_drawn = 0.0
                if is_growth:
                    need = effective_withdrawal
                    cw_draw = min(wedge, need)
                    wedge -= cw_draw
                    wedge_drawn = cw_draw
                    need -= cw_draw
                    div_used = min(dist_this_month, need)
                    need -= div_used
                    leftover_div = dist_this_month - div_used
                    if drip:
                        if leftover_div > 0 and price > 0:
                            shares += leftover_div / price
                    else:
                        cash_accumulated += leftover_div
                    if need > 0:
                        if not drip and cash_accumulated > 0:
                            cash_draw = min(cash_accumulated, need)
                            cash_accumulated -= cash_draw
                            need -= cash_draw
                        if need > 0 and price > 0:
                            shares -= need / price
                    cum_withdrawals += effective_withdrawal
                    excess = dist_this_month + cw_draw - effective_withdrawal
                else:
                    excess = dist_this_month - effective_withdrawal
                    if dist_this_month >= effective_withdrawal:
                        if drip:
                            if price > 0:
                                shares += excess / price
                        else:
                            cash_accumulated += excess
                        cum_withdrawals += effective_withdrawal
                    else:
                        shortfall = -excess
                        if not drip and cash_accumulated > 0:
                            cash_draw = min(cash_accumulated, shortfall)
                            cash_accumulated -= cash_draw
                            shortfall -= cash_draw
                        if shortfall > 0 and price > 0:
                            shares -= shortfall / price
                        cum_withdrawals += effective_withdrawal

                if shares <= 0:
                    shares = 0.0
                    depleted = True

                pv = shares * price
                growth = pv - prev_pv
                shares_delta = shares - shares_before
                total_basis = investment + (cash_wedge_initial if is_growth else 0)
                roi_dollar = pv + cum_withdrawals + wedge + cash_accumulated - total_basis
                roi_pct = roi_dollar / investment * 100 if investment else 0

                portfolio_values.append(round(pv, 2))
                cumulative_withdrawals_list.append(round(cum_withdrawals, 2))
                cumulative_distributions_list.append(round(cum_distributions, 2))
                share_counts.append(round(shares, 4))
                total_values.append(round(pv + cum_withdrawals + wedge + cash_accumulated, 2))
                row_data = {
                    "price": round(price, 2),
                    "shares": round(shares, 4),
                    "portfolio": round(pv, 2),
                    "dist_per_share": round(div_per_share, 4),
                    "income": round(dist_this_month, 2),
                    "withdrawal": round(effective_withdrawal, 2),
                    "wedge_drawn": round(wedge_drawn, 2),
                    "wedge_bal": round(wedge, 2),
                    "excess": round(excess, 2),
                    "shares_delta": round(shares_delta, 4),
                    "growth": round(growth, 2),
                    "cum_income": round(cum_distributions, 2),
                    "roi_dollar": round(roi_dollar, 2),
                    "roi_pct": round(roi_pct, 2),
                }
                if not drip:
                    row_data["cash_accumulated"] = round(cash_accumulated, 2)
                monthly_rows.append(row_data)
                prev_pv = pv

            date_labels = [dt.strftime("%Y-%m") for dt in df_m.index]
            total_bought = sum(r["shares_delta"] for r in monthly_rows if r["shares_delta"] > 0)
            total_sold = sum(-r["shares_delta"] for r in monthly_rows if r["shares_delta"] < 0)
            initial_shares = investment / initial_price
            role = "Growth" if is_growth else "Income"

            risk_metrics = _compute_risk_metrics(portfolio_values, monthly_rows)
            depletion_month = _compute_depletion_month(depleted, monthly_rows)

            fund_result = {
                "ticker": sym,
                "role": role,
                "investment": round(investment, 2),
                "initial_shares": round(initial_shares, 4),
                "has_cash_wedge": is_growth and cash_wedge_initial > 0,
                "cash_wedge_remaining": round(wedge, 2) if is_growth else None,
                "portfolio_values": portfolio_values,
                "cumulative_withdrawals": cumulative_withdrawals_list,
                "cumulative_distributions": cumulative_distributions_list,
                "total_values": total_values,
                "shares": share_counts,
                "monthly_rows": monthly_rows,
                "total_shares_bought": round(total_bought, 4),
                "total_shares_sold": round(total_sold, 4),
                "final_portfolio": portfolio_values[-1] if portfolio_values else 0.0,
                "final_withdrawn": round(cum_withdrawals, 2),
                "final_distributions": round(cum_distributions, 2),
                "final_total": total_values[-1] if total_values else 0.0,
                "depleted": depleted,
                "depletion_month": depletion_month,
                "risk_metrics": risk_metrics,
                "drip": drip,
            }
            if not drip:
                fund_result["cash_accumulated"] = round(cash_accumulated, 2)
            results[label] = fund_result

        results["months"] = date_labels
        results["data_start"] = common_start.strftime("%Y-%m-%d")
        results["cash_wedge_initial"] = cash_wedge_initial
        results["comparison_type"] = comparison_type
        return results

    # ── SIMULATION MODE ──
    if mode == "simulate":
        market_type = data.get("market", "neutral")
        duration_months = int(data.get("duration_months", 120))
        if duration_months < 1 or duration_months > 240:
            return {"error": "Simulation duration must be between 1 and 240 months (20 years max)."}

        bias_map = {"bullish": +0.010, "bearish": -0.015, "neutral": 0.0}
        vol_mult_map = {"bullish": 0.9, "bearish": 1.2, "neutral": 1.0}
        bias = bias_map.get(market_type, 0.0)
        vol_mult = vol_mult_map.get(market_type, 1.0)

        results = {}
        fund_list = [("fund_a", fa), ("fund_b", fb)]
        if fc:
            fund_list.append(("fund_c", fc))
        date_labels = []
        for label, fund in fund_list:
            sym = fund["ticker"]
            investment = fund["investment"]
            yo = fund["yield_override"]
            drip = fund["drip"]

            try:
                hist = yf.Ticker(sym).history(period="1y", auto_adjust=False, actions=True)
            except Exception as e:
                return {"error": f"Failed to fetch data for {sym}: {str(e)}"}

            if hist is None or hist.empty:
                return {"error": f"No data found for {sym}."}

            close = hist["Close"].dropna()
            if close.empty:
                return {"error": f"No price data for {sym}."}

            current_price = float(close.iloc[-1])
            if current_price <= 0:
                return {"error": f"Could not determine current price for {sym}."}

            divs = hist["Dividends"] if "Dividends" in hist.columns else pd.Series(0.0, index=hist.index)
            if yo is not None:
                ttm_yield = yo / 100.0
            else:
                ttm_divs_sum = float(divs.sum()) if divs is not None else 0.0
                ttm_yield = ttm_divs_sum / current_price if current_price > 0 else 0.0

            monthly_returns = close.resample("ME").last().pct_change().dropna()
            hist_sigma = float(monthly_returns.std()) if len(monthly_returns) >= 2 else 0.05

            SIGMA_CAP = 0.25
            REGIME_MONTHS = 42
            FADE_MONTHS = 6
            RALLY_PROB = 0.18
            RALLY_LEN_LO = 2
            RALLY_LEN_HI = 4

            neutral_bias = 0.0
            neutral_vol = 1.0

            mu_arr = np.empty(duration_months)
            vmul_arr = np.empty(duration_months)
            rally_remaining = 0

            for m in range(duration_months):
                if m < REGIME_MONTHS:
                    regime_w = 1.0
                elif m < REGIME_MONTHS + FADE_MONTHS:
                    regime_w = 1.0 - (m - REGIME_MONTHS) / FADE_MONTHS
                else:
                    regime_w = 0.0

                m_bias = bias * regime_w + neutral_bias * (1.0 - regime_w)
                m_vmul = vol_mult * regime_w + neutral_vol * (1.0 - regime_w)

                if market_type == "bearish" and regime_w > 0:
                    if rally_remaining > 0:
                        m_bias = abs(bias) * 0.6 * regime_w
                        m_vmul = 0.9 * regime_w + neutral_vol * (1.0 - regime_w)
                        rally_remaining -= 1
                    elif np.random.random() < RALLY_PROB:
                        rally_remaining = np.random.randint(RALLY_LEN_LO, RALLY_LEN_HI + 1)
                        m_bias = abs(bias) * 0.6 * regime_w
                        m_vmul = 0.9 * regime_w + neutral_vol * (1.0 - regime_w)
                        rally_remaining -= 1

                mu_arr[m] = m_bias
                vmul_arr[m] = m_vmul

            sigma_arr = np.minimum(hist_sigma * vmul_arr, SIGMA_CAP)

            N_PATHS = 300
            drift_arr = mu_arr - 0.5 * sigma_arr ** 2
            np.random.seed(None)
            Z = np.random.normal(0.0, 1.0, (N_PATHS, duration_months))
            log_rets = drift_arr[np.newaxis, :] + sigma_arr[np.newaxis, :] * Z
            cum_log = np.cumsum(np.hstack([np.zeros((N_PATHS, 1)), log_rets]), axis=1)
            price_floor = max(current_price * 0.0001, 1e-10)
            price_matrix = np.maximum(current_price * np.exp(cum_log), price_floor)
            prices = [float(v) for v in np.median(price_matrix, axis=0)]

            is_growth = label in growth_funds
            wedge = cash_wedge_initial if is_growth else 0.0
            shares = investment / current_price
            cum_withdrawals = 0.0
            cum_distributions = 0.0
            prev_pv = investment
            cash_accumulated = 0.0

            portfolio_values = []
            cumulative_withdrawals_list = []
            cumulative_distributions_list = []
            share_counts = []
            total_values = []
            monthly_rows = []
            depleted = False

            for month_index, price in enumerate(prices[1:]):
                if depleted or shares <= 0:
                    depleted = True
                    portfolio_values.append(0.0)
                    cumulative_withdrawals_list.append(round(cum_withdrawals, 2))
                    cumulative_distributions_list.append(round(cum_distributions, 2))
                    share_counts.append(0.0)
                    tv = cum_withdrawals + wedge + cash_accumulated
                    total_values.append(round(tv, 2))
                    row_data = {
                        "price": 0, "shares": 0, "portfolio": 0,
                        "dist_per_share": 0, "income": 0, "withdrawal": 0,
                        "wedge_drawn": 0, "wedge_bal": round(wedge, 2),
                        "excess": 0, "shares_delta": 0, "growth": 0,
                        "cum_income": round(cum_distributions, 2),
                        "roi_dollar": round(cum_withdrawals + wedge + cash_accumulated - investment - (cash_wedge_initial if is_growth else 0), 2),
                        "roi_pct": round(((cum_withdrawals + wedge + cash_accumulated - investment - (cash_wedge_initial if is_growth else 0)) / investment * 100), 2) if investment else 0,
                    }
                    if not drip:
                        row_data["cash_accumulated"] = round(cash_accumulated, 2)
                    monthly_rows.append(row_data)
                    continue

                pct_chg = (price - current_price) / current_price * 100
                if pct_chg >= 10:
                    factor = min(1.0 + (pct_chg - 10) * 0.02, 1.30)
                elif pct_chg >= -10:
                    factor = 1.0
                elif pct_chg >= -20:
                    factor = 0.85
                elif pct_chg >= -30:
                    factor = 0.70
                else:
                    factor = max(0.40, 1.0 + pct_chg * 0.02)

                shares_before = shares
                dist_per_share = (ttm_yield / 12) * price * factor
                dist_this_month = dist_per_share * shares
                cum_distributions += dist_this_month

                # Compute effective withdrawal for this month
                current_pv = shares * price
                effective_withdrawal = _compute_effective_withdrawal(
                    monthly_withdrawal, month_index, current_pv, investment)

                wedge_drawn = 0.0
                if is_growth:
                    need = effective_withdrawal
                    cw_draw = min(wedge, need)
                    wedge -= cw_draw
                    wedge_drawn = cw_draw
                    need -= cw_draw
                    div_used = min(dist_this_month, need)
                    need -= div_used
                    leftover_div = dist_this_month - div_used
                    if drip:
                        if leftover_div > 0 and price > 0:
                            shares += leftover_div / price
                    else:
                        cash_accumulated += leftover_div
                    if need > 0:
                        if not drip and cash_accumulated > 0:
                            cash_draw = min(cash_accumulated, need)
                            cash_accumulated -= cash_draw
                            need -= cash_draw
                        if need > 0 and price > 0:
                            shares -= need / price
                    cum_withdrawals += effective_withdrawal
                    excess = dist_this_month + cw_draw - effective_withdrawal
                else:
                    excess = dist_this_month - effective_withdrawal
                    if dist_this_month >= effective_withdrawal:
                        if drip:
                            if price > 0:
                                shares += excess / price
                        else:
                            cash_accumulated += excess
                        cum_withdrawals += effective_withdrawal
                    else:
                        shortfall = -excess
                        if not drip and cash_accumulated > 0:
                            cash_draw = min(cash_accumulated, shortfall)
                            cash_accumulated -= cash_draw
                            shortfall -= cash_draw
                        if shortfall > 0 and price > 0:
                            shares -= shortfall / price
                        cum_withdrawals += effective_withdrawal

                if shares <= 0:
                    shares = 0.0
                    depleted = True

                pv = shares * price
                growth = pv - prev_pv
                shares_delta = shares - shares_before
                total_basis = investment + (cash_wedge_initial if is_growth else 0)
                roi_dollar = pv + cum_withdrawals + wedge + cash_accumulated - total_basis
                roi_pct = roi_dollar / investment * 100 if investment else 0

                portfolio_values.append(round(pv, 2))
                cumulative_withdrawals_list.append(round(cum_withdrawals, 2))
                cumulative_distributions_list.append(round(cum_distributions, 2))
                share_counts.append(round(shares, 4))
                total_values.append(round(pv + cum_withdrawals + wedge + cash_accumulated, 2))
                row_data = {
                    "price": round(price, 2),
                    "shares": round(shares, 4),
                    "portfolio": round(pv, 2),
                    "dist_per_share": round(dist_per_share, 4),
                    "income": round(dist_this_month, 2),
                    "withdrawal": round(effective_withdrawal, 2),
                    "wedge_drawn": round(wedge_drawn, 2),
                    "wedge_bal": round(wedge, 2),
                    "excess": round(excess, 2),
                    "shares_delta": round(shares_delta, 4),
                    "growth": round(growth, 2),
                    "cum_income": round(cum_distributions, 2),
                    "roi_dollar": round(roi_dollar, 2),
                    "roi_pct": round(roi_pct, 2),
                }
                if not drip:
                    row_data["cash_accumulated"] = round(cash_accumulated, 2)
                monthly_rows.append(row_data)
                prev_pv = pv

            date_labels = [f"Month {i+1}" for i in range(duration_months)]
            total_bought = sum(r["shares_delta"] for r in monthly_rows if r["shares_delta"] > 0)
            total_sold = sum(-r["shares_delta"] for r in monthly_rows if r["shares_delta"] < 0)
            initial_shares = investment / current_price
            role = "Growth" if is_growth else "Income"

            risk_metrics = _compute_risk_metrics(portfolio_values, monthly_rows)
            depletion_month = _compute_depletion_month(depleted, monthly_rows)

            fund_result = {
                "ticker": sym,
                "role": role,
                "investment": round(investment, 2),
                "initial_shares": round(initial_shares, 4),
                "has_cash_wedge": is_growth and cash_wedge_initial > 0,
                "cash_wedge_remaining": round(wedge, 2) if is_growth else None,
                "portfolio_values": portfolio_values,
                "cumulative_withdrawals": cumulative_withdrawals_list,
                "cumulative_distributions": cumulative_distributions_list,
                "total_values": total_values,
                "shares": share_counts,
                "monthly_rows": monthly_rows,
                "total_shares_bought": round(total_bought, 4),
                "total_shares_sold": round(total_sold, 4),
                "final_portfolio": portfolio_values[-1] if portfolio_values else 0.0,
                "final_withdrawn": round(cum_withdrawals, 2),
                "final_distributions": round(cum_distributions, 2),
                "final_total": total_values[-1] if total_values else 0.0,
                "depleted": depleted,
                "depletion_month": depletion_month,
                "risk_metrics": risk_metrics,
                "drip": drip,
            }
            if not drip:
                fund_result["cash_accumulated"] = round(cash_accumulated, 2)
            results[label] = fund_result

        results["months"] = date_labels
        results["cash_wedge_initial"] = cash_wedge_initial
        results["comparison_type"] = comparison_type
        return results

    return {"error": f"Unknown mode: {mode}"}


# ── Run ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    is_packaged = getattr(sys, "frozen", False) or os.environ.get("ELECTRON_RUN_AS_NODE")
    app.run(debug=not is_packaged, port=5001, use_reloader=False)
