# Portfolio Tracking Client v1.33.0

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

This release includes every change merged after v1.32.1: 39 commits spanning two new pages, portfolio-performance analysis, income planning, options research, imports, market-data reliability, layout improvements, and automated coverage.

## New Pages

### Put Selling Scanner

- Finds large-cap stocks, mid-cap stocks, index ETFs, and sector or commodity ETFs whose selloff is unusually large relative to their own pre-decline volatility.
- Ranks candidates with a transparent 100-point score across dislocation, premium, quality, and stabilization, with grades and a full score breakdown.
- Pulls option chains for leading candidates and suggests an expiration and put strike near the selected DTE and delta targets.
- Shows bid/ask, premium per contract, required cash, raw and annualized cash return, estimated probability of expiring out of the money, and effective basis if assigned.
- Supports Conservative, Balanced, and Aggressive presets plus custom universes based on built-in lists, holdings, watchlists, or pasted tickers.
- Treats earnings as an event risk: it first looks for an expiration before earnings and can exclude candidates when no safe expiration is available.
- Adds an in-page Stock and ETF Analysis price-chart popup with candles or line view, 50/200-day moving averages, volume, MACD, RSI, and periods from three months to five years.
- Adds dedicated in-app help, scoring documentation, workflow guidance, screenshots, and warnings. The scanner is analysis-only and does not execute trades.

### DRIP vs. Cash Analyzer

- Replays actual prices and distributions over one common date window to compare 100% reinvestment, 50% reinvestment, and taking all distributions as cash.
- Supports named saved sets, editable ticker chips, up to 75 unique symbols, cached results, and separate handling for funds with shorter histories.
- Reports price appreciation and CAGR, total return for all three reinvestment choices, initial and ending shares, ending values, covered yield, coverage, DRIP Score, reinvestment efficiency, win rate, and opportunity score.
- Adds Compounder, Harvester, Liquidator, Grower, Fading, and Broken verdicts plus DRIP, Take cash, Toss-up, Conflicted, and Unstable calls.
- Adds pinned table headers and ticker columns, result color grading, detailed hover definitions, uppercase ticker entry, expanded comparison columns, and complete illustrated help.

## Portfolio Performance and Dashboard

- Unified 1M, 3M, YTD, 1Y, 5Y, 10Y, ALL/MAX, and calendar-year periods across Dashboard, Total Return, Growth, and Portfolio Growth 2, with consistent effective dates and grading windows.
- Expanded Dashboard performance analysis with transaction-aware Start Value, End Value, Price Return, Distributions, Total Return, time-weighted Total Return %, and SPY comparisons.
- Synchronized the Dashboard period across metric cards, holding-return chart, comparison chart, scatter plot, and detailed holdings table.
- Improved portfolio and ticker comparison modes, including Total Return, Price Only, Price + Dividends, and Both, while preserving actual ownership dates and excluding deposits, purchases, and sales from performance.
- Restored Dashboard category filtering and synchronized saved holdings-column preferences across open windows.
- Added automatic migration for the Closure Risk column in older saved Dashboard column layouts.
- Froze the first five Dashboard holdings columns through Purchased so identifying details stay visible during horizontal scrolling.
- Recovered missing SPY/QQQ benchmark batches and falls back to the last good beta values instead of leaving Portfolio Beta blank.
- Fixed Dashboard holding synchronization, manual-edit refreshes, and Shear aggregate distribution data.
- Added explanations for Dashboard NAV warning colors and a Holdings DRIP-coverage summary.

## Income, DRIP, and Sustainability Planning

- Added per-ticker reinvestment percentages to Dividend Calculator, with global “apply to every ticker” and per-ticker “follow all-tickers %” controls.
- Corrected DRIP portfolio selection and ticker lookup in Portfolio Income Simulator.
- Fixed saved income-simulator scenarios, projection behavior, and NAV-erosion modeling.
- Counted Owner-direct holdings in Cash Flow & Sustainability without double-counting the same ticker from linked source accounts.
- Clarified cash-flow metrics and labels.
- Simplified the projected Price Impact chart to one annual-income line while keeping current-payout and selected-price markers.
- Improved DRIP-vs-cash comparisons and added precise hover explanations for every return and ending-value column.
- Updated Growth & Income Freedom planning and accumulation modeling, including new test coverage for long-horizon scenarios.

## Comparers, Research, and Fund Analysis

