import { describe, expect, it } from 'vitest'
import type {
  BuildListEntry,
  BuildListEntryId,
  TargetWeapon,
} from '../../models/publicTypes'
import { visitConstrainedCandidates } from '../../search'
import type { ConstrainedCandidate } from '../../search'
import {
  belowPracticalBonuses,
  idealBonuses,
} from '../../../test/fixtures/constrainedEnumeration'
import { runtimeUnsupportedFixture } from '../../../test/fixtures/plannerRuntimeUnsupported'
import {
  CONFLICT_GOGMA_COUNTER,
  ORCHESTRATION_SOURCE_A,
  ORCHESTRATION_SOURCE_B,
  orchestrationBounds,
  orchestrationEntry,
  orchestrationEnumerationBounds,
  orchestrationScenario,
  orchestrationSource,
  orchestrationTarget,
  resetRoute,
  resetSkillsRoute,
  skillConstrainedTarget,
  type OrchestrationScenario,
} from '../../../test/fixtures/plannerConstrainedOrchestration'
import { preparePlannerInitialContext } from '../plannerInitialContext'
import { createPlanningBuildListEntriesHash, createProductionPlan } from '../productionPlanGeneration'
import type { PlannerConflictResolution } from '../plannerTypes'
import { createConstrainedMaterializer } from './constrainedMaterializer'
import { preparePlannerAugmentedConflictPreflight } from './plannerAugmentedPreflight'
import {
  createPlannerConstrainedConflictContexts,
  preparePlannerFixedConflictConstraints,
  type PlannerConstrainedConflictContext,
  type PlannerFixedConflictConstraint,
} from './plannerConflictContext'
import { PlannerOrchestrationBoundsError } from './plannerOrchestrationBounds'
import {
  createPlannerConflictWorks,
  createProductionPlanWithConstrainedSearch,
  isConstrainedTrialAdoptable,
  isPlannerConflictWorkSatisfied,
  type PlannerConflictWork,
} from './plannerConstrainedOrchestration'

/**
 * B8-C4b Planner constrained-search orchestration.
 *
 * Every orchestration test below drives the real pipeline end to end -
 * `preparePlannerInitialContext`, the B8-C3a conflict contexts, the B8-C3b
 * augmented preflight, `visitConstrainedCandidates()`, the B8-C2 materializer,
 * and the shared Production Plan generation with its Beam Search and Trace
 * Replay. Nothing is mocked; only the Fake RNG Engine, the ID factory and the
 * Clock are injected, exactly as the Planner contract already requires.
 */

const TARGET_A = 'target.orchestration.a'
const TARGET_B = 'target.orchestration.b'
const TARGET_C = 'target.orchestration.c'
const SOURCE_C = 'owned.orchestration.c'
const SOURCE_D = 'owned.orchestration.d'
/** Source A's own Series Skill, which is also Target A's Ideal Skill. */
const SOURCE_A_SERIES_SKILL_ID = 'series_skill.fixture.z'
/** A Series Skill no Target accepts as Ideal, so a Skill amendment is needed. */
const SOURCE_B_SERIES_SKILL_ID = 'series_skill.fixture.b-source'
const ENTRY_A = 'build-list.orchestration.a'
const ENTRY_B = 'build-list.orchestration.b'
const ENTRY_C = 'build-list.orchestration.c'

/**
 * Target A: Practical and Ideal are decided by the five slots alone, so the
 * single Reset at the contested Gogma Counter is a complete Ideal Route.
 */
function targetA(): TargetWeapon {
  return orchestrationTarget(TARGET_A, {
    priority: 5,
    idealSkillCondition: {
      seriesSkillId: SOURCE_A_SERIES_SKILL_ID,
      groupSkillId: null,
      matchMode: 'all',
    },
    practicalSkillCondition: {
      seriesSkillId: SOURCE_A_SERIES_SKILL_ID,
      groupSkillId: null,
      matchMode: 'all',
    },
  })
}

/**
 * A Target whose Practical condition also needs the Ideal Series Skill.
 *
 * Its own source already carries the Ideal five slots, so a Reset-Skills-only
 * Route is a genuine Ideal solution: that is how a constrained Candidate can
 * avoid the contested Gogma Counter entirely.
 */
function skillTarget(id: string): TargetWeapon {
  return skillConstrainedTarget(id, { priority: 1 })
}

function idealEntryA(target: TargetWeapon): BuildListEntry {
  return orchestrationEntry(ENTRY_A, target, resetRoute(ORCHESTRATION_SOURCE_A), {
    finalBonuses: idealBonuses(),
    seriesSkillId: SOURCE_A_SERIES_SKILL_ID,
  })
}

/** Reset at the contested Gogma Counter, then the Ideal Skill at Skill 7. */
function idealMixedEntry(
  id: string,
  target: TargetWeapon,
  sourceId: string,
): BuildListEntry {
  return orchestrationEntry(
    id,
    target,
    {
      kind: 'existing_gogma_mixed',
      sourceOwnedWeaponId: resetRoute(sourceId).sourceOwnedWeaponId,
      operations: [
        ...resetRoute(sourceId).operations,
        ...resetSkillsRoute(sourceId).operations,
      ],
    },
  )
}

