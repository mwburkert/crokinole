import {
  BOARD_CENTRE,
  DISC_RADIUS,
  RADII,
  placeAt,
  regionAt,
  remaining,
  snapIntoRegion,
  type DiscColor,
  type PlacedDisc,
  type Region,
} from "@crokinole/core";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

/**
 * The board scorer (§3.5).
 *
 * Discs go where they actually came to rest; ring counts are derived from those
 * positions by `countsFromDiscs`, never tapped in.
 *
 * ⚠️ **Every drag waits for a hold.** A pointer-down does nothing for
 * `HOLD_MS`; only then does the disc grow, fade, and start following your
 * finger. Without that buffer a thumb resting on the board while scrolling
 * flings discs across it, which is the difference between a scorer you trust
 * and one you fight.
 */

/** How long a press must last before it becomes a drag. */
const HOLD_MS = 170;
/** How long a disc must hover the centre before the hole is fully open. */
const HOLE_OPEN_MS = 650;
/** How far the hole opens, as a multiple of its resting radius. */
const HOLE_MAX_SCALE = 2.6;
/** Movement before the hold completes is treated as a scroll, not a drag. */
const SLOP = 10;

/*
 * Everything lives inside one 200-wide box so the board never needs vertical
 * room it can't have on a phone. The piles sit in the box's corners rather than
 * directly in front of each seat — a circle in a square leaves the corners free,
 * whereas above and below the board there is nothing to spare.
 */
const VIEW = 242;
const BOARD_TOP = 42;

/** Board space (0–200, centred 100,100) -> SVG space. */
const toView = (x: number, y: number): { x: number; y: number } => ({
  x,
  y: y + BOARD_TOP,
});

type Source =
  | { kind: "board" }
  | { kind: "pile"; seat: number; color: DiscColor }
  | { kind: "stash"; color: DiscColor }
  | { kind: "disc"; id: string };

interface Drag {
  source: Source;
  color: DiscColor;
  /** Live position in board space. */
  x: number;
  y: number;
  /** Existing disc being moved, if any. */
  movingId?: string;
}

/**
 * Two piles, one per colour, in the lower corners.
 *
 * They are also the colour selector: **tap to select, hold-and-drag to take a
 * disc.** That collapses two controls into one — the pile you reach for is the
 * colour you meant, so there was never a reason to state it separately first.
 */
const PILES: { x: number; y: number; team: "A" | "B" }[] = [
  { x: 17, y: 183, team: "A" },
  { x: 183, y: 183, team: "B" },
];

export interface BoardScorerProps {
  discs: PlacedDisc[];
  onChange: (discs: PlacedDisc[]) => void;
  /** Discs each side puts on the board — 12 doubles, 8 singles. */
  perTeam: number;
  colorA: DiscColor;
  colorB: DiscColor;
}

