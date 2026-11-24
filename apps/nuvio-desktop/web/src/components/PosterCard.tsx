import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { libraryItemFromPreview, toggleFavorite, useIsFavorite } from "../library";
import { showToast } from "../toast";
import type { MetaPreview } from "../types";
import { FavoriteButton } from "./FavoriteButton";
import { useCardStyle } from "../cardStyle";
import { t } from "../i18n";

interface Props {
  item: MetaPreview;
  onOpen(item: MetaPreview): void;
  /** Shows the type label on the art (Library grid). */
  showType?: boolean;
}

export function typeLabel(contentType: string): string {
  const kind = contentType.toLowerCase();
  if (kind === "movie") return t("Filme");
  if (kind === "series" || kind === "tv" || kind === "show") return t("Série");
  if (kind === "anime") return "Anime";
  return contentType;
}

/** Poster with native lazy loading/decoding and right-click quick actions menu. */
export const PosterCard = memo(function PosterCard({ item, onOpen, showType = false }: Props) {
  const cards = useCardStyle();
  const isFav = useIsFavorite(item.contentType, item.id);
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

  const wide = cards.landscape && item.posterShape !== "Square" && !!(item.landscapePoster ?? item.banner);
  const shape = item.posterShape === "Landscape" || wide ? "landscape" : item.posterShape === "Square" ? "square" : "poster";
  const image = shape === "landscape" ? item.landscapePoster ?? (wide ? item.banner : null) ?? item.poster : item.poster;

  const handleToggleFav = async () => {
    setMenu(null);
    try {
      const saved = await toggleFavorite(libraryItemFromPreview(item));
      showToast(saved ? `Added "${item.name}" to Library` : `Removed "${item.name}" from Library`);
    } catch {
      showToast("Failed to update Library", true);
    }
  };

  const handleMarkWatched = async () => {
    setMenu(null);
    try {
      await api.librarySetWatched(
        {
          id: item.id,
          contentType: item.contentType,
          name: item.name,
          poster: item.poster,
          releaseInfo: item.releaseInfo,
          season: null,
          episode: null,
          videoId: item.id,
        },
        true,
      );
      showToast(`Marked "${item.name}" as watched`);
    } catch {
      showToast("Failed to mark as watched", true);
    }
  };

  const handleCopyTitle = () => {
    setMenu(null);
    void navigator.clipboard?.writeText(item.name).then(
      () => showToast(`Copied "${item.name}"`),
      () => showToast("Could not copy title", true),
    );
  };

  return (
    <div className={`card-wrap ${shape}`}>
      <button
        className={`card ${shape}`}
        onClick={() => onOpen(item)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title={item.name}
        data-id={item.id}
        data-content-type={item.contentType}
      >
        <div className="card-art">
          {image ? <img src={image} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="card-fallback">{item.name}</span>}
          {showType && <span className="card-type">{typeLabel(item.contentType)}</span>}
        </div>
        <div className="card-title">{item.name}</div>
        {item.releaseInfo && <div className="card-sub">{item.releaseInfo}</div>}
      </button>
      <FavoriteButton item={item} />
      {menu && createPortal(
        <div
          ref={menuRef}
          className="context-menu"
          role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 190) }}
          data-testid="poster-menu"
        >
          <button role="menuitem" onClick={() => { setMenu(null); onOpen(item); }}>
            Open details
          </button>
          <button role="menuitem" onClick={() => void handleToggleFav()}>
            {isFav ? "♥ Remove from Library" : "♡ Add to Library"}
          </button>
          {item.contentType.toLowerCase() === "movie" && (
            <button role="menuitem" onClick={() => void handleMarkWatched()}>
              ✓ Mark as watched
            </button>
          )}
          <button role="menuitem" onClick={handleCopyTitle}>
            Copy title
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
});
