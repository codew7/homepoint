@echo off
chcp 65001 >nul
title Publicar Reposición
rem ==========================================================================
rem  Sube a GitHub los cambios de Reposición para que lleguen a los celulares.
rem
rem  Solo publica lo de Reposición: las carpetas reposicion\ y reposicion2\, el workflow del APK
rem  y este mismo archivo. Cualquier otro cambio del repositorio queda como
rem  está, sin subirse.
rem
rem  - Cambios en la página (reposicion\index.html, etc.): los celulares ven el
rem    cartel "Hay una versión nueva" en un par de minutos.
rem  - Cambios en la app (reposicion\android\): GitHub compila el APK nuevo
rem    (3 a 6 minutos) y la app ofrece "Actualizar" sola.
rem ==========================================================================

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo  No se encontró Git en esta PC. Instalá "Git for Windows" o abrí GitHub Desktop.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "RAMA=%%b"
if /i not "%RAMA%"=="main" (
  echo.
  echo  Estás en la rama "%RAMA%" y no en "main". Cambiá a main desde GitHub Desktop y volvé a probar.
  echo.
  pause
  exit /b 1
)

rem El instalador del driver de la impresora no se publica (pesa y no hace falta en la web).
git rm -r --cached --ignore-unmatch -q -- "reposicion/*.exe" >nul 2>&1

set "RUTAS=reposicion reposicion2 .github/workflows/apk-reposicion.yml .gitignore "Publicar Reposicion.bat""

set "HAY="
for /f "delims=" %%i in ('git status --porcelain -- %RUTAS%') do set "HAY=1"
if not defined HAY (
  echo.
  echo  No hay cambios de Reposición para publicar.
  echo.
  pause
  exit /b 0
)

set "APP="
for /f "delims=" %%i in ('git status --porcelain -- reposicion/android .github/workflows/apk-reposicion.yml') do set "APP=1"

echo.
echo  ==========================================
echo    Publicar Reposición en GitHub
echo  ==========================================
echo.
echo  Cambios que se van a subir:
echo.
git status --short -- %RUTAS%
echo.

set "MSG="
set /p "MSG=  Contá en pocas palabras qué cambiaste (o Enter para seguir): "
if not defined MSG set "MSG=Reposición: actualización"
set "MSG=%MSG:"=%"

echo.
echo  [1/3] Guardando los cambios...
git add -A -- %RUTAS%
git commit -q -m "%MSG%" -- %RUTAS%
if errorlevel 1 (
  echo  No se pudo guardar el cambio. Revisá los mensajes de arriba.
  pause
  exit /b 1
)

echo  [2/3] Trayendo lo último de GitHub...
git pull -q --rebase --autostash origin main
if errorlevel 1 (
  git rebase --abort >nul 2>&1
  echo.
  echo  Hay cambios en GitHub que chocan con los tuyos. No se subió nada.
  echo  Abrí GitHub Desktop para resolverlo, o pedile ayuda a Claude.
  echo.
  pause
  exit /b 1
)

echo  [3/3] Subiendo a GitHub...
git push -q origin main
if errorlevel 1 (
  echo.
  echo  No se pudo subir. Revisá la conexión a internet o que GitHub Desktop tenga la sesión iniciada.
  echo.
  pause
  exit /b 1
)

echo.
echo  ==========================================
echo    Listo, publicado.
echo  ==========================================
echo.
echo  - La página nueva llega en un par de minutos. Los celulares que
echo    la tengan abierta muestran el cartel "Hay una versión nueva".
if defined APP (
  echo  - Cambió la app: GitHub está armando el APK nuevo ^(3 a 6 minutos^).
  echo    Después, cada celular muestra "Actualizar" al abrir la app o en
  echo    menos de 15 minutos si ya estaba abierta.
  echo.
  echo  Se abre la página de GitHub para ver cómo va la compilación.
  start "" "https://github.com/codew7/homepoint/actions/workflows/apk-reposicion.yml"
)
echo.
pause
