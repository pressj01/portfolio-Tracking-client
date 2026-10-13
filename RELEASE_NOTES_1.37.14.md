# Portfolio Tracking Client v1.37.14

This release removes a PowerShell step from the Windows installer after Norton antivirus quarantined the installer during setup. The application itself is unchanged from v1.37.13.

Desktop installers are available for Windows PC, Intel Mac, and Apple-silicon Mac.

## Windows Installer

- A user reported Norton stopping the installation and quarantining the installer with the detection `IDP.HELU.PSE94`. Norton reports that name for PowerShell activity it considers suspicious, not for the contents of a file.
- Since v1.37.7 the installer ran a hidden PowerShell command to point existing taskbar pins at the newly installed version. The installer now updates those pins itself and no longer starts PowerShell for this.
- Taskbar pins behave as before: a pin you already have is pointed at the new version, and no pin is created if you have not pinned the app.
- The installer is still digitally signed. Under **Properties > Digital Signatures** the signer is **James Presser**.
- This change has not been tested against Norton directly. If antivirus software still stops the installer, please report the product and the detection name.

## If v1.37.13 Was Blocked

- Install v1.37.14 instead of restoring the earlier installer from quarantine.

## Installers

- **Windows PC:** signed NSIS `.exe` installer (x64)
- **macOS Intel:** `.dmg` installer (x64)
- **macOS Apple Silicon:** `.dmg` installer (arm64)

**Changes since the last deployment**: https://github.com/pressj01/portfolio-Tracking-client/compare/v1.37.13...v1.37.14
