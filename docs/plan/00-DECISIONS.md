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

## ✅ Q6 — Earnings are not public

Money is visible to **authenticated (allowlisted) users only**. Anonymous visitors see win/loss
records and scoring stats, no dollar figures.

Moved from Phase 2 into **Phase 1**, and enforced in the **query layer, not the UI** — a
`{isAuthed && ...}` guard still ships the numbers to the browser. *Detail: §3.5.*

## ✅ Q7 — Global default agent unchanged

`defaultTuiAgent` stays `codex`. Orca has no per-project agent field, so Claude is pinned via
the §1.6 automations plus committed `CLAUDE.md`/`AGENTS.md`. **Accepted consequence:** a plain
new tab in this project opens Codex. *Detail: §1.2.*

## ✅ Q8 — Repo at `C:\dev\crokinole`

Alongside `meal-planner` and `oh-heck-chaos-monkey`, matching Orca's `workspaceDir`. GitHub
owner is **`mwburkert`**.

---

## Deferred — revisit later, nothing blocked

### meal-planner platform migration (from Q4)

**Do not migrate it yet.** Exposure is low today (only you and your wife know the URL), and
moving a live app mid-feature-work is needless risk. Crokinole goes onto the platform first and
proves the pattern; meal-planner follows once close friends actually need access.

Its handoff has been updated to say so explicitly, so its agent keeps shipping features on
Render with Basic auth and doesn't start a migration. Its repo also stays private for now — no
decision forced.

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
