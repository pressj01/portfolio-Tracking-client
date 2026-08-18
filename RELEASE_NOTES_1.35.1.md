# Portfolio Tracking Client v1.35.1

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Import

- The Brokerage & Export Import tab now includes an expandable guide explaining the recommended order for brokerage files: import a complete Positions export first to establish current holdings, then import Transactions for account history, dividends, DRIPs, and realized gains. It also explains duplicate handling, why a complete transaction history is necessary when no positions snapshot exists, and how each file type affects current share counts.
- The Brokerage & Export Import tab can now remember a default file format: pin one with "Set as default" and it opens there on every visit. Until a default is pinned, the format dropdown rests on a neutral placeholder instead of silently defaulting to Snowball Transactions.
- Added FIZY (XFUNDS) provider coverage for security research and diversification look-through.
- Updated the Manage Portfolios and Import help pages and screenshots to match the new selector-preferences UI and documented the remembered default-format behavior.

## Fund Evaluator Scanners

- The "Scan a List" tab on the Non-Income ETF, Option-Income ETF, and Stock Buying Checklist evaluators now scans only the currently selected account's holdings. It previously always scanned the Owner rollup's combined holdings regardless of which account was selected. The watchlist source is unaffected — it is one list shared by every account, by design.
- Scan-result tables now pin their column headers in place while scrolling through long result lists.
- Added a collapsible **"How the verdict is reached"** explainer to all three checklist pages, covering how each composite score is built and the exact verdict-band thresholds — including an explicit note that any option-income ETF under 1 year old scores an automatic fail on Track Record, independent of its recent performance.

## Portfolio Selector & Navigation

- Manage Portfolios gained selector preferences: show or hide individual accounts and aggregates from the top-nav portfolio dropdown, and reorder them with arrow controls, without deleting anything.
- Admins can now reorder the app's navigation from a new Menu Control page — the top nav, items within a dropdown, and Analysis groups vs. items within a group — with drag/arrow reordering and Save / Discard / Restore Defaults.

## Comparer & Analysis Charts

- Added an **Actual Price** return mode to ETF Comparer, Stock Comparer, and the Stock/ETF Analysis Returns tab, plotting each ticker's real dollar share price instead of an indexed relative return. Price Only remains a relative, period-start-indexed return.
- End-of-line return labels on log-scale charts now align correctly with the plotted line, using one shared positioning helper across all three comparer screens.

## Option Scanners

- The General Option Scanner adds 30-DTE option-skew history (put skew, call skew, and the combined reading), ranked against each ticker's own trailing-year observations, and unifies the expiration risk/probability math so the one-leg income scanners report the same payoff extrema as the multi-leg scanners.
- Scanners now support expirations from same-day (0 DTE) through 3-year LEAPS, and scenario/probability calculations factor in ATR, 30-day realized volatility, analyst target price, and the 52-week range.
- The General Option Scanner's header now credits and links to Option Samurai, the workflow's inspiration.

## Watchlist

- Added an AUM column, fetched alongside the existing fund-description lookup.
- Added a Description column showing each security's name — pulled from your holdings data first, with a live lookup as a fallback — sortable like the other columns.

## Dashboard

- The headline metrics now show clearer tooltips explaining exactly what each number measures (Price Return vs. Tracker Total Return) and over what period, and flagged Action Center items are labeled for screen readers.

## Fixes

- The Holdings page no longer waits on a live dividend-calendar provider lookup to load — it reuses the cached calendar resolution instead, so external data-source hiccups can no longer stall Holdings.
- Removed a duplicate price-normalization step on the ETF Screen comparer data path.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.35.0...v1.35.1
