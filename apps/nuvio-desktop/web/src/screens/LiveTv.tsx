// Live TV: channels from the addons' `tv` catalogs, dynamic categories, search, favorites,
// preview and fullscreen. A channel's stream is resolved only when the user clicks it, and only
// the addon that listed it is asked (no prefetch, no bulk checks). One player session at a time.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { api, dataEpoch, errorText, onDataEpoch } from "../api";
import { usePlayer } from "../player/PlayerContext";
import { PlayerControls } from "../player/PlayerControls";
import { PlayerSurface } from "../player/PlayerSurface";
import type { Channel, ChannelList } from "../types";

const ALL = "__all__";
const FAVORITES = "__favorites__";

let channelsCache: ChannelList | null = null;
// Channels belong to the profile's addons: dropped on a profile or addon change.
onDataEpoch(() => {
  channelsCache = null;
});

/** Horizontal strip that scrolls with the mouse wheel and by dragging (as asked for the original). */
function DragScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !ref.current) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) {
      d.moved = true;
      ref.current.setPointerCapture(e.pointerId);
    }
    ref.current.scrollLeft = d.left - dx;
  };
  const onUp = (e: ReactPointerEvent) => {
    if (drag.current?.moved) {
      // A drag is not a click on the chip below the pointer.
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      ref.current?.addEventListener("click", swallow, { capture: true, once: true });
    }
    drag.current = null;
    ref.current?.releasePointerCapture?.(e.pointerId);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollBy({ left: e.deltaY, behavior: "smooth" });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div className="drag-scroll" ref={ref} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {children}
    </div>
  );
}