export function BoardScorer({
  discs,
  onChange,
  perTeam,
  colorA,
  colorB,
}: BoardScorerProps): ReactNode {
  const [active, setActive] = useState<DiscColor>(colorA);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Region | null>(null);
  const [flash, setFlash] = useState<{
    id: number;
    text: string;
    x: number;
    y: number;
    kind: "points" | "gutter" | "twenty";
  } | null>(null);

  /**
   * How far the centre hole has opened up, 0–1.
   *
   * Holding a disc over the twenty grows the hole toward it and then pulses.
   * Sinking one is the highest-value thing you can do and the smallest target
   * on the board, so it's deliberately a *held* gesture — a disc brushing past
   * the centre never becomes a twenty by accident.
   */
  const [holeGrow, setHoleGrow] = useState(0);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const holdTimer = useRef<number | null>(null);
  const pending = useRef<{ source: Source; x: number; y: number; color: DiscColor } | null>(null);
  const flashId = useRef(0);

  const left = remaining(discs, perTeam);
  const overHole = drag !== null && hover === "twenty";

  useEffect(() => {
    if (!overHole) {
      setHoleGrow(0);
      return;
    }
    const started = performance.now();
    let raf = 0;
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - started) / HOLE_OPEN_MS);
      setHoleGrow(progress);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [overHole]);

  /** Pointer position in board space. */
  const pointAt = useCallback((event: PointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    // The viewBox is 200 units WIDE (VIEW is its height). Scaling by the height
    // put every pointer position 21% off — far enough that a grabbed disc
    // appeared to lag the finger and a press on a disc often missed it entirely.
    const scale = 200 / rect.width;
    return {
      x: (event.clientX - rect.left) * scale,
      y: (event.clientY - rect.top) * scale - BOARD_TOP,
    };
  }, []);

  const cancelHold = (): void => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  /** A twenty is the moment of the round, so it gets the loudest treatment. */
  const showFlash = (region: Region, x: number, y: number): void => {
    const points = pointsFor(region);
    flashId.current += 1;
    const id = flashId.current;

    const kind = region === "twenty" ? "twenty" : region === "ditch" ? "gutter" : "points";
    const text = region === "ditch" ? "Gutter!" : `+${points}`;
    // Centre the twenty on the board rather than on the disc — it's an event,
    // not an annotation.
    const at = region === "twenty" ? { x: BOARD_CENTRE, y: BOARD_CENTRE + BOARD_TOP } : { x, y };

    setFlash({ id, text, kind, ...at });
    window.setTimeout(
      () => setFlash((current) => (current?.id === id ? null : current)),
      region === "twenty" ? 1600 : 750,
    );
  };

  const pointsFor = (region: Region): number =>
    region === "twenty" ? 20 : region === "fifteen" ? 15 : region === "ten" ? 10 : region === "five" ? 5 : 0;

  const handleDown = (event: PointerEvent, source: Source, color: DiscColor): void => {
    const point = pointAt(event);
    if (!point) return;
    // setPointerCapture throws NotFoundError for a pointer id the browser
    // doesn't recognise. Uncaught, that aborted handleDown before the hold
    // timer was ever armed — so a press on a placed disc did nothing at all.
    // Capture is an optimisation here, not a requirement: events still bubble
    // to the <svg>, which is where move and up are handled.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Not capturable — carry on uncaptured.
    }
    pending.current = { source, x: point.x, y: point.y, color };

    // Touching a pile or stash selects that colour immediately — the same
    // gesture that starts a drag also sets the toggle, so there is never a
    // tap-then-hold.
    if (source.kind === "pile" || source.kind === "stash") setActive(color);

    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      const held = pending.current;
      if (!held) return;
      // Grabbing from a pile or stash adopts that colour — the toggle follows
      // what you actually picked up rather than making you set it first.
      setActive(held.color);
      setDrag({
        source: held.source,
        color: held.color,
        x: held.x,
        y: held.y,
        ...(held.source.kind === "disc" ? { movingId: held.source.id } : {}),
      });
      holdTimer.current = null;
    }, HOLD_MS);
  };

  const handleMove = (event: PointerEvent): void => {
    const point = pointAt(event);
    if (!point) return;

    if (!drag) {
      // Moving before the hold completes means you meant to scroll.
      const start = pending.current;
      if (start && Math.hypot(point.x - start.x, point.y - start.y) > SLOP) {
        cancelHold();
        pending.current = null;
      }
      return;
    }

    setDrag({ ...drag, x: point.x, y: point.y });
    setHover(regionAt(point.x, point.y));
  };

  const handleUp = (event: PointerEvent): void => {
    const point = pointAt(event);
    cancelHold();

    if (!drag) {
      // A tap that never became a drag places a disc of the active colour.
      const start = pending.current;
      pending.current = null;
      if (!start || !point) return;
      // A short press on an existing disc is a no-op — you have to hold to move
      // it, which is what stops a stray tap dragging a disc you meant to keep.
      if (start.source.kind === "disc") return;
      // Tapping a pile or stash just selects that colour; only a hold takes a
      // disc from it.
      if (start.source.kind === "pile" || start.source.kind === "stash") {
        setActive(start.color);
        return;
      }
      if (left[active] <= 0) return;
      const placed = placeAt(point.x, point.y, active, nextId());
      if (!placed) return;
      onChange([...discs, placed]);
      const view = toView(placed.x, placed.y);
      showFlash(placed.region, view.x, view.y);
      return;
    }

    pending.current = null;
    const dropped = point ?? { x: drag.x, y: drag.y };
    const region = regionAt(dropped.x, dropped.y);
    setDrag(null);
    setHover(null);

    // Dropped off the board — send it home to the pile.
    if (!region) {
      if (drag.movingId) onChange(discs.filter((disc) => disc.id !== drag.movingId));
      return;
    }

    const snapped = snapIntoRegion(dropped.x, dropped.y, region);

    if (drag.movingId) {
      const before = discs.find((disc) => disc.id === drag.movingId);
      onChange(
        discs.map((disc) =>
          disc.id === drag.movingId ? { ...disc, ...snapped, region } : disc,
        ),
      );
      // Only flash when it actually changed what it's worth.
      if (before && before.region !== region) {
        const view = toView(snapped.x, snapped.y);
        showFlash(region, view.x, view.y);
      }
      return;
    }

    if (left[drag.color] <= 0) return;
    onChange([
      ...discs,
      { id: nextId(), color: drag.color, x: snapped.x, y: snapped.y, region },
    ]);
    const view = toView(snapped.x, snapped.y);
    showFlash(region, view.x, view.y);
  };

  const twentiesOf = (color: DiscColor): number =>
    discs.filter((disc) => disc.color === color && disc.region === "twenty").length;

  return (
    <div className="scorer">
      <svg
        ref={svgRef}
        viewBox={`0 0 200 ${VIEW}`}
        className="scorer__svg"
        onPointerDown={(event) => {
          // Children run first and claim the press; anything left is a tap on
          // bare board, which places a disc of the active colour.
          if (pending.current) return;
          handleDown(event, { kind: "board" }, active);
        }}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      >
        <BoardArt hover={hover} holeGrow={holeGrow} />

        {/* Twenties, laid out in a row directly under each score card so the
            two sides read at a glance without anyone counting a number. */}
        <Stash x={7} color={colorA} count={twentiesOf(colorA)} onDown={handleDown} />
        <Stash x={193} color={colorB} count={twentiesOf(colorB)} onDown={handleDown} rightAligned />

        {/* One pile per colour: tap selects, hold-and-drag takes a disc. */}
        {PILES.map((pile, index) => {
          const color = pile.team === "A" ? colorA : colorB;
          const view = toView(pile.x, pile.y);
          return (
            <Pile
              key={index}
              seat={index}
              x={view.x}
              y={view.y}
              color={color}
              count={left[color]}
              total={perTeam}
              selected={color === active}
              onDown={handleDown}
            />
          );
        })}

        {/* Placed discs. The inactive colour shrinks back and stops taking input. */}
        {discs.map((disc) => {
          const view = toView(disc.x, disc.y);
          const isActive = disc.color === active;
          const isDragging = drag?.movingId === disc.id;
          return (
            <circle
              key={disc.id}
              cx={view.x}
              cy={view.y}
              r={isDragging ? DISC_RADIUS * 1.5 : isActive ? DISC_RADIUS * 1.15 : DISC_RADIUS * 0.75}
              className={`scorer__disc scorer__disc--${disc.color}${isDragging ? " is-dragging" : ""}`}
              opacity={isDragging ? 0.55 : isActive ? 1 : 0.5}
              style={{ pointerEvents: isActive ? "auto" : "none" }}
              onPointerDown={(event) =>
                handleDown(event, { kind: "disc", id: disc.id }, disc.color)
              }
            />
          );
        })}

        {/* The disc under your finger. */}
        {drag ? (
          <circle
            cx={toView(drag.x, drag.y).x}
            cy={toView(drag.x, drag.y).y}
            r={DISC_RADIUS * 1.4}
            className={`scorer__disc scorer__disc--${drag.color} is-ghost`}
            opacity={0.65}
          />
        ) : null}

        {flash ? (
          <text
            key={flash.id}
            x={flash.x}
            y={flash.y}
            className={`scorer__flash scorer__flash--${flash.kind}`}
          >
            {flash.text}
          </text>
        ) : null}
      </svg>

    </div>
  );
}

