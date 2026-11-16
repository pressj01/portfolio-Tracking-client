# Portfolio Tracking Client v1.37.20

Desktop installers for Windows PC, Intel Mac, and Apple Silicon Mac, including the updates merged since v1.37.19.

## Tax-Loss Harvest

- Keep sold-out lots closed after a ticker is repurchased, including imported sales and FIFO sales without explicit lot allocations.
- Exclude a lot's own purchase from its wash-sale blockers.
- Switch between lots and holdings, sort columns, show the account across portfolios, and remember view preferences.
- Turn replacement suggestions on or off and see how candidates are selected. Correct yield conversion for funds with yields below 1%.
- Keep the Settings link inside the desktop app.

## Transactions and portfolio tables

- Label completed transaction round trips Closed even when the same ticker is held again. Associate dividends with the round trip open on their payment date.
- Select and delete multiple transactions, including all filtered rows, while recalculating affected positions.
- Open each ticker's lots from the Gains & Losses Combined tab and view buy/sell history for closed positions.
- Add column sorting to Blended Yield, Closed CEF, category quality drivers, Dividend Analysis, Dividend Calendar candidates, Diversification fund coverage, account activity, and Analytics peers.

## Help and desktop packaging

- Update Tax-Loss Harvest, Gains & Losses, and Macro Regime Dashboard help to match the app.
- Increment the application, in-app Help version, installer metadata, and release tag to 1.37.20.

## Installers

- Windows PC: signed x64 `.exe` installer.
- macOS Intel: x64 `.dmg` installer.
- macOS Apple Silicon: arm64 `.dmg` installer.

Mac installers are not notarized by Apple; first launch may require Open Anyway in System Settings > Privacy & Security.

**Changes since the last release:** https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.19...v1.37.20
