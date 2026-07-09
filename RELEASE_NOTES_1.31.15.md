# Portfolio Tracking Client v1.31.15

**Release date:** June 29, 2026

**Platforms:** Windows x64 and macOS Intel x64 / Apple Silicon arm64

**Change window:** All updates since v1.31.12

v1.31.15 is a cumulative desktop release. It bundles the complete v1.31.13 application update (portfolio planning, income-aware backtesting, analytics accuracy, research tools, data integrity, light/dark themes, USD/CAD display, and dozens of correctness fixes), the v1.31.14 startup-reliability improvements, and two new purchase-date display fixes shipped on June 29.

---

## Downloads and installation

### Windows

Download **`Portfolio.Tracking.Client.Setup.1.31.15.exe`** and run the NSIS installer.

- Architecture: x64
- Supports choosing an installation directory.
- Creates Start Menu and desktop shortcuts.
- Existing portfolio data remains in the application data directory and is not replaced by installing the update.

### macOS

Choose the DMG that matches the Mac:

- **`Portfolio.Tracking.Client-1.31.15-arm64.dmg`** — Apple Silicon (M1, M2, M3, M4, and later).
- **`Portfolio.Tracking.Client-1.31.15.dmg`** — Intel x64 Macs.

Open the DMG and drag **Portfolio Tracking Client** into **Applications**.

### First-launch security notice

These community builds are produced by GitHub Actions without commercial Windows or Apple code-signing credentials. Windows SmartScreen or macOS Gatekeeper may therefore ask for confirmation.

- On Windows, use **More info → Run anyway** if SmartScreen appears.
- On macOS, Control-click the app in Applications, choose **Open**, and confirm the first launch.

Only download installers from this repository’s official GitHub Releases page.

---

# v1.31.13 application update (all enhancements)

The v1.31.13 cumulative update adds the new Holding Targets workflow, a full Stock Valuation tool, Portfolio Tester Income mode, a Price Impact model for reinvestment analysis, light/dark themes, USD/CAD display conversion, stronger ETF and CEF research, configurable Dashboard columns, and dozens of correctness and usability fixes.

## Release highlights

### Holding Targets: a complete ticker-level planning workflow

The new **Holding Targets** page sits between category planning and the Rebalance Wizard. It lets users build a saved, non-executing trade plan at the individual ticker level while seeing the effect on allocation, cash, shares, and income.

- See the current number of shares held for every position.
- Plan purchases and sales using:
  - portfolio percentage,
  - dollar amount, or
  - share quantity.
- Use explicit **Buy** and **Sell** controls instead of editing position values directly.
- Review the planned order and the resulting:
  - total shares,
  - position value,
  - portfolio weight,
  - monthly income change, and
  - adjusted scenario.
- Reopen a planned trade and continue from its saved amount instead of starting at zero.
- Switch between percentage, dollars, and shares without clearing the current amount.
- Prevent sales larger than the position currently held.
- Clear an individual planned trade without disturbing unrelated targets.
- Show requested targets in percentage, dollars, and total shares.
- Show final Buy/Sell recommendations in both dollars and shares.
- Retain automatic proportional balancing to a 100% portfolio, with a clear warning when the adjusted trade differs from the raw requested amount.

#### Saved-plan behavior

- Holding Targets opens on live current weights so an old plan does not silently appear as an active recommendation.
- **Load plan** explicitly activates saved targets.
- **Show current weights** temporarily returns to a trade-free live view without deleting the plan.
- **Discard plan** permanently removes the saved targets.
- Plan banners identify affected holdings and show the last edit time.
- Planned rows receive a visible plan badge.
- Reopening the matching Buy or Sell editor displays **Current plan loaded** and restores the existing order amount.

#### Comparison holdings

- Add an ETF that is not currently owned to any category as a comparison holding.
- Optionally assign it to a subcategory.
- Model a prospective purchase using live price, yield, allocation, share, and income calculations.
- Comparison rows remain zero-value until a Buy plan is applied and do not alter current portfolio totals.

#### Reallocation Cash Pool

- Planned sales create a visible pool of available cash.
- Select destination holdings for reinvestment.
- Enter allocations by percentage, dollars, or shares.
- Auto-fill proceeds:
  - equally,
  - by category gap, or
  - by yield.
- Preview monthly and annual income gains before applying an allocation.
- Resetting a ticker or category to current weight now releases its pending allocation back to the pool.

