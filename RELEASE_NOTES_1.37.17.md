# Portfolio Tracking Client v1.37.17

This release fixes holdings whose share count could jump after a transaction was added by hand in a portfolio imported from a broker.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Transactions in Broker-Imported Portfolios

- Adding, editing, or deleting a transaction with the **TXN** button no longer rebuilds the holding's share count from its transaction history. In portfolios imported from a broker positions file, that file's count is kept and moved by the trade you entered.
- Previously an incomplete history could change the count. Example: a money-market fund such as FZDXX could jump from $71 to more than $16,000 after a $5 purchase, because sweep purchases are recorded but the cash that leaves the fund is not. A stock whose history starts after its first purchase could drop instead.
- Trades dated after your last positions import change the count. Corrections to older history, such as deleting a duplicate imported purchase, no longer change it, because the broker file already reflects that history.
- A trade dated the same day as the positions import counts as new only if it was entered after the import.
- You can now record the sale of shares your broker reports even when the transaction history does not include their purchase.
- Holdings whose transaction history already matches the broker behave exactly as before. Portfolios without a broker import continue to follow their transaction history.
- A count that is already wrong is corrected by your next positions import. Money-market funds take the file's count automatically. Other holdings show the **Use broker count** option added in v1.37.16.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.16...v1.37.17
