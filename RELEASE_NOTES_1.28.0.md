# Portfolio Tracking Client 1.28.0 Release Notes

Release date: May 25, 2026

## Overview

Version 1.28.0 packages the recent tax, dividend-income, market-calendar, and dividend-calculator improvements into a new deployable release for Windows and macOS. The app version was bumped from 1.27.0 to 1.28.0.

## Blended Yield Calculator

- Added all 50 U.S. states to the blended-yield state selector.
- Added 2025 state income tax defaults for all states, including flat-rate, no-income-tax, and graduated-rate states.
- Kept Washington ordinary income at 0% because the 2025 Tax Foundation table lists Washington as capital-gains-only for this context.
- Generalized bracket persistence so saved federal, LTCG, and state bracket overrides merge dynamically by state code.
- Expanded the tax bracket editor so every state can be reviewed and adjusted without hard-coded state sections.
- Preserved Pennsylvania's special all-muni state exemption behavior.
- Added CHPY to the built-in fund database.
- Improved ticker lookup behavior so the blended-yield page can use the backend lookup endpoint and infer common tax types for Treasury, municipal, and YieldMax-style funds.

## Dividend Calculator

- Added portfolio import support so a user can load many current holdings into the dividend calculator at once.
- Improved ticker lookup so imported portfolio holdings use each holding's actual quantity and current price when available.
- Added support for return-of-capital assumptions, DRIP percentage, tax-rate assumptions, and per-ticker payout frequency in combined calculations.
- Added richer combined portfolio projections, including aggregate results and per-ticker final values.
- Fixed the large-portfolio layout so dozens of selected tickers no longer stretch the action buttons into oversized blocks.
- Added a bounded, scrollable ticker-chip panel for large portfolios.
- Added a compact action-button grid for Add Ticker, From Portfolio, Calculate/Recalculate, and Reset.
- Shortened the combined projection summary so it shows a concise ticker preview with a "+N more" count instead of listing every ticker inline.
- Added responsive behavior for tablet and mobile widths.

## Dividend History

- Fixed refresh-only accounts that had only current-month `refresh_estimate` rows in `dividend_payments`.
- When an account has refresh-only payments and no monthly payout history, the monthly dividend-history chart now backfills prior months from holding-level dividend estimates.
- The current refresh month still uses the latest refresh payment data when available.
- Yearly refresh-only views now use holding-level YTD totals instead of showing only the current refresh rows.
- This prevents large accounts from collapsing to a single "May '26 partial" point in the dividend-history chart.

## Dividend Comparer, ETF Research, And Security Research

- Added distribution percentage views to the shared Distribution History chart used by the Dividend Comparer/Stock Comparer, ETF Comparer, and Security Research pages.
- Added a Monthly Yield % mode so each distribution can be viewed as a percentage of the security price for that distribution period.
- Added an Annual Yield % mode so monthly distribution percentages can be annualized for easier comparison across funds and securities.
- Kept the original dollar distribution view, allowing users to switch between cash amounts, per-period yield percentages, and annualized yield percentages.
- Added smarter distribution-period labeling so the chart can label monthly and quarterly distribution histories appropriately.
- Updated help content for the comparer and research pages so the new distribution percentage modes are documented.

## Macro Regime Dashboard

- Added the Macro Regime Dashboard route and navigation entry for macro conditions, portfolio exposure, rebalancing tilts, income benchmarking, classification overrides, and regime quadrant analysis.
- Added macro condition APIs that pull market proxy data, cache macro conditions, classify the current environment, and surface active macro components such as inflation, rates, oil, volatility, dollar, and credit-spread signals.
- Added portfolio exposure analysis that classifies holdings by macro sensitivity, scores favorable/neutral/unfavorable positioning, and summarizes value exposure by sensitivity category.
- Added macro rebalancing tilt suggestions that identify overweight/underweight sensitivity areas and produce holding-level action guidance.
- Added an income benchmark view that compares portfolio income allocation against target buckets, including covered call, BDC, CEF, REIT, preferred stock, dividend growth, commodities/gold, and fixed-income categories.
- Added per-profile macro classification overrides so holdings can be manually tagged, excluded from macro analysis, or reverted back to automatic classification.
- Added regime quadrant analysis using FRED economic indicators and market-proxy transition modeling, including current quadrant classification, transition probabilities, forward projections, and asset-class performance guidance.
- Added help content for the Macro Regime Dashboard, including screenshots and explanations for all six tabs.

