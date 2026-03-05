import os
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

    updated = 0
    for t in tickers:
        new_price = price_map.get(t)
        new_div = div_map.get(t)
        new_exdiv = exdiv_map.get(t)
        new_freq = freq_map.get(t)

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
            estim = new_div * qty
            monthly = estim / 12
            yoc = (new_div / price_paid) if price_paid else 0
            cur_yield = (new_div / new_price) if new_price else 0
            sets.extend(["div = ?", "estim_payment_per_year = ?", "approx_monthly_income = ?",
                         "annual_yield_on_cost = ?", "current_annual_yield = ?"])
            vals.extend([new_div, estim, monthly, yoc, cur_yield])

        if new_exdiv:
            sets.append("ex_div_date = ?")
            vals.append(new_exdiv)

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
        "SELECT * FROM all_account_info WHERE profile_id = ? ORDER BY ticker",
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
        "ex_div_date", "div", "dividend_paid", "estim_payment_per_year",
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
        "ex_div_date", "div", "dividend_paid", "estim_payment_per_year",
        "approx_monthly_income", "annual_yield_on_cost", "current_annual_yield",
        "purchase_date", "ytd_divs", "total_divs_received", "paid_for_itself",
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


# ── Run ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, port=5000)
