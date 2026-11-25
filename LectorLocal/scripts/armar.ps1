<#
===============================================================================
 armar.ps1 - Arma una version nueva de Lector HomePoint (sin subirla)
===============================================================================

 Uso: doble clic en ARMAR VERSION.bat (o "npm run armar").

 Que hace:
   1. Revisa que esten las dependencias (la primera vez las instala).
   2. Pregunta que tipo de cambio es y sube el numero de version.
   3. Arma el instalador en la carpeta dist. NO lo sube: los Lectores no se
      enteran hasta correr SUBIR VERSION.bat (subir.ps1).

 Ojo: esto es solo el programa de Windows. La pantalla del Lector
 (reposicion2\lector.html) esta en el sitio y se actualiza sola al publicar
 con "Publicar Reposicion.bat": para cambiarla no hace falta armar nada.
#>

. "$PSScriptRoot\comun.ps1"

Encabezado 'LECTOR HOMEPOINT - Armar version nueva'

# ------------------------------------------------------------- 1. revisar ---
Titulo '1. Revisando'

RevisarDependencias

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
$notas = (Read-Host '  En una linea, que cambio').Trim()

npm version $tipo --no-git-tag-version | Out-Null
if ($LASTEXITCODE -ne 0) { Falla 'No se pudo cambiar el numero de version.' }
$nueva = VersionActual
Ok "Version nueva: $nueva"

# ---------------------------------------------------------------- 3. armar ---
Titulo "3. Armando la version $nueva (tarda unos minutos)"
Write-Host ''

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
Write-Host "  Instalador: dist\Lector-HomePoint-Setup-$nueva.exe"
Write-Host ''
Write-Host '  Siguiente paso: doble clic en SUBIR VERSION.bat para que los'
Write-Host '  Lectores instalados la reciban. Antes se puede probar en una PC.'
Write-Host ''
Read-Host '  Enter para cerrar'
