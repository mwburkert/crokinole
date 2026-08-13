# Wave 3 — the QA wave

**Three read-only agents, run in parallel, that report rather than fix.**
Specified in `docs/plan/06-ORCHESTRATION.md` §6.3. **It has never run.**

| Brief | Agent | What it attacks |
|---|---|---|
| [WAVE-3-G-RULES-FUZZ.md](WAVE-3-G-RULES-FUZZ.md) | **G** | Property-tests `packages/core` against the spec prose |
| [WAVE-3-H-AUTH-SECURITY.md](WAVE-3-H-AUTH-SECURITY.md) | **H** | Tries to read and write as an unauthorised caller |
| [WAVE-3-I-RECONCILIATION.md](WAVE-3-I-RECONCILIATION.md) | **I** | Hand-computes a night independently and reconciles it |

## How to run them

Each brief is self-contained; hand an agent one file. **Fire them the moment the
Convex migration lands** — they are the gate between "it typechecks" and "it is
trusted".

⚠️ **They are not all safely concurrent, despite being "read-only".** G is pure —
it touches only `packages/core` and can run alongside anything. **H and I both hit
the shared Convex dev deployment:** H's Task 1 explicitly *calls every function*
and Task 3 attempts `admin.setRole`, `admin.invite`, `players.claim` and
`games.softDelete`, while I reconciles money against `stats.nights` on that same
deployment. §6.1 names the single shared dev deployment "the single biggest
hazard in this project", and a mutation H fires mid-run is a number I then
reconciles against.

**Run G in parallel with either, but run H and I sequentially** — or give one its
own deployment. If they must overlap, run I first and H second, since H is the
one that writes.

## Why these three are separated from the agents that write the code

An agent that can fix its own findings will, when a test is inconvenient,
quietly change the test to make its bug disappear. Every brief here therefore
forbids fixing anything. The output is a findings report, not a diff.

## H matters most

Cloudflare Access does not protect Convex — the browser opens a WebSocket
straight to `*.convex.cloud`, which no Cloudflare zone fronts (§3.2.5, §7.1).
`assertAllowlisted` is the **only** thing between the public internet and this
data, and one missing call is a full read and write breach.

As of 2026-08-12, on branch `plan/remaining`, all 23 Convex functions call a
guard as their literal first statement. **That is a baseline to re-check against,
not evidence that H would pass.** With `auth.config.ts` emitting `providers: []`
until the Access env vars are set, every one of H's token attacks is refused for
the same trivial reason — they pass *vacuously* and prove nothing about AUD
isolation. A real H run needs Access live. The migration also adds functions, and
the interim shared passcode is exactly the kind of temporary bypass that outlives
its reason.

The sibling audit on the same day found this failure mode already live in the
neighbouring app: meal-planner's Convex `kv` functions are public with no caller
check at all. It is not a hypothetical.

## The standard every report is held to

**A clean report is only credible with its gaps declared.** No brief accepts
"everything looks fine" — each requires the coverage that backs the conclusion
and an explicit list of what could not be tested and why. Confident wrongness is
the failure mode these agents exist to catch, so they must not introduce it
themselves.
