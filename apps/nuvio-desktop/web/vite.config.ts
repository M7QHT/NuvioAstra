import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built into web/dist, served by Tauri from disk (tauri.conf.json `frontendDist`).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: false },
});
