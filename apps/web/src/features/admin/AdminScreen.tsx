import { useMemo, useState, type ReactNode } from "react";

import { useStore } from "../../data/store";
import type { Role } from "../../data/fixtures";
import { Badge, Card, Empty } from "../../ui/components";
import { QrCode } from "./QrCode";

/**
 * Admin (§3.6) — who may use the app, and how to get them in.
 *
 * ⚠️ This screen manages **roles**, not access. The Cloudflare Access Group
 * decides who can reach the app at all; someone added here who isn't in that
 * group never gets far enough to talk to Convex. That's stated on the screen
 * rather than buried, because a silent half-invite is the worst outcome — it
 * looks like it worked and the person still can't log in.
 */
export function AdminScreen(): ReactNode {
  const { members, currentEmail, isAdmin, invite, setRole, revoke } = useStore();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRoleInput] = useState<Role>("player");
  const [copied, setCopied] = useState<string | null>(null);

  // In production this is https://crokinole.burkert.app. Reading it from the
  // page means the QR is always correct for wherever this is actually served.
  const appUrl = typeof window === "undefined" ? "" : window.location.origin;

  const pendingEmails = useMemo(
    () => members.filter((member) => !member.hasSignedIn).map((member) => member.email),
    [members],
  );

  const copy = async (text: string, key: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
    } catch {
      setCopied("failed");
    }
  };

  const inviteText =
    `You're in for crokinole. Open ${appUrl} on your phone, ` +
    `enter your email, and type the code it sends you. ` +
    `Add it to your home screen and it works like an app.`;

  if (!isAdmin) {
    return (
      <Card title="Admin">
        <Empty>You need an admin role to manage players.</Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="banner">
        <strong>Two lists, one job.</strong> Adding someone here sets their{" "}
        <em>role</em>. They also need to be in the <strong>Crokinole Players</strong> group in
        Cloudflare Access before they can reach the app at all — until then they'll be stopped at
        the login screen.
        <div className="row" style={{ marginTop: "0.6rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => copy(members.map((member) => member.email).join(", "), "all")}
          >
            {copied === "all" ? "Copied ✓" : "Copy all emails"}
          </button>
          {pendingEmails.length > 0 ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => copy(pendingEmails.join(", "), "pending")}
            >
              {copied === "pending"
                ? "Copied ✓"
                : `Copy ${pendingEmails.length} not-yet-signed-in`}
            </button>
          ) : null}
          <a
            className="btn btn--ghost"
            href="https://one.dash.cloudflare.com/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Open Zero Trust ↗
          </a>
        </div>
      </div>

      <Card title="Add a player">
        <div className="stack" style={{ gap: "0.6rem" }}>
          <input
            className="btn"
            style={{ width: "100%", textAlign: "left" }}
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Player name"
          />
          <input
            className="btn"
            style={{ width: "100%", textAlign: "left" }}
            placeholder="email@example.com"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-label="Email address"
          />
          <div className="segmented" role="group" aria-label="Role">
            {(["player", "admin"] as Role[]).map((option) => (
              <button
                key={option}
                type="button"
                className="segmented__option"
                aria-pressed={role === option}
                onClick={() => setRoleInput(option)}
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
              setEmail("");
              setName("");
              setRoleInput("player");
            }}
          >
            Add
          </button>
          <p className="faint" style={{ margin: 0 }}>
            Creates their player record too, so you can pick them for a game before they've ever
            opened the app.
          </p>
        </div>
      </Card>

      <Card title={`Players — ${members.length}`}>
        {members.length === 0 ? (
          <Empty>Nobody yet.</Empty>
        ) : (
          members.map((member) => (
            <div
              key={member.email}
              style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--line)" }}
            >
              <div className="spread">
                <strong>{member.displayName ?? member.email}</strong>
                <span className="row" style={{ gap: "0.35rem" }}>
                  {member.role === "admin" ? <Badge>Admin</Badge> : null}
                  {member.hasSignedIn ? null : <Badge live>Not signed in</Badge>}
                </span>
              </div>
              <div className="faint">{member.email}</div>
              <div className="row" style={{ marginTop: "0.4rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ minHeight: "2.5rem" }}
                  disabled={member.email === currentEmail}
                  onClick={() =>
                    setRole(member.email, member.role === "admin" ? "player" : "admin")
                  }
                >
                  {member.role === "admin" ? "Make player" : "Make admin"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ minHeight: "2.5rem" }}
                  onClick={() => copy(inviteFor(appUrl), `invite-${member.email}`)}
                >
                  {copied === `invite-${member.email}` ? "Copied ✓" : "Copy invite"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ minHeight: "2.5rem" }}
                  disabled={member.email === currentEmail}
                  onClick={() => revoke(member.email)}
                >
                  Revoke
                </button>
              </div>
            </div>
          ))
        )}
        <p className="faint" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          Revoking removes permission, never the person — their past games still score.
        </p>
      </Card>

      <Card title="Invite by QR">
        <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0 0.9rem" }}>
          <QrCode value={appUrl} size={190} label="QR code linking to the app" />
        </div>
        <p className="faint" style={{ textAlign: "center", marginTop: 0 }}>
          {appUrl}
        </p>
        <p style={{ fontSize: "0.9rem" }}>
          Hand them your phone or point theirs at this. They enter their email, get a one-time
          code, and they're in — no password, no account to create. It only works if their address
          is already in the Access group.
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn--ghost" onClick={() => copy(appUrl, "url")}>
            {copied === "url" ? "Copied ✓" : "Copy link"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => copy(inviteText, "text")}
          >
            {copied === "text" ? "Copied ✓" : "Copy invite message"}
          </button>
          <a
            className="btn btn--ghost"
            href={`sms:?&body=${encodeURIComponent(inviteText)}`}
          >
            Send as text
          </a>
          <a
            className="btn btn--ghost"
            href={`mailto:?subject=${encodeURIComponent("Crokinole")}&body=${encodeURIComponent(inviteText)}`}
          >
            Send as email
          </a>
        </div>
        {copied === "failed" ? (
          <p className="issue issue--warning" style={{ marginTop: "0.6rem" }}>
            Couldn't reach the clipboard — copy the link above by hand.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function inviteFor(appUrl: string): string {
  return (
    `You're in for crokinole. Open ${appUrl} on your phone, enter your email, ` +
    `and type the code it sends you. Add it to your home screen and it works like an app.`
  );
}
