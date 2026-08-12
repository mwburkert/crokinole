# Wave 3 · Agent H — auth and security

**Read-only QA. You report findings; you do not fix them.**
Written 2026-08-12, ready to fire once the Convex migration lands.

> **This is the most important brief in the wave.** Cloudflare Access does not
> protect Convex — the browser opens a WebSocket straight to
> `wss://<deployment>.convex.cloud`, a host on no zone the owner controls, and
> the Cloudflare edge never sees it (§3.2.5, §7.1). `assertAllowlisted` is the
> **only** thing between the public internet and this data. One missing call is
> a full read and write breach.

---

## Your posture

**You are an attacker.** You have:

- the Convex deployment URL (assume it leaked — it ships in the client bundle as
  `VITE_CONVEX_URL`, so it is public by construction, regardless of repo
  visibility)
- a working `ConvexHttpClient` / `ConvexClient`
- **no** Cloudflare Access session, **no** allowlist entry, **no** valid JWT

Your goal is to get one byte of application data out, or one byte of state
changed. Report what you achieve and what you fail to achieve.

## Rules of engagement

- ✅ Point your client at the **dev** deployment.
- ❌ **Do not attack the production deployment** if one exists.
- ❌ Do not modify `convex/`, `packages/core`, or `apps/web`.
- ❌ Do not delete or mutate real data. If a write succeeds, that is your
   finding — record the response and **stop**, do not explore how much more you
   can destroy. Note that `games.softDelete` is soft (§3.2.4) but
   `admin.revoke` and `players.setActive` are not trivially reversible.
- ✅ You may write throwaway attack scripts outside the repo.

## Baseline: what "guarded" looks like today

As of 2026-08-12 on `plan/remaining`, `convex/` contains **23 exported
functions across four files**, and all 23 call `assertAllowlisted` or
`assertAdmin` as the literal first statement. There are no `action`,
`internalMutation`, `internalQuery`, or `httpAction` exports, no `convex/http.ts`
and no `convex/crons.ts`.

**Do not trust that paragraph.** It describes the branch as it was before the
migration landed, and the migration adds functions. **Re-enumerate from the
source yourself** — the whole point of you is that you check rather than assume.
Use it only as a tripwire: if your count comes out lower than 23, you have
missed a file.

## Task 1 — the enumeration (do this exhaustively, it is the core deliverable)

Walk every file under `convex/` and build a table of **every** export:

| File | Export | Kind | Guard, and is it the first statement? | Raw wire response as an unauthenticated caller |
|---|---|---|---|---|

Include `query`, `mutation`, `action`, `internalQuery`, `internalMutation`,
`internalAction`, `httpAction`, and any route registered on an `httpRouter`.

**Then actually call every one of them** with no auth and dump the raw response.
Do not reason about whether it would work — the entire premise of this wave is
that reasoning about auth is how auth bugs survive. Call it.

**Anything that returns data is a finding. Anything that mutates is an S1.**

Watch specifically for these failure shapes, which are the ones that survive
code review:

1. **A guard that is called but not awaited.** `assertAllowlisted(ctx)` without
   `await` returns a floating promise; the handler proceeds and the rejection
   surfaces as an unhandled error *after* the data has been read and possibly
   returned. Check every call site for `await`.
2. **A guard after the first read.** If `ctx.db.query(...)` runs before the
   guard, the data is fetched even if the throw prevents its return — and in a
   mutation, writes before the throw are rolled back but writes in a *scheduled*
   function are not.
3. **A helper that reads without a guard**, called by something that has one.
   Check `convex/lib/model.ts` for exported functions that touch `ctx.db`.
4. **A new file added by the migration** that nobody added to the checklist.
   Diff the function list against the 23 above.
5. **`httpAction` routes**, if the migration added any. These bypass the
   client-auth path entirely and read a raw `Request` — a `/api/*` route with no
   check is a wide-open door and would not appear in a `query`/`mutation` audit.

## Task 2 — the token attacks

`convex/auth.config.ts` registers a `customJwt` provider with
`issuer = CF_ACCESS_TEAM_DOMAIN`, `jwks = ${teamDomain}/cdn-cgi/access/certs`,
`applicationID = CF_ACCESS_AUD`, `algorithm: RS256`. Attack each field.

