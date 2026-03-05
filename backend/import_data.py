import re
import pandas as pd
from datetime import date
from config import get_connection
from database import ensure_tables_exist

# ── Column mapping for the owner's Excel spreadsheet (All Accounts sheet) ─────
COLUMN_MAP = {
    "Ticker": "ticker",
    "Description": "description",
    "Type": "classification_type",
    "Price Paid": "price_paid",
    "Current Price": "current_price",
    "% Change": "percent_change",
    "Qty": "quantity",
    "Purchase Value": "purchase_value",
    "Current Value": "current_value",
    "Gain/Loss": "gain_or_loss",
    "Gain/Loss %": "gain_or_loss_percentage",
    "Div Freq": "div_frequency",
    "DRIP": "reinvest",
    "Ex-Div Date": "ex_div_date",
    "Div/Share": "div",
    "Div Paid": "dividend_paid",
    "Est. Annual Pmt": "estim_payment_per_year",
    "Monthly Income": "approx_monthly_income",
    "8% Annual Wdraw": "withdraw_8pct_cost_annually",
    "8% Monthly Wdraw": "withdraw_8pct_per_month",
    "Cash Not Reinvest": "cash_not_reinvested",
    "Cash Reinvested": "total_cash_reinvested",
    "Yield On Cost": "annual_yield_on_cost",
    "Current Yield": "current_annual_yield",
    "% of Account": "percent_of_account",
    "Shares from Div": "shares_bought_from_dividend",
    "Shares/Year": "shares_bought_in_year",
    "Shares/Month": "shares_in_month",
    "YTD Divs": "ytd_divs",
    "Total Divs Received": "total_divs_received",
    "Paid For Itself": "paid_for_itself",
    "Date Purchased": "purchase_date",
}

SQL_COLUMNS = list(COLUMN_MAP.values()) + ["import_date", "current_month_income"]

_VALID_TICKER = re.compile(r'^[A-Z][A-Z0-9]{0,8}$')


# ── Owner Excel import ─────────────────────────────────────────────────────────

