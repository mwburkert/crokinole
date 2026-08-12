# Wave 3 · Agent G — rules fuzzing

**Read-only QA. You report findings; you do not fix them.**
Written 2026-08-12, ready to fire once the Convex migration lands.

Separating find-from-fix is the entire point of this wave. An agent that can fix
its own findings will, when a test is inconvenient, quietly change the test. You
cannot. See `docs/plan/06-ORCHESTRATION.md` §6.3.

---

## Your job in one sentence

Find inputs where `packages/core` disagrees with the spec prose in
`docs/plan/03-PHASE-1.md` §3.1 and §3.4. Report them. Do not fix them.

## Scope

**In scope:** everything exported from `packages/core/src/index.ts`.
**Out of scope:** `apps/web`, `convex/`. If a bug you find is actually in a
caller rather than in core, say so and stop — do not go fix the caller.

## What you may and may not write

This is the one place where "read-only" needs a precise definition, because you
cannot property-test anything without writing a test.

- ✅ You **may create one new test file**, `packages/core/src/wave3-properties.test.ts`.
  This is deliberate: `vitest.config.ts` only discovers
  `packages/*/src/**/*.test.ts`, so a harness anywhere else — including under
  `docs/` — **will never run**. Creating that one new file is the only way to do
  this job.
- ✅ You **may** write findings to `docs/qa/findings/G/`.
- ✅ You **may** add `fast-check` as a devDependency **in your worktree only**,
  to run the harness.
- ❌ You **may not modify any existing file** under `packages/core/src/` —
  including the existing `*.test.ts` files. **If an existing test asserts
  something false, that is a finding, not a thing you fix.** Creating one new
  test file is permitted; changing a single line of an existing one is not.
- ❌ You **may not** modify `apps/web` or `convex/`.
- ❌ Your PR, if you open one, contains **findings and new tests only** — never a
  change to a rule.

## The invariants to attack

Generate random *legal* inputs and assert these. Legal means: non-negative
integers, `discsUsed(counts) <= discsPerTeam(cfg)`, and a config that is either
`configFor("doubles")` or `configFor("singles")`.

### Scoring — `scoring.ts`

1. `roundPoints` is monotone: moving one disc from a lower ring to a higher ring
   never decreases the total.
2. `roundPoints(counts, cfg) <= maxRoundPoints(cfg)` for every legal `counts`.
   Doubles caps at 240, singles at 160 — but assert against `maxRoundPoints`,
   never the literals (§3.2.3).
3. `scoreRound(a, b, cfg).differential === aPoints - bPoints`, and the sign of
   the differential agrees with `result`: positive ⇒ `"A"`, negative ⇒ `"B"`,
   zero ⇒ `"tie"`.
4. `matchPoints` sums to `matchPointsWin` on a decisive round and
   `2 × matchPointsTie` on a tie. Never anything else.
5. `scoreRound(a, b, cfg)` and `scoreRound(b, a, cfg)` are mirror images —
   swapping the teams negates the differential and swaps the match points.
6. `scoreRoundInput` agrees with `scoreRound` on the same underlying counts,
   **including** when `pointsOverride` or `resultOverride` is set. The override
   precedence rule is the interesting case: work out from the code what happens
   when both are set, then check whether the spec says the same thing. If the
   spec is silent, that is a **documentation finding** — report it, do not
   invent a rule.

### Game completion — `gameStanding`

7. ⚠️ **`docs/plan/03-PHASE-1.md` §3.8 contains a property test that is false.**
   It asks that match points never exceed `target + 1`. With ties and
   `winBy: 2`, a game can finish 7–5. §3.4's `winBy` subsection already records
   this correction. **Do not re-derive the false version.** The true invariants:
   - `isComplete` is true iff some team has `>= targetMatchPoints` **and** leads
     by `>= winBy`.
   - `winner` is set iff `isComplete`, and is the leading team.
   - **A completed game is never level.** This is the one that matters — money
     is involved. Search hard for a rounds sequence that completes with
     `matchPoints.A === matchPoints.B`. If you find one, it is the highest
     severity finding available in this brief.
   - Match points are non-decreasing as rounds are appended.
   - The 3-round minimum: no sequence of two rounds can complete a game at
     `targetMatchPoints: 5, matchPointsWin: 2, matchPointsTie: 1`.
8. `winBy: 1` gives first-past-the-target, and every game that completes under
   `winBy: 2` also completes under `winBy: 1` at the same round or earlier.

### Settlement — `settle.ts`

