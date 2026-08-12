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
import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from "react";

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

/** One pile per player, in the corners. Top pair is team A, bottom pair team B. */
const SEATS: { x: number; y: number; team: "A" | "B" }[] = [
  { x: 17, y: 17, team: "A" },
  { x: 183, y: 17, team: "A" },
  { x: 17, y: 183, team: "B" },
  { x: 183, y: 183, team: "B" },
];

export interface BoardScorerProps {
  discs: PlacedDisc[];
  onChange: (discs: PlacedDisc[]) => void;
  /** Discs each side puts on the board — 12 doubles, 8 singles. */
  perTeam: number;
  colorA: DiscColor;
  colorB: DiscColor;
  singles: boolean;
}

export function BoardScorer({
  discs,
  onChange,
  perTeam,
  colorA,
  colorB,
  singles,
}: BoardScorerProps): ReactNode {
  const [active, setActive] = useState<DiscColor>(colorA);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Region | null>(null);
  const [flash, setFlash] = useState<{ id: number; text: string; x: number; y: number } | null>(
    null,
  );

  const svgRef = useRef<SVGSVGElement | null>(null);
  const holdTimer = useRef<number | null>(null);
  const pending = useRef<{ source: Source; x: number; y: number; color: DiscColor } | null>(null);
  const flashId = useRef(0);

  const left = remaining(discs, perTeam);

  /** Pointer position in board space. */
  const pointAt = useCallback((event: PointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const scale = VIEW / rect.width;
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

  const showFlash = (points: number, x: number, y: number): void => {
    if (points <= 0) return;
    flashId.current += 1;
    const id = flashId.current;
    setFlash({ id, text: `+${points}`, x, y });
    window.setTimeout(() => {
      setFlash((current) => (current?.id === id ? null : current));
    }, 700);
  };

  const pointsFor = (region: Region): number =>
    region === "twenty" ? 20 : region === "fifteen" ? 15 : region === "ten" ? 10 : region === "five" ? 5 : 0;

  const handleDown = (event: PointerEvent, source: Source, color: DiscColor): void => {
    const point = pointAt(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pending.current = { source, x: point.x, y: point.y, color };

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
      if (left[active] <= 0) return;
      const placed = placeAt(point.x, point.y, active, nextId());
      if (!placed) return;
      onChange([...discs, placed]);
      const view = toView(placed.x, placed.y);
      showFlash(pointsFor(placed.region), view.x, view.y);
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
        showFlash(pointsFor(region), view.x, view.y);
      }
      return;
    }

    if (left[drag.color] <= 0) return;
    onChange([
      ...discs,
      { id: nextId(), color: drag.color, x: snapped.x, y: snapped.y, region },
    ]);
    const view = toView(snapped.x, snapped.y);
    showFlash(pointsFor(region), view.x, view.y);
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
        <BoardArt hover={hover} />

        {/* Stashes — one per team, inboard of their score. */}
        <Stash x={62} color={colorA} count={twentiesOf(colorA)} onDown={handleDown} />
        <Stash x={138} color={colorB} count={twentiesOf(colorB)} onDown={handleDown} />

        {/* Piles in front of each seat. Six per seat. */}
        {(singles ? [SEATS[0]!, SEATS[3]!] : SEATS).map(
          (seat, index) => {
            const color = seat.team === "A" ? colorA : colorB;
            const view = toView(seat.x, seat.y);
            return (
              <Pile
                key={index}
                seat={index}
                x={view.x}
                y={view.y}
                color={color}
                count={Math.ceil(left[color] / (singles ? 1 : 2))}
                dim={color !== active}
                onDown={handleDown}
              />
            );
          },
        )}

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
              r={isDragging ? DISC_RADIUS * 1.35 : isActive ? DISC_RADIUS : DISC_RADIUS * 0.82}
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
          <text key={flash.id} x={flash.x} y={flash.y} className="scorer__flash">
            {flash.text}
          </text>
        ) : null}
      </svg>

      <div className="scorer__toggle" role="group" aria-label="Disc colour">
        {([colorA, colorB] as DiscColor[]).map((color) => (
          <button
            key={color}
            type="button"
            className={`swatch swatch--${color}`}
            aria-pressed={active === color}
            aria-label={`${color} discs`}
            onClick={() => setActive(color)}
          />
        ))}
      </div>
    </div>
  );
}

function BoardArt({ hover }: { hover: Region | null }): ReactNode {
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
      {ring("twenty", RADII.twenty, "var(--twenty)")}
    </g>
  );
}

function Pile({
  seat,
  x,
  y,
  color,
  count,
  dim,
  onDown,
}: {
  seat: number;
  x: number;
  y: number;
  color: DiscColor;
  count: number;
  dim: boolean;
  onDown: (event: PointerEvent, source: Source, color: DiscColor) => void;
}): ReactNode {
  return (
    <g
      className="scorer__pile"
      opacity={dim ? 0.5 : 1}
      onPointerDown={(event) => onDown(event, { kind: "pile", seat, color }, color)}
    >
      {/* A fixed stack image — it doesn't resize as discs leave, only the count changes. */}
      {[3, 1.5, 0].map((offset) => (
        <circle
          key={offset}
          cx={x}
          cy={y - offset}
          r={DISC_RADIUS}
          className={`scorer__disc scorer__disc--${color}`}
        />
      ))}
      <text x={x} y={y + 13} className="scorer__count">
        {count}
      </text>
    </g>
  );
}

function Stash({
  x,
  color,
  count,
  onDown,
}: {
  x: number;
  color: DiscColor;
  count: number;
  onDown: (event: PointerEvent, source: Source, color: DiscColor) => void;
}): ReactNode {
  return (
    <g
      className="scorer__stash"
      onPointerDown={(event) => onDown(event, { kind: "stash", color }, color)}
    >
      <circle cx={x} cy={20} r={DISC_RADIUS + 1} className={`scorer__disc scorer__disc--${color}`} />
      <text x={x + 13} y={24} className="scorer__stashcount">
        ×{count}
      </text>
    </g>
  );
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `d${idCounter}`;
}
