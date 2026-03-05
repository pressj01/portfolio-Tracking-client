from config import get_connection


def populate_holdings(profile_id=1):
    """Upsert from all_account_info into holdings (for the given profile)."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT OR REPLACE INTO holdings (
            ticker, description, classification_type, quantity,
            price_paid, current_price, purchase_value, current_value,
            gain_or_loss, gain_or_loss_percentage, percent_change,
            purchase_date
        )
        SELECT ticker, description, classification_type, quantity,
               price_paid, current_price, purchase_value, current_value,
               gain_or_loss, gain_or_loss_percentage, percent_change,
               purchase_date
        FROM all_account_info
        WHERE profile_id = ?
    """, (profile_id,))
    row_count = cur.rowcount
    conn.commit()
    conn.close()
    return row_count, f"Holdings populated: {row_count} rows affected."


def populate_dividends(profile_id=1):
    """Upsert from all_account_info into dividends."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT OR REPLACE INTO dividends (
            ticker, div_frequency, reinvest, ex_div_date, div_per_share,
            dividend_paid, estim_payment_per_year, approx_monthly_income,
            annual_yield_on_cost, current_annual_yield,
            ytd_divs, total_divs_received, paid_for_itself
        )
        SELECT ticker, div_frequency, reinvest, ex_div_date, div,
               dividend_paid, estim_payment_per_year, approx_monthly_income,
               annual_yield_on_cost, current_annual_yield,
               ytd_divs, total_divs_received, paid_for_itself
        FROM all_account_info
        WHERE profile_id = ?
    """, (profile_id,))
    row_count = cur.rowcount
    conn.commit()
    conn.close()
    return row_count, f"Dividends populated: {row_count} rows affected."


def populate_income_tracking(profile_id=1):
    """Append snapshot to income_tracking (skip duplicates by ticker+import_date+profile_id)."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO income_tracking (
            ticker, import_date, dividend_paid,
            approx_monthly_income, estim_payment_per_year,
            dollars_per_hour, ytd_divs, total_divs_received, profile_id
        )
        SELECT
            a.ticker, a.import_date, a.dividend_paid,
            a.approx_monthly_income, a.estim_payment_per_year,
            a.dollars_per_hour, a.ytd_divs, a.total_divs_received, a.profile_id
        FROM all_account_info a
        WHERE a.profile_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM income_tracking i
            WHERE i.ticker = a.ticker
              AND i.import_date = a.import_date
              AND i.profile_id = a.profile_id
          )
    """, (profile_id,))
    row_count = cur.rowcount
    conn.commit()
    conn.close()
    return row_count, f"Income tracking: {row_count} rows inserted."


def populate_pillar_weights(profile_id=1):
    """Upsert from all_account_info into pillar_weights (only if pillar columns are populated)."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT OR REPLACE INTO pillar_weights (
            ticker, hedged_anchor, anchor, gold_silver,
            booster, juicer, bdc, growth
        )
        SELECT ticker, hedged_anchor, anchor, gold_silver,
               booster, juicer, bdc, growth
        FROM all_account_info
        WHERE profile_id = ?
          AND (hedged_anchor IS NOT NULL OR anchor IS NOT NULL
               OR gold_silver IS NOT NULL OR booster IS NOT NULL
               OR juicer IS NOT NULL OR bdc IS NOT NULL OR growth IS NOT NULL)
    """, (profile_id,))
    row_count = cur.rowcount
    conn.commit()
    conn.close()
    return row_count, f"Pillar weights populated: {row_count} rows affected."
