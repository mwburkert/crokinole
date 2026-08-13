/**
 * Lifetime and filtered statistics, derived by folding over games (§3.2.1).
 *
 * At this volume — a few hundred games a year — a full recompute is
 * milliseconds. Do not build incremental aggregation (§4.2).
 *
 * Every game is scored under **its own snapshotted config**, never a config
 * passed in from outside, so changing the house rules can never retroactively
 * rewrite history (§3.2.3).
 */

import { nightKey } from "./night.js";
import { gameStanding, otherTeam, teamOf } from "./scoring.js";
import { settle } from "./settle.js";
import type { GameWithRounds, PlayerId, PlayerStats, TeamKey } from "./types.js";

/** A blank row, so players with no games still render as zeroes not gaps. */
function emptyStats(playerId: PlayerId): PlayerStats {
  return {
    playerId,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    winPct: 0,
    matchPointsFor: 0,
    matchPointsAgainst: 0,
    roundPointsFor: 0,
    roundPointsAgainst: 0,
    roundsScored: 0,
    twenties: 0,
    netCents: 0,
  };
}

export interface AggregateOptions {
  /** Only include games played at or after this timestamp. */
  since?: number;
  /** Only include games played before this timestamp. */
  until?: number;
  /**
   * Players to include even if they have no games in range. Without this a
   * player who sat out a month simply vanishes from the table.
   */
  includePlayerIds?: PlayerId[];
  /** Include games still in progress. Off by default — they have no winner. */
  includeInProgress?: boolean;
}

/**
 * Fold a set of games into per-player totals.
 *
 * Soft-deleted games (§3.2.4) are always excluded. Games that haven't been won
 * are excluded unless `includeInProgress` is set, because a game with no winner
 * would otherwise count as a loss for everybody.
 */
export function aggregateStats(
  games: GameWithRounds[],
  options: AggregateOptions = {},
): PlayerStats[] {
  const table = new Map<PlayerId, PlayerStats>();

  const rowFor = (playerId: PlayerId): PlayerStats => {
    let row = table.get(playerId);
    if (!row) {
      row = emptyStats(playerId);
      table.set(playerId, row);
    }
    return row;
  };

  for (const playerId of options.includePlayerIds ?? []) rowFor(playerId);

  for (const game of games) {
    if (game.deletedAt !== undefined) continue;
    if (options.since !== undefined && game.playedAt < options.since) continue;
    if (options.until !== undefined && game.playedAt >= options.until) continue;

    const standing = gameStanding(game.rounds, game.config);
    if (!standing.isComplete && !options.includeInProgress) continue;

    const settlements = new Map<PlayerId, number>();
    for (const entry of settle(game)) settlements.set(entry.playerId, entry.netCents);

    /**
     * Twenties are a **team** figure, taken from the ring counts.
     *
     * They used to come from `round.playerStats`, which nobody filled in, so
     * the Stats screen's two twenties columns read "—" forever — the UI
     * promising what the data never delivered. Ring counts are always known,
     * so this always has an answer.
     *
     * A disc carries a colour, not a person: who sank it is not recoverable
     * from the board, and the board is the single source of truth for every
     * count (that is the whole point of placing chips rather than tapping
     * numbers). So the team's total is credited to each partner in full,
     * exactly as round points already are — see `roundPointsFor` below. If two
     * partners together sank three twenties, they each have three.
     */
    const teamTwenties: Record<TeamKey, number> = { A: 0, B: 0 };
    for (const round of game.rounds) {
      teamTwenties.A += round.A.twenties;
      teamTwenties.B += round.B.twenties;
    }

    const members: [TeamKey, PlayerId[]][] = [
      ["A", game.teams.A.playerIds],
      ["B", game.teams.B.playerIds],
    ];

    for (const [team, playerIds] of members) {
      const against = otherTeam(team);
      for (const playerId of playerIds) {
        const row = rowFor(playerId);
        row.gamesPlayed += 1;
        if (standing.winner === team) row.gamesWon += 1;
        else if (standing.winner === against) row.gamesLost += 1;
        row.matchPointsFor += standing.matchPoints[team];
        row.matchPointsAgainst += standing.matchPoints[against];
        row.roundPointsFor += standing.roundPointsFor[team];
        row.roundPointsAgainst += standing.roundPointsFor[against];
        row.roundsScored += standing.roundsScored;
        row.twenties += teamTwenties[team];
        row.netCents += settlements.get(playerId) ?? 0;
      }
    }
  }

  for (const row of table.values()) {
    const decided = row.gamesWon + row.gamesLost;
    row.winPct = decided > 0 ? row.gamesWon / decided : 0;
  }

  return [...table.values()].sort(compareForLeaderboard);
}

/**
 * Leaderboard order: most wins first, then win rate, then match-point
 * differential, then name-stable by id so the table never jitters between
 * renders.
 */
export function compareForLeaderboard(a: PlayerStats, b: PlayerStats): number {
  return (
    b.gamesWon - a.gamesWon ||
    b.winPct - a.winPct ||
    b.matchPointsFor - b.matchPointsAgainst - (a.matchPointsFor - a.matchPointsAgainst) ||
    a.playerId.localeCompare(b.playerId)
  );
}

/** Net cents for one player across a set of games. */
export function netCentsFor(games: GameWithRounds[], playerId: PlayerId): number {
  let total = 0;
  for (const game of games) {
    if (game.deletedAt !== undefined) continue;
    if (teamOf(game.teams, playerId) === undefined) continue;
    for (const entry of settle(game)) {
      if (entry.playerId === playerId) total += entry.netCents;
    }
  }
  return total;
}

/**
 * Group games into nights (§4.5.2 calls this the natural unit — five games in
 * an evening). Newest night first.
 *
 * Uses `nightKey`, not the calendar date: a game logged at 1am belongs to the
 * night that started the evening before, so a late finish doesn't split one
 * night across two rows.
 */
export function groupByNight(games: GameWithRounds[]): { date: string; games: GameWithRounds[] }[] {
  const nights = new Map<string, GameWithRounds[]>();
  for (const game of games) {
    if (game.deletedAt !== undefined) continue;
    const key = nightKey(game.playedAt);
    const bucket = nights.get(key);
    if (bucket) bucket.push(game);
    else nights.set(key, [game]);
  }
  return [...nights.entries()]
    .map(([date, list]) => ({ date, games: list.sort((a, b) => a.playedAt - b.playedAt) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** `YYYY-MM-DD` in the viewer's local timezone. */
export function toLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
