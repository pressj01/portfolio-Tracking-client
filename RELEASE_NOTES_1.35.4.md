# Portfolio Tracking Client v1.35.4

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

This release includes the changes made from August 10 through August 24, 2026. The first sections describe what is new since v1.35.3; the two-week rollup and bug-fix sections summarize the complete period.

## New Since v1.35.3

### Total Return, Growth, Gains & Losses, and Opening-Lot Repair

- Total Return now marks an orange Start Value when the saved position contains shares that the complete BUY/SELL ledger cannot explain. The detail identifies the inferred share count and estimated effect on Start Value.
- Holdings can record those missing shares as a visible, editable opening BUY when the history genuinely begins after the original purchase. The estimate uses the prior market close and preserves the saved holding quantity and broker cost-basis fields.
- Owner and aggregate views now resolve the warning to the real underlying account. If a repair is opened from a rollup, the app explains which account must be selected and can take the user to that account instead of showing a missing or misdirected repair button.
- The repair confirmation reports the transaction-derived average cost before and after the new lot, then returns to Total Return so the corrected warning and values can be reviewed.
- Help on both Total Return and the main Help screen explains the warning, the account requirement, what the repair writes, and its limits. The repair makes an inferred assumption explicit; without the complete transaction history or broker record it cannot guarantee the true opening date, purchase price, cost basis, Start Price, or Start Value.
- Total Return no longer flags a sold-and-rebought ticker when its full ledger already balances. It also no longer applies Yahoo split factors a second time to Snowball history that was imported in current share units.
- Period distributions on Realized and Combined views are now date-scoped, click-through to their included and excluded payments, and are not double-counted when a ticker was both held and partly sold in the period.
- Each Split View pane can select its own account. Total Return adds Cost/Share beside Price at Start and Current Price, keeps the ticker visible during horizontal scrolling, and clarifies that the range-boundary market price is not cost basis.

### Dashboard, Holdings, and Ticker Research

- Dashboard now uses the Snowball-style holdings overview and retains the equity curve, NAV assignment, paid-for-itself status, tracker metrics, and portfolio-level context.
- Holdings overview adds grades, per-view column selection and reordering, and General-view Unrealized Gain and Unrealized Gain % based on the remaining open lot.
- The Life Price card now shows the cost-basis gain/loss in dollars beside the percentage, while tracker cards name the active reporting period so period return is not confused with lifetime profit.
- Unified ticker research is available from holdings, watchlists, comparer pages, and other ticker surfaces, bringing security details into one consistent research sheet.
- Dashboard grade loading no longer waits for one Yahoo quote request per holding, removing a provider-dependent delay from the overview.
- The command palette opens with Ctrl+K and searches pages, tickers, and actions, including pages hidden from the navigation menu.
- Menu Control can hide unused pages and apply Income Tracker, CEF Analyst, or Options Overlay presets while preserving custom ordering.

### Comparers and Charts

- ETF Comparer, Stock Comparer, and Stock/ETF Analysis now chart Yield on Cost over the selected window using the annualized distribution run rate and the share price at the start of that window.
- Yield-on-cost guidance explains the different interpretation for dividend growers and high-yield or option-income funds, and notes that Yield on Cost is not a total-return measure.
- Long dividend-growth histories automatically use a log scale when needed, and isolated spin-off distributions are excluded from the recurring run-rate estimate.
- Plotly charts routed through the shared theme now render axis titles correctly under Plotly 3 and resolve CSS-variable trace colors before drawing.

### Brokerage Imports and Data Safety

- Added Fidelity All-Accounts Positions import with account matching, destination selection, and multi-account updates from one export.
- Added Shear Group All-Accounts Positions and Transactions imports with account routing and safeguards for one-file, multi-account workflows.
- The import format control is wider and stays synchronized with the selected account and confirmed destination.
- Import includes a guided workflow picker and clearer distinctions among positions snapshots, transaction history, single-account imports, and all-accounts imports.
- Clear now removes holdings and the transaction ledger so a corrected import can truly replace bad history. A transactions-only re-import can rebuild positions afterward.
- Clear, Reset, and Delete preview the affected record counts, require the portfolio name for confirmation, and reject unsafe writes from Owner or aggregate rollups. Clear also creates a backup first; Reset preserves records an import cannot rebuild; Delete sweeps all profile-scoped data.
- Transaction duplicate matching now requires date, shares, and price, preventing a corrected trade at a different price from being discarded as the old row.

