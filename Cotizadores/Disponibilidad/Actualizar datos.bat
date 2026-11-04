@echo off
chcp 65001 >nul
title Actualizar datos de disponibilidad
cd /d "%~dp0"
set "PY=..\Correo\venv\Scripts\python.exe"
if exist "%PY%" goto :listo
echo No se encontro Python en ..\Correo\venv. Revisar la instalacion del cotizador del Correo.
pause
exit /b 1

:listo
set "PYTHONIOENCODING=utf-8"
"%PY%" preparar_datos.py %*
echo.
pause
