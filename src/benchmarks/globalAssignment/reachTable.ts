/**
 * Issue #154 Global Assignment Phase A (Research only; never imported by the app).
 *
 * Builds the ReachTable (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 4.2 / 5.1 / 5.4 / 5.5): for every
 * planning Target of a `GlobalAssignmentContext`, the Counter positions inside an explicit window at
 * which the Production RNG reaches the Target's Ideal, per stream and per source. Only the given
 * `RngEngine`'s public prediction API, `getPredictionSupport()`, the Keep family authority
 * (`keepFamilyLayoutKey()` / `keepFamilyMultisetKey()`) and the Target evaluators
 * (`satisfiesIdealBonuses()` / `evaluateSkillCondition()`) are read. No weight, Counter advance, Gate or
 * game rule is computed here, no Route is built, and nothing outside the window is recorded as absent.
 *
 * Predictions are shared between Targets of one weapon type / element through a memo
 * (design 5.1): Skill / Reset / Normal by position; Keep by position and ordered family layout. Keep
 * reads the Bonus family of each slot only (`AGENTS.md` RNG Rules, `docs/RNG_SPEC.md` 6.1, the same
 * contract `LOWER_BOUND_ASSUMPTIONS` state), so one layout's result stands for every current five-slot
 * set with that layout; prediction *support* is still asked of every concrete five-slot input, and two
 * inputs of one layout that disagree fail closed as an Engine contract violation.
 *
 * The existing BuildListEntries of the context are not read here (design 4.1): the Target set is the
 * context's, and the sources / positions come from the PlannerInput's RngState, Normal Counters,
 * OwnedWeapons and Targets alone. `TargetWeapon.preferredOwnedWeaponId` is not an input either.
 */
import { recommendedCandidateSearchDefaults } from '../../domain/models/common'
import type { ElementId, OwnedWeapon, RestorationBonusSet, TargetWeapon, TargetWeaponId, WeaponTypeId } from '../../domain/models/publicTypes'
import type { PlannerInput } from '../../domain/planner/plannerTypes'
import { keepFamilyLayoutKey, keepFamilyMultisetKey } from '../../domain/rng/gogmaBonusFamily'
import type { NormalizedSeed, RngEngine, RngPredictionSupportInput } from '../../domain/rng/rngEngine'
import { evaluateSkillCondition } from '../../domain/target/skillConditionEvaluator'
import { satisfiesIdealBonuses } from '../../domain/target/targetEvaluator'
import {
  GlobalAssignmentInvariantError,
  type ExcludedOwnedWeaponReason, type GlobalAssignmentContext, type InclusiveRange, type LayoutKey, type NormalArtianCounterId,
  type ReachScanSummary, type ReachTable, type ReachTableResult, type ReachWindow, type SourceCandidate, type TargetReach,
} from './types'

/**
 * The W0 reference window (design 10.3): `recommendedCandidateSearchDefaults` (Issue #125,
 * REQUIREMENTS 14.1), a Production constant of non-oracle origin. It is a reference value for the
 * caller to pass explicitly; this module applies no window of its own and widens none.
 */
export function reachWindowW0(): ReachWindow {
  return {
    normal: recommendedCandidateSearchDefaults.maxNormalAdvance,
    gogma: recommendedCandidateSearchDefaults.maxGogmaAdvance,
    skill: recommendedCandidateSearchDefaults.maxSkillAdvance,
  }
}

/** The existing Research cancel / yield seam. Cancellation is reported as `cancelled`, never as an empty table. */
export interface ReachTableExecution {
  shouldCancel?: () => boolean
  yieldControl?: () => Promise<void>
}

/** Positions scanned between two `yieldControl()` calls. */
const YIELD_INTERVAL = 64

class CancelledSignal extends Error {
  constructor() {
    super('ReachTable scan cancelled.')
    this.name = 'CancelledSignal'
  }
}

export function assertReachWindow(window: ReachWindow): void {
  for (const stream of ['normal', 'gogma', 'skill'] as const) {
    const value = window[stream]
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`ReachWindow.${stream} must be a positive integer (got ${String(value)}).`)
  }
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function emptyCounts(): ReachScanSummary['predictions'] {
  return { skill: 0, gogmaReset: 0, gogmaKeep: 0, normal: 0 }
}

