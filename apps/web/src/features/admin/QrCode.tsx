import qrcode from "qrcode-generator";
import { useMemo, type ReactNode } from "react";

/**
 * A QR code rendered as real SVG rects rather than injected markup.
 *
 * `qrcode-generator` can hand back an SVG string, but building the modules
 * ourselves avoids `dangerouslySetInnerHTML` entirely and lets the code inherit
 * the theme colours, so it stays legible in dark mode.
 */
export function QrCode({
  value,
  size = 200,
  label,
}: {
  value: string;
  size?: number;
  label?: string;
}): ReactNode {
  const modules = useMemo(() => {
    // Type 0 = auto-size for the content. "M" tolerates ~15% damage, which is
    // plenty for a screen someone points a phone at.
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const dark: [number, number][] = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) dark.push([row, col]);
      }
    }
    return { count, dark };
  }, [value]);

  const quiet = 2; // the mandatory quiet zone, in modules
  const span = modules.count + quiet * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={label ?? `QR code for ${value}`}
      style={{ display: "block", borderRadius: "0.5rem" }}
      shapeRendering="crispEdges"
    >
      <rect width={span} height={span} fill="var(--disc-white)" />
      <g fill="var(--disc-black)">
        {modules.dark.map(([row, col]) => (
          <rect key={`${row}-${col}`} x={col + quiet} y={row + quiet} width={1} height={1} />
        ))}
      </g>
    </svg>
  );
}
