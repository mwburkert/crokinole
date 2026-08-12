import {
  discsPerTeam,
  roundPoints,
  type RingCounts,
  type ScoringConfig,
} from "@crokinole/core";
import { useState, type ReactNode } from "react";

const RINGS: { key: keyof RingCounts; label: string }[] = [
  { key: "twenties", label: "20" },
  { key: "fifteens", label: "15" },
  { key: "tens", label: "10" },
  { key: "fives", label: "5" },
];

export interface ManualEntryProps {
  config: ScoringConfig;
  a: RingCounts;
  b: RingCounts;
  /** `totals` set means score-only: no section detail, so no board placement. */
  onApply: (next: { a: RingCounts; b: RingCounts } | { totals: { a: number; b: number } }) => void;
  onClose: () => void;

  /** 0-based index being edited. Equals `roundCount` when it's the live round. */
  roundIndex: number;
  /** How many rounds are already committed. */
  roundCount: number;
  /** Ask the parent to switch which round is loaded into `a` / `b`. */
  onNavigate: (index: number) => void;
}

/**
 * Manual scoring, behind the three-dot menu above the scoreboard (§3.5).
 *
 * Two ways in: per-section counts, or a straight total for logging a round
 * without detail. Section counts entered here **populate the board** when the
 * menu closes — the two views are the same data, not two records.
 *
 * It doubles as the scoreboard's back-catalogue: page back through committed
 * rounds to fix one that was typed wrong, then page forward to the live round.
 * The board behind the overlay stays on the live round throughout — only this
 * sheet moves, so a correction never disturbs the round in play.
 */
