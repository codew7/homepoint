@echo off
chcp 65001 >nul
title Caja HomePoint - Armar version nueva
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\armar.ps1"