interface TwoTargetParts {
  targets: TargetWeapon[]
  ownedWeapons: ReturnType<typeof orchestrationSource>[]
  entries: BuildListEntry[]
}

/**
 * Two Targets contending for one Gogma Counter position.
 *
 * Target A's Entry Resets its own source there; Target B's Entry Resets its own
 * source at the very same position, which is the `same_gogma_counter` conflict
 * the whole B8 flow is about. The same Ideal five slots are reachable again two
 * Gogma positions later, so a constrained Candidate can reach Target B's Ideal
 * without the contested position. Source B's Series Skill is its own, so it
 * never satisfies Target A.
 */
function twoTargetParts(
  sourceBBonuses = belowPracticalBonuses(),
): TwoTargetParts {
  const a = targetA()
  const b = skillTarget(TARGET_B)
  return {
    targets: [a, b],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A, {
        seriesSkillId: SOURCE_A_SERIES_SKILL_ID,
      }),
      orchestrationSource(ORCHESTRATION_SOURCE_B, {
        restorationBonuses: sourceBBonuses,
        seriesSkillId: SOURCE_B_SERIES_SKILL_ID,
      }),
    ],
    entries: [idealEntryA(a), idealMixedEntry(ENTRY_B, b, ORCHESTRATION_SOURCE_B)],
  }
}

/** The same contention with a third Target, so one conflict yields two works. */
function threeTargetParts(): TwoTargetParts {
  const two = twoTargetParts()
  const c = skillTarget(TARGET_C)
  return {
    targets: [...two.targets, c],
    ownedWeapons: [
      ...two.ownedWeapons,
      orchestrationSource(SOURCE_C, {
        restorationBonuses: idealBonuses(),
        seriesSkillId: SOURCE_B_SERIES_SKILL_ID,
      }),
    ],
    entries: [...two.entries, idealMixedEntry(ENTRY_C, c, SOURCE_C)],
  }
}

function contextsOf(built: OrchestrationScenario): PlannerConstrainedConflictContext[] {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') {
    throw new Error(`Expected a ready Planner initial context: ${prepared.status}`)
  }
  return createPlannerConstrainedConflictContexts(prepared.context)
}

/** The `same_gogma_counter` conflict id of a freshly built scenario. */
function gogmaConflictId(parts: TwoTargetParts): string {
  const probe = orchestrationScenario({
    targets: parts.targets,
    entries: parts.entries.map((entry) => structuredClone(entry)),
    ownedWeapons: parts.ownedWeapons,
  })
  const conflict = contextsOf(probe).find(
    ({ kind, counterBefore }) =>
      kind === 'same_gogma_counter' && counterBefore === CONFLICT_GOGMA_COUNTER,
  )
  if (!conflict) throw new Error('The fixture produced no Gogma Counter conflict.')
  return conflict.conflictId
}

/** A scenario whose only explicit resolution fixes Target A's Entry. */
function fixedScenario(
  parts: TwoTargetParts = twoTargetParts(),
  conflictKey = gogmaConflictId(parts),
): OrchestrationScenario {
  return orchestrationScenario({
    targets: parts.targets,
    entries: parts.entries,
    ownedWeapons: parts.ownedWeapons,
    conflictResolutions: [{
      conflictKey,
      selectedBuildListEntryId: parts.entries[0].id,
    }],
  })
}

function fixedConstraintsOf(
  built: OrchestrationScenario,
): PlannerFixedConflictConstraint[] {
  const prepared = preparePlannerInitialContext(built.input, built.dependencies)
  if (prepared.status !== 'ready') throw new Error('Expected a ready context.')
  const contexts = createPlannerConstrainedConflictContexts(prepared.context)
  const constraints = preparePlannerFixedConflictConstraints(
    prepared.context,
    contexts,
  )
  if (constraints.status !== 'ready') throw new Error('Expected ready constraints.')
  return constraints.constraints
}

function options(
  overrides: Partial<Parameters<typeof orchestrationBounds>[0]> = {},
  enumeration = orchestrationEnumerationBounds(),
) {
  return {
    enumerationBounds: enumeration,
    orchestrationBounds: orchestrationBounds(overrides),
  }
}

function warningKinds(warnings: readonly { kind: string }[]): string[] {
  return warnings.map(({ kind }) => kind)
}

function entryId(value: string): BuildListEntryId {
  return value as BuildListEntryId
}

function constraint(
  fixedBuildListEntryId: string,
): PlannerFixedConflictConstraint {
  return {
    originalConflictId: 'plan-conflict:test',
    resourceIdentity: {
      kind: 'same_gogma_counter',
      counterStream: 'gogma',
      counterBefore: CONFLICT_GOGMA_COUNTER,
    },
    fixedBuildListEntryId: entryId(fixedBuildListEntryId),
    fixedTargetWeaponId: TARGET_A as never,
    fixedCandidateFingerprint: 'fingerprint.test',
  }
}

