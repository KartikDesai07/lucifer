; electron-builder NSIS include (nsis.include). Runs inside the generated uninstaller.
; The app registers itself for auto-start through app.setLoginItemSettings, whose
; Windows value name is the AppUserModelId (= build.appId). Electron-builder's
; uninstaller does not know about that registry value, so remove it here — a
; dangling Run entry would otherwise point at the deleted exe after uninstall.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.possoftware.pos-desktop"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.possoftware.pos-desktop"
!macroend
