# Section 3 — Phase 1: Build Now

**Goal:** by the end of this phase, on any phone, you can record a night of crokinole in under
a minute per game, see full history, see lifetime stats, and settle up the money. **The whole app
is behind auth — there is no public route** (revised 2026-08-12, see §3.5).

**Stack (locked):** Convex + React/Vite PWA + a pure-TS `packages/core` rules package,
npm workspaces. Matches `oh-heck-chaos-monkey` so patterns transfer between your projects.

---

## 3.1 Terminology corrections (adopt these in code)

Research against NCA/tournament sources turned up three naming issues in the original spec.
Using the real terms costs nothing now and avoids a rename later.

| You said | Correct term | Note |
|---|---|---|
| "crokinoles" | **twenties** ("a twenty", "scoring a 20") | *Crokinole* is the game, never the shot. Leagues track **20s per player** as a headline stat, so this field is standard, not exotic. |
| "whiffs" | **fouls** (or "no-contact") | See below — the real rule is stricter than you described. |
| round | **round** (a.k.a. "end") | Either is fine; "round" is used throughout this plan. |

**The foul rule, precisely.** If *any* opponent disc is on the surface, your shot must contact
an opponent disc — directly **or indirectly** (off your own disc or a peg). If it doesn't: the
shot disc **and any of your own discs that moved** are removed to the ditch. Opponent discs
**stay where they came to rest**. A 20 sunk on a foul does not count. If the board is empty of
opponent discs, the shot must finish in or touching the 15 circle or it's removed.

This matters for Phase 2 stat tracking: a foul is not just "missed everything" — it's a
scoring event with board consequences. The field name should be `fouls`.

Other confirmed rules, encoded as-is: **a disc scores the lowest value of any region it
touches** (your line rule is standard ✅), and rings are **20 / 15 / 10 / 5** with the 20 being
the hole, not a fourth ring (your model is exactly standard ✅).

### Formats — doubles and singles (confirmed against NCA rules)

| Format | Players | Discs per player | Discs per team | Max round points |
|---|---|---|---|---|
| **Doubles** (2v2) — primary | 4 | 6 | **12** | 240 |
| **Singles** (1v1) — supported | 2 | 8 | **8** | 160 |

3-player variants are **out of scope**; don't build for them.

Round scoring is identical in both: higher score takes **2 match points**, a tie gives **1
each** — your house rules match the NCA exactly.

**Supporting singles is cheap because of one schema choice**: `teams.A.playerIds` is an
*array*, so singles is simply a one-element team. What actually changes:

```ts
format: "doubles" | "singles",   // on the game config
discsPerPlayer: 6 | 8,           // 6 doubles, 8 singles
// discsPerTeam is DERIVED: discsPerPlayer × playersPerTeam
```

- **Validation** uses the derived `discsPerTeam` — no separate code path.
- **`settle()`** already generalises: in singles the winning "team" is one player who takes
  the whole 2-player pot.
- **Partner stats** (§4.2) apply to doubles only — filter singles games out of those folds
  rather than showing a partner of "nobody". Opponent stats work for both.
- **Entry screen** is unchanged: still two columns, black and white. Only the player picker
  differs (2 vs 4).

Do **not** hardcode 12 anywhere. Derive it, per §3.2.3.

---

## 3.2 Non-negotiable design principles

Carried over from the hard-won lessons in `oh-heck-chaos-monkey`, which apply verbatim here.

1. **Scores and stats are DERIVED, never stored.** Store only raw ring counts per team per
   round. Never add a `score` column. Every total, differential, match point, standing, and
   lifetime stat is computed on read. Volume is trivial (a few hundred games/year), so this
   costs nothing and eliminates the entire class of "the stored total disagrees with the rounds"
   bugs.
2. **Rules live only in `packages/core`** — pure TS, no React and no Convex imports. Never
   re-implement a scoring rule in a component or a Convex function; import it.
3. **`ScoringConfig` is snapshotted onto each game.** If you ever change the house rules, old
   games still score by the rules in force when they were played. Never hardcode `15`, `2`, or
   `5` anywhere outside `DEFAULT_SCORING`.
4. **Soft-delete only.** "Delete game" sets `deletedAt`. Money is involved; a mis-tap must be
   recoverable.
5. **Cloudflare Access does not protect Convex.** The browser talks directly to
   `*.convex.cloud` over WebSocket, bypassing the Cloudflare edge entirely. **Every mutation
   must check auth and the allowlist itself.** Treat the edge as convenience, never as the
   security boundary. (See §7.)

---

## 3.3 Data model (`convex/schema.ts`)

