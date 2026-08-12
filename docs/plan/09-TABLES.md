# Section 9 — Tables: the host/join model

**Written 2026-08-12. Design note, not a commitment.** Nothing here is built, and
nothing here should be built until §9.10's open questions are answered by the
owner and the Cloudflare Access work in §7 has landed.

This is a **direction change, not a feature**. It replaces the model the app is
built on today — one night, one shared list of who is here, one live game — with
a model of concurrent, independently-owned tables. Most of Phase 1 survives it;
a specific and enumerable set of things does not.

---

## 9.1 The model, as the owner described it

- **Multiple games running at once**, not one live game per night.
- **Host / join**, replacing "select everyone who's here". A host starts a table;
  others join it.
- The host can seat people **from the allowlist**, or create **placeholder guest
  spots with editable names**, so someone who is not a registered player can be
  seated and named.
- **Editing a live game is restricted to the users at that table.** Everyone else
  cannot edit.
- Others may **watch progress** and see stats **if the table is public**.
  Spectating is explicitly wanted; editing by non-participants is explicitly not.
- It **composes with Phase 3** (§5) — a table having a camera watching it.

---

## 9.2 Why this is not additive

Phase 2 (§4) opens by saying *"Everything here is additive… none of it requires a
schema migration."* **That claim does not extend to this section, and §4 should
not be read as covering it.**

The reason is specific. Phase 1's design is built on three singletons that a
tables model makes plural:

1. **One "who is here"** — `presentIds`, a per-device localStorage list keyed by
   the night.
2. **One live game** — `useLiveGame` and `games.inProgress` both reduce the set
   of in-progress games to exactly one.
3. **No per-resource permission.** There are two *roles* (`player` and `admin`,
   used by `games.restore` and `players.setActive`), but nothing anywhere ties a
   caller to a *specific game*. ⚠️ An earlier draft called this "one trust
   level", which was wrong — the roles exist; the resource scoping does not.

Each is load-bearing in the UI. None survives contact with two tables.

**The good news, established by audit rather than assumption:** the *backend*
already tolerates concurrent games. `games.create` has no rule preventing a
second in-progress game, `by_status` is a plain non-unique index, all mutations
are `gameId`/`roundId`-keyed, and the routes are already id-keyed with no
`/current` or index redirect. Standings are also safe: `aggregateStats` skips
incomplete games and `settle()` returns `[]` for an unwon game, so two live games
cannot corrupt the leaderboard or the night settlement. The work is concentrated
in the client and in a new permission model — not in a rewrite of the data layer.

---

## 9.3 What it breaks — the audited inventory

Every row below was verified against the code on 2026-08-12, not inferred.

### Correctness

