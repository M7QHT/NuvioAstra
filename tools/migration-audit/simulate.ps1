# Faithful simulation of the next normal start, run OUTSIDE any app package (through WMI).
# The real folders are only read (copied); every run uses an isolated APPDATA copy.
param([string]$Work)
$ErrorActionPreference = "Stop"
$S = Split-Path -Parent $MyInvocation.MyCommand.Path
$realNg = Join-Path $env:APPDATA "NuvioNextGen"
$realLegacy = Join-Path $env:APPDATA "Nuvio"
if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
New-Item -ItemType Directory $Work | Out-Null
$log = Join-Path $Work "simulate.log"
function Log($m) { Add-Content $log ("{0:HH:mm:ss} {1}" -f (Get-Date), $m) }
function LegacyHashes($dir) { Get-ChildItem $dir -Filter *.properties -File | Sort-Object Name | ForEach-Object { "$($_.Name) $((Get-FileHash $_.FullName).Hash)" } }
function Audit($root, $name) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $S "audit-real.ps1") -Root $root -Out (Join-Path $Work "$name.txt") }

LegacyHashes $realLegacy | Set-Content (Join-Path $Work "legacy-real-before.txt")
Audit $realNg "real-before"

function NewCopy($name) {
  $app = Join-Path $Work $name
  New-Item -ItemType Directory "$app\Nuvio", "$app\NuvioNextGen" | Out-Null
  robocopy $realNg "$app\NuvioNextGen" /E /COPY:DAT /DCOPY:T /NFL /NDL /NJH /NJS /NP | Out-Null
  Copy-Item "$realLegacy\*.properties" "$app\Nuvio\"
  return $app
}
function Open($app, $label) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $S "run-open.ps1") -AppData $app -Log (Join-Path $Work "$label.stderr.txt") -Seconds 20
  Log "${label}: aberto e fechado"
}

# Scenario A: the real state as it is now (the next normal start).
$a = NewCopy "A"
Audit "$a\NuvioNextGen" "A-0-copy"
Open $a "A-1"
Audit "$a\NuvioNextGen" "A-1"
Open $a "A-2"
Audit "$a\NuvioNextGen" "A-2"
LegacyHashes "$a\Nuvio" | Set-Content (Join-Path $Work "A-legacy-after.txt")

# Scenario B: same data with the version-3 record restored (forces the whole v4 step to run).
$b = NewCopy "B"
Copy-Item "$b\NuvioNextGen\migration.json.bak" "$b\NuvioNextGen\migration.json" -Force
Audit "$b\NuvioNextGen" "B-0-copy"
Open $b "B-1"
Audit "$b\NuvioNextGen" "B-1"
Open $b "B-2"
Audit "$b\NuvioNextGen" "B-2"
LegacyHashes "$b\Nuvio" | Set-Content (Join-Path $Work "B-legacy-after.txt")

LegacyHashes $realLegacy | Set-Content (Join-Path $Work "legacy-real-after.txt")
Audit $realNg "real-after"
Log "fim"
Set-Content (Join-Path $Work "DONE") "ok"
