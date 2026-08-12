/**
 * Convex schema (§3.3).
 *
 * **Scores and stats are never stored.** Only raw ring counts per team per
 * round live here; every total, differential, match point, standing, and
 * lifetime stat is computed on read by `@crokinole/core` (§3.2.1). If you find
 * yourself adding a `score` column, you've misread the design.
 *
 * Fields marked (P2) exist now so Phase 2 drops in without a migration, but
 * aren't exercised by any Phase 1 UI (§3.9).
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const ringCounts = v.object({
  twenties: v.number(),
  fifteens: v.number(),
  tens: v.number(),
  fives: v.number(),
});

export default defineSchema({
  /**
   * The canonical person. Owns all stats and survives the transition from
   * "someone I log games for" to "someone with a login" — a row can exist with
   * no `authSubject` at all, which is essential because you'll be entering
   * scores for everyone at first (§3.6).
   */
  players: defineTable({
    displayName: v.string(),
    /** Short form for tight mobile tables. */
    shortName: v.optional(v.string()),
    email: v.optional(v.string()),
    /**
     * The `sub` claim from the Cloudflare Access JWT.
     *
     * §3.3 originally had `authUserId: v.id("users")`, which assumed Convex
     * Auth. We use the Access JWT as the identity provider instead (§7.1), so
     * there is no `users` table — the subject is an opaque string.
     */
    authSubject: v.optional(v.string()),
    /** Hide retired regulars from the player picker without losing history. */
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_auth", ["authSubject"])
    .index("by_email", ["email"]),

  /**
   * Roles, not membership.
   *
   * Who may reach the app at all is decided by the `Crokinole Players`
   * Cloudflare Access Group (§7.1) — keeping a second copy of that email list
   * here would just let the two drift. This table answers "what may they do",
   * and doubles as a kill switch you can flip without touching Cloudflare.
   */
  allowlist: defineTable({
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("player")),
    invitedAt: v.number(),
  }).index("by_email", ["email"]),

  games: defineTable({
    /** The night it was played, not when the row was created. */
    playedAt: v.number(),
    status: v.union(v.literal("in_progress"), v.literal("final")),
    /**
     * Snapshot of the rules in force (§3.2.3). Old games keep scoring by the
     * rules they were played under, forever.
     */
    config: v.object({
      format: v.union(v.literal("doubles"), v.literal("singles")),
      ringValues: v.object({
        twenty: v.number(),
        fifteen: v.number(),
        ten: v.number(),
        five: v.number(),
      }),
      matchPointsWin: v.number(),
      matchPointsTie: v.number(),
      targetMatchPoints: v.number(),
      /**
       * How far ahead the leader must be to take the game. 2 = win-by-two.
       * Optional so a game snapshotted before this existed still validates;
       * `toCoreGame` fills the default on read.
       */
      winBy: v.optional(v.number()),
      /** 6 doubles / 8 singles. `discsPerTeam` is derived, never stored. */
      discsPerPlayer: v.number(),
    }),
    teams: v.object({
      A: v.object({
        color: v.union(v.literal("black"), v.literal("white")),
        playerIds: v.array(v.id("players")),
      }),
      B: v.object({
        color: v.union(v.literal("black"), v.literal("white")),
        playerIds: v.array(v.id("players")),
      }),
    }),
    /** One entry per player in the game. */
    bets: v.array(
      v.object({
        playerId: v.id("players"),
        amountCents: v.number(),
      }),
    ),
    /** Drives the autofill on the entry screen. */
    defaultBetCents: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdBy: v.id("players"),
    createdAt: v.number(),
    updatedAt: v.number(),
    /** Soft delete only (§3.2.4). Money is involved; a mis-tap must be recoverable. */
    deletedAt: v.optional(v.number()),
  })
    .index("by_playedAt", ["playedAt"])
    .index("by_status", ["status"]),

  rounds: defineTable({
    gameId: v.id("games"),
    /** 0-based. */
    index: v.number(),
    A: ringCounts,
    B: ringCounts,
    /**
     * Where each disc came to rest (§3.5).
     *
     * ⚠️ The one stored value in this app that isn't a raw input and isn't
     * derived — position cannot be recovered from ring counts. The rule that
     * keeps the two honest: **when `discs` is present it is the source of
     * truth, and A/B are recomputed from it by `countsFromDiscs` on every
     * write.** A round typed into the manual menu simply has no `discs`, and
     * its counts stand alone.
     */
    discs: v.optional(
      v.array(
        v.object({
          id: v.string(),
          color: v.union(v.literal("black"), v.literal("white")),
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
      ),
    ),
    /** Quick-entry escape hatch: overrides the derived total when set. */
    pointsOverride: v.optional(
      v.object({ A: v.optional(v.number()), B: v.optional(v.number()) }),
    ),
    playerStats: v.optional(
      v.array(
        v.object({
          playerId: v.id("players"),
          twenties: v.optional(v.number()),
          fouls: v.optional(v.number()), // (P2)
          spencers: v.optional(v.number()), // (P2)
          kinseys: v.optional(v.number()), // (P2)
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_game", ["gameId", "index"]),

  /** Append-only audit trail. Money is involved; know who changed what. */
  gameEvents: defineTable({
    gameId: v.id("games"),
    actorPlayerId: v.id("players"),
    /** "created" | "roundAdded" | "roundEdited" | "deleted" | "restored" | ... */
    kind: v.string(),
    summary: v.string(),
    at: v.number(),
  }).index("by_game", ["gameId"]),
});
