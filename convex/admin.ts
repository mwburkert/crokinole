/**
 * Admin — managing who may use the app (§3.6).
 *
 * ⚠️ **There are two lists, and this file only owns one of them.**
 *
 * 1. The **Cloudflare Access Group** (`Crokinole Players`) decides who can
 *    *reach* the app at all. Access gates the whole hostname, so someone who
 *    isn't in that group never gets far enough to talk to Convex.
 * 2. The **`allowlist` table here** decides what someone may *do* once they're
 *    through — player or admin — and doubles as a kill switch you can flip
 *    without touching Cloudflare.
 *
 * So adding an email here does **not** grant access on its own. The admin UI
 * says so plainly rather than hiding it; see `AdminScreen.tsx`.
 *
 * Once the Zero Trust team exists this becomes one step: a Convex action can
 * PUT the updated member list to
 * `/accounts/{account_id}/access/groups/{group_id}` with an API token scoped to
 * Access groups. Deliberately not built yet — the group doesn't exist, so there
 * is nothing to write to and nothing to test against.
 */

import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { assertAdmin } from "./lib/auth";

const roleValidator = v.union(v.literal("admin"), v.literal("player"));

const normalise = (email: string): string => email.trim().toLowerCase();

/** Everyone permitted, with their player record if one exists. */
export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    await assertAdmin(ctx);

    const entries = await ctx.db.query("allowlist").collect();
    const players = await ctx.db.query("players").collect();
    const byEmail = new Map(
      players.filter((p) => p.email).map((p) => [p.email as string, p]),
    );

    return entries
      .map((entry) => {
        const player = byEmail.get(entry.email);
        return {
          email: entry.email,
          role: entry.role,
          invitedAt: entry.invitedAt,
          playerId: player?._id ?? null,
          displayName: player?.displayName ?? null,
          isActive: player?.isActive ?? false,
          /** True once they've actually signed in at least once. */
          hasSignedIn: Boolean(player?.authSubject),
        };
      })
      .sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email));
  },
});

/**
 * Permit an email, creating the player record at the same time so they can be
 * picked for a game before they've ever opened the app (§3.6 — players are
 * people, not logins).
 */
export const invite = mutation({
  args: {
    email: v.string(),
    displayName: v.string(),
    role: v.optional(roleValidator),
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);

    const email = normalise(args.email);
    const displayName = args.displayName.trim();
    if (!email.includes("@")) throw new Error("That doesn't look like an email address.");
    if (!displayName) throw new Error("Give them a name so they can be picked for a game.");

    const existing = await ctx.db
      .query("allowlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) throw new Error(`${email} is already on the list.`);

    await ctx.db.insert("allowlist", {
      email,
      role: args.role ?? "player",
      invitedAt: Date.now(),
    });

    // Reuse an existing player row if one already has this email — never create
    // a duplicate person, or their history splits in two.
    const player = await ctx.db
      .query("players")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (player) {
      if (!player.isActive) await ctx.db.patch(player._id, { isActive: true });
      return player._id;
    }

    return await ctx.db.insert("players", {
      displayName,
      email,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const setRole = mutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const caller = await assertAdmin(ctx);
    const email = normalise(args.email);

    if (email === caller.email && args.role !== "admin") {
      // Locking yourself out of the only admin account is unrecoverable without
      // opening the Convex dashboard.
      throw new Error("You can't remove your own admin role.");
    }

    const entry = await ctx.db
      .query("allowlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!entry) throw new Error(`${email} isn't on the list.`);

    await ctx.db.patch(entry._id, { role: args.role });
  },
});

/**
 * Revoke access. **Keeps the player row and all their history** — this removes
 * permission, it does not erase a person. Their past games still score.
 */
export const revoke = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const caller = await assertAdmin(ctx);
    const email = normalise(args.email);

    if (email === caller.email) throw new Error("You can't revoke your own access.");

    const entry = await ctx.db
      .query("allowlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!entry) throw new Error(`${email} isn't on the list.`);

    await ctx.db.delete(entry._id);
  },
});
