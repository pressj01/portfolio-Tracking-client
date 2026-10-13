; Keep pins from older releases pointing at the executable that this installer
; just installed. Electron Builder preserves desktop and Start Menu links, but
; Windows taskbar pins are user-managed shortcuts and otherwise retain their
; old target (for example the prior development launcher).
;
; This deliberately updates only this application's known shortcut names. It
; does not create a taskbar pin for users who have not chosen to pin the app.
;
; Do this with NSIS's own shortcut support and never by shelling out. This used
; to run PowerShell with -ExecutionPolicy Bypass -EncodedCommand, which is how
; droppers launch a payload: a user's Norton quarantined the signed installer
; as IDP.HELU.PSE94, its PowerShell command-line detection.
!macro repointTaskbarPin NAME
  ${If} ${FileExists} "$0\${NAME}"
    CreateShortCut "$0\${NAME}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    ; A rewritten link has no AppUserModelID. Without it the running window
    ; stops grouping onto the pin and appears as a second taskbar button.
    WinShell::SetLnkAUMI "$0\${NAME}" "${APP_ID}"
  ${EndIf}
!macroend

!macro customInstall
  ; $APPDATA follows the install mode and is ProgramData for an all-users
  ; install, but the pins live in the profile of whoever is running setup.
  ReadEnvStr $0 APPDATA
  StrCpy $0 "$0\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
  ; A shortcut takes its working directory from the output path.
  SetOutPath "$INSTDIR"
  !insertmacro repointTaskbarPin "Portfolio Tracking.lnk"
  !insertmacro repointTaskbarPin "Portfolio Tracker.lnk"
  !insertmacro repointTaskbarPin "Portfolio Tracking Client.lnk"
!macroend
