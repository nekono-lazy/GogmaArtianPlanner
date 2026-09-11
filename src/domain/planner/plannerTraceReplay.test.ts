import { describe, expect, it, vi } from 'vitest'
import { createExpectedPlanState } from '../models/hashing'
import { FakeRngEngine } from '../rng/fakeRngEngine'
import { buildListEntryId, candidateId, createRestorationBonusSet, createValidBuildListEntry, createValidNormalArtianCounter, createValidRngState, createValidTargetWeapon, ownedWeaponId } from '../../test/fixtures/domainData'
import { createSimulatedInventory } from './simulatedInventory'
import { replayPlannerSearchTrace } from './plannerTraceReplay'
import type { PlannerInput, PlannerSearchAction, PlannerSearchState } from './plannerTypes'

function fixture() {
  const entry = createValidBuildListEntry(); entry.id = buildListEntryId('entry.replay'); entry.candidateId = candidateId('candidate.replay'); entry.candidateSnapshot.id = entry.candidateId
  entry.candidateSnapshot.route = { kind: 'normal_artian_to_gogma', sourceOwnedWeaponId: null, operations: [{ type: 'create_normal_artian', weaponTypeId: 'weapon.fixture.a', rarity: 8, count: 2, normalCounterBefore: 4, normalCounterAfter: 6 }, { type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.fixture.a', skillCounterBefore: 7, skillCounterAfter: 8 }] }
  const rngState = createValidRngState(); rngState.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }; const normal = createValidNormalArtianCounter(); const target = createValidTargetWeapon()
  const input: PlannerInput = { rngState, normalCounters: [normal], ownedWeapons: [], targetWeapons: [target], buildListEntries: [entry], calculationContext: { gameVersion: 'x', masterDataVersion: 1, rngEngineVersion: 'x', appSchemaVersion: 1 }, options: { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 10000 }, master: { weaponBonusDefinitions: [], weaponTypes: [], elements: [], bonusTypes: [], lotteries: [], bonusRanks: [], materialCosts: [] }, conflictResolutions: [] }
  const snap = (g: number, s: number, n: number) => ({ gogmaCounter: g, skillCounter: s, normalCounters: [{ id: normal.id, counter: n }] })
  const create = entry.candidateSnapshot.route.operations[0]
  const convert = entry.candidateSnapshot.route.operations[1]
  const route = (operation: typeof create | typeof convert, before: ReturnType<typeof snap>, after: ReturnType<typeof snap>): PlannerSearchAction => ({ kind: 'route_operation', actionType: operation.type, primaryBuildListEntryId: entry.id, progressedBuildListEntryIds: [entry.id], progressedRoutePositions: {}, routeOperation: operation, ownedWeaponId: null, plannerOnly: false, rngBefore: before, rngAfter: after, inventoryEffect: { addedOwnedWeaponIds: [], removedOwnedWeaponIds: [], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [], routeOutputChangedForEntryIds: [] }, satisfactionChanges: [] })
  const trace = [route(create, snap(10, 7, 4), snap(10, 7, 5)), route(create, snap(10, 7, 5), snap(10, 7, 6)), route(convert, snap(10, 7, 6), snap(10, 8, 6))]
  const finalRng = structuredClone(rngState); finalRng.skillCounter.value = 8; const finalNormal = [{ ...normal, counter: 6 }]
  const state: PlannerSearchState = { currentRngState: finalRng, currentNormalCounters: finalNormal, simulatedInventory: createSimulatedInventory([]).inventory!, targetSatisfaction: {}, selectedBuildListEntryIds: [], routeProgressByEntryId: {}, routeRuntimeByEntryId: {}, sourceMutationVersionByOwnedWeaponId: {}, candidateReadySourceVersionByEntryId: {}, routeSourceVersionByEntryId: {}, inFlightExistingSourceByOwnedWeaponId: {}, securedOwnedWeaponIdByEntryId: {}, practicalFirstProgressTargetIds: [], trace, weaponSwitchCount: 0, preferredSourceProgressCount: 0, lastWeaponOperationSubjectKey: null, totalCost: 0, evaluationScore: 0 }
  const a = createRestorationBonusSet(); const b = structuredClone(a); b[0].bonusRankId = 'bonus_rank.fixture.low'; const g = structuredClone(a); g[1].bonusRankId = 'bonus_rank.fixture.low'
  const engine = new FakeRngEngine({ version: 'replay', capabilities: { supportsSeedSearch: false, supportsNormalArtianPrediction: true, supportsGogmaPrediction: true, supportsSkillPrediction: true, supportsKeepBonusesPrediction: false }, normalizedSeeds: [], skillPredictions: [{ input: { baseSeed: rngState.baseSeed.value!, skillCounter: 7, weaponTypeId: target.weaponTypeId, elementId: target.elementId, master: input.master }, result: { seriesSkillId: 'series_skill.fixture.a', groupSkillId: null } }], keepBonusPredictions: [], gogmaCounterAdvances: [], skillCounterAdvances: [{ current: 7, operation: { type: 'convert_normal_to_gogma' }, result: 8 }], normalCounterAdvances: [], normalArtianPredictions: [{ input: { baseSeed: rngState.baseSeed.value!, weaponTypeId: normal.weaponTypeId, elementId: 'element.fixture.a', rarity: 8, normalCounter: 4, master: input.master }, result: a }, { input: { baseSeed: rngState.baseSeed.value!, weaponTypeId: normal.weaponTypeId, elementId: 'element.fixture.a', rarity: 8, normalCounter: 5, master: input.master }, result: b }], resetBonusPredictions: [{ input: { baseSeed: rngState.baseSeed.value!, gogmaCounter: 10, weaponTypeId: target.weaponTypeId, elementId: target.elementId, operation: { type: 'reset_bonuses' }, master: input.master }, result: g }] })
  return { input, state, engine, trace, a, b, g, entry, target, normal }
}

describe('Planner trace replay', () => {
  it('splits count=2, converts the latest transient Normal output, and chains expected hashes', () => {
    const { input, state, engine, a, b, entry, target, trace } = fixture()
    input.rngState.counterGate = { value: null, isConfirmed: false, source: null }
    entry.candidateSnapshot.finalBonuses = structuredClone(b); entry.candidateSnapshot.restorationBonusScope = 'normal_artian'; entry.candidateSnapshot.seriesSkillId = 'series_skill.fixture.a'; entry.candidateSnapshot.groupSkillId = null
    const reservedId = ownedWeaponId('owned.replay.reserve')
    const last = trace.at(-1)!.rngAfter
    trace.push({ kind: 'reserve_candidate', actionType: 'reserve_weapon', primaryBuildListEntryId: entry.id, progressedBuildListEntryIds: [entry.id], progressedRoutePositions: {}, routeOperation: null, ownedWeaponId: reservedId, plannerOnly: true, candidateCategory: entry.candidateSnapshot.category, rngBefore: last, rngAfter: last, inventoryEffect: { addedOwnedWeaponIds: [reservedId], removedOwnedWeaponIds: [], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [reservedId], routeOutputChangedForEntryIds: [] }, satisfactionChanges: [] })
    state.simulatedInventory = createSimulatedInventory([{ id: reservedId, kind: 'gogma', name: '', weaponTypeId: target.weaponTypeId, elementId: target.elementId, restorationBonuses: structuredClone(b), restorationBonusScope: 'normal_artian', seriesSkillId: 'series_skill.fixture.a', groupSkillId: null, status: entry.candidateSnapshot.category, isProtected: false, memo: null, createdAt: entry.candidateSnapshot.createdAt, updatedAt: entry.candidateSnapshot.createdAt }]).inventory!
    const support = vi.spyOn(engine, 'getPredictionSupport')
    const replay = replayPlannerSearchTrace(input, state, engine)
    expect(replay.isValid, JSON.stringify(replay.issues)).toBe(true); expect(replay.drafts).toHaveLength(4)
    expect(replay.drafts[0].expectedResult?.restorationBonuses).toEqual(a); expect(replay.drafts[2].expectedResult?.restorationBonuses).toEqual(b); expect(replay.drafts[2].expectedResult?.restorationBonusScope).toBe('normal_artian'); expect(replay.drafts[2].expectedResult?.seriesSkillId).toBe('series_skill.fixture.a')
    expect(replay.drafts[0].rngAdvance.normalCounterDelta).toBe(1); expect(replay.drafts[0].rngAdvance.affectedNormalCounterId).toBe('weapon.fixture.a:8')
    expect(replay.drafts[1].expectedStateAfter).toEqual(replay.drafts[2].expectedStateBefore)
    expect(replay.drafts.at(-1)?.inventoryChange?.addOwnedWeapon?.id).toBe(reservedId)
    expect(support.mock.calls.some(([value]) => value.type === 'skill')).toBe(true)
    expect(support.mock.calls.some(([value]) =>
      value.type === 'gogma_reset' || value.type === 'gogma_keep',
    )).toBe(false)
  })
  it('rejects Candidate Snapshot bonus or skill mismatches before reserve can overwrite the replay output', () => {
    const { input, state, engine, entry, trace } = fixture(); const last = trace.at(-1)!.rngAfter
    trace.push({ kind: 'reserve_candidate', actionType: 'reserve_weapon', primaryBuildListEntryId: entry.id, progressedBuildListEntryIds: [entry.id], progressedRoutePositions: {}, routeOperation: null, ownedWeaponId: ownedWeaponId('owned.replay.bad'), plannerOnly: true, candidateCategory: entry.candidateSnapshot.category, rngBefore: last, rngAfter: last, inventoryEffect: { addedOwnedWeaponIds: [], removedOwnedWeaponIds: [], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [], routeOutputChangedForEntryIds: [] }, satisfactionChanges: [] })
    entry.candidateSnapshot.finalBonuses = createRestorationBonusSet(); entry.candidateSnapshot.seriesSkillId = 'series_skill.fixture.a'
    expect(replayPlannerSearchTrace(input, state, engine).issues[0]?.code).toBe('candidate_result_mismatch')
  })
  it('rejects unconfirmed prediction inputs even when values are present', () => {
    const { input, state, engine } = fixture(); input.rngState.baseSeed.isConfirmed = false
    expect(replayPlannerSearchTrace(input, state, engine).issues[0]?.code).toBe('missing_rng_requirement')
  })
  it('rejects conversion when Skill Counter is unconfirmed before Skill prediction', () => {
    const { input, state, engine } = fixture()
    input.rngState.skillCounter.isConfirmed = false
    const replay = replayPlannerSearchTrace(input, state, engine)
    expect(replay.isValid).toBe(false)
    expect(replay.issues[0]?.code).toBe('missing_rng_requirement')
  })
  it('rejects transient Normal-scope Keep before calling the RNG Engine', () => {
    const { input, state, engine, entry, trace, normal } = fixture()
    engine.capabilities.supportsKeepBonusesPrediction = true
    const keep = {
      type: 'keep_bonuses' as const,
      sourceOwnedWeaponId: null,
      gogmaCounterBefore: 10,
      gogmaCounterAfter: 11,
    }
    trace.push({
      kind: 'route_operation',
      actionType: keep.type,
      primaryBuildListEntryId: entry.id,
      progressedBuildListEntryIds: [entry.id],
      progressedRoutePositions: {},
      routeOperation: keep,
      ownedWeaponId: null,
      plannerOnly: false,
      rngBefore: { gogmaCounter: 10, skillCounter: 8, normalCounters: [{ id: normal.id, counter: 6 }] },
      rngAfter: { gogmaCounter: 11, skillCounter: 8, normalCounters: [{ id: normal.id, counter: 6 }] },
      inventoryEffect: { addedOwnedWeaponIds: [], removedOwnedWeaponIds: [], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [], routeOutputChangedForEntryIds: [] },
      satisfactionChanges: [],
    })
    const replay = replayPlannerSearchTrace(input, state, engine)
    expect(replay.isValid).toBe(false)
    expect(replay.issues[0]?.code).toBe('invalid_source_weapon')
    expect(replay.issues[0]?.code).not.toBe('prediction_failed')
  })
  it('rejects an action whose rngBefore does not match the replay runtime', () => {
    const { input, state, engine, trace } = fixture(); trace[0].rngBefore.gogmaCounter = 99
    expect(replayPlannerSearchTrace(input, state, engine).issues[0]?.code).toBe('rng_before_mismatch')
  })
  it('rejects a Search Action that shares a non-shareable create across Entries', () => {
    const { input, state, engine, trace, entry } = fixture()
    const sharedId = buildListEntryId('entry.replay.shared')
    const sharedEntry = structuredClone(entry)
    sharedEntry.id = sharedId
    sharedEntry.candidateId = candidateId('candidate.replay.shared')
    sharedEntry.candidateSnapshot.id = sharedEntry.candidateId
    input.buildListEntries.push(sharedEntry)
    trace.splice(1, 2)
    trace[0].progressedBuildListEntryIds = [entry.id, sharedId]
    trace[0].progressedRoutePositions = {
      [entry.id]: { operationIndex: 0, unitIndex: 0, unitCount: 2 },
      [sharedId]: { operationIndex: 0, unitIndex: 0, unitCount: 2 },
    }
    state.currentRngState.gogmaCounter.value = 10; state.currentRngState.skillCounter.value = 7; state.currentNormalCounters[0].counter = 5
    const replay = replayPlannerSearchTrace(input, state, engine)
    expect(replay).toMatchObject({
      isValid: false,
      drafts: [],
      issues: [expect.objectContaining({
        code: 'invalid_physical_action_sharing',
      })],
    })
  })
  it('rejects shared Reset output assignment across distinct transient Gogma Entries', () => {
    const { input, state, engine, trace, entry, normal } = fixture()
    const reset = {
      type: 'reset_bonuses' as const,
      sourceOwnedWeaponId: null,
      gogmaCounterBefore: 10,
      gogmaCounterAfter: 11,
    }
    entry.candidateSnapshot.route.operations.push(reset)
    const sharedEntry = structuredClone(entry)
    sharedEntry.id = buildListEntryId('entry.replay.transient-reset.shared')
    sharedEntry.candidateId = candidateId('candidate.replay.transient-reset.shared')
    sharedEntry.candidateSnapshot.id = sharedEntry.candidateId
    input.buildListEntries.push(sharedEntry)
    trace.push({
      kind: 'route_operation',
      actionType: reset.type,
      primaryBuildListEntryId: entry.id,
      progressedBuildListEntryIds: [entry.id, sharedEntry.id],
      progressedRoutePositions: {
        [entry.id]: { operationIndex: 2, unitIndex: 0, unitCount: 1 },
        [sharedEntry.id]: { operationIndex: 2, unitIndex: 0, unitCount: 1 },
      },
      routeOperation: reset,
      ownedWeaponId: null,
      plannerOnly: false,
      rngBefore: { gogmaCounter: 10, skillCounter: 8, normalCounters: [{ id: normal.id, counter: 6 }] },
      rngAfter: { gogmaCounter: 11, skillCounter: 8, normalCounters: [{ id: normal.id, counter: 6 }] },
      inventoryEffect: { addedOwnedWeaponIds: [], removedOwnedWeaponIds: [], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [], routeOutputChangedForEntryIds: [entry.id, sharedEntry.id] },
      satisfactionChanges: [],
    })
    state.currentRngState.gogmaCounter.value = 11

    const replay = replayPlannerSearchTrace(input, state, engine)

    expect(replay).toMatchObject({
      isValid: false,
      drafts: [],
      issues: [expect.objectContaining({
        code: 'invalid_physical_action_sharing',
        actionIndex: 3,
      })],
    })
  })
  it('hashes equivalent semantic state identically and includes kind', () => {
    const state = createValidRngState(); const counter = createValidNormalArtianCounter(); const weapon = { ...createValidBuildListEntry().candidateSnapshot }
    const owned = { id: ownedWeaponId('owned.hash'), kind: 'gogma' as const, restorationBonusScope: 'gogma_artian' as const, name: 'A', weaponTypeId: 'weapon.fixture.a', elementId: 'element.fixture.a', restorationBonuses: createRestorationBonusSet(), seriesSkillId: null, groupSkillId: null, status: 'unclassified' as const, isProtected: false, memo: null, createdAt: 'a', updatedAt: 'a' }
    const before = createExpectedPlanState(state, [counter], [owned]); expect(createExpectedPlanState({ ...state, notes: 'x', updatedAt: 'b' }, [{ ...counter, updatedAt: 'b' }], [{ ...owned, name: 'B', memo: 'x', updatedAt: 'b' }])).toEqual(before)
    // The status label carries no calculation meaning, so it never moves the
    // expected inventory hash (`docs/DATA_MODEL.md` 3.2).
    expect(createExpectedPlanState(state, [counter], [{ ...owned, status: 'ideal' as const }])).toEqual(before)
    expect(createExpectedPlanState(state, [counter], [{ ...owned, isProtected: true }]).ownedWeaponsHash).not.toBe(before.ownedWeaponsHash)
    expect(createExpectedPlanState(state, [counter], [{ ...owned, kind: 'normal' as const, restorationBonusScope: 'normal_artian' as const, rarity: 8, seriesSkillId: null, groupSkillId: null, status: null }]).ownedWeaponsHash).not.toBe(before.ownedWeaponsHash)
    void weapon
  })
  it('uses the replayed ordered result of each bonus operation for the next Keep support query', () => {
    const { input, state, engine, entry, target, normal } = fixture()
    const source = {
      id: ownedWeaponId('owned.replay.sequential-keep'),
      kind: 'gogma' as const,
      restorationBonusScope: 'gogma_artian' as const,
      name: '',
      weaponTypeId: target.weaponTypeId,
      elementId: target.elementId,
      restorationBonuses: createRestorationBonusSet(),
      seriesSkillId: null,
      groupSkillId: null,
      status: 'unclassified' as const,
      isProtected: false,
      memo: null,
      createdAt: 'x',
      updatedAt: 'x',
    }
    const resetResult = createRestorationBonusSet()
    resetResult[0].bonusRankId = 'bonus_rank.fixture.low'
    const firstKeepResult = structuredClone(resetResult)
    firstKeepResult[1].bonusRankId = 'bonus_rank.fixture.middle'
    const finalKeepResult = structuredClone(firstKeepResult)
    finalKeepResult[2].bonusRankId = 'bonus_rank.fixture.high'
    const operations = [
      { type: 'reset_bonuses' as const, sourceOwnedWeaponId: source.id, gogmaCounterBefore: 10, gogmaCounterAfter: 11 },
      { type: 'keep_bonuses' as const, sourceOwnedWeaponId: source.id, gogmaCounterBefore: 11, gogmaCounterAfter: 12 },
      { type: 'keep_bonuses' as const, sourceOwnedWeaponId: source.id, gogmaCounterBefore: 12, gogmaCounterAfter: 13 },
    ]
    entry.candidateSnapshot.route = {
      kind: 'existing_gogma_mixed',
      sourceOwnedWeaponId: source.id,
      operations,
    }
    input.ownedWeapons = [source]
    const snap = (gogmaCounter: number) => ({
      gogmaCounter,
      skillCounter: 7,
      normalCounters: [{ id: normal.id, counter: 4 }],
    })
    state.trace = operations.map((operation, index): PlannerSearchAction => ({
      kind: 'route_operation',
      actionType: operation.type,
      primaryBuildListEntryId: entry.id,
      progressedBuildListEntryIds: [entry.id],
      progressedRoutePositions: {},
      routeOperation: operation,
      ownedWeaponId: source.id,
      plannerOnly: false,
      rngBefore: snap(10 + index),
      rngAfter: snap(11 + index),
      inventoryEffect: { addedOwnedWeaponIds: [], removedOwnedWeaponIds: [], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [], routeOutputChangedForEntryIds: [entry.id] },
      satisfactionChanges: [],
    }))
    state.currentRngState = structuredClone(input.rngState)
    state.currentRngState.gogmaCounter.value = 13
    state.currentNormalCounters = structuredClone(input.normalCounters)
    state.simulatedInventory = createSimulatedInventory([source]).inventory!
    engine.capabilities.supportsKeepBonusesPrediction = true
    const keepSupportInputs: string[] = []
    const delegate = engine.getPredictionSupport.bind(engine)
    vi.spyOn(engine, 'getPredictionSupport').mockImplementation((supportInput) => {
      if (supportInput.type === 'gogma_keep') {
        keepSupportInputs.push(JSON.stringify(supportInput.currentBonuses))
      }
      return delegate(supportInput)
    })
    vi.spyOn(engine, 'predictGogmaBonus').mockImplementation((predictionInput) => {
      if (predictionInput.operation.type === 'reset_bonuses') {
        return structuredClone(resetResult)
      }
      return predictionInput.gogmaCounter === 11
        ? structuredClone(firstKeepResult)
        : structuredClone(finalKeepResult)
    })

    const replay = replayPlannerSearchTrace(input, state, engine)

    expect(replay.isValid, JSON.stringify(replay.issues)).toBe(true)
    expect(keepSupportInputs).toEqual([
      JSON.stringify(resetResult),
      JSON.stringify(firstKeepResult),
    ])
  })
  it('propagates unexpected support query failures from Trace Replay', () => {
    const { input, state, engine } = fixture()
    const failure = new Error('unexpected replay support failure')
    vi.spyOn(engine, 'getPredictionSupport').mockImplementation(() => {
      throw failure
    })

    expect(() => replayPlannerSearchTrace(input, state, engine)).toThrow(failure)
  })
  it('propagates predictor failures after Trace Replay support succeeds', () => {
    const { input, state, engine } = fixture()
    const failure = new Error('unexpected replay prediction failure')
    vi.spyOn(engine, 'predictNormalArtian').mockImplementation(() => {
      throw failure
    })

    expect(() => replayPlannerSearchTrace(input, state, engine)).toThrow(failure)
  })
})
