# Portfolio Tracking Client v1.36.1

This release adds the changes made since the September 22 v1.36.0 deployment to the existing portfolio tracking, dividend, broker-import, research, and option-scanner improvements described below.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## New since v1.36.0

### Alpha, Beta, and Account Performance

- Added per-ticker Alpha alongside Beta in Dashboard Holdings, ETF Comparer, and Security Research. Both metrics now use the same best-fit benchmark for each ticker, and invalid price bars are rejected instead of producing misleading risk figures.
- Made risk windows visible and comparable: ETF Comparer labels its metrics with the charted or custom range, while Security Research has a 1M-to-MAX Risk window selector and shows the measured dates.
- Aligned Alpha calculations across screens on the same dividend-adjusted total-return series, so equivalent ticker, benchmark, and date windows produce matching results. The ETF Comparer's chart and reinvestment controls retain their existing behavior.
- Added whole-account Alpha and Beta to the Dashboard when complete account values and external-flow coverage support a trustworthy calculation. The card explains missing coverage or unexplained changes instead of showing an unreliable number.

### Broker Activity and Transfers

- Broker imports now retain deposits, withdrawals, transfers, income, expenses, and ambiguous account activity as signed, deduplicated records. Trade and dividend ledgers remain separate. Clear, reset, delete, and ticker-rename flows include the new activity records.
- Added **Manage Holdings > Deposits & Withdrawals** to review flows, enter deposits, withdrawals, and share transfers manually, and mark a period complete when there were no movements. Generic transaction imports accept these activity types, and combined Holdings + Transactions exports preserve activity and coverage on round-trip.
- Updated import previews, templates, and help to explain account activity and the information needed for whole-account Alpha.

### Valuation and Total Return

- When Yahoo chart bars lag a market session, refresh now requests missing holdings prices in a batch and reports stale prices. Account Change compares the same two sessions for every holding and withholds an incomplete figure when too much of the portfolio is unpriced.
- Lifetime total return now shows the dollar gain or loss beside its percentage, including recorded distributions, across Dashboard, Growth, and Total Return.
- Restored the Total Return charts, including the 1 Year ticker chart, by using the app's bundled Plotly version consistently.

## Also included from v1.36.0

### Portfolio and Performance

- Consolidated Growth, Portfolio Growth 2, and Lots into one clearer Growth workspace, with improved return alignment, open-lot scoping, and broker-account reconciliation.
- Added dashboard chart interval controls, current portfolio value, and high/low markers; made Split View easier to use with synchronized ranges and account selection.
- Added customizable columns across Dashboard, Holdings, and Gains & Losses, including grades, unrealized gain/loss, price return, yield on cost, and clearer lifetime-profit context.
- Improved Total Return reconciliation, cash coverage, cash inclusion explanations, and protection against phantom opening lots and duplicate distribution accounting.
- Added portfolio selector preferences, optional Owner rollups, safer portfolio deletion, and clearer account-cash entry, dating, and drift estimates.

### Dividend Tracking and Cash Flow

- Added manual ex-dividend and pay-date overrides, unified projected pay dates across the calendar, and expanded calendar coverage for money-market, pinned-cadence, and XFUNDS funds.
- Added current distribution-rate and distribution-frequency details to Security Research; improved dividend frequency corrections throughout the calendar.
- Added a Daily / Weekly / Monthly Payments ledger, cash-flow plan backup and restore, retirement-readiness persistence, and clearer Cash Runway documentation.
- Preserved broker-confirmed dividend amounts exactly as imported and prevented imported dividends from replacing refresh estimates.
- Fixed Dividend Analysis database lock contention so the page can load reliably during concurrent work.

### Broker Imports and Transaction Ledger

- Added Schwab, Fidelity, and Shear Group all-accounts imports, plus Interactive Brokers positions and transaction imports.
- Added broker import guidance, remembered default formats, account-aware import routing, a wider format selector, and safeguards for clearing/re-importing transaction history.
- Added an import tab for combined Positions + Transactions export workbooks, with scope choices for importing positions, transactions, or both.
- Added inline CRUD controls, same-day ordering arrows, and help in the Holdings transaction ledger; fixed horizontal scrolling and transaction-history clarity.
- Corrected Fidelity and E*TRADE sample templates, cash handling, fee signs, dividend corrections, and invalid unpriced trade handling. Schwab, Robinhood, Shear Group, Interactive Brokers, and generic imports now receive the same validation coverage.

### Research, Analytics, and Dashboard

- Completed unified ticker research, added security descriptions and AUM to Watchlist, and expanded issuer distribution parsing and XFUNDS coverage.
- Added sector exposure and a growth treemap, yield-on-cost charts and comparison support, actual-price modes, and better comparer baselines.
- Improved NAV erosion analysis, including recovery scoring, mapped benchmark fallbacks, robust quote-outage handling, and Yahoo rate-limit coordination.
- Improved CEF checklist grading, peer comparison, and links; made dashboard grades and portfolio analytics consistent.

### Options and Strategy Tools

- Introduced the unified General Option Scanner with detailed risk probabilities, IV/RV metrics, strategy-specific quality gates, field references, and DTE/scenario filters.
- Added put and call condor scanners, asymmetrical iron condor 14-day and monthly scans, profit-capture odds across scanners, and an option probability calculator.
- Made payoff and probability views use one coherent model, improved thinkorswim-style risk graphs, added SMA 50/200 overlays, and accelerated common scans.
- Improved price-scenario tables, credit floors, loss odds, stale-data reporting, and Road Trip nearest-match results.

### Reliability and Packaging

- Hardened backups, market-data caching, ticker mapping, split handling, and refresh behavior across tracking and imports.
- Signed all bundled Windows backend binaries for Windows Code Integrity / Smart App Control compatibility.
- Added regression coverage for the broker imports, transaction ledger, dividend ledger, account cash, and packaged runtime flows.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.36.0...v1.36.1

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.33.7...v1.36.1
