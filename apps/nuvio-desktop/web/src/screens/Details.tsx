// Details of a movie or series: artwork, info, genres, cast, seasons/episodes and the sources of
// the chosen title or episode (asked to the addons only when the user opens them).

import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import { FavoriteButton } from "../components/FavoriteButton";
import { StreamList } from "../components/StreamList";
import { startDownload, viaTorbox, type TorboxStates } from "../sources";
import { TorrentStart } from "../components/TorrentStart";
import { clock, episodeCode, libraryItemFromDetails, playbackItem, remaining, useLibraryVersion } from "../library";
import { usePlayer } from "../player/PlayerContext";
import type { Details as DetailsData, HistoryEntry, MetaRef, MetaVideo, StreamEntry, TitleProgress } from "../types";
import { addonLabel, t } from "../i18n";

interface Props {
  /** Type and id exactly as the catalog item gave them (validated by `metaRef`); `resume` when
   *  opened from Continue watching / history (selects that movie/episode and resumes). */
  item: MetaRef;
  onBack(): void;
}

function episodeLabel(v: MetaVideo): string {
  return v.season != null && v.episode != null ? t("T{season} E{episode}", { season: v.season, episode: v.episode }) : "";
}

export function Details({ item, onBack }: Props) {
  const { contentType, id } = item;
  const player = usePlayer();
  const [data, setData] = useState<DetailsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [selected, setSelected] = useState<MetaVideo | "movie" | null>(null);
  const [fromStart, setFromStart] = useState(false);
  /** Torrent source being started by the P2P engine (before the player opens). */
  const [torrent, setTorrent] = useState<StreamEntry | null>(null);
  const [trailerBusy, setTrailerBusy] = useState(false);
  const [progress, setProgress] = useState<TitleProgress | null>(null);
  const version = useLibraryVersion();
  const sources = useRef<HTMLElement>(null);

  // Saved progress of this title (NextGen data only; refreshed after each save).
  useEffect(() => {
    let cancelled = false;
    api.libraryTitleProgress(id).then((p) => !cancelled && setProgress(p), () => {});
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setSelected(null);
    api.details(contentType, id).then(
      (d) => {
        if (cancelled) return;
        setData(d);
        const resume = item.resume;
        const target = resume && d.seasons.length > 0
          ? d.meta.videos.find((v) => (resume.videoId && v.id === resume.videoId) || (v.season === resume.season && v.episode === resume.episode))
          : undefined;
        setSeason(target?.season ?? d.seasons.find((s) => s > 0) ?? d.seasons[0] ?? null);
        if (resume) setSelected(d.seasons.length > 0 ? target ?? null : "movie");
      },
      (e) => !cancelled && setError(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
    // `item.resume` is read once per title (the component is keyed by type/id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType, id]);

  useEffect(() => {
    // The panel is sticky on the right: keep it in view (series: chosen far down the episode list).
    if (selected) sources.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  const episodes = useMemo(
    () => (data?.meta.videos ?? []).filter((v) => v.season === season).sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
    [data, season],
  );
  const isSeries = (data?.seasons.length ?? 0) > 0;

  /** Progress of the movie or of one episode (each episode has its own). */
  const entryFor = (target: MetaVideo | "movie" | null): HistoryEntry | undefined => {
    if (!target || !progress) return undefined;
    return target === "movie"
      ? progress.entries.find((e) => e.season == null && e.episode == null)
      : progress.entries.find((e) => e.season === target.season && e.episode === target.episode);
  };
  const selectedEntry = entryFor(selected);
  const resumeAt = !fromStart && selectedEntry?.inProgress ? selectedEntry.positionMs : null;

  const choose = (target: MetaVideo | "movie", start = false) => {
    setFromStart(start);
    setSelected(target);
  };

  /** Trailer in the app's player; closing it returns here. Not saved to history or progress. */
  const playTrailer = async () => {
    if (!data?.trailer) return;
    setTrailerBusy(true);
    await player.play(() => api.trailerPlay(data.trailer!.key), { title: data.meta.name, subtitle: t("Trailer · {name}", { name: data.trailer.name }), view: "full" });
    setTrailerBusy(false);
  };

  const downloadRequest = (stream: StreamEntry) => {
    const video = selected && selected !== "movie" ? selected : null;
    return {
      key: stream.key, title: data!.meta.name, subtitle: video ? `${episodeLabel(video)} · ${video.title}` : null,
      poster: data!.meta.poster, season: video?.season ?? null, episode: video?.episode ?? null, playback: playbackItem(data!.meta, video),
    };
  };

  const [preparing, setPreparing] = useState<string | null>(null);
  const [blurUnwatched, setBlurUnwatched] = useState(false);
  const [autoFallback, setAutoFallback] = useState(true);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.settingsGet().then((v) => {
      if (cancelled) return;
      setBlurUnwatched(v.settings.player.blurUnwatchedEpisodes ?? false);
      setAutoFallback(v.settings.player.autoFallbackSource ?? true);
    }, () => {});
    return () => { cancelled = true; };
  }, []);

  const toggleWatched = async (video: MetaVideo | null, currentlyWatched: boolean) => {
    if (!data) return;
    const m = data.meta;
    await api.librarySetWatched(
      {
        id: m.id,
        contentType: m.contentType,
        name: m.name,
        poster: m.poster,
        releaseInfo: m.releaseInfo,
        season: video?.season ?? null,
        episode: video?.episode ?? null,
        videoId: video?.id ?? m.id,
      },
      !currentlyWatched,
    );
  };

  const play = async (stream: StreamEntry, prepared = false, torbox: TorboxStates = {}, allStreams?: StreamEntry[]) => {
    if (!data) return;
    const video = selected && selected !== "movie" ? selected : null;
    let direct = stream.kind === "direct";
    if (!prepared && stream.kind !== "direct") {
      setPreparing(stream.key);
      try {
        direct = await viaTorbox(stream, torbox, { season: video?.season ?? null, episode: video?.episode ?? null });
      } catch (e) {
        setPreparing(null);
        window.alert(errorText(e));
        return;
      }
      setPreparing(null);
    }
    if (stream.kind === "torrent" && !prepared && !direct) {
      setTorrent(stream);
      return;
    }
    const subtitle = video ? `${episodeLabel(video)} · ${video.title}` : data.meta.releaseInfo ?? undefined;
    const start = resumeAt !== null ? resumeAt / 1000 : null;
    setFallbackNote(null);

    const tryOne = async (s: StreamEntry, isDirect: boolean) => {
      const ok = await player.play(() => api.playStream(s.key, start, playbackItem(data.meta, video)), {
        title: data.meta.name,
        subtitle,
        view: "full",
        episode: video ? { meta: data.meta, video } : undefined,
        source: { meta: data.meta, video, streamKey: s.key },
        torrent: s.kind === "torrent" && !isDirect,
        download: downloadRequest(s),
      });
      if (!ok && s.kind === "torrent" && !isDirect) void api.torrentStop();
      return ok;
    };

    if (await tryOne(stream, direct)) return;

    if (autoFallback && allStreams && allStreams.length > 1) {
      const idx = allStreams.findIndex((s) => s.key === stream.key);
      const candidates = allStreams.slice(idx + 1).filter((s) => s.kind === "direct").slice(0, 3);
      for (const nextStream of candidates) {
        setFallbackNote(`Source failed — trying ${nextStream.name || "next source"}…`);
        if (await tryOne(nextStream, true)) {
          setFallbackNote(null);
          return;
        }
      }
      setFallbackNote(null);
    }
  };

  if (error) {
    return (
      <div className="screen-message">
        <button className="back" onClick={onBack}>←</button> {t("Não foi possível abrir os detalhes:")} {error}
      </div>
    );
  }
  if (!data) return <div className="screen-message">{t("Carregando detalhes…")}</div>;
  const m = data.meta;
  const movieEntry = entryFor("movie");
  const resumeVideo = progress?.resume ? m.videos.find((v) => v.season === progress.resume!.season && v.episode === progress.resume!.episode) : undefined;

  return (
    <div className="details" data-id={m.id} data-content-type={m.contentType}>
      <div className="details-backdrop" style={m.background ? { backgroundImage: `url("${m.background}")` } : undefined} />
      <div className="details-body">
        <button className="back" onClick={onBack} aria-label={t("Voltar")}>←</button>
        <div className={`details-layout ${selected ? "with-sources" : ""}`}>
        <div className="details-main">
        <div className="details-head">
          {m.poster && <img className="details-poster" src={m.poster} alt="" />}
          <div className="details-info">
            {m.logo ? <img className="details-logo" src={m.logo} alt={m.name} /> : <h1>{m.name}</h1>}
            <div className="meta-line">
              {[m.releaseInfo, m.runtime, m.imdbRating && `★ ${m.imdbRating}`, m.ageRating].filter(Boolean).join("   ")}
            </div>
            {m.genres.length > 0 && <div className="chips">{m.genres.map((g) => <span key={g} className="chip">{g}</span>)}</div>}
            {m.description && <p className="details-desc">{m.description}</p>}
            {m.director.length > 0 && <div className="muted">{t("Direção:")} {m.director.join(", ")}</div>}
            <div className="details-actions">
              {!isSeries && (movieEntry?.inProgress ? (
                <>
                  <button className="primary" data-testid="watch" onClick={() => choose("movie")}>▶ {t("Continuar de {time}", { time: clock(movieEntry.positionMs) })}</button>
                  <button className="chip" data-testid="watch-from-start" onClick={() => choose("movie", true)}>{t("Assistir do início")}</button>
                </>
              ) : (
                <button className="primary" data-testid="watch" onClick={() => choose("movie", true)}>{t("▶ Assistir")}</button>
              ))}
              {isSeries && resumeVideo && progress?.resume && (
                <button className="primary" data-testid="resume-episode" onClick={() => { setSeason(resumeVideo.season); choose(resumeVideo); }}>
                  {t("▶ Continuar")} {episodeCode(progress.resume)} · {clock(progress.resume.positionMs)}
                </button>
              )}
              {data.trailer && (
                <button className="chip" data-testid="watch-trailer" disabled={trailerBusy} onClick={() => void playTrailer()}>
                  {trailerBusy ? t("Carregando trailer…") : t("▶ Assistir trailer")}
                </button>
              )}
              <FavoriteButton item={libraryItemFromDetails(m)} variant="pill" />
              {!isSeries && (
                <button
                  className={`chip ${movieEntry?.completed ? "active" : ""}`}
                  data-testid="toggle-movie-watched"
                  onClick={() => void toggleWatched(null, Boolean(movieEntry?.completed))}
                >
                  {movieEntry?.completed ? t("✓ Assistido") : "Mark watched"}
                </button>
              )}
            </div>
            {!isSeries && movieEntry && (
              <div className="muted small" data-testid="movie-progress">
                {movieEntry.completed ? t("✓ Assistido") : [t("{time} assistidos", { time: clock(movieEntry.positionMs) }), remaining(movieEntry)].filter(Boolean).join(" · ")}
              </div>
            )}
            <div className="muted small">{t("Detalhes por")} {addonLabel(data.addonName)}</div>
            <dl className="facts">
              {(
                [
                  [t("Classificação"), m.ageRating],
                  [t("Situação"), m.status],
                  [t("Roteiro"), m.writer.join(", ")],
                  [t("País"), m.country],
                  [t("Idioma"), m.language],
                  [t("Prêmios"), m.awards],
                  [t("Site"), m.website],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="fact"><dt>{k}</dt><dd>{v}</dd></div>
                ))}
            </dl>
          </div>
        </div>

        {player.error && <div className="row-error">{t("Falha ao reproduzir:")} {player.error}</div>}

        {isSeries && (
          <section className="details-section">
            <div className="season-tabs" role="tablist">
              {data.seasons.map((s) => (
                <button key={s} role="tab" aria-selected={season === s} className={`chip ${season === s ? "active" : ""}`} onClick={() => setSeason(s)}>
                  {s === 0 ? t("Especiais") : t("Temporada {season}", { season: s })}
                </button>
              ))}
              <button
                className={`chip ${blurUnwatched ? "active" : ""}`}
                style={{ marginInlineStart: "auto" }}
                title="Blur thumbnails of unwatched episodes"
                onClick={() => setBlurUnwatched((b) => !b)}
              >
                {blurUnwatched ? "Spoiler blur: On" : "Spoiler blur: Off"}
              </button>
            </div>
            <div className="episodes">
              {episodes.map((v) => {
                const e = entryFor(v);
                const isWatched = Boolean(e?.completed);
                const shouldBlur = blurUnwatched && !isWatched;
                return (
                  <div key={v.id} className="episode-row">
                    <button className={`episode ${selected !== "movie" && selected?.id === v.id ? "active" : ""}`} onClick={() => choose(v)} data-episode={`${v.season}:${v.episode}`}>
                      <div className={`episode-thumb ${shouldBlur ? "blurred" : ""}`}>
                        {v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" decoding="async" />}
                        {e && !e.completed && e.fraction > 0 && <div className="progress"><div style={{ width: `${Math.max(2, e.fraction * 100)}%` }} /></div>}
                      </div>
                      <div className="episode-text">
                        <div className="episode-title">{episodeLabel(v)} · {v.title}</div>
                        {v.released && <div className="muted small">{v.released.slice(0, 10)}</div>}
                        {e && (
                          <div className="small episode-progress" data-testid="episode-progress">
                            {e.completed ? t("✓ Assistido") : t("{time} assistidos", { time: clock(e.positionMs) }) + (remaining(e) ? ` · ${remaining(e)}` : "")}
                          </div>
                        )}
                        {v.overview && <div className="episode-overview">{v.overview}</div>}
                      </div>
                    </button>
                    <button
                      className={`ep-watched-btn ${isWatched ? "watched" : ""}`}
                      title={isWatched ? "Mark as unwatched" : "Mark as watched"}
                      aria-label={isWatched ? "Mark as unwatched" : "Mark as watched"}
                      onClick={() => void toggleWatched(v, isWatched)}
                    >
                      ✓
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {m.cast.length > 0 && (
          <section className="details-section">
            <h2>{t("Elenco")}</h2>
            <div className="cast">
              {m.cast.slice(0, 30).map((p) => (
                <div key={`${p.name}-${p.role ?? ""}`} className="person">
                  <div className="person-photo">{p.photo ? <img src={p.photo} alt="" loading="lazy" /> : p.name.slice(0, 1)}</div>
                  <div className="small">{p.name}</div>
                  {p.role && <div className="muted small">{p.role}</div>}
                </div>
              ))}
            </div>
          </section>
        )}
        </div>

        {selected && (
          <aside className="sources-panel" ref={sources} aria-label={t("Fontes")} data-testid="sources-panel">
            <header className="sources-header">
              <div>
                <h2>{t("Fontes")}</h2>
                <div className="muted small">
                  {selected === "movie" ? m.name : `${episodeLabel(selected)} · ${selected.title}`}
                  {resumeAt !== null && <span data-testid="resume-note"> · {t("continua de {time}", { time: clock(resumeAt) })}</span>}
                </div>
              </div>
              <button className="icon-btn" aria-label={t("Fechar fontes")} onClick={() => setSelected(null)}>✕</button>
            </header>
            <div className="sources-body">
              {preparing && <div className="muted small torbox-preparing" role="status"><span className="spinner" aria-hidden /> {t("Abrindo pelo TorBox…")}</div>}
              {fallbackNote && <div className="muted small" role="status"><span className="spinner" aria-hidden /> {fallbackNote}</div>}
              <StreamList
                contentType={m.contentType}
                id={selected === "movie" ? m.id : selected.id}
                onPlay={(stream, torbox, all) => void play(stream, false, torbox, all)}
                onDownload={(stream) => void startDownload(downloadRequest(stream))}
              />
            </div>
          </aside>
        )}
        </div>
      </div>
      {torrent && (
        <TorrentStart
          stream={torrent}
          onCancel={() => setTorrent(null)}
          onReady={() => {
            const s = torrent;
            setTorrent(null);
            void play(s, true);
          }}
        />
      )}
    </div>
  );
}
