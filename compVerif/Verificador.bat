@echo off
rem Verificador de comprobantes: prepara el entorno la primera vez y abre la pantalla en el navegador.
cd /d "%~dp0"
if not exist "venv\Scripts\python.exe" (
    echo Preparando el verificador por primera vez...
    py -3 -m venv venv 2>nul || python -m venv venv
    "venv\Scripts\python.exe" -m pip install -q -r requirements.txt
)
"venv\Scripts\python.exe" servidor.py %*
pause
