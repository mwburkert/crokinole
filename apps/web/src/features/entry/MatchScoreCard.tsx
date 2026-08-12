import type { DiscColor } from "@crokinole/core";
import type { CSSProperties, ReactNode } from "react";

import "../../ui/scorecard.css";

export interface MatchScoreCardProps {
  rounds: { index: number; aPoints: number; bPoints: number; result: "A" | "B" | "tie" }[];
  teamAName: string;
  teamBName: string;
  matchPoints: { A: number; B: number };
  colorA: DiscColor;
  colorB: DiscColor;
  /** Called when the card is dismissed. */
  onDone: () => void;
}

/**
 * The finished match, drawn as the paper scorecard someone would have kept by
 * hand: partner names at the head of each column, the rounds ticked off down
 * the middle, a rule, and the match score under it.
 *
 * This is the payoff moment of a night, so the marks write themselves on in
 * sequence rather than appearing all at once — the same information, but it
 * lands like a result rather than a table refresh.
 */
export function MatchScoreCard({
  rounds,
  teamAName,
  teamBName,
  matchPoints,
  colorA,
  colorB,
  onDone,
}: MatchScoreCardProps): ReactNode {
  // Every animated element carries its place in the queue and the stylesheet
  // turns that into a delay, so the cascade stays in step no matter how many
  // rounds were played.
  const ruleBeat = rounds.length + 1;
  const totalBeat = ruleBeat + 1;

  // A match can't end level under `winBy` (§3.4), but the card is handed plain
  // numbers, so a draw is drawn rather than trusted away — nobody gets circled.
  const winner: "A" | "B" | null =
    matchPoints.A > matchPoints.B ? "A" : matchPoints.B > matchPoints.A ? "B" : null;

  return (
    <section className="scorecard" aria-label="Match scorecard">
      <div className="scorecard__sheet">
        <p className="scorecard__title">Scorecard</p>

        <table className="scorecard__table">
          <caption className="scorecard__sr">
            Each round&apos;s winner, then the final match score
          </caption>
          <thead>
            <tr className="scorecard__row" style={beat(0)}>
              <th scope="col" className="scorecard__team">
                <Swatch color={colorA} />
                {teamAName}
              </th>
              <th scope="col" className="scorecard__roundhead">
                <span className="scorecard__sr">Round</span>
              </th>
              <th scope="col" className="scorecard__team">
                <Swatch color={colorB} />
                {teamBName}
              </th>
            </tr>
          </thead>

          <tbody>
            {rounds.map((round, position) => (
              /*
               * The newest round is the point of the card, so it gets its own
               * beat: everything already played is simply present, then that
               * row's marks draw, its points fade in behind them, and the match
               * total drops last. Earlier rounds cascading again each time made
               * the one thing that just happened impossible to pick out.
               */
              <tr
                className="scorecard__row"
                key={round.index}
                data-latest={position === rounds.length - 1 ? "true" : undefined}
                style={beat(position + 1)}
              >
                <td className="scorecard__cell">
                  <Mark outcome={outcomeFor("A", round.result)} />
                  <span className="scorecard__points">{round.aPoints}</span>
                </td>
                {/* Round labels are 1-based for humans; the data is 0-based (§3.3). */}
                <th scope="row" className="scorecard__round">
                  Round {round.index + 1}
                </th>
                <td className="scorecard__cell">
                  <Mark outcome={outcomeFor("B", round.result)} />
                  <span className="scorecard__points">{round.bPoints}</span>
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr style={beat(ruleBeat)}>
              <td className="scorecard__rulecell" colSpan={3}>
                <span className="scorecard__rule" />
              </td>
            </tr>
            <tr className="scorecard__row" style={beat(totalBeat)}>
              <td className="scorecard__cell scorecard__cell--total">
                <Total value={matchPoints.A} circled={winner === "A"} />
              </td>
              <th scope="row" className="scorecard__round scorecard__round--total">
                Match
              </th>
              <td className="scorecard__cell scorecard__cell--total">
                <Total value={matchPoints.B} circled={winner === "B"} />
              </td>
            </tr>
          </tfoot>
        </table>

        <button
          type="button"
          className="scorecard__done"
          style={beat(totalBeat + 1)}
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </section>
  );
}

/** Where this element sits in the entrance cascade; CSS turns it into a delay. */
function beat(index: number): CSSProperties {
  return { "--scorecard-i": index } as CSSProperties;
}

type Outcome = "win" | "loss" | "tie";

function outcomeFor(side: "A" | "B", result: "A" | "B" | "tie"): Outcome {
  if (result === "tie") return "tie";
  return result === side ? "win" : "loss";
}

/**
 * The mark in one column for one round: a green check, a red X, or — on a tie —
 * a hyphen in both columns.
 *
 * `pathLength={1}` normalises each stroke so the same dash animation writes any
 * of them on, whatever their real length.
 */
function Mark({ outcome }: { outcome: Outcome }): ReactNode {
  if (outcome === "win") {
    return (
      <svg
        className="scorecard__mark scorecard__mark--win"
        viewBox="0 0 24 24"
        role="img"
        aria-label="Won"
      >
        <path className="scorecard__stroke" pathLength={1} d="M3.5 13.2 L9.4 19.4 L20.6 4.6" />
      </svg>
    );
  }
  if (outcome === "loss") {
    return (
      <svg
        className="scorecard__mark scorecard__mark--loss"
        viewBox="0 0 24 24"
        role="img"
        aria-label="Lost"
      >
        <path className="scorecard__stroke" pathLength={1} d="M4.8 4.4 L19.4 19.2" />
        <path
          className="scorecard__stroke scorecard__stroke--second"
          pathLength={1}
          d="M19.2 4.6 L4.6 19.4"
        />
      </svg>
    );
  }
  return (
    <svg
      className="scorecard__mark scorecard__mark--tie"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Tied"
    >
      <path className="scorecard__stroke" pathLength={1} d="M4.5 12.4 L19.5 11.8" />
    </svg>
  );
}

/** A side's match points, with the winner ringed the way you'd ring it on paper. */
function Total({ value, circled }: { value: number; circled: boolean }): ReactNode {
  return (
    <span className="scorecard__totalwrap">
      <span className="scorecard__total">{value}</span>
      {circled ? (
        <svg
          className="scorecard__circle"
          viewBox="0 0 100 60"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Deliberately not a closed ellipse — it overshoots its start, which
              is what a ring drawn in one go actually does. */}
          <path
            className="scorecard__stroke"
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            d="M56 6 C 22 3, 3 18, 6 34 C 9 51, 40 59, 62 56 C 86 53, 98 40, 94 25 C 91 12, 70 4, 44 7"
          />
        </svg>
      ) : null}
    </span>
  );
}

/** Which discs a side played, so the columns match the board they just left. */
function Swatch({ color }: { color: DiscColor }): ReactNode {
  return <span className={`scorecard__swatch scorecard__swatch--${color}`} aria-hidden="true" />;
}
