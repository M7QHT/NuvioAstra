# Verified backup of the real Nuvio Astra data before the first account sync. Meant to run OUTSIDE
# any app package (through WMI, see README). Copies every top-level file of the data folder except
# the encrypted session (`account.dat`, never copied or read) into `backups/<Label>-<time>/`, checks
# each copy by SHA-256 and writes `SHA256SUMS.txt` next to them. Existing backups are not touched;
# nothing in the data folder is changed. The original app's folder is not read.
param([string]$Out, [string]$Label = "pre-first-sync", [string]$Root = (Join-Path $env:APPDATA "NuvioNextGen"))
$ErrorActionPreference = "Stop"
$lines = New-Object System.Collections.Generic.List[string]
try {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $target = Join-Path (Join-Path $Root "backups") "$Label-$stamp"
  New-Item -ItemType Directory -Path $target | Out-Null
  $sums = New-Object System.Collections.Generic.List[string]
  $files = Get-ChildItem $Root -File -Force | Where-Object { $_.Name -ne "account.dat" -and $_.Name -notlike "*.tmp" } | Sort-Object Name
  foreach ($f in $files) {
    $dest = Join-Path $target $f.Name
    Copy-Item -LiteralPath $f.FullName -Destination $dest
    $a = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
    $b = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    if ($a -ne $b) { throw "copia divergente: $($f.Name)" }
    $sums.Add("$a  $($f.Name)")
  }
  $sums | Set-Content -Path (Join-Path $target "SHA256SUMS.txt") -Encoding ASCII
  $lines.Add("backup=$target")
  $lines.Add("arquivos=$($files.Count) verificados por SHA-256")
  $lines.Add("account.dat presente na pasta: " + (Test-Path (Join-Path $Root "account.dat")) + " (nao copiado)")
  $lines.Add("sync-state.json presente: " + (Test-Path (Join-Path $Root "sync-state.json")))
  $lines.Add("backups existentes: " + ((Get-ChildItem (Join-Path $Root "backups") -Directory | ForEach-Object Name) -join ", "))
  foreach ($s in $sums) { $lines.Add($s.Substring(0, 12) + " " + $s.Substring(66)) }
} catch {
  $lines.Add("ERRO: $($_.Exception.Message)")
}
$lines | Set-Content -Path $Out -Encoding UTF8
