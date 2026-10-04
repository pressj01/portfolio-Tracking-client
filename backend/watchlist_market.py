"""Market columns for a watchlist, without technical indicators.

The page reads cached rows immediately. A quote pass fills price, daily change,
yield, assets, the next ex-dividend date, and a 1-year change. A later pass
fills 5-year dividend growth and the NAV reading. Neither pass computes RSI,
MACD, moving averages, Sharpe, or Sortino.
"""

import datetime
from concurrent.futures import ThreadPoolExecutor

from watchlist_lists import HISTORY_FIELDS, QUOTE_FIELDS, known_fund, normalize_ticker


def as_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def daily_change_pct(price, previous):
    price = as_float(price)
    previous = as_float(previous)
    if price is None or previous is None or previous == 0:
        return None
    return round((price - previous) / previous * 100, 2)


def iso_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime.datetime):
        return value.date().isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        stamp = float(value)
        if stamp > 10_000_000_000:
            stamp = stamp / 1000.0
        try:
            return datetime.datetime.utcfromtimestamp(stamp).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    for fmt, size in (("%Y-%m-%d", 10), ("%m/%d/%Y", 10), ("%m/%d/%y", 8)):
        try:
            return datetime.datetime.strptime(text[:size], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def future_iso(value, today=None):
    parsed = iso_date(value)
    if not parsed:
        return None
    today = today or datetime.date.today()
    try:
        day = datetime.date.fromisoformat(parsed)
    except ValueError:
        return None
    if day >= today:
        return parsed
    return None


def five_year_dividend_growth(divs, today=None):
    """Annualized growth from the last full year versus five years earlier."""
    import pandas as pd

    if divs is None:
        return None
    try:
        if len(divs) < 2:
            return None
        series = divs[divs > 0]
        series.index = pd.to_datetime(series.index)
    except Exception:
        return None
    current_year = (today or datetime.date.today()).year
    series = series[series.index.year < current_year]
    if len(series) < 2:
        return None
    try:
        yearly = series.resample("YE").sum()
        yearly = yearly[yearly > 0]
    except Exception:
        return None
    if len(yearly) < 6:
        return None
    recent = float(yearly.iloc[-1])
    past = float(yearly.iloc[-6])
    if past <= 0 or recent <= 0:
        return None
    return round(((recent / past) ** (1 / 5) - 1) * 100, 2)


def _blank_quote():
    return {key: None for key in QUOTE_FIELDS}


def _apply_tappalpha(app_module, symbol, row):
    try:
        profile = app_module._fetch_tappalpha_etf_profile(symbol) or {}
    except Exception:
        profile = {}
    if profile.get("name"):
        row["name"] = str(profile["name"]).strip()
    price = as_float(profile.get("price"))
    if price is not None:
        row["price"] = round(price, 2)
    assets = as_float(profile.get("total_assets"))
    if assets:
        row["aum"] = assets
    yield_pct = as_float(profile.get("distribution_rate_pct"))
    if yield_pct is None:
        yield_pct = as_float(profile.get("estimated_yield_pct"))
    if yield_pct is not None:
        row["div_yield"] = round(yield_pct, 2)
        row["div_yield_source"] = "TappAlpha"
    try:
        snapshot = app_module._fetch_tappalpha_distribution_snapshot(symbol) or {}
    except Exception:
        snapshot = {}
    upcoming = future_iso(snapshot.get("ex_div_date"))
    if upcoming:
        row["next_ex_date"] = upcoming
    if row["div_yield"] is None:
        rate = as_float(snapshot.get("distribution_rate_pct"))
        if rate is not None:
            row["div_yield"] = round(rate, 2)
            row["div_yield_source"] = "TappAlpha"


def quote_yield_pct(trailing, stated):
    """Percent yield from Yahoo's quote fields.

    ``trailingAnnualDividendYield`` is a decimal (0.14 means 14%).
    ``dividendYield`` is already a percent in this app. Option-income funds
    sometimes report a near-zero trailing figure that ignores distributions;
    the larger of the two scaled values is the one shown.
    """
    choices = []
    trailing_value = as_float(trailing)
    stated_value = as_float(stated)
    if trailing_value is not None and trailing_value > 0:
        choices.append(trailing_value * 100 if trailing_value < 2 else trailing_value)
    if stated_value is not None and stated_value > 0:
        choices.append(stated_value)
    if not choices:
        return None
    return round(max(choices), 2)


def distribution_yield_pct(app_module, symbol, price):
    """Percent yield from the fund's own payment history, or None.

    Yahoo's quote yield is unreliable for option-income funds -- it reports
    0.09% for QQQI, which pays about 13%. What the fund actually distributed,
    annualized at its current cadence, does not depend on that field.
    """
    if price is None or price <= 0:
        return None
    try:
        dividends = app_module._cached_yf_dividends(app_module._yf_ticker(symbol), symbol)
        value, _source = app_module._expected_annual_distribution_yield_pct(
            symbol, price, dividends
        )
    except Exception:
        return None
    return value if value is not None and value > 0 else None


def quote_for_ticker(ticker):
    """One symbol's fast columns. Failures leave the missing cells empty."""
    import app as app_module

    symbol = normalize_ticker(ticker)
    row = _blank_quote()
    if not symbol:
        return row
    known = known_fund(symbol)
    if known:
        row["name"] = known["name"]
    try:
        if app_module._is_tappalpha_fund(symbol, row["name"] or ""):
            _apply_tappalpha(app_module, symbol, row)
    except Exception:
        pass
    info = {}
    try:
        info = app_module._cached_yf_info(app_module._yf_ticker(symbol), symbol) or {}
    except Exception:
        info = {}
    if not row["name"]:
        try:
            row["name"] = app_module.clean_security_description(
                info.get("longName") or info.get("shortName") or ""
            ).strip() or None
        except Exception:
            row["name"] = None
    market_price = as_float(info.get("regularMarketPrice") or info.get("currentPrice"))
    previous = as_float(info.get("regularMarketPreviousClose") or info.get("previousClose"))
    if row["price"] is None and market_price is not None:
        row["price"] = round(market_price, 2)
    change_price = market_price if market_price is not None else row["price"]
    change = daily_change_pct(change_price, previous)
    if change is not None:
        row["change_1d"] = change
    if row["aum"] is None:
        assets = as_float(info.get("totalAssets") or info.get("totalNetAssets"))
        if assets:
            row["aum"] = assets
    if row["div_yield"] is None:
        paid = distribution_yield_pct(app_module, symbol, change_price)
        if paid is not None:
            row["div_yield"] = paid
            row["div_yield_source"] = "Dividend history"
    if row["div_yield"] is None:
        trailing = as_float(info.get("trailingAnnualDividendYield"))
        stated = as_float(info.get("dividendYield"))
        yield_pct = quote_yield_pct(trailing, stated)
        if yield_pct is not None:
            row["div_yield"] = yield_pct
            row["div_yield_source"] = "Yahoo Finance"
    if not row["next_ex_date"]:
        row["next_ex_date"] = future_iso(info.get("exDividendDate"))
    # The 1-year column comes from daily closes in the history pass. A quote
    # must not write a blank, or a 52-week estimate, over that return.
    return {key: row[key] for key in QUOTE_FIELDS if key != "one_yr_ret" and row.get(key) is not None}


def refresh_quotes(tickers, on_rows=None):
    import app as app_module

    symbols = []
    seen = set()
    for ticker in tickers or []:
        symbol = normalize_ticker(ticker)
        if symbol and symbol not in seen:
            seen.add(symbol)
            symbols.append(symbol)
    if not symbols:
        return {}
    try:
        neos = app_module._neos_fund_facts_batch(symbols) or {}
    except Exception:
        neos = {}

    def one(symbol):
        try:
            row = quote_for_ticker(symbol)
        except Exception:
            row = _blank_quote()
        facts = neos.get(symbol) or {}
        assets = as_float(facts.get("assets"))
        if assets:
            row["aum"] = assets
        return symbol, row

    results = {}
    workers = min(6, len(symbols))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for symbol, row in pool.map(one, symbols):
            results[symbol] = row
            if on_rows:
                on_rows({symbol: row})
    return results


def _growth_for(app_module, symbol):
    if app_module._is_tappalpha_fund(symbol):
        try:
            snapshot = app_module._fetch_tappalpha_distribution_snapshot(symbol) or {}
            growth = five_year_dividend_growth(snapshot.get("history"))
            if growth is not None:
                return growth
        except Exception:
            pass
    try:
        dividends = app_module._cached_yf_dividends(app_module._yf_ticker(symbol), symbol)
        return five_year_dividend_growth(dividends)
    except Exception:
        return None


def _close_frames(raw, tickers):
    import pandas as pd

    if raw is None or getattr(raw, "empty", True):
        return None, None, None
    if isinstance(raw.columns, pd.MultiIndex):
        top = set(raw.columns.get_level_values(0))
        close = raw["Adj Close"] if "Adj Close" in top else raw["Close"]
        unadjusted = raw["Close"]
        dividends = raw["Dividends"] if "Dividends" in top else None
        if not isinstance(close, pd.DataFrame):
            symbol = tickers[0]
            close = close.to_frame(name=symbol)
            unadjusted = unadjusted.to_frame(name=symbol)
            if dividends is not None:
                dividends = dividends.to_frame(name=symbol)
        return close, unadjusted, dividends
    symbol = tickers[0]
    close_name = "Adj Close" if "Adj Close" in raw.columns else "Close"
    close = raw[[close_name]].copy()
    close.columns = [symbol]
    unadjusted = raw[["Close"]].copy()
    unadjusted.columns = [symbol]
    dividends = None
    if "Dividends" in raw.columns:
        dividends = raw[["Dividends"]].copy()
        dividends.columns = [symbol]
    return close, unadjusted, dividends


def _history_payload(row):
    """History fields that were actually computed.

    A missing one-year return or yield stays out of the payload so a quote
    estimate already on screen is not replaced with a blank.
    """
    optional = {"one_yr_ret", "div_yield", "div_yield_source"}
    return {
        key: row.get(key)
        for key in HISTORY_FIELDS
        if key in row or key not in optional
    }


def _ttm_yield_pct(frame, symbol, price):
    series = _positive_dividends(frame, symbol)
    price_value = as_float(price)
    if price_value is None or price_value <= 0 or len(series) == 0:
        return None
    total = as_float(series.sum())
    if total is None or total <= 0:
        return None
    return round(total / price_value * 100, 2)


def _positive_dividends(frame, symbol):
    import pandas as pd

    if frame is None or symbol not in getattr(frame, "columns", []):
        return pd.Series(dtype=float)
    try:
        series = frame[symbol].dropna()
        return series[series > 0]
    except Exception:
        return pd.Series(dtype=float)


def _fill_history_row(app_module, symbol, growth, frames, resolved, overrides, formula):
    row = {"div_growth_5y": growth}
    close_df, unadjusted_df, dividend_df = frames
    close = None
    if close_df is not None and symbol in close_df.columns:
        try:
            close = close_df[symbol].dropna()
        except Exception:
            close = None
    if close is not None and len(close) >= 2:
        first = as_float(close.iloc[0])
        last = as_float(close.iloc[-1])
        if first and last is not None and first > 0:
            row["one_yr_ret"] = round((last - first) / first * 100, 2)
    price_for_yield = as_float(close.iloc[-1]) if close is not None and len(close) else None
    distribution_yield = _ttm_yield_pct(dividend_df, symbol, price_for_yield)
    issuer_yield = False
    try:
        issuer_yield = bool(app_module._is_tappalpha_fund(symbol))
    except Exception:
        issuer_yield = False
    if distribution_yield is not None and not issuer_yield:
        row["div_yield"] = distribution_yield
        row["div_yield_source"] = "Dividend history"

    bench_used = resolved.get(symbol)
    row["benchmark"] = bench_used
    row["benchmark_valid"] = True
    row["nav_tested"] = False
    row["cov_sig"] = None
    row["nav_erosion_prob"] = None
    if not bench_used or close is None or len(close) < 2:
        return _history_payload(row)

    import pandas as pd

    nav_close = close
    if unadjusted_df is not None and symbol in unadjusted_df.columns:
        try:
            candidate = unadjusted_df[symbol].dropna()
            if len(candidate) >= 2:
                nav_close = candidate
        except Exception:
            pass
    dividends = _positive_dividends(dividend_df, symbol)
    override = overrides.get(symbol)
    if override is not None and len(nav_close) >= 1:
        override_yield = as_float(override)
        nav_price = as_float(nav_close.iloc[-1])
        if override_yield and nav_price and override_yield > 0 and nav_price > 0:
            dividends = pd.Series([nav_price * (override_yield / 100.0)], dtype=float)
    try:
        bench_close = app_module._nav_benchmark_close_from_df(close_df, bench_used, close)
    except Exception:
        bench_close = close
    bench_valid = True
    if bench_used and bench_close is close:
        try:
            parts = app_module._nav_benchmark_parts(bench_used)
            bench_valid = any(
                part in close_df.columns and len(close_df[part].dropna()) >= 2
                for part in parts
            )
        except Exception:
            bench_valid = False
    row["benchmark_valid"] = bench_valid
    if not bench_valid:
        return _history_payload(row)
    try:
        _ratio, signal, erosion = app_module._bss_coverage(
            nav_close,
            dividends,
            bench_close,
            low_ratio=formula.get("nav_buy_max_ratio", 0.25),
            high_ratio=formula.get("nav_sell_above_ratio", 0.75),
            hard_decline_pct=formula.get("nav_hard_decline_pct", 50.0),
            hard_deficit_pct=formula.get("nav_hard_deficit_pct", 5.0),
        )
        row["cov_sig"] = signal
        row["nav_erosion_prob"] = erosion
        row["nav_tested"] = True
    except Exception:
        pass
    return _history_payload(row)


def refresh_history(tickers, settings, on_rows=None):
    import app as app_module

    symbols = []
    seen = set()
    for ticker in tickers or []:
        symbol = normalize_ticker(ticker)
        if symbol and symbol not in seen:
            seen.add(symbol)
            symbols.append(symbol)
    if not symbols:
        return {}
    settings = settings or {}
    formula = settings.get("formula") or {}
    scopes = settings.get("scopes") or {}
    benches = settings.get("benches") or {}
    overrides = settings.get("overrides") or {}

    def growth_one(symbol):
        try:
            return symbol, _growth_for(app_module, symbol)
        except Exception:
            return symbol, None

    growth = {}
    workers = min(6, len(symbols))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for symbol, value in pool.map(growth_one, symbols):
            growth[symbol] = value

    resolved = {}
    for symbol in symbols:
        scope = scopes.get(symbol) or "auto"
        try:
            should = app_module._should_test_nav_erosion(symbol, scope=scope)
        except Exception:
            should = False
        if not should:
            continue
        bench = str(benches.get(symbol) or "").strip().upper()
        if bench:
            resolved[symbol] = bench
            continue
        try:
            resolved[symbol] = app_module._nav_benchmark_for_ticker(symbol)
        except Exception:
            resolved[symbol] = None

    frames = (None, None, None)
    benchmark_parts = []
    for bench in resolved.values():
        if not bench:
            continue
        try:
            benchmark_parts.extend(app_module._nav_benchmark_parts(bench))
        except Exception:
            continue
    download = sorted(set(symbols) | {part for part in benchmark_parts if part})
    if download:
        try:
            raw = app_module._chunked_yf_download(
                " ".join(download),
                chunk_size=45,
                period="1y",
                interval="1d",
                auto_adjust=False,
                actions=True,
                progress=False,
                ignore_tz=True,
                threads=True,
            )
            frames = _close_frames(raw, download)
        except Exception:
            frames = (None, None, None)

    results = {}
    for symbol in symbols:
        try:
            row = _fill_history_row(
                app_module, symbol, growth.get(symbol), frames, resolved, overrides, formula,
            )
        except Exception:
            row = {"div_growth_5y": growth.get(symbol)}
        results[symbol] = row
        if on_rows:
            on_rows({symbol: row})
    return results
