/**
 * Players (§3.3).
 *
 * A player row is a *person*, not a login. Rows exist for people who have never
 * opened the app — that's the point, since you'll be entering scores for
 * everyone at first. Linking an account later just sets `authSubject` on the
 * same row and history is preserved with zero migration (§3.6).
 *
 * 🕐 Every public function takes `passcode` while the shared passphrase is the
 * auth model — see `convex/lib/auth.ts`.
 */

import { MAX_NAME_LENGTH } from "@crokinole/core";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { assertAdmin, assertAllowlisted, linkAuthSubject } from "./lib/auth";

/** Everyone, newest activity last. Authenticated — there is no public route. */
export const list = query({
  args: { passcode: v.string(), includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
    const players = await ctx.db.query("players").collect();
    const visible = args.includeInactive ? players : players.filter((p) => p.isActive);
    return visible.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

/**
 * Who am I? Drives the "created by" default and the admin-only affordances.
 *
 * 🕐 `player` and `email` are null under the shared passphrase: one shared
 * secret says you are permitted, never who you are. The web app treats a null
 * player as "signed in as nobody in particular", which is exactly what it is.
 */
export const me = query({
  args: { passcode: v.string() },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
    return { player: caller.player, role: caller.role, email: caller.email };
  },
});

export const create = mutation({
  args: {
    passcode: v.string(),
    displayName: v.string(),
    shortName: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
    const displayName = args.displayName.trim();
    if (!displayName) throw new Error("A player needs a name.");
    if (displayName.length > MAX_NAME_LENGTH) {
      throw new Error(`Names are capped at ${MAX_NAME_LENGTH} characters.`);
    }

    return await ctx.db.insert("players", {
      displayName,
      ...(args.shortName ? { shortName: args.shortName.trim() } : {}),
      ...(args.email ? { email: args.email.trim().toLowerCase() } : {}),
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: {
    passcode: v.string(),
    playerId: v.id("players"),
    displayName: v.string(),
    shortName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx, args.passcode);
    const displayName = args.displayName.trim();
    if (!displayName) throw new Error("A player needs a name.");
    await ctx.db.patch(args.playerId, {
      displayName,
      ...(args.shortName !== undefined ? { shortName: args.shortName.trim() } : {}),
    });
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
    // 🕐 Under the shared passphrase there is no identity to claim a row with,
    // and no way to tell two holders of the secret apart to stop one claiming
    // the other's history.
    if (!identity) throw new Error("Claiming a player needs a real sign-in.");
    if (caller.player && caller.player._id !== args.playerId) {
      await assertAdmin(ctx, args.passcode);
    }
    await linkAuthSubject(ctx, args.playerId, identity.subject);
  },
});
