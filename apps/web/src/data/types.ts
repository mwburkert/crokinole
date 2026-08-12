/**
 * The shapes the screens work in.
 *
 * These used to live in `fixtures.ts` alongside the seed data, because the seed
 * data was the only thing that produced them. The data now lives in Convex
 * (`convex/lib/firstNight.ts` seeds it), so the types moved somewhere that
 * isn't named after a thing that no longer exists.
 *
 * They are deliberately *not* the Convex document types. The screens speak in
 * people and rows; the seam in `store.tsx` is where documents become those.
 */

export interface Player {
  id: string;
  /**
   * The **nickname** — what every screen shows.
   *
   * Named `displayName` here rather than `nickname` because that is what it is
   * to a screen: the one string you render. The split-out `firstName` /
   * `lastName` below identify the person and are only needed where someone is
   * being added or edited.
   */
  displayName: string;
  firstName: string;
  lastName: string | null;
  isActive: boolean;
}

export type Role = "admin" | "player";

/**
 * A person as the settings screen sees them: a player row, plus their allowlist
 * entry if they have one.
 *
 * 🕐 `email` and `role` are nullable, and today they are null for everyone.
 * Under the shared passphrase nobody has an email and nobody signs in, but the
 * five players are real and have to be nameable and editable. A person with no
 * login is still a person (§3.6) — the allowlist answers *what they may do*,
 * not *whether they exist*. Both become non-null again when Access lands and
 * people arrive through invites.
 */
export interface Member {
  /** Null only for an allowlist entry with no player row behind it. */
  playerId: string | null;
  /** The nickname. */
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: Role | null;
  invitedAt: number;
  isActive: boolean;
  hasSignedIn: boolean;
}
