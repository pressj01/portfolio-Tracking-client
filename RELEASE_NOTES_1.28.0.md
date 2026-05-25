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

## Deployment Artifacts

The deployment packages for this version are:

- `release/PortfolioTrackingClient-Win-1.28.0.zip`
- `release/PortfolioTrackingClient-Mac-1.28.0.zip`

Each ZIP contains the built React frontend, Flask backend source, Electron launcher, provider seed database, and platform-specific setup/start scripts.
