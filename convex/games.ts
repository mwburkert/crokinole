/**
 * Games and rounds (§3.3).
 *
 * Every handler starts with `assertAllowlisted` — Convex is a public internet
 * endpoint and Cloudflare Access does not protect it (§3.2.5). Nothing derived
 * is ever written: no scores, no totals, no standings.
 */

import {
  DEFAULT_SCORING,
  errorsOnly,
  gameStanding,
  scoreRoundInput,
  settle,
  validateGame,
} from "@crokinole/core";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { assertAdmin, assertAllowlisted } from "./lib/auth";
import { loadAllGames, loadGame, recordEvent, toCoreGame } from "./lib/model";

const ringCounts = v.object({
  twenties: v.number(),
  fifteens: v.number(),
  tens: v.number(),
  fives: v.number(),
});

const teamColor = v.union(v.literal("black"), v.literal("white"));

/** Throw on any blocking validation issue, listing them all at once. */
function assertValid(game: Parameters<typeof validateGame>[0]): void {
  const errors = errorsOnly(validateGame(game));
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join(" "));
  }
}

/** History, newest first. Totals are derived on read, never stored. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx);
    const games = await loadAllGames(ctx);
    const limited = args.limit ? games.slice(0, args.limit) : games;
    return limited.map((game) => ({
      game,
      standing: gameStanding(game.rounds, game.config),
      settlement: settle(game),
    }));
  },
});

export const get = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx);
    const game = await loadGame(ctx, args.gameId);
    if (!game) return null;
    return {
      game,
      standing: gameStanding(game.rounds, game.config),
      settlement: settle(game),
      roundScores: game.rounds.map((round) => scoreRoundInput(round, game.config)),
    };
  },
});

/** The game currently being entered, if any. Drives "resume where I was". */
export const inProgress = query({
  args: {},
  handler: async (ctx) => {
    await assertAllowlisted(ctx);
    const open = await ctx.db
      .query("games")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .collect();
    const live = open
      .filter((game) => game.deletedAt === undefined)
      .sort((a, b) => b.playedAt - a.playedAt)[0];
    if (!live) return null;
    const rounds = await ctx.db
      .query("rounds")
      .withIndex("by_game", (q) => q.eq("gameId", live._id))
      .collect();
    return toCoreGame(live, rounds);
  },
});

export const create = mutation({
  args: {
    playedAt: v.optional(v.number()),
    format: v.union(v.literal("doubles"), v.literal("singles")),
    teams: v.object({
      A: v.object({ color: teamColor, playerIds: v.array(v.id("players")) }),
      B: v.object({ color: teamColor, playerIds: v.array(v.id("players")) }),
    }),
    bets: v.array(v.object({ playerId: v.id("players"), amountCents: v.number() })),
    defaultBetCents: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx);
    const now = Date.now();

    const config = {
      ...DEFAULT_SCORING,
      ringValues: { ...DEFAULT_SCORING.ringValues },
      format: args.format,
      discsPerPlayer: args.format === "doubles" ? 6 : 8,
    };

    // Validate the shape before writing anything.
    assertValid({
      id: "pending",
      playedAt: args.playedAt ?? now,
      status: "in_progress",
      config,
      teams: args.teams,
      bets: args.bets,
      rounds: [],
    });

    const gameId = await ctx.db.insert("games", {
      playedAt: args.playedAt ?? now,
      status: "in_progress",
      config,
      teams: args.teams,
      bets: args.bets,
      ...(args.defaultBetCents !== undefined
        ? { defaultBetCents: args.defaultBetCents }
        : {}),
      ...(args.notes ? { notes: args.notes } : {}),
      createdBy: caller.player._id,
      createdAt: now,
      updatedAt: now,
    });

    await recordEvent(ctx, gameId, caller.player._id, "created", `${args.format} game started`);
    return gameId;
  },
});

/**
 * Commit a round. Flips the game to `final` automatically the moment one side
 * reaches the target with a lead (§3.5) — the UI never decides this.
 */
