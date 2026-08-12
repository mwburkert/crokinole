/**
 * ⚠️ Half of this is TEMPORARY — `isBadPasscodeError` goes when Cloudflare
 * Access lands and the shared passphrase is deleted (§7.1).
 *
 * Convex errors arrive at the client as a `ConvexError` whose `.data` is
 * whatever the server threw. The server throws
 * `new ConvexError({ kind: "BAD_PASSCODE", message: "…" })`, so that payload is
 * what we look for.
 *
 * Deliberately no `instanceof ConvexError`: the check has to survive a second
 * copy of the `convex` package in the graph, an error that crossed a
 * serialisation boundary, and the plain `Error` a stale deployment can still
 * throw. Structural checks only, cheapest first.
 */

const BAD_PASSCODE = "BAD_PASSCODE";

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** True when a Convex call was refused because the shared passcode was wrong or missing. */
export function isBadPasscodeError(error: unknown): boolean {
  if (typeof error === "string") return error.includes(BAD_PASSCODE);

  const data = readProperty(error, "data");

  // The shape the server actually throws.
  if (readProperty(data, "kind") === BAD_PASSCODE) return true;

  // Belt and braces: a string payload, or a message that merely mentions it —
  // enough to keep a wrong code showing the form instead of a crash screen.
  if (typeof data === "string" && data.includes(BAD_PASSCODE)) return true;

  const message = readProperty(error, "message");
  if (typeof message === "string" && message.includes(BAD_PASSCODE)) return true;

  return false;
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A human-readable message for any error surfaced by the boundary.
 *
 * The server's own `data.message` is preferred over `error.message`: Convex
 * appends the function name and a "Called by client" trace to the latter, which
 * is useful in a console and noise on a phone.
 */
export function errorMessage(error: unknown): string {
  const direct = trimmedString(error);
  if (direct !== null) return direct;

  const data = readProperty(error, "data");
  const fromDataMessage = trimmedString(readProperty(data, "message"));
  if (fromDataMessage !== null) return fromDataMessage;

  const fromData = trimmedString(data);
  if (fromData !== null) return fromData;

  const fromMessage = trimmedString(readProperty(error, "message"));
  if (fromMessage !== null) return fromMessage;

  return "Something went wrong.";
}
