# Section 2 — GitHub Repo Setup & Protection

Target: **`mwburkert/crokinole`**. Verified against GitHub docs as of Aug 2026.

---

## 2.0 Public or private — RESOLVED: public

### The misconception worth clearing up first

**A public repo is readable, not writable.** No one outside your collaborator list can push to
it — ever. Outsiders can fork it and open a pull request, which does nothing until *you* merge
it. On the axis you actually care about — *"can someone change my code in a way that affects my
apps or data?"* — public and private are **identical**. Nobody can, in either case.

What protects your apps from unwanted change is the **ruleset** (§2.3), and that's precisely
what a free *private* repo doesn't get.

### Your data is not in your repos

Verified rather than assumed:

- meal-planner's `data/` — the actual meal DB (`meal-planner.db`) and recipe cache — is
  **gitignored and has never been committed**. `git ls-files data/` returns nothing.
- The only env file in its history is `.env.example`, containing placeholders
  (`your@email.com`, `choose-a-long-random-password`). No real credential is in git.
- **All three apps' data will live in Convex** (revised 2026-08-12 — Turso is dropped). Real
  secrets live in the Render and Convex dashboards, never in the repo.

So "what we're eating, passwords, emails" is not exposed by repo visibility. It's a separate
system, protected by §7's allowlist.

### The three options

| | Free + **public** | Free + private | Pro ($4/mo) + private |
|---|---|---|---|
| Outsiders can change your code | ❌ no | ❌ no | ❌ no |
| **Your agents can force-push `main`** | ✅ blocked | ⚠️ **nothing stops them** | ✅ blocked |
| Required CI before merge | ✅ | ❌ | ✅ |
| Secret push protection | ✅ free, default on | ❌ | ❌ needs separate paid add-on |
| Actions minutes | ♾️ unlimited | 2,000/mo | 3,000/mo |
| Code readable by others | yes | no | no |
| Cost | $0 | $0 | $48/yr |

**Free + private is the worst option**, and it's worth being blunt about why: it gives you
none of the protection while feeling safer. The threat model for these repos isn't strangers —
it's **your own agents**, running in parallel with `--dangerously-skip-permissions`.

Note also that **Pro does not include secret push protection** on private repos — that's
GitHub Secret Protection, a separate paid add-on. So going private costs $48/yr *and* still
loses the scanning. ⚠️ Verify this if it's decisive for you.

### Verdict

**Public for crokinole and oh-heck.** Both are new, so their history is clean by construction,
and public buys you full branch protection and secret scanning for $0.

**meal-planner is your call** — its history is clean, so public is safe, but nothing forces the
change. The sharper point: it's the repo with an **agent actively working in it right now**,
and it currently has *zero* enforcement. If any repo needs protection today, it's that one.

**Long term:** buy Pro when you have a repo that genuinely must be private — client work, or
something with embedded data. Paying $48/yr today to hide a crokinole scorekeeper isn't worth
it.

### The residual risks of public, and how each is handled

1. **An accidental secret commit is world-readable instantly** and scraped by bots within
   seconds. On a public repo you'd at least *find out* fast. Mitigations: push protection (free,
   on by default) plus the gitleaks pre-commit hook in §2.5. If one ever lands, **rotate the
   credential — don't just delete the commit.**
2. **⚠️ Never commit the allowlist.** §3.3's `allowlist` table holds your friends' real email
   addresses. Seed it in the **Convex dashboard**, never in a committed seed script or test
   fixture. Same for any fixture using real names/emails — use fake ones.
3. **⚠️ Never use `pull_request_target` in a workflow.** It's the one Actions footgun that
   exposes secrets to a fork's PR. Plain `pull_request` (what §2.4 uses) runs fork PRs *without*
   secrets, which is what you want.
4. **Architecture is visible.** Minor, given the real boundary is enforced in Convex (§7.1) —
   and `VITE_CONVEX_URL` ships in the client bundle regardless of repo visibility.

The commands below assume **public**.

---

## 2.1 Guard against the wrong account

`gh` currently reports **`mwburkert-struct` as the active account**. A bare
`gh repo create crokinole` would put your crokinole app under your work account.

```powershell
gh auth switch --user mwburkert
gh auth status          # confirm: "Active account: true" under mwburkert
```

Every command in this section passes the fully-qualified `mwburkert/crokinole` owner as a
second line of defence. Do not shorten them.

---

## 2.2 Create and push

From `C:\dev\crokinole` (after the §1.3 move):

```powershell
gh repo create mwburkert/crokinole --public --source=. --remote=origin --push

gh repo edit mwburkert/crokinole `
  --enable-squash-merge `
  --enable-auto-merge `
  --enable-merge-commit=false `
  --enable-rebase-merge=false `
  --delete-branch-on-merge