### Option Scanner

- Risk Averse and Moderate presets now enforce strategy-aware liquidity, earnings, market-cap, AUM, dollar-volume, open-interest, and IV Rank quality gates.
- Added setup shortcuts for pullbacks, rallies, high or cheap IV, weeklies, monthlies, and core indexes. Only setups that fit the selected strategy are offered.
- Covered Call, Collar, and Married Put scans can use the selected portfolio's holdings. Covered calls require at least 100 shares and a strike above cost basis.
- Scanner help documents practical starting points and the modeled expiration-probability ranges associated with common delta bands.

### NAV Erosion and Reliability

- NAV Erosion portfolio analysis uses split-adjusted prices, retries symbols omitted from a batch provider response, and lets each row choose its benchmark.
- Reverse-split securities no longer receive unrealistic historical starting prices in NAV erosion comparisons.

## Two-Week Update Rollup — August 10–24, 2026

### Performance and Portfolio Analysis

- Rebuilt transaction-aware tracker returns across Dashboard, Growth, Total Return, Growth 2, and Gains & Losses so buys, sells, deposits, and withdrawals are treated as cash flows rather than investment gains.
- Added shared 1D, 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom ranges, aligned market-session boundary handling, risk metrics, benchmarks, heatmaps, return cards, and as-of labels.
- Added holdings-only and broker-reconciliation views, including Account Value when cash and open-option marks are available.
- Added Open, Realized, and Combined Total Return views, expandable closed lots, consistent category filters, and transaction-aware opening/ending values for Owner portfolios.
- Combined Growth, Portfolio Growth 2, and Lots into one Growth workspace with Dollars, Vs market, and Lots tabs.
- Added Split View for side-by-side performance pages with synchronized date ranges and, now, independent account selection.
- Added transaction-aware Actual portfolio history and cross-account hypothetical ticker selection to Portfolio Tester, with Growth and Income modes and coverage-date guidance.
- Added Daily, Weekly, and Monthly interval controls to Dashboard charts, sticky Total Return headers, closed-position names, and clearer Life versus selected-period performance.
- Added Sector Exposure look-through, a Growth portfolio treemap, and Actual Price modes for ETF Comparer, Stock Comparer, and Stock/ETF Analysis.
- Added customizable, persistent column selection and ordering to Dashboard, Manage Holdings, Gains & Losses, Dividend Analysis, fund-scanner results, and the current holdings overview.

### Dividends, Income, and Retirement Planning

- Manual ex-dividend dates, payment dates, amounts, and frequencies remain protected through the applicable payment instead of being overwritten by refresh.
- Imported dividend transactions were made authoritative across Dashboard, Dividend Calendar, Holdings, Dividend Analysis, Action Center, accruals, and refresh results, with corrected account scoping and payment-date handling.
- Dashboard's weekly calendar was aligned with the Dividend Calendar Month view, including cross-month weeks, money-market funds, pinned semiannual schedules, and estimated-versus-confirmed markers.
- Current distribution rates replace stale historical estimates for decayed payouts, and corrected or locked payment frequencies flow through annualization and every calendar tab.
- XFUNDS supplies dates and amounts for newer funds such as DRMY and FIZY when Yahoo does not yet have usable history.
- Retirement Readiness now persists every assumption separately for each selection. Updated guidance explains re-syncing from Cash Flow & Sustainability and how the cash-runway and projection calculations work.

### Imports, Accounts, and Maintenance

- Added Schwab All-Accounts Positions import with automatic account matching, selectable destinations, remembered routing, and support for single-account All-Accounts exports.
- Added Snowball category import and a Growth, Income, and Cash parent/subcategory hierarchy, including reliable slash-category handling.
- Added portfolio-selector preferences to show, hide, and reorder accounts and aggregates without deleting them.
- Holding ticker rename now migrates transactions, dividends, categories, DRIP settings, and related ticker records while detecting conflicts first.
- Standardized active positions on the canonical holdings source so a complete positions snapshot removes stale open holdings without deleting their transaction history.
- Hardened SQLite backup and restore for live WAL databases and added persistent market-data caching with stale-data fallback.
- Added stable transaction identity checks so re-importing the same brokerage history does not duplicate equity transactions.

### Options, Research, and Action Center

