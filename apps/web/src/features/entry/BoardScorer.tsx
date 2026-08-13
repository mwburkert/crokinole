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
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import "../../ui/flash.css";

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
const HOLD_MS = 130;
/**
 * How far above the fingertip the dragged disc rides, in board units.
 *
 * The "offset cursor" pattern. On a phone your finger completely covers a disc
 * this size, so you're dragging something you can't see and guessing at the
 * drop. Lifting it clear is the single biggest improvement to touch drag —
 * and the hit-test uses the LIFTED position, not the finger, so what you see
 * is exactly what lands.
 *
 * Halved from the first pass: enough to clear a fingertip, close enough that
 * the disc still feels attached to the hand moving it rather than towed.
 */
const LIFT = 17;
/** How long a disc must hover the centre before the hole is fully open. */
const HOLE_OPEN_MS = 650;
/** How far the hole opens, as a multiple of its resting radius. */
const HOLE_MAX_SCALE = 2.6;
/** Movement before the hold completes is treated as a scroll, not a drag. */
const SLOP = 10;

/*
 * The +20 overlay, in three phases: bounce off the edges like a DVD
 * screensaver, ease to rest in the middle of the SCREEN, then fade there.
 * Long enough to be a moment, short enough that nobody is waiting on it.
 */
const TWENTY_BOUNCE_MS = 1500;
const TWENTY_SETTLE_MS = 800;
const TWENTY_REST_MS = 500;
const TWENTY_FLASH_MS = TWENTY_BOUNCE_MS + TWENTY_SETTLE_MS + TWENTY_REST_MS;
/** Screensaver speed, in CSS pixels per millisecond. */
const TWENTY_SPEED = 0.42;

/*
 * Everything lives inside one box that the board exactly fills, so the board
 * never needs vertical room it can't have on a phone. The piles sit in the
 * box's bottom corners rather than directly in front of each seat — a circle in
 * a square leaves the corners free, whereas above and below the board there is
 * nothing to spare.
 *
 * ⚠️ **The board is no longer 200 units across.** Widening the gutter pushed
 * `RADII.ditch` out to 114, so the rim overhangs core's 0–200 board space by 14
 * on each side. The view box is padded by exactly that much, `toView` carries
 * the offset and `pointAt` undoes it. Every literal 100 or 200 that used to
 * appear here was a board centre or a board width; they are `CENTRE_X`,
 * `CENTRE_Y` and `VIEW_W` now, and derived, so widening the gutter again moves
 * the whole drawing rather than tearing a hole in it.
 *
 * The box is deliberately no taller for its width than it was (274 ÷ 228 = 1.20
 * against the old 246 ÷ 200 = 1.23), which matters: `.scorer__svg` is capped at
 * 21.5rem so the whole round-entry screen clears a 393×852 phone without
 * scrolling, and at that cap this draws ~413px tall — ten short of what it drew
 * before, and 250px in the 13rem box a `readOnly` replay sits in. The board is
 * the same size on screen as it always was; it is the playing surface inside it
 * that gives up the room the gutter gained.
 */

/** Board radius in board units: the outer lip of the ditch. */
const BOARD_R = RADII.ditch;
/** How far the rim overhangs core's 0–200 box, each side. */
const PAD_X = BOARD_R - BOARD_CENTRE;
/** View box width — the board, edge to edge. */
const VIEW_W = BOARD_R * 2;
/** Baseline of the two twenty-stashes, in the strip above the board. */
const STASH_Y = 14;
/** Inset of the first disc in each stash from its side of the box. */
const STASH_X = 9;
/**
 * Where board space begins, vertically.
 *
 * Sized so the rim clears the stash row by about a disc. It was 32 back when
 * the rim sat at radius 100; the extra 14 is the gutter the rim gained, or the
 * stashes would be sitting on the board.
 */
const BOARD_TOP = 46;
/** Room under the board for the piles and their counts. */
const BOARD_FOOT = 14;
const VIEW_H = BOARD_TOP + BOARD_CENTRE + BOARD_R + BOARD_FOOT;
/** The centre of the board, in view space. */
const CENTRE_X = BOARD_CENTRE + PAD_X;
const CENTRE_Y = BOARD_CENTRE + BOARD_TOP;

