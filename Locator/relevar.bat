@echo off
rem Doble clic: baja el ultimo recorrido de LocatorPic, lo analiza y pregunta si guardar.
rem Tambien se puede arrastrar una carpeta de fotos encima para analizar esa.
chcp 65001 >nul
cd /d "%~dp0"
if "%~1"=="" (
  python relevar.py
) else (
  python relevar.py "%~1"
)
echo.
pause
