# Correção da renderização do player (Windows x64) — 2026-11-19

## Sintoma

Em preview e tela cheia, a área do vídeo mostrava um retângulo branco e regiões pretas; os controles
do WebView2 apareciam normalmente e o mpv reportava reprodução ativa (tempo avançando, `d3d11va`).
Reproduzido nas capturas do próprio autoteste da etapa 3 (que não tinham sido examinadas):
[`evidence/render-fix/before-mkv-fullscreen.png`](evidence/render-fix/before-mkv-fullscreen.png).

## Investigação

1. **Hierarquia real de janelas** (`bench/inspect-windows.ps1`, durante reprodução em tela cheia):

   ```
   Janela Tauri (1920×1080)
    ├─ WRY_WEBVIEW (wry, filha, z-order acima)          1920×1080  WS_CLIPSIBLINGS
    │   └─ Chrome_WidgetWin_0 → Chrome_WidgetWin_1 (WebView2, WS_EX_NOREDIRECTIONBITMAP)
    │        └─ Intermediate D3D Window (processo de GPU do WebView2)
    └─ NuvioNextGenVideoContainer (nosso, abaixo)        1920×1080  WS_CLIPSIBLINGS | WS_CLIPCHILDREN
        └─ mpv (thread do mpv)                           1920×1080
   ```

   Coordenadas e tamanhos corretos em todos os níveis: não era DPI, redimensionamento nem
   coordenadas de tela.

2. **Experimentos isolando cada mudança da etapa 3** (MKV, capturas da janela composta):

   | Variante | Resultado |
   |---|---|
   | Atual | retângulo branco + preto |
   | Janela do mpv habilitada (sem `EnableWindow(false)`) | retângulo branco + preto |
   | Contêiner sem `WS_CLIPCHILDREN` | retângulo branco + preto |
   | mpv direto na janela principal (sem contêiner, como no spike) | **vídeo correto** |
   | Contêiner **sem `WS_CLIPSIBLINGS`** | **vídeo correto** (preview e tela cheia) |

## Causa raiz

O contêiner do vídeo foi criado com `WS_CLIPSIBLINGS` e fica **abaixo** de `WRY_WEBVIEW`, uma janela
irmã que cobre toda a área cliente. Com `WS_CLIPSIBLINGS`, a região visível do contêiner exclui
tudo o que o irmão de cima cobre — ou seja, fica vazia — e a janela de vídeo do mpv, filha do
contêiner, herda esse recorte. O DWM então não apresenta a swapchain do mpv; o que aparece é a
superfície GDI da janela (branco onde nada foi pintado, preto onde o contêiner pintou o fundo).

No `player_bridge.cpp` original isso não ocorre porque o WebView2 é criado **dentro** do contêiner;
no spike da etapa 2 a janela do mpv (sem `WS_CLIPSIBLINGS`) era irmã direta do `WRY_WEBVIEW`.

## Correção

`crates/nuvio-player/src/win.rs`: o contêiner passa a usar `WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN`
(sem `WS_CLIPSIBLINGS`). Nada mais muda: mesmo contêiner (necessário para o picture-in-picture),
mesmo libmpv, mesma decodificação por hardware, mesma sessão única, WebView2 transparente por cima.

## Validação

- **Detecção visual automática** no autoteste (`apps/nuvio-desktop/src/capture.rs`): duas capturas da
  janela composta com 0,5 s de intervalo; a área do vídeo precisa **mudar** (quadros sendo
  apresentados) e não ser totalmente branca ou preta. Brilho sozinho não é critério (o padrão
  bipbop e céus claros são legitimamente brancos — o primeiro critério testado gerava falsos
  positivos e foi descartado).
- **Controle negativo**: com o `WS_CLIPSIBLINGS` reintroduzido temporariamente, as 9 verificações
  visuais falham (movimento 0,00); sem ele, todas passam.
- **Resultado** (`bench/results/render-fix-media-2`, `render-fix-addon`): **161/161 verificações**, 62
  delas visuais, em HLS, MP4, MKV, DASH, HEVC Main10, DASH 4K e no canal real do BestCine: preview,
  tela cheia, volta ao preview, 3 idas e voltas da tela cheia, janela redimensionada, maximizada e
  restaurada, modos Fit/Fill/Zoom/Stretch, legenda externa; troca de áudio; sessão única; 0 janelas
  e 0 processos residuais.
- Capturas depois da correção: [`preview`](evidence/render-fix/addon-preview.png),
  [`tela cheia`](evidence/render-fix/addon-fullscreen.png),
  [`volta ao preview`](evidence/render-fix/addon-back-to-preview.png),
  [`MKV em tela cheia`](evidence/render-fix/after-mkv-fullscreen.png).

## Impacto em desempenho

Benchmark real repetido (mesmo canal, 3 ciclos, tela cheia): reprodução 429 MB (antes 448 MB),
GPU 3D 4,1 % (antes 4,6 %), memória de GPU 173 MB (antes 182 MB), CPU 0,65 % (antes 0,59 %).
A composição correta do vídeo não aumentou o consumo. Detalhes em [`COMPARISON.md`](COMPARISON.md).
