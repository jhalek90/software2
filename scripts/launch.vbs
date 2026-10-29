' Double-click launcher for software2 (the desktop shortcut points here, through wscript.exe).
' Runs scripts\launch.mjs with Node in a hidden window: it builds, starts Electron's own exe
' detached and exits, so no console window is left. On failure it shows the log's path.
Option Explicit

Dim fso, shell, projectDir, logPath, command, code, message
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
logPath = shell.ExpandEnvironmentStrings("%TEMP%") & "\software2-launch.log"
shell.CurrentDirectory = projectDir
command = "node """ & projectDir & "\scripts\launch.mjs"" --log """ & logPath & """"

On Error Resume Next
code = shell.Run(command, 0, True)
If Err.Number <> 0 Then
  message = "software2 could not start: Node.js was not found (" & Err.Description & ")." & vbCrLf & _
    "Install Node 22 or newer and make sure ""node"" is on PATH."
  On Error GoTo 0
  MsgBox message, vbExclamation, "software(2);"
  WScript.Quit 1
End If
On Error GoTo 0

If code <> 0 Then
  If code = 1 Then
    message = "software2 could not start: the build failed."
  Else
    message = "software2 could not start: Electron is missing or would not start."
  End If
  MsgBox message & vbCrLf & vbCrLf & "Details are in the log:" & vbCrLf & logPath, vbExclamation, "software(2);"
  WScript.Quit code
End If