def import_from_excel(file_path, sheet_name="All Accounts", profile_id=1):
    """Read the owner's Excel file and import into all_account_info.
    Returns (row_count, message).
    """
    df = pd.read_excel(file_path, sheet_name=sheet_name, engine="openpyxl")

    # ── Detect "[Month] Income" columns and capture monthly totals ──────────
    _month_pattern = re.compile(r'^([A-Za-z]+)\s+Income$')
    _current_year = date.today().year
    _monthly_income_updates = []

    _current_month = date.today().month
    _current_month_col = None

    for col_name in df.columns:
        if not isinstance(col_name, str):
            continue
        _m = _month_pattern.match(col_name)
        if not _m:
            continue
        try:
            _month_num = pd.to_datetime(_m.group(1), format='%B').month
        except Exception:
            continue
        if _month_num == _current_month:
            _current_month_col = col_name
        _mask = df['Ticker'].apply(
            lambda t: isinstance(t, str) and t.strip() != 'TOTALS' and bool(_VALID_TICKER.match(t.strip()))
        )
        _total = pd.to_numeric(df.loc[_mask, col_name], errors='coerce').fillna(0).sum()
        if _total > 0:
            _monthly_income_updates.append((_current_year, _month_num, round(float(_total), 2)))

    # Capture per-ticker current month income before columns are filtered
    _current_month_income_series = None
    if _current_month_col is not None:
        _current_month_income_series = pd.to_numeric(df[_current_month_col], errors='coerce').fillna(0)

    # Keep only mapped columns that actually exist in this sheet
    excel_cols = [c for c in COLUMN_MAP.keys() if c in df.columns]
    df = df[excel_cols].copy()
    df.rename(columns=COLUMN_MAP, inplace=True)

    # Attach per-ticker current month income
    if _current_month_income_series is not None:
        df['current_month_income'] = _current_month_income_series.reindex(df.index).fillna(0)

    # Drop rows where ticker is null or blank
    df = df.dropna(subset=["ticker"])
    df = df[df["ticker"].astype(str).str.strip() != ""]

    # Keep only valid stock tickers
    df = df[df["ticker"].astype(str).str.strip().apply(lambda t: bool(_VALID_TICKER.match(t)))]

    # Coerce float columns to numeric
    float_sql_cols = [
        "price_paid", "current_price", "percent_change", "quantity",
        "purchase_value", "current_value", "gain_or_loss", "gain_or_loss_percentage",
        "div", "dividend_paid", "estim_payment_per_year", "approx_monthly_income",
        "withdraw_8pct_cost_annually", "withdraw_8pct_per_month",
        "cash_not_reinvested", "total_cash_reinvested",
        "annual_yield_on_cost", "current_annual_yield", "percent_of_account",
        "shares_bought_from_dividend", "shares_bought_in_year", "shares_in_month",
        "ytd_divs", "total_divs_received", "paid_for_itself",
    ]
    for col in float_sql_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Coerce purchase_date
    if "purchase_date" in df.columns:
        df["purchase_date"] = pd.to_datetime(df["purchase_date"], errors="coerce")
        df["purchase_date"] = df["purchase_date"].where(df["purchase_date"].notna(), other=None)

    # Drop rows where current_price is NaN
    if "current_price" in df.columns:
        df = df[df["current_price"].notna()]

    # ── Recompute paid_for_itself from yfinance dividend history ────────────
    if "purchase_date" in df.columns:
        import yfinance as yf
        _pd_mask = df["purchase_date"].notna()
        if _pd_mask.any():
            _dated = df.loc[_pd_mask].copy()
            _earliest = pd.Timestamp(_dated["purchase_date"].min())
            _tickers = _dated["ticker"].unique().tolist()
            _ticker_str = " ".join(_tickers)
            try:
                _raw = yf.download(
                    _ticker_str, start=_earliest.strftime("%Y-%m-%d"),
                    progress=False, auto_adjust=False, actions=True
                )
                if not _raw.empty:
                    _divs = None
                    if isinstance(_raw.columns, pd.MultiIndex):
                        if "Dividends" in _raw.columns.get_level_values(0):
                            _divs = _raw["Dividends"]
                    elif "Dividends" in _raw.columns:
                        _divs = _raw["Dividends"]

                    if _divs is not None:
                        for idx in _dated.index:
                            t = df.at[idx, "ticker"]
                            _pdate = pd.Timestamp(df.at[idx, "purchase_date"])
                            _qty = float(df.at[idx, "quantity"] or 0)
                            _pv = float(df.at[idx, "purchase_value"] or 0)

                            if isinstance(_divs, pd.DataFrame):
                                if t not in _divs.columns:
                                    continue
                                _tseries = _divs[t]
                            else:
                                _tseries = _divs

                            _since = _tseries[_tseries.index >= _pdate]
                            _total_dps = float(_since[_since > 0].sum())
                            _total_divs = _total_dps * _qty
                            _pfi = _total_divs / _pv if _pv > 0 else 0

                            df.at[idx, "total_divs_received"] = round(_total_divs, 2)
                            df.at[idx, "paid_for_itself"] = round(_pfi, 6)
            except Exception:
                pass

    # Add import_date and profile_id
    df["import_date"] = date.today().isoformat()
    df["profile_id"] = profile_id

    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    # Clear existing data for this profile
    cur.execute("DELETE FROM all_account_info WHERE profile_id = ?", (profile_id,))

    # Build insert
    cols_to_insert = [c for c in SQL_COLUMNS if c in df.columns] + ["profile_id"]
    placeholders = ", ".join(["?"] * len(cols_to_insert))
    insert_sql = f"INSERT INTO all_account_info ({', '.join(cols_to_insert)}) VALUES ({placeholders})"

    row_count = 0
    for _, row in df.iterrows():
        values = []
        for col in cols_to_insert:
            val = row.get(col)
            if pd.isna(val):
                values.append(None)
            elif isinstance(val, pd.Timestamp):
                values.append(val.isoformat()[:10])
            else:
                values.append(val)
        cur.execute(insert_sql, values)
        row_count += 1

    conn.commit()

    # ── Upsert monthly income totals ────────────────────────────────────────
    for _yr, _mo, _amt in _monthly_income_updates:
        existing = cur.execute(
            "SELECT 1 FROM monthly_payouts WHERE year = ? AND month = ? AND profile_id = ?",
            (_yr, _mo, profile_id),
        ).fetchone()
        if existing is None:
            cur.execute(
                "INSERT INTO monthly_payouts (year, month, amount, profile_id) VALUES (?, ?, ?, ?)",
                (_yr, _mo, _amt, profile_id),
            )
        else:
            cur.execute(
                "UPDATE monthly_payouts SET amount = ? WHERE year = ? AND month = ? AND profile_id = ?",
                (_amt, _yr, _mo, profile_id),
            )
    conn.commit()
    conn.close()
    return row_count, f"Successfully imported {row_count} rows from Excel."


