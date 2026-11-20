// One player for the whole app (Rust enforces one session at a time). Screens ask it to play a
// stream already resolved by Rust; the video itself is drawn by mpv below the webview and the UI
// only reserves its area (`PlayerSurface`) and draws the controls over it.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "../api";
import { listen } from "../tauri";
import type { PlayerInfo, PlayerSnapshot } from "../types";

/** `embedded`: video inside a screen area (Live TV preview). `full`: the whole window. */
export type PlayerView = "embedded" | "full";

export interface PlayerSession {
  title: string;
  subtitle?: string;
  /** Live channel: no timeline, seek and speed controls. */
  live?: boolean;
  view: PlayerView;
  /** View to return to when leaving `full` (Live TV fullscreen → preview); `null` closes. */
  returnTo: PlayerView | null;
}

interface PlayerApi {
  session: PlayerSession | null;
  snapshot: PlayerSnapshot | null;
  error: string | null;
  play(start: () => Promise<PlayerInfo>, session: Omit<PlayerSession, "returnTo"> & { returnTo?: PlayerView | null }): Promise<boolean>;
  setView(view: PlayerView): void;
  close(): Promise<void>;
  windowFullscreen: boolean;
  setWindowFullscreen(on: boolean): Promise<void>;
}

const Ctx = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const value = useContext(Ctx);
  if (!value) throw new Error("PlayerProvider missing");
  return value;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowFullscreen, setFs] = useState(false);
  const sessionId = useRef(0);

  useEffect(
    () =>
      listen<PlayerSnapshot>("player-state", (s) => {
        // Late events of a closed session are ignored.
        if (s.session >= sessionId.current) setSnapshot(s);
      }),
    [],
  );

  useEffect(() => {
    document.body.classList.toggle("playing", session !== null);
  }, [session]);

  const setWindowFullscreen = useCallback(async (on: boolean) => {
    setFs(on);
    await api.setFullscreen(on).catch(() => {});
  }, []);

  const play = useCallback<PlayerApi["play"]>(async (start, next) => {
    setError(null);
    try {
      const info = await start();
      sessionId.current = info.session;
      setSnapshot(null);
      setSession({ returnTo: null, ...next });
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }, []);

  const close = useCallback(async () => {
    await api.playerClose().catch(() => {});
    setSession(null);
    setSnapshot(null);
    if (windowFullscreen) await setWindowFullscreen(false);
  }, [windowFullscreen, setWindowFullscreen]);

  const setView = useCallback((view: PlayerView) => {
    setSession((s) => (s ? { ...s, view } : s));
  }, []);

  const value = useMemo(
    () => ({ session, snapshot, error, play, setView, close, windowFullscreen, setWindowFullscreen }),
    [session, snapshot, error, play, setView, close, windowFullscreen, setWindowFullscreen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
