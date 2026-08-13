import { gameStanding, scoreRoundInput, settle, type TeamKey } from "@crokinole/core";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useStore } from "../../data/store";
import { Badge, Card, Loading, Money } from "../../ui/components";

/** Game detail, round by round, plus soft delete (§3.5). */
export function GameDetailScreen(): ReactNode {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { getGame, softDelete, players, isLoading } = useStore();
  const [confirming, setConfirming] = useState(false);

  const game = gameId ? getGame(gameId) : undefined;
  // "Not in the list yet" and "not in the list at all" are the same `undefined`,
  // so this has to wait before it accuses anyone of losing a game. Told the
  // wrong way round it reads as data loss on a mid-game refresh, which is the
  // one thing this screen must never do.
  if (!game) {
    return isLoading ? (
      <Card>
        <Loading rows={3} />
      </Card>
    ) : (
      <p className="empty">That game is gone.</p>
    );
  }

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

      {/*
        The same destination either way — the play screen is where rounds are
        entered *and* corrected. A finished game had no route back into it from
        here, which meant the one screen showing a wrong number was the one
        screen you could do nothing about.

        Correcting carries `from`, this page, so closing the sheet returns to
        the round-by-round table the wrong number was spotted in. Resuming
        carries nothing: it is the live board, not a correction, and closing its
        scoreboard must stay on the board.
      */}
      <Link
        className="btn btn--accent btn--block btn--lg"
        to={`/games/${game.id}/play`}
        state={
          game.status === "in_progress"
            ? undefined
            : { correct: true, from: `/games/${game.id}` }
        }
      >
        {game.status === "in_progress" ? "Resume entry" : "Correct a round"}
      </Link>

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
