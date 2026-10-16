<#
===============================================================================
 armar.ps1 - Arma una version nueva de Caja HomePoint (sin subirla)
===============================================================================

 Uso: doble clic en ARMAR VERSION.bat (o "npm run armar").

 Que hace:
   1. Copia a app\ los archivos de la web (scripts\sincronizar.js) y revisa
      que este app\config.js.
   2. Pregunta que tipo de cambio es y sube el numero de version.
   3. Arma el instalador en la carpeta dist. NO lo sube: las cajas no se
      enteran hasta correr SUBIR VERSION.bat (subir.ps1).

 Entre los dos pasos se puede probar el instalador de dist en una PC.

 Se arma desde esta PC (y no desde GitHub) porque app\config.js no esta en
 el repositorio: tiene las claves de Firebase y de la planilla.
#>

. "$PSScriptRoot\comun.ps1"

Encabezado 'CAJA HOMEPOINT - Armar version nueva'

# ------------------------------------------------------------- 1. revisar ---
Titulo '1. Revisando'

RevisarDependencias

# La web es el original: app\ se arma copiando de ahi (ver sincronizar.js).
node scripts/sincronizar.js
if ($LASTEXITCODE -ne 0) { Falla 'Los archivos de la app no se pudieron igualar con los de la web (ver arriba).' }
Ok 'Archivos de la app iguales a los de la web'

if (-not (Test-Path 'app\config.js')) { Falla 'Falta app\config.js (las claves de Firebase y de la planilla). Copialo de la carpeta raiz del sitio.' }
Ok 'app\config.js'

# ------------------------------------------------------------ 2. version ---
$actual = VersionActual

Titulo "2. Version actual: $actual"
Write-Host ''
Write-Host '    1) Arreglo      (corrige algo que andaba mal)'
Write-Host '    2) Mejora       (agrega o cambia algo)'
Write-Host '    3) Cambio grande'
Write-Host ''
$opcion = Read-Host '  Elegir 1, 2 o 3'
$tipo = switch ($opcion) { '1' { 'patch' } '2' { 'minor' } '3' { 'major' } default { $null } }
if (-not $tipo) { Falla 'Opcion no valida. No se armo nada.' }

Write-Host ''
$notas = (Read-Host '  En una linea, que cambio (aparece en el aviso de la caja)').Trim()

npm version $tipo --no-git-tag-version | Out-Null
if ($LASTEXITCODE -ne 0) { Falla 'No se pudo cambiar el numero de version.' }
$nueva = VersionActual
Ok "Version nueva: $nueva"

# ---------------------------------------------------------------- 3. armar ---
Titulo "3. Armando la version $nueva (tarda unos minutos)"
Write-Host ''

# Las notas quedan adentro de latest.yml: de ahi las lee el aviso de la caja.
$argumentos = @('electron-builder', '--win', '--publish', 'never')
if ($notas) { $argumentos += "-c.releaseInfo.releaseNotes=$notas" }
npx @argumentos

if ($LASTEXITCODE -ne 0) {
  # Se vuelve al numero anterior para que el proximo intento no saltee uno.
  npm version $actual --no-git-tag-version --allow-same-version | Out-Null
  Falla "No se pudo armar. Se dejo la version en $actual. Revisar los mensajes de arriba."
}

if ($notas) { [IO.File]::WriteAllText((ArchivoNotas $nueva), $notas, (New-Object Text.UTF8Encoding $false)) }

Final "LISTO. Version $nueva armada (todavia NO se subio)."
Write-Host "  Instalador: dist\Caja-HomePoint-Setup-$nueva.exe"
Write-Host ''
Write-Host '  Siguiente paso: doble clic en SUBIR VERSION.bat para que las cajas'
Write-Host '  la reciban. Antes se puede probar el instalador en una PC.'
Write-Host ''
Read-Host '  Enter para cerrar'
