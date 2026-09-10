@echo off
chcp 65001 >nul
title Caja HomePoint - Instalacion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sistema\instalar.ps1"
if errorlevel 1 pause
