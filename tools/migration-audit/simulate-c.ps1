# Scenario C (outside any package): full v3+v4 import on a faithful copy of the real data, starting
# from the state before the library existed (settings, live TV favorites, a version-2 record).
param([string]$Work)
$ErrorActionPreference = "Stop"
$S = Split-Path -Parent $MyInvocation.MyCommand.Path
$realNg = Join-Path $env:APPDATA "NuvioNextGen"
$realLegacy = Join-Path $env:APPDATA "Nuvio"
if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
$c = Join-Path $Work "C"
New-Item -ItemType Directory "$c\Nuvio", "$c\NuvioNextGen" | Out-Null
Copy-Item "$realLegacy\*.properties" "$c\Nuvio\"
foreach ($n in "settings.json", "livetv-favorites.json") { Copy-Item (Join-Path $realNg $n) "$c\NuvioNextGen\" }
# Version-2 record (fields of that version only).
$m = Get-Content (Join-Path $realNg "migration.json.bak") -Raw | ConvertFrom-Json
$v2 = [ordered]@{ version = 2; sourceDir = $m.sourceDir; backupDir = $m.backupDir; backupFiles = $m.backupFiles; profiles = $m.profiles; liveTvFavorites = $m.liveTvFavorites; settingsProfiles = 2; completedAtEpochMs = 1795117678985 }
$v2 | ConvertTo-Json | Set-Content "$c\NuvioNextGen\migration.json" -Encoding UTF8
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $S "audit-real.ps1") -Root "$c\NuvioNextGen" -Out (Join-Path $Work "C-0.txt")
foreach ($i in 1, 2) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $S "run-open.ps1") -AppData $c -Log (Join-Path $Work "C-$i.stderr.txt") -Seconds 20
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $S "audit-real.ps1") -Root "$c\NuvioNextGen" -Out (Join-Path $Work "C-$i.txt")
}
Get-ChildItem "$realLegacy\*.properties" | Sort-Object Name | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName).Hash)" } | Set-Content (Join-Path $Work "legacy-real.txt")
Get-ChildItem "$c\Nuvio\*.properties" | Sort-Object Name | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName).Hash)" } | Set-Content (Join-Path $Work "legacy-copy-after.txt")
Set-Content (Join-Path $Work "DONE") "ok"
