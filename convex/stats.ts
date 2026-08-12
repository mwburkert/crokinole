/**
 * Statistics and the leaderboard (§3.5).
 *
 * **There is no public query here.** The original plan had a `publicLeaderboard`
 * that took no identity, alongside an authenticated `fullStats`. That split was
 * removed on 2026-08-12 when the whole app went behind auth — with no anonymous
 * audience there is nothing to withhold, so earnings are simply part of the one
 * query. Any function in this file that returns data without calling
 * `assertAllowlisted` first is a bug (§6.3).
 */

import { aggregateStats, groupByNight, settle } from "@crokinole/core";
import { v } from "convex/values";

import { query } from "./_generated/server";
import { assertAllowlisted } from "./lib/auth";
import { loadAllGames } from "./lib/model";

/** The one leaderboard. Records, scoring stats, and money — all authenticated. */
export const leaderboard = query({
  args: {
    since: v.optional(v.number()),
    until: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx);

    const games = await loadAllGames(ctx);
    const players = await ctx.db.query("players").collect();

    const rows = aggregateStats(games, {
      ...(args.since !== undefined ? { since: args.since } : {}),
      ...(args.until !== undefined ? { until: args.until } : {}),
      includePlayerIds: players.filter((p) => p.isActive).map((p) => p._id),
    });

    const names = new Map(players.map((p) => [p._id as string, p]));
    return rows.map((row) => ({
      ...row,
      displayName: names.get(row.playerId)?.displayName ?? "Unknown",
      shortName: names.get(row.playerId)?.shortName ?? null,
    }));
  },
});

/**
 * History grouped by night (§4.5.2 — a night is the natural unit; five games in
 * an evening settle once, not five times).
 */
export const nights = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx);
    const games = await loadAllGames(ctx);
    const grouped = groupByNight(games);
    const limited = args.limit ? grouped.slice(0, args.limit) : grouped;

    return limited.map((night) => {
      const totals = new Map<string, number>();
      for (const game of night.games) {
        for (const entry of settle(game)) {
          totals.set(entry.playerId, (totals.get(entry.playerId) ?? 0) + entry.netCents);
        }
      }
      return {
        date: night.date,
        gameCount: night.games.length,
        gameIds: night.games.map((game) => game.id),
        settlement: [...totals.entries()].map(([playerId, netCents]) => ({
          playerId,
          netCents,
        })),
      };
    });
  },
});
