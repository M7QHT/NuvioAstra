# Migration audit and simulation (Windows)

Read-only tools used in stage 10 to check the real NextGen data and to simulate the next normal
start on faithful copies. None of them writes to `%APPDATA%\NuvioNextGen` or `%APPDATA%\Nuvio`.

## Important: run them OUTSIDE any app package

Processes started by a packaged (MSIX) app — for example the Claude desktop app and every tool or
program it launches — see `%APPDATA%` through the package's private copy
(`%LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming`): files written there by such processes
**hide** the real ones for them, and their writes to existing files go to that private copy. Reading
the real folder from inside the package therefore gives a wrong picture (this is what made the real
data look like "migration version 2" in stage 10).

From a normal PowerShell window (Start menu) the scripts can be run directly. From inside a package,
start them through WMI, which creates the process outside the package:

```powershell
$cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<path>\audit-real.ps1" -Out "<path>\audit.txt"'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
```

## Scripts

- `audit-real.ps1 -Out <file> [-Root <NextGen folder>]` — dates, sizes, SHA-256, migration record,
  profiles, addons (counts only), library/progress/watched counts and unique keys, settings profiles,
  live TV favorites. No URLs, tokens or titles.
- `run-open.ps1 -AppData <isolated folder> -Log <file>` — opens the release build like a normal
  start with `APPDATA` pointing to an isolated copy, closes its window after 20 s, keeps stderr.
- `simulate.ps1 -Work <folder>` — faithful copies of the real data (scenario A: as it is; scenario B:
  with the version-3 record restored), each opened twice, audited before/after; original and real
  folders hashed before and after.
- `simulate-c.ps1 -Work <folder>` — full v3+v4 import from the original's real stores, opened twice.
- `backup-real.ps1 -Out <file> [-Label <name>]` — verified copy (SHA-256, `SHA256SUMS.txt`) of every
  top-level file of the real data folder into `backups/<label>-<time>/`, except `account.dat` (the
  encrypted session is never copied or read). Writes only the new backup folder.
- `audit-sync.ps1 -Out <file>` — account sync state: session file present (content never read),
  linked or not (account id never printed), cursors and pending changes per profile, the sanitized
  `sync-log.json`, backups.
