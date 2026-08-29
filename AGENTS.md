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
3. Existing implementation and tests

The current specification set is frozen as the initial-release v1 baseline.

If documents conflict, or the requested implementation would change a documented domain contract:

1. Identify the conflicting or affected specification
2. Report the mismatch
3. Do not silently choose a new interpretation
4. Update the specification or obtain an explicit decision before changing domain meaning

Do not invent missing game mechanics or product requirements.

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
- Practical-versus-Practical quality ranking for automatic materialization
- Route-local references to newly generated weapons
- Keep Bonuses applied to the newly converted Gogma weapon inside the same `normal_artian_to_gogma` route

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

If production RNG behavior is not verified:

1. Define typed interfaces
2. Define validation
3. Implement fixture-based Fake Engine behavior where needed
4. Keep production and fake engines replaceable
5. Keep fake behavior separated by an explicit feature flag
6. Show the active engine in Debug Mode where specified
7. Replace fake fixtures with verified production fixtures only when real behavior is known

Never make production behavior depend on guessed:

- Lottery weights
- Internal Lottery values
- Counter advancement
- Counter Gate behavior
- Keep Bonuses behavior
- Seed behavior
- Other unverified game mechanics

`LotteryMaster` is provisional.

Do not force verified RNG behavior to fit the provisional `LotteryMaster` schema. If real analysis requires a different representation, update the specification before changing the production model.

---

## Partial RNG State and Capabilities

RNG state is not all-or-nothing.

Base Seed, Gogma Counter, Skill Counter, and Counter Gate are independent `KnownValue<T>` fields.

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

For `referencedOwnedWeaponsHash`, preserve the stored five-slot order because Keep slot semantics remain unresolved.

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
- Related target references
- Memo and timestamps as specified

A normal Artian weapon:

- Is always rarity 8 in v1
- Uses five `normal_artian` scope restoration bonuses
- Has no Series Skill
- Has no Group Skill
- Has no Material / Practical / Ideal status
- Retains an independent protection state
- Defaults to unprotected when newly registered
- Must not be used by an automatic Gogma-conversion route while protected

A Gogma Artian weapon:

- Uses five `gogma_artian` scope restoration bonuses
- Retains Series Skill and Group Skill
- Retains Material / Practical / Ideal status
- Retains protection independently from status

Statuses are:

```text
material
practical
ideal
```

Status and protection are separate concepts.

Defaults:

- Practical: protected
- Ideal: protected
- Material: unprotected

Protected weapons must not be used by the Planner for:

- Material consumption
- Reset Bonuses
- Keep Bonuses

Reset Skills is treated as non-destructive in v1.

A protected Practical or Ideal weapon may be the source of an `existing_gogma_reset_skills` route.

The Planner must never silently remove protection.

---

## Old Practical Weapon Materialization

Do not automatically convert a Practical weapon to Material.

In v1, the Planner may schedule a confirmation-required:

```text
change_owned_weapon_status
```

step for an old Practical weapon only when:

- The same Target already has an Ideal weapon, or
- The same Plan secures that Target's Ideal weapon in an earlier step
- Another weapon continues to satisfy that Target as Ideal after materialization
- A later material-consumption step actually needs the old weapon

The status-change step must occur before material consumption.

If the user confirms:

```text
status = material
isProtected = false
```

must be applied together.

If the user chooses to keep the weapon:

- Do not change status
- Do not change protection
- Record `planned_status_change_declined`
- Mark the Plan stale and require recalculation

Do not infer "better Practical".

Obtaining another Practical weapon alone must never trigger automatic materialization of the previous Practical weapon in v1.

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

A Target separately defines:

- Ideal five-bonus configuration
- Practical bonus conditions
- Practical alternative groups
- Ideal skill condition
- Practical skill condition

Do not introduce "any one target in this group completes the group" behavior in v1.

---

## Candidate Categories and Similarity

