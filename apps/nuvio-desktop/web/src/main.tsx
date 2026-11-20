import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { App } from "./App";
import { PlayerProvider } from "./player/PlayerContext";
import { SelftestView } from "./player/SelftestView";
import { runUiTest } from "./uitest/driver";
import "./styles.css";

// The automated player tests get only the video overlay: no catalogs are loaded, so their
// measurements are not mixed with addon traffic.
function Root() {
  const [mode, setMode] = useState<"app" | "selftest" | "uitest" | null>(null);
  useEffect(() => {
    api.appMode().then(setMode, () => setMode("app"));
  }, []);
  useEffect(() => {
    if (mode === "uitest") void runUiTest();
  }, [mode]);
  if (mode === null) return null;
  if (mode === "selftest") return <SelftestView />;
  return (
    <PlayerProvider>
      <App />
    </PlayerProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
