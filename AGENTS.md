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
Build List planning input, and Planner fast-forward / conflict semantics, so
current `CalculationContext.appSchemaVersion` is **10**, defined
only by `CURRENT_CALCULATION_APP_SCHEMA_VERSION` in `src/domain/models/common.ts`.
Search, BuildList, Planner, and benchmark runtime creators share this authority.
Dexie separately moves to `DATABASE_SCHEMA_VERSION = 4` for the persisted status rename; this is independent of
`AppSettings.schemaVersion = 1`; gameVersion, Master Data version,
`RngState.schemaVersion = 1`, `CONSTRAINED_ROUTE_POLICY_VERSION`,
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`, and `supportsSeedSearch = false`
remain unchanged. `DATABASE_SCHEMA_VERSION` stays 4 at the checkpoint boundary, while
`ExportRoot.schemaVersion` moves to 5 with the persisted entity shape. Version 1 BuildCandidate, BuildListEntry, and ProductionPlan
calculations are incompatible with any later version and must not be reused as current
results. Existing staleness checks mark old BuildListEntry records with
`calculation_context_changed` and exclude them from Planner input. Preserve old
Candidate snapshots exactly as persisted, including any `category` /
`isSimilarToIdeal` / `similarityScore` a historical record still carries; obtain
current Candidates by searching again.
Do not delete historical results or add a migration or Export/Import semantic
validation change as a substitute for CalculationContext compatibility.

All version 1..9 Candidates, BuildListEntries and ProductionPlans are incompatible with version 10. Preserve their contents and fail closed with calculation_context_changed. Do not extend the historical build-result compatibility exception to version 9 or 10.

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

`Gogma-Artian-Roll-Planner` is the provenance for reference-verified single-weapon RNG
prediction and route behavior. GogmaArtianPlanner extends that behavior to
multiple Targets, inventory, global planning, and guided execution; it must not
invent different single-weapon RNG rules or copy external source code verbatim.
Gogma Seed Finder-family tools are provenance for Seed and Counter observation
and identification behavior.

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

`LotteryMaster` is provisional.

Do not force reference-verified or game-verified RNG behavior to fit the provisional `LotteryMaster` schema. If real analysis requires a different representation, update the specification before changing the production model.

Do not promote reference-verified behavior to game-verified merely because it
matches the reference implementation. The following remain unverified:

- Bow Sharpness/Ammo family behavior
- LBG/HBG Element family behavior
- Element bonus behavior for elementless Gogma weapons
- 栄光の誉れ
- 祝祭の巡り
- Gogma rank I
- Persisted Counter advancement while Counter Gate is below threshold
- Keep Bonuses prediction whose current bonuses are `normal_artian` scope
  (family mapping, candidate pool, weights, and repeat penalties are all
  undefined in the pinned reference and have no game-verified fixture)

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
Trace Replay, and semantic hashes. `PRODUCTION_RNG_ENGINE_VERSION` is
`production-rng:c5-e2`. Do not reintroduce caller-supplied or persisted Gate as
Production authority. This runtime integration does not activate the Skill-first
Identification UI; `supportsSeedSearch` remains `false`.

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

The Production v1 RNG-identification path is the dedicated Skill-first Wizard,
not the legacy generic Seed Search contract:

- Step 1 identifies canonical Base Seed and starting Skill Counter from the
  conversion-assigned Skill followed by consecutive Reset Skills observations.
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
- `supportsSeedSearch` remains false because it describes the legacy generic
  Seed Search API. Identification availability belongs at the Worker/application
  level; do not add RngEngine capability flags without a separate specification
  change.
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
  completion does not activate Production Identification and must not change
  `supportsSeedSearch`.
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
Target to weapon (see Target Weapon Rules).

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

The current Production RNG Engine still cannot predict Keep from `normal_artian`
scope slots: `getPredictionSupport({ type: "gogma_keep" })` returns
`unsupported_current_bonus` because the reference Keep family table covers only
Gogma-tier bonuses. Therefore v1 keeps three layers strictly separate:

- Game operation legality: normal-scope Keep is legal
- Production prediction support: normal-scope Keep is unsupported today
- Product behavior: Search and Planner must not generate or schedule a
  normal-scope Keep route while prediction support is missing, and Domain
  validation continues to reject such a `keep_bonuses` operation because no
  expected result can be defined for it

State the reason as missing Production prediction support, never as a game rule
that forbids Keep. Do not guess the normal-tier Keep family mapping, pool, or
weights; that behavior stays unverified until a game-verified fixture exists.

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
- A Planner-secured Candidate: `ideal`, protected. The Planner secures only the
  canonical Ideal result; a compromise checkpoint is an intermediate state of
  that same Route and is never reserved as a weapon of its own
- `practical` is written only by the user's own relabelling
- Updating an existing Gogma to a Candidate result preserves its explicit
  protection value, exactly as PR #12 fixed

Protected weapons must not be used by the Planner for:

- Reset Bonuses
- Keep Bonuses
- Reset Skills

A protected Gogma remains eligible as an `existing_gogma_current` zero-operation
Candidate when its current bonuses and skills satisfy the Target. It must not be the
source of future Bonus or Skill amendment exploration. Search must not invoke Skill or
Gogma prediction solely because a compatible protected source exists.

Status and protection remain independent user settings. Outside the creation
defaults above, changing one never changes the other: an `unclassified` protected
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

Exactly two paths write `status`:

```text
any user relabelling            ordinary Owned Weapons CRUD
reserve_weapon securing a       an Ideal Candidate is always secured as
Candidate                         status = ideal (new weapons also protected)
```

`reserve_weapon` applies that label the same way for a newly generated weapon
and for an existing Gogma Candidate, and an existing Gogma keeps its stored
protection exactly as PR #12 fixed. Never "fix" this by deleting
the status write so the Planner touches no status at all. Even there
status stays non-semantic: it decides no Search eligibility, no Planner
operation eligibility, no Target Satisfaction, and no semantic hash.

Current `RouteOperation` and `PlanStepOperationType` switches handle only the
current operations exhaustively. Never absorb a removed operation in a `default`
branch.

`SimulatedInventory.consumedWeaponIds` stays. Converting an owned normal Artian
weapon is the one remaining weapon consumption: `consumeOwnedNormalForConversion`
removes the source Normal from inventory so two Routes can never use it twice.
`same_owned_weapon_consumed`, `exclusiveConsumedOwnedWeaponId`, and
`consumedWeaponIds` serve that exclusive-source semantics and are kept unchanged;
do not rename or delete them.

Game item materials are a different concept and are untouched:
`MaterialRequirement`, `BuildCandidate.requiredMaterials`,
`ProductionPlan.requiredMaterials`, `InventoryChange.materialRequirements`,
`MaterialCostMaster`, `PlannerMasterSubset.materialCosts`, and the
`src/data/materials.json` / `src/data/material-costs.json` masters all stay. v1
adds no exact quantity revision, no owned-item tracking, and no shortage-based
Plan rejection. Where UI or documentation could confuse the two, say
アイテム素材 or 必要素材（アイテム）rather than a bare 素材.

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
otherwise better Route wins. `docs/SEARCH_SPEC.md` 8.1 and `docs/PLANNER_SPEC.md` 7.4
fix where the preference sits in each comparison: immediately before the final stable
tie-break, never as a weight inside a score.

It never restricts Target Satisfaction, which stays a judgment about actual weapon
performance: another weapon that meets the Target's conditions still satisfies it.
`reserve_weapon` and every other Planner action must never set or reassign it -
securing a Practical, securing an Ideal, registering a new Gogma, or updating an
existing one are not reasons to rewrite the user's planning input.

Because the field is part of the Target's planning meaning, it participates in
`createTargetDefinitionHash()` and changing it stales existing BuildListEntries with
`target_definition_changed`. It never enters Candidate stable key, Candidate ID,
Candidate deduplication key, or the `BuildCandidateMeaning` fingerprint: the
preference belongs to the Target, not to the Candidate's own meaning.

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
- Unset Practical Skill (both IDs null) allows only Ideal Skills. Search is Ideal-only either way; compromise conditions decide only which checkpoints exist.
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

Compromise states are offered only as **checkpoints on the canonical Ideal
Route's strict prefixes**. They are reconstructed by a pure replay of the
Candidate's own observational traces (`bonusAmendmentTrace`,
`skillAmendmentTrace`, `conversionSkillTrace`) plus the Route base OwnedWeapon,
so extraction adds **zero** RNG prediction calls, and UI/presentation code must
never re-run the RNG Engine to render one.

Checkpoints are two-layered. A `CompromiseCheckpointGroup` is the user-visible
compromise product: scope, the unordered five-slot multiset with duplicate
counts preserved, Series Skill, Group Skill, and `conditionMatch`. Slot order is
deliberately excluded from group identity. A `CompromiseCheckpointOpportunity`
is one arrival at that product and keeps the exact ordered five slots, the Route
position, the operation counts, and `conditionMatch`. Both ids are deterministic
functions of `candidateStableKey` and the group identity — never of
`searchRunId`, the Clock, or an enumeration ordinal.

Every arrival is retained. Two arrivals at the same product stay two
opportunities; the earliest is the display representative and the rest are
disclosed as 「その他の到達点」. A conservative, per-`bonusTypeId` rank-vector
dominance may mark a group display-secondary, but it never removes a group or an
opportunity from the Domain: a "worse" checkpoint can be the only one that
avoids a Counter conflict. Differing Bonus Type compositions, differing Skills,
and uncomparable Master references are never ranked against each other.

The Route base's own starting state is not a Route prefix, so an owned weapon
that already satisfies a compromise condition never becomes a checkpoint.
`TargetWeapon.practicalBonusConditions`, `alternativeBonusRules`,
`practicalSkillCondition`, `OwnedWeaponStatus.practical`,
`satisfiesPracticalTarget()`, and `hasPractical` all stay: they decide what
counts as a compromise and what a weapon actually delivers.

Constrained enumeration yields Ideal Candidates only, for the same reason: a
Planner-generated Entry for a compromise result would be exactly the separate
Practical BuildListEntry this model forbids.

### Checkpoint conflicts and constrained re-search

A selected checkpoint is a hard constraint the Planner never drops, moves, or
empties on its own. Two rules follow, both Domain authority and never UI-only
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
the search horizon, the canonical-Ideal cost boundary, the extracted checkpoints,
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
once one canonical Ideal is settled; the checkpoints of that Route are then
extracted from the traces it already recorded.

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
  finished: Ideal exploration continues on it, and a compromise state becomes a
  checkpoint only when it lies on a strict prefix of the settled Ideal Route

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

Keep the checkpoint set independent of discovery order too. Every checkpoint
of the settled canonical Ideal Route is extracted from the traces that Route
already recorded, so the extracted groups and opportunities are the same
whichever RouteKind or Promise settled first.

Keep checkpoint groups plural. Nothing is removed from the Domain: the only
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
RNG prediction semantics, `PRODUCTION_RNG_ENGINE_VERSION`, or
`supportsSeedSearch`.

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
gogma_artian scope; normal_artian scope is never accepted as a Candidate or as a
checkpoint, regardless of matching labels or Skills.
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
unchanged, and normal-scope Keep prediction is still unimplemented.

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
- The skip reason `normal_scope_requires_reset` is renamed
  `normal_scope_keep_prediction_unsupported`, and its label states missing
  Production Keep prediction support. Never restate it as a game rule requiring
  a Reset first. `no_owned_weapon_available` is used by both
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
`AppSettings.schemaVersion = 1`, `PRODUCTION_RNG_ENGINE_VERSION =
production-rng:c5-e2`, and `supportsSeedSearch = false` were all unchanged.
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
either `reset_bonuses` or `keep_bonuses` as its first bonus operation. Because
Production Keep prediction does not support normal-scope input, v1 Search emits
only `reset_bonuses` there and reports the exclusion as
`keep_prediction_unsupported`, never as a game rule. That Reset produces five
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
  Bonuses to the unknown five slots. Unlike normal-scope Keep (5.7), this is an
  unknown-input problem, not a prediction-support one
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
may be Reset Bonuses or Keep Bonuses in the real game, but v1 Search emits only
Reset Bonuses there while Production Keep prediction rejects normal-scope input.
After a Reset produces `gogma_artian` scope, further Reset Bonuses or Keep
Bonuses may occur in the same route. Conversion itself does not map bonus types
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

In v1 the source must already have five `gogma_artian` scope slots, because
Production Keep prediction supports only Gogma-tier current bonuses. This is a
prediction-support restriction, not a game rule. Keep has no slot selection and
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

A mixed route whose source still has `normal_artian` scope performs Reset
Bonuses before any Keep Bonuses operation in v1, because normal-scope Keep is
unpredictable today, not because the game forbids it.

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

Among Plans the existing evaluation already rates equally, prefer first the one
whose Routes start from their Targets' preferred owned weapons
(`docs/PLANNER_SPEC.md` 7.4), and then the one that
makes the player swap the weapon in hand fewer times. This is Plan quality, not
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
orchestration-bounds defaults). B9 what-if, B10 conflict UI, and B11
normal-scope Keep stay separate phases.

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
comes from `PlannerClock`, and `checkpointGroups` comes from applying checkpoint
extraction to that Candidate. `CandidateSearchSettings` is neither the filter
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
older ProductionPlans reference its ID and Snapshot.

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
frontier dedup and the normal-scope Keep prediction exclusion unchanged.

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
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`, or
`supportsSeedSearch = false`, and it changes no Production RNG semantics,
RouteOperation meaning, ProductionPlan persisted shape, PlanStep meaning, or
existing BuildListEntry shape. If an implementation phase finds it must break
one of these, stop and report instead of changing a version.

