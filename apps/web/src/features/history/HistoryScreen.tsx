import { gameStanding } from "@crokinole/core";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useNights, useStore } from "../../data/store";
import { Badge, Card, Empty, Money } from "../../ui/components";

/**
 * History (§3.5), grouped by night.
 *
 * A night is the natural unit — five games in an evening — so the per-night
 * settlement total is shown alongside, and you settle once rather than per game
 * (§4.5.2, which the plan argues belongs in Phase 1 anyway).
 */
export function HistoryScreen(): ReactNode {
  const nights = useNights();
  const { players } = useStore();

  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.displayName ?? "?";

  if (nights.length === 0) {
    return (
      <Card title="History">
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

          {night.games.map((game) => {
            const standing = gameStanding(game.rounds, game.config);
            const winner = standing.winner;
            return (
              <Link className="game-row" to={`/games/${game.id}`} key={game.id}>
                <div className="spread">
                  <span>
                    <span className={`disc disc--${game.teams.A.color}`} />{" "}
                    {game.teams.A.playerIds.map(nameOf).join(" & ")}
                  </span>
                  <span className="game-row__score">
                    {standing.matchPoints.A}–{standing.matchPoints.B}
                  </span>
                </div>
                <div className="spread">
                  <span>
                    <span className={`disc disc--${game.teams.B.color}`} />{" "}
                    {game.teams.B.playerIds.map(nameOf).join(" & ")}
                  </span>
                  {game.status === "in_progress" ? (
                    <Badge live>In progress</Badge>
                  ) : (
                    <span className="faint">
                      {winner ? `${game.teams[winner].playerIds.map(nameOf).join(" & ")} won` : ""}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}

          {night.settlement.length > 0 ? (
            <Card title="Night total">
              {night.settlement.map((entry) => (
                <div className="spread" key={entry.playerId}>
                  <span>{nameOf(entry.playerId)}</span>
                  <Money cents={entry.netCents} />
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      ))}
    </div>
  );
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
