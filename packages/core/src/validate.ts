/**
 * Validation (§3.3). These are the checks the ring-count model buys us — they
 * catch transcription errors at entry time, before a bad round quietly poisons
 * every derived stat.
 *
 * Enforced inside the Convex mutations, and surfaced inline in the entry UI.
 * Nothing here throws; callers decide what is blocking and what is a warning.
 */

import { discsPerTeam, discsUsed, gameStanding, playersPerTeam } from "./scoring.js";
import type {
  GameWithRounds,
  RingCounts,
  Round,
  ScoringConfig,
  TeamKey,
} from "./types.js";

export type IssueCode =
  | "too_many_discs"
  | "negative_count"
  | "non_integer_count"
  | "player_twenties_mismatch"
  | "team_size_mismatch"
  | "duplicate_player"
  | "bet_player_not_in_game"
  | "missing_bet"
  | "duplicate_bet"
  | "incomplete_final_game"
  | "same_color_both_teams";

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  /** Present when the issue belongs to a specific round. */
  roundIndex?: number;
  team?: TeamKey;
}

const TEAMS: TeamKey[] = ["A", "B"];

/** Every count must be a non-negative whole number of discs. */
function checkCountShape(
  counts: RingCounts,
  team: TeamKey,
  roundIndex: number,
  issues: ValidationIssue[],
): void {
  const entries: [string, number][] = [
    ["twenties", counts.twenties],
    ["fifteens", counts.fifteens],
    ["tens", counts.tens],
    ["fives", counts.fives],
  ];
  for (const [name, value] of entries) {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      issues.push({
        code: "non_integer_count",
        severity: "error",
        message: `Round ${roundIndex + 1}, team ${team}: ${name} must be a whole number.`,
        roundIndex,
        team,
      });
    } else if (value < 0) {
      issues.push({
        code: "negative_count",
        severity: "error",
        message: `Round ${roundIndex + 1}, team ${team}: ${name} cannot be negative.`,
        roundIndex,
        team,
      });
    }
  }
}

/** Check one round against the config it was played under. */
export function validateRound(
  round: Round,
  cfg: ScoringConfig,
  teams?: { A: { playerIds: string[] }; B: { playerIds: string[] } },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const limit = discsPerTeam(cfg);

  for (const team of TEAMS) {
    const counts = round[team];
    checkCountShape(counts, team, round.index, issues);

    const used = discsUsed(counts);
    if (used > limit) {
      issues.push({
        code: "too_many_discs",
        severity: "error",
        message: `Round ${round.index + 1}, team ${team}: ${used} discs recorded but only ${limit} are in play.`,
        roundIndex: round.index,
        team,
      });
    }

    // Per-player twenties must reconcile with the team's twenties. This is the
    // check that catches a mis-tap during optional stat entry (§3.5).
    if (round.playerStats && teams) {
      const members = new Set(teams[team].playerIds);
      const entered = round.playerStats.filter((stat) => members.has(stat.playerId));
      const anyEntered = entered.some((stat) => stat.twenties !== undefined);
      if (anyEntered) {
        const total = entered.reduce((sum, stat) => sum + (stat.twenties ?? 0), 0);
        if (total !== counts.twenties) {
          issues.push({
            code: "player_twenties_mismatch",
            severity: "warning",
            message: `Round ${round.index + 1}, team ${team}: per-player twenties add to ${total}, but the team scored ${counts.twenties}.`,
            roundIndex: round.index,
            team,
          });
        }
      }
    }
  }

  return issues;
}

/** Check a whole game: teams, bets, every round, and completion. */
export function validateGame(game: GameWithRounds): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cfg = game.config;
  const expectedTeamSize = playersPerTeam(cfg);

  for (const team of TEAMS) {
    const ids = game.teams[team].playerIds;
    if (ids.length !== expectedTeamSize) {
      issues.push({
        code: "team_size_mismatch",
        severity: "error",
        message: `Team ${team} has ${ids.length} player(s); ${cfg.format} needs ${expectedTeamSize}.`,
        team,
      });
    }
  }

  if (game.teams.A.color === game.teams.B.color) {
    issues.push({
      code: "same_color_both_teams",
      severity: "error",
      message: "Both teams are the same colour.",
    });
  }

  const allPlayerIds = [...game.teams.A.playerIds, ...game.teams.B.playerIds];
  const seen = new Set<string>();
  for (const id of allPlayerIds) {
    if (seen.has(id)) {
      issues.push({
        code: "duplicate_player",
        severity: "error",
        message: "The same player appears more than once in this game.",
      });
      break;
    }
    seen.add(id);
  }

  const betPlayers = new Set<string>();
  for (const bet of game.bets) {
    if (betPlayers.has(bet.playerId)) {
      issues.push({
        code: "duplicate_bet",
        severity: "error",
        message: "A player has more than one bet on this game.",
      });
    }
    betPlayers.add(bet.playerId);
    if (!seen.has(bet.playerId)) {
      issues.push({
        code: "bet_player_not_in_game",
        severity: "error",
        message: "A bet references a player who isn't in this game.",
      });
    }
  }
  for (const id of allPlayerIds) {
    if (!betPlayers.has(id)) {
      issues.push({
        code: "missing_bet",
        severity: "warning",
        message: "A player in this game has no bet recorded.",
      });
    }
  }

  for (const round of game.rounds) {
    issues.push(...validateRound(round, cfg, game.teams));
  }

  // A game marked final must actually have been won (§3.3).
  if (game.status === "final" && !gameStanding(game.rounds, cfg).isComplete) {
    issues.push({
      code: "incomplete_final_game",
      severity: "error",
      message: `This game is marked final, but neither side has reached ${cfg.targetMatchPoints} match points with a lead.`,
    });
  }

  return issues;
}

/** True when nothing blocking was found. Warnings do not block. */
export function isValid(issues: ValidationIssue[]): boolean {
  return !issues.some((issue) => issue.severity === "error");
}

/** Just the blocking issues. */
export function errorsOnly(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}
