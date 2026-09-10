<#
===============================================================================
 instalar.ps1 - Deja la Caja HomePoint lista para usar con un doble clic
===============================================================================

 No copia nada al sistema ni toca el registro de Windows: el programa vive
 entero dentro de esta carpeta. Lo único que hace la instalación es:

   1. Revisar que estén todos los archivos del paquete.
   2. Fabricar el ícono (.ico) a partir del favicon de la caja.
   3. Crear los accesos directos en el Escritorio y en el menú Inicio.

 Por eso "desinstalar" es solo borrar esos accesos: no queda nada suelto.
 Si la carpeta se mueve de lugar, hay que volver a ejecutar la instalación,
 porque los accesos directos guardan la ruta completa.
#>

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$sistema = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz    = Split-Path -Parent $sistema
$app     = Join-Path $raiz 'app'
$vbs     = Join-Path $sistema 'iniciar.vbs'
$ico     = Join-Path $sistema 'caja.ico'

function Titulo($t) {
  Write-Host ''
  Write-Host "  $t" -ForegroundColor Cyan
  Write-Host '  ---------------------------------------------------------------'
}
function Ok($t)    { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Falla($t) { Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Nota($t)  { Write-Host "          $t" -ForegroundColor DarkGray }

Clear-Host
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Cyan
Write-Host '    CAJA HOMEPOINT - Instalación en esta PC' -ForegroundColor Cyan
Write-Host '  ===============================================================' -ForegroundColor Cyan

# ------------------------------------------------- 1. archivos del paquete ---
Titulo '1. Revisando los archivos del paquete'

$requeridos = @(
  'ingresoPedidoV2.html', 'ingresoPedidoV2.css', 'ingresoPedidoV2.js',
  'historialRecientes.html', 'login.html',
  'config.js', 'sw-imagenes.js', 'logo.png', 'faviconnegro.png'
)

$faltantes = @()
foreach ($archivo in $requeridos) {
  if (-not (Test-Path (Join-Path $app $archivo))) { $faltantes += $archivo }
}
if (-not (Test-Path $vbs))                        { $faltantes += 'sistema\iniciar.vbs' }
if (-not (Test-Path (Join-Path $sistema 'servidor.ps1'))) { $faltantes += 'sistema\servidor.ps1' }

if ($faltantes.Count -gt 0) {
  Falla 'El paquete está incompleto. Faltan estos archivos:'
  $faltantes | ForEach-Object { Write-Host "            - $_" -ForegroundColor Red }
  Write-Host ''
  Nota 'Volvé a copiar la carpeta CajaLocal entera y ejecutá otra vez INSTALAR.bat.'
  Write-Host ''
  Read-Host '  Enter para cerrar'
  exit 1
}
Ok "$($requeridos.Count) archivos de la caja presentes"

# --------------------------------------------------------------- 2. ícono ---
Titulo '2. Preparando el ícono'

# El favicon de la caja se convierte en un .ico de verdad, con las cuatro
# medidas que Windows pide según dónde dibuje el acceso (barra de tareas,
# escritorio, vista de iconos grandes). Un .ico es un índice de imágenes:
# encabezado de 6 bytes, una entrada de 16 por medida, y atrás las imágenes.
# Cada medida se guarda como PNG, que es lo que Windows usa desde Vista y
# ocupa una fracción de lo que ocuparía el formato viejo sin comprimir.
try {
  Add-Type -AssemblyName System.Drawing

  $medidas = @(16, 32, 48, 96)
  $origen  = [System.Drawing.Image]::FromFile((Join-Path $app 'faviconnegro.png'))
  $piezas  = @()

  foreach ($m in $medidas) {
    $lienzo = New-Object System.Drawing.Bitmap($m, $m, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $pincel = [System.Drawing.Graphics]::FromImage($lienzo)
    $pincel.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $pincel.Clear([System.Drawing.Color]::Transparent)
    $pincel.DrawImage($origen, 0, 0, $m, $m)
    $pincel.Dispose()

    $memoria = New-Object System.IO.MemoryStream
    $lienzo.Save($memoria, [System.Drawing.Imaging.ImageFormat]::Png)
    $piezas += , @{ medida = $m; bytes = $memoria.ToArray() }
    $lienzo.Dispose(); $memoria.Dispose()
  }
  $origen.Dispose()

  $flujo   = New-Object System.IO.MemoryStream
  $escribe = New-Object System.IO.BinaryWriter($flujo)

  $escribe.Write([UInt16]0)                # reservado
  $escribe.Write([UInt16]1)                # tipo: 1 = ícono
  $escribe.Write([UInt16]$piezas.Count)    # cuántas medidas vienen

  $posicion = 6 + (16 * $piezas.Count)     # las imágenes arrancan tras el índice
  foreach ($pieza in $piezas) {
    $escribe.Write([Byte]$pieza.medida)          # ancho
    $escribe.Write([Byte]$pieza.medida)          # alto
    $escribe.Write([Byte]0)                      # colores de paleta (0 = sin paleta)
    $escribe.Write([Byte]0)                      # reservado
    $escribe.Write([UInt16]1)                    # planos
    $escribe.Write([UInt16]32)                   # bits por píxel
    $escribe.Write([UInt32]$pieza.bytes.Length)  # cuánto ocupa
    $escribe.Write([UInt32]$posicion)            # dónde empieza
    $posicion += $pieza.bytes.Length
  }
  foreach ($pieza in $piezas) { $escribe.Write($pieza.bytes) }
  $escribe.Flush()

  [IO.File]::WriteAllBytes($ico, $flujo.ToArray())
  $escribe.Dispose(); $flujo.Dispose()
  Ok "Ícono generado ($($medidas -join ', ') píxeles)"
} catch {
  # Sin ícono el acceso directo igual funciona: sale con el dibujo genérico.
  $ico = ''
  Nota "No se pudo generar el ícono ($($_.Exception.Message)). Se usa el genérico."
}

# --------------------------------------------------- 3. accesos directos ---
Titulo '3. Creando los accesos directos'

$shell       = New-Object -ComObject WScript.Shell
$escritorio  = [Environment]::GetFolderPath('Desktop')
$menuInicio  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\HomePoint'
$wscript     = Join-Path $env:SystemRoot 'System32\wscript.exe'

New-Item -ItemType Directory -Force -Path $menuInicio | Out-Null

function Crear-Acceso {
  param([string]$Ruta, [string]$Destino, [string]$Argumentos, [string]$Descripcion, [string]$Icono)
  $acceso = $shell.CreateShortcut($Ruta)
  $acceso.TargetPath       = $Destino
  $acceso.Arguments        = $Argumentos
  $acceso.WorkingDirectory = $sistema
  $acceso.Description      = $Descripcion
  if ($Icono) { $acceso.IconLocation = "$Icono,0" }
  $acceso.Save()
}

$destinos = @(
  (Join-Path $escritorio 'Caja HomePoint.lnk'),
  (Join-Path $menuInicio 'Caja HomePoint.lnk')
)
foreach ($d in $destinos) {
  Crear-Acceso -Ruta $d -Destino $wscript -Argumentos "`"$vbs`"" `
               -Descripcion 'Abre la caja de HomePoint en esta PC' -Icono $ico
}
Ok 'Acceso directo en el Escritorio'
Ok 'Acceso directo en el menú Inicio (carpeta HomePoint)'

Crear-Acceso -Ruta (Join-Path $menuInicio 'Detener Caja HomePoint.lnk') `
             -Destino (Join-Path $sistema 'DETENER.bat') -Argumentos '' `
             -Descripcion 'Apaga el servidor local de la caja' -Icono ''
Ok 'Acceso "Detener" en el menú Inicio (por si algo queda colgado)'

# ------------------------------------------------------------- resultado ---
Write-Host ''
Write-Host '  ===============================================================' -ForegroundColor Green
Write-Host '    LISTO. Ya está instalada.' -ForegroundColor Green
Write-Host '  ===============================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Para trabajar: doble clic en "Caja HomePoint" del Escritorio.'
Write-Host '  Para cerrar:   cerrar la ventana de la caja, como cualquier programa.'
Write-Host ''
Nota 'Esta carpeta no se puede mover de lugar sin volver a ejecutar INSTALAR.bat.'
Nota 'La caja necesita internet: los datos viven en Firebase, no en esta PC.'
Write-Host ''

$abrir = Read-Host '  ¿Abrir la caja ahora para probar? (S/N)'
if ($abrir -match '^[sSyY]') {
  Start-Process -FilePath $wscript -ArgumentList "`"$vbs`""
  Write-Host ''
  Ok 'Abriendo... la primera vez puede tardar unos segundos.'
  Start-Sleep -Seconds 3
} else {
  Write-Host ''
  Read-Host '  Enter para cerrar'
}
