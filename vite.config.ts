import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Set BASE_PATH when hosting under a subpath, e.g. GitHub Pages at /<repo>/.
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "icons/icon-192.png"],
      manifest: {
        name: "Relationship Tracker",
        short_name: "Relationships",
        description: "Track external contacts, touchpoints, and how they connect.",
        theme_color: "#1f3a5f",
        background_color: "#f5f6f8",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Contact data lives in OneDrive and is always fetched live; the service worker caches
        // the app shell only. config.json is fetched fresh so settings changes apply at once.
        // The OCR engine is several MB; fetch it on first scan instead of at install.
        globIgnores: ["tesseract/**", "config.json", "demo-seed.json"],
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
  test: { environment: "node" },
});