- Added a reusable ticker library to ETF Comparer and Stock Comparer with saved tickers and current portfolio holdings.
- Reworked Option-Income ETF Evaluator alternatives so they must beat the evaluated fund by at least two composite points and show a concrete advantage.
- Added matched-window CAGR comparisons, a side-by-side alternatives table with signed deltas, rank context, click-to-evaluate tickers, preloaded ETF Compare links, and a best-in-group empty state.
- Added split/rename artifact protection for NUSI/QQQH and removed dead NUSI from the option-income universe.
- Fixed the NUSI return-chart split discontinuity.
- Prioritized official XFUNDS issuer data for Security Research, including API-based fund profiles, distribution-rate fields, caching, ticker validation, and graceful continuation when Yahoo data is unavailable.
- Improved distribution cadence detection and increased logarithmic chart-hover precision across ETF, Stock, Security Research, and Distribution History views.
- Recovered individual tickers omitted from bulk price downloads.
- Unified portfolio performance periods and grades used by research and growth views.

## Options, Imports, Watchlists, and Scanners

- Added CBTX option-import parsing and automated coverage.
- Routed broker imports by each portfolio’s configured source so transactions and positions land in the correct account.
- Preserved frozen original cost basis during transaction rollups while allowing broker-adjusted basis to remain authoritative for broker-managed accounts.
- Fixed Watchlist expected dividend yields and froze Watchlist columns through Signal.
- Fixed the General Scanner default-universe TypeError, restored deterministic seeding, and added coverage for built-in and user-added single-stock ETFs.
- Cached the single-stock ETF list and lazily refreshed dependent option-income universes after Settings changes, eliminating hundreds of repeated database reads during scans.

## Calculation, Layout, and Reliability Fixes

- Corrected return and NAV-erosion calculations, including ownership windows, transfers, distributions, back-testing, and portfolio-level totals.
- Updated NAV Erosion and Portfolio NAV Erosion guidance and made the back-tester table fit its container without unnecessary horizontal scrolling.
- Fixed render crashes in Market Regime Analysis, Consolidation Simulator, Technical Scanner charts, and Portfolio Income Simulator error handling.
- Added an Unclassified panel to the Income Benchmark workflow so affected holdings can actually be reclassified.
- Added ESLint with `no-undef` as an error to catch the class of scope bug that caused those render failures.
- Improved import error handling and added broad backend and frontend regression coverage for the new calculations, pages, imports, scanners, caches, charts, and data-recovery paths.
- Added repository synchronization guidance to protect user and collaborator changes before future edits.

## Pages and Workspaces Updated

In addition to the two new pages, this release updates Dashboard, Total Return, Growth, Portfolio Growth 2, Growth & Income Freedom, Cash Flow & Sustainability, Dividend Calculator, Portfolio Income Simulator, Manage Holdings, Manage Portfolios, Watchlist, ETF Comparer, Stock Comparer, ETF Analysis, Security Research, Option-Income ETF Evaluator, Options Strategy Lab, NAV Erosion, Portfolio NAV Erosion, Consolidation Analysis, Macro Regime Dashboard, Technical Scanner, Import, Reinvestment Impact, and Help.

## Complete Included Change List

The following commits are included after v1.32.1:

- Restore dashboard category filtering.
- Support CBTX option imports.
- Clarify cash-flow metrics and prioritize XFUNDS data.
- Fix return and NAV-erosion calculations.
- Fix render crashes from out-of-scope hook values.
- Add ESLint with `no-undef` to catch scope bugs.
- Make the NAV Erosion back-tester table fit its container.
- Add saved and portfolio tickers to comparers.
- Add per-ticker DRIP percentages with global override toggles.
- Make Option-Income Evaluator alternatives genuinely better picks.
- Fix the NUSI return-chart split discontinuity on both integrated development lines.
- Explain Dashboard NAV warning colors.
- Add the Holdings DRIP-coverage summary.
- Use XFUNDS data for Security Research.
- Merge the complete portfolio-growth development history into the default branch.
- Improve Dashboard synchronization and Total Return analysis.
- Freeze the first five Dashboard holdings columns through Purchased.
- Recover benchmark data so the Portfolio Beta card does not blank.
- Fix DRIP portfolio selection and ticker lookup.
- Fix income-simulator scenarios and NAV erosion.
- Count Owner-direct holdings in Cash Flow income.
- Simplify the Price Impact chart to one income line.
- Add the DRIP vs. Cash Analyzer page and help.
- Enhance DRIP-vs-cash comparisons.
- Explain DRIP return columns on hover.
- Recover tickers omitted from price batches.
- Fix distribution cadence and logarithmic hover precision.
- Fix Dashboard holding synchronization and Shear aggregate data.
- Fix Watchlist expected dividend yields.
- Freeze Watchlist columns through Signal.
- Stop transaction rollups from overwriting the frozen original basis.
- Fix the TypeError that broke the General Scanner default universe.
- Cache the single-stock ETF list and resolve its dependents lazily.
- Add repository sync-before-editing guidance.
- Force DRIP ticker input to uppercase.
- Route broker imports by portfolio source.
- Unify portfolio performance periods and grades.
- Add the Put Selling Scanner and income-planning updates.

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.32.1...v1.33.0
