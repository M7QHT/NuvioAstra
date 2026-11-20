# Comparação controlada — Nuvio original vs Nuvio NextGen (Windows x64)

Data: 2026-11-19 · Mesma máquina (Windows 11 Pro 26200, 12 núcleos lógicos, GPU NVIDIA) · Apps
medidos separadamente, nunca ao mesmo tempo.

> **Atualização (após a correção de renderização, [`RENDER_FIX.md`](RENDER_FIX.md)):** a primeira
> medição do NextGen (seção "Resultado" abaixo, `bench/results/compare-nextgen`) foi feita com o
> defeito de composição ativo — o vídeo era decodificado, mas o Windows não o exibia na tela
> cheia. O NextGen foi medido de novo nas mesmas condições (`bench/results/compare-nextgen-fixed`),
> agora com o vídeo comprovadamente visível (mesmo caminho de tela cheia validado visualmente no
> autoteste). O Nuvio original não muda. **Esta é a tabela válida:**

| Métrica (árvore completa de processos) | Nuvio original | Nuvio NextGen | Diferença |
|---|---|---|---|
| RAM em repouso (privada, mediana) | 818 MB | 165 MB | -653 (-80 %) |
| RAM durante reprodução (privada, mediana) | 1 246 MB | 429 MB | -817 (-66 %) |
| Pico de RAM na reprodução (privada) | 1 256 MB | 456 MB | -800 (-64 %) |
| RAM após encerrar reprodução (privada, mediana) | 932 MB | 254 MB | -678 (-73 %) |
| CPU em repouso (média, % de todos os núcleos) | 0.93 % | 0.01 % | -0.92 % |
| CPU durante reprodução (média) | 0.81 % | 0.65 % | -0.16 % |
| GPU 3D durante reprodução (média) | 6.7 % | 4.1 % | -2.6 % |
| GPU Video Decode durante reprodução (média) | 2.1 % | 1.8 % | -0.3 % |
| Memória dedicada de GPU na reprodução (mediana) | 389 MB | 173 MB | -216 (-56 %) |
| Tempo até o primeiro quadro (mediana) | 9 504 ms (manual ±0,5 s) | 4 090 ms (mpv) | -5 414 ms |

Working set (separado, não misturar com memória privada):

| Working set | Nuvio original | Nuvio NextGen |
|---|---|---|
| Repouso | 796 MB | 339 MB |
| Reprodução | 1 286 MB | 494 MB |
| Após encerrar | 890 MB | 403 MB |

Por ciclo (privada, MB):

| App | Repouso | Reprodução c1/c2/c3 | Após encerrar c1/c2/c3 | TTFF c1/c2/c3 (ms) |
|---|---|---|---|---|
| Original | 818 | 1 233 / 1 246 / 1 304 | 932 / 946 / 920 | 9 504 / 18 149 / 4 158 |
| NextGen | 165 | 428 / 429 / 444 | 245 / 254 / 259 | 3 577 / 8 899 / 4 090 |

Amostras por fase — original: {'idle': [13], 'play': [16, 15, 15], 'after': [8, 8, 8]}, NextGen: {'idle': [13], 'play': [16, 15, 16], 'after': [8, 8, 8]}.
Quadros perdidos NextGen (saída/decodificador) por ciclo: [(0, 0), (0, 0), (0, 0)]. Original: não exposto pelo player.

Leitura: os números praticamente não mudaram com a correção (reprodução 429 vs 448 MB; GPU 3D
4,1 vs 4,6 %; memória de GPU 173 vs 182 MB), então as conclusões abaixo continuam válidas, agora
com o vídeo realmente na tela. O primeiro quadro do NextGen variou de 3,6 a 8,9 s nesta rodada
(rede/addon).

## Condições

