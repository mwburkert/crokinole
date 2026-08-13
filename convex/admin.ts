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

import { MAX_NAME_LENGTH, normaliseName } from "@crokinole/core";

import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { assertAdmin, assertAllowlisted, invitePasscodes } from "./lib/auth";
import { nicknameOf, resolveNickname } from "./lib/players";

const roleValidator = v.union(v.literal("admin"), v.literal("player"));

const normalise = (email: string): string => email.trim().toLowerCase();

/**
 * The one account other admins cannot touch.
 *
 * Read from `SUPER_ADMIN_EMAIL` in the Convex environment rather than hardcoded
 * — this repo is public (§2.0), and a personal address baked into source is
 * scraped within the day. Set it in the Convex dashboard.
 */
function superAdminEmail(): string {
  return (process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
}

export const isSuperAdmin = (email: string): boolean => {
  const owner = superAdminEmail();
  return owner !== "" && normalise(email) === owner;
};

/**
 * Throw if `target` is the super admin and the caller isn't them.
 *
 * Applies to every mutating path — role, name, email, revoke — so a second
 * admin can't quietly rename or lock out the owner. Exported for
 * `players.updateNames`, which writes the same nickname this file's
 * `updateProfile` does: a guard that only half the doors carry is not a guard,
 * and the settings screen having moved onto `updateProfile` is not a reason to
 * leave the other door open.
 *
 * 🕐 A null `callerEmail` means the shared passphrase, which carries no
 * identity. The guard is allowed rather than refused in that case, and the
 * reason is worth stating: with one shared secret there is no "second admin" to
 * protect the owner *from* — every holder is already the same, single trust
 * level. Refusing here would only stop the owner editing their own row from
 * their own app. The guard becomes real again the moment identities do.
 */
export function assertMayEdit(callerEmail: string | null, targetEmail: string): void {
  if (callerEmail === null) return;
  if (isSuperAdmin(targetEmail) && !isSuperAdmin(callerEmail)) {
    throw new Error("That account is managed by its owner and can't be changed here.");
  }
}

/**
 * Refuse to remove the last admin.
 *
 * The identity-based version of this guard ("you can't demote yourself") can't
 * fire under the shared passphrase, because there is no self to compare
 * against. This one needs no identity: it just counts. Ending up with an
 * allowlist that has no admin in it is only recoverable from the Convex
 * dashboard.
 */
async function assertNotLastAdmin(ctx: MutationCtx, email: string): Promise<void> {
  const entries = await ctx.db.query("allowlist").collect();
  const remaining = entries.filter(
    (entry) => entry.role === "admin" && entry.email !== email,
  );
  if (remaining.length === 0) {
    throw new Error("That's the last admin — promote someone else first.");
  }
}

/**
 * Everyone the settings screen can act on: one row per **player**, joined to
 * their allowlist entry if they have one, plus any allowlist entry with no
 * player behind it.
 *
 * It used to be the other way round — one row per allowlist entry — which was
 * right when everyone arrived through an invite. Under the shared passphrase
 * nobody has an email and nobody signs in, so an allowlist-first list showed
 * "Nobody yet" while five real players sat in the database, unnameable and
 * unfixable from the UI. A person with no login is still a person (§3.6); the
 * allowlist answers *what they may do*, not *whether they exist*.
 *
 * `email` and `role` are therefore nullable: null means "no login yet", which
 * is every player today.
 */
export const listMembers = query({
  args: { passcode: v.string() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.passcode);

    const entries = await ctx.db.query("allowlist").collect();
    const players = await ctx.db.query("players").collect();
    const entryByEmail = new Map(entries.map((entry) => [entry.email, entry]));
    const claimed = new Set<string>();

    const rows = players.map((player) => {
      const entry = player.email ? entryByEmail.get(player.email) : undefined;
      if (entry) claimed.add(entry.email);
      return {
        playerId: player._id as string | null,
        /** The nickname — what every screen shows. */
        displayName: nicknameOf(player) as string | null,
        firstName: (player.firstName ?? null) as string | null,
        lastName: (player.lastName ?? null) as string | null,
        email: player.email ?? null,
        role: entry?.role ?? null,
        invitedAt: entry?.invitedAt ?? player.createdAt,
        isActive: player.isActive,
        /** True once they've actually signed in at least once. */
        hasSignedIn: Boolean(player.authSubject),
        /** Drives the UI hiding edit controls rather than failing on submit. */
        isSuperAdmin: player.email ? isSuperAdmin(player.email) : false,
      };
    });

    // An allowlist entry with no player row shouldn't happen — `invite` always
    // creates one — but if it ever does, showing it is how it gets fixed.
    for (const entry of entries) {
      if (claimed.has(entry.email)) continue;
      rows.push({
        playerId: null,
        displayName: null,
        firstName: null,
        lastName: null,
        email: entry.email,
        role: entry.role,
        invitedAt: entry.invitedAt,
        isActive: false,
        hasSignedIn: false,
        isSuperAdmin: isSuperAdmin(entry.email),
      });
    }

    return rows.sort((a, b) =>
      (a.displayName ?? a.email ?? "").localeCompare(b.displayName ?? b.email ?? ""),
    );
  },
});