describe('B8-C4b conflict work scheduling', () => {
  it('creates one work per non-fixed participant Target and never for the fixed side', () => {
    const parts = threeTargetParts()
    const built = fixedScenario(parts)
    const contexts = contextsOf(built)
    const constraints = fixedConstraintsOf(built)
    const works = createPlannerConflictWorks(constraints, contexts)

    expect(constraints).toHaveLength(1)
    expect(works.map(({ targetWeaponId }) => targetWeaponId)).toEqual([
      TARGET_B,
      TARGET_C,
    ])
    // The fixed side never yields, so Target A is never re-searched.
    expect(works.some(({ targetWeaponId }) => targetWeaponId === TARGET_A)).toBe(
      false,
    )
    expect(
      works.every(
        ({ constraint: used }) => used.fixedBuildListEntryId === entryId(ENTRY_A),
      ),
    ).toBe(true)
  })

  it('produces the same works whatever order the contexts and constraints arrive in', () => {
    const parts = threeTargetParts()
    const built = fixedScenario(parts)
    const contexts = contextsOf(built)
    const constraints = fixedConstraintsOf(built)

    const forward = createPlannerConflictWorks(constraints, contexts)
    const reversed = createPlannerConflictWorks(
      [...constraints].reverse(),
      [...contexts].reverse().map((context) => ({
        ...context,
        participants: [...context.participants].reverse(),
      })),
    )

    expect(reversed).toEqual(forward)
  })

  it('dedupes several participants of one Target into a single work', () => {
    const parts = threeTargetParts()
    const built = fixedScenario(parts)
    const contexts = contextsOf(built)
    const constraints = fixedConstraintsOf(built)
    const conflict = contexts.find(({ conflictId }) =>
      conflictId === constraints[0].originalConflictId,
    )
    if (!conflict) throw new Error('The fixed conflict is missing.')
    const duplicated: PlannerConstrainedConflictContext = {
      ...conflict,
      participants: [...conflict.participants, ...conflict.participants],
    }

    const works = createPlannerConflictWorks(constraints, [duplicated])

    expect(works.map(({ targetWeaponId }) => targetWeaponId)).toEqual([
      TARGET_B,
      TARGET_C,
    ])
  })
})

describe('B8-C4b work satisfaction', () => {
  function work(): PlannerConflictWork {
    const parts = threeTargetParts()
    const built = fixedScenario(parts)
    const works = createPlannerConflictWorks(
      fixedConstraintsOf(built),
      contextsOf(built),
    )
    return works[0]
  }

  const entries = [
    { id: entryId(ENTRY_A), targetWeaponId: TARGET_A },
    { id: entryId(ENTRY_B), targetWeaponId: TARGET_B },
  ] as unknown as BuildListEntry[]

  it('is satisfied only when the fixed Entry and a Target Entry are both selected', () => {
    const subject = work()
    expect(
      isPlannerConflictWorkSatisfied(
        subject,
        [entryId(ENTRY_A), entryId(ENTRY_B)],
        entries,
      ),
    ).toBe(true)
    // The Target is covered but the fixed choice was not honoured.
    expect(
      isPlannerConflictWorkSatisfied(subject, [entryId(ENTRY_B)], entries),
    ).toBe(false)
    // The fixed choice held but the Target is still uncovered.
    expect(
      isPlannerConflictWorkSatisfied(subject, [entryId(ENTRY_A)], entries),
    ).toBe(false)
  })

  it('treats a missing Plan as satisfying nothing', () => {
    expect(isPlannerConflictWorkSatisfied(work(), null, entries)).toBe(false)
  })
})

describe('B8-C4b trial adoption authority', () => {
  const fixed = [constraint(ENTRY_A)]
  const trial = entryId('build-list.constrained.trial')
  const adopted = [entryId('build-list.constrained.first')]

  it('adopts when the trial, the fixed and every earlier generated Entry are selected', () => {
    expect(
      isConstrainedTrialAdoptable(
        [trial, entryId(ENTRY_A), ...adopted],
        trial,
        fixed,
        adopted,
      ),
    ).toBe(true)
  })

  it('rejects a Plan that keeps the trial Entry by dropping the fixed Entry', () => {
    expect(
      isConstrainedTrialAdoptable([trial, ...adopted], trial, fixed, adopted),
    ).toBe(false)
  })

  it('rejects a Plan that drops a previously adopted generated Entry', () => {
    expect(
      isConstrainedTrialAdoptable(
        [trial, entryId(ENTRY_A)],
        trial,
        fixed,
        adopted,
      ),
    ).toBe(false)
  })

  it('rejects a Plan that does not select the trial Entry at all', () => {
    expect(
      isConstrainedTrialAdoptable(
        [entryId(ENTRY_A), ...adopted],
        trial,
        fixed,
        adopted,
      ),
    ).toBe(false)
  })
})

