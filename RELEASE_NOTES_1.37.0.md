# Portfolio Tracking Client v1.37.0

This release adds the changes made since the September 25 v1.36.3 deployment: a new ETF Overlap page, named watchlists, adjustable grading and signal formulas, a hybrid Tiingo data provider, license activation, and the dividend, cost-basis and chart fixes described below.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## New since v1.36.3

### ETF Overlap (new page)

- **Analysis → Research & Compare → ETF Overlap** compares two funds by weighted holdings overlap: for every holding both funds own, the smaller of the two weights is counted. Two funds that share most of their tickers can still be different investments, and this shows by how much.
- The result shows the overlap by weight, how many holdings are shared or held by only one fund, and how much of each fund sits in companies the other also holds.
- A sector drift chart shows which fund is heavier in each sector; hover a sector for both funds' weights and the difference.
- Overweight and underweight lists name the holdings where the two funds differ most.
- The holdings table has Shared / Only A / Only B tabs with each holding's sector and industry, plus search, a minimum-weight filter, sector and industry filters, and sortable columns.
- Holdings come from the same look-through data as the Diversification page. Share classes spelled differently by different issuers (BRK.B, BRK/B, BRK-B) are matched as one holding, a fund that wraps another ETF is compared on what that ETF holds, and cash and option positions are left out of the comparison.
- When a fund publishes only its largest positions, the page says how much is disclosed and that the overlap is a minimum. A single stock, a money-market fund, or a fund holding only Treasury bills and options gets a plain explanation instead of a result.
- Sector and industry are looked up for each fund's 60 largest holdings the first time it is compared, and fill in a few seconds later.

### Watchlists

- The technical watchlist is replaced by named lists, so different sets of tickers can be kept and switched between.
- Watchlist price history loads in parallel and in one request, and a list is no longer saved before the stored one has finished loading.

### Grading and Signal Formulas

- The grading and Buy / Sell signal formulas are adjustable under Settings, and the saved formula is applied to portfolio and fund grades.
- Settings and Help explain every input to each grading formula.
- Scores and signals are described throughout as educational readings, not trade instructions.

### Market Data

- Added a hybrid Tiingo data provider, with a link to Tiingo signup from Settings and dismissible notices.
- Tiingo unadjusted prices and dividends are restated across splits, so a split no longer looks like a crash.
- The Macro dashboard requires your own validated FRED API key.

### Dividends and Income

- Dividends are paid only on shares held before the ex-date; shares bought on or after it roll to the next distribution.
- An extra distribution is counted with its own period instead of as another regular payment.
- Dividend analysis cash now matches the Dashboard, and at-risk funds are explained.
- The Dividend Calculator has a side-by-side goal-tracking layout.
- The Blended Yield Calculator has collapsible on-page help.

### Cost Basis and Performance

- The original cost basis is carried with the position instead of being frozen at an earlier share count.
- Lifetime profit includes realized profit and loss.
- The NAV chart's Total Return line is adjusted for deposits and withdrawals and follows the live account value.

### Options

- Price slices on the risk graph can be dragged, and the probability range follows the thinkorswim expected-move convention.
- The scanner chart and Max profit show the market credit you would receive; costs are applied only in expected value and ranking.

### Licensing

- Added Gumroad license activation. A purchased license key is entered once and re-checked weekly, with a 14-day offline grace period.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.36.3...v1.37.0
