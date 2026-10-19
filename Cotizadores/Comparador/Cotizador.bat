@echo off
title Comparador de envios (Correo Argentino + Via Cargo)
cd /d "%~dp0"

rem Usa el venv propio si existe; si no, el del cotizador del Correo (tiene Playwright + dotenv).
set "PY=venv\Scripts\python.exe"
if exist "%PY%" goto :listo
set "PY=..\Correo\venv\Scripts\python.exe"
if exist "%PY%" goto :listo
echo No se encontro un entorno virtual con Playwright.
echo Crealo en ..\Correo con:  python -m venv venv  y despues  venv\Scripts\pip install -r requirements.txt  y  venv\Scripts\playwright install chromium
pause
exit /b 1

:listo
if not exist "..\Correo\.env" (
    echo Falta ..\Correo\.env con MICORREO_EMAIL y MICORREO_PASSWORD. Via Cargo funciona igual; el Correo no podra cotizar.
)
echo Iniciando el comparador... (esta ventana debe quedar abierta; Ctrl+C o cerrarla para detenerlo)
"%PY%" servidor.py %*
if errorlevel 1 pause
