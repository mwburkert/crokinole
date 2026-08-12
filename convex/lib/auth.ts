/**
 * The security boundary (§3.2.5).
 *
 * ⚠️ **Cloudflare Access does not protect Convex.** The browser opens a
 * WebSocket straight to `*.convex.cloud`, on a host Cloudflare never sees.
 * Every query and mutation is a public internet endpoint. `assertAllowlisted`
 * is the only thing standing between the internet and this data — there is no
 * second line of defence, and no public route in Phase 1 (§3.5).
 *
 * ===========================================================================
 * 🕐 INTERIM: THE SHARED PASSPHRASE. DELETE THIS WHEN §7.1 LANDS.
 * ===========================================================================
 *
 * The design is for `ctx.auth.getUserIdentity()` to resolve a Cloudflare Access
 * JWT. **Access does not exist yet** — no domain, no Zero Trust team — so
 * `auth.config.ts` registers no provider and `getUserIdentity()` can only ever
 * return null. Wired as-is, nobody could call anything.
 *
 * The owner chose a shared passphrase as the interim. It is not "open": a
 * caller must present a secret, so learning the deployment URL alone gets you
 * nothing. Convex has no per-request hook for this without a JWT provider, so
 * it is threaded as an argument — `passcode: v.string()` on every public query
 * and mutation, compared here against `APP_PASSCODE`.
 *
 * **This is marked for deletion at the check itself, deliberately.** A
 * temporary bypass that outlives its reason is exactly how "assertAllowlisted
 * is the only thing between the internet and this data" stops being true. When
 * the Access application exists:
 *
 *   1. restore the provider in `convex/auth.config.ts` (the whole config is
 *      preserved there as a comment),
 *   2. delete `assertPasscode` and the `passcode` parameter everywhere,
 *   3. make `Caller.player` / `Caller.email` non-nullable again and re-require
 *      `games.createdBy` and `gameEvents.actorPlayerId` in the schema,
 *   4. `npx convex env remove APP_PASSCODE`.
 *
 * What the interim costs, stated plainly: a shared secret carries no per-person
 * identity, so the audit trail still cannot say *who* did something, and two
 * people holding the same code are indistinguishable. What it *can* say is
 * which code they produced, and that is a real capability distinction — so
 * there are two: `ADMIN_PASSCODE` and `APP_PASSCODE`. Anything that needs to
 * know *who* you are (claiming a player row, "was I in this game?") still has
 * no answer and must fail closed rather than fall back to the tier.
 * ===========================================================================
 */

import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export interface Caller {
  /**
   * Null under the shared passphrase — there is no identity to read one from.
   * Non-null once the Access JWT provides it.
   */
  email: string | null;
  /**
   * Null under the shared passphrase. Writers that record an actor omit the
   * field rather than inventing a person; see `games.createdBy` in the schema.
   */
  player: Doc<"players"> | null;
  role: "admin" | "player";
}

/**
 * Why a call was refused, in a form the browser can branch on.
 *
 * `ConvexError`'s payload is the only part of a thrown error that survives the
 * trip to the client — a plain `Error`'s message is replaced with a generic
 * string outside dev. The web app has to tell "your code is wrong, here's the
 * box again" apart from "something broke", so the reason travels as data.
 */
export type AuthErrorKind = "BAD_PASSCODE" | "NO_PASSCODE_CONFIGURED" | "NOT_ALLOWED";

export interface AuthErrorData {
  /** Convex's `Value` constraint needs this; every field here is a string. */
  [key: string]: string;
  kind: AuthErrorKind;
  message: string;
}

export function authError(kind: AuthErrorKind, message: string): ConvexError<AuthErrorData> {
  return new ConvexError({ kind, message });
}

/**
 * Compare without leaking the answer through timing.
 *
 * Overkill for a four-person game night, and cheap enough that arguing about it
 * costs more than doing it. Length is compared up front because it leaks
 * through the string's own length anyway.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 🕐 INTERIM. The whole security boundary until Access lands.
 *
 * **Two codes, two tiers.** `ADMIN_PASSCODE` authenticates an admin;
 * `APP_PASSCODE` a player. This is a genuine capability check, not a pretence:
 * the tier is decided by which secret the caller can actually produce, which is
 * a real thing to know about them. It is emphatically *not* an identity — it
 * says what you may do, never who you are, and two people holding the same code
 * remain indistinguishable. Every guard downstream is written on that basis.
 *
 * Fails closed twice over: an unset `APP_PASSCODE` refuses everyone rather than
 * letting everyone through, and a caller who matches neither secret is refused
 * before any argument is read. An unset `ADMIN_PASSCODE` simply means there is
 * no admin tier — it never silently promotes the player code.
 *
 * The two codes must differ. If they were ever set to the same value the player
 * code would silently confer admin, so that is refused outright rather than
 * resolved in either direction.
 */
function tierFor(passcode: string): "admin" | "player" {
  const appCode = (process.env.APP_PASSCODE ?? "").trim();
  const adminCode = (process.env.ADMIN_PASSCODE ?? "").trim();

  if (appCode === "") {
    throw authError(
      "NO_PASSCODE_CONFIGURED",
      "This deployment has no APP_PASSCODE set, so nothing can be read or written. " +
        "Run: npx convex env set APP_PASSCODE <value>",
    );
  }
  if (adminCode !== "" && adminCode === appCode) {
    throw authError(
      "NO_PASSCODE_CONFIGURED",
      "ADMIN_PASSCODE and APP_PASSCODE are set to the same value, which would give " +
        "every player admin. Set them to different values.",
    );
  }

  const offered = passcode.trim();
  // Admin first: the codes are distinct, so at most one of these can match.
  if (adminCode !== "" && constantTimeEquals(offered, adminCode)) return "admin";
  if (constantTimeEquals(offered, appCode)) return "player";
  throw authError("BAD_PASSCODE", "That code didn't work.");
}

/**
 * Resolve the caller, or throw.
 *
 * Call this first in **every** query and mutation. A function that returns data
 * without calling it is a bug, not a convenience — QA agent H checks exactly
 * this (§6.3).
 */
export async function assertAllowlisted(
  ctx: QueryCtx | MutationCtx,
  passcode: string,
): Promise<Caller> {
  // 🕐 INTERIM — delete with the passphrase.
  const tier = tierFor(passcode);

  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    // 🕐 INTERIM — under the passphrase there is no identity to resolve, only a
    // tier. Once `auth.config.ts` registers the Access provider this branch
    // becomes `throw authError("NOT_ALLOWED", "Not signed in.")` and everything
    // below runs for real, with `role` coming from the allowlist instead.
    return { email: null, player: null, role: tier };
  }

  const email = identity.email?.toLowerCase();
  if (!email) {
    throw authError("NOT_ALLOWED", "Access token carries no email claim.");
  }

  const entry = await ctx.db
    .query("allowlist")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (!entry) {
    throw authError("NOT_ALLOWED", `${email} is not permitted to use this app.`);
  }

  const player = await resolvePlayer(ctx, identity.subject, email);
  if (!player) {
    throw authError("NOT_ALLOWED", `No player record for ${email}.`);
  }

  return { email, player, role: entry.role };
}

/** Admin-only actions (restoring a deleted game, editing another player). */
export async function assertAdmin(
  ctx: QueryCtx | MutationCtx,
  passcode: string,
): Promise<Caller> {
  const caller = await assertAllowlisted(ctx, passcode);
  if (caller.role !== "admin") {
    throw authError("NOT_ALLOWED", "This action requires an admin.");
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
