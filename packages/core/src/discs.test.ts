import { describe, expect, it } from "vitest";

import {
  BOARD_CENTRE,
  DISC_RADIUS,
  RADII,
  countsFromDiscs,
  placeAt,
  placedCount,
  placementComplete,
  radiusOf,
  regionAt,
  remaining,
  snapIntoRegion,
  type PlacedDisc,
  type Region,
} from "./discs.js";
import { makeRandom } from "./testing.js";

const at = (r: number, angle = 0): [number, number] => [
  BOARD_CENTRE + Math.cos(angle) * r,
  BOARD_CENTRE + Math.sin(angle) * r,
];

/**
 * The two radii that bound a region, read straight off `RADII`.
 *
 * Deliberately derived rather than written down: a test that restates the
 * numbers only proves someone typed them twice. Everything below asks whether
 * the ring layout still *works*, whatever the numbers become.
 */
const RING: Record<Exclude<Region, "twenty">, { inner: number; outer: number }> = {
  fifteen: { inner: RADII.twenty, outer: RADII.fifteen },
  ten: { inner: RADII.fifteen, outer: RADII.ten },
  five: { inner: RADII.ten, outer: RADII.five },
  ditch: { inner: RADII.five, outer: RADII.ditch },
};

const RINGS = Object.keys(RING) as Exclude<Region, "twenty">[];

/** Mid-band radius — a point that is unambiguously inside a region. */
const midOf = (region: Exclude<Region, "twenty">): number =>
  (RING[region].inner + RING[region].outer) / 2;

describe("regionAt", () => {
  it("reads each ring outward from the centre", () => {
    expect(regionAt(BOARD_CENTRE, BOARD_CENTRE)).toBe("twenty");
    expect(regionAt(...at(20))).toBe("fifteen");
    expect(regionAt(...at(45))).toBe("ten");
    expect(regionAt(...at(75))).toBe("five");
    expect(regionAt(...at(midOf("ditch")))).toBe("ditch");
  });

  it("is null off the board", () => {
    expect(regionAt(...at(RADII.ditch + 1))).toBeNull();
    expect(regionAt(0, 0)).toBeNull();
  });

  it("puts a boundary point in the tighter region", () => {
    expect(regionAt(...at(RADII.fifteen))).toBe("fifteen");
    expect(regionAt(...at(RADII.fifteen + 0.01))).toBe("ten");
  });
});

/**
 * The rule the ring layout has to keep, whatever the radii are.
 *
 * ⚠️ Every band must be wide enough to hold a disc whole. `snapIntoRegion` has
 * a guard for the case where one isn't — it parks the disc mid-band rather than
 * clamping to a nonsense value — but that guard is damage control: a region too
 * narrow to hold a disc puts one straddling a scoring line, and the count comes
 * from where the disc is. This is the assertion that stops anyone reaching that
 * state, and it is why the gutter was widened from the outside.
 */
describe("ring geometry", () => {
  it("gives every region room for a whole disc", () => {
    for (const region of RINGS) {
      const { inner, outer } = RING[region];
      // Restated as the band a disc's CENTRE may occupy: max >= min, or there
      // is no legal placement in the region at all.
      const min = inner + DISC_RADIUS;
      const max = outer - DISC_RADIUS;
      expect(max, `${region} has no room for a disc`).toBeGreaterThanOrEqual(min);
    }
  });

  it("runs the rings strictly outward with no gaps", () => {
    const edges = [RADII.twenty, ...RINGS.map((region) => RING[region].outer)];
    for (let i = 1; i < edges.length; i += 1) {
      expect(edges[i]!).toBeGreaterThan(edges[i - 1]!);
    }
    // Each ring starts exactly where the last one stopped.
    for (const region of RINGS) {
      expect(regionAt(...at(RING[region].outer))).toBe(region);
    }
  });

  it("gives the gutter room for a disc to move, not just to exist", () => {
    // The gutter is a real drop zone: you place there, drag along it, and it
    // has to hold a disc that isn't dead centre in the band. A band only just
    // wide enough would pin every ditched disc to a single radius.
    const { inner, outer } = RING.ditch;
    const travel = outer - inner - DISC_RADIUS * 2;
    expect(travel).toBeGreaterThan(DISC_RADIUS);
  });
});

