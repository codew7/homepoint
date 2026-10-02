<#
===============================================================================
 inicio_automatico.ps1 - Abre la Caja HomePoint sola al prender la PC
===============================================================================

 Crea (o quita) una tarea en el Programador de tareas de Windows que, cada vez
 que el usuario actual inicia sesión, ejecuta lo mismo que el acceso directo
 del Escritorio: sistema\iniciar.vbs.

 Detalles:
   - La tarea es solo para el usuario que ejecuta este script y corre con sus
     permisos normales: no hace falta ser administrador.
   - Espera unos segundos después del inicio de sesión para darle tiempo a
     Windows a conectarse a internet antes de abrir la caja.
   - Si la tarea ya existe, el script ofrece quitarla.
   - Si la carpeta se mueve de lugar, hay que volver a ejecutarlo, porque la
     tarea guarda la ruta completa (igual que los accesos directos).
#>

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$sistema = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs     = Join-Path $sistema 'iniciar.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$nombre  = 'Caja HomePoint - Inicio automático'
$espera  = 30   # segundos tras iniciar sesión, para que haya internet

function Ok($t)    { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Falla($t) { Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Nota($t)  { Write-Host "          $t" -ForegroundColor DarkGray }

Clear-Host
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host '    CAJA HOMEPOINT - Abrir sola al prender la PC' -ForegroundColor Cyan
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $vbs)) {
  Falla 'Falta el archivo sistema\iniciar.vbs.'
  Nota 'Volvé a copiar la carpeta CajaLocal entera y probá de nuevo.'
  Write-Host ''
  Read-Host '  Enter para cerrar'
  exit 1
}

$existente = Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue

# ------------------------------------------------ ya estaba: ofrecer quitar ---
if ($existente) {
  Write-Host '  El inicio automático YA ESTÁ ACTIVADO en esta PC.'
  Write-Host ''
  $r = Read-Host '  ¿Querés DESACTIVARLO? (S/N)'
  if ($r -match '^[sSyY]') {
    try {
      Unregister-ScheduledTask -TaskName $nombre -Confirm:$false
      Write-Host ''
      Ok 'Inicio automático desactivado. La caja ya no se abre sola.'
    } catch {
      Write-Host ''
      Falla "No se pudo quitar la tarea: $($_.Exception.Message)"
      Write-Host ''
      Read-Host '  Enter para cerrar'
      exit 1
    }
  } else {
    # Se vuelve a registrar igual, por si la carpeta cambió de lugar.
    $r2 = Read-Host '  ¿Actualizarlo con la ubicación actual de la carpeta? (S/N)'
    if ($r2 -notmatch '^[sSyY]') {
      Write-Host ''
      Nota 'No se cambió nada.'
      Write-Host ''
      Read-Host '  Enter para cerrar'
      exit 0
    }
    $existente = $null
  }
}

# ------------------------------------------------------ crear la tarea ---
if (-not $existente) {
  try {
    $usuario  = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $accion   = New-ScheduledTaskAction -Execute $wscript -Argument "`"$vbs`"" -WorkingDirectory $sistema
    $disparo  = New-ScheduledTaskTrigger -AtLogOn -User $usuario
    $disparo.Delay = "PT${espera}S"
    $quien    = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
    $ajustes  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparo `
      -Principal $quien -Settings $ajustes -Force `
      -Description 'Abre la Caja HomePoint al iniciar sesión en Windows.' | Out-Null

    Ok 'Inicio automático activado.'
    Write-Host ''
    Write-Host "  Desde ahora, al prender la PC y entrar con el usuario '$env:USERNAME',"
    Write-Host "  la caja se abre sola a los $espera segundos."
    Write-Host ''
    Nota 'Para desactivarlo: ejecutar otra vez INICIO AUTOMATICO.bat.'
    Nota 'Si la carpeta CajaLocal se mueve de lugar, hay que volver a ejecutarlo.'
  } catch {
    Falla "No se pudo crear la tarea: $($_.Exception.Message)"
    Write-Host ''
    Read-Host '  Enter para cerrar'
    exit 1
  }
}

Write-Host ''
Read-Host '  Enter para cerrar'
