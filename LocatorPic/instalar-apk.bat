@echo off
rem Instala LocatorPic.apk en el equipo Android conectado por USB (con "Depuracion USB" activada).
chcp 65001 >nul
cd /d "%~dp0"
set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not exist "%ADB%" (
  echo No encuentro adb en %ADB%
  pause
  exit /b 1
)
if not exist "LocatorPic.apk" (
  echo Falta LocatorPic.apk: primero ejecuta android\compilar.bat
  pause
  exit /b 1
)
"%ADB%" devices
"%ADB%" install -r "LocatorPic.apk"
if errorlevel 1 (
  echo.
  echo  No se pudo instalar. Revisa que el equipo este conectado, desbloqueado
  echo  y que hayas aceptado el cartel de "Permitir depuracion USB".
) else (
  echo.
  echo  Listo: LocatorPic instalado.
)
pause
