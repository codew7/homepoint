<#
===============================================================================
 publicar.ps1 - Publica una version nueva de Caja HomePoint
===============================================================================

 Uso: doble clic en PUBLICAR VERSION.bat (o "npm run publicar").

 Que hace:
   1. Copia a app\ los archivos de la web (scripts\sincronizar.js) y revisa
      que este todo lo necesario (token de GitHub, config.js).
   2. Pregunta que tipo de cambio es y sube el numero de version.
   3. Arma el instalador y lo sube a GitHub Releases (codew7/homepoint).

 Desde ese momento, todas las cajas instaladas la bajan solas en las
 proximas 2 horas y la instalan al cerrarse.

 Se publica desde esta PC (y no desde GitHub) porque app\config.js no esta en
 el repositorio: tiene las claves de Firebase y de la planilla.
#>

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

function Titulo($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [OK] $t" -ForegroundColor Green }
function Falla($t)  { Write-Host ''; Write-Host "  [X] $t" -ForegroundColor Red; Write-Host ''; Read-Host '  Enter para cerrar'; exit 1 }

Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host '    CAJA HOMEPOINT - Publicar version nueva' -ForegroundColor Cyan
Write-Host '  ===============================================================' -ForegroundColor Cyan

# ------------------------------------------------------------- 1. revisar ---
Titulo '1. Revisando'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Falla 'No esta instalado Node.js (https://nodejs.org).' }
if (-not (Test-Path 'node_modules')) {
  Write-Host '  Instalando dependencias (solo la primera vez)...'
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Falla 'No se pudieron instalar las dependencias.' }
}
Ok 'Dependencias'

# La web es el original: app\ se arma copiando de ahi (ver sincronizar.js).
node scripts/sincronizar.js
if ($LASTEXITCODE -ne 0) { Falla 'Los archivos de la app no se pudieron igualar con los de la web (ver arriba).' }
Ok 'Archivos de la app iguales a los de la web'

if (-not (Test-Path 'app\config.js')) { Falla 'Falta app\config.js (las claves de Firebase y de la planilla). Copialo de la carpeta raiz del sitio.' }
Ok 'app\config.js'

# El token se guarda una sola vez en las variables del usuario de Windows.
$token = [Environment]::GetEnvironmentVariable('GH_TOKEN', 'User')
if (-not $token) { $token = $env:GH_TOKEN }
if (-not $token) {
  Write-Host ''
  Write-Host '  Falta el permiso para subir versiones a GitHub (se pide una sola vez).' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '    1. Se abre GitHub en el navegador.'
  Write-Host '    2. Note: "Publicar Caja HomePoint". Expiration: "No expiration".'
  Write-Host '    3. Tildar "repo". Boton verde "Generate token" al final.'
  Write-Host '    4. Copiar el codigo que empieza con ghp_ y pegarlo aca.'
  Write-Host ''
  Start-Process 'https://github.com/settings/tokens/new?scopes=repo&description=Publicar%20Caja%20HomePoint'
  $token = (Read-Host '  Pegar el token y Enter').Trim()
  if (-not $token) { Falla 'No se pego ningun token.' }
  [Environment]::SetEnvironmentVariable('GH_TOKEN', $token, 'User')
}
$env:GH_TOKEN = $token
Ok 'Permiso de GitHub'

# ------------------------------------------------------------ 2. version ---
$paquete = Get-Content 'package.json' -Raw | ConvertFrom-Json
$actual  = $paquete.version

Titulo "2. Version actual: $actual"
Write-Host ''
Write-Host '    1) Arreglo      (corrige algo que andaba mal)'
Write-Host '    2) Mejora       (agrega o cambia algo)'
Write-Host '    3) Cambio grande'
Write-Host ''
$opcion = Read-Host '  Elegir 1, 2 o 3'
$tipo = switch ($opcion) { '1' { 'patch' } '2' { 'minor' } '3' { 'major' } default { $null } }
if (-not $tipo) { Falla 'Opcion no valida. No se publico nada.' }

Write-Host ''
$notas = (Read-Host '  En una linea, que cambio (aparece en el aviso de la caja)').Trim()

npm version $tipo --no-git-tag-version | Out-Null
if ($LASTEXITCODE -ne 0) { Falla 'No se pudo cambiar el numero de version.' }
$nueva = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
Ok "Version nueva: $nueva"

# --------------------------------------------------- 3. armar y publicar ---
Titulo "3. Armando y subiendo la version $nueva (tarda unos minutos)"
Write-Host ''

$argumentos = @('electron-builder', '--win', '--publish', 'always')
if ($notas) { $argumentos += "-c.releaseInfo.releaseNotes=$notas" }
npx @argumentos

if ($LASTEXITCODE -ne 0) {
  # Se vuelve al numero anterior para que el proximo intento no saltee uno.
  npm version $actual --no-git-tag-version --allow-same-version | Out-Null
  Falla "No se pudo publicar. Se dejo la version en $actual. Revisar los mensajes de arriba."
}

Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Green
Write-Host "    LISTO. Version $nueva publicada." -ForegroundColor Green
Write-Host '  ===============================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Las cajas la bajan solas en las proximas 2 horas y la instalan al'
Write-Host '  cerrarse. Recordar commitear package.json con el numero nuevo.'
Write-Host ''
Write-Host "  https://github.com/codew7/homepoint/releases/tag/v$nueva"
Write-Host ''
Read-Host '  Enter para cerrar'
