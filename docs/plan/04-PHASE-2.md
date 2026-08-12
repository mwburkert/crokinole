# Section 4 — Phase 2: Detailed, Not Yet Built

**Status: designed, subject to re-review after Phase 1 ships.** Do not build any of this
until Phase 1 is in real weekly use and you've formed opinions about what's actually annoying.

Everything here is additive. Because Phase 1 stores raw ring counts, per-player rows, and a
snapshotted config, **none of it requires a schema migration** — only new UI and new derived
queries.

> ⚠️ **That additive claim does not extend to [§9 Tables](09-TABLES.md) — added 2026-08-12.**
> The owner has since described a **host/join tables model** (multiple concurrent games, guest
> seats, per-table edit permission, spectators). It is a **direction change, not a Phase 2
> item**: it makes plural three things Phase 1 treats as singletons — "who is here", "the live
> game", and "one trust level" — and it does require schema work. It is written up separately
> in §9 precisely so it is not mistaken for one of the additive items below.
>
> Two items in §4.5 interact with it directly: **#2 night grouping** (already built — see the
> note there) and **#3 running tab**, whose settlement unit becomes ambiguous once several
> tables run at once (§9.10 Q3). Answer §9.10 before building either.

---

## 4.1 Extended shot tracking

The schema fields already exist on `rounds.playerStats` (§3.3). Phase 2 adds the entry UI and
the stats that consume them.

| Field | Definition | Entry UX |
|---|---|---|
| `fouls` | Shot failed to contact an opponent disc when one was on the board (see §3.1 — the real rule). | Stepper per player, collapsed by default |
| `spencers` | Hit a peg and the disc rebounds back toward the shooter. | Stepper |
| `kinseys` | Caused a swing of 25+ points **in the opponents' favour**. | Stepper, with a hint showing the current round differential so it's judgeable in the moment |

**Design note on the kinsey.** A 25+ point swing to the other team's advantage is in principle
*derivable* — if you tracked board state shot-by-shot you'd compute it rather than tap it. You
don't, in Phase 2. So it stays a manual, honour-system tap. It becomes automatic in Phase 3,
and that's a genuinely good reason to want Phase 3.

Keep all three optional and collapsed. The moment stat entry slows down game entry, people
stop entering games at all — which costs you far more than the stats are worth.

---

## 4.2 Full stats engine

All derived by folding over games in `packages/core`. At your volume (~200 games/year), a full
recompute is milliseconds; do not build incremental aggregation.

**Time buckets:** this week / this month / this year / lifetime / custom range. Implement as a
date filter on the same fold, not as separate code paths.

**Per player:**

- games played / won / lost / win %
- match points for / against / differential; **average match points per game**
- rounds played / won / lost / tied
- round points for / against; **average points per round**
- twenties: total, per game, per round
- fouls / spencers / kinseys: totals and per-game rates
- net earnings; biggest single-night win and loss

**Relational stats** — the genuinely interesting ones, and the reason to bother:

- **Best-to-worst partners.** For each partner, your win % when paired with them. Needs a
  minimum-games threshold (5?) or it's dominated by noise — show `n` next to every figure.
- **Hardest-to-easiest opponents**, both as individuals and as pairs.
- **Pair chemistry**: a pair's win % vs. the sum of its members' individual win rates — i.e.
  who actually plays *better together* rather than who's just individually good.

> ⚠️ Sample-size honesty is the whole ballgame here. With 8 players and a weekly game, most
> partner pairings will have single-digit game counts for a long time. Always render `n`, and
> grey out anything under the threshold rather than hiding it.

---

## 4.3 Leaderboard + filters

Phase 1 ships a plain leaderboard, **behind auth like the rest of the app** (revised
2026-08-12 — there is no public route). Phase 2 makes it useful:

- Filter by date range, by player, by partner pairing, by bet amount.
- Sort by any stat column.
- Shareable URL that encodes the filter state, so you can drop "the standings since January"
  into the group chat — note the recipient still needs to be in the `Crokinole Players` Access
  Group to open it.
- **If you ever want a public view**, that's a deliberate Phase 2 decision, and it reopens three
  things Phase 1 closed: the two-query split (money must then be excluded in the query layer, not
  the UI), the SPA path-policy caveat in §7.4, and an unbounded-audience surface on Convex egress
  — anonymous viewers holding reactive subscriptions are the one realistic way usage runs away.
  Serve any public route as a **cached, non-reactive query** if you do it.

---

## 4.4 Comments / activity feed

A single reverse-chronological feed mixing:

- system events — "Game started: Mike & Dave vs Steve & John", "Final: Black 5–3, Mike +$5"
- human comments, threaded on a game or standalone

Convex's reactivity makes the live-update part nearly free. Two things to get right:

- **Cost control:** the feed is the one place where trivially-cheap-per-item becomes
  expensive-in-aggregate. Paginate hard; never subscribe to the full history.
- **Moderation:** with 8 known friends you need exactly one thing — delete your own comment.
  Do not build more.

---

## 4.5 Quality-of-life items worth more than they look

Ranked by (value ÷ effort). These are additions to your spec, not from it — take or leave.

1. **"Same four, next game."** Already in Phase 1 (§3.5) because it's that important.
2. **Season / night grouping.** A "night" is the natural unit — 5 games in an evening. Group
   history by night and show a per-night settlement total, so you settle once, not per game.
   *This is the highest-value item on this list* and arguably belongs in Phase 1.
3. **Running tab.** Rather than cash each night, track cumulative balances. One "settle up"
   action zeroes them and records the settlement.
4. **Handicaps.** If the same pair wins constantly, an optional starting match-point handicap
   keeps games interesting. Config-driven, so it snapshots per game.
5. **Export to CSV.** Cheap insurance against ever feeling locked in.
6. **Photo per game.** One picture of the final board. Costs nothing, and becomes labelled
   training data if you ever pursue Phase 3 (§5.4).

---

## 4.6 Re-review checklist (run this before building Phase 2)

- Which Phase 1 screens do you actually use weekly? Which have you never opened?
- Did anyone ever enter twenties, or was it always skipped?
- Is game entry fast enough that you do it live, or are you entering from memory afterwards?
- Did the money settlement rule (Q3) survive contact with reality?
- What did people ask for that isn't in this document?

Answer these from real use, then re-scope. **This section is a hypothesis, not a commitment.**
