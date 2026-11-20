// Settings of the active profile. Only options that NextGen applies for real are shown; each one
// is saved through Rust (`settings_set`, validated into the original's ranges) and read back.
// The original's other settings pages are listed under "Ainda não disponível" (no controls).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "../api";
import { AccountPanel } from "../components/AccountPanel";
import { AddonsManager } from "../components/AddonsManager";
import { checkForUpdates, installUpdate, useUpdates } from "../updates";
import { Avatar } from "../components/ProfileMenu";
import { LANGUAGES } from "../languages";
import { P2P_CONSENT_TEXT, megabytes } from "../components/TorrentStart";
import type { CatalogChoice, P2pCacheName, P2pProfileName, P2pSettings, PlayerSettings, ProfileSettings, ResizeModeName, SettingsView, SubtitleSettings } from "../types";

type Section = "account" | "home" | "addons" | "playback" | "p2p" | "audio" | "subtitles" | "data" | "updates" | "pending";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "account", label: "Conta", icon: "☁" },
  { id: "home", label: "Início", icon: "⌂" },
  { id: "addons", label: "Addons", icon: "🧩" },
  { id: "playback", label: "Reprodução", icon: "▶" },
  { id: "p2p", label: "Torrent / P2P", icon: "⇅" },
  { id: "audio", label: "Áudio", icon: "🔊" },
  { id: "subtitles", label: "Legendas", icon: "💬" },
  { id: "data", label: "Perfil e dados", icon: "🗂" },
  { id: "updates", label: "Atualizações", icon: "⟳" },
  { id: "pending", label: "Ainda não disponível", icon: "…" },
];

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; note?: string } | { kind: "error"; message: string };

// ---------- small controls ----------

function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-title">{title}</div>
        {description && <div className="muted small">{description}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  );
}

function Slider({ value, min, max, onChange, unit, label }: { value: number; min: number; max: number; onChange(v: number): void; unit?: string; label: string }) {
  return (
    <span className="slider">
      <input type="range" min={min} max={max} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{value}{unit}</output>
    </span>
  );
}

/** `#AARRGGBB` ⇄ color input (`#rrggbb`) + optional opacity. */
function ColorField({ value, onChange, withOpacity, label }: { value: string; onChange(v: string): void; withOpacity?: boolean; label: string }) {
  const alpha = value.slice(1, 3);
  const rgb = `#${value.slice(3, 9).toLowerCase()}`;
  const opacity = Math.round((parseInt(alpha, 16) / 255) * 100);
  const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0").toUpperCase();
  return (
    <span className="color-field">
      <input type="color" value={rgb} aria-label={label} onChange={(e) => onChange(`#${alpha}${e.target.value.slice(1).toUpperCase()}`)} />
      {withOpacity && (
        <Slider label={`${label} — opacidade`} value={opacity} min={0} max={100} unit="%" onChange={(o) => onChange(`#${hex2((o / 100) * 255)}${value.slice(3)}`)} />
      )}
    </span>
  );
}

