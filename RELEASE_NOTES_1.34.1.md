# Portfolio Tracking Client v1.34.1

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

This release carries forward the v1.34.0 improvements to the unified option scanner, sector exposure and growth views, customizable tables, and tracking accuracy. It adds the following updates.

## Dashboard Dividend Calendar

- The Dashboard's **Upcoming Dividends This Week** card is now a Monday–Sunday slice of the Dividend Calendar **Month** view.
- It uses the same ticker chips, estimated payment amounts, yields, confirmed/estimated pay-date markers, and weekly payment total as the full Month calendar.
- The Dashboard fetches the adjoining month when a week crosses a month boundary, and links directly to the full Month calendar.

## Dividend Calendar Accuracy

- A manually corrected dividend frequency now reaches every calendar tab, including the Month and Optimization views.
- The calendar now schedules money-market funds without issuer ex-dividend dates and supports pinned semi-annual distribution schedules.
- Decayed payouts now use their current distribution rate rather than a stale historical estimate.

## Option Scanner Improvements

- The General Option Scanner adds IV-versus-realized-volatility metrics, ranks, and filters, while avoiding one-day spikes and preferring the closer-to-30-DTE observation.
- Scanner results now show only listed option trades and label the current-price line more clearly.
- A new strategy field reference explains the inputs for every supported strategy, with in-app navigation and visual examples.

## Portfolio Organization & Analysis

- Snowball categories are nested beneath **Growth**, **Income**, and **Cash** in the category hierarchy.
- Dividend Analysis columns can be reordered and the chosen layout is retained locally.

## v1.34.0 Highlights

- A single General Option Scanner covers calls, puts, verticals, iron condors, and butterflies, with detailed risk probabilities and an in-app guide.
- Sector Exposure provides portfolio look-through equity sector weights, and Growth adds a treemap for portfolio composition.
- Dashboard, Manage Holdings, and Gains & Losses tables support persistent column selection and ordering.
- Split View compares two performance screens side by side with synchronized date ranges.
- Growth & Performance, Portfolio Growth 2, Total Return, and Gains & Losses calculations and intraday labels are better aligned; return labels and several data-quality and navigation issues are clarified or corrected.

## Builds

GitHub Actions produces installers from this release tag:

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.34.0...v1.34.1
