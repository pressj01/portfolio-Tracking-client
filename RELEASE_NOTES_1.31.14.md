# Portfolio Tracking Client v1.31.14

**Release date:** June 28, 2026

**Platforms:** Windows x64 and macOS Intel x64 / Apple Silicon arm64

v1.31.14 is a startup-reliability update for the v1.31.13 desktop release. It addresses an installed application appearing to do nothing when the bundled backend needs extra time to start or encounters an error.

## Startup reliability

- Increased the backend startup allowance from 15 seconds to 60 seconds.
- This accommodates first-launch security scanning by Windows Defender, macOS Gatekeeper, and third-party security software.
- A startup failure now displays a visible error dialog instead of silently closing.
- Every installed-app launch now writes a fresh `startup.log` containing:
  - application version,
  - backend executable path,
  - backend working directory,
  - selected database directory,
  - backend output,
  - backend exit status, and
  - startup timeout or launch errors.

## Configurable database directory

- Installed applications can use an existing database directory without embedding a machine-specific path in the installer.
- Set the database directory with either:
  - the `PORTFOLIO_DB_DIR` environment variable, or
  - a `database-directory.txt` file in the application user-data folder.
- The configured directory is used only when it contains `portfolio.db`.
- Invalid or unavailable configured paths safely fall back to the normal per-user application database.
- The configuration file remains outside the installed program so it can survive application updates.

## Diagnostic log locations

### Windows

`%APPDATA%\portfolio-tracking-client\startup.log`

### macOS

`~/Library/Application Support/portfolio-tracking-client/startup.log`

If the app cannot open, the displayed error includes the exact log location.

## Downloads

### Windows

Download `Portfolio.Tracking.Client.Setup.1.31.14.exe`.

### macOS

- `Portfolio.Tracking.Client-1.31.14-arm64.dmg` — Apple Silicon
- `Portfolio.Tracking.Client-1.31.14.dmg` — Intel

These builds are not commercially code-signed. Windows SmartScreen or macOS Gatekeeper may require confirmation on first launch.

The application is designed to run under a normal user account. Running it as administrator should not be required.

---

## Everything included from v1.31.13

v1.31.14 is cumulative and includes the complete v1.31.13 application update in addition to the startup improvements above.

### Holding Targets

- Added a ticker-level planning workflow between category planning and the Rebalance Wizard.
- Shows the current number of shares held for every position.
- Plans purchases and sales using:
  - portfolio percentage,
  - dollar amount, or
  - share quantity.
- Uses explicit Buy and Sell editors instead of changing holdings directly.
- Shows planned shares, position value, portfolio weight, adjusted allocation, and monthly income changes.
- Restores an existing planned trade when its Buy or Sell editor is reopened.
- Converts the entered amount when switching between percentage, dollars, and shares.
- Prevents planned sales larger than the current position.
- Supports clearing one trade without disturbing unrelated targets.
- Shows final Buy/Sell recommendations in both dollars and shares.
- Supports automatic proportional adjustment to a 100% portfolio.

#### Saved plans and comparison holdings

- Holding Targets opens on current weights so an old plan does not silently appear as an active recommendation.
- Load Plan explicitly activates saved targets.
- Show Current Weights temporarily returns to the live portfolio without deleting the saved plan.
- Discard Plan permanently removes saved targets.
- Plan banners identify affected holdings and show the last edit time.
- Comparison ETFs can be added to a category without first being owned.
- Prospective purchases use live price, yield, allocation, share, and income calculations.

#### Reallocation Cash Pool

- Planned sales create a visible cash pool.
- Destination holdings can be selected for reinvestment.
- Allocations can be entered by percentage, dollars, or shares.
- Auto-fill options distribute proceeds equally, by category gap, or by yield.
- Monthly and annual income effects are shown before applying an allocation.
- Resetting a holding or category releases its pending allocation back to the pool.

### Portfolio Tester Income mode

- Added separate Growth and Income testing modes.
- Income handling can:
  - spend all distributions,
  - spend a target and reinvest the surplus,
  - fully reinvest distributions, or
  - exclude distributions.
- Withdrawal targets can increase with inflation.
- Shares are sold when distributions do not meet the requested income.
- Benchmark comparisons can sell benchmark shares to provide the same net income.
- Added distribution-tax modeling.
- Added net-income, residual-principal, share-count, and withdrawal-aware calculations.
- Added Income-mode summaries, charts, screenshots, and Help.

### Stock Valuation

- Added discounted cash flow valuation.
- Added a ratio scorecard and valuation grading.
- Added intrinsic-value ranges and verdicts.
- Added supporting valuation APIs and regression tests.
- Added safeguards for missing, negative, or unsuitable financial inputs.

### Reinvestment Impact

- Added the Price Impact model.
- Models price declines and increases for one holding or the full portfolio.
- Supports adjustable time horizon, reinvestment percentage, and monthly additions.
- Shows current income sensitivity, future value, share count, and income.
- Includes price-recovery and total-return break-even analysis.
- Identifies leading portfolio income contributors.

### Analytics and portfolio diagnostics

