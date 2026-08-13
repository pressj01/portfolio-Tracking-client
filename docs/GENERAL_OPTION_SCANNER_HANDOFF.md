# General Option Scanner — continuation handoff

Last updated: 2026-08-12

## Read this first

This file records the decisions and implementation state from the long Option Samurai-style scanner design session. The current working tree is intentionally dirty: the modified and untracked scanner files are the active feature work from that session, not disposable changes. Preserve them. Before a future editing session, follow `AGENTS.md`, inspect ownership/status, fetch `origin/master`, and stop if synchronization would conflict with these changes.

The working branch at this checkpoint was `feature/manual-dividend-date-overrides`. No commit or push was created.

## Product decisions that should remain stable

- Build one **General Option Scanner** with a strategy dropdown and shared top-level filters.
- The screen opens with `Choose a scan…`; it must not silently default to Iron Condor. A link that names a strategy may open directly to that strategy.
- Changing strategy replaces the strategy-specific construction rules and defaults. There must not be a second, contradictory set of old inputs.
- A newly selected strategy starts with broad discovery filters. Its supplied/established conservative recipe remains available through the one-click `High-probability setup` preset, and `Open filters` returns to the broad starting point. Clicking either preset replaces every scanner value at once. DTE, moneyness, pricing method, and other construction inputs remain strategy-specific in both modes. Do not describe the preset as a guarantee or universally optimal: suitability changes with market conditions, risk tolerance, and the intended holding period.
- Keep the original scanner screens for now. The original Iron Condor scanner is the one legacy screen that also needed repair. Retire old screens only after the new scanner is proven better.
- All green summary values are editable. Clicking one opens a focused editor with explanatory help, Done, Close, and Escape behavior.
- Shared filters apply to stocks and ETFs: exact symbols, stock universe, index ETFs, sector ETFs, fundamental/growth/technical scores, market trend, underlying trend, recent move, RSI, option volume, IV Rank, DTE, and pricing assumption.
- Exact symbols can mix ETFs and stocks, for example `SPY, QQQ, IWM, AAPL, MSFT`. When exact symbols are present, universe switches are intentionally ignored.
- Strategy-specific filters change by trade type and include the relevant moneyness, delta, probability, expected-value, risk, reward, shape, width, and multi-expiration fields.
- Technical filtering is user-controlled. A useful put-selling setup is an underlying in an established uptrend that is currently pulling back, but this is not forced.
- Yahoo is the free options source. IV Rank is built by collecting daily Yahoo ATM-IV observations locally. It is explicitly not Option Samurai’s proprietary value and needs time to warm up.
- Results show one best structure per ticker first. Clicking a ticker drills into all candidate structures for that ticker.
- Keep probability/risk columns and a quick interactive P/L preview on the scanner.
- The Trade action opens the full Strategy Lab with the exact scanned legs. That detailed view remains the authoritative analyzer: analysis date/time movement, volatility surface and skew, range, day-step curves, breakevens, current/reference prices, zoom/pan/fit, price history, option-chain additions, Greeks, and probability controls.
- Returning from Strategy Lab must restore the chosen strategy, edited filters, result rows, ticker drilldown, and selected trade rather than resetting the scanner.
- The quick P/L chart shows the current price and percentage price markers. The visible price range and marker spacing are independent controls, so users can choose 10%, 15%, or any integer from 1% through 25% for marker spacing.
- Strategy Lab already has separately editable `In the money` and `Out of the money` percentage controls in its probability panel; retain those and the draggable chart boundaries.
- Remove the BETA badge from the Controls button.

## Implemented at this checkpoint

### Strategy coverage

The catalog now exposes 32 strategies in four families. The original 13 retain their legacy routes. A shared Yahoo-backed engine was added for the 19 missing strategies:

- Naked Call, Long Call, Long Put, Married Put, Married Call
- Bull Call Spread
- Long/Short Straddle, Long/Short Strangle
- Call Butterfly, Put Butterfly
- Long Call/Put Calendar, Long Call/Put Diagonal
- Collar, Call Ratio Spread, Put Ratio Spread

Existing specialized scanners continue to provide Covered Call, Cash-Secured Put, the original credit/debit verticals, Iron Condor, Iron Butterfly, the unbalanced condor/butterfly variants, and the other custom structures.

### Scanner workflow and UI

- Visible grouped strategy dropdown with no unqualified default.
- Strategy-specific defaults and field schemas.
- Editable compact filter summary with hidden help and corrected wrapping/overlap.
- Shared stock/ETF quality, technical, liquidity, volatility, expiration, and entry-price filters.
- Best-per-ticker results plus ticker drilldown.
- Probability, expected value, maximum profit/loss, profit ratio, technical setup, scores, IV Rank, and volume columns.
- Quick leg table and P/L analysis.
- Corrected analysis-date slider direction.
- Adjustable quick-chart price range and percentage-marker interval; current-price line and labeled percent/price ticks.
- Exact-leg handoff to Strategy Lab for every new generic strategy.
- Scanner session persistence in `sessionStorage` and a query-preserving return link. This was live-tested with a SPY Naked Call: after opening Strategy Lab and clicking Back, the strategy, SPY exact-symbol filter, two candidate structures, selected row, stats, and quick chart were restored.
- Completed scans with zero exact matches now report how many candidate structures were evaluated and the most common filters that rejected them, instead of reverting to the misleading “Run the scan” empty state.
- Added full-setting risk presets: Open Filters, Risk Averse, Moderate, and Aggressive. Short-premium trades use the requested absolute-delta bands of 5–15, 15–20, and 30–50 respectively. Directional long-debit trades invert the relationship to safer 60–75, moderate 45–60, and aggressive 25–45 long-delta bands. Presets also set strategy-aware stock quality, technical regime, liquidity, probability, and risk controls, and every resulting value remains editable.
- Added the visible/editable Reference Option Delta control. The general adapter passes the target into supported legacy and shared strategy constructors and rejects completed structures whose applicable short or long leg falls outside the selected band.

