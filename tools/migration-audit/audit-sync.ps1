# Read-only audit of the account sync state of the real Nuvio Astra data (run OUTSIDE any app
# package, through WMI, see README). Prints counts only: whether a session file exists (never its
# content), whether the data is linked to an account (never the account id), cursors and pending
# changes per profile, the sanitized sync log (`sync-log.json`) and the backups. Changes nothing.
param([string]$Out, [string]$Root = (Join-Path $env:APPDATA "NuvioNextGen"))
$ErrorActionPreference = "Continue"
$lines = New-Object System.Collections.Generic.List[string]
function J($name) { $p = Join-Path $Root $name; if (Test-Path $p) { try { Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json } catch { "INVALID" } } else { $null } }
function D($ms) { if ($ms) { [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$ms).LocalDateTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "-" } }
$lines.Add("pasta=$Root")
$lines.Add("account.dat presente (sessao DPAPI, conteudo nao lido): " + (Test-Path (Join-Path $Root "account.dat")))
$s = J "sync-state.json"
if ($s -and $s -ne "INVALID") {
  $lines.Add(("sync-state: vinculado a uma conta {0}; perfis vinculados {1}; revisao {2}; perfis pendentes {3}; exclusoes de perfil {4}; ultima sync {5}" -f [bool]$s.linkedUserId, $s.profilesLinked, $s.revision, $s.profilesDirty, @($s.profileDeletes.PSObject.Properties).Count, (D $s.lastSyncEpochMs)))
  foreach ($p in @($s.profiles.PSObject.Properties)) {
    $v = $p.Value
    $pend = @($v.libraryUpserts.PSObject.Properties).Count + @($v.libraryDeletes.PSObject.Properties).Count + @($v.progressDirty.PSObject.Properties).Count + @($v.progressDeletes.PSObject.Properties).Count + @($v.watchedUpserts.PSObject.Properties).Count + @($v.watchedDeletes.PSObject.Properties).Count + [int]($v.addonsDirty -gt 0)
    $lines.Add(("  perfil {0}: pendentes {1}; addons vinculados {2}; cursores biblioteca {3}/{4} progresso {5}/{6} assistidos {7}/{8}; ultima sync {9}" -f $p.Name, $pend, $v.addonsLinked, $v.library.initialized, $v.library.eventId, $v.progress.initialized, $v.progress.eventId, $v.watched.initialized, $v.watched.eventId, (D $v.lastSyncEpochMs)))
  }
} else { $lines.Add("sync-state.json: $s") }
$log = J "sync-log.json"
$lines.Add("== sync-log (" + @($log | Where-Object { $_ }).Count + " entradas)")
foreach ($e in @($log)) { if ($e) { $lines.Add((D $e.atEpochMs) + " " + ($e | ConvertTo-Json -Compress -Depth 8)) } }
$lines.Add("== backups")
Get-ChildItem (Join-Path $Root "backups") -Directory -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { $lines.Add(("{0} ({1} arquivos)" -f $_.Name, (Get-ChildItem $_.FullName -File).Count)) }
$lines | Set-Content -Path $Out -Encoding UTF8