/**
 * 🕐 TEMPORARY (§7.1) — the two shared codes, so an admin can hand out either
 * kind of invite. Goes with the passphrase when Cloudflare Access lands.
 *
 * ⚠️ **This is a secret leaving the server, so read the reasoning before
 * touching it.** The settings screen offers a toggle between an admin invite and
 * a player invite, and the QR has to carry the *chosen* code. The browser only
 * ever holds one: an admin's localStorage has `ADMIN_PASSCODE`, so the player
 * code is not derivable client-side. Something has to return it.
 *
 * Why that is safe to return *to an admin*: under the interim the tier is the
 * whole of the capability model (`convex/lib/auth.ts`), and an admin already
 * holds every capability the player code confers — `assertAdmin` is
 * `assertAllowlisted` plus a strictly narrower role. Handing them the weaker
 * secret grants them nothing they did not already have.
 *
 * Why it is still gated rather than open: it is a **secret**, and the player
 * tier learning `ADMIN_PASSCODE` would be a straight privilege escalation — the
 * one thing the two-code split exists to prevent. So `assertAdmin` is the first
 * statement, before any argument is read, and a player-tier caller is refused
 * outright. The web app skips this subscription entirely for a non-admin (a
 * throwing `useQuery` takes the whole app down), and its invite card falls back
 * to the code that caller already holds — no toggle, no admin QR, no throw.
 */
export const inviteCodes = query({
  args: { passcode: v.string() },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.passcode);
    return invitePasscodes();
  },
});

/**
 * Permit an email, creating the player record at the same time so they can be
 * picked for a game before they've ever opened the app (§3.6 — players are
 * people, not logins).
 */
