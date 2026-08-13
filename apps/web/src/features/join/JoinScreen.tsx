/**
 * Intake — `/join` (§3.6).
 *
 * The one screen a person who is not yet a player ever sees, and the only one.
 * Two doors lead here and they must not become two screens:
 *
 *   1. **The QR code**, which encodes `<origin>/join?code=XXXX`. The code is
 *      stripped and stored by `consumeCodeFromUrl()` before React mounts, so by
 *      the time this renders the passcode is already in context and step 1 is
 *      skipped entirely. **A QR joiner is never asked for a code** — they were
 *      handed one by the act of scanning, and asking again is asking them to
 *      copy out a string they never saw.
 *   2. **Typing the URL**, which arrives with nothing. That gets step 1: the
 *      code, then the same email step.
 *
 * A route rather than the overlay it used to be, and the router had to move
 * above `<PasscodeGate>` for it (see `main.tsx`). The reason is door 2: a person
 * with no code at all must be able to reach this, and every other screen in the
 * app is correctly unreachable without one. It is also why this file re-does
 * work `data/store.tsx` would otherwise do — `StoreProvider` lives below the
 * gate, so `useStore()` does not exist up here and Convex is called directly.
 *
 * **Email comes first and is required**, deliberately unlike the admin's add
 * form. It is the only thing that can tell a returning player from a new one:
 * `players.selfJoin` patches the row that already holds that address instead of
 * inserting a second one, so a rejoin keeps every game — and every pound —
 * hanging off the same id. The lookup above the form is that same fact shown
 * early rather than after the write: it fills the form in from the row we
 * already have, so nobody types a second spelling of themselves and then
 * wonders why their winnings halved.
 *
 * The name fields are on screen from the start, below the email and **disabled**
 * until it resolves — not hidden. Hidden fields make the screen change shape
 * under the thumb and give no warning that more is coming; greyed-out ones say
 * "these are next, and the email decides what goes in them", which is exactly
 * what is true.
 */

import { defaultNickname, MAX_NAME_LENGTH } from "@crokinole/core";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../../../../../convex/_generated/api";
import { errorMessage, isBadPasscodeError } from "../../data/errors";
import { usePasscode, useRequiredPasscode } from "../../data/passcode";
import "../../ui/join.css";

/**
 * Stricter than the server, which only insists on an `@`.
 *
 * This address is the identity key for the row from here on, and a typo'd one
 * can't be told apart from a real one — it just quietly becomes a second person
 * the next time they join. Insisting on something after the dot costs nothing
 * and catches the common slip.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value);
}

/** Long enough that a typed address isn't looked up letter by letter. */
const LOOKUP_DEBOUNCE_MS = 400;

const REFUSED = "That code didn't work. Try again.";

/** Where a finished joiner goes. They hold a valid code now, so the app is theirs. */
const AFTER_JOIN = "/";

export function JoinScreen(): ReactNode {
  const { code, clear } = usePasscode();
  /** Set when a stored code comes back refused, so step 1 can say why it's back. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const handleError = useCallback(
    (error: unknown): void => {
      if (!isBadPasscodeError(error)) return;
      /*
       * The code we were *given* is bad — a stale one in localStorage, or a QR
       * printed before the code was rotated. Dropping it is the only way to get
       * a new one typed in, and it is safe here precisely because this ran on a
       * code that arrived from outside. A code typed into step 1 never reaches
       * this path: `CodeStep` proves it before storing it, for exactly this
       * reason.
       */
      setRefusal(REFUSED);
      clear();
    },
    [clear],
  );

  return (
    <div className="join">
      <div className="join__inner">
        <BoardMark />
        {code === null ? (
          <CodeStep error={refusal} onAccepted={() => setRefusal(null)} />
        ) : (
          /*
           * Its own boundary, because there is nothing above it. `PasscodeGate`
           * carries the app's only other one and it is *below* this route now,
           * so a rejected `players.list` here would throw during render with
           * nobody to catch it — a white screen, for the one person in the
           * building who has never used the app before. It is keyed on the code
           * so a freshly typed one builds a clean instance and retries the
           * subscription rather than staying stuck on the failure.
           */
          <JoinBoundary
            key={code}
            onError={handleError}
            fallback={(error) =>
              isBadPasscodeError(error) ? (
                // `handleError` has already cleared the code, so this shows for
                // at most one commit before the branch above takes over. It
                // renders the same step anyway: if `clear()` ever fails to land,
                // the fallback is the form, never a blank page.
                <CodeStep error={REFUSED} onAccepted={() => setRefusal(null)} />
              ) : (
                <CrashStep error={error} />
              )
            }
          >
            <JoinForm />
          </JoinBoundary>
        )}
      </div>
    </div>
  );
}

