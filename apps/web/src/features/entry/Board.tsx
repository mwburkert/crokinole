import { DISC_RADIUS, RADII, type DiscColor } from "@crokinole/core";
import type { ReactNode } from "react";

/** Outer lip of the ditch in this drawing, with the walnut frame ringing it. */
const RIM = 92;

/**
 * `RADII` is the scorer's layout, where the lip sits at `RADII.ditch`. Every
 * ring below is that layout scaled to `RIM`, so this board and the one you
 * score on show the same rings in the same proportions.
 *
 * ⚠️ These were hardcoded (86 / 58 / 30 / 8) and had already drifted: the ditch
 * drawn here was 6 units wide against an 86-unit surface where the scorer's was
 * 14, so the two pictures disagreed about how much board there is. Deriving
 * them is what carried the widened gutter through to this screen for free.
 */
const K = RIM / RADII.ditch;
const R = {
  five: RADII.five * K,
  ten: RADII.ten * K,
  fifteen: RADII.fifteen * K,
  twenty: RADII.twenty * K,
};
/** Mid-gutter: where a disc resting in the ditch actually sits. */
const DITCH_MID = (R.five + RIM) / 2;

/**
 * A crokinole board, drawn to the real ring layout: an outer ditch, the 5
 * region divided into quadrants, then 10, then the 15 circle ringed with eight
 * pegs, and the 20 hole at the centre.
 *
 * Purely decorative — it exists so the seating on the setup screen reads as a
 * table you're sitting around rather than a list of names. Partners sit across
 * from each other, so the picture carries the team structure by itself.
 */
export function Board({
  topColor,
  sideColor,
  singles = false,
}: {
  /** Disc colour of the top/bottom pair. */
  topColor: DiscColor;
  /** Disc colour of the left/right pair. */
  sideColor: DiscColor;
  singles?: boolean;
}): ReactNode {
  const pegs = Array.from({ length: 8 }, (_, index) => {
    const angle = (index * Math.PI) / 4 + Math.PI / 8;
    return { x: 100 + Math.cos(angle) * R.fifteen, y: 100 + Math.sin(angle) * R.fifteen };
  });

  // Quadrant dividers run through the 5 region only, at the diagonals.
  const dividers = [45, 135, 225, 315].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return {
      x1: 100 + Math.cos(rad) * R.ten,
      y1: 100 + Math.sin(rad) * R.ten,
      x2: 100 + Math.cos(rad) * R.five,
      y2: 100 + Math.sin(rad) * R.five,
    };
  });

  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="Crokinole board" style={{ width: "100%" }}>
      {/* Frame and ditch */}
      <circle cx="100" cy="100" r="99" fill="var(--walnut)" />
      <circle cx="100" cy="100" r={RIM} fill="var(--felt-deep)" />
      {/* Playing surface — the 5 region */}
      <circle
        cx="100"
        cy="100"
        r={R.five}
        fill="var(--maple)"
        stroke="var(--walnut-soft)"
        strokeWidth="1.5"
      />
      {dividers.map((line, index) => (
        <line
          key={index}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="var(--walnut-soft)"
          strokeWidth="1.2"
        />
      ))}
      {/* 10 */}
      <circle cx="100" cy="100" r={R.ten} fill="none" stroke="var(--walnut-soft)" strokeWidth="1.5" />
      {/* 15 */}
      <circle cx="100" cy="100" r={R.fifteen} fill="none" stroke="var(--walnut-soft)" strokeWidth="1.5" />
      {pegs.map((peg, index) => (
        <circle key={index} cx={peg.x} cy={peg.y} r="2.4" fill="var(--walnut)" />
      ))}
      {/* 20 */}
      <circle cx="100" cy="100" r={R.twenty} fill="var(--twenty)" />
      <circle cx="100" cy="100" r={R.twenty * 0.56} fill="var(--felt-deep)" />

      {/* Two discs per side, sitting in front of each seat, so the colours are
          unambiguous without a legend. They ride the middle of the gutter — they
          used to sit at radius 70, which the widened ditch now starts at, and a
          disc drawn straddling the rim of the playing surface is the one thing
          this picture must not show. */}
      <Discs cx={100} cy={100 - DITCH_MID} color={topColor} />
      <Discs cx={100} cy={100 + DITCH_MID} color={topColor} />
      {singles ? null : (
        <>
          <Discs cx={100 - DITCH_MID} cy={100} color={sideColor} vertical />
          <Discs cx={100 + DITCH_MID} cy={100} color={sideColor} vertical />
        </>
      )}
    </svg>
  );
}

/**
 * A pair of discs resting in the ditch in front of a seat.
 *
 * Drawn at core's `DISC_RADIUS` **unscaled**, unlike the rings above. Scaling it
 * to `RIM` would be proportionally truer and 20% smaller, and these exist to be
 * read as a colour at thumbnail size — the gutter is wide enough to hold them
 * either way, so legibility wins.
 */
function Discs({
  cx,
  cy,
  color,
  vertical = false,
}: {
  cx: number;
  cy: number;
  color: DiscColor;
  vertical?: boolean;
}): ReactNode {
  const fill = color === "black" ? "var(--disc-black)" : "var(--disc-white)";
  const spread = DISC_RADIUS + 1.5;
  const dx = vertical ? 0 : spread;
  const dy = vertical ? spread : 0;
  return (
    <g>
      <circle
        cx={cx - dx}
        cy={cy - dy}
        r={DISC_RADIUS}
        fill={fill}
        stroke="var(--walnut)"
        strokeWidth="0.8"
      />
      <circle
        cx={cx + dx}
        cy={cy + dy}
        r={DISC_RADIUS}
        fill={fill}
        stroke="var(--walnut)"
        strokeWidth="0.8"
      />
    </g>
  );
}