export function ManualEntry({
  config,
  a,
  b,
  onApply,
  onClose,
  roundIndex,
  roundCount,
  onNavigate,
}: ManualEntryProps): ReactNode {
  const [draftA, setDraftA] = useState<RingCounts>({ ...a });
  const [draftB, setDraftB] = useState<RingCounts>({ ...b });
  const [totalA, setTotalA] = useState("");
  const [totalB, setTotalB] = useState("");
  /**
   * Discs that ended in the gutter. They score nothing, so they never reach
   * `onApply` — but without somewhere to put them the disc tally can't reach
   * 12 and "all discs accounted for" is unreachable by hand.
   */
  const [gutterA, setGutterA] = useState(0);
  const [gutterB, setGutterB] = useState(0);
  /** Which round the draft above was seeded from — see the re-seed below. */
  const [loadedRound, setLoadedRound] = useState(roundIndex);
  /**
   * What the draft looked like when it was last seeded or applied.
   *
   * Compared against, rather than against the `a`/`b` props, because applying a
   * live round doesn't change those immediately — the parent recomputes them
   * from the board. Without a local baseline, Apply would stay enabled forever
   * after the first save.
   */
  const [baseline, setBaseline] = useState<{ a: RingCounts; b: RingCounts }>({
    a: { ...a },
    b: { ...b },
  });

  // `useState` reads its initial value ONCE, so a new `a`/`b` arriving because
  // the user paged to another round would be ignored and the draft would still
  // hold the old round's counts — Apply would then write round 3's numbers into
  // round 1, silently. Re-seeding during render (rather than in an effect) is
  // the supported way to reset state on a prop change: React re-runs the
  // component before painting, so paging never flashes the previous round's
  // numbers. The totals fields reset too, or a total typed on one round would
  // be applied to another in place of its section counts.
  if (loadedRound !== roundIndex) {
    setLoadedRound(roundIndex);
    setDraftA({ ...a });
    setDraftB({ ...b });
    setTotalA("");
    setTotalB("");
    setGutterA(0);
    setGutterB(0);
    setBaseline({ a: { ...a }, b: { ...b } });
  }

  /** The live round sits one past the committed ones; everything below is history. */
  const isLive = roundIndex === roundCount;
  const budget = discsPerTeam(config);
  const usingTotals = totalA !== "" || totalB !== "";

  const same = (left: RingCounts, right: RingCounts): boolean =>
    left.twenties === right.twenties &&
    left.fifteens === right.fifteens &&
    left.tens === right.tens &&
    left.fives === right.fives;

  /** Nothing to apply until something actually differs. */
  const dirty = usingTotals || !same(draftA, baseline.a) || !same(draftB, baseline.b);

  const column = (
    label: string,
    counts: RingCounts,
    set: (next: RingCounts) => void,
    gutter: number,
    setGutter: (next: number) => void,
  ): ReactNode => (
    <div className="manual__col">
      <div className="manual__head">{label}</div>
      {RINGS.map((ring) => (
        <div className="manual__row" key={ring.key}>
          <span className="manual__ring">{ring.label}</span>
          <button
            type="button"
            className="manual__step"
            aria-label={`One fewer ${ring.label} for ${label}`}
            onClick={() => set({ ...counts, [ring.key]: Math.max(0, counts[ring.key] - 1) })}
          >
            −
          </button>
          <input
            className="manual__field num"
            inputMode="numeric"
            value={counts[ring.key]}
            aria-label={`${ring.label}s for ${label}`}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value || "0", 10);
              set({ ...counts, [ring.key]: Number.isFinite(value) ? Math.max(0, value) : 0 });
            }}
          />
          <button
            type="button"
            className="manual__step"
            aria-label={`One more ${ring.label} for ${label}`}
            onClick={() => set({ ...counts, [ring.key]: counts[ring.key] + 1 })}
          >
            +
          </button>
        </div>
      ))}
      <div className="manual__row">
        <span className="manual__ring">0</span>
        <button
          type="button"
          className="manual__step"
          aria-label={`One fewer gutter disc for ${label}`}
          onClick={() => setGutter(Math.max(0, gutter - 1))}
        >
          −
        </button>
        <input
          className="manual__field num"
          inputMode="numeric"
          value={gutter}
          aria-label={`Gutter discs for ${label}`}
          onChange={(event) => {
            const value = Number.parseInt(event.target.value || "0", 10);
            setGutter(Number.isFinite(value) ? Math.max(0, value) : 0);
          }}
        />
        <button
          type="button"
          className="manual__step"
          aria-label={`One more gutter disc for ${label}`}
          onClick={() => setGutter(gutter + 1)}
        >
          +
        </button>
      </div>
      <div className="manual__total num">{roundPoints(counts, config)}</div>
      <div className="faint" style={{ textAlign: "center", fontSize: "0.7rem" }}>
        {counts.twenties + counts.fifteens + counts.tens + counts.fives + gutter}/{budget}
      </div>
    </div>
  );

  return (
    <div className="manual">
      {/* Which round you're editing has to be unmissable: the columns look
          identical whichever round is loaded, and the cost of not noticing is
          overwriting a committed score. */}
      <div className="spread" style={{ marginBottom: "0.5rem" }}>
        <button
          type="button"
          className="btn btn--ghost"
          aria-label="Previous round"
          disabled={roundIndex === 0}
          onClick={() => onNavigate(roundIndex - 1)}
        >
          ←
        </button>

        {/* Announced, because paging changes the numbers below without moving focus. */}
        <div style={{ textAlign: "center" }} aria-live="polite">
          <div className="manual__head" style={{ fontSize: "1rem", marginBottom: "0.1rem" }}>
            Round {roundIndex + 1}
          </div>
          {isLive ? (
            <span className="faint">in play</span>
          ) : (
            <span
              className="faint"
              style={{
                border: "1px solid currentColor",
                borderRadius: "0.4rem",
                padding: "0 0.35rem",
              }}
            >
              committed
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn btn--ghost"
          aria-label="Next round"
          disabled={isLive}
          onClick={() => onNavigate(roundIndex + 1)}
        >
          →
        </button>
      </div>

      <div className="manual__cols">
        {column("Black", draftA, setDraftA, gutterA, setGutterA)}
        {column("White", draftB, setDraftB, gutterB, setGutterB)}
      </div>

      <p className="faint" style={{ margin: "0.5rem 0 0.25rem" }}>
        {budget} discs a side. Or skip the detail and log totals only:
      </p>
      <div className="manual__totals">
        <input
          className="manual__field num"
          inputMode="numeric"
          placeholder="Black"
          value={totalA}
          aria-label="Black total"
          onChange={(event) => setTotalA(event.target.value)}
        />
        <input
          className="manual__field num"
          inputMode="numeric"
          placeholder="White"
          value={totalB}
          aria-label="White total"
          onChange={(event) => setTotalB(event.target.value)}
        />
      </div>

      <div className="row" style={{ marginTop: "0.75rem", justifyContent: "space-between" }}>

        {/* The only way out. Unapplied edits are lost, which is why it says
            Discard rather than Close. */}
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          {dirty ? "Discard" : "Close"}
        </button>
        <button
          type="button"
          className="btn btn--accent"
          onClick={() => {
            // Same payload either way — which round it lands on is the parent's
            // business, and it already knows from the index it navigated to.
            if (usingTotals) {
              onApply({
                totals: {
                  a: Number.parseInt(totalA || "0", 10) || 0,
                  b: Number.parseInt(totalB || "0", 10) || 0,
                },
              });
            } else {
              onApply({ a: draftA, b: draftB });
            }
            // Deliberately does NOT close: correcting several rounds in one
            // sitting is the whole point of the back/forward controls, and
            // closing after each save fought that.
            setBaseline({ a: { ...draftA }, b: { ...draftB } });
            setTotalA("");
            setTotalB("");
          }}
          disabled={!dirty}
        >
          {isLive ? "Apply" : `Save round ${roundIndex + 1}`}
        </button>
      </div>
    </div>
  );
}
