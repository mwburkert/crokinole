import {
  countsFromDiscs,
  discsPerTeam,
  gameStanding,
  placementComplete,
  remaining,
  snapIntoRegion,
  scoreRound,
  settle,
  type PlacedDisc,
  type RingCounts,
  type TeamKey,
} from "@crokinole/core";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useStore } from "../../data/store";
import { Card, Money } from "../../ui/components";
import { BoardScorer } from "./BoardScorer";
import { ManualEntry } from "./ManualEntry";

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

  /** Positions are the source of truth; counts are derived from them (§3.5). */
  const [discs, setDiscs] = useState<PlacedDisc[]>([]);
  /** Set only when a round was typed in rather than placed. */
  const [manualCounts, setManualCounts] = useState<{ a: RingCounts; b: RingCounts } | null>(null);
  const [totals, setTotals] = useState<{ a: number; b: number } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const game = gameId ? getGame(gameId) : undefined;
  if (!game) return <p className="empty">That game is gone.</p>;

  const cfg = game.config;
  const standing = gameStanding(game.rounds, cfg);
  const budget = discsPerTeam(cfg);
  const colorA = game.teams.A.color;
  const colorB = game.teams.B.color;

  // countsFromDiscs is the ONLY path from a placed board to counts, so the two
  // can never disagree (§3.5).
  const a = manualCounts ? manualCounts.a : countsFromDiscs(discs, colorA);
  const b = manualCounts ? manualCounts.b : countsFromDiscs(discs, colorB);
  const pending = scoreRound(a, b, cfg, totals ? { A: totals.a, B: totals.b } : undefined);

  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.displayName ?? "?";
  const sideName = (team: TeamKey): string => game.teams[team].playerIds.map(nameOf).join(" & ");

  const left = remaining(discs, budget);
  const complete = manualCounts !== null || totals !== null || placementComplete(discs, budget);
  const stillToPlace = left.black + left.white;

  const reset = (): void => {
    setDiscs([]);
    setManualCounts(null);
    setTotals(null);
    setConfirming(false);
  };

  const write = (): void => {
    if (!gameId) return;
    addRound(gameId, a, b);
    reset();
  };

  /** Prompt before losing detail, per §3.5. */
  const commit = (): void => {
    if (!gameId) return;
    if (!complete) {
      setConfirming(true);
      return;
    }
    write();
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
          to={`/games/new?format=${cfg.format}&players=${everyone.join(",")}`}
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
        <div className={`scoreline__side scoreline__side--${colorA}`}>
          <span className="scoreline__mp num">{standing.matchPoints.A}</span>
        </div>
        <div className="scoreline__label">
          to {cfg.targetMatchPoints}
          <br />
          round {game.rounds.length + 1}
          <button
            type="button"
            className="infobtn"
            aria-label="Manual scoring"
            aria-expanded={showManual}
            onClick={() => setShowManual((current) => !current)}
            style={{ justifyContent: "center", minHeight: "1.5rem" }}
          >
            ⋯
          </button>
        </div>
        <div className={`scoreline__side scoreline__side--right scoreline__side--${colorB}`}>
          <span className="scoreline__mp num">{standing.matchPoints.B}</span>
        </div>
      </div>

      {showManual ? (
        <Card>
          <ManualEntry
            config={cfg}
            a={a}
            b={b}
            onApply={(next) => {
              if ("totals" in next) {
                // Score-only: no detail, so the board stays empty.
                setTotals(next.totals);
                setManualCounts(null);
                setDiscs([]);
              } else {
                // Section counts populate the board when the menu closes.
                setTotals(null);
                setManualCounts(next);
                setDiscs(discsFromCounts(next.a, colorA).concat(discsFromCounts(next.b, colorB)));
              }
            }}
            onClose={() => setShowManual(false)}
          />
        </Card>
      ) : (
        <BoardScorer
          discs={discs}
          onChange={(next) => {
            setDiscs(next);
            // Touching the board makes it authoritative again.
            setManualCounts(null);
            setTotals(null);
          }}
          perTeam={budget}
          colorA={colorA}
          colorB={colorB}
        />
      )}

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

      {confirming ? (
        <Card>
          <p style={{ margin: "0 0 0.25rem", fontWeight: 700 }}>
            Place {stillToPlace} more {stillToPlace === 1 ? "disc" : "discs"} to record detailed
            scoring
          </p>
          <p className="faint" style={{ margin: "0 0 0.75rem" }}>
            Skipping will only record the total score.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button type="button" className="btn btn--accent" onClick={write}>
              Skip
            </button>
          </div>
        </Card>
      ) : (
        <button
          type="button"
          className="btn btn--accent btn--block btn--lg"
          onClick={commit}
        >
          Commit round
          {pending.result !== "tie"
            ? ` · ${sideName(pending.result)} +${cfg.matchPointsWin}`
            : ` · ${cfg.matchPointsTie} each`}
        </button>
      )}

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

/**
 * Lay counts out on the board so section entry and the board agree.
 * Positions are arbitrary within the correct ring — the ring is what carries
 * meaning, and dragging afterwards refines it.
 */
function discsFromCounts(counts: RingCounts, color: "black" | "white"): PlacedDisc[] {
  const out: PlacedDisc[] = [];
  const rings: [keyof RingCounts, Parameters<typeof snapIntoRegion>[2], number][] = [
    ["twenties", "twenty", 0],
    ["fifteens", "fifteen", 19],
    ["tens", "ten", 44],
    ["fives", "five", 72],
  ];
  let seed = color === "black" ? 0 : Math.PI;
  for (const [key, region, radius] of rings) {
    const n = counts[key];
    for (let i = 0; i < n; i += 1) {
      seed += 0.8;
      const point = snapIntoRegion(
        100 + Math.cos(seed) * radius,
        100 + Math.sin(seed) * radius,
        region,
      );
      out.push({ id: `m${color}${key}${i}`, color, x: point.x, y: point.y, region });
    }
  }
  return out;
}
