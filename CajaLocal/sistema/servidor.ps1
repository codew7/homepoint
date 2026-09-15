<#
===============================================================================
 servidor.ps1 - Servidor local de la Caja HomePoint
===============================================================================

 QUE HACE
 Publica la carpeta "app" en http://localhost:8123 y abre la caja en el
 navegador. Nada sale de esta PC: el servidor escucha solamente en la placa de
 loopback (localhost), no en la red.

 POR QUE HACE FALTA
 Abrir el HTML con doble clic (file://) no sirve: bajo ese esquema el navegador
 le asigna a la pagina el origen "null", y entonces Firebase Auth rechaza el
 login, el Service Worker de fotos no se registra y los pedidos a Google Sheets
 mueren por CORS. Servido desde localhost el navegador lo trata como un sitio
 normal y seguro, y todo eso funciona.

 NO NECESITA NADA INSTALADO
 Usa System.Net.HttpListener, que ya viene con Windows. No hay Node, ni Python,
 ni dependencias que mantener actualizadas.

 CICLO DE VIDA
 Se enciende con el acceso directo y se apaga solo cuando se cierra la ventana
 de la caja. Si ya habia un servidor prendido no levanta otro: reusa el que
 esta corriendo y solamente abre una ventana nueva.

 ARCHIVO EN ASCII A PROPOSITO
 Windows PowerShell 5.1 lee mal los .ps1 en UTF-8 sin BOM. Este script evita
 letras acentuadas para que no dependa de eso y nunca se rompa al copiarlo.
#>

param(
  [int[]]$Puertos = @(8123, 8124, 8125),
  [string]$Pagina = 'ingresoPedidoV2.html'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$carpetaSistema  = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz            = Split-Path -Parent $carpetaSistema
$app             = Join-Path $raiz 'app'
$archivoLog      = Join-Path $carpetaSistema 'registro.txt'
$archivoLogNuevo = Join-Path $raiz 'registro_nuevo.txt'
$perfilNavegador = Join-Path $env:LOCALAPPDATA 'HomePointCaja\navegador'

# ---------------------------------------------------------------- registro ---
# El servidor corre sin ventana: si algo falla, este archivo es la unica pista.
# Se poda solo, para que no crezca sin limite en una PC que no se apaga nunca.
function Escribir-Log {
  param([string]$Texto)
  try {
    $linea = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Texto
    Add-Content -Path $archivoLog -Value $linea -Encoding UTF8
    $info = Get-Item $archivoLog -ErrorAction SilentlyContinue
    if ($info -and $info.Length -gt 200KB) {
      $ultimas = Get-Content $archivoLog -Tail 300
      Set-Content -Path $archivoLog -Value $ultimas -Encoding UTF8
    }
  } catch {}
}

# --------------------------------------------------- registro del boton Nuevo ---
# La caja avisa (POST /__log) cada vez que se pierde un pedido con articulos
# cargados sin haberlo ingresado: por el boton "Nuevo" (motivo Nuevo) o porque se
# cerro la ventana (motivo Cierre). Asi queda rastro de las ventas armadas y
# descartadas. Cada linea: fecha | hora | motivo | vendedor | subtotal | articulos.
# No se poda: es un registro de auditoria y tiene que conservarse completo.
function Escribir-Log-Nuevo {
  param($Datos)

  $motivo = [string]$Datos.motivo
  if (-not $motivo) { $motivo = 'Nuevo' }

  $articulos = '(sin articulos)'
  if ($Datos.articulos -and @($Datos.articulos).Count -gt 0) {
    $partes = @()
    foreach ($a in @($Datos.articulos)) {
      $nombre = [string]$a.nombre
      if (-not $nombre) { $nombre = '(sin nombre)' }
      $texto = '{0}x {1}' -f $a.cantidad, $nombre
      # Las lineas de devolucion o garantia se marcan para no confundirlas con ventas.
      if ($a.tipo -and $a.tipo -ne 'VENTA') { $texto += ' [' + $a.tipo + ']' }
      $partes += $texto
    }
    $articulos = $partes -join '; '
  }

  $subtotal = [string]$Datos.subtotal
  if (-not $subtotal) { $subtotal = '0' }
  $vendedor = [string]$Datos.vendedor
  if (-not $vendedor) { $vendedor = '(sin vendedor)' }

  $linea = '{0} | {1} | {2} | Vendedor: {3} | Subtotal: {4} | {5}' -f `
    (Get-Date -Format 'yyyy-MM-dd'), (Get-Date -Format 'HH:mm:ss'), $motivo, $vendedor, $subtotal, $articulos
  Add-Content -Path $archivoLogNuevo -Value $linea -Encoding UTF8
}

function Avisar {
  param([string]$Texto)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($Texto, 'Caja HomePoint', 'OK', 'Error') | Out-Null
  } catch {}
}

if (-not (Test-Path $app)) {
  Escribir-Log "ERROR: no existe la carpeta app en $app"
  Avisar "No se encontro la carpeta 'app'.`n`nEsperada en:`n$app`n`nHay que copiar la carpeta CajaLocal completa, no solamente el acceso directo."
  exit 1
}

# ------------------------------------------------------ ventana maximizada ---
# La caja tiene que arrancar ocupando toda la pantalla. --start-maximized por si
# solo no alcanza: en modo aplicacion (--app) Chrome y Edge recuerdan el tamano
# de la ventana guardado en el perfil y lo vuelven a aplicar. Por eso, apenas la
# ventana existe, se la maximiza con la API de Windows (SW_MAXIMIZE = 3).
$tipoVentanaListo = $true
if (-not ('HomePoint.Ventana' -as [type])) {
  try {
    Add-Type -Namespace HomePoint -Name Ventana -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
'@
  } catch {
    $tipoVentanaListo = $false
  }
}

function Medir-Pantalla {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    return @($area.Width, $area.Height)
  } catch {
    return @(0, 0)
  }
}

function Maximizar-Ventana {
  param($Proceso)

  if (-not $tipoVentanaListo) { return }

  $limite = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $limite) {

    $ventana = [IntPtr]::Zero

    # Caso normal: la ventana es del proceso que acabamos de lanzar.
    if ($Proceso -ne $null) {
      try {
        $Proceso.Refresh()
        if (-not $Proceso.HasExited) { $ventana = $Proceso.MainWindowHandle }
      } catch {}
    }

    # Caso "ya habia una ventana de la caja abierta": el exe que se lanza le pasa
    # la orden al navegador que ya estaba corriendo y se apaga enseguida, asi que
    # la ventana hay que buscarla entre los procesos de nuestro perfil.
    if ($ventana -eq [IntPtr]::Zero) {
      foreach ($nombre in @('chrome', 'msedge')) {
        $procesos = @(Get-CimInstance Win32_Process -Filter "Name='$nombre.exe'" -ErrorAction SilentlyContinue |
                      Where-Object { $_.CommandLine -and $_.CommandLine -like "*$perfilNavegador*" })
        foreach ($pr in $procesos) {
          $obj = Get-Process -Id $pr.ProcessId -ErrorAction SilentlyContinue
          if ($obj -and $obj.MainWindowHandle -ne [IntPtr]::Zero) { $ventana = $obj.MainWindowHandle; break }
        }
        if ($ventana -ne [IntPtr]::Zero) { break }
      }
    }

    if ($ventana -ne [IntPtr]::Zero) {
      # Un respiro para que el navegador termine de dibujar: si se maximiza
      # mientras arma la ventana, a veces la deja a medio tamano.
      Start-Sleep -Milliseconds 400
      [HomePoint.Ventana]::ShowWindow($ventana, 3) | Out-Null
      [HomePoint.Ventana]::SetForegroundWindow($ventana) | Out-Null
      Escribir-Log 'Ventana de la caja maximizada'
      return
    }

    Start-Sleep -Milliseconds 250
  }

  Escribir-Log 'No se pudo maximizar la ventana: no aparecio a tiempo'
}

