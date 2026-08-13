import {
  countsFromDiscs,
  discsPerTeam,
  EMPTY_RING_COUNTS,
  gameStanding,
  placementComplete,
  remaining,
  scoreRoundInput,
  snapIntoRegion,
  scoreRound,
  settle,
  type DiscColor,
  type PlacedDisc,
  type RingCounts,
  type TeamKey,
} from "@crokinole/core";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { isPendingGameId, useStore } from "../../data/store";
import { Card, Empty, Loading, Money } from "../../ui/components";
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
  const { getGame, addRound, updateRound, players, isLoading } = useStore();

  /** Positions are the source of truth; counts are derived from them (§3.5). */
  const [discs, setDiscs] = useState<PlacedDisc[]>([]);
  /** Set only when a round was typed in rather than placed. */
  const [manualCounts, setManualCounts] = useState<{ a: RingCounts; b: RingCounts } | null>(null);
  const [totals, setTotals] = useState<{ a: number; b: number } | null>(null);
  /*
   * How this screen was arrived at, when it was arrived at deliberately.
   *
   * `correct` asks for the scoreboard straight away. Without it, correcting a
   * finished game meant landing on the end-of-game scorecard, dismissing it,
   * then finding the ⊞ — three taps to reach the thing you had already said you
   * wanted.
   */
  const arrival = useLocation().state as ArrivalState | null;
  const correcting = arrival?.correct === true;
  /**
   * Where closing the correction sheet goes. `null` means "close in place".
   *
   * Captured once, at mount, rather than read from `arrival` on each render:
   * the URL rewrite below replaces the history entry, and a `state` that isn't
   * deliberately carried across a `replace` is simply gone.
   *
   * Three arrivals, three answers. From history or a game's detail screen,
   * `from` names the page that sent you and closing returns to it — the sheet
   * used to just vanish, leaving you standing on the board of a game you had
   * only opened to fix, with no way back but the tab bar. The ⊞ button on the
   * live board carries no state at all, so this is `null` and closing stays
   * put; it was never a detour. And a `correct` arrival with no `from` — a
   * reload, or a pasted link — falls back to the history list, which is where
   * both real entry points live and is never wrong enough to be a dead end.
   */
  const [returnTo] = useState<string | null>(() =>
    correcting ? (arrival?.from ?? "/games") : null,
  );
  const [showManual, setShowManual] = useState(correcting);
  const [confirming, setConfirming] = useState(false);
  /** Placement history for undo/redo. Rounds already committed use their own undo. */
  const [past, setPast] = useState<PlacedDisc[][]>([]);
  const [future, setFuture] = useState<PlacedDisc[][]>([]);
  /** Which round the scoreboard overlay is showing. `null` = the live one. */
  const [editing, setEditing] = useState<number | null>(null);
  /** The scorecard is the moment the match ends; the settlement follows it. */
  const [cardDone, setCardDone] = useState(correcting);
  /** One-shot: has the "correct this game" arrival been seeded onto a round yet? */
  const [seededCorrection, setSeededCorrection] = useState(!correcting);
  /** Shown for a beat after each round so you see the match take shape. */
  const [showCard, setShowCard] = useState(false);

  const game = gameId ? getGame(gameId) : undefined;

  /*
   * Swap the placeholder in the URL for the real id, once there is one.
   *
   * `createGame` returns a `pending:` id synchronously so this screen can be
   * navigated to before Convex has answered, and the seam maps it to the real
   * id when the insert lands. That map is in memory: reload, and the URL is
   * left holding a placeholder the seam can only guess at. Rewriting the
   * address as soon as the game is known retires the guess after one frame,
   * so the URL is shareable, reloadable, and survives the game finishing.
   *
   * The arrival state rides along on purpose. `navigate` writes the new entry's
   * state from scratch, so anything not passed here is dropped — and because
   * `KeyedEntryScreen` keys this component on the game id, the rewrite remounts
   * it and everything seeded from `useLocation().state` is read again. Without
   * the hand-off, a correction that arrived on a placeholder id would forget it
   * was a correction the instant the real id landed.
   */
  useEffect(() => {
    if (game && gameId && isPendingGameId(gameId)) {
      navigate(`/games/${game.id}/play`, { replace: true, state: arrival });
    }
  }, [arrival, game, gameId, navigate]);

  // A query in flight and a game that isn't there look identical through the
  // seam — both are "no game". Saying "That game is gone" on the first frame of
  // every cold load reads as data loss on a phone refresh mid-game, so nothing
  // is declared missing until the store has actually answered.
  if (isLoading) return <Loading rows={3} />;
  /*
   * A placeholder that hasn't resolved yet means the `games.create` mutation is
   * still in flight — a game being born, not a game missing. Saying it is gone
   * would be wrong, and showing *some other* game would be worse: that was the
   * bug where starting a new game dropped you into the last one's scorecard.
   */
  if (!game && gameId && isPendingGameId(gameId)) return <Loading rows={3} />;
  if (!game) return <Empty>That game is gone.</Empty>;

  const cfg = game.config;
  const standing = gameStanding(game.rounds, cfg);

  // The server re-derives completion from scratch on every write, so correcting
  // a round can un-finish a finished game as easily as finish one. Nothing here
  // may latch "the match is over": this is the one flag that would, and it
  // stands back down the moment the standing says the game is live again.
  /*
   * Arriving to correct a game: land on **round one**.
   *
   * Something has to seed it, because `editing === null` means "the round in
   * play" and a finished game has none — left alone, the sheet opened on
   * "Round 5, in play" of a four-round match. Round one is where it seeds
   * because a correction is read forwards: you know a number is wrong
   * somewhere in the match but not usually which round, and the pager walks
   * them in the order they were played, the same order the scorecard lists
   * them. Starting at the end meant paging backwards through the whole match
   * to check it.
   *
   * One-shot, so paging away afterwards sticks — including forward onto the
   * live round of a game that the correction has just un-finished.
   */
  if (!seededCorrection) {
    setSeededCorrection(true);
    // A game with no rounds has nothing to page to, and `null` already means
    // its only round, the one in play.
    if (game.rounds.length > 0) setEditing(0);
  }

  if (!standing.isComplete && cardDone) setCardDone(false);
  // …and the other way: a correction that *ends* the match hands the screen to
  // the scorecard, so the sheet that made it happen gets out of the way rather
  // than reappearing over the settlement a moment later.
  if (standing.isComplete && !cardDone && showManual) setShowManual(false);

  const budget = discsPerTeam(cfg);
  const colorA = game.teams.A.color;
  const colorB = game.teams.B.color;

  // countsFromDiscs is the ONLY path from a placed board to counts, so the two
  // can never disagree (§3.5).
  const a = manualCounts ? manualCounts.a : countsFromDiscs(discs, colorA);
  const b = manualCounts ? manualCounts.b : countsFromDiscs(discs, colorB);
  const pending = scoreRound(a, b, cfg, totals ? { A: totals.a, B: totals.b } : undefined);

  /**
   * Whether this round actually has a board behind it.
   *
   * Positions are stored and are the source of truth when present (§3.5), so
   * the one thing the client must never do is send a board and counts that
   * disagree — the server recomputes the counts from the board on every write.
   * Two cases deliberately send nothing:
   *
   * - **typed into the manual menu.** `discsFromCounts` scatters discs into the
   *   right rings so the board agrees with what you typed, but those positions
   *   are invented. Storing them would let you replay a board that never
   *   existed. A manual round legitimately has no positions and its counts
   *   stand alone.
   * - **nothing placed at all.** An empty array is not a board.
   *
   * Touching the board clears `manualCounts`, which is what makes it
   * authoritative again.
   */
  const boardIsSource = manualCounts === null && totals === null && discs.length > 0;

  const nameOf = (id: string): string =>
    players.find((player) => player.id === id)?.displayName ?? "?";
  const sideName = (team: TeamKey): string => game.teams[team].playerIds.map(nameOf).join(" & ");
  /** Who is on a side, in seat order, for the pinned score card. */
  const rosterOf = (team: TeamKey): Seat[] =>
    game.teams[team].playerIds.map((id) => ({ id, name: nameOf(id) }));

  const left = remaining(discs, budget);
  const complete = manualCounts !== null || totals !== null || placementComplete(discs, budget);
  const stillToPlace = left.black + left.white;

  /**
   * A board edit. **Touching the board makes it the source of truth again.**
   *
   * ⚠️ This used to leave `manualCounts` and `totals` standing while the comment
   * above claimed otherwise. Typing counts into the manual menu seeds the board
   * to match, so the two agreed at that instant — but the next chip you moved
   * changed only `discs`, and the score on screen went on coming from the
   * numbers you had typed. Board and scoreboard disagreed, and the *typed*
   * counts were what got written. That is the exact "two sources for one
   * number" failure this design keeps guarding against, and it is the one the
   * count-from-chip-positions rule settles: the count is where the chips are,
   * always.
   *
   * Only real board interaction reaches here — the manual menu seeds `discs`
   * directly — so clearing cannot wipe what someone has just typed.
   */
  const apply = (next: PlacedDisc[]): void => {
    setPast((stack) => [...stack, discs]);
    setFuture([]);
    setDiscs(next);
    setManualCounts(null);
    setTotals(null);
  };

  /**
   * Undo and redo move the board, so they hand authority back to it too — for
   * the same reason `apply` does. Stepping back to an earlier board while a
   * typed total still governed the score would leave the two disagreeing again,
   * just by a different route.
   */
  const undo = (): void => {
    setPast((stack) => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setFuture((ahead) => [discs, ...ahead]);
      setDiscs(previous);
      setManualCounts(null);
      setTotals(null);
      return stack.slice(0, -1);
    });
  };

  const redo = (): void => {
    setFuture((stack) => {
      const next = stack[0];
      if (!next) return stack;
      setPast((behind) => [...behind, discs]);
      setDiscs(next);
      setManualCounts(null);
      setTotals(null);
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
    // Raw inputs only: the ring counts and the positions they came from.
    // Nothing derived — the mutation works out the points, the match score and
    // whether the game is over (§3.2.1). Per-player twenties are deliberately
    // not collected here (see the score card below); they are attributed from
    // the scoreboard sheet afterwards, and `updateRound` carries them.
    addRound(gameId, a, b, {
      ...(boardIsSource ? { discs } : {}),
      // A typed total has to travel or the round lands as 0–0 — a tie, silently.
      // The counts alongside it are zeros by construction: `setTotals` clears
      // both the board and the manual counts, because a total is what you log
      // *instead of* the detail, not as well as it.
      ...(totals ? { pointsOverride: { A: totals.a, B: totals.b } } : {}),
    });
    reset();
    setShowCard(true);
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

  /** The committed round loaded into the scoreboard sheet, if any. */
  const edited = editing === null ? undefined : game.rounds[editing];

  /**
   * The scoreboard overlay.
   *
   * Built once and rendered from both the live screen and the finished one.
   * Completion is re-derived from scratch on every write, so a correction can
   * un-finish a game — which means the finished screen needs a way back in, or
   * a mis-tapped last round could only ever be fixed from another screen.
   */
  const sheet = showManual ? (
    <div className="overlay" role="dialog" aria-label="Scoreboard">
      <div className="overlay__sheet">
        <ManualEntry
          config={cfg}
          colorA={colorA}
          colorB={colorB}
          roundIndex={editing ?? game.rounds.length}
          roundCount={game.rounds.length}
          // A finished game has no round in play to page forward onto.
          {...(standing.isComplete ? { maxIndex: game.rounds.length - 1 } : {})}
          onNavigate={(index) => {
            if (standing.isComplete) {
              setEditing(Math.min(Math.max(index, 0), game.rounds.length - 1));
              return;
            }
            setEditing(index >= game.rounds.length ? null : index);
          }}
          a={editing === null ? a : (game.rounds[editing]?.A ?? a)}
          b={editing === null ? b : (game.rounds[editing]?.B ?? b)}
          onApply={(next) => {
            // Editing a committed round writes straight through; the board
            // behind the overlay stays on the live round either way.
            if (editing !== null && gameId) {
              if ("totals" in next) {
                /*
                 * A total typed over a committed round replaces whatever detail
                 * it had. It used to `return` here — the sheet looked saved and
                 * nothing was written, which is the worst of the three possible
                 * behaviours.
                 *
                 * Everything else goes: zero counts (the sections are no longer
                 * claimed, and `pointsOverride` is what supplies the total), no
                 * board (positions that no longer describe the round), and no
                 * board (positions that no longer describe the round). The
                 * mutation clears what it isn't given.
                 */
                updateRound(gameId, editing, EMPTY_RING_COUNTS, EMPTY_RING_COUNTS, {
                  pointsOverride: { A: next.totals.a, B: next.totals.b },
                });
                return;
              }
              const round = game.rounds[editing];
              // The stored board survives only while it still describes these
              // counts. Positions are the source of truth when present (§3.5),
              // so counts typed over a board they no longer match must replace
              // it — sending both would have the server recompute the old
              // board's counts straight back over the correction.
              const keepsBoard =
                round !== undefined &&
                sameCounts(round.A, next.a) &&
                sameCounts(round.B, next.b);
              const board = keepsBoard ? round?.discs : undefined;
              updateRound(gameId, editing, next.a, next.b, {
                ...(board ? { discs: board } : {}),
              });
              // Deliberately stays on the round just corrected instead of
              // jumping back to the live one: you watch the numbers land, and
              // fixing several in one sitting is what the pager is for.
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
            /*
             * A correction goes back to the page that sent it. Closing used to
             * only hide the sheet, which left you on the play screen of a game
             * you had opened solely to fix — the list you came from was gone
             * and the board in front of you wasn't the one you asked for.
             *
             * `replace`, so the detour doesn't become a stop on the back stack:
             * back from the history page goes where it always did, rather than
             * returning to a play screen that would just reopen this sheet.
             *
             * `returnTo` is null for the ⊞ sheet on the live board, which is
             * not a detour and must close exactly where it stands.
             */
            if (returnTo) navigate(returnTo, { replace: true });
          }}
        >
          {edited ? (
            <>
              {/* The board this round was actually played on. Storing positions
                  was a deliberate exception to "nothing derived is stored"
                  (§3.5) and this is what bought it — a board you can never look
                  at again is dead weight in the database. */}
              {edited.discs && edited.discs.length > 0 ? (
                <div style={{ marginTop: "0.75rem" }}>
                  <div className="manual__head">Round {edited.index + 1}, as played</div>
                  <div style={{ maxWidth: "13rem", margin: "0 auto" }}>
                    <BoardScorer
                      discs={edited.discs}
                      onChange={() => {}}
                      perTeam={budget}
                      colorA={colorA}
                      colorB={colorB}
                      readOnly
                    />
                  </div>
                  <p className="faint" style={{ margin: "0.25rem 0 0", textAlign: "center" }}>
                    Changing the counts above replaces this board.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </ManualEntry>
      </div>
    </div>
  ) : null;

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

        {/* Opens on round one, the same as arriving from history: one rule for
            where a correction starts, so the sheet never depends on which door
            you came through. Completion is re-derived on every write, so a
            correction made here can hand the game back to whoever was losing —
            including from round one, whose match points the rest of the match
            was counted on top of. */}
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => {
            setEditing(0);
            setShowManual(true);
          }}
        >
          Correct a round
        </button>

        {sheet}
      </div>
    );
  }

  // The scorecard between rounds: the same sheet as the final one, showing the
  // match so far. Replaces the board rather than overlaying it, so the moment
  // has the screen to itself.
  if (showCard) {
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
          onDone={() => setShowCard(false)}
        />
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
        <ScoreSide points={pending.aPoints} color={colorA} roster={rosterOf("A")} />
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
        <ScoreSide points={pending.bPoints} color={colorB} roster={rosterOf("B")} edge="right" />
      </div>


      {sheet}

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

      {/*
       * Twenties (§3.5 step 4) used to sit here, as a collapsed row per team.
       * It is gone from the live board on purpose: the fast path is board →
       * *Finish round*, and a row that appeared under the board the moment
       * anyone sank a twenty put a control in front of the only button this
       * screen exists to press. Attribution is not lost — it moved to the
       * scoreboard sheet, where a committed round can be opened and each
       * player's twenties stepped in, and `updateRound` writes them.
       */}
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
          ↺
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          aria-label="Redo"
          disabled={future.length === 0}
          onClick={redo}
        >
          ↻
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/games")}>
          Finish later
        </button>
      </div>
    </div>
  );
}

/**
 * What a deliberate arrival at this screen carries in the router's `state`.
 *
 * Both correction doors set it — the history list and a game's detail screen.
 * "Resume" on an unfinished game deliberately does not: resuming is entering
 * rounds, not correcting them, so it must behave exactly as walking up to a
 * live board does. Neither does the tab bar, and neither does a reload, which
 * is why every field is optional and the screen has to work with none of them.
 */
interface ArrivalState {
  /** Open on the scoreboard sheet rather than the board or the scorecard. */
  correct?: boolean;
  /** The path the sheet's close button returns to. */
  from?: string;
}

/** One seat on a side: the id keys the list, the nickname is what's shown. */
interface Seat {
  id: string;
  name: string;
}

/**
 * One side of the pinned score card: that side's round score, with its players'
 * nicknames stacked beside it.
 *
 * Which side of the number the names sit on follows the **discs, not the seat**
 * — black's names read out to the right of its score, white's mirror to the
 * left — so a colour's names always lean the same way whichever end of the
 * board that colour drew. Flipping colours on a game therefore flips the whole
 * card without a second layout, and nothing here assumes team A is black.
 *
 * The names are the only thing on this line allowed to shrink. The round scores
 * are the largest type on screen because they are what players call out
 * mid-round (§3.5), so they keep their size and the names ellipsise instead —
 * `MAX_NAME_LENGTH` means that should never bite, but two long nicknames a side
 * on a 393px phone is exactly the case that has to hold.
 */
function ScoreSide({
  points,
  color,
  roster,
  edge,
}: {
  points: number;
  color: DiscColor;
  roster: Seat[];
  /** The right-hand side packs its content against the outer edge. */
  edge?: "right";
}): ReactNode {
  const names = (
    <span className={`scoreline__names scoreline__names--${color}`}>
      {roster.map((seat) => (
        <span className="scoreline__name" key={seat.id}>
          {seat.name}
        </span>
      ))}
    </span>
  );

  return (
    <div
      className={`scoreline__side scoreline__side--${color}${
        edge === "right" ? " scoreline__side--right" : ""
      }`}
    >
      {color === "white" ? names : null}
      <span className="scoreline__mp num">{points}</span>
      {color === "black" ? names : null}
    </div>
  );
}

/**
 * Whether two ring counts describe the same round.
 *
 * Not a scoring rule — four numbers compared, only so a correction can tell
 * whether the board it is saving over still describes what it is saving.
 */
function sameCounts(left: RingCounts, right: RingCounts): boolean {
  return (
    left.twenties === right.twenties &&
    left.fifteens === right.fifteens &&
    left.tens === right.tens &&
    left.fives === right.fives
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