#### Holding Targets Help

- Rewritten to match the Buy/Sell workflow.
- Added deployment-bundled screenshots for:
  - the loaded-plan overview and cash pool,
  - per-category holding tables, and
  - a loaded Buy-plan editor.
- Removed obsolete screenshots.
- Added clear explanations for saved plans, requested vs. adjusted trades, unit conversion, cash allocation, and the fact that this page never places broker orders.

---

## Portfolio Tester: new Income mode

Portfolio Tester can now evaluate income strategies rather than treating every distribution as automatic reinvestment.

- New Growth and Income testing modes.
- Income handling choices include:
  - spend all distributions,
  - spend a target and reinvest the surplus,
  - fully reinvest distributions, or
  - exclude distributions.
- Withdrawal targets can grow with inflation.
- When distributions fall short of the target, the simulation sells shares to fund the difference.
- Optional benchmark comparison sells benchmark shares to deliver the same net income, making “income portfolio versus just selling the index” comparisons possible.
- Added distribution-tax modeling.
- Added net-income, residual-principal, share-count, and withdrawal-aware calculations.
- Added Income-mode summary tables and charts.
- Added updated screenshots and detailed Help documentation.

---

## Stock Valuation

A new **Stock Valuation** page adds a structured fundamental and intrinsic-value review.

- Discounted cash flow valuation.
- Ratio scorecard and valuation grading.
- Intrinsic-value range and verdict presentation.
- Supporting backend valuation engine and API routes.
- Guardrails for missing, negative, or unsuitable financial inputs.
- Dedicated regression tests.
- New Help section with ratio-scorecard and verdict screenshots.

---

## Reinvestment Impact: Price Impact model

Reinvestment Impact now includes a dedicated **Price Impact** tab for answering how a fixed price move changes current income and longer-term reinvestment outcomes.

- Model price changes from a deep decline through a large increase.
- Analyze a single fund or the whole portfolio.
- Adjust horizon, reinvestment percentage, and monthly additions.
- See current income sensitivity to price.
- Compare value, share count, and income after reinvestment.
- Review break-even status using both price recovery and total return.
- Identify top income contributors.
- Added explanatory math, scenario guidance, and updated screenshots in Help.

---

## Analytics and portfolio diagnostics

### More defensible portfolio grading

- Portfolio grades use a shared common-history window rather than fabricated zero-return days.
- Brand-new holdings no longer collapse the usable grading window.
- Pairwise correlations handle incomplete histories more fairly.
- The grade response exposes the data window and excluded holdings for reproducibility.
- Optimizer before/after grades use the same history window so the difference reflects weights rather than different samples.

### Chart and analysis improvements

- Risk-versus-return charts include the whole portfolio and benchmark.
- NAV erosion charts include axis and threshold guidance.
- Correlation heatmaps highlight correlations above 0.75 and use a more compact layout.
- Income and allocation labels remain inside their charts to avoid overflow.
- Backtests add period and benchmark selectors plus a dashed benchmark line.
- Tools-panel what-if calculations use the usable-history sleeve.
- Added hidden explainers for Portfolio Score and NAV Erosion Ratio, including methodology and severity bands.

---

## ETF, CEF, and stock research

### Better beta and effective-delta analysis

- ETF and Stock Comparers calculate beta from actual daily returns when Yahoo beta is unavailable.
- Each security is compared with both SPY and QQQ.
- Benchmark selection uses the strongest signed correlation above a reliability threshold; otherwise it defaults to SPY.
- This prevents confusing negative-beta results caused by choosing a weak anti-correlated benchmark.
- Comparer tables label beta as **vs SPY** or **vs QQQ**.
- Added approximate up-market and down-market delta/capture for ETF comparisons to expose covered-call upside caps and downside participation.

### Fairer comparison periods

- Added 3-year and 4-year ranges.
- Added a **Common History** comparison starting at the latest fund inception.
- Inception bars show their individual history lengths.
- Maximum comparison windows are aligned across the ETF screen and ETF/Stock Comparers.
- Analysis ranges persist instead of resetting unnecessarily.
- Trading-session spacing avoids misleading calendar gaps.

### Yield reliability

