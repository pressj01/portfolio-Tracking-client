from config import get_connection


def ensure_tables_exist(conn=None):
    """Create all tables if they don't already exist."""
    close = False
    if conn is None:
        conn = get_connection()
        close = True

    cur = conn.cursor()

    # ── profiles ───────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS profiles (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        INSERT OR IGNORE INTO profiles (id, name) VALUES (1, 'Owner')
    """)

    # ── all_account_info ───────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS all_account_info (
            ticker                     TEXT NOT NULL,
            profile_id                 INTEGER NOT NULL DEFAULT 1,
            description                TEXT,
            classification_type        TEXT,
            price_paid                 REAL,
            current_price              REAL,
            percent_change             REAL,
            quantity                   REAL,
            purchase_value             REAL,
            current_value              REAL,
            gain_or_loss               REAL,
            gain_or_loss_percentage    REAL,
            div_frequency              TEXT,
            reinvest                   TEXT,
            ex_div_date                TEXT,
            div                        REAL,
            dividend_paid              REAL,
            estim_payment_per_year     REAL,
            approx_monthly_income      REAL,
            withdraw_8pct_cost_annually REAL,
            withdraw_8pct_per_month    REAL,
            cash_not_reinvested        REAL,
            total_cash_reinvested      REAL,
            annual_yield_on_cost       REAL,
            current_annual_yield       REAL,
            percent_of_account         REAL,
            shares_bought_from_dividend REAL,
            shares_bought_in_year      REAL,
            shares_in_month            REAL,
            ytd_divs                   REAL,
            total_divs_received        REAL,
            paid_for_itself            REAL,
            hedged_anchor              REAL,
            anchor                     REAL,
            gold_silver                REAL,
            booster                    REAL,
            juicer                     REAL,
            bdc                        REAL,
            growth                     REAL,
            account_yield_on_cost      REAL,
            current_yield_of_account   REAL,
            dollars_per_hour           REAL,
            import_date                TEXT,
            purchase_date              TEXT,
            current_month_income       REAL,
            UNIQUE (ticker, profile_id)
        )
    """)

    # ── holdings ───────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS holdings (
            ticker              TEXT NOT NULL PRIMARY KEY,
            description         TEXT,
            classification_type TEXT,
            quantity            REAL,
            price_paid          REAL,
            current_price       REAL,
            purchase_value      REAL,
            current_value       REAL,
            gain_or_loss        REAL,
            gain_or_loss_percentage REAL,
            percent_change      REAL,
            purchase_date       TEXT
        )
    """)

    # ── dividends ──────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dividends (
            ticker                 TEXT NOT NULL PRIMARY KEY,
            div_frequency          TEXT,
            reinvest               TEXT,
            ex_div_date            TEXT,
            div_per_share          REAL,
            dividend_paid          REAL,
            estim_payment_per_year REAL,
            approx_monthly_income  REAL,
            annual_yield_on_cost   REAL,
            current_annual_yield   REAL,
            ytd_divs               REAL,
            total_divs_received    REAL,
            paid_for_itself        REAL
        )
    """)

    # ── income_tracking ────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS income_tracking (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker                 TEXT,
            import_date            TEXT,
            dividend_paid          REAL,
            approx_monthly_income  REAL,
            estim_payment_per_year REAL,
            dollars_per_hour       REAL,
            ytd_divs               REAL,
            total_divs_received    REAL,
            profile_id             INTEGER NOT NULL DEFAULT 1
        )
    """)

    # ── pillar_weights ─────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS pillar_weights (
            ticker        TEXT NOT NULL PRIMARY KEY,
            hedged_anchor REAL,
            anchor        REAL,
            gold_silver   REAL,
            booster       REAL,
            juicer        REAL,
            bdc           REAL,
            growth        REAL
        )
    """)

    # ── weekly_payouts ─────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS weekly_payouts (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            pay_date      TEXT NOT NULL,
            week_of_month INTEGER,
            amount        REAL,
            profile_id    INTEGER NOT NULL DEFAULT 1,
            UNIQUE (pay_date, profile_id)
        )
    """)

    # ── monthly_payouts ────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS monthly_payouts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            year       INTEGER NOT NULL,
            month      INTEGER NOT NULL,
            amount     REAL,
            profile_id INTEGER NOT NULL DEFAULT 1,
            UNIQUE (year, month, profile_id)
        )
    """)

    # ── weekly_payout_tickers ──────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS weekly_payout_tickers (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker         TEXT NOT NULL,
            shares         REAL,
            distribution   REAL,
            total_dividend REAL,
            profile_id     INTEGER NOT NULL DEFAULT 1,
            UNIQUE (ticker, profile_id)
        )
    """)

    # ── monthly_payout_tickers ─────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS monthly_payout_tickers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker     TEXT NOT NULL,
            pay_month  INTEGER NOT NULL,
            profile_id INTEGER NOT NULL DEFAULT 1,
            UNIQUE (ticker, pay_month, profile_id)
        )
    """)

    # ── nav_erosion_portfolio_list ─────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS nav_erosion_portfolio_list (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker       TEXT NOT NULL,
            amount       REAL NOT NULL,
            reinvest_pct REAL NOT NULL DEFAULT 0,
            sort_order   INTEGER NOT NULL DEFAULT 0
        )
    """)

    # ── nav_erosion_saved_backtests ────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS nav_erosion_saved_backtests (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            start_date TEXT,
            end_date   TEXT,
            rows_json  TEXT NOT NULL
        )
    """)

    # ── portfolio_income_sim_list ──────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_income_sim_list (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker         TEXT NOT NULL,
            amount         REAL NOT NULL,
            reinvest_pct   REAL NOT NULL DEFAULT 0,
            yield_override REAL,
            sort_order     INTEGER NOT NULL DEFAULT 0
        )
    """)

    # ── portfolio_income_sim_saved ─────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_income_sim_saved (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            mode            TEXT,
            start_date      TEXT,
            end_date        TEXT,
            market_type     TEXT,
            duration_months INTEGER,
            rows_json       TEXT NOT NULL
        )
    """)

    # ── watchlist_watching ─────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS watchlist_watching (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker     TEXT NOT NULL UNIQUE,
            notes      TEXT,
            added_date TEXT NOT NULL DEFAULT (date('now')),
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    """)

    # ── watchlist_sold ─────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS watchlist_sold (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker        TEXT NOT NULL,
            buy_price     REAL,
            sell_price    REAL,
            shares_sold   REAL,
            sell_date     TEXT,
            divs_received REAL,
            notes         TEXT,
            added_date    TEXT NOT NULL DEFAULT (date('now')),
            sort_order    INTEGER NOT NULL DEFAULT 0
        )
    """)

    # ── swap_candidates ────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS swap_candidates (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL DEFAULT 1,
            ticker     TEXT NOT NULL,
            added_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (profile_id, ticker)
        )
    """)

    # ── builder_portfolios ─────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS builder_portfolios (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL DEFAULT 1,
            name       TEXT NOT NULL,
            notes      TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (profile_id, name)
        )
    """)

    # ── builder_holdings ───────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS builder_holdings (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id  INTEGER NOT NULL,
            ticker        TEXT NOT NULL,
            dollar_amount REAL NOT NULL DEFAULT 0,
            added_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (portfolio_id, ticker),
            FOREIGN KEY (portfolio_id) REFERENCES builder_portfolios(id)
        )
    """)

    # ── simulator_portfolios ───────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS simulator_portfolios (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL DEFAULT 1,
            name       TEXT NOT NULL,
            notes      TEXT,
            budget     REAL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (profile_id, name)
        )
    """)

    # ── simulator_holdings ─────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS simulator_holdings (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id  INTEGER NOT NULL,
            ticker        TEXT NOT NULL,
            dollar_amount REAL NOT NULL DEFAULT 0,
            added_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (portfolio_id, ticker),
            FOREIGN KEY (portfolio_id) REFERENCES simulator_portfolios(id)
        )
    """)

    # ── categories ─────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            target_pct REAL,
            profile_id INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            UNIQUE (name, profile_id)
        )
    """)

    # ── ticker_categories ──────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ticker_categories (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker      TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            profile_id  INTEGER NOT NULL DEFAULT 1,
            UNIQUE (ticker, profile_id),
            FOREIGN KEY (category_id) REFERENCES categories(id)
        )
    """)

    conn.commit()
    if close:
        conn.close()