function BoardArt({
  hover,
  holeGrow,
}: {
  hover: Region | null;
  holeGrow: number;
}): ReactNode {
  const ring = (region: Region, r: number, fill: string): ReactNode => (
    <circle
      cx={BOARD_CENTRE}
      cy={BOARD_CENTRE + BOARD_TOP}
      r={r}
      fill={fill}
      className={hover === region ? "scorer__ring is-hover" : "scorer__ring"}
      stroke="var(--walnut-soft)"
      strokeWidth="1.2"
    />
  );

  return (
    <g style={{ pointerEvents: "none" }}>
      {ring("ditch", RADII.ditch, "var(--felt-deep)")}
      {ring("five", RADII.five, "var(--maple)")}
      {ring("ten", RADII.ten, "var(--maple-deep)")}
      {ring("fifteen", RADII.fifteen, "var(--maple)")}
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (index * Math.PI) / 4 + Math.PI / 8;
        return (
          <circle
            key={index}
            cx={BOARD_CENTRE + Math.cos(angle) * RADII.fifteen}
            cy={BOARD_CENTRE + BOARD_TOP + Math.sin(angle) * RADII.fifteen}
            r="2.2"
            fill="var(--walnut)"
          />
        );
      })}
      <circle
        cx={BOARD_CENTRE}
        cy={BOARD_CENTRE + BOARD_TOP}
        r={RADII.twenty * (1 + holeGrow * (HOLE_MAX_SCALE - 1))}
        fill="var(--twenty)"
        stroke="var(--walnut-soft)"
        strokeWidth="1.2"
        className={`scorer__hole${holeGrow >= 1 ? " is-open" : ""}`}
      />
    </g>
  );
}