### Backend and data

- General scan API adapter shared across legacy and generic strategies.
- Yahoo option-chain construction and pricing for the new strategies.
- Transparent stock fundamental/growth/technical scores. ETFs intentionally show N/A for company fundamentals/growth but receive technical scores.
- Locally accumulated Yahoo IV history and IV Rank.
- General technical-market-condition filters.
- Reworked Iron Condor generation to find practical structures rather than requiring only a narrow unusual shape.

## Important files

- `src/pages/GeneralOptionScanner.jsx` — page state, shared filters, results, session restoration
- `src/components/CompactScannerFilterPanel.jsx` — editable green summaries/help editors
- `src/components/GeneralScannerAnalysis.jsx` — quick probability strip, legs, chart, range/marker/date/IV controls
- `src/utils/generalOptionScannerConfig.js` — per-strategy defaults and fields
- `src/utils/optionScannerCatalog.js` — 32-strategy catalog and legacy routes
- `src/utils/optionTradeHandoff.js` — exact-leg conversion into Strategy Lab
- `src/components/RiskGraphButton.jsx` — stages the trade and preserves the scanner return URL
- `src/pages/OptionTradingTools.jsx` — existing full Strategy Lab; keep its rich analyzer
- `backend/general_option_scanner.py` — adapter, enrichment, filtering, result normalization
- `backend/samurai_strategy_scanner.py` — shared Yahoo engine for the 19 added strategies
- `backend/stock_scores.py` — transparent score model
- `backend/option_iv_history.py` — local Yahoo IV observations/rank
- `backend/iron_condor_scanner.py` — repaired legacy/general Iron Condor construction

## Verification completed

- Production build: `npm run build` passed.
- Focused JavaScript tests: 22 passed.
- Focused Python scanner tests: 76 passed.
- Browser verification covered:
  - blank initial strategy selector;
  - 32 dropdown choices;
  - strategy default replacement;
  - fixed filter-row wrapping;
  - a live SPY Naked Call scan;
  - probability strip, legs, quick P/L chart, current price, and percentage markers;
  - exact-leg Strategy Lab handoff;
  - full Strategy Lab analyzer rendering;
  - restoration of scanner filters/results after Back.
- `git diff --check` reported no whitespace errors (only Windows LF/CRLF notices).

The full Python suite ran 1,369 tests and had two failures outside this scanner work:

1. `test_total_return.TotalReturnDashboardPeriodTest.test_dashboard_cards_and_rows_share_transaction_aware_period` — its fake database result lacks `fetchone()`.
2. `test_watchlist_yield.WatchlistExpectedYieldTest.test_established_monthly_fund_uses_full_trailing_year` — expected 12.0 but received 11.0.

Do not misattribute those failures to the scanner without new evidence.

## Known refinement work for the next session

1. Validate the probability definitions for every strategy. “Probability of max profit/loss” is not equally meaningful for unlimited or continuous-payoff positions; consider also showing probability of any profit consistently.
2. Check the General Scanner’s quick display for unlimited risk after a fresh backend restart. Strategy Lab correctly showed `Unlimited` for a Naked Call, while one pre-restart quick-result snapshot still displayed a dash and `0.0%` max-loss probability. The backend now emits `max_loss_unbounded`; confirm the running process and normalization path use it.
3. Improve generic candidate enumeration. The shared engine currently constructs a centered representative structure for each selected expiration; it does not yet search every sensible strike combination the way a mature commercial scanner would.
4. Revisit the temporary 40-symbol cap in the generic engine. Add batching/progress/caching before increasing it to avoid Yahoo rate and latency problems.
5. Improve calendar/diagonal quick-chart modeling. The full Strategy Lab handles multi-expiration analysis more faithfully; the lightweight scanner preview currently uses a shared analysis DTE approximation.
6. Add stronger cross-strategy financial-validation fixtures: known leg signs, entry cash flow, bounded/unbounded tails, max P/L, breakevens, and probability sanity.
7. Add component tests for strategy switching, editor close/Done/Escape, session restoration, marker control, and ticker drilldown.
8. Continue responsive/layout QA at narrower widths and high browser zoom.
9. Consider server-side or IndexedDB scan-result caching if sessionStorage size becomes a problem on broader scans.
10. Only after the General Scanner is consistently better should the old scanner screens be removed.

## Suggested next-session order

1. Read this handoff and inspect `git status`/diff without discarding anything.
2. Follow `AGENTS.md` synchronization rules; stop on conflicts.
3. Restart the full dev server and confirm unlimited-risk normalization with a SPY Naked Call.
4. Add financial-validation fixtures for one strategy from each family.
5. Expand candidate enumeration and then tune performance/caching.
6. Perform another end-to-end browser pass before changing or retiring legacy screens.
