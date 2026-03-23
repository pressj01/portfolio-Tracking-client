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
            div_pay_date               TEXT,
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

    # ── migrations ────────────────────────────────────────────────────────────
    try:
        cur.execute("ALTER TABLE all_account_info ADD COLUMN div_pay_date TEXT")
    except Exception:
        pass  # column already exists

    # ── holdings ───────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS holdings (
            ticker              TEXT NOT NULL,
            profile_id          INTEGER NOT NULL DEFAULT 1,
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
            purchase_date       TEXT,
            UNIQUE (ticker, profile_id)
        )
    """)
    # Migrate: add profile_id if missing
    _h_cols = {r[1] for r in cur.execute("PRAGMA table_info(holdings)").fetchall()}
    if "profile_id" not in _h_cols:
        cur.execute("DROP TABLE holdings")
        cur.execute("""
            CREATE TABLE holdings (
                ticker              TEXT NOT NULL,
                profile_id          INTEGER NOT NULL DEFAULT 1,
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
                purchase_date       TEXT,
                UNIQUE (ticker, profile_id)
            )
        """)

    # ── dividends ──────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dividends (
            ticker                 TEXT NOT NULL,
            profile_id             INTEGER NOT NULL DEFAULT 1,
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
            paid_for_itself        REAL,
            UNIQUE (ticker, profile_id)
        )
    """)
    # Migrate: add profile_id if missing
    _d_cols = {r[1] for r in cur.execute("PRAGMA table_info(dividends)").fetchall()}
    if "profile_id" not in _d_cols:
        cur.execute("DROP TABLE dividends")
        cur.execute("""
            CREATE TABLE dividends (
                ticker                 TEXT NOT NULL,
                profile_id             INTEGER NOT NULL DEFAULT 1,
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
                paid_for_itself        REAL,
                UNIQUE (ticker, profile_id)
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

    # ── drip_settings ─────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS drip_settings (
            ticker       TEXT NOT NULL,
            reinvest_pct REAL NOT NULL DEFAULT 100,
            profile_id   INTEGER NOT NULL DEFAULT 1,
            UNIQUE (ticker, profile_id)
        )
    """)

    # ── drip_monthly_contribution ─────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS drip_monthly_contribution (
            profile_id     INTEGER NOT NULL DEFAULT 1,
            monthly_amount REAL NOT NULL DEFAULT 0,
            targeted       INTEGER NOT NULL DEFAULT 0,
            UNIQUE (profile_id)
        )
    """)

    # ── drip_contribution_targets ─────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS drip_contribution_targets (
            profile_id INTEGER NOT NULL DEFAULT 1,
            ticker     TEXT NOT NULL,
            UNIQUE (ticker, profile_id)
        )
    """)

    # ── drip_redirects ────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS drip_redirects (
            profile_id    INTEGER NOT NULL DEFAULT 1,
            source_ticker TEXT NOT NULL,
            target_ticker TEXT NOT NULL,
            UNIQUE (source_ticker, profile_id)
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
            rows_json       TEXT NOT NULL,
            comparison_json TEXT
        )
    """)

    # Add comparison_json column if missing (migration for existing DBs)
    try:
        cur.execute("SELECT comparison_json FROM portfolio_income_sim_saved LIMIT 1")
    except Exception:
        cur.execute("ALTER TABLE portfolio_income_sim_saved ADD COLUMN comparison_json TEXT")

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

    # Migrate old schemas: rename target_allocation → target_pct if needed
    _cat_cols = {r[1] for r in cur.execute("PRAGMA table_info(categories)").fetchall()}
    if "target_allocation" in _cat_cols and "target_pct" not in _cat_cols:
        cur.execute("ALTER TABLE categories RENAME COLUMN target_allocation TO target_pct")
    elif "target_pct" not in _cat_cols and "target_allocation" not in _cat_cols:
        try:
            cur.execute("ALTER TABLE categories ADD COLUMN target_pct REAL")
        except Exception:
            pass
    if "sort_order" not in _cat_cols:
        try:
            cur.execute("ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass

    # ── ticker_categories ──────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ticker_categories (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker      TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            profile_id  INTEGER NOT NULL DEFAULT 1,
            UNIQUE (ticker, category_id, profile_id),
            FOREIGN KEY (category_id) REFERENCES categories(id)
        )
    """)

    # Migrate: widen unique constraint from (ticker, profile_id) to (ticker, category_id, profile_id)
    _needs_tc_migrate = False
    for idx in cur.execute("PRAGMA index_list(ticker_categories)").fetchall():
        if idx[2] == 1:  # unique index
            cols = [r[2] for r in cur.execute(f"PRAGMA index_info('{idx[1]}')").fetchall()]
            if len(cols) == 2 and "category_id" not in cols:
                _needs_tc_migrate = True
                break
    if _needs_tc_migrate:
        cur.executescript("""
            CREATE TABLE IF NOT EXISTS ticker_categories_new (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker      TEXT NOT NULL,
                category_id INTEGER NOT NULL,
                profile_id  INTEGER NOT NULL DEFAULT 1,
                UNIQUE (ticker, category_id, profile_id),
                FOREIGN KEY (category_id) REFERENCES categories(id)
            );
            INSERT OR IGNORE INTO ticker_categories_new (id, ticker, category_id, profile_id)
                SELECT id, ticker, category_id, profile_id FROM ticker_categories;
            DROP TABLE ticker_categories;
            ALTER TABLE ticker_categories_new RENAME TO ticker_categories;
        """)

    # ── aggregate_config ────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS aggregate_config (
            member_profile_id INTEGER NOT NULL UNIQUE,
            FOREIGN KEY (member_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        )
    """)

    # ── settings ──────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    conn.commit()
    if close:
        conn.close()