## Cost Basis Mode

- Added an app-level cost basis selector so users can view portfolio data using either Original cost or Adjusted cost.
- Original cost keeps the portfolio view anchored to the original transaction-derived basis when available.
- Adjusted cost uses broker-adjusted basis fields when available, which helps compare holdings after broker-side cost-basis adjustments.
- The selected basis mode is included in portfolio API requests and is used by affected dashboard, holdings, gains/losses, yield-on-cost, gain/loss, and invested-value calculations.
- The selected basis mode is saved locally so the app keeps the user's preferred Original cost or Adjusted cost view between sessions.

## Portfolio Export And Restore

- Added the ability to export portfolio positions and transaction history together in one combined workbook.
- The combined export includes holdings sheets plus a Transactions sheet so positions and transaction records can be backed up together.
- Added support for re-importing the combined portfolio export through the Portfolio Export (Holdings + Transactions) import format.
- Re-importing the combined workbook restores holdings first, then imports transaction history for recordkeeping while keeping the restored holdings in control of current position values.
- Aggregate exports preserve one holdings sheet per source portfolio and include a shared Transactions sheet for the exported accounts.
- Duplicate transaction detection helps avoid re-adding the same imported transaction records when restoring from an export.
- Help content was updated to explain how to export holdings with transactions and how to re-import the combined workbook later.

## Dashboard Equity Curve

- Added a Portfolio Value Over Time equity-curve chart to the Dashboard.
- The chart tracks portfolio value from recorded NAV snapshots so users can see how the active portfolio changes over time.
- Added a Record NAV workflow from the Dashboard so users can capture the current portfolio value as a new equity-curve data point.
- The chart supports single-point and multi-point histories, drawing the equity curve once at least two snapshots are available.
- The dashboard help content now explains how the equity curve works and how NAV snapshots drive the chart.

## Market Calendar And Dashboard

- Added a market calendar helper for NYSE trading-day detection and closure reasons.
- Added tests for the market calendar helper.
- Updated backend/dashboard behavior to use market-calendar awareness when deciding trading-day related states.

## Help And Data Quality

- Updated help routing/content for the affected pages.
- Improved handling for dividend and return-vs-yield table data in recent changes that are included in this version.
- Preserved existing app warnings for external market-data failures such as unavailable Yahoo symbols; those do not block the package build.

## Verification

- `npm run build` passes.
- `py -m py_compile backend/app.py` passes.
- Dividend-history monthly endpoint returns a multi-month series rather than a single current-month point.
- Dividend Calculator was manually checked with a large account loaded with 66 selected tickers.
- Distribution History percentage modes were verified across the comparer/research chart implementation.
- Macro Regime Dashboard endpoints and tabs were reviewed for release-note coverage.
- Cost basis mode coverage was reviewed across the shared profile query string and affected portfolio pages.
- Combined positions and transactions export/import coverage was reviewed in the export/import workflow and release package notes.
- Dashboard equity-curve coverage was reviewed in the Dashboard and help documentation.

## Deployment Artifacts

The deployment packages for this version are:

- `release/PortfolioTrackingClient-Win-1.28.0.zip`
- `release/PortfolioTrackingClient-Mac-1.28.0.zip`

Each ZIP contains the built React frontend, Flask backend source, Electron launcher, provider seed database, and platform-specific setup/start scripts.
