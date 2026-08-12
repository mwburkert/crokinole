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

/**
 * Manual scoring, behind the three-dot menu above the scoreboard (§3.5).
 *
 * Two ways in: per-section counts, or a straight total for logging a round
 * without detail. Section counts entered here **populate the board** when the
 * menu closes — the two views are the same data, not two records.
 */
export function ManualEntry({
  config,
  a,
  b,
  onApply,
  onClose,
}: {
  config: ScoringConfig;
  a: RingCounts;
  b: RingCounts;
  /** `totals` set means score-only: no section detail, so no board placement. */
  onApply: (next: { a: RingCounts; b: RingCounts } | { totals: { a: number; b: number } }) => void;
  onClose: () => void;
}): ReactNode {
  const [draftA, setDraftA] = useState<RingCounts>({ ...a });
  const [draftB, setDraftB] = useState<RingCounts>({ ...b });
  const [totalA, setTotalA] = useState("");
  const [totalB, setTotalB] = useState("");

  const budget = discsPerTeam(config);
  const usingTotals = totalA !== "" || totalB !== "";

  const column = (
    label: string,
    counts: RingCounts,
    set: (next: RingCounts) => void,
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
      <div className="manual__total num">{roundPoints(counts, config)}</div>
    </div>
  );

  return (
    <div className="manual">
      <div className="manual__cols">
        {column("Black", draftA, setDraftA)}
        {column("White", draftB, setDraftB)}
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

      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className="btn btn--accent"
          onClick={() => {
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
            onClose();
          }}
        >
          Apply
        </button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
