// One Home row. The catalog is requested only when the row comes near the viewport; more pages
// are requested when the user scrolls the row to its end (if the catalog paginates).
// With `limit` (Home): only the first titles are shown, then a "+" card that opens the whole
// catalog (`onSeeAll`) as a grid.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import type { HomeRow, MetaPreview } from "../types";
import { PosterCard } from "./PosterCard";
import { useInView } from "./useInView";
import { addonLabel, localizeCatalogTitle, t } from "../i18n";

interface Props {
  row: HomeRow;
  onOpen(item: MetaPreview): void;
  onLoaded?(row: HomeRow, items: MetaPreview[]): void;
  /** Genre filter (catalogs of a collection folder). */
  genre?: string | null;
  /** Titles shown in the row; the rest is in the catalog screen opened by the "+" card. */
  limit?: number;
  onSeeAll?(row: HomeRow): void;
}

export function CatalogRow({ row, onOpen, onLoaded, genre = null, limit, onSeeAll }: Props) {
  const [ref, inView] = useInView<HTMLElement>();
  const [items, setItems] = useState<MetaPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextSkip, setNextSkip] = useState<number | null>(null);
  const loading = useRef(false);
  const track = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (skip: number | null) => {
      if (loading.current) return;
      loading.current = true;
      try {
        const page = await api.catalogPage(row.key, skip, genre);
        setItems((prev) => {
          const seen = new Set((prev ?? []).map((i) => i.id));
          return [...(prev ?? []), ...page.items.filter((i) => !seen.has(i.id))];
        });
        if (skip === null) onLoaded?.(row, page.items);
        setNextSkip(row.supportsPagination && page.items.length > 0 ? page.nextSkip : null);
      } catch (e) {
        if (skip === null) setError(errorText(e));
      } finally {
        loading.current = false;
      }
    },
    [row, onLoaded, genre],
  );

  useEffect(() => {
    if (inView && items === null && error === null) void load(null);
  }, [inView, items, error, load]);

  const limited = limit !== undefined && !!onSeeAll;
  const onScroll = () => {
    const el = track.current;
    if (el && !limited && nextSkip !== null && el.scrollLeft + el.clientWidth > el.scrollWidth - 600) void load(nextSkip);
  };

  const scrollBy = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: "smooth" });

  // A catalog that answered with nothing is hidden, like the original's empty rows.
  if (items !== null && items.length === 0) return null;
  const shown = items && limited ? items.slice(0, limit) : items;
  const seeAll = limited && items !== null && (items.length > limit! || nextSkip !== null);

  return (
    <section className="row-section" ref={ref} data-content-type={row.contentType}>
      <header className="row-header">
        <h2>{localizeCatalogTitle(row.title)}</h2>
        <span className="muted small">{addonLabel(row.addonName)}</span>
        <span className="spacer" />
        {items && (
          <>
            {onSeeAll && !genre && (
              <button className="see-all-btn" onClick={() => onSeeAll(row)}>See all →</button>
            )}
            <button className="icon-btn" aria-label={t("Anterior")} onClick={() => scrollBy(-1)}>‹</button>
            <button className="icon-btn" aria-label={t("Próximo")} onClick={() => scrollBy(1)}>›</button>
          </>
        )}
      </header>
      {error ? (
        <div className="row-error">
          {t("Não foi possível carregar este catálogo ({error}).", { error })} {" "}
          <button className="link" onClick={() => { setError(null); }}>{t("Tentar novamente")}</button>
        </div>
      ) : (
        <div className="row-track" ref={track} onScroll={onScroll}>
          {shown
            ? shown.map((item) => <PosterCard key={`${item.contentType}/${item.id}`} item={item} onOpen={onOpen} />)
            : Array.from({ length: 8 }, (_, i) => <div key={i} className="card skeleton" />)}
          {seeAll && (
            <div className="card-wrap see-all-wrap">
              <button className="card see-all" onClick={() => onSeeAll!(row)} title={t("Ver todos")} aria-label={t("Ver todos de {title}", { title: localizeCatalogTitle(row.title) })} data-testid="see-all">
                <div className="card-art">
                  <span className="see-all-plus" aria-hidden>+</span>
                </div>
                <div className="card-title">{t("Ver todos")}</div>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