export const addRound = mutation({
  args: {
    gameId: v.id("games"),
    A: ringCounts,
    B: ringCounts,
    pointsOverride: v.optional(
      v.object({ A: v.optional(v.number()), B: v.optional(v.number()) }),
    ),
    playerStats: v.optional(
      v.array(
        v.object({
          playerId: v.id("players"),
          twenties: v.optional(v.number()),
          fouls: v.optional(v.number()),
          spencers: v.optional(v.number()),
          kinseys: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx);
    const stored = await ctx.db.get(args.gameId);
    if (!stored) throw new Error("Game not found.");
    if (stored.deletedAt !== undefined) throw new Error("That game was deleted.");

    const existing = await ctx.db
      .query("rounds")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    const index = existing.length;
    const now = Date.now();

    const candidate = toCoreGame(stored, existing);
    candidate.rounds.push({
      index,
      A: args.A,
      B: args.B,
      ...(args.pointsOverride ? { pointsOverride: args.pointsOverride } : {}),
      ...(args.playerStats ? { playerStats: args.playerStats } : {}),
    });
    assertValid(candidate);

    await ctx.db.insert("rounds", {
      gameId: args.gameId,
      index,
      A: args.A,
      B: args.B,
      ...(args.pointsOverride ? { pointsOverride: args.pointsOverride } : {}),
      ...(args.playerStats ? { playerStats: args.playerStats } : {}),
      createdAt: now,
      updatedAt: now,
    });

    const standing = gameStanding(candidate.rounds, candidate.config);
    await ctx.db.patch(args.gameId, {
      updatedAt: now,
      ...(standing.isComplete ? { status: "final" as const } : {}),
    });

    await recordEvent(
      ctx,
      args.gameId,
      caller.player._id,
      "roundAdded",
      `Round ${index + 1} committed`,
    );

    return { index, standing };
  },
});

/** Fix a mis-tapped round. Re-derives completion from scratch. */
export const updateRound = mutation({
  args: {
    roundId: v.id("rounds"),
    A: ringCounts,
    B: ringCounts,
    pointsOverride: v.optional(
      v.object({ A: v.optional(v.number()), B: v.optional(v.number()) }),
    ),
  },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx);
    const round = await ctx.db.get(args.roundId);
    if (!round) throw new Error("Round not found.");
    const stored = await ctx.db.get(round.gameId);
    if (!stored) throw new Error("Game not found.");

    const siblings = await ctx.db
      .query("rounds")
      .withIndex("by_game", (q) => q.eq("gameId", round.gameId))
      .collect();

    const candidate = toCoreGame(
      stored,
      siblings.map((doc) =>
        doc._id === args.roundId
          ? { ...doc, A: args.A, B: args.B, pointsOverride: args.pointsOverride }
          : doc,
      ),
    );
    assertValid(candidate);

    await ctx.db.patch(args.roundId, {
      A: args.A,
      B: args.B,
      ...(args.pointsOverride
        ? { pointsOverride: args.pointsOverride }
        : { pointsOverride: undefined }),
      updatedAt: Date.now(),
    });

    // A correction can un-finish a game as easily as finish one.
    const standing = gameStanding(candidate.rounds, candidate.config);
    await ctx.db.patch(round.gameId, {
      status: standing.isComplete ? "final" : "in_progress",
      updatedAt: Date.now(),
    });

    await recordEvent(
      ctx,
      round.gameId,
      caller.player._id,
      "roundEdited",
      `Round ${round.index + 1} corrected`,
    );
  },
});

/** Undo the most recent round — the common fix during live entry (§3.5). */
export const removeLastRound = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx);
    const rounds = await ctx.db
      .query("rounds")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    const last = [...rounds].sort((a, b) => b.index - a.index)[0];
    if (!last) throw new Error("No rounds to undo.");

    await ctx.db.delete(last._id);
    await ctx.db.patch(args.gameId, { status: "in_progress", updatedAt: Date.now() });
    await recordEvent(
      ctx,
      args.gameId,
      caller.player._id,
      "roundUndone",
      `Round ${last.index + 1} undone`,
    );
  },
});

/** Soft delete only (§3.2.4). The row stays; history hides it. */
export const softDelete = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx);
    await ctx.db.patch(args.gameId, { deletedAt: Date.now(), updatedAt: Date.now() });
    await recordEvent(ctx, args.gameId, caller.player._id, "deleted", "Game deleted");
  },
});

export const restore = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const caller = await assertAdmin(ctx);
    await ctx.db.patch(args.gameId, { deletedAt: undefined, updatedAt: Date.now() });
    await recordEvent(ctx, args.gameId, caller.player._id, "restored", "Game restored");
  },
});

export const setNotes = mutation({
  args: { gameId: v.id("games"), notes: v.string() },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx);
    await ctx.db.patch(args.gameId, { notes: args.notes, updatedAt: Date.now() });
  },
});
