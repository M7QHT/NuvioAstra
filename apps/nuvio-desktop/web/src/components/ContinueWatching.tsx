// Continue watching: started, unfinished movies, the latest episode of each series and, when that
// one is finished, the next episode (the original's rules, computed in Rust). The row draws at
// once from what is known; the episode lists of the next episodes complete it.

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { clock, episodeCode, lastWatched, remaining, removeHistory, useLibraryVersion } from "../library";
import { showToast } from "../toast";
import type { HistoryEntry } from "../types";
import { airDate } from "../player/episodes";
import { t } from "../i18n";

interface CardProps {
  entry: HistoryEntry;
  onResume(entry: HistoryEntry): void;
  onOpenDetails?(entry: HistoryEntry): void;
  onRemove?(entry: HistoryEntry): void;
}

export const ContinueCard = memo(function ContinueCard({ entry, onResume, onOpenDetails, onRemove }: CardProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const image = entry.poster ?? entry.background;
  const code = episodeCode(entry);
  const shortCode = entry.season && entry.episode ? `S${entry.season} E${entry.episode}` : "";
  const left = remaining(entry);
  const fresh = entry.nextUp && !entry.inProgress;
  const tooltipParts = [
    fresh ? t("Próximo episódio de {title}", { title: entry.title }) : t("Continuar {title}", { title: entry.title }),
    code && `${code}${entry.episodeTitle ? ` · ${entry.episodeTitle}` : ""}`,
    entry.positionMs > 0 ? t("{time} assistidos", { time: clock(entry.positionMs) }) : "",
    left ?? "",
    lastWatched(entry.lastWatchedEpochMs),
  ].filter(Boolean);

  const markWatched = async () => {
    setMenu(null);
    try {
      await api.librarySetWatched(
        {
          id: entry.metaId,
          contentType: entry.metaType,
          name: entry.title,
          poster: entry.poster,
          releaseInfo: null,
          season: entry.season,
          episode: entry.episode,
          videoId: entry.videoId ?? entry.metaId,
        },
        true,
      );
      showToast(`Marked "${entry.title}" as watched`);
    } catch {
      showToast("Failed to mark as watched", true);
    }
  };

  return (
    <div className="cw-wrap">
      <button
        className="cw-card"
        onClick={() => onResume(entry)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        data-key={entry.key}
        data-next-up={entry.nextUp || undefined}
        title={tooltipParts.join(" · ")}
      >
        <div className="cw-art">
          {image ? <img src={image} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="card-fallback">{entry.title}</span>}
          <span className="cw-play" aria-hidden>▶</span>
          {entry.nextUp && <span className="cw-badge">{entry.airs ? t("Estreia em {date}", { date: airDate(entry.airs) }) : "Up next"}</span>}
          {!fresh && (
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(entry.fraction * 100)}>
              <div style={{ width: `${Math.max(2, entry.fraction * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="cw-meta-row">
          <div className="card-title">{entry.title}</div>
          {shortCode && <span className="cw-ep-code">{shortCode}</span>}
        </div>
      </button>
      {onRemove && (
        <button className="fav-btn icon" aria-label={t("Remover {title} de Continuar assistindo", { title: entry.title })} title={t("Remover")} data-testid="cw-remove" onClick={() => onRemove(entry)}>
          ✕
        </button>
      )}
      {menu && createPortal(
        <div
          ref={menuRef}
          className="context-menu"
          role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 210) }}
          data-testid="cw-menu"
        >
          <button role="menuitem" onClick={() => { setMenu(null); onResume(entry); }}>
            ▶ {fresh ? "Watch next episode" : `Resume (${clock(entry.positionMs)})`}
          </button>
          {onOpenDetails && (
            <button role="menuitem" onClick={() => { setMenu(null); onOpenDetails(entry); }}>
              Open details
            </button>
          )}
          <button role="menuitem" onClick={() => void markWatched()}>
            ✓ Mark as watched
          </button>
          {onRemove && (
            <button role="menuitem" onClick={() => { setMenu(null); onRemove(entry); showToast(`Removed "${entry.title}"`); }}>
              ✕ Remove from Continue watching
            </button>
          )}
          <button role="menuitem" onClick={() => { setMenu(null); void navigator.clipboard?.writeText(entry.title).then(() => showToast(`Copied "${entry.title}"`)); }}>
            Copy title
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
});

/** Reads the row at once and again when the next episodes are known. */
export function loadContinueWatching(show: (items: HistoryEntry[]) => void, failed?: (e: unknown) => void): () => void {
  let cancelled = false;
  void (async () => {
    try {
      const known = await api.libraryContinueWatching();
      if (cancelled) return;
      show(known);
    } catch (e) {
      if (!cancelled) failed?.(e);
      return;
    }
    try {
      const complete = await api.libraryNextUp();
      if (!cancelled) show(complete);
    } catch {
      /* the addons did not answer: what is known stays */
    }
  })();
  return () => {
    cancelled = true;
  };
}

/** Home row (hidden when empty), like the original's Continue watching section at the top. */
export function ContinueWatchingRow({ onResume, onOpenDetails }: { onResume(entry: HistoryEntry): void; onOpenDetails?(entry: HistoryEntry): void }) {
  const version = useLibraryVersion();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  useEffect(() => loadContinueWatching(setItems), [version]);
  if (!items.length) return null;
  return (
    <section className="row-section" data-testid="home-continue">
      <header className="row-header">
        <h2>{t("Continuar assistindo")}</h2>
      </header>
      <div className="row-track">
        {items.map((e) => (
          <ContinueCard key={e.key} entry={e} onResume={onResume} onOpenDetails={onOpenDetails} onRemove={(x) => void removeHistory(x.key)} />
        ))}
      </div>
    </section>
  );
}
