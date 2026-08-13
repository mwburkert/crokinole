/**
 * Players (§3.3).
 *
 * A player row is a *person*, not a login. Rows exist for people who have never
 * opened the app — that's the point, since you'll be entering scores for
 * everyone at first. Linking an account later just sets `authSubject` on the
 * same row and history is preserved with zero migration (§3.6).
 *
 * Names are split three ways: `firstName` and `lastName` identify a person,
 * `nickname` is what every screen actually shows. See `lib/players.ts`.
 *
 * 🕐 Every public function takes `passcode` while the shared passphrase is the
 * auth model — see `convex/lib/auth.ts`.
 */

import { MAX_NAME_LENGTH, normaliseName } from "@crokinole/core";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { assertAdmin, assertAllowlisted, authError, linkAuthSubject } from "./lib/auth";
import { emailKey, nicknameOf, resolveNickname } from "./lib/players";

/** Everyone, newest activity last. Authenticated — there is no public route. */
export const list = query({
  args: { passcode: v.string(), includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
    const players = await ctx.db.query("players").collect();
    const visible = args.includeInactive ? players : players.filter((p) => p.isActive);
    return visible.sort((a, b) => nicknameOf(a).localeCompare(nicknameOf(b)));
  },
});

/**
 * Who am I? Drives the "created by" default and the admin-only affordances.
 *
 * 🕐 `player` and `email` are null under the shared passphrase: a shared secret
 * says what you may do, never who you are. The web app treats a null player as
 * "signed in as nobody in particular", which is exactly what it is.
 */
export const me = query({
  args: { passcode: v.string() },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
    return { player: caller.player, role: caller.role, email: caller.email };
  },
});

/**
 * Add someone, as an admin.
 *
 * **Email is optional here**, deliberately, and this is the difference from
 * `selfJoin`: an admin logs games for people who have never opened the app, so
 * requiring an address would block the common case (§3.6).
 */