Candidate categories are only:

```text
ideal
practical
```

Similarity is not a third category.

`isSimilarToIdeal` and `similarityScore` are attributes of Practical candidates.

Rules:

- Ideal candidates take category precedence over Practical
- Ideal candidates are not duplicated in the Similar filter
- Candidates below the Practical line are normally not persisted/displayed in v1
- Target relaxation may be suggested, but must never be applied without explicit user action

Do not create an ambiguous "similar" category.

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

### `searchStateHash`

Hash only route-dependent RNG state.

Include, when relevant:

- Base Seed value and confirmation state
- Gogma Counter value and confirmation state
- Skill Counter value and confirmation state
- Counter Gate value and confirmation state
- Relevant Normal Artian counter value and confirmation state

Exclude non-semantic fields such as:

- RNG source
- Notes
- Observation timestamps
- Display-only fields

For v1, if the route-dependent RNG hash changes, use the safe behavior:

```text
rng_state_changed
```

### `referencedOwnedWeaponsHash`

Hash only OwnedWeapons actually referenced by the route.

Collect references from:

- `BuildRoute.sourceOwnedWeaponId`
- Reset Bonuses source
- Keep Bonuses source
- Non-null Reset Skills source
- Material-consumption operations

Deduplicate and stably sort IDs.

Include semantic weapon data such as:

- ID
- Kind
- Weapon type
- Element
- Stored restoration bonus slots
- Protection

For Gogma Artian weapons, also include:

- Series skill
- Group skill
- Status

Exclude:

- Name
- Memo
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

### Normal Artian Route

Route kind:

```text
normal_artian_to_gogma
```

v1 searches only rarity-8 normal Artian weapons. If the required weapon-type rarity-8 Normal Artian counter is unknown, skip only this route.

v1 operation sequence may contain:

- `create_normal_artian`
- `convert_normal_to_gogma`
- Required `reset_skills`

It must not contain:

- `keep_bonuses`

For this route:

```text
BuildRoute.sourceOwnedWeaponId = null
```

If Reset Skills is performed immediately after conversion, its:

```text
sourceOwnedWeaponId = null
```

because the route output is not yet a persisted OwnedWeapon.

Do not invent an OwnedWeapon ID for the just-created route output.

After the weapon is secured and registered as an OwnedWeapon, a later search may use it as an existing-Gogma Keep Bonuses source.

Do not add a route-output weapon reference type in v1.

### Owned Normal Artian Route

Route kind:

```text
owned_normal_artian_to_gogma
```

The source must be an unprotected owned rarity-8 normal Artian weapon whose weapon type and element are compatible with the Target. Rarity 6 and 7 normal Artian weapons are out of scope and must not be registered or searched in v1.

The operation sequence may contain only:

- `convert_normal_to_gogma`
- Optional `reset_skills`

It must not contain:

- `create_normal_artian`
- `keep_bonuses`

`BuildRoute.sourceOwnedWeaponId` is the source normal Artian weapon ID. A Reset Skills operation performed immediately after conversion uses `sourceOwnedWeaponId = null` because the converted route output is not yet registered as a separate OwnedWeapon.

The conversion result must come from the RNG Engine. Bonus Type mapping must not be used to infer the resulting ranks or completed Gogma bonus set.

### Existing Gogma Reset Bonuses

Route kind:

```text
existing_gogma_reset_bonuses
```

The source must be unprotected.

Do not generate this destructive route from a protected weapon.

### Existing Gogma Keep Bonuses

Route kind:

```text
existing_gogma_keep_bonuses
```

The source must be unprotected.

Keep selection and final result must come from the RNG Engine contract.

Search code must not infer:

- Slot subset behavior
- Rank preservation
- Remaining-slot behavior
- Final kept bonuses

If Keep prediction is unsupported, do not generate production Keep routes.

### Existing Gogma Reset Skills

Route kind:

```text
existing_gogma_reset_skills
```

