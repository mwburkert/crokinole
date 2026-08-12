# Crokinole — Project Plan

Written 2026-08-11. Research verified against live sources; unverifiable items are flagged
in-place.

---

## Read in this order

| Doc | What it covers | Status |
|---|---|---|
| **[00-DECISIONS.md](00-DECISIONS.md)** | All 8 questions answered. Nothing open; 2 items deferred. | ⬅️ **start here** |
| [01-ORCA-SETUP.md](01-ORCA-SETUP.md) | Orca workspace, default agent, settings, automations | ready |
| [02-GITHUB-REPO.md](02-GITHUB-REPO.md) | Repo creation, rulesets, CI, secrets, agent hygiene | ready |
| [03-PHASE-1.md](03-PHASE-1.md) | **Build now.** Data model, rules engine, screens, tasks | ready |
| [04-PHASE-2.md](04-PHASE-2.md) | Designed, not built. Re-review after Phase 1. | on hold |
| [05-PHASE-3-VISION.md](05-PHASE-3-VISION.md) | Camera auto-scoring. Exploratory. | exploratory |
| [06-ORCHESTRATION.md](06-ORCHESTRATION.md) | Running parallel agents on this without collisions | ready |
| [07-PLATFORM.md](07-PLATFORM.md) | `burkert.app` — one domain, one login, three apps, ~$14/yr | ready |
| **[08-SEQUENCING.md](08-SEQUENCING.md)** | **What's left, in order. Dependencies, effort, owner-vs-agent, escalations.** | ⬅️ **new 2026-08-12** |
| [../qa/](../qa/) | Wave 3 QA briefs — G (rules fuzz), H (auth/security), I (reconciliation) | ready to fire |

---

## The decisions already made

- **Stack:** Convex + React/Vite PWA + pure-TS `packages/core`. Matches `oh-heck-chaos-monkey`.
- **Repo:** `mwburkert/crokinole`, **public** — *not* `mwburkert-struct`, which is the active
  `gh` account and would silently claim it. (Public is readable, not writable; free private
  repos get no branch protection at all. §2.0)
- **Platform:** **`burkert.app`** + **three** Cloudflare Access applications, one per app —
  separate allowlists, one login via the shared global session. Apps deploy independently at
  `crokinole.` / `meals.` / `ohheck.burkert.app`. (§7.1)
- **Hosting:** crokinole and oh-heck on **Cloudflare Workers static** (static requests are free
  and unlimited — no ceiling at any scale); meal-planner on **Render** (Hobby workspace, Free
  instance) with Vercel Hobby as the upgrade path. (§7.5)
- **Database:** **Convex for all three.** Turso is dropped — meal-planner's `lib/db.ts` moves to
  `ConvexHttpClient`. One platform, one dashboard, one free team. (§7.8)
- **Auth:** per-player identity, allowlisted writes. **The whole app is gated — there is no
  public route.** Every query and mutation validates signature, issuer, and this app's AUD. (§3.5)
- **Money:** everyone pays in; winners take the whole pot and split it — evenly, or by stake
  when stakes differ. Equal $5 bets ⇒ **+$5 / −$5**. (§3.4)
- **Formats:** doubles (6 discs/player, 12/team) primary; **singles (8/player) supported**.
  3-player out of scope. Verified against NCA rules. (§3.1)
- **Agents:** Orca's global default stays `codex`; Claude is pinned per-project via automations,
  because Orca has no per-project agent setting. (§1.2)

## Handoffs — sent 2026-08-11

