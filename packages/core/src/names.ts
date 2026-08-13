/**
 * How a player's nickname is chosen.
 *
 * The nickname is what the app shows *everywhere* — standings, seat pickers,
 * history, the score card. First and last names exist so a person can be
 * identified and matched; the nickname exists so a 393px-wide table can be read
 * at a glance.
 *
 * It lives in core rather than in a screen because two places need the same
 * answer: the self-join form, which suggests one as you type, and the server,
 * which has to produce one when a caller sends none. Two implementations of
 * this would drift, and the symptom would be a duplicate-looking person.
 */

import { MAX_NAME_LENGTH } from "./types.js";

/** Trim, collapse inner whitespace, and cap at the display limit. */
export function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

/** Case- and space-insensitive, so "Matt B" and "matt b" are the same nickname. */
function canonical(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The nickname a new player gets when they don't choose one.
 *
 * First name alone, or **first name plus last initial** when that first name is
 * already taken — the rule the owner asked for, and the one that already
 * explains the existing roster: two Matts, so they go by their surnames.
 *
 * Escalation past that is deliberate rather than clever. If the last initial
 * still collides it tries the full last name, then appends a counter. It never
 * returns something already taken and never returns an empty string, because
 * the caller is about to write it to a required column.
 *
 * `taken` is compared case-insensitively; a nickname differing only in case
 * would be indistinguishable in every table that shows it.
 */
export function defaultNickname(
  firstName: string,
  lastName: string | undefined,
  taken: Iterable<string>,
): string {
  const used = new Set([...taken].map(canonical));
  const first = normaliseName(firstName);
  const last = normaliseName(lastName ?? "");

  /*
   * With no usable first name the last name *is* the name. Building the
   * "first + last initial" form from an empty first would normalise down to a
   * bare initial — "M" for Mead — which is not a nickname, it's a typo.
   * `firstName` is required at every real entry point, so this is a guard
   * against bad data rather than a supported case.
   */
  const candidates: string[] = first ? [first] : [last];
  if (first && last) {
    candidates.push(normaliseName(`${first} ${last.slice(0, 1)}`));
    candidates.push(normaliseName(`${first} ${last}`));
  }

  for (const candidate of candidates) {
    if (candidate && !used.has(canonical(candidate))) return candidate;
  }

  // Everything obvious is taken. Number it rather than fail — a person being
  // added must always end up with a name.
  const base = first || last || "Player";
  for (let n = 2; n < 1000; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(canonical(candidate))) return candidate;
  }
  return base;
}

/**
 * The full name, for the one or two places that identify a person rather than
 * label them. Empty last name simply yields the first.
 */
export function fullName(firstName: string, lastName?: string): string {
  const last = (lastName ?? "").trim();
  return last ? `${firstName.trim()} ${last}` : firstName.trim();
}
