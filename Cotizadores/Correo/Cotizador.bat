@echo off
title Cotizador Correo Argentino
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
    echo No se encontro el entorno virtual en "%~dp0venv".
    echo Crealo con:  python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt ^&^& venv\Scripts\playwright install chromium
    pause
    exit /b 1
)

if not exist ".env" (
    echo Falta el archivo .env con MICORREO_EMAIL y MICORREO_PASSWORD.
    pause
    exit /b 1
)

echo Iniciando el cotizador... (esta ventana debe quedar abierta; Ctrl+C o cerrarla para detenerlo)
"venv\Scripts\python.exe" servidor.py %*
if errorlevel 1 pause
