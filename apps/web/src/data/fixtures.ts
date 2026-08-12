/**
 * Fixtures.
 *
 * §6.2 has Wave 1's UI agent working against fixtures rather than a live Convex
 * deployment, which is what lets backend and frontend proceed independently —
 * and what let this UI be built before `convex dev` had ever run.
 *
 * Names are placeholders drawn from the plan's own examples. Rename them once
 * real players exist; nothing here is load-bearing.
 */

import {
  configFor,
  type Bet,
  type GameWithRounds,
  type RingCounts,
  type Round,
} from "@crokinole/core";

export interface Player {
  id: string;
  displayName: string;
  shortName: string;
  isActive: boolean;
}

export const PLAYERS: Player[] = [
  { id: "p-mike", displayName: "Mike", shortName: "Mike", isActive: true },
  { id: "p-dave", displayName: "Dave", shortName: "Dave", isActive: true },
  { id: "p-steve", displayName: "Steve", shortName: "Steve", isActive: true },
  { id: "p-john", displayName: "John", shortName: "John", isActive: true },
  { id: "p-anna", displayName: "Anna", shortName: "Anna", isActive: true },
  { id: "p-priya", displayName: "Priya", shortName: "Priya", isActive: true },
  { id: "p-tom", displayName: "Tom", shortName: "Tom", isActive: true },
  { id: "p-ruth", displayName: "Ruth", shortName: "Ruth", isActive: true },
];

function counts(twenties: number, fifteens: number, tens: number, fives: number): RingCounts {
  return { twenties, fifteens, tens, fives };
}

function round(index: number, a: RingCounts, b: RingCounts): Round {
  return { index, A: a, B: b };
}

function bets(playerIds: string[], amountCents = 500): Bet[] {
  return playerIds.map((playerId) => ({ playerId, amountCents }));
}

interface GameSeed {
  id: string;
  playedAt: number;
  a: [string, string];
  b: [string, string];
  rounds: [RingCounts, RingCounts][];
  status?: "in_progress" | "final";
}

function buildGame(seed: GameSeed): GameWithRounds {
  const playerIds = [...seed.a, ...seed.b];
  return {
    id: seed.id,
    playedAt: seed.playedAt,
    status: seed.status ?? "final",
    config: configFor("doubles"),
    teams: {
      A: { color: "black", playerIds: [...seed.a] },
      B: { color: "white", playerIds: [...seed.b] },
    },
    bets: bets(playerIds),
    rounds: seed.rounds.map(([a, b], index) => round(index, a, b)),
  };
}

const night = (daysAgo: number, hour: number): number => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
};

/** Three nights of play. Enough to make every screen look real. */
export const GAMES: GameWithRounds[] = [
  buildGame({
    id: "g-1",
    playedAt: night(14, 19),
    a: ["p-mike", "p-dave"],
    b: ["p-steve", "p-john"],
    rounds: [
      [counts(2, 3, 1, 0), counts(1, 2, 2, 1)],
      [counts(1, 1, 3, 2), counts(3, 2, 1, 0)],
      [counts(3, 2, 2, 0), counts(1, 1, 1, 2)],
      [counts(2, 2, 1, 1), counts(2, 3, 0, 1)],
    ],
  }),
  buildGame({
    id: "g-2",
    playedAt: night(14, 20),
    a: ["p-mike", "p-steve"],
    b: ["p-dave", "p-john"],
    rounds: [
      [counts(1, 1, 2, 1), counts(2, 3, 1, 0)],
      [counts(0, 2, 3, 2), counts(3, 1, 2, 1)],
      [counts(2, 1, 1, 1), counts(2, 2, 2, 0)],
    ],
  }),
  buildGame({
    id: "g-3",
    playedAt: night(7, 19),
    a: ["p-anna", "p-priya"],
    b: ["p-tom", "p-ruth"],
    rounds: [
      [counts(3, 2, 1, 0), counts(1, 2, 1, 2)],
      [counts(2, 3, 0, 1), counts(2, 1, 3, 0)],
      [counts(1, 2, 2, 1), counts(1, 2, 2, 1)],
      [counts(3, 1, 2, 0), counts(0, 2, 2, 2)],
    ],
  }),
  buildGame({
    id: "g-4",
    playedAt: night(7, 20),
    a: ["p-mike", "p-anna"],
    b: ["p-john", "p-ruth"],
    rounds: [
      [counts(1, 3, 2, 0), counts(2, 2, 1, 1)],
      [counts(2, 2, 2, 0), counts(1, 1, 2, 2)],
      [counts(0, 2, 2, 2), counts(3, 2, 1, 0)],
      [counts(2, 2, 1, 1), counts(1, 3, 1, 1)],
      [counts(3, 1, 1, 1), counts(1, 1, 2, 2)],
    ],
  }),
  buildGame({
    id: "g-5",
    playedAt: night(2, 19),
    a: ["p-dave", "p-priya"],
    b: ["p-steve", "p-tom"],
    rounds: [
      [counts(2, 2, 2, 0), counts(2, 2, 1, 1)],
      [counts(1, 1, 2, 2), counts(3, 2, 1, 0)],
      [counts(3, 2, 1, 0), counts(1, 2, 2, 1)],
      [counts(2, 3, 1, 0), counts(2, 1, 2, 1)],
    ],
  }),
];

export const playerName = (id: string): string =>
  PLAYERS.find((player) => player.id === id)?.displayName ?? "Unknown";

export const playerShortName = (id: string): string =>
  PLAYERS.find((player) => player.id === id)?.shortName ?? "?";
