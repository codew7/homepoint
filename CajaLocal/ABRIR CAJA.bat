@echo off
rem ---------------------------------------------------------------------------
rem  Abre la caja sin haber pasado por INSTALAR.bat.
rem  Sirve para probar el paquete o para usarlo desde un pendrive.
rem  En una PC de trabajo conviene ejecutar INSTALAR.bat una sola vez y despues
rem  usar siempre el acceso directo del Escritorio.
rem ---------------------------------------------------------------------------
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0sistema\iniciar.vbs"
