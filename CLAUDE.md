# Crokinole

Scorekeeper for a weekly crokinole night: record a game in under a minute, see history and
lifetime stats, and settle up the money.

**Read `AGENTS.md` first** — it holds the rules that apply to every change here. This file adds
only what's specific to working with Claude on this repo.

## Where things live

| Path | What | Owner in the wave plan |
|---|---|---|
| `packages/core/` | The rules engine. Pure TS, zero dependencies. **Critical path.** | agent A (T1) |
| `convex/` | Schema, queries, mutations, auth. | agent B (T2) — **one agent per wave** |
| `apps/web/` | React + Vite PWA. | agents C–F (T3–T6) |
| `docs/plan/` | The full plan. Start at `docs/plan/README.md`. | — |

## The short version of the design

Store raw ring counts per team per round and **nothing derived**. `@crokinole/core` computes
every total, standing, settlement, and statistic on read. Each game snapshots the scoring rules
it was played under, so changing the house rules never rewrites history.

Money: everyone pays in, the winning side splits the whole pot proportionally to stake. Four
equal $5 bets means **+$5 each for the winners, −$5 for the losers**. Confirmed 2026-08-12; the
rule lives alone in `packages/core/src/settle.ts` because it's the one most likely to change.

## Before you start

- `npm run typecheck && npm test` should be green. If it isn't, fix that first.
- The UI currently runs against `apps/web/src/data/fixtures.ts`, not a live backend. That's
  deliberate (§6.2) — swapping `apps/web/src/data/store.tsx` for Convex hooks is the whole
  wiring job.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
