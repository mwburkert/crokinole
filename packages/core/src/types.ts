/**
 * Domain types for the crokinole rules engine.
 *
 * Pure TypeScript. This package must never import React or Convex — see
 * `docs/plan/03-PHASE-1.md` §3.2.2. IDs are plain strings so the engine stays
 * independent of whatever database is underneath it.
 *
 * Terminology follows the NCA (§3.1): sinking the centre hole is **a twenty**,
 * never "a crokinole"; a shot that fails to contact an opponent disc is a
 * **foul**, not a "whiff".
 */

export type PlayerId = string;
export type GameId = string;

/**
 * Longest display name we accept.
 *
 * Enforced at input rather than truncated at render, so a name is always shown
 * in full at one consistent size. Every surface that lists names — standings,
 * seat pickers, history — is width-constrained on a phone, and letting one long
 * name shrink the type or ellipsise makes the whole table inconsistent.
 */
export const MAX_NAME_LENGTH = 12;

/** 2v2 (6 discs each) or 1v1 (8 discs each). 3-player is out of scope. */
export type Format = "doubles" | "singles";

export type TeamKey = "A" | "B";
export type DiscColor = "black" | "white";

/** Outcome of a single round: a winning side, or a tie. */
export type RoundResult = TeamKey | "tie";

/**
 * How many discs came to rest in each scoring region, for one team, in one
 * round. A disc scores the lowest value of any region it touches (§3.1), so
 * these are already-adjudicated counts — the engine never re-litigates a line
 * call.
 */
export interface RingCounts {
  /** Sunk in the centre hole. */
  twenties: number;
  fifteens: number;
  tens: number;
  fives: number;
}

/** Point value of each region. Snapshotted per game so old games never re-score. */
export interface RingValues {
  twenty: number;
  fifteen: number;
  ten: number;
  five: number;
}

/**
 * The rules in force for one game. **Snapshotted onto the game** (§3.2.3): if
 * the house rules ever change, previously played games still score by the rules
 * they were played under. Never hardcode 15, 2, or 5 outside `DEFAULT_SCORING`.
 */
export interface ScoringConfig {
  format: Format;
  ringValues: RingValues;
  /** Match points awarded to the side with the higher round score. */
  matchPointsWin: number;
  /** Match points awarded to each side when the round is level. */
  matchPointsTie: number;
  /** Match points needed to win the game. */
  targetMatchPoints: number;
  /**
   * How far ahead the leader must be to take the game.
   *
   * `1` ends it the moment someone reaches the target with any lead. `2` is
   * win-by-two: 5–4 keeps playing, 6–4 ends it. A game can never end level
   * regardless, since money is riding on it.
   *
   * Not an NCA rule — NCA regular play is a fixed four rounds per game rather
   * than a race to a target, so both the target and the margin are house rules.
   * Snapshotted per game like everything else in this config, so changing it
   * never re-decides a game already played.
   */
  winBy: number;
  /** 6 for doubles, 8 for singles. `discsPerTeam` is derived, never stored. */
  discsPerPlayer: number;
}

export interface Team {
  color: DiscColor;
  /** One entry for singles, two for doubles. */
  playerIds: PlayerId[];
}

export interface Teams {
  A: Team;
  B: Team;
}

/** What one player wagered on one game, in cents. */
export interface Bet {
  playerId: PlayerId;
  amountCents: number;
}

/** Optional per-player detail for a round. Only `twenties` is entered in Phase 1. */
export interface RoundPlayerStat {
  playerId: PlayerId;
  twenties?: number;
  /** Phase 2 (§4.1). Failed to contact an opponent disc when one was on the board. */
  fouls?: number;
  /** Phase 2. Hit a peg and rebounded back toward the shooter. */
  spencers?: number;
  /** Phase 2. Caused a swing of 25+ points in the opponents' favour. */
  kinseys?: number;
}

/**
 * The minimum a round needs to be scored. `pointsOverride` is the quick-entry
 * escape hatch (§3.3) for the night someone just wants to log the number: when
 * present it replaces the derived total for that side.
 */
export interface RoundInput {
  A: RingCounts;
  B: RingCounts;
  pointsOverride?: {
    A?: number;
    B?: number;
  };
}

export interface Round extends RoundInput {
  /** 0-based position within the game. */
  index: number;
  playerStats?: RoundPlayerStat[];
}

/** A game as stored — rounds live in their own table (§3.3). */
export interface Game {
  id: GameId;
  /** The night it was played, not when the row was created. */
  playedAt: number;
  status: "in_progress" | "final";
  config: ScoringConfig;
  teams: Teams;
  bets: Bet[];
  notes?: string;
  /** Soft delete (§3.2.4). Money is involved; a mis-tap must be recoverable. */
  deletedAt?: number;
}

/**
 * A game with its rounds attached.
 *
 * The plan's §3.4 sketch threaded rounds separately (`aggregateStats(games,
 * rounds, cfg)`). Joining them once at the edge is simpler and removes the
 * chance of pairing a game with the wrong rounds. It also lets every function
 * read `game.config` rather than accepting a config argument, which is what
 * §3.2.3 actually requires — a passed-in config would re-score old games under
 * today's rules.
 */
export interface GameWithRounds extends Game {
  rounds: Round[];
}

/** What one player nets on one game, in cents. Sums to zero across a game. */
export interface Settlement {
  playerId: PlayerId;
  netCents: number;
}

/** Lifetime (or filtered) totals for one player. All derived, never stored. */
export interface PlayerStats {
  playerId: PlayerId;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  /** 0..1. Zero when `gamesPlayed` is 0, rather than NaN. */
  winPct: number;
  matchPointsFor: number;
  matchPointsAgainst: number;
  roundPointsFor: number;
  roundPointsAgainst: number;
  /** Only counts rounds where per-player detail was actually entered. */
  twenties: number;
  netCents: number;
}