- Added a unified General Option Scanner for calls, puts, verticals, iron condors, and butterflies, with payoff graphs, risk probabilities, scenario filters, 0-DTE through LEAPS support, and per-strategy field guidance.
- Added IV-versus-realized-volatility metrics and ranks, 30-DTE skew history, broader scenario inputs, and profit-capture odds for both expiration and the chance of reaching a resting close target earlier.
- Added portfolio-aware evaluator scans, sticky scanner headers, and explicit methodology/verdict thresholds for the Non-Income ETF, Option-Income ETF, and Stock Buying checklists.
- Index ETFs are no longer assigned stock-specific scores, and option-score filters now explain when a stock-only measure does not apply.
- Watchlist adds sortable security descriptions and AUM, and comparer charts add actual-price analysis and corrected log-scale end labels.
- Expanded Action Center follow-ups for option expirations and rolls, NAV erosion, CEF discounts, unconfirmed dividends, stale imports, ETF closure risk, and other data-quality checks; Refresh Data is available from the Action Center.
- Added automatic batched daily collection of near-30-DTE ATM implied volatility for holdings, watchlists, open option underlyings, and saved scanner tickers.

### Navigation, Documentation, and Accessibility

- Added admin navigation ordering, page visibility controls, navigation presets, portfolio-selector preferences, and the Ctrl+K command palette.
- Expanded in-app Help for performance screens, imports, accounts, dividend calendars, retirement planning, option scanners, Action Center, Dashboard, Menu Control, and the opening-lot repair, with updated screenshots.
- Clarified Price Return, Tracker Total Return, Total Profit, Start/End Value, range clocks, confirmed versus estimated payments, and account-versus-rollup behavior throughout the app.
- Improved table scrolling, frozen columns, tooltips, screen-reader labels, date formatting, and text encoding across dense portfolio screens.

## Bug Fixes

- Fixed same-day sell/rebuy history creating phantom shares and corrected sold-and-rebought positions so performance starts from the current open lot where appropriate.
- Fixed fully closed positions appearing in open-position totals while preserving their realized history in period results.
- Fixed Owner transaction replay and account scoping so underlying-account flows are included once and repairs are written only to the account that owns them.
- Fixed false orange Start Value warnings when the full transaction ledger already balances.
- Fixed Snowball-adjusted lots being split-adjusted again by Yahoo data, including reverse-split overstatements.
- Fixed Total Return distributions using lifetime payments in a period row and being counted twice in Combined view.
- Fixed Tracker, Growth, Total Return, and Gains & Losses boundary dates, current-day pricing labels, and selected-period alignment.
- Fixed Gains & Losses text encoding and added reliable security names for closed positions.
- Fixed Dashboard horizontal scrolling slicing the Ex-Div column and restored readable title tooltips for clipped descriptions.
- Fixed Dashboard grades being blocked by individual Yahoo quote requests.
- Fixed Plotly 3 dropping string axis titles and ignoring CSS-variable trace colors.
- Fixed NAV erosion history around reverse splits and missing symbols in provider batch downloads.
- Fixed a manually locked dividend cadence being overwritten or annualized with the wrong frequency.
- Fixed calendar account scoping, cross-month weekly coverage, money-market schedules, and new-fund dates and amounts.
- Fixed Holdings waiting on a live dividend-calendar provider call instead of using the resolved cached schedule.
- Fixed deleted categories being automatically seeded again and fixed Growth 2 clear-all and batch loading.
- Fixed unsafe Owner/aggregate writes that could target the fallback Owner profile, and fixed Delete leaving orphaned profile records.
- Fixed Clear leaving transactions behind, which caused corrected re-import rows to be skipped as duplicates.
- Fixed duplicate transaction matching that ignored an updated price.
- Fixed single-account Schwab exports with an All-Accounts filename being rejected unnecessarily.
- Fixed Snowball slash categories failing to create and assign their parent/subcategory hierarchy reliably.
- Fixed WAL-mode backup consistency and stale journal replay during restore.
- Fixed ticker rename gaps across transactions, dividend history, categories, and related saved settings.
- Fixed open holdings lingering through legacy data after a complete brokerage snapshot removed them.
- Fixed stale market-data failures blanking previously collected research, price, or distribution data.
- Fixed option-scanner inconsistencies among payoff extrema, current-price labels, listed-contract filtering, and log-chart label positioning.
- Fixed duplicate price normalization in ETF comparer data.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.35.3...v1.35.4
