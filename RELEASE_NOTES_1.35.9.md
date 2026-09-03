# Portfolio Tracking Client v1.35.9

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Dividend Tracking

- Fixed the payments ledger overstating confirmed dividend cash for reinvesting positions. Every pay date was raised up to the holding's *current* shares times its *current* dividend-per-share, so a position that grows every period through DRIP had its whole payment history silently restated to today's run rate. One Schwab account showed $481.78 for August against the $470.90 the broker actually paid; a single day showed $20.14 against $19.99. The floor that fills in a projected-but-not-yet-paid date now applies only to that one still-projected day, never to a day the broker has already confirmed — once a broker reports a payment, that figure is the answer. A day left short because only one of several linked account files has been imported still reads low on purpose; importing the rest brings it up to the correct total.

## Import

- Added a **Positions + Transactions** tab for the workbook the Export page produces (`portfolio_with_transactions_*.xlsx`), which carries a portfolio sheet and a Transactions sheet in one file. The importer for this file already existed, but it was reachable only through a collapsed "App export" section buried inside Broker Import — there was no way to reach it from the Generic Positions or Generic Transactions screens, which made moving a portfolio to another computer look impossible.
- Added **Both / Positions only / Transactions only** scope buttons so the same workbook can be imported in two steps instead of one — holdings first, then transaction history — which matters because a transactions-only import into an empty portfolio rebuilds share counts from those rows alone.
- Dropping a `portfolio_with_transactions_*.xlsx` file onto the Generic Positions tab now warns that its Transactions sheet would be skipped, with a button to switch to the new tab instead of importing only half the file.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.35.8...v1.35.9
