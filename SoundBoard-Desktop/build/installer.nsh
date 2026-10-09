; Al desinstalar, quitar el "Iniciar con Windows" que la app registra con
; app.setLoginItemSettings (el valor se llama como el AppUserModelId).
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ar.dev.homepoint.soundboard"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ar.dev.homepoint.soundboard"
!macroend
