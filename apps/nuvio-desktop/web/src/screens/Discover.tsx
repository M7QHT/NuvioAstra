// Stremio-style Discover screen: browse any installed addon catalog in a full grid
// with quick Type, Catalog, and Genre filters.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import { PosterCard } from "../components/PosterCard";
import { addonLabel, localizeCatalogTitle } from "../i18n";
import type { HomeRow, MetaPreview } from "../types";

interface Props {
  onOpen(item: MetaPreview): void;
}

const GENRES = [
  "All", "Action", "Adventure", "Animation", "Comedy", "Crime",
  "Documentary", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Thriller",
] as const;

export function Discover({ onOpen }: Props) {
  const [rows, setRows] = useState<HomeRow[] | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [genre, setGenre] = useState<string>("All");
  const [items, setItems] = useState<MetaPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextSkip, setNextSkip] = useState<number | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api.homeRows().then(
      (v) => {
        if (cancelled) return;
        const catalogs = v.rows.filter((r) => !r.collection);
        setRows(catalogs);
        if (catalogs.length > 0) setSelectedKey(catalogs[0].key);
      },
      (e) => !cancelled && setError(errorText(e)),
    );
    return () => { cancelled = true; };
  }, []);

  const types = useMemo(() => {
    if (!rows) return [];
    const set = new Set<string>();
    for (const r of rows) set.add(r.contentType.toLowerCase());
    return Array.from(set);
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    if (typeFilter === "all") return rows;
    return rows.filter((r) => r.contentType.toLowerCase() === typeFilter);
  }, [rows, typeFilter]);

  useEffect(() => {
    if (!filteredRows.length) return;
    if (!filteredRows.some((r) => r.key === selectedKey)) {
      setSelectedKey(filteredRows[0].key);
    }
  }, [filteredRows, selectedKey]);

  const activeRow = useMemo(
    () => filteredRows.find((r) => r.key === selectedKey) ?? null,
    [filteredRows, selectedKey],
  );

  const load = useCallback(
    async (row: HomeRow, skip: number | null, activeGenre: string) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      try {
        const page = await api.catalogPage(row.key, skip, activeGenre === "All" ? null : activeGenre);
        setItems((prev) => {
          if (skip === null) return page.items;
          const seen = new Set(prev.map((i) => `${i.contentType}/${i.id}`));
          return [...prev, ...page.items.filter((i) => !seen.has(`${i.contentType}/${i.id}`))];
        });
        setNextSkip(row.supportsPagination && page.items.length > 0 ? page.nextSkip : null);
        setError(null);
      } catch (e) {
        if (skip === null) setError(errorText(e));
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeRow) return;
    setItems([]);
    setNextSkip(null);
    setError(null);
    void load(activeRow, null, genre);
  }, [activeRow, genre, load]);

  if (!rows && !error) return <div className="screen-message">Loading catalogs…</div>;

  return (
    <div className="discover-screen" data-testid="discover">
      <header className="discover-head">
        <h1>Discover</h1>
        <div className="discover-controls">
          <div className="discover-types" role="tablist">
            <button className={`chip ${typeFilter === "all" ? "active" : ""}`} onClick={() => setTypeFilter("all")}>All</button>
            {types.map((tp) => (
              <button key={tp} className={`chip ${typeFilter === tp ? "active" : ""}`} onClick={() => setTypeFilter(tp)}>
                {tp === "movie" ? "Movies" : tp === "series" ? "Series" : tp.charAt(0).toUpperCase() + tp.slice(1)}
              </button>
            ))}
          </div>
          {filteredRows.length > 0 && (
            <select
              className="discover-select"
              aria-label="Catalog"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
            >
              {filteredRows.map((r) => (
                <option key={r.key} value={r.key}>
                  {localizeCatalogTitle(r.title)} · {addonLabel(r.addonName)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="discover-genres">
          {GENRES.map((g) => (
            <button key={g} className={`chip ${genre === g ? "active" : ""}`} onClick={() => setGenre(g)}>
              {g}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="row-error">{error}</div>}

      <div className="poster-grid">
        {items.map((item) => (
          <PosterCard key={`${item.contentType}/${item.id}`} item={item} onOpen={onOpen} />
        ))}
        {loading && items.length === 0 && Array.from({ length: 12 }, (_, i) => <div key={i} className="card skeleton" />)}
      </div>

      {!loading && items.length === 0 && !error && (
        <div className="screen-message">No titles matched this filter. Try switching genre to "All" or another catalog.</div>
      )}

      {activeRow && nextSkip !== null && (
        <div className="catalog-grid-more">
          <button className="chip" disabled={loading} onClick={() => void load(activeRow, nextSkip, genre)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
