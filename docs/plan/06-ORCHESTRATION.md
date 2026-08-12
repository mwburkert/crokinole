# Section 6 — Multi-Agent Orchestration

How to actually build Phase 1 with parallel agents without them tripping over each other,
and without burning tokens.

---

## 6.1 The two hard constraints

Parallelism here is bounded by two specific things, not by imagination:

1. **⚠️ The Convex dev-deployment collision.** Every worktree pointing at the same Convex dev
   deployment fights: each `convex dev` push overwrites the others' functions. This is the
   single biggest hazard in this project.
   **Rule: exactly one agent owns `convex/` per wave.** Everyone else works against fixtures.
   (Alternative: give each agent its own Convex dev deployment. More setup, more free-tier
   consumption; only worth it if backend work becomes the bottleneck.)
2. **`packages/core` is on the critical path.** T4/T5/T6 all import it. It must land in Wave 1
   and it must be right, because a scoring bug discovered in Wave 2 invalidates three agents'
   work at once.

Everything else parallelises cleanly because the workspaces (`packages/core`, `convex/`,
`apps/web`) have near-disjoint file sets.

---

## 6.2 Wave plan

```
Wave 0  ── solo, sequential ──────────────────────────────
  T0  scaffold + LOCK schema and core API signatures
         ↓ (contract frozen — this is what makes the rest parallel)
Wave 1  ── 3 agents in parallel ──────────────────────────
  A: T1 packages/core + tests        (owns packages/core)
  B: T2 convex schema + functions    (SOLE owner of convex/)
  C: T3 app shell, routing, tokens   (owns apps/web/src/{app,ui})
         ↓
Wave 2  ── 3 agents in parallel ──────────────────────────
  D: T4 entry screen                 (owns apps/web/src/features/entry)
  E: T5 history + detail + edit      (owns .../features/history)
  F: T6 stats + leaderboard          (owns .../features/stats)
         ↓
Wave 3  ── 3 QA agents in parallel, read-only ────────────
  G: rules adversarial / property tests
  H: auth + security review
  I: reconciliation against a hand-computed night
         ↓
Wave 4  ── solo ──────────────────────────────────────────
  T7  seed real historical games; sanity-check stats
```

**Wave 0 cannot be parallelised and shouldn't be attempted.** It defines the contract every
other agent codes against. Doing it solo and carefully is what buys the parallelism later.

**Wave 1 agent C works against fixtures**, not against live Convex — a `fixtures.ts` exporting
a few fully-formed games. This decouples UI from backend entirely and is what lets B and C run
concurrently.

---

## 6.3 The QA wave — how to get real QA, not rubber-stamping

Three agents, all **read-only**, all reporting rather than fixing. Separating find-from-fix is
what stops an agent quietly "fixing" a test to make its own bug disappear.

> ✅ **The full briefs are written and ready to fire — added 2026-08-12.** The table below is a
> summary; the briefs are what you actually hand an agent.
>
> | Agent | Brief |
> |---|---|
> | **G** — rules fuzz | [`docs/qa/WAVE-3-G-RULES-FUZZ.md`](../qa/WAVE-3-G-RULES-FUZZ.md) |
> | **H** — auth/security | [`docs/qa/WAVE-3-H-AUTH-SECURITY.md`](../qa/WAVE-3-H-AUTH-SECURITY.md) |
> | **I** — reconciliation | [`docs/qa/WAVE-3-I-RECONCILIATION.md`](../qa/WAVE-3-I-RECONCILIATION.md) |
>
> **This wave has never run.** It is the gate between "the migration typechecks" and "the
> migration is trusted", and it needs no owner input — see §8.1.

