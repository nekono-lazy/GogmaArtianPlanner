import type {
  BuildListEntry, BuildListEntryId, ExpectedPlanState, ExpectedResult,
  InventoryChange, NormalArtianCounter, OwnedGogmaArtianWeapon, OwnedWeapon,
  OwnedWeaponId, PlanStepDebugInfo, PlanStepOperationType, RestorationBonusSet,
  RngAdvance, RngState, TargetWeapon, TargetWeaponId, BuildCandidateId,
} from '../models/publicTypes'
import { createExpectedPlanState } from '../models/publicTypes'
import type { RngEngine } from '../rng/rngEngine'
import type { PlannerInput, PlannerSearchAction, PlannerSearchRngSnapshot, PlannerSearchState } from './plannerTypes'

/** Non-persistent bridge between one physical Search Action and a future PlanStep. */
export interface PlannerPlanStepDraft {
  operationType: PlanStepOperationType
  primaryBuildListEntryId: BuildListEntryId | null
  progressedBuildListEntryIds: BuildListEntryId[]
  targetWeaponId: TargetWeaponId | null
  candidateId: BuildCandidateId | null
  ownedWeaponId: OwnedWeaponId | null
  expectedResult: ExpectedResult | null
  expectedStateBefore: ExpectedPlanState
  expectedStateAfter: ExpectedPlanState
  inventoryChange: InventoryChange | null
  rngAdvance: RngAdvance
  debug: PlanStepDebugInfo | null
}

export type PlannerTraceReplayIssueCode =
  | 'rng_before_mismatch' | 'rng_after_mismatch' | 'counter_difference_unrepresentable'
  | 'missing_entry' | 'missing_target' | 'missing_rng_requirement' | 'engine_capability_missing'
  | 'missing_transient_output' | 'missing_source_weapon' | 'invalid_source_weapon'
  | 'inventory_transition_failed' | 'candidate_result_mismatch' | 'final_state_mismatch' | 'prediction_failed'
export interface PlannerTraceReplayIssue { code: PlannerTraceReplayIssueCode; message: string; actionIndex: number | null }
export interface PlannerTraceReplayResult { isValid: boolean; drafts: PlannerPlanStepDraft[]; issues: PlannerTraceReplayIssue[] }

interface TransientGogma { restorationBonuses: RestorationBonusSet; restorationBonusScope: 'normal_artian' | 'gogma_artian'; seriesSkillId: string | null; groupSkillId: string | null }
interface Runtime {
  rngState: RngState; normalCounters: NormalArtianCounter[]; ownedWeapons: OwnedWeapon[]
  /** Per-Entry creation history; conversion consumes only the latest output. */
  normals: Map<BuildListEntryId, RestorationBonusSet[]>; gogmas: Map<BuildListEntryId, TransientGogma>
}
const cloneBonuses = (value: RestorationBonusSet): RestorationBonusSet => structuredClone(value)
const emptyChange = (): InventoryChange => ({ addOwnedWeapon: null, removeOwnedWeaponIds: [], updateOwnedWeapons: [], materialRequirements: [] })
const result = (restorationBonuses: RestorationBonusSet | null, restorationBonusScope: ExpectedResult['restorationBonusScope'], seriesSkillId: string | null, groupSkillId: string | null, shouldSecure = false, candidateCategory: ExpectedResult['candidateCategory'] = null, isSimilarToIdeal = false): ExpectedResult => ({ restorationBonuses, restorationBonusScope, seriesSkillId, groupSkillId, candidateCategory, isSimilarToIdeal, shouldSecure })