export const invite = mutation({
  args: {
    passcode: v.string(),
    email: v.string(),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    nickname: v.optional(v.string()),
    role: v.optional(roleValidator),
  },
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.passcode);

    const email = normalise(args.email);
    const firstName = normaliseName(args.firstName);
    const lastName = normaliseName(args.lastName ?? "") || undefined;
    if (!email.includes("@")) throw new Error("That doesn't look like an email address.");
    if (!firstName) throw new Error("Give them a name so they can be picked for a game.");

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

    const existingPlayers = await ctx.db.query("players").collect();
    return await ctx.db.insert("players", {
      firstName,
      ...(lastName ? { lastName } : {}),
      nickname: resolveNickname(args.nickname, firstName, lastName, existingPlayers),
      email,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

/**
 * Edit a person: their real name, the nickname every screen shows, and their
 * email. **The one write behind every editor on the settings screen.**
 *
 * Non-admins reach this for themselves only — that's the whole of the settings
 * screen for a regular player.
 *
 * ⚠️ It gained `firstName` / `lastName` / `nickname` because the row editor now
 * offers all four fields, and the alternative was two mutations per Save:
 * `players.updateNames` for the names and this one for the email. Two writes
 * for one form is two round trips and — worse — two outcomes, so a refusal on
 * the second would leave the names changed and the address not, with the UI
 * showing one error over a half-applied edit. Consolidating here rather than
 * there is deliberate: this handler is the one holding `assertMayEdit`'s
 * super-admin protection *and* the allowlist email move, and an email cannot be
 * changed without both.
 *
 * `displayName` is kept as an alias for `nickname` and must not be removed: the
 * currently-deployed web build still sends it, and this deployment is the one
 * the owner's phone is pointed at. `nickname` wins when both arrive.
 */
export const updateProfile = mutation({
  args: {
    passcode: v.string(),
    playerId: v.id("players"),
    /** 🕐 Legacy alias for `nickname`, kept so an older client keeps working. */
    displayName: v.optional(v.string()),
    firstName: v.optional(v.string()),
    /** Empty clears it — a surname typed by mistake has to be removable. */
    lastName: v.optional(v.string()),
    /** The nickname — what every screen shows. */
    nickname: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const caller = await assertAllowlisted(ctx, args.passcode);
    const player = await ctx.db.get(args.playerId);
    if (!player) throw new Error("Player not found.");

    // 🕐 With no identity there is no "self", so this is false under the shared
    // passphrase — where `role` is always admin, and the next check passes.
    const editingSelf = player._id === caller.player?._id;
    if (!editingSelf && caller.role !== "admin") {
      throw new Error("You can only edit your own details.");
    }
    if (player.email) assertMayEdit(caller.email, player.email);

    const patch: {
      firstName?: string;
      lastName?: string | undefined;
      nickname?: string;
      email?: string;
    } = {};

    if (args.firstName !== undefined) {
      const firstName = normaliseName(args.firstName);
      if (!firstName) throw new Error("A player needs a first name.");
      patch.firstName = firstName;
    }

    if (args.lastName !== undefined) {
      // Explicit `undefined` removes the field rather than storing "", so a
      // cleared surname is absent everywhere instead of rendering as a gap.
      patch.lastName = normaliseName(args.lastName) || undefined;
    }

    const nickname = args.nickname ?? args.displayName;
    if (nickname !== undefined) {
      const normalised = normaliseName(nickname);
      if (!normalised) throw new Error("A player needs a nickname — it's what everyone sees.");
      if (normalised.length > MAX_NAME_LENGTH) {
        throw new Error(`Nicknames are capped at ${MAX_NAME_LENGTH} characters.`);
      }
      patch.nickname = normalised;
    }

    if (args.email !== undefined) {
      const email = normalise(args.email);
      if (!email.includes("@")) throw new Error("That doesn't look like an email address.");

      // The allowlist is keyed by email, so changing one has to move the other
      // or they'd be permitted under an address they no longer hold.
      if (player.email && player.email !== email) {
        const entry = await ctx.db
          .query("allowlist")
          .withIndex("by_email", (q) => q.eq("email", player.email as string))
          .unique();
        if (entry) await ctx.db.patch(entry._id, { email });
      }
      patch.email = email;
    }

    await ctx.db.patch(args.playerId, patch);
  },
});

export const setRole = mutation({
  args: { passcode: v.string(), email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const caller = await assertAdmin(ctx, args.passcode);
    const email = normalise(args.email);
    assertMayEdit(caller.email, email);

    if (args.role !== "admin") {
      if (email === caller.email) {
        // Locking yourself out of the only admin account is unrecoverable
        // without opening the Convex dashboard.
        throw new Error("You can't remove your own admin role.");
      }
      await assertNotLastAdmin(ctx, email);
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
  args: { passcode: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const caller = await assertAdmin(ctx, args.passcode);
    const email = normalise(args.email);
    assertMayEdit(caller.email, email);

    if (email === caller.email) throw new Error("You can't revoke your own access.");
    await assertNotLastAdmin(ctx, email);

    const entry = await ctx.db
      .query("allowlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!entry) throw new Error(`${email} isn't on the list.`);

    await ctx.db.delete(entry._id);
  },
});