describe('B8-C4b orchestration without an explicit resolution', () => {
  it('returns the ordinary Planner result and runs no constrained enumeration', async () => {
    const parts = twoTargetParts()
    const counted = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const orchestrated = orchestrationScenario({
      targets: parts.targets,
      entries: parts.entries.map((entry) => structuredClone(entry)),
      ownedWeapons: parts.ownedWeapons,
      engine: { callCounts: counted },
    })
    const ordinaryCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const ordinary = orchestrationScenario({
      targets: parts.targets,
      entries: parts.entries.map((entry) => structuredClone(entry)),
      ownedWeapons: parts.ownedWeapons,
      engine: { callCounts: ordinaryCounts },
    })

    const result = await createProductionPlanWithConstrainedSearch(
      orchestrated.input,
      orchestrated.dependencies,
      // One Beam Search only: a Candidate trial would exhaust the budget and
      // leave a max_planner_reruns_reached warning behind.
      options({ maxPlannerReruns: 1 }),
    )
    const expected = await createProductionPlan(
      ordinary.input,
      ordinary.dependencies,
    )

    expect(result.generatedBuildListEntries).toEqual([])
    expect(result.plan).toEqual(expected.plan)
    expect(result.conflicts).toEqual(expected.conflicts)
    expect(result.warnings).toEqual(expected.warnings)
    // Identical Engine work proves no Candidate was enumerated.
    expect(counted).toEqual(ordinaryCounts)
  })

  it('never promotes recommendedBuildListEntryId to the fixed side', async () => {
    const parts = twoTargetParts()
    const built = orchestrationScenario({
      targets: parts.targets,
      entries: parts.entries,
      ownedWeapons: parts.ownedWeapons,
    })

    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options({ maxPlannerReruns: 1 }),
    )

    const conflict = result.conflicts.find(
      ({ kind }) => kind === 'same_gogma_counter',
    )
    expect(conflict).toBeDefined()
    expect(conflict?.recommendedBuildListEntryId).not.toBeNull()
    expect(conflict?.selectedBuildListEntryId).toBeNull()
    expect(result.generatedBuildListEntries).toEqual([])
    expect(warningKinds(result.warnings)).not.toContain(
      'max_planner_reruns_reached',
    )
  })

  it('stops before enumeration when a resolution cannot be turned into a fixed constraint', async () => {
    const parts = twoTargetParts()
    const built = fixedScenario(parts, 'plan-conflict:fnv1a32:deadbeef')

    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options({ maxPlannerReruns: 1 }),
    )

    expect(result.generatedBuildListEntries).toEqual([])
    expect(warningKinds(result.warnings)).toContain('invalid_conflict_resolution')
    expect(warningKinds(result.warnings)).not.toContain(
      'max_planner_reruns_reached',
    )
  })
})

