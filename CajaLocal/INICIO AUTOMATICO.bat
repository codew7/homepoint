@echo off
chcp 65001 >nul
title Caja HomePoint - Inicio automatico
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sistema\inicio_automatico.ps1"
if errorlevel 1 pause