interface Group {
  weaponTypeId: WeaponTypeId
  elementId: ElementId
  targets: TargetWeapon[]
}

/** Targets grouped by weapon type / element in the order the first Target of each group appears (Target ID order). */
function groupTargets(targets: readonly TargetWeapon[]): Group[] {
  const groups = new Map<string, Group>()
  for (const target of targets) {
    const key = `${target.weaponTypeId}\u0000${target.elementId}`
    const group = groups.get(key)
    if (group) group.targets.push(target)
    else groups.set(key, { weaponTypeId: target.weaponTypeId, elementId: target.elementId, targets: [target] })
  }
  return [...groups.values()]
}

function confirmedRarity8Counter(input: PlannerInput, weaponTypeId: WeaponTypeId) {
  const counter = input.normalCounters.find(value => value.weaponTypeId === weaponTypeId && value.rarity === 8) ?? null
  return counter && counter.isConfirmed && counter.counter !== null ? { id: counter.id as NormalArtianCounterId, origin: counter.counter } : null
}

function compatibleOwnedWeapons(input: PlannerInput, group: Group): OwnedWeapon[] {
  return input.ownedWeapons
    .filter(weapon => weapon.weaponTypeId === group.weaponTypeId && weapon.elementId === group.elementId)
    .sort((left, right) => compareStable(left.id, right.id))
}

/** Design 5.2 source rules: a protected Gogma only while already Ideal on both axes; a protected Normal never. */
function classifyOwnedSource(target: TargetWeapon, weapon: OwnedWeapon, master: PlannerInput['master']):
  | { kind: 'source'; gogma: { currentSkillIdeal: boolean; currentBonusIdeal: boolean } | null }
  | { kind: 'excluded'; reason: ExcludedOwnedWeaponReason } {
  if (weapon.kind === 'normal') {
    if (weapon.rarity !== 8) return { kind: 'excluded', reason: 'normal_rarity_not_8' }
    if (weapon.isProtected) return { kind: 'excluded', reason: 'protected_normal' }
    return { kind: 'source', gogma: null }
  }
  const currentSkillIdeal = evaluateSkillCondition(target.idealSkillCondition, weapon.seriesSkillId, weapon.groupSkillId)
  const currentBonusIdeal = satisfiesIdealBonuses(target, weapon.restorationBonuses, weapon.restorationBonusScope, master)
  if (weapon.isProtected && !(currentSkillIdeal && currentBonusIdeal)) return { kind: 'excluded', reason: 'protected_gogma_not_ideal' }
  return { kind: 'source', gogma: { currentSkillIdeal, currentBonusIdeal } }
}

/**
 * Scans every planning Target of the context inside `window`. Async only for the Research cancel /
 * yield seam; the result is deterministic for the same context, Engine and window.
 */
