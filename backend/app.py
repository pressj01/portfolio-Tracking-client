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

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_profile_id():
    return int(request.args.get("profile_id", session.get("profile_id", 1)))


def rows_to_dicts(rows):
    """Convert sqlite3.Row results to a list of dicts."""
    return [dict(r) for r in rows]


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
    conn.execute("DELETE FROM all_account_info WHERE profile_id = ?", (pid,))
    conn.execute("DELETE FROM income_tracking WHERE profile_id = ?", (pid,))
    conn.execute("DELETE FROM weekly_payouts WHERE profile_id = ?", (pid,))
    conn.execute("DELETE FROM monthly_payouts WHERE profile_id = ?", (pid,))
    conn.execute("DELETE FROM weekly_payout_tickers WHERE profile_id = ?", (pid,))
    conn.execute("DELETE FROM monthly_payout_tickers WHERE profile_id = ?", (pid,))
    conn.execute("DELETE FROM profiles WHERE id = ?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"deleted": pid})


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
        sheet = request.form.get("sheet_name", "All Accounts")
        count, msg = import_from_excel(path, sheet_name=sheet, profile_id=profile_id)
        # Auto-populate derived tables
        populate_holdings(profile_id)
        populate_dividends(profile_id)
        populate_income_tracking(profile_id)
        populate_pillar_weights(profile_id)
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
        df = pd.read_excel(path, engine="openpyxl")
        count, msg = import_from_upload(df, profile_id)
        populate_holdings(profile_id)
        populate_dividends(profile_id)
        populate_income_tracking(profile_id)
        return jsonify({"rows": count, "message": msg})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.route("/api/import/weekly-payouts", methods=["POST"])
def api_import_weekly():
    profile_id = get_profile_id()
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    path = os.path.join(UPLOAD_FOLDER, f.filename)
    f.save(path)
    try:
        count, msg = import_weekly_payouts(path, profile_id)
        return jsonify({"rows": count, "message": msg})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.route("/api/import/monthly-payouts", methods=["POST"])
def api_import_monthly():
    profile_id = get_profile_id()
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    path = os.path.join(UPLOAD_FOLDER, f.filename)
    f.save(path)
    try:
        count, msg = import_monthly_payouts(path, profile_id)
        return jsonify({"rows": count, "message": msg})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.route("/api/import/monthly-payout-tickers", methods=["POST"])
def api_import_monthly_tickers():
    profile_id = get_profile_id()
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
    rows = conn.execute(
        "SELECT ticker, quantity, price_paid, purchase_value FROM all_account_info WHERE profile_id = ?",
        (profile_id,),
    ).fetchall()

    if not rows:
        conn.close()
        return jsonify({"updated": 0, "message": "No holdings to refresh"})

    tickers = [r["ticker"] for r in rows]
    qty_map = {r["ticker"]: (r["quantity"] or 0, r["price_paid"] or 0, r["purchase_value"] or 0) for r in rows}

    # Batch download prices + dividends
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

    # Load known weekly tickers so refresh doesn't overwrite their frequency
    weekly_set = set()
    try:
        wrows = conn.execute("SELECT ticker FROM weekly_payout_tickers WHERE profile_id = ?", (profile_id,)).fetchall()
        weekly_set = {r["ticker"] for r in wrows}
    except Exception:
        pass

    # Also load current DB frequencies to preserve manually-set ones
    db_freq_map = {}
    try:
        frows = conn.execute("SELECT ticker, div_frequency FROM all_account_info WHERE profile_id = ?", (profile_id,)).fetchall()
        db_freq_map = {r["ticker"]: r["div_frequency"] for r in frows}
    except Exception:
        pass

    updated = 0
    for t in tickers:
        new_price = price_map.get(t)
        new_div = div_map.get(t)
        new_exdiv = exdiv_map.get(t)
        new_freq = freq_map.get(t)

        # Never downgrade frequency — the imported/user-set value is authoritative.
        # yfinance often misdetects new ETFs with limited history.
        freq_rank = {'W': 6, '52': 6, 'M': 5, 'Q': 4, 'SA': 3, 'A': 2, None: 0}
        if t in weekly_set:
            new_freq = 'W'
        else:
            db_rank = freq_rank.get(db_freq_map.get(t), 0)
            new_rank = freq_rank.get(new_freq, 0)
            if new_rank < db_rank:
                new_freq = db_freq_map.get(t)

        if not new_price and not new_div:
            continue

        qty, price_paid, purchase_value = qty_map[t]
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
            cur_freq = (new_freq or freq_map.get(t, 'Q')).upper()
            mult = freq_mult.get(cur_freq, 4)
            annual_div = new_div * mult
            yoc = (annual_div / price_paid) if price_paid else 0
            cur_yield = (annual_div / new_price) if new_price else 0
            # Only update div/share and yields — preserve imported annual/monthly estimates
            sets.extend(["div = ?", "annual_yield_on_cost = ?", "current_annual_yield = ?"])
            vals.extend([new_div, yoc, cur_yield])

        if new_exdiv:
            sets.append("ex_div_date = ?")
            vals.append(new_exdiv)
            # Estimate pay date as ex-div + 21 days
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
            vals.extend([t, profile_id])
            conn.execute(
                f"UPDATE all_account_info SET {', '.join(sets)} WHERE ticker = ? AND profile_id = ?",
                vals,
            )
            updated += 1

    conn.commit()

    # Update derived tables
    populate_holdings(profile_id)
    populate_dividends(profile_id)

    conn.close()
    return jsonify({"updated": updated, "message": f"Refreshed {updated} of {len(tickers)} holdings"})


# ── Holdings CRUD ──────────────────────────────────────────────────────────────

@app.route("/api/holdings", methods=["GET"])
def list_holdings():
    profile_id = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        """SELECT a.*, c.name AS category
           FROM all_account_info a
           LEFT JOIN ticker_categories tc ON a.ticker = tc.ticker AND a.profile_id = tc.profile_id
           LEFT JOIN categories c ON tc.category_id = c.id
           WHERE a.profile_id = ?
           ORDER BY a.ticker""",
        (profile_id,),
    ).fetchall()
    conn.close()
    return jsonify(rows_to_dicts(rows))


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
    profile_id = get_profile_id()
    data = request.get_json()
    ticker = ticker.upper()

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
    profile_id = get_profile_id()
    ticker = ticker.upper()
    conn = get_connection()
    conn.execute(
        "DELETE FROM all_account_info WHERE ticker = ? AND profile_id = ?",
        (ticker, profile_id),
    )
    conn.execute("DELETE FROM holdings WHERE ticker = ?", (ticker,))
    conn.execute("DELETE FROM dividends WHERE ticker = ?", (ticker,))
    conn.commit()
    conn.close()
    return jsonify({"ticker": ticker, "message": f"{ticker} deleted"})


