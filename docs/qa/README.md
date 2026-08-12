# Wave 3 — the QA wave

**Three read-only agents, run in parallel, that report rather than fix.**
Specified in `docs/plan/06-ORCHESTRATION.md` §6.3. **It has never run.**

| Brief | Agent | What it attacks |
|---|---|---|
| [WAVE-3-G-RULES-FUZZ.md](WAVE-3-G-RULES-FUZZ.md) | **G** | Property-tests `packages/core` against the spec prose |
| [WAVE-3-H-AUTH-SECURITY.md](WAVE-3-H-AUTH-SECURITY.md) | **H** | Tries to read and write as an unauthorised caller |
| [WAVE-3-I-RECONCILIATION.md](WAVE-3-I-RECONCILIATION.md) | **I** | Hand-computes a night independently and reconciles it |

## How to run them

Fire all three at once — they are independent and read-only, so they cannot
collide. Each brief is self-contained; hand an agent one file.

**Fire them the moment the Convex migration lands.** They are the gate between
"it typechecks" and "it is trusted".

## Why these three are separated from the agents that write the code

An agent that can fix its own findings will, when a test is inconvenient,
quietly change the test to make its bug disappear. Every brief here therefore
forbids fixing anything. The output is a findings report, not a diff.

## H matters most

Cloudflare Access does not protect Convex — the browser opens a WebSocket
straight to `*.convex.cloud`, which no Cloudflare zone fronts (§3.2.5, §7.1).
`assertAllowlisted` is the **only** thing between the public internet and this
data, and one missing call is a full read and write breach.

As of 2026-08-12 all 23 Convex functions call a guard as their literal first
statement, so H would pass today. **That is the baseline it must be re-checked
against after the migration, not a reason to skip it** — the migration adds
functions, and the interim shared passcode is exactly the kind of temporary
bypass that outlives its reason.

The sibling audit on the same day found this failure mode already live in the
neighbouring app: meal-planner's Convex `kv` functions are public with no caller
check at all. It is not a hypothetical.

## The standard every report is held to

**A clean report is only credible with its gaps declared.** No brief accepts
"everything looks fine" — each requires the coverage that backs the conclusion
and an explicit list of what could not be tested and why. Confident wrongness is
the failure mode these agents exist to catch, so they must not introduce it
themselves.
