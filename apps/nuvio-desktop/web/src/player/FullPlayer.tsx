// Whole-window player: the video uses the full client area (rect `null`) and the controls fade
// out after 3 s without mouse movement.
// Gestures on the video surface:
//   - Single click: play / pause
//   - Double click: toggle fullscreen
//   - Press & hold (~240 ms): temporary 2x speed while held (non-live)
//   - Mouse wheel: volume ±5%
// Keyboard: Space/K, ←/→ (±10s, Shift ±30s), J/L, ↑/↓, M, F, N, S (sources), E (episodes),
// G/H (subtitle delay ±100ms), I (media info), Esc.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import { api } from "../api";
import { listen } from "../tauri";
import { usePlayer } from "./PlayerContext";
import { P2pStats } from "./P2pStats";
import { EnhanceNotice } from "./EnhanceMenu";
import { PlayerControls } from "./PlayerControls";
import { airDate, episodeTitle, hasAired, nextEpisode } from "./episodes";
import { NextEpisodePanel } from "./NextEpisodePanel";
import { PlayerSidePanel, type PlayerDrawerMode } from "./PlayerSidePanel";
import { PlaybackMoments, reachedNextEpisode, useMoments } from "./PlaybackMoments";
import { SubtitleMenu } from "./SubtitleMenu";
import { startDownload } from "../sources";
import { t } from "../i18n";

