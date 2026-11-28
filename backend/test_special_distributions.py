"""One-off special distributions are left out of forward income estimates."""

from datetime import date, timedelta

import pandas as pd
import pytest

import app as app_module
from model_distributions import model_income_estimate
from special_distributions import declared_is_special, regular_amounts, special_flags


def monthly_series(amounts):
    """Monthly payments, the latest two days ago, all inside the trailing year."""
    last = pd.Timestamp.now().normalize() - pd.Timedelta(days=2)
    months = len(amounts)
    dates = [last - pd.DateOffset(months=months - 1 - i) for i in range(months)]
    return pd.Series(amounts, index=pd.DatetimeIndex(dates))


# A monthly fund's last year: $0.14 a month, a $0.266 December, a $0.246
# September and a one-off $2.01 in November.
MONTHLY = [0.14, 0.266, 0.14, 0.14, 0.14, 0.14, 0.14, 0.14, 0.14, 0.14, 0.246, 2.01]


def test_only_the_one_off_payment_is_a_special():
    flags = special_flags(MONTHLY)
    assert flags == [False] * 11 + [True]
    assert regular_amounts(MONTHLY) == MONTHLY[:-1]
    # $0.25 a month, then a one-off $2.554.
    assert special_flags([0.25] * 8 + [2.554])[-1] is True
    # Option-income swings (~2.5x the median) are not specials.
    assert not any(special_flags([0.22, 0.3, 0.18, 0.55, 0.25, 0.2, 0.24]))


def test_a_run_of_high_payments_is_a_level_change_not_a_special():
    # A fund that went from $0.10 weekly to $0.45 monthly: the new payments repeat.
    assert not any(special_flags([0.1] * 10 + [0.45, 0.45]))
    # Too little history to say what is usual.
    assert not any(special_flags([0.1, 0.1, 0.1, 0.9]))


def test_a_declared_amount_is_judged_against_the_regular_payments():
    history = MONTHLY[:-1]
    assert declared_is_special(2.01, history) is True       # declared, not yet in history
    assert declared_is_special(0.15, history) is False
    assert declared_is_special(2.01, MONTHLY) is True          # already the latest payment
    assert declared_is_special(0.0, MONTHLY) is False


def test_monthly_estimate_leaves_the_special_out_but_reports_the_true_trailing_total():
    divs = monthly_series(MONTHLY)
    annual, ttm, _source = app_module._div_calc_annual_dividend(divs, "M", 2.01)
    # Before: (0.14 + 0.246 + 2.01) / 3 x 12 = $9.58/share.
    regular_recent = (0.14 + 0.14 + 0.246) / 3 * 12
    regular_year = sum(MONTHLY[:-1])
    assert annual in (pytest.approx(regular_recent), pytest.approx(regular_year))
    assert annual < 2.2
    assert ttm == pytest.approx(sum(MONTHLY))


def test_a_level_payer_without_specials_is_unchanged():
    divs = monthly_series([0.14] * 12)
    annual, ttm, source = app_module._div_calc_annual_dividend(divs, "M", 0.14)
    assert (annual, ttm, source) == (pytest.approx(1.68), pytest.approx(1.68), "trailing_12_month")


def test_quarterly_estimate_sums_the_latest_four_regular_payments():
    # A quarterly fund: $0.46 a quarter and a $1.96 year-end special.
    end = pd.Timestamp.now().normalize()
    dates = [end - pd.DateOffset(months=3 * (6 - i)) for i in range(6)]
    divs = pd.Series([0.46, 0.46, 0.46, 1.96, 0.46, 0.46], index=pd.DatetimeIndex(dates))
    annual, _ttm, source = app_module._div_calc_annual_dividend(divs, "Q")
    assert source == "trailing_12_month"
    assert annual == pytest.approx(0.46 * 4)


def snapshot(amounts, **dates):
    return {"div": amounts[-1], "history": monthly_series(amounts), **dates}


def test_a_paid_special_reverts_div_to_the_last_regular_payment():
    today = date.today()
    future = (today + timedelta(days=3)).isoformat()
    past = (today - timedelta(days=2)).isoformat()
    unpaid = snapshot(MONTHLY, ex_div_date=(today - timedelta(days=2)).isoformat(), div_pay_date=future)
    paid = snapshot(MONTHLY, ex_div_date=(today - timedelta(days=9)).isoformat(), div_pay_date=past)
    # Declared but not yet paid: still the next payment.
    assert app_module._distribution_amount_after_special(unpaid, 2.01, today) == 2.01
    # Paid: the next payment is a regular one.
    assert app_module._distribution_amount_after_special(paid, 2.01, today) == pytest.approx(0.246)
    # No pay date: a week after the ex-date counts as paid.
    recent_ex = snapshot(MONTHLY, ex_div_date=(today - timedelta(days=3)).isoformat())
    old_ex = snapshot(MONTHLY, ex_div_date=(today - timedelta(days=8)).isoformat())
    assert app_module._distribution_amount_after_special(recent_ex, 2.01, today) == 2.01
    assert app_module._distribution_amount_after_special(old_ex, 2.01, today) == pytest.approx(0.246)
    # A regular declaration is never touched.
    level = snapshot([0.14] * 12, div_pay_date=past)
    assert app_module._distribution_amount_after_special(level, 0.14, today) == 0.14
    # The rate used when annualizing directly skips the special either way.
    assert app_module._distribution_rate_amount(unpaid, 2.01) == pytest.approx(0.246)


def test_snapshot_annual_rate_ignores_a_declared_special():
    snap = {"has_dividend": True, "div": 2.01, "freq": "M", "history": monthly_series(MONTHLY)}
    assert app_module._annual_dividend_per_share_from_snapshot(snap, "M") < 2.2


def test_builder_model_estimate_uses_the_latest_regular_payout():
    today = date(2026, 11, 27)
    days = [date(2025, 12, 25) + timedelta(days=30 * i) for i in range(12)]
    position = {"ticker": "AAA", "shares": 100.0, "distributions": list(zip(days, MONTHLY))}
    latest, code, annual = model_income_estimate(position, today)
    # Before: $2.01 x 12 x 100 = $2,412.
    assert (latest, code) == (pytest.approx(0.246), "M")
    assert annual == pytest.approx(0.246 * 12 * 100)
