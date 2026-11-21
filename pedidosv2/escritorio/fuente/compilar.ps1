# Compila PedidosHomePoint.exe con el compilador de C# que ya trae Windows
# (.NET Framework 4.8). No hace falta instalar nada.
#
#   compilar.ps1              sube la versión (1.0.0 -> 1.0.1) y compila
#   compilar.ps1 -SinSubir    compila con la misma versión
#
# Deja en la carpeta "escritorio" (la que publica el hosting):
#   PedidosHomePoint.exe  el programa (instala y se actualiza solo)
#   version.txt           versión + huella sha256; las PCs lo consultan

param([switch]$SinSubir)
$ErrorActionPreference = 'Stop'

$fuente = $PSScriptRoot
$salida = Split-Path $fuente -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "No se encontró el compilador: $csc" }

$archivoVersion = Join-Path $fuente 'VERSION'
$version = (Get-Content $archivoVersion -Raw).Trim()
if (-not $SinSubir) {
  $p = $version.Split('.') | ForEach-Object { [int]$_ }
  $p[2]++
  $version = ($p -join '.')
  [IO.File]::WriteAllText($archivoVersion, "$version`n")
}
Write-Host "== Compilando Pedidos HomePoint $version ==" -ForegroundColor Cyan

$obj = Join-Path $fuente 'obj'
New-Item -ItemType Directory -Force $obj | Out-Null
[IO.File]::WriteAllText((Join-Path $obj 'VersionApp.cs'),
  "static class VersionApp { public const string Numero = `"$version`"; }`n")

$lib = Join-Path $fuente 'lib'
$exe = Join-Path $salida 'PedidosHomePoint.exe'
$tmp = Join-Path $obj 'PedidosHomePoint.exe'

$argumentos = @(
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output', '/codepage:65001',
  "/out:$tmp",
  "/win32icon:$(Join-Path $fuente 'icono.ico')",
  "/win32manifest:$(Join-Path $fuente 'app.manifest')",
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  "/reference:$(Join-Path $lib 'Microsoft.Web.WebView2.Core.dll')",
  "/reference:$(Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll')",
  "/resource:$(Join-Path $lib 'Microsoft.Web.WebView2.Core.dll'),Microsoft.Web.WebView2.Core.dll",
  "/resource:$(Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll'),Microsoft.Web.WebView2.WinForms.dll",
  "/resource:$(Join-Path $lib 'WebView2Loader.dll'),WebView2Loader.dll",
  (Join-Path $fuente 'Program.cs'),
  (Join-Path $obj 'VersionApp.cs')
)
& $csc $argumentos
if ($LASTEXITCODE -ne 0) { throw "La compilación falló (código $LASTEXITCODE)." }

Copy-Item $tmp $exe -Force
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $salida 'version.txt'), "version=$version`nsha256=$sha`n")

$kb = [math]::Round((Get-Item $exe).Length / 1KB)
Write-Host "Listo: $exe ($kb KB), versión $version" -ForegroundColor Green
