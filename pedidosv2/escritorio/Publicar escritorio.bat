@echo off
chcp 65001 >nul
rem Arma una versión nueva de la app de escritorio (sube el número solo).
rem Después hay que subir la carpeta pedidosv2\escritorio al repositorio.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fuente\compilar.ps1"
if errorlevel 1 (
  echo.
  echo Hubo un error. Revisa el mensaje de arriba.
)
echo.
pause