/**
 * The tab bar's board glyph, big enough to carry a screen.
 *
 * 🕐 The third copy of this path data (`App.tsx`, `PasscodeScreen.tsx`, here).
 * It belongs in `ui/components.tsx` as one `<BoardMark size>` — left alone only
 * because that file is outside this change's ownership. Worth doing in one pass
 * when someone owns all three.
 *
 * Present at all because this is the one screen reached cold, from a phone
 * camera, by someone who has never opened the app: without a mark it is an
 * unbranded form asking a stranger for their email address.
 */
function BoardMark(): ReactNode {
  return (
    <svg className="join__board" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="23" className="boardbtn__frame" />
      <circle cx="24" cy="24" r="20" className="boardbtn__surface" />
      <circle cx="24" cy="24" r="13.5" className="boardbtn__ring" />
      <circle cx="24" cy="24" r="7" className="boardbtn__ring" />
      <path
        d="M33.5 14.5 L38.6 9.4 M14.5 14.5 L9.4 9.4 M33.5 33.5 L38.6 38.6 M14.5 33.5 L9.4 38.6"
        className="boardbtn__ring"
      />
      <circle cx="24" cy="24" r="2.6" className="boardbtn__hole" />
    </svg>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Commit-phase notification, so side effects (clearing the code) are legal. */
  onError: (error: unknown) => void;
  /** What to show instead of the children. Called during render — keep it pure. */
  fallback: (error: unknown) => ReactNode;
}

/**
 * A plain class boundary — there is still no hook that can catch a render throw.
 *
 * Deliberately a second copy of the one in `PasscodeGate.tsx` rather than a
 * shared export: that one is part of the gate, this route renders *beside* the
 * gate, and hoisting it would mean editing a file this change does not own. The
 * two are small and identical; merge them when the gate is deleted with the rest
 * of the passphrase interim (§7.1).
 */
class JoinBoundary extends Component<BoundaryProps, { hasError: boolean; error: unknown }> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown): { hasError: boolean; error: unknown } {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The only place the real stack survives — the screen deliberately shows a
    // short message instead.
    console.error("Render failed on the join screen", error, info.componentStack);
    this.props.onError(error);
  }

  override render(): ReactNode {
    if (this.state.hasError) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

/** Anything that isn't an auth failure. The code is left alone — it was fine. */
function CrashStep({ error }: { error: unknown }): ReactNode {
  return (
    <div className="join__form">
      <div className="join__head">
        <h1 className="join__title">That didn't load.</h1>
        <p className="faint join__sub">Sorry. Try again — nothing has been lost.</p>
      </div>
      <p className="issue issue--error" role="alert">
        {errorMessage(error)}
      </p>
      <button
        type="button"
        className="btn btn--block btn--lg"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}

/**
 * Step 1 — the code, for someone who typed the URL rather than scanning.
 *
 * Skipped entirely when a code is already in context, which is the QR case and
 * the in-app case both.
 *
 * Validation is one imperative `players.byEmail` with an empty address:
 * `assertAllowlisted` runs before anything else in that handler, so the call
 * proves the code and reads nothing. Deliberately **not** a `useQuery` — a
 * refused subscription throws during render, and a render throw here is
 * answered by clearing the stored code, which on a wrong guess would throw away
 * the good code the rest of the app is running on. Nothing is stored until the
 * server has accepted it.
 */
function CodeStep({
  error: refusal,
  onAccepted,
}: {
  /** Shown when a code that arrived from outside has just been refused. */
  error?: string | null;
  onAccepted: () => void;
}): ReactNode {
  const convex = useConvex();
  const { setCode } = usePasscode();
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const shown = error ?? refusal ?? null;

  async function check(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (trimmed === "" || checking) return;
    setError(null);
    setChecking(true);
    try {
      await convex.query(api.players.byEmail, { passcode: trimmed, email: "" });
      setCode(trimmed);
      onAccepted();
    } catch (caught) {
      setError(isBadPasscodeError(caught) ? REFUSED : errorMessage(caught));
    } finally {
      setChecking(false);
    }
  }

  return (
    <form className="join__form" noValidate onSubmit={(event) => void check(event)}>
      <div className="join__head">
        <h1 className="join__title">Crokinole</h1>
        <p className="faint join__sub">
          Enter the code you were given, then add yourself to tonight.
        </p>
      </div>

      <div className="join__group">
        <label className="join__label" htmlFor="join-code">
          Code
        </label>
        <input
          id="join-code"
          className="field join__code"
          type="text"
          inputMode="text"
          // Not literally a one-time code, but it is the hint that makes iOS and
          // Android offer the one in the message it arrived in.
          autoComplete="one-time-code"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>

      {shown ? (
        <p className="issue issue--error" role="alert">
          {shown}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn--accent btn--block btn--lg"
        disabled={trimmed === "" || checking}
      >
        {checking ? "Checking…" : "Use this code"}
      </button>
    </form>
  );
}

/** What the form needs of a player, flattened out of the Convex document. */
interface Known {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string | null;
}

function JoinForm(): ReactNode {
  // Guaranteed non-null: `JoinForm` only renders on the branch where the code is
  // already in context.
  const passcode = useRequiredPasscode();
  const navigate = useNavigate();

  /*
   * Straight to Convex rather than through `data/store.tsx`, because the store
   * is below the gate and this is above it. Inactive players are included on
   * purpose: a retired regular's nickname is still taken, and still their name
   * in every game they played — suggesting it again to someone new would put two
   * of them in the history.
   */
  const playerDocs = useQuery(api.players.list, { passcode, includeInactive: true });
  const selfJoinMutation = useMutation(api.players.selfJoin);

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  /** Once they've typed one it's theirs, and the suggestion stops overwriting it. */
  const [nicknameChosen, setNicknameChosen] = useState(false);
  /** Whose row the form was last filled in from, so a match applies exactly once. */
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  /** The address the lookup is actually subscribed to — debounced, see below. */
  const [lookupEmail, setLookupEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ nickname: string; created: boolean } | null>(null);

  const trimmedEmail = email.trim().toLowerCase();
  const emailValid = looksLikeEmail(trimmedEmail);

  // Debounced, and only for something that could be an address at all: each
  // distinct value is a round trip, and a half-typed address matches nobody.
  useEffect(() => {
    const next = emailValid ? trimmedEmail : "";
    if (next === lookupEmail) return;
    const timer = window.setTimeout(() => setLookupEmail(next), LOOKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [emailValid, trimmedEmail, lookupEmail]);

  // `"skip"` holds the hook slot without opening a subscription, the same trick
  // `store.tsx` uses for the admin-only member list.
  const found = useQuery(
    api.players.byEmail,
    lookupEmail === "" ? "skip" : { passcode, email: lookupEmail },
  );

  const players = useMemo<Known[]>(
    () =>
      (playerDocs ?? []).map((doc) => ({
        id: doc._id,
        // The nickname is the display name — see `Player` in `data/types.ts`.
        displayName: doc.nickname,
        firstName: doc.firstName,
        lastName: doc.lastName ?? null,
      })),
    [playerDocs],
  );

  useEffect(() => {
    // Skipped, or still in flight. Either way there is nothing to apply, and
    // wiping the form on `undefined` would empty it on every keystroke.
    if (found === undefined) return;

    if (found === null) {
      /*
       * A definite "nobody has this address". If the form is still holding the
       * person a *previous* address matched, it has to let go of them:
       * otherwise correcting a mistyped email leaves someone else's name in the
       * fields and creates a brand new player wearing it.
       */
      if (filledFrom === null) return;
      setFirstName("");
      setLastName("");
      setNickname("");
      setNicknameChosen(false);
      setFilledFrom(null);
      return;
    }

    if (found.playerId === filledFrom) return;
    setFirstName(found.firstName);
    setLastName(found.lastName ?? "");
    setNickname(found.nickname);
    // An existing nickname is one they already answer to. Treating it as chosen
    // stops the suggestion walking a returning player's name to something new.
    setNicknameChosen(true);
    setFilledFrom(found.playerId);
  }, [found, filledFrom]);

  /**
   * Everyone else's nickname.
   *
   * The matched player's own is left out: it is not a collision with itself,
   * and counting it would suggest "Matt 2" to the Matt who is already Matt.
   * `players.selfJoin` filters their row out server-side for the same reason,
   * and the two answers have to agree or the form shows a name the write won't
   * use.
   */
  const taken = useMemo(
    () =>
      players.filter((player) => player.id !== filledFrom).map((player) => player.displayName),
    [players, filledFrom],
  );

  // The rule lives in core (§3.2.2) — the server calls the same function when a
  // caller sends no nickname, so a second implementation here would drift and
  // the symptom would be a person who looks like a duplicate.
  const suggestion = useMemo(
    () =>
      firstName.trim() === ""
        ? ""
        : defaultNickname(firstName, lastName.trim() || undefined, taken),
    [firstName, lastName, taken],
  );

  const nicknameValue = nicknameChosen ? nickname : suggestion;

  /**
   * True once the lookup has answered for exactly the address on screen **and**
   * the roster has arrived.
   *
   * ⚠️ The roster half is load-bearing twice over. `taken` and `nameClash` are
   * both derived from `players`, which flattens a still-loading `undefined` into
   * an empty array — so unlocking the fields a moment early suggests a nickname
   * that collides with someone, and shows no clash warning when there is one.
   * Both look like settled answers rather than a load window. Same class of bug
   * as `isLoading` on the standings, and like that one it only ever appears on a
   * cold load over a real network.
   */
  const settled =
    emailValid &&
    lookupEmail === trimmedEmail &&
    found !== undefined &&
    playerDocs !== undefined;

  /*
   * ⚠️ `settled` is in here, not just the field values.
   *
   * Editing a matched address into a *different* valid one leaves the previous
   * person's name in the fields for the debounce plus a round trip, with the
   * email already valid. Without this, a submit landing in that window writes
   * the old name against the new address — a brand new player wearing someone
   * else's name, which is the exact fork this whole screen exists to prevent.
   */
  const canSubmit =
    settled && firstName.trim() !== "" && nicknameValue.trim() !== "" && !saving;

  /**
   * Someone of this name is already here, but not under this address.
   *
   * ⚠️ The duplicate protection in this form keys on **email**, and every
   * player carried over from before tonight has none — they were added by an
   * admin, which is exactly the case §3.6 exists for. So the first time a
   * regular joins with their own address, nothing matches and they become a
   * *second* row: a fresh Kinsey with no games beside the Kinsey who owns the
   * 5 August night. That is precisely the fork this flow was built to prevent,
   * and it is most likely to happen on the very first night it is used.
   *
   * Matching on name and stopping is not the answer either — two people can
   * genuinely share a first name, and silently adopting the wrong row would
   * hand someone else's money to a stranger. So this warns and leaves the
   * decision with a human, which is the only safe move when the match is a
   * guess.
   */
  const nameClash = useMemo(() => {
    if (!settled || found) return null;
    const first = canon(firstName);
    if (first === "") return null;
    return (
      players.find(
        (player) =>
          canon(player.firstName) === first &&
          (lastName.trim() === "" || canon(player.lastName ?? "") === canon(lastName)),
      ) ?? null
    );
  }, [settled, found, firstName, lastName, players]);

  const reset = useCallback((): void => {
    setEmail("");
    setFirstName("");
    setLastName("");
    setNickname("");
    setNicknameChosen(false);
    setFilledFrom(null);
    setLookupEmail("");
    setError(null);
    setDone(null);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    const chosen = nicknameValue.trim();
    try {
      const result = await selfJoinMutation({
        passcode,
        email: trimmedEmail,
        firstName: firstName.trim(),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        nickname: chosen,
      });
      setDone({ nickname: chosen, created: result.created });
    } catch (caught) {
      // Awaited rather than fired and forgotten, unlike every other write in
      // this app, and this is why: a refusal has to land on screen. Left to the
      // console it would leave someone standing at the table believing they are
      // in the game.
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="join__done">
        {/* No board mark here — `JoinScreen`'s shell already draws one above
            every step, and a second would stack two of them. */}
        {/* On the paragraph rather than the wrapper: a live region holding the
            buttons too would have the whole ending read back on every focus. */}
        <p className="join__done-name" role="status">
          {done.created ? `You're in, ${done.nickname}.` : `Welcome back, ${done.nickname}.`}
        </p>
        <p className="faint join__done-note">
          {done.created
            ? "Tap your name on the standings to mark yourself here for tonight."
            : "Same player as before, so every game you've played still counts."}
        </p>
        <div className="join__actions">
          {/*
            Into the app, not back to a dead screen. Whoever finished this form
            now holds a code the gate will accept — which was the other half of
            what the code step was for — so the standings are theirs to see.
          */}
          <button
            type="button"
            className="btn btn--accent btn--block btn--lg"
            onClick={() => navigate(AFTER_JOIN, { replace: true })}
          >
            Go to the standings
          </button>
          {/* The phone gets handed round a table. Still the common case. */}
          <button type="button" className="btn btn--ghost btn--block" onClick={reset}>
            Add someone else
          </button>
        </div>
      </div>
    );
  }

  const note = !emailValid
    ? "Your email first — if you've played here before, the rest fills itself in."
    : !settled
      ? "Checking…"
      : found
        ? "Welcome back — filled in from last time. Change anything that's wrong."
        : "New here. Fill these in and you're set.";

  return (
    <form className="join__form" noValidate onSubmit={(event) => void submit(event)}>
      <div className="join__head">
        <h1 className="join__title">Add a player</h1>
        <p className="faint join__sub">Hand the phone over — this is theirs to fill in.</p>
      </div>

      {/*
        Email first, and the rest of the form waits on it. The order is the
        whole point: an address that already exists fills the names in, so
        asking for the names first would mean typing something that is about to
        be overwritten — or worse, keeping it and creating a second copy of a
        person who is already here.
      */}
      <div className="join__group">
        <label className="join__label" htmlFor="join-email">
          Email
        </label>
        <input
          id="join-email"
          className="field"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby="join-email-hint"
        />
        <p className="faint join__hint" id="join-email-hint">
          Needed here — it's what keeps a returning player one person instead of two.
        </p>
      </div>

      {/* One live region for the whole lookup, sitting between the email and the
          fields it governs — which is where the answer to "why can't I type in
          these?" has to be. */}
      <p className="faint join__note" role="status">
        {note}
      </p>

      {nameClash ? (
        <p className="join__warn" role="alert">
          <strong>{nameClash.displayName}</strong> is already here, with no email on file.
          If that's you, stop — ask an admin to put this address on that name instead.
          Carrying on makes a second you, and your games won't follow.
        </p>
      ) : null}

      {/*
        Visible from the start and disabled until the email resolves. `disabled`
        rather than `readonly` on purpose: these are genuinely not editable yet,
        and the greyed treatment is the whole signal that the email above is what
        unlocks them.
      */}
      <div className={groupClass(settled)}>
        <label className="join__label" htmlFor="join-first">
          First name
        </label>
        <input
          id="join-first"
          className="field"
          type="text"
          autoComplete="given-name"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          // The server normalises to the same cap; truncating here means the
          // field shows what will actually be stored.
          maxLength={MAX_NAME_LENGTH}
          disabled={!settled}
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
        />
      </div>

      <div className={groupClass(settled)}>
        <label className="join__label" htmlFor="join-last">
          Last name <span className="join__optional">optional</span>
        </label>
        <input
          id="join-last"
          className="field"
          type="text"
          autoComplete="family-name"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_NAME_LENGTH}
          disabled={!settled}
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
        />
      </div>

      <div className={groupClass(settled)}>
        <label className="join__label" htmlFor="join-nickname">
          Nickname
        </label>
        <input
          id="join-nickname"
          className="field"
          type="text"
          autoComplete="nickname"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_NAME_LENGTH}
          disabled={!settled}
          placeholder={suggestion}
          value={nicknameValue}
          onChange={(event) => {
            setNicknameChosen(true);
            setNickname(event.target.value);
          }}
          // Emptying the field would otherwise be a dead end — the suggestion is
          // gone and Continue is disabled with nothing saying why. Leaving it
          // blank hands it back.
          onBlur={() => {
            if (nickname.trim() === "") setNicknameChosen(false);
          }}
          aria-describedby="join-nickname-hint"
        />
        <p className="faint join__hint" id="join-nickname-hint">
          What everyone sees — standings, score card, history. Up to {MAX_NAME_LENGTH}{" "}
          characters.
        </p>
      </div>

      {error ? (
        <p className="issue issue--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="join__actions">
        <button
          type="submit"
          className="btn btn--accent btn--block btn--lg"
          disabled={!canSubmit}
        >
          {saving ? "Adding…" : "Continue"}
        </button>
        {/*
          There is no tab bar on this route — it renders beside the app, not
          inside it — so without this the only way out is the back button, and a
          QR joiner has nothing behind them to go back to.
        */}
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => navigate(AFTER_JOIN, { replace: true })}
        >
          Skip for now
        </button>
      </div>
    </form>
  );
}

/** Case- and space-insensitive, for comparing names a person typed. */
function canon(value: string): string {
  return value.trim().toLowerCase();
}

function groupClass(enabled: boolean): string {
  return enabled ? "join__group" : "join__group join__group--waiting";
}