# ── Dividends ──────────────────────────────────────────────────────────────────

@app.route("/api/dividends", methods=["GET"])
def list_dividends():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM dividends ORDER BY ticker").fetchall()
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

    vals.append(ticker)
    conn.execute(f"UPDATE dividends SET {', '.join(updates)} WHERE ticker = ?", vals)
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


# ── Upcoming Dividends ─────────────────────────────────────────────────────────

@app.route("/api/upcoming-dividends", methods=["GET"])
def upcoming_dividends():
    """Return holdings with ex-div dates projected into the upcoming week."""
    from datetime import datetime, timedelta

    profile_id = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        """SELECT ticker, description, ex_div_date, div, div_frequency, quantity, approx_monthly_income
           FROM all_account_info
           WHERE profile_id = ? AND ex_div_date IS NOT NULL AND ex_div_date != ''
             AND ex_div_date != '--' AND quantity > 0""",
        (profile_id,),
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

@app.route("/api/portfolio-summary/data", methods=["GET"])
def portfolio_summary_data():
    """Compute per-ticker grades and portfolio-level grade via yfinance."""
    import warnings
    import numpy as np
    import yfinance as yf
    from grading import ticker_score, grade_portfolio, letter_grade
    warnings.filterwarnings("ignore")

    profile_id = get_profile_id()
    conn = get_connection()
    rows = conn.execute(
        "SELECT ticker, current_value FROM all_account_info WHERE profile_id = ? AND purchase_value > 0 AND quantity > 0",
        (profile_id,),
    ).fetchall()
    conn.close()

    if not rows:
        return jsonify({"error": "No data"}), 400

    tickers = [r["ticker"] for r in rows]
    all_dl = list(set(tickers + ["SPY"]))

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
    raw = yf.download(ticker, start=start_str, progress=False, auto_adjust=False, actions=True)

    if raw.empty:
        return jsonify({"error": f"No Yahoo Finance data for {ticker}"}), 404

    if isinstance(raw.columns, pd.MultiIndex):
        close_col = raw["Close"][ticker] if ticker in raw["Close"].columns else raw["Close"].iloc[:, 0]
        divs_col = raw["Dividends"][ticker] if ticker in raw["Dividends"].columns else raw["Dividends"].iloc[:, 0]
    else:
        close_col = raw["Close"]
        divs_col = raw["Dividends"]

    close_col = close_col.squeeze()
    divs_col = divs_col.squeeze()
    cum_divs = divs_col.cumsum()

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
    profile_id = get_profile_id()
    conn = get_connection()
    holdings = conn.execute(
        "SELECT COUNT(*) as c FROM all_account_info WHERE profile_id = ?", (profile_id,)
    ).fetchone()["c"]
    dividends = conn.execute("SELECT COUNT(*) as c FROM dividends").fetchone()["c"]
    income = conn.execute("SELECT COUNT(*) as c FROM income_tracking").fetchone()["c"]
    conn.close()
    return jsonify({"holdings": holdings, "dividends": dividends, "income_tracking": income})


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

            if close.empty:
                result["warnings"].append(f"{sym}: no data available")
                continue

            dates = [d.strftime("%Y-%m-%d") for d in close.index]
            norm_price = [round(float(v), 4) for v in (close / float(close.iloc[0]) * 100)]

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

            # Statistics
            price_ret = round((float(close.iloc[-1]) / float(close.iloc[0]) - 1) * 100, 2)
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
            n_days = (close.index[-1] - close.index[0]).days
            if n_days > 30:
                years = n_days / 365.25
                final_norm = 100 + total_ret
                ann = round(((final_norm / 100) ** (1 / years) - 1) * 100, 2)
            else:
                ann = None

            # Max drawdown (on price)
            running_max = close.cummax()
            drawdown = ((close - running_max) / running_max * 100)
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
    if signals.count("BUY") >= 3:
        return "BUY"
    if signals.count("SELL") >= 3:
        return "SELL"
    return "NEUTRAL"


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
                    signal = _bss_vote([ao_sig, rsi_sig, macd_sig, sma50_sig, sma200_sig])

                    is_portfolio = ticker in port_sizes
                    is_sector = ticker in SECTOR_SET and not is_portfolio
                    size = port_sizes.get(ticker, WATCHLIST_SIZE)

                    # Treemap nodes
                    if has_plotly:
                        ao_val_str = f"{ao_val:.4f}" if ao_val is not None else "\u2014"
                        rsi_val_str = f"{rsi_val:.1f}" if rsi_val is not None else "\u2014"
                        hover_text = (
                            f"<b>{signal}</b><br>"
                            f"AO: {ao_sig} ({ao_val_str}, {ao_dir or chr(8212)})<br>"
                            f"RSI: {rsi_sig} ({rsi_val_str})<br>"
                            f"MACD: {macd_sig}<br>"
                            f"SMA 50: {sma50_sig} ({_fmt_pct(sma50_pct)})<br>"
                            f"SMA 200: {sma200_sig} ({_fmt_pct(sma200_pct)})"
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
        if signals.count("BUY") >= 3:
            return "BUY"
        if signals.count("SELL") >= 3:
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
            signal = _vote([ao_sig, rsi_sig, macd_sig, sma50_sig, sma200_sig])

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
            })

        final_row = rows[-1]
        summary = {
            "total_dist": round(cumulative_dist, 2),
            "total_shares_bought": round(cumulative_shares_bought, 4),
            "total_reinvested": round(cumulative_reinvested, 2),
            "final_value": final_row["portfolio_val"],
            "price_chg_pct": final_row["price_delta_pct"],
            "has_erosion": final_row["shares_deficit"] > 0,
            "final_deficit": final_row["shares_deficit"],
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

        for dt, row in df.iterrows():
            price = float(row["price"])
            div_per_share = float(row["div"])
            total_dist = div_per_share * current_shares
            reinvest_amt = total_dist * reinvest_pct / 100.0
            shares_bought = (reinvest_amt / price) if price > 0 else 0.0
            current_shares += shares_bought
            cumul_dist += total_dist
            cumul_reinvested += reinvest_amt

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
    Uses 5 optimizer starts and a 40% per-holding cap.
    nav_penalties: per-ticker penalty for NAV erosion.
    """
    import numpy as np
    from scipy.optimize import minimize
    n = returns_df.shape[1]
    mu = returns_df.mean().values * 252
    yields_arr = np.array(yields)
    max_yield = float(yields_arr.max()) if yields_arr.max() > 0 else 0.10
    if current_weights is None:
        current_weights = np.ones(n) / n
    cw = np.array(current_weights)
    nav_pen = np.array(nav_penalties) if nav_penalties is not None else np.zeros(n)
    # Build bounds: partial sells (floor at 25% of current), zero-cap respected, 40% per-holding cap
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
    # Precompute returns matrix for income score
    ret_vals = returns_df.values
    ret_mu = mu  # already computed above
    # Income-focused blend: 70% yield, 30% income quality (Sortino/Omega/Calmar/Ulcer)
    balance = 0.7
    def neg_objective(w):
        port_yield = float(yields_arr @ w)
        norm_yield = port_yield / max_yield if max_yield > 0 else 0
        quality = _portfolio_income_score(w, ret_vals, ret_mu)
        nav_cost = float(w.dot(nav_pen))
        turnover = float(np.sum(np.abs(w - cw)))
        n_active = float(np.sum(w > 0.005))
        diversification_loss = max(0, n_current - n_active) * 0.01
        return -(balance * norm_yield + (1.0 - balance) * quality - turnover_penalty * turnover - diversification_loss - nav_cost)
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
    max_yield = float(yields_arr.max()) if yields_arr.max() > 0 else 0.10
    if current_weights is None:
        current_weights = np.ones(n) / n
    cw = np.array(current_weights)
    mu = returns_df.mean().values * 252
    ret_vals = returns_df.values
    nav_pen = np.array(nav_penalties) if nav_penalties is not None else np.zeros(n)
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
        port_yield = float(w.dot(yields_arr))
        norm_yield = port_yield / max_yield if max_yield > 0 else 0
        quality = _portfolio_income_score(w, ret_vals, mu)
        # NAV erosion penalty: weighted sum of per-ticker erosion penalties
        nav_cost = float(w.dot(nav_pen))
        # Slider blend: balance toward yield, (1-balance) toward income quality
        blended = balance * norm_yield + (1.0 - balance) * quality
        # Safety penalty: quality floor enforced, scaled by safety focus
        safety_penalty = max(0, 0.4 - quality) * 2.0 * (1.0 - balance)
        turnover = float(np.sum(np.abs(w - cw)))
        n_active = float(np.sum(w > 0.005))
        diversification_loss = max(0, n_current - n_active) * 0.01
        return -(blended - turnover_penalty * turnover - safety_penalty - diversification_loss - nav_cost)
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
                              current_weights=None):
    """Compute before/after grade, income, and key metrics.
    Uses already-computed port_metrics and income values from the optimization branch
    so numbers match exactly what's shown in the optimization summary.
    If weights are essentially unchanged, reuses before metrics to avoid grading noise."""
    import numpy as np
    from grading import grade_portfolio
    pm = port_metrics_before or {}
    grade_before = pm.get("grade", {})
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
            "est_annual_income": round(sum(income_map.get(t, 0) for t in available_tickers), 2),
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

    result = {"metrics": metrics, "portfolio_metrics": port_metrics}
    if result_corr:
        result["correlation"] = result_corr
        result["drawdown_series"] = result_dd

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

        if mode == "optimize_returns":
            ret_weight_caps = _nav_weight_caps(nav_returns, available_tickers)
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
                                                                   current_weights=current_weights)
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
                                                                   current_weights=current_weights)
            result["optimization"] = opt_dict

        elif mode == "optimize_balanced":
            yields_list = [yield_map.get(t, 0) for t in available_tickers]
            adj_yields = _adjust_yields_for_nav(yields_list, nav_returns, available_tickers)
            weight_caps = _nav_weight_caps(nav_returns, available_tickers)
            # Zero-yield tickers get capped to 0 in income-oriented modes
            for i, t in enumerate(available_tickers):
                if yields_list[i] <= 0:
                    weight_caps[i] = 0.0
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
                                                                   current_weights=current_weights)
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


# ── Run ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, port=5001)
