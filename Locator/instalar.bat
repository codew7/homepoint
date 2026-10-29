@echo off
rem Instala las librerías de Python que necesita el relevamiento. Se ejecuta una sola vez.
chcp 65001 >nul
cd /d "%~dp0"
python -m pip install -r requirements.txt
if not exist ".env" copy config.ejemplo.env .env >nul && echo Se creo el archivo .env: abrilo y completalo.
echo.
pause
