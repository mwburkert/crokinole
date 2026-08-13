import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Drops dev-only files that live in `public/` from the production build.
 *
 * `public/preview.html` is a phone-frame harness for the dev server — nothing
 * imports it and it is not part of the app — so it must not ship to a public
 * production host. Vite copies `public/` into `dist/` wholesale, so it has to
 * be removed explicitly. The dev server is unaffected: it serves straight from
 * `public/`, and this plugin is `apply: "build"`.
 *
 * ⚠️ The hook matters. Vite copies `public/` in `prepareOutDir`, i.e. *before*
 * the bundle is written, and vite-plugin-pwa globs the finished `dist/` in
 * `closeBundle` to build the service worker's precache manifest. `writeBundle`
 * is the only window that is both after that copy and strictly before that
 * glob. Removing the file any later — including via an `.assetsignore` at
 * upload time — leaves `sw.js` precaching `/preview.html`, which then 404s in
 * production and makes the entire service worker fail to install, taking
 * offline mode and update checks down with it (§7.4 / §3.7). Verified: before
 * this plugin, `dist/sw.js` did contain a `preview.html` precache entry.
 */
function excludeDevOnlyPublicAssets(files: readonly string[]): Plugin {
  return {
    name: "crokinole:exclude-dev-only-public-assets",
    apply: "build",
    async writeBundle(options) {
      const outDir = options.dir;
      if (!outDir) return;
      await Promise.all(
        files.map((file) => rm(path.resolve(outDir, file), { force: true })),
      );
    },
  };
}

export default defineConfig({
  // The Convex CLI maintains `.env.local` at the repo root, but Vite's project
  // root is `apps/web` — so without this it never sees `VITE_CONVEX_URL` and the
  // app boots with no backend URL at all.
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [
    react(),
    excludeDevOnlyPublicAssets(["preview.html"]),
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