function LanguageSelect({ value, onChange, special, label }: { value: string | null; onChange(v: string | null): void; special: [string, string][]; label: string }) {
  const known = LANGUAGES.some(([c]) => c.toLowerCase() === (value ?? "").toLowerCase()) || special.some(([c]) => c === (value ?? ""));
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {special.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      {!known && value && <option value={value}>{value}</option>}
      {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  );
}

// ---------- page ----------

export function Settings() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<ProfileSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("home");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const timer = useRef<number>(0);
  const pending = useRef<{ next: ProfileSettings; note?: string } | null>(null);
  /** Latest settings, including changes not rendered yet (several quick changes in a row). */
  const draftRef = useRef<ProfileSettings | null>(null);

  useEffect(() => {
    api.settingsGet().then(
      (v) => {
        setView(v);
        draftRef.current = v.settings;
        setDraft(v.settings);
      },
      (e) => setError(errorText(e)),
    );
  }, []);

  const flush = useCallback(async () => {
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    setStatus({ kind: "saving" });
    try {
      const saved = await api.settingsSet(job.next);
      // Rust may have corrected a value (ranges of the original): show what was stored, unless
      // the user changed something else meanwhile (that change is saved next).
      if (draftRef.current === job.next) {
        draftRef.current = saved;
        setDraft(saved);
      }
      if (!pending.current) setStatus({ kind: "saved", note: job.note });
    } catch (e) {
      setStatus({ kind: "error", message: errorText(e) });
    }
  }, []);

  // Leaving the page (or the app tab) never drops a change still waiting for its debounce.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );

  /** Applies a change locally and saves it (debounced for sliders and typing). */
  const update = useCallback(
    (change: (s: ProfileSettings) => ProfileSettings, note?: string, delay = 300) => {
      const current = pending.current?.next ?? draftRef.current;
      if (!current) return;
      const next = change(current);
      draftRef.current = next;
      pending.current = { next, note };
      setDraft(next);
      setStatus({ kind: "saving" });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  const player = (change: (p: PlayerSettings) => PlayerSettings) =>
    update((s) => ({ ...s, player: change(s.player) }), "Vale a partir da próxima reprodução.");
  const subtitle = (change: (p: SubtitleSettings) => SubtitleSettings) => player((p) => ({ ...p, subtitle: change(p.subtitle) }));

  const resetSection = (what: Section) => {
    if (!view || !draft) return;
    const name = SECTIONS.find((s) => s.id === what)?.label ?? "";
    if (!window.confirm(`Restaurar os padrões de “${name}” para o perfil ${view.profile.name}? As alterações desta seção serão descartadas.`)) return;
    const d = view.defaults;
    update((s) => {
      switch (what) {
        case "home": return { ...s, home: { ...d.home } };
        case "playback": return { ...s, player: { ...s.player, resizeMode: d.player.resizeMode, decoderPriority: d.player.decoderPriority, nvidiaRtxSuperResolution: d.player.nvidiaRtxSuperResolution, nvidiaRtxHdr: d.player.nvidiaRtxHdr } };
        case "audio": return { ...s, player: { ...s.player, preferredAudioLanguage: d.player.preferredAudioLanguage, secondaryPreferredAudioLanguage: d.player.secondaryPreferredAudioLanguage } };
        case "subtitles": return { ...s, player: { ...s.player, preferredSubtitleLanguage: d.player.preferredSubtitleLanguage, secondaryPreferredSubtitleLanguage: d.player.secondaryPreferredSubtitleLanguage, subtitle: { ...d.player.subtitle } } };
        default: return s;
      }
    }, "Padrões restaurados.", 0);
  };

  if (error) return <div className="screen-message">Não foi possível abrir as configurações: {error}</div>;
  if (!view || !draft) return <div className="screen-message">Carregando configurações…</div>;
  const p = draft.player;
  const sub = p.subtitle;

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Categorias de configurações">
        <div className="settings-profile">
          <Avatar profile={view.profile} />
          <div>
            <div className="setting-title">{view.profile.name}</div>
            <div className="muted small">Configurações deste perfil</div>
          </div>
        </div>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`nav-item ${section === s.id ? "active" : ""}`} data-section={s.id} onClick={() => setSection(s.id)}>
            <span className="nav-icon" aria-hidden>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="settings-body" key={section}>
        <header className="settings-header">
          <h1>{SECTIONS.find((s) => s.id === section)?.label}</h1>
          <span className={`save-status ${status.kind}`} role="status" data-testid="save-status">
            {status.kind === "saving" && "Salvando…"}
            {status.kind === "saved" && `✓ Salvo${status.note ? ` · ${status.note}` : ""}`}
            {status.kind === "error" && `Não foi possível salvar: ${status.message}`}
          </span>
          {["home", "playback", "audio", "subtitles"].includes(section) && (
            <button className="ghost" onClick={() => resetSection(section)}>Restaurar padrões</button>
          )}
        </header>

        {section === "home" && (
          <HomeSection settings={draft} catalogs={view.catalogs} update={update} />
        )}

        {section === "account" && <AccountPanel />}
        {section === "addons" && <AddonsManager />}

        {section === "playback" && (
          <div className="settings-group">
            <Row title="Modo de imagem padrão" description="Como o vídeo ocupa a tela ao iniciar (pode ser trocado durante a reprodução).">
              <select aria-label="Modo de imagem padrão" data-setting="resizeMode" value={p.resizeMode} onChange={(e) => player((x) => ({ ...x, resizeMode: e.target.value as ResizeModeName }))}>
                <option value="Fit">Ajustar</option>
                <option value="Fill">Preencher</option>
                <option value="Zoom">Zoom</option>
                <option value="Stretch">Esticar</option>
              </select>
            </Row>
            <Row title="Decodificação de vídeo" description="Prioridade do decodificador (libmpv).">
              <select aria-label="Decodificação de vídeo" data-setting="decoderPriority" value={p.decoderPriority} onChange={(e) => player((x) => ({ ...x, decoderPriority: Number(e.target.value) }))}>
                <option value={1}>Hardware, com software como reserva (padrão)</option>
                <option value={0}>Somente hardware</option>
                <option value={2}>Somente software</option>
              </select>
            </Row>
            <Row title="NVIDIA RTX Video Super Resolution" description="Requer placa NVIDIA RTX e driver compatível; sem efeito em outras placas.">
              <Toggle label="NVIDIA RTX Video Super Resolution" checked={p.nvidiaRtxSuperResolution} onChange={(v) => player((x) => ({ ...x, nvidiaRtxSuperResolution: v }))} />
            </Row>
            <Row title="NVIDIA RTX Video HDR" description="Converte SDR em HDR em telas HDR com placa RTX.">
              <Toggle label="NVIDIA RTX Video HDR" checked={p.nvidiaRtxHdr} onChange={(v) => player((x) => ({ ...x, nvidiaRtxHdr: v }))} />
            </Row>
          </div>
        )}

        {section === "p2p" && <P2pSection settings={draft.p2p} update={(change) => update((s) => ({ ...s, p2p: change(s.p2p) }), "Vale a partir da próxima fonte torrent.", 0)} />}

        {section === "audio" && (
          <div className="settings-group">
            <Row title="Idioma de áudio preferido" description={`“Idioma do dispositivo” = ${view.deviceLanguages.join(", ") || "não identificado"} neste PC.`}>
              <LanguageSelect label="Idioma de áudio preferido" value={p.preferredAudioLanguage} special={[["device", "Idioma do dispositivo"], ["default", "Padrão do arquivo"], ["original", "Idioma original"]]} onChange={(v) => player((x) => ({ ...x, preferredAudioLanguage: v ?? "device" }))} />
            </Row>
            <Row title="Idioma de áudio secundário" description="Usado quando o preferido não existe no arquivo.">
              <LanguageSelect label="Idioma de áudio secundário" value={p.secondaryPreferredAudioLanguage} special={[["", "Nenhum"]]} onChange={(v) => player((x) => ({ ...x, secondaryPreferredAudioLanguage: v }))} />
            </Row>
            <p className="muted small pad-top">“Idioma original” usa o idioma do dispositivo enquanto o Nuvio Astra não conhece o idioma original do título (mesma regra do Nuvio original quando essa informação falta).</p>
          </div>
        )}

        {section === "subtitles" && (
          <div className="settings-group">
            <Row title="Idioma de legenda preferido">
              <LanguageSelect label="Idioma de legenda preferido" value={p.preferredSubtitleLanguage} special={[["none", "Nenhuma (só forçadas)"], ["device", "Idioma do dispositivo"], ["forced", "Somente forçadas"]]} onChange={(v) => player((x) => ({ ...x, preferredSubtitleLanguage: v ?? "none" }))} />
            </Row>
            <Row title="Idioma de legenda secundário">
              <LanguageSelect label="Idioma de legenda secundário" value={p.secondaryPreferredSubtitleLanguage} special={[["", "Nenhum"]]} onChange={(v) => player((x) => ({ ...x, secondaryPreferredSubtitleLanguage: v }))} />
            </Row>
            <div className="subtitle-preview" aria-hidden>
              <span
                style={{
                  color: `#${sub.textColor.slice(3)}`,
                  opacity: parseInt(sub.textColor.slice(1, 3), 16) / 255,
                  fontSize: `${Math.max(11, sub.fontSizeSp)}px`,
                  fontWeight: sub.bold ? 700 : 400,
                  background: `rgba(${parseInt(sub.backgroundColor.slice(3, 5), 16)},${parseInt(sub.backgroundColor.slice(5, 7), 16)},${parseInt(sub.backgroundColor.slice(7, 9), 16)},${parseInt(sub.backgroundColor.slice(1, 3), 16) / 255})`,
                  WebkitTextStroke: sub.outlineEnabled ? `${sub.outlineWidth / 2}px #${sub.outlineColor.slice(3)}` : undefined,
                  bottom: `${8 + sub.bottomOffset / 5}px`,
                }}
              >
                Exemplo de legenda
              </span>
            </div>
            <Row title="Tamanho"><Slider label="Tamanho da legenda" value={sub.fontSizeSp} min={6} max={40} onChange={(v) => subtitle((s) => ({ ...s, fontSizeSp: v }))} /></Row>
            <Row title="Distância da borda inferior"><Slider label="Distância da borda inferior" value={sub.bottomOffset} min={0} max={200} onChange={(v) => subtitle((s) => ({ ...s, bottomOffset: v }))} /></Row>
            <Row title="Cor do texto"><ColorField label="Cor do texto" value={sub.textColor} onChange={(v) => subtitle((s) => ({ ...s, textColor: v }))} /></Row>
            <Row title="Negrito"><Toggle label="Negrito" checked={sub.bold} onChange={(v) => subtitle((s) => ({ ...s, bold: v }))} /></Row>
            <Row title="Contorno"><Toggle label="Contorno" checked={sub.outlineEnabled} onChange={(v) => subtitle((s) => ({ ...s, outlineEnabled: v }))} /></Row>
            {sub.outlineEnabled && (
              <>
                <Row title="Cor do contorno"><ColorField label="Cor do contorno" value={sub.outlineColor} onChange={(v) => subtitle((s) => ({ ...s, outlineColor: v }))} /></Row>
                <Row title="Espessura do contorno"><Slider label="Espessura do contorno" value={sub.outlineWidth} min={1} max={5} onChange={(v) => subtitle((s) => ({ ...s, outlineWidth: v }))} /></Row>
              </>
            )}
            <Row title="Fundo"><ColorField label="Cor de fundo" withOpacity value={sub.backgroundColor} onChange={(v) => subtitle((s) => ({ ...s, backgroundColor: v }))} /></Row>
            <Row title="Remover descrições para surdos (SDH)" description="Oculta trechos como [música] e (risos).">
              <Toggle label="Remover SDH" checked={sub.stripSdh} onChange={(v) => subtitle((s) => ({ ...s, stripSdh: v }))} />
            </Row>
          </div>
        )}

        {section === "data" && (
          <div className="settings-group">
            <div className="about" data-testid="about">
              <img src="./nuvio-astra-128.png" alt="" width={56} height={56} draggable={false} />
              <div>
                <div className="about-name">Nuvio Astra</div>
                <div className="muted small">Versão {view.appVersion} · Windows x64 · fork do Nuvio Desktop, compatível com seus addons e dados</div>
              </div>
            </div>
            <Row title="Perfil ativo" description="Cada perfil tem suas próprias configurações, como no Nuvio original.">
              <span>{view.profile.name}</span>
            </Row>
            <Row title="Pasta de dados do Nuvio Astra" description="Gravação atômica com cópia .bak para recuperação. O nome técnico da pasta foi mantido para preservar os dados existentes.">
              <code className="path">{view.dataDir}</code>
            </Row>
            {view.migration && (
              <>
                <Row title="Migração do Nuvio original" description="Os arquivos originais não são alterados.">
                  <span>
                    versão {view.migration.version} · {view.migration.backupFiles} arquivos em backup · {view.migration.profiles} perfis · configurações de {view.migration.settingsProfiles ?? 0} perfil(is)
                  </span>
                </Row>
                <Row title="Backup verificado"><code className="path">{view.migration.backupDir}</code></Row>
              </>
            )}
          </div>
        )}

        {section === "updates" && <UpdatesSection />}

        {section === "pending" && (
          <div className="settings-group">
            <p className="muted">Estas páginas existem no Nuvio original e dependem de módulos que o Nuvio Astra ainda não tem. Elas aparecerão aqui quando o módulo correspondente for portado — nenhuma opção fica visível sem funcionar.</p>
            <ul className="pending-list">
              <li><b>Aparência</b> — temas, AMOLED, layout da navegação, estilo dos cards de pôster.</li>
              <li><b>Tela de detalhes</b> — seções exibidas, trailers, títulos semelhantes.</li>
              <li><b>Continuar assistindo</b> — estilo, ordenação e ação do clique (a fileira em si já funciona).</li>
              <li><b>Fontes e reprodução automática</b> — autoplay, regex, fallback de fontes, reutilizar último link.</li>
              <li><b>Pular introdução / próximo episódio</b> — AnimeSkip, IntroDB, limite do próximo episódio.</li>
              <li><b>Buffer e cache</b>, <b>áudio avançado</b> (amplificação, downmix).</li>
              <li><b>Debrid</b>.</li>
              <li><b>Adiados nesta etapa</b>: próximo episódio automático, pular introdução e créditos, troca automática de fontes e sincronização automática de legendas.</li>
              <li><b>Integrações</b> — Trakt, Simkl, MDBList, TMDB; <b>servidores de mídia</b> (Plex, Jellyfin/Emby, Silo).</li>
              <li><b>Plugins</b>, avatares exclusivos de membros, Watch Party e entrar com outro dispositivo (QR).</li>
              <li>Sincronização de preferências de aparência e do player com outros aparelhos, credenciais de provedores, coleções; Discord Rich Presence, idioma do aplicativo.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Atualizações ----------

function UpdatesSection() {
  const u = useUpdates();
  const s = u.status;
  const when = u.lastCheck ? new Date(u.lastCheck).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : null;
  return (
    <div className="settings-group" data-testid="updates-settings">
      <Row title="Versão instalada" description={s?.repository ? `Atualizações publicadas em github.com/${s.repository}` : undefined}>
        <span>{s?.currentVersion ?? "…"}</span>
      </Row>
      {s && !s.configured && <p className="muted">Esta compilação não tem atualizações automáticas configuradas (compilação local). As versões publicadas pelo GitHub têm.</p>}
      {s?.configured && (
        <>
          <Row title="Procurar atualizações" description="O Nuvio Astra também procura sozinho ao abrir e a cada 6 horas. Toda atualização é verificada pela assinatura antes de ser instalada.">
            <button className="ghost" disabled={u.checking || !!u.installing} onClick={() => void checkForUpdates()} data-testid="update-check">
              {u.checking ? "Procurando…" : "Verificar agora"}
            </button>
          </Row>
          {u.checkError && <div className="row-error">{u.checkError}</div>}
          {!u.checking && !u.checkError && u.lastCheck && !u.available && <div className="addon-feedback ok" role="status">Você já está na versão mais recente (verificado às {when}).</div>}
          {u.available && (
            <div className="update-card">
              <div className="setting-title">Nova versão {u.available.version}</div>
              {u.available.notes && <pre className="update-notes">{u.available.notes}</pre>}
              <div className="account-actions">
                <button className="primary" disabled={!!u.installing && u.installing.phase !== "error"} onClick={() => void installUpdate()}>
                  {u.installing && u.installing.phase !== "error" ? "Atualizando…" : "Atualizar agora"}
                </button>
              </div>
              {u.installing?.phase === "error" && <div className="row-error">{u.installing.error}</div>}
            </div>
          )}
          <p className="muted small">Atualizar mantém perfis, addons, configurações, biblioteca e a sessão da conta: o instalador troca só os arquivos do programa.</p>
        </>
      )}
    </div>
  );
}

// ---------- Torrent / P2P ----------

function P2pSection({ settings, update }: { settings: P2pSettings; update(change: (s: P2pSettings) => P2pSettings): void }) {
  const [cache, setCache] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.p2pCacheSize().then(setCache, () => setCache(null));
  }, []);

  const enable = (on: boolean) => {
    if (on && !window.confirm(P2P_CONSENT_TEXT.join("\n\n"))) return;
    update((s) => ({ ...s, enabled: on }));
  };
  const clear = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const freed = await api.p2pClearCache();
      setMessage(`Cache limpo: ${megabytes(freed)} liberados.`);
      setCache(await api.p2pCacheSize());
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-group" data-testid="p2p-settings">
      <Row title="Streaming P2P" description="Reproduz fontes torrent dos addons no próprio player, baixando por partes enquanto você assiste.">
        <Toggle label="Streaming P2P" checked={settings.enabled} onChange={enable} />
      </Row>
      <Row title="Enviar dados (upload)" description="Compartilha com outros peers as partes já baixadas enquanto o vídeo toca.">
        <Toggle label="Enviar dados" checked={settings.enableUpload} onChange={(v) => update((s) => ({ ...s, enableUpload: v }))} />
      </Row>
      <Row title="Ocultar estatísticas do torrent" description="Peers, velocidade e progresso sobre o player.">
        <Toggle label="Ocultar estatísticas" checked={settings.hideTorrentStats} onChange={(v) => update((s) => ({ ...s, hideTorrentStats: v }))} />
      </Row>
      <Row title="Perfil de conexão" description="Quantas conexões e requisições o motor abre ao mesmo tempo.">
        <select aria-label="Perfil de conexão" value={settings.torrentProfile} onChange={(e) => update((s) => ({ ...s, torrentProfile: e.target.value as P2pProfileName }))}>
          <option value="SOFT">Leve</option>
          <option value="BALANCED">Equilibrado (padrão)</option>
          <option value="FAST">Rápido</option>
        </select>
      </Row>
      <Row title="Tamanho do cache" description="Espaço em disco para partes já baixadas (reaproveitadas ao assistir de novo).">
        <select aria-label="Tamanho do cache" value={settings.cacheSize} onChange={(e) => update((s) => ({ ...s, cacheSize: e.target.value as P2pCacheName }))}>
          <option value="NONE">Sem cache</option>
          <option value="GB_2">2 GB (padrão)</option>
          <option value="GB_5">5 GB</option>
          <option value="GB_10">10 GB</option>
        </select>
      </Row>
      <Row title="Cache em uso" description="Não pode ser limpo durante uma reprodução P2P.">
        <span className="account-actions" style={{ marginTop: 0 }}>
          <span>{cache === null ? "—" : megabytes(cache)}</span>
          <button className="ghost" disabled={busy} onClick={() => void clear()}>{busy ? "Limpando…" : "Limpar cache"}</button>
        </span>
      </Row>
      {message && <div className="addon-feedback ok" role="status">{message}</div>}
    </div>
  );
}

// ---------- Início ----------

function HomeSection({ settings, catalogs, update }: {
  settings: ProfileSettings;
  catalogs: CatalogChoice[];
  update(change: (s: ProfileSettings) => ProfileSettings, note?: string, delay?: number): void;
}) {
  const note = "A tela Início é atualizada.";
  const home = settings.home;
  // Current order: saved preferences first (by order), then catalogs without one.
  const ordered = [...catalogs].sort((a, b) => {
    const pa = home.items.find((i) => i.key === a.key)?.order ?? Number.MAX_SAFE_INTEGER;
    const pb = home.items.find((i) => i.key === b.key)?.order ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || catalogs.indexOf(a) - catalogs.indexOf(b);
  });
  const pref = (c: CatalogChoice) => home.items.find((i) => i.key === c.key);

  /** Rewrites the preference list for every catalog, in `order`, keeping hero-source flags. */
  const saveCatalogs = (order: CatalogChoice[], patch?: { key: string; enabled?: boolean; customTitle?: string }, delay?: number) =>
    update(
      (s) => ({
        ...s,
        home: {
          ...s.home,
          items: order.map((c, index) => {
            const old = s.home.items.find((i) => i.key === c.key);
            const base = { key: c.key, customTitle: old?.customTitle ?? c.customTitle, enabled: old?.enabled ?? c.enabled, heroSourceEnabled: old?.heroSourceEnabled ?? true, order: index };
            return patch && patch.key === c.key ? { ...base, ...(patch.enabled !== undefined && { enabled: patch.enabled }), ...(patch.customTitle !== undefined && { customTitle: patch.customTitle }) } : base;
          }),
        },
      }),
      note,
      delay,
    );

  const move = (index: number, dir: -1 | 1) => {
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item);
    saveCatalogs(next, undefined, 0);
  };

  return (
    <>
      <div className="settings-group">
        <Row title="Destaque no topo" description="Mostra o título em destaque no início da tela.">
          <Toggle label="Destaque no topo" checked={home.heroEnabled} onChange={(v) => update((s) => ({ ...s, home: { ...s.home, heroEnabled: v } }), note)} />
        </Row>
        <Row title="Mostrar o tipo no nome do catálogo" description="Ex.: “Em Alta - Filmes”.">
          <Toggle label="Mostrar o tipo no nome do catálogo" checked={home.showCatalogType} onChange={(v) => update((s) => ({ ...s, home: { ...s.home, showCatalogType: v } }), note)} />
        </Row>
        <Row title="Ocultar conteúdo ainda não lançado" description="Remove dos catálogos títulos com data de lançamento futura.">
          <Toggle label="Ocultar conteúdo ainda não lançado" checked={home.hideUnreleasedContent} onChange={(v) => update((s) => ({ ...s, home: { ...s.home, hideUnreleasedContent: v } }), note)} />
        </Row>
      </div>
      <h2 className="settings-subtitle">Catálogos ({ordered.filter((c) => pref(c)?.enabled ?? c.enabled).length} de {ordered.length} visíveis)</h2>
      <div className="settings-group catalogs">
        {ordered.map((c, index) => {
          const enabled = pref(c)?.enabled ?? c.enabled;
          const title = pref(c)?.customTitle ?? c.customTitle;
          return (
            <div key={c.key} className={`catalog-pref ${enabled ? "" : "off"}`} data-key={c.key}>
              <Toggle label={`Mostrar ${c.defaultTitle}`} checked={enabled} onChange={(v) => saveCatalogs(ordered, { key: c.key, enabled: v }, 0)} />
              <div className="catalog-pref-text">
                <input
                  className="catalog-title-input"
                  value={title}
                  placeholder={c.defaultTitle}
                  aria-label={`Nome de ${c.defaultTitle}`}
                  onChange={(e) => saveCatalogs(ordered, { key: c.key, customTitle: e.target.value }, 600)}
                />
                <span className="muted small">{c.addonName}</span>
              </div>
              <button className="icon-btn" aria-label={`Subir ${c.defaultTitle}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button className="icon-btn" aria-label={`Descer ${c.defaultTitle}`} disabled={index === ordered.length - 1} onClick={() => move(index, 1)}>↓</button>
            </div>
          );
        })}
      </div>
    </>
  );
}