/** Board space (centred 100,100) -> SVG space. */
const toView = (x: number, y: number): { x: number; y: number } => ({
  x: x + PAD_X,
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
 *
 * These are in VIEW space, not board space. They are furniture around the
 * board rather than anything on it, and with the rim now reaching both sides of
 * the box the only room left is the corners the circle can't fill. Placed far
 * enough out that even a pile's oversized press target (`DISC_RADIUS + 13`)
 * stays clear of the rim — it used to clear it by 9 units and, left where it
 * was, the wider board would have swallowed 5 of them.
 */
const PILE_INSET = 20;
const PILE_Y = VIEW_H - 20;
const PILES: { x: number; y: number; team: "A" | "B" }[] = [
  { x: PILE_INSET, y: PILE_Y, team: "A" },
  { x: VIEW_W - PILE_INSET, y: PILE_Y, team: "B" },
];

export interface BoardScorerProps {
  discs: PlacedDisc[];
  onChange: (discs: PlacedDisc[]) => void;
  /** Discs each side puts on the board — 12 doubles, 8 singles. */
  perTeam: number;
  colorA: DiscColor;
  colorB: DiscColor;
  /**
   * Replay a board rather than place one.
   *
   * Positions are stored, and storing them was a deliberate exception to
   * "nothing derived is stored" (§3.5) — bought specifically so a round can be
   * looked at again. This is that view: no piles (there is nothing left to
   * place), no active colour (both sides are equally finished), and every
   * pointer ignored. It is the same renderer as the live board on purpose; a
   * second one would be a second board to keep in step.
   */
  readOnly?: boolean;
}

export function BoardScorer({
  discs,
  onChange,
  perTeam,
  colorA,
  colorB,
  readOnly = false,
}: BoardScorerProps): ReactNode {
  const [active, setActive] = useState<DiscColor>(colorA);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Region | null>(null);
  /** A disc in flight from the hole to its team's stash. */
  const [sinking, setSinking] = useState<{ id: number; color: DiscColor; to: number } | null>(
    null,
  );

  /**
   * The small flashes — `+5 / +10 / +15` and `Gutter!` — drawn as SVG text at
   * the disc that earned them. A twenty is deliberately NOT one of these: it
   * gets the whole screen (see `TwentyFlash`), which an SVG text node trapped in
   * this view box could never have.
   */
  const [flash, setFlash] = useState<{
    id: number;
    text: string;
    x: number;
    y: number;
    kind: "points" | "gutter";
  } | null>(null);
  /** The live +20 overlay, keyed so a second twenty restarts the animation. */
  const [twenty, setTwenty] = useState<number | null>(null);

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
  const pending = useRef<{
    source: Source;
    x: number;
    y: number;
    color: DiscColor;
    at: number;
  } | null>(null);
  const flashId = useRef(0);

  const left = remaining(discs, perTeam);

  /** The disc under a board-space point, if any. Twenties aren't on the board. */
  const discAt = (x: number, y: number): PlacedDisc | undefined =>
    discs
      .filter((disc) => disc.region !== "twenty")
      .find((disc) => Math.hypot(disc.x - x, disc.y - y) <= DISC_RADIUS * 1.3);
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
    // Scale by the WIDTH against the view box's width. Using its height put
    // every pointer position 21% off — far enough that a grabbed disc appeared
    // to lag the finger and a press on a disc often missed it entirely.
    const scale = VIEW_W / rect.width;
    // …then undo what `toView` added, so this lands back in board space.
    return {
      x: (event.clientX - rect.left) * scale - PAD_X,
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
  /** A short haptic bump. Confirms a grab you can feel without looking. */
  const buzz = (ms: number): void => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      // Unsupported or blocked — purely additive feedback.
    }
  };

  const showFlash = (region: Region, x: number, y: number): void => {
    flashId.current += 1;
    const id = flashId.current;

    // A twenty leaves the board entirely. It is the event of the round, so it
    // is thrown across the whole viewport rather than annotated onto a disc —
    // and "the middle of the page" is not somewhere an SVG child of this view
    // box can reach.
    if (region === "twenty") {
      setTwenty(id);
      window.setTimeout(
        () => setTwenty((current) => (current === id ? null : current)),
        TWENTY_FLASH_MS,
      );
      return;
    }

    const kind = region === "ditch" ? "gutter" : "points";
    const text = region === "ditch" ? "Gutter!" : `+${pointsFor(region)}`;
    // Clamp inside the viewBox — a "Gutter!" against the left or right rim was
    // being cut in half by the edge of the SVG — and keep it below the stash
    // row, which owns the strip along the top.
    const at = {
      x: Math.min(Math.max(x, 26), VIEW_W - 26),
      y: Math.max(y, STASH_Y + 12),
    };

    setFlash({ id, text, kind, ...at });
    window.setTimeout(() => setFlash((current) => (current?.id === id ? null : current)), 1500);
  };

  /**
   * Fly a sunk disc from the hole up to its stash.
   *
   * Sinking one is the best thing that happens in a round, and until now it
   * simply vanished from the centre and silently incremented a row at the top.
   * Watching it travel is what connects the two.
   */
  const launchTwenty = (color: DiscColor): void => {
    flashId.current += 1;
    const id = flashId.current;
    // It lands on the near end of its own stash row, just outside the first slot.
    setSinking({ id, color, to: color === colorA ? STASH_X - 2 : VIEW_W - STASH_X + 2 });
    window.setTimeout(() => setSinking((c) => (c?.id === id ? null : c)), 900);
  };

  const pointsFor = (region: Region): number =>
    region === "twenty" ? 20 : region === "fifteen" ? 15 : region === "ten" ? 10 : region === "five" ? 5 : 0;

  const handleDown = (event: PointerEvent, source: Source, color: DiscColor): void => {
    // The single entry point for every press on this board — bare surface,
    // pile, stash or placed disc — so a replay is made inert here rather than
    // relying on the CSS that also switches it off.
    if (readOnly) return;
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
    pending.current = { source, x: point.x, y: point.y, color, at: performance.now() };

    // Touching a pile or stash selects that colour immediately — the same
    // gesture that starts a drag also sets the toggle, so there is never a
    // tap-then-hold.
    if (source.kind === "pile" || source.kind === "stash") setActive(color);

    // A stash holds discs that are already ON the board (sunk in the hole), not
    // spare ones. Dragging from it must MOVE one of those, the way dragging a
    // placed disc does — treating it like a pile created a brand new disc, and
    // once the pile was empty that silently did nothing while the sunk disc sat
    // there unmoved.
    let resolved = source;
    if (source.kind === "stash") {
      const sunk = [...discs]
        .reverse()
        .find((disc) => disc.color === color && disc.region === "twenty");
      if (!sunk) return; // nothing in the hole to take back out
      resolved = { kind: "disc", id: sunk.id };
      pending.current = { source: resolved, x: point.x, y: point.y, color, at: performance.now() };
    }

    cancelHold();

    // Bare board is TAP to place, never hold to drag. Holding on empty board
    // was starting a drag with nothing in hand and conjuring a disc on release
    // — most obviously over the hole, where a long press grew it open and then
    // dropped a twenty you never picked up. You place by tapping and move by
    // holding; holding nothing should do nothing.
    if (resolved.kind === "board") return;

    holdTimer.current = window.setTimeout(() => {
      const held = pending.current;
      if (!held) return;
      setDrag({
        source: held.source,
        color: held.color,
        x: held.x,
        y: held.y,
        ...(held.source.kind === "disc" ? { movingId: held.source.id } : {}),
      });
      buzz(14);
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
    const next = regionAt(point.x, point.y - LIFT);
    if (next !== hover) {
      setHover(next);
      // A second bump when you cross into a new region, so you can feel the
      // target change without watching for it.
      if (next) buzz(8);
    }
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
      // A TAP places; a long press does not. Stopping the hold from starting a
      // drag wasn't enough on its own — releasing still fell through to here and
      // placed a disc, so holding on the hole grew it open and then dropped a
      // twenty you never picked up.
      if (start.source.kind === "board" && performance.now() - start.at > HOLD_MS) return;
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
      if (placed.region === "twenty") launchTwenty(placed.color);
      return;
    }

    pending.current = null;
    // Drop where the DISC is, not where the finger is.
    const raw = point ?? { x: drag.x, y: drag.y };
    const dropped = { x: raw.x, y: raw.y - LIFT };
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
        if (region === "twenty") launchTwenty(before.color);
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
    if (region === "twenty") launchTwenty(drag.color);
  };

  /**
   * Twenties showing in a team's row.
   *
   * A disc in flight is deliberately not counted yet — otherwise it pops into
   * the row the instant it's sunk and then the animation delivers a disc that's
   * already there, so you briefly see it twice. It joins the row when it lands.
   */
  const twentiesOf = (color: DiscColor): number => {
    const total = discs.filter((disc) => disc.color === color && disc.region === "twenty").length;
    return Math.max(0, total - (sinking?.color === color ? 1 : 0));
  };

  return (
    <div className="scorer">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="scorer__svg"
        style={readOnly ? { pointerEvents: "none" } : undefined}
        onPointerDown={(event) => {
          // Children run first and claim the press; anything left is a tap on
          // bare board, which places a disc of the active colour.
          if (pending.current) return;
          // …unless it landed on a disc of the OTHER colour. Those are inert by
          // design, but inert must mean "nothing happens", not "fall through and
          // stack a disc of the active colour on top of it" — which read as the
          // piece changing colour under your finger.
          const point = pointAt(event);
          if (point && discAt(point.x, point.y)) return;
          handleDown(event, { kind: "board" }, active);
        }}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      >
        <BoardArt hover={hover} holeGrow={holeGrow} />
        {sinking ? (
          <circle
            key={`flare-${sinking.id}`}
            cx={CENTRE_X}
            cy={CENTRE_Y}
            r={BOARD_R}
            className="scorer__flare"
          />
        ) : null}
        <RegionHighlight region={hover} />

        {/* Twenties, laid out in a row directly under each score card so the
            two sides read at a glance without anyone counting a number. */}
        <Stash x={STASH_X} color={colorA} count={twentiesOf(colorA)} onDown={handleDown} />
        <Stash
          x={VIEW_W - STASH_X}
          color={colorB}
          count={twentiesOf(colorB)}
          onDown={handleDown}
          rightAligned
        />

        {/* One pile per colour: tap selects, hold-and-drag takes a disc. A
            replayed round has none left to take, so they simply aren't there.
            Already in view space — see PILES. */}
        {(readOnly ? [] : PILES).map((pile, index) => {
          const color = pile.team === "A" ? colorA : colorB;
          return (
            <Pile
              key={index}
              seat={index}
              x={pile.x}
              y={pile.y}
              color={color}
              count={left[color]}
              total={perTeam}
              selected={color === active}
              onDown={handleDown}
            />
          );
        })}

        {/* Placed discs. Twenties are deliberately absent — a sunk disc has left
            the board and lives in its team's stash, so drawing it at the centre
            too showed the same disc in two places at once. */}
        {discs.filter((disc) => disc.region !== "twenty").map((disc) => {
          const view = toView(disc.x, disc.y);
          // Nothing is inert in a replay — the shrink-and-fade is there to keep
          // 24 discs legible while you place them, and both sides are finished.
          const isActive = readOnly || disc.color === active;
          const isDragging = drag?.movingId === disc.id;
          return (
            <circle
              key={disc.id}
              cx={view.x}
              cy={view.y}
              r={isDragging ? DISC_RADIUS * 0.9 : isActive ? DISC_RADIUS * 1.15 : DISC_RADIUS * 0.75}
              className={`scorer__disc scorer__disc--${disc.color}${isDragging ? " is-dragging" : ""}`}
              opacity={isDragging ? 0.55 : isActive ? 1 : 0.5}
              // `pointer-events` is inherited, so the `none` set on the <svg>
              // for a replay would be undone right here by an explicit `auto`.
              style={{ pointerEvents: !readOnly && isActive ? "auto" : "none" }}
              onPointerDown={(event) =>
                handleDown(event, { kind: "disc", id: disc.id }, disc.color)
              }
            />
          );
        })}

        {/* The disc you're holding, riding above the fingertip and enlarged so
            it clears a thumb. A crosshair marks the exact landing point, since
            the disc is no longer where your finger is. */}
        {drag ? (
          <g style={{ pointerEvents: "none" }}>
            <line
              x1={toView(drag.x, drag.y).x}
              y1={toView(drag.x, drag.y).y}
              x2={toView(drag.x, drag.y - LIFT).x}
              y2={toView(drag.x, drag.y - LIFT).y + DISC_RADIUS * 2.1}
              className="scorer__tether"
            />
            <circle
              cx={toView(drag.x, drag.y - LIFT).x}
              cy={toView(drag.x, drag.y - LIFT).y}
              r={DISC_RADIUS * 2.1}
              className={`scorer__disc scorer__disc--${drag.color} is-ghost`}
            />
          </g>
        ) : null}

        {sinking ? (
          <circle
            key={sinking.id}
            r={DISC_RADIUS}
            className={`scorer__disc scorer__disc--${sinking.color} scorer__sink`}
            style={
              {
                "--sink-x0": `${CENTRE_X}px`,
                "--sink-y0": `${CENTRE_Y}px`,
                "--sink-x1": `${sinking.to}px`,
                "--sink-y1": `${STASH_Y}px`,
              } as CSSProperties
            }
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

      {twenty === null ? null : <TwentyFlash key={twenty} />}
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
      cx={CENTRE_X}
      cy={CENTRE_Y}
      r={r}
      fill={fill}
      className={hover === region ? "scorer__ring is-hover" : "scorer__ring"}
      stroke="var(--walnut-soft)"
      strokeWidth="1.2"
    />
  );

  return (
    <g style={{ pointerEvents: "none" }}>
      {ring("ditch", BOARD_R, "var(--felt-deep)")}
      {ring("five", RADII.five, "var(--maple)")}
      {ring("ten", RADII.ten, "var(--maple-deep)")}
      {ring("fifteen", RADII.fifteen, "var(--maple)")}
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (index * Math.PI) / 4 + Math.PI / 8;
        return (
          <circle
            key={index}
            cx={CENTRE_X + Math.cos(angle) * RADII.fifteen}
            cy={CENTRE_Y + Math.sin(angle) * RADII.fifteen}
            r="2.2"
            fill="var(--walnut)"
          />
        );
      })}
      <circle
        cx={CENTRE_X}
        cy={CENTRE_Y}
        r={RADII.twenty * (1 + holeGrow * (HOLE_MAX_SCALE - 1))}
        fill="var(--twenty)"
        stroke="var(--walnut-soft)"
        strokeWidth="1.2"
        className={`scorer__hole${holeGrow >= 1 ? " is-open" : ""}`}
      />
    </g>
  );
}

/**
 * The hovered region, called out properly: a filled band plus a bright edge on
 * BOTH of its boundaries. Brightening the fill alone was too subtle to read
 * mid-drag, and it never showed which two lines the disc had to stay between.
 */
function RegionHighlight({ region }: { region: Region | null }): ReactNode {
  if (!region || region === "twenty") return null;

  const bounds: Record<Exclude<Region, "twenty">, [number, number]> = {
    fifteen: [RADII.twenty, RADII.fifteen],
    ten: [RADII.fifteen, RADII.ten],
    five: [RADII.ten, RADII.five],
    ditch: [RADII.five, RADII.ditch],
  };
  const [inner, outer] = bounds[region];
  const mid = (inner + outer) / 2;

  return (
    <g style={{ pointerEvents: "none" }} className="scorer__zone">
      <circle
        cx={CENTRE_X}
        cy={CENTRE_Y}
        r={mid}
        fill="none"
        strokeWidth={outer - inner}
        className={`scorer__zoneband${region === "ditch" ? " is-ditch" : ""}`}
      />
      {[inner, outer].map((r) => (
        <circle
          key={r}
          cx={CENTRE_X}
          cy={CENTRE_Y}
          r={r}
          fill="none"
          className={`scorer__zoneedge${region === "ditch" ? " is-ditch" : ""}`}
        />
      ))}
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
      opacity={selected ? 1 : 0.8}
      onPointerDown={(event) => onDown(event, { kind: "pile", seat, color }, color)}
      role="button"
      aria-pressed={selected}
      aria-label={`${color} discs, ${count} of ${total} left`}
    >
      {/* A press target far larger than the discs it holds — a pile is the most
          reached-for thing on this screen and it sits in a corner. */}
      <circle cx={x} cy={y - 1.5} r={DISC_RADIUS + 13} fill="transparent" />
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
          cy={STASH_Y}
          r={DISC_RADIUS * 0.85}
          className={`scorer__disc scorer__disc--${color}`}
        />
      ))}
    </g>
  );
}

