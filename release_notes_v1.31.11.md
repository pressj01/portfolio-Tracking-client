## v1.31.11 - Cumulative Desktop Release Since v1.28.8

**Release date:** June 5, 2026
**Available for:** Windows (.exe installer, x64) and macOS (.dmg, Intel x64 + Apple Silicon arm64)

This release keeps the cumulative desktop description and adds a Dashboard portfolio-grade fix on top of the Record NAV status-banner fix and the June 3 E*TRADE transaction import cleanup. The description still reaches back to v1.28.8 from May 26, 2026, so users can see more than a week of changes in one place.

---

## Latest fixes in v1.31.11

### Portfolio grade tiles no longer stick blank after a price-data hiccup
The Dashboard's Portfolio Grade, Ulcer Index, Calmar, Omega, Sortino, and Sharpe tiles are computed from a fresh one-year price download, separate from the NAV chart. When that download came back empty or partial — for example after a temporary market-data rate limit — fewer than two holdings had enough history to grade, the grade came back empty, and that empty result was cached for 30 minutes against the selected accounts. The blank grades then stayed blank across account switches and chart refreshes until the cache expired. Empty/failed grade results are no longer cached, the last good grade is reused when a refresh comes back empty, and the Dashboard no longer lets an empty response overwrite grades that already loaded.

---

## Latest fixes in v1.31.10

### Record NAV status banner now clears after a successful snapshot
Clicking **Record NAV** on the Dashboard refreshes prices and dividends before recording the snapshot and shows an "Updating prices & dividends before recording NAV..." banner while it works. The handler only reset that banner in its skipped and error branches, so a successful snapshot left the message on screen indefinitely. It now shows a brief confirmation and clears the banner on success, matching the other branches.

---

## Latest updates in v1.31.9

### E*TRADE transactions now use one All Transactions import
E*TRADE transaction importing is now a single **E*Trade (Transactions)** choice instead of separate Buys & Sells and Dividends formats. The importer reads the E*TRADE transaction headers and row content, not the filename, so renamed exports work as long as the file has the expected E*TRADE transaction columns.

### CSV and Excel E*TRADE exports are both supported
The unified E*TRADE transaction importer supports both `.xlsx` and `.csv` All Transactions exports. Real E*TRADE CSV and Excel samples were checked and produced the same normalized result: buys, sells, cash dividends, DRIP buys, and filtered transfer/interest rows.

### E*TRADE DRIP rows are classified more carefully
Regular `Bought` rows stay normal BUY transactions. Rows are tagged as `[DRIP]` only when the activity or description indicates dividend or capital-gain reinvestment. This avoids the old split-import confusion where an All Transactions file could make ordinary purchases look like dividend reinvestments.

### One E*TRADE transaction template
The old E*TRADE Buys & Sells and Dividends templates were removed and replaced by one `etrade_transactions_template.xlsx` that matches the All Transactions export shape. The Import page now downloads this one template from the E*Trade (Transactions) option.

### Import help screenshots and documentation cleaned up
The Help page now documents the single E*TRADE transaction workflow for CSV and Excel. Import screenshots were renamed to descriptive filenames and the obsolete E*TRADE Dividends screenshot was removed.

---

## Latest fixes in v1.31.8

### Duplicate transaction imports no longer inflate DRIP totals
Overlapping broker transaction re-imports previously created duplicate BUY/SELL rows because the duplicate check compared price with exact equality. The same fill can arrive from two feeds with tiny rounding differences, so the re-imported copy was not recognized as a duplicate. Import dedup now uses a sub-cent price tolerance so rounding-only differences are caught while genuinely distinct same-day fills are still preserved.

### RvY / CYld no longer shows blank for Owner-profile holdings
The Holdings single-profile read path now recomputes `current_annual_yield` and `annual_yield_on_cost` from `estim_payment_per_year` on load, matching the aggregate path and restoring Return vs Yield display for affected holdings.

---

## Latest fixes in v1.31.7

### Dividend refresh now respects ex-date eligibility
Refresh-estimated dividends check whether the holding was owned before the current dividend ex-date before adding current-month income or DRIP amounts. Newly purchased holdings no longer receive dividends from payments that were already missed.

### Stale dividend estimates are cleaned up
When a holding is not eligible for the current dividend, the refresh flow removes stale `refresh_estimate` payment rows and clears current-month DRIP artifacts for that holding.

### DRIP replay starts after purchase/import ownership
Broker-managed DRIP estimates replay only eligible imported dividend history after the holding was owned, preserving forward estimates while avoiding historical dividends that belong before the position existed.

### Refresh Prices is coordinated across pages
Refresh Prices now shares a refresh coordinator across Dashboard, Holdings, and NAV Snapshot flows. Duplicate refresh requests wait for the active refresh, imports wait for refreshes to finish, and Dashboard cache is cleared after refresh/import work.

### CEF themed alternatives
CEF better-alternative results now use detected fund themes and sectors so recommendations stay closer to the fund being reviewed.

### Help documentation updated
Help documentation covers refresh coordination, dividend eligibility cleanup, DRIP replay eligibility, and CEF themed alternatives.

---

## Major features from v1.29.0

### Reinvestment Impact
Added a full Reinvestment Impact page for seeing how DRIP changes income, share count, and break-even progress over time.