export function FullPlayer() {
  const player = usePlayer();
  const { session, snapshot } = player;
  const [visible, setVisible] = useState(true);
  const [pip, setPip] = useState(false);
  const [drawer, setDrawer] = useState<PlayerDrawerMode | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [osd, setOsd] = useState<string | null>(null);
  const [boostActive, setBoostActive] = useState(false);
  const [autoFallback, setAutoFallback] = useState(true);

  const hideTimer = useRef<number>(0);
  const osdTimer = useRef<number>(0);
  const clickTimer = useRef<number>(0);
  const holdTimer = useRef<number>(0);
  const prevSpeedRef = useRef<number>(1);
  const boostRef = useRef<boolean>(false);
  const suppressClickRef = useRef<boolean>(false);

  const live = session?.live === true;
  const moments = useMoments(snapshot, !live);
  const episode = session?.episode;
  const next = useMemo(() => (episode ? nextEpisode(episode) : null), [episode]);
  const nextAired = next !== null && hasAired(next.released);
  const [choosingNext, setChoosingNext] = useState(false);

  const hasSources = Boolean(session?.source && !live);
  const hasEpisodes = Boolean(session?.source?.meta.videos.length && !live);
  const hasChapters = Boolean(snapshot && snapshot.chapters.length > 0 && !live);

  useEffect(() => {
    let alive = true;
    api.settingsGet().then((v) => {
      if (alive) setAutoFallback(v.settings.player.autoFallbackSource ?? true);
    }, () => {});
    return () => { alive = false; };
  }, []);

  // Another episode started: close drawers.
  useEffect(() => {
    setChoosingNext(false);
    setDrawer(null);
  }, [episode, session?.source?.streamKey]);

  const flashOsd = useCallback((text: string) => {
    setOsd(text);
    window.clearTimeout(osdTimer.current);
    osdTimer.current = window.setTimeout(() => setOsd(null), 1100);
  }, []);

  const endBoost = useCallback(() => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = 0;
    if (boostRef.current) {
      boostRef.current = false;
      setBoostActive(false);
      void api.playerCommand({ type: "setSpeed", speed: prevSpeedRef.current });
    }
  }, []);

  useEffect(() => {
    window.addEventListener("blur", endBoost);
    return () => {
      window.removeEventListener("blur", endBoost);
      window.clearTimeout(osdTimer.current);
      window.clearTimeout(clickTimer.current);
      window.clearTimeout(holdTimer.current);
    };
  }, [endBoost]);

  const openNext = useCallback(() => {
    if (!nextAired) return;
    if (player.session && snapshot?.pictureInPicture) void api.pictureInPicture(false, "").catch(() => {});
    setDrawer(null);
    setChoosingNext(true);
  }, [nextAired, player.session, snapshot?.pictureInPicture]);

  useEffect(() => {
    void api.playerRect(null);
  }, []);

  const leave = useCallback(async () => {
    endBoost();
    if (player.windowFullscreen) await player.setWindowFullscreen(false);
    if (session?.returnTo) player.setView(session.returnTo);
    else await player.close();
  }, [endBoost, player, session]);

  const toggleFullscreen = useCallback(() => {
    if (session?.returnTo && player.windowFullscreen) void leave();
    else void player.setWindowFullscreen(!player.windowFullscreen);
  }, [leave, player, session]);

  const poke = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), 3000);
  }, []);
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke]);

  const adjustVolume = useCallback((delta: number) => {
    const nextVol = Math.max(0, Math.min(200, Math.round((snapshot?.volume ?? 100) + delta)));
    void api.playerCommand({ type: "setVolume", volume: nextVol });
    if (snapshot?.mute && delta > 0) void api.playerCommand({ type: "setMute", mute: false });
    flashOsd(`🔊 ${nextVol}%`);
  }, [flashOsd, snapshot?.mute, snapshot?.volume]);

  const adjustSubDelay = useCallback((deltaMs: number) => {
    const nextMs = (snapshot?.subDelayMs ?? 0) + deltaMs;
    void api.playerCommand({ type: "setSubtitleDelay", ms: nextMs });
    const sec = (nextMs / 1000).toFixed(1);
    flashOsd(`Sub delay: ${nextMs >= 0 ? "+" : ""}${sec}s`);
  }, [flashOsd, snapshot?.subDelayMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
      if (choosingNext || drawer) {
        if (e.key === "Escape") {
          setChoosingNext(false);
          setDrawer(null);
        }
        return;
      }
      poke();
      const k = e.key.toLowerCase();
      if (e.key === " " || k === "k") {
        e.preventDefault();
        void api.playerCommand({ type: "togglePause" });
        flashOsd(snapshot?.paused ? "▶ Play" : "⏸ Pause");
      } else if (e.key === "ArrowLeft" || k === "j") {
        if (!live) {
          const sec = e.shiftKey ? -30 : -10;
          void api.playerCommand({ type: "seek", seconds: sec, relative: true });
          flashOsd(`⏪ ${sec}s`);
        }
      } else if (e.key === "ArrowRight" || k === "l") {
        if (!live) {
          const sec = e.shiftKey ? 30 : 10;
          void api.playerCommand({ type: "seek", seconds: sec, relative: true });
          flashOsd(`⏩ +${sec}s`);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        adjustVolume(5);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        adjustVolume(-5);
      } else if (k === "m") {
        const nextMute = !snapshot?.mute;
        void api.playerCommand({ type: "setMute", mute: nextMute });
        flashOsd(nextMute ? "🔇 Muted" : "🔊 Unmuted");
      } else if (k === "f") {
        toggleFullscreen();
      } else if (k === "n") {
        openNext();
      } else if (k === "s" && hasSources) {
        setDrawer((d) => (d === "sources" ? null : "sources"));
      } else if (k === "e" && hasEpisodes) {
        setDrawer((d) => (d === "episodes" ? null : "episodes"));
      } else if (k === "g" && !live) {
        adjustSubDelay(-100);
      } else if (k === "h" && !live) {
        adjustSubDelay(100);
      } else if (k === "i") {
        setShowInfo((v) => !v);
      } else if (e.key === "Escape") {
        if (showInfo) setShowInfo(false);
        else void leave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adjustSubDelay, adjustVolume, choosingNext, drawer, flashOsd, hasEpisodes, hasSources, leave, live, openNext, poke, showInfo, snapshot, toggleFullscreen]);

  // Also changed from the PiP window itself, or by closing it.
  useEffect(() => listen<boolean>("player-pip", setPip), []);

  const togglePip = async () => {
    try {
      await api.pictureInPicture(!pip, session?.title ?? "Nuvio");
      setPip(!pip);
    } catch {
      /* the player reports its own error state */
    }
  };

  // Video stage pointer gestures: single click = pause/play, double click = fullscreen, hold = 2x speed
  const onStagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || choosingNext || drawer) return;
    suppressClickRef.current = false;
    if (!live) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => {
        prevSpeedRef.current = snapshot?.speed && snapshot.speed !== 2 ? snapshot.speed : 1;
        boostRef.current = true;
        suppressClickRef.current = true;
        setBoostActive(true);
        void api.playerCommand({ type: "setSpeed", speed: 2 });
      }, 240);
    }
  };

  const onStagePointerUp = () => {
    endBoost();
  };

  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || choosingNext || drawer) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (e.detail === 1) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = window.setTimeout(() => {
        void api.playerCommand({ type: "togglePause" });
        flashOsd(snapshot?.paused ? "▶ Play" : "⏸ Pause");
      }, 210);
    }
  };

  const onStageDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (choosingNext || drawer) return;
    e.preventDefault();
    window.clearTimeout(clickTimer.current);
    endBoost();
    toggleFullscreen();
  };

  const onStageWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (choosingNext || drawer || Math.abs(e.deltaY) < 1) return;
    poke();
    adjustVolume(e.deltaY < 0 ? 5 : -5);
  };

  return (
    <div className={`full-player ${visible || choosingNext || drawer ? "" : "chrome-hidden"}`} onMouseMove={poke}>
      <div
        className="player-stage"
        data-testid="player-stage"
        onPointerDown={onStagePointerDown}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
        onPointerLeave={onStagePointerUp}
        onClick={onStageClick}
        onDoubleClick={onStageDoubleClick}
        onWheel={onStageWheel}
      />

      {boostActive && (
        <div className="player-boost-pill" data-testid="player-boost">
          2x ⏩
        </div>
      )}

      {osd && !boostActive && (
        <div className="player-osd" data-testid="player-osd">
          {osd}
        </div>
      )}

      {showInfo && snapshot && (
        <div className="player-info-card" data-testid="player-info">
          <div className="player-info-head">
            <strong>Media Info</strong>
            <button className="icon-btn" aria-label={t("Fechar")} onClick={() => setShowInfo(false)}>✕</button>
          </div>
          <div className="player-info-grid">
            <span>Resolution</span><b>{snapshot.width > 0 ? `${snapshot.width}×${snapshot.height}` : "—"}</b>
            <span>Video Codec</span><b>{snapshot.videoCodec ?? "—"}</b>
            <span>FPS</span><b>{snapshot.fps > 0 ? snapshot.fps.toFixed(2) : "—"}</b>
            <span>HW Decoder</span><b>{snapshot.hwdecCurrent || "Software"}</b>
            <span>Buffer Ahead</span><b>{Math.round(snapshot.cacheSeconds)}s</b>
            <span>Dropped Frames</span><b>{snapshot.droppedFrames}</b>
            <span>Sub Delay</span><b>{(snapshot.subDelayMs / 1000).toFixed(1)}s</b>
          </div>
        </div>
      )}

      <div className="full-player-top">
        <button className="back" onClick={() => void leave()} aria-label={t("Voltar")}>←</button>
        <div>
          <div className="full-player-title">{session?.title}</div>
          {session?.subtitle && <div className="muted">{session.subtitle}</div>}
        </div>
        <P2pStats />
      </div>
      {pip && (
        <div className="pip-placeholder" data-testid="pip-placeholder">
          <p>{t("Reproduzindo em picture-in-picture")}</p>
          <button className="ghost" onClick={() => void togglePip()}>{t("Trazer de volta")}</button>
        </div>
      )}
      <EnhanceNotice key={`notice-${snapshot?.session}`} snapshot={snapshot} />
      <PlayerControls
        snapshot={snapshot}
        live={live}
        fullscreen={player.windowFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onPictureInPicture={() => void togglePip()}
        onDownload={session?.download ? () => void startDownload(session.download!) : undefined}
        onOpenSources={hasSources ? () => { setChoosingNext(false); setDrawer((d) => (d === "sources" ? null : "sources")); } : undefined}
        onOpenEpisodes={hasEpisodes ? () => { setChoosingNext(false); setDrawer((d) => (d === "episodes" ? null : "episodes")); } : undefined}
        onOpenChapters={hasChapters ? () => { setChoosingNext(false); setDrawer((d) => (d === "chapters" ? null : "chapters")); } : undefined}
        subtitles={snapshot ? <SubtitleMenu key={`subtitles-${snapshot.session}`} snapshot={snapshot} /> : undefined}
        next={
          next
            ? {
                label: nextAired ? `${episodeTitle(next)} (N)` : t("Não exibido · {date}", { date: airDate(next.released) }),
                disabled: !nextAired,
                open: openNext,
              }
            : undefined
        }
      />
      {snapshot && !live && !pip && (
        <PlaybackMoments
          key={`moments-${snapshot.session}`}
          snapshot={snapshot}
          moments={moments}
          next={next}
          covered={choosingNext || drawer !== null}
          chromeVisible={visible}
          onNext={openNext}
        />
      )}
      {choosingNext && episode && next && (
        <NextEpisodePanel
          key={next.id}
          context={episode}
          next={next}
          finished={() => reachedNextEpisode(snapshot, moments)}
          onClose={() => setChoosingNext(false)}
        />
      )}
      {drawer && (
        <PlayerSidePanel
          mode={drawer}
          source={session?.source}
          chapters={snapshot?.chapters ?? []}
          timePos={snapshot?.timePos ?? 0}
          autoFallback={autoFallback}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
