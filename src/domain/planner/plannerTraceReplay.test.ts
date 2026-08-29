import { describe, expect, it } from 'vitest'
import { createExpectedPlanState } from '../models/hashing'
import { FakeRngEngine } from '../rng/fakeRngEngine'
import { buildListEntryId, candidateId, createRestorationBonusSet, createValidBuildListEntry, createValidNormalArtianCounter, createValidRngState, createValidTargetWeapon, ownedWeaponId } from '../../test/fixtures/domainData'
import { createSimulatedInventory } from './simulatedInventory'
import { replayPlannerSearchTrace } from './plannerTraceReplay'
import type { PlannerInput, PlannerSearchAction, PlannerSearchState } from './plannerTypes'

function fixture() {
  const entry = createValidBuildListEntry(); entry.id = buildListEntryId('entry.replay'); entry.candidateId = candidateId('candidate.replay'); entry.candidateSnapshot.id = entry.candidateId
  entry.candidateSnapshot.route = { kind: 'normal_artian_to_gogma', sourceOwnedWeaponId: null, operations: [{ type: 'create_normal_artian', weaponTypeId: 'weapon.fixture.a', rarity: 8, count: 2, normalCounterBefore: 4, normalCounterAfter: 6 }, { type: 'convert_normal_to_gogma', weaponTypeId: 'weapon.fixture.a', gogmaCounterBefore: 10, gogmaCounterAfter: 11 }] }
  const rngState = createValidRngState(); rngState.skillCounter = { value: 7, isConfirmed: true, source: 'manual' }; const normal = createValidNormalArtianCounter(); const target = createValidTargetWeapon()
  const input: PlannerInput = { rngState, normalCounters: [normal], ownedWeapons: [], targetWeapons: [target], buildListEntries: [entry], calculationContext: { gameVersion: 'x', masterDataVersion: 1, rngEngineVersion: 'x', appSchemaVersion: 1 }, options: { maxPlanSteps: 300, beamWidth: 50, maxExpandedStates: 10000 }, master: { weaponBonusDefinitions: [], lotteries: [], bonusRanks: [], materialCosts: [] }, conflictResolutions: [] }
  const snap = (g: number, n: number) => ({ gogmaCounter: g, skillCounter: 7, normalCounters: [{ id: normal.id, counter: n }] })
  const create = entry.candidateSnapshot.route.operations[0]
  const convert = entry.candidateSnapshot.route.operations[1]
  const route = (operation: typeof create | typeof convert, before: ReturnType<typeof snap>, after: ReturnType<typeof snap>): PlannerSearchAction => ({ kind: 'route_operation', actionType: operation.type, primaryBuildListEntryId: entry.id, progressedBuildListEntryIds: [entry.id], progressedRoutePositions: {}, routeOperation: operation, ownedWeaponId: null, plannerOnly: false, rngBefore: before, rngAfter: after, inventoryEffect: { addedOwnedWeaponIds: [], removedOwnedWeaponIds: [], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [], routeOutputChangedForEntryIds: [] }, satisfactionChanges: [] })
  const trace = [route(create, snap(10, 4), snap(10, 5)), route(create, snap(10, 5), snap(10, 6)), route(convert, snap(10, 6), snap(11, 6))]
  const finalRng = structuredClone(rngState); finalRng.gogmaCounter.value = 11; const finalNormal = [{ ...normal, counter: 6 }]
  const state: PlannerSearchState = { currentRngState: finalRng, currentNormalCounters: finalNormal, simulatedInventory: createSimulatedInventory([]).inventory!, targetSatisfaction: {}, selectedBuildListEntryIds: [], routeProgressByEntryId: {}, routeRuntimeByEntryId: {}, sourceMutationVersionByOwnedWeaponId: {}, candidateReadySourceVersionByEntryId: {}, routeSourceVersionByEntryId: {}, inFlightExistingSourceByOwnedWeaponId: {}, securedOwnedWeaponIdByEntryId: {}, practicalFirstProgressTargetIds: [], trace, consumedMaterialWeaponCount: 0, totalCost: 0, evaluationScore: 0 }
  const a = createRestorationBonusSet(); const b = structuredClone(a); b[0].bonusRankId = 'bonus_rank.fixture.low'; const g = structuredClone(a); g[1].bonusRankId = 'bonus_rank.fixture.low'
  const engine = new FakeRngEngine({ version: 'replay', capabilities: { supportsSeedSearch: false, supportsNormalArtianPrediction: true, supportsGogmaPrediction: true, supportsSkillPrediction: false, supportsKeepBonusesPrediction: false }, normalizedSeeds: [], skillPredictions: [], keepSelections: [], gogmaCounterAdvances: [], skillCounterAdvances: [], normalCounterAdvances: [], normalArtianPredictions: [{ input: { baseSeed: rngState.baseSeed.value!, weaponTypeId: normal.weaponTypeId, rarity: 8, normalCounter: 4, master: input.master }, result: a }, { input: { baseSeed: rngState.baseSeed.value!, weaponTypeId: normal.weaponTypeId, rarity: 8, normalCounter: 5, master: input.master }, result: b }], gogmaPredictions: [{ input: { baseSeed: rngState.baseSeed.value!, gogmaCounter: 10, counterGate: rngState.counterGate.value!, weaponTypeId: target.weaponTypeId, elementId: target.elementId, operation: { type: 'new_gogma', sourceNormalBonuses: b }, master: input.master }, result: g }] })
  return { input, state, engine, trace, a, b, g, entry, target, normal }
}

