# Section 7 — The Shared Platform

One domain, one login, one allowlist, three apps. **~$14.20/year, total.**

All pricing verified Aug 2026. Items that could not be verified are flagged at the end.

---

## 7.1 The finding that shapes everything

**Cloudflare Access does not secure a Convex app.**

The browser opens a WebSocket directly to `wss://<deployment>.convex.cloud` — a Convex-owned
host, on no zone of yours. Cloudflare never sees that traffic. Convex's own docs are explicit
that every `query`/`mutation`/`action` is a public internet endpoint.

So for crokinole and oh-heck, Access gates **only the static frontend**. Anyone who knows your
deployment URL can call your mutations directly.

**But there's a clean fix that turns this into an advantage.** Convex accepts a custom JWT
provider, and Cloudflare Access issues exactly the right kind of token:

```ts
// convex/auth.config.ts
export default {
  providers: [{
    type: "customJwt",
    issuer: "https://<team>.cloudflareaccess.com",
    jwks:   "https://<team>.cloudflareaccess.com/cdn-cgi/access/certs",
    applicationID: "<AUD tag from the Zero Trust dashboard>",
    algorithm: "RS256",
  }],
};
```

Access tokens carry `sub`, `iss`, `exp`, `aud`, and `email` — precisely what Convex needs. The
`CF_Authorization` cookie is HttpOnly, so you add a tiny Pages Function at a **protected** path
(`/admin/token`) that echoes `request.headers.get('cf-access-jwt-assertion')`, and feed it to
`convex.setAuth(fetchToken)`.

**Result: one Access application spanning all three subdomains ⇒ one login, one allowlist, and
Convex genuinely enforces it.** Every mutation calls `ctx.auth.getUserIdentity()` and checks
`.email` against the allowlist; public leaderboard queries skip the check.

> This is why `assertAllowlisted` in §3.2.5 is non-negotiable and why the QA wave has a
> dedicated agent for it (§6.3). **Budget a day for the Convex-side auth work — it is not
> skippable.**

---

## 7.2 Architecture

```
                    burkert.app   (Cloudflare Registrar, $14.20/yr .app)
                                  │   ← CF nameservers REQUIRED
      ┌───────────────────────────┴───────────────────────────┐
      │      Cloudflare free zone · DNS · orange-cloud proxy   │
      │      Zero Trust Access — ONE multi-domain application  │
      │      Policy: Allow · Emails ∈ {your 8 addresses}       │
      │      IdP: Email OTP + Google         (free, 50 seats)  │
      └───┬──────────────────────┬───────────────────┬─────────┘
 proxied  │            proxied   │        proxied    │
┌─────────▼────────┐   ┌─────────▼────────┐   ┌──────▼─────────────┐
│ crokinole.…      │   │ ohheck.…         │   │ meals.…            │
│ CF Workers static│   │ CF Workers static│   │ Render free (Next) │
│  /       PUBLIC  │   │  ALL gated       │   │  ALL gated         │
│  /admin/*  GATED │   │                  │   │  Access REPLACES   │
└────────┬─────────┘   └────────┬─────────┘   │  HTTP Basic auth   │
         │ /admin/token         │             │  (real HTTP origin │
         │ echoes CF JWT        │             │   ⇒ fully secured) │
         ▼                      ▼             └──────┬─────────────┘
════════════════════════════════════════             ▼
 wss://*.convex.cloud ◀── BYPASSES CLOUDFLARE     Turso / libsql
 Convex free team (2 projects)
 ⇒ MUST verify the CF Access JWT (customJwt)
   + email allowlist check inside every mutation
════════════════════════════════════════
```

Note the asymmetry: **Access is a real security boundary for meal-planner** (a normal HTTP
origin) and **a convenience layer for the two Convex apps**.

---

## 7.3 Key decisions and their reasons

**Subdomains, not paths.** Paths would need a Worker fanning out to three origins, break each
host's cert flow, force SPA base-path rewrites, and depend on path-based Access, which is
unreliable (below). Keep subdomains **one level deep** — Universal SSL covers
`crokinole.burkert.app` but not `admin.crokinole.burkert.app`.

