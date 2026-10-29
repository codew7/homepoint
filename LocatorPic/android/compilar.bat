@echo off
rem Compila LocatorPic y deja el APK en LocatorPic\LocatorPic.apk
chcp 65001 >nul
cd /d "%~dp0"
set "JAVA_HOME=C:\Users\alero\AppData\Local\Programs\jdk-17.0.20.1+1"
set "GRADLE="
for /d %%G in ("%USERPROFILE%\.gradle\wrapper\dists\gradle-8.9-bin\*") do set "GRADLE=%%G\gradle-8.9\bin\gradle.bat"
if not defined GRADLE (
  echo No encuentro Gradle 8.9 en %USERPROFILE%\.gradle\wrapper\dists
  pause
  exit /b 1
)
if not exist "app\google-services.json" (
  echo.
  echo  ATENCION: falta app\google-services.json ^(ver README^).
  echo  El APK se compila igual, pero no va a poder conectarse a Firebase.
  echo.
)
call "%GRADLE%" assembleDebug --console=plain
if errorlevel 1 (
  echo.
  echo  La compilacion fallo. Revisa los mensajes de arriba.
) else (
  echo.
  echo  Listo: ..\LocatorPic.apk
)
pause
