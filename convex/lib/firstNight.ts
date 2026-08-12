/**
 * The real first night — Wednesday 5 August 2026.
 *
 * Transcribed from the Discord recap. The five game results reconcile exactly
 * with the win tally posted alongside them (Kinsey 2, Marley 1, Spencer 1,
 * Burkert 3, Burton 3), which is what gives confidence the parse is right.
 *
 * ⚠️ **Round points were never recorded.** The recap carries only the final
 * match score per game ("6-0", "2-6", …) and its author noted they guessed at
 * the points. Each round therefore uses `resultOverride` — who took it, and no
 * claim at all about points. Match points, standings and settlements are exact;
 * Pts+ and Pts/rd correctly report this night as having no data rather than as
 * zero. **Never invent points here.** A 0–0 or a 1–0 would be a number nobody
 * scored, and it would drag every points-per-round average toward it forever.
 *
 * The round *pattern* is also reconstructed — a 6–0 can only be three straight
 * wins, and a 1–5 can only be a tie then two losses, but 2–6 could have been
 * either one win and three losses or a spread of ties. The simplest reading is
 * used.
 *
 * No emails: they'll be filled in from the settings screen. A player row
 * without one is exactly the case §3.6 exists for.
 *
 * Pure data — no Convex imports — so `firstNight.test.ts` can check the money
 * without a deployment, and so `seed.ts` is the only thing that knows about the
 * database. Players are referenced by slug; the seed maps slugs to real ids.
 */

import { configFor, type Bet, type GameWithRounds, type Round, type RoundResult } from "@crokinole/core";

export interface SeedPlayer {
  slug: string;
  displayName: string;
  shortName: string;
}

export const FIRST_NIGHT_PLAYERS: SeedPlayer[] = [
  { slug: "kinsey", displayName: "Kinsey", shortName: "Kinsey" },
  { slug: "marley", displayName: "Marley", shortName: "Marley" },
  { slug: "spencer", displayName: "Spencer", shortName: "Spencer" },
  { slug: "burkert", displayName: "Burkert", shortName: "Burkert" },
  { slug: "burton", displayName: "Burton", shortName: "Burton" },
];

/**
 * The Discord recap is stamped 8/7 — that's when it was *posted*, on the Friday
 * morning after. The games were the Wednesday.
 *
 * Built in UTC so the seeded timestamps don't shift with the machine that runs
 * the seed. 19:00 local on the east coast is 23:00 UTC; the exact minute is
 * only used for ordering within the night.
 */
const NIGHT = Date.UTC(2026, 7, 5, 23, 0, 0);

export interface SeedGame {
  slug: string;
  minutesIn: number;
  a: [string, string];
  b: [string, string];
  /** Who took each round. Outcome only — see the warning above. */
  outcomes: RoundResult[];
  betCents: number;
}

/** Every game of the night, in order. The fifth player sat out each one. */
export const FIRST_NIGHT_GAMES: SeedGame[] = [
  {
    slug: "g-2608071",
    minutesIn: 0,
    a: ["kinsey", "burton"],
    b: ["spencer", "burkert"],
    outcomes: ["A", "A", "A"],
    betCents: 100,
  },
  {
    slug: "g-2608072",
    minutesIn: 35,
    a: ["kinsey", "marley"],
    b: ["burton", "spencer"],
    outcomes: ["A", "B", "B", "B"],
    betCents: 200,
  },
  {
    slug: "g-2608073",
    minutesIn: 70,
    a: ["kinsey", "burkert"],
    b: ["marley", "burton"],
    outcomes: ["A", "A", "A"],
    betCents: 100,
  },
  {
    slug: "g-2608074",
    minutesIn: 105,
    a: ["kinsey", "spencer"],
    b: ["marley", "burkert"],
    outcomes: ["tie", "B", "B"],
    betCents: 300,
  },
  {
    slug: "g-2608075",
    minutesIn: 140,
    a: ["spencer", "marley"],
    b: ["burton", "burkert"],
    outcomes: ["B", "B", "B"],
    betCents: 500,
  },
];

/** When each game was played. */
export function playedAt(game: SeedGame): number {
  return NIGHT + game.minutesIn * 60_000;
}

/**
 * Rounds for a known match score. Only the outcome is real; the ring counts are
 * all zero *and flagged as unrecorded* by `resultOverride`, which is what keeps
 * them out of every points average.
 */
export function roundsFor(outcomes: RoundResult[]): Round[] {
  return outcomes.map((outcome, index) => ({
    index,
    A: { twenties: 0, fifteens: 0, tens: 0, fives: 0 },
    B: { twenties: 0, fifteens: 0, tens: 0, fives: 0 },
    resultOverride: outcome,
  }));
}

function bets(playerIds: string[], amountCents: number): Bet[] {
  return playerIds.map((playerId) => ({ playerId, amountCents }));
}

/**
 * The night as `@crokinole/core` shapes, keyed by player slug.
 *
 * Used by the reconciliation test. `seed.ts` builds the same games against real
 * Convex ids from the same table, so there is one source for the numbers.
 */
export function firstNightAsCoreGames(): GameWithRounds[] {
  return FIRST_NIGHT_GAMES.map((game) => ({
    id: game.slug,
    playedAt: playedAt(game),
    status: "final" as const,
    config: configFor("doubles"),
    teams: {
      A: { color: "black" as const, playerIds: [...game.a] },
      B: { color: "white" as const, playerIds: [...game.b] },
    },
    bets: bets([...game.a, ...game.b], game.betCents),
    rounds: roundsFor(game.outcomes),
  }));
}