**Buy the domain at Cloudflare Registrar.** At-cost, no markup, free WHOIS redaction and
DNSSEC, and it now registers new domains rather than only accepting transfers.

| TLD | Cloudflare (register / renew) | Porkbun | Namecheap |
|---|---|---|---|
| `.com` | **$10.46 / $10.46** | $11.08 / $11.08 | $11.28 → $14.98 |
| `.app` | **$14.20 / $14.20** | $8.75 → $14.93 | $10.98 → $17.98 |
| `.dev` | **$12.20 / $12.20** | $8.75 → $12.87 | $10.98 → $15.98 |

Cloudflare wins on renewal for all three. Cheap first-year offers elsewhere lose by year two.

**⚠️ You must move DNS to Cloudflare nameservers.** Partial/CNAME setup is Business-plan-only,
and the orange cloud is what enforces Access. Cloudflare Registrar requires their nameservers
anyway, so this is consistent — but you cannot keep DNS elsewhere.

**Zero Trust free tier: 50 seats, permanent** (not a trial), $7/user/mo beyond. A seat is
consumed by an authentication event and held until manually removed. Your 4–8 people are far
inside it. Email OTP needs zero configuration; Google OAuth is also free.

**Access is opt-in per application.** A hostname you don't register is simply *not gated* —
which is exactly how the public leaderboard stays public.

---

## 7.4 Two caveats that bite this specific app

**⚠️ SPA client-routing defeats path policies.** Path-based Access rules fire only on real HTTP
requests. A Vite SPA navigating from `/` to `/admin` makes **no request**, so Access never runs.

**Path policies are UX, never security.** This is fine — Convex enforces the real boundary
(§7.1) — but do not design as though the path gate protects anything.

**⚠️ Service workers conflict with Access.** A PWA service worker that intercepts the 302
redirect to `*.cloudflareaccess.com` breaks offline mode and update checks. Exclude
`/cdn-cgi/*` and auth navigations from service-worker caching. Since crokinole is a PWA
(§3.7), **do this from the start** rather than debugging it later.

---

## 7.5 Hosting

| | Free tier | Verdict |
|---|---|---|
| **CF Workers static assets** | Static requests unlimited, **no egress charge**; 100k dynamic req/day; 3,000 build-min/mo | ✅ Both Vite PWAs |
| **Vercel Hobby** | 100 GB transfer, 1M invocations; overage = hard pause, no bill | ✅ Easiest Next.js; ⚠️ non-commercial only |
| **Render free** | 750 instance-hr/mo, 512 MB, **sleeps at 15 min idle, ~60s wake** | ⚠️ See below |
| **Netlify free** | 100 GB bandwidth, 300 build-min | ⚠️ Next.js 16 support unverified |

**On Render's cold start:** for an app someone opens twice a week, *every* visit is a cold
start — ~60 seconds of staring at a blank page. That's the single worst thing about the
current meal-planner setup. Moving it to Workers via `@opennextjs/cloudflare` eliminates it
(the 3 MiB gzip bundle cap is the risk to check). Not urgent, but worth knowing.

**Convex free tier:** 1M function calls/mo, 0.5 GB DB, **1 GB egress/mo**, 40 deployments,
limits are **per team** with no project cap. Crokinole + oh-heck as two projects on one free
team is fine. **Egress is the likeliest limit to breach** — a chatty realtime PWA is exactly
the profile that does it. Overage is cheap ($0.132/GB), but watch it.

---

## 7.6 Cost

| Item | Year 1 | Steady state |
|---|---|---|
| **`burkert.app`** via Cloudflare Registrar | $14.20 | $14.20/yr |
| Cloudflare DNS + free zone | $0 | $0 |
| Zero Trust Access (≤50 seats) | $0 | $0 |
| Workers static hosting ×2 | $0 | $0 |
| Convex (2 projects, one free team) | $0 | $0 |
| Render free + Turso free | $0 | $0 |
| **Total** | **$14.20** | **~$1.18/month** |

