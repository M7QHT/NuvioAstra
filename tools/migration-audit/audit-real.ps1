# Read-only audit of a NextGen data folder (default: the real %APPDATA%\NuvioNextGen), meant to run
# OUTSIDE any app package (through WMI). Counts, versions, dates and SHA-256 only: no URLs or titles.
param([string]$Out, [string]$Root = (Join-Path $env:APPDATA "NuvioNextGen"))
$ErrorActionPreference = "Continue"
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("pasta=$Root")
$lines.Add("== arquivos (data, bytes, sha256-12, nome)")
Get-ChildItem $Root -File -Force | Sort-Object Name | ForEach-Object {
  $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.Substring(0, 12)
  $lines.Add(("{0:yyyy-MM-dd HH:mm:ss.fff} {1,8} {2} {3}" -f $_.LastWriteTime, $_.Length, $h, $_.Name))
}
$lines.Add("== backups")
Get-ChildItem (Join-Path $Root "backups") -Directory -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { $lines.Add(("{0} ({1} arquivos)" -f $_.Name, (Get-ChildItem $_.FullName -File).Count)) }
function J($name) { $p = Join-Path $Root $name; if (Test-Path $p) { try { Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json } catch { "INVALID" } } else { $null } }
$m = J "migration.json"
if ($m -and $m -ne "INVALID") {
  $lines.Add(("migration.json: versao {0}; concluida {1}; backup origem {2}; backup destino {3}; biblioteca {4}; perfis importados {5}; addons importados {6}" -f $m.version, ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$m.completedAtEpochMs).LocalDateTime.ToString("yyyy-MM-dd HH:mm:ss")), (Split-Path $m.backupDir -Leaf), $(if ($m.destinationBackupDir) { Split-Path $m.destinationBackupDir -Leaf } else { "-" }), ($m.library | ConvertTo-Json -Compress), $m.importedProfiles, $m.importedAddons))
} else { $lines.Add("migration.json: $m") }
$lines.Add("diario de migracao presente: " + (Test-Path (Join-Path $Root "migration-journal.json")))
$p = J "profiles.json"
if ($p) { $lines.Add(("profiles.json: ativo {0}; perfis {1}" -f $p.active, ((@($p.profiles) | ForEach-Object { "$($_.index)(primario=$($_.usesPrimaryAddons))" }) -join ", "))) }
foreach ($i in 1..6) {
  $a = J "addons-$i.json"
  if ($a) { $it = @($a.items); $lines.Add(("addons-{0}: {1} addons, {2} ativos, chaves unicas {3}" -f $i, $it.Count, @($it | Where-Object enabled).Count, @($it | ForEach-Object manifestUrl | Sort-Object -Unique).Count)) }
  foreach ($k in "library", "progress", "watched") {
    $d = J "$k-$i.json"
    if ($d) {
      $items = @(if ($k -eq "progress") { $d.entries } else { $d.items })
      $keys = @($items | ForEach-Object {
        if ($k -eq "progress") { if ($_.progressKey) { $_.progressKey } else { "$($_.parentMetaId)_s$($_.seasonNumber)e$($_.episodeNumber)" } }
        elseif ($k -eq "watched") { "$($_.contentType):$($_.id):$($_.season):$($_.episode)" }
        else { "$($_.contentType)/$($_.id)" } })
      $lines.Add(("{0}-{1}: {2} registros, {3} chaves unicas" -f $k, $i, $items.Count, @($keys | Sort-Object -Unique).Count))
    }
  }
}
$s = J "settings.json"
if ($s) { $lines.Add(("settings.json: perfis {0}" -f ((@($s.PSObject.Properties) | ForEach-Object Name) -join ","))) }
$l = J "livetv-favorites.json"
if ($l) { $lines.Add(("livetv-favorites.json: {0}" -f ((@($l.PSObject.Properties) | ForEach-Object { "$($_.Name)=$(@($_.Value).Count)" }) -join ", "))) }
$lines | Set-Content -Path $Out -Encoding UTF8
