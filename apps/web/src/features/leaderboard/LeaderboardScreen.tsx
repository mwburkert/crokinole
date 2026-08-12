import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useLeaderboard, useLiveGame, useVisibleGames } from "../../data/store";
import { Card, Empty, Money } from "../../ui/components";

/**
 * Standings (§3.5, route `/`).
 *
 * Behind auth like everything else since 2026-08-12, which is why earnings
 * simply appear here — with no anonymous audience there is nothing to withhold,
 * and the old `publicLeaderboard` / `fullStats` split is gone.
 */
export function LeaderboardScreen(): ReactNode {
  const rows = useLeaderboard();
  const games = useVisibleGames();
  const live = useLiveGame();
  const played = rows.filter((row) => row.gamesPlayed > 0);

  return (
    <div className="stack">
      {live ? (
        <Link className="banner" to={`/games/${live.id}/play`} style={{ display: "block" }}>
          A game is in progress — tap to resume.
        </Link>
      ) : null}

      <Card title="Standings">
        {played.length === 0 ? (
          <Empty>No games yet. Start one and it'll show up here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">GP</th>
                  <th scope="col">W</th>
                  <th scope="col">L</th>
                  <th scope="col">Win %</th>
                  <th scope="col">MP&nbsp;+/−</th>
                  <th scope="col">Net</th>
                </tr>
              </thead>
              <tbody>
                {played.map((row) => (
                  <tr key={row.playerId}>
                    <td>{row.displayName}</td>
                    <td className="num">{row.gamesPlayed}</td>
                    <td className="num">{row.gamesWon}</td>
                    <td className="num">{row.gamesLost}</td>
                    <td className="num">{Math.round(row.winPct * 100)}%</td>
                    <td className="num">
                      {row.matchPointsFor - row.matchPointsAgainst > 0 ? "+" : ""}
                      {row.matchPointsFor - row.matchPointsAgainst}
                    </td>
                    <td>
                      <Money cents={row.netCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="At a glance">
        <div className="spread">
          <span className="muted">Games logged</span>
          <span className="num">{games.length}</span>
        </div>
        <div className="spread">
          <span className="muted">Players with a game</span>
          <span className="num">{played.length}</span>
        </div>
      </Card>

      <Link className="btn btn--accent btn--block btn--lg" to="/games/new">
        New game
      </Link>
    </div>
  );
}
