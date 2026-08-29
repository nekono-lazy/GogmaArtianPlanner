# AGENTS.md

## Project

Project root:

```text
GogmaArtianPlanner/
```

This repository contains a Web application for planning Monster Hunter Wilds Gogma Artian weapon creation.

The application is intended to:

- Predict future Artian / Gogma Artian restoration bonuses and skills from RNG state
- Search ideal and practical target weapon candidates
- Compare normal Artian routes and existing Gogma Artian routes
- Plan multiple target weapons together using shared RNG progression
- Track owned Gogma Artian weapons individually
- Guide the user through the generated plan one operation at a time

---

## Required Specifications

Before making changes, read:

```text
docs/REQUIREMENTS.md
```

Then read the specification related to the current task.

```text
docs/DATA_MODEL.md
docs/MASTER_DATA.md
docs/RNG_SPEC.md
docs/SEARCH_SPEC.md
docs/PLANNER_SPEC.md
docs/UI_FLOW.md
```

The specification hierarchy is:

1. `docs/REQUIREMENTS.md`
2. Task-specific detailed specification
3. Existing implementation and tests

If specifications conflict, do not silently choose one interpretation.

Report the conflict before changing behavior.

Do not invent requirements that are not present in the specifications.

---

## Initial Release Scope

The initial release is a static Web application.

Expected technology stack:

- React
- TypeScript
- Vite
- IndexedDB
- Dexie.js
- Web Worker
- Vitest
- GitHub Pages

The application should run without a required backend server.

User data should remain in the browser unless explicitly exported by the user.

---

## Out of Scope

Do not implement the following unless the specifications are explicitly updated:

- OCR
- OCR-based owned weapon import
- Direct REFramework integration
- High-speed execution mode
- Multiple character/profile switching
- Cloud synchronization
- User accounts
- Manual fixed production ordering
- Arbitrary user-defined planner scoring
- Server-side database
- Server-side RNG processing

Do not add speculative future functionality while implementing an initial-release task.

---

## Architecture Rules

Keep UI, domain logic, RNG logic, search logic, planner logic, and persistence separated.

Recommended responsibility boundaries:

```text
src/
  app/
  components/
  domain/
  engine/
  workers/
  db/
  data/
```

The exact directory structure may evolve, but the following rules are mandatory:

- RNG Engine must not depend on React
- Search logic must not depend on React
- Planner logic must not depend on React
- Domain logic must not directly depend on IndexedDB
- Web Workers must not directly manipulate React state
- Pure calculations should be implemented as pure functions where practical
- Persistence should be accessed through repository/service boundaries
- Master data must be referenced by stable IDs, not display names

Do not place core game logic directly inside React components.

---

## TypeScript Rules

Prefer strict, explicit TypeScript types.

Avoid `any`.

Use `unknown` plus validation when accepting external or untrusted data.

Prefer discriminated unions for operation types, route types, worker messages, and result types.

Do not use display strings as identifiers.

IDs must follow the definitions in `DATA_MODEL.md` and `MASTER_DATA.md`.

Do not silently coerce invalid domain values.

---

## RNG Rules

RNG behavior is a critical part of the application.

Do not guess or approximate unknown game RNG behavior.

If the real RNG algorithm is not yet confirmed:

1. Define the interface and input/output types
2. Implement validation
3. Use fixture-based fake/test implementations where needed
4. Keep the real engine replaceable
5. Clearly mark unverified behavior

Never make production behavior depend on guessed lottery weights, counter advancement, Keep Bonuses behavior, or other unverified mechanics.

Known RNG state may be partially available.

Do not assume that all RNG values must always be known at the same time.

Features and routes should be enabled based on the state they actually require.

---

## Restoration Bonus Rules

Restoration bonuses are weapon-type dependent.

Use:

- Common bonus type master
- Common rank master
- Weapon-specific bonus definitions

Do not hard-code weapon-specific bonus availability inside UI components.

A restoration bonus set always contains exactly five bonuses.

The five bonuses are displayed as slots, but ideal-condition equality is evaluated as an unordered multiset unless a detailed specification explicitly says otherwise.

---

## Owned Weapon Rules

All owned Gogma Artian weapons are tracked individually.

This includes weapons used as materials.

Each owned weapon retains its current:

- Weapon type
- Element
- Five restoration bonuses
- Series skill
- Group skill
- Status
- Protection state

Statuses:

```text
Material
Practical
Ideal
```

Protection and status are separate concepts.

Practical and Ideal weapons are protected by default.

A protected weapon must not be consumed automatically by the Planner.

If a previously practical weapon becomes unnecessary after obtaining a better weapon, the user must explicitly choose whether to:

- Keep it
- Change it to Material

Do not automatically convert it to Material.

---

## Target Weapon Rules

One desired configuration equals one TargetWeapon.

Do not merge different desired configurations merely because weapon type and element are the same.

Target priority is:

```text
1 - 5
```

Default:

```text
3
```

Target priority influences Planner decisions but is not the only conflict-resolution factor.

---

## Candidate and Build List Rules

Search results and Planner input are separate concepts.

A search result is a `BuildCandidate`.

A user-selected Planner input belongs to the Build List.

Do not make BuildCandidate persistence implicitly represent Build List membership unless the current specification explicitly requires that design.

A Build List entry should retain enough information to detect whether it became stale because of:

- Target definition changes
- RNG state changes
- Master data version changes
- RNG Engine version changes

---

## Search Rules

Search runs per target weapon but may process multiple targets in one worker request.

Candidate search must consider applicable routes only.

If a normal Artian counter for the required weapon type and rarity is unknown, skip only the normal Artian route.

Do not disable unrelated existing-Gogma routes.