# ── Weekly payouts import ──────────────────────────────────────────────────────

def import_weekly_payouts(file_path, profile_id=1):
    """Import weekly payout data from Weekly_Payers sheet."""
    import openpyxl
    from datetime import datetime

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True, keep_vba=True)
    ws = wb["Weekly_Payers"]

    ticker_rows = []
    for row in ws.iter_rows(min_row=2, max_row=20):
        ticker = row[0].value
        if ticker is None or not isinstance(ticker, str):
            continue
        shares = row[1].value
        dist = row[8].value
        total_div = row[9].value
        ticker_rows.append((ticker, shares, dist, total_div))

    weekly_rows = []
    for row in ws.iter_rows(min_row=22):
        pay_date_val = row[0].value
        week_val = row[1].value
        amount_val = row[2].value
        if not isinstance(pay_date_val, datetime):
            continue
        if amount_val is None:
            continue
        weekly_rows.append((
            pay_date_val.date().isoformat(),
            int(week_val) if week_val is not None else None,
            float(amount_val),
        ))
    wb.close()

    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    cur.execute("DELETE FROM weekly_payout_tickers WHERE profile_id = ?", (profile_id,))
    for ticker, shares, dist, total_div in ticker_rows:
        cur.execute(
            "INSERT INTO weekly_payout_tickers (ticker, shares, distribution, total_dividend, profile_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                ticker,
                float(shares) if shares is not None else None,
                float(dist) if dist is not None else None,
                float(total_div) if total_div is not None else None,
                profile_id,
            ),
        )

    inserted = 0
    for pay_date, week, amount in weekly_rows:
        existing = cur.execute(
            "SELECT 1 FROM weekly_payouts WHERE pay_date = ? AND profile_id = ?",
            (pay_date, profile_id),
        ).fetchone()
        if existing is None:
            cur.execute(
                "INSERT INTO weekly_payouts (pay_date, week_of_month, amount, profile_id) VALUES (?, ?, ?, ?)",
                (pay_date, week, amount, profile_id),
            )
            inserted += 1

    conn.commit()
    conn.close()
    return inserted, f"Weekly payouts: {inserted} new rows imported, {len(ticker_rows)} tickers updated."


# ── Monthly payouts import ─────────────────────────────────────────────────────

def import_monthly_payouts(file_path, profile_id=1):
    """Import monthly payout data from Monthly Tracking sheet."""
    import openpyxl

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True, keep_vba=True)
    ws = wb["Monthly Tracking"]

    rows_to_insert = []
    for row in ws.iter_rows(min_row=2):
        year_val = row[0].value
        if year_val is None or not isinstance(year_val, (int, float)):
            continue
        year = int(year_val)
        for month_idx in range(1, 13):
            amount = row[month_idx].value
            if amount is not None:
                rows_to_insert.append((year, month_idx, float(amount)))
    wb.close()

    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    inserted = 0
    for year, month, amount in rows_to_insert:
        existing = cur.execute(
            "SELECT 1 FROM monthly_payouts WHERE year = ? AND month = ? AND profile_id = ?",
            (year, month, profile_id),
        ).fetchone()
        if existing is None:
            cur.execute(
                "INSERT INTO monthly_payouts (year, month, amount, profile_id) VALUES (?, ?, ?, ?)",
                (year, month, amount, profile_id),
            )
            inserted += 1

    conn.commit()
    conn.close()
    return inserted, f"Monthly payouts: {inserted} new rows imported."


# ── Monthly payout tickers import ─────────────────────────────────────────────

def import_monthly_payout_tickers(file_path, profile_id=1):
    """Import ticker-to-month mapping from DivMonths sheet."""
    import openpyxl

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True, keep_vba=True)
    ws = wb["DivMonths"]

    tickers = [cell.value for cell in ws[1] if cell.value is not None]
    ticker_months = {t: set() for t in tickers}
    for row in ws.iter_rows(min_row=2):
        for i, ticker in enumerate(tickers):
            val = row[i].value
            if val is not None and isinstance(val, (int, float)):
                ticker_months[ticker].add(int(val))
    wb.close()

    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    cur.execute("DELETE FROM monthly_payout_tickers WHERE profile_id = ?", (profile_id,))
    inserted = 0
    for ticker, months in ticker_months.items():
        for month in sorted(months):
            cur.execute(
                "INSERT INTO monthly_payout_tickers (ticker, pay_month, profile_id) VALUES (?, ?, ?)",
                (ticker, month, profile_id),
            )
            inserted += 1

    conn.commit()
    conn.close()
    return inserted, f"Monthly ticker mappings: {inserted} rows imported ({len(tickers)} tickers)."


