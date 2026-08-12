import { gameStanding, scoreRoundInput, settle, type TeamKey } from "@crokinole/core";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useStore } from "../../data/store";
import { Badge, Card, Money } from "../../ui/components";

/** Game detail, round by round, plus soft delete (§3.5). */
export function GameDetailScreen(): ReactNode {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { getGame, softDelete, players } = useStore();
  const [confirming, setConfirming] = useState(false);

  const game = gameId ? getGame(gameId) : undefined;
  if (!game) return <p className="empty">That game is gone.</p>;

  const standing = gameStanding(game.rounds, game.config);
  const result = settle(game);
  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.displayName ?? "?";
  const sideName = (team: TeamKey): string => game.teams[team].playerIds.map(nameOf).join(" & ");

  return (
    <div className="stack">
      <Card>
        <div className="spread">
          <span>
            <span className={`disc disc--${game.teams.A.color}`} /> <strong>{sideName("A")}</strong>
          </span>
          <span className="game-row__score num">
            {standing.matchPoints.A}–{standing.matchPoints.B}
          </span>
        </div>
        <div className="spread">
          <span>
            <span className={`disc disc--${game.teams.B.color}`} /> <strong>{sideName("B")}</strong>
          </span>
          {game.status === "in_progress" ? <Badge live>In progress</Badge> : <Badge>Final</Badge>}
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          {new Date(game.playedAt).toLocaleString()} · {game.config.format} ·{" "}
          {game.config.discsPerPlayer} discs each
        </p>
      </Card>

      <Card title="Rounds">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{sideName("A")}</th>
                <th scope="col">{sideName("B")}</th>
                <th scope="col">Diff</th>
                <th scope="col">MP</th>
              </tr>
            </thead>
            <tbody>
              {game.rounds.map((round) => {
                const score = scoreRoundInput(round, game.config);
                return (
                  <tr key={round.index}>
                    <td>{round.index + 1}</td>
                    <td className="num">{score.aPoints}</td>
                    <td className="num">{score.bPoints}</td>
                    <td className="num">
                      {score.differential === 0 ? "—" : Math.abs(score.differential)}
                    </td>
                    <td className="num">
                      {score.matchPoints.A}–{score.matchPoints.B}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {game.rounds.length === 0 ? <p className="faint">No rounds yet.</p> : null}
      </Card>

      {result.length > 0 ? (
        <Card title="Settlement">
          {result.map((entry) => (
            <div className="spread" key={entry.playerId}>
              <span>{nameOf(entry.playerId)}</span>
              <Money cents={entry.netCents} />
            </div>
          ))}
        </Card>
      ) : null}

      {game.status === "in_progress" ? (
        <Link className="btn btn--accent btn--block btn--lg" to={`/games/${game.id}/play`}>
          Resume entry
        </Link>
      ) : null}

      {confirming ? (
        <Card title="Delete this game?">
          <p className="faint">
            It's a soft delete — the record stays and an admin can restore it. Money is involved,
            so nothing is ever really thrown away.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => {
                if (gameId) softDelete(gameId);
                navigate("/games");
              }}
            >
              Delete
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </Card>
      ) : (
        <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirming(true)}>
          Delete game
        </button>
      )}
    </div>
  );
}