describe("snapIntoRegion", () => {
  it("leaves a disc wholly inside its region", () => {
    const random = makeRandom(8812);
    for (const region of RINGS) {
      for (let i = 0; i < 300; i += 1) {
        const angle = random() * Math.PI * 2;
        const r = random() * RADII.ditch;
        const [x, y] = at(r, angle);
        const point = snapIntoRegion(x, y, region);
        const centre = radiusOf(point.x, point.y);

        // Every edge of the disc has to sit within the region's band.
        const { inner, outer } = RING[region];
        expect(centre - DISC_RADIUS).toBeGreaterThanOrEqual(inner - 1e-6);
        expect(centre + DISC_RADIUS).toBeLessThanOrEqual(outer + 1e-6);
        // And it must still read as that region.
        expect(regionAt(point.x, point.y)).toBe(region);
      }
    }
  });

  /**
   * The ditch, on its own, because it is the band that gets narrowed by
   * accident: it is the only one bounded by the edge of the board rather than
   * by another ring, so it is the one that shrinks when the drawing changes.
   */
  it("snaps a ditched disc wholly inside the gutter, wherever it was dropped", () => {
    const { inner, outer } = RING.ditch;
    const drops = [
      0, // dead centre
      inner - DISC_RADIUS, // short of the gutter
      inner, // exactly on the inner lip
      midOf("ditch"),
      outer, // exactly on the outer lip
      outer + 30, // past the board entirely
    ];
    for (const r of drops) {
      for (const angle of [0, 1.1, Math.PI, 4.7]) {
        const point = snapIntoRegion(...at(r, angle), "ditch");
        const centre = radiusOf(point.x, point.y);
        expect(centre - DISC_RADIUS).toBeGreaterThanOrEqual(inner - 1e-6);
        expect(centre + DISC_RADIUS).toBeLessThanOrEqual(outer + 1e-6);
        expect(regionAt(point.x, point.y)).toBe("ditch");
      }
    }
  });

  it("agrees with regionAt on both sides of every boundary", () => {
    for (const region of RINGS) {
      const { inner, outer } = RING[region];
      // A tap on either lip, and a hair inside each, must land in the region
      // that was asked for — this is the pair that has to stay in step, since
      // `placeAt` picks the region with `regionAt` and then hands it to
      // `snapIntoRegion`.
      for (const r of [inner, inner + 1e-3, outer - 1e-3, outer]) {
        const point = snapIntoRegion(...at(r, 2.3), region);
        expect(regionAt(point.x, point.y), `${region} at r=${r}`).toBe(region);
      }
      // A tap right on a lip still places, and the disc it leaves behind is
      // wholly inside whichever region it was read as — never straddling the
      // line it was tapped on.
      const onLip = placeAt(...at(outer - 1e-9, 2.3), "black", "lip");
      expect(onLip, `nothing placed on the ${region} lip`).not.toBeNull();
      const lipEdges = RING[onLip!.region as Exclude<Region, "twenty">];
      const r = radiusOf(onLip!.x, onLip!.y);
      expect(r - DISC_RADIUS).toBeGreaterThanOrEqual(lipEdges.inner - 1e-6);
      expect(r + DISC_RADIUS).toBeLessThanOrEqual(lipEdges.outer + 1e-6);
    }
  });

  it("sinks a twenty to dead centre", () => {
    expect(snapIntoRegion(140, 90, "twenty")).toEqual({ x: BOARD_CENTRE, y: BOARD_CENTRE });
  });

  it("handles a point exactly at the centre without dividing by zero", () => {
    const point = snapIntoRegion(BOARD_CENTRE, BOARD_CENTRE, "ten");
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(regionAt(point.x, point.y)).toBe("ten");
  });

  it("keeps the direction of the original tap", () => {
    const point = snapIntoRegion(...at(80, Math.PI / 2), "ten");
    // Straight down from centre stays straight down.
    expect(point.x).toBeCloseTo(BOARD_CENTRE, 5);
    expect(point.y).toBeGreaterThan(BOARD_CENTRE);
  });
});

describe("placeAt", () => {
  it("places into the tapped region", () => {
    const disc = placeAt(...at(45), "black", "d1");
    expect(disc?.region).toBe("ten");
    expect(disc?.color).toBe("black");
  });

  it("refuses a tap off the board", () => {
    expect(placeAt(0, 0, "white", "d1")).toBeNull();
  });

  it("always produces a disc that reads back as its own region", () => {
    const random = makeRandom(4711);
    for (let i = 0; i < 500; i += 1) {
      const [x, y] = at(random() * RADII.ditch, random() * Math.PI * 2);
      const disc = placeAt(x, y, "black", `d${i}`);
      if (!disc) continue;
      expect(regionAt(disc.x, disc.y)).toBe(disc.region);
    }
  });
});

describe("countsFromDiscs", () => {
  const discs: PlacedDisc[] = [
    { id: "1", color: "black", x: 100, y: 100, region: "twenty" },
    { id: "2", color: "black", x: 100, y: 80, region: "fifteen" },
    { id: "3", color: "black", x: 100, y: 55, region: "ten" },
    { id: "4", color: "black", x: 100, y: 25, region: "five" },
    { id: "5", color: "black", x: 100, y: 8, region: "ditch" },
    { id: "6", color: "white", x: 100, y: 100, region: "twenty" },
  ];

  it("counts only the requested colour", () => {
    expect(countsFromDiscs(discs, "black")).toEqual({
      twenties: 1,
      fifteens: 1,
      tens: 1,
      fives: 1,
    });
    expect(countsFromDiscs(discs, "white")).toEqual({
      twenties: 1,
      fifteens: 0,
      tens: 0,
      fives: 0,
    });
  });

  it("scores a ditched disc as nothing, but still counts it as placed", () => {
    const ditched = discs.filter((disc) => disc.region === "ditch");
    expect(countsFromDiscs(ditched, "black")).toEqual({
      twenties: 0,
      fifteens: 0,
      tens: 0,
      fives: 0,
    });
    expect(placedCount(ditched, "black")).toBe(1);
  });
});

describe("placement completeness", () => {
  const make = (color: "black" | "white", n: number): PlacedDisc[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${color}${i}`,
      color,
      x: 100,
      y: 55,
      region: "ten" as Region,
    }));

  it("needs both sides fully placed", () => {
    expect(placementComplete([...make("black", 12), ...make("white", 12)], 12)).toBe(true);
    expect(placementComplete([...make("black", 12), ...make("white", 11)], 12)).toBe(false);
    expect(placementComplete([], 12)).toBe(false);
  });

  it("reports what's still in hand", () => {
    expect(remaining([...make("black", 5), ...make("white", 12)], 12)).toEqual({
      black: 7,
      white: 0,
    });
  });

  it("never reports negative remaining", () => {
    expect(remaining(make("black", 20), 12).black).toBe(0);
  });
});
