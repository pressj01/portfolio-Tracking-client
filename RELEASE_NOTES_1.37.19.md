# Portfolio Tracking Client v1.37.19

Desktop installers for Windows PC, Intel Mac, and Apple Silicon Mac, including the updates merged since v1.37.18.

## Portfolio values and income

- Include estimated distributions paid since the last broker positions import in account values. Cash payments and reinvested payments are tracked separately from the broker's figures, and a new import replaces the estimates with reported amounts.
- Combine recorded and estimated dividend cash per account on the dividend calendar.
- Add a trailing-twelve-month income share column and share counts in the Dashboard portfolio overview, plus clearer explanations of portfolio value and invested amounts.
- Catch up a missed market-close snapshot overnight, on weekends, and on market holidays before the next opening bell. Keep the value chart's current point aligned with the Portfolio Value card while preserving the recorded close for returns.

## Portfolio organization and transactions

- Nest sub-categories to any depth, reorder or sort categories, and show allocation percentages at each level.
- Add buy and sell trades to closed positions directly from Transaction History.
- Carry cash-flow expenses across a person's own portfolios.
- Clarify the held-period label on individual holding charts and keep chart legends clear of subtitles.

## Desktop packaging

- Increment the application, in-app Help version, installer metadata, and release tag to 1.37.19.

## Installers

- Windows PC: signed x64 `.exe` installer.
- macOS Intel: x64 `.dmg` installer.
- macOS Apple Silicon: arm64 `.dmg` installer.

Mac installers are not notarized by Apple; first launch may require Open Anyway in System Settings > Privacy & Security.

**Changes since the last release:** https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.18...v1.37.19
