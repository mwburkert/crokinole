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

Access tokens carry `sub`, `iss`, `exp`, `aud`, and `email` — precisely what Convex needs.

> **⚠️ Corrected 2026-08-12 (second pass).** This paragraph used to say "add a tiny **Pages
> Function** at `/admin/token`". **Pages Functions do not exist on a Workers-static-assets
> deployment** — they are a Cloudflare *Pages* construct. Since §7.5 puts crokinole on Workers
> static assets, the token echo must be a **Worker `fetch` handler** with its path listed in
> `run_worker_first`. Corrected config in §7.5a. Cloudflare's current position, verbatim:
> *"start with Workers… going forward, all of our investment, optimizations, and feature work
> will be dedicated to improving Workers."* Do not start a new project on Pages.

The `CF_Authorization` cookie is HttpOnly, so the endpoint echoes the `Cf-Access-Jwt-Assertion`
**request header** instead — Cloudflare's docs prefer the header because the cookie *"is not
guaranteed to be passed."* Feed the result to `convex.setAuth(fetchToken)`, or better to
`ConvexProviderWithAuth` (§7.1a).

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

> ✅ **Re-verified 2026-08-12 (second pass) against primary sources — this correction holds, and
> now rests on documentation rather than inference.** Cloudflare states that *"Cloudflare Access
> assigns a unique AUD tag to each application"*, that the AUD *"will never change unless you
> delete or recreate the Access application"*, and — decisively — that within a multi-hostname
> application *"an OAuth token obtained through any one domain is valid for all domains in the
> same application"*. One application is one security boundary. Three applications are three.
> ([validating-json](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
> [managed-oauth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/))
>
> ⚠️ Related new setting: **"Eager redirect cookie", default ON since 2026-08-03.** If the three
> hostnames were ever consolidated into one application, Access would walk the browser through
> every hostname at login setting `CF_Authorization` on each — which Cloudflare warns can cause
> sign-in loops. One more reason to keep three applications.

### 7.1a Convex-side details — added 2026-08-12 (second pass)

The `auth.config.ts` snippet above was **checked field by field against Convex's current
`customJwt` documentation and is correct as written.** `type`, `issuer`, `jwks`, `applicationID`
and `algorithm` all exist with those exact names; `applicationID` is matched against the `aud`
claim; RS256 is supported (RS256 and ES256 are the only two). Cloudflare's issuer string has no
trailing slash and Convex requires an exact `iss` match, so copy it verbatim.

Two corrections to how it is *used*:

1. **⚠️ `identity.email` is not guaranteed to be present.** Convex's `UserIdentity` promises only
   `tokenIdentifier`, `subject` and `issuer`; every OIDC field including `email` is optional and
   provider-dependent, and the `customJwt` docs never promise `email` is mapped. Cloudflare
   Access does put `email` at the top level of its token, so this very probably works — but
   `assertAllowlisted` resolves the caller *entirely* by email and throws *"Access token carries
   no email claim"* if it is absent, which would lock out everybody at once. **Verify
   empirically the first time a real Access token reaches the backend.** Fallback if absent: key
   on `identity.subject`.
2. **Honour `forceRefreshToken`.** The documented React shape is
   `<ConvexProviderWithAuth client={convex} useAuth={...}>`, where the hook returns
   `{ isLoading, isAuthenticated, fetchAccessToken }` and `fetchAccessToken` receives
   `{ forceRefreshToken }` — set when the server rejected the previous token. If the echo
   endpoint's response is cached and the flag ignored, a rejected token loops on a stale value
   instead of refreshing. Access sessions default to 24h, so this fires in normal use.

Also: Cloudflare Access **service-token** JWTs carry an empty `sub`, and Convex requires a
non-empty `sub`. Any machine-to-machine path will likely be rejected outright — design around it.

> This is why `assertAllowlisted` in §3.2.5 is non-negotiable and why the QA wave has a
> dedicated agent for it (§6.3, brief at `docs/qa/WAVE-3-H-AUTH-SECURITY.md`). **Budget a day
> for the Convex-side auth work — it is not skippable.**

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
| `.app` | **$14.20 / $14.20** | $8.75 → $14.93 | $10.98 → **$22.98** |
| `.dev` | **$12.20 / $12.20** | $8.75 → $12.87 | $10.98 → $15.98 |

Cloudflare wins on renewal for all three. Cheap first-year offers elsewhere lose by year two.

> **Corrected 2026-08-12 (second pass): Namecheap's `.app` renewal is $22.98, not $17.98.**
> $17.98 is Namecheap's undiscounted *registration* price; the renewal row on their own page and
> their embedded pricing JSON both say $22.98. Cloudflare's at-cost advantage at renewal is
> therefore **$8.78/yr, not $3.78/yr**.
>
> All three Cloudflare figures were re-checked against Cloudflare's live registrar search on
> 2026-08-12 and are exact, including "Renews at $14.20". **Method caveat worth recording:**
> Cloudflare publishes no static per-TLD price list on any public page — `/tlds` and
> `/tld-policies` name TLDs and registry operators but carry no prices. The only primary source
> is the live search UI. A parallel research strand concluded the Cloudflare `.app` price was
> "unverifiable from any public page" and anchored to Porkbun instead; that strand simply did
> not query the search UI. **The $14.20 figure stands.**

**⚠️ You must move DNS to Cloudflare nameservers.** Partial/CNAME setup is Business-plan-only,
and the orange cloud is what enforces Access. Cloudflare Registrar requires their nameservers
anyway, so this is consistent — but you cannot keep DNS elsewhere.

**Zero Trust free tier: 50 seats, permanent** (not a trial), **$7/user/mo *paid annually***
beyond. A seat is consumed by an authentication event and held until removed. Your 4–8 people
are far inside it.

> **⚠️ Corrected 2026-08-12 (second pass) — three fixes to this paragraph.**
>
> 1. **Email OTP no longer needs zero configuration.** Cloudflare changed the default on
>    **2026-06-18**: *"When you create a new Zero Trust organization, Cloudflare now adds the
>    Cloudflare identity provider as your default login method. Previously, new organizations
>    started with one-time PIN (OTP)."* OTP *"is no longer added automatically, but you can set
>    it up at any time"* (Integrations → Identity providers → Add new → One-time PIN). So §7.7
>    step 3 is a real step, not a no-op — **or** drop it and use the Cloudflare IdP, where
>    people sign in with an existing Cloudflare account and there are no OTP emails at all.
>    Google works as an IdP without a Google Workspace account.
> 2. **The failure mode at 50 seats is a lockout, not a bill.** *"Once the total amount of seats
>    in the subscription has been consumed, additional users who attempt to log in are
>    blocked."* Irrelevant at 4–8 people, but it is the shape of the risk. Seats can be released
>    automatically via the opt-in **user-expiration** setting (one month to one year, checked
>    daily) rather than by manual removal.
> 3. **Payment details are required at onboarding even for Free** — *"you will not be
>    charged"*, but the card goes in. Worth knowing before starting the wizard.
>
> Note on sourcing: the 50-seat cap and the $7 price appear on Cloudflare's **product pricing
> page**, not in developers.cloudflare.com. The $7 is quoted paid annually; do not assert it as
> a month-to-month price.

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

> **⚠️ Downgraded 2026-08-12 (second pass): this is sound engineering, but it is *not*
> Cloudflare guidance.** No Cloudflare page mentions service workers in connection with Access,
> and the Access troubleshooting page has no `/cdn-cgi/*` or SW-caching advice. Keep the
> mitigation — it costs nothing — but stop citing it as documented.
>
> **The hazard Cloudflare *does* document is a much closer fit to this architecture, and the
> plan missed it:** *"If you have a Cloudflare Worker route assigned to your application's login
> path, the Worker may overwrite the `cf-authorization` cookie."* Crokinole is served **by a
> Worker on its own hostname** (§7.5), so this applies directly. The `/admin/token` Worker in
> §7.5a must not strip or rewrite `Set-Cookie`. Other documented redirect-loop causes worth
> knowing: `SameSite=Strict` cookies, and Zaraz / Google tag gateway on the app domain when
> Binding Cookie is enabled.
> ([troubleshooting](https://developers.cloudflare.com/cloudflare-one/access-controls/troubleshooting/))
>
> Note also that the SPA path-policy claim above is an extrapolation. What Cloudflare documents
> is the **fragment** case — *"requests to `dashboard.com/#settings` will redirect to
> `dashboard.com`"*, because *"anchor links are processed by the browser and not the server"*.
> pushState routing is the same mechanism but is not documented. The conclusion is unchanged and
> the plan already acts on it correctly: enforce in Convex, never in a path policy.

---

## 7.5 Hosting

| | Free tier | Verdict |
|---|---|---|
| **CF Workers static assets** | **Static requests free and unlimited, no egress charge**; only Worker *script* invocations are billed (Free: 100k/day, 10ms CPU) | ✅ **Chosen** — crokinole + oh-heck |
| **Render Hobby workspace + Free instance** | $0 workspace; 750 instance-hr/mo **per workspace**, 512 MB, **0.1 CPU**, sleeps at 15 min idle, **~60s wake**; ephemeral disk; **no outbound SMTP** | ✅ **Chosen for now** — meals |
| **Vercel Hobby** | 1M invocations, **4 CPU-hrs Active CPU**, 360 GB-hrs memory, 100 GB transfer; overage = 30-day pause, **no bill** | ⭕ The upgrade path — see below |
| **Fly.io** | No free tier for new orgs; $2.02/mo for shared-cpu-1x 256 MB, near-free when auto-stopped | ❌ **No spend caps or billing alerts at all** |

### 7.5a The `/admin/token` endpoint on Workers — added 2026-08-12 (second pass)

The plan said "a tiny Pages Function". That construct does not exist here (§7.1). The correct
shape is a Worker `fetch` handler with the path in `run_worker_first`:

```jsonc
// wrangler.jsonc
{
  "name": "crokinole",
  "compatibility_date": "2026-08-12",
  "main": "./worker/index.ts",
  "assets": {
    "directory": "./dist/",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/admin/token"]
  },
  "routes": [{ "pattern": "crokinole.burkert.app", "custom_domain": true }],
  "workers_dev": false
}
```

```ts
// worker/index.ts
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/admin/token") {
      const jwt = request.headers.get("cf-access-jwt-assertion");
      if (!jwt) return new Response("No Access JWT", { status: 401 });
      return new Response(jwt, { headers: { "content-type": "text/plain" } });
    }
    return env.ASSETS.fetch(request);
  },
};
```

**Four things here are load-bearing, and three of them are traps:**

1. **`"workers_dev": false`.** Without it the Worker stays reachable at its `*.workers.dev`
   URL, where **no Access application applies** — the gate is bypassed by anyone who finds that
   hostname. This is the single most important line in the config.
2. **`run_worker_first` must be an array, not `true`.** With `true`, *every* request becomes a
   billable Worker invocation, and on the Free plan requests past 100k/day get a **429 instead
   of falling back to serving the static asset**. Scoped to one path, only `/admin/token`
   carries that risk.
3. **⚠️ Without `run_worker_first`, `/admin/token` silently returns `index.html`.** With
   `not_found_handling: "single-page-application"` and any compatibility date ≥ 2025-04-01,
   Cloudflare enables `assets_navigation_prefers_asset_serving`: navigation requests (anything
   with `Sec-Fetch-Mode: navigate`, i.e. typing the URL into the address bar) **do not invoke
   the Worker**. Cloudflare documents exactly this confusion. A `fetch()` from the SPA would
   work while opening the URL in a tab would not.
4. **Do not strip or rewrite `Set-Cookie` in this Worker** — see §7.4's documented hazard about
   a Worker route on the login path overwriting `cf-authorization`.

**Security note.** Echoing the raw header is only meaningful because the hostname is behind an
Access application — a client can send any header it likes, so on an ungated host this endpoint
would happily echo an attacker's own string. That is harmless here (Convex validates the token's
signature itself), but do not reuse this pattern anywhere the echo is trusted. Access rotates
its signing key every 6 weeks with a 7-day overlap, so anything that verifies must use the
remote JWKS rather than a pinned key.

**Also corrected: SSL mode is not strictly zone-wide.** §7.3 implies you cannot vary it per
hostname on the free plan. You can — **Configuration Rules are available on Free** (10 rules)
and can override the encryption mode for specific hostnames. Zone-wide Full (strict) is still
the right default here; this just means meal-planner's cutover has an escape hatch that does not
require touching the other two apps.

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
is **125 seconds** — corrected 2026-08-12: this is 125s **on every plan**, not a Free-plan
limitation, and is configurable only for Enterprise zones. Upgrading to Pro or Business would
not help. A ~60s wake leaves roughly 2× headroom, but if a wake ever runs long the user gets a
Cloudflare **524 error page** rather than the app. **A 524 on `meals.burkert.app` is the signal
to buy the $7/mo Starter instance**, not a sign anything is broken.

**The upgrade path, in order:** Render Starter (**$7/mo confirmed** 2026-08-12 — no migration,
always-on, 0.5 CPU, but note it is **still 512 MB RAM, identical to Free**; you are buying
always-on and CPU, not memory) or
Vercel Hobby ($0, no cold start, full serverless CPU, and the 524 risk disappears — costs ~1 hour
to migrate, and Vercel discourages being proxied by Cloudflare, though its stated reasons are
degraded Vercel Analytics, geo-targeting, and Firewall, none of which this app uses).

**Convex free tier:** 1M function calls/mo, 0.5 GB DB, **1 GB egress/mo**, limits are **per team**
with no project cap — all three projects on one free team. **Never sit on the Starter plan**: it
bills for overage, but the configurable spend cap (warning + disable thresholds) is a
**Professional** feature. Go Free → Professional with a limit set on day one.

> **Corrected and extended 2026-08-12 (second pass) — four points.**
>
> 1. **"Only *sustained* overage degrades anything" is too soft.** That is right for function
>    calls (*"if you exceed the resource limit for an extended period of time, your deployment
>    may return HTTP errors"*), but **storage bites immediately**: past 0.5 GB, *"new mutations
>    that attempt to commit more insertions or updates may fail."* No grace period.
> 2. **🚨 The spend cap's blast radius is the whole team, and the plan puts all three apps on
>    one team.** The disable threshold **disables every project in the team**, not the offending
>    one. A runaway crokinole deployment would take meal-planner down with it. That is a
>    shared-fate risk the plan never mentioned. It is probably still the right trade at this
>    scale, but it should be a *decision*, not a surprise — the alternative is separate teams,
>    which costs the single dashboard.
> 3. **"No project cap" is true but unsourced.** Convex publishes no projects-per-team number.
>    The documented ceiling is **40 deployments** per Free/Starter team, and each project burns
>    a prod deployment plus one dev deployment *per developer*. Cite deployments, not projects.
>    Three apps is nowhere near it.
> 4. **Convex Static Hosting exists — and cannot replace Cloudflare Workers here.** The
>    migration handoff asks whether Convex can host the SPA and avoid a new account. It can:
>    `@convex-dev/static-hosting` serves a Vite build with SPA fallback, and HTTP actions can
>    read raw request headers (so `/admin/token` would work). **But custom domains require the
>    Professional plan.** On Free you get `*.convex.site` only — a hostname on a domain the
>    owner does not control, which therefore **cannot be put behind Cloudflare Access**. Since
>    the entire auth design depends on Access fronting the origin, this is a dead end at $0.
>    **Answer to the handoff's open question: no. Stay on Workers.**

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
| Resend (invitation email), free tier | $0 | $0 |
| **Total** | **$14.20** | **~$1.18/month** |

**Re-verified 2026-08-12 (second pass): the total is unchanged.** Every $0 line was
re-confirmed against a live pricing page. Two additions:

- **Resend's free tier is 100 emails/day, 3,000/month, one domain** — vastly more than an
  occasional invite needs. But it **requires a verified sending domain**: the no-domain test
  path (`onboarding@resend.dev`) *"can only send testing emails to your own email address"* and
  403s anything else, so it is useless for actually inviting anyone. This is why invitations
  wait on `burkert.app` — which now exists.
- **Render Free cannot send outbound SMTP** (ports 25/465/587 are blocked). Resend's HTTPS API
  is unaffected; Resend-over-SMTP would not work. Only relevant to meal-planner.

**⚠️ The $0 is now conditional in one place the plan did not anticipate.** meal-planner's
`render.yaml` on its live branch adds a second service, `type: cron`, `plan: starter` — a paid
plan — for its new weekly email automation. See §7.8 and the escalation list in
`docs/plan/08-SEQUENCING.md`.

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
1. ✅ **DONE — `burkert.app` was registered on 2026-08-12 at 06:16 UTC.** Verified against
   Google Registry's authoritative RDAP: registrar **CloudFlare, Inc.**, nameservers
   `clarissa.ns.cloudflare.com` / `donovan.ns.cloudflare.com`, status `add period` +
   `clientTransferProhibited`. Cloudflare's search agrees it is taken. So the zone exists and
   is on Cloudflare nameservers already; **start from step 2.**
   > ⚠️ If the owner did *not* register it this morning, someone else took the name hours
   > before this was written — confirm before building on it.
   > The domain is inside the 5-day ICANN add-grace period and carries the standard 60-day
   > post-registration transfer lock. Nothing to act on; it just cannot move for 60 days.
   > ⚠️ `.app` is **HSTS-preloaded at the TLD level** (confirmed against hstspreload.org):
   > HTTPS is mandatory and browsers refuse plain HTTP. Fine here — but there is no `http://`
   > fallback if a cert ever lapses.
   > ⚠️ Cloudflare Registrar domains **must** use Cloudflare nameservers, and partial/CNAME
   > setup is Business-plan-only. These compound: partial setup is unavailable here at any
   > price. Every hostname must be **one level deep** (`crokinole.burkert.app`), because
   > Universal SSL covers the root and first-level subdomains only, and the usual workaround
   > (partial setup, which certs per-hostname at any depth) is off the table.
2. Create the Zero Trust team (`<team>.cloudflareaccess.com`). Note the team name.
   Payment details are required at onboarding even on Free; you will not be charged.
3. **Add an IdP — this is now a real step, not a formality.** Since 2026-06-18 new Zero Trust
   organizations default to the **Cloudflare identity provider** (sign in with an existing
   Cloudflare account) and **one-time PIN is no longer added automatically**. Either accept the
   Cloudflare IdP, or explicitly add One-time PIN under Integrations → Identity providers.
   Google works without a Google Workspace account.
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

---

## 7.10 Invitations — researched 2026-08-12 (second pass)

Both routes were verified. Both are unblocked now that `burkert.app` exists.

**Route A — write the Access Group's member list from a Convex action.**
`PUT /accounts/{account_id}/access/groups/{group_id}` is the current endpoint and method.
⚠️ **`include` is required on every PUT**, so this is a whole-object write: any "add an invitee"
flow must GET the group, append, and PUT the full list. **Two concurrent invites will clobber
each other** unless serialised — a real hazard when the natural UI is "everyone adds their
friends". Cloudflare does not state merge-vs-replace explicitly, so treat the read-modify-write
requirement as reasoned from the required field rather than documented.
The API token needs the **account-scoped** permission *Access: Organizations, Identity
Providers, and Groups — Edit* (or the narrower *Access: Groups Edit*). **It cannot be
zone-scoped** — a zone token will fail.

**Route B — External Evaluation**, where Access calls your endpoint and defers the decision
entirely, making Convex the single source of truth and collapsing today's two-list situation
into one. The contract is confirmed: you configure an **Evaluate URL** and a **Keys URL**;
Access signs its request with your account key and sends the full identity payload; your API
returns a signed JWT `{"success": true, "iat": …, "exp": …, "nonce": …}`; Access verifies the
signature against your Keys URL, checks `exp`, checks `success`, and checks the `nonce` is
unchanged.

⚠️ **Route B is the more elegant design and the riskier bet.** Cloudflare publishes no
plan-availability statement for External Evaluation, so whether it works on a Free Zero Trust
plan is **unverified**. Check it in the dashboard before designing around it. Route A works on
Free for certain.

**Emailing the invite** needs Resend plus a verified sending domain (§7.6) — now unblocked.

**oh-heck-chaos-monkey — a decision, not a migration.** Its plan calls for Convex Auth
(anonymous → email upgrade). Either keep that and treat Access as a frontend gate only, or drop
it for the same CF-Access-JWT provider as crokinole and get one unified allowlist. **It depends
on whether guest play matters** — see `09-HANDOFF-OH-HECK.md`.

---

## 7.9 Verification status — rewritten 2026-08-12 (second pass)

### Resolved since the last pass

- **Render Starter is $7/mo — confirmed**, from Render's own embedded pricing table:
  `Starter $7/month 512 MB 0.5`. The previous "~$7, inferred from a blog post" flag is closed.
  Note the specs: **same 512 MB as Free**, 0.5 CPU. (The pricing page still defeats ordinary
  fetching; the numbers are in the raw HTML.)
- **Railway's Hobby plan *can* enforce a hard stop** — usage limits are available on all plans
  and *"all your workloads will be taken offline"* at the hard limit. Flag closed.
- **Access application cap is 500**, not plan-differentiated. Also 500 reusable policies, 300
  rule groups, 50 IdPs. Irrelevant at three apps, as expected.
- **Oracle Always Free** now documents 2 OCPU / 12 GB Arm (consistent with "halved") and
  explicit reclamation of instances under 20% utilisation across a 7-day window. Don't build
  on it — unchanged conclusion, now sourced.
- **Hetzner**: the 15 June 2026 price adjustment is confirmed, CX23 is €5.49 + €0.50 IPv4, and
  **CX22 no longer appears** in the type list. CX23's vCPU/RAM specs remain unverified —
  Hetzner's spec table is JS-only.

### Still unverified — treat as open

- **Whether `identity.email` is actually populated** from a Cloudflare Access token on Convex's
  `customJwt` path (§7.1a). Docs guarantee only `subject`/`issuer`/`tokenIdentifier`. **This one
  gates the whole auth design working at all** — test it the first time a real token lands.
- **Whether External Evaluation is available on the Free plan.** The policy type exists and its
  contract is exactly as §Invitations describes, but Cloudflare publishes no plan-availability
  statement either way. **Do not treat "no documented restriction" as "confirmed available"** —
  check in the dashboard before designing the invitation flow around it.
- **Whether changing `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` re-evaluates `auth.config.ts`**
  without a fresh push. Not documented either way.
- **Whether GitHub Pro enables rulesets** on personal private repos (§2.0 Q1). Moot — the repo
  is public.
- Cloudflare publishes no free-plan DNS record cap; Hetzner's included traffic allowances.

### Verified and no longer in doubt

Render Free spins down at 15 min, wakes in ~1 min, ephemeral filesystem with no disks on Free,
750 instance-hours per workspace per month, **no outbound SMTP on Free**; Hobby workspace $0 with
5 GB bandwidth then $0.15/GB. Cloudflare's origin timeout is 125s **on all plans**. Workers
static asset requests are free and unlimited (with the three billing caveats in §7.5a). The `ws`
package is incompatible with Workers. Vercel Hobby pauses for 30 days rather than billing, has
4 CPU-hrs Active CPU, and is **non-commercial use only**. Fly has no spend caps or billing
alerts and no free tier for new orgs. Convex spend limits are Professional-only and disable the
**entire team**. Cloudflare Access assigns a **unique AUD per application**. `.app` is
HSTS-preloaded. Universal SSL covers one level of subdomain only. **`burkert.app` is registered
at Cloudflare as of 2026-08-12.**
