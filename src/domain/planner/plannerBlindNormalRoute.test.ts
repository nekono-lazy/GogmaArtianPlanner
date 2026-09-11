import { describe, expect, it, vi } from 'vitest'
import type { BuildRoute, RestorationBonusSet } from '../models/publicTypes'
import { createRestorationBonusSet } from '../../test/fixtures/domainData'
import {
  fixture,
  routeEntry,
  synchronizeEntry,
  target,
} from '../../test/fixtures/plannerBeam'
import { createPlannerRouteUnitPlans } from './plannerRouteProgress'
import { replayPlannerSearchTrace } from './plannerTraceReplay'
import { runPlannerBeamSearch } from './plannerBeamSearch'
import { createProductionPlan } from './productionPlanGeneration'
import { validatePlannerInput } from './plannerValidation'
import type {
  PlannerDependencies,
  PlannerInput,
  PlannerSearchAction,
} from './plannerTypes'

/**
 * The forced Reset Bonuses Normal Artian route of `docs/SEARCH_SPEC.md` 6.1.1,
 * executed by the Planner with no confirmed Normal Artian Counter at all.
 */
function blindRoute(
  skillCounterBefore: number,
  gogmaCounterBefore: number,
  weaponTypeId = 'weapon.fixture.a',
): BuildRoute {
  return {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      {
        type: 'create_normal_artian',
        weaponTypeId,
        rarity: 8,
        count: 1,
        normalCounterBefore: null,
        normalCounterAfter: null,
      },
      {
        type: 'convert_normal_to_gogma',
        weaponTypeId,
        skillCounterBefore,
        skillCounterAfter: skillCounterBefore + 1,
      },
      {
        type: 'reset_bonuses',
        sourceOwnedWeaponId: null,
        gogmaCounterBefore,
        gogmaCounterAfter: gogmaCounterBefore + 1,
      },
    ],
  }
}

function predictedRoute(): BuildRoute {
  return {
    kind: 'normal_artian_to_gogma',
    sourceOwnedWeaponId: null,
    operations: [
      {
        type: 'create_normal_artian',
        weaponTypeId: 'weapon.fixture.a',
        rarity: 8,
        count: 1,
        normalCounterBefore: 4,
        normalCounterAfter: 5,
      },
      {
        type: 'convert_normal_to_gogma',
        weaponTypeId: 'weapon.fixture.a',
        skillCounterBefore: 7,
        skillCounterAfter: 8,
      },
      {
        type: 'reset_bonuses',
        sourceOwnedWeaponId: null,
        gogmaCounterBefore: 10,
        gogmaCounterAfter: 11,
      },
    ],
  }
}

const resetResult = (): RestorationBonusSet => createRestorationBonusSet()

/** No owned weapons, and no Normal Artian Counter record at all. */
function blindFixture(entries: Parameters<typeof fixture>[1], targets: Parameters<typeof fixture>[0]) {
  const built = fixture(targets, entries)
  built.input.normalCounters = []
  entries.forEach((entry) => synchronizeEntry(built.input, entry))
  mockPredictions(built.dependencies)
  return built
}

function mockPredictions(dependencies: PlannerDependencies) {
  vi.spyOn(dependencies.rngEngine, 'predictSkills').mockReturnValue({
    seriesSkillId: 'series_skill.fixture.a',
    groupSkillId: null,
  })
  vi.spyOn(dependencies.rngEngine, 'predictGogmaBonus').mockReturnValue(resetResult())
  return vi.spyOn(dependencies.rngEngine, 'predictNormalArtian')
}

function blindEntry(
  id: string,
  targetId: string,
  skillCounter = 7,
  gogmaCounter = 10,
  weaponTypeId = 'weapon.fixture.a',
) {
  const targetWeapon = { ...target(targetId), weaponTypeId }
  const entry = routeEntry(
    id,
    targetWeapon,
    blindRoute(skillCounter, gogmaCounter, weaponTypeId),
  )
  entry.candidateSnapshot.restorationBonusScope = 'gogma_artian'
  entry.candidateSnapshot.estimatedNormalAdvance = null
  return { targetWeapon, entry }
}

