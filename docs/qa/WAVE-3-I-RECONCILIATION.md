# Wave 3 · Agent I — independent reconciliation

**Read-only QA. You report findings; you do not fix them.**
Written 2026-08-12, ready to fire once the Convex migration lands.

---

## Your job in one sentence

Hand-compute one full night of crokinole from raw inputs, **before** you look at
what the app produces, then compare field by field and report every mismatch.

## Why the order matters, and the one rule you must not break

**Compute independently first. Do not read `packages/core` implementation code,
and do not run the app, until your own numbers are written down and saved.**

If you read `settle()` first you will reimplement `settle()`, and two copies of
the same mistake agree perfectly. The whole value of this agent is that your
arithmetic has a different provenance from the app's. An agent that peeks and
then "verifies" is worse than no agent, because it produces false assurance
about money.

Concretely:

1. Read **only** the prose rules: `docs/plan/03-PHASE-1.md` §3.1 (formats,
   scoring), §3.4 (`winBy`, settlement) and `docs/plan/00-DECISIONS.md` Q2/Q3.
2. Read the raw fixture data: `apps/web/src/data/fixtures.ts`. Read it as
   *data* — the games, teams, bets, and round outcomes. Do not read the core
   functions it feeds.
3. Compute by hand. Write your numbers to `docs/qa/findings/I/hand-computed.md`
   **and state in the report that you did this before step 4.**
4. Only now run the app / query Convex and compare.

## The night

The 5 Aug 2026 night, five games, in `apps/web/src/data/fixtures.ts`.

⚠️ **This night's rounds are outcome-only by design.** They carry
`resultOverride` with all ring counts at zero: the outcome of each round is
known, the points were never recorded. This is real historical data entered
honestly.

**Never invent points to make a column fill in.** "Points not recorded" is a
distinct state from "scored zero" and must render as **—**, never as 0. If you
find the app showing 0 where points were never recorded, that is an **S1
finding** — it is the app claiming to know something it does not.

The same applies to twenties: per-player twenties were never captured for this
night, so those columns must show **—**.

## What to reconcile, field by field

For each of the five games:

| Field | Source of truth for your hand computation |
|---|---|
| Match points A / B | 2 per round won, 1 each on a tie (§3.4) |
| Round points A / B | **Not computable for this night** — assert "not recorded" |
| Winner | Reached `targetMatchPoints` (5) **and** led by `winBy` (2) |
| Is the game complete? | Same rule. A game that never satisfies it has no winner and **no settlement at all** |
| Pot | Sum of all four bets |
| Per-player net | Winners: proportional share of pot minus own stake. Losers: minus own stake |

Then for the night as a whole:

| Field | Check |
|---|---|
| Per-player night settlement | Sum of that player's five per-game nets |
| **Settlement sums to zero** | Across the night and within every single game. Money is conserved or something is wrong |
| Games played / won / lost per player | Count them yourself |
| Win % | Your own division, and check the app's rounding rule |
| Match points for / against | Sum across games |
| Night grouping | All five games land on **one** night. `nightKey` resets at 3am, not midnight — confirm the app agrees, and check whether a game timestamped after midnight would still group here |

## The published expectation — and how to treat it

`docs/handoff/01-CONVEX-MIGRATION.md` states the night settles to:

> Burkert **+$8**, Burton **+$7**, Kinsey **−$3**, Marley **−$5**, Spencer **−$7**

That sums to zero. It was re-derived from the fixture on 2026-08-12 and matched.

**Do not read those numbers before you compute.** Cover them. They are the
answer key, and the point of this exercise is an independent second derivation —
if you anchor on the key you will find the arithmetic that produces it. Compute
first, then compare against both the app *and* the published figures. Three-way
agreement is the result worth having; if the app and the doc agree but you do
not, say so loudly rather than assuming you are wrong.

## Where to compare against

The app exposes the night settlement at `convex/stats.ts:nights`, and per-player
aggregates at `convex/stats.ts:leaderboard`. Compare against **both** the query
output and what the Leaderboard and History screens actually render — a query
can be right while the screen formats it wrong, and the screen is what the
owner settles up from.

Check the rendering specifically for:

- Money formatted via `formatCents` — is `−$3` shown as a negative, or as `$-3`,
  or as `$3` with a lost sign? A dropped minus sign on a settlement screen is an
  **S1**.
- Rounding. Cents that do not divide evenly must still sum to zero on screen.
- "—" versus "0" for the unrecorded round points and twenties.

## Severity

| Severity | Meaning |
|---|---|
| **S1** | Any money figure differs; a settlement does not sum to zero; unrecorded data displays as 0; a sign is dropped |
| **S2** | A win/loss/match-point count differs |
| **S3** | Formatting, rounding, or night-boundary disagreement |
| **S4** | Cosmetic |

## Deliverable

1. `docs/qa/findings/I/hand-computed.md` — your independent numbers, written
   before you looked at the app.
2. A report with a per-field comparison table: your value, the query's value,
   the screen's value, and the verdict. Every row, including the ones that
   match — a reconciliation that lists only mismatches cannot be audited.
3. An explicit statement of the order you did things in.

**Do not fix anything.** If you find a mismatch, the value of your report is
that it was found by something that did not also write the code. Report the
minimal reproduction and stop.
