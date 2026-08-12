/**
 * The money for the first night, asserted independently of the code that
 * produces it.
 *
 * The expected figures come from the handoff, which got them from the night
 * itself — not from running this code and writing down what it said. That's the
 * whole value of the test: if a scoring or settlement rule ever drifts, this is
 * the row of numbers five people would argue about.
 */

import { aggregateStats, settle, validateGame, errorsOnly } from "@crokinole/core";
import { describe, expect, it } from "vitest";

import { FIRST_NIGHT_GAMES, FIRST_NIGHT_PLAYERS, firstNightAsCoreGames } from "./firstNight";

/** Handoff: Burkert +$8, Burton +$7, Kinsey −$3, Marley −$5, Spencer −$7. */
const EXPECTED_NET_CENTS: Record<string, number> = {
  burkert: 800,
  burton: 700,
  kinsey: -300,
  marley: -500,
  spencer: -700,
};

/** Posted alongside the recap, and what confirms the parse. */
const EXPECTED_WINS: Record<string, number> = {
  kinsey: 2,
  marley: 1,
  spencer: 1,
  burkert: 3,
  burton: 3,
};

function netByPlayer(): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const game of firstNightAsCoreGames()) {
    for (const entry of settle(game)) {
      totals[entry.playerId] = (totals[entry.playerId] ?? 0) + entry.netCents;
    }
  }
  return totals;
}

describe("the first night, 5 August 2026", () => {
  it("has five players and five games", () => {
    expect(FIRST_NIGHT_PLAYERS).toHaveLength(5);
    expect(FIRST_NIGHT_GAMES).toHaveLength(5);
  });

  it("settles to the figures the night actually produced", () => {
    expect(netByPlayer()).toEqual(EXPECTED_NET_CENTS);
  });

  it("settles to zero — money moves between players, it is never created", () => {
    const total = Object.values(netByPlayer()).reduce((sum, cents) => sum + cents, 0);
    expect(total).toBe(0);
  });

  it("matches the win tally posted with the recap", () => {
    const rows = aggregateStats(firstNightAsCoreGames(), {});
    const wins = Object.fromEntries(rows.map((row) => [row.playerId, row.gamesWon]));
    expect(wins).toEqual(EXPECTED_WINS);
  });

  it("records no points at all — the recap never had them", () => {
    const rows = aggregateStats(firstNightAsCoreGames(), {});
    for (const row of rows) {
      expect(row.roundPointsFor).toBe(0);
      expect(row.roundPointsAgainst).toBe(0);
      // The load-bearing one: zero *scored* rounds, not rounds that scored
      // zero. Anything above 0 here means someone invented a points total.
      expect(row.roundsScored).toBe(0);
    }
  });

  it("is internally consistent — every game passes validation", () => {
    for (const game of firstNightAsCoreGames()) {
      expect(errorsOnly(validateGame(game))).toEqual([]);
    }
  });

  it("has every player in the night", () => {
    const slugs = new Set(FIRST_NIGHT_PLAYERS.map((player) => player.slug));
    for (const game of FIRST_NIGHT_GAMES) {
      for (const slug of [...game.a, ...game.b]) {
        expect(slugs.has(slug)).toBe(true);
      }
    }
  });
});
