<#
===============================================================================
 desinstalar.ps1 - Saca los accesos directos de esta PC
===============================================================================

 La instalación no dejó nada en el sistema salvo los accesos directos, así que
 desinstalar es borrarlos. La carpeta CajaLocal se borra a mano cuando se
 quiera; este script no la toca.

 Aparte pregunta si borrar el perfil del navegador de la caja. Ese perfil es
 donde vive la sesión iniciada: si se borra, la próxima vez hay que volver a
 escribir usuario y contraseña.
#>

$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$escritorio = [Environment]::GetFolderPath('Desktop')
$menuInicio = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\HomePoint'
$perfil     = Join-Path $env:LOCALAPPDATA 'HomePointCaja'

Clear-Host
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Yellow
Write-Host '    CAJA HOMEPOINT - Quitar de esta PC' -ForegroundColor Yellow
Write-Host '  ===============================================================' -ForegroundColor Yellow
Write-Host ''

# Antes de borrar nada conviene apagar lo que esté corriendo.
& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'detener.ps1')

$borrados = 0
$acceso = Join-Path $escritorio 'Caja HomePoint.lnk'
if (Test-Path $acceso) { Remove-Item $acceso -Force; $borrados++; Write-Host '  [OK] Acceso del Escritorio borrado' -ForegroundColor Green }
if (Test-Path $menuInicio) { Remove-Item $menuInicio -Recurse -Force; $borrados++; Write-Host '  [OK] Carpeta del menú Inicio borrada' -ForegroundColor Green }
if ($borrados -eq 0) { Write-Host '  No había accesos directos instalados.' -ForegroundColor DarkGray }

Write-Host ''
if (Test-Path $perfil) {
  $r = Read-Host '  ¿Borrar también la sesión guardada del navegador? (S/N)'
  if ($r -match '^[sSyY]') {
    Remove-Item $perfil -Recurse -Force
    Write-Host '  [OK] Sesión borrada: la próxima vez pedirá usuario y contraseña.' -ForegroundColor Green
  } else {
    Write-Host '  Se conserva la sesión guardada.' -ForegroundColor DarkGray
  }
}

Write-Host ''
Write-Host '  Listo. La carpeta CajaLocal se puede borrar a mano cuando quieras.' -ForegroundColor Yellow
Write-Host ''
Read-Host '  Enter para cerrar'