describe('B8-C4b Candidate trial and adoption', () => {
  it('rejects the Candidates that collide with the fixed Entry and adopts a later one', async () => {
    const parts = twoTargetParts()
    const built = fixedScenario(parts)

    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options(),
    )

    expect(result.plan).not.toBeNull()
    expect(result.generatedBuildListEntries).toHaveLength(1)
    const generated = result.generatedBuildListEntries[0]
    expect(generated.targetWeaponId).toBe(TARGET_B)
    // The adopted Route reaches the very same Ideal result two Gogma
    // positions later, so it avoids the contested Counter entirely; every
    // Candidate that used it was rejected by the full Planner rerun.
    expect(generated.candidateSnapshot.route.kind).toBe('existing_gogma_mixed')
    expect(
      generated.candidateSnapshot.route.operations.map(({ type }) => type),
    ).toEqual(['reset_bonuses', 'reset_bonuses', 'reset_bonuses', 'reset_skills'])
    expect(
      generated.candidateSnapshot.route.operations.every(
        (operation) =>
          operation.type !== 'reset_bonuses' ||
          operation.gogmaCounterBefore !== CONFLICT_GOGMA_COUNTER ||
          operation.gogmaCounterAfter !== CONFLICT_GOGMA_COUNTER + 1 ||
          // The contested position may be passed by an unobserved prefix Reset
          // that the next Reset fully overwrites; what must not happen is the
          // adopted Candidate *ending* its Bonus amendment there.
          operation !== generated.candidateSnapshot.route.operations.at(-2),
      ),
    ).toBe(true)
    // The fixed Entry and the adopted generated Entry both survive.
    expect(result.plan?.selectedBuildListEntryIds).toEqual(
      [generated.id, entryId(ENTRY_A)].sort(),
    )
    expect(result.warnings).toEqual([])
  })

  it('leaves the caller PlannerInput untouched', async () => {
    const built = fixedScenario()
    const before = structuredClone(built.input)

    await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options(),
    )

    expect(built.input).toEqual(before)
  })

  it('keeps the final Plan snapshot hash over the original plus adopted Entries', async () => {
    const built = fixedScenario()
    const originalEntries = structuredClone(built.input.buildListEntries)

    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options(),
    )

    expect(result.plan).not.toBeNull()
    expect(result.plan?.baseSnapshot.buildListEntriesHash).toBe(
      createPlanningBuildListEntriesHash([
        ...originalEntries,
        ...result.generatedBuildListEntries,
      ]),
    )
    // A rejected trial Entry would change that hash, so none survived.
    expect(result.plan?.baseSnapshot.buildListEntriesHash).not.toBe(
      createPlanningBuildListEntriesHash(originalEntries),
    )
  })

  it('produces the same generated Entry IDs and selected set on an identical rerun', async () => {
    const first = fixedScenario()
    const second = fixedScenario()

    const left = await createProductionPlanWithConstrainedSearch(
      first.input,
      first.dependencies,
      options(),
    )
    const right = await createProductionPlanWithConstrainedSearch(
      second.input,
      second.dependencies,
      options(),
    )

    expect(right.generatedBuildListEntries.map(({ id }) => id)).toEqual(
      left.generatedBuildListEntries.map(({ id }) => id),
    )
    expect(right.plan?.selectedBuildListEntryIds).toEqual(
      left.plan?.selectedBuildListEntryIds,
    )
    expect(right.generatedBuildListEntries).toEqual(
      left.generatedBuildListEntries,
    )
  })

  it('returns no generated Entry when no Plan is produced', async () => {
    const parts = twoTargetParts()
    const built = orchestrationScenario({
      targets: parts.targets,
      entries: [],
      ownedWeapons: parts.ownedWeapons,
    })

    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options(),
    )

    expect(result.plan).toBeNull()
    expect(result.generatedBuildListEntries).toEqual([])
  })

  it('re-maps the fixed resolution onto the PlanConflict id a generated Entry changes', async () => {
    const parts = twoTargetParts()
    const built = fixedScenario(parts)
    const constraints = fixedConstraintsOf(built)
    const originalConflictId = constraints[0].originalConflictId

    // An Ideal Candidate for Target B that sits on the contested Gogma
    // Counter: adding it joins that very conflict and changes its id. The
    // enumerator also offers cheaper Skill-only Candidates, which is exactly
    // why the colliding one has to be picked deliberately here.
    let firstCandidate: ConstrainedCandidate | null = null
    await visitConstrainedCandidates(
      {
        origin: built.origin,
        targetWeaponId: TARGET_B as never,
        bounds: orchestrationEnumerationBounds(),
      },
      built.dependencies.rngEngine,
      (candidate) => {
        if (candidate.estimatedGogmaAdvance === 0) return 'continue'
        firstCandidate = candidate
        return 'stop'
      },
    )
    const candidate = firstCandidate as ConstrainedCandidate | null
    if (candidate === null) throw new Error('The enumerator yielded nothing.')
    expect(candidate.estimatedGogmaAdvance).toBeGreaterThan(0)

    const materialized = createConstrainedMaterializer({
      origin: built.origin,
      targetWeaponId: TARGET_B as never,
      bounds: orchestrationEnumerationBounds(),
      clock: built.dependencies.clock,
    }).materializeBuildListEntry(candidate, built.input.buildListEntries)
    expect(materialized.reusedExisting).toBe(false)

    const preflight = preparePlannerAugmentedConflictPreflight(
      {
        ...built.input,
        buildListEntries: [
          ...built.input.buildListEntries,
          materialized.entry,
        ],
      },
      constraints,
      built.dependencies,
    )

    expect(preflight.status).toBe('ready')
    if (preflight.status !== 'ready') return
    const current = preflight.conflictContexts.find(
      ({ kind, counterBefore, participants }) =>
        kind === 'same_gogma_counter' &&
        counterBefore === CONFLICT_GOGMA_COUNTER &&
        participants.some(
          ({ buildListEntryId }) => buildListEntryId === materialized.entry.id,
        ),
    )
    expect(current).toBeDefined()
    expect(current?.conflictId).not.toBe(originalConflictId)
    expect(preflight.conflictResolutions).toContainEqual<PlannerConflictResolution>({
      conflictKey: current?.conflictId ?? '',
      selectedBuildListEntryId: entryId(ENTRY_A),
    })
  })

  it('reuses an existing semantically identical Entry without a duplicate or a rerun', async () => {
    const source = fixedScenario()
    const first = await createProductionPlanWithConstrainedSearch(
      source.input,
      source.dependencies,
      options(),
    )
    const generated = first.generatedBuildListEntries[0]
    expect(generated).toBeDefined()

    const parts = twoTargetParts()
    const built = fixedScenario({
      ...parts,
      entries: [...parts.entries, structuredClone(generated)],
    })

    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      // Only the initial ordinary Beam Search is affordable, so any Candidate
      // trial rerun would surface as a max_planner_reruns_reached warning.
      options({ maxPlannerReruns: 1 }),
    )

    expect(result.plan?.selectedBuildListEntryIds).toContain(generated.id)
    expect(result.generatedBuildListEntries).toEqual([])
    expect(warningKinds(result.warnings)).not.toContain(
      'max_planner_reruns_reached',
    )
    expect(
      result.plan?.selectedBuildListEntryIds.filter((id) => id === generated.id),
    ).toHaveLength(1)
  })
})

/**
 * Target B reachable from two interchangeable sources.
 *
 * Both carry the same Practical five slots and the same non-Ideal Series
 * Skill, so each yields the very same one-operation Reset-Skills Candidate that
 * avoids the contested Gogma Counter. Every existing priority ties, and
 * `owned.orchestration.b` sorts before `owned.orchestration.d` on the Route
 * base key, so the stable key alone always delivers `b` first.
 */
