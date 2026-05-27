# Release Notes - v1.28.8

Release date: May 26, 2026

## Transaction Import and Portfolio History Fixes

### Shear Group Imports and Snowball History Layering
Added Shear Group as a broker source and import format, with CSV and Excel support for Positions and Activity files. Shear Group activity imports now feed buys, sells, dividends, capital gains, and dividend reinvestments into the same transaction path used by Gains/Losses. Snowball transaction history can now be layered onto existing Schwab, E*TRADE, Fidelity, Shear Group, Generic, and Other/Manual portfolios without replacing broker-imported current positions.

### Realized Gain/Loss - Closed Positions Fixed
Fixed a bug where the basis-refresh function exited early when a ticker's current quantity was zero, causing all closed positions to show $0 realized gain regardless of the actual buy/sell prices. The FIFO lot-matching engine now correctly processes all SELL transactions and computes realized gains even when no current holding remains.

### Holdings Purchase Date Derivation
The Holdings page no longer shows a blank Purchase Date for positions imported via transaction history. The basis-refresh pass now derives the purchase date from the earliest BUY transaction on file and writes it to the holding record, using COALESCE to avoid overwriting dates that were already set by a prior import.

### Portfolio Value Over Time - Backfill History
Added a **Backfill History** button to the Dashboard that retroactively populates the Portfolio Value Over Time chart. Clicking it replays all BUY/SELL transactions against yfinance historical closing prices, calculates daily portfolio value on each NYSE trading day, and inserts the results into the NAV history table. For portfolios with transaction history going back several years, this can add hundreds of data points in a single click.

### Database Backup Management
Added a **Database Backups** panel in Settings that lists every backup file with its timestamp, size, and type (auto vs. pre-operation). Each row includes a Delete button so old or unwanted backups can be removed directly from the UI. The panel also shows the backup directory path for manual access.

### Import Diagnostics - Basis Mismatch Ticker Names
Import success messages now include the actual ticker symbols when holdings are skipped due to a share-quantity mismatch between transaction history and the imported positions file. Previously the message only showed a count; it now reads, for example: "4 tickers skipped because transaction shares did not match (NVDA, AMZN, BRKB, CODIPRB)."

## Deployment Artifacts

- `PortfolioTrackingClient-Win-1.28.8.zip`
- `PortfolioTrackingClient-Mac-1.28.8.zip`

The ZIP packages contain the built React frontend, Flask backend source, Electron launcher, provider seed database, and platform-specific setup/start scripts.

---

## Enhancement Added in v1.28.7

- Added Dividend Calculator contribution allocation modes so annual investments can be split equally, weighted by current value, or customized per ticker by dollar amount or percentage for both portfolio-loaded holdings and manually selected ETFs.

## Enhancement Added in v1.28.6

- Enhanced the Charles Schwab Positions importer to accept total Cost Basis, Cost/Share, or both. When both are present, total Cost Basis is used as the authoritative invested amount and Cost/Share is derived from it.

## Fix Added in v1.28.5

- Fixed the Dividend Calculator result summary so Current Portfolio Value/Starting Wealth shows the actual starting portfolio value instead of adding scheduled future annual investment contributions.

## Fixes Added Since v1.28.3

- Fixed the dividend calculator's Initial Investment Per Ticker number inputs so users can freely edit, replace, and backspace amounts without the field snapping back to a formatted value mid-entry.
- The Calculate button now stays actionable before a ticker is loaded. If a ticker is typed, Calculate loads it and runs the projection; if no ticker is present, the page shows a clear prompt instead of silently disabling the action.
- Fixed the stale-results comparison so the Needs recalculation badge no longer appears immediately after a fresh calculation.
- Added a Yield Basis selector for each calculator ticker, including current run-rate, TTM paid, provider run-rate/provider rate when available, Yahoo quote, and custom manual yield assumptions.
- High-distribution income funds now default to safer current/provider run-rate assumptions when available instead of silently using trailing 12-month distributions as the only yield input.
- ULTY/YieldMax lookups now expose the provider run-rate alongside TTM and Yahoo quote yield choices, and default to the provider/current run-rate path with a conservative return-of-capital assumption.
- Legacy or stale lookup responses are normalized in the UI so high-yield rows are labeled as estimated yield assumptions and receive a conservative ROC default instead of appearing as Custom yield with 0% ROC.
- Improved the Total Return Breakdown chart so the Cumulative Dividends line remains visible when it overlaps with the Annual Income trace.
- Changed the Shares Over Time chart to use compact per-point hover labels so many-ticker portfolios no longer clip or hide tooltip details.

---

## v1.28.4 - Dividend Calculator and Basis Mode Fixes

This release combines the dividend-calculator fixes with the existing release-note content so the full deployment inventory is visible in one place.

### Dividend Calculator - Projection Accuracy