Delivered as `docs/PLATFORM-HANDOFF.md` into each sibling repo, then **removed from this repo**
(they documented another app's unpatched dependencies, and this repo is public):

- **meal-planner** — `C:\dev\meal-planner\docs\` and its `new-features\docs\` worktree. Has an
  agent working right now, told explicitly **not** to start the migration; keep shipping on
  Render behind Basic auth.
- **oh-heck** — `C:\dev\oh-heck-chaos-monkey\docs\`. Dormant. Its auth question is resolved
  in-place: **keep Convex Auth**, since public play is still a goal.

## The four things that changed during planning

Parallel research agents contradicted the initial spec in four places:

1. **Terminology.** Sinking the centre hole is called **"a twenty"** — *crokinole* is the game,
   never the shot. What you called a "whiff" is officially a **foul**, and the real rule is
   stricter: the shot disc *and any of your own discs that moved* go to the ditch. (§3.1)
2. **Repo visibility.** GitHub rulesets aren't enforced on free private repos, so
   "free + private" means an agent can force-push `main` with nothing stopping it. That inverts
   the usual private-by-default instinct. (§2.0)
3. **⚠️ Cloudflare Access does not protect Convex.** The browser WebSockets directly to
   `*.convex.cloud`, bypassing the edge entirely. But Convex *can* validate the Access JWT via
   `customJwt` — turning the problem into one login across all three apps. The most
   consequential finding in the plan. (§7.1)
4. **The camera idea is tractable, but not as described.** The board has built-in fiducials, so
   detection is easy; the hard parts are **disc-thickness parallax** (~0.11″ of error against a
   rule needing ±0.03″) and the fact that **twenties fall in the hole and vanish**, so a single
   end-of-round photo cannot score the round. It needs stateful shot-by-shot diffing. (§5.0)

## Five corrections made 2026-08-12

Research into the meal-planner coordination question turned up four errors in the plan, and one
decision was simplified. All are applied in-place:

1. **Cloudflare Workers cannot host meal-planner.** §7.5 recommended moving it there to kill the
   cold start. `anylist/lib/index.js` requires `got`, `reconnecting-websocket`, and `ws` at
   module load, and Cloudflare's docs state the `ws` package is incompatible with the Workers
   runtime. The bundle fails regardless of whether that code path runs. (§7.5)
2. **One multi-domain Access application was the wrong boundary.** One application means one AUD
   tag, and the AUD is what Convex validates — so a token issued for meal-planner would have been
   valid at crokinole's backend. Three applications give per-app AUDs, and the global session
   token preserves single sign-on anyway. (§7.1)
3. **Turso is out; Convex is the database for all three.** meal-planner's storage is a single
   `kv(key, value)` table of JSON blobs behind three functions — a document store wearing a SQL
   costume. Also flagged: Render's ephemeral filesystem may be silently destroying its data
   today. (§7.8)
4. **The cost table was wrong** — Render free + Turso free became Render Free + Convex, and
   static hosting has no ceiling at all. Still $14.20/yr. (§7.6)
5. **The public leaderboard is gone; the whole app is gated.** This deletes the two-query split,
   moots Q6, removes the SPA path-policy caveat, and eliminates the only way Convex usage could
   grow without you adding someone deliberately. (§3.5)

## Second verification pass — 2026-08-12

The load-bearing factual claims were re-checked against primary sources by parallel research
agents, because the docs had already been wrong five times. **The two biggest claims survived:
the three-Access-applications AUD argument is confirmed by Cloudflare's own documentation, and
the `auth.config.ts` snippet is correct field for field.** What changed:

1. **`burkert.app` is registered** (06:16 UTC, Cloudflare Registrar). The plan's premise that
   everything waits on the domain is obsolete — see [08-SEQUENCING.md](08-SEQUENCING.md).
2. **"A Pages Function at `/admin/token`" cannot work.** Pages Functions are a Cloudflare *Pages*
   construct and the plan hosts on *Workers* static assets. It needs a Worker `fetch` handler
   with `run_worker_first` — and without that, navigating to the URL silently returns
   `index.html` instead of the token. Corrected config in §7.5a.
3. **Email OTP is no longer configured automatically.** Since 2026-06-18 new Zero Trust orgs
   default to the Cloudflare identity provider; OTP must be added deliberately. §7.7 step 3 was
   a no-op step and is now a real one.
4. **Convex static hosting cannot replace Cloudflare Workers** — it exists, but custom domains
   are Professional-plan-only, so on Free you get a `*.convex.site` hostname that cannot sit
   behind Access. This answers the open question in the migration handoff: no.
5. **`identity.email` is not guaranteed** on Convex's `customJwt` path, and `assertAllowlisted`
   depends on it entirely. Unverifiable from docs; must be tested empirically. This is the
   single most likely way the auth design fails on first contact.
6. **The Convex spend-limit disable threshold disables every project on the team**, so all three
   apps on one free team is a shared-fate decision, not a free lunch.
7. **§3.8's T1 definition of done still contained the property test §3.4 had already declared
   false.** Fixed — the correction had been applied in the prose but not in the DoD an agent
   actually reads.
8. **CI exists and has reported three green runs**, so requiring the `ci` check is safe now.
   And `gh auth refresh` genuinely has no `-u` flag — but the scope it was meant to add is
   already present, so the whole instruction was unnecessary.
9. **125s origin timeout is all plans**, not Free-specific. **Namecheap's `.app` renewal is
   $22.98**, not $17.98. **Render Starter is confirmed $7/mo** — and is still only 512 MB RAM.
10. **The service-worker/Access conflict is not documented by Cloudflare** — keep the
    mitigation, drop the citation. The hazard Cloudflare *does* document is closer to home: a
    Worker route on the login path overwriting `cf-authorization`, which this architecture has.

**Two claims could not be verified and are flagged rather than asserted:** whether External
Evaluation is available on the Zero Trust Free plan, and whether `identity.email` survives the
`customJwt` path. Neither should be designed around until checked.

## Sequencing

```
all decisions closed (00-DECISIONS.md)
   │
   ├─► §7 platform setup   (~2 hours, $14.20)  ─┐   ◀── IN FLIGHT 2026-08-12
   │     domain · Zero Trust · 3 Groups         │
   │     · 3 Access apps · SSL Full (strict)    │
   │       │                                    │
   │       └─► §7.8 meals → meals.burkert.app   │   ◀── un-deferred; proves
   │             (Convex move lands first)      │       the pattern first
   │                                            │
   └─► §1 Orca settings    (~15 min)            │
                                                 ▼
                            §3 Phase 1 build (§6 wave plan)
                                                 │
                            ship, use for a month
                                                 │
                            §4.6 re-review ─► Phase 2
```

**T0 (scaffold) and T1 (the rules engine) depend on none of it.** `packages/core` is pure
TypeScript with no dependencies and is the critical path for everything else, so it can start
before the domain exists.

## State

> **Corrected 2026-08-12.** The 2026-08-11 version of this section claimed the repo had been
> pushed to GitHub with branch protection. **It had not been.** What actually existed was a
> local `git init` with a single *empty* commit on `master`, no remote, and these plan docs
> sitting untracked. Nothing was lost — no application code had been written — but the repo
> was only wired up for real on 2026-08-12. Treat ⬜ items below as genuinely not done.

- ✅ Repo at `C:\dev\crokinole`, pushed to `mwburkert/crokinole` (public), default branch `main`.
- ✅ Squash-only merge settings and the `main` ruleset applied (§2.2, §2.3).
- ✅ Handoffs delivered to both sibling repos — but **all three are still untracked** in their
  repos and will be lost if those working trees are cleaned. See §Handoffs.
- ✅ **CI (`ci.yml`) exists and has reported three green runs** under the context name `ci`
  (corrected 2026-08-12, second pass — the previous text said it was not added). It runs
  `npm ci`, typecheck, test, build on `pull_request` and pushes to `main`.
- ⬜ **The ruleset still has no `required_status_checks` rule.** Adding it is now **safe and
  cheap** — the earlier warning about deadlocking against a context that has never existed no
  longer applies, because the context exists and has reported. Do it.
  > The old note here prescribed `gh auth refresh -h github.com -u mwburkert -s workflow`.
  > **`gh auth refresh` has no `-u` flag** (confirmed against gh 2.96.0); for an inactive
  > account you must `gh auth switch -u <user>` first. **But it is moot — `mwburkert` already
  > holds the `workflow` scope.** No refresh is needed.
- ⚠️ **`convex/` is not in the root `tsc -b`**, so CI typechecks none of the backend. Not a
  one-liner: `convex/tsconfig.json` needs `composite: true` and must drop `noEmit`, and CI needs
  `convex:codegen` first because `_generated/` is gitignored. See §8.3.
- 🟡 Repo conventions: PR template and `AGENTS.md`/`CLAUDE.md` **do exist** (corrected
  2026-08-12). Still missing: the **gitleaks pre-commit hook** (§2.5). `.gitignore` is in place.
- ✅ **The `DATABASE_URL` question is answered** (2026-08-12, second pass). meal-planner's live
  branch — `master`, **not** the stale `prepare-private-online-deployment` checked out at
  `C:\dev\meal-planner` — has moved storage to Convex and **removed the SQLite fallback
  entirely**; it now fails closed in production. The data-loss bug is fixed *provided Render
  deploys master*, which is only visible in the Render dashboard. **Two worse problems were
  found in its place — see §8.4 and the escalation list in §8.5.**
- ✅ **`burkert.app` is registered** — 2026-08-12 06:16 UTC, Cloudflare Registrar, Cloudflare
  nameservers, verified against Google Registry's RDAP. §7.7 step 1 is done; start from step 2.
- 🔄 **§7 platform setup in flight as of 2026-08-12** — Zero Trust team, three Access Groups,
  three Access applications, and the `meals.burkert.app` cutover. The
  meal-planner migration was **un-deferred** and now goes first, so it proves the pattern rather
  than following crokinole onto it (00-DECISIONS §In flight).
- ⬜ Orca settings not yet applied — see the §1.7 checklist. The Orca project must also be
  pointed at `C:\dev\crokinole`; it was previously pointed at an empty, non-git directory at
  `C:\Users\mwbur\orca\projects\crokinole`, which is why Orca reported "no main branch connected".
- ✅ **Phase 1 is substantially built** (corrected 2026-08-12, second pass — the previous line
  said no application code had been written). `packages/core` has 117 tests across 6 files;
  `convex/` has schema plus 23 functions across 4 files; `apps/web` has all five screens plus
  the board scorer. **`apps/web` is not yet wired to Convex** — it runs off `fixtures.ts` and
  localStorage, deliberately, pending the migration.
- ✅ **All 23 Convex functions call `assertAllowlisted` or `assertAdmin` as their literal first
  statement.** There are no `action`, `internalMutation`, `internalQuery` or `httpAction`
  exports, and no `http.ts` or `crons.ts`. Verified 2026-08-12. QA agent H would pass today —
  which is the baseline it must be re-checked against after the migration, not a reason to skip
  it.
- ⚠️ **`auth.config.ts` emits `providers: []` when `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` are
  unset**, so `getUserIdentity()` returns null and all 23 functions throw. It fails **closed**,
  which is correct — but the app is entirely non-functional until both Convex env vars are set.
- ⬜ The stale oh-heck checkout is deliberately untouched (deferred — see 00-DECISIONS).