function twoSourceTargetBParts(preferredForB: string | null): TwoTargetParts {
  const a = targetA()
  const b = skillTarget(TARGET_B)
  return {
    targets: [
      a,
      {
        ...b,
        preferredOwnedWeaponId: (preferredForB ?? null) as TargetWeapon['preferredOwnedWeaponId'],
      },
    ],
    ownedWeapons: [
      orchestrationSource(ORCHESTRATION_SOURCE_A, {
        seriesSkillId: SOURCE_A_SERIES_SKILL_ID,
      }),
      // Two equally adoptable sources: both already hold the Ideal five slots
      // and need the same single Reset Skills.
      orchestrationSource(ORCHESTRATION_SOURCE_B, {
        restorationBonuses: idealBonuses(),
        seriesSkillId: SOURCE_B_SERIES_SKILL_ID,
      }),
      orchestrationSource(SOURCE_D, {
        restorationBonuses: idealBonuses(),
        seriesSkillId: SOURCE_B_SERIES_SKILL_ID,
      }),
    ],
    entries: [idealEntryA(a), idealMixedEntry(ENTRY_B, b, ORCHESTRATION_SOURCE_B)],
  }
}

async function adoptedSourceForTargetB(
  preferredForB: string | null,
): Promise<string | null> {
  const parts = twoSourceTargetBParts(preferredForB)
  const built = fixedScenario(parts)
  const result = await createProductionPlanWithConstrainedSearch(
    built.input,
    built.dependencies,
    options(),
  )
  expect(result.plan).not.toBeNull()
  expect(result.generatedBuildListEntries).toHaveLength(1)
  const generated = result.generatedBuildListEntries[0]
  expect(generated.targetWeaponId).toBe(TARGET_B)
  expect(generated.candidateSnapshot.route.kind).toBe(
    'existing_gogma_reset_skills',
  )
  return generated.candidateSnapshot.route.sourceOwnedWeaponId
}

/**
 * The Production path: the orchestration consumes `visitConstrainedCandidates()`
 * one Candidate at a time and stops at the first adoptable trial, so the final
 * array sort of `enumerateConstrainedCandidates()` never runs here. Only a
 * preference inside the traversal priority can decide which source is adopted
 * (`docs/SEARCH_SPEC.md` 8.1).
 */
describe('B8-C4b constrained trial order and the Target preferred source', () => {
  it('trials and adopts the preferred source when both are equally adoptable', async () => {
    expect(await adoptedSourceForTargetB(SOURCE_D)).toBe(SOURCE_D)
  })

  it('adopts the other source when the preference points at it instead', async () => {
    // Flipping the preference flips the adopted source. A stable key cannot do
    // that: it would return `owned.orchestration.b` both times.
    expect(await adoptedSourceForTargetB(ORCHESTRATION_SOURCE_B)).toBe(
      ORCHESTRATION_SOURCE_B,
    )
  })

  it('falls back to the existing stable order with no preference', async () => {
    expect(await adoptedSourceForTargetB(null)).toBe(ORCHESTRATION_SOURCE_B)
  })
})