- Fixed whole-portfolio dividend projections for high-yield option-income portfolios, including an account example where a $25,343 starting portfolio could incorrectly project into multi-million-dollar results.
- KQQQ and other funds with short or noisy dividend histories no longer seed unrealistic default dividend-growth rates, such as the prior 153% annual growth estimate.
- Portfolio-imported holdings now prefer the account's stored current income/yield data when available, so the calculator starts from the portfolio's actual income profile instead of relying only on live lookup estimates.
- Return of Capital now affects modeled NAV during projection, not just taxes, preventing distributions from being counted as both reinvestable income and unchanged fund value.
- High-yield imported portfolio rows receive conservative default ROC assumptions that users can still edit per ticker.
- Large result values now format compactly as M/B/T or scientific notation instead of overflowing cards and tables.
- Invalid runaway values such as Infinity now render safely instead of breaking the result display.
- Per-ticker input fields now display practical precision:
  - Money and stock prices: 2 decimals
  - Shares: 2 decimals
  - Yields, growth, ROC, tax, and DRIP assumptions: 2 decimals
  - Annual contributions: whole dollars
- Result cards and the total return header now wrap long values cleanly.

### Dividend Calculator - Portfolio Source Awareness

- When loading tickers from the portfolio, the Calculation Settings card now shows a read-only **Portfolio Value** summary, such as "$25,343 across 21 tickers", instead of the misleading "Initial Investment Per Ticker" input.
- Per-ticker row cards label the amount as **Current Value** for portfolio-sourced tickers, distinguishing them from manually entered tickers that show "Initial Investment."
- When both portfolio and manual tickers are loaded, the global field is relabeled to "Initial Investment (manual tickers only)" with a note showing the portfolio total.
- Changing the global initial investment no longer silently overwrites portfolio-sourced rows; only manual tickers are affected.
- The hero summary line and starting-wealth result stat update dynamically based on whether tickers come from the portfolio.

### Dividend Calculator - Per-Ticker Annual Contributions

- Added an **Annual Contribution** field to each per-ticker row card, allowing users to set individual annual investment amounts per holding.
- The global "Annual Investment (split equally)" field still works as a convenience; changing it distributes the total evenly across all loaded tickers.
- Users can override any individual ticker's contribution after the global split, enabling scenarios like investing more into specific holdings.
- Per-ticker contributions feed directly into the projection engine, so each ticker's growth calculation uses its own contribution amount.

### Basis Mode and Import Fixes

#### Basis Mode Fallback - Zero Price Fix
Fixed a bug where the basis-mode fallback logic used Python's `or` operator, which treated `0` as falsy. This caused legitimate `$0` cost basis values to be silently dropped, potentially resulting in empty or incorrect Price Paid and Purchase Value fields in exports and calculations.

#### Basis Column Population on Fresh Installs
Fixed `_ensure_basis_columns` to always populate NULL basis values, not just when the columns are first created. On fresh installs where the DDL already includes basis columns, imported data would have NULL basis fields because the backfill UPDATE never ran.

#### Gain Recalculation Guard
Fixed `_apply_basis_mode_to_holdings` to skip gain/loss recalculation when cost basis is zero, preventing misleading Gain/Loss values from appearing in exports.

#### Positions Import - Wrong Format Detection
Added validation to Schwab, E*Trade, and Fidelity positions parsers that rejects files where every position has $0 cost basis. This catches the common mistake of selecting "Positions" format when importing a Transactions file, which previously would silently import all holdings with zero cost basis.

#### Total Return - Multi-Profile Aggregation
The Total Return Summary endpoint now correctly aggregates holdings across multiple profiles when viewing in aggregate mode, using proper weighted-average cost basis and GROUP BY ticker logic.

#### Dashboard Cache
Bumped the dashboard cache key to ensure stale cached data from prior versions is not reused.

### Included Feature Set

#### Blended Yield Calculator
- Added all 50 U.S. states to the blended-yield state selector with 2025 state income tax defaults.
- Generalized bracket persistence so saved federal, LTCG, and state bracket overrides merge dynamically by state code.
- Expanded the tax bracket editor so every state can be reviewed and adjusted.
- Added CHPY to the built-in fund database.

#### Dividend Calculator
- Added portfolio import support so users can load current holdings into the dividend calculator at once.
- Added return-of-capital assumptions, DRIP percentage, tax-rate assumptions, and per-ticker payout frequency.
- Added richer combined portfolio projections with aggregate results and per-ticker final values.
- Improved layout for large portfolios with bounded scrollable ticker-chip panel and compact action-button grid.
- Added responsive behavior for tablet and mobile widths.

#### Dividend History
- Fixed refresh-only accounts that had only current-month data in `dividend_payments`.
- Monthly dividend-history chart now backfills prior months from holding-level dividend estimates for refresh-only accounts.
- Yearly refresh-only views now use holding-level YTD totals.

#### Dividend Comparer, ETF Research, and Security Research
- Added distribution percentage views: Monthly Yield % and Annual Yield % modes alongside the original dollar view.
- Added smarter distribution-period labeling for monthly and quarterly histories.

#### Macro Regime Dashboard
- Added macro condition APIs, portfolio exposure analysis, rebalancing tilt suggestions, income benchmark view, per-profile classification overrides, and regime quadrant analysis with FRED economic indicators.

#### Cost Basis Mode
- Added an app-level cost basis selector (Original cost vs. Adjusted cost) used across dashboard, holdings, gains/losses, yield-on-cost, and invested-value calculations.

#### Portfolio Export and Restore
- Added combined export of portfolio positions and transaction history in one workbook.
- Added re-import support for the combined export to restore holdings and transactions together.

#### Dashboard Equity Curve
- Added a Portfolio Value Over Time equity-curve chart to the Dashboard with Record NAV workflow.

#### Market Calendar and Dashboard
- Added market calendar helper for NYSE trading-day detection and closure reasons.