# ── Generic user upload ────────────────────────────────────────────────────────

UPLOAD_COL_MAP = {
    'ticker':                     ['ticker', 'symbol', 'stock', 'etf'],
    'description':                ['description', 'name', 'security name'],
    'classification_type':        ['type', 'classification', 'asset type'],
    'quantity':                    ['shares', 'quantity', 'qty', 'units', 'amount'],
    'price_paid':                  ['price paid', 'cost basis', 'avg cost', 'buy price', 'price_paid'],
    'current_price':               ['current price', 'market price', 'last price', 'current_price'],
    'purchase_value':              ['purchase value', 'cost value', 'purchase_value'],
    'current_value':               ['current value', 'market value', 'current_value'],
    'gain_or_loss':                ['gain/loss', 'gain loss', 'gain_or_loss', 'p&l'],
    'gain_or_loss_percentage':     ['gain/loss %', 'gain loss %', 'gain_or_loss_percentage', 'p&l %'],
    'div':                         ['div/share', 'dividend', 'div', 'distribution'],
    'div_frequency':               ['frequency', 'div frequency', 'div freq', 'div_frequency'],
    'ex_div_date':                 ['ex-div date', 'ex div date', 'ex_div_date', 'exdivdate'],
    'reinvest':                    ['drip', 'reinvest', 'reinvestment'],
    'dividend_paid':               ['div paid', 'dividend paid', 'dividend_paid'],
    'estim_payment_per_year':      ['est. annual pmt', 'annual payment', 'estim_payment_per_year', 'est annual'],
    'approx_monthly_income':       ['monthly income', 'monthly div', 'approx_monthly_income'],
    'annual_yield_on_cost':        ['yield on cost', 'yoc', 'annual_yield_on_cost'],
    'current_annual_yield':        ['current yield', 'yield', 'current_annual_yield'],
    'percent_of_account':          ['% of account', 'weight', 'allocation', 'percent_of_account'],
    'shares_bought_from_dividend': ['shares from div', 'div shares', 'shares_bought_from_dividend'],
    'shares_bought_in_year':       ['shares/year', 'shares year', 'shares_bought_in_year'],
    'shares_in_month':             ['shares/month', 'shares month', 'shares_in_month'],
    'ytd_divs':                    ['ytd divs', 'ytd dividends', 'ytd_divs'],
    'total_divs_received':         ['total divs received', 'total dividends', 'total_divs_received'],
    'paid_for_itself':             ['paid for itself', 'pfi', 'paid_for_itself'],
    'purchase_date':               ['date purchased', 'purchase date', 'buy date', 'purchase_date'],
    'cash_not_reinvested':         ['cash not reinvest', 'cash not reinvested', 'cash_not_reinvested'],
    'total_cash_reinvested':       ['cash reinvested', 'total cash reinvested', 'total_cash_reinvested'],
    'withdraw_8pct_cost_annually': ['8% annual wdraw', 'annual withdrawal', 'withdraw_8pct_cost_annually'],
    'withdraw_8pct_per_month':     ['8% monthly wdraw', 'monthly withdrawal', 'withdraw_8pct_per_month'],
    'percent_change':              ['% change', 'price change', 'percent_change'],
}


def _normalize_upload_columns(df):
    """Rename upload DataFrame columns to canonical SQL names using UPLOAD_COL_MAP."""
    lower_map = {col.lower().strip(): col for col in df.columns}
    rename = {}
    for canonical, aliases in UPLOAD_COL_MAP.items():
        for alias in aliases:
            if alias in lower_map:
                rename[lower_map[alias]] = canonical
                break
    return df.rename(columns=rename)


