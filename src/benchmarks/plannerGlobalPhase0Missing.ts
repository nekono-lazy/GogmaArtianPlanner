/**
 * Issue #154 Phase 0 missing-Target diagnosis (Research only; never imported by the app).
 *
 * Two read-only helpers around the Phase 0 sequential-projection prototype:
 *
 * - `mapGlobalResearchTargetResources()` reads, for one captured Search input, which Counter positions of each
 *   stream can supply the Target's Ideal at all. It calls only the given RNG Engine's public prediction methods
 *   and the existing Keep family / Target evaluation authorities. It is a necessary-condition map, never a
 *   Candidate: it does not decide a Route, does not combine streams and does not replace Candidate Search.
 * - `verifyGlobalResearchFreshPlan()` rebuilds the original 43-Target PlannerInput with the generated Entries
 *   swapped in for their Targets' original Entries and runs one fresh ordinary Production Planner plus an
 *   independent Trace Replay. Target definitions are compared with the original input, never relaxed.
 */
import { hashStableValue } from '../domain/models/publicTypes'
import type { BuildListEntry, RestorationBonusSet } from '../domain/models/publicTypes'
import { createProductionPlanWithObserver } from '../domain/planner/productionPlanGeneration'
import { replayPlannerSearchTrace } from '../domain/planner/plannerTraceReplay'
import { validatePlannerInput } from '../domain/planner/plannerValidation'
import type { PlannerDependencies, PlannerInput, PlannerRunResult } from '../domain/planner/plannerTypes'
import { keepFamilyLayout } from '../domain/rng/gogmaBonusFamily'
import type { NormalizedSeed, RngEngine } from '../domain/rng/rngEngine'
import type { CandidateSearchInput } from '../domain/search/searchTypes'
import { evaluateTargetSkillMatch, satisfiesIdealBonuses } from '../domain/target/targetEvaluator'

export interface CounterWindow { from: number; to: number }

export interface GlobalResearchTargetResourceMap {
  targetId: string
  /** Counters the captured Search started from (the projected state). */
  projected: { normal: number | null; gogma: number | null; skill: number | null }
  idealFamilyMultiset: string[]
  /**
   * Normal forge positions whose unordered Keep family multiset equals the Ideal's. A Keep-only Bonus lane
   * after conversion can reach the Ideal only from such a forge (Keep preserves families per slot);
   * this is necessary, not sufficient (the tiers still have to be rerolled within the Gogma window).
   */
  normal: CounterWindow & { familyCompatiblePositions: number[] }
  /** Reset results with the Ideal's family multiset, and Reset results that already are the exact Ideal. */
  gogmaReset: CounterWindow & { familyCompatiblePositions: number[]; idealPositions: number[] }
  /** Skill positions whose predicted Series / Group satisfy the Ideal Skill condition. */
  skill: CounterWindow & { idealPositions: number[] }
}

function sortedFamilies(bonuses: RestorationBonusSet, master: CandidateSearchInput['master']): string {
  return keepFamilyLayout(bonuses, master).sort().join('|')
}

function assertWindow(name: string, window: CounterWindow) {
  if (!Number.isSafeInteger(window.from) || !Number.isSafeInteger(window.to) || window.from < 0 || window.to < window.from) {
    throw new RangeError(`Invalid ${name} window ${JSON.stringify(window)}`)
  }
}

function positions(window: CounterWindow, accept: (position: number) => boolean): number[] {
  const found: number[] = []
  for (let position = window.from; position <= window.to; position++) if (accept(position)) found.push(position)
  return found
}

export function mapGlobalResearchTargetResources(search: CandidateSearchInput, engine: RngEngine,
  windows: { normal: CounterWindow; gogma: CounterWindow; skill: CounterWindow }): GlobalResearchTargetResourceMap {
  assertWindow('normal', windows.normal)
  assertWindow('gogma', windows.gogma)
  assertWindow('skill', windows.skill)
  const target = search.targetWeapons.find(t => t.id === search.targetWeaponId)
  if (!target) throw new Error('Search Target is missing from its own input.')
  if (search.rngState.baseSeed.value === null) throw new Error('Resource map needs a Base Seed.')
  const baseSeed = search.rngState.baseSeed.value as NormalizedSeed
  const { weaponTypeId, elementId } = target
  const master = search.master
  const ideal = sortedFamilies(target.idealBonuses, master)
  const normalCounter = search.normalCounters.find(c => c.weaponTypeId === weaponTypeId && c.rarity === 8)
  const confirmed = <T>(value: { value: T | null; isConfirmed: boolean }) => value.isConfirmed ? value.value : null
  const resets = new Map<number, RestorationBonusSet>()
  const reset = (gogmaCounter: number) => {
    let bonuses = resets.get(gogmaCounter)
    if (!bonuses) resets.set(gogmaCounter, bonuses = engine.predictGogmaBonus({ baseSeed, gogmaCounter, weaponTypeId, elementId, operation: { type: 'reset_bonuses' }, master }))
    return bonuses
  }
  return {
    targetId: target.id,
    projected: { normal: normalCounter?.isConfirmed ? normalCounter.counter : null,
      gogma: confirmed(search.rngState.gogmaCounter), skill: confirmed(search.rngState.skillCounter) },
    idealFamilyMultiset: ideal.split('|'),
    normal: { ...windows.normal, familyCompatiblePositions: positions(windows.normal, normalCounterPosition =>
      sortedFamilies(engine.predictNormalArtian({ baseSeed, weaponTypeId, elementId, rarity: 8, normalCounter: normalCounterPosition, master }), master) === ideal) },
    gogmaReset: { ...windows.gogma,
      familyCompatiblePositions: positions(windows.gogma, p => sortedFamilies(reset(p), master) === ideal),
      idealPositions: positions(windows.gogma, p => satisfiesIdealBonuses(target, reset(p), 'gogma_artian', master)) },
    skill: { ...windows.skill, idealPositions: positions(windows.skill, skillCounter => {
      const skills = engine.predictSkills({ baseSeed, skillCounter, weaponTypeId, elementId, master })
      return evaluateTargetSkillMatch(target, skills.seriesSkillId, skills.groupSkillId) === 'ideal'
    }) },
  }
}

