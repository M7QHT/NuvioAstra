// Search: one round of requests to the addons' search catalogs per query (typing is debounced
// 450 ms; an outdated answer never replaces a newer one).

import { useEffect, useRef, useState } from "react";
import { api, dataEpoch, errorText, onDataEpoch } from "../api";
import { PosterCard } from "../components/PosterCard";
import type { MetaPreview, SearchSection } from "../types";

interface Props {
  onOpen(item: MetaPreview): void;
}

let lastQuery = "";
let lastSections: SearchSection[] | null = null;
onDataEpoch(() => {
  lastQuery = "";
  lastSections = null;
});

export function Search({ onOpen }: Props) {
  const [query, setQuery] = useState(lastQuery);
  const [sections, setSections] = useState<SearchSection[] | null>(lastSections);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (q === lastQuery.trim() && lastSections) return;
    const id = ++generation.current;
    if (q.length < 2) {
      setSections(null);
      setBusy(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError(null);
      const epoch = dataEpoch();
      api.search(q).then(
        (s) => {
          if (id !== generation.current || epoch !== dataEpoch()) return;
          lastQuery = q;
          lastSections = s;
          setSections(s);
          setBusy(false);
        },
        (e) => {
          if (id !== generation.current) return;
          setError(errorText(e));
          setBusy(false);
        },
      );
    }, 450);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="search">
      <div className="search-bar">
        <input
          ref={input}
          type="search"
          placeholder="Buscar filmes, séries…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar"
          data-testid="search-input"
        />
        {busy && <span className="spinner" aria-label="Buscando" />}
      </div>
      {error && <div className="row-error">Falha na busca: {error}</div>}
      {sections && !sections.length && !busy && <div className="screen-message">Nada encontrado para “{query.trim()}”.</div>}
      {!sections && !busy && <div className="screen-message muted">Digite ao menos 2 letras.</div>}
      {sections?.map((section) => (
        <section key={section.key} className="row-section">
          <header className="row-header">
            <h2>{section.title}</h2>
            <span className="muted small">{section.addonName}</span>
          </header>
          <div className="grid">
            {section.items.map((item) => <PosterCard key={`${item.contentType}/${item.id}`} item={item} onOpen={onOpen} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