Fields marked _(P2)_ exist now so Phase 2 drops in without a migration, but aren't exercised yet.

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const ringCounts = v.object({
  twenties: v.number(),
  fifteens: v.number(),
  tens:     v.number(),
  fives:    v.number(),
});

export default defineSchema({
  // Canonical person. Owns all stats. Survives anonymous -> signed-in.
  players: defineTable({
    displayName: v.string(),
    shortName:   v.optional(v.string()),   // for tight mobile tables
    email:       v.optional(v.string()),
    authUserId:  v.optional(v.id("users")),
    isActive:    v.boolean(),              // hide retired regulars from pickers
    createdAt:   v.number(),
  })
    .index("by_auth",  ["authUserId"])
    .index("by_email", ["email"]),

  // Who may write. Checked inside every mutation.
  allowlist: defineTable({
    email:     v.string(),
    role:      v.union(v.literal("admin"), v.literal("player")),
    invitedAt: v.number(),
  }).index("by_email", ["email"]),

  games: defineTable({
    playedAt: v.number(),                  // the night it was played, not createdAt
    status:   v.union(v.literal("in_progress"), v.literal("final")),
    config:   v.object({                   // snapshot; see ScoringConfig
      format: v.union(v.literal("doubles"), v.literal("singles")),
      ringValues: v.object({ twenty: v.number(), fifteen: v.number(),
                             ten: v.number(),    five: v.number() }),
      matchPointsWin:  v.number(),         // 2
      matchPointsTie:  v.number(),         // 1
      targetMatchPoints: v.number(),       // 5
      discsPerPlayer:  v.number(),         // 6 doubles / 8 singles
    }),
    teams: v.object({
      A: v.object({ color: v.union(v.literal("black"), v.literal("white")),
                    playerIds: v.array(v.id("players")) }),
      B: v.object({ color: v.union(v.literal("black"), v.literal("white")),
                    playerIds: v.array(v.id("players")) }),
    }),
    bets: v.array(v.object({               // 4 entries, one per player
      playerId:    v.id("players"),
      amountCents: v.number(),
    })),
    defaultBetCents: v.optional(v.number()),  // drives the autofill
    notes:      v.optional(v.string()),
    createdBy:  v.id("players"),
    createdAt:  v.number(),
    updatedAt:  v.number(),
    deletedAt:  v.optional(v.number()),    // soft delete
  })
    .index("by_playedAt", ["playedAt"])
    .index("by_status",   ["status"]),

  rounds: defineTable({
    gameId: v.id("games"),
    index:  v.number(),                    // 0-based
    A: ringCounts,
    B: ringCounts,
    // Escape hatch for quick entry: if set, overrides the derived total.
    pointsOverride: v.optional(v.object({ A: v.optional(v.number()),
                                          B: v.optional(v.number()) })),
    playerStats: v.optional(v.array(v.object({
      playerId:  v.id("players"),
      twenties:  v.optional(v.number()),
      fouls:     v.optional(v.number()),   // (P2)
      spencers:  v.optional(v.number()),   // (P2)
      kinseys:   v.optional(v.number()),   // (P2)
    }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_game", ["gameId", "index"]),

  // Append-only audit. Money is involved; know who changed what.
  gameEvents: defineTable({
    gameId:  v.id("games"),
    actorPlayerId: v.id("players"),
    kind:    v.string(),                   // "created" | "roundEdited" | "deleted" | ...
    summary: v.string(),
    at:      v.number(),
  }).index("by_game", ["gameId"]),
});
```

**Why counts and not totals.** Entering `{twenties: 1, fifteens: 2, tens: 1}` instead of `60`
takes the same number of taps in a good UI and unlocks every Phase 2 stat (average points per
round, 20s leaderboards, ring distribution) for free. `pointsOverride` exists for the night
someone just wants to log the number and move on.

**Validation the counts buy you** (implement in `packages/core`, enforce in the mutation):
- `twenties + fifteens + tens + fives ≤ discsPerTeam(config)` — 12 doubles, 8 singles
- `sum(playerStats[].twenties for team) === team.twenties` — catches transcription errors
- a completed game's match points must actually reach `targetMatchPoints`
- team sizes match `config.format` (2 players each for doubles, 1 each for singles)

---

## 3.4 `packages/core` — the rules engine

Pure TS. No dependencies. Built and unit-tested **first**, before any UI exists.

```ts
export interface RingCounts { twenties: number; fifteens: number; tens: number; fives: number }
export type TeamKey = "A" | "B";
export type RoundResult = TeamKey | "tie";

export const DEFAULT_SCORING: ScoringConfig = {
  format: "doubles",
  ringValues: { twenty: 20, fifteen: 15, ten: 10, five: 5 },
  matchPointsWin: 2,
  matchPointsTie: 1,
  targetMatchPoints: 5,
  winBy: 2,                   // added 2026-08-12 — see below
  discsPerPlayer: 6,          // 8 when format === "singles"
};

/** Derived, never stored. doubles: 6×2=12. singles: 8×1=8. */
export function discsPerTeam(cfg: ScoringConfig): number {
  return cfg.discsPerPlayer * (cfg.format === "doubles" ? 2 : 1);
}

/** Raw round points for one team. */
export function roundPoints(c: RingCounts, cfg: ScoringConfig): number;

/** Both teams' points, the differential, who won, and match points awarded. */
export function scoreRound(a: RingCounts, b: RingCounts, cfg: ScoringConfig): {
  aPoints: number; bPoints: number;
  differential: number;          // aPoints - bPoints
  result: RoundResult;
  matchPoints: Record<TeamKey, number>;
};

/** Running standing across all rounds; tells you when the game is over. */
export function gameStanding(rounds: RoundInput[], cfg: ScoringConfig): {
  matchPoints: Record<TeamKey, number>;
  roundPointsFor: Record<TeamKey, number>;
  isComplete: boolean;
  winner?: TeamKey;
};

/** Money settlement. See Q3. */
export function settle(game: Game): Array<{ playerId: string; netCents: number }>;

/** Lifetime / filtered stats, derived by folding over games. */
export function aggregateStats(games: Game[], rounds: RoundsByGame, cfg): PlayerStats[];
```

**Game-length sanity check:** to 5 match points at 2/win and 1/tie, a game is **3 rounds
minimum** (2+2+1 = 5, or 2+2+2 = 6). Encoded as a test.

### `winBy` — added 2026-08-12

A game is complete when a side reaches `targetMatchPoints` **and leads by at least `winBy`**.
Default **2**: 5–3 ends it, 5–4 keeps playing. `winBy: 1` gives first-past-the-target.

Two things this settles:

- **A game can never end level.** At 4–4 a tied round takes both sides to 5; under the original
  "first to 5" reading that would declare both teams winners, which is nonsense with money on
  the table.
- **§3.8's proposed property test is wrong** and was replaced. It asked that match points never
  exceed `target+1`; with ties and a margin requirement a game can finish 7–5 or beyond.

> ⚠️ **This is a house rule, not an NCA rule.** Searching turned up that NCA regular play is a
> **fixed four rounds per game** rather than a race to a target — the primary rules page 404s
> and Tracey Boards 403s, so treat that as one search-summary source, unverified. "Win by two"
> appears in NCA material only as a tiebreaker format. Both `targetMatchPoints` and `winBy` are
> therefore yours to set, which is exactly why they're config rather than constants.

### Settlement — confirmed rule

**Everyone pays in; the winning team splits the pot.**

```ts
export function settle(game: Game): Array<{ playerId: string; netCents: number }> {
  const pot = sum(game.bets.map(b => b.amountCents));
  const winners = playersOnTeam(game, winningTeam(game));
  const winnerStakeTotal = sum(winners.map(stakeOf));
  return game.bets.map(({ playerId, amountCents }) => ({
    playerId,
    netCents: isWinner(playerId)
      // proportional share — reduces to an even split when stakes are equal
      ? Math.round(pot * (amountCents / winnerStakeTotal)) - amountCents
      : -amountCents,
  }));
}
```

**The normal case (all four bet $5):** pot = $20, each winner receives $10 — their own $5 back
plus $5 of winnings — so each winner is **+$5** and each loser **−$5**.

> ⚠️ **Worth a one-word confirmation.** Your description said winners "win 10 each" and losers
> "lose 10 each." Both can't be true at once: four $5 buy-ins make a $20 pot, so $10 each to
> two winners is the whole pot, and the losers are down only their $5 stake. The code above is
> the mechanism you described (*pay in, winners split*), giving **net ±$5**. If you meant **net
> ±$10** — i.e. each player pays $5 to *each* of the two opponents rather than into one pot —
> that's a different rule and a one-line change here.

**On unequal bets.** Splitting the pot *evenly* would punish the bigger bettor: with stakes of
$10/$5 vs $5/$5, an even split hands both winners $12.50, so the $10 bettor nets only +$2.50
while their partner nets +$7.50. The **proportional** share above pays out in line with what
each player risked ($16.67 / $8.33 → +$6.67 / +$3.33) and is mathematically identical to an
even split whenever the stakes match — which is your usual case anyway.

Keep this isolated in `settle()`. It's the one rule most likely to be revised after a real
night of use.

---

## 3.5 Screens

Phone-first, portrait, one-handed. Five routes.

| Route | Auth | What it does |
|---|---|---|
| `/` | 🔒 | **Leaderboard.** Standings — records, stats, and earnings. |
| `/games` | 🔒 | **History.** Date, teams/partners, final score, bet, winner. Tap to edit. |
| `/games/new` | 🔒 | **Entry.** The screen that has to be fast. |
| `/games/:id` | 🔒 | Detail + round-by-round + edit + soft-delete. |
| `/stats` | 🔒 | Per-player lifetime stats, including earnings. |

### The whole app is gated — decided 2026-08-12

The original plan made `/` a public leaderboard. **It is now behind auth like everything else.**
That deletes work rather than adding it:

- **The two-query split is gone.** `publicLeaderboard` (no identity) and `fullStats`
  (allowlisted) collapse into **one authenticated query**. The "enforce money in the query layer,
  not the UI" rule was only load-bearing because anonymous readers existed; there is now no
  audience to leak to, so earnings can simply be part of the one stats query.
- **Q6 is moot.** Records-vs-money and public-vs-private are the same audience now.
- **§7.4's SPA caveat disappears.** Path-based Access policies can't gate `/admin/*` reliably,
  because client-side navigation makes no HTTP request. With the **whole hostname** gated there
  is no path policy to defeat, and `/admin/token` can live anywhere.
- **The egress blow-up vector is gone.** Anonymous spectators holding reactive subscriptions were
  the only unbounded-audience surface. Usage can now only grow when you deliberately add someone
  to the `Crokinole Players` Access Group.

**What it costs:** you can't show the app to anyone who isn't on the allowlist. That's ~30 seconds
in the Zero Trust dashboard. Carving a public route back out later is easy; the reverse isn't.

**Still non-negotiable:** every query and mutation calls `assertAllowlisted(ctx)`. Convex is a
public internet endpoint regardless of what Cloudflare does (§3.2.5), and the check now also
validates that the token's **AUD matches this app** (§7.1). QA agent H's checklist (§6.3) becomes
simpler but no less important: confirm that **no** query serves data without identity.

### The entry screen — the one that matters

This is used standing next to a board, one-handed, possibly with a beer. Everything else can
be mediocre; this can't.

1. **Setup (once per game).** Date defaults to today. A **Doubles/Singles** toggle — labelled
   just that, since nobody needs reminding how many discs they get — sets `discsPerPlayer` and
   how many seats appear.

   **Built 2026-08-12 as a board with a seat on each side**, rather than the chip-picker this
   section originally described. **Partners sit across from each other**, so top+bottom is one
   team and left+right the other, and the seating picture carries the whole team structure. That
   removes both "swap sides" and "swap partners" — changing a partner is just picking a different
   name in a seat. "Flip colours" stays, because which side plays black is a real choice the
   layout can't express. Singles collapses to two seats, top and bottom.

   Bet is a single field titled **Bet** with a `$` prefix, **defaulting to $1**, autofilling
   every player.
2. **Round entry.** Two columns, black and white. Each has four steppers: `20 / 15 / 10 / 5`.
   Big `+` targets, tap-and-hold to decrement. Live under each column: that team's round total.
   Between them, in the largest type on screen: **the differential** and who's winning it.
3. **Round commit.** One button. It shows the match-point award it's about to apply
   (`Black +2`). Running match score is pinned to the top of the screen at all times.
4. **Twenties (optional).** A collapsed row per team; expanding shows a stepper per player.
   Auto-validates against the team's `twenties` count and flags a mismatch inline rather than
   blocking.
5. **Auto-finish.** When a team reaches 5, the game flips to `final`, shows the settlement
   ("Mike +$5, Dave +$5, Steve −$5, John −$5"), and offers **"Start next game, same four"** —
   because you'll play five in a night and re-picking players each time is the main friction.

**Undo** must be reachable from the round entry screen. The most common real error is
committing a round with a mis-tapped count.

### Stats (Phase 1 scope only)

Per player: games played, won, lost, win %, match points for, match points against, and net
earnings. One sortable table, one query — the whole app is behind auth, so there is no
public/private field split to maintain.

Partner-based stats are Phase 2, and when they arrive they must **exclude singles games** —
a 1v1 game has no partner. The richer stats need no migration, because the model stores counts.

---

## 3.6 Auth

**Decision changed by the platform research — see §7.1.** Rather than a standalone Convex Auth
magic-link, crokinole uses the **Cloudflare Access JWT as its Convex auth provider**. This
gives one login across all three of your apps and one allowlist to maintain, at no cost.

```ts
// convex/auth.config.ts
export default {
  providers: [{
    type: "customJwt",
    issuer: "https://<team>.cloudflareaccess.com",
    jwks:   "https://<team>.cloudflareaccess.com/cdn-cgi/access/certs",
    applicationID: "<AUD tag>",
    algorithm: "RS256",
  }],
};
```

- `applicationID` must be **crokinole's own AUD tag**. There are three Access applications, one
  per app, precisely so this check distinguishes them (§7.1). A single multi-domain application
  would share one AUD and make per-app allowlists meaningless.
- The `CF_Authorization` cookie is HttpOnly, so a small Pages Function at `/admin/token` echoes
  `cf-access-jwt-assertion`; feed it to `convex.setAuth(fetchToken)` and re-fetch on
  `forceRefreshToken` (default session 24h). The whole hostname is gated, so this path needs no
  special treatment.
- **Every query and mutation** begins with `assertAllowlisted(ctx)`: `ctx.auth.getUserIdentity()`
  — which fails unless signature, issuer, **and AUD** all check out — then resolves `.email` to a
  `players` row. Non-negotiable, per §3.2.5: this is the *only* thing protecting your data.
- **No query serves data without identity.** There is no public route in Phase 1.
- Membership lives in the **`Crokinole Players` Access Group**, not in a second email list here.
  The `players` row establishes who someone is; `allowlist.role` decides what they may do.

**This couples Phase 1 to §7.** The platform setup is ~2 hours and $14.20, so do it first. If
you'd rather start coding immediately, keep `assertAllowlisted` as the single seam and stub it
in dev — but do not ship without it.

**Players ≠ users.** A `players` row can exist with no `authUserId` at all, so you can log a
game for someone who has never opened the app. This is essential — you'll be entering scores
for everyone at first. Link the account later by setting `authUserId` on the same row; history
is preserved with zero migration.

---

## 3.7 PWA / any device

- `vite-plugin-pwa`, installable, "Add to Home Screen" on iPhone. No App Store.
- Cache the app shell so a cold open on bad wifi still renders.
- **⚠️ Exclude `/cdn-cgi/*` and auth navigations from service-worker caching.** A service
  worker that intercepts Cloudflare Access's 302 to `*.cloudflareaccess.com` breaks offline
  mode and update checks. Do this from the start; it's miserable to debug later (§7.4).
- **Phase 1 requires connectivity to write.** Convex gives optimistic updates, so entry feels
  instant, but a genuinely offline write queue is Phase 2.
  > ⚠️ **Q4:** is the wifi where you play actually reliable? If it isn't, offline entry moves
  > from Phase 2 to Phase 1, because a scorekeeper that fails in the garage is worthless.

---

## 3.8 Task breakdown

Definitions of done are deliberately testable — they're what the QA agents in §5 check against.

| # | Task | Owner | DoD |
|---|---|---|---|
| **T0** | Repo scaffold: workspaces, TS strict, Vite, Convex init, CI green | solo | `npm ci && npm run typecheck && npm test` passes on a PR |
| **T1** | `packages/core`: types, `DEFAULT_SCORING`, `roundPoints`, `scoreRound`, `gameStanding`, `settle`, validators | agent A | 100% branch coverage on scoring; includes the 3-round-minimum test and a property test that match points never exceed target+1 |
| **T2** | `convex/schema.ts` + queries/mutations + `assertAllowlisted` | agent B | Schema deploys; a mutation called without auth throws; soft-delete hides from history but not from the DB |
| **T3** | App shell: routing, design tokens, layout, auth wiring | agent C | All five routes render behind correct auth; installable as a PWA |
| **T4** | Entry screen (§3.5) | agent D | A full 3-round game can be entered in under 60s on a phone; undo works |
| **T5** | History + game detail + edit + soft-delete | agent E | Edit a round → all derived totals and stats update with no stale reads |
| **T6** | Stats + leaderboard | agent F | Numbers reconcile with a hand-computed fixture; every query rejects an unauthenticated caller and one carrying another app's AUD |
| **T7** | Seed script + your real historical games | solo | Past games loaded, stats look right to you |

**T1 is the critical path and must land first** — T4, T5, and T6 all import it.

---

## 3.9 What Phase 1 deliberately does not include

Fields exist in the schema; UI does not. Do not build these now:

- fouls / spencers / kinseys entry UI (fields exist, §3.3)
- leaderboard filters by day/partner/bet
- per-week and per-month stat buckets
- best/worst partner and opponent analysis
- comments / message board
- anything camera-related
