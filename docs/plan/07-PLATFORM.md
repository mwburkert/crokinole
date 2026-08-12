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
// convex/auth.config.ts — one entry per app, with THAT app's AUD
export default {
  providers: [{
    type: "customJwt",
    issuer: "https://<team>.cloudflareaccess.com",
    jwks:   "https://<team>.cloudflareaccess.com/cdn-cgi/access/certs",
    applicationID: "<this app's AUD tag from the Zero Trust dashboard>",
    algorithm: "RS256",
  }],
};
```

Access tokens carry `sub`, `iss`, `exp`, `aud`, and `email` — precisely what Convex needs. The
`CF_Authorization` cookie is HttpOnly, so you add a tiny Pages Function at `/admin/token` that
echoes `request.headers.get('cf-access-jwt-assertion')`, and feed it to
`convex.setAuth(fetchToken)`.

### ⚠️ Three Access applications, not one — corrected 2026-08-12

The earlier version of this plan called for **one multi-domain Access application** covering all
three subdomains, on the reasoning that a single app issues one cookie across hostnames and so
gives you one login. That works, but it is the **wrong security boundary**, because one
application means **one AUD tag** — and the AUD is exactly what Convex validates. A token minted
for someone allowlisted only on meal-planner would be cryptographically valid at crokinole's
Convex deployment. Per-app allowlists would be a frontend illusion.

**Use three separate Access applications, one per subdomain.** You lose nothing:

- **One login is preserved.** Access issues a **global session token** holding your IdP identity,
  which provides SSO across every application in the organization, plus a **per-application
  token**. Visiting a second app with a valid global token issues the second app's token
  *silently* — no IdP prompt — provided you pass that app's policies. You only re-authenticate
  when the global session itself expires.
- **Separate allowlists come free.** Each application carries its own Allow policy. Back each one
  with a reusable **Access Group** (`Crokinole Players`, `Household`, `Oh Heck`) so adding a
  person is one edit in one place rather than three policies that drift apart.
- **Each AUD becomes a real boundary.** Crokinole's Convex deployment rejects any token that
  wasn't issued for crokinole.

**Result: one login, three independent allowlists, and Convex genuinely enforces which app you
were authorized for.** Every mutation calls `ctx.auth.getUserIdentity()`, which fails unless the
signature, issuer, **and AUD** all check out, then resolves `.email` to a `players` row.

**Don't keep a second copy of the email list in Convex.** One source of truth per purpose: the
**Access Group** decides who gets in, the **`players` row** establishes who someone is, and
**`allowlist.role`** decides what they may do (admin vs player).

> This is why `assertAllowlisted` in §3.2.5 is non-negotiable and why the QA wave has a
> dedicated agent for it (§6.3). **Budget a day for the Convex-side auth work — it is not
> skippable.**

---

## 7.2 Architecture

```
                    burkert.app   (Cloudflare Registrar, $14.20/yr .app)
                                  │   ← CF nameservers REQUIRED
      ┌───────────────────────────┴───────────────────────────┐
      │   Cloudflare free zone · DNS · orange-cloud · SSL Full │
      │   Zero Trust — THREE applications, one per hostname    │
      │   Each: its own Allow policy, backed by an Access Group│
      │   ONE global session token ⇒ silent SSO between them   │
      │   IdP: Email OTP + Google            (free, 50 seats)  │
      └───┬──────────────────────┬───────────────────┬─────────┘
 proxied  │            proxied   │        proxied    │
┌─────────▼────────┐   ┌─────────▼────────┐   ┌──────▼─────────────┐
│ crokinole.…      │   │ ohheck.…         │   │ meals.…            │
│ CF Workers static│   │ CF Workers static│   │ Render Free (Next) │
│  ALL gated       │   │  gated in BETA   │   │  ALL gated         │
│  AUD: crokinole  │   │  Convex Auth ⇒   │   │  AUD: meals        │
│  Group: Players  │   │  no AUD; Access  │   │  Group: Household  │
│                  │   │  is a beta gate  │   │                    │
└────────┬─────────┘   └────────┬─────────┘   │  Access REPLACES   │
         │ /admin/token         │             │  HTTP Basic auth   │
         │ echoes CF JWT        │             │  (real HTTP origin │
         ▼                      ▼             │   ⇒ fully secured) │
════════════════════════════════════════      └──────┬─────────────┘
 wss://*.convex.cloud ◀── BYPASSES CLOUDFLARE        │ ConvexHttpClient
 Convex free team (3 projects)  ◀────────────────────┘  (server-side)
 ⇒ MUST verify the CF Access JWT (customJwt)
   + validate THIS app's AUD inside every mutation
