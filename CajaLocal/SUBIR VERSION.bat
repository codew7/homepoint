@echo off
chcp 65001 >nul
title Caja HomePoint - Subir version a GitHub
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\subir.ps1"
