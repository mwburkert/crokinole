import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** The repo root — where the Convex CLI keeps `.env.local`. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The deployment URL the browser bundle is built against.
 *
 * ⚠️ **This shipped a broken production build once and must not again.**
 * `.env.example` describes `VITE_CONVEX_URL` as the one line "you add by hand",
 * and `.env.local` is gitignored — so on the machine that actually ran
 * `npm run deploy:cf` it was simply absent. Vite inlined nothing, `main.tsx`
 * fell through to its `MissingConfig` screen, and `games.burkert.app` served a
 * polished "Not configured." page to everyone. Nothing failed; the build was
 * green and the app was dead.
 *
 * Two changes, because either alone still leaves a way to ship that:
 *
 * 1. **Derive it.** The Convex CLI writes `CONVEX_URL` (and `CONVEX_DEPLOYMENT`)
 *    itself, every time `convex dev` runs. Those are the same deployment by
 *    definition, so a missing `VITE_CONVEX_URL` is a transcription step, not a
 *    decision — do the transcription here instead of asking a human to.
 * 2. **Fail the production build if there is still nothing.** A bundle with no
 *    backend is not a build worth uploading, and the only thing worse than a
 *    broken deploy is a broken deploy that looks like a working one. The dev
 *    server is deliberately exempt: `MissingConfig` explains itself on screen
 *    and that is the right behaviour for someone who has just cloned the repo.
 */
function resolveConvexUrl(mode: string, isBuild: boolean): string {
  // Every var, not just the VITE_-prefixed ones — CONVEX_URL is the fallback.
  const env = loadEnv(mode, ROOT, "");

  const explicit = (env.VITE_CONVEX_URL ?? "").trim();
  if (explicit) return explicit;

  const fromCli = (env.CONVEX_URL ?? "").trim();
  if (fromCli) return fromCli;

  // `dev:wooden-puffin-241` → `https://wooden-puffin-241.convex.cloud`, which is
  // the mapping the CLI itself uses.
  const deployment = (env.CONVEX_DEPLOYMENT ?? "").trim().split("#")[0]?.trim() ?? "";
  const name = deployment.includes(":") ? deployment.split(":").pop() : deployment;
  if (name) return `https://${name}.convex.cloud`;

  if (isBuild) {
    throw new Error(
      "No Convex deployment URL. Set VITE_CONVEX_URL (or CONVEX_URL, or " +
        "CONVEX_DEPLOYMENT) in the repo-root .env.local before building — " +
        "without one the bundle ships with no backend and every screen shows " +
        '"Not configured."',
    );
  }
  return "";
}

/**
 * A stamp the running app can show, so "I'm looking at it and it's wrong" can be
 * checked rather than believed.
 *
 * This app is a PWA with `registerType: "autoUpdate"`, which means a phone keeps
 * serving the previous build until the service worker swaps and the page is
 * reloaded — and it is deployed to two hosts that can drift apart. Between
 * those two facts, feedback about what is on screen is worthless without
 * knowing which build produced it. Shown in Settings; it costs one line.
 */
function buildStamp(): string {
  let sha = "local";
  try {
    sha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() !== "";
    if (dirty) sha += "+";
  } catch {
    // No git, or not a checkout. The date alone still tells you which build.
  }
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`;
}

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

export default defineConfig(({ mode, command }) => ({
  // The Convex CLI maintains `.env.local` at the repo root, but Vite's project
  // root is `apps/web` — so without this it never sees `VITE_CONVEX_URL` and the
  // app boots with no backend URL at all.
  envDir: ROOT,
  define: {
    /*
     * Both are baked in rather than read from `import.meta.env` at runtime,
     * because `resolveConvexUrl` can produce a value that was never in the
     * environment as `VITE_CONVEX_URL` at all — that derivation is the whole
     * point of it.
     */
    __CONVEX_URL__: JSON.stringify(resolveConvexUrl(mode, command === "build")),
    __BUILD_ID__: JSON.stringify(buildStamp()),
  },
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
}));
