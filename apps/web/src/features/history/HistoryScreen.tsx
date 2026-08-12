import {
  formatCents,
  gameStanding,
  scoreRoundInput,
  settle,
  type GameWithRounds,
  type TeamKey,
} from "@crokinole/core";
import { useState, type ReactNode } from "react";

import { useNights, useStore } from "../../data/store";
import { Card, Empty, Money } from "../../ui/components";

/**
 * History (§3.5), grouped by night.
 *
 * Each game reads as the two pairs stacked with the score between them —
 * winner's total in green, loser's in red, both black on a tie. Tap to expand
 * for the stakes and a round-by-round breakdown in the same colour language.
 */
export function HistoryScreen(): ReactNode {
  const nights = useNights();
  const { players } = useStore();
  const [expanded, setExpanded] = useState<string | null>(null);

  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.displayName ?? "?";

  if (nights.length === 0) {
    return (
      <Card>
        <Empty>Nothing logged yet.</Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      {nights.map((night) => (
        <div className="night" key={night.date}>
          <div className="night__head">
            <span className="night__date">{formatNight(night.date)}</span>
            <span className="faint">
              {night.games.length} {night.games.length === 1 ? "game" : "games"}
            </span>
          </div>

          {night.games.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              nameOf={nameOf}
              open={expanded === game.id}
              onToggle={() => setExpanded((current) => (current === game.id ? null : game.id))}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function GameRow({
  game,
  nameOf,
  open,
  onToggle,
}: {
  game: GameWithRounds;
  nameOf: (id: string) => string;
  open: boolean;
  onToggle: () => void;
}): ReactNode {
  const standing = gameStanding(game.rounds, game.config);
  const result = settle(game);
  const netFor = (playerId: string): number =>
    result.find((entry) => entry.playerId === playerId)?.netCents ?? 0;

  /**
   * Each side is its own two-column sub-grid: name, then money in a fixed
   * column. Keeping the money out of the name text is what makes the four rows
   * line up — inline, every row started at a different x depending on name
   * length. Names ellipsise rather than wrap for the same reason.
   */
  const side = (team: TeamKey, mirrored: boolean): ReactNode => (
    <div className={`matchup__side${mirrored ? " matchup__side--right" : ""}`}>
      {game.teams[team].playerIds.map((id) => (
        <div className="matchup__player" key={id}>
          <span className="matchup__name">{nameOf(id)}</span>
          <span className="matchup__money">
            {result.length > 0 ? <Money cents={netFor(id)} /> : null}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="matchup">
      <button type="button" className="matchup__main" onClick={onToggle} aria-expanded={open}>
        {side("A", false)}
        <span className="matchup__score">
          <span className={`disc disc--${game.teams.A.color}`} aria-hidden="true" />
          <span className={scoreClass(standing.matchPoints.A, standing.matchPoints.B)}>
            {standing.matchPoints.A}
          </span>
          <span className="matchup__dash">–</span>
          <span className={scoreClass(standing.matchPoints.B, standing.matchPoints.A)}>
            {standing.matchPoints.B}
          </span>
          <span className={`disc disc--${game.teams.B.color}`} aria-hidden="true" />
        </span>
        {side("B", true)}
      </button>

      {open ? (
        <div className="matchup__detail">
          <div className="spread faint">
            <span>Stakes</span>
            <span>
              {game.bets.map((bet) => `${nameOf(bet.playerId)} ${formatCents(bet.amountCents).replace("+", "")}`).join(" · ")}
            </span>
          </div>
          {game.rounds.map((round) => {
            const score = scoreRoundInput(round, game.config);
            return (
              <div className="spread" key={round.index}>
                <span className="faint">Round {round.index + 1}</span>
                <span className="num">
                  <span className={scoreClass(score.aPoints, score.bPoints)}>{score.aPoints}</span>
                  <span className="matchup__dash">–</span>
                  <span className={scoreClass(score.bPoints, score.aPoints)}>{score.bPoints}</span>
                </span>
              </div>
            );
          })}
          {game.rounds.length === 0 ? <p className="faint">No rounds yet.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Green when ahead, red when behind, plain when level. */
function scoreClass(mine: number, theirs: number): string {
  if (mine > theirs) return "num score--win";
  if (mine < theirs) return "num score--loss";
  return "num score--tie";
}

/** "2026-08-12" -> "Wed 12 Aug 2026". */
function formatNight(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
