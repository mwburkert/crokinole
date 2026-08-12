/**
 * Games and rounds (§3.3).
 *
 * Every handler starts with `assertAllowlisted` — Convex is a public internet
 * endpoint and Cloudflare Access does not protect it (§3.2.5). Nothing derived
 * is ever written: no scores, no totals, no standings.
 *
 * 🕐 Every public function takes `passcode` while the shared passphrase is the
 * auth model. It goes when Cloudflare Access lands — see `convex/lib/auth.ts`,
 * where the whole interim is described and marked for deletion.
 */

import {
  countsFromDiscs,
  DEFAULT_SCORING,
  discsPerTeam,
  errorsOnly,
  gameStanding,
  placedCount,
  scoreRoundInput,
  settle,
  validateGame,
  type DiscColor,
  type PlacedDisc,
  type RingCounts,
  type ScoringConfig,
} from "@crokinole/core";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
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

/** Mirrors `rounds.discs` in the schema and core's `PlacedDisc`. */
const placedDiscs = v.array(
  v.object({
    id: v.string(),
    color: teamColor,
    x: v.number(),
    y: v.number(),
    region: v.union(
      v.literal("twenty"),
      v.literal("fifteen"),
      v.literal("ten"),
      v.literal("five"),
      v.literal("ditch"),
    ),
  }),
);

const pointsOverride = v.optional(
  v.object({ A: v.optional(v.number()), B: v.optional(v.number()) }),
);

const playerStats = v.optional(
  v.array(
    v.object({
      playerId: v.id("players"),
      twenties: v.optional(v.number()),
      fouls: v.optional(v.number()),
      spencers: v.optional(v.number()),
      kinseys: v.optional(v.number()),
    }),
  ),
);

/** Throw on any blocking validation issue, listing them all at once. */
function assertValid(game: Parameters<typeof validateGame>[0]): void {
  const errors = errorsOnly(validateGame(game));
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join(" "));
  }
}

/**
 * Reconcile a round's counts with its board.
 *
 * **When `discs` is present it is the source of truth and the ring counts are
 * recomputed from it** (§3.5). This is the only place a write can produce
 * counts for a placed board, so the two can never disagree — a client that
 * sends stale counts alongside a board simply has them overwritten rather than
 * silently persisting a contradiction.
 *
 * A round typed into the manual menu has no `discs` at all, and its counts
 * stand on their own.
 *
 * ⚠️ Takes `A` and `B` as separate arguments rather than one `{A, B}` object,
 * and rebuilds them rather than returning what it was given. The earlier
 * version accepted a `{A, B}` fallback and was called with the mutation's whole
 * `args`, which satisfies that shape structurally — so on the no-board path it
 * handed back `args` itself, and `...counts` then spread `passcode`, `gameId`
 * and `index` into the round document. It typechecked, every test passed, and
 * every manual entry and every correction failed against the schema validator
 * while the UI showed nothing. Two separate arguments cannot be filled by one
 * unrelated object by accident.
 */
function reconcile(
  config: ScoringConfig,
  a: RingCounts,
  b: RingCounts,
  teams: { A: { color: DiscColor }; B: { color: DiscColor } },
  discs: PlacedDisc[] | undefined,
): { A: RingCounts; B: RingCounts } {
  if (!discs) {
    // Rebuilt, so the result can only ever be the four counts — never whatever
    // extra fields the caller's object happened to carry.
    return {
      A: { twenties: a.twenties, fifteens: a.fifteens, tens: a.tens, fives: a.fives },
      B: { twenties: b.twenties, fifteens: b.fifteens, tens: b.tens, fives: b.fives },
    };
  }

  const limit = discsPerTeam(config);
  for (const color of ["black", "white"] as const) {
    const placed = placedCount(discs, color);
    if (placed > limit) {
      throw new Error(
        `${placed} ${color} discs placed but only ${limit} are in play this format.`,
      );
    }
  }

  return {
    A: countsFromDiscs(discs, teams.A.color),
    B: countsFromDiscs(discs, teams.B.color),
  };
}

/** History, newest first. Totals are derived on read, never stored. */
export const list = query({
  args: { passcode: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
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
  args: { passcode: v.string(), gameId: v.id("games") },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
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
  args: { passcode: v.string() },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
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
    passcode: v.string(),
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
    const caller = await assertAllowlisted(ctx, args.passcode);
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
      ...(caller.player ? { createdBy: caller.player._id } : {}),
      createdAt: now,
      updatedAt: now,
    });

    await recordEvent(
      ctx,
      gameId,
      caller.player?._id ?? null,
      "created",
      `${args.format} game started`,
    );
    return gameId;
  },
});

/**
 * Commit a round. Flips the game to `final` automatically the moment one side
 * reaches the target with a lead (§3.5) — the UI never decides this.
 */
