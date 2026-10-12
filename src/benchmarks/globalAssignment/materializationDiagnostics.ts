/**
 * Issue #154 Global Assignment Phase D-0B (Research only; never imported by the app).
 *
 * The diagnostics the D-0B runner records around one structural candidate's materialization
 * (`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` 19, `docs/PLANNER_GLOBAL_ASSIGNMENT_IDEAL_CONTINUATION_AUDIT.md`
 * 3.3 / 3.6 / 9.1). Every function here is a pure reading of the structural candidate, the ReachTable, the
 * Planner-start PlannerInput and (for the request-level and measured parts) the materialization's own records.
 * No prediction, Search, Planner run or reservation derivation happens here, and no diagnostic classifies a
 * candidate as failed, infeasible or excluded:
 *
 * - G1 (Search-policy shape): the lane-start Ideal Skill continuations of the candidate (`searchPolicyShapeOf()`,
 *   the same authority the materialization's pre-Search check uses), decided from the ReachTable alone.
 * - G3 (Bonus frontier collapse risk): for a `keep_from_source` / `reset_then_keep` option, the Reset positions
 *   inside the Keep chain whose Reset result has the chain's ordered family layout. The held-aware Bonus stream merges
 *   states of one depth that share their position and layout and keeps the latest Reset as the representative, so
 *   a Route that must operate at such a position may come back with another required position set. The static part
 *   is a risk condition only; the request part adds whether the position was held / blocked in the formal
 *   reservation of an executed request; the measured part counts delivered Candidates whose only mismatch was the
 *   required Gogma positions. None of them says the Route does not exist.
 * - G4 (Planner-start Ideal): the planning Targets that already hold an Ideal owned Gogma at Planner start
 *   (`deriveTargetSatisfaction()`), split into the audit's G4-i / G4-ii / G4-iii. Whether the Planner commits such a
 *   Target's Entry depends on its state transitions (in-flight re-evaluation, dynamic commitment), which only Phase D'
 *   decides; the categories are diagnostics, never a rejection.
 */
import type { OwnedWeaponId, TargetWeaponId } from '../../domain/models/publicTypes'
import { deriveTargetSatisfaction } from '../../domain/planner/targetSatisfaction'
import type { PlannerAlternativeReservation } from '../../domain/search/alternative'
import type { StructuralCandidate } from './coverageTypes'
import { searchPolicyShapeOf } from './materializationShape'
import type { CandidateInspection, MaterializationAttempt, MaterializationMethod, SearchPolicyShape, ShapeMismatchReason } from './materializationTypes'
import type { GlobalAssignmentContext, InclusiveRange, LayoutKey, ReachOption, ReachTable, SourceCandidate } from './types'

const ascending = (values: Iterable<number>) => [...values].sort((left, right) => left - right)

function optionsInOrder(candidate: StructuralCandidate): { option: ReachOption; orderIndex: number }[] {
  return candidate.materializationOrder.map((targetWeaponId, orderIndex) => {
    const option = candidate.assignment.chosen.get(targetWeaponId)
    if (!option) throw new RangeError(`The structural candidate holds no option for Target ${targetWeaponId}.`)
    return { option, orderIndex }
  })
}

function sourceOwnedWeaponId(source: SourceCandidate): OwnedWeaponId | null {
  return source.kind === 'new_normal' ? null : source.ownedWeaponId
}

/** Whether the option operates its source on the Skill or Bonus lane (a new Normal source always does: it is forged and converted). */
function operatesSource(option: ReachOption): boolean {
  return option.source.kind !== 'owned_gogma' || option.skillRequired.kind !== 'none' || option.bonusRequired.kind !== 'none'
}

// ------------------------------------------------------------------------------------------------ G1 / continuations

export interface SearchPolicyShapeDiagnostic {
  targetWeaponId: TargetWeaponId
  /** The Target's index in the materialization order. */
  orderIndex: number
  sourceKind: SourceCandidate['kind']
  policyShape: SearchPolicyShape
}

export interface SearchPolicyShapeDiagnostics {
  /** Every Search-policy shape of the candidate (design 19.3 G1), in materialization order. */
  shapes: SearchPolicyShapeDiagnostic[]
  /** The materialization order index of the first one, or null. */
  firstOrderIndex: number | null
}