Target conditions must never be automatically weakened.

Condition relaxation may be suggested, but the target definition changes only after explicit user action.

Ideal matching and practical matching must follow `SEARCH_SPEC.md`.

Similarity to the ideal target is a separate concern from whether a candidate satisfies practical conditions.

Do not create ambiguous overlapping candidate categories.

---

## Planner Rules

The Planner operates across multiple target weapons.

It must account for shared RNG progression and weapon inventory.

The Planner should favor:

1. Obtaining practical weapons for currently uncovered targets
2. Taking advantage of shared RNG progression to obtain other useful targets
3. Upgrading practical weapons to ideal weapons
4. Reducing weapon consumption and operation count when alternatives are otherwise similar

The Planner must not treat each target weapon as an isolated optimization problem.

Planner execution must use simulated state.

Do not mutate IndexedDB while searching for a plan.

Persist the finalized plan only after the planner result is returned to the application layer.

---

## Planner Recalculation Rule

This is a core invariant:

> Do not recalculate while execution follows the finalized plan. Recalculate only when the plan's assumptions diverge from actual state.

Normal planned changes do not invalidate a plan.

Examples that must NOT trigger recalculation:

- Counters advance exactly as predicted
- A planned practical weapon is secured
- A planned ideal weapon is secured
- A planned material weapon is created
- A planned inventory change occurs

Examples that DO trigger recalculation:

- Actual RNG state differs from the expected state for the current step
- User manually changes RNG state
- Target conditions change
- Target priority changes in a way that affects the plan
- Build List changes
- Owned weapon inventory changes outside the plan
- A predicted result does not match the observed result
- A planned candidate is skipped
- A different candidate is secured

Plan invalidation must compare actual state against the expected state for the current execution point.

Do not compare only against the original plan-start snapshot.

---

## Plan Step Rules

Execution navigation is one operation at a time in the initial release.

A route must contain enough information to reproduce its sequence of operations.

Plan steps should represent actual user operations such as:

- Create normal Artian
- Convert to Gogma Artian
- Reset bonuses
- Keep bonuses
- Reset skills
- Secure weapon
- Change weapon status
- Consume material weapon

Do not introduce batch execution behavior in the initial release.

Plan view may visually collapse repeated steps, but execution must still proceed one operation at a time.

---

## Execution History and Undo

Expected plan state and actual execution history are separate.

Execution history records what the user confirmed actually happened.

Undo only corrects an application-side mistaken confirmation.

Undo does not reverse actions performed in the game.

After Undo, re-evaluate whether the current application state still matches the expected plan state.

---

## Master Data Rules

Master data should be stored separately from application logic.

Expected data includes:

- Weapon types
- Elements
- Bonus types
- Bonus ranks
- Weapon bonus definitions
- Series skills
- Group skills
- RNG lottery data
- Materials
- Material costs

Master data must be versioned.

At minimum track:

- Game version
- Master data version
- RNG Engine version where calculation compatibility matters
- User-data schema version

Do not force unverified RNG behavior to fit a provisional LotteryMaster schema.

If the RNG implementation requires a different representation after verification, update the specification before changing the production data model.

---

## Persistence Rules

Use IndexedDB through Dexie.js for persistent user data.

Do not persist temporary UI state unless there is a clear requirement.

External/imported JSON must be validated before persistence.

Import must not partially overwrite existing data when validation fails.

Initial release supports full-replacement import only unless the specification changes.

Exported user data must contain a schema version.

---

## Web Worker Rules

Long-running operations must not block the UI thread.

Use Web Workers for:

- Seed/counter search
- Large candidate searches
- Planner search where computation is non-trivial

Worker requests and responses must have typed messages and request IDs.

Old responses from obsolete request IDs must not overwrite newer results.

Long-running requests should support cancellation.

Workers should receive the data required for the calculation through messages.

Do not make Workers depend directly on React state.

---

## UI Rules

The application is mobile-friendly first, while also supporting desktop browsers.

Normal UI must hide internal RNG details such as:

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate
- Normal Artian counters

These values may be shown in Debug Mode.

Debug Mode must not change calculation behavior.

Do not expose controls for out-of-scope features.

Important destructive operations require confirmation.

---

## GitHub Pages Rules

The production build must support GitHub Pages.

Do not introduce backend routing requirements.

Ensure the chosen router strategy works when hosted under the repository path.

When changing routing or Vite configuration, verify the production build rather than relying only on the development server.

---

## Testing Requirements

For every meaningful domain change, add or update tests.

At minimum, before considering a task complete, run:

```bash
npm test
npm run build
```

If the project has a dedicated type-check command, run it as well.

Examples:

```bash
npm run typecheck
```

Do not remove or weaken existing tests just to make a change pass.

Important logic should have deterministic fixture-based tests.

RNG implementations must be validated against known fixtures before being treated as production-correct.

---

## Change Discipline

Keep each task focused.

Do not refactor unrelated areas unless necessary for the requested change.

Do not perform large architecture rewrites without a specification requirement.

If a required change would alter a documented public/domain contract:

1. Identify the affected specification
2. Report the mismatch
3. Update the specification or request confirmation
4. Then implement the code change

Do not silently change domain meaning.

---

## Completion Report

After completing a coding task, report:

- What was changed
- Which specification files were followed
- Files added or modified
- Tests added or modified
- Commands executed
- Test/build result
- Remaining limitations or unverified RNG behavior

Keep the report concise and factual.

---

## Definition of Done

A task is not complete unless the requested scope is implemented and:

- TypeScript compiles without errors
- Tests pass
- Production build succeeds
- Domain invariants remain valid
- No unrelated features were added
- No unverified RNG behavior was silently invented
- GitHub Pages compatibility is preserved
