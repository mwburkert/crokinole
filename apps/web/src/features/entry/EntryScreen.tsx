import {
  countsFromDiscs,
  discsPerTeam,
  gameStanding,
  placementComplete,
  remaining,
  scoreRoundInput,
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
import { MatchScoreCard } from "./MatchScoreCard";
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
  const { getGame, addRound, updateRound, players } = useStore();

  /** Positions are the source of truth; counts are derived from them (§3.5). */
  const [discs, setDiscs] = useState<PlacedDisc[]>([]);
  /** Set only when a round was typed in rather than placed. */
  const [manualCounts, setManualCounts] = useState<{ a: RingCounts; b: RingCounts } | null>(null);
  const [totals, setTotals] = useState<{ a: number; b: number } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Placement history for undo/redo. Rounds already committed use their own undo. */
  const [past, setPast] = useState<PlacedDisc[][]>([]);
  const [future, setFuture] = useState<PlacedDisc[][]>([]);
  /** Which round the scoreboard overlay is showing. `null` = the live one. */
  const [editing, setEditing] = useState<number | null>(null);
  /** The scorecard is the moment the match ends; the settlement follows it. */
  const [cardDone, setCardDone] = useState(false);

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

  const apply = (next: PlacedDisc[]): void => {
    setPast((stack) => [...stack, discs]);
    setFuture([]);
    setDiscs(next);
  };

  const undo = (): void => {
    setPast((stack) => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setFuture((ahead) => [discs, ...ahead]);
      setDiscs(previous);
      return stack.slice(0, -1);
    });
  };

  const redo = (): void => {
    setFuture((stack) => {
      const next = stack[0];
      if (!next) return stack;
      setPast((behind) => [...behind, discs]);
      setDiscs(next);
      return stack.slice(1);
    });
  };

  const reset = (): void => {
    setPast([]);
    setFuture([]);
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

    // The scorecard IS the "Final" card — the old one restated what the sheet
    // already shows, so it's gone rather than stacked on top of it. Money comes
    // after, once you've had the moment.
    if (!cardDone) {
      return (
        <div className="stack">
          <MatchScoreCard
            rounds={game.rounds.map((round) => {
              const score = scoreRoundInput(round, cfg);
              return {
                index: round.index,
                aPoints: score.aPoints,
                bPoints: score.bPoints,
                result: score.result,
              };
            })}
            teamAName={sideName("A")}
            teamBName={sideName("B")}
            matchPoints={standing.matchPoints}
            colorA={colorA}
            colorB={colorB}
            onDone={() => setCardDone(true)}
          />
        </div>
      );
    }

    return (
      <div className="stack">
        <Card>
          <p style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>
            {sideName(winner)} win {standing.matchPoints[winner]}–
            {standing.matchPoints[winner === "A" ? "B" : "A"]}
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
      {/* The round score leads — it's what people call out mid-round. Match
          score and target are context, so they sit above it on one line. */}
      <div className="scorecontext">
        <span>
          Match Score: <span className="num">{standing.matchPoints.A}</span>
          <span className="matchscore__dash">–</span>
          <span className="num">{standing.matchPoints.B}</span>
        </span>
        <span>Game to {cfg.targetMatchPoints}</span>
      </div>

      <div className="scoreline">
        <div className={`scoreline__side scoreline__side--${colorA}`}>
          <span className="scoreline__mp num">{pending.aPoints}</span>
        </div>
        <div className="scoreline__label">
          round {game.rounds.length + 1}
          <button
            type="button"
            className="scorebtn"
            aria-label="Scoreboard and manual scoring"
            aria-expanded={showManual}
            onClick={() => setShowManual((current) => !current)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <rect x="2" y="3" width="20" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="2" />
              <line x1="2" y1="9" x2="22" y2="9" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>
        <div className={`scoreline__side scoreline__side--right scoreline__side--${colorB}`}>
          <span className="scoreline__mp num">{pending.bPoints}</span>
        </div>
      </div>


      {showManual ? (
        <div className="overlay" role="dialog" aria-label="Scoreboard">
          <div className="overlay__sheet">
          <ManualEntry
            config={cfg}
            roundIndex={editing ?? game.rounds.length}
            roundCount={game.rounds.length}
            onNavigate={(index) => setEditing(index >= game.rounds.length ? null : index)}
            a={editing === null ? a : (game.rounds[editing]?.A ?? a)}
            b={editing === null ? b : (game.rounds[editing]?.B ?? b)}
            onApply={(next) => {
              // Editing a committed round writes straight through; the board
              // behind the overlay stays on the live round either way.
              if (editing !== null && gameId) {
                if ("totals" in next) return;
                updateRound(gameId, editing, next.a, next.b);
                setEditing(null);
                return;
              }
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
            onClose={() => {
              setShowManual(false);
              setEditing(null);
            }}
          />
          </div>
        </div>
      ) : null}

      {(
        <BoardScorer
          discs={discs}
          onChange={(next) => {
            apply(next);
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
        <div className="overlay" role="dialog" aria-label="Finish round">
          <div className="overlay__sheet">
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
          </div>
        </div>
      ) : null}

      {(
        <button
          type="button"
          className="btn btn--accent btn--block btn--lg"
          onClick={commit}
        >
          Finish round
        </button>
      )}

      <div className="row row--tools" style={{ marginTop: "0.5rem" }}>
        <button type="button" className="btn btn--ghost" onClick={reset}>
          Clear
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          aria-label="Undo"
          disabled={past.length === 0}
          onClick={undo}
        >
          ↶
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          aria-label="Redo"
          disabled={future.length === 0}
          onClick={redo}
        >
          ↷
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