| # | What | Where | Breaks how |
|---|---|---|---|
| 1 | **"The live game" is singular, and the second one silently disappears** | `store.tsx:469-472` and `convex/games.ts:71-89` | The client takes `.find()` over a `playedAt`-descending, deleted-filtered list; the server `.collect()`s all in-progress games, filters deleted, sorts `playedAt`-descending and takes `[0]`. **Corrected 2026-08-12: these two agree** — an earlier draft of this row claimed they disagree, which was wrong; both resolve to the most recently started live game. The actual defect is that **both silently discard every other live game**, with no count and no warning. Return type is `GameWithRounds \| undefined` / one-or-null — never a list. (The one case they *could* diverge is a `playedAt` tie, since sort stability then depends on input order, which differs between a `.collect()` and the client's list. `playedAt` is millisecond-precision so this is narrow — but it is caller-supplied and optional, so seeded games can collide.) |
| 2 | **The same player can be seated at two live tables at once** | `store.tsx:353-356`, `validate.ts:153-165`, `games.create` | Presence filters on `player.isActive && presentIds.includes(...)`; `validateGame` checks duplicates *within* one game; `create` does no cross-game check. **The damage is a nonsensical roster, not corrupted stats** — `aggregateStats` skips incomplete games (`stats.ts:80`), so while both are live it counts the player in *neither*, and once both finish the arithmetic is correct |
| 3 | **"Mix up" biases against people who are mid-game but never excludes them** | `NewGameScreen.tsx:124-141` → `night.ts:161-222`; the `here >= 4` gate is at `NewGameScreen.tsx:171-173, 197` | Nothing models "currently seated elsewhere". ⚠️ Corrected: `nightHistory` (`night.ts:93-113`) iterates **every** game it is handed, skipping only deleted ones — it never reads `status` — and the caller passes `gamesOnNight(...)`, which **includes in-progress games**. Since `suggestSeating` ranks by fewest games played, a mid-game player is *deprioritised*, not ruled out. So the suggester can still seat someone who is mid-game, and the `here >= 4` gate still claims doubles is possible when all four are busy |
| 4 | **No per-*resource* permission exists** | ten guarded exports in `convex/games.ts` — `assertAllowlisted` at `:44, 58, 74, 104, 170, 232, 283, 307, 325`, `assertAdmin` at `:316` | ⚠️ Corrected: there are **two** roles, not one trust level — `games.restore` and `players.setActive` are admin-only. What genuinely does not exist is any check tying a caller to a *specific game*. See row 4a for the one precedent |
| 4a | **…but a per-game participant predicate already exists client-side** | `HistoryScreen.tsx:57-61`, comment at `:138-140` | `canManage = isSuperAdmin(currentEmail) \|\| participantIds.includes(myPlayerId)` — literally "is the caller at this table" — gating Resume/Delete, with a comment stating this section's own rationale: *"Abandoned games are only the business of the people who were in them."* It is client-side and so has **zero security value**, but it is a shipped precedent and the right UI seam. The server-side version is what must be built |
| 5 | **Guests cannot be actors** | `auth.ts:79-94`, `schema.ts:59` | `resolvePlayer` matches only `authSubject` or `email`; `allowlist.email` is required. A row with neither matches nothing. See §9.6 |

### The main structural obstacle

| # | What | Where | Breaks how |
|---|---|---|---|
| 6 | **The tab bar's centre button is one slot doing double duty** | `App.tsx:20, 43-68` | It renders "Resume" (▶, linking to the live game) whenever *any* game is live, and "New" (+) otherwise. So once table 1 starts, **the app's primary action button no longer offers "new game" at all** — and it is the deliberate primary action, styled to ride above the bar. Restructuring it is the first thing to design |

> **Corrected 2026-08-12: this is a redesign, not a hard block.** An earlier draft
> called it "blocks the feature outright". It does not — `LeaderboardScreen.tsx:182-187`
> renders "New game" whenever the Standings screen is showing **tonight**, so a second
> table is startable there today. (It sits inside `{isTonight ? … : null}`, so it does
> disappear on a past-night view — "unconditional" was itself an overstatement.)
> The tab bar is the *prominent* path, not the only one.
> Worth knowing that the code already anticipated concurrent games: the comment at
> `LeaderboardScreen.tsx:169-174` explicitly blesses them — *"Starting a new game
> while one is open simply leaves the old one in progress — that IS 'finish
> later' — and it stays resumable from history."* The intent is on record; only
> the navigation is singular.

### UX, but severe under tables

| # | What | Where | Breaks how |
|---|---|---|---|
| 7 | **Uncommitted round entry is lost on every table switch** | `EntryScreen.tsx:38-52` | `discs`, `manualCounts`, `totals` and the undo stacks are component-local `useState`. Navigating away unmounts and discards them. With one game you rarely leave mid-round; with two you switch constantly, and each switch reads as data loss |
| 8 | **The night-wide standing silently merges tables** | `LeaderboardScreen.tsx:52-84` | All players appear in one ranking with `netCents` pooled across tables. A player at table B outranks one at table A having never faced them. The merge is invisible and looks like a real competition |
| 9 | **The present/absent split becomes a lie** | `LeaderboardScreen.tsx:74-83, 135, 154-156` | Presence is per-device, so table B's host tapping someone in changes nothing on table A's device. Two hosts see two different greyed-out sets over identical numbers. The copy — *"Tap a name to mark who's here"* — describes a gesture that no longer makes sense when the host seats people |
| 10 | **Standings surfaces only the newest live table** | `LeaderboardScreen.tsx:36, 175-181` | ⚠️ Corrected: an earlier draft said "table 1 gets no entry point". It does — `HistoryScreen.tsx:135-150` renders a `Badge live` "Unfinished" plus a **Resume** link for *every* unfinished game. So the older table is reachable, but only as a two-tap detour through History, with no table label to tell them apart (row 11) |
| 11 | **History interleaves tables with nothing to tell them apart** | `store.tsx:445-466` (`useNights`), within-night order at `:458` | Ordered by time alone, no table label |
| 12 | **The `?players=` prefill silently submits an invisible player** | `NewGameScreen.tsx:55-63`, `:67`, `:93-105`, `:157` | A prefilled player absent from *this device's* `availablePlayers` has no matching `<option>`, so the seat renders blank — **and `seats` state still holds the unmatched id, so `ready` is true and `start()` submits it.** That is a silent wrong-data path, not a cosmetic blank. ⚠️ Corrected: this needs a *partial* presence list. With an **empty** one, `NewGameScreen.tsx:175-187` shows the "Nobody's here yet" card and no seats render at all |

### Survives unchanged — do not "fix" these

`packages/core` is in much better shape than expected: `nightKey`, `nightBounds`,
`nightsWithGames`, `playersOnNight`, `nightHistory` and `shuffle` all take arrays
you choose, so they are already table-agnostic. `suggestSeating` needs its two
arguments re-pointed at table-scoped data, not rewriting. `tiebreakRank` is
harmless (optionally re-key it per table so two tables' ties don't resolve
identically — cosmetic). Routes, all `gameId`-keyed mutations, `Badge live`, and
the stats/settlement exclusion of in-progress games all need no change.

**Two existing seams are the natural seeds for the concept**, and both should be
built on rather than replaced:

- **`HistoryScreen.tsx:57-61`'s `canManage`** — the closest thing to a table
  membership check that exists (row 4a). Client-side, so no security value, but
  the predicate and the rationale are already right.
- **"Start next game, same four"** — `EntryScreen.tsx:134` builds its player list
  from the finished game's own `teams.A/B.playerIds` and passes it forward,
  never consulting presence. That is the closest thing to a table *roster*.

---

## 9.4 The identity question — answered precisely

The brief for this work stated that per-table edit permission "needs real
identity, which means it is blocked on the Cloudflare Access work, not on the
passcode." **That is right in its practical conclusion and imprecise in its
reasoning, and the difference changes what to build.**

### Under the shared passcode a per-*person* check is impossible — with a worked proof in the tree

*(Heading corrected 2026-08-12: it previously said "it is impossible", which
contradicted this section's own conclusion forty lines below. What one shared
secret makes impossible is a per-**person** check. A per-**table** boundary is
still reachable under a shared-secret model — see "What actually closes the gap".)*

On the migration branch, `assertAllowlisted` returns the following whenever
`ctx.auth.getUserIdentity()` is null — which, because that branch's
`auth.config.ts` registers no provider, is **every** caller who presents the
correct string:

```ts
return { email: null, player: null, role: "admin" };
```

Every successful caller receives a byte-identical `Caller`. Nothing in the object
and nothing in the request varies by person — `passcode` is compared against a
single deployment-wide `process.env.APP_PASSCODE`. A predicate `seatedAt(table,
caller)` has no argument to bind. That branch's own comment says so: *"with one
shared secret there is no per-person identity… every holder of the passphrase is
equally trusted."* Its schema was amended to match — `createdBy` and
`gameEvents.actorPlayerId` both became optional.

**The proof is already in the code.** There are several per-user checks in the
backend — `players.claim` (`players.ts:107`), `admin.assertMayEdit`
(`admin.ts:64`), the setRole self-demotion guard (`admin.ts:269-272`) and the
revoke self guard (`admin.ts:299-301`) — and **every one of them degrades under
the interim.** `admin.updateProfile` shows the mildest version:

```ts
// 🕐 With no identity there is no "self", so this is false under the shared
// passphrase — where `role` is always admin, and the next check passes.
const editingSelf = player._id === caller.player?._id;
if (!editingSelf && caller.role !== "admin") {
```

The check evaluates false and the fallback is unreachable, because the interim
hands everyone `"admin"`. **A per-table check would degrade identically.** This
is read from the source of an existing check, not a prediction — though it has
not been executed, and nobody should treat it as a test result.

> 🚨 **A live security finding, spotted while writing this — `players.claim`
> degrades far worse, and this one is not hypothetical.** On the migration
> branch, `players.ts:107` reads:
>
> ```ts
> if (caller.player && caller.player._id !== args.playerId) await assertAdmin(ctx);
> ```
>
> Under the passphrase `caller.player` is `null`, so the `&&` short-circuits to
> false and **`assertAdmin` is skipped entirely**. Any holder of the shared
> passcode can claim **any** player row as themselves. `updateProfile` merely
> passes a check it should have failed; this one *skips* the check altogether.
> **Report to whoever owns `convex/` this wave — see §9.12.**
>
> This is also the single best argument for the section's conclusion: guards
> written against an identity that is `null` do not fail loudly, they evaporate.

### But Access alone does not deliver the requirement either

The identity chain is `identity.email` → `allowlist` (email **required**) →
`players`. **Guests have no email, so they cannot enter that chain at any point.**
Cloudflare Access authenticates email identities; a guest is by definition not
one. So "wait for Access and then add a participant check" does not produce the
model the owner described — it produces one where guests can be *scored* but can
never *edit*, which may or may not be what he wants (§9.10 Q6).

### What actually closes the gap

The distinguishing material must vary per table, per caller, or both. Two shapes
fall out of the code, and they are complementary rather than alternatives:

- **A per-table capability** — a `tables` row carrying its own join secret,
  threaded the way the passcode is today. This gives a real table boundary even
  under a shared-secret model, and it handles guests, because a join code needs
  no email. Its cost is known and bounded: attribution stays anonymous *within* a
  table, so you cannot tell which of four seated people made an edit.
- **Per-user identity from Access** — gives truthful attribution, restores
  `createdBy` and `actorPlayerId`, and lets an allowlisted **non-participant** be
  refused, which a table-wide code cannot do once the code leaks.

**The honest sequencing, then:** the `tables` + membership model is the
prerequisite and does not depend on Access. Access determines how *fine-grained
and attributable* the resulting permission can be. In practice you want both, and
**you should still not start until Access lands**, because building the
membership model against an identity that returns `null` for everyone means the
permission code cannot be tested — it would degrade to "everyone is admin" exactly
as `updateProfile` did, and pass its own tests while doing so.

---

## 9.5 Schema implications

Reporting what the schema supports; not proposing a final design.

**Nothing today can carry a table identity.** `notes` is user-authored prose with
its own mutation; `playedAt` groups into nights, and same night ≠ same table;
`createdBy` is an actor, not a session, and cannot distinguish two tables started
from the same phone. There is no parent/group/session id anywhere.

**Adding one is cheap and additive.** The file already establishes the pattern —
`config.winBy` was added later as an optional field with `toCoreGame` filling the
default on read, so old rows still validate. An optional `tableId` on `games`
plus an index is additive with no backfill; every existing row reads as "no
table". Note `by_status` is `["status"]` today and would want to become compound
to query live games per table.

**Whether a separate `tables` table is genuinely required depends on one
question:** must a table exist *before or without* a game? If a table is only a
grouping label on concurrent games, no new table is needed. If it needs a host, a
display name ("Board 1"), an open/closed lifecycle, a join code, or a roster of
people seated but not yet playing — none of which has any home today — then yes.
**Everything the owner described implies the latter.**

A membership record is also required, and **`games.teams` cannot serve as one**,
for three independent reasons:

1. **Semantics.** `teams.{A,B}.playerIds` records who is *playing*, not who may
   *edit*. A spectator, a scorekeeper who is not playing, and a guest who is
   playing but has no account are all unrepresentable.
2. **Indexing.** `playerIds` is an array nested inside a `v.object`. "Which
   tables am I seated at" is not answerable by index — it needs a full scan.
3. **Lifecycle.** A table persists across games ("same four, next game"), so a
   table is a *container of games*, and a per-game array cannot express that.

---

## 9.6 Guests

**The good news:** §3.6's "players ≠ users" principle already carries this, and
it is real in the schema, not just prose. `players.email` and
`players.authSubject` are both `v.optional`, and `players.create` already accepts
an optional email and inserts an emailless, active row. So a guest is
representable **as a subject of record** today, with no migration.

**Two consequences to design against, both verified:**

1. **A guest is not representable as an actor.** `resolvePlayer` matches only on
   `authSubject` or `email`; `allowlist.email` is required. A row with neither
   matches nothing and `assertAllowlisted` throws. This is the §9.4 gap.
2. **A guest created this way is `isActive: true`**, so it would appear in every
   seat picker *and* on the all-time leaderboard, both of which include all
   active players (`store.tsx:353-356`, `stats.ts:34`). "Dave's mate from the
   pub" would accrue lifetime stats and a rank. Almost certainly not wanted —
   see §9.10 Q7.
   > ⚠️ **Corrected: not "permanent".** `players.setActive` already exists
   > (`players.ts:73-80`, admin-only), added for exactly this shape of problem —
   > `schema.ts:43` describes it as hiding *"retired regulars from the player
   > picker without losing history"*. **The data-layer mechanism is already
   > built; no screen exposes it.** That changes Q7 from "we need a mechanism"
   > to "we need to wire up the one we have, and decide when it fires."

The one existing add-a-person UI is admin-only and **hard-requires an email**
(`AdminScreen.tsx:245` disables submit unless the address contains `@`), so the
guest path needs new UI regardless.

---

## 9.7 Standings and the night model

The night model mostly survives, because `nightKey` and friends take whatever
array you hand them. What needs an explicit decision is **what a standing means
when two tables run at once**, and that is a product question, not a technical
one (§9.10 Q3).

Note the settlement is unaffected either way: `useNights` / `convex/stats.ts:nights`
sum per player across a night, which stays arithmetically correct with concurrent
tables. They simply offer no per-table sub-grouping.

---

## 9.8 How it composes with Phase 3

This is the part that gets *better*, and it is why the idea is worth taking
seriously rather than filing as scope creep.

§5.3 already specifies the architecture without knowing about tables:

> Capture device runs inference locally, calls `recordShot({ gameId, … })`.
> Viewers `useQuery(api.games.liveState, { gameId })`. Convex re-runs the query
> and pushes over its managed WebSocket.

A table is a physical board. A camera watches one board. **So a table maps 1:1
onto a capture device, and the `gameId` scoping §5.3 already assumes becomes
table-scoped for free.** The "spectator" role this section introduces is exactly
the "viewer" role §5.3 introduces — one concept, arrived at from two directions,
which is usually a sign the decomposition is right.

It also sharpens §5.3's auditability claim: with a host and a seated roster, a
disputed shot has a known set of people entitled to correct it.

---

## 9.9 What Convex gives us, and what we would build

Researched against Convex's docs and component directory on 2026-08-12.

### Free

- **Real-time spectating needs no new machinery.** Convex tracks each query's
  data dependencies and re-pushes to every subscriber: *"Every client
  subscription gets updated simultaneously to the same snapshot of the
  database… You don't have to do anything special."* A spectator is an authorized
  subscriber to a query, not a new transport. This is the same mechanism §5.3
  relies on.
- **Transactional safety between two people at one board.** Mutations run under
  **true serializability** — explicitly stronger than snapshot isolation — via
  OCC, and Convex silently re-runs the loser of a conflict. ⚠️ **But see the
  idempotency warning below; this is not the same as safe.**
- **`@convex-dev/rate-limiter`** — official, transactional, token-bucket or
  fixed-window, with sharding and a `throws: true` mode. The right tool for a
  guessable join code. **Key the limit on the actor (session/IP/user), never on
  the code** — and pick a code space large enough that brute force is infeasible,
  because rate limiting alone does not rescue a 4-digit code.
- **`@convex-dev/presence`** — official, room-scoped, heartbeat-based, handles
  tab-close disconnects, ships a `FacePile`. ⚠️ **But presence is not seating.**
  It tells you who is *looking at* a table, never who is *seated at* it. It is
  orthogonal to this section's permission model, and useful for the spectator
  count rather than the roster.

### Sanctioned patterns to follow rather than invent

Convex's official authorization guidance is a **ranked** list, and it matters
that we follow the ranking rather than reaching for the most powerful tool:

1. Client-side gating — UX only, **zero security value**.
2. **Endpoint authorization — the primary recommendation**, "co-locating
   authorization with user intent". Membership as a join table with a
   `by_tableId_userId` index plus an `ensureSeatedAtTable(ctx, tableId)` helper
   that throws. This is exactly the shape §9.5 arrives at independently.
3. **Parametrized `customMutation`/`customQuery`** from `convex-helpers` —
   explicitly preferred over middleware because it keeps "a single layer of
   wrapping" that is auditable, and it forces every function to declare its
   required role at the definition site.
4. **Row-level security is explicitly a fallback only** — *"if you ever violate a
   data layer rule, it should indicate that there is a bug."* Note the older
   `RowLevelSecurity(...)` entrypoint is **deprecated** in favour of
   `wrapDatabaseReader`/`wrapDatabaseWriter` with a custom function. Do not
   design the table boundary on RLS.

### What we would build ourselves

1. **The entire tables/seats data model.** Convex has no primitive for room,
   seat, host, or member.
2. **Join codes end to end** — generation, collision handling, lookup index,
   expiry, single-use vs reusable, revocation. **Nothing official exists**; this
   is 100% app-level. Convex's own "invite" surfaces are for Convex *team*
   membership and are unrelated.
3. **Two distinct authorization wrappers, not one** — a strict write path for
   seated players and a separate looser read path so spectators can subscribe
   without write rights.
4. **Table lifecycle and cleanup. ⚠️ Convex has no TTL and no automatic document
   expiry.** The sanctioned pattern is the scheduler (`runAfter`/`runAt`, with
   `cancel`) or a static cron sweeping a `by_lastActivity` index.
   ⚠️ **`@convex-dev/crons` is *not* the TTL answer** — it solves *dynamic* cron
   registration at runtime, versus the built-in `crons.ts` which must be defined
   statically at deploy time. Do not reach for it expecting expiry.
5. **Idempotency for the double-commit case.** This is the one that matters at a
   physical board. Serializability protects the *document*; it does **not** make
   "commit round" idempotent. **Guard it with an expected round number / version
   argument and reject a mismatch.** Four people round one board makes this a
   realistic input, not a theoretical one.
   > ⚠️ **Corrected: the cause is not OCC retry.** An earlier draft said the
   > double-apply happens "because Convex's conflict response is to re-run the
   > mutation". That is wrong — a retry re-runs a **rolled-back** transaction
   > against fresh state, so it recomputes `existing.length` and cannot double
   > apply. The real cause is **two distinct client submissions**, each a valid
   > transaction appending a round. Convex behaves correctly; the *model* is what
   > needs the version guard. Getting this cause wrong would mislead whoever
   > implements it into trusting the retry semantics.
6. **Spectator query shaping.** Reactivity is free; "spectators see less" is not.
   Anything a spectator must not see cannot be in the query result — filtering
   client-side leaks it. Also key spectator queries on `tableId` alone, so N
   spectators share one cached query execution rather than N.

### ⚠️ Cost — a correction to a premise this section originally carried

An earlier draft of this section warned that spectators would burn the free
tier's **1 GB/month egress**. **That is probably the wrong meter**, and the same
conflation appears in **four** other places, all flagged in place: §7.5's ceiling
arithmetic, §7.5's free-tier summary line (which says *one* 1 GB egress line and
so contradicts the two-line reading below), §3.5's *"the egress blow-up vector is
gone"*, and §4.3's *"unbounded-audience surface on Convex egress"*. §3.5 matters
most, because §9.10 Q9 cites it as authority.

