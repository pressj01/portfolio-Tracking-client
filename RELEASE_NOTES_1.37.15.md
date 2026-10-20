# Portfolio Tracking Client v1.37.15

This release adds optional extended-hours pricing, expands Fidelity import support, and makes dividend scheduling clearer around US bank holidays.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Extended-Hours Prices

- Settings now includes an opt-in **Extended-Hours Prices** choice for portfolios that should reflect the latest available pre-market or after-hours trade.
- The regular 4:00 PM ET close remains the default, and official closing NAV records and dividend calculations continue to use regular-session prices.
- When an eligible extended-hours trade is unavailable or the market-data feed is throttled, the app safely falls back to the regular close.

## Fidelity Imports

- Fidelity Positions and Accounts History imports now accept Excel 97-2003 `.xls` workbooks in addition to CSV and XLSX files.
- **Fidelity (Positions)** now recognizes Fidelity Trader+ position exports and their column names.
- Trader+ exports do not report cash, so importing one preserves the portfolio's existing cash balance instead of replacing it with zero.
- The **Automatically continue to the next step** import choice is now remembered between pages and app launches.

## Dividend Calendars

- The Dashboard week calendar and Dividend Month calendar now label US bank holidays using the Federal Reserve schedule.
- Holiday notes show the next business day when distributions due on the holiday are expected to be paid.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.14...v1.37.15
