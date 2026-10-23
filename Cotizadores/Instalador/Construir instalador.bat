@echo off
title Construir instalador del cotizador
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Falta el entorno de compilacion. Crealo una vez con:
    echo   ..\Correo\venv\Scripts\python.exe -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r requisitos-build.txt
    echo   winget install JRSoftware.InnoSetup
    pause
    exit /b 1
)
".venv\Scripts\python.exe" construir.py
pause
