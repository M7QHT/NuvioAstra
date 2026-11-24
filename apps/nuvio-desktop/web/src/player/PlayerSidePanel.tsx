// In-player slide-over drawer for switching Sources (keeping exact playback time),
// picking any Season/Episode of a series, or jumping to a video Chapter without leaving the player.

import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "../api";
import { StreamList } from "../components/StreamList";
import { TorrentStart } from "../components/TorrentStart";
import { playbackItem } from "../library";
import { startDownload, viaTorbox, type TorboxStates } from "../sources";
import type { Chapter, MetaDetails, MetaVideo, StreamEntry } from "../types";
import { episodeTitle } from "./episodes";
import { usePlayer, type PlayerSourceContext } from "./PlayerContext";
import { formatTime } from "./PlayerControls";

export type PlayerDrawerMode = "sources" | "episodes" | "chapters";

interface Props {
  mode: PlayerDrawerMode;
  source?: PlayerSourceContext;
  chapters: Chapter[];
  timePos: number;
  autoFallback: boolean;
  onClose(): void;
}

function episodeSubtitle(v: MetaVideo | null, meta: MetaDetails): string | undefined {
  if (!v) return meta.releaseInfo ?? undefined;
  return episodeTitle(v);
}

export function PlayerSidePanel({ mode, source, chapters, timePos, autoFallback, onClose }: Props) {
  const player = usePlayer();
  const meta = source?.meta;
  const currentVideo = source?.video ?? null;

  const seasons = useMemo(() => {
    if (!meta) return [];
    const set = new Set<number>();
    for (const v of meta.videos) {
      if (v.season != null) set.add(v.season);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [meta]);

  const [season, setSeason] = useState<number | null>(() => currentVideo?.season ?? seasons.find((s) => s > 0) ?? seasons[0] ?? null);
  const [pickedEpisode, setPickedEpisode] = useState<MetaVideo | null>(null);
  const [torrent, setTorrent] = useState<StreamEntry | null>(null);
  const [starting, setStarting] = useState(false);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "episodes") setPickedEpisode(null);
  }, [mode]);

  useEffect(() => {
    if (!torrent) return;
    const block = (e: KeyboardEvent) => e.key === "Escape" && e.stopPropagation();
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [torrent]);

  const episodes = useMemo(() => {
    if (!meta || season == null) return [];
    return meta.videos
      .filter((v) => v.season === season)
      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  }, [meta, season]);

  const activeChapterIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (timePos >= chapters[i].time) idx = i;
    }
    return idx;
  }, [chapters, timePos]);

  const downloadRequest = (stream: StreamEntry, targetVideo: MetaVideo | null) => ({
    key: stream.key,
    title: meta!.name,
    subtitle: targetVideo ? episodeTitle(targetVideo) : null,
    poster: meta!.poster,
    season: targetVideo?.season ?? null,
    episode: targetVideo?.episode ?? null,
    playback: playbackItem(meta!, targetVideo),
  });

  const playStream = async (
    stream: StreamEntry,
    targetVideo: MetaVideo | null,
    keepPosition: boolean,
    torbox: TorboxStates = {},
    allStreams?: StreamEntry[],
    prepared = false,
  ) => {
    if (!meta || starting) return;
    let direct = stream.kind === "direct";
    if (!prepared && stream.kind !== "direct") {
      setStarting(true);
      try {
        direct = await viaTorbox(stream, torbox, { season: targetVideo?.season ?? null, episode: targetVideo?.episode ?? null });
      } catch (e) {
        setStarting(false);
        window.alert(errorText(e));
        return;
      }
      setStarting(false);
    }
    if (stream.kind === "torrent" && !prepared && !direct) {
      void api.playerCommand({ type: "setPaused", paused: true });
      setTorrent(stream);
      return;
    }
    setStarting(true);
    setFallbackNote(null);
    const startSec = keepPosition && timePos > 2 ? timePos : null;

    const tryOne = async (s: StreamEntry, isDirect: boolean) => {
      const ok = await player.play(() => api.playStream(s.key, startSec, playbackItem(meta, targetVideo)), {
        title: meta.name,
        subtitle: episodeSubtitle(targetVideo, meta),
        view: "full",
        returnTo: null,
        episode: targetVideo ? { meta, video: targetVideo } : undefined,
        source: { meta, video: targetVideo, streamKey: s.key },
        torrent: s.kind === "torrent" && !isDirect,
        download: downloadRequest(s, targetVideo),
      });
      if (!ok && s.kind === "torrent" && !isDirect) void api.torrentStop();
      return ok;
    };

    if (await tryOne(stream, direct)) {
      onClose();
      return;
    }

    if (autoFallback && allStreams && allStreams.length > 1) {
      const idx = allStreams.findIndex((s) => s.key === stream.key);
      const candidates = allStreams.slice(idx + 1).filter((s) => s.kind === "direct").slice(0, 3);
      for (const nextStream of candidates) {
        setFallbackNote(`Source failed — trying ${nextStream.name || "next source"}…`);
        if (await tryOne(nextStream, true)) {
          onClose();
          return;
        }
      }
    }

    setStarting(false);
    setFallbackNote(null);
  };

  const cancelTorrent = () => {
    setTorrent(null);
    if (player.session?.torrent) void player.close();
    else void api.playerCommand({ type: "setPaused", paused: false });
  };

  const activeTargetVideo = mode === "episodes" ? pickedEpisode : currentVideo;
  const keepPos = mode === "sources";

  return (
    <div className="next-panel-layer" data-testid={`player-panel-${mode}`}>
      <button className="next-panel-outside" aria-label="Close panel" tabIndex={-1} onClick={onClose} />
      <aside className="next-panel" aria-label={mode === "sources" ? "Sources" : mode === "episodes" ? "Episodes" : "Chapters"}>
        <header className="sources-header">
          <div>
            <h2>
              {mode === "sources" && "Sources"}
              {mode === "episodes" && (pickedEpisode ? episodeTitle(pickedEpisode) : "Episodes")}
              {mode === "chapters" && "Chapters"}
            </h2>
            <div className="muted small">
              {mode === "sources" && meta && (
                <>
                  {currentVideo ? episodeTitle(currentVideo) : meta.name}
                  {timePos > 2 && ` · resumes at ${formatTime(timePos)}`}
                </>
              )}
              {mode === "episodes" && pickedEpisode && (
                <button className="link-btn" onClick={() => setPickedEpisode(null)}>← All episodes</button>
              )}
              {mode === "episodes" && !pickedEpisode && meta && meta.name}
              {mode === "chapters" && `${chapters.length} chapter(s)`}
            </div>
          </div>
          <button className="icon-btn" aria-label="Close panel" onClick={onClose}>✕</button>
        </header>

        <div className="sources-body">
          {player.error && !fallbackNote && <div className="row-error">Failed to play: {player.error}</div>}
          {fallbackNote && <div className="muted"><span className="spinner" aria-hidden /> {fallbackNote}</div>}

          {mode === "sources" && meta && (
            starting ? (
              <div className="muted"><span className="spinner" aria-hidden /> Switching source…</div>
            ) : (
              <StreamList
                contentType={meta.contentType}
                id={currentVideo ? currentVideo.id : meta.id}
                activeKey={source?.streamKey}
                onPlay={(s, tb, all) => void playStream(s, currentVideo, true, tb, all)}
                onDownload={(s) => void startDownload(downloadRequest(s, currentVideo))}
              />
            )
          )}

          {mode === "episodes" && meta && !pickedEpisode && (
            <>
              {seasons.length > 1 && (
                <div className="season-tabs" role="tablist">
                  {seasons.map((s) => (
                    <button key={s} role="tab" aria-selected={season === s} className={`chip ${season === s ? "active" : ""}`} onClick={() => setSeason(s)}>
                      {s === 0 ? "Specials" : `S${s}`}
                    </button>
                  ))}
                </div>
              )}
              <div className="drawer-episodes">
                {episodes.map((v) => {
                  const isCurrent = currentVideo?.id === v.id;
                  return (
                    <button key={v.id} className={`drawer-ep ${isCurrent ? "active" : ""}`} onClick={() => setPickedEpisode(v)}>
                      <div className="drawer-ep-title">
                        {v.season != null && v.episode != null ? `S${v.season} E${v.episode} · ` : ""}{v.title}
                      </div>
                      {v.released && <div className="muted small">{v.released.slice(0, 10)}</div>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {mode === "episodes" && meta && pickedEpisode && (
            starting ? (
              <div className="muted"><span className="spinner" aria-hidden /> Opening episode…</div>
            ) : (
              <StreamList
                contentType={meta.contentType}
                id={pickedEpisode.id}
                onPlay={(s, tb, all) => void playStream(s, pickedEpisode, false, tb, all)}
                onDownload={(s) => void startDownload(downloadRequest(s, pickedEpisode))}
              />
            )
          )}

          {mode === "chapters" && (
            <div className="drawer-episodes">
              {chapters.length === 0 ? (
                <div className="muted">This video has no chapters.</div>
              ) : (
                chapters.map((ch, i) => (
                  <button
                    key={`${ch.time}-${i}`}
                    className={`drawer-ep ${i === activeChapterIdx ? "active" : ""}`}
                    onClick={() => {
                      void api.playerCommand({ type: "seek", seconds: ch.time, relative: false });
                      onClose();
                    }}
                  >
                    <div className="drawer-ep-title">{ch.title || `Chapter ${i + 1}`}</div>
                    <div className="muted small">{formatTime(ch.time)}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </aside>

      {torrent && (
        <TorrentStart
          stream={torrent}
          onCancel={cancelTorrent}
          onReady={() => {
            const s = torrent;
            setTorrent(null);
            void playStream(s, activeTargetVideo, keepPos, {}, undefined, true);
          }}
        />
      )}
    </div>
  );
}
