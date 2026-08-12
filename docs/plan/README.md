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

---

## The decisions already made

- **Stack:** Convex + React/Vite PWA + pure-TS `packages/core`. Matches `oh-heck-chaos-monkey`.
- **Repo:** `mwburkert/crokinole`, **public** — *not* `mwburkert-struct`, which is the active
  `gh` account and would silently claim it. (Public is readable, not writable; free private
  repos get no branch protection at all. §2.0)
- **Platform:** **`burkert.app`** + one Cloudflare Access email allowlist. Apps deploy
  independently at `crokinole.` / `meals.` / `ohheck.burkert.app`.
- **Auth:** per-player identity, allowlisted writes. Leaderboard is publicly readable, but
  **money is authenticated-only**, enforced in the query rather than the UI. (§3.5)
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

## Sequencing

```
all decisions closed (00-DECISIONS.md)
   │
   ├─► §7 platform setup   (~2 hours, $14.20)  ─┐
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
- ⬜ **CI (`ci.yml`) not added**, so the ruleset's `required_status_checks` rule is *not* in
  place yet — the `ci` context doesn't exist, and requiring a check that can never report would
  deadlock every PR. Adding it needs the `workflow` OAuth scope on the `mwburkert` account:
  `gh auth refresh -h github.com -u mwburkert -s workflow`. Then add §2.4's workflow and extend
  the ruleset.
- ⬜ Repo conventions not added: gitleaks pre-commit hook, PR template, `AGENTS.md`/`CLAUDE.md`
  (§2.5, §2.6). `.gitignore` **is** in place.
- ⬜ Domain `burkert.app` not yet registered.
- ⬜ Orca settings not yet applied — see the §1.7 checklist. The Orca project must also be
  pointed at `C:\dev\crokinole`; it was previously pointed at an empty, non-git directory at
  `C:\Users\mwbur\orca\projects\crokinole`, which is why Orca reported "no main branch connected".
- ⬜ No application code written; Phase 1 has not started.
- ⬜ The stale oh-heck checkout is deliberately untouched (deferred — see 00-DECISIONS).
