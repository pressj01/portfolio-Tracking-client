# Portfolio Tracking Client v1.37.13

This release stops overlapping broker and Snowball imports from double-counting small fractional sales, and ranks the comparer chart hover box from best to worst.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Import Duplicate Detection

- A fractional-share sale that appears in two feeds, such as Fidelity history and a Snowball export, is now recognized as one trade instead of being added a second time.
- The two feeds report the same fill with slightly different prices because one prints the execution price and the other divides the cash, rounded to the cent, by the shares. On a fraction of a share one cent of cash moves that price by several cents, which the old one-cent price check treated as a different trade.
- The allowed price gap now widens as the share count drops below one share, to what one cent of cash can explain. From one share up the check is unchanged, and a fractional fill at a genuinely different price still imports as its own transaction.
- Works in either import order.

## Comparer Hover Box

- The hover box on **ETF Comparer**, **Stock Comparer**, and **Stock and ETF Analysis** now lists funds from highest to lowest value at the hovered date, so the order stays meaningful after the lines cross.
- The shared **Yield on Cost** chart is ranked the same way.
- **Stock and ETF Analysis**: the Baseline guide line no longer shows up as a row in the hover box, matching the two comparers.
- **Stock Comparer**: the return value in the hover box no longer prints as a long raw number such as `27.96650000000001%`.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.12...v1.37.13
