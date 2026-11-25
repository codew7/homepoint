<#
===============================================================================
 subir.ps1 - Sube a GitHub la version que armo armar.ps1
===============================================================================

 Uso: doble clic en SUBIR VERSION.bat (o "npm run subir").

 Las versiones del Lector van a UN release fijo, "lector-win", marcado como
 pre-release: asi nunca figura como "latest" y el actualizador de Caja
 HomePoint (que mira releases/latest) no lo confunde con una version suya.
 Se reemplazan los archivos del release por los de la version nueva.

 Desde ese momento, los Lectores instalados la bajan solos en las proximas
 2 horas y la instalan cuando la PC esta sin uso.
#>

. "$PSScriptRoot\comun.ps1"

Encabezado 'LECTOR HOMEPOINT - Subir version a GitHub'

$repo = 'codew7/homepoint'
$tag  = 'lector-win'

# ------------------------------------------------------------- 1. revisar ---
Titulo '1. Revisando'

$version    = VersionActual
$instalador = "dist\Lector-HomePoint-Setup-$version.exe"
$archivos   = @($instalador, "$instalador.blockmap", 'dist\latest.yml')
foreach ($a in $archivos) {
  if (-not (Test-Path $a)) { Falla "Falta $a. Primero hay que armar la version con ARMAR VERSION.bat." }
}
if (-not (Select-String -Path 'dist\latest.yml' -Pattern "^version: $([regex]::Escape($version))\s*$" -Quiet)) {
  Falla "dist\latest.yml no es de la version $version. Volver a armarla con ARMAR VERSION.bat."
}
Ok "Instalador de la version $version"

# El token es el mismo que usa Caja HomePoint (variable GH_TOKEN del usuario).
$token = [Environment]::GetEnvironmentVariable('GH_TOKEN', 'User')
if (-not $token) { $token = $env:GH_TOKEN }
if (-not $token) {
  Write-Host ''
  Write-Host '  Falta el permiso para subir versiones a GitHub (se pide una sola vez).' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '    1. Se abre GitHub en el navegador.'
  Write-Host '    2. Note: "Publicar Lector HomePoint". Expiration: "No expiration".'
  Write-Host '    3. Tildar "repo". Boton verde "Generate token" al final.'
  Write-Host '    4. Copiar el codigo que empieza con ghp_ y pegarlo aca.'
  Write-Host ''
  Start-Process 'https://github.com/settings/tokens/new?scopes=repo&description=Publicar%20Lector%20HomePoint'
  $token = (Read-Host '  Pegar el token y Enter').Trim()
  if (-not $token) { Falla 'No se pego ningun token.' }
  [Environment]::SetEnvironmentVariable('GH_TOKEN', $token, 'User')
}
Ok 'Permiso de GitHub'

$archivoNotas = ArchivoNotas $version
$notas = if (Test-Path $archivoNotas) { (Get-Content $archivoNotas -Raw -Encoding UTF8).Trim() } else { '' }

# ----------------------------------------------------------- 2. confirmar ---
$armado = (Get-Item $instalador).LastWriteTime.ToString('dd/MM/yyyy HH:mm')
Titulo "2. Version $version (armada el $armado)"
if ($notas) { Write-Host "     Que cambio: $notas" }
Write-Host ''
Write-Host '  Al subirla, todos los Lectores la reciben en las proximas 2 horas.' -ForegroundColor Yellow
$si = Read-Host '  Subirla? Escribir S y Enter'
if ($si.Trim().ToUpper() -ne 'S') { Falla 'No se subio nada.' }

# ---------------------------------------------------------------- 3. subir ---
Titulo "3. Subiendo la version $version (tarda unos minutos)"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$cabeceras = @{ Authorization = "token $token"; 'User-Agent' = 'Lector-HomePoint'; Accept = 'application/vnd.github+json' }
$api = "https://api.github.com/repos/$repo"

# El release fijo: se crea la primera vez (pre-release, nunca "latest").
$release = $null
try { $release = Invoke-RestMethod -Headers $cabeceras -Uri "$api/releases/tags/$tag" } catch { $release = $null }
$cuerpoTexto = "Lector HomePoint $version" + $(if ($notas) { " - $notas" } else { '' }) + "`n`nInstalador: Lector-HomePoint-Setup-$version.exe"
if (-not $release) {
  $datos = @{ tag_name = $tag; name = 'Lector HomePoint (Windows)'; body = $cuerpoTexto; prerelease = $true; make_latest = 'false' } | ConvertTo-Json
  try {
    $release = Invoke-RestMethod -Method Post -Headers $cabeceras -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($datos)) -Uri "$api/releases"
  } catch { Falla "No se pudo crear el release $tag en GitHub: $($_.Exception.Message)" }
  Ok "Release $tag creado"
} else {
  $datos = @{ body = $cuerpoTexto; prerelease = $true; make_latest = 'false' } | ConvertTo-Json
  try { Invoke-RestMethod -Method Patch -Headers $cabeceras -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($datos)) -Uri $release.url | Out-Null } catch {}
}

# Se borran los archivos de la version anterior y se suben los nuevos.
foreach ($asset in @($release.assets)) {
  if (-not $asset) { continue }
  try { Invoke-RestMethod -Method Delete -Headers $cabeceras -Uri "$api/releases/assets/$($asset.id)" | Out-Null } catch {
    Write-Host "  (No se pudo borrar $($asset.name): $($_.Exception.Message))" -ForegroundColor Yellow
  }
}
# latest.yml va ultimo: es el que avisa a los Lectores, y para entonces el instalador ya esta.
foreach ($a in $archivos) {
  $nombre = Split-Path $a -Leaf
  Write-Host "  Subiendo $nombre..."
  $url = "https://uploads.github.com/repos/$repo/releases/$($release.id)/assets?name=$([uri]::EscapeDataString($nombre))"
  try {
    Invoke-RestMethod -Method Post -Headers $cabeceras -ContentType 'application/octet-stream' -InFile $a -Uri $url | Out-Null
  } catch { Falla "No se pudo subir $nombre : $($_.Exception.Message). Volver a correr SUBIR VERSION.bat." }
}
Ok 'Archivos subidos'

Final "LISTO. Version $version subida."
Write-Host '  Los Lectores la bajan solos en las proximas 2 horas y la instalan'
Write-Host '  cuando la PC esta sin uso. Recordar commitear package.json.'
Write-Host ''
Write-Host "  https://github.com/$repo/releases/tag/$tag"
Write-Host ''
Read-Host '  Enter para cerrar'
