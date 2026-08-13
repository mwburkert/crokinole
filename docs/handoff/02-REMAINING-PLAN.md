# Handoff — the rest of the plan

**Written 2026-08-12.** Everything not covered by `01-CONVEX-MIGRATION.md`.
Read `docs/plan/README.md` first — it is the index and carries the correction
list. Check nothing here overlaps the migration agent before starting it.

## Platform (`docs/plan/07-PLATFORM.md`)

Partly begun by the owner. Sequence in §7.7:

1. Register **`burkert.app`** at Cloudflare Registrar (~$14.20/yr, no renewal
   markup; nameservers get set automatically, which Access requires).
2. Zero Trust team, Email OTP as IdP.
3. **Three Access Groups**, then **three separate Access applications**, one per
   app. ⚠️ Not one multi-domain application — that gives all three a single AUD,
   and the AUD is what Convex validates, so a token minted for meal-planner would
   be cryptographically valid at crokinole's backend. Separate applications still
   give one login, via Access's global session token.
4. Zone SSL to **Full (strict)** before any DNS flip.
5. Wire `auth.config.ts` per app with that app's AUD, plus the `/admin/token`
   **Worker `fetch` handler with `run_worker_first`** (§7.5a).
   > ⚠️ **Corrected 2026-08-12:** this said "Pages Function". That construct does
   > not exist on a Workers static-assets deployment, and without
   > `run_worker_first` the path silently serves `index.html` instead of the
   > token. Also: **step 1 is done** — `burkert.app` was registered on
   > 2026-08-12. See `docs/plan/08-SEQUENCING.md`.

Hosting is decided and researched: crokinole and oh-heck on **Cloudflare Workers
static** (static asset requests are free and unlimited — no ceiling at any
scale); meal-planner stays on **Render**. Do not attempt to move meal-planner to
Workers: `anylist/lib/index.js` requires `got`, `reconnecting-websocket` and `ws`
at module load, and `ws` cannot run on Workers.

## Retire the passcode

Once Access is live, delete the interim shared passphrase the migration agent
added — every `passcode` argument and the env-var check — and set
`CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` in the Convex env instead. Coordinate;
don't do it while they're mid-flight.

## Invitations

Both routes are blocked until the Access Group exists:
- Cloudflare's API can `PUT` an updated member list to
  `/accounts/{id}/access/groups/{group_id}` from a Convex action.
- Or the **External Evaluation** policy type lets Access call your endpoint and
  defer the decision entirely — which would make Convex the single source of
  truth and collapse today's two-list situation into one.

Emailing an invite needs a provider (Resend) and a verified sending domain, so it
waits on `burkert.app`.

## Sibling apps

- **meal-planner** — `C:\dev\meal-planner\docs\PLATFORM-HANDOFF.md`. Two live
  items: verify `DATABASE_URL` is set in Render (if not, its ephemeral filesystem
  has been destroying data on every spin-down), and move `lib/db.ts` from libSQL
  to `ConvexHttpClient`. Its DNS/Access migration was un-deferred and goes first,
  proving the pattern.
- **oh-heck** — `C:\dev\oh-heck-chaos-monkey\docs\PLATFORM-HANDOFF.md`. Dormant.
  Keeps Convex Auth because public play is a goal; Access is a beta gate only.
  Anonymous play means unauthenticated writes, so it needs Turnstile or rate
  limiting before its Phase 2.

## Wave 3 — the QA wave that has never run

`docs/plan/06-ORCHESTRATION.md` §6.3. Three read-only agents that report rather
than fix — separating find-from-fix is what stops an agent quietly "fixing" a
test to make its own bug disappear.

- **G** property-tests `packages/core` against the spec prose
- **H** auth/security: try to read and write as an unauthorised caller, and
  confirm **every** function calls `assertAllowlisted`. There is no public route.
- **I** hand-computes a night independently and reconciles field by field

**H matters most** — `assertAllowlisted` is real code now.

## Repo housekeeping

- Make `ci` a required status check on the `main` ruleset — but only after a run
  has reported, or every PR deadlocks against a context that has never existed.
- Add the gitleaks pre-commit hook (§2.5).
- `docs/plan/02-GITHUB-REPO.md` §2.4 says `gh auth refresh -u <user>`; that flag
  doesn't exist in the installed `gh`. Fix the doc.
- The owner's `gh` active account keeps reverting to `mwburkert-struct` (the work
  account), which 403s every push to this repo. Worth finding what resets it.

## Phase 1 leftovers

**T7** — seed the owner's remaining historical games; only the 5 Aug night is in.
That night's round points are **outcome-only** by design. Never backfill invented
points.

## Phase 2 (`docs/plan/04-PHASE-2.md`)

Do not start any of it until Phase 1 has had a month of real use and §4.6's
re-review is answered from actual play. The highest-value item — and arguably a
Phase 1 item — is **night grouping with a per-night settlement**, so the group
settles once rather than per game.

## Phase 3 (`docs/plan/05-PHASE-3-VISION.md`)

Camera auto-scoring. Exploratory. The two hard parts are disc-thickness parallax
(~0.11" of error against a rule needing ±0.03") and the fact that twenties fall
in the hole and vanish, so a single end-of-round photo cannot score a round — it
needs stateful shot-by-shot diffing. §5.6 has the cheapest first experiment.

## Standing decisions — do not relitigate

- Everything is derived, never stored (§3.2.1). Disc positions are the one
  deliberate, documented exception.
- Scoring config is snapshotted per game, so changing house rules never rewrites
  history.
- Soft delete only.
- `winBy: 2` and `targetMatchPoints: 5` are **house rules, not NCA**. NCA regular
  play is a fixed four rounds per game.
- The whole app is behind auth. There is no public route.
- "Points not recorded" is a distinct state from "scored zero". Round points
  render "—" when a round carries only an outcome.
  > **Corrected 2026-08-12 (later):** this said the same applied to twenties.
  > It no longer does. Twenties are derived from team ring counts, which are
  > always known, so a team that sank none genuinely scored 0 and renders 0.
  > Marley's row is the illustration: `Pts/rd` "—", `20s` 0.

## How to work

`AGENTS.md` in full. **Use orchestration** — fan out independent strands, then
run adversarial QA and review loops over the results rather than trusting a first
pass. Escalate only what genuinely needs the owner.

**No implementation work today** unless the owner says otherwise. Today is for
planning, sequencing, and anything read-only.
