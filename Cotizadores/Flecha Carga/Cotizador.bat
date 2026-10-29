@echo off
title Cotizador Flecha Carga
cd /d "%~dp0"

rem No necesita librerias: alcanza con cualquier Python 3. Primero un venv propio,
rem despues el del cotizador de Via Cargo y por ultimo el lanzador "py" de Windows.
set "PY=venv\Scripts\python.exe"
if exist "%PY%" goto :listo
set "PY=..\ViaCargo\venv\Scripts\python.exe"
if exist "%PY%" goto :listo
set "PY=py"
where py >nul 2>nul
if not errorlevel 1 goto :listo
echo No se encontro Python. Instalalo desde python.org
pause
exit /b 1

:listo
echo Iniciando el cotizador de Flecha Carga... (esta ventana debe quedar abierta; Ctrl+C o cerrarla para detenerlo)
"%PY%" servidor.py %*
if errorlevel 1 pause
