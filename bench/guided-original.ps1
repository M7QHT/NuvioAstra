<#
  Guided measurement of the ORIGINAL Nuvio while the user drives it.

  Starts the given Nuvio.exe, samples its whole process tree in the background with
  sample-run.ps1 (same sampler as NextGen), and asks the user to perform each step, pressing
  ENTER in this terminal. Phase timestamps go to phases.json; the windows match NextGen's
  benchmark: idle 45 s (after a 15 s settle), per cycle: playback 60 s (after 15 s), after-close
  30 s (after 15 s). Nothing about URLs is recorded.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File guided-original.ps1 -Exe <Nuvio.exe> -OutDir <dir> [-Cycles 3]
#>
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [int]$Cycles = 3
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force $OutDir | Out-Null

function Now-Ms { [int64]([DateTimeOffset]::Now).ToUnixTimeMilliseconds() }
function Wait-Enter([string]$message) {
    Write-Host ""
    Write-Host $message -ForegroundColor Yellow
    [void](Read-Host "Pressione ENTER")
}
function Countdown([int]$seconds, [string]$label) {
    for ($i = $seconds; $i -gt 0; $i--) {
        Write-Progress -Activity $label -SecondsRemaining $i -PercentComplete ((($seconds - $i) / $seconds) * 100)
        Start-Sleep -Seconds 1
    }
    Write-Progress -Activity $label -Completed
}

foreach ($name in "Nuvio", "nuvio-desktop") {
    if (Get-Process -Name $name -ErrorAction SilentlyContinue) {
        Write-Host "Feche o processo '$name' antes de medir (apps não podem rodar ao mesmo tempo)." -ForegroundColor Red
        exit 1
    }
}

$phases = New-Object System.Collections.Generic.List[object]
$cyclesOut = New-Object System.Collections.Generic.List[object]

Write-Host "=== Medição do Nuvio original ===" -ForegroundColor Cyan
Write-Host "Não use o computador para outras tarefas pesadas durante o teste."
$app = Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe) -PassThru
Start-Sleep -Seconds 2
$sampler = Start-Process -FilePath "powershell" -WindowStyle Hidden -PassThru -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$here\sample-run.ps1`"",
    "-AttachProcessName", "Nuvio", "-DurationSeconds", "3600",
    "-OutCsv", "`"$OutDir\samples.csv`"", "-PerProcessCsv", "`"$OutDir\per-process.csv`"", "-IntervalMs", "1000"
)

Wait-Enter "1) Espere o Nuvio abrir COMPLETAMENTE (perfil escolhido, tela Início com os catálogos carregados). Não clique em nada depois disso."
Countdown 15 "Estabilizando (não mexa no app)"
$t = Now-Ms; Countdown 45 "Medindo REPOUSO (não mexa no app)"
$phases.Add([pscustomobject]@{ name = "idle"; startMs = $t; endMs = (Now-Ms) })

for ($cycle = 1; $cycle -le $Cycles; $cycle++) {
    Write-Host ""
    Write-Host "--- Ciclo $cycle de $Cycles ---" -ForegroundColor Cyan
    Wait-Enter "2) Vá para a aba TV e deixe o mouse sobre o canal 'A Caçadora de Relíquias' (BestCine). Ao pressionar ENTER, clique no canal IMEDIATAMENTE."
    $clicked = Now-Ms
    Wait-Enter "3) Pressione ENTER assim que o VÍDEO aparecer (primeiro quadro)."
    $ttff = (Now-Ms) - $clicked
    Write-Host "   Agora clique no botão de TELA CHEIA do preview e não mexa mais." -ForegroundColor Yellow
    Countdown 15 "Estabilizando a reprodução (entre em tela cheia agora)"
    $t = Now-Ms; Countdown 60 "Medindo REPRODUÇÃO (não mexa no app)"
    $phases.Add([pscustomobject]@{ name = "playback-$cycle"; startMs = $t; endMs = (Now-Ms) })
    Wait-Enter "4) Saia da tela cheia (Esc) e clique em PARAR (■) no preview para encerrar a reprodução. Pressione ENTER logo depois."
    Countdown 15 "Liberando recursos (não mexa no app)"
    $t = Now-Ms; Countdown 30 "Medindo memória APÓS ENCERRAR (não mexa no app)"
    $phases.Add([pscustomobject]@{ name = "after-close-$cycle"; startMs = $t; endMs = (Now-Ms) })
    $cyclesOut.Add([pscustomobject]@{ cycle = $cycle; ttffMs = $ttff; ttffMethod = "manual (two ENTER presses, about +/-0.5 s)" })
}

[pscustomobject]@{ app = "nuvio-original"; phases = $phases; cycles = $cyclesOut } |
    ConvertTo-Json -Depth 5 | Set-Content -Path "$OutDir\phases.json" -Encoding utf8

Wait-Enter "5) Fim. Pressione ENTER para fechar o Nuvio (o script encerra o app e verifica processos residuais)."
Get-Process -Name Nuvio -ErrorAction SilentlyContinue | Stop-Process -Force
$sampler.WaitForExit(20000) | Out-Null
Start-Sleep -Seconds 3
$left = @(Get-Process -Name Nuvio, msedgewebview2 -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*Nuvio*" })
Write-Host "Concluído. Resultados em $OutDir. Processos residuais do Nuvio: $($left.Count)" -ForegroundColor Green
Write-Host "Pode voltar ao chat e avisar que terminou."