**Versus a VPS:** Hetzner CX23 €5.49 + €0.50 IPv4 ≈ **$78/yr**; DigitalOcean 2 GB = **$144/yr**.
So **8–15× the cost**, plus you now own OS patching, TLS renewal, Docker, backups, and
self-hosting Convex. Note the landscape shifted recently: Hetzner raised prices in June 2026
(CX22 no longer exists), Fly.io's free tier is gone for new customers, and Oracle Always Free
was halved with documented reclamation of idle instances — don't build on it.

**The managed setup is the clear winner** for three low-traffic personal apps. Revisit only if
you outgrow Convex's free tier or want something a free tier genuinely can't do.

---

## 7.7 Implementation order

Do this **before or in parallel with** crokinole Phase 1 — it's ~2 hours and it unblocks the
auth design for all three apps.

0. ✅ **Name chosen: `burkert.app`.** Subdomains are `crokinole.burkert.app`,
   `meals.burkert.app`, `ohheck.burkert.app` — all one level deep, so Universal SSL covers them.
1. Register it at **Cloudflare Registrar** ($14.20/yr `.app`, at cost, **no renewal markup** —
   the same price every year, where Namecheap goes $10.98 → $17.98). Nameservers are set
   automatically, which Access requires. **Check availability at purchase** — this plan assumes
   it's still free to register.
   > ⚠️ `.app` is **HSTS-preloaded at the TLD level**: HTTPS is mandatory and browsers refuse
   > plain HTTP. Fine here, since everything is HTTPS anyway — but it means there's no
   > `http://` fallback if a cert ever lapses.
2. Create the Zero Trust team (`<team>.cloudflareaccess.com`). Note the team name.
3. Add Email OTP as an IdP. Add Google if you want fewer emails.
4. Create **one multi-domain Access application** covering `crokinole.burkert.app/admin/*`,
   `ohheck.burkert.app`, `meals.burkert.app`. Multi-domain apps issue one JWT cookie across
   hostnames — this is what gives you a single login.
5. Add one Allow policy listing the emails. Note the **AUD tag** — Convex needs it.
6. Wire `auth.config.ts` in Convex (§7.1) and the `/admin/token` Pages Function.
7. Migrate meal-planner (§7.8).

---

## 7.8 Migration effort for the existing apps

**anylist-meal-planner — easiest, biggest win, ~1–2 hours.** Add `meals.burkert.app` in the
Render dashboard, CNAME **grey-cloud** first → wait for Render's cert → then flip to
**orange-cloud** with SSL mode **Full**, and **delete all AAAA records** (Render has no IPv6).
Create the Access app. Because it's a real HTTP origin, Access is a genuine security boundary
here — the only one of the three where it is.

> Keep the HTTP Basic auth in place as defence in depth. The `*.onrender.com` hostname stays
> directly reachable no matter what DNS says. See `08-HANDOFF-MEAL-PLANNER.md`.

**crokinole — ~1 day of Convex work**, covered in Phase 1: deploy the SPA to Workers, add
`/admin/token`, add the `customJwt` block, and put the allowlist check in every mutation.

**oh-heck-chaos-monkey — a decision, not a migration.** Its plan calls for Convex Auth
(anonymous → email upgrade). Either keep that and treat Access as a frontend gate only, or drop
it for the same CF-Access-JWT provider as crokinole and get one unified allowlist. **It depends
on whether guest play matters** — see `09-HANDOFF-OH-HECK.md`.

---

## 7.9 Flagged as unverified

Netlify's Next.js 16 support; Render's current Starter price; Hetzner's included traffic
allowances; the exact date/scope of Oracle's free-tier reduction; whether Cloudflare's
free-plan Access **application** cap is 50 or 500 (irrelevant at three apps); Cloudflare
publishes no free-plan DNS record cap either way.

Also unverified: whether GitHub **Pro** enables *rulesets* (as opposed to classic branch
protection) on personal private repos — see §2.0 Q1.
