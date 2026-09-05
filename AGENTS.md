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
- Practical-versus-Practical quality ranking for automatic materialization
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

Internal PRNG steps are not Domain Counter increments. RNG advancement caused
by `use_weapon_as_material` is unverified and must not be guessed.

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
- RNG advancement caused by `use_weapon_as_material`
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

- May retain five inherited `normal_artian` scope restoration bonuses before
  its first bonus amendment
- Uses five `gogma_artian` scope restoration bonuses after Reset Bonuses or
  Keep Bonuses
- Never mixes `normal_artian` and `gogma_artian` scopes within one weapon;
  all five slots have the same scope
- Retains Series Skill and Group Skill
- Retains Material / Practical / Ideal status
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

Ideal is the strict upper bound of Practical, never a parallel alternative:

```text
Ideal    = the build the user actually wants
Practical = below Ideal but still usable as a compromise
```

So the Ideal set is contained in the Practical set:

```text
{ results satisfying Ideal } ⊆ { results satisfying the Practical conditions }
```

`idealBonuses` must satisfy every `practicalBonusConditions` entry and every
`practicalAlternativeGroups` entry. Any result satisfying `idealSkillCondition`
must also satisfy `practicalSkillCondition` under that condition's
`seriesSkillId` / `groupSkillId` / `matchMode` semantics, with `null` meaning
unconstrained. A Target definition that breaks this containment is invalid.

`docs/DATA_MODEL.md` 8.1 holds the formal invariant. `validateTargetIdealImpliesPractical()`
implements it. It needs Master Data for Bonus Rank `order`, so it is a
Master-aware validator separate from `validateTargetWeapon()`, and it runs both
when a Target is saved and when Candidate Search selects its Targets. A stored
Target that violates the containment is excluded from Candidate Search with a
warning; it is never auto-repaired, auto-deleted, or silently relaxed. Never make
Search or Planner silently repair a Target that violates it.

This containment is what lets Candidate Search stop exploring a stream whose
current state already satisfies the Ideal condition. That optimization is only
sound once the validation is in force, so the validation always lands first.
The validation is now in force, and both halves of the early exit have landed
on top of it: the Skill stream stops when the current Series/Group Skills
already satisfy `idealSkillCondition`, and the Bonus stream stops when the
current five slots already match `idealBonuses`. Each stream stops
independently; the other one keeps searching.

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
- Material-consumption operations

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
once one canonical Ideal is settled and every Practical within its operation
count has been evaluated.

Only when Counter conflicts actually occur across Targets does the Planner
re-search the conflicting Targets, look up the next Practical/Ideal for the
Target that yields, and compare how much further each choice pushes the other.
`docs/SEARCH_SPEC.md` 5.6 and `docs/PLANNER_SPEC.md` 9.1-9.2 hold that contract;
v1 does not implement Planner-driven constrained re-search.

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
- If the current bonuses already satisfy the Target's ideal bonus condition, do
  not search bonus amendments for that weapon
- A stream that currently satisfies only the Practical condition still yields a
  zero-operation Practical solution for that stream, and Ideal exploration
  continues on it

Do not enumerate the Cartesian product of bonus results and Skill results, and
do not reintroduce it as a lazily expanded priority queue or a small fixed
diagonal band over the same product. Solve each stream independently, then
compose only the routes the documented candidate composition rule requires. The
Cross rule is the initial bounded search policy, not a complete search through
the Planner. `docs/SEARCH_SPEC.md` is the authority for the stream solution sets,
their deterministic ordering, the composition rule, the termination condition,
and the meaning of `maxGogmaAdvance`, `maxSkillAdvance`, and
`maxCandidatesPerTarget`.

Terminate the initial search once one canonical Ideal is settled and every
Practical within its operation count has been evaluated. The canonical Ideal is
defined by the documented total order over Ideal candidates. Never let it depend
on incidental traversal order — which RouteKind ran first, or which Promise
settled first. Its final tie-break must be a stable semantic key over the
candidate's result and route; `BuildCandidate.id` cannot serve there because the
current implementation folds `searchRunId` into the hash, so the same input would
pick a different Ideal on a second run.

Keep the Practical retention range independent of discovery order too. With `D`
the canonical Ideal's `estimatedOperationCount`, every Practical reachable within
`estimatedOperationCount <= D` is evaluated for retention, then filtered by the
conservative dominance below. Finding the Ideal first must never cause a nearer
Practical to go unevaluated.

Keep Practical candidates plural. Drop one only under a conservative Pareto
dominance covering bonus composition, bonus rank, skills, source weapon,
destructive/non-destructive kind, every advance and operation count, and
material requirements. Compare bonus ranks as a per-`bonusTypeId` rank multiset,
never by slot index, and treat a scope or type whose Master rank ordering cannot
be compared safely as incomparable. Compare materials component-wise per
`materialId`, never by a summed quantity — differing material kinds are
incomparable. Never rank bonus types or skills against each other by assumed
game strength; differing compositions are incomparable, so keep both.

