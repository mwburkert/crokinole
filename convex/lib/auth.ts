/**
 * The security boundary (§3.2.5).
 *
 * ⚠️ **Cloudflare Access does not protect Convex.** The browser opens a
 * WebSocket straight to `*.convex.cloud`, on a host Cloudflare never sees.
 * Every query and mutation is a public internet endpoint. `assertAllowlisted`
 * is the only thing standing between the internet and this data — there is no
 * second line of defence, and no public route in Phase 1 (§3.5).
 *
 * `ctx.auth.getUserIdentity()` returns null unless the JWT's signature, issuer,
 * **and AUD** all check out against `auth.config.ts`, so a token issued for one
 * of the sibling apps is rejected here automatically.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export interface Caller {
  email: string;
  player: Doc<"players">;
  role: "admin" | "player";
}

/** Raised when a caller is unauthenticated or not permitted. */
export class NotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAllowedError";
  }
}

/**
 * Resolve the caller, or throw.
 *
 * Call this first in **every** query and mutation. A function that returns data
 * without calling it is a bug, not a convenience — QA agent H checks exactly
 * this (§6.3).
 */
export async function assertAllowlisted(ctx: QueryCtx | MutationCtx): Promise<Caller> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new NotAllowedError("Not signed in.");
  }

  const email = identity.email?.toLowerCase();
  if (!email) {
    throw new NotAllowedError("Access token carries no email claim.");
  }

  const entry = await ctx.db
    .query("allowlist")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (!entry) {
    throw new NotAllowedError(`${email} is not permitted to use this app.`);
  }

  const player = await resolvePlayer(ctx, identity.subject, email);
  if (!player) {
    throw new NotAllowedError(`No player record for ${email}.`);
  }

  return { email, player, role: entry.role };
}

/** Admin-only actions (restoring a deleted game, editing another player). */
export async function assertAdmin(ctx: QueryCtx | MutationCtx): Promise<Caller> {
  const caller = await assertAllowlisted(ctx);
  if (caller.role !== "admin") {
    throw new NotAllowedError("This action requires an admin.");
  }
  return caller;
}

/**
 * Find the player behind an identity: by auth subject first, falling back to
 * email so a player row created before someone ever signed in still links up.
 */
async function resolvePlayer(
  ctx: QueryCtx | MutationCtx,
  subject: string,
  email: string,
): Promise<Doc<"players"> | null> {
  const bySubject = await ctx.db
    .query("players")
    .withIndex("by_auth", (q) => q.eq("authSubject", subject))
    .unique();
  if (bySubject) return bySubject;

  return await ctx.db
    .query("players")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
}

/**
 * Link an identity to its player row on first sign-in. Separate from
 * `assertAllowlisted` because queries cannot write.
 */
export async function linkAuthSubject(
  ctx: MutationCtx,
  playerId: Id<"players">,
  subject: string,
): Promise<void> {
  const player = await ctx.db.get(playerId);
  if (player && player.authSubject !== subject) {
    await ctx.db.patch(playerId, { authSubject: subject });
  }
}
