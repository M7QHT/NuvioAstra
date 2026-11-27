// Global UI scale of the active profile (Settings -> Display), applied via CSS zoom on `.shell`.

import { api, onRemoteSettingsChanged } from "./api";

export const UI_SCALE_MIN = 75;
export const UI_SCALE_MAX = 150;
export const UI_SCALE_DEFAULT = 100;

export function clampUiScale(percent: number | undefined | null): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(percent)));
}

export function applyUiScale(scalePercent: number | undefined | null, applyToDetails = true) {
  const clamped = clampUiScale(scalePercent);
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", (clamped / 100).toFixed(2));
  root.classList.toggle("ui-scale-no-details", !applyToDetails);
}

export function loadUiScale() {
  api.settingsGet().then(
    (view) => applyUiScale(view.settings.player.uiScale ?? UI_SCALE_DEFAULT, view.settings.player.uiScaleDetails ?? true),
    () => {},
  );
}

let started = false;
export function startUiScale() {
  if (started) return;
  started = true;
  loadUiScale();
  onRemoteSettingsChanged(loadUiScale);
}