# --------------------------------------------------------------- navegador ---
# Se abre en modo aplicacion (--app): sin barra de direcciones ni pestanas, para
# que la caja se vea como un programa y no como una pagina web. El perfil es
# propio y aparte del navegador personal: asi la sesion de Firebase queda
# guardada entre dias y, ademas, el proceso es exclusivamente nuestro, con lo
# cual se puede detectar cuando el usuario cierra la ventana y apagar todo.
function Abrir-Navegador {
  param([string]$Url)

  $candidatos = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($exe in $candidatos) {
    if (Test-Path $exe) {
      try { New-Item -ItemType Directory -Force -Path $perfilNavegador | Out-Null } catch {}
      $argumentos = @(
        "--app=$Url",
        "--user-data-dir=`"$perfilNavegador`"",
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate',
        '--start-maximized',
        '--window-position=0,0'
      )

      # Respaldo del maximizado: si el navegador ignora --start-maximized, al
      # menos abre del tamano del escritorio (sin tapar la barra de tareas).
      $medidas = Medir-Pantalla
      if ($medidas[0] -gt 0 -and $medidas[1] -gt 0) {
        $argumentos += "--window-size=$($medidas[0]),$($medidas[1])"
      }
      Escribir-Log ("Abriendo " + [IO.Path]::GetFileName($exe))
      $proceso = Start-Process -FilePath $exe -ArgumentList $argumentos -PassThru
      Maximizar-Ventana -Proceso $proceso | Out-Null
      return $proceso
    }
  }

  # Sin Chrome ni Edge se abre el navegador por defecto. En ese caso no hay un
  # proceso propio al que seguirle el rastro, asi que el servidor queda prendido
  # hasta que se use DETENER.bat o se reinicie la PC.
  Escribir-Log 'Sin Chrome ni Edge: se abre el navegador por defecto'
  Start-Process $Url
  return $null
}

# ------------------------------------------ reuso de un servidor ya prendido --
# Cada acceso directo abre una ventana, pero un solo servidor alcanza para
# todas. Se le pregunta a cada puerto si es nuestro antes de intentar tomarlo.
function Responde-Nuestro-Servidor {
  param([int]$Puerto)
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Puerto/__caja" -UseBasicParsing -TimeoutSec 2
    return ($r.Content.Trim() -eq 'HomePointCaja')
  } catch {
    return $false
  }
}

foreach ($p in $Puertos) {
  if (Responde-Nuestro-Servidor -Puerto $p) {
    Escribir-Log "Ya habia un servidor en el puerto ${p}: solo se abre una ventana nueva"
    Abrir-Navegador -Url "http://localhost:$p/$Pagina" | Out-Null
    exit 0
  }
}

# -------------------------------------------------------------- el servidor ---
$listener = New-Object System.Net.HttpListener
$puertoElegido = 0
foreach ($p in $Puertos) {
  try {
    $listener.Prefixes.Clear()
    $listener.Prefixes.Add("http://localhost:$p/")
    $listener.Start()
    $puertoElegido = $p
    break
  } catch {
    Escribir-Log "Puerto ${p} ocupado por otro programa: se prueba el siguiente"
  }
}

if ($puertoElegido -eq 0) {
  $lista = $Puertos -join ', '
  Escribir-Log "ERROR: todos los puertos estaban ocupados ($lista)"
  Avisar "No se pudo encender el servidor local.`n`nLos puertos $lista estan ocupados por otro programa.`n`nReinicia la PC y volve a intentarlo."
  exit 1
}

Escribir-Log "Servidor encendido en http://localhost:$puertoElegido/ (raiz: $app)"

$tipos = @{
  '.html'  = 'text/html; charset=utf-8'
  '.htm'   = 'text/html; charset=utf-8'
  '.js'    = 'text/javascript; charset=utf-8'
  '.mjs'   = 'text/javascript; charset=utf-8'
  '.css'   = 'text/css; charset=utf-8'
  '.json'  = 'application/json; charset=utf-8'
  '.png'   = 'image/png'
  '.jpg'   = 'image/jpeg'
  '.jpeg'  = 'image/jpeg'
  '.gif'   = 'image/gif'
  '.webp'  = 'image/webp'
  '.svg'   = 'image/svg+xml'
  '.ico'   = 'image/x-icon'
  '.woff'  = 'font/woff'
  '.woff2' = 'font/woff2'
  '.txt'   = 'text/plain; charset=utf-8'
  '.map'   = 'application/json; charset=utf-8'
}

$rutaApp = (Get-Item $app).FullName.TrimEnd('\')

function Responder-Texto {
  param($Respuesta, [int]$Codigo, [string]$Tipo, [string]$Cuerpo)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Cuerpo)
  $Respuesta.StatusCode = $Codigo
  $Respuesta.ContentType = $Tipo
  $Respuesta.ContentLength64 = $bytes.Length
  $Respuesta.OutputStream.Write($bytes, 0, $bytes.Length)
}

$paginaError = '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;color:#2b2d31"><h2>No se encontro el archivo</h2><p><code>{0}</code></p><p>Falta un archivo del paquete. Hay que volver a copiar la carpeta <b>CajaLocal</b> completa.</p></body>'

$navegador = Abrir-Navegador -Url "http://localhost:$puertoElegido/$Pagina"
$apagarDesde = $null

try {
  while ($listener.IsListening) {

    # Se espera la proxima visita en tandas cortas, para poder revisar entre
    # tanda y tanda si la ventana de la caja sigue abierta.
    $pendiente = $listener.GetContextAsync()
    while (-not $pendiente.Wait(500)) {
      if ($navegador -ne $null -and $navegador.HasExited) {
        # Al cerrar la ventana la caja manda el registro de "Cierre" justo antes
        # de desaparecer: se espera un momento por si ese pedido todavia esta en
        # camino, y recien despues se apaga.
        if ($apagarDesde -eq $null) {
          $apagarDesde = (Get-Date).AddSeconds(2)
          Escribir-Log 'Se cerro la ventana de la caja: se apaga el servidor'
        } elseif ((Get-Date) -gt $apagarDesde) {
          $listener.Stop()
          exit 0
        }
      }
    }

    $contexto  = $pendiente.Result
    $pedido    = $contexto.Request
    $respuesta = $contexto.Response

    try {
      $ruta = [Uri]::UnescapeDataString($pedido.Url.AbsolutePath)

      # Senal de vida: la usa este mismo script para no levantar dos servidores.
      if ($ruta -eq '/__caja') {
        Responder-Texto $respuesta 200 'text/plain; charset=utf-8' 'HomePointCaja'
        continue
      }

      # Registro del boton Nuevo: la caja manda un JSON con articulos, subtotal
      # y vendedor, y aca se anota en registro_nuevo.txt (ver Escribir-Log-Nuevo).
      if ($ruta -eq '/__log') {
        if ($pedido.HttpMethod -ne 'POST') {
          Responder-Texto $respuesta 405 'text/plain; charset=utf-8' 'Solo POST'
          continue
        }
        $cuerpo = ''
        try {
          $lector = New-Object IO.StreamReader($pedido.InputStream, [Text.Encoding]::UTF8)
          $cuerpo = $lector.ReadToEnd()
          $lector.Close()
          $datos = $cuerpo | ConvertFrom-Json
          Escribir-Log-Nuevo -Datos $datos
          Responder-Texto $respuesta 200 'text/plain; charset=utf-8' 'OK'
        } catch {
          Escribir-Log ("ERROR registrando Nuevo: " + $_.Exception.Message + " | cuerpo: " + $cuerpo)
          Responder-Texto $respuesta 400 'text/plain; charset=utf-8' 'Registro invalido'
        }
        continue
      }

      if ($ruta -eq '/' -or $ruta -eq '') {
        $respuesta.StatusCode = 302
        $respuesta.RedirectLocation = "/$Pagina"
        continue
      }

      $relativa = $ruta.TrimStart('/').Replace('/', '\')
      $destino  = Join-Path $rutaApp $relativa

      # Nadie puede pedir archivos de afuera de "app" con rutas tipo ..\..\
      $completa = ''
      try { $completa = [IO.Path]::GetFullPath($destino) } catch { $completa = '' }
      $dentro = $completa -and $completa.StartsWith($rutaApp + '\', [StringComparison]::OrdinalIgnoreCase)

      if (-not $dentro -or -not (Test-Path -LiteralPath $completa -PathType Leaf)) {
        Escribir-Log "404 $ruta"
        Responder-Texto $respuesta 404 'text/html; charset=utf-8' ($paginaError -f $ruta)
        continue
      }

      $extension = [IO.Path]::GetExtension($completa).ToLowerInvariant()
      $bytes = [IO.File]::ReadAllBytes($completa)

      $respuesta.StatusCode = 200
      $respuesta.ContentType = $(if ($tipos.ContainsKey($extension)) { $tipos[$extension] } else { 'application/octet-stream' })
      # Sin cache: si se reemplaza un archivo de "app", la caja lo toma en el
      # arranque siguiente sin que nadie tenga que vaciar el navegador.
      $respuesta.Headers.Add('Cache-Control', 'no-store, must-revalidate')
      $respuesta.ContentLength64 = $bytes.Length
      $respuesta.OutputStream.Write($bytes, 0, $bytes.Length)

    } catch {
      Escribir-Log ("ERROR sirviendo " + $pedido.Url.AbsolutePath + ": " + $_.Exception.Message)
      try { $respuesta.StatusCode = 500 } catch {}
    } finally {
      try { $respuesta.Close() } catch {}
    }
  }
} finally {
  try { $listener.Stop(); $listener.Close() } catch {}
  Escribir-Log 'Servidor apagado'
}
