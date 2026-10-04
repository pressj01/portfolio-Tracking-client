# Portfolio Tracking Client v1.37.4

This release makes the Dashboard watchlist optional and corrects the yield it shows. It includes everything in v1.37.1.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## New since v1.37.1

### Dashboard Watchlist

- The watchlist card on the Dashboard is now off by default. Turn it on with the **Show watchlist** link on the Dashboard, or with **Show the watchlist on the Dashboard** at the top of the Watchlists page. Turn it off again with the **Hide** link on the card or by unticking the box.
- With more than one watchlist, the card's title is a picker for choosing which list it shows. Choosing a list there makes it the Home list, the same as ticking **Show this list on Home** on the Watchlists page.
- While the card is hidden the Dashboard does not load the watchlist or its quotes, so it adds nothing to the Dashboard's load time.
- If you were using the card before this update, it will be hidden after updating until you turn it back on. The choice is remembered on each computer.

### Watchlist Yield

- The Yield column is now calculated from the distributions a fund has actually paid, annualized at its current payment schedule. It previously used the yield from Yahoo's quote, which is wrong for many option-income funds — QQQI showed 0.09% and now shows about 13.6%.
- Yahoo's quote yield is still used when a security has no payment history available.

## Also included from v1.37.1

- **ETF Overlap (new page)** — compare two funds by weighted holdings overlap, with sector drift, overweight and underweight lists, and a holdings table with sector and industry.
- Named watchlists, adjustable grading and signal formulas, the hybrid Tiingo data provider, Gumroad license activation, and the dividend, cost-basis, chart and option-scanner fixes listed in the v1.37.1 release notes.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.1...v1.37.4
