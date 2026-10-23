; Instalador de "Cotizador de envíos" (Inno Setup 6). Lo compila construir.py:
;   ISCC /DVersion=1.0.0 /DExe="Cotizador de envios" instalador.iss
; Se instala por usuario (sin permisos de administrador) en %LOCALAPPDATA%\Programs.
; Los datos del usuario (cuenta, sesiones, catálogos, historial) quedan aparte, en
; %LOCALAPPDATA%\Cotizador de envios, y sobreviven a las actualizaciones.

#ifndef Version
  #define Version "1.0.0"
#endif
#ifndef Exe
  #define Exe "Cotizador de envios"
#endif
#define Nombre "Cotizador de envíos"

[Setup]
; AppId fijo: identifica la app para actualizar y desinstalar. No cambiarlo.
AppId={{64C638B1-D8B7-4194-8344-8AFACBE0A53E}
AppName={#Nombre}
AppVersion={#Version}
AppVerName={#Nombre} {#Version}
AppPublisher=Homepoint
VersionInfoVersion={#Version}
VersionInfoProductName={#Nombre}
DefaultDirName={localappdata}\Programs\{#Exe}
DefaultGroupName={#Nombre}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=salida
OutputBaseFilename=Instalador {#Exe} {#Version}
SetupIconFile=icono.ico
UninstallDisplayIcon={app}\{#Exe}.exe
UninstallDisplayName={#Nombre}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=force
RestartApplications=no

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "escritorio"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"

[InstallDelete]
; Al actualizar, la carpeta del programa se reemplaza entera (los datos viven en otra carpeta).
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "dist\{#Exe}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#Nombre}"; Filename: "{app}\{#Exe}.exe"
Name: "{autodesktop}\{#Nombre}"; Filename: "{app}\{#Exe}.exe"; Tasks: escritorio

[Run]
Filename: "{app}\{#Exe}.exe"; Description: "Abrir {#Nombre}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\_internal"

[Code]
// Al desinstalar se ofrece borrar también los datos del usuario. Por defecto se conservan,
// así una reinstalación recupera la cuenta de MiCorreo, el historial y la configuración.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Datos: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Datos := ExpandConstant('{localappdata}\{#Exe}');
    if DirExists(Datos) and not UninstallSilent then
      if MsgBox('¿Borrar también tus datos?' #13#10#13#10 +
                'Incluye la cuenta de MiCorreo guardada, las sesiones, la configuración y el historial de cotizaciones.' #13#10 +
                'Si pensás volver a instalar el cotizador, elegí No para conservarlos.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(Datos, True, True, True);
  end;
end;
