import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCORING,
  configFor,
  discsPerTeam,
  discsUsed,
  gameStanding,
  maxRoundPoints,
  otherTeam,
  playersPerTeam,
  roundPoints,
  scoreRound,
  teamOf,
} from "./scoring.js";
import { buildGame, counts, makeRandom, randomCounts, roundOfFives, shortestGame } from "./testing.js";

const doubles = configFor("doubles");
const singles = configFor("singles");

describe("config", () => {
  it("defaults to the house rules", () => {
    expect(DEFAULT_SCORING.ringValues).toEqual({ twenty: 20, fifteen: 15, ten: 10, five: 5 });
    expect(DEFAULT_SCORING.matchPointsWin).toBe(2);
    expect(DEFAULT_SCORING.matchPointsTie).toBe(1);
    expect(DEFAULT_SCORING.targetMatchPoints).toBe(5);
    expect(DEFAULT_SCORING.winBy).toBe(2);
  });

  it("derives disc counts rather than hardcoding 12", () => {
    expect(playersPerTeam(doubles)).toBe(2);
    expect(discsPerTeam(doubles)).toBe(12);
    expect(playersPerTeam(singles)).toBe(1);
    expect(discsPerTeam(singles)).toBe(8);
  });

  it("caps a round at 240 in doubles and 160 in singles", () => {
    expect(maxRoundPoints(doubles)).toBe(240);
    expect(maxRoundPoints(singles)).toBe(160);
  });

  it("does not share the ringValues object between configs", () => {
    const a = configFor("doubles");
    a.ringValues.twenty = 99;
    expect(configFor("doubles").ringValues.twenty).toBe(20);
    expect(DEFAULT_SCORING.ringValues.twenty).toBe(20);
  });
});

describe("roundPoints", () => {
  it("sums the rings at their configured values", () => {
    expect(roundPoints(counts(1, 2, 1, 0), doubles)).toBe(20 + 30 + 10);
  });

  it("is zero for an empty board", () => {
    expect(roundPoints(counts(0, 0, 0, 0), doubles)).toBe(0);
  });

  it("honours a non-default config rather than the constants", () => {
    const custom = { ...doubles, ringValues: { twenty: 25, fifteen: 15, ten: 10, five: 5 } };
    expect(roundPoints(counts(1, 0, 0, 0), custom)).toBe(25);
  });

  it("counts discs used", () => {
    expect(discsUsed(counts(1, 2, 3, 4))).toBe(10);
  });
});

describe("scoreRound", () => {
  it("awards 2 to the higher score", () => {
    const score = scoreRound(counts(1, 0, 0, 0), counts(0, 1, 0, 0), doubles);
    expect(score.aPoints).toBe(20);
    expect(score.bPoints).toBe(15);
    expect(score.result).toBe("A");
    expect(score.matchPoints).toEqual({ A: 2, B: 0 });
    expect(score.differential).toBe(5);
  });

  it("awards 2 to B when B is higher", () => {
    const score = scoreRound(counts(0, 1, 0, 0), counts(1, 0, 0, 0), doubles);
    expect(score.result).toBe("B");
    expect(score.matchPoints).toEqual({ A: 0, B: 2 });
    expect(score.differential).toBe(-5);
  });

  it("awards 1 each on a tie", () => {
    const score = scoreRound(counts(1, 0, 0, 0), counts(1, 0, 0, 0), doubles);
    expect(score.result).toBe("tie");
    expect(score.matchPoints).toEqual({ A: 1, B: 1 });
    expect(score.differential).toBe(0);
  });

  it("uses pointsOverride when present", () => {
    const score = scoreRound(counts(1, 0, 0, 0), counts(0, 0, 0, 0), doubles, { A: 60 });
    expect(score.aPoints).toBe(60);
    expect(score.bPoints).toBe(0);
  });

  it("honours an override of zero rather than falling back to the rings", () => {
    const score = scoreRound(counts(5, 0, 0, 0), counts(0, 0, 0, 1), doubles, { A: 0 });
    expect(score.aPoints).toBe(0);
    expect(score.result).toBe("B");
  });

  it("allows overriding only one side", () => {
    const score = scoreRound(counts(0, 0, 0, 1), counts(0, 0, 1, 0), doubles, { B: 99 });
    expect(score.aPoints).toBe(5);
    expect(score.bPoints).toBe(99);
  });
});