This route:

- Uses an existing OwnedWeapon
- Keeps the source weapon's restoration bonus set unchanged
- Changes only predicted series/group skills
- Advances only Skill RNG as defined by the Engine
- Uses a non-null source OwnedWeapon ID
- May use protected Practical or Ideal weapons in v1

It does not require Gogma prediction or Keep prediction.

Its `referencedOwnedWeaponsHash` must include the source weapon.

### Existing Gogma Mixed

Route kind:

```text
existing_gogma_mixed
```

If the route includes Reset Bonuses or Keep Bonuses, the source must be unprotected.

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
replace the concrete OwnedWeapon ID in a Candidate-derived
`UseWeaponAsMaterialOperation`. Planner-only replenishment, registration,
material consumption, reservation, and confirmed status changes are separate
PlanSteps.

Target satisfaction is derived only from owned Gogma Artian weapons. Owned
normal Artian weapons are inventory/conversion resources and never satisfy a
Target. For Gogma weapons, do not use `status` alone: evaluate the actual
restoration bonus and series/group skill conditions with the Target evaluation
engine. `hasPractical`, `hasIdeal`, and their OwnedWeapon ID lists all follow
this rule.

---

## Planner Search Strategy

v1 uses bounded Beam Search.

Default constants:

```text
beamWidth = 50
maxExpandedStates = 10000
maxPlanSteps = 300
```

These three positive integers are the complete v1 `PlannerOptions` contract.
Practical-before-Ideal behavior is fixed by v1 priority rules; do not add or
retain `preferPracticalBeforeIdeal`.

Do not replace Beam Search with a simple Candidate sort.

Planner search state must distinguish target satisfaction:

```text
hasPractical
hasIdeal
```

Rules:

- Practical candidate -> `hasPractical = true`
- Ideal candidate -> `hasPractical = true`, `hasIdeal = true`
- A Practical-secured but non-Ideal target remains eligible for Ideal improvement
- A target that already has Ideal is normally removed from further planning

Planning priority:

1. Obtain Practical weapons for uncovered targets early
2. Exploit shared RNG progression to obtain useful results for other targets
3. Upgrade Practical targets to Ideal
4. Reduce weapon consumption and operation count among otherwise similar states

Complete optimality is not required.

Respect search bounds and return the best state available within the limits.

---

## Planner Inventory Rules

Planner inventory is strict for both owned rarity-8 normal Artian and Gogma Artian weapon resources. Rarity 6 and 7 normal Artian weapons are not v1 inventory entities.

When an owned normal Artian weapon is converted to Gogma, the source normal weapon is consumed from inventory and a Gogma weapon is generated. The same normal weapon must not be reused by multiple routes. Protected normal weapons are never automatic conversion sources.

For `owned_normal_artian_to_gogma`, consume and remove the source Normal at the
`convert_normal_to_gogma` Step. The converted Gogma remains an unregistered
route output through any `reset_skills(sourceOwnedWeaponId = null)` Step.
`reserve_weapon` later adds a new Gogma ID and must not remove the Normal again,
reuse its ID, assign a future ID at conversion time, or add a route-local weapon
reference.

Material items are not a hard inventory constraint in v1; display required quantities instead.

Material weapon consumption is allowed only when:

```text
status = material
AND
isProtected = false
```

Protected weapons are never used for:

- Material consumption
- Reset Bonuses
- Keep Bonuses

Reset Skills remains allowed on protected weapons.

If a material Gogma weapon is required but unavailable, the Planner may schedule replenishment:

```text
create normal Artian
-> convert to Gogma
-> create_material_gogma
-> consume later
```

`create_material_gogma` is a Planner-only registration PlanStep, not a
`RouteOperation` and not an additional RNG draw. It registers the already
created predicted/observed Gogma weapon as `kind = gogma`,
`status = material`, and `isProtected = false`, with zero RNG advancement.
The Planner may reserve the future OwnedWeapon ID when constructing the Plan so
the later material-consumption Step can reference the same weapon. Do not write
that weapon to IndexedDB before the registration Step is confirmed, and do not
put the future ID into a BuildRoute.