describe('Planner trace replay', () => {
  it('splits count=2, converts the latest transient Normal output, and chains expected hashes', () => {
    const { input, state, engine, a, g, entry, target, trace } = fixture()
    entry.candidateSnapshot.finalBonuses = structuredClone(g); entry.candidateSnapshot.seriesSkillId = null; entry.candidateSnapshot.groupSkillId = null
    const reservedId = ownedWeaponId('owned.replay.reserve')
    const last = trace.at(-1)!.rngAfter
    trace.push({ kind: 'reserve_candidate', actionType: 'reserve_weapon', primaryBuildListEntryId: entry.id, progressedBuildListEntryIds: [entry.id], progressedRoutePositions: {}, routeOperation: null, ownedWeaponId: reservedId, plannerOnly: true, candidateCategory: entry.candidateSnapshot.category, rngBefore: last, rngAfter: last, inventoryEffect: { addedOwnedWeaponIds: [reservedId], removedOwnedWeaponIds: [], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [reservedId], routeOutputChangedForEntryIds: [] }, satisfactionChanges: [] })
    state.simulatedInventory = createSimulatedInventory([{ id: reservedId, kind: 'gogma', name: '', weaponTypeId: target.weaponTypeId, elementId: target.elementId, restorationBonuses: structuredClone(g), seriesSkillId: null, groupSkillId: null, status: entry.candidateSnapshot.category, isProtected: true, relatedTargetWeaponIds: [entry.targetWeaponId], memo: null, createdAt: entry.candidateSnapshot.createdAt, updatedAt: entry.candidateSnapshot.createdAt }]).inventory!
    const replay = replayPlannerSearchTrace(input, state, engine)
    expect(replay.isValid, JSON.stringify(replay.issues)).toBe(true); expect(replay.drafts).toHaveLength(4)
    expect(replay.drafts[0].expectedResult?.restorationBonuses).toEqual(a); expect(replay.drafts[2].expectedResult?.restorationBonuses).toEqual(g)
    expect(replay.drafts[0].rngAdvance.normalCounterDelta).toBe(1); expect(replay.drafts[0].rngAdvance.affectedNormalCounterId).toBe('weapon.fixture.a:8')
    expect(replay.drafts[1].expectedStateAfter).toEqual(replay.drafts[2].expectedStateBefore)
    expect(replay.drafts.at(-1)?.inventoryChange?.addOwnedWeapon?.id).toBe(reservedId)
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
  it('rejects an action whose rngBefore does not match the replay runtime', () => {
    const { input, state, engine, trace } = fixture(); trace[0].rngBefore.gogmaCounter = 99
    expect(replayPlannerSearchTrace(input, state, engine).issues[0]?.code).toBe('rng_before_mismatch')
  })
  it('keeps one shared physical create action as one Draft and retains every progressed Entry ID', () => {
    const { input, state, engine, trace, entry } = fixture()
    const sharedId = buildListEntryId('entry.replay.shared')
    trace.splice(1, 2)
    trace[0].progressedBuildListEntryIds = [entry.id, sharedId]
    state.currentRngState.gogmaCounter.value = 10; state.currentNormalCounters[0].counter = 5
    const replay = replayPlannerSearchTrace(input, state, engine)
    expect(replay).toMatchObject({ isValid: true })
    expect(replay.drafts).toHaveLength(1)
    expect(replay.drafts[0].progressedBuildListEntryIds).toEqual([entry.id, sharedId])
  })
  it('removes a concrete material weapon once and rejects a second consumption', () => {
    const { input, state, engine, entry } = fixture()
    const material = { id: ownedWeaponId('owned.replay.material'), kind: 'gogma' as const, name: '', weaponTypeId: input.targetWeapons[0].weaponTypeId, elementId: input.targetWeapons[0].elementId, restorationBonuses: createRestorationBonusSet(), seriesSkillId: null, groupSkillId: null, status: 'material' as const, isProtected: false, relatedTargetWeaponIds: [], memo: null, createdAt: 'x', updatedAt: 'x' }
    input.ownedWeapons = [material]
    state.currentRngState = structuredClone(input.rngState); state.currentNormalCounters = structuredClone(input.normalCounters)
    const snap = { gogmaCounter: 10, skillCounter: 7, normalCounters: [{ id: input.normalCounters[0].id, counter: 4 }] }
    const action = (operation: { type: 'use_weapon_as_material'; ownedWeaponId: typeof material.id }): PlannerSearchAction => ({ kind: 'route_operation', actionType: operation.type, primaryBuildListEntryId: entry.id, progressedBuildListEntryIds: [entry.id], progressedRoutePositions: {}, routeOperation: operation, ownedWeaponId: material.id, plannerOnly: false, rngBefore: snap, rngAfter: snap, inventoryEffect: { addedOwnedWeaponIds: [], removedOwnedWeaponIds: [material.id], updatedOwnedWeaponIds: [], reservedOwnedWeaponIds: [], routeOutputChangedForEntryIds: [] }, satisfactionChanges: [] })
    state.trace = [action({ type: 'use_weapon_as_material', ownedWeaponId: material.id })]
    state.simulatedInventory = createSimulatedInventory([]).inventory!
    expect(replayPlannerSearchTrace(input, state, engine)).toMatchObject({ isValid: true, drafts: [expect.objectContaining({ inventoryChange: expect.objectContaining({ removeOwnedWeaponIds: [material.id] }) })] })
    state.trace = [action({ type: 'use_weapon_as_material', ownedWeaponId: material.id }), action({ type: 'use_weapon_as_material', ownedWeaponId: material.id })]
    expect(replayPlannerSearchTrace(input, state, engine).issues[0]?.code).toBe('missing_source_weapon')
  })
  it('hashes equivalent semantic state identically and includes kind', () => {
    const state = createValidRngState(); const counter = createValidNormalArtianCounter(); const weapon = { ...createValidBuildListEntry().candidateSnapshot }
    const owned = { id: ownedWeaponId('owned.hash'), kind: 'gogma' as const, name: 'A', weaponTypeId: 'weapon.fixture.a', elementId: 'element.fixture.a', restorationBonuses: createRestorationBonusSet(), seriesSkillId: null, groupSkillId: null, status: 'material' as const, isProtected: false, relatedTargetWeaponIds: ['z' as never, 'z' as never], memo: null, createdAt: 'a', updatedAt: 'a' }
    const before = createExpectedPlanState(state, [counter], [owned]); expect(createExpectedPlanState({ ...state, notes: 'x', updatedAt: 'b' }, [{ ...counter, updatedAt: 'b' }], [{ ...owned, name: 'B', memo: 'x', updatedAt: 'b', relatedTargetWeaponIds: ['z' as never] }])).toEqual(before)
    expect(createExpectedPlanState(state, [counter], [{ ...owned, kind: 'normal' as const, rarity: 8, seriesSkillId: null, groupSkillId: null, status: null }]).ownedWeaponsHash).not.toBe(before.ownedWeaponsHash)
    void weapon
  })
})