- Portfolio grades now use a shared common-history window.
- New holdings no longer collapse the grading period.
- Pairwise correlations handle incomplete histories more fairly.
- Grade responses expose the data window and excluded holdings.
- Optimizer before/after grades use the same history window.
- Risk-versus-return charts include the complete portfolio and benchmark.
- NAV erosion charts include clearer axes and thresholds.
- Correlation heatmaps highlight correlations above 0.75.
- Backtests include period and benchmark selectors.
- Added Portfolio Score and NAV Erosion Ratio methodology explanations.

### ETF, CEF, and stock research

- Beta is calculated from daily returns when provider beta is unavailable.
- Securities are evaluated against both SPY and QQQ.
- Benchmark selection uses the strongest reliable signed correlation.
- ETF comparisons include approximate up-market and down-market capture.
- Added 3-year, 4-year, and Common History comparison periods.
- Inception comparisons correctly show different security histories.
- Added estimated forward distribution yield from recent payments.
- Distribution frequency follows recent payment cadence.
- Fixed slow or duplicate holdings requests in ETF and Stock Comparers.
- Added CEF Connect holdings fallback support.
- Improved layouts for three or more holdings cards.
- Added persistent option-income ETF type overrides.
- Added Markov Bear, Sideways, and Bull regime analysis.

### Dashboard and Holdings

- Added a persistent Holdings column picker.
- Added Ex-Dividend and Pay Date columns with chronological sorting.
- Fixed the column picker appearing beneath sticky table layers.
- Added frozen identity and position columns for wide tables.
- Added applicable footer totals.
- Added Lifetime Income.
- Added subcategory account-allocation details.
- Improved NAV erosion summaries and portfolio risk-data availability.
- Added safe Dashboard behavior when the S&P 500 quote is unavailable.

### Categories and allocation

- Added second-tier subcategories.
- Added subcategory target percentages.
- Added migrations, APIs, and regression tests for subcategory assignments and targets.
- Improved assignment consistency across profiles and aggregate views.
- Holding Targets surfaces uncategorized holdings so they remain plannable.

### Blended Yield Calculator

- Added Load My Portfolio.
- Added a richer portfolio picker and clearer portfolio context.
- Added ATY, TEY, and yield-field explanations.
- Added calculated shares and portfolio totals.
- Added a complete allocation legend and sticky summary header.
- Rejects implausibly stale provider yields when current payout data is more reliable.

### Theme, currency, and desktop experience

- Added application-wide light and dark themes.
- Added theme-aware Plotly rendering.
- Added an application error boundary instead of a blank window after UI failures.
- Added display-only USD/CAD conversion while retaining USD source data.
- Added live exchange-rate retrieval, caching, stale-rate fallback, and manual overrides.
- Corrected money cells that bypassed display conversion.
- Added protections against reimporting currency-converted exports as USD.
- Added application, taskbar, browser-tab, executable, and installer icons.
- Improved Windows application identity and backend process cleanup.
- Kept local development data separate from normal installed application data.
- Built Intel and Apple Silicon packages on matching native GitHub runners.

### Data integrity and calculation fixes

- Cost-basis totals now use current quantity rather than the original larger position after shares are sold.
- Original and broker-adjusted totals derive from the appropriate per-share basis.
- Manual edits keep original and broker basis fields consistent.
- Broker-managed purchase dates advance to the earliest transaction lot still open.
- Dividend frequency follows recent payment spacing instead of trailing-year counts.
- Old payments from a previous distribution schedule no longer distort annualization.
- Unreliable provider yield data is replaced by payout-derived estimates.
- Category and subcategory relationships remain consistent after edits.

### Additional v1.31.13 bug fixes

- Holding Targets accepts decimals, pasted currency amounts, and percentages.
- Reopening a loaded trade restores its amount instead of showing zero.
- Switching trade units no longer clears the amount.
- Resetting a target no longer strands cash-pool allocations.
- Oversized sales are blocked.
- Saved targets no longer appear as phantom trades.
- Slow ETF holdings responses are no longer dropped.
- Stock Comparer no longer repeatedly fetches every unresolved symbol.
- CEF holdings no longer appear blank solely because Yahoo omits fund metadata.
- Beta selection no longer prefers weak negative correlations.
- Unsupported 3Y/4Y provider periods use explicit date windows.
- Analysis periods remain stable during refreshes.
- Ex-dividend and pay-date values sort by actual date.
- Missing S&P 500 data no longer crashes Dashboard rendering.
- Runtime uploads and temporary image artifacts are excluded from Git.

### Help and documentation

Help was expanded for Holding Targets, Portfolio Tester Income mode, Stock Valuation, Reinvestment Impact, Markov analysis, Blended Yield, USD/CAD display, Analytics scoring, NAV erosion, and category/subcategory targets.

All Help screenshots are bundled under `public/help-screenshots`, so they remain available in installed Windows and macOS applications without relying on paths from the development computer.

## Verification

- JavaScript syntax validation for the production Electron launcher.
- Frontend production build.
- Packaged Windows application launch against a clean per-user database directory.
- Existing backend regression suite.
- Independent GitHub Actions installer builds for Windows x64, macOS Intel x64, and macOS Apple Silicon arm64.
