# Portfolio Tracking Client v1.32.1

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Options

- **Expanded risk-profile controls** — zoom or pan across the underlying-price axis, use the mouse wheel or dedicated +/- controls, restore the full modeled range with Fit, and open the chart in a window-filling view with Expand. Contract or Escape returns it to the page.
- **Stable profit/loss analysis while repricing** — moving the analysis date now keeps the current chart visible while every leg is repriced, preserves the horizontal view, and locks the full profit/loss height so the chart does not jump or clip its payoff extremes.
- **Clearer simulated-trade workflow** — selected option-chain legs are shown immediately in a Selected strikes summary, the same active legs feed the position table and risk graph, and the primary action now opens the current position directly when no broker description is pasted.
- **Safer multi-leg defaults and updated guidance** — risk legs are ordered consistently, the initial probability anchor favors the strike closest to spot, automated coverage was expanded, and Options Help now documents the selection and graph-view workflows with an updated screenshot.
- **Option Strategy Education guide** — a new in-app guide covering what puts and calls are plus 16 illustrated strategies (covered calls, cash-secured puts, protective puts, collars, poor man's covered calls, credit/debit vertical spreads, iron condors, an unbalanced/skewed iron condor with a margin-requirements deep-dive, iron butterflies, straddles, strangles, and calendar spreads) — each with a custom payoff diagram, best market conditions, how probability of success moves with DTE and OTM distance, and how the trade reacts to rising/falling volatility.
- **Understanding the Greeks guide** — first-order (Delta, Theta, Vega, Rho) and second-order (Gamma, Vanna, Charm, Vomma, Veta) Greeks, each with a 2D value-vs-price curve, a plain-language explanation of the partial-derivative notation (what V, S, t, sigma, r mean and how to read partial-derivative formulas), and a breakdown of how each Greek specifically helps or hurts iron condors and vertical spreads.
- **Options Strategy Lab / Analysis workspace** — build multi-leg simulated option trades against live chains, view risk graphs with probability-of-profit shading, move the analysis date forward to see time/volatility decay, run Greek scenario analysis, import positions from a broker trade descriptor, and backtest option strategies. Quick-start templates cover cash-secured puts, protective puts, collars, both credit and debit verticals, iron condors/butterflies, and straddles/strangles.

## New Features

- **Growth & Income Freedom Simulator** — a realistic, sell-shares FI ("financial independence") test replacing the old 4%-rule estimate, with toggleable sustainability tests (tax drag, payout-vs-total-return cap, DRIP-stop capital stability, withdrawal-phase survival), a settable FI confidence level, and Wealth / Income / Sustainable Freedom winner cards.
- **Cash Flow Sustainability planning** — model cash flow transfers, run sustainability projections, and follow a new in-app help guide for the workflow.
- **Automatic end-of-day NAV capture** — the app now records each holding's official market close once per trading day automatically, keeping NAV history accurate without manual refreshes.
- **ETF closure-risk warning** — the dashboard now flags ETFs at elevated risk of being liquidated for low AUM, with a dismissible banner and a "Close?" indicator column.
- **Account cash tracking & Day Change card** — broker cash balances are now tracked per account, account value includes cash, and a new Day Change card summarizes daily portfolio movement on the dashboard.
- **Portfolio ticker performance attribution** — see how much each ticker contributed to overall portfolio performance.
- **Real distribution sourcing for more fund families** — NEOS, Kurv, InfraCap (QVOL), and Tuttle Capital / Income Blast funds now pull actual ex-date, record-date, pay-date, and amount data from each provider's own site (with upcoming/scheduled distributions surfaced before the amount is announced), instead of relying solely on Yahoo Finance.
- **Distribution Compare enhancements** — added 4%/8% withdrawal-rule modeling and a winner/loser recap.
- **Dashboard import reminder** — a new warning surfaces when broker-managed accounts are overdue for a position import.

## Screen & Workspace Updates

- Refined CommonInfo's dividend and price columns, with new analytics and safer cost-basis handling.
- Added click-to-highlight-ticker on return charts and fixed a primary/compare color swap bug.
- Refreshed the Calculator and Options Help documentation pages.
- Enhanced Dividend Calculator contributions and guidance.

## Bug Fixes

- Fixed Comparer history and distribution yield charts.
- Fixed holdings dividend display and yield frequency.
- Fixed yield attribution in the Security Research return summary.
- Fixed the Kurv distribution parser and gated dividend recognition on pay date (not ex-date).
- Fixed growth-income simulation modeling for large multi-year runs.
- Fixed Total Return for trimmed positions with realized gains, and stopped transfers from being counted as fake realized losses.
- Fixed a "Paid-For-Itself" metric blowup on trimmed positions.
- Restored dashboard category filtering.
- Stabilized Markov transition-matrix estimates used in dividend projections.
- Added a warning for risky/low AUM funds surfaced in the Security Research ETF lookup.
