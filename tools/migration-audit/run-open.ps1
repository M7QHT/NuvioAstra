# Opens NextGen exactly like a normal start, but with APPDATA pointing to an isolated copy.
# Meant to run outside any app package (through WMI). stderr goes to -Log; the window is closed
# normally after -Seconds (the app saves and exits like when the user closes it).
param([string]$AppData, [string]$Log, [int]$Seconds = 20, [string]$Exe = "D:\Dev\target\release\nuvio-desktop.exe")
$env:APPDATA = $AppData
$p = Start-Process -FilePath $Exe -PassThru -RedirectStandardError $Log -RedirectStandardOutput "$Log.out"
Start-Sleep -Seconds $Seconds
$null = $p.CloseMainWindow()
if (-not $p.WaitForExit(15000)) { $p.Kill(); Add-Content $Log "[run-open] forced kill" }
Add-Content $Log "[run-open] exit $($p.ExitCode)"
