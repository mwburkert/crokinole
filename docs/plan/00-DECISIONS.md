# Decisions

All eight questions answered 2026-08-11. **Nothing is open.** Two items are deliberately
deferred (§Deferred), and neither blocks Phase 1.

---

## ✅ Q1 — Public repo

`mwburkert/crokinole` is **public**. Recommended for oh-heck too; meal-planner stays as-is
(see Q4).

The concern behind the question doesn't apply: **public means readable, not writable** — nobody
outside your collaborator list can push, ever. And the data isn't in the repos: verified that
meal-planner's `data/` is gitignored and never committed, and the only env file in history is
`.env.example` with placeholders. Free+private was the genuinely bad option — no rulesets, so
an agent could force-push `main` unopposed. *Detail: §2.0.*

## ✅ Q2 — Disc counts, and singles is in scope

**Verified against NCA rules:**

| Format | Discs per player | Per team |
|---|---|---|
| **Doubles** (2v2) — primary | 6 | **12** |
| **Singles** (1v1) — supported | 8 | **8** |

Round scoring confirmed identical to your house rules: **2 points to the higher score, 1 each
on a tie.** 3-player variants are out of scope. Singles support is cheap because `playerIds` is
an array — see §3.1.

## ✅ Q3 — Winners take the whole pot

Everyone pays in; the winning side takes the entire pot and splits it evenly, or proportionally
to stake when stakes differ. **Losers get nothing back.**

Equal $5 bets, doubles: pot $20, each winner receives $10 → **net +$5 each**, losers **−$5
each**. Singles: pot $10, winner takes it → +$5 / −$5. *Implementation: §3.4.*

## ✅ Q4 — Connectivity is fine

The wifi where you play is good, so Phase 1 writes require a connection (with optimistic
updates so entry still feels instant). A true offline queue stays in Phase 2 and may never be
needed.

## ✅ Q5 — Domain: `burkert.app`

Registered at **Cloudflare Registrar** — at cost, and crucially **no renewal markup**
($14.20/yr flat, where Namecheap runs $10.98 → $17.98). Buying there also sets Cloudflare
nameservers automatically, which Access requires.

- `crokinole.burkert.app` · `meals.burkert.app` · `ohheck.burkert.app`
- All one level deep, so Universal SSL covers them.
- ⚠️ `.app` is **HSTS-preloaded at the TLD level** — HTTPS mandatory, no `http://` fallback.
  Fine here, but worth knowing if a cert ever lapses.
- **Check availability at purchase**; this plan assumes it's still free to register.

## ✅ Q6 — Nothing is public (revised 2026-08-12)

**Superseded and simplified.** The original answer kept a public leaderboard showing records and
scoring stats while hiding money behind auth. **The whole app is now gated** — there is no
anonymous route at all.

This deletes work rather than adding it: the `publicLeaderboard` / `fullStats` split collapses
into one authenticated query, the "enforce money in the query layer, not the UI" rule becomes
moot (no audience to leak to), the SPA path-policy caveat in §7.4 disappears because the whole
hostname is gated, and the only unbounded-audience surface — anonymous viewers holding reactive
subscriptions — is gone, which removes the realistic way Convex usage could run away.

Cost: showing the app to someone new means adding them to the `Crokinole Players` Access Group
first. ~30 seconds. Going private→public later is easy; the reverse isn't. *Detail: §3.5.*

## ✅ Q7 — Global default agent unchanged

`defaultTuiAgent` stays `codex`. Orca has no per-project agent field, so Claude is pinned via
the §1.6 automations plus committed `CLAUDE.md`/`AGENTS.md`. **Accepted consequence:** a plain
new tab in this project opens Codex. *Detail: §1.2.*

## ✅ Q8 — Repo at `C:\dev\crokinole`

Alongside `meal-planner` and `oh-heck-chaos-monkey`, matching Orca's `workspaceDir`. GitHub
owner is **`mwburkert`**.

---

## In flight — started 2026-08-12

### meal-planner platform migration (from Q4) — NO LONGER DEFERRED

**Reversed 2026-08-12.** The 2026-08-11 decision was to hold this until crokinole proved the
pattern. Mike is doing it now instead, so meal-planner is the app that proves the pattern rather
than the one that follows it. That's a reasonable inversion — it's the only app of the three that
already exists and runs, and it's the only one where Access is a genuine security boundary rather
than a token issuer, so it exercises the simplest version of the design first.

**Ordering matters here — follow §7.7, and specifically:** create the Zero Trust team and the
three Access **Groups** before the applications; point the CNAME **grey-cloud first** and wait for
Render to issue its certificate before flipping to orange-cloud; **delete all AAAA records**
(Render has no IPv6); set the zone SSL/TLS mode to **Full (strict)** before the flip, not after.

**Blocking item:** handoff item 2 (origin-agnostic — no hardcoded `*.onrender.com` URLs) was
"nice to have while you're in there." It is now the one thing that can actually break this
migration, and it should be verified before the DNS flip.

**Keep the Basic auth.** `*.onrender.com` stays directly reachable no matter what DNS says.

**The database move runs in parallel and is independent of DNS.** `lib/db.ts` falls back to a
SQLite file under `data/`
when `DATABASE_URL` is unset, and Render's filesystem is ephemeral — so if that variable isn't
set in the dashboard, the app has been losing all persisted state whenever it sleeps. Rewriting
that one file against `ConvexHttpClient` fixes the data loss *and* consolidates all three apps
onto one database platform. Turso is dropped: its free tier is fine, but it's a third platform,
and Turso has pivoted to a closed-source Rust rewrite with the continuity promise scoped
explicitly to paid customers. The seam is 74 lines and three functions, so this is reversible.

**Hosting stays on Render** (Hobby workspace, Free instance, $0) for now. Vercel Hobby is the
upgrade path — no cold start, real CPU, ~1 hour to move — and stays cheap to reach as long as the
portability rules in §7.8 hold. Its repo also stays private for now — no decision forced.

---

## Deferred — revisit later, nothing blocked

### The stale oh-heck checkout (from Q8)

`C:\Users\mwbur\orca\projects\oh-heck\oh-heck-chaos-monkey` exists alongside the live checkout
at `C:\dev\oh-heck-chaos-monkey`. You don't recall whether it has unpushed work, and oh-heck
isn't active, so **this waits until that project resumes** — it's recorded as the first task in
that repo's handoff. Nothing has been touched or deleted.

---

## Resolved for the sibling projects

- **oh-heck keeps Convex Auth.** You confirmed public play is still a goal, so the shared
  allowlist identity is wrong for it; Access is only a frontend gate during private beta.
  ⚠️ This carries a real requirement: anonymous play means **unauthenticated writes exposed to
  the internet**, so Turnstile or rate limiting is needed before its Phase 2 ships. Recorded in
  its handoff.
- **The two handoff documents have been delivered and removed from this repo**, since it's now
  public and they described another app's unpatched vulnerabilities. They live at
  `C:\dev\meal-planner\docs\PLATFORM-HANDOFF.md` (and its `new-features` worktree) and
  `C:\dev\oh-heck-chaos-monkey\docs\PLATFORM-HANDOFF.md`.