describe('Planner execution of the forced Reset Normal Artian route', () => {
  it('treats a blind creation as a required step with no Counter position', () => {
    const { targetWeapon, entry } = blindEntry('entry.blind.units', 'target.blind.units')
    const { input, dependencies } = blindFixture([entry], [targetWeapon])
    const { unitPlans, rejections } = createPlannerRouteUnitPlans(
      input.buildListEntries,
      dependencies.rngEngine,
    )
    expect(rejections).toEqual([])
    const units = unitPlans.get(entry.id) ?? []
    expect(units).toHaveLength(3)
    expect(units[0]).toEqual(expect.objectContaining({
      counterStream: null,
      counterId: null,
      counterBefore: null,
      counterAfter: null,
      shareable: false,
      canSkipWhenCounterPassed: false,
    }))
  })

  it('plans create, convert, Reset, and reserve without a Normal Counter', async () => {
    const { targetWeapon, entry } = blindEntry('entry.blind.plan', 'target.blind.plan')
    const { input, dependencies } = blindFixture([entry], [targetWeapon])

    const validation = validatePlannerInput(input, dependencies)
    expect(validation.validBuildListEntries.map(({ entry: valid }) => valid.id))
      .toEqual([entry.id])

    const beam = await runPlannerBeamSearch(input, dependencies)
    expect(beam.rejections.filter(({ reason }) => reason === 'counter_unavailable'))
      .toEqual([])
    expect(beam.bestState?.selectedBuildListEntryIds).toEqual([entry.id])

    const { plan, warnings } = await createProductionPlan(input, dependencies)
    expect(warnings).toEqual([])
    expect(plan?.steps.map(({ operationType }) => operationType)).toEqual([
      'create_normal_artian',
      'convert_normal_to_gogma',
      'reset_bonuses',
      'reserve_weapon',
    ])
    const create = plan?.steps[0]
    // The Normal Counter is unknown, so nothing claims it advanced or did not.
    expect(create?.rngAdvance).toEqual({
      gogmaCounterDelta: 0,
      skillCounterDelta: 0,
      normalCounterDelta: null,
      affectedNormalCounterId: null,
    })
    expect(create?.expectedResult?.restorationBonuses).toBeNull()
    expect(create?.expectedResult?.restorationBonusScope).toBeNull()
    expect(create?.instruction).toContain('復元ボーナス内容は問いません')
    expect(plan?.steps[1].expectedResult?.restorationBonuses).toBeNull()
    expect(plan?.steps[2].expectedResult).toEqual(expect.objectContaining({
      restorationBonuses: resetResult(),
      restorationBonusScope: 'gogma_artian',
    }))
    expect(plan?.steps[3].expectedResult?.shouldSecure).toBe(true)
  })

  it('still rejects a predicted Normal route without a confirmed Counter', async () => {
    const targetWeapon = target('target.blind.predicted')
    const entry = routeEntry('entry.blind.predicted', targetWeapon, predictedRoute())
    const { input, dependencies } = blindFixture([entry], [targetWeapon])
    const validation = validatePlannerInput(input, dependencies)
    expect(validation.validBuildListEntries).toEqual([])
    expect(validation.excludedBuildListEntries).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({ id: entry.id }),
        reason: expect.stringContaining('normal_artian_counter:weapon.fixture.a:8'),
      }),
    ])
  })

  it('never shares the create or convert action between two blind Entries', async () => {
    // Different weapon types, so one secured weapon cannot satisfy both
    // Targets and both Routes really have to run.
    const first = blindEntry('entry.blind.first', 'target.blind.first', 7, 10)
    const second = blindEntry(
      'entry.blind.second',
      'target.blind.second',
      8,
      11,
      'weapon.fixture.b',
    )
    const { input, dependencies } = blindFixture(
      [first.entry, second.entry],
      [first.targetWeapon, second.targetWeapon],
    )

    const { plan, conflicts } = await createProductionPlan(input, dependencies)
    expect(conflicts).toEqual([])
    const byType = (type: string) =>
      plan?.steps.filter(({ operationType }) => operationType === type) ?? []
    // Two transient Gogma weapons are two physical weapons (PR #4), so the
    // identical RNG transition is never collapsed into one shared action.
    expect(byType('create_normal_artian')).toHaveLength(2)
    expect(byType('convert_normal_to_gogma')).toHaveLength(2)
    expect(byType('reserve_weapon')).toHaveLength(2)
    byType('create_normal_artian').forEach((step) => {
      expect(step.progressedTargetWeaponIds).toHaveLength(1)
    })
    expect(plan?.selectedBuildListEntryIds.sort()).toEqual(
      [first.entry.id, second.entry.id].sort(),
    )
  })
})