export function diagnoseSearchPolicyShapes(candidate: StructuralCandidate, table: ReachTable): SearchPolicyShapeDiagnostics {
  const shapes: SearchPolicyShapeDiagnostic[] = []
  for (const { option, orderIndex } of optionsInOrder(candidate)) {
    const policyShape = searchPolicyShapeOf(option, table)
    if (policyShape !== null) shapes.push({ targetWeaponId: option.targetWeaponId, orderIndex, sourceKind: option.source.kind, policyShape })
  }
  return { shapes, firstOrderIndex: shapes[0]?.orderIndex ?? null }
}

/** The lane-start Ideal continuation options of a candidate (audit 9.1 (iv)). */
export interface ContinuationOptionCounts {
  /** S1 (design 19.3 G1): conversion continuations, the only kind the current Phase A option set lists. */
  laneStartIdealSkillContinuation: number
  /** S2 / B1 / B2 (design 19.3 G2): the current Phase A never generates an owned-Gogma continuation, so none can be observed here. */
  ownedGogmaContinuation: 'not_generated_by_current_phase_a'
}

export function countContinuationOptions(candidate: StructuralCandidate, table: ReachTable): ContinuationOptionCounts {
  return { laneStartIdealSkillContinuation: diagnoseSearchPolicyShapes(candidate, table).shapes.length, ownedGogmaContinuation: 'not_generated_by_current_phase_a' }
}

// ------------------------------------------------------------------------------------------------ G3

export type BonusFrontierOptionKind = 'keep_from_source' | 'reset_then_keep'

export interface BonusFrontierRisk {
  targetWeaponId: TargetWeaponId
  orderIndex: number
  option: BonusFrontierOptionKind
  /** The option's required Gogma positions (`[g*]` or `[g1, g*]`). */
  requiredGogma: number[]
  /** The ordered family layout the Keep chain carries: the source's (`keep_from_source`) or the Reset at `g1`'s. */
  chainLayout: LayoutKey
  /**
   * Where a Reset could stand inside the Keep chain from the Planner-start Gogma origin (inclusive):
   * `origin .. g* - 1`, or `g1 + 1 .. g* - 1`. Null when the range is empty.
   */
  scanRange: InclusiveRange | null
  /** Positions of `scanRange` whose ReachTable Reset result has `chainLayout`, ascending: the static risk positions. */
  sameLayoutResetPositions: number[]
  /** Those positions that are another Target's required Gogma position in this candidate. */
  otherTargetRequired: { position: number; targetWeaponId: TargetWeaponId }[]
}

export interface BonusFrontierRiskDiagnostics {
  /** The `keep_from_source` / `reset_then_keep` options of the candidate. */
  applicableOptions: number
  /** Those with at least one same-layout Reset position in their range (a risk condition, not an occurrence). */
  withStaticRisk: number
  /** One row per applicable option, in materialization order. */
  targets: BonusFrontierRisk[]
}

function chainOf(option: ReachOption, table: ReachTable): { kind: BonusFrontierOptionKind; layout: LayoutKey; from: number; to: number; required: number[] } | null {
  const bonus = option.bonusRequired
  if (bonus.kind === 'keep_from_source') {
    return { kind: bonus.kind, layout: option.source.layout, from: table.originGogma, to: bonus.finalPosition - 1, required: [bonus.finalPosition] }
  }
  if (bonus.kind === 'reset_then_keep') {
    const row = table.targets.find(value => value.targetWeaponId === option.targetWeaponId)
    const layout = row?.bonus.resetLayoutByPosition.get(bonus.resetPosition)
    if (layout === undefined) throw new RangeError(`Target ${option.targetWeaponId}: the ReachTable holds no Reset layout at ${bonus.resetPosition}.`)
    return { kind: bonus.kind, layout, from: bonus.resetPosition + 1, to: bonus.finalPosition - 1, required: [bonus.resetPosition, bonus.finalPosition] }
  }
  return null
}

