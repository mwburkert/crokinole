/**
 * Players (§3.3).
 *
 * A player row is a *person*, not a login. Rows exist for people who have never
 * opened the app — that's the point, since you'll be entering scores for
 * everyone at first. Linking an account later just sets `authSubject` on the
 * same row and history is preserved with zero migration (§3.6).
 */

import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { assertAdmin, assertAllowlisted, linkAuthSubject } from "./lib/auth";

/** Everyone, newest activity last. Authenticated — there is no public route. */
export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx);
    const players = await ctx.db.query("players").collect();
    const visible = args.includeInactive ? players : players.filter((p) => p.isActive);
    return visible.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

/** Who am I? Drives the "created by" default and the admin-only affordances. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const caller = await assertAllowlisted(ctx);
    return { player: caller.player, role: caller.role, email: caller.email };
  },
});

export const create = mutation({
  args: {
    displayName: v.string(),
    shortName: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx);
    const displayName = args.displayName.trim();
    if (!displayName) throw new Error("A player needs a name.");

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
    playerId: v.id("players"),
    displayName: v.string(),
    shortName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertAllowlisted(ctx);
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
  args: { playerId: v.id("players"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    await ctx.db.patch(args.playerId, { isActive: args.isActive });
  },
});

/** Claim a player row for the signed-in identity. */
export const claim = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");
    if (caller.player._id !== args.playerId) {
      await assertAdmin(ctx);
    }
    await linkAuthSubject(ctx, args.playerId, identity.subject);
  },
});
