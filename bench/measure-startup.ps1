<#
  Baseline measurement for Nuvio Desktop (Windows).

  For each run: launches the app, measures the time until its main window exists, lets it idle,
  then samples the whole process tree (the app plus any child processes such as WebView2):
  working set, private bytes, and CPU time used during the idle window. Only processes started
  by this script are closed afterwards.

  Limitations (reported, not hidden):
  - "Window shown" is when Windows reports a main window handle, not when the home screen has
    finished rendering its catalogs.
  - The OS file cache cannot be flushed without admin rights, so run 1 is only "first run of
    this session", not a true cold boot.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File measure-startup.ps1 -Exe <path> -Label <name> [-Runs 2] [-IdleSeconds 45]
#>
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$Label,
    [int]$Runs = 2,
    [int]$IdleSeconds = 45,
    [int]$WindowTimeoutSeconds = 120,
    [string]$OutCsv = ""
)

$ErrorActionPreference = 'Stop'

function Get-ProcessTree([int]$RootId) {
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
    $ids = New-Object System.Collections.Generic.HashSet[int]
    [void]$ids.Add($RootId)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($p in $all) {
            if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
                [void]$ids.Add([int]$p.ProcessId); $changed = $true
            }
        }
    }
    $procs = @()
    foreach ($id in $ids) { $pr = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($pr) { $procs += $pr } }
    return $procs
}

function Get-TreeCpuSeconds([object[]]$Procs) {
    $sum = 0.0
    foreach ($p in $Procs) { try { $p.Refresh(); $sum += $p.TotalProcessorTime.TotalSeconds } catch {} }
    return $sum
}

if (-not (Test-Path $Exe)) { throw "Executable not found: $Exe" }
if (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($Exe)) -ErrorAction SilentlyContinue) {
    throw "Another instance is already running; close it first so the measurement is clean."
}

$results = @()
for ($run = 1; $run -le $Runs; $run++) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe) -PassThru
    $windowMs = $null
    while ($sw.Elapsed.TotalSeconds -lt $WindowTimeoutSeconds) {
        Start-Sleep -Milliseconds 50
        $proc.Refresh()
        if ($proc.HasExited) { throw "Process exited during startup (run $run)." }
        # The launcher may hand the window to a child process: look across the whole tree.
        $withWindow = Get-ProcessTree $proc.Id | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
        if ($withWindow) { $windowMs = [int]$sw.Elapsed.TotalMilliseconds; break }
    }

    # Let startup work settle, then measure an idle window.
    Start-Sleep -Seconds 15
    $tree = Get-ProcessTree $proc.Id
    $cpu0 = Get-TreeCpuSeconds $tree
    $t0 = [Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Seconds $IdleSeconds
    $tree = Get-ProcessTree $proc.Id
    $cpu1 = Get-TreeCpuSeconds $tree
    $elapsed = $t0.Elapsed.TotalSeconds
    $cores = [Environment]::ProcessorCount

    $ws = 0; $priv = 0
    foreach ($p in $tree) { try { $p.Refresh(); $ws += $p.WorkingSet64; $priv += $p.PrivateMemorySize64 } catch {} }

    $row = [pscustomobject]@{
        label                 = $Label
        run                   = $run
        window_shown_ms       = $windowMs
        processes_in_tree     = $tree.Count
        working_set_mb        = [math]::Round($ws / 1MB, 1)
        private_bytes_mb      = [math]::Round($priv / 1MB, 1)
        idle_cpu_percent_total = [math]::Round((($cpu1 - $cpu0) / $elapsed) / $cores * 100, 2)
        idle_seconds          = [math]::Round($elapsed, 1)
        logical_cores         = $cores
    }
    $results += $row
    $row | Format-List | Out-String | Write-Host

    foreach ($p in ($tree | Sort-Object Id -Descending)) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {} }
    Start-Sleep -Seconds 5
}

if ($OutCsv) {
    $append = Test-Path $OutCsv
    $results | Export-Csv -Path $OutCsv -NoTypeInformation -Append:$append -Encoding UTF8
}