- Added estimated forward distribution yield from recent payments.
- Dividend Yield prefers fund-provider expected yield, then distribution-derived yield, before unreliable Yahoo values.
- Security Research summaries include approximate distribution yield.
- Recent payment cadence is used to infer dividend frequency, so funds that change from quarterly to monthly are recognized promptly.
- Annualization uses the recent run that matches the inferred schedule instead of mixing obsolete payment cadence.

### Holdings reliability and layout

- Fixed ETF/Stock Comparer effects that dropped slow holdings responses or fired duplicate requests.
- Closed-end funds can retrieve holdings even when Yahoo does not return `fund_data`.
- Added CEF Connect fallback support and support for funds with shorter holdings lists.
- Three or more holdings cards fit more cleanly, wide tables scroll, and long holding names wrap.

### ETF type overrides

- Users can permanently mark a misclassified fund as an option-income ETF.
- Added persistent ETF type overrides and supporting API routes.
- The Option-Income ETF Evaluator warning provides a one-click override action.

### Markov analysis

- Stock & ETF Analysis adds a Markov tab.
- Detects Bear, Sideways, and Bull regimes.
- Shows next-period transition probabilities and trend stickiness.
- Includes presets, regime shading, transition matrix, stationary distribution, and threshold guidance.
- Settings persist locally.

---

## Dashboard and Holdings

### Configurable Holdings columns

- Added a column picker with grouped columns and persistent visibility choices.
- Fixed the picker being covered by sticky table layers.
- Added Ex-Dividend and Pay Date columns with chronological sorting.
- Frozen left-side identity and position columns remain visible during horizontal scrolling when the viewport has enough room.
- Added per-column footer totals where applicable.

### Dashboard additions

- Added Lifetime Income.
- Added subcategory account allocation details.
- Refined NAV erosion summary presentation.
- Improved risk-data availability for grading and exposure.
- Added safe fallbacks when the S&P 500 quote is unavailable.

---

## Categories and allocation organization

- Added second-tier subcategories.
- Added subcategory target percentages.
- Added backend migrations, APIs, and tests for subcategory assignments and targets.
- Improved category assignment consistency across profiles and aggregate views.
- Fixed stale or conflicting category/subcategory relationships during updates.
- Holding Targets can surface uncategorized holdings immediately so they remain plannable before category cleanup.

---

## Blended Yield Calculator

- Added **Load My Portfolio** to seed the calculator from the selected live portfolio or aggregate.
- Added a richer portfolio picker and clearer portfolio context.
- Added header tooltips for ATY, TEY, and other yield fields.
- Added calculated Shares and a portfolio total.
- Added a complete allocation legend so small slices remain identifiable.
- Added a sticky summary-table header for long portfolios.
- Rejected implausibly stale provider yields when they are far below current payout-derived yield.
- Added updated Help documentation and screenshots.

---

## Theme, display currency, and desktop experience

### Light and dark themes

- Introduced application-wide design tokens.
- Added ThemeContext and theme-aware Plotly rendering.
- Updated charts and a broad set of application pages for both themes.
- Added error-boundary protection so a render failure does not leave a blank application window.

### USD and CAD display

- Added a display-only USD/CAD selector in Settings.
- Portfolio data remains stored in USD.
- Money values, summaries, charts, and exports convert consistently for display.
- Exchange rates support live Yahoo retrieval, caching, stale-rate fallback, and manual override.
- Corrected money cells that had lost their currency symbol or bypassed conversion.
- Added safeguards against reimporting converted exports as if they were USD source data.

### Desktop identity and launch behavior

- Added application icons for the executable, taskbar, browser tab, and installer.
- Updated the Windows application identity for correct taskbar grouping.
- The launcher prefers the packaged application when available.
- Local development uses the development database path rather than accidentally sharing the installed application database.
- Improved backend process cleanup on Windows and macOS.
- Installer builds now use a cross-platform Python command, and Intel/Apple Silicon DMGs are built on matching native GitHub runners so each package contains the correct backend architecture.

---

## Data integrity and calculation fixes

### Cost basis

- Fixed reduced positions using a stale original purchase total after shares were sold.
- Original and broker-adjusted basis totals now derive from current quantity times the appropriate per-share basis when available.
- Stored totals remain a fallback only when per-share basis is missing.
- Fixed manual-edit paths that could leave original and broker basis fields inconsistent.
- Broker-managed positions now advance their purchase date to the earliest transaction lot still open after older lots are fully sold, without changing the broker-reported share count.
- Added regression coverage for quantity changes, clearing paid price, and zero-share positions.