| Item | Nuvio original | Nuvio NextGen |
|---|---|---|
| Build | build local do app Kotlin (com a aba TV), `composeApp/build/.../Nuvio.exe` | `nuvio-desktop.exe` release, estágio 3 |
| Conteúdo | BestCine, canal ao vivo "A Caçadora de Relíquias" (primeiro item do catálogo de canais) | o mesmo canal, mesmo addon, mesmo stream direto |
| Vídeo | H.264 1280×720 @ 30 fps | H.264 1280×720 @ 30 fps (`d3d11va`) |
| Decodificação | padrão do app (hardware com fallback) | mesma configuração (`decoderPriority` 1) |
| Modo | aba TV → canal → tela cheia | janela em tela cheia, vídeo na janela inteira, controles sobrepostos |
| Condução | usuário, guiado por `bench/guided-original.ps1` | automática: `nuvio-desktop --bench-addon BestCine <report> 3` |
| Amostrador | `bench/sample-run.ps1` (anexado ao processo) | `bench/sample-run.ps1` (iniciando o app) |
| Fases | repouso 45 s (após 15 s); 3 × [reprodução 60 s após 15 s de estabilização; após encerrar 30 s após 15 s] | idênticas |
| Métrica principal | **memória privada (Private Bytes) somada de toda a árvore de processos**: app + todos os processos do WebView2 + auxiliares | a mesma |

Validação das janelas: a decodificação de vídeo da GPU esteve ativa em todas as amostras de
reprodução do original (16/15/15) e em 15 de 16 / 14 de 15 / 14 de 15 do NextGen, e foi zero em
todas as amostras de repouso e após encerrar nos dois apps. A árvore do original tem 2 processos
em repouso e 8 durante a reprodução (o player abre o WebView2 dos controles); a do NextGen tem 7
o tempo todo. Todos foram somados. Nenhum processo residual ao fechar, nos dois apps.

## Resultado

| Métrica (árvore completa de processos) | Nuvio original | Nuvio NextGen | Diferença |
|---|---|---|---|
| RAM em repouso (privada, mediana) | 818 MB | 163 MB¹ | −655 MB (−80 %)¹ |
| RAM durante reprodução (privada, mediana dos 3 ciclos) | 1 246 MB | 448 MB | **−798 MB (−64 %)** |
| Pico de RAM na reprodução (privada) | 1 256 MB² | 460 MB | **−795 MB (−63 %)** |
| RAM após encerrar reprodução (privada, mediana) | 932 MB | 261 MB | −671 MB (−72 %) |
| CPU em repouso (média, % de todos os núcleos) | 0,93 % | 0,17 %¹ | −0,76 pp |
| CPU durante reprodução (média) | 0,81 % | 0,59 % | −0,23 pp |
| GPU 3D durante reprodução (média) | 6,7 % | 4,6 % | −2,1 pp |
| GPU Video Decode durante reprodução (média) | 2,1 % | 2,9 % | +0,8 pp (mesmo vídeo; diferença pequena) |
| Memória dedicada de GPU na reprodução (mediana) | 389 MB | 182 MB | −207 MB (−53 %) |
| Tempo até o primeiro quadro (mediana) | 9,5 s (manual, ±0,5 s; ciclos 9,5 / 18,1 / 4,2 s) | 3,3 s (mpv; 3,8 / 3,3 / 3,1 s) | −6,2 s³ |
| Quadros perdidos | não exposto pelo player original | 0 / 0 / 0 | — |

¹ **Não comparável como app completo**: o NextGen ainda mostra só a tela de teste do player; o
original está com a tela Início, catálogos e imagens carregados.
² Mediana dos picos por ciclo (1 233–1 304 MB); maior pico isolado na sessão: ver `compare-table.md`.
³ Métodos diferentes: original medido por duas teclas ENTER (inclui reação humana e o tempo de
carregamento do canal no addon); NextGen medido pelo próprio mpv, do início da busca de streams ao
primeiro quadro.

Working set (apenas referência, **não misturar** com memória privada):

| Working set | Nuvio original | Nuvio NextGen |
|---|---|---|
| Repouso | 796 MB | 342 MB |
| Reprodução | 1 286 MB | 514 MB |
| Após encerrar | 890 MB | 422 MB |

Por ciclo (memória privada, MB):

| App | Repouso | Reprodução c1 / c2 / c3 | Após encerrar c1 / c2 / c3 |
|---|---|---|---|
| Original | 818 | 1 233 / 1 246 / 1 304 | 932 / 946 / 920 |
| NextGen | 163 | 455 / 447 / 448 | 263 / 260 / 261 |

Memória por processo numa amostra da reprodução (ciclo 1):

| Processo | Original | NextGen |
|---|---|---|
| Processo principal | 1 054 MB (`Nuvio`, JVM + Compose + libmpv) | 245 MB (`nuvio-desktop`, Rust + libmpv) |
| WebView2 GPU | 88 MB | 117 MB |
| WebView2 browser / renderer / utility / crashpad | 33 / 31 / 18 / 3 MB | 33 / 31 / 18 / 3 MB |