export interface GlobalResearchFreshPlanVerification {
  replacedTargetIds: string[]
  keptOriginalTargetIds: string[]
  targetDefinitionsUnchanged: boolean
  inputValid: boolean
  excludedEntries: number
  planningTargetCount: number
  completedTargetCount: number
  terminationStatus: string
  reachedLimits: string[]
  selected: number
  conflicts: { id: string; kind: string; reason: string; targetIds: string[]; selectedTargetId: string | null }[]
  rejected: { targetId: string; reason: string }[]
  steps: number
  expandedStates: number
  /** Full Planner runs including runtime-unsupported retries; the replay checks the last run's trace. */
  fullRuns: number
  plannerTraceReplay: 'valid' | 'invalid' | 'not_run'
  traceReplayIssues: string[]
  planFingerprint: string | null
  success: boolean
}

/**
 * Fresh ordinary Planner over the original input with one generated Entry per replaced Target. The
 * original Target collection, RNG state, Counters and OwnedWeapons are used exactly as given.
 */
export async function verifyGlobalResearchFreshPlan(original: PlannerInput, generated: readonly BuildListEntry[], dependencies: PlannerDependencies): Promise<GlobalResearchFreshPlanVerification> {
  const byTarget = new Map<string, BuildListEntry>()
  for (const entry of generated) {
    if (byTarget.has(entry.targetWeaponId)) throw new Error(`Two generated Entries for Target ${entry.targetWeaponId}.`)
    byTarget.set(entry.targetWeaponId, entry)
  }
  const originalTargets = new Set<string>(original.buildListEntries.map(e => e.targetWeaponId))
  if ([...byTarget.keys()].some(id => !originalTargets.has(id))) throw new Error('A generated Entry names a Target outside the original Build List.')
  const input: PlannerInput = { ...structuredClone(original), conflictResolutions: [],
    buildListEntries: original.buildListEntries.map(entry => structuredClone(byTarget.get(entry.targetWeaponId) ?? entry)) }
  const targetDefinitionsUnchanged = hashStableValue(input.targetWeapons) === hashStableValue(original.targetWeapons)
  const validation = validatePlannerInput(input, dependencies)
  let observed: PlannerRunResult | null = null
  let fullRuns = 0
  const result = await createProductionPlanWithObserver(input, dependencies, {}, { beforePlannerRun: () => { fullRuns += 1 }, afterPlannerRun: value => { observed = value } })
  const targetOf = new Map(input.buildListEntries.map(e => [e.id, e.targetWeaponId]))
  const state = (observed as PlannerRunResult | null)?.bestState
  const replay = state ? replayPlannerSearchTrace(input, state, dependencies.rngEngine) : null
  const plan = result.plan
  const rejected = plan?.rejectedBuildListEntries.map(r => ({ targetId: targetOf.get(r.buildListEntryId) ?? r.buildListEntryId, reason: r.reason })) ?? []
  const summary = {
    replacedTargetIds: [...byTarget.keys()].sort(),
    keptOriginalTargetIds: [...originalTargets].filter(id => !byTarget.has(id)).sort(),
    targetDefinitionsUnchanged,
    inputValid: validation.isValid,
    excludedEntries: validation.excludedBuildListEntries.length,
    planningTargetCount: result.termination.totalTargetCount,
    completedTargetCount: result.termination.completedTargetCount,
    terminationStatus: result.termination.status,
    reachedLimits: [...result.termination.reachedLimits],
    selected: plan?.selectedBuildListEntryIds.length ?? 0,
    conflicts: result.conflicts.map(c => ({ id: c.id, kind: c.kind, reason: c.reason, targetIds: c.buildListEntryIds.map(id => targetOf.get(id) ?? id),
      selectedTargetId: c.selectedBuildListEntryId === null ? null : targetOf.get(c.selectedBuildListEntryId) ?? c.selectedBuildListEntryId })),
    rejected,
    steps: plan?.steps.length ?? 0,
    expandedStates: result.termination.expandedStates,
    fullRuns,
    plannerTraceReplay: replay === null ? 'not_run' as const : replay.isValid ? 'valid' as const : 'invalid' as const,
    traceReplayIssues: replay?.issues.map(issue => issue.code) ?? [],
    planFingerprint: plan ? hashStableValue({ steps: plan.steps.map(s => ({ op: s.operationType, entry: s.buildListEntryId, rng: s.rngAdvance })), selected: plan.selectedBuildListEntryIds }) : null,
  }
  return { ...summary, success: summary.targetDefinitionsUnchanged && summary.inputValid && summary.excludedEntries === 0 && plan !== null &&
    summary.terminationStatus === 'completed' && summary.completedTargetCount === summary.planningTargetCount && summary.planningTargetCount === originalTargets.size &&
    summary.conflicts.length === 0 && summary.rejected.length === 0 && summary.plannerTraceReplay === 'valid' }
}
