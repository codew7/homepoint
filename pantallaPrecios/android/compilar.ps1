# Compila el APK firmado y lo deja, junto con version.json, en pantallaPrecios/app/
# para que la app instalada lo descargue al publicarse en el sitio.
# Uso: clic derecho > "Ejecutar con PowerShell", o:  powershell -ExecutionPolicy Bypass -File compilar.ps1
$ErrorActionPreference = 'Stop'

$tools = Join-Path $env:USERPROFILE 'android-tools'
$env:JAVA_HOME = (Get-ChildItem $tools -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
$env:ANDROID_HOME = Join-Path $tools 'sdk'
$gradle = Join-Path (Get-ChildItem $tools -Directory -Filter 'gradle-*' | Select-Object -First 1).FullName 'bin\gradle.bat'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

$proyecto = $PSScriptRoot
Set-Content -Path (Join-Path $proyecto 'local.properties') -Value ("sdk.dir=" + ($env:ANDROID_HOME -replace '\\', '/')) -Encoding ascii

Push-Location $proyecto
try {
    & $gradle --no-daemon -q assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "La compilación falló" }
} finally { Pop-Location }

# versionCode / versionName salen de app/build.gradle
$build = Get-Content (Join-Path $proyecto 'app\build.gradle') -Raw
$code = [int]([regex]::Match($build, 'versionCode\s+(\d+)').Groups[1].Value)
$name = [regex]::Match($build, "versionName\s+'([^']+)'").Groups[1].Value

$destino = Join-Path (Split-Path $proyecto -Parent) 'app'
New-Item -ItemType Directory -Force $destino | Out-Null
Copy-Item (Join-Path $proyecto 'app\build\outputs\apk\release\app-release.apk') (Join-Path $destino 'HomePointPrecios.apk') -Force

$json = [ordered]@{
    versionCode = $code
    versionName = $name
    apk         = 'https://homepoint-admin.dev.ar/pantallaPrecios/app/HomePointPrecios.apk'
}
# UTF-8 sin BOM (el BOM rompe el JSON en Android)
[IO.File]::WriteAllText((Join-Path $destino 'version.json'), ($json | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

Write-Host "Listo: pantallaPrecios/app/HomePointPrecios.apk (versión $name, código $code)"