function sameSnapshot(runtime: Runtime, snapshot: PlannerSearchRngSnapshot) {
  if (runtime.rngState.gogmaCounter.value !== snapshot.gogmaCounter || runtime.rngState.skillCounter.value !== snapshot.skillCounter) return false
  const actual = runtime.normalCounters.map(({ id, counter }) => ({ id, counter })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return JSON.stringify(actual) === JSON.stringify(snapshot.normalCounters)
}
function applySnapshot(runtime: Runtime, snapshot: PlannerSearchRngSnapshot) {
  runtime.rngState.gogmaCounter.value = snapshot.gogmaCounter; runtime.rngState.skillCounter.value = snapshot.skillCounter
  const values = new Map(snapshot.normalCounters.map(({ id, counter }) => [id, counter]))
  runtime.normalCounters = runtime.normalCounters.map((counter) => values.has(counter.id) ? { ...counter, counter: values.get(counter.id) ?? null } : counter)
}
function valueDelta(before: number | null, after: number | null) { return before === null && after === null ? 0 : before === null || after === null ? null : after - before }
function rngAdvance(before: PlannerSearchRngSnapshot, after: PlannerSearchRngSnapshot): RngAdvance | null {
  const gogmaCounterDelta = valueDelta(before.gogmaCounter, after.gogmaCounter); const skillCounterDelta = valueDelta(before.skillCounter, after.skillCounter)
  if (gogmaCounterDelta === null || skillCounterDelta === null) return null
  const b = new Map(before.normalCounters.map(({ id, counter }) => [id, counter])); const a = new Map(after.normalCounters.map(({ id, counter }) => [id, counter]))
  if (a.size !== b.size || [...a.keys()].some((id) => !b.has(id))) return null
  const changed = [...b.keys()].filter((id) => b.get(id) !== a.get(id)); if (changed.length > 1) return null
  if (changed.length === 0) return { gogmaCounterDelta, skillCounterDelta, normalCounterDelta: null, affectedNormalCounterId: null }
  const id = changed[0]; const normalCounterDelta = valueDelta(b.get(id) ?? null, a.get(id) ?? null)
  return normalCounterDelta === null ? null : { gogmaCounterDelta, skillCounterDelta, normalCounterDelta, affectedNormalCounterId: id }
}
function predictionIssue(runtime: Runtime, index: number, gate: boolean): PlannerTraceReplayIssue | null {
  if (runtime.rngState.baseSeed.value === null || !runtime.rngState.baseSeed.isConfirmed) return { code: 'missing_rng_requirement', message: 'A confirmed Base Seed is required for prediction.', actionIndex: index }
  if (gate && (runtime.rngState.counterGate.value === null || !runtime.rngState.counterGate.isConfirmed)) return { code: 'missing_rng_requirement', message: 'A confirmed Counter Gate is required for prediction.', actionIndex: index }
  return null
}
function entryFor(input: PlannerInput, id: BuildListEntryId) { return input.buildListEntries.find((entry) => entry.id === id) ?? null }
function targetFor(input: PlannerInput, entry: BuildListEntry): TargetWeapon | null { return input.targetWeapons.find(({ id }) => id === entry.targetWeaponId) ?? null }
function currentGogma(runtime: Runtime, entryId: BuildListEntryId, sourceId: OwnedWeaponId): TransientGogma | null {
  const output = runtime.gogmas.get(entryId); if (output) return structuredClone(output)
  const source = runtime.ownedWeapons.find(({ id }) => id === sourceId)
  return source?.kind === 'gogma' ? { restorationBonuses: cloneBonuses(source.restorationBonuses), restorationBonusScope: source.restorationBonusScope, seriesSkillId: source.seriesSkillId, groupSkillId: source.groupSkillId } : null
}
function assignGogma(runtime: Runtime, action: PlannerSearchAction, output: TransientGogma) { action.progressedBuildListEntryIds.forEach((id) => runtime.gogmas.set(id, structuredClone(output))) }
function reservedWeapon(entry: BuildListEntry, target: TargetWeapon, id: OwnedWeaponId): OwnedGogmaArtianWeapon {
  const candidate = entry.candidateSnapshot
  return { id, kind: 'gogma', name: '', weaponTypeId: target.weaponTypeId, elementId: target.elementId, restorationBonuses: cloneBonuses(candidate.finalBonuses), restorationBonusScope: candidate.restorationBonusScope, seriesSkillId: candidate.seriesSkillId, groupSkillId: candidate.groupSkillId, status: candidate.category, isProtected: true, relatedTargetWeaponIds: [entry.targetWeaponId], memo: null, createdAt: candidate.createdAt, updatedAt: candidate.createdAt }
}

/** Pure, deterministic replay. It generates neither PlanStep IDs nor clocks. */
export function replayPlannerSearchTrace(input: PlannerInput, bestState: PlannerSearchState, engine: RngEngine): PlannerTraceReplayResult {
  const runtime: Runtime = { rngState: structuredClone(input.rngState), normalCounters: structuredClone(input.normalCounters), ownedWeapons: structuredClone(input.ownedWeapons), normals: new Map(), gogmas: new Map() }
  const drafts: PlannerPlanStepDraft[] = []
  const fail = (code: PlannerTraceReplayIssueCode, message: string, actionIndex: number | null): PlannerTraceReplayResult => ({ isValid: false, drafts: [], issues: [{ code, message, actionIndex }] })
  for (let index = 0; index < bestState.trace.length; index += 1) {
    const action = bestState.trace[index]; if (!sameSnapshot(runtime, action.rngBefore)) return fail('rng_before_mismatch', 'Replay runtime does not match Search Action rngBefore.', index)
    const advance = rngAdvance(action.rngBefore, action.rngAfter); if (!advance) return fail('counter_difference_unrepresentable', 'Search Action changes multiple or unknown Normal counters.', index)
    const entry = entryFor(input, action.primaryBuildListEntryId); if (!entry) return fail('missing_entry', 'Search Action references a missing BuildListEntry.', index)
    const target = targetFor(input, entry); if (!target) return fail('missing_target', 'BuildListEntry references a missing TargetWeapon.', index)
    const expectedStateBefore = createExpectedPlanState(runtime.rngState, runtime.normalCounters, runtime.ownedWeapons)
    let expectedResult: ExpectedResult | null = null; let inventoryChange: InventoryChange | null = null
    try {
      if (action.kind === 'reserve_candidate') {
        const transient = runtime.gogmas.get(entry.id)
        if (!transient) return fail('missing_transient_output', 'Reserve requires the Entry transient Gogma output.', index)
        const candidate = entry.candidateSnapshot
        if (JSON.stringify(transient.restorationBonuses) !== JSON.stringify(candidate.finalBonuses) || transient.seriesSkillId !== candidate.seriesSkillId || transient.groupSkillId !== candidate.groupSkillId) {
          return fail('candidate_result_mismatch', 'Transient Gogma result does not match the Candidate Snapshot.', index)
        }
        inventoryChange = emptyChange()
        if (entry.candidateSnapshot.route.kind === 'normal_artian_to_gogma' || entry.candidateSnapshot.route.kind === 'owned_normal_artian_to_gogma') {
          if (runtime.ownedWeapons.some(({ id }) => id === action.ownedWeaponId)) return fail('inventory_transition_failed', 'Reserved OwnedWeapon ID already exists.', index)
          const weapon = reservedWeapon(entry, target, action.ownedWeaponId); runtime.ownedWeapons.push(structuredClone(weapon)); inventoryChange.addOwnedWeapon = weapon
        } else {
          const position = runtime.ownedWeapons.findIndex(({ id }) => id === action.ownedWeaponId); const source = runtime.ownedWeapons[position]
          if (!source || source.kind !== 'gogma') return fail('missing_source_weapon', 'Existing Gogma reserve source is unavailable.', index)
          const updated: OwnedGogmaArtianWeapon = { ...source, restorationBonuses: cloneBonuses(entry.candidateSnapshot.finalBonuses), restorationBonusScope: entry.candidateSnapshot.restorationBonusScope, seriesSkillId: entry.candidateSnapshot.seriesSkillId, groupSkillId: entry.candidateSnapshot.groupSkillId, status: entry.candidateSnapshot.category, isProtected: true, relatedTargetWeaponIds: [...new Set([...source.relatedTargetWeaponIds, entry.targetWeaponId])].sort() }
          runtime.ownedWeapons[position] = updated; inventoryChange.updateOwnedWeapons = [structuredClone(updated)]
        }
        runtime.gogmas.delete(entry.id)
        expectedResult = result(cloneBonuses(entry.candidateSnapshot.finalBonuses), entry.candidateSnapshot.restorationBonusScope, entry.candidateSnapshot.seriesSkillId, entry.candidateSnapshot.groupSkillId, true, entry.candidateSnapshot.category, entry.candidateSnapshot.isSimilarToIdeal)
      } else {
        const operation = action.routeOperation
        if (operation.type === 'create_normal_artian') {
          if (!engine.capabilities.supportsNormalArtianPrediction) return fail('engine_capability_missing', 'Normal prediction capability is unavailable.', index)
          const missing = predictionIssue(runtime, index, false); if (missing) return { isValid: false, drafts: [], issues: [missing] }
          const normalCounter = runtime.normalCounters.find(({ id }) => id === operation.weaponTypeId + ':' + operation.rarity)
          const counter = normalCounter?.counter
          if (!normalCounter || counter === null || counter === undefined || !normalCounter.isConfirmed) return fail('missing_rng_requirement', 'A confirmed Normal Artian Counter is required.', index)
          const bonuses = engine.predictNormalArtian({ baseSeed: runtime.rngState.baseSeed.value!, weaponTypeId: operation.weaponTypeId, elementId: target.elementId, rarity: operation.rarity, normalCounter: counter, master: input.master })
          action.progressedBuildListEntryIds.forEach((id) => runtime.normals.set(id, [...(runtime.normals.get(id) ?? []), cloneBonuses(bonuses)])); expectedResult = result(cloneBonuses(bonuses), 'normal_artian', null, null)
        } else if (operation.type === 'convert_normal_to_gogma') {
          if (!engine.capabilities.supportsSkillPrediction) return fail('engine_capability_missing', 'Skill prediction capability is unavailable.', index)
          const missing = predictionIssue(runtime, index, true); if (missing) return { isValid: false, drafts: [], issues: [missing] }
          if (runtime.rngState.skillCounter.value === null || !runtime.rngState.skillCounter.isConfirmed) return fail('missing_rng_requirement', 'A confirmed Skill Counter is required.', index)
          let inheritedNormalBonuses: RestorationBonusSet | undefined
          if (entry.candidateSnapshot.route.kind === 'owned_normal_artian_to_gogma') {
            const source = entry.candidateSnapshot.route.sourceOwnedWeaponId === null ? null : runtime.ownedWeapons.find(({ id }) => id === entry.candidateSnapshot.route.sourceOwnedWeaponId)
            if (!source) return fail('missing_source_weapon', 'Owned Normal conversion source is unavailable.', index); if (source.kind !== 'normal') return fail('invalid_source_weapon', 'Owned Normal conversion source is not Normal Artian.', index)
            inheritedNormalBonuses = cloneBonuses(source.restorationBonuses); runtime.ownedWeapons = runtime.ownedWeapons.filter(({ id }) => id !== source.id); inventoryChange = { ...emptyChange(), removeOwnedWeaponIds: [source.id] }
          } else { const normals = runtime.normals.get(entry.id) ?? []; inheritedNormalBonuses = normals.at(-1); if (!inheritedNormalBonuses) return fail('missing_transient_output', 'New Normal conversion requires a transient Normal result.', index); runtime.normals.delete(entry.id) }
          const skills = engine.predictSkills({ baseSeed: runtime.rngState.baseSeed.value!, skillCounter: runtime.rngState.skillCounter.value!, counterGate: runtime.rngState.counterGate.value!, weaponTypeId: operation.weaponTypeId, elementId: target.elementId, master: input.master })
          assignGogma(runtime, action, { restorationBonuses: cloneBonuses(inheritedNormalBonuses), restorationBonusScope: 'normal_artian', seriesSkillId: skills.seriesSkillId, groupSkillId: skills.groupSkillId }); expectedResult = result(cloneBonuses(inheritedNormalBonuses), 'normal_artian', skills.seriesSkillId, skills.groupSkillId)
        } else if (operation.type === 'reset_bonuses' || operation.type === 'keep_bonuses') {
          if (!engine.capabilities.supportsGogmaPrediction || operation.type === 'keep_bonuses' && !engine.capabilities.supportsKeepBonusesPrediction) return fail('engine_capability_missing', 'Gogma prediction capability is unavailable.', index)
          const missing = predictionIssue(runtime, index, true); if (missing) return { isValid: false, drafts: [], issues: [missing] }; if (runtime.rngState.gogmaCounter.value === null || !runtime.rngState.gogmaCounter.isConfirmed) return fail('missing_rng_requirement', 'A confirmed Gogma Counter is required.', index)
          const current = operation.sourceOwnedWeaponId === null ? runtime.gogmas.get(entry.id) ?? null : currentGogma(runtime, entry.id, operation.sourceOwnedWeaponId); if (!current) return fail('missing_source_weapon', 'Gogma source is unavailable.', index)
          if (operation.type === 'keep_bonuses' && current.restorationBonusScope !== 'gogma_artian') return fail('invalid_source_weapon', 'Keep Bonuses requires Gogma-scope bonuses.', index)
          const bonuses = engine.predictGogmaBonus({ baseSeed: runtime.rngState.baseSeed.value!, gogmaCounter: runtime.rngState.gogmaCounter.value, counterGate: runtime.rngState.counterGate.value!, weaponTypeId: target.weaponTypeId, elementId: target.elementId, operation: operation.type === 'reset_bonuses' ? { type: 'reset_bonuses' } : { type: 'keep_bonuses', currentBonuses: current.restorationBonuses }, master: input.master })
          assignGogma(runtime, action, { ...current, restorationBonuses: cloneBonuses(bonuses), restorationBonusScope: 'gogma_artian' }); expectedResult = result(cloneBonuses(bonuses), 'gogma_artian', current.seriesSkillId, current.groupSkillId)
        } else if (operation.type === 'reset_skills') {
          if (!engine.capabilities.supportsSkillPrediction) return fail('engine_capability_missing', 'Skill prediction capability is unavailable.', index)
          const missing = predictionIssue(runtime, index, true); if (missing) return { isValid: false, drafts: [], issues: [missing] }; if (runtime.rngState.skillCounter.value === null || !runtime.rngState.skillCounter.isConfirmed) return fail('missing_rng_requirement', 'A confirmed Skill Counter is required.', index)
          const current = operation.sourceOwnedWeaponId === null ? runtime.gogmas.get(entry.id) : currentGogma(runtime, entry.id, operation.sourceOwnedWeaponId); if (!current) return fail('missing_transient_output', 'Reset Skills requires a current Gogma result.', index)
          const skills = engine.predictSkills({ baseSeed: runtime.rngState.baseSeed.value!, skillCounter: runtime.rngState.skillCounter.value, counterGate: runtime.rngState.counterGate.value!, weaponTypeId: target.weaponTypeId, elementId: target.elementId, master: input.master })
          assignGogma(runtime, action, { restorationBonuses: cloneBonuses(current.restorationBonuses), restorationBonusScope: current.restorationBonusScope, seriesSkillId: skills.seriesSkillId, groupSkillId: skills.groupSkillId }); expectedResult = result(cloneBonuses(current.restorationBonuses), current.restorationBonusScope, skills.seriesSkillId, skills.groupSkillId)
        } else { const source = runtime.ownedWeapons.find(({ id }) => id === operation.ownedWeaponId); if (!source) return fail('missing_source_weapon', 'Material weapon is unavailable.', index); runtime.ownedWeapons = runtime.ownedWeapons.filter(({ id }) => id !== source.id); inventoryChange = { ...emptyChange(), removeOwnedWeaponIds: [source.id] } }
      }
    } catch (error) { return fail('prediction_failed', error instanceof Error ? error.message : 'RNG Engine prediction failed.', index) }
    applySnapshot(runtime, action.rngAfter); if (!sameSnapshot(runtime, action.rngAfter)) return fail('rng_after_mismatch', 'Replay runtime does not match Search Action rngAfter.', index)
    const normalBefore = advance.affectedNormalCounterId === null ? null : action.rngBefore.normalCounters.find(({ id }) => id === advance.affectedNormalCounterId)?.counter ?? null
    const normalAfter = advance.affectedNormalCounterId === null ? null : action.rngAfter.normalCounters.find(({ id }) => id === advance.affectedNormalCounterId)?.counter ?? null
    drafts.push({ operationType: action.actionType, primaryBuildListEntryId: action.primaryBuildListEntryId, progressedBuildListEntryIds: [...action.progressedBuildListEntryIds], targetWeaponId: entry.targetWeaponId, candidateId: entry.candidateSnapshot.id, ownedWeaponId: action.ownedWeaponId, expectedResult, expectedStateBefore, expectedStateAfter: createExpectedPlanState(runtime.rngState, runtime.normalCounters, runtime.ownedWeapons), inventoryChange, rngAdvance: advance, debug: { startBaseSeed: runtime.rngState.baseSeed.value, startGogmaCounter: action.rngBefore.gogmaCounter, endGogmaCounter: action.rngAfter.gogmaCounter, startSkillCounter: action.rngBefore.skillCounter, endSkillCounter: action.rngAfter.skillCounter, startNormalCounter: normalBefore, endNormalCounter: normalAfter, plannerReason: action.actionType } })
  }
  const expected = createExpectedPlanState(bestState.currentRngState, bestState.currentNormalCounters, bestState.simulatedInventory.ownedWeapons)
  const actual = createExpectedPlanState(runtime.rngState, runtime.normalCounters, runtime.ownedWeapons)
  return JSON.stringify(expected) === JSON.stringify(actual) ? { isValid: true, drafts, issues: [] } : fail('final_state_mismatch', 'Replay final state differs from best PlannerSearchState.', null)
}
