# Rules for every agent working in this repo

These load automatically. They come from `docs/plan/06-ORCHESTRATION.md` §6.5 and the
non-negotiable design principles in `docs/plan/03-PHASE-1.md` §3.2. Read the section a rule
cites before arguing with it.

## Git

- **Never force-push. Never push to `main`. Never merge red CI.**
- One PR per task. Squash-merge only — the `main` ruleset enforces it.
- Personal repos belong to the **`mwburkert`** GitHub account. `mwburkert-struct` is the work
  account and is often the active `gh` login; check before you push.

## Scope

- **Stay inside your assigned workspace.** If you need a change outside it, **stop and report**
  — do not reach across. Ownership is listed in §6.2's wave plan.
- **Only one agent may touch `convex/` per wave.** Every worktree pointing at the same Convex
  dev deployment fights: each `convex dev` push overwrites the others' functions. If `convex/`
  isn't yours, work against `apps/web/src/data/fixtures.ts`.
- Report a **diff summary**, not file contents.
- If a design question isn't answered in `docs/plan/`, **ask** — don't guess.

## Design rules that are not negotiable

- **Scores and stats are DERIVED, never stored** (§3.2.1). Store only raw ring counts per team
  per round. If you're adding a `score` column, you've misread the design.
- **Rules live only in `packages/core`** (§3.2.2) — pure TS, no React, no Convex imports. Never
  re-implement a scoring rule in a component or a Convex function; import it.
- **`ScoringConfig` is snapshotted onto each game** (§3.2.3). Never hardcode `15`, `2`, `5`, or
  `12` anywhere outside `DEFAULT_SCORING`. Disc counts are derived via `discsPerTeam()`.
- **Soft-delete only** (§3.2.4). "Delete game" sets `deletedAt`. Money is involved.
- **Cloudflare Access does not protect Convex** (§3.2.5). The browser talks straight to
  `*.convex.cloud`. Every query and mutation calls `assertAllowlisted(ctx)` first. **There is no
  public route** — the public leaderboard was removed on 2026-08-12, so any function that
  returns data to an unauthenticated caller is a bug.

## Terminology (§3.1)

Use the real words in code and UI:

| Not this | This |
|---|---|
| "a crokinole" | **a twenty** — crokinole is the game, never the shot |
| "whiff" | **foul** |
| stored total | derived total |

## Commands

```bash
npm install          # workspaces: packages/core, apps/web
npm run typecheck    # tsc -b across core + web
npm test             # vitest, with coverage thresholds on packages/core
npm run dev          # vite dev server for apps/web
npm run build        # typecheck + production build
```

**`convex/` is not in the root `tsc -b` yet.** It imports `./_generated/*`, which only exists
after someone runs `npx convex dev` (it needs a browser login). Once a deployment exists, add
`convex/` to the root `tsconfig.json` references and run `npm run convex:codegen` in CI.
