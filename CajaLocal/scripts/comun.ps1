<#
===============================================================================
 comun.ps1 - Lo que comparten armar.ps1 y subir.ps1
===============================================================================
 Se carga con ". $PSScriptRoot\comun.ps1" al principio de cada uno.
#>

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

function Titulo($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [OK] $t" -ForegroundColor Green }
function Falla($t)  { Write-Host ''; Write-Host "  [X] $t" -ForegroundColor Red; Write-Host ''; Read-Host '  Enter para cerrar'; exit 1 }

function Encabezado($t) {
  Write-Host ''
  Write-Host '  ===============================================================' -ForegroundColor Cyan
  Write-Host "    $t" -ForegroundColor Cyan
  Write-Host '  ===============================================================' -ForegroundColor Cyan
}

function Final($t) {
  Write-Host ''
  Write-Host '  ===============================================================' -ForegroundColor Green
  Write-Host "    $t" -ForegroundColor Green
  Write-Host '  ===============================================================' -ForegroundColor Green
  Write-Host ''
}

function RevisarDependencias {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Falla 'No esta instalado Node.js (https://nodejs.org).' }
  if (-not (Test-Path 'node_modules')) {
    Write-Host '  Instalando dependencias (solo la primera vez)...'
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Falla 'No se pudieron instalar las dependencias.' }
  }
  Ok 'Dependencias'
}

function VersionActual {
  return (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
}

# Archivo con la linea "que cambio" de cada version: lo escribe armar.ps1 y lo
# lee subir.ps1 para ponerlo en la pagina de la version en GitHub.
function ArchivoNotas($version) {
  return Join-Path $raiz "dist\notas-$version.txt"
}
