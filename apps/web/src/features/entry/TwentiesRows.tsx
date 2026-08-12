import {
  validateRound,
  type RingCounts,
  type RoundPlayerStat,
  type ScoringConfig,
  type TeamKey,
  type Teams,
} from "@crokinole/core";
import { useState, type ReactNode } from "react";

import { Stepper } from "../../ui/components";
import "../../ui/twenties.css";

const TEAMS: TeamKey[] = ["A", "B"];

/**
 * Per-player twenties as the screen holds them: player id → count.
 *
 * A key that is *absent* means nobody said anything about that player, which is
 * not the same as saying they sank none — core keeps the two apart with
 * `twentiesTracked`, and a stat that claims a fact we don't have is worse than
 * a blank.
 */
export type EnteredTwenties = Record<string, number>;

/** Seed the draft from a round that already carries per-player detail. */
export function twentiesFrom(stats: RoundPlayerStat[] | undefined): EnteredTwenties {
  const out: EnteredTwenties = {};
  for (const stat of stats ?? []) {
    if (stat.twenties !== undefined) out[stat.playerId] = stat.twenties;
  }
  return out;
}

/**
 * Record one player's twenties.
 *
 * Touching either partner records **both**, the untouched one as zero. In
 * doubles "Marley got both of them" is a statement about Spencer too, and
 * leaving Spencer absent would file him as untracked for a round somebody
 * clearly tracked.
 */
export function recordTwenties(
  current: EnteredTwenties,
  teamPlayerIds: string[],
  playerId: string,
  next: number,
): EnteredTwenties {
  const out = { ...current };
  for (const id of teamPlayerIds) out[id] ??= 0;
  out[playerId] = Math.max(0, Math.trunc(next));
  return out;
}

/**
 * What goes to the server, built from what was actually entered.
 *
 * A team nobody touched contributes nothing at all, and neither does a team
 * whose row was never offered because they scored no twenties — so an untouched
 * fast-path round sends no `playerStats` and stays honestly blank in the stats.
 */
export function toPlayerStats(
  entered: EnteredTwenties,
  teams: Teams,
  counts: { A: RingCounts; B: RingCounts },
): RoundPlayerStat[] | undefined {
  const out: RoundPlayerStat[] = [];
  for (const team of TEAMS) {
    if (counts[team].twenties <= 0) continue;
    const ids = teams[team].playerIds;
    if (!ids.some((id) => entered[id] !== undefined)) continue;
    for (const id of ids) out.push({ playerId: id, twenties: entered[id] ?? 0 });
  }
  return out.length > 0 ? out : undefined;
}

export interface TwentiesRowsProps {
  teams: Teams;
  config: ScoringConfig;
  /** The counts these twenties have to reconcile with. */
  counts: { A: RingCounts; B: RingCounts };
  /** 0-based, only so core's validator can name the round. */
  roundIndex: number;
  entered: EnteredTwenties;
  onChange: (team: TeamKey, playerId: string, next: number) => void;
  nameOf: (playerId: string) => string;
}

/**
 * Twenties (§3.5 step 4) — a collapsed row per team, expanding to a stepper per
 * player.
 *
 * **Collapsed by default and absent unless that team sank one**, because this
 * screen is used standing at a board with one free hand: the fast path is board
 * → *Finish round*, and anything that makes you look at an extra control on the
 * way has cost more than these numbers are worth.
 *
 * How many steppers appear comes from the game — one seat a side in singles,
 * two in doubles — never from a constant here.
 *
 * The reconciliation against the team's twenties is core's
 * `player_twenties_mismatch` (§3.2.2), not a comparison written here. It is a
 * **warning**: it says the two numbers disagree and lets you commit anyway,
 * because the alternative is a screen that won't let you record the round in
 * front of you.
 */
export function TwentiesRows({
  teams,
  config,
  counts,
  roundIndex,
  entered,
  onChange,
  nameOf,
}: TwentiesRowsProps): ReactNode {
  const [open, setOpen] = useState<Record<TeamKey, boolean>>({ A: false, B: false });

  // Only teams that actually scored one. A stepper that can only ever be 0 is
  // noise on the screen that can least afford it.
  const scoring = TEAMS.filter((team) => counts[team].twenties > 0);
  if (scoring.length === 0) return null;

  const playerStats = toPlayerStats(entered, teams, counts);
  const issues = validateRound(
    {
      index: roundIndex,
      A: counts.A,
      B: counts.B,
      ...(playerStats ? { playerStats } : {}),
    },
    config,
    teams,
  );

  return (
    <div className="twenties">
      {scoring.map((team) => {
        const ids = teams[team].playerIds;
        const total = counts[team].twenties;
        const touched = ids.some((id) => entered[id] !== undefined);
        const mismatch = issues.some(
          (issue) => issue.code === "player_twenties_mismatch" && issue.team === team,
        );
        const sum = ids.reduce((running, id) => running + (entered[id] ?? 0), 0);
        const panelId = `twenties-${team}`;
        const color = teams[team].color;

        return (
          <div className="twenties__team" key={team}>
            <button
              type="button"
              className="twenties__head"
              aria-expanded={open[team]}
              aria-controls={panelId}
              onClick={() => setOpen((current) => ({ ...current, [team]: !current[team] }))}
            >
              <span className="twenties__caret" aria-hidden="true">
                {open[team] ? "▾" : "▸"}
              </span>
              {/* Named by colour, because that is how both sides are named
                  everywhere else on this screen. */}
              <span className="twenties__label">
                {color === "black" ? "Black" : "White"} · {total}{" "}
                {total === 1 ? "twenty" : "twenties"}
              </span>
              <span className="twenties__summary">
                {touched
                  ? ids.map((id) => `${nameOf(id)} ${entered[id] ?? 0}`).join(" · ")
                  : "who?"}
              </span>
            </button>

            {open[team] ? (
              <div className="twenties__players" id={panelId}>
                {ids.map((id) => (
                  <Stepper
                    key={id}
                    label={nameOf(id)}
                    value={entered[id] ?? 0}
                    onChange={(next) => onChange(team, id, next)}
                  />
                ))}
              </div>
            ) : null}

            {mismatch ? (
              <p className="twenties__warn" role="status">
                Adds to {sum}, not {total}. Recorded either way.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