describe('Trace Replay of the forced Reset Normal Artian route', () => {
  async function blindTrace() {
    const { targetWeapon, entry } = blindEntry('entry.blind.replay', 'target.blind.replay')
    const { input, dependencies } = blindFixture([entry], [targetWeapon])
    const predictNormalArtian = vi.spyOn(dependencies.rngEngine, 'predictNormalArtian')
    const beam = await runPlannerBeamSearch(input, dependencies)
    if (!beam.bestState) throw new Error('Fixture Beam Search produced no state.')
    return { input, dependencies, entry, beam, predictNormalArtian }
  }

  function replayTrace(
    input: PlannerInput,
    dependencies: PlannerDependencies,
    bestState: NonNullable<Awaited<ReturnType<typeof runPlannerBeamSearch>>['bestState']>,
    trace: PlannerSearchAction[],
  ) {
    return replayPlannerSearchTrace(input, { ...bestState, trace }, dependencies.rngEngine)
  }

  it('predicts no Normal Artian and turns unknown into known at the Reset', async () => {
    const { input, dependencies, beam, predictNormalArtian } = await blindTrace()
    const replay = replayPlannerSearchTrace(
      input,
      beam.bestState!,
      dependencies.rngEngine,
    )
    expect(replay.isValid).toBe(true)
    expect(predictNormalArtian).not.toHaveBeenCalled()
    expect(replay.drafts[0].isBlindNormalCreation).toBe(true)
    expect(replay.drafts[0].expectedResult?.restorationBonuses).toBeNull()
    expect(replay.drafts[1].expectedResult?.restorationBonuses).toBeNull()
    expect(replay.drafts[2].expectedResult).toEqual(expect.objectContaining({
      restorationBonuses: resetResult(),
      restorationBonusScope: 'gogma_artian',
    }))
  })

  it('fails closed when a Candidate is secured before the Reset', async () => {
    const { input, dependencies, beam } = await blindTrace()
    const trace = beam.bestState!.trace
    const convert = trace[1]
    const reserve = trace[3]
    // A reserve action changes no Counter, so it replays directly after the
    // conversion; only the unknown five slots can stop it.
    const replay = replayTrace(input, dependencies, beam.bestState!, [
      trace[0],
      convert,
      { ...reserve, rngBefore: convert.rngAfter, rngAfter: convert.rngAfter },
    ])
    expect(replay.isValid).toBe(false)
    expect(replay.issues).toEqual([
      expect.objectContaining({ code: 'unknown_restoration_bonuses', actionIndex: 2 }),
    ])
  })

  it('fails closed when Keep Bonuses reads never-predicted slots', async () => {
    const { input, dependencies, beam } = await blindTrace()
    const trace = beam.bestState!.trace
    const reset = trace[2]
    if (reset.kind !== 'route_operation' || reset.routeOperation.type !== 'reset_bonuses') {
      throw new Error('Fixture trace is not a Reset Bonuses action.')
    }
    const keep: PlannerSearchAction = {
      ...reset,
      actionType: 'keep_bonuses',
      routeOperation: { ...reset.routeOperation, type: 'keep_bonuses' },
    }
    const replay = replayTrace(input, dependencies, beam.bestState!, [
      trace[0],
      trace[1],
      keep,
    ])
    expect(replay.isValid).toBe(false)
    expect(replay.issues).toEqual([
      expect.objectContaining({ code: 'unknown_restoration_bonuses', actionIndex: 2 }),
    ])
  })
})