/**
 * The +20, thrown across the whole screen.
 *
 * ⚠️ **This is not part of the board.** It bounces off the edges of the
 * viewport like a DVD screensaver, eases to rest in the middle of the *page*,
 * and fades there. An SVG `<text>` could never do that: it is trapped in the
 * board's view box, so "centred on the page" would only ever have meant centred
 * on the board — and the board is a 21.5rem square somewhere near the top of a
 * phone screen. So this is a `position: fixed` DOM overlay, portalled to
 * `<body>` so that `.scorer`'s stacking context (z-index 15, below the tab bar)
 * can't trap it either.
 *
 * It is `pointer-events: none` from root to leaf. It covers the entire screen
 * for nearly three seconds, including the *Finish round* button — eating one tap
 * there would be worse than never showing it at all.
 *
 * The small `+5 / +10 / +15 / Gutter!` flashes stayed behind as SVG text on
 * purpose: those annotate a disc, so they belong where the disc is.
 */
function TwentyFlash(): ReactNode {
  const markRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mark = markRef.current;
    if (!mark) return;

    /** Top-left the mark would sit at to be dead centre on screen. */
    const restingPlace = (): { x: number; y: number } => ({
      x: (window.innerWidth - mark.offsetWidth) / 2,
      y: (window.innerHeight - mark.offsetHeight) / 2,
    });
    const place = (x: number, y: number): void => {
      mark.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    let reduced = false;
    try {
      reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    } catch {
      // No matchMedia to ask — assume motion is welcome.
    }

    // Reduced motion: it appears where it was always going to end up and just
    // fades, the same courtesy app.css already extends to the rest of the
    // twenty's fanfare. No bouncing, and flash.css drops the colour cycling too.
    if (reduced) {
      const rest = restingPlace();
      place(rest.x, rest.y);
      return;
    }

    let limitX = Math.max(0, window.innerWidth - mark.offsetWidth);
    let limitY = Math.max(0, window.innerHeight - mark.offsetHeight);
    let x = Math.random() * limitX;
    let y = Math.random() * limitY;
    // A diagonal heading, tilted a little at random and sent off in a random
    // quadrant, so two twenties in a row don't trace the same path.
    const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.7;
    let vx = Math.cos(angle) * TWENTY_SPEED * (Math.random() < 0.5 ? -1 : 1);
    let vy = Math.sin(angle) * TWENTY_SPEED * (Math.random() < 0.5 ? -1 : 1);
    place(x, y);

    // Same shape as the hole-open animation above: one rAF loop, cancelled on
    // unmount. This one writes the transform straight onto the node instead of
    // going through state — it runs every frame for 2.3 seconds, and there is
    // nothing else on this element for React to reconcile.
    let raf = 0;
    const started = performance.now();
    let previous = started;
    /** Where the bounce ended, captured once so the settle eases from a fixed point. */
    let handoff: { x: number; y: number } | null = null;

    const step = (now: number): void => {
      // A backgrounded tab hands back one enormous frame; capped, or the mark
      // teleports off screen and bounces back from somewhere it never was.
      const dt = Math.min(now - previous, 34);
      previous = now;
      const elapsed = now - started;

      if (elapsed < TWENTY_BOUNCE_MS) {
        // Re-read each frame: a phone that rotates mid-flash changes the walls.
        limitX = Math.max(0, window.innerWidth - mark.offsetWidth);
        limitY = Math.max(0, window.innerHeight - mark.offsetHeight);
        x += vx * dt;
        y += vy * dt;
        if (x < 0) {
          x = -x;
          vx = -vx;
        } else if (x > limitX) {
          x = 2 * limitX - x;
          vx = -vx;
        }
        if (y < 0) {
          y = -y;
          vy = -vy;
        } else if (y > limitY) {
          y = 2 * limitY - y;
          vy = -vy;
        }
        place(x, y);
      } else if (elapsed < TWENTY_BOUNCE_MS + TWENTY_SETTLE_MS) {
        handoff ??= { x, y };
        const rest = restingPlace();
        // Ease out: it arrives slowing down, which is what makes it read as
        // coming to rest rather than being cut off mid-bounce.
        const progress = (elapsed - TWENTY_BOUNCE_MS) / TWENTY_SETTLE_MS;
        const eased = 1 - (1 - progress) ** 3;
        place(
          handoff.x + (rest.x - handoff.x) * eased,
          handoff.y + (rest.y - handoff.y) * eased,
        );
      } else {
        // Parked. The fade is CSS's from here, so the loop stops rather than
        // spinning for the last half second.
        const rest = restingPlace();
        place(rest.x, rest.y);
        return;
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return createPortal(
    <div className="twentyflash" aria-hidden="true">
      {/* Two nodes on purpose: the outer one carries the JS-driven position,
          the inner one the CSS pop and colour cycle. One node can't do both —
          a CSS animation on `transform` would overwrite the position every
          frame. */}
      <div className="twentyflash__mark" ref={markRef}>
        <span className="twentyflash__text">+20</span>
      </div>
    </div>,
    document.body,
  );
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `d${idCounter}`;
}