9. **A settlement always sums to zero.** Over any set of bets, any winner, any
   stake distribution. If `Math.round` in the proportional branch can make it
   sum to ±1 cent, that is a real finding — chase it deliberately with stakes
   that do not divide evenly (three winners at $3.33, unequal doubles stakes,
   a 1-cent bet).
10. Equal stakes reduce to the even split: four equal bets ⇒ each winner `+stake`
    and each loser `−stake` exactly.
11. A player who did not bet appears nowhere in the settlement, and every player
    who did bet appears exactly once.
12. `settle` on an incomplete game — decide from the code what it does, then
    check the spec. Throwing and returning empty are both defensible; silently
    settling an unfinished game is not.

### Discs — `discs.ts`

13. `countsFromDiscs(discs, colour)` never reports more discs than were placed
    for that colour.
14. `regionAt` is total over the board: every point either maps to a region or
    to `null` (the ditch), never to an exception.
15. `snapIntoRegion(x, y, region)` produces a point for which
    `regionAt` returns that same region. Round-trip it. Boundary points are the
    interesting inputs — a disc scores **the lowest value of any region it
    touches** (§3.1), so check the code implements *touching*, using
    `DISC_RADIUS`, and not merely centre-containment. Getting this wrong is
    invisible in normal play and wrong in exactly the cases people argue about.
16. `placementComplete(discs, perTeam)` agrees with `placedCount` for both
    colours.

### Nights — `night.ts`

17. `nightKey` has a 3am reset (`NIGHT_RESET_HOUR`). 11pm Tuesday and 1am
    Wednesday are the same night; 4am Wednesday is not. Fuzz across DST
    boundaries and across timezones — this uses local-time `Date` methods, so a
    machine in a different timezone gets different answers. Whether that is a
    bug depends on intent; report what it does.
18. `gamesOnNight(games, nightKey(t))` contains every non-deleted game whose
    `playedAt` is `t`, and `nightBounds` agrees with `nightKey` — every
    timestamp in the bounds maps back to that key.

### Validation — `validate.ts`

19. Every `IssueCode` is reachable. Construct an input that triggers each of the
    eleven. A code no input can produce is dead validation and a finding.
20. `isValid(x) === errorsOnly(validate...(x)).length === 0`, for both
    `validateRound` and `validateGame`.
21. A round that passes `validateRound` never causes `scoreRound` to throw.

### Aggregation — `stats.ts`

22. `aggregateStats` over a set of games: games played = won + lost + drawn, and
    every player's `netCents` equals the sum of their per-game settlements
    (`netCentsFor`). Cross-check the two independent paths against each other.
23. Soft-deleted games (`deletedAt` set) are excluded from every aggregate.
    Fuzz this specifically — §3.2.4 makes soft delete the only delete, so a fold
    that forgets the filter silently rewrites history and the money.

## The rules you must not break while testing

- **Never hardcode `15`, `2`, `5`, `12`, `20`, `240` or `160`.** Derive from the
  config via `discsPerTeam`, `maxRoundPoints`, `playersPerTeam` (§3.2.3). A
  property test with a magic number in it will pass on the default config and
  miss every singles bug.
- Use `configFor("doubles")` and `configFor("singles")` as your two config
  generators, plus randomised configs for anything that claims to be
  config-independent.
- `packages/core/src/testing.ts` already exists — read it before building
  generators, and reuse what is there.

## Severity, so the report is triageable

| Severity | Meaning |
|---|---|
| **S1** | Money is wrong, or a game can complete level, or a soft-deleted game affects a total |
| **S2** | A scoring or completion rule disagrees with §3.1/§3.4 prose |
| **S3** | Spec is silent or ambiguous — code may be right, the doc is underspecified |
| **S4** | Dead code, unreachable validation, cosmetic |

## Deliverable

A single report containing, per finding: severity, the exact minimal
counterexample input (seed plus the shrunk case), what the spec says, what the
code does, and the file:line. Order by severity.

**If you find nothing, say so plainly and say what you tried** — including which
invariants you could not express and why. "No findings" from a fuzzing agent is
only credible with the coverage attached. An honest "I could not generate legal
singles boards with unequal stakes" is worth more than a confident all-clear.

Do not open a PR that changes a rule. If the harness itself is worth keeping,
propose it as a separate PR containing only
`packages/core/src/wave3-properties.test.ts` and the `fast-check` devDependency.

⚠️ Note that `packages/core` has coverage thresholds enforced in `npm test`.
Adding a test file that exercises new branches can move coverage numbers; if CI
goes red on thresholds rather than on a failing assertion, that is a CI
configuration matter — **report it, do not adjust the thresholds.**
