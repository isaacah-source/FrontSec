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
      includeAssets: ["icons/icon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Relationship Tracker",
        short_name: "Relationships",
        description: "Track external contacts, touchpoints, and how they connect.",
        theme_color: "#1f3a5f",
        background_color: "#f5f6f8",
        display: "standalone",
        start_url: ".",
        // Lets the installed app appear in Android's share menu: text shared from Google Lens
        // (or any app) opens the new-contact form with that text. iPhones do not support
        // this for web apps; there it is copy and paste.
        share_target: {
          action: "contacts/new",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
        scope: ".",
        // Drawn by icon-src/make-icons.mjs. "maskable" is what Android crops into a circle or
        // squircle on the home screen; "monochrome" is for Android's themed icons.
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
        ],
      },
      workbox: {
        // Contact data lives in OneDrive and is always fetched live; the service worker caches
        // the app shell only. config.json is fetched fresh so settings changes apply at once.
        globIgnores: ["config.json", "demo-seed.json"],
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
  test: { environment: "node" },
});