`maxGogmaAdvance` bounds the Gogma Counter positions the search covers, not the
number of Engine calls; a bounded state search inside the Gogma stream is
allowed. `maxSkillAdvance` is the maximum Reset Skills count, so a conversion
route's shared Skill prediction array spans one extra position without raising
that Reset bound. `maxCandidatesPerTarget` bounds the retained Practical set and
must never stop the search before an Ideal is found.

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

### Normal Artian Route

Route kind:

```text
normal_artian_to_gogma
```

v1 searches only rarity-8 normal Artian weapons. If the required weapon-type rarity-8 Normal Artian counter is unknown, skip only this route.

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
- May use protected Practical or Ideal weapons in v1

It does not require Gogma prediction or Keep prediction.

Its `referencedOwnedWeaponsHash` must include the source weapon.

### Existing Gogma Mixed

Route kind:

```text
existing_gogma_mixed
```

If the route includes Reset Bonuses or Keep Bonuses, the source must be unprotected.

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

Trace replay of conversion must preserve the five normal-scope slots, call
Skill prediction at the conversion position, advance Skill Counter by one, and
leave Gogma Counter unchanged. If the initial conversion Skill already meets
the Target, do not add Reset Skills; otherwise, search Reset Skills beginning
at the following Skill position.

Conversion operations conflict at the same Skill Counter position, not the
same Gogma Counter position. Only Reset Bonuses and Keep Bonuses consume and
conflict on Gogma positions.

Resolving Counter conflicts across Targets is the Planner's job, not something
Candidate Search pre-computes. v1 does not implement Planner-driven constrained
re-search, but the contract for it is fixed: never restart a re-search at
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
route output through any Reset Bonuses, Keep Bonuses, or Reset Skills operation
whose `sourceOwnedWeaponId = null`.
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

Material replenishment conversion still consumes one Skill result and no Gogma
result. Being created as material never suppresses that Skill advancement.

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

For `ExpectedPlanState.ownedWeaponsHash`, include OwnedWeapon `kind` and
restoration-bonus scope in addition to the other semantic inventory fields. A
kind or scope change must change this hash and `referencedOwnedWeaponsHash`;
name, memo, and timestamps remain excluded.

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

- Show Ideal / Practical / Similar filtering correctly
- Show skipped-route reasons
- Allow existing-Gogma Reset Skills candidates from protected weapons
- Show inherited normal-scope bonuses and the initial predicted Skills at
  conversion
- Present Reset Bonuses as the only currently predictable first bonus amendment
  for a converted normal-scope Gogma, and explain the exclusion as missing
  Production Keep prediction support rather than as a game restriction
- Allow later Reset Bonuses or Keep Bonuses in the same route after that first
  Reset; never present a Keep slot-selection control

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
- Reset or Keep after the first Reset in normal and owned-normal routes
- Keep family preservation by slot with no selection branches
- Skill prediction count independent of Gogma state count, source count, and
  normal offset count
- Gogma prediction count independent of Skill position count
- Zero Skill exploration when the current Skills already satisfy the ideal Skill
  condition, and zero bonus amendment exploration when the current bonuses
  already satisfy the ideal bonus condition
- Candidate composition follows the documented Cross rule and never enumerates
  the bonus-by-Skill product
- The initial search stops at one canonical Ideal, and that Ideal is unchanged
  when RouteKind evaluation order changes
- The canonical Ideal is unchanged when `searchRunId` changes across runs
- Every Practical within the canonical Ideal's operation count is evaluated, and
  the retained set is unchanged across traversal orders
- Stream anchors `b0` / `k0` come from the documented deterministic ordering
- Practical candidates with differing bonus compositions, skill compositions, or
  source weapons are kept as incomparable rather than dropped
- Bonus rank dominance is decided per `bonusTypeId` rank multiset, not by slot
  index, and an uncomparable Master rank ordering makes the pair incomparable
- Material dominance is decided component-wise per `materialId`, so differing
  material kinds and mixed trade-offs stay incomparable
- The same result at a later Counter position is not excluded as dominated, and a
  constrained re-search can still reach it
- Target Ideal-implies-Practical validation lands before the Ideal-already-
  satisfied early exit is enabled
- Reaching `maxCandidatesPerTarget` still includes a found Ideal in the result
- `maxSkillAdvance` caps Reset Skills at M for both existing-Gogma routes
  (advance 0..M) and conversion routes (advance 1..M+1)
- Target Ideal-implies-Practical containment, added with Target validation
- Null transient sources for post-conversion Reset Bonuses, Keep Bonuses, and
  Reset Skills
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
