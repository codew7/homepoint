@echo off
title Construir instalador de WiFi Clientes
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Falta el entorno de compilacion. Crealo una vez con:
    echo   python -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r requisitos-build.txt
    echo   winget install JRSoftware.InnoSetup
    pause
    exit /b 1
)
".venv\Scripts\python.exe" construir.py
pause
