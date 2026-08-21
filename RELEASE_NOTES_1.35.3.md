# Portfolio Tracking Client v1.35.3

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Portfolio Performance & Growth

- Combined Growth, Portfolio Growth 2, and Lots into one Growth workspace with **Dollars**, **Vs market**, and **Lots** tabs. Existing `/growth-2` links now open the Dollars tab in the combined screen.
- Reconciled performance calculations across Dashboard, Holdings, Growth, Total Return, and Gains & Losses. Selected-period tracker returns now share one transaction-aware calculation and as-of date, while **Life** consistently reports current open-position cost-basis gain/loss.
- Corrected open-position totals so fully closed positions are excluded from the open-holdings table while their realized history remains part of portfolio-period results. Sold-and-rebought tickers use the current open lot where appropriate.
- Added Daily, Weekly, and Monthly interval controls to Dashboard performance charts.
- Kept Total Return table headers visible while scrolling and restored readable text encoding on Gains & Losses.
- Added security descriptions for closed positions. Missing names are resolved once and cached for future visits.

## Portfolio Tester

- Added transaction-aware **Actual** account history alongside hypothetical target-weight testing, with Growth and Income modes.
- Added an **All my accounts** ticker source for hypothetical portfolios, while excluding rollup profiles to avoid double counting.
- Actual-history tests now adjust the requested start date to the account's first available transaction and clearly explain any date-range adjustment.
- Added guidance explaining Actual vs. Hypothetical and Growth vs. Income comparisons.

## Dividends, Holdings & Ticker Maintenance

- Imported dividend transactions are now the authoritative payments across the Month, Agenda, Dashboard, and Dividend Optimization views, with corrected account scoping and payment-date handling.
- Holding ticker renames now migrate linked transactions, dividend history, categories, DRIP settings, and other ticker-specific records across affected portfolios. Conflicting destination symbols are detected before anything is changed.
- Standardized active-position reads on the canonical holdings source. Positions removed by a complete brokerage snapshot no longer remain visible through legacy holdings data, while their transaction history is preserved.

## Import, Backup & Market Data Reliability

- The single-account Schwab Positions importer now accepts files named like `All-Accounts-Positions-2026-08-21-141808.csv` when the export contains only one account. Files containing multiple account position tables still require the All-Accounts importer.
- Added stable identity checks for equity transactions so re-importing the same brokerage history does not create duplicates.
- Corrected Snowball slash-category imports so labels such as `GROWTH / Growth-Stocks` reliably create and assign the parent and subcategory hierarchy.
- Hardened SQLite backup and restore for live WAL databases, including consistent snapshots and protection from stale journal replay.
- Added persistent market-data caching with stale-data fallback so temporary provider failures do not unnecessarily blank previously collected research, price, or distribution data.

## Action Center & Options Data

- Expanded Action Center follow-ups for option expirations and rolls, NAV erosion and CEF discounts, unconfirmed dividend estimates, stale brokerage imports, ETF closure risk, and other portfolio data checks.
- Added **Refresh Data** directly to Action Center so prices and dividends can be updated without leaving the page. Data-driven alerts remain open until their underlying condition is resolved.
- Added automatic daily near-30-DTE ATM implied-volatility collection for holdings, watchlist names, open option underlyings, and saved scanner tickers. Collection runs in batches without the previous 40-symbol scan limit, allowing IV Rank history to build consistently.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.35.2...v1.35.3
