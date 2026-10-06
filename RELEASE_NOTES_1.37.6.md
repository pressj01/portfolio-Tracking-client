# Portfolio Tracking Client v1.37.6

This release fixes imported cost basis after specific-lot sales, makes return scopes explicit, and adds broker-style open-lot details.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Correct Imported Cost Basis

- Preserve broker-reported quantity and adjusted cost basis when positions and transaction history are imported together.
- Recalculate original basis and realized gain/loss from saved specific-lot allocations instead of silently reverting to FIFO.
- Apply the same snapshot reconciliation to every supported broker positions import and the generic positions import.
- Repair existing portfolios whose saved lot selections were correct but whose original basis still reflected the older FIFO replay.

## Clear Return Scopes

- Rename **All** to **All Market** for the time-weighted tracker replay.
- Rename **Life** to **Open G/L** for current value minus the selected cost basis of shares still held.
- Label the broader lifetime result **Lifetime Total G/L** because it adds distributions and realized sales to open-position gain/loss.
- Explain that broker unrealized gain/loss matches **Open Position G/L** when Broker-adjusted basis and the same quote are selected.

## Lot Details

- Expand a position on Holdings or Total Return to switch between **Open lots** and **Transaction history**.
- Review current shares, cost per share, cost basis, current value, G/L dollars, and G/L percent for each open lot.
- Keep transaction editing, deletion, same-day ordering, and specific-lot controls on Holdings; Total Return provides a read-only audit view with a direct link back to Holdings.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.5...v1.37.6
