import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Python backend (app.py) serves the JSON API. In dev, Vite proxies
// /api and /mobile to it so the React app talks to the real scanner.
// The backend defaults to port 8765; override with VITE_API_TARGET if it
// picked a different free port (e.g. 8766).
const API_TARGET = process.env.VITE_API_TARGET || "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/mobile": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    // Emitted assets are bundled into the single exe via the .spec file.
    outDir: "dist",
    emptyOutDir: true,
  },
});
