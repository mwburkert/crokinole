import staticHosting from "@convex-dev/static-hosting/convex.config";
import { defineApp } from "convex/server";

/**
 * Component wiring for this deployment.
 *
 * The only component installed is `@convex-dev/static-hosting`, which serves
 * the built `apps/web/dist` bundle from Convex storage at
 * `https://<deployment>.convex.site`. That is what turns the app from a thing
 * that only works on the owner's wifi into a URL you can send to four people
 * (docs/handoff/01-CONVEX-MIGRATION.md, "Host it").
 *
 * ## Why the component owns "/" and the app owns "/api"
 *
 * `apps/web` routes with `react-router-dom`'s `BrowserRouter`, so `/games`,
 * `/stats` and `/games/:id/play` are *client-side* paths with no file behind
 * them. A plain static server 404s on a refresh or a pasted deep link. The
 * component's SPA fallback serves `index.html` for any extensionless path,
 * which is what makes those URLs survive a hard reload — it is a hard
 * requirement here, not a nicety, and it is the default (`--spa`).
 *
 * Mounting it at "/" means it answers every path on the `.convex.site` origin,
 * so app-owned HTTP routes are moved to "/api" to stay out of its way. There
 * is no `convex/http.ts` today — nothing currently claims an HTTP route — but
 * the prefix is set now so that adding one later lands under `/api` instead of
 * silently colliding with a static asset path.
 *
 * ## This does not touch the auth boundary
 *
 * Hosting the bundle here changes *where the HTML is served from*, nothing
 * else. The security boundary is still the shared passphrase threaded through
 * every function as an argument and checked against `APP_PASSCODE` server-side
 * (`convex/lib/auth.ts`); serving the static files from the same deployment
 * neither weakens nor bypasses it. See `convex/auth.config.ts` for the
 * Cloudflare Access plan that eventually replaces the passphrase.
 */
const app = defineApp({ httpPrefix: "/api" });
app.use(staticHosting, { httpPrefix: "/" });

export default app;
