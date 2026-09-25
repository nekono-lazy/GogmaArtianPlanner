# AGENTS.md

## Project

Project root:

```text
GogmaArtianPlanner/
```

This repository contains a static Web application for planning Monster Hunter Wilds Gogma Artian weapon creation.

The initial-release application is intended to:

- Manage partially known RNG state
- Search ideal and practical target weapon candidates
- Compare normal Artian routes and existing Gogma Artian routes
- Plan multiple target weapons together using shared RNG progression
- Track owned rarity-8 normal Artian and Gogma Artian weapons individually
- Guide the user through a finalized production plan one operation at a time
- Detect divergence from the expected plan state and support explicit recalculation
- Persist user data locally in the browser and support JSON export/import

---

## Specification Authority

The files under `docs/` are the v1 implementation specification.

Before making changes, read:

```text
docs/REQUIREMENTS.md
```

Then read every detailed specification relevant to the task:

```text
docs/DATA_MODEL.md
docs/MASTER_DATA.md
docs/RNG_SPEC.md
docs/SEARCH_SPEC.md
docs/PLANNER_SPEC.md
docs/UI_FLOW.md
```

Use this hierarchy:

1. `docs/REQUIREMENTS.md`
2. The task-specific detailed specification
3. Other formal documentation
4. Implementation
5. Tests
6. Chat / handoff

The current specification set is frozen as the initial-release v1 baseline.

If documents conflict, or the requested implementation would change a documented domain contract:

1. Identify the conflicting or affected specification
2. Report the mismatch
3. Do not silently choose a new interpretation
4. Update the specification or obtain an explicit decision before changing domain meaning

Do not invent missing game mechanics or product requirements.

AI coding-agent selection, execution, review, and handoff rules are defined in:

```text
docs/AI_DEVELOPMENT_WORKFLOW.md
```

Before starting or continuing a coding task, follow that workflow in addition to the
relevant specifications.

`AI_DEVELOPMENT_WORKFLOW.md` is an operational development guide, not a product or
domain specification. It does not override the Specification Authority hierarchy above.

---

## Initial Release Technology and Scope

The initial release is a static browser application using:

- React
- TypeScript
- Vite
- IndexedDB
- Dexie.js
- Web Worker
- Vitest
- GitHub Pages

The application must not require:

- A backend server
- A server-side database
- A user account
- Cloud synchronization

Persistent user data remains in the browser unless the user explicitly exports it.

The initial release manages one character/profile at a time.

---

## Out of Scope for v1

Do not implement the following unless the specifications are explicitly changed:

- OCR
- OCR-based owned weapon bulk registration
- Direct REFramework integration
- High-speed or batch execution mode
- Multiple character/profile switching
- Cloud synchronization
- User accounts
- Manual fixed production ordering
- Arbitrary user-defined Planner scoring
- Server-side RNG processing
- Server-side persistence
- Practical-versus-Practical quality ranking
- Consuming an owned Artian weapon as material
- Route-local references to newly generated weapons

Do not add speculative future functionality while implementing a v1 task.

---

## Architecture Rules

Keep UI, domain logic, RNG logic, candidate search, Planner logic, Workers, master data, and persistence separated.

The exact folder layout may evolve, but these boundaries are mandatory:

- RNG Engine must not depend on React
- Candidate search logic must not depend on React
- Planner logic must not depend on React
- Planner calculation must not mutate IndexedDB
- Domain logic must not directly depend on IndexedDB
- Web Workers must not directly manipulate React state
- Workers receive the data required for calculation through typed messages
- Pure calculations should be pure functions where practical
- Persistence should be accessed through repository/service boundaries
- Master data must use stable IDs, never display names as identifiers
- Core game logic must not live inside React components

Recommended responsibility areas include:

```text
src/
  app/
  components/
  domain/
  workers/
  db/
  data/
```

Temporary UI state may use React state or Zustand.

Persistent domain state follows `DATA_MODEL.md` and belongs in Dexie.

---

## TypeScript Rules

Prefer strict, explicit TypeScript.

- Avoid `any`
- Use `unknown` plus validation for untrusted/external data
- Prefer discriminated unions for routes, operations, worker messages, and results
- Do not silently coerce invalid domain values
- Do not use display strings as IDs
- Follow the ID definitions in `DATA_MODEL.md` and `MASTER_DATA.md`
- Preserve tuple and union invariants defined by the specification

A restoration bonus set is exactly five entries.

---

## Calculation Context

All calculation-dependent persisted results must track:

```text
gameVersion
masterDataVersion
rngEngineVersion
appSchemaVersion
```

These form `CalculationContext`.

