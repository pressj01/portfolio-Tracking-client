## v1.31.5 - Category Target Allocation and Owner Reference

**Release date:** June 1, 2026
**Available for:** Windows (.exe installer, x64) and macOS (.dmg, Intel x64 + Apple Silicon arm64)

---

## New in v1.31.5

### Categories target allocation total
The Categories page now shows a sticky **Target Allocation** panel while editing category targets. It totals the current target allocations, shows whether the page is under or over 100%, and keeps that context visible next to the category list.

### Actual weighting compared with target weighting
The Target Allocation panel now includes each targeted category's current actual portfolio weight, saved target weight, and drift. This makes it easier to see where the portfolio is above or below the targets set on the page.

### Owner target reference from subaccounts
When viewing the Owner profile, the page now shows the target allocations from the included subaccounts that make up Owner. The reference view includes account value, each subaccount's category targets, and a weighted Owner guide so the Owner targets can be set from the subaccount mix without manually opening each account.

### Live target total while editing
The New/Edit Category dialog now previews the total target allocation after saving the typed value, including remaining or over-target percentage. This helps prevent accidentally saving a target set that does not add up to 100%.

---

## Carried forward from v1.31.0

### Help page updates
The Dashboard Help section was refreshed with current screenshots and rewritten documentation for the summary cards, including estimated vs. actual reinvestment cards, the monthly income card, the S&P 500 card, and the explanation for why estimated and actual reinvestment percentages can differ.

The Reinvestment Impact Projection Help section was also refreshed with the current Reinvest % controls, including the Est. seed and Actual 3mo seed.

### Dashboard NAV Benchmark field could not be cleared
The Dashboard NAV benchmark override input can now be cleared and saved as empty. Previously, clearing the field could snap the old benchmark value back into the input.

---

## Bug fixes since v1.31.0

### Broker-managed DRIP columns showing zero
The Holdings screen now derives DRIP Shares and Cash Reinvested from imported reinvestment transaction history so those values survive broker position re-imports.

### Deployed builds include the DRIP repair
The installer packaging flow now rebuilds the bundled Flask backend before desktop packaging, so installed Windows and macOS builds include the same DRIP repair code verified locally.

### Existing installed accounts self-heal on Holdings load
Existing databases with zero reinvestment totals now run a lightweight repair when Holdings loads, rebuilding DRIP shares and reinvested cash from saved DRIP/reinvestment BUY history.

### Base Shares display after DRIP repair
The Holdings API now returns a display-ready Base Shares value calculated from current shares minus recorded DRIP shares, avoiding blank Base Shares values after repair.

### E*Trade DRIP estimates from dividend history
For E*Trade accounts without explicit reinvestment BUY lots, DRIP-enabled holdings can now estimate reinvested cash from imported dividend payment history and convert it into DRIP shares using current price, with average price as a fallback.

### Version display
The Help page version display now reports `1.31.5`.

---

## Verification

- Backend regression tests passed: `py -m unittest backend.test_holdings_transactions`
- Frontend production build passed: `npm run build`
- Categories page was checked in the app browser with the new target total and actual-vs-target panel visible.

---

## Builds

Both installers are produced automatically by GitHub Actions when this tag is published:

- **Windows**: `Portfolio.Tracking.Client.Setup.1.31.5.exe` - NSIS installer, x64
- **macOS**: `Portfolio.Tracking.Client-1.31.5.dmg` and `Portfolio.Tracking.Client-1.31.5-arm64.dmg` - Intel (x64) + Apple Silicon (arm64)

**Full Changelog**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.31.4...v1.31.5
