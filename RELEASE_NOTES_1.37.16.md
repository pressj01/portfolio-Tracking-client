# Portfolio Tracking Client v1.37.16

This release fixes broker positions imports that could keep a stale share count instead of the count in the file, and makes it visible when an import keeps a count on purpose.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Positions Imports

- Money-market funds such as FZDXX, SPAXX, and other funds ending in "XX" now always take the share count from the broker's positions file. Previously a large drop in a money-market balance could be ignored, so re-importing a correct file kept showing an older, higher balance.
- When a positions import keeps a holding's existing share count, because the file shows a large drop that no recorded sale explains, the Import page now shows a warning that lists each holding with the file's count and the count that was kept.
- A new **Use broker count** button, for one holding or for all of them, re-applies the same file using the broker's count for those holdings. Your transaction history is not changed.
- This applies to every broker positions import: Charles Schwab, E\*TRADE, Fidelity, Robinhood, Shear Group, Interactive Brokers, the All Accounts versions, and Snowball Holdings.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.15...v1.37.16
