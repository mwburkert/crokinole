import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // The Convex CLI maintains `.env.local` at the repo root, but Vite's project
  // root is `apps/web` — so without this it never sees `VITE_CONVEX_URL` and the
  // app boots with no backend URL at all.
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Crokinole",
        short_name: "Crokinole",
        description: "Score a night of crokinole in under a minute a game.",
        theme_color: "#1e4032",
        background_color: "#f5e6c8",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // ⚠️ §7.4 / §3.7: a service worker that intercepts Cloudflare Access's
        // 302 to *.cloudflareaccess.com breaks offline mode and update checks.
        // Keep the edge's auth paths out of the worker entirely — this is
        // miserable to debug later, so it is configured from the start.
        navigateFallbackDenylist: [/^\/cdn-cgi\//, /^\/admin\/token/],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
