import type { DiscColor } from "@crokinole/core";
import type { ReactNode } from "react";

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
    return { x: 100 + Math.cos(angle) * 30, y: 100 + Math.sin(angle) * 30 };
  });

  // Quadrant dividers run through the 5 region only, at the diagonals.
  const dividers = [45, 135, 225, 315].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return {
      x1: 100 + Math.cos(rad) * 58,
      y1: 100 + Math.sin(rad) * 58,
      x2: 100 + Math.cos(rad) * 86,
      y2: 100 + Math.sin(rad) * 86,
    };
  });

  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="Crokinole board" style={{ width: "100%" }}>
      {/* Frame and ditch */}
      <circle cx="100" cy="100" r="99" fill="var(--walnut)" />
      <circle cx="100" cy="100" r="92" fill="var(--felt-deep)" />
      {/* Playing surface — the 5 region */}
      <circle cx="100" cy="100" r="86" fill="var(--maple)" stroke="var(--walnut-soft)" strokeWidth="1.5" />
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
      <circle cx="100" cy="100" r="58" fill="none" stroke="var(--walnut-soft)" strokeWidth="1.5" />
      {/* 15 */}
      <circle cx="100" cy="100" r="30" fill="none" stroke="var(--walnut-soft)" strokeWidth="1.5" />
      {pegs.map((peg, index) => (
        <circle key={index} cx={peg.x} cy={peg.y} r="2.4" fill="var(--walnut)" />
      ))}
      {/* 20 */}
      <circle cx="100" cy="100" r="8" fill="var(--twenty)" />
      <circle cx="100" cy="100" r="4.5" fill="var(--felt-deep)" />

      {/* Two discs per side, sitting in front of each seat, so the colours are
          unambiguous without a legend. */}
      <Discs cx={100} cy={30} color={topColor} />
      <Discs cx={100} cy={170} color={topColor} />
      {singles ? null : (
        <>
          <Discs cx={30} cy={100} color={sideColor} vertical />
          <Discs cx={170} cy={100} color={sideColor} vertical />
        </>
      )}
    </svg>
  );
}

/** A pair of discs resting in the ditch in front of a seat. */
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
  const dx = vertical ? 0 : 7;
  const dy = vertical ? 7 : 0;
  return (
    <g>
      <circle cx={cx - dx} cy={cy - dy} r="5.5" fill={fill} stroke="var(--walnut)" strokeWidth="0.8" />
      <circle cx={cx + dx} cy={cy + dy} r="5.5" fill={fill} stroke="var(--walnut)" strokeWidth="0.8" />
    </g>
  );
}