All RNG effects of replenishment must be included in simulation.

Do not reuse a consumed weapon.

Planner-only general Gogma material demand is separate from Candidate
RouteOperations and must not add guessed weapon type, element, bonus, or cost
constraints. Assign an available Material/unprotected Gogma; if none exists,
replenish and reserve a future OwnedWeapon ID inside ProductionPlan only. The ID
must not enter BuildRoute or IndexedDB before `create_material_gogma` succeeds.

`reserve_weapon` has Route-specific inventory semantics:

- `normal_artian_to_gogma`: add a new protected Gogma with a reserved ID
- `owned_normal_artian_to_gogma`: add a new protected Gogma with a different
  reserved ID; its source Normal was already consumed by the conversion Step
- `existing_gogma_*`: update the same source Gogma ID, do not add a new weapon

The secured weapon uses Candidate result bonuses and skills, has status Ideal or
Practical from the Candidate category, and includes the Target ID once without
dropping existing Target references. Target satisfaction changes only when the
weapon is reserved, not merely when an RNG operation is simulated or confirmed.

---

## Conflict Rules

Planner conflicts and rejection records use `BuildListEntryId`, not volatile Candidate IDs.

Conflict kinds follow `DATA_MODEL.md`.

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
maxPlanSteps bound; `max_expanded_states_reached` reports only the
maxExpandedStates bound. A best partial Plan may be returned with either warning.

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

Normal planned changes must not invalidate the Plan.

Examples that must not stale a Plan when expected hashes match:

- Counters advance as predicted
- A Practical weapon is secured as planned
- An Ideal weapon is secured as planned
- A material weapon is created as planned
- Planned inventory changes occur
- A planned old-Practical status change is confirmed
- Referenced OwnedWeapon state changes exactly as the Plan predicted

Active Plan execution takes precedence over BuildListEntry derivative staleness caused solely by normal planned progression.

Do not stop an Active Plan merely because current values no longer match the BuildListEntry's original `searchStateHash` or `referencedOwnedWeaponsHash`.

Examples that do require stale/recalculation behavior:

- Runtime RNG state differs from the current step expectation
- Normal Artian counter differs from the current step expectation
- Target definition changes
- Build List changes
- OwnedWeapon changes outside the Plan
- CalculationContext becomes incompatible
- Predicted result differs from observed result
- Planned candidate is not secured
- A different candidate is secured
- User declines a planned old-Practical materialization

Use the specified recalculation reason where applicable.

Do not automatically replace a stale Plan.

The user explicitly initiates recalculation.

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
- Reserve/secure weapon
- Register an already-created Gogma weapon as material
- Consume material weapon
- Confirm old-Practical status change

Every Step stores expected state before and after the operation.

For `ExpectedPlanState.ownedWeaponsHash`, include OwnedWeapon `kind` in
addition to the other semantic inventory fields. A kind change must change this
hash and `referencedOwnedWeaponsHash`; name, memo, and timestamps remain
excluded.

`create_material_gogma` has null Target, BuildListEntry, and Candidate
references, uses the reserved OwnedWeapon ID as `ownedWeaponId`, requires user
confirmation, and adds the same unprotected Material Gogma weapon through
`inventoryChange.addOwnedWeapon`. It is distinct from
`change_owned_weapon_status` (an existing Practical weapon conversion) and
`reserve_weapon` (securing a Target candidate).

Plan recalculation is a user-initiated UI/Planner action for a stale Plan. It is
not a `PlanStepOperationType`, and no `recalculate_plan` Step is inserted into
the old Plan.

For a planned old-Practical materialization:

- It is a separate `change_owned_weapon_status` Step
- `requiresUserConfirmation = true`
- `expectedStateBefore` includes Practical/protected
- Confirming produces Material/unprotected
- Declining leaves the weapon unchanged and makes the Plan stale
- Material consumption must not occur before the confirmation Step succeeds

---

## Execution History and Undo

Expected Plan state and `ExecutionHistory` are separate.

Execution history records what the application/user confirmed happened.

Before finalizing a Step, save an `ExecutionUndoSnapshot` containing the state required to restore that Step.

The snapshot includes the required pre-Step state defined in `DATA_MODEL.md`, including:

- RngState
- Normal Artian counters
- Affected OwnedWeapons
- Added OwnedWeapon IDs
- Removed OwnedWeapons
- Previous ProductionPlan

Undo:

- Applies only to the most recent ExecutionHistory entry
- Restores application state
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
- OwnedWeapon add/update/delete
- ExecutionHistory write
- PlanStep update
- ProductionPlan update
- `expectedStateAfter` validation for expected-success paths

Expected-success paths such as:

- Confirm expected result
- Secure weapon
- Confirm planned materialization

must rollback the entire transaction if the resulting state does not match `expectedStateAfter`.

Unexpected-result and declined-materialization paths intentionally persist stale state and the corresponding reason within the same transaction.

On any storage/validation failure:

- Leave no partial update
- Keep the pre-Step state
- Keep the UI on the current Step
- Surface a retryable save error

Undo is also one Dexie transaction.

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

Do not infer availability from ID string patterns. Elementless weapons cannot use Element Bonus. Light Bowgun and Heavy Bowgun cannot use Element Bonus regardless of element.

The verified normal-to-Gogma Bonus Type mapping is:

```text
通常 基礎攻撃力強化 -> 巨戟 基礎攻撃力強化
通常 会心率強化 -> 巨戟 会心率強化
通常 属性強化 -> 巨戟 属性強化
通常 斬れ味強化 --+
                   +-> 巨戟 斬れ味・装填強化
通常 装填数強化 ---+
```

This mapping is many-to-one for Sharpness and Capacity. Normal-to-Gogma rank conversion is unverified. Search and RNG code must not infer ranks, Counter behavior, or completed results from this mapping.

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

Export must include the specified schema version and user entities.

Master Data itself is not copied into the user export.

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

The application is mobile-friendly first and must also work on desktop browsers.

Normal UI hides internal RNG values:

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate
- Normal Artian counters

Debug Mode may show them.

Debug Mode must not change calculation semantics.

Normal UI must not expose out-of-scope v1 controls.

Important destructive operations require explicit confirmation.

Search UI must:

- Show Ideal / Practical / Similar filtering correctly
- Show skipped-route reasons
- Allow existing-Gogma Reset Skills candidates from protected weapons
- Never show Keep Bonuses inside a v1 normal-Artian route

Execution UI must:

- Present one operation at a time
- Show expected result
- Support result confirmation
- Support actual-result mismatch recording
- Support Undo
- Show stale/recalculation reason when execution diverges

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

Unverified RNG behavior must not be treated as production-correct merely because a Fake fixture passes.

Relevant test areas include:

- Domain invariants
- Restoration bonus multiset comparison
- Master validation/selectors
- Partial RNG capability derivation
- Observation validation
- Search route eligibility
- `existing_gogma_reset_skills`
- No Keep inside `normal_artian_to_gogma`
- BuildCandidate / BuildListEntry separation
- Stale hash behavior
- OwnedWeapon protection
- Beam Search behavior
- Inventory simulation
- Expected state Before/After invalidation
- Old-Practical confirmation flow
- Atomic Execution transactions
- Undo snapshot restoration
- Worker request/response/cancellation behavior
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

If real game behavior is not yet verified, completion means the typed boundary, validation, Fake Engine/fixtures, and integration contract are correct. It does not mean the production RNG algorithm is proven.
