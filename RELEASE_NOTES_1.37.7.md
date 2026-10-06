# Portfolio Tracking Client v1.37.7

This release makes the installed version and pinned taskbar shortcut follow every Windows update.

## Version and Taskbar Updates

- The Help page now reads the version from the same package metadata used to build the installer, so its displayed version always matches the executable and release.
- The Windows installer repairs existing **Portfolio Tracking** taskbar pins during every update, pointing them at the newly installed executable and refreshing the icon, working folder, and launch arguments.
- The installer never creates a new taskbar pin; it only updates a pin the user already chose to keep.

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.6...v1.37.7
