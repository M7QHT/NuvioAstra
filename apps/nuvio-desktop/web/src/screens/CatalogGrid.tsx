// Full-page catalog grid opened via "See all →" on any Home catalog row.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { PosterCard } from "../components/PosterCard";
import { addonLabel, localizeCatalogTitle, t } from "../i18n";
import type { HomeRow, MetaPreview } from "../types";

interface Props {
  row: HomeRow;
  onOpen(item: MetaPreview): void;
  onBack(): void;
}

export function CatalogGrid({ row, onOpen, onBack }: Props) {
  const [items, setItems] = useState<MetaPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextSkip, setNextSkip] = useState<number | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (skip: number | null) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      try {
        const page = await api.catalogPage(row.key, skip, null);
        setItems((prev) => {
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
    [row],
  );

  useEffect(() => {
    setItems([]);
    setNextSkip(null);
    setError(null);
    void load(null);
  }, [load]);

  return (
    <div className="catalog-grid-screen" data-testid="catalog-grid">
      <header className="catalog-grid-head">
        <button className="back" onClick={onBack} aria-label={t("Voltar")}>←</button>
        <div>
          <h1>{localizeCatalogTitle(row.title)}</h1>
          <div className="muted small">{addonLabel(row.addonName)} · {items.length} titles</div>
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
        <div className="screen-message">No titles found in this catalog.</div>
      )}

      {nextSkip !== null && (
        <div className="catalog-grid-more">
          <button className="chip" disabled={loading} onClick={() => void load(nextSkip)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
