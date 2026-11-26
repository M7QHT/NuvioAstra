// Release Calendar: upcoming and recent episodes across the user's tracked series & anime
// (favorites + watch history), calculated in Rust (`services::calendar`) from addon metadata.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText } from "../api";
import { useLibraryVersion } from "../library";
import type { CalendarEpisode, CalendarView } from "../types";
import { locale, t } from "../i18n";

interface Props {
  onOpenEpisode(ep: CalendarEpisode): void;
}

type Mode = "upcoming" | "month" | "recent";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function episodeCode(ep: CalendarEpisode) {
  return `S${pad2(ep.season)}E${pad2(ep.episode)}`;
}

function formatDateHeading(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(locale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function relativeLabel(days: number): string {
  if (days === 0) return t("Hoje");
  if (days === 1) return t("Amanhã");
  if (days === -1) return t("Ontem");
  if (days > 1) return t("Em {days}d", { days });
  return t("Há {days}d", { days: Math.abs(days) });
}

export function Calendar({ onOpenEpisode }: Props) {
  const version = useLibraryVersion();
  const [view, setView] = useState<CalendarView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("upcoming");
  const [unwatchedOnly, setUnwatchedOnly] = useState(false);
  const [monthCursor, setMonthCursor] = useState<{ y: number; m: number }>(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.libraryCalendar(30, 60);
      setView(data);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const filtered = useMemo(() => {
    const all = view?.episodes ?? [];
    const base = unwatchedOnly ? all.filter((e) => !e.watched) : all;
    if (mode === "upcoming") return base.filter((e) => e.daysFromToday >= 0);
    if (mode === "recent") return [...base.filter((e) => e.daysFromToday < 0)].reverse();
    const prefix = `${monthCursor.y}-${pad2(monthCursor.m + 1)}-`;
    const inMonth = base.filter((e) => e.airDate.startsWith(prefix));
    return selectedDay ? inMonth.filter((e) => e.airDate === selectedDay) : inMonth;
  }, [mode, monthCursor, selectedDay, unwatchedOnly, view]);

  const grouped = useMemo(() => {
    const map = new Map<string, { airDate: string; daysFromToday: number; items: CalendarEpisode[] }>();
    for (const ep of filtered) {
      const cur = map.get(ep.airDate);
      if (cur) cur.items.push(ep);
      else map.set(ep.airDate, { airDate: ep.airDate, daysFromToday: ep.daysFromToday, items: [ep] });
    }
    return Array.from(map.values());
  }, [filtered]);

  const monthCounts = useMemo(() => {
    const map = new Map<string, number>();
    const all = view?.episodes ?? [];
    const base = unwatchedOnly ? all.filter((e) => !e.watched) : all;
    for (const ep of base) {
      map.set(ep.airDate, (map.get(ep.airDate) ?? 0) + 1);
    }
    return map;
  }, [unwatchedOnly, view]);

  const monthCells = useMemo(() => {
    const first = new Date(Date.UTC(monthCursor.y, monthCursor.m, 1));
    const startOffset = first.getUTCDay();
    const daysInMonth = new Date(Date.UTC(monthCursor.y, monthCursor.m + 1, 0)).getUTCDate();
    const cells: ({ iso: string; day: number } | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: `${monthCursor.y}-${pad2(monthCursor.m + 1)}-${pad2(d)}`, day: d });
    }
    return cells;
  }, [monthCursor]);

  const shiftMonth = (delta: number) => {
    setSelectedDay(null);
    setMonthCursor((prev) => {
      const d = new Date(Date.UTC(prev.y, prev.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });
  };

  const resetToday = () => {
    const parts = (view?.today ?? "").split("-").map(Number);
    if (parts.length === 3 && parts[0] && parts[1]) {
      setMonthCursor({ y: parts[0], m: parts[1] - 1 });
      setSelectedDay(view!.today);
    } else {
      const now = new Date();
      setMonthCursor({ y: now.getFullYear(), m: now.getMonth() });
      setSelectedDay(null);
    }
  };

  const monthTitle = new Date(Date.UTC(monthCursor.y, monthCursor.m, 1)).toLocaleDateString(locale(), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const weekdays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) =>
      new Date(Date.UTC(2024, 0, 7 + i)).toLocaleDateString(locale(), { weekday: "short", timeZone: "UTC" }),
    );
  }, []);

  return (
    <div className="calendar" data-testid="calendar-screen">
      <header className="calendar-header">
        <div>
          <h1>{t("Calendário")}</h1>
          {view && (
            <div className="muted small">
              {t("{count} séries acompanhadas", { count: view.trackedSeries })}
            </div>
          )}
        </div>
        <div className="calendar-controls">
          <div className="season-tabs" role="tablist">
            {(
              [
                ["upcoming", "Próximos"],
                ["month", "Mês"],
                ["recent", "Recentes"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={mode === id}
                className={`chip ${mode === id ? "active" : ""}`}
                onClick={() => {
                  setMode(id);
                  if (id !== "month") setSelectedDay(null);
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <button
            className={`chip ${unwatchedOnly ? "active" : ""}`}
            aria-pressed={unwatchedOnly}
            onClick={() => setUnwatchedOnly((v) => !v)}
          >
            {t("Não assistidos")}
          </button>
          <button className="ghost" disabled={loading} onClick={() => void load()}>
            {loading ? t("Carregando…") : t("Atualizar")}
          </button>
        </div>
      </header>

      {error && <div className="row-error">{error}</div>}

      {mode === "month" && (
        <section className="calendar-month">
          <div className="cal-month-bar">
            <button className="icon-btn" aria-label={t("Anterior")} onClick={() => shiftMonth(-1)}>‹</button>
            <strong>{monthTitle}</strong>
            <button className="icon-btn" aria-label={t("Próximo")} onClick={() => shiftMonth(1)}>›</button>
            <button className="chip" onClick={resetToday}>{t("Hoje")}</button>
            {selectedDay && (
              <button className="link small" onClick={() => setSelectedDay(null)}>
                {formatDateHeading(selectedDay)} ✕
              </button>
            )}
          </div>
          <div className="calendar-grid">
            {weekdays.map((w) => (
              <div key={w} className="cal-weekday">{w}</div>
            ))}
            {monthCells.map((cell, idx) => {
              if (!cell) return <div key={`empty-${idx}`} className="cal-cell empty" />;
              const count = monthCounts.get(cell.iso) ?? 0;
              const isToday = view?.today === cell.iso;
              const isSelected = selectedDay === cell.iso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  className={`cal-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${count > 0 ? "has-eps" : ""}`}
                  onClick={() => setSelectedDay((prev) => (prev === cell.iso ? null : cell.iso))}
                >
                  <span className="cal-day-num">{cell.day}</span>
                  {count > 0 && <span className="cal-day-count">{count}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {loading && !view ? (
        <div className="screen-message">{t("Carregando…")}</div>
      ) : view && view.trackedSeries === 0 ? (
        <div className="screen-message">
          {t("Salve séries nos favoritos ou assista a um episódio para ver os próximos lançamentos aqui.")}
        </div>
      ) : grouped.length === 0 ? (
        <div className="screen-message">{t("Nenhum episódio encontrado neste período.")}</div>
      ) : (
        <div className="cal-groups">
          {grouped.map((g) => (
            <section key={g.airDate} className="cal-group">
              <header className="cal-group-head">
                <h2>{formatDateHeading(g.airDate)}</h2>
                <span className={`cal-badge ${g.daysFromToday === 0 ? "today" : ""}`}>
                  {relativeLabel(g.daysFromToday)}
                </span>
              </header>
              <div className="cal-cards">
                {g.items.map((ep) => (
                  <button
                    key={`${ep.metaId}:${ep.season}:${ep.episode}`}
                    className={`cal-card ${ep.watched ? "watched" : ""}`}
                    onClick={() => onOpenEpisode(ep)}
                  >
                    <div className="cal-thumb">
                      {(ep.thumbnail || ep.poster) && (
                        <img src={ep.thumbnail ?? ep.poster ?? ""} alt="" loading="lazy" decoding="async" />
                      )}
                      {ep.watched && <span className="cal-watched-pill">✓</span>}
                    </div>
                    <div className="cal-info">
                      <div className="cal-series">{ep.seriesName}</div>
                      <div className="cal-ep">
                        {episodeCode(ep)}
                        {ep.episodeTitle ? ` · ${ep.episodeTitle}` : ""}
                      </div>
                      {ep.overview && <div className="cal-overview">{ep.overview}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