The Execution lifecycle specification (`docs/PLANNER_SPEC.md` 16) changes Target
lifecycle, OwnedWeapon execution lifecycle, the `preferredOwnedWeaponId` staleness
semantics (`createTargetDefinitionHash()` normalization), PlanStep / reserve
semantics, the expected execution state, and the Undo scope. That revision is
specification-only: it moved none of `CURRENT_CALCULATION_APP_SCHEMA_VERSION`,
`DATABASE_SCHEMA_VERSION`, or `ExportRoot.schemaVersion`. The implementation PR must
audit the current schema and Import compatibility and fix the required version
boundaries there; never infer-migrate existing data into the new meaning.
The first implementation PR (the persistence foundation) added the Target
lifecycle, `OwnedWeapon.executionInProgress`, and `ExecutionSavePoint` persisted
shapes and moved `DATABASE_SCHEMA_VERSION` to 5 and `ExportRoot.schemaVersion` to
7. It switched no calculation semantics - not `createTargetDefinitionHash()`, the
planning-input hashes, `ExpectedPlanState`, PlanStep effects, or reserve - so
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` stayed 11 until the PR that does.
That second PR (the Execution Plan contract) moved
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` to **12** and `ExportRoot.schemaVersion`
to 8, and kept `DATABASE_SCHEMA_VERSION` at 5 because no table or index changed.
It switched `createTargetDefinitionHash()` to the performance definition only, the
planning-input `targetWeaponsHash` normalization, the Plan-dependent
`dependentTargetDefinitionsHash` / `dependentBuildListEntriesHash`,
`ExpectedPlanState.targetExecutionStateHash` and the binding token, the
`PlanStep.executionEffects` projection (same OwnedWeapon ID, Counter-advance versus
production-target Normal, observation binding, target link, compromise label,
target completion), `confirm_owned_ideal`, and the search-side reserve placement
and completion protection. The Execution runtime (Step confirmation, Undo, save
point, abandonment, replan adoption) and the ProductionPlan abandonment / completion
fields are not implemented by it.
The third PR (the Execution runtime core) added the ProductionPlan lifecycle
fields (`abandonmentReason`, `abandonedAt`, `completedAt`), the current
`ExecutionAction` / `execution_operation_uncertain` literals, and the full
`ExecutionUndoSnapshot` (`affectedTargetWeaponsBefore`, `executionSavePointBefore`),
and implemented Plan start (`draft -> active`) plus the `confirmed_expected` Step
confirmation transaction (`src/domain/execution`,
`src/services/execution/productionPlanExecutionService.ts`). It moved
`DATABASE_SCHEMA_VERSION` to 6 (a data-only upgrade filling the lifecycle `null`s of
`draft` / `active` / `stale` Plans; terminal Plans and ExecutionHistory are left as
persisted and fail validation) and `ExportRoot.schemaVersion` to 9 (schema 8 roots
holding a terminal Plan or any ExecutionHistory fail closed). It changed no
calculation semantics, so `CURRENT_CALCULATION_APP_SCHEMA_VERSION` stays 12.
The fourth PR (the Execution unexpected-result runtime) implemented the
`actual_result_different` and `operation_uncertain` record transactions
(`src/domain/execution/unexpectedStepResult.ts`, sharing the Step premises, Counter
advance, target link, in-progress, Undo snapshot, and validation helpers of
`src/domain/execution/stepExecution.ts` with `confirmed_expected`) and the
action-specific ExecutionHistory / ActualResult validation. It added no persisted
field and changed no calculation semantics, so `CURRENT_CALCULATION_APP_SCHEMA_VERSION`
stays 12, `DATABASE_SCHEMA_VERSION` 6, and `ExportRoot.schemaVersion` 9.
The fifth PR (the Execution Undo runtime) implemented Undo of the latest
ExecutionHistory (`src/domain/execution/executionUndo.ts`,
`ProductionPlanExecutionService.undoLatestExecution()`): the request names the
ExecutionHistory ID, which must still be the Plan's latest by
`compareExecutionHistoryOrder()` (`createdAt`, then `id`); the
`ExecutionUndoSnapshot` bodies are restored exactly in one transaction (whole
Normal Counter collection replaced, added OwnedWeapons deleted, updated / removed
OwnedWeapons and changed Targets put, Plan put), the save point whose boundary is the
undone record is deleted, a save point the undone terminal transition deleted is
restored, and the record is deleted with no Undo record added. It added no persisted
field and changed no calculation semantics, so the three versions stay 12 / 6 / 9.
The sixth PR (the Execution save point runtime) implemented recording and restoring
the game save point (`src/domain/execution/executionSavePoint.ts`,
`ProductionPlanExecutionService.recordExecutionSavePoint()` /
`restoreExecutionSavePoint()`). Recording is allowed only for an `active` Plan whose
current Step premises and `expectedStateBefore` hold; it snapshots the whole RngState,
every Normal Counter, the execution scope OwnedWeapons (Route references of the
selected Entries, weapons this Plan's ExecutionHistory registered, weapons in progress
for the Plan) and TargetWeapons (Plan-dependent Targets plus Targets preferring a scope
weapon), the whole Plan, and the latest ExecutionHistory ID by
`compareExecutionHistoryOrder()`, replacing the Plan's one save point with no
ExecutionHistory added. Restoring an `active` / `stale` Plan names the save point's
`recordedAt` (a save point recorded again is refused with `save_point_changed`),
refuses before any write when a snapshot OwnedWeapon, a selected BuildListEntry, or a
Plan-dependent Target is missing (never revived), or when the boundary record is
missing / foreign or the snapshot does not cover its whole formal execution scope
(the same scope recording derives: Route references, weapons registered up to the
boundary, in-progress weapons, completed Steps' tracked weapons, Plan-dependent Targets,
Targets preferring a scope weapon; `save_point_snapshot_invalid`, never filled in from
the current state and kept separate from current-existence refusals), and then in one transaction
restores the snapshot bodies (whole Normal Counter collection replaced, still-existing
snapshot Targets only), deletes the OwnedWeapons registered by later records, returns a
Target outside the snapshot to the before body of the earliest later record that
changed it, deletes the later records, and keeps the save point. It added no persisted
field and changed no calculation semantics, so the three versions stay 12 / 6 / 9.
The seventh PR (the compromise finish runtime) implemented "この武器を妥協品として
確定して終了" (`src/domain/execution/compromiseFinish.ts`,
`ProductionPlanExecutionService.finishProductionPlanAsCompromise()`). The request names
the Plan's current Step, the BuildListEntry, its Target and the weapon the user saw;
none of them is authority, and each is re-verified inside the transaction against the
same Step premises `confirmed_expected` uses plus the Plan's own
`executionEffects.compromiseLabels` projection. Only an `active` current Plan qualifies -
a `stale` Plan never has its checkpoint arrival inferred - and eligibility comes from
`BuildListEntry.intermediateStateSelection` and that label projection, never from
re-evaluating a weapon's performance, `preferredOwnedWeaponId`, or a `practical` status
search. Having reached the checkpoint once is not enough: the offer sits beside 「次の操作へ
進む」, so the checkpoint must still be the weapon's current state. An ordinary checkpoint
is held from its label Step's confirmation until a later Step on the *same tracked weapon*
is confirmed; a checkpoint held at Plan start (7.5.2) is held until its Entry's first
physical Step - the Step that labels it - is confirmed, so
`isIntermediatePinHeldAtRouteStart()`, which stays true for the Entry forever, is never
eligibility on its own. The boundary is the tracked weapon, not the Plan's overall
progress, so another Entry's Step on another weapon leaves the checkpoint intact. In one
transaction it sets
the labelled weapon `status = practical` (protection, slots, scope and Skills untouched),
clears `executionInProgress` for every weapon of that Plan and no other, leaves the
Target `active` with its preference kept, moves the Plan to `abandoned` /
`finished_as_compromise` / `abandonedAt = now` while keeping `currentStepId` and every
Step completion as they were, deletes the Plan's save point into
`ExecutionUndoSnapshot.executionSavePointBefore`, and adds a `finished_as_compromise`
ExecutionHistory with `wasExpected = true`, `recalculationReason = null`,
`actualResult = null` and `createdAt === plan.abandonedAt`, so `causedCompromiseFinish()`
recognises it. It advances no Counter, runs no RNG prediction, added no persisted field
and changed no calculation semantics, so the three versions stay 12 / 6 / 9.
`docs/DATA_MODEL.md` 12 still gives `finished_as_compromise` generic ExecutionHistory
validation only; that record shape is the runtime's, not an added validation contract.
The eighth PR (the user abandonment runtime) implemented "現在Planを破棄する"
(`src/domain/execution/planAbandonment.ts`,
`ProductionPlanExecutionService.inspectProductionPlanAbandonment()` /
`abandonProductionPlan()`) with the 16.10 save point choice. Whether the choice is
required comes from the shared pure helper `deriveRunningPlanSavePointChoiceRequirement()`
- a save point exists and at least one of the Plan's records is ordered after its
boundary by `compareExecutionHistoryOrder()`, with a missing / foreign boundary refused
through the same authority the restore uses - so replan adoption and an approved
breaking change can reuse it. Only an `active` / `stale` Plan qualifies. The request
names the Plan `status` / `currentStepId` / `updatedAt` the user saw
(`plan_abandon_state_changed` otherwise) and a decision: `null` only where no choice
applies (`save_point_choice_required` otherwise), `keep_current` / `restore_save_point`
only where it does (`save_point_choice_not_required` otherwise), each naming the
`recordedAt` of the save point the user saw (`save_point_changed` otherwise). 「キャンセル」
is not a request. Keeping the current state abandons the Plan (`user_abandoned`)
exactly as persisted - `currentStepId`, Step completions, `recalculationReasons`,
every ExecutionHistory record and every Target preference kept - and works for a
`calculation_context_changed` stale Plan too, because ending a Plan is not executing
it. Restoring runs `prepareExecutionSavePointRestore()` unchanged (its CalculationContext
and fail-closed checks included; a refused restore abandons nothing) and abandons the
restored snapshot Plan, whose `recalculationReasons` are the snapshot's own. Both clear
`executionInProgress` of every weapon of that Plan and no other, delete the save point,
and add no ExecutionHistory, so a user abandonment is never undoable. It added no
persisted field and changed no calculation semantics, so the three versions stay
12 / 6 / 9.
The ninth PR (the replan Preview and adoption runtime) implemented 16.8
「現在地点から再計画を試算」 / 「この再計画を採用」
(`src/domain/execution/replanAdoption.ts`,
`src/services/execution/productionPlanReplanPreviewService.ts`,
`ProductionPlanExecutionService.inspectProductionPlanReplanAdoption()` /
`adoptProductionPlanReplanPreview()`). The Preview reads, in one read-only transaction,
the running Plan's token (`planId`, `status`, `currentStepId` - never `updatedAt`) and a
PlannerInput built by the ordinary `createPlannerInput()` from the current persisted
state; the running Plan, its `baseSnapshot` and its conflict resolutions are never
Planner input. The caller runs the existing `PlannerWorkerClient.createConstrainedPlan()`
with `defaultPlannerOrchestrationBounds` (no new Worker protocol) and bundles the result
into a transient, never-persisted `ProductionPlanReplanPreview`. Adoption re-checks, in
one transaction, the token, an adoptable result (a Plan, no `incomplete` search, the
ordinary save-time shape checks now shared through
`src/domain/planner/plannerResultPersistenceValidation.ts`), the 16.10 choice through
`deriveRunningPlanSavePointChoiceRequirement()` and the shared decision assertion, then
the CalculationContext, the new Plan ID (never overwritten), generated Entry collisions
and freshness, the new Plan's `dependentBuildListEntriesHash` /
`dependentTargetDefinitionsHash` over the Build List plus the generated Entries, and
`initialExecutionState` - never the whole-input `targetWeaponsHash` /
`buildListEntriesHash`, so a Plan-independent Target or Entry added after the Preview
never refuses it. The new Plan is started through `prepareProductionPlanStart()` with the
running Plan treated as abandoned (any other running Plan still refuses). On success the
running Plan becomes `abandoned` / `replan_adopted` (current Step, Step completions and
`recalculationReasons` kept), the new Plan and the generated Entries are added (never
put), a weapon in progress for the running Plan moves to the new Plan with its
`startedAt` kept when a selected Entry Route of the new Plan references it and it
exists, and is cleared otherwise; a weapon not in progress never becomes in progress by
adoption, Target preferences stay, the running Plan's ExecutionHistory stays with no
record added, and its save point is deleted. Choosing 「最後のゲーム内セーブ地点へ戻す」
runs `prepareExecutionSavePointRestore()` unchanged and adopts nothing; the old Preview
then no longer matches and a new Preview is required. It added no persisted field and
changed no calculation semantics, so the three versions stay 12 / 6 / 9.
The tenth PR (the Plan-breaking change guard runtime) implemented 16.6 「生産計画を破棄して
保存」 with the 16.10 save point choice (`src/domain/execution/planBreakingChange.ts`,
`src/services/execution/planBreakingChangeGuard.ts`). Every save that can break an
`active` Plan - RNG Setup, Identification adoption, Normal Counter save / confirm /
unconfirm / Debug edit, OwnedWeapon and TargetWeapon save / delete, and the Build List
selection change / Entry delete - goes through one `PlanBreakingChangeGuard` Dexie
transaction; a Build List addition and a staleness refresh cannot break a Plan and are
not guarded. Each change is a pure mutation from the persisted state to its post-state,
its own validation and the existing reference protection included, and is applied and
validated before any Plan decision. Only an `active` Plan is judged (two or more
`active` / `stale` Plans refuse with `running_plan_invariant_violated`); a `stale` Plan
or no running Plan saves as before and touches no Plan, save point, ExecutionHistory or
in-progress mark. `detectPlanBreakingMutation()` judges the whole post-state, side
effects included, by the existing authorities only: `createExpectedPlanState()`'s
`rngStateHash` / `normalCountersHash`, its `ownedWeaponsHash` over the execution scope
weapons (`collectExecutionScopeOwnedWeaponIds()`), the Plan-dependent Targets'
`createDependentTargetDefinitionsHash()` and `createTargetExecutionStateHash()`, and
`createDependentBuildListEntriesHash()`. The reasons reuse `rng_state_changed`,
`normal_counter_changed`, `owned_weapon_changed`, `target_changed` and
`build_list_changed` as transient warning reasons and never stale the Plan. Without an
approval a breaking change is refused (`plan_breaking_change_approval_required`,
carrying the read-only inspection); an approval names the Plan the user saw and the
16.10 decision, and is refused when the Plan moved on, became stale or ended
(`plan_breaking_change_state_changed`) or the change no longer breaks it
(`plan_breaking_change_approval_not_required`); the choice is re-derived through
`deriveRunningPlanSavePointChoiceRequirement()` / `assertRunningPlanSavePointDecision()`.
「現在地点を維持」 applies the change to the current state; 「最後のゲーム内セーブ地点へ戻す」
decides `prepareExecutionSavePointRestore()` first and applies the change again to the
restored state. A change applies only the fields the user changed from what the screen
showed (`applyUserChanges()`; for an OwnedWeapon `applyOwnedWeaponUserChanges()`,
which keeps the stored `kind` as authority - a weapon a restore returned from Gogma to
Normal stays Normal - and applies across kinds only the shared name / memo / protection /
weapon type / element, refusing a change the stored kind cannot hold), so no pre-restore
body is written back over the restore; a save returns the record as finally persisted.
Then the (restored) Plan becomes `abandoned` / `breaking_change_approved` with its
current Step, Step completions and `recalculationReasons` kept, every weapon in progress
for it stops being in progress, its save point is deleted, Target preferences change only
through the change itself, and no ExecutionHistory is added, so it is never undoable. It
added no persisted field and changed no calculation semantics, so the three versions stay
12 / 6 / 9. The Execution Navigator UI followed in the eleventh PR, and the warning /
confirmation UI with its save point choice dialog in the fifteenth.
The eleventh PR (the Execution Navigator core UI) connected the ordinary path in the UI:
「作成開始」 / 「実行ナビを再開する」 on the Production Plan page, and
`src/pages/ExecutionNavigatorPage.tsx` with Step confirmation (「結果一致・次へ」, the
blind observation, `confirm_owned_ideal`), the presentation-only weapon switch guidance,
the compromise checkpoint panel with the confirmed 「この武器を妥協品として確定して終了」,
and the completed / ended Plan views. It reads the current checkpoint through
`listCurrentCompromiseCheckpoints()`, the same still-current authority
`prepareCompromiseFinish()` uses. The divergence records were connected by the twelfth
PR below, Undo, the game save point and the ordinary abandonment by the thirteenth, and the
replan Preview / adoption by the fourteenth; the breaking-change warning UI is still not
implemented.
The same PR then moved the Target link of an existing OwnedWeapon from the Entry's first
physical Step to the **Plan start effect** (`docs/PLANNER_SPEC.md` 16.2 / 16.11,
`src/domain/planner/productionPlanStartEffects.ts`). Draft generation, saving and display
change nothing persisted. `deriveProductionPlanStartTargetLinks()` derives the links from
the Plan's selected Entries alone (a selected Entry whose Route starts from an existing
weapon and performs at least one operation; a weapon several selected Entries start from,
or a Target that would get two weapons, is linked for nobody rather than picked by order),
so no persisted field is added: the execution projection, `prepareProductionPlanStart()`
and the Production Plan screen preview (`inspectProductionPlanStart()`) share that one
authority, and the preview is never write authority. The start verifies the persisted
state against `PlanningInputSnapshot.initialExecutionState` (the pre-start premise), applies
the links with `draft -> active` in one transaction (a Target already preferring its weapon
is not rewritten; a refused or failed start changes neither the Plan nor any link), and
verifies the result against the first Step's `expectedStateBefore` plus Target entity and
preference collection validation. Replan adoption starts its new Plan through the same
start and writes the same links. Only a production-target Normal the Plan registers is
still linked by a Step (`executionEffects.targetLinks` on its registration Step), and the
Navigator never re-announces a link move. This moved `CURRENT_CALCULATION_APP_SCHEMA_VERSION`
to **13**: a version 12 Plan expects the links on its Steps, so every version 1..12
ProductionPlan fails closed with `calculation_context_changed` (Plan compatibility stays
the exact four-field `isCalculationContextCompatible()`). The change does not touch
Candidate Search, BuildCandidate or BuildListEntry snapshot semantics, so an explicit
build-result exception `13 -> [12]` in `COMPATIBLE_BUILD_RESULT_APP_SCHEMA_VERSIONS`
(`isBuildResultCalculationContextCompatible()`) keeps version 12 Candidates and
BuildListEntries usable under 13 - still requiring equal gameVersion, masterDataVersion
and rngEngineVersion and every ordinary staleness check - while version 1..11 build
results stay incompatible. `DATABASE_SCHEMA_VERSION` stays 6 and
`ExportRoot.schemaVersion` 9 because no persisted shape changed.
The twelfth PR (the Execution Navigator divergence UI) connected 16.15 in the Navigator:
「結果が違う」 opens an actual result input whose kind and fixed scope follow the Step
operation (predicted Normal creation: `normal_artian` five slots; Reset / Keep Bonuses:
`gogma_artian` five slots; conversion / Reset Skills: Series / Group Skill with 未入力 kept
apart from スキルなし), starts from no fabricated or expected value, and calls only
`recordActualResultDifferent()`; 「何を何回操作したか分からない」 confirms in a dialog and
calls only `recordOperationUncertain()`. A blind production-target Normal offers no
「結果が違う」, and `confirm_owned_ideal` and legacy Steps offer neither. After a record the
Navigator re-reads the persisted state. A stale Plan whose latest ExecutionHistory (ordered
by `compareExecutionHistoryOrder()`) is an `actual_result_different` record guides to RNG
re-identification - Normal creation to `/normal-counters`, every other operation to `/rng`;
any other stale Plan keeps the generic view.
The same PR then replaced the `operation_uncertain` recovery (`docs/PLANNER_SPEC.md` 16.15,
`docs/UI_FLOW.md` 12.5): the ordinary Identification is an investigation that runs more game
operations, so a Plan stopped by `operation_uncertain` is never sent straight to it. The
Navigator asks whether only the count of the same operation is unknown or another operation /
weapon was used. The first is **Current Position Recovery**
(`src/domain/execution/operationCountRecovery.ts`): the **Recovery Window** is the current Step
plus the consecutive incomplete Steps with the same physical operation identity (operation
type, `executionEffects.trackedOwnedWeaponId`, Counter stream - Gogma for Reset **and** Keep
Bonuses, Skill for conversion / Reset Skills, the `affectedNormalCounterId` Normal Counter for a
Normal creation - and, for a Normal creation, `normalCreationRole`), each with a comparable
recorded `expectedResult` (never a blind Normal or `confirm_owned_ideal`), ending after a Step
with a Target completion. Position 0 is the persisted position, a candidate only where its
result is derivable safely (the tracked Gogma's current `gogma_artian` slots or Skills; a Normal
creation only from the immediately preceding confirmed predicted creation on the same Counter;
never for conversion). The user's observations are matched exactly (ordered five slots and
scope, or both Skills) against the Window only - never the whole Plan, never before the current
Step - with no RNG prediction. One candidate is followed; several are narrowed by performing
the next Plan operation once only when every candidate's next Step is still inside the Window;
none, or several at the Window end, is never guessed. Following it
(`ProductionPlanExecutionService.recoverOperationCount()`, one transaction) re-derives
everything from the persisted state (stale with `execution_operation_uncertain` as the only
reason, that `operation_uncertain` as the latest record of the current Step, dependencies,
`expectedStateBefore`, the unique position the user saw), replays the Window Steps through
`applyExpectedStepTransition()` - the one state transition `confirmed_expected` also uses, so
Counters go through `rngAdvance` and the Counter authority and every Execution effect is
applied - verifies each `expectedStateAfter` and the tracked weapon against the last
observation, returns the Plan to `active` (or `completed`, deleting the save point exactly as
an ordinary completion does), and records one new `operation_count_recovered` ExecutionHistory
(`planStepId` = last replayed Step, or the current Step for position 0; `actualResult` = the last
observation; the Undo snapshot is the stale state). Undo accepts it and returns to the
`operation_uncertain` stale state. Another operation / weapon, or a position that cannot be
fixed, uses `restoreExecutionSavePoint()` after the user confirms the game went back first, or
the existing `user_abandoned` abandonment when there is no save point. `operation_uncertain`
recording itself is unchanged, and `actual_result_different` is unchanged. The new action literal
reuses existing fields, so no table, index, persisted field, Export shape or calculation
semantics changed and the three versions stay 13 / 6 / 9 (an older build refuses an Export
holding it through action validation, all or nothing). The persistent re-identification
reminder on Dashboard / RNG Setup / Candidate Search (16.15, derived from the divergence
records, the Plan state and the Identification provenance the thirteenth PR fixed - never from
RngState.updatedAt) was connected by the sixteenth PR below.
The thirteenth PR (the Execution Navigator state controls UI) connected, in a separate
「実行状態の管理」 section below the Step's game actions, Undo of the latest ExecutionHistory
(`undoLatestExecution()` naming the record the user saw; `undo_history_not_latest` never undoes
another), the game save point (「ゲーム内セーブ済みとして記録」 with a first-record / overwrite
confirmation, its position 「Step N完了時点」 from the save point's own Plan snapshot, and
「最後のゲーム内セーブ地点へ戻す」 only after the game-side confirmation, naming the `recordedAt`
the user saw) and the ordinary 「現在Planを破棄する」 of an `active` / `stale` Plan. The
abandonment dialog is built from `inspectProductionPlanAbandonment()`, never from the displayed
snapshot, and asks 現在地点を維持 / 最後のゲーム内セーブ地点へ戻す / キャンセル only where it says
the choice is required; the restore choice is one `abandonProductionPlan()` call. Display
availability comes from pure read-only Domain helpers sharing the runtime authorities:
`inspectExecutionUndo()` (the same eligibility `prepareExecutionUndo()` applies, now one shared
function) and `inspectExecutionSavePointRestore()` (through
`deriveRunningPlanSavePointChoiceRequirement()`). The `operation_uncertain` recovery keeps its own
save point restore / no-save-point abandonment and now shares
`ExecutionSavePointRestoreDialog`; its RNG re-check guidance after abandonment stays, and an
ordinary abandonment shows none - unless an `actual_result_different` of the Plan is still
unresolved: abandoning resolves no divergence, so the ended view keeps asking for
re-identification (Normal Counters for a Normal creation, RNG Setup otherwise) until the diverged
stream was formally re-identified after that record.
The same PR then fixed the 16.15 resolution authority, because "RngState updated after the record"
described no real re-identification: `RngState.updatedAt` moves on a notes-only save, and a Normal
Counter Setup save never touches the RngState. Existing persisted fields cannot prove a formal
adoption after a divergence (`source === 'observation'` carries no time, `lastObservedAt` /
`candidateCount` / `isConfirmed` are Debug-editable), so it added the Identification provenance
`lastIdentifiedAt: ISODateTimeString | null` to `RngState` (record `schemaVersion` **2**) and to
`NormalArtianCounter` (`docs/DATA_MODEL.md` 6.1 / 6.2). Only `IdentificationAdoptionService.adopt()`
writes the RngState one; only `RngStatePersistenceService.adoptNormalArtianCounterIdentification()`
(the Normal Counter Setup confirmation path) writes the Counter one, and an ordinary Counter save
resets it to `null` when it changes the `counter` value and keeps it otherwise. An RNG Setup save
never writes it. `deriveExecutionReidentificationReminder()`
(`src/domain/execution/reidentificationReminder.ts`) is the 16.15 authority for the Navigator and
the future persistent reminder: per diverged stream (the `affectedNormalCounterId` Counter of a
Normal creation; the RNG Identification for every other operation) the latest
`actual_result_different` is resolved only by `isNormalCounterIdentifiedAfter()` (that very
Counter: `lastIdentifiedAt` strictly after the record, still confirmed and held; another weapon
type's Counter, a manual / Debug save, an unconfirmed record, a `null` / missing Counter never
resolve it) or `isRngIdentifiedAfter()` (`lastIdentifiedAt` strictly after the record and Base
Seed / Skill Counter / Gogma Counter still confirmed, `observation`-sourced and held; a notes-only
save keeps it, a manual edit of one of them un-identifies it). Timestamps are compared only as
canonical UTC ISO strings, and an equal instant or a non-canonical value is never "resolved".
Ending the Plan resolves nothing; a save point restore or Undo that deleted the record does.
`executionReidentificationDestination()` is the shared destination authority. The provenance is
reminder / recovery metadata only: it enters no `searchStateHash`, `ExpectedPlanState` hash,
Candidate / Entry identity or CalculationContext, so `CURRENT_CALCULATION_APP_SCHEMA_VERSION` stays
13, while Dexie moved to `DATABASE_SCHEMA_VERSION` **7** and `ExportRoot.schemaVersion` to **10**,
each filling every RngState / Normal Counter body (tables, save point snapshots, Undo snapshots,
and the save point an Undo snapshot holds as `executionSavePointBefore`)
with `lastIdentifiedAt = null` and never backfilling an adoption time from `updatedAt`,
`lastObservedAt` or `source`.
The fourteenth PR (the replan Preview / adoption UI) connected 16.8 on the Build List and the
Production Plan page (`src/components/execution/useProductionPlanReplanPreview.ts`,
`ProductionPlanReplanPreviewPanel.tsx`, `ProductionPlanReplanAdoptionDialog.tsx`,
`src/services/execution/productionPlanReplanDependencies.ts`). 「現在地点から再計画を試算」 is
offered only for the exact persisted `active` / `stale` Plan of `/plans/:planId` and, on the
Build List, only while `productionPlanRepository.getRunningProductionPlan()` returns a running
Plan (no running Plan keeps the ordinary 「生産計画を作成」 and its Draft save; a failed or
invariant-breaking read offers neither, and no second independent Draft is ever saved beside a
running Plan). The Preview input comes only from `prepareProductionPlanReplanPreview()` - never
the page's `state.input`, the Plan's `baseSnapshot` or a Conflict preparation input - the
calculation runs the existing `PlannerWorkerClient.createConstrainedPlan()` with
`defaultPlannerOrchestrationBounds` on the hook's own Worker (the Build List writes its reviewed
detail settings into `PlannerInput.options`; the Production Plan page passes the request as it
is), and the result is bundled by `createProductionPlanReplanPreview()` and held in React memory
only: never Dexie, never Export, never `savePlannerResult()`. A cancel (`cancelPlan()`, a notice
rather than a failure), a discard, a superseded generation, a route change and an unmount all
drop it, and a late Worker result never lands. The Preview is shown as 「再計画の試算（未採用）」
with 「まだ現在の生産計画は変更されていません」 through the shared `ProductionPlanContent` plus a
read-only Conflict list and the optional three-count comparison of UI_FLOW 16.4; a no-Plan
result and an `incomplete` search (the 10.1 display) are ordinary Previews that offer no
adoption, and adoptability is `describeReplanPreviewAdoptability()` only, which judges the
typed termination first (7.2.1): an `incomplete` search is `incomplete_search` whether or not a
partial Plan exists, a finished search with no Plan and no generated Entry is `no_plan`, and a
no-Plan result carrying generated Entries or a Plan failing the save-time checks is
`invalid_result`; the panel shows exactly one of the three and parses no message text. 「この再計画を採用」
first runs `inspectProductionPlanReplanAdoption()`, whose result alone decides whether the 16.10
choice is asked (its position label comes from `savePointCurrentStepId`); 「現在地点を維持」 and
「最後のゲーム内セーブ地点へ戻す」 (the shared `ExecutionSavePointRestoreDialog` with the
game-side confirmation checkbox) each become one `adoptProductionPlanReplanPreview()` call naming
the `recordedAt` the user saw, never a separate `restoreExecutionSavePoint()`. `adopted`
navigates to the new Plan's `/plans/{id}/run`; `save_point_restored_repreview_required` drops
the Preview, re-reads the running Plan and asks for a new Preview; `replan_state_changed` /
`replan_result_invalid` / `replan_plan_id_collision` (at the inspection or the adoption) drop
the Preview with a Japanese notice and never re-preview or adopt automatically; every other
refusal keeps the Preview and reports through `executionErrorMessage()`. The Draft-only Conflict
recalculation (`replanState`) and what-if are untouched. It added no persisted field and changed
no calculation semantics, so the versions stay 13 / 7 / 10 (`RngState.schemaVersion` 2).
The fifteenth PR (the Plan-breaking change warning UI) connected 16.6 / `docs/UI_FLOW.md` 16.3 on
every guarded screen through one shared controller and dialog
(`src/components/execution/usePlanBreakingChangeApproval.ts`, `PlanBreakingChangeDialog.tsx`,
`planBreakingChangePresentation.ts`): RNG Setup's direct save, the Identification Wizard's
adoption (the Coordinator gained `inspectAdoption()` / `adopt(approval?)` and the
`IdentificationAdoptionPort` `inspectAdoption()`; the reviewed values stay the Coordinator's),
Normal Counter Setup's save / unconfirm / Debug edit / Identification adoption (through the new
`RngStatePersistenceService.inspectNormalArtianCounterIdentificationAdoption()`, the same
mutation the adoption saves), Owned Weapons and Target Weapons save / delete, and the Build List
selection / improvement preference change and Entry delete. Every guarded save runs the
operation's existing validation and confirmations first, then the Application `inspect`, then
either the ordinary save (`approvalRequired: false`, no warning, no UI-side judgement - a notes-only,
name / memo / status-only, Plan-independent or stale-Plan change saves as before) or the warning
built from `inspection.reasons` alone (the five reasons in Japanese, an optional
operation-specific note, 「キャンセル」 / the destructive 「生産計画を破棄して保存」), the 16.10
choice only when `savePointChoiceRequired` (「現在地点を維持」 / 「最後のゲーム内セーブ地点へ戻す」
with the shared `ExecutionSavePointRestoreDialog` game-side checkbox / 「キャンセル」), and the
same save re-run with `{ observedPlan: inspection.observedPlan, savePointDecision }` - never a
rebuilt Plan token, never a separate `restoreExecutionSavePoint()`. A
`PlanBreakingChangeApprovalRequiredError` from an unapproved save (an `active` Plan started
between the inspection and the save) is promoted to the warning through `error.inspection`; the
Coordinator returns to its reviewed state on it instead of an adoption error.
`plan_breaking_change_state_changed`, `plan_breaking_change_approval_not_required`,
`running_plan_invariant_violated`, the save point decision refusals, the restore refusals and a
`transaction_failed` are reported in Japanese by typed code (`planGuardedRefusalMessage()`), never
retried, and the screen keeps its draft. A cancel at any phase saves nothing. An approved save
reports 「…実行中の生産計画を破棄しました。」 and re-reads what the screen shows (the Build List
re-reads the running Plan, so its replan entry gives way to the ordinary Draft creation). At most
one change waits for a decision; the Build List disables its selection controls and delete
buttons while one does, and keeps its per-Entry save chain otherwise. `IntermediateStateSelector`
/ `CandidateCard` gained a display-only `disabled` prop for that. Nothing judges Plan-breaking on
the UI side, nothing is persisted by the UI, no reason is written anywhere, and the Undo, Replan
and `user_abandoned` flows are untouched. It added no persisted field and changed no calculation
semantics, so the versions stay 13 / 7 / 10 (`RngState.schemaVersion` 2).
The sixteenth PR (the persistent re-identification reminder) connected 16.15 「再同定を促す継続表示」
on Dashboard, RNG Setup and Candidate Search through one read-only aggregation
(`src/services/execution/persistentReidentificationReminderService.ts`) and one shared warning
(`src/components/execution/PersistentReidentificationReminderAlert.tsx`,
`persistentReidentificationPresentation.ts`, `usePersistentReidentificationReminder.ts`). The
aggregation reads every ProductionPlan, every ExecutionHistory record, the current RngState and
every NormalArtianCounter, groups the records by Plan, judges every Plan - `completed` and
`abandoned` included, never only the running or latest one - through the unchanged
`deriveExecutionReidentificationReminder()`, and merges the unresolved streams for display only:
the RNG stream once, each Normal Counter ID once (named through the current record's
`weaponTypeId` and the Master, never by parsing the ID), and one flag for the divergences nothing
can resolve (a Step naming no Counter, a missing Step, or a record whose Plan no longer exists,
which is judged against a Plan without Steps so the helper's own fail-closed applies). It decides
no resolution of its own and persists no flag; `RngState.updatedAt`, `source === 'observation'`
alone, a value match, a manual / Debug save and a Plan ending never resolve anything, and an
Undo / save point restore that deleted the record resolves it by absence. The Dashboard shows the
warning above 「次の操作」 without changing `DashboardSummary.nextAction` or any capability; RNG
Setup shows it at the top, names this screen's Identification Wizard (no self-link) with 「手動入力
だけではこの再同定要求は解消されません」, shows the Normal Counter stream too, and re-reads it after a
successful direct save and after an Identification adoption; Candidate Search shows it above the
search conditions with 「この検索に使われる予測位置が、ゲーム側と一致していない可能性があります」 and
adds no hard gate - the search stays available and the warning stays after a search. A failed read
is shown as 「再特定の状態を確認できませんでした」 (formerly 「再同定状態を確認できませんでした」; Issue #90 replaced 同定 with 特定 in the ordinary UI), never as "nothing to re-identify". `operation_uncertain`
stays the Navigator's recovery and enters no persistent reminder. It added no persisted field, no
writer of `lastIdentifiedAt` and no calculation semantics, so the versions stay 13 / 7 / 10
(`RngState.schemaVersion` 2).
The seventeenth PR (the Draft ProductionPlan lifecycle and the Import / Export reference
integrity) fixed a real Export failure: under the old contract every Planner save added a
Draft beside the earlier ones, no UI could list or delete them, and
`productionPlanReferenceIssues()` read every top-level Plan body - status regardless - as
current foreign keys, so a not-yet-started Draft naming a Build List Entry the user had since
removed (`build-list.fnv1a32-*`, an ordinary `createBuildListEntry()` ID) refused the whole
Export with `invalid_reference`. The new lifecycle contract (`docs/DATA_MODEL.md` 11.1 / 14.2 /
14.5 / 15, `docs/PLANNER_SPEC.md` 9.2.15 / 16.2, `docs/REQUIREMENTS.md` 24 / 30) is `draft`
0..1 (the current Draft), `active` + `stale` 0..1 (unchanged), `completed` / `abandoned` 0..N.
The Draft bound is an independent invariant: a Draft beside a running Plan is not refused.
`ProductionPlanRepository.addProductionPlan()` / `putProductionPlan()` refuse a Draft while a
*different* Draft exists (`draft_plan_conflict`; updating the stored Draft under its own ID is
not a second Draft), `getDraftProductionPlan()` fails closed on two, and
`deleteDraftProductionPlans()` is the replacement step:
`PlannerResultPersistenceService.savePlannerOrchestrationResult()` now runs "delete every
Draft + add the generated BuildListEntries + add the new Draft" in its one transaction after
every existing save-time check, so only a fully successful save replaces the previous Draft,
and a refused state, an invalid result, a generated Entry collision, an Entry write failure or
a Plan write failure rolls the deletion back with the rest (the previous Draft survives, no
partial Entry exists); a `plan === null` result writes nothing and keeps it. Only Draft records
are deleted - never an `active` / `stale` / `completed` / `abandoned` Plan, and never the
BuildListEntries, BuildCandidates or Targets a Draft referenced, because no persisted authority
says an Entry belongs to one Draft alone. The old rule that a new Plan save never replaces or
deletes the previous Draft is superseded. Import / Export became lifecycle-aware in
`productionPlanReferenceIssues()`: only a top-level `active` Plan must resolve its
`selectedBuildListEntryIds`, Step `buildListEntryId`, milestone / effect / conflict / rejection
Entry references, Entry-paired Targets, Plan-dependent Targets and milestone Targets against
the current collections; a `draft` (the artifact as generated, whose start
`prepareProductionPlanStart()` still refuses on divergence), a `stale` Plan (the Plan-breaking
guard warns for `active` only, so a stale Plan can legally lose its Entries through ordinary
UI saves; replan / recovery / restore re-verify at runtime) and a `completed` / `abandoned`
Plan (history the user may tidy the Build List behind) are never read as current foreign
keys, while their structural, Master ID, CalculationContext and lifecycle validation is
unchanged. A new Draft collection invariant refuses two or more top-level Drafts with
`invalid_state` (「未開始（draft）の生産計画は同時に1件までです」), counting `root.productionPlans`
only. Nothing else was relaxed: `executionSavePointScopeIssues()` (running current Plan,
`active` snapshot Plan, every snapshot OwnedWeapon ID, the snapshot Plan's selected Entries
and Plan-dependent Targets), ExecutionHistory `planId` / `planStepId`,
`completedByProductionPlanId`, `executionInProgress.productionPlanId`, the Candidate / Entry
Target and Route source references, Master IDs, duplicate IDs and entity validation all
stay. Because the accumulated Drafts of the old contract carry no authority for which one
the user meant, Dexie v7 -> v8 deletes every `draft` ProductionPlan (never picking one by
`createdAt`, `updatedAt` or ID, never cascading to Entries, touching no other table) and the
pure `migrateExportRootV10ToV11()` does the same for a schema 10 root, while a schema 11
root keeps its one Draft. This moved `DATABASE_SCHEMA_VERSION` to **8** and
`ExportRoot.schemaVersion` to **11**; `CURRENT_CALCULATION_APP_SCHEMA_VERSION` stays 13,
`RngState.schemaVersion` 2, `AppSettings.schemaVersion` 1, `PRODUCTION_RNG_ENGINE_VERSION`
and Master `dataVersion` unchanged, because no Planner, RNG or build-result calculation
semantics changed. The `/plans` list UI, Draft deletion UI and the Build List / Dashboard
notices about the current Draft were left to the eighteenth PR.
The eighteenth PR (the Production Plan list UI and the current-Draft entry points)
added the `/plans` route (`src/pages/ProductionPlansPage.tsx`) and the 「生産計画」 entry of
the 計画 navigation group (`docs/UI_FLOW.md` 2.1 / 11.5, `docs/REQUIREMENTS.md` 24). The
list is a read-only projection of `ProductionPlanRepository.getAllProductionPlans()`
(`src/components/planner/productionPlanListPresentation.ts`: `updatedAt` desc,
`createdAt` desc, ID tie-break; status label / tone; the `stale` recalculation reasons
through the new `productionPlanRecalculationReasonLabels`, which names every
`RecalculationReason`; the `abandoned` reason through
`productionPlanAbandonmentReasonLabels`; completed / total Step counts from
`steps[].isCompleted`; the Target count from `createProductionPlanSummary()`), and it
never reconstructs a Plan from a Candidate or an Entry, re-runs the Planner or predicts
RNG. Every status sits in one list; `productionPlanStatusLabels.abandoned` became 終了
(never 破棄済み) because replan adoption and a compromise finish are not a user abandonment.
「詳細を見る」 leads to `/plans/:planId` for every status, 「実行ナビを再開」 only for `active`,
and 「下書きを削除」 only for `draft`, behind a confirmation dialog, through the new guarded
`ProductionPlanRepository.deleteDraftProductionPlan(id)` (`docs/DATA_MODEL.md` 11.1): one
transaction re-reads the exact persisted Plan, refuses a missing Plan with `not_found`, a
stored status other than `draft` with the new `RepositoryError` code
`draft_plan_delete_not_allowed`, two or more Drafts with `draft_plan_conflict`, and deletes
only that ProductionPlan record, never cascading to any Entry, Candidate, Target, weapon,
ExecutionHistory or save point; the UI never calls the generic `deleteProductionPlan()`.
The Build List gained `getDraftProductionPlan()` as a display-only dependency
(`docs/UI_FLOW.md` 10.3): a current Draft is announced with 「下書きを開く」 /
「生産計画一覧を見る」 (beside a running Plan too, as 「未開始の下書きも保存されています。」 with
no second Draft creation), the ordinary 「生産計画の作成」 says the next save replaces it
(an explanation of the existing atomic replacement, no new persistence semantics), and a
failed Draft read is reported and withholds the ordinary creation exactly as a failed
running-Plan read does, never read as "no Draft". The Dashboard's 主要アクション and the
Production Plan page's header link to `/plans`; the Execution Navigator is unchanged. It
added no persisted field, no Domain status and no calculation semantics, so the versions
stay 13 / 8 / 11 (`RngState.schemaVersion` 2, `AppSettings.schemaVersion` 1,
`PRODUCTION_RNG_ENGINE_VERSION` and Master `dataVersion` unchanged).
The nineteenth PR (the owned Ideal notice, the direct Target completion and the completed
Target management; the 38.5-J follow-up of the v1 acceptance audit) connected
`docs/UI_FLOW.md` 8.2 / 8.3 and `docs/SEARCH_SPEC.md` 5.5.5 「操作0 Idealの通知」 on the
Target Weapons and Search screens. The one judgement authority is the pure
`isOwnedIdealForTarget()` / `findOwnedIdealWeaponsForTarget()`
(`src/domain/target/ownedIdealTarget.ts`): a Gogma of the Target's weapon type and element
whose current five slots, scope and Skills pass the existing `satisfiesIdealTarget()` -
never `status`, never `isProtected`, never an RNG prediction - listed in name-then-ID order
so several owned Ideals are all shown and the user picks one. The lifecycle actions live in
their own Application Service (`src/services/crud/targetWeaponLifecycleService.ts`,
`TargetWeaponLifecycleService.inspectCompleteWithOwnedIdeal()` / `completeWithOwnedIdeal()` /
`inspectReopen()` / `reopen()`), never in `TargetWeaponCrudService.save()`, which still
changes no lifecycle. Both are `PlanGuardedMutation`s through the existing
`PlanGuardedPersistence` / `PlanBreakingChangeGuard`: the request names IDs only, the
mutation re-reads the Target and the weapon from the state it runs on and refuses by typed
`TargetWeaponLifecycleError` code (`target_not_found` / `target_not_active` /
`target_not_completed` / `owned_weapon_not_found` / `owned_weapon_not_gogma` /
`owned_weapon_incompatible` / `owned_weapon_no_longer_ideal`) when the screen's judgement is
stale, so no completion is ever saved from an old read. A completion sets the same
OwnedWeapon ID to `status = ideal` / `isProtected = true` with its five slots, scope, Skills
and `executionInProgress` untouched, the Target to `completed` / `completedAt = now` /
`completedByProductionPlanId = null` / `preferredOwnedWeaponId = null`, and clears only the
`preferredOwnedWeaponId` of every other Target preferring that weapon, then passes
`validateTargetPreferredOwnedWeapons()`; a reopening returns the Target alone to `active`
with no completion metadata and no preference and never guesses, un-protects or relabels the
weapon that completed it. Neither touches RngState, any Normal Counter, a BuildCandidate, a
BuildListEntry, ExecutionHistory or a save point, and neither adds a record: whether an
`active` Plan is broken is decided by the unchanged `detectPlanBreakingMutation()` alone
(`target_changed` for a Plan-dependent Target, `owned_weapon_changed` for an execution scope
weapon), with the same warning / 16.10 choice dialog and the same approved
`breaking_change_approved` abandonment. The UI is the shared
`OwnedIdealWeaponNotice` / `OwnedIdealCompletionDialog` / `useOwnedIdealCompletion`
(`src/components/target/`): the Target Weapons list shows the notice per active Target from
the loaded Targets and weapons (after a save too, with no reload), lists only `active`
Targets in 「登録済みの目標武器」 with a matching count, shows `completed` Targets read-only
under 「完了済みの目標武器」 (completed time, a `/plans/:planId` link only when
`completedByProductionPlanId` is set, no edit / delete / enablement / preference control, no
guessed completing weapon) with the confirmed 「未完了に戻す」; the Search screen shows the
notice for the selected active Target beside the conditions without gating the search, and
after a completion cancels a running search, drops the result and the intermediate
selection, re-reads Targets and weapons, and selects the next eligible Target or empties the
Select. It added no persisted field, no Domain status and no calculation semantics, so the
versions stay 13 / 8 / 11 (`RngState.schemaVersion` 2, `AppSettings.schemaVersion` 1,
`PRODUCTION_RNG_ENGINE_VERSION` and Master `dataVersion` unchanged).
The twentieth PR (the v1 Debug required information) connected `docs/REQUIREMENTS.md` 33 /
`docs/UI_FLOW.md` 15 in the UI. Debug Mode stays an observation feature: it changes no RNG
prediction, Candidate Search, Planner, prediction support, persistence semantics, validation,
Execution semantics, Counter advance or Production Engine selection, and Debug Details stays
read-only - it adds no save or edit, and Normal Counter Setup keeps its own existing Debug
editor. `src/pages/DebugPage.tsx` reaches persistence only through the new
`DebugPageDependencies` (`getRngState()` / `getNormalCounters()` /
`getRunningProductionPlan()`, defaulting to the existing repositories in
`src/services/debug/debugPageDependencies.ts`), mounts the reading component only while Debug
Mode is on - so nothing is read and no internal value reaches the DOM while it is off - and
distinguishes loading / loaded / error per read, never reporting a read failure (a Repository
running-Plan invariant failure included) as "no value", "no Counter" or "no Plan". It shows the
persisted `RngState` (Base Seed, Gogma Counter, Skill Counter and Counter Gate with `value` /
`isConfirmed` / `source`, plus `lastIdentifiedAt`, `updatedAt` and `schemaVersion`; a `null`
reads 未設定, never the string "null"), with Counter Gate named as the legacy / diagnostic /
compatibility value Production Prediction never reads; every persisted `NormalArtianCounter`
in a stable Master `sortOrder` -> rarity -> id order independent of the repository's; the one
running (`active` / `stale`) Plan with its identity, CalculationContext, every
`recalculationReason` (typed label plus raw enum, no message parsed) and its current Step
resolved from `currentStepId` inside the stored Plan body - a Draft is never substituted, and
an unresolvable id is reported as the anomaly it is; and the Master `gameVersion` /
`dataVersion` plus `CURRENT_CALCULATION_APP_SCHEMA_VERSION`, named by their internal
identifiers so they are not confused with the Settings screen's
`AppSettings.schemaVersion`. The former placeholder "Future debug sections" list is gone.
The one PlanStep Debug presentation authority is the shared
`src/components/debug/PlanStepDebugDetails.tsx` plus the pure
`planStepDebugPresentation.ts`, used by Debug Details, the Production Plan detail
(`ProductionPlanStepCard`, Debug Mode only) and the Execution Navigator, so none of the three
grows a copy. It shows `PlanStep.debug`, `PlanStep.rngAdvance` (the deltas and
`affectedNormalCounterId`), `PlanStep.expectedResult` raw identifiers and both
`ExpectedPlanState`s' persisted hashes exactly as stored: no delta or hash is recomputed in the
UI, no RNG prediction and no Planner run, `PlanStep.debug === null` reads
「PlanStepDebugInfo: 記録なし」 and is never reconstructed from a Candidate or the current
Counter, and `0` is never confused with an unrecorded value. Each Counter stream reads
`開始 N → 終了 M（delta D）` in text rather than by colour, so a conversion shows Skill +1 and
Gogma +0 and no PRNG internal step count. The Execution Navigator reads Debug Mode from
`useSettingsStore` and shows the block for the current Step only, collapsed, below the Step's
game actions, with a stale Plan saying its prediction may no longer match the current state.
Planner internal inspection stays limited to `PlanStep.debug.plannerReason`, the persisted
`RejectedBuildListEntry` and the persisted `PlanConflict`; no Planner trace, Candidate history
or PRNG dump viewer is added. It added no persisted field and no calculation semantics, so the
versions stay 13 / 8 / 11 (`RngState.schemaVersion` 2, `AppSettings.schemaVersion` 1,
`PRODUCTION_RNG_ENGINE_VERSION` and Master `dataVersion` unchanged).
Issue #103 Phase C (the Production Planner strategy switch) replaced the Production full
Planner run - the bounded Beam Search - with Route commitment plus the deterministic
scheduler (`runPlannerDeterministicSchedule()`,
`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 12 - 15, `docs/PLANNER_SPEC.md` 7). The
one switch is `createProductionPlanWithObserver()`, so the ordinary Planner, the Planner
Worker, B8 constrained re-search, B9 what-if, the B10 recalculation, the replan Preview
and the runtime-unsupported retry all run the same scheduler; no Production strategy
flag exists anywhere (`PlannerInput`, Worker request, `AppSettings`, UI, environment,
query). `createProductionPlanWithSearchRunner()` keeps the one shared tail and lets only
tests, benchmarks and the parity harness inject the Beam Search, which stays as an
oracle until Phase D. For the same PlannerInput the provisional outcome of an unresolved
conflict, the returned `conflicts`, `rejectedBuildListEntries`, the Step order, the Entries
a shared physical action carries and the (removed) Planner-side preferred source preference
can differ, and a persisted ProductionPlan records no generation strategy, so this moved
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` to **14**: every version 1..13 ProductionPlan -
Draft or active - fails closed with `calculation_context_changed` (exact four-field
equality, no Plan exception, no read migration; an active version 13 Plan is replanned
from the current state). Candidate Search, the constrained enumerator and the
BuildCandidate / BuildListEntry snapshot semantics did not change, so the explicit
build-result exception became `14 -> [12, 13]`. The Worker protocol, `PlannerOptions`
(`beamWidth` stays, unused by Production), `PlannerProgress` (`expandedStates` = applied
actions) and `PlannerSearchTermination` are unchanged; the versions are 14 / 8 / 11
(`RngState.schemaVersion` 2, `AppSettings.schemaVersion` 1,
`PRODUCTION_RNG_ENGINE_VERSION` and Master `dataVersion` unchanged).
Issue #103 Phase D-1 (the Production Planner settings and progress Presentation) split Phase D
into D-1 and D-2 (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 14.4). The deterministic
scheduler now stops on `maxPlanSteps` only: it never reads `maxExpandedStates` as a bound and
never reports `max_expanded_states` / `max_expanded_states_reached` (it still counts
`expandedStates` as a diagnostic and still sends `onProgress`), so no hidden default can stop a
run the user allowed more Plan steps. `defaultPlannerOptions.maxPlanSteps` moved from 300 to
**1000** because the Phase B representative fixtures need 330 / 398 scheduler actions
(`docs/ISSUE_103_SCHEDULER_PARITY_BENCHMARK.md`). The Build List detail settings expose
「最大計画ステップ数」 alone (「最大探索状態数」 and 「Beam幅」 removed; the benchmark pages keep them
for the Beam oracle), and the Build List, the replan Preview, the B10 recalculation and what-if
show an indeterminate running state with Cancel instead of an `expandedStates / maxExpandedStates`
ratio; the incomplete display no longer shows 「探索状態数 x / y」. No estimated total Step count
is shown either: physical sharing, silent fast-forward, dynamic release / recommit and deadlock /
stall drops leave no single authority for it. `PlannerOptions` (all three fields,
`beamWidth: 50` / `maxExpandedStates: 10_000` defaults), `PlannerSearchLimitKind`,
`PlannerSearchTermination`, the `PlannerProgress` Worker DTO and the `PlannerBeamSearchResult` name
are unchanged until Phase D-2, and the Beam oracle keeps both bounds. Action selection, Route
commitment and Plan projection did not change and a `maxExpandedStates`-truncated result was never
persisted, so no stored version 14 Plan is read differently: `CURRENT_CALCULATION_APP_SCHEMA_VERSION`
stays 14 and the versions stay 14 / 8 / 11 (`RngState.schemaVersion` 2,
`AppSettings.schemaVersion` 1, `PRODUCTION_RNG_ENGINE_VERSION` and Master `dataVersion`
unchanged).
Issue #103 Phase D-2a (the Production Planner types and Worker contract) split Phase D-2 into
D-2a and D-2b (`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 14.4) and made the Production
types say exactly what Production does. `PlannerOptions` is `{ maxPlanSteps }` alone
(`defaultPlannerOptions = { maxPlanSteps: 1000 }`, `validatePlannerOptions()` checks it alone), so no
Production `PlannerInput` - the ordinary Worker request, B8, B9, the replan Preview - carries
`beamWidth` / `maxExpandedStates`. The Beam Search oracle's contract moved to
`src/domain/planner/plannerBeamSearchTypes.ts`, which no Production module imports:
`PlannerBeamSearchOptions` (`PlannerOptions` + `beamWidth` / `maxExpandedStates`),
`defaultPlannerBeamSearchOptions` (1000 / 50 / 10000), `validatePlannerBeamSearchOptions()`
(passed into the shared `validatePlannerInput()` / `preparePlannerInitialContext()` as the
options validation, so an invalid oracle bound still fails the oracle input closed),
`PlannerBeamSearchInput`, `PlannerBeamSearchLimitKind`, `PlannerBeamSearchTermination`,
`PlannerBeamSearchResult`, `PlannerBeamSearchProgress` and `PlannerBeamSearchExecutionOptions`
(`onProgress`, `searchInstrumentation`). The shared shapes are generic -
`PlannerTerminationOf<TLimitKind, TLimits>` and `PlannerRunResultOf<TTermination>` - and the
Production ones are `PlannerRunTermination` (`reachedLimits` can only be `max_plan_steps`,
`limits` is `{ maxPlanSteps }`, enforced at compile time), `PlannerRunLimitKind`,
`PlannerRunTerminationStatus` (status meaning and precedence unchanged; one derivation,
`createPlannerTermination()`, with `createPlannerRunTermination()` for Production) and the neutral
`PlannerRunResult` the scheduler, Plan generation, `PlannerFullSearchRunner`,
`ProductionPlanGenerationObserver.afterPlannerRun()` and B8 / B9 use; `PlannerSearchTermination`,
`PlannerSearchLimitKind` and `PlannerProgress` are gone and Production code names no
`PlannerBeamSearchResult`. The Production Planner Worker has no `progress` response and
`PlannerWorkerClient` no `onProgress` callback: a request answers with its result or an error,
the Worker hands a calculation only `shouldCancel` / `yieldControl` (the Production
`PlannerExecutionOptions`), and cancellation stays `cancelPlan()` + generation + `shouldCancel`,
never a progress message. The scheduler's benchmark `onProgress({ expandedStates })` and
`schedulerInstrumentation` live in `PlannerScheduleExecutionOptions`, and the planner
orchestration / what-if browser benchmarks dropped their `progressEvents` metric. The parity
harness types each strategy's input and result separately and never converts an oracle
termination into a Production one: the shared Plan-generation tail is the termination-generic
`generatePlanFromFullRun<T>()` (it reads only the status and returns the run's own termination,
retrying with the same runner), Production fixes it to `PlannerRunTermination` through
`createProductionPlanWithSearchRunner()`, and only the harness runs it with the oracle's
`PlannerBeamSearchTermination`, so a `max_expanded_states` truncation is never rewritten as
`max_plan_steps`, `exhausted` or `incomplete` with empty `reachedLimits` (a Production `incomplete`
always names exactly `max_plan_steps`), and no Production type is widened; the
Beam oracle, its instrumentation, the parity harness and the benchmarks are kept for D-2b. It
persisted nothing new and changed no scheduler or oracle semantics: `PlannerOptions` was never in
`PlanningInputSnapshot`, and `ProductionPlan` / `PlanStep` / `PlanningInputSnapshot` /
`CalculationContext` / DB / Export shapes are unchanged, so `CURRENT_CALCULATION_APP_SCHEMA_VERSION`
stays 14 and the versions stay 14 / 8 / 11 (`RngState.schemaVersion` 2,
`AppSettings.schemaVersion` 1, `PRODUCTION_RNG_ENGINE_VERSION` `production-rng:c5-e7` and Master
`dataVersion` 4 unchanged).
Issue #103 Phase D-2b (the final Phase; `docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md` 14.6)
removed the Phase B measurement infrastructure and kept the regression oracle: Production is the
deterministic scheduler, the Beam Search is a regression oracle only, the Beam / scheduler parity
tests (acceptance catalogue, `sanity-3`, `representative-12`) stay in CI, and the Issue #103
instrumentation Browser harness (benchmark page and Worker, Browser controller, Node runner, the
PR #107 Beam instrumentation and both `onProgress` hooks) was removed after the redesign was
validated. The scheduler instrumentation survives only as the parity test observer
(`drops` / `provisionalOutcomes`). The workloads and `createDeterministicPlannerDependencies()`
moved to `src/test/fixtures/plannerSchedulerWorkloads.ts`; `representative-35` stays a
scheduler-only regression (398 actions under the 1000 default). The Beam-only warning
`max_expanded_states_reached` was removed; the oracle's `max_expanded_states` stays in
`PlannerBeamSearchTermination.reachedLimits`. The historical measurement documents stay unchanged.
No semantics or version moved (14 / 8 / 11).
Issue #125 (the saved Candidate Search defaults; `docs/REQUIREMENTS.md` 14.1, `docs/DATA_MODEL.md` 13,
`docs/UI_FLOW.md` 9 / 14) added `AppSettings.candidateSearchDefaults` (`maxNormalAdvance`,
`maxGogmaAdvance`, `maxSkillAdvance`, each a positive integer, no ordering constraint and no cap).
The one recommendation authority is `recommendedCandidateSearchDefaults` in
`src/domain/models/common.ts` (Normal **350** / Bonus **500** / Skill **1500**; Bonus above Normal
because the Gogma Counter is shared across weapons, a recommendation only), shared by a new record,
`clearAllData()`, both migrations and the Search Domain's `defaultCandidateSearchSettings`; the
Search Domain never reads AppSettings or a repository and runs the `CandidateSearchSettings` its
caller passes. Only the Settings screen's 「既定値を保存」 writes the defaults
(`SettingsRepository.setCandidateSearchDefaults()`); Debug Mode and the defaults are written as a
field-only atomic Dexie `update()` after validating the whole record, so neither overwrites the
other, and both share the Settings screen's pending-save gate against the Data Transfer. The Search
screen starts from the saved values (the recommendation, with a warning, when the read fails), and
an edit there applies to that screen's single and batch searches only (the batch keeps using the
screen's values at its start) and is never written back. User-facing wording is 「復元ボーナス最大進行量」
/ 「復元ボーナス進行」 instead of 「巨戟最大進行量」 / 「巨戟進行」; internal names such as
`maxGogmaAdvance` are unchanged, and 「巨戟カウンター」 (the RNG Counter name) stays. `defaultSearchLimit`
keeps its Normal Counter Identification meaning and is never reused. The persisted shape moved
`AppSettings.schemaVersion` to **2**, `DATABASE_SCHEMA_VERSION` to **9** (v8 -> v9 gives an AppSettings
v1 record the recommendation and keeps every other field) and `ExportRoot.schemaVersion` to **12**
(`migrateExportRootV11ToV12()` through the same `upgradeAppSettingsToV2()`; a schema 11 `settings` that is
not a v1 record fails closed). The former fixed `500 / 350 / 1500` was never user data and is not carried
over. No calculation semantics changed, so `CURRENT_CALCULATION_APP_SCHEMA_VERSION` stays 14 and
`PRODUCTION_RNG_ENGINE_VERSION` `production-rng:c5-e7`, `RngState.schemaVersion` 2 and Master
`dataVersion` 4 are unchanged; no Candidate, Entry or Plan goes stale.

B5-F1 changed Candidate classification and Search calculation semantics at version 2.
The Planner physical-action sharing correction then changed ProductionPlan calculation
semantics at version 3, the shared-Counter Route prefix fast-forward correction changed
them again at version 4, and refusing a bound-truncated partial search result as an
executable ProductionPlan changed ProductionPlan artifact validity at version 5.
Target compromise semantics then moved it to version 6, and the protected-weapon
mutation contract plus zero-operation current-state Candidate semantics moved it to
version 7. Replacing `OwnedWeapon.relatedTargetWeaponIds` with the Target-side
`preferredOwnedWeaponId` moved it to version 8. Removing the
owned-weapon-as-material model and reducing `OwnedWeapon.status` to a user-facing
organisation label changes the active RouteOperation set, Planner inventory
semantics, Planner scoring, the PlanStep operation set, and the OwnedWeapon
semantic hash contract, which moved it to version 9. Replacing the independent
Practical Candidate with a canonical Ideal Route plus selectable compromise
checkpoints changes the Candidate output shape, Candidate classification, the
Build List planning input, and Planner fast-forward / conflict semantics, which
moved it to version 10. Replacing the strict-prefix checkpoints of one fixed
operation order with per-lane intermediate states
(`BuildCandidate.intermediateStateGroups`), a per-lane selection plus an
improvement preference (`BuildListEntry.intermediateStateSelection`), and a
Planner that interleaves the Bonus and Skill lanes changes the Candidate output
shape, the Build List planning input, Planner Route execution semantics, the
PlanStep milestone shape, and the PlanConflict participant shape, which moved it
to version 11. The Execution Plan contract above (Target definition hash
normalization, planning-input and Plan-dependent hashes, Target execution state,
PlanStep `executionEffects`, reserve and zero-operation completion semantics) moved
it to 12, the Plan start effect (existing-weapon Target links at `draft -> active`
instead of at the first physical Step) moved it to 13, and the Production Planner
strategy switch from the Beam Search to the deterministic scheduler (Issue #103 Phase C)
moved it to the current **14**, defined
only by `CURRENT_CALCULATION_APP_SCHEMA_VERSION` in `src/domain/models/common.ts`.
A version 10 `checkpointGroups` / `selectedCheckpointOpportunityIds` cannot be
mapped onto lane pins, and reading such a selection as empty would silently
drop a hard constraint, so version 10 artifacts fail closed like every earlier one.
Search, BuildList, Planner, and benchmark runtime creators share this authority.
Dexie separately moved to `DATABASE_SCHEMA_VERSION = 4` for the persisted status rename, to 5 for the Execution lifecycle persisted state, to 6 for the ProductionPlan lifecycle metadata, to 7 for the Identification provenance, to 8 for the Draft lifecycle (every accumulated `draft` Plan deleted; `ExportRoot.schemaVersion` 11, `RngState.schemaVersion` 2), and to the current 9 for the AppSettings Candidate Search defaults (Issue #125; `ExportRoot.schemaVersion` 12, `AppSettings.schemaVersion` 2); the Dexie version is independent of
`AppSettings.schemaVersion` (current 2); gameVersion, Master Data version,
and `CONSTRAINED_ROUTE_POLICY_VERSION`
remain unchanged. `PRODUCTION_RNG_ENGINE_VERSION` is
currently `production-rng:c5-e7`. The Normal Artian occurrence-limit correction
(Production game-verified pool Attack 5 / Element 4 / family 7 2 / Affinity 3)
changed Production Normal prediction output and moved the Engine version from
`production-rng:c5-e2` to `production-rng:c5-e3`; the later Melee support
expansion (Production Normal support for every melee weapon type except Switch
Axe) made previously unsupported Normal prediction inputs supported, changing
Candidate Search route availability and Counter Identification support, and
moved it to `production-rng:c5-e4`; the Bow Normal Table A / B correction
(Bow Poison / Paralysis / Sleep draw the Table B pool `[6, 8]`, Blast the
Table A pool `[6, 4, 8]`) changed Bow Poison / Paralysis / Sleep Production
Normal prediction output and moved it to `production-rng:c5-e5`; the Switch
Axe Normal Production activation (Switch Axe draws one single pool
`[6, 4, 7, 8]` whatever its configuration) made the previously unsupported
Switch Axe Normal prediction input supported, changing Candidate Search route
availability and Counter Identification support, and moved it to
`production-rng:c5-e6`; the Production Gogma Reset family availability and
Sharpness/Capacity family limit (RNG Rules), implemented in PR-B, changed
Gogma Reset prediction output and moved it to the current
`production-rng:c5-e7`. None of the five touched
`CURRENT_CALCULATION_APP_SCHEMA_VERSION`; `rngEngineVersion` alone is the
CalculationContext staleness boundary for all of them. `DATABASE_SCHEMA_VERSION` stays 4 at the checkpoint boundary and at the lane
boundary, while `ExportRoot.schemaVersion` moved to 5 with the checkpoint entity
shape, to 6 with the lane entity shape, to 7 with the Execution lifecycle persisted
state, and later to the current 11 (see the Calculation Context paragraphs above).
Version 1 BuildCandidate, BuildListEntry, and ProductionPlan
calculations are incompatible with any later version and must not be reused as current
results. Existing staleness checks mark old BuildListEntry records with
`calculation_context_changed` and exclude them from Planner input. Preserve old
Candidate snapshots exactly as persisted, including any `category` /
`isSimilarToIdeal` / `similarityScore` a historical record still carries; obtain
current Candidates by searching again.
Do not delete historical results or add a migration or Export/Import semantic
validation change as a substitute for CalculationContext compatibility.

All version 1..13 ProductionPlans are incompatible with version 14, Draft or active alike, while version 12 and 13 Candidates and BuildListEntries stay usable under 14 through the explicit build-result exception `14 -> [12, 13]` (the version 14 change is the Production Planner strategy only; version 1..11 stay incompatible; never a range check such as "12 or later", never a Plan exception, never a read migration or an in-place version rewrite of a version 13 Plan). Historically, all version 1..12 ProductionPlans are incompatible with version 13, and all version 1..11 Candidates and BuildListEntries are incompatible with version 13 (version 1..11 were already incompatible with version 12). Preserve their contents and fail closed with calculation_context_changed. The only build-result exception at this boundary is the explicit `13 -> [12]` one: the version 13 change is ProductionPlan execution only (the Plan start effect), so a version 12 Candidate or BuildListEntry stays usable under 13 when gameVersion, masterDataVersion and rngEngineVersion are equal and no ordinary stale reason applies. Never widen it to version 1..11, never apply it to a ProductionPlan, and never extend the historical 2..5 exception. Never execute a version 12 Plan under the Plan start effect: its first Step expects the pre-start state. Never convert a version 11 Plan into the version 12 PlanStep contract: no inferred `executionEffects`, no `reserve_weapon` merged into a physical Step, no inferred tracked OwnedWeapon or observation binding.

The v3 -> v4 Dexie migration converts only `OwnedGogma.status === 'material'` to
`'unclassified'`. `practical` and `ideal` keep their values, a Normal Artian
keeps `status: null`, `isProtected` is never touched — a formerly Material weapon
the user had protected stays protected — and `TargetWeapon.preferredOwnedWeaponId`
is left alone. v1 -> v2 -> v3 -> v4 must apply in order.

Never migrate a historical BuildCandidate, BuildListEntry, ProductionPlan, or
ExecutionHistory into the new semantics. A stored `use_weapon_as_material`,
`create_material_gogma`, `change_owned_weapon_status`, or `status = material`
keeps its exact persisted contents and fails closed at the CalculationContext
boundary; never rewrite it into a current operation. A UI that can display
historical artifacts must not crash on one — a legacy presentation fallback at
the Persistence / Presentation boundary is allowed, but it must never make a
legacy operation executable as a current Domain operation.

Historical version-5 contract (does not apply to version 6 or 7): Version 2, version 3, and version 4 BuildCandidate and BuildListEntry calculations are
explicitly compatible with version 5 when gameVersion, masterDataVersion, and
rngEngineVersion are equal, because Search and Build List snapshot semantics did not
change. Version 2, version 3, and version 4 ProductionPlans are not compatible with
version 5: treat them as `calculation_context_changed`, keep their exact persisted
contents visible, and do not allow Worker preparation, what-if, conflict selection, or
execution. A version 3 Plan's persisted Steps stay physically executable, but its
`conflicts` and `rejectedBuildListEntries` can assert shared-Counter conflicts and
`counter_before_current` rejections that the current calculation would not produce. A
version 4 Plan's contents can be a partial result of a search a `PlannerOptions` bound
truncated, which the current contract no longer accepts as executable, and a persisted
Plan records no `PlannerSearchTermination`, so complete and partial version 4 Plans
cannot be told apart from persisted data — every version 4 Plan is therefore failed
closed as a whole rather than judged individually. Neither may be treated as a current
executable Plan. This is a narrow artifact-specific exception, not general forward
compatibility, and version 1 stays incompatible for every artifact.

The forced Reset Normal Artian route added a new Route capability without
changing how any existing artifact is interpreted, so it did not move
`CURRENT_CALCULATION_APP_SCHEMA_VERSION`. `CreateNormalArtianOperation` only
widened: every previously persisted one carries numeric Counter positions and
stays the predicted variant with its exact original meaning, the
`searchStateHash` normalization is unchanged for it, and replaying it produces
the same Plan. The new constraints apply only to an operation whose Counter
positions are `null`, which no existing artifact contains. `DATABASE_SCHEMA_VERSION`,
`AppSettings.schemaVersion`, and `PRODUCTION_RNG_ENGINE_VERSION` are unchanged
too: no Dexie shape changed and no RNG algorithm changed.

Unless compatibility is explicitly guaranteed, a CalculationContext change makes previous:

- `BuildCandidate`
- `BuildListEntry`
- `ProductionPlan`

incompatible/stale.

Use the specified stale or recalculation reason:

```text
calculation_context_changed
```

Do not silently reuse incompatible calculation output.

---

## RNG Rules

RNG behavior is critical.

Do not guess, approximate, or reverse-engineer missing game behavior by assumption.

Use these verification-status terms precisely:

- `reference-verified`: confirmed in the pinned reference repository; this
  does not imply agreement with every weapon, attribute, or game version
- `game-verified`: confirmed by the user's real-game observation or an
  equivalent real-game fixture
- `unverified`: not supported by sufficient reference or real-game evidence

Do not use bare `verified` as a Production RNG correctness status. The
`.verified_*` fragments in stable Master IDs are legacy identifier text, not
verification-status claims.

If production RNG behavior is unverified:

1. Define typed interfaces
2. Define validation
3. Implement fixture-based Fake Engine behavior where needed
4. Keep production and fake engines replaceable
5. Keep fake behavior separated by an explicit feature flag
6. Show the active engine in Debug Mode where specified
7. Label fixture provenance: reference-verified fixtures prove reference parity,
   while only game-verified fixtures prove real-game correctness

Never make production behavior depend on guessed:

- Lottery weights
- Internal Lottery values
- Counter advancement
- Counter Gate behavior
- Keep behavior absent from both the reference-verified algorithm and
  game-verified fixtures
- Seed behavior
- Other unverified game mechanics

`Gogma-Artian-Roll-Planner` `GARP.lua` v0.9.4 at the pinned reference commit is
the external provenance for reference-verified single-weapon RNG prediction and
route behavior. GogmaArtianPlanner owns the implementation that applies those
Production RNG primitives and semantic mappings to Seed / Counter
Identification, multiple Targets, inventory, global planning, and guided
execution; it must not invent different single-weapon RNG rules or depend on an
external Seed Finder implementation as Identification authority.

External live-game observation fixtures carry provenance at the fixture level.
A fixture sourced from a third-party tool is evidence for that recorded game
observation only; it does not make the tool an RNG algorithm or Identification
implementation authority. Likewise, parsing a supported external output format
is Import compatibility, not algorithm provenance.

The formal domain-counter contract and its verification provenance are:

| Operation | Normal | Skill | Gogma | Status |
| --- | ---: | ---: | ---: | --- |
| Create one normal Artian | +1 | 0 | 0 | reference-verified |
| Convert normal to Gogma | 0 | +1 | 0 | game-verified |
| Reset Skills | 0 | +1 | 0 | reference-verified |
| Reset Bonuses | 0 | 0 | +1 | reference-verified |
| Keep Bonuses | 0 | 0 | +1 | reference-verified |

Internal PRNG steps are not Domain Counter increments.

Conversion preserves the normal weapon's five restoration-bonus slots, in
order and with `normal_artian` scope, assigns the initial Series and Group
Skills from the Skill stream, advances Skill Counter by one, and does not
advance Gogma Counter. It is not a Gogma-bonus lottery operation.

Keep Bonuses has no user-selected slots and no selection branch. It preserves
the bonus family at each of the current five slot positions and rerolls the tier
within each family. Reset and Keep results come from the RNG Engine; Search and
Planner must not synthesize them.

The Production Normal Artian lottery uses the reference-verified PRNG, seed
derivation, 10-step block, and pool step unchanged, and replaces only the
candidate pool with the Production pool of the supported weapon type: Bow,
Light Bowgun, Heavy Bowgun, the Melee category of every melee weapon type
except Switch Axe (Great Sword, Sword and Shield, Dual Blades, Long Sword,
Hammer, Hunting Horn, Lance, Gunlance, Charge Blade, Insect Glaive), and
Switch Axe as its own independent contract. The Melee pools are `[6, 4, 7, 8]`
with an attribute and `[6, 7, 8]` without, identical to the former Long Sword
pools, and Melee membership is decided only by the explicit allow-list
`PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS` in `gameNormalBonuses.ts`; an
unknown weapon type is never treated as Melee implicitly. Switch Axe is
supported through `GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES`, one single
pool `[6, 4, 7, 8]` drawn whatever the parts configuration
(`docs/RNG_REFERENCE_AUDIT.md` 14.16, 2026-09-15): at Base Seed 51231782 a Fire
configuration and an all-different-parts (elementless) configuration both
drew `[7, 7, 8, 6, 4]` at Counter 0 from the same save, and Fire Counter 0
followed without reload by all-different Counter 1 drew `[7, 7, 8, 6, 4]` then
`[8, 6, 4, 4, 6]`, matching the existing PRNG exactly. Game8 likewise lists
Switch Axe as "the same table whatever the configuration", separate from the
other melee weapons. Never add Switch Axe to the Melee allow-list, never
describe "Melee 11 types" as one condition, and never write that Switch Axe
has two game tables: the pool values coinciding with Melee Table A is not a
shared category semantics, because Melee Table B is `[6, 7, 8]` while Switch
Axe draws `[6, 4, 7, 8]` elementless too. Its provenance is layered: pool
membership, configuration independence, and the Counter 0 -> 1 sequence are
direct game observations (fixtures `gameVerifiedSwitchAxeFireNormalVectors` /
`gameVerifiedSwitchAxeNoneNormalVectors`), while its Attack 5 / Element 4 /
Sharpness 2 / Affinity 3 limits are category-level Production adoption from
the 2026-09-14 Melee 1293-forge verification, the Game8 limit table, and the
Switch Axe observations contradicting none of them. Never write that the
Switch Axe limit boundaries were game-verified directly.

Pool selection is expressed by the formal Domain concept
`NormalArtianLotteryTableClass = 'table_a' | 'table_b'`
(`src/domain/rng/normalArtianLotteryTable.ts`, `docs/RNG_SPEC.md` 6.3.1). The
element never enters the Normal seed (Base Seed + weapon type + rarity only);
it decides only which table's pool one forge draws from. The exact `ElementId`
is classified by `normalArtianLotteryTableClassForWeaponAndElement()`, the
table selects its pool through `gameVerifiedNormalCandidatesForWeaponAndTableClass()`,
and `gameVerifiedNormalCandidatesForWeaponAndElement()` delegates to both. The
former `NormalArtianAttributeClass = 'none' | 'attribute_present'` was never a
correct classification of the whole Normal lottery and is removed; do not
reintroduce it. Bow (`docs/RNG_REFERENCE_AUDIT.md` 14.15): Table A = Fire /
Water / Thunder / Ice / Dragon / Blast with pool `[6, 4, 8]`, Table B = none /
Poison / Paralysis / Sleep with pool `[6, 8]`. Its provenance is layered and
must never be written as "every Bow element was game-verified": Fire, Blast,
Poison, Paralysis, Sleep (Base Seed 51231782 / Counter 0, Fire also Counters
0..2) and none (Counters 0..2) are direct game observations, while Water /
Thunder / Ice / Dragon on Table A are category-level Production adoption from
the user-supplied Game8 classification, the direct Fire and Blast Table A
fixtures, and the absence of evidence against the former single elemental
pool. Melee: Table A = any attribute (Poison / Paralysis / Sleep / Blast
included), Table B = none, unchanged. Light / Heavy Bowgun: both tables draw
`[6, 7, 8]`, unchanged. Switch Axe: the same none / any-attribute
classification, purely as the Identification / UI observation adapter, and
both classes draw the one Switch Axe pool `[6, 4, 7, 8]` exactly as the
Bowguns share one pool; the game has one Switch Axe table, not two. Never
apply the Bow split to Melee, Bowguns, or Switch Axe. A table
class is not a Counter stream: every element of one weapon type shares its one
rarity-8 Normal Counter, forging a Table A weapon and then a Table B weapon
consumes C and C + 1, and the class never enters `NormalArtianCounter.id`, the
persisted shape, `normalArtianCounterId()`, or the DB schema. Never split the
Counter into a Table A Counter and a Table B Counter. Melee provenance is two-layered and
must never be written as if all ten were directly verified
(`docs/RNG_REFERENCE_AUDIT.md` 14.14): Long Sword (both conditions) and the
attribute-present pool of Great Sword / Dual Blades / Hammer / Charge Blade are
directly game-verified, while Sword and Shield / Hunting Horn / Lance /
Gunlance / Insect Glaive and the elementless pool of those four are
category-level Production adoption based on five independent melee streams
following one rule, the Game8 table treating every non-Switch-Axe melee weapon
as one condition, the elementless pool agreeing with the Long Sword none
fixture, and the shared PRNG / seed derivation / weapon type stream. The
Production per-candidate `maximumOccurrences` are
(`docs/RNG_REFERENCE_AUDIT.md` 14.13):

```text
Attack (6)              5
Element (4)             4
Sharpness/Capacity (7)  2
Affinity (8)            3
```

Their provenance is not uniform, and must not be described as if it were.
Attack 5 / Element 4 / Sharpness 2 / Affinity 3 were game-verified directly on
1293 attribute-present melee forges / 6465 slots (Great Sword, Dual Blades,
Hammer, Charge Blade; Base Seed 51231782, 2026-09-14). Capacity 2 on the
Bowguns, the application of Element 4 / Affinity 3 to the Bow, Affinity 3 on
the Bowguns, and Affinity 3 in the elementless pools were not boundary-observed
in that data set. They are adopted as the Production contract from the
user-supplied Game8 limit table plus the fact that the existing game-observed
Bow / LBG / HBG / Long Sword fixtures do not contradict them. Never write that
1293 forges game-verified every Production limit including Capacity.

The pinned reference pools in `referenceNormalBonuses.ts` keep Element 5 /
Affinity 5. That is the pinned reference implementation's behavior, not a game
rule, and it is the reference parity contract: never change the reference pool
contents, `predictReferenceNormalRaw()`, or the reference golden vectors to match
the game, and never let the Production pool fall back to them. Keep the two
pools separate. `ReferenceNormalCandidate.maximumOccurrences` is `2 | 3 | 4 | 5`.

The Production Gogma Reset family availability and family limit
(`docs/RNG_SPEC.md` 6.1.1, `docs/RNG_REFERENCE_AUDIT.md` 14.17) are fixed as the
Production contract and are implemented by PR-B in the current
`production-rng:c5-e7` runtime: `productionGogmaResetCandidatesForWeaponAndElement()`
derives the family set from `gameVerifiedNormalCandidatesForWeaponAndElement()`,
`buildProductionWeightedGogmaResetPool()` adds the Sharpness/Capacity limit on
top of the unchanged `buildReferenceWeightedGogmaPool()`, and
`predictProductionGogmaResetSlotsFromRawValues()` is the one draw path Production
Reset and Gogma Counter Identification share. Up to `production-rng:c5-e6` the
runtime filtered `REFERENCE_GOGMA_RESET_CANDIDATES` through Master availability
(`getBonusDefinitionsForWeapon(master, weaponTypeId, elementId, 'gogma_artian')`)
and drew with the exact-ID repeat penalty only; never reintroduce that path.
Production Reset support no longer reads the caller Master.

- The bonus families a Production Gogma Reset may draw are the family set of
  the Production Normal Artian pool of the same `weaponTypeId` + `elementId`
  (Normal lottery ID 6 attack, 4 element, 7 sharpness_capacity, 8 affinity),
  expanded to the Gogma rank candidates in the fixed reference order (Attack
  II / III / EX, Affinity II / III / EX, Element II / EX, Sharpness/Capacity
  base / EX). Only the family set is shared: never reuse the Normal seed,
  Normal Counter, or Normal `maximumOccurrences`, and in particular never apply
  Normal Affinity 3 to Gogma. The draw stays Gogma seed / Gogma Counter /
  10-step block / candidate order / exact-ID repeat penalty.
- The Bow Table A / B split applies: Table A (Fire / Water / Thunder / Ice /
  Dragon / Blast) draws Attack / Element / Affinity, Table B (none / Poison /
  Paralysis / Sleep) draws Attack / Affinity. Switch Axe draws its single pool
  families Attack / Element / Sharpness / Affinity whatever its configuration,
  `element.none` included.
- `WeaponBonusDefinition` plus `ElementMaster.allowsElementBonus` is never the
  Production Gogma Reset family authority: Bow Poison has
  `allowsElementBonus = true` yet draws no Element, and Switch Axe
  `element.none` has `allowsElementBonus = false` yet draws Element.
- Production adds exactly one family limit: once reference IDs 6 and 10
  together fill two slots of one Reset result, both leave the pool. Never add
  explicit Attack / Affinity / Element family limits: Gogma Affinity 5 is
  game-observed, Element is capped at 4 (II x2 + EX x2) by the exact-ID repeat
  penalty alone, and Attack gets no additional family limit because a Reset
  result has only five slots.
- The Gogma exact-ID repeat penalty (non-EX candidates 100 -> 50 -> 0, EX
  candidates 100 -> 20 -> 0, counted per reference ID) stays for both Reset
  and Keep.
- Keep is unchanged: it preserves each slot's family and position, rerolls the
  tier within the family, and uses the exact-ID repeat penalty. Never add the
  family availability filter or the Sharpness/Capacity limit to Keep. A Keep
  whose current layout holds three or more `sharpness_capacity` slots is
  unverified: do not make it unsupported and do not enforce a limit of two on it.
- The GARP v0.9.4 parity authority - `REFERENCE_GOGMA_RESET_CANDIDATES`,
  `buildReferenceWeightedGogmaPool`, `predictReferenceGogmaReset`, and the
  reference golden vectors and tests - reproduces the exact-ID repeat penalty
  only and is never rewritten to match the game. The Normal family availability
  and the Sharpness/Capacity limit are Production-only corrections.
- Gogma Counter Identification uses the same Production candidate availability
  and weighted draw semantics as Production Reset; never give it a separate
  candidate table.
- Provenance is layered. Directly game-verified at Base Seed 51231782 on
  2026-09-15: Bow Poison drawing no Element (Gogma Counters 55 / 179), Switch
  Axe `element.none` drawing Element (55), the Sharpness/Capacity limit of two
  (primary evidence Hammer Paralysis 104; Counter 94 is a supporting
  observation the contract does not depend on), Affinity 4 and 5 (Hammer Paralysis 160, Bow
  Poison 179), Element II x2 + EX x2 (Lance Dragon 197), and five consecutive
  Keeps matching the current Keep model (Dual Blades Dragon 55..59). Bow
  Paralysis / Sleep use Table B by applying the Normal classification, not by
  a Gogma observation; every other unobserved weapon type / element condition,
  and the Sharpness/Capacity limit outside Hammer Paralysis, is category-level
  Production adoption. Never write that every weapon or element was
  game-verified for Gogma Reset.
- Production-usable restoration bonus definitions are the product of the
  Master weapon type / scope definitions and the Production family
  availability. None of PR-A, PR-B, or PR-C changes
  `getBonusDefinitionsForWeapon()`, the Master JSON, `allowsElementBonus`, nor
  Master `dataVersion`. PR-C implemented the composite availability selector
  (`src/domain/artian/productionBonusAvailability.ts`) that keeps Master
  independent of the Production RNG layer, for the Owned Weapon editor, Target
  editor, Target compromise editor, entity validation, Identification Wizard
  STEP 2, and new entity drafts, without changing any Prediction output
  (`production-rng:c5-e7` stays current). See Master Data Rules below.

`LotteryMaster` is provisional.

Do not force reference-verified or game-verified RNG behavior to fit the provisional `LotteryMaster` schema. If real analysis requires a different representation, update the specification before changing the production model.

Do not promote reference-verified behavior to game-verified merely because it
matches the reference implementation. The following remain unverified:

- Gogma Reset family availability for weapon type / element conditions not
  observed directly (category-level adoption of the Production Normal pool
  family set; see the Production Gogma Reset contract above)
- A Keep Bonuses whose current bonuses hold a family outside the weapon's
  Production family availability (for example Bow Sharpness/Ammo, LBG/HBG
  Element, or Element on Bow Table B)
- A Keep Bonuses whose current layout holds three or more
  `sharpness_capacity` slots
- 栄光の誉れ
- 祝祭の巡り
- Persisted Counter advancement while Counter Gate is below threshold
- The real-game result of a Keep Bonuses whose current bonuses are
  `normal_artian` scope (the family normalization uses the project-owner
  confirmed `ArtianBonusTypeMapping`, the tier draw is the reference family
  draw, and no game-verified fixture exists yet)

Rank I under `gogma_artian` scope is not a verified value. The earlier
real-game report of Gogma rank I was a converted Gogma still holding its
unamended normal-scope slots, so the Master declares no `gogma_artian` rank I
definition and no code, test, or document may present Gogma-scope rank I as
game-confirmed. The relation between the normal-scope "I" the game displays
and the current `bonus_rank.base` representation is not settled by the
repository: do not replace `base` with `i` mechanically and do not add a
guessed Normal rank table.

The Production RNG interface contract must preserve semantic Domain inputs:

- `predictNormalArtian` receives `elementId`; the Production adapter maps
  rarity 8 to internal rarity 7 and explicitly maps Weapon/Element IDs
- Gogma-bonus prediction supports only `reset_bonuses` and `keep_bonuses`
- Keep prediction receives the current ordered five bonuses
- There is no conversion/new-Gogma bonus prediction operation
- Keep slot-selection types and selection enumerators are not part of the
  contract
- Reference numeric encodings must not leak into Domain parameters

---

## Partial RNG State and Capabilities

RNG state is not all-or-nothing.

Base Seed, Gogma Counter, Skill Counter, and Counter Gate are independent `KnownValue<T>` fields.

`RngState.counterGate` remains in the v1 schema for legacy/manual/import
compatibility, future export/import round-tripping, and diagnostic/reference
information. Do not delete or migrate it in v1. Its value and confirmation
state are not Production Skill/Gogma Prediction authority and must not gate
Candidate Search, Planner, or Trace Replay.

Do not require all RNG values merely because one feature needs some of them.

Use capability derivation so that:

- Gogma prediction only requires its actual dependencies
- Skill prediction only requires its actual dependencies
- Normal Artian search only requires the relevant normal counter and other actual dependencies
- Planner only requires capabilities needed by the selected route operations

Each capability requires both the relevant confirmed `KnownValue` inputs and
explicit support from the active `RngEngineCapabilities`. Values alone must
not enable an unverified Engine feature. Planner validation applies this per
BuildListEntry route and excludes only entries whose required operations are
unsupported.

A missing capability disables only dependent routes.

Do not disable unrelated routes.

Conversion requires a compatible Normal source, Skill prediction capability,
confirmed Base Seed and Skill Counter, and supported concrete semantic input.
It does not require a persisted exact Counter Gate. Conversion alone does
not require Gogma prediction capability or a confirmed Gogma Counter. Those are
required only when Reset Bonuses or Keep Bonuses is included.

The Core/reference Counter Gate semantics remain separate from Product runtime
policy: Skill Gate below 54 uses effective Skill Counter zero, and Gogma Gate
below 35 uses effective Gogma Counter zero. How the game's persisted Counter
changes while a Gate is below its threshold is unverified; do not infer or
encode that behavior.

The approved Production v1 policy targets users at game progression where
normal and Gogma Artian systems are available and always selects the active
branch. The Production adapter supplies 54 for Skill operations and 35 for
Gogma operations as internal active-branch representatives. These numbers are
not actual game Counter Gate values and must never be persisted, requested by
the Identification Wizard, or presented as identified Gate values. Preserve
the low-Gate Core/reference semantics and tests.

C5-E2C3 integrates this policy atomically in the Production adapter, Domain
prediction inputs, capability derivation, Candidate Search, Planner validation,
Trace Replay, and semantic hashes. C5-E2C3 set `PRODUCTION_RNG_ENGINE_VERSION`
to `production-rng:c5-e2`; the later Normal Artian occurrence-limit correction
moved it to `production-rng:c5-e3`, the Melee support expansion moved it to
`production-rng:c5-e4`, the Bow Normal Table A / B correction moved it to
`production-rng:c5-e5`, the Switch Axe Normal Production activation moved
it to `production-rng:c5-e6`, and the Production Gogma Reset family
availability and Sharpness/Capacity limit moved it to the current
`production-rng:c5-e7` (see the Normal pool limits, the Melee category, the
Switch Axe single pool, the lottery table class, and the Production Gogma
Reset contract under RNG Rules). Do not reintroduce caller-supplied or persisted Gate as
Production authority. This runtime integration did not activate the Skill-first
Identification UI by itself; activation was decided separately in C5-E2C10.

---

## Observation and Search Input Rules

Seed search and Counter search are separate contracts.

Do not merge their request or result semantics.

Observation validation is kind-specific.

Current v1 rules include:

- v1 Normal Artian observations are fixed to rarity 8 and require restoration bonuses
- Normal Artian `elementId` may be null only when the Engine does not require element
- Gogma Bonus observations require element and restoration bonuses
- Skill observations require element and at least one observed series/group skill
- Mixed counter streams must not be combined in one Counter search input

Heavy Seed/Counter search runs in a Web Worker and supports progress and cancellation.

The Production v1 RNG-identification path is the dedicated Skill-first Wizard.
There is no generic Seed Search contract: `RngEngineCapabilities` describes
prediction support only, and no capability flag stands for Identification.

- Step 1 identifies canonical Base Seed and starting Skill Counter from
  consecutive ordered Skill draws (Series and Group) of one weapon type and
  element. The first observation may be the conversion-assigned Skill or a
  Reset Skills result on an already owned Gogma; every later one is the next
  consecutive Reset Skills result, with no other Skill Counter consuming
  operation in between. The starting Skill Counter is the one immediately
  before observation 1. Conversion and Reset Skills each advance the Skill
  Counter by one and draw the same Skills at the same Skill Counter, weapon
  type, and element (direct game observation, `docs/RNG_REFERENCE_AUDIT.md`
  14.18), so the operation type is never an Identification input and the
  Wizard asks for no start method.
- Step 2 uses the unique Step 1 Seed and consecutive ordered Reset Bonuses
  observations to identify the starting Gogma Counter.
- Counter Gate is never a Wizard input, observation, search dimension, result,
  or adopted field.
- Adopt the starting counters after the user restores the pre-investigation
  game state. Never persist counters advanced by the observation count.
- Use existing source `observation` for adopted Base Seed, Skill Counter, and
  Gogma Counter; do not change Counter Gate or require a new `identified` source.
- The C5-E2C4 application service accepts reviewed exact Base Seed, starting
  Skill Counter, and starting Gogma Counter values only. It re-normalizes the
  Seed with the Production authority, validates the counters with the RngState
  domain contract, preserves every unrelated RngState field, and performs one
  whole-object RngState put. It never advances counters by observation count or
  mutates Normal Counters, Candidates, Build List entries, or Plans.
- The C5-E2C5 application Coordinator is implemented. It composes the dedicated
  Skill and Gogma Counter Worker Clients, treats only one non-truncated match as
  unique, injects the unique Step 1 Seed into Step 2, retains starting counters
  without observation-count advancement, and calls only the C5-E2C4 service for
  adoption after explicit game-restored confirmation. Its Wizard state is
  in-memory only; reruns invalidate downstream review/confirmation state.
- The C5-E2C6 Skill multi-worker orchestration is implemented behind the
  existing `SkillIdentificationWorkerClient` interface. Production uses at most
  four Workers, splits only the Seed range into contiguous, non-overlapping,
  gap-free chunks, merges deterministically, aggregates global progress, and
  propagates cancellation or any child failure to the whole logical request.
- The C5-E2C7 Identification Wizard UI is implemented and connected from RNG
  Setup through the existing Coordinator. The real Browser Worker benchmark was
  completed in C5-E2C8 (see `docs/C5_E2C8_BROWSER_WORKER_BENCHMARK.md`), and the
  independent Skill live-game verification was completed in C5-E2C9 (see
  `docs/C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md`). C5-E2C10 Production
  Identification activation is completed (see
  `docs/C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md`): the default runtime
  path from RNG Setup already reaches the Production Coordinator, multi-worker
  Skill client, Gogma Counter Worker client, and Adoption Service. Activation
  did not add a feature flag, an RngEngine capability, or new wiring, and it did
  not change Production RNG semantics.
- Identification availability belongs at the Worker/application level; do not
  add RngEngine capability flags for it without a separate specification change.
- Skill live-game verification was completed in C5-E2C9. Base Seed 51231782 and
  starting Skill Counter 341 came from an independent GARP live RNG state read;
  `weapon.insect_glaive` / `element.ice` conversion plus three consecutive Reset
  Skills produced four ordered Series/Group observations at Skill Counters
  341-344. `ProductionRngEngine.predictSkills` reproduced all four exactly, and
  bounded Identification over Seeds 51,206,782-51,256,782 with Skill Counters
  336-346 returned only `(51231782, 341)`, non-truncated. The game state was
  restored after observation, so the starting Counters are never advanced by the
  observation count. The fixture is
  `src/test/fixtures/gameVerifiedSkillVectors.ts`. It proves that weapon type,
  element, and Counter window only. The real Browser Worker benchmark was
  completed in C5-E2C8; a Node benchmark was not used as its substitute. C9
  completion does not activate Production Identification on its own.
- Skill Seed search uses contiguous, non-overlapping, gap-free multi-worker
  chunks with deterministic merge, global progress, cancellation propagation,
  and explicit Worker-failure errors. Child Workers do not independently apply
  the parent `maxMatches`; global limiting occurs only after complete chunk
  results are available, preserving the non-truncated unique-result contract.

---

## Restoration Bonus Rules

Restoration bonuses are weapon-type dependent.

Use:

- Common Bonus Type master
- Common Bonus Rank master
- Weapon-specific `WeaponBonusDefinition`

Do not hard-code weapon-specific availability in UI components.

A `RestorationBonusSet`:

- Contains exactly five bonuses
- Stores five UI-visible slots
- Is compared as an unordered multiset for ideal/practical equality unless the specification explicitly says otherwise

Do not lose duplicate-count semantics.

For `referencedOwnedWeaponsHash`, preserve the stored five-slot order because
Keep preserves the family at each slot position, making slot order semantic.

---

## Owned Weapon Rules

`OwnedWeapon` tracks both normal Artian and Gogma Artian weapons as a discriminated union:

```ts
type ArtianWeaponKind = "normal" | "gogma";
```

Each `OwnedWeapon` retains:

- ID
- Kind
- Name
- Weapon type
- Element
- Five restoration bonuses
- Protection state
- Memo and timestamps as specified

An `OwnedWeapon` never references a `TargetWeapon`. The relation between the two
is held only by `TargetWeapon.preferredOwnedWeaponId`, one-directionally from
Target to weapon (see Target Weapon Rules). `OwnedWeapon.executionInProgress` holds
a ProductionPlan ID only, never a Target ID.

A normal Artian weapon:

- Is always rarity 8 in v1
- Uses five `normal_artian` scope restoration bonuses
- Has no Series Skill
- Has no Group Skill
- Has no status
- Retains an independent protection state
- Defaults to unprotected when newly registered
- Must not be used by an automatic Gogma-conversion route while protected

A Gogma Artian weapon:

- May retain five inherited `normal_artian` scope restoration bonuses before
  its first bonus amendment
- Uses five `gogma_artian` scope restoration bonuses after Reset Bonuses or
  Keep Bonuses
- Never mixes `normal_artian` and `gogma_artian` scopes within one weapon;
  all five slots have the same scope
- Retains Series Skill and Group Skill
- Retains an unclassified / practical / ideal status label
- Retains protection independently from status

Converting a normal Artian weapon does not translate its bonus types or ranks
to Gogma-tier values. The five normal-tier slots remain unchanged until the
first bonus amendment.

In the real game, both Reset Bonuses and Keep Bonuses are legal as the first
bonus amendment of a `normal_artian` scope Gogma weapon. Conversion itself is
not a Gogma-bonus lottery operation, so it does not force a later Reset.

The Production RNG Engine predicts Keep from either scope. The decisive
question is never whether the Normal Counter is known but whether the five
normal-scope current slots are known:

- Owned Normal: five slots known, so after conversion Reset and Keep both apply
- Owned Gogma with `restorationBonusScope = normal_artian`: five slots known, so
  Reset and Keep both apply without any conversion
- New Normal whose five slots the Normal Counter can predict: known, so after
  conversion Reset and Keep both apply
- New Normal with no usable Normal Counter (the blind route): five slots
  unknown, so Reset only until the first Reset makes them known

Keep prediction reads only the Bonus family of each slot. The family of a
Gogma-side bonus type is the type itself; a Normal-side bonus type is
normalized to its Gogma-side type through `ArtianBonusTypeMapping`
(`src/data/master/artian-bonus-type-mappings.json`), which is the single
authority and is never duplicated by a second mapping table. `bonusRankId`
never takes part in family resolution, and `restorationBonusScope` is not an
RngEngine Keep API parameter: the Keep operation stays
`{ type: 'keep_bonuses'; currentBonuses: RestorationBonusSet }`. Whether a
scope / rank combination is a legal persisted value is Master / Domain
validation, not Keep RNG. Search and Production RNG share one family resolver
(`src/domain/rng/gogmaBonusFamily.ts`); the reference layer keeps its own
Gogma-type-to-family table and never reads the Master mapping.

The blind route's exclusion is an unknown-input problem, never a
prediction-support gap and never a game rule. Never fabricate five slots for
a blind Normal. The pinned reference GARP.lua starts from Reset in its
base-tier state because the reference implementation does not treat
normal-scope current bonuses as a prediction input, not because the game
allows only Reset. Do not confuse that implementation constraint with a game
rule. The real-game result of a Keep from normal-scope slots has no
game-verified fixture yet; do not describe it as game-verified.

Statuses are:

```text
unclassified
practical
ideal
```

`status` is a user-facing organisation label and nothing more. It never decides
Planner eligibility, Search route eligibility, material use, or Target
Satisfaction. The four concepts stay strictly separate:

```text
status                                  the user's unclassified / practical / ideal label
isProtected                             whether Planner / Search may change the weapon
TargetWeapon.preferredOwnedWeaponId     the preferred starting weapon of a Target
Target Satisfaction                     judged from the actual Bonuses / Skills
```

Never write a check of the form "status === 'unclassified', therefore it may (or
may not) be changed". Mutability is decided by the `isProtected` contract fixed
in PR #12.

Defaults:

- A manually registered new Gogma weapon: `unclassified`, unprotected
- A Normal registered by Execution as a production target: `status = null`,
  unprotected; the conversion Step confirmation sets `unclassified`
- An Ideal completed by Execution: `ideal`, protected - for a newly created weapon
  and for an existing weapon alike (`docs/PLANNER_SPEC.md` 16.13). The Planner
  completes only the canonical Ideal result; a compromise checkpoint is an
  intermediate state of that same Route and is never reserved as a weapon of its own
- `practical` is written by the user's own relabelling, and by Execution when the
  user-selected compromise checkpoint is actually reached (protection untouched,
  `docs/PLANNER_SPEC.md` 16.12). Never label a weapon Practical merely because its
  performance meets a compromise condition
- The former "updating an existing Gogma to a Candidate result preserves its explicit
  protection value" rule is superseded: Ideal completion protects existing weapons too

Protected weapons must not be used by the Planner for:

- Reset Bonuses
- Keep Bonuses
- Reset Skills

A protected Gogma remains eligible as an `existing_gogma_current` zero-operation
Candidate when its current bonuses and skills satisfy the Target. It must not be the
source of future Bonus or Skill amendment exploration. Search must not invoke Skill or
Gogma prediction solely because a compatible protected source exists.

Status and protection remain independent user settings. Outside the creation
defaults and Execution completion above, changing one never changes the other: an `unclassified` protected
weapon relabelled `practical` stays protected, and an `ideal` unprotected weapon
relabelled `unclassified` stays unprotected. The user changes protection
explicitly when they want it. The Planner must never silently remove protection,
and status-only changes must not overwrite an existing saved protection choice.

Because `status` carries no calculation meaning, it is excluded from every
semantic hash and calculation identity, exactly like `name` and `memo`:

```text
status-only change
  -> referencedOwnedWeaponsHash          unchanged
  -> ExpectedPlanState.ownedWeaponsHash  unchanged
  -> constrained search identity         unchanged
  -> BuildListEntry                      not owned_weapon_changed
  -> ProductionPlan                      no semantic state mismatch
```

`id`, `kind`, `weaponTypeId`, `elementId`, `restorationBonusScope`, the five
stored bonus slots, Series Skill, Group Skill, `isProtected`, and Normal rarity
where applicable all stay semantic and still move those hashes.

`OwnedWeapon.executionInProgress` (作成中) is an internal Execution state orthogonal
to `status`. Never add `in_progress` or any similar value to `OwnedWeaponStatus`.
The user cannot edit it; it is excluded from every semantic hash and from Search /
Planner eligibility exactly like `status`, but Undo and game save point restore
must restore it exactly (`docs/PLANNER_SPEC.md` 16.10.1).

---

## No Owned Weapon Is Ever Consumed As Material

The model where an owned Gogma Artian weapon itself is consumed as material does
not exist in v1. The following are all removed from the current Domain and must
not be reintroduced:

```text
UseWeaponAsMaterialOperation / 'use_weapon_as_material'   RouteOperation
canUseAsMaterial                                          Domain rule
canConsumeMaterialWeapon / consumeMaterialWeapon          SimulatedInventory
PlannerSearchState.consumedMaterialWeaponCount            Planner state
CandidateScore.resourcePenalty                            Planner scoring
PlannerMaterialRequirement / PlannerMaterialAssignment    Planner-only DTOs
'material_weapon_shortage'                                PlannerWarningKind
'create_material_gogma'                                   PlanStepOperationType
'change_owned_weapon_status'                              PlanStepOperationType
'confirmed_weapon_status_change'                          ExecutionAction
'declined_weapon_status_change'                           ExecutionAction
'planned_status_change_declined'                          RecalculationReason
```

Therefore the Planner never detects a material weapon shortage, never schedules
a replenishment Route for one, never advances a Normal / Gogma / Skill Counter
purely to stock material, never schedules a step whose only effect is a status
change, and never counts consumed weapons in its score. The number of
`unclassified` weapons is not a Planner resource and must not affect
`evaluationScore` or `totalCost`.

Exactly these paths write `status` (`docs/PLANNER_SPEC.md` 8.1 / 16):

```text
any user relabelling                       ordinary Owned Weapons CRUD
Execution: conversion Step confirmed       status = unclassified
Execution: selected compromise checkpoint  status = practical (protection untouched)
           reached, and "finish as
           compromise"
Execution: Ideal completion Step confirmed status = ideal, isProtected = true
                                           (new and existing weapons alike)
```

Planner calculation (Beam Search, Trace Replay, the internal reserve action) never
persists a status. The internal reserve effect follows the Ideal completion
semantics above, so an existing weapon is treated as protected after completion.
Never "fix" this by deleting the Execution status writes so nothing touches status.
Even there status stays non-semantic: it decides no Search eligibility, no Planner
operation eligibility, no Target Satisfaction, and no semantic hash.

Current `RouteOperation` and `PlanStepOperationType` switches handle only the
current operations exhaustively. Never absorb a removed operation in a `default`
branch.

`SimulatedInventory.consumedWeaponIds` stays. Converting an owned normal Artian
weapon is the one remaining weapon consumption: `consumeOwnedNormalForConversion`
removes the source Normal from inventory so two Routes can never use it twice.
`same_owned_weapon_consumed`, `exclusiveConsumedOwnedWeaponId`, and
`consumedWeaponIds` serve that exclusive-source semantics and are kept unchanged;
do not rename or delete them. That is Planner search representation only: the
ProductionPlan execution projection and the persisted state update the same
OwnedWeapon ID from `normal` to `gogma` and never delete it to create another ID
(`docs/PLANNER_SPEC.md` 16.3).

Game item materials are a different concept and are untouched:
`MaterialRequirement`, `BuildCandidate.requiredMaterials`,
`ProductionPlan.requiredMaterials`, `InventoryChange.materialRequirements`,
`MaterialCostMaster`, `PlannerMasterSubset.materialCosts`, and the
`src/data/materials.json` / `src/data/material-costs.json` masters all stay. v1
adds no exact quantity revision, no owned-item tracking, and no shortage-based
Plan rejection. Where UI or documentation could confuse the two, say
アイテム素材 or 必要素材（アイテム）rather than a bare 素材.

---

## Display-only Cost Estimate

The Candidate card and the Production Plan detail show 「必要素材・費用の目安」
(`docs/REQUIREMENTS.md` 22.1, `docs/SEARCH_SPEC.md` 4.3, `docs/PLANNER_SPEC.md`
8.2, `docs/UI_FLOW.md` 9 / 11.0, `docs/MASTER_DATA.md` 13.1). It is display /
advisory only and lives in `src/domain/cost`: one operation cost definition
(`summarizeCostEstimate()`), a Route adapter
(`collectCostEstimateOperationsFromRoute()` / `estimateCandidateCost()`) and a
Plan adapter (`collectCostEstimateOperationsFromPlan()` /
`estimateProductionPlanCost()`), with the display names in the Presentation
layer.

- It is never persisted, never added to a Candidate, an Entry, a Plan, a Step,
  the Worker protocol or Export / Import, and it moves no schema or calculation
  version. It never enters Candidate identity, `candidateStableKey`, the dedup
  key, any hash, Search ordering, stream ordering, constrained enumeration,
  Planner scoring, Plan validity or Execution. The Search, Planner, Execution,
  Worker and Service layers never import it (a test enforces this)
- It manages no owned item count and judges no shortage. Never use it to prefer
  a cheaper Route
- The unit costs are fixed: a rarity-8 Normal forge is the weapon type's
  three-part recipe plus 10,000z per forge; the production-target Normal alone
  gets one full restoration (ナナイロカネ ×50 / 10,000z), never a Counter-advance
  Normal; a conversion is 油濁した遺装置 ×3 of one 激化 type / 30,000z; Reset and
  Keep Bonuses are each ナナイロカネ ×20 OR 歴戦錬磨の証 ×2 / 5,000z (an
  alternative, never summed, 歴戦錬磨の証 shown for Reset / Keep only); Reset
  Skills is 油濁した遺装置 ×6 (a different 激化 type) with ×3 for the same type
  as a note / 9,000z; `confirm_owned_ideal`, legacy Steps and weapon switch
  guidance cost nothing; no alchemy conversion is represented
- An owned weapon's sunk cost is never re-counted: an owned Normal Route starts
  at the conversion, an existing Gogma Route at its first amendment
- A Plan's total is derived from its physical Steps, never by summing Entry or
  Candidate estimates, so a shared Step counts once. A `create_normal_artian`
  Step's role comes from `executionEffects.normalCreationRole` only; a legacy
  Plan without it is reported as not derivable, never guessed
- `MaterialMaster` / `MaterialCostMaster` are not its authority and stay as the
  legacy Master-priced `requiredMaterials` model; never enable the unverified
  placeholder to make a display work, and never reintroduce the
  `material_cost_unverified` advisory or the 「素材コストは未検証」 texts
- Provenance: the 10,000z forge and 30,000z conversion are project owner direct
  game observations; the other unit costs and the 14 part recipes are reference
  information adopted for this feature. Neither is an RNG `game-verified` /
  `reference-verified` claim

---

## Target Weapon Rules

One desired build equals one `TargetWeapon`.

Do not merge targets just because weapon type and element match.

Priority:

```text
1 - 5
```

Default:

```text
3
```

### `preferredOwnedWeaponId`

`TargetWeapon.preferredOwnedWeaponId: OwnedWeaponId | null` names the owned weapon
this Target prefers as the starting point of its Route. The relation is an optional
1:1 - a Target names at most one weapon, and one weapon is the preferred origin of
at most one Target - and it points one way, from Target to weapon.

A weapon is selectable when its weapon type and element match the Target and it is
unprotected. Both `normal` and `gogma` kinds qualify. `status` is never a selection
condition: an unclassified, Practical, or Ideal weapon is equally selectable, and status
and preference stay independent user settings. Never auto-derive a preference from
status, and never require one.

It is a soft preference, never a hard Route constraint. Search still explores every
executable Route and excludes none for not being preferred; a shorter, cheaper, or
otherwise better Route wins. `docs/SEARCH_SPEC.md` 8.1 fixes where the preference sits
in the Candidate Search and constrained enumeration comparisons: immediately before the
final stable tie-break, never as a weight inside a score. The Production Planner (the
deterministic scheduler) does not use it at all (`docs/PLANNER_SPEC.md` 7.4, Issue #103
Phase C): one Target holds one Build List Entry, so there is no other Route to prefer.

It never restricts Target Satisfaction, which stays a judgment about actual weapon
performance: another weapon that meets the Target's conditions still satisfies it.
Planner calculation (Beam Search, Trace Replay, constrained re-search, what-if),
Candidate Search, and the internal `reserve_weapon` action must never set or
reassign it.

Execution is the one exception (`docs/PLANNER_SPEC.md` 16.2 / 16.11 / 16.13). The Plan
decides which existing OwnedWeapon each Target is produced from, but generating, saving or
displaying the Draft changes nothing. The Production Plan screen previews the link changes
the start will make (weapon, current holder Target or 未設定, destination Target), and
「作成開始」 applies them with `draft -> active` in one transaction: the Entry's Target
prefers that existing weapon and any other Target preferring it prefers nothing. A
production-target Normal the Plan registers does not exist at start and is linked by its
registration Step instead. The link survives Plan abandonment and finishing as a
compromise; the user removes it manually.

Ideal completion protects weapon X, and a preference may only point at an unprotected
weapon. Every Ideal completion - Execution target completion, `confirm_owned_ideal`, and
the Target Weapons "この武器で目標を完了にする" action - therefore sets to `null`, in one
transaction, the completed Target's preference and the preference of every other
Target preferring X. Only the preference is cleared: never touch those Targets'
conditions, priority, `isEnabled`, or lifecycle. In Execution, every cleared Target's
before state goes into `ExecutionUndoSnapshot.affectedTargetWeaponsBefore`; a
Plan-dependent Target's clearing is projected into `targetExecutionStateHash`, a
Plan-independent one is checked by collection validation (no Target may still prefer
X), and the save point restores them through its execution scope or the post-boundary
Undo snapshots (`docs/PLANNER_SPEC.md` 16.5 / 16.9 / 16.13). The Target Weapons action
names the affected Targets in its confirmation dialog.

Responsibilities are split and must not be merged back:

```text
BuildCandidate / BuildListEntry validity   not a Target performance definition:
                                           excluded from createTargetDefinitionHash(),
                                           never target_definition_changed
Planner / Draft Plan planning input        part of PlannerInput.targetWeapons and
                                           PlanningInputSnapshot.targetWeaponsHash
Active Plan Execution                      Execution's own link / relink / clear is
                                           normal progress, verified through
                                           ExpectedPlanState.targetExecutionStateHash
```

It never enters Candidate stable key, Candidate ID, Candidate deduplication key, or
the `BuildCandidateMeaning` fingerprint either: the preference belongs to the Target,
not to the Candidate's own meaning. The former rule that changing it stales
BuildListEntries is superseded; the implementation PR applies the new
`createTargetDefinitionHash()` normalization together with its version boundary.

### Target field responsibilities

`docs/PLANNER_SPEC.md` 16.11 ("TargetWeapon fieldの責務") is the authority.
`createTargetDefinitionHash()` covers the Candidate-forming performance definition
only:

```text
included: weaponTypeId, elementId, idealBonuses, practicalBonusConditions,
          alternativeBonusRules, idealSkillCondition, practicalSkillCondition
excluded: priority, isEnabled, preferredOwnedWeaponId, lifecycleStatus, completedAt,
          completedByProductionPlanId, name, memo, timestamps
```

Calculation schema 11 and earlier included `priority`, `isEnabled`, and
`preferredOwnedWeaponId`; calculation schema 12 removed them with its version boundary.

```text
priority                 Planner planning input (order / score). Never stales an
                         Entry. Part of targetWeaponsHash and, for a Plan-dependent
                         Target, dependentTargetDefinitionsHash: changing it breaks
                         the Draft / Active Plan (target_changed, UI pre-warning)
isEnabled                Search / Planner input exclusion. Never stales an Entry.
                         Part of targetWeaponsHash and dependentTargetDefinitionsHash
preferredOwnedWeaponId   Search / constrained enumeration tie-break (no Production
                         Planner preference since Issue #103 Phase C). Never stales
                         an Entry. Part of targetWeaponsHash; for a Plan-dependent
                         Target verified by targetExecutionStateHash
lifecycleStatus          completed is excluded from Search / Planner input, never
                         stale. Part of targetWeaponsHash; for a Plan-dependent
                         Target verified by targetExecutionStateHash
```

`PlanningInputSnapshot.targetWeaponsHash` is an independent planning-input contract,
never just `createTargetDefinitionHash()` reused. It hashes every PlannerInput Target,
sorted by ID, as
`{ id, definitionHash: createTargetDefinitionHash(target), priority, isEnabled,
preferredOwnedWeaponId, lifecycleStatus }`, excluding name, memo, completion
timestamps / Plan ID, and timestamps. `dependentTargetDefinitionsHash` hashes each
Plan-dependent Target as `{ id, definitionHash, priority, isEnabled }`
(`docs/DATA_MODEL.md` 11.2).

### Target lifecycle

A `TargetWeapon` carries `lifecycleStatus: "active" | "completed"`
(`docs/DATA_MODEL.md` 8.1). Ideal completion by Execution, or the user's explicit
"complete this Target with this owned weapon" action, sets `completed` and clears
`preferredOwnedWeaponId` of that Target and of every other Target preferring the
completed weapon. A completed Target is kept as a record (never physically
deleted for completion) but is excluded from the normal Target list, Candidate
Search, and Planner input. Finishing as a compromise never completes a Target.
Lifecycle is not a performance definition and stays out of
`createTargetDefinitionHash()`. Never infer `completed` from owned Ideal weapons in a
migration.

A collection-level validation authority, separate from single-Target validation,
fails closed on a missing referenced weapon, a weapon type or element mismatch, a
protected weapon, and the same weapon being preferred by two Targets. The save
Service, Candidate Search input, and Planner input all reuse it; UI is never the
authority. Reassigning a weapon between Targets, and protecting or re-typing a
preferred weapon, each persist their two writes in one transaction, so no
intermediate state where two Targets hold one weapon - or where a Target holds a
protected one - is ever stored. An OwnedWeapon a Target prefers is protected from
deletion through the existing ReferenceFinder, reported as `target_weapon`.
`docs/DATA_MODEL.md` 8.5 is the authority.

A Target's ideal five-slot multiset is the only Bonus authority.
- Practical preserves types and counts; only explicitly configured types relax ranks (minimum + EX minimum).
- Alternative uses exactly one source Rule and one Option, replacing 1..max slots and keeping every other Ideal slot unchanged.
- Practical Bonus and Alternative Bonus never combine. Skill is an independent axis.
- Unset Practical Skill (both IDs null) allows only Ideal Skills. Search is Ideal-only either way; compromise conditions decide only which intermediate states are offered.
- All Bonus matches require gogma_artian scope. Normal creation/conversion routes remain available through Reset.
- DATA_MODEL 8 and docs/TARGET_COMPROMISE_SEMANTICS.md define the new types and validation.
- Target saving and Search validate structure, Master references and Ideal containment before evaluation.
- Current Ideal stream shortcuts, Cross composition and independent RNG streams remain mandatory.



Do not introduce "any one target in this group completes the group" behavior in v1.

---

## Canonical Ideal Route and Compromise Checkpoints

A compromise result is never an independent Candidate. `CandidateCategory`,
`BuildCandidate.category`, `isSimilarToIdeal`, `similarityScore`,
`similarityThreshold`, `CandidateResultFilter`, `maxCandidatesPerTarget`, the
Practical horizon, `practicalDominates()`, the Similar filter, and
`RelaxationSuggestion` are all removed and must not be reintroduced.

A Candidate Search request covers exactly one `targetWeaponId` and returns at
most one canonical Ideal `BuildCandidate`:

```text
Ideal reachable in range     -> 1 canonical Ideal + its checkpoints
Ideal not reachable in range -> no Candidate, no checkpoint
```

Reaching a compromise state without reaching an Ideal produces nothing. The UI
must say the Ideal was not found *in the current search range*, never that the
Target has no Ideal.

A compromise is an intermediate, usable state on the way to the Ideal, never a
final goal: Target completion is always the Ideal. The canonical Ideal Route is
read as three **lanes** (`docs/SEARCH_SPEC.md` 5.8, `docs/PLANNER_SPEC.md`
7.0.4): the base lane (create / convert), the Bonus lane (Reset / Keep Bonuses)
and the Skill lane (Reset Skills). Compromise states are offered **per lane** as
`IntermediateStateGroup`s on `BuildCandidate.intermediateStateGroups`, never as
Skill x Bonus combinations and never as a strict prefix of one fixed operation
order. They are reconstructed by a pure replay of the Candidate's own
observational traces (`bonusAmendmentTrace`, `skillAmendmentTrace`,
`conversionSkillTrace`) plus the Route base OwnedWeapon, so extraction adds
**zero** RNG prediction calls, and UI/presentation code must never re-run the
RNG Engine to render one.

Intermediate states are two-layered. A group is the user-visible state of one
lane: a Skill group is Series Skill, Group Skill and `match`
(`practical | ideal`); a Bonus group is scope, the unordered five-slot multiset
with duplicate counts preserved and `match` (`practical | alternative | ideal`).
Slot order is deliberately excluded from group identity. An opportunity is one
arrival at that state and keeps its `lanePosition` (how many operations of that
lane were run), its `operationIndex` (`null` for a lane start state), and for
the Bonus lane the exact ordered five slots. Lane position 0 is a legitimate
opportunity: the conversion-assigned Skill and an existing Gogma's current
Skill are "Skill Reset 0" states, and an existing Gogma's current
`gogma_artian` five slots are a Bonus lane start. A `normal_artian` scope
five-slot set right after conversion is never offered. The lane end is the Ideal
itself and is a goal, never an intermediate state; the UI shows it as 最終目標
without a checkbox. Both ids are deterministic functions of `candidateStableKey`,
the axis, the group identity and the lane position — never of `searchRunId`,
the Clock, or an enumeration ordinal.

Every arrival is retained. Two arrivals at the same state stay two
opportunities; the earliest is the display representative and the rest are
disclosed as 「その他の到達点」. A conservative, per-`bonusTypeId` rank-vector
dominance may mark a Bonus group display-secondary, but it never removes a group
or an opportunity from the Domain: a "worse" state can be the only one that
avoids a Counter conflict. Differing Bonus Type compositions and uncomparable
Master references are never ranked against each other, and Skill groups are
never dominated.

`TargetWeapon.practicalBonusConditions`, `alternativeBonusRules`,
`practicalSkillCondition`, `OwnedWeaponStatus.practical`,
`satisfiesPracticalTarget()`, and `hasPractical` all stay: they decide what
counts as a compromise and what a weapon actually delivers.

Constrained enumeration yields Ideal Candidates only, for the same reason: a
Planner-generated Entry for a compromise result would be exactly the separate
Practical BuildListEntry this model forbids.

### Selection, pins and the compromise checkpoint

`BuildListEntry.intermediateStateSelection` holds `skillOpportunityId`,
`bonusOpportunityId` (each `null` or one opportunity of its own lane) and
`improvementPreference` (`planner | skill_first | bonus_first`, default
`planner`). It is set in Candidate Search, saved on the Entry when the Candidate
is added, and edited only in the Build List — never on `TargetWeapon`, never in
Candidate identity, hashes or staleness, but always in the Plan's
`buildListEntriesHash`. Selecting both lane starts at once is legal: for an
existing Gogma that is the weapon the user already holds, and its compromise
checkpoint is held at Planner start (see below).

The Planner derives a **pin** per lane: the selected lane position, or the lane
end (Ideal) when that lane is unselected. The compromise checkpoint is the
moment both lanes hold their pinned state at once: Skill-only selection means
selected Skill + Ideal Bonus, Bonus-only means Ideal Skill + selected Bonus,
both means selected + selected, and Ideal + Ideal is the Ideal, not a
checkpoint. A lane may not pass its pin — by execution or by silent
fast-forward — before the other lane reached its own pin, and the unit that
produces a pinned state is never `canSkipWhenCounterPassed`. After the
checkpoint the improvement order is not fixed at Search time: both Skill-first
and Bonus-first continuations stay reachable, and the preference is the soft
tie-break of `docs/PLANNER_SPEC.md` 7.6 — below correctness, the hard pin
constraint, Target satisfaction, feasibility of the whole multi-Target Plan,
the existing evaluation score and the preferred source, above
`weaponSwitchCount`. A preference is never a rejection, a conflict, or a
transplant of the selected state onto another opportunity.

### Checkpoint conflicts and constrained re-search

### Checkpoint conflicts and constrained re-search

A selected intermediate state is a hard constraint the Planner never drops,
moves, or empties on its own. Two rules follow, both Domain authority and never UI-only
(`docs/PLANNER_SPEC.md` 9.5, `docs/DATA_MODEL.md` 11.8, `docs/UI_FLOW.md` 11.1):

- A conflict whose `PlanConflict.checkpointParticipants` is non-empty cannot be
  resolved by a generic `PlannerConflictResolution`. Picking either side would
  let the Planner drop the other side's selected checkpoint, so
  `conflictResolutionRefusalReason()` refuses it: initial conflict detection
  leaves `selectedBuildListEntryId = null`, Beam Search reports
  `invalid_conflict_resolution`, `preparePlannerFixedConflictConstraints()` and
  the preflight re-association fail with `checkpoint_conflict`, and the Plan UI
  disables 「比較する」 / 「この候補を優先」 for every participant and routes to
  the Build List. The only resolution is changing or clearing the selection
  there; a shared physical action that reaches several checkpoints at once is
  still one action and no conflict
- Constrained re-search and what-if never replace the Route of a Target that
  has a required checkpoint Entry anywhere in the current valid Entry set - not
  only among the conflict's participants: no auto-transplant onto another
  opportunity, no "same performance, other Route", no empty selection.
  `createPlannerConflictWorks()` takes the run's `PlannerCheckpointRequirements`,
  `PlannerConflictWork.blockedBySelectedCheckpoint` skips the enumeration, the
  conflict is returned as it is with the warning
  `selected_checkpoint_blocks_constrained_search`, and what-if answers
  `blocked_by_selected_checkpoint`. A Target with no selection is re-searched
  exactly as before

---

## Build Candidate and Build List Separation

`BuildCandidate` is a search result.

`BuildListEntry` is a separate persisted entity representing a user-selected Planner input.

Do not use `BuildCandidate` persistence as Build List membership.

When a candidate is added to the Build List, preserve:

- Candidate snapshot
- Target definition hash
- `searchStateHash`
- `referencedOwnedWeaponsHash`
- `CalculationContext`

Deleting/replacing an old `BuildCandidate` during a later search must not automatically delete its `BuildListEntry` snapshot.

The originating Candidate ID is traceability information, not the source of truth for an existing Build List entry.

Build List cardinality (implemented; Issue #103 Phase 0, `docs/DATA_MODEL.md` 9.4.1,
`docs/PLANNER_SPEC.md` 4.1 / 9.2.18): the persisted Build List holds at most one
`BuildListEntry` per `targetWeaponId`. Adding a different Candidate for a Target
that already has an Entry is one confirmed, atomic, Plan-breaking-guarded
replacement, never a second Entry; the old Entry's intermediate state selection
and improvement preference are never carried over. A constrained re-search trial
may hold the original Entry and a temporary generated Entry together, but an
adopted generated Entry replaces the original Entry in the same transaction as
the Plan save, and a Plan is calculated and recorded over the replaced Entry
set. Legacy duplicates are never resolved automatically: the ordinary Planner
input fails closed and the user keeps one Entry. No provenance field and no
version change are added.

Phase 0-1 (the Domain / Service foundation) implemented: the one collection
authority `findBuildListTargetDuplicates()` / `validateBuildListCardinality()` /
`classifyBuildListCandidateAddition()` (`src/domain/buildList/buildListCardinality.ts`);
the ordinary Planner input fail-closed with the warning
`duplicate_build_list_entries_for_target`, counting every Entry of a planning
Target, stale ones included, so the non-stale one is never picked silently (no
Beam Search, `plan = null`, `exhausted`); a Domain calling-context parameter for
the B8 / what-if trial inputs - never a `PlannerInput` field or a Worker request
(Phase 0-1's `PlannerBuildListCardinality`, which skipped the trial check, was
replaced by Phase 0-3's `PlannerBuildListContext` below);
`BuildListService.addCandidate()` returning `added` / `duplicate` /
`replacement_required` / `legacy_duplicate` with the decision and the addition in
one transaction (`BuildListEntryRepository.decideAndAddBuildListEntry()`); and
`BuildListService.replaceCandidate()` / `inspectCandidateReplacement()`, one
`PlanGuardedMutation` (`buildListEntryReplacementMutation()`) that re-reads the
Target's Entries, refuses unless the confirmed `expectedExistingEntryId` is still
its only Entry, never carries the old selection or preference over, and goes
through the existing `PlanBreakingChangeGuard`. Import / Export keeps a legacy
duplicate as it is.

Phase 0-2 (the UI) connected it (`docs/UI_FLOW.md` 9 / 10): the Search screen
takes `AddBuildListCandidateResult` as it is (the Phase 0-1 adapter
`toSearchScreenAddition()` and the `replacement_confirmation_unavailable` code are
gone). `replacement_required` opens `BuildListReplacementDialog`
(「作成リストの候補を置き換えますか？」: the Target, 「現在の候補」 and 「新しい候補」
from their recorded Candidate data, and that the old selection and preference are
not carried over; nothing is written before 「置き換える」). Only then does
`useBuildListCandidateReplacement()` run `inspectCandidateReplacement()` /
`replaceCandidate()` through the shared `usePlanBreakingChangeApproval()`, so the
`PlanBreakingChangeDialog` follows the replacement confirmation and never stands
in for it; a success removes the old Entry and adds the new one in the screen's
mirror at once, and a typed `BuildListCardinalityError` closes the dialog,
reports it and re-reads the Build List without retrying. `legacy_duplicate` opens
no dialog and points to the Build List. The Build List marks each Target that
`findBuildListTargetDuplicates()` reports with a 「要整理」 chip and a warning,
recommends no Entry, and leaves the tidying to the ordinary guarded Entry delete;
it disables no Planner control, leaving that to the Planner fail-closed. No
version moved.

Phase 0-3 (Planner / Persistence) connected constrained re-search, what-if, the
ordinary Planner result save and the replan adoption (`docs/PLANNER_SPEC.md`
9.2.18) with the current Beam Search unchanged. The one replacement authority is
`src/domain/buildList/buildListEntryReplacement.ts`: `BuildListEntryReplacement`
(`targetWeaponId`, `replacedBuildListEntryId` = the persisted `O`,
`generatedBuildListEntryId` = the temporary `G`), `resolveBuildListEntryReplacement()`
(the Target's one persisted Entry, otherwise fail closed),
`applyBuildListEntryReplacements()` (the replacement set, `-O + G`),
`validateBuildListEntryReplacements()` (per Target persisted 0..1 + temporary 0..1:
`augmented` = exactly `O` + `G`, `replaced` = exactly `G`),
`validateGeneratedBuildListEntryReplacements()` and
`validateReplacedBuildListCardinality()`; B8, B9, the Draft save and the replan
adoption never re-implement them. The Domain calling context is
`PlannerBuildListContext` = `persisted` | `temporary_augmented` (preflight input
`O + G`) | `temporary_replacement` (full run input `-O + G`), the last two carrying
runtime-only `replacements`; the persisted side of a trial input keeps the ordinary
duplicate check, and every full Planner run (`runPlannerBeamSearch()`, Production
Plan generation, a runtime-unsupported retry included) accepts
`PlannerRunBuildListContext` only, so `O` is never an execution candidate. A trial
runs `preparePlannerReplacementConflictPreflight()`: the unchanged 9.2.3.1
re-association over `O + G`, then again over the replacement set, where a
constraint with no match is fulfilled by the replacement (`replacementSatisfiedConstraints`,
no resolution rebuilt) only when every other participant of its original conflict
was replaced; any other zero / several matches, fingerprint mismatch or excluded
fixed Entry still fails the trial closed, and unrelated explicit resolutions are
re-mapped, never dropped. The full run, and so the Plan's Steps, `conflicts`,
`rejectedBuildListEntries` and `PlanningInputSnapshot`, is the replacement set; B8's
`currentAugmentedInput` holds the adopted replacement set (never `O`, `G1`, `G2` of
one Target: an adopted Target's later works are already satisfied, and a second
temporary Entry for one Target throws an invariant error rather than being guessed).
What-if trials use the same two-step preflight and run from the unchanged baseline;
a `reusedExisting` Candidate is still judged as the ordinary baseline. The adoption
metadata travels as `PlannerOrchestrationResult.generatedBuildListEntryReplacements`
(one per generated Entry, empty with `plan === null`, plain serializable data, no
Worker protocol change beyond the type), and `checkPersistablePlannerResultShape()`
refuses a result whose metadata is missing, extra or for another Target. Saving
(`prepareFinalReplacementBuildList()`) re-checks inside the transaction that each
Target's persisted Entries are still exactly the replaced `O` (`planner_state_changed`
/ `replan_state_changed` otherwise, deleting nothing on a guess), refuses an already
persisted generated ID, builds the final replacement set and validates it with
`validateBuildListCardinality()`, and `checkProductionPlanBuildListReferences()`
refuses a Plan still naming `O`. `PlannerResultPersistenceService` gained
`inspectPlannerOrchestrationResultSave()` and `savePlannerOrchestrationResult(result,
context, approval?)`: the whole save is one `PlanGuardedMutation` through the existing
`PlanBreakingChangeGuard` (its new `afterWrite` option deletes the old Drafts and adds
the new Draft in the same transaction; its collection write now adds a record the
read state did not hold instead of putting it), so replacing an Entry the `active`
Plan depends on needs the approval and ends that Plan (`breaking_change_approved`)
atomically, while a Draft / stale / ended Plan referencing `O` needs none. Choosing
「最後のゲーム内セーブ地点へ戻す」 in that approval is the one exception to the generic
restore -> change -> abandonment of a guarded change (`docs/PLANNER_SPEC.md` 9.2.18 /
16.10): the Planner result was calculated before the restore and is no authority over
the restored state, so only the save point restore is written
(`preparePlanGuardedSavePointRestoreInsteadOfChange()` sharing the approval / choice checks
with `preparePlanGuardedMutation()`, `prepareExecutionSavePointRestore()` unchanged,
`PlanBreakingChangeGuard.restoreSavePointInsteadOfChange()`, and the same
`writeExecutionSavePointRestore()` the ordinary restore uses), nothing of the result -
no `G`, no `O` removal, no Draft change, no `breaking_change_approved` - and
`savePlannerOrchestrationResult()` returns the typed
`save_point_restored_recalculation_required` outcome (`saved` / `no_plan` otherwise) so the
screen asks for a new calculation; the snapshot checks are never weakened to fit the old
result, and every other guarded change keeps restore -> change -> abandonment. The B10
recalculation save on the Production Plan page goes through
`usePlanBreakingChangeApproval()` / `PlanBreakingChangeDialog`; the Build List page's
ordinary input carries no conflict resolution, so B8 never runs there and it needs no
dialog. The replan adoption deletes `O` and adds `G` in its own transaction with
`replan_adopted` and adds no further warning; choosing the save point restore still
adopts and replaces nothing. No version moved (13 / 8 / 11).

---

## Build List Stale Rules

A `BuildListEntry` can become stale for:

```text
target_definition_changed
rng_state_changed
owned_weapon_changed
calculation_context_changed
```

Recalculate stale reasons from current data.

Do not trust only the persisted `isStale` flag.

`target_definition_changed` follows the Target performance definition only.
`priority`, `isEnabled`, `preferredOwnedWeaponId`, and Target lifecycle
(`lifecycleStatus`, `completedAt`, `completedByProductionPlanId`) are outside
`createTargetDefinitionHash()`, so changing them - including Execution's automatic
link at production start - never stales an Entry. An Entry of a `completed` Target is not stale; Planner input excludes it as a
completed Target.

### `searchStateHash`

Hash only route-dependent RNG state.

Include, when relevant:

- Base Seed value and confirmation state
- Gogma Counter value and confirmation state
- Skill Counter value and confirmation state
- Relevant Normal Artian counter value and confirmation state

Exclude legacy Counter Gate value, confirmation state, and source. Production
active Prediction does not use them, so changing only persisted Gate must not
cause `rng_state_changed` or expected-plan false staleness.

Exclude non-semantic fields such as:

- RNG source
- Notes
- Observation timestamps
- Display-only fields

For v1, if the route-dependent RNG hash changes, use the safe behavior:

```text
rng_state_changed
```

A conversion-only route hashes the confirmed Base Seed and Skill Counter, plus
the relevant Normal Counter only when it forges. It does not hash Gogma Counter
merely because the result is a Gogma weapon. A route that adds Reset or Keep
also hashes the Gogma inputs those operations require. It never hashes legacy
Counter Gate.

### `referencedOwnedWeaponsHash`

Hash only OwnedWeapons actually referenced by the route.

Collect references from:

- `BuildRoute.sourceOwnedWeaponId`
- Reset Bonuses source
- Keep Bonuses source
- Non-null Reset Skills source

Deduplicate and stably sort IDs.

Include semantic weapon data such as:

- ID
- Kind
- Weapon type
- Element
- Stored restoration bonus slots
- Restoration bonus scope
- Protection

For Gogma Artian weapons, also include:

- Series skill
- Group skill

Exclude:

- Name
- Memo
- Status
- `createdAt`
- `updatedAt`

Unrelated OwnedWeapon changes must not stale the entry.

If a referenced weapon disappears or semantically changes, use:

```text
owned_weapon_changed
```

Routes that reference no OwnedWeapon use:

```text
referencedOwnedWeaponsHash = null
```

---

## Search Route Rules

Candidate search runs per TargetWeapon, even if one Worker request handles multiple targets.

Search only routes whose capabilities and prerequisites are available.

A Target's `preferredOwnedWeaponId` never narrows that route scope, never changes
the search horizon, the canonical-Ideal cost boundary, the extracted intermediate states,
the number of RNG prediction calls, the stream search depth, or any Counter
semantics. It affects only the choice and ordering
among Candidates every existing priority already rates equally
(`docs/SEARCH_SPEC.md` 8.1).

### Candidate Search and Planner Responsibilities

```text
Candidate Search
  For this Target alone, from the current RNG state, find the nearby
  Practical and Ideal results quickly

Planner
  For several Targets at once, decide how to reconcile Counter operations
```

Candidate Search must not pre-read second and third copies of the same Ideal,
distant alternative Ideals, or the Bonus-alternative by Skill-alternative product
merely because the Planner might later hit a conflict. The initial search ends
once one canonical Ideal is settled; the per-lane intermediate states of that
Route are then extracted from the traces it already recorded.

Only when Counter conflicts actually occur across Targets does the Planner
re-search the conflicting Targets, look up the next feasible Ideal Route for the
Target that yields, and compare how much further each choice pushes the other.
`docs/SEARCH_SPEC.md` 5.6 and `docs/PLANNER_SPEC.md` 9.1-9.2 hold that contract.
B8-A fixed the formal Planner-driven constrained re-search contract; B8-B1
onward implement it.

### Candidate Search Stream Separation

Normal, Gogma, and Skill are independent RNG streams. Reset Skills advances only
the Skill Counter. Reset Bonuses and Keep Bonuses advance only the Gogma
Counter. Candidate Search must preserve that independence in its own control
flow, not only in the recorded counters.

- Never nest Skill exploration inside a Gogma state, and never nest Gogma
  exploration inside a Skill result
- The number of `predictSkills` calls must not grow with the number of Gogma
  states, owned sources, or normal offsets
- The number of `predictGogmaBonus` calls must not grow with the number of
  Skill positions
- Gogma Reset does not read the current bonuses, so compute it once per Gogma
  Counter position instead of once per state
- Keep depends only on the slot family layout of the previous bonuses, so two
  states sharing a family layout reach exactly the same later Bonus outcomes;
  dedup the Gogma frontier by family layout. That reduction is lossless for
  Bonus reachability only — it collapses route-history diversity to one
  deterministic representative, which is a known Planner limitation, so never
  call it simply "lossless"
- If the current Skills already satisfy the Target's ideal Skill condition, do
  not search Reset Skills for that weapon
- If the current bonuses have `gogma_artian` scope AND exactly match the
  Target's ideal bonus multiset, do not search bonus amendments for that weapon
- Normal-scope exact labels are not Bonus Ideal. Continue supported Reset
  exploration after conversion and from inherited normal-scope Gogma sources
- A stream that currently satisfies only a compromise condition is not
  finished: Ideal exploration continues on it, and a compromise state becomes an
  intermediate state only when it lies on a lane of the settled Ideal Route

Do not enumerate the Cartesian product of bonus results and Skill results, and
do not reintroduce it as a lazily expanded priority queue or a small fixed
diagonal band over the same product. Solve each stream independently, then
compose only the routes the documented candidate composition rule requires. The
Cross rule is the initial bounded search policy, not a complete search through
the Planner. `docs/SEARCH_SPEC.md` is the authority for the stream solution sets,
their deterministic ordering, the composition rule, the termination condition,
and the meaning of `maxGogmaAdvance`, `maxSkillAdvance`, and
the three advance bounds.

Terminate after the canonical Ideal is settled. The canonical Ideal is
defined by the documented total order over Ideal candidates. Never let it depend
on incidental traversal order — which RouteKind ran first, or which Promise
settled first. Its final tie-break must be a stable semantic key over the
candidate's result and route; `BuildCandidate.id` cannot serve there because the
current implementation folds `searchRunId` into the hash, so the same input would
pick a different Ideal on a second run.

The same rule governs the final Candidate output. No run-dependent value may
decide the ordering of a Search result: the final tie-break of the display sort
and of duplicate selection is `candidateStableKey`, never `BuildCandidate.id`,
`searchRunId`, or `createdAt`. Two candidates that also tie on
`candidateStableKey` carry no run-independent semantic difference left to order
by, so they compare equal and deduplication keeps the first one reached. Re-running
the same Search input with only a different `searchRunId` must produce the
identical ordered `candidateStableKey` sequence per Target — array order, not
merely the same set — even though the `BuildCandidate.id` values differ. The
`BuildCandidate` ID generation rule, including `searchRunId` inside its
`semanticHash`, stays unchanged.

Keep the intermediate state set independent of discovery order too. Every
intermediate state of the settled canonical Ideal Route is extracted from the
traces that Route already recorded, so the extracted groups and opportunities
are the same whichever RouteKind or Promise settled first.

Keep intermediate state groups plural. Nothing is removed from the Domain: the only
dominance is the display-only conservative one of `docs/SEARCH_SPEC.md` 5.8.4
(`isDisplaySecondary` / `dominatingGroupId`), which requires equal scope and
Skills, a per-`bonusTypeId` rank vector that is at least as good everywhere and
better somewhere, an earliest arrival that is no later, and comparable Master
references. Compare bonus ranks as a per-`bonusTypeId` rank multiset, never by
slot index, and treat a scope or type whose Master rank ordering cannot be
compared safely as incomparable. Never rank bonus types or skills against each
other by assumed game strength; differing compositions are incomparable, so both
groups stay primary.

`maxGogmaAdvance` bounds the Gogma Counter positions the search covers, not the
number of Engine calls; a bounded state search inside the Gogma stream is
allowed. `maxSkillAdvance` is the maximum Reset Skills count, so a conversion
route's shared Skill prediction array spans one extra position without raising
that Reset bound. There is no output cap: a request returns at most one
canonical Ideal Candidate.

A later Counter position reaching the same result may be omitted from the initial
search's retained output, but it is never permanently dominated. Some of those
positions were genuinely never explored — the search stopped at the canonical
Ideal — while others were evaluated and then dropped by stream-local retention.
The Planner requires `counterBefore` to match the runtime counter, so those
positions stay semantically different. A constrained re-search must be able to
reconsider them: an earlier same-result solution that is unusable under the
Planner's fixed Candidates must never permanently hide a usable later one.

This is a Candidate Search orchestration contract. It does not change Production
RNG prediction semantics or `PRODUCTION_RNG_ENGINE_VERSION`.

`docs/CANDIDATE_SEARCH_REDESIGN.md` records the audit measurements, the rejected
alternatives, and the accepted limitations behind this contract. It is a design
record, not specification authority.

B4 is implemented: a target-wide pending-work queue settles the canonical
Ideal and every Practical within its inclusive operation horizon before stopping.
Each Normal offset/base is registered once; shared channels retain only new
Skill/Bonus depths and publish deltas to per-base Cross anchors. Settled work is
never replayed at later layers. An empty queue terminates even without an Ideal.
Incremental Skill prefixes and Bonus frontiers preserve B1/B2 sharing;
B3 Cross composition remains unchanged. Run-independent selection, conservative
Practical dominance, and an output cap reserving the canonical Ideal are active.
B5 is implemented as a measurement task. The real Browser Worker benchmark is
recorded in `docs/B5_CANDIDATE_SEARCH_BROWSER_WORKER_BENCHMARK.md`. It changed no
Search semantics, no B4 scheduler behavior, and no Production RNG semantics; the
only production change is the Worker checkpoint yield mechanism in
`search.worker.ts`, which must stay a macrotask so a pending `cancel` message is
dispatched mid-search. The measured retained candidate set is unchanged. Two
defects it reproduced were deliberately left to B6: the final Candidate output
ordering is run-dependent because `compareCandidates()` ties on
`BuildCandidate.id`, and `SearchWorkerClient` subscribed to no Worker `error` or
`messageerror`, so a failed Worker was never detected automatically and its
`startSearch()` stayed pending until the user cancelled (the existing Search page
Cancel control still recovers the UI). B6 fixed the Worker error handling, and
B6-F1 fixed the Candidate output ordering. The retained set and the canonical
Ideal were run-independent throughout.

B5-F1 resolved the separate Ideal scope defect found in B5. SEARCH_SPEC 5.1
remains the authority: Ideal Bonus requires `restorationBonusScope ===
"gogma_artian"` AND exact five-slot multiset equality. Target Domain's
`satisfiesIdealBonuses()` is the shared pure authority for Target evaluation,
stream-local Ideal matching, and current Bonus shortcuts. Scope is explicit,
never defaulted. Unknown BonusRank references must still raise a Domain Error
before a normal-scope result is rejected as non-Ideal.

SEARCH_SPEC 5.5.3 retention now uses (restorationBonusScope, completed multiset).
Normal and Gogma outcomes with identical labels remain separate solutions.
Full-prefix retention, incremental retention, and delta Cross dedup share that
identity. Stream ordering keeps advance, closeness, and material quantity
priorities; scope is the final stable semantic tie-break after multiset and
operation types. This is initial-Search retention, not permanent dominance, and
does not change B2 family-layout frontier dedup or lastResetDepth representatives.

Under the historical B5-F1 contract, normal scope with 5/5 Ideal labels and
matching Skills could be Practical with similarityScore 1. That acceptance rule
is obsolete. Current Ideal / Practical / Alternative Bonus matches all require
gogma_artian scope; normal_artian scope is never accepted as a Candidate or as an
intermediate state, regardless of matching labels or Skills.
Current tests reject normal-scope conversion D=2 and cover exploration
continuing to a Gogma-scope canonical Ideal D=3 after Reset, and an existing
normal-scope Gogma continuing Bonus exploration. The Gogma-scope current Ideal
shortcut still makes zero amendment predictions. B5's Browser Worker measurements
and schema version 2 metadata describe the historical workload only. The Target
compromise revision changed benchmark fixture conditions and workload, so current
workloads must not be compared directly with those historical measured values.
Current benchmark calculation metadata uses shared schema version 6; Vitest
validation is not a replacement for a new Browser Worker performance measurement.
Historically, B5-F1 was independent of B6.
Planner constrained re-search is specified by B8-A and unimplemented until
B8-B1.

B6 is implemented as a UI / defaults / progress / Worker error task. It changed
no Search semantics: the Cross rule, the B4 scheduler, the canonical Ideal, the
then-current Practical horizon and dominance, Similarity formula and `resultFilter`
semantics (all since removed),
`CalculationContext.appSchemaVersion = 2`, Production RNG semantics and version,
the checkpoint interval of 50, and the MessagePort `workerYield` are all
unchanged; normal-scope Keep prediction was unimplemented at that time and was
added later by the normal-scope Keep correction.

- `defaultCandidateSearchSettings` was `1000 / 200 / 1000` with
  `maxCandidatesPerTarget = 200` and `similarityThreshold = 0.6`, from the B5
  Browser Worker measurements (Normal 1000 ~ 256 ms, Skill 1000 ~ 325 ms, Gogma
  200 ~ 1961 ms). This lowers a default, not a capability: the Search UI still
  raises every bound. The benchmark workloads pin all five B5-era settings as
  `B5_MEASUREMENT_SETTINGS` (`5000 / 5000 / 5000 / 200 / 0.6`), independent of
  `defaultCandidateSearchSettings`, so a later default change cannot redefine a
  historical workload; their labels say `B5 default bounds`, and the workload
  IDs are unchanged.
- `CandidateSearchProgress` adds `phase` (`preparing` / `searching` /
  `finalizing`) and `processedWorkItems`. A Target reports its start before it
  completes, reports settled scheduler work every
  `SEARCH_ACTIVITY_PROGRESS_INTERVAL = 100` items while it runs, and reports
  `completedTargets = index + 1` when it finishes; `processedWorkItems` restarts
  at 0 per Target. Target-internal total work grows while searching, so neither
  field may be turned into a percent, and no progress message is sent per work
  item. Progress must never change Candidate results.
- A native Worker `error` or `messageerror` fails closed: every pending search
  is rejected with `SearchWorkerRuntimeError`, pending is cleared, listeners are
  removed, the Worker is terminated, and later `startSearch()` calls reject
  immediately. A broken Worker is never silently reused, and v1 adds no
  automatic Worker re-creation or page reload. The Worker protocol
  `type: 'error'` response stays a separate path that rejects only its own
  request and leaves the Worker usable.
- The skip reason `normal_scope_requires_reset` was renamed
  `normal_scope_keep_prediction_unsupported` in B6; the normal-scope Keep
  correction later removed that reason entirely, because Keep from known
  normal-scope slots is now predicted. Never reintroduce either reason, and
  never add a label that states a game rule requiring a Reset first. `no_owned_weapon_available` is used by both
  `owned_normal_artian_to_gogma` and `existing_gogma_*`, so its label names no
  weapon kind; the RouteKind label carries that.

The run-dependent Candidate display ordering found in B5 is untouched by B6 and
was fixed separately in B6-F1.

B6-F1 is implemented as a Search determinism task. `compareCandidates()` and
`compareDuplicateCandidates()` now break their final tie on `candidateStableKey`
instead of `BuildCandidate.id`. Their existing priorities are unchanged, as are
`candidateStableKey` itself, `candidateDeduplicationKey()`,
`compareCanonicalIdeals()`, `compareCandidateSelection()`,
`retainInitialCandidates()`, the Similarity formula, `resultFilter` (all since removed), the B6
defaults, progress and Worker error handling, `CalculationContext.appSchemaVersion
= 2`, and Production RNG semantics and version. Do not change `candidateStableKey`
or the `BuildCandidate` ID generation rule as a side effect.

### Issue #104 Normal Route base reduction

Initial Candidate Search incrementally retains the first Normal offset's full Reset/Keep
stream. Later Normals first require the same unordered Keep-family multiset as the Target
Ideal, then only the earliest Normal per ordered family layout enters a Keep-only stream.
Both keys use gogmaBonusFamily's Master mapping authority; multiset equality ignores order,
while stream dedup preserves it. An incompatible offset zero still keeps its full stream
(SEARCH_SPEC 6.1.2). Reset-derived futures depend on no Normal initial slots; equivalent
Keep futures depend only on ordered families. A later equivalent Normal costs strictly
more for identical Bonus/Skill results. Never apply this pruning to constrained enumeration,
owned sources or blind creation. Preserve the first base's canonical frontier and the
lower-bound tie drain; never eagerly predict every Normal offset for classification.

The Issue #104 defaults were Normal 500 / Gogma 350 / Skill 1500. Issue #125 made the recommended
initial values Normal 350 / Gogma (復元ボーナス) 500 / Skill 1500 and the Search screen's starting
values the user's saved `AppSettings.candidateSearchDefaults`. See
`docs/ISSUE_104_NORMAL_ROUTE_REDUCTION_BENCHMARK.md` for the Browser measurements,
350/500 comparison and limits. B5 measurements/presets stay historical and unchanged.
No RNG algorithm/version, calculation version, persistence or Candidate shape changes.

### Candidate Search Notices and Observational Traces

A `CandidateSearchWarning` carries an explicit `severity` of `info` or
`warning`. `info` means the search succeeded under a narrower method than usual
— the forced Reset Normal Artian route of SEARCH_SPEC 6.1.1 standing in for the
predicted variant is the v1 case — and is neither an error nor a degraded
result. `warning` keeps its existing meaning: a capability gap, an excluded
prediction, or a Target definition the search had to skip. Never downgrade an
existing warning to `info` just because some fallback succeeded, and never emit
a notice without an explicit severity. The Search UI renders the two groups as
separate Alerts headed お知らせ and 警告.

The normal UI never shows an internal reason enum such as
`normal_counter_unconfirmed`, or raw English Domain terms, inside a notice. A
reason only selects which sentence the Domain composes. The forced Reset notice
must distinguish its two causes, because a Normal Artian Counter can be
confirmed while only Normal Artian prediction is unavailable: saying "the
Counter is unconfirmed" in that case is simply false.

`BuildCandidate.skillAmendmentTrace` is the Skill counterpart of
`bonusAmendmentTrace` and follows the same observational contract. It records
the predicted Series / Group Skills of each `reset_skills`, bound by
`operationIndex` inside the finished `BuildRoute.operations` so consecutive
Reset Skills never shift by one. It is optional, so Candidates persisted before
it existed stay valid and are never staled or migrated for its absence. A
Search-generated Candidate with no Reset Skills records `[]`; `undefined` means
a pre-field Candidate, and the UI displays nothing for either.

The trace never participates in Candidate semantic identity, the Candidate ID
`semanticHash`, `candidateStableKey`, the deduplication key, `searchStateHash`,
`referencedOwnedWeaponsHash`, the `BuildCandidateMeaning` fingerprint,
retention, ordering, dominance, Ideal/Practical classification, staleness, or
Planner route identity. `candidate.seriesSkillId` / `candidate.groupSkillId`
remain the authority for the Route's final Skills; the trace only explains how
it got there. A count mismatch between the Route's `reset_skills` operations
and the predicted results is an internal inconsistency and fails loudly — never
truncate to the shorter side and never repeat the final Skills on every step.

The values come from the existing Skill stream's memoized predictions, so the
trace adds no `predictSkills` call. UI, presentation, and CandidateCard code
must not call `predictSkills()` or re-run any RNG to render it. The trace is
RouteKind-independent: any Candidate containing `reset_skills` gets one, and
`ConstrainedCandidate` carries no observational trace at all.

The initial Skill assignment of `convert_normal_to_gogma` stays out of
`skillAmendmentTrace` and is recorded separately as
`BuildCandidate.conversionSkillTrace` (`docs/SEARCH_SPEC.md` 5.5.2.2). Do not
widen `skillAmendmentTrace.operationType` to cover conversion: the two are
separate observational contracts, and `skillAmendmentTrace` stays Reset Skills
only.

`conversionSkillTrace` is singular, because a Route carries at most one
`convert_normal_to_gogma` (SEARCH_SPEC 6.1 / 6.1.1 / 6.2). It is bound by
`operationIndex` found by scanning the finished `BuildRoute.operations`, never
by counting base operations by hand. It carries exactly the Skills the Skill
stream already predicted at the conversion's own Counter position, so it adds
no `predictSkills` call, and UI, presentation, and CandidateCard code must not
re-run any RNG to render it. It obeys the same observational rules as the two
amendment traces — no Candidate semantic identity, `semanticHash`,
`candidateStableKey`, deduplication key, `searchStateHash`,
`referencedOwnedWeaponsHash`, meaning fingerprint, retention, ordering,
dominance, Ideal/Practical classification, staleness, or Planner route identity
— and it is optional, so a Candidate persisted before it existed stays valid
and is never staled or migrated for its absence.

Unlike the amendment traces, it is never compared against the Candidate's own
Skills: a later `reset_skills` legitimately overwrites the conversion result,
and `candidate.seriesSkillId` / `candidate.groupSkillId` stay the authority for
the final Skills. Every conversion RouteKind gets one, including the 6.1.1
blind variant whose five forged slots are unknown while its conversion Skill is
predicted normally. A Route whose conversion count is not exactly one while a
conversion Skill was predicted is an internal inconsistency and fails loudly;
a pre-field Candidate carrying no record is legal and simply displays nothing,
with no extra legacy note of its own.

These are presentation and reporting concerns only. They change no Search
semantics, Planner semantics, RNG algorithm, or Dexie table shape. At the time,
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 5`, `DATABASE_SCHEMA_VERSION = 1`,
`AppSettings.schemaVersion = 1`, and `PRODUCTION_RNG_ENGINE_VERSION =
production-rng:c5-e2` were all unchanged.
The later Target compromise revision uses calculation version 6 and DB version 2.

### Normal Artian Route

Route kind:

```text
normal_artian_to_gogma
```

This RouteKind has two variants, discriminated only by whether
`CreateNormalArtianOperation` carries absolute Normal Counter positions. No new
RouteKind and no new persisted discriminant field is added, and every
previously persisted `create_normal_artian` operation stays a predicted one
with its exact original meaning.

v1 searches only rarity-8 normal Artian weapons. If the required weapon-type
rarity-8 Normal Artian counter is unknown, the predicted variant below is
skipped — but the forced Reset variant may still run, so the RouteKind as a
whole is not necessarily skipped.

NormalArtianCounter is the 0-based block index of the result produced by the
next forge. Keep candidate position and forge count distinct:

```text
candidateOffset = 0:
  candidateCounter = normalCounterBefore
  forgeCount = 1

candidateOffset = k:
  candidateCounter = normalCounterBefore + k
  forgeCount = k + 1

CreateNormalArtianOperation.count = forgeCount
normalCounterAfter = normalCounterBefore + forgeCount
candidateCounter = normalCounterBefore + forgeCount - 1
```

Forge `forgeCount` normal weapons and convert only the selected final weapon.
Earlier forged weapons consume only the Normal stream. Immediately after
conversion, cumulative advancement is Normal `+forgeCount`, Skill +1, and
Gogma +0.

`maxNormalAdvance` retains the existing Search setting and UI meaning:
maximum forge count, with a minimum of 1. It is not the maximum 0-based offset.
Search candidate offsets `0 ... maxNormalAdvance - 1`.

The conversion operation:

- Preserves the selected normal weapon's five bonus slots in order with
  `normal_artian` scope
- Predicts and assigns the initial Series and Group Skills
- Advances Skill Counter by one and leaves Gogma Counter unchanged

The operation sequence may contain:

- `create_normal_artian`
- `convert_normal_to_gogma`
- `reset_bonuses`
- `keep_bonuses`
- `reset_skills`

While the transient Gogma still has `normal_artian` scope, the game allows
either `reset_bonuses` or `keep_bonuses` as its first bonus operation, and the
predicted variant knows the forged five slots, so Search emits both
`reset_bonuses` and `keep_bonuses` there. Either result produces five
`gogma_artian` scope slots, after which `reset_bonuses` or `keep_bonuses` may
occur in the same route.

#### Forced Reset variant (unconfirmed Normal Counter)

`docs/SEARCH_SPEC.md` 6.1.1 is the authority. Reset Bonuses never reads the
five slots it replaces, so a Route that never reads the forged weapon's slots
needs neither a confirmed Normal Artian Counter nor Normal Artian prediction.

It is searched only when the predicted variant above cannot run — an
unconfirmed Counter, a missing Base Seed, a missing Normal prediction
capability, or an unsupported Normal input. It additionally requires a
confirmed Base Seed, Skill Counter, and Gogma Counter, Skill prediction
support, and Reset Bonuses prediction support.

The operation sequence is exactly:

```text
create_normal_artian   count = 1, normalCounterBefore = normalCounterAfter = null
convert_normal_to_gogma
reset_bonuses          mandatory first bonus amendment
[reset_bonuses | keep_bonuses]*
[reset_skills]*
```

- Never forge more than one Normal Artian. Extra forges cannot change the
  result and only add operations, materials, and Normal Counter progression
- Never substitute a fabricated Normal Counter value. `null` means this Route's
  Candidate result does not depend on any absolute Normal Counter position. It
  does not mean the Counter is necessarily unknown, and it does not mean the
  Counter fails to advance when the Plan runs — the forge is real either way.
  A confirmed Normal Counter is the ordinary case here: a Counter can be
  confirmed while only Normal Artian prediction is unavailable
- Never complete a Candidate right after the conversion, and never apply Keep
  Bonuses to the unknown five slots. This is an unknown-input problem, not a
  prediction-support one and not a game rule: a known normal-scope five-slot
  set may be Kept directly (5.9)
- There is no `gogmaAdvance = 0` Bonus solution. The Bonus axis starts at the
  first Reset; no fake bonus set enters the stream
- `estimatedNormalAdvance = null` means Candidate Search does not represent a
  Normal Counter advance as an absolute route dependency, never 0. It is a
  separate concept from the runtime advance below
- `searchStateHash` depends on Base Seed, Skill Counter, and Gogma Counter, and
  never on a Normal Artian Counter, so confirming or changing that Counter does
  not stale the Candidate. That is not a licence to leave the current Counter
  unadvanced when the Plan runs
- The RouteKind goes into `searchedRoutes`; the reason the predicted variant did
  not run is reported as a `CandidateSearchWarning`, not as a `skippedRoutes`
  entry for the same RouteKind
- Material costs are counted normally: one Normal Artian forge, one conversion,
  and each amendment
- The variant stays legal once Normal prediction is extended, because
  "forge one, Reset immediately" can still be the shorter Candidate

For this route:

```text
BuildRoute.sourceOwnedWeaponId = null
```

Reset Bonuses, Keep Bonuses, and Reset Skills performed on the transient
converted weapon use:

```text
sourceOwnedWeaponId = null
```

because the route output is not yet a persisted OwnedWeapon.

Do not invent an OwnedWeapon ID or add a route-output weapon reference type for
the just-created weapon. A null source is the explicit transient-Gogma contract,
not a fake route-local identity.

### Owned Normal Artian Route

Route kind:

```text
owned_normal_artian_to_gogma
```

The source must be an unprotected owned rarity-8 normal Artian weapon whose weapon type and element are compatible with the Target. Rarity 6 and 7 normal Artian weapons are out of scope and must not be registered or searched in v1.

The operation sequence must not contain `create_normal_artian`, and may
contain:

- `convert_normal_to_gogma`
- `reset_bonuses`
- `keep_bonuses`
- `reset_skills`

`BuildRoute.sourceOwnedWeaponId` is the source normal Artian weapon ID. At
conversion, consume that source, preserve its five slots and
`normal_artian` scope, assign the initial predicted Series and Group Skills,
advance Skill Counter by one, and leave Gogma Counter unchanged.

Reset Bonuses, Keep Bonuses, and Reset Skills performed after conversion use
`sourceOwnedWeaponId = null` because the converted route output is not yet
registered as a separate OwnedWeapon. Do not invent a replacement ID.

The first bonus amendment while the converted weapon has `normal_artian` scope
may be Reset Bonuses or Keep Bonuses: the source's five slots are known, so
Search emits both. Either produces `gogma_artian` scope, after which further
Reset Bonuses or Keep Bonuses may occur in the same route. Conversion itself does not map bonus types
or ranks and does not call Gogma-bonus prediction.

### Existing Gogma Reset Bonuses

Route kind:

```text
existing_gogma_reset_bonuses
```

The source must be unprotected.

Do not generate this destructive route from a protected weapon.

If the source has inherited `normal_artian` scope, this Reset changes the full
five-slot result to `gogma_artian` scope. It is the only bonus amendment v1 can
predict from that scope, but it is not the only amendment the game allows.

### Existing Gogma Keep Bonuses

Route kind:

```text
existing_gogma_keep_bonuses
```

The source must be unprotected.

The source may hold `normal_artian` or `gogma_artian` scope slots: an owned
Gogma's five slots are always known, and Keep resolves each slot's family from
its bonus type alone (Normal-side types through the Master mapping). A Keep from
normal scope produces `gogma_artian` scope. Keep has no slot selection and
creates no same-counter selection branches. The current ordered
five slots are an explicit RNG Engine input; the family at each slot remains in
that position while the tier is rerolled, and the complete final result comes
from the Engine.

Search may explore Keep depth 1, Keep depth 2, and later results over time. It
must not synthesize the tier result or branch on user-selected slots.

If Keep prediction is unsupported, do not generate production Keep routes.

### Existing Gogma Reset Skills

Route kind:

```text
existing_gogma_reset_skills
```

This route:

- Uses an existing OwnedWeapon
- Keeps the source weapon's restoration bonus set and scope unchanged
- Changes only predicted series/group skills
- Advances only Skill RNG as defined by the Engine
- Uses a non-null source OwnedWeapon ID
- Requires an unprotected Gogma source

It does not require Gogma prediction or Keep prediction.

Its `referencedOwnedWeaponsHash` must include the source weapon.

### Existing Gogma Mixed

Route kind:

```text
existing_gogma_mixed
```

The source must be unprotected for every mixed Bonus / Skill amendment route.

A mixed route whose source still has `normal_artian` scope may start with
either Reset Bonuses or Keep Bonuses; its five slots are known, so Keep is
predicted directly.

A Reset-Skills-only route must use `existing_gogma_reset_skills`, not Mixed.

---

## Concrete Route Operations

A `BuildRoute` must store its real ordered `RouteOperation[]`.

Do not reconstruct operations later from only endpoint counters or route kind.

Planner and execution navigation must use the concrete operation sequence.

This is required for:

- Correct shared RNG simulation
- Correct inventory simulation
- Correct PlanStep creation
- Correct invalidation behavior
- Correct user instructions

`convert_normal_to_gogma` is one operation that contains the initial Skill
assignment. Do not split it into a synthetic assign-skills operation. Its
expected result contains the inherited ordered normal-scope bonuses and the
predicted Series and Group Skills. Its `RngAdvance` is Normal 0, Skill +1,
Gogma 0.

---

## Planner Rules

The Planner operates globally across multiple targets.

Do not optimize each Target in isolation.

The Planner accounts for:

- Shared Gogma RNG progression
- Shared Skill RNG progression
- One rarity-8 Normal Artian counter per weapon type
- Owned normal Artian and owned Gogma Artian inventory as hard constraints
- Protected/unprotected state
- Target priority
- Practical versus Ideal satisfaction
- Weapon consumption
- Operation count
- Conflicts

The goal set of one Planner run is its **planning Targets** (`docs/PLANNER_SPEC.md`
4.1): the unique planning-eligible Targets of `validatePlannerInput().validBuildListEntries`,
derived once by `derivePlannerPlanningTargets()` in `createInitialPlannerSearchState()` and
held by `preparePlannerInitialContext()` as `planningTargets` / `planningTargetIds` /
`planningTargetsById`. Completion, typed termination (`completedTargetCount` /
`totalTargetCount`), TargetSatisfaction tracking, scoring, conflict detection,
`all_targets_already_satisfied`, constrained re-search, what-if and the augmented preflight
all read that one set. An active Target with no valid BuildListEntry is never a goal of the
run, is never counted, and is never substituted: zero valid Entries means zero planning
Targets, `no_build_list_entries`, no Beam Search, and an `exhausted` 0 / 0 termination. Never
derive it from the raw `buildListEntries`, and never narrow `PlannerInput.targetWeapons`,
`PlanningInputSnapshot.targetWeaponsHash` or `createPlanningTargetWeaponsHash()` to it. The
`preferredOwnedWeaponId` collection validation stays over the whole `PlannerInput.targetWeapons`.

The Planner is a pure calculation module.

Do not mutate IndexedDB while searching for a plan.

Persist only after the calculation returns to the application/persistence layer.

`PlannerInput` contains structured-clone data only. It must not contain an
`RngEngine` instance or a duplicate `engineCapabilities` snapshot. A Planner
Worker creates its Engine, ID factory, and clock inside the Worker module and
injects them into the pure Planner calculation as runtime dependencies.

Planner calculation must not call `crypto.randomUUID()`, `new Date()`, or
`Date.now()` directly. Production adapters may wrap UUID and UTC time; tests use
deterministic ID and clock dependencies.

Planner must not rewrite a Candidate Snapshot's `BuildRoute.operations` or
replace the concrete source OwnedWeapon ID a Candidate Route saved. Planner-only
reservation is a separate PlanStep.

Target satisfaction is derived only from owned Gogma Artian weapons. Owned
normal Artian weapons are inventory/conversion resources and never satisfy a
Target. For Gogma weapons, do not use `status` alone: evaluate the actual
restoration bonus and series/group skill conditions with the Target evaluation
engine. `hasPractical`, `hasIdeal`, and their OwnedWeapon ID lists all follow
this rule.

Trace replay of conversion must preserve the five normal-scope slots, call
Skill prediction at the conversion position, advance Skill Counter by one, and
leave Gogma Counter unchanged. If the initial conversion Skill already meets
the Target, do not add Reset Skills; otherwise, search Reset Skills beginning
at the following Skill position.

Conversion operations conflict at the same Skill Counter position, not the
same Gogma Counter position. Only Reset Bonuses and Keep Bonuses consume and
conflict on Gogma positions.

Counter stream progression and physical action sharing are separate concepts.
A shared Counter position is not an exclusive resource. When a different Entry's
real operation moves the current Counter past a Route unit, that unit may be
treated as already passed — silent fast-forward — but only when executing it is
unnecessary to preserve the rest of its own Route.

The Planner-internal Route unit attribute is `canSkipWhenCounterPassed`. Derive
it from the saved Route semantics; never persist it in `RouteOperation`,
`BuildRoute`, `BuildCandidate`, `ProductionPlan`, or the DB schema. A unit is
skippable only when the immediately following Route operation rewrites its whole
semantic output without reading it, so neither the Candidate result nor any
displayed Step expected result changes:

- `reset_bonuses` followed by `reset_bonuses`: skippable, because Reset redraws
  all five slots from the Gogma position alone
- `keep_bonuses` followed by `reset_bonuses`: skippable for the same reason
- `keep_bonuses` followed by `keep_bonuses`: skippable, because Keep preserves
  each slot's family, so the next Keep reads the same families either way
- `reset_bonuses` followed by `keep_bonuses`: required, because that Keep reads
  the Reset's families
- `reset_skills` followed by `reset_skills`: skippable, because Reset Skills
  writes only the Series / Group Skill pair and predicts it positionally
- everything else is required, including a Route's final operation,
  `create_normal_artian`, `convert_normal_to_gogma`, `reserve_weapon`, and any
  concrete inventory mutation

A Route's last unit is never skippable, so a whole Route is never
fast-forwarded and the Candidate-forming operation always runs.

A skippable unit is therefore not interchangeable with a required unit that
occupies the same Counter position. Running the required one first lets the
skippable one fast-forward, while running the skippable one first pushes the
Counter past the required unit and kills that Route with
`counter_before_current`. So whenever a Counter position carries a required unit
that can actually run in the current state, never expand a skippable unit that
would consume that position first. This is execution eligibility - a semantic
pruning of the successor set - not a score adjustment: a score alone leaves the
invalid branch alive at the mercy of `beamWidth` and tie-breaks. Decide
executability with the same authority ordinary expansion uses (source version,
counter precondition, inventory and protection, conflict-resolution blocking),
apply it only within one stream and Counter position, leave the case where the
two are one shareable physical action to the PR #4 sharing contract, and record
no rejection for the branch that was never generated. Positions where every
competing unit is skippable keep both orders available.

A fast-forward is not a shared physical action. It creates no
`PlannerSearchAction`, no trace entry, no `progressedBuildListEntryIds` or
`PlanStep.progressedTargetWeaponIds` record, no inventory effect, no expected
result, no route runtime output, and no source mutation version change. It
advances Route progress only. Never copy an unexecuted Reset / Keep result into
`routeRuntimeByEntryId`; if a later unit would need semantic state the skipped
unit produced, that unit is not skippable.

`current > unit.counterBefore` is therefore no longer a blanket rejection:

```text
past + skippable  -> advance Route progress silently
past + required   -> counter_before_current / inventory_precondition fail closed
```

Silent fast-forward exists only in the Beam Search trace's absence, so Trace
Replay must not regenerate a skipped operation. Keep the existing design where
the Beam Search trace alone determines the Replay state, and never introduce a
semantic difference between Beam Search and Replay.

In the Beam Search oracle, among Plans the existing evaluation already rates equally,
prefer first the one whose Routes start from their Targets' preferred owned weapons
(the removed Production preference, `docs/PLANNER_SPEC.md` 7.4), and then the one that
makes the player swap the weapon in hand fewer times. The Production scheduler applies
the weapon switch preference as its canonical ordering key 3, below Target priority and
the improvement preference, and never reads the preferred source. This is Plan quality, not
correctness, and it sits below correctness, feasibility, Target satisfaction,
and every existing `evaluationScore` term, and above the semantic and trace
stable tie-breaks. Never fold it into `evaluationScore` as a large weight, and
never let it beat a cheaper Plan: one switch with 200 operations must not win
over two switches with 100.

The metric counts only `reset_bonuses`, `keep_bonuses`, and `reset_skills`,
because each selects one Gogma weapon and operates on it in place.
`create_normal_artian` and `convert_normal_to_gogma` have no such continuously
operated subject and stay out of the metric in v1; do
not widen that definition without a specification change. The weapon subject is
the concrete `OwnedWeapon` when the operation has one, and the Entry-local
transient Gogma of PR #4 when it does not, so the same OwnedWeapon is one
subject across BuildListEntries while two Entries' transient weapons are two.
Never reuse `physicalActionKey` as that subject identity: it also carries the
operation type and its Counter before / after, so it changes on every action
even while one weapon stays selected.

`reserve_weapon` is a Planner-only action and a silent fast-forward is not a
physical operation, so neither counts a switch nor becomes the new previous
subject - a reserve between two operations on one weapon must not read as
leaving and returning to it. One shared physical action that progresses several
Entries is judged once.

`PlannerSearchState` keeps `weaponSwitchCount` and
`lastWeaponOperationSubjectKey` as incremental Planner runtime state, starting
at 0 and null. Never recompute the metric by scanning the whole trace on every
state comparison, and never persist either field in `RouteOperation`,
`BuildRoute`, `BuildCandidate`, `ProductionPlan`, `PlanStep`, or the DB schema.
They stay out of `createPlannerSearchStateSemanticKey()`, because both are pure
functions of the trace projection that key already carries.

This is a Beam Search ranking preference, never a semantic pruning like the
required / skippable execution eligibility: a branch with more switches is a
correct Plan, so it is never rejected, never recorded as a rejection, and never
turned into a conflict. It changes no physical action sharing, silent
fast-forward, conflict, or Trace Replay semantics, and no calculation version -
a switch count alone never invalidates an existing ProductionPlan, so this change
did not move `CURRENT_CALCULATION_APP_SCHEMA_VERSION` on its own. (The separate
version 5 boundary above does invalidate every version 4 Plan, for its own
reason.) Bounded Beam Search does not guarantee the absolute minimum switch
count.

Resolving Counter conflicts across Targets is the Planner's job, not something
Candidate Search pre-computes. Planner-driven constrained re-search is not
implemented yet, but the contract for it is fixed: never restart a re-search at
`conflictingCounter + 1`, because a usable Practical may sit before the conflict;
re-evaluate from the original Search/RNG origin under the fixed Candidate and
conflict context instead. Never exclude a Candidate merely because it touches an
occupied Counter position — the existing counter precondition, action identity,
and shareable operation rules decide whether it can run alongside the fixed
Candidate. Candidate Search must not duplicate that Planner logic; it offers
Candidates in order while the Planner side judges coexistence.

Every pruning the initial search applies — smallest-advance retention per
identical result, Practical dominance, the Practical retention horizon, stopping
at the canonical Ideal, and the Cross-only policy — exists to keep that
single-Target search fast and simple. None of them is a Domain dominance that
disqualifies a Candidate permanently. A constrained re-search must be able to
re-evaluate anything they omitted, judged by whether it can coexist with the
fixed Candidates. In particular, never carry the initial Practical dominance into
the re-search, where a currently unusable dominant candidate would permanently
hide a usable dominated one. Reaching those Candidates again does not require
reviving the Cartesian product — the streams stay independent and the Cross-only
initial policy stands.

---

## Planner-driven Constrained Re-search

B8-A fixed the formal contract in `docs/PLANNER_SPEC.md` 9.2 and
`docs/SEARCH_SPEC.md` 5.6.7. `docs/CANDIDATE_SEARCH_REDESIGN.md` 4.2 is the
design record, not specification authority. B8-A changed specification documents
only: no `src/**`, test, build, or DB schema change. The implementation phases
are B8-B1 (Search-domain constrained enumerator), B8-B2 (enumerator Browser
Worker benchmark and enumeration-bounds defaults), B8-C (Planner orchestration),
B8-D (Worker / Application / Persistence), and B8-E (orchestration benchmark and
orchestration-bounds defaults). B9 what-if and B10 conflict UI stay
separate phases; the B11 normal-scope Keep phase was delivered by the
normal-scope Keep correction.

The pipeline is fixed:

```text
constrained candidate enumerator  (Target-local, from the original Search/RNG origin)
  -> yields ConstrainedCandidate (transient Search-domain semantic result)
  -> Planner constrained-search orchestration
  -> deterministic materializer -> BuildCandidate shape
  -> temporary BuildListEntry materialization
  -> augmented PlannerInput
  -> initial conflict preflight (same validation authority as the ordinary Planner)
  -> full Beam Search rerun from createInitialPlannerSearchState
  -> ProductionPlan
  -> Application/Persistence atomic save
```

The "original Search/RNG origin" is the current validated Search/RNG snapshot
taken when the Planner calculation starts — never a past UI Candidate Search
request. A `CandidateSearchInput` carries `searchRunId`, `routeFilter`,
and `settings`, is never persisted, and cannot be reconstructed
from a BuildListEntry, which keeps only `searchStateHash` and
`referencedOwnedWeaponsHash`. So the enumerator takes a dedicated
`ConstrainedSearchOrigin` holding `rngState`, `normalCounters`, `ownedWeapons`,
`targetWeapons`, `master`, and `calculationContext`, with no run id and no UI
filter.

Constrained re-search inherits none of the transient UI filters: the route scope
is every currently legal Search route, and `ConstrainedEnumerationBounds` is the
only authority for search extent — never `CandidateSearchSettings`. Widening the
route policy does not widen what is yielded: only Candidates satisfying the
Target's **Ideal** condition are yielded. A compromise result would become a
Planner-generated Practical BuildListEntry, which the checkpoint model forbids.
The ordinary Candidate Search `routeFilter` contract is unchanged; these are
separate boundaries.

The deterministic constrained search identity is fixed by composition, not only
by name: derive it from the TargetWeapon ID, the Planner-start Search/RNG
semantic origin, the `CalculationContext`, the `ConstrainedEnumerationBounds`,
and the route policy. Never fold in a random UUID, the Clock, a request UUID, or
an enumeration ordinal, and never introduce a `searchRunId`-like run identifier
there.

The enumerator does not yield `BuildCandidate`. A `BuildCandidate` requires `id`,
`searchRunId`, and `createdAt`, and the ordinary candidate factory fills them from
`CandidateSearchInput.searchRunId` — which a `ConstrainedSearchOrigin` does not
carry. B8-B1 therefore yields a transient Search-domain semantic result
(`ConstrainedCandidate`: target, final bonuses and scope, skills, route, the
estimate and material fields, `idealDifference`, the two hashes, and
`calculationContext`). Never mix `BuildCandidate.id`, `searchRunId`, `createdAt`,
a random or request ID, the Clock, or an enumeration ordinal into that result.
B8-C's deterministic materializer is what converts it to `BuildCandidate` shape:
`searchRunId` becomes the deterministic constrained search identity, `id` is
derived stably from that identity plus the Candidate semantic meaning, `createdAt`
comes from `PlannerClock`, and `intermediateStateGroups` comes from applying
intermediate state extraction to that Candidate. `CandidateSearchSettings` is neither the filter
authority nor the extent authority for constrained enumeration. The ordinary
Candidate Search `searchRunId` contract and `BuildCandidate` ID generation rule are
unchanged; "do not change the `BuildCandidate` ID generation rule" means for
ordinary Candidate Search, and does not conflict with the constrained
materializer's own contract.

Never inject a constrained Candidate into a mid-Beam Search state.
`routeProgressByEntryId`, current counters, transient route output,
`sourceMutationVersionByOwnedWeaponId`, `candidateReadySourceVersionByEntryId`,
`routeSourceVersionByEntryId`, and `inFlightExistingSourceByOwnedWeaponId` have
already advanced there, so a late Entry cannot reconstruct the shared physical
actions. Rerun from the initial state whenever the Entry set changes, bounded by
`maxPlannerReruns`.

Coexistence is decided only by rerunning the existing Planner over the augmented
input — `createPlannerRouteUnitPlans`, counter precondition, `physicalActionKey`,
`arePlannerRouteUnitsShareable`, inventory precondition, protection, source
mutation/version, `PlannerConflictResolution`, Beam Search, and Trace Replay.
Never add a B8-only shortcut such as `usedCounters.has(counter)`, and never
duplicate that Planner logic inside Candidate Search.

The only authority for which Candidate is held fixed is
`PlannerConflictResolution.selectedBuildListEntryId`. Never use
`PlanConflict.recommendedBuildListEntryId`, a participant that a Planner
bestState happened to pick, Target priority, or Candidate score. A conflict with
no valid explicit resolution is returned as a `PlanConflict` instead of
triggering an automatic re-search.

`PlanConflict.id` folds in the sorted participant BuildListEntry IDs, so adding a
generated Entry changes the id of the very same physical conflict. Never carry
the original `conflictKey` into the next rerun — it would no longer match and
would be discarded as `invalid_conflict_resolution`. Instead hold the user's
choice as a transient fixed constraint (fixed BuildListEntry ID, Target ID,
Candidate semantic fingerprint, and the conflict-resource identity), and after
each rerun rebuild the `PlannerConflictResolution` against the newly detected
`PlanConflict.id` — but only when exactly one detected conflict both matches the
conflict-resource identity and lists the fixed Entry among its participants. Zero
matches or several matches means the mapping is unknown: never guess it; drop
that Candidate trial or return the conflict for reselection. The conflict-resource
identity is ConflictKind plus the kind-specific position only, never the
participant Entry set — including the participants would guarantee a mismatch. For
`same_owned_weapon_consumed`, the conflict context DTO carries the exclusively
consumed OwnedWeapon ID as its own field; never substitute a participant's
`sourceOwnedWeaponId`, which need not be the consumed weapon and differs per
participant. None of this changes the `PlanConflict.id` generation rule, the
`PlannerConflictResolution` type, or how Beam Search applies a resolution.

Do that re-mapping in an initial conflict preflight *before* the full Beam
Search, never after it. Running a full Beam Search without the resolution and
then rebuilding one from its output is circular: the first run does not reflect
the user's fixed choice, and it forces at least two full searches per trial. The
fixed order is: build the augmented PlannerInput with the temporary generated
Entry, preflight with the existing Planner authority only
(`createInitialPlannerSearchState`, `createPlannerRouteUnitPlans`,
`detectPlannerConflicts`), re-map the transient fixed constraint onto the
conflicts that preflight found, build the `PlannerConflictResolution` against the
current `PlanConflict.id`, then rerun Beam Search from the initial state with
that resolution, and treat that rerun plus Trace Replay as the final coexistence
authority. Preflight adds no B8-only conflict logic such as `usedCounters`, and
it decides nothing about Candidate adoption or coexistence on its own.
`maxPlannerReruns` counts full Beam Search executions only; preflight never
counts against it.

Preflight uses exactly the validation authority the ordinary Beam Search uses —
never raw `BuildListEntry`. `createInitialPlannerSearchState()` takes
`ValidatedBuildListEntry[]`, and the ordinary search feeds it only the
`validBuildListEntries` that `validatePlannerInput()` returned, so a preflight
built on raw Entries would diverge on staleness, capability, prediction support,
protection, and CalculationContext compatibility. The order is: build the
augmented input, strip the stale old `conflictKey` resolutions from the preflight
input (they no longer match and would raise a false
`invalid_conflict_resolution`), run `validatePlannerInput`, take
`validation.validBuildListEntries`, call `createInitialPlannerSearchState`, apply
the same initial relevant-entry selection the ordinary Planner applies, then
`createPlannerRouteUnitPlans` and `detectPlannerConflicts`. If validation excludes
the generated Entry or a fixed Entry, fail closed and drop that Candidate trial.
Do not reimplement this path in B8-C and let it drift from the ordinary Planner:
extract the current `runPlannerBeamSearch` initial conflict detection path into a
shared pure helper that both the ordinary Planner and the B8 preflight call. The
helper's naming is a B8-C decision, but validation, `validBuildListEntries`,
initial state, entry relevance, route unit plans, and conflict detection must not
be implemented twice.

Re-map every explicit conflict resolution, not just the one whose conflict
triggered the re-search. A `PlannerInput` can carry several
`PlannerConflictResolution`s, and adding a generated Entry can change the
`PlanConflict.id` of conflicts unrelated to this trial too. Take every valid
resolution from the original validated input, build a transient fixed constraint
per resolution (fixed BuildListEntry ID, fixed Target ID, Candidate semantic
fingerprint, conflict-resource identity), run the augmented preflight, and re-map
all of them. Rebuild the `PlannerConflictResolution[]` against the current
`PlanConflict.id`s only when every constraint mapped uniquely. Never silently drop
another user-specified resolution by rebuilding only the one you were working on,
and never run Beam Search on a partially rebuilt array. For each constraint: one
match rebuilds against the current `conflictKey`; zero matches, several matches, a
fingerprint mismatch, or a fixed Entry excluded by validation all mean do not
guess — drop that Candidate trial and fail closed, or return the conflict for
reselection. Never synthesize a substitute fixed Entry from
`recommendedBuildListEntryId` or a bestState participant.

BuildListEntry now has two producers: the user selecting a search result, and
Planner constrained re-search materializing one. A Planner-generated Entry uses
the ordinary `BuildListEntry` shape — no new persisted provenance field, no
Candidate Snapshot embedded in `ProductionPlan`, and no new persisted entity.
Candidates found during enumeration are temporary Planner trial input; only the
Entries adopted into the final augmented PlannerInput are returned as
`generatedBuildListEntries` and persisted. No plan means no persisted Entry; a
partial plan with `plan != null` whose snapshot covers generated Entries
persists them with it, in one Dexie transaction, with current state re-read and
re-validated first. A plan-only or Entry-only save is forbidden.

Generated Entry identity must be deterministic: derive the ID from the Candidate
semantic meaning, `targetDefinitionHash`, `searchStateHash`,
`referencedOwnedWeaponsHash`, and `CalculationContext`. Never use a random UUID,
the Clock, an enumeration ordinal, or a request UUID for an Entry ID or a
semantic tie-break; `createdAt` stays display-only. The Candidate semantic
identity must include restoration bonus scope — the current
`createBuildCandidateMeaningFingerprint()` omits it, so fix or unify that
authority in B8 rather than trusting it. Reuse an existing Entry only when every
current semantic content matches, including `targetDefinitionHash`,
`searchStateHash`, `referencedOwnedWeaponsHash`, `CalculationContext`, and
current staleness; an ID match with different content fails closed. Never
overwrite a stale Entry — keep it as history and create a new Entry, because
older ProductionPlans reference its ID and Snapshot. (Under the next Build List
cardinality contract, `docs/DATA_MODEL.md` 9.4.1, an ID is still never
overwritten with different content, but the adopted generated Entry replaces
the Target's original Entry instead of sitting beside it; see
`docs/PLANNER_SPEC.md` 9.2.18.)

The constrained enumerator is a separate Search-domain API from
`searchCandidates()`, and it never receives the Planner conflict DTO. It must
not reuse `TargetSearchScheduler`, whose same-result retention, Cross-only
policy, canonical-Ideal stop, and initial horizon/retention are initial-Search
policy. It must be able to enumerate later same-result solutions, must not apply
Practical dominance, the canonical-Ideal termination, or the initial Practical
horizon, must yield only Candidates satisfying the Target's Ideal or Practical
condition, and must be deterministic, finitely bounded, cancellable, and
Worker-yieldable. Off-axis Cross pairs (`i > 0` and `j > 0`) may be evaluated
lazily for the Target and conflict that actually need them, capped by
`maxOffAxisPairEvaluations`; never pre-generate the full Cartesian product,
never break ties on a run-dependent value, and keep the B2 family-layout
frontier dedup and the blind-base first-Keep exclusion unchanged.

The Planner consumes the enumerator's streaming API, taking one Candidate at a
time and stopping at the first adoptable trial, so a final array sort never runs
on the Production path. Every ordering rule that must reach Candidate adoption
therefore belongs in the lattice traversal priority itself, not only in the
collected result's sort. The Target's preferred source is one such rule
(`docs/SEARCH_SPEC.md` 8.1): it sits after every Candidate quality and cost
comparison and immediately before the stable semantic key. It is safe there
because it is a property of the Route base, constant across one matrix's cells,
so parent and child always tie on it and the lazy lattice's coordinate-wise
monotonicity is untouched.

Bounds are split by responsibility and never crossed. Enumeration bounds —
`maxNormalForgeCount`, `maxGogmaAdvance`, `maxSkillResetCount`, and
`maxOffAxisPairEvaluations` — belong to the constrained enumerator. Orchestration
bounds — `maxCandidateTrialsPerConflict`, `maxGeneratedBuildListEntries`, and
`maxPlannerReruns` — belong to Planner orchestration and must never appear in
`ConstrainedCandidateSearchInput`. Neither set has a Production default yet, and
they are decided at different times: B8-B1 takes caller-supplied enumeration
bounds and B8-B2 sets their defaults from an enumerator Browser Worker
benchmark, while B8-C and B8-D keep orchestration bounds caller-supplied because
the cost of one Planner rerun cannot be measured before that orchestration
exists, and B8-E sets their defaults from a separate Browser/Planner benchmark.
Do not adopt unjustified numbers, and do not let B8-B2 decide orchestration
defaults. Reaching either kind of bound is reported as a stop, never as
exhaustion.

B8 historically changed none of the then-current
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2`,
`DATABASE_SCHEMA_VERSION = 1`, `AppSettings.schemaVersion = 1`,
or `PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`, and it changes no Production RNG semantics,
RouteOperation meaning, ProductionPlan persisted shape, PlanStep meaning, or
existing BuildListEntry shape. If an implementation phase finds it must break
one of these, stop and report instead of changing a version.

The later physical-action sharing and shared-Counter prefix fast-forward
corrections supersede only that historical calculation-version statement: the
current version and the version 2 / version 3 artifact compatibility rules are
defined in the Calculation Context section above.

---

## Planner Search Strategy

The Production Planner is **Route commitment plus the deterministic scheduler**
(`runPlannerDeterministicSchedule()`, Issue #103 Phase C;
`docs/ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md`, `docs/REQUIREMENTS.md` 19 / 20,
`docs/PLANNER_SPEC.md` 7):

- The persisted Build List holds one Entry per Target, so the Planner schedules the
  Route the user adopted instead of choosing among several Routes of one Target
- Route commitment decides which Routes the run executes: an explicit
  `PlannerConflictResolution` selects its Entry; an unresolved collision gets a
  provisional outcome (the best Entry by the shared ranking - Target priority, next
  Candidate distance, operation count, Entry ID - is committed, the other Entries are
  not run, and the conflict is returned with `selectedBuildListEntryId = null`). A
  Target left out that way does not complete: `termination.status = 'exhausted'` with
  `plan != null`, saved as an ordinary Draft
- The scheduler drives one `PlannerSearchState`, applying exactly one safe action at a
  time in the canonical order (Target priority, improvement preference violation,
  weapon switch, next-holding distance, remaining pending units, stable stream /
  Counter / Entry order). It never explores A -> B and B -> A both; a deadlock / stall
  drops the lowest-ranked committed Entry
- `TargetWeapon.preferredOwnedWeaponId` is not a scheduler input (no Route commitment,
  canonical ordering or ranking); it stays the Candidate Search and constrained
  enumeration tie-break, part of the planning-input hash and the Execution link semantics
- Every state transition goes through the shared authority (`plannerStateTransitions.ts`),
  and every scheduler trace goes through Trace Replay and the unchanged projection
- `createProductionPlanWithObserver()` is the only Production entry and fixes the
  scheduler; the ordinary Planner, B8, B9, B10, the replan Preview and the
  runtime-unsupported retry share it. Never add a Production strategy flag

The bounded Beam Search below (`runPlannerBeamSearch()`) was the Production Planner up
to Phase B. It stays, unchanged, as a regression oracle only - reached only by a direct
call over its own `PlannerBeamSearchInput` (Issue #103 Phase D-2a) from tests and the
Beam / scheduler parity harness, which stay in CI - together with its semantic key,
`comparePlannerSearchStates()`, `evaluationScore` and `preferredSourceProgressCount`.
The Issue #103 instrumentation Browser harness and the PR #107 instrumentation were
removed after the redesign was validated (Phase D-2b). The rest of this section describes that oracle where it speaks of beams,
branches, scores or pruning; its state transition, sharing, fast-forward, checkpoint,
conflict, Trace Replay and termination contracts are the shared ones the scheduler uses.

Default constant:

```text
maxPlanSteps = 1000
```

This one positive integer is the complete v1 Production `PlannerOptions` shape
(Issue #103 Phase D-2a): the Production scheduler's one execution bound, 1000 by
default since Phase D-1. `beamWidth` and `maxExpandedStates` are not Production
options at all: they exist only in the Beam Search oracle's
`PlannerBeamSearchOptions` (`defaultPlannerBeamSearchOptions` = 1000 / 50 / 10000,
validated by `validatePlannerBeamSearchOptions()`), which no Production module imports,
and `max_expanded_states` never comes from the scheduler (the oracle reports it in
its typed termination only; no warning kind exists for it since Phase D-2b). Never reintroduce either field into `PlannerOptions`, a Production Worker
request or the UI, and never turn `maxExpandedStates` back into a Production bound.
`preferPracticalBeforeIdeal` belongs to a legacy Planner contract and is
unsupported: the Planner has no Practical-first priority, and an input carrying
that option is refused as a validation issue rather than accepted or ignored.

They are defaults, not fixed constants: the Build List detail settings let the
user change `maxPlanSteps` (「最大計画ステップ数」, the only field there) for one
calculation. `defaultPlannerOptions` is the only
initial-value authority, the Application caller writes the reviewed values into
`PlannerInput.options`, and `PlannerInput.options` stays the single Planner bound
authority — no Worker Client, Worker controller, or Domain module substitutes a
default of its own. Only positive integers reach the Planner: `NaN`, `0`, a
negative number, a fraction, and an empty field are refused in the UI. No guessed
upper cap is added; a long run stays cancellable through the existing Worker
cancellation. The setting is Build List runtime UI state and is not persisted to
`AppSettings` or IndexedDB. It is not the B8 orchestration bounds,
`ConstrainedEnumerationBounds`, or `PlannerWhatIfBounds`, and none of those is
exposed in this detail settings panel. `beamWidth` and `maxExpandedStates` exist
only in the Beam oracle's `PlannerBeamSearchOptions`, used by tests and the parity
harness; no page exposes them (the Issue #103 benchmark page was removed in Phase D-2b).

A running Production Planner (Build List, replan Preview, B10 recalculation,
what-if) is shown as indeterminate with Cancel. The Production Planner Worker sends no
progress at all (no `progress` response, no `PlannerProgress`, no Client `onProgress`,
Phase D-2a), and no estimated total Step count is shown, because physical sharing,
silent fast-forward, dynamic release / recommit and deadlock / stall drops leave no
single authority for it (`docs/UI_FLOW.md` 10.0). Cancellation never depends on a
progress message.

### Typed Search Termination

How a full Planner run ended is typed data, never a parsed warning message.
`PlannerRunTermination` (Issue #103 Phase D-2a; the Beam oracle has its own
`PlannerBeamSearchTermination` of the same shape) carries `status`, `reachedLimits`,
the `limits` the run actually used, `expandedStates`, `completedTargetCount`, and
`totalTargetCount`, and it reaches UI, Application, and Persistence through
`PlannerRunResult.termination` and `PlannerResult.termination`. A Production
`reachedLimits` can only be `max_plan_steps`.

Status precedence is `cancelled`, then `completed` (every enabled Target reached
Ideal), then `incomplete` (a `PlannerOptions` bound truncated the search first),
then `exhausted` (the search ended on its own without completing every Target).

`max_steps_reached` stays a diagnostic (the Beam-only `max_expanded_states_reached`
was removed in Issue #103 Phase D-2b). It does
not contradict the status and are never its source: a `completed` search can
carry a reached bound, because the last affordable expansion may be the one that
completed it, and a run that never reached its Beam Search carries none.

An `incomplete` result's `plan` stays populated in the Domain: `bestPartial` is
still Beam Search diagnostics, and B8 `isConstrainedTrialAdoptable()` may still
adopt a trial from a partial Plan. That internal contract is unchanged. What
changes is outside the Domain: Persistence fails closed with
`planner_result_invalid`, no generated BuildListEntry is salvaged on its own,
the UI does not navigate to `/plans/{id}`, and the UI states which bound was
reached, the value it ran with, the expanded state count, the completed Target
count, and how to raise the bound. `exhausted` is not an incomplete search: it
keeps the existing "no Plan from this input" meaning and behaviour.

This changes no Beam Search expansion, scoring, conflict, Trace Replay, PlanStep,
or `ProductionPlan` persisted semantics: the same `PlannerInput` still produces the
same Plan contents. It is nevertheless a Calculation schema boundary, because a
version 4 runtime could persist a bound-truncated partial result as an ordinary
Draft and a persisted Plan records no termination, so
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` moved to 5 at that boundary and every version 4
ProductionPlan becomes `calculation_context_changed`.

The two fail-closed defences are separate and both stay in force: version 5 closes
old persisted artifacts, and `termination.status === 'incomplete'` closes newly
calculated results. Raising the schema version never removes the Persistence
termination check. The typed termination is runtime result metadata and is never
persisted in `ProductionPlan`, `PlanStep`, `BuildListEntry`, or the DB schema.
Calculation semantics and artifact validity are separate from the Dexie schema. At that boundary,
`DATABASE_SCHEMA_VERSION = 1`, `AppSettings.schemaVersion = 1`, and
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2` were unchanged.
The later Target compromise revision uses calculation version 6 and DB version 2.

The normal-scope Keep correction removed the `gogma_artian` rank I
`WeaponBonusDefinition` entries and moved Master `dataVersion` from 3 to 4, so
every earlier calculation becomes `calculation_context_changed` through
`masterDataVersion`. It widened the Production Keep input coverage (known
normal-scope slots, rank ignored) without changing any seed derivation, PRNG,
draw, weight, repeat penalty, or existing golden vector, so
`PRODUCTION_RNG_ENGINE_VERSION`, `CURRENT_CALCULATION_APP_SCHEMA_VERSION`,
`DATABASE_SCHEMA_VERSION`, and `ExportRoot.schemaVersion` were left unchanged.

Do not replace Beam Search with a simple Candidate sort.

Planner search state must distinguish target satisfaction:

```text
hasPractical
hasIdeal
```

Rules:

- Every BuildListEntry Candidate is an Ideal Candidate, so securing one sets
  `hasPractical = true` and `hasIdeal = true`
- `hasPractical` still describes what the inventory actually delivers and is
  judged from real performance, never from `status`
- A target whose inventory only meets a compromise condition stays in planning:
  the Planner's goal is its Ideal
- A target that already has Ideal is normally removed from further planning
- Practical-first progress is not a planning goal. `practicalFirstProgressTargetIds`
  and `CandidateScore.categoryScore` do not exist, and `hasPractical` is read by
  no Planner score, state evaluation, Beam pruning, or conflict recommendation:
  a Target holding nothing and a Target holding only a compromise weapon get the
  same priority. `CandidateScore.satisfactionScore` is `hasIdeal ? 0 : 50_000`,
  and the achieved term of a state counts Ideal Targets only

Planning priority:

1. Obtain Ideal weapons for uncovered targets, highest Target priority first
2. Exploit shared RNG progression to obtain useful results for other targets
3. Satisfy every selected compromise checkpoint as a hard constraint
4. Reduce weapon consumption and operation count among otherwise similar states

The Planner runs each Entry's Route as three lanes (`docs/PLANNER_SPEC.md`
7.0.4): base first, then the Bonus lane and the Skill lane interleaved freely,
each in its own Route order. `PlannerSearchState.routeProgressByEntryId` is a
per-lane progress. Across several Targets the Beam Search interleaves all
Entries' operations globally by Counter position; the Production Plan is one
physical operation sequence, never per-axis columns. When both stream lanes of
an Entry can run in a state, **both** become successors: a Skill-first and a
Bonus-first branch stay alive and scoring chooses. Never prune the other lane
because the preferred lane succeeded - that turns the soft preference into a
hard one and loses the branch in which a preferred lane, executable now, would
later break another Target. The search stays bounded by `beamWidth`, semantic
dedup, scoring, `maxExpandedStates`, and `maxPlanSteps` only.
`canSkipWhenCounterPassed` judges "the immediately following operation" within
the same lane.

An existing Gogma whose selected lane states are both lane starts - both lanes
selected at position 0, or one lane selected at position 0 while the other lane
has no operation because it is already Ideal - holds its compromise checkpoint
before the first action: `createInitialPlannerSearchState()` marks it reached,
`reserve_weapon` is not refused, no Step carries a milestone for it, and Trace
Replay verifies the source weapon at Plan start against the selected states
(`checkpoint_state_mismatch` otherwise). A conversion Route's lane position 0
is produced by the conversion and is never held at Planner start
(`docs/PLANNER_SPEC.md` 7.5.2).

A `BuildListEntry.intermediateStateSelection` lane selection is a hard
constraint. The Planner may never ignore it, disable it, or move the selection to
another opportunity of the same lane; the unit that produces a pinned state is
never `canSkipWhenCounterPassed`, a lane never passes its pin before the other
lane reached its own, and `reserve_weapon` is refused with
`selected_checkpoint_not_reached` until the compromise checkpoint — both pins
held at once — was really reached. In Planner calculation, reaching it reserves
nothing, changes no status and no protection, and never stops the Plan; in
Execution, confirming that Step labels the weapon `practical` (protection untouched)
and offers an explicit, confirmed "finish as compromise" (`docs/PLANNER_SPEC.md`
16.12). It is recorded as
`PlanStep.checkpointMilestones` (`skillOpportunityId` / `bonusOpportunityId`,
`null` for an unselected lane, plus the two-axis `conditionMatch`) on the real
physical Step that completed it, and no new `PlanStepOperationType` is added.
Trace Replay verifies the exact replayed state against the selected
opportunities and fails closed with `checkpoint_state_mismatch`. Two selected
states that need the same Counter position and are not one shareable physical
action are an ordinary Counter conflict, reported with typed
`PlanConflict.checkpointParticipants` (`buildListEntryId`, `axis`,
`opportunityId`) so the UI can send the user to the Build List to change a
selection.

`improvementPreference` is a soft Plan preference (`docs/PLANNER_SPEC.md` 7.6)
and `planner` means no lane preference at all - never "Bonus first".
`PlannerSearchState.improvementPreferenceViolationCount` counts, after the
checkpoint (or from the start when nothing is selected), every physical unit run
on the non-preferred lane while the preferred lane still had units;
`comparePlannerSearchStates()` applies it after `evaluationScore` and the
preferred source and before `weaponSwitchCount`. It never rejects a branch,
never records a rejection or a conflict, never enters
`createPlannerSearchStateSemanticKey()`, is never persisted, and never lets an
otherwise infeasible multi-Target Plan win. A bounded Beam Search does not
guarantee the absolute minimum violation count.

A BuildListEntry with a lane selection is its Target's **required Entry** for the
run (`docs/PLANNER_SPEC.md` 7.5.6). The Target is complete only once that very
Entry reached its compromise checkpoint and secured its Ideal Candidate; another
Entry of the same Target, another Target's Entry, or an existing weapon making
the Target `hasIdeal` never completes it, and the required Entry keeps its
relevance until it is secured. The Target's other Entries are left out of that
run's candidate selection - never adopted as an alternative finishing Route,
never a conflict participant - and reported with
`selected_checkpoint_fixes_target_entry`. The single authority is
`PlannerCheckpointRequirements`, derived once in `preparePlannerInitialContext()`
from every valid BuildListEntry of the run and read by `entryIsRelevantForState()`,
`isPlannerSearchStateComplete()`, scoring, typed termination, constrained
re-search and what-if alike. It is a hard feasibility constraint, never a score,
and Plan generation re-checks it as a fail-closed defence.

Two collection-level rules fail the Planner input closed instead of guessing: at
most one selection-holding Entry per Target (`multiple_selected_checkpoint_entries`
- the user clears one selection in the Build List; the Planner never picks one
by score, cost, or order), and no selection on a Target that already
holds an Ideal weapon when planning starts
(`selected_checkpoint_target_already_ideal`). Selecting both lanes inside one
Entry stays allowed.

A structurally invalid `intermediateStateSelection` - an unknown opportunity id,
an id of the other lane, an unknown preference - is checked in the Planner's
current-input validation through the same
shared `validateBuildListEntryIntermediateStateSelection()` that
`validateBuildListEntry()` uses, and fails the whole input closed
(`invalid_checkpoint_selection`). A broken
selection is never read as an empty one, so no other Entry of that Target can
stand in for it; the persisted `isStale` flag stays untrusted as before.

Complete optimality is not required.

Respect search bounds and return the best state available within the limits.

---

## Planner Inventory Rules

Planner inventory is strict for both owned rarity-8 normal Artian and Gogma Artian weapon resources. Rarity 6 and 7 normal Artian weapons are not v1 inventory entities.

When an owned normal Artian weapon is converted to Gogma, the source normal weapon is consumed from inventory and a Gogma weapon is generated. The same normal weapon must not be reused by multiple routes. Protected normal weapons are never automatic conversion sources.

For `owned_normal_artian_to_gogma`, Planner search consumes the source Normal at the
`convert_normal_to_gogma` unit so no other Route can use it. In search, the converted
Gogma remains an unregistered route output through any Reset Bonuses, Keep Bonuses,
or Reset Skills operation whose `sourceOwnedWeaponId = null`, and no route-local
weapon reference is added to the Candidate Route.

The ProductionPlan execution projection is different and authoritative for
persistence (`docs/PLANNER_SPEC.md` 16.3): an owned Normal's conversion updates the
same OwnedWeapon ID to `gogma`; a new Normal Route registers only its
production-target Normal, at that creation Step, with a Planner-reserved ID; every
later Step updates that same ID. Never delete an owned Normal to create a different
Gogma ID, and never register a Counter-advance Normal.

Game item materials are not a hard inventory constraint in v1; display required
quantities instead.

An owned Artian weapon is never consumed as material. Protected weapons are
never used for:

- Reset Bonuses
- Keep Bonuses
- Reset Skills

Do not reuse a consumed weapon: the owned Normal source of a conversion is
removed from inventory at that Step and no other Route may take it.

A blind `create_normal_artian` occupies no Counter stream position at all:
`counterStream`, `counterBefore`, and `counterAfter` are `null`. It therefore
has no absolute Counter precondition, is never rejected with
`counter_before_current` or `counter_unavailable`, and never participates in a
Counter position conflict. It is still a required physical PlanStep and is never
`canSkipWhenCounterPassed`, and it is Entry-local like every other conversion
action, so two Entries' blind forges are never one shared physical action. Do
not generalize the missing precondition to every `create_normal_artian`: the
predicted variant keeps its existing Normal Counter precondition and is still
rejected when that Counter is unavailable.

Having no Counter stream position is a property of the Route, not of the
runtime. The player really forges one Normal Artian weapon, so when the tool
currently holds a confirmed Counter for that weapon type
(`isConfirmed === true` and `counter !== null`), that Counter advances through
the same `advanceNormalCounter()` authority the predicted variant uses — never
by writing `counter + 1` directly. An unconfirmed value, a `null` value, or an
absent record stays exactly as it is: an unconfirmed value is not authority, so
it is never advanced and no record is invented. Beam Search and Trace Replay
share one helper for this; never fix one without the other. `RngAdvance` and
`PlanStepDebugInfo` then report `1` plus the concrete positions when the
Counter was confirmed, and `null` when it was not. Advancing a confirmed
Counter can push a predicted Route past its own required position, which is
physically correct; because a blind unit is not a conflict participant, that
ordering is decided by Beam Search rather than by conflict resolution.

Trace Replay carries the blind forge as an explicit runtime-only "unknown five
slots" state. Never substitute a fabricated `RestorationBonusSet`. Conversion
inherits the unknown state unchanged, Reset Skills passes it through, and only
`reset_bonuses` — which reads nothing it replaces — turns it into a known
`gogma_artian` result. Keep Bonuses reading it and `reserve_weapon` securing it
both fail closed with the Trace Replay issue code
`unknown_restoration_bonuses`. An `ExpectedResult` with `restorationBonuses` and
`restorationBonusScope` both `null` means "this Step predicts no restoration
bonus result", never "the weapon has no bonuses".

`reserve_weapon` is an internal Planner search action only. It applies right after
the Entry's last physical unit with no other action in between, and is never turned
into a separate PlanStep. Its completion effect, for every RouteKind, is: the weapon
holds the Candidate result bonuses and skills, `status = ideal`,
`isProtected = true` (existing weapons included - the old "preserve its explicit
protection value" rule is superseded), in-progress off, the Target `completed`, and
the preference of that Target and of every other Target preferring the weapon cleared; in a ProductionPlan it rides on the last physical
Step. A completed weapon is therefore never an amendment source for a later unit of
the same Plan. The weapon stores no Target reference, and Planner calculation never
changes `TargetWeapon.preferredOwnedWeaponId`; only Execution effects do. Target
satisfaction in search changes only when the reserve action applies, not merely
when an RNG operation is simulated.

---

## Conflict Rules

Planner conflicts and rejection records use `BuildListEntryId`, not volatile Candidate IDs.

Conflict kinds follow `DATA_MODEL.md`.

A Counter position conflicts only between units that must physically run at
that exact position. A `canSkipWhenCounterPassed` unit does not compete for its
Counter position, so it is never a conflict participant and is never blocked by
a conflict resolution. Required against required stays a conflict when the two
are not one shareable physical action, and a passed Route prefix never returns
to conflict detection. `same_owned_weapon_consumed` keeps its existing semantics
and does not apply this exclusion, because a Route that uses an OwnedWeapon
always retains at least one required unit referencing it.

Not being a conflict does not make the execution order free. A required unit and
a skippable unit at the same Counter position have an ordering dominance: the
required one must run first, and only then can the skippable one fast-forward.
The Planner decides that order by itself, so it never reaches conflict
resolution or the user.

Protected destructive use is not merely a scoring penalty or resolvable conflict.

It is an invalid expansion.

Do not let conflict resolution override protection rules.

User conflict choices return to Planner as local
`PlannerConflictResolution(conflictKey, selectedBuildListEntryId)` inputs. They
do not fix the entire Plan order. Ignore an invalid, deleted, stale, disabled,
capability-incompatible, or newly protected selection and return a warning that
requires reselection.

`PlanConflict.id` is the stable conflict key, never a random Planner ID. Build it
from ConflictKind, the kind-specific semantic position (Gogma Counter, Skill
Counter, Normal Counter ID and position, or consumed OwnedWeapon ID), and sorted
BuildListEntry IDs. Do not use Candidate IDs. During Beam Search, a resolution
applies only when the conflict key is rediscovered and its selected Entry is a
participant in that conflict.

Planner results are deterministic for the same PlannerInput, Engine fixture, ID
factory, clock, and Planner constants. `max_steps_reached` reports only the
maxPlanSteps bound; the Beam oracle's maxExpandedStates bound has no warning, only its
typed `reachedLimits`. A best partial Plan may be returned with the warning.

Active Plan existence is not a pure Planner input. Planner calculates a new
Draft without merging an existing Active Plan into search state. Active Plan
replacement, abandonment, recalculation, and the single-active constraint are
Application / Persistence responsibilities.

---

## Plan Recalculation Invariant

This is a core invariant:

> Do not recalculate while execution follows the finalized Plan. Recalculate only when the Plan's assumptions diverge from actual state.

Do not compare the mutable runtime state against only the original Plan-start state after execution has begun.

Use each current PlanStep's:

```text
expectedStateBefore
expectedStateAfter
```

`ExpectedPlanState` holds `rngStateHash`, `normalCountersHash`, `ownedWeaponsHash`,
and `targetExecutionStateHash`. The last one covers only the Plan-dependent Targets
(`id`, `lifecycleStatus`, `preferredOwnedWeaponId`), never every Target
(`docs/PLANNER_SPEC.md` 16.5, `docs/DATA_MODEL.md` 11.2).

Normal planned changes must not invalidate the Plan.

Examples that must not stale a Plan when expected hashes match:

- Counters advance as predicted, Step by Step
- The production-target Normal is registered and the same OwnedWeapon ID is updated as planned
- Execution links the Target to the weapon, relinks it away from another Target,
  labels a reached selected checkpoint Practical, or completes the Target on Ideal
- An owned weapon's status label is changed by the user
- A new Target is added, or a Target the Plan does not depend on is changed
- A new BuildListEntry is added, or an Entry the Plan does not depend on is changed
- A Candidate Search is run
- The user saves the game and suspends; the Plan stays `active`

Active Plan execution takes precedence over BuildListEntry derivative staleness caused solely by normal planned progression.

Do not stop an Active Plan merely because current values no longer match the BuildListEntry's original `searchStateHash` or `referencedOwnedWeaponsHash`.

Examples that do require stale/recalculation behavior:

- Runtime RNG state differs from the current step expectation
- Normal Artian counter differs from the current step expectation
- A Plan-dependent Target's performance definition, priority, enablement, lifecycle,
  or preference differs from the expectation (`target_changed`)
- A Plan-dependent BuildListEntry changes (`build_list_changed`)
- OwnedWeapon changes outside the Plan
- CalculationContext becomes incompatible
- Predicted result differs from observed result (`unexpected_result`)
- The user records that what or how many operations were performed is unknown
  (`execution_operation_uncertain`)

`planned_candidate_not_secured` and `different_candidate_secured` belong to legacy
Plans with a separate secure Step; current Execution never produces them.

Never apply the old rule "any Target or Build List change stales the Active Plan".
Plan invariance compares only the Plan-dependent Target definitions and the
Plan-dependent Entries (`PlanningInputSnapshot.dependentTargetDefinitionsHash` /
`dependentBuildListEntriesHash`); the whole-input hashes are audit only.

When the user tries to save a Plan-breaking change through the UI while a Plan is
`active` (manual RNG / Counter change, Identification adoption, a Plan-dependent
Target / Entry change, a semantic change to a weapon the Plan tracks), warn before
saving. On approval the Plan becomes `abandoned` with `breaking_change_approved` in
the same transaction as the change; on cancel nothing changes. Keep this distinct
from `stale`, which records a detected divergence.

Use the specified recalculation reason where applicable.

Do not automatically replace a stale or active Plan. Replanning from the current
point is a side-effect-free Preview followed by an explicit adoption that
re-validates the Preview-start state and atomically switches old Plan ->
`abandoned` (`replan_adopted`) and new Plan -> `active` (`docs/PLANNER_SPEC.md` 16.8).

The user explicitly initiates recalculation.

---

## Execution Lifecycle

`docs/PLANNER_SPEC.md` 16 is the authority; `docs/DATA_MODEL.md` 7.1 / 8.1 / 11 / 12
and `docs/UI_FLOW.md` 12 / 16 follow it. The persisted entity foundation and the
calculation schema 12 Execution Plan contract (Plan generation with
`executionEffects`) are implemented. Of the Execution runtime, Plan start and the
ordinary `confirmed_expected` Step confirmation (blind observation and
`confirm_owned_ideal` included, with the full Undo snapshot and Plan completion), and
the `actual_result_different` / `operation_uncertain` records, the Current Position Recovery
after `operation_uncertain` (`operation_count_recovered`), Undo of the latest
ExecutionHistory, game save point record / restore, finishing as a compromise, and user
abandonment with the 16.10 save point choice, the replan Preview and adoption, and the
Plan-breaking change guard with its approved `breaking_change_approved` abandonment are
implemented. The Execution Navigator UI covers the ordinary path (Plan start / resume,
Step confirmation including the blind observation and `confirm_owned_ideal`, weapon switch
guidance, the compromise checkpoint panel and finish, completion) and the divergence
records (「結果が違う」 with its re-identification guidance, 「何を何回操作したか分からない」
with the Execution Recovery: current position check, the save point restore and the Plan
abandonment it needs) and the state controls (Undo of the latest ExecutionHistory, the game
save point record / overwrite / restore, and the ordinary Plan abandonment with the 16.10
choice) and the replan Preview / adoption (「現在地点から再計画を試算」 on the Build List and the
Production Plan page, the transient 「再計画の試算（未採用）」, 「この再計画を採用」 with the 16.10
choice) and the breaking-change warning (the one shared warning / save point choice dialog on
RNG Setup, the Identification Wizard, Normal Counter Setup, Owned Weapons, Target Weapons and
the Build List) and the persistent RNG re-identification reminder on Dashboard / RNG Setup /
Candidate Search (the one shared warning derived from every Plan's divergence records and the
Identification provenance).
Implementation PRs follow the specification and must not fall back to the older
Execution semantics.

Core rules:

- Every physical operation is confirmed one Step at a time and its `rngAdvance` is
  persisted immediately. Never batch Counter updates at Plan completion, and never
  persist an unconfirmed Step's progress
- `ProductionPlanStatus` meanings are fixed: `draft` not started, `active` running
  (also while suspended - no pause status exists), `completed` all Steps done,
  `stale` divergence detected, `abandoned` user intent with
  `abandonmentReason` = `user_abandoned` / `replan_adopted` /
  `finished_as_compromise` / `breaking_change_approved`. At most one `active` or
  `stale` Plan exists
- Only physical weapons the Plan keeps identifying or processing become
  OwnedWeapons. Counter-advance Normals of a `forgeCount` creation are never
  registered; only the final production-target Normal is registered, at its own
  creation Step, with a Planner-reserved ID kept until completion. An owned Normal's
  conversion updates the same ID to `gogma`. Candidate Routes keep
  `sourceOwnedWeaponId = null` for transient weapons; only the ProductionPlan
  execution projection binds IDs
- A blind production-target Normal's five slots are a user observation entered at
  Step confirmation, never a prediction and never fabricated. Expected states carry
  a binding token instead of the unknown value
- `reserve_weapon` is never a user-visible Execution Step. The internal reserve
  applies right after the Entry's last physical unit, and its effect rides on that
  Step as target completion: `status = ideal`, `isProtected = true` for new and
  existing weapons, in-progress off, Target `completed`, and the preference of every
  Target preferring that weapon cleared. A
  zero-operation `existing_gogma_current` Entry gets a `confirm_owned_ideal` Step
  that advances no Counter
- Reaching a user-selected compromise checkpoint labels the weapon `practical`
  (protection and in-progress unchanged) and offers "finish as compromise", which
  needs a confirmation dialog and abandons the Plan while the Target stays `active`
  and keeps its preference
- Weapon switch guidance is presentation-only, derived from adjacent physical Steps'
  tracked weapons. It is never a PlanStep, never an ExecutionHistory entry, and never
  counted in Planner cost or `maxPlanSteps`
- An unexpected result with a clearly performed operation applies the Counter
  consumption and stores the actual result, stales the Plan, and guides to RNG
  re-identification. When what or how many operations happened is unknown, never
  guess Counters: change no state and stale the Plan. Its recovery never goes straight to
  the ordinary Identification: an unknown count of the same operation is Current Position
  Recovery inside the Recovery Window (`operation_count_recovered`, only a unique position,
  replayed through the Plan's own Steps); another operation / weapon or an unfixable
  position restores the game save point, or abandons the Plan when there is none
  (`docs/PLANNER_SPEC.md` 16.15)
- Candidate Search always starts from the last confirmed persisted state. The
  "after the running Plan completes" origin is a Preview that replays the stored
  remaining Steps without prediction or side effects and cannot add to the Build List
- The game save point (`ExecutionSavePoint`) is recorded only by explicit user
  action, one per active Plan, never inferred from the game, and is a different
  concept from a compromise checkpoint - never call it a checkpoint. Restoring it
  resets only execution-scope state and never resurrects deleted entities: before any
  write, if an OwnedWeapon of the snapshot, a Plan-dependent Target, or a Plan-dependent
  BuildListEntry the restored Plan needs is missing, the restore is refused and none of
  RngState, NormalArtianCounter, OwnedWeapon, TargetWeapon, ProductionPlan,
  ExecutionHistory, or ExecutionSavePoint changes (`docs/PLANNER_SPEC.md` 16.9). Plan-abandoning actions after the save point
  offer keep current / restore save point / cancel. It is not carried to a replanned
  Plan
- Normal UI still shows no Seed / Counter numbers; Debug Mode shows before / after

---

## Plan Step Rules

Execution navigation is one operation at a time in v1.

Do not introduce batch completion.

Plan steps may represent operations such as:

- Create normal Artian
- Convert to Gogma Artian
- Reset Bonuses
- Keep Bonuses
- Reset Skills
- Confirm an owned Ideal (`confirm_owned_ideal`, no Counter advance)

There is no separate Reserve / secure Step in a current Plan; completion rides on the
last physical Step as an execution effect (`docs/PLANNER_SPEC.md` 16.3). Legacy Plans
holding `reserve_weapon` / `confirm_result` Steps may be displayed but never executed.

Every Step stores expected state before and after the operation, and its
`executionEffects` (tracked weapon, Normal creation role, registration, observation
binding, Target link, compromise label, Target completion).

For `ExpectedPlanState.ownedWeaponsHash`, include OwnedWeapon `kind` and
restoration-bonus scope in addition to the other semantic inventory fields. A
kind or scope change must change this hash and `referencedOwnedWeaponsHash`;
name, memo, status, `executionInProgress`, and timestamps remain excluded. An
OwnedWeapon carries no Target reference, so neither hash contains one, and a Target's
`preferredOwnedWeaponId` must never be added to the
`referencedOwnedWeaponsHash` of a Candidate whose Route does not reference that
weapon.

Plan recalculation is a user-initiated UI/Planner action for a stale Plan. It is
not a `PlanStepOperationType`, and no `recalculate_plan` Step is inserted into
the old Plan.

A status change on its own is ordinary Owned Weapons CRUD, never a
ProductionPlan operation, and there is no PlanStep whose only effect is one.
Execution writes status only as an effect of a physical Step (or
`confirm_owned_ideal`): `unclassified` at conversion, `practical` when a selected
compromise checkpoint is reached, `ideal` with protection at completion. Because
status is non-semantic, relabelling a weapon never makes a running Plan stale.
Planner calculation reaching a compromise checkpoint changes neither status nor
protection.

---

## Execution History and Undo

Expected Plan state and `ExecutionHistory` are separate.

Execution history records what the application/user confirmed happened. Current
actions are `confirmed_expected` (including a blind observation and a
`confirm_owned_ideal` confirmation), `actual_result_different`,
`operation_uncertain`, `operation_count_recovered`, and `finished_as_compromise`;
`secured_weapon` and `skipped_candidate` are legacy only. `operation_count_recovered` is one
record for a whole Current Position Recovery - never a set of fabricated `confirmed_expected`
records - and its Undo snapshot is the `stale` state the `operation_uncertain` record left.

Before finalizing a Step, save an `ExecutionUndoSnapshot` containing the state required to restore that Step.

The snapshot includes the required pre-Step state defined in `DATA_MODEL.md`, including:

- RngState
- All Normal Artian counters
- Affected OwnedWeapons (including status and `executionInProgress`)
- Added OwnedWeapon IDs
- Removed OwnedWeapons
- TargetWeapons the Step changed (the linked Target, any Target whose link was
  cleared, a completed Target)
- Previous ProductionPlan (status, abandonment reason, current Step)
- The Plan's game save point before the Step

Undo:

- Applies only to the most recent ExecutionHistory entry of the shown Plan, while
  the Plan is `active` / `stale`, or when that very entry completed or finished the
  Plan. Plans abandoned by replan adoption, user abandonment, or an approved breaking
  change are not undoable
- Restores application state, including Targets and the save point; undoing the
  save point's boundary entry deletes the save point
- Deletes that ExecutionHistory entry
- Does not add a new "Undo" history record
- Does not reverse the actual in-game operation

After restoring the snapshot, use the restored ProductionPlan status and recalculation reasons as stored.

Do not invent a new post-Undo invalidation decision merely because the game action itself cannot be reversed.

UI must clearly state that Undo only changes the tool state.

---

## Atomic Execution Transactions

Execution Navigator Step finalization is atomic.

For applicable actions, use one Dexie read-write transaction that includes the related:

- Current-state read
- `expectedStateBefore` validation
- Undo snapshot creation
- RngState update
- Normal Artian counter update
- OwnedWeapon add/update (registration, same-ID update, status, protection, in-progress)
- TargetWeapon update (link, relink, completion)
- ExecutionHistory write
- PlanStep update
- ProductionPlan update
- Game save point deletion when the Plan completes or is abandoned
- `expectedStateAfter` validation for expected-success paths

Expected-success paths such as:

- Confirm expected result (including completion on the last physical Step)
- Confirm a blind observation
- Confirm an owned Ideal (`confirm_owned_ideal`)

must rollback the entire transaction if the resulting state does not match `expectedStateAfter`.

The unexpected-result and operation-uncertain paths intentionally persist stale state and the corresponding reason within the same transaction.

On any storage/validation failure:

- Leave no partial update
- Keep the pre-Step state
- Keep the UI on the current Step
- Surface a retryable save error

Undo is also one Dexie transaction. Replan adoption, game save point restore,
finishing as a compromise, Plan abandonment, an approved breaking change, and a Current
Position Recovery after `operation_uncertain` are each one Dexie transaction too.

Undo failure must leave the pre-Undo state and history unchanged.

---

## Master Data Rules

Master data is separate from application logic.

Expected master sets include:

- Weapon types
- Elements
- Bonus types
- Bonus ranks
- Weapon bonus definitions
- Series skills
- Group skills
- RNG Lottery data
- Materials
- Material costs

Restoration bonus availability is selected from Master Data using all of:

- Weapon type
- Element
- `ArtianBonusScope`

Do not infer availability from ID string patterns. The current Master selector
excludes Element Bonus when `ElementMaster.allowsElementBonus` is false and for
Light / Heavy Bowgun, but that exclusion is Master data, not the game's lottery
availability. Production availability is decided per weapon type x lottery
table (`docs/RNG_SPEC.md` 6.1.1 / 6.3.1): Switch Axe `element.none` can hold
Element Bonus in the game, Bow Poison / Paralysis / Sleep do not draw it, and
Light Bowgun and Heavy Bowgun draw no Element Bonus regardless of element.
Production-usable definitions are the product of the Master weapon type / scope
definitions and that family availability. PR-C implemented that composite
selector in `src/domain/artian/productionBonusAvailability.ts`
(`docs/MASTER_DATA.md` 15.1): the Owned Weapon, Target, and Target compromise
editors, new entity drafts, entity validation
(`src/domain/artian/entityMasterValidation.ts`), and Identification Wizard
STEP 2 all read it, never `getBonusDefinitionsForWeapon()`. That Master-only
selector and its `allowsElementBonus` exclusion stay unchanged and must not be
described as a game rule. The composite selector reads `domain/master` and
`domain/rng/production`; `domain/master` never imports the Production RNG
layer, and nothing falls back to Master-only availability. A stored bonus
outside the availability is never migrated, removed, or replaced on load or
Import; editors show it as a disabled 「現在値・Production抽選対象外」 option and
entity validation refuses it at save (non-destructive load plus fail-closed
save). This availability is an entity / UI concern, never a Keep prediction
input filter.

The project-owner-confirmed semantic normal-to-Gogma Bonus Type mapping is:

```text
通常 基礎攻撃力強化 -> 巨戟 基礎攻撃力強化
通常 会心率強化 -> 巨戟 会心率強化
通常 属性強化 -> 巨戟 属性強化
通常 斬れ味強化 --+
                   +-> 巨戟 斬れ味・装填強化
通常 装填数強化 ---+
```

This mapping is many-to-one for Sharpness and Capacity and is semantic Master
metadata only. Conversion performs no bonus-type or rank conversion: it
preserves the five `normal_artian` scope slots exactly. Search and RNG code
must not use this mapping to infer Reset/Keep results, Counter behavior, or a
completed Gogma-tier bonus set.

The enabled skill options are 21 Series Skills and 16 Group Skills. Keep the following IDs in Master Data with `isEnabled = false`:

- Series: 花舞の祈り, 踊火の祈り, 夢灯の祈り, 祝謡の祈り
- Group: 拳を極めし者

Master data is versioned.

At minimum, preserve:

- Game version
- Master data version
- User schema version
- RNG Engine version in CalculationContext

Run master validation immediately after loading.

If master validation fails, do not continue normal application startup with invalid data.

Do not make production RNG correctness depend on unverified Lottery fixture data.

---

## Persistence Rules

Use IndexedDB through Dexie.js for persistent user data.

Persist entities defined by `DATA_MODEL.md`.

Do not persist transient UI state without a specification requirement.

Initial import behavior is full replacement only.

Before applying imported data:

- Parse and validate it
- Validate schema version
- Validate references
- Validate Master IDs
- Validate domain invariants

If validation fails:

- Do not partially apply data
- Keep the current data unchanged

Export must include the specified schema version and user entities. The Execution
lifecycle state - Target lifecycle, `OwnedWeapon.executionInProgress`, ProductionPlan
abandonment, PlanStep `executionEffects`, the extended ExecutionHistory / Undo
snapshot, and `ExecutionSavePoint` - is user data and belongs to Export / Import.
Device-to-device sync is not added; full-replacement Export / Import covers it,
through a JSON file or through the clipboard (copy on Export, paste on Import). The
clipboard / paste entry points changed no ExportRoot shape, schema version, Import
validation, migration, or `applyImport()` / `clearAllData()` transaction semantics.

Master Data itself is not copied into the user export.

The full-replacement Import / Export / clear-all-data Persistence / Application
Service foundation is implemented (`src/services/dataTransfer/importExportService.ts`,
`importExportValidation.ts`, `docs/DATA_MODEL.md` 15.3), and so is the Settings
screen connection (`src/pages/SettingsPage.tsx`, `src/components/settings/`,
`docs/UI_FLOW.md` 14): the Export Dialog (`src/components/settings/ExportDataDialog.tsx`),
which `serializeExport()` opens once and which shows that exact string read-only and
never re-formatted, then copies it (the asynchronous Clipboard API behind the
Presentation `DataTransferBrowserAdapter`, never in the Domain or the Service, with a
Dialog-local 「クリップボードにコピーしました。」 or a manual-copy failure and no
browser error text) or saves it as a browser-side JSON Blob named
`gogma-artian-planner-backup_yyyyMMddHHmmss.json` (local time of the Export, a
filename rule only - not `exportedAt`), neither calling `serializeExport()` again;
the Import Dialog (`src/components/settings/ImportDataDialog.tsx`), whose pasted text
(read disabled while blank, never trimmed or re-formatted) and whose picked file's text
(read at once, same file re-selectable) both go unchanged through one preparation path
to `prepareImportJson()` as the only importability authority (a refused preparation
keeps the Dialog and its draft, shows the issues inside it, opens no confirmation,
calls no `applyImport()` and changes nothing; the app never reads the clipboard), the
full-replacement Import confirmation dialog, opened only after the Import Dialog closed, that asks for an Export of the current
data first without running one, the clear confirmation dialog, and the Settings
Store rehydrate from the imported `root.settings` / the `clearAllData()` return
value (never from `getOrCreateDefault()`). The UI re-implements no validation,
migration or write, runs one Data Transfer operation at a time, never starts one
while the Debug Mode save is pending, and disables the Debug Mode toggle while one
runs. Its contract:

- `exportRoot()` reads every user table in one read-only Dexie transaction, sets
  `schemaVersion` / `appName` itself, takes `exportedAt` from an injected clock,
  sorts only the top-level entity collections by primary ID (never the five bonus
  slots, PlanStep order, or any other nested array), validates the built root with
  the same full validation Import applies, and fails closed with
  `export_state_invalid` - never creating a missing AppSettings, never rewriting the
  database - while a historical CalculationContext is never a reason to fail
- `prepareImportJson()` / `prepareImportRoot()` return typed results (`invalid_json`
  for a non-JSON body, `invalid_import` otherwise) and never throw on untrusted
  input. Schema migration is only the existing `prepareExportRootForImport()`
  (schema 6..11; the 10 -> 11 step deletes every Draft of the old accumulating contract);
  `validateExportRootForFullReplacement()` then
  adds BuildCandidate / BuildListEntry / AppSettings entity validation, the Target
  Ideal => Practical containment, primary ID uniqueness per collection, the running-Plan
  collection invariant (at most one `active` / `stale` Plan in `root.productionPlans`;
  snapshot Plans inside Undo snapshots and save points are not counted, and terminal
  Plans get no count constraint) and the independent Draft collection invariant (at most
  one `draft` Plan in `root.productionPlans`, `invalid_state` otherwise; a Draft beside a
  running Plan is not refused), the formal persisted references (Candidate /
  Entry `targetWeaponId` and the Route's `collectReferencedOwnedWeaponIds()`,
  `validateTargetPreferredOwnedWeapons()`, every BuildListEntry reference of an `active`
  ProductionPlan - `selectedBuildListEntryIds`, Step `buildListEntryId`, checkpoint
  milestones, `executionEffects` target links / compromise labels / target completions,
  conflict participants / recommendation / selection / checkpoint participants,
  `rejectedBuildListEntries` - plus the Plan-dependent Targets of
  `collectProductionPlanDependentTargetWeaponIds()` and milestone Targets, with every
  Entry-paired Target equal to that Entry's own `targetWeaponId` as Plan generation and
  the Plan start effect derive it (a `draft` / `stale` / `completed` / `abandoned` Plan
  body is never read as current foreign keys, see the seventeenth PR above), ExecutionHistory `planId` / `planStepId`,
  `executionInProgress.productionPlanId` naming a running (`active` / `stale`) Plan,
  `completedByProductionPlanId`, `validateExecutionSavePointReferences()` plus the
  current-entity contract `prepareExecutionSavePointRestore()` requires: the save
  point's Plan is running, its snapshot Plan is `active` (the only status a save point
  is recorded at; the current Plan may be stale meanwhile), every
  `savePoint.ownedWeapons` ID still exists (the restore never revives a deleted weapon;
  the body is not compared), and its snapshot Plan's selected Entries and
  Plan-dependent Targets exist now), and Master ID existence. A Plan-registered future
  OwnedWeapon ID, a Step `candidateId`, an Undo snapshot body, a Plan-independent
  Target inside `savePoint.targetWeapons`, and `BuildListEntry.candidateId` are never
  current foreign keys; no restore-time precondition (CalculationContext, executable
  Step, expected state, scope completeness, history boundary) is asked, and a running
  Plan is never required to have an in-progress weapon
- Master ID validation is existence only, never the save-time
  `validateOwnedWeaponMasterReferences()` / `validateTargetWeaponMasterReferences()`:
  a stored bonus outside the Production availability (Bow / Poison + Element) is
  imported unchanged (`docs/DATA_MODEL.md` 7.1 non-destructive load). A snapshot
  Route's source OwnedWeapon is checked for existence only, not for the save-time
  Normal-kind / unprotected eligibility, because Execution converts an owned Normal in
  place and the user may protect a source afterwards; that divergence is
  `owned_weapon_changed` staleness, not an invalid backup
- `applyImport()` re-validates the root, then clears every user table and inserts
  the root with duplicate-failing `add` / `bulkAdd` in one read-write transaction. No
  CRUD service, Plan-breaking guard, `updatedAt` change, or reminder flag is involved,
  `exportedAt` is stored nowhere, and a failing write rolls the whole replacement back
- `clearAllData()` clears every user table and creates one default AppSettings in one
  transaction, creating no other entity; a failure keeps the previous data
- None of it moved `CURRENT_CALCULATION_APP_SCHEMA_VERSION` (13),
  `DATABASE_SCHEMA_VERSION` (then 7), `ExportRoot.schemaVersion` (then 10), or
  `RngState.schemaVersion` (2); the later Draft lifecycle PR moved Dexie to 8 and
  Export to 11 without touching the other two

---

## Web Worker Rules

Long-running calculations must not block the UI thread.

Use Workers for:

- Seed search
- Counter search
- Large candidate search
- Planner search where non-trivial

Worker messages must be typed and use request IDs.

Rules:

- Ignore obsolete response IDs
- Do not apply results after cancellation
- Support progress for long-running work
- Support cancellation
- Do not access React state from Workers
- Do not access Dexie directly from candidate-search Workers
- Do not access Dexie directly from Planner Workers
- Send the required input and Master subset through messages

Candidate-search and Planner Worker messages must never structured-clone an
RngEngine instance. The Worker module obtains the Engine factory locally and
injects runtime dependencies into the calculation function.

Do not return guessed production results from a Fake RNG implementation without making the fake/debug status explicit.

---

## UI Rules

PC browsers and smartphone browsers are both primary environments. Every major
feature must be practically usable on both, and a device never removes or
changes features, information, input fields, or Domain semantics: device
differences stay in the Presentation layer (density, layout, display form,
control placement). `docs/UI_FLOW.md` 3.1 defines the per-screen policy,
including the smartphone emphasis of the Execution Navigator.

Normal UI hides internal RNG values:

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate
- Normal Artian counters

Debug Mode may show them.

The one exception is the Normal Counter Setup list (`docs/REQUIREMENTS.md` 4,
`docs/UI_FLOW.md` 3 / 6): its カウンター値 column shows a Normal Artian Counter
only when `isConfirmed === true` and `counter !== null`, and 「—」 otherwise. An
unconfirmed retained value (after 確定解除 or a Debug save) is never shown there
as the current Counter. The exception does not extend to any other RNG value,
any other screen, or the Identification Dialog's unique result.

Debug Mode must not change calculation semantics.

Normal UI must not expose out-of-scope v1 controls.

Important destructive operations require explicit confirmation.

Search UI must:

- Offer one enabled TargetWeapon at a time through a single Select, with no
  result filter, no output cap and no similarity control
- Show at most one canonical Ideal Candidate, and say
  「現在の探索範囲では理想品が見つかりませんでした」 when none was found - never
  that the Target has no Ideal
- List that Candidate's intermediate states as two separate axes, スキル候補
  and 復元ボーナス候補, all unselected by default, at most one selectable
  opportunity per lane, each axis ending with the Ideal as 最終目標 without a
  checkbox, with 「その他の到達点」 for later arrivals of one group and
  「その他の候補」 for display-secondary Bonus groups, and never a Skill x Bonus
  combination list
- Offer 理想品までの改善優先 (生産計画に任せる / スキルを優先 / 復元ボーナスを優先,
  default 生産計画に任せる) next to the selection
- Say 「この候補は作成リストに追加済みです。途中採用する状態と改善優先は作成リストで
  変更してください。」 when the same Candidate is added again, and never overwrite
  the existing selection
- Show skipped-route reasons
- Show protected existing Gogma only as zero-operation current-state Candidates when
  they already satisfy the Target, and do not show amendment routes for them
- Show inherited normal-scope bonuses and the initial predicted Skills at
  conversion
- Present both Reset Bonuses and Keep Bonuses as the first bonus amendment of
  a converted normal-scope Gogma whose five slots are known, and Reset Bonuses
  alone as the first amendment of a blind Normal route, explained as an
  unknown-input limit rather than as a game restriction
- Allow later Reset Bonuses or Keep Bonuses in the same route; never present a
  Keep slot-selection control

Target Weapons UI must:

- Offer a 優先する所持武器 Select listing compatible Normal and Gogma weapons
- Show a compatible protected weapon as a visible but unselectable option, so the
  user can see why it is unavailable, rather than hiding it
- Mark a weapon another Target already prefers with that Target's name
- Order the options as current selection, unassigned, assigned elsewhere, protected,
  and break ties within a group on a stable existing key
- Offer 指定なし
- Confirm before taking a weapon from another Target, and change nothing on cancel
- Drop a preference the Target's own weapon type or element change made
  incompatible, in the draft only, with no confirmation and no write before save
- Show the preferred weapon name, or なし, on the Target list card

Owned Weapons UI must:

- Offer 未分類 / 実用 / 理想 as the owned Gogma status, and never 素材
- Default a new Gogma weapon to 未分類 with protection off
- Keep status and protection independent when editing an existing weapon: a
  status change alone must not confirm anything or alter protection
- Drop every wording that presents an owned weapon as a consumable - 素材用武器,
  素材として使用 and the like - while keeping the game item material display
- Not offer the removed 関連する目標武器 display or editing controls
- Show the preferring Target read-only, so the relation stays visible
- Confirm before protecting or re-typing a weapon a Target prefers, change neither
  the weapon nor the Target on cancel, and on approval save the change together
  with the Target unlink

Target Weapons UI must also:

- Hide `completed` Targets from the normal list and Search Select, show them read-only
  under 完了済みの目標武器, and allow reopening only through the explicit
  未完了に戻す action with confirmation
- Notify 「この目標の理想条件を満たす所持武器をすでに所有しています。」 when an owned
  Gogma already meets the Ideal, and offer completing the Target with it as the
  preferred path over Build List / Plan

Execution UI must (`docs/UI_FLOW.md` 12):

- Present one operation at a time
- Show expected result
- Distinguish a Counter-advance Normal creation from the production-target Normal
- Require the actual five slots for a blind production-target Normal
- Support result confirmation, with Ideal completion on the last physical Step and
  no separate 確保 button or Step
- Offer 次の操作へ進む and a confirmed この武器を妥協品として確定して終了 when a selected
  compromise checkpoint is reached
- Insert the presentation-only 作業する武器を「○○」へ切り替えてください guidance
- Support actual-result mismatch recording, guiding to RNG re-identification
- Support "operation unknown" recording and its recovery: choose between an unknown count
  of the same operation (current position check against the Plan's recorded results) and
  another operation / weapon (game save point restore after the game-side confirmation, or
  Plan abandonment without a save point); never link straight to the ordinary Identification
- Support Undo
- Support ゲーム内セーブ済みとして記録 and restoring the last game save point, and ask
  現在地点を維持 / 最後のゲーム内セーブ地点へ戻す / キャンセル before a Plan-abandoning
  action when Steps were confirmed after the save point
- Warn before a Plan-breaking change is saved while a Plan is `active`
- Offer 現在地点から再計画を試算 with a separate, re-validated adoption
- Show stale/recalculation reason when execution diverges
- Keep Seed / Counter numbers hidden unless Debug Mode is on

---

## GitHub Pages Rules

The production build must support GitHub Pages.

Do not introduce a backend-routing requirement.

Routing and Vite configuration must work when hosted under the repository path.

The UI specification permits a Hash Router for v1 if needed.

When routing or Vite configuration changes:

- Verify the production build
- Do not rely only on the dev server

---

## Testing Requirements

For every meaningful domain change, add or update tests.

Do not delete or weaken tests merely to make implementation pass.

Important logic should use deterministic fixtures.

Unverified or merely reference-verified RNG behavior must not be treated as game-correct merely because a Fake fixture passes.

Relevant test areas include:

- Domain invariants
- Restoration bonus multiset comparison
- Master validation/selectors
- Partial RNG capability derivation
- Observation validation
- Search route eligibility
- `existing_gogma_reset_skills`
- Conversion advancement: Normal +0, Skill +1, Gogma +0
- Conversion inheritance of ordered `normal_artian` scope bonuses and initial
  Series/Group Skills
- Keep from known normal-scope slots is generated as the first bonus amendment
  of owned Normal, owned normal-scope Gogma, and predicted new Normal routes,
  while a blind route still starts with Reset and Keeps only after it
- Keep family resolution maps `bonus_type.attack` / `affinity` / `element` /
  `normal_sharpness` / `normal_capacity` to their Gogma families through the
  Master mapping, ignores rank, keeps slot order, and leaves every existing
  Gogma-scope Keep golden vector unchanged
- The forced Reset Normal Artian route is searched with no owned weapon and no
  confirmed Normal Artian Counter, forges exactly one weapon, calls
  `predictNormalArtian` zero times, and produces no Candidate before its Reset
- The forced Reset route stays unavailable without a confirmed Skill Counter,
  without a confirmed Gogma Counter, or without Reset Bonuses prediction support
- A blind route's `searchStateHash` is unchanged when the Normal Artian Counter
  is later confirmed, while a predicted route's still changes
- A blind `create_normal_artian` adds no RNG capability requirement, while a
  predicted one still requires its confirmed Counter
- A blind `create_normal_artian` advances a confirmed Normal Counter by one in
  both Beam Search and Trace Replay, reporting `normalCounterDelta = 1` with the
  concrete debug positions, while an unconfirmed value, a `null` value, and an
  absent record all stay untouched with `null` delta and `null` debug positions
- The shared advance helper delegates to `advanceNormalCounter()` rather than
  adding one itself, and leaves a different weapon type and a predicted creation
  alone
- Two blind Entries sharing one confirmed Normal Counter advance it once each,
  in order, without becoming a Counter position conflict
- Route validation rejects a blind route that completes at the conversion, Keeps
  before its first Reset, resets only Skills, forges more than one weapon, or
  carries a half-filled Normal Counter pair
- The Planner plans create / convert / Reset / reserve from a blind Candidate
  with no Normal Counter and no `counter_unavailable`, while a predicted Normal
  route with no confirmed Counter stays excluded
- Two blind Entries never share their create or convert action
- Trace Replay carries unknown five slots through conversion, turns them known
  at the Reset, and fails closed with `unknown_restoration_bonuses` on Keep and
  on reserve
- Candidate Search through ProductionPlan end-to-end from an empty inventory
  with no Normal Artian Counter record
- Reset or Keep after the first Reset in normal and owned-normal routes
- Keep family preservation by slot with no selection branches
- Skill prediction count independent of Gogma state count, source count, and
  normal offset count
- Gogma prediction count independent of Skill position count
- Zero Skill exploration when the current Skills already satisfy the ideal Skill
  condition, and zero bonus amendment exploration when the current bonuses
  have Gogma scope and satisfy the ideal bonus condition
- Normal-scope exact Ideal labels never cause Bonus early termination; scope
  stays in full-prefix / incremental stream retention identity
- Candidate composition follows the documented Cross rule and never enumerates
  the bonus-by-Skill product
- The initial search stops at one canonical Ideal, and that Ideal is unchanged
  when RouteKind evaluation order changes
- The canonical Ideal is unchanged when `searchRunId` changes across runs
- Changing only `searchRunId` leaves each Target's ordered
  `candidateStableKey` sequence identical while the `BuildCandidate.id` values
  differ, and complete semantic duplicates compare equal instead of by ID
- Every intermediate state of the canonical Ideal Route is extracted per lane
  from its recorded traces, and the extracted set is unchanged across traversal orders
- Stream anchors `b0` / `k0` come from the documented deterministic ordering
- Bonus state groups with differing bonus compositions stay primary as
  incomparable rather than being tidied behind the secondary disclosure, and
  Skill groups are never dominated
- Bonus rank dominance is decided per `bonusTypeId` rank multiset, not by slot
  index, and an uncomparable Master rank ordering makes the pair incomparable
- Material dominance is decided component-wise per `materialId`, so differing
  material kinds and mixed trade-offs stay incomparable
- The same result at a later Counter position is not excluded as dominated, and a
  constrained re-search can still reach it
- A conflict with no explicit `PlannerConflictResolution` does not trigger an
  automatic constrained re-search, and `recommendedBuildListEntryId` is never
  used as the fixed authority
- A constrained re-search re-evaluates from the original Search/RNG origin, not
  from `conflictingCounter + 1`, and reaches Candidates omitted by initial
  Practical dominance or stream-local retention
- Coexistence matches an actual Planner rerun, and a constrained Candidate is
  never injected into a mid-Beam state
- Adding a generated Entry changes the `PlanConflict.id` of the same physical
  conflict, the original `conflictKey` is not reused, and the resolution is
  rebuilt against the newly detected id only on a unique conflict-resource plus
  fixed-Entry match; zero or several matches drop the trial or return the
  conflict instead of guessing
- The `same_owned_weapon_consumed` conflict resource is its own field and is not
  substituted by a participant's `sourceOwnedWeaponId`
- `generatedBuildListEntries` contains only Entries adopted into the final
  augmented PlannerInput, is empty when `plan === null`, and its Entries are
  saved with the ProductionPlan in one transaction with no partial save
- Generated Entry IDs are stable across identical reruns and depend on no random
  UUID, Clock, enumeration ordinal, or request UUID
- Identical reruns match on semantic outcome only — generated Entry IDs, the
  selected Entry semantic set, PlanStep semantic operation sequence and order,
  RNG Counter advance/transition semantics, inventory transition semantics,
  conflict semantic outcomes, warnings, `rejectedBuildListEntries`, and
  `requiredMaterials` — and never require equal `ProductionPlan.id`,
  `PlanStep.id`, reserved OwnedWeapon IDs, Clock-derived `createdAt` /
  `updatedAt`, or `ExpectedPlanState` hashes
- Within one run the expected-state chain still closes: the first
  `expectedStateBefore` equals `PlanningInputSnapshot.initialExecutionState`, and
  each step's `expectedStateAfter` equals the next step's `expectedStateBefore`
- Full `ExpectedPlanState` equality is asserted only under injected
  sequential-ID and fixed-clock test dependencies
- A generated ID collision whose semantic content differs fails closed, and a
  stale existing Entry is neither reused nor overwritten
- Candidate semantic identity includes restoration bonus scope
- Constrained enumeration is deterministic, reports a bound stop separately from
  exhaustion, caps off-axis pair evaluations, never receives a Planner conflict
  DTO, and never receives the three orchestration bounds
- The enumerator origin comes from the Planner-start validated snapshot, carries
  no `searchRunId` / `routeFilter` / `resultFilter` / `settings`, and does not
  require a historical UI Candidate Search request
- Constrained re-search applies no `resultFilter`, similar filter, or
  `maxCandidatesPerTarget`, takes its extent only from
  `ConstrainedEnumerationBounds`, and still yields only Ideal/Practical Candidates
- Conflict resolutions are re-mapped in the initial conflict preflight before the
  full Beam Search, the preflight uses only existing Planner conflict detection,
  and `maxPlannerReruns` excludes it
- Preflight runs `validatePlannerInput` and builds its initial state from
  `validBuildListEntries`, never from raw `BuildListEntry`, and shares that path
  with the ordinary Planner instead of reimplementing it
- Validation excluding the generated Entry or a fixed Entry fails closed
- Every valid explicit resolution is re-mapped, an unrelated one is never silently
  dropped, and a partially rebuilt resolution array never reaches Beam Search
- The enumerator yields `ConstrainedCandidate` without `id` / `searchRunId` /
  `createdAt`, and the materializer sets `searchRunId` to the deterministic
  constrained search identity and derives `id` from it plus the semantic meaning
- Constrained enumeration yields Ideal Candidates only
- Target Ideal-implies-Practical validation lands before the Ideal-already-
  satisfied early exit is enabled
- `maxSkillAdvance` caps Reset Skills at M for both existing-Gogma routes
  (advance 0..M) and conversion routes (advance 1..M+1)
- Target Ideal-implies-Practical containment, added with Target validation
- Null transient sources for post-conversion Reset Bonuses, Keep Bonuses, and
  Reset Skills
- BuildCandidate / BuildListEntry separation
- Stale hash behavior
- OwnedWeapon protection
- Beam Search behavior
- `PlannerInput.options` reaching `termination.limits` unchanged, with no module
  default substituted
- A truncated search reporting `incomplete` plus its `reachedLimits`, and never
  contradicting the diagnostic warning it also produced
- A completed search that touched a bound staying `completed` with a non-empty
  `reachedLimits`, and still saving and navigating
- Cancellation reporting `cancelled`, and an input that never reached the Beam
  Search reporting `exhausted` with an empty `reachedLimits`
- Typed termination surviving Domain -> Production Plan generation ->
  orchestration -> Worker -> Worker Client without being rebuilt from a warning
- An `incomplete` result's partial Plan never persisted as an executable Draft,
  its generated Entries never persisted alone, and no navigation to the Plan
- A version 2, 3, or 4 ProductionPlan reported as incompatible under version 5 with
  `calculation_context_changed`, and a version 5 one reported as compatible
- Version 2, 3, and 4 BuildCandidate / BuildListEntry compatible under version 5,
  version 1 incompatible, and the build-result exception never reaching a
  ProductionPlan or a future version
- A Candidate Search request covering exactly one Target, refusing a disabled or
  non-containing Target with a notice instead of a Candidate, and still applying
  `routeFilter`
- `resultFilter`, `similarityThreshold` and `maxCandidatesPerTarget` being absent
- One canonical Ideal Candidate when an Ideal is in range, none when it is not,
  and none when only a compromise state is reachable
- Intermediate states extracted per lane from the canonical Ideal Route only,
  never a compromise state that branches off it; a Practical Skill and a
  Practical Bonus each offered on their own lane so Practical + Practical is
  reachable; the conversion-assigned and existing-Gogma current Skill offered as
  a Skill Reset 0 state; an existing Gogma's current Gogma-scope slots offered as
  a Bonus lane start; a normal-scope five-slot set right after conversion never
  offered; the lane end never offered as an intermediate state
- Intermediate state extraction adding no RNG prediction call and never moving the
  canonical Ideal selection
- Two slot orders of one Bonus multiset grouping together while each opportunity
  keeps its exact slot order, both arrivals at one state being retained, the
  earliest being the representative, conservative display dominance marking a
  Bonus group secondary without removing any Domain group or opportunity, and
  differing Bonus Type compositions never being ranked against each other
- Selection starting empty with `improvementPreference = 'planner'`, accepting one
  opportunity per lane, rejecting an id of the other lane, an unknown id and an
  unknown preference, accepting both lane starts at once, leaving the BuildListEntry
  un-staled, moving the Plan's build-list hash, surviving a re-add of the same
  Candidate, and being editable in the Build List without a re-search
- A selected lane endpoint never being silently fast-forwarded while an
  unselected intermediate unit and a fully overwritten prefix unit still are, the
  "immediately following operation" judged within one lane
- Skill-only, Bonus-only and both-lane selections each producing a milestone at
  the moment both pins hold (selected Skill + Ideal Bonus, Ideal Skill + selected
  Bonus, selected + selected), Ideal + Ideal producing no milestone, a lane never
  passing its pin before the other lane arrived, and both a Skill-first and a
  Bonus-first continuation after the checkpoint being reachable
- The exact selected state actually holding under Trace Replay
  (`checkpoint_state_mismatch` otherwise), the Planner never deselecting or
  substituting an opportunity, two incompatible selections on one Counter
  becoming a conflict that a Build List change resolves, one shared physical
  action reaching both without duplicating the operation, and an Entry with no
  selection keeping its ordinary Ideal Route meaning
- `skill_first` / `bonus_first` steering the order when both lanes are equally
  feasible, the Planner still completing every Target by running the other lane
  first when the preferred lane cannot run now, and also when the preferred lane
  can run now but would break another Target later (violation count above zero),
  `planner` completing a scenario only a Skill-first order can finish, and
  `comparePlannerSearchStates()` ranking the violation count below
  `evaluationScore` and the preferred source and above `weaponSwitchCount`
- An existing Gogma holding a Practical Skill with Ideal slots (Skill lane start
  selected), an Ideal Skill with compromise slots (Bonus lane start selected), or
  a compromise on both lanes (both starts selected) validating, being reached at
  Planner start, carrying no milestone Step, and still finishing at the Ideal,
  while a conversion Route's Skill lane start is not held before the conversion
- Several Targets sharing the Skill and Gogma Counters interleaved into one global
  physical sequence that respects each Entry's per-lane dependency order, with no
  synthetic Cartesian product and unchanged prediction call-count contracts
- `practicalFirstProgressTargetIds` and `CandidateScore.categoryScore` being absent
- `hasPractical` alone producing no `CandidateScore` difference at equal priority
  and cost, a higher-priority Ideal-unmet Target never overtaken by a
  lower-priority uncovered one on `hasPractical` alone, Beam pruning ordering
  unchanged whichever Target holds the compromise weapon, and a selected
  checkpoint kept through `PlannerCheckpointRequirements` rather than any score
- An unknown opportunity id and an id of the other lane each failing the
  Planner input closed before any Beam Search,
  never read as an empty selection and never bypassed through a selection-free
  Entry of the same Target, while a well-formed selection and a selection-free
  Entry keep working
- A selection-holding Entry never bypassed by a cheaper selection-free Entry of
  the same Target, staying relevant after another weapon made its Target Ideal,
  completing only once it reached its checkpoint and secured its Ideal, the typed
  termination counting that Target complete only then, two selection-holding
  Entries of one Target failing closed without picking either, selection-free
  same-Target Entries keeping the ordinary candidate selection, an already-Ideal
  Target with a selection failing closed, and a conflict reached through a
  selection-free Entry still blocking that Target's constrained re-search and
  what-if
- Checkpoints adding no `PlanStepOperationType`, riding as milestones on the real
  physical Step, leaving later Steps in place, and reserving nothing; Planner
  calculation changes no status or protection, Execution applies only the
  `practical` label at the milestone Step, and the final Ideal applies the completion
  semantics (`ideal`, protected, Target `completed`)
- A starting OwnedWeapon whose current state satisfies a compromise condition
  offered only as a lane start of its own Route (never as a checkpoint on its
  own), `hasPractical` still judged from actual performance, and
  `OwnedWeaponStatus.practical` still present
- Schema 10 artifacts failing closed under schema 11, current-schema intermediate
  state shape validated strictly, a historical artifact with no
  `intermediateStateGroups` field still validating and rendering, and
  `ExportRoot.schemaVersion = 6`
- Build List detail settings showing 「最大計画ステップ数」 alone (no 「最大探索状態数」, no
  「Beam幅」), starting at `defaultPlannerOptions` (1000), sending the user-selected
  `maxPlanSteps` as `PlannerInput.options`, restoring the default, and refusing `0`,
  a negative number, a fraction, and an empty field
- The Production scheduler never stopping at `maxExpandedStates` (even 1) and never
  reporting `max_expanded_states`, stopping at `maxPlanSteps = 1` as `incomplete`,
  and completing `representative-12` / `representative-35` (330 / 398 actions) under
  the 1000 default while the Beam oracle still stops at `maxExpandedStates`
- No Production running state showing an `expandedStates / maxExpandedStates` ratio
  or 「探索状態数」, and Cancel kept
- The real user case of one 23-operation Bonus Route plus one 148-operation
  Bonus + 82-operation Skill Route reporting `incomplete` with a 24-step partial
  under the Beam oracle's `maxExpandedStates = 10000` bound, and producing the
  232-step complete Plan once `maxExpandedStates` is raised
- Silent fast-forward: a skippable past unit advances Route progress only, with
  no Search Action, trace entry, progressed Entry / Target record, inventory
  effect, or route runtime output, while a required past unit fails closed
- Skip derivation: Reset then Reset, Keep then Reset, Keep then Keep, and Reset
  Skills then Reset Skills are skippable; the Reset a Keep reads, a Route's
  final unit, create, and conversion are not
- A required unit and a skippable unit at the same Counter position are not a
  conflict, two required units still are, and a fast-forwarded prefix never
  returns to conflict detection
- A skippable unit that would consume a Counter position an executable required
  unit needs is never expanded, and that pruning records no rejection, while a
  position whose competing units are all skippable keeps both orders available
- Two Targets sharing one Gogma Counter stream both reach Ideal, with only the
  Route prefix that was not passed by another Entry becoming PlanSteps
- Consecutive operations on one OwnedWeapon count no weapon switch, a different
  weapon counts one, and returning to the first counts two
- `reserve_weapon` changes neither the switch count nor the previous subject, a
  silent fast-forward adds no switch, and one shared physical action is counted
  once instead of once per progressed Entry
- One Entry's consecutive transient Gogma operations add no switch, while
  another Entry's transient Gogma is a different subject
- `comparePlannerSearchStates()` keeps Ideal progress and
  `evaluationScore` above the switch count, applies the switch count only when
  both tie, and falls through to the existing stable tie-breaks when switch
  counts tie too
- Where the split of shared Counter positions is rated equally by the existing
  evaluation, the Trace and ProductionPlan global execution order the Beam
  Search actually selected is the one-switch order, verified on that real order
  rather than on a conveniently re-sorted Step array
- Inventory simulation
- Expected state Before/After invalidation
- A status-only change leaving `referencedOwnedWeaponsHash`,
  `ExpectedPlanState.ownedWeaponsHash`, and the constrained search identity
  unchanged, and never reporting `owned_weapon_changed`, while a protection,
  Bonus, Skill, scope, kind, weapon type, or element change still moves them
- `OwnedWeaponStatus` being exactly `unclassified | practical | ideal`, a new
  Gogma draft defaulting to unclassified and unprotected, and a status-only edit
  of an existing weapon leaving protection untouched
- The Owned Weapons UI offering 未分類 / 実用 / 理想 and never 素材
- The v3 -> v4 migration converting only `material`, keeping protection and
  `preferredOwnedWeaponId`, and rewriting no historical calculation artifact
- `use_weapon_as_material`, `canUseAsMaterial`, `canConsumeMaterialWeapon`,
  `consumeMaterialWeapon`, `consumedMaterialWeaponCount`, `resourcePenalty`,
  `PlannerMaterialRequirement`, `PlannerMaterialAssignment`,
  `material_weapon_shortage`, `create_material_gogma`, and
  `change_owned_weapon_status` all being absent, with Domain validation rejecting
  a PlanStep or ExecutionHistory that still names one
- Owned Normal conversion still consuming its source exactly once, and the same
  owned Normal never being usable twice
- Target Satisfaction ignoring status, so an unclassified Gogma still satisfies a
  Target on actual performance, and an unprotected compatible one is still
  selectable as `preferredOwnedWeaponId`
- Item `MaterialRequirement` and its Master infrastructure staying intact
- Atomic Execution transactions
- Undo snapshot restoration
- Worker request/response/cancellation behavior
- `defaultCandidateSearchSettings` equals `recommendedCandidateSearchDefaults` (`350 / 500 / 1500`); the
  Search page starts from the saved `AppSettings.candidateSearchDefaults`, uses a screen edit for its
  single and batch searches only and never writes it back
- A Target reports progress at its start, reports activity before it completes,
  restarts `processedWorkItems` per Target, and ends at
  `completedTargets === totalTargets`
- Candidate results are identical with and without a progress callback
- The forced Reset Normal Artian notice is `severity: 'info'` with Japanese text
  that contains no internal reason enum and no English Domain term, and a
  confirmed Counter with unavailable Normal prediction never reports the Counter
  as unconfirmed
- A genuine capability or Target-definition warning keeps `severity: 'warning'`
- The Search page renders info notices under お知らせ and warnings under 警告, in
  separate Alerts when both are present
- One `reset_skills` records its predicted Series / Group, several consecutive
  ones each keep their own result without shifting by one, and the last entry
  equals the Candidate's final Skills
- A Candidate with no `reset_skills` records `skillAmendmentTrace = []`, and a
  pre-field Candidate with `undefined` validates, renders, and shows no invented
  prediction
- `skillAmendmentTrace` and `bonusAmendmentTrace` bind to disjoint, correct
  `operationIndex` values in one mixed Route
- A `reset_skills` count that disagrees with the predicted result count fails
  loudly instead of padding or truncating
- Adding, removing, or altering `skillAmendmentTrace` changes no Candidate ID,
  `candidateStableKey`, deduplication key, meaning fingerprint, `searchStateHash`,
  or `referencedOwnedWeaponsHash`
- A conversion Route records its Reset Skills the same way an existing-Gogma
  Route does, and never reports the conversion itself as a Reset Skills result
- A conversion-only Route records `conversionSkillTrace` at its conversion
  operation index, and that record equals the Candidate final Skills only
  because no Reset Skills follows
- A conversion followed by `reset_skills` keeps the conversion record distinct
  from the Candidate final Skills, and the two traces bind to disjoint
  operation indexes alongside `bonusAmendmentTrace`
- The blind Normal Artian route, the predicted Normal Artian route, and the
  owned Normal Artian route all record the conversion Skill, while an
  existing-Gogma Candidate records none
- A Search-generated conversion Candidate predicts each Skill Counter position
  once; the record adds no `predictSkills` call
- Adding, removing, or altering `conversionSkillTrace` changes no Candidate ID,
  `candidateStableKey`, deduplication key, meaning fingerprint,
  `searchStateHash`, or `referencedOwnedWeaponsHash`
- A pre-field conversion Candidate validates and renders with the operation name
  only, and the card adds no legacy note for the missing conversion record
- A record pointing at a non-conversion operation, and a record on a Route with
  no conversion, are both Domain validation issues
- Native Worker `error` and `messageerror` reject every pending search, remove
  every listener, terminate the Worker, and make later searches reject, while
  the Worker protocol `type: 'error'` response keeps its existing behavior
- No skip reason or label presents normal-scope Keep as unsupported or as a game
  rule requiring a Reset first, and `no_owned_weapon_available` reads naturally
  for Normal and Gogma source routes
- `TargetWeapon.preferredOwnedWeaponId` accepts null, and the v2 -> v3 migration
  sets it to null for every Target, removes `relatedTargetWeaponIds` from every
  current OwnedWeapon, never infers a preference from the removed list, and
  rewrites no BuildCandidate, BuildListEntry, ProductionPlan, or ExecutionHistory
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION = 14`, schema 1..13 ProductionPlans (Draft and
  active) failing closed under 14 and a schema 13 active Plan never executed, rewritten or
  stale-migrated, schema 12 / 13 Candidates / BuildListEntries staying usable under 14
  through the explicit `14 -> [12, 13]` exception only while the other CalculationContext
  fields match, schema 1..11 build results incompatible, and a future schema never
  inheriting the exception
- Production Plan generation, the Planner Worker, B8, B9 and the replan Preview running the
  deterministic scheduler with no injection and no strategy flag, and `beamWidth` never
  changing a Production result
- `DATABASE_SCHEMA_VERSION = 9`, `ExportRoot.schemaVersion = 12`, `AppSettings.schemaVersion = 2` (Dexie v8 -> v9
  and Export 11 -> 12 filling the recommended `350 / 500 / 1500` into an AppSettings v1 record and keeping its
  other fields), `RngState.schemaVersion = 2`,
  historically `CURRENT_CALCULATION_APP_SCHEMA_VERSION = 13` with schema 1..12 ProductionPlans and
  schema 1..11 Candidates / BuildListEntries failing closed under version 13, schema 12
  Candidates / BuildListEntries staying usable under 13 through the explicit build-result
  exception only while the other CalculationContext fields match, a schema 7 Export migrating to 8 with its Plans untouched, a
  schema 8 Export migrating to 9 only when it holds no terminal Plan and no
  ExecutionHistory, a schema 9 Export migrating to 10 with `lastIdentifiedAt = null` in every
  RngState / Normal Counter body and a schema 9 body already carrying it refused, a schema 10
  Export migrating to 11 with every `draft` Plan deleted (none chosen by `createdAt`,
  `updatedAt` or ID) and every other Plan, Entry and collection untouched, a schema 11 Export
  keeping its one Draft, and no other version authority changed
- The Dexie v7 -> v8 upgrade deleting every `draft` ProductionPlan of a legacy database
  (three Drafts beside an active, a completed and an abandoned Plan) while keeping every
  other Plan body, the BuildListEntry a Draft referenced, and every other collection exactly
- `ProductionPlanRepository` adding a first Draft, refusing a second different Draft through
  `add` and `put` (`draft_plan_conflict`), allowing a `put` of the same Draft ID, accepting a
  Draft beside an active Plan, and keeping the running-Plan invariant unchanged
- `savePlannerOrchestrationResult()` replacing the previous Draft (and every accumulated
  legacy Draft) with the new one and its generated Entries in one transaction, keeping the
  previous Draft with no new Plan and no partial Entry when the save-time validation refuses
  the result, when a generated Entry write fails or when the new Plan write fails, keeping
  `completed` / `abandoned` Plans, keeping the previous Draft on a `plan === null` result, and
  never cascading the Entries the previous Draft referenced
- The reported Export failure: a `draft` Plan whose `selectedBuildListEntryIds` and every
  Step `buildListEntryId` name a Build List Entry absent from the current collection is
  accepted by `validateExportRootForFullReplacement()` and exported by `exportRoot()`, while
  an `active` Plan with the same missing references is still refused with
  `invalid_reference` and the database is left unchanged
- A `draft` / `stale` / `completed` / `abandoned` Plan body's missing Entry or dependent
  Target references never refusing Import / Export, an `active` one's still refusing, the
  Plan body's own Domain validation still applying whatever the lifecycle, a schema 11 backup
  holding one divergent Draft importing with the Draft kept (its start left to the runtime),
  and two top-level Drafts refused with `invalid_state` while one Draft beside an active or
  stale Plan is accepted
- A stale top-level Plan whose game save point snapshot names a missing selected Entry,
  OwnedWeapon or Plan-dependent Target, or a non-active snapshot Plan, still refused
- `RngState.lastIdentifiedAt` written only by the Identification adoption and kept through a
  notes-only / Counter Gate / value save, `NormalArtianCounter.lastIdentifiedAt` written only by
  the Normal Counter Identification confirmation and reset by a save that changes the value,
  neither entering `searchStateHash` or `ExpectedPlanState`, and the Dexie v6 -> v7 upgrade
  filling `null` (RngState record schema 2) in the tables, the save point snapshots and the
  Undo snapshots without inferring an adoption time
- After an abandonment, an unresolved Normal creation divergence keeps asking for the Normal
  Counters (never resolved by another weapon type's Counter, a manual / Debug save, an
  unconfirmed record or the RNG adoption) and an unresolved Gogma / Skill divergence keeps
  asking for RNG Setup (never resolved by a notes-only save or a manual Counter edit, resolved
  by `IdentificationAdoptionService.adopt()` and kept resolved by a later notes-only save,
  un-resolved again by a manual edit of an adopted value); a save point restore that deleted
  the record shows nothing
- Collection validation rejects a missing preferred weapon, a weapon type or element
  mismatch, a protected weapon, and the same weapon preferred by two Targets, and
  accepts a compatible unprotected Normal, a compatible unprotected Gogma at every
  status, and no preference at all
- The Target dropdown lists compatible Normal and Gogma weapons, shows a protected
  one as unselectable, marks one another Target already prefers, orders current /
  unassigned / assigned-elsewhere / protected, offers 指定なし, confirms a takeover,
  changes nothing on cancel, saves old Target null plus new Target weapon on
  approval, and drops a preference the Target's own weapon type or element change
  made incompatible from the draft alone
- The Owned Weapons screen has no related-Target editing UI, confirms before
  protecting a preferred weapon, changes neither weapon nor Target on cancel, saves
  protection plus the Target unlink on approval, and its ReferenceFinder blocks
  deleting an OwnedWeapon a Target prefers
- Both atomic paths persist no intermediate state: a failed reassignment leaves the
  original Target holding the weapon and the new one holding none
- An equal-cost equal-quality Ideal picks the preferred source as the canonical
  Ideal, a shorter non-preferred Route still wins, non-preferred routes are searched
  as usual, and a preference widens or narrows no search horizon and adds no RNG
  prediction call
- A fully tied bounded Practical selection orders the preferred source first, and no
  Candidate ID, stable key, deduplication key, or meaning fingerprint carries the
  preference
- The constrained enumerator's streaming `visitConstrainedCandidates()` delivery
  order puts a fully tied preferred source first, flips when the preference
  flips, still delivers a cheaper non-preferred Route first, keeps the existing
  stable order when no preference is set, and changes neither the enumerated set
  nor the examined-pair and off-axis counts
- Planner constrained re-search trials and adopts the preferred source when both
  sources are equally adoptable, and adopts the other one when the preference
  points at it instead, proving the rule reaches the Production streaming path
  rather than only the collected result's sort
- The Beam Search oracle prefers a preferred-source Route when the existing evaluation
  ties, prefers the non-preferred one when the existing evaluation rates it higher, ranks
  the preference above `weaponSwitchCount` and below Target priority, satisfaction,
  category, cost, and conflict, works for owned Normal and existing Gogma routes,
  never treats a new-Normal route as preferred; the Production scheduler never reads the
  preferred source; and no Planner calculation or `reserve_weapon` changes a Target
  preference
- Changing only `preferredOwnedWeaponId`, `priority`, `isEnabled`, or lifecycle leaves
  `createTargetDefinitionHash()` and BuildListEntry staleness unchanged, while
  `targetWeaponsHash` still reflects each of them, and a Plan-dependent Target's
  `priority` / `isEnabled` change moves `dependentTargetDefinitionsHash`
- Execution Step confirmation persists each Step's `rngAdvance` immediately and
  persists nothing for unconfirmed Steps; an interrupted Plan stays `active` and
  resumes at `currentStepId`
- A new Normal Route registers only its production-target Normal (never a
  Counter-advance Normal), an owned Normal's conversion keeps its OwnedWeapon ID,
  and an existing Gogma is updated in place Step by Step
- A blind production-target Normal cannot be confirmed without user-entered observed
  slots, no slots are fabricated, and the binding token matches only the recorded
  observation
- The Plan start links each existing weapon a selected Entry starts from to its Target
  and clears another Target's link in the same transaction as `draft -> active`, the
  first Step then confirms from that state, the Production Plan screen previews only the
  real changes, a refused or failed start changes neither the Plan nor any link, a
  production-target Normal is linked only by its registration Step, a shared weapon is
  linked for nobody, and Plan generation changes no preference
- A reached selected compromise checkpoint labels the weapon `practical` without
  touching protection; finishing as a compromise abandons the Plan with the Target
  still `active` and its preference kept; a performance-only match never relabels
- Ideal completion rides on the last physical Step (no separate reserve Step) and
  sets `ideal`, protection on for new and existing weapons, in-progress off, Target
  `completed`, preference cleared; `confirm_owned_ideal` advances no Counter
- Every Ideal completion path clears the preference of all other Targets preferring the
  completed weapon in the same transaction, changes nothing else on them, and Undo
  restores them
- Weapon switch guidance is derived for A -> B -> A without any PlanStep,
  ExecutionHistory, Counter, cost, or `maxPlanSteps` effect
- Adding a Target or a BuildListEntry, or changing a Plan-independent one, never
  stales the Active Plan; a Plan-dependent change does, and a UI-initiated breaking
  change warns first and abandons with `breaking_change_approved` atomically
- Replan Preview changes nothing; adoption re-validates the Preview-start state,
  refuses on any change, and atomically abandons the old Plan (`replan_adopted`) and
  activates the new one while keeping the old ExecutionHistory
- The game save point is recorded only explicitly, restores only execution-scope
  state, refuses a restore with no write at all when an entity the restored Plan needs
  is missing (a Plan-independent Target missing is not a refusal), offers keep / restore / cancel on Plan-abandoning actions only when Steps
  were confirmed after it, and is never carried to a replanned Plan
- An unexpected result applies the Counter consumption and actual result and stales
  the Plan; an uncertain operation changes no state and stales the Plan
- Current Position Recovery derives the Recovery Window by operation, tracked weapon and
  Counter stream (Keep advances the Gogma Counter too), never crosses a Counter-advance /
  production-target Normal boundary, never searches outside the Window, follows only a
  unique position (position 0 included), asks for one more Plan operation only when every
  candidate's next Step is inside the Window, replays Execution effects exactly like
  `confirmed_expected`, keeps the save point unless the Plan completes, records one
  `operation_count_recovered`, is undoable back to the stale state, and refuses a changed
  record, Step, position, dependency, context, or an extra stale reason with no write
- The "after the running Plan completes" Search origin replays stored Steps without
  prediction or persistence and cannot add to the Build List; `completed` Targets are
  excluded from Search and Planner input
- Undo restores RngState, all Normal Counters, OwnedWeapons (status and in-progress
  included), changed Targets, the ProductionPlan, and the save point, and is refused
  for Plans abandoned by replan adoption, user abandonment, or an approved breaking
  change
- Export/import validation
- Mobile UI flows where applicable

Before considering a coding task complete, run the project's applicable quality checks.

Current standard checks are:

```bash
npm run lint
npm test
npm run build
```

If a dedicated type-check command is added, run it as well.

---

## Change Discipline

Keep each coding task focused.

Before editing, inspect the current working tree. When work may have been started by
the project owner or another coding agent, follow `docs/AI_DEVELOPMENT_WORKFLOW.md`
and preserve pre-existing changes unless the project owner explicitly authorizes
discarding them.

Do not use destructive Git operations to erase existing work without explicit approval.

Do not refactor unrelated areas unless required for the task.

Do not perform architecture rewrites without specification support.

Do not silently change a documented domain contract.

When the implementation reveals a genuine specification gap:

1. Stop only the affected behavior
2. Identify the exact specification gap
3. Report it clearly
4. Do not guess the missing game/product rule
5. Continue unaffected work when possible

Prefer small, testable changes over broad rewrites.

---

## Completion Report

After a coding task, report:

- What changed
- Which specification files were followed
- Files added or modified
- Tests added or modified
- Commands executed
- Lint/test/build result
- Remaining limitations
- Any RNG/Keep/Lottery behavior still unverified

Keep the report concise and factual.

---

## Definition of Done

A task is complete only when its requested scope is implemented and:

- TypeScript compiles without errors
- `npm run lint` passes
- `npm test` passes
- `npm run build` passes
- Relevant tests cover new or changed logic
- Domain invariants remain valid
- Persistence/reference integrity is preserved
- No unrelated feature was added
- No unverified RNG behavior was silently invented
- GitHub Pages compatibility is preserved
- The implementation remains within the frozen v1 specifications

If real game behavior is not yet game-verified, completion means the typed boundary, validation, Fake Engine/fixtures, and integration contract are correct. It does not mean the production RNG algorithm is proven for every supported game condition.