## O que os números realmente provam

Decomposição da memória privada:

| | Original | NextGen |
|---|---|---|
| Base do app (repouso) | 818 MB | 163 MB (tela de teste) |
| Acréscimo para tocar (reprodução − repouso) | +428 MB | +285 MB |
| Acréscimo para tocar (reprodução − após encerrar) | +314 MB | +187 MB |
| Retido após encerrar (após encerrar − repouso) | +114 MB | +98 MB |
| Crescimento entre ciclos (após encerrar c1 → c3) | 932 → 920 MB (sem crescimento) | 263 → 261 MB (sem crescimento) |
| Crescimento entre ciclos (reprodução c1 → c3) | 1 233 → 1 304 MB (+71 MB) | 455 → 448 MB (sem crescimento) |

1. **Camada de reprodução**: comprovadamente mais leve no NextGen. Tocar o mesmo canal custa
   ~285 MB acima do repouso, contra ~428 MB no original (−143 MB, −33 %). O processo principal
   tocando usa 245 MB contra 1 054 MB.
2. **Memória total durante a reprodução**: 448 MB contra 1 246 MB (−64 %). Mas a maior parte
   dessa diferença (~655 MB) é a **base do app**: JVM + Compose + a interface completa do original,
   que o NextGen ainda não tem. Essa parte só estará comprovada quando o NextGen tiver as telas
   reais; o custo delas no WebView2 ainda é desconhecido.
3. **GPU**: −2,1 pp em 3D e −53 % de memória dedicada de GPU (o original desenha a interface Compose
   e mantém o WebView2 dos controles ao mesmo tempo). A decodificação é praticamente igual: é o
   mesmo libmpv/D3D11VA.
4. **CPU**: os dois já são baixos; a diferença em reprodução é pequena (−0,23 pp).
5. **Retenção após encerrar**: os dois retêm ~100 MB após a primeira reprodução e nenhum cresce
   com a repetição. Durante a reprodução, o original subiu 71 MB do ciclo 1 ao 3; o NextGen não.
6. **Primeiro quadro**: o NextGen foi consistente (3,1–3,8 s). O original variou de 4,2 a 18,1 s,
   mas com medição manual; não dá para afirmar quanto disso é o app e quanto é o addon/rede.

## Gargalos que continuam

- Base do NextGen com a interface real: precisa ser medida assim que as telas existirem (mesmo
  procedimento, mesma tabela).
- Memória retida após a primeira reprodução (~98 MB): processo de GPU do WebView2 e libmpv/driver
  carregados; `MemoryUsageTargetLevel` recuperou ~24 MB em teste A/B, não adotado.
- Processo de GPU do WebView2 é maior no NextGen (117 vs 88 MB) porque o WebView2 compõe a janela
  inteira por cima do vídeo; a interface completa pode aumentar isso.
- Primeiro quadro de HLS com master de muitas variantes (FFmpeg analisa todas as rendições).

## Reproduzir

```powershell
# NextGen (automático)
powershell -NoProfile -ExecutionPolicy Bypass -File bench\sample-run.ps1 -Exe "D:\Dev\target\release\nuvio-desktop.exe" -Args "--bench-addon BestCine bench\results\compare-nextgen\report.json 3" -OutCsv bench\results\compare-nextgen\samples.csv -PerProcessCsv bench\results\compare-nextgen\per-process.csv
# Original (guiado: o usuário conduz o app e pressiona ENTER no terminal)
powershell -NoProfile -ExecutionPolicy Bypass -File bench\guided-original.ps1 -Exe "<caminho do Nuvio.exe>" -OutDir bench\results\compare-original -Cycles 3
# Tabela
python -I bench\analyze-compare.py bench\results\compare-original bench\results\compare-nextgen bench\results\compare-table.md
```

## Notas sobre medições anteriores

- 495–525 MB e 690–723 MB citados antes para o Nuvio oficial 0.1.38 são **as mesmas duas
  execuções**, em duas métricas: working set e memória privada, respectivamente. Aquela medição foi
  feita 15 s após abrir, sem confirmar que a Início tinha carregado; esta comparação mede após a
  confirmação do usuário (818 MB privados, build local com a aba TV).
- Os 158 MB do NextGen em medições anteriores eram a tela de teste em repouso; não são o resultado
  da nova aplicação.
