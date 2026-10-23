; Instalador de "WiFi Clientes" (Inno Setup 6). Lo compila construir.py:
;   ISCC /DVersion=1.0.0 /DExe="WiFi Clientes" instalador.iss
; Se instala para todo el equipo (pide administrador una sola vez, al instalar) y crea la
; tarea programada "WiFi Clientes" con privilegios altos: la app se abre por ahi y asi no
; vuelve a aparecer el aviso de Windows cada vez. La configuracion y el registro quedan en
; %LOCALAPPDATA%\WiFi Clientes del usuario.

#ifndef Version
  #define Version "1.0.0"
#endif
#ifndef Exe
  #define Exe "WiFi Clientes"
#endif
#define Nombre "WiFi Clientes"
#define Tarea "WiFi Clientes"

[Setup]
; AppId fijo: identifica la app para actualizar y desinstalar. No cambiarlo.
AppId={{3E1B7C52-6A0F-4D8E-9C21-5B7F0A4D2E91}
AppName={#Nombre}
AppVersion={#Version}
AppVerName={#Nombre} {#Version}
AppPublisher=Homepoint
VersionInfoVersion={#Version}
VersionInfoProductName={#Nombre}
DefaultDirName={autopf}\{#Exe}
DefaultGroupName={#Nombre}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=admin
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
Name: "inicio"; Description: "Abrir WiFi Clientes al iniciar Windows (queda en la bandeja)"; GroupDescription: "Inicio:"; Flags: unchecked

[InstallDelete]
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "dist\{#Exe}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#Nombre}"; Filename: "{app}\{#Exe}.exe"
Name: "{autodesktop}\{#Nombre}"; Filename: "{app}\{#Exe}.exe"; Tasks: escritorio

[Run]
Filename: "{app}\{#Exe}.exe"; Description: "Abrir {#Nombre}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/delete /tn ""{#Tarea}"" /f"; Flags: runhidden; RunOnceId: "BorrarTarea"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\_internal"

[Code]
// Tarea programada con privilegios altos, para el usuario que instala. Se arma en XML porque
// schtasks por linea de comandos no deja cambiar dos valores por defecto que la romperian:
// el corte a las 72 horas y no arrancar con la notebook a bateria.
function XmlTarea(Usuario, Exe, Carpeta: String; AlIniciar: Boolean): String;
var
  Disparador: String;
begin
  if AlIniciar then
    Disparador := '<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>' + Usuario + '</UserId><Delay>PT15S</Delay></LogonTrigger></Triggers>'
  else
    Disparador := '<Triggers/>';
  Result :=
    '<?xml version="1.0" encoding="UTF-8"?>' + #13#10 +
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' +
    '<RegistrationInfo><Description>Abre WiFi Clientes con permisos para proteger la red de clientes.</Description></RegistrationInfo>' +
    Disparador +
    '<Principals><Principal id="Author"><UserId>' + Usuario + '</UserId>' +
    '<LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>' +
    '<Settings><MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>' +
    '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>' +
    '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>5</Priority><AllowHardTerminate>true</AllowHardTerminate>' +
    '<StartWhenAvailable>false</StartWhenAvailable><Enabled>true</Enabled></Settings>' +
    '<Actions Context="Author"><Exec><Command>"' + Exe + '"</Command><WorkingDirectory>' + Carpeta + '</WorkingDirectory></Exec></Actions>' +
    '</Task>';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Archivo, Usuario: String;
  Lineas: TArrayOfString;
  Codigo: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    Usuario := GetUserNameString;
    Archivo := ExpandConstant('{tmp}\tarea.xml');
    SetArrayLength(Lineas, 1);
    Lineas[0] := XmlTarea(Usuario, ExpandConstant('{app}\{#Exe}.exe'), ExpandConstant('{app}'), WizardIsTaskSelected('inicio'));
    SaveStringsToUTF8File(Archivo, Lineas, False);
    if not Exec(ExpandConstant('{sys}\schtasks.exe'), '/create /tn "{#Tarea}" /xml "' + Archivo + '" /f', '', SW_HIDE, ewWaitUntilTerminated, Codigo) or (Codigo <> 0) then
      MsgBox('No se pudo crear el acceso sin aviso de Windows. La app va a funcionar igual, pero cada vez que la abras Windows va a pedir permiso.', mbInformation, MB_OK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Datos: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Datos := ExpandConstant('{localappdata}\{#Exe}');
    if DirExists(Datos) and not UninstallSilent then
      if MsgBox('¿Borrar también la configuración y el registro de uso?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(Datos, True, True, True);
  end;
end;
