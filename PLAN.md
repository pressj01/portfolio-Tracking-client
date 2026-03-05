# Portfolio Tracking Desktop Client — Phase 1: Database, Imports & Git Setup

## Overview
Create the foundation of a cross-platform Electron + React + Python desktop app based on the existing Flask Portfolio_Tracking application. This phase focuses on:
- Git repo initialization
- Project scaffolding (Electron + React frontend, Python/Flask backend)
- **SQLite** database (replaces SQL Server — portable, no install needed)
- Import system: your existing Excel template + a generic user upload template
- In-app CRUD for portfolio data

---

## Step 1 — Initialize Git Repo & Project Structure

```
portfolio_Tracking_client/
├── .gitignore
├── README.md
├── package.json              # Electron + React (Vite)
├── electron/
│   └── main.js               # Electron main process — launches Flask + browser window
├── src/                      # React frontend
│   ├── App.jsx
│   ├── main.jsx
│   └── pages/
├── backend/                  # Python Flask API
│   ├── app.py                # Flask app (API-only, no templates)
│   ├── config.py             # SQLite connection config
│   ├── database.py           # Schema creation (SQLite DDL)
│   ├── import_data.py        # Excel import (your format + generic)
│   ├── normalize.py          # Populate derived tables
│   ├── requirements.txt
│   └── portfolio.db           # SQLite database file (gitignored)
├── templates/                 # Downloadable Excel templates for users
│   └── portfolio_upload_template.xlsx
└── vite.config.js
```

- Run `git init`, create `.gitignore` (node_modules, __pycache__, *.db, .env, dist/)

---

## Step 2 — SQLite Database Schema (`backend/database.py`)

Convert all 16 SQL Server tables to SQLite syntax:

| Table | Key Changes from SQL Server |
|-------|----------------------------|
| `profiles` | `INTEGER PRIMARY KEY AUTOINCREMENT` replaces `INT IDENTITY` |
| `all_account_info` | Remove `dbo.` prefix, `UNIQUE(ticker, profile_id)` |
| `holdings` | Same columns, SQLite types (TEXT/REAL/INTEGER) |
| `dividends` | Same columns |
| `income_tracking` | `AUTOINCREMENT` for id |
| `pillar_weights` | Same |
| `weekly_payouts` | Same with UNIQUE constraint |
| `monthly_payouts` | Same |
| `weekly_payout_tickers` | Same |
| `monthly_payout_tickers` | Same |
| `nav_erosion_portfolio_list` | Same |
| `nav_erosion_saved_backtests` | Same |
| `portfolio_income_sim_list` | Same |
| `portfolio_income_sim_saved` | Same |
| `watchlist_watching` | Same |
| `watchlist_sold` | Same |
| `swap_candidates` | Same |
| `builder_portfolios` | Same |
| `builder_holdings` | Same with FK |
| `simulator_portfolios` | Same |
| `simulator_holdings` | Same with FK |
| `categories` | Same |
| `ticker_categories` | Same with FK |

Key SQLite differences:
- No `NVARCHAR` → use `TEXT`
- No `FLOAT` → use `REAL`
- No `INT IDENTITY` → use `INTEGER PRIMARY KEY AUTOINCREMENT`
- No `GETDATE()` → use `CURRENT_TIMESTAMP`
- No `MERGE` statements → use `INSERT OR REPLACE` / `INSERT ... ON CONFLICT`
- No `dbo.` schema prefix
- Use `sqlite3` stdlib module (no pyodbc dependency for end users)

---

## Step 3 — Config (`backend/config.py`)

```python
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'portfolio.db')

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
```

---

## Step 4 — Import System (`backend/import_data.py`)

### 4a — Your existing Excel format (COLUMN_MAP import)
- Port `import_from_excel()` to use SQLite syntax
- Accept a **file path** parameter instead of hardcoded `EXCEL_PATH`
- Keep the same `COLUMN_MAP` for your spreadsheet columns
- Keep yfinance enrichment for `paid_for_itself`
- Replace `MERGE` with `INSERT OR REPLACE`
- Replace `dbo.` prefixes

### 4b — Generic user upload (import_from_upload)
- Port `import_from_upload()` — already flexible with `UPLOAD_COL_MAP`
- Same yfinance enrichment logic
- SQLite syntax

### 4c — Weekly/Monthly payout imports
- Port `import_weekly_payouts()`, `import_monthly_payouts()`, `import_monthly_payout_tickers()`
- These read specific Excel sheets — keep as-is for your template
- For generic users: these are optional (they can add payout data via CRUD instead)

---

## Step 5 — Normalize (`backend/normalize.py`)

Convert all 4 functions to SQLite:
- `populate_holdings()` — replace `MERGE` with `INSERT OR REPLACE`
- `populate_dividends()` — same
- `populate_income_tracking()` — replace `NOT EXISTS` subquery (works in SQLite as-is)
- `populate_pillar_weights()` — replace `MERGE`

---

## Step 6 — Flask API Endpoints (`backend/app.py`)

API-only Flask app (no Jinja templates — React will be the frontend):

```
POST /api/import/excel          — Upload your Excel format
POST /api/import/generic        — Upload generic spreadsheet
POST /api/import/weekly-payouts — Import weekly payout sheet
POST /api/import/monthly-payouts — Import monthly payout sheet

GET    /api/holdings            — List all holdings for profile
POST   /api/holdings            — Add a holding manually
PUT    /api/holdings/<ticker>   — Update a holding
DELETE /api/holdings/<ticker>   — Delete a holding

GET    /api/dividends           — List dividends
PUT    /api/dividends/<ticker>  — Update dividend info

GET    /api/profiles            — List profiles
POST   /api/profiles            — Create profile
PUT    /api/profiles/<id>       — Update profile
DELETE /api/profiles/<id>       — Delete profile

GET    /api/income-tracking     — Income history
GET    /api/payouts/weekly      — Weekly payouts
GET    /api/payouts/monthly     — Monthly payouts
```

---

## Step 7 — Downloadable Template

Create a simple Excel template (`templates/portfolio_upload_template.xlsx`) with columns:
- Ticker, Shares, Price Paid, Dividend, Frequency, Ex-Div Date, DRIP

This gives new users a starting point.

---

## Implementation Order

1. `git init` + `.gitignore` + project structure
2. `backend/config.py` (SQLite connection)
3. `backend/database.py` (all table DDL)
4. `backend/import_data.py` (ported to SQLite)
5. `backend/normalize.py` (ported to SQLite)
6. `backend/app.py` (Flask API with CRUD + import endpoints)
7. `backend/requirements.txt`
8. Basic Electron + React scaffolding (enough to call the API)
9. Excel upload template

---

## Dependencies

**Python (backend/requirements.txt):**
- flask, flask-cors
- pandas, openpyxl
- yfinance
- plotly (for later chart endpoints)

**Node (package.json):**
- electron
- react, react-dom
- vite, @vitejs/plugin-react

No pyodbc needed — SQLite is built into Python.
