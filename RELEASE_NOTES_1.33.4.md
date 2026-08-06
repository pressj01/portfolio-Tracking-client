# Portfolio Tracking Client v1.33.4

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

This release carries forward everything shipped after v1.32.1 and adds the installed-build fixes below. The Windows installer is code signed.

## New in v1.33.4

### Diversification X-Ray on a New Installation

The X-Ray screen still reported "no holdings data" for every position on a newly installed copy, even though the same holdings resolved correctly when running from source. The look-through code was never the problem: the built-in fund data it depends on was only written during a refresh run, so a computer that had never completed one started with nothing to look through.

- Fixed X-Ray showing every fund as an unresolved gap on a new installation. The built-in issuer registry, the economic-exposure definitions for funds that hold Treasury bills instead of the asset they track (Gold, Silver, Bitcoin, Ethereum, Solana), and the wrapper-fund definitions are now installed when the backend starts, not only part-way through a refresh. Those holdings appear correctly the first time the screen is opened.
- X-Ray now resolves itself automatically the first time it is used on a computer that has never downloaded fund holdings, and shows its progress while it works. Every later refresh remains a deliberate choice.
- Fixed the installed application charting every account at once. The X-Ray screen could not read the selected portfolio once packaged and silently fell back to all accounts combined, so the totals belonged to a portfolio the account selector was not showing.
- A resolve that fails now says so. A failure before the first fund was fetched previously left the screen looking exactly like a refresh that had never been requested, and a run where no fund publisher could be reached said nothing at all — that now reports a likely internet or firewall block instead of appearing to be broken fund data.
- Fixed a screen with no fund holdings yet advising that the funds be defined by hand. It now distinguishes a cache that has not been filled from funds whose issuers genuinely publish nothing, and offers the right action for each.
- The release build now verifies on a brand-new database that the packaged installer arrives with its fund issuer registry, economic exposures, and wrapper definitions already present, before the installer is published.

## New in v1.33.3

### Installed Build Fixes

These problems only appeared in the installed application, never when running from source.

- Fixed the installed backend failing to start. It created its uploads folder next to the program files, which Windows keeps read-only for a standard user, so the backend exited before the app could reach it.
- Fixed the desktop launcher attaching to the wrong backend. It previously only checked that something answered on the local port, so an already-running copy could be adopted by mistake. Each launch now issues its own identity token and waits for that exact backend, and reports a startup failure instead of hanging if the backend exits.
- Fixed the Diversification X-Ray screen returning no fund holdings in the installed build. The look-through module could not reach the running application's data fetchers once packaged, so every fund resolved as undisclosed.
- Added the Diversification module to the packaged build inputs, which had been left out of the installer definition, the build script, and both CI build steps.
- The release build now smoke-tests the packaged X-Ray seed and fund routes and the packaged backend's startup and health check before the installer is published.

### Interface Fixes

- Fixed a DRIP Matrix window on Manage Holdings that could not be closed. With no accounts included in Owner, or when the backend was unreachable, the window shrank far enough to clip its own Close button. It now keeps a minimum width, closes with Escape or a click outside, and shows a real message with a Retry option instead of an empty grid.
- Reordered the Options risk graph so the chart and its summary metrics appear directly under the controls, with the option chain picker and volatility scenario panel below them.
- Fixed the Bull Put Spread Scanner watchlist, where the status explanation overlapped the indicative spread, DTE, and warning columns.

## Desktop Deployment

- Added a GitHub Actions deployment path for Windows PC, Intel Mac, and Apple-silicon Mac installers from the same release workflow.
- Windows builds are signed through Microsoft Azure Trusted Signing using the public certificate profile for James Presser, so the installer, app executable, and bundled backend executable are Authenticode signed before upload.
- Added CI signature verification for the Windows installer, desktop executable, and packaged backend before the installer artifact is published. The build fails rather than publishing an unsigned or invalidly signed installer.
- The GitHub release now uses this full release description so Windows and Mac downloads share one complete feature and bug-fix summary.

## Everything Included From v1.33.x

The remainder of this description covers every change merged after v1.32.1: two new pages, portfolio-performance analysis, income planning, options research, imports, market-data reliability, layout improvements, and automated coverage.

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

### Total Return

- Added a page-wide 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom date selector. The selected range now controls the summary cards, return-by-ticker chart, comparison chart, return-vs-yield scatter plot, and holdings table together.
- Replaced the all-time summary with transaction-aware Start Value, End Value, Price Return, Distributions, Total Return, daily time-weighted Total Return %, and SPY cards for the selected period, with exact effective dates printed on every card.
- Rebuilt portfolio performance from dated buys and sells so trades change portfolio weights without appearing as gains or losses. Missing opening lots can be reconciled backward from current shares, and holdings without transaction history begin on their saved purchase or import/snapshot date instead of the ticker’s first-ever quote.
- Added an Entire Portfolio comparison line alongside individual holdings and external tickers.
- Expanded comparison modes to Total Return, Price Only, Price + Dividends held as cash, and Both. Matching colors and distinct line styles make price and reinvested-return traces directly comparable.
- Updated the holdings table for the selected period with Start Value, End Value, Price Return, Distributions, Total Return, Total Return %, and each holding’s exact Effective Range.
- Updated the scatter plot to use selected-period return and ending position value, improved signed hover values, and synchronized category filtering across the full page.

### Growth

- Replaced the limited 1Y/5Y/Max selector with the shared 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom ranges. Custom dates are inclusive and validated before loading.
- All now begins at the portfolio’s first recorded trade rather than using older benchmark history, and the exact requested and effective dates are displayed above the analysis.
- Made the selected period and category filters apply consistently to the portfolio grade, Total Return %, Sharpe and Sortino metrics, price-return chart, dividend-reinvested total-return chart, ticker bar chart, and heatmap.
- Added a selected-period Total Return % card and effective-date labels to the grade and return cards.
- Aligned the portfolio grade with the Dashboard’s adjusted-price, current-value-weighted calculation so both pages produce the same grade for the same holdings and period.
- Changed Performance by Ticker from several fixed trailing periods to the currently selected period, with positive and negative bars color-coded for faster comparison.
- Clarified the indexed charts as Price Return Index and Total Return Index (Dividends Reinvested).

### Portfolio Growth 2

- Adopted the same shared 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom period controls used by the other performance pages.
- Added synchronized Start Value, End Value, Total Profit, and Total Return % cards, each showing the exact effective range; End Value also identifies included cash.
- Kept the dollar-value chart, profit/loss chart, and headline cards on the same dates and ticker selection.
- Made All begin at the first recorded trade and use the same inception basis as “From the first trade,” removing an ambiguous second basis choice for that range.
- Prevented holdings from being backfilled into periods before they were owned, while anchoring the latest all-holdings value to the stored holdings and cash used by the Dashboard.
- Added inclusive custom-range validation and clearer requested-versus-effective date messaging.

### Dashboard and Shared Performance Updates

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

- Updated the Option Trade Tracker with improved open-risk handling, realized-performance calculations, income classification, and a clearer execution ledger for multi-leg option positions.
- Added focused backend coverage for option trade tracker calculations and close/expire behavior.
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
- Update the Option Trade Tracker calculations, ledger behavior, and tests.
- Add signed Windows deployment and a shared PC/Mac GitHub release description.
- Fix duplicate option imports.
- Fix the unclosable DRIP Matrix window.
- Fix installed-build startup and Diversification X-Ray, and reorder the risk graph.
- Make Diversification X-Ray work on a newly installed copy.

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.32.1...v1.33.4

