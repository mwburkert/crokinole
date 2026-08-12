# Handoff — the full Convex migration

**Written 2026-08-12.** Take this from "works on one phone via localStorage" to
"a real shared backend, properly authed".

## Where you're starting

- **`main` is green and working.** The app runs on a phone, persisting to
  localStorage. It is the fallback. **Do not break it.**
- Branch **`convex/wire-store`** has `apps/web/src/data/store.tsx` already
  rewritten against Convex — typechecks, 117 tests green. Start from it.
- The Convex dev deployment is live. `.env.local` holds `CONVEX_DEPLOYMENT` and
  `CONVEX_URL`; `convex/_generated/` exists locally. `npx convex dev` must be
  running for functions to deploy.
- Backend functions are written: `convex/games.ts`, `stats.ts`, `players.ts`,
  `admin.ts`, `lib/auth.ts`, `lib/model.ts`.

## The auth problem, and the decision already made

Every function calls `assertAllowlisted(ctx)`, which needs a Cloudflare Access
JWT. **Access does not exist yet** — no domain, no Zero Trust team — so
`auth.config.ts` registers no provider and `getUserIdentity()` can only return
null. Wired as-is, nobody can call anything.

The owner chose a **shared passphrase** as the interim. Not fully open: a caller
must present a secret, so learning the deployment URL alone gets you nothing.

Convex has no per-request hook for this without a JWT provider, so thread it as
an argument:

- add `passcode: v.string()` to every query and mutation
- `assertAllowlisted(ctx, passcode)` compares against `process.env.APP_PASSCODE`
  (`npx convex env set APP_PASSCODE <value>`) before resolving the caller
- the web app keeps it in localStorage, prompts once if absent, and `store.tsx`
  passes it on every call
- a `?code=XXXX` link that stores the value and strips the param is the fastest
  way to onboard four people at a table

**Mark it for deletion at the check itself.** It goes when §7.1's Access
application lands, and a temporary bypass that outlives its reason is how
"`assertAllowlisted` is the only thing between the internet and this data"
(§3.2.5) stops being true.

## Three blockers, all real

Found by the agent that wired `store.tsx`:

1. **`main.tsx` has no `ConvexProvider`.** Every hook throws until it's added.
   This is what white-screens the app.
2. **`updateRound` is unreachable from the client.** `convex/games.ts:updateRound`
   is keyed by `roundId`, and no query exposes one — `games.list`/`games.get`
   return core's `Round`, which has an index and no id. Re-key the mutation to
   `{gameId, index}` or return round ids on the read side. Until then, correcting
   a committed round in the manual overlay is dead.
3. **Loading reads as missing.** `useQuery` returns `undefined` before the first
   response, so a cold load of `/games/:id/play` flashes *"That game is gone."* —
   on a phone refresh mid-game that reads as data loss. Add an `isLoading` flag
   to `StoreValue` and handle it in `EntryScreen`, `HistoryScreen`, and the tab bar.

Plus: **`convex/_generated/` is gitignored** while `apps/web` now imports it, so
a fresh clone or CI fails until `npx convex codegen` runs. Make codegen part of
install/CI, and add `convex/` to the root `tsc -b` now that it can compile.

## Then finish the job properly

- **Seed the real data.** Five players (Kinsey, Marley, Spencer, Burkert, Burton
  — no emails) and the 5 Aug night from `apps/web/src/data/fixtures.ts`. Those
  rounds use `resultOverride`: outcome known, points never recorded. **Preserve
  that. Never invent points.** Verify the standings come out Burkert +$8,
  Burton +$7, Kinsey −$3, Marley −$5, Spencer −$7, summing to zero.
- **Error boundary.** `StoreProvider` wraps every route and a rejected query
  throws during render, so a bad passcode white-screens instead of saying
  "wrong code".
- **Delete the localStorage games persistence** — it exists only because this
  migration hadn't happened. `presentIds` stays local; it's per-device "who's at
  the table", not shared state.
- **Host it.** The LAN URL only works on the owner's wifi. Check Convex's own
  static hosting first — it avoids a new account.

## Two gaps where the UI promises what the data doesn't deliver

Both are in `docs/plan/README.md`'s correction list:

- **Disc positions are never persisted.** `rounds.discs` is in the schema and the
  board produces them, but `addRound` passes only ring counts, so the board you
  place is discarded on commit. The rule to preserve: **when `discs` is present it
  is the source of truth and ring counts are recomputed from it on every write**,
  so the two can never disagree.
- **Per-player twenties are never captured.** The board tracks discs by colour,
  not by player, so `playerStats` is always empty and those Stats columns show
  "—" forever. Either the board learns who threw each disc, or the columns go.

## Definition of done

- Two devices see the same game update live.
- A wrong or missing passcode shows a message, not a blank screen.
- A phone refresh mid-game never flashes "That game is gone."
- The 5 Aug night is in Convex and reconciles as above.
- `npm run typecheck && npm test && npm run build` green.
- A URL the owner can send to four people.

## How to work

`AGENTS.md` applies in full — never push to `main`, one PR per task, squash only.

**Use orchestration.** Fan out independent work in parallel (auth threading,
provider + error boundary, loading states, seeding, hosting), then run adversarial
QA and review passes over the result rather than trusting the first pass. Loop
until findings stop. The owner is largely unavailable — decide what you can
defend from the docs and only escalate what genuinely needs them.

**QA by driving it, not by reasoning about it.** Every bug that mattered in this
project was found by using the app at a phone viewport, and several were missed
by code that typechecked and passed tests.
