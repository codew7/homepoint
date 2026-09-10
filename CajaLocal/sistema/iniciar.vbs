' ============================================================================
'  iniciar.vbs - Enciende la Caja HomePoint sin mostrar ninguna ventana negra
' ============================================================================
'  El acceso directo del Escritorio apunta aca. Este archivo existe solo para
'  lanzar servidor.ps1 en silencio: si el acceso directo apuntara al .ps1 o a
'  un .bat, el usuario veria parpadear (o quedarse abierta) una consola.
'  El "0" del metodo Run es la ventana oculta; el False es "no esperes a que
'  termine", porque el servidor queda corriendo mientras dure la jornada.
' ============================================================================

Option Explicit

Dim shell, carpeta, servidor, comando

Set shell = CreateObject("WScript.Shell")

carpeta  = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
servidor = carpeta & "servidor.ps1"

If Not CreateObject("Scripting.FileSystemObject").FileExists(servidor) Then
  MsgBox "Falta el archivo servidor.ps1." & vbCrLf & vbCrLf & _
         "Hay que copiar la carpeta CajaLocal completa, no solamente el acceso directo.", _
         16, "Caja HomePoint"
  WScript.Quit 1
End If

comando = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & servidor & """"

shell.Run comando, 0, False
