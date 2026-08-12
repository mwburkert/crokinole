import { describe, expect, it } from "vitest";

import { configFor } from "./scoring.js";
import { buildGame, counts, roundOfFives, shortestGame } from "./testing.js";
import { errorsOnly, isValid, validateGame, validateRound } from "./validate.js";

const doubles = configFor("doubles");
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe("validateRound", () => {
  it("accepts a legal round", () => {
    const round = { ...roundOfFives(3, 2), index: 0 };
    expect(validateRound(round, doubles)).toEqual([]);
  });

  it("rejects more discs than are in play", () => {
    const round = { A: counts(5, 5, 5, 0), B: counts(0, 0, 0, 0), index: 0 };
    expect(codes(validateRound(round, doubles))).toContain("too_many_discs");
  });

  it("allows exactly the disc budget", () => {
    const round = { A: counts(6, 6, 0, 0), B: counts(0, 0, 0, 0), index: 0 };
    expect(validateRound(round, doubles)).toEqual([]);
  });

  it("uses the singles budget for singles", () => {
    const singles = configFor("singles");
    const round = { A: counts(0, 0, 0, 9), B: counts(0, 0, 0, 0), index: 0 };
    expect(codes(validateRound(round, singles))).toContain("too_many_discs");
    expect(validateRound({ ...round, A: counts(0, 0, 0, 8) }, singles)).toEqual([]);
  });

  it("rejects negative and fractional counts", () => {
    const negative = { A: counts(-1, 0, 0, 0), B: counts(0, 0, 0, 0), index: 0 };
    expect(codes(validateRound(negative, doubles))).toContain("negative_count");

    const fractional = { A: counts(1.5, 0, 0, 0), B: counts(0, 0, 0, 0), index: 0 };
    expect(codes(validateRound(fractional, doubles))).toContain("non_integer_count");

    // NaN and Infinity are the shapes a bad number input actually produces.
    const notANumber = { A: counts(Number.NaN, 0, 0, 0), B: counts(0, 0, 0, 0), index: 0 };
    expect(codes(validateRound(notANumber, doubles))).toContain("non_integer_count");

    const infinite = { A: counts(Number.POSITIVE_INFINITY, 0, 0, 0), B: counts(0, 0, 0, 0), index: 0 };
    expect(codes(validateRound(infinite, doubles))).toContain("non_integer_count");
  });

  it("warns when per-player twenties do not reconcile", () => {
    const teams = {
      A: { playerIds: ["p1", "p2"] },
      B: { playerIds: ["p3", "p4"] },
    };
    const round = {
      A: counts(3, 0, 0, 0),
      B: counts(0, 0, 0, 0),
      index: 0,
      playerStats: [
        { playerId: "p1", twenties: 1 },
        { playerId: "p2", twenties: 1 },
      ],
    };
    const issues = validateRound(round, doubles, teams);
    expect(codes(issues)).toContain("player_twenties_mismatch");
    // A mismatch is a warning, not a block — it flags inline without stopping entry.
    expect(isValid(issues)).toBe(true);
  });

  it("stays quiet when per-player twenties reconcile", () => {
    const teams = { A: { playerIds: ["p1", "p2"] }, B: { playerIds: ["p3", "p4"] } };
    const round = {
      A: counts(2, 0, 0, 0),
      B: counts(0, 0, 0, 0),
      index: 0,
      playerStats: [
        { playerId: "p1", twenties: 2 },
        { playerId: "p2", twenties: 0 },
      ],
    };
    expect(validateRound(round, doubles, teams)).toEqual([]);
  });

  it("does not reconcile when no twenties were entered at all", () => {
    const teams = { A: { playerIds: ["p1", "p2"] }, B: { playerIds: ["p3", "p4"] } };
    const round = {
      A: counts(2, 0, 0, 0),
      B: counts(0, 0, 0, 0),
      index: 0,
      playerStats: [{ playerId: "p1", fouls: 1 }],
    };
    expect(validateRound(round, doubles, teams)).toEqual([]);
  });
});

describe("validateGame", () => {
  it("accepts a well-formed finished game", () => {
    expect(validateGame(buildGame({ rounds: shortestGame() }))).toEqual([]);
  });

  it("rejects the wrong number of players for the format", () => {
    const game = buildGame({ rounds: shortestGame() });
    game.teams.A.playerIds = ["p1"];
    expect(codes(validateGame(game))).toContain("team_size_mismatch");
  });

  it("rejects both teams sharing a colour", () => {
    const game = buildGame({ rounds: shortestGame() });
    game.teams.B.color = "black";
    expect(codes(validateGame(game))).toContain("same_color_both_teams");
  });

  it("rejects the same player on both sides", () => {
    const game = buildGame({ rounds: shortestGame() });
    game.teams.B.playerIds = ["p1", "p4"];
    expect(codes(validateGame(game))).toContain("duplicate_player");
  });

  it("rejects a bet from someone not in the game", () => {
    const game = buildGame({ rounds: shortestGame() });
    game.bets.push({ playerId: "stranger", amountCents: 500 });
    expect(codes(validateGame(game))).toContain("bet_player_not_in_game");
  });

  it("rejects duplicate bets", () => {
    const game = buildGame({ rounds: shortestGame() });
    game.bets.push({ playerId: "p1", amountCents: 500 });
    expect(codes(validateGame(game))).toContain("duplicate_bet");
  });

  it("warns when a player has no bet", () => {
    const game = buildGame({ rounds: shortestGame() });
    game.bets = game.bets.slice(0, 3);
    const issues = validateGame(game);
    expect(codes(issues)).toContain("missing_bet");
    expect(isValid(issues)).toBe(true);
  });

  it("rejects a game marked final that nobody has won", () => {
    const game = buildGame({ status: "final", rounds: [roundOfFives(2, 1)] });
    const issues = validateGame(game);
    expect(codes(issues)).toContain("incomplete_final_game");
    expect(isValid(issues)).toBe(false);
  });

  it("rejects a game marked final while level at the target", () => {
    const game = buildGame({
      status: "final",
      rounds: Array.from({ length: 5 }, () => roundOfFives(1, 1)),
    });
    expect(codes(validateGame(game))).toContain("incomplete_final_game");
  });

  it("accepts an in-progress game that has not been won", () => {
    const game = buildGame({ status: "in_progress", rounds: [roundOfFives(2, 1)] });
    expect(validateGame(game)).toEqual([]);
  });

  it("separates blocking errors from warnings", () => {
    const game = buildGame({ rounds: shortestGame() });
    game.bets = game.bets.slice(0, 3);
    game.teams.B.color = "black";
    const issues = validateGame(game);
    expect(errorsOnly(issues).map((issue) => issue.code)).toEqual(["same_color_both_teams"]);
    expect(isValid(issues)).toBe(false);
  });
});
