/**
 * Board geometry and disc placement.
 *
 * The scorer lets you put discs where they actually came to rest, so ring
 * counts are **derived from positions** rather than tapped in. That makes
 * position the first stored value in this app that isn't a raw input — see
 * §3.5. The rule that keeps it honest lives here: `countsFromDiscs` is the only
 * way counts are produced from a placed board, so the two can never disagree.
 *
 * All coordinates are in the board's own 0–200 space with the centre at
 * (100, 100), independent of how large it's drawn.
 */

import type { DiscColor, PlacedDisc, Region, RingCounts } from "./types.js";

/**
 * `PlacedDisc` and `Region` are declared in `types.ts` because `Round` carries
 * positions, and a type both modules need can't live in the one that imports
 * the other. They are re-exported here, where the geometry that gives them
 * meaning lives.
 */
export type { PlacedDisc, Region } from "./types.js";

export const BOARD_CENTRE = 100;
export const DISC_RADIUS = 5.5;

/** Outer radius of each scoring region, centre outward. */
export const RADII = {
  twenty: 8,
  fifteen: 30,
  ten: 58,
  five: 86,
  /**
   * Outer lip of the ditch. Beyond this isn't the board at all.
   *
   * Must leave a band at least one disc wide (2 × `DISC_RADIUS`) outside the
   * playing surface, or a ditched disc could never sit wholly inside it and
   * every drop there would snap somewhere misleading.
   */
  ditch: 100,
} as const;

/** Distance from the centre of the board. */
export function radiusOf(x: number, y: number): number {
  return Math.hypot(x - BOARD_CENTRE, y - BOARD_CENTRE);
}

/** Which region a point falls in, or `null` if it's off the board entirely. */
export function regionAt(x: number, y: number): Region | null {
  const r = radiusOf(x, y);
  if (r <= RADII.twenty) return "twenty";
  if (r <= RADII.fifteen) return "fifteen";
  if (r <= RADII.ten) return "ten";
  if (r <= RADII.five) return "five";
  if (r <= RADII.ditch) return "ditch";
  return null;
}

/** Inner and outer radius a disc's *centre* may occupy to sit fully inside a region. */
function bandFor(region: Region): { min: number; max: number } {
  switch (region) {
    case "twenty":
      // Sunk. It sits in the hole, not beside it.
      return { min: 0, max: 0 };
    case "fifteen":
      return { min: RADII.twenty + DISC_RADIUS, max: RADII.fifteen - DISC_RADIUS };
    case "ten":
      return { min: RADII.fifteen + DISC_RADIUS, max: RADII.ten - DISC_RADIUS };
    case "five":
      return { min: RADII.ten + DISC_RADIUS, max: RADII.five - DISC_RADIUS };
    case "ditch":
      return { min: RADII.five + DISC_RADIUS, max: RADII.ditch - DISC_RADIUS };
  }
}

/**
 * Pull a point to the nearest position where the disc sits **wholly inside**
 * the given region.
 *
 * A tap near a boundary still places — dragging corrects it — but the disc it
 * leaves behind is never straddling a line, so which region it counts as is
 * always unambiguous on screen.
 */
export function snapIntoRegion(x: number, y: number, region: Region): { x: number; y: number } {
  const bandRaw = bandFor(region);
  if (bandRaw.max <= 0) return { x: BOARD_CENTRE, y: BOARD_CENTRE };

  // A band narrower than the disc has no valid centre; sit it in the middle of
  // the region rather than clamping to a nonsense value. Guards against anyone
  // narrowing a ring in RADII without noticing.
  const band =
    bandRaw.min > bandRaw.max
      ? { min: (bandRaw.min + bandRaw.max) / 2, max: (bandRaw.min + bandRaw.max) / 2 }
      : bandRaw;

  const dx = x - BOARD_CENTRE;
  const dy = y - BOARD_CENTRE;
  const r = Math.hypot(dx, dy);

  // Dead centre has no direction to push outward in; pick one deterministically.
  if (r < 1e-6) {
    return { x: BOARD_CENTRE, y: BOARD_CENTRE - (band.min + band.max) / 2 };
  }

  const clamped = Math.min(Math.max(r, band.min), band.max);
  return {
    x: BOARD_CENTRE + (dx / r) * clamped,
    y: BOARD_CENTRE + (dy / r) * clamped,
  };
}

/** Place a disc at a point, snapped into whichever region that point falls in. */
export function placeAt(
  x: number,
  y: number,
  color: DiscColor,
  id: string,
): PlacedDisc | null {
  const region = regionAt(x, y);
  if (!region) return null;
  const point = snapIntoRegion(x, y, region);
  return { id, color, x: point.x, y: point.y, region };
}

/**
 * Ring counts for one colour, derived from placed discs.
 *
 * Ditched discs are deliberately absent — they're placed, but they score
 * nothing, which is exactly why the ditch needed to be a real drop zone.
 */
export function countsFromDiscs(discs: PlacedDisc[], color: DiscColor): RingCounts {
  const counts: RingCounts = { twenties: 0, fifteens: 0, tens: 0, fives: 0 };
  for (const disc of discs) {
    if (disc.color !== color) continue;
    switch (disc.region) {
      case "twenty":
        counts.twenties += 1;
        break;
      case "fifteen":
        counts.fifteens += 1;
        break;
      case "ten":
        counts.tens += 1;
        break;
      case "five":
        counts.fives += 1;
        break;
      case "ditch":
        break;
    }
  }
  return counts;
}

/** How many of one colour are on the board, ditch included. */
export function placedCount(discs: PlacedDisc[], color: DiscColor): number {
  return discs.filter((disc) => disc.color === color).length;
}

/**
 * Whether every disc is accounted for — the condition behind the "place X more"
 * prompt. Both sides must be fully placed for a round to carry detail.
 */
export function placementComplete(discs: PlacedDisc[], perTeam: number): boolean {
  return placedCount(discs, "black") === perTeam && placedCount(discs, "white") === perTeam;
}

/** How many discs are still in hand, per colour. */
export function remaining(
  discs: PlacedDisc[],
  perTeam: number,
): Record<DiscColor, number> {
  return {
    black: Math.max(0, perTeam - placedCount(discs, "black")),
    white: Math.max(0, perTeam - placedCount(discs, "white")),
  };
}