function sameLayoutResetPositions(option: ReachOption, table: ReachTable, layout: LayoutKey, from: number, to: number): number[] {
  const row = table.targets.find(value => value.targetWeaponId === option.targetWeaponId)
  if (!row) throw new RangeError(`Target ${option.targetWeaponId} has no ReachTable row.`)
  const positions: number[] = []
  for (const [position, resetLayout] of row.bonus.resetLayoutByPosition) if (position >= from && position <= to && resetLayout === layout) positions.push(position)
  return ascending(positions)
}

/** Design 19.3 G3, static part: the same-layout Reset positions inside every Keep chain of the candidate (no reservation, no Search). */
export function diagnoseBonusFrontierRisk(candidate: StructuralCandidate, table: ReachTable): BonusFrontierRiskDiagnostics {
  const requiredOwner = new Map<number, TargetWeaponId>()
  for (const option of candidate.assignment.chosen.values()) {
    const bonus = option.bonusRequired
    if (bonus.kind === 'reset' || bonus.kind === 'keep_from_source') requiredOwner.set(bonus.finalPosition, option.targetWeaponId)
    if (bonus.kind === 'reset_then_keep') { requiredOwner.set(bonus.resetPosition, option.targetWeaponId); requiredOwner.set(bonus.finalPosition, option.targetWeaponId) }
  }
  const targets: BonusFrontierRisk[] = []
  for (const { option, orderIndex } of optionsInOrder(candidate)) {
    const chain = chainOf(option, table)
    if (chain === null) continue
    const scanRange = chain.from <= chain.to ? { from: chain.from, to: chain.to } : null
    const positions = scanRange === null ? [] : sameLayoutResetPositions(option, table, chain.layout, scanRange.from, scanRange.to)
    targets.push({
      targetWeaponId: option.targetWeaponId, orderIndex, option: chain.kind, requiredGogma: chain.required, chainLayout: chain.layout, scanRange,
      sameLayoutResetPositions: positions,
      otherTargetRequired: positions.flatMap(position => {
        const owner = requiredOwner.get(position)
        return owner !== undefined && owner !== option.targetWeaponId ? [{ position, targetWeaponId: owner }] : []
      }),
    })
  }
  return { applicableOptions: targets.length, withStaticRisk: targets.filter(row => row.sameLayoutResetPositions.length > 0).length, targets }
}

export type ReservationStatus = 'free' | 'held' | 'blocked'

export interface BonusFrontierRequestRisk {
  method: MaterializationMethod
  /** The request's Gogma start (the Planner-start origin for design 9.1, the projected start for design 9.2). */
  gogmaStart: number
  /** The same-layout Reset positions inside the request's chain range, with their status in the request's formal reservation. */
  positions: { position: number; reservation: ReservationStatus }[]
  /**
   * A same-layout Reset position that is neither held nor blocked: every Route of the request must operate there, so
   * its Keep state and the Reset state of that position share position and layout (the collapse condition read from
   * the stream code). Still a condition: whether the expected shape came back is the measured part.
   */
  collapseConditionHolds: boolean
}

function reservationStatus(reservation: PlannerAlternativeReservation | null, position: number): ReservationStatus {
  if (reservation === null) return 'free'
  if (reservation.gogma.blocked.includes(position)) return 'blocked'
  return reservation.gogma.held.includes(position) ? 'held' : 'free'
}

/** Design 19.3 G3, request part: the static risk positions of one executed or gated request, read against its own reservation. */
export function bonusFrontierRequestRisk(risk: BonusFrontierRisk, attempt: MaterializationAttempt, table: ReachTable): BonusFrontierRequestRisk {
  const gogmaStart = attempt.request.scaleDetail.origins.gogma
  const option = attempt.request.shape.option
  const chain = chainOf(option, table)
  if (chain === null) throw new RangeError(`Target ${risk.targetWeaponId}: the request's option has no Keep chain.`)
  const from = Math.max(chain.from, gogmaStart)
  const positions = from <= chain.to ? sameLayoutResetPositions(option, table, chain.layout, from, chain.to) : []
  const rows = positions.map(position => ({ position, reservation: reservationStatus(attempt.request.reservation, position) }))
  return { method: attempt.method, gogmaStart, positions: rows, collapseConditionHolds: rows.some(row => row.reservation === 'free') }
}

