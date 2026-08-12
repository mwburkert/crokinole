import { MAX_NAME_LENGTH } from "@crokinole/core";
import { useState, type ReactNode } from "react";

import { useRequiredPasscode } from "../../data/passcode";
import { useStore } from "../../data/store";
import type { Member, Role } from "../../data/types";
import { Badge, Card, Empty, Loading } from "../../ui/components";
import { QrCode } from "./QrCode";

/**
 * Settings.
 *
 * Admins get the player list; everyone else gets only their own name and email.
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
  if (isLoading || membersLoading) {
    return (
      <Card>
        {/* Five rows because five regulars is what's coming — the list settles
            into place rather than jumping. */}
        <Loading rows={5} />
      </Card>
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
    return me ? <SelfSettings member={me} /> : <Card><Empty>Nothing to see here.</Empty></Card>;
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

      {/* 🕐 True only while one shared code is the whole of auth. Delete with it. */}
      <p className="faint" style={{ margin: 0 }}>
        Nobody signs in yet — everyone shares one code. A name is all it takes to be picked
        for a game.
      </p>

      {adding ? <AddSheet onClose={() => setAdding(false)} /> : null}

      <ShareCard />
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
  const { setRole, revoke, updateProfile } = useStore();
  const code = useRequiredPasscode();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.displayName ?? "");
  const [email, setEmail] = useState(member.email ?? "");
  const [copied, setCopied] = useState(false);

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
  const trimmedEmail = email.trim();
  // A half-typed address is refused server-side, where the failure is a console
  // line and a row that silently never changes. Refuse it here instead.
  const canSave = name.trim() !== "" && (trimmedEmail === "" || trimmedEmail.includes("@"));

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
            <div className="stack" style={{ gap: "0.5rem" }}>
              <input
                className="field"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)}
                aria-label="Name"
              />
              {/* Empty for everyone today. Filling it in is how somebody
                  graduates to a login once there is one to graduate to. */}
              <input
                className="field"
                value={email}
                placeholder="Add an email (optional)"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(event) => setEmail(event.target.value)}
                aria-label="Email"
              />
              <div className="row">
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={!canSave}
                  onClick={() => {
                    updateProfile(playerId, { displayName: name, email });
                    setEditing(false);
                  }}
                >
                  Save
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="menu">
              {playerId === null ? null : (
                <button type="button" className="menu__item" onClick={() => setEditing(true)}>
                  Edit name &amp; email
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
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(inviteText(shareUrl(code)))
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? "Invite copied ✓" : "Copy invite"}
              </button>
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
 * What sits under the name.
 *
 * A row with no email is a person who exists and can be picked for a game but
 * has never signed in. Saying so is better than an empty line, which reads as a
 * rendering bug, and better than the address-shaped gap it replaces.
 */
function secondaryLine(member: Member): string {
  // 🕐 Every player today.
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
 * **A name alone is enough** — that is the common case and today the only one.
 * With no identity provider there is nothing to invite someone *to*, so the
 * email and the role are extras behind a disclosure rather than a wall in front
 * of adding the five people who already play.
 */
function AddSheet({ onClose }: { onClose: () => void }): ReactNode {
  const { addPlayer } = useStore();
  const [withEmail, setWithEmail] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("player");

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const hasEmail = trimmedEmail !== "";
  // Optional, but not half-typed: `admin.invite` refuses an address with no @,
  // and the whole add would be lost to a console line.
  const canAdd = trimmedName !== "" && (!hasEmail || trimmedEmail.includes("@"));

  return (
    <Card title="Add someone">
      <div className="stack" style={{ gap: "0.5rem" }}>
        <input
          className="field"
          placeholder="Name"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
          aria-label="Name"
          autoFocus
        />

        {withEmail ? (
          <>
            <input
              className="field"
              placeholder="email@example.com"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-label="Email"
            />
            <div className="segmented" role="group" aria-label="Role">
              {(["player", "admin"] as Role[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="segmented__option"
                  aria-pressed={role === option}
                  onClick={() => setRole(option)}
                >
                  {option === "player" ? "Player" : "Admin"}
                </button>
              ))}
            </div>
          </>
        ) : (
          <button type="button" className="btn btn--block" onClick={() => setWithEmail(true)}>
            Add an email too
          </button>
        )}

        <button
          type="button"
          className="btn btn--accent btn--block"
          disabled={!canAdd}
          onClick={() => {
            // The role only means something alongside an address — it is the
            // allowlist entry's column, and no address means no entry.
            addPlayer({
              displayName: trimmedName,
              ...(hasEmail ? { email: trimmedEmail, role } : {}),
            });
            onClose();
          }}
        >
          {hasEmail ? "Add & send invite" : "Add player"}
        </button>

        {/* Only worth saying once there is an address to send nothing to. */}
        {hasEmail ? (
          <p className="faint" style={{ margin: 0 }}>
            ⚠️ Sending the email isn't wired up yet — it needs a mail provider and a verified
            sending domain. For now this adds them and you share the link yourself.
          </p>
        ) : null}

        <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
          Done
        </button>
      </div>
    </Card>
  );
}

/**
 * The link that gets four people in — the migration's "a URL the owner can send
 * to four people", made real.
 *
 * 🕐 It carries the shared code as `?code=`, which `data/passcode.tsx` stores
 * and strips from the URL on load, so scanning the QR at the table is the whole
 * of getting in. That makes the link a secret: the code is never body text, only
 * behind a deliberate tap, so it isn't sitting on screen while the phone goes
 * round. When Access lands the link is just the origin again and this card
 * loses the code, the reveal and the warning.
 */
function ShareCard(): ReactNode {
  const code = useRequiredPasscode();
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <Card title="Let someone in">
      <div style={{ display: "flex", justifyContent: "center", padding: "0.25rem 0 0.75rem" }}>
        <QrCode value={shareUrl(code)} size={170} label="QR code that opens the app" />
      </div>
      {/* The origin, not the link — printing the link would print the code. */}
      <p className="faint" style={{ textAlign: "center", margin: "0 0 0.5rem" }}>
        {appOrigin()}
      </p>
      <p className="faint" style={{ marginTop: 0 }}>
        The link carries the code. Share it like a password — anyone holding it is in.
      </p>
      <div className="stack" style={{ gap: "0.5rem" }}>
        <button
          type="button"
          className="btn btn--accent btn--block"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(inviteText(shareUrl(code)))
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Invite copied ✓" : "Copy invite"}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--block"
          aria-expanded={revealed}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? "Hide the code" : "Show the code"}
        </button>
        {revealed ? (
          <p
            className="num"
            style={{
              margin: 0,
              textAlign: "center",
              padding: "0.6rem",
              borderRadius: "var(--radius)",
              background: "var(--bg-sunken)",
              letterSpacing: "0.08em",
              wordBreak: "break-all",
            }}
          >
            {code}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * A regular player's whole settings screen.
 *
 * 🕐 Unreachable while one shared code makes everyone an admin. Kept because it
 * is reachable again the moment roles mean something.
 */
function SelfSettings({ member }: { member: Member }): ReactNode {
  const { updateProfile } = useStore();
  const [name, setName] = useState(member.displayName ?? "");
  const [email, setEmail] = useState(member.email ?? "");
  const [saved, setSaved] = useState(false);

  const playerId = member.playerId;
  const trimmedEmail = email.trim();
  const canSave =
    playerId !== null && name.trim() !== "" && (trimmedEmail === "" || trimmedEmail.includes("@"));

  return (
    <Card title="Your details">
      <div className="stack" style={{ gap: "0.5rem" }}>
        <input
          className="field"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
          aria-label="Your name"
        />
        <input
          className="field"
          value={email}
          placeholder="Add an email (optional)"
          inputMode="email"
          autoCapitalize="none"
          onChange={(event) => {
            setEmail(event.target.value);
            setSaved(false);
          }}
          aria-label="Your email"
        />
        <button
          type="button"
          className="btn btn--accent btn--block"
          disabled={!canSave}
          onClick={() => {
            if (playerId === null) return;
            updateProfile(playerId, { displayName: name, email });
            setSaved(true);
          }}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
        <p className="faint" style={{ margin: 0 }}>
          Names are capped at {MAX_NAME_LENGTH} characters so they fit the board and the standings
          at one consistent size.
        </p>
      </div>
    </Card>
  );
}

function appOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/**
 * 🕐 The onboarding URL: the app's origin with the shared code attached.
 *
 * The handoff calls a `?code=XXXX` link "the fastest way to onboard four people
 * at a table", and it is: `consumeCodeFromUrl` stores the code and strips the
 * param before the first render, so the scan lands on the standings screen and
 * never on the gate. Goes back to being the bare origin when Access lands.
 */
function shareUrl(code: string): string {
  return `${appOrigin()}/?code=${encodeURIComponent(code)}`;
}

function inviteText(url: string): string {
  return (
    `You're in for crokinole. Open ${url} on your phone — the link carries the code, ` +
    `so keep it like a password. Add it to your home screen and it works like an app.`
  );
}
