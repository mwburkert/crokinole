/**
 * `@crokinole/core` — the rules engine.
 *
 * Pure TypeScript, no dependencies. Every scoring, settlement, and statistics
 * rule lives here and **nowhere else** (§3.2.2). If you find yourself
 * re-implementing one of these in a component or a Convex function, import it
 * instead.
 */

export { MAX_NAME_LENGTH } from "./types.js";

export type {
  Bet,
  DiscColor,
  Format,
  Game,
  GameId,
  GameWithRounds,
  PlayerId,
  PlayerStats,
  RingCounts,
  RingValues,
  Round,
  RoundInput,
  RoundPlayerStat,
  RoundResult,
  ScoringConfig,
  Settlement,
  Team,
  TeamKey,
  Teams,
} from "./types.js";

export {
  DEFAULT_SCORING,
  configFor,
  discsPerTeam,
  discsUsed,
  gameStanding,
  maxRoundPoints,
  otherTeam,
  playersPerTeam,
  roundPoints,
  scoreRound,
  scoreRoundInput,
  teamOf,
} from "./scoring.js";
export type { GameStanding, RoundScore } from "./scoring.js";

export {
  BOARD_CENTRE,
  DISC_RADIUS,
  RADII,
  countsFromDiscs,
  placeAt,
  placedCount,
  placementComplete,
  radiusOf,
  regionAt,
  remaining,
  snapIntoRegion,
} from "./discs.js";
export type { PlacedDisc, Region } from "./discs.js";

export { defaultNickname, fullName, normaliseName } from "./names.js";

export { formatCents, potCents, settle } from "./settle.js";

export {
  NIGHT_RESET_HOUR,
  currentNightKey,
  gamesOnNight,
  nightBounds,
  nightHistory,
  nightKey,
  nightsWithGames,
  playersOnNight,
  shuffle,
  suggestSeating,
  tiebreakRank,
} from "./night.js";
export type { NightHistory, Seating } from "./night.js";

export {
  aggregateStats,
  compareForLeaderboard,
  groupByNight,
  netCentsFor,
  toLocalDateKey,
} from "./stats.js";
export type { AggregateOptions } from "./stats.js";

export { errorsOnly, isValid, validateGame, validateRound } from "./validate.js";
export type { IssueCode, IssueSeverity, ValidationIssue } from "./validate.js";

/** An all-zero ring count — the starting state for a round entry form. */
export const EMPTY_RING_COUNTS = Object.freeze({
  twenties: 0,
  fifteens: 0,
  tens: 0,
  fives: 0,
});
