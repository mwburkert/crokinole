# Section 8 — Sequencing the remaining work

**Written 2026-08-12.** What is left, in what order, what depends on what, and
which items need the owner rather than an agent.

Everything here was checked against reality on 2026-08-12 rather than inherited
from the earlier docs. Where a previous doc said something that is no longer
true, it is corrected in place and noted here.

---

## 8.0 The headline: `burkert.app` exists, so almost nothing is blocked any more

The plan has been written throughout as though the domain were the gate. **It is
not, as of 06:16 UTC on 2026-08-12** — `burkert.app` is registered at Cloudflare
Registrar on Cloudflare nameservers (§7.7 step 1, verified against Google
Registry's RDAP).

That collapses the blocked list to almost nothing. The real constraint now is
**one Convex dev deployment** (§6.1) and **the owner's attention**, not the
domain.

| Was blocked on the domain | Status now |
|---|---|
| Zero Trust team, IdP, Groups, Access applications | **Unblocked** — owner, ~1 hour |
| `auth.config.ts` wiring, AUD tags | **Unblocked**, but needs the AUDs from the step above |
| Retiring the interim passcode | **Unblocked**, gated on Access being live |
| Invitations (Access Group API or External Evaluation) | **Unblocked** — §7.9 |
| Resend + verified sending domain | **Unblocked** — §7.6 |
| `meals.burkert.app` cutover | **Unblocked**, but see §8.4 — it has grown new problems |

---

## 8.1 The critical path

```
burkert.app  ✅ done 2026-08-12
   │
   ├─► [OWNER] Zero Trust team + IdP + 3 Groups + 3 Access apps   ~1h
   │      │        └─► note the three AUD tags
   │      │
   │      ├─► [AGENT] crokinole: auth.config.ts + /admin/token Worker + deploy   ~½d
   │      │      │        (blocked on: migration landing, AUD tag)
   │      │      └─► [AGENT] retire the interim passcode        ~1h
   │      │
   │      └─► [OWNER+AGENT] meals.burkert.app cutover           ~2h  ⚠️ see §8.4
   │
   └─► [AGENT] Convex migration (other agent, in flight)
          │
          ├─► ⚠️ WAVE 3 QA — G, H, I in parallel, read-only     ~1 session each
          │        briefs ready at docs/qa/WAVE-3-*.md
          │
          └─► [OWNER] T7: seed remaining historical games
```

**Wave 3 is the gate between "the migration typechecks" and "the migration is
trusted".** It has never run. The briefs are written and ready to fire the
moment the migration lands — that is the highest-value thing an agent can do
next, and it needs no owner input.

---

## 8.2 The ordered plan

Effort is for a competent agent or the owner as marked. "Blocks" names the
prerequisite.

### Tier 1 — do next, no owner input needed

| # | Item | Who | Effort | Blocks on |
|---|---|---|---|---|
| 1 | **Wave 3 QA: agents G, H, I in parallel** (`docs/qa/`) | agent ×3 | 1 session each | migration landing |
| 2 | **Make `ci` a required status check** on the `main` ruleset | agent | 10 min | nothing — see §8.3 |
| 3 | **Add `convex/` to the root `tsc -b`** so CI typechecks the backend | agent | 1–2h | see §8.3, not a one-liner |
| 4 | Add the gitleaks pre-commit hook (§2.5) | agent | 20 min | nothing |
| 5 | Fix the stale `gh auth refresh -u` claim in `README.md` | agent | 5 min | done in this PR |

### Tier 2 — needs the owner first, then an agent

| # | Item | Who | Effort | Blocks on |
|---|---|---|---|---|
| 6 | Zero Trust team, IdP, 3 Groups, 3 Access applications (§7.7 2–5) | **owner** | ~1h | nothing |
| 7 | Record the three AUD tags somewhere the agents can read | **owner** | 5 min | 6 |
| 8 | Zone SSL → Full (strict) (§7.7 7) | **owner** | 5 min | nothing |
| 9 | `auth.config.ts` + `/admin/token` Worker + Workers deploy (§7.5a) | agent | ~½d | 7, migration |
| 10 | **Verify `identity.email` actually arrives** (§7.1a) | agent | 30 min | 9 |
| 11 | Retire the interim passcode (§Retire the passcode) | agent | 1h | 9, 10, coordinate with migration agent |
| 12 | Invitations — Route A, Access Group API (§7.9) | agent | ~½d | 6, 7 |
| 13 | Resend + verified sending domain for invite email | owner + agent | 1h | 6 |

### Tier 3 — later, deliberately

| # | Item | Who | Effort | Notes |
|---|---|---|---|---|
| 14 | T7: seed remaining historical games | **owner** | — | Only the 5 Aug night is in. **Never backfill invented points** |
| 15 | Phase 2 (§4) | — | — | Not until Phase 1 has had a month of real use and §4.6 is answered from actual play |
| 16 | Phase 3 camera scoring (§5) | — | — | Exploratory. §5.6 has the cheapest first experiment |

---

## 8.3 Repo housekeeping — two items the handoff got wrong

**The `ci` required-status-check caveat is obsolete.** The handoff says to add it
"only after a run has reported, or every PR deadlocks against a context that has
never existed". **A run has reported — three of them, all green**, under exactly
the context name `ci` (runs on `phase-1/foundation`, `main`, and `docs/handoffs`).
`.github/workflows/ci.yml` exists and runs `npm ci && typecheck && test && build`.
The `main` ruleset today enforces deletion protection, non-fast-forward, linear
history, and squash-only PRs — but **has no `required_status_checks` rule at
all**. Adding it is safe right now and is the single cheapest improvement
available.

**The `gh auth refresh -u` claim is right, but the advice around it is wrong.**
`gh auth refresh` genuinely has no `-u`/`--user` flag (confirmed against `gh`
2.96.0 — the flags are `-c`, `-h`, `--insecure-storage`, `-r`, `--reset-scopes`,
`-s`). The correct incantation for an inactive account is
`gh auth switch -u mwburkert && gh auth refresh -s workflow && gh auth switch -u mwburkert-struct`.
**But it is moot: `mwburkert` already holds the `workflow` scope.** Both accounts
do. The README's prescribed refresh is unnecessary; the note has been corrected
in place.

**⚠️ A gap neither handoff mentions: CI does not typecheck the Convex backend.**
The root `tsconfig.json` references only `packages/core` and `apps/web`, so
`npm run typecheck` — and therefore CI — never compiles a line of `convex/`. This
is not a one-line fix. `convex/tsconfig.json` is Convex's stock generated config:
it lacks `"composite": true` (which `tsc -b` requires of a referenced project)
and sets `"noEmit": true` (which produces TS6310, "Referenced project may not
disable emit"). It needs the same `composite` + `emitDeclarationOnly` treatment
`apps/web/tsconfig.json` already uses. And because `convex/_generated/` is
gitignored, CI must run `npm run convex:codegen` before typechecking or the
imports will not resolve. Budget 1–2 hours, not five minutes.

**Still outstanding and genuinely trivial:** the gitleaks pre-commit hook. There
is no `.pre-commit-config.yaml`, no husky, no lefthook. The PR template and
`AGENTS.md`/`CLAUDE.md` **do** exist, contrary to the README's state list.

**The `gh` account reverting to `mwburkert-struct`** is confirmed — it is the
active account right now. Root cause not found; it is a global CLI setting, so
the likeliest candidate is another tool or another repo's workflow calling
`gh auth switch`. Worth a `gh auth status` check before any push.

---

## 8.4 ⚠️ The sibling apps have moved, and meal-planner is now the urgent one

The sibling handoffs were audited read-only on 2026-08-12. **meal-planner's has
been substantially overtaken by events, and the audit surfaced two live security
problems that outrank everything in this plan.**

**First, a trap for anyone auditing it:** the main checkout at `C:\dev\meal-planner`
is ~2 months stale and is **not** the live code. It sits on
`prepare-private-online-deployment`, which was never merged. The live code is
`master`, visible in the `new-features` worktree, where another agent landed 14
commits on 2026-08-12. Reading `C:\dev\meal-planner\lib\db.ts` directly reads
dead code.

**The `DATABASE_URL` question is resolved, and the answer is "wrong question
now".** On the stale branch the handoff's warning was exactly right — `lib/db.ts`
silently fell back to a SQLite file under `data/` on Render's ephemeral
filesystem. On `master` that fallback is **gone**: storage moved to Convex and
the code now fails closed in production. So the data-loss bug is fixed *if
master is what Render deploys* — and **that is only visible in the Render
dashboard**. See the escalation list.

**Two live security findings:**

1. 🚨 **meal-planner's Convex `kv` functions are completely unauthenticated.**
   `convex/kv.ts` exposes `get`/`list`/`set` as public functions with no caller
   check whatsoever. Anyone who learns that deployment URL can read or overwrite
   every saved plan, setting, and rating. **Neither Basic auth nor Cloudflare
   Access mitigates this** — it is precisely the §3.2.5 / §7.1 finding that
   shapes this entire plan, reproduced in the sibling app. This must be fixed
   before `meals.burkert.app` goes live, and arguably before tonight.
2. 🚨 **The live branch has no HTTP Basic auth at all.** No `middleware.ts`, no
   `proxy.ts`, and `render.yaml` dropped the `APP_BASIC_AUTH_*` env vars. The
   handoff's "keep the Basic auth as defence in depth" was not violated by
   deletion — development simply proceeded on a branch that never had it.
   ⚠️ **And merging the auth branch would not fix it:** that branch's `proxy.ts`
   filename only works on Next 16, and master downgraded to Next 14.2.5, where
   that filename means nothing. The auth would appear present in the tree and be
   **entirely absent at runtime**.

**Three more things that invalidate parts of the plan:**

- **The "$0" premise is broken.** master's `render.yaml` adds a second service,
  `type: cron`, `plan: starter` — a paid plan — for the weekly email automation.
- **Cloudflare Access now conflicts with the app's own design.** New
  email-link endpoints (`/vote`, `/rate`) are token-authenticated for email
  *recipients*. An Access allowlist in front of the domain blocks exactly those
  people unless every recipient is in the `Household` group. Nobody has
  reconciled this, and it directly affects the §7.8 cutover.
- **`APP_BASE_URL`** must be repointed to `https://meals.burkert.app` at cutover
  or every emailed vote/rate link breaks.

Genuinely still true from the handoff: the `anylist` module-load `require`s of
`got`/`reconnecting-websocket`/`ws` are confirmed verbatim, so **§7.5's ruling
that Workers cannot host meal-planner stands**. The Vercel-portability rules are
now *cleaner* than the handoff claimed — no filesystem writes, no `setInterval`,
no hardcoded `*.onrender.com`.

**oh-heck is dormant** (last commit 2026-06-27) and its handoff has one
substantive error: it says "you keep Convex Auth" as though auth exists. **It does
not.** There is no `@convex-dev/auth` dependency, no `auth.config.ts`, no
`getUserIdentity` call anywhere, and `schema.ts` references a `users` table that
is never defined. **All 60 of its functions — 50 mutations, 10 queries — are
unauthenticated public endpoints**, including two seed mutations. There is no
rate limiting or bot protection of any kind. This is fine while nothing is
deployed, and it is the first thing to fix when it wakes up. "Keep Convex Auth"
should read "build Convex Auth".

**Both sibling handoffs are still untracked** in their working trees and would be
lost to a `git clean`. meal-planner's `master` has a committed copy, but it is
the superseded 2026-08-11 version.

---

## 8.5 Escalations — these need the owner, not an agent

Ordered by urgency.

1. 🚨 **Is meal-planner's deployed app publicly reachable right now?** The live
   branch has no Basic auth and Render's env vars for it were dropped. Only the
   Render dashboard shows which branch is deployed.
2. 🚨 **meal-planner's Convex `kv` functions are open to the internet** (§8.4).
   Decide whether to fix now or take the app down until it is fixed.
3. **Which branch does Render actually deploy?** If it is still
   `prepare-private-online-deployment`, the original silent-SQLite data-loss bug
   is live and none of the Convex work is running.
4. **Is `NEXT_PUBLIC_CONVEX_URL` set on the Render service?** If not, the live
   app throws on every DB call in production.
5. **Confirm the `burkert.app` registration was you.** It happened at 06:16 UTC
   today. If it was not, someone else took the name hours before this was
   written.
6. **Accept or avoid the Render Starter cron cost** for meal-planner's weekly
   email (§8.4). The alternative is an external free trigger hitting
   `/api/scheduler/run`.
7. **Access vs. email-link voting** in meal-planner — needs a bypass policy or a
   design decision before the cutover.
8. **Shared-fate on the Convex team** (§7.5): the spend-limit disable threshold
   disables *every project on the team*. All three apps on one free team means a
   runaway crokinole takes meal-planner down. Accept, or split the teams.
9. **Check External Evaluation availability on Free** in the Zero Trust
   dashboard before designing the invitation flow around it (§7.9).

---

## 8.6 What is deliberately not being done

- **No implementation work landed today.** This PR is documentation, corrections,
  and the Wave 3 briefs. Nothing that could destabilise a working app before a
  game night.
- **Nothing in `convex/`** — the migration agent owns it this wave (§6.1).
- **Nothing in the sibling repos.** The audit was strictly read-only; every
  finding above is a report, not a change.
- **Phase 2 and Phase 3 stay closed** until §4.6 is answered from real use.
  ⚠️ One correction there: §4.5's "highest-value item", **night grouping with a
  per-night settlement, is already built** — `packages/core/src/night.ts` plus
  `groupByNight`, and `convex/stats.ts:nights` already returns a per-night
  settlement. The handoff still lists it as the top thing to do. It is done.