Convex's pricing appears to carry **two distinct 1 GB lines** — *Database I/O
(bandwidth)* and *Data egress* — and its definition of **data egress** enumerates
*"downloading files, bandwidth out of your actions, log streams, downloading your
deployment backups"*, a list that does not mention query subscriptions.

⚠️ **State this as an argument from silence, because that is what it is.** An
earlier draft asserted flatly that "query-subscription traffic is not in that
list" and then, nine lines later, called the same question unverifiable. Both
cannot stand. What is defensible:

- The enumeration does not mention subscriptions. **An enumeration's silence is
  not an exclusion**, and no Convex page affirmatively says subscriptions are
  free of egress either.
- The meters fan-out *certainly* pressures are **function calls (1M included)**
  and **Database I/O**, because each write re-runs the query once per distinct
  argument set. That part needs no inference.
- The two-1GB-lines reading is itself second-hand here and is **contradicted by
  §7.5's own summary line**, which lists a single "1 GB egress/mo". One of those
  is wrong. **Re-read the live pricing page before anyone re-derives a cost model
  on it.**

**Do not plan around this in either direction — instrument before assuming.**

**Cost mitigation, with an honest caveat.** The obvious move is to key spectator
queries on `tableId` alone so watchers share a cached execution. ⚠️ **That
probably does not work here**: Convex's query cache keys on identity as well as
arguments once a function reads `ctx.auth`, and §3.2.5 makes `assertAllowlisted`
non-negotiable in *every* query. So the spectator query is per-identity by
construction, and the sharing does not happen. This is in tension with item 3
above (two authorization wrappers) and is unresolved — flagging it rather than
pretending there is a free mitigation.

