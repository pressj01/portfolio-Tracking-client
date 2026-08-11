# Portfolio Tracking Client v1.33.14

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

This release makes the portfolio-performance screens agree on one transaction-aware return calculation. It also adds a broker-reconciliation figure, fixes historical-share replay errors, improves shared date-range behavior, and refreshes the in-app Help with current controls and screenshots.

## Accurate Tracker Returns Across the App

Growth & Performance, Portfolio Growth 2, Total Return, and Gains & Losses now use the same transaction-aware calculation when the account, holdings scope, and shared date range are the same.

- Buys, sells, deposits, and withdrawals change what is being measured; they are no longer treated as investment gain or loss.
- Portfolio Growth 2 now replays the shares actually held on each date instead of projecting today&apos;s share count backward into history.
- Owner portfolios correctly replay the transactions from their included source accounts, keeping opening and ending values aligned with the underlying holdings.
- A same-day sell and rebuy no longer leaves phantom shares in the historical replay and inflates period-end value.
- Return vs. Yield now scales annual yield to the selected window, so short periods no longer label ordinary dividend holdings as Poor by construction.

## Clearer Reconciliation and Position Views

- Total Return and Gains & Losses now show an Account Value card when reconciliation data exists. It adds recorded cash and open-option marks to the holdings-only value, providing the figure to compare with a broker&apos;s net liquidating value.
- Portfolio Growth 2 surfaces the same reconciliation below End Value. Options are a present-day mark only; they do not alter historical charts or tracker returns.
- Total Return includes open, closed, and combined position views. Realized sales are grouped by ticker with expandable individual lots.
- Gains & Losses category filters now apply consistently to unrealized, realized, and combined positions, including closed sales from source accounts in the Owner view.

## Shared Ranges, Charts, and Help

- The performance pages share 1D, 7D, 1M, 3M, 6M, YTD, 1Y, 5Y, All, and Custom ranges. Calendar ranges use the market close on or before the requested start, while 1D uses the preceding trading session.
- Growth risk metrics, benchmark comparisons, ticker bars, heatmaps, and return cards now use their labeled window consistently.
- Portfolio Growth 2 removes obsolete profit-source controls and documents the current price-return, distributions, and tracker-total-return views.
- Help for Growth & Performance, Portfolio Growth 2, Total Return, and Gains & Losses now explains the active filters, cards, chart/bubble meanings, table views, reconciliation behavior, and return modes in detail.
- Those Help sections now use fresh screenshots from the current desktop interface.

## Builds

GitHub Actions produces the following installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.33.13...v1.33.14
