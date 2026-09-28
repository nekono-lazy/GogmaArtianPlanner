import { describe, expect, it } from 'vitest'
import { createTargetDefinitionHash } from '../buildList'
import {
  createReferencedOwnedWeaponsHash,
  createSearchStateHash,
} from '../models/hashing'
import {
  createCandidateSearchEngine,
  createCandidateSearchInput,
} from '../../test/fixtures/candidateSearch'
import { createValidBuildListEntry } from '../../test/fixtures/domainData'
import { runtimeUnsupportedFixture } from '../../test/fixtures/plannerRuntimeUnsupported'
import {
  createProductionPlan,
  createProductionPlanWithObserver,
} from './productionPlanGeneration'
import {
  defaultPlannerOptions,
  type PlannerDependencies,
  type PlannerInput,
  type ProductionPlanGenerationObserver,
  type ProductionPlanGenerationPhase,
} from './plannerTypes'

/**
 * Issue #154 Phase 2-B: the optional tail phase observer
 * (`ProductionPlanGenerationObserver.onPlanGenerationPhase`) is performance
 * observation only. With or without it, and with no observer at all, the
 * PlannerResult is identical.
 */
function singleRunFixture(): { input: PlannerInput; dependencies: PlannerDependencies } {
  const searchInput = createCandidateSearchInput()
  const entry = createValidBuildListEntry()
  entry.calculationContext = structuredClone(searchInput.calculationContext)
  entry.candidateSnapshot.calculationContext = structuredClone(searchInput.calculationContext)
  entry.targetDefinitionHash = createTargetDefinitionHash(searchInput.targetWeapons[0])
  entry.searchStateHash = createSearchStateHash(entry.candidateSnapshot.route, searchInput.rngState, searchInput.normalCounters)
  entry.candidateSnapshot.searchStateHash = entry.searchStateHash
  entry.referencedOwnedWeaponsHash = createReferencedOwnedWeaponsHash(entry.candidateSnapshot.route, [])
  entry.candidateSnapshot.referencedOwnedWeaponsHash = entry.referencedOwnedWeaponsHash
  let planCount = 0, stepCount = 0, ownedCount = 0
  return {
    input: {
      rngState: structuredClone(searchInput.rngState),
      normalCounters: structuredClone(searchInput.normalCounters),
      ownedWeapons: [],
      targetWeapons: structuredClone(searchInput.targetWeapons),
      buildListEntries: [entry],
      calculationContext: structuredClone(searchInput.calculationContext),
      options: { ...defaultPlannerOptions },
      master: structuredClone(searchInput.master),
      conflictResolutions: [],
    },
    dependencies: {
      rngEngine: createCandidateSearchEngine(searchInput),
      idFactory: {
        productionPlanId: () => `plan.phase.${++planCount}` as never,
        planStepId: () => `step.phase.${++stepCount}` as never,
        ownedWeaponId: () => `owned.phase.${++ownedCount}` as never,
      },
      clock: { now: () => '2026-09-01T00:00:00.000Z' },
    },
  }
}

function recordingObserver() {
  const events: string[] = []
  const observer: ProductionPlanGenerationObserver = {
    beforePlannerRun: () => { events.push('before_run') },
    afterPlannerRun: () => { events.push('after_run') },
    onPlanGenerationPhase: (phase: ProductionPlanGenerationPhase) => { events.push(phase) },
  }
  return { events, observer }
}

const TAIL_PHASES = ['post_processing', 'execution_projection', 'planning_input_snapshot', 'checkpoint_defence',
  'rejected_build_list_entries', 'required_materials', 'plan_assembly', 'completed']

describe('Production Plan generation tail phase observer (Issue #154 Phase 2-B)', () => {
  it('returns exactly the same PlannerResult with the phase observer, without it, and with no observer', async () => {
    const withPhase = singleRunFixture(), withoutPhase = singleRunFixture(), none = singleRunFixture()
    const { events, observer } = recordingObserver()
    const observed = await createProductionPlanWithObserver(withPhase.input, withPhase.dependencies, undefined, observer)
    const plain = await createProductionPlanWithObserver(withoutPhase.input, withoutPhase.dependencies, undefined, { beforePlannerRun: () => {} })
    const ordinary = await createProductionPlan(none.input, none.dependencies)

    expect(observed.plan).not.toBeNull()
    expect(observed).toEqual(plain)
    expect(observed).toEqual(ordinary)
    expect(JSON.stringify(observed)).toBe(JSON.stringify(ordinary))
    expect(events).toEqual(['before_run', 'after_run', 'trace_replay', ...TAIL_PHASES])
  })

  it('reports Trace Replay once per replayed full run of a runtime-unsupported retry, with an unchanged result', async () => {
    const observedFixture = runtimeUnsupportedFixture(), plainFixture = runtimeUnsupportedFixture()
    const { events, observer } = recordingObserver()
    const observed = await createProductionPlanWithObserver(observedFixture.input, observedFixture.dependencies, undefined, observer)
    const plain = await createProductionPlan(plainFixture.input, plainFixture.dependencies)

    expect(observed).toEqual(plain)
    expect(events).toEqual(['before_run', 'after_run', 'trace_replay', 'before_run', 'after_run', 'trace_replay', ...TAIL_PHASES])
  })

  it('reports no tail phase for a run that returns no Plan, and leaves the input unchanged', async () => {
    const fixture = singleRunFixture()
    fixture.input.buildListEntries = []
    const before = structuredClone(fixture.input)
    const { events, observer } = recordingObserver()
    const result = await createProductionPlanWithObserver(fixture.input, fixture.dependencies, undefined, observer)

    expect(result.plan).toBeNull()
    expect(events.filter(event => TAIL_PHASES.includes(event))).toEqual(['post_processing'])
    expect(events).not.toContain('completed')
    expect(fixture.input).toEqual(before)
  })

  it('propagates a throw from the phase observer unchanged', async () => {
    const fixture = singleRunFixture()
    const failure = new Error('phase observer failure')
    await expect(createProductionPlanWithObserver(fixture.input, fixture.dependencies, undefined, {
      beforePlannerRun: () => {},
      onPlanGenerationPhase: phase => { if (phase === 'execution_projection') throw failure },
    })).rejects.toBe(failure)
  })
})
