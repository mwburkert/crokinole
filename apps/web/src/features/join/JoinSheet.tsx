/**
 * Add yourself (§3.6).
 *
 * The admin's `+` sheet takes a name and nothing else, which is right when one
 * person is typing in four regulars they already know. This is the other case:
 * a fifth person turns up, the phone gets handed over, and they fill in their
 * own details — including how they actually spell their surname.
 *
 * **Email comes first and is required here**, deliberately unlike the admin
 * path. It is the only thing that can tell a returning player from a new one:
 * `players.selfJoin` patches the row that already holds that address instead of
 * inserting a second one, so a rejoin keeps every game — and every pound —
 * hanging off the same id. The lookup above the form is that same fact shown
 * early rather than after the write: it fills the form in from the row we
 * already have, so nobody types a second spelling of themselves and then
 * wonders why their winnings halved.
 *
 * An overlay rather than a route because it is a short errand off the
 * standings: finishing it should put you back on the list you were reading, not
 * on a screen you now have to navigate away from. It borrows `.overlay` /
 * `.overlay__sheet` from the round-entry scoreboard so there is one modal in
 * this app rather than two that drift apart.
 */

import { defaultNickname, MAX_NAME_LENGTH } from "@crokinole/core";
import { useConvex, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { api } from "../../../../../convex/_generated/api";
import { errorMessage, isBadPasscodeError } from "../../data/errors";
import { usePasscode, useRequiredPasscode } from "../../data/passcode";
import { useStore } from "../../data/store";
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

export function JoinSheet({ onClose }: { onClose: () => void }): ReactNode {
  const { code } = usePasscode();
  /**
   * True only when the code was typed into *this* sheet. It is what decides
   * whether step 1 is on screen at all: a code that was already there arrived
   * with the invite link, and making someone re-read it would be asking them to
   * confirm something they never entered.
   */
  const [enteredHere, setEnteredHere] = useState(false);

  // Escape closes it. The sheet is a modal errand and that is the first thing a
  // desktop hand reaches for, before hunting for the button.
  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-title"
      onMouseDown={(event) => {
        // Only a press that starts on the backdrop itself. Using the click event
        // would let a drag that began inside the sheet dismiss it on release.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="overlay__sheet">
        <div className="join__head">
          <div>
            <h2 className="join__title" id="join-title">
              Add a player
            </h2>
            <p className="faint join__sub">Hand the phone over — this is theirs to fill in.</p>
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {code === null ? (
          <CodeStep onAccepted={() => setEnteredHere(true)} />
        ) : (
          <>
            {enteredHere ? <LockedCode code={code} /> : null}
            <JoinForm onClose={onClose} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Step 1, for a mount that has no code yet.
 *
 * 🕐 Not reached from the standings: everything below `<PasscodeGate>` already
 * holds a code, which *is* the "arrived via an invite link" case — the code is
 * hidden and the form starts at the email, which is what the spec asks for.
 * This branch is what the sheet does if it is ever mounted above the gate, and
 * it is why the code still lives in `data/passcode.tsx` rather than being
 * re-entered and re-stored here.
 *
 * Validation is one imperative `players.byEmail` with an empty address:
 * `assertAllowlisted` runs before anything else in that handler, so the call
 * proves the code and reads nothing. Deliberately **not** a `useQuery` — a
 * refused subscription throws during render, and the gate's error boundary
 * answers a render throw by clearing the stored code, which on a wrong guess
 * here would throw away the good code the rest of the app is running on.
 */
function CodeStep({ onAccepted }: { onAccepted: () => void }): ReactNode {
  const convex = useConvex();
  const { setCode } = usePasscode();
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();

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
      setError(
        isBadPasscodeError(caught) ? "That code didn't work. Try again." : errorMessage(caught),
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <form className="join__form" noValidate onSubmit={(event) => void check(event)}>
      <div className="join__group">
        <label className="join__label" htmlFor="join-code">
          Code
        </label>
        <input
          id="join-code"
          className="field"
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

      {error ? (
        <p className="issue issue--error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn--accent btn--block"
        disabled={trimmed === "" || checking}
      >
        {checking ? "Checking…" : "Use this code"}
      </button>
    </form>
  );
}

/** The accepted code: greyed out and uneditable, but still readable. */
function LockedCode({ code }: { code: string }): ReactNode {
  return (
    <div className="join__group join__group--locked">
      <label className="join__label" htmlFor="join-code-locked">
        Code
      </label>
      <input
        id="join-code-locked"
        className="field join__field--locked"
        value={code}
        readOnly
        aria-readonly="true"
      />
    </div>
  );
}

function JoinForm({ onClose }: { onClose: () => void }): ReactNode {
  const passcode = useRequiredPasscode();
  const { players, selfJoin } = useStore();

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
  const canSubmit =
    emailValid && firstName.trim() !== "" && nicknameValue.trim() !== "" && !saving;

  /** True once the lookup has answered for exactly the address on screen. */
  const settled = emailValid && lookupEmail === trimmedEmail && found !== undefined;

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
  const canon = (value: string): string => value.trim().toLowerCase();
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
      const result = await selfJoin({
        email: trimmedEmail,
        firstName: firstName.trim(),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        nickname: chosen,
      });
      setDone({ nickname: chosen, created: result.created });
    } catch (caught) {
      // `selfJoin` is the one write in the seam that is awaited rather than
      // fired and forgotten, and this is why: a refusal has to land on screen.
      // Left to the console it would leave someone standing at the table
      // believing they are in the game.
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="join__done">
        {/* On the paragraph rather than the wrapper: a live region holding the
            buttons too would have the whole ending read back on every focus. */}
        <p className="join__done-name" role="status">
          {done.created ? `You're in, ${done.nickname}.` : `Welcome back, ${done.nickname}.`}
        </p>
        <p className="faint join__done-note">
          {done.created
            ? "Tap the name on the standings to mark them here for tonight."
            : "Same player as before, so every game they've played still counts."}
        </p>
        <div className="join__actions">
          <button type="button" className="btn btn--accent btn--block" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={reset}>
            Add someone else
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="join__form" noValidate onSubmit={(event) => void submit(event)}>
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

      {emailValid && !settled ? (
        <p className="faint join__hint" role="status">
          Checking…
        </p>
      ) : null}

      {settled ? (
        <>
          {found ? (
            <p className="faint join__hint" role="status">
              Welcome back — filled in from last time. Change anything that's wrong.
            </p>
          ) : null}

          {nameClash ? (
            <p className="join__warn" role="alert">
              <strong>{nameClash.displayName}</strong> is already here, with no email on
              file. If that's you, stop — ask an admin to put this address on that name
              instead. Carrying on makes a second you, and your games won't follow.
            </p>
          ) : null}

          <div className="join__group">
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
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </div>

          <div className="join__group">
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
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </div>

          <div className="join__group">
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
              placeholder={suggestion}
              value={nicknameValue}
              onChange={(event) => {
                setNicknameChosen(true);
                setNickname(event.target.value);
              }}
              // Emptying the field would otherwise be a dead end — the suggestion
              // is gone and Continue is disabled with nothing saying why. Leaving
              // it blank hands it back.
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
        </>
      ) : null}

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
        <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