describe("outcome-only rounds", () => {
  it("awards match points but reports no points", () => {
    const score = scoreRound(counts(0, 0, 0, 0), counts(0, 0, 0, 0), doubles, undefined, "A");
    expect(score.result).toBe("A");
    expect(score.matchPoints).toEqual({ A: 2, B: 0 });
    expect(score.pointsKnown).toBe(false);
  });

  it("handles a tie with no points", () => {
    const score = scoreRound(counts(0, 0, 0, 0), counts(0, 0, 0, 0), doubles, undefined, "tie");
    expect(score.matchPoints).toEqual({ A: 1, B: 1 });
    expect(score.pointsKnown).toBe(false);
  });

  it("beats pointsOverride — an outcome-only round has no total to override", () => {
    const score = scoreRound(counts(3, 0, 0, 0), counts(0, 0, 0, 0), doubles, { A: 99 }, "B");
    expect(score.result).toBe("B");
    expect(score.aPoints).toBe(0);
    expect(score.pointsKnown).toBe(false);
  });

  it("is EXCLUDED from round point totals, not counted as zero", () => {
    // Three outcome-only wins for A: the match is 6-0 but nobody scored a point
    // we know about. Counting these as 0-0 would drag any average toward zero.
    const rounds = Array.from({ length: 3 }, (_, index) => ({
      A: counts(0, 0, 0, 0),
      B: counts(0, 0, 0, 0),
      index,
      resultOverride: "A" as const,
    }));
    const standing = gameStanding(rounds, doubles);
    expect(standing.matchPoints).toEqual({ A: 6, B: 0 });
    expect(standing.isComplete).toBe(true);
    expect(standing.roundsPlayed).toBe(3);
    expect(standing.roundsScored).toBe(0);
    expect(standing.roundPointsFor).toEqual({ A: 0, B: 0 });
  });

  it("averages only over the rounds that carry points", () => {
    // One real round (A scores 40) plus one outcome-only round. The average must
    // be 40 over one scored round, not 20 over two.
    const rounds = [
      { A: counts(2, 0, 0, 0), B: counts(0, 0, 0, 1), index: 0 },
      { A: counts(0, 0, 0, 0), B: counts(0, 0, 0, 0), index: 1, resultOverride: "A" as const },
    ];
    const standing = gameStanding(rounds, doubles);
    expect(standing.roundsPlayed).toBe(2);
    expect(standing.roundsScored).toBe(1);
    expect(standing.roundPointsFor.A).toBe(40);
    expect(standing.roundPointsFor.A / standing.roundsScored).toBe(40);
  });
});

describe("gameStanding", () => {
  it("is not complete before anyone reaches the target", () => {
    const standing = gameStanding([roundOfFives(2, 1)].map((r, index) => ({ ...r, index })), doubles);
    expect(standing.matchPoints).toEqual({ A: 2, B: 0 });
    expect(standing.isComplete).toBe(false);
    expect(standing.winner).toBeUndefined();
  });

  it("completes a game in the minimum three rounds", () => {
    // 2 + 2 + 1 = 5. This is the shortest a game to 5 can possibly be.
    const rounds = shortestGame().map((r, index) => ({ ...r, index }));
    const standing = gameStanding(rounds, doubles);
    expect(standing.roundsPlayed).toBe(3);
    expect(standing.matchPoints).toEqual({ A: 5, B: 1 });
    expect(standing.isComplete).toBe(true);
    expect(standing.winner).toBe("A");
  });

  it("cannot complete in two rounds", () => {
    const rounds = [roundOfFives(2, 1), roundOfFives(2, 1)].map((r, index) => ({ ...r, index }));
    expect(gameStanding(rounds, doubles).isComplete).toBe(false);
  });

  it("accumulates round points for both sides", () => {
    const rounds = [roundOfFives(4, 2), roundOfFives(2, 6)].map((r, index) => ({ ...r, index }));
    const standing = gameStanding(rounds, doubles);
    expect(standing.roundPointsFor).toEqual({ A: 30, B: 40 });
  });

  it("defaults to win-by-two: 5–4 keeps playing", () => {
    // A: 2,2,0,1 = 5.  B: 0,0,2,1 = 3... push B to 4 with a further tie.
    const rounds = [
      roundOfFives(2, 1), // A +2
      roundOfFives(2, 1), // A +2  -> 4-0
      roundOfFives(1, 2), // B +2  -> 4-2
      roundOfFives(1, 1), // tie   -> 5-3  (margin 2, complete)
    ].map((r, index) => ({ ...r, index }));
    expect(gameStanding(rounds, doubles).matchPoints).toEqual({ A: 5, B: 3 });
    expect(gameStanding(rounds, doubles).isComplete).toBe(true);

    // Now the 5-4 case: reaching the target with only a one-point lead is not
    // enough under the default margin.
    const close = [
      roundOfFives(2, 1), // A +2 -> 2-0
      roundOfFives(1, 2), // B +2 -> 2-2
      roundOfFives(1, 1), // tie  -> 3-3
      roundOfFives(1, 1), // tie  -> 4-4
      roundOfFives(1, 1), // tie  -> 5-5
    ].map((r, index) => ({ ...r, index }));
    const standing = gameStanding(close, doubles);
    expect(standing.matchPoints).toEqual({ A: 5, B: 5 });
    expect(standing.isComplete).toBe(false);
  });

  it("honours winBy: 1 for a first-past-the-post house rule", () => {
    const firstPast = { ...doubles, winBy: 1 };
    const rounds = [
      roundOfFives(2, 1),
      roundOfFives(1, 2),
      roundOfFives(1, 1),
      roundOfFives(1, 1),
      roundOfFives(2, 1), // A -> 6-4
    ].map((r, index) => ({ ...r, index }));
    expect(gameStanding(rounds, firstPast).isComplete).toBe(true);
    expect(gameStanding(rounds, { ...doubles, winBy: 3 }).isComplete).toBe(false);
  });

  it("does NOT end a game level at the target — play continues", () => {
    // Five straight ties: 5-5. Both have reached the target, neither leads.
    // A game cannot end level when money is riding on it.
    const rounds = Array.from({ length: 5 }, (_, index) => ({
      ...roundOfFives(1, 1),
      index,
    }));
    const standing = gameStanding(rounds, doubles);
    expect(standing.matchPoints).toEqual({ A: 5, B: 5 });
    expect(standing.isComplete).toBe(false);
    expect(standing.winner).toBeUndefined();
  });

  it("finishes once someone breaks a level target", () => {
    const rounds = [
      ...Array.from({ length: 5 }, () => roundOfFives(1, 1)),
      roundOfFives(3, 1),
    ].map((r, index) => ({ ...r, index }));
    const standing = gameStanding(rounds, doubles);
    expect(standing.matchPoints).toEqual({ A: 7, B: 5 });
    expect(standing.isComplete).toBe(true);
    expect(standing.winner).toBe("A");
  });

  it("handles an empty game", () => {
    const standing = gameStanding([], doubles);
    expect(standing.matchPoints).toEqual({ A: 0, B: 0 });
    expect(standing.roundsPlayed).toBe(0);
    expect(standing.isComplete).toBe(false);
  });
});