export function LiveTv() {
  const player = usePlayer();
  const [list, setList] = useState<ChannelList | null>(channelsCache);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<Channel | null>(null);
  const [resolving, setResolving] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const epoch = dataEpoch();
    api.liveTvFavorites().then((f) => epoch === dataEpoch() && setFavorites(f), () => {});
    if (channelsCache) return;
    api.liveTvChannels().then(
      (l) => {
        if (epoch !== dataEpoch()) return; // answer for the previous profile/addons
        channelsCache = l;
        setList(l);
      },
      (e) => setError(errorText(e)),
    );
  }, []);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list?.channels ?? []).filter((c) => {
      if (category === FAVORITES && !favoriteSet.has(c.key)) return false;
      if (category !== ALL && category !== FAVORITES) {
        const cats = c.genres.length ? c.genres : ["Outros"];
        if (!cats.includes(category)) return false;
      }
      return !q || c.name.toLowerCase().includes(q) || c.genres.some((g) => g.toLowerCase().includes(q));
    });
  }, [list, category, query, favoriteSet]);

  const embedded = player.session?.view === "embedded";

  const tune = async (channel: Channel) => {
    const id = ++request.current;
    setCurrent(channel);
    setChannelError(null);
    setResolving(true);
    try {
      const groups = await api.liveTvResolve(channel.key);
      if (id !== request.current) return;
      const stream = groups.flatMap((g) => g.streams).find((s) => s.kind === "direct");
      if (!stream) {
        const reason = groups.find((g) => g.error)?.error;
        setChannelError(reason ? `O addon respondeu com erro: ${reason}` : "O addon não forneceu um stream reproduzível para este canal.");
        return;
      }
      // Leaving fullscreen returns to this preview (FullPlayer uses `returnTo`).
      await player.play(() => api.playStream(stream.key, null), {
        title: channel.name,
        subtitle: channel.addonName,
        live: true,
        view: "embedded",
        returnTo: "embedded",
      });
    } catch (e) {
      if (id === request.current) setChannelError(errorText(e));
    } finally {
      if (id === request.current) setResolving(false);
    }
  };

  const toggleFavorite = async (key: string) => {
    try {
      setFavorites(await api.liveTvToggleFavorite(key));
    } catch (e) {
      setChannelError(`Não foi possível salvar o favorito: ${errorText(e)}`);
    }
  };

  const goFullscreen = async () => {
    if (!player.session) return;
    player.setView("full");
    await player.setWindowFullscreen(true);
  };
  if (error) return <div className="screen-message">Não foi possível carregar os canais: {error}</div>;

  return (
    <div className="livetv">
      <header className="livetv-header">
        <div className="search-bar">
          <input type="search" placeholder="Buscar canal ou categoria" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar canal" />
        </div>
        <DragScroll>
          <button className={`chip ${category === ALL ? "active" : ""}`} onClick={() => setCategory(ALL)}>
            Todos {list && <span className="count">{list.channels.length}</span>}
          </button>
          <button className={`chip ${category === FAVORITES ? "active" : ""}`} onClick={() => setCategory(FAVORITES)}>
            ★ Favoritos <span className="count">{favorites.length}</span>
          </button>
          {list?.categories.map(([name, count]) => (
            <button key={name} className={`chip ${category === name ? "active" : ""}`} onClick={() => setCategory(name)}>
              {name} <span className="count">{count}</span>
            </button>
          ))}
        </DragScroll>
      </header>

      <div className="channel-list" role="list">
        {!list && <div className="screen-message">Carregando canais…</div>}
        {list && !visible.length && (
          <div className="screen-message muted">
            {list.channels.length ? "Nenhum canal neste filtro." : "Nenhum addon instalado fornece canais de TV."}
          </div>
        )}
        {visible.map((c) => (
          <div key={c.key} role="listitem" className={`channel ${current?.key === c.key ? "active" : ""}`}>
            <button className="channel-main" onClick={() => void tune(c)} onDoubleClick={() => void goFullscreen()}>
              <span className="channel-logo">{c.logo ? <img src={c.logo} alt="" loading="lazy" decoding="async" /> : c.name.slice(0, 2)}</span>
              <span className="channel-text">
                <span className="channel-name">{c.name}</span>
                <span className="muted small">{(c.genres[0] ?? "Outros") + " · " + c.addonName}</span>
              </span>
            </button>
            <button
              className={`fav ${favoriteSet.has(c.key) ? "on" : ""}`}
              aria-label={favoriteSet.has(c.key) ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              aria-pressed={favoriteSet.has(c.key)}
              onClick={() => void toggleFavorite(c.key)}
            >
              ★
            </button>
          </div>
        ))}
        {list && list.failedCatalogs > 0 && <div className="muted small pad">{list.failedCatalogs} catálogo(s) de TV não responderam.</div>}
      </div>

      <aside className="livetv-preview">
        <PlayerSurface active={embedded} className="preview-hole">
          {!embedded && (
            <div className="hole-placeholder">
              {resolving ? "Sintonizando…" : current ? "" : "Escolha um canal para assistir"}
            </div>
          )}
          {embedded && (
            <PlayerControls
              snapshot={player.snapshot}
              live
              fullscreen={false}
              onToggleFullscreen={() => void goFullscreen()}
              onClose={() => void player.close()}
            />
          )}
        </PlayerSurface>
        <div className="preview-info">
          {current ? (
            <>
              <div className="preview-title">
                {current.logo && <img src={current.logo} alt="" />}
                <div>
                  <h2>{current.name}</h2>
                  <div className="muted small">Origem: {current.addonName}</div>
                </div>
              </div>
              {current.genres.length > 0 && <div className="chips">{current.genres.map((g) => <span key={g} className="chip">{g}</span>)}</div>}
              {resolving && <div className="muted">Resolvendo o stream deste canal…</div>}
              {(channelError || player.error) && <div className="row-error">{channelError ?? `Falha ao reproduzir: ${player.error}`}</div>}
              <div className="preview-actions">
                <button onClick={() => void toggleFavorite(current.key)}>{favoriteSet.has(current.key) ? "★ Favorito" : "☆ Favoritar"}</button>
                {embedded && <button onClick={() => void goFullscreen()}>⛶ Tela cheia</button>}
                {embedded && <button onClick={() => void player.close()}>■ Parar</button>}
              </div>
            </>
          ) : (
            <div className="muted">Os streams são resolvidos somente ao escolher um canal.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
