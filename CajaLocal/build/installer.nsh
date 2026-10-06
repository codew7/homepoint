; =============================================================================
;  installer.nsh - Ajustes del instalador de Caja HomePoint
; =============================================================================
;  electron-builder arma el instalador; acá van solo los agregados:
;   - pantalla de bienvenida con texto propio;
;   - limpieza de la versión anterior (la de INSTALAR.bat y servidor.ps1),
;     solo en la instalación manual, nunca en las actualizaciones automáticas.
; =============================================================================

!include "FileFunc.nsh"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Caja HomePoint"
  !define MUI_WELCOMEPAGE_TEXT "Se va a instalar la caja de HomePoint en esta PC.$\r$\n$\r$\nQueda el acceso en el Escritorio y en el menú Inicio, se abre sola al prender la PC y se mantiene actualizada sin que haya que hacer nada.$\r$\n$\r$\nHacé clic en Siguiente para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  ; Las actualizaciones automáticas llegan con --updated: ahí no se toca nada.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${If} ${Errors}
    ; 1. El servidor PowerShell de la versión anterior, si quedó prendido,
    ;    ocupa el puerto 8123 que usa la caja nueva.
    nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $$_.CommandLine -like '*servidor.ps1*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
    Pop $0

    ; 2. La tarea "abrir al prender la PC" de INICIO AUTOMATICO.bat. La caja
    ;    nueva se ocupa sola de eso.
    nsExec::Exec `schtasks.exe /Delete /TN "Caja HomePoint - Inicio automático" /F`
    Pop $0

    ; 3. Los accesos directos viejos (apuntaban a iniciar.vbs). El del
    ;    Escritorio se vuelve a crear enseguida, apuntando a la caja nueva.
    Delete "$DESKTOP\Caja HomePoint.lnk"
    RMDir /r "$APPDATA\Microsoft\Windows\Start Menu\Programs\HomePoint"
  ${EndIf}
!macroend
