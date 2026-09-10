@echo off
chcp 65001 >nul
title Caja HomePoint - Detener
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0detener.ps1"
