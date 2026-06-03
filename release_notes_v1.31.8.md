## v1.31.8 - Cumulative Desktop Release Since v1.29.0

**Release date:** June 2, 2026
**Available for:** Windows (.exe installer, x64) and macOS (.dmg, Intel x64 + Apple Silicon arm64)

This release keeps the v1.31.7 cumulative desktop description and adds transaction dedup and yield display fixes from June 2, 2026.

---

## Latest fixes in v1.31.8

### Duplicate transaction imports no longer inflate DRIP totals
Overlapping broker transaction re-imports previously created duplicate BUY/SELL rows because the duplicate check compared price with exact equality. The same fill arrives from two feeds that round price differently (e.g. 20.5425 vs 20.54), so the re-imported copy was not recognized as a duplicate and was inserted again. Because DRIP Shares and Cash Reinvested are lifetime sums of reinvestment buys, this doubled those values for affected holdings. The import dedup in both the portfolio-export and direct-transaction import paths now uses a sub-cent price tolerance so rounding-only differences are caught, while genuinely distinct same-day fills (which differ by far more) are still preserved.

### RvY / CYld no longer shows blank for Owner-profile holdings
The Holdings single-profile read path returned `current_annual_yield` and `annual_yield_on_cost` verbatim from the stored database columns, which were left at zero for some holdings while `estim_payment_per_year` was correctly populated. This caused the Return vs Yield (RvY) column to show — instead of Good or Poor for affected tickers. Both yield fields are now recomputed from `estim_payment_per_year` on every Holdings load, matching the behavior the multi-profile aggregate path already had.

---

## Latest fixes in v1.31.7

### Dividend refresh now respects ex-date eligibility
Refresh-estimated dividends now check whether the holding was owned before the current dividend ex-date before adding current-month income or DRIP amounts. Newly purchased holdings no longer receive dividends from payments that were already missed.

### Stale dividend estimates are cleaned up
When a holding is not eligible for the current dividend, the refresh flow now removes stale `refresh_estimate` payment rows and clears current-month DRIP artifacts for that holding. This prevents phantom dividend income from coming back after closing and reopening the app.

### DRIP replay starts after purchase/import ownership
Broker-managed DRIP estimates now replay only eligible imported dividend history after the holding was owned, preserving forward estimates while avoiding historical dividends that belong before the position existed.

### Refresh Prices is coordinated across pages
Refresh Prices now shares a refresh coordinator across Dashboard, Holdings, and NAV Snapshot flows. Duplicate refresh requests wait for the active refresh, imports wait for refreshes to finish, and Dashboard cache is cleared after refresh/import work so prices and income panels reload together.

### CEF themed alternatives
CEF better-alternative results now use detected fund themes and sectors so recommendations stay closer to the fund being reviewed, including infrastructure, utilities, muni, MLP/midstream, covered-call, REIT, bond, equity, and preferred-stock themes.

### Help documentation updated
The Help files now document the refresh coordination, dividend eligibility cleanup, DRIP replay eligibility, and CEF themed alternatives.

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
Manage Portfolios now supports multiple named aggregate views with their own member lists, inline renaming, and cache clearing when aggregate or Owner membership changes.

---

## Enhancements since v1.29.0

### Reinvestment tracking: estimated vs. actual
The Dashboard now separates forward estimate cards from recorded-payment actual cards:

- Estimated monthly reinvested, not reinvested, and reinvested percent from current DRIP settings.
- Actual current-month reinvested, not reinvested, and reinvested percent from recorded dividend payments.
- Per-account reinvest attribution, so the same ticker can be reinvested in one account and taken as cash in another without collapsing into a single ticker-level flag.

### Reinvestment Impact projection seeds
The Reinvestment Impact Projection tab now has one-click seeds for estimated DRIP mix and Actual 3mo reinvestment rate, using the trailing three completed months of recorded payments.

### Categories target allocation workflow
The Categories page now has a sticky Target Allocation panel showing:

- Total target allocation and remaining/over-target percentage.
- Actual category weight vs. target weight with drift.
- A live total preview inside the New/Edit Category dialog.
- Owner subaccount target reference, including included accounts, account values, subaccount targets, and a weighted Owner target guide.

### Help page refresh
Help documentation and screenshots were refreshed for Dashboard, Reinvestment Impact, Holdings, and the evaluator pages. Packaged desktop builds now load Help screenshots correctly.

---

## Bug fixes since v1.29.0

### Duplicate transaction imports no longer inflate DRIP totals
Fixed in v1.31.8. See above.

### RvY / CYld no longer shows blank for Owner-profile holdings
Fixed in v1.31.8. See above.

### Dashboard chart backfill handles split-adjusted price history
The Dashboard Backfill History repair now accounts for Yahoo Finance split-adjusted close prices when valuing historical transactions. Transaction shares are normalized into today's share basis for dates before later splits or reverse splits, avoiding phantom spikes or drops in historical NAV charts.

### Total Return includes recorded dividend payments
Dashboard and Total Return calculations now use recorded `dividend_payments` as a floor for `total_divs_received`. High-yield accounts with imported dividend payment history no longer show Price Return and Total Return as identical just because the legacy lifetime-dividend field is blank.

### Dashboard chart repair for broker-position portfolios
Repair Chart now works for broker-position portfolios and Portfolio Export restores by anchoring reconstruction to current holdings and walking transaction history backward.

### Cost basis toggle refresh
Switching Original cost / Broker adjusted cost now invalidates cached data and refreshes Total Return and Safe Withdrawal views, matching the other portfolio pages.

### Dashboard NAV benchmark override
The NAV benchmark override field can now be cleared and saved as empty without snapping the old value back into the input.

### Broker-managed DRIP values
DRIP Shares and Cash Reinvested now come from imported `[DRIP]` / reinvestment BUY history for broker-managed accounts, so they survive broker position re-imports.

### Deployed builds include backend fixes
The desktop packaging flow rebuilds the Flask backend before packaging, so installed Windows and macOS builds include the backend fixes verified locally.

### Existing accounts self-heal on Holdings load
Installed databases with zero DRIP totals now repair visible profiles from saved reinvestment transaction history when Holdings loads.

### Base Shares display after DRIP repair
The Holdings API returns a display-ready Base Shares value calculated from current shares minus recorded DRIP shares.

### E*Trade dividend-history DRIP estimate
For E*Trade accounts without explicit reinvestment BUY lots, DRIP-enabled holdings estimate reinvested cash from imported dividend payment history and convert it into DRIP shares using current price, with average price as a fallback.

### Returns chart date-window alignment
ETF Screen, ETF Comparer, and Stock Comparer returns charts no longer start one period off in certain granularity settings.

### Snowball + broker transaction double-counting
Holdings that exist in both a Snowball import and a broker transaction import are no longer double-counted in position size, cost basis, or income estimates.

### Version display
The Help page version display now reports `1.31.8`.

---

## Verification

- Backend regression tests passed: `py -m unittest backend.test_holdings_manual_edits backend.test_holdings_transactions`
- Frontend production build passed: `npm run build`
- GitHub Actions installer workflow builds both Windows and macOS installers from the release tag.

---

## Builds

Both installers are produced automatically by GitHub Actions when this tag is published:

- **Windows**: `Portfolio.Tracking.Client.Setup.1.31.8.exe` - NSIS installer, x64
- **macOS**: `Portfolio.Tracking.Client-1.31.8.dmg` and `Portfolio.Tracking.Client-1.31.8-arm64.dmg` - Intel (x64) + Apple Silicon (arm64)

**Cumulative Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.29.0...v1.31.8

**Latest Patch Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.31.7...v1.31.8
