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

describe("regionAt", () => {
  it("reads each ring outward from the centre", () => {
    expect(regionAt(BOARD_CENTRE, BOARD_CENTRE)).toBe("twenty");
    expect(regionAt(...at(20))).toBe("fifteen");
    expect(regionAt(...at(45))).toBe("ten");
    expect(regionAt(...at(75))).toBe("five");
    expect(regionAt(...at(92))).toBe("ditch");
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

describe("snapIntoRegion", () => {
  const scorable: Region[] = ["fifteen", "ten", "five", "ditch"];

  it("leaves a disc wholly inside its region", () => {
    const random = makeRandom(8812);
    for (const region of scorable) {
      for (let i = 0; i < 300; i += 1) {
        const angle = random() * Math.PI * 2;
        const r = random() * RADII.ditch;
        const [x, y] = at(r, angle);
        const point = snapIntoRegion(x, y, region);
        const centre = radiusOf(point.x, point.y);

        // Every edge of the disc has to sit within the region's band.
        const inner = region === "fifteen" ? RADII.twenty : region === "ten" ? RADII.fifteen : region === "five" ? RADII.ten : RADII.five;
        const outer = region === "fifteen" ? RADII.fifteen : region === "ten" ? RADII.ten : region === "five" ? RADII.five : RADII.ditch;
        expect(centre - DISC_RADIUS).toBeGreaterThanOrEqual(inner - 1e-6);
        expect(centre + DISC_RADIUS).toBeLessThanOrEqual(outer + 1e-6);
        // And it must still read as that region.
        expect(regionAt(point.x, point.y)).toBe(region);
      }
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
