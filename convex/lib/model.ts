/**
 * Mapping between Convex documents and the plain-TS shapes `@crokinole/core`
 * works in.
 *
 * The rules engine deliberately knows nothing about Convex (§3.2.2), so this
 * is the one place the two meet. Everything downstream — totals, standings,
 * settlements, stats — is derived by core from these shapes.
 */

import { DEFAULT_SCORING, type GameWithRounds, type Round } from "@crokinole/core";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Convert a stored round into the shape core expects. */
export function toCoreRound(doc: Doc<"rounds">): Round {
  return {
    index: doc.index,
    A: doc.A,
    B: doc.B,
    ...(doc.pointsOverride ? { pointsOverride: doc.pointsOverride } : {}),
    ...(doc.resultOverride ? { resultOverride: doc.resultOverride } : {}),
    ...(doc.playerStats ? { playerStats: doc.playerStats } : {}),
  };
}

/** Convert a stored game plus its rounds into the shape core expects. */
export function toCoreGame(game: Doc<"games">, rounds: Doc<"rounds">[]): GameWithRounds {
  return {
    id: game._id,
    playedAt: game.playedAt,
    status: game.status,
    // `winBy` is optional in the stored schema so older snapshots still
    // validate; core needs a concrete value.
    config: { ...game.config, winBy: game.config.winBy ?? DEFAULT_SCORING.winBy },
    teams: game.teams,
    bets: game.bets,
    ...(game.notes !== undefined ? { notes: game.notes } : {}),
    ...(game.deletedAt !== undefined ? { deletedAt: game.deletedAt } : {}),
    rounds: [...rounds].sort((a, b) => a.index - b.index).map(toCoreRound),
  };
}

/** Load one game with its rounds attached. */
export async function loadGame(
  ctx: QueryCtx | MutationCtx,
  gameId: Id<"games">,
): Promise<GameWithRounds | null> {
  const game = await ctx.db.get(gameId);
  if (!game) return null;
  const rounds = await ctx.db
    .query("rounds")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
  return toCoreGame(game, rounds);
}

/**
 * Load every game with its rounds.
 *
 * At a few hundred games a year a full read is trivially cheap, and it's what
 * lets every statistic be derived rather than stored (§3.2.1). Revisit only if
 * the volume changes by an order of magnitude.
 */
export async function loadAllGames(
  ctx: QueryCtx | MutationCtx,
  options: { includeDeleted?: boolean } = {},
): Promise<GameWithRounds[]> {
  const games = await ctx.db.query("games").withIndex("by_playedAt").order("desc").collect();
  const visible = options.includeDeleted
    ? games
    : games.filter((game) => game.deletedAt === undefined);

  const out: GameWithRounds[] = [];
  for (const game of visible) {
    const rounds = await ctx.db
      .query("rounds")
      .withIndex("by_game", (q) => q.eq("gameId", game._id))
      .collect();
    out.push(toCoreGame(game, rounds));
  }
  return out;
}

/** Append to the audit trail. Money is involved; know who changed what. */
export async function recordEvent(
  ctx: MutationCtx,
  gameId: Id<"games">,
  actorPlayerId: Id<"players">,
  kind: string,
  summary: string,
): Promise<void> {
  await ctx.db.insert("gameEvents", {
    gameId,
    actorPlayerId,
    kind,
    summary,
    at: Date.now(),
  });
}