describe("team helpers", () => {
  it("finds which side a player is on", () => {
    const game = buildGame();
    expect(teamOf(game.teams, "p1")).toBe("A");
    expect(teamOf(game.teams, "p4")).toBe("B");
    expect(teamOf(game.teams, "nobody")).toBeUndefined();
  });

  it("flips sides", () => {
    expect(otherTeam("A")).toBe("B");
    expect(otherTeam("B")).toBe("A");
  });
});

describe("properties", () => {
  const random = makeRandom(20260812);

  it("differential sign always agrees with the result", () => {
    for (let i = 0; i < 2000; i += 1) {
      const a = randomCounts(random, discsPerTeam(doubles));
      const b = randomCounts(random, discsPerTeam(doubles));
      const score = scoreRound(a, b, doubles);
      if (score.result === "A") expect(score.differential).toBeGreaterThan(0);
      else if (score.result === "B") expect(score.differential).toBeLessThan(0);
      else expect(score.differential).toBe(0);
    }
  });

  it("a legal round never exceeds the theoretical maximum", () => {
    for (let i = 0; i < 2000; i += 1) {
      const side = randomCounts(random, discsPerTeam(doubles));
      expect(roundPoints(side, doubles)).toBeLessThanOrEqual(maxRoundPoints(doubles));
    }
  });

  it("every round awards exactly 2 match points in total", () => {
    for (let i = 0; i < 2000; i += 1) {
      const a = randomCounts(random, discsPerTeam(doubles));
      const b = randomCounts(random, discsPerTeam(doubles));
      const score = scoreRound(a, b, doubles);
      expect(score.matchPoints.A + score.matchPoints.B).toBe(2);
    }
  });

  it("a winner always holds at least the target and strictly leads", () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const rounds: { A: ReturnType<typeof counts>; B: ReturnType<typeof counts>; index: number }[] = [];
      for (let i = 0; i < 12; i += 1) {
        rounds.push({
          A: randomCounts(random, discsPerTeam(doubles)),
          B: randomCounts(random, discsPerTeam(doubles)),
          index: i,
        });
        const standing = gameStanding(rounds, doubles);
        if (standing.isComplete) {
          const winner = standing.winner;
          expect(winner).toBeDefined();
          if (!winner) break;
          const loser = otherTeam(winner);
          expect(standing.matchPoints[winner]).toBeGreaterThanOrEqual(doubles.targetMatchPoints);
          expect(
            standing.matchPoints[winner] - standing.matchPoints[loser],
          ).toBeGreaterThanOrEqual(doubles.winBy);
          break;
        }
      }
    }
  });

  // NOTE: `docs/plan/03-PHASE-1.md` §3.8 asked for a property that match points
  // "never exceed target+1". That is false under the must-lead rule above: five
  // tied rounds reach 5-5, play continues, and the winner finishes on 7. The
  // real invariant is that the game ends the first time someone is at or past
  // the target *with a lead*, which is what the test above asserts.
  it("is never complete while the sides are level", () => {
    for (let i = 0; i < 500; i += 1) {
      const rounds = Array.from({ length: (i % 9) + 1 }, (_, index) => ({
        ...roundOfFives(1, 1),
        index,
      }));
      const standing = gameStanding(rounds, doubles);
      expect(standing.matchPoints.A).toBe(standing.matchPoints.B);
      expect(standing.isComplete).toBe(false);
    }
  });
});