| Agent | Job | Prompt shape |
|---|---|---|
| **G — rules fuzz** | Property-test `packages/core` against the spec prose in `03-PHASE-1.md` §3.4. Generate random legal boards; assert invariants (⚠️ **not** "match points never exceed target+1" — that property is false, see §3.4's `winBy` note; use *a completed game is never level*); differential sign matches winner; totals ≤ `maxRoundPoints(cfg)`. | "Find inputs where the engine disagrees with the spec. Report; do not fix." |
| **H — auth/security** | Try to read or write without being on the allowlist. Confirm **every** query and mutation calls `assertAllowlisted` — there is no public route as of 2026-08-12, so *any* function that returns data to an unauthenticated caller is a bug. Also confirm a token carrying **another app's AUD** is rejected (§7.1). | "You are an attacker with a valid Convex client and no allowlist entry. Enumerate every function and dump the raw wire response of each. Anything that returns data is a finding." |
| **I — reconciliation** | Hand-compute one full night of 5 games from a fixture, then compare against the app's stats output field by field. | "Compute independently first, then compare. Report every mismatch." |

**Agent H matters more than it looks.** Because Cloudflare Access does not protect Convex
(§3.2.5, §7), `assertAllowlisted` is the *only* thing standing between the internet and your
data. One missing call is a full write breach. It's worth a dedicated agent every wave.

---

## 6.4 Token discipline

The plan is designed so agents read little and write focused diffs.

1. **Briefs point at committed docs; they never restate them.** A Wave 2 brief is roughly:
   *"Read `docs/AGENT_BRIEF.md` and `docs/plan/03-PHASE-1.md` §3.5. Implement T4 only. Stop at
   its DoD."* Three lines. The docs are in the repo, so this is cheap and always current.
   This is why §1.6's Orca automations hold prompt *seeds*, not prompt *text*.
2. **Scope by workspace ownership** (the "owns" annotations in §6.2). An agent that knows it
   owns one directory doesn't go exploring the rest of the tree.
3. **Never have six agents each read the whole schema.** The schema is small and lives in one
   place; the DoD tells them which parts matter.
4. **Agents report diff summaries, not file contents.** Put this in `AGENTS.md` so it applies
   to every agent automatically.
5. **Use read-only search agents for lookups** rather than having a building agent grep around
   mid-task.
6. **CI is the reviewer** (§2.3), so agents don't burn turns asking whether they're done — the
   check is objective and automatic via `gh pr merge --auto --squash`.

Rough budget: Wave 1 ≈ 3 agents × 1 focused session. Wave 3 QA agents are cheap because they
read a small, well-specified surface and produce findings, not code.

---

## 6.5 Rules for every agent

Put these in `AGENTS.md` at the repo root so they load automatically:

- Never force-push. Never push to `main`. Never merge red CI.
- One PR per task. Squash-merge only.
- Stay inside your assigned workspace. If you need a change outside it, **stop and report** —
  do not reach across.
- Only one agent may touch `convex/` per wave. If `convex/` isn't yours, use fixtures.
- Never re-implement a scoring rule. Import it from `packages/core`.
- Never store a derived value. If you're adding a `score` field, you've misread the design.
- Report a diff summary, not file contents.
- If a design question isn't answered in `docs/plan/`, ask — don't guess.

---

## 6.6 On using orchestration for the *planning*

You asked whether multi-agent planning would help. It did, concretely — this plan changed in
four places because of it, and it's worth recording which, because it calibrates when to
bother:

- **Terminology** — "crokinole" is not the name of the shot; it's "a twenty". Your "whiff" is
  officially a *foul*, and the real rule is stricter than described (§3.1).
- **Repo visibility** — rulesets aren't enforced on free private repos, which inverts the
  default recommendation from private to public (§2.0).
- **The CV plan** — parallax and the vanishing-twenty problem were not obvious from the
  outside and reshape the whole approach from "photo per round" to "stateful shot diffing"
  (§5.0).
- **The security boundary** — the interaction between Cloudflare Access and Convex's direct
  WebSocket (§7), which is a real hole if you assume the edge protects you.

The pattern that worked: **parallel research agents on independent, factual questions**, each
returning a compact report, consolidated by one writer. What would *not* have worked is
parallel agents drafting overlapping sections of the plan — you get contradictions and pay
twice.
