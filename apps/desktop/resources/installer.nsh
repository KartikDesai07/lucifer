; electron-builder NSIS include (nsis.include). Runs inside the generated uninstaller.
; The app registers itself for auto-start through app.setLoginItemSettings, whose
; Windows value name is the AppUserModelId (= build.appId). Electron-builder's
; uninstaller does not know about that registry value, so remove it here — a
; dangling Run entry would otherwise point at the deleted exe after uninstall.
;
; Native apps 2.0 (the N2 review gate, G-1): an install over an older version, and every update, runs the old
; uninstaller with --updated first; the start-with-Windows entries stay then (the app is still installed).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.possoftware.pos-desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.possoftware.pos-desktop"
  ${endIf}
!macroend