function Pile({
  seat,
  x,
  y,
  color,
  count,
  total,
  selected,
  onDown,
}: {
  seat: number;
  x: number;
  y: number;
  color: DiscColor;
  count: number;
  total: number;
  selected: boolean;
  onDown: (event: PointerEvent, source: Source, color: DiscColor) => void;
}): ReactNode {
  return (
    <g
      className={`scorer__pile${selected ? " is-selected" : ""}`}
      opacity={selected ? 1 : 0.55}
      onPointerDown={(event) => onDown(event, { kind: "pile", seat, color }, color)}
      role="button"
      aria-pressed={selected}
      aria-label={`${color} discs, ${count} of ${total} left`}
    >
      {/* Selection ring — the pile doubles as the colour toggle. */}
      <circle cx={x} cy={y - 1.5} r={DISC_RADIUS + 4} className="scorer__pilering" />
      {/* A fixed stack image: it never resizes as discs leave, only the count changes. */}
      {[3, 1.5, 0].map((offset) => (
        <circle
          key={offset}
          cx={x}
          cy={y - offset}
          r={DISC_RADIUS}
          className={`scorer__disc scorer__disc--${color}`}
        />
      ))}
      <text x={x} y={y + 15} className="scorer__count">
        {count}/{total}
      </text>
    </g>
  );
}

/** Sunk twenties, drawn as a row of discs rather than a tally. */
function Stash({
  x,
  color,
  count,
  onDown,
  rightAligned = false,
}: {
  x: number;
  color: DiscColor;
  count: number;
  onDown: (event: PointerEvent, source: Source, color: DiscColor) => void;
  rightAligned?: boolean;
}): ReactNode {
  const step = DISC_RADIUS * 1.7;
  return (
    <g
      className="scorer__stash"
      onPointerDown={(event) => onDown(event, { kind: "stash", color }, color)}
      aria-label={`${count} twenties`}
    >
      {Array.from({ length: count }, (_, index) => (
        <circle
          key={index}
          cx={rightAligned ? x - index * step : x + index * step}
          cy={20}
          r={DISC_RADIUS * 0.85}
          className={`scorer__disc scorer__disc--${color}`}
        />
      ))}
    </g>
  );
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `d${idCounter}`;
}