The later physical-action sharing and shared-Counter prefix fast-forward
corrections supersede only that historical calculation-version statement: the
current version and the version 2 / version 3 artifact compatibility rules are
defined in the Calculation Context section above.

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
`preferPracticalBeforeIdeal` belongs to a legacy Planner contract and is
unsupported: the Planner has no Practical-first priority, and an input carrying
that option is refused as a validation issue rather than accepted or ignored.

They are defaults, not fixed constants: the Build List detail settings let the
user raise any of the three for one calculation. `defaultPlannerOptions` is the
only initial-value authority, the Application caller writes the reviewed values
into `PlannerInput.options`, and `PlannerInput.options` stays the single Beam
Search bound authority — no Worker Client, Worker controller, or Domain module
substitutes a default of its own. Only positive integers reach the Planner:
`NaN`, `0`, a negative number, a fraction, and an empty field are refused in the
UI. No guessed upper cap is added; a long run stays cancellable through the
existing Worker cancellation. These three settings are Build List runtime UI
state and are not persisted to `AppSettings` or IndexedDB. They are not the B8
orchestration bounds, `ConstrainedEnumerationBounds`, or `PlannerWhatIfBounds`,
and none of those is exposed in this detail settings panel.

### Typed Search Termination

How a Beam Search ended is typed data, never a parsed warning message.
`PlannerSearchTermination` carries `status`, `reachedLimits`, the `limits` the
run actually used, `expandedStates`, `completedTargetCount`, and
`totalTargetCount`, and it reaches UI, Application, and Persistence through
`PlannerBeamSearchResult.termination` and `PlannerResult.termination`.