def import_from_upload(df, profile_id):
    """
    Import a user-uploaded DataFrame into all_account_info for the given profile.
    df must have at minimum: ticker, quantity (or shares).
    Optional: price_paid, div, div_frequency, ex_div_date, reinvest.
    Returns (row_count, message).
    """
    import yfinance as yf
    from datetime import datetime as _dt, date as _date

    df = _normalize_upload_columns(df.copy())

    if 'ticker' not in df.columns:
        raise ValueError("Upload file must have a 'Ticker' or 'Symbol' column.")
    if 'quantity' not in df.columns:
        raise ValueError("Upload file must have a 'Shares' or 'Quantity' column.")

    # Clean tickers
    df['ticker'] = df['ticker'].astype(str).str.strip().str.upper()
    df = df[df['ticker'].apply(lambda t: bool(_VALID_TICKER.match(t)))]
    df['quantity'] = pd.to_numeric(df['quantity'], errors='coerce')
    df = df[df['quantity'].notna() & (df['quantity'] > 0)]

    if df.empty:
        raise ValueError("No valid ticker rows found in upload.")

    freq_map = {1: 'A', 2: 'SA', 4: 'Q', 12: 'M', 52: 'W'}
    tickers_list = df['ticker'].tolist()
    ticker_str = ' '.join(tickers_list)

    def _freq_from_count(n):
        if n >= 45: return 'W'
        if n >= 10: return 'M'
        if n >= 3:  return 'Q'
        if n >= 2:  return 'SA'
        return 'A'

    # Batch download from yfinance
    price_map = {}
    div_map = {}
    exdiv_map = {}
    freq_hist = {}
    try:
        raw = yf.download(ticker_str, period='1y', progress=False, auto_adjust=False, actions=True)
        if not raw.empty:
            def _col(name):
                if isinstance(raw.columns, pd.MultiIndex):
                    return raw[name] if name in raw.columns.get_level_values(0) else None
                return raw[name] if name in raw.columns else None

            close = _col('Close')
            if close is not None:
                if isinstance(close, pd.Series):
                    s = close.dropna()
                    if len(s): price_map[tickers_list[0]] = float(s.iloc[-1])
                else:
                    for t in tickers_list:
                        if t in close.columns:
                            s = close[t].dropna()
                            if len(s): price_map[t] = float(s.iloc[-1])

            divs = _col('Dividends')
            if divs is not None:
                if isinstance(divs, pd.Series):
                    d = divs[divs > 0].dropna()
                    if not d.empty:
                        t0 = tickers_list[0]
                        div_map[t0] = float(d.iloc[-1])
                        exdiv_map[t0] = d.index[-1].strftime('%m/%d/%y')
                        freq_hist[t0] = _freq_from_count(len(d))
                else:
                    for t in tickers_list:
                        if t in divs.columns:
                            d = divs[t][divs[t] > 0].dropna()
                            if not d.empty:
                                div_map[t] = float(d.iloc[-1])
                                exdiv_map[t] = d.index[-1].strftime('%m/%d/%y')
                                freq_hist[t] = _freq_from_count(len(d))
    except Exception:
        pass

    # Per-ticker info for description / quoteType
    info_map = {}
    for t in tickers_list:
        try:
            info_map[t] = yf.Ticker(t).info or {}
        except Exception:
            info_map[t] = {}

    def _val(row, col):
        """Return a user-supplied value or None if missing/blank."""
        v = row.get(col, None)
        if v is None:
            return None
        s = str(v).strip()
        if s in ('', 'nan', 'None', 'NaN', 'none'):
            return None
        return v

    def _fval(row, col):
        """Return a float from user-supplied column, or None."""
        v = _val(row, col)
        if v is None:
            return None
        try:
            return float(v)
        except (ValueError, TypeError):
            return None

    enriched = []
    for _, row in df.iterrows():
        t = row['ticker']
        info = info_map.get(t, {})

        # ── Core pricing: user-supplied → yfinance → 0 ──────────────────
        current_price = (
            _fval(row, 'current_price') or
            price_map.get(t) or
            info.get('regularMarketPrice') or
            info.get('currentPrice') or 0.0
        )

        div = (
            _fval(row, 'div') or
            div_map.get(t) or
            info.get('dividendRate') or 0.0
        )

        # Ex-div date
        ex_div_raw = _val(row, 'ex_div_date')
        if ex_div_raw:
            ex_div_date = str(ex_div_raw).strip()
        else:
            ex_div_date = exdiv_map.get(t)
            if not ex_div_date:
                ex_ts = info.get('exDividendDate')
                if ex_ts:
                    try:
                        ex_div_date = _dt.utcfromtimestamp(ex_ts).strftime('%m/%d/%y')
                    except Exception:
                        ex_div_date = None

        # Frequency
        freq_raw = _val(row, 'div_frequency')
        if freq_raw and str(freq_raw).strip().upper() in ('A', 'SA', 'Q', 'M', 'W', '52'):
            div_frequency = str(freq_raw).strip().upper()
        elif t in freq_hist:
            div_frequency = freq_hist[t]
        else:
            div_frequency = freq_map.get(info.get('payoutFrequency'), 'Q')

        qty = float(row['quantity'])
        price_paid = _fval(row, 'price_paid') or current_price

        # ── Computed values: use user-supplied if present, else compute ──
        purchase_value = _fval(row, 'purchase_value') or (price_paid * qty)
        current_value = _fval(row, 'current_value') or (current_price * qty)
        gain_or_loss = _fval(row, 'gain_or_loss')
        if gain_or_loss is None:
            gain_or_loss = current_value - purchase_value
        gain_or_loss_pct = _fval(row, 'gain_or_loss_percentage')
        if gain_or_loss_pct is None:
            gain_or_loss_pct = (gain_or_loss / purchase_value) if purchase_value else 0
        percent_change = _fval(row, 'percent_change')
        if percent_change is None:
            percent_change = gain_or_loss_pct

        estim = _fval(row, 'estim_payment_per_year') or (div * qty)
        monthly_income = _fval(row, 'approx_monthly_income') or (estim / 12 if estim else 0)

        reinvest = str(_val(row, 'reinvest') or 'N').strip().upper()
        if reinvest not in ('Y', 'N'):
            reinvest = 'N'

        description = _val(row, 'description')
        if not description:
            description = info.get('longName', t)[:200] if info.get('longName') else t

        classification_type = _val(row, 'classification_type')
        if not classification_type:
            classification_type = info.get('quoteType', 'ETF')[:20]

        # Purchase date
        purchase_date = _val(row, 'purchase_date')
        if purchase_date:
            try:
                purchase_date = pd.to_datetime(purchase_date).strftime('%Y-%m-%d')
            except Exception:
                purchase_date = None

        enriched.append({
            'ticker':                     t,
            'description':                description,
            'classification_type':        str(classification_type)[:20],
            'price_paid':                 price_paid,
            'current_price':              current_price,
            'percent_change':             percent_change,
            'quantity':                    qty,
            'purchase_value':             purchase_value,
            'current_value':              current_value,
            'gain_or_loss':               gain_or_loss,
            'gain_or_loss_percentage':    gain_or_loss_pct,
            'div_frequency':              div_frequency,
            'reinvest':                   reinvest,
            'ex_div_date':                ex_div_date,
            'div':                        div,
            'dividend_paid':              _fval(row, 'dividend_paid'),
            'estim_payment_per_year':     estim,
            'approx_monthly_income':      monthly_income,
            'withdraw_8pct_cost_annually': _fval(row, 'withdraw_8pct_cost_annually'),
            'withdraw_8pct_per_month':    _fval(row, 'withdraw_8pct_per_month'),
            'cash_not_reinvested':        _fval(row, 'cash_not_reinvested'),
            'total_cash_reinvested':      _fval(row, 'total_cash_reinvested'),
            'annual_yield_on_cost':       _fval(row, 'annual_yield_on_cost') or ((div / price_paid) if price_paid else 0),
            'current_annual_yield':       _fval(row, 'current_annual_yield') or ((div / current_price) if current_price else 0),
            'percent_of_account':         _fval(row, 'percent_of_account'),
            'shares_bought_from_dividend': _fval(row, 'shares_bought_from_dividend'),
            'shares_bought_in_year':      _fval(row, 'shares_bought_in_year'),
            'shares_in_month':            _fval(row, 'shares_in_month'),
            'ytd_divs':                   _fval(row, 'ytd_divs'),
            'total_divs_received':        _fval(row, 'total_divs_received'),
            'paid_for_itself':            _fval(row, 'paid_for_itself'),
            'purchase_date':              purchase_date,
            'import_date':                _date.today().isoformat(),
            'profile_id':                 profile_id,
        })

    out = pd.DataFrame(enriched)
    insert_cols = list(out.columns)
    placeholders = ', '.join(['?'] * len(insert_cols))
    insert_sql = f"INSERT INTO all_account_info ({', '.join(insert_cols)}) VALUES ({placeholders})"

    conn = get_connection()
    ensure_tables_exist(conn)
    cur = conn.cursor()

    cur.execute("DELETE FROM all_account_info WHERE profile_id = ?", (profile_id,))

    row_count = 0
    for _, row in out.iterrows():
        values = [None if pd.isna(v) else v for v in row.tolist()]
        cur.execute(insert_sql, values)
        row_count += 1

    conn.commit()
    conn.close()
    return row_count, f"Imported {row_count} holdings for profile {profile_id}."
