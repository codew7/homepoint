<#
===============================================================================
 subir.ps1 - Sube a GitHub la version que armo armar.ps1
===============================================================================

 Uso: doble clic en SUBIR VERSION.bat (o "npm run subir").

 Que hace:
   1. Revisa que en dist este el instalador de la version de package.json
      (lo arma ARMAR VERSION.bat) y el permiso (token) de GitHub.
   2. Pide confirmar y lo sube a GitHub Releases (codew7/homepoint).

 Desde ese momento, todas las cajas instaladas la bajan solas en las
 proximas 2 horas y la instalan al cerrarse.
#>

. "$PSScriptRoot\comun.ps1"

Encabezado 'CAJA HOMEPOINT - Subir version a GitHub'

# ------------------------------------------------------------- 1. revisar ---
Titulo '1. Revisando'

RevisarDependencias

$version   = VersionActual
$instalador = "dist\Caja-HomePoint-Setup-$version.exe"
$archivos  = @($instalador, "$instalador.blockmap", 'dist\latest.yml')
foreach ($a in $archivos) {
  if (-not (Test-Path $a)) { Falla "Falta $a. Primero hay que armar la version con ARMAR VERSION.bat." }
}
# latest.yml es el que avisa a las cajas: tiene que ser de esta misma version.
if (-not (Select-String -Path 'dist\latest.yml' -Pattern "^version: $([regex]::Escape($version))\s*$" -Quiet)) {
  Falla "dist\latest.yml no es de la version $version. Volver a armarla con ARMAR VERSION.bat."
}
Ok "Instalador de la version $version"

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

$archivoNotas = ArchivoNotas $version
$notas = if (Test-Path $archivoNotas) { (Get-Content $archivoNotas -Raw -Encoding UTF8).Trim() } else { '' }

# ----------------------------------------------------------- 2. confirmar ---
$armado = (Get-Item $instalador).LastWriteTime.ToString('dd/MM/yyyy HH:mm')
Titulo "2. Version $version (armada el $armado)"
if ($notas) { Write-Host "     Que cambio: $notas" }
Write-Host ''
Write-Host '  Al subirla, todas las cajas la reciben en las proximas 2 horas.' -ForegroundColor Yellow
$si = Read-Host '  Subirla? Escribir S y Enter'
if ($si.Trim().ToUpper() -ne 'S') { Falla 'No se subio nada.' }

# ---------------------------------------------------------------- 3. subir ---
Titulo "3. Subiendo la version $version (tarda unos minutos)"
Write-Host ''

$argumentos = @('electron-builder', 'publish', '--policy', 'always', '--version', $version)
foreach ($a in $archivos) { $argumentos += @('--files', $a) }
npx @argumentos
if ($LASTEXITCODE -ne 0) { Falla 'No se pudo subir. Revisar los mensajes de arriba y volver a intentar.' }

# La linea "que cambio" tambien en la pagina de la version en GitHub (el aviso
# de la caja ya la tiene adentro de latest.yml: si esto falla no pasa nada).
if ($notas) {
  try {
    $cabeceras = @{ Authorization = "token $token"; 'User-Agent' = 'Caja-HomePoint' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod -Headers $cabeceras -Uri "https://api.github.com/repos/codew7/homepoint/releases/tags/v$version"
    $cuerpo = [Text.Encoding]::UTF8.GetBytes((@{ body = $notas } | ConvertTo-Json))
    Invoke-RestMethod -Method Patch -Headers $cabeceras -ContentType 'application/json; charset=utf-8' -Body $cuerpo -Uri $release.url | Out-Null
  } catch {
    Write-Host '  (No se pudo poner la nota en la pagina de GitHub; las cajas igual la ven.)' -ForegroundColor Yellow
  }
}

Final "LISTO. Version $version subida."
Write-Host '  Las cajas la bajan solas en las proximas 2 horas y la instalan al'
Write-Host '  cerrarse. Recordar commitear package.json con el numero nuevo.'
Write-Host ''
Write-Host "  https://github.com/codew7/homepoint/releases/tag/v$version"
Write-Host ''
Read-Host '  Enter para cerrar'