Status precedence is `cancelled`, then `completed` (every enabled Target reached
Ideal), then `incomplete` (a `PlannerOptions` bound truncated the search first),
then `exhausted` (the search ended on its own without completing every Target).

`max_steps_reached` and `max_expanded_states_reached` stay diagnostics. They do
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
termination check. `PlannerSearchTermination` is runtime result metadata and is never
persisted in `ProductionPlan`, `PlanStep`, `BuildListEntry`, or the DB schema.
Calculation semantics and artifact validity are separate from the Dexie schema. At that boundary,
`DATABASE_SCHEMA_VERSION = 1`, `AppSettings.schemaVersion = 1`, and
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2` were unchanged.
The later Target compromise revision uses calculation version 6 and DB version 2.

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

A `BuildListEntry.selectedCheckpointOpportunityIds` entry is a hard constraint.
The Planner may never ignore it, disable it, or move the selection to another
opportunity of the same group; a unit that ends a selected checkpoint is never
`canSkipWhenCounterPassed`, and `reserve_weapon` is refused with
`selected_checkpoint_not_reached` until every selected checkpoint was really
reached. Reaching one reserves nothing, changes no status and no protection, and
never stops the Plan: it is recorded as `PlanStep.checkpointMilestones` on the
real physical Step that produced it, and no new `PlanStepOperationType` is added.
Two selected checkpoints that need the same Counter position and are not one
shareable physical action are an ordinary Counter conflict, reported with typed
`PlanConflict.checkpointParticipants` so the UI can send the user to the Build
List to change a selection.

A checkpoint-selected BuildListEntry is its Target's **required Entry** for the
run (`docs/PLANNER_SPEC.md` 7.5.6). The Target is complete only once that very
Entry reached every selected checkpoint and secured its Ideal Candidate; another
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
most one checkpoint-selected Entry per Target (`multiple_selected_checkpoint_entries`
- the user clears one selection in the Build List; the Planner never picks one
by score, cost, or order), and no checkpoint selection on a Target that already
holds an Ideal weapon when planning starts
(`selected_checkpoint_target_already_ideal`). Several groups selected inside one
Entry stay allowed.

A structurally invalid `selectedCheckpointOpportunityIds` - an unknown
opportunity id, two opportunities of one group, a duplicate - is checked in the
Planner's current-input validation through the same shared
`validateBuildListEntryCheckpointSelection()` that `validateBuildListEntry()`
uses, and fails the whole input closed (`invalid_checkpoint_selection`). A broken
selection is never read as an empty one, so no other Entry of that Target can
stand in for it; the persisted `isStale` flag stays untrusted as before.

Complete optimality is not required.

Respect search bounds and return the best state available within the limits.

---

## Planner Inventory Rules

Planner inventory is strict for both owned rarity-8 normal Artian and Gogma Artian weapon resources. Rarity 6 and 7 normal Artian weapons are not v1 inventory entities.

When an owned normal Artian weapon is converted to Gogma, the source normal weapon is consumed from inventory and a Gogma weapon is generated. The same normal weapon must not be reused by multiple routes. Protected normal weapons are never automatic conversion sources.

For `owned_normal_artian_to_gogma`, consume and remove the source Normal at the
`convert_normal_to_gogma` Step. The converted Gogma remains an unregistered
route output through any Reset Bonuses, Keep Bonuses, or Reset Skills operation
whose `sourceOwnedWeaponId = null`.
`reserve_weapon` later adds a new Gogma ID and must not remove the Normal again,
reuse its ID, assign a future ID at conversion time, or add a route-local weapon
reference.

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

`reserve_weapon` has Route-specific inventory semantics:

- `normal_artian_to_gogma`: add a new Gogma with a reserved ID, `status = ideal`
  and protection on
- `owned_normal_artian_to_gogma`: add a new Gogma with a different reserved ID and
  the same default; its source Normal was already consumed by the conversion Step
- amendment `existing_gogma_*`: update the same source Gogma ID, do not add a new
  weapon, and preserve its explicit protection value

The secured weapon uses Candidate result bonuses and skills and has status Ideal,
because a Candidate is always an Ideal Candidate. It stores no Target reference, and
`reserve_weapon` never changes `TargetWeapon.preferredOwnedWeaponId`. Target
satisfaction changes only when the weapon is reserved, not merely when an RNG
operation is simulated or confirmed.

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
- Planned inventory changes occur
- An owned weapon's status label is changed by the user
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

Every Step stores expected state before and after the operation.

For `ExpectedPlanState.ownedWeaponsHash`, include OwnedWeapon `kind` and
restoration-bonus scope in addition to the other semantic inventory fields. A
kind or scope change must change this hash and `referencedOwnedWeaponsHash`;
name, memo, status, and timestamps remain excluded. An OwnedWeapon carries no Target
reference, so neither hash contains one, and a Target's
`preferredOwnedWeaponId` must never be added to the
`referencedOwnedWeaponsHash` of a Candidate whose Route does not reference that
weapon.

Plan recalculation is a user-initiated UI/Planner action for a stale Plan. It is
not a `PlanStepOperationType`, and no `recalculate_plan` Step is inserted into
the old Plan.

A status change on its own is ordinary Owned Weapons CRUD, never a
ProductionPlan operation, and there is no PlanStep whose only effect is one.
`reserve_weapon` still records the Ideal label on the secured weapon. Because
status is non-semantic, relabelling a weapon never makes a running Plan stale.
Reaching a compromise checkpoint changes neither status nor protection.

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

must rollback the entire transaction if the resulting state does not match `expectedStateAfter`.

The unexpected-result path intentionally persists stale state and the corresponding reason within the same transaction.

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

- Offer one enabled TargetWeapon at a time through a single Select, with no
  result filter, no output cap and no similarity control
- Show at most one canonical Ideal Candidate, and say
  「現在の探索範囲では理想品が見つかりませんでした」 when none was found - never
  that the Target has no Ideal
- List the compromise checkpoints of that Candidate's Route, all unselected by
  default, at most one selectable opportunity per group, with 「その他の到達点」
  for later arrivals of one group and 「その他の候補」 for display-secondary groups
- Say 「この候補は作成リストに追加済みです。チェックポイントは作成リストで変更して
  ください。」 when the same Candidate is added again, and never overwrite the
  existing selection
- Show skipped-route reasons
- Show protected existing Gogma only as zero-operation current-state Candidates when
  they already satisfy the Target, and do not show amendment routes for them
- Show inherited normal-scope bonuses and the initial predicted Skills at
  conversion
- Present Reset Bonuses as the only currently predictable first bonus amendment
  for a converted normal-scope Gogma, and explain the exclusion as missing
  Production Keep prediction support rather than as a game restriction
- Allow later Reset Bonuses or Keep Bonuses in the same route after that first
  Reset; never present a Keep slot-selection control

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
- Normal-scope Keep is excluded as `keep_prediction_unsupported`, not as an
  illegal game operation
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
- Every checkpoint of the canonical Ideal Route is extracted from its recorded
  traces, and the extracted set is unchanged across traversal orders
- Stream anchors `b0` / `k0` come from the documented deterministic ordering
- Checkpoint groups with differing bonus compositions or skill compositions stay
  primary as incomparable rather than being tidied behind the secondary disclosure
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
- Only strict prefixes of the canonical Ideal Route becoming checkpoints, never a
  compromise state that branches off it and never the Route base's own state
- Checkpoint extraction adding no RNG prediction call and never moving the
  canonical Ideal selection
- Two slot orders of one Bonus multiset grouping together while each opportunity
  keeps its exact slot order, both arrivals at one product being retained, the
  earliest being the representative, conservative display dominance marking a
  group secondary without removing any Domain group or opportunity, and differing
  Skills or Bonus Type compositions never being ranked against each other
- Checkpoint selection starting empty, accepting one opportunity per group,
  rejecting two of one group and an unknown id, leaving the BuildListEntry
  un-staled, moving the Plan's build-list hash, and surviving a re-add of the
  same Candidate
- A selected checkpoint endpoint never being silently fast-forwarded while an
  unselected intermediate unit and a fully overwritten prefix unit still are
- The exact selected checkpoint state actually holding, the Planner never
  deselecting or substituting an opportunity, two incompatible selections on one
  Counter becoming a conflict that a Build List change resolves, one shared
  physical action reaching both without duplicating the operation, and an Entry
  with no selection keeping its ordinary Ideal Route meaning
- `practicalFirstProgressTargetIds` and `CandidateScore.categoryScore` being absent
- `hasPractical` alone producing no `CandidateScore` difference at equal priority
  and cost, a higher-priority Ideal-unmet Target never overtaken by a
  lower-priority uncovered one on `hasPractical` alone, Beam pruning ordering
  unchanged whichever Target holds the compromise weapon, and a selected
  checkpoint kept through `PlannerCheckpointRequirements` rather than any score
- An unknown checkpoint opportunity id, two opportunities of one group, and a
  duplicate id each failing the Planner input closed before any Beam Search,
  never read as an empty selection and never bypassed through a selection-free
  Entry of the same Target, while a well-formed selection and a selection-free
  Entry keep working
- A checkpoint-selected Entry never bypassed by a cheaper selection-free Entry of
  the same Target, staying relevant after another weapon made its Target Ideal,
  completing only once it reached its checkpoint and secured its Ideal, the typed
  termination counting that Target complete only then, two checkpoint-selected
  Entries of one Target failing closed without picking either, selection-free
  same-Target Entries keeping the ordinary candidate selection, an already-Ideal
  Target with a selection failing closed, and a conflict reached through a
  selection-free Entry still blocking that Target's constrained re-search and
  what-if
- Checkpoints adding no `PlanStepOperationType`, riding as milestones on the real
  physical Step, leaving later Steps in place, reserving nothing, and changing no
  status or protection, while the final Ideal still applies the ordinary reserve
  semantics
- A starting OwnedWeapon that already satisfies a compromise condition never
  becoming a checkpoint, `hasPractical` still judged from actual performance, and
  `OwnedWeaponStatus.practical` still present
- Schema 9 artifacts failing closed under schema 10, current-schema checkpoint
  shape validated strictly, a historical artifact with no checkpoint field still
  validating and rendering, and `ExportRoot.schemaVersion = 5`
- Build List detail settings starting at `defaultPlannerOptions`, sending the
  user-selected values as `PlannerInput.options`, restoring the defaults, and
  refusing `0`, a negative number, a fraction, and an empty field
- The real user case of one 23-operation Bonus Route plus one 148-operation
  Bonus + 82-operation Skill Route reporting `incomplete` with a 24-step partial
  at the default bounds, and producing the 232-step complete Plan once
  `maxExpandedStates` is raised
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
- `defaultCandidateSearchSettings` is `1000 / 200 / 1000 / 200 / 0.6`
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
- Skip reason labels state normal-scope Keep as missing prediction support, and
  `no_owned_weapon_available` reads naturally for Normal and Gogma source routes
- `TargetWeapon.preferredOwnedWeaponId` accepts null, and the v2 -> v3 migration
  sets it to null for every Target, removes `relatedTargetWeaponIds` from every
  current OwnedWeapon, never infers a preference from the removed list, and
  rewrites no BuildCandidate, BuildListEntry, ProductionPlan, or ExecutionHistory
- `DATABASE_SCHEMA_VERSION = 4`, `ExportRoot.schemaVersion = 5`,
  `CURRENT_CALCULATION_APP_SCHEMA_VERSION = 10`, schema 1..9 artifacts failing closed
  under version 10, and no other version authority changed
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
- The Planner prefers a preferred-source Route when the existing evaluation ties,
  prefers the non-preferred one when the existing evaluation rates it higher, ranks
  the preference above `weaponSwitchCount` and below Target priority, satisfaction,
  category, cost, and conflict, works for owned Normal and existing Gogma routes,
  never treats a new-Normal route as preferred, and never lets `reserve_weapon`
  change a Target preference
- Changing only `preferredOwnedWeaponId` changes `targetDefinitionHash` and stales
  the BuildListEntry with `target_definition_changed`
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