```

Squash-only + linear history is deliberate: every agent PR becomes exactly one commit on
`main`, so a bad agent change is one `git revert` away.

**Rename the default branch to `main`.** Your local branch is currently `master`, and your
other repos use `master` too — but `main` is the modern default and this is a fresh repo:

```powershell
git -C C:\dev\crokinole branch -M main
git -C C:\dev\crokinole push -u origin main
```

---

## 2.3 Branch protection ruleset

```powershell
gh api -X PUT repos/mwburkert/crokinole/actions/permissions/workflow `
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

Then the ruleset (run from Git Bash, or save the JSON to a file and use `--input`):

```bash
gh api -X POST repos/mwburkert/crokinole/rulesets --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [ { "context": "ci" } ] } }
  ]
}
JSON
```

**Why `required_approving_review_count: 0`.** GitHub hard-blocks a PR author from approving
their own PR, with no override. Requiring 1 approval on a solo repo is a permanent deadlock.
**CI is your reviewer** — that's what `required_status_checks` is for, and it's the rule that
actually stops a bad agent merge.

`strict_required_status_checks_policy: true` forces a branch to be up to date with `main`
before merging, so two agents can't both merge green-but-stale work.

Set **bypass to nobody**. You can always edit the ruleset as owner — that makes overriding a
deliberate act rather than a reflex.

---

## 2.4 CI workflow

`.github/workflows/ci.yml`. The job id **must** be `ci` to match the required check context above.

```yaml
name: ci
on:
  pull_request:
  push: { branches: [main] }
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci --workspaces --include-workspace-root
      - run: npm run -ws --if-present typecheck
      - run: npm run -ws --if-present lint
      - run: npm run -ws --if-present test
```

Node 24 matches your local `v24.16.0`. Keep it **one job** — a matrix costs wall-clock setup
time and gives an agent more checks to misread.

Pin any **third-party** action to a full commit SHA. First-party `actions/*` at a major tag is
acceptable risk.

---

## 2.5 Secrets

Public repo ⇒ secret scanning and push protection are on by default. Add a local layer so a
secret never reaches GitHub in the first place:

```bash
# .husky/pre-commit — commit this so every agent worktree inherits it
gitleaks git --pre-commit --staged --redact --no-banner .
```

> Note: `gitleaks protect` was deprecated in v8.19 — use `gitleaks git`.

`.gitignore`:

```
node_modules/
dist/ build/ .vite/ coverage/
.env .env.*
!.env.example
.convex/
*.pem *.key
.DS_Store
```

Convex specifics: `npx convex dev` writes `CONVEX_DEPLOY_KEY` and `CONVEX_DEPLOYMENT` into
`.env.local`. It self-adds to `.gitignore`, but pin it yourself. Real backend secrets go in the
**Convex dashboard** env vars, never the repo.

---

## 2.6 Repo conventions — what earns its keep

**Adopt:**

- **Conventional commits.** With squash-merge the PR title *becomes* the commit message, so
  enforce the format on PR titles. Gives agents a machine-checkable contract.
- **PR template** (`.github/pull_request_template.md`). This is the highest-leverage file in
  the repo for agent work — it's a prompt injected into every agent's workflow. Keep it to
  three prompts: *what changed / how you verified it / what you deliberately didn't do*.
- **`AGENTS.md` + `CLAUDE.md` at root.** Build commands, branch naming, and the hard rules:
  never force-push, never merge red CI, never edit `main` directly.

**Skip as overkill for this project:** CODEOWNERS (inert without required reviews you can't
satisfy), CHANGELOG, issue templates, and any Dependabot config beyond weekly grouped npm updates.

---

## 2.7 Parallel-agent hygiene

- **Branch naming:** `crok/<wave>-<slug>` (e.g. `crok/w1-core-scoring`). The §1.4 `branchPrefix`
  change gives you this automatically.
- **One `git worktree` per agent.** Prevents index/HEAD corruption from concurrent checkouts.
  Each worktree needs its own `npm ci` — the §1.5 setup hook handles that.
- **⚠️ The Convex collision.** Every worktree pointing at the same Convex **dev deployment**
  will fight: each `convex dev` push overwrites the others' functions. This is the single
  biggest parallelism hazard in this project. Mitigation in §5.2 — **exactly one agent owns
  `convex/` per wave.**
- Scope agents by workspace (`packages/core`, `apps/web`, `convex/`) so diffs rarely overlap.
- Agents merge with `gh pr merge --auto --squash` — lands only when CI is green, no human gate.

---

## 2.8 Checklist

- [ ] Decide **Q1: public or private** (§2.0).
- [ ] `gh auth switch --user mwburkert`; verify with `gh auth status`.
- [ ] `git branch -M main`.
- [ ] Create repo, push, set merge settings (§2.2).
- [ ] Set Actions token to read-only (§2.3).
- [ ] Add `ci.yml` and push it — **before** the ruleset, so the `ci` check exists.
- [ ] Apply the ruleset (§2.3).
- [ ] Add `.gitignore`, gitleaks hook, PR template, `AGENTS.md`/`CLAUDE.md`.
- [ ] Verify: open a throwaway PR with a failing test and confirm merge is blocked.