export async function buildReachTable(context: GlobalAssignmentContext, engine: RngEngine, window: ReachWindow,
  execution: ReachTableExecution = {}): Promise<ReachTableResult> {
  assertReachWindow(window)
  const input = context.plannerInput
  const master = input.master
  const { baseSeed, skillCounter, gogmaCounter } = input.rngState
  if (!baseSeed.isConfirmed || baseSeed.value === null || !skillCounter.isConfirmed || skillCounter.value === null
    || !gogmaCounter.isConfirmed || gogmaCounter.value === null) {
    const missing = [!baseSeed.isConfirmed || baseSeed.value === null ? 'Base Seed' : null,
      !skillCounter.isConfirmed || skillCounter.value === null ? 'Skill Counter' : null,
      !gogmaCounter.isConfirmed || gogmaCounter.value === null ? 'Gogma Counter' : null].filter((value): value is string => value !== null)
    return { kind: 'unsupported_input', reason: 'unconfirmed_rng_state', detail: `No confirmed value for: ${missing.join(', ')}.` }
  }
  // Design 15.1: this design places no intermediate state pin, so a selected state is not planned here.
  const pinned = context.validation.validBuildListEntries
    .filter(({ entry }) => context.planningTargetIds.has(entry.targetWeaponId) && entry.intermediateStateSelection !== undefined
      && (entry.intermediateStateSelection.skillOpportunityId !== null || entry.intermediateStateSelection.bonusOpportunityId !== null))
    .map(({ entry }) => entry.id)
  if (pinned.length > 0) {
    return { kind: 'unsupported_input', reason: 'checkpoint_selection', detail: `BuildListEntries with a selected intermediate state: ${pinned.join(', ')}.` }
  }
  // The persisted Base Seed is already normalized; the Domain passes it to the Engine as is.
  const seed = baseSeed.value as NormalizedSeed
  const originSkill = skillCounter.value
  const originGogma = gogmaCounter.value
  const groups = groupTargets(context.planningTargets)

  // Fail closed before any prediction when a Target has no source kind at all (design 5.2).
  for (const group of groups) {
    const counter = confirmedRarity8Counter(input, group.weaponTypeId)
    const normalSupported = engine.getPredictionSupport({ type: 'normal_artian', weaponTypeId: group.weaponTypeId, elementId: group.elementId, rarity: 8 }).supported
    for (const target of group.targets) {
      const hasOwnedSource = compatibleOwnedWeapons(input, group).some(weapon => classifyOwnedSource(target, weapon, master).kind === 'source')
      if (hasOwnedSource) continue
      if (counter === null) {
        return { kind: 'unsupported_input', reason: 'unconfirmed_counter',
          detail: `Target ${target.id} has no owned source and no confirmed rarity-8 Normal Counter for ${group.weaponTypeId}; the blind variant is never an option.` }
      }
      if (!normalSupported) {
        return { kind: 'unsupported_input', reason: 'blind_route_required',
          detail: `Target ${target.id} has no owned source and Normal Artian prediction is unsupported for ${group.weaponTypeId} / ${group.elementId}; only a blind Route could reach it.` }
      }
    }
  }

  const predictions = emptyCounts()
  const memoHits = emptyCounts()
  let supportQueries = 0
  const unsupported: ReachScanSummary['unsupported'] = []
  const summaryGroups: ReachScanSummary['groups'] = []
  const originNormal: Record<NormalArtianCounterId, number> = {}
  const scannedNormal: Record<NormalArtianCounterId, InclusiveRange> = {}
  const reaches = new Map<TargetWeaponId, TargetReach>()
  const skillRange: InclusiveRange = { from: originSkill, to: originSkill + window.skill }
  const gogmaRange: InclusiveRange = { from: originGogma, to: originGogma + window.gogma - 1 }
  let lastGroup: { weaponTypeId: WeaponTypeId; elementId: ElementId } | null = null
  let sinceYield = 0
  const checkpoint = async () => {
    if (execution.shouldCancel?.()) throw new CancelledSignal()
    sinceYield += 1
    if (execution.yieldControl && sinceYield >= YIELD_INTERVAL) {
      sinceYield = 0
      await execution.yieldControl()
    }
  }
  const support = (query: RngPredictionSupportInput) => {
    supportQueries += 1
    return engine.getPredictionSupport(query)
  }

  try {
    for (const group of groups) {
      lastGroup = { weaponTypeId: group.weaponTypeId, elementId: group.elementId }
      const { weaponTypeId, elementId } = group
      const skillSupport = support({ type: 'skill', weaponTypeId, elementId })
      const resetSupport = support({ type: 'gogma_reset', weaponTypeId, elementId, master })
      const normalSupport = support({ type: 'normal_artian', weaponTypeId, elementId, rarity: 8 })
      const counter = confirmedRarity8Counter(input, weaponTypeId)
      if (counter) {
        originNormal[counter.id] = counter.origin
        if (normalSupport.supported) scannedNormal[counter.id] = { from: counter.origin, to: counter.origin + window.normal - 1 }
      }

      // Group-level scan: one prediction per position; every Target of the group reads these.
      const skills = new Map<number, ReturnType<RngEngine['predictSkills']>>()
      if (skillSupport.supported) {
        for (let position = skillRange.from; position <= skillRange.to; position++) {
          await checkpoint()
          predictions.skill += 1
          skills.set(position, engine.predictSkills({ baseSeed: seed, skillCounter: position, weaponTypeId, elementId, master }))
        }
      }
      const resets = new Map<number, { bonuses: RestorationBonusSet; layout: LayoutKey }>()
      if (resetSupport.supported) {
        for (let position = gogmaRange.from; position <= gogmaRange.to; position++) {
          await checkpoint()
          predictions.gogmaReset += 1
          const bonuses = engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: position, weaponTypeId, elementId, operation: { type: 'reset_bonuses' }, master })
          resets.set(position, { bonuses, layout: keepFamilyLayoutKey(bonuses, master) })
        }
      }
      const normals = new Map<number, { bonuses: RestorationBonusSet; layout: LayoutKey }>()
      if (counter && normalSupport.supported) {
        for (let position = counter.origin; position <= counter.origin + window.normal - 1; position++) {
          await checkpoint()
          predictions.normal += 1
          const bonuses = engine.predictNormalArtian({ baseSeed: seed, weaponTypeId, elementId, rarity: 8, normalCounter: position, master })
          normals.set(position, { bonuses, layout: keepFamilyLayoutKey(bonuses, master) })
        }
      }
      const owned = compatibleOwnedWeapons(input, group)

      // Keep support per concrete five-slot input, memoized per layout; a disagreement inside one layout
      // would contradict the family-only Keep contract and fails closed.
      const keepSupportByLayout = new Map<LayoutKey, { supported: boolean; reason: string | null }>()
      const representativeByLayout = new Map<LayoutKey, RestorationBonusSet>()
      const keepSupport = (bonuses: RestorationBonusSet, layout: LayoutKey) => {
        const result = support({ type: 'gogma_keep', weaponTypeId, elementId, currentBonuses: bonuses, master })
        const known = keepSupportByLayout.get(layout)
        if (known && known.supported !== result.supported) {
          throw new GlobalAssignmentInvariantError('engine_contract_violation',
            `Keep support differs between two five-slot inputs of one family layout (${weaponTypeId} / ${elementId}, layout ${layout.split('\u0000').join('|')}).`)
        }
        if (!known) {
          keepSupportByLayout.set(layout, { supported: result.supported, reason: result.supported ? null : result.reason })
          if (result.supported) representativeByLayout.set(layout, bonuses)
        }
        return result.supported
      }
      const keeps = new Map<string, RestorationBonusSet>()
      const keep = (layout: LayoutKey, position: number): RestorationBonusSet => {
        const key = `${position}\u0000${layout}`
        const memo = keeps.get(key)
        if (memo) { memoHits.gogmaKeep += 1; return memo }
        const representative = representativeByLayout.get(layout)
        if (!representative) throw new GlobalAssignmentInvariantError('prediction_unsupported', `Keep layout ${layout} has no supported representative input.`)
        predictions.gogmaKeep += 1
        const result = engine.predictGogmaBonus({ baseSeed: seed, gogmaCounter: position, weaponTypeId, elementId,
          operation: { type: 'keep_bonuses', currentBonuses: structuredClone(representative) }, master })
        keeps.set(key, result)
        return result
      }
      const groupLayoutsOfInterest = new Set<LayoutKey>()

      for (const target of group.targets) {
        if (!skillSupport.supported) unsupported.push({ targetWeaponId: target.id, prediction: 'skill', reason: skillSupport.reason })
        if (!resetSupport.supported) unsupported.push({ targetWeaponId: target.id, prediction: 'gogma_reset', reason: resetSupport.reason })
        if (!normalSupport.supported) unsupported.push({ targetWeaponId: target.id, prediction: 'normal_artian', reason: normalSupport.reason })
        const idealMultiset = keepFamilyMultisetKey(target.idealBonuses, master)
        const ofInterest = (layout: LayoutKey) => layout.split('\u0000').sort().join('\u0000') === idealMultiset

        const sources: SourceCandidate[] = []
        const excludedOwnedWeapons: TargetReach['excludedOwnedWeapons'] = []
        // Layout-of-interest inputs in deterministic order: owned by ID, Normal by position, Reset by position.
        const interestInputs: { layout: LayoutKey; bonuses: RestorationBonusSet }[] = []
        for (const weapon of owned) {
          const classified = classifyOwnedSource(target, weapon, master)
          if (classified.kind === 'excluded') { excludedOwnedWeapons.push({ ownedWeaponId: weapon.id, reason: classified.reason }); continue }
          const layout = keepFamilyLayoutKey(weapon.restorationBonuses, master)
          const keepSupported = keepSupport(weapon.restorationBonuses, layout)
          if (ofInterest(layout)) interestInputs.push({ layout, bonuses: weapon.restorationBonuses })
          if (weapon.kind === 'gogma') {
            sources.push({ kind: 'owned_gogma', ownedWeaponId: weapon.id, layout, scope: weapon.restorationBonusScope,
              currentSkillIdeal: classified.gogma!.currentSkillIdeal, currentBonusIdeal: classified.gogma!.currentBonusIdeal,
              isProtected: weapon.isProtected, keepSupported })
          } else {
            sources.push({ kind: 'owned_normal', ownedWeaponId: weapon.id, layout, isProtected: false, keepSupported })
          }
        }
        if (counter) {
          for (const [position, normal] of normals) {
            const keepSupported = keepSupport(normal.bonuses, normal.layout)
            if (ofInterest(normal.layout)) interestInputs.push({ layout: normal.layout, bonuses: normal.bonuses })
            sources.push({ kind: 'new_normal', counterId: counter.id, position, layout: normal.layout, keepSupported })
          }
        }
        for (const [, reset] of resets) {
          if (!ofInterest(reset.layout)) continue
          keepSupport(reset.bonuses, reset.layout)
          interestInputs.push({ layout: reset.layout, bonuses: reset.bonuses })
        }

        const layoutsOfInterest = [...new Set(interestInputs.map(({ layout }) => layout))].sort(compareStable)
        const keepIdealPositionsByLayout = new Map<LayoutKey, number[]>()
        const keepUnsupportedLayouts: LayoutKey[] = []
        for (const layout of layoutsOfInterest) {
          groupLayoutsOfInterest.add(layout)
          const supportState = keepSupportByLayout.get(layout)!
          if (!supportState.supported) {
            keepUnsupportedLayouts.push(layout)
            unsupported.push({ targetWeaponId: target.id, prediction: 'gogma_keep', reason: supportState.reason ?? 'unsupported', layout })
            continue
          }
          const positions: number[] = []
          for (let position = gogmaRange.from; position <= gogmaRange.to; position++) {
            await checkpoint()
            if (satisfiesIdealBonuses(target, keep(layout, position), 'gogma_artian', master)) positions.push(position)
          }
          keepIdealPositionsByLayout.set(layout, positions)
        }

        const idealPositions: number[] = []
        for (const [position, result] of skills) {
          if (evaluateSkillCondition(target.idealSkillCondition, result.seriesSkillId, result.groupSkillId)) idealPositions.push(position)
        }
        const resetIdealPositions: number[] = []
        const resetLayoutByPosition = new Map<number, LayoutKey>()
        for (const [position, reset] of resets) {
          resetLayoutByPosition.set(position, reset.layout)
          if (satisfiesIdealBonuses(target, reset.bonuses, 'gogma_artian', master)) resetIdealPositions.push(position)
        }
        // Every Target after the first reads the group's Skill / Reset / Normal results from the memo.
        if (group.targets.indexOf(target) > 0) { memoHits.skill += skills.size; memoHits.gogmaReset += resets.size; memoHits.normal += normals.size }

        reaches.set(target.id, {
          targetWeaponId: target.id, weaponTypeId, elementId,
          normalCounterId: counter?.id ?? null,
          support: { normal: normalSupport.supported, skill: skillSupport.supported, gogmaReset: resetSupport.supported },
          skill: { idealPositions, resetSkillsLimit: originSkill + window.skill - 1, conversionLimit: originSkill + window.skill },
          bonus: { resetIdealPositions, resetLayoutByPosition, keepIdealPositionsByLayout, keepUnsupportedLayouts },
          sources,
          excludedOwnedWeapons,
        })
      }
      summaryGroups.push({ weaponTypeId, elementId, targetWeaponIds: group.targets.map(target => target.id), keepLayoutsOfInterest: [...groupLayoutsOfInterest].sort(compareStable) })
    }
  } catch (error) {
    if (error instanceof CancelledSignal) return { kind: 'cancelled', progress: { predictions, lastGroup } }
    throw error
  }

  const table: ReachTable = {
    originSkill, originGogma, originNormal,
    window: { ...window },
    scanned: { skill: skillRange, gogma: gogmaRange, normal: scannedNormal },
    targets: context.planningTargets.map(target => reaches.get(target.id)!),
    summary: { predictions, memoHits, supportQueries, groups: summaryGroups, unsupported },
  }
  return { kind: 'reach_table', table }
}
