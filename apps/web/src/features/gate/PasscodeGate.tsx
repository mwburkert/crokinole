/**
 * ⚠️ TEMPORARY — the shared-passphrase interim (§7.1). The passcode half of
 * this file goes when Cloudflare Access lands; the error boundary should stay.
 *
 * Why a boundary at all: `StoreProvider` wraps every route, and a rejected
 * Convex query throws *during render*. Without something to catch it, a wrong
 * passcode takes the whole tree down and the app is a white screen — which is
 * exactly the failure the migration's definition of done names: "a wrong or
 * missing passcode shows a message, not a blank screen."
 */

import { Component, useCallback, useState, type ErrorInfo, type ReactNode } from "react";

import { errorMessage, isBadPasscodeError } from "../../data/errors";
import { usePasscode } from "../../data/passcode";
import { PasscodeScreen } from "./PasscodeScreen";

const REFUSED = "That code didn't work. Try again.";

interface BoundaryProps {
  children: ReactNode;
  /** Commit-phase notification, so side effects (clearing the code) are legal. */
  onError: (error: unknown) => void;
  /** What to show instead of the children. Called during render — keep it pure. */
  fallback: (error: unknown) => ReactNode;
}

interface BoundaryState {
  hasError: boolean;
  error: unknown;
}

/**
 * A plain class boundary — there is still no hook that can catch a render
 * throw. It carries no reset of its own: the gate gives it `key={code}`, so a
 * new code builds a new instance with clean state and the subscription is
 * retried from scratch. Resetting in place would leave the children mounted
 * around a query that has already failed.
 */
class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The only place the real stack survives — the screens deliberately show a
    // short message instead.
    console.error("Render failed below the passcode gate", error, info.componentStack);
    this.props.onError(error);
  }

  override render(): ReactNode {
    if (this.state.hasError) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

/** Anything that isn't an auth failure. The passcode is left alone — it was fine. */
function CrashScreen({ error }: { error: unknown }): ReactNode {
  return (
    <div className="gate">
      <div className="gate__inner">
        <h1 className="gate__title">That didn't load.</h1>
        <p className="muted gate__hint">Sorry. Try again — nothing has been lost.</p>
        <p className="gate__detail" role="alert">
          {errorMessage(error)}
        </p>
        <button
          type="button"
          className="btn btn--primary btn--block btn--lg"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export function PasscodeGate({ children }: { children: ReactNode }): ReactNode {
  const { code, setCode, clear } = usePasscode();
  /** Set when a code comes back refused, so the form can say why it's back. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const handleError = useCallback(
    (error: unknown): void => {
      if (!isBadPasscodeError(error)) return;
      // Drop it: keeping a code the server has rejected would just fail again on
      // the next reload, with no way to type a new one.
      setRefusal(messageFor(error));
      clear();
    },
    [clear],
  );

  const handleSubmit = useCallback(
    (next: string): void => {
      setRefusal(null);
      setCode(next);
    },
    [setCode],
  );

  const renderFallback = useCallback(
    (error: unknown): ReactNode => {
      if (!isBadPasscodeError(error)) return <CrashScreen error={error} />;
      /*
       * `handleError` has already cleared the code, so this renders for at most
       * one commit before the gate itself takes over below. It renders the same
       * screen anyway: if `clear()` ever fails to land, the fallback is the form,
       * never a blank page.
       */
      return <PasscodeScreen error={messageFor(error)} onSubmit={handleSubmit} />;
    },
    [handleSubmit],
  );

  if (code === null) {
    return <PasscodeScreen error={refusal} onSubmit={handleSubmit} />;
  }

  return (
    <ErrorBoundary key={code} onError={handleError} fallback={renderFallback}>
      {children}
    </ErrorBoundary>
  );
}

/**
 * The server's wording if it sent any, ours otherwise — "wrong passcode" from a
 * backend is usually phrased for a log, not for someone standing at a board.
 */
function messageFor(error: unknown): string {
  const message = errorMessage(error);
  return message === "Something went wrong." || message.includes("BAD_PASSCODE")
    ? REFUSED
    : message;
}
