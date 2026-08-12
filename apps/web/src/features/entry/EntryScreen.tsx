import {
  EMPTY_RING_COUNTS,
  discsPerTeam,
  discsUsed,
  gameStanding,
  roundPoints,
  scoreRound,
  settle,
  validateRound,
  type RingCounts,
  type TeamKey,
} from "@crokinole/core";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useStore } from "../../data/store";
import { Card, Money, Stepper } from "../../ui/components";

const RINGS: { key: keyof RingCounts; label: string }[] = [
  { key: "twenties", label: "20" },
  { key: "fifteens", label: "15" },
  { key: "tens", label: "10" },
  { key: "fives", label: "5" },
];

/**
 * Round entry — §3.5 steps 2 to 5. **This is the screen that has to be fast.**
 * Used standing next to a board, one-handed, possibly with a beer. Everything
 * else in the app can be mediocre; this can't.
 *
 * The differential is the largest thing on screen because it's what players
 * actually call out to each other mid-round.
 */
export function EntryScreen(): ReactNode {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { getGame, addRound, removeLastRound, players } = useStore();

  const [a, setA] = useState<RingCounts>({ ...EMPTY_RING_COUNTS });
  const [b, setB] = useState<RingCounts>({ ...EMPTY_RING_COUNTS });

  const game = gameId ? getGame(gameId) : undefined;
  if (!game) return <p className="empty">That game is gone.</p>;

  const cfg = game.config;
  const standing = gameStanding(game.rounds, cfg);
  const pending = scoreRound(a, b, cfg);
  const budget = discsPerTeam(cfg);

  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.displayName ?? "?";
  const sideName = (team: TeamKey): string => game.teams[team].playerIds.map(nameOf).join(" & ");

  const issues = validateRound({ index: game.rounds.length, A: a, B: b }, cfg, game.teams);
  const blocking = issues.filter((issue) => issue.severity === "error");

  const reset = (): void => {
    setA({ ...EMPTY_RING_COUNTS });
    setB({ ...EMPTY_RING_COUNTS });
  };

  const commit = (): void => {
    if (!gameId || blocking.length > 0) return;
    addRound(gameId, a, b);
    reset();
  };

  // Auto-finish (§3.5 step 5): the game flips itself the moment a side reaches
  // the target with a lead, shows the settlement, and offers the same four again.
  if (standing.isComplete) {
    const result = settle(game);
    const winner = standing.winner as TeamKey;
    const everyone = [...game.teams.A.playerIds, ...game.teams.B.playerIds];
    return (
      <div className="stack">
        <Card title="Final">
          <p style={{ fontSize: "1.35rem", fontWeight: 800, margin: "0 0 0.35rem" }}>
            {sideName(winner)} win
          </p>
          <p className="num muted" style={{ margin: 0 }}>
            {standing.matchPoints[winner]}–{standing.matchPoints[winner === "A" ? "B" : "A"]} match
            points over {standing.roundsPlayed} rounds
          </p>
        </Card>

        <Card title="Settle up">
          {result.map((entry) => (
            <div className="spread" key={entry.playerId}>
              <span>{nameOf(entry.playerId)}</span>
              <Money cents={entry.netCents} />
            </div>
          ))}
        </Card>

        <Link
          className="btn btn--accent btn--block btn--lg"
          to={`/games/new?players=${everyone.join(",")}`}
        >
          Start next game, same {everyone.length}
        </Link>
        <Link className="btn btn--block" to={`/games/${game.id}`}>
          See the detail
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="scoreline">
        <div className="scoreline__side">
          <span className={`disc disc--${game.teams.A.color}`} />
          <span className="scoreline__mp num">{standing.matchPoints.A}</span>
        </div>
        <div className="scoreline__label">
          to {cfg.targetMatchPoints}
          <br />
          round {game.rounds.length + 1}
        </div>
        <div className="scoreline__side scoreline__side--right">
          <span className="scoreline__mp num">{standing.matchPoints.B}</span>
          <span className={`disc disc--${game.teams.B.color}`} />
        </div>
      </div>

      <div className="boards">
        {(["A", "B"] as TeamKey[]).map((team) => {
          const counts = team === "A" ? a : b;
          const setCounts = team === "A" ? setA : setB;
          const used = discsUsed(counts);
          return (
            <div className="board" key={team}>
              <div className="board__head">
                <span className={`disc disc--${game.teams[team].color}`} />
                <span>{sideName(team)}</span>
              </div>
              {RINGS.map((ring) => (
                <Stepper
                  key={ring.key}
                  label={ring.label}
                  value={counts[ring.key]}
                  onChange={(value) => setCounts({ ...counts, [ring.key]: value })}
                  canIncrement={used < budget}
                />
              ))}
              <div className="board__total num">{roundPoints(counts, cfg)}</div>
              <p className="faint" style={{ textAlign: "center", margin: 0 }}>
                {used}/{budget} discs
              </p>
            </div>
          );
        })}
      </div>

      <div className="differential">
        <div className="differential__value num">
          {pending.differential === 0 ? "—" : Math.abs(pending.differential)}
        </div>
        <div className="differential__who">
          {pending.result === "tie"
            ? "level"
            : `${sideName(pending.result)} by ${Math.abs(pending.differential)}`}
        </div>
      </div>

      {issues.map((issue, index) => (
        <p key={index} className={`issue issue--${issue.severity}`}>
          {issue.message}
        </p>
      ))}

      <button
        type="button"
        className="btn btn--accent btn--block btn--lg"
        onClick={commit}
        disabled={blocking.length > 0}
      >
        Commit round
        {pending.result !== "tie"
          ? ` · ${sideName(pending.result)} +${cfg.matchPointsWin}`
          : ` · ${cfg.matchPointsTie} each`}
      </button>

      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="btn btn--ghost" onClick={reset}>
          Clear
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={game.rounds.length === 0}
          onClick={() => gameId && removeLastRound(gameId)}
        >
          Undo last round
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/games")}>
          Finish later
        </button>
      </div>
    </div>
  );
}
