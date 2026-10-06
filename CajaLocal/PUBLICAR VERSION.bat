@echo off
chcp 65001 >nul
title Caja HomePoint - Publicar version nueva
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publicar.ps1"
