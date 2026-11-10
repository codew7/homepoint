@echo off
chcp 65001 >nul
title WhatsApp - Sincronizador (no cerrar)
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando por primera vez...
  call npm install
)

:inicio
node index.js
if %errorlevel%==2 (
  echo.
  echo Falta configurar algo. Lee el mensaje de arriba y LEEME.md.
  pause
  exit /b
)
if %errorlevel%==3 (
  echo.
  echo Ya hay otra ventana del sincronizador abierta. Esta se cierra.
  pause
  exit /b
)
echo Reiniciando en 15 segundos...
timeout /t 15 /nobreak >nul
goto inicio
