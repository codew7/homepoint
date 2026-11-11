@echo off
chcp 65001 >nul
title Auditoria de categorias - HomePoint
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo No encuentro Python en esta PC. Instalalo desde python.org y volve a intentar.
  pause
  exit /b 1
)
python servidor.py
pause