- Historical analysis with recorded distributions, reconstructed dividend history, cash-only counterfactual income, cumulative income, DRIP share growth, distribution-per-share views, payout-change attribution, notable rate changes, DRIP-off cash panels, and top contributors.
- Projection mode for 1-20 year income/share-count scenarios across Bullish, Neutral, and Bearish assumptions.
- Single-fund break-even panels showing cost-basis recovery and total-return recovery paths.

### New evaluator and research pages
Added CEF, ETF, option-income ETF, and stock buying checklist tools, plus supporting CEF research and comparison pages.

- CEF Buying Checklist Evaluator with premium/discount, distribution quality, liquidity, and risk-adjusted return scoring.
- ETF Buying Checklist Evaluator with yield, expense, liquidity, diversification, momentum, and risk scoring.
- Option-Income ETF Evaluator for covered-call and options-income funds.
- CEF Buying Guide, CEF Information / NAV vs Total Return, CEF vs Income ETF Comparison, and Stock Buying Checklist pages.
- Scan-a-list workflows across the evaluator pages for batch grading.

### Multiple aggregates and dashboard cache improvements
Manage Portfolios supports multiple named aggregate views with their own member lists, inline renaming, and cache clearing when aggregate or Owner membership changes.

---

## Enhancements since v1.29.0

### Reinvestment tracking: estimated vs. actual
The Dashboard separates forward estimate cards from recorded-payment actual cards, including estimated reinvested/not reinvested values, actual current-month reinvestment, and per-account reinvest attribution.

### Reinvestment Impact projection seeds
The Projection tab has one-click seeds for estimated DRIP mix and Actual 3mo reinvestment rate using trailing completed months of recorded payments.

### Categories target allocation workflow
The Categories page has a sticky Target Allocation panel with total target allocation, remaining/over-target percentage, actual vs. target drift, dialog previews, and Owner subaccount target reference.

### Help page refresh
Help documentation and screenshots were refreshed for Dashboard, Reinvestment Impact, Holdings, evaluator pages, brokerage import workflows, and packaged desktop screenshot loading.

---

## Important fixes since v1.29.0

### Dashboard chart backfill handles split-adjusted price history
Backfill History accounts for Yahoo Finance split-adjusted close prices when valuing historical transactions.

### Total Return includes recorded dividend payments
Dashboard and Total Return calculations use recorded `dividend_payments` as a floor for `total_divs_received`, so high-yield accounts with imported payment history no longer show Price Return and Total Return as identical.

### Dashboard chart repair for broker-position portfolios
Repair Chart works for broker-position portfolios and Portfolio Export restores by anchoring reconstruction to current holdings and walking transaction history backward.

### Cost basis toggle refresh
Switching Original cost / Broker adjusted cost invalidates cached data and refreshes Total Return and Safe Withdrawal views.

### Dashboard NAV benchmark override
The NAV benchmark override field can be cleared and saved as empty without snapping the old value back into the input.

### Broker-managed DRIP values
DRIP Shares and Cash Reinvested come from imported `[DRIP]` / reinvestment BUY history for broker-managed accounts, so they survive broker position re-imports.

### Existing accounts self-heal on Holdings load
Installed databases with zero DRIP totals repair visible profiles from saved reinvestment transaction history when Holdings loads.

### Base Shares display after DRIP repair
The Holdings API returns a display-ready Base Shares value calculated from current shares minus recorded DRIP shares.

### E*Trade dividend-history DRIP estimate
For E*Trade accounts without explicit reinvestment BUY lots, DRIP-enabled holdings estimate reinvested cash from imported dividend payment history and convert it into DRIP shares using current price, with average price as a fallback.

### Returns chart date-window alignment
ETF Screen, ETF Comparer, and Stock Comparer returns charts no longer start one period off in certain granularity settings.

### Snowball + broker transaction double-counting
Holdings that exist in both a Snowball import and a broker transaction import are no longer double-counted in position size, cost basis, or income estimates.

---

## Key changes from v1.28.8 and later

### Expanded broker transaction imports
Schwab, E*TRADE, Fidelity, Robinhood, Shear Group, Snowball, and generic transaction workflows have continued to improve, feeding buys, sells, dividends, capital gains, DRIP reinvestments, and transfer-style records into consistent transaction history where supported.

### Combined holdings + transactions export/import
The app supports combined portfolio exports and re-imports with holdings sheets plus a Transactions sheet, making it easier to back up and restore both positions and transaction history together.

### Transaction-derived gains and chart repair
SELL transactions feed realized gain/loss tracking, FIFO lot allocation, and chart/history repair. Repair can rebuild missing portfolio history from transactions while preserving current holdings as the anchor.

### Brokerage position import guardrails
Broker position imports are treated as current snapshots, while transaction-history imports are incremental recordkeeping. Help text and import warnings explain how to avoid partial-history share/count confusion.

---

## Verification

- Backend E*TRADE parser regression tests passed: `py -m unittest backend.test_transaction_import`
- Real E*TRADE CSV and Excel All Transactions files both parsed with matching summaries.
- Frontend production build passed: `npm run build`
- GitHub Actions installer workflow builds both Windows and macOS installers from the release tag.

---

## Builds

Both installers are produced automatically by GitHub Actions when this tag is published:

- **Windows**: `Portfolio.Tracking.Client.Setup.1.31.11.exe` - NSIS installer, x64
- **macOS**: `Portfolio.Tracking.Client-1.31.11.dmg` and `Portfolio.Tracking.Client-1.31.11-arm64.dmg` - Intel (x64) + Apple Silicon (arm64)

**Cumulative Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.28.8...v1.31.11

**Latest Patch Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.31.10...v1.31.11