describe('B8-C4b orchestration bounds', () => {
  it('fails closed on invalid orchestration bounds instead of assuming a default', async () => {
    const built = fixedScenario()

    await expect(
      createProductionPlanWithConstrainedSearch(
        built.input,
        built.dependencies,
        options({ maxCandidateTrialsPerConflict: 0 }),
      ),
    ).rejects.toBeInstanceOf(PlannerOrchestrationBoundsError)
  })

  it('processes exactly maxCandidateTrialsPerConflict Candidates and stops on the next delivery', async () => {
    const short = fixedScenario()
    const stopped = await createProductionPlanWithConstrainedSearch(
      short.input,
      short.dependencies,
      options({ maxCandidateTrialsPerConflict: 3 }),
    )

    expect(stopped.generatedBuildListEntries).toEqual([])
    expect(warningKinds(stopped.warnings)).toContain(
      'max_candidate_trials_per_conflict_reached',
    )
  })

  it('raises no trial warning when the adopted Candidate is exactly the limit-th', async () => {
    // The fixture adopts on the fourth delivered Candidate. An implementation
    // that stopped right after consuming the limit-th trial, instead of on the
    // `limit + 1`-th delivery, would report a truncation that never happened.
    const exact = fixedScenario()
    const result = await createProductionPlanWithConstrainedSearch(
      exact.input,
      exact.dependencies,
      options({ maxCandidateTrialsPerConflict: 4 }),
    )

    expect(result.generatedBuildListEntries).toHaveLength(1)
    expect(result.warnings).toEqual([])
  })

  it('shares one trial budget across every Target of the same original conflict', async () => {
    const parts = threeTargetParts()
    const built = fixedScenario(parts)

    // Four trials adopt Target B's Candidate; Target C's work then finds the
    // shared budget already spent instead of a fresh one of its own.
    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options({ maxCandidateTrialsPerConflict: 5 }),
    )

    expect(
      result.generatedBuildListEntries.map(({ targetWeaponId }) => targetWeaponId),
    ).toEqual([TARGET_B])
    expect(warningKinds(result.warnings)).toContain(
      'max_candidate_trials_per_conflict_reached',
    )
    // One warning per original conflict, never one per Target work.
    expect(
      warningKinds(result.warnings).filter(
        (kind) => kind === 'max_candidate_trials_per_conflict_reached',
      ),
    ).toHaveLength(1)
  })

  it('counts only adopted Entries against maxGeneratedBuildListEntries', async () => {
    // Four Candidates are materialized and rejected before the fifth is
    // adopted, yet a cap of 1 is still enough for that single adoption.
    const built = fixedScenario()
    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options({ maxGeneratedBuildListEntries: 1 }),
    )

    expect(result.generatedBuildListEntries).toHaveLength(1)
    expect(warningKinds(result.warnings)).not.toContain(
      'max_generated_build_list_entries_reached',
    )
  })

  it('warns only when the Entry cap blocks work that is still unresolved', async () => {
    const parts = threeTargetParts()
    const built = fixedScenario(parts)

    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options({ maxGeneratedBuildListEntries: 1 }),
    )

    expect(
      result.generatedBuildListEntries.map(({ targetWeaponId }) => targetWeaponId),
    ).toEqual([TARGET_B])
    expect(warningKinds(result.warnings)).toContain(
      'max_generated_build_list_entries_reached',
    )
  })

  it('counts the initial ordinary Beam Search and every Candidate trial against maxPlannerReruns', async () => {
    // The fixture processes four Candidates before adopting one, and each of
    // them reaches a Beam Search. So the whole run needs one initial ordinary
    // Beam Search plus three trial ones - three executions are one short, four
    // are exactly enough.
    const short = fixedScenario()
    const shortResult = await createProductionPlanWithConstrainedSearch(
      short.input,
      short.dependencies,
      options({ maxPlannerReruns: 3 }),
    )
    expect(shortResult.plan).not.toBeNull()
    expect(shortResult.generatedBuildListEntries).toEqual([])
    expect(warningKinds(shortResult.warnings)).toContain(
      'max_planner_reruns_reached',
    )

    const exact = fixedScenario()
    const exactResult = await createProductionPlanWithConstrainedSearch(
      exact.input,
      exact.dependencies,
      options({ maxPlannerReruns: 4 }),
    )
    expect(exactResult.generatedBuildListEntries).toHaveLength(1)
    expect(exactResult.warnings).toEqual([])
  })

  it('returns a safe result when the rerun bound stops a retry inside the initial generation', async () => {
    // The runtime-unsupported fixture needs two full Beam Searches; the first
    // one's Trace Replay never succeeded, so no Plan may be assembled from it.
    const { input, dependencies } = runtimeUnsupportedFixture()

    const result = await createProductionPlanWithConstrainedSearch(
      input,
      dependencies,
      options({ maxPlannerReruns: 1 }),
    )

    expect(result.plan).toBeNull()
    expect(result.generatedBuildListEntries).toEqual([])
    expect(warningKinds(result.warnings)).toEqual(['max_planner_reruns_reached'])
  })

  it('completes the same fixture when the rerun bound allows the retry', async () => {
    const { input, dependencies } = runtimeUnsupportedFixture()

    const result = await createProductionPlanWithConstrainedSearch(
      input,
      dependencies,
      options({ maxPlannerReruns: 2 }),
    )

    expect(result.plan).not.toBeNull()
    expect(warningKinds(result.warnings)).not.toContain(
      'max_planner_reruns_reached',
    )
  })

  it('reports a constrained enumeration bound stop instead of silent exhaustion', async () => {
    // Target B's source is below the Practical line, so a Reset-Skills-only
    // Candidate cannot satisfy it and every reachable Candidate collides with
    // the fixed Entry at the contested Gogma Counter.
    const parts = twoTargetParts(belowPracticalBonuses())
    const built = fixedScenario(parts)

    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options({}, orchestrationEnumerationBounds({ maxGogmaAdvance: 1 })),
    )

    expect(result.plan).not.toBeNull()
    expect(result.generatedBuildListEntries).toEqual([])
    expect(warningKinds(result.warnings)).toContain(
      'constrained_enumeration_bound_reached',
    )
  })
})

/**
 * Counts `PlannerClock` calls on an existing scenario.
 *
 * Production Plan assembly calls the Clock once per assembled Plan, and the
 * B8-C2 materializer calls it once per `materializeBuildListEntry()`. So the
 * total is `assembled Plans + materialized Candidates`, which is what makes a
 * materialization that should never have happened visible from outside.
 */
function countingClock(built: OrchestrationScenario): { calls: number } {
  const state = { calls: 0 }
  const inner = built.dependencies.clock
  built.dependencies.clock = {
    now: () => {
      state.calls += 1
      return inner.now()
    },
  }
  return state
}

