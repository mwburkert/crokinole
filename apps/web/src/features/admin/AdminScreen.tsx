import { defaultNickname, MAX_NAME_LENGTH } from "@crokinole/core";
import { useQuery } from "convex/react";
import { useMemo, useState, type ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import { errorMessage } from "../../data/errors";
import { useRequiredPasscode } from "../../data/passcode";
import { useStore } from "../../data/store";
import type { Member, Role } from "../../data/types";
import { Badge, Card, Empty, Loading, SegmentedControl } from "../../ui/components";
import "../../ui/admin.css";
import { QrCode } from "./QrCode";

/**
 * Settings.
 *
 * Two things, in this order: **the invite**, then **the people**. The invite is
 * first because it is the errand — someone is standing next to you with a phone
 * out — and the roster is the reference you scroll to. It used to be third,
 * under a prose explainer and the whole player list, which is the wrong end of a
 * 393px screen for the one control you open this tab to use.
 *
 * The "Getting in" explainer that stood above both is gone. It said the invite
 * link carries the code and to treat it like a password; the card that hands out
 * the link is now the first thing on screen and says so where it matters.
 *
 * Admins get the player list; everyone else gets only their own details.
 * Per-player actions live behind a kebab so the list itself stays a scannable
 * column of names — the thing you're actually looking for.
 *
 * **The list is people, not logins.** It used to be built from the allowlist,
 * which meant it read "Nobody yet." while five real players sat in the database
 * with no way to fix a mis-typed name. A person with no login is still a person
 * (§3.6): `admin.listMembers` returns one row per player now, and `email` and
 * `role` are null for anyone who has never been invited.
 *
 * ⚠️ Two lists still: the Cloudflare Access Group decides who can *reach* the
 * app, this allowlist decides what they may *do*. See `convex/admin.ts`.
 */
export function AdminScreen(): ReactNode {
  return (
    <div className="stack">
      <InviteCard />
      <Roster />
      <BuildStamp />
    </div>
  );
}

/**
 * Which build you are actually looking at.
 *
 * ⚠️ Not vanity. Two facts make "I'm looking at it and it's still wrong"
 * unverifiable without this, and both have already cost a round trip:
 *
 *  - **This is a PWA with `registerType: "autoUpdate"`.** A phone keeps serving
 *    the build its service worker already has until the new one installs *and*
 *    the page is reloaded — so a screenshot can honestly show code that was
 *    replaced an hour ago.
 *  - **There are two hosts.** `games.burkert.app` (Cloudflare Workers) and
 *    `<deployment>.convex.site` (Convex static hosting) serve the same app from
 *    separate uploads, and they drift the moment one is deployed without the
 *    other.
 *
 * The commit is what a report can be checked against; the `+` means the tree
 * was dirty when it was built, so the commit alone doesn't describe it. Last
 * thing on the screen and in the quietest type on it — this is for the two
 * minutes a year somebody needs it.
 */
function BuildStamp(): ReactNode {
  return (
    <p className="faint" style={{ margin: 0, textAlign: "center" }}>
      Build {__BUILD_ID__}
      {" "}
      {appOrigin().replace(/^https?:\/\//, "")}
    </p>
  );
}

/**
 * Stricter than the server, which only insists on an `@`.
 *
 * The address is the identity key for a player row from here on, and a typo'd
 * one can't be told apart from a real one — it just quietly becomes a second
 * person the next time they join. The self-join sheet holds the same rule for
 * the same reason; this is the admin's half of it.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value);
}

/**
 * The link that gets four people in — the migration's "a URL the owner can send
 * to four people", made real. First on the screen, and with no heading: a QR
 * code the size of a beer mat does not need a caption telling you it is one.
 *
 * 🕐 It carries a shared code as `?code=`, which `data/passcode.tsx` stores and
 * strips from the URL on load, so scanning it at the table is the whole of
 * getting in. That makes the link a secret. The code used to be revealable as
 * text under a "Show the code" button; that is gone, because the QR is the only
 * form anyone actually used and a code sitting in body text is a code sitting on
 * screen while the phone goes round. When Access lands the link is just the
 * origin again and this card loses the code and the toggle with it.
 *
 * **The toggle needs a code the browser does not have.** An admin's localStorage
 * holds `ADMIN_PASSCODE`; handing out a *player* invite needs `APP_PASSCODE`,
 * which is only knowable server-side. `admin.inviteCodes` returns both, gated on
 * `assertAdmin` — see the justification on that query. A player-tier caller
 * skips the subscription entirely and falls back to the code they are already
 * holding, which is the player code by definition: no toggle, no admin QR, and
 * nothing here throws for them.
 */
function InviteCard(): ReactNode {
  const code = useRequiredPasscode();
  const { isLoading, isAdmin } = useStore();
  // Skipped for a non-admin: `inviteCodes` throws for them, and a throwing
  // `useQuery` takes the whole app down from here. Same trick `store.tsx` uses
  // for the admin-only member list.
  const codes = useQuery(api.admin.inviteCodes, isAdmin ? { passcode: code } : "skip");

  const [tier, setTier] = useState<Role>("player");
  const [copied, setCopied] = useState(false);

  /*
   * ⚠️ Nothing is drawn until we know which code belongs on it.
   *
   * `isAdmin` is false for the first render — `players.me` hasn't answered — and
   * `codes` is undefined for a round trip after that. Falling back to the local
   * code in either window would put the admin's *own* code on a QR sitting under
   * a control reading "Player", and the whole failure of that is silent: the
   * scan works, the person is in, and they are an admin. So the card waits. It
   * costs a beat on a cold load and cannot hand out the wrong invite.
   */
  if (isLoading || (isAdmin && codes === undefined)) {
    return (
      <Card>
        <Loading rows={4} />
      </Card>
    );
  }

  // Null when `ADMIN_PASSCODE` is unset, which is "there is no admin tier" —
  // no second option to offer, so no toggle.
  const adminCode = codes?.admin ?? null;
  const canToggle = codes !== undefined && adminCode !== null;
  const asAdmin = canToggle && tier === "admin";
  const chosen = codes ? (asAdmin && adminCode ? adminCode : codes.player) : code;
  const url = shareUrl(chosen);

  return (
    <Card>
      <div className="invite">
        {canToggle ? (
          <SegmentedControl<Role>
            label="Invite type"
            value={tier}
            // The copied flag has to go with it, or the button keeps claiming a
            // tick over a clipboard holding the other tier's link.
            onChange={(next) => {
              setTier(next);
              setCopied(false);
            }}
            options={[
              { value: "player", label: "Player" },
              { value: "admin", label: "Admin" },
            ]}
          />
        ) : null}

        <div className="invite__qr">
          <QrCode
            // Keyed so the SVG is rebuilt rather than diffed when the toggle
            // flips — the two codes produce different module counts.
            key={url}
            value={url}
            size={170}
            label={canToggle ? `QR code for the ${tier} invite` : "QR code that opens the app"}
          />
        </div>

        {/* The origin, not the link — printing the link would print the code. */}
        <p className="faint invite__origin">{appOrigin()}</p>

        <button
          type="button"
          className="btn btn--accent btn--block"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(inviteText(url, asAdmin ? "admin" : "player"))
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Invite copied ✓" : "Copy invite"}
        </button>

        <p className="faint invite__note">
          {asAdmin
            ? "Hands over the admin code. Whoever scans this can add and remove players — give it out like a key, not a link."
            : "Scanning is the whole of getting in — the link carries the code, so share it like a password."}
        </p>
      </div>
    </Card>
  );
}

function Roster(): ReactNode {
  const { isLoading, membersLoading, members, currentEmail, isAdmin, isSuperAdmin } =
    useStore();
  const [adding, setAdding] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // `players.me` hasn't answered yet, so `isAdmin` is still false. Without this
  // an admin gets a beat of "Nothing to see here." before the screen flips —
  // the same "loading reads as missing" failure the entry screen has.
  //
  // `membersLoading` is the second half of it, and it needs saying: the member
  // list can only be subscribed to *once* `players.me` has answered that you're
  // an admin, so it is still in flight on the very render `isLoading` goes
  // false. Waiting on `isLoading` alone left this screen — the app's roster —
  // announcing "Players — 0 / Nobody yet." over five real people, for a whole
  // round trip, every single visit.
  // Every branch below returns a `.stack`, never a bare `.card`: `app.css` gives
  // `.card + .card` its own margin, which would land on top of the parent
  // stack's gap and space this one card further from the invite card above it.
  if (isLoading || membersLoading) {
    return (
      <div className="stack">
        <Card>
          {/* Five rows because five regulars is what's coming — the list settles
              into place rather than jumping. */}
          <Loading rows={5} />
        </Card>
      </div>
    );
  }

  // 🕐 Under the shared passphrase `currentEmail` is "" and every member's email
  // is null, so this matches nobody — which is right. Matching on "" would make
  // the first person with no email look like the signed-in user.
  const me =
    currentEmail === ""
      ? undefined
      : members.find((member) => member.email === currentEmail);

  if (!isAdmin) {
    return (
      <div className="stack">
        {me ? (
          <SelfSettings member={me} />
        ) : (
          <Card>
            <Empty>Nothing to see here.</Empty>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="spread">
        <h2 className="card__title" style={{ margin: 0 }}>
          Players — {members.length}
        </h2>
        <button
          type="button"
          className="iconbtn"
          aria-label="Add a player"
          onClick={() => setAdding(true)}
        >
          +
        </button>
      </div>

      {/* Above the list, not below it: the sheet is what the `+` just opened,
          and a phone showing five rows before it would need scrolling to find
          the thing that appeared. */}
      {adding ? <AddSheet onClose={() => setAdding(false)} /> : null}

      <Card>
        {members.length === 0 ? (
          <Empty>Nobody yet.</Empty>
        ) : (
          members.map((member) => {
            const key = memberKey(member);
            return (
              <PlayerRow
                key={key}
                member={member}
                locked={
                  // 🕐 Needs two identities to compare, and the shared
                  // passphrase supplies none — so it never locks today. Guarding
                  // on `currentEmail` keeps this in step with `store.tsx` and
                  // `convex/admin.ts`, both of which skip the check when there
                  // is no caller: otherwise the owner would lose the controls
                  // for their own row the moment it gained an address.
                  currentEmail !== "" &&
                  member.email !== null &&
                  isSuperAdmin(member.email) &&
                  !isSuperAdmin(currentEmail)
                }
                isSelf={member.email !== null && member.email === currentEmail}
                open={openMenu === key}
                onToggleMenu={() =>
                  setOpenMenu((current) => (current === key ? null : key))
                }
              />
            );
          })
        )}
      </Card>
    </div>
  );
}

function PlayerRow({
  member,
  locked,
  isSelf,
  open,
  onToggleMenu,
}: {
  member: Member;
  locked: boolean;
  isSelf: boolean;
  open: boolean;
  onToggleMenu: () => void;
}): ReactNode {
  const { setRole, revoke } = useStore();
  const [editing, setEditing] = useState(false);

  /**
   * `setRole` and `revoke` are keyed by email and act on the allowlist entry, so
   * they are meaningless for someone who has none: there is no permission to
   * change and none to take away. The **Admin** badge says the same thing, and a
   * null role never renders it. 🕐 Today that is every row.
   */
  const permission =
    member.email !== null && member.role !== null
      ? { email: member.email, role: member.role }
      : null;

  /** `updateProfile` patches a player document; an allowlist orphan has none. */
  const playerId = member.playerId;

  const label = member.displayName ?? member.email ?? "this row";

  return (
    <div className="prow">
      <div className="prow__main">
        <div className="prow__id">
          <span className="name">{member.displayName ?? member.email}</span>
          <span className="faint">{secondaryLine(member)}</span>
        </div>
        <div className="row" style={{ gap: "0.35rem" }}>
          {member.role === "admin" ? <Badge>Admin</Badge> : null}
          {locked ? null : (
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              aria-label={`Actions for ${label}`}
              aria-expanded={open}
              onClick={onToggleMenu}
            >
              ⋯
            </button>
          )}
        </div>
      </div>

      {open && !locked ? (
        <div className="prow__menu">
          {editing && playerId !== null ? (
            <ProfileForm
              member={member}
              playerId={playerId}
              idPrefix={`row-${playerId}`}
              onDone={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="menu">
              {playerId === null ? null : (
                <button type="button" className="menu__item" onClick={() => setEditing(true)}>
                  Edit details
                </button>
              )}
              {permission ? (
                <button
                  type="button"
                  className="menu__item"
                  disabled={isSelf}
                  onClick={() =>
                    setRole(permission.email, permission.role === "admin" ? "player" : "admin")
                  }
                >
                  {permission.role === "admin" ? "Make player" : "Make admin"}
                </button>
              ) : null}
              {/*
                There was a "Copy invite" here. It is gone, and the reason is
                worth recording: it copied `shareUrl(<the code in this browser>)`,
                which for an admin is the *admin* code — so the per-row button
                quietly handed out admin rights, and it produced the same generic
                text on every row regardless of whose row it was. The invite card
                at the top of this screen is the one place that decides which tier
                a link carries, and it is one tap away.
              */}
              {permission ? (
                <button
                  type="button"
                  className="menu__item menu__item--danger"
                  disabled={isSelf}
                  onClick={() => revoke(permission.email)}
                >
                  Revoke access
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The four fields a person is: first name, last name, nickname, email.
 *
 * One component behind both editors — an admin opening any row, and a regular
 * player opening their own settings — because the fields, the validation and
 * the single `admin.updateProfile` write are identical and the only difference
 * is which row you are allowed to reach. Keeping them as two copies is how the
 * nickname ends up editable in one place and not the other.
 */
function ProfileForm({
  member,
  playerId,
  idPrefix,
  onDone,
  onCancel,
}: {
  member: Member;
  playerId: string;
  /** Field ids have to be unique per row — several of these can be open. */
  idPrefix: string;
  onDone: () => void;
  onCancel?: () => void;
}): ReactNode {
  const { updateProfile } = useStore();
  const [firstName, setFirstName] = useState(member.firstName ?? "");
  const [lastName, setLastName] = useState(member.lastName ?? "");
  const [nickname, setNickname] = useState(member.displayName ?? "");
  const [email, setEmail] = useState(member.email ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedEmail = email.trim().toLowerCase();
  /*
   * Blank is fine — 🕐 every player has no address today, and demanding one
   * before a nickname could be fixed would put an unrelated wall in front of the
   * one edit this screen exists for. An address already on the row is fine too
   * even if it fails the shape test: it was stored under the server's looser
   * "must contain an @" rule, and refusing to save it back would strand that
   * person's row permanently uneditable.
   */
  const emailOk =
    trimmedEmail === "" || looksLikeEmail(trimmedEmail) || trimmedEmail === (member.email ?? "");
  const canSave = firstName.trim() !== "" && nickname.trim() !== "" && emailOk && !saving;

  async function save(): Promise<void> {
    if (!canSave) return;
    setError(null);
    setSaving(true);
    try {
      await updateProfile(playerId, {
        firstName,
        // Always sent, blank included — that is how a surname gets cleared.
        lastName,
        nickname,
        ...(trimmedEmail === "" ? {} : { email: trimmedEmail }),
      });
      setSaved(true);
      onDone();
    } catch (caught) {
      // The refusals here are ones a human has to read — "That account is
      // managed by its owner", "Nicknames are capped at …". Left to the console
      // the editor would just close over an edit that never happened.
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  function touch(apply: () => void): void {
    apply();
    setSaved(false);
    setError(null);
  }

  return (
    <div className="aform">
      <div className="aform__group">
        <label className="aform__label" htmlFor={`${idPrefix}-first`}>
          First name
        </label>
        <input
          id={`${idPrefix}-first`}
          className="field"
          type="text"
          autoComplete="given-name"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_NAME_LENGTH}
          value={firstName}
          onChange={(event) => touch(() => setFirstName(event.target.value))}
        />
      </div>

      <div className="aform__group">
        <label className="aform__label" htmlFor={`${idPrefix}-last`}>
          Last name <span className="aform__optional">optional</span>
        </label>
        <input
          id={`${idPrefix}-last`}
          className="field"
          type="text"
          autoComplete="family-name"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_NAME_LENGTH}
          value={lastName}
          onChange={(event) => touch(() => setLastName(event.target.value))}
        />
      </div>

      <div className="aform__group">
        <label className="aform__label" htmlFor={`${idPrefix}-nickname`}>
          Nickname
        </label>
        <input
          id={`${idPrefix}-nickname`}
          className="field"
          type="text"
          autoComplete="nickname"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_NAME_LENGTH}
          value={nickname}
          onChange={(event) => touch(() => setNickname(event.target.value))}
          aria-describedby={`${idPrefix}-nickname-hint`}
        />
        <p className="faint aform__hint" id={`${idPrefix}-nickname-hint`}>
          What everyone sees — standings, score card, history. Up to {MAX_NAME_LENGTH}{" "}
          characters.
        </p>
      </div>

      <div className="aform__group">
        <label className="aform__label" htmlFor={`${idPrefix}-email`}>
          Email <span className="aform__optional">optional here</span>
        </label>
        <input
          id={`${idPrefix}-email`}
          className="field"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="them@example.com"
          value={email}
          onChange={(event) => touch(() => setEmail(event.target.value))}
        />
      </div>

      {error ? (
        <p className="issue issue--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="aform__actions">
        <button
          type="button"
          className="btn btn--accent btn--block"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn--ghost btn--block" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What sits under the name.
 *
 * A row with no email is a person who exists and can be picked for a game but
 * has never signed in. Saying so is better than an empty line, which reads as a
 * rendering bug, and better than the address-shaped gap it replaces.
 */
function secondaryLine(member: Member): string {
  // 🕐 Every player carried over from before emails were asked for.
  if (member.email === null) return "No email yet";
  // An allowlist entry with nobody behind it — the name slot already shows the
  // address, so repeating it here would say nothing.
  if (member.displayName === null) return "On the list, no player yet";
  return member.email;
}

/**
 * A stable key per row. The player id for a person; the address for an
 * allowlist entry with no player behind it. One of the two is always there.
 */
function memberKey(member: Member): string {
  return member.playerId ?? `allowlist:${member.email ?? ""}`;
}

/**
 * The `+` sheet.
 *
 * **Email is required**, which reverses what this sheet used to be. It took one
 * combined "Name" and hid the address behind an "Add an email too" disclosure,
 * on the reasoning that with no identity provider there is nothing to invite
 * anyone *to*. The address earns its place for a different reason: it is the
 * only field that can tell a returning player from a second copy of them, and a
 * person added without one becomes exactly that the first time they self-join
 * — a fresh row with no games beside the row that holds their money.
 *
 * So every add now goes through `admin.invite`, which writes the allowlist entry
 * and the player row in one transaction. ⚠️ That mutation **throws** when the
 * address is already on the list, and this path used to fire and forget it: the
 * refusal was a console line and a row that silently never appeared, under a
 * sheet that had already closed as though it had worked. It is awaited now and
 * the server's own words go on screen.
 */
function AddSheet({ onClose }: { onClose: () => void }): ReactNode {
  const { addPlayer, players } = useStore();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  /** Once they've typed one it's theirs, and the suggestion stops overwriting it. */
  const [nicknameChosen, setNicknameChosen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("player");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = useMemo(() => players.map((player) => player.displayName), [players]);

  // The rule lives in core (§3.2.2) — `players.resolveNickname` calls the same
  // function server-side when a caller sends no nickname, so a second
  // implementation here would drift and the symptom would be a person who looks
  // like a duplicate of themselves.
  const suggestion = useMemo(
    () =>
      firstName.trim() === ""
        ? ""
        : defaultNickname(firstName, lastName.trim() || undefined, taken),
    [firstName, lastName, taken],
  );
  const nicknameValue = nicknameChosen ? nickname : suggestion;

  const trimmedEmail = email.trim().toLowerCase();
  const canAdd =
    firstName.trim() !== "" &&
    nicknameValue.trim() !== "" &&
    looksLikeEmail(trimmedEmail) &&
    !saving;

  async function add(): Promise<void> {
    if (!canAdd) return;
    setError(null);
    setSaving(true);
    try {
      await addPlayer({
        email: trimmedEmail,
        firstName: firstName.trim(),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        nickname: nicknameValue.trim(),
        role,
      });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Add someone">
      <div className="aform">
        <div className="aform__group">
          <label className="aform__label" htmlFor="add-first">
            First name
          </label>
          <input
            id="add-first"
            className="field"
            type="text"
            autoComplete="given-name"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_NAME_LENGTH}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            autoFocus
          />
        </div>

        <div className="aform__group">
          <label className="aform__label" htmlFor="add-last">
            Last name <span className="aform__optional">optional</span>
          </label>
          <input
            id="add-last"
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

        <div className="aform__group">
          <label className="aform__label" htmlFor="add-nickname">
            Nickname
          </label>
          <input
            id="add-nickname"
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
            // is gone and Add is disabled with nothing saying why. Leaving it
            // blank hands it back.
            onBlur={() => {
              if (nickname.trim() === "") setNicknameChosen(false);
            }}
            aria-describedby="add-nickname-hint"
          />
          <p className="faint aform__hint" id="add-nickname-hint">
            Filled in from the first name, plus a last initial if that's taken.
          </p>
        </div>

        <div className="aform__group">
          <label className="aform__label" htmlFor="add-email">
            Email
          </label>
          <input
            id="add-email"
            className="field"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="them@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby="add-email-hint"
          />
          <p className="faint aform__hint" id="add-email-hint">
            Needed — it's what keeps a returning player one person instead of two.
          </p>
        </div>

        <div className="aform__group">
          {/* A `span`, not a `label`: the control below is a group of buttons,
              and a `label` has nothing to point `htmlFor` at. Its own
              `aria-label` carries the name for a screen reader. */}
          <span className="aform__label">Role</span>
          <SegmentedControl<Role>
            label="Role"
            value={role}
            onChange={setRole}
            options={[
              { value: "player", label: "Player" },
              { value: "admin", label: "Admin" },
            ]}
          />
        </div>

        {error ? (
          <p className="issue issue--error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="aform__actions">
          <button
            type="button"
            className="btn btn--accent btn--block"
            disabled={!canAdd}
            onClick={() => void add()}
          >
            {saving ? "Adding…" : "Add player"}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            Cancel
          </button>
        </div>

        <p className="faint aform__hint">
          ⚠️ Sending the email isn't wired up yet — it needs a mail provider and a verified
          sending domain. For now this adds them and you share the invite yourself.
        </p>
      </div>
    </Card>
  );
}

/**
 * A regular player's whole settings screen — the same four fields an admin gets
 * on any row, on the one row that is theirs.
 *
 * 🕐 Unreachable while one shared code makes everyone an admin. Kept because it
 * is reachable again the moment roles mean something, and because
 * `admin.updateProfile` enforces the "you can only edit your own details" rule
 * server-side either way.
 */
function SelfSettings({ member }: { member: Member }): ReactNode {
  const playerId = member.playerId;

  return (
    <Card title="Your details">
      {playerId === null ? (
        <Empty>Nothing to see here.</Empty>
      ) : (
        <ProfileForm
          member={member}
          playerId={playerId}
          idPrefix="self"
          onDone={() => {
            /* Nothing to close — this form is the screen. */
          }}
        />
      )}
    </Card>
  );
}

function appOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/**
 * 🕐 The onboarding URL: `/join` with the shared code attached.
 *
 * It used to point at `/?code=`, which landed a scanner on the standings — a
 * screen full of other people's numbers, with nothing saying what to do next.
 * `/join` sits above the passcode gate and is the screen that asks who they are,
 * so a scan now lands on the one question the scan was for.
 * `consumeCodeFromUrl` stores the code and strips the param before the first
 * render, so the gate is never seen. Goes back to being the bare origin when
 * Access lands.
 */
function shareUrl(code: string): string {
  return `${appOrigin()}/join?code=${encodeURIComponent(code)}`;
}

function inviteText(url: string, tier: Role): string {
  if (tier === "admin") {
    return (
      `You're running crokinole. Open ${url} on your phone — the link carries the admin ` +
      `code, so it can add and remove players. Keep it to yourself. Add it to your home ` +
      `screen and it works like an app.`
    );
  }
  return (
    `You're in for crokinole. Open ${url} on your phone — the link carries the code, ` +
    `so keep it like a password. Add it to your home screen and it works like an app.`
  );
}
