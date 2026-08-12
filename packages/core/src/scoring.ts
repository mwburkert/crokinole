/**
 * Scoring. Every number in the app derives from these functions (§3.2.1) —
 * nothing here is ever persisted.
 */

import type {
  RingCounts,
  RoundInput,
  RoundResult,
  ScoringConfig,
  TeamKey,
} from "./types.js";

/**
 * The house rules, and the only place these literals appear (§3.2.3).
 * `discsPerPlayer` is 6 here because doubles is the primary format; use
 * `configFor("singles")` to get the 8-disc variant.
 */
export const DEFAULT_SCORING: ScoringConfig = {
  format: "doubles",
  ringValues: { twenty: 20, fifteen: 15, ten: 10, five: 5 },
  matchPointsWin: 2,
  matchPointsTie: 1,
  targetMatchPoints: 5,
  discsPerPlayer: 6,
};

/** `DEFAULT_SCORING` adjusted for a format. Doubles: 6 discs. Singles: 8. */
export function configFor(format: ScoringConfig["format"]): ScoringConfig {
  return {
    ...DEFAULT_SCORING,
    ringValues: { ...DEFAULT_SCORING.ringValues },
    format,
    discsPerPlayer: format === "doubles" ? 6 : 8,
  };
}

/** How many players make up one side. Doubles: 2. Singles: 1. */
export function playersPerTeam(cfg: ScoringConfig): number {
  return cfg.format === "doubles" ? 2 : 1;
}

/**
 * Discs one side puts on the board in a round. **Derived, never stored** — do
 * not hardcode 12 anywhere (§3.1). Doubles: 6 x 2 = 12. Singles: 8 x 1 = 8.
 */
export function discsPerTeam(cfg: ScoringConfig): number {
  return cfg.discsPerPlayer * playersPerTeam(cfg);
}

/** The most one side could theoretically score in a round (every disc a twenty). */
export function maxRoundPoints(cfg: ScoringConfig): number {
  return discsPerTeam(cfg) * cfg.ringValues.twenty;
}

/** Raw round points for one side, from its ring counts. */
export function roundPoints(counts: RingCounts, cfg: ScoringConfig): number {
  const { twenty, fifteen, ten, five } = cfg.ringValues;
  return (
    counts.twenties * twenty +
    counts.fifteens * fifteen +
    counts.tens * ten +
    counts.fives * five
  );
}

/** Total discs accounted for in a ring count. */
export function discsUsed(counts: RingCounts): number {
  return counts.twenties + counts.fifteens + counts.tens + counts.fives;
}

export interface RoundScore {
  aPoints: number;
  bPoints: number;
  /** `aPoints - bPoints`. Positive means A is ahead. */
  differential: number;
  result: RoundResult;
  matchPoints: Record<TeamKey, number>;
}

/**
 * Score one round: both sides' points, the differential, who took it, and the
 * match points awarded.
 *
 * `pointsOverride` (§3.3) replaces the derived total for a side when set,
 * letting someone log "we got 60" without tapping out the rings. An override of
 * `0` is honoured — only `undefined` falls back to the ring counts.
 */
export function scoreRound(
  a: RingCounts,
  b: RingCounts,
  cfg: ScoringConfig,
  pointsOverride?: RoundInput["pointsOverride"],
): RoundScore {
  const aPoints = pointsOverride?.A ?? roundPoints(a, cfg);
  const bPoints = pointsOverride?.B ?? roundPoints(b, cfg);

  const result: RoundResult =
    aPoints > bPoints ? "A" : bPoints > aPoints ? "B" : "tie";

  const matchPoints: Record<TeamKey, number> =
    result === "tie"
      ? { A: cfg.matchPointsTie, B: cfg.matchPointsTie }
      : result === "A"
        ? { A: cfg.matchPointsWin, B: 0 }
        : { A: 0, B: cfg.matchPointsWin };

  return { aPoints, bPoints, differential: aPoints - bPoints, result, matchPoints };
}

/** Convenience: score a `RoundInput` without unpacking it at the call site. */
export function scoreRoundInput(round: RoundInput, cfg: ScoringConfig): RoundScore {
  return scoreRound(round.A, round.B, cfg, round.pointsOverride);
}

export interface GameStanding {
  matchPoints: Record<TeamKey, number>;
  roundPointsFor: Record<TeamKey, number>;
  /** Rounds played so far. */
  roundsPlayed: number;
  isComplete: boolean;
  winner?: TeamKey;
}

/**
 * Running standing across every round played so far, and whether the game is
 * over.
 *
 * **A game is complete when one side has reached `targetMatchPoints` _and_ is
 * strictly ahead.** The "strictly ahead" half matters: at 4-4 a tied round
 * takes both sides to 5, and a game cannot end level when money is riding on
 * it, so play continues until someone leads.
 */
export function gameStanding(rounds: RoundInput[], cfg: ScoringConfig): GameStanding {
  const matchPoints: Record<TeamKey, number> = { A: 0, B: 0 };
  const roundPointsFor: Record<TeamKey, number> = { A: 0, B: 0 };

  for (const round of rounds) {
    const score = scoreRoundInput(round, cfg);
    roundPointsFor.A += score.aPoints;
    roundPointsFor.B += score.bPoints;
    matchPoints.A += score.matchPoints.A;
    matchPoints.B += score.matchPoints.B;
  }

  const target = cfg.targetMatchPoints;
  const leader: TeamKey | undefined =
    matchPoints.A > matchPoints.B ? "A" : matchPoints.B > matchPoints.A ? "B" : undefined;
  const isComplete = leader !== undefined && matchPoints[leader] >= target;

  return {
    matchPoints,
    roundPointsFor,
    roundsPlayed: rounds.length,
    isComplete,
    ...(isComplete && leader ? { winner: leader } : {}),
  };
}

/** Which side a player is on, or undefined if they aren't in this game. */
export function teamOf(
  teams: { A: { playerIds: string[] }; B: { playerIds: string[] } },
  playerId: string,
): TeamKey | undefined {
  if (teams.A.playerIds.includes(playerId)) return "A";
  if (teams.B.playerIds.includes(playerId)) return "B";
  return undefined;
}

/** The other side. */
export function otherTeam(team: TeamKey): TeamKey {
  return team === "A" ? "B" : "A";
}
