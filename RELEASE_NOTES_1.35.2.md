# Portfolio Tracking Client v1.35.2

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Import

- Added a Schwab All-Accounts positions import: one export file updates every account in a single pass. Each account block is matched to its own portfolio automatically (by masked account number, then by name), with the option to re-point or create a portfolio per account and choose which accounts an import actually updates. Confirmed routing is remembered for next time.
- Dividend amounts and payment dates for newer XFUNDS-tracked funds like DRMY and FIZY now come from XFUNDS instead of yfinance, which has no usable history for very new funds, and the Holdings table now shows those dates and amounts as soon as they're published — even before the fund's first confirmed payment — instead of waiting on Yahoo or the issuer amount table to catch up.
- The Brokerage & Export Import tab now includes an expandable guide explaining the recommended order for brokerage files: import a complete Positions export first to establish current holdings, then import Transactions for account history, dividends, DRIPs, and realized gains. It also explains duplicate handling, why a complete transaction history is necessary when no positions snapshot exists, and how each file type affects current share counts.
- The Brokerage & Export Import tab can now remember a default file format: pin one with "Set as default" and it opens there on every visit. Until a default is pinned, the format dropdown rests on a neutral placeholder instead of silently defaulting to Snowball Transactions.
- Added FIZY (XFUNDS) provider coverage for security research and diversification look-through.
- Updated the Manage Portfolios and Import help pages and screenshots to match the new selector-preferences UI and documented the remembered default-format behavior.

## Option Scanners

- Every option scanner, and the General Scanner's risk graph, now reports profit-capture odds for each management target: the probability of being at or above that P/L at expiration, and separately the probability of ever reaching it earlier — the reading that matters for a resting GTC close. The accompanying help text explains why the two numbers routinely disagree and why "by expiration" can exceed the panel's overall success probability.
- The General Option Scanner adds 30-DTE option-skew history (put skew, call skew, and the combined reading), ranked against each ticker's own trailing-year observations, and unifies the expiration risk/probability math so the one-leg income scanners report the same payoff extrema as the multi-leg scanners.
- Scanners now support expirations from same-day (0 DTE) through 3-year LEAPS, and scenario/probability calculations factor in ATR, 30-day realized volatility, analyst target price, and the 52-week range.
- The General Option Scanner's header now credits and links to Option Samurai, the workflow's inspiration.

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

## Watchlist

- Added an AUM column, fetched alongside the existing fund-description lookup.
- Added a Description column showing each security's name — pulled from your holdings data first, with a live lookup as a fallback — sortable like the other columns.

## Dashboard

- The headline metrics now show clearer tooltips explaining exactly what each number measures (Price Return vs. Tracker Total Return) and over what period, and flagged Action Center items are labeled for screen readers.

## Fixes

- Growth, Total Return, Growth 2, and the Dashboard tracker no longer compound a sold-and-rebought ticker's return from the first-ever purchase. They now replay from the current open lot's purchase date and hide unrealized gain on lots that have already been sold, matching Gains & Losses.
- The Dashboard holdings table's horizontal scroll now snaps to column boundaries instead of stopping mid-column, so the Ex-Div column (and others past the frozen block) can no longer show a sliced-off leading digit. Description cells also get a title tooltip so a clipped value can be read in full.
- The Holdings page no longer waits on a live dividend-calendar provider lookup to load — it reuses the cached calendar resolution instead, so external data-source hiccups can no longer stall Holdings.
- Removed a duplicate price-normalization step on the ETF Screen comparer data path.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.35.1...v1.35.2
