# Section 1 — Orca Workspace Setup

Everything here is derived from your actual config at
`C:\Users\mwbur\AppData\Roaming\orca\orca-data.json`, not from assumption.

---

## 1.1 What I found

| Setting | Current value | Verdict |
|---|---|---|
| `settings.defaultTuiAgent` | **`"codex"`** | ❌ Needs to change — this is the "default agent" knob |
| `settings.claudeAgentTeamsMode` | `"off"` | ⚠️ Turn on for parallel Claude agents |
| `settings.workspaceDir` | `C:\dev` | ✅ Keep — but crokinole is in the wrong place (see 1.3) |
| `settings.nestWorkspaces` | `true` | ✅ Worktrees nest under the repo |
| `settings.branchPrefix` | `"git-username"` | ⚠️ Root cause of the account bleed (see 1.4) |
| `settings.agentDefaultArgs.claude` | `--dangerously-skip-permissions` | ✅ Already set |
| `settings.agentDefaultEnv` | `{"goose": {...}}` only | ➕ Add a `claude` entry (see 1.5) |
| `settings.promptCacheTimerEnabled` | `false` | ➕ Enable — you're running long agent sessions |
| `settings.enableGitHubAttribution` | `false` | ✅ Fine, personal project |
| `settings.keepComputerAwakeWhileAgentsRun` | `true` | ✅ Correct for long fan-outs |

### The important structural finding

**Orca has no per-project agent setting.** A `projectHostSetups[]` entry contains only
`path`, `displayName`, `kind`, `hookSettings`, `gitUsername`, and `setupState`. There is no
`defaultAgent` field at the project or repo level — I checked every entry.

So "make Claude the default for this project" is **not** a per-project config change. It
resolves to three real mechanisms, and you should do all three:

1. Flip the **global** `defaultTuiAgent` to `claude` (§1.2).
2. Commit the agent-selection convention into the repo so any agent that opens it knows
   the rules (§2, `AGENTS.md` + `CLAUDE.md`).
3. Use Orca **automations** to pre-seed Claude tabs for this project (§1.6).

### A second structural finding

**Orca `projects[]` are keyed `github:owner/repo`.** Your three registered projects are
`github:shuangly/imcheck-web`, `github:mwburkert/anylist-meal-planner`,
`github:mwburkert/oh-heck-chaos-monkey`.

`crokinole` has **no git remote**, which is why it does not appear in Orca at all. This
sets a hard ordering constraint on the whole plan:

> **The GitHub repo (Section 2) must be created before Orca can manage this project.**
> Section 1 cannot be fully completed before Section 2. Do §2.1–§2.3 first, then return here.

---

## 1.2 Claude for this project only — global default unchanged

**Decision (Q7): leave `defaultTuiAgent` as `codex`.** meal-planner and imcheck-web keep
working exactly as they do today.

Since Orca has no per-project agent field, "Claude for crokinole" is achieved with three
layers, in descending order of how much work they save:

**1. Automations (the real mechanism).** Each saved automation in §1.6 pins its agent. Launch
work from an automation rather than a bare tab and you never touch the picker. This is the
whole reason §1.6 exists — with the global default staying `codex`, automations go from
convenience to *the* way you start work here.

**2. `CLAUDE.md` + `AGENTS.md` committed at the repo root.** Both files are read
automatically — `CLAUDE.md` by Claude, `AGENTS.md` by Codex and most others. Put the §6.5
rules in `AGENTS.md` and have `CLAUDE.md` include it, so the project behaves correctly
*whichever* agent opens it. This is worth doing regardless, and it's the layer that actually
protects the repo.

**3. The tab picker.** For one-off tabs, select Claude manually. With `defaultTuiAgent` at
`codex`, this is the failure mode to watch: a tab opened out of habit gets Codex.

> ⚠️ **Consequence to accept:** a plain new tab in this project **will default to Codex.**
> There is no config that changes this without changing it everywhere. If that turns out to be
> annoying in practice, the options are to flip the global default after all, or to disable
> `codex` in `disabledTuiAgents` — currently empty — which is also global.

**Verification:** launch the `crok: build task` automation and confirm the tab comes up as
Claude.

> Do not hand-edit `orca-data.json` while Orca is running; it rewrites the file on exit and
> will silently clobber your change.

---

## 1.3 Move the repo to `C:\dev\crokinole`

Your two other personal projects are registered from `C:\dev`:

- `C:\dev\meal-planner`
- `C:\dev\oh-heck-chaos-monkey`

crokinole is currently at `C:\Users\mwbur\orca\projects\crokinole`, which is off-convention
and inconsistent with `workspaceDir = C:\dev`. With `nestWorkspaces = true`, agent worktrees
will nest under the repo directory, so you want it on the same fast local path as the others.

The repo is empty apart from one commit, so this is free to do now and annoying later.

```powershell
# Orca must be closed, and no agent tabs open on this path.
Move-Item "C:\Users\mwbur\orca\projects\crokinole" "C:\dev\crokinole"
```

Then re-add it in Orca as a project pointing at `C:\dev\crokinole`.

