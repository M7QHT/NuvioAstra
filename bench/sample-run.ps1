<#
  Runs an executable and samples its whole process tree (app + WebView2 + children) until it exits.

  Per sample (epoch ms): processes, working set, private bytes, CPU % of all cores, GPU engine
  utilization for the tree (3D and VideoDecode engines, from the "GPU Engine" counters) and GPU
  dedicated memory ("GPU Process Memory"). After exit, reports any process of the tree still alive.

  Attach mode (an app the user drives, e.g. the original Nuvio while it plays):
    powershell -NoProfile -ExecutionPolicy Bypass -File sample-run.ps1 -AttachProcessName Nuvio -DurationSeconds 60 -OutCsv <file> -PerProcessCsv <file>

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File sample-run.ps1 -Exe <path> -Args "<args>" -OutCsv <file> [-IntervalMs 1000] [-TimeoutSeconds 600]
#>
param(
    [string]$Exe = "",
    # Attach to an already running app (oldest process with this name) instead of starting one.
    [string]$AttachProcessName = "",
    # With -AttachProcessName: how long to sample.
    [int]$DurationSeconds = 60,
    [string]$Args = "",
    [Parameter(Mandatory = $true)][string]$OutCsv,
    [int]$IntervalMs = 1000,
    [int]$TimeoutSeconds = 600,
    # Optional: per-process rows (epoch, pid, name, private MB, working set MB) for each sample.
    [string]$PerProcessCsv = ""
)
$ErrorActionPreference = 'Stop'

function Get-Tree([int]$RootId) {
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
    $ids = New-Object System.Collections.Generic.HashSet[int]
    [void]$ids.Add($RootId)
    do {
        $added = $false
        foreach ($p in $all) {
            if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added = $true }
        }
    } while ($added)
    return $ids
}

$cores = [Environment]::ProcessorCount
if ($AttachProcessName) {
    $root = Get-Process -Name $AttachProcessName -ErrorAction Stop | Sort-Object StartTime | Select-Object -First 1
    $TimeoutSeconds = $DurationSeconds
} else {
    if (-not $Exe) { throw "Pass -Exe or -AttachProcessName" }
    $startInfo = @{ FilePath = $Exe; PassThru = $true; WorkingDirectory = (Split-Path $Exe) }
    if ($Args) { $startInfo.ArgumentList = $Args }
    $root = Start-Process @startInfo
}
$rows = New-Object System.Collections.Generic.List[object]
$procRows = New-Object System.Collections.Generic.List[object]
$prevCpu = @{}
$prevTime = Get-Date
$everSeen = New-Object System.Collections.Generic.HashSet[int]
$procType = @{}
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

while (-not $root.HasExited -and (Get-Date) -lt $deadline) {
    $ids = Get-Tree $root.Id
    foreach ($id in $ids) { [void]$everSeen.Add($id) }
    $now = Get-Date
    $elapsed = ($now - $prevTime).TotalSeconds
    $ws = 0; $priv = 0; $cpuDelta = 0.0; $count = 0
    foreach ($id in $ids) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if (-not $p) { continue }
        $count++
        $ws += $p.WorkingSet64; $priv += $p.PrivateMemorySize64
        if ($PerProcessCsv) {
            if (-not $procType.ContainsKey($id)) {
                $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue).CommandLine
                $procType[$id] = if ($cmd -match '--type=([a-z\-]+)') { $Matches[1] } elseif ($cmd -match '--utility-sub-type=([\w\.]+)') { $Matches[1] } else { 'main' }
            }
            $procRows.Add([pscustomobject]@{
                type = $procType[$id]
                epoch_ms = [int64]([DateTimeOffset]::new($now)).ToUnixTimeMilliseconds()
                pid = $id; name = $p.ProcessName
                private_mb = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
                working_set_mb = [math]::Round($p.WorkingSet64 / 1MB, 1)
            })
        }
        $cpu = $p.TotalProcessorTime.TotalSeconds
        if ($prevCpu.ContainsKey($id)) { $cpuDelta += ($cpu - $prevCpu[$id]) }
        $prevCpu[$id] = $cpu
    }
    $prevTime = $now

    $gpu3d = 0.0; $gpuDecode = 0.0; $gpuMem = 0.0
    try {
        $pidPattern = ($ids | ForEach-Object { "pid_$($_)_" }) -join '|'
        $engines = (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples |
            Where-Object { $_.InstanceName -match $pidPattern }
        foreach ($e in $engines) {
            if ($e.InstanceName -match 'engtype_3d') { $gpu3d += $e.CookedValue }
            elseif ($e.InstanceName -match 'engtype_videodecode') { $gpuDecode += $e.CookedValue }
        }
        $mem = (Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples |
            Where-Object { $_.InstanceName -match $pidPattern }
        foreach ($m in $mem) { $gpuMem += $m.CookedValue }
    } catch {}

    $rows.Add([pscustomobject]@{
        epoch_ms         = [int64]([DateTimeOffset]::new($now)).ToUnixTimeMilliseconds()
        processes        = $count
        working_set_mb   = [math]::Round($ws / 1MB, 1)
        private_mb       = [math]::Round($priv / 1MB, 1)
        cpu_pct_all_cores = if ($elapsed -gt 0) { [math]::Round($cpuDelta / $elapsed / $cores * 100, 2) } else { 0 }
        gpu_3d_pct       = [math]::Round($gpu3d, 1)
        gpu_decode_pct   = [math]::Round($gpuDecode, 1)
        gpu_dedicated_mb = [math]::Round($gpuMem / 1MB, 1)
    })
    Start-Sleep -Milliseconds $IntervalMs
}

if (-not $root.HasExited -and -not $AttachProcessName) { Write-Host "TIMEOUT: stopping process tree"; Stop-Process -Id $root.Id -Force }
$rows | Export-Csv -Path $OutCsv -NoTypeInformation -Encoding UTF8
if ($PerProcessCsv) { $procRows | Export-Csv -Path $PerProcessCsv -NoTypeInformation -Encoding UTF8 }
if ($AttachProcessName) { Write-Host "attached: samples=$($rows.Count) (app left running)"; return }
Start-Sleep -Seconds 3
$left = @()
foreach ($id in $everSeen) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $left += "$($p.Name)($id)" } }
Write-Host "exit_code=$($root.ExitCode) samples=$($rows.Count) residual_processes=$($left.Count) $($left -join ',')"
