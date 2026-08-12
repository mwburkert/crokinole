/**
 * Test helpers. Exported from the package (not just the test files) so the
 * fixtures in `apps/web` can build realistic games without duplicating this.
 */

import { configFor } from "./scoring.js";
import type {
  Format,
  GameWithRounds,
  RingCounts,
  Round,
  ScoringConfig,
} from "./types.js";

/** A tiny deterministic PRNG, so property tests reproduce exactly on failure. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

export function counts(
  twenties: number,
  fifteens: number,
  tens: number,
  fives: number,
): RingCounts {
  return { twenties, fifteens, tens, fives };
}

/** A legal random ring count for one side, never exceeding the disc budget. */
export function randomCounts(random: () => number, discBudget: number): RingCounts {
  let left = Math.floor(random() * (discBudget + 1));
  const take = (): number => {
    const n = Math.floor(random() * (left + 1));
    left -= n;
    return n;
  };
  return counts(take(), take(), take(), left > 0 && random() < 0.5 ? take() : 0);
}

export interface BuildGameOptions {
  id?: string;
  playedAt?: number;
  format?: Format;
  playerIds?: string[];
  betCents?: number | number[];
  rounds?: Pick<Round, "A" | "B">[];
  status?: GameWithRounds["status"];
  config?: ScoringConfig;
  deletedAt?: number;
}

/**
 * Build a well-formed game. Defaults to doubles between p1+p2 and p3+p4 with
 * $5 bets all round, which is the shape almost every test wants.
 */
export function buildGame(options: BuildGameOptions = {}): GameWithRounds {
  const config = options.config ?? configFor(options.format ?? "doubles");
  const singles = config.format === "singles";
  const players = options.playerIds ?? (singles ? ["p1", "p3"] : ["p1", "p2", "p3", "p4"]);
  const half = singles ? 1 : 2;

  const defaultStake = typeof options.betCents === "number" ? options.betCents : 500;
  const stakes = Array.isArray(options.betCents)
    ? options.betCents
    : players.map(() => defaultStake);

  return {
    id: options.id ?? "g1",
    playedAt: options.playedAt ?? Date.UTC(2026, 7, 12, 19, 0, 0),
    status: options.status ?? "final",
    config,
    teams: {
      A: { color: "black", playerIds: players.slice(0, half) },
      B: { color: "white", playerIds: players.slice(half) },
    },
    bets: players.map((playerId, index) => ({
      playerId,
      amountCents: stakes[index] ?? 500,
    })),
    rounds: (options.rounds ?? []).map((round, index) => ({ ...round, index })),
    ...(options.deletedAt !== undefined ? { deletedAt: options.deletedAt } : {}),
  };
}

/** A round where A scores `aPoints` worth of fives and B scores `bPoints`. */
export function roundOfFives(aFives: number, bFives: number): Pick<Round, "A" | "B"> {
  return { A: counts(0, 0, 0, aFives), B: counts(0, 0, 0, bFives) };
}

/** The shortest possible finished game: A wins 2 + 2, then ties for 5. */
export function shortestGame(): Pick<Round, "A" | "B">[] {
  return [roundOfFives(2, 1), roundOfFives(2, 1), roundOfFives(1, 1)];
}