════════════════════════════════════════
```

Note the asymmetry: **Access is a real security boundary for meal-planner** (a normal HTTP
origin, reached server-side) and, for the two Convex apps, a **token issuer** whose AUD claim
Convex then enforces itself. It is never a boundary that protects `*.convex.cloud`.

**Static hosting has no ceiling.** Cloudflare states that *requests to static assets are free and
unlimited* — only Worker **script** invocations are billed. Crokinole and oh-heck are pure static
SPAs, so their hosting is $0 at any scale and can never consume a shared allowance, however
popular they get. That is the reason not to put them on a metered platform.

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

**Access is opt-in per application.** A hostname you don't register is simply *not gated*. All
three hostnames are registered, so all three are gated — crokinole has no public route as of
2026-08-12 (§3.5), and oh-heck's gate comes off when public play ships.

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
| **CF Workers static assets** | **Static requests free and unlimited, no egress charge**; only Worker *script* invocations are billed | ✅ **Chosen** — crokinole + oh-heck |
| **Render Hobby workspace + Free instance** | $0 workspace; 750 instance-hr/mo, 512 MB, **0.1 CPU**, sleeps at 15 min idle, **~60s wake**; ephemeral disk | ✅ **Chosen for now** — meals |
| **Vercel Hobby** | 1M invocations, **4 CPU-hrs Active CPU**, 360 GB-hrs memory, 100 GB transfer; overage = 30-day pause, **no bill** | ⭕ The upgrade path — see below |
| **Fly.io** | No free tier for new orgs; $2.02/mo for shared-cpu-1x 256 MB, near-free when auto-stopped | ❌ **No spend caps or billing alerts at all** |

### ⚠️ Cloudflare Workers cannot host meal-planner — corrected 2026-08-12

The earlier version of this plan recommended moving meals to Workers via
`@opennextjs/cloudflare` to kill the cold start. **That is not possible.**
`anylist/lib/index.js` requires `got`, `reconnecting-websocket`, and `ws` **at module load**,
and Cloudflare's docs are explicit that the `ws` package is incompatible with the Workers
runtime because it uses Node internals. The bundle fails whether or not the WebSocket path is
ever exercised. Meal-planner needs a real Node runtime: Render, Vercel, or Fly.

**On Render's cold start.** For an app opened twice a week, *every* visit is a cold start — ~60s
of blank screen. The less obvious cost is that Free is **0.1 CPU**, so the app is slow even once
warm, and it does protobuf decoding on every AnyList call. Accepted for now in exchange for $0.

**Render Free + Cloudflare has one specific failure mode.** Cloudflare's origin response timeout
is **125 seconds on the Free plan and cannot be raised** below Enterprise. A ~60s wake leaves
roughly 2× headroom, but if a wake ever runs long the user gets a Cloudflare **524 error page**
rather than the app. **A 524 on `meals.burkert.app` is the signal to buy the ~$7/mo Starter
instance**, not a sign anything is broken.

**The upgrade path, in order:** Render Starter (~$7/mo, no migration, always-on, 0.5 CPU) or
Vercel Hobby ($0, no cold start, full serverless CPU, and the 524 risk disappears — costs ~1 hour
to migrate, and Vercel discourages being proxied by Cloudflare, though its stated reasons are
degraded Vercel Analytics, geo-targeting, and Firewall, none of which this app uses).

**Convex free tier:** 1M function calls/mo, 0.5 GB DB, **1 GB egress/mo**, limits are **per team**
with no project cap — all three projects on one free team. Convex emails you as limits approach
and only *sustained* overage degrades anything. **Never sit on the Starter plan**: it bills for
overage, but the configurable spend cap (warning + disable thresholds) is a **Professional**
feature. Go Free → Professional with a limit set on day one.

**Where the real ceiling sits.** At ~130 function calls per game, egress binds first at roughly
**1,500 games/month**; function calls bind at ~7,700. At 5–10 players and ~40 games/month you are
at ~3% of it. Gating the leaderboard (§3.5) removes the only unbounded-audience surface, so usage
can no longer grow without you deliberately adding someone to an Access Group.

---

## 7.6 Cost

| Item | Year 1 | Steady state |
|---|---|---|
| **`burkert.app`** via Cloudflare Registrar | $14.20 | $14.20/yr |
| Cloudflare DNS + free zone | $0 | $0 |
| Zero Trust Access (≤50 seats) | $0 | $0 |
| Workers static hosting ×2 (unlimited static requests) | $0 | $0 |
| Convex (**3 projects**, one free team) | $0 | $0 |
| Render Hobby workspace + Free instance | $0 | $0 |
| **Total** | **$14.20** | **~$1.18/month** |

**Turso is no longer in this plan.** Meal-planner moves from `@libsql/client` to Convex, so all
three apps share one database platform, one dashboard, and one free team. Rationale in §7.8.

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
4. Create **three Access Groups** — `Crokinole Players`, `Oh Heck`, `Household` — then **three
   separate Access applications**, one per hostname, each referencing its own group. Do **not**
   create one multi-domain application: it would give all three apps a single AUD, and the AUD is
   what Convex validates (§7.1). Separate applications still give one login, via the global
   session token.
5. Note each application's **AUD tag** — its Convex deployment needs its own.
6. Wire `auth.config.ts` in each Convex project (§7.1) and the `/admin/token` Pages Function.
7. Set the zone's SSL/TLS mode to **Full (strict)**. It is zone-wide: Workers custom domains are
   indifferent, but Render needs it or you get redirect loops on Flexible.
8. Migrate meal-planner (§7.8).

---

## 7.8 Migration effort for the existing apps

**anylist-meal-planner — easiest, biggest win, ~1–2 hours.** Add `meals.burkert.app` in the
Render dashboard, CNAME **grey-cloud** first → wait for Render's cert → then flip to
**orange-cloud** with SSL mode **Full (strict)**, and **delete all AAAA records** (Render has no
IPv6). Create its Access application. Because it's a real HTTP origin, Access is a genuine
security boundary here — the only one of the three where it is.

> Keep the HTTP Basic auth in place as defence in depth. The `*.onrender.com` hostname stays
> directly reachable no matter what DNS says. See `docs/PLATFORM-HANDOFF.md` in that repo.

### 🚨 Do the database move first — it may be losing data today

`lib/db.ts` falls back to a SQLite file under `data/` when `DATABASE_URL` is unset, and **Render's
filesystem is ephemeral by default** — local writes are lost on every restart or redeploy, and
persistent disks are paid-plans-only. A Free instance waking from spin-down *is* a restart. **If
`DATABASE_URL` is not set in the Render dashboard, every pin, setting, saved plan, and AI-usage
counter is being wiped roughly whenever the app sleeps.** Check this before anything else.

The fix is also the consolidation: rewrite `lib/db.ts` against `ConvexHttpClient`. The seam is
tiny — one 74-line file exposing `kvGet` / `kvList` / `kvSet` over a single
`kv(key TEXT PRIMARY KEY, value TEXT)` table of JSON blobs. That is a document store wearing a
SQL costume, which is precisely Convex's native shape. Next.js keeps running wherever it's
hosted; only that one file changes.

### Keeping meal-planner portable

Staying on Render now and moving to Vercel later is a ~1 hour job **provided nothing couples the
app to a long-lived server**. Three rules:

1. **No filesystem writes.** Vercel's filesystem is read-only outside `/tmp`, which doesn't
   persist. Moving the DB to Convex removes the only current violation.
2. **No cross-request in-memory state.** Render gives one long-lived Node process, so
   module-level caches survive between requests; on Vercel they may not. The existing `_client` /
   `_inited` singletons are fine (they re-init per instance) — but don't add an in-memory rate
   limiter, session store, or cached plan.
3. **No background timers.** A `setInterval` keeps ticking on Render; on Vercel execution ends
   with the response. Use a cron if scheduled work is needed.

`render.yaml` and `scripts/start.js` are simply ignored by Vercel — leave them in place so going
back stays trivial.

**crokinole — ~1 day of Convex work**, covered in Phase 1: deploy the SPA to Workers, add
`/admin/token`, add the `customJwt` block, and put the allowlist check in every mutation.

**oh-heck-chaos-monkey — a decision, not a migration.** Its plan calls for Convex Auth
(anonymous → email upgrade). Either keep that and treat Access as a frontend gate only, or drop
it for the same CF-Access-JWT provider as crokinole and get one unified allowlist. **It depends
on whether guest play matters** — see `09-HANDOFF-OH-HECK.md`.

---

## 7.9 Flagged as unverified

**Render's Starter instance price (~$7/mo) is inferred, not confirmed** — Render's pricing page
wouldn't render for scraping; the figure comes from a Render article quoting ~$13/mo for a
Starter web service plus a Basic-256mb Postgres. Verify on the dashboard before relying on it.
Also unconfirmed: whether Railway's Hobby plan can enforce a hard usage stop.

Hetzner's included traffic allowances; the exact date/scope of Oracle's free-tier reduction;
whether Cloudflare's free-plan Access **application** cap is 50 or 500 (irrelevant at three
apps); Cloudflare publishes no free-plan DNS record cap either way.

Verified 2026-08-12 and no longer in doubt: Render's Free instance spins down at 15 min and wakes
in ~1 min, its filesystem is ephemeral with no disks on Free, Hobby workspace includes 5 GB
bandwidth then $0.15/GB; Cloudflare's Free-plan origin timeout is 125s; Workers static asset
requests are free and unlimited; the `ws` package is incompatible with Workers; Vercel Hobby
pauses for 30 days rather than billing and has 4 CPU-hrs of Active CPU; Fly has no spend caps or
billing alerts; Convex spend limits (warning + disable) are a **Professional** feature.

Also unverified: whether GitHub **Pro** enables *rulesets* (as opposed to classic branch
protection) on personal private repos — see §2.0 Q1.