export const create = mutation({
  args: {
    passcode: v.string(),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    /** Omitted means "pick one for me" — see `resolveNickname`. */
    nickname: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.passcode);

    const firstName = normaliseName(args.firstName);
    if (!firstName) throw new Error("A player needs a first name.");
    const lastName = normaliseName(args.lastName ?? "") || undefined;

    const email = emailKey(args.email);
    if (email !== undefined && !email.includes("@")) {
      throw new Error("That doesn't look like an email address.");
    }

    const existing = await ctx.db.query("players").collect();

    // Never split one person into two rows — their whole history hangs off this
    // id, and a duplicate silently halves both copies' stats.
    if (email !== undefined) {
      const clash = existing.find((player) => emailKey(player.email) === email);
      if (clash) return clash._id;
    }

    const nickname = resolveNickname(args.nickname, firstName, lastName, existing);
    if (nickname.length > MAX_NAME_LENGTH) {
      throw new Error(`Nicknames are capped at ${MAX_NAME_LENGTH} characters.`);
    }

    return await ctx.db.insert("players", {
      firstName,
      ...(lastName ? { lastName } : {}),
      nickname,
      ...(email !== undefined ? { email } : {}),
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

/**
 * Add yourself — the self-join flow behind the invite link.
 *
 * Open to the **player** tier as well as admin: joining is the one thing
 * somebody holding only the app code has to be able to do.
 *
 * **Email is required here**, unlike the admin path. This is the flow where a
 * person types their own details, so the address is what proves they are the
 * same person as an existing row rather than a second copy of them — which is
 * the difference between a returning player's history continuing and it
 * silently forking in two.
 */
export const selfJoin = mutation({
  args: {
    passcode: v.string(),
    email: v.string(),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    nickname: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);

    const email = emailKey(args.email);
    if (email === undefined || !email.includes("@")) {
      throw new Error("That doesn't look like an email address.");
    }
    const firstName = normaliseName(args.firstName);
    if (!firstName) throw new Error("A player needs a first name.");
    const lastName = normaliseName(args.lastName ?? "") || undefined;

    const existing = await ctx.db.query("players").collect();
    const mine = existing.find((player) => emailKey(player.email) === email);

    const nickname = resolveNickname(
      args.nickname,
      firstName,
      lastName,
      // Their own row must not count as a collision with itself, or re-joining
      // would walk a perfectly good nickname along to "Matt 2".
      existing.filter((player) => player._id !== mine?._id),
    );
    if (nickname.length > MAX_NAME_LENGTH) {
      throw new Error(`Nicknames are capped at ${MAX_NAME_LENGTH} characters.`);
    }

    if (mine) {
      // Already known: update rather than duplicate, so the history attached to
      // this row survives. This is what the email is *for*.
      await ctx.db.patch(mine._id, {
        firstName,
        lastName,
        nickname,
        isActive: true,
      });
      return { playerId: mine._id, created: false };
    }

    const playerId = await ctx.db.insert("players", {
      firstName,
      ...(lastName ? { lastName } : {}),
      nickname,
      email,
      isActive: true,
      createdAt: Date.now(),
    });
    return { playerId, created: true };
  },
});

/**
 * Look someone up by email so the join form can fill itself in.
 *
 * Returns names only — never the auth subject, never anything about anyone
 * else. Behind the passcode like everything else (§3.2.5). The alternative is
 * worse: without it a returning player retypes their details and the form has
 * no way to know they already exist, which is exactly how one person becomes
 * two rows and a night's stats split down the middle.
 */
export const byEmail = query({
  args: { passcode: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
    const email = emailKey(args.email);
    if (email === undefined) return null;

    const players = await ctx.db.query("players").collect();
    const found = players.find((player) => emailKey(player.email) === email);
    if (!found) return null;
    return {
      playerId: found._id,
      firstName: found.firstName ?? "",
      lastName: found.lastName ?? null,
      nickname: nicknameOf(found),
    };
  },
});

export const updateNames = mutation({
  args: {
    passcode: v.string(),
    playerId: v.id("players"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    nickname: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
    const player = await ctx.db.get(args.playerId);
    if (!player) throw new Error("Player not found.");

    // 🕐 A player-tier caller has no identity, so "is this me?" has no answer
    // and editing names is an admin action. The tier says what you may do; it
    // cannot stand in for who you are.
    if (caller.role !== "admin" && caller.player?._id !== args.playerId) {
      throw authError("NOT_ALLOWED", "You can only edit your own details.");
    }

    const patch: { firstName?: string; lastName?: string; nickname?: string } = {};

    if (args.firstName !== undefined) {
      const firstName = normaliseName(args.firstName);
      if (!firstName) throw new Error("A player needs a first name.");
      patch.firstName = firstName;
    }
    if (args.lastName !== undefined) patch.lastName = normaliseName(args.lastName);
    if (args.nickname !== undefined) {
      const nickname = normaliseName(args.nickname);
      if (!nickname) throw new Error("A player needs a nickname — it's what everyone sees.");
      if (nickname.length > MAX_NAME_LENGTH) {
        throw new Error(`Nicknames are capped at ${MAX_NAME_LENGTH} characters.`);
      }
      patch.nickname = nickname;
    }

    await ctx.db.patch(args.playerId, patch);
  },
});

/** Retire a regular without losing their history. Admin-only. */
export const setActive = mutation({
  args: { passcode: v.string(), playerId: v.id("players"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.passcode);
    await ctx.db.patch(args.playerId, { isActive: args.isActive });
  },
});

/** Claim a player row for the signed-in identity. */
export const claim = mutation({
  args: { passcode: v.string(), playerId: v.id("players") },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
    const identity = await ctx.auth.getUserIdentity();
    // 🕐 A shared secret carries no identity, so there is nobody to bind the row
    // to and no way to tell two holders of the same code apart. Claiming is the
    // one thing a tier explicitly cannot stand in for.
    if (!identity) throw new Error("Claiming a player needs a real sign-in.");

    /*
     * ⚠️ Fails closed on a null caller, deliberately.
     *
     * This used to read `if (caller.player && caller.player._id !== ...)`, which
     * short-circuits to *no check at all* when `caller.player` is null — so a
     * caller with no resolved player could claim any row in the table and take
     * over someone else's history. It was unreachable only because the
     * `!identity` throw above happens to come first. One reordering, or one
     * future path where an identity resolves without a player row, and it is a
     * full account takeover. A guard whose safety depends on an earlier line is
     * not a guard.
     */
    if (!caller.player) {
      throw authError("NOT_ALLOWED", "No player record for this account.");
    }
    if (caller.player._id !== args.playerId) {
      await assertAdmin(ctx, args.passcode);
    }
    await linkAuthSubject(ctx, args.playerId, identity.subject);
  },
});
