import { describe, expect, it } from "vitest";

import {
  NIGHT_RESET_HOUR,
  gamesOnNight,
  nightBounds,
  nightHistory,
  nightKey,
  nightsWithGames,
  playersOnNight,
  shuffle,
  suggestSeating,
} from "./night.js";
import { buildGame, makeRandom, shortestGame } from "./testing.js";

const at = (y: number, m: number, d: number, h: number, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime();

describe("nightKey", () => {
  it("keeps a late finish on the same night", () => {
    expect(nightKey(at(2026, 8, 12, 19))).toBe("2026-08-12");
    expect(nightKey(at(2026, 8, 12, 23, 59))).toBe("2026-08-12");
    expect(nightKey(at(2026, 8, 13, 0, 30))).toBe("2026-08-12");
    expect(nightKey(at(2026, 8, 13, 2, 59))).toBe("2026-08-12");
  });

  it("rolls over at the reset hour", () => {
    expect(nightKey(at(2026, 8, 13, 3, 0))).toBe("2026-08-13");
    expect(nightKey(at(2026, 8, 13, 9, 0))).toBe("2026-08-13");
  });

  it("uses a 3am reset by default", () => {
    expect(NIGHT_RESET_HOUR).toBe(3);
  });

  it("bounds a night as a 24h window starting at the reset hour", () => {
    const { since, until } = nightBounds("2026-08-12");
    expect(new Date(since).getHours()).toBe(3);
    expect(until - since).toBe(24 * 60 * 60 * 1000);
    // Everything that maps to this key must fall inside the bounds.
    for (const ts of [at(2026, 8, 12, 19), at(2026, 8, 13, 2, 59)]) {
      expect(ts).toBeGreaterThanOrEqual(since);
      expect(ts).toBeLessThan(until);
    }
  });

  it("round-trips every hour of a night", () => {
    for (let hour = 3; hour < 27; hour += 1) {
      const ts = at(2026, 8, 12, 0) + hour * 3_600_000;
      const key = nightKey(ts);
      const { since, until } = nightBounds(key);
      expect(ts).toBeGreaterThanOrEqual(since);
      expect(ts).toBeLessThan(until);
    }
  });
});

describe("night queries", () => {
  const games = [
    buildGame({ id: "g1", playedAt: at(2026, 8, 12, 19), rounds: shortestGame() }),
    buildGame({
      id: "g2",
      playedAt: at(2026, 8, 13, 1),
      playerIds: ["p1", "p5", "p3", "p6"],
      rounds: shortestGame(),
    }),
    buildGame({ id: "g3", playedAt: at(2026, 8, 19, 20), rounds: shortestGame() }),
  ];

  it("lists nights newest first", () => {
    expect(nightsWithGames(games)).toEqual(["2026-08-19", "2026-08-12"]);
  });

  it("groups the 1am game with the night before", () => {
    expect(gamesOnNight(games, "2026-08-12").map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("lists who was actually there", () => {
    expect(playersOnNight(games, "2026-08-12").sort()).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
  });

  it("ignores soft-deleted games", () => {
    const withDeleted = [...games, { ...games[0]!, id: "g4", deletedAt: Date.now() }];
    expect(gamesOnNight(withDeleted, "2026-08-12")).toHaveLength(2);
  });
});

describe("nightHistory", () => {
  it("counts partnerships, match-ups, and games played", () => {
    const history = nightHistory([
      buildGame({ id: "g1", playerIds: ["p1", "p2", "p3", "p4"], rounds: shortestGame() }),
      buildGame({ id: "g2", playerIds: ["p1", "p2", "p3", "p4"], rounds: shortestGame() }),
    ]);
    expect(history.partnered.get("p1|p2")).toBe(2);
    expect(history.faced.get("p1|p3")).toBe(2);
    expect(history.played.get("p1")).toBe(2);
    expect(history.played.get("p5")).toBeUndefined();
  });
});

describe("suggestSeating", () => {
  const random = makeRandom(4242);
  const four = ["p1", "p2", "p3", "p4"];

  it("returns null without enough players", () => {
    expect(suggestSeating(["p1", "p2"], [], "doubles", random)).toBeNull();
    expect(suggestSeating(["p1"], [], "singles", random)).toBeNull();
  });

  it("seats exactly the right number", () => {
    const doubles = suggestSeating(four, [], "doubles", random);
    expect(doubles?.teamA).toHaveLength(2);
    expect(doubles?.teamB).toHaveLength(2);

    const singles = suggestSeating(four, [], "singles", random);
    expect(singles?.teamA).toHaveLength(1);
    expect(singles?.teamB).toHaveLength(1);
  });

  it("never seats the same person twice", () => {
    for (let i = 0; i < 200; i += 1) {
      const seating = suggestSeating(["p1", "p2", "p3", "p4", "p5"], [], "doubles", random);
      const all = [...(seating?.teamA ?? []), ...(seating?.teamB ?? [])];
      expect(new Set(all).size).toBe(4);
    }
  });

  it("avoids a partnership that already happened tonight", () => {
    // p1+p2 have partnered; with only these four available the suggester must
    // pick one of the two arrangements that splits them up.
    const tonight = [
      buildGame({ id: "g1", playerIds: ["p1", "p2", "p3", "p4"], rounds: shortestGame() }),
    ];
    for (let i = 0; i < 100; i += 1) {
      const seating = suggestSeating(four, tonight, "doubles", random);
      const pairs = [seating?.teamA ?? [], seating?.teamB ?? []];
      const together = pairs.some(
        (pair) => pair.includes("p1") && pair.includes("p2"),
      );
      expect(together).toBe(false);
    }
  });

  it("pulls in whoever has been sitting out", () => {
    // p1..p4 have each played twice; p5 and p6 haven't played at all. With six
    // available, the rested pair should always be chosen.
    const tonight = [
      buildGame({ id: "g1", playerIds: ["p1", "p2", "p3", "p4"], rounds: shortestGame() }),
      buildGame({ id: "g2", playerIds: ["p1", "p3", "p2", "p4"], rounds: shortestGame() }),
    ];
    const pool = ["p1", "p2", "p3", "p4", "p5", "p6"];
    for (let i = 0; i < 100; i += 1) {
      const seating = suggestSeating(pool, tonight, "doubles", random);
      const all = [...(seating?.teamA ?? []), ...(seating?.teamB ?? [])];
      expect(all).toContain("p5");
      expect(all).toContain("p6");
    }
  });

  it("varies between equally good options", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const seating = suggestSeating(four, [], "doubles", random);
      seen.add(JSON.stringify(seating));
    }
    // With a clean slate every split scores identically, so it should not keep
    // handing back the same four.
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("shuffle", () => {
  it("keeps every element exactly once", () => {
    const random = makeRandom(99);
    const input = ["a", "b", "c", "d"];
    for (let i = 0; i < 100; i += 1) {
      const out = shuffle(input, random);
      expect([...out].sort()).toEqual(["a", "b", "c", "d"]);
    }
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    shuffle(input, makeRandom(1));
    expect(input).toEqual(["a", "b", "c"]);
  });
});
