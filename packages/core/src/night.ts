/**
 * Nights, and who's at the table.
 *
 * A crokinole "day" doesn't end at midnight — a game logged at 1am belongs to
 * the night that started the evening before. Everything here shifts the clock
 * back by `NIGHT_RESET_HOUR` before taking a calendar date, so tonight's
 * standings survive until 3am and then roll over.
 */

import type { Format, GameWithRounds, PlayerId } from "./types.js";

/** Local hour at which one night's standings give way to the next. */
export const NIGHT_RESET_HOUR = 3;

/**
 * The night a timestamp belongs to, as `YYYY-MM-DD` in local time.
 *
 * 11pm Tuesday and 1am Wednesday both return Tuesday's key. 4am Wednesday
 * returns Wednesday's.
 */
export function nightKey(timestamp: number, resetHour: number = NIGHT_RESET_HOUR): string {
  const shifted = new Date(timestamp - resetHour * 60 * 60 * 1000);
  const month = String(shifted.getMonth() + 1).padStart(2, "0");
  const day = String(shifted.getDate()).padStart(2, "0");
  return `${shifted.getFullYear()}-${month}-${day}`;
}

/** The half-open `[since, until)` range of timestamps belonging to a night. */
export function nightBounds(
  key: string,
  resetHour: number = NIGHT_RESET_HOUR,
): { since: number; until: number } {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Not a night key: ${key}`);
  const since = new Date(year, month - 1, day, resetHour, 0, 0, 0).getTime();
  return { since, until: since + 24 * 60 * 60 * 1000 };
}

/** The night that `now` falls in. */
export function currentNightKey(now: number = Date.now()): string {
  return nightKey(now);
}

/** Every night that has at least one game, newest first. */
export function nightsWithGames(games: GameWithRounds[]): string[] {
  const keys = new Set<string>();
  for (const game of games) {
    if (game.deletedAt === undefined) keys.add(nightKey(game.playedAt));
  }
  return [...keys].sort((a, b) => b.localeCompare(a));
}

/** The games belonging to one night. */
export function gamesOnNight(games: GameWithRounds[], key: string): GameWithRounds[] {
  return games
    .filter((game) => game.deletedAt === undefined && nightKey(game.playedAt) === key)
    .sort((a, b) => a.playedAt - b.playedAt);
}

/** Everyone who actually played on a given night. */
export function playersOnNight(games: GameWithRounds[], key: string): PlayerId[] {
  const seen = new Set<PlayerId>();
  for (const game of gamesOnNight(games, key)) {
    for (const id of [...game.teams.A.playerIds, ...game.teams.B.playerIds]) seen.add(id);
  }
  return [...seen];
}

/** Stable key for an unordered pair. */
function pairKey(a: PlayerId, b: PlayerId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface NightHistory {
  /** How many times each unordered pair has partnered tonight. */
  partnered: Map<string, number>;
  /** How many times each unordered pair has faced each other tonight. */
  faced: Map<string, number>;
  /** Games played tonight, per player. */
  played: Map<PlayerId, number>;
}

/** Fold one night's games into the counts the seating suggester needs. */
export function nightHistory(games: GameWithRounds[]): NightHistory {
  const partnered = new Map<string, number>();
  const faced = new Map<string, number>();
  const played = new Map<PlayerId, number>();

  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const game of games) {
    if (game.deletedAt !== undefined) continue;
    const a = game.teams.A.playerIds;
    const b = game.teams.B.playerIds;

    for (const side of [a, b]) {
      for (let i = 0; i < side.length; i += 1) {
        const first = side[i];
        if (!first) continue;
        played.set(first, (played.get(first) ?? 0) + 1);
        for (let j = i + 1; j < side.length; j += 1) {
          const second = side[j];
          if (second) bump(partnered, pairKey(first, second));
        }
      }
    }

    for (const left of a) {
      for (const right of b) bump(faced, pairKey(left, right));
    }
  }

  return { partnered, faced, played };
}

export interface Seating {
  teamA: PlayerId[];
  teamB: PlayerId[];
}

/** Every way to split four players into two unordered pairs. */
const SPLITS: [number, number, number, number][] = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
];

/** All k-sized subsets of `items`, as index tuples. */
function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, current: T[]): void => {
    if (current.length === k) {
      out.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      const item = items[i];
      if (item === undefined) continue;
      current.push(item);
      walk(i + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * Suggest who plays next, preferring pairings that haven't happened tonight.
 *
 * Ranked by, in order: fewest repeat partnerships tonight, then fewest games
 * played by the chosen players (so whoever has been sitting out gets pulled
 * in), then fewest repeat match-ups. **Among equally good options it picks at
 * random**, which is the point — you press it again and get a different answer
 * rather than the same "optimal" four every time.
 *
 * Returns `null` when there aren't enough people at the table.
 */
export function suggestSeating(
  candidates: PlayerId[],
  gamesTonight: GameWithRounds[],
  format: Format,
  random: () => number = Math.random,
): Seating | null {
  const size = format === "doubles" ? 4 : 2;
  const unique = [...new Set(candidates)];
  if (unique.length < size) return null;

  const history = nightHistory(gamesTonight);
  const gamesFor = (id: PlayerId): number => history.played.get(id) ?? 0;

  let best: { score: [number, number, number]; options: Seating[] } | null = null;

  const consider = (seating: Seating, score: [number, number, number]): void => {
    if (!best) {
      best = { score, options: [seating] };
      return;
    }
    const cmp =
      score[0] - best.score[0] || score[1] - best.score[1] || score[2] - best.score[2];
    if (cmp < 0) best = { score, options: [seating] };
    else if (cmp === 0) best.options.push(seating);
  };

  if (format === "singles") {
    for (const [one, two] of combinations(unique, 2)) {
      if (!one || !two) continue;
      consider(
        { teamA: [one], teamB: [two] },
        [0, gamesFor(one) + gamesFor(two), history.faced.get(pairKey(one, two)) ?? 0],
      );
    }
  } else {
    for (const four of combinations(unique, 4)) {
      const rest = four.reduce((sum, id) => sum + gamesFor(id), 0);
      for (const [i, j, k, l] of SPLITS) {
        const p1 = four[i];
        const p2 = four[j];
        const p3 = four[k];
        const p4 = four[l];
        if (!p1 || !p2 || !p3 || !p4) continue;

        const repeats =
          (history.partnered.get(pairKey(p1, p2)) ?? 0) +
          (history.partnered.get(pairKey(p3, p4)) ?? 0);
        const matchups =
          (history.faced.get(pairKey(p1, p3)) ?? 0) +
          (history.faced.get(pairKey(p1, p4)) ?? 0) +
          (history.faced.get(pairKey(p2, p3)) ?? 0) +
          (history.faced.get(pairKey(p2, p4)) ?? 0);

        consider({ teamA: [p1, p2], teamB: [p3, p4] }, [repeats, rest, matchups]);
      }
    }
  }

  if (!best) return null;
  const pool = (best as { options: Seating[] }).options;
  return pool[Math.floor(random() * pool.length)] ?? pool[0] ?? null;
}

/**
 * A stable pseudo-random rank for a player on a given night.
 *
 * Used as the last tiebreaker in the standings. It must not be `Math.random()`:
 * a fresh value every render would make tied rows swap places while you look at
 * them. Hashing id+night gives an arbitrary but *fixed* order that also differs
 * from one night to the next, so the same two people don't always tie the same
 * way.
 */
export function tiebreakRank(playerId: PlayerId, key: string): number {
  let hash = 2166136261;
  const input = `${playerId}@${key}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

/** Shuffle in place-free fashion, for re-seating the same people. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}