> ⚠️ `C:\Users\mwbur\orca\projects\` also contains `oh-heck\oh-heck-chaos-monkey`, which is a
> **second, stale copy** of a repo whose live checkout is `C:\dev\oh-heck-chaos-monkey`.
> Two checkouts of one repo in two places is exactly how an agent commits to the wrong tree.
> Recommend deleting the stale copy after confirming it has no unpushed work — **verify before
> deleting**, don't take this doc's word for it.

---

## 1.4 Fix the account bleed

`branchPrefix = "git-username"` means Orca prefixes new branches with the resolved git
username. That has **already gone wrong**: `C:\dev\meal-planner` has a worktree on a branch
named `mwburkert-struct/new-features` — your *work* account's name on a personal project.

Meanwhile `gh` reports `mwburkert-struct` as the **active** account. So today, a bare
`gh repo create crokinole` would create it under the wrong account.

Two fixes, do both:

1. **Per-repo git identity.** After the move, pin the identity locally so the prefix can
   never resolve to the work account in this repo:

   ```powershell
   git -C C:\dev\crokinole config user.name  "mwburkert"
   git -C C:\dev\crokinole config user.email "58163073+mwburkert@users.noreply.github.com"
   ```

2. **Switch the active `gh` account before any GitHub write** (see §2). The plan's repo-creation
   commands all pass a fully-qualified `mwburkert/crokinole` owner for this reason.

Optional but tidy: set `branchPrefix` to `"custom"` with `branchPrefixCustom = "crok"` so
branches read `crok/round-scoring` instead of carrying an account name at all. This also makes
parallel-agent branch names shorter, which matters in §5's orchestration.

---

## 1.5 Settings to change for efficient multi-agent work

| Setting | Change to | Why |
|---|---|---|
| `defaultTuiAgent` | **leave as `codex`** | Q7 — global default stays put; see §1.2 |
| `claudeAgentTeamsMode` | `on` | Required for the parallel Claude agent teams in §6. Currently `off`. |
| `promptCacheTimerEnabled` | `true` | Surfaces cache-window state; you run long sessions and this makes the pacing visible |
| `agentDefaultEnv.claude` | see below | Keeps Node consistent across agent shells |
| `branchPrefix` | `custom` → `crok` | Shorter branches, no account name (§1.4) |
| `experimentalWorktreeSymlinks` | leave `false` | Symlinked worktrees + Windows + `node_modules` is a known source of pain |

Suggested `agentDefaultEnv.claude`:

```json
{ "claude": { "NODE_OPTIONS": "--max-old-space-size=4096" } }
```

**Per-project setup hook.** meal-planner already has one
(`hookSettings.scripts.setup = "npm install"`). Give crokinole the same, so every fresh
worktree an agent creates is immediately buildable:

- Project → Settings → Hooks → Setup script: `npm install`
- Setup run policy: `run-by-default`
- Launch mode: `new-tab` (matches your current global `setupScriptLaunchMode`)

This is the single highest-value Orca setting for §5, because a parallel agent that has to
work out its own bootstrap wastes a full turn and a lot of tokens doing it.

---

## 1.6 Automations — pre-seeded agent lanes

`settings.automations` is empty. For the §5 orchestration you want three saved automations
on the crokinole project so a build wave is one click instead of six prompts:

| Automation | Agent | Prompt seed |
|---|---|---|
| `crok: build task` | claude | "Read `docs/AGENT_BRIEF.md`, then `docs/plan/03-PHASE-1.md`. Implement task {N} only. Stop at its Definition of Done." |
| `crok: QA pass` | claude | "Read `docs/QA-BRIEF.md`. Review the diff on this branch against the rules in `docs/plan/03-PHASE-1.md` §Scoring. Report findings; do not fix." |
| `crok: rules fuzz` | claude | "Property-test `packages/core` against `docs/plan/03-PHASE-1.md` §Scoring. Report any input where the engine disagrees with the spec." |

Keeping the prompt seeds **short and pointing at committed docs** is the core token
discipline of this whole plan — see §5.4.

---

## 1.7 Checklist

Ordered, with the §2 dependency made explicit.

- [ ] Close Orca. Back up `orca-data.json`.
- [ ] Move repo to `C:\dev\crokinole` (§1.3).
- [ ] Pin per-repo git identity (§1.4).
- [ ] **Go do §2.1–§2.3** — create the GitHub repo and push, so Orca can see the project.
- [ ] Reopen Orca. Add project from `C:\dev\crokinole`.
- [ ] **Leave the global default agent as `codex`** (Q7). Claude comes from the automations.
- [ ] Settings → enable Claude agent teams mode.
- [ ] Settings → prompt cache timer on; `branchPrefix` → custom `crok`.
- [ ] Project → hooks → setup script `npm install`, run-by-default.
- [ ] Create the three automations (§1.6).
- [ ] Verify: new tab defaults to Claude; a new worktree auto-runs `npm install`.
- [ ] Confirm the stale `orca\projects\oh-heck\` copy has no unpushed work, then delete it.
