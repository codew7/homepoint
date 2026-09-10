@echo off
chcp 65001 >nul
title Caja HomePoint - Quitar de esta PC
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sistema\desinstalar.ps1"
if errorlevel 1 pause
