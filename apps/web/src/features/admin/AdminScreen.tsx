import { MAX_NAME_LENGTH } from "@crokinole/core";
import { useState, type ReactNode } from "react";

import type { Member, Role } from "../../data/fixtures";
import { useStore } from "../../data/store";
import { Badge, Card, Empty } from "../../ui/components";
import { QrCode } from "./QrCode";

/**
 * Settings.
 *
 * Admins get the player list; everyone else gets only their own name and email.
 * Per-player actions live behind a kebab so the list itself stays a scannable
 * column of names — the thing you're actually looking for.
 *
 * ⚠️ Two lists still: the Cloudflare Access Group decides who can *reach* the
 * app, this allowlist decides what they may *do*. See `convex/admin.ts`.
 */
export function AdminScreen(): ReactNode {
  const { members, currentEmail, isAdmin, isSuperAdmin } = useStore();
  const [adding, setAdding] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const me = members.find((member) => member.email === currentEmail);

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
          members.map((member) => (
            <PlayerRow
              key={member.email}
              member={member}
              locked={isSuperAdmin(member.email) && !isSuperAdmin(currentEmail)}
              isSelf={member.email === currentEmail}
              open={openMenu === member.email}
              onToggleMenu={() =>
                setOpenMenu((current) => (current === member.email ? null : member.email))
              }
            />
          ))
        )}
      </Card>

      {adding ? <AddSheet onClose={() => setAdding(false)} /> : null}
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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.displayName ?? "");
  const [email, setEmail] = useState(member.email);
  const [copied, setCopied] = useState(false);

  const appUrl = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="prow">
      <div className="prow__main">
        <div className="prow__id">
          <span className="name">{member.displayName ?? member.email}</span>
          <span className="faint">{member.email}</span>
        </div>
        <div className="row" style={{ gap: "0.35rem" }}>
          {member.role === "admin" ? <Badge>Admin</Badge> : null}
          {locked ? null : (
            <button
              type="button"
              className="iconbtn iconbtn--sm"
              aria-label={`Actions for ${member.displayName ?? member.email}`}
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
          {editing ? (
            <div className="stack" style={{ gap: "0.5rem" }}>
              <input
                className="field"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => setName(event.target.value)}
                aria-label="Name"
              />
              <input
                className="field"
                value={email}
                inputMode="email"
                autoCapitalize="none"
                onChange={(event) => setEmail(event.target.value)}
                aria-label="Email"
              />
              <div className="row">
                <button
                  type="button"
                  className="btn btn--accent"
                  onClick={() => {
                    updateProfile(member.email, { displayName: name, email });
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
              <button type="button" className="menu__item" onClick={() => setEditing(true)}>
                Edit name &amp; email
              </button>
              <button
                type="button"
                className="menu__item"
                disabled={isSelf}
                onClick={() => setRole(member.email, member.role === "admin" ? "player" : "admin")}
              >
                {member.role === "admin" ? "Make player" : "Make admin"}
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(inviteText(appUrl))
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? "Invite copied ✓" : "Copy invite"}
              </button>
              <button
                type="button"
                className="menu__item menu__item--danger"
                disabled={isSelf}
                onClick={() => revoke(member.email)}
              >
                Revoke access
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The `+` sheet: QR first, with a manual form behind a disclosure. */
function AddSheet({ onClose }: { onClose: () => void }): ReactNode {
  const { invite } = useStore();
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("player");

  const appUrl = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Card title="Add someone">
      <div style={{ display: "flex", justifyContent: "center", padding: "0.25rem 0 0.75rem" }}>
        <QrCode value={appUrl} size={170} label="QR code linking to the app" />
      </div>
      <p className="faint" style={{ textAlign: "center", marginTop: 0 }}>
        {appUrl}
      </p>

      {manual ? (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <input
            className="field"
            placeholder="Name"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            aria-label="Name"
          />
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
          <button
            type="button"
            className="btn btn--accent btn--block"
            disabled={!email.includes("@") || name.trim() === ""}
            onClick={() => {
              invite({ email, displayName: name, role });
              onClose();
            }}
          >
            Add &amp; send invite
          </button>
          <p className="faint" style={{ margin: 0 }}>
            ⚠️ Sending the email isn't wired up yet — it needs a mail provider and a verified
            sending domain. For now this adds them and you share the link yourself.
          </p>
        </div>
      ) : (
        <button type="button" className="btn btn--block" onClick={() => setManual(true)}>
          Add manually instead
        </button>
      )}

      <button
        type="button"
        className="btn btn--ghost btn--block"
        style={{ marginTop: "0.5rem" }}
        onClick={onClose}
      >
        Done
      </button>
    </Card>
  );
}

/** A regular player's whole settings screen. */
function SelfSettings({ member }: { member: Member }): ReactNode {
  const { updateProfile } = useStore();
  const [name, setName] = useState(member.displayName ?? "");
  const [email, setEmail] = useState(member.email);
  const [saved, setSaved] = useState(false);

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
          onClick={() => {
            updateProfile(member.email, { displayName: name, email });
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

function inviteText(appUrl: string): string {
  return (
    `You're in for crokinole. Open ${appUrl} on your phone, enter your email, ` +
    `and type the code it sends you. Add it to your home screen and it works like an app.`
  );
}