export interface BonusFrontierMeasured {
  /**
   * Mismatches whose only reason is `gogma_required` and whose last required Gogma position is still the shape's `g*`:
   * the same final position reached through other earlier required positions. (A `gogma_required`-only mismatch ending
   * elsewhere is simply another Ideal Route of the same source, for example a cheaper one ending earlier.)
   */
  sameFinalPositionMismatches: number
  /** Those whose required Gogma positions are exactly `[q, g*]` with `q` a static risk position: the observed G3 collapse signature. */
  collapseSignatures: number
  /** The first few signature required-position sets. */
  collapseSamples: number[][]
}

/** Design 19.3 G3, measured part: the deliveries of a risk Target that carry the collapse signature (never "no Route"). */
export function measureBonusFrontierCollapse(risk: BonusFrontierRisk, inspections: readonly CandidateInspection[], sampleLimit: number): BonusFrontierMeasured {
  const finalPosition = risk.requiredGogma[risk.requiredGogma.length - 1]!
  const measured: BonusFrontierMeasured = { sameFinalPositionMismatches: 0, collapseSignatures: 0, collapseSamples: [] }
  for (const { match } of inspections) {
    if (match.matches || match.plannerRequired === null || match.reasons.length !== 1 || match.reasons[0] !== 'gogma_required') continue
    const gogma = match.plannerRequired.gogma
    if (gogma[gogma.length - 1] !== finalPosition) continue
    measured.sameFinalPositionMismatches += 1
    if (gogma.length === 2 && risk.sameLayoutResetPositions.includes(gogma[0]!)) {
      measured.collapseSignatures += 1
      if (measured.collapseSamples.length < sampleLimit) measured.collapseSamples.push([...gogma])
    }
  }
  return measured
}

const REQUIRED_REASONS: ReadonlySet<ShapeMismatchReason> = new Set(['skill_required', 'gogma_required', 'normal_required'])

export interface InspectionSummary {
  inspected: number
  matched: number
  /** Mismatches whose every reason is a required position (the source, the final bonuses, the scope and the Skills were equal). */
  requiredPositionsOnly: number
  /** Mismatches whose only reason is `gogma_required` (the measured G3 signature: same final weapon, other Gogma required positions). */
  gogmaRequiredOnly: number
  reasonCounts: Partial<Record<ShapeMismatchReason, number>>
  /** The first few `gogma_required`-only mismatches. */
  gogmaRequiredOnlySamples: { method: MaterializationMethod; deliveredIndex: number; plannerRequiredGogma: number[] | null }[]
}

