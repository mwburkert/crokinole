import { describe, expect, it } from "vitest";

import { aggregateStats, groupByNight, netCentsFor, toLocalDateKey } from "./stats.js";
import { buildGame, roundOfFives, shortestGame } from "./testing.js";
import type { PlayerStats } from "./types.js";

/** A wins. p1 + p2 beat p3 + p4, all $5. */
const aWin = (id: string, playedAt: number) =>
  buildGame({ id, playedAt, rounds: shortestGame() });

/** B wins. */
const bWin = (id: string, playedAt: number) =>
  buildGame({
    id,
    playedAt,
    rounds: [roundOfFives(1, 2), roundOfFives(1, 2), roundOfFives(1, 1)],
  });

const NIGHT = Date.UTC(2026, 7, 12, 19, 0, 0);
const rowFor = (rows: PlayerStats[], id: string): PlayerStats | undefined =>
  rows.find((row) => row.playerId === id);

describe("aggregateStats", () => {
  it("counts a single game for all four players", () => {
    const rows = aggregateStats([aWin("g1", NIGHT)]);
    expect(rows).toHaveLength(4);

    const p1 = rowFor(rows, "p1");
    expect(p1?.gamesPlayed).toBe(1);
    expect(p1?.gamesWon).toBe(1);
    expect(p1?.gamesLost).toBe(0);
    expect(p1?.winPct).toBe(1);
    expect(p1?.netCents).toBe(500);

    const p3 = rowFor(rows, "p3");
    expect(p3?.gamesWon).toBe(0);
    expect(p3?.gamesLost).toBe(1);
    expect(p3?.winPct).toBe(0);
    expect(p3?.netCents).toBe(-500);
  });

  it("reconciles a hand-computed night of three games", () => {
    // p1+p2 win two, lose one. Net: +5 +5 -5 = +$5 each.
    // Match points: A takes 5-1 twice and loses 1-5 once => 11 for, 7 against.
    // Round points per A win: 2+2+1 fives = 25 for, 15 against.
    //   A wins  x2 => for 50, against 30
    //   A loses x1 => for 15, against 25
    //   totals    => for 65, against 55
    const games = [aWin("g1", NIGHT), aWin("g2", NIGHT + 1), bWin("g3", NIGHT + 2)];
    const rows = aggregateStats(games);

    const p1 = rowFor(rows, "p1");
    expect(p1?.gamesPlayed).toBe(3);
    expect(p1?.gamesWon).toBe(2);
    expect(p1?.gamesLost).toBe(1);
    expect(p1?.winPct).toBeCloseTo(2 / 3);
    expect(p1?.matchPointsFor).toBe(11);
    expect(p1?.matchPointsAgainst).toBe(7);
    expect(p1?.roundPointsFor).toBe(65);
    expect(p1?.roundPointsAgainst).toBe(55);
    expect(p1?.netCents).toBe(500);

    const p3 = rowFor(rows, "p3");
    expect(p3?.matchPointsFor).toBe(7);
    expect(p3?.matchPointsAgainst).toBe(11);
    expect(p3?.netCents).toBe(-500);
  });

  it("nets to zero across every player", () => {
    const games = [aWin("g1", NIGHT), bWin("g2", NIGHT + 1), aWin("g3", NIGHT + 2)];
    const total = aggregateStats(games).reduce((sum, row) => sum + row.netCents, 0);
    expect(total).toBe(0);
  });

  it("excludes soft-deleted games", () => {
    const games = [aWin("g1", NIGHT), { ...aWin("g2", NIGHT + 1), deletedAt: NIGHT + 5 }];
    expect(rowFor(aggregateStats(games), "p1")?.gamesPlayed).toBe(1);
  });

  it("excludes games still in progress by default", () => {
    const unfinished = buildGame({
      id: "g2",
      status: "in_progress",
      rounds: [roundOfFives(2, 1)],
    });
    expect(aggregateStats([unfinished])).toHaveLength(0);
    expect(aggregateStats([unfinished], { includeInProgress: true })).toHaveLength(4);
  });

  it("filters by date range", () => {
    const games = [aWin("g1", NIGHT), aWin("g2", NIGHT + 86_400_000)];
    expect(rowFor(aggregateStats(games, { since: NIGHT + 1 }), "p1")?.gamesPlayed).toBe(1);
    expect(rowFor(aggregateStats(games, { until: NIGHT + 1 }), "p1")?.gamesPlayed).toBe(1);
    expect(
      rowFor(aggregateStats(games, { since: NIGHT, until: NIGHT + 1 }), "p1")?.gamesPlayed,
    ).toBe(1);
  });

  it("ignores per-player rows that carry no twenties field", () => {
    const game = aWin("g1", NIGHT);
    const first = game.rounds[0];
    if (first) first.playerStats = [{ playerId: "p1", fouls: 2 }];
    expect(rowFor(aggregateStats([game]), "p1")?.twenties).toBe(0);
  });

  it("keeps requested players visible even with no games", () => {
    const rows = aggregateStats([], { includePlayerIds: ["p9"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gamesPlayed).toBe(0);
    expect(rows[0]?.winPct).toBe(0);
  });

  it("totals twenties only where per-player detail was entered", () => {
    const game = aWin("g1", NIGHT);
    const first = game.rounds[0];
    if (first) {
      first.playerStats = [
        { playerId: "p1", twenties: 2 },
        { playerId: "p2", twenties: 1 },
      ];
    }
    const rows = aggregateStats([game]);
    expect(rowFor(rows, "p1")?.twenties).toBe(2);
    expect(rowFor(rows, "p4")?.twenties).toBe(0);
  });

  it("sorts winners to the top", () => {
    const rows = aggregateStats([aWin("g1", NIGHT), aWin("g2", NIGHT + 1)]);
    expect(rows[0]?.gamesWon).toBe(2);
    expect(rows.at(-1)?.gamesWon).toBe(0);
  });
});

describe("netCentsFor", () => {
  it("adds a player's results across games", () => {
    const games = [aWin("g1", NIGHT), aWin("g2", NIGHT + 1), bWin("g3", NIGHT + 2)];
    expect(netCentsFor(games, "p1")).toBe(500);
    expect(netCentsFor(games, "p3")).toBe(-500);
    expect(netCentsFor(games, "stranger")).toBe(0);
  });

  it("skips soft-deleted games", () => {
    const games = [aWin("g1", NIGHT), { ...aWin("g2", NIGHT + 1), deletedAt: NIGHT + 9 }];
    expect(netCentsFor(games, "p1")).toBe(500);
  });
});

describe("groupByNight", () => {
  it("buckets games by local calendar date, newest first", () => {
    const games = [
      aWin("g1", new Date(2026, 7, 12, 19).getTime()),
      aWin("g2", new Date(2026, 7, 12, 21).getTime()),
      aWin("g3", new Date(2026, 7, 19, 19).getTime()),
    ];
    const nights = groupByNight(games);
    expect(nights).toHaveLength(2);
    expect(nights[0]?.date).toBe("2026-08-19");
    expect(nights[1]?.games).toHaveLength(2);
  });

  it("formats a local date key", () => {
    expect(toLocalDateKey(new Date(2026, 0, 5, 12).getTime())).toBe("2026-01-05");
  });

  it("omits soft-deleted games from nights", () => {
    const games = [
      aWin("g1", new Date(2026, 7, 12, 19).getTime()),
      { ...aWin("g2", new Date(2026, 7, 19, 19).getTime()), deletedAt: Date.now() },
    ];
    const nights = groupByNight(games);
    expect(nights).toHaveLength(1);
    expect(nights[0]?.date).toBe("2026-08-12");
  });
});