| # | Attack | Expected | Severity if it works |
|---|---|---|---|
| 2.1 | No token at all | Rejected | S1 |
| 2.2 | Garbage string as token | Rejected | S1 |
| 2.3 | **A valid Access token minted for a *different* app's AUD** (meal-planner's or oh-heck's) | **Rejected** | **S1 — this is the reason there are three Access applications instead of one (§7.1). If it is accepted, the entire per-app boundary is fictional.** |
| 2.4 | A token with `alg: none`, or HS256 signed with the JWKS public key as the HMAC secret | Rejected | S1 — classic algorithm-confusion |
| 2.5 | An expired but otherwise valid token | Rejected | S1 |
| 2.6 | A token from a different issuer entirely, self-signed with a JWKS you host | Rejected | S1 |
| 2.7 | A well-formed token whose `email` claim is an address **not** in the `allowlist` table | Rejected by `assertAllowlisted`'s table lookup | S1 |
| 2.8 | A token with **no `email` claim** | Rejected — `assertAllowlisted` throws "Access token carries no email claim" | S1 |
| 2.9 | `email` differing only in case or with surrounding whitespace from an allowlist entry | Consider carefully. The guard lowercases; does the **write path** that inserts allowlist rows also lowercase? A mixed-case row inserted by `admin.invite` would be permanently unmatchable — a **lockout bug**, not a breach, but report it |
| 2.10 | Unicode-confusable or `+`-suffixed address (`user+x@gmail.com`) matching an allowlist entry | Report what happens; gmail-style aliasing means `a+b@` and `a@` are the same mailbox to the provider but different strings here |

For 2.3 you need a token from another Access application. If the other two
applications do not exist yet, **say so and mark 2.3 as NOT TESTED** rather than
reasoning that it would probably be fine. It is the single highest-value test in
this brief and a "probably" is worthless. If you can obtain one, the fastest
route is logging into `meals.burkert.app` and reading the
`Cf-Access-Jwt-Assertion` header from that app's own token echo endpoint.

## Task 3 — authorization, not just authentication

Being on the allowlist is not permission to do everything. Using a **valid
non-admin** identity, confirm the admin/player split actually holds:

- `admin.listMembers`, `admin.invite`, `admin.setRole`, `admin.revoke`,
  `games.restore`, `players.setActive` must all require `assertAdmin`.
- **Privilege escalation:** can a `player` call `admin.setRole` on themselves?
  Can `players.claim` bind a `players` row to an identity that is not theirs?
  Can `admin.invite` be used by a non-admin to add an accomplice?
- **Known asymmetries to evaluate and report on** (these are design questions,
  not necessarily bugs — say which you think they are):
  - any allowlisted player can `softDelete` **any** game, but only an admin can
    `restore` it. A malicious or clumsy player can hide history that only an
    admin can bring back.
  - `players.create` and `players.rename` are open to any player.
  - `games.setNotes` patches without the `deletedAt` / existence checks that
    `addRound` performs — can you set notes on a deleted game, or on an id that
    is not a game?

## Task 4 — the interim passcode, if it is still there

The migration added a shared passphrase as a temporary measure, checked against
`process.env.APP_PASSCODE` and threaded as a `passcode` argument on every
function. It was **marked for deletion at the check itself**.

If it is still present when you run:

- Confirm the comparison is against a real secret and that an absent or empty
  `APP_PASSCODE` does not make everything pass. **An unset env var making the
  check vacuous is an S1** — `undefined === undefined` is the shape to look for.
- Confirm a wrong passcode produces a clean error, not a white screen.
- Confirm the passcode is not logged, not returned in an error message, and not
  in any query response.
- **Report its continued existence as a finding in its own right** if Cloudflare
  Access is live by then. A temporary bypass that outlives its reason is exactly
  how "`assertAllowlisted` is the only thing between the internet and this data"
  stops being true.

## Task 5 — the surrounding surface

- **Is `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` set on the deployment?** When
  either is unset, `auth.config.ts` emits `providers: []` and
  `getUserIdentity()` returns null for everyone. That fails **closed** — every
  function throws — which is correct, but confirm it, because the opposite
  (empty provider list meaning "no validation") would be catastrophic. Verify
  empirically rather than by reading the config.
- **The token echo endpoint.** Whatever serves `/admin/token` returns a live
  Access JWT to whoever can reach it. Confirm it is inside the Access-gated
  hostname, that it echoes only the `Cf-Access-Jwt-Assertion` header, and that
  it cannot be induced to echo an arbitrary header or reflect a cross-origin
  request. Check its CORS headers.
- **Secrets in the client bundle.** Grep the built `dist/` for anything that
  should not ship. `VITE_CONVEX_URL` is expected and fine; an API key,
  `APP_PASSCODE`, or a real email address is not.
- **Real email addresses in committed code.** The repo is **public**. §2.0
  forbids committing the allowlist. Grep the tree and the git history for the
  players' real addresses and for anything resembling a credential.

## What good output looks like

A findings report with, per finding: severity, the exact call you made, the raw
response, the file:line, and why it matters. Plus the **complete** enumeration
table from Task 1 — including the rows that behaved correctly, because a
security audit that lists only failures cannot be checked for coverage.

State explicitly which tests you could **not** run and why (no second Access
application, no prod access, passcode already removed). **A clean report is only
credible with its gaps declared.** Do not write "all functions are properly
guarded" unless you called every one of them and can paste the responses.

**Do not fix anything you find.** Report it and stop.
