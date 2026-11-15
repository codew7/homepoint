@echo off
chcp 65001 >nul
title Publicar actualizacion de WhatsAppSync
cd /d "%~dp0"

rem Arma una version nueva de WhatsAppSync con los cambios que haya en esta
rem carpeta, la sube a GitHub y avisa a todas las PCs, que se actualizan
rem solas (sin preguntar nada) y se vuelven a abrir.

if not exist node_modules (
  echo Instalando por primera vez...
  call npm install
)

node publicar.js %*
echo.
pause
