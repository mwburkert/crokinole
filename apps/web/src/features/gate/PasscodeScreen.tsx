/**
 * ⚠️ TEMPORARY — the shared-passphrase interim's only screen. It is deleted
 * along with `data/passcode.tsx` when Cloudflare Access lands (§7.1), because
 * Access asks for the identity itself and the app never sees a form.
 *
 * Phone-first like everything else: one field, one button, both a thumb's
 * height, centred so it works held one-handed at a board.
 */

import { useState, type FormEvent, type ReactNode } from "react";

/** The tab bar's board glyph, at a size that can carry a screen on its own. */
function BoardMark(): ReactNode {
  return (
    <svg className="gate__board" viewBox="0 0 48 48" aria-hidden="true">
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

export function PasscodeScreen({
  error,
  onSubmit,
}: {
  /** Shown above the hint when a code has just been refused. */
  error?: string | null;
  onSubmit: (code: string) => void;
}): ReactNode {
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (trimmed === "") return;
    onSubmit(trimmed);
  }

  return (
    <div className="gate">
      <div className="gate__inner">
        <BoardMark />
        <h1 className="gate__title">Crokinole</h1>

        {/*
          A real <form>, so the phone keyboard offers Go rather than a newline —
          the whole interaction is one field and one tap.
        */}
        <form className="gate__form" onSubmit={handleSubmit}>
          <label className="gate__label" htmlFor="passcode">
            Code
          </label>
          <input
            id="passcode"
            name="passcode"
            className="field gate__input"
            type="text"
            inputMode="text"
            // Not a real one-time code, but it is the hint that makes iOS and
            // Android offer the code from the message it arrived in.
            autoComplete="one-time-code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            // The only field on the only screen — there is nothing for focus to
            // steal from.
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-describedby="passcode-hint"
          />
          <button
            type="submit"
            className="btn btn--primary btn--block btn--lg"
            disabled={trimmed === ""}
          >
            Let me in
          </button>
        </form>

        {error ? (
          <p className="issue issue--error gate__error" role="alert">
            {error}
          </p>
        ) : null}

        <p className="faint gate__hint" id="passcode-hint">
          Ask whoever set up the night for the code.
        </p>
      </div>
    </div>
  );
}
