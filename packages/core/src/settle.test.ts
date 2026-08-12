import { describe, expect, it } from "vitest";

import { formatCents, potCents, settle } from "./settle.js";
import { buildGame, makeRandom, roundOfFives, shortestGame } from "./testing.js";

const netFor = (settlements: { playerId: string; netCents: number }[], id: string): number =>
  settlements.find((entry) => entry.playerId === id)?.netCents ?? 0;

const sum = (settlements: { netCents: number }[]): number =>
  settlements.reduce((total, entry) => total + entry.netCents, 0);

describe("settle — the confirmed rule (Q3)", () => {
  it("pays winners +$5 and losers -$5 on four equal $5 bets", () => {
    const game = buildGame({ rounds: shortestGame() });
    const result = settle(game);

    expect(potCents(game.bets)).toBe(2000);
    expect(netFor(result, "p1")).toBe(500);
    expect(netFor(result, "p2")).toBe(500);
    expect(netFor(result, "p3")).toBe(-500);
    expect(netFor(result, "p4")).toBe(-500);
    expect(sum(result)).toBe(0);
  });

  it("pays +$5 / -$5 in singles too", () => {
    const game = buildGame({ format: "singles", rounds: shortestGame() });
    const result = settle(game);
    expect(potCents(game.bets)).toBe(1000);
    expect(netFor(result, "p1")).toBe(500);
    expect(netFor(result, "p3")).toBe(-500);
    expect(sum(result)).toBe(0);
  });

  it("pays the winning side when B wins", () => {
    const game = buildGame({
      rounds: [roundOfFives(1, 2), roundOfFives(1, 2), roundOfFives(1, 1)],
    });
    const result = settle(game);
    expect(netFor(result, "p3")).toBe(500);
    expect(netFor(result, "p1")).toBe(-500);
  });

  it("splits proportionally to stake when stakes differ", () => {
    // $10 + $5 on the winning side, $5 + $5 on the losing side. Pot = $25.
    // Winner shares: 25 * 10/15 = 16.67 -> +$6.67, and 25 * 5/15 = 8.33 -> +$3.33.
    const game = buildGame({
      betCents: [1000, 500, 500, 500],
      rounds: shortestGame(),
    });
    const result = settle(game);
    expect(potCents(game.bets)).toBe(2500);
    expect(netFor(result, "p1")).toBe(667);
    expect(netFor(result, "p2")).toBe(333);
    expect(netFor(result, "p3")).toBe(-500);
    expect(netFor(result, "p4")).toBe(-500);
    expect(sum(result)).toBe(0);
  });

  it("is identical to an even split when stakes match", () => {
    const game = buildGame({ betCents: [700, 700, 700, 700], rounds: shortestGame() });
    const result = settle(game);
    expect(netFor(result, "p1")).toBe(700);
    expect(netFor(result, "p2")).toBe(700);
    expect(sum(result)).toBe(0);
  });

  it("returns nothing for a game that has not been won", () => {
    const game = buildGame({ status: "in_progress", rounds: [roundOfFives(2, 1)] });
    expect(settle(game)).toEqual([]);
  });

  it("returns nothing for a game level at the target", () => {
    const game = buildGame({ rounds: Array.from({ length: 5 }, () => roundOfFives(1, 1)) });
    expect(settle(game)).toEqual([]);
  });

  it("handles a game where nobody wagered anything", () => {
    const game = buildGame({ betCents: 0, rounds: shortestGame() });
    const result = settle(game);
    expect(sum(result)).toBe(0);
    expect(result.every((entry) => entry.netCents === 0)).toBe(true);
  });

  it("still hands the pot to winners who staked nothing", () => {
    // Faithful to the rule as written: everyone pays in, the winning side takes
    // the pot. If the winners ante'd $0 they still collect what the losers put
    // in, split evenly since there are no stakes to weight by. A $0 bet is legal
    // but unusual — `validateGame` warns separately about a missing bet.
    const game = buildGame({ betCents: [0, 0, 500, 500], rounds: shortestGame() });
    const result = settle(game);
    expect(netFor(result, "p1")).toBe(500);
    expect(netFor(result, "p2")).toBe(500);
    expect(netFor(result, "p3")).toBe(-500);
    expect(sum(result)).toBe(0);
  });

  it("pays nobody when no bet belongs to the winning side", () => {
    // Only the losers are listed as bettors at all, so there is nothing to pay
    // out against and everyone keeps their money.
    const game = buildGame({ rounds: shortestGame() });
    game.bets = game.bets.filter((bet) => bet.playerId === "p3" || bet.playerId === "p4");
    const result = settle(game);
    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.netCents === 0)).toBe(true);
    expect(sum(result)).toBe(0);
  });

  it("preserves bet order so the UI renders stably", () => {
    const game = buildGame({ rounds: shortestGame() });
    expect(settle(game).map((entry) => entry.playerId)).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("settle — zero-sum property", () => {
  it("always sums to exactly zero, including awkward stakes", () => {
    const random = makeRandom(770177);
    for (let i = 0; i < 3000; i += 1) {
      // Deliberately awkward amounts: odd cents that don't divide evenly.
      const stakes = Array.from({ length: 4 }, () => Math.floor(random() * 1337) + 1);
      const aWins = random() < 0.5;
      const game = buildGame({
        betCents: stakes,
        rounds: aWins
          ? shortestGame()
          : [roundOfFives(1, 2), roundOfFives(1, 2), roundOfFives(1, 1)],
      });
      const result = settle(game);
      expect(result).toHaveLength(4);
      expect(sum(result)).toBe(0);
    }
  });

  it("never pays a winner less than they staked back", () => {
    const random = makeRandom(31337);
    for (let i = 0; i < 1000; i += 1) {
      const stakes = Array.from({ length: 4 }, () => Math.floor(random() * 2000) + 100);
      const game = buildGame({ betCents: stakes, rounds: shortestGame() });
      const result = settle(game);
      // p1 and p2 are on the winning side; each should be up, never down.
      expect(netFor(result, "p1")).toBeGreaterThanOrEqual(0);
      expect(netFor(result, "p2")).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("formatCents", () => {
  it("signs and pads correctly", () => {
    expect(formatCents(500)).toBe("+$5.00");
    expect(formatCents(-500)).toBe("-$5.00");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(667)).toBe("+$6.67");
    expect(formatCents(-5)).toBe("-$0.05");
    expect(formatCents(123456)).toBe("+$1234.56");
  });
});
