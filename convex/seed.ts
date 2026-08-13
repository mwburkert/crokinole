/**
 * Seeding the real history (§3.9).
 *
 * Internal only — `internalMutation` is not reachable from the browser at all,
 * so this needs no passcode and can never be triggered by someone who found the
 * deployment URL. Run it from a machine with the CLI logged in:
 *
 *   npx convex run seed:firstNight
 *
 * **Idempotent, and additive only.** It never deletes anything. Re-running it
 * after the night is already in place is a no-op that reports what it found —
 * money is involved (§3.2.4), and a seed script that "resets" is one mis-typed
 * command away from erasing a real evening.
 */

import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { configFor } from "@crokinole/core";

import { FIRST_NIGHT_GAMES, FIRST_NIGHT_PLAYERS, playedAt, roundsFor } from "./lib/firstNight";

export const firstNight = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // ---- Players -----------------------------------------------------------
    // Matched by nickname, because these five have no emails yet — that's the
    // whole point of a player row existing without a login (§3.6).
    const existing = await ctx.db.query("players").collect();
    const byName = new Map(existing.map((player) => [player.nickname, player]));
    const idBySlug = new Map<string, Id<"players">>();
    let playersCreated = 0;

    for (const player of FIRST_NIGHT_PLAYERS) {
      const found = byName.get(player.nickname);
      if (found) {
        idBySlug.set(player.slug, found._id);
        continue;
      }
      const id = await ctx.db.insert("players", {
        firstName: player.firstName,
        ...(player.lastName ? { lastName: player.lastName } : {}),
        nickname: player.nickname,
        isActive: true,
        createdAt: now,
      });
      idBySlug.set(player.slug, id);
      playersCreated += 1;
    }

    // ---- Games -------------------------------------------------------------
    // Identified by when they were played. Timestamps are fixed in UTC by
    // `firstNight.ts`, so re-running this finds the same five games rather than
    // inserting a second copy of the night.
    const storedGames = await ctx.db.query("games").collect();
    const seenPlayedAt = new Set(storedGames.map((game) => game.playedAt));
    const config = configFor("doubles");
    let gamesCreated = 0;
    let roundsCreated = 0;

    for (const seed of FIRST_NIGHT_GAMES) {
      const at = playedAt(seed);
      if (seenPlayedAt.has(at)) continue;

      const teamA = seed.a.map((slug) => idBySlug.get(slug)!);
      const teamB = seed.b.map((slug) => idBySlug.get(slug)!);

      const gameId = await ctx.db.insert("games", {
        playedAt: at,
        status: "final",
        config,
        teams: {
          A: { color: "black", playerIds: teamA },
          B: { color: "white", playerIds: teamB },
        },
        bets: [...teamA, ...teamB].map((playerId) => ({
          playerId,
          amountCents: seed.betCents,
        })),
        defaultBetCents: seed.betCents,
        // `createdBy` is deliberately absent: this night was played before the
        // app existed, so nobody entered it.
        createdAt: now,
        updatedAt: now,
      });
      gamesCreated += 1;

      for (const round of roundsFor(seed.outcomes)) {
        await ctx.db.insert("rounds", {
          gameId,
          index: round.index,
          A: round.A,
          B: round.B,
          // Outcome only. The points were never recorded, and recording them as
          // 0–0 would be a claim that nobody scored — see `lib/firstNight.ts`.
          ...(round.resultOverride ? { resultOverride: round.resultOverride } : {}),
          createdAt: now,
          updatedAt: now,
        });
        roundsCreated += 1;
      }

      await ctx.db.insert("gameEvents", {
        gameId,
        kind: "imported",
        summary: "Seeded from the 5 August 2026 recap",
        at: now,
      });
    }

    return {
      playersCreated,
      gamesCreated,
      roundsCreated,
      playersTotal: idBySlug.size,
      alreadyPresent: FIRST_NIGHT_GAMES.length - gamesCreated,
    };
  },
});

/**
 * The regulars.
 *
 * ⚠️ **Matches existing players by nickname and patches in place.** It must
 * never insert a second row for someone already here: the five from the 5
 * August night own that night's history through their player id, and a
 * duplicate would fork it — half the games on one row, half on another, both
 * copies' stats quietly wrong.
 *
 * The existing five keep their nicknames exactly as they are rather than having
 * them recomputed. "Burkert" and "Burton" are *already* the answer to the
 * collision rule — two Matts, so they go by surname — and regenerating them
 * would rename two people who are known by those names.
 *
 * Idempotent: re-running patches the same rows to the same values and inserts
 * nobody twice. This is also what populated `firstName`/`lastName`/`nickname`
 * when the single `displayName` field was split.
 */
export const roster = internalMutation({
  args: {},
  handler: async (ctx) => {
    const roster: { firstName: string; lastName?: string; nickname: string }[] = [
      { firstName: "Kinsey", lastName: "Mead", nickname: "Kinsey" },
      { firstName: "Matt", lastName: "Burkert", nickname: "Burkert" },
      { firstName: "Matt", lastName: "Burton", nickname: "Burton" },
      { firstName: "Spencer", lastName: "Herrick", nickname: "Spencer" },
      // No surname was given for Marley.
      { firstName: "Marley", nickname: "Marley" },
      { firstName: "Amberly", lastName: "Malone", nickname: "Amberly" },
      { firstName: "Adam", lastName: "Berman", nickname: "Adam" },
    ];

    const players = await ctx.db.query("players").collect();
    const byNickname = new Map(players.map((player) => [player.nickname, player]));

    let patched = 0;
    let created = 0;

    for (const entry of roster) {
      const existing = byNickname.get(entry.nickname);
      if (existing) {
        await ctx.db.patch(existing._id, {
          firstName: entry.firstName,
          ...(entry.lastName ? { lastName: entry.lastName } : {}),
          nickname: entry.nickname,
        });
        patched += 1;
        continue;
      }
      await ctx.db.insert("players", {
        firstName: entry.firstName,
        ...(entry.lastName ? { lastName: entry.lastName } : {}),
        nickname: entry.nickname,
        isActive: true,
        createdAt: Date.now(),
      });
      created += 1;
    }

    return { patched, created, total: patched + created };
  },
});
