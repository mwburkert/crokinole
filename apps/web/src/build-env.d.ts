/**
 * Values baked into the bundle by `apps/web/vite.config.ts` at build time.
 *
 * Not `import.meta.env`, deliberately. `__CONVEX_URL__` is *derived* — from
 * `VITE_CONVEX_URL`, else `CONVEX_URL`, else `CONVEX_DEPLOYMENT` — so it can
 * hold a value that was never in the environment under that name, which is the
 * whole reason it exists. Read the comment on `resolveConvexUrl`: a build with
 * no deployment URL once shipped to production and served a "Not configured."
 * screen to everyone, and nothing anywhere failed.
 */

/** The Convex deployment this bundle talks to. Empty only in `vite dev`. */
declare const __CONVEX_URL__: string;

/**
 * Which build this is: short commit, `+` if the tree was dirty, and the time it
 * was built. Shown in Settings so "I'm looking at it and it's wrong" can be
 * checked against what is actually deployed — this app is a PWA that serves the
 * previous build until the service worker swaps, on two hosts that can drift.
 */
declare const __BUILD_ID__: string;
