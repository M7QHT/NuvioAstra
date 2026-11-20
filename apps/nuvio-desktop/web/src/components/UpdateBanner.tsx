// Discreet bar at the top when a newer version is published: version, what is new (expandable),
// "Atualizar agora" / "Depois". While updating: download progress, signature check, installer.

import { useEffect, useState } from "react";
import { clearInstallError, dismissUpdate, installUpdate, startAutomaticChecks, useUpdates } from "../updates";

export function megabytes(n: number) {
  return `${(n / 1048576).toFixed(1).replace(".", ",")} MB`;
}

export function UpdateBanner({ automatic }: { automatic: boolean }) {
  const u = useUpdates();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (automatic && u.status?.configured) startAutomaticChecks();
  }, [automatic, u.status?.configured]);

  const a = u.available;
  if (!a || (u.dismissed === a.version && !u.installing)) return null;
  const p = u.installing;
  const pct = p?.total ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : null;

  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <div className="update-main">
        <span className="update-dot" aria-hidden />
        <span>
          <b>Nuvio Astra {a.version}</b> disponível <span className="muted small">(você usa a {a.currentVersion})</span>
        </span>
        {a.notes && !p && (
          <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Ocultar novidades" : "Novidades"}</button>
        )}
        <span className="spacer" />
        {!p && (
          <>
            <button className="primary small-btn" onClick={() => void installUpdate()} data-testid="update-now">Atualizar agora</button>
            <button className="ghost small-btn" onClick={dismissUpdate}>Depois</button>
          </>
        )}
        {p && p.phase === "downloading" && (
          <span className="update-progress">
            Baixando {pct !== null ? `${pct}%` : megabytes(p.downloaded)}
            <span className="update-bar"><span style={{ width: `${pct ?? 30}%` }} /></span>
          </span>
        )}
        {p && p.phase === "verifying" && <span>Verificando a assinatura…</span>}
        {p && p.phase === "installing" && <span>Assinatura válida. Instalando — o Nuvio Astra vai fechar e abrir de novo.</span>}
        {p && p.phase === "error" && (
          <>
            <span className="update-error">{p.error}</span>
            <button className="ghost small-btn" onClick={clearInstallError}>Fechar</button>
          </>
        )}
      </div>
      {open && a.notes && !p && <pre className="update-notes">{a.notes}</pre>}
    </div>
  );
}