export const addRound = mutation({
  args: {
    passcode: v.string(),
    gameId: v.id("games"),
    A: ringCounts,
    B: ringCounts,
    /** The board, when one was placed. Source of truth for the counts above. */
    discs: v.optional(placedDiscs),
    pointsOverride,
    playerStats,
  },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
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
    const counts = reconcile(candidate.config, args.A, args.B, stored.teams, args.discs);

    candidate.rounds.push({
      index,
      ...counts,
      ...(args.discs ? { discs: args.discs } : {}),
      ...(args.pointsOverride ? { pointsOverride: args.pointsOverride } : {}),
      ...(args.playerStats ? { playerStats: args.playerStats } : {}),
    });
    assertValid(candidate);

    await ctx.db.insert("rounds", {
      gameId: args.gameId,
      index,
      ...counts,
      ...(args.discs ? { discs: args.discs } : {}),
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
      caller.player?._id ?? null,
      "roundAdded",
      `Round ${index + 1} committed`,
    );

    return { index, standing };
  },
});

/**
 * Fix a mis-tapped round. Re-derives completion from scratch.
 *
 * Keyed by `(gameId, index)` rather than a round id, because a round id is not
 * something the client can hold: `games.list` and `games.get` hand back core's
 * `Round`, which carries an index and no id — core knows nothing about Convex
 * (§3.2.2), and leaking document ids through it to make one mutation reachable
 * would be the wrong end to fix. The index is the round's identity everywhere
 * else in the app, so it is its identity here too.
 */
export const updateRound = mutation({
  args: {
    passcode: v.string(),
    gameId: v.id("games"),
    /** 0-based, as everywhere else. */
    index: v.number(),
    A: ringCounts,
    B: ringCounts,
    discs: v.optional(placedDiscs),
    pointsOverride,
    playerStats,
  },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
    const stored = await ctx.db.get(args.gameId);
    if (!stored) throw new Error("Game not found.");
    if (stored.deletedAt !== undefined) throw new Error("That game was deleted.");

    const siblings = await ctx.db
      .query("rounds")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    const round = siblings.find((doc) => doc.index === args.index);
    if (!round) throw new Error(`This game has no round ${args.index + 1}.`);

    const config = toCoreGame(stored, []).config;
    const counts = reconcile(config, args.A, args.B, stored.teams, args.discs);

    // The patch as it will be written, applied to the in-memory copy first so
    // the whole game is validated before anything lands.
    const patch = {
      ...counts,
      // `undefined` clears the field, which is what a correction that removes a
      // board or an override has to do — leaving the old one behind would
      // re-derive the counts from a board that no longer matches.
      discs: args.discs,
      pointsOverride: args.pointsOverride,
      playerStats: args.playerStats,
      /**
       * Correcting a round always ends its outcome-only state.
       *
       * `resultOverride` means "we know who took it and nothing else" — it
       * short-circuits scoring entirely, so leaving it in place would let a
       * correction write counts that `scoreRoundInput` then ignores. Every
       * round of the 5 August night is in exactly that state (the recap never
       * carried points), so the first person to fix one would have watched
       * their numbers vanish. Typing counts or a total *is* the act of
       * recording the points, which is the one thing this flag says nobody did.
       */
      resultOverride: undefined,
      updatedAt: Date.now(),
    };

    const candidate = toCoreGame(
      stored,
      siblings.map((doc): Doc<"rounds"> => (doc._id === round._id ? { ...doc, ...patch } : doc)),
    );
    assertValid(candidate);

    await ctx.db.patch(round._id, patch);

    // A correction can un-finish a game as easily as finish one.
    const standing = gameStanding(candidate.rounds, candidate.config);
    await ctx.db.patch(args.gameId, {
      status: standing.isComplete ? "final" : "in_progress",
      updatedAt: Date.now(),
    });

    await recordEvent(
      ctx,
      args.gameId,
      caller.player?._id ?? null,
      "roundEdited",
      `Round ${args.index + 1} corrected`,
    );

    return { index: args.index, standing };
  },
});

/** Undo the most recent round — the common fix during live entry (§3.5). */
export const removeLastRound = mutation({
  args: { passcode: v.string(), gameId: v.id("games") },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
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
      caller.player?._id ?? null,
      "roundUndone",
      `Round ${last.index + 1} undone`,
    );
  },
});

/** Soft delete only (§3.2.4). The row stays; history hides it. */
export const softDelete = mutation({
  args: { passcode: v.string(), gameId: v.id("games") },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
    await ctx.db.patch(args.gameId, { deletedAt: Date.now(), updatedAt: Date.now() });
    await recordEvent(
      ctx,
      args.gameId,
      caller.player?._id ?? null,
      "deleted",
      "Game deleted",
    );
  },
});

export const restore = mutation({
  args: { passcode: v.string(), gameId: v.id("games") },
  handler: async (ctx, args) => {
    const caller = await assertAdmin(ctx, args.passcode);
    await ctx.db.patch(args.gameId, { deletedAt: undefined, updatedAt: Date.now() });
    await recordEvent(
      ctx,
      args.gameId,
      caller.player?._id ?? null,
      "restored",
      "Game restored",
    );
  },
});

export const setNotes = mutation({
  args: { passcode: v.string(), gameId: v.id("games"), notes: v.string() },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
    await ctx.db.patch(args.gameId, { notes: args.notes, updatedAt: Date.now() });
  },
});
