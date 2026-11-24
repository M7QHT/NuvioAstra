// Sources of one title/episode, asked to the addons only when shown. Direct and torrent (P2P)
// streams play in the app's player; with TorBox, cached torrents are marked "TB Instant" and the
// addons' own TorBox sources play too. Right click: play or download. Badges come from the texts.

import { useEffect, useMemo, useRef, useState } from "react";
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
  activeKey?: string;
  onPlay(stream: StreamEntry, torbox: TorboxStates, allStreams?: StreamEntry[]): void;
  onDownload?(stream: StreamEntry, torbox: TorboxStates): void;
}

export function StreamList({ contentType, id, activeKey, onPlay, onDownload }: Props) {
  const [groups, setGroups] = useState<StreamGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [torbox, setTorbox] = useState<TorboxStates>({});
  const [filter, setFilter] = useState<"all" | "4k" | "1080p" | "hdr" | "instant">("all");
  const [menu, setMenu] = useState<{ stream: StreamEntry; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    setError(null);
    setTorbox({});
    setFilter("all");
    api.streams(contentType, id).then(
      (g) => {
        if (cancelled) return;
        setGroups(g);
        const keys = g.flatMap((group) => group.streams).filter((s) => s.kind === "torrent" || s.kind === "debrid").map((s) => s.key);
        if (keys.length) api.torboxCheck(keys).then((states) => !cancelled && setTorbox(states), () => {});
      },
      (e) => !cancelled && setError(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [contentType, id]);

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

  const allStreams = useMemo(() => (groups ? groups.flatMap((g) => g.streams) : []), [groups]);

  if (error) return <div className="row-error">{t("Falha ao buscar fontes: {error}", { error })}</div>;
  if (!groups) return <div className="muted">{t("Buscando fontes nos addons…")}</div>;
  if (!groups.length) return <div className="muted">{t("Nenhum addon instalado fornece fontes para este título.")}</div>;

  const playable = (s: StreamEntry) => s.kind === "direct" || s.kind === "torrent" || (s.kind === "debrid" && (s.torbox && torbox[s.key] === "cached"));

  const matchesFilter = (s: StreamEntry, f: typeof filter) => {
    if (f === "all") return true;
    const b = badgesOf(s).map((x) => x.toLowerCase());
    if (f === "4k") return b.some((x) => x === "4k" || x === "2160p");
    if (f === "1080p") return b.some((x) => x === "1080p");
    if (f === "hdr") return b.some((x) => x.includes("hdr") || x.includes("dv") || x.includes("dolby vision"));
    if (f === "instant") return torbox[s.key] === "cached" || s.kind === "direct";
    return true;
  };

  const filterChips: { id: typeof filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: allStreams.length },
    { id: "4k", label: "4K", count: allStreams.filter((s) => matchesFilter(s, "4k")).length },
    { id: "1080p", label: "1080p", count: allStreams.filter((s) => matchesFilter(s, "1080p")).length },
    { id: "hdr", label: "HDR / DV", count: allStreams.filter((s) => matchesFilter(s, "hdr")).length },
    { id: "instant", label: "Instant / Direct", count: allStreams.filter((s) => matchesFilter(s, "instant")).length },
  ].filter((c) => c.id === "all" || (c.count > 0 && c.count < allStreams.length));

  return (
    <div className="streams">
      {filterChips.length > 1 && (
        <div className="stream-filters" role="group" aria-label="Filter sources">
          {filterChips.map((c) => (
            <button
              key={c.id}
              className={`chip stream-filter-chip ${filter === c.id ? "active" : ""}`}
              onClick={() => setFilter(c.id)}
            >
              {c.label} <span className="muted small">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {groups.map((group) => {
        const visibleStreams = group.streams.filter((s) => matchesFilter(s, filter));
        if (filter !== "all" && visibleStreams.length === 0 && !group.error) return null;
        return (
        <div key={group.addonName} className="stream-group">
          <div className="stream-group-title">
            {group.addonName}
            <span className="muted small"> · {group.error ? t("erro: {error}", { error: message(group.error) }) : t("{count} fonte(s)", { count: visibleStreams.length })}</span>
          </div>
          {visibleStreams.map((s) => {
            const ok = playable(s);
            const instant = torbox[s.key] === "cached";
            const isCurrent = Boolean(activeKey && activeKey === s.key);
            const badges = badgesOf(s);
            return (
              <button
                key={s.key}
                className={`stream ${isCurrent ? "stream-active" : ""}`}
                data-kind={s.kind}
                data-key={s.key}
                data-instant={instant || undefined}
                disabled={!ok}
                onClick={() => ok && onPlay(s, torbox, allStreams)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (ok) setMenu({ stream: s, x: e.clientX, y: e.clientY });
                }}
              >
                <span className="stream-name">
                  {s.name || t("Fonte")}
                  {isCurrent && <span className="stream-badge stream-badge-playing">Playing</span>}
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
        );
      })}
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
