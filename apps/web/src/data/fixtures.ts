/**
 * Seed data — the real first night, 7 August 2026.
 *
 * Transcribed from the Discord recap. The five game results reconcile exactly
 * with the win tally posted alongside them (Kinsey 2, Marley 1, Spencer 1,
 * Burkert 3, Burton 3), which is what gives confidence the parse is right.
 *
 * ⚠️ **Round points were never recorded.** The recap carries only the final
 * match score per game ("6-0", "2-6", …) and its author noted they guessed at
 * the points. So each round here uses `pointsOverride` to record *who won it*
 * and nothing more — 1–0 for a win, 1–1 for a tie. Match points, standings and
 * settlements are therefore exact; anything derived from round POINTS (Pts+,
 * Pts/rd) is meaningless for this night and will look oddly low. That is
 * deliberate: inventing plausible ring counts would have made a fabrication
 * indistinguishable from a record.
 *
 * The round *pattern* is also reconstructed — a 6–0 can only be three straight
 * wins, and a 1–5 can only be a tie then two losses, but 2–6 could have been
 * either one win and three losses or a spread of ties. The simplest reading is
 * used.
 *
 * No emails: they'll be filled in from the admin screen. A player row without
 * one is exactly the case §3.6 exists for.
 */

import { configFor, type Bet, type GameWithRounds, type Round } from "@crokinole/core";

export interface Player {
  id: string;
  displayName: string;
  shortName: string;
  isActive: boolean;
}

export type Role = "admin" | "player";

/** Mirrors the `allowlist` table joined to `players` — see `convex/admin.ts`. */
export interface Member {
  email: string;
  role: Role;
  invitedAt: number;
  playerId: string | null;
  displayName: string | null;
  hasSignedIn: boolean;
}

export const PLAYERS: Player[] = [
  { id: "p-kinsey", displayName: "Kinsey", shortName: "Kinsey", isActive: true },
  { id: "p-marley", displayName: "Marley", shortName: "Marley", isActive: true },
  { id: "p-spencer", displayName: "Spencer", shortName: "Spencer", isActive: true },
  { id: "p-burkert", displayName: "Burkert", shortName: "Burkert", isActive: true },
  { id: "p-burton", displayName: "Burton", shortName: "Burton", isActive: true },
];

/**
 * In Convex this comes from the `SUPER_ADMIN_EMAIL` environment variable — not
 * hardcoded, because this repo is public (§2.0).
 */
export const SUPER_ADMIN_EMAIL = "owner@example.com";

export const MEMBERS: Member[] = [
  {
    email: SUPER_ADMIN_EMAIL,
    role: "admin",
    invitedAt: Date.UTC(2026, 7, 7),
    playerId: "p-burkert",
    displayName: "Burkert",
    hasSignedIn: true,
  },
];

/** 7 August 2026, the first night. */
const NIGHT = new Date(2026, 7, 7, 19, 0, 0).getTime();

type Outcome = "A" | "B" | "tie";

/**
 * Build the rounds for a known match score. Only the outcome is real — see the
 * warning at the top of this file.
 */
function roundsFor(outcomes: Outcome[]): Round[] {
  return outcomes.map((outcome, index) => ({
    index,
    A: { twenties: 0, fifteens: 0, tens: 0, fives: 0 },
    B: { twenties: 0, fifteens: 0, tens: 0, fives: 0 },
    pointsOverride: {
      A: outcome === "B" ? 0 : 1,
      B: outcome === "A" ? 0 : 1,
    },
  }));
}

interface Seed {
  id: string;
  minutesIn: number;
  a: [string, string];
  b: [string, string];
  outcomes: Outcome[];
  betCents: number;
}

/** Every game of the night, in order. The fifth player sat out each one. */
const SEEDS: Seed[] = [
  { id: "g-2608071", minutesIn: 0, a: ["p-kinsey", "p-burton"], b: ["p-spencer", "p-burkert"], outcomes: ["A", "A", "A"], betCents: 100 },
  { id: "g-2608072", minutesIn: 35, a: ["p-kinsey", "p-marley"], b: ["p-burton", "p-spencer"], outcomes: ["A", "B", "B", "B"], betCents: 200 },
  { id: "g-2608073", minutesIn: 70, a: ["p-kinsey", "p-burkert"], b: ["p-marley", "p-burton"], outcomes: ["A", "A", "A"], betCents: 100 },
  { id: "g-2608074", minutesIn: 105, a: ["p-kinsey", "p-spencer"], b: ["p-marley", "p-burkert"], outcomes: ["tie", "B", "B"], betCents: 300 },
  { id: "g-2608075", minutesIn: 140, a: ["p-spencer", "p-marley"], b: ["p-burton", "p-burkert"], outcomes: ["B", "B", "B"], betCents: 500 },
];

function bets(playerIds: string[], amountCents: number): Bet[] {
  return playerIds.map((playerId) => ({ playerId, amountCents }));
}

export const GAMES: GameWithRounds[] = SEEDS.map((seed) => ({
  id: seed.id,
  playedAt: NIGHT + seed.minutesIn * 60_000,
  status: "final",
  config: configFor("doubles"),
  teams: {
    A: { color: "black", playerIds: [...seed.a] },
    B: { color: "white", playerIds: [...seed.b] },
  },
  bets: bets([...seed.a, ...seed.b], seed.betCents),
  rounds: roundsFor(seed.outcomes),
}));

export const playerName = (id: string): string =>
  PLAYERS.find((player) => player.id === id)?.displayName ?? "Unknown";

export const playerShortName = (id: string): string =>
  PLAYERS.find((player) => player.id === id)?.shortName ?? "?";
