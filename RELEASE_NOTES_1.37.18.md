# Portfolio Tracking Client v1.37.18

Desktop installers for Windows PC, Intel Mac, and Apple Silicon Mac, including the updates merged since v1.37.17.

## Portfolio research and planning

- Share a strategy-aware NAV assessment across the Dashboard, portfolio NAV screen, and individual fund research, with clearer explanations, reference guidance, and a notice when NAV data lags price data.
- Improve portfolio grading and Analytics, including correlation and capture ratios, clearer grade explanations, and up to five actionable plans showing the trades, share counts, and income changes needed to reach a target grade.
- Add portfolio selection, cell details on hover, and frozen headers to the Correlation Matrix.
- Improve Diversification look-through accuracy and automatically look up new funds on Fund Definitions, with suggestions for missing information.
- Align Portfolio Builder model grades with Dashboard account grades, update Freedom Simulator scenarios to reflect each holding's risk, and tidy the Portfolio Tester screen.
- Add shared date ranges from two to ten years, keep the Dashboard value chart aligned with the selected period, and synchronize Retirement Readiness expenses with Cash Flow.
- Compare fund total return with its own underlying investment in TR/Und.

## Holdings and imported transactions

- Detect stock splits in imported and hand-entered trades.
- Allow closed-position trades to be edited and deleted from Transaction History.
- Let a sale imported after a broker positions file settle the reported share count.
- Distinguish scheduled dividend dates from declared amounts and improve fund data retrieval.

## Desktop packaging

- Increment the application, in-app Help version, and installer metadata to 1.37.18.
- Include the NAV reference registry in Windows and Mac builds so the updated NAV assessment can load in installed copies.

## Installers

- Windows PC: signed x64 `.exe` installer.
- macOS Intel: x64 `.dmg` installer.
- macOS Apple Silicon: arm64 `.dmg` installer.

Mac installers are not notarized by Apple; first launch may require Open Anyway in System Settings > Privacy & Security.

**Changes since the last release:** https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.17...v1.37.18
