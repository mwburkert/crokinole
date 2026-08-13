/**
 * Reading and choosing a player's names.
 *
 * `nickname` is what every screen shows; `firstName` / `lastName` identify the
 * person behind it. These accessors exist so the choice of display field is
 * made in one place — the whole app went through a `displayName` → `nickname`
 * rename, and the reason that was cheap is that reads were centralised here.
 */

import { defaultNickname, normaliseName } from "@crokinole/core";

import type { Doc } from "../_generated/dataModel";

/** What the app shows for this player. */
export function nicknameOf(player: Doc<"players">): string {
  return player.nickname;
}

/** Case-insensitive email match key. Absent stays absent — never "". */
export function emailKey(email: string | undefined): string | undefined {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Pick a nickname that doesn't collide with anyone already in the table.
 *
 * The rule itself lives in core (`defaultNickname`); this only supplies the
 * "already taken" set, which is the part that needs the database. A nickname
 * the caller chose explicitly is respected as-is — it's their name — and only
 * normalised.
 */
export function resolveNickname(
  chosen: string | undefined,
  firstName: string,
  lastName: string | undefined,
  existing: Doc<"players">[],
): string {
  const picked = normaliseName(chosen ?? "");
  if (picked !== "") return picked;
  return defaultNickname(firstName, lastName, existing.map(nicknameOf));
}
