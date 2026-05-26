# Release Notes - v1.28.3

Release date: May 25, 2026

## Dividend Calculator - Portfolio Projection Accuracy

- Fixed whole-portfolio dividend projections for high-yield option-income portfolios, including an account example where a $25,343 starting portfolio could incorrectly project into multi-million-dollar results.
- KQQQ and other funds with short or noisy dividend histories no longer seed unrealistic default dividend-growth rates, such as the prior 153% annual growth estimate.
- Portfolio-imported holdings now prefer the account's stored current income/yield data when available, so the calculator starts from the portfolio's actual income profile instead of relying only on live lookup estimates.
- Return of Capital now affects modeled NAV during projection, not just taxes, preventing distributions from being counted as both reinvestable income and unchanged fund value.
- High-yield imported portfolio rows receive conservative default ROC assumptions that users can still edit per ticker.

## Dividend Calculator - Formatting and Input Precision

- Large result values now format compactly as M/B/T or scientific notation instead of overflowing cards and tables.
- Invalid runaway values such as Infinity now render safely instead of breaking the result display.
- Per-ticker input fields now display practical precision:
  - Money and stock prices: 2 decimals
  - Shares: 2 decimals
  - Yields, growth, ROC, tax, and DRIP assumptions: 2 decimals
  - Annual contributions: whole dollars
- Result cards and the total return header now wrap long values cleanly.

## Deployment Artifacts

- `PortfolioTrackingClient-Win-1.28.3.zip`
- `PortfolioTrackingClient-Mac-1.28.3.zip`

Each ZIP contains the built React frontend, Flask backend source, Electron launcher, provider seed database, and platform-specific setup/start scripts.