describe('B8-C4b maxPlannerReruns stops orchestration work, not only the next Beam', () => {
  it('starts no enumeration or materialization when the budget is already spent and work remains', async () => {
    const parts = twoTargetParts()
    const counted = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const built = orchestrationScenario({
      targets: parts.targets,
      entries: parts.entries,
      ownedWeapons: parts.ownedWeapons,
      conflictResolutions: [{
        conflictKey: gogmaConflictId(twoTargetParts()),
        selectedBuildListEntryId: parts.entries[0].id,
      }],
      engine: { callCounts: counted },
    })
    const clock = countingClock(built)

    // The initial ordinary Beam Search spends the only affordable execution,
    // and Target B is left unresolved because Target A is the fixed side.
    const result = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      options({ maxPlannerReruns: 1 }),
    )

    expect(warningKinds(result.warnings)).toContain('max_planner_reruns_reached')
    expect(result.generatedBuildListEntries).toEqual([])

    // Exactly one Clock call: the initial Plan's own assembly. A Candidate that
    // was enumerated and materialized before the budget was noticed would add
    // at least one more.
    expect(clock.calls).toBe(1)

    // The same scenario, including the same explicit resolution, run through
    // the ordinary Planner only. Without the resolution the Beam Search would
    // pick a different Entry and do different prediction work, which would make
    // the comparison meaningless.
    const ordinaryParts = twoTargetParts()
    const ordinaryCounts = { normal: 0, skill: 0, gogmaReset: 0, gogmaKeep: 0 }
    const ordinary = orchestrationScenario({
      targets: ordinaryParts.targets,
      entries: ordinaryParts.entries,
      ownedWeapons: ordinaryParts.ownedWeapons,
      conflictResolutions: [{
        conflictKey: gogmaConflictId(twoTargetParts()),
        selectedBuildListEntryId: ordinaryParts.entries[0].id,
      }],
      engine: { callCounts: ordinaryCounts },
    })
    await createProductionPlan(ordinary.input, ordinary.dependencies)

    // Identical Engine prediction work proves the constrained enumerator never
    // ran: it is the only other producer of these calls.
    expect(counted).toEqual(ordinaryCounts)
  })

  it('requests no further Candidate once a rejected trial spends the last Beam Search', async () => {
    // The fixture needs four Beam Searches - one initial plus three trials -
    // and adopts on the fourth delivered Candidate.
    const complete = fixedScenario()
    const completeClock = countingClock(complete)
    const completed = await createProductionPlanWithConstrainedSearch(
      complete.input,
      complete.dependencies,
      options({ maxPlannerReruns: 4 }),
    )
    expect(completed.generatedBuildListEntries).toHaveLength(1)
    // Four assembled Plans plus four materialized Candidates.
    expect(completeClock.calls).toBe(8)

    const stopped = fixedScenario()
    const stoppedClock = countingClock(stopped)
    const result = await createProductionPlanWithConstrainedSearch(
      stopped.input,
      stopped.dependencies,
      options({ maxPlannerReruns: 3 }),
    )

    expect(warningKinds(result.warnings)).toContain('max_planner_reruns_reached')
    expect(result.generatedBuildListEntries).toEqual([])
    // Three assembled Plans plus three materialized Candidates. The fourth
    // Candidate is never delivered or materialized, because the third trial
    // was rejected with the budget already spent.
    expect(stoppedClock.calls).toBe(6)
    expect(stoppedClock.calls).toBeLessThan(completeClock.calls)
  })
})

describe('B8-C4b cancellation stays an ordinary Planner outcome', () => {
  it('returns the ordinary cancelled result instead of a Search cancellation error', async () => {
    const parts = twoTargetParts()
    const built = fixedScenario(parts)

    const outcome = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      {
        ...options(),
        executionOptions: { shouldCancel: () => true },
      },
    ).then(
      (value) => ({ resolved: true as const, value }),
      (error: unknown) => ({ resolved: false as const, error }),
    )

    // Handing the same shouldCancel to the constrained enumerator would reject
    // with CandidateSearchError('cancelled') instead.
    expect(outcome.resolved).toBe(true)
    if (!outcome.resolved) return
    expect(outcome.value.plan).toBeNull()
    expect(outcome.value.generatedBuildListEntries).toEqual([])

    const ordinary = fixedScenario(twoTargetParts())
    const expected = await createProductionPlan(
      ordinary.input,
      ordinary.dependencies,
      { shouldCancel: () => true },
    )
    expect(outcome.value.plan).toEqual(expected.plan)
    expect(outcome.value.conflicts).toEqual(expected.conflicts)
    expect(outcome.value.warnings).toEqual(expected.warnings)
  })

  it('ends the orchestration when a Candidate trial is cancelled', async () => {
    const built = fixedScenario()
    const clock = countingClock(built)
    // The Clock is the deterministic trigger: it is first called when the
    // initial ordinary Plan is assembled, and again when the first Candidate is
    // materialized. Cancellation therefore switches on inside the first
    // Candidate trial, after the initial run has completed normally.
    const outcome = await createProductionPlanWithConstrainedSearch(
      built.input,
      built.dependencies,
      {
        ...options(),
        executionOptions: { shouldCancel: () => clock.calls >= 2 },
      },
    ).then(
      (value) => ({ resolved: true as const, value }),
      (error: unknown) => ({ resolved: false as const, error }),
    )

    expect(outcome.resolved).toBe(true)
    if (!outcome.resolved) return
    // A Candidate trial really was reached, so this is the trial path and not
    // the initial-run one.
    expect(clock.calls).toBeGreaterThanOrEqual(2)
    // The last accepted result is returned; the enumerator is never resumed to
    // its next checkpoint, so no Search cancellation error is raised.
    expect(outcome.value.plan).not.toBeNull()
    expect(outcome.value.generatedBuildListEntries).toEqual([])
    expect(outcome.value.warnings).toEqual([])
  })
})
