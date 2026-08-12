## What changed

<!-- A diff summary, not file contents. -->

## Task

<!-- e.g. T4 (entry screen), §3.5. Link the plan section you built against. -->

## Definition of done

<!-- Copy the DoD from docs/plan/03-PHASE-1.md §3.8 and tick it off. -->

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Stayed inside my assigned workspace (§6.2)

## Design rules (tick or explain)

- [ ] Nothing derived is stored — no `score` column, no cached totals (§3.2.1)
- [ ] No scoring rule re-implemented outside `packages/core` (§3.2.2)
- [ ] No hardcoded `15` / `2` / `5` / `12` outside `DEFAULT_SCORING` (§3.2.3)
- [ ] Deletes are soft (§3.2.4)
- [ ] Every new query/mutation calls `assertAllowlisted` — there is no public route (§3.2.5)
