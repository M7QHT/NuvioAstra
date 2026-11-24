// Sources of one title/episode, asked to the addons only when shown. Direct and torrent (P2P)
// streams play in the app's player; with TorBox, cached torrents are marked "TB Instant" and the
// addons' own TorBox sources play too. Right click: play or download. Badges come from the texts.
// `reload` (the sources panel's "Recarregar"): each new value asks every addon again.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errorText } from "../api";
import { badgesOf, canDownload, type TorboxStates } from "../sources";
import type { StreamEntry, StreamGroup, StreamKind } from "../types";
import { t } from "../i18n";
import { message } from "../rustErrors";

const PENDING: Record<Exclude<StreamKind, "direct" | "torrent">, string> = {
  debrid: "Debrid — configure o TorBox em Configurações para abrir",
  external: "Link externo — abre fora do player",
  youTube: "YouTube — ainda não suportado nesta versão",
};

interface Props {
  contentType: string;
  id: string;
  onPlay(stream: StreamEntry, torbox: TorboxStates): void;
  onDownload?(stream: StreamEntry, torbox: TorboxStates): void;
  reload?: number;
  /** Whether the addons are being asked now (the reload button spins meanwhile). */
  onLoading?(loading: boolean): void;
}

export function StreamList({ contentType, id, onPlay, onDownload, reload = 0, onLoading }: Props) {
  const [groups, setGroups] = useState<StreamGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [torbox, setTorbox] = useState<TorboxStates>({});
  const [menu, setMenu] = useState<{ stream: StreamEntry; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    setError(null);
    setTorbox({});
    onLoading?.(true);
    api.streams(contentType, id, reload > 0).then(
      (g) => {
        if (cancelled) return;
        onLoading?.(false);
        setGroups(g);
        const keys = g.flatMap((group) => group.streams).filter((s) => s.kind === "torrent" || s.kind === "debrid").map((s) => s.key);
        if (keys.length) api.torboxCheck(keys).then((states) => !cancelled && setTorbox(states), () => {});
      },
      (e) => {
        if (cancelled) return;
        onLoading?.(false);
        setError(errorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType, id, reload]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  if (error) return <div className="row-error">{t("Falha ao buscar fontes: {error}", { error })}</div>;
  if (!groups) return <div className="muted">{t("Buscando fontes nos addons…")}</div>;
  if (!groups.length) return <div className="muted">{t("Nenhum addon instalado fornece fontes para este título.")}</div>;

  const playable = (s: StreamEntry) => s.kind === "direct" || s.kind === "torrent" || (s.kind === "debrid" && (s.torbox && torbox[s.key] === "cached"));

  return (
    <div className="streams">
      {groups.map((group) => (
        <div key={group.addonName} className="stream-group">
          <div className="stream-group-title">
            {group.addonName}
            <span className="muted small"> · {group.error ? t("erro: {error}", { error: message(group.error) }) : t("{count} fonte(s)", { count: group.streams.length })}</span>
          </div>
          {group.streams.map((s) => {
            const ok = playable(s);
            const instant = torbox[s.key] === "cached";
            const badges = badgesOf(s);
            return (
              <button
                key={s.key}
                className="stream"
                data-kind={s.kind}
                data-key={s.key}
                data-instant={instant || undefined}
                disabled={!ok}
                onClick={() => ok && onPlay(s, torbox)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (ok) setMenu({ stream: s, x: e.clientX, y: e.clientY });
                }}
              >
                <span className="stream-name">
                  {s.name || t("Fonte")}
                  {instant && <span className="stream-tag instant" title={t("Já está no cache do TorBox: abre na hora")}>TB Instant</span>}
                  {s.kind === "torrent" && !instant && <span className="stream-tag">P2P</span>}
                </span>
                <span className="stream-desc">{s.description}</span>
                {badges.length > 0 && (
                  <span className="stream-badges" aria-label={t("Detalhes da fonte")}>
                    {badges.map((b) => <span key={b} className="stream-badge">{b}</span>)}
                  </span>
                )}
                {!ok && <span className="stream-pending">{t(PENDING[s.kind as Exclude<StreamKind, "direct" | "torrent">])}</span>}
              </button>
            );
          })}
        </div>
      ))}
      {/* On the page itself: the sources panel's blur would clip and move a fixed menu. */}
      {menu && createPortal(
        <div ref={menuRef} className="context-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 100) }} data-testid="stream-menu">
          <button role="menuitem" onClick={() => { const s = menu.stream; setMenu(null); onPlay(s, torbox); }}>{t("▶ Reproduzir")}</button>
          {onDownload && canDownload(menu.stream, torbox) && (
            <button role="menuitem" data-testid="stream-download" onClick={() => { const s = menu.stream; setMenu(null); onDownload(s, torbox); }}>{t("⤓ Baixar")}</button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
