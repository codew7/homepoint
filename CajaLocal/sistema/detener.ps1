<#
===============================================================================
 detener.ps1 - Apaga el servidor local y cierra la ventana de la caja
===============================================================================

 En el uso normal esto no hace falta: el servidor se apaga solo cuando se
 cierra la ventana de la caja. Existe para el caso raro en que quede algo
 colgado (por ejemplo si la PC no tenía Chrome ni Edge y la caja se abrió en
 el navegador común, donde no hay forma de saber cuándo la cerraron).

 Solo toca procesos propios: el PowerShell que está ejecutando servidor.ps1 y
 el navegador abierto con el perfil exclusivo de la caja. El navegador
 personal del usuario, con sus pestañas, no se toca.
#>

$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$perfil = Join-Path $env:LOCALAPPDATA 'HomePointCaja\navegador'
$cerrados = 0

Write-Host ''
Write-Host '  Deteniendo la Caja HomePoint...' -ForegroundColor Cyan
Write-Host ''

foreach ($p in Get-CimInstance Win32_Process -Filter "Name='powershell.exe'") {
  if ($p.CommandLine -and $p.CommandLine -like '*-File*servidor.ps1*') {
    Stop-Process -Id $p.ProcessId -Force
    $cerrados++
    Write-Host "  [OK] Servidor local detenido (proceso $($p.ProcessId))" -ForegroundColor Green
  }
}

foreach ($nombre in @('chrome', 'msedge')) {
  foreach ($p in Get-CimInstance Win32_Process -Filter "Name='$nombre.exe'") {
    if ($p.CommandLine -and $p.CommandLine -like "*$perfil*") {
      Stop-Process -Id $p.ProcessId -Force
      $cerrados++
    }
  }
}

if ($cerrados -eq 0) {
  Write-Host '  No había nada corriendo. Todo en orden.' -ForegroundColor DarkGray
} else {
  Write-Host ''
  Write-Host '  Listo. Se puede volver a abrir desde el acceso del Escritorio.' -ForegroundColor Green
}

Write-Host ''
Start-Sleep -Seconds 2
