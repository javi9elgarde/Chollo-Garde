' Arranca el servidor de CholloGarde sin ventana. Lo usa el arranque automatico de Windows.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
backend = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)) & "\backend"
sh.CurrentDirectory = backend
If Not fso.FolderExists(backend & "\data") Then fso.CreateFolder(backend & "\data")
' El log de esta sesion queda en backend\data\servidor.log
sh.Run "cmd /c node src\index.js > data\servidor.log 2>&1", 0, False
