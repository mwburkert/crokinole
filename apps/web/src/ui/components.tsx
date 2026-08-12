import { formatCents, type DiscColor } from "@crokinole/core";
import type { ReactNode } from "react";

import "./loading.css";

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  /** Sits opposite the title, in line with it — an info toggle, a menu, etc. */
  action?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="card">
      {title || action ? (
        <div className="card__head">
          {title ? <h2 className="card__title">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A literal black or white crokinole disc. */
export function Disc({ color }: { color: DiscColor }): ReactNode {
  return <span className={`disc disc--${color}`} aria-hidden="true" />;
}

export function Money({ cents }: { cents: number }): ReactNode {
  const className = cents > 0 ? "pos num" : cents < 0 ? "neg num" : "muted num";
  return <span className={className}>{formatCents(cents)}</span>;
}

export function Badge({
  children,
  live = false,
}: {
  children: ReactNode;
  live?: boolean;
}): ReactNode {
  return <span className={live ? "badge badge--live" : "badge"}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="empty">{children}</p>;
}

/**
 * What stands where an `Empty` would, until the data has actually answered.
 *
 * The two are easy to confuse and the difference is the whole point: the store
 * hands back an empty array both while a query is in flight and when there is
 * genuinely nothing, so a screen that renders `Empty` on `length === 0` tells
 * you your night is missing every time you open the app. Anything with an empty
 * state checks `isLoading` first and renders this instead.
 *
 * `rows` is roughly what's coming — 1 for a line, 4 or so for a table — so the
 * screen settles rather than jumps when it arrives.
 */
export function Loading({ rows = 1 }: { rows?: number }): ReactNode {
  return (
    <div className="loading" role="status" aria-busy="true">
      {/* First in the DOM so the bars keep their "last line is short" rule. */}
      <span className="loading__label">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <span className="loading__bar" key={index} />
      ))}
    </div>
  );
}

/**
 * A big tap target for one ring value.
 *
 * Increment on tap, decrement on the minus. Both are full-height so they can be
 * hit without looking — the whole point of §3.5's entry screen is that it works
 * one-handed while standing at a board.
 */
export function Stepper({
  label,
  value,
  onChange,
  canIncrement = true,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  /**
   * Blocks only the `+` button. Decrementing must always stay available —
   * disabling both at the disc cap would strand you with no way to correct a
   * mis-tap, which is the single most common error during live entry (§3.5).
   */
  canIncrement?: boolean;
}): ReactNode {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper__btn"
        aria-label={`One fewer ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <span className="stepper__value">
        <span className="stepper__ring">{label}</span>
        <span className="stepper__count">{value}</span>
      </span>
      <button
        type="button"
        className="stepper__btn"
        aria-label={`One more ${label}`}
        disabled={!canIncrement}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}): ReactNode {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          disabled={option.disabled ?? false}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
