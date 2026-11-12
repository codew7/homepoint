@echo off
chcp 65001 >nul
title Descarga de comprobantes (no cerrar)
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando por primera vez...
  call npm install
)

:inicio
node descargar-comprobantes.js --seguir
if %errorlevel%==2 (
  echo.
  echo Falta la clave de Firebase. Lee el mensaje de arriba.
  pause
  exit /b
)
if %errorlevel%==3 (
  echo.
  echo Ya hay otra descarga abierta, por ejemplo en el Verificador de comprobantes.
  echo No hace falta abrir esta ventana.
  pause
  exit /b
)
echo Reiniciando en 15 segundos...
timeout /t 15 /nobreak >nul
goto inicio
