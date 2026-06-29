# Portfolio Tracking Client v1.31.14

**Release date:** June 28, 2026

**Platforms:** Windows x64 and macOS Intel x64 / Apple Silicon arm64

v1.31.14 is a startup-reliability update for the v1.31.13 desktop release. It addresses an installed application appearing to do nothing when the bundled backend needs extra time to start or encounters an error.

## Startup reliability

- Increased the backend startup allowance from 15 seconds to 60 seconds.
- This accommodates first-launch security scanning by Windows Defender, macOS Gatekeeper, and third-party security software.
- A startup failure now displays a visible error dialog instead of silently closing.
- Every installed-app launch now writes a fresh `startup.log` containing:
  - application version,
  - backend executable path,
  - backend working directory,
  - selected database directory,
  - backend output,
  - backend exit status, and
  - startup timeout or launch errors.

## Configurable database directory

- Installed applications can use an existing database directory without embedding a machine-specific path in the installer.
- Set the database directory with either:
  - the `PORTFOLIO_DB_DIR` environment variable, or
  - a `database-directory.txt` file in the application user-data folder.
- The configured directory is used only when it contains `portfolio.db`.
- Invalid or unavailable configured paths safely fall back to the normal per-user application database.
- The configuration file remains outside the installed program so it can survive application updates.

## Diagnostic log locations

### Windows

`%APPDATA%\portfolio-tracking-client\startup.log`

### macOS

`~/Library/Application Support/portfolio-tracking-client/startup.log`

If the app cannot open, the displayed error includes the exact log location.

## Downloads

### Windows

Download `Portfolio.Tracking.Client.Setup.1.31.14.exe`.

### macOS

- `Portfolio.Tracking.Client-1.31.14-arm64.dmg` — Apple Silicon
- `Portfolio.Tracking.Client-1.31.14.dmg` — Intel

These builds are not commercially code-signed. Windows SmartScreen or macOS Gatekeeper may require confirmation on first launch.

The application is designed to run under a normal user account. Running it as administrator should not be required.

## Verification

- JavaScript syntax validation for the production Electron launcher.
- Frontend production build.
- Packaged Windows application launch against a clean per-user database directory.
- Existing backend regression suite.
- Independent GitHub Actions installer builds for Windows x64, macOS Intel x64, and macOS Apple Silicon arm64.