### Dividend frequency and projected income

- Frequency inference now follows recent payment spacing instead of a trailing-year payment count.
- Schedule changes are reflected sooner.
- Old payments from a former cadence no longer dilute current annualization.
- Provider yield data that materially conflicts with current payouts is ignored in favor of payout-derived figures.

### Category assignments

- Fixed inconsistent category and subcategory assignment updates.
- Improved migration and cleanup behavior across portfolio profiles.
- Added extensive subcategory regression tests.

---

## Bug-fix ledger

This release also includes the following targeted fixes:

- Decimal points and cents no longer disappear while typing Holding Targets or reinvestment amounts.
- Buy/Sell trade inputs now accept direct keyboard entry and pasted values such as `$1,000` or `5%`.
- Reopening a loaded Holding Targets trade restores its amount instead of showing zero.
- Switching trade units converts the amount rather than clearing it.
- Resetting a Holding Targets row or category releases unused reinvestment cash.
- Oversized planned sales are blocked.
- Saved Holding Targets plans no longer auto-apply as “phantom” trades when the page opens.
- ETF Comparer no longer drops a slow holdings response when another ticker finishes first.
- Stock Comparer no longer refetches every unresolved symbol whenever one result arrives.
- CEF holdings no longer appear blank solely because Yahoo omits fund metadata.
- ETF holdings cards no longer clip or collapse with three or more compared funds.
- Beta benchmark selection no longer prefers a weak negative correlation.
- Inception comparisons no longer imply equal time spans for funds launched in different years.
- Unsupported 3Y/4Y Yahoo periods are translated into explicit date windows.
- Analysis ranges and trading-session spacing remain stable when views refresh.
- Dashboard column-picker controls remain clickable above sticky headers.
- Ex-dividend and pay-date strings sort by actual date.
- Current shares sold from a position no longer leave gain/loss tied to the original larger share count.
- Broker position snapshots no longer retain the purchase date of a transaction lot that has already been fully sold.
- Category and subcategory assignments remain consistent after edits.
- Resetting to current weight no longer strands a cash-pool allocation.
- Stale provider distribution yield no longer overrides substantially higher recent payouts.
- Missing S&P 500 data no longer crashes Dashboard rendering.
- Application-level render errors show a recoverable error screen instead of a blank window.
- The macOS release job no longer fails by calling the Windows-only `py` launcher.
- Runtime uploads and temporary PNG artifacts are excluded from Git.

---

## Help and documentation

Help was expanded or refreshed for:

- Holding Targets,
- Portfolio Tester Income mode,
- Stock Valuation,
- Reinvestment Impact Price Impact,
- Markov analysis,
- Blended Yield portfolio loading,
- USD/CAD display settings,
- Analytics scoring and NAV erosion,
- category/subcategory targets, and
- related Dashboard and research changes.

Screenshots used by Help are stored under the application’s bundled `public/help-screenshots` assets so they work in installed Windows and macOS builds without depending on developer-machine paths.

---

# v1.31.14 startup reliability

The v1.31.14 update addresses an installed application appearing to do nothing when the bundled backend needs extra time to start or encounters an error.

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

---

# New in v1.31.15

Two purchase-date display fixes shipped on June 29:

- **Fixed a purchase-date off-by-one in the Dashboard holdings table.** Date-only purchase dates (`YYYY-MM-DD`) were parsed as UTC midnight and then rendered in local time, shifting them a day earlier in negative-UTC timezones (for example, a June 25 purchase displayed as June 24). Date-only values are now pinned to local midnight so the Dashboard holdings table and the holding-detail modal match the dates shown in the editor.
- **Moved the Purchase Date column to the front of the Manage Holdings table.** The column previously sat mid-table behind the frozen columns and scrolled out of view. It is now the first scrollable column (immediately after the frozen Shares column) so it is visible at the default scroll position.

---

## Verification

- Frontend production build: `npm run build`
- Backend regression suite: `python -m unittest discover -s backend -p "test_*.py"`
- GitHub Actions builds the Windows and macOS installers independently from the `v1.31.15` tag.
- Release assets are checked after both jobs complete.

---

## Complete changelog

- [All commits from v1.31.14 to v1.31.15](https://github.com/pressj01/portfolio-Tracking-client/compare/v1.31.14...v1.31.15)
