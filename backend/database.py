import os
import sys

from config import get_connection


def _seed_db_candidates():
    """Return likely locations for bundled provider seed data."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "seed", "etf_providers.db"),
        os.path.join(os.getcwd(), "seed", "etf_providers.db"),
        os.path.join(os.getcwd(), "_internal", "seed", "etf_providers.db"),
    ]
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir:
        candidates.append(os.path.join(bundle_dir, "seed", "etf_providers.db"))
    return candidates


def _seed_etf_provider_data(conn):
    """Load ETF provider reference data into a fresh database."""
    has_funds = conn.execute("SELECT COUNT(*) FROM etf_provider_funds").fetchone()[0]
    if has_funds:
        return

    seed_path = next((p for p in _seed_db_candidates() if os.path.exists(p)), None)
    if not seed_path:
        return

    conn.execute("ATTACH DATABASE ? AS etf_seed", (seed_path,))
    try:
        seed_funds = conn.execute("SELECT COUNT(*) FROM etf_seed.etf_provider_funds").fetchone()[0]
        if not seed_funds:
            return
        conn.execute("""
            INSERT OR IGNORE INTO etf_providers
                (id, provider, total_assets, num_funds, avg_expense)
            SELECT id, provider, total_assets, num_funds, avg_expense
            FROM etf_seed.etf_providers
        """)
        conn.execute("""
            INSERT OR IGNORE INTO etf_provider_funds
                (id, provider_id, symbol, fund_name, assets, div_yield, exp_ratio,
                 change_1y, annual_div, ex_div_date, frequency, payout_ratio, div_growth)
            SELECT id, provider_id, symbol, fund_name, assets, div_yield, exp_ratio,
                   change_1y, annual_div, ex_div_date, frequency, payout_ratio, div_growth
            FROM etf_seed.etf_provider_funds
        """)
        conn.commit()
    finally:
        conn.execute("DETACH DATABASE etf_seed")


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
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            broker_source    TEXT,
            include_in_owner INTEGER NOT NULL DEFAULT 0,
            positions_managed INTEGER NOT NULL DEFAULT 0,
            created_at       TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Migration: add include_in_owner column if missing (existing databases)
    cols = [r[1] for r in cur.execute("PRAGMA table_info(profiles)").fetchall()]
    if "include_in_owner" not in cols:
        cur.execute("ALTER TABLE profiles ADD COLUMN include_in_owner INTEGER NOT NULL DEFAULT 0")
        cur.execute("UPDATE profiles SET include_in_owner = 1 WHERE id = 1")
    if "positions_managed" not in cols:
        cur.execute("ALTER TABLE profiles ADD COLUMN positions_managed INTEGER NOT NULL DEFAULT 0")
    if "broker_source" not in cols:
        cur.execute("ALTER TABLE profiles ADD COLUMN broker_source TEXT")
    cur.execute("""
        INSERT OR IGNORE INTO profiles (id, name, include_in_owner, positions_managed) VALUES (1, 'Owner', 1, 0)
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
            original_price_paid        REAL,
            original_purchase_value    REAL,
            broker_price_paid          REAL,
            broker_purchase_value      REAL,
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
            dividend_actuals_source    TEXT,
            nav_erosion_scope          TEXT NOT NULL DEFAULT 'auto',
            nav_benchmark_override     TEXT,
            UNIQUE (ticker, profile_id)
        )
    """)

    # ── migrations ────────────────────────────────────────────────────────────
    try:
        cur.execute("ALTER TABLE all_account_info ADD COLUMN div_pay_date TEXT")
    except Exception:
        pass  # column already exists

    try:
        cur.execute("ALTER TABLE all_account_info ADD COLUMN base_quantity REAL")
    except Exception:
        pass  # column already exists

    for _col in (
        ("original_price_paid", "REAL"),
        ("original_purchase_value", "REAL"),
        ("broker_price_paid", "REAL"),
        ("broker_purchase_value", "REAL"),
    ):
        try:
            cur.execute(f"ALTER TABLE all_account_info ADD COLUMN {_col[0]} {_col[1]}")
        except Exception:
            pass  # column already exists

    cur.execute("""
        UPDATE all_account_info
           SET original_price_paid = COALESCE(original_price_paid, price_paid),
               original_purchase_value = COALESCE(original_purchase_value, purchase_value),
               broker_price_paid = COALESCE(broker_price_paid, price_paid),
               broker_purchase_value = COALESCE(broker_purchase_value, purchase_value)
    """)

    # Initialize base_quantity from quantity where not yet set
    cur.execute("UPDATE all_account_info SET base_quantity = quantity WHERE base_quantity IS NULL")

    try:
        cur.execute("ALTER TABLE all_account_info ADD COLUMN realized_gains REAL DEFAULT 0")
    except Exception:
        pass  # column already exists

    try:
        cur.execute("ALTER TABLE all_account_info ADD COLUMN drip_quantity REAL")
    except Exception:
        pass  # column already exists

    try:
        cur.execute("ALTER TABLE all_account_info ADD COLUMN dividend_actuals_source TEXT")
    except Exception:
        pass  # column already exists

    try:
        cur.execute("ALTER TABLE all_account_info ADD COLUMN nav_erosion_scope TEXT NOT NULL DEFAULT 'auto'")
    except Exception:
        pass  # column already exists

    try:
        cur.execute("ALTER TABLE all_account_info ADD COLUMN nav_benchmark_override TEXT")
    except Exception:
        pass  # column already exists

    # Repair yield-on-cost rows stored as percent (e.g. 17.68) instead of ratio
    # (0.1768). Values > 1 are almost always legacy percent-form and get divided
    # by 100 to match the rest of the codebase.
    cur.execute("UPDATE all_account_info SET annual_yield_on_cost = annual_yield_on_cost / 100.0 WHERE annual_yield_on_cost > 1")
    cur.execute("UPDATE all_account_info SET current_annual_yield = current_annual_yield / 100.0 WHERE current_annual_yield > 1")

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
            original_price_paid REAL,
            original_purchase_value REAL,
            broker_price_paid   REAL,
            broker_purchase_value REAL,
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
                original_price_paid REAL,
                original_purchase_value REAL,
                broker_price_paid   REAL,
                broker_purchase_value REAL,
                current_value       REAL,
                gain_or_loss        REAL,
                gain_or_loss_percentage REAL,
                percent_change      REAL,
                purchase_date       TEXT,
                UNIQUE (ticker, profile_id)
            )
        """)
    else:
        for _col in (
            ("original_price_paid", "REAL"),
            ("original_purchase_value", "REAL"),
            ("broker_price_paid", "REAL"),
            ("broker_purchase_value", "REAL"),
        ):
            if _col[0] not in _h_cols:
                try:
                    cur.execute(f"ALTER TABLE holdings ADD COLUMN {_col[0]} {_col[1]}")
                except Exception:
                    pass

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

    # Same YoC percent→ratio repair for the dividends mirror table.
    cur.execute("UPDATE dividends SET annual_yield_on_cost = annual_yield_on_cost / 100.0 WHERE annual_yield_on_cost > 1")
    cur.execute("UPDATE dividends SET current_annual_yield = current_annual_yield / 100.0 WHERE current_annual_yield > 1")

    # Cache ticker-level dividend safety fundamentals/scores. These values come
    # from external market data and are refreshed by the API on a TTL.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dividend_safety_cache (
            ticker  TEXT PRIMARY KEY,
            as_of   TEXT NOT NULL,
            payload TEXT NOT NULL
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
    try:
        cur.execute("SELECT div_yield_override FROM watchlist_watching LIMIT 1")
    except Exception:
        cur.execute("ALTER TABLE watchlist_watching ADD COLUMN div_yield_override REAL")
    try:
        cur.execute("SELECT nav_erosion_scope FROM watchlist_watching LIMIT 1")
    except Exception:
        cur.execute("ALTER TABLE watchlist_watching ADD COLUMN nav_erosion_scope TEXT NOT NULL DEFAULT 'auto'")
    try:
        cur.execute("SELECT nav_benchmark_override FROM watchlist_watching LIMIT 1")
    except Exception:
        cur.execute("ALTER TABLE watchlist_watching ADD COLUMN nav_benchmark_override TEXT")

    # ── scanner_tickers ──────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS scanner_tickers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker     TEXT NOT NULL UNIQUE,
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

    # ── rebalance_candidate_preferences ───────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rebalance_candidate_preferences (
            profile_id INTEGER NOT NULL DEFAULT 1,
            category   TEXT NOT NULL,
            ticker     TEXT NOT NULL,
            rank       INTEGER NOT NULL DEFAULT 0,
            preferred  INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (profile_id, category, ticker)
        )
    """)

    # ── rebalance_saved_plans ─────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rebalance_saved_plans (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id            INTEGER NOT NULL DEFAULT 1,
            name                  TEXT NOT NULL,
            settings_json         TEXT NOT NULL,
            result_json           TEXT NOT NULL,
            trade_state_json      TEXT NOT NULL,
            effective_trades_json TEXT NOT NULL,
            summary_json          TEXT NOT NULL,
            created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_rebalance_saved_plans_profile_updated
        ON rebalance_saved_plans (profile_id, updated_at)
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
            subcategory_id INTEGER,
            UNIQUE (ticker, profile_id),
            FOREIGN KEY (category_id) REFERENCES categories(id)
        )
    """)

    # A ticker belongs to exactly one top-level category per profile. Older
    # builds allowed multiple rows as long as category_id differed, which made
    # category/sub-category displays ambiguous after edits.
    _tc_cols_before = {r[1] for r in cur.execute("PRAGMA table_info(ticker_categories)").fetchall()}
    _has_id = "id" in _tc_cols_before
    _has_subcategory_id = "subcategory_id" in _tc_cols_before
    _has_ticker_profile_unique = False
    for idx in cur.execute("PRAGMA index_list(ticker_categories)").fetchall():
        if idx[2] == 1:  # unique index
            cols = [r[2] for r in cur.execute(f"PRAGMA index_info('{idx[1]}')").fetchall()]
            if cols == ["ticker", "profile_id"]:
                _has_ticker_profile_unique = True
                break
    if not _has_ticker_profile_unique or not _has_subcategory_id:
        cur.execute("""
            CREATE TABLE ticker_categories_new (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker      TEXT NOT NULL,
                category_id INTEGER NOT NULL,
                profile_id  INTEGER NOT NULL DEFAULT 1,
                subcategory_id INTEGER,
                UNIQUE (ticker, profile_id),
                FOREIGN KEY (category_id) REFERENCES categories(id)
            )
        """)
        if _has_id and _has_subcategory_id:
            cur.execute("""
                INSERT OR IGNORE INTO ticker_categories_new
                    (id, ticker, category_id, profile_id, subcategory_id)
                SELECT tc.id, tc.ticker, tc.category_id, tc.profile_id, tc.subcategory_id
                  FROM ticker_categories tc
                  JOIN (
                    SELECT ticker, profile_id, MAX(id) AS keep_id
                      FROM ticker_categories
                     GROUP BY ticker, profile_id
                  ) keep
                    ON keep.ticker = tc.ticker
                   AND keep.profile_id = tc.profile_id
                   AND keep.keep_id = tc.id
            """)
        elif _has_id:
            cur.execute("""
                INSERT OR IGNORE INTO ticker_categories_new
                    (id, ticker, category_id, profile_id)
                SELECT tc.id, tc.ticker, tc.category_id, tc.profile_id
                  FROM ticker_categories tc
                  JOIN (
                    SELECT ticker, profile_id, MAX(id) AS keep_id
                      FROM ticker_categories
                     GROUP BY ticker, profile_id
                  ) keep
                    ON keep.ticker = tc.ticker
                   AND keep.profile_id = tc.profile_id
                   AND keep.keep_id = tc.id
            """)
        elif _has_subcategory_id:
            cur.execute("""
                INSERT OR IGNORE INTO ticker_categories_new
                    (ticker, category_id, profile_id, subcategory_id)
                SELECT tc.ticker, tc.category_id, tc.profile_id, tc.subcategory_id
                  FROM ticker_categories tc
                  JOIN (
                    SELECT ticker, profile_id, MAX(rowid) AS keep_rowid
                      FROM ticker_categories
                     GROUP BY ticker, profile_id
                  ) keep
                    ON keep.ticker = tc.ticker
                   AND keep.profile_id = tc.profile_id
                   AND keep.keep_rowid = tc.rowid
            """)
        else:
            cur.execute("""
                INSERT OR IGNORE INTO ticker_categories_new
                    (ticker, category_id, profile_id)
                SELECT tc.ticker, tc.category_id, tc.profile_id
                  FROM ticker_categories tc
                  JOIN (
                    SELECT ticker, profile_id, MAX(rowid) AS keep_rowid
                      FROM ticker_categories
                     GROUP BY ticker, profile_id
                  ) keep
                    ON keep.ticker = tc.ticker
                   AND keep.profile_id = tc.profile_id
                   AND keep.keep_rowid = tc.rowid
            """)
        cur.execute("DROP TABLE ticker_categories")
        cur.execute("ALTER TABLE ticker_categories_new RENAME TO ticker_categories")

    # ── subcategories ───────────────────────────────────────────────────────────
    # Optional second tier within a category (e.g. Metals → Gold / Silver / Copper).
    # Purely additive: tickers keep their top-level category_id so every other
    # feature is unaffected; subcategory_id is grouping metadata for the
    # Categories page only.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS subcategories (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            name        TEXT NOT NULL,
            target_pct  REAL,
            profile_id  INTEGER NOT NULL DEFAULT 1,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            UNIQUE (category_id, name, profile_id),
            FOREIGN KEY (category_id) REFERENCES categories(id)
        )
    """)

    # Add target_pct to subcategories if missing (sub-category target = % of parent category)
    _subcat_cols = {r[1] for r in cur.execute("PRAGMA table_info(subcategories)").fetchall()}
    if "target_pct" not in _subcat_cols:
        try:
            cur.execute("ALTER TABLE subcategories ADD COLUMN target_pct REAL")
        except Exception:
            pass

    # Add subcategory_id to ticker_categories if missing
    _tc_cols = {r[1] for r in cur.execute("PRAGMA table_info(ticker_categories)").fetchall()}
    if "subcategory_id" not in _tc_cols:
        try:
            cur.execute("ALTER TABLE ticker_categories ADD COLUMN subcategory_id INTEGER")
        except Exception:
            pass

    # ── transactions ─────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker          TEXT NOT NULL,
            profile_id      INTEGER NOT NULL DEFAULT 1,
            transaction_type TEXT NOT NULL DEFAULT 'BUY',
            transaction_date TEXT,
            shares          REAL NOT NULL,
            price_per_share REAL,
            fees            REAL DEFAULT 0,
            realized_gain   REAL,
            notes           TEXT,
            created_at      TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Migration: add transaction_type and realized_gain if missing
    _txn_cols = {r[1] for r in cur.execute("PRAGMA table_info(transactions)").fetchall()}
    if "transaction_type" not in _txn_cols:
        cur.execute("ALTER TABLE transactions ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'BUY'")
    if "realized_gain" not in _txn_cols:
        cur.execute("ALTER TABLE transactions ADD COLUMN realized_gain REAL")
    # Index for fast rollup queries
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_transactions_ticker_profile
        ON transactions (ticker, profile_id)
    """)

    # ── transaction_lot_allocations ───────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS transaction_lot_allocations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            sell_txn_id     INTEGER NOT NULL,
            buy_txn_id      INTEGER NOT NULL,
            shares          REAL NOT NULL,
            FOREIGN KEY (sell_txn_id) REFERENCES transactions(id) ON DELETE CASCADE,
            FOREIGN KEY (buy_txn_id) REFERENCES transactions(id) ON DELETE CASCADE
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_lot_alloc_sell
        ON transaction_lot_allocations (sell_txn_id)
    """)

    # ── dividend_payments ───────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dividend_payments (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker          TEXT NOT NULL,
            profile_id      INTEGER NOT NULL DEFAULT 1,
            payment_date    TEXT NOT NULL,
            amount          REAL NOT NULL,
            source          TEXT DEFAULT 'manual',
            notes           TEXT,
            created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (ticker, profile_id, payment_date)
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_div_payments_ticker_profile
        ON dividend_payments (ticker, profile_id)
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS dividend_schedule_history (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker       TEXT NOT NULL,
            profile_id   INTEGER NOT NULL DEFAULT 1,
            ex_div_date  TEXT NOT NULL,
            pay_date     TEXT NOT NULL,
            frequency    TEXT,
            source       TEXT DEFAULT 'refresh',
            created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (ticker, profile_id, ex_div_date, pay_date)
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_div_schedule_history_ticker
        ON dividend_schedule_history (ticker, profile_id)
    """)

    # ── aggregates ──────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS aggregates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    """)

    # ── aggregate_config ────────────────────────────────────────────────────
    # New shape: (aggregate_id, member_profile_id) — supports many aggregates.
    # Migrate from legacy shape that had member_profile_id UNIQUE and no aggregate_id.
    _ac_cols = {r[1] for r in cur.execute("PRAGMA table_info(aggregate_config)").fetchall()}
    if _ac_cols and "aggregate_id" not in _ac_cols:
        _name_row = cur.execute(
            "SELECT value FROM settings WHERE key = 'aggregate_name'"
        ).fetchone()
        _legacy_name = (_name_row[0] if _name_row else None) or "Combined Portfolios"
        cur.execute("INSERT OR IGNORE INTO aggregates (id, name) VALUES (1, ?)", (_legacy_name,))
        cur.execute("ALTER TABLE aggregate_config RENAME TO _aggregate_config_legacy")
        cur.execute("""
            CREATE TABLE aggregate_config (
                aggregate_id      INTEGER NOT NULL,
                member_profile_id INTEGER NOT NULL,
                UNIQUE (aggregate_id, member_profile_id),
                FOREIGN KEY (aggregate_id) REFERENCES aggregates(id) ON DELETE CASCADE,
                FOREIGN KEY (member_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            INSERT INTO aggregate_config (aggregate_id, member_profile_id)
            SELECT 1, member_profile_id FROM _aggregate_config_legacy
        """)
        cur.execute("DROP TABLE _aggregate_config_legacy")
        cur.execute("DELETE FROM settings WHERE key = 'aggregate_name'")
    else:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS aggregate_config (
                aggregate_id      INTEGER NOT NULL,
                member_profile_id INTEGER NOT NULL,
                UNIQUE (aggregate_id, member_profile_id),
                FOREIGN KEY (aggregate_id) REFERENCES aggregates(id) ON DELETE CASCADE,
                FOREIGN KEY (member_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            )
        """)

    # ── macro_overrides ────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS macro_overrides (
            ticker          TEXT NOT NULL,
            profile_id      INTEGER NOT NULL DEFAULT 1,
            sensitivity_tags TEXT NOT NULL,
            updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, profile_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        )
    """)

    # ── income_overrides ────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS income_overrides (
            ticker          TEXT NOT NULL,
            profile_id      INTEGER NOT NULL DEFAULT 1,
            bucket          TEXT NOT NULL,
            updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, profile_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        )
    """)

    # ── income_benchmark_targets ─────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS income_benchmark_targets (
            bucket      TEXT NOT NULL,
            profile_id  INTEGER NOT NULL DEFAULT 1,
            target_pct  REAL NOT NULL,
            updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (bucket, profile_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        )
    """)

    # ── regime_history (Markov chain quadrant tracking) ─────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS regime_history (
            date               TEXT NOT NULL PRIMARY KEY,
            quadrant           INTEGER NOT NULL,
            growth_score       REAL,
            inflation_score    REAL,
            growth_direction   TEXT,
            inflation_direction TEXT
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_regime_history_date
        ON regime_history(date)
    """)
    _rh_cols = {r[1] for r in cur.execute("PRAGMA table_info(regime_history)").fetchall()}
    for _c in ("prob_q1", "prob_q2", "prob_q3", "prob_q4"):
        if _c not in _rh_cols:
            cur.execute(f"ALTER TABLE regime_history ADD COLUMN {_c} REAL")

    # ── settings ──────────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    # ── dividend_tax_overrides ───────────────────────────────────────────────
    # Per-ticker tax-treatment override for dividend payments. year=0 applies
    # to all years (acts as a permanent default for that ticker); a specific
    # year takes precedence over the year=0 row.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dividend_tax_overrides (
            ticker      TEXT NOT NULL,
            profile_id  INTEGER NOT NULL DEFAULT 1,
            year        INTEGER NOT NULL DEFAULT 0,
            treatment   TEXT NOT NULL,
            qualified_pct REAL,
            ordinary_pct  REAL,
            roc_pct       REAL,
            total_amount   REAL,
            updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticker, profile_id, year)
        )
    """)
    _tax_cols = {r[1] for r in cur.execute("PRAGMA table_info(dividend_tax_overrides)").fetchall()}
    if "qualified_pct" not in _tax_cols:
        cur.execute("ALTER TABLE dividend_tax_overrides ADD COLUMN qualified_pct REAL")
    if "ordinary_pct" not in _tax_cols:
        cur.execute("ALTER TABLE dividend_tax_overrides ADD COLUMN ordinary_pct REAL")
    if "roc_pct" not in _tax_cols:
        cur.execute("ALTER TABLE dividend_tax_overrides ADD COLUMN roc_pct REAL")
    if "total_amount" not in _tax_cols:
        cur.execute("ALTER TABLE dividend_tax_overrides ADD COLUMN total_amount REAL")

    # ── tax_loss_plan ────────────────────────────────────────────────────────
    # Persists user-planned tax-loss harvests. Drives Action Center entries.
    # buy_txn_id NULL means "all open lots of this ticker".
    # status: planned | executed | dismissed
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tax_loss_plan (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id    INTEGER NOT NULL,
            ticker        TEXT NOT NULL,
            buy_txn_id    INTEGER,
            shares        REAL NOT NULL,
            est_loss      REAL NOT NULL,
            est_tax_saved REAL,
            replacement   TEXT,
            status        TEXT NOT NULL DEFAULT 'planned',
            notes         TEXT,
            created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_tax_loss_plan_profile
        ON tax_loss_plan (profile_id, status)
    """)

    # ── regime_predictions (Brier score tracking) ─────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS regime_predictions (
            prediction_date TEXT NOT NULL,
            horizon         TEXT NOT NULL,
            target_date     TEXT NOT NULL,
            prob_q1         REAL NOT NULL,
            prob_q2         REAL NOT NULL,
            prob_q3         REAL NOT NULL,
            prob_q4         REAL NOT NULL,
            actual_quadrant INTEGER,
            PRIMARY KEY (prediction_date, horizon)
        )
    """)
    _rp_cols = {r[1] for r in cur.execute("PRAGMA table_info(regime_predictions)").fetchall()}
    for _c in ("actual_prob_q1", "actual_prob_q2", "actual_prob_q3", "actual_prob_q4"):
        if _c not in _rp_cols:
            cur.execute(f"ALTER TABLE regime_predictions ADD COLUMN {_c} REAL")

    # ── general_scanner_cache ────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS general_scanner_cache (
            ticker          TEXT PRIMARY KEY,
            name            TEXT,
            sector          TEXT,
            industry        TEXT,
            country         TEXT,
            market_cap      REAL,
            price           REAL,
            pe_ratio        REAL,
            forward_pe      REAL,
            peg_ratio       REAL,
            ps_ratio        REAL,
            pb_ratio        REAL,
            dividend_yield  REAL,
            eps             REAL,
            revenue         REAL,
            profit_margin   REAL,
            roe             REAL,
            debt_to_equity  REAL,
            current_ratio   REAL,
            beta            REAL,
            week52_high     REAL,
            week52_low      REAL,
            avg_volume      REAL,
            sma_20          REAL,
            sma_50          REAL,
            sma_200         REAL,
            rsi_14          REAL,
            change_pct      REAL,
            volume          REAL,
            asset_type      TEXT,
            expense_ratio   REAL,
            aum             REAL,
            etf_category    TEXT,
            etf_strategy    TEXT,
            etf_cap_size    TEXT,
            updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migration: add columns if missing
    cache_cols = [r[1] for r in cur.execute("PRAGMA table_info(general_scanner_cache)").fetchall()]
    for col in ["etf_category", "etf_strategy", "etf_cap_size"]:
        if col not in cache_cols:
            cur.execute(f"ALTER TABLE general_scanner_cache ADD COLUMN {col} TEXT")
    for col in ["macd_line", "macd_signal", "macd_hist", "stoch_k", "stoch_d",
                "prev_sma_20", "prev_sma_50", "prev_sma_200",
                "three_year_return", "five_year_return", "ytd_return", "beta_3y"]:
        if col not in cache_cols:
            cur.execute(f"ALTER TABLE general_scanner_cache ADD COLUMN {col} REAL")
    for col in ["fund_family"]:
        if col not in cache_cols:
            cur.execute(f"ALTER TABLE general_scanner_cache ADD COLUMN {col} TEXT")

    # One-time fix: clear ETF columns that had timestamps (from earlier column-order bug)
    cur.execute("""
        UPDATE general_scanner_cache
        SET etf_category = NULL, etf_strategy = NULL, etf_cap_size = NULL
        WHERE etf_category LIKE '20__-%'
           OR etf_strategy LIKE '20__-%'
           OR etf_cap_size LIKE '20__-%'
    """)

    # ── general_scanner_universe ──────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS general_scanner_universe (
            ticker     TEXT PRIMARY KEY,
            asset_type TEXT DEFAULT 'Stock',
            added_date TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ── option_strategies ─────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS option_strategies (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            underlying   TEXT NOT NULL,
            model        TEXT DEFAULT 'black-scholes',
            rate         REAL DEFAULT 0.0375,
            notes        TEXT,
            created_date TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_date TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS option_strategy_legs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id  INTEGER NOT NULL,
            group_id     INTEGER DEFAULT 0,
            included     INTEGER DEFAULT 1,
            side         TEXT NOT NULL,
            qty          INTEGER NOT NULL,
            opt_type     TEXT NOT NULL,
            strike       REAL NOT NULL,
            expiration   TEXT NOT NULL,
            entry_price  REAL,
            iv_override  REAL,
            sort_order   INTEGER DEFAULT 0,
            FOREIGN KEY (strategy_id) REFERENCES option_strategies(id) ON DELETE CASCADE
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS etf_providers (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            provider     TEXT NOT NULL UNIQUE,
            total_assets REAL,
            num_funds    INTEGER,
            avg_expense  REAL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS etf_provider_funds (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER NOT NULL,
            symbol      TEXT NOT NULL,
            fund_name   TEXT,
            assets      REAL,
            div_yield   REAL,
            exp_ratio   REAL,
            change_1y   REAL,
            annual_div  REAL,
            ex_div_date TEXT,
            frequency   TEXT,
            payout_ratio REAL,
            div_growth  REAL,
            FOREIGN KEY (provider_id) REFERENCES etf_providers(id) ON DELETE CASCADE,
            UNIQUE (provider_id, symbol)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_nav (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id  INTEGER NOT NULL DEFAULT 1,
            nav_date    DATE NOT NULL,
            total_value REAL NOT NULL,
            source      TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (profile_id, nav_date)
        )
    """)

    # source: 'snapshot' = authoritative recorded value, 'backfill' = replayed from
    # transactions. Lets the chart repair regenerate only backfilled rows. Legacy rows
    # stay NULL (source unknown) and are treated as protected unless explicitly repaired.
    _nav_cols = {r[1] for r in cur.execute("PRAGMA table_info(portfolio_nav)").fetchall()}
    if "source" not in _nav_cols:
        cur.execute("ALTER TABLE portfolio_nav ADD COLUMN source TEXT")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS etf_type_overrides (
            ticker    TEXT PRIMARY KEY,
            fund_kind TEXT NOT NULL CHECK(fund_kind IN ('option_income','etf','cef')),
            note      TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    _seed_etf_provider_data(conn)

    conn.commit()
    if close:
        conn.close()