### One caveat about "stable"

**Convex publishes no stability or maturity labels in its component directory at
all.** "No beta badge" is not "declared stable". The only real signals are npm
version numbers and README warnings — and `@convex-dev/presence` is **v0.4.0,
pre-1.0**, with no documented limitations section and no stated default timeouts.
If anyone claims a component is "officially marked stable", that marking does not
exist.

---

## 9.10 Open questions — for the owner, not for an agent

**Do not let anyone invent answers to these.** Each one changes the data model.

1. **Is a table a session or a game?** Does it persist across "same four, next
   game", or is a new game a new table? This decides whether `tables` is a real
   entity or just a label.
2. **Can a player be at two tables at once?** Physically no; in the data, today,
   yes. Should it be prevented, or merely warned about?
3. **What does the standings screen show when two tables are live?** All tables
   merged (today's behaviour, currently invisible), this table only, or a
   per-table breakdown? This is the biggest UX fork in the section.
4. **Who may host?** Anyone allowlisted, or admins only?
5. **How do people join?** A short code, a QR scan, a list of open tables, or an
   invite? (Note `apps/web/src/features/admin/QrCode.tsx` is a self-contained SVG
   QR renderer that already exists and is reusable.)
6. **Can a guest edit, or only be scored?** §9.4 shows these need different
   mechanisms. If guests must be able to enter scores, a per-table join
   capability is required and Access alone will not do.
7. **What happens to a guest afterwards?** Do they persist as a player, expire,
   or get merged into a real player row later? Do they appear on the lifetime
   leaderboard? (Today they would — but `players.setActive` already exists to
   hide them without losing history; it is simply not exposed in any screen. So
   this is a "when should it fire" question, not a "build a mechanism" one.)
8. **Is a table public or private by default?** The owner said "if the table is
   public", which implies a visibility setting that does not exist yet.
   ⚠️ **Scope this question carefully before asking it.** `00-DECISIONS.md` Q6
   — *"Nothing is public (revised 2026-08-12)"* — closed anonymous access
   app-wide, and §3.5 acted on it. So here **"public" can only mean "visible to
   other allowlisted users"**. Asked unscoped, a reasonable answer reopens Q6 and
   drags back the two-query split, §7.4's path-policy caveat, and the
   unbounded-audience egress surface that §4.3 lists as the price of a public
   route.
9. **Does spectating include money?** §3.5 currently makes earnings visible to
   everyone allowlisted. A spectator at someone else's table seeing their
   settlement is a different call.
10. **Does the existing admin override survive the table boundary, and does it
    move server-side?** ⚠️ **Reframed — the original question ("can a non-seated
    admin fix a mistake?") is already answered.** There *is* an override:
    `HistoryScreen.tsx:57-61` grants Correct/Delete on
    `isSuperAdmin(currentEmail) || participant`, and on the migration branch
    `GameDetailScreen.tsx:113-116` offers "Correct a round" on **any** game with
    no gate at all. The migration's own commit message decides it in prose —
    *"The gate is `isAdmin`, which is true for every caller today and narrows to
    the allowlist's admins the moment identities are real."* So the real
    questions are whether that override should persist once tables exist, and
    that it is currently **client-side only** and therefore not a boundary at all.
11. **What happens when the host leaves or disconnects?** Does the table die, can
    hosting transfer, and does a stale table expire on its own?
12. **Does `presentIds` die entirely?** It is per-device by design, and the
    migration handoff explicitly decided to keep it that way. Making seating
    server-authoritative reverses a documented decision — worth doing knowingly.

---

## 9.11 Positioning and sequencing

**Where this sits:** it is not Phase 2 as written, and it is not Phase 3. It is a
re-scoping of what Phase 1's model *is*, driven by how the app is actually used.
It should be re-reviewed alongside §4.6 rather than slotted into §4's list.

**It is blocked on:**

- **§7's Cloudflare Access work** — not absolutely (see §9.4), but in practice,
  because permission code written against a null identity cannot be tested and
  degrades silently to "everyone is admin".
- **The Convex migration landing**, since it touches `store.tsx` heavily and that
  file is being rewritten right now.
- **§9.10's answers.** Most of them change the schema.

**It is not blocked on:** `burkert.app` (registered), Wave 3 QA, or any Phase 2
item.

**Rough shape of the work**, assuming the questions are answered:

| Piece | Effort | Notes |
|---|---|---|
| `tables` + membership schema, `tableId` on `games` | ~½d | Additive; no backfill |
| Per-table authorization in every game mutation | ~1d | The §3.2.5 rule extends; QA agent H's brief must extend with it |
| Guest seats (create, name, scope, lifecycle) | ~1d | Needs Q6/Q7 answered first |
| Host/join UI, including the tab bar restructure | ~2d | Item 6 in §9.3 is the main thing to redesign first — a redesign, not a hard block |
| Presence → server-authoritative table roster | ~½d | ~44 lines of presence machinery die (`store.tsx:69-77, 141-167, 353-356, 368-369, 389-391`); two screens change |
| Standings/history table dimension | ~1d | Depends entirely on Q3 |

**Do not start any of it while the migration is in flight.**

---

## 9.12 Bugs found while auditing this — reported, not fixed

Both are in `convex/`, which the migration agent owns this wave (§6.1), so they
are reported here rather than touched.

1. 🚨 **`players.claim` skips its admin check entirely under the passcode.**
   `players.ts:107` on the migration branch reads
   `if (caller.player && caller.player._id !== args.playerId) await assertAdmin(ctx);`
   — and `caller.player` is `null` under the interim, so the `&&` short-circuits
   and the guard never runs. **Any passcode holder can claim any player row.**
   This is the most serious of the three and should go to the migration agent
   immediately. See §9.4.
2. **`removeLastRound` never re-derives completion.** `convex/games.ts:292`
   patches `status: "in_progress"` unconditionally, where `updateRound`
   (`games.ts:262-267`) correctly recomputes via `gameStanding` with the comment
   *"A correction can un-finish a game as easily as finish one."*
   ⚠️ **Corrected — the consequence was overstated on three counts.** It is *not*
   biting today (**no UI calls `removeLastRound` on either branch** — only the
   store's own definition and a `useMutation` wiring exist), it is *not*
   permanent (any later `updateRound` recomputes the status), and it only steals
   the Resume slot when the phantom's `playedAt` is the **newest** among
   in-progress games, since both resolvers take max-`playedAt`. The accurate
   framing is the one the next clause already gave: **pre-existing and latent;
   tables would make it visible.**
3. **`games.setNotes` checks neither existence nor `deletedAt`**
   (`convex/games.ts:322-328`), so notes can be set on a soft-deleted game.
   ⚠️ **Corrected: it is not an outlier.** Only `addRound` checks both
   (`:171-173`); `updateRound` checks existence but not `deletedAt`, and
   `softDelete`, `restore` and `removeLastRound` check neither. **That makes the
   finding bigger, not smaller** — the missing-`deletedAt` check is systemic
   across five mutations, and a table boundary will have to be applied to all of
   them rather than bolted onto one.

Also worth knowing: **`convex/games.ts:inProgress` is dead code** — no client
calls it. If the tables model redefines "live game", it should be redefined or
deleted rather than left as a second, subtly different answer to the same
question (§9.3 item 1).
