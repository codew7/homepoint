@echo off
title Cotizador Via Cargo
cd /d "%~dp0"

if exist "venv\Scripts\python.exe" (
    set "PY=venv\Scripts\python.exe"
) else (
    where py >nul 2>nul && (set "PY=py -3") || (
        echo No se encontro Python. Instalalo desde python.org o crea el venv con:  py -3 -m venv venv
        pause
        exit /b 1
    )
)

echo Iniciando el cotizador de Via Cargo... (esta ventana debe quedar abierta; Ctrl+C o cerrarla para detenerlo)
%PY% servidor.py %*
if errorlevel 1 pause
