# Portfolio Tracking Client v1.35.5

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Interactive Brokers Import

- Added Interactive Brokers as a supported broker: import an IBKR Activity Statement's positions and transaction history the same way other brokers work, including CAD conversion, preferred-share tickers, and skipped option contracts. Interactive Brokers is now available throughout Import, Manage Portfolios, option-trade import, and Help. Month-end snapshots, nearby same-amount dividends, lifetime income from closed positions, and ticker research all stay in sync when a purchase date is missing from the statement.

## Grades and NAV Scores

- Fixed a class of holdings showing no grade and no NAV erosion score at all. A quote-feed rate limit was being cached as a permanent verdict rather than a temporary outage, so a brief Yahoo throttle could pin blank grades across every account for the full 30-minute cache window. Outages are now detected correctly and are never cached over a good result, so the next load retries instead of repeating the same blank cards.
- Added broker-to-Yahoo symbol resolution so holdings using a broker-specific spelling can be graded. Interactive Brokers exports several Canadian listings and preferred shares under symbols Yahoo doesn't recognize; Settings now has a **Broker Symbol Mapping** panel that scans your holdings for anything Yahoo can't price, resolves what it can, and lets you fill in the rest by hand.
- Fixed a display bug where a holding could show a real letter grade in the table while a banner said Yahoo had no listing for it and it "cannot be graded" — both were true at different moments, and the older of the two was left showing after the newer one changed.
- Fixed NAV erosion scores silently defaulting to a falsely reassuring "Low" verdict when only the benchmark's price history failed to download; a fund is no longer scored against itself when its benchmark data goes missing.
- NAV erosion benchmark downloads are now shared across every holding that uses the same benchmark instead of being re-fetched once per holding, which was itself a source of the rate-limit outages above.

## NAV Erosion Back-Test

- A benchmark with no available price history (a typo, or a symbol Yahoo doesn't carry) no longer aborts the entire NAV erosion back-test. The tool now falls back to the fund's mapped default benchmark, and the raw NAV numbers, chart, and distributions that never depended on a benchmark are no longer blocked by one that failed.

## Dividends and Distributions

- Fidelity payouts that are split across a dividend line, a capital-gain line, and a return-of-capital line on the same day are now summed into one payment instead of only the ordinary dividend portion being recorded. A fuller re-import replaces a partial amount saved before this fix.
- Added automatic issuer-website distribution parsers so newer or less-common funds can pick up official ex-date, pay-date, and per-share figures without waiting on a manual data source to catch up.
- Fixed an OTF (Blue Owl Technology Finance) forward dividend schedule issue that could show an incorrect upcoming payment.

## Portfolio Analytics

- Portfolio Analytics 1-month returns and period grades now match the Dashboard's numbers, using the same calendar lookback, window-scaled observation floor, and equity-only price series.

## Option Scanners

- Unbalanced Butterfly and related butterfly-family scans are significantly faster: the probability schedule, profit-capture panel, and price-scenario table are now built only for the winning structure instead of every structure considered during the scan.
- Fixed the profit-capture panel showing 0.0% at early checkpoints of a long-dated butterfly. A structure that can only reach a small fraction of its max profit far from expiration was technically correct but unhelpful; the panel now reports against what the structure can actually reach at that point in time.
- Added a monthly price-scenario table showing hold-it-out P/L at several prices.

## Fixes

- Fixed deleting a portfolio with linked records: a deterministic alphabetical delete order could violate foreign-key constraints on a populated database. Deletion now follows the live foreign-key graph, removing child rows before their parents.
- Fixed the Grd (grade) column sort on the Holdings screen sorting grades as text instead of by rank.
- Fixed the Split View page menu showing duplicate chart entries.
- Moved the Share of Portfolio column next to Subcategory on the General holdings view.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.35.4...v1.35.5