export function summarizeInspections(inspections: readonly CandidateInspection[], sampleLimit: number): InspectionSummary {
  const summary: InspectionSummary = { inspected: 0, matched: 0, requiredPositionsOnly: 0, gogmaRequiredOnly: 0, reasonCounts: {}, gogmaRequiredOnlySamples: [] }
  for (const inspection of inspections) {
    summary.inspected += 1
    const { match } = inspection
    if (match.matches) { summary.matched += 1; continue }
    for (const reason of match.reasons) summary.reasonCounts[reason] = (summary.reasonCounts[reason] ?? 0) + 1
    if (match.reasons.length > 0 && match.reasons.every(reason => REQUIRED_REASONS.has(reason))) summary.requiredPositionsOnly += 1
    if (match.reasons.length === 1 && match.reasons[0] === 'gogma_required') {
      summary.gogmaRequiredOnly += 1
      if (summary.gogmaRequiredOnlySamples.length < sampleLimit) {
        summary.gogmaRequiredOnlySamples.push({ method: inspection.method, deliveredIndex: inspection.deliveredIndex, plannerRequiredGogma: match.plannerRequired === null ? null : [...match.plannerRequired.gogma] })
      }
    }
  }
  summary.reasonCounts = Object.fromEntries(Object.entries(summary.reasonCounts).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
  return summary
}

// ------------------------------------------------------------------------------------------------ G4

/**
 * The audit 3.6 cases of a planning Target that holds an Ideal owned Gogma at Planner start:
 * - `zero_operation_ideal`: its own option is `none / none` on one of those weapons (the ordinary zero-operation case, not G4)
 * - `g4_iii`: its own option operates one of those weapons (a both-axis Ideal source; the current Phase A never generates it)
 * - `g4_ii`: one of those weapons is the source of another planning Target's option (the Planner's re-evaluation depends on the execution order)
 * - `g4_i`: none of those weapons is the source of any option of the candidate (the Target's own Route may never be committed)
 */
export type PlannerStartIdealCategory = 'zero_operation_ideal' | 'g4_i' | 'g4_ii' | 'g4_iii'

export interface PlannerStartIdealTarget {
  targetWeaponId: TargetWeaponId
  orderIndex: number
  category: PlannerStartIdealCategory
  /** `W_t`: the owned Gogma satisfying the Target's Ideal at Planner start (`deriveTargetSatisfaction()`, protected ones included). */
  idealOwnedWeaponIds: OwnedWeaponId[]
  ownOption: { sourceKind: SourceCandidate['kind']; sourceOwnedWeaponId: OwnedWeaponId | null; operatesSource: boolean }
  /** For each weapon of `W_t`: the options of the candidate whose source it is, and whether they operate it. */
  weapons: { ownedWeaponId: OwnedWeaponId; sourceOf: { targetWeaponId: TargetWeaponId; operates: boolean }[] }[]
}

export interface PlannerStartIdealDiagnostics {
  /** Planning Targets with `hasIdeal` at Planner start (a start state, never a permanent completion). */
  plannerStartIdealTargets: number
  counts: Record<PlannerStartIdealCategory, number>
  /** G4-iii needs a continuation option on a both-axis Ideal source, which the current Phase A never generates (design 19.3 G2). */
  g4iiiObservability: 'not_generated_by_current_phase_a'
  targets: PlannerStartIdealTarget[]
}

/** Design 19.3 G4 / audit 3.6: static diagnostics from the Planner-start inventory and the candidate's sources. Never a rejection. */
export function diagnosePlannerStartIdeal(candidate: StructuralCandidate, context: GlobalAssignmentContext): PlannerStartIdealDiagnostics {
  const input = context.plannerInput
  const satisfaction = deriveTargetSatisfaction(context.planningTargets, input.ownedWeapons, input.master)
  const orderIndex = new Map(candidate.materializationOrder.map((id, index) => [id, index]))
  const sourceOf = new Map<OwnedWeaponId, { targetWeaponId: TargetWeaponId; operates: boolean }[]>()
  for (const option of candidate.assignment.chosen.values()) {
    const weapon = sourceOwnedWeaponId(option.source)
    if (weapon !== null) sourceOf.set(weapon, [...(sourceOf.get(weapon) ?? []), { targetWeaponId: option.targetWeaponId, operates: operatesSource(option) }])
  }
  const counts: Record<PlannerStartIdealCategory, number> = { zero_operation_ideal: 0, g4_i: 0, g4_ii: 0, g4_iii: 0 }
  const targets: PlannerStartIdealTarget[] = []
  for (const row of satisfaction) {
    if (!row.hasIdeal) continue
    const option = candidate.assignment.chosen.get(row.targetWeaponId)
    if (!option) throw new RangeError(`The structural candidate holds no option for planning Target ${row.targetWeaponId}.`)
    const ideal = [...row.idealOwnedWeaponIds] as OwnedWeaponId[]
    const own = sourceOwnedWeaponId(option.source)
    const operates = operatesSource(option)
    const weapons = ideal.map(ownedWeaponId => ({ ownedWeaponId, sourceOf: (sourceOf.get(ownedWeaponId) ?? []).map(value => ({ ...value })) }))
    let category: PlannerStartIdealCategory
    if (own !== null && ideal.includes(own)) category = operates ? 'g4_iii' : 'zero_operation_ideal'
    else if (weapons.some(weapon => weapon.sourceOf.some(value => value.targetWeaponId !== row.targetWeaponId))) category = 'g4_ii'
    else category = 'g4_i'
    counts[category] += 1
    targets.push({
      targetWeaponId: row.targetWeaponId, orderIndex: orderIndex.get(row.targetWeaponId) ?? -1, category, idealOwnedWeaponIds: ideal,
      ownOption: { sourceKind: option.source.kind, sourceOwnedWeaponId: own, operatesSource: operates }, weapons,
    })
  }
  targets.sort((left, right) => left.orderIndex - right.orderIndex)
  return { plannerStartIdealTargets: targets.length, counts, g4iiiObservability: 'not_generated_by_current_phase_a', targets }
}
